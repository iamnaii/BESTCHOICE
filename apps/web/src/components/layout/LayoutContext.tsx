import { createContext, ReactNode, useContext, useState, useCallback, useMemo } from 'react';
import type { Zone } from '@/config/menu';

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

  const [currentZone, setCurrentZoneState] = useState<Zone>(() => {
    try {
      // Priority 1: URL ?zone=
      const url = new URL(window.location.href);
      const urlZone = url.searchParams.get('zone');
      if (urlZone === 'shop' || urlZone === 'fin' || urlZone === 'settings') {
        return urlZone;
      }
      // Priority 2: localStorage
      const saved = localStorage.getItem('bc.sidebar.lastZone');
      if (saved === 'shop' || saved === 'fin' || saved === 'settings') {
        return saved;
      }
    } catch {
      /* ignore */
    }
    // Priority 3: default (Sidebar overrides via role default on first render)
    return 'shop';
  });

  const setSidebarCollapse = useCallback((collapse: boolean) => {
    setSidebarCollapseState(collapse);
    try {
      localStorage.setItem('sidebar_collapse', String(collapse));
    } catch {
      /* ignore */
    }
  }, []);

  const setCurrentZone = useCallback((zone: Zone) => {
    setCurrentZoneState(zone);
    // ออกจากโหมดตั้งค่าทางไหนก็ต้องลืมที่ที่จำไว้ — ไม่ใช่แค่ทางปุ่ม "ออกจากตั้งค่า".
    // มีอีกสามทางที่พาออก: breadcrumb "หน้าหลัก"/โลโก้ (MainLayout รีเซ็ต), path-driven
    // resolve, และ useZoneValidator. ถ้าไม่ล้าง ครั้งหน้าที่เข้าตั้งค่าจะถูกพากลับหน้าเก่า
    // ที่ผู้ใช้เลิกทำไปหลายก้าวแล้ว
    if (zone !== 'settings') setSettingsReturn(null);
    try {
      localStorage.setItem('bc.sidebar.lastZone', zone);
      const url = new URL(window.location.href);
      url.searchParams.set('zone', zone);
      window.history.replaceState({}, '', url.toString());
    } catch {
      /* ignore */
    }
  }, []);

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
      setCurrentZone,
      settingsReturn,
      enterSettings,
      exitSettings,
    ],
  );

  return <LayoutContext.Provider value={value}>{children}</LayoutContext.Provider>;
}

export function useLayout() {
  const context = useContext(LayoutContext);
  if (!context) {
    throw new Error('useLayout must be used within a LayoutProvider');
  }
  return context;
}
