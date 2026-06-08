import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { LineOaService } from '../line-oa/line-oa.service';
import type { FlexMessagePayload } from '../line-oa/flex-messages/base-template';

/** Shared online-intake input — the common subset of SubmitBuybackDto / SubmitTradeInDto. */
export interface TradeInIntakeDto {
  brand: string;
  model: string;
  storage: string;
  condition: 'A' | 'B' | 'C';
  batteryHealth: number;
  photoUrls: string[];
  imei?: string;
  notes?: string;
  sellerName: string;
  sellerPhone: string;
  lineUserId?: string;
}

interface IntakeOptions {
  flow: 'BUYBACK' | 'EXCHANGE';
  productId?: string;
  flex: { altText: string; title: string };
}

/**
 * Shared online-intake logic for the two near-identical SHOP device-intake
 * flows: buyback (pure cash-out) and trade-in/exchange. Both read the same
 * `tradeInValuation` table and create the same `tradeIn` record — they differ
 * only in the price margin, the `flow` tag, an optional target product, and
 * the confirmation-flex copy. (Wave-4 fold of shop-buyback ≈ shop-trade-in.)
 */
@Injectable()
export class TradeInIntakeService {
  private readonly logger = new Logger(TradeInIntakeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly line: LineOaService,
  ) {}

  /** Valuation lookup + price-range quote, parameterised by margin. */
  async quote(
    key: { brand: string; model: string; storage: string; condition: string },
    margin: { minMult: number; maxMult: number },
  ) {
    const v = await this.prisma.tradeInValuation.findUnique({
      where: {
        brand_model_storage_condition: {
          brand: key.brand,
          model: key.model,
          storage: key.storage,
          condition: key.condition,
        },
      },
    });
    if (!v || v.deletedAt) {
      return { min: 0, max: 0, available: false };
    }
    const base = Number(v.basePrice);
    return {
      min: Math.floor(base * margin.minMult),
      max: Math.ceil(base * margin.maxMult),
      available: true,
      basePrice: base,
    };
  }

  /** Dedup → valuation → create TradeIn → non-fatal LINE flex confirmation. */
  async submit(dto: TradeInIntakeDto, customerId: string | undefined, opts: IntakeOptions) {
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
        flow: opts.flow,
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
        productId: opts.productId,
      },
    });

    if (dto.lineUserId) {
      try {
        await this.line.sendFlexMessage(
          dto.lineUserId,
          this.buildSubmittedFlex(tradeIn.id, opts.flex),
          'line-shop',
        );
      } catch (err) {
        this.logger.warn(`Failed to send intake LINE flex: ${(err as Error).message}`);
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

  private buildSubmittedFlex(
    id: string,
    flex: { altText: string; title: string },
  ): FlexMessagePayload {
    return {
      type: 'flex',
      altText: flex.altText,
      contents: {
        type: 'bubble',
        body: {
          type: 'box',
          layout: 'vertical',
          contents: [
            { type: 'text', text: flex.title, weight: 'bold', size: 'lg' },
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
