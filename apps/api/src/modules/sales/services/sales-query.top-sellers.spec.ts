import { SalesQueryService } from './sales-query.service';
import { PrismaService } from '../../../prisma/prisma.service';

/** ขายดี 30 วัน สำหรับหน้าหลักหน้าร้าน — จัดกลุ่มตามรุ่นและหมวด (ไม่ใช่ต่อเครื่องเหมือน getTopSellingProducts) */
describe('SalesQueryService.getTopSellers30d', () => {
  const owner = { id: 'owner', role: 'OWNER' };
  const rows = [
    { product: { brand: 'Apple', model: 'iPhone 15', category: 'PHONE_NEW' } },
    { product: { brand: 'Apple', model: 'iPhone 15', category: 'PHONE_NEW' } },
    { product: { brand: 'Samsung', model: 'A16', category: 'PHONE_NEW' } },
    { product: { brand: 'Apple', model: 'ฟิล์มกระจก', category: 'ACCESSORY' } },
  ];

  function fixture() {
    const db = { sale: { findMany: jest.fn().mockResolvedValue(rows) } };
    return { db, service: new SalesQueryService(db as unknown as PrismaService) };
  }

  it('จัดกลุ่มตามรุ่นและหมวด เรียงมาก→น้อย และกรอง 30 วัน + ใบที่ไม่ถูกยกเลิก', async () => {
    const { db, service } = fixture();
    const r = await service.getTopSellers30d(owner);

    expect(r.byModel[0]).toEqual({ name: 'Apple iPhone 15', count: 2 });
    expect(r.byModel).toHaveLength(3);
    expect(r.byCategory).toEqual([
      { name: 'PHONE_NEW', count: 3 },
      { name: 'ACCESSORY', count: 1 },
    ]);

    const where = db.sale.findMany.mock.calls[0][0].where;
    expect(where.createdAt.gte).toBeInstanceOf(Date);
    expect(Date.now() - where.createdAt.gte.getTime()).toBeGreaterThan(29 * 86400000);
    expect(where.deletedAt).toBeNull();
    expect(where.AND).toEqual(expect.any(Array));
  });

  it('ส่ง branchId ต่อเข้า where สำหรับบทบาทข้ามสาขา', async () => {
    const { db, service } = fixture();
    await service.getTopSellers30d(owner, 'b-2');
    expect(db.sale.findMany.mock.calls[0][0].where.branchId).toBe('b-2');
  });

  it('SALES ไม่มีสาขา → where id in [] (ไม่ throw) และผลว่าง', async () => {
    const db = { sale: { findMany: jest.fn().mockResolvedValue([]) } };
    const service = new SalesQueryService(db as unknown as PrismaService);
    const r = await service.getTopSellers30d({ id: 'u', role: 'SALES', branchId: null });
    expect(r).toEqual({ byModel: [], byCategory: [] });
    expect(db.sale.findMany.mock.calls[0][0].where.id).toEqual({ in: [] });
  });

  it('สูงสุด 5 อันดับต่อกลุ่ม', async () => {
    const many = Array.from({ length: 8 }, (_, i) => ({
      product: { brand: 'B', model: `M${i}`, category: `C${i}` },
    }));
    const db = { sale: { findMany: jest.fn().mockResolvedValue(many) } };
    const service = new SalesQueryService(db as unknown as PrismaService);
    const r = await service.getTopSellers30d(owner);
    expect(r.byModel).toHaveLength(5);
    expect(r.byCategory).toHaveLength(5);
  });
});
