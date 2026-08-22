import { Prisma } from '@prisma/client';
import {
  ENTER_STOCK_AUDIT_ACTION,
  hasSellingPrice,
  unconfirmedLeftoverPrices,
  unconfirmedPriceMessage,
} from './product-enter-stock.util';

const D = (v: string) => new Prisma.Decimal(v);

/**
 * Fix round 3 [Minor 3] — asymmetry ในไฟล์เดียวกัน: `hasSellingPrice` รู้จัก **แถว**
 * `prices[]` (fallback ของเครื่องยุคก่อนคอลัมน์) แต่ด่าน "ยืนยันราคา" เดิมอ่านเฉพาะ
 * **คอลัมน์** ⇒ เครื่องที่คอลัมน์ว่างทั้งคู่แต่มีแถว default ค้างอยู่ (เกิดได้จาก PATCH
 * `cashPrice: null` หรือ `POST /products/:id/prices` ที่ตั้ง label เอง) ผ่านด่านได้ทั้งที่
 * `syncPriceRowsFromColumns` จะไม่ทับแถวนั้น (`keepDefaultId` = null เมื่อมี default เดิม)
 * ⇒ แถวราคาเก่ายังเป็น default ที่ POS/บอท (`isDefault take:1`) หยิบไปขาย
 */
describe('unconfirmedLeftoverPrices — ราคาบวกที่ค้างอยู่ต้องถูกยืนยัน ไม่ว่าอยู่ในคอลัมน์หรือแถว', () => {
  const staleDefaultRow = {
    label: 'ราคาขาย',
    amount: D('15900'),
    isDefault: true,
    deletedAt: null,
  };

  it('เคส headline: คอลัมน์ว่างทั้งคู่ + แถว default ค้าง 15900 → ยืนยันเฉพาะราคาผ่อนไม่พอ', () => {
    const product = { cashPrice: null, installmentPrice: null, prices: [staleDefaultRow] };
    // `hasSellingPrice` มองเห็นแถวนี้อยู่แล้ว — ด่านยืนยันต้องมองเห็นด้วย ไม่งั้นไม่สมมาตร
    expect(hasSellingPrice(product)).toBe(true);

    const left = unconfirmedLeftoverPrices(product, {
      cashPrice: null,
      installmentPrice: D('19900'),
    });
    expect(left.columns).toEqual([]);
    expect(left.rows).toEqual(['แถวราคา "ราคาขาย" 15900']);

    /**
     * Fix round 4 [Important 2 ข] — ข้อความเดิมสั่งให้ "ลบหรือแก้แถวราคานั้น" ที่หน้า
     * "จัดการราคา" แต่เคสนี้ (แถวเดียว) **ลบไม่ได้**: `removePrice` ปฏิเสธด้วย
     * 'ต้องมีอย่างน้อย 1 ราคาขาย' ⇒ ทำตามคำแนะนำแล้วตัน. ทางออกที่ได้ผลจริงคือ
     * ยืนยัน "ราคาเงินสด" ในฟอร์มเดียวกันนี้ ซึ่ง sync จะทับแถว default นั้นให้เอง
     */
    expect(left.cashConfirmAbsorbs).toBe(true);
    const msg = unconfirmedPriceMessage(left)!;
    expect(msg).toMatch(/ยืนยัน "ราคาเงินสด"/);
    expect(msg).not.toContain('ลบ');
  });

  it('แถวที่ค้างอยู่จะถูกทับถ้ายืนยันราคาเงินสด → cashConfirmAbsorbs = true', () => {
    const left = unconfirmedLeftoverPrices(
      { cashPrice: null, installmentPrice: null, prices: [staleDefaultRow] },
      { cashPrice: null, installmentPrice: null },
    );
    expect(left.cashConfirmAbsorbs).toBe(true);
  });

  it('ยืนยันราคาเงินสดแทน → sync จะทับแถว default นั้นเอง ⇒ ไม่มีอะไรค้าง', () => {
    const left = unconfirmedLeftoverPrices(
      { cashPrice: null, installmentPrice: null, prices: [staleDefaultRow] },
      { cashPrice: D('9900'), installmentPrice: null },
    );
    expect(left.rows).toEqual([]);
    expect(unconfirmedPriceMessage(left)).toBeNull();
  });

  it('แถว canonical ที่ sync ทับแน่ ๆ (ราคาเงินสด / ราคาผ่อน BESTCHOICE) ไม่นับเป็นค้าง', () => {
    const left = unconfirmedLeftoverPrices(
      {
        cashPrice: null,
        installmentPrice: null,
        prices: [
          { label: 'ราคาเงินสด', amount: D('15900'), isDefault: true, deletedAt: null },
          { label: 'ราคาผ่อน BESTCHOICE', amount: D('19900'), isDefault: false, deletedAt: null },
        ],
      },
      { cashPrice: D('9900'), installmentPrice: D('11900') },
    );
    expect(left.rows).toEqual([]);
  });

  it('แถวที่ไม่ถูกทับแม้ยืนยันครบสองช่อง (แถวโปรโมชั่นค้าง) → ยังต้องจัดการก่อน', () => {
    const left = unconfirmedLeftoverPrices(
      {
        cashPrice: null,
        installmentPrice: null,
        prices: [
          { label: 'ราคาเงินสด', amount: D('15900'), isDefault: true, deletedAt: null },
          { label: 'ราคาโปรโมชั่น', amount: D('12900'), isDefault: false, deletedAt: null },
        ],
      },
      { cashPrice: D('9900'), installmentPrice: D('11900') },
    );
    expect(left.rows).toEqual(['แถวราคา "ราคาโปรโมชั่น" 12900']);

    // fix round 4: ยืนยันเงินสดไปแล้วแต่แถวนี้ยังรอด ⇒ ทางออกอยู่ที่หน้า "จัดการราคา"
    // (เครื่องมี 2 แถว จึงลบแถวโปรโมชั่นได้จริง — `removePrice` ต้องเหลืออย่างน้อย 1 แถว)
    expect(left.cashConfirmAbsorbs).toBe(false);
    expect(unconfirmedPriceMessage(left)).toMatch(/จัดการราคา/);
  });

  it('แถวที่ถูก soft-delete / ยอด 0 ไม่นับ (ตรงกับ hasSellingPrice)', () => {
    const left = unconfirmedLeftoverPrices(
      {
        cashPrice: null,
        installmentPrice: null,
        prices: [
          { label: 'ราคาเก่า', amount: D('15900'), isDefault: false, deletedAt: new Date() },
          { label: 'ราคาศูนย์', amount: D('0'), isDefault: false, deletedAt: null },
        ],
      },
      { cashPrice: null, installmentPrice: D('11900') },
    );
    expect(left.rows).toEqual([]);
  });

  it('คอลัมน์ที่มีราคาเก่าแต่ไม่ยืนยัน → ยังรายงานเหมือนเดิม (round 2)', () => {
    const left = unconfirmedLeftoverPrices(
      { cashPrice: D('15900'), installmentPrice: D('19900'), prices: [] },
      { cashPrice: null, installmentPrice: D('11900') },
    );
    expect(left.columns).toEqual(['ราคาเงินสดเดิม 15900']);
  });

  /**
   * Fix round 3 [Important 2] — ข้อความเดิมชี้ไปที่ "แก้ราคาขาย" เพื่อ **ล้าง** ราคา
   * ทั้งที่ฟอร์มนั้นล้างคอลัมน์ไม่ได้เลย (ช่องว่าง ⇒ `undefined` ⇒ ไม่แตะคอลัมน์)
   * ⇒ ส่งผู้ใช้ไปชนกำแพง. ข้อความต้องบอกสิ่งที่ทำได้จริงวันนี้เท่านั้น
   */
  it('ข้อความของคอลัมน์ต้องไม่ชี้ไป "แก้ราคาขาย" (ฟอร์มนั้นล้างคอลัมน์ไม่ได้)', () => {
    const msg = unconfirmedPriceMessage({ columns: ['ราคาเงินสดเดิม 15900'], rows: [] })!;
    expect(msg).toContain('ราคาเงินสดเดิม 15900');
    expect(msg).toMatch(/ยืนยันราคาเดิมหรือพิมพ์ราคาใหม่ทับ/);
    expect(msg).not.toContain('แก้ราคาขาย');
  });

  it('ไม่มีอะไรค้าง → null (ไม่โยน)', () => {
    expect(unconfirmedPriceMessage({ columns: [], rows: [] })).toBeNull();
  });

  it('action ของ AuditLog เข้าคลังเป็นค่าคงที่ตัวเดียวทุกประตู', () => {
    expect(ENTER_STOCK_AUDIT_ACTION).toBe('PRODUCT_RETURNED_TO_STOCK');
  });
});
