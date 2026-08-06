import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import path from 'path';
import { seedFinanceCoa } from './seed-coa-finance';
import { loadCoaFromCsv } from '../src/modules/journal/__tests__/csv-fixture-loader';

const prisma = new PrismaClient();

const CSV_PATH = path.join(
  __dirname,
  '../src/modules/journal/__tests__/fixtures/cpa-cases/finance-coa.csv',
);

describe('seedFinanceCoa', () => {
  beforeAll(async () => {
    await prisma.chartOfAccount.deleteMany({});
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  // No magic account count here: the CSV IS the chart, so the expectation is
  // derived from it. (The old "99+" title was stale — the chart has grown well
  // past 99 and shrank by 2 when CPA removed 42-1106/42-1107 on 2026-08-03.)
  it('seeds every account in the CSV — exactly, no rows dropped', async () => {
    const csvRows = loadCoaFromCsv(CSV_PATH);
    const result = await seedFinanceCoa(prisma);
    expect(result.created).toBe(csvRows.length);
    const cash = await prisma.chartOfAccount.findUnique({ where: { code: '11-1101' } });
    expect(cash).toMatchObject({
      code: '11-1101',
      name: 'เงินสด - สุทธินีย์ คงเดช',
      type: 'สินทรัพย์',
      normalBalance: 'Dr',
      vatApplicable: false,
    });
    const deferred = await prisma.chartOfAccount.findUnique({ where: { code: '11-2106' } });
    expect(deferred?.normalBalance).toBe('Cr');
  });

  // CPA/owner 2026-08-03: both accounts removed from the chart (was: "open but
  // dormant"). 42-1106 superseded by Cr 51-1103; 42-1107's cancel-penalty rule
  // was scrapped. Inverse of the old exchange-coa assertions — a re-introduction
  // via the seeder must fail here.
  it('does NOT seed the removed 42-1106 / 42-1107 accounts', async () => {
    await seedFinanceCoa(prisma);
    const removed = await prisma.chartOfAccount.findMany({
      where: { code: { in: ['42-1106', '42-1107'] } },
    });
    expect(removed).toEqual([]);
  });

  it('is idempotent', async () => {
    await seedFinanceCoa(prisma); // first run
    const before = await prisma.chartOfAccount.count();
    await seedFinanceCoa(prisma); // second — should be no-op (no creates)
    const after = await prisma.chartOfAccount.count();
    expect(after).toBe(before);
  });
});
