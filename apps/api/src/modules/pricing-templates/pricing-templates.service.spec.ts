import { CreatePricingTemplateDto } from './dto/pricing-template.dto';
import { PricingTemplatesService } from './pricing-templates.service';

describe('pricing templates by device origin', () => {
  const db = { pricingTemplate: { findFirst: jest.fn(), create: jest.fn(), upsert: jest.fn() } };
  const service = new PricingTemplatesService(db as never);
  beforeEach(() => jest.resetAllMocks());
  it('never falls back from imported to Thai or unspecified prices', async () => {
    db.pricingTemplate.findFirst.mockResolvedValue(null);
    expect(await service.lookup('Apple', 'iPhone 15', '128GB', 'PHONE_USED', false, 'IMPORTED')).toBeNull();
    expect(db.pricingTemplate.findFirst).toHaveBeenCalledTimes(2);
    for (const [args] of db.pricingTemplate.findFirst.mock.calls) expect(args.where.deviceOrigin).toBe('IMPORTED');
  });
  it('stores origin and keeps legacy imports unspecified', async () => {
    const item = { brand: 'Apple', model: 'iPhone 15', category: 'PHONE_NEW' as CreatePricingTemplateDto['category'], cashPrice: 20000, installmentBestchoicePrice: 22000, installmentFinancePrice: 21000 };
    await service.create({ ...item, deviceOrigin: 'THAI' });
    expect(db.pricingTemplate.create.mock.calls[0][0].data.deviceOrigin).toBe('THAI');
    await service.bulkImport([item, { ...item, deviceOrigin: 'IMPORTED' }]);
    expect(db.pricingTemplate.upsert.mock.calls.map(([args]) => args.where.brand_model_storage_category_hasWarranty_deviceOrigin.deviceOrigin)).toEqual(['UNSPECIFIED', 'IMPORTED']);
  });
});
