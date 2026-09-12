import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useState } from 'react';
import { useContractCalculation } from './useContractCalculation';
import type { Product, InterestConfig } from '../types';

// Editable defaults only; financial quote cases live in ContractQuoteService and ContractQuoteFlow.

const makeProduct = (price: number): Product =>
  ({
    id: 'p1',
    name: 'iPhone 15',
    brand: 'Apple',
    model: '15',
    prices: [
      { label: 'ราคาผ่อน BESTCHOICE', amount: String(price), isDefault: true },
    ],
  }) as unknown as Product;

const makeConfig = (overrides: Partial<InterestConfig> = {}): InterestConfig =>
  ({
    interestRate: '0.015', // 1.5%/เดือน flat
    minDownPaymentPct: '0.20',
    storeCommissionPct: '0.10',
    vatPct: '0.07',
    minInstallmentMonths: 6,
    maxInstallmentMonths: 24,
    ...overrides,
  }) as unknown as InterestConfig;

/**
 * Wrapper that lets tests pass plain values + observe outputs without
 * having to hand-roll setState wiring inside every test.
 */
function setupHook(opts: {
  product: Product | null;
  config?: InterestConfig | null;
  initialDownPayment?: number;
  initialMonths?: number;
  tradeInBaseAmount?: number;
  tradeInBonusAmount?: number;
}) {
  return renderHook(() => {
    const [downPayment, setDownPayment] = useState(opts.initialDownPayment ?? 0);
    const [totalMonths, setTotalMonths] = useState(opts.initialMonths ?? 12);
    const calc = useContractCalculation({
      tradeInBaseAmount: opts.tradeInBaseAmount,
      tradeInBonusAmount: opts.tradeInBonusAmount,
      selectedProduct: opts.product,
      interestConfig: opts.config ?? null,
      posConfig: undefined,
      downPayment,
      setDownPayment,
      totalMonths,
      setTotalMonths,
    });
    return { ...calc, downPayment, totalMonths, setDownPayment, setTotalMonths };
  });
}

describe('useContractCalculation', () => {
  it('separates a trade-in bonus discount from tender and additional cash', () => {
    const { result } = setupHook({ product: makeProduct(15000), config: makeConfig(),
      tradeInBaseAmount: 5000, tradeInBonusAmount: 500 });
    expect(result.current.downPayment).toBe(0);
    act(() => { result.current.setDownPaymentTouched(true); result.current.setDownPayment(2000); });
    expect(result.current.grossSellingPrice).toBe(15000);
    expect(result.current.sellingPrice).toBe(14500);
    expect(result.current.totalDownPayment).toBe(7000);
  });

  it('collects only the cash missing from the minimum total down payment', () => {
    const { result } = setupHook({ product: makeProduct(15000), config: makeConfig(),
      tradeInBaseAmount: 1000, tradeInBonusAmount: 500 });
    expect(result.current.downPayment).toBe(1900);
    expect(result.current.totalDownPayment).toBe(2900);
  });
  describe('selling price extraction', () => {
    it('returns 0 when no product is selected', () => {
      const { result } = setupHook({ product: null });
      expect(result.current.sellingPrice).toBe(0);
    });

    it('uses "ราคาผ่อน BESTCHOICE" price when present', () => {
      const product = {
        id: 'p1',
        name: 'iPhone',
        brand: 'Apple',
        model: '15',
        prices: [
          { label: 'ราคาเงินสด', amount: '20000', isDefault: false },
          { label: 'ราคาผ่อน BESTCHOICE', amount: '25000', isDefault: false },
        ],
      } as unknown as Product;
      const { result } = setupHook({ product });
      expect(result.current.sellingPrice).toBe(25000);
    });

    it('falls back to default price when no installment price is set', () => {
      const product = {
        id: 'p1',
        name: 'iPhone',
        brand: 'Apple',
        model: '15',
        prices: [
          { label: 'ราคาขาย', amount: '18000', isDefault: true },
        ],
      } as unknown as Product;
      const { result } = setupHook({ product });
      expect(result.current.sellingPrice).toBe(18000);
    });
  });

  describe('config defaults', () => {
    it('falls back to posConfig when interestConfig is null', () => {
      const { result } = renderHook(() => {
        const [downPayment, setDownPayment] = useState(0);
        const [totalMonths, setTotalMonths] = useState(12);
        return useContractCalculation({
          selectedProduct: makeProduct(20000),
          interestConfig: null,
          posConfig: {
            interestRate: 0.02,
            minDownPaymentPct: 0.25,
            storeCommissionPct: 0.05,
            vatPct: 0.07,
            minInstallmentMonths: 6,
            maxInstallmentMonths: 12,
          },
          downPayment,
          setDownPayment,
          totalMonths,
          setTotalMonths,
        });
      });
      expect(result.current.interestRate).toBe(0.02);
      expect(result.current.storeCommPct).toBe(0.05);
      expect(result.current.minDownPct).toBe(0.25);
    });

    it('falls back to hard-coded defaults when both config sources are missing', () => {
      const { result } = renderHook(() => {
        const [downPayment, setDownPayment] = useState(0);
        const [totalMonths, setTotalMonths] = useState(12);
        return useContractCalculation({
          selectedProduct: makeProduct(20000),
          interestConfig: null,
          posConfig: undefined,
          downPayment,
          setDownPayment,
          totalMonths,
          setTotalMonths,
        });
      });
      // Defaults from the hook source
      expect(result.current.interestRate).toBe(0.08);
      expect(result.current.minDownPct).toBe(0.15);
      expect(result.current.storeCommPct).toBe(0.10);
      expect(result.current.vatPct).toBe(0.07);
      expect(result.current.minMonths).toBe(6);
      expect(result.current.maxMonths).toBe(12);
    });
  });

  describe('auto down payment', () => {
    it('auto-sets downPayment to ceil(sellingPrice * minDownPct) on first render', () => {
      const { result } = setupHook({
        product: makeProduct(10000),
        config: makeConfig({ minDownPaymentPct: '0.15' }),
        initialDownPayment: 0,
        initialMonths: 12,
      });
      // 10000 * 0.15 = 1500 → ceil(1500) = 1500
      expect(result.current.downPayment).toBe(1500);
    });

    it('does NOT overwrite downPayment after the user has touched it', () => {
      const { result, rerender } = setupHook({
        product: makeProduct(10000),
        config: makeConfig({ minDownPaymentPct: '0.20' }),
        initialDownPayment: 2000, // already at min
        initialMonths: 12,
      });
      // user touches it
      act(() => {
        result.current.setDownPaymentTouched(true);
        result.current.setDownPayment(500); // intentionally below min
      });
      rerender();
      // hook should NOT auto-correct now
      expect(result.current.downPayment).toBe(500);
    });
  });

  describe('months range clamping', () => {
    it('clamps totalMonths up to minMonths when current value is below range', () => {
      const { result } = setupHook({
        product: makeProduct(10000),
        config: makeConfig({ minInstallmentMonths: 12, maxInstallmentMonths: 24 }),
        initialDownPayment: 2000,
        initialMonths: 6,
      });
      // After mount + effect, totalMonths should be clamped up to 12
      expect(result.current.totalMonths).toBe(12);
    });

    it('clamps totalMonths down to maxMonths when current value is above range', () => {
      const { result } = setupHook({
        product: makeProduct(10000),
        config: makeConfig({ minInstallmentMonths: 6, maxInstallmentMonths: 10 }),
        initialDownPayment: 2000,
        initialMonths: 24,
      });
      expect(result.current.totalMonths).toBe(10);
    });

    it('produces a contiguous monthOptions array between min and max', () => {
      const { result } = setupHook({
        product: makeProduct(10000),
        config: makeConfig({ minInstallmentMonths: 6, maxInstallmentMonths: 10 }),
      });
      expect(result.current.monthOptions).toEqual([6, 7, 8, 9, 10]);
    });
  });
});
