import { NotificationsController } from './notifications.controller';

/**
 * Task 30 รอบ 2 ข้อ 2 — endpoint ส่งของหน้า /notifications คือพนักงานกดส่งเอง ⇒ ส่งต่อด้วย `manual: true`
 * (ไม่ถูกระงับช่วงผ่อนผันหลังผูก LINE ของสัญญานำเข้า) · ฝั่ง HTTP ตั้งค่านี้เองไม่ได้ (ไม่อยู่ใน DTO)
 */
describe('NotificationsController — ส่งด้วยมือ', () => {
  const service = {
    send: jest.fn().mockResolvedValue({ id: 'n', status: 'SENT' }),
    sendFromTemplate: jest.fn().mockResolvedValue({ id: 'n', status: 'SENT' }),
    sendBulk: jest.fn().mockResolvedValue({ total: 1, results: [] }),
  };
  const controller = new NotificationsController(service as never, {} as never);

  beforeEach(() => jest.clearAllMocks());

  it('POST notifications/send → send(dto, { manual: true })', async () => {
    const dto = {
      channel: 'LINE',
      channelKey: 'line-finance',
      recipient: 'U-1',
      message: 'ทดสอบ',
      category: 'DUNNING',
    };
    await controller.send(dto as never);
    expect(service.send).toHaveBeenCalledWith(dto, { manual: true });
  });

  it('POST notifications/send-from-template → options.manual = true', async () => {
    await controller.sendFromTemplate({
      eventType: 'dunning.reminder',
      data: {},
      recipient: 'U-1',
      relatedId: 'k1',
      customerId: 'c1',
    });
    expect(service.sendFromTemplate).toHaveBeenCalledWith('dunning.reminder', {}, 'U-1', {
      relatedId: 'k1',
      customerId: 'c1',
      manual: true,
    });
  });

  it('POST notifications/bulk → sendBulk(…, { manual: true })', async () => {
    await controller.sendBulk({ templateId: 'dunning.reminder', contractIds: ['k1'] } as never);
    expect(service.sendBulk).toHaveBeenCalledWith('dunning.reminder', ['k1'], { manual: true });
  });

  /** ผู้คุมงาน (ตอบคำถามเปิด) — คำตอบของ endpoint ที่พนักงานกดส่งบอกเหตุผลภาษาไทยของที่ไม่ได้ส่ง (`describeSendOutcome`) */
  it('POST notifications/send-from-template ถูกระงับ (ไม่มีความยินยอม) → คำตอบมี notSentReason + reasonText', async () => {
    service.sendFromTemplate.mockResolvedValueOnce({
      id: null,
      status: 'BLOCKED',
      blockReason: 'NO_CONSENT',
    });
    await expect(
      controller.sendFromTemplate({
        eventType: 'dunning.reminder',
        data: {},
        recipient: 'U-1',
        relatedId: 'k1',
        customerId: 'c1',
      }),
    ).resolves.toEqual({
      id: null,
      status: 'BLOCKED',
      blockReason: 'NO_CONSENT',
      notSentReason: 'NO_CONSENT',
      reasonText: expect.stringMatching(/^ไม่ได้ส่ง — ลูกค้ายังไม่ได้ให้ความยินยอม PDPA/),
    });
  });

  it('POST notifications/send-from-template ส่งแล้ว → คำตอบเดิม (ไม่มีช่องเหตุผล)', async () => {
    await expect(
      controller.sendFromTemplate({ eventType: 'dunning.reminder', data: {}, recipient: 'U-1' }),
    ).resolves.toEqual({ id: 'n', status: 'SENT' });
  });
});
