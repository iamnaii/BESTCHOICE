import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { useAuth } from './AuthContext';

export type Company = 'SHOP' | 'FINANCE';

interface EntityScopeContextValue {
  scope: Company;
  setScope: (s: Company) => void;
  canSwitch: boolean;
  accessibleCompanies: Company[];
}

const EntityScopeContext = createContext<EntityScopeContextValue | undefined>(undefined);

const STORAGE_KEY = 'bc-entity-scope';

export function EntityScopeProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const accessibleCompanies = (user?.accessibleCompanies ?? []) as Company[];

  const initialScope = (): Company => {
    // 1. URL ?company= takes precedence (for deep-linking)
    const urlParams = new URLSearchParams(window.location.search);
    const fromUrl = (urlParams.get('company') ?? '').toUpperCase() as Company;
    if (accessibleCompanies.includes(fromUrl)) return fromUrl;

    // 2. localStorage if still accessible
    const stored = localStorage.getItem(STORAGE_KEY) as Company | null;
    if (stored && accessibleCompanies.includes(stored)) return stored;

    // 3. primaryCompany
    const primary = user?.primaryCompany as Company | undefined;
    if (primary && accessibleCompanies.includes(primary)) return primary;

    // 4. first accessible (or fallback)
    return accessibleCompanies[0] ?? 'SHOP';
  };

  const [scope, setScopeRaw] = useState<Company>(initialScope);

  useEffect(() => {
    // Re-init when user changes (login/logout)
    setScopeRaw(initialScope());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const setScope = (s: Company) => {
    if (!accessibleCompanies.includes(s)) return;
    setScopeRaw(s);
    localStorage.setItem(STORAGE_KEY, s);
  };

  const canSwitch = accessibleCompanies.length > 1;

  return (
    <EntityScopeContext.Provider value={{ scope, setScope, canSwitch, accessibleCompanies }}>
      {children}
    </EntityScopeContext.Provider>
  );
}

export function useEntityScope() {
  const ctx = useContext(EntityScopeContext);
  if (!ctx) throw new Error('useEntityScope must be inside EntityScopeProvider');
  return ctx;
}
