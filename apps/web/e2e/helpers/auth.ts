import { Page } from '@playwright/test';

export const TEST_USER = {
  email: 'admin@bestchoice.com',
  password: 'admin1234',
};

/**
 * Login via the UI and store auth state
 */
export async function loginAsAdmin(page: Page) {
  await page.goto('/login');
  await page.waitForSelector('#email');
  await page.fill('#email', TEST_USER.email);
  await page.fill('#password', TEST_USER.password);
  await page.click('button[type="submit"]');
  // Wait for redirect to dashboard
  await page.waitForURL('/', { timeout: 15000 });
}

/**
 * Login via API (faster, for tests that don't test login UI)
 */
export async function loginViaAPI(page: Page) {
  const baseURL = page.url().startsWith('http')
    ? new URL(page.url()).origin
    : 'http://localhost:5173';

  const response = await page.request.post(`${baseURL}/api/auth/login`, {
    data: {
      email: TEST_USER.email,
      password: TEST_USER.password,
    },
  });

  const data = await response.json();

  // Set the access token in localStorage
  await page.goto('/');
  await page.evaluate((token: string) => {
    localStorage.setItem('access_token', token);
  }, data.accessToken);

  // Reload to pick up the token
  await page.reload();
  await page.waitForURL('/');
}

/**
 * Logout and clear state
 */
export async function logout(page: Page) {
  await page.evaluate(() => {
    localStorage.removeItem('access_token');
  });
  await page.goto('/login');
}
