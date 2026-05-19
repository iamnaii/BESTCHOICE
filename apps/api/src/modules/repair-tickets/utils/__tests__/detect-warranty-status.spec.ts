import { detectWarrantyStatus, defaultPayer } from '../detect-warranty-status';

const daysAgo = (days: number) => new Date(Date.now() - days * 86400_000);
const daysAhead = (days: number) => new Date(Date.now() + days * 86400_000);

describe('detectWarrantyStatus', () => {
  it('returns WALK_IN when no contract and no product', () => {
    expect(detectWarrantyStatus({})).toBe('WALK_IN');
  });

  it('returns IN_7DAY_DEFECT when contract.deviceReceivedAt within 7 days', () => {
    expect(
      detectWarrantyStatus({
        contract: { deviceReceivedAt: daysAgo(3), shopWarrantyEndDate: daysAhead(57) },
      }),
    ).toBe('IN_7DAY_DEFECT');
  });

  it('returns IN_SHOP_WARRANTY when past 7 days but inside shop warranty', () => {
    expect(
      detectWarrantyStatus({
        contract: { deviceReceivedAt: daysAgo(20), shopWarrantyEndDate: daysAhead(40) },
      }),
    ).toBe('IN_SHOP_WARRANTY');
  });

  it('returns IN_MANUFACTURER when shop warranty expired but mfr active', () => {
    expect(
      detectWarrantyStatus({
        product: { warrantyExpireDate: daysAhead(100) },
      }),
    ).toBe('IN_MANUFACTURER');
  });

  it('returns IN_MANUFACTURER when contract present but shop expired and product mfr active', () => {
    expect(
      detectWarrantyStatus({
        contract: { deviceReceivedAt: daysAgo(100), shopWarrantyEndDate: daysAgo(40) },
        product: { warrantyExpireDate: daysAhead(50) },
      }),
    ).toBe('IN_MANUFACTURER');
  });

  it('returns OUT_OF_WARRANTY when all warranties expired', () => {
    expect(
      detectWarrantyStatus({
        contract: { deviceReceivedAt: daysAgo(100), shopWarrantyEndDate: daysAgo(40) },
        product: { warrantyExpireDate: daysAgo(10) },
      }),
    ).toBe('OUT_OF_WARRANTY');
  });

  it('handles null timestamps gracefully (no crash, returns OUT_OF_WARRANTY)', () => {
    expect(
      detectWarrantyStatus({
        contract: { deviceReceivedAt: null, shopWarrantyEndDate: null },
        product: { warrantyExpireDate: null },
      }),
    ).toBe('OUT_OF_WARRANTY');
  });
});

describe('defaultPayer', () => {
  it('returns CUSTOMER for OUT_OF_WARRANTY and WALK_IN', () => {
    expect(defaultPayer('OUT_OF_WARRANTY')).toBe('CUSTOMER');
    expect(defaultPayer('WALK_IN')).toBe('CUSTOMER');
  });

  it('returns SHOP for in-warranty cases', () => {
    expect(defaultPayer('IN_7DAY_DEFECT')).toBe('SHOP');
    expect(defaultPayer('IN_SHOP_WARRANTY')).toBe('SHOP');
    expect(defaultPayer('IN_MANUFACTURER')).toBe('SHOP');
  });
});
