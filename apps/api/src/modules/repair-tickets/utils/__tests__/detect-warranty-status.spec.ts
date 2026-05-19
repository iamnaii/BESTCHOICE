import { detectWarrantyStatus, defaultPayer } from '../detect-warranty-status';

const daysAgo = (days: number) => new Date(Date.now() - days * 86400_000);
const daysAhead = (days: number) => new Date(Date.now() + days * 86400_000);

/** Returns a Date that is exactly N BKK calendar days ago at BKK midnight.
 * Used to test the BKK-day boundary precisely. */
function bkkDaysAgo(n: number): Date {
  // Get BKK "today" at midnight
  const now = new Date();
  const bkkNow = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  const bkkMidnight = new Date(
    Date.UTC(bkkNow.getUTCFullYear(), bkkNow.getUTCMonth(), bkkNow.getUTCDate()),
  );
  // Subtract n days
  return new Date(bkkMidnight.getTime() - n * 86400_000 - 7 * 60 * 60 * 1000);
}

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

  // W8: BKK calendar-day boundary tests
  it('W8: device received exactly 7 BKK calendar days ago → still IN_7DAY_DEFECT', () => {
    expect(
      detectWarrantyStatus({
        contract: { deviceReceivedAt: bkkDaysAgo(7), shopWarrantyEndDate: null },
      }),
    ).toBe('IN_7DAY_DEFECT');
  });

  it('W8: device received 8 BKK calendar days ago → NOT IN_7DAY_DEFECT (falls to OUT_OF_WARRANTY)', () => {
    expect(
      detectWarrantyStatus({
        contract: { deviceReceivedAt: bkkDaysAgo(8), shopWarrantyEndDate: null },
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
