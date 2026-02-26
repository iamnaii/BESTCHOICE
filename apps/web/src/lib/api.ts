import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  timeout: 15000, // 15 second timeout to prevent hanging forever
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor: attach JWT token
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('access_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Response interceptor: handle 401 and 429
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('access_token');
      localStorage.removeItem('refresh_token');
      // Only redirect if not already on login page (prevent redirect loop)
      if (window.location.pathname !== '/login') {
        window.location.href = '/login';
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
