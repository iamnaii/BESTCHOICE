import axios from 'axios';
import { API_URL } from '@/lib/env';

// In-memory token storage — not accessible via XSS unlike localStorage
let accessToken: string | null = null;

// E2E test support: read token from localStorage (injected by Playwright addInitScript),
// then immediately remove it so tokens are memory-only at runtime.
try {
  const e2eToken = localStorage.getItem('access_token');
  if (e2eToken) {
    accessToken = e2eToken;
    localStorage.removeItem('access_token');
  }
} catch {
  // localStorage unavailable (SSR)
}

export function setAccessToken(token: string | null) {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

const sharedConfig = {
  baseURL: API_URL,
  timeout: 15000,
  headers: {
    'Content-Type': 'application/json',
    'X-Requested-With': 'XMLHttpRequest',
  },
};

const api = axios.create({
  ...sharedConfig,
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
  baseURL: API_URL,
  timeout: 10000,
  withCredentials: true,
  headers: { 'X-Requested-With': 'XMLHttpRequest' },
});

// Unwrap API envelope for refresh instance too
refreshApi.interceptors.response.use((response) => {
  if (response.data && typeof response.data === 'object' && 'success' in response.data && 'data' in response.data) {
    response.data = response.data.data;
  }
  return response;
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

// Response interceptor: unwrap API envelope { success, data, timestamp }
api.interceptors.response.use(
  (response) => {
    if (response.data && typeof response.data === 'object' && 'success' in response.data && 'data' in response.data) {
      response.data = response.data.data;
    }
    return response;
  },
);

/** Check if current page is public (LIFF, payment, customer subdomain) — don't redirect to login */
function isPublicOrLiffPage(): boolean {
  const host = window.location.hostname;
  if (host.startsWith('customer.') || host.startsWith('liff.')) return true;
  const path = window.location.pathname;
  const search = window.location.search;
  if (search.includes('liff.state')) return true;
  return path === '/login' || path === '/landing' || path.startsWith('/liff/') || path.startsWith('/pay/') || path.startsWith('/customer-access/') || path.startsWith('/verify/');
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
        if (!isPublicOrLiffPage()) {
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
        if (!isPublicOrLiffPage()) {
          window.location.href = '/login';
        }
        return Promise.reject(refreshError);
      }
    }

    return Promise.reject(error);
  },
);

// Public axios instance for LIFF pages — no auth headers, no login redirect on 401.
// Intentionally omits withCredentials: LIFF endpoints use LINE tokens, not session cookies.
export const liffApi = axios.create(sharedConfig);

// LIFF ID token for server-side verification (set by useLiffInit)
let liffIdToken: string | null = null;
export function setLiffIdToken(token: string | null) {
  liffIdToken = token;
}

// Attach X-Liff-Id-Token header on all liffApi requests
liffApi.interceptors.request.use((config) => {
  if (liffIdToken) {
    config.headers['X-Liff-Id-Token'] = liffIdToken;
  }
  return config;
});

// Unwrap API envelope for liffApi too + capture 5xx errors to Sentry
liffApi.interceptors.response.use(
  (response) => {
    if (response.data && typeof response.data === 'object' && 'success' in response.data && 'data' in response.data) {
      response.data = response.data.data;
    }
    return response;
  },
  (error) => {
    const status = error?.response?.status;
    if (status && status >= 500) {
      // Dynamically import Sentry to avoid bundling it if not configured
      import('@sentry/react').then((Sentry) => {
        Sentry.captureException(error, {
          tags: { source: 'liffApi', status },
          extra: {
            url: error?.config?.url,
            method: error?.config?.method,
          },
        });
      }).catch(() => { /* Sentry not available — ignore */ });
    }
    return Promise.reject(error);
  },
);

export function getErrorMessage(error: unknown): string {
  // Guard against null / undefined / primitive errors before treating
  // it like an axios-shaped object — otherwise a stray `throw undefined`
  // or rejection with no payload crashes this helper with a TypeError.
  if (!error || typeof error !== 'object') {
    return 'ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้';
  }
  const err = error as { response?: { status?: number; data?: { message?: string | string[] } }; code?: string };
  if (err.code === 'ECONNABORTED') return 'เซิร์ฟเวอร์ไม่ตอบสนอง กรุณาลองใหม่';
  if (!err.response) return 'ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้';
  if (err.response.status === 429) return 'คำขอถี่เกินไป กรุณารอสักครู่';
  const msg = err.response.data?.message;
  return (Array.isArray(msg) ? msg[0] : msg) || 'เกิดข้อผิดพลาด';
}

export default api;
