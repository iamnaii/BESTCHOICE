import { AfterSalesQueryService } from '../services/after-sales-query.service';
import { PrismaService } from '../../../prisma/prisma.service';

/** การ์ด "หลังการขายรอลูกค้ารับ" บนหน้าหลักหน้าร้าน — overdue = รอเกิน STALE_DAYS.READY_FOR_PICKUP (7 วัน) */
describe('AfterSalesQueryService.countReadyForPickup', () => {
  const now = new Date('2026-10-22T03:00:00Z');
  const daysAgo = (d: number) => new Date(now.getTime() - d * 86400000);

  function fixture(rows: unknown[]) {
    const db = { afterSalesCase: { findMany: jest.fn().mockResolvedValue(rows) } };
    return { db, service: new AfterSalesQueryService(db as unknown as PrismaService) };
  }

  it('นับเคสรอรับ และเคสที่รอเกิน 7 วันเป็น overdue (นับจาก repairedAt หรือ approvedAt)', async () => {
    const { db, service } = fixture([
      { receivedAt: daysAgo(10), approvedAt: null, repairTicket: { sentToRepairAt: daysAgo(9), repairedAt: daysAgo(1) } },
      { receivedAt: daysAgo(20), approvedAt: null, repairTicket: { sentToRepairAt: daysAgo(19), repairedAt: daysAgo(8) } },
      { receivedAt: daysAgo(40), approvedAt: daysAgo(30), repairTicket: null },
    ]);

    expect(await service.countReadyForPickup('b-1', now)).toEqual({ waitingPickup: 3, overdue: 2 });

    const where = db.afterSalesCase.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ deletedAt: null, stage: 'READY_FOR_PICKUP', branchId: 'b-1' });
  });

  it('ไม่ส่ง branchId → ไม่กรองสาขา และไม่มีเคส → 0', async () => {
    const { db, service } = fixture([]);
    expect(await service.countReadyForPickup(undefined, now)).toEqual({ waitingPickup: 0, overdue: 0 });
    expect(db.afterSalesCase.findMany.mock.calls[0][0].where).not.toHaveProperty('branchId');
  });
});
