import { Prisma } from '@prisma/client';
import {
  resolveStoreCommission,
  STORE_COMMISSION_FALLBACK_RATE,
} from './store-commission.util';

const D = (v: string | number) => new Prisma.Decimal(v);

describe('resolveStoreCommission', () => {
  describe('ระบุค่าคอมมาแล้ว → ใช้ตามนั้น', () => {
    it('รับ Decimal', () => {
      expect(
        resolveStoreCommission({ storeCommission: D('1500'), financedAmount: D('15000') }).toFixed(2),
      ).toBe('1500.00');
    });

    it('รับ string (รูปที่ Prisma คืนมาตอน select เป็น string)', () => {
      expect(
        resolveStoreCommission({ storeCommission: '1234.56', financedAmount: D('15000') }).toFixed(2),
      ).toBe('1234.56');
    });

    it('ค่าคอม 0 ที่ระบุมาจริง = ศูนย์ ไม่ใช่ "ไม่ระบุ" — ห้ามตกไป fallback', () => {
      // นี่คือเหตุผลที่ helper ใช้ `!= null` ไม่ใช่ truthiness.
      // ถ้าเผลอเขียน `storeCommission ? … : fallback` สัญญาที่ตั้งใจให้ค่าคอม 0
      // จะโดนยัด 10% ให้เงียบ ๆ
      expect(
        resolveStoreCommission({ storeCommission: D(0), financedAmount: D('15000') }).toFixed(2),
      ).toBe('0.00');
      expect(
        resolveStoreCommission({ storeCommission: 0, financedAmount: D('15000') }).toFixed(2),
      ).toBe('0.00');
      expect(
        resolveStoreCommission({ storeCommission: '0', financedAmount: D('15000') }).toFixed(2),
      ).toBe('0.00');
    });
  });

  describe('ไม่ระบุค่าคอม → fallback 10% ของยอดจัด', () => {
    it('null → 10%', () => {
      expect(
        resolveStoreCommission({ storeCommission: null, financedAmount: D('15000') }).toFixed(2),
      ).toBe('1500.00');
    });

    it('undefined → 10%', () => {
      expect(
        resolveStoreCommission({ storeCommission: undefined, financedAmount: D('15000') }).toFixed(2),
      ).toBe('1500.00');
    });

    it('ปัดทศนิยม 2 ตำแหน่ง', () => {
      // 17000 × 0.10 = 1700 พอดี; ใช้เลขที่ลงตัวยากเพื่อพิสูจน์การปัด
      expect(
        resolveStoreCommission({ storeCommission: null, financedAmount: D('12345.67') }).toFixed(2),
      ).toBe('1234.57');
    });

    it('ยอดจัด 0 → ค่าคอม 0', () => {
      expect(
        resolveStoreCommission({ storeCommission: null, financedAmount: D(0) }).toFixed(2),
      ).toBe('0.00');
    });
  });

  describe('สอดคล้องกับสูตรเดิมของ ContractActivation1ATemplate', () => {
    // 1A เดิมเขียน `financed.times('0.10').toDecimalPlaces(2)`
    // helper ต้องให้ผลเท่ากันทุกบาททุกสตางค์ ไม่งั้น golden fixture ของ CPA จะขยับ
    it.each(['0', '1', '9999.99', '15000', '17000', '123456.78'])(
      'financed = %s ให้ผลเท่าสูตรเดิม',
      (financed) => {
        const legacy = D(financed).times('0.10').toDecimalPlaces(2);
        const actual = resolveStoreCommission({ storeCommission: null, financedAmount: D(financed) });
        expect(actual.toFixed(2)).toBe(legacy.toFixed(2));
      },
    );

    it('อัตราสำรองคือ 10%', () => {
      expect(STORE_COMMISSION_FALLBACK_RATE).toBe('0.10');
    });
  });

  describe('C1 — สองสมุดต้องได้ตัวเลขเดียวกัน (คำวินิจฉัยผู้สอบบัญชี 2026-08-24)', () => {
    it('สัญญาที่ไม่ระบุค่าคอม: FINANCE ตั้งเจ้าหนี้ = SHOP ตั้งลูกหนี้', () => {
      const contract = { storeCommission: null, financedAmount: D('15000') };

      // ฝั่ง FINANCE (contract-activation-1a) และฝั่ง SHOP (shop-inventory-transfer)
      // เรียก helper ตัวเดียวกัน ⇒ ต่างกันไม่ได้โดยโครงสร้าง
      const financeSide = resolveStoreCommission(contract);
      const shopSide = resolveStoreCommission(contract);

      expect(shopSide.toFixed(2)).toBe(financeSide.toFixed(2));
      expect(shopSide.toFixed(2)).toBe('1500.00');
      // เดิมฝั่ง SHOP ได้ '0.00' — นั่นคือ COMMISSION_ONLY_GAP
      expect(shopSide.toFixed(2)).not.toBe('0.00');
    });
  });
});
