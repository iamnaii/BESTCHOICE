import { WarrantyService } from '../warranty.service';

describe('warranty activation snapshot', () => {
  const db = { contract: { findUnique: jest.fn(), update: jest.fn() }, systemConfig: { findFirst: jest.fn() } };
  const service = new WarrantyService(db as never);
  beforeEach(() => jest.resetAllMocks());
  it.each([0, 15])('uses captured %s days even if the product and standard have changed', async days => {
    db.contract.findUnique.mockResolvedValue({
      createdAt: new Date('2026-09-01T00:00:00Z'),
      product: { category: 'PHONE_USED', shopWarrantyDays: 90 },
      productDisclosure: { version: 1, deviceOrigin: 'IMPORTED', shopWarrantyDays: days, warrantyTerms: null },
    });
    await service.setShopWarranty('c1');
    expect(db.systemConfig.findFirst).not.toHaveBeenCalled();
    if (days === 0) expect(db.contract.update).not.toHaveBeenCalled();
    else expect(db.contract.update).toHaveBeenCalledWith({ where: { id: 'c1' }, data: { shopWarrantyStartDate: new Date('2026-09-01T00:00:00Z'), shopWarrantyEndDate: new Date('2026-09-16T00:00:00Z') } });
  });
  it('does not overwrite an existing warranty period on repeat activation', async () => {
    db.contract.findUnique.mockResolvedValue({ product: { category: 'PHONE_USED' }, shopWarrantyEndDate: new Date() });
    await service.setShopWarranty('c1');
    expect(db.contract.update).not.toHaveBeenCalled();
  });
});
