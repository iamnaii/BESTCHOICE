/**
 * ก้อน 2 จ่ายเงินผู้จัดจำหน่าย (คำตัดสินเจ้าของ 2026-10-05 + คำตอบฝ่ายบัญชีข้อ 9.1/9.2) — บัญชีใหม่ 2 ตัวต้องอยู่ในผังบัญชีหน้าร้าน
 * (ไฟล์ CSV ตัวเดียวกับที่ seeder และฐานทดสอบใช้) ก่อนที่ template จะอ้างถึง
 */
import path from 'path';
import { loadCoaFromCsv } from '../../journal/__tests__/csv-fixture-loader';

const CSV = path.join(__dirname, '../../journal/__tests__/fixtures/cpa-cases/shop-coa.csv');

describe('ผังบัญชีหน้าร้าน — บัญชีของเมนูจ่ายเงินผู้จัดจำหน่าย', () => {
  const byCode = new Map(loadCoaFromCsv(CSV).map((row) => [row.code, row]));

  it('S11-4201 เงินมัดจำจ่ายล่วงหน้า – ผู้จัดจำหน่าย เป็นสินทรัพย์ ยอดปกติ Dr', () => {
    const row = byCode.get('S11-4201');
    expect(row).toBeDefined();
    expect(row!.type).toBe('สินทรัพย์');
    expect(row!.normalBalance).toBe('Dr');
    expect(row!.name).toContain('มัดจำ');
  });

  it('S53-1105 ค่าใช้จ่าย – มัดจำที่ไม่ได้คืน เป็นค่าใช้จ่าย ยอดปกติ Dr', () => {
    const row = byCode.get('S53-1105');
    expect(row).toBeDefined();
    expect(row!.type).toBe('ค่าใช้จ่าย');
    expect(row!.normalBalance).toBe('Dr');
    expect(row!.name).toContain('มัดจำ');
  });
});
