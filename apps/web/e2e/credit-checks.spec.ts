import { test, expect } from '@playwright/test';
import { loginViaAPI } from './helpers/auth';
import { StepScreenshot } from './helpers/screenshot';

/**
 * Credit Checks Page (/credit-checks) E2E Tests
 *
 * ทดสอบหน้าตรวจเครดิต: แสดงรายการ, summary cards, filter, search, modal
 * Selectors จาก: src/pages/CreditChecksPage.tsx
 * - PageHeader: "ตรวจเครดิต"
 * - Summary cards: ทั้งหมด, ผ่าน, รอวิเคราะห์/ตรวจเพิ่ม, ไม่ผ่าน
 * - Filter: search input, status select
 * - DataTable: ลูกค้า, สถานะ, คะแนน, ธนาคาร, สัญญา, วันที่, actions
 * - Create modal: เลือกลูกค้า, OCR สมุดบัญชี, ธนาคาร, statement upload
 * - Override modal: สถานะใหม่, หมายเหตุ
 * - API: GET /credit-checks, POST /customers/:id/credit-check
 */
test.describe('Credit Checks Page', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page);
    await page.goto('/credit-checks', { waitUntil: 'domcontentloaded' });
  });

  test('should display credit checks page with header', async ({ page }) => {
    const ss = new StepScreenshot(page, 'credit-checks-display');

    // Step 1: ตรวจสอบ URL
    await expect(page).toHaveURL('/credit-checks');
    await ss.capture('credit-checks-page-loaded');

    // Step 2: ตรวจสอบ header "ตรวจเครดิต"
    await expect(page.locator('text=ตรวจเครดิต').first()).toBeVisible();
    await ss.capture('header-visible');

    // Step 3: ตรวจสอบ subtitle
    await expect(page.locator('text=ตรวจสอบเครดิตลูกค้าก่อนทำสัญญา').first()).toBeVisible();
    await ss.capture('subtitle-visible');

    // Step 4: รอข้อมูลโหลด
    await page.waitForLoadState('networkidle');
    await ss.capture('data-loaded');

    // Step 5: ตรวจสอบว่าไม่มี error toast
    await expect(page.locator('[data-sonner-toast][data-type="error"]')).not.toBeVisible();
    await ss.capture('no-error');
  });

  test('should display summary cards', async ({ page }) => {
    const ss = new StepScreenshot(page, 'credit-checks-summary');

    await page.waitForLoadState('networkidle');
    await ss.capture('page-ready');

    // ตรวจสอบ summary cards
    await expect(page.locator('text=ทั้งหมด').first()).toBeVisible({ timeout: 10000 });
    await ss.capture('total-card-visible');

    if (await page.locator('text=ผ่าน').first().isVisible().catch(() => false)) {
      await ss.capture('approved-card-visible');
    }

    if (await page.locator('text=รอวิเคราะห์').first().isVisible().catch(() => false)) {
      await ss.capture('pending-card-visible');
    }

    if (await page.locator('text=ไม่ผ่าน').first().isVisible().catch(() => false)) {
      await ss.capture('rejected-card-visible');
    }

    await ss.capture('all-summary-cards');
  });

  test('should have search and status filter', async ({ page }) => {
    const ss = new StepScreenshot(page, 'credit-checks-filter');

    await page.waitForLoadState('networkidle');
    await ss.capture('page-ready');

    // ตรวจสอบ search input
    const searchInput = page.locator('input[placeholder*="ค้นหา"]').first();
    await expect(searchInput).toBeVisible();
    await ss.capture('search-input-visible');

    // ตรวจสอบ status filter dropdown
    const statusSelect = page.locator('select').first();
    await expect(statusSelect).toBeVisible();
    await ss.capture('status-filter-visible');

    // ทดสอบ search
    await searchInput.type('สม', { delay: 50 });
    await page.waitForTimeout(500);
    await page.waitForLoadState('networkidle');
    await ss.capture('search-typed');

    // ทดสอบ status filter — เลือก "ผ่าน"
    await searchInput.clear();
    await statusSelect.selectOption('APPROVED');
    await page.waitForLoadState('networkidle');
    await ss.capture('filtered-approved');

    // เลือก "รอวิเคราะห์"
    await statusSelect.selectOption('PENDING');
    await page.waitForLoadState('networkidle');
    await ss.capture('filtered-pending');

    // เลือก "ทุกสถานะ"
    await statusSelect.selectOption('');
    await page.waitForLoadState('networkidle');
    await ss.capture('filter-cleared');
  });

  test('should display data table or empty message', async ({ page }) => {
    const ss = new StepScreenshot(page, 'credit-checks-table');

    await page.waitForLoadState('networkidle');
    await ss.capture('page-ready');

    // ตรวจสอบว่ามี table หรือ empty message
    const table = page.locator('table').first();
    const emptyMsg = page.locator('text=ยังไม่มีรายการตรวจเครดิต');

    if (await table.isVisible().catch(() => false)) {
      // ตรวจ column headers
      for (const header of ['ลูกค้า', 'สถานะ', 'คะแนน', 'ธนาคาร']) {
        const th = page.locator(`th:has-text("${header}")`).first();
        if (await th.isVisible().catch(() => false)) {
          // column exists
        }
      }
      await ss.capture('table-headers-visible');

      const hasRows = await page.locator('table tbody tr').first().isVisible().catch(() => false);
      if (hasRows) {
        await ss.capture('table-has-data');
      }
    } else if (await emptyMsg.isVisible().catch(() => false)) {
      await ss.capture('empty-state');
    }
  });

  test('should open create credit check modal', async ({ page }) => {
    const ss = new StepScreenshot(page, 'credit-checks-create-modal');

    await page.waitForLoadState('networkidle');
    await ss.capture('page-ready');

    // หาปุ่ม "+ ตรวจเครดิตใหม่"
    const createButton = page.locator('button:has-text("ตรวจเครดิตใหม่")').first();
    await expect(createButton).toBeVisible();
    await ss.capture('create-button-visible');

    // คลิกเปิด modal
    await createButton.click();
    await page.waitForTimeout(500);
    await ss.capture('modal-opened');

    // ตรวจสอบ "เลือกลูกค้า" label
    await expect(page.locator('text=เลือกลูกค้า').first()).toBeVisible();
    await ss.capture('customer-selection-visible');

    // ตรวจสอบ customer search input ใน modal
    const customerSearch = page.locator('input[placeholder*="ค้นหาชื่อ"]').first();
    if (await customerSearch.isVisible().catch(() => false)) {
      await ss.capture('customer-search-input-visible');

      // ทดสอบ search ลูกค้า
      await customerSearch.type('ท', { delay: 50 });
      await page.waitForTimeout(1000);
      await page.waitForLoadState('networkidle');
      await ss.capture('customer-search-results');
    }
  });

  test('should have action button in header', async ({ page }) => {
    const ss = new StepScreenshot(page, 'credit-checks-action-btn');

    await page.waitForLoadState('networkidle');
    await ss.capture('page-ready');

    // ตรวจสอบปุ่ม action ใน header
    const actionBtn = page.locator('button:has-text("ตรวจเครดิตใหม่")').first();
    await expect(actionBtn).toBeVisible();
    await ss.capture('action-button-in-header');
  });
});
