import { test, expect } from '@playwright/test';
import { loginViaAPI } from '../helpers/auth';
import { StepScreenshot } from '../helpers/screenshot';

/**
 * 16 - Sales, Receipts & Exchange Flow (Human-Like Interaction)
 *
 * ทดสอบ flow ขาย, ใบเสร็จ, และเปลี่ยนเครื่อง
 * Routes: /sales, /receipts, /exchange, /slip-review
 */
test.describe('16 - Sales & Receipts Flow', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page);
  });

  test('should display sales page', async ({ page }) => {
    const ss = new StepScreenshot(page, '16-sales-display');

    await page.goto('/sales', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL('/sales');
    await ss.capture('sales-page-loaded');

    await page.waitForLoadState('networkidle');
    await ss.capture('data-loaded');

    await expect(page.locator('[data-sonner-toast][data-type="error"]')).not.toBeVisible();
    await ss.capture('no-error');
  });

  test('should display receipts page', async ({ page }) => {
    const ss = new StepScreenshot(page, '16-receipts-display');

    await page.goto('/receipts', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL('/receipts');
    await ss.capture('receipts-page-loaded');

    await page.waitForLoadState('networkidle');
    await ss.capture('data-loaded');

    await expect(page.locator('[data-sonner-toast][data-type="error"]')).not.toBeVisible();
    await ss.capture('no-error');
  });

  test('should display exchange page', async ({ page }) => {
    const ss = new StepScreenshot(page, '16-exchange-display');

    await page.goto('/exchange', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL('/exchange');
    await ss.capture('exchange-page-loaded');

    await page.waitForLoadState('networkidle');
    await ss.capture('data-loaded');

    await expect(page.locator('[data-sonner-toast][data-type="error"]')).not.toBeVisible();
    await ss.capture('no-error');
  });

  test('should display slip review page', async ({ page }) => {
    const ss = new StepScreenshot(page, '16-slip-review-display');

    await page.goto('/slip-review', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL('/slip-review');
    await ss.capture('slip-review-page-loaded');

    await page.waitForLoadState('networkidle');
    await ss.capture('data-loaded');

    await expect(page.locator('[data-sonner-toast][data-type="error"]')).not.toBeVisible();
    await ss.capture('no-error');
  });
});
