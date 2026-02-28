import { createContext, useContext, useState, useEffect, useCallback, useMemo, ReactNode } from 'react';
import api from '@/lib/api';

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

  const logout = useCallback(() => {
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    setUser(null);
  }, []);

  const fetchMe = useCallback(async () => {
    try {
      const token = localStorage.getItem('access_token');
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
      // On auth failure, timeout, or network error, clear user state
      // Token refresh is handled automatically by api.ts interceptor
      if (axiosError.response?.status === 401 || axiosError.code === 'ECONNABORTED' || !axiosError.response) {
        logout();
      }
    } finally {
      setIsLoading(false);
    }
  }, [logout]);

  useEffect(() => {
    fetchMe();
  }, [fetchMe]);

  const login = useCallback(async (email: string, password: string) => {
    const doLogin = () => api.post('/auth/login', { email, password }, { timeout: 30000 });
    let res;
    try {
      res = await doLogin();
    } catch (err: unknown) {
      const axErr = err as { code?: string };
      // Auto-retry once on timeout (server cold start)
      if (axErr.code === 'ECONNABORTED') {
        res = await doLogin();
      } else {
        throw err;
      }
    }
    const { data } = res;
    localStorage.setItem('access_token', data.accessToken);
    localStorage.setItem('refresh_token', data.refreshToken);
    setUser(data.user);
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
