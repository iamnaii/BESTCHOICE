import { createContext, ReactNode, useContext, useState, useCallback } from 'react';
import type { Zone } from '@/config/menu';

interface LayoutState {
  sidebarCollapse: boolean;
  setSidebarCollapse: (collapse: boolean) => void;
  mobileSidebarOpen: boolean;
  setMobileSidebarOpen: (open: boolean) => void;
  currentZone: Zone;
  setCurrentZone: (zone: Zone) => void;
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
    try {
      localStorage.setItem('bc.sidebar.lastZone', zone);
      const url = new URL(window.location.href);
      url.searchParams.set('zone', zone);
      window.history.replaceState({}, '', url.toString());
    } catch {
      /* ignore */
    }
  }, []);

  return (
    <LayoutContext.Provider
      value={{
        sidebarCollapse,
        setSidebarCollapse,
        mobileSidebarOpen,
        setMobileSidebarOpen,
        currentZone,
        setCurrentZone,
      }}
    >
      {children}
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
