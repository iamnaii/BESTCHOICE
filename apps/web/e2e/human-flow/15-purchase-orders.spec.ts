import { test, expect } from '@playwright/test';
import { loginViaAPI } from '../helpers/auth';
import { StepScreenshot } from '../helpers/screenshot';

/**
 * 15 - Purchase Orders Flow (Human-Like Interaction)
 *
 * ทดสอบ flow ใบสั่งซื้อ: ดูรายการ, ค้นหา, filter
 * Route: /purchase-orders
 * API: GET /purchase-orders
 */
test.describe('15 - Purchase Orders Flow', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page);
    await page.goto('/purchase-orders', { waitUntil: 'domcontentloaded' });
  });

  test('should display purchase orders page', async ({ page }) => {
    const ss = new StepScreenshot(page, '15-po-display');

    await expect(page).toHaveURL('/purchase-orders');
    await ss.capture('po-page-loaded');

    await expect(page.locator('text=ใบสั่งซื้อ').first()).toBeVisible();
    await ss.capture('po-header-visible');

    await page.waitForLoadState('networkidle');
    await ss.capture('data-loaded');

    await expect(page.locator('[data-sonner-toast][data-type="error"]')).not.toBeVisible();
    await ss.capture('no-error');
  });

  test('should search purchase orders', async ({ page }) => {
    const ss = new StepScreenshot(page, '15-po-search');

    await page.waitForLoadState('networkidle');
    await ss.capture('page-ready');

    const searchInput = page.locator('input[placeholder*="ค้นหา"], input[type="search"], input[type="text"]').first();
    if (await searchInput.isVisible()) {
      await searchInput.fill('PO');
      await ss.capture('typed-search');
      await page.waitForTimeout(500);
      await ss.capture('search-results');
    }
  });

  test('should filter purchase orders by status', async ({ page }) => {
    const ss = new StepScreenshot(page, '15-po-filter');

    await page.waitForLoadState('networkidle');
    await ss.capture('page-ready');

    // หา filter tabs หรือ select
    const filterTab = page.locator('button[role="tab"], [data-state]').nth(1);
    if (await filterTab.isVisible()) {
      await filterTab.click();
      await page.waitForTimeout(500);
      await ss.capture('filter-applied');
    }
  });

  test('should open create purchase order form', async ({ page }) => {
    const ss = new StepScreenshot(page, '15-po-create');

    await page.waitForLoadState('networkidle');
    await ss.capture('page-ready');

    const addBtn = page.locator('button:has-text("สร้าง"), button:has-text("เพิ่ม"), a:has-text("สร้าง")').first();
    if (await addBtn.isVisible()) {
      await addBtn.click();
      await page.waitForTimeout(500);
      await ss.capture('create-form-opened');
    }
  });
});
