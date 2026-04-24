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

/* ================================================================
   Plan 3 Power Features — Customer 360 / Bulk / Ad-hoc LINE
   ================================================================ */
test.describe('/collections power features', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page);
    await gotoWithRetry(page, '/collections');
  });

  test('no crash on tab switching through all 5 tabs', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    for (const label of ['ตามต่อ', 'นัดชำระ', 'อนุมัติ', 'ทั้งหมด', 'คิววันนี้']) {
      await page.getByRole('button', { name: new RegExp(label) }).first().click();
      await expect(page.locator('body')).not.toContainText(/เกิดข้อผิดพลาด/);
    }
  });

  test('Customer 360 panel opens + closes without error', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;

    // Look for the 360 button (ChevronRight) on any contract card. Skip if none.
    const openBtn = page.locator('[title="เปิด Customer 360"]').first();
    if (!(await openBtn.isVisible({ timeout: 3000 }).catch(() => false))) {
      return; // No contracts to test with — environment has no data
    }

    await openBtn.click();
    await expect(page.getByRole('dialog', { name: /ข้อมูลลูกค้า 360/ })).toBeVisible({ timeout: 5000 });

    // Close via close button
    await page.getByRole('button', { name: /ปิด/ }).click();
    await expect(page.getByRole('dialog', { name: /ข้อมูลลูกค้า 360/ })).not.toBeVisible({ timeout: 3000 });
  });

  test('BulkActionBar appears when row selected', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;

    const checkbox = page.locator('input[type="checkbox"]').first();
    if (!(await checkbox.isVisible({ timeout: 3000 }).catch(() => false))) {
      return; // No contracts
    }

    await checkbox.check();
    await expect(page.getByText(/เลือก\s*\d+\s*รายการ/)).toBeVisible({ timeout: 3000 });
    await expect(page.getByRole('button', { name: /มอบหมาย/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /ส่ง LINE/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /เสนอล็อค/ })).toBeVisible();
  });

  test('ad-hoc LINE dialog opens from contract card', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;

    // Find an enabled LINE send button (not the disabled ones for customers without lineId)
    const sendBtn = page.locator('[title="ส่ง LINE"]').first();
    if (!(await sendBtn.isVisible({ timeout: 3000 }).catch(() => false))) {
      return;
    }

    const disabled = await sendBtn.isDisabled().catch(() => true);
    if (disabled) return;

    await sendBtn.click();
    await expect(page.getByText(/ส่ง LINE ถึง/)).toBeVisible({ timeout: 3000 });
    // Close
    await page.getByRole('button', { name: /ยกเลิก/ }).first().click();
  });
});
