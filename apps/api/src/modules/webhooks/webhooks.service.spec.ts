import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { WebhooksService } from './webhooks.service';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * D1.3.3.3 — outbound webhook dispatch gate.
 *
 * The service reads SystemConfig key `webhooks_enabled` (DEFAULT OFF). When
 * off, `dispatchEvent` is a silent no-op (so callers in payment/contract
 * services don't error out on the side-effect path) and `sendTestEvent`
 * throws a Thai BadRequest so OWNER's test-button click in the UI is loud.
 */
describe('WebhooksService — outbound gate (D1.3.3.3)', () => {
  let service: WebhooksService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      systemConfig: {
        findFirst: jest.fn(),
      },
      webhookSubscription: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn(),
      },
      webhookDelivery: {
        create: jest.fn(),
      },
    };

    const mod: TestingModule = await Test.createTestingModule({
      providers: [
        WebhooksService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = mod.get(WebhooksService);
  });

  describe('dispatchEvent', () => {
    it('is a no-op when SystemConfig.webhooks_enabled is absent (DEFAULT-OFF)', async () => {
      prisma.systemConfig.findFirst.mockResolvedValue(null);
      await service.dispatchEvent('payment.created' as never, { foo: 'bar' });
      // findMany on subscriptions should NEVER be called when gate is off
      expect(prisma.webhookSubscription.findMany).not.toHaveBeenCalled();
    });

    it('is a no-op when SystemConfig.webhooks_enabled is explicitly "false"', async () => {
      prisma.systemConfig.findFirst.mockResolvedValue({ value: 'false' });
      await service.dispatchEvent('payment.created' as never, {});
      expect(prisma.webhookSubscription.findMany).not.toHaveBeenCalled();
    });

    it('proceeds to subscription lookup when flag is "true"', async () => {
      prisma.systemConfig.findFirst.mockResolvedValue({ value: 'true' });
      await service.dispatchEvent('payment.created' as never, {});
      expect(prisma.webhookSubscription.findMany).toHaveBeenCalled();
    });

    it('is a no-op when the SystemConfig read throws (fail-closed)', async () => {
      prisma.systemConfig.findFirst.mockRejectedValue(new Error('DB down'));
      await service.dispatchEvent('payment.created' as never, {});
      expect(prisma.webhookSubscription.findMany).not.toHaveBeenCalled();
    });
  });

  describe('sendTestEvent', () => {
    it('throws BadRequest when webhooks_enabled is off (loud failure for OWNER)', async () => {
      prisma.systemConfig.findFirst.mockResolvedValue(null); // default OFF
      await expect(service.sendTestEvent('any-id')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });
});
