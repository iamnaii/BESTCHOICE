import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { PromotionsService } from './promotions.service';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Wave-1 #14 — applyToSale enforced its maxUsageCount with a read taken OUTSIDE
 * the transaction, so two concurrent callers at (cap-1) could both pass the
 * check and both increment → over-cap. The fix moves the guarantee into an
 * atomic conditional (CAS) increment inside the tx. These tests pin that.
 */
describe('PromotionsService.applyToSale — atomic usage-cap (Wave-1 #14)', () => {
  let service: PromotionsService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let tx: any;

  const promo = {
    id: 'promo-1',
    isActive: true,
    startDate: new Date(Date.now() - 86_400_000),
    endDate: new Date(Date.now() + 86_400_000),
    currentUsageCount: 9,
    maxUsageCount: 10,
  };

  beforeEach(async () => {
    tx = {
      promotion: { updateMany: jest.fn(), update: jest.fn().mockResolvedValue({}) },
      promotionUsage: { create: jest.fn().mockResolvedValue({ id: 'usage-1' }) },
    };
    prisma = { $transaction: jest.fn((cb: (t: unknown) => unknown) => cb(tx)) };
    const mod: TestingModule = await Test.createTestingModule({
      providers: [PromotionsService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = mod.get(PromotionsService);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    jest.spyOn(service, 'findOne').mockResolvedValue({ ...promo } as any);
  });

  it('CAS-increments only while under the cap (conditional where), then records usage', async () => {
    tx.promotion.updateMany.mockResolvedValue({ count: 1 });

    await service.applyToSale('promo-1', 'sale-1', 'cust-1', 100);

    expect(tx.promotion.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'promo-1', currentUsageCount: { lt: 10 } },
        data: { currentUsageCount: { increment: 1 } },
      }),
    );
    expect(tx.promotionUsage.create).toHaveBeenCalled();
  });

  it('rejects + does NOT record usage when the race is lost (CAS count=0)', async () => {
    tx.promotion.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.applyToSale('promo-1', 'sale-1', 'cust-1', 100)).rejects.toThrow(
      BadRequestException,
    );
    expect(tx.promotionUsage.create).not.toHaveBeenCalled();
  });

  it('unlimited promo (maxUsageCount null) → plain increment, no CAS', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    jest.spyOn(service, 'findOne').mockResolvedValue({ ...promo, maxUsageCount: null } as any);

    await service.applyToSale('promo-1', 'sale-1', 'cust-1', 100);

    expect(tx.promotion.update).toHaveBeenCalled();
    expect(tx.promotion.updateMany).not.toHaveBeenCalled();
    expect(tx.promotionUsage.create).toHaveBeenCalled();
  });
});
