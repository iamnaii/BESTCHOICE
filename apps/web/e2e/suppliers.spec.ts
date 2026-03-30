import { test, expect } from '@playwright/test';
import { loginViaAPI } from './helpers/auth';

test.describe('Suppliers Page', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page);
  });

  test('should display suppliers list page', async ({ page }) => {
    await page.goto('/suppliers', { waitUntil: 'domcontentloaded' });

    await expect(page.getByText('จัดการผู้ขาย').first()).toBeVisible({ timeout: 15000 });

    // Search input
    await expect(
      page.getByPlaceholder('ค้นหาชื่อ, ผู้ติดต่อ, ชื่อเล่น, เบอร์โทร, Tax ID...'),
    ).toBeVisible();

    // Add supplier button
    await expect(page.getByText('เพิ่มผู้ขาย').first()).toBeVisible();
  });

  test('should search suppliers', async ({ page }) => {
    await page.goto('/suppliers', { waitUntil: 'domcontentloaded' });

    const searchInput = page.getByPlaceholder('ค้นหาชื่อ, ผู้ติดต่อ, ชื่อเล่น, เบอร์โทร, Tax ID...');
    await expect(searchInput).toBeVisible({ timeout: 15000 });

    await searchInput.fill('test');
    await page.waitForTimeout(500);

    await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
  });

  test('should open add supplier modal', async ({ page }) => {
    await page.goto('/suppliers', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('เพิ่มผู้ขาย').first()).toBeVisible({ timeout: 15000 });

    await page.getByText('เพิ่มผู้ขาย').first().click();

    await expect(page.getByText('เพิ่มผู้ขายใหม่')).toBeVisible({ timeout: 5000 });

    // Form fields should be visible
    const modal = page.locator('[role="dialog"], .modal').first();
    await expect(modal.getByText('ชื่อผู้ขาย').first()).toBeVisible();
  });

  test('should filter suppliers by status', async ({ page }) => {
    await page.goto('/suppliers', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('จัดการผู้ขาย').first()).toBeVisible({ timeout: 15000 });

    // Status filter buttons
    const activeFilter = page.getByText('เปิดใช้งาน').first();
    if (await activeFilter.isVisible({ timeout: 5000 }).catch(() => false)) {
      await activeFilter.click();
      await page.waitForTimeout(500);
    }

    await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
  });

  test('should navigate to supplier detail', async ({ page }) => {
    await page.goto('/suppliers', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('จัดการผู้ขาย').first()).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(2000);

    const detailLink = page.locator('button:has-text("ดูข้อมูล"), a:has-text("ดูข้อมูล")').first();
    if (await detailLink.isVisible({ timeout: 5000 }).catch(() => false)) {
      await detailLink.click();
      await page.waitForTimeout(2000);
      await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
    }
    // Empty state is valid
  });
});

test.describe('Purchase Orders Page', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page);
  });

  test('should display purchase orders page', async ({ page }) => {
    await page.goto('/purchase-orders', { waitUntil: 'domcontentloaded' });

    await page.waitForTimeout(2000);
    await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
  });
});
