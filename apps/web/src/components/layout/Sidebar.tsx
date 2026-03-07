import { useMemo, useState, useCallback, memo } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import clsx from 'clsx';

interface NavItem {
  label: string;
  path: string;
  roles?: string[];
  section?: string;
  step?: number;
  group?: string;
}

const sectionMeta: Record<string, { label: string; icon: string }> = {
  sales: {
    label: 'ขาย & ผ่อนชำระ',
    icon: 'M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 100 4 2 2 0 000-4z',
  },
  debt: {
    label: 'ติดตาม & จัดการหนี้',
    icon: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z',
  },
  purchasing: {
    label: 'จัดซื้อ',
    icon: 'M3 3h2l.4 2M7 13h10l4-8H5.4m0 0L7 13m0 0l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17M17 13a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 100 4 2 2 0 000-4z',
  },
  warehouse: {
    label: 'คลังสินค้า',
    icon: 'M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4',
  },
  reports: {
    label: 'รายงาน & แจ้งเตือน',
    icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z',
  },
  system: {
    label: 'ระบบ',
    icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z',
  },
};

const sectionOrder = ['sales', 'debt', 'purchasing', 'warehouse', 'reports', 'system'];

const navItems: NavItem[] = [
  { label: 'หน้าหลัก', path: '/' },

  // ขาย & ผ่อนชำระ — ใช้ทุกวัน
  { label: 'POS ขายสินค้า', path: '/pos', section: 'sales' },
  { label: 'ประวัติการขาย', path: '/sales', section: 'sales' },
  { label: 'ลูกค้า', path: '/customers', section: 'sales' },
  { label: 'ตรวจเครดิต', path: '/credit-checks', section: 'sales' },
  { label: 'สัญญาผ่อน', path: '/contracts', section: 'sales' },
  { label: 'ชำระเงิน', path: '/payments', section: 'sales' },

  // ติดตาม & จัดการหนี้
  { label: 'ติดตามหนี้', path: '/overdue', section: 'debt' },
  { label: 'เปลี่ยนเครื่อง', path: '/exchange', roles: ['OWNER', 'BRANCH_MANAGER'], section: 'debt' },
  { label: 'ยึดคืน & ขายต่อ', path: '/repossessions', roles: ['OWNER', 'BRANCH_MANAGER'], section: 'debt' },

  // จัดซื้อ
  { label: 'สั่งซื้อ', path: '/purchase-orders', roles: ['OWNER', 'BRANCH_MANAGER'], section: 'purchasing' },
  { label: 'แจ้งเตือนสต็อก', path: '/stock/alerts', roles: ['OWNER', 'BRANCH_MANAGER'], section: 'purchasing' },

  // คลังสินค้า
  { label: 'สต็อก', path: '/stock', roles: ['OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT'], section: 'warehouse' },
  { label: 'สินค้าในคลัง', path: '/products', section: 'warehouse' },
  { label: 'โอนสาขา', path: '/stock/transfers', roles: ['OWNER', 'BRANCH_MANAGER'], section: 'warehouse' },
  { label: 'ปรับสต็อก', path: '/stock/adjustments', roles: ['OWNER', 'BRANCH_MANAGER'], section: 'warehouse' },
  { label: 'ตรวจนับสต๊อก', path: '/stock/count', roles: ['OWNER', 'BRANCH_MANAGER'], section: 'warehouse' },
  { label: 'สาขาเช็ครับ', path: '/stock/branch-receiving', roles: ['OWNER', 'BRANCH_MANAGER'], section: 'warehouse' },

  // รายงาน & แจ้งเตือน
  { label: 'รายงาน', path: '/reports', roles: ['OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT'], section: 'reports' },
  { label: 'แจ้งเตือน', path: '/notifications', roles: ['OWNER', 'BRANCH_MANAGER'], section: 'reports' },

  // ระบบ (OWNER)
  { label: 'ผู้ขาย', path: '/suppliers', roles: ['OWNER', 'BRANCH_MANAGER'], section: 'system' },
  { label: 'สาขา', path: '/branches', roles: ['OWNER'], section: 'system' },
  { label: 'จัดการผู้ใช้', path: '/users', roles: ['OWNER'], section: 'system' },
  { label: 'ตั้งค่าระบบ', path: '/settings', roles: ['OWNER'], section: 'system' },
  { label: 'ตั้งค่าดอกเบี้ย', path: '/settings/interest-config', roles: ['OWNER'], section: 'system' },
  { label: 'ราคาตั้งต้น', path: '/settings/pricing-templates', roles: ['OWNER'], section: 'system' },
  { label: 'Audit Logs', path: '/audit-logs', roles: ['OWNER'], section: 'system' },
  { label: 'นำเข้าข้อมูล', path: '/migration', roles: ['OWNER'], section: 'system' },
];

function getInitialCollapsed(): Record<string, boolean> {
  try {
    const stored = localStorage.getItem('sidebar_collapsed');
    if (stored) return JSON.parse(stored);
  } catch { /* ignore */ }
  return {};
}

function Sidebar() {
  const { user } = useAuth();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(getInitialCollapsed);

  const toggleSection = useCallback((section: string) => {
    setCollapsed((prev) => {
      const next = { ...prev, [section]: !prev[section] };
      localStorage.setItem('sidebar_collapsed', JSON.stringify(next));
      return next;
    });
  }, []);

  const filteredItems = useMemo(() => navItems.filter(
    (item) => !item.roles || (user && item.roles.includes(user.role)),
  ), [user]);

  // Group items by section
  const topItems = useMemo(() => filteredItems.filter((i) => !i.section), [filteredItems]);
  const sections = useMemo(() => {
    const map = new Map<string, NavItem[]>();
    for (const item of filteredItems) {
      if (!item.section) continue;
      const list = map.get(item.section);
      if (list) list.push(item);
      else map.set(item.section, [item]);
    }
    return sectionOrder
      .filter((key) => map.has(key))
      .map((key) => ({ key, ...sectionMeta[key], items: map.get(key)! }));
  }, [filteredItems]);

  // Check if a section contains the active route
  const activeSectionPath = location.pathname;

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
        {/* Top-level items (หน้าหลัก) */}
        {topItems.map((item) => (
          <NavLink
            key={item.path}
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
        ))}

        {/* Sections */}
        {sections.map((section) => {
          const hasActive = section.items.some((i) =>
            i.path === '/' ? activeSectionPath === '/' : activeSectionPath.startsWith(i.path),
          );

          // Single-item section: render as direct link with icon (no collapsible)
          if (section.items.length === 1) {
            const item = section.items[0];
            return (
              <div key={section.key} className="mt-2">
                <NavLink
                  to={item.path}
                  className={({ isActive }) =>
                    clsx(
                      'w-full flex items-center gap-2.5 px-3 py-2 rounded-lg transition-colors duration-200',
                      isActive
                        ? 'bg-primary-900/50 text-primary-300'
                        : 'text-gray-500 hover:bg-white/5 hover:text-gray-300',
                    )
                  }
                >
                  <svg
                    className="w-4 h-4 shrink-0"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={section.icon} />
                  </svg>
                  <span className="text-[11px] font-semibold uppercase tracking-wider">
                    {section.label}
                  </span>
                </NavLink>
              </div>
            );
          }

          // Multi-item section: collapsible
          const isCollapsed = collapsed[section.key] ?? false;

          return (
            <div key={section.key} className="mt-2">
              <button
                onClick={() => toggleSection(section.key)}
                className={clsx(
                  'w-full flex items-center gap-2.5 px-3 py-2 rounded-lg group cursor-pointer transition-colors duration-200',
                  hasActive && isCollapsed
                    ? 'bg-primary-900/50 text-primary-300'
                    : 'text-gray-500 hover:bg-white/5',
                )}
              >
                <svg
                  className={clsx(
                    'w-4 h-4 shrink-0 transition-colors duration-200',
                    hasActive && isCollapsed ? 'text-primary-400' : 'text-gray-600 group-hover:text-gray-400',
                  )}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={section.icon} />
                </svg>
                <span className="flex-1 text-left text-[11px] font-semibold uppercase tracking-wider group-hover:text-gray-300 transition-colors">
                  {section.label}
                </span>
                <div className="flex items-center gap-1.5">
                  {hasActive && isCollapsed && (
                    <span className="w-1.5 h-1.5 rounded-full bg-primary-400" />
                  )}
                  <svg
                    className={clsx(
                      'w-3.5 h-3.5 transition-transform duration-200 text-gray-600 group-hover:text-gray-400',
                      isCollapsed ? '-rotate-90' : 'rotate-0',
                    )}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </button>

              <div
                className={clsx(
                  'overflow-hidden transition-all duration-200',
                  isCollapsed ? 'max-h-0 opacity-0' : 'max-h-96 opacity-100',
                )}
              >
                <div className="ml-4 pl-2.5 border-l border-white/5 mt-0.5">
                  {section.items.map((item, idx) => {
                    const prevGroup = idx > 0 ? section.items[idx - 1].group : null;
                    const showGroupHeader = item.group && item.group !== prevGroup;

                    return (
                      <div key={item.path}>
                        {showGroupHeader && (
                          <div className={clsx('flex items-center gap-2 px-3', idx > 0 ? 'mt-3 mb-1' : 'mb-1')}>
                            <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-600">
                              {item.group}
                            </span>
                            <div className="flex-1 h-px bg-white/5" />
                          </div>
                        )}
                        <NavLink
                          to={item.path}
                          end={item.path === '/'}
                          className={({ isActive }) =>
                            clsx(
                              'flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium transition-all duration-200 mb-0.5',
                              isActive
                                ? 'bg-primary-600 text-white shadow-lg shadow-primary-600/20'
                                : 'text-gray-400 hover:bg-white/5 hover:text-white',
                            )
                          }
                        >
                          {item.step != null && (
                            <span className="w-5 h-5 rounded-full bg-white/10 flex items-center justify-center text-[10px] font-bold shrink-0">
                              {item.step}
                            </span>
                          )}
                          {item.label}
                        </NavLink>
                      </div>
                    );
                  })}
                </div>
              </div>
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
