import { ProductsService } from './products.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('POS compatible accessory query', () => {
  it('filters exact declared models before pagination and binds stock to the main device branch', async () => {
    const device = { brand: 'Apple', model: 'iPhone 15', category: 'PHONE_NEW', branchId: 'b1' };
    const candidates = [
      ...Array.from({ length: 12 }, (_, i) => ({ id: `wrong-${i}`, brand: 'Apple', model: 'iPhone 15 Pro', category: 'ACCESSORY' })),
      { id: 'compatible', brand: 'Apple', model: 'iPhone 14, iPhone 15', category: 'ACCESSORY' },
    ];
    const db = { product: { findFirst: jest.fn().mockResolvedValue(device),
      findMany: jest.fn().mockResolvedValueOnce(candidates).mockResolvedValueOnce([]), count: jest.fn().mockResolvedValue(1) },
      systemConfig: { findUnique: jest.fn().mockResolvedValue(null), findFirst: jest.fn().mockResolvedValue(null) } };
    const result = await new ProductsService(db as unknown as PrismaService).findAll({ compatibleWithProductId: 'phone', search: 'ฟิล์ม', limit: 10 });
    expect(db.product.findMany.mock.calls[0][0]).toMatchObject({ where: { branchId: 'b1', category: 'ACCESSORY', status: 'IN_STOCK', deletedAt: null } });
    expect(db.product.findMany.mock.calls[1][0]).toMatchObject({ where: { id: { in: ['compatible'] } }, take: 10 });
    expect(result.total).toBe(1);
  });
  it('scans bounded batches and retains only the requested page while counting every match', async () => {
    const device = { brand: 'Apple', model: 'iPhone 15', category: 'PHONE_NEW', branchId: 'b1' };
    const candidate = (id: number) => ({ id: String(id), brand: 'Apple', model: 'iPhone 15', category: 'ACCESSORY' });
    const db = { product: { findFirst: jest.fn().mockResolvedValue(device),
      findMany: jest.fn().mockResolvedValueOnce(Array.from({ length: 500 }, (_, i) => candidate(i)))
        .mockResolvedValueOnce([candidate(500)]).mockResolvedValueOnce([]), count: jest.fn() },
      systemConfig: { findUnique: jest.fn().mockResolvedValue(null), findFirst: jest.fn().mockResolvedValue(null) } };
    const result = await new ProductsService(db as unknown as PrismaService).findAll({ compatibleWithProductId: 'phone', page: 51, limit: 10 });
    expect(db.product.findMany.mock.calls[0][0].take).toBe(500);
    expect(db.product.findMany.mock.calls[1][0]).toMatchObject({ take: 500, cursor: { id: '499' }, skip: 1 });
    expect(db.product.findMany.mock.calls[2][0]).toMatchObject({ where: { id: { in: ['500'] } }, skip: 0, take: 10 });
    expect(db.product.count).not.toHaveBeenCalled();
    expect(result.total).toBe(501);
  });
  it('refuses a device outside the permitted branch', async () => {
    const db = { product: { findFirst: jest.fn().mockResolvedValue(null) } };
    await expect(new ProductsService(db as unknown as PrismaService).findAll({ compatibleWithProductId: 'phone', branchId: 'allowed' })).rejects.toThrow('ไม่พบสินค้าหลักในสาขานี้');
    expect(db.product.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'phone', deletedAt: null, branchId: 'allowed' } }));
  });
});
