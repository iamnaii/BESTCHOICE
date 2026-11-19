import { CreatePricingTemplateDto } from './dto/pricing-template.dto';
import { PricingTemplatesService } from './pricing-templates.service';

describe('pricing templates by device origin', () => {
  const db = {
    $transaction: jest.fn(),
    $queryRaw: jest.fn(),
    $executeRaw: jest.fn(),
    pricingTemplate: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      upsert: jest.fn(),
    },
  };
  const service = new PricingTemplatesService(db as never);
  beforeEach(() => {
    jest.resetAllMocks();
    db.$transaction.mockImplementation((work) => work(db));
  });
  it('เครื่องนอกไม่มีแถวของตัวเอง → ถอยไปแถว "ไม่ระบุ" แต่ไม่ข้ามไปเครื่องไทย (สเปค 7.1)', async () => {
    db.pricingTemplate.findFirst.mockResolvedValue(null);
    expect(
      await service.lookup('Apple', 'iPhone 15', '128GB', 'PHONE_USED', false, 'IMPORTED'),
    ).toBeNull();
    expect(
      db.pricingTemplate.findFirst.mock.calls.map(([args]) => [args.where.deviceOrigin, args.where.storage]),
    ).toEqual([
      ['IMPORTED', '128GB'],
      ['IMPORTED', ''],
      ['UNSPECIFIED', '128GB'],
      ['UNSPECIFIED', ''],
    ]);
  });

  it('เครื่องไทยไม่มีแถวของตัวเอง → คืนแถว "ไม่ระบุ"', async () => {
    const unspecified = { id: 'u1', deviceOrigin: 'UNSPECIFIED' };
    db.pricingTemplate.findFirst.mockImplementation(async ({ where }) =>
      where.deviceOrigin === 'UNSPECIFIED' && where.storage === '128GB' ? unspecified : null,
    );
    expect(await service.lookup('Apple', 'iPhone 15', '128GB', 'PHONE_NEW', null, 'THAI')).toBe(
      unspecified,
    );
  });

  it('ขอแถว "ไม่ระบุ" ตรง ๆ → ไม่ค้นแถวของเครื่องไทย/นอก', async () => {
    db.pricingTemplate.findFirst.mockResolvedValue(null);
    await service.lookup('Apple', 'iPhone 15', null, 'PHONE_NEW', null);
    expect(db.pricingTemplate.findFirst.mock.calls.map(([args]) => args.where.deviceOrigin)).toEqual([
      'UNSPECIFIED',
    ]);
  });

  it('stores origin and keeps legacy imports unspecified', async () => {
    const item = {
      brand: 'Apple',
      model: 'iPhone 15',
      category: 'PHONE_NEW' as CreatePricingTemplateDto['category'],
      cashPrice: 20000,
      installmentBestchoicePrice: 22000,
      installmentFinancePrice: 21000,
    };
    await service.create({ ...item, deviceOrigin: 'THAI' });
    expect(db.pricingTemplate.create.mock.calls[0][0].data.deviceOrigin).toBe('THAI');
    await service.bulkImport([item, { ...item, deviceOrigin: 'IMPORTED' }]);
    expect(
      db.pricingTemplate.upsert.mock.calls.map(
        ([args]) => args.where.brand_model_storage_category_hasWarranty_deviceOrigin.deviceOrigin,
      ),
    ).toEqual(['UNSPECIFIED', 'IMPORTED']);
  });
});
