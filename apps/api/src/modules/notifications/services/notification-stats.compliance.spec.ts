import { NotificationStatsService } from './notification-stats.service';

/** Task 30 รอบ 2 ข้อ 5 — การ์ดสรุปการระงับ (`GET notifications/compliance/stats`) นับแถวช่วงผ่อนผันหลังผูก LINE ด้วย */
describe('NotificationStatsService.getComplianceStats', () => {
  it('คืนจำนวนต่อเหตุผล รวม LEGACY_LINK_GRACE (เหตุผลที่ไม่รู้จักไม่ถูกส่งออก)', async () => {
    const prisma = {
      notificationLog: {
        groupBy: jest.fn().mockResolvedValue([
          { blockReason: 'NO_CONSENT', _count: { _all: 4 } },
          { blockReason: 'LEGACY_LINK_GRACE', _count: { _all: 3 } },
          { blockReason: 'TEMPLATE_INACTIVE', _count: { _all: 9 } },
        ]),
      },
    };
    const stats = new NotificationStatsService(prisma as never, {} as never);

    await expect(stats.getComplianceStats(7)).resolves.toEqual({
      OUTSIDE_HOURS: 0,
      FREQUENCY_CAP: 0,
      NO_CONSENT: 4,
      HOLIDAY_BLOCK: 0,
      LEGACY_LINK_GRACE: 3,
    });
  });
});
