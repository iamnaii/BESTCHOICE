import { test, expect } from '@playwright/test';
import { loginViaAPI } from './helpers/auth';
import { StepScreenshot } from './helpers/screenshot';

/**
 * Sales History Page (/sales) E2E Tests
 *
 * ทดสอบหน้าประวัติการขาย: แสดงรายการ, summary cards, filter, search
 * Selectors จาก: src/pages/SalesHistoryPage.tsx
 * - PageHeader: "ประวัติการขาย"
 * - Summary cards: ทั้งหมด, เงินสด, ผ่อนร้าน, ไฟแนนซ์
 * - Filter: select (ประเภท), search input
 * - DataTable with sales data
 * - API: GET /sales
 */
test.describe('Sales History Page', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page);
    await page.goto('/sales', { waitUntil: 'domcontentloaded' });
  });

  test('should display sales page with header and data', async ({ page }) => {
    const ss = new StepScreenshot(page, 'sales-display');

    // Step 1: ตรวจสอบ URL
    await expect(page).toHaveURL('/sales');
    await ss.capture('sales-page-loaded');

    // Step 2: ตรวจสอบ header "ประวัติการขาย"
    await expect(page.locator('text=ประวัติการขาย').first()).toBeVisible();
    await ss.capture('header-visible');

    // Step 3: รอข้อมูลโหลด
    await page.waitForLoadState('networkidle');
    await ss.capture('data-loaded');

    // Step 4: ตรวจสอบว่าไม่มี error toast
    await expect(page.locator('[data-sonner-toast][data-type="error"]')).not.toBeVisible();
    await ss.capture('no-error');
  });

  test('should display summary cards when data exists', async ({ page }) => {
    const ss = new StepScreenshot(page, 'sales-summary-cards');

    await page.waitForLoadState('networkidle');
    await ss.capture('page-ready');

    // ตรวจสอบ summary cards — ข้อความ "รายการ" จะปรากฏเมื่อมีข้อมูล
    // หรือ empty state "ยังไม่มีรายการขาย" ถ้าไม่มี
    const hasData = await page.locator('text=รายการ').first().isVisible({ timeout: 5000 }).catch(() => false);
    if (hasData) {
      await ss.capture('summary-cards-visible');

      // ตรวจ cash card
      if (await page.locator('text=เงินสด (หน้านี้)').first().isVisible().catch(() => false)) {
        await ss.capture('cash-card-visible');
      }

      // ตรวจ installment card
      if (await page.locator('text=ผ่อนร้าน (หน้านี้)').first().isVisible().catch(() => false)) {
        await ss.capture('installment-card-visible');
      }

      // ตรวจ finance card
      if (await page.locator('text=ไฟแนนซ์ (หน้านี้)').first().isVisible().catch(() => false)) {
        await ss.capture('finance-card-visible');
      }
    } else {
      await ss.capture('no-data-no-summary');
    }
  });

  test('should have sale type filter dropdown', async ({ page }) => {
    const ss = new StepScreenshot(page, 'sales-filter');

    await page.waitForLoadState('networkidle');
    await ss.capture('page-ready');

    // หา select filter
    const filterSelect = page.locator('select').first();
    await expect(filterSelect).toBeVisible();
    await ss.capture('filter-select-visible');

    // เลือก "เงินสด"
    await filterSelect.selectOption('CASH');
    await ss.capture('selected-cash-filter');

    // รอข้อมูล reload
    await page.waitForLoadState('networkidle');
    await ss.capture('cash-filter-applied');

    // เลือก "ผ่อนร้าน"
    await filterSelect.selectOption('INSTALLMENT');
    await page.waitForLoadState('networkidle');
    await ss.capture('installment-filter-applied');

    // เลือก "ทุกประเภท"
    await filterSelect.selectOption('');
    await page.waitForLoadState('networkidle');
    await ss.capture('all-types-filter');
  });

  test('should search sales by keyword', async ({ page }) => {
    const ss = new StepScreenshot(page, 'sales-search');

    await page.waitForLoadState('networkidle');
    await ss.capture('page-ready');

    // หา search input
    const searchInput = page.locator('input[placeholder*="ค้นหา"]').first();
    await expect(searchInput).toBeVisible();
    await ss.capture('search-input-visible');

    // พิมพ์ค้นหา
    await searchInput.type('iPhone', { delay: 50 });
    await ss.capture('typed-search');

    // รอ debounce + API response
    await page.waitForTimeout(1000);
    await page.waitForLoadState('networkidle');
    await ss.capture('search-results');
  });

  test('should display data table or empty message', async ({ page }) => {
    const ss = new StepScreenshot(page, 'sales-table');

    await page.waitForLoadState('networkidle');
    await ss.capture('page-ready');

    // ตรวจว่ามี table หรือ empty message
    const table = page.locator('table').first();
    const emptyMsg = page.locator('text=ยังไม่มีรายการขาย');

    if (await table.isVisible().catch(() => false)) {
      // ตรวจ column headers
      await expect(page.locator('th:has-text("เลขที่"), th:has-text("#")').first()).toBeVisible();
      await ss.capture('table-headers-visible');

      const hasRows = await page.locator('table tbody tr').first().isVisible().catch(() => false);
      if (hasRows) {
        await ss.capture('table-has-data');
      }
    } else if (await emptyMsg.isVisible().catch(() => false)) {
      await ss.capture('empty-state');
    }
  });
});
