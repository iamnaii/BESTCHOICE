import * as path from 'path';
import { loadCoaFromCsv } from './__tests__/csv-fixture-loader';

const SHOP_CSV = path.join(__dirname, '__tests__', 'fixtures', 'cpa-cases', 'shop-coa.csv');

/**
 * SHOP chart — accounts the opening-balance JE depends on.
 *
 * Spec: docs/superpowers/specs/2026-08-24-shop-opening-balance-design.md
 *
 * The 2026-08-29 opening-balance entry is a hand-built JV. `POST /journal`
 * rejects any line whose account code is not in `chart_of_accounts`
 * (journal.service.ts — "รหัสบัญชีไม่ถูกต้องหรือไม่อยู่ในผังบัญชี"), so an
 * account silently dropped from this CSV does not fail loudly at seed time —
 * it fails later, at the moment someone tries to post the entry. These tests
 * make that failure surface in CI instead.
 */
describe('SHOP CoA — บัญชีที่ JE ยอดยกมา (2026-08-29) ต้องใช้', () => {
  const rows = loadCoaFromCsv(SHOP_CSV);
  const byCode = new Map(rows.map((r) => [r.code, r]));

  describe('S21-4101 เงินกู้ยืมกรรมการ (ยอดยกมา SHOP 2026-08-29)', () => {
    it('มีอยู่ในผัง เป็นหนี้สิน ยอดปกติ Cr', () => {
      const row = byCode.get('S21-4101');
      expect(row).toBeDefined();
      expect(row!.type).toBe('หนี้สิน');
      expect(row!.normalBalance).toBe('Cr');
      expect(row!.status).toBe('ใช้งาน');
    });

    it('แยกจากเจ้าหนี้ระหว่างกิจการ S21-1104 — คนละคู่สัญญา', () => {
      // เจ้าของ/กรรมการ ไม่ใช่ FINANCE. ยัดรวมกันจะทำให้แยกไม่ออกว่าหนี้ก้อนไหน
      // ต้องคืนใคร และทำให้หมายเหตุบุคคลที่เกี่ยวข้องกันในงบผิด
      expect(byCode.get('S21-1104')).toBeDefined();
      expect(byCode.get('S21-4101')!.code).not.toBe(byCode.get('S21-1104')!.code);
    });
  });

  describe('บัญชีฝั่งเดบิตของ JE ยอดยกมา', () => {
    // เงินสดลิ้นชัก / ธนาคาร / สินค้าคงเหลือ — สามกลุ่มที่ยอดยกมาลงจริง
    const debitSide = [
      'S11-1101',
      'S11-1102',
      'S11-1103',
      'S11-1201',
      'S11-1202',
      'S11-2001',
      'S11-2002',
      'S11-2003',
    ];

    it.each(debitSide)('%s มีอยู่ในผังและใช้งานอยู่', (code) => {
      const row = byCode.get(code);
      expect(row).toBeDefined();
      expect(row!.status).toBe('ใช้งาน');
    });
  });

  describe('บัญชีฝั่งเครดิตของ JE ยอดยกมา', () => {
    const creditSide = [
      'S21-1101', // เจ้าหนี้ซัพพลายเออร์มือถือ
      'S21-1102', // เจ้าหนี้อุปกรณ์เสริม
      'S21-2001', // เงินดาวน์รับล่วงหน้า
      'S21-4101', // เงินกู้ยืมกรรมการ
      'S32-1101', // กำไรสะสม — ตัวปิด
    ];

    it.each(creditSide)('%s มีอยู่ในผัง ยอดปกติ Cr', (code) => {
      const row = byCode.get(code);
      expect(row).toBeDefined();
      expect(row!.normalBalance).toBe('Cr');
    });
  });

  describe('S21-3001 ถูกแทนที่ด้วย S21-1104 แล้ว (คำวินิจฉัยผู้สอบ 2026-08-24 ข้อ A1+B4)', () => {
    it('S21-3001 ไม่อยู่ในผังอีกต่อไป', () => {
      // เป็นการยืนยันทิศกลับ (assert ว่า "ไม่มี") แบบเดียวกับ 42-1106/42-1107
      // ใน exchange-coa.spec.ts — กันการเพิ่มกลับเข้ามาเงียบๆ
      expect(byCode.get('S21-3001')).toBeUndefined();
    });

    it('S21-1104 เป็นบัญชีเจ้าหนี้ FINANCE ตัวเดียวที่เหลืออยู่', () => {
      const financePayables = rows
        .filter((r) => r.type === 'หนี้สิน' && r.name.includes('FINANCE'))
        .map((r) => r.code);
      expect(financePayables).toEqual(['S21-1104']);
    });
  });
});
