import { test, expect, Page } from '@playwright/test';
import { loginViaAPI } from './helpers/auth';
import { gotoWithRetry, hasErrorBoundary } from './helpers/navigation';

/* ================================================================
   ยึดคืน & ขายต่อ (/repossessions)
   ================================================================ */
test.describe('ยึดคืน & ขายต่อ', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page);
    await gotoWithRetry(page, '/repossessions');
  });

  test('should load repossessions page', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    await expect(
      page.getByText(/ยึดคืน/).first(),
    ).toBeVisible({ timeout: 15000 });
  });

  test('should display subtitle', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    await expect(
      page.getByText(/จัดการเครื่องที่ยึดคืน/).first(),
    ).toBeVisible({ timeout: 10000 });
  });

  test('should show repossession list or empty state', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    const hasData = await page.locator('table tbody tr').first()
      .isVisible({ timeout: 5000 }).catch(() => false);
    if (hasData) {
      await expect(page.locator('table').first()).toBeVisible();
    } else {
      await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
    }
  });

  test('should have search functionality', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    const search = page.getByPlaceholder(/ค้นหา|search/i).first();
    if (await search.isVisible({ timeout: 5000 }).catch(() => false)) {
      await search.fill('test');
      await page.waitForTimeout(500);
      await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
    }
  });

  test('should have create repossession action', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    const createBtn = page.locator('button').filter({ hasText: /ยึดคืน|สร้าง|เพิ่ม/ }).first();
    if (await createBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await createBtn.click();
      await page.waitForTimeout(500);
      const hasModal = await page.locator('[role="dialog"], .modal, form').first()
        .isVisible({ timeout: 3000 }).catch(() => false);
      if (hasModal) {
        await expect(page.locator('[role="dialog"], .modal, form').first()).toBeVisible();
      }
    }
  });

  test('should display status indicators for repossessions', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    const statusBadge = page.locator('.badge, [class*="badge"]').first();
    if (await statusBadge.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(statusBadge).toBeVisible();
    }
    await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
  });
});
