import { OwnerAlertHelper } from './owner-alert.helper';

/** ก้อน 7 A16 — แจ้งเจ้าของจากงานติดตามหนี้ ผ่านท่อกลาง (คง SMS สำรองด้วย smsFallback) */
describe('OwnerAlertHelper.sendToAllOwners → StaffNotifyService', () => {
  it('A1 first line = title, the rest = lines, smsFallback on, no dedupe (callers reuse constant relatedIds)', async () => {
    const staffNotify = { notify: jest.fn().mockResolvedValue({ recipients: 2, sent: 1, deduped: 0, failed: 1, quotaSkipped: 0 }) };
    const helper = new OwnerAlertHelper({} as never, {} as never, staffNotify as never);
    const res = await helper.sendToAllOwners('ระบบเสนอล็อกเครื่อง 3 สัญญา\nค้างเกิน 30 วัน\nเข้าไปอนุมัติที่หน้าติดตามหนี้', 'mdm-auto-propose');
    expect(res).toEqual({ sent: 1, failed: 1 });
    expect(staffNotify.notify).toHaveBeenCalledWith('overdue.owner_alert', {
      title: 'ระบบเสนอล็อกเครื่อง 3 สัญญา',
      lines: ['ค้างเกิน 30 วัน', 'เข้าไปอนุมัติที่หน้าติดตามหนี้'],
      link: '/overdue',
      smsFallback: true,
    });
  });

  it('A2 without the hub → zeros, no throw', async () => {
    const helper = new OwnerAlertHelper({} as never, {} as never, undefined);
    await expect(helper.sendToAllOwners('x')).resolves.toEqual({ sent: 0, failed: 0 });
  });
});
