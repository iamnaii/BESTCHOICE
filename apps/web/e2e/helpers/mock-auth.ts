import { Page } from '@playwright/test';

/**
 * Mock login — sets up route mocking for auth endpoints
 * so tests can run WITHOUT a real API server.
 *
 * Mocks: /api/auth/me, /api/auth/login, /api/auth/logout, /api/auth/refresh
 * Also mocks all other /api/* endpoints as fallback to prevent 401 cascades
 * when the real API server is not running.
 *
 * Route registration order matters: Playwright uses LIFO (Last In, First Out),
 * so the fallback must be registered FIRST, then specific routes AFTER.
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

  // ── 1. Fallback FIRST (lowest priority in LIFO) ──
  // Mock ALL /api/* requests with empty 200 responses to prevent 401 cascades
  // from unhandled API calls hitting the Vite proxy.
  await page.route('**/api/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({}),
    });
  });

  // ── 2. Specific auth routes AFTER (higher priority in LIFO) ──

  // Mock /api/auth/me — must include branch.name for AuthContext
  await page.route('**/api/auth/me', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ...mockUser, branch: { name: mockUser.branchName } }),
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

  // Mock /api/auth/refresh — prevents 401 cascade from triggering redirect
  await page.route('**/api/auth/refresh', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ accessToken: fakeToken }),
    });
  });

  // Navigate to login page first
  await page.goto('/login', { waitUntil: 'domcontentloaded' });

  // Set token in localStorage
  await page.evaluate((token: string) => {
    localStorage.setItem('access_token', token);
  }, fakeToken);

  // Navigate to dashboard — waitUntil domcontentloaded to avoid timeout on mocked APIs
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
}
