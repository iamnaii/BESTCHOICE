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
