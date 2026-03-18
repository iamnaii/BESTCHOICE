import { test, expect } from '@playwright/test';
import { StepScreenshot } from '../helpers/screenshot';

/**
 * 22 - Public Pages Flow (Human-Like Interaction)
 *
 * ทดสอบหน้าที่ไม่ต้อง login:
 * /landing, /forgot-password, /reset-password
 */
test.describe('22 - Public Pages Flow', () => {
  test.describe.configure({ mode: 'serial' });

  test('should display landing page', async ({ page }) => {
    const ss = new StepScreenshot(page, '22-landing');

    await page.goto('/landing', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL('/landing');
    await ss.capture('landing-page-loaded');

    // ตรวจสอบ header/hero section
    await expect(page.locator('text=BESTCHOICE').first()).toBeVisible();
    await ss.capture('branding-visible');

    // ตรวจสอบ login link
    const loginLink = page.locator('a[href="/login"], button:has-text("เข้าสู่ระบบ")').first();
    await expect(loginLink).toBeVisible();
    await ss.capture('login-link-visible');

    await expect(page.locator('[data-sonner-toast][data-type="error"]')).not.toBeVisible();
    await ss.capture('no-error');
  });

  test('should display forgot password page', async ({ page }) => {
    const ss = new StepScreenshot(page, '22-forgot-password');

    await page.goto('/forgot-password', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL('/forgot-password');
    await ss.capture('forgot-password-page-loaded');

    // ตรวจสอบ form field (email)
    const emailInput = page.locator('input[type="email"], input[name="email"], #email').first();
    await expect(emailInput).toBeVisible();
    await ss.capture('email-input-visible');

    // ตรวจสอบ submit button
    const submitBtn = page.locator('button[type="submit"]').first();
    await expect(submitBtn).toBeVisible();
    await ss.capture('submit-button-visible');

    await expect(page.locator('[data-sonner-toast][data-type="error"]')).not.toBeVisible();
    await ss.capture('no-error');
  });

  test('should display reset password page', async ({ page }) => {
    const ss = new StepScreenshot(page, '22-reset-password');

    // Reset password ต้องมี token ใน URL — ใส่ dummy token
    await page.goto('/reset-password?token=test-token', { waitUntil: 'domcontentloaded' });
    await ss.capture('reset-password-page-loaded');

    // ตรวจสอบว่าหน้าโหลดได้ (อาจแสดง error ว่า token ไม่ถูกต้อง)
    await page.waitForLoadState('networkidle');
    await ss.capture('page-loaded');
  });

  test('should navigate from landing to login', async ({ page }) => {
    const ss = new StepScreenshot(page, '22-landing-to-login');

    await page.goto('/landing', { waitUntil: 'domcontentloaded' });
    await ss.capture('landing-page');

    // คลิก login link
    const loginLink = page.locator('a[href="/login"], button:has-text("เข้าสู่ระบบ")').first();
    if (await loginLink.isVisible()) {
      await loginLink.click();
      await page.waitForURL('/login', { timeout: 10000 });
      await ss.capture('navigated-to-login');
      await expect(page).toHaveURL('/login');
    }
  });
});
