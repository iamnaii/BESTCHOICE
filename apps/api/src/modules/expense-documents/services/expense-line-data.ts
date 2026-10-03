import { Prisma } from '@prisma/client';
import type { ExpenseLineInput } from '../dto/expense-line-input.dto';
import type { LineOutput } from './line-aggregator.service';

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

type PreparedPayrollLine = Pick<
  Prisma.PayrollLineUncheckedCreateWithoutPayrollInput,
  | 'userId'
  | 'employeeName'
  | 'employeeTaxId'
  | 'baseSalary'
  | 'ssoEmployee'
  | 'whtAmount'
  | 'netPaid'
> & {
  customIncome: Prisma.PayrollCustomIncomeCreateWithoutPayrollLineInput[];
  customDeduction: Prisma.PayrollCustomDeductionCreateWithoutPayrollLineInput[];
};

export function payrollLineCreateData(
  l: PreparedPayrollLine,
): Prisma.PayrollLineUncheckedCreateWithoutPayrollInput {
  return {
    userId: l.userId,
    employeeName: l.employeeName,
    employeeTaxId: l.employeeTaxId,
    baseSalary: l.baseSalary,
    ssoEmployee: l.ssoEmployee,
    whtAmount: l.whtAmount,
    netPaid: l.netPaid,
    customIncome: l.customIncome.length > 0 ? { create: l.customIncome } : undefined,
    customDeduction: l.customDeduction.length > 0 ? { create: l.customDeduction } : undefined,
  };
}
