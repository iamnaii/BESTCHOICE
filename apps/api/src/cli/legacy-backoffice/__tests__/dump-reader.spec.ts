import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readDumpTables } from '../dump-reader';

/**
 * อ่าน dump MariaDB 11 ของระบบหลังบ้านเดิม — fixture เป็นข้อมูลสังเคราะห์ทั้งหมด
 * (รูปแบบเดียวกับไฟล์จริง: INSERT แถวละบรรทัด, INSERT บรรทัดเดียวหลายแถว, ตารางว่าง)
 */
const FIXTURE = join(__dirname, '../__fixtures__/mini-dump.sql');

describe('readDumpTables', () => {
  it('reads multi-line and single-line INSERTs with escapes', async () => {
    const t = await readDumpTables(FIXTURE, [
      'bestchoice_contract',
      'bestchoice_payment_installment',
    ]);
    expect(t.bestchoice_contract).toHaveLength(3);
    expect(t.bestchoice_contract[1].contract_remark).toBe("ลูกค้า 'ทดสอบ', (ไม่มี)\nบรรทัดสอง");
    expect(t.bestchoice_contract[2].canceled_at).toBeNull(); // NULL ไม่มี quote
    expect(t.bestchoice_payment_installment.map((r) => r.status)).toEqual(['1', '0', '1']);
  });

  it('returns [] for a table that exists but has no rows', async () => {
    const t = await readDumpTables(FIXTURE, ['bestchoice_expenses']);
    expect(t).toEqual({ bestchoice_expenses: [] });
  });

  it('keys rows by the CREATE TABLE column names and keeps every value as written', async () => {
    const t = await readDumpTables(FIXTURE, ['bestchoice_contract']);
    expect(Object.keys(t)).toEqual(['bestchoice_contract']); // ตารางที่ไม่ได้ขอไม่ติดมา
    expect(t.bestchoice_contract[0]).toEqual({
      contract_id: '1',
      contract_code: 'TEST-C-0001',
      ref_order: '101',
      contract_status: '3',
      contract_remark: 'NULL', // 'NULL' ในเครื่องหมายคำพูด = ข้อความ ไม่ใช่ค่าว่าง
      created_at: '2026-01-05 10:00:00',
      canceled_at: null,
    });
    // ; และ ),( ในข้อความต้องไม่ปิดแถวหรือปิดคำสั่ง
    expect(t.bestchoice_contract[2].contract_remark).toBe('ข้อความ; มีอัฒภาค),(และวงเล็บ');
  });

  it('decodes backslash escapes and keeps column names verbatim (typos included)', async () => {
    const { bestchoice_payment_installment: rows } = await readDumpTables(FIXTURE, [
      'bestchoice_payment_installment',
    ]);
    expect(rows[0].ref_installmemnt).toBe('11');
    expect(rows[0].amount).toBe('100.00');
    expect(rows[0].slip).toBe('uploads\\slip\\TEST-0001.jpg');
    expect(rows[0].remark).toBe('แท็บ\tคั่น "อ้าง"');
    expect(rows[1].remark).toBe('ยกเลิก\r\nรายการ\0จบ');
  });

  it('appends rows from repeated INSERTs and keeps a raw line break inside a quoted value', async () => {
    const { bestchoice_payment_installment: rows } = await readDumpTables(FIXTURE, [
      'bestchoice_payment_installment',
    ]);
    expect(rows.map((r) => r.id)).toEqual(['1', '2', '3']);
    expect(rows[2].remark).toBe('บรรทัดแรก\nบรรทัดที่สอง (ขึ้นบรรทัดจริง)');
    expect(rows[2].created_at).toBe('2026-01-12 09:00:00');
  });

  describe('fails loudly instead of returning partial data', () => {
    let dir: string;
    beforeAll(() => {
      dir = mkdtempSync(join(tmpdir(), 'dump-reader-'));
    });
    afterAll(() => rmSync(dir, { recursive: true, force: true }));

    function writeDump(name: string, insertLines: string[]): string {
      const file = join(dir, name);
      const lines = [
        'CREATE TABLE `t` (',
        '  `a` int(11) NOT NULL,',
        '  `b` varchar(20) DEFAULT NULL,',
        '  PRIMARY KEY (`a`)',
        ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;',
        ...insertLines,
      ];
      writeFileSync(file, lines.join('\n') + '\n', 'utf8');
      return file;
    }

    it('rejects a requested table that is not in the dump', async () => {
      await expect(readDumpTables(FIXTURE, ['bestchoice_missing'])).rejects.toThrow(
        'bestchoice_missing',
      );
    });

    it('rejects a row whose value count differs from the columns — without echoing the values', async () => {
      const file = writeDump('mismatch.sql', [
        'INSERT INTO `t` VALUES',
        "(1,'ok'),",
        "(2,'ค่าลับห้ามโผล่',3);",
      ]);
      const error = await readDumpTables(file, ['t']).then(
        () => null,
        (e: Error) => e,
      );
      expect(error?.message).toContain('`t`');
      expect(error?.message).toContain('บรรทัด 8'); // แถวที่ผิดอยู่บรรทัด 8 ของไฟล์
      expect(error?.message).not.toContain('ค่าลับห้ามโผล่');
    });

    it('rejects a dump that ends inside an INSERT (truncated file)', async () => {
      const file = writeDump('truncated.sql', [
        'INSERT INTO `t` VALUES',
        "(1,'ok'),",
        "(2,'ตัดกลาง",
      ]);
      await expect(readDumpTables(file, ['t'])).rejects.toThrow('`t`');
    });
  });
});
