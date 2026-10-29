/**
 * Shared installment calculation utilities
 * Eliminates duplication between SalesService, ContractsService, and ExchangeService
 *
 * Uses satang-based integer arithmetic (×100) to avoid floating-point rounding errors
 * in financial calculations. All intermediate math uses integers; results are converted
 * back to baht (2 decimal places) only at the end.
 */
import { BadRequestException } from '@nestjs/common';
import { computeInstallmentBreakdown } from '../modules/journal/compute-installment-breakdown';

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
 * 6. monthlyPayment = floor(subtotal / months, 2) + round(VAT / months, 2) — CPA rounding
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
  const monthlyPayment = computeInstallmentBreakdown({ financedAmount: principal, storeCommission,
    interestTotal, vatAmount, totalMonths }).installmentTotal.toNumber();

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
  const monthlyPayment = computeInstallmentBreakdown({ financedAmount: principal, storeCommission,
    interestTotal: interestRounded, vatAmount, totalMonths }).installmentTotal.toNumber();

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

export interface PaymentBreakdownRow {
  principal: number;
  interest: number;
  commission: number;
  vat: number;
}

/**
 * ยอดแยกต่องวด (เงินต้น / ดอกเบี้ย / ค่าคอม / VAT) ของ `amounts` (amountDue ของงวด 1..n ตามลำดับ) — สูตรเดียวที่
 * `generatePaymentSchedule` ใช้เขียน `Payment.monthlyPrincipal / monthlyInterest / monthlyCommission / vatAmount`
 * (ตัวนำเข้าระบบเก่าใช้ตัวเดียวกัน — ห้ามมีสูตรชุดที่สอง):
 * - ดอกเบี้ย = `computeInstallmentBreakdown().interestPerInst` · ค่าคอม = `roundBaht(storeCommission / n)` ·
 *   เงินต้น = `installmentExclVat − ดอกเบี้ย − ค่าคอม` (ปัดแยกก่อน/หลัง VAT แบบเดียวกับบัญชี)
 * - งวดที่ `totalMonths` รับเศษของสามยอดแรก (ยอดรวม − ที่ใช้ไปในงวดก่อนหน้า)
 * - VAT = `amountDue − (เงินต้น + ดอกเบี้ย + ค่าคอม)` ⇒ สี่ยอดรวมเท่า amountDue ของแถวเสมอ (เศษของยอดเรียกเก็บลง VAT)
 */
export function paymentBreakdowns(
  totals: BreakdownTotals,
  totalMonths: number,
  amounts: readonly number[],
): PaymentBreakdownRow[] {
  // Match the ledger's separate pre-VAT / VAT rounding; the final row carries residuals.
  const base = computeInstallmentBreakdown({ financedAmount: totals.principal,
    storeCommission: totals.storeCommission, interestTotal: totals.interestTotal,
    vatAmount: totals.vatAmount, totalMonths });
  const mpInterest = base.interestPerInst.toNumber();
  const mpCommission = roundBaht(totals.storeCommission / totalMonths);
  const mpPrincipal = base.installmentExclVat.minus(mpInterest).minus(mpCommission).toNumber();

  let usedPrincipal = 0;
  let usedInterest = 0;
  let usedCommission = 0;
  return amounts.map((amount, index) => {
    const isLast = index + 1 === totalMonths;
    const principal = isLast ? roundBaht(totals.principal - usedPrincipal) : mpPrincipal;
    const interest = isLast ? roundBaht(totals.interestTotal - usedInterest) : mpInterest;
    const commission = isLast ? roundBaht(totals.storeCommission - usedCommission) : mpCommission;
    usedPrincipal += principal;
    usedInterest += interest;
    usedCommission += commission;
    // VAT absorbs rounding: amountDue - (principal + interest + commission)
    return { principal, interest, commission, vat: roundBaht(amount - principal - interest - commission) };
  });
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
  anchor?: Date,
): PaymentScheduleItem[] {
  const now = anchor ?? new Date();
  const calendar = anchor ? new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', year: 'numeric', month: 'numeric' }).formatToParts(now) : null;
  const year = calendar ? Number(calendar.find(part => part.type === 'year')!.value) : now.getFullYear();
  const month = calendar ? Number(calendar.find(part => part.type === 'month')!.value) - 1 : now.getMonth();
  const dueDay = paymentDueDay || 1;
  const payments: PaymentScheduleItem[] = [];

  const amounts = Array.from({ length: totalMonths }, (_, index) =>
    index === totalMonths - 1 ? financedAmount - monthlyPayment * (totalMonths - 1) : monthlyPayment,
  );
  const breakdowns = breakdownTotals ? paymentBreakdowns(breakdownTotals, totalMonths, amounts) : null;

  for (let i = 1; i <= totalMonths; i++) {
    const targetMonth = month + i;
    const lastDay = new Date(Date.UTC(year, targetMonth + 1, 0)).getUTCDate();
    // An explicit anchor uses the Thai business calendar; omitted preserves legacy callers.
    const dueDate = anchor ? new Date(Date.UTC(year, targetMonth, Math.min(dueDay, lastDay)) - 7 * 60 * 60 * 1000)
      : new Date(year, targetMonth, Math.min(dueDay, lastDay));
    const breakdown = breakdowns?.[i - 1] ?? null;

    payments.push({
      contractId,
      installmentNo: i,
      dueDate,
      amountDue: amounts[i - 1],
      monthlyPrincipal: breakdown?.principal ?? null,
      monthlyInterest: breakdown?.interest ?? null,
      monthlyCommission: breakdown?.commission ?? null,
      vatAmount: breakdown?.vat ?? null,
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
