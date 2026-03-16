import { test, expect } from '@playwright/test';
import { TEST_USER, loginAsAdmin } from './helpers/auth';

test.describe('Login Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
  });

  test('should display login form', async ({ page }) => {
    await expect(page.locator('h2')).toContainText('เข้าสู่ระบบ');
    await expect(page.locator('#email')).toBeVisible();
    await expect(page.locator('#password')).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toBeVisible();
  });

  test('should show validation for empty fields', async ({ page }) => {
    await page.click('button[type="submit"]');
    // HTML5 validation should prevent submit
    const emailInput = page.locator('#email');
    const isInvalid = await emailInput.evaluate(
      (el: HTMLInputElement) => !el.validity.valid
    );
    expect(isInvalid).toBe(true);
  });

  test('should show error for wrong credentials', async ({ page }) => {
    await page.fill('#email', 'wrong@email.com');
    await page.fill('#password', 'wrongpassword');
    await page.click('button[type="submit"]');
    // Wait for error toast
    await expect(page.locator('[data-sonner-toast]').first()).toBeVisible({
      timeout: 10000,
    });
  });

  test('should login successfully with valid credentials', async ({ page }) => {
    await loginAsAdmin(page);
    // Should be on dashboard
    await expect(page).toHaveURL('/');
  });

  test('should redirect to dashboard if already logged in', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/login');
    await expect(page).toHaveURL('/');
  });

  test('should have link to landing page', async ({ page }) => {
    const link = page.locator('a[href="/landing"]').first();
    await expect(link).toBeVisible();
  });
});
