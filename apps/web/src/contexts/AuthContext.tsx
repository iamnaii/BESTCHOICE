import { createContext, useContext, useState, useEffect, useCallback, useMemo, ReactNode } from 'react';
import { toast } from 'sonner';
import api, { setAccessToken, getAccessToken, getTokenExpiresAt } from '@/lib/api';

interface User {
  id: string;
  email: string;
  name: string;
  role: string;
  branchId: string | null;
  branchName?: string | null;
}

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout', {});
    } catch {
      // ignore logout errors
    }
    setAccessToken(null);
    setUser(null);
  }, []);

  const fetchMe = useCallback(async () => {
    try {
      const token = getAccessToken();
      if (!token) {
        setIsLoading(false);
        return;
      }
      const { data } = await api.get('/auth/me', { timeout: 10000 });
      setUser({
        id: data.id,
        email: data.email,
        name: data.name,
        role: data.role,
        branchId: data.branchId,
        branchName: data.branch?.name || null,
      });
    } catch (error: unknown) {
      const axiosError = error as { response?: { status?: number }; code?: string };
      // Only logout on explicit 401 (unauthorized) - token refresh is handled by api.ts interceptor
      // Do NOT logout on network errors or timeouts as the token may still be valid
      if (axiosError.response?.status === 401) {
        logout();
      }
    } finally {
      setIsLoading(false);
    }
  }, [logout]);

  useEffect(() => {
    let cancelled = false;
    fetchMe().finally(() => {
      if (cancelled) return;
    });
    return () => { cancelled = true; };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const doLogin = () => api.post('/auth/login', { email, password }, { timeout: 30000 });
    let res;
    try {
      res = await doLogin();
    } catch (err: unknown) {
      const axErr = err as { code?: string };
      // Auto-retry once on timeout or network error (server cold start)
      if (axErr.code === 'ECONNABORTED' || axErr.code === 'ECONNREFUSED' || axErr.code === 'ERR_NETWORK') {
        res = await doLogin();
      } else {
        throw err;
      }
    }
    const { data } = res;
    setAccessToken(data.accessToken);
    // refresh token is stored in httpOnly cookie by the server
    setUser({
      id: data.user.id,
      email: data.user.email,
      name: data.user.name,
      role: data.user.role,
      branchId: data.user.branchId,
      branchName: data.user.branchName ?? data.user.branch?.name ?? null,
    });
  }, []);

  // Warn user 2 minutes before the access token expires
  // (the axios interceptor will auto-refresh on the next API call, but this gives
  // users a chance to save in-progress form work before the session changes)
  useEffect(() => {
    if (!user) return;
    const expiry = getTokenExpiresAt();
    if (!expiry) return;

    const now = Date.now();
    const msUntilExpiry = expiry - now;
    const msUntilWarn = msUntilExpiry - 2 * 60 * 1000;

    if (msUntilWarn <= 0) return; // already near expiry — refresh interceptor will handle it

    const warnTimer = setTimeout(() => {
      toast.warning('Session ใกล้หมดอายุ กรุณาบันทึกงานของคุณ', {
        duration: 120_000,
        action: { label: 'ต่ออายุ', onClick: () => api.get('/auth/me').catch(() => logout()) },
      });
    }, msUntilWarn);

    return () => clearTimeout(warnTimer);
  }, [user, logout]);

  const value = useMemo(() => ({
    user,
    isLoading,
    isAuthenticated: !!user,
    login,
    logout,
  }), [user, isLoading, login, logout]);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
