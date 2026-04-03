import { Page, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const TEST_USER = {
  email: 'admin@bestchoice.com',
  password: 'admin1234',
};

/**
 * Multi-role test accounts (all seeded with the same password).
 * Used for role-based access testing.
 */
export type TestRole = 'OWNER' | 'BRANCH_MANAGER' | 'SALES' | 'ACCOUNTANT';

export const ROLE_ACCOUNTS: Record<TestRole, { email: string; password: string; name: string }> = {
  OWNER: { email: 'admin@bestchoice.com', password: 'admin1234', name: 'สุรชัย เจ้าของร้าน' },
  BRANCH_MANAGER: { email: 'manager.ladprao@bestchoice.com', password: 'admin1234', name: 'วิภา ผู้จัดการลาดพร้าว' },
  SALES: { email: 'sales1@bestchoice.com', password: 'admin1234', name: 'สมศักดิ์ พนักงานขาย' },
  ACCOUNTANT: { email: 'accountant@bestchoice.com', password: 'admin1234', name: 'พิมพ์ใจ ฝ่ายบัญชี' },
};

const AUTH_FILE = path.join(__dirname, '../../.playwright-auth.json');

// JWT expiry is 15m — treat token as stale after 12 min to be safe
const TOKEN_MAX_AGE_MS = 12 * 60 * 1000;

/**
 * Read the token saved by global-setup.ts.
 * Falls back to a fresh API login if the file is missing or the token is stale.
 */
async function getToken(page: Page): Promise<string> {
  if (fs.existsSync(AUTH_FILE)) {
    try {
      const auth = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf-8')) as {
        accessToken: string;
        timestamp: number;
      };
      if (auth.accessToken && Date.now() - auth.timestamp < TOKEN_MAX_AGE_MS) {
        return auth.accessToken;
      }
    } catch {
      // fall through to API login
    }
  }

  // Fallback: login directly (e.g. when running a single spec without globalSetup)
  const apiURL = process.env.API_DIRECT_URL || 'http://localhost:3000';
  const response = await page.request.post(`${apiURL}/api/auth/login`, {
    data: { email: TEST_USER.email, password: TEST_USER.password },
    headers: { 'X-Requested-With': 'XMLHttpRequest' },
  });

  if (!response.ok()) {
    throw new Error(`loginViaAPI fallback failed: HTTP ${response.status()}`);
  }

  const data = await response.json();
  if (!data.accessToken) {
    throw new Error('loginViaAPI fallback: no accessToken in response');
  }

  // Cache the fresh token so subsequent tests in this worker reuse it
  fs.writeFileSync(AUTH_FILE, JSON.stringify({ accessToken: data.accessToken, timestamp: Date.now() }));

  return data.accessToken;
}

/**
 * Login via the UI and store auth state.
 *
 * WebKit quirk: after a successful login the React Router navigation from
 * /login → / sometimes never fires in WebKit (Playwright). Chromium and
 * Firefox handle it fine with the natural 30 s wait. For WebKit we:
 *  1. Capture the login API response to extract the accessToken.
 *  2. Inject it into localStorage via addInitScript (api.ts reads and clears
 *     it on module init).
 *  3. Navigate to / manually so the app boots with auth already in memory.
 */
export async function loginAsAdmin(page: Page) {
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#email');
  await page.fill('#email', TEST_USER.email);
  await page.fill('#password', TEST_USER.password);

  const isWebkit = page.context().browser()?.browserType().name() === 'webkit';

  if (isWebkit) {
    // Capture login response alongside click so we can extract the token
    const [response] = await Promise.all([
      page.waitForResponse(
        (resp) => resp.url().includes('/api/auth/login') && resp.request().method() === 'POST',
        { timeout: 15000 },
      ),
      page.click('button[type="submit"]'),
    ]);

    if (response.ok()) {
      const data = await response.json().catch(() => ({}));
      const token = (data as { accessToken?: string }).accessToken;
      if (token) {
        // addInitScript runs before any script on every subsequent page load
        await page.addInitScript((t: string) => {
          localStorage.setItem('access_token', t);
        }, token);
        await page.goto('/', { waitUntil: 'domcontentloaded' });
      }
    }
  } else {
    await page.click('button[type="submit"]');
  }

  // Wait for redirect to dashboard — use toHaveURL which polls the URL
  await expect(page).toHaveURL('/', { timeout: 30000 });
  await page.waitForSelector('.sidebar', { timeout: 15000 });
}

/**
 * Login via cached token from global-setup (fast, no rate-limit risk).
 * Uses addInitScript so the token survives full page reloads — the app's
 * api.ts reads localStorage('access_token') on module init then deletes it,
 * so we must re-inject it before every page load.
 */
export async function loginViaAPI(page: Page) {
  const token = await getToken(page);

  // Set Authorization header for page.request API calls
  await page.setExtraHTTPHeaders({
    Authorization: `Bearer ${token}`,
    'X-Requested-With': 'XMLHttpRequest',
  });

  // addInitScript runs before ANY script on every page load (including navigations).
  // This ensures api.ts always finds the token in localStorage on module init.
  await page.addInitScript((t: string) => {
    localStorage.setItem('access_token', t);
  }, token);

  // Navigate to dashboard — token is injected before the SPA boots
  await page.goto('/', { waitUntil: 'domcontentloaded' });

  // Wait for auth to resolve — use toHaveURL (polls) instead of waitForURL
  await expect(page).toHaveURL('/', { timeout: 30000 });
}

/**
 * Per-worker token cache for role-based logins.
 * Avoids hitting the login API for every test in the same worker,
 * which would trigger ThrottlerGuard rate limiting.
 */
const roleTokenCache: Partial<Record<TestRole, { token: string; timestamp: number }>> = {};
const ROLE_TOKEN_MAX_AGE_MS = 10 * 60 * 1000; // 10 min (JWT expires at 15 min)

/**
 * Login as a specific role via API (cached per worker to avoid rate limiting).
 * Use this for role-based access tests where you need non-OWNER accounts.
 */
export async function loginAsRole(page: Page, role: TestRole) {
  let token: string;

  const cached = roleTokenCache[role];
  if (cached && Date.now() - cached.timestamp < ROLE_TOKEN_MAX_AGE_MS) {
    token = cached.token;
  } else {
    const account = ROLE_ACCOUNTS[role];
    const apiURL = process.env.API_DIRECT_URL || 'http://localhost:3000';
    const response = await page.request.post(`${apiURL}/api/auth/login`, {
      data: { email: account.email, password: account.password },
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
    });

    if (!response.ok()) {
      throw new Error(`loginAsRole(${role}) failed: HTTP ${response.status()}`);
    }

    const data = await response.json();
    if (!data.accessToken) {
      throw new Error(`loginAsRole(${role}): no accessToken in response`);
    }

    token = data.accessToken;
    roleTokenCache[role] = { token, timestamp: Date.now() };
  }

  await page.setExtraHTTPHeaders({
    Authorization: `Bearer ${token}`,
    'X-Requested-With': 'XMLHttpRequest',
  });

  await page.addInitScript((t: string) => {
    localStorage.setItem('access_token', t);
  }, token);

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL('/', { timeout: 30000 });
}

/**
 * Get auth headers for page.request API calls
 */
export function getAuthHeaders(): Record<string, string> {
  if (fs.existsSync(AUTH_FILE)) {
    try {
      const auth = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf-8')) as { accessToken: string };
      if (auth.accessToken) {
        return {
          'X-Requested-With': 'XMLHttpRequest',
          Authorization: `Bearer ${auth.accessToken}`,
        };
      }
    } catch {
      // fall through
    }
  }
  return { 'X-Requested-With': 'XMLHttpRequest' };
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
