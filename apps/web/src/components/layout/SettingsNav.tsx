import { useCallback, useMemo } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { ArrowLeft, Settings } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';
import { settingsNavGroups } from '@/config/settings-access';
import type { SettingsRole } from '@/config/settings-registry';
import { getWorkZoneHref, getZoneEntryPathForRole, ZONE_LANDING } from '@/config/menu';
import { useLayout, type NonSettingsZone, type SettingsReturn } from './LayoutContext';

const ZONE_LABEL: Record<NonSettingsZone, string> = {
  shop: 'หน้าร้าน',
  fin: 'ไฟแนนซ์',
};

/** เก็บ query string + hash ด้วย — หน้าที่มีสถานะอยู่ใน URL (ตัวกรอง/แท็บ/anchor)
 *  ถ้าจำแค่ pathname จะกลับมาเป็นหน้าเปล่าที่ต้องตั้งค่าใหม่ทั้งหมด */
function fullPath(loc: { pathname: string; search: string; hash: string }): string {
  return loc.pathname + loc.search + loc.hash;
}

/** ปุ่มที่กดหายไปจาก DOM ทันทีที่สลับโหมด (เฟือง ↔ แถบออก อยู่คนละกิ่ง) → focus ตกไปที่
 *  <body> คนใช้คีย์บอร์ดต้องไล่ Tab ใหม่ทั้งหน้า. ส่งต่อไปที่ <main id="main" tabIndex={-1}>
 *  ซึ่งมีอยู่แล้วสำหรับ SkipLink */
function handoffFocus() {
  requestAnimationFrame(() => {
    document.getElementById('main')?.focus();
  });
}

/**
 * ตรรกะ "เข้า/ออกโหมดตั้งค่า" ที่ใช้ร่วมกันทั้งเมนูกาง เมนูย่อ บาร์ล่างมือถือ.
 *
 * สองข้อที่ของเดิมพลาด และห้ามพลาดซ้ำ:
 * 1. ต้อง navigate ด้วย ไม่ใช่สลับโซนเฉย ๆ — ไม่งั้นเมนูเปลี่ยนแต่เนื้อหาค้างหน้าเดิม
 *    และ MainLayout จงใจไม่แก้ให้ (effect ข้ามตัวเองเมื่อมีแต่โซนที่เปลี่ยน)
 * 2. ปลายทางต้องเป็นโซนที่ "จากมาจริง" ไม่ใช่ defaultZone ของ role — OWNER ทำงาน
 *    อยู่ไฟแนนซ์แล้วกดเฟือง ต้องได้ไฟแนนซ์คืน ไม่ใช่ถูกโยนไปหน้าร้าน
 */
export function useSettingsZone() {
  const { user } = useAuth();
  const role = user?.role ?? '';
  const location = useLocation();
  const navigate = useNavigate();
  const { currentZone, workZone, settingsReturn, enterSettings, exitSettings, setMobileSidebarOpen } =
    useLayout();

  // ใช้เมื่อไม่มีที่จากมาให้จำ (เข้าตรงด้วย bookmark / ?zone=settings / รีเฟรชกลางทาง)
  const fallback = useMemo<SettingsReturn>(() => {
    const zone = workZone;
    return { zone, path: getZoneEntryPathForRole(role, zone) };
  }, [role, workZone]);

  const target = settingsReturn ?? fallback;

  const enter = useCallback(() => {
    const from: NonSettingsZone =
      currentZone === 'settings' ? fallback.zone : (currentZone as NonSettingsZone);
    enterSettings({ zone: from, path: fullPath(location) });
    setMobileSidebarOpen(false);
    navigate(getWorkZoneHref(ZONE_LANDING.settings, from));
    handoffFocus();
  }, [currentZone, fallback.zone, location, enterSettings, setMobileSidebarOpen, navigate]);

  const exit = useCallback(() => {
    const to = exitSettings(fallback);
    setMobileSidebarOpen(false);
    navigate(getWorkZoneHref(to.path, to.zone));
    handoffFocus();
  }, [exitSettings, fallback, setMobileSidebarOpen, navigate]);

  return {
    inSettings: currentZone === 'settings',
    targetZone: target.zone,
    targetLabel: ZONE_LABEL[target.zone],
    enter,
    exit,
  };
}

/** แถบทางออก — อยู่บนสุดของเมนู ตำแหน่งเดียวกับ PillSwitcher ที่ถูกซ่อนในโหมดนี้ */
export function ExitSettingsBar({ testId = 'exit-settings' }: { testId?: string }) {
  const { targetLabel, exit } = useSettingsZone();
  return (
    <div className="px-3 py-2.5 border-b border-sidebar-border bg-card">
      <button
        type="button"
        onClick={exit}
        data-testid={testId}
        className={cn(
          'group flex w-full items-center gap-2.5 rounded-lg border border-border bg-background px-3 py-2 text-left',
          'transition-colors duration-150 hover:border-primary/40 hover:bg-primary/5',
          // focus ring มาจากกฎกลาง *:focus-visible ใน index.css — ห้ามใส่ outline-* ทับ
          // (กฎกลางตั้ง --tw-outline-style: none ไว้ ทำให้ outline utility ตายเงียบ)
        )}
      >
        <ArrowLeft
          aria-hidden="true"
          className="size-4 shrink-0 text-muted-foreground transition-transform duration-150 group-hover:-translate-x-0.5 group-hover:text-primary"
        />
        <span className="min-w-0 flex-1 leading-snug">
          <span className="block text-[13px] font-semibold text-foreground">ออกจากตั้งค่า</span>
          <span className="block truncate text-[11px] text-muted-foreground">
            กลับไป · {targetLabel}
          </span>
        </span>
      </button>
    </div>
  );
}

/** หัวข้อโหมด — แทน accordion "ตั้งค่าระบบ" เดิมที่พับได้ (พับแล้วเมนูว่างทั้งแถบ).
 *  ใช้ <p> ไม่ใช่ heading: ชื่อของ nav ด้านล่างมาจาก aria-label อยู่แล้ว การใส่ h2
 *  ในแถบข้างจะไปแทรกลำดับหัวข้อของเนื้อหาหน้า (h1 ของ PageHeader) */
export function SettingsZoneHeader() {
  return (
    <div className="flex items-center gap-2 px-5 pt-4 pb-2">
      <Settings className="size-[15px] shrink-0 text-muted-foreground" aria-hidden="true" />
      <p className="text-[13px] font-semibold uppercase tracking-wider text-muted-foreground leading-snug">
        ตั้งค่าระบบ
      </p>
    </div>
  );
}

function isEntryActive(path: string, pathname: string): boolean {
  return pathname === path || pathname.startsWith(path + '/');
}

/**
 * รายการหมวดตั้งค่าแบบแบน คั่นด้วยหัวข้อกลุ่ม — เห็นครบทุกหมวดพร้อมกัน ไม่ต้องกางอะไรก่อน.
 * ใช้ <nav>/<ul>/<Link> ตรง ๆ แทน AccordionMenu เพราะที่นี่ไม่มีอะไรให้พับ และได้
 * aria-current="page" กับ semantics ของลิงก์จริงกลับมา (accordion ห่อลิงก์ไว้ใน <button>)
 */
export function SettingsNavList({ testIdPrefix = 'settings-nav' }: { testIdPrefix?: string }) {
  const { user } = useAuth();
  const role = (user?.role ?? '') as SettingsRole;
  const { pathname } = useLocation();
  const groups = useMemo(() => settingsNavGroups(role), [role]);

  return (
    <nav aria-label="เมนูตั้งค่าระบบ" className="space-y-4 pb-2">
      {groups.map((group) => (
        <div key={group.id}>
          <p className="px-2.5 pb-1.5 text-[11px] font-bold uppercase tracking-widest text-muted-foreground leading-snug">
            {group.label}
          </p>
          <ul className="space-y-0.5">
            {group.entries.map((entry) => {
              const active = isEntryActive(entry.path, pathname);
              const Icon = entry.icon;
              return (
                <li key={entry.path}>
                  <Link
                    to={entry.path}
                    aria-current={active ? 'page' : undefined}
                    data-testid={`${testIdPrefix}-${entry.id}`}
                    className={cn(
                      'relative flex h-[36px] items-center gap-2.5 rounded-md px-2.5',
                      'text-[15px] font-medium leading-snug transition-colors duration-150',
                      active
                        ? [
                            'bg-primary/10 text-primary font-semibold dark:bg-primary/20',
                            'before:absolute before:left-0 before:top-[6px] before:bottom-[6px]',
                            'before:w-[3px] before:rounded-r-full before:bg-primary',
                          ]
                        : [
                            'text-foreground/75 hover:bg-sidebar-hover hover:text-foreground',
                            'dark:text-foreground/80 dark:hover:text-foreground',
                          ],
                    )}
                  >
                    <Icon className="size-[15px] shrink-0" aria-hidden="true" />
                    <span className="truncate">{entry.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
