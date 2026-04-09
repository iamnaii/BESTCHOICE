import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useState } from 'react';
import { useContractCalculation } from './useContractCalculation';
import type { Product, InterestConfig } from '../types';

/**
 * useContractCalculation is the single source of truth for contract pricing.
 * It computes principal, store commission, interest, VAT, financed amount,
 * and monthly payment for every installment sale created in the system.
 *
 * Formula (per CLAUDE.md "Flow เงินเมื่อขายผ่อน"):
 *   principal       = max(sellingPrice - downPayment, 0)
 *   storeCommission = principal * storeCommPct
 *   interestTotal   = principal * interestRate * totalMonths   (flat rate)
 *   vatAmount       = (principal + storeCommission + interestTotal) * vatPct
 *   financedAmount  = principal + storeCommission + interestTotal + vatAmount
 *   monthlyPayment  = ceil(financedAmount / totalMonths)
 *
 * If this hook drifts, every contract gets the wrong numbers.
 */

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
}) {
  return renderHook(() => {
    const [downPayment, setDownPayment] = useState(opts.initialDownPayment ?? 0);
    const [totalMonths, setTotalMonths] = useState(opts.initialMonths ?? 12);
    const calc = useContractCalculation({
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
  describe('selling price extraction', () => {
    it('returns 0 when no product is selected', () => {
      const { result } = setupHook({ product: null });
      expect(result.current.sellingPrice).toBe(0);
      expect(result.current.principal).toBe(0);
      expect(result.current.financedAmount).toBe(0);
      expect(result.current.monthlyPayment).toBe(0);
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

  describe('canonical 12-month installment', () => {
    // Reference case used by the rest of the suite to anchor the formula.
    // sellingPrice 25000, down 5000, 12 months, 1.5%, comm 10%, VAT 7%
    //   principal       = 20000
    //   storeCommission = 2000
    //   interestTotal   = 20000 * 0.015 * 12 = 3600
    //   subtotalForVat  = 20000 + 2000 + 3600 = 25600
    //   vatAmount       = 25600 * 0.07 = 1792
    //   financedAmount  = 25600 + 1792 = 27392
    //   monthlyPayment  = ceil(27392 / 12) = 2283
    it('matches the canonical numbers for the 25000/5000/12 case', () => {
      const { result } = setupHook({
        product: makeProduct(25000),
        config: makeConfig(),
        initialDownPayment: 5000,
        initialMonths: 12,
      });
      expect(result.current.sellingPrice).toBe(25000);
      expect(result.current.principal).toBe(20000);
      expect(result.current.storeCommission).toBe(2000);
      expect(result.current.interestTotal).toBe(3600);
      expect(result.current.vatAmount).toBeCloseTo(1792, 6);
      expect(result.current.financedAmount).toBeCloseTo(27392, 6);
      expect(result.current.monthlyPayment).toBe(2283);
    });
  });

  describe('zero-interest plan', () => {
    it('still applies storeCommission and VAT', () => {
      const { result } = setupHook({
        product: makeProduct(10000),
        config: makeConfig({ interestRate: '0' }),
        initialDownPayment: 0,
        initialMonths: 10,
      });
      // Mark touched so auto-set effect doesn't override our 0 down payment
      act(() => {
        result.current.setDownPaymentTouched(true);
        result.current.setDownPayment(0);
      });
      // principal=10000, comm=1000, interest=0
      // vatable=11000, vat=770, financed=11770, monthly=ceil(1177)=1177
      expect(result.current.principal).toBe(10000);
      expect(result.current.storeCommission).toBe(1000);
      expect(result.current.interestTotal).toBe(0);
      expect(result.current.vatAmount).toBeCloseTo(770, 6);
      expect(result.current.financedAmount).toBeCloseTo(11770, 6);
      expect(result.current.monthlyPayment).toBe(1177);
    });
  });

  describe('24-month plan', () => {
    it('scales interest linearly with months (flat rate)', () => {
      const { result } = setupHook({
        product: makeProduct(30000),
        config: makeConfig(),
        initialDownPayment: 6000,
        initialMonths: 24,
      });
      // principal=24000, comm=2400, interest=24000*0.015*24=8640
      // vatable=35040, vat=2452.8, financed=37492.8, monthly=ceil(37492.8/24)=ceil(1562.2)=1563
      expect(result.current.principal).toBe(24000);
      expect(result.current.interestTotal).toBe(8640);
      expect(result.current.vatAmount).toBeCloseTo(2452.8, 4);
      expect(result.current.financedAmount).toBeCloseTo(37492.8, 4);
      expect(result.current.monthlyPayment).toBe(1563);
    });
  });

  describe('cash-equivalent (downPayment >= sellingPrice)', () => {
    it('clamps principal to 0 — no interest, no commission, no VAT', () => {
      const { result } = setupHook({
        product: makeProduct(10000),
        config: makeConfig(),
        initialDownPayment: 10000,
        initialMonths: 12,
      });
      // Need to mark touched so the auto-set effect doesn't override
      act(() => {
        result.current.setDownPaymentTouched(true);
        result.current.setDownPayment(10000);
      });
      expect(result.current.principal).toBe(0);
      expect(result.current.storeCommission).toBe(0);
      expect(result.current.interestTotal).toBe(0);
      expect(result.current.vatAmount).toBe(0);
      expect(result.current.financedAmount).toBe(0);
      expect(result.current.monthlyPayment).toBe(0);
    });

    it('also clamps when downPayment overshoots the selling price', () => {
      const { result } = setupHook({
        product: makeProduct(8000),
        config: makeConfig(),
        initialDownPayment: 10000,
        initialMonths: 12,
      });
      act(() => {
        result.current.setDownPaymentTouched(true);
        result.current.setDownPayment(10000);
      });
      expect(result.current.principal).toBe(0);
    });
  });

  describe('totalMonths === 0 guard', () => {
    it('returns monthlyPayment 0 instead of dividing by zero', () => {
      const { result } = setupHook({
        product: makeProduct(10000),
        config: makeConfig({ minInstallmentMonths: 0, maxInstallmentMonths: 12 }),
        initialDownPayment: 1000,
        initialMonths: 0,
      });
      expect(result.current.monthlyPayment).toBe(0);
      expect(Number.isFinite(result.current.monthlyPayment)).toBe(true);
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
