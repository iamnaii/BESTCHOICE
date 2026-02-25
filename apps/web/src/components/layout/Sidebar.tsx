import { NavLink } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import clsx from 'clsx';

interface NavItem {
  label: string;
  path: string;
  roles?: string[];
}

const navItems: NavItem[] = [
  { label: 'หน้าหลัก', path: '/' },
  { label: 'สาขา', path: '/branches', roles: ['OWNER'] },
  { label: 'Supplier', path: '/suppliers', roles: ['OWNER', 'BRANCH_MANAGER'] },
  { label: 'สินค้า', path: '/products' },
  { label: 'ลูกค้า', path: '/customers' },
  { label: 'สัญญาผ่อน', path: '/contracts' },
  { label: 'ชำระเงิน', path: '/payments' },
  { label: 'รายงาน', path: '/reports', roles: ['OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT'] },
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
        {filteredItems.map((item) => (
          <NavLink
            key={item.path}
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
        ))}
      </nav>
    </aside>
  );
}
