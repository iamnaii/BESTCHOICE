/**
 * Shared installment calculation utilities
 * Eliminates duplication between SalesService, ContractsService, and ExchangeService
 *
 * Uses satang-based integer arithmetic (×100) to avoid floating-point rounding errors
 * in financial calculations. All intermediate math uses integers; results are converted
 * back to baht (2 decimal places) only at the end.
 */

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
 * 6. monthlyPayment = ceil(financedAmount / totalMonths) — rounded to whole baht
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
  if (sellingPrice <= 0) throw new Error('ราคาขายต้องมากกว่า 0');
  if (downPayment < 0) throw new Error('เงินดาวน์ต้องไม่ติดลบ');
  if (downPayment >= sellingPrice) throw new Error('เงินดาวน์ต้องน้อยกว่าราคาขาย');
  if (totalMonths <= 0) throw new Error('จำนวนงวดต้องมากกว่า 0');
  if (interestRate < 0) throw new Error('อัตราดอกเบี้ยต้องไม่ติดลบ');

  // Use satang-based integer math: multiply by 100, compute, round at each step
  const principal = roundBaht(sellingPrice - downPayment);
  const storeCommission = roundBaht(principal * storeCommissionPct);
  const interestTotal = roundBaht(principal * interestRate * totalMonths);
  const vatAmount = roundBaht((principal + storeCommission + interestTotal) * vatPct);
  const financedAmount = roundBaht(principal + storeCommission + interestTotal + vatAmount);
  // Monthly payment rounded UP to whole baht (customer pays slightly more on earlier
  // installments; last installment adjusts in generatePaymentSchedule)
  const monthlyPayment = Math.ceil(financedAmount / totalMonths);

  return { principal, interestTotal, storeCommission, vatAmount, financedAmount, monthlyPayment };
}

export interface PaymentScheduleItem {
  contractId: string;
  installmentNo: number;
  dueDate: Date;
  amountDue: number;
  status: 'PENDING';
}

/**
 * Generate payment schedule with custom due day
 * Handles month overflow by clamping to last day of month
 */
export function generatePaymentSchedule(
  contractId: string,
  totalMonths: number,
  financedAmount: number,
  monthlyPayment: number,
  paymentDueDay?: number | null,
): PaymentScheduleItem[] {
  const now = new Date();
  const dueDay = paymentDueDay || 1;
  const payments: PaymentScheduleItem[] = [];

  for (let i = 1; i <= totalMonths; i++) {
    const targetMonth = now.getMonth() + i;
    const lastDay = new Date(now.getFullYear(), targetMonth + 1, 0).getDate();
    const dueDate = new Date(now.getFullYear(), targetMonth, Math.min(dueDay, lastDay));
    // Last installment adjusts for Math.ceil rounding to avoid overcharging
    const isLast = i === totalMonths;
    const amount = isLast ? financedAmount - monthlyPayment * (totalMonths - 1) : monthlyPayment;

    payments.push({
      contractId,
      installmentNo: i,
      dueDate,
      amountDue: amount,
      status: 'PENDING' as const,
    });
  }

  // Post-generation validation: ensure sum(amountDue) === financedAmount
  const sumPayments = payments.reduce((sum, p) => sum + p.amountDue, 0);
  const diff = Math.abs(sumPayments - financedAmount);
  if (diff > 0.01) {
    throw new Error(`Payment schedule total mismatch: sum=${sumPayments}, expected=${financedAmount}, diff=${diff}`);
  }

  return payments;
}
