import { Prisma, PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import {
  computeInstallmentBreakdown,
  type InstallmentBreakdownInput,
} from './compute-installment-breakdown';

type DecimalInput = Decimal | string | number;

/** Minimal installment shape this util needs — a subset of InstallmentSchedule. */
export interface CnInstallmentInput {
  installmentNo: number;
  accrualJournalEntryId: string | null;
}

/** Minimal payment shape this util needs — a subset of Payment. */
export interface CnPaymentInput {
  installmentNo: number;
  status: string;
  amountDue: DecimalInput;
  amountPaid: DecimalInput;
}

export interface CnBreakdownRow {
  installmentNo: number;
  outstanding: Decimal;
  cnVat: Decimal;
  cnBeforeVat: Decimal;
}

export interface CnBreakdown {
  count: number;
  totalOutstanding: Decimal;
  totalCnVat: Decimal;
  totalBeforeVat: Decimal;
  rows: CnBreakdownRow[];
}

export interface CnBreakdownContractInput {
  id: string;
  totalMonths: number;
  financedAmount: DecimalInput;
  storeCommission: DecimalInput | null;
  interestTotal: DecimalInput;
  vatAmount: DecimalInput | null;
}

export interface CnBreakdownOpts {
  /** Preloaded accrued installments — caller (e.g. JP5) may already have these in memory. */
  installments?: CnInstallmentInput[];
  /** Preloaded payment rows for the contract. */
  payments?: CnPaymentInput[];
}

/**
 * Single source of truth for CN (ใบลดหนี้ ม.82/5) pro-rated amounts — used by
 * BOTH the JE templates (RepossessionJP5Template, BadDebtWriteOffTemplate) and
 * `CreditNoteDocumentService` so the JE and the document can never drift apart.
 *
 * CPA ruling (2026-07-26 — docs/superpowers/plans/2026-07-26-cn-prorate-cpa.md,
 * Global Constraints). Per accrued-unpaid installment `i`:
 *
 *   outstanding_i = clamp(amountDue_i − amountPaid_i, 0, installmentTotal)
 *   cnVat_i       = (vatPerInst × outstanding_i / installmentTotal)
 *                     .toDecimalPlaces(2, ROUND_HALF_UP)
 *   cnBeforeVat_i = outstanding_i − cnVat_i
 *
 * Totals are the SUM of the already-rounded per-installment rows (round
 * per-installment BEFORE summing — required to match the CPA golden: a
 * 515.83-outstanding installment on the 17k/12 fixture prices at cnVat 33.75,
 * not a naive round-after-sum result).
 *
 * "Accrued-unpaid" (identical definition to RepossessionJP5Template /
 * BadDebtWriteOffTemplate / CreditNoteDocumentService — see
 * .claude/rules/accounting.md "เอกสารใบลดหนี้"):
 *   - accrued  = `InstallmentSchedule.accrualJournalEntryId != null`
 *   - unpaid   = no `Payment` row with `status = 'PAID'` for that installmentNo
 *   - no Payment row at all → installment was never touched → fully outstanding
 *     (outstanding = installmentTotal, i.e. cnVat = vatPerInst exactly — this
 *     is the pre-existing "clean" case and must keep producing the same
 *     numbers it always has: 3 full installments on the 17k/12 fixture →
 *     totalCnVat 297.51 / totalOutstanding 4,547.49 / totalBeforeVat 4,249.98)
 *
 * `opts.installments` / `opts.payments` let a caller that already has the rows
 * in memory (JP5's `buildJe` loads both) skip the extra round-trip. When
 * omitted, this queries `installmentSchedule` (contractId, deletedAt null,
 * accrualJournalEntryId != null) + all `payment` rows for the contract.
 */
export async function computeCnBreakdown(
  client: Prisma.TransactionClient | PrismaClient,
  contract: CnBreakdownContractInput,
  opts?: CnBreakdownOpts,
): Promise<CnBreakdown> {
  const breakdown = computeInstallmentBreakdown({
    financedAmount: contract.financedAmount,
    storeCommission: contract.storeCommission,
    interestTotal: contract.interestTotal,
    vatAmount: contract.vatAmount,
    totalMonths: contract.totalMonths,
  } as InstallmentBreakdownInput);
  const { vatPerInst, installmentTotal } = breakdown;

  const allInstallments: CnInstallmentInput[] =
    opts?.installments ??
    (await client.installmentSchedule.findMany({
      where: { contractId: contract.id, deletedAt: null, accrualJournalEntryId: { not: null } },
      select: { installmentNo: true, accrualJournalEntryId: true },
    }));
  // Filter unconditionally (not just on the query path) — a preloaded array
  // passed via opts is not guaranteed to already be accrued-only.
  const accruedInstallments = allInstallments.filter((i) => i.accrualJournalEntryId !== null);

  const payments: CnPaymentInput[] =
    opts?.payments ??
    (await client.payment.findMany({
      where: { contractId: contract.id },
      select: { installmentNo: true, status: true, amountDue: true, amountPaid: true },
    }));
  const paymentByInst = new Map(payments.map((p) => [p.installmentNo, p]));

  const zero = new Decimal(0);
  const rows: CnBreakdownRow[] = [];

  for (const inst of accruedInstallments) {
    const payment = paymentByInst.get(inst.installmentNo);
    if (payment?.status === 'PAID') continue; // fully settled — not part of the CN

    let outstanding: Decimal;
    if (!payment) {
      // No Payment row at all → installment never touched → fully outstanding.
      outstanding = installmentTotal;
    } else {
      const due = new Decimal(payment.amountDue);
      const paid = new Decimal(payment.amountPaid);
      outstanding = Decimal.max(zero, due.minus(paid));
      outstanding = Decimal.min(outstanding, installmentTotal);
    }

    const cnVat = installmentTotal.gt(0)
      ? vatPerInst
          .times(outstanding)
          .div(installmentTotal)
          .toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
      : zero;
    const cnBeforeVat = outstanding.minus(cnVat);

    rows.push({ installmentNo: inst.installmentNo, outstanding, cnVat, cnBeforeVat });
  }

  const totalOutstanding = rows.reduce((s, r) => s.plus(r.outstanding), zero);
  const totalCnVat = rows.reduce((s, r) => s.plus(r.cnVat), zero);
  const totalBeforeVat = rows.reduce((s, r) => s.plus(r.cnBeforeVat), zero);

  return {
    count: rows.length,
    totalOutstanding,
    totalCnVat,
    totalBeforeVat,
    rows,
  };
}
