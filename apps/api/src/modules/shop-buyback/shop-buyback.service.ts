import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { LineOaService } from '../line-oa/line-oa.service';
import type { FlexMessagePayload } from '../line-oa/flex-messages/base-template';
import { readNumberFlag } from '../../utils/config.util';
import { BuybackPricingService, DeductSelection } from './buyback-pricing.service';
import { QuoteAnswerDto, SubmitBuybackDto } from './dto/quote.dto';

/** เรียงรุ่น iPhone ใหม่→เก่า: gen*10 + (Pro Max 3 / Pro 2 / Plus 1 / base 0); parse ไม่ได้ → null (ไปท้าย) */
export function iphoneModelRank(model: string): number | null {
  const m = /iphone\s+(\d+)/i.exec(model);
  if (!m) return null;
  const lower = model.toLowerCase();
  const variant = lower.includes('pro max')
    ? 3
    : lower.includes('pro')
      ? 2
      : lower.includes('plus')
        ? 1
        : 0;
  return Number(m[1]) * 10 + variant;
}

function storageGb(storage: string): number {
  const m = /(\d+)/.exec(storage);
  return m ? Number(m[1]) * (/tb/i.test(storage) ? 1024 : 1) : 0;
}

/**
 * Engine เดียวของหน้า /sell (ขาย/เทิร์น iPhone) — intake engine เก่าของ
 * shop-trade-in ถูกปลดระวางแล้ว (spec /sell 2026-07-18) เหลือแค่ 410 stub
 */
@Injectable()
export class ShopBuybackService {
  private readonly logger = new Logger(ShopBuybackService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly line: LineOaService,
    private readonly pricing: BuybackPricingService,
  ) {}

  // ─── Catalog ──────────────────────────────────────────────────────────
  async getCatalog() {
    const rows = await this.prisma.tradeInValuation.findMany({
      where: {
        brand: { equals: 'Apple', mode: 'insensitive' },
        model: { startsWith: 'iphone', mode: 'insensitive' },
        condition: 'A',
        deletedAt: null,
      },
      select: { model: true, storage: true, basePrice: true },
    });

    const byModel = new Map<string, Array<{ storage: string; maxPrice: string }>>();
    for (const r of rows) {
      const list = byModel.get(r.model) ?? [];
      list.push({ storage: r.storage, maxPrice: new Prisma.Decimal(r.basePrice).toFixed(2) });
      byModel.set(r.model, list);
    }

    const models = [...byModel.entries()]
      .map(([model, storages]) => ({
        model,
        storages: storages.sort((a, b) => storageGb(a.storage) - storageGb(b.storage)),
      }))
      .sort((a, b) => {
        const ra = iphoneModelRank(a.model);
        const rb = iphoneModelRank(b.model);
        if (ra !== null && rb !== null) return rb - ra;
        if (ra !== null) return -1;
        if (rb !== null) return 1;
        return a.model.localeCompare(b.model); // parse ไม่ได้ → ท้าย, เรียงตามชื่อ
      });

    return { models };
  }

  // ─── Questions ────────────────────────────────────────────────────────
  async getQuestions() {
    const questions = await this.loadActiveQuestions();
    const bonusPct = await this.getBonusPct();
    return {
      bonusPct: bonusPct.toString(),
      questions: questions.map((q) => ({
        id: q.id,
        key: q.key,
        title: q.title,
        helpText: q.helpText,
        selectType: q.selectType,
        choices: q.choices.map((c) => ({
          id: c.id,
          label: c.label,
          deductType: c.deductType,
          deductValue: new Prisma.Decimal(c.deductValue).toString(),
        })),
      })),
    };
  }

  /** โบนัสเทิร์น % จาก SystemConfig — default 10, นอกช่วง 0–100 → 10 (spec /sell §3) */
  async getBonusPct(): Promise<Prisma.Decimal> {
    const n = await readNumberFlag(this.prisma, 'sell_exchange_bonus_pct', 10);
    if (n < 0 || n > 100) {
      this.logger.warn(`sell_exchange_bonus_pct=${n} นอกช่วง 0–100 — ใช้ default 10`);
      return new Prisma.Decimal(10);
    }
    return new Prisma.Decimal(n);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async loadActiveQuestions(): Promise<any[]> {
    const rows = await this.prisma.buybackQuestion.findMany({
      where: { isActive: true, deletedAt: null },
      orderBy: { sortOrder: 'asc' },
      include: { choices: { orderBy: { sortOrder: 'asc' } } },
    });
    // choices กรอง active ใน JS (Prisma include+where ซ้อนได้ แต่แบบนี้ mock ง่ายกว่า)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return rows.map((q: any) => ({
      ...q,
      choices: q.choices.filter((c: any) => c.isActive && !c.deletedAt), // eslint-disable-line @typescript-eslint/no-explicit-any
    }));
  }

  // ─── Quote ────────────────────────────────────────────────────────────
  async quoteForAnswers(
    model: string,
    storage: string,
    answers: QuoteAnswerDto[],
    flow: 'BUYBACK' | 'EXCHANGE' = 'BUYBACK',
  ) {
    const valuation = await this.prisma.tradeInValuation.findFirst({
      where: {
        brand: { equals: 'Apple', mode: 'insensitive' },
        model: { equals: model, mode: 'insensitive' },
        storage: { equals: storage, mode: 'insensitive' },
        condition: 'A',
        deletedAt: null,
      },
    });
    if (!valuation) {
      return { available: false as const };
    }

    const questions = await this.loadActiveQuestions();
    if (questions.length === 0) {
      this.logger.warn('Buyback questionnaire ว่าง — เสนอ maxPrice ตรงๆ');
    }

    const questionKeys = answers.map((a) => a.questionKey);
    if (new Set(questionKeys).size !== questionKeys.length) {
      throw new BadRequestException('คำตอบซ้ำกัน กรุณาลองใหม่');
    }

    const byKey = new Map(answers.map((a) => [a.questionKey, a.choiceIds]));
    const selections: DeductSelection[] = [];
    const conditionAnswers: unknown[] = [];

    for (const q of questions) {
      const chosenIds = byKey.get(q.key) ?? [];
      const uniqueIds = [...new Set(chosenIds)];
      if (q.selectType === 'SINGLE' && uniqueIds.length !== 1) {
        throw new BadRequestException('กรุณาตอบแบบประเมินให้ครบทุกข้อ');
      }
      const chosen = uniqueIds.map((id: string) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const c = q.choices.find((x: any) => x.id === id);
        if (!c) throw new BadRequestException('กรุณาตอบแบบประเมินให้ครบทุกข้อ');
        return c;
      });
      for (const c of chosen) {
        selections.push({
          choiceId: c.id,
          label: `${q.title}: ${c.label}`,
          deductType: c.deductType,
          deductValue: new Prisma.Decimal(c.deductValue),
        });
      }
      conditionAnswers.push({
        questionKey: q.key,
        title: q.title,
        selectType: q.selectType,
        choices: chosen.map((c) => ({
          choiceId: c.id,
          label: c.label,
          deductType: c.deductType,
          deductValue: new Prisma.Decimal(c.deductValue).toString(),
        })),
      });
    }

    const maxPrice = new Prisma.Decimal(valuation.basePrice);
    const comp = this.pricing.compute(maxPrice, selections);
    const bonusPct = await this.getBonusPct();
    const exchangePrice = this.pricing.applyExchangeBonus(comp.price, bonusPct);
    const flowPrice = flow === 'EXCHANGE' ? exchangePrice : comp.price;
    return {
      available: true as const,
      model: valuation.model as string,
      storage: valuation.storage as string,
      price: flowPrice.toFixed(2),
      cashPrice: comp.price.toFixed(2),
      exchangePrice: exchangePrice.toFixed(2),
      bonusPct: bonusPct.toString(),
      maxPrice: maxPrice.toFixed(2),
      grade: this.pricing.gradeFromPct(comp.pctTotal),
      breakdown: {
        maxPrice: maxPrice.toFixed(2),
        fixedTotal: comp.fixedTotal.toFixed(2),
        pctTotal: comp.pctTotal.toString(),
        // invariant (spec §3): price = ราคาทาง flow เสมอ (== estimatedValue ตอน submit)
        price: flowPrice.toFixed(2),
        cashPrice: comp.price.toFixed(2),
        exchangePrice: exchangePrice.toFixed(2),
        bonusPct: bonusPct.toString(),
        chosenFlow: flow,
        lines: comp.lines,
      },
      conditionAnswers,
    };
  }

  // ─── Submit ───────────────────────────────────────────────────────────
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
      if (dup) throw new BadRequestException('เครื่องนี้อยู่ระหว่างประเมินราคาแล้ว');
    }

    const flow = dto.flow ?? 'BUYBACK';
    const quote = await this.quoteForAnswers(dto.model, dto.storage, dto.answers, flow);
    if (!quote.available) {
      throw new NotFoundException('รุ่นนี้ยังไม่เปิดรับซื้อออนไลน์');
    }

    const tradeIn = await this.prisma.tradeIn.create({
      data: {
        submissionSource: 'ONLINE',
        flow,
        status: 'PENDING_APPRAISAL',
        deviceBrand: 'Apple',
        deviceModel: quote.model,
        deviceStorage: quote.storage,
        deviceCondition: quote.grade,
        imei: dto.imei,
        customerNotes: dto.notes,
        customerLineId: dto.lineUserId,
        sellerName: dto.sellerName,
        sellerPhone: dto.sellerPhone,
        estimatedValue: new Prisma.Decimal(quote.price!),
        conditionAnswers: quote.conditionAnswers as Prisma.InputJsonValue,
        quoteBreakdown: quote.breakdown as unknown as Prisma.InputJsonValue,
        preferredVisitDate: dto.preferredVisitDate ? new Date(dto.preferredVisitDate) : undefined,
        customerId,
        // basePriceAtAppraisal จงใจไม่ set (spec §5.2) — appraise handshake เป็นคน snapshot
      },
    });

    if (dto.lineUserId) {
      try {
        await this.line.sendFlexMessage(
          dto.lineUserId,
          this.buildQuoteFlex(tradeIn.id, quote.price!, flow),
          'line-shop',
        );
      } catch (err) {
        this.logger.warn(`Failed to send buyback LINE flex: ${(err as Error).message}`);
      }
    }

    return { id: tradeIn.id, status: tradeIn.status, price: quote.price! };
  }

  // ─── Status ───────────────────────────────────────────────────────────
  async getStatus(id: string) {
    const t = await this.prisma.tradeIn.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        status: true,
        offeredPrice: true,
        agreedPrice: true,
        estimatedValue: true,
        quoteBreakdown: true,
        preferredVisitDate: true,
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

  private buildQuoteFlex(
    id: string,
    price: string,
    flow: 'BUYBACK' | 'EXCHANGE',
  ): FlexMessagePayload {
    const pretty = Number(price).toLocaleString('th-TH', { maximumFractionDigits: 0 });
    const isExchange = flow === 'EXCHANGE';
    return {
      type: 'flex',
      altText: isExchange ? 'ยืนยันมูลค่าเทิร์นแล้ว' : 'ยืนยันราคารับซื้อแล้ว',
      contents: {
        type: 'bubble',
        body: {
          type: 'box',
          layout: 'vertical',
          contents: [
            {
              type: 'text',
              text: isExchange ? 'เครดิตเทิร์นแลกเครื่องใหม่' : 'ราคาที่ประเมิน',
              weight: 'bold',
              size: 'lg',
            },
            { type: 'text', text: `฿${pretty}`, weight: 'bold', size: 'xxl', margin: 'md' },
            { type: 'text', text: `รหัส ${id.slice(0, 8).toUpperCase()}`, margin: 'md' },
            {
              type: 'text',
              text: isExchange
                ? 'มาเลือกเครื่องที่ร้าน — ใช้เป็นส่วนลดซื้อเครื่อง ไม่จ่ายเป็นเงินสด'
                : 'ทีมงานจะติดต่อนัดวันเข้าร้าน — ยืนยันราคาจริงตอนตรวจเครื่อง',
              size: 'xs',
              color: '#888888',
              margin: 'md',
              wrap: true,
            },
          ],
        },
      },
    };
  }
}
