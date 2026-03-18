import { test, expect } from '@playwright/test';
import { loginViaAPI } from '../helpers/auth';
import { StepScreenshot } from '../helpers/screenshot';

/**
 * 17 - Advanced Stock Pages Flow (Human-Like Interaction)
 *
 * ทดสอบหน้า stock ที่ยังไม่ถูก test:
 * /stock/adjustments, /stock/alerts, /stock/count, /stock/branch-receiving, /inventory
 */
test.describe('17 - Advanced Stock Flow', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page);
  });

  test('should display stock adjustments page', async ({ page }) => {
    const ss = new StepScreenshot(page, '17-stock-adjustments');

    await page.goto('/stock/adjustments', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL('/stock/adjustments');
    await ss.capture('adjustments-page-loaded');

    await page.waitForLoadState('networkidle');
    await ss.capture('data-loaded');

    await expect(page.locator('[data-sonner-toast][data-type="error"]')).not.toBeVisible();
    await ss.capture('no-error');
  });

  test('should display stock alerts page', async ({ page }) => {
    const ss = new StepScreenshot(page, '17-stock-alerts');

    await page.goto('/stock/alerts', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL('/stock/alerts');
    await ss.capture('alerts-page-loaded');

    await page.waitForLoadState('networkidle');
    await ss.capture('data-loaded');

    await expect(page.locator('[data-sonner-toast][data-type="error"]')).not.toBeVisible();
    await ss.capture('no-error');
  });

  test('should display stock count page', async ({ page }) => {
    const ss = new StepScreenshot(page, '17-stock-count');

    await page.goto('/stock/count', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL('/stock/count');
    await ss.capture('count-page-loaded');

    await page.waitForLoadState('networkidle');
    await ss.capture('data-loaded');

    await expect(page.locator('[data-sonner-toast][data-type="error"]')).not.toBeVisible();
    await ss.capture('no-error');
  });

  test('should display branch receiving page', async ({ page }) => {
    const ss = new StepScreenshot(page, '17-branch-receiving');

    await page.goto('/stock/branch-receiving', { waitUntil: 'domcontentloaded' });
    // /stock/branch-receiving redirects to /stock/transfers?view=incoming
    await expect(page).toHaveURL(/\/stock\/(branch-receiving|transfers)/);
    await ss.capture('branch-receiving-page-loaded');

    await page.waitForLoadState('networkidle');
    await ss.capture('data-loaded');

    await expect(page.locator('[data-sonner-toast][data-type="error"]')).not.toBeVisible();
    await ss.capture('no-error');
  });

  test('should display inventory page', async ({ page }) => {
    const ss = new StepScreenshot(page, '17-inventory');

    await page.goto('/inventory', { waitUntil: 'domcontentloaded' });
    // /inventory may redirect to /stock
    await expect(page).toHaveURL(/\/(inventory|stock)/);
    await ss.capture('inventory-page-loaded');

    await page.waitForLoadState('networkidle');
    await ss.capture('data-loaded');

    await expect(page.locator('[data-sonner-toast][data-type="error"]')).not.toBeVisible();
    await ss.capture('no-error');
  });
});
