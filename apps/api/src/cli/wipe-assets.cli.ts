/**
 * Wipe CLI — Asset Module Phase 1 production migration helper.
 *
 * DESTRUCTIVE: Truncates asset_transfer_history, depreciation_entries, fixed_assets.
 *
 * Requires explicit consent env var to prevent accidental runs:
 *   CONFIRM_WIPE=YES_I_AM_SURE EXPECTED_DB_NAME=<db> npm --prefix apps/api run wipe:assets
 *
 * Intended to run as a one-shot Cloud Run Job after Asset Module Phase 1 is merged to
 * production. Must be approved by the owner before execution.
 *
 * Mirrors Phase A.4 wipe-accounting pattern (4 guards: CONFIRM_WIPE, EXPECTED_DB_NAME,
 * ALLOW_PROD_WIPE in prod, 5s cooldown).
 */
import { PrismaClient } from '@prisma/client';

const REQUIRED_CONSENT = 'YES_I_AM_SURE';

async function main(): Promise<void> {
  if (process.env.CONFIRM_WIPE !== REQUIRED_CONSENT) {
    console.error(`ERROR: Refusing to run without CONFIRM_WIPE=${REQUIRED_CONSENT}`);
    console.error('');
    console.error('This script performs the following DESTRUCTIVE operations:');
    console.error('  TRUNCATE asset_transfer_history CASCADE');
    console.error('  TRUNCATE depreciation_entries CASCADE');
    console.error('  TRUNCATE fixed_assets CASCADE');
    console.error('');
    console.error('All existing fixed assets, depreciation entries, and transfer history will be permanently deleted.');
    console.error('This is a one-time operation for migrating Asset Module Phase 1 to production.');
    console.error('Production use requires explicit owner approval before running.');
    console.error('');
    console.error(`Re-run with: CONFIRM_WIPE=${REQUIRED_CONSENT} EXPECTED_DB_NAME=<db-name> npm --prefix apps/api run wipe:assets`);
    console.error(`Production: also add ALLOW_PROD_WIPE=${REQUIRED_CONSENT}`);
    process.exit(1);
  }

  // Guard 1 — refuse to run in production unless ALLOW_PROD_WIPE is also set
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_PROD_WIPE !== REQUIRED_CONSENT) {
    console.error('ERROR: Refusing to wipe in NODE_ENV=production without ALLOW_PROD_WIPE=YES_I_AM_SURE');
    console.error('Re-run with: CONFIRM_WIPE=YES_I_AM_SURE ALLOW_PROD_WIPE=YES_I_AM_SURE EXPECTED_DB_NAME=<db> npm --prefix apps/api run wipe:assets');
    process.exit(1);
  }

  // Guard 2 — require EXPECTED_DB_NAME to prevent wrong-database runs
  const expectedDb = process.env.EXPECTED_DB_NAME;
  if (!expectedDb) {
    console.error('ERROR: Refusing to run without EXPECTED_DB_NAME=<exact-db-name> (must match current_database())');
    console.error('Re-run with: CONFIRM_WIPE=YES_I_AM_SURE EXPECTED_DB_NAME=<db> npm --prefix apps/api run wipe:assets');
    process.exit(1);
  }

  const prisma = new PrismaClient();

  // Guard 3 — verify connected DB matches EXPECTED_DB_NAME
  const [{ current_database: actualDb }] = await prisma.$queryRaw<{ current_database: string }[]>`SELECT current_database()`;
  if (actualDb !== expectedDb) {
    console.error(`ERROR: DB mismatch: connected to "${actualDb}" but EXPECTED_DB_NAME="${expectedDb}". Aborting.`);
    await prisma.$disconnect();
    process.exit(1);
  }

  // Guard 4 — print intent + 5-second cooldown to allow Ctrl+C
  console.error(`WARNING: About to TRUNCATE asset_transfer_history, depreciation_entries, fixed_assets on database "${actualDb}".`);
  console.error('Press Ctrl+C within 5 seconds to abort.');
  await new Promise((r) => setTimeout(r, 5000));

  try {
    console.log('[wipe-assets] Starting Phase 1 wipe...');
    console.log('[wipe-assets] DATABASE_URL:', process.env.DATABASE_URL?.replace(/:[^@]+@/, ':***@'));
    console.log('');

    console.log('[wipe-assets] Truncating asset tables...');
    // Order matters: asset_transfer_history references fixed_assets, so history first.
    // CASCADE handles FK children of each table.
    // Skip-if-missing: when running on schema before asset tables exist,
    // skip tables that don't exist instead of failing.
    const tables = ['asset_transfer_history', 'depreciation_entries', 'fixed_assets'];
    for (const t of tables) {
      try {
        await prisma.$executeRawUnsafe(`TRUNCATE "${t}" CASCADE`);
        console.log(`[wipe-assets]   ${t} truncated`);
      } catch (e: unknown) {
        const msg = (e as { message?: string }).message ?? '';
        if (msg.includes('does not exist')) {
          console.log(`[wipe-assets]   ${t} skipped (table does not exist on this schema)`);
        } else {
          throw e;
        }
      }
    }

    console.log('');
    console.log('[wipe-assets] Wipe finished successfully.');
    console.log('[wipe-assets] Next steps:');
    console.log('  1. Verify asset count: SELECT COUNT(*) FROM fixed_assets;  -- expected 0');
    console.log('  2. Smoke test: create one asset end-to-end via UI');
    console.log('  3. Verify depreciation entries: SELECT COUNT(*) FROM depreciation_entries;  -- expected 0');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error('[wipe-assets] FATAL: Wipe failed:', e);
  process.exit(1);
});
