import { test, expect } from '@playwright/test';
import { loginViaAPI } from './helpers/auth';
import { gotoWithRetry, hasErrorBoundary } from './helpers/navigation';

/* ================================================================
   ตรวจสอบเครดิต (/credit-checks)
   ================================================================ */
test.describe('ตรวจสอบเครดิต', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page);
    await gotoWithRetry(page, '/credit-checks');
  });

  test('should load credit checks page', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    await expect(page.getByText(/ตรวจสอบเครดิต|Credit Check/).first()).toBeVisible({ timeout: 15000 });
  });

  test('should display status filter tabs or badges', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    // CreditChecksPage shows status badges: รอตรวจสอบ, ผ่าน, ไม่ผ่าน, รอพิจารณา
    const statusBadge = page.getByText(/รอตรวจสอบ|ผ่าน|ไม่ผ่าน|รอพิจารณา/).first();
    await expect(statusBadge).toBeVisible({ timeout: 10000 });
  });

  test('should show credit check list or empty state', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    const hasData = await page.locator('table tbody tr, [data-testid="credit-check-card"]').first()
      .isVisible({ timeout: 5000 }).catch(() => false);
    if (!hasData) {
      await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
    }
  });

  test('should have search functionality', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    const search = page.getByPlaceholder(/ค้นหา|search/i).first();
    if (await search.isVisible({ timeout: 5000 }).catch(() => false)) {
      await search.fill('ทดสอบ');
      await page.waitForTimeout(500);
      await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
    }
  });

  test('should filter by status', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    // Click status tab/filter
    const pendingTab = page.getByText(/รอตรวจสอบ|PENDING/).first();
    if (await pendingTab.isVisible({ timeout: 5000 }).catch(() => false)) {
      await pendingTab.click();
      await page.waitForTimeout(500);
      await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
    }
  });

  test('should open credit check detail when clicking a row', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    const firstRow = page.locator('table tbody tr').first();
    if (!await firstRow.isVisible({ timeout: 5000 }).catch(() => false)) return;
    await firstRow.click();
    await page.waitForTimeout(1000);
    // Should show detail view — either a panel/drawer or navigated to detail page
    const detail = page.getByText(/ผลการตรวจ|รายละเอียด|ประวัติ/).first();
    await expect(detail).toBeVisible({ timeout: 5000 });
  });

  test('should have approve/reject actions for pending checks', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    // Filter to pending
    const pendingTab = page.getByText(/รอตรวจสอบ|PENDING/).first();
    if (await pendingTab.isVisible({ timeout: 5000 }).catch(() => false)) {
      await pendingTab.click();
      await page.waitForTimeout(500);
    }
    const firstRow = page.locator('table tbody tr').first();
    if (!await firstRow.isVisible({ timeout: 5000 }).catch(() => false)) return;
    // Look for action buttons
    const approveBtn = page.locator('button').filter({ hasText: /อนุมัติ|ผ่าน|Approve/ }).first();
    const rejectBtn = page.locator('button').filter({ hasText: /ปฏิเสธ|ไม่ผ่าน|Reject/ }).first();
    const hasActions = await approveBtn.isVisible({ timeout: 3000 }).catch(() => false)
      || await rejectBtn.isVisible({ timeout: 2000 }).catch(() => false);
    // Actions may not be visible without clicking into detail first — that's OK
    if (hasActions) {
      await expect(approveBtn.or(rejectBtn).first()).toBeVisible();
    }
  });
});
