import { createContext, useContext, useState, useEffect, useCallback, useMemo, ReactNode } from 'react';
import * as Sentry from '@sentry/react';
import api, { setAccessToken } from '@/lib/api';

interface User {
  id: string;
  email: string;
  name: string;
  role: string;
  branchId: string | null;
  branchName?: string | null;
}

/**
 * Tag Sentry events with the logged-in user so we know WHO hit an error.
 * We only pass id + role + branchId — no PII (email/name) per our
 * Sentry `beforeSend` redaction policy.
 */
function setSentryUser(user: User | null) {
  if (user) {
    Sentry.setUser({
      id: user.id,
      role: user.role,
      branchId: user.branchId ?? undefined,
    } as Sentry.User);
  } else {
    Sentry.setUser(null);
  }
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
    setSentryUser(null);
  }, []);

  const fetchMe = useCallback(async () => {
    try {
      // Always try /auth/me — even without an in-memory token.
      // On page refresh the token is lost (in-memory), but the refresh
      // token cookie is still there. The 401 interceptor in api.ts will
      // auto-call /auth/refresh to get a new access token.
      const { data } = await api.get('/auth/me', { timeout: 10000 });
      const nextUser: User = {
        id: data.id,
        email: data.email,
        name: data.name,
        role: data.role,
        branchId: data.branchId,
        branchName: data.branch?.name || null,
      };
      setUser(nextUser);
      setSentryUser(nextUser);
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
    // Skip auth check entirely on public LIFF/payment pages — they don't need auth
    // and attempting refresh without cookies triggers redirect loops.
    // After LINE consent, LIFF redirects to root with ?liff.state={path} — must detect this too.
    const path = window.location.pathname;
    const search = window.location.search;
    const isLiffRedirect = search.includes('liff.state');
    const isPublicPage = isLiffRedirect || path.startsWith('/liff/') || path.startsWith('/pay/') || path.startsWith('/customer-access/') || path.startsWith('/verify/');
    if (isPublicPage) {
      setIsLoading(false);
      return;
    }

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
    const nextUser: User = {
      id: data.user.id,
      email: data.user.email,
      name: data.user.name,
      role: data.user.role,
      branchId: data.user.branchId,
      branchName: data.user.branchName ?? data.user.branch?.name ?? null,
    };
    setUser(nextUser);
    setSentryUser(nextUser);
  }, []);

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
