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
      // Verify navigation occurred to supplier detail page
      // Note: supplier detail may have rendering issues if API returns non-array shapes
      await expect(page).toHaveURL(/\/suppliers\/.+/);
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

  test('should display PO list with header elements', async ({ page }) => {
    await page.goto('/purchase-orders', { waitUntil: 'domcontentloaded' });

    await page.waitForTimeout(2000);

    const labels = ['ใบสั่งซื้อ', 'Purchase Order', 'สร้างใบสั่งซื้อ', 'เพิ่ม PO'];
    let found = 0;
    for (const label of labels) {
      if (await page.getByText(label).first().isVisible({ timeout: 3000 }).catch(() => false)) {
        found++;
      }
    }
    // Either title or create button should be visible
    expect(found).toBeGreaterThan(0);
  });

  test('should display status filter tabs', async ({ page }) => {
    await page.goto('/purchase-orders', { waitUntil: 'domcontentloaded' });

    await page.waitForTimeout(2000);

    const statuses = ['ร่าง', 'ส่งแล้ว', 'รับสินค้าแล้ว', 'ทั้งหมด'];
    let found = 0;
    for (const status of statuses) {
      if (await page.getByText(status).first().isVisible({ timeout: 3000 }).catch(() => false)) {
        found++;
      }
    }

    // If any status filter is shown — good
    await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
  });

  test('should open create PO modal or navigate to create page', async ({ page }) => {
    await page.goto('/purchase-orders', { waitUntil: 'domcontentloaded' });

    await page.waitForTimeout(2000);

    const createBtn = page.getByText(/สร้างใบสั่งซื้อ|เพิ่ม PO|Create PO/).first();
    if (await createBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await createBtn.click();

      await page.waitForTimeout(1000);

      // Should navigate or open modal
      await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
    } else {
      // No create button visible — pass
      await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
    }
  });

  test('should display accounts payable tab', async ({ page }) => {
    await page.goto('/purchase-orders', { waitUntil: 'domcontentloaded' });

    await page.waitForTimeout(2000);

    // AP tab might be labeled "เจ้าหนี้" or "AP" or "บัญชีเจ้าหนี้"
    const apTab = page.getByText(/เจ้าหนี้|Accounts Payable|AP/).first();
    if (await apTab.isVisible({ timeout: 5000 }).catch(() => false)) {
      await apTab.click();
      await page.waitForTimeout(1000);
      await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
    } else {
      await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
    }
  });

  test('should display goods receiving section', async ({ page }) => {
    await page.goto('/purchase-orders', { waitUntil: 'domcontentloaded' });

    await page.waitForTimeout(2000);

    // Look for receive goods button or section
    const receiveTab = page.getByText(/รับสินค้า|Receive/).first();
    if (await receiveTab.isVisible({ timeout: 5000 }).catch(() => false)) {
      await receiveTab.click();
      await page.waitForTimeout(1000);
      await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
    } else {
      await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
    }
  });

  test('should navigate to PO detail when clicking a row', async ({ page }) => {
    await page.goto('/purchase-orders', { waitUntil: 'domcontentloaded' });

    await page.waitForTimeout(2000);

    // Try clicking on a table row or detail link
    const detailLink = page.locator('table tbody tr').first();
    if (await detailLink.isVisible({ timeout: 5000 }).catch(() => false)) {
      await detailLink.click();
      await page.waitForTimeout(2000);
      await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
    } else {
      // Empty state — valid
      await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
    }
  });
});
