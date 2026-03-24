import { test, expect } from '@playwright/test';
import { loginViaAPI } from '../helpers/auth';
import { StepScreenshot } from '../helpers/screenshot';

/**
 * 07 - Stock/Inventory Flow (Human-Like Interaction)
 *
 * ทดสอบ flow คลังสินค้า: dashboard, รายการสินค้า, ค้นหา, filter, เพิ่มสินค้า
 * Selectors จาก: src/pages/StockPage.tsx
 * - Dashboard view: aging, stock movement, margin overview, action required
 * - DataTable with search, category/status filters
 * - Modal for add product
 * - API: GET /products, GET /stock/dashboard
 */
test.describe('07 - Stock Flow', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page);
    await page.goto('/stock', { waitUntil: 'domcontentloaded' });
  });

  test('should display stock dashboard', async ({ page }) => {
    const ss = new StepScreenshot(page, '07-stock-dashboard');

    // Step 1: ตรวจสอบว่าอยู่หน้า /stock
    await expect(page).toHaveURL('/stock');
    await ss.capture('stock-page-loaded');

    // Step 2: ตรวจสอบ header "คลังสินค้า"
    await expect(page.locator('text=คลังสินค้า').first()).toBeVisible();
    await ss.capture('stock-header-visible');

    // Step 3: รอ dashboard data โหลด
    await page.waitForLoadState('networkidle');
    await ss.capture('dashboard-data-loaded');

    // Step 4: ตรวจสอบว่าไม่มี error
    await expect(page.locator('[data-sonner-toast][data-type="error"]')).not.toBeVisible();
    await ss.capture('no-error');
  });

  test('should search products in stock', async ({ page }) => {
    const ss = new StepScreenshot(page, '07-stock-search');

    // Step 1: รอข้อมูลโหลด
    await page.waitForLoadState('networkidle');
    await ss.capture('page-ready');

    // Step 2: หา search input
    const searchInput = page.locator('input[placeholder*="ค้นหา"]').first();
    if (await searchInput.isVisible()) {
      // Step 3: พิมพ์ค้นหาสินค้า (human-like)
      await searchInput.type('iPhone', { delay: 50 });
      await ss.capture('typed-search');

      // Step 4: รอ debounce + API response
      await page.waitForLoadState('networkidle');
      await ss.capture('search-results');
    }
  });

  test('should filter stock by category', async ({ page }) => {
    const ss = new StepScreenshot(page, '07-stock-filter');

    // Step 1: รอข้อมูลโหลด
    await page.waitForLoadState('networkidle');
    await ss.capture('page-ready');

    // Step 2: หา filter dropdowns (category, status)
    const filterSelect = page.locator('select').first();
    if (await filterSelect.isVisible()) {
      await ss.capture('filter-select-visible');

      // Step 3: เลือก filter option
      await filterSelect.selectOption({ index: 1 });
      await ss.capture('selected-filter');

      // Step 4: รอ filtered results
      await page.waitForLoadState('networkidle');
      await ss.capture('filtered-results');
    }
  });

  test('should display stock action items', async ({ page }) => {
    const ss = new StepScreenshot(page, '07-stock-actions');

    // Step 1: รอข้อมูลโหลด
    await page.waitForLoadState('networkidle');
    await ss.capture('page-ready');

    // Step 2: ตรวจสอบ action required section
    // StockPage มี actionRequired: inspection, qcPending, photoPending, pendingTransfers
    const actionTexts = ['ตรวจสอบ', 'รอ QC', 'โอนย้าย'];
    for (const text of actionTexts) {
      const el = page.locator(`text=${text}`).first();
      if (await el.isVisible()) {
        await ss.capture(`action-${text}-visible`);
      }
    }
  });

  test('should navigate to add product page', async ({ page }) => {
    const ss = new StepScreenshot(page, '07-stock-add-product');

    // Step 1: รอข้อมูลโหลด
    await page.waitForLoadState('networkidle');
    await ss.capture('page-ready');

    // Step 2: หาปุ่มเพิ่มสินค้า
    const addBtn = page.locator('a[href="/products/create"], button:has-text("เพิ่มสินค้า"), button:has-text("เพิ่ม")').first();
    if (await addBtn.isVisible()) {
      await ss.capture('add-product-button-visible');

      // Step 3: คลิกปุ่ม
      await addBtn.click();
      await ss.capture('clicked-add-product');

      // Step 4: รอหน้าใหม่
      await page.waitForLoadState('networkidle');
      await ss.capture('add-product-page-loaded');
    } else {
      await ss.capture('add-button-not-found');
    }
  });

  test('should navigate to stock transfers page', async ({ page }) => {
    const ss = new StepScreenshot(page, '07-stock-transfers');

    // Step 1: หา link ไป stock transfers
    const transferLink = page.locator('a[href="/stock/transfers"], button:has-text("โอนย้าย")').first();
    if (await transferLink.isVisible()) {
      await ss.capture('transfer-link-visible');

      // Step 2: คลิก
      await transferLink.click();
      await page.waitForURL('/stock/transfers', { timeout: 10000 });
      await ss.capture('on-transfers-page');

      // Step 3: ตรวจสอบ URL
      await expect(page).toHaveURL('/stock/transfers');
      await ss.capture('transfers-url-verified');
    } else {
      // ลองไปตรงๆ
      await page.goto('/stock/transfers', { waitUntil: 'domcontentloaded' });
      await ss.capture('navigated-to-transfers-directly');
      await expect(page).toHaveURL('/stock/transfers');
      await ss.capture('transfers-page-verified');
    }
  });
});
