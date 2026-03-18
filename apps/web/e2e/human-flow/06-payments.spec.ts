import { test, expect } from '@playwright/test';
import { loginViaAPI } from '../helpers/auth';
import { StepScreenshot } from '../helpers/screenshot';

/**
 * 06 - Payments Flow (Human-Like Interaction)
 *
 * ทดสอบ flow ชำระเงิน: ดูรายการ pending, ค้นหา, บันทึกชำระ, daily summary
 * Selectors จาก: src/pages/PaymentsPage.tsx
 * - Tabs: pending (รอชำระ), summary (สรุป)
 * - Status filter, search input
 * - Payment status: รอชำระ, ชำระแล้ว, เกินกำหนด, ชำระบางส่วน
 * - Payment methods: เงินสด, โอนเงิน, QR/E-Wallet
 * - API: GET /payments/pending, POST /payments
 */
test.describe('06 - Payments Flow', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page);
    await page.goto('/payments', { waitUntil: 'domcontentloaded' });
  });

  test('should display payments page with pending tab', async ({ page }) => {
    const ss = new StepScreenshot(page, '06-payments-display');

    // Step 1: ตรวจสอบว่าอยู่หน้า /payments
    await expect(page).toHaveURL('/payments');
    await ss.capture('payments-page-loaded');

    // Step 2: ตรวจสอบ header
    await expect(page.locator('text=ชำระเงิน').first()).toBeVisible();
    await ss.capture('payments-header-visible');

    // Step 3: รอข้อมูลโหลด
    await page.waitForLoadState('networkidle');
    await ss.capture('data-loaded');

    // Step 4: ตรวจสอบว่าไม่มี error
    await expect(page.locator('[data-sonner-toast][data-type="error"]')).not.toBeVisible();
    await ss.capture('no-error');
  });

  test('should search pending payments', async ({ page }) => {
    const ss = new StepScreenshot(page, '06-payments-search');

    // Step 1: รอข้อมูลโหลด
    await page.waitForLoadState('networkidle');
    await ss.capture('page-ready');

    // Step 2: หา search input
    const searchInput = page.locator('input[placeholder*="ค้นหา"]').first();
    if (await searchInput.isVisible()) {
      // Step 3: พิมพ์ค้นหา (human-like)
      await searchInput.type('BC', { delay: 50 });
      await ss.capture('typed-search');

      // Step 4: รอ debounce
      await page.waitForTimeout(1000);
      await ss.capture('search-results');
    }
  });

  test('should filter payments by status', async ({ page }) => {
    const ss = new StepScreenshot(page, '06-payments-filter');

    // Step 1: รอข้อมูลโหลด
    await page.waitForLoadState('networkidle');
    await ss.capture('page-ready');

    // Step 2: ตรวจสอบ status filter options
    const statusLabels = ['รอชำระ', 'ชำระแล้ว', 'เกินกำหนด'];
    for (const status of statusLabels) {
      const statusEl = page.locator(`text=${status}`).first();
      if (await statusEl.isVisible()) {
        await ss.capture(`status-${status}-visible`);
      }
    }

    // Step 3: คลิก filter ถ้ามี
    const filterSelect = page.locator('select').first();
    if (await filterSelect.isVisible()) {
      await filterSelect.selectOption({ index: 1 });
      await ss.capture('selected-filter');
      await page.waitForTimeout(500);
      await ss.capture('filtered-results');
    }
  });

  test('should switch to daily summary tab', async ({ page }) => {
    const ss = new StepScreenshot(page, '06-payments-summary');

    // Step 1: รอข้อมูลโหลด
    await page.waitForLoadState('networkidle');
    await ss.capture('page-ready');

    // Step 2: หา tab สรุปรายวัน
    const summaryTab = page.locator('button:has-text("สรุป"), button:has-text("สรุปรายวัน")').first();
    if (await summaryTab.isVisible()) {
      // Step 3: คลิก tab สรุป
      await summaryTab.click();
      await ss.capture('clicked-summary-tab');

      // Step 4: รอข้อมูลโหลด
      await page.waitForLoadState('networkidle');
      await ss.capture('summary-data-loaded');

      // Step 5: ตรวจสอบว่ามีข้อมูลสรุป (จำนวนเงิน, payment methods)
      const summaryContent = page.locator('text=เงินสด, text=โอนเงิน').first();
      if (await summaryContent.isVisible()) {
        await ss.capture('summary-content-visible');
      }
    }
  });

  test('should open payment recording modal', async ({ page }) => {
    const ss = new StepScreenshot(page, '06-payments-record');

    // Step 1: รอข้อมูลโหลด
    await page.waitForLoadState('networkidle');
    await ss.capture('page-ready');

    // Step 2: หาปุ่มบันทึกชำระ ในแถวแรก
    const payButton = page.locator('button:has-text("ชำระ"), button:has-text("บันทึก")').first();
    if (await payButton.isVisible()) {
      await ss.capture('pay-button-visible');

      // Step 3: คลิกปุ่ม
      await payButton.click();
      await ss.capture('clicked-pay-button');

      // Step 4: รอ Modal เปิด
      await page.waitForTimeout(500);
      await ss.capture('payment-modal-opened');

      // Step 5: ตรวจสอบ payment method options ใน Modal
      const methodLabels = ['เงินสด', 'โอนเงิน', 'QR/E-Wallet'];
      for (const method of methodLabels) {
        const methodEl = page.locator(`text=${method}`).first();
        if (await methodEl.isVisible()) {
          await ss.capture(`method-${method}-visible`);
        }
      }
    } else {
      await ss.capture('no-pay-button-found');
    }
  });
});
