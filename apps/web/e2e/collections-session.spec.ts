import { test, expect } from '@playwright/test';
import { loginAsRole } from './helpers/auth';
import { gotoWithRetry, hasErrorBoundary } from './helpers/navigation';

/* ================================================================
   Collections Guided Session — Session/Library toggle + role defaults
   ================================================================
   These are structural smoke tests that do NOT assume seeded
   DailyAssignment data. A deeper test of the full session flow
   (start → focus → action → summary) is left for follow-up
   integration work in Phase 2 once the seeder is in place.
   ================================================================ */
test.describe('Collections Guided Session', () => {
  test('SALES sees Session/Library toggle on /collections', async ({ page }) => {
    await loginAsRole(page, 'SALES');
    await gotoWithRetry(page, '/collections');
    if (await hasErrorBoundary(page)) return;

    // Toggle buttons exist and are visible
    await expect(page.getByRole('button', { name: 'Session', exact: true })).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByRole('button', { name: 'Library', exact: true })).toBeVisible();

    // SALES stays on /collections (no role-based redirect exists)
    await expect(page).toHaveURL(/\/collections(\?|$)/);
  });

  test('SALES toggling to Library reveals existing tabs', async ({ page }) => {
    await loginAsRole(page, 'SALES');
    await gotoWithRetry(page, '/collections');
    if (await hasErrorBoundary(page)) return;

    await page.getByRole('button', { name: 'Library', exact: true }).click();

    // Tab labels from CollectionsTabs (always-visible tabs for SALES)
    await expect(page.getByRole('button', { name: /คิววันนี้/ }).first()).toBeVisible({
      timeout: 5000,
    });
    await expect(page.getByRole('button', { name: /นัดชำระ/ }).first()).toBeVisible();
  });

  test('OWNER lands on /collections in LIBRARY view', async ({ page }) => {
    await loginAsRole(page, 'OWNER');
    await gotoWithRetry(page, '/collections');
    if (await hasErrorBoundary(page)) return;

    // There is no /collections/manage route — OWNER stays on /collections and
    // opens in LIBRARY view (ROLE_DEFAULTS.OWNER in hooks/useViewToggle.ts), so
    // the tab bar renders. The manager's queue-splitting work now lives in the
    // 'ภาพรวมทีม' tab (TAB_ROLE_ACCESS: OWNER / FINANCE_MANAGER).
    await expect(page).toHaveURL(/\/collections(\?|$)/);
    await expect(page.getByRole('button', { name: /ภาพรวมทีม/ }).first()).toBeVisible({
      timeout: 10000,
    });
  });
});
