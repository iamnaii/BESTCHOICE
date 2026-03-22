import { test, expect } from '@playwright/test';
import { loginViaAPI } from './helpers/auth';
import { StepScreenshot } from './helpers/screenshot';

/**
 * Payments Page (/payments) E2E Tests
 *
 * ทดสอบหน้าชำระเงิน: Tab รายการรอชำระ + สรุปรายวัน, filter, search,
 * record payment modal, advance payment modal, batch select, payment history
 *
 * Selectors จาก: src/pages/PaymentsPage.tsx
 * - PageHeader: "ชำระเงิน"
 * - Tabs: "รายการรอชำระ", "สรุปรายวัน"
 * - Pending tab: search, status filter, data table, action buttons
 * - Daily summary tab: date picker, summary cards, payment list
 * - Modals: บันทึกการรับชำระ, จ่ายล่วงหน้าหลายงวด
 * - API: GET /payments/pending, POST /payments/record, GET /payments/daily-summary
 */
test.describe('Payments Page', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page);
    await page.goto('/payments', { waitUntil: 'domcontentloaded' });
  });

  test('should display payments page with header and tabs', async ({ page }) => {
    const ss = new StepScreenshot(page, 'payments-display');

    // Step 1: ตรวจ URL
    await expect(page).toHaveURL('/payments');
    await ss.capture('payments-page-loaded');

    // Step 2: ตรวจ header "ชำระเงิน"
    await expect(page.locator('text=ชำระเงิน').first()).toBeVisible();
    await ss.capture('header-visible');

    // Step 3: ตรวจ subtitle
    await expect(page.locator('text=บันทึกการรับชำระค่างวด').first()).toBeVisible();
    await ss.capture('subtitle-visible');

    // Step 4: ตรวจ tabs
    await expect(page.locator('text=รายการรอชำระ').first()).toBeVisible();
    await expect(page.locator('text=สรุปรายวัน').first()).toBeVisible();
    await ss.capture('tabs-visible');

    // Step 5: รอข้อมูลโหลด
    await page.waitForLoadState('networkidle');
    await ss.capture('data-loaded');

    // Step 6: ไม่มี error
    await expect(page.locator('[data-sonner-toast][data-type="error"]')).not.toBeVisible();
    await ss.capture('no-error');
  });

  test('should display pending payments table with data', async ({ page }) => {
    const ss = new StepScreenshot(page, 'payments-pending-table');

    await page.waitForLoadState('networkidle');
    await ss.capture('page-ready');

    // ตรวจ table
    const table = page.locator('table').first();
    await expect(table).toBeVisible();
    await ss.capture('table-visible');

    // ตรวจ column headers
    for (const header of ['สัญญา', 'งวดที่', 'วันครบกำหนด', 'สถานะ']) {
      await expect(page.locator(`th:has-text("${header}")`).first()).toBeVisible();
    }
    await ss.capture('table-headers-visible');

    // ตรวจว่ามีแถวข้อมูล
    const rows = page.locator('table tbody tr');
    await expect(rows.first()).toBeVisible();
    await ss.capture('table-has-data');
  });

  test('should search pending payments', async ({ page }) => {
    const ss = new StepScreenshot(page, 'payments-search');

    await page.waitForLoadState('networkidle');
    await ss.capture('page-ready');

    // หา search input
    const searchInput = page.locator('input[placeholder*="ค้นหา"]').first();
    await expect(searchInput).toBeVisible();
    await ss.capture('search-input-visible');

    // พิมพ์ค้นหา
    await searchInput.type('สม', { delay: 50 });
    await page.waitForTimeout(1000);
    await page.waitForLoadState('networkidle');
    await ss.capture('search-results');

    // ล้าง search
    await searchInput.clear();
    await page.waitForTimeout(500);
    await page.waitForLoadState('networkidle');
    await ss.capture('search-cleared');
  });

  test('should filter by payment status', async ({ page }) => {
    const ss = new StepScreenshot(page, 'payments-status-filter');

    await page.waitForLoadState('networkidle');
    await ss.capture('page-ready');

    // หา status filter select
    const statusSelect = page.locator('select').first();
    await expect(statusSelect).toBeVisible();
    await ss.capture('status-filter-visible');

    // เลือก "เกินกำหนด" (OVERDUE)
    await statusSelect.selectOption('OVERDUE');
    await page.waitForLoadState('networkidle');
    await ss.capture('filtered-overdue');

    // เลือก "รอชำระ" (PENDING)
    await statusSelect.selectOption('PENDING');
    await page.waitForLoadState('networkidle');
    await ss.capture('filtered-pending');

    // เลือก "ทุกสถานะ"
    await statusSelect.selectOption('');
    await page.waitForLoadState('networkidle');
    await ss.capture('filter-cleared');
  });

  test('should open record payment modal', async ({ page }) => {
    const ss = new StepScreenshot(page, 'payments-record-modal');

    await page.waitForLoadState('networkidle');
    await ss.capture('page-ready');

    // หาปุ่ม "รับชำระ" ในแถวแรก
    const payButton = page.locator('button:has-text("รับชำระ")').first();
    await expect(payButton).toBeVisible();
    await ss.capture('pay-button-visible');

    // คลิกเปิด modal
    await payButton.click();
    await page.waitForTimeout(500);
    await ss.capture('modal-opened');

    // ตรวจ modal title
    await expect(page.locator('text=บันทึกการรับชำระ').first()).toBeVisible();
    await ss.capture('modal-title-visible');

    // ตรวจ context info: สัญญา, ลูกค้า, งวดที่, ยอดคงค้าง
    await expect(page.locator('text=สัญญา').nth(1)).toBeVisible();
    await ss.capture('contract-info-visible');

    // ตรวจ form fields
    const amountInput = page.locator('input[type="number"]').first();
    await expect(amountInput).toBeVisible();
    await ss.capture('amount-input-visible');

    // ตรวจ payment method dropdown ใน modal
    const methodSelect = page.locator('select').last();
    await expect(methodSelect).toBeVisible();
    await ss.capture('method-select-visible');

    // ตรวจปุ่ม "สแกนสลิป"
    const scanBtn = page.locator('button:has-text("สแกนสลิป")').first();
    if (await scanBtn.isVisible().catch(() => false)) {
      await ss.capture('scan-slip-button-visible');
    }

    // ตรวจปุ่ม "ยืนยันรับชำระ"
    const confirmBtn = page.locator('button:has-text("ยืนยันรับชำระ")').first();
    await expect(confirmBtn).toBeVisible();
    await ss.capture('confirm-button-visible');

    // ตรวจปุ่ม "ยกเลิก"
    const cancelBtn = page.locator('button:has-text("ยกเลิก")').first();
    await expect(cancelBtn).toBeVisible();
    await ss.capture('cancel-button-visible');

    // ปิด modal
    await cancelBtn.click();
    await page.waitForTimeout(300);
    await ss.capture('modal-closed');
  });

  test('should open advance payment modal', async ({ page }) => {
    const ss = new StepScreenshot(page, 'payments-advance-modal');

    await page.waitForLoadState('networkidle');
    await ss.capture('page-ready');

    // หาปุ่ม "ล่วงหน้า"
    const advanceButton = page.locator('button:has-text("ล่วงหน้า")').first();
    await expect(advanceButton).toBeVisible();
    await ss.capture('advance-button-visible');

    // คลิกเปิด modal
    await advanceButton.click();
    await page.waitForTimeout(500);
    await ss.capture('advance-modal-opened');

    // ตรวจ modal title
    await expect(page.locator('text=จ่ายล่วงหน้าหลายงวด').first()).toBeVisible();
    await ss.capture('advance-modal-title');

    // ตรวจ context: สัญญา, ลูกค้า
    await expect(page.locator('text=สัญญา').nth(1)).toBeVisible();
    await ss.capture('advance-context-visible');

    // ตรวจ amount input
    const amountInput = page.locator('input[type="number"]').first();
    await expect(amountInput).toBeVisible();
    await ss.capture('advance-amount-input');

    // ตรวจปุ่ม "ยืนยันจ่ายล่วงหน้า"
    const confirmBtn = page.locator('button:has-text("ยืนยันจ่ายล่วงหน้า")').first();
    await expect(confirmBtn).toBeVisible();
    await ss.capture('advance-confirm-button');

    // ปิด modal
    const cancelBtn = page.locator('button:has-text("ยกเลิก")').first();
    await cancelBtn.click();
    await page.waitForTimeout(300);
    await ss.capture('advance-modal-closed');
  });

  test('should open payment history', async ({ page }) => {
    const ss = new StepScreenshot(page, 'payments-history');

    await page.waitForLoadState('networkidle');
    await ss.capture('page-ready');

    // หาปุ่ม "ประวัติ"
    const historyButton = page.locator('button:has-text("ประวัติ")').first();
    await expect(historyButton).toBeVisible();
    await ss.capture('history-button-visible');

    // คลิกเปิด history sheet
    await historyButton.click();
    await page.waitForTimeout(500);
    await ss.capture('history-opened');

    // ตรวจว่ามี content แสดง (ประวัติการชำระ หรือ sheet)
    await page.waitForLoadState('networkidle');
    await ss.capture('history-loaded');
  });

  test('should select rows for batch payment', async ({ page }) => {
    const ss = new StepScreenshot(page, 'payments-batch-select');

    await page.waitForLoadState('networkidle');
    await ss.capture('page-ready');

    // หา checkbox ในแถวแรก
    const firstCheckbox = page.locator('table tbody tr input[type="checkbox"]').first();
    if (await firstCheckbox.isVisible().catch(() => false)) {
      await firstCheckbox.check();
      await page.waitForTimeout(300);
      await ss.capture('first-row-checked');

      // ตรวจ batch bar แสดง "เลือก X รายการ"
      await expect(page.locator('text=เลือก').first()).toBeVisible();
      await ss.capture('batch-bar-visible');

      // ตรวจปุ่ม "รับชำระรวม"
      const batchBtn = page.locator('button:has-text("รับชำระรวม")').first();
      await expect(batchBtn).toBeVisible();
      await ss.capture('batch-pay-button-visible');

      // เลือกเพิ่มอีกแถว
      const secondCheckbox = page.locator('table tbody tr input[type="checkbox"]').nth(1);
      if (await secondCheckbox.isVisible().catch(() => false)) {
        await secondCheckbox.check();
        await page.waitForTimeout(300);
        await ss.capture('two-rows-checked');
      }

      // ยกเลิกการเลือก
      const cancelBtn = page.locator('button:has-text("ยกเลิก"), text=ยกเลิก').last();
      if (await cancelBtn.isVisible().catch(() => false)) {
        await cancelBtn.click();
        await page.waitForTimeout(300);
        await ss.capture('batch-cancelled');
      }
    } else {
      await ss.capture('no-checkboxes');
    }
  });

  test('should switch to daily summary tab', async ({ page }) => {
    const ss = new StepScreenshot(page, 'payments-daily-summary');

    await page.waitForLoadState('networkidle');
    await ss.capture('page-ready');

    // คลิก tab "สรุปรายวัน"
    const dailyTab = page.locator('text=สรุปรายวัน').first();
    await expect(dailyTab).toBeVisible();
    await dailyTab.click();
    await page.waitForTimeout(500);
    await page.waitForLoadState('networkidle');
    await ss.capture('daily-summary-tab-active');

    // ตรวจ date picker
    const datePicker = page.locator('input[type="date"]').first();
    await expect(datePicker).toBeVisible();
    await ss.capture('date-picker-visible');

    // ตรวจ summary cards
    if (await page.locator('text=จำนวนรายการ').first().isVisible({ timeout: 5000 }).catch(() => false)) {
      await ss.capture('transaction-count-card');
    }

    if (await page.locator('text=ยอดรวม').first().isVisible().catch(() => false)) {
      await ss.capture('total-amount-card');
    }

    if (await page.locator('text=ค่าปรับรวม').first().isVisible().catch(() => false)) {
      await ss.capture('total-late-fees-card');
    }

    if (await page.locator('text=แยกตามวิธี').first().isVisible().catch(() => false)) {
      await ss.capture('by-method-card');
    }

    await ss.capture('daily-summary-complete');
  });

  test('should display status badges correctly', async ({ page }) => {
    const ss = new StepScreenshot(page, 'payments-status-badges');

    await page.waitForLoadState('networkidle');
    await ss.capture('page-ready');

    // ตรวจ status badges ที่แสดงในตาราง
    const badges = ['รอชำระ', 'เกินกำหนด', 'ชำระบางส่วน'];
    for (const badge of badges) {
      const el = page.locator(`text=${badge}`).first();
      if (await el.isVisible().catch(() => false)) {
        await ss.capture(`badge-${badge}`);
      }
    }

    await ss.capture('badges-checked');
  });
});

test.describe('Overdue Page', () => {
  test('should display overdue tracking', async ({ page }) => {
    await loginViaAPI(page);
    await page.goto('/overdue', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL('/overdue');
  });
});

test.describe('Slip Review Page', () => {
  test('should display slip review page', async ({ page }) => {
    await loginViaAPI(page);
    await page.goto('/slip-review', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL('/slip-review');
  });
});
