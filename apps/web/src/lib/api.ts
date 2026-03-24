import axios from 'axios';

// In-memory token storage — not accessible via XSS unlike localStorage
let accessToken: string | null = null;

// One-time migration: read token from localStorage (for backward compat & E2E tests),
// then remove it so future tokens are memory-only.
try {
  const legacyToken = localStorage.getItem('access_token');
  if (legacyToken) {
    accessToken = legacyToken;
    localStorage.removeItem('access_token');
  }
} catch {
  // localStorage may be unavailable (e.g. SSR)
}

export function setAccessToken(token: string | null) {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  timeout: 15000, // 15 second timeout to prevent hanging forever
  headers: {
    'Content-Type': 'application/json',
    'X-Requested-With': 'XMLHttpRequest',
  },
  withCredentials: true, // send httpOnly cookies for refresh token
});

// Request interceptor: attach JWT token from memory
api.interceptors.request.use((config) => {
  if (accessToken) {
    config.headers.Authorization = `Bearer ${accessToken}`;
  }
  return config;
});

// Dedicated axios instance for token refresh (avoids interceptor loop)
const refreshApi = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  timeout: 10000,
  withCredentials: true,
  headers: { 'X-Requested-With': 'XMLHttpRequest' },
});

// Promise-based singleton for token refresh to avoid race conditions
let refreshPromise: Promise<string> | null = null;

function refreshAccessToken(): Promise<string> {
  if (refreshPromise) {
    return refreshPromise;
  }

  refreshPromise = refreshApi
    .post('/auth/refresh', {})
    .then(({ data }) => {
      const newToken = data.accessToken;
      setAccessToken(newToken);
      return newToken;
    })
    .catch((err) => {
      setAccessToken(null);
      throw err;
    })
    .finally(() => {
      refreshPromise = null;
    });

  return refreshPromise;
}

// Response interceptor: handle 401 with token refresh
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    // If 401 and we haven't already tried refreshing for this request
    if (error.response?.status === 401 && !originalRequest._retry) {
      // Don't try to refresh if the failing request IS the refresh or login
      if (originalRequest.url?.includes('/auth/refresh') || originalRequest.url?.includes('/auth/login')) {
        setAccessToken(null);
        if (window.location.pathname !== '/login') {
          window.location.href = '/login';
        }
        return Promise.reject(error);
      }

      originalRequest._retry = true;

      try {
        const newToken = await refreshAccessToken();
        originalRequest.headers.Authorization = `Bearer ${newToken}`;
        return api(originalRequest);
      } catch (refreshError) {
        setAccessToken(null);
        if (window.location.pathname !== '/login' && window.location.pathname !== '/landing') {
          window.location.href = '/login';
        }
        return Promise.reject(refreshError);
      }
    }

    return Promise.reject(error);
  },
);

export function getErrorMessage(error: unknown): string {
  const err = error as { response?: { status?: number; data?: { message?: string | string[] } }; code?: string };
  if (err.code === 'ECONNABORTED') return 'เซิร์ฟเวอร์ไม่ตอบสนอง กรุณาลองใหม่';
  if (!err.response) return 'ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้';
  if (err.response.status === 429) return 'คำขอถี่เกินไป กรุณารอสักครู่';
  const msg = err.response.data?.message;
  return (Array.isArray(msg) ? msg[0] : msg) || 'เกิดข้อผิดพลาด';
}

export default api;
