/**
 * Shared installment calculation utilities
 * Eliminates duplication between SalesService, ContractsService, and ExchangeService
 */

export interface InstallmentCalculation {
  principal: number;
  interestTotal: number;
  storeCommission: number;
  vatAmount: number;
  financedAmount: number;
  monthlyPayment: number;
}

/**
 * Calculate installment financials with full formula:
 * 1. principal (loanAmount) = sellingPrice - downPayment
 * 2. storeCommission = principal × storeCommissionPct
 * 3. interestTotal = principal × interestRate × totalMonths  (flat rate)
 * 4. vatAmount = (principal + storeCommission + interestTotal) × vatPct
 * 5. financedAmount = principal + storeCommission + interestTotal + vatAmount
 * 6. monthlyPayment = ceil(financedAmount / totalMonths)
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

  const principal = sellingPrice - downPayment;
  const storeCommission = principal * storeCommissionPct;
  const interestTotal = principal * interestRate * totalMonths;
  const vatAmount = (principal + storeCommission + interestTotal) * vatPct;
  const financedAmount = principal + storeCommission + interestTotal + vatAmount;
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

  return payments;
}
