import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../../../prisma/prisma.service';
import { calcBcInstallment } from '../../../utils/installment-calc.util';

export type DecimalLike = string | number | { toString(): string };

export interface ProductPriceInput {
  /** ProductCategory ของเครื่อง — ใช้จับคู่ InterestConfig.productCategories */
  category: string;
  cashPrice: DecimalLike | null;
  installmentPrice: DecimalLike | null;
  /** ProductPrice rows (deletedAt: null) — ใช้เป็น fallback เมื่อคอลัมน์ยังว่าง */
  prices?: { label: string; amount: DecimalLike }[];
}

export interface QuoteConfigInput {
  minDownPaymentPct: DecimalLike;
  storeCommissionPct: DecimalLike;
  vatPct: DecimalLike;
  interestRate: DecimalLike;
  minInstallmentMonths: number;
  maxInstallmentMonths: number;
  rates: { months: number; ratePct: DecimalLike }[];
}

export interface ProductQuote {
  cashPrice: number | null;
  installmentPrice: number | null;
  /** งวดยาวสุดที่ตารางอัตราอนุญาต (null = ผ่อนไม่ได้ / ไม่มีราคาผ่อน) */
  months: number | null;
  monthlyPayment: number | null;
  downAmount: number | null;
}

const dec = (v: DecimalLike): Decimal => new Decimal(v.toString());

const EMPTY_INSTALLMENT = { months: null, monthlyPayment: null, downAmount: null } as const;

/**
 * ลำดับการอ่านราคา — columns-first แล้วค่อย prices[] เหมือน
 * `installment-preview.service.ts:39-43` (api) และ `getDisplayPrices.ts:26-37` (web).
 * ห้าม fallback ไป prices[0] เด็ดขาด: prod มี default row ปนหลาย label
 * ('ราคาขาย' / 'ราคาขายต่อ (Refurbished)') ที่ไม่ใช่ราคาขายจริงของเครื่องนั้น
 */
export function resolveProductPrices(p: ProductPriceInput): {
  cash: number | null;
  installment: number | null;
} {
  const rows = p.prices ?? [];
  const pick = (exact: string, prefix: string) =>
    rows.find((r) => r.label === exact) ?? rows.find((r) => r.label.startsWith(prefix));

  const cashRow = pick('ราคาเงินสด', 'ราคาเงินสด');
  const instRow = pick('ราคาผ่อน BESTCHOICE', 'ราคาผ่อน');

  return {
    cash: p.cashPrice != null ? Number(p.cashPrice) : cashRow ? Number(cashRow.amount) : null,
    installment:
      p.installmentPrice != null
        ? Number(p.installmentPrice)
        : instRow
          ? Number(instRow.amount)
          : null,
  };
}

/**
 * คำนวณ "ราคา + ค่างวดเริ่มต้น" สำหรับแสดงในแชท (pure — ไม่แตะ DB, ไม่เขียนอะไร).
 * งวด = งวดยาวสุดในตารางอัตรา, ดาวน์ = ขั้นต่ำของ config → ตัวเลขที่เห็นในแชท
 * คือตัวเลขที่ทำสัญญาได้จริง ไม่ใช่ค่าคงที่ '12 งวด' ที่เคย hardcode ไว้
 */
export function computeProductQuote(
  p: ProductPriceInput,
  config: QuoteConfigInput | null,
): ProductQuote {
  const { cash, installment } = resolveProductPrices(p);
  const base = { cashPrice: cash, installmentPrice: installment };

  if (installment == null || installment <= 0 || !config) {
    return { ...base, ...EMPTY_INSTALLMENT };
  }

  const ratePctByMonths = new Map<number, Decimal>();
  for (const r of config.rates) ratePctByMonths.set(r.months, dec(r.ratePct));
  if (ratePctByMonths.size === 0) {
    // fallback เดียวกับ installment-preview.service.ts:83-88 — rate ต่อเดือน × จำนวนงวด
    const perMonth = dec(config.interestRate);
    for (let m = config.minInstallmentMonths; m <= config.maxInstallmentMonths; m++) {
      ratePctByMonths.set(m, perMonth.mul(m));
    }
  }
  const allowedMonths = Array.from(ratePctByMonths.keys()).sort((a, b) => a - b);
  if (allowedMonths.length === 0) return { ...base, ...EMPTY_INSTALLMENT };

  const months = allowedMonths[allowedMonths.length - 1];
  const result = calcBcInstallment({
    installmentPrice: dec(installment),
    months,
    config: {
      minDownPct: dec(config.minDownPaymentPct),
      commissionPct: dec(config.storeCommissionPct),
      vatPct: dec(config.vatPct),
      ratePctByMonths,
      allowedMonths,
    },
  });
  if (!result.isValid) return { ...base, ...EMPTY_INSTALLMENT };

  return {
    ...base,
    months,
    monthlyPayment: result.monthlyPayment.toNumber(),
    downAmount: result.downAmount.toNumber(),
  };
}

@Injectable()
export class ProductQuoteService {
  constructor(private prisma: PrismaService) {}

  /**
   * โหลด InterestConfig ครั้งเดียวต่อชุด (กัน N+1 เวลา search คืน 20 เครื่อง)
   * แล้ว map ทีละเครื่องด้วย computeProductQuote
   */
  async getQuotes(inputs: ProductPriceInput[]): Promise<ProductQuote[]> {
    if (inputs.length === 0) return [];
    const categories = [...new Set(inputs.map((i) => i.category))];
    const configs = await this.prisma.interestConfig.findMany({
      where: {
        productCategories: { hasSome: categories },
        deletedAt: null,
        isActive: true,
      },
      include: { rates: { where: { deletedAt: null } } },
      orderBy: { createdAt: 'asc' },
    });

    // config ตัวแรกสุด (createdAt asc) ชนะต่อหมวด — deterministic ต่างจาก
    // installment-preview.service.ts ที่ findFirst ไม่มี orderBy
    const byCategory = new Map<string, (typeof configs)[number]>();
    for (const c of configs) {
      for (const cat of c.productCategories) {
        if (!byCategory.has(cat)) byCategory.set(cat, c);
      }
    }

    return inputs.map((i) => computeProductQuote(i, byCategory.get(i.category) ?? null));
  }

  async getQuote(input: ProductPriceInput): Promise<ProductQuote> {
    const [quote] = await this.getQuotes([input]);
    return quote;
  }
}
