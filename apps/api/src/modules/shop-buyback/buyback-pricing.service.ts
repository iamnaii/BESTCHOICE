import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export interface DeductSelection {
  choiceId: string;
  label: string;
  deductType: 'PERCENT' | 'FIXED';
  deductValue: Prisma.Decimal;
}

export interface QuoteComputation {
  maxPrice: Prisma.Decimal;
  fixedTotal: Prisma.Decimal;
  pctTotal: Prisma.Decimal;
  price: Prisma.Decimal;
  lines: Array<{
    label: string;
    deductType: 'PERCENT' | 'FIXED';
    deductValue: string;
    amount: string;
  }>;
}

/**
 * Pricing engine ของ buyback instant-quote (yellobe-style):
 *   price = max(floor(((max − Σfixed) × (1 − min(Σpct,100)/100)) / 10) × 10, 0)
 * Decimal ล้วนตาม money rule — ห้ามแตะ TradeInIntakeService.quote() เดิม
 * (ตัวนั้นเป็น Number()+Math.floor ของ EXCHANGE flow ที่ spec เดิม lock ไว้)
 */
@Injectable()
export class BuybackPricingService {
  compute(maxPrice: Prisma.Decimal, selections: DeductSelection[]): QuoteComputation {
    const ZERO = new Prisma.Decimal(0);
    const HUNDRED = new Prisma.Decimal(100);

    let fixedTotal = ZERO;
    let pctSum = ZERO;
    for (const s of selections) {
      if (s.deductType === 'FIXED') fixedTotal = fixedTotal.plus(s.deductValue);
      else pctSum = pctSum.plus(s.deductValue);
    }
    const pctTotal = Prisma.Decimal.min(pctSum, HUNDRED);
    const afterFixed = Prisma.Decimal.max(maxPrice.minus(fixedTotal), ZERO);
    const raw = afterFixed.mul(HUNDRED.minus(pctTotal)).div(HUNDRED);
    const price = Prisma.Decimal.max(raw.div(10).floor().mul(10), ZERO);

    const lines = selections.map((s) => ({
      label: s.label,
      deductType: s.deductType,
      deductValue: s.deductValue.toString(),
      amount: (s.deductType === 'FIXED'
        ? s.deductValue
        : afterFixed.mul(s.deductValue).div(HUNDRED)
      ).toFixed(2),
    }));

    return { maxPrice, fixedTotal, pctTotal, price, lines };
  }

  /** เกรดอิง Σ% เท่านั้น (fixed ไม่มีผล) — ใช้กับ TradeIn.deviceCondition เพื่อ filter/รายงาน */
  gradeFromPct(pctTotal: Prisma.Decimal): 'A' | 'B' | 'C' | 'D' {
    if (pctTotal.lte(0)) return 'A';
    if (pctTotal.lte(10)) return 'B';
    if (pctTotal.lte(35)) return 'C';
    return 'D';
  }
}
