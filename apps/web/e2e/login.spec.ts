import { test, expect } from '@playwright/test';
import { TEST_USER, loginAsAdmin, loginViaAPI } from './helpers/auth';

test.describe('Login Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login', { waitUntil: 'domcontentloaded' });
  });

  test('should login successfully with valid credentials', async ({ page }) => {
    // Use loginAsAdmin which handles webkit-compatible redirect
    await loginAsAdmin(page);

    // Verify dashboard content — use heading role to avoid strict mode violation.
    // DashboardPage renders <PageHeader title="แดชบอร์ด"> → <h1>แดชบอร์ด</h1>;
    // the remaining "Dashboard" strings are menu items, not headings.
    await expect(page.getByRole('heading', { name: 'แดชบอร์ด' })).toBeVisible({
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
    await expect(toast).toContainText(
      /อีเมลหรือรหัสผ่านไม่ถูกต้อง|ไม่สำเร็จ|ลองเข้าสู่ระบบบ่อยเกินไป|error/i,
    );

    // Should remain on login page
    await expect(page).toHaveURL(/\/login/);
  });

  test('should redirect to dashboard after login', async ({ page }) => {
    await loginAsAdmin(page);
    await expect(page).toHaveURL((url) => url.pathname === '/');
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
    // These are accordion section headers (always visible when sidebar is expanded).
    // OWNER defaults to the 'shop' zone → sections are 'คลัง & จัดซื้อ' / 'ขาย' /
    // 'หลังการขาย' (config/menu.ts). The old 'สัญญา'/'คลัง' labels belong to the
    // pre-menu.ts hardcoded sidebar and no longer exist as section headers.
    await expect(sidebar.getByText('ขาย', { exact: true }).first()).toBeVisible({ timeout: 5000 });
    await expect(sidebar.getByText('คลัง & จัดซื้อ', { exact: true }).first()).toBeVisible();
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
    const emailInvalid = await page
      .locator('#email')
      .evaluate((el: HTMLInputElement) => !el.validity.valid);
    expect(emailInvalid).toBe(true);
  });
});
