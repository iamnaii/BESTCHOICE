/**
 * Shared installment calculation utilities
 * Eliminates duplication between SalesService, ContractsService, and ExchangeService
 *
 * Uses satang-based integer arithmetic (×100) to avoid floating-point rounding errors
 * in financial calculations. All intermediate math uses integers; results are converted
 * back to baht (2 decimal places) only at the end.
 */
import { BadRequestException } from '@nestjs/common';

export interface InstallmentCalculation {
  principal: number;
  interestTotal: number;
  storeCommission: number;
  vatAmount: number;
  financedAmount: number;
  monthlyPayment: number;
}

/** Round a number to 2 decimal places (satang precision) */
export function roundBaht(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Calculate installment financials with full formula:
 * 1. principal (loanAmount) = sellingPrice - downPayment
 * 2. storeCommission = principal × storeCommissionPct
 * 3. interestTotal = principal × interestRate × totalMonths  (flat rate)
 * 4. vatAmount = (principal + storeCommission + interestTotal) × vatPct
 * 5. financedAmount = principal + storeCommission + interestTotal + vatAmount
 * 6. monthlyPayment = round(financedAmount / totalMonths, 2) — satang precision (no rounding up)
 *
 * All intermediate values are computed at satang precision (2 decimal places)
 * to prevent floating-point accumulation errors.
 */
export function calculateInstallment(
  sellingPrice: number,
  downPayment: number,
  interestRate: number,
  totalMonths: number,
  storeCommissionPct: number = 0,
  vatPct: number = 0,
): InstallmentCalculation {
  if (sellingPrice <= 0) throw new BadRequestException('ราคาขายต้องมากกว่า 0');
  if (downPayment < 0) throw new BadRequestException('เงินดาวน์ต้องไม่ติดลบ');
  if (downPayment >= sellingPrice) throw new BadRequestException('เงินดาวน์ต้องน้อยกว่าราคาขาย');
  if (totalMonths <= 0) throw new BadRequestException('จำนวนงวดต้องมากกว่า 0');
  if (interestRate < 0) throw new BadRequestException('อัตราดอกเบี้ยต้องไม่ติดลบ');

  // Use satang-based integer math: multiply by 100, compute, round at each step
  const principal = roundBaht(sellingPrice - downPayment);
  const storeCommission = roundBaht(principal * storeCommissionPct);
  const interestTotal = roundBaht(principal * interestRate * totalMonths);
  const vatAmount = roundBaht((principal + storeCommission + interestTotal) * vatPct);
  const financedAmount = roundBaht(principal + storeCommission + interestTotal + vatAmount);
  // Monthly payment at satang precision (no ceil). Last installment absorbs rounding
  // remainder in generatePaymentSchedule.
  const monthlyPayment = roundBaht(financedAmount / totalMonths);

  return { principal, interestTotal, storeCommission, vatAmount, financedAmount, monthlyPayment };
}

/**
 * Same math as calculateInstallment, but interest is passed as TOTAL amount
 * already resolved by caller (via getRateForMonths). Used during refactor
 * to bridge legacy callers and new rate-lookup pattern. Both routes share
 * the same downstream formula for storeCommission, vatAmount, financedAmount,
 * monthlyPayment so callers can flip from one to the other without changing
 * the output for the same inputs.
 */
export function calculateInstallmentWithInterest(
  sellingPrice: number,
  downPayment: number,
  interestTotal: number,
  totalMonths: number,
  storeCommissionPct: number = 0,
  vatPct: number = 0,
): InstallmentCalculation {
  if (sellingPrice <= 0) throw new BadRequestException('ราคาขายต้องมากกว่า 0');
  if (downPayment < 0) throw new BadRequestException('เงินดาวน์ต้องไม่ติดลบ');
  if (downPayment >= sellingPrice) throw new BadRequestException('เงินดาวน์ต้องน้อยกว่าราคาขาย');
  if (totalMonths <= 0) throw new BadRequestException('จำนวนงวดต้องมากกว่า 0');
  if (interestTotal < 0) throw new BadRequestException('ยอดดอกเบี้ยต้องไม่ติดลบ');

  const principal = roundBaht(sellingPrice - downPayment);
  const storeCommission = roundBaht(principal * storeCommissionPct);
  const interestRounded = roundBaht(interestTotal);
  const vatAmount = roundBaht((principal + storeCommission + interestRounded) * vatPct);
  const financedAmount = roundBaht(principal + storeCommission + interestRounded + vatAmount);
  const monthlyPayment = roundBaht(financedAmount / totalMonths);

  return {
    principal,
    interestTotal: interestRounded,
    storeCommission,
    vatAmount,
    financedAmount,
    monthlyPayment,
  };
}

export interface PaymentScheduleItem {
  contractId: string;
  installmentNo: number;
  dueDate: Date;
  amountDue: number;
  monthlyPrincipal: number | null;
  monthlyInterest: number | null;
  monthlyCommission: number | null;
  vatAmount: number | null;
  status: 'PENDING';
}

export interface BreakdownTotals {
  principal: number;
  interestTotal: number;
  storeCommission: number;
  vatAmount: number;
}

/**
 * Generate payment schedule with custom due day and optional breakdown
 * When breakdownTotals is provided, each payment includes principal/interest/commission/VAT split
 * Formula: amountDue = monthlyPrincipal + monthlyCommission + monthlyInterest + vatAmount
 */
export function generatePaymentSchedule(
  contractId: string,
  totalMonths: number,
  financedAmount: number,
  monthlyPayment: number,
  paymentDueDay?: number | null,
  breakdownTotals?: BreakdownTotals,
): PaymentScheduleItem[] {
  const now = new Date();
  const dueDay = paymentDueDay || 1;
  const payments: PaymentScheduleItem[] = [];

  // Pre-compute per-month breakdowns (ceil for 1..N-1, remainder for last)
  const hasBreakdown = !!breakdownTotals;
  const mpPrincipal = hasBreakdown ? Math.ceil(breakdownTotals.principal / totalMonths) : 0;
  const mpInterest = hasBreakdown ? Math.ceil(breakdownTotals.interestTotal / totalMonths) : 0;
  const mpCommission = hasBreakdown ? Math.ceil(breakdownTotals.storeCommission / totalMonths) : 0;

  let usedPrincipal = 0;
  let usedInterest = 0;
  let usedCommission = 0;

  for (let i = 1; i <= totalMonths; i++) {
    const targetMonth = now.getMonth() + i;
    const lastDay = new Date(now.getFullYear(), targetMonth + 1, 0).getDate();
    const dueDate = new Date(now.getFullYear(), targetMonth, Math.min(dueDay, lastDay));
    const isLast = i === totalMonths;
    const amount = isLast ? financedAmount - monthlyPayment * (totalMonths - 1) : monthlyPayment;

    let principal: number | null = null;
    let interest: number | null = null;
    let commission: number | null = null;
    let vat: number | null = null;

    if (hasBreakdown) {
      principal = isLast ? roundBaht(breakdownTotals.principal - usedPrincipal) : mpPrincipal;
      interest = isLast ? roundBaht(breakdownTotals.interestTotal - usedInterest) : mpInterest;
      commission = isLast ? roundBaht(breakdownTotals.storeCommission - usedCommission) : mpCommission;
      // VAT absorbs rounding: amountDue - (principal + interest + commission)
      vat = roundBaht(amount - principal - interest - commission);

      usedPrincipal += principal;
      usedInterest += interest;
      usedCommission += commission;
    }

    payments.push({
      contractId,
      installmentNo: i,
      dueDate,
      amountDue: amount,
      monthlyPrincipal: principal,
      monthlyInterest: interest,
      monthlyCommission: commission,
      vatAmount: vat,
      status: 'PENDING' as const,
    });
  }

  // Post-generation validation: ensure sum(amountDue) === financedAmount
  const sumPayments = payments.reduce((sum, p) => sum + p.amountDue, 0);
  const diff = Math.abs(sumPayments - financedAmount);
  if (diff > 0.01) {
    throw new BadRequestException(`Payment schedule total mismatch: sum=${roundBaht(sumPayments)}, expected=${roundBaht(financedAmount)}, diff=${roundBaht(diff)}`);
  }

  return payments;
}
