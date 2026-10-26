import { ShopLineChatService } from './shop-line-chat.service';

describe('ShopLineChatService → StaffNotifyService', () => {
  it('W1 inquiry → chat.web_inquiry with masked phone; hub failure never throws', async () => {
    const staffNotify = { notify: jest.fn().mockResolvedValue({ sent: 1 }) };
    const service = new ShopLineChatService(staffNotify as never);
    await service.notifyStaffOfInquiry({ name: 'คุณสมชาย', phone: '0812345678', message: 'สนใจ iPhone 15 ผ่อนได้ไหม' });
    expect(staffNotify.notify).toHaveBeenCalledWith('chat.web_inquiry', {
      title: 'ข้อความสอบถามจากเว็บ',
      lines: ['ชื่อ: คุณสมชาย', expect.stringMatching(/^โทร: 0\d{2}-\*\*\*-\d{4}$/), 'ข้อความ: สนใจ iPhone 15 ผ่อนได้ไหม'],
      link: '/inbox',
    });
    staffNotify.notify.mockRejectedValue(new Error('boom'));
    await expect(service.notifyStaffOfInquiry({ name: 'a', phone: '', message: 'm' })).resolves.toBeUndefined();
  });

  it('W3 hub that never settles must not hold the public request (รีวิว I6)', async () => {
    const staffNotify = { notify: jest.fn(() => new Promise<never>(() => undefined)) };
    const service = new ShopLineChatService(staffNotify as never);
    const outcome = await Promise.race([
      service.notifyStaffOfInquiry({ name: 'a', phone: '0812345678', message: 'm' }).then(() => 'done'),
      new Promise<string>((resolve) => setTimeout(() => resolve('hung'), 300)),
    ]);
    expect(outcome).toBe('done');
  });

  it('W2 without the hub (optional dep) it only logs', async () => {
    const service = new ShopLineChatService(undefined);
    await expect(service.notifyStaffOfInquiry({ name: 'a', phone: '0812345678', message: 'm' })).resolves.toBeUndefined();
  });
});
