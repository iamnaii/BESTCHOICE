import { BadRequestException } from '@nestjs/common';
import { PaymentLinkService } from './payment-link.service';
import { NOT_SENT_REASON_TEXT } from '../../notifications/send-outcome';

/**
 * Task 34 รีวิว I1 — ปุ่ม "ส่งลิงก์ชำระ" ใน inbox (`POST /line-oa/payment-flex`) ส่งการ์ด "⚠️ แจ้งเตือนค้างชำระ" / "เตือนค่างวด" ด้วยมือ ⇒ ต้องผ่าน
 * ด่านความยินยอม PDPA นิยามเดียว (`hasActivePdpaConsent`) เหมือนทางส่งเตือน/ทวงอื่น (ข้อยกเว้นส่งด้วยมือของเจ้าของ #18 = ช่วงผ่อนผันเท่านั้น) ·
 * ไม่มีความยินยอม = 400 `NOT_SENT_REASON_TEXT.NO_CONSENT` · ไม่สร้างลิงก์ (ไม่มีแถว payment_links ทิ้ง) · ไม่ push · ไม่บันทึกสำเนาในห้อง
 */
describe('PaymentLinkService.sendPaymentFlex — ด่านความยินยอม PDPA', () => {
  function build(consent: boolean) {
    const prisma = {
      contract: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'ctr-1',
          contractNumber: 'BC-001',
          customer: { id: 'cust-1', name: 'สมชาย', lineLinks: [{ lineUserId: 'U-1' }] },
          payments: [{ installmentNo: 3, dueDate: new Date(Date.now() - 86_400_000), lateFee: 0 }],
        }),
      },
      pDPAConsent: { findFirst: jest.fn().mockResolvedValue(consent ? { id: 'consent-1' } : null) },
      payment: { count: jest.fn().mockResolvedValue(12) },
      chatRoom: { findFirst: jest.fn().mockResolvedValue({ id: 'room-1' }), update: jest.fn() },
      chatMessage: { create: jest.fn() },
    };
    const line = { pushMessage: jest.fn().mockResolvedValue(undefined) };
    const service = new PaymentLinkService(
      { get: jest.fn().mockReturnValue('https://web') } as never,
      prisma as never,
      {} as never,
      {
        paymentReminder: jest.fn().mockReturnValue({}),
        overdueNotice: jest.fn().mockReturnValue({}),
      } as never,
      line as never,
    );
    const createLink = jest
      .spyOn(service, 'createPaymentLink')
      .mockResolvedValue({ url: 'https://web/pay/x', amount: 1515.83 } as never);
    return { prisma, line, service, createLink };
  }

  it('ลูกค้าไม่มีความยินยอม → 400 เหตุผลภาษาไทยชุดเดียวกับคิวทวงถาม · ไม่สร้างลิงก์ ไม่ push ไม่บันทึกห้อง', async () => {
    const { prisma, line, service, createLink } = build(false);

    const err = await service
      .sendPaymentFlex({ contractId: 'ctr-1' }, { user: { id: 'staff-1' } })
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as BadRequestException).message).toBe(NOT_SENT_REASON_TEXT.NO_CONSENT);
    expect(prisma.pDPAConsent.findFirst).toHaveBeenCalledWith({
      where: { customerId: 'cust-1', status: 'GRANTED', deletedAt: null },
      select: { id: true },
    });
    expect(createLink).not.toHaveBeenCalled();
    expect(line.pushMessage).not.toHaveBeenCalled();
    expect(prisma.chatMessage.create).not.toHaveBeenCalled();
  });

  it('มีความยินยอม → ส่งการ์ดตามเดิม', async () => {
    const { line, service, createLink } = build(true);

    await expect(
      service.sendPaymentFlex({ contractId: 'ctr-1' }, { user: { id: 'staff-1' } }),
    ).resolves.toMatchObject({ success: true, type: 'overdue' });
    expect(createLink).toHaveBeenCalledTimes(1);
    expect(line.pushMessage).toHaveBeenCalledWith('U-1', expect.any(Array));
  });
});
