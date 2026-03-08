/**
 * Shared installment calculation utilities
 * Eliminates duplication between SalesService, ContractsService, and ExchangeService
 */

export interface InstallmentCalculation {
  principal: number;
  interestTotal: number;
  financedAmount: number;
  monthlyPayment: number;
}

/**
 * Calculate installment financials
 * Uses simple interest: interest = principal × rate × months
 * Monthly payment is ceiling'd, last installment adjusts to avoid overcharge
 */
export function calculateInstallment(
  sellingPrice: number,
  downPayment: number,
  interestRate: number,
  totalMonths: number,
): InstallmentCalculation {
  const principal = sellingPrice - downPayment;
  const interestTotal = principal * interestRate * totalMonths;
  const financedAmount = principal + interestTotal;
  const monthlyPayment = Math.ceil(financedAmount / totalMonths);

  return { principal, interestTotal, financedAmount, monthlyPayment };
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

  return payments;
}
