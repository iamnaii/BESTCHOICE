import { ChatChannel } from '@prisma/client';
import { ChatRoomService } from './chat-room.service';

describe('ChatRoomService.getOrCreate → ผู้สนใจอัตโนมัติ (LINE การเงิน)', () => {
  let prisma: any;
  let lineClient: any;
  let chatProspects: any;
  let service: ChatRoomService;

  beforeEach(() => {
    prisma = {
      chatRoom: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn(), update: jest.fn() },
      customerLineLink: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    lineClient = { getUserProfile: jest.fn().mockResolvedValue({ displayName: 'มิ้นท์', pictureUrl: null }) };
    chatProspects = { ensureForRoom: jest.fn().mockResolvedValue({ customerId: 'cust-auto', created: true }) };
    service = new ChatRoomService(prisma, lineClient, undefined, chatProspects);
  });

  it('ไม่มี link → สร้างห้องแล้วเรียก ensureForRoom คืน customerId ที่ได้', async () => {
    prisma.chatRoom.create.mockResolvedValue({ id: 'room-fin', channel: ChatChannel.LINE_FINANCE, customerId: null });
    const room = await service.getOrCreate('Ufin1');
    expect(chatProspects.ensureForRoom).toHaveBeenCalledWith('room-fin');
    expect(room.customerId).toBe('cust-auto');
  });

  it('มี link อยู่แล้ว → ห้องผูกลูกค้าจริงตั้งแต่สร้าง ไม่เรียก ensureForRoom', async () => {
    prisma.customerLineLink.findUnique.mockResolvedValue({ customerId: 'cust-real' });
    prisma.chatRoom.create.mockResolvedValue({ id: 'room-fin', channel: ChatChannel.LINE_FINANCE, customerId: 'cust-real' });
    const room = await service.getOrCreate('Ufin1');
    expect(chatProspects.ensureForRoom).not.toHaveBeenCalled();
    expect(room.customerId).toBe('cust-real');
  });

  it('ensureForRoom ล้ม → ยังคืนห้อง', async () => {
    chatProspects.ensureForRoom.mockRejectedValue(new Error('x'));
    prisma.chatRoom.create.mockResolvedValue({ id: 'room-fin', channel: ChatChannel.LINE_FINANCE, customerId: null });
    await expect(service.getOrCreate('Ufin1')).resolves.toMatchObject({ id: 'room-fin' });
  });
});
