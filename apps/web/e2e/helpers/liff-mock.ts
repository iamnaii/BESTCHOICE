import { Page } from '@playwright/test';

/**
 * Test identity used by every LIFF spec.
 * `MOCK_DISPLAY_NAME` is what `useLiffInit` exposes as `profile.displayName`,
 * so specs can assert on it directly (see liff-register.spec.ts).
 */
export const MOCK_LINE_ID = 'U_e2e_test_user';
export const MOCK_DISPLAY_NAME = 'ทดสอบ E2E';
export const MOCK_ID_TOKEN = 'mock-liff-id-token-for-e2e';

/** Must stay in sync with SESSION_CACHE_KEY in src/hooks/useLiffInit.ts */
const LIFF_SESSION_CACHE_KEY = 'bcp_liff_session_v1';

/**
 * Give the page a LINE identity WITHOUT leaving the SPA.
 *
 * `useLiffInit` (src/hooks/useLiffInit.ts) only takes the LIFF SDK branch when
 * `LIFF_ID` is set AND the pathname is under `/liff/contract`. E2E builds never
 * set `VITE_LIFF_ID`, and `/pay/:token` + `/liff/register` are not under that
 * endpoint, so every LIFF spec used to fall into the `else` branch →
 * `redirectToLineLogin()` → `window.location.href = <API>/line-oa/line-login/authorize`,
 * which answers HTTP 400 ("LINE Login ยังไม่ได้ตั้งค่า"). The app's DOM was gone
 * before any locator ran.
 *
 * Stubbing `window.liff` cannot fix that: the app does `import liff from '@line/liff'`
 * (an ES module) and never reads `window.liff`, and the LIFF branch is not even
 * entered when `LIFF_ID` is empty. Instead we seed the session cache that
 * `readSessionCache()` consults FIRST — `init()` then returns before it can reach
 * the OAuth redirect, on any path.
 */
export async function mockLiffSdk(page: Page) {
  await page.addInitScript(
    (seed: { key: string; lineId: string; displayName: string; idToken: string }) => {
      try {
        sessionStorage.setItem(
          seed.key,
          JSON.stringify({
            lineId: seed.lineId,
            idToken: seed.idToken,
            profile: { userId: seed.lineId, displayName: seed.displayName },
            cachedAt: Date.now(),
          }),
        );
      } catch {
        // sessionStorage unavailable (opaque origin, e.g. about:blank) — ignore
      }
    },
    {
      key: LIFF_SESSION_CACHE_KEY,
      lineId: MOCK_LINE_ID,
      displayName: MOCK_DISPLAY_NAME,
      idToken: MOCK_ID_TOKEN,
    },
  );
}

/**
 * CORS headers on every fulfilled response.
 *
 * The page is served from :5173 while the API base is a different origin
 * (CI builds with VITE_API_URL=http://localhost:3000/api; locally `env.ts`
 * defaults to `/api/admin`). `liffApi` does not send credentials
 * (src/lib/api.ts — withCredentials is intentionally omitted), so `*` is valid.
 */
const CORS_HEADERS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
};

/**
 * Mock LIFF API responses with route interception.
 *
 * The pattern is deliberately origin- AND prefix-agnostic (`**<path>*`): the real
 * base URL differs per environment (`/api/admin` by default, `http://localhost:3000/api`
 * in CI), so the old hardcoded `http://localhost:5173/api` never matched anything.
 *
 * NOTE: these routes only fire when the page's service worker is out of the way.
 * `public/sw.js` re-issues every `/api/*` GET from inside the worker
 * (`event.respondWith(fetch(request))`), and Playwright's `page.route` cannot see
 * service-worker-originated requests. Each LIFF spec therefore declares
 * `test.use({ serviceWorkers: 'block' })`.
 */
export async function mockLiffApi(
  page: Page,
  routes: Array<{
    method: 'GET' | 'POST';
    path: string;
    status?: number;
    body: unknown;
  }>,
) {
  for (const route of routes) {
    await page.route(`**${route.path}*`, async (r) => {
      const method = r.request().method();

      // Answer CORS preflight before the method check — an OPTIONS request is
      // never the route's declared method and must not fall through.
      if (method === 'OPTIONS') {
        await r.fulfill({ status: 204, headers: CORS_HEADERS });
        return;
      }

      if (method === route.method) {
        await r.fulfill({
          status: route.status ?? 200,
          headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
          body: JSON.stringify(route.body),
        });
        return;
      }

      await r.continue();
    });
  }
}
