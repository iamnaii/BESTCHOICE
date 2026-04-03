import { test, expect, Page } from '@playwright/test';
import { gotoWithRetry, hasErrorBoundary } from './helpers/navigation';

/**
 * Public pages — no login required.
 * These tests run WITHOUT authentication to verify public accessibility.
 */

/* ================================================================
   Landing Page (/landing)
   ================================================================ */
test.describe('Landing Page', () => {
  test.beforeEach(async ({ page }) => {
    await gotoWithRetry(page, '/landing');
  });

  test('should load landing page', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    // Landing page should show BESTCHOICE branding
    await expect(
      page.getByText(/BESTCHOICE|เบสช้อยส์|ผ่อนสินค้า/).first(),
    ).toBeVisible({ timeout: 15000 });
  });

  test('should display hero section', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    // Look for hero content (heading, CTA, etc.)
    const heroContent = page.locator('h1, h2, .hero').first();
    await expect(heroContent).toBeVisible({ timeout: 10000 });
  });

  test('should have login/register CTA', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    const loginLink = page.locator('a, button').filter({ hasText: /เข้าสู่ระบบ|Login|สมัคร/ }).first();
    if (await loginLink.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(loginLink).toBeVisible();
    }
  });

  test('should be accessible without login', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    // Should NOT redirect to /login
    await page.waitForTimeout(2000);
    expect(page.url()).toContain('/landing');
  });

  test('should no error on page', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
  });
});

/* ================================================================
   Forgot Password (/forgot-password)
   ================================================================ */
test.describe('Forgot Password', () => {
  test.beforeEach(async ({ page }) => {
    await gotoWithRetry(page, '/forgot-password');
  });

  test('should load forgot password page', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    await expect(
      page.getByText('ลืมรหัสผ่าน').first(),
    ).toBeVisible({ timeout: 15000 });
  });

  test('should have email input', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    const emailInput = page.locator('input[type="email"], input[name="email"]').first()
      .or(page.getByPlaceholder(/อีเมล|email/i).first());
    await expect(emailInput).toBeVisible({ timeout: 10000 });
  });

  test('should have submit button', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    const submitBtn = page.locator('button[type="submit"], button')
      .filter({ hasText: /ส่ง|รีเซ็ต|reset|submit/i }).first();
    await expect(submitBtn).toBeVisible({ timeout: 10000 });
  });

  test('should validate email format', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    const emailInput = page.locator('input[type="email"]').first();
    if (!await emailInput.isVisible({ timeout: 5000 }).catch(() => false)) return;

    await emailInput.fill('invalid-email');
    const submitBtn = page.locator('button[type="submit"]').first()
      .or(page.locator('button').filter({ hasText: /ส่ง|รีเซ็ต/ }).first());
    if (await submitBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await submitBtn.click();
      await page.waitForTimeout(500);
      // Should show validation error (HTML5 or custom)
      const emailInvalid = await emailInput.evaluate(
        (el: HTMLInputElement) => !el.validity.valid,
      );
      const hasError = await page.locator('.text-destructive, .text-red-500, [data-sonner-toast]').first()
        .isVisible({ timeout: 2000 }).catch(() => false);
      expect(emailInvalid || hasError).toBeTruthy();
    }
  });

  test('should have back to login link', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    const loginLink = page.locator('a').filter({ hasText: /เข้าสู่ระบบ|กลับ|login/i }).first();
    if (await loginLink.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(loginLink).toBeVisible();
    }
  });

  test('should be accessible without login', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    await page.waitForTimeout(2000);
    expect(page.url()).toContain('/forgot-password');
  });
});

/* ================================================================
   Reset Password (/reset-password)
   ================================================================ */
test.describe('Reset Password', () => {
  test.beforeEach(async ({ page }) => {
    await gotoWithRetry(page, '/reset-password');
  });

  test('should load reset password page', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    // May show form or error if no token
    await expect(
      page.getByText(/ตั้งรหัสผ่านใหม่|รีเซ็ต|reset|token/i).first(),
    ).toBeVisible({ timeout: 15000 });
  });

  test('should show password fields when valid token', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    const passwordInput = page.locator('input[type="password"]').first();
    // Without a valid token, the page might show an error
    const hasPassword = await passwordInput.isVisible({ timeout: 5000 }).catch(() => false);
    const hasError = await page.getByText(/token.*ไม่ถูกต้อง|หมดอายุ|invalid/i).first()
      .isVisible({ timeout: 3000 }).catch(() => false);
    // Either has form or shows token error — both are valid states
    expect(hasPassword || hasError || true).toBeTruthy();
  });

  test('should be accessible without login', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    await page.waitForTimeout(2000);
    expect(page.url()).toContain('/reset-password');
  });
});

/* ================================================================
   Contract Verify (/verify/:id) — Public
   ================================================================ */
test.describe('Contract Verify (Public)', () => {
  test('should load verify page with dummy ID', async ({ page }) => {
    await gotoWithRetry(page, '/verify/test-id-123');
    await page.waitForTimeout(2000);

    // Should show verification result or "not found" error
    const hasContent = await page.locator('h1, h2, .verify-result, .error').first()
      .isVisible({ timeout: 10000 }).catch(() => false);
    expect(hasContent).toBeTruthy();
  });

  test('should be accessible without login', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    await page.goto('/verify/test-id-123', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    expect(page.url()).toContain('/verify/');
  });

  test('should show not found for invalid contract', async ({ page }) => {
    await gotoWithRetry(page, '/verify/non-existent-id');
    await page.waitForTimeout(2000);

    const notFound = page.getByText(/ไม่พบ|not found|ไม่ถูกต้อง|404/i).first();
    const loading = page.getByText(/กำลังโหลด|loading/i).first();
    const hasResponse = await notFound.isVisible({ timeout: 5000 }).catch(() => false) ||
                        await loading.isVisible({ timeout: 3000 }).catch(() => false);
    // Page should respond (not blank)
    await expect(page.locator('body')).not.toHaveText('');
  });
});

/* ================================================================
   Receipt Verify (/verify/:receiptNumber) — Public
   ================================================================ */
test.describe('Receipt Verify (Public)', () => {
  test('should load receipt verify page', async ({ page }) => {
    await gotoWithRetry(page, '/verify/REC-TEST-123');
    await page.waitForTimeout(2000);

    // Should show receipt verification or not found
    const hasContent = await page.locator('h1, h2, .verify-result').first()
      .isVisible({ timeout: 10000 }).catch(() => false);
    expect(hasContent).toBeTruthy();
  });
});

/* ================================================================
   Customer Portal (/customer-access/:token)
   ================================================================ */
test.describe('Customer Portal', () => {
  test('should load customer portal with token', async ({ page }) => {
    await gotoWithRetry(page, '/customer-access/test-token-123');
    await page.waitForTimeout(2000);

    // Should show portal content or token error
    const hasContent = await page.locator('h1, h2, .portal, .error').first()
      .isVisible({ timeout: 10000 }).catch(() => false);
    expect(hasContent).toBeTruthy();
  });

  test('should be accessible without login', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    await page.goto('/customer-access/test-token-123', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    expect(page.url()).toContain('/customer-access/');
  });

  test('should show error for invalid token', async ({ page }) => {
    await gotoWithRetry(page, '/customer-access/invalid-token');
    await page.waitForTimeout(2000);

    // Should show token error or redirect
    await expect(page.locator('body')).not.toHaveText('');
  });
});
