import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { BuybackPricingMode } from './reference-pricing.types';

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
    applied?: boolean;
  }>;
}

/**
 * Legacy mode: subtract fixed deductions, sum percentages and floor to tens.
 * Reference mode: subtract fixed deductions, apply the highest selected percentage,
 * and keep the result without flooring to tens. Clamp at zero and round to cents
 * are BESTCHOICE monetary safeguards; source observations verify whole-baht cases.
 * Both paths use Decimal throughout.
 */
@Injectable()
export class BuybackPricingService {
  compute(maxPrice: Prisma.Decimal, selections: DeductSelection[], mode: BuybackPricingMode = 'SUM_PERCENT_FLOOR10'): QuoteComputation {
    const ZERO = new Prisma.Decimal(0);
    const HUNDRED = new Prisma.Decimal(100);

    let fixedTotal = ZERO;
    let pctSum = ZERO;
    for (const s of selections) {
      if (s.deductType === 'FIXED') fixedTotal = fixedTotal.plus(s.deductValue);
      else pctSum = mode === 'MAX_PERCENT_EXACT' ? Prisma.Decimal.max(pctSum, s.deductValue) : pctSum.plus(s.deductValue);
    }
    const pctTotal = Prisma.Decimal.min(pctSum, HUNDRED);
    const afterFixed = Prisma.Decimal.max(maxPrice.minus(fixedTotal), ZERO);
    const raw = afterFixed.mul(HUNDRED.minus(pctTotal)).div(HUNDRED);
    const price = mode === 'MAX_PERCENT_EXACT' ? Prisma.Decimal.max(raw.toDecimalPlaces(2), ZERO)
      : Prisma.Decimal.max(raw.div(10).floor().mul(10), ZERO);

    if (mode === 'MAX_PERCENT_EXACT') {
      let fixedRemaining = maxPrice;
      let percentApplied = false;
      const lines = selections.map((s) => {
        let amount = ZERO;
        if (s.deductType === 'FIXED') {
          amount = Prisma.Decimal.min(s.deductValue, fixedRemaining);
          fixedRemaining = Prisma.Decimal.max(fixedRemaining.minus(amount), ZERO);
        } else if (!percentApplied && s.deductValue.gte(pctTotal)) {
          amount = afterFixed.minus(price);
          percentApplied = true;
        }
        return { label: s.label, deductType: s.deductType, deductValue: s.deductValue.toString(),
          amount: amount.toFixed(2), applied: amount.gt(0) };
      });
      return { maxPrice, fixedTotal, pctTotal, price, lines };
    }

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

  /**
   * ราคาเทิร์น = เงินสด × (1 + โบนัส%) ปัดลงหลักสิบ (spec /sell §3)
   * ห้ามสร้าง Decimal จาก float (1 + pct/100) — คูณ/หารด้วย 100 ตรงๆ
   */
  applyExchangeBonus(cash: Prisma.Decimal, bonusPct: Prisma.Decimal): Prisma.Decimal {
    const HUNDRED = new Prisma.Decimal(100);
    const raw = cash.mul(HUNDRED.plus(bonusPct)).div(HUNDRED);
    return Prisma.Decimal.max(raw.div(10).floor().mul(10), new Prisma.Decimal(0));
  }
}
