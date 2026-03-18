import { test, expect } from '@playwright/test';
import { loginViaAPI } from '../helpers/auth';
import { StepScreenshot } from '../helpers/screenshot';

/**
 * 18 - Advanced Settings Flow (Human-Like Interaction)
 *
 * ทดสอบ settings ที่ยังไม่ถูก test:
 * /settings/line-oa, /settings/sms
 */
test.describe('18 - Advanced Settings Flow', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page);
  });

  test('should display LINE OA settings page', async ({ page }) => {
    const ss = new StepScreenshot(page, '18-settings-line-oa');

    await page.goto('/settings/line-oa', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL('/settings/line-oa');
    await ss.capture('line-oa-page-loaded');

    await page.waitForLoadState('networkidle');
    await ss.capture('data-loaded');

    // ตรวจสอบ header
    await expect(page.locator('text=LINE').first()).toBeVisible();
    await ss.capture('line-header-visible');

    await expect(page.locator('[data-sonner-toast][data-type="error"]')).not.toBeVisible();
    await ss.capture('no-error');
  });

  test('should display SMS settings page', async ({ page }) => {
    const ss = new StepScreenshot(page, '18-settings-sms');

    await page.goto('/settings/sms', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL('/settings/sms');
    await ss.capture('sms-page-loaded');

    await page.waitForLoadState('networkidle');
    await ss.capture('data-loaded');

    // ตรวจสอบ header
    await expect(page.locator('text=SMS').first()).toBeVisible();
    await ss.capture('sms-header-visible');

    await expect(page.locator('[data-sonner-toast][data-type="error"]')).not.toBeVisible();
    await ss.capture('no-error');
  });
});
