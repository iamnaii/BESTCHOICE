import { Test, TestingModule } from '@nestjs/testing';
import { WebhookAnomalyCron } from './webhook-anomaly.cron';
import { PrismaService } from '../../prisma/prisma.service';

jest.mock('@sentry/nestjs', () => ({
  captureMessage: jest.fn(),
  captureException: jest.fn(),
}));

import * as Sentry from '@sentry/nestjs';

describe('WebhookAnomalyCron.detectSpikes', () => {
  let cron: WebhookAnomalyCron;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  beforeEach(async () => {
    (Sentry.captureMessage as jest.Mock).mockClear();
    (Sentry.captureException as jest.Mock).mockClear();
    prisma = {
      webhookAnomaly: { groupBy: jest.fn().mockResolvedValue([]) },
    };

    const mod: TestingModule = await Test.createTestingModule({
      providers: [WebhookAnomalyCron, { provide: PrismaService, useValue: prisma }],
    }).compile();
    cron = mod.get(WebhookAnomalyCron);
  });

  it('returns empty when no anomalies', async () => {
    const result = await cron.detectSpikes();
    expect(result.total).toBe(0);
    expect(result.spikes).toEqual([]);
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  });

  it('does not alert when counts are below threshold', async () => {
    prisma.webhookAnomaly.groupBy.mockResolvedValue([
      { provider: 'line-finance', reason: 'invalid_signature', _count: 3 },
      { provider: 'paysolutions', reason: 'merchant_mismatch', _count: 2 },
    ]);
    const result = await cron.detectSpikes();
    expect(result.total).toBe(5);
    expect(result.spikes).toEqual([]);
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  });

  it('alerts when provider crosses SPIKE_THRESHOLD (10)', async () => {
    prisma.webhookAnomaly.groupBy.mockResolvedValue([
      { provider: 'line-finance', reason: 'invalid_signature', _count: 8 },
      { provider: 'line-finance', reason: 'missing_signature', _count: 4 },
    ]);
    const result = await cron.detectSpikes();
    expect(result.spikes).toEqual([{ provider: 'line-finance', count: 12 }]);
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      expect.stringContaining('Webhook anomaly spike'),
      expect.objectContaining({
        level: 'warning',
        tags: expect.objectContaining({ cron: 'webhook-anomaly' }),
      }),
    );
  });

  it('captures exception on DB error (does NOT throw)', async () => {
    prisma.webhookAnomaly.groupBy.mockRejectedValue(new Error('db down'));
    const result = await cron.detectSpikes();
    expect(result.total).toBe(0);
    expect(Sentry.captureException).toHaveBeenCalled();
  });
});
