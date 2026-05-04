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

    const existing = await prisma.chartOfAccount.findUnique({ where: { code: r.code } });
    if (existing) {
      const changed =
        existing.name !== r.name ||
        existing.type !== r.type ||
        existing.normalBalance !== r.normalBalance ||
        existing.category !== category ||
        existing.vatApplicable !== r.vatApplicable ||
        existing.notes !== notes;
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
