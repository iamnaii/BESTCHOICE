import { SchedulerService } from './scheduler.service';

jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn(), captureMessage: jest.fn() }));

/** ก้อน 7 A16 — SMS credit ใกล้หมด แจ้งผ่านท่อกลาง (ไม่ใช้แม่แบบ staff.sms_credit_low + notifyTargets อีก) */
describe('SchedulerService.handleSmsCreditAlert → StaffNotifyService', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stub = (): any => ({});
  function build(credit: { configured: boolean; credit?: number }, staffNotify?: { notify: jest.Mock }) {
    const notificationsService = { checkSmsCredit: jest.fn().mockResolvedValue(credit), sendFromTemplate: jest.fn() };
    const integrationConfig = { getValue: jest.fn().mockResolvedValue('G1,G2') };
    const service = new SchedulerService(notificationsService as never, stub(), stub(), stub(), stub(), stub(), stub(), stub(), stub(), stub(), stub(), integrationConfig as never, staffNotify as never);
    return { service, notificationsService };
  }

  it('credit below 100 → one sms.credit_low notice per Thai day, no template sends', async () => {
    const staffNotify = { notify: jest.fn().mockResolvedValue({ sent: 1 }) };
    const { service, notificationsService } = build({ configured: true, credit: 42 }, staffNotify);
    await service.handleSmsCreditAlert();
    expect(staffNotify.notify).toHaveBeenCalledWith('sms.credit_low', expect.objectContaining({ title: 'SMS credit ใกล้หมด', lines: ['เหลือ 42 เครดิต'], link: '/notifications', dedupeKey: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) }));
    expect(notificationsService.sendFromTemplate).not.toHaveBeenCalled();
  });

  it('credit healthy or SMS not configured → nothing', async () => {
    const staffNotify = { notify: jest.fn() };
    await build({ configured: true, credit: 500 }, staffNotify).service.handleSmsCreditAlert();
    await build({ configured: false }, staffNotify).service.handleSmsCreditAlert();
    expect(staffNotify.notify).not.toHaveBeenCalled();
  });

  it('without the hub it only logs (no legacy sends)', async () => {
    const { service, notificationsService } = build({ configured: true, credit: 10 });
    await service.handleSmsCreditAlert();
    expect(notificationsService.sendFromTemplate).not.toHaveBeenCalled();
  });
});
