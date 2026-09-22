import { MessageRouterService } from './message-router.service';
import { ChatChannel, MessageType, MessageRole } from '@prisma/client';
import { RoomManagerService } from './room-manager.service';

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
    pauseAiIfActive: jest.fn().mockResolvedValue(false),
    findById: jest.fn().mockResolvedValue({ aiPaused: false, handoffMode: false }),
    getOrCreateRoom: jest.fn().mockResolvedValue(room),
    saveMessage: jest.fn().mockResolvedValue({ id: 'm1' }),
    clearWaiting: jest.fn().mockResolvedValue(undefined),
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

  it('แยกส่งหลายบับเบิลเมื่อบอทคั่นด้วย "---" — replyToken เฉพาะใบแรก, token stats เฉพาะใบแรก', async () => {
    const { router, adapter, roomManager } = makeRouter({
      aiEligible: true,
      aiResult: {
        reply: 'มีของพร้อมส่งค่า\n---\nดาวน์ 1,780 ผ่อน 774 (12 เดือน)\n---\nสนใจแบบไหนดีคะ',
        confidence: 0.9,
        toolsUsed: ['calculate_installment'],
        inputTokens: 10,
        outputTokens: 20,
      },
    });
    await router.routeInbound(baseMsg as any);

    const sent = adapter.sendMessage.mock.calls.map((c: any[]) => c[0]);
    expect(sent.map((s: any) => s.text)).toEqual([
      'มีของพร้อมส่งค่า',
      'ดาวน์ 1,780 ผ่อน 774 (12 เดือน)',
      'สนใจแบบไหนดีคะ',
    ]);
    expect(sent[0].replyToken).toBe('rt-1');
    expect(sent[1].replyToken).toBeUndefined();
    expect(sent[2].replyToken).toBeUndefined();

    // BOT message ถูกบันทึกครบทุกบับเบิล แต่ token/tool stats อยู่ใบแรกใบเดียว
    const saved = roomManager.saveMessage.mock.calls
      .map((c: any[]) => c[0])
      .filter((m: any) => m.role === 'BOT');
    expect(saved).toHaveLength(3);
    expect(saved[0].toolsUsed).toEqual(['calculate_installment']);
    expect(saved[1].toolsUsed).toBeUndefined();
  }, 10000);

  it('"[ตัวเลือก: ...]" ท้ายข้อความ → quick replies บนบับเบิลสุดท้าย และตัดออกจากตัวข้อความ', async () => {
    const { router, adapter } = makeRouter({
      aiEligible: true,
      aiResult: {
        reply:
          'มี 15 ธรรมดา, Plus, Pro, Pro Max เลยค่า\n---\nสนใจตัวไหนคะ\n[ตัวเลือก: 15 | 15 Plus | 15 Pro | 15 Pro Max]',
        confidence: 0.9,
        toolsUsed: [],
        inputTokens: 1,
        outputTokens: 1,
      },
    });
    await router.routeInbound(baseMsg as any);

    const sent = adapter.sendMessage.mock.calls.map((c: any[]) => c[0]);
    expect(sent).toHaveLength(2);
    expect(sent[0].quickReplies).toBeUndefined();
    expect(sent[1].text).toBe('สนใจตัวไหนคะ');
    expect(sent[1].quickReplies).toEqual([
      { label: '15', type: 'MESSAGE', message: '15' },
      { label: '15 Plus', type: 'MESSAGE', message: '15 Plus' },
      { label: '15 Pro', type: 'MESSAGE', message: '15 Pro' },
      { label: '15 Pro Max', type: 'MESSAGE', message: '15 Pro Max' },
    ]);
  }, 10000);

  it('notify_staff (บอทปักธงเอง) → ยังส่งคำตอบของบอท ไม่กลืนทิ้งเหมือนพนักงาน takeover', async () => {
    const { router, adapter, roomManager } = makeRouter({
      aiEligible: true,
      aiResult: {
        reply: 'ได้เลยค่ะ เดี๋ยวแอดมินส่งรูปเครื่องจริงให้ดูนะคะ',
        confidence: 0.95,
        toolsUsed: ['notify_staff'],
        inputTokens: 1,
        outputTokens: 1,
      },
    });
    // หลังบอทเรียก notify_staff ห้องถูกปักธง handoff แล้ว — re-check ก่อนส่งจะเห็นธงนี้
    roomManager.findById.mockResolvedValue({ aiPaused: false, handoffMode: true });
    await router.routeInbound(baseMsg as any);
    expect(adapter.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'ได้เลยค่ะ เดี๋ยวแอดมินส่งรูปเครื่องจริงให้ดูนะคะ' }),
    );
  }, 10000);

  it('ธง handoff ที่ไม่ได้มาจากบอทเทิร์นนี้ (พนักงาน takeover) → ไม่ส่งคำตอบ', async () => {
    const { router, adapter, roomManager } = makeRouter({
      aiEligible: true,
      aiResult: { reply: 'มีค่ะ', confidence: 0.95, toolsUsed: ['get_installment_rates'], inputTokens: 1, outputTokens: 1 },
    });
    roomManager.findById.mockResolvedValue({ aiPaused: false, handoffMode: true });
    await router.routeInbound(baseMsg as any);
    expect(adapter.sendMessage).not.toHaveBeenCalled();
  }, 10000);

  it('รูปตาราง + ก้อนสุดท้ายมีปุ่ม → ส่งรูปก่อนก้อนสุดท้าย (ปุ่มต้องอยู่ข้อความล่าสุด)', async () => {
    const { router, adapter } = makeRouter({
      aiEligible: true,
      aiResult: {
        reply: 'โปรฟรีดาวน์เป็นไอโฟนมือสองค่ะ\n---\nพี่สนใจรุ่นไหนคะ\n[ตัวเลือก: iPhone 13 | iPhone 14]',
        confidence: 0.95,
        toolsUsed: ['send_rate_card'],
        inputTokens: 1,
        outputTokens: 1,
        attachments: [{ productId: 'card:imported_free_down', imageUrl: 'https://s.example.com/t.jpg', label: 'ตาราง' }],
      },
    });
    await router.routeInbound(baseMsg as any);
    const sent = adapter.sendMessage.mock.calls.map((c: any[]) => c[0]);
    expect(sent.map((m: any) => m.imageUrl ?? m.text)).toEqual([
      'โปรฟรีดาวน์เป็นไอโฟนมือสองค่ะ',
      'https://s.example.com/t.jpg',
      'พี่สนใจรุ่นไหนคะ',
    ]);
    expect(sent[2].quickReplies).toHaveLength(2);
  }, 10000);

  it('ไม่มีปุ่ม → รูปตามหลังข้อความทั้งหมดเหมือนเดิม', async () => {
    const { router, adapter } = makeRouter({
      aiEligible: true,
      aiResult: {
        reply: 'อันนี้ตารางผ่อนค่ะ\n---\nเดี๋ยวแอดมินส่งรูปเครื่องจริงให้นะคะ',
        confidence: 0.95,
        toolsUsed: ['send_rate_card'],
        inputTokens: 1,
        outputTokens: 1,
        attachments: [{ productId: 'card:shop_map', imageUrl: 'https://s.example.com/m.jpg', label: 'แผนที่' }],
      },
    });
    await router.routeInbound(baseMsg as any);
    const sent = adapter.sendMessage.mock.calls.map((c: any[]) => c[0]);
    expect(sent.map((m: any) => m.imageUrl ?? m.text)).toEqual([
      'อันนี้ตารางผ่อนค่ะ',
      'เดี๋ยวแอดมินส่งรูปเครื่องจริงให้นะคะ',
      'https://s.example.com/m.jpg',
    ]);
  }, 10000);

  it('เพจตอบอัตโนมัติข้อความนี้ไปแล้ว (ก่อนเรียก AI) → ไม่เรียก AI ไม่ส่งซ้ำ', async () => {
    const { router, adapter, aiAutoReply, roomManager } = makeRouter({
      aiEligible: true,
      aiResult: { reply: 'มีค่ะ', confidence: 0.95, toolsUsed: [], inputTokens: 1, outputTokens: 1 },
    });
    (roomManager as any).hasPageAutoReplySince = jest.fn().mockResolvedValue(true);
    await router.routeInbound(baseMsg as any);
    expect(aiAutoReply.autoReply).not.toHaveBeenCalled();
    expect(adapter.sendMessage).not.toHaveBeenCalled();
  }, 10000);

  it('echo ข้อความอัตโนมัติมาถึงระหว่างบอทคิด → ไม่ส่งคำตอบ + บันทึกว่าไม่ได้ส่ง', async () => {
    const { router, adapter, aiAutoReply, roomManager } = makeRouter({
      aiEligible: true,
      aiResult: { reply: 'มีค่ะ', confidence: 0.95, toolsUsed: [], inputTokens: 1, outputTokens: 1 },
    });
    (roomManager as any).hasPageAutoReplySince = jest.fn().mockResolvedValueOnce(false).mockResolvedValue(true);
    await router.routeInbound(baseMsg as any);
    expect(aiAutoReply.autoReply).toHaveBeenCalled();
    expect(adapter.sendMessage).not.toHaveBeenCalled();
    expect(aiAutoReply.logAutoReply).toHaveBeenCalledWith(
      expect.objectContaining({ autoSent: false, handoffReason: 'เพจตอบอัตโนมัติข้อความนี้ไปแล้ว' }),
    );
  }, 10000);

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

// #1332 auto-flag REMOVED (2026-08-14): after pricing_templates got seeded,
// get_installment_rates became the PRIMARY quoting tool — flagging (and thus
// muting the bot) after every rate reply silenced it right after the first
// quote. Handoff now happens at the right moment instead: capture_lead /
// handoff_to_human set handoffMode themselves when the bot collects a lead.
describe('MessageRouterService — rate reply must NOT mute the bot (#1332 removal)', () => {
  it('auto-send whose toolsUsed includes get_installment_rates → sends WITHOUT flagging the room', async () => {
    const { router, adapter, handoffManager } = makeRouter({
      aiEligible: true,
      aiResult: {
        reply: 'เรทรุ่นนี้ ดาวน์ 1,900 ผ่อนเดือนละ 2,566 (12 เดือน) ค่ะ',
        confidence: 0.95,
        toolsUsed: ['search_products', 'get_installment_rates'],
        inputTokens: 1,
        outputTokens: 1,
      },
    });
    await router.routeInbound(baseMsg as any);

    expect(adapter.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringContaining('เรท') }),
    );
    expect(handoffManager.initiateHandoff).not.toHaveBeenCalled();
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

// ─── B2: image primitive + exactly-once on clientMessageId ───────────────────

function makeStaffSender() {
  const room = {
    id: 'r1',
    channel: ChatChannel.LINE_SHOP,
    externalUserId: 'U1',
    lineUserId: null,
  };
  // จำลอง @@unique([roomId, clientMessageId]) ด้วย Map
  const store = new Map<string, any>();
  let seq = 0;
  const roomManager = {
    pauseAiIfActive: jest.fn().mockResolvedValue(false),
    findById: jest.fn().mockResolvedValue(room),
    findByClientMessageId: jest.fn(async (_roomId: string, token: string) => store.get(token) ?? null),
    saveMessage: jest.fn(async (p: any) => {
      if (p.clientMessageId && store.has(p.clientMessageId)) {
        const err: any = new Error('Unique constraint failed');
        err.code = 'P2002';
        throw err;
      }
      const row = {
        id: `m${++seq}`,
        clientMessageId: p.clientMessageId ?? null,
        createdAt: new Date('2026-08-04T03:00:00.000Z'),
        outboundSentAt: null as Date | null,
        type: p.type,
        mediaUrl: p.mediaUrl,
        role: p.role,
      };
      if (p.clientMessageId) store.set(p.clientMessageId, row);
      return row;
    }),
    markOutboundSent: jest.fn(async (id: string, externalMessageId?: string) => {
      for (const row of store.values()) {
        if (row.id === id) {
          row.outboundSentAt = new Date();
          if (externalMessageId) row.externalMessageId = externalMessageId;
        }
      }
    }),
  };
  const adapter = {
    channel: ChatChannel.LINE_SHOP,
    sendMessage: jest.fn().mockResolvedValue({ success: true, externalMessageId: 'ext-1' }),
  };
  const router = new MessageRouterService(
    roomManager as any,
    { initiateHandoff: jest.fn() } as any,
    { get: jest.fn().mockReturnValue(undefined) } as any,
  );
  router.registerAdapter(adapter as any);
  return { router, adapter, roomManager, store };
}

describe('MessageRouterService.sendStaffMessage — IMAGE bubble', () => {
  it('ส่ง imageUrl ให้ adapter และ persist type/mediaUrl ลง ChatMessage', async () => {
    const { router, adapter, roomManager } = makeStaffSender();
    const res = await router.sendStaffMessage({
      roomId: 'r1',
      staffId: 'u1',
      type: MessageType.IMAGE,
      mediaUrl: 'staff-chat/r1/1.jpg',
      mediaType: 'image/jpeg',
      deliveryMediaUrl: 'https://signed.example/1.jpg',
      clientMessageId: 'tok-img',
    });

    expect(res.success).toBe(true);
    expect(roomManager.saveMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: MessageType.IMAGE,
        mediaUrl: 'staff-chat/r1/1.jpg',
        mediaType: 'image/jpeg',
        clientMessageId: 'tok-img',
      }),
    );
    // adapter ต้องได้ URL ที่ public (ไม่ใช่ storage key) และไม่มี text ปนใน bubble รูป
    expect(adapter.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        imageUrl: 'https://signed.example/1.jpg',
        type: MessageType.IMAGE,
        text: undefined,
      }),
    );
  });

  it('retry ด้วย clientMessageId เดิม (ส่งสำเร็จแล้ว) → ไม่เรียก adapter ซ้ำ', async () => {
    const { router, adapter } = makeStaffSender();
    const params = {
      roomId: 'r1',
      staffId: 'u1',
      type: MessageType.IMAGE,
      mediaUrl: 'https://cdn.example/g0.jpg',
      clientMessageId: 'tok-same',
    };
    await router.sendStaffMessage(params);
    const second = await router.sendStaffMessage(params);

    expect(second.success).toBe(true);
    expect(adapter.sendMessage).toHaveBeenCalledTimes(1); // ลูกค้าได้รูปครั้งเดียว
  });

  it('P2002 race (คู่แข่งชนะ) → คืน success โดยไม่เรียก adapter', async () => {
    const { router, adapter, roomManager } = makeStaffSender();
    const winner = {
      id: 'm-winner',
      clientMessageId: 'tok-race',
      createdAt: new Date('2026-08-04T03:00:00.000Z'),
      outboundSentAt: null as Date | null,
    };
    // อ่านครั้งแรกยังไม่เห็น row (คู่แข่ง INSERT ไม่เสร็จ) → saveMessage ชน unique
    // → อ่านซ้ำเจอ row ของคู่แข่ง. ต้องไม่ยิง adapter ซ้ำ (ลูกค้าได้รูปครั้งเดียว)
    roomManager.findByClientMessageId
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(winner);
    roomManager.saveMessage.mockRejectedValueOnce(
      Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }),
    );

    const res = await router.sendStaffMessage({
      roomId: 'r1',
      staffId: 'u1',
      type: MessageType.IMAGE,
      mediaUrl: 'https://cdn.example/g0.jpg',
      clientMessageId: 'tok-race',
    });
    expect(res.success).toBe(true);
    expect(res.message?.id).toBe('m-winner');
    expect(adapter.sendMessage).not.toHaveBeenCalled();
  });

  it('ไม่มีทั้ง text และ mediaUrl → ปฏิเสธก่อนบันทึก', async () => {
    const { router, adapter, roomManager } = makeStaffSender();
    const res = await router.sendStaffMessage({ roomId: 'r1', staffId: 'u1', text: '   ' });
    expect(res).toEqual({ success: false, error: 'ไม่มีเนื้อหาที่จะส่ง' });
    expect(roomManager.saveMessage).not.toHaveBeenCalled();
    expect(adapter.sendMessage).not.toHaveBeenCalled();
  });

  // fix round 1 [I1]: storage key ห้ามหลุดไปช่องทาง — fail fast ก่อน persist
  // (ถ้าปล่อยผ่าน: LINE/FB reject non-https → แถว ChatMessage ค้าง undelivered ถาวร)
  it('IMAGE ที่ deliveryUrl เป็น storage key → ปฏิเสธก่อนบันทึก ไม่เรียก adapter', async () => {
    const { router, adapter, roomManager } = makeStaffSender();
    const res = await router.sendStaffMessage({
      roomId: 'r1',
      staffId: 'u1',
      type: MessageType.IMAGE,
      mediaUrl: 'staff-chat/r1/1.jpg', // storage key + ไม่ส่ง deliveryMediaUrl
      clientMessageId: 'tok-key-leak',
    });
    expect(res.success).toBe(false);
    expect(res.error).toContain('deliveryMediaUrl');
    expect(roomManager.saveMessage).not.toHaveBeenCalled();
    expect(adapter.sendMessage).not.toHaveBeenCalled();
  });

  // fix round 2 [I1]: line:// เป็น lazy-fetch ref ของ inbound media (แถว legacy มีจริง —
  // ดู media-content.service.spec) — LINE ดึงไม่ได้เหมือนกัน ต้องโดน guard เท่า storage key
  it('IMAGE ที่ deliveryUrl เป็น line:// ref → ปฏิเสธก่อนบันทึกเช่นกัน', async () => {
    const { router, adapter, roomManager } = makeStaffSender();
    const res = await router.sendStaffMessage({
      roomId: 'r1',
      staffId: 'u1',
      type: MessageType.IMAGE,
      mediaUrl: 'line://message/12345/content',
      clientMessageId: 'tok-line-ref',
    });
    expect(res.success).toBe(false);
    expect(roomManager.saveMessage).not.toHaveBeenCalled();
    expect(adapter.sendMessage).not.toHaveBeenCalled();
  });

  // fix round 1 [I2]: state 3 ของ jsdoc — retry ของแถวที่บันทึกแล้วแต่ยังไม่เคยส่งสำเร็จ
  // ต้อง "ส่งใหม่" (at-least-once ตามสัญญา inbox-J) โดย DB ยังมีแถวเดียว
  it('adapter fail ครั้งแรก → retry ด้วย clientMessageId เดิมส่งใหม่ได้ (แถวเดียว, stamp หลังสำเร็จ)', async () => {
    const { router, adapter, roomManager, store } = makeStaffSender();
    adapter.sendMessage.mockResolvedValueOnce({ success: false, error: 'timeout' });

    const params = {
      roomId: 'r1',
      staffId: 'u1',
      type: MessageType.IMAGE,
      mediaUrl: 'https://cdn.example/g0.jpg',
      clientMessageId: 'tok-retry-undelivered',
    };
    const first = await router.sendStaffMessage(params);
    expect(first.success).toBe(false);
    expect(store.get('tok-retry-undelivered')?.outboundSentAt).toBeNull(); // ยังไม่ stamp

    const second = await router.sendStaffMessage(params);
    expect(second.success).toBe(true);
    // ส่งซ้ำจริง (at-least-once) แต่ DB ไม่สร้างแถวใหม่
    expect(adapter.sendMessage).toHaveBeenCalledTimes(2);
    expect(roomManager.saveMessage).toHaveBeenCalledTimes(1);
    expect(store.get('tok-retry-undelivered')?.outboundSentAt).not.toBeNull();
  });

  it('stamp externalMessageId ที่ adapter คืนมา (กัน FB echo สร้าง bubble ซ้ำ)', async () => {
    const { router, roomManager } = makeStaffSender();
    await router.sendStaffMessage({
      roomId: 'r1',
      staffId: 'u1',
      text: 'สวัสดีค่ะ',
      clientMessageId: 'tok-echo',
    });
    expect(roomManager.markOutboundSent).toHaveBeenCalledWith('m1', 'ext-1');
  });
});

// ─── B3 Task 9: ส่งรูปสินค้าตามหลังคำตอบบอท ───────────────────────────────────

describe('MessageRouterService — ส่งรูปสินค้าตามคำตอบบอท (B3 Task 9)', () => {
  const aiWithAttachments = {
    reply: 'iPhone 15 128GB ราคา 28,900 บาทค่ะ',
    confidence: 0.95,
    toolsUsed: ['search_products'],
    inputTokens: 1,
    outputTokens: 1,
    attachments: [
      { productId: 'prd-1', imageUrl: 'https://cdn.example.com/p1.jpg', webUrl: 'https://s/p1' },
    ],
  };

  it('ส่งข้อความก่อน (ใช้ replyToken) แล้วค่อยส่งรูป (ไม่มี replyToken)', async () => {
    const { router, adapter } = makeRouter({ aiEligible: true, aiResult: aiWithAttachments });
    await router.routeInbound(baseMsg as any);

    expect(adapter.sendMessage).toHaveBeenCalledTimes(2);
    const [first, second] = adapter.sendMessage.mock.calls.map((c: any[]) => c[0]);
    expect(first).toMatchObject({ type: MessageType.TEXT, replyToken: 'rt-1' });
    expect(second).toMatchObject({
      type: MessageType.IMAGE,
      imageUrl: 'https://cdn.example.com/p1.jpg',
    });
    expect(second.replyToken).toBeUndefined();
  });

  it('บันทึกข้อความรูปลง DB พร้อม type/mediaUrl (widget ฝั่งเว็บอาศัยแถวนี้)', async () => {
    const { router, roomManager } = makeRouter({ aiEligible: true, aiResult: aiWithAttachments });
    await router.routeInbound(baseMsg as any);

    expect(roomManager.saveMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: MessageType.IMAGE,
        mediaUrl: 'https://cdn.example.com/p1.jpg',
      }),
    );
  });

  it('attachment ที่ไม่มีรูป (มีแต่ลิงก์) → ไม่ส่ง bubble เพิ่ม', async () => {
    const { router, adapter } = makeRouter({
      aiEligible: true,
      aiResult: { ...aiWithAttachments, attachments: [{ productId: 'prd-1', webUrl: 'https://s/p1' }] },
    });
    await router.routeInbound(baseMsg as any);
    expect(adapter.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('ไม่มี attachments → พฤติกรรมเดิมทุกอย่าง (ส่งข้อความเดียว)', async () => {
    const { router, adapter } = makeRouter({
      aiEligible: true,
      aiResult: { reply: 'มีค่ะ', confidence: 0.9, toolsUsed: [], inputTokens: 1, outputTokens: 1 },
    });
    await router.routeInbound(baseMsg as any);
    expect(adapter.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('ส่งรูปล้มเหลว → ไม่ทำให้ทั้ง flow พัง และไม่ตอบซ้ำ', async () => {
    const { router, adapter, aiAutoReply } = makeRouter({
      aiEligible: true,
      aiResult: aiWithAttachments,
    });
    adapter.sendMessage
      .mockResolvedValueOnce({ success: true })
      .mockRejectedValueOnce(new Error('LINE 500'));

    await expect(router.routeInbound(baseMsg as any)).resolves.toBeUndefined();
    expect(aiAutoReply.logAutoReply).toHaveBeenCalledWith(
      expect.objectContaining({ autoSent: true }),
    );
  });

  it('ส่งรูปมากสุด 2 ใบ', async () => {
    const { router, adapter } = makeRouter({
      aiEligible: true,
      aiResult: {
        ...aiWithAttachments,
        attachments: [
          { productId: 'a', imageUrl: 'https://c/a.jpg' },
          { productId: 'b', imageUrl: 'https://c/b.jpg' },
          { productId: 'c', imageUrl: 'https://c/c.jpg' },
        ],
      },
    });
    await router.routeInbound(baseMsg as any);
    expect(adapter.sendMessage).toHaveBeenCalledTimes(3); // 1 text + 2 image
  });
});

describe('MessageRouterService — รวมข้อความที่ลูกค้าพิมพ์รัว (coalesce)', () => {
  // ย่อหน้าต่างรอเหลือ 30ms เฉพาะในเทส — ของจริง 3 วิ (โค้ดอ่าน env ตอนรัน)
  const prevEnv = process.env.CHAT_COALESCE_MS;
  beforeAll(() => {
    process.env.CHAT_COALESCE_MS = '30';
  });
  afterAll(() => {
    if (prevEnv === undefined) delete process.env.CHAT_COALESCE_MS;
    else process.env.CHAT_COALESCE_MS = prevEnv;
  });
  const AI_REPLY = { reply: 'ตอบรวมให้ทีเดียวค่ะ', confidence: 0.95, toolsUsed: [], inputTokens: 1, outputTokens: 1 };

  it('ลูกค้าส่ง 2 ข้อความติดกัน → บอทตอบครั้งเดียว (เทิร์นล่าสุดเป็นคนตอบ)', async () => {
    const { router, adapter, aiAutoReply, roomManager } = makeRouter({
      aiEligible: true,
      aiResult: AI_REPLY,
    });
    const msg = (text: string, mid: string) => ({
      externalMessageId: mid,
      externalUserId: 'U1',
      channel: ChatChannel.LINE_SHOP,
      type: 'TEXT',
      text,
    });
    // ยิงติดกันแบบลูกค้าพิมพ์รัว — ไม่ await ตัวแรกก่อน
    const first = router.routeInbound(msg('แล้วเครื่องจะออกก่อนไหม', 'm1') as any);
    const second = router.routeInbound(msg('อีกตั้งครึ่งเดือน', 'm2') as any);
    await Promise.all([first, second]);

    // ข้อความลูกค้าทั้ง 2 ต้องถูกบันทึกครบ (ไม่หาย ขึ้น inbox ปกติ)
    const savedCustomer = roomManager.saveMessage.mock.calls.filter(
      (c: any[]) => c[0].role === MessageRole.CUSTOMER,
    );
    expect(savedCustomer).toHaveLength(2);
    // แต่ AI ต้องถูกเรียกครั้งเดียว และส่งออกครั้งเดียว
    expect(aiAutoReply.autoReply).toHaveBeenCalledTimes(1);
    const sentTexts = adapter.sendMessage.mock.calls.map((c: any[]) => c[0].text);
    expect(sentTexts).toEqual(['ตอบรวมให้ทีเดียวค่ะ']);
  });

  it('ข้อความเดียวธรรมดา → ตอบตามปกติ (ไม่ถูกกลืน)', async () => {
    const { router, adapter, aiAutoReply } = makeRouter({ aiEligible: true, aiResult: AI_REPLY });
    await router.routeInbound({
      externalMessageId: 'm9',
      externalUserId: 'U9',
      channel: ChatChannel.LINE_SHOP,
      type: 'TEXT',
      text: 'สนใจ iPhone 15',
    } as any);
    expect(aiAutoReply.autoReply).toHaveBeenCalledTimes(1);
    expect(adapter.sendMessage).toHaveBeenCalledTimes(1);
  });
});

describe('MessageRouterService — echo จากนอกระบบ (กันข้อความทักทายอัตโนมัติปิด AI)', () => {
  function makeEchoRouter(hasBotReplied: boolean) {
    const roomManager = {
      getOrCreateRoom: jest.fn().mockResolvedValue({ id: 'r1' }),
      saveMessage: jest.fn().mockResolvedValue({ id: 'm1' }),
      hasBotReplied: jest.fn().mockResolvedValue(hasBotReplied),
      pauseAiIfActive: jest.fn().mockResolvedValue(true),
    };
    const router = new MessageRouterService(
      roomManager as any,
      { initiateHandoff: jest.fn() } as any,
      { get: jest.fn() } as any,
    );
    return { router, roomManager };
  }
  const echo = {
    externalUserId: 'U1',
    channel: ChatChannel.FACEBOOK,
    role: MessageRole.STAFF,
    type: MessageType.TEXT,
    text: 'สวัสดีค่ะคุณ Suttinee 😊 BESTCHOICE ยินดีให้บริการค่ะ',
    externalMessageId: 'mid_greeting',
    pauseAi: true,
  };

  it('บอทยังไม่เคยตอบในห้อง (= ข้อความทักทายอัตโนมัติ) → ห้ามปิด AI', async () => {
    const { router, roomManager } = makeEchoRouter(false);
    await router.mirrorOutbound(echo as any);
    await new Promise((r) => setImmediate(r));
    expect(roomManager.saveMessage).toHaveBeenCalled(); // ยังบันทึกเข้ากล่องปกติ
    expect(roomManager.pauseAiIfActive).not.toHaveBeenCalled();
  });

  it('บอทเคยตอบแล้ว (= พนักงานแทรกจริง) → ปิด AI ตามเดิม', async () => {
    const { router, roomManager } = makeEchoRouter(true);
    await router.mirrorOutbound(echo as any);
    await new Promise((r) => setImmediate(r));
    expect(roomManager.pauseAiIfActive).toHaveBeenCalledWith('r1', undefined);
  });
});

describe('MessageRouterService.mirrorOutbound — echo ล้าง waiting', () => {
  const base = { externalUserId: 'PSID-1', channel: ChatChannel.FACEBOOK, text: 'ตอบจากแอป Facebook' };

  it('echo STAFF → ล้าง waiting ของห้อง (ถึงลูกค้าแล้วโดยนิยาม)', async () => {
    const { router, roomManager } = makeRouter({});
    await router.mirrorOutbound({ ...base, role: MessageRole.STAFF, externalMessageId: 'mid-1' });
    expect(roomManager.clearWaiting).toHaveBeenCalledWith('r1');
  });

  it('BOT (greeting อัตโนมัติของเพจ) → ไม่ล้าง waiting', async () => {
    const { router, roomManager } = makeRouter({});
    await router.mirrorOutbound({ ...base, role: MessageRole.BOT, externalMessageId: 'mid-2' });
    expect(roomManager.clearWaiting).not.toHaveBeenCalled();
  });

  it('echo ซ้ำ (P2002) → ไม่ล้างซ้ำ', async () => {
    const { router, roomManager } = makeRouter({});
    const dup: any = new Error('dup');
    dup.code = 'P2002';
    roomManager.saveMessage.mockRejectedValueOnce(dup);
    await router.mirrorOutbound({ ...base, role: MessageRole.STAFF, externalMessageId: 'mid-1' });
    expect(roomManager.clearWaiting).not.toHaveBeenCalled();
  });
});

describe('MessageRouterService.sendStaffMessage — ใครตอบก่อนได้เป็นเจ้าของ', () => {
  function makeClaimingSender(adapterResult: { success: boolean; error?: string }) {
    const { router: base, roomManager, adapter } = makeStaffSender();
    adapter.sendMessage.mockResolvedValue(adapterResult);
    const assignment = { claimIfUnassigned: jest.fn().mockResolvedValue(true) };
    const router = new MessageRouterService(
      roomManager as any,
      { initiateHandoff: jest.fn() } as any,
      { get: jest.fn().mockReturnValue(undefined) } as any,
      undefined, // afterHours
      undefined, // aiAutoReply
      undefined, // adapters
      undefined, // handlers
      undefined, // gateway
      assignment as any,
    );
    router.registerAdapter(adapter as any);
    void base;
    return { router, roomManager, adapter, assignment };
  }

  it('ส่งสำเร็จ → markOutboundSent แล้วค่อย claimIfUnassigned(roomId, staffId)', async () => {
    const { router, roomManager, assignment } = makeClaimingSender({ success: true });
    const res = await router.sendStaffMessage({ roomId: 'r1', staffId: 'u1', text: 'สวัสดีค่ะ', clientMessageId: 'tok-1' });

    expect(res.success).toBe(true);
    expect(assignment.claimIfUnassigned).toHaveBeenCalledWith('r1', 'u1');
    expect(roomManager.markOutboundSent.mock.invocationCallOrder[0])
      .toBeLessThan(assignment.claimIfUnassigned.mock.invocationCallOrder[0]);
  });

  it('adapter ส่งล้ม → ไม่ markOutboundSent และไม่รับเรื่อง (ลูกค้ายังไม่ได้รับคำตอบ)', async () => {
    const { router, roomManager, assignment } = makeClaimingSender({ success: false, error: '(#10) outside window' });
    const res = await router.sendStaffMessage({ roomId: 'r1', staffId: 'u1', text: 'สวัสดีค่ะ', clientMessageId: 'tok-2' });

    expect(res.success).toBe(false);
    expect(roomManager.markOutboundSent).not.toHaveBeenCalled();
    expect(assignment.claimIfUnassigned).not.toHaveBeenCalled();
  });

  it('claim ล้ม (เช่น DB error) → ไม่ทำให้การส่งที่สำเร็จแล้วกลายเป็นล้ม', async () => {
    const { router, assignment } = makeClaimingSender({ success: true });
    assignment.claimIfUnassigned.mockRejectedValue(new Error('db down'));
    const res = await router.sendStaffMessage({ roomId: 'r1', staffId: 'u1', text: 'สวัสดีค่ะ', clientMessageId: 'tok-3' });
    expect(res.success).toBe(true);
  });
});

describe('MessageRouterService.mirrorOutbound — ข้อความทักทายอัตโนมัติของเพจต้องไม่เตะลูกค้าใหม่ออกจากคิว', () => {
  const WAITING_SINCE = new Date('2026-09-05T02:00:00.000Z');
  const base = { externalUserId: 'PSID-1', channel: ChatChannel.FACEBOOK, text: 'สวัสดีค่ะ BESTCHOICE ยินดีให้บริการ' };

  /**
   * ใช้ RoomManagerService "ตัวจริง" เป็นคนตัดสิน shouldSkipFirstOutboundClear
   * (บน prisma จำลอง) — เทสต์ชุดนี้จึงพิสูจน์เงื่อนไขจริง (ใบแรก + ใน 60 วินาที)
   * ไม่ใช่ค่าที่ mock ตอบกลับมา
   */
  function makeEchoRouter(opts: {
    waitingSince?: Date | null;
    priorOutbound?: number;
    echoAt: Date;
    duplicate?: boolean;
  }) {
    const messages: any[] = [];
    for (let i = 0; i < (opts.priorOutbound ?? 0); i++) {
      messages.push({
        id: `prior-${i}`,
        roomId: 'r1',
        role: MessageRole.STAFF,
        createdAt: new Date('2026-09-04T00:00:00.000Z'),
        deletedAt: null,
      });
    }
    const prisma = {
      chatRoom: {
        findUnique: jest.fn(async ({ where }: any) =>
          where.id === 'r1' ? { waitingSince: opts.waitingSince ?? WAITING_SINCE } : null,
        ),
      },
      chatMessage: {
        findUnique: jest.fn(async ({ where }: any) => messages.find((m) => m.id === where.id) ?? null),
        count: jest.fn(async ({ where }: any) =>
          messages.filter(
            (m) =>
              m.roomId === where.roomId && m.deletedAt === null && where.role.in.includes(m.role),
          ).length,
        ),
      },
    };
    const realRoomManager = new RoomManagerService(prisma as any, {} as any);
    const roomManager = {
      getOrCreateRoom: jest.fn().mockResolvedValue({ id: 'r1' }),
      saveMessage: jest.fn(async (p: any) => {
        if (opts.duplicate) {
          const dup: any = new Error('dup');
          dup.code = 'P2002';
          throw dup;
        }
        const row = {
          id: 'echo-1',
          roomId: 'r1',
          role: p.role,
          createdAt: opts.echoAt,
          deletedAt: null,
        };
        messages.push(row);
        return row;
      }),
      clearWaiting: jest.fn().mockResolvedValue(undefined),
      shouldSkipFirstOutboundClear: jest.fn((roomId: string, msgId: string) =>
        realRoomManager.shouldSkipFirstOutboundClear(roomId, msgId),
      ),
    };
    const router = new MessageRouterService(
      roomManager as any,
      { initiateHandoff: jest.fn() } as any,
      { get: jest.fn().mockReturnValue(undefined) } as any,
    );
    return { router, roomManager };
  }

  it('echo ใบแรกของห้อง ภายใน 60 วินาทีหลังลูกค้าทัก (= greeting ของเพจ) → ไม่ล้าง waiting', async () => {
    const { router, roomManager } = makeEchoRouter({
      echoAt: new Date(WAITING_SINCE.getTime() + 3_000),
    });
    await router.mirrorOutbound({ ...base, role: MessageRole.STAFF, externalMessageId: 'mid-g1' } as any);
    expect(roomManager.saveMessage).toHaveBeenCalled();
    expect(roomManager.clearWaiting).not.toHaveBeenCalled();
  });

  it('echo ใบแรกแต่มาหลังเกิน 60 วินาที (= คนตอบจริง) → ล้าง waiting ตามปกติ', async () => {
    const { router, roomManager } = makeEchoRouter({
      echoAt: new Date(WAITING_SINCE.getTime() + 61_000),
    });
    await router.mirrorOutbound({ ...base, role: MessageRole.STAFF, externalMessageId: 'mid-g2' } as any);
    expect(roomManager.clearWaiting).toHaveBeenCalledWith('r1');
  });

  it('ห้องที่เคยมี outbound แล้ว → echo ใบถัดไปล้างเสมอ แม้จะมาเร็ว', async () => {
    const { router, roomManager } = makeEchoRouter({
      priorOutbound: 1,
      echoAt: new Date(WAITING_SINCE.getTime() + 2_000),
    });
    await router.mirrorOutbound({ ...base, role: MessageRole.STAFF, externalMessageId: 'mid-g3' } as any);
    expect(roomManager.clearWaiting).toHaveBeenCalledWith('r1');
  });

  it('BOT echo → ไม่ล้าง และไม่ต้องถามด่านเลย', async () => {
    const { router, roomManager } = makeEchoRouter({
      echoAt: new Date(WAITING_SINCE.getTime() + 120_000),
    });
    await router.mirrorOutbound({ ...base, role: MessageRole.BOT, externalMessageId: 'mid-g4' } as any);
    expect(roomManager.clearWaiting).not.toHaveBeenCalled();
    expect(roomManager.shouldSkipFirstOutboundClear).not.toHaveBeenCalled();
  });

  it('echo ซ้ำ (P2002) → ไม่ล้าง และไม่ถามด่าน (ออกก่อนตั้งแต่ saveMessage)', async () => {
    const { router, roomManager } = makeEchoRouter({
      duplicate: true,
      echoAt: new Date(WAITING_SINCE.getTime() + 120_000),
    });
    await router.mirrorOutbound({ ...base, role: MessageRole.STAFF, externalMessageId: 'mid-g5' } as any);
    expect(roomManager.clearWaiting).not.toHaveBeenCalled();
    expect(roomManager.shouldSkipFirstOutboundClear).not.toHaveBeenCalled();
  });
});

describe('MessageRouterService.sendStaffOutbound — ข้อความสำเร็จรูปก็ต้องล้าง waiting + รับเรื่อง', () => {
  function makeOutboundSender(adapterResult: { success: boolean; error?: string; externalMessageId?: string }) {
    const room = {
      id: 'r1',
      channel: ChatChannel.LINE_SHOP,
      externalUserId: 'U1',
      lineUserId: null,
    };
    const roomManager = {
      findById: jest.fn().mockResolvedValue(room),
      saveMessage: jest.fn().mockResolvedValue({ id: 'm-canned', clientMessageId: null, createdAt: new Date() }),
      markOutboundSent: jest.fn().mockResolvedValue(undefined),
    };
    const assignment = { claimIfUnassigned: jest.fn().mockResolvedValue(true) };
    const adapter = {
      channel: ChatChannel.LINE_SHOP,
      sendMessage: jest.fn().mockResolvedValue(adapterResult),
    };
    const router = new MessageRouterService(
      roomManager as any,
      { initiateHandoff: jest.fn() } as any,
      { get: jest.fn().mockReturnValue(undefined) } as any,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      assignment as any,
    );
    router.registerAdapter(adapter as any);
    return { router, roomManager, assignment, adapter };
  }

  it('ส่งสำเร็จ → markOutboundSent (ล้าง waiting) แล้วค่อย claimIfUnassigned', async () => {
    const { router, roomManager, assignment } = makeOutboundSender({ success: true, externalMessageId: 'ext-9' });
    const res = await router.sendStaffOutbound('r1', { text: 'สวัสดีค่ะ' } as any, 'u1');

    expect(res.success).toBe(true);
    expect(roomManager.markOutboundSent).toHaveBeenCalledWith('m-canned', 'ext-9');
    expect(assignment.claimIfUnassigned).toHaveBeenCalledWith('r1', 'u1');
    expect(roomManager.markOutboundSent.mock.invocationCallOrder[0]).toBeLessThan(
      assignment.claimIfUnassigned.mock.invocationCallOrder[0],
    );
  });

  it('adapter ส่งล้ม → ไม่ stamp และไม่รับเรื่อง (ลูกค้ายังไม่ได้รับคำตอบ)', async () => {
    const { router, roomManager, assignment } = makeOutboundSender({ success: false, error: '(#10) outside window' });
    const res = await router.sendStaffOutbound('r1', { text: 'สวัสดีค่ะ' } as any, 'u1');

    expect(res.success).toBe(false);
    expect(roomManager.markOutboundSent).not.toHaveBeenCalled();
    expect(assignment.claimIfUnassigned).not.toHaveBeenCalled();
  });

  it('claim ล้ม → ไม่ทำให้การส่งที่สำเร็จแล้วกลายเป็นล้ม', async () => {
    const { router, assignment } = makeOutboundSender({ success: true, externalMessageId: 'ext-9' });
    assignment.claimIfUnassigned.mockRejectedValue(new Error('db down'));
    const res = await router.sendStaffOutbound('r1', { text: 'สวัสดีค่ะ' } as any, 'u1');
    expect(res.success).toBe(true);
  });
});

describe('MessageRouterService — ข้อความระบบ "รับห้องนี้ (ตอบก่อน)"', () => {
  it('claimIfUnassigned=true → โน้ตระบบแบบเงียบ 1 ครั้ง · false → ไม่มีโน้ต', async () => {
    const { router, roomManager } = makeRouter({});
    (roomManager as any).getStaffName = jest.fn().mockResolvedValue('แนน');
    const assignment = { claimIfUnassigned: jest.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false) };
    (router as any).assignmentService = assignment;
    await (router as any).noteClaimIfFirst('r1', 'u1');
    expect(roomManager.saveMessage).toHaveBeenCalledWith(
      expect.objectContaining({ roomId: 'r1', role: MessageRole.SYSTEM, silent: true, text: 'แนน รับห้องนี้ (ตอบก่อน)' }),
    );
    roomManager.saveMessage.mockClear();
    await (router as any).noteClaimIfFirst('r1', 'u1');
    expect(roomManager.saveMessage).not.toHaveBeenCalled();
  });
});

describe('MessageRouterService — ที่มาจากโฆษณา (PR-A referral)', () => {
  const AD = {
    utmSource: 'facebook',
    utmCampaign: '120246504706250534',
    referrerUrl: 'ADS',
    adId: '120246504706250534',
    adTitle: 'ฝนตกไม่อยากออกจากบ้าน',
    adPhotoUrl: 'https://scontent.example/ad.jpg',
  };

  it('ข้อความแรกจากโฆษณา → ส่ง attribution เข้า getOrCreateRoom และโพสต์โน้ตระบบในห้อง', async () => {
    const { router, roomManager } = makeRouter({});
    (roomManager as any).findByExternalUser = jest.fn();
    (roomManager as any).linkAttribution = jest.fn();

    await router.routeInbound({ ...baseMsg, channel: ChatChannel.FACEBOOK, attribution: AD } as any);

    expect(roomManager.getOrCreateRoom).toHaveBeenCalledWith(expect.objectContaining({ attribution: AD }));
    expect(roomManager.saveMessage).toHaveBeenCalledWith(
      expect.objectContaining({ roomId: 'r1', role: MessageRole.SYSTEM, text: 'ลูกค้าทักจากโฆษณา · ฝนตกไม่อยากออกจากบ้าน' }),
    );
  });

  it('ข้อความปกติ (ไม่มี adId) → ไม่มีโน้ตโฆษณา', async () => {
    const { router, roomManager } = makeRouter({});
    await router.routeInbound({ ...baseMsg, attribution: { utmSource: 'facebook', utmContent: 'p:abc' } } as any);
    const systemNotes = roomManager.saveMessage.mock.calls.filter((c) => c[0].role === MessageRole.SYSTEM);
    expect(systemNotes).toHaveLength(0);
  });

  it('recordAdReferral: ลูกค้าเก่ากลับมาจากโฆษณา → ผูกที่มาให้ห้องเดิม + โน้ต · ไม่มีห้อง = ไม่ทำอะไร', async () => {
    const { router, roomManager } = makeRouter({});
    (roomManager as any).findByExternalUser = jest.fn().mockResolvedValue({ id: 'r-old', attributionId: 'a-old' });
    (roomManager as any).linkAttribution = jest.fn().mockResolvedValue({ campaignName: 'x', adTitle: 'x', changed: true });

    await router.recordAdReferral('PSID-1', ChatChannel.FACEBOOK, AD);

    expect((roomManager as any).linkAttribution).toHaveBeenCalledWith('r-old', AD, 'a-old');
    expect(roomManager.saveMessage).toHaveBeenCalledWith(
      expect.objectContaining({ roomId: 'r-old', role: MessageRole.SYSTEM, text: 'ลูกค้าทักจากโฆษณา · ฝนตกไม่อยากออกจากบ้าน' }),
    );

    (roomManager as any).findByExternalUser.mockResolvedValue(null);
    (roomManager as any).linkAttribution.mockClear();
    await router.recordAdReferral('PSID-2', ChatChannel.FACEBOOK, AD);
    expect((roomManager as any).linkAttribution).not.toHaveBeenCalled();
  });

  it('โฆษณาไม่มีชื่อ → โน้ตใช้เลขโฆษณาแทน ไม่ว่าง', async () => {
    const { router, roomManager } = makeRouter({});
    await router.routeInbound({ ...baseMsg, attribution: { ...AD, adTitle: undefined } } as any);
    expect(roomManager.saveMessage).toHaveBeenCalledWith(
      expect.objectContaining({ role: MessageRole.SYSTEM, text: 'ลูกค้าทักจากโฆษณา · โฆษณา 120246504706250534' }),
    );
  });
});

describe('MessageRouterService — ผู้สนใจอัตโนมัติ (Ruling R3)', () => {
  it('routeInbound (ลูกค้าทักจริง) → ขอผู้สนใจ ensureProspect: true — รวมห้อง WEB', async () => {
    const { router, roomManager } = makeRouter({});
    await router.routeInbound({ ...baseMsg, channel: ChatChannel.WEB } as any);
    expect(roomManager.getOrCreateRoom).toHaveBeenCalledWith(
      expect.objectContaining({ channel: ChatChannel.WEB, ensureProspect: true }),
    );
  });

  it('mirrorInbound (ลูกค้าทักจริง) → ขอผู้สนใจ ensureProspect: true', async () => {
    const { router, roomManager } = makeRouter({});
    await router.mirrorInbound(baseMsg as any);
    expect(roomManager.getOrCreateRoom).toHaveBeenCalledWith(expect.objectContaining({ ensureProspect: true }));
  });

  it('mirrorOutbound (ข้อความขาออก) → ไม่ส่งธง ใช้ค่าตั้งต้นตามช่องทาง', async () => {
    const { router, roomManager } = makeRouter({});
    await router.mirrorOutbound({ externalUserId: 'PSID-1', channel: ChatChannel.FACEBOOK, role: MessageRole.BOT, text: 'สวัสดี' });
    expect(roomManager.getOrCreateRoom.mock.calls[0][0]).not.toHaveProperty('ensureProspect');
  });
});
