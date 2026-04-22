import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { LineOaService } from '../line-oa/line-oa.service';
import type { FlexMessagePayload } from '../line-oa/flex-messages/base-template';
import { QuickQuoteDto } from './dto/quick-quote.dto';
import { SubmitBuybackDto } from './dto/submit.dto';

@Injectable()
export class ShopBuybackService {
  private readonly logger = new Logger(ShopBuybackService.name);

  constructor(
    private prisma: PrismaService,
    private line: LineOaService,
  ) {}

  /**
   * Quick-quote — buyback (pure cash-out) pays less than exchange because
   * there is no downstream sale margin to offset. Margin: min=floor(base*0.80),
   * max=ceil(base*0.95).
   */
  async quickQuote(dto: QuickQuoteDto) {
    const v = await this.prisma.tradeInValuation.findUnique({
      where: {
        brand_model_storage_condition: {
          brand: dto.brand,
          model: dto.model,
          storage: dto.storage,
          condition: dto.condition,
        },
      },
    });
    if (!v || v.deletedAt) {
      return { min: 0, max: 0, available: false };
    }
    const base = Number(v.basePrice);
    return {
      min: Math.floor(base * 0.8),
      max: Math.ceil(base * 0.95),
      available: true,
      basePrice: base,
    };
  }

  /**
   * Submit a buyback request — flow=BUYBACK, no target product (pure cash-out).
   * Dedup by (imei + sellerPhone) within 24h.
   */
  async submit(dto: SubmitBuybackDto, customerId: string | undefined) {
    if (dto.imei) {
      const dup = await this.prisma.tradeIn.findFirst({
        where: {
          imei: dto.imei,
          sellerPhone: dto.sellerPhone,
          createdAt: { gt: new Date(Date.now() - 24 * 3600_000) },
          deletedAt: null,
        },
      });
      if (dup) {
        throw new BadRequestException('เครื่องนี้อยู่ระหว่างประเมินราคาแล้ว');
      }
    }

    const valuation = await this.prisma.tradeInValuation.findUnique({
      where: {
        brand_model_storage_condition: {
          brand: dto.brand,
          model: dto.model,
          storage: dto.storage,
          condition: dto.condition,
        },
      },
    });
    if (!valuation || valuation.deletedAt) {
      throw new NotFoundException('ไม่พบข้อมูลราคาประเมินสำหรับรุ่นนี้');
    }

    const tradeIn = await this.prisma.tradeIn.create({
      data: {
        submissionSource: 'ONLINE',
        flow: 'BUYBACK',
        status: 'PENDING_APPRAISAL',
        deviceBrand: dto.brand,
        deviceModel: dto.model,
        deviceStorage: dto.storage,
        deviceCondition: dto.condition,
        batteryHealth: dto.batteryHealth,
        imei: dto.imei,
        photoUrls: dto.photoUrls,
        customerNotes: dto.notes,
        customerLineId: dto.lineUserId,
        sellerName: dto.sellerName,
        sellerPhone: dto.sellerPhone,
        basePriceAtAppraisal: valuation.basePrice,
        customerId,
      },
    });

    if (dto.lineUserId) {
      try {
        await this.line.sendFlexMessage(dto.lineUserId, this.buildSubmittedFlex(tradeIn.id));
      } catch (err) {
        this.logger.warn(`Failed to send buyback LINE flex: ${(err as Error).message}`);
      }
    }

    return { id: tradeIn.id, status: tradeIn.status, etaHours: 24 };
  }

  async getStatus(id: string) {
    const t = await this.prisma.tradeIn.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        offeredPrice: true,
        agreedPrice: true,
        photoUrls: true,
        deviceBrand: true,
        deviceModel: true,
        deviceStorage: true,
        deviceCondition: true,
        batteryHealth: true,
        flow: true,
        submissionSource: true,
        createdAt: true,
      },
    });
    if (!t) throw new NotFoundException('ไม่พบคำขอ');
    return t;
  }

  private buildSubmittedFlex(id: string): FlexMessagePayload {
    return {
      type: 'flex',
      altText: 'รับเรื่องรับซื้อแล้ว',
      contents: {
        type: 'bubble',
        body: {
          type: 'box',
          layout: 'vertical',
          contents: [
            { type: 'text', text: 'รับเรื่องรับซื้อมือถือ', weight: 'bold', size: 'lg' },
            { type: 'text', text: `รหัส ${id.slice(0, 8).toUpperCase()}`, margin: 'md' },
            {
              type: 'text',
              text: 'ราคาเสนอภายใน 24 ชั่วโมง',
              size: 'xs',
              color: '#888888',
              margin: 'md',
            },
          ],
        },
      },
    };
  }
}
