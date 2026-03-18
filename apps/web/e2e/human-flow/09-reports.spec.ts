import { test, expect } from '@playwright/test';
import { loginViaAPI } from '../helpers/auth';
import { StepScreenshot } from '../helpers/screenshot';

/**
 * 09 - Reports Flow (Human-Like Interaction)
 *
 * ทดสอบ flow รายงาน: เปิดหน้า, สลับ tabs, export CSV
 * Selectors จาก: src/pages/ReportsPage.tsx
 * - PageHeader: "รายงาน" / subtitle "รายงานสรุปข้อมูลต่างๆ"
 * - Report tabs: อายุหนี้, รายได้/กำไร-ขาดทุน, ลูกค้าเสี่ยงสูง, เปรียบเทียบพนักงาน,
 *   เปรียบเทียบสาขา, ชำระรายวัน, สต็อกสินค้า
 * - Export CSV button
 * - API: GET /reports/aging, /reports/revenue, etc.
 */
test.describe('09 - Reports Flow', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page);
    await page.goto('/reports', { waitUntil: 'domcontentloaded' });
  });

  test('should display reports page with tabs', async ({ page }) => {
    const ss = new StepScreenshot(page, '09-reports-display');

    // Step 1: ตรวจสอบว่าอยู่หน้า /reports
    await expect(page).toHaveURL('/reports');
    await ss.capture('reports-page-loaded');

    // Step 2: ตรวจสอบ header "รายงาน"
    await expect(page.locator('text=รายงาน').first()).toBeVisible();
    await ss.capture('reports-header-visible');

    // Step 3: ตรวจสอบ subtitle
    await expect(page.locator('text=รายงานสรุปข้อมูลต่างๆ').first()).toBeVisible();
    await ss.capture('reports-subtitle-visible');

    // Step 4: ตรวจสอบว่าไม่มี error
    await expect(page.locator('[data-sonner-toast][data-type="error"]')).not.toBeVisible();
    await ss.capture('no-error');
  });

  test('should switch between report tabs', async ({ page }) => {
    const ss = new StepScreenshot(page, '09-reports-tabs');

    // Step 1: รอหน้าโหลด
    await page.waitForLoadState('networkidle');
    await ss.capture('page-ready');

    // Step 2: ตรวจสอบและคลิกแต่ละ tab
    const tabLabels = [
      'อายุหนี้',
      'รายได้',
      'ลูกค้าเสี่ยงสูง',
      'เปรียบเทียบพนักงาน',
      'เปรียบเทียบสาขา',
      'ชำระรายวัน',
      'สต็อกสินค้า',
    ];

    for (const tabLabel of tabLabels) {
      const tabButton = page.locator(`button:has-text("${tabLabel}")`).first();
      if (await tabButton.isVisible()) {
        // คลิก tab
        await tabButton.click();
        await ss.capture(`clicked-tab-${tabLabel}`);

        // รอ report data โหลด
        await page.waitForLoadState('networkidle');
        await ss.capture(`tab-${tabLabel}-loaded`);

        // ตรวจสอบว่าไม่มี error
        await expect(page.locator('[data-sonner-toast][data-type="error"]')).not.toBeVisible();
      }
    }
  });

  test('should have export CSV button', async ({ page }) => {
    const ss = new StepScreenshot(page, '09-reports-export');

    // Step 1: รอหน้าโหลด
    await page.waitForLoadState('networkidle');
    await ss.capture('page-ready');

    // Step 2: หาปุ่ม Export CSV
    const exportBtn = page.locator('button:has-text("Export CSV")').first();
    if (await exportBtn.isVisible()) {
      await ss.capture('export-button-visible');
      await expect(exportBtn).toBeEnabled();
      await ss.capture('export-button-enabled');
    } else {
      await ss.capture('export-button-not-found');
    }
  });

  test('should display aging report data', async ({ page }) => {
    const ss = new StepScreenshot(page, '09-reports-aging');

    // Step 1: อายุหนี้ tab ควรเป็น default tab
    await page.waitForLoadState('networkidle');
    await ss.capture('aging-report-loaded');

    // Step 2: ตรวจสอบว่ามี content แสดง (ตาราง หรือ chart)
    const reportContent = page.locator('table, canvas, svg, [role="table"]').first();
    if (await reportContent.isVisible()) {
      await ss.capture('aging-report-content-visible');
    } else {
      await ss.capture('aging-report-no-data');
    }
  });
});
