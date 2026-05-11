// Shared module-level tab navigation for the Accounting hub.
// Used across Other Income (42-XXXX) + Asset Acquisition (12-21XX) modules
// so both feel like one unified "ระบบบัญชี" experience.

import { NavLink, useLocation } from 'react-router';
import {
  Boxes,
  Receipt,
  BarChart3,
  CalendarClock,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface ModuleTab {
  label: string;
  to: string;
  icon: LucideIcon;
  matchPrefix: string[];
}

const MODULE_TABS: ModuleTab[] = [
  {
    label: 'ซื้อสินทรัพย์ถาวร',
    to: '/assets',
    icon: Boxes,
    matchPrefix: ['/assets'],
  },
  {
    label: 'รายได้อื่น',
    to: '/other-income',
    icon: Receipt,
    matchPrefix: ['/other-income'],
  },
  {
    label: 'รายงาน',
    to: '/assets/summary-report',
    icon: BarChart3,
    matchPrefix: ['/assets/summary-report'],
  },
  {
    label: 'ค่าเสื่อม',
    to: '/depreciation',
    icon: CalendarClock,
    matchPrefix: ['/depreciation'],
  },
  {
    label: 'Audit',
    to: '/audit-logs',
    icon: ShieldCheck,
    matchPrefix: ['/audit-logs'],
  },
];

function isPrefixMatch(pathname: string, prefixes: string[]): boolean {
  return prefixes.some((p) => pathname === p || pathname.startsWith(p + '/'));
}

export function AccountingModuleTabBar() {
  const { pathname } = useLocation();
  return (
    <nav
      className="flex flex-wrap items-center gap-1.5 rounded-xl border border-border/60 bg-card p-1.5 shadow-sm"
      aria-label="Accounting hub navigation"
    >
      {MODULE_TABS.map((tab) => {
        const Icon = tab.icon;
        const isActive = isPrefixMatch(pathname, tab.matchPrefix);
        return (
          <NavLink
            key={tab.to}
            to={tab.to}
            className={cn(
              'inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
              isActive
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:bg-accent hover:text-foreground',
            )}
          >
            <Icon className="size-4" />
            {tab.label}
          </NavLink>
        );
      })}
    </nav>
  );
}
