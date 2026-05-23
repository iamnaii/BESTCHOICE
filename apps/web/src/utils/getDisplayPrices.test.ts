import { describe, it, expect } from 'vitest';
import { getDisplayPrices } from './getDisplayPrices';

describe('getDisplayPrices', () => {
  it('prefers product.cashPrice/installmentPrice when set', () => {
    const out = getDisplayPrices({
      cashPrice: '20900',
      installmentPrice: '19900',
      prices: [],
    });
    expect(out.cash).toBe(20900);
    expect(out.installment).toBe(19900);
  });

  it('falls back to ProductPrice array by label when fields null', () => {
    const out = getDisplayPrices({
      cashPrice: null,
      installmentPrice: null,
      prices: [
        { label: 'ราคาเงินสด', amount: '20900', isDefault: false },
        { label: 'ราคาผ่อน BESTCHOICE', amount: '19900', isDefault: true },
      ],
    });
    expect(out.cash).toBe(20900);
    expect(out.installment).toBe(19900);
  });

  it('returns null cash/installment when neither field nor matching label present', () => {
    const out = getDisplayPrices({
      cashPrice: null,
      installmentPrice: null,
      prices: [{ label: 'DEFAULT', amount: '17000', isDefault: true }],
    });
    expect(out.cash).toBeNull();
    expect(out.installment).toBeNull();
  });

  it('falls back to prefix match on label', () => {
    const out = getDisplayPrices({
      cashPrice: null,
      installmentPrice: null,
      prices: [{ label: 'ราคาผ่อน BC ลด 200', amount: '19700', isDefault: false }],
    });
    expect(out.installment).toBe(19700);
  });
});
