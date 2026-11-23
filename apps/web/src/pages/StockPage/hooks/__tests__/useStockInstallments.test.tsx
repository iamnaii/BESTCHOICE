import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { useStockInstallments } from '../useStockInstallments';
import { resolveQuotes } from '@/pages/ProductDetailPage/utils/resolveQuotes';
import { INITIAL_CALC_STATE } from '@/pages/ProductDetailPage/hooks/useInstallmentCalcState';
import type { GfinTables } from '@/pages/ProductDetailPage/utils/gfinQuote';
import type { StockProduct } from '../../types';
const get = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({ default: { get } }));
const bc = {
  minDownPct: 0.15,
  commissionPct: 0.1,
  vatPct: 0.07,
  ratePctByMonths: { 6: 0.4, 12: 0.5 },
  allowedMonths: [6, 12],
};
const tables: GfinTables = {
  mappings: [
    {
      id: 'm',
      gfinSeries: 'iPhone 15',
      gfinVariant: null,
      storage: '128GB',
      condition: 'HAND_1',
      maxPrice: '23000',
      modelMatchPattern: 'iPhone 15',
      isActive: true,
    },
  ],
  rules: [
    {
      id: 'r',
      label: '15',
      seriesPattern: 'iPhone 15',
      condition: 'HAND_1',
      allowance: '1000',
      maxMonths: 15,
      isActive: true,
    },
  ],
  factors: [6, 12, 15].map((months) => ({
    id: `f${months}`,
    months,
    shopCommissionPct: 15,
    factor: months === 6 ? '0.25' : months === 12 ? '0.179238' : '0.1467',
    feePerInstallment: '100',
    isActive: true,
  })),
  settings: {
    minDownPct: 25,
    maxDownPct: 80,
    downStepPct: 5,
    contractFee: 100,
    commissionPctByCategory: { PHONE: 15, TABLET: 5 },
  },
};
const product: StockProduct = {
  id: 'phone',
  name: 'iPhone 15',
  model: 'iPhone 15',
  brand: 'Apple',
  category: 'PHONE_NEW',
  storage: '128GB',
  color: 'Black',
  imeiSerial: '123456789012345',
  deviceOrigin: 'THAI',
  costPrice: '18000',
  cashPrice: '23000',
  installmentPrice: '25000',
  financePrice: '27000',
  status: 'IN_STOCK',
  branch: { id: 'b', name: 'test' },
  supplier: null,
  prices: [],
  templateTerms: {
    bcPrice: '25000',
    rate1TermMonths: 6,
    rate1DownPayment: '5000',
    rate2TermMonths: 12,
  },
};
function setup(products: StockProduct[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderHook(() => useStockInstallments(products), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
}
beforeEach(() => {
  get.mockReset();
  get.mockImplementation(async (url: string) => ({
    data: url.startsWith('/interest-configs/')
      ? bc
      : url.endsWith('/settings')
        ? tables.settings
        : url.endsWith('/max-prices')
          ? tables.mappings
          : url.endsWith('/overprice-rules')
            ? tables.rules
            : tables.factors,
  }));
});
describe('stock quotes use the existing product-detail terms', () => {
  it('uses template months and down, explicit GFIN price, and one set of queries for many units', async () => {
    const { result } = setup([product, { ...product, id: 'second' }]);
    await waitFor(() => expect(result.current.gfinInstallments.get('phone')?.quote).not.toBeNull());
    const detail = resolveQuotes({
      product,
      state: INITIAL_CALC_STATE,
      bcConfig: bc,
      gfinTables: tables,
    });
    expect(result.current.installments.get('phone')?.quote).toEqual({
      months: 6,
      downAmount: 5000,
      monthlyPayment: detail.bc!.quote.result.monthlyPayment.toNumber(),
    });
    expect(result.current.gfinInstallments.get('phone')?.quote).toMatchObject({
      months: 12,
      downAmount: detail.gfin!.quote.available
        ? detail.gfin!.quote.result.downAmountActual.toNumber()
        : null,
      monthlyPayment: detail.gfin!.quote.available
        ? detail.gfin!.quote.result.monthlyPayment.toNumber()
        : null,
    });
    expect(get).toHaveBeenCalledTimes(5);
  });
  it('uses unknown origin as unknown rather than granting the Thai-device allowance', async () => {
    const p = { ...product, deviceOrigin: null, templateTerms: null };
    const { result } = setup([p]);
    await waitFor(() => expect(result.current.gfinInstallments.get('phone')?.quote).not.toBeNull());
    const detail = resolveQuotes({
      product: p,
      state: INITIAL_CALC_STATE,
      bcConfig: bc,
      gfinTables: tables,
    });
    expect(result.current.gfinInstallments.get('phone')?.quote?.downAmount).toBe(
      detail.gfin!.quote.available ? detail.gfin!.quote.result.downAmountActual.toNumber() : null,
    );
    expect(result.current.gfinInstallments.get('phone')?.quote?.months).toBe(15);
  });
  it('does not request financing for accessories or cash-only devices', () => {
    setup([
      { ...product, category: 'ACCESSORY' },
      { ...product, id: 'cash', financePrice: null, installmentPrice: null },
    ]);
    expect(get).not.toHaveBeenCalled();
  });
  it('allows GFIN-only pricing, and reports a recoverable table error without inventing numbers', async () => {
    get.mockImplementation(async () => {
      throw new Error('unavailable');
    });
    const { result } = setup([{ ...product, installmentPrice: null }]);
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.gfinInstallments.get('phone')).toMatchObject({
      isError: true,
      quote: null,
    });
    expect(result.current.installments.get('phone')?.isError).toBe(false);
    expect(get.mock.calls.some(([url]) => url.startsWith('/interest-configs/'))).toBe(false);
  });
});
