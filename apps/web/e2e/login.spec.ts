import { test, expect } from '@playwright/test';
import { TEST_USER, loginAsAdmin } from './helpers/auth';

test.describe('Login Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login', { waitUntil: 'domcontentloaded' });
  });

  test('should login successfully with valid credentials', async ({ page }) => {
    await page.fill('#email', TEST_USER.email);
    await page.fill('#password', TEST_USER.password);
    await page.click('button[type="submit"]');

    // Wait for redirect to dashboard
    await page.waitForURL('/', { timeout: 15000 });
    await expect(page).toHaveURL('/');

    // Verify dashboard content is visible
    await expect(page.locator('text=Dashboard').or(page.locator('text=สวัสดี'))).toBeVisible({
      timeout: 10000,
    });
  });

  test('should show error toast for wrong password', async ({ page }) => {
    await page.fill('#email', 'wrong@email.com');
    await page.fill('#password', 'wrongpassword');
    await page.click('button[type="submit"]');

    // Sonner toast should appear with error message
    const toast = page.locator('[data-sonner-toast]').first();
    await expect(toast).toBeVisible({ timeout: 10000 });
    await expect(toast).toContainText('อีเมลหรือรหัสผ่านไม่ถูกต้อง');

    // Should remain on login page
    await expect(page).toHaveURL(/\/login/);
  });

  test('should redirect to dashboard after login', async ({ page }) => {
    await loginAsAdmin(page);
    await expect(page).toHaveURL('/');
  });

  test('should display sidebar menu items after login', async ({ page }) => {
    await loginAsAdmin(page);

    // Admin (OWNER role) should see key navigation items
    // These are Thai menu labels from the actual Sidebar component
    await expect(page.locator('text=ลูกค้า')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('text=สัญญาผ่อน')).toBeVisible();
    await expect(page.locator('text=ชำระเงิน')).toBeVisible();
    await expect(page.locator('text=คลังสินค้า')).toBeVisible();
  });

  test('should redirect to dashboard when visiting /login while authenticated', async ({
    page,
  }) => {
    await loginAsAdmin(page);
    await page.goto('/login', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL('/');
  });

  test('should show validation for empty form submission', async ({ page }) => {
    await page.click('button[type="submit"]');

    // HTML5 validation should prevent submit — email field should be invalid
    const emailInvalid = await page.locator('#email').evaluate(
      (el: HTMLInputElement) => !el.validity.valid,
    );
    expect(emailInvalid).toBe(true);
  });
});
