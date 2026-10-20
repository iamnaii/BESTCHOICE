import * as fs from 'fs';
import * as path from 'path';
import { loadCoaFromCsv } from './__tests__/csv-fixture-loader';

const CSV = path.join(__dirname, '__tests__', 'fixtures', 'cpa-cases', 'finance-coa.csv');

/**
 * Device Swap CoA (spec §10) — REVERSED 2026-08-03 by CPA/owner instruction.
 *
 * 42-1106 (รายได้จากการโอนกลับค่าเผื่อหนี้สงสัยจะสูญ) and 42-1107 (รายได้ค่าปรับ
 * ยกเลิกเปลี่ยนเครื่อง) were added by the Device Swap sprint and then never used:
 *  - 42-1106 was superseded by the single-standard release account Cr 51-1103
 *    (CPA ruling 2026-08-01, spec §13 A2.2 คำตอบ ข).
 *  - 42-1107's cancel-penalty rule was scrapped entirely by the owner 2026-07-31.
 * CPA then instructed both be REMOVED from the chart (not left dormant).
 *
 * PR4 ต7 (2026-10-11 — คำตอบฝ่ายบัญชี เล่ม 1 ข้อ 3): รหัส 42-1106 ถูก **เปิดใหม่** ภายใต้ชื่อใหม่
 * "เงินพักค่าปรับดิวสะสมเกิน" เป็นบัญชีรายได้ของรอบกวาดเงินพักส่วนเกิน (advance-excess-income) —
 * ไม่ใช่การฟื้นความหมายเดิม (ECL-reversal income ยังเป็น Cr 51-1103).
 *
 * FINANCE mapping v5 (ฝ่ายบัญชี 19/10/2569 · 2026-10-20): รหัส 42-1107 ถูกใช้อีกครั้งเป็นบัญชีใหม่
 * "ส่วนลดรับ" (PEAK 510301 — ส่วนลดจากผู้ขาย) — คนละความหมายกับค่าปรับยกเลิกเปลี่ยนเครื่องที่ถูกลบ
 * ความหมายเดิมยังต้องไม่กลับมา (ชื่อ/ความหมายเดิมถูกปักไว้ข้างล่าง).
 */
describe('Device Swap CoA (spec §10) — 42-1107 reused as ส่วนลดรับ (mapping v5) · 42-1106 reopened (PR4 ต7)', () => {
  const accounts = loadCoaFromCsv(CSV);
  const byCode = new Map(accounts.map((a: { code: string }) => [a.code, a]));

  it('42-1106 reopened as เงินพักค่าปรับดิวสะสมเกิน (รายได้ · Cr · รายได้อื่น · ใช้งาน)', () => {
    expect(byCode.get('42-1106')).toMatchObject({
      name: 'เงินพักค่าปรับดิวสะสมเกิน',
      type: 'รายได้',
      normalBalance: 'Cr',
      category: 'รายได้อื่น',
      status: 'ใช้งาน',
    });
  });

  it('migration reopens 42-1106 on prod (UPDATE soft-deleted row + INSERT ON CONFLICT DO NOTHING)', () => {
    const sql = fs.readFileSync(
      path.join(
        __dirname,
        '../../../prisma/migrations/20261021000000_reopen_42_1106_advance_excess_income/migration.sql',
      ),
      'utf-8',
    );
    expect(sql).toMatch(/UPDATE "chart_of_accounts"[\s\S]*"deletedAt" = NULL[\s\S]*'42-1106'/);
    expect(sql).toContain("'เงินพักค่าปรับดิวสะสมเกิน'");
    expect(sql).toMatch(/INSERT INTO "chart_of_accounts"[\s\S]*'42-1106'[\s\S]*ON CONFLICT \("code"\) DO NOTHING/);
    expect(sql).not.toContain("'42-1107'");
  });

  it('42-1107 is ส่วนลดรับ (mapping v5) — the exchange-cancel penalty meaning stays gone', () => {
    const row = accounts.find((a) => a.code === '42-1107');
    expect(row).toMatchObject({ name: 'ส่วนลดรับ', type: 'รายได้', normalBalance: 'Cr', peakCode: '510301' });
    expect(row!.name).not.toContain('ค่าปรับ');
  });

  it('the surrounding 42-11XX block matches mapping v5 (42-1107 ส่วนลดรับ + 42-1109 added)', () => {
    const otherIncome = accounts
      .map((a: { code: string }) => a.code)
      .filter((c: string) => c.startsWith('42-11'));
    // ก้อน 5 (2026-10-05): 42-1108 · PR4 ต7 (2026-10-11): 42-1106 ใหม่ · mapping v5 (2026-10-20): 42-1107 ส่วนลดรับ + 42-1109
    expect(otherIncome).toEqual([
      '42-1102', '42-1103', '42-1104', '42-1105', '42-1106', '42-1107', '42-1108', '42-1109',
    ]);
  });
});

describe('S21-1104 เจ้าหนี้-FINANCE ค่าเครื่องรับคืน (workbook 2026-08-19)', () => {
  it('shop-coa.csv มีบัญชี S21-1104 เป็นหนี้สิน ยอดปกติ Cr', () => {
    const rows = loadCoaFromCsv(
      path.join(__dirname, '__tests__/fixtures/cpa-cases/shop-coa.csv'),
    );
    const row = rows.find((r) => r.code === 'S21-1104');
    expect(row).toBeDefined();
    expect(row!.normalBalance).toBe('Cr');
    expect(row!.name).toContain('FINANCE');
  });
});
