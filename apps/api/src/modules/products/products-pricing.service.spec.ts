import { BadRequestException } from '@nestjs/common';
import { ProductsPricingService } from './products-pricing.service';

describe('ProductsPricingService — แถว "ราคาผ่อนไฟแนนซ์" ห้ามเป็นค่าเริ่มต้น', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let tx: any;
  let service: ProductsPricingService;

  beforeEach(() => {
    tx = {
      productPrice: {
        findFirst: jest.fn().mockResolvedValue({ id: 'pr-f', label: 'ราคาผ่อนไฟแนนซ์', isDefault: false }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        update: jest.fn().mockResolvedValue({ id: 'pr-f' }),
        create: jest.fn().mockResolvedValue({ id: 'pr-new' }),
      },
    };
    const prisma = {
      product: { findUnique: jest.fn().mockResolvedValue({ id: 'p-1', deletedAt: null }) },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      $transaction: jest.fn(async (fn: any) => fn(tx)),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    service = new ProductsPricingService(prisma as any);
  });

  it('updatePrice: ตั้งแถวไฟแนนซ์เป็นค่าเริ่มต้น → 400 ไม่เขียนอะไร', async () => {
    await expect(service.updatePrice('p-1', 'pr-f', { isDefault: true })).rejects.toThrow(BadRequestException);
    await expect(service.updatePrice('p-1', 'pr-f', { isDefault: true })).rejects.toThrow(/ไฟแนนซ์/);
    expect(tx.productPrice.update).not.toHaveBeenCalled();
    expect(tx.productPrice.updateMany).not.toHaveBeenCalled();
  });

  it('updatePrice: แก้ตัวเลขแถวไฟแนนซ์ (ไม่แตะค่าเริ่มต้น) ยังผ่าน', async () => {
    await expect(service.updatePrice('p-1', 'pr-f', { amount: 20000 })).resolves.toBeDefined();
  });

  it('addPrice: label ไฟแนนซ์ + isDefault true → 400', async () => {
    await expect(
      service.addPrice('p-1', { label: ' ราคาผ่อนไฟแนนซ์ ', amount: 20000, isDefault: true }),
    ).rejects.toThrow(BadRequestException);
    expect(tx.productPrice.create).not.toHaveBeenCalled();
  });

  it('updatePrice: เปลี่ยนชื่อแถวอื่นเป็นไฟแนนซ์ + ค่าเริ่มต้น → 400', async () => {
    tx.productPrice.findFirst.mockResolvedValue({ id: 'pr-x', label: 'ราคาส่ง', isDefault: false });
    await expect(
      service.updatePrice('p-1', 'pr-x', { label: 'ราคาผ่อนไฟแนนซ์', isDefault: true }),
    ).rejects.toThrow(BadRequestException);
  });

  it('updatePrice: เปลี่ยนชื่อแถวที่เป็นค่าเริ่มต้นอยู่แล้วเป็นไฟแนนซ์ (ไม่ส่ง isDefault) → 400', async () => {
    tx.productPrice.findFirst.mockResolvedValue({ id: 'pr-d', label: 'ราคาเงินสด', isDefault: true });
    await expect(
      service.updatePrice('p-1', 'pr-d', { label: 'ราคาผ่อนไฟแนนซ์' }),
    ).rejects.toThrow(BadRequestException);
    expect(tx.productPrice.update).not.toHaveBeenCalled();
  });

  it('updatePrice: แถวไฟแนนซ์เดิมที่เป็นค่าเริ่มต้นอยู่ (legacy) ปลดค่าเริ่มต้นได้', async () => {
    tx.productPrice.findFirst.mockResolvedValue({ id: 'pr-f', label: 'ราคาผ่อนไฟแนนซ์', isDefault: true });
    await expect(service.updatePrice('p-1', 'pr-f', { isDefault: false })).resolves.toBeDefined();
  });
});
