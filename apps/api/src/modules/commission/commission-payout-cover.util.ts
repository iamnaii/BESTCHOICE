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
