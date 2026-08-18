import { Test, TestingModule } from '@nestjs/testing';
import * as Sentry from '@sentry/nestjs';
import { InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'crypto';
import { ChatChannel, MessageRole } from '@prisma/client';
import { FacebookWebhookController } from './facebook-webhook.controller';
import { MessageRouterService } from '../chat-engine/services/message-router.service';
import { WebhookAnomalyService } from '../webhook-security/webhook-anomaly.service';
import { QuickReplyPostbackRouterService } from '../staff-chat/services/quick-reply-postback-router.service';
import { PrismaService } from '../../prisma/prisma.service';
import { IntegrationConfigService } from '../integrations/integration-config.service';

/**
 * Mock IntegrationConfigService.getConfig('facebook') — the controller now
 * reads appSecret + verifyToken from here (DB → env fallback) instead of env.
 */
function fbConfigMock(appSecret = 'secret', verifyToken = 'verify-token') {
  return {
    getConfig: jest.fn().mockResolvedValue({ appSecret, verifyToken }),
  };
}

jest.mock('@sentry/nestjs', () => ({
  captureException: jest.fn(),
  captureMessage: jest.fn(),
}));

function signedRequest(
  secret: string,
  body: unknown,
): {
  rawBody: Buffer;
  signature: string;
  req: import('express').Request;
} {
  const rawBody = Buffer.from(JSON.stringify(body), 'utf-8');
  const signature = 'sha256=' + createHmac('sha256', secret).update(rawBody).digest('hex');
  const req = {
    ip: '31.13.64.1',
    headers: { 'user-agent': 'facebookexternalua/1.0' },
    rawBody,
  } as unknown as import('express').Request;
  return { rawBody, signature, req };
}

describe('FacebookWebhookController.handleWebhook — rawBody SLO alert (T6-C14)', () => {
  let controller: FacebookWebhookController;
  let anomaly: { record: jest.Mock };

  beforeEach(async () => {
    const router = { routeInbound: jest.fn() };
    anomaly = { record: jest.fn().mockResolvedValue(undefined) };
    const config = {
      get: jest.fn((key: string) => {
        if (key === 'FB_APP_SECRET') return 'secret';
        if (key === 'FB_VERIFY_TOKEN') return 'verify-token';
        return undefined;
      }),
    };
    const postbackRouter = { route: jest.fn().mockResolvedValue({ handled: false }) };
    const prisma = { chatRoom: { findFirst: jest.fn().mockResolvedValue(null) } };

    const mod: TestingModule = await Test.createTestingModule({
      controllers: [FacebookWebhookController],
      providers: [
        { provide: MessageRouterService, useValue: router },
        { provide: ConfigService, useValue: config },
        { provide: WebhookAnomalyService, useValue: anomaly },
        { provide: QuickReplyPostbackRouterService, useValue: postbackRouter },
        { provide: PrismaService, useValue: prisma },
        { provide: IntegrationConfigService, useValue: fbConfigMock() },
      ],
    }).compile();

    controller = mod.get(FacebookWebhookController);
    (Sentry.captureMessage as jest.Mock).mockClear();
  });

  it('captures Sentry message + writes anomaly + throws 500 when rawBody is missing', async () => {
    const req = {
      ip: '31.13.64.1',
      headers: { 'user-agent': 'facebookexternalua/1.0' },
      // rawBody intentionally undefined — simulates middleware ordering bug
    } as unknown as import('express').Request;

    await expect(
      controller.handleWebhook(req, { object: 'page', entry: [] }, 'sha256=deadbeef'),
    ).rejects.toBeInstanceOf(InternalServerErrorException);

    expect(Sentry.captureMessage).toHaveBeenCalledWith('Facebook webhook rawBody capture failed', {
      level: 'error',
    });
    expect(anomaly.record).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'facebook',
        reason: 'other',
        ipAddress: '31.13.64.1',
        meta: expect.objectContaining({ note: 'missing_raw_body' }),
      }),
    );
  });
});

describe('FacebookWebhookController.handleWebhook — message_echoes', () => {
  const FB_APP_SECRET = 'secret';
  const OUR_APP_ID = '1234567890';
  const PAGE_ID = 'page_id_xyz';
  const CUSTOMER_PSID = 'psid_customer_999';

  let controller: FacebookWebhookController;
  let router: { routeInbound: jest.Mock; mirrorOutbound: jest.Mock };

  beforeEach(async () => {
    router = {
      routeInbound: jest.fn().mockResolvedValue(undefined),
      mirrorOutbound: jest.fn().mockResolvedValue(undefined),
    };
    const config = {
      get: jest.fn((key: string) => {
        if (key === 'FB_APP_SECRET') return FB_APP_SECRET;
        if (key === 'FB_VERIFY_TOKEN') return 'verify-token';
        if (key === 'FACEBOOK_APP_ID') return OUR_APP_ID;
        return undefined;
      }),
    };
    const anomaly = { record: jest.fn().mockResolvedValue(undefined) };
    // Phase 5 — postback router only fires when chatRoom.findFirst returns a
    // room AND payload matches TEMPLATE:<id>. Existing FB postback specs use
    // legacy payloads (e.g. PERSISTENT_MENU_GET_STARTED) which never match —
    // so a default no-room mock + handled:false stub preserves behavior.
    const prisma = {
      chatRoom: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const postbackRouter = {
      route: jest.fn().mockResolvedValue({ handled: false }),
    };

    const mod: TestingModule = await Test.createTestingModule({
      controllers: [FacebookWebhookController],
      providers: [
        { provide: MessageRouterService, useValue: router },
        { provide: ConfigService, useValue: config },
        { provide: WebhookAnomalyService, useValue: anomaly },
        { provide: QuickReplyPostbackRouterService, useValue: postbackRouter },
        { provide: PrismaService, useValue: prisma },
        { provide: IntegrationConfigService, useValue: fbConfigMock() },
      ],
    }).compile();

    controller = mod.get(FacebookWebhookController);
  });

  function echoPayload(message: Record<string, unknown>) {
    return {
      object: 'page',
      entry: [
        {
          id: PAGE_ID,
          messaging: [
            {
              sender: { id: PAGE_ID },
              recipient: { id: CUSTOMER_PSID },
              timestamp: 1700000000000,
              message,
            },
          ],
        },
      ],
    };
  }

  it('persists external echo (app_id ≠ ours) as STAFF via mirrorOutbound', async () => {
    const body = echoPayload({
      is_echo: true,
      app_id: 99999999, // some other app (e.g. Meta Business Suite)
      mid: 'mid.external.echo.1',
      text: 'สวัสดีครับ ตอบจาก Meta Business Suite',
    });
    const { signature, req } = signedRequest(FB_APP_SECRET, body);

    await controller.handleWebhook(req, body, signature);

    expect(router.mirrorOutbound).toHaveBeenCalledWith({
      externalUserId: CUSTOMER_PSID,
      channel: ChatChannel.FACEBOOK,
      role: MessageRole.STAFF,
      type: 'TEXT',
      text: 'สวัสดีครับ ตอบจาก Meta Business Suite',
      mediaUrl: undefined,
      externalMessageId: 'mid.external.echo.1',
      // echo จากแอปอื่น (ยืนยันได้เพราะ FACEBOOK_APP_ID ตั้งอยู่) = takeover → pause AI
      pauseAi: true,
    });
    expect(router.routeInbound).not.toHaveBeenCalled();
  });

  it('skips echo when message.app_id matches our FACEBOOK_APP_ID (our own send)', async () => {
    const body = echoPayload({
      is_echo: true,
      app_id: Number(OUR_APP_ID),
      mid: 'mid.our.send.1',
      text: 'sent by sendStaffMessage already',
    });
    const { signature, req } = signedRequest(FB_APP_SECRET, body);

    await controller.handleWebhook(req, body, signature);

    expect(router.mirrorOutbound).not.toHaveBeenCalled();
    expect(router.routeInbound).not.toHaveBeenCalled();
  });

  it('still persists echo when FACEBOOK_APP_ID is not configured (relies on externalMessageId dedup)', async () => {
    // Rebuild controller with FACEBOOK_APP_ID unset
    const localRouter = {
      routeInbound: jest.fn().mockResolvedValue(undefined),
      mirrorOutbound: jest.fn().mockResolvedValue(undefined),
    };
    const config = {
      get: jest.fn((key: string) => {
        if (key === 'FB_APP_SECRET') return FB_APP_SECRET;
        if (key === 'FB_VERIFY_TOKEN') return 'verify-token';
        return undefined; // FACEBOOK_APP_ID intentionally missing
      }),
    };
    const anomaly = { record: jest.fn().mockResolvedValue(undefined) };
    const postbackRouter = { route: jest.fn().mockResolvedValue({ handled: false }) };
    const prisma = { chatRoom: { findFirst: jest.fn().mockResolvedValue(null) } };
    const mod = await Test.createTestingModule({
      controllers: [FacebookWebhookController],
      providers: [
        { provide: MessageRouterService, useValue: localRouter },
        { provide: ConfigService, useValue: config },
        { provide: WebhookAnomalyService, useValue: anomaly },
        { provide: QuickReplyPostbackRouterService, useValue: postbackRouter },
        { provide: PrismaService, useValue: prisma },
        { provide: IntegrationConfigService, useValue: fbConfigMock() },
      ],
    }).compile();
    const localController = mod.get(FacebookWebhookController);

    const body = echoPayload({
      is_echo: true,
      app_id: Number(OUR_APP_ID),
      mid: 'mid.unknown.source.1',
      text: 'fallback path',
    });
    const { signature, req } = signedRequest(FB_APP_SECRET, body);

    await localController.handleWebhook(req, body, signature);

    expect(localRouter.mirrorOutbound).toHaveBeenCalledWith(
      expect.objectContaining({
        role: MessageRole.STAFF,
        externalMessageId: 'mid.unknown.source.1',
      }),
    );
  });

  it('parses image echo into IMAGE type with mediaUrl', async () => {
    const body = echoPayload({
      is_echo: true,
      app_id: 99999999,
      mid: 'mid.image.echo.1',
      attachments: [{ type: 'image', payload: { url: 'https://cdn.fb/image.jpg' } }],
    });
    const { signature, req } = signedRequest(FB_APP_SECRET, body);

    await controller.handleWebhook(req, body, signature);

    expect(router.mirrorOutbound).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'IMAGE',
        mediaUrl: 'https://cdn.fb/image.jpg',
        externalMessageId: 'mid.image.echo.1',
      }),
    );
  });

  it('skips echo gracefully when recipient.id is missing', async () => {
    const body = {
      object: 'page',
      entry: [
        {
          id: PAGE_ID,
          messaging: [
            {
              sender: { id: PAGE_ID },
              // recipient intentionally missing
              timestamp: 1700000000000,
              message: { is_echo: true, app_id: 99999999, mid: 'mid.x', text: 'x' },
            },
          ],
        },
      ],
    };
    const { signature, req } = signedRequest(FB_APP_SECRET, body);

    await expect(controller.handleWebhook(req, body, signature)).resolves.toBe('EVENT_RECEIVED');
    expect(router.mirrorOutbound).not.toHaveBeenCalled();
  });

  it('routes regular inbound (non-echo) through routeInbound', async () => {
    const body = {
      object: 'page',
      entry: [
        {
          id: PAGE_ID,
          messaging: [
            {
              sender: { id: CUSTOMER_PSID },
              recipient: { id: PAGE_ID },
              timestamp: 1700000000000,
              message: { mid: 'mid.in.1', text: 'hi from customer' },
            },
          ],
        },
      ],
    };
    const { signature, req } = signedRequest(FB_APP_SECRET, body);

    await controller.handleWebhook(req, body, signature);

    expect(router.routeInbound).toHaveBeenCalledWith(
      expect.objectContaining({
        externalUserId: CUSTOMER_PSID,
        text: 'hi from customer',
        channel: ChatChannel.FACEBOOK,
      }),
    );
    expect(router.mirrorOutbound).not.toHaveBeenCalled();
  });
});

describe('FacebookWebhookController.verifyWebhook — verify token from IntegrationConfig', () => {
  let controller: FacebookWebhookController;
  let integrationConfig: { getConfig: jest.Mock };

  function makeRes() {
    const res = {
      status: jest.fn().mockReturnThis(),
      send: jest.fn().mockReturnThis(),
    };
    return res as unknown as import('express').Response & {
      status: jest.Mock;
      send: jest.Mock;
    };
  }

  beforeEach(async () => {
    integrationConfig = fbConfigMock('secret', 'verify-token');
    const mod: TestingModule = await Test.createTestingModule({
      controllers: [FacebookWebhookController],
      providers: [
        { provide: MessageRouterService, useValue: { routeInbound: jest.fn() } },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        { provide: WebhookAnomalyService, useValue: { record: jest.fn() } },
        { provide: QuickReplyPostbackRouterService, useValue: { route: jest.fn() } },
        { provide: PrismaService, useValue: {} },
        { provide: IntegrationConfigService, useValue: integrationConfig },
      ],
    }).compile();
    controller = mod.get(FacebookWebhookController);
  });

  it('returns the challenge when verify token matches the UI-configured value', async () => {
    const res = makeRes();
    await controller.verifyWebhook('subscribe', 'verify-token', 'CHALLENGE_123', res);
    expect(integrationConfig.getConfig).toHaveBeenCalledWith('facebook');
    expect((res as any).status).toHaveBeenCalledWith(200);
    expect((res as any).send).toHaveBeenCalledWith('CHALLENGE_123');
  });

  it('rejects with 400 when the token does not match', async () => {
    const res = makeRes();
    await controller.verifyWebhook('subscribe', 'wrong-token', 'CHALLENGE_123', res);
    expect((res as any).status).toHaveBeenCalledWith(400);
    expect((res as any).send).not.toHaveBeenCalledWith('CHALLENGE_123');
  });

  it('rejects with 400 when no verify token is configured (fail closed)', async () => {
    integrationConfig.getConfig.mockResolvedValueOnce({ appSecret: 'secret', verifyToken: '' });
    const res = makeRes();
    await controller.verifyWebhook('subscribe', '', 'CHALLENGE_123', res);
    expect((res as any).status).toHaveBeenCalledWith(400);
  });
});

describe('FacebookWebhookController — standalone referral จากลิงก์สินค้า (B4)', () => {
  const FB_APP_SECRET = 'secret';
  const PSID = 'psid_ref_1';
  const PRODUCT_ID = '11111111-2222-3333-4444-555555555555';

  let controller: FacebookWebhookController;
  let router: { routeInbound: jest.Mock; mirrorOutbound: jest.Mock; postSystemNote: jest.Mock };
  let prisma: { chatRoom: { findFirst: jest.Mock }; product: { findFirst: jest.Mock } };

  function referralEvent(ref: string) {
    return {
      object: 'page',
      entry: [
        {
          id: 'page1',
          time: 1,
          messaging: [
            {
              sender: { id: PSID },
              recipient: { id: 'page1' },
              timestamp: 1,
              referral: { ref, source: 'SHORTLINK', type: 'OPEN_THREAD' },
            },
          ],
        },
      ],
    };
  }

  beforeEach(async () => {
    router = {
      routeInbound: jest.fn().mockResolvedValue(undefined),
      mirrorOutbound: jest.fn().mockResolvedValue(undefined),
      postSystemNote: jest.fn().mockResolvedValue(undefined),
    };
    prisma = {
      chatRoom: { findFirst: jest.fn().mockResolvedValue({ id: 'room-1' }) },
      product: {
        findFirst: jest.fn().mockResolvedValue({
          brand: 'Apple',
          model: 'iPhone 15 Pro',
          storage: '256GB',
          color: 'Blue',
          imeiSerial: '111122223333',
        }),
      },
    };
    const mod: TestingModule = await Test.createTestingModule({
      controllers: [FacebookWebhookController],
      providers: [
        { provide: MessageRouterService, useValue: router },
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue(undefined) } },
        { provide: WebhookAnomalyService, useValue: { record: jest.fn() } },
        {
          provide: QuickReplyPostbackRouterService,
          useValue: { route: jest.fn().mockResolvedValue({ handled: false }) },
        },
        { provide: PrismaService, useValue: prisma },
        { provide: IntegrationConfigService, useValue: fbConfigMock(FB_APP_SECRET) },
      ],
    }).compile();
    controller = mod.get(FacebookWebhookController);
  });

  it('โพสต์โน้ตระบบพร้อมชื่อรุ่น + 4 ตัวท้าย IMEI เมื่อ ref เป็น p:<unitId>', async () => {
    const { req, signature } = signedRequest(FB_APP_SECRET, referralEvent(`p:${PRODUCT_ID}`));
    await controller.handleWebhook(req, referralEvent(`p:${PRODUCT_ID}`), signature);

    // ชื่อประกอบจาก brand+model+storage+color ตาม buildReferralNote → มี 'Apple' นำหน้า
    expect(router.postSystemNote).toHaveBeenCalledWith(
      'room-1',
      'ลูกค้ากดมาจากสินค้า Apple iPhone 15 Pro 256GB Blue (3333) บนเว็บ',
    );
    expect(router.routeInbound).not.toHaveBeenCalled();
  });

  it('ใช้ข้อความกลางเมื่อ ref ไม่ใช่รูปแบบสินค้า', async () => {
    const { req, signature } = signedRequest(FB_APP_SECRET, referralEvent('promo-songkran'));
    await controller.handleWebhook(req, referralEvent('promo-songkran'), signature);

    expect(prisma.product.findFirst).not.toHaveBeenCalled();
    expect(router.postSystemNote).toHaveBeenCalledWith(
      'room-1',
      'ลูกค้ากดเข้ามาจากลิงก์เว็บ (ref: promo-songkran)',
    );
  });

  it('ไม่พังเมื่อยังไม่มีห้องของ PSID นี้', async () => {
    prisma.chatRoom.findFirst.mockResolvedValue(null);
    const { req, signature } = signedRequest(FB_APP_SECRET, referralEvent(`p:${PRODUCT_ID}`));
    await expect(
      controller.handleWebhook(req, referralEvent(`p:${PRODUCT_ID}`), signature),
    ).resolves.toBe('EVENT_RECEIVED');
    expect(router.postSystemNote).not.toHaveBeenCalled();
  });

  it('ไม่พังเมื่อ productId ใน ref ไม่มีอยู่จริง', async () => {
    prisma.product.findFirst.mockResolvedValue(null);
    const { req, signature } = signedRequest(FB_APP_SECRET, referralEvent(`p:${PRODUCT_ID}`));
    await controller.handleWebhook(req, referralEvent(`p:${PRODUCT_ID}`), signature);
    expect(router.postSystemNote).toHaveBeenCalledWith(
      'room-1',
      'ลูกค้ากดเข้ามาจากลิงก์สินค้าบนเว็บ (ไม่พบสินค้านี้แล้ว)',
    );
  });

  it('ข้อความปกติที่ไม่มี referral ยังวิ่งเข้า routeInbound เหมือนเดิม', async () => {
    const body = {
      object: 'page',
      entry: [
        {
          id: 'page1',
          time: 1,
          messaging: [
            {
              sender: { id: PSID },
              recipient: { id: 'page1' },
              timestamp: 1,
              message: { mid: 'm1', text: 'สวัสดี' },
            },
          ],
        },
      ],
    };
    const { req, signature } = signedRequest(FB_APP_SECRET, body);
    await controller.handleWebhook(req, body, signature);
    expect(router.routeInbound).toHaveBeenCalledTimes(1);
    expect(router.postSystemNote).not.toHaveBeenCalled();
  });

  // FF-1 (final review): ลูกค้าใหม่ทุกคนกดปุ่ม Get Started — token ดิบห้ามโผล่เป็น
  // บับเบิลลูกค้าในกล่องแชท (และห้ามข้าม routeInbound เพราะโน้ต referral พึ่งห้องที่มันสร้าง)
  it('postback GET_STARTED ถูกแปลงเป็นข้อความอ่านรู้เรื่อง ไม่ใช่ raw token', async () => {
    const body = {
      object: 'page',
      entry: [
        {
          id: 'page1',
          time: 1,
          messaging: [
            {
              sender: { id: PSID },
              recipient: { id: 'page1' },
              timestamp: 1,
              postback: { payload: 'GET_STARTED', title: 'เริ่มต้นใช้งาน' },
              referral: { ref: `p:${PRODUCT_ID}`, source: 'SHORTLINK', type: 'OPEN_THREAD' },
            },
          ],
        },
      ],
    };
    const { req, signature } = signedRequest(FB_APP_SECRET, body);
    await controller.handleWebhook(req, body, signature);
    // fast-ack: referral note ต่อท้าย promise ของ routeInbound — flush microtasks ก่อน assert
    await new Promise((r) => setImmediate(r));

    expect(router.routeInbound).toHaveBeenCalledTimes(1);
    const inbound = router.routeInbound.mock.calls[0][0];
    expect(inbound.text).toBe('ลูกค้ากดเริ่มต้นใช้งาน (Get Started)');
    expect(inbound.text).not.toContain('GET_STARTED_RAW');
    // referral ที่พ่วงมากับ Get Started ยังโพสต์โน้ตตามเดิม
    expect(router.postSystemNote).toHaveBeenCalledWith(
      'room-1',
      'ลูกค้ากดมาจากสินค้า Apple iPhone 15 Pro 256GB Blue (3333) บนเว็บ',
    );
  });
});
