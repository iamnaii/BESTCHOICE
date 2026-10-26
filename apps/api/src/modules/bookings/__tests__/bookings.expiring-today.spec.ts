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
    const now = new Date('2026-10-22T03:00:00Z'); // 10:00 ไทย 22 ต.ค.

    expect(await service.countExpiringToday(owner, 'b-1', now)).toEqual({ count: 3, depositTotal: 4000, reservedUnits: 2 });

    const where = db.booking.findMany.mock.calls[0][0].where;
    expect(where.status.in).toEqual([...OPEN_BOOKING_STATUSES]);
    expect(where.branchId).toBe('b-1');
    expect(where.deletedAt).toBeNull();
    // ใบจองเก็บ expireDate = เที่ยงคืนไทยของ "วันถัดจาก" วันสุดท้ายที่ใช้ได้ (expiringBefore)
    // ใบที่ใช้ได้ถึงวันนี้จึงมี expireDate = พรุ่งนี้ 00:00 → ต้องใช้ (วันนี้ 00:00, พรุ่งนี้ 00:00]
    // ไม่ใช่ [วันนี้ 00:00, พรุ่งนี้ 00:00) ซึ่งจะจับได้แค่ใบที่หมดอายุไปแล้วเมื่อวาน (cron เปลี่ยนเป็น EXPIRED ไปแล้ว)
    expect(where.expireDate).toEqual({
      gt: new Date('2026-10-21T17:00:00Z'),
      lte: new Date('2026-10-22T17:00:00Z'),
    });
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
