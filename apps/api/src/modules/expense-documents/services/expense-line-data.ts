import { Prisma } from '@prisma/client';
import type { ExpenseLineInput } from '../dto/expense-line-input.dto';
import type { LineOutput } from './line-aggregator.service';
import type { SavedPayrollLine } from '../payroll-system/payroll-save';

type PreparedExpenseLine = ExpenseLineInput & LineOutput & { lineNo: number };

// Persistence mapping only: validation and Decimal calculations stay with the caller.
export function expenseLineCreateData(
  l: PreparedExpenseLine,
): Prisma.ExpenseLineCreateWithoutExpenseDetailInput {
  return {
    lineNo: l.lineNo,
    category: l.category,
    description: l.description ?? null,
    quantity: new Prisma.Decimal(l.quantity),
    unitPrice: new Prisma.Decimal(l.unitPrice),
    discount: new Prisma.Decimal(l.discount ?? 0),
    vatPercent: new Prisma.Decimal(l.vatPercent ?? 0),
    whtPercent: new Prisma.Decimal(l.whtPercent ?? 0),
    whtFormType: l.whtFormType ?? null,
    amountBeforeVat: l.amountBeforeVat,
    vatAmount: l.vatAmount,
    whtAmount: l.whtAmount,
    taxDisallowed: l.taxDisallowed ?? false,
  };
}

// Payroll D4 — บรรทัดที่รวมแถวระบบแล้ว (payroll-system/payroll-save.ts) · JSON snapshot เก็บตามที่ compute คืน ·
// ส่วนที่ 2: รายการหักเก็บ `source` (MANUAL / COMMISSION_CLAWBACK) + รายการค่าคอม PAY/CLAWBACK ของบรรทัด (ยังมีผล — releasedAt ว่าง)
export function payrollLineCreateData(
  l: SavedPayrollLine,
): Prisma.PayrollLineUncheckedCreateWithoutPayrollInput {
  return {
    userId: l.userId,
    employeeName: l.employeeName,
    employeeTaxId: l.employeeTaxId,
    baseSalary: l.baseSalary,
    ssoEmployee: l.ssoEmployee,
    whtAmount: l.whtAmount,
    netPaid: l.netPaid,
    lineNo: l.lineNo,
    systemPulledAt: l.systemPulledAt,
    // interface → InputJsonObject ไม่มี index signature ⇒ cast ที่ขอบเก็บข้อมูลเท่านั้น · null = ไม่เขียน (คอลัมน์ว่าง)
    attendanceSummary: l.attendanceSummary ? (l.attendanceSummary as unknown as Prisma.InputJsonObject) : undefined,
    systemNotes: l.systemNotes ? (l.systemNotes as unknown as Prisma.InputJsonObject) : undefined,
    customIncome: l.customIncome.length > 0 ? { create: l.customIncome } : undefined,
    customDeduction: l.customDeduction.length > 0 ? { create: l.customDeduction } : undefined,
    commissionItems: l.commissionItems.length > 0 ? { create: l.commissionItems } : undefined,
  };
}
