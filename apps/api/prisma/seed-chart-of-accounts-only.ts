/**
 * Standalone seed script — populates ONLY the chart_of_accounts table.
 *
 * Why this exists:
 *   The main `seed.ts` creates demo users/branches/contracts and must
 *   never run on production. This script isolates the chart-of-accounts
 *   seed so it can be executed safely on prod via a Cloud Run Job.
 *
 * Usage (one-time, after the add_chart_of_accounts migration is applied):
 *   npx tsx apps/api/prisma/seed-chart-of-accounts-only.ts
 *
 * The underlying seedChartOfAccounts() uses upsert by `code`, so this
 * script is idempotent — re-running it is safe.
 */
import { PrismaClient } from '@prisma/client';
import { seedChartOfAccounts } from './seeds/chart-of-accounts';

async function main() {
  const prisma = new PrismaClient();
  try {
    await seedChartOfAccounts(prisma);
    console.log('✅ Chart of Accounts seed completed successfully.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('❌ Chart of Accounts seed failed:', err);
  process.exit(1);
});
