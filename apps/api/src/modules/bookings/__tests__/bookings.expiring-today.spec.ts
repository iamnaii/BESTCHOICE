import { BookingsService, OPEN_BOOKING_STATUSES } from '../bookings.service';
import { PrismaService } from '../../../prisma/prisma.service';

/** การ์ด "ใบจองหมดอายุวันนี้" บนหน้าหลักหน้าร้าน — Booking มีแค่ expireDate ไม่มีวันนัดรับ */
describe('BookingsService.countExpiringToday', () => {
  const owner = { id: 'owner', role: 'OWNER', branchId: null };
  const stub = {} as never;

  function fixture(rows: { status: string; depositAmount: string }[]) {
    const db = { booking: { findMany: jest.fn().mockResolvedValue(rows) } };
    const service = new BookingsService(db as unknown as PrismaService, stub, stub, stub, stub, stub, stub);
    return { db, service };
  }

  it('นับเฉพาะใบเปิดที่หมดอายุวันนี้ และรวมมัดจำของใบที่จ่ายแล้ว', async () => {
    const { db, service } = fixture([
      { status: 'PAID', depositAmount: '3000' },
      { status: 'PENDING_DEPOSIT', depositAmount: '1000' },
      { status: 'PAID', depositAmount: '1000' },
    ]);

    expect(await service.countExpiringToday(owner, 'b-1')).toEqual({ count: 3, depositTotal: 4000, reservedUnits: 2 });

    const where = db.booking.findMany.mock.calls[0][0].where;
    expect(where.status.in).toEqual([...OPEN_BOOKING_STATUSES]);
    expect(where.branchId).toBe('b-1');
    expect(where.deletedAt).toBeNull();
    expect(where.expireDate).toEqual({ gte: expect.any(Date), lt: expect.any(Date) });
    expect(where.expireDate.lt.getTime() - where.expireDate.gte.getTime()).toBe(86400000);
  });

  it('ไม่มีใบจอง → 0 ทุกช่อง', async () => {
    const { service } = fixture([]);
    expect(await service.countExpiringToday(owner)).toEqual({ count: 0, depositTotal: 0, reservedUnits: 0 });
  });

  it('SALES ถูกบังคับสาขาตัวเอง และ SALES ไม่มีสาขา → 0 โดยไม่ query', async () => {
    const { db, service } = fixture([{ status: 'PAID', depositAmount: '500' }]);
    await service.countExpiringToday({ id: 's', role: 'SALES', branchId: 'b-9' });
    expect(db.booking.findMany.mock.calls[0][0].where.branchId).toBe('b-9');

    const none = fixture([]);
    expect(await none.service.countExpiringToday({ id: 's', role: 'SALES', branchId: null })).toEqual({
      count: 0,
      depositTotal: 0,
      reservedUnits: 0,
    });
    expect(none.db.booking.findMany).not.toHaveBeenCalled();
  });
});
