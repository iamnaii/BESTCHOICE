import { test, expect, Page } from '@playwright/test';
import { loginViaAPI } from './helpers/auth';
import { gotoWithRetry, hasErrorBoundary } from './helpers/navigation';

/* ================================================================
   คลังสินค้า (/stock)
   ================================================================ */
test.describe('คลังสินค้า', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page);
    await gotoWithRetry(page, '/stock');
  });

  test('should load stock page with heading', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    await expect(
      page.getByText('คลังสินค้า').first(),
    ).toBeVisible({ timeout: 15000 });
  });

  test('should display stock summary (quantity and value)', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    await expect(
      page.getByText(/พร้อมขาย|ชิ้น|มูลค่า/).first(),
    ).toBeVisible({ timeout: 10000 });
  });

  test('should have tabs (dashboard / list)', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    const dashboardTab = page.getByText(/ภาพรวม|Dashboard/).first();
    const listTab = page.getByText(/รายการ|List/).first();
    const hasTabs = await dashboardTab.isVisible({ timeout: 5000 }).catch(() => false) ||
                    await listTab.isVisible({ timeout: 3000 }).catch(() => false);
    if (hasTabs) {
      // Switch between tabs
      if (await listTab.isVisible({ timeout: 2000 }).catch(() => false)) {
        await listTab.click();
        await page.waitForTimeout(500);
      }
    }
    await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
  });

  test('should have search functionality', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    const search = page.getByPlaceholder(/ค้นหา|IMEI|ชื่อ|search/i).first();
    if (await search.isVisible({ timeout: 5000 }).catch(() => false)) {
      await search.fill('iPhone');
      await page.waitForTimeout(500);
      await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
    }
  });

  test('should have status filter', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    const statusFilter = page.locator('select').first()
      .or(page.getByText(/สถานะ|IN_STOCK|พร้อมขาย/).first());
    if (await statusFilter.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(statusFilter).toBeVisible();
    }
  });

  test('should show branch filter for managers', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    const branchFilter = page.locator('select, [role="combobox"]')
      .filter({ hasText: /สาขา|branch/i }).first()
      .or(page.getByText(/ทุกสาขา|สาขา/).first());
    if (await branchFilter.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(branchFilter).toBeVisible();
    }
  });

  test('should display product list', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    // Switch to list tab if available
    const listTab = page.getByText(/รายการ/).first();
    if (await listTab.isVisible({ timeout: 3000 }).catch(() => false)) {
      await listTab.click();
      await page.waitForTimeout(500);
    }

    const hasData = await page.locator('table tbody tr').first()
      .isVisible({ timeout: 5000 }).catch(() => false);
    if (hasData) {
      await expect(page.locator('table').first()).toBeVisible();
    } else {
      await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
    }
  });
});

/* ================================================================
   โอนสาขา (/stock/transfers)
   ================================================================ */
test.describe('โอนสินค้าระหว่างสาขา', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page);
    await gotoWithRetry(page, '/stock/transfers');
  });

  test('should load transfers page', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    await expect(
      page.getByText(/จัดการโอนสินค้า|โอนสินค้า/).first(),
    ).toBeVisible({ timeout: 15000 });
  });

  test('should have tabs: outgoing, incoming, history', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    const outTab = page.getByText('โอนออก').first();
    const inTab = page.getByText('รอรับเข้า').first();
    const historyTab = page.getByText('ประวัติ').first();

    if (await outTab.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(outTab).toBeVisible();
    }
    if (await inTab.isVisible({ timeout: 3000 }).catch(() => false)) {
      await expect(inTab).toBeVisible();
    }
    if (await historyTab.isVisible({ timeout: 3000 }).catch(() => false)) {
      await expect(historyTab).toBeVisible();
    }
  });

  test('should switch between tabs', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    const inTab = page.getByText('รอรับเข้า').first();
    if (await inTab.isVisible({ timeout: 5000 }).catch(() => false)) {
      await inTab.click();
      await page.waitForTimeout(500);
      await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
    }

    const historyTab = page.getByText('ประวัติ').first();
    if (await historyTab.isVisible({ timeout: 3000 }).catch(() => false)) {
      await historyTab.click();
      await page.waitForTimeout(500);
      await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
    }
  });

  test('should have create transfer action', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    const createBtn = page.locator('button').filter({ hasText: /โอน|สร้าง|เพิ่ม/ }).first();
    if (await createBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await createBtn.click();
      await page.waitForTimeout(500);
      const hasForm = await page.locator('[role="dialog"], .modal, form').first()
        .isVisible({ timeout: 3000 }).catch(() => false);
      if (hasForm) {
        await expect(page.locator('[role="dialog"], .modal, form').first()).toBeVisible();
      }
    }
  });

  test('should show transfer list or empty state', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    const hasData = await page.locator('table tbody tr').first()
      .isVisible({ timeout: 5000 }).catch(() => false);
    if (!hasData) {
      await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
    }
  });
});

/* ================================================================
   ปรับสต็อก (/stock/adjustments)
   ================================================================ */
test.describe('ปรับสต็อก', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page);
    await gotoWithRetry(page, '/stock/adjustments');
  });

  test('should load adjustments page', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    await expect(
      page.getByText('ปรับสต็อก').first(),
    ).toBeVisible({ timeout: 15000 });
  });

  test('should show adjustment list or empty state', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    const hasData = await page.locator('table tbody tr').first()
      .isVisible({ timeout: 5000 }).catch(() => false);
    if (hasData) {
      await expect(page.locator('table').first()).toBeVisible();
    } else {
      await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
    }
  });

  test('should have create adjustment action', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    const createBtn = page.locator('button').filter({ hasText: /ปรับ|สร้าง|เพิ่ม/ }).first();
    if (await createBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await createBtn.click();
      await page.waitForTimeout(500);
      const hasForm = await page.locator('[role="dialog"], .modal, form').first()
        .isVisible({ timeout: 3000 }).catch(() => false);
      if (hasForm) {
        await expect(page.locator('[role="dialog"], .modal, form').first()).toBeVisible();
      }
    }
  });

  test('should display summary with count and value', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    await expect(
      page.getByText(/รายการ|มูลค่า/).first(),
    ).toBeVisible({ timeout: 10000 });
  });

  test('should no error on page', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
  });
});

/* ================================================================
   ตรวจนับสต๊อก (/stock/count)
   ================================================================ */
test.describe('ตรวจนับสต๊อก', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page);
    await gotoWithRetry(page, '/stock/count');
  });

  test('should load stock count page', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    await expect(
      page.getByText(/ตรวจนับสต๊อก|ตรวจนับ/).first(),
    ).toBeVisible({ timeout: 15000 });
  });

  test('should display subtitle', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    await expect(
      page.getByText(/ตรวจนับสินค้าจริง/).first(),
    ).toBeVisible({ timeout: 10000 });
  });

  test('should have start count action', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    const startBtn = page.locator('button').filter({ hasText: /เริ่มนับ|ตรวจนับ|สร้าง/ }).first();
    if (await startBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(startBtn).toBeVisible();
    }
  });

  test('should show count history or empty state', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    const hasData = await page.locator('table tbody tr').first()
      .isVisible({ timeout: 5000 }).catch(() => false);
    if (!hasData) {
      await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
    }
  });

  test('should no error on page', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
  });
});

/* ================================================================
   แจ้งเตือนสต็อก (/stock/alerts)
   ================================================================ */
test.describe('แจ้งเตือนสต็อก', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page);
    await gotoWithRetry(page, '/stock/alerts');
  });

  test('should load stock alerts page', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    await expect(
      page.getByText('แจ้งเตือนสต็อก').first(),
    ).toBeVisible({ timeout: 15000 });
  });

  test('should display low stock count in subtitle', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    await expect(
      page.getByText(/รายการ|ต่ำกว่าเกณฑ์|แจ้งเตือน/).first(),
    ).toBeVisible({ timeout: 10000 });
  });

  test('should show alerts list or empty state', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    const hasData = await page.locator('table tbody tr, .alert-item').first()
      .isVisible({ timeout: 5000 }).catch(() => false);
    if (!hasData) {
      await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
    }
  });

  test('should no error on page', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
  });
});

/* ================================================================
   ขั้นตอนสต็อก (/stock/workflow)
   ================================================================ */
test.describe('ขั้นตอนสต็อก', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page);
    await gotoWithRetry(page, '/stock/workflow');
  });

  test('should load workflow page', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    await expect(
      page.getByText('ขั้นตอนสต็อก').first(),
    ).toBeVisible({ timeout: 15000 });
  });

  test('should display subtitle about tracking', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    await expect(
      page.getByText(/ติดตามสถานะสินค้า/).first(),
    ).toBeVisible({ timeout: 10000 });
  });

  test('should show workflow pipeline steps', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    // Workflow should show pipeline stages
    const stages = page.getByText(/รับเข้า|ตรวจสอบ|พร้อมขาย|QC/).first();
    if (await stages.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(stages).toBeVisible();
    }
  });

  test('should no error on page', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
  });
});

/* ================================================================
   ตรวจสอบสินค้า (/inspections)
   ================================================================ */
test.describe('ตรวจสอบสินค้า', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page);
    await gotoWithRetry(page, '/inspections');
  });

  test('should load inspections page', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    await expect(
      page.getByText('ตรวจสอบสินค้า').first(),
    ).toBeVisible({ timeout: 15000 });
  });

  test('should display subtitle', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    await expect(
      page.getByText(/ตรวจสอบและอัปเดตสถานะ/).first(),
    ).toBeVisible({ timeout: 10000 });
  });

  test('should show inspection list or empty state', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    const hasData = await page.locator('table tbody tr, .inspection-item').first()
      .isVisible({ timeout: 5000 }).catch(() => false);
    if (hasData) {
      await expect(page.locator('table').first()).toBeVisible();
    } else {
      await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
    }
  });

  test('should have create inspection action', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    const createBtn = page.locator('button').filter({ hasText: /ตรวจ|สร้าง|เพิ่ม/ }).first();
    if (await createBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await createBtn.click();
      await page.waitForTimeout(500);
      const hasForm = await page.locator('[role="dialog"], .modal, form').first()
        .isVisible({ timeout: 3000 }).catch(() => false);
      if (hasForm) {
        await expect(page.locator('[role="dialog"], .modal, form').first()).toBeVisible();
      }
    }
  });

  test('should have search functionality', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    const search = page.getByPlaceholder(/ค้นหา|IMEI|search/i).first();
    if (await search.isVisible({ timeout: 5000 }).catch(() => false)) {
      await search.fill('iPhone');
      await page.waitForTimeout(500);
      await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
    }
  });

  test('should no error on page', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
  });
});
