import { PrismaClient } from '@prisma/client';
import path from 'path';
import { loadCoaFromCsv } from '../src/modules/journal/__tests__/csv-fixture-loader';

const CSV_PATH = path.join(
  __dirname,
  '../src/modules/journal/__tests__/fixtures/cpa-cases/finance-coa.csv',
);

export async function seedFinanceCoa(
  prisma: PrismaClient,
): Promise<{ created: number; updated: number }> {
  const rows = loadCoaFromCsv(CSV_PATH);
  let created = 0;
  let updated = 0;

  for (const r of rows) {
    const category = r.category || null;
    const notes = r.notes || null;
    // P3-SP3: empty string in CSV → null in DB so the partial index stays sparse
    // and the editable UI shows the cell as "unmapped" instead of "".
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
        // Only flag peakCode as changed when CSV provides a non-empty value —
        // owners fill PEAK codes via the UI, so we must never overwrite existing
        // owner-set values with the empty CSV cells.
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
            // Same rule on update path — only write when CSV has a value.
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
  seedFinanceCoa(prisma)
    .then((r) => console.log('Seeded:', r))
    .finally(() => void prisma.$disconnect());
}
