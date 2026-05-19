import { PrismaClient } from '@prisma/client';
import path from 'path';
import { loadCoaFromCsv } from '../src/modules/journal/__tests__/csv-fixture-loader';

/**
 * P3-SP5 — SHOP-side Chart of Accounts seeder.
 *
 * SHOP accounts live in the same `chart_of_accounts` table as FINANCE accounts
 * but use an `S` code prefix (S11-XXXX, S21-XXXX, …) to avoid the unique-on-code
 * collision and to make joined reports (Trial Balance / P&L) easy to partition
 * by simply filtering on `code.startsWith('S')`.
 *
 * Idempotent: re-running upserts in-place. Owner-set `peakCode` values are
 * preserved (matches the FINANCE seeder behaviour at seed-coa-finance.ts).
 */
const CSV_PATH = path.join(
  __dirname,
  '../src/modules/journal/__tests__/fixtures/cpa-cases/shop-coa.csv',
);

export async function seedShopCoa(
  prisma: PrismaClient,
): Promise<{ created: number; updated: number }> {
  const rows = loadCoaFromCsv(CSV_PATH);
  let created = 0;
  let updated = 0;

  for (const r of rows) {
    const category = r.category || null;
    const notes = r.notes || null;
    // Same rule as FINANCE seeder — empty CSV cell = leave nullable, never
    // overwrite owner-set values with "".
    const peakCode = r.peakCode && r.peakCode.length > 0 ? r.peakCode : null;

    const existing = await prisma.chartOfAccount.findUnique({ where: { code: r.code } });
    if (existing) {
      const changed =
        existing.name !== r.name ||
        existing.type !== r.type ||
        existing.normalBalance !== r.normalBalance ||
        existing.category !== category ||
        existing.vatApplicable !== r.vatApplicable ||
        existing.notes !== notes ||
        (peakCode !== null && existing.peakCode !== peakCode);
      if (changed) {
        await prisma.chartOfAccount.update({
          where: { code: r.code },
          data: {
            name: r.name,
            type: r.type,
            normalBalance: r.normalBalance,
            category,
            vatApplicable: r.vatApplicable,
            notes,
            ...(peakCode !== null ? { peakCode } : {}),
          },
        });
        updated++;
      }
    } else {
      await prisma.chartOfAccount.create({
        data: {
          code: r.code,
          name: r.name,
          type: r.type,
          normalBalance: r.normalBalance,
          category,
          vatApplicable: r.vatApplicable,
          notes,
          status: r.status || 'ใช้งาน',
          peakCode,
        },
      });
      created++;
    }
  }
  return { created, updated };
}

if (require.main === module) {
  const prisma = new PrismaClient();
  seedShopCoa(prisma)
    .then((r) => console.log('Seeded SHOP CoA:', r))
    .finally(() => void prisma.$disconnect());
}
