import { test, expect } from '@playwright/test';
import { loginAsAdmin, loginViaAPI } from './helpers/auth';

test.describe('Login Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login', { waitUntil: 'domcontentloaded' });
  });

  test('should login successfully with valid credentials', async ({ page }) => {
    // Use loginAsAdmin which handles webkit-compatible redirect
    await loginAsAdmin(page);

    // Verify dashboard content — use heading role to avoid strict mode violation
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible({
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
    await expect(toast).toContainText(/อีเมลหรือรหัสผ่านไม่ถูกต้อง|ไม่สำเร็จ|ลองเข้าสู่ระบบบ่อยเกินไป|error/i);

    // Should remain on login page
    await expect(page).toHaveURL(/\/login/);
  });

  test('should redirect to dashboard after login', async ({ page }) => {
    await loginAsAdmin(page);
    await expect(page).toHaveURL('/');
  });

  test('should display sidebar menu items after login', async ({ page }) => {
    // Expand sidebar so text labels are visible (default is collapsed icon rail)
    await page.addInitScript(() => {
      localStorage.setItem('sidebar_collapse', 'false');
    });

    // Use loginViaAPI to avoid rate limiting from multiple UI logins
    await loginViaAPI(page);

    // Wait for expanded sidebar to be visible (uses .sidebar class, not <nav>)
    const sidebar = page.locator('.sidebar');
    await expect(sidebar).toBeVisible({ timeout: 15000 });

    // Admin (OWNER role) should see key section labels in expanded sidebar
    // These are accordion section headers (always visible when sidebar is expanded)
    await expect(sidebar.getByText('สัญญา & ชำระเงิน').first()).toBeVisible({ timeout: 5000 });
    await expect(sidebar.getByText('คลังสินค้า & จัดซื้อ').first()).toBeVisible();
  });

  test('should redirect to dashboard when visiting /login while authenticated', async ({
    page,
  }) => {
    // Use loginViaAPI because it uses addInitScript — token survives page reloads
    await loginViaAPI(page);

    // Authenticated user visiting /login should be redirected
    await page.goto('/login', { waitUntil: 'domcontentloaded' });

    // Should redirect away from login — either to / or stay on current page
    await expect(page).not.toHaveURL(/\/login$/, { timeout: 10000 });
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
