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

/** State after password phase — waiting for OTP or 2FA setup */
export type TwoFaPhase = 'OTP_REQUIRED' | '2FA_SETUP_REQUIRED';

export interface PendingTwoFa {
  phase: TwoFaPhase;
  tempToken: string;
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
  /** Result of password-phase login — null when fully authenticated */
  pendingTwoFa: PendingTwoFa | null;
  /** Submit email+password. Returns AUTHENTICATED immediately or sets pendingTwoFa. */
  login: (email: string, password: string) => Promise<{ state: string }>;
  /** Complete OTP phase — call after user enters 6-digit TOTP. */
  completeOtpPhase: (token: string) => void;
  /** Clear pendingTwoFa (e.g. user cancels back to login). */
  clearTempToken: () => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [pendingTwoFa, setPendingTwoFa] = useState<PendingTwoFa | null>(null);

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout', {});
    } catch {
      // ignore logout errors
    }
    setAccessToken(null);
    setUser(null);
    setPendingTwoFa(null);
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
    // Skip auth on customer subdomain entirely — no cookies, no auth needed
    const host = window.location.hostname;
    const isCustomerSubdomain = host.startsWith('customer.') || host.startsWith('liff.');
    const path = window.location.pathname;
    const search = window.location.search;
    const isLiffRedirect = search.includes('liff.state');
    const isPublicPage =
      isCustomerSubdomain ||
      isLiffRedirect ||
      path.startsWith('/liff/') ||
      path.startsWith('/pay/') ||
      path.startsWith('/customer-access/') ||
      path.startsWith('/verify/');
    if (isPublicPage) {
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    fetchMe().finally(() => {
      if (cancelled) return;
    });
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Submit email+password.
   * - 'AUTHENTICATED' → sets token + user immediately.
   * - 'OTP_REQUIRED' / '2FA_SETUP_REQUIRED' → sets pendingTwoFa, caller handles next step.
   */
  const login = useCallback(async (email: string, password: string): Promise<{ state: string }> => {
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

    if (data.state === 'AUTHENTICATED') {
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
    } else if (data.state === 'OTP_REQUIRED' || data.state === '2FA_SETUP_REQUIRED') {
      setPendingTwoFa({ phase: data.state as TwoFaPhase, tempToken: data.tempToken });
    }

    return { state: data.state };
  }, []);

  /** Called after successful /auth/login/2fa — receives full access token. */
  const completeOtpPhase = useCallback((token: string) => {
    setAccessToken(token);
    setPendingTwoFa(null);
    // Fetch user profile now that we have a full token
    fetchMe();
  }, [fetchMe]);

  const clearTempToken = useCallback(() => {
    setPendingTwoFa(null);
  }, []);

  const value = useMemo(
    () => ({
      user,
      isLoading,
      isAuthenticated: !!user,
      pendingTwoFa,
      login,
      completeOtpPhase,
      clearTempToken,
      logout,
    }),
    [user, isLoading, pendingTwoFa, login, completeOtpPhase, clearTempToken, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
