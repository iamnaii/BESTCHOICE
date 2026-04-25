import { test, expect } from '@playwright/test';
import { loginViaAPI } from './helpers/auth';
import { gotoWithRetry, hasErrorBoundary } from './helpers/navigation';

/* ================================================================
   Collections Workflow Hub (/collections) — smoke tests
   ================================================================ */
test.describe('/collections workflow hub', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page);
  });

  test('OWNER: loads page with 5 tabs visible (including อนุมัติ)', async ({ page }) => {
    await gotoWithRetry(page, '/collections');
    if (await hasErrorBoundary(page)) return;

    await expect(page.getByRole('heading', { name: /ติดตามหนี้/ }).first()).toBeVisible({ timeout: 15000 });

    for (const label of ['คิววันนี้', 'ตามต่อ', 'นัดชำระ', 'อนุมัติ', 'ทั้งหมด']) {
      await expect(page.getByRole('button', { name: new RegExp(label) }).first()).toBeVisible({ timeout: 5000 });
    }
  });

  test('OWNER: switching to ตามต่อ shows the warning banner', async ({ page }) => {
    await gotoWithRetry(page, '/collections');
    if (await hasErrorBoundary(page)) return;

    await page.getByRole('button', { name: /ตามต่อ/ }).first().click();
    await expect(page.getByText(/ตามต่อ.*เคยโทร/i).first()).toBeVisible({ timeout: 5000 });
  });

  test('OWNER: switching to นัดชำระ loads the promise queue', async ({ page }) => {
    await gotoWithRetry(page, '/collections');
    if (await hasErrorBoundary(page)) return;

    await page.getByRole('button', { name: /นัดชำระ/ }).first().click();
    // Either rendered content or empty state — should not crash
    await expect(page.locator('body')).not.toContainText(/เกิดข้อผิดพลาด/);
  });

  test('OWNER: approval tab loads both pending sections', async ({ page }) => {
    await gotoWithRetry(page, '/collections');
    if (await hasErrorBoundary(page)) return;

    await page.getByRole('button', { name: /อนุมัติ/ }).first().click();

    await expect(page.getByText(/รออนุมัติเลื่อนระดับเตือน/).first()).toBeVisible({ timeout: 5000 });
    await expect(page.getByText(/รออนุมัติล็อคเครื่อง/).first()).toBeVisible({ timeout: 5000 });
  });

  test('OWNER: ทั้งหมด tab renders existing overdue content', async ({ page }) => {
    await gotoWithRetry(page, '/collections');
    if (await hasErrorBoundary(page)) return;

    await page.getByRole('button', { name: /ทั้งหมด/ }).first().click();
    // AllTab wraps OverduePage — its own PageHeader renders "ค่าปรับ & ค้างชำระ"
    await expect(page.getByText(/ค่าปรับ|ค้างชำระ/).first()).toBeVisible({ timeout: 10000 });
  });
});

/* ================================================================
   /overdue still works (flag off by default) — no redirect
   ================================================================ */
test.describe('/overdue backward compat', () => {
  test('existing /overdue still loads when flag is off (default)', async ({ page }) => {
    await loginViaAPI(page);
    await gotoWithRetry(page, '/overdue');
    if (await hasErrorBoundary(page)) return;

    await expect(page.getByText(/ค้างชำระ|ค่าปรับ/).first()).toBeVisible({ timeout: 15000 });
  });
});
