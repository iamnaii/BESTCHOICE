/**
 * Backfill installment_schedules for ACTIVE contracts that were activated
 * before the PR #753 fix (which auto-generates schedules on activation).
 *
 * Idempotent: skips contracts that already have schedule rows.
 * Per-installment values match contract-workflow.service::generateInstallmentSchedules:
 *   principal = financedAmount / totalMonths (ROUND_DOWN)
 *   interest  = interestTotal / totalMonths (ROUND_HALF_UP)
 *   amountDue = monthlyPayment (incl VAT)
 *   dueDate   = createdAt month + i, on paymentDueDay (default = createdAt day)
 *
 * Production invocation:
 *   gcloud run jobs execute backfill-schedules --region=asia-southeast1 --project=bestchoice-prod --wait
 */
import { PrismaClient } from '@prisma/client';
import { buildInstallmentScheduleRows } from '../utils/installment-schedule.util';

async function main(): Promise<void> {
  const expectedDb = process.env.EXPECTED_DB_NAME;
  if (!expectedDb) {
    console.error('ERROR: EXPECTED_DB_NAME required');
    process.exit(1);
  }

  const prisma = new PrismaClient();
  const [{ current_database: actualDb }] = await prisma.$queryRaw<{ current_database: string }[]>`SELECT current_database()`;
  if (actualDb !== expectedDb) {
    console.error(`ERROR: DB mismatch: connected="${actualDb}" expected="${expectedDb}"`);
    await prisma.$disconnect();
    process.exit(1);
  }

  console.log(`[backfill] Connected to "${actualDb}". Scanning ACTIVE contracts without schedules...`);

  const candidates = await prisma.contract.findMany({
    where: {
      status: { in: ['ACTIVE', 'OVERDUE', 'DEFAULT', 'TERMINATED'] as any },
      deletedAt: null,
    },
    select: {
      id: true,
      contractNumber: true,
      financedAmount: true,
      interestTotal: true,
      monthlyPayment: true,
      totalMonths: true,
      paymentDueDay: true,
      createdAt: true,
    },
  });

  console.log(`[backfill] Found ${candidates.length} ACTIVE contracts. Generating schedules where missing...`);

  let generated = 0;
  let skipped = 0;
  let failed = 0;

  for (const c of candidates) {
    try {
      const existing = await prisma.installmentSchedule.count({
        where: { contractId: c.id, deletedAt: null },
      });
      if (existing > 0) {
        skipped++;
        continue;
      }
      if (c.totalMonths <= 0) {
        console.log(`[backfill]   skipping ${c.contractNumber} — totalMonths=${c.totalMonths}`);
        skipped++;
        continue;
      }

      // Algorithm consolidated into installment-schedule.util — single source of
      // truth shared with contract-workflow activation + payment-receipt lazy-gen.
      const rows = buildInstallmentScheduleRows(c);
      await prisma.installmentSchedule.createMany({ data: rows });
      console.log(`[backfill]   ${c.contractNumber} — ${rows.length} rows generated`);
      generated++;
    } catch (e) {
      failed++;
      console.error(`[backfill]   ${c.contractNumber} FAILED:`, (e as Error).message);
    }
  }

  console.log(`[backfill] Done: ${generated} contracts backfilled, ${skipped} skipped, ${failed} failed.`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error('[backfill] FATAL:', e);
  process.exit(1);
});
