import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { InstallmentPreviewService } from './installment-preview.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('InstallmentPreviewService', () => {
  let service: InstallmentPreviewService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      product: { findUnique: jest.fn() },
      interestConfig: { findFirst: jest.fn() },
      gfinModelMapping: { findMany: jest.fn() },
      gfinOverpriceRule: { findMany: jest.fn() },
      gfinRateFactor: { findFirst: jest.fn() },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InstallmentPreviewService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = module.get(InstallmentPreviewService);
  });

  it('returns available:false when product not found', async () => {
    prisma.product.findUnique.mockResolvedValue(null);
    const result = await service.preview({ productId: 'nope', provider: 'BC', months: 12 });
    expect(result.available).toBe(false);
    expect(result.reason).toBe('product_not_found');
  });

  it('returns available:false when no installment price set', async () => {
    prisma.product.findUnique.mockResolvedValue({
      id: 'p1',
      installmentPrice: null,
      prices: [],
      category: 'PHONE_USED',
      brand: 'Apple',
      model: 'iPhone 14 Pro',
      storage: '128GB',
      deletedAt: null,
    });
    const result = await service.preview({ productId: 'p1', provider: 'BC', months: 12 });
    expect(result.available).toBe(false);
    expect(result.reason).toBe('no_installment_price');
  });

  it('BC: returns canonical worked example monthly payment 2,413.21', async () => {
    prisma.product.findUnique.mockResolvedValue({
      id: 'p1',
      installmentPrice: new Prisma.Decimal('19900'),
      prices: [],
      category: 'PHONE_USED',
      brand: 'Apple',
      model: 'iPhone 14 Pro',
      storage: '128GB',
      deletedAt: null,
    });
    prisma.interestConfig.findFirst.mockResolvedValue({
      id: 'c1',
      minDownPaymentPct: new Prisma.Decimal('0.15'),
      storeCommissionPct: new Prisma.Decimal('0.10'),
      vatPct: new Prisma.Decimal('0.07'),
      minInstallmentMonths: 5,
      maxInstallmentMonths: 12,
      interestRate: new Prisma.Decimal('0.0417'),
      rates: [
        { months: 12, ratePct: new Prisma.Decimal('0.50'), deletedAt: null },
      ],
    });
    const result = await service.preview({ productId: 'p1', provider: 'BC', months: 12 });
    expect(result.available).toBe(true);
    expect(result.monthlyPayment).toBeCloseTo(2413.21, 2);
    expect(result.downAmount).toBeCloseTo(2985, 2);
  });

  it('GFIN: returns canonical worked example monthly payment 2,923.00', async () => {
    prisma.product.findUnique.mockResolvedValue({
      id: 'p1',
      installmentPrice: new Prisma.Decimal('19900'),
      prices: [],
      category: 'PHONE_USED',
      brand: 'Apple',
      model: 'iPhone 14 Pro',
      storage: '128GB',
      deletedAt: null,
    });
    prisma.gfinModelMapping.findMany.mockResolvedValue([
      {
        id: 'm1',
        gfinSeries: 'iPhone 14',
        gfinVariant: 'Pro',
        storage: '128GB',
        condition: 'HAND_2',
        maxPrice: new Prisma.Decimal('21500'),
        modelMatchPattern: 'iPhone 14 Pro',
        isActive: true,
      },
    ]);
    prisma.gfinOverpriceRule.findMany.mockResolvedValue([
      {
        id: 'r1',
        label: 'iPhone 14 มือ 2',
        seriesPattern: 'iPhone 14|iPhone 15',
        condition: 'HAND_2',
        allowance: new Prisma.Decimal('1000'),
        isActive: true,
      },
    ]);
    prisma.gfinRateFactor.findFirst.mockResolvedValue({
      months: 12,
      factor: new Prisma.Decimal('0.179238'),
      feePerInstallment: new Prisma.Decimal('100'),
      isActive: true,
    });

    const result = await service.preview({ productId: 'p1', provider: 'GFIN', months: 12 });
    expect(result.available).toBe(true);
    expect(result.monthlyPayment).toBeCloseTo(2923.00, 2);
    expect(result.downAmount).toBeCloseTo(4150, 2); // downAmountActual = 6750 - 2600
  });

  it('SECURITY: never leaks maxPrice, factor, seriesPattern in response', async () => {
    prisma.product.findUnique.mockResolvedValue({
      id: 'p1',
      installmentPrice: new Prisma.Decimal('19900'),
      prices: [],
      category: 'PHONE_USED',
      brand: 'Apple',
      model: 'iPhone 14 Pro',
      storage: '128GB',
      deletedAt: null,
    });
    prisma.gfinModelMapping.findMany.mockResolvedValue([
      {
        id: 'm1',
        gfinSeries: 'iPhone 14',
        gfinVariant: 'Pro',
        storage: '128GB',
        condition: 'HAND_2',
        maxPrice: new Prisma.Decimal('21500'),
        modelMatchPattern: 'iPhone 14 Pro',
        isActive: true,
      },
    ]);
    prisma.gfinOverpriceRule.findMany.mockResolvedValue([
      {
        id: 'r1',
        label: 'iPhone 14 มือ 2',
        seriesPattern: 'iPhone 14|iPhone 15',
        condition: 'HAND_2',
        allowance: new Prisma.Decimal('1000'),
        isActive: true,
      },
    ]);
    prisma.gfinRateFactor.findFirst.mockResolvedValue({
      months: 12,
      factor: new Prisma.Decimal('0.179238'),
      feePerInstallment: new Prisma.Decimal('100'),
      isActive: true,
    });

    const result = await service.preview({ productId: 'p1', provider: 'GFIN', months: 12 });
    const json = JSON.stringify(result);
    expect(json).not.toContain('21500');               // maxPrice
    expect(json).not.toContain('0.179238');            // factor
    expect(json).not.toContain('iPhone 14|iPhone 15'); // seriesPattern
    // gfinSubmitPrice IS exposed (22500 = 21500 + 1000) — that's fine, it's the customer-visible derived value
  });
});
