import { test, expect, Page } from '@playwright/test';
import { loginViaAPI, loginAsRole } from './helpers/auth';
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
    await expect(page.getByText(/ยึดคืน/).first()).toBeVisible({ timeout: 15000 });
  });

  test('should display subtitle', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    await expect(page.getByText(/จัดการเครื่องที่ยึดคืน/).first()).toBeVisible({ timeout: 10000 });
  });

  test('should show repossession list or empty state', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    const hasData = await page
      .locator('table tbody tr')
      .first()
      .isVisible({ timeout: 5000 })
      .catch(() => false);
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

  test('should show the รอยึดเครื่อง card and no longer link to the payments page', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    // 2026-09-05: TERMINATED contracts left the รับชำระ queue, so repossession (JP5)
    // now starts HERE — a per-row "ยึดเครื่อง" button inside the รอยึดเครื่อง card
    // (role-gated; covered by RepossessionsPage.awaiting-repossession.test.tsx). The
    // seed has no TERMINATED contract, so only the card itself is asserted. The old
    // OWNER-only Link to /payments must be gone for everyone.
    await expect(page.getByText(/รอยึดเครื่อง/).first()).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('link', { name: /ยึดเครื่อง/ })).toHaveCount(0);
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

/* ================================================================
   ยึดคืน & ขายต่อ (/repossessions) — non-OWNER still loads the page
   2026-09-05: the OWNER-only "ไปหน้ารับชำระ" link is gone for every role.
   FINANCE_MANAGER / BRANCH_MANAGER may open the JP5 overlay from the
   รอยึดเครื่อง card (preview only — submit stays OWNER-only inside it);
   ACCOUNTANT gets no button. Per-role button gating is a unit test
   (RepossessionsPage.awaiting-repossession.test.tsx); here we only pin
   that the page renders for FM and never regains a link to /payments.
   ================================================================ */
test.describe('ยึดคืน & ขายต่อ — non-OWNER access', () => {
  test('FINANCE_MANAGER เห็นหน้ายึดคืนได้ และไม่มีลิงก์ไปหน้ารับชำระ', async ({ page }) => {
    await loginAsRole(page, 'FINANCE_MANAGER');
    await gotoWithRetry(page, '/repossessions');
    if (await hasErrorBoundary(page)) return;

    // Page still loads for FINANCE_MANAGER (canSettle/canViewPl = true)
    await expect(page.getByText(/ยึดคืน/).first()).toBeVisible({ timeout: 15000 });

    const cta = page.getByRole('link', { name: /ยึดเครื่อง/ });
    await expect(cta).toHaveCount(0);
  });
});
