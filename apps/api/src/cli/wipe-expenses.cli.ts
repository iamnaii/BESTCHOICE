/**
 * Wipe Expense Documents CLI — PR-1 helper.
 *
 * DESTRUCTIVE: Truncates expense_documents + expense_details + related
 * journal_entries (metadata.flow LIKE 'expense-%') and journal_lines.
 *
 * Run as Cloud Run Job after PR-1 deploys, or locally for dev reset.
 *
 * Required env (mirrors wipe-accounting.cli.ts):
 *   CONFIRM_WIPE_EXPENSES=YES_I_AM_SURE
 *   EXPECTED_DB_NAME=<exact db name>
 *   ALLOW_PROD_WIPE=YES_I_AM_SURE   (only when NODE_ENV=production)
 */
import { PrismaClient } from '@prisma/client';

const REQUIRED_CONSENT = 'YES_I_AM_SURE';

async function main(): Promise<void> {
  if (process.env.CONFIRM_WIPE_EXPENSES !== REQUIRED_CONSENT) {
    console.error(`ERROR: Refusing to run without CONFIRM_WIPE_EXPENSES=${REQUIRED_CONSENT}`);
    console.error('');
    console.error('This script performs the following DESTRUCTIVE operations:');
    console.error('  DELETE FROM journal_lines WHERE journal_entry_id IN (... metadata flow=expense-*)');
    console.error('  DELETE FROM journal_entries WHERE metadata->>flow LIKE expense-%');
    console.error('  TRUNCATE expense_details CASCADE');
    console.error('  TRUNCATE expense_documents CASCADE');
    console.error('');
    console.error('All expense documents + their JE entries will be permanently deleted.');
    console.error(
      'Re-run with: CONFIRM_WIPE_EXPENSES=YES_I_AM_SURE EXPECTED_DB_NAME=<db> npm --prefix apps/api run wipe:expenses',
    );
    console.error('Production: also add ALLOW_PROD_WIPE=YES_I_AM_SURE');
    process.exit(1);
  }

  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_PROD_WIPE !== REQUIRED_CONSENT) {
    console.error('ERROR: NODE_ENV=production requires ALLOW_PROD_WIPE=YES_I_AM_SURE');
    process.exit(1);
  }

  const expectedDb = process.env.EXPECTED_DB_NAME;
  if (!expectedDb) {
    console.error('ERROR: Refusing to run without EXPECTED_DB_NAME=<exact db name>');
    process.exit(1);
  }

  const prisma = new PrismaClient();
  try {
    const [{ current_database }] = await prisma.$queryRaw<Array<{ current_database: string }>>`
      SELECT current_database()
    `;
    if (current_database !== expectedDb) {
      console.error(
        `ERROR: Connected DB "${current_database}" does not match EXPECTED_DB_NAME="${expectedDb}"`,
      );
      process.exit(1);
    }

    console.error(`About to wipe expense data on database "${current_database}".`);
    console.error('Press Ctrl+C within 5 seconds to abort...');
    await new Promise((resolve) => setTimeout(resolve, 5000));

    const stats = await prisma.$transaction(async (tx) => {
      const lines = await tx.$executeRawUnsafe(`
        DELETE FROM journal_lines
        WHERE journal_entry_id IN (
          SELECT id FROM journal_entries
          WHERE metadata->>'flow' LIKE 'expense-%'
        )
      `);
      const entries = await tx.$executeRawUnsafe(`
        DELETE FROM journal_entries
        WHERE metadata->>'flow' LIKE 'expense-%'
      `);
      const details = await tx.$executeRawUnsafe(`TRUNCATE expense_details CASCADE`);
      const docs = await tx.$executeRawUnsafe(`TRUNCATE expense_documents CASCADE`);
      return { lines, entries, details, docs };
    });

    console.log('Wipe complete:');
    console.log(JSON.stringify(stats, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('Wipe failed:', err);
  process.exit(1);
});
