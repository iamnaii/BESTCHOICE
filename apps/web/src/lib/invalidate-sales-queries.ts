import type { QueryClient } from '@tanstack/react-query';

export type SalesMutationEvent = 'sale-created' | 'sale-voided' | 'booking-updated' | 'booking-converted' | 'contract-created';
const stock = ['pos-products', 'pos-bundle-products', 'bundle-products', 'bundle-quick-picks', 'product', 'products', 'products-available', 'booking-products', 'stock'];
const sales = ['sale', 'sales-history', 'top-products', 'trade-in-credits'];
const keys: Record<SalesMutationEvent, readonly string[]> = {
  'sale-created': [...sales, ...stock],
  // D4 ส่วนที่ 2 — ยกเลิกใบขายเรียกคืนค่าคอม ⇒ สถานะ/ยอดรอหักบนหน้าค่าคอมเปลี่ยน
  'sale-voided': [...sales, ...stock, 'commissions'],
  'booking-updated': ['bookings', 'booking'],
  'booking-converted': ['bookings', 'booking', ...sales, ...stock],
  'contract-created': ['contracts', 'contract', ...stock, 'trade-in-credits', 'customer-latest-credit', 'customer-credit-checks', 'credit-checks', 'customers', 'customer'],
};

export async function invalidateSalesQueries(client: QueryClient, event: SalesMutationEvent): Promise<void> {
  await Promise.all(keys[event].map(key => client.invalidateQueries({ queryKey: [key] })));
}
