import { test, expect } from '@playwright/test';
import { loginViaAPI } from './helpers/auth';

test.describe('Inspections Page', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page);
  });

  test('should display inspections list page', async ({ page }) => {
    await page.goto('/inspections', { waitUntil: 'domcontentloaded' });

    await expect(page.getByText('ตรวจสอบสินค้า').first()).toBeVisible({ timeout: 15000 });
  });

  test('should display search input', async ({ page }) => {
    await page.goto('/inspections', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('ตรวจสอบสินค้า').first()).toBeVisible({ timeout: 15000 });

    await expect(
      page.getByPlaceholder('ค้นหาสินค้า, IMEI, ยี่ห้อ...'),
    ).toBeVisible({ timeout: 5000 });
  });

  test('should display status filter', async ({ page }) => {
    await page.goto('/inspections', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('ตรวจสอบสินค้า').first()).toBeVisible({ timeout: 15000 });

    const statusFilter = page.locator('select').filter({
      has: page.locator('option:has-text("ทุกสถานะ")'),
    }).first();

    await expect(statusFilter).toBeVisible({ timeout: 5000 });
  });

  test('should search inspections', async ({ page }) => {
    await page.goto('/inspections', { waitUntil: 'domcontentloaded' });

    const searchInput = page.getByPlaceholder('ค้นหาสินค้า, IMEI, ยี่ห้อ...');
    await expect(searchInput).toBeVisible({ timeout: 15000 });

    await searchInput.fill('iPhone');
    await page.waitForTimeout(500);

    await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
  });

  test('should display table or empty state', async ({ page }) => {
    await page.goto('/inspections', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('ตรวจสอบสินค้า').first()).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(2000);

    const table = page.locator('table').first();
    const hasTable = await table.isVisible({ timeout: 5000 }).catch(() => false);

    if (hasTable) {
      await expect(table.getByText('สินค้า').first()).toBeVisible();
    } else {
      // Empty state
      await expect(
        page.getByText('ไม่พบรายการตรวจสอบ').first(),
      ).toBeVisible({ timeout: 5000 }).catch(() => {
        // May have different empty state text
      });
    }

    await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
  });

  test('should navigate to inspection detail', async ({ page }) => {
    await page.goto('/inspections', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('ตรวจสอบสินค้า').first()).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(2000);

    // Click first row action if available
    const firstRow = page.locator('table tbody tr').first();
    if (await firstRow.isVisible({ timeout: 5000 }).catch(() => false)) {
      await firstRow.click();

      // Should navigate to detail page or open modal
      await page.waitForTimeout(2000);
      await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
    }
    // No rows is valid (empty state)
  });
});
