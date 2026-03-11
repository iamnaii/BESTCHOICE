import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  timeout: 15000, // 15 second timeout to prevent hanging forever
  headers: {
    'Content-Type': 'application/json',
    'X-Requested-With': 'XMLHttpRequest',
  },
  withCredentials: true, // send httpOnly cookies for refresh token
});

// Request interceptor: attach JWT token
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('access_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Flag to prevent multiple simultaneous refresh attempts
let isRefreshing = false;
let failedQueue: { resolve: (token: string) => void; reject: (err: unknown) => void }[] = [];

function processQueue(error: unknown, token: string | null) {
  failedQueue.forEach((prom) => {
    if (error) {
      prom.reject(error);
    } else {
      prom.resolve(token!);
    }
  });
  failedQueue = [];
}

// Response interceptor: handle 401 with token refresh, handle 429
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    // If 401 and we haven't already tried refreshing for this request
    if (error.response?.status === 401 && !originalRequest._retry) {
      // Don't try to refresh if the failing request IS the refresh or login
      if (originalRequest.url?.includes('/auth/refresh') || originalRequest.url?.includes('/auth/login')) {
        localStorage.removeItem('access_token');
        if (window.location.pathname !== '/login') {
          window.location.href = '/login';
        }
        return Promise.reject(error);
      }

      if (isRefreshing) {
        // Queue this request until refresh completes
        return new Promise((resolve, reject) => {
          failedQueue.push({
            resolve: (token: string) => {
              originalRequest.headers.Authorization = `Bearer ${token}`;
              resolve(api(originalRequest));
            },
            reject,
          });
        });
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        // Refresh token is sent via httpOnly cookie automatically
        const { data } = await axios.post(
          `${api.defaults.baseURL}/auth/refresh`,
          {},
          { timeout: 10000, withCredentials: true, headers: { 'X-Requested-With': 'XMLHttpRequest' } },
        );

        const newAccessToken = data.accessToken;
        localStorage.setItem('access_token', newAccessToken);

        processQueue(null, newAccessToken);

        // Retry the original request with new token
        originalRequest.headers.Authorization = `Bearer ${newAccessToken}`;
        return api(originalRequest);
      } catch (refreshError) {
        processQueue(refreshError, null);
        localStorage.removeItem('access_token');
        if (window.location.pathname !== '/login' && window.location.pathname !== '/landing') {
          window.location.href = '/login';
        }
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
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
