import { PayoutStatus } from '@prisma/client';

/**
 * Legacy payout rounds that do NOT tie money to their commissions (P2-R27 — the one list for every
 * reader: payroll commission state, sale void G4b, contract cancellation, credit-return cleanup).
 * `DRAFT` — not approved yet (the readers that clean up delete it in their own tx) · `CANCELLED` —
 * void. Every other status counts as locked, so a status added to the enum later blocks by default.
 */
export const UNPAID_PAYOUT_STATUSES: readonly PayoutStatus[] = [PayoutStatus.DRAFT, PayoutStatus.CANCELLED];

/** A payout round in a status that ties money to the commissions it covers (anything but DRAFT / CANCELLED). */
export function isLockedPayout(p: { status: PayoutStatus }): boolean {
  return !UNPAID_PAYOUT_STATUSES.includes(p.status);
}

/**
 * Does a legacy monthly payout round (`CommissionPayout`) count this commission?
 *
 * One rule for every reader (sale void G4b, credit-return cleanup, contract cancellation, and the
 * payroll commission compute in Part 2): same salesperson and period, and the round was generated at
 * or after the commission was created. `generatePayouts` never recomputed an existing round, so a
 * commission created after `generatedAt` was never in its total. `generatedAt = null` is a round from
 * before the column existed: it cannot be proven otherwise, so it counts as covering.
 */
export function isCoveredByPayout(
  c: { salespersonId: string; period: string; createdAt: Date },
  p: { salespersonId: string; period: string; generatedAt: Date | null },
): boolean {
  return (
    c.salespersonId === p.salespersonId &&
    c.period === p.period &&
    (p.generatedAt === null || c.createdAt <= p.generatedAt)
  );
}
