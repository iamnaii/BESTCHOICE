import { NotificationDispatchService } from './notification-dispatch.service';

/**
 * Task 24 fix round 2 m-2 — สำเนา Flex ของแม่แบบแจ้งเตือนลงห้องแชท "ของผู้รับจริง" (`{ lineUserId: recipient, channel }`) ไม่ใช่
 * "ห้องล่าสุดที่ customerId = ลูกค้า" (ห้องของ LINE เก่าที่ลูกค้ายกเลิกแล้วยังถือ customerId เดิม — M-8)
 */
describe('NotificationDispatchService.sendFromTemplate (Flex) — สำเนาลงห้องของผู้รับ', () => {
  function build(channelKey: 'line-finance' | 'line-shop', room: { id: string } | null) {
    const prisma = {
      chatRoom: { findFirst: jest.fn().mockResolvedValue(room) },
      chatMessage: { create: jest.fn() },
      notificationLog: { create: jest.fn().mockResolvedValue({ id: 'log-1' }) },
    };
    const transport = { sendLineFlexMessage: jest.fn().mockResolvedValue(undefined) };
    const templates = {
      findByEventType: jest.fn().mockResolvedValue({
        isActive: true,
        format: 'flex',
        channel: 'LINE',
        channelKey,
        flexTemplate: JSON.stringify({ type: 'bubble' }),
        messageTemplate: 'แจ้งยอด {amount}',
        name: 'tpl',
        subject: null,
        category: 'TRANSACTIONAL',
      }),
    };
    const service = new NotificationDispatchService(
      transport as never,
      prisma as never,
      {} as never,
      templates as never,
    );
    return { prisma, service };
  }

  it.each([
    ['line-finance', 'LINE_FINANCE'],
    ['line-shop', 'LINE_SHOP'],
  ] as const)('%s → ห้อง %s ของ LINE ผู้รับ', async (channelKey, channel) => {
    const { prisma, service } = build(channelKey, { id: 'room-recipient' });

    await service.sendFromTemplate('EVT', { amount: '100' }, 'U-L2', { customerId: 'cust-b' });

    expect(prisma.chatRoom.findFirst).toHaveBeenCalledWith({
      where: { lineUserId: 'U-L2', channel, deletedAt: null },
    });
    expect(prisma.chatMessage.create.mock.calls[0][0].data.roomId).toBe('room-recipient');
  });

  it('LINE ผู้รับยังไม่มีห้อง → ไม่บันทึกสำเนา', async () => {
    const { prisma, service } = build('line-finance', null);
    await service.sendFromTemplate('EVT', { amount: '100' }, 'U-L2', { customerId: 'cust-b' });
    expect(prisma.chatMessage.create).not.toHaveBeenCalled();
  });
});
