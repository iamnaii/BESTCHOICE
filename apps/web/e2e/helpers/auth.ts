import { Page } from '@playwright/test';

export const TEST_USER = {
  email: 'admin@bestchoice.com',
  password: 'admin1234',
};

// Cache token across tests to avoid hitting rate limits (30 login/min)
let cachedToken: string | null = null;
let tokenTimestamp = 0;
const TOKEN_MAX_AGE_MS = 90 * 60 * 1000; // Refresh token after 90 minutes

/**
 * Login via the UI and store auth state
 */
export async function loginAsAdmin(page: Page) {
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#email');
  await page.fill('#email', TEST_USER.email);
  await page.fill('#password', TEST_USER.password);
  await page.click('button[type="submit"]');
  // Wait for redirect to dashboard
  await page.waitForURL('/', { timeout: 15000, waitUntil: 'domcontentloaded' });
}

/**
 * Login via API (faster, for tests that don't test login UI)
 * Caches the token to avoid rate limiting on repeated calls.
 *
 * Uses the API port directly (not the web proxy) because in CI the web is
 * served by `npx serve` which does NOT proxy /api requests the way Vite dev
 * server does — calls to :5173/api would receive index.html, not JSON.
 */
export async function loginViaAPI(page: Page) {
  const isExpired = Date.now() - tokenTimestamp > TOKEN_MAX_AGE_MS;
  if (!cachedToken || isExpired) {
    // Use the API directly on its port to avoid dev-server proxy differences
    const apiURL = process.env.API_DIRECT_URL || 'http://localhost:3000';

    const response = await page.request.post(`${apiURL}/api/auth/login`, {
      data: {
        email: TEST_USER.email,
        password: TEST_USER.password,
      },
      headers: {
        'X-Requested-With': 'XMLHttpRequest',
      },
    });

    const data = await response.json();
    cachedToken = data.accessToken;
    tokenTimestamp = Date.now();
  }

  // Set Authorization header for page.request API calls
  await page.setExtraHTTPHeaders({
    'Authorization': `Bearer ${cachedToken}`,
    'X-Requested-With': 'XMLHttpRequest',
  });

  // Navigate to login page first (guaranteed to exist without auth)
  await page.goto('/login', { waitUntil: 'domcontentloaded' });

  // Set the access token in localStorage before navigating to protected routes
  await page.evaluate((token: string) => {
    localStorage.setItem('access_token', token);
  }, cachedToken!);

  // Now navigate to dashboard — the token is already set
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForURL('/', { timeout: 15000, waitUntil: 'domcontentloaded' });
}

/**
 * Get auth headers for page.request API calls
 */
export function getAuthHeaders() {
  return {
    'X-Requested-With': 'XMLHttpRequest',
    ...(cachedToken ? { 'Authorization': `Bearer ${cachedToken}` } : {}),
  };
}

/**
 * Logout and clear state
 */
export async function logout(page: Page) {
  await page.evaluate(() => {
    localStorage.removeItem('access_token');
  });
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
}
