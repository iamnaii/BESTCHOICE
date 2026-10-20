import * as fs from 'fs';
import * as path from 'path';
import { loadCoaFromCsv } from './csv-fixture-loader';

/** ก้อน 5 (2026-10-05) — เจ้าของเปิดบัญชีใหม่ 42-1108 แทนการกู้ 42-1106/1107 ที่ถูกลบ 2026-08-03 */
describe('ผังบัญชี FINANCE — 42-1108 รายได้อื่น-ภาษีซื้อของสินค้าที่ขายผ่อน', () => {
  const csv = path.join(__dirname, 'fixtures/cpa-cases/finance-coa.csv');

  it('CSV มี 42-1108 เป็นรายได้ · Cr · รายได้อื่น · ไม่คิด VAT · ใช้งาน', () => {
    const row = loadCoaFromCsv(csv).find((r) => r.code === '42-1108');
    expect(row).toBeDefined();
    expect(row).toMatchObject({
      name: 'รายได้อื่น-ภาษีซื้อของสินค้าที่ขายผ่อน',
      type: 'รายได้',
      normalBalance: 'Cr',
      category: 'รายได้อื่น',
      vatApplicable: false,
      status: 'ใช้งาน',
    });
  });

  it('42-1106 เปิดใหม่ภายใต้ชื่อใหม่ (PR4 ต7) · 42-1107 = ส่วนลดรับ (mapping v5 — ไม่ใช่ค่าปรับยกเลิกเปลี่ยนเครื่องเดิม)', () => {
    const rows = loadCoaFromCsv(csv);
    // mapping v5 รอบ 2 (2026-10-20): ชื่อตามไฟล์ฝ่ายบัญชี (เดิม เงินพักค่าปรับดิวสะสมเกิน — PR4 ต7)
    expect(rows.find((r) => r.code === '42-1106')?.name).toBe('หนี้สูญได้รับคืน');
    expect(rows.find((r) => r.code === '42-1107')?.name).toBe('ส่วนลดรับ');
  });

  it('migration เพิ่ม 42-1108 แบบ ON CONFLICT DO NOTHING (prod ได้ตอน deploy โดยไม่ต้อง seed:coa)', () => {
    const sql = fs.readFileSync(
      path.join(__dirname, '../../../../prisma/migrations/20261020000000_installment_input_vat/migration.sql'),
      'utf-8',
    );
    expect(sql).toMatch(/INSERT INTO "chart_of_accounts"[\s\S]*'42-1108'[\s\S]*ON CONFLICT \("code"\) DO NOTHING/);
    expect(sql).toContain('CREATE TYPE "InputVatStatus"');
    expect(sql).toContain('"received_vat"');
    expect(sql).toContain('"input_vat_journal_entry_id"');
  });
});
