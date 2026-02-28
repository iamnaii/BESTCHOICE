import { useMemo, memo } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import clsx from 'clsx';

interface NavItem {
  label: string;
  path: string;
  roles?: string[];
  section?: string;
}

const sectionLabels: Record<string, string> = {
  sales: 'ขาย & ผ่อนชำระ',
  debt: 'ติดตาม & จัดการหนี้',
  inventory: 'สินค้า & คลัง',
  purchasing: 'จัดซื้อ',
  reports: 'รายงาน & แจ้งเตือน',
  system: 'ระบบ',
};

const navItems: NavItem[] = [
  { label: 'หน้าหลัก', path: '/' },

  // ขาย & ผ่อนชำระ — ใช้ทุกวัน
  { label: 'POS ขายสินค้า', path: '/pos', section: 'sales' },
  { label: 'ลูกค้า', path: '/customers', section: 'sales' },
  { label: 'สัญญาผ่อน', path: '/contracts', section: 'sales' },
  { label: 'ชำระเงิน', path: '/payments', section: 'sales' },

  // ติดตาม & จัดการหนี้
  { label: 'ติดตามหนี้', path: '/overdue', section: 'debt' },
  { label: 'เปลี่ยนเครื่อง', path: '/exchange', roles: ['OWNER', 'BRANCH_MANAGER'], section: 'debt' },
  { label: 'ยึดคืน & ขายต่อ', path: '/repossessions', roles: ['OWNER', 'BRANCH_MANAGER'], section: 'debt' },

  // สินค้า & คลัง
  { label: 'สินค้า', path: '/products', section: 'inventory' },
  { label: 'ตรวจเช็คเครื่อง', path: '/inspections', section: 'inventory' },
  { label: 'สต็อก', path: '/stock', roles: ['OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT'], section: 'inventory' },
  { label: 'โอนสินค้า', path: '/stock/transfers', roles: ['OWNER', 'BRANCH_MANAGER'], section: 'inventory' },

  // จัดซื้อ
  { label: 'Supplier', path: '/suppliers', roles: ['OWNER', 'BRANCH_MANAGER'], section: 'purchasing' },
  { label: 'ใบสั่งซื้อ (PO)', path: '/purchase-orders', roles: ['OWNER', 'BRANCH_MANAGER'], section: 'purchasing' },

  // รายงาน & แจ้งเตือน
  { label: 'รายงาน', path: '/reports', roles: ['OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT'], section: 'reports' },
  { label: 'แจ้งเตือน', path: '/notifications', roles: ['OWNER', 'BRANCH_MANAGER'], section: 'reports' },

  // ระบบ (OWNER)
  { label: 'สาขา', path: '/branches', roles: ['OWNER'], section: 'system' },
  { label: 'จัดการผู้ใช้', path: '/users', roles: ['OWNER'], section: 'system' },
  { label: 'ตั้งค่าระบบ', path: '/settings', roles: ['OWNER'], section: 'system' },
  { label: 'Audit Logs', path: '/audit-logs', roles: ['OWNER'], section: 'system' },
  { label: 'นำเข้าข้อมูล', path: '/migration', roles: ['OWNER'], section: 'system' },
];

function Sidebar() {
  const { user } = useAuth();

  const filteredItems = useMemo(() => navItems.filter(
    (item) => !item.roles || (user && item.roles.includes(user.role)),
  ), [user]);

  return (
    <aside className="w-64 bg-white border-r border-gray-200 min-h-screen">
      <div className="p-4 border-b">
        <h1 className="text-xl font-bold text-primary-700">Best Choice</h1>
        <p className="text-xs text-gray-400 mt-1">ระบบจัดการร้าน</p>
      </div>
      <nav className="p-2">
        {filteredItems.map((item, idx) => {
          const prevItem = filteredItems[idx - 1];
          const showSectionLabel =
            item.section && (!prevItem || prevItem.section !== item.section);

          return (
            <div key={item.path}>
              {showSectionLabel && (
                <div className="px-4 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                  {sectionLabels[item.section!] ?? item.section}
                </div>
              )}
              <NavLink
                to={item.path}
                end={item.path === '/'}
                className={({ isActive }) =>
                  clsx(
                    'block px-4 py-2.5 rounded-lg text-sm font-medium transition-colors mb-1',
                    isActive
                      ? 'bg-primary-50 text-primary-700'
                      : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900',
                  )
                }
              >
                {item.label}
              </NavLink>
            </div>
          );
        })}
      </nav>
    </aside>
  );
}

export default memo(Sidebar);
