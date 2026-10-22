import { Prisma } from '@prisma/client';
import { ShopCashCloseService, EFFECTIVE_CASH_CLOSE_STATUSES } from './shop-cash-close.service';
import { PrismaService } from '../../prisma/prisma.service';

/** การ์ด "เงินสดในลิ้นชัก" บนหน้าหลักหน้าร้าน — รวมทุกสาขาเมื่อไม่ระบุ และบอกว่าปิดยอดวันนี้ครบหรือยัง */
describe('ShopCashCloseService.getDrawerSnapshot', () => {
  const now = new Date('2026-10-22T03:00:00Z'); // 10:00 เวลาไทย
  const stub = {} as never;

  function fixture(opts: {
    branches: { id: string; name: string }[];
    expected: Record<string, number>;
    todayCloses: { branchId: string }[];
    lastClose: { countedAt: Date } | null;
  }) {
    const db = {
      branch: { findMany: jest.fn().mockResolvedValue(opts.branches) },
      shopCashClose: {
        findMany: jest.fn().mockResolvedValue(opts.todayCloses),
        findFirst: jest.fn().mockResolvedValue(opts.lastClose),
      },
    };
    const service = new ShopCashCloseService(db as unknown as PrismaService, stub, stub, stub, stub, stub);
    const computeRound = jest
      .spyOn(service, 'computeRound')
      .mockImplementation(async (_db, branchId) => ({ expectedAmount: new Prisma.Decimal(opts.expected[branchId]) }) as never);
    return { db, service, computeRound };
  }

  it('ไม่ส่ง branchId → รวม expectedAmount ทุกสาขา และ closedToday=false ถ้ามีสาขาที่ยังไม่ปิด', async () => {
    const { db, service, computeRound } = fixture({
      branches: [{ id: 'b-1', name: 'สำนักงานใหญ่' }, { id: 'b-2', name: 'สาขา 2' }],
      expected: { 'b-1': 12450, 'b-2': 8000 },
      todayCloses: [{ branchId: 'b-1' }],
      lastClose: { countedAt: new Date('2026-10-22T02:00:00Z') },
    });

    expect(await service.getDrawerSnapshot(undefined, now)).toEqual({
      balance: 20450,
      closedToday: false,
      lastClosedAt: '2026-10-22T02:00:00.000Z',
    });
    expect(computeRound).toHaveBeenCalledTimes(2);
    expect(db.branch.findMany.mock.calls[0][0].where).toMatchObject({ deletedAt: null });

    const todayWhere = db.shopCashClose.findMany.mock.calls[0][0].where;
    expect(todayWhere.branchId).toEqual({ in: ['b-1', 'b-2'] });
    expect(todayWhere.status).toEqual({ in: EFFECTIVE_CASH_CLOSE_STATUSES });
    expect(todayWhere.countedAt.gte).toEqual(new Date('2026-10-21T17:00:00Z')); // เที่ยงคืนไทยของวันนี้
  });

  it('ส่ง branchId → เฉพาะสาขานั้น และ closedToday=true เมื่อมี close วันนี้', async () => {
    const { db, service, computeRound } = fixture({
      branches: [],
      expected: { 'b-1': 12450 },
      todayCloses: [{ branchId: 'b-1' }],
      lastClose: { countedAt: new Date('2026-10-22T02:00:00Z') },
    });

    expect(await service.getDrawerSnapshot('b-1', now)).toEqual({
      balance: 12450,
      closedToday: true,
      lastClosedAt: '2026-10-22T02:00:00.000Z',
    });
    expect(db.branch.findMany).not.toHaveBeenCalled();
    expect(computeRound).toHaveBeenCalledWith(expect.anything(), 'b-1', now);
  });

  it('ไม่มีสาขา → balance 0, closedToday false, lastClosedAt null โดยไม่คำนวณรอบ', async () => {
    const { service, computeRound } = fixture({ branches: [], expected: {}, todayCloses: [], lastClose: null });
    expect(await service.getDrawerSnapshot(undefined, now)).toEqual({ balance: 0, closedToday: false, lastClosedAt: null });
    expect(computeRound).not.toHaveBeenCalled();
  });
});
