import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { invalidateSalesQueries, type SalesMutationEvent } from './invalidate-sales-queries';

describe('Sales mutations invalidate warm related caches', () => {
  it.each<[SalesMutationEvent, string[]]>([
    ['sale-created', ['sales-history', 'top-products', 'pos-products', 'pos-bundle-products', 'product', 'products-available', 'trade-in-credits']],
    ['sale-voided', ['sales-history', 'top-products', 'pos-products', 'pos-bundle-products', 'product', 'products', 'trade-in-credits']],
    ['booking-updated', ['bookings', 'booking']],
    ['booking-converted', ['bookings', 'booking', 'sales-history', 'pos-products', 'top-products']],
    ['contract-created', ['contracts', 'contract', 'products-available', 'customer-latest-credit', 'trade-in-credits']],
  ])('%s fetches new data immediately even with a three-minute staleTime', async (event, related) => {
    const client = new QueryClient({ defaultOptions: { queries: { staleTime: 180000, retry: false } } });
    for (const key of [...related, 'unrelated']) client.setQueryData([key, 'filters'], 'old');
    await invalidateSalesQueries(client, event);
    const fetch = vi.fn(async () => 'new');
    for (const key of related) expect(await client.fetchQuery({ queryKey: [key, 'filters'], queryFn: fetch })).toBe('new');
    expect(await client.fetchQuery({ queryKey: ['unrelated', 'filters'], queryFn: fetch })).toBe('old');
    expect(fetch).toHaveBeenCalledTimes(related.length);
    client.clear();
  });
});
