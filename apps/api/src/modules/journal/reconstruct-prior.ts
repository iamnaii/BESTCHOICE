import { Decimal } from '@prisma/client/runtime/library';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Reconstruct prior cleared amounts for an installment from its own prior JE lines.
 * Shared by PaymentReceiptTemplate (posting) and PaymentJournalPreviewService
 * (PARTIAL preview) so preview == posted allocation for any receipt sequence.
 *
 * Phase 2: matched only `tag:'receipt'` entries.
 * Phase 3 (PR-843/I2 Option A — widen reconstruction): also matches `tag:'2B'` entries
 * so that a legacy partial posted by the OLD non-split PaymentReceipt2BTemplate is not
 * invisible to the primitive.  A legacy 2B JE carries:
 *   metadata: { tag:'2B', contractId, installmentScheduleId, paymentId }  (NO partial/final flag)
 *
 * Discriminator (guards against over-inclusion):
 *   - tag:'receipt' → always include (primitive's own JEs).
 *   - tag:'2B' with flow:'advance-consume-on-accrual' → ALWAYS include. The 2A
 *                    accrual cron posts `Dr 21-1103 / Cr 11-2103 = consume` to clear
 *                    the receivable from a parked advance. Its Cr 11-2103 is a REAL
 *                    prior-clearing and MUST be counted — even when consume ==
 *                    installmentTotal (a full consume). Excluding a full consume here
 *                    let a subsequent receipt double-credit 11-2103 (FINAL-REVIEW
 *                    BLOCKER 1): the receipt would clear the full installmentTotal
 *                    AGAIN → Σ(Cr 11-2103) = 2×installmentTotal.
 *   - tag:'2B' (legacy full-payment receipt, flow != advance-consume-on-accrual)
 *                  → include ONLY when Cr 11-2103 on that entry is STRICTLY LESS THAN
 *                    installmentTotal.  A full-clear legacy 2B credits exactly
 *                    installmentTotal; including it would set priorPrincipalCleared =
 *                    installmentTotal and silently make principalRemaining = 0,
 *                    rejecting any subsequent receipt. Using strict-less-than (no float
 *                    equality) is safe: installmentTotal is a Decimal from
 *                    computeInstallmentBreakdown, and the historical JE credit is also a
 *                    Decimal stored in Postgres — comparison is exact.
 *
 * Historical JEs are never mutated (Option A = read-side only).
 */
export async function reconstructPriorCleared(
  readClient: Prisma.TransactionClient | PrismaService,
  installmentScheduleId: string,
  installmentTotal: Decimal,
): Promise<{ priorPrincipalCleared: Decimal; priorLateFeeBooked: Decimal }> {
  const entries = await readClient.journalEntry.findMany({
    where: {
      AND: [
        {
          OR: [
            { metadata: { path: ['tag'], equals: 'receipt' } } as any,
            { metadata: { path: ['tag'], equals: '2B' } } as any,
          ],
        },
        {
          metadata: { path: ['installmentScheduleId'], equals: installmentScheduleId },
        } as any,
      ],
    },
    include: { lines: true },
  });
  let priorPrincipalCleared = new Decimal(0);
  let priorLateFeeBooked = new Decimal(0);
  for (const e of entries) {
    const meta = e.metadata as any;
    // Un-pay fix (2026-07-08): ReceiptVoidReversalTemplate stamps
    // `metadata.reversed=true` on every original it mirrors (receipt void +
    // refund reversal). A reversed original is no longer a real prior-clear —
    // counting it kept a voided/refunded installment "cleared" so the next
    // receipt under-cleared 11-2103 or threw "งวดนี้ถูกชำระครบแล้ว".
    if (meta?.reversed === true) continue;
    const tag: string = meta?.tag ?? '';
    if (tag === '2B') {
      const flowMeta: string = (meta?.flow as string) ?? '';
      if (flowMeta !== 'advance-consume-on-accrual') {
        // Legacy PaymentReceipt2B full-payment JE: keep the full-clear discriminator
        // (a one-shot full clear == installmentTotal must NOT be counted as a prior
        // partial — including it would set priorPrincipalCleared = installmentTotal and
        // silently make principalRemaining = 0, rejecting any subsequent receipt).
        const entryCr11 = e.lines
          .filter((l) => l.accountCode === '11-2103')
          .reduce((s, l) => s.plus(new Decimal(l.credit.toString())), new Decimal(0));
        // Only partial-clear legacy 2B JEs are included; full-clear JEs (cr == installmentTotal) are excluded.
        if (!entryCr11.lt(installmentTotal)) continue;
      }
      // advance-consume-on-accrual JEs: ALWAYS included — their Cr 11-2103 IS prior-cleared
      // (Dr 21-1103 advance / Cr 11-2103). Excluding a full consume == installmentTotal here
      // would let a subsequent receipt double-credit 11-2103 (FINAL-REVIEW BLOCKER 1).
    }
    for (const l of e.lines) {
      const cr = new Decimal(l.credit.toString());
      if (l.accountCode === '11-2103') priorPrincipalCleared = priorPrincipalCleared.plus(cr);
      else if (l.accountCode === '42-1103') priorLateFeeBooked = priorLateFeeBooked.plus(cr);
    }
  }
  return { priorPrincipalCleared, priorLateFeeBooked };
}
