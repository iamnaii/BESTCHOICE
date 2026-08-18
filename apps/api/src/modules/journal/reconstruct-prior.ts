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
 *   - tag:'2B' whose `flow` is in `ALWAYS_INCLUDED_2B_FLOWS` → ALWAYS include.
 *                    These are the 21-1103-relief JEs posted by
 *                    InstallmentAccrual2ATemplate (`Dr 21-1103 / Cr 11-2103 =
 *                    consume`) — BOTH of them:
 *                      • `advance-consume-on-accrual`  — generic FIFO advance bucket
 *                        (`Contract.advanceBalance`), relieved on EVERY installment.
 *                      • `reschedule-park-consume`     — last-installment park bucket
 *                        (`Contract.rescheduleAdvanceBalance`, owner directive
 *                        2026-08-16), relieved ONLY on the contract's last installment.
 *                    Their Cr 11-2103 is a REAL prior-clearing and MUST be counted —
 *                    even when the consume == installmentTotal (a FULL consume, which
 *                    is the park bucket's headline case: a multi-reschedule contract
 *                    routinely parks more than one installment's worth). Excluding a
 *                    full consume here let a subsequent receipt double-credit 11-2103
 *                    (FINAL-REVIEW BLOCKER 1): the receipt would clear the full
 *                    installmentTotal AGAIN → Σ(Cr 11-2103) = 2×installmentTotal.
 *                    ANY future `tag:'2B'` 21-1103-relief flow must be added to that
 *                    constant — the legacy fallback below silently drops a full clear.
 *   - tag:'2B' (legacy full-payment receipt, flow not in the allow-list)
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
/**
 * `metadata.flow` of the generic-advance relief JE posted by
 * InstallmentAccrual2ATemplate (`Contract.advanceBalance`, FIFO into whichever
 * installment accrues next).
 */
export const ADVANCE_CONSUME_ON_ACCRUAL_FLOW = 'advance-consume-on-accrual';

/**
 * `metadata.flow` of the last-installment park relief JE posted by
 * InstallmentAccrual2ATemplate (`Contract.rescheduleAdvanceBalance` — ค่าปรับดิว
 * พักงวดสุดท้าย, owner directive 2026-08-16).
 */
export const RESCHEDULE_PARK_CONSUME_FLOW = 'reschedule-park-consume';

/**
 * SINGLE SOURCE OF TRUTH for "`tag:'2B'` entries whose Cr 11-2103 is a real
 * prior-clearing and must ALWAYS be counted, full clear included".
 *
 * Every 21-1103 → 11-2103 relief JE that InstallmentAccrual2ATemplate posts
 * belongs here. Registering a new such flow ONLY in the template (and not here)
 * reintroduces FINAL-REVIEW BLOCKER 1: the legacy `!entryCr11.lt(installmentTotal)`
 * fallback drops a full clear, and the next receipt on that installment credits
 * 11-2103 a second time. The 2A template imports these same constants so the two
 * files can never drift on the literal string.
 */
export const ALWAYS_INCLUDED_2B_FLOWS: readonly string[] = [
  ADVANCE_CONSUME_ON_ACCRUAL_FLOW,
  RESCHEDULE_PARK_CONSUME_FLOW,
];

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
      if (!ALWAYS_INCLUDED_2B_FLOWS.includes(flowMeta)) {
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
      // ALWAYS_INCLUDED_2B_FLOWS JEs (advance-consume-on-accrual + reschedule-park-consume):
      // ALWAYS included — their Cr 11-2103 IS prior-cleared (Dr 21-1103 advance/park /
      // Cr 11-2103). Excluding a full consume == installmentTotal here would let a
      // subsequent receipt double-credit 11-2103 (FINAL-REVIEW BLOCKER 1).
    }
    for (const l of e.lines) {
      const cr = new Decimal(l.credit.toString());
      if (l.accountCode === '11-2103') priorPrincipalCleared = priorPrincipalCleared.plus(cr);
      else if (l.accountCode === '42-1103') priorLateFeeBooked = priorLateFeeBooked.plus(cr);
    }
  }
  return { priorPrincipalCleared, priorLateFeeBooked };
}
