import Decimal from 'decimal.js';

export interface ApprovedContractLimit {
  id: string;
  approvedMonthlyPayment: number | string;
  salaryPayDay: number;
  usedByContractId: string | null;
  supersededAt: string | null;
}
export interface ContractCreditPlan {
  monthlyPayment: number;
  financedAmount: number;
  totalMonths: number;
  paymentDueDay: number;
}
export function contractCreditIssue(approval: ApprovedContractLimit | null | undefined, plan: ContractCreditPlan) {
  if (!approval || approval.supersededAt) return 'กรุณาอนุมัติยอดผ่อนจากหน้าตรวจเครดิตก่อนสร้างสัญญา';
  if (approval.usedByContractId) return 'ผลอนุมัตินี้ถูกใช้กับสัญญาแล้ว กรุณาประเมินใหม่';
  if (approval.salaryPayDay !== plan.paymentDueDay) return 'วันชำระต้องตรงกับวันเงินเดือนในผลอนุมัติ';
  if (!Number.isInteger(plan.totalMonths) || plan.totalMonths < 1 ||
    !Number.isFinite(plan.monthlyPayment) || !Number.isFinite(plan.financedAmount)) return 'กรุณาระบุแผนผ่อนให้ครบ';
  const finalAmount = new Decimal(plan.financedAmount).minus(new Decimal(plan.monthlyPayment).mul(plan.totalMonths - 1)).toDecimalPlaces(2);
  const cap = new Decimal(approval.approvedMonthlyPayment);
  if (cap.lte(0) || finalAmount.lte(0) || plan.monthlyPayment <= 0 ||
    finalAmount.gt(cap) || new Decimal(plan.monthlyPayment).gt(cap)) return 'ค่างวดเกินยอดอนุมัติ กรุณาปรับเงินดาวน์หรือแผนผ่อน';
  return null;
}

export function contractCreditSchedule(plan: ContractCreditPlan, now = new Date()) {
  if (!Number.isInteger(plan.totalMonths) || plan.totalMonths < 1 || plan.totalMonths > 120) return [];
  return Array.from({ length: plan.totalMonths }, (_, index) => {
    const month = now.getMonth() + index + 1;
    const lastDay = new Date(now.getFullYear(), month + 1, 0).getDate();
    return { installmentNo: index + 1,
      dueDate: new Date(now.getFullYear(), month, Math.min(plan.paymentDueDay, lastDay)),
      amount: index === plan.totalMonths - 1
        ? new Decimal(plan.financedAmount).minus(new Decimal(plan.monthlyPayment).mul(plan.totalMonths - 1)).toDecimalPlaces(2).toNumber()
        : plan.monthlyPayment };
  });
}
