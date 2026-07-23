/// <reference types="vite/client" />
import axios from 'axios';

let accessToken: string | null = null;

export function setAccessToken(token: string | null) {
  accessToken = token;
}

// Same-origin in both dev and prod.
// Dev: Vite proxy rewrites /api → http://localhost:3000 (see vite.config).
// Prod: Firebase Hosting on www.bestchoicephone.com rewrites /api/** to the
// bestchoice-api Cloud Run service (see root firebase.json `shop` target).
//
// X-Requested-With is REQUIRED: the API's global CsrfGuard rejects every
// mutating request (POST/PUT/DELETE) without it — omitting it made every
// form submit on the storefront 403 (จอง/สมัครผ่อน/trade-in/checkout).
// Mirrors apps/web/src/lib/api.ts.
export const api = axios.create({
  baseURL: '',
  withCredentials: true,
  headers: { 'X-Requested-With': 'XMLHttpRequest' },
});

api.interceptors.request.use((config) => {
  if (accessToken) config.headers.Authorization = `Bearer ${accessToken}`;
  return config;
});

// Response interceptor: unwrap API envelope { success, data, timestamp }
// (matches apps/web/src/lib/api.ts so component code sees the payload
// directly — otherwise `response.data` is the envelope and components
// hit "data.map is not a function" on arrays).
api.interceptors.response.use((response) => {
  if (
    response.data &&
    typeof response.data === 'object' &&
    'success' in response.data &&
    'data' in response.data
  ) {
    response.data = response.data.data;
  }
  return response;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      setAccessToken(null);
    }
    return Promise.reject(err);
  }
);
