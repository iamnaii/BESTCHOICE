import { Test, TestingModule } from '@nestjs/testing';
import * as Sentry from '@sentry/nestjs';
import { InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FacebookWebhookController } from './facebook-webhook.controller';
import { MessageRouterService } from '../chat-engine/services/message-router.service';
import { WebhookAnomalyService } from '../webhook-security/webhook-anomaly.service';

jest.mock('@sentry/nestjs', () => ({
  captureException: jest.fn(),
  captureMessage: jest.fn(),
}));

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
