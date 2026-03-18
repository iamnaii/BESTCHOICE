import { test, expect } from '@playwright/test';
import { loginViaAPI } from '../helpers/auth';
import { StepScreenshot } from '../helpers/screenshot';

/**
 * 20 - Financial Pages Flow (Human-Like Interaction)
 *
 * ทดสอบ flow การเงิน:
 * /credit-checks, /financial-audit, /payments/import-csv
 */
test.describe('20 - Financial Flow', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page);
  });

  test('should display credit checks page', async ({ page }) => {
    const ss = new StepScreenshot(page, '20-credit-checks');

    await page.goto('/credit-checks', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL('/credit-checks');
    await ss.capture('credit-checks-page-loaded');

    await page.waitForLoadState('networkidle');
    await ss.capture('data-loaded');

    await expect(page.locator('[data-sonner-toast][data-type="error"]')).not.toBeVisible();
    await ss.capture('no-error');
  });

  test('should display financial audit page', async ({ page }) => {
    const ss = new StepScreenshot(page, '20-financial-audit');

    await page.goto('/financial-audit', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL('/financial-audit');
    await ss.capture('financial-audit-page-loaded');

    await page.waitForLoadState('networkidle');
    await ss.capture('data-loaded');

    await expect(page.locator('[data-sonner-toast][data-type="error"]')).not.toBeVisible();
    await ss.capture('no-error');
  });

  test('should display payment import CSV page', async ({ page }) => {
    const ss = new StepScreenshot(page, '20-payment-import');

    await page.goto('/payments/import-csv', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL('/payments/import-csv');
    await ss.capture('import-csv-page-loaded');

    await page.waitForLoadState('networkidle');
    await ss.capture('data-loaded');

    await expect(page.locator('[data-sonner-toast][data-type="error"]')).not.toBeVisible();
    await ss.capture('no-error');
  });
});
