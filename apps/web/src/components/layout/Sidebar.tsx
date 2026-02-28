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
  { label: 'ประวัติการขาย', path: '/sales', section: 'sales' },
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
    <aside className="w-64 bg-primary-950 min-h-screen flex flex-col">
      {/* Logo */}
      <div className="p-5 border-b border-white/10">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary-400 to-purple-500 flex items-center justify-center shadow-lg shadow-primary-500/20">
            <span className="text-white font-bold text-sm">B</span>
          </div>
          <div>
            <h1 className="text-lg font-bold text-white leading-tight">
              best<span className="text-primary-400">choice</span>
            </h1>
            <p className="text-[10px] text-gray-500">ระบบจัดการร้าน</p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-3 overflow-y-auto">
        {filteredItems.map((item, idx) => {
          const prevItem = filteredItems[idx - 1];
          const showSectionLabel =
            item.section && (!prevItem || prevItem.section !== item.section);

          return (
            <div key={item.path}>
              {showSectionLabel && (
                <div className="px-3 pt-4 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                  {sectionLabels[item.section!] ?? item.section}
                </div>
              )}
              <NavLink
                to={item.path}
                end={item.path === '/'}
                className={({ isActive }) =>
                  clsx(
                    'flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-medium transition-all duration-200 mb-0.5',
                    isActive
                      ? 'bg-primary-600 text-white shadow-lg shadow-primary-600/20'
                      : 'text-gray-400 hover:bg-white/5 hover:text-white',
                  )
                }
              >
                {item.label}
              </NavLink>
            </div>
          );
        })}
      </nav>

      {/* User info at bottom */}
      {user && (
        <div className="p-4 border-t border-white/10">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-primary-700 flex items-center justify-center">
              <span className="text-white text-xs font-bold">{user.name?.charAt(0)}</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-white truncate">{user.name}</p>
              <p className="text-xs text-gray-500 truncate">{user.branchName}</p>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}

export default memo(Sidebar);
