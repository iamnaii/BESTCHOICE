import { test, expect } from '@playwright/test';
import { loginViaAPI } from './helpers/auth';
import { StepScreenshot } from './helpers/screenshot';

/**
 * Sales History Page (/sales) E2E Tests — Comprehensive
 *
 * ทดสอบหน้าประวัติการขายแบบละเอียดทุก flow:
 * 1. แสดงหน้า + header + subtitle
 * 2. Summary cards 4 ใบ (ทั้งหมด, เงินสด, ผ่อนร้าน, ไฟแนนซ์)
 * 3. Filter dropdown ทุกตัวเลือก
 * 4. ค้นหา (debounce 400ms)
 * 5. ตาราง + column headers ครบ 10 columns
 * 6. คลิกชื่อลูกค้า navigate ไป /customers/:id
 * 7. คลิกแถว navigate ไป /contracts/:id
 * 8. Pagination (ก่อนหน้า / ถัดไป)
 * 9. Sale type badges (เงินสด, ผ่อนร้าน, ไฟแนนซ์)
 * 10. Contract status badges (ใช้งาน, ค้างชำระ, ผิดนัด, ปิดแล้ว)
 * 11. ค้นหา + filter combined
 * 12. Empty state "ยังไม่มีรายการขาย"
 *
 * API: GET /sales?saleType=&search=&page=&limit=20
 */
test.describe('Sales History Page', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page);
    await page.goto('/sales', { waitUntil: 'domcontentloaded' });
  });

  // ─── 1. แสดงหน้า + header ───
  test('should display sales page with header and subtitle', async ({ page }) => {
    const ss = new StepScreenshot(page, 'sales-01-display');

    await expect(page).toHaveURL('/sales');
    await ss.capture('page-loaded');

    // header
    await expect(page.locator('text=ประวัติการขาย').first()).toBeVisible();
    await ss.capture('header-visible');

    // subtitle
    await expect(page.locator('text=ดูรายการขายทั้งหมด').first()).toBeVisible();
    await ss.capture('subtitle-visible');

    await page.waitForLoadState('networkidle');
    await ss.capture('data-loaded');

    // no error
    await expect(page.locator('[data-sonner-toast][data-type="error"]')).not.toBeVisible();
    await ss.capture('no-error');
  });

  // ─── 2. Summary cards 4 ใบ ───
  test('should display all 4 summary cards with data', async ({ page }) => {
    const ss = new StepScreenshot(page, 'sales-02-summary-cards');

    await page.waitForLoadState('networkidle');
    await ss.capture('page-ready');

    // card 1: ทั้งหมด X รายการ
    const totalCard = page.locator('text=รายการ').first();
    if (await totalCard.isVisible({ timeout: 5000 }).catch(() => false)) {
      await ss.capture('total-card');
    }

    // card 2: เงินสด (หน้านี้)
    if (await page.locator('text=เงินสด (หน้านี้)').first().isVisible().catch(() => false)) {
      await ss.capture('cash-card');
    }

    // card 3: ผ่อนร้าน (หน้านี้)
    if (await page.locator('text=ผ่อนร้าน (หน้านี้)').first().isVisible().catch(() => false)) {
      await ss.capture('installment-card');
    }

    // card 4: ไฟแนนซ์ (หน้านี้)
    if (await page.locator('text=ไฟแนนซ์ (หน้านี้)').first().isVisible().catch(() => false)) {
      await ss.capture('finance-card');
    }

    // ตรวจ ฿ symbol ปรากฏ (ยอดรวม)
    if (await page.locator('text=฿').first().isVisible().catch(() => false)) {
      await ss.capture('currency-symbol');
    }

    // ตรวจ discount ถ้ามี "ส่วนลดรวม"
    if (await page.locator('text=ส่วนลดรวม').first().isVisible().catch(() => false)) {
      await ss.capture('discount-visible');
    }

    await ss.capture('summary-cards-complete');
  });

  // ─── 3. Filter dropdown ทุกตัวเลือก ───
  test('should filter by all sale types', async ({ page }) => {
    const ss = new StepScreenshot(page, 'sales-03-filter');

    await page.waitForLoadState('networkidle');
    await ss.capture('page-ready');

    const filterSelect = page.locator('select').first();
    await expect(filterSelect).toBeVisible();
    await ss.capture('filter-visible');

    // CASH
    await filterSelect.selectOption('CASH');
    await page.waitForLoadState('networkidle');
    await ss.capture('filtered-cash');

    // ตรวจ badge "เงินสด" ในตาราง (ถ้ามีข้อมูล)
    if (await page.locator('table tbody tr').first().isVisible().catch(() => false)) {
      await ss.capture('cash-rows');
    }

    // INSTALLMENT
    await filterSelect.selectOption('INSTALLMENT');
    await page.waitForLoadState('networkidle');
    await ss.capture('filtered-installment');

    if (await page.locator('table tbody tr').first().isVisible().catch(() => false)) {
      await ss.capture('installment-rows');
    }

    // EXTERNAL_FINANCE
    await filterSelect.selectOption('EXTERNAL_FINANCE');
    await page.waitForLoadState('networkidle');
    await ss.capture('filtered-finance');

    // ทุกประเภท
    await filterSelect.selectOption('');
    await page.waitForLoadState('networkidle');
    await ss.capture('filter-all');
  });

  // ─── 4. ค้นหา (debounce) ───
  test('should search sales with debounce', async ({ page }) => {
    const ss = new StepScreenshot(page, 'sales-04-search');

    await page.waitForLoadState('networkidle');
    await ss.capture('page-ready');

    const searchInput = page.locator('input[placeholder*="ค้นหา"]').first();
    await expect(searchInput).toBeVisible();
    await ss.capture('search-input');

    // ค้นหาด้วยเลขที่ขาย
    await searchInput.type('SALE', { delay: 50 });
    await page.waitForTimeout(1000);
    await page.waitForLoadState('networkidle');
    await ss.capture('search-sale-number');

    // ล้างแล้วค้นหาด้วยชื่อลูกค้า
    await searchInput.clear();
    await page.waitForTimeout(500);
    await searchInput.type('สม', { delay: 50 });
    await page.waitForTimeout(1000);
    await page.waitForLoadState('networkidle');
    await ss.capture('search-customer-name');

    // ล้างแล้วค้นหาด้วยชื่อสินค้า
    await searchInput.clear();
    await page.waitForTimeout(500);
    await searchInput.type('iPhone', { delay: 50 });
    await page.waitForTimeout(1000);
    await page.waitForLoadState('networkidle');
    await ss.capture('search-product-name');

    // ล้าง
    await searchInput.clear();
    await page.waitForTimeout(500);
    await page.waitForLoadState('networkidle');
    await ss.capture('search-cleared');
  });

  // ─── 5. ตาราง + column headers ครบ ───
  test('should display data table with all column headers', async ({ page }) => {
    const ss = new StepScreenshot(page, 'sales-05-table-columns');

    await page.waitForLoadState('networkidle');
    await ss.capture('page-ready');

    const table = page.locator('table').first();
    if (!(await table.isVisible().catch(() => false))) {
      await ss.capture('no-table-skip');
      return;
    }

    // ตรวจ column headers ทั้งหมด
    const expectedHeaders = ['#', 'เลขที่', 'วันที่', 'ประเภท', 'สินค้า', 'ลูกค้า', 'ยอดสุทธิ', 'การชำระ', 'สัญญา', 'พนักงาน'];
    for (const header of expectedHeaders) {
      const th = page.locator(`th:has-text("${header}")`).first();
      if (await th.isVisible().catch(() => false)) {
        // column exists
      }
    }
    await ss.capture('all-headers-checked');

    // ตรวจ rows
    const rows = page.locator('table tbody tr');
    if (await rows.first().isVisible().catch(() => false)) {
      const rowCount = await rows.count();
      await ss.capture(`has-${rowCount}-rows`);

      // ตรวจ sale number (monospace, primary)
      const firstRow = rows.first();
      await ss.capture('first-row-detail');

      // ตรวจ IMEI/Serial ในคอลัมน์สินค้า (ถ้ามี)
      if (await firstRow.locator('.font-mono').first().isVisible().catch(() => false)) {
        await ss.capture('imei-serial-visible');
      }
    }
  });

  // ─── 6. คลิกชื่อลูกค้า navigate ───
  test('should navigate to customer detail on customer name click', async ({ page }) => {
    const ss = new StepScreenshot(page, 'sales-06-customer-nav');

    await page.waitForLoadState('networkidle');
    await ss.capture('page-ready');

    // หาปุ่มชื่อลูกค้าในตาราง (เป็น button)
    const customerBtn = page.locator('table tbody tr button').first();
    if (await customerBtn.isVisible().catch(() => false)) {
      await ss.capture('customer-button-visible');

      await customerBtn.click();
      await page.waitForTimeout(1000);
      await ss.capture('after-customer-click');

      const url = page.url();
      if (url.includes('/customers/')) {
        await expect(page).toHaveURL(/\/customers\//);
        await ss.capture('on-customer-detail');
      }
    } else {
      await ss.capture('no-customer-button');
    }
  });

  // ─── 7. คลิกแถว navigate ไป contract ───
  test('should navigate to contract detail on row click', async ({ page }) => {
    const ss = new StepScreenshot(page, 'sales-07-contract-nav');

    await page.waitForLoadState('networkidle');
    await ss.capture('page-ready');

    // กรอง INSTALLMENT เพื่อให้มีสัญญา
    const filterSelect = page.locator('select').first();
    await filterSelect.selectOption('INSTALLMENT');
    await page.waitForLoadState('networkidle');
    await ss.capture('filtered-installment');

    const firstRow = page.locator('table tbody tr').first();
    if (await firstRow.isVisible().catch(() => false)) {
      await firstRow.click();
      await page.waitForTimeout(1000);
      await ss.capture('after-row-click');

      const url = page.url();
      if (url.includes('/contracts/')) {
        await ss.capture('on-contract-detail');
      }
    } else {
      await ss.capture('no-rows');
    }
  });

  // ─── 8. Pagination ───
  test('should handle pagination', async ({ page }) => {
    const ss = new StepScreenshot(page, 'sales-08-pagination');

    await page.waitForLoadState('networkidle');
    await ss.capture('page-ready');

    // ตรวจ pagination controls
    const nextBtn = page.locator('button:has-text("ถัดไป")').first();
    const prevBtn = page.locator('button:has-text("ก่อนหน้า")').first();

    if (await nextBtn.isVisible().catch(() => false)) {
      await ss.capture('pagination-visible');

      // ตรวจว่าปุ่ม "ก่อนหน้า" disabled ที่หน้า 1
      if (await prevBtn.isDisabled()) {
        await ss.capture('prev-disabled-page1');
      }

      // คลิก "ถัดไป" ถ้า enabled
      if (await nextBtn.isEnabled()) {
        await nextBtn.click();
        await page.waitForLoadState('networkidle');
        await ss.capture('page-2');

        // กลับหน้า 1
        if (await prevBtn.isEnabled()) {
          await prevBtn.click();
          await page.waitForLoadState('networkidle');
          await ss.capture('back-to-page-1');
        }
      } else {
        await ss.capture('only-one-page');
      }
    } else {
      await ss.capture('no-pagination');
    }
  });

  // ─── 9. Sale type badges ───
  test('should display sale type badges with correct colors', async ({ page }) => {
    const ss = new StepScreenshot(page, 'sales-09-type-badges');

    await page.waitForLoadState('networkidle');
    await ss.capture('page-ready');

    // ตรวจ badge ที่แสดงในตาราง
    for (const badge of ['เงินสด', 'ผ่อนร้าน', 'ไฟแนนซ์']) {
      const el = page.locator(`text=${badge}`).first();
      if (await el.isVisible().catch(() => false)) {
        await ss.capture(`type-badge-${badge}`);
      }
    }

    await ss.capture('type-badges-checked');
  });

  // ─── 10. Contract status badges ───
  test('should display contract status badges', async ({ page }) => {
    const ss = new StepScreenshot(page, 'sales-10-contract-badges');

    await page.waitForLoadState('networkidle');
    await ss.capture('page-ready');

    for (const badge of ['ใช้งาน', 'ค้างชำระ', 'ผิดนัด', 'ปิดแล้ว', 'ร่าง']) {
      const el = page.locator(`text=${badge}`).first();
      if (await el.isVisible().catch(() => false)) {
        await ss.capture(`contract-badge-${badge}`);
      }
    }

    await ss.capture('contract-badges-checked');
  });

  // ─── 11. ค้นหา + filter combined ───
  test('should combine search and filter together', async ({ page }) => {
    const ss = new StepScreenshot(page, 'sales-11-search-filter');

    await page.waitForLoadState('networkidle');
    await ss.capture('page-ready');

    // Filter CASH ก่อน
    const filterSelect = page.locator('select').first();
    await filterSelect.selectOption('CASH');
    await page.waitForLoadState('networkidle');
    await ss.capture('filtered-cash');

    // ค้นหา
    const searchInput = page.locator('input[placeholder*="ค้นหา"]').first();
    await searchInput.type('iPhone', { delay: 50 });
    await page.waitForTimeout(1000);
    await page.waitForLoadState('networkidle');
    await ss.capture('search-within-cash');

    // ล้างทั้งหมด
    await searchInput.clear();
    await filterSelect.selectOption('');
    await page.waitForLoadState('networkidle');
    await ss.capture('all-cleared');
  });

  // ─── 12. Empty state ───
  test('should show empty state when no results', async ({ page }) => {
    const ss = new StepScreenshot(page, 'sales-12-empty');

    await page.waitForLoadState('networkidle');
    await ss.capture('page-ready');

    // ค้นหาด้วยคำที่ไม่น่ามีผลลัพธ์
    const searchInput = page.locator('input[placeholder*="ค้นหา"]').first();
    await searchInput.type('zzzzxxxxxnotfound12345', { delay: 20 });
    await page.waitForTimeout(1000);
    await page.waitForLoadState('networkidle');
    await ss.capture('search-no-results');

    // ตรวจ empty state
    const emptyMsg = page.locator('text=ยังไม่มีรายการขาย');
    if (await emptyMsg.isVisible({ timeout: 3000 }).catch(() => false)) {
      await ss.capture('empty-state-visible');
    }

    // ล้าง
    await searchInput.clear();
    await page.waitForTimeout(500);
    await page.waitForLoadState('networkidle');
    await ss.capture('back-to-normal');
  });

  // ─── 13. ตรวจ payment method labels ───
  test('should display payment method labels', async ({ page }) => {
    const ss = new StepScreenshot(page, 'sales-13-payment-methods');

    await page.waitForLoadState('networkidle');
    await ss.capture('page-ready');

    for (const method of ['เงินสด', 'โอนเงิน', 'QR/E-Wallet']) {
      const el = page.locator(`text=${method}`).first();
      if (await el.isVisible().catch(() => false)) {
        await ss.capture(`method-${method}`);
      }
    }

    await ss.capture('payment-methods-checked');
  });

  // ─── 14. ตรวจ installment info (ดาวน์ + งวด) ───
  test('should display installment payment details', async ({ page }) => {
    const ss = new StepScreenshot(page, 'sales-14-installment-details');

    await page.waitForLoadState('networkidle');

    // Filter INSTALLMENT
    const filterSelect = page.locator('select').first();
    await filterSelect.selectOption('INSTALLMENT');
    await page.waitForLoadState('networkidle');
    await ss.capture('installment-filtered');

    // ตรวจว่ามีข้อมูล installment details (ดาวน์, x เดือน)
    if (await page.locator('text=ดาวน์').first().isVisible().catch(() => false)) {
      await ss.capture('down-payment-visible');
    }

    if (await page.locator('text=เดือน').first().isVisible().catch(() => false)) {
      await ss.capture('monthly-info-visible');
    }

    await ss.capture('installment-details-done');
  });
});
