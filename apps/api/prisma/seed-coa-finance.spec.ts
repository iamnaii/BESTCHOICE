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

  // CPA/owner 2026-08-03: both accounts removed from the chart. PR4 ต7 (2026-10-11):
  // 42-1106 reopened under a NEW name (เงินพักค่าปรับดิวสะสมเกิน — income of the
  // advance-excess sweep; renamed again to หนี้สูญได้รับคืน by mapping v5 round 2
  // on 2026-10-20 per the accountant's file — the sweep still posts here; income of the
  // advance-excess sweep). FINANCE mapping v5 (ฝ่ายบัญชี 19/10/2569): 42-1107 reused as
  // "ส่วนลดรับ" (PEAK 510301) — a new meaning; the cancel-penalty name must not come back.
  it('seeds 42-1106 under its PR4 name and 42-1107 as ส่วนลดรับ (mapping v5)', async () => {
    await seedFinanceCoa(prisma);
    const reopened = await prisma.chartOfAccount.findUnique({ where: { code: '42-1106' } });
    expect(reopened).toMatchObject({
      name: 'หนี้สูญได้รับคืน',
      type: 'รายได้',
      normalBalance: 'Cr',
      vatApplicable: false,
      status: 'ใช้งาน',
    });
    const reused = await prisma.chartOfAccount.findUnique({ where: { code: '42-1107' } });
    expect(reused).toMatchObject({ name: 'ส่วนลดรับ', type: 'รายได้', normalBalance: 'Cr', peakCode: '510301' });
    expect(reused!.name).not.toContain('ค่าปรับ');
  });

  // FINANCE mapping v5 (19/10/2569): the CSV now carries PEAK code + sub-code + source.
  it('seeds PEAK code / sub-code / source from the CSV (fixed sub-code vs per-line source)', async () => {
    await seedFinanceCoa(prisma);
    const adv = await prisma.chartOfAccount.findUnique({ where: { code: '11-6101' } });
    expect(adv).toMatchObject({ peakCode: '212203', peakSubCode: 'ADV001', peakSubCodeSource: 'fixed' });
    const cash = await prisma.chartOfAccount.findUnique({ where: { code: '11-1102' } });
    expect(cash).toMatchObject({ peakCode: '111101', peakSubCode: 'CSH002', peakSubCodeSource: 'fixed' });
    const ar = await prisma.chartOfAccount.findUnique({ where: { code: '11-2101' } });
    expect(ar).toMatchObject({ peakCode: '113101', peakSubCode: null, peakSubCodeSource: 'contact' });
    // Accounts the accountant left unmapped stay null (export skips them).
    const deferred = await prisma.chartOfAccount.findUnique({ where: { code: '11-2106' } });
    expect(deferred).toMatchObject({ peakCode: null, peakSubCode: null, peakSubCodeSource: 'none' });
  });

  it('re-seeding: empty CSV cells never clear owner-set values, non-empty cells win', async () => {
    await seedFinanceCoa(prisma);
    // 11-2106 has no PEAK code in the CSV → owner maps it by hand → re-seed keeps it.
    await prisma.chartOfAccount.update({ where: { code: '11-2106' }, data: { peakCode: 'OWNER-X' } });
    // 11-6101 is fixed/ADV001 in the CSV → an edit by hand is restored on re-seed (CSV = accountant's file).
    await prisma.chartOfAccount.update({ where: { code: '11-6101' }, data: { peakSubCode: 'ZZZ001' } });
    await seedFinanceCoa(prisma);
    const kept = await prisma.chartOfAccount.findUnique({ where: { code: '11-2106' } });
    expect(kept).toMatchObject({ peakCode: 'OWNER-X', peakSubCode: null, peakSubCodeSource: 'none' });
    const restored = await prisma.chartOfAccount.findUnique({ where: { code: '11-6101' } });
    expect(restored).toMatchObject({ peakCode: '212203', peakSubCode: 'ADV001', peakSubCodeSource: 'fixed' });
  });

  it('is idempotent', async () => {
    await seedFinanceCoa(prisma); // first run
    const before = await prisma.chartOfAccount.count();
    await seedFinanceCoa(prisma); // second — should be no-op (no creates)
    const after = await prisma.chartOfAccount.count();
    expect(after).toBe(before);
  });
});
