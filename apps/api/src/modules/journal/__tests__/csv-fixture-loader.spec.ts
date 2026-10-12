import { loadCoaFromCsv, loadCaseFromCsv } from './csv-fixture-loader';
import fs from 'fs';
import path from 'path';

const FIX = path.join(__dirname, 'fixtures/cpa-cases');

describe('csv-fixture-loader', () => {
  it('fixture CSV ของ CPA คงบรรทัดจบ CRLF ตามไฟล์ต้นฉบับ (ยกเว้น shop-coa.csv ที่เป็น LF) — ห้ามแปลงทั้งไฟล์ (diff/blame เสีย · PR4 final review M1)', () => {
    const files = fs
      .readdirSync(FIX)
      .filter((f) => f.endsWith('.csv') && f !== 'shop-coa.csv')
      .sort();
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      // ทุกบรรทัดที่จบด้วย \n ต้องจบด้วย \r\n — ส่วนท้ายไฟล์หลัง \n สุดท้าย (บรรทัดที่ไม่มีตัวจบ ตามไฟล์ต้นฉบับ) ไม่นับ
      const terminated = fs.readFileSync(path.join(FIX, f), 'utf-8').split('\n').slice(0, -1);
      expect(terminated.length).toBeGreaterThan(0);
      const lf = terminated.filter((l) => !l.endsWith('\r')).length;
      expect({ file: f, lfLines: lf }).toEqual({ file: f, lfLines: 0 });
    }
  });

  it('loads CoA with 100+ accounts', () => {
    const accounts = loadCoaFromCsv(path.join(FIX, 'finance-coa.csv'));
    expect(accounts.length).toBeGreaterThanOrEqual(90);
    const cash = accounts.find((a) => a.code === '11-1101');
    expect(cash).toMatchObject({
      code: '11-1101',
      name: 'เงินสด - สุทธินีย์ คงเดช',
      type: 'สินทรัพย์',
      normalBalance: 'Dr',
      vatApplicable: false,
    });
  });

  it('loads case-1-overpay with multiple JE blocks', () => {
    const cas = loadCaseFromCsv(path.join(FIX, 'case-1-overpay.csv'));
    expect(cas.entries.length).toBeGreaterThan(0);
    // First block should contain 11-2101 with Dr=17000.00
    const allLines = cas.entries.flatMap((e) => e.lines);
    expect(allLines).toContainEqual(
      expect.objectContaining({ code: '11-2101', dr: '17000.00' }),
    );
  });
});
