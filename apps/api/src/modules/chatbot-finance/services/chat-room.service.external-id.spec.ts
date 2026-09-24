import { ChatRoomService } from './chat-room.service';
import { MessageRole, MessageType } from '@prisma/client';

describe('ChatRoomService.saveMessage — externalMessageId', () => {
  it('passes externalMessageId through to prisma.chatMessage.create', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'm1' });
    const prisma = { chatMessage: { create }, chatRoom: { update: jest.fn().mockResolvedValue({}) } } as any;
    // ChatRoomService constructor: (prisma, lineClient, staffChatGateway?, chatProspects?, merge?) —
    // lineClient ไม่ใช่ optional; saveMessage ไม่แตะมันเลยจึง mock ว่างพอ
    const service = new ChatRoomService(prisma, {} as any);
    await service.saveMessage({
      roomId: 'r1',
      role: MessageRole.CUSTOMER,
      type: MessageType.IMAGE,
      text: '[image]',
      externalMessageId: 'LINE-MSG-1',
    });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ externalMessageId: 'LINE-MSG-1', type: MessageType.IMAGE }),
      }),
    );
  });
});
