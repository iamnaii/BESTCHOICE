import { createContext, useState, useEffect, ReactNode, useCallback } from 'react';
import { setAccessToken } from '../lib/api';

export interface AuthCustomer {
  id: string;
  name: string;
  phone: string | null;
  lineId: string | null;
  loyaltyBalance: number;
}

interface AuthState {
  customer: AuthCustomer | null;
  token: string | null;
  setAuth: (customer: AuthCustomer, token: string) => void;
  logout: () => void;
  hydrating: boolean;
}

export const AuthContext = createContext<AuthState>({} as AuthState);

const TOKEN_KEY = 'shop_auth_token';
const CUSTOMER_KEY = 'shop_auth_customer';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [customer, setCustomer] = useState<AuthCustomer | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [hydrating, setHydrating] = useState(true);

  useEffect(() => {
    const t = sessionStorage.getItem(TOKEN_KEY);
    const c = sessionStorage.getItem(CUSTOMER_KEY);
    if (t && c) {
      setToken(t);
      setCustomer(JSON.parse(c));
      setAccessToken(t);
    }
    setHydrating(false);
  }, []);

  const setAuth = useCallback((c: AuthCustomer, t: string) => {
    sessionStorage.setItem(TOKEN_KEY, t);
    sessionStorage.setItem(CUSTOMER_KEY, JSON.stringify(c));
    setToken(t);
    setCustomer(c);
    setAccessToken(t);
  }, []);

  const logout = useCallback(() => {
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(CUSTOMER_KEY);
    setToken(null);
    setCustomer(null);
    setAccessToken(null);
  }, []);

  return (
    <AuthContext.Provider value={{ customer, token, setAuth, logout, hydrating }}>
      {children}
    </AuthContext.Provider>
  );
}
