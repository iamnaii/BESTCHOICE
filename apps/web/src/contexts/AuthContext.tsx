import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
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
      const { data } = await api.get('/auth/me');
      setUser({
        id: data.id,
        email: data.email,
        name: data.name,
        role: data.role,
        branchId: data.branchId,
        branchName: data.branch?.name || null,
      });
    } catch (error: unknown) {
      const status = (error as { response?: { status?: number } })?.response?.status;
      if (status === 401) {
        logout();
      }
      // Don't logout on 429 (rate limit) or network errors - keep current session
    } finally {
      setIsLoading(false);
    }
  }, [logout]);

  useEffect(() => {
    fetchMe();
  }, [fetchMe]);

  const login = async (email: string, password: string) => {
    const { data } = await api.post('/auth/login', { email, password });
    localStorage.setItem('access_token', data.accessToken);
    localStorage.setItem('refresh_token', data.refreshToken);
    setUser(data.user);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAuthenticated: !!user,
        login,
        logout,
      }}
    >
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
