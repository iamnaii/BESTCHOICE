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
 */
export async function loginViaAPI(page: Page) {
  const isExpired = Date.now() - tokenTimestamp > TOKEN_MAX_AGE_MS;
  if (!cachedToken || isExpired) {
    const baseURL = 'http://localhost:5173';

    const response = await page.request.post(`${baseURL}/api/auth/login`, {
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
 * Get the cached access token (for tests that need the raw token).
 * After the localStorage→memory migration, tokens are no longer in localStorage.
 */
export function getAuthToken(): string | null {
  return cachedToken;
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
