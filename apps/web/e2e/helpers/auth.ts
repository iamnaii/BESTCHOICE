import { Page } from '@playwright/test';

export const TEST_USER = {
  email: 'admin@bestchoice.com',
  password: 'admin1234',
};

// Cache token across tests to avoid hitting rate limits (30 login/min)
let cachedToken: string | null = null;

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
  if (!cachedToken) {
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
  }

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
 * Logout and clear state
 */
export async function logout(page: Page) {
  await page.evaluate(() => {
    localStorage.removeItem('access_token');
  });
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
}
