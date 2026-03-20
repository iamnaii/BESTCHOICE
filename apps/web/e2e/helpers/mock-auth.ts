import { Page } from '@playwright/test';

/**
 * Mock login — sets up route mocking for auth endpoints
 * so tests can run WITHOUT a real API server.
 *
 * Mocks: /api/auth/me, /api/auth/login, /api/auth/logout
 */
export async function loginWithMock(page: Page) {
  const fakeToken = 'mock-test-token-12345';
  const mockUser = {
    id: 'user-001',
    email: 'admin@bestchoice.com',
    name: 'Admin',
    role: 'OWNER',
    branchId: 'branch-1',
    branchName: 'สาขาหลัก',
  };

  // Mock /api/auth/me
  await page.route('**/api/auth/me', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(mockUser),
    });
  });

  // Mock /api/auth/login
  await page.route('**/api/auth/login', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ accessToken: fakeToken, user: mockUser }),
    });
  });

  // Mock /api/auth/logout
  await page.route('**/api/auth/logout', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) });
  });

  // Navigate to login page first
  await page.goto('/login', { waitUntil: 'domcontentloaded' });

  // Set token in localStorage
  await page.evaluate((token: string) => {
    localStorage.setItem('access_token', token);
  }, fakeToken);

  // Navigate to dashboard
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
}
