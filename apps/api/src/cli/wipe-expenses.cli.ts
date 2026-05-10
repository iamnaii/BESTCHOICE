/**
 * Wipe Expense Documents CLI — PR-1 helper.
 *
 * DESTRUCTIVE: Truncates expense_documents + expense_details + payroll_*
 * + settlement_* + credit_note_details + expense_templates + related
 * journal_entries (metadata.flow LIKE 'expense-%') and journal_lines.
 *
 * Run as Cloud Run Job after PR-1 deploys, or locally for dev reset.
 *
 * Required env (mirrors wipe-accounting.cli.ts):
 *   CONFIRM_WIPE_EXPENSES=YES_I_AM_SURE
 *   EXPECTED_DB_NAME=<exact db name>
 *   ALLOW_PROD_WIPE=YES_I_AM_SURE   (only when NODE_ENV=production)
 *   ALLOW_LIVE_DATA_WIPE=YES_I_AM_SURE  (when expense_documents has > 0 rows)
 *   ACTOR_USER_ID=<uuid>            (required — written to AuditLog)
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
      'Re-run with: CONFIRM_WIPE_EXPENSES=YES_I_AM_SURE EXPECTED_DB_NAME=<db> ACTOR_USER_ID=<uuid> npm --prefix apps/api run wipe:expenses',
    );
    console.error('Production: also add ALLOW_PROD_WIPE=YES_I_AM_SURE');
    console.error('Live data (>0 docs): also add ALLOW_LIVE_DATA_WIPE=YES_I_AM_SURE');
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

  const actorUserId = process.env.ACTOR_USER_ID;
  if (!actorUserId) {
    console.error('ERROR: Refusing to run without ACTOR_USER_ID=<uuid> — wipe must be auditable');
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

    // Verify actor exists — prevents typos in ACTOR_USER_ID
    const actor = await prisma.user.findUnique({
      where: { id: actorUserId },
      select: { id: true, email: true, role: true },
    });
    if (!actor) {
      console.error(`ERROR: ACTOR_USER_ID "${actorUserId}" not found in users table`);
      process.exit(1);
    }
    if (!['OWNER', 'ACCOUNTANT', 'FINANCE_MANAGER'].includes(actor.role)) {
      console.error(
        `ERROR: actor ${actor.email} has role ${actor.role} — wipe requires OWNER/ACCOUNTANT/FINANCE_MANAGER`,
      );
      process.exit(1);
    }

    // Live data guard — financial records existing in prod must require explicit consent
    const docCount = await prisma.expenseDocument.count();
    if (docCount > 0 && process.env.ALLOW_LIVE_DATA_WIPE !== REQUIRED_CONSENT) {
      console.error(
        `ERROR: ${docCount} expense_documents row(s) exist — wipe requires ALLOW_LIVE_DATA_WIPE=YES_I_AM_SURE`,
      );
      process.exit(1);
    }

    console.error(
      `About to wipe ${docCount} expense_documents on database "${current_database}".`,
    );
    console.error(`Actor: ${actor.email} (${actor.role})`);
    console.error('Press Ctrl+C within 5 seconds to abort...');
    await new Promise((resolve) => setTimeout(resolve, 5000));

    // Write AuditLog row BEFORE the truncate so the trail survives even if the
    // wipe fails partway. action=EXPENSE_WIPE matches the existing convention
    // for destructive admin operations.
    await prisma.auditLog.create({
      data: {
        action: 'EXPENSE_WIPE',
        entity: 'expense_document',
        entityId: 'BULK',
        userId: actorUserId,
        newValue: {
          docCountBefore: docCount,
          databaseName: current_database,
          nodeEnv: process.env.NODE_ENV ?? 'unknown',
        },
      },
    });

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
