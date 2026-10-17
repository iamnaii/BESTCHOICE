import { StaffChatGateway } from './staff-chat.gateway';
import { CHAT_EVENTS, CHAT_ROOMS } from '../chat-engine/constants/chat-events';

describe('staff typing audience', () => {
  it.each([['handleTypingStart', true], ['handleTypingStop', false]] as const)('%s excludes the sending socket', async (method, isTyping) => {
    const boundary = { allowLegacy: jest.fn().mockResolvedValue(true), emit: jest.fn() };
    const gateway = new StaffChatGateway({} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, boundary as any);
    gateway.server = {} as any;
    const client = { id: 'sender-socket', userId: 'u', userName: 'Staff' } as any;
    await gateway[method](client, { roomId: 'room' });
    expect(boundary.allowLegacy).toHaveBeenCalledWith(client);
    expect(boundary.emit).toHaveBeenCalledWith(gateway.server, CHAT_ROOMS.room('room'), CHAT_EVENTS.TYPING,
      { roomId: 'room', userId: 'u', userName: 'Staff', role: 'STAFF', isTyping }, 'sender-socket');
  });
});
