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
 * Fix round 1 [C1]: non-positive (0 / '' / negative / NaN) treated as "absent"
 * — same rule as `isUsablePrice` (`apps/api/src/utils/product-price-sync.util.ts`,
 * write-side) and `normalizePositive` (`apps/web/src/utils/getDisplayPrices.ts`,
 * read-side). A column or `prices[]` row that is exactly 0 or negative means
 * "no price on record", not "free" — it must never win outright and must never
 * be treated as a usable fallback candidate either.
 *
 * Returns the ORIGINAL `DecimalLike` (not a coerced `number`) when valid, so
 * `computeProductQuote` can feed the winning value straight into `Decimal`
 * without round-tripping through a JS `number` first (Fix round 1 [I2] — avoids
 * an unnecessary Decimal→Number→Decimal hop between resolution and
 * `calcBcInstallment`). `resolveProductPrices` below is the public,
 * contract-fixed wrapper that coerces this to `number` for display.
 */
function positiveOrNull(v: DecimalLike | null | undefined): DecimalLike | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? v : null;
}

/**
 * ลำดับการอ่านราคา — columns-first แล้วค่อย prices[] เหมือน
 * `installment-preview.service.ts:39-43` (api) และ `getDisplayPrices.ts:26-37` (web).
 * ห้าม fallback ไป prices[0] เด็ดขาด: prod มี default row ปนหลาย label
 * ('ราคาขาย' / 'ราคาขายต่อ (Refurbished)') ที่ไม่ใช่ราคาขายจริงของเครื่องนั้น
 *
 * Fix round 1 [C1]: both layers are positive-only. A column that is 0/negative
 * loses to a real `prices[]` row (does NOT short-circuit past the label-chain);
 * a `prices[]` row that is 0/negative/unparseable is dropped from the
 * candidate set entirely before label matching runs, so it can never win —
 * label matching moves on to the next row instead of surfacing a bad value.
 */
function resolvePriceSources(p: ProductPriceInput): {
  cash: DecimalLike | null;
  installment: DecimalLike | null;
} {
  const rows = (p.prices ?? []).filter((r) => positiveOrNull(r.amount) != null);
  const pick = (exact: string, prefix: string) =>
    rows.find((r) => r.label === exact) ?? rows.find((r) => r.label.startsWith(prefix));

  const cashRow = pick('ราคาเงินสด', 'ราคาเงินสด');
  const instRow = pick('ราคาผ่อน BESTCHOICE', 'ราคาผ่อน');

  return {
    cash: positiveOrNull(p.cashPrice) ?? cashRow?.amount ?? null,
    installment: positiveOrNull(p.installmentPrice) ?? instRow?.amount ?? null,
  };
}

export function resolveProductPrices(p: ProductPriceInput): {
  cash: number | null;
  installment: number | null;
} {
  const { cash, installment } = resolvePriceSources(p);
  return {
    cash: cash != null ? Number(cash) : null,
    installment: installment != null ? Number(installment) : null,
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
  // Resolve straight to DecimalLike sources (not through the public
  // number-returning `resolveProductPrices`) — see positiveOrNull's jsdoc [I2].
  const { cash, installment } = resolvePriceSources(p);
  const base = {
    cashPrice: cash != null ? Number(cash) : null,
    installmentPrice: installment != null ? Number(installment) : null,
  };

  if (installment == null || !config) {
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
    // installment-preview.service.ts ที่ findFirst ไม่มี orderBy. Fix round 1
    // [C2]: InterestConfigService.resolveConfig (interest-config.service.ts)
    // now carries the SAME `orderBy: { createdAt: 'asc' }` for the same
    // reason — keep both in sync if this selection rule ever changes, or the
    // bot/web-shop resolver and this one can quote two different numbers for
    // a category with >1 active config.
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
