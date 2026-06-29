/**
 * Remove TEST contracts created by seed-test-contracts.cli.
 *
 * STRATEGY (safe on prod)
 * -----------------------
 * For every contract whose number starts with `TEST-`:
 *   - HARD-delete the journal entries posted by any payment recorded during the
 *     test (found via metadata.contractId) + their lines → restores the ledger /
 *     Trial Balance. (journal_entries have no immutability trigger; the wipe CLI
 *     deletes them too.)
 *   - SOFT-delete (deletedAt) the receipts, payments, contract, and the test
 *     customer → they vanish from every UI query (all filter deletedAt: null)
 *     WITHOUT risking FK-cascade errors from hard-deleting rows with children.
 *
 * Residue that CANNOT be removed (accepted): immutable audit_logs of the test
 * actions, and gaps in the receipt-number sequence (numbers aren't reclaimed).
 *
 * GUARDS — identical to seed-test-contracts.cli (CONFIRM_CLEANUP / ALLOW_PROD_CLEANUP).
 *
 * INVOCATION
 * ----------
 *   Dry-run:  EXPECTED_DB_NAME=<db> npm --prefix apps/api run cleanup:test-contracts
 *   Live:     CONFIRM_CLEANUP=YES_I_AM_SURE EXPECTED_DB_NAME=<db> \
 *             [ALLOW_PROD_CLEANUP=YES_I_AM_SURE NODE_ENV=production] \
 *             npm --prefix apps/api run cleanup:test-contracts
 */

import { PrismaService } from '../prisma/prisma.service';

const REQUIRED_CONSENT = 'YES_I_AM_SURE';

export interface CleanupResult {
  contracts: number;
  payments: number;
  receipts: number;
  journalEntries: number;
  customers: number;
}

export async function cleanupTestContracts(
  prisma: PrismaService,
  opts: { dryRun: boolean },
): Promise<CleanupResult> {
  const result: CleanupResult = { contracts: 0, payments: 0, receipts: 0, journalEntries: 0, customers: 0 };

  const contracts = await prisma.contract.findMany({
    where: { contractNumber: { startsWith: 'TEST-' }, deletedAt: null },
    select: { id: true, contractNumber: true, customerId: true },
  });
  if (contracts.length === 0) {
    console.log('[cleanup-test-contracts] No active TEST- contracts found. Nothing to do.');
    return result;
  }

  const contractIds = contracts.map((c) => c.id);
  const customerIds = [...new Set(contracts.map((c) => c.customerId))];

  // Journal entries posted by payments recorded during the test (metadata.contractId).
  const entries = await prisma.journalEntry.findMany({
    where: { OR: contractIds.map((id) => ({ metadata: { path: ['contractId'], equals: id } as any })) },
    select: { id: true },
  });
  const entryIds = entries.map((e) => e.id);

  const [payCount, rcptCount] = await Promise.all([
    prisma.payment.count({ where: { contractId: { in: contractIds }, deletedAt: null } }),
    prisma.receipt.count({ where: { contractId: { in: contractIds }, deletedAt: null } }),
  ]);

  result.contracts = contracts.length;
  result.payments = payCount;
  result.receipts = rcptCount;
  result.journalEntries = entryIds.length;
  result.customers = customerIds.length;

  if (opts.dryRun) {
    for (const c of contracts) console.log(`  ${c.contractNumber}`);
    console.log('');
    console.log(`  would remove: ${contracts.length} contracts, ${payCount} payments, ${rcptCount} receipts,`);
    console.log(`                ${entryIds.length} journal entries (hard), ${customerIds.length} test customers`);
    return result;
  }

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    if (entryIds.length) {
      await tx.journalLine.deleteMany({ where: { journalEntryId: { in: entryIds } } });
      await tx.journalEntry.deleteMany({ where: { id: { in: entryIds } } });
    }
    await tx.receipt.updateMany({
      where: { contractId: { in: contractIds }, deletedAt: null },
      data: { deletedAt: now },
    });
    await tx.payment.updateMany({
      where: { contractId: { in: contractIds }, deletedAt: null },
      data: { deletedAt: now },
    });
    await tx.contract.updateMany({
      where: { id: { in: contractIds }, deletedAt: null },
      data: { deletedAt: now },
    });
    await tx.customer.updateMany({
      where: { id: { in: customerIds }, deletedAt: null },
      data: { deletedAt: now },
    });
  });

  console.log(`[cleanup-test-contracts] Removed ${contracts.length} TEST- contracts.`);
  return result;
}

async function main(): Promise<void> {
  const expectedDb = process.env.EXPECTED_DB_NAME;
  if (!expectedDb) {
    console.error('ERROR: EXPECTED_DB_NAME required');
    process.exit(1);
  }

  const dryRun = process.env.CONFIRM_CLEANUP !== REQUIRED_CONSENT;
  if (dryRun) {
    console.log('[cleanup-test-contracts] DRY-RUN mode (default). To remove, re-run with:');
    console.log(`  CONFIRM_CLEANUP=${REQUIRED_CONSENT} EXPECTED_DB_NAME=<db> [ALLOW_PROD_CLEANUP=${REQUIRED_CONSENT}] npm --prefix apps/api run cleanup:test-contracts`);
    console.log('');
  }
  if (!dryRun && process.env.NODE_ENV === 'production' && process.env.ALLOW_PROD_CLEANUP !== REQUIRED_CONSENT) {
    console.error(`ERROR: Refusing to clean up in NODE_ENV=production without ALLOW_PROD_CLEANUP=${REQUIRED_CONSENT}`);
    process.exit(1);
  }

  const prisma = new PrismaService();
  const [{ current_database: actualDb }] = await (prisma as any).$queryRaw<{ current_database: string }[]>`SELECT current_database()`;
  if (actualDb !== expectedDb) {
    console.error(`ERROR: DB mismatch: connected="${actualDb}" expected="${expectedDb}". Aborting.`);
    await prisma.$disconnect();
    process.exit(1);
  }

  console.log(`[cleanup-test-contracts] DB: "${actualDb}" | mode: ${dryRun ? 'DRY-RUN' : 'LIVE'}`);
  console.log('');

  try {
    const r = await cleanupTestContracts(prisma, { dryRun });
    console.log('');
    console.log('[cleanup-test-contracts] ===== SUMMARY =====');
    console.log(`  contracts       : ${r.contracts}`);
    console.log(`  payments        : ${r.payments}`);
    console.log(`  receipts        : ${r.receipts}`);
    console.log(`  journal entries : ${r.journalEntries} (hard-deleted)`);
    console.log(`  customers       : ${r.customers}`);
    console.log('');
    console.log(dryRun ? '[cleanup-test-contracts] DRY-RUN complete — nothing removed.' : '[cleanup-test-contracts] Done.');
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[cleanup-test-contracts] FATAL:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
