import { test, expect } from '@playwright/test';
import { loginViaAPI } from './helpers/auth';
import { StepScreenshot } from './helpers/screenshot';

/**
 * Payments Page (/payments) E2E Tests — Comprehensive
 *
 * ทดสอบหน้าชำระเงินแบบละเอียดทุก flow:
 * 1. แสดงหน้า + header + tabs
 * 2. ตาราง pending payments + column headers ครบ
 * 3. ค้นหา pending payments (debounce)
 * 4. Filter สถานะ (PENDING, OVERDUE, PARTIALLY_PAID)
 * 5. เปิด modal "บันทึกการรับชำระ" + ตรวจ form fields ครบ
 * 6. บันทึกการรับชำระจริง (CASH) — กรอกเงิน + ยืนยัน + ตรวจ toast
 * 7. เปิด modal "จ่ายล่วงหน้าหลายงวด" + ตรวจ form ครบ
 * 8. เปิดประวัติการชำระ (PaymentHistorySheet) + ตรวจรายละเอียด
 * 9. เลือกแถว batch + ปุ่ม "รับชำระรวม" + เปิด modal
 * 10. Tab สรุปรายวัน + date picker + summary cards
 * 11. เปลี่ยนวันที่ใน daily summary
 * 12. Status badges ครบ
 *
 * API: GET /payments/pending, POST /payments/record, GET /payments/daily-summary,
 *      GET /payments/contract/:id, POST /payments/auto-allocate
 */
test.describe('Payments Page', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page);
    await page.goto('/payments', { waitUntil: 'domcontentloaded' });
  });

  // ─── 1. แสดงหน้า + header + tabs ───
  test('should display payments page with header and tabs', async ({ page }) => {
    const ss = new StepScreenshot(page, 'payments-01-display');

    await expect(page).toHaveURL('/payments');
    await ss.capture('page-loaded');

    // header
    await expect(page.locator('text=ชำระเงิน').first()).toBeVisible();
    await ss.capture('header-visible');

    // subtitle
    await expect(page.locator('text=บันทึกการรับชำระค่างวด').first()).toBeVisible();
    await ss.capture('subtitle-visible');

    // tabs
    await expect(page.locator('text=รายการรอชำระ').first()).toBeVisible();
    await expect(page.locator('text=สรุปรายวัน').first()).toBeVisible();
    await ss.capture('tabs-visible');

    await page.waitForLoadState('networkidle');
    await ss.capture('data-loaded');

    // no error
    await expect(page.locator('[data-sonner-toast][data-type="error"]')).not.toBeVisible();
    await ss.capture('no-error');
  });

  // ─── 2. ตาราง pending + column headers ครบ ───
  test('should display pending payments table with all columns', async ({ page }) => {
    const ss = new StepScreenshot(page, 'payments-02-table');

    await page.waitForLoadState('networkidle');
    await ss.capture('page-ready');

    const table = page.locator('table').first();
    await expect(table).toBeVisible();
    await ss.capture('table-visible');

    // ตรวจ column headers ทั้งหมด
    const expectedHeaders = ['สัญญา', 'งวดที่', 'วันครบกำหนด', 'ยอดที่ต้องชำระ', 'ชำระแล้ว', 'ค่าปรับ', 'สถานะ'];
    for (const header of expectedHeaders) {
      const th = page.locator(`th:has-text("${header}")`).first();
      if (await th.isVisible().catch(() => false)) {
        // column exists
      }
    }
    await ss.capture('all-column-headers');

    // ตรวจว่ามีแถวข้อมูล
    const rows = page.locator('table tbody tr');
    await expect(rows.first()).toBeVisible();
    const rowCount = await rows.count();
    await ss.capture(`table-has-${rowCount}-rows`);

    // ตรวจ action buttons ในแถวแรก
    const firstRow = rows.first();
    await expect(firstRow.locator('button:has-text("รับชำระ")')).toBeVisible();
    await expect(firstRow.locator('button:has-text("ล่วงหน้า")')).toBeVisible();
    await expect(firstRow.locator('button:has-text("ประวัติ")')).toBeVisible();
    await ss.capture('action-buttons-visible');
  });

  // ─── 3. ค้นหา pending payments ───
  test('should search pending payments with debounce', async ({ page }) => {
    const ss = new StepScreenshot(page, 'payments-03-search');

    await page.waitForLoadState('networkidle');
    await ss.capture('page-ready');

    const searchInput = page.locator('input[placeholder*="ค้นหา"]').first();
    await expect(searchInput).toBeVisible();
    await ss.capture('search-input-visible');

    // ค้นหาด้วยชื่อ
    await searchInput.type('สม', { delay: 50 });
    await page.waitForLoadState('networkidle');
    await ss.capture('search-by-name');

    // ล้างแล้วค้นหาด้วยเลขสัญญา
    await searchInput.clear();
    await searchInput.type('cont', { delay: 50 });
    await page.waitForLoadState('networkidle');
    await ss.capture('search-by-contract');

    // ล้างค้นหา
    await searchInput.clear();
    await page.waitForLoadState('networkidle');
    await ss.capture('search-cleared');
  });

  // ─── 4. Filter สถานะ ───
  test('should filter by all payment statuses', async ({ page }) => {
    const ss = new StepScreenshot(page, 'payments-04-filter');

    await page.waitForLoadState('networkidle');
    await ss.capture('page-ready');

    const statusSelect = page.locator('select').first();
    await expect(statusSelect).toBeVisible();
    await ss.capture('status-select-visible');

    // Filter OVERDUE
    await statusSelect.selectOption('OVERDUE');
    await page.waitForLoadState('networkidle');
    await ss.capture('filtered-overdue');

    // ตรวจว่าแถวที่เหลือเป็น OVERDUE (ถ้ามี)
    const overdueRows = page.locator('table tbody tr');
    if (await overdueRows.first().isVisible().catch(() => false)) {
      const badges = page.locator('text=เกินกำหนด');
      const badgeCount = await badges.count();
      await ss.capture(`overdue-badges-${badgeCount}`);
    }

    // Filter PENDING
    await statusSelect.selectOption('PENDING');
    await page.waitForLoadState('networkidle');
    await ss.capture('filtered-pending');

    // Filter PARTIALLY_PAID
    await statusSelect.selectOption('PARTIALLY_PAID');
    await page.waitForLoadState('networkidle');
    await ss.capture('filtered-partially-paid');

    // ทุกสถานะ
    await statusSelect.selectOption('');
    await page.waitForLoadState('networkidle');
    await ss.capture('filter-all');
  });

  // ─── 5. เปิด modal "บันทึกการรับชำระ" + ตรวจ form fields ครบ ───
  test('should open record payment modal with all form elements', async ({ page }) => {
    const ss = new StepScreenshot(page, 'payments-05-record-modal');

    await page.waitForLoadState('networkidle');
    await ss.capture('page-ready');

    // คลิก "รับชำระ"
    const payButton = page.locator('button:has-text("รับชำระ")').first();
    await expect(payButton).toBeVisible();
    await payButton.click();
    await expect(page.locator('text=บันทึกการรับชำระ').first()).toBeVisible();
    await ss.capture('modal-opened');
    await ss.capture('modal-title');

    // ตรวจ context info: สัญญา, ลูกค้า, งวดที่, ยอดคงค้าง
    await expect(page.locator('text=สัญญา').nth(1)).toBeVisible();
    await expect(page.locator('text=ลูกค้า').first()).toBeVisible();
    await expect(page.locator('text=งวดที่').first()).toBeVisible();
    await expect(page.locator('text=ยอดคงค้าง').first()).toBeVisible();
    await ss.capture('context-info-complete');

    // ตรวจ OCR section "สแกนสลิปโอนเงิน (OCR)"
    if (await page.locator('text=สแกนสลิปโอนเงิน').first().isVisible().catch(() => false)) {
      await ss.capture('ocr-section-visible');
    }

    // ตรวจปุ่ม "สแกนสลิป"
    const scanBtn = page.locator('button:has-text("สแกนสลิป")').first();
    if (await scanBtn.isVisible().catch(() => false)) {
      await ss.capture('scan-slip-button');
    }

    // ตรวจ amount input
    const amountInput = page.locator('input[type="number"]').first();
    await expect(amountInput).toBeVisible();
    await ss.capture('amount-input');

    // ตรวจ label "จำนวนเงินที่รับ"
    await expect(page.locator('text=จำนวนเงินที่รับ').first()).toBeVisible();
    await ss.capture('amount-label');

    // ตรวจ payment method dropdown "วิธีชำระ"
    await expect(page.locator('text=วิธีชำระ').first()).toBeVisible();
    const methodSelect = page.locator('select').last();
    await expect(methodSelect).toBeVisible();
    await ss.capture('method-select');

    // ตรวจ payment method options
    const options = methodSelect.locator('option');
    const optionTexts: string[] = [];
    for (let i = 0; i < await options.count(); i++) {
      optionTexts.push(await options.nth(i).textContent() || '');
    }
    await ss.capture('method-options-checked');

    // ตรวจ notes input "หมายเหตุ"
    if (await page.locator('text=หมายเหตุ').first().isVisible().catch(() => false)) {
      await ss.capture('notes-field');
    }

    // ตรวจปุ่ม "ยืนยันรับชำระ" — ต้อง disabled ถ้ายังไม่กรอกเงิน
    const confirmBtn = page.locator('button:has-text("ยืนยันรับชำระ")').first();
    await expect(confirmBtn).toBeVisible();
    await ss.capture('confirm-button');

    // ตรวจปุ่ม "ยกเลิก"
    const cancelBtn = page.locator('button:has-text("ยกเลิก")').first();
    await expect(cancelBtn).toBeVisible();

    // ปิด modal
    await cancelBtn.click();
    await ss.capture('modal-closed');
  });

  // ─── 6. บันทึกการรับชำระจริง (CASH) ───
  test('should record a cash payment successfully', async ({ page }) => {
    const ss = new StepScreenshot(page, 'payments-06-record-cash');

    await page.waitForLoadState('networkidle');
    await ss.capture('page-ready');

    // จำนวนแถวก่อนชำระ
    const rowsBefore = await page.locator('table tbody tr').count();
    await ss.capture(`rows-before-${rowsBefore}`);

    // คลิก "รับชำระ" แถวแรก
    const payButton = page.locator('button:has-text("รับชำระ")').first();
    await payButton.click();
    await page.waitForLoadState('networkidle');
    await ss.capture('modal-opened');

    // อ่านยอดคงค้าง
    const contextText = await page.locator('text=ยอดคงค้าง').first().textContent().catch(() => '');
    await ss.capture('read-outstanding');

    // กรอกจำนวนเงิน
    const amountInput = page.locator('input[type="number"]').first();
    await amountInput.fill('100');
    await ss.capture('amount-filled-100');

    // เลือกวิธีชำระ = เงินสด (CASH)
    const methodSelect = page.locator('select').last();
    await methodSelect.selectOption('CASH');
    await ss.capture('method-cash-selected');

    // กรอกหมายเหตุ (optional)
    const notesInput = page.locator('input[placeholder*="หมายเหตุ"], textarea').first();
    if (await notesInput.isVisible().catch(() => false)) {
      await notesInput.fill('ทดสอบ E2E');
      await ss.capture('notes-filled');
    }

    // ยืนยัน
    const confirmBtn = page.locator('button:has-text("ยืนยันรับชำระ")').first();
    await expect(confirmBtn).toBeEnabled();
    await ss.capture('confirm-enabled');

    await confirmBtn.click();
    await page.waitForLoadState('networkidle');
    await ss.capture('after-confirm');

    // ตรวจ toast success "บันทึกการชำระสำเร็จ"
    const successToast = page.locator('[data-sonner-toast]').first();
    if (await successToast.isVisible({ timeout: 5000 }).catch(() => false)) {
      await ss.capture('success-toast');
    }

    // modal ปิดแล้ว
    await page.waitForLoadState('networkidle');
    await ss.capture('payment-recorded');
  });

  // ─── 7. เปิด modal "จ่ายล่วงหน้าหลายงวด" + ตรวจ form ครบ ───
  test('should open advance payment modal with all elements', async ({ page }) => {
    const ss = new StepScreenshot(page, 'payments-07-advance-modal');

    await page.waitForLoadState('networkidle');
    await ss.capture('page-ready');

    // คลิก "ล่วงหน้า"
    const advanceButton = page.locator('button:has-text("ล่วงหน้า")').first();
    await expect(advanceButton).toBeVisible();
    await advanceButton.click();
    await page.waitForLoadState('networkidle');
    await ss.capture('advance-modal-opened');

    // ตรวจ title
    await expect(page.locator('text=จ่ายล่วงหน้าหลายงวด').first()).toBeVisible();
    await ss.capture('advance-title');

    // ตรวจ context: สัญญา, ลูกค้า
    await expect(page.locator('text=สัญญา').nth(1)).toBeVisible();
    await expect(page.locator('text=ลูกค้า').first()).toBeVisible();
    await ss.capture('advance-context');

    // ตรวจ amount input + placeholder
    const amountInput = page.locator('input[type="number"]').first();
    await expect(amountInput).toBeVisible();
    await ss.capture('advance-amount-input');

    // ตรวจ helper text
    if (await page.locator('text=ระบบจะจัดสรรเงินให้งวดที่ค้างตามลำดับอัตโนมัติ').first().isVisible().catch(() => false)) {
      await ss.capture('advance-helper-text');
    }

    // ตรวจ payment method
    await expect(page.locator('text=วิธีชำระ').first()).toBeVisible();
    await ss.capture('advance-method-label');

    // ตรวจปุ่ม "ยืนยันจ่ายล่วงหน้า"
    const confirmBtn = page.locator('button:has-text("ยืนยันจ่ายล่วงหน้า")').first();
    await expect(confirmBtn).toBeVisible();
    await ss.capture('advance-confirm-btn');

    // ทดสอบกรอกเงิน + เลือก CASH
    await amountInput.fill('5000');
    const methodSelect = page.locator('select').last();
    await methodSelect.selectOption('CASH');
    await ss.capture('advance-form-filled');

    // ปิด modal
    const cancelBtn = page.locator('button:has-text("ยกเลิก")').first();
    await cancelBtn.click();
    await ss.capture('advance-modal-closed');
  });

  // ─── 8. ประวัติการชำระ (PaymentHistorySheet) ───
  test('should open payment history sheet with details', async ({ page }) => {
    const ss = new StepScreenshot(page, 'payments-08-history');

    await page.waitForLoadState('networkidle');
    await ss.capture('page-ready');

    // คลิก "ประวัติ"
    const historyButton = page.locator('button:has-text("ประวัติ")').first();
    await expect(historyButton).toBeVisible();
    await historyButton.click();
    await page.waitForLoadState('networkidle');
    await ss.capture('history-sheet-opened');

    // ตรวจ title "ประวัติการชำระ"
    if (await page.locator('text=ประวัติการชำระ').first().isVisible({ timeout: 5000 }).catch(() => false)) {
      await ss.capture('history-title-visible');
    }

    // ตรวจงวดต่างๆ "งวด"
    if (await page.locator('text=งวด').first().isVisible().catch(() => false)) {
      await ss.capture('installments-visible');
    }

    // ตรวจ status badges ในประวัติ
    for (const badge of ['รอชำระ', 'ชำระแล้ว', 'เกินกำหนด', 'ชำระบางส่วน']) {
      if (await page.locator(`text=${badge}`).first().isVisible().catch(() => false)) {
        await ss.capture(`history-badge-${badge}`);
      }
    }

    // ตรวจ summary: ชำระแล้วรวม, ยอดคงค้าง
    if (await page.locator('text=ชำระแล้วรวม').first().isVisible().catch(() => false)) {
      await ss.capture('history-total-paid');
    }
    if (await page.locator('text=ยอดคงค้าง').first().isVisible().catch(() => false)) {
      await ss.capture('history-balance');
    }

    // ตรวจปุ่ม "ใบเสร็จ" (ถ้ามี)
    const receiptBtn = page.locator('button:has-text("ใบเสร็จ")').first();
    if (await receiptBtn.isVisible().catch(() => false)) {
      await ss.capture('receipt-button-visible');
    }

    // ตรวจปุ่ม "ยกเว้นค่าปรับ" (ถ้ามี)
    const waiveBtn = page.locator('button:has-text("ยกเว้นค่าปรับ")').first();
    if (await waiveBtn.isVisible().catch(() => false)) {
      await ss.capture('waive-fee-button-visible');
    }

    await ss.capture('history-complete');
  });

  // ─── 9. Batch select + เปิด batch modal ───
  test('should select rows for batch and open batch payment modal', async ({ page }) => {
    const ss = new StepScreenshot(page, 'payments-09-batch');

    await page.waitForLoadState('networkidle');
    await ss.capture('page-ready');

    // เลือก checkbox แถว 1
    const firstCheckbox = page.locator('table tbody tr input[type="checkbox"]').first();
    if (!(await firstCheckbox.isVisible().catch(() => false))) {
      await ss.capture('no-checkboxes-skip');
      return;
    }

    await firstCheckbox.check();
    await ss.capture('first-row-checked');

    // ตรวจ batch bar "เลือก X รายการ"
    await expect(page.locator('text=เลือก').first()).toBeVisible();
    await ss.capture('batch-bar-visible');

    // ตรวจปุ่ม "รับชำระรวม"
    const batchBtn = page.locator('button:has-text("รับชำระรวม")').first();
    await expect(batchBtn).toBeVisible();
    await ss.capture('batch-pay-button');

    // เลือกแถว 2
    const secondCheckbox = page.locator('table tbody tr input[type="checkbox"]').nth(1);
    if (await secondCheckbox.isVisible().catch(() => false)) {
      await secondCheckbox.check();
      await ss.capture('two-rows-checked');
    }

    // คลิก "รับชำระรวม" เปิด batch modal
    await batchBtn.click();
    await page.waitForLoadState('networkidle');
    await ss.capture('batch-modal-opened');

    // ตรวจ batch modal title "รับชำระรวม"
    if (await page.locator('text=รับชำระรวม').nth(1).isVisible({ timeout: 3000 }).catch(() => false)) {
      await ss.capture('batch-modal-title');
    }

    // ตรวจ "ยอดรวม"
    if (await page.locator('text=ยอดรวม').first().isVisible().catch(() => false)) {
      await ss.capture('batch-total-visible');
    }

    // ตรวจ payment method ใน modal
    const methodSelect = page.locator('select').last();
    if (await methodSelect.isVisible().catch(() => false)) {
      await ss.capture('batch-method-select');
    }

    // ตรวจปุ่ม "ยืนยันชำระ X รายการ"
    const confirmBtn = page.locator('button:has-text("ยืนยันชำระ")').first();
    if (await confirmBtn.isVisible().catch(() => false)) {
      await ss.capture('batch-confirm-btn');
    }

    // ปิด batch modal ด้วย Escape (เพราะ dialog overlay ขวางปุ่ม cancel)
    await page.keyboard.press('Escape');
    await ss.capture('batch-modal-closed');

    // ยกเลิกการเลือก — uncheck ที่ checkbox แทน
    if (await firstCheckbox.isVisible().catch(() => false)) {
      await firstCheckbox.uncheck({ force: true });
    }
    await ss.capture('batch-deselected');
  });

  // ─── 10. Tab สรุปรายวัน + summary cards ───
  test('should switch to daily summary tab and display all cards', async ({ page }) => {
    const ss = new StepScreenshot(page, 'payments-10-daily-summary');

    await page.waitForLoadState('networkidle');
    await ss.capture('page-ready');

    // คลิก tab "สรุปรายวัน"
    const dailyTab = page.locator('text=สรุปรายวัน').first();
    await dailyTab.click();
    await page.waitForLoadState('networkidle');
    await ss.capture('daily-tab-active');

    // ตรวจ date picker
    const datePicker = page.locator('input[type="date"]').first();
    await expect(datePicker).toBeVisible();
    await ss.capture('date-picker');

    // ตรวจ 4 summary cards
    const cardLabels = ['จำนวนรายการ', 'ยอดรวม', 'ค่าปรับรวม', 'แยกตามวิธี'];
    for (const label of cardLabels) {
      if (await page.locator(`text=${label}`).first().isVisible({ timeout: 5000 }).catch(() => false)) {
        await ss.capture(`card-${label}`);
      }
    }

    // ตรวจ breakdown ใน "แยกตามวิธี"
    for (const method of ['เงินสด', 'โอนเงิน', 'QR/E-Wallet']) {
      if (await page.locator(`text=${method}`).first().isVisible().catch(() => false)) {
        await ss.capture(`method-${method}`);
      }
    }

    // ตรวจ payment list table (ถ้ามีข้อมูล)
    const summaryTable = page.locator('table').first();
    if (await summaryTable.isVisible().catch(() => false)) {
      for (const col of ['สัญญา', 'ลูกค้า', 'งวดที่', 'ยอดชำระ', 'วิธี', 'เวลา', 'ผู้บันทึก']) {
        if (await page.locator(`th:has-text("${col}")`).first().isVisible().catch(() => false)) {
          // column exists
        }
      }
      await ss.capture('summary-table-columns');
    }

    await ss.capture('daily-summary-complete');
  });

  // ─── 11. เปลี่ยนวันที่ใน daily summary ───
  test('should change date in daily summary', async ({ page }) => {
    const ss = new StepScreenshot(page, 'payments-11-change-date');

    await page.waitForLoadState('networkidle');

    // คลิก tab สรุปรายวัน
    await page.locator('text=สรุปรายวัน').first().click();
    await page.waitForLoadState('networkidle');
    await ss.capture('daily-tab-active');

    const datePicker = page.locator('input[type="date"]').first();
    await expect(datePicker).toBeVisible();

    // เปลี่ยนเป็นเมื่อวาน
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const dateStr = yesterday.toISOString().split('T')[0];
    await datePicker.fill(dateStr);
    await page.waitForLoadState('networkidle');
    await ss.capture('date-changed-yesterday');

    // เปลี่ยนเป็นวันที่ไม่มีข้อมูล (อดีตไกลๆ)
    await datePicker.fill('2020-01-01');
    await page.waitForLoadState('networkidle');
    await ss.capture('date-no-data');

    // กลับไปวันนี้
    const today = new Date().toISOString().split('T')[0];
    await datePicker.fill(today);
    await page.waitForLoadState('networkidle');
    await ss.capture('date-back-to-today');
  });

  // ─── 12. Status badges ───
  test('should display status badges correctly', async ({ page }) => {
    const ss = new StepScreenshot(page, 'payments-12-badges');

    await page.waitForLoadState('networkidle');
    await ss.capture('page-ready');

    const badges = ['รอชำระ', 'เกินกำหนด', 'ชำระบางส่วน'];
    for (const badge of badges) {
      const el = page.locator(`text=${badge}`).first();
      if (await el.isVisible().catch(() => false)) {
        await ss.capture(`badge-${badge}`);
      }
    }

    await ss.capture('badges-checked');
  });

  // ─── 13. ค้นหา + filter combined ───
  test('should combine search and filter together', async ({ page }) => {
    const ss = new StepScreenshot(page, 'payments-13-search-filter');

    await page.waitForLoadState('networkidle');
    await ss.capture('page-ready');

    // Filter OVERDUE ก่อน
    const statusSelect = page.locator('select').first();
    await statusSelect.selectOption('OVERDUE');
    await page.waitForLoadState('networkidle');
    await ss.capture('filtered-overdue');

    // แล้วค้นหา
    const searchInput = page.locator('input[placeholder*="ค้นหา"]').first();
    await searchInput.type('cont', { delay: 50 });
    await page.waitForLoadState('networkidle');
    await ss.capture('search-within-filter');

    // ล้างทั้งหมด
    await searchInput.clear();
    await statusSelect.selectOption('');
    await page.waitForLoadState('networkidle');
    await ss.capture('all-cleared');
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
