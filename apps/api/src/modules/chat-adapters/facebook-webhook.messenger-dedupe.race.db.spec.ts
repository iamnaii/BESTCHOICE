import { Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { createHmac } from 'crypto';
import { FacebookWebhookController } from './facebook-webhook.controller';
import { WebhookDedupService } from '../chatbot-finance/services/webhook-dedup.service';

jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn(), captureMessage: jest.fn() }));

/**
 * Task 37 — Meta resends a webhook while the first request is still working (slow template send), and
 * the two requests land on different API instances. Two controllers, each with its own WebhookDedupService
 * on its own PrismaClient (= its own connection pool), receive the same signed body at the same time:
 * every Messenger side effect must happen once.
 *
 * Timing-independent: a rendezvous in front of every `processed_webhook_events` INSERT holds the first
 * connection until the second reaches the same key (max BARRIER_MS), so both INSERTs are in flight
 * together — only the UNIQUE index can decide. A check-then-insert implementation would let both through.
 *
 * Run: DATABASE_URL=<test_db or *_test with migrations applied> npx jest <this file> --runInBand
 * (no DATABASE_URL = skipped). Rows it creates are deleted at the end.
 */
const describeDb = process.env.DATABASE_URL ? describe : describe.skip;

const SECRET = 'synthetic-app-secret';
const OUR_APP_ID = '1234567890';
const BARRIER_MS = 750;

describeDb('Messenger redelivery dedupe — two connections at once (real DB)', () => {
  const rawA = new PrismaClient();
  const rawB = new PrismaClient();
  const stamp = Date.now();
  const PSID = `psid-race-${stamp}`;
  const PAGE = `page-race-${stamp}`;
  const attemptedKeys = new Set<string>();

  const waiting = new Map<string, () => void>();
  /** keys whose two INSERTs were released together (both connections in flight at once) */
  const met = new Set<string>();
  /** Holds the first INSERT of a key until the other connection brings the same key (or BARRIER_MS). */
  function rendezvous(eventId: string): Promise<void> {
    attemptedKeys.add(eventId);
    return new Promise<void>((resolve) => {
      const other = waiting.get(eventId);
      if (other) {
        waiting.delete(eventId);
        met.add(eventId);
        other();
        resolve();
        return;
      }
      waiting.set(eventId, resolve);
      setTimeout(() => {
        if (waiting.get(eventId) === resolve) waiting.delete(eventId);
        resolve();
      }, BARRIER_MS);
    });
  }
  const withRendezvous = (db: PrismaClient) =>
    db.$extends({
      query: {
        processedWebhookEvent: {
          async create({ args, query }) {
            await rendezvous(String(args.data.eventId));
            return query(args);
          },
        },
      },
    }) as unknown as PrismaClient;

  const router = {
    routeInbound: jest.fn().mockResolvedValue(undefined),
    mirrorOutbound: jest.fn().mockResolvedValue(undefined),
    postSystemNote: jest.fn().mockResolvedValue(undefined),
    recordAdReferral: jest.fn().mockResolvedValue(undefined),
  };
  // the template send is what makes Meta's first request slow — keep it slow here too
  const postbackRouter = {
    route: jest.fn(
      () => new Promise((r) => setTimeout(() => r({ handled: true, action: 'send-template' }), 50)),
    ),
  };
  const lookups = {
    chatRoom: { findFirst: jest.fn().mockResolvedValue({ id: 'room-race', customerId: null }) },
    product: { findFirst: jest.fn().mockResolvedValue(null) },
  };

  const controllerOn = (db: PrismaClient) =>
    new FacebookWebhookController(
      router as never,
      { get: (k: string) => (k === 'FACEBOOK_APP_ID' ? OUR_APP_ID : undefined) } as never,
      { record: jest.fn() } as never,
      postbackRouter as never,
      lookups as never,
      { getConfig: async () => ({ appSecret: SECRET }) } as never,
      new WebhookDedupService(withRendezvous(db) as never),
      undefined,
      undefined,
    );
  const instanceA = controllerOn(rawA);
  const instanceB = controllerOn(rawB);

  const body = {
    object: 'page',
    entry: [
      {
        id: PAGE,
        time: 1790000009000,
        messaging: [
          {
            sender: { id: PSID },
            recipient: { id: PAGE },
            timestamp: 1790000000000,
            postback: {
              mid: `m_race_postback_${stamp}`,
              title: 'ราคา',
              payload: 'TEMPLATE:tpl-race',
            },
          },
          {
            sender: { id: PSID },
            recipient: { id: PAGE },
            timestamp: 1790000000100,
            message: { mid: `m_race_message_${stamp}`, text: 'สนใจครับ' },
          },
          {
            sender: { id: PSID },
            recipient: { id: PAGE },
            timestamp: 1790000000200,
            referral: { ref: `promo-race-${stamp}`, source: 'SHORTLINK', type: 'OPEN_THREAD' },
          },
          {
            sender: { id: PAGE },
            recipient: { id: PSID },
            timestamp: 1790000000300,
            message: {
              is_echo: true,
              app_id: 99999999,
              mid: `m_race_echo_${stamp}`,
              text: 'แอดมินตอบ',
            },
          },
        ],
      },
    ],
  };
  const deliverTo = (controller: FacebookWebhookController) => {
    const copy = JSON.parse(JSON.stringify(body));
    const rawBody = Buffer.from(JSON.stringify(copy), 'utf-8');
    const signature = 'sha256=' + createHmac('sha256', SECRET).update(rawBody).digest('hex');
    return controller.handleWebhook({ headers: {}, rawBody } as never, copy, signature);
  };

  beforeAll(async () => {
    const dbName = new URL(process.env.DATABASE_URL as string).pathname.slice(1);
    if (!/^test_db$|_test$/.test(dbName)) {
      throw new Error(
        `สเปคนี้เขียนแถวจริง — ต้องรันกับฐานทดสอบ (test_db หรือ *_test) แต่ได้ "${dbName}"`,
      );
    }
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    await Promise.all([rawA.$connect(), rawB.$connect()]);
  });

  afterAll(async () => {
    if (attemptedKeys.size > 0) {
      await rawA.processedWebhookEvent.deleteMany({
        where: { eventId: { in: [...attemptedKeys] } },
      });
    }
    jest.restoreAllMocks();
    await Promise.all([rawA.$disconnect(), rawB.$disconnect()]);
  });

  it('the same body on two instances at once → each event claimed once and its side effect runs once', async () => {
    const results = await Promise.all([deliverTo(instanceA), deliverTo(instanceB)]);
    await new Promise((r) => setImmediate(r));

    expect(results).toEqual(['EVENT_RECEIVED', 'EVENT_RECEIVED']);
    expect(postbackRouter.route).toHaveBeenCalledTimes(1); // template sent once
    expect(router.routeInbound).toHaveBeenCalledTimes(1); // customer message routed once
    expect(router.recordAdReferral).toHaveBeenCalledTimes(1); // referral handled once
    expect(router.postSystemNote).toHaveBeenCalledTimes(1); // "ลูกค้ากดเข้ามาจากลิงก์เว็บ" once
    expect(router.mirrorOutbound).toHaveBeenCalledTimes(1); // external echo mirrored once

    // four events → four claim keys; both connections INSERTed each key at the same moment; one row each
    expect(attemptedKeys.size).toBe(4);
    expect(met).toEqual(attemptedKeys);
    const rows = await rawA.processedWebhookEvent.findMany({
      where: { eventId: { in: [...attemptedKeys] } },
      select: { eventId: true },
    });
    expect(rows).toHaveLength(4);
    for (const { eventId } of rows) {
      expect(eventId).toMatch(/^fb:(message|echo|postback|referral):[0-9a-f]{64}$/);
      expect(eventId).not.toContain(PSID);
    }
  });

  it('a later resend (Meta retries after a timeout) runs nothing again', async () => {
    await deliverTo(instanceB);
    await new Promise((r) => setImmediate(r));
    expect(postbackRouter.route).toHaveBeenCalledTimes(1);
    expect(router.routeInbound).toHaveBeenCalledTimes(1);
    expect(router.recordAdReferral).toHaveBeenCalledTimes(1);
    expect(router.mirrorOutbound).toHaveBeenCalledTimes(1);
  });
});
