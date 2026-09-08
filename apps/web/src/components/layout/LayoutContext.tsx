import { createContext, Fragment, ReactNode, useContext, useState, useCallback, useMemo, useLayoutEffect } from 'react';
import { Navigate, useLocation } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { getZoneConfigForRole, getZoneEntryPathForRole, resolveZoneForPath, COMMON_PATHS, type Zone } from '@/config/menu';
import { WORK_COMPANY, setRequestCompany } from '@/lib/company-scope';

/** โซนปกติ (ไม่ใช่โหมดตั้งค่า) — ปลายทางที่ปุ่ม "ออกจากตั้งค่า" พากลับ */
export type NonSettingsZone = Exclude<Zone, 'settings'>;

/** "ที่ที่จากมา" ตอนกดเข้าโหมดตั้งค่า — เก็บทั้งโซนและ path
 *  เพราะ defaultZone ของ role ไม่ใช่โซนที่ผู้ใช้ทำงานอยู่เสมอไป
 *  (OWNER มี defaultZone = shop แต่กดเฟืองตอนอยู่ไฟแนนซ์ได้) */
export interface SettingsReturn {
  zone: NonSettingsZone;
  path: string;
}

interface LayoutState {
  /** ค่าที่ผู้ใช้เลือกไว้เอง (จำใน localStorage) */
  sidebarCollapse: boolean;
  setSidebarCollapse: (collapse: boolean) => void;
  /** ค่าที่ใช้วาดจริง — โหมดตั้งค่าบังคับกางเสมอ (10 หมวดแยกด้วยไอคอนล้วนไม่ออก)
   *  เป็นค่าคำนวณ ไม่เขียนทับค่าที่ผู้ใช้ตั้งไว้ → ออกจากตั้งค่าแล้วได้ค่าเดิมคืนเอง */
  effectiveSidebarCollapse: boolean;
  mobileSidebarOpen: boolean;
  setMobileSidebarOpen: (open: boolean) => void;
  currentZone: Zone;
  workZone: NonSettingsZone;
  setCurrentZone: (zone: Zone) => void;
  settingsReturn: SettingsReturn | null;
  /** เข้าโหมดตั้งค่า พร้อมจำที่ที่จากมา */
  enterSettings: (from: SettingsReturn) => void;
  /** ออกจากโหมดตั้งค่า — คืนปลายทางที่ผู้เรียกต้อง navigate ต่อ
   *  (ตั้งโซนอย่างเดียวไม่พอ: อยู่หน้า /settings ต่อทั้งที่เมนูเปลี่ยนแล้ว) */
  exitSettings: (fallback: SettingsReturn) => SettingsReturn;
}

const LayoutContext = createContext<LayoutState | undefined>(undefined);

export function LayoutProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { pathname, search, key } = useLocation();
  const queryClient = useQueryClient();
  const role = user?.role ?? '';
  const config = getZoneConfigForRole(role, user?.accessibleCompanies);
  const fallback = (config?.defaultZone === 'fin' ? 'fin' : 'shop') as NonSettingsZone;
  const canUse = (zone: Zone) => zone === 'settings' ? !!config?.showSettingsGear : !!config?.zones.includes(zone);
  const [sidebarCollapse, setSidebarCollapseState] = useState(() => {
    try {
      const saved = localStorage.getItem('sidebar_collapse');
      // Default to collapsed (icon rail) if no preference saved
      return saved === null ? true : saved === 'true';
    } catch {
      return true;
    }
  });
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  // ตั้งใจเก็บในหน่วยความจำอย่างเดียว ไม่ persist — path ที่ข้ามรีเฟรช/ข้าม session
  // อาจเป็นหน้าที่ role เสียสิทธิ์ไปแล้ว; รีเฟรชกลางโหมดตั้งค่าให้ตกไปที่ fallback แทน
  const [settingsReturn, setSettingsReturn] = useState<SettingsReturn | null>(null);

  const [selectedZone, setCurrentZoneState] = useState<Zone>(() => {
    try {
      // Priority 1: URL ?zone=
      const url = new URL(window.location.href);
      // Router search is authoritative; window search supports legacy deep links.
      if (search) url.search = search;
      const urlZone = url.searchParams.get('zone');
      if ((urlZone === 'shop' || urlZone === 'fin' || urlZone === 'settings') && canUse(urlZone)) {
        return urlZone;
      }
      // Priority 2: localStorage
      const saved = localStorage.getItem('bc.sidebar.lastZone');
      if ((saved === 'shop' || saved === 'fin' || saved === 'settings') && canUse(saved)) {
        return saved;
      }
    } catch {
      /* ignore */
    }
    // Priority 3: default (Sidebar overrides via role default on first render)
    return fallback;
  });
  const [lastWorkZone, setLastWorkZone] = useState<NonSettingsZone>(() => {
    if (selectedZone !== 'settings') return selectedZone;
    try {
      const saved = localStorage.getItem('bc.sidebar.workZone');
      if ((saved === 'shop' || saved === 'fin') && canUse(saved)) return saved;
    } catch { /* Use the authorized default. */ }
    return fallback;
  });
  const requestedZone = new URLSearchParams(search).get('zone');
  const explicitWorkZone = (requestedZone === 'shop' || requestedZone === 'fin') && canUse(requestedZone) ? requestedZone : null;
  const preferred = explicitWorkZone ?? (canUse(selectedZone) ? selectedZone : fallback);
  // Detail routes inherit their menu's company without granting that route permission.
  const pathZone = (() => {
    let path = pathname;
    while (path && !COMMON_PATHS.has(path)) {
      const zone = resolveZoneForPath(role, path, preferred);
      if (zone) return zone;
      path = path.slice(0, path.lastIndexOf('/'));
    }
    return null;
  })();
  const deniedCompany = pathZone !== null && pathZone !== 'settings' && !canUse(pathZone);
  const currentZone = pathZone && !deniedCompany ? pathZone : preferred;
  const workZone = currentZone === 'settings' ? (explicitWorkZone ?? (canUse(lastWorkZone) ? lastWorkZone : fallback)) : currentZone;
  const company = WORK_COMPANY[workZone];
  const scopeKey = `${user?.id ?? role}:${company}`;
  const [installedScope, setInstalledScope] = useState<string | null>(null);
  const hasWorkAccess = !!config?.zones.length;

  useLayoutEffect(() => {
    if (!hasWorkAccess) {
      setRequestCompany(undefined);
      queryClient.removeQueries();
      return;
    }
    // Children stay unmounted until their API scope and empty cache are installed.
    // Removing queries cancels old in-flight results before another company mounts.
    setRequestCompany(company);
    if (installedScope !== scopeKey) {
      queryClient.removeQueries();
      setInstalledScope(scopeKey);
    }
    // Settings links may omit ?zone; remember the company restored by browser history.
    setLastWorkZone(workZone);
    setCurrentZoneState(currentZone);
    try {
      localStorage.setItem('bc.sidebar.lastZone', currentZone);
      localStorage.setItem('bc.sidebar.workZone', workZone);
    } catch { /* Selection remains valid in memory. */ }
    // Stamp the rendered destination, not the previous entry in a tab's click handler.
    // Back/Forward then restore the company even for shared pages such as `/`.
    if (!deniedCompany) {
      const url = new URL(window.location.href);
      url.searchParams.delete('company');
      url.searchParams.set('zone', workZone);
      window.history.replaceState(window.history.state, '', url.toString());
    }
  }, [company, currentZone, installedScope, scopeKey, queryClient, workZone, hasWorkAccess, key, deniedCompany]);

  const setSidebarCollapse = useCallback((collapse: boolean) => {
    setSidebarCollapseState(collapse);
    try {
      localStorage.setItem('sidebar_collapse', String(collapse));
    } catch {
      /* ignore */
    }
  }, []);

  const setCurrentZone = useCallback((zone: Zone) => {
    const allowed = getZoneConfigForRole(role, user?.accessibleCompanies);
    if (zone === 'settings' ? !allowed?.showSettingsGear : !allowed?.zones.includes(zone)) return;
    setCurrentZoneState(zone);
    // ออกจากโหมดตั้งค่าทางไหนก็ต้องลืมที่ที่จำไว้ — ไม่ใช่แค่ทางปุ่ม "ออกจากตั้งค่า".
    // มีอีกสามทางที่พาออก: breadcrumb "หน้าหลัก"/โลโก้ (MainLayout รีเซ็ต), path-driven
    // resolve, และ useZoneValidator. ถ้าไม่ล้าง ครั้งหน้าที่เข้าตั้งค่าจะถูกพากลับหน้าเก่า
    // ที่ผู้ใช้เลิกทำไปหลายก้าวแล้ว
    if (zone !== 'settings') {
      setSettingsReturn(null);
      setLastWorkZone(zone);
    }
    try {
      localStorage.setItem('bc.sidebar.lastZone', zone);
    } catch {
      /* ignore */
    }
  }, [role, user?.accessibleCompanies]);

  const enterSettings = useCallback(
    (from: SettingsReturn) => {
      setSettingsReturn(from);
      setCurrentZone('settings');
    },
    [setCurrentZone],
  );

  const exitSettings = useCallback(
    (fallback: SettingsReturn) => {
      const target = settingsReturn ?? fallback;
      setSettingsReturn(null);
      setCurrentZone(target.zone);
      return target;
    },
    [settingsReturn, setCurrentZone],
  );

  const value = useMemo<LayoutState>(
    () => ({
      sidebarCollapse,
      setSidebarCollapse,
      effectiveSidebarCollapse: sidebarCollapse && currentZone !== 'settings',
      mobileSidebarOpen,
      setMobileSidebarOpen,
      currentZone,
      workZone,
      setCurrentZone,
      settingsReturn,
      enterSettings,
      exitSettings,
    }),
    [
      sidebarCollapse,
      setSidebarCollapse,
      mobileSidebarOpen,
      currentZone,
      workZone,
      setCurrentZone,
      settingsReturn,
      enterSettings,
      exitSettings,
    ],
  );

  if (!hasWorkAccess) return <p role="alert" className="p-6">บัญชีนี้ยังไม่มีสิทธิ์เข้าถึงบริษัท กรุณาติดต่อผู้ดูแลระบบ</p>;
  if (deniedCompany) return <Navigate to={getZoneEntryPathForRole(role, fallback)} replace />;
  return (
    <LayoutContext.Provider value={value}>
      {installedScope === scopeKey && <Fragment key={scopeKey}>{children}</Fragment>}
    </LayoutContext.Provider>
  );
}

export function useLayout() {
  const context = useContext(LayoutContext);
  if (!context) {
    throw new Error('useLayout must be used within a LayoutProvider');
  }
  return context;
}
