import { Test, TestingModule } from '@nestjs/testing';
import { PromotionsService } from './promotions.service';
import { PrismaService } from '../../prisma/prisma.service';

/** Arbitrary post-sale caller amounts are no longer a named promotion producer.
 * Real cap/CAS and canonical money behavior are exercised through owned PostgreSQL/HTTP.
 */
describe('PromotionsService.applyToSale legacy proof rejection', () => {
  it('rejects an unscoped caller without performing writes', async () => {
    const prisma = { $transaction: jest.fn() };
    const service = new PromotionsService(prisma as unknown as PrismaService);
    await expect(service.applyToSale('promo', 'sale', 'customer', 100)).rejects.toThrow(
      'ต้องตรวจสอบสิทธิ์',
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

/**
 * Web-shop public promotions feed — findActivePublic must strip internal
 * fields (usage counters leak campaign quota/performance to competitors)
 * while keeping every display field the storefront renders.
 */
describe('PromotionsService.findActivePublic — public field sanitization', () => {
  let service: PromotionsService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  const baseRow = {
    id: 'promo-pub-1',
    name: 'ลดแรงรับเปิดเทอม',
    description: 'iPhone ทุกรุ่นลดทันที',
    type: 'PERCENTAGE_DISCOUNT',
    discountValue: 10,
    specialInterestRate: null,
    conditions: { minPurchase: 5000 },
    startDate: new Date(Date.now() - 86_400_000),
    endDate: new Date(Date.now() + 86_400_000),
    maxUsageCount: 100,
    currentUsageCount: 42,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  };

  beforeEach(async () => {
    prisma = { promotion: { findMany: jest.fn().mockResolvedValue([baseRow]) } };
    const mod: TestingModule = await Test.createTestingModule({
      providers: [PromotionsService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = mod.get(PromotionsService);
  });

  it('returns display fields and strips usage counters + isActive', async () => {
    const result = await service.findActivePublic();

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      id: baseRow.id,
      name: baseRow.name,
      description: baseRow.description,
      type: baseRow.type,
      discountValue: baseRow.discountValue,
      specialInterestRate: baseRow.specialInterestRate,
      conditions: baseRow.conditions,
      startDate: baseRow.startDate,
      endDate: baseRow.endDate,
    });
    expect(result[0]).not.toHaveProperty('currentUsageCount');
    expect(result[0]).not.toHaveProperty('maxUsageCount');
  });

  it('inherits the exhausted-quota filter from findActivePromotions', async () => {
    prisma.promotion.findMany.mockResolvedValue([
      { ...baseRow, currentUsageCount: 100, maxUsageCount: 100 },
    ]);

    await expect(service.findActivePublic()).resolves.toEqual([]);
  });
});
