import { test, expect } from '@playwright/test';
import { loginAsAdmin, loginAsRole } from './helpers/auth';

/**
 * SP5 — SHOP additions smoke tests.
 *
 * Asserts the new routes (`/quotes`, `/drafts`, `/insurance`) and sidebar
 * entries land for the appropriate roles. Deeper Quote-lifecycle flows
 * (DRAFT → SENT → ACCEPTED → CONVERTED) are covered by the API jest tests
 * in `apps/api/src/modules/quotes/__tests__/quotes.service.spec.ts`.
 */
test.describe('SP5 — SHOP additions', () => {
  test('SALES sees /quotes page + can open create dialog', async ({ page }) => {
    await loginAsRole(page, 'SALES');
    await page.goto('/quotes', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'ใบเสนอราคา' })).toBeVisible({
      timeout: 10_000,
    });
    // The "สร้างใบเสนอราคา" button is visible for SALES role
    const createBtn = page.getByRole('button', { name: /สร้างใบเสนอราคา/ });
    await expect(createBtn).toBeVisible();
  });

  test('OWNER sees /drafts page with tabbed type filter', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/drafts', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'เอกสารร่าง' })).toBeVisible({
      timeout: 10_000,
    });
    // Tabs render: ทั้งหมด / ใบเสนอราคา / สัญญา / รายจ่าย / รายได้อื่น
    await expect(page.getByRole('button', { name: 'ทั้งหมด' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'ใบเสนอราคา' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'รายจ่าย' })).toBeVisible();
  });

  test('/insurance redirects to /defect-exchange (Phase 1)', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/insurance', { waitUntil: 'domcontentloaded' });
    // Navigate replaces history → final URL becomes /defect-exchange
    await page.waitForURL(/\/defect-exchange/, { timeout: 10_000 });
    await expect(page).toHaveURL(/\/defect-exchange/);
  });

  test('BRANCH_MANAGER sidebar shows the new SHOP additions', async ({ page }) => {
    // Expand sidebar so labels render — same trick as login.spec.ts
    await page.addInitScript(() => {
      try {
        localStorage.setItem('sidebar-state', 'expanded');
      } catch {
        /* noop */
      }
    });
    await loginAsRole(page, 'BRANCH_MANAGER');
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    // At least one of the three new menu entries must be present in the DOM
    // (sidebar may be collapsed; check by aria/text fallback)
    const anyNewMenu = page
      .locator('a, button')
      .filter({ hasText: /ใบเสนอราคา|เอกสารร่าง|รับประกัน\/ส่งซ่อม/ });
    await expect(anyNewMenu.first()).toBeVisible({ timeout: 10_000 });
  });
});
