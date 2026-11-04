import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ChatbotFinanceService } from './chatbot-finance.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { LineFinanceClientService } from './line-finance-client.service';
import { ChatRoomService } from './chat-room.service';
import { VerificationService } from './verification.service';
import { FinanceAiService } from './finance-ai.service';
import { HandoffService } from './handoff.service';
import { SlipProcessingService } from './slip-processing.service';
import { FeedbackService } from './feedback.service';
import { QuickReplyPostbackRouterService } from '../../staff-chat/services/quick-reply-postback-router.service';
import { LineGroupMembershipService } from './line-group-membership.service';
import { MessageRouterService } from '../../chat-engine/services/message-router.service';
import { StorageService } from '../../storage/storage.service';
import { ChatChannel, MessageType } from '@prisma/client';
import { formatStickerToken } from '../../chat-engine/utils/sticker-token.util';

describe('ChatbotFinanceService', () => {
  let service: ChatbotFinanceService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let lineClient: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let sessions: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let verification: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let ai: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let handoff: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let slipProcessing: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let groups: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let messageRouter: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let storage: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let postbackRouter: any;

  const session = { id: 'sess-1', customerId: null };
  const linkedStatus = { linked: true, customerId: 'c1', customerName: 'สมชาย' };

  beforeEach(async () => {
    prisma = {
      systemConfig: { findUnique: jest.fn().mockResolvedValue({ value: 'liff-123' }) },
      // Phase 5 — postback handler looks up the LINE_FINANCE ChatRoom before
      // dispatching to QuickReplyPostbackRouterService. Default: no room
      // (router stub also returns handled:false → existing feedback flow runs).
      chatRoom: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    lineClient = {
      replyText: jest.fn().mockResolvedValue(undefined),
      replyMessage: jest.fn().mockResolvedValue(undefined),
      getMessageContent: jest.fn().mockResolvedValue(Buffer.from('img')),
    };
    sessions = {
      getOrCreate: jest.fn().mockResolvedValue(session),
      confirmBotSent: jest.fn().mockResolvedValue(undefined),
      saveMessage: jest.fn().mockResolvedValue({ id: 'msg-1' }),
      getRecentMessages: jest.fn().mockResolvedValue([]),
      linkRoomToCustomer: jest.fn().mockResolvedValue(undefined),
    };
    verification = {
      isLinked: jest.fn().mockResolvedValue(linkedStatus),
    };
    ai = {
      generateReply: jest.fn().mockResolvedValue({
        text: 'สวัสดีค่ะ',
        model: 'claude-sonnet-4-5',
        inputTokens: 100,
        outputTokens: 50,
        toolsUsed: [],
        handoffTriggered: false,
      }),
    };
    handoff = {
      isBotSilenced: jest.fn().mockResolvedValue(false),
    };
    slipProcessing = {
      processSlip: jest
        .fn()
        .mockResolvedValue({ ok: true, reply: 'รับสลิปแล้วค่ะ', matched: true }),
    };
    groups = {
      onJoin: jest.fn().mockResolvedValue(undefined),
      onLeave: jest.fn().mockResolvedValue(undefined),
      ensureKnown: jest.fn().mockResolvedValue(undefined),
    };
    messageRouter = { mirrorInbound: jest.fn().mockResolvedValue(undefined) };
    storage = {
      configured: true,
      upload: jest.fn().mockImplementation(async (key: string) => key),
    };
    postbackRouter = { route: jest.fn().mockResolvedValue({ handled: false }) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatbotFinanceService,
        { provide: PrismaService, useValue: prisma },
        { provide: LineFinanceClientService, useValue: lineClient },
        { provide: ChatRoomService, useValue: sessions },
        { provide: VerificationService, useValue: verification },
        { provide: FinanceAiService, useValue: ai },
        { provide: HandoffService, useValue: handoff },
        { provide: SlipProcessingService, useValue: slipProcessing },
        {
          provide: FeedbackService,
          useValue: { saveFeedback: jest.fn().mockResolvedValue({ ok: true }) },
        },
        // ChatbotFinanceService recently added ConfigService as a constructor dep
        // (used for FB_BOT_DISABLED / LINE token reads). Tests don't exercise
        // those paths — a no-op stub keeps DI happy without affecting assertions.
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue(undefined) } },
        // Phase 5 — QuickReplyPostbackRouterService injected via forwardRef
        // for TEMPLATE:<id> Quick Reply routing. Stub returns handled:false so
        // existing postback specs (feedback flow) fall through unchanged.
        { provide: QuickReplyPostbackRouterService, useValue: postbackRouter },
        { provide: LineGroupMembershipService, useValue: groups },
        // Task 44 — โหมด "เก็บเข้า inbox ไม่ตอบอัตโนมัติ" (LINE_FINANCE_BOT_DISABLED=true)
        { provide: MessageRouterService, useValue: messageRouter },
        { provide: StorageService, useValue: storage },
      ],
    }).compile();

    service = module.get(ChatbotFinanceService);
  });

  const makeTextEvent = (text: string) => ({
    type: 'message' as const,
    mode: 'active',
    timestamp: Date.now(),
    source: { type: 'user' as const, userId: 'U123' },
    webhookEventId: 'evt-1',
    deliveryContext: { isRedelivery: false },
    replyToken: 'rt-1',
    message: { id: 'msg-1', type: 'text' as const, text },
  });

  it.each([true, false])(
    'records bot evidence only after an acknowledged reply (verified=%s)',
    async (verified) => {
      verification.isLinked.mockResolvedValue(verified ? linkedStatus : { linked: false });
      let acknowledge!: () => void;
      lineClient.replyMessage.mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            acknowledge = resolve;
          }),
      );
      const pending = service.handleEvent(makeTextEvent('hello'));
      for (let i = 0; i < 20 && !acknowledge; i++) await Promise.resolve();
      expect(sessions.confirmBotSent).not.toHaveBeenCalled();
      acknowledge();
      await pending;
      expect(sessions.confirmBotSent).toHaveBeenCalledWith('msg-1');
      sessions.confirmBotSent.mockClear();
      lineClient.replyMessage.mockRejectedValueOnce(new Error('rejected'));
      await service.handleEvent(makeTextEvent('retry'));
      expect(sessions.confirmBotSent).not.toHaveBeenCalled();
    },
  );
  it('sends AI reply for verified text message', async () => {
    await service.handleEvent(makeTextEvent('ยอดเท่าไหร่'));

    expect(verification.isLinked).toHaveBeenCalledWith('U123');
    expect(ai.generateReply).toHaveBeenCalledWith(
      expect.objectContaining({ userMessage: 'ยอดเท่าไหร่', customerId: 'c1' }),
    );
    expect(lineClient.replyMessage).toHaveBeenCalledWith('rt-1', [
      { type: 'text', text: 'สวัสดีค่ะ' },
    ]);
  });

  it('sends verify Flex prompt when not linked', async () => {
    verification.isLinked.mockResolvedValue({ linked: false });

    await service.handleEvent(makeTextEvent('สวัสดี'));

    expect(ai.generateReply).not.toHaveBeenCalled();
    expect(lineClient.replyMessage).toHaveBeenCalledWith(
      'rt-1',
      expect.arrayContaining([
        expect.objectContaining({
          type: 'flex',
          altText: expect.stringContaining('ยืนยันตัวตน'),
        }),
      ]),
    );
  });

  it('skips response in handoff mode but saves message', async () => {
    handoff.isBotSilenced.mockResolvedValue(true);

    await service.handleEvent(makeTextEvent('ช่วยด้วย'));

    expect(sessions.saveMessage).toHaveBeenCalled();
    expect(ai.generateReply).not.toHaveBeenCalled();
    expect(lineClient.replyMessage).not.toHaveBeenCalled();
  });

  it('sends fallback when AI returns null', async () => {
    ai.generateReply.mockResolvedValue(null);

    await service.handleEvent(makeTextEvent('test'));

    expect(lineClient.replyMessage).toHaveBeenCalledWith('rt-1', [
      expect.objectContaining({ type: 'text', text: expect.stringContaining('ระบบขัดข้อง') }),
    ]);
  });

  it('processes image through slip processing', async () => {
    const imageEvent = {
      type: 'message' as const,
      mode: 'active',
      timestamp: Date.now(),
      source: { type: 'user' as const, userId: 'U123' },
      webhookEventId: 'evt-2',
      deliveryContext: { isRedelivery: false },
      replyToken: 'rt-2',
      message: { id: 'img-1', type: 'image' as const, contentProvider: { type: 'line' } },
    };

    await service.handleEvent(imageEvent);

    expect(slipProcessing.processSlip).toHaveBeenCalledWith(
      expect.objectContaining({ customerId: 'c1', lineUserId: 'U123' }),
    );
  });

  it('handles follow event with greeting + verify Flex', async () => {
    const followEvent = {
      type: 'follow' as const,
      mode: 'active',
      timestamp: Date.now(),
      source: { type: 'user' as const, userId: 'U123' },
      webhookEventId: 'evt-3',
      deliveryContext: { isRedelivery: false },
      replyToken: 'rt-3',
    };

    await service.handleEvent(followEvent);

    expect(lineClient.replyMessage).toHaveBeenCalledWith(
      'rt-3',
      expect.arrayContaining([
        expect.objectContaining({
          type: 'text',
          text: expect.stringContaining('ยินดีให้บริการ'),
        }),
        expect.objectContaining({ type: 'flex' }),
      ]),
    );
  });

  it('truncates long messages before sending to AI', async () => {
    const longText = 'ก'.repeat(3000);

    await service.handleEvent(makeTextEvent(longText));

    // Full text saved to DB
    expect(sessions.saveMessage).toHaveBeenCalledWith(expect.objectContaining({ text: longText }));
    // Truncated text sent to AI (2000 chars + ellipsis)
    const aiCall = ai.generateReply.mock.calls[0][0];
    expect(aiCall.userMessage.length).toBeLessThanOrEqual(2001);
    expect(aiCall.userMessage).toContain('…');
  });

  it('links session to customer on first verified message', async () => {
    sessions.getOrCreate.mockResolvedValue({ id: 'sess-1', customerId: null });

    await service.handleEvent(makeTextEvent('ยอดเท่าไหร่'));

    expect(sessions.linkRoomToCustomer).toHaveBeenCalledWith('sess-1', 'c1');
  });

  it('session ถือ placeholder แต่ LINE ผูกลูกค้าจริงแล้ว → เรียก linkRoomToCustomer (เดิมเช็คแค่ !customerId)', async () => {
    // session.customerId = 'p1' (ผู้สนใจอัตโนมัติที่เคยผูกห้องนี้ไว้) แต่ linkedStatus.customerId = 'c1'
    // (คนละคนกัน — LINE ถูกผูกกับลูกค้าจริงแล้วผ่าน OTP/LIFF) เงื่อนไขเดิม `!session.customerId` จะไม่เรียก
    // linkRoomToCustomer เลยเพราะ session.customerId ไม่ใช่ falsy — ต้องเทียบค่าแทน
    sessions.getOrCreate.mockResolvedValue({ id: 'sess-1', customerId: 'p1' });

    await service.handleEvent(makeTextEvent('ยอดเท่าไหร่'));

    expect(sessions.linkRoomToCustomer).toHaveBeenCalledWith('sess-1', 'c1');
  });

  it('session ผูกลูกค้าจริงเดิมอยู่แล้ว (ตรงกับ LINE) → ไม่เรียก linkRoomToCustomer ซ้ำ', async () => {
    sessions.getOrCreate.mockResolvedValue({ id: 'sess-1', customerId: 'c1' });

    await service.handleEvent(makeTextEvent('ยอดเท่าไหร่'));

    expect(sessions.linkRoomToCustomer).not.toHaveBeenCalled();
  });

  describe('น้องเบสส่งรูปสินค้า (B3 Task 12)', () => {
    it('ส่ง text + image ใน reply เดียว และบันทึกทั้งสองข้อความ', async () => {
      ai.generateReply.mockResolvedValue({
        text: 'iPhone 15 128GB ราคา 28,900 บาทค่ะ',
        model: 'claude-sonnet-4-6',
        inputTokens: 10,
        outputTokens: 5,
        toolsUsed: ['search_products'],
        handoffTriggered: false,
        attachments: [{ productId: 'prd-1', imageUrl: 'https://cdn.example.com/p1.jpg' }],
      });

      await service.handleEvent(makeTextEvent('iPhone 15 มีไหม'));

      const messages = lineClient.replyMessage.mock.calls.at(-1)![1];
      expect(messages[0]).toMatchObject({ type: 'text' });
      expect(messages[1]).toMatchObject({
        type: 'image',
        originalContentUrl: 'https://cdn.example.com/p1.jpg',
        previewImageUrl: 'https://cdn.example.com/p1.jpg',
      });
      expect(sessions.saveMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'IMAGE', mediaUrl: 'https://cdn.example.com/p1.jpg' }),
      );
    });

    it('quick reply แปะกับข้อความสุดท้าย (รูป) เมื่อมีรูป', async () => {
      ai.generateReply.mockResolvedValue({
        text: 'ราคา 28,900 บาทค่ะ',
        model: 'm',
        inputTokens: 1,
        outputTokens: 1,
        toolsUsed: ['search_products'], // toolsUsed > 0 → มี feedback quick reply
        handoffTriggered: false,
        attachments: [{ productId: 'prd-1', imageUrl: 'https://cdn.example.com/p1.jpg' }],
      });

      await service.handleEvent(makeTextEvent('ราคาเท่าไหร่'));
      const messages = lineClient.replyMessage.mock.calls.at(-1)![1];
      expect(messages.at(-1).quickReply).toBeDefined();
      expect(messages[0].quickReply).toBeUndefined();
    });

    it('ไม่มี attachments → ส่งข้อความเดียวเหมือนเดิม', async () => {
      ai.generateReply.mockResolvedValue({
        text: 'สวัสดีค่ะ',
        model: 'm',
        inputTokens: 1,
        outputTokens: 1,
        toolsUsed: [],
        handoffTriggered: false,
      });
      await service.handleEvent(makeTextEvent('สวัสดี'));
      expect(lineClient.replyMessage.mock.calls.at(-1)![1]).toHaveLength(1);
    });

    it('[I1] quick reply ไม่หายเงียบเมื่อ attachments ถูกตัดทิ้งหมด (all-or-nothing gate เจอ >2 เครื่อง) แต่ toolsUsed ยัง trigger feedback quick reply', async () => {
      ai.generateReply.mockResolvedValue({
        text: 'มี 3 เครื่องค่ะ ลองระบุรุ่นที่สนใจเพิ่มเติมได้เลยค่ะ',
        model: 'm',
        inputTokens: 1,
        outputTokens: 1,
        // search_products เจอ >2 เครื่อง → collectAttachmentsFromToolResult all-or-nothing gate
        // ตัดรูปทั้งหมดออก (ดู bot-attachments.util.ts) แต่ toolsUsed ยังไม่ว่าง → ยัง trigger
        // feedback quick reply ตามปกติ — attachments จึงเป็น undefined ไม่ใช่ array ว่าง
        toolsUsed: ['search_products'],
        handoffTriggered: false,
        // attachments omitted — เหมือนผลจริงจาก all-or-nothing gate ที่ FinanceAiService
        // ไม่ใส่ key นี้เลยเมื่อ Map ว่าง (attachments.size > 0 ? {...} : {})
      });

      await service.handleEvent(makeTextEvent('มีอะไรบ้าง'));

      const messages = lineClient.replyMessage.mock.calls.at(-1)![1];
      expect(messages).toHaveLength(1); // ไม่มีรูป → ข้อความเดียว (TEXT)
      expect(messages[0]).toMatchObject({ type: 'text' });
      expect(messages[0].quickReply).toBeDefined();
    });

    it('ส่งรูปมากสุด 2 ใบ (กันเกินโควตา 5 ข้อความ/reply)', async () => {
      ai.generateReply.mockResolvedValue({
        text: 'มี 3 เครื่องค่ะ',
        model: 'm',
        inputTokens: 1,
        outputTokens: 1,
        toolsUsed: ['search_products'],
        handoffTriggered: false,
        attachments: [
          { productId: 'a', imageUrl: 'https://c/a.jpg' },
          { productId: 'b', imageUrl: 'https://c/b.jpg' },
          { productId: 'c', imageUrl: 'https://c/c.jpg' },
        ],
      });
      await service.handleEvent(makeTextEvent('มีอะไรบ้าง'));
      expect(lineClient.replyMessage.mock.calls.at(-1)![1]).toHaveLength(3); // 1 text + 2 image
    });
  });

  const makeGroupEvent = (type: 'join' | 'leave', sourceType: 'group' | 'room' = 'group') =>
    ({
      type,
      mode: 'active',
      timestamp: Date.now(),
      webhookEventId: `evt-${type}`,
      deliveryContext: { isRedelivery: false },
      source:
        sourceType === 'group'
          ? { type: 'group' as const, groupId: 'Cgroup1', userId: 'U1' }
          : { type: 'room' as const, roomId: 'R1' },
      ...(type === 'join' ? { replyToken: 'rt-join' } : {}),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any;

  describe('เข้า/ออกกลุ่ม (ยื่น GFIN PR 2)', () => {
    it('join จากกลุ่ม → LineGroupMembershipService.onJoin(FINANCE, groupId) และไม่ตอบข้อความ', async () => {
      await service.handleEvent(makeGroupEvent('join'));
      expect(groups.onJoin).toHaveBeenCalledWith('FINANCE', 'Cgroup1');
      expect(lineClient.replyText).not.toHaveBeenCalled();
      expect(lineClient.replyMessage).not.toHaveBeenCalled();
    });
    it('leave จากกลุ่ม → onLeave', async () => {
      await service.handleEvent(makeGroupEvent('leave'));
      expect(groups.onLeave).toHaveBeenCalledWith('FINANCE', 'Cgroup1');
    });
    it('join จากห้องแชทหลายคน (room) → ไม่จด', async () => {
      await service.handleEvent(makeGroupEvent('join', 'room'));
      expect(groups.onJoin).not.toHaveBeenCalled();
    });
    it('LINE_FINANCE_BOT_DISABLED=true → ยังจด join (kill switch หยุดเฉพาะการตอบ)', async () => {
      const config = (service as any).configService as { get: jest.Mock };
      config.get.mockImplementation((k: string) =>
        k === 'LINE_FINANCE_BOT_DISABLED' ? 'true' : undefined,
      );
      await service.handleEvent(makeGroupEvent('join'));
      expect(groups.onJoin).toHaveBeenCalledWith('FINANCE', 'Cgroup1');
      // Task 44 — kill switch = "เก็บเข้า inbox ไม่ตอบอัตโนมัติ" (เดิม = ทิ้งข้อความ) — ดู describe ท้ายไฟล์
      await service.handleEvent(makeTextEvent('สวัสดี'));
      expect(lineClient.replyMessage).not.toHaveBeenCalled();
      expect(ai.generateReply).not.toHaveBeenCalled();
    });
    // F3 (final-fix wave) — กลุ่มที่เชิญ OA เข้าไว้ก่อน PR 2 ขึ้น ไม่เคยได้ event join ซ้ำ (LINE ไม่ resend join
    // เมื่อบอทเป็นสมาชิกอยู่แล้ว) → ต้องจดสมาชิกภาพจากข้อความกลุ่มอื่นแทน ก่อน kill switch เหมือน join/leave
    it('ข้อความจากกลุ่ม (ไม่ใช่ join/leave) → ensureKnown(FINANCE, groupId) แล้วยังไม่ตอบ (handleMessage ทิ้งข้อความกลุ่มตามเดิม)', async () => {
      const groupTextEvent = {
        ...makeTextEvent('สวัสดี'),
        source: { type: 'group' as const, groupId: 'Cgroup1', userId: 'U1' },
      };
      await service.handleEvent(groupTextEvent as any);
      expect(groups.ensureKnown).toHaveBeenCalledWith('FINANCE', 'Cgroup1');
      expect(sessions.saveMessage).not.toHaveBeenCalled();
      expect(lineClient.replyMessage).not.toHaveBeenCalled();
    });
    it('ข้อความจากผู้ใช้ 1:1 → ไม่เรียก ensureKnown', async () => {
      await service.handleEvent(makeTextEvent('สวัสดี'));
      expect(groups.ensureKnown).not.toHaveBeenCalled();
    });
    it('LINE_FINANCE_BOT_DISABLED=true → ยังเรียก ensureKnown สำหรับข้อความกลุ่ม (kill switch หยุดเฉพาะการตอบ)', async () => {
      const config = (service as any).configService as { get: jest.Mock };
      config.get.mockImplementation((k: string) =>
        k === 'LINE_FINANCE_BOT_DISABLED' ? 'true' : undefined,
      );
      const groupTextEvent = {
        ...makeTextEvent('สวัสดี'),
        source: { type: 'group' as const, groupId: 'Cgroup1', userId: 'U1' },
      };
      await service.handleEvent(groupTextEvent as any);
      expect(groups.ensureKnown).toHaveBeenCalledWith('FINANCE', 'Cgroup1');
    });
  });

  /**
   * Task 44 — คำตัดสินเจ้าของ #49: ต่อ OA การเงินแล้วบอทอยู่โหมด "เก็บเข้า inbox ไม่ตอบอัตโนมัติ"
   * (`LINE_FINANCE_BOT_DISABLED=true` — ค่าที่ deploy-gcp.yml ตั้งไว้แล้ว). เดิม flag นี้ทิ้งทุก event ⇒ สลิปของลูกค้าหาย.
   * ทุกข้อความของผู้ใช้เข้า inbox ทางเดียวกับ SHOP (`MessageRouterService.mirrorInbound`) · ไม่ตอบอะไรเลย ยกเว้นเพิ่มเพื่อน
   * (การ์ดต้อนรับ + ยืนยันตัวตนเดิม) และ postback ที่ลูกค้ากดเอง
   */
  describe('โหมดเก็บเข้า inbox ไม่ตอบอัตโนมัติ (LINE_FINANCE_BOT_DISABLED=true)', () => {
    const base = {
      mode: 'active',
      timestamp: Date.now(),
      source: { type: 'user' as const, userId: 'U123' },
      deliveryContext: { isRedelivery: false },
    };
    const messageEvent = (message: Record<string, unknown>) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ({ ...base, type: 'message', webhookEventId: 'evt-m', replyToken: 'rt-m', message }) as any;

    beforeEach(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const config = (service as any).configService as { get: jest.Mock };
      config.get.mockImplementation((k: string) =>
        k === 'LINE_FINANCE_BOT_DISABLED' ? 'true' : undefined,
      );
    });

    /** ไม่มีทางตอบอัตโนมัติใด ๆ ถูกแตะ — AI · การ์ดยืนยันตัวตนต่อข้อความ · อ่านสลิปตอบลูกค้า */
    const expectNoAutoReply = () => {
      expect(lineClient.replyMessage).not.toHaveBeenCalled();
      expect(lineClient.replyText).not.toHaveBeenCalled();
      expect(ai.generateReply).not.toHaveBeenCalled();
      expect(slipProcessing.processSlip).not.toHaveBeenCalled();
      expect(verification.isLinked).not.toHaveBeenCalled();
      expect(handoff.isBotSilenced).not.toHaveBeenCalled();
    };

    it('ข้อความตัวอักษร → เข้า inbox ห้อง LINE_FINANCE (ทางเดียวกับ SHOP) ไม่ตอบ', async () => {
      await service.handleEvent(makeTextEvent('โอนแล้วนะคะ'));

      expect(messageRouter.mirrorInbound).toHaveBeenCalledTimes(1);
      expect(messageRouter.mirrorInbound).toHaveBeenCalledWith({
        externalMessageId: 'msg-1',
        externalUserId: 'U123',
        channel: ChatChannel.LINE_FINANCE,
        type: MessageType.TEXT,
        text: 'โอนแล้วนะคะ',
      });
      expectNoAutoReply();
    });

    it('รูป (สลิป) → ดึงไฟล์จาก LINE เก็บใน storage แล้วเข้า inbox เป็นรูปที่พนักงานเปิดดูได้ · ไม่อ่านสลิปตอบลูกค้า', async () => {
      lineClient.getMessageContent.mockResolvedValue(Buffer.from('jpeg-bytes'));

      await service.handleEvent(
        messageEvent({ id: 'img-9', type: 'image', contentProvider: { type: 'line' } }),
      );

      expect(lineClient.getMessageContent).toHaveBeenCalledWith('img-9');
      // key ใต้ staff-chat/ — ปุ่ม GFIN ของ inbox อ่านไฟล์จาก storage ได้เฉพาะ prefix นี้
      expect(storage.upload).toHaveBeenCalledWith(
        'staff-chat/line-finance/img-9.jpg',
        Buffer.from('jpeg-bytes'),
        'image/jpeg',
      );
      expect(messageRouter.mirrorInbound).toHaveBeenCalledWith({
        externalMessageId: 'img-9',
        externalUserId: 'U123',
        channel: ChatChannel.LINE_FINANCE,
        type: MessageType.IMAGE,
        mediaUrl: 'staff-chat/line-finance/img-9.jpg',
        mediaType: 'image/jpeg',
      });
      expectNoAutoReply();
    });

    it('ดึงรูปจาก LINE ไม่สำเร็จ → ยังเข้า inbox เป็นรูป (มี message id ให้ปุ่ม GFIN ดึงทีหลัง) ไม่ตอบ', async () => {
      lineClient.getMessageContent.mockRejectedValue(new Error('LINE content API error 404'));

      await service.handleEvent(
        messageEvent({ id: 'img-10', type: 'image', contentProvider: { type: 'line' } }),
      );

      expect(storage.upload).not.toHaveBeenCalled();
      expect(messageRouter.mirrorInbound).toHaveBeenCalledWith({
        externalMessageId: 'img-10',
        externalUserId: 'U123',
        channel: ChatChannel.LINE_FINANCE,
        type: MessageType.IMAGE,
        text: '[image]',
      });
      expectNoAutoReply();
    });

    it('storage ยังไม่ตั้งค่า → ไม่อ้าง key ที่ไม่มีไฟล์จริง (เข้า inbox เป็นรูปแบบไม่มีไฟล์)', async () => {
      storage.configured = false;

      await service.handleEvent(
        messageEvent({ id: 'img-11', type: 'image', contentProvider: { type: 'line' } }),
      );

      expect(storage.upload).not.toHaveBeenCalled();
      expect(messageRouter.mirrorInbound).toHaveBeenCalledWith(
        expect.objectContaining({ type: MessageType.IMAGE, text: '[image]' }),
      );
      expect(messageRouter.mirrorInbound.mock.calls[0][0]).not.toHaveProperty('mediaUrl');
    });

    it('สติกเกอร์ → token ที่ inbox วาดเป็นรูปสติกเกอร์ · ไฟล์ → FILE พร้อม message id · อื่น ๆ → ป้ายชนิด · ไม่ตอบทุกชนิด', async () => {
      await service.handleEvent(
        messageEvent({ id: 'st-1', type: 'sticker', packageId: '11537', stickerId: '52002734' }),
      );
      await service.handleEvent(
        messageEvent({ id: 'f-1', type: 'file', fileName: 'slip.pdf', fileSize: 1200 }),
      );
      await service.handleEvent(
        messageEvent({
          id: 'v-1',
          type: 'video',
          duration: 3000,
          contentProvider: { type: 'line' },
        }),
      );

      expect(messageRouter.mirrorInbound.mock.calls.map((c: unknown[]) => c[0])).toEqual([
        {
          externalMessageId: 'st-1',
          externalUserId: 'U123',
          channel: ChatChannel.LINE_FINANCE,
          type: MessageType.TEXT,
          text: formatStickerToken('11537', '52002734'),
        },
        {
          externalMessageId: 'f-1',
          externalUserId: 'U123',
          channel: ChatChannel.LINE_FINANCE,
          type: MessageType.FILE,
          text: '[file]',
        },
        {
          externalMessageId: 'v-1',
          externalUserId: 'U123',
          channel: ChatChannel.LINE_FINANCE,
          type: MessageType.TEXT,
          text: '[video]',
        },
      ]);
      expectNoAutoReply();
    });

    it('เพิ่มเพื่อน → ยังได้ข้อความต้อนรับ + การ์ดยืนยันตัวตนเดิม (ทางเดียวที่บอทตอบเอง)', async () => {
      await service.handleEvent({
        ...base,
        type: 'follow',
        webhookEventId: 'evt-f',
        replyToken: 'rt-f',
      });

      expect(lineClient.replyMessage).toHaveBeenCalledTimes(1);
      expect(lineClient.replyMessage).toHaveBeenCalledWith('rt-f', [
        { type: 'text', text: 'สวัสดีค่ะ น้องเบสยินดีให้บริการนะคะ 😊' },
        expect.objectContaining({
          type: 'flex',
          altText: 'รบกวนยืนยันตัวตนก่อนนะคะ เพื่อความปลอดภัยของข้อมูลค่ะ 🔐',
        }),
      ]);
      expect(messageRouter.mirrorInbound).not.toHaveBeenCalled();
      expect(ai.generateReply).not.toHaveBeenCalled();
    });

    it('postback ที่ลูกค้ากดเอง (ปุ่มแม่แบบที่พนักงานส่ง) → ยังทำงาน', async () => {
      prisma.chatRoom.findUnique.mockResolvedValue({ id: 'room-1' });
      postbackRouter.route.mockResolvedValue({ handled: true, action: 'send-template' });

      await service.handleEvent({
        ...base,
        type: 'postback',
        webhookEventId: 'evt-p',
        replyToken: 'rt-p',
        postback: { data: 'TEMPLATE:tpl-1' },
      });

      expect(postbackRouter.route).toHaveBeenCalledWith('room-1', 'TEMPLATE:tpl-1');
    });

    it('ข้อความจากกลุ่ม → ไม่เข้า inbox ไม่ตอบ (จดสมาชิกภาพกลุ่มอย่างเดียวตามเดิม)', async () => {
      await service.handleEvent({
        ...makeTextEvent('สวัสดีกลุ่ม'),
        source: { type: 'group' as const, groupId: 'Cgroup1', userId: 'U1' },
      });

      expect(groups.ensureKnown).toHaveBeenCalledWith('FINANCE', 'Cgroup1');
      expect(messageRouter.mirrorInbound).not.toHaveBeenCalled();
      expect(lineClient.replyMessage).not.toHaveBeenCalled();
    });

    it('เลิกเป็นเพื่อน → ไม่ทำอะไร', async () => {
      await service.handleEvent({ ...base, type: 'unfollow', webhookEventId: 'evt-u' });

      expect(messageRouter.mirrorInbound).not.toHaveBeenCalled();
      expect(lineClient.replyMessage).not.toHaveBeenCalled();
    });

    it('เข้า inbox ไม่สำเร็จ → error ออกไปให้ controller จด Sentry (ห้ามกลืนเงียบ — ข้อความหายต้องมีร่องรอย)', async () => {
      messageRouter.mirrorInbound.mockRejectedValue(new Error('db down'));

      await expect(service.handleEvent(makeTextEvent('โอนแล้ว'))).rejects.toThrow('db down');
      expect(lineClient.replyMessage).not.toHaveBeenCalled();
    });
  });

  describe('บอทเปิดเต็ม (flag ไม่ใช่ true) — ไม่ใช้ทาง inbox-only', () => {
    it('ข้อความ → ทางเดิม (AI ตอบ) ไม่เรียก mirrorInbound', async () => {
      await service.handleEvent(makeTextEvent('ยอดเท่าไหร่'));
      expect(ai.generateReply).toHaveBeenCalled();
      expect(messageRouter.mirrorInbound).not.toHaveBeenCalled();
    });
  });
});
