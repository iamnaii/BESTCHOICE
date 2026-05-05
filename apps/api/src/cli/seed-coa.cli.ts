/**
 * Seed Chart of Accounts CLI — non-destructive upsert for FINANCE chart.
 *
 * Reads `apps/api/src/modules/journal/__tests__/fixtures/cpa-cases/finance-coa.csv`
 * and upserts each row into `chart_of_accounts` by code. Existing accounts get
 * field updates if changed; missing accounts get created. No rows deleted.
 *
 * Use this when the CPA updates the canonical CSV with new accounts or name
 * corrections — instead of running the destructive wipe CLI.
 *
 * Safe to run multiple times — idempotent.
 *
 * Production invocation:
 *   gcloud run jobs execute seed-coa-prod --region=asia-southeast1 --project=bestchoice-prod --wait
 */
import { PrismaClient } from '@prisma/client';
import { seedFinanceCoa } from '../../prisma/seed-coa-finance';

async function main(): Promise<void> {
  const expectedDb = process.env.EXPECTED_DB_NAME;
  if (!expectedDb) {
    console.error('ERROR: Refusing to run without EXPECTED_DB_NAME=<exact-db-name>');
    console.error('Re-run with: EXPECTED_DB_NAME=<db> npm --prefix apps/api run seed:coa');
    process.exit(1);
  }

  const prisma = new PrismaClient();

  const [{ current_database: actualDb }] = await prisma.$queryRaw<{ current_database: string }[]>`SELECT current_database()`;
  if (actualDb !== expectedDb) {
    console.error(`ERROR: DB mismatch: connected to "${actualDb}" but EXPECTED_DB_NAME="${expectedDb}". Aborting.`);
    await prisma.$disconnect();
    process.exit(1);
  }

  try {
    console.log(`[seed-coa] Connected to "${actualDb}". Upserting FINANCE chart of accounts from CSV...`);
    const result = await seedFinanceCoa(prisma);
    console.log(`[seed-coa] Done: ${result.created} created, ${result.updated} updated.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error('[seed-coa] FATAL:', e);
  process.exit(1);
});
