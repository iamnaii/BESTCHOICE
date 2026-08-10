// Asset hub tab bar — 7 tabs in 3 groups (mockup 2026-08-10):
//   [เอกสาร] | [ทะเบียน+NBV · สมุดรายวัน · สรุปแยกหมวด] | [ค่าเสื่อม · ปิดงวด · Audit]
// Rendered at the top of every asset hub page (flat routes, no layout nesting).
// Badges: เอกสาร = DRAFT count, ค่าเสื่อม = 1 when LAST month still has assets
// pending a depreciation run (current month pending is normal — cron runs at
// month-end, so only a missed previous month counts as ค้างงาน).

import { NavLink } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import {
  FileText,
  BookOpen,
  NotebookText,
  BarChart3,
  TrendingDown,
  Lock,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useDraftAssetCount } from '@/hooks/useDraftAssetCount';
import { depreciationApi } from '@/pages/depreciation/api';

interface HubTab {
  label: string;
  path: string;
  icon: LucideIcon;
  /** exact-match highlight (for the /assets root tab) */
  end?: boolean;
  /** roles allowed — omit = all asset roles */
  roles?: string[];
  badge?: number;
}

function prevPeriodBkk(): string {
  const bkkNow = new Date(Date.now() + 7 * 60 * 60 * 1000);
  const d = new Date(Date.UTC(bkkNow.getUTCFullYear(), bkkNow.getUTCMonth() - 1, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function TabBadge({ count }: { count: number }) {
  return (
    <span className="ml-1 inline-flex items-center justify-center min-w-4.5 h-4.5 px-1 rounded-full bg-warning text-warning-foreground text-[10px] font-semibold leading-none">
      {count > 99 ? '99+' : count}
    </span>
  );
}

export default function AssetHubTabs() {
  const { user } = useAuth();
  const role = user?.role ?? '';

  const draftCount = useDraftAssetCount(true);

  // Previous BKK month with assets still pending a run → catch-up needed.
  // preview/:period walks every POSTED asset server-side, so keep this badge
  // query long-lived and quiet — it mounts on all 7 hub pages but shares one
  // cache entry and only refetches every 15 min
  const prevPeriod = prevPeriodBkk();
  const pendingQuery = useQuery({
    queryKey: ['depreciation-preview', prevPeriod],
    queryFn: () => depreciationApi.preview(prevPeriod),
    staleTime: 15 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
  const deprPending = (pendingQuery.data?.lines.length ?? 0) > 0 ? 1 : 0;

  const groups: HubTab[][] = [
    [{ label: 'เอกสาร', path: '/assets', icon: FileText, end: true, badge: draftCount || 0 }],
    [
      { label: 'ทะเบียน + NBV', path: '/assets/register', icon: BookOpen },
      { label: 'สมุดรายวัน', path: '/assets/journal', icon: NotebookText },
      { label: 'สรุปแยกหมวด', path: '/assets/summary-report', icon: BarChart3 },
    ],
    [
      { label: 'ค่าเสื่อม', path: '/assets/depreciation', icon: TrendingDown, badge: deprPending },
      {
        label: 'ปิดงวด',
        path: '/assets/period-close',
        icon: Lock,
        roles: ['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT'],
      },
      {
        label: 'Audit',
        path: '/assets/audit',
        icon: ShieldCheck,
        roles: ['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT'],
      },
    ],
  ];

  const visibleGroups = groups
    .map((g) => g.filter((t) => !t.roles || t.roles.includes(role)))
    .filter((g) => g.length > 0);

  return (
    <nav
      aria-label="เมนูระบบสินทรัพย์"
      className="flex items-center gap-1 border-b border-border overflow-x-auto -mx-1 px-1"
    >
      {visibleGroups.map((group, gi) => (
        <div key={gi} className="flex items-center gap-1">
          {gi > 0 && <div className="w-px h-5 bg-border mx-1.5 shrink-0" aria-hidden />}
          {group.map((tab) => (
            <NavLink
              key={tab.path}
              to={tab.path}
              end={tab.end}
              className={({ isActive }) =>
                `flex items-center gap-1.5 px-3 py-2.5 text-sm whitespace-nowrap border-b-2 -mb-px transition-colors leading-snug ${
                  isActive
                    ? 'border-primary text-primary font-medium'
                    : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-accent rounded-t-md'
                }`
              }
            >
              <tab.icon className="size-4 shrink-0" />
              {tab.label}
              {tab.badge ? <TabBadge count={tab.badge} /> : null}
            </NavLink>
          ))}
        </div>
      ))}
    </nav>
  );
}
