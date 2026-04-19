import { Test, TestingModule } from '@nestjs/testing';
import * as Sentry from '@sentry/nestjs';
import { WebhookAnomalyService } from './webhook-anomaly.service';
import { PrismaService } from '../../prisma/prisma.service';

jest.mock('@sentry/nestjs', () => ({
  captureException: jest.fn(),
  captureMessage: jest.fn(),
}));

describe('WebhookAnomalyService.record', () => {
  let service: WebhookAnomalyService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  beforeEach(async () => {
    (Sentry.captureMessage as jest.Mock).mockClear();
    (Sentry.captureException as jest.Mock).mockClear();
    prisma = {
      webhookAnomaly: {
        create: jest.fn().mockResolvedValue({ id: 'wa-1' }),
        count: jest.fn().mockResolvedValue(0),
      },
    };
    const mod: TestingModule = await Test.createTestingModule({
      providers: [WebhookAnomalyService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = mod.get(WebhookAnomalyService);
  });

  it('persists anomaly with required fields', async () => {
    await service.record({
      provider: 'line-finance',
      reason: 'invalid_signature',
      ipAddress: '1.2.3.4',
      userAgent: 'line-bot/1.0',
    });
    expect(prisma.webhookAnomaly.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          provider: 'line-finance',
          reason: 'invalid_signature',
          ipAddress: '1.2.3.4',
          userAgent: 'line-bot/1.0',
        }),
      }),
    );
  });

  it('truncates excessively long user agent to 500 chars', async () => {
    const longUa = 'x'.repeat(2000);
    await service.record({
      provider: 'paysolutions',
      reason: 'merchant_mismatch',
      userAgent: longUa,
    });
    const data = prisma.webhookAnomaly.create.mock.calls[0][0].data;
    expect(data.userAgent.length).toBe(500);
  });

  it('swallows DB failure (observability must not block webhooks)', async () => {
    prisma.webhookAnomaly.count.mockResolvedValue(0);
    prisma.webhookAnomaly.create.mockRejectedValue(new Error('table missing'));
    await expect(
      service.record({ provider: 'line-finance', reason: 'invalid_signature' }),
    ).resolves.toBeUndefined();
  });

  // ─── T6-C17: rate limit + spike detection ───────────────────────

  describe('T6-C17 — flood cap and spike detection', () => {
    it('inserts normally when under both thresholds', async () => {
      // 2 hourly-same-reason, 2 recent-provider — both under limits
      prisma.webhookAnomaly.count
        .mockResolvedValueOnce(2) // same reason hourly
        .mockResolvedValueOnce(2); // provider 5-min
      await service.record({ provider: 'line-finance', reason: 'invalid_signature' });
      expect(prisma.webhookAnomaly.create).toHaveBeenCalledTimes(1);
      expect(Sentry.captureMessage).not.toHaveBeenCalled();
    });

    it('skips insert + emits aggregated Sentry info when flood cap exceeded', async () => {
      // 150 rows already exist for (provider, reason) in last hour
      prisma.webhookAnomaly.count
        .mockResolvedValueOnce(150) // hourly same reason — over FLOOD_LIMIT (100)
        .mockResolvedValueOnce(3); // provider 5-min (irrelevant, flood short-circuits)

      await service.record({ provider: 'paysolutions', reason: 'invalid_signature' });
      expect(prisma.webhookAnomaly.create).not.toHaveBeenCalled();
      expect(Sentry.captureMessage).toHaveBeenCalledWith(
        'Webhook anomaly flood — inserts suppressed',
        expect.objectContaining({
          level: 'info',
          tags: expect.objectContaining({ action: 'anomaly_flood' }),
          extra: expect.objectContaining({ hourlyCount: 150 }),
        }),
      );

      // Second call within cooldown → no Sentry duplication
      (Sentry.captureMessage as jest.Mock).mockClear();
      prisma.webhookAnomaly.count
        .mockResolvedValueOnce(151)
        .mockResolvedValueOnce(3);
      await service.record({ provider: 'paysolutions', reason: 'invalid_signature' });
      expect(Sentry.captureMessage).not.toHaveBeenCalled();
    });

    it('emits spike warning when 5+ anomalies from same provider in 5 min', async () => {
      // hourly same reason low (no flood), but provider-5min is 4; after insert it will be 5
      prisma.webhookAnomaly.count
        .mockResolvedValueOnce(4) // same reason hourly — under FLOOD_LIMIT
        .mockResolvedValueOnce(4); // provider 5-min — +1 insert → 5 triggers spike

      await service.record({ provider: 'line-finance', reason: 'invalid_signature' });
      expect(prisma.webhookAnomaly.create).toHaveBeenCalledTimes(1);
      expect(Sentry.captureMessage).toHaveBeenCalledWith(
        'Webhook anomaly spike (5-min)',
        expect.objectContaining({
          level: 'warning',
          tags: expect.objectContaining({ action: 'anomaly_spike' }),
          extra: expect.objectContaining({ recentCount: 5 }),
        }),
      );
    });
  });
});
