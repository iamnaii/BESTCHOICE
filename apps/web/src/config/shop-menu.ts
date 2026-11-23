import { Clock, ShoppingCart, Users, Wallet, Warehouse } from '@/lib/icons';
import type { MenuSection } from './menu';

/** Reorganize existing grants only; unmatched role-specific work keeps its section. */
export function groupShopMenu(sections: MenuSection[], prefix: string): MenuSection[] {
  const shop = sections.filter((section) => section.zone === 'shop');
  const items = new Map(
    shop.flatMap((section) => section.items.map((item) => [item.path, item] as const)),
  );
  const groups = [
    {
      key: 'customers',
      label: 'ลูกค้าและนัดหมาย',
      icon: Users,
      paths: ['/customers', '/credit-checks', '/appointments'],
    },
    {
      key: 'sales',
      label: 'ขายและบริการ',
      icon: ShoppingCart,
      paths: ['/pos', '/prices', '/bookings', '/contracts', '/sales', '/after-sales', '/mdm'],
    },
    {
      key: 'inventory',
      label: 'คลังและจัดซื้อ',
      icon: Warehouse,
      paths: [
        '/stock',
        '/suppliers',
        '/purchase-orders',
        '/trade-in',
        '/purchase-orders/qc',
        '/stock/products',
        '/stock/adjustments',
        '/stickers',
      ],
    },
    {
      key: 'shop-accounting',
      label: 'เงินและบัญชีหน้าร้าน',
      icon: Wallet,
      paths: [
        '/shop/daily-cash',
        '/shop/petty-cash',
        '/shop/accounting',
        '/imported-sales',
        '/payments',
        '/expenses',
        '/expenses/recurring-bills',
        '/assets',
        '/profit-loss',
        '/reports',
      ],
    },
    {
      key: 'personal',
      label: 'งานของฉัน',
      icon: Clock,
      paths: ['/attendance', '/attendance/me', '/commissions', '/todos'],
    },
  ];
  const result: MenuSection[] = groups
    .map((group) => ({
      key: `${prefix}-${group.key}`,
      label: group.label,
      icon: group.icon,
      zone: 'shop' as const,
      items: group.paths.flatMap((path) => {
        const item = items.get(path);
        items.delete(path);
        return item ? [item] : [];
      }),
    }))
    .filter((section) => section.items.length > 0);

  // Preserve e.g. branch overview and collections; no role loses a destination.
  for (const section of shop) {
    const remaining = section.items.filter((item) => items.has(item.path));
    if (remaining.length) result.push({ ...section, items: remaining });
  }
  return [...result, ...sections.filter((section) => section.zone !== 'shop')];
}
