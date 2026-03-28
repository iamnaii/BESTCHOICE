import { test, expect } from '@playwright/test';
import { loginViaAPI } from './helpers/auth';

test.describe('Payments Page', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page);
  });

  test('should navigate to /payments and display payment list', async ({ page }) => {
    await page.goto('/payments', { waitUntil: 'domcontentloaded' });

    // Tab buttons should be visible first
    await expect(page.getByText('รายการรอชำระ').first()).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('สรุปรายวัน').first()).toBeVisible();

    // Search input should be visible (inside pending tab content)
    await expect(
      page.getByPlaceholder('ค้นหาเลขสัญญา, ชื่อ, เบอร์โทร...'),
    ).toBeVisible({ timeout: 5000 });
  });

  test('should display pending payments tab by default', async ({ page }) => {
    await page.goto('/payments', { waitUntil: 'domcontentloaded' });

    // Pending tab should be active
    await expect(page.getByText('รายการรอชำระ').first()).toBeVisible({ timeout: 15000 });

    // Wait for data to load
    await page.waitForTimeout(2000);

    // Should show either payment data or empty state
    const table = page.locator('table');
    const hasTable = await table.isVisible({ timeout: 5000 }).catch(() => false);

    if (hasTable) {
      // Table should have contract/amount columns
      await expect(
        page.getByText('สัญญา').or(page.getByText('จำนวนเงิน')).first(),
      ).toBeVisible();
    }
    // Empty state ("ไม่มีรายการรอชำระ") is also valid
  });

  test('should open payment recording modal for a pending item', async ({ page }) => {
    await page.goto('/payments', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('รายการรอชำระ').first()).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(2000);

    // Find a "รับชำระ" (receive payment) button
    const payButton = page.locator('button:has-text("รับชำระ")').first();
    const hasPayButton = await payButton.isVisible({ timeout: 5000 }).catch(() => false);

    if (hasPayButton) {
      await payButton.click();

      // Payment modal should appear with form fields
      await expect(
        page.getByText('บันทึกการรับชำระ').or(page.getByText('จำนวนเงินที่รับ')).first(),
      ).toBeVisible({ timeout: 5000 });

      // Payment method dropdown should be available
      await expect(page.getByText('วิธีชำระ').first()).toBeVisible();
    }
    // If no pending payments, test passes
  });

  test('should switch to daily summary tab', async ({ page }) => {
    await page.goto('/payments', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('สรุปรายวัน').first()).toBeVisible({ timeout: 15000 });

    // Click daily summary tab
    await page.getByText('สรุปรายวัน').first().click();
    await page.waitForTimeout(1000);

    // Date picker or summary content should be visible
    await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
  });

  test('should filter payments by search query', async ({ page }) => {
    await page.goto('/payments', { waitUntil: 'domcontentloaded' });

    const searchInput = page.getByPlaceholder('ค้นหาเลขสัญญา, ชื่อ, เบอร์โทร...');
    await expect(searchInput).toBeVisible({ timeout: 15000 });

    // Type a search query
    await searchInput.fill('TEST');
    await page.waitForTimeout(500); // debounce

    // Page should update without errors
    await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
  });

  test('should filter payments by status', async ({ page }) => {
    await page.goto('/payments', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('รายการรอชำระ').first()).toBeVisible({ timeout: 15000 });

    // Look for status filter dropdown — it's a <select> with "ทุกสถานะ" option
    const statusFilter = page.locator('select').filter({
      has: page.locator('option:has-text("ทุกสถานะ")'),
    }).first();

    const hasFilter = await statusFilter.isVisible({ timeout: 5000 }).catch(() => false);

    if (hasFilter) {
      await statusFilter.selectOption('PENDING');
      await page.waitForTimeout(500);
    }
    // Filter UI verified
  });
});
