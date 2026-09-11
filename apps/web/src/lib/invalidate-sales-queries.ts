import type { QueryClient } from '@tanstack/react-query';

export type SalesMutationEvent = 'sale-created' | 'sale-voided' | 'booking-updated' | 'booking-converted' | 'contract-created';
const stock = ['pos-products', 'pos-bundle-products', 'product', 'products', 'products-available', 'booking-products', 'stock'];
const sales = ['sale', 'sales-history', 'top-products', 'trade-in-credits'];
const keys: Record<SalesMutationEvent, readonly string[]> = {
  'sale-created': [...sales, ...stock],
  'sale-voided': [...sales, ...stock],
  'booking-updated': ['bookings', 'booking'],
  'booking-converted': ['bookings', 'booking', ...sales, ...stock],
  'contract-created': ['contracts', 'contract', ...stock, 'trade-in-credits', 'customer-latest-credit', 'customer-credit-checks', 'credit-checks', 'customers', 'customer'],
};

export async function invalidateSalesQueries(client: QueryClient, event: SalesMutationEvent): Promise<void> {
  await Promise.all(keys[event].map(key => client.invalidateQueries({ queryKey: [key] })));
}
