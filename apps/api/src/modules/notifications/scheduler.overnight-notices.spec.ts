import { SchedulerService } from './scheduler.service';
import { CollectionsNotifierService } from './services/collections-notifier.service';

jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn(), captureMessage: jest.fn() }));

/**
 * Task 30 รอบ 3 — รอบกลางคืน 00:30 (เปลี่ยนสถานะ) / 01:00 (เลื่อนขั้นทวง) ไม่ส่ง LINE ทวงถึงลูกค้าแล้ว ·
 * ข้อความออกจากรอบ 08:05 (`handleOvernightCollectionsNotices`) ในเวลาทำการ
 */
describe('SchedulerService — ข้อความผลรอบกลางคืนส่งตอนเช้า', () => {
  const overdue = {
    updateContractStatuses: jest.fn().mockResolvedValue({
      overdueUpdated: 1,
      defaultUpdated: 0,
      overdueIds: ['k1'],
      defaultIds: [],
    }),
    escalateDunningStages: jest.fn().mockResolvedValue({
      escalated: [{ contractId: 'k1', contractNumber: 'CT-1', daysOverdue: 10, to: 'REMINDER' }],
    }),
  };
  const scheduler = new SchedulerService(
    {} as never,
    overdue as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  let statusNotice: jest.SpyInstance;
  let dunningNotice: jest.SpyInstance;
  let morning: jest.SpyInstance;

  beforeEach(() => {
    statusNotice = jest
      .spyOn(CollectionsNotifierService.prototype, 'notifyStatusChangedCustomers')
      .mockResolvedValue(undefined);
    dunningNotice = jest
      .spyOn(CollectionsNotifierService.prototype, 'notifyEscalatedDunning')
      .mockResolvedValue({ escalated: 1, notified: 1, suppressed: 0 });
    morning = jest
      .spyOn(CollectionsNotifierService.prototype, 'sendOvernightCollectionsNotices')
      .mockResolvedValue({ statusNotices: 1, dunningNotices: 1, lockNotices: 1 });
  });
  afterEach(() => jest.restoreAllMocks());

  it('00:30 เปลี่ยนสถานะตามเดิม แต่ไม่แจ้งลูกค้า', async () => {
    await scheduler.handleContractStatusUpdate();
    expect(overdue.updateContractStatuses).toHaveBeenCalled();
    expect(statusNotice).not.toHaveBeenCalled();
  });

  it('01:00 เลื่อนขั้นทวงตามเดิม แต่ไม่แจ้งลูกค้า', async () => {
    await scheduler.handleDunningEscalation();
    expect(overdue.escalateDunningStages).toHaveBeenCalled();
    expect(dunningNotice).not.toHaveBeenCalled();
  });

  it('08:05 ส่งข้อความผลรอบกลางคืน', async () => {
    await scheduler.handleOvernightCollectionsNotices();
    expect(morning).toHaveBeenCalledTimes(1);
  });
});
