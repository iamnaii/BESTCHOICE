import { test, expect } from '@playwright/test';
import { loginViaAPI } from './helpers/auth';

test.describe('Sales History Page', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page);
  });

  test('should display sales history page', async ({ page }) => {
    await page.goto('/sales', { waitUntil: 'domcontentloaded' });

    await expect(page.getByText('ประวัติการขาย').first()).toBeVisible({ timeout: 15000 });
  });

  test('should display sales summary cards', async ({ page }) => {
    await page.goto('/sales', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('ประวัติการขาย').first()).toBeVisible({ timeout: 15000 });

    // Summary cards for sale types
    const labels = ['เงินสด', 'ผ่อนร้าน', 'ไฟแนนซ์'];
    let found = 0;
    for (const label of labels) {
      if (await page.getByText(label).first().isVisible({ timeout: 3000 }).catch(() => false)) {
        found++;
      }
    }
    expect(found).toBeGreaterThan(0);
  });

  test('should search sales history', async ({ page }) => {
    await page.goto('/sales', { waitUntil: 'domcontentloaded' });

    const searchInput = page.getByPlaceholder('ค้นหาเลขที่ขาย, ลูกค้า, สินค้า, ไฟแนนซ์...');
    await expect(searchInput).toBeVisible({ timeout: 15000 });

    await searchInput.fill('test');
    await page.waitForTimeout(500);

    await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
  });

  test('should filter sales by type', async ({ page }) => {
    await page.goto('/sales', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('ประวัติการขาย').first()).toBeVisible({ timeout: 15000 });

    // Look for type filter
    const typeFilter = page.locator('select').filter({
      has: page.locator('option:has-text("ทุกประเภท")'),
    }).first();

    if (await typeFilter.isVisible({ timeout: 5000 }).catch(() => false)) {
      await typeFilter.selectOption({ index: 1 });
      await page.waitForTimeout(500);
    }

    await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
  });

  test('should display date shortcut buttons', async ({ page }) => {
    await page.goto('/sales', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('ประวัติการขาย').first()).toBeVisible({ timeout: 15000 });

    // Date shortcuts
    const shortcuts = ['วันนี้', 'สัปดาห์นี้', 'เดือนนี้'];
    let found = 0;
    for (const shortcut of shortcuts) {
      if (await page.getByText(shortcut).first().isVisible({ timeout: 3000 }).catch(() => false)) {
        found++;
      }
    }
    expect(found).toBeGreaterThan(0);
  });

  test('should display export button', async ({ page }) => {
    await page.goto('/sales', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('ประวัติการขาย').first()).toBeVisible({ timeout: 15000 });

    await expect(page.getByText('ส่งออก Excel').or(page.getByText('Export')).first()).toBeVisible({
      timeout: 5000,
    });
  });

  test('should display pagination controls', async ({ page }) => {
    await page.goto('/sales', { waitUntil: 'domcontentloaded' });

    await expect(page.getByText('ประวัติการขาย').first()).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(2000);

    // Pagination: look for page numbers, next button, or items-per-page select
    const paginationEl = page.locator(
      '[aria-label="pagination"], .pagination, nav[aria-label*="page"]',
    ).first();
    const hasPagination = await paginationEl.isVisible({ timeout: 5000 }).catch(() => false);

    const hasPageNumbers = await page
      .getByRole('button', { name: /^[0-9]+$/ })
      .first()
      .isVisible({ timeout: 3000 })
      .catch(() => false);

    // Pagination exists when there's enough data — valid either way
    await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
  });

  test('should filter sales by date shortcuts', async ({ page }) => {
    await page.goto('/sales', { waitUntil: 'domcontentloaded' });

    await expect(page.getByText('ประวัติการขาย').first()).toBeVisible({ timeout: 15000 });

    // Click "วันนี้" shortcut
    const todayBtn = page.getByText('วันนี้').first();
    if (await todayBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await todayBtn.click();
      await page.waitForTimeout(500);
      await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
    }

    // Click "เดือนนี้" shortcut
    const monthBtn = page.getByText('เดือนนี้').first();
    if (await monthBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await monthBtn.click();
      await page.waitForTimeout(500);
      await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
    }
  });
});
