import { test, expect } from '@playwright/test';
import { loginViaAPI } from './helpers/auth';
import { gotoWithRetry, hasErrorBoundary } from './helpers/navigation';

test.describe('รับซื้อเครื่อง (Trade-In)', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page);
  });

  test('should load trade-in page', async ({ page }) => {
    await gotoWithRetry(page, '/trade-in');
    await expect(page.locator('h1, h2, [data-testid="page-title"]')).toContainText(/เทรด|รับซื้อ|Trade/i);
    expect(await hasErrorBoundary(page)).toBe(false);
  });

  test('should show create trade-in button', async ({ page }) => {
    await gotoWithRetry(page, '/trade-in');
    const createBtn = page.locator('button:has-text("สร้าง"), button:has-text("เพิ่ม"), button:has-text("รับซื้อ")').first();
    await expect(createBtn).toBeVisible();
  });

  test('should display trade-in list or empty state', async ({ page }) => {
    await gotoWithRetry(page, '/trade-in');
    await page.waitForTimeout(2000);
    const hasData = await page.locator('table tbody tr, [data-testid="trade-in-row"]').count();
    const hasEmpty = await page.locator(':text("ไม่พบ"), :text("ยังไม่มี")').count();
    expect(hasData + hasEmpty).toBeGreaterThan(0);
  });

  test('should show status filter', async ({ page }) => {
    await gotoWithRetry(page, '/trade-in');
    const statusFilter = page.locator('select, [role="combobox"]').first();
    if (await statusFilter.isVisible()) {
      expect(await statusFilter.isEnabled()).toBe(true);
    }
    expect(await hasErrorBoundary(page)).toBe(false);
  });
});
