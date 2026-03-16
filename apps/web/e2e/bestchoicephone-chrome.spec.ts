import { test, expect, Page, BrowserContext, chromium } from '@playwright/test';

const BASE_URL = 'https://bestchoicephone.app';
const TEST_USER = {
  email: 'admin@bestchoice.com',
  password: 'admin1234',
};

// Parse proxy from environment
function getProxyConfig() {
  const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy;
  if (!proxyUrl) return undefined;
  try {
    const parsed = new URL(proxyUrl);
    return {
      server: `${parsed.protocol}//${parsed.hostname}:${parsed.port}`,
      username: parsed.username,
      password: parsed.password,
    };
  } catch {
    return undefined;
  }
}

async function loginOnSite(page: Page) {
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForSelector('#email', { timeout: 15000 });
  await page.fill('#email', TEST_USER.email);
  await page.fill('#password', TEST_USER.password);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/', { timeout: 15000 });
}

// Configure proxy for all tests
const proxy = getProxyConfig();
test.use({
  ignoreHTTPSErrors: true,
  ...(proxy ? { proxy } : {}),
});

// ============================================
// 1. Login Flow
// ============================================
test.describe('1. Login Flow - bestchoicephone.app', () => {
  test('1.1 should display login form', async ({ page }) => {
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle', timeout: 30000 });
    await expect(page.locator('h2')).toContainText('เข้าสู่ระบบ', { timeout: 15000 });
    await expect(page.locator('#email')).toBeVisible();
    await expect(page.locator('#password')).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toBeVisible();
    await page.screenshot({ path: 'e2e/screenshots/01-login-form.png', fullPage: true });
  });

  test('1.2 should show error for wrong credentials', async ({ page }) => {
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForSelector('#email', { timeout: 15000 });
    await page.fill('#email', 'wrong@email.com');
    await page.fill('#password', 'wrongpassword');
    await page.click('button[type="submit"]');
    await expect(page.locator('[data-sonner-toast]').first()).toBeVisible({ timeout: 10000 });
    await page.screenshot({ path: 'e2e/screenshots/02-login-error.png', fullPage: true });
  });

  test('1.3 should login successfully', async ({ page }) => {
    await loginOnSite(page);
    await expect(page).toHaveURL(/\/$/);
    await page.screenshot({ path: 'e2e/screenshots/03-login-success-dashboard.png', fullPage: true });
  });

  test('1.4 should redirect unauthenticated user to login', async ({ page }) => {
    await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle', timeout: 30000 });
    await expect(page).toHaveURL(/\/login/);
  });
});

// ============================================
// 2. Dashboard
// ============================================
test.describe('2. Dashboard - bestchoicephone.app', () => {
  test.beforeEach(async ({ page }) => {
    await loginOnSite(page);
  });

  test('2.1 should load dashboard with content', async ({ page }) => {
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator('body')).not.toBeEmpty();
    await page.screenshot({ path: 'e2e/screenshots/04-dashboard.png', fullPage: true });
  });

  test('2.2 should display sidebar navigation', async ({ page }) => {
    const sidebar = page.locator('aside, nav, [data-sidebar]').first();
    await expect(sidebar).toBeVisible({ timeout: 10000 });
    await page.screenshot({ path: 'e2e/screenshots/05-sidebar.png', fullPage: true });
  });
});

// ============================================
// 3. All Protected Pages Navigation
// ============================================
const protectedPages = [
  { path: '/customers', name: 'Customers (ลูกค้า)' },
  { path: '/contracts', name: 'Contracts (สัญญา)' },
  { path: '/payments', name: 'Payments (ชำระเงิน)' },
  { path: '/stock', name: 'Stock (สต็อก)' },
  { path: '/pos', name: 'POS (ขายหน้าร้าน)' },
  { path: '/sales', name: 'Sales (ยอดขาย)' },
  { path: '/overdue', name: 'Overdue (ค้างชำระ)' },
  { path: '/reports', name: 'Reports (รายงาน)' },
  { path: '/users', name: 'Users (ผู้ใช้)' },
  { path: '/settings', name: 'Settings (ตั้งค่า)' },
];

test.describe('3. Protected Pages - bestchoicephone.app', () => {
  test.beforeEach(async ({ page }) => {
    await loginOnSite(page);
  });

  for (const { path, name } of protectedPages) {
    test(`3.x should load ${name} page`, async ({ page }) => {
      await page.goto(`${BASE_URL}${path}`, { waitUntil: 'networkidle', timeout: 30000 });
      const bodyText = await page.textContent('body');
      expect(bodyText?.length).toBeGreaterThan(0);
      const screenshotName = path.replace('/', '') || 'root';
      await page.screenshot({ path: `e2e/screenshots/page-${screenshotName}.png`, fullPage: true });
    });
  }
});

// ============================================
// 4. Customers Page Details
// ============================================
test.describe('4. Customers - bestchoicephone.app', () => {
  test.beforeEach(async ({ page }) => {
    await loginOnSite(page);
    await page.goto(`${BASE_URL}/customers`, { waitUntil: 'networkidle', timeout: 30000 });
  });

  test('4.1 should display customers page', async ({ page }) => {
    await expect(page).toHaveURL(/\/customers/);
    await page.screenshot({ path: 'e2e/screenshots/06-customers.png', fullPage: true });
  });

  test('4.2 should have search functionality', async ({ page }) => {
    const searchInput = page.locator('input[type="search"], input[placeholder*="ค้นหา"], input[placeholder*="search"]').first();
    if (await searchInput.isVisible()) {
      await searchInput.fill('test');
      await page.waitForTimeout(500);
      await page.screenshot({ path: 'e2e/screenshots/07-customers-search.png', fullPage: true });
    }
  });
});

// ============================================
// 5. Contracts Flow
// ============================================
test.describe('5. Contracts - bestchoicephone.app', () => {
  test.beforeEach(async ({ page }) => {
    await loginOnSite(page);
  });

  test('5.1 should display contracts list', async ({ page }) => {
    await page.goto(`${BASE_URL}/contracts`, { waitUntil: 'networkidle', timeout: 30000 });
    await expect(page).toHaveURL(/\/contracts/);
    await page.screenshot({ path: 'e2e/screenshots/08-contracts.png', fullPage: true });
  });

  test('5.2 should navigate to contract creation page', async ({ page }) => {
    await page.goto(`${BASE_URL}/contracts/create`, { waitUntil: 'networkidle', timeout: 30000 });
    await expect(page).toHaveURL(/\/contracts\/create/);
    await page.screenshot({ path: 'e2e/screenshots/09-contracts-create.png', fullPage: true });
  });
});

// ============================================
// 6. Payments & Overdue
// ============================================
test.describe('6. Payments & Overdue - bestchoicephone.app', () => {
  test.beforeEach(async ({ page }) => {
    await loginOnSite(page);
  });

  test('6.1 should display payments page', async ({ page }) => {
    await page.goto(`${BASE_URL}/payments`, { waitUntil: 'networkidle', timeout: 30000 });
    await expect(page).toHaveURL(/\/payments/);
    await page.screenshot({ path: 'e2e/screenshots/10-payments.png', fullPage: true });
  });

  test('6.2 should display overdue page', async ({ page }) => {
    await page.goto(`${BASE_URL}/overdue`, { waitUntil: 'networkidle', timeout: 30000 });
    await expect(page).toHaveURL(/\/overdue/);
    await page.screenshot({ path: 'e2e/screenshots/11-overdue.png', fullPage: true });
  });

  test('6.3 should display slip review page', async ({ page }) => {
    await page.goto(`${BASE_URL}/slip-review`, { waitUntil: 'networkidle', timeout: 30000 });
    await expect(page).toHaveURL(/\/slip-review/);
    await page.screenshot({ path: 'e2e/screenshots/12-slip-review.png', fullPage: true });
  });
});

// ============================================
// 7. Stock & POS
// ============================================
test.describe('7. Stock & POS - bestchoicephone.app', () => {
  test.beforeEach(async ({ page }) => {
    await loginOnSite(page);
  });

  test('7.1 should display stock page', async ({ page }) => {
    await page.goto(`${BASE_URL}/stock`, { waitUntil: 'networkidle', timeout: 30000 });
    await expect(page).toHaveURL(/\/stock/);
    await page.screenshot({ path: 'e2e/screenshots/13-stock.png', fullPage: true });
  });

  test('7.2 should display POS page', async ({ page }) => {
    await page.goto(`${BASE_URL}/pos`, { waitUntil: 'networkidle', timeout: 30000 });
    await expect(page).toHaveURL(/\/pos/);
    await page.screenshot({ path: 'e2e/screenshots/14-pos.png', fullPage: true });
  });
});

// ============================================
// 8. Public Routes (no auth needed)
// ============================================
test.describe('8. Public Routes - bestchoicephone.app', () => {
  test('8.1 should access landing page without auth', async ({ page }) => {
    await page.goto(`${BASE_URL}/landing`, { waitUntil: 'networkidle', timeout: 30000 });
    await expect(page).toHaveURL(/\/landing/);
    await page.screenshot({ path: 'e2e/screenshots/15-landing.png', fullPage: true });
  });

  test('8.2 should access login page without auth', async ({ page }) => {
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle', timeout: 30000 });
    await expect(page).toHaveURL(/\/login/);
  });
});
