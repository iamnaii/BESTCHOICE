import { test, expect } from '@playwright/test';
import { loginViaAPI } from '../helpers/auth';
import { StepScreenshot } from '../helpers/screenshot';

/**
 * 19 - Documents Flow (Human-Like Interaction)
 *
 * ทดสอบ flow เอกสาร:
 * /contract-templates, /stickers, /document-dashboard
 */
test.describe('19 - Documents Flow', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page);
  });

  test('should display contract templates page', async ({ page }) => {
    const ss = new StepScreenshot(page, '19-contract-templates');

    await page.goto('/contract-templates', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL('/contract-templates');
    await ss.capture('templates-page-loaded');

    await page.waitForLoadState('networkidle');
    await ss.capture('data-loaded');

    await expect(page.locator('[data-sonner-toast][data-type="error"]')).not.toBeVisible();
    await ss.capture('no-error');
  });

  test('should display stickers page', async ({ page }) => {
    const ss = new StepScreenshot(page, '19-stickers');

    await page.goto('/stickers', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL('/stickers');
    await ss.capture('stickers-page-loaded');

    await page.waitForLoadState('networkidle');
    await ss.capture('data-loaded');

    await expect(page.locator('[data-sonner-toast][data-type="error"]')).not.toBeVisible();
    await ss.capture('no-error');
  });

  test('should display document dashboard page', async ({ page }) => {
    const ss = new StepScreenshot(page, '19-document-dashboard');

    await page.goto('/document-dashboard', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL('/document-dashboard');
    await ss.capture('doc-dashboard-page-loaded');

    await page.waitForLoadState('networkidle');
    await ss.capture('data-loaded');

    await expect(page.locator('[data-sonner-toast][data-type="error"]')).not.toBeVisible();
    await ss.capture('no-error');
  });
});
