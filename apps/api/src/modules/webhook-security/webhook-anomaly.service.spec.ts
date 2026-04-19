import { Test, TestingModule } from '@nestjs/testing';
import { WebhookAnomalyService } from './webhook-anomaly.service';
import { PrismaService } from '../../prisma/prisma.service';

jest.mock('@sentry/nestjs', () => ({
  captureException: jest.fn(),
}));

describe('WebhookAnomalyService.record', () => {
  let service: WebhookAnomalyService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      webhookAnomaly: {
        create: jest.fn().mockResolvedValue({ id: 'wa-1' }),
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
    prisma.webhookAnomaly.create.mockRejectedValue(new Error('table missing'));
    await expect(
      service.record({ provider: 'line-finance', reason: 'invalid_signature' }),
    ).resolves.toBeUndefined();
  });
});
