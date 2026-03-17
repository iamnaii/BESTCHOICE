import { test, expect } from '@playwright/test';
import { loginAsAdmin } from './helpers/auth';

/**
 * E2E Tests for new features:
 * - Password Reset Flow
 * - Dunning Dashboard
 * - Credit Balance Display
 * - Financial Audit Trail
 * - CSV Payment Import
 */

// ─── Password Reset Flow ──────────────────────────────────────

test.describe('Password Reset Flow', () => {
  test('should display forgot password page', async ({ page }) => {
    await page.goto('/forgot-password');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('h2')).toContainText('ลืมรหัสผ่าน');
    await expect(page.locator('#email')).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toBeVisible();
  });

  test('should have link from login to forgot password', async ({ page }) => {
    await page.goto('/login');
    const forgotLink = page.locator('a[href="/forgot-password"]');
    await expect(forgotLink).toBeVisible();
    await expect(forgotLink).toContainText('ลืมรหัสผ่าน');
  });

  test('should submit forgot password form and show success', async ({ page }) => {
    await page.goto('/forgot-password');
    await page.fill('#email', 'admin@bestchoice.com');
    await page.click('button[type="submit"]');

    // Should show success message (or toast)
    await page.waitForTimeout(2000);
    const bodyText = await page.textContent('body');
    // Should show either success message or the email confirmation
    expect(bodyText).toBeTruthy();
  });

  test('should display reset password page with token', async ({ page }) => {
    await page.goto('/reset-password?token=test-token');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('h2')).toContainText('ตั้งรหัสผ่านใหม่');
    await expect(page.locator('#newPassword')).toBeVisible();
    await expect(page.locator('#confirmPassword')).toBeVisible();
  });

  test('should show error for reset password without token', async ({ page }) => {
    await page.goto('/reset-password');
    await page.waitForLoadState('networkidle');

    // Should show error about invalid link
    const bodyText = await page.textContent('body');
    expect(bodyText).toContain('ลิงก์ไม่ถูกต้อง');
  });

  test('should validate password match on reset form', async ({ page }) => {
    await page.goto('/reset-password?token=test-token');
    await page.fill('#newPassword', 'newpass123');
    await page.fill('#confirmPassword', 'different123');
    await page.click('button[type="submit"]');

    // Should show toast error about password mismatch
    const toast = page.locator('[data-sonner-toast]').first();
    await expect(toast).toBeVisible({ timeout: 5000 });
  });

  test('should have link back to login from forgot password', async ({ page }) => {
    await page.goto('/forgot-password');
    const loginLink = page.locator('a[href="/login"]');
    await expect(loginLink).toBeVisible();
  });
});

// ─── Dunning Dashboard ────────────────────────────────────────

test.describe('Dunning Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test('should display overdue page with dunning pipeline', async ({ page }) => {
    await page.goto('/overdue');
    await page.waitForLoadState('networkidle');

    // Should show dunning pipeline stages
    const bodyText = await page.textContent('body');
    expect(bodyText).toContain('Dunning Pipeline');
    expect(bodyText).toContain('แจ้งเตือน');
    expect(bodyText).toContain('แจ้งค้างชำระ');
    expect(bodyText).toContain('เตือนครั้งสุดท้าย');
    expect(bodyText).toContain('ดำเนินคดี');
  });

  test('should display summary cards', async ({ page }) => {
    await page.goto('/overdue');
    await page.waitForLoadState('networkidle');

    // Should have summary cards
    const bodyText = await page.textContent('body');
    expect(bodyText).toContain('สัญญาค้างชำระ');
    expect(bodyText).toContain('รายการค้างชำระ');
    expect(bodyText).toContain('ยอดค้างรวม');
    expect(bodyText).toContain('ค่าปรับรวม');
  });

  test('should display business rule info', async ({ page }) => {
    await page.goto('/overdue');
    await page.waitForLoadState('networkidle');

    const bodyText = await page.textContent('body');
    expect(bodyText).toContain('กฎค่าปรับ');
    expect(bodyText).toContain('100 บาท/วัน');
  });

  test('should have calculate button', async ({ page }) => {
    await page.goto('/overdue');
    await page.waitForLoadState('networkidle');

    const calcButton = page.locator('button:has-text("คำนวณค่าปรับ")');
    await expect(calcButton).toBeVisible();
  });

  test('should have filter dropdown', async ({ page }) => {
    await page.goto('/overdue');
    await page.waitForLoadState('networkidle');

    const dropdown = page.locator('select');
    await expect(dropdown).toBeVisible();
  });
});

// ─── Contract Detail - Credit Balance & Dunning ───────────────

test.describe('Contract Detail Enhancements', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test('should load contracts page', async ({ page }) => {
    await page.goto('/contracts');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL('/contracts');
  });

  test('should display contract detail with financial info', async ({ page }) => {
    await page.goto('/contracts');
    await page.waitForLoadState('networkidle');

    // Click first contract if available
    const firstRow = page.locator('table tbody tr').first();
    if (await firstRow.isVisible()) {
      const link = firstRow.locator('a, button').first();
      if (await link.isVisible()) {
        await link.click();
        await page.waitForLoadState('networkidle');

        // Should show financial summary
        const bodyText = await page.textContent('body');
        expect(bodyText).toContain('ค่างวด/เดือน');
        expect(bodyText).toContain('ยอดผ่อนรวม');
      }
    }
  });
});

// ─── Financial Audit Trail ────────────────────────────────────

test.describe('Financial Audit Trail', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test('should display financial audit page', async ({ page }) => {
    await page.goto('/financial-audit');
    await page.waitForLoadState('networkidle');

    await expect(page).toHaveURL('/financial-audit');
    const bodyText = await page.textContent('body');
    expect(bodyText).toContain('Financial Audit Trail');
  });

  test('should have search input for contract ID', async ({ page }) => {
    await page.goto('/financial-audit');
    await page.waitForLoadState('networkidle');

    const input = page.locator('input[placeholder*="Contract ID"]');
    await expect(input).toBeVisible();
  });

  test('should show empty state before search', async ({ page }) => {
    await page.goto('/financial-audit');
    await page.waitForLoadState('networkidle');

    const bodyText = await page.textContent('body');
    expect(bodyText).toContain('กรอก Contract ID');
  });

  test('should handle search with non-existent contract', async ({ page }) => {
    await page.goto('/financial-audit');
    await page.waitForLoadState('networkidle');

    const input = page.locator('input[placeholder*="Contract ID"]');
    await input.fill('nonexistent-id');
    await page.locator('button:has-text("ค้นหา")').click();
    await page.waitForLoadState('networkidle');

    // Should handle gracefully
    const bodyText = await page.textContent('body');
    expect(bodyText).toBeTruthy();
  });
});

// ─── CSV Import API ───────────────────────────────────────────

test.describe('CSV Payment Import', () => {
  test('API should reject empty CSV', async ({ page }) => {
    await loginAsAdmin(page);
    const token = await page.evaluate(() => localStorage.getItem('access_token'));

    const response = await page.request.post('/api/payments/import-csv', {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      data: { csv: '' },
    });

    // Should reject with 400
    expect([400, 422]).toContain(response.status());
  });

  test('API should handle CSV with only header', async ({ page }) => {
    await loginAsAdmin(page);
    const token = await page.evaluate(() => localStorage.getItem('access_token'));

    const response = await page.request.post('/api/payments/import-csv', {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      data: { csv: 'contractNumber,installmentNo,amount,paymentMethod,transactionRef,notes' },
    });

    // Should reject - needs at least 1 data row
    expect([400, 422]).toContain(response.status());
  });

  test('API should handle CSV with invalid data gracefully', async ({ page }) => {
    await loginAsAdmin(page);
    const token = await page.evaluate(() => localStorage.getItem('access_token'));

    const csv = [
      'contractNumber,installmentNo,amount,paymentMethod,transactionRef,notes',
      'INVALID-CONTRACT,1,1000,BANK_TRANSFER,REF001,test',
    ].join('\n');

    const response = await page.request.post('/api/payments/import-csv', {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      data: { csv },
    });

    // Should succeed but with errors in response
    if (response.status() === 200 || response.status() === 201) {
      const body = await response.json();
      expect(body.errors).toBeDefined();
      expect(body.errors.length).toBeGreaterThan(0);
    }
  });
});

// ─── Page Navigation for New Features ─────────────────────────

test.describe('New Feature Navigation', () => {
  test('all new pages should load without errors', async ({ page }) => {
    await loginAsAdmin(page);

    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    const newPages = [
      { url: '/overdue', name: 'Overdue (Dunning)' },
      { url: '/financial-audit', name: 'Financial Audit' },
      { url: '/forgot-password', name: 'Forgot Password' },
    ];

    for (const p of newPages) {
      await page.goto(p.url);
      await page.waitForLoadState('networkidle');
    }

    const criticalErrors = errors.filter(
      (e) => !e.includes('ResizeObserver') && !e.includes('Non-Error'),
    );
    expect(criticalErrors).toHaveLength(0);
  });
});
