import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { InstallmentPreviewService } from './installment-preview.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('InstallmentPreviewService', () => {
  let service: InstallmentPreviewService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      product: { findFirst: jest.fn() },
      interestConfig: { findFirst: jest.fn() },
      // #22: VAT ของตั้งค่าดอกเบี้ยอ่านจากบริษัท FINANCE (ไม่ใช่ interest_configs.vat_pct) — FINANCE จด VAT 7%
      companyInfo: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ vatRegistered: true, vatRate: new Prisma.Decimal('0.07') }),
      },
      gfinModelMapping: { findMany: jest.fn() },
      gfinOverpriceRule: { findMany: jest.fn() },
      gfinRateFactor: { findFirst: jest.fn() },
      // readBoolFlag('shop_hide_demo_products') reads this — most tests leave it unmocked
      // (undefined → readRawValue catches → default false, matches prod day-1).
      systemConfig: { findFirst: jest.fn() },
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
    prisma.product.findFirst.mockResolvedValue(null);
    const result = await service.preview({ productId: 'nope', provider: 'BC', months: 12 });
    expect(result.available).toBe(false);
    expect(result.reason).toBe('product_not_found');
  });

  it('returns available:false when no installment price set', async () => {
    prisma.product.findFirst.mockResolvedValue({
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

  it('sends the readiness fragment into the product lookup — quote ได้เฉพาะเครื่องที่พร้อมขายบนเว็บจริง', async () => {
    prisma.product.findFirst.mockResolvedValue(null);
    await service.preview({ productId: 'p1', provider: 'BC', months: 12 });
    expect(prisma.product.findFirst.mock.calls[0][0].where.AND).toEqual(
      expect.arrayContaining([{ cashPrice: { gt: 0 } }]),
    );
  });

  it('Fix round 1/5 (Important): กรอง [DEMO] เมื่อเปิด flag shop_hide_demo_products — quote ไม่ได้อีก (เดิม excludeDemo ตายตัว false)', async () => {
    prisma.systemConfig.findFirst.mockResolvedValue({ value: 'true' });
    prisma.product.findFirst.mockResolvedValue(null);
    const result = await service.preview({ productId: 'demo-1', provider: 'BC', months: 12 });
    expect(result.available).toBe(false);
    expect(result.reason).toBe('product_not_found');
    const where = prisma.product.findFirst.mock.calls[0][0].where;
    expect(where.AND).toContainEqual({ NOT: { name: { startsWith: '[DEMO]' } } });
  });

  it('BC: returns canonical worked example monthly payment 2,411.06', async () => {
    prisma.product.findFirst.mockResolvedValue({
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
    expect(result.monthlyPayment).toBeCloseTo(2411.06, 2);
    expect(result.downAmount).toBeCloseTo(3000, 2);
  });

  it('BC: ทุกคำตอบแนบงวดที่มีอัตรา (ตัวเลือกจำนวนงวดของเว็บ shop) — คิดได้และคิดไม่ได้', async () => {
    prisma.product.findFirst.mockResolvedValue({
      id: 'p1',
      installmentPrice: new Prisma.Decimal('25900'),
      prices: [],
      category: 'PHONE_NEW',
      brand: 'Apple',
      model: 'iPhone 15',
      storage: '128GB',
      deletedAt: null,
    });
    prisma.interestConfig.findFirst.mockResolvedValue({
      id: 'c1',
      minDownPaymentPct: new Prisma.Decimal('0.15'),
      storeCommissionPct: new Prisma.Decimal('0.10'),
      vatPct: new Prisma.Decimal('0.07'),
      minInstallmentMonths: 10,
      maxInstallmentMonths: 12,
      interestRate: new Prisma.Decimal('0.05'),
      rates: [
        { months: 10, ratePct: new Prisma.Decimal('0.50'), deletedAt: null },
        { months: 12, ratePct: new Prisma.Decimal('0.50'), deletedAt: null },
      ],
    });
    const ok = await service.preview({ productId: 'p1', provider: 'BC', months: 12 });
    expect(ok).toMatchObject({ available: true, allowedMonths: [10, 12], monthlyPayment: 3138.66 });
    const bad = await service.preview({ productId: 'p1', provider: 'BC', months: 6 });
    expect(bad).toMatchObject({ available: false, reason: 'invalid', allowedMonths: [10, 12] });
  });

  it('GFIN: returns canonical worked example monthly payment 2,923.00', async () => {
    prisma.product.findFirst.mockResolvedValue({
      id: 'p1',
      installmentPrice: new Prisma.Decimal('19900'),
      prices: [],
      category: 'PHONE_USED',
      brand: 'Apple',
      model: 'iPhone 14 Pro',
      storage: '128GB',
      deviceOrigin: 'THAI',
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
      shopCommissionPct: 15,
      factor: new Prisma.Decimal('0.179238'),
      feePerInstallment: new Prisma.Decimal('100'),
      isActive: true,
    });

    // ดาวน์ 30% ตรงตัวอย่างเดิม (ค่าตั้งค่า gfin.minDownPct ใน system_config = 30)
    prisma.systemConfig.findFirst.mockImplementation(({ where }: { where: { key: string } }) =>
      Promise.resolve(where.key === 'gfin.minDownPct' ? { value: '30' } : null),
    );

    const result = await service.preview({ productId: 'p1', provider: 'GFIN', months: 12 });
    expect(result.available).toBe(true);
    expect(result.monthlyPayment).toBeCloseTo(2923.00, 2);
    expect(result.downAmount).toBeCloseTo(4200, 2); // downAmountActual = 6750 − 2600 = 4150 → ปัดขึ้นหลักร้อย
    // เรทถูกเลือกด้วยคู่ (งวด, %คอมตามหมวด) — มือถือ = 15
    expect(prisma.gfinRateFactor.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ months: 12, shopCommissionPct: 15 }),
      }),
    );
  });

  it.each([
    ['IMPORTED' as const, 'เครื่องนอก'],
    [null, 'ยังไม่ระบุที่มา (คิดแบบเครื่องนอกไว้ก่อน)'],
  ])('GFIN: %s → OVER ครึ่งเดียว (%s)', async (deviceOrigin, _label) => {
    prisma.product.findFirst.mockResolvedValue({
      id: 'p1',
      installmentPrice: new Prisma.Decimal('19900'),
      prices: [],
      category: 'PHONE_USED',
      brand: 'Apple',
      model: 'iPhone 14 Pro',
      storage: '128GB',
      deviceOrigin,
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
      shopCommissionPct: 15,
      factor: new Prisma.Decimal('0.179238'),
      feePerInstallment: new Prisma.Decimal('100'),
      isActive: true,
    });
    prisma.systemConfig.findFirst.mockImplementation(({ where }: { where: { key: string } }) =>
      Promise.resolve(where.key === 'gfin.minDownPct' ? { value: '30' } : null),
    );

    const result = await service.preview({ productId: 'p1', provider: 'GFIN', months: 12 });
    // ราคาส่ง 21,500 + OVER 500 = 22,000 → ดาวน์ตามสูตร 6,600 → ยอดจัด 15,400
    expect(result.gfinSubmitPrice).toBe(22000);
    expect(result.financedAmount).toBe(15400);
    expect(result.monthlyPayment).toBe(2861); // ceil(15,400 × 0.179238) + 100
    expect(result.downAmount).toBe(4500); // 6,600 − (22,000 − 19,900)
  });

  it('GFIN: iPad (TABLET) ใช้เรทของคอม 5% และแมปเป็นมือ 1', async () => {
    prisma.product.findFirst.mockResolvedValue({
      id: 't1',
      installmentPrice: new Prisma.Decimal('12000'),
      prices: [],
      category: 'TABLET',
      brand: 'Apple',
      model: 'iPad 10',
      storage: '64GB',
      deletedAt: null,
    });
    prisma.gfinModelMapping.findMany.mockResolvedValue([
      {
        id: 'mt',
        gfinSeries: 'iPad 10',
        gfinVariant: null,
        storage: '64GB',
        condition: 'HAND_1',
        maxPrice: new Prisma.Decimal('12000'),
        modelMatchPattern: 'iPad 10',
        isActive: true,
      },
    ]);
    prisma.gfinOverpriceRule.findMany.mockResolvedValue([]);
    prisma.gfinRateFactor.findFirst.mockResolvedValue({
      months: 12,
      shopCommissionPct: 5,
      factor: new Prisma.Decimal('0.179238'),
      feePerInstallment: new Prisma.Decimal('100'),
      isActive: true,
    });

    const result = await service.preview({ productId: 't1', provider: 'GFIN', months: 12 });
    expect(result.available).toBe(true);
    expect(prisma.gfinRateFactor.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ months: 12, shopCommissionPct: 5 }),
      }),
    );
  });

  it('GFIN: งวดเกินเพดานของซีรีส์ (maxMonths) → available:false reason months_over_max', async () => {
    prisma.product.findFirst.mockResolvedValue({
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
        maxMonths: 12,
        isActive: true,
      },
    ]);
    prisma.gfinRateFactor.findFirst.mockResolvedValue({
      months: 15,
      shopCommissionPct: 15,
      factor: new Prisma.Decimal('0.1467'),
      feePerInstallment: new Prisma.Decimal('100'),
      isActive: true,
    });

    const result = await service.preview({ productId: 'p1', provider: 'GFIN', months: 15 });
    expect(result.available).toBe(false);
    expect(result.reason).toBe('months_over_max');
  });

  it('SECURITY: never leaks maxPrice, factor, seriesPattern in response', async () => {
    prisma.product.findFirst.mockResolvedValue({
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
      shopCommissionPct: 15,
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

  describe('GFIN: ดาวน์ขั้นต่ำตามกติกา OVER (สเปค 3.3 / 4.3)', () => {
    // iPhone 14 Pro 128GB มือ 2 เครื่องไทย: ราคาส่ง 21,500 + OVER 1,000 = 22,500 · ราคาผ่อน 19,900 → ส่วนลดดาวน์ 2,600
    function mockIphone14Pro(ruleMinDownPct: number | null) {
      prisma.systemConfig.findFirst.mockResolvedValue(null); // ค่าตั้ง gfin.minDownPct = ค่าเริ่ม 25
      prisma.product.findFirst.mockResolvedValue({
        id: 'p1',
        installmentPrice: new Prisma.Decimal('19900'),
        prices: [],
        category: 'PHONE_USED',
        brand: 'Apple',
        model: 'iPhone 14 Pro',
        storage: '128GB',
        deviceOrigin: 'THAI',
        deletedAt: null,
      });
      prisma.gfinModelMapping.findMany.mockResolvedValue([
        {
          id: 'm1',
          gfinSeries: 'iPhone 14 Pro',
          gfinVariant: null,
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
          label: 'iPhone 14 Pro มือ 2',
          seriesPattern: 'iPhone 14 Pro',
          condition: 'HAND_2',
          allowance: new Prisma.Decimal('1000'),
          maxMonths: 12,
          minDownPct: ruleMinDownPct,
          isActive: true,
        },
      ]);
      prisma.gfinRateFactor.findFirst.mockResolvedValue({
        months: 12,
        shopCommissionPct: 15,
        factor: new Prisma.Decimal('0.179238'),
        feePerInstallment: new Prisma.Decimal('100'),
        isActive: true,
      });
    }

    it('กติกาตั้ง 30% ชนะค่าตั้ง 25%: 6,750 − 2,600 = 4,150 → 4,200 · ยอดจัด 15,750 · 2,923', async () => {
      mockIphone14Pro(30);
      const result = await service.preview({ productId: 'p1', provider: 'GFIN', months: 12 });
      expect(result.available).toBe(true);
      expect(result.downAmount).toBe(4200);
      expect(result.financedAmount).toBe(15750);
      expect(result.monthlyPayment).toBe(2923);
    });

    it('กติกาไม่ตั้ง → ค่าตั้ง 25%: 5,625 − 2,600 = 3,025 → 3,100 · ยอดจัด 16,875 · 3,125', async () => {
      mockIphone14Pro(null);
      const result = await service.preview({ productId: 'p1', provider: 'GFIN', months: 12 });
      expect(result.downAmount).toBe(3100);
      expect(result.financedAmount).toBe(16875);
      expect(result.monthlyPayment).toBe(3125);
    });

    it('เว็บ shop ส่ง 15% (ดาวน์เรท 1) → ยกขึ้นเป็นขั้นต่ำของรุ่น 30%', async () => {
      mockIphone14Pro(30);
      const result = await service.preview({ productId: 'p1', provider: 'GFIN', months: 12, downPct: 0.15 });
      expect(result.downAmount).toBe(4200);
      expect(result.monthlyPayment).toBe(2923);
    });

    it('ส่ง % สูงกว่าขั้นต่ำ (40%) → ใช้ตามที่ส่ง: 9,000 − 2,600 = 6,400 · ยอดจัด 13,500 · 2,520', async () => {
      mockIphone14Pro(30);
      const result = await service.preview({ productId: 'p1', provider: 'GFIN', months: 12, downPct: 0.4 });
      expect(result.downAmount).toBe(6400);
      expect(result.financedAmount).toBe(13500);
      expect(result.monthlyPayment).toBe(2520);
    });
  });
});
