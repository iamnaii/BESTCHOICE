import { AfterSalesLookupService } from '../services/after-sales-lookup.service';

describe('AfterSalesLookupService.lookup', () => {
  const repair = { lookupByImei: jest.fn() };
  const defect = { checkEligibility: jest.fn() };
  const photos = { getPhotos: jest.fn().mockResolvedValue({ applicable: false }) };
  const prisma = { afterSalesCase: { findFirst: jest.fn().mockResolvedValue(null) } };

  const svc = new AfterSalesLookupService(
    prisma as never,
    repair as never,
    defect as never,
    photos as never,
  );
  const user = { id: 'user-1', role: 'SALES', branchId: 'branch-1' };

  beforeEach(() => {
    jest.clearAllMocks();
    photos.getPhotos.mockResolvedValue({ applicable: false });
    prisma.afterSalesCase.findFirst.mockResolvedValue(null);
  });

  it('ไม่พบ IMEI → source WALK_IN ทางออกเดียว (REPAIR) ไม่เรียก checkEligibility/getPhotos', async () => {
    repair.lookupByImei.mockResolvedValue({ found: false });

    const result = await svc.lookup({ imei: '000000000000000' }, user);

    expect(result.found).toBe(false);
    expect(result.source).toBe('WALK_IN');
    expect(result.warranty.status).toBe('WALK_IN');
    expect(result.outcomes).toHaveLength(1);
    expect(result.outcomes[0].outcome).toBe('REPAIR');
    expect(defect.checkEligibility).not.toHaveBeenCalled();
    expect(photos.getPhotos).not.toHaveBeenCalled();
  });

  it('พบ+มีสัญญา → เรียก checkEligibility และ getPhotos แล้วได้ 3 ทางออก', async () => {
    repair.lookupByImei.mockResolvedValue({
      found: true,
      product: {
        id: 'product-1',
        brand: 'Apple',
        model: 'iPhone 13',
        storage: '128GB',
        imeiSerial: '359123456789012',
        category: 'PHONE_USED',
      },
      sale: null,
      customer: { id: 'customer-1', name: 'คุณทดสอบ', phone: '0812345678' },
      contract: { id: 'contract-1', contractNumber: 'CT-0001', status: 'ACTIVE' },
      warrantyStatus: 'IN_7DAY_DEFECT',
      daysRemainingIn7Day: 2,
      purchasedAt: new Date('2026-09-20T00:00:00.000Z'),
      shopWarrantyEndDate: null,
      manufacturerWarrantyEndDate: null,
    });
    defect.checkEligibility.mockResolvedValue({ eligible: true, reasons: [] });

    const result = await svc.lookup({ imei: '359123456789012' }, user);

    expect(result.source).toBe('INSTALLMENT_CONTRACT');
    expect(result.warranty.status).toBe('IN_7DAY_DEFECT');
    expect(result.outcomes).toHaveLength(3);
    expect(result.outcomes.map((o) => o.outcome)).toEqual([
      'REPAIR',
      'SAME_MODEL_EXCHANGE',
      'PRICED_EXCHANGE',
    ]);
    expect(defect.checkEligibility).toHaveBeenCalledWith('contract-1');
    expect(photos.getPhotos).toHaveBeenCalledWith('product-1');
  });

  it('พบเครื่องแต่ไม่มี sale/contract → source WALK_IN และ warranty.status=WALK_IN แม้ lookupByImei คืนสถานะอื่น', async () => {
    repair.lookupByImei.mockResolvedValue({
      found: true,
      product: {
        id: 'product-2',
        brand: 'Samsung',
        model: 'Galaxy S21',
        storage: '256GB',
        imeiSerial: '359000111222333',
        category: 'PHONE_USED',
      },
      sale: null,
      customer: null,
      contract: null,
      // detectWarrantyStatus คืนค่านี้เพราะ product ที่พบทำให้เงื่อนไข walk-in ของมันไม่เข้า —
      // service ต้อง override เป็น WALK_IN เอง (Review Focus 1)
      warrantyStatus: 'OUT_OF_WARRANTY',
      daysRemainingIn7Day: 0,
      purchasedAt: null,
      shopWarrantyEndDate: null,
      manufacturerWarrantyEndDate: null,
    });

    const result = await svc.lookup({ imei: '359000111222333' }, user);

    expect(result.source).toBe('WALK_IN');
    expect(result.warranty.status).toBe('WALK_IN');
    expect(result.outcomes).toHaveLength(1);
    expect(result.outcomes[0].outcome).toBe('REPAIR');
    expect(defect.checkEligibility).not.toHaveBeenCalled();
    expect(photos.getPhotos).toHaveBeenCalledWith('product-2');
  });
});
