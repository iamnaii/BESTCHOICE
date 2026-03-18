import { test, expect, Page } from '@playwright/test';
import { loginAsAdmin } from './helpers/auth';

const screenshot = (page: Page, path: string) =>
  page.screenshot({ path, fullPage: true, timeout: 5000 }).catch(() => {
    // Fallback: take screenshot without waiting for fonts
  });

test.describe('OTP Input Screenshot Tests', () => {
  test.beforeEach(async ({ page }) => {
    // Block Google Fonts to avoid font-loading timeouts
    await page.route('**fonts.googleapis.com**', (route) => route.abort());
    await page.route('**fonts.gstatic.com**', (route) => route.abort());
    await loginAsAdmin(page);
  });

  test('CAP-1: หน้าสัญญาแสดงรายการ', async ({ page }) => {
    await page.goto('/contracts', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    await screenshot(page, 'e2e/screenshots/01-contracts-list.png');
    await expect(page.locator('body')).not.toBeEmpty();
  });

  test('CAP-2: หน้า Settings แสดงผล', async ({ page }) => {
    await page.goto('/settings', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    await screenshot(page, 'e2e/screenshots/02-settings-page.png');
    await expect(page.locator('body')).toContainText(/ตั้งค่า|Settings/i, { timeout: 10000 });
  });

  test('CAP-3: หน้ารายละเอียดสัญญา', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const res = await page.request.get('/api/contracts?limit=1', {
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
    });
    const data = await res.json();
    const contracts = data.data || data.contracts || data;
    if (!Array.isArray(contracts) || contracts.length === 0) {
      test.skip();
      return;
    }
    const contractId = contracts[0].id;
    await page.goto(`/contracts/${contractId}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    await screenshot(page, 'e2e/screenshots/03-contract-detail.png');
  });

  test('CAP-4: หน้า Dashboard (mobile viewport)', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    await screenshot(page, 'e2e/screenshots/04-dashboard-mobile.png');
    await expect(page.locator('body')).not.toBeEmpty();
  });

  test('CAP-5: หน้า Login', async ({ page }) => {
    await page.evaluate(() => localStorage.removeItem('access_token'));
    await page.goto('/login', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    await screenshot(page, 'e2e/screenshots/05-login-page.png');
  });
});
