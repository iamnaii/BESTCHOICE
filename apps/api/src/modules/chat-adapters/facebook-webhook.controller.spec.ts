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
import { JourneyEntryWriter } from '../customer-journey/journey-entry-writer.service';

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
  let router: { routeInbound: jest.Mock; mirrorOutbound: jest.Mock; postSystemNote: jest.Mock; recordAdReferral: jest.Mock };
  let prisma: { chatRoom: { findFirst: jest.Mock }; product: { findFirst: jest.Mock } };
  let postbackRouter: { route: jest.Mock };
  let journey: { recordAfterCommit: jest.Mock };

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
      recordAdReferral: jest.fn().mockResolvedValue(undefined),
    };
    postbackRouter = { route: jest.fn().mockResolvedValue({ handled: false }) };
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
    journey = { recordAfterCommit: jest.fn().mockResolvedValue(undefined) };
    const mod: TestingModule = await Test.createTestingModule({
      controllers: [FacebookWebhookController],
      providers: [
        { provide: MessageRouterService, useValue: router },
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue(undefined) } },
        { provide: WebhookAnomalyService, useValue: { record: jest.fn() } },
        { provide: QuickReplyPostbackRouterService, useValue: postbackRouter },
        { provide: PrismaService, useValue: prisma },
        { provide: IntegrationConfigService, useValue: fbConfigMock(FB_APP_SECRET) },
        { provide: JourneyEntryWriter, useValue: journey },
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

  // ── โฆษณา (PR-A) — เอกสาร Meta: ลูกค้าใหม่จากโฆษณา referral อยู่ใน message.referral ──
  const AD_REFERRAL = {
    ad_id: '120246504706250534',
    source: 'ADS',
    type: 'OPEN_THREAD',
    ads_context_data: { ad_title: 'ฝนตกไม่อยากออกจากบ้าน', photo_url: 'https://scontent.example/ad.jpg' },
  };
  function messageWithAdReferral() {
    return {
      object: 'page',
      entry: [{ id: 'page1', time: 1, messaging: [{
        sender: { id: PSID }, recipient: { id: 'page1' }, timestamp: 1,
        message: { mid: 'm-ad-1', text: 'สนใจครับ', referral: AD_REFERRAL },
      }] }],
    };
  }

  it('ลูกค้าใหม่ทักจากโฆษณา (message.referral) → routeInbound ได้ attribution พร้อมชื่อ/รูปโฆษณา', async () => {
    const body = messageWithAdReferral();
    const { req, signature } = signedRequest(FB_APP_SECRET, body);
    await controller.handleWebhook(req, body, signature);
    await new Promise((r) => setImmediate(r));

    expect(router.routeInbound).toHaveBeenCalledWith(
      expect.objectContaining({
        externalUserId: PSID,
        text: 'สนใจครับ',
        attribution: expect.objectContaining({
          utmSource: 'facebook',
          adId: '120246504706250534',
          adTitle: 'ฝนตกไม่อยากออกจากบ้าน',
          adPhotoUrl: 'https://scontent.example/ad.jpg',
          utmContent: undefined,
        }),
      }),
    );
    // ไม่ใช่ ref สินค้า → ไม่โพสต์โน้ตสินค้า
    expect(router.postSystemNote).not.toHaveBeenCalled();
  });

  it('ลูกค้าเก่ากลับมาจากโฆษณา (event referral ไม่มี message) → บันทึกที่มาให้ห้องเดิม ไม่สร้างข้อความ', async () => {
    const body = {
      object: 'page',
      entry: [{ id: 'page1', time: 1, messaging: [{
        sender: { id: PSID }, recipient: { id: 'page1' }, timestamp: 1, referral: AD_REFERRAL,
      }] }],
    };
    const { req, signature } = signedRequest(FB_APP_SECRET, body);
    await controller.handleWebhook(req, body, signature);

    expect(router.recordAdReferral).toHaveBeenCalledWith(
      PSID,
      'FACEBOOK',
      expect.objectContaining({ adId: '120246504706250534', adTitle: 'ฝนตกไม่อยากออกจากบ้าน' }),
    );
    expect(router.routeInbound).not.toHaveBeenCalled();
    // ไม่มี ref สินค้า → ไม่ยิงโน้ตสินค้า
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
  // ── 2026-09-12: สามจุดที่ทำให้ที่มาของลูกค้าหล่น ────────────────────────────
  // เจอตอนสืบว่าทำไม ads_attributions = 0 แถว (ไม่ใช่เหตุของ 0 แถว แต่กินข้อมูลจริง)

  it('ลิงก์สินค้า m.me ของลูกค้าเก่า (มี ref ไม่มี ad_id) → บันทึกที่มาด้วย ไม่ใช่แค่โน้ต', async () => {
    // เดิม gate `if (adAttribution?.adId)` ⇒ SHORTLINK ไม่เคยถูกบันทึกเลยสักครั้ง
    // ทั้งที่เส้นลูกค้าใหม่ (message.referral) ไม่มี gate นี้ = ผลต่างกันบนลิงก์เดียวกัน
    const { req, signature } = signedRequest(FB_APP_SECRET, referralEvent(`p:${PRODUCT_ID}`));
    await controller.handleWebhook(req, referralEvent(`p:${PRODUCT_ID}`), signature);

    expect(router.recordAdReferral).toHaveBeenCalledWith(
      PSID,
      'FACEBOOK',
      expect.objectContaining({
        utmSource: 'facebook',
        adId: undefined,
        utmContent: `p:${PRODUCT_ID}`,
        referrerUrl: 'SHORTLINK',
      }),
    );
    expect(router.postSystemNote).toHaveBeenCalledWith(
      'room-1',
      'ลูกค้ากดมาจากสินค้า Apple iPhone 15 Pro 256GB Blue (3333) บนเว็บ',
    );
  });

  it('postback ที่ quick-reply router รับไปแล้ว ยังต้องบันทึกที่มาที่พ่วงมาด้วย', async () => {
    // เดิม `if (routeResult.handled) return` ตัดก่อนถึง buildFbAttribution ⇒ referral หายทั้งก้อน
    postbackRouter.route.mockResolvedValue({ handled: true, action: 'template_sent' });
    const body = {
      object: 'page',
      entry: [{ id: 'page1', time: 1, messaging: [{
        sender: { id: PSID }, recipient: { id: 'page1' }, timestamp: 1,
        postback: { payload: 'TEMPLATE:abc', title: 'ราคา' },
        referral: { ref: `p:${PRODUCT_ID}`, source: 'SHORTLINK', type: 'OPEN_THREAD' },
      }] }],
    };
    const { req, signature } = signedRequest(FB_APP_SECRET, body);
    await controller.handleWebhook(req, body, signature);
    await new Promise((r) => setImmediate(r));

    expect(router.recordAdReferral).toHaveBeenCalledWith(
      PSID,
      'FACEBOOK',
      expect.objectContaining({ utmContent: `p:${PRODUCT_ID}` }),
    );
    expect(router.postSystemNote).toHaveBeenCalledWith(
      'room-1',
      'ลูกค้ากดมาจากสินค้า Apple iPhone 15 Pro 256GB Blue (3333) บนเว็บ',
    );
    // router รับไปแล้ว ต้องไม่สร้างข้อความซ้ำ
    expect(router.routeInbound).not.toHaveBeenCalled();
  });

  it('ลูกค้าใหม่ทักพร้อม message.referral ของลิงก์สินค้า → ได้โน้ตบอกรุ่นด้วย', async () => {
    // เดิมเส้น message ไม่เรียก handleProductReferral เลย (call site มีแค่ postback/standalone)
    const body = {
      object: 'page',
      entry: [{ id: 'page1', time: 1, messaging: [{
        sender: { id: PSID }, recipient: { id: 'page1' }, timestamp: 1,
        message: {
          mid: 'mid_new_from_product_link',
          text: 'เครื่องนี้ยังมีไหมครับ',
          referral: { ref: `p:${PRODUCT_ID}`, source: 'SHORTLINK', type: 'OPEN_THREAD' },
        },
      }] }],
    };
    const { req, signature } = signedRequest(FB_APP_SECRET, body);
    await controller.handleWebhook(req, body, signature);
    await new Promise((r) => setImmediate(r));

    expect(router.routeInbound).toHaveBeenCalledWith(
      expect.objectContaining({
        externalUserId: PSID,
        attribution: expect.objectContaining({ utmContent: `p:${PRODUCT_ID}` }),
      }),
    );
    expect(router.postSystemNote).toHaveBeenCalledWith(
      'room-1',
      'ลูกค้ากดมาจากสินค้า Apple iPhone 15 Pro 256GB Blue (3333) บนเว็บ',
    );
  });

  // ── PRODUCT_LINK_CLICK (การเดินทางของลูกค้า) ──
  it('ลิงก์สินค้า p:<id> + ห้องมีเจ้าของ → PRODUCT_LINK_CLICK หลังโพสต์โน้ต · เวลาและ dedupe มาจาก timestamp ของ event', async () => {
    prisma.chatRoom.findFirst.mockResolvedValue({ id: 'room-1', customerId: 'cust-1' });
    const order: string[] = [];
    router.postSystemNote.mockImplementation(async () => {
      order.push('note');
    });
    journey.recordAfterCommit.mockImplementation(async () => {
      order.push('journey');
    });
    const { req, signature } = signedRequest(FB_APP_SECRET, referralEvent(`p:${PRODUCT_ID}`));
    await controller.handleWebhook(req, referralEvent(`p:${PRODUCT_ID}`), signature);

    expect(order).toEqual(['note', 'journey']);
    expect(journey.recordAfterCommit).toHaveBeenCalledWith({
      customerId: 'cust-1',
      kind: 'PRODUCT_LINK_CLICK',
      occurredAt: new Date(1),
      actorType: 'CUSTOMER',
      actorUserId: null,
      roomId: 'room-1',
      refType: 'product',
      refId: PRODUCT_ID,
      data: { productId: PRODUCT_ID },
      dedupeKey: `PRODUCT_LINK_CLICK:room-1:${PRODUCT_ID}:1`,
    });
    expect(JSON.stringify(journey.recordAfterCommit.mock.calls[0][0])).not.toContain(PSID);
  });

  it('ห้องยังไม่มีเจ้าของ (customerId null) → โน้ตยังโพสต์ แต่ไม่บันทึก', async () => {
    prisma.chatRoom.findFirst.mockResolvedValue({ id: 'room-1', customerId: null });
    const { req, signature } = signedRequest(FB_APP_SECRET, referralEvent(`p:${PRODUCT_ID}`));
    await controller.handleWebhook(req, referralEvent(`p:${PRODUCT_ID}`), signature);
    expect(router.postSystemNote).toHaveBeenCalled();
    expect(journey.recordAfterCommit).not.toHaveBeenCalled();
  });

  it('ref ไม่ใช่สินค้า หรือไม่พบสินค้า → ไม่บันทึก', async () => {
    prisma.chatRoom.findFirst.mockResolvedValue({ id: 'room-1', customerId: 'cust-1' });
    const promo = signedRequest(FB_APP_SECRET, referralEvent('promo-songkran'));
    await controller.handleWebhook(promo.req, referralEvent('promo-songkran'), promo.signature);
    prisma.product.findFirst.mockResolvedValue(null);
    const gone = signedRequest(FB_APP_SECRET, referralEvent(`p:${PRODUCT_ID}`));
    await controller.handleWebhook(gone.req, referralEvent(`p:${PRODUCT_ID}`), gone.signature);
    expect(router.postSystemNote).toHaveBeenCalledTimes(2);
    expect(journey.recordAfterCommit).not.toHaveBeenCalled();
  });

  it('โพสต์โน้ตล้ม → ไม่บันทึก และ webhook ยังตอบ EVENT_RECEIVED', async () => {
    prisma.chatRoom.findFirst.mockResolvedValue({ id: 'room-1', customerId: 'cust-1' });
    router.postSystemNote.mockRejectedValue(new Error('send failed'));
    const { req, signature } = signedRequest(FB_APP_SECRET, referralEvent(`p:${PRODUCT_ID}`));
    await expect(controller.handleWebhook(req, referralEvent(`p:${PRODUCT_ID}`), signature)).resolves.toBe('EVENT_RECEIVED');
    expect(journey.recordAfterCommit).not.toHaveBeenCalled();
  });

  it('ลูกค้าใหม่ทักพร้อม message.referral ของลิงก์สินค้า → บันทึกหลัง routeInbound ด้วยเวลา event · ข้อความลูกค้าไม่หลุดเข้าแถว', async () => {
    prisma.chatRoom.findFirst.mockResolvedValue({ id: 'room-1', customerId: 'cust-1' });
    const body = {
      object: 'page',
      entry: [{ id: 'page1', time: 1, messaging: [{
        sender: { id: PSID }, recipient: { id: 'page1' }, timestamp: 1790000000000,
        message: {
          mid: 'mid_journey_product_click',
          text: 'เครื่องนี้ยังมีไหมครับ',
          referral: { ref: `p:${PRODUCT_ID}`, source: 'SHORTLINK', type: 'OPEN_THREAD' },
        },
      }] }],
    };
    const { req, signature } = signedRequest(FB_APP_SECRET, body);
    await controller.handleWebhook(req, body, signature);
    await new Promise((r) => setImmediate(r));

    expect(journey.recordAfterCommit).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'PRODUCT_LINK_CLICK',
      customerId: 'cust-1',
      occurredAt: new Date(1790000000000),
      dedupeKey: `PRODUCT_LINK_CLICK:room-1:${PRODUCT_ID}:1790000000000`,
    }));
    expect(JSON.stringify(journey.recordAfterCommit.mock.calls[0][0])).not.toContain('เครื่องนี้ยังมีไหมครับ');
  });
});
