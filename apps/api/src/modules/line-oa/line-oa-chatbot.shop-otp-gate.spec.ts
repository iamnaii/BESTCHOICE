import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { LineOaChatbotController } from './line-oa-chatbot.controller';
import { LineOaService } from './line-oa.service';
import { ChatbotService } from './chatbot.service';
import { QuickReplyService } from './quick-reply.service';
import { RichMenuService } from './rich-menu/rich-menu.service';
import { PrismaService } from '../../prisma/prisma.service';
import { PromptPayQrService } from './promptpay/promptpay-qr.service';
import { PaymentLinkService } from './payment-links/payment-link.service';
import { StorageService } from '../storage/storage.service';
import { WebhookDedupService } from '../chatbot-finance/services/webhook-dedup.service';
import { MessageRouterService } from '../chat-engine/services/message-router.service';
import { QuickReplyPostbackRouterService } from '../staff-chat/services/quick-reply-postback-router.service';
import { AiAutoReplyService } from '../staff-chat/services/ai-auto-reply.service';
import { IntegrationConfigService } from '../integrations/integration-config.service';
import { WebhookAnomalyService } from '../webhook-security/webhook-anomaly.service';

jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn(), captureMessage: jest.fn() }));

/**
 * Task 20 C1 — บอท OA ร้าน (SHOP) เคยผูก `customers.line_id_shop` ด้วยเบอร์อย่างเดียว (ไม่มี OTP) แล้วตอบ
 * ชื่อเต็ม + ยอดค้าง/ตารางงวด/QR ชำระ/ประวัติชำระของเจ้าของเบอร์. หลังแก้: พิมพ์เบอร์ไม่ผูกอะไร และคำสั่งที่อ่าน
 * ชื่อ/สัญญา/เงิน ตอบเฉพาะ LINE ที่มีแถว customer_line_links ช่อง FINANCE ที่ยังผูกอยู่ (เขียนได้ทางเดียวคือ
 * ยืนยัน OTP) — ไม่ใช่ line_id_shop.
 *
 * ใช้ LineOaService ตัวจริง (LineCustomerLinkService จริง) บน Prisma mock ที่จำลองข้อมูล ⇒ เห็นการเขียน
 * line_id_shop และข้อมูลที่หลุดในข้อความตอบจริง
 */
const ATTACKER = 'U_attacker_shop';
const OWNER = 'U_owner_verified';
const VICTIM_PHONE = '0812345678';
const CONTRACT_NO = 'BC-2026-0001';
/** ลิงก์ LINE Login → /liff/finance-verify (หน้า OTP) ที่บอทใส่ในข้อความ */
const VERIFY_LINK = `returnPath=${encodeURIComponent('/liff/finance-verify')}`;

type World = {
  victim: {
    id: string;
    name: string;
    phone: string;
    deletedAt: null;
    lineIdShop: string | null;
  };
  financeLinks: Array<{ lineUserId: string; customerId: string; unlinkedAt: Date | null }>;
  writes: unknown[];
};

function makePrisma(world: World) {
  const contracts = () => [
    {
      id: 'k1',
      contractNumber: CONTRACT_NO,
      status: 'ACTIVE',
      branch: { name: 'สาขาลาดพร้าว', phone: '021234567', location: 'ลาดพร้าว' },
      payments: [
        {
          installmentNo: 1,
          status: 'PAID',
          dueDate: new Date('2026-10-05'),
          amountDue: '3671.00',
          lateFee: '0',
          amountPaid: '3671.00',
          paidDate: new Date('2026-10-05'),
        },
        {
          installmentNo: 2,
          status: 'PENDING',
          dueDate: new Date('2026-11-05'),
          amountDue: '3671.00',
          lateFee: '0',
          amountPaid: '0',
          paidDate: null,
        },
      ],
    },
  ];
  const victimFull = () => ({ ...world.victim, contracts: contracts() });
  return {
    customer: {
      findFirst: jest.fn(async ({ where }: { where: Record<string, unknown> }) => {
        if ('lineIdShop' in where && where.lineIdShop !== null) {
          return world.victim.lineIdShop === where.lineIdShop ? victimFull() : null;
        }
        if ('phone' in where) {
          return where.phone === world.victim.phone && world.victim.lineIdShop === null
            ? world.victim
            : null;
        }
        if ('id' in where) return where.id === world.victim.id ? victimFull() : null;
        return null;
      }),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        world.writes.push(data);
        Object.assign(world.victim, data);
        return world.victim;
      }),
      updateMany: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        world.writes.push(data);
        return { count: 0 };
      }),
    },
    customerLineLink: {
      findFirst: jest.fn(async ({ where }: { where: Record<string, unknown> }) => {
        const link = world.financeLinks.find(
          (l) =>
            l.lineUserId === where.lineUserId &&
            where.channel === 'FINANCE' &&
            l.unlinkedAt === null,
        );
        return link ? { customerId: link.customerId } : null;
      }),
    },
    branch: {
      findFirst: jest
        .fn()
        .mockResolvedValue({ name: 'สำนักงานใหญ่', phone: '020000000', location: '-' }),
    },
    chatRoom: { findUnique: jest.fn().mockResolvedValue(null) },
    paymentEvidence: { create: jest.fn().mockResolvedValue({ id: 'ev-1' }) },
    notificationLog: { create: jest.fn().mockResolvedValue({}) },
    systemConfig: {
      findUnique: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockResolvedValue({}),
    },
  };
}

describe('SHOP OA bot answers name/contract/money only to OTP-verified LINE users (Task 20 C1)', () => {
  let controller: LineOaChatbotController;
  let lineOa: LineOaService;
  let world: World;
  let prisma: ReturnType<typeof makePrisma>;
  let reply: jest.SpyInstance;
  let chatbot: { generateResponse: jest.Mock };

  beforeEach(async () => {
    world = {
      victim: {
        id: 'c-victim',
        name: 'สมชาย ใจดี',
        phone: VICTIM_PHONE,
        deletedAt: null,
        lineIdShop: null,
      },
      financeLinks: [{ lineUserId: OWNER, customerId: 'c-victim', unlinkedAt: null }],
      writes: [],
    };
    prisma = makePrisma(world);
    lineOa = new LineOaService(
      { get: jest.fn() } as never,
      prisma as never,
      {} as never,
      { getValue: jest.fn().mockResolvedValue(null) } as never,
    );
    reply = jest.spyOn(lineOa, 'replyMessage').mockResolvedValue(undefined);
    jest.spyOn(lineOa, 'linkLineId').mockResolvedValue(undefined);
    jest.spyOn(lineOa, 'downloadContent').mockResolvedValue(Buffer.from('img'));
    chatbot = { generateResponse: jest.fn().mockResolvedValue('สวัสดีค่ะ') };

    const mod: TestingModule = await Test.createTestingModule({
      controllers: [LineOaChatbotController],
      providers: [
        { provide: LineOaService, useValue: lineOa },
        { provide: ChatbotService, useValue: chatbot },
        {
          provide: QuickReplyService,
          useValue: { verifiedReturn: () => [], shopOnboarding: () => [] },
        },
        { provide: RichMenuService, useValue: { switchRichMenu: jest.fn() } },
        { provide: PrismaService, useValue: prisma },
        {
          provide: PromptPayQrService,
          useValue: {
            generateQrDataUrl: jest.fn().mockResolvedValue('data:image/png;base64,AA'),
            getAccountName: () => 'บจก. เบสท์ช้อยส์',
            getMaskedPromptPayId: () => 'xxx-x-x1234',
          },
        },
        {
          provide: PaymentLinkService,
          useValue: { createPaymentLink: jest.fn().mockResolvedValue({ url: 'https://pay/x' }) },
        },
        { provide: StorageService, useValue: { upload: jest.fn().mockResolvedValue(undefined) } },
        { provide: WebhookDedupService, useValue: {} },
        {
          provide: MessageRouterService,
          useValue: { mirrorInbound: jest.fn(), routeInbound: jest.fn() },
        },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        { provide: QuickReplyPostbackRouterService, useValue: { route: jest.fn() } },
        { provide: AiAutoReplyService, useValue: { getSettings: jest.fn() } },
        { provide: IntegrationConfigService, useValue: {} },
        { provide: WebhookAnomalyService, useValue: {} },
      ],
    }).compile();
    controller = mod.get(LineOaChatbotController);
  });

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const text = (t: string, userId: string) =>
    (controller as any).handleTextMessage({
      type: 'message',
      replyToken: `rt-${t}`,
      source: { type: 'user', userId },
      message: { id: `m-${t}`, type: 'text', text: t },
    });
  const image = (userId: string) =>
    (controller as any).handleImageMessage({
      type: 'message',
      replyToken: 'rt-img',
      source: { type: 'user', userId },
      message: { id: 'm-img', type: 'image' },
    });
  const postback = (data: string, userId: string) =>
    (controller as any).handlePostback({
      type: 'postback',
      replyToken: 'rt-pb',
      source: { type: 'user', userId },
      postback: { data },
    });
  const follow = (userId: string) =>
    (controller as any).handleFollow({
      type: 'follow',
      replyToken: 'rt-follow',
      source: { type: 'user', userId },
    });
  /* eslint-enable @typescript-eslint/no-explicit-any */
  const replies = () => JSON.stringify(reply.mock.calls.map((c) => c[1]));

  it('typing the victim phone links nothing and reveals no name — reply points to OTP verification', async () => {
    await text(VICTIM_PHONE, ATTACKER);

    expect(world.writes).toEqual([]);
    expect(world.victim.lineIdShop).toBeNull();
    expect(replies()).not.toContain('สมชาย');
    expect(replies()).toContain(VERIFY_LINK);
  });

  it('typing an unknown phone gets the same reply as a customer phone (no phone oracle)', async () => {
    await text(VICTIM_PHONE, ATTACKER);
    const forKnown = reply.mock.calls[0][1];
    reply.mockClear();
    await text('0899999999', ATTACKER);
    expect(reply.mock.calls[0][1]).toEqual(forKnown);
  });

  it.each(['เช็คยอด', 'งวด', 'ชำระ', 'ใบเสร็จ', 'สัญญา', 'ลงทะเบียน', 'ติดต่อ'])(
    'unverified LINE whose line_id_shop points at the victim gets no data for "%s"',
    async (cmd) => {
      // สภาพเดิมบน DB ที่รูเก่าทิ้งไว้: line_id_shop ของเหยื่อ = LINE ผู้โจมตี (ผูกด้วยเบอร์อย่างเดียว)
      world.victim.lineIdShop = ATTACKER;

      await text(cmd, ATTACKER);

      const out = replies();
      expect(out).not.toContain('สมชาย');
      expect(out).not.toContain(CONTRACT_NO);
      expect(out).not.toMatch(/3,?671/);
      expect(out).not.toContain('ลาดพร้าว');
    },
  );

  it.each(['เช็คยอด', 'งวด', 'ชำระ', 'ใบเสร็จ', 'สัญญา'])(
    'unverified LINE asking "%s" is pointed to OTP verification',
    async (cmd) => {
      await text(cmd, ATTACKER);
      expect(replies()).toContain(VERIFY_LINK);
    },
  );

  it.each(['action=check_balance', 'action=check_installments', 'action=pay'])(
    'postback %s from an unverified LINE reveals nothing',
    async (data) => {
      world.victim.lineIdShop = ATTACKER;
      await postback(`${data}&contract=${CONTRACT_NO}`, ATTACKER);
      expect(replies()).not.toContain('สมชาย');
      expect(replies()).not.toMatch(/3,?671/);
    },
  );

  it('slip image from an unverified LINE is not filed against the victim contract', async () => {
    world.victim.lineIdShop = ATTACKER;
    await image(ATTACKER);
    expect(prisma.paymentEvidence.create).not.toHaveBeenCalled();
    expect(replies()).not.toContain('สมชาย');
    expect(replies()).toContain(VERIFY_LINK);
  });

  it('re-follow of an unverified LINE does not greet with the victim name', async () => {
    world.victim.lineIdShop = ATTACKER;
    await follow(ATTACKER);
    expect(replies()).not.toContain('สมชาย');
  });

  it('freeform AI context is looked up for the verified customer only', async () => {
    world.victim.lineIdShop = ATTACKER;
    await text('ยอดค้างเท่าไหร่คะ', ATTACKER);
    // ChatbotService ดึงบริบทเอง — controller ส่งแค่ userId; การกันข้อมูลอยู่ใน chatbot.service.spec
    expect(chatbot.generateResponse).toHaveBeenCalledWith('ยอดค้างเท่าไหร่คะ', ATTACKER);
  });

  it('OTP-verified LINE (FINANCE link row) gets its own balance even with no line_id_shop', async () => {
    await text('เช็คยอด', OWNER);

    expect(replies()).toContain(CONTRACT_NO);
    expect(world.writes).toEqual([]);
  });

  it('OTP-verified LINE gets installments, receipts and the payment QR', async () => {
    await text('งวด', OWNER);
    await text('ใบเสร็จ', OWNER);
    await text('ชำระ', OWNER);
    const out = replies();
    expect(out).toContain(CONTRACT_NO);
    expect(out).toMatch(/3,?671/);
  });

  it('OTP-verified LINE typing a phone number is not answered with a link prompt (falls through)', async () => {
    await text(VICTIM_PHONE, OWNER);
    expect(replies()).not.toContain(VERIFY_LINK);
    expect(chatbot.generateResponse).toHaveBeenCalled();
    expect(world.writes).toEqual([]);
  });

  it('unlinked FINANCE row (customer unlinked in LIFF) no longer counts as verified', async () => {
    world.financeLinks[0].unlinkedAt = new Date();
    await text('เช็คยอด', OWNER);
    expect(replies()).not.toContain(CONTRACT_NO);
    expect(replies()).toContain(VERIFY_LINK);
  });
});
