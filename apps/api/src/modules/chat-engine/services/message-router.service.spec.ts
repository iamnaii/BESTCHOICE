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
  return { router, adapter, aiAutoReply, afterHours, roomManager, handoffManager };
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

// Issue #1332 — after the bot answers a not-found model question with the
// standard rates (get_installment_rates), staff must still follow up with
// the real price. The room flag comes from the ROUTER, post-send (so it can
// never suppress the reply), NOT from inside the read-only tool and NOT
// from a same-turn handoff_to_human (which would tank confidence to 0.3 and
// silence the reply — the exact behavior being eliminated).
describe('MessageRouterService — staff follow-up flag after rate reply (#1332)', () => {
  it('auto-send whose toolsUsed includes get_installment_rates → sends AND flags the room for staff', async () => {
    const { router, adapter, handoffManager } = makeRouter({
      aiEligible: true,
      aiResult: {
        reply: 'เรทผ่อนมาตรฐานดอกเบี้ยรวม 30% ดาวน์ขั้นต่ำ 20% ค่ะ เดี๋ยวทีมงานเช็คราคารุ่นนี้แล้วทักกลับนะคะ',
        confidence: 0.95,
        toolsUsed: ['search_products', 'get_installment_rates'],
        inputTokens: 1,
        outputTokens: 1,
      },
    });
    await router.routeInbound(baseMsg as any);

    // Reply still goes out first…
    expect(adapter.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringContaining('เรทผ่อน') }),
    );
    // …and the room is flagged for the price follow-up.
    expect(handoffManager.initiateHandoff).toHaveBeenCalledWith({
      roomId: 'r1',
      reason: 'บอทส่งเรทแล้ว — ตามราคารุ่นที่ลูกค้าต้องการ',
      priority: 'normal',
      summary: baseMsg.text,
    });
  });

  it('auto-send WITHOUT get_installment_rates → no staff follow-up flag', async () => {
    const { router, adapter, handoffManager } = makeRouter({
      aiEligible: true,
      aiResult: {
        reply: 'iPhone 15 ราคา 32,900 บาทค่ะ',
        confidence: 0.95,
        toolsUsed: ['search_products'],
        inputTokens: 1,
        outputTokens: 1,
      },
    });
    await router.routeInbound(baseMsg as any);

    expect(adapter.sendMessage).toHaveBeenCalled();
    expect(handoffManager.initiateHandoff).not.toHaveBeenCalled();
  });
});
