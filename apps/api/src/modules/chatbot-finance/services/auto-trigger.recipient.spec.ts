import { AutoTriggerService } from './auto-trigger.service';

/**
 * Task 24 fix round 2 m-5 — เตือนงวดอัตโนมัติ (09:00/10:00) อ่านผู้รับด้วยเกณฑ์เดียวกับผู้ส่งข้อความการเงินทุกตัว
 * (`FINANCE_LINE_RECIPIENT_SELECT` = แถว FINANCE ที่ unlinked/deleted ว่าง) — เดิมเขียน `{ FINANCE, unlinkedAt: null }` เอง ไม่ดู `deleted_at`
 */
describe('AutoTriggerService — ผู้รับ = แถว OTP ที่ยังผูก (เกณฑ์เดียว)', () => {
  it('select lineLinks ของลูกค้าด้วย ACTIVE_FINANCE_LINK_WHERE (รวม deletedAt: null) · take 1', async () => {
    const prisma = {
      payment: { findMany: jest.fn().mockResolvedValue([]) },
      systemConfig: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    const service = new AutoTriggerService(
      prisma as never,
      {} as never,
      {} as never,
      { bankInfoBlock: '' } as never,
    );

    await service.runDailyReminders();

    expect(prisma.payment.findMany).toHaveBeenCalled();
    for (const [args] of prisma.payment.findMany.mock.calls) {
      expect(args.include.contract.include.customer.select.lineLinks).toEqual({
        where: { channel: 'FINANCE', unlinkedAt: null, deletedAt: null },
        select: { lineUserId: true },
        take: 1,
      });
    }
  });
});
