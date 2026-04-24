/**
 * Backfill Contract.noAnswerCount from last 30 days of CallLog entries.
 *
 * Logic: for each contract, count NO_ANSWER call logs in the 30d window
 * *after* the last ANSWERED/PROMISED call. If no ANSWERED/PROMISED ever, count all
 * NO_ANSWER in window.
 *
 * Run locally:   npx tsx apps/api/scripts/backfill-no-answer-count.ts
 * Run on prod:   via Cloud Run Job (ephemeral) — DO NOT commit DATABASE_URL
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const rows = await prisma.$queryRaw<{ contract_id: string; count: number }[]>`
    WITH last_answered AS (
      SELECT
        "contract_id",
        MAX("called_at") AS answered_at
      FROM "call_logs"
      WHERE "called_at" >= ${thirtyDaysAgo}
        AND "result" IN ('ANSWERED','PROMISED')
      GROUP BY "contract_id"
    )
    SELECT
      cl."contract_id",
      COUNT(*)::int AS count
    FROM "call_logs" cl
    LEFT JOIN last_answered la ON la."contract_id" = cl."contract_id"
    WHERE cl."called_at" >= ${thirtyDaysAgo}
      AND cl."result" = 'NO_ANSWER'
      AND (la.answered_at IS NULL OR cl."called_at" > la.answered_at)
    GROUP BY cl."contract_id"
  `;

  console.log(`Backfilling noAnswerCount for ${rows.length} contracts...`);

  let updated = 0;
  for (const row of rows) {
    await prisma.contract.update({
      where: { id: row.contract_id },
      data: { noAnswerCount: row.count },
    });
    updated++;
    if (updated % 100 === 0) console.log(`  ${updated}/${rows.length} done`);
  }
  console.log(`Done. ${updated} contracts updated.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
