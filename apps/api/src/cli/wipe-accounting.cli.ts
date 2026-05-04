/**
 * Wipe & Reseed CLI — Phase A.4 production migration helper.
 *
 * DESTRUCTIVE: Truncates journal_lines, journal_entries, payments,
 * installment_schedules, contracts, chart_of_accounts then reseeds the
 * 99-account FINANCE chart from the CPA CSV fixture.
 *
 * Requires explicit consent env var to prevent accidental runs:
 *   CONFIRM_WIPE=YES_I_AM_SURE tsx src/cli/wipe-accounting.cli.ts
 *
 * Intended to run as a one-shot Cloud Run Job after Phase A.4 is merged to
 * production. Must be approved by the owner before execution.
 */
import { PrismaClient } from '@prisma/client';
import { seedFinanceCoa } from '../../prisma/seed-coa-finance';

const REQUIRED_CONSENT = 'YES_I_AM_SURE';

async function main(): Promise<void> {
  if (process.env.CONFIRM_WIPE !== REQUIRED_CONSENT) {
    console.error(`ERROR: Refusing to run without CONFIRM_WIPE=${REQUIRED_CONSENT}`);
    console.error('');
    console.error('This script performs the following DESTRUCTIVE operations:');
    console.error('  TRUNCATE journal_lines CASCADE');
    console.error('  TRUNCATE journal_entries CASCADE');
    console.error('  TRUNCATE payments CASCADE');
    console.error('  TRUNCATE installment_schedules CASCADE');
    console.error('  TRUNCATE contracts CASCADE');
    console.error('  TRUNCATE chart_of_accounts CASCADE');
    console.error('');
    console.error('All existing contracts, payments, and journal data will be permanently deleted.');
    console.error('This is a one-time operation for migrating from Phase A.0-A.3 to Phase A.4.');
    console.error('Production use requires explicit owner approval before running.');
    console.error('');
    console.error(`Re-run with: CONFIRM_WIPE=${REQUIRED_CONSENT} npm --prefix apps/api run wipe:accounting`);
    process.exit(1);
  }

  const prisma = new PrismaClient();

  try {
    console.log('[wipe-accounting] Starting Phase A.4 wipe & reseed...');
    console.log('[wipe-accounting] DATABASE_URL:', process.env.DATABASE_URL?.replace(/:[^@]+@/, ':***@'));
    console.log('');

    console.log('[wipe-accounting] Step 1: Truncating accounting tables...');
    // Order matters: journal_lines references journal_entries, so lines first.
    // CASCADE handles FK children of each table.
    // We run in sequence (not $transaction) because TRUNCATE CASCADE cannot
    // be mixed with regular Prisma operations in the same interactive TX.
    await prisma.$executeRawUnsafe('TRUNCATE "journal_lines" CASCADE');
    console.log('[wipe-accounting]   journal_lines truncated');

    await prisma.$executeRawUnsafe('TRUNCATE "journal_entries" CASCADE');
    console.log('[wipe-accounting]   journal_entries truncated');

    // Truncating contracts cascades to: payments, installment_schedules,
    // contract_documents, contract_letters, contract_snoozes,
    // contract_daily_snapshots, payment_links, payment_evidences, call_logs,
    // promise_slots, daily_assignments. Explicit truncation of payments +
    // installment_schedules is listed for clarity but CASCADE covers them.
    await prisma.$executeRawUnsafe('TRUNCATE "payments" CASCADE');
    console.log('[wipe-accounting]   payments truncated');

    await prisma.$executeRawUnsafe('TRUNCATE "installment_schedules" CASCADE');
    console.log('[wipe-accounting]   installment_schedules truncated');

    await prisma.$executeRawUnsafe('TRUNCATE "contracts" CASCADE');
    console.log('[wipe-accounting]   contracts truncated');

    await prisma.$executeRawUnsafe('TRUNCATE "chart_of_accounts" CASCADE');
    console.log('[wipe-accounting]   chart_of_accounts truncated');

    console.log('');
    console.log('[wipe-accounting] Step 2: Reseeding 99-account FINANCE chart of accounts...');
    const result = await seedFinanceCoa(prisma);
    console.log(`[wipe-accounting]   Reseed complete: ${result.created} created, ${result.updated} updated`);
    console.log('');
    console.log('[wipe-accounting] Wipe & reseed finished successfully.');
    console.log('[wipe-accounting] Next steps:');
    console.log('  1. Verify CoA count: SELECT COUNT(*) FROM chart_of_accounts;  -- expected 99');
    console.log('  2. Smoke test: create one contract end-to-end via UI');
    console.log('  3. Run TB report and confirm it balances');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error('[wipe-accounting] FATAL: Wipe failed:', e);
  process.exit(1);
});
