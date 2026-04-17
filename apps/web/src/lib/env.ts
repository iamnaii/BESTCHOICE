// Environment variable validation — runs at startup via side-effect import in main.tsx

// In production, always use same-origin "/api" — Firebase Hosting rewrites
// /api/** to the Cloud Run API service. This keeps API calls same-origin so
// refresh_token cookie is first-party (no SameSite / 3rd-party cookie issues).
// VITE_API_URL is only honored in dev (where the Vite proxy forwards to :3000).
export const API_URL = import.meta.env.PROD ? '/api' : import.meta.env.VITE_API_URL || '/api';
export const LIFF_ID = import.meta.env.VITE_LIFF_ID || '';

if (import.meta.env.PROD) {
  if (!import.meta.env.VITE_LIFF_ID) {
    console.warn('[env] VITE_LIFF_ID is not set — LIFF features will be unavailable');
  }
}
