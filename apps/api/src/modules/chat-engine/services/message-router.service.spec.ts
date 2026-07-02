import { MessageRouterService } from './message-router.service';
import { ChatChannel, MessageType } from '@prisma/client';

const baseMsg = {
  externalMessageId: 'em1',
  externalUserId: 'U1',
  channel: ChatChannel.LINE_SHOP,
  type: MessageType.TEXT,
  text: 'สนใจ iPhone 15',
  replyToken: 'rt-1',
};

function makeRouter(opts: {
  room?: any;
  aiEligible?: boolean;
  aiResult?: any;
  afterHours?: boolean;
}) {
  const room = opts.room ?? { id: 'r1', handoffMode: false, aiPaused: false, verifiedAt: null };
  const roomManager = {
    getOrCreateRoom: jest.fn().mockResolvedValue(room),
    saveMessage: jest.fn().mockResolvedValue({ id: 'm1' }),
  };
  const handoffManager = { initiateHandoff: jest.fn() };
  const configService = { get: jest.fn().mockReturnValue(undefined) };
  const afterHours = {
    isAfterHours: jest.fn().mockReturnValue(opts.afterHours ?? false),
    getAutoReply: jest.fn().mockResolvedValue('นอกเวลาทำการค่ะ'),
  };
  const aiAutoReply = {
    shouldAutoReply: jest.fn().mockResolvedValue(opts.aiEligible ?? false),
    autoReply: jest.fn().mockResolvedValue(opts.aiResult ?? null),
    logAutoReply: jest.fn().mockResolvedValue(undefined),
  };
  const adapter = {
    channel: ChatChannel.LINE_SHOP,
    sendMessage: jest.fn().mockResolvedValue({ success: true }),
  };
  const router = new MessageRouterService(
    roomManager as any,
    handoffManager as any,
    configService as any,
    afterHours as any,
    aiAutoReply as any,
  );
  router.registerAdapter(adapter as any);
  return { router, adapter, aiAutoReply, afterHours, roomManager };
}

describe('MessageRouterService — replyToken + aiPaused', () => {
  it('threads the inbound replyToken into a confident AI reply', async () => {
    const { router, adapter } = makeRouter({
      aiEligible: true,
      aiResult: { reply: 'มีค่ะ', confidence: 0.9, toolsUsed: [], inputTokens: 1, outputTokens: 1 },
    });
    await router.routeInbound(baseMsg as any);
    expect(adapter.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'มีค่ะ', replyToken: 'rt-1' }),
    );
  });

  it('threads the replyToken into the after-hours reply', async () => {
    const { router, adapter } = makeRouter({ afterHours: true });
    await router.routeInbound(baseMsg as any);
    expect(adapter.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'นอกเวลาทำการค่ะ', replyToken: 'rt-1' }),
    );
  });

  it('does NOT send after-hours reply when staff took over (aiPaused)', async () => {
    const { router, adapter } = makeRouter({
      afterHours: true,
      room: { id: 'r1', handoffMode: false, aiPaused: true, verifiedAt: null },
    });
    await router.routeInbound(baseMsg as any);
    expect(adapter.sendMessage).not.toHaveBeenCalled();
  });
});
