import { ChatCronService } from './chat-cron.service';
import { ChatRoomStatus } from '@prisma/client';

describe('ChatCronService.markIdleRooms', () => {
  it('ทำ IDLE เฉพาะห้องที่ไม่มีลูกค้ารอ (waitingSince IS NULL) — สเปก §4.4', async () => {
    const prisma = {
      chatRoom: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const svc = new ChatCronService(prisma as any);

    await svc.markIdleRooms();

    expect(prisma.chatRoom.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: ChatRoomStatus.ACTIVE,
          handoffMode: false,
          waitingSince: null,
          deletedAt: null,
        }),
        data: expect.objectContaining({ status: ChatRoomStatus.IDLE }),
      }),
    );
  });
});
