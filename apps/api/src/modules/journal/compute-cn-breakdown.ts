import { Prisma, PrismaClient, PaymentStatus } from '@prisma/client';
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
  /**
   * ACCRUED fallback anchor (final-review C1, 2026-07-26) — when an accrued
   * installment has NO matching `Payment` row (should not happen in practice;
   * `Payment` rows are created upfront for every installment at contract
   * creation — see `contract-lifecycle.service.ts`), `daysOverdue` would
   * otherwise be null even though the installment IS aged. Falls back to this
   * field so an ACCRUED row is never silently un-datable. Optional because
   * existing preloaded arrays / test fixtures never populated it before this
   * field existed.
   */
  dueDate?: Date | string | null;
}

/** Minimal payment shape this util needs — a subset of Payment. */
export interface CnPaymentInput {
  installmentNo: number;
  status: string;
  amountDue: DecimalInput;
  amountPaid: DecimalInput;
  /**
   * Raw late fee owed on this installment (FEE-FIRST convention, PR #1313 —
   * `Payment.lateFee` is NOT reset after a partial receipt; it always holds
   * the full fee owed for the installment). Optional/nullable so preloaded
   * arrays from older call sites (or test fixtures) that omit it default to
   * "no fee" rather than throwing.
   */
  lateFee?: DecimalInput | null;
  /** Mirrors `Payment.lateFeeWaived` — a waived fee never consumes cash. */
  lateFeeWaived?: boolean | null;
  /**
   * Installment due date — canonical aging anchor for both DUE (ECL) and
   * ACCRUED (CN, informational only) selections in
   * `computeInstallmentOutstanding`. Optional because CN's existing preloaded
   * arrays / test fixtures never populated it before this field existed; DUE
   * selection cannot age or filter a payment that has no dueDate (it is
   * defensively excluded — real `Payment` rows always carry one).
   */
  dueDate?: Date | string | null;
  /**
   * Soft-delete marker (I1, final-review 2026-07-26). A preloaded array is
   * not guaranteed to already exclude soft-deleted rows — both selections
   * filter it out defensively in addition to the `deletedAt: null` clause on
   * their own default DB queries. `undefined` (field never selected/present)
   * counts as "live", matching every existing preloaded array that predates
   * this field.
   */
  deletedAt?: Date | string | null;
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
  /** Full per-installment cash amount (excl+incl VAT) — same as
   *  `computeInstallmentBreakdown(...).installmentTotal`. Exposed so callers
   *  (e.g. `CreditNoteDocumentService`) can flag pro-rated rows without
   *  re-deriving the breakdown themselves. */
  installmentTotal: Decimal;
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

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * FEE-FIRST net-out (I1, final-review) — the single copy of the fee-netted
 * outstanding formula. `Payment.amountPaid` is GROSS cash including any late
 * fee collected (PR #1313 convention: `lateFee` is never reset after a
 * partial receipt), so the fee portion must be stripped before comparing
 * against `amountDue` (which never includes the fee). Clamped to
 * `[0, installmentTotal]`.
 *
 *   netFee       = lateFeeWaived ? 0 : lateFee
 *   feeCollected = min(amountPaid, netFee)
 *   baseCash     = amountPaid − feeCollected
 *   outstanding  = clamp(amountDue − baseCash, 0, installmentTotal)
 *
 * Shared verbatim by both selection paths of `computeInstallmentOutstanding`
 * (DUE for ECL, ACCRUED for CN) per the 2026-07-26 ECL-per-installment plan's
 * Global Constraints — this formula must never be re-derived independently.
 */
function feeNettedOutstanding(
  payment: Pick<CnPaymentInput, 'amountDue' | 'amountPaid' | 'lateFee' | 'lateFeeWaived'>,
  installmentTotal: Decimal,
): Decimal {
  const zero = new Decimal(0);
  const due = new Decimal(payment.amountDue);
  const paid = new Decimal(payment.amountPaid);
  const netFee = payment.lateFeeWaived ? zero : new Decimal(payment.lateFee ?? 0);
  const feeCollected = Decimal.min(paid, netFee);
  const baseCash = paid.minus(feeCollected);
  const outstanding = Decimal.max(zero, due.minus(baseCash));
  return Decimal.min(outstanding, installmentTotal);
}

/**
 * Exhaustive allow-list (NOT `status !== 'PAID'`) of `Payment.status` values
 * that count as "still due" for ECL/DUE selection. The `satisfies
 * Record<PaymentStatus, boolean>` forces this object to list EVERY member of
 * the enum — if a 5th `PaymentStatus` (e.g. CANCELLED/REFUNDED) is ever added
 * to schema.prisma, this line fails to compile instead of silently letting
 * the new status flow into the ECL base as "due". That forces a deliberate
 * yes/no decision at the call site instead of an accidental default.
 */
const DUE_STATUS_MAP = {
  PENDING: true,
  PARTIALLY_PAID: true,
  OVERDUE: true,
  PAID: false,
} satisfies Record<PaymentStatus, boolean>;

const DUE_STATUSES = (Object.keys(DUE_STATUS_MAP) as PaymentStatus[]).filter(
  (s) => DUE_STATUS_MAP[s],
);

function isDueStatus(status: string): boolean {
  return DUE_STATUS_MAP[status as PaymentStatus] === true;
}

export type InstallmentOutstandingSelection = 'DUE' | 'ACCRUED';

export interface InstallmentOutstandingRow {
  installmentNo: number;
  /** From the matching `Payment.dueDate` — null when no Payment row exists (ACCRUED only). */
  dueDate: Date | null;
  /** Fee-netted outstanding for this installment — see `feeNettedOutstanding`. */
  outstanding: Decimal;
  /** floor((asOf − dueDate) / 1 day) — null when `dueDate` is null. */
  daysOverdue: number | null;
  installmentTotal: Decimal;
  vatPerInst: Decimal;
}

export interface InstallmentOutstandingPreloaded {
  /** ACCRUED only — ignored for DUE (DUE is Payment-row-driven and does NOT
   *  require accrual to have run; see selection doc below). */
  installments?: CnInstallmentInput[];
  /** Payment rows for the contract. Does not need to be pre-filtered — the
   *  engine applies the selection-specific filter itself, so one preload
   *  (e.g. "all payments for this contract") can serve both a DUE and an
   *  ACCRUED call without re-querying. */
  payments?: CnPaymentInput[];
}

export interface ComputeInstallmentOutstandingOpts {
  selection: InstallmentOutstandingSelection;
  /** Reference "now" for DUE's `dueDate < asOf` filter + both paths'
   *  `daysOverdue`. Defaults to `new Date()`. */
  asOf?: Date;
  preloaded?: InstallmentOutstandingPreloaded;
}

export interface InstallmentOutstandingResult {
  rows: InstallmentOutstandingRow[];
}

/**
 * Central "installment outstanding" engine (spec §2.1,
 * docs/superpowers/specs/2026-07-26-ecl-per-installment-design.md) — single
 * source of truth for "how much is still owed on installment `i`, and how
 * old is it" feeding BOTH per-installment ECL (`selection: 'DUE'`) and the CN
 * pro-rate util (`selection: 'ACCRUED'`, via `computeCnBreakdown` below).
 *
 * Two selections, deliberately different universes:
 *
 * - **ACCRUED** (CN, ม.82/5): iterates `InstallmentSchedule` rows with
 *   `accrualJournalEntryId != null`. Unpaid = no `Payment` row with
 *   `status = 'PAID'`. No Payment row at all → installment never touched →
 *   fully outstanding (`outstanding = installmentTotal`). This is the
 *   pre-existing CN definition — unchanged.
 * - **DUE** (ECL): iterates `Payment` rows directly —
 *   `status != 'PAID' AND dueDate < asOf` (same universe
 *   `calculateProvisions` has always queried: PENDING/PARTIALLY_PAID/OVERDUE).
 *   Deliberately does NOT require accrual to have run — resilience to the
 *   2A cron missing a day (spec §2.1 rationale: ECL must not go blind just
 *   because the accrual leg is late). A Payment row that doesn't exist yet
 *   contributes nothing (there is nothing to iterate).
 *
 * Both selections reuse `feeNettedOutstanding` verbatim and drop rows whose
 * outstanding resolves to `<= 0` (fully covered, including the overpaid edge
 * case). `dueDate`/`daysOverdue` on ACCRUED rows are informational only (CN
 * never reads them) — null when the installment has no Payment row.
 *
 * `opts.preloaded` lets a caller that already queried the rows (JP5's
 * `buildJe`, `calculateProvisions`'s per-contract grouping) skip a
 * round-trip; the preloaded array is always re-filtered defensively (not
 * assumed to already match the selection's criteria) so one preload can
 * safely serve either selection.
 */
export async function computeInstallmentOutstanding(
  client: Prisma.TransactionClient | PrismaClient,
  contract: CnBreakdownContractInput,
  opts: ComputeInstallmentOutstandingOpts,
): Promise<InstallmentOutstandingResult> {
  const breakdown = computeInstallmentBreakdown({
    financedAmount: contract.financedAmount,
    storeCommission: contract.storeCommission,
    interestTotal: contract.interestTotal,
    vatAmount: contract.vatAmount,
    totalMonths: contract.totalMonths,
  } as InstallmentBreakdownInput);
  const { vatPerInst, installmentTotal } = breakdown;
  const asOf = opts.asOf ?? new Date();

  if (opts.selection === 'ACCRUED') {
    const allInstallments: CnInstallmentInput[] =
      opts.preloaded?.installments ??
      (await client.installmentSchedule.findMany({
        where: { contractId: contract.id, deletedAt: null, accrualJournalEntryId: { not: null } },
        select: { installmentNo: true, accrualJournalEntryId: true, dueDate: true },
      }));
    // Filter unconditionally (not just on the query path) — a preloaded array
    // passed via opts is not guaranteed to already be accrued-only.
    const accruedInstallments = allInstallments.filter((i) => i.accrualJournalEntryId !== null);

    const payments: CnPaymentInput[] =
      opts.preloaded?.payments ??
      (await client.payment.findMany({
        // I1 (final-review 2026-07-26): deletedAt: null — a soft-deleted
        // Payment row must never be treated as evidence of a real receipt.
        where: { contractId: contract.id, deletedAt: null },
        select: {
          installmentNo: true,
          status: true,
          amountDue: true,
          amountPaid: true,
          lateFee: true,
          lateFeeWaived: true,
          dueDate: true,
        },
      }));
    // Defensive filter (I1) — a preloaded array is not guaranteed to already
    // exclude soft-deleted rows the way the default query above does.
    // `Payment.installmentNo` is unique per contract (@@unique), so there is
    // at most one LIVE row per installmentNo after this filter — no orderBy
    // needed to pick "the" row.
    const paymentByInst = new Map(
      payments.filter((p) => !p.deletedAt).map((p) => [p.installmentNo, p]),
    );

    const rows: InstallmentOutstandingRow[] = [];
    for (const inst of accruedInstallments) {
      const payment = paymentByInst.get(inst.installmentNo);
      if (payment?.status === 'PAID') continue; // fully settled — not part of the CN

      // No Payment row at all → installment never touched → fully outstanding.
      const outstanding = payment
        ? feeNettedOutstanding(payment, installmentTotal)
        : installmentTotal;

      // Fully covered (incl. overpaid edge case) — no CN owed on this
      // installment. Drop the row entirely rather than keep a
      // zero-contribution row, so callers can count "installments actually owed".
      if (outstanding.lte(0)) continue;

      // dueDate anchor: prefer the Payment row's own dueDate; when no Payment
      // row exists at all (fully-outstanding branch above), fall back to the
      // InstallmentSchedule row's own dueDate (C1, final-review 2026-07-26) —
      // in practice every real installment always has a Payment row (created
      // upfront at contract creation, see contract-lifecycle.service.ts), so
      // this fallback is defensive rather than a normally-exercised path, but
      // it means an accrued installment is never silently un-datable just
      // because a caller's preloaded `installments` array lacks a matching
      // preloaded `payments` entry.
      const dueDate = payment?.dueDate
        ? new Date(payment.dueDate)
        : inst.dueDate
          ? new Date(inst.dueDate)
          : null;
      const daysOverdue = dueDate
        ? Math.floor((asOf.getTime() - dueDate.getTime()) / MS_PER_DAY)
        : null;

      rows.push({
        installmentNo: inst.installmentNo,
        dueDate,
        outstanding,
        daysOverdue,
        installmentTotal,
        vatPerInst,
      });
    }
    return { rows };
  }

  // selection === 'DUE' — Payment-row-driven, does NOT require accrual (see
  // jsdoc above). status != 'PAID' + dueDate < asOf, same universe
  // `calculateProvisions` has always scanned.
  const allPayments: CnPaymentInput[] =
    opts.preloaded?.payments ??
    (await client.payment.findMany({
      where: {
        contractId: contract.id,
        status: { in: DUE_STATUSES },
        dueDate: { lt: asOf },
        // I1 (final-review 2026-07-26): a soft-deleted Payment row must never
        // count toward the ECL DUE base.
        deletedAt: null,
      },
      select: {
        installmentNo: true,
        status: true,
        amountDue: true,
        amountPaid: true,
        lateFee: true,
        lateFeeWaived: true,
        dueDate: true,
      },
    }));

  const rows: InstallmentOutstandingRow[] = [];
  for (const payment of allPayments) {
    // Filter unconditionally — a preloaded array (e.g. the full unfiltered
    // payment set shared with an ACCRUED call) is not guaranteed to already
    // match DUE's status/dueDate criteria.
    if (!isDueStatus(payment.status)) continue;
    if (payment.deletedAt) continue; // I1 — defensive, mirrors the ACCRUED path's filter
    if (!payment.dueDate) continue; // defensive — real Payment rows always have dueDate
    const dueDate = new Date(payment.dueDate);
    if (!(dueDate.getTime() < asOf.getTime())) continue;

    const outstanding = feeNettedOutstanding(payment, installmentTotal);
    if (outstanding.lte(0)) continue;

    const daysOverdue = Math.floor((asOf.getTime() - dueDate.getTime()) / MS_PER_DAY);
    rows.push({
      installmentNo: payment.installmentNo,
      dueDate,
      outstanding,
      daysOverdue,
      installmentTotal,
      vatPerInst,
    });
  }
  return { rows };
}

/**
 * Single source of truth for CN (ใบลดหนี้ ม.82/5) pro-rated amounts — used by
 * BOTH the JE templates (RepossessionJP5Template, BadDebtWriteOffTemplate) and
 * `CreditNoteDocumentService` so the JE and the document can never drift apart.
 *
 * CPA ruling (2026-07-26 — docs/superpowers/plans/2026-07-26-cn-prorate-cpa.md,
 * Global Constraints). Per accrued-unpaid installment `i`:
 *
 *   netFee_i       = lateFeeWaived_i ? 0 : lateFee_i
 *   feeCollected_i = min(amountPaid_i, netFee_i)
 *   baseCash_i     = amountPaid_i − feeCollected_i
 *   outstanding_i  = clamp(amountDue_i − baseCash_i, 0, installmentTotal)
 *   cnVat_i        = (vatPerInst × outstanding_i / installmentTotal)
 *                      .toDecimalPlaces(2, ROUND_HALF_UP)
 *   cnBeforeVat_i  = outstanding_i − cnVat_i
 *
 * (2026-07-26, ECL-per-installment plan Task 1): this is now a thin wrapper
 * over `computeInstallmentOutstanding(client, contract, { selection: 'ACCRUED' })`
 * — the fee-netting/accrued-unpaid logic itself lives there and MUST NOT be
 * re-derived independently. Only the CN-specific VAT pro-rate + totals stay
 * here. Every golden below is preserved byte-for-byte through the refactor.
 *
 * Netting out the late fee (I1, final-review) is required because
 * `Payment.amountPaid` is GROSS cash including any late fee collected — the
 * house convention (FEE-FIRST, PR #1313) allocates cash to the fee before the
 * installment base. Without the net-out, a customer who paid mostly-fee would
 * look like they'd paid down more principal/interest/VAT than they actually
 * did, understating `outstanding` (and therefore `cnVat`). `amountDue` never
 * includes the fee, so it needs no adjustment.
 *
 * Rows whose `outstanding` resolves to `<= 0` (fully covered, including the
 * overpaid edge case where `baseCash > amountDue`) are DROPPED — not kept as
 * a zero-contribution row. `count` must reflect "installments a CN is
 * actually owed on" so callers (e.g. `CreditNoteDocumentService`'s
 * `SKIPPED_NO_ACCRUED` gate and its "N งวด" description) never claim a CN
 * covers an installment that in fact needs nothing reversed.
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
  const { installmentTotal } = breakdown;

  const { rows: outstandingRows } = await computeInstallmentOutstanding(client, contract, {
    selection: 'ACCRUED',
    preloaded: { installments: opts?.installments, payments: opts?.payments },
  });

  const zero = new Decimal(0);
  const rows: CnBreakdownRow[] = outstandingRows.map((r) => {
    const cnVat = r.installmentTotal.gt(0)
      ? r.vatPerInst
          .times(r.outstanding)
          .div(r.installmentTotal)
          .toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
      : zero;
    const cnBeforeVat = r.outstanding.minus(cnVat);
    return { installmentNo: r.installmentNo, outstanding: r.outstanding, cnVat, cnBeforeVat };
  });

  const totalOutstanding = rows.reduce((s, r) => s.plus(r.outstanding), zero);
  const totalCnVat = rows.reduce((s, r) => s.plus(r.cnVat), zero);
  const totalBeforeVat = rows.reduce((s, r) => s.plus(r.cnBeforeVat), zero);

  return {
    count: rows.length,
    totalOutstanding,
    totalCnVat,
    totalBeforeVat,
    rows,
    installmentTotal,
  };
}
