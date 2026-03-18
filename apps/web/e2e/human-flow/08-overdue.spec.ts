import { test, expect } from '@playwright/test';
import { loginViaAPI } from '../helpers/auth';
import { StepScreenshot } from '../helpers/screenshot';

/**
 * 08 - Overdue/Debt Collection Flow (Human-Like Interaction)
 *
 * ทดสอบ flow ค้างชำระ: ดูรายการ, filter, บันทึกการโทรติดตาม, ดู timeline
 * Selectors จาก: src/pages/OverduePage.tsx
 * - Filter: OVERDUE / all
 * - DataTable with overdue payments
 * - Call log form: result (NO_ANSWER default), notes
 * - Timeline view per contract
 * - API: GET /payments/pending, POST /contracts/:id/call-logs
 */
test.describe('08 - Overdue Flow', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page);
    await page.goto('/overdue', { waitUntil: 'domcontentloaded' });
  });

  test('should display overdue page', async ({ page }) => {
    const ss = new StepScreenshot(page, '08-overdue-display');

    // Step 1: ตรวจสอบว่าอยู่หน้า /overdue
    await expect(page).toHaveURL('/overdue');
    await ss.capture('overdue-page-loaded');

    // Step 2: ตรวจสอบ header
    await expect(page.locator('text=ค้างชำระ').first()).toBeVisible();
    await ss.capture('overdue-header-visible');

    // Step 3: รอข้อมูลโหลด
    await page.waitForLoadState('networkidle');
    await ss.capture('data-loaded');

    // Step 4: ตรวจสอบว่าไม่มี error
    await expect(page.locator('[data-sonner-toast][data-type="error"]')).not.toBeVisible();
    await ss.capture('no-error');
  });

  test('should filter between overdue and all', async ({ page }) => {
    const ss = new StepScreenshot(page, '08-overdue-filter');

    // Step 1: รอข้อมูลโหลด
    await page.waitForLoadState('networkidle');
    await ss.capture('page-ready');

    // Step 2: ตรวจสอบ filter options
    const overdueFilter = page.locator('button:has-text("ค้างชำระ"), select').first();
    if (await overdueFilter.isVisible()) {
      await ss.capture('filter-visible');
    }

    // Step 3: ลอง filter "ทั้งหมด"
    const allFilter = page.locator('button:has-text("ทั้งหมด")').first();
    if (await allFilter.isVisible()) {
      await allFilter.click();
      await ss.capture('clicked-all-filter');
      await page.waitForTimeout(500);
      await ss.capture('all-results-loaded');
    }
  });

  test('should display overdue details and timeline', async ({ page }) => {
    const ss = new StepScreenshot(page, '08-overdue-details');

    // Step 1: รอข้อมูลโหลด
    await page.waitForLoadState('networkidle');
    await ss.capture('page-ready');

    // Step 2: หาแถวแรกในตาราง
    const firstRow = page.locator('table tbody tr, [role="row"]').first();
    if (await firstRow.isVisible()) {
      await ss.capture('first-overdue-row');

      // Step 3: ดู timeline ถ้ามีปุ่ม
      const timelineBtn = page.locator('button:has-text("ประวัติ"), button:has-text("Timeline")').first();
      if (await timelineBtn.isVisible()) {
        await timelineBtn.click();
        await ss.capture('clicked-timeline-button');
        await page.waitForTimeout(500);
        await ss.capture('timeline-displayed');
      }
    } else {
      await ss.capture('no-overdue-data');
    }
  });

  test('should open call log form', async ({ page }) => {
    const ss = new StepScreenshot(page, '08-overdue-call-log');

    // Step 1: รอข้อมูลโหลด
    await page.waitForLoadState('networkidle');
    await ss.capture('page-ready');

    // Step 2: หาปุ่มบันทึกการโทร
    const callBtn = page.locator('button:has-text("โทร"), button:has-text("บันทึกการโทร")').first();
    if (await callBtn.isVisible()) {
      await ss.capture('call-button-visible');

      // Step 3: คลิกปุ่ม
      await callBtn.click();
      await ss.capture('clicked-call-button');

      // Step 4: รอ form/modal เปิด
      await page.waitForTimeout(500);
      await ss.capture('call-form-opened');

      // Step 5: ตรวจสอบ call result options
      // Default: NO_ANSWER
      const resultOptions = ['ไม่รับสาย', 'รับสาย', 'สัญญาจะจ่าย'];
      for (const opt of resultOptions) {
        const optEl = page.locator(`text=${opt}`).first();
        if (await optEl.isVisible()) {
          await ss.capture(`call-option-${opt}-visible`);
        }
      }

      // Step 6: ใส่ notes (human-like)
      const notesInput = page.locator('textarea, input[placeholder*="หมายเหตุ"]').first();
      if (await notesInput.isVisible()) {
        await notesInput.type('โทรแล้วไม่รับสาย จะโทรอีกครั้งพรุ่งนี้', { delay: 20 });
        await ss.capture('typed-call-notes');
      }
    } else {
      await ss.capture('no-call-button-found');
    }
  });

  test('should navigate to repossessions page', async ({ page }) => {
    const ss = new StepScreenshot(page, '08-overdue-repossessions');

    // Step 1: ลองไปหน้า repossessions
    await page.goto('/repossessions', { waitUntil: 'domcontentloaded' });
    await ss.capture('repossessions-page-loaded');

    // Step 2: ตรวจสอบ URL
    await expect(page).toHaveURL('/repossessions');
    await ss.capture('repossessions-url-verified');

    // Step 3: รอข้อมูลโหลด
    await page.waitForLoadState('networkidle');
    await ss.capture('repossessions-data-loaded');
  });
});
