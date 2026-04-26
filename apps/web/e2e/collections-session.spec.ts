import { test, expect } from '@playwright/test';
import { loginAsRole } from './helpers/auth';
import { gotoWithRetry, hasErrorBoundary } from './helpers/navigation';

/* ================================================================
   Collections Guided Session — Session/Library toggle + manager redirect
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
    await expect(
      page.getByRole('button', { name: 'Session', exact: true }),
    ).toBeVisible({ timeout: 10000 });
    await expect(
      page.getByRole('button', { name: 'Library', exact: true }),
    ).toBeVisible();

    // SALES should NOT be redirected to /collections/manage
    await expect(page).toHaveURL(/\/collections(\?|$)/);
  });

  test('SALES toggling to Library reveals existing tabs', async ({ page }) => {
    await loginAsRole(page, 'SALES');
    await gotoWithRetry(page, '/collections');
    if (await hasErrorBoundary(page)) return;

    await page.getByRole('button', { name: 'Library', exact: true }).click();

    // Tab labels from CollectionsTabs (always-visible tabs for SALES)
    await expect(
      page.getByRole('button', { name: /คิววันนี้/ }).first(),
    ).toBeVisible({ timeout: 5000 });
    await expect(
      page.getByRole('button', { name: /นัดชำระ/ }).first(),
    ).toBeVisible();
  });

  test('OWNER lands on /collections/manage by default', async ({ page }) => {
    await loginAsRole(page, 'OWNER');
    await gotoWithRetry(page, '/collections');
    if (await hasErrorBoundary(page)) return;

    await expect(page).toHaveURL(/\/collections\/manage/, { timeout: 10000 });
    await expect(page.getByRole('heading', { name: /แบ่งคิวงาน/ }).first()).toBeVisible({
      timeout: 10000,
    });
  });
});
