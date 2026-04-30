import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { LineOaService } from '../line-oa/line-oa.service';
import type { FlexMessagePayload } from '../line-oa/flex-messages/base-template';
import { EstimateDto } from './dto/estimate.dto';
import { SubmitTradeInDto } from './dto/submit.dto';

@Injectable()
export class ShopTradeInService {
  private readonly logger = new Logger(ShopTradeInService.name);

  constructor(
    private prisma: PrismaService,
    private line: LineOaService,
  ) {}

  /**
   * Quick estimate — returns a price range based on the central valuation table.
   * Margin: min = floor(base * 0.85), max = ceil(base * 1.05)
   * Actual offer is made by staff after receiving the device.
   */
  async estimate(dto: EstimateDto) {
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
      min: Math.floor(base * 0.85),
      max: Math.ceil(base * 1.05),
      available: true,
      basePrice: base,
    };
  }

  /**
   * Submit an online trade-in request. Creates a TradeIn record with
   * submissionSource=ONLINE, flow=EXCHANGE. Staff will appraise within 24h.
   * De-duplicates by (imei) within the last 24h to prevent accidental re-submits.
   */
  async submit(dto: SubmitTradeInDto, customerId: string | undefined) {
    // Dedup by imei within 24h (also filter by phone when no imei? — skip: not
    // all submissions have imei and we prefer to accept rather than block)
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
        flow: 'EXCHANGE',
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
        productId: dto.targetProductId,
      },
    });

    // Non-fatal LINE flex notification — customer still sees the in-app confirmation
    if (dto.lineUserId) {
      try {
        await this.line.sendFlexMessage(dto.lineUserId, this.buildSubmittedFlex(tradeIn.id), 'line-shop');
      } catch (err) {
        this.logger.warn(`Failed to send trade-in LINE flex: ${(err as Error).message}`);
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
      altText: 'รับเรื่องเก่าแลกใหม่แล้ว',
      contents: {
        type: 'bubble',
        body: {
          type: 'box',
          layout: 'vertical',
          contents: [
            { type: 'text', text: 'รับเรื่องเก่าแลกใหม่', weight: 'bold', size: 'lg' },
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
