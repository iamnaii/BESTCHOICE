import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export const CREDIT_AFFORDABILITY_POLICY = 'BC-2026-09-v1';

export interface AffordabilityAmounts {
  verifiedMonthlyIncome: number;
  livingExpenses: number;
  externalMonthlyDebt: number;
  internalMonthlyDebt: number;
}

/** Verified monthly amounts only. Missing evidence is never equivalent to zero. */
export function calculateAffordability(input: AffordabilityAmounts) {
  for (const amount of [input.verifiedMonthlyIncome, input.livingExpenses,
    input.externalMonthlyDebt, input.internalMonthlyDebt]) {
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0) {
      throw new BadRequestException('กรุณายืนยันรายได้ ค่าครองชีพ และหนี้รายเดือนให้ครบและไม่ติดลบ');
    }
  }
  const income = new Prisma.Decimal(input.verifiedMonthlyIncome);
  const debt = new Prisma.Decimal(input.externalMonthlyDebt).plus(input.internalMonthlyDebt);
  const remaining = income.minus(input.livingExpenses).minus(debt);
  const maximum = Prisma.Decimal.max(0, Prisma.Decimal.min(
    remaining.mul('0.5'), income.mul('0.4').minus(debt),
  )).div(100).floor().mul(100);
  return {
    policyVersion: CREDIT_AFFORDABILITY_POLICY,
    totalMonthlyDebt: debt.toNumber(),
    remainingIncome: remaining.toNumber(),
    maximumMonthlyPayment: maximum.toNumber(),
  };
}
