import { createContext, ReactNode, useContext, useState, useCallback } from 'react';

interface LayoutState {
  sidebarCollapse: boolean;
  setSidebarCollapse: (collapse: boolean) => void;
  mobileSidebarOpen: boolean;
  setMobileSidebarOpen: (open: boolean) => void;
}

const LayoutContext = createContext<LayoutState | undefined>(undefined);

export function LayoutProvider({ children }: { children: ReactNode }) {
  const [sidebarCollapse, setSidebarCollapseState] = useState(() => {
    try {
      return localStorage.getItem('sidebar_collapse') === 'true';
    } catch {
      return false;
    }
  });
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  const setSidebarCollapse = useCallback((collapse: boolean) => {
    setSidebarCollapseState(collapse);
    try {
      localStorage.setItem('sidebar_collapse', String(collapse));
    } catch { /* ignore */ }
  }, []);

  return (
    <LayoutContext.Provider
      value={{
        sidebarCollapse,
        setSidebarCollapse,
        mobileSidebarOpen,
        setMobileSidebarOpen,
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
