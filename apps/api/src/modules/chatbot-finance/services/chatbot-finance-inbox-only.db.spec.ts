/**
 * รัน: DATABASE_URL=<ฐานทดสอบ> npx jest src/modules/chatbot-finance/services/chatbot-finance-inbox-only.db.spec.ts --runInBand
 * ไม่ต้องตั้ง PII env (ไม่สร้างลูกค้า) · ฐานที่ migrate อย่างเดียวไม่ seed (แบบ CI) ก็รันได้ · ลบแถวของตัวเองทิ้งท้ายไฟล์
 *
 * Task 44 — คำตัดสินเจ้าของ #49: OA การเงินโหมด "เก็บเข้า inbox ไม่ตอบอัตโนมัติ" (`LINE_FINANCE_BOT_DISABLED=true`).
 * ต่อสายจริงตั้งแต่ controller (กันซ้ำด้วย `processed_webhook_events`) → ChatbotFinanceService → MessageRouterService.mirrorInbound
 * → RoomManagerService → Postgres · ปลอมเฉพาะ LINE API (โปรไฟล์/ไฟล์รูป/ตอบกลับ) และ storage · ทางตอบอัตโนมัติทุกทาง
 * (AI / ยืนยันตัวตนต่อข้อความ / อ่านสลิป / handoff) เป็นตัวที่ throw ถ้าถูกเรียก
 */
import { ChatChannel, MessageRole, MessageType, PrismaClient } from '@prisma/client';
import { ChatbotFinanceController } from '../chatbot-finance.controller';
import { ChatbotFinanceService } from './chatbot-finance.service';
import { ChatRoomService } from './chat-room.service';
import { WebhookDedupService } from './webhook-dedup.service';
import { RoomManagerService } from '../../chat-engine/services/room-manager.service';
import { HandoffManagerService } from '../../chat-engine/services/handoff-manager.service';
import { MessageRouterService } from '../../chat-engine/services/message-router.service';
import { LineFinanceWebhookEvent } from '../dto/line-webhook.dto';

jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn(), captureMessage: jest.fn() }));

const prisma = new PrismaClient();
const tag = `t44-${Date.now()}`;
const digits = String(Date.now());
const user = (name: string) => `U${tag}-${name}`;
const eventId = (n: string) => `${tag}-${n}`;
const msgId = (n: string) => `${digits}${n}`;

const mustNotRun = (what: string) =>
  jest.fn(() => {
    throw new Error(`${what} ต้องไม่ถูกเรียกในโหมดเก็บเข้า inbox`);
  });

const lineClient = {
  getUserProfile: jest.fn().mockResolvedValue({ displayName: 'ลูกค้าเก่า', pictureUrl: undefined }),
  getMessageContent: jest.fn().mockResolvedValue(Buffer.from('jpeg-bytes')),
  replyMessage: jest.fn().mockResolvedValue(undefined),
  replyText: mustNotRun('replyText'),
  pushMessage: mustNotRun('pushMessage'),
};
const storage = { configured: true, upload: jest.fn(async (key: string) => key) };
const ai = { generateReply: mustNotRun('AI') };
const verification = { isLinked: mustNotRun('verification.isLinked') };
const handoff = { isBotSilenced: mustNotRun('handoff') };
const slipProcessing = { processSlip: mustNotRun('อ่านสลิป') };
const groups = { onJoin: jest.fn(), onLeave: jest.fn(), ensureKnown: jest.fn() };
const config = { get: (k: string) => (k === 'LINE_FINANCE_BOT_DISABLED' ? 'true' : undefined) };

let controller: ChatbotFinanceController;

beforeAll(async () => {
  const dbName = new URL(process.env.DATABASE_URL ?? 'postgresql://unset/unset').pathname.slice(1);
  if (!/^test_db$|_test$/.test(dbName))
    throw new Error(`สเปคนี้ลบแถวจริง — ต้องรันกับฐานทดสอบ แต่ได้ "${dbName}"`);

  const roomManager = new RoomManagerService(prisma as never, storage as never);
  const messageRouter = new MessageRouterService(
    roomManager,
    new HandoffManagerService(prisma as never),
    config as never,
  );
  // adapter LINE_FINANCE ตัวจริงลงทะเบียนที่ ChatAdaptersModule.onModuleInit — ที่นี่ใช้ตัวปลอมที่ดึงโปรไฟล์อย่างเดียว
  messageRouter.registerAdapter({
    channel: ChatChannel.LINE_FINANCE,
    sendMessage: mustNotRun('adapter.sendMessage'),
    sendTypingIndicator: jest.fn(),
    getUserProfile: async () => ({ displayName: 'ลูกค้าเก่า' }),
  } as never);
  const service = new ChatbotFinanceService(
    prisma as never,
    lineClient as never,
    new ChatRoomService(prisma as never, lineClient as never),
    verification as never,
    ai as never,
    handoff as never,
    slipProcessing as never,
    { saveFeedback: jest.fn() } as never,
    config as never,
    { route: jest.fn().mockResolvedValue({ handled: false }) } as never,
    groups as never,
    messageRouter,
    storage as never,
  );
  controller = new ChatbotFinanceController(
    service,
    lineClient as never,
    {} as never,
    new WebhookDedupService(prisma as never),
  );
});

afterAll(async () => {
  const rooms = await prisma.chatRoom.findMany({
    where: { lineUserId: { startsWith: `U${tag}` } },
    select: { id: true },
  });
  const roomIds = rooms.map((r) => r.id);
  await prisma.chatMessage.deleteMany({ where: { roomId: { in: roomIds } } });
  await prisma.chatRoom.deleteMany({ where: { id: { in: roomIds } } });
  await prisma.processedWebhookEvent.deleteMany({ where: { eventId: { startsWith: tag } } });
  await prisma.$disconnect();
});

beforeEach(() => jest.clearAllMocks());

const base = (userId: string, id: string, isRedelivery = false) => ({
  mode: 'active',
  timestamp: Date.now(),
  source: { type: 'user' as const, userId },
  webhookEventId: eventId(id),
  deliveryContext: { isRedelivery },
});
const text = (userId: string, id: string, mid: string, body: string, isRedelivery = false) =>
  ({
    ...base(userId, id, isRedelivery),
    type: 'message',
    replyToken: `rt-${id}`,
    message: { id: msgId(mid), type: 'text', text: body },
  }) as LineFinanceWebhookEvent;
const image = (userId: string, id: string, mid: string, isRedelivery = false) =>
  ({
    ...base(userId, id, isRedelivery),
    type: 'message',
    replyToken: `rt-${id}`,
    message: { id: msgId(mid), type: 'image', contentProvider: { type: 'line' } },
  }) as LineFinanceWebhookEvent;
const send = (...events: LineFinanceWebhookEvent[]) =>
  controller.webhook({ destination: 'Ubot', events });

const roomOf = (lineUserId: string) =>
  prisma.chatRoom.findUnique({
    where: { lineUserId_channel: { lineUserId, channel: ChatChannel.LINE_FINANCE } },
  });
const messagesOf = async (lineUserId: string) => {
  const room = await roomOf(lineUserId);
  if (!room) return [];
  return prisma.chatMessage.findMany({
    where: { roomId: room.id },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: {
      role: true,
      type: true,
      text: true,
      mediaUrl: true,
      mediaType: true,
      externalMessageId: true,
    },
  });
};

describe('บอทการเงินโหมดเก็บเข้า inbox บน Postgres จริง (Task 44)', () => {
  it('ข้อความ + รูปสลิป → ห้อง LINE_FINANCE ใน inbox สองข้อความของลูกค้า (รอตอบ · ยังไม่อ่าน) · ไม่ตอบอะไรเลย', async () => {
    const u = user('a');

    await expect(
      send(text(u, 'a1', '01', 'โอนค่างวดแล้วค่ะ'), image(u, 'a2', '02')),
    ).resolves.toEqual({
      ok: true,
    });

    const room = await roomOf(u);
    expect(room).toEqual(
      expect.objectContaining({ displayName: 'ลูกค้าเก่า', unreadCount: 2, status: 'ACTIVE' }),
    );
    expect(room!.waitingSince).toBeInstanceOf(Date);
    expect(room!.lastCustomerAt).toBeInstanceOf(Date);
    expect(await messagesOf(u)).toEqual([
      {
        role: MessageRole.CUSTOMER,
        type: MessageType.TEXT,
        text: 'โอนค่างวดแล้วค่ะ',
        mediaUrl: null,
        mediaType: null,
        externalMessageId: msgId('01'),
      },
      {
        role: MessageRole.CUSTOMER,
        type: MessageType.IMAGE,
        text: null,
        mediaUrl: `staff-chat/line-finance/${msgId('02')}.jpg`,
        mediaType: 'image/jpeg',
        externalMessageId: msgId('02'),
      },
    ]);
    expect(storage.upload).toHaveBeenCalledWith(
      `staff-chat/line-finance/${msgId('02')}.jpg`,
      Buffer.from('jpeg-bytes'),
      'image/jpeg',
    );
    expect(lineClient.replyMessage).not.toHaveBeenCalled();
    expect(
      await prisma.processedWebhookEvent.count({
        where: { eventId: { in: [eventId('a1'), eventId('a2')] } },
      }),
    ).toBe(2);
  });

  it('LINE ส่งซ้ำ → ไม่มีข้อความซ้ำ · event ที่รอบแรกไม่เคยถึง (ส่งซ้ำครั้งแรก) → เก็บครั้งเดียว', async () => {
    const u = user('b');
    await send(text(u, 'b1', '11', 'สลิปค่ะ'), image(u, 'b2', '12'));

    await send(text(u, 'b1', '11', 'สลิปค่ะ', true), image(u, 'b2', '12', true)); // redelivery ของที่เก็บแล้ว
    await send(text(u, 'b1', '11', 'สลิปค่ะ')); // ซ้ำแบบไม่ติดป้าย redelivery
    expect(await messagesOf(u)).toHaveLength(2);

    await send(text(u, 'b3', '13', 'ส่งอีกรอบนะคะ', true)); // รอบแรกไม่ถึงเซิร์ฟเวอร์ — มาถึงเป็น redelivery
    await send(text(u, 'b3', '13', 'ส่งอีกรอบนะคะ', true));
    const msgs = await messagesOf(u);
    expect(msgs).toHaveLength(3);
    expect(msgs[2]).toEqual(
      expect.objectContaining({ text: 'ส่งอีกรอบนะคะ', externalMessageId: msgId('13') }),
    );
    expect((await roomOf(u))!.unreadCount).toBe(3);
    expect(lineClient.replyMessage).not.toHaveBeenCalled();
  });

  it('เพิ่มเพื่อน → ตอบครั้งเดียว: ข้อความต้อนรับ + การ์ดยืนยันตัวตน · ข้อความถัดมาเข้าห้องเดียวกัน ไม่ตอบ', async () => {
    const u = user('c');

    await send({
      ...base(u, 'c1'),
      type: 'follow',
      replyToken: 'rt-follow',
    } as LineFinanceWebhookEvent);
    await send(text(u, 'c2', '21', 'สวัสดีค่ะ ลูกค้าเก่าค่ะ'));

    expect(lineClient.replyMessage).toHaveBeenCalledTimes(1);
    expect(lineClient.replyMessage).toHaveBeenCalledWith('rt-follow', [
      { type: 'text', text: 'สวัสดีค่ะ น้องเบสยินดีให้บริการนะคะ 😊' },
      expect.objectContaining({ type: 'flex', altText: expect.stringContaining('ยืนยันตัวตน') }),
    ]);
    expect(
      await prisma.chatRoom.count({ where: { lineUserId: u, channel: ChatChannel.LINE_FINANCE } }),
    ).toBe(1);
    expect((await messagesOf(u)).map((m) => [m.role, m.text])).toEqual([
      [MessageRole.SYSTEM, '[follow event]'],
      [MessageRole.BOT, 'สวัสดีค่ะ น้องเบสยินดีให้บริการนะคะ 😊'],
      [MessageRole.BOT, '[flex:verify]'],
      [MessageRole.CUSTOMER, 'สวัสดีค่ะ ลูกค้าเก่าค่ะ'],
    ]);
  });

  it('ห้องที่พนักงานปิดงานแล้ว → ลูกค้าส่งสลิปใหม่ ห้องเปิดกลับมาเอง (เหมือน SHOP)', async () => {
    const u = user('d');
    await send(text(u, 'd1', '31', 'งวดที่แล้วค่ะ'));
    const room = await roomOf(u);
    await prisma.chatRoom.update({
      where: { id: room!.id },
      data: { status: 'IDLE', resolvedAt: new Date(), waitingSince: null, unreadCount: 0 },
    });

    await send(image(u, 'd2', '32'));

    const reopened = await roomOf(u);
    expect(reopened).toEqual(
      expect.objectContaining({ status: 'ACTIVE', resolvedAt: null, unreadCount: 1 }),
    );
    expect(reopened!.waitingSince).toBeInstanceOf(Date);
  });
});
