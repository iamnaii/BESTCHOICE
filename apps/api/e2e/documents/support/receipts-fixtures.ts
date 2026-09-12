import type { INestApplication } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { ContractActivation1ATemplate } from '../../../src/modules/journal/cpa-templates/contract-activation-1a.template';
import { computeInstallmentBreakdown } from '../../../src/modules/journal/compute-installment-breakdown';
import {
  PAYMENT_APPROVAL_PERMISSIONS_KEY,
  parsePaymentApprovalPermissions,
  type PaymentApprovalPermission,
} from '../../../src/modules/payments/services/payment-approval-permissions';
import { TEST_DOC_PREFIX, TEST_NAME_PREFIX } from '../../../src/utils/test-data-markers';

/**
 * Money shape shared with the CPA golden case (journal/__tests__/scenario-helpers
 * seedStandard17k12m): 12,000 device, 2,000 down, 10,000 financed, 1,000 store
 * commission, 6,000 interest, 1,190 VAT → 12 × 1,515.83 (ROUND_DOWN basis).
 */
export const STANDARD_17K_12M = {
  sellingPrice: '12000.00',
  downPayment: '2000.00',
  financedAmount: '10000.00',
  storeCommission: '1000.00',
  interestTotal: '6000.00',
  vatAmount: '1190.00',
  vatPct: '0.0700',
  interestRate: '0.6000',
  months: 12,
} as const;

export interface FinancedContract {
  id: string;
  contractNumber: string;
  productId: string;
  branchId: string;
  customerId: string;
  months: number;
  installmentTotal: Prisma.Decimal;
  dueDates: Date[];
}

/** Exact per-installment total the receipt orchestrator expects (matches Payment.amountDue). */
export function standardInstallmentTotal(): Prisma.Decimal {
  const breakdown = computeInstallmentBreakdown({
    financedAmount: STANDARD_17K_12M.financedAmount,
    storeCommission: STANDARD_17K_12M.storeCommission,
    interestTotal: STANDARD_17K_12M.interestTotal,
    vatAmount: STANDARD_17K_12M.vatAmount,
    totalMonths: STANDARD_17K_12M.months,
  });
  return new Prisma.Decimal(breakdown.installmentTotal.toString());
}

export interface FinancedContractInput {
  prefix: string;
  label: string;
  branchId: string;
  customerId: string;
  salespersonId: string;
  /** Due date of installment 1; defaults to the 5th of next month so nothing is overdue. */
  firstDueDate?: Date;
}

function nextMonthDay(day: number): Date {
  const date = new Date();
  date.setDate(1);
  date.setMonth(date.getMonth() + 1);
  date.setDate(day);
  date.setHours(0, 0, 0, 0);
  return date;
}

/**
 * ACTIVE FINANCE contract with 12 installment_schedule rows AND 12 Payment rows
 * (the orchestrator books receipts against Payment.amountDue). Call
 * `activateContract` afterwards so the 1A activation journal exists — the
 * payment/receipt templates reconstruct prior postings from it.
 */
export async function createFinancedContract(prisma: PrismaService, input: FinancedContractInput): Promise<FinancedContract> {
  const money = STANDARD_17K_12M;
  const installmentTotal = standardInstallmentTotal();
  const product = await prisma.product.create({ data: {
    name: `${TEST_NAME_PREFIX} iPhone ใบเสร็จ ${input.label} ${input.prefix}`, brand: 'Apple', model: 'iPhone (ทดสอบระบบ)', category: 'PHONE_NEW',
    branchId: input.branchId, costPrice: '8000', cashPrice: money.sellingPrice, installmentPrice: money.sellingPrice,
    imeiSerial: `${TEST_DOC_PREFIX}${input.prefix}-RC-${input.label}`, status: 'IN_STOCK',
  } });
  const contract = await prisma.contract.create({ data: {
    contractNumber: `${TEST_DOC_PREFIX}${input.prefix}-RC-${input.label}`, customerId: input.customerId, productId: product.id,
    branchId: input.branchId, salespersonId: input.salespersonId, planType: 'STORE_WITH_INTEREST',
    sellingPrice: money.sellingPrice, downPayment: money.downPayment, financedAmount: money.financedAmount, interestRate: money.interestRate,
    totalMonths: money.months, interestTotal: money.interestTotal, storeCommission: money.storeCommission, vatAmount: money.vatAmount,
    vatPct: money.vatPct, monthlyPayment: installmentTotal.toFixed(2), status: 'ACTIVE',
  } });
  const principal = new Prisma.Decimal(money.financedAmount).div(money.months).toDecimalPlaces(2);
  const interest = new Prisma.Decimal(money.interestTotal).div(money.months).toDecimalPlaces(2);
  const vat = new Prisma.Decimal(money.vatAmount).div(money.months).toDecimalPlaces(2);
  const first = input.firstDueDate ?? nextMonthDay(5);
  const dueDates: Date[] = [];
  for (let installmentNo = 1; installmentNo <= money.months; installmentNo += 1) {
    const dueDate = new Date(first);
    dueDate.setMonth(first.getMonth() + installmentNo - 1);
    dueDates.push(dueDate);
    await prisma.installmentSchedule.create({ data: { contractId: contract.id, installmentNo, dueDate, principal, interest, amountDue: principal.plus(interest).plus(vat) } });
    await prisma.payment.create({ data: { contractId: contract.id, installmentNo, dueDate, amountDue: installmentTotal.toFixed(2), amountPaid: 0, status: 'PENDING' } });
  }
  return { id: contract.id, contractNumber: contract.contractNumber, productId: product.id, branchId: input.branchId, customerId: input.customerId, months: money.months, installmentTotal, dueDates };
}

/** Posts the real 1A activation journal through the application's own template. */
export async function activateContract(app: INestApplication, contractId: string): Promise<{ entryNumber: string }> {
  return app.get(ContractActivation1ATemplate).execute(contractId);
}

/**
 * Same mechanism the admin UI uses (SystemConfig `payment_approval_permissions`):
 * grants stay for the rest of the disposable database, so approvals in later
 * scenarios keep working without touching the row again.
 */
export async function grantApprovalPermissions(prisma: PrismaService, userId: string, permissions: PaymentApprovalPermission[]): Promise<void> {
  const previous = await prisma.systemConfig.findUnique({ where: { key: PAYMENT_APPROVAL_PERMISSIONS_KEY } });
  const assignments = parsePaymentApprovalPermissions(previous?.deletedAt ? null : previous?.value);
  assignments[userId] = [...new Set([...(assignments[userId] ?? []), ...permissions])];
  await prisma.systemConfig.upsert({
    where: { key: PAYMENT_APPROVAL_PERMISSIONS_KEY },
    update: { value: JSON.stringify(assignments), deletedAt: null },
    create: { key: PAYMENT_APPROVAL_PERMISSIONS_KEY, value: JSON.stringify(assignments) },
  });
}
