import { Test, TestingModule } from '@nestjs/testing';
import * as Sentry from '@sentry/nestjs';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'crypto';
import { FacebookWebhookController } from './facebook-webhook.controller';
import { FacebookCommentIngestService } from './facebook-comment-ingest.service';
import { MessageRouterService } from '../chat-engine/services/message-router.service';
import { WebhookAnomalyService } from '../webhook-security/webhook-anomaly.service';
import { QuickReplyPostbackRouterService } from '../staff-chat/services/quick-reply-postback-router.service';
import { PrismaService } from '../../prisma/prisma.service';
import { IntegrationConfigService } from '../integrations/integration-config.service';
import { JourneyEntryWriter } from '../customer-journey/journey-entry-writer.service';
import { WebhookDedupService } from '../chatbot-finance/services/webhook-dedup.service';

jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn(), captureMessage: jest.fn() }));

/**
 * Task 37 (owner #27, 2026-11-01) — Meta redelivers a webhook when we answer slowly or non-2xx.
 * The same Messenger event delivered again must not run again: postback (GET_STARTED / TEMPLATE:),
 * ad/product notes, external echoes; the existing `mid` UNIQUE for customer messages stays.
 *
 * The dedupe store below behaves like `processed_webhook_events.event_id` UNIQUE (first claim wins).
 * Payload shapes follow Meta's webhook reference (messaging_postbacks: postback.{mid,title,payload,referral};
 * timestamp in ms) and the payloads already pinned in facebook-webhook.controller.spec.ts.
 */
const SECRET = 'synthetic-app-secret';
const OUR_APP_ID = '1234567890';
const PSID = 'psid-dedupe-1';
const PAGE = 'page-dedupe-1';
const PRODUCT_ID = '11111111-2222-3333-4444-555555555555';
const AD_REFERRAL = {
  ad_id: '120246504706250534',
  source: 'ADS',
  type: 'OPEN_THREAD',
  ads_context_data: { ad_title: 'โฆษณาทดสอบ', photo_url: 'https://scontent.example/ad.jpg' },
};

function store() {
  const keys = new Set<string>();
  return {
    keys,
    claim: jest.fn(async (key: string) => {
      if (keys.has(key)) return 'duplicate' as const;
      keys.add(key);
      return 'claimed' as const;
    }),
  };
}

function signed(body: unknown) {
  const rawBody = Buffer.from(JSON.stringify(body), 'utf-8');
  return {
    req: { ip: '31.13.64.1', headers: {}, rawBody } as unknown as import('express').Request,
    signature: 'sha256=' + createHmac('sha256', SECRET).update(rawBody).digest('hex'),
  };
}

const page = (...messaging: unknown[]) => ({
  object: 'page',
  entry: [{ id: PAGE, time: 1790000009000, messaging }],
});

const postback = (
  payload: string,
  opts: { mid?: string; timestamp?: number; referral?: unknown } = {},
) => ({
  sender: { id: PSID },
  recipient: { id: PAGE },
  ...(opts.timestamp === undefined ? { timestamp: 1790000000000 } : { timestamp: opts.timestamp }),
  postback: {
    ...(opts.mid ? { mid: opts.mid } : {}),
    title: 'ปุ่ม',
    payload,
    ...(opts.referral ? { referral: opts.referral } : {}),
  },
});

describe('FacebookWebhookController — Messenger redelivery runs each event once (Task 37)', () => {
  let controller: FacebookWebhookController;
  let dedupe: ReturnType<typeof store>;
  let router: {
    routeInbound: jest.Mock;
    mirrorOutbound: jest.Mock;
    postSystemNote: jest.Mock;
    recordAdReferral: jest.Mock;
  };
  let postbackRouter: { route: jest.Mock };
  let prisma: { chatRoom: { findFirst: jest.Mock }; product: { findFirst: jest.Mock } };
  let comments: { ingest: jest.Mock };

  /** Delivers the same signed body (a fresh JSON parse each time — what Meta's retry looks like to us). */
  async function deliver(body: unknown) {
    const copy = JSON.parse(JSON.stringify(body));
    const { req, signature } = signed(copy);
    const result = await controller.handleWebhook(req, copy, signature);
    await new Promise((r) => setImmediate(r));
    return result;
  }

  beforeEach(async () => {
    dedupe = store();
    router = {
      routeInbound: jest.fn().mockResolvedValue(undefined),
      mirrorOutbound: jest.fn().mockResolvedValue(undefined),
      postSystemNote: jest.fn().mockResolvedValue(undefined),
      recordAdReferral: jest.fn().mockResolvedValue(undefined),
    };
    postbackRouter = { route: jest.fn().mockResolvedValue({ handled: false }) };
    prisma = {
      chatRoom: { findFirst: jest.fn().mockResolvedValue({ id: 'room-1', customerId: null }) },
      product: {
        findFirst: jest.fn().mockResolvedValue({
          brand: 'Apple',
          model: 'iPhone 15',
          storage: '128GB',
          color: 'Black',
          imeiSerial: '000011112222',
        }),
      },
    };
    comments = { ingest: jest.fn().mockResolvedValue({ persisted: 0 }) };
    const mod: TestingModule = await Test.createTestingModule({
      controllers: [FacebookWebhookController],
      providers: [
        { provide: MessageRouterService, useValue: router },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((k: string) => (k === 'FACEBOOK_APP_ID' ? OUR_APP_ID : undefined)),
          },
        },
        { provide: WebhookAnomalyService, useValue: { record: jest.fn() } },
        { provide: QuickReplyPostbackRouterService, useValue: postbackRouter },
        { provide: PrismaService, useValue: prisma },
        {
          provide: IntegrationConfigService,
          useValue: { getConfig: jest.fn().mockResolvedValue({ appSecret: SECRET }) },
        },
        { provide: JourneyEntryWriter, useValue: { recordAfterCommit: jest.fn() } },
        { provide: FacebookCommentIngestService, useValue: comments },
        { provide: WebhookDedupService, useValue: dedupe },
      ],
    }).compile();
    controller = mod.get(FacebookWebhookController);
    (Sentry.captureException as jest.Mock).mockClear();
    (Sentry.captureMessage as jest.Mock).mockClear();
  });

  it('GET_STARTED delivered twice → one customer bubble and one bot turn', async () => {
    const body = page(postback('GET_STARTED', { mid: 'm_postback_get_started_1' }));
    await deliver(body);
    await deliver(body);
    expect(router.routeInbound).toHaveBeenCalledTimes(1);
  });

  it('TEMPLATE: postback delivered twice → the template is sent once', async () => {
    postbackRouter.route.mockResolvedValue({ handled: true, action: 'send-template' });
    const body = page(postback('TEMPLATE:tpl-1', { mid: 'm_postback_template_1' }));
    await deliver(body);
    await deliver(body);
    expect(postbackRouter.route).toHaveBeenCalledTimes(1);
    expect(postbackRouter.route).toHaveBeenCalledWith('room-1', 'TEMPLATE:tpl-1');
    expect(router.routeInbound).not.toHaveBeenCalled();
  });

  it('TEMPLATE: postback with an ad + product referral delivered twice → each note once', async () => {
    postbackRouter.route.mockResolvedValue({ handled: true, action: 'send-template' });
    const body = page(
      postback('TEMPLATE:tpl-1', {
        mid: 'm_postback_template_ref_1',
        referral: { ...AD_REFERRAL, ref: `p:${PRODUCT_ID}` },
      }),
    );
    await deliver(body);
    await deliver(body);
    expect(router.recordAdReferral).toHaveBeenCalledTimes(1);
    expect(router.postSystemNote).toHaveBeenCalledTimes(1);
    expect(router.postSystemNote).toHaveBeenCalledWith(
      'room-1',
      'ลูกค้ากดมาจากสินค้า Apple iPhone 15 128GB Black (2222) บนเว็บ',
    );
  });

  it('standalone product-link referral delivered twice → one system note', async () => {
    const body = page({
      sender: { id: PSID },
      recipient: { id: PAGE },
      timestamp: 1790000000000,
      referral: { ref: `p:${PRODUCT_ID}`, source: 'SHORTLINK', type: 'OPEN_THREAD' },
    });
    await deliver(body);
    await deliver(body);
    expect(router.recordAdReferral).toHaveBeenCalledTimes(1);
    expect(router.postSystemNote).toHaveBeenCalledTimes(1);
  });

  it('standalone ad referral (returning customer) delivered twice → one ad note via recordAdReferral', async () => {
    const body = page({
      sender: { id: PSID },
      recipient: { id: PAGE },
      timestamp: 1790000000000,
      referral: AD_REFERRAL,
    });
    await deliver(body);
    await deliver(body);
    expect(router.recordAdReferral).toHaveBeenCalledTimes(1);
  });

  it('customer message with an ad referral delivered twice → routed once (the ad note is written inside routeInbound)', async () => {
    const body = page({
      sender: { id: PSID },
      recipient: { id: PAGE },
      timestamp: 1790000000000,
      message: { mid: 'm_message_ad_1', text: 'สนใจครับ', referral: AD_REFERRAL },
    });
    await deliver(body);
    await deliver(body);
    expect(router.routeInbound).toHaveBeenCalledTimes(1);
    expect(router.routeInbound.mock.calls[0][0].externalMessageId).toBe('m_message_ad_1');
  });

  it('external echo delivered twice → mirrored once (no second AI pause request)', async () => {
    const body = page({
      sender: { id: PAGE },
      recipient: { id: PSID },
      timestamp: 1790000000000,
      message: { is_echo: true, app_id: 99999999, mid: 'm_echo_external_1', text: 'แอดมินตอบ' },
    });
    await deliver(body);
    await deliver(body);
    expect(router.mirrorOutbound).toHaveBeenCalledTimes(1);
  });

  it('dedupe is per event, not per request: a redelivered batch with one new event runs only the new one', async () => {
    const a = postback('GET_STARTED', { mid: 'm_postback_a' });
    const b = {
      sender: { id: PSID },
      recipient: { id: PAGE },
      timestamp: 1790000001000,
      message: { mid: 'm_message_b', text: 'ต่อ' },
    };
    await deliver(page(a));
    await deliver(page(b, a));
    expect(router.routeInbound).toHaveBeenCalledTimes(2);
    expect(router.routeInbound.mock.calls.map((c) => c[0].externalMessageId)).toEqual([
      expect.stringMatching(/^postback_/),
      'm_message_b',
    ]);
  });

  it('two real taps of the same button (new mid + new timestamp) both run', async () => {
    await deliver(page(postback('GET_STARTED', { mid: 'm_tap_1', timestamp: 1790000000000 })));
    await deliver(page(postback('GET_STARTED', { mid: 'm_tap_2', timestamp: 1790000060000 })));
    expect(router.routeInbound).toHaveBeenCalledTimes(2);
    const ids = router.routeInbound.mock.calls.map((c) => c[0].externalMessageId);
    expect(new Set(ids).size).toBe(2);
  });

  it('postback without postback.mid: the same tap twice still runs once (sender + Meta timestamp + payload)', async () => {
    const body = page(postback('GET_STARTED'));
    await deliver(body);
    await deliver(body);
    expect(router.routeInbound).toHaveBeenCalledTimes(1);
  });

  it('legacy postback externalMessageId comes from the event, not Date.now() — the chat_messages UNIQUE still holds if the gate fails open', async () => {
    dedupe.claim.mockRejectedValue(new Error('connection pool timeout'));
    const nowSpy = jest.spyOn(Date, 'now');
    nowSpy.mockReturnValue(1790000005000);
    await deliver(page(postback('GET_STARTED')));
    nowSpy.mockReturnValue(1790000025000);
    await deliver(page(postback('GET_STARTED')));
    nowSpy.mockRestore();
    expect(router.routeInbound).toHaveBeenCalledTimes(2);
    const [first, second] = router.routeInbound.mock.calls.map((c) => c[0].externalMessageId);
    expect(first).toBe(second);
    expect(first).toBe(`postback_1790000000000_${PSID}`);
  });

  it('dedupe store unavailable → the event is still processed (fail open) and Sentry gets kind + reason only', async () => {
    dedupe.claim.mockRejectedValue(new Error('connection pool timeout'));
    postbackRouter.route.mockResolvedValue({ handled: true, action: 'send-template' });
    await deliver(page(postback('TEMPLATE:tpl-secret-payload', { mid: 'm_postback_unavailable' })));
    expect(postbackRouter.route).toHaveBeenCalledTimes(1);
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    const [, context] = (Sentry.captureException as jest.Mock).mock.calls[0];
    expect(context).toEqual({
      level: 'warning',
      tags: {
        subsystem: 'facebook-messenger',
        action: 'messenger-dedupe-unavailable',
        kind: 'postback',
      },
    });
    const sent = JSON.stringify((Sentry.captureException as jest.Mock).mock.calls);
    expect(sent).not.toContain(PSID);
    expect(sent).not.toContain('tpl-secret-payload');
  });

  it('read/delivery receipts and our own echoes never claim a row', async () => {
    await deliver(
      page(
        {
          sender: { id: PSID },
          recipient: { id: PAGE },
          timestamp: 1790000000000,
          read: { watermark: 1790000000000 },
        },
        {
          sender: { id: PSID },
          recipient: { id: PAGE },
          timestamp: 1790000000000,
          delivery: { mids: ['m_x'], watermark: 1 },
        },
        {
          sender: { id: PAGE },
          recipient: { id: PSID },
          timestamp: 1790000000000,
          message: { is_echo: true, app_id: Number(OUR_APP_ID), mid: 'm_our_echo', text: 'บอทตอบ' },
        },
      ),
    );
    expect(dedupe.claim).not.toHaveBeenCalled();
    expect(router.mirrorOutbound).not.toHaveBeenCalled();
  });

  it('Task 35 order holds: a transient comment failure answers non-2xx before any claim; the redelivery runs Messenger once', async () => {
    comments.ingest.mockRejectedValueOnce(new Error('database unavailable'));
    const body = page(postback('GET_STARTED', { mid: 'm_postback_after_comment_failure' }));
    await expect(deliver(body)).rejects.toThrow('database unavailable');
    expect(dedupe.claim).not.toHaveBeenCalled();
    expect(router.routeInbound).not.toHaveBeenCalled();
    await expect(deliver(body)).resolves.toBe('EVENT_RECEIVED');
    await deliver(body);
    expect(router.routeInbound).toHaveBeenCalledTimes(1);
  });

  it('two concurrent deliveries of the same body (slow first answer) → side effects once', async () => {
    postbackRouter.route.mockResolvedValue({ handled: true, action: 'send-template' });
    const body = page(postback('TEMPLATE:tpl-1', { mid: 'm_concurrent_template' }), {
      sender: { id: PSID },
      recipient: { id: PAGE },
      timestamp: 1790000000500,
      message: { mid: 'm_concurrent_message', text: 'x' },
    });
    const results = await Promise.all([deliver(body), deliver(body)]);
    expect(results).toEqual(['EVENT_RECEIVED', 'EVENT_RECEIVED']);
    expect(postbackRouter.route).toHaveBeenCalledTimes(1);
    expect(router.routeInbound).toHaveBeenCalledTimes(1);
  });
});
