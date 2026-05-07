import { Test } from '@nestjs/testing';
import { Decimal } from '@prisma/client/runtime/library';
import { StickersService } from './stickers.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('StickersService.getStickerData', () => {
  let service: StickersService;
  let prisma: {
    product: { findFirst: jest.Mock };
    pricingTemplate: { findFirst: jest.Mock };
    systemConfig: { findMany: jest.Mock };
    companyInfo: { findFirst: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      product: { findFirst: jest.fn() },
      pricingTemplate: { findFirst: jest.fn() },
      systemConfig: { findMany: jest.fn() },
      companyInfo: { findFirst: jest.fn() },
    };
    const moduleRef = await Test.createTestingModule({
      providers: [StickersService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(StickersService);
  });

  const baseProduct = {
    id: 'product-1',
    brand: 'Apple',
    model: 'iPhone 15 Pro Max',
    color: 'ดำ',
    storage: '256GB',
    batteryHealth: 95,
    warrantyExpireDate: new Date('2027-05-22'),
    warrantyExpired: false,
    imeiSerial: '359123456789012',
    category: 'PHONE_NEW' as const,
    branch: { name: 'สาขาลาดพร้าว' },
    inspection: null,
  };

  const defaultConfigs = [
    { key: 'sticker.rate1.defaultDown', value: '0' },
    { key: 'sticker.rate1.defaultTerm', value: '24' },
    { key: 'sticker.rate2.defaultDown', value: '0' },
    { key: 'sticker.rate2.defaultTerm', value: '12' },
  ];

  const fullPricingTemplate = {
    cashPrice: new Decimal(35900),
    installmentBestchoicePrice: new Decimal(1500),
    installmentFinancePrice: new Decimal(1800),
    rate1DownPayment: null,
    rate1TermMonths: null,
    rate2DownPayment: null,
    rate2TermMonths: null,
    hasWarranty: false,
  };

  it('returns full sticker data with PricingTemplate match using SystemConfig fallbacks', async () => {
    prisma.product.findFirst.mockResolvedValue(baseProduct);
    prisma.pricingTemplate.findFirst.mockResolvedValue(fullPricingTemplate);
    prisma.systemConfig.findMany.mockResolvedValue(defaultConfigs);
    prisma.companyInfo.findFirst.mockResolvedValue({ logoUrl: 'https://cdn/logo.png' });

    const result = await service.getStickerData('product-1');

    expect(result).toMatchObject({
      productId: 'product-1',
      brand: 'Apple',
      model: 'iPhone 15 Pro Max',
      color: 'ดำ',
      storage: '256GB',
      batteryHealth: 95,
      warrantyExpireDate: '2027-05-22',
      imei: '359123456789012',
      cashPrice: 35900,
      rate1: { downPayment: 0, monthlyPrice: 1500, termMonths: 24 },
      rate2: { downPayment: 0, monthlyPrice: 1800, termMonths: 12 },
      shopLogoUrl: 'https://cdn/logo.png',
    });
  });

  it('uses PricingTemplate rate overrides when set (not fallback)', async () => {
    prisma.product.findFirst.mockResolvedValue(baseProduct);
    prisma.pricingTemplate.findFirst.mockResolvedValue({
      ...fullPricingTemplate,
      rate1DownPayment: new Decimal(2000),
      rate1TermMonths: 36,
    });
    prisma.systemConfig.findMany.mockResolvedValue(defaultConfigs);
    prisma.companyInfo.findFirst.mockResolvedValue(null);

    const result = await service.getStickerData('product-1');

    expect(result.rate1).toEqual({ downPayment: 2000, monthlyPrice: 1500, termMonths: 36 });
    expect(result.rate2).toEqual({ downPayment: 0, monthlyPrice: 1800, termMonths: 12 });
  });

  it('hides cashPrice + rates when no PricingTemplate matches', async () => {
    prisma.product.findFirst.mockResolvedValue(baseProduct);
    prisma.pricingTemplate.findFirst.mockResolvedValue(null);
    prisma.systemConfig.findMany.mockResolvedValue(defaultConfigs);
    prisma.companyInfo.findFirst.mockResolvedValue(null);

    const result = await service.getStickerData('product-1');

    expect(result.cashPrice).toBeNull();
    expect(result.rate1).toBeNull();
    expect(result.rate2).toBeNull();
    expect(result.brand).toBe('Apple');
  });

  it('returns null for warrantyExpireDate when warrantyExpired = true', async () => {
    prisma.product.findFirst.mockResolvedValue({ ...baseProduct, warrantyExpired: true });
    prisma.pricingTemplate.findFirst.mockResolvedValue(fullPricingTemplate);
    prisma.systemConfig.findMany.mockResolvedValue(defaultConfigs);
    prisma.companyInfo.findFirst.mockResolvedValue(null);

    const result = await service.getStickerData('product-1');

    expect(result.warrantyExpireDate).toBeNull();
  });

  it('returns null for warrantyExpireDate when expire date is in the past', async () => {
    prisma.product.findFirst.mockResolvedValue({
      ...baseProduct,
      warrantyExpireDate: new Date('2024-01-01'),
      warrantyExpired: false,
    });
    prisma.pricingTemplate.findFirst.mockResolvedValue(fullPricingTemplate);
    prisma.systemConfig.findMany.mockResolvedValue(defaultConfigs);
    prisma.companyInfo.findFirst.mockResolvedValue(null);

    const result = await service.getStickerData('product-1');

    expect(result.warrantyExpireDate).toBeNull();
  });

  it('returns null fields for missing battery/IMEI/color/storage', async () => {
    prisma.product.findFirst.mockResolvedValue({
      ...baseProduct,
      color: null,
      storage: null,
      batteryHealth: null,
      imeiSerial: null,
    });
    prisma.pricingTemplate.findFirst.mockResolvedValue(fullPricingTemplate);
    prisma.systemConfig.findMany.mockResolvedValue(defaultConfigs);
    prisma.companyInfo.findFirst.mockResolvedValue(null);

    const result = await service.getStickerData('product-1');

    expect(result.color).toBeNull();
    expect(result.storage).toBeNull();
    expect(result.batteryHealth).toBeNull();
    expect(result.imei).toBeNull();
  });

  it('throws NotFoundException when product not found', async () => {
    prisma.product.findFirst.mockResolvedValue(null);
    await expect(service.getStickerData('missing-id')).rejects.toThrow('ไม่พบสินค้า');
  });

  it('queries PricingTemplate with hasWarranty=true for PHONE_USED with active warranty', async () => {
    const futureDate = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
    prisma.product.findFirst.mockResolvedValue({
      ...baseProduct,
      category: 'PHONE_USED',
      warrantyExpireDate: futureDate,
      warrantyExpired: false,
    });
    prisma.pricingTemplate.findFirst.mockResolvedValue(fullPricingTemplate);
    prisma.systemConfig.findMany.mockResolvedValue(defaultConfigs);
    prisma.companyInfo.findFirst.mockResolvedValue(null);

    await service.getStickerData('product-1');

    expect(prisma.pricingTemplate.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ hasWarranty: true, category: 'PHONE_USED' }),
      }),
    );
  });

  it('queries PricingTemplate with hasWarranty=false for PHONE_USED with expired warranty', async () => {
    prisma.product.findFirst.mockResolvedValue({
      ...baseProduct,
      category: 'PHONE_USED',
      warrantyExpireDate: new Date('2024-01-01'),
      warrantyExpired: true,
    });
    prisma.pricingTemplate.findFirst.mockResolvedValue(fullPricingTemplate);
    prisma.systemConfig.findMany.mockResolvedValue(defaultConfigs);
    prisma.companyInfo.findFirst.mockResolvedValue(null);

    await service.getStickerData('product-1');

    expect(prisma.pricingTemplate.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ hasWarranty: false, category: 'PHONE_USED' }),
      }),
    );
  });

  it('queries Product with deletedAt: null filter (excludes soft-deleted)', async () => {
    prisma.product.findFirst.mockResolvedValue(baseProduct);
    prisma.pricingTemplate.findFirst.mockResolvedValue(null);
    prisma.systemConfig.findMany.mockResolvedValue(defaultConfigs);
    prisma.companyInfo.findFirst.mockResolvedValue(null);

    await service.getStickerData('product-1');

    expect(prisma.product.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'product-1', deletedAt: null }),
      }),
    );
  });
});

describe('StickersService.getStickerDataBatch', () => {
  let service: StickersService;
  let prisma: {
    product: { findFirst: jest.Mock };
    pricingTemplate: { findFirst: jest.Mock };
    systemConfig: { findMany: jest.Mock };
    companyInfo: { findFirst: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      product: { findFirst: jest.fn() },
      pricingTemplate: { findFirst: jest.fn() },
      systemConfig: { findMany: jest.fn() },
      companyInfo: { findFirst: jest.fn() },
    };
    const moduleRef = await Test.createTestingModule({
      providers: [StickersService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(StickersService);
  });

  it('returns array of sticker data for given product ids, skipping missing', async () => {
    prisma.systemConfig.findMany.mockResolvedValue([
      { key: 'sticker.rate1.defaultDown', value: '0' },
      { key: 'sticker.rate1.defaultTerm', value: '24' },
      { key: 'sticker.rate2.defaultDown', value: '0' },
      { key: 'sticker.rate2.defaultTerm', value: '12' },
    ]);
    prisma.companyInfo.findFirst.mockResolvedValue(null);
    prisma.product.findFirst.mockImplementation(({ where: { id } }) => {
      if (id === 'p1') {
        return Promise.resolve({
          id: 'p1',
          brand: 'Apple',
          model: 'iPhone 15',
          color: null,
          storage: null,
          batteryHealth: null,
          warrantyExpireDate: null,
          warrantyExpired: null,
          imeiSerial: null,
          category: 'PHONE_NEW',
          branch: { name: 'X' },
          inspection: null,
        });
      }
      return Promise.resolve(null); // p2 missing
    });
    prisma.pricingTemplate.findFirst.mockResolvedValue(null);

    const result = await service.getStickerDataBatch(['p1', 'p2']);
    expect(result).toHaveLength(1);
    expect(result[0].productId).toBe('p1');
  });
});
