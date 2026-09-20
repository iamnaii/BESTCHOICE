/**
 * ของแถมในสัญญาผ่อน (2026-09-20) — วงจรเดียวกับเครื่องหลัก:
 * สร้างสัญญา = จอง · เปิดใช้ = ตัดสต๊อก · ลบร่าง = ปล่อย · ยกเลิกสัญญา = คืนเข้าคลัง
 */
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import {
  normalizeBundleIds,
  reserveContractBundles,
  releaseContractBundles,
  sellContractBundles,
  restoreContractBundles,
  MAX_CONTRACT_BUNDLES,
} from './contract-bundle.util';

const realCustomer = { id: 'c1', name: 'ลูกค้าจริง', phone: '0891234567', addressCurrent: 'กรุงเทพ' };

function accessory(id: string, over: Record<string, unknown> = {}) {
  return {
    id, name: `เคส ${id}`, imeiSerial: null, po: null, category: 'ACCESSORY',
    status: 'IN_STOCK', deletedAt: null, branchId: 'br-1', wasPreviouslyDamaged: false, ...over,
  };
}

function makeTx(products: unknown[]) {
  return {
    product: {
      findMany: jest.fn().mockResolvedValue(products),
      updateMany: jest.fn().mockResolvedValue({ count: products.length }),
    },
    productReservation: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
  };
}

const base = { mainProductId: 'main-1', branchId: 'br-1', actor: { role: 'SALES', branchId: 'br-1' }, customer: realCustomer };

describe('normalizeBundleIds', () => {
  it('ตัดค่าว่าง + ตัดตัวซ้ำ คงลำดับเดิม', () => {
    expect(normalizeBundleIds(['a', '', 'b', 'a'])).toEqual(['a', 'b']);
    expect(normalizeBundleIds(undefined)).toEqual([]);
    expect(normalizeBundleIds(null)).toEqual([]);
  });
});

describe('reserveContractBundles — จองของแถมตอนสร้างสัญญา', () => {
  it('ไม่มีของแถม → ไม่แตะ DB เลย', async () => {
    const tx = makeTx([]);
    await reserveContractBundles(tx as never, { ...base, bundleProductIds: [] });
    expect(tx.product.findMany).not.toHaveBeenCalled();
    expect(tx.product.updateMany).not.toHaveBeenCalled();
  });

  it('อุปกรณ์เสริมพร้อมขายสาขาเดียวกัน → RESERVED เฉพาะแถวที่ยัง IN_STOCK + ตัด hold ของเว็บ', async () => {
    const tx = makeTx([accessory('a1'), accessory('a2')]);
    await reserveContractBundles(tx as never, { ...base, bundleProductIds: ['a1', 'a2'] });
    expect(tx.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ['a1', 'a2'] }, deletedAt: null } }),
    );
    expect(tx.product.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['a1', 'a2'] }, status: 'IN_STOCK', deletedAt: null },
      data: { status: 'RESERVED' },
    });
    expect(tx.productReservation.updateMany).toHaveBeenCalled();
  });

  it.each(['PHONE_NEW', 'PHONE_USED', 'TABLET'])('ของแถมหมวด %s → BadRequest ไม่มีอะไรถูกจอง', async (category) => {
    const tx = makeTx([accessory('a1', { category, name: 'iPhone 13' })]);
    await expect(reserveContractBundles(tx as never, { ...base, bundleProductIds: ['a1'] }))
      .rejects.toThrow('ของแถมเลือกได้เฉพาะสินค้าหมวดอุปกรณ์เสริม — "iPhone 13" ไม่ใช่อุปกรณ์เสริม');
    expect(tx.product.updateMany).not.toHaveBeenCalled();
  });

  it('ของแถมไม่พร้อมขาย (ถูกจอง/ขายไปแล้ว) → BadRequest', async () => {
    const tx = makeTx([accessory('a1', { status: 'RESERVED' })]);
    await expect(reserveContractBundles(tx as never, { ...base, bundleProductIds: ['a1'] }))
      .rejects.toThrow(BadRequestException);
    expect(tx.product.updateMany).not.toHaveBeenCalled();
  });

  it('ของแถมคนละสาขากับสัญญา → Forbidden (กติกาเดียวกับ POS)', async () => {
    const tx = makeTx([accessory('a1', { branchId: 'br-2' })]);
    await expect(reserveContractBundles(tx as never, { ...base, bundleProductIds: ['a1'] }))
      .rejects.toThrow(ForbiddenException);
  });

  it('หาไม่ครบ (ถูกลบ/รหัสผิด) → BadRequest', async () => {
    const tx = makeTx([accessory('a1')]);
    await expect(reserveContractBundles(tx as never, { ...base, bundleProductIds: ['a1', 'ghost'] }))
      .rejects.toThrow('ไม่พบสินค้าของแถมบางรายการ');
  });

  it('เลือกเครื่องหลักของสัญญามาเป็นของแถม → BadRequest', async () => {
    const tx = makeTx([]);
    await expect(reserveContractBundles(tx as never, { ...base, bundleProductIds: ['main-1'] }))
      .rejects.toThrow('ของแถมซ้ำกับเครื่องหลักของสัญญา');
    expect(tx.product.findMany).not.toHaveBeenCalled();
  });

  it(`เกิน ${MAX_CONTRACT_BUNDLES} ชิ้น → BadRequest`, async () => {
    const ids = Array.from({ length: MAX_CONTRACT_BUNDLES + 1 }, (_, i) => `a${i}`);
    const tx = makeTx([]);
    await expect(reserveContractBundles(tx as never, { ...base, bundleProductIds: ids }))
      .rejects.toThrow(`ของแถมต่อสัญญาได้ไม่เกิน ${MAX_CONTRACT_BUNDLES} ชิ้น`);
  });

  it('รั้วข้อมูลทดสอบ: ของแถมจาก PO ทดสอบ → ลูกค้าจริง ต้องดัง', async () => {
    const tx = makeTx([accessory('a1', { name: 'สายชาร์จ', po: { poNumber: 'TEST-PO-0001' } })]);
    await expect(reserveContractBundles(tx as never, { ...base, bundleProductIds: ['a1'] }))
      .rejects.toThrow(/สายชาร์จ/);
    expect(tx.product.updateMany).not.toHaveBeenCalled();
  });

  it('แพ้ race (มีคนหยิบของแถมไประหว่างตรวจกับจอง) → BadRequest ไม่จองครึ่ง ๆ', async () => {
    const tx = makeTx([accessory('a1'), accessory('a2')]);
    tx.product.updateMany.mockResolvedValue({ count: 1 });
    await expect(reserveContractBundles(tx as never, { ...base, bundleProductIds: ['a1', 'a2'] }))
      .rejects.toThrow('ของแถมบางรายการเพิ่งถูกขายหรือจองไป กรุณาเลือกใหม่');
  });
});

describe('releaseContractBundles — ลบร่าง/นำของแถมออก', () => {
  it('ปล่อยเฉพาะแถวที่ยัง RESERVED กลับเป็น IN_STOCK', async () => {
    const tx = makeTx([]);
    await releaseContractBundles(tx as never, ['a1', 'a2']);
    expect(tx.product.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['a1', 'a2'] }, status: 'RESERVED' },
      data: { status: 'IN_STOCK' },
    });
  });

  it('ไม่มีของแถม → ไม่แตะ DB', async () => {
    const tx = makeTx([]);
    await releaseContractBundles(tx as never, []);
    expect(tx.product.updateMany).not.toHaveBeenCalled();
  });
});

describe('sellContractBundles — เปิดใช้สัญญา', () => {
  it('RESERVED → SOLD_CASH (สถานะเดียวกับของแถมที่ขายผ่าน POS)', async () => {
    const tx = makeTx([]);
    tx.product.updateMany.mockResolvedValue({ count: 2 });
    await sellContractBundles(tx as never, ['a1', 'a2']);
    expect(tx.product.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['a1', 'a2'] }, status: 'RESERVED', deletedAt: null },
      data: { status: 'SOLD_CASH' },
    });
  });

  it('ของแถมบางชิ้นไม่ได้อยู่ในสถานะจอง (ถูกลบ/แก้มือ) → BadRequest ทั้งการเปิดใช้ย้อนกลับ', async () => {
    const tx = makeTx([]);
    tx.product.updateMany.mockResolvedValue({ count: 1 });
    await expect(sellContractBundles(tx as never, ['a1', 'a2'])).rejects.toThrow(
      'ของแถมของสัญญานี้บางรายการไม่อยู่ในสถานะจองแล้ว — เปิดหน้ารายละเอียดสัญญา กด "แก้ไข" ที่การ์ดของแถม แล้วเลือกใหม่ก่อนเปิดใช้สัญญา',
    );
  });
});

describe('restoreContractBundles — ยกเลิกสัญญาหลังเปิดใช้', () => {
  it('SOLD_CASH → IN_STOCK และรายงานชิ้นที่คืนไม่ได้ (ไม่บล็อกการยกเลิก)', async () => {
    const tx = makeTx([{ id: 'a1' }]);
    tx.product.updateMany.mockResolvedValue({ count: 1 });
    const result = await restoreContractBundles(tx as never, ['a1', 'a2']);
    expect(tx.product.findMany).toHaveBeenCalledWith({
      where: { id: { in: ['a1', 'a2'] }, status: 'SOLD_CASH', deletedAt: null },
      select: { id: true },
    });
    expect(tx.product.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['a1'] }, status: 'SOLD_CASH' },
      data: { status: 'IN_STOCK' },
    });
    expect(result).toEqual({ restoredIds: ['a1'], skippedIds: ['a2'] });
  });

  it('ไม่มีของแถม → ไม่แตะ DB', async () => {
    const tx = makeTx([]);
    expect(await restoreContractBundles(tx as never, [])).toEqual({ restoredIds: [], skippedIds: [] });
    expect(tx.product.findMany).not.toHaveBeenCalled();
  });
});
