import { Test, TestingModule } from '@nestjs/testing';
import * as Sentry from '@sentry/nestjs';
import { InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'crypto';
import { ChatChannel, MessageRole } from '@prisma/client';
import { FacebookWebhookController } from './facebook-webhook.controller';
import { MessageRouterService } from '../chat-engine/services/message-router.service';
import { WebhookAnomalyService } from '../webhook-security/webhook-anomaly.service';

jest.mock('@sentry/nestjs', () => ({
  captureException: jest.fn(),
  captureMessage: jest.fn(),
}));

function signedRequest(secret: string, body: unknown): {
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

    const mod: TestingModule = await Test.createTestingModule({
      controllers: [FacebookWebhookController],
      providers: [
        { provide: MessageRouterService, useValue: router },
        { provide: ConfigService, useValue: config },
        { provide: WebhookAnomalyService, useValue: anomaly },
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

    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      'Facebook webhook rawBody capture failed',
      { level: 'error' },
    );
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

    const mod: TestingModule = await Test.createTestingModule({
      controllers: [FacebookWebhookController],
      providers: [
        { provide: MessageRouterService, useValue: router },
        { provide: ConfigService, useValue: config },
        { provide: WebhookAnomalyService, useValue: anomaly },
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
    const mod = await Test.createTestingModule({
      controllers: [FacebookWebhookController],
      providers: [
        { provide: MessageRouterService, useValue: localRouter },
        { provide: ConfigService, useValue: config },
        { provide: WebhookAnomalyService, useValue: anomaly },
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
      attachments: [
        { type: 'image', payload: { url: 'https://cdn.fb/image.jpg' } },
      ],
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
