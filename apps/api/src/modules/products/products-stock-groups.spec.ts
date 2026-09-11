import { findStockGroups } from './products-stock-groups';
import type { PrismaService } from '../../prisma/prisma.service';

/**
 * สวิตช์ "พร้อมขาย | ทั้งหมด" บนหน้ารายการสินค้า (คำขอเจ้าของ 2026-09-11) ต้องได้ตัวเลขทั้งสองฝั่ง
 * มากับผลค้นหาในคำขอเดียว — นับตามหมวด/สาขา/คำค้นเดียวกัน แต่ **ไม่สน** ตัวกรองสถานะที่ส่งมา
 * (ไม่งั้นกด "พร้อมขาย" แล้วฝั่ง "ทั้งหมด" จะโชว์เลขเดียวกัน)
 */
function fakePrisma(rows: { total: number; ready: number; all: number }) {
  const queries: string[] = [];
  const tx = {
    $queryRaw: jest.fn(async (query: { sql?: string; strings?: string[] }) => {
      const text = query.sql ?? (query.strings ?? []).join('?');
      queries.push(text);
      if (text.includes('AS "readyTotal"')) return [{ readyTotal: rows.ready, allTotal: rows.all }];
      if (text.includes('AS total')) return [{ total: rows.total }];
      return [];
    }),
    product: { findMany: jest.fn(async () => []) },
  };
  const prisma = {
    $transaction: jest.fn((fn: (client: typeof tx) => Promise<unknown>) => fn(tx)),
  } as unknown as PrismaService;
  return { prisma, queries };
}

describe('findStockGroups — viewCounts สำหรับสวิตช์ พร้อมขาย | ทั้งหมด', () => {
  it('ส่ง viewCounts.ready/all มากับหน้า โดยนับจากตัวกรองเดิมแต่ไม่รวมตัวกรองสถานะ', async () => {
    const { prisma, queries } = fakePrisma({ total: 3, ready: 3, all: 7 });

    const result = await findStockGroups(
      prisma,
      { groupAccessories: true, status: 'IN_STOCK', category: 'PHONE_NEW', search: 'iPhone' },
      {} as never,
    );

    expect(result.total).toBe(3);
    expect(result.viewCounts).toEqual({ ready: 3, all: 7 });
    const countsQuery = queries.find((q) => q.includes('AS "readyTotal"'));
    expect(countsQuery).toBeDefined();
    // นับ "พร้อมขาย" ด้วย FILTER บนสถานะ IN_STOCK และฐานของคิวรีต้องไม่มีตัวกรองสถานะที่ผู้ใช้ส่งมา
    expect(countsQuery).toContain("FILTER (WHERE status::text = 'IN_STOCK')");
    expect(countsQuery).not.toContain('p.status::text IN (');
    // ตัวกรองอื่น (หมวด/คำค้น) ยังอยู่ในฐานของคิวรีนับ
    expect(countsQuery).toContain('p.category::text = ');
    expect(countsQuery).toContain('ILIKE');
  });

  it('หน้าเรียงลำดับที่ไม่มีแถว (sortedKeys ว่าง) ก็ยังคืน viewCounts', async () => {
    const { prisma } = fakePrisma({ total: 0, ready: 0, all: 4 });
    const result = await findStockGroups(
      prisma,
      { groupAccessories: true, status: 'IN_STOCK', sortBy: 'cashPrice', sortDirection: 'asc', page: 9 },
      {} as never,
    );
    expect(result.data).toEqual([]);
    expect(result.viewCounts).toEqual({ ready: 0, all: 4 });
  });
});
