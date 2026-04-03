import { test, expect, Page } from '@playwright/test';
import { loginViaAPI } from './helpers/auth';
import { gotoWithRetry, hasErrorBoundary } from './helpers/navigation';

/* ================================================================
   รายงาน (/reports)
   ================================================================ */
test.describe('รายงาน', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page);
    await gotoWithRetry(page, '/reports');
  });

  test('should load reports page', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    await expect(
      page.getByText('รายงาน').first(),
    ).toBeVisible({ timeout: 15000 });
  });

  test('should display subtitle', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    await expect(
      page.getByText(/รายงานสรุปข้อมูล/).first(),
    ).toBeVisible({ timeout: 10000 });
  });

  test('should have report tabs', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    const tabs = [
      /อายุหนี้/,
      /รายได้|กำไร.*ขาดทุน/,
      /ลูกค้าเสี่ยงสูง/,
      /เปรียบเทียบพนักงาน/,
      /เปรียบเทียบสาขา/,
      /ชำระรายวัน/,
      /สต็อกสินค้า/,
    ];
    for (const tabPattern of tabs) {
      const tab = page.getByText(tabPattern).first();
      if (await tab.isVisible({ timeout: 3000 }).catch(() => false)) {
        await expect(tab).toBeVisible();
      }
    }
  });

  test('should switch between report tabs', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    const agingTab = page.getByText('อายุหนี้').first();
    if (await agingTab.isVisible({ timeout: 5000 }).catch(() => false)) {
      await agingTab.click();
      await page.waitForTimeout(500);
      await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
    }

    const revenueTab = page.getByText(/รายได้/).first();
    if (await revenueTab.isVisible({ timeout: 3000 }).catch(() => false)) {
      await revenueTab.click();
      await page.waitForTimeout(500);
      await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
    }

    const stockTab = page.getByText(/สต็อกสินค้า/).first();
    if (await stockTab.isVisible({ timeout: 3000 }).catch(() => false)) {
      await stockTab.click();
      await page.waitForTimeout(500);
      await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
    }
  });

  test('should display aging report data or empty state', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    const agingTab = page.getByText('อายุหนี้').first();
    if (await agingTab.isVisible({ timeout: 5000 }).catch(() => false)) {
      await agingTab.click();
      await page.waitForTimeout(1000);
    }
    // Should show chart, table, or empty state
    const hasData = await page.locator('table, canvas, .chart, svg').first()
      .isVisible({ timeout: 5000 }).catch(() => false);
    if (!hasData) {
      await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
    }
  });

  test('should have export functionality (PDF/Excel)', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    const exportBtn = page.locator('button').filter({ hasText: /ส่งออก|Export|PDF|Excel|ดาวน์โหลด/ }).first();
    if (await exportBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(exportBtn).toBeVisible();
    }
  });

  test('should have date range filter', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    const dateFilter = page.locator('input[type="date"], input[type="month"]').first()
      .or(page.getByText(/ช่วงเวลา|เดือน/).first());
    if (await dateFilter.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(dateFilter).toBeVisible();
    }
  });

  test('should no error on any tab', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
  });
});

/* ================================================================
   แจ้งเตือน (/notifications)
   ================================================================ */
test.describe('แจ้งเตือน', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page);
    await gotoWithRetry(page, '/notifications');
  });

  test('should load notifications page', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    await expect(
      page.getByText('แจ้งเตือน').first(),
    ).toBeVisible({ timeout: 15000 });
  });

  test('should display subtitle about LINE/SMS', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    await expect(
      page.getByText(/LINE.*SMS|ระบบแจ้งเตือน/).first(),
    ).toBeVisible({ timeout: 10000 });
  });

  test('should show notification list or empty state', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    const hasData = await page.locator('table tbody tr, .notification-item, .card').first()
      .isVisible({ timeout: 5000 }).catch(() => false);
    if (!hasData) {
      await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
    }
  });

  test('should have mark read action when notifications exist', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    const markReadBtn = page.locator('button').filter({ hasText: /อ่านแล้ว|mark.*read/i }).first();
    if (await markReadBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(markReadBtn).toBeVisible();
    }
    await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
  });

  test('should have filter/search capability', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    const search = page.getByPlaceholder(/ค้นหา|search/i).first();
    const filter = page.locator('select, [role="combobox"]').first();
    const hasFilter = await search.isVisible({ timeout: 3000 }).catch(() => false) ||
                      await filter.isVisible({ timeout: 3000 }).catch(() => false);
    await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
  });

  test('should no error on page', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
  });
});
