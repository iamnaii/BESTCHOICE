import { ChatChannel } from '@prisma/client';
import { PaymentLinkService } from './payment-link.service';

/**
 * Task 24 fix round 2 m-2 — สำเนา Flex ลิงก์ชำระลงห้องแชท "ของผู้รับจริง" (`{ lineUserId: <LINE ของแถว OTP>, LINE_FINANCE }`) ไม่ใช่
 * "ห้องการเงินล่าสุดที่ customerId = ลูกค้า" — หลังลูกค้า B ยกเลิก L1 แล้วยืนยัน L2 ห้อง L1 ยังถือ customerId = B (M-8) ⇒ บิลของ B จะไปโผล่ในห้อง L1
 * ทำให้ห้อง L1 ดูเป็นแชทการเงินของ B และพนักงานตอบในห้องนั้นถึงผู้ถือ L1
 */
describe('PaymentLinkService.sendPaymentFlex — สำเนาลงห้องของผู้รับ', () => {
  function build(room: { id: string } | null) {
    const prisma = {
      contract: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'ctr-1',
          contractNumber: 'BC-001',
          customer: { id: 'cust-b', name: 'B', lineLinks: [{ lineUserId: 'U-L2' }] },
          payments: [{ installmentNo: 3, dueDate: new Date(Date.now() + 86_400_000), lateFee: 0 }],
        }),
      },
      payment: { count: jest.fn().mockResolvedValue(12) },
      chatRoom: { findFirst: jest.fn().mockResolvedValue(room), update: jest.fn() },
      chatMessage: { create: jest.fn() },
    };
    const line = { pushMessage: jest.fn().mockResolvedValue(undefined) };
    const service = new PaymentLinkService(
      { get: jest.fn().mockReturnValue('https://web') } as never,
      prisma as never,
      {} as never,
      { paymentReminder: jest.fn().mockReturnValue({}), overdueNotice: jest.fn() } as never,
      line as never,
    );
    jest
      .spyOn(service, 'createPaymentLink')
      .mockResolvedValue({ url: 'https://web/pay/x', amount: 1515.83 } as never);
    return { prisma, line, service };
  }

  it('push ถึง LINE ของแถว OTP แล้วบันทึกสำเนาในห้อง LINE_FINANCE ของ LINE นั้นเท่านั้น', async () => {
    const { prisma, line, service } = build({ id: 'room-L2' });

    await service.sendPaymentFlex({ contractId: 'ctr-1' }, { user: { id: 'staff-1' } });

    expect(line.pushMessage).toHaveBeenCalledWith('U-L2', expect.any(Array));
    expect(prisma.chatRoom.findFirst).toHaveBeenCalledWith({
      where: { lineUserId: 'U-L2', channel: ChatChannel.LINE_FINANCE, deletedAt: null },
      select: { id: true },
    });
    expect(prisma.chatMessage.create.mock.calls[0][0].data.roomId).toBe('room-L2');
  });

  it('LINE ของผู้รับยังไม่มีห้อง → ไม่บันทึกสำเนา (ไม่ถอยไปห้องอื่นของลูกค้า)', async () => {
    const { prisma, service } = build(null);
    await service.sendPaymentFlex({ contractId: 'ctr-1' }, { user: { id: 'staff-1' } });
    expect(prisma.chatMessage.create).not.toHaveBeenCalled();
  });
});
