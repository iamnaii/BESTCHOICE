import { StaffNotifyRecurringBillNotifier } from '../recurring-bill-notifier';

/** ก้อน 7 A16 — เสียบท่อบิลประจำ (ก้อน 6) เข้าท่อกลาง */
describe('StaffNotifyRecurringBillNotifier', () => {
  it('N3 maps the 5-line message to title/lines, a path link, branchId and a per-day dedupe key', async () => {
    const staffNotify = { notify: jest.fn().mockResolvedValue({ sent: 2 }) };
    const notifier = new StaffNotifyRecurringBillNotifier(staffNotify as never);
    await notifier.notify({
      kind: 'OVERDUE',
      occurrenceId: 'occ-1',
      periodKey: '2026-10',
      templateName: 'อินเทอร์เน็ต AIS Fibre',
      vendorName: 'บมจ.แอดวานซ์',
      branchName: 'ลาดพร้าว',
      branchId: 'br-1',
      dueDate: { year: 2026, month: 10, day: 24 },
      daysOverdue: 2,
      amount: '1284',
      documentNumber: 'EX-20261021-0002',
      link: 'https://app.test/expenses/recurring-bills?month=2026-10',
    }, new Date('2026-10-26T01:05:00.000Z'));
    expect(staffNotify.notify).toHaveBeenCalledWith('recurring_bill', {
      title: '[บิลประจำ] เกินกำหนด 2 วัน',
      lines: ['อินเทอร์เน็ต AIS Fibre (ลาดพร้าว)', 'ครบกำหนด 24 ต.ค. 69 · ยอดประมาณ 1,284 บาท', 'ร่างใบรายจ่าย EX-20261021-0002 รอจ่าย'],
      link: '/expenses/recurring-bills?month=2026-10',
      branchId: 'br-1',
      dedupeKey: 'occ-1:OVERDUE:2026-10-26',
    });
  });

  it('N4 hub failure never propagates to step B', async () => {
    const staffNotify = { notify: jest.fn().mockRejectedValue(new Error('boom')) };
    const notifier = new StaffNotifyRecurringBillNotifier(staffNotify as never);
    await expect(notifier.notify({ kind: 'UPCOMING', occurrenceId: 'o', periodKey: '2026-11', templateName: 't', vendorName: null, branchName: 'b', branchId: null, dueDate: { year: 2026, month: 11, day: 1 }, daysOverdue: -3, amount: null, documentNumber: null, link: '' })).resolves.toBeUndefined();
  });
});
