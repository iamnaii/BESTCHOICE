import { Prisma, PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

/**
 * GL balance for one account scoped to one contract, derived from POSTED
 * journal lines only (matches `JournalAutoService.createAndPost`'s
 * always-POSTED convention — no DRAFT/VOID rows ever flow through the
 * templates that read this).
 *
 * side='dr' → ΣDebit − ΣCredit  (asset accounts, e.g. 11-2101, 11-2103, 11-2105)
 * side='cr' → ΣCredit − ΣDebit  (contra-asset/liability accounts, e.g. 11-2102, 11-2106, 21-2102)
 *
 * Single source of truth extracted 2026-07-26 (ECL-per-installment plan, Task 5)
 * from three previously-independent copies of this exact query:
 *   - `BadDebtWriteOffTemplate`'s local `glBal` closure
 *   - `RepossessionJP5Template`'s inline provision-balance query
 *   - `BadDebtService.glBalance` private method (the ECL delta cron)
 *
 * All three "sweep the ledger to zero" on this contract in some way — write-off
 * and JP5 derecognize every remaining receivable/liability leg, and the ECL
 * cron compares its target provision against the live 11-2102 balance. They
 * must never independently drift on what a GL balance means.
 */
export async function glContractBalance(
  client: Prisma.TransactionClient | PrismaClient,
  contractId: string,
  accountCode: string,
  side: 'dr' | 'cr',
): Promise<Decimal> {
  const lines = await client.journalLine.findMany({
    where: {
      accountCode,
      journalEntry: {
        metadata: { path: ['contractId'], equals: contractId },
        status: 'POSTED',
        deletedAt: null,
      },
    },
    select: { debit: true, credit: true },
  });
  let bal = new Decimal(0);
  for (const l of lines) {
    bal =
      side === 'dr'
        ? bal.plus(l.debit.toString()).minus(l.credit.toString())
        : bal.plus(l.credit.toString()).minus(l.debit.toString());
  }
  return bal;
}
