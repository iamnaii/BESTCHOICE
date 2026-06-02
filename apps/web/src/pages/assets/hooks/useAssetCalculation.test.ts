import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAssetCalculation } from './useAssetCalculation';
import type { AssetEntryFormValues } from '../schema';

// useAssetCalculation calls useCoaByCodes (react-query) for account-name lookup,
// so the hook needs a QueryClient in context. The coa query is only used to map
// codes → names (coaRows ?? []), never for the numeric calculation under test,
// so letting it error (retry: false) is fine — the assertions below don't touch it.
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(QueryClientProvider, { client: queryClient }, children);

const base: Partial<AssetEntryFormValues> = {
  category: 'EQUIPMENT',
  basePrice: 0,
  shippingCost: 0,
  installationCost: 0,
  otherCapitalized: 0,
  residualValue: 0,
  usefulLifeMonths: 60,
  hasVat: false,
  vatInclusive: false,
  hasWht: false,
  paymentAccount: '11-1201',
};

describe('useAssetCalculation — VAT extraction (Bug Report v2 #9)', () => {
  it('Inclusive 60,000 → extracts basePrice 56,074.77 + VAT 3,925.23', () => {
    const { result } = renderHook(() =>
      useAssetCalculation({
        ...base,
        basePrice: 60000,
        hasVat: true,
        vatInclusive: true,
        vatAccount: '11-4101',
      }),
      { wrapper },
    );
    expect(result.current.basePrice).toBe(56074.77);
    expect(result.current.vatAmount).toBe(3925.23);
    expect(result.current.purchaseCost).toBe(56074.77);
    expect(result.current.totalPayable).toBe(60000);
  });

  it('Exclusive 100,000 → basePrice unchanged + VAT 7,000 on top', () => {
    const { result } = renderHook(() =>
      useAssetCalculation({
        ...base,
        basePrice: 100000,
        hasVat: true,
        vatInclusive: false,
        vatAccount: '11-4101',
      }),
      { wrapper },
    );
    expect(result.current.basePrice).toBe(100000);
    expect(result.current.vatAmount).toBe(7000);
    expect(result.current.purchaseCost).toBe(100000);
    expect(result.current.totalPayable).toBe(107000);
  });

  it('No VAT → basePrice = raw input, vatAmount = 0', () => {
    const { result } = renderHook(() =>
      useAssetCalculation({ ...base, basePrice: 50000, hasVat: false }),
      { wrapper },
    );
    expect(result.current.basePrice).toBe(50000);
    expect(result.current.vatAmount).toBe(0);
    expect(result.current.totalPayable).toBe(50000);
  });
});

describe('useAssetCalculation — WHT base routing (Bug Report v2 #8)', () => {
  it('hasWht=true with installation 3,000 → whtBase defaults to installation', () => {
    const { result } = renderHook(() =>
      useAssetCalculation({
        ...base,
        basePrice: 25000,
        installationCost: 3000,
        hasWht: true,
        whtRate: 0.03,
        whtAccount: '21-3103',
      }),
      { wrapper },
    );
    expect(result.current.whtBase).toBe(3000);
    expect(result.current.whtAmount).toBe(90);
  });

  it('hasWht=true with installation 0 + whtBaseAmount 0 → whtAmount = 0 (silent zero — the UI must warn)', () => {
    const { result } = renderHook(() =>
      useAssetCalculation({
        ...base,
        basePrice: 25000,
        installationCost: 0,
        whtBaseAmount: 0,
        hasWht: true,
        whtRate: 0.03,
        whtAccount: '21-3103',
      }),
      { wrapper },
    );
    expect(result.current.whtBase).toBe(0);
    expect(result.current.whtAmount).toBe(0);
  });

  it('whtBaseAmount overrides installation default', () => {
    const { result } = renderHook(() =>
      useAssetCalculation({
        ...base,
        basePrice: 25000,
        installationCost: 3000,
        whtBaseAmount: 5000,
        hasWht: true,
        whtRate: 0.03,
        whtAccount: '21-3103',
      }),
      { wrapper },
    );
    expect(result.current.whtBase).toBe(5000);
    expect(result.current.whtAmount).toBe(150);
  });
});

describe('useAssetCalculation — JE balance', () => {
  it('full purchase: cost + VAT + WHT + payment lines balance', () => {
    const { result } = renderHook(() =>
      useAssetCalculation({
        ...base,
        basePrice: 25000,
        installationCost: 3000,
        hasVat: true,
        vatInclusive: false,
        vatAccount: '11-4101',
        hasWht: true,
        whtRate: 0.03,
        whtAccount: '21-3103',
      }),
      { wrapper },
    );
    expect(result.current.isBalanced).toBe(true);
    // VAT is on basePrice only (25000 × 0.07 = 1750), not on installation.
    // Dr: 28000 cost + 1750 VAT = 29750
    // Cr: 90 WHT + 29660 payment = 29750
    expect(result.current.purchaseCost).toBe(28000);
    expect(result.current.vatAmount).toBe(1750);
    expect(result.current.whtAmount).toBe(90);
    expect(result.current.totalPayable).toBe(29660);
  });
});
