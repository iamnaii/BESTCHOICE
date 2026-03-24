// Environment variable validation — runs at startup via side-effect import in main.tsx

export const API_URL = import.meta.env.VITE_API_URL || '/api';
export const LIFF_ID = import.meta.env.VITE_LIFF_ID || '';

if (import.meta.env.PROD) {
  if (!import.meta.env.VITE_API_URL) {
    console.warn('[env] VITE_API_URL is not set — using default "/api"');
  }
  if (!import.meta.env.VITE_LIFF_ID) {
    console.warn('[env] VITE_LIFF_ID is not set — LIFF features will be unavailable');
  }
}
