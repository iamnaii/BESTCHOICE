import { test, expect } from '@playwright/test';
import { loginViaAPI } from '../helpers/auth';
import { StepScreenshot } from '../helpers/screenshot';

/**
 * 21 - System Pages Flow (Human-Like Interaction)
 *
 * ทดสอบหน้าระบบ:
 * /notifications, /system-status, /repossessions, /migration, /pdpa
 */
test.describe('21 - System Pages Flow', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page);
  });

  test('should display notifications page', async ({ page }) => {
    const ss = new StepScreenshot(page, '21-notifications');

    await page.goto('/notifications', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL('/notifications');
    await ss.capture('notifications-page-loaded');

    await page.waitForLoadState('networkidle');
    await ss.capture('data-loaded');

    await expect(page.locator('[data-sonner-toast][data-type="error"]')).not.toBeVisible();
    await ss.capture('no-error');
  });

  test('should display system status page', async ({ page }) => {
    const ss = new StepScreenshot(page, '21-system-status');

    await page.goto('/system-status', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL('/system-status');
    await ss.capture('system-status-page-loaded');

    await page.waitForLoadState('networkidle');
    await ss.capture('data-loaded');

    await expect(page.locator('[data-sonner-toast][data-type="error"]')).not.toBeVisible();
    await ss.capture('no-error');
  });

  test('should display repossessions page', async ({ page }) => {
    const ss = new StepScreenshot(page, '21-repossessions');

    await page.goto('/repossessions', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL('/repossessions');
    await ss.capture('repossessions-page-loaded');

    await page.waitForLoadState('networkidle');
    await ss.capture('data-loaded');

    await expect(page.locator('[data-sonner-toast][data-type="error"]')).not.toBeVisible();
    await ss.capture('no-error');
  });

  test('should display PDPA page', async ({ page }) => {
    const ss = new StepScreenshot(page, '21-pdpa');

    await page.goto('/pdpa', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL('/pdpa');
    await ss.capture('pdpa-page-loaded');

    await page.waitForLoadState('networkidle');
    await ss.capture('data-loaded');

    await expect(page.locator('[data-sonner-toast][data-type="error"]')).not.toBeVisible();
    await ss.capture('no-error');
  });
});
