// Environment variable validation — runs at startup via side-effect import in main.tsx

// In real production (Firebase Hosting) we want same-origin "/api" so the
// refresh_token cookie stays first-party — Firebase rewrites /api/** to the
// Cloud Run API service. In dev (Vite proxy) and in CI E2E (the prod bundle
// served at localhost:5173 with API on :3000) we honor VITE_API_URL so the
// built bundle can still reach the API at a different origin.
function resolveApiUrl(): string {
  // In production the admin app is served from admin.bestchoicephone.app and calls
  // /api/admin/* — the backend AdminPrefixMiddleware strips /admin internally so
  // existing controllers handle requests transparently.
  // In dev, Vite proxies /api/* → localhost:3000 — the /admin prefix is preserved
  // and stripped by the same middleware, so no Vite config change is needed.
  const configured = import.meta.env.VITE_API_URL || '/api/admin';
  if (import.meta.env.DEV) return configured;
  if (typeof window !== 'undefined' && window.location.hostname === 'localhost') {
    return configured;
  }
  return '/api/admin';
}

export const API_URL = resolveApiUrl();
export const LIFF_ID = import.meta.env.VITE_LIFF_ID || '';

if (import.meta.env.PROD) {
  if (!import.meta.env.VITE_LIFF_ID) {
    console.warn('[env] VITE_LIFF_ID is not set — LIFF features will be unavailable');
  }
}
