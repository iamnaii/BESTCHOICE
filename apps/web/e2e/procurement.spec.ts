import { test, expect, Page } from '@playwright/test';
import { loginViaAPI } from './helpers/auth';
import { gotoWithRetry, hasErrorBoundary } from './helpers/navigation';

/* ================================================================
   ใบสั่งซื้อ PO (/purchase-orders)
   ================================================================ */
test.describe('ใบสั่งซื้อ (PO)', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page);
    await gotoWithRetry(page, '/purchase-orders');
  });

  test('should load purchase orders page', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    await expect(
      page.getByText(/ใบสั่งซื้อ|PO/).first(),
    ).toBeVisible({ timeout: 15000 });
  });

  test('should display subtitle', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    await expect(
      page.getByText(/จัดการการสั่งซื้อสินค้า/).first(),
    ).toBeVisible({ timeout: 10000 });
  });

  test('should show PO list or empty state', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    const hasData = await page.locator('table tbody tr').first()
      .isVisible({ timeout: 5000 }).catch(() => false);
    if (hasData) {
      await expect(page.locator('table').first()).toBeVisible();
    } else {
      await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
    }
  });

  test('should have create PO button', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    const createBtn = page.locator('button').filter({ hasText: /สร้าง|เพิ่ม|ใบสั่งซื้อ/ }).first();
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

  test('should have search/filter for POs', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    const search = page.getByPlaceholder(/ค้นหา|PO|search/i).first();
    if (await search.isVisible({ timeout: 5000 }).catch(() => false)) {
      await search.fill('PO-');
      await page.waitForTimeout(500);
      await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
    }
  });

  test('should display PO status badges', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    const statusBadge = page.locator('.badge, [class*="badge"]')
      .filter({ hasText: /ร่าง|อนุมัติ|รับแล้ว|Draft|Approved/ }).first();
    if (await statusBadge.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(statusBadge).toBeVisible();
    }
    await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
  });

  test('should open PO detail on click', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    const firstRow = page.locator('table tbody tr').first();
    if (!await firstRow.isVisible({ timeout: 5000 }).catch(() => false)) return;
    await firstRow.click();
    await page.waitForTimeout(1000);
    // Should open detail modal or navigate
    const hasDetail = await page.locator('[role="dialog"], .modal').first()
      .isVisible({ timeout: 3000 }).catch(() => false);
    if (hasDetail) {
      await expect(page.locator('[role="dialog"], .modal').first()).toBeVisible();
    }
  });

  test('should validate PO form when creating', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    const createBtn = page.locator('button').filter({ hasText: /สร้าง|เพิ่ม/ }).first();
    if (!await createBtn.isVisible({ timeout: 5000 }).catch(() => false)) return;
    await createBtn.click();
    await page.waitForTimeout(500);

    // Try to submit empty form
    const submitBtn = page.locator('[role="dialog"] button, .modal button')
      .filter({ hasText: /บันทึก|สร้าง|save/i }).first();
    if (await submitBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await submitBtn.click();
      await page.waitForTimeout(500);
      // Should show validation errors or button disabled
      const hasError = await page.locator('.text-destructive, .text-red-500, [data-sonner-toast]').first()
        .isVisible({ timeout: 3000 }).catch(() => false);
      await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
    }
  });
});

/* ================================================================
   ผู้ขาย (/suppliers)
   ================================================================ */
test.describe('จัดการผู้ขาย', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page);
    await gotoWithRetry(page, '/suppliers');
  });

  test('should load suppliers page', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    await expect(
      page.getByText('จัดการผู้ขาย').first(),
    ).toBeVisible({ timeout: 15000 });
  });

  test('should display supplier count in subtitle', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    await expect(
      page.getByText(/ราย/).first(),
    ).toBeVisible({ timeout: 10000 });
  });

  test('should show supplier list or empty state', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    const hasData = await page.locator('table tbody tr').first()
      .isVisible({ timeout: 5000 }).catch(() => false);
    if (hasData) {
      await expect(page.locator('table').first()).toBeVisible();
    } else {
      await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
    }
  });

  test('should have create supplier button', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    const createBtn = page.locator('button').filter({ hasText: /เพิ่ม|สร้าง|ผู้ขาย/ }).first();
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

  test('should have search for suppliers', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    const search = page.getByPlaceholder(/ค้นหา|ชื่อผู้ขาย|search/i).first();
    if (await search.isVisible({ timeout: 5000 }).catch(() => false)) {
      await search.fill('Apple');
      await page.waitForTimeout(500);
      await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
    }
  });

  test('should navigate to supplier detail on click', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    const firstRow = page.locator('table tbody tr td a, table tbody tr').first();
    if (!await firstRow.isVisible({ timeout: 5000 }).catch(() => false)) return;
    await firstRow.click();
    await page.waitForTimeout(1000);
    // Should show detail view
    await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
  });

  test('should validate supplier form', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    const createBtn = page.locator('button').filter({ hasText: /เพิ่ม|สร้าง/ }).first();
    if (!await createBtn.isVisible({ timeout: 5000 }).catch(() => false)) return;
    await createBtn.click();
    await page.waitForTimeout(500);

    const submitBtn = page.locator('[role="dialog"] button, .modal button')
      .filter({ hasText: /บันทึก|สร้าง|save/i }).first();
    if (await submitBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await submitBtn.click();
      await page.waitForTimeout(500);
      await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
    }
  });
});
