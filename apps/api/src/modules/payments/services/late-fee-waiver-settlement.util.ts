import { ContractStatus, Payment, PaymentStatus, Prisma } from '@prisma/client';
import * as Sentry from '@sentry/node';
import { loadLateFeePaidByPaymentIds } from './payment-late-fee-paid.util';

/**
 * Shared settlement rules for the two standalone late-fee waiver paths:
 *   - payments/services/late-fee-waiver.service.ts  (payment-approval queue, one row)
 *   - late-fee-waiver/late-fee-waiver.service.ts    (collector request → manager approve, many rows)
 *
 * Receipts allocate cash FEE FIRST (split-receipt.ts): Cr 42-1103 is booked before
 * 11-2103 is cleared, so Payment.amountPaid mixes fee and principal. A waiver must
 * therefore read the fee actually collected from the ledger
 * (`loadLateFeePaidByPaymentIds`) instead of inferring it from the cumulative balance:
 *
 *   waivableFee        = max(0, lateFee − feePaid)       (never "waive" collected income)
 *   retainedLateFee    = lateFee − waivableFee           (the fee charge that remains)
 *   principalPaid      = max(0, amountPaid − feePaid)
 *   principalShortfall = max(0, amountDue − principalPaid)
 *   principalSettled   = principalShortfall = 0
 *
 * Stored on the Payment row: lateFee = retainedLateFee, waivedAmount = waivableFee,
 * lateFeeWaived = (retainedLateFee = 0). A fully waived fee keeps the invariant every
 * owed-amount reader relies on (`lateFeeWaived ⇒ lateFee = 0` — autoAllocate,
 * applyCreditBalance, pay-allocation, installmentOwed, feeNettedOutstanding). When part
 * of the fee was already collected, the charge is reduced to that collected part and
 * stays a real charge (lateFeeWaived = false): amountPaid still contains it, so every
 * reader computes `amountDue + lateFee − amountPaid` = the principal still owed.
 *
 * Tolerance: none. The receipt path's ≤1฿ close (PaymentReceiptTemplate TOLERANCE /
 * splitReceipt underpayRounding) is only allowed together with a Dr 52-1104 posting and
 * an approver/system-rounding certification; the receipt orchestrator's own settlement
 * decision is a strict `recordedAmountPaid ≥ amountDue`. A waiver posts no journal entry,
 * so it may only settle an installment whose principal is fully covered — a residual of
 * even 0.01 stays PARTIALLY_PAID for the receipt path to close.
 *
 * Rows without receipt fee entries (imported / legacy) have feePaid = 0 and therefore
 * settle exactly as before: amountPaid ≥ amountDue.
 */

type Money = Prisma.Decimal | string | number;

const ZERO = new Prisma.Decimal(0);
const dec = (v: Money | null | undefined) => new Prisma.Decimal(v ?? 0);

/**
 * Contract statuses in which an installment may be settled (status → PAID +
 * checkContractCompletion). Same set the receipt orchestrator accepts money for
 * (`recordPayment` / `autoAllocate` refuse every other status), so a waiver never
 * completes a TERMINATED / EXCHANGED / CLOSED_BAD_DEBT / … contract that the
 * receipt path itself could not touch. The fee write-down still applies there.
 */
export const WAIVER_SETTLEMENT_CONTRACT_STATUSES: readonly ContractStatus[] = [
  'ACTIVE',
  'OVERDUE',
  'DEFAULT',
];

/** T1-C9 — waivers above this amount (THB) raise a Sentry warning for finance review. */
export const LARGE_LATE_FEE_WAIVER_ALARM_THB = 5000;

export interface WaiverSettlementInput {
  amountDue: Money;
  amountPaid: Money;
  /** Stored Payment.lateFee before the waiver. */
  lateFee: Money;
  /** Net late fee the ledger shows as collected for this Payment (0 when none / legacy). */
  feePaid: Money;
}

export interface WaiverSettlement {
  feePaid: Prisma.Decimal;
  waivableFee: Prisma.Decimal;
  retainedLateFee: Prisma.Decimal;
  principalPaid: Prisma.Decimal;
  principalShortfall: Prisma.Decimal;
  principalSettled: boolean;
}

/** Pure — see the file header for the rules. */
export function computeWaiverSettlement(input: WaiverSettlementInput): WaiverSettlement {
  const lateFee = Prisma.Decimal.max(dec(input.lateFee), ZERO);
  const feePaid = Prisma.Decimal.max(dec(input.feePaid), ZERO);
  const waivableFee = Prisma.Decimal.max(lateFee.minus(feePaid), ZERO);
  const principalPaid = Prisma.Decimal.max(dec(input.amountPaid).minus(feePaid), ZERO);
  const principalShortfall = Prisma.Decimal.max(dec(input.amountDue).minus(principalPaid), ZERO);
  return {
    feePaid,
    waivableFee,
    retainedLateFee: lateFee.minus(waivableFee),
    principalPaid,
    principalShortfall,
    principalSettled: principalShortfall.lte(0),
  };
}

/**
 * Batch the ledger read for many rows. Same short-circuit as the receipt path's waiver
 * cap (payment-receipt-orchestrator): a row with nothing paid cannot have collected a fee.
 */
export async function loadWaiverSettlements(
  readClient: Pick<Prisma.TransactionClient, 'journalEntry'>,
  rows: ReadonlyArray<{ id: string; amountDue: Money; amountPaid: Money; lateFee: Money }>,
): Promise<Map<string, WaiverSettlement>> {
  const paidIds = rows.filter((r) => dec(r.amountPaid).gt(0)).map((r) => r.id);
  const feePaidById = paidIds.length
    ? await loadLateFeePaidByPaymentIds(readClient, paidIds)
    : new Map<string, Prisma.Decimal>();
  return new Map(
    rows.map((r) => [
      r.id,
      computeWaiverSettlement({ ...r, feePaid: feePaidById.get(r.id) ?? ZERO }),
    ]),
  );
}

/** Does this waiver settle the installment? Fully-paid principal on a collectable contract only. */
export function waiverSettlesInstallment(
  settlement: WaiverSettlement,
  paymentStatus: PaymentStatus,
  contractStatus: ContractStatus | null | undefined,
): boolean {
  return (
    settlement.principalSettled &&
    paymentStatus !== 'PAID' &&
    !!contractStatus &&
    WAIVER_SETTLEMENT_CONTRACT_STATUSES.includes(contractStatus)
  );
}

export interface ApplyLateFeeWaiverInput {
  payment: Pick<Payment, 'id' | 'status' | 'notes'>;
  settlement: WaiverSettlement;
  /** Result of `waiverSettlesInstallment` — the caller runs checkContractCompletion when true. */
  settles: boolean;
  waivedById: string;
  approverId: string;
  reason: string;
  waivedAt: Date;
  /** FeeWaiverApproval evidence (approver's IP / UA when the caller has them). */
  evidence?: { ipAddress?: string | null; userAgent?: string | null };
}

/**
 * Writes one waiver inside the caller's transaction: the Payment columns, the
 * immutable FeeWaiverApproval evidence row, and — only when the principal is
 * settled — PAID + paidDate. No journal entry: late fees are cash-basis, so the
 * uncollected portion being waived was never booked as income.
 */
export async function applyLateFeeWaiverInTx(
  tx: Prisma.TransactionClient,
  input: ApplyLateFeeWaiverInput,
) {
  const { payment, settlement, settles } = input;
  const waived = settlement.waivableFee.toDecimalPlaces(2);
  const notes = [
    payment.notes,
    `ยกเว้นค่าปรับ ${waived.toNumber().toLocaleString()} บาท — ${input.reason}`,
  ]
    .filter(Boolean)
    .join(' | ');

  const updated = await tx.payment.update({
    where: { id: payment.id },
    data: {
      lateFee: settlement.retainedLateFee,
      // true only when no fee charge remains (see header) — a partly collected fee
      // stays a real, already-paid charge.
      lateFeeWaived: settlement.retainedLateFee.lte(0),
      waivedById: input.waivedById,
      waivedAt: input.waivedAt,
      waivedReason: input.reason,
      waivedApprovedById: input.approverId,
      waivedAmount: waived,
      notes,
      ...(settles ? { status: 'PAID' as const, paidDate: input.waivedAt } : {}),
    },
  });

  // T3-C4: immutable approval evidence — survives any later mutation of the
  // Payment waiver columns.
  await tx.feeWaiverApproval.create({
    data: {
      waiverPaymentId: payment.id,
      approverId: input.approverId,
      ipAddress: input.evidence?.ipAddress ?? null,
      userAgent: input.evidence?.userAgent ?? null,
    },
  });

  return updated;
}

/** LATE_FEE_WAIVED audit `details` — identical shape for both paths. */
export function lateFeeWaivedAuditDetails(
  settlement: WaiverSettlement,
  originalLateFee: Prisma.Decimal,
  becameFullyPaid: boolean,
  extra: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...extra,
    wasFeeAmount: originalLateFee.toDecimalPlaces(2).toNumber(),
    feePaid: settlement.feePaid.toDecimalPlaces(2).toNumber(),
    waivedAmount: settlement.waivableFee.toDecimalPlaces(2).toNumber(),
    principalShortfall: settlement.principalShortfall.toDecimalPlaces(2).toNumber(),
    becameFullyPaid,
  };
}

/** T1-C9 — unusual-waiver alarm, same message/tags for both paths. */
export function alarmIfLargeLateFeeWaiver(
  amount: Prisma.Decimal,
  extra: Record<string, unknown>,
): void {
  if (amount.gt(LARGE_LATE_FEE_WAIVER_ALARM_THB)) {
    Sentry.captureMessage('Large late-fee waiver', {
      level: 'warning',
      tags: { kind: 'finance' },
      extra: { ...extra, amount: amount.toDecimalPlaces(2).toNumber() },
    });
  }
}
