import { OwnerReportNotifierService } from '../owner-report-notifier.service';

jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn(), captureMessage: jest.fn() }));

/** ก้อน 7 A16 — รายงานรายวันเจ้าของ (Flex) ส่งผ่านท่อกลางแทนการ push ถึง OWNER.lineId เอง */
describe('OwnerReportNotifierService.sendDailyLineReport → StaffNotifyService', () => {
  const prisma = { contract: { count: jest.fn().mockResolvedValue(2) } };
  const dashboard = {
    getKPIs: jest.fn().mockResolvedValue({
      financial: { todayPaymentCount: 12, todayPayments: 48500, totalReceivable: 120000 },
      contracts: { overdue: 7, default: 1 },
    }),
  };

  it('O1 builds the flex report and hands it to the hub (altText + contents, dedupe per day), no direct LINE push', async () => {
    const staffNotify = { notify: jest.fn().mockResolvedValue({ recipients: 1, sent: 1, deduped: 0, failed: 0, quotaSkipped: 0 }) };
    const service = new OwnerReportNotifierService(prisma as never, dashboard as never, staffNotify as never);
    await service.sendDailyLineReport();
    expect(staffNotify.notify).toHaveBeenCalledTimes(1);
    const [event, payload] = staffNotify.notify.mock.calls[0];
    expect(event).toBe('report.owner_daily');
    expect(payload.title).toMatch(/^รายงานประจำวัน/);
    expect(payload.flex.altText).toEqual(expect.any(String));
    expect(payload.flex.contents).toEqual(expect.objectContaining({ type: expect.any(String) }));
    expect(payload.dedupeKey).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(payload.link).toBe('/');
  });

  it('O2 without the hub it logs and returns (never throws)', async () => {
    const service = new OwnerReportNotifierService(prisma as never, dashboard as never, undefined);
    await expect(service.sendDailyLineReport()).resolves.toBeUndefined();
  });
});
