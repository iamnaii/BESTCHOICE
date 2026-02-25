import { NavLink } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import clsx from 'clsx';

interface NavItem {
  label: string;
  path: string;
  roles?: string[];
  section?: string;
}

const navItems: NavItem[] = [
  { label: 'หน้าหลัก', path: '/' },
  { label: 'สาขา', path: '/branches', roles: ['OWNER'] },
  { label: 'สินค้า', path: '/products' },
  { label: 'ลูกค้า', path: '/customers' },
  { label: 'สัญญาผ่อน', path: '/contracts' },
  { label: 'ชำระเงิน', path: '/payments' },
  { label: 'ติดตามหนี้', path: '/overdue', section: 'operations' },
  { label: 'ยึดคืน & ขายต่อ', path: '/repossessions', roles: ['OWNER', 'BRANCH_MANAGER'], section: 'operations' },
  { label: 'ใบสั่งซื้อ (PO)', path: '/purchase-orders', roles: ['OWNER', 'BRANCH_MANAGER'], section: 'operations' },
  { label: 'แจ้งเตือน', path: '/notifications', roles: ['OWNER', 'BRANCH_MANAGER'], section: 'communication' },
  { label: 'รายงาน', path: '/reports', roles: ['OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT'], section: 'intelligence' },
  { label: 'จัดการผู้ใช้', path: '/users', roles: ['OWNER'], section: 'settings' },
  { label: 'ตั้งค่าระบบ', path: '/settings', roles: ['OWNER'], section: 'settings' },
  { label: 'นำเข้าข้อมูล', path: '/migration', roles: ['OWNER'], section: 'settings' },
];

export default function Sidebar() {
  const { user } = useAuth();

  const filteredItems = navItems.filter(
    (item) => !item.roles || (user && item.roles.includes(user.role)),
  );

  return (
    <aside className="w-64 bg-white border-r border-gray-200 min-h-screen">
      <div className="p-4 border-b">
        <h1 className="text-xl font-bold text-primary-700">Best Choice</h1>
        <p className="text-xs text-gray-400 mt-1">ระบบผ่อนชำระ</p>
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
                  {item.section === 'operations' ? 'ปฏิบัติการ' : item.section === 'communication' ? 'การสื่อสาร' : item.section === 'intelligence' ? 'ข้อมูลเชิงลึก' : item.section === 'settings' ? 'ตั้งค่า' : item.section}
                </div>
              )}
              <NavLink
                to={item.path}
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
