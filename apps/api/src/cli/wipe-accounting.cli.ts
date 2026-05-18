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
import { seedShopCoa } from '../../prisma/seed-coa-shop';

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
    console.error(`Re-run with: CONFIRM_WIPE=${REQUIRED_CONSENT} EXPECTED_DB_NAME=<db-name> npm --prefix apps/api run wipe:accounting`);
    console.error(`Production: also add ALLOW_PROD_WIPE=${REQUIRED_CONSENT}`);
    process.exit(1);
  }

  // C7 FIX: Guard 1 — refuse to run in production unless ALLOW_PROD_WIPE is also set
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_PROD_WIPE !== REQUIRED_CONSENT) {
    console.error('ERROR: Refusing to wipe in NODE_ENV=production without ALLOW_PROD_WIPE=YES_I_AM_SURE');
    console.error('Re-run with: CONFIRM_WIPE=YES_I_AM_SURE ALLOW_PROD_WIPE=YES_I_AM_SURE EXPECTED_DB_NAME=<db> npm --prefix apps/api run wipe:accounting');
    process.exit(1);
  }

  // C7 FIX: Guard 2 — require EXPECTED_DB_NAME to prevent wrong-database runs
  const expectedDb = process.env.EXPECTED_DB_NAME;
  if (!expectedDb) {
    console.error('ERROR: Refusing to run without EXPECTED_DB_NAME=<exact-db-name> (must match current_database())');
    console.error('Re-run with: CONFIRM_WIPE=YES_I_AM_SURE EXPECTED_DB_NAME=<db> npm --prefix apps/api run wipe:accounting');
    process.exit(1);
  }

  const prisma = new PrismaClient();

  // C7 FIX: Guard 3 — verify connected DB matches EXPECTED_DB_NAME
  const [{ current_database: actualDb }] = await prisma.$queryRaw<{ current_database: string }[]>`SELECT current_database()`;
  if (actualDb !== expectedDb) {
    console.error(`ERROR: DB mismatch: connected to "${actualDb}" but EXPECTED_DB_NAME="${expectedDb}". Aborting.`);
    await prisma.$disconnect();
    process.exit(1);
  }

  // C7 FIX: Guard 4 — print intent + 5-second cooldown to allow Ctrl+C
  console.error(`WARNING: About to TRUNCATE journal_lines, journal_entries, payments, installment_schedules, contracts, chart_of_accounts on database "${actualDb}".`);
  console.error('Press Ctrl+C within 5 seconds to abort.');
  await new Promise((r) => setTimeout(r, 5000));

  try {
    console.log('[wipe-accounting] Starting Phase A.4 wipe & reseed...');
    console.log('[wipe-accounting] DATABASE_URL:', process.env.DATABASE_URL?.replace(/:[^@]+@/, ':***@'));
    console.log('');

    console.log('[wipe-accounting] Step 1: Truncating accounting tables...');
    // Order matters: journal_lines references journal_entries, so lines first.
    // CASCADE handles FK children of each table.
    // Skip-if-missing: when running on OLD pre-A.4 schema (no installment_schedules),
    // skip tables that don't exist instead of failing.
    const tables = [
      'journal_lines',
      'journal_entries',
      'payments',
      'installment_schedules',
      'contracts',
      'chart_of_accounts',
    ];
    for (const t of tables) {
      try {
        await prisma.$executeRawUnsafe(`TRUNCATE "${t}" CASCADE`);
        console.log(`[wipe-accounting]   ${t} truncated`);
      } catch (e: unknown) {
        const msg = (e as { message?: string }).message ?? '';
        if (msg.includes('does not exist')) {
          console.log(`[wipe-accounting]   ${t} skipped (table does not exist on this schema)`);
        } else {
          throw e;
        }
      }
    }

    console.log('');
    console.log('[wipe-accounting] Step 2: Reseeding 99-account FINANCE chart of accounts...');
    // Skip seeding if the chart_of_accounts table is on OLD schema (lacks new
    // columns like normalBalance/category). Detect by attempting a probe query.
    let canSeed = true;
    try {
      await prisma.$queryRawUnsafe('SELECT "normalBalance" FROM "chart_of_accounts" LIMIT 0');
    } catch (e: unknown) {
      const msg = (e as { message?: string }).message ?? '';
      if (msg.includes('does not exist')) {
        canSeed = false;
        console.log('[wipe-accounting]   Skipping seed: chart_of_accounts is on OLD schema. Run prisma migrate deploy first, then retry seed.');
      }
    }
    if (canSeed) {
      const result = await seedFinanceCoa(prisma);
      console.log(`[wipe-accounting]   FINANCE Reseed complete: ${result.created} created, ${result.updated} updated`);
      // P3-SP5: also seed SHOP-side chart (S-prefixed codes). Same idempotent
      // upsert pattern; safe to re-run.
      const shopResult = await seedShopCoa(prisma);
      console.log(`[wipe-accounting]   SHOP Reseed complete: ${shopResult.created} created, ${shopResult.updated} updated`);
    }
    console.log('');
    console.log('[wipe-accounting] Wipe & reseed finished successfully.');
    console.log('[wipe-accounting] Next steps:');
    console.log('  1. Verify CoA count: ');
    console.log("     SELECT COUNT(*) FROM chart_of_accounts WHERE code NOT LIKE 'S%';  -- expected 99 (FINANCE)");
    console.log("     SELECT COUNT(*) FROM chart_of_accounts WHERE code LIKE 'S%';      -- expected ~56 (SHOP)");
    console.log('  2. Smoke test: create one contract end-to-end via UI');
    console.log('  3. Run TB report (scope=FINANCE) and confirm it balances');
    console.log('  4. Run TB report (scope=SHOP) and confirm it balances');
    console.log('  5. Run TB report (scope=ALL) and confirm BOTH halves balance independently');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error('[wipe-accounting] FATAL: Wipe failed:', e);
  process.exit(1);
});
