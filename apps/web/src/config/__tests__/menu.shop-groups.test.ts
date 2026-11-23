import { describe, expect, it } from 'vitest';
import { Users } from '@/lib/icons';
import { getSidebarForRole, resolveZoneForPath, type MenuSection } from '../menu';
import { groupShopMenu } from '../shop-menu';

describe('SHOP grouping preserves grants and company navigation', () => {
  it('preserves all items, nested grants, badges and role-specific sections without touching FINANCE', () => {
    const input: MenuSection[] = [
      {
        key: 'old',
        label: 'เดิม',
        icon: Users,
        zone: 'shop',
        items: [
          { path: '/customers', label: 'ลูกค้า', icon: Users },
          {
            path: '/purchase-orders/qc',
            label: 'รอถ่ายรูป',
            icon: Users,
            badgeKey: 'qc-pending-count',
          },
          {
            path: '/custom',
            label: 'เฉพาะตำแหน่ง',
            icon: Users,
            children: [{ path: '/custom/child', label: 'ย่อย', icon: Users }],
          },
        ],
      },
      {
        key: 'fin',
        label: 'การเงิน',
        icon: Users,
        zone: 'fin',
        items: [{ path: '/payments', label: 'ชำระ', icon: Users }],
      },
    ];
    const grouped = groupShopMenu(input, 'test');
    expect(grouped.flatMap((s) => s.items)).toEqual(
      expect.arrayContaining(input.flatMap((s) => s.items)),
    );
    expect(grouped.flatMap((s) => s.items)).toHaveLength(4);
    expect(grouped.find((s) => s.zone === 'fin')).toBe(input[1]);
    expect(grouped.find((s) => s.key === 'old')?.items[0]).toBe(input[0].items[2]);
  });

  it('OWNER follows the approved five groups, inventory intake precedes photos', () => {
    const groups = getSidebarForRole('OWNER', 'shop');
    expect(groups.map((s) => s.label)).toEqual([
      'ลูกค้าและนัดหมาย',
      'ขายและบริการ',
      'คลังและจัดซื้อ',
      'เงินและบัญชีหน้าร้าน',
      'งานของฉัน',
    ]);
    const stock = groups.find((s) => s.key === 'owner-inventory')!.items.map((i) => i.path);
    expect(stock[0]).toBe('/stock');
    expect(stock.indexOf('/purchase-orders/qc')).toBeGreaterThan(stock.indexOf('/trade-in'));
    expect(stock.indexOf('/purchase-orders/qc')).toBeGreaterThan(stock.indexOf('/purchase-orders'));
  });

  it.each(['OWNER', 'BRANCH_MANAGER', 'SALES', 'FINANCE_MANAGER', 'ACCOUNTANT', 'VIEWER'])(
    '%s has no duplicated SHOP destinations or empty groups',
    (role) => {
      const groups = getSidebarForRole(role, 'shop');
      const paths = groups.flatMap((s) => s.items.map((i) => i.path));
      expect(new Set(paths).size).toBe(paths.length);
      expect(groups.every((s) => s.items.length > 0)).toBe(true);
      expect(paths.includes('/pos')).toBe(['OWNER', 'BRANCH_MANAGER', 'SALES'].includes(role));
      expect(paths.includes('/shop/accounting')).toBe(
        ['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'VIEWER'].includes(role),
      );
    },
  );

  it.each(['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT'])(
    '%s historical report stays in the selected company',
    (role) => {
      expect(resolveZoneForPath(role, '/imported-sales', 'shop')).toBe('shop');
      expect(resolveZoneForPath(role, '/imported-sales', 'fin')).toBe('fin');
    },
  );

  it('preserves branch collections without exposing owner FINANCE collections to SHOP', () => {
    expect(
      getSidebarForRole('BRANCH_MANAGER', 'shop').flatMap((s) => s.items.map((i) => i.path)),
    ).toContain('/repossessions');
    expect(
      getSidebarForRole('OWNER', 'shop').flatMap((s) => s.items.map((i) => i.path)),
    ).not.toContain('/repossessions');
  });
});
