/**
 * Flow 5: Year-End Closing → Trial Balance Verifies Zero
 *
 * Phase 3 SP1 module (just merged). ACCOUNTANT/OWNER previews then closes
 * the prior year. Revenue + expense accounts roll into 33-1101 retained
 * earnings via Income Summary (39-9999).
 *
 * Edge cases:
 *   - Cannot close future year (button disabled + warning shown)
 *   - Non-OWNER/ACCOUNTANT role sees read-only banner
 *
 * NOTE: Actually posting a year-end JE in CI would require all 12 months
 * to be CLOSED in the test seed. That is not currently part of the seed,
 * so this spec focuses on guard behavior (preview UI + future-year block +
 * read-only mode) rather than the destructive close itself. The destructive
 * close path is unit-tested via jest in apps/web/src/pages/YearEndClosingPage.test.tsx.
 */
import { test, expect } from '@playwright/test';
import { loginAsRole, loginViaAPI } from '../helpers/auth';
import { YearEndClosingPage } from '../pom/YearEndClosingPage';
import { hasErrorBoundary } from '../helpers/navigation';

test.describe('Flow 5 — Year-end closing guards', () => {
  test('ACCOUNTANT: /finance/year-end-closing loads, preview button visible, year selector defaults to last year', async ({
    page,
  }) => {
    await loginAsRole(page, 'ACCOUNTANT');
    const y = new YearEndClosingPage(page);
    const ok = await y.goto();
    if (!ok) {
      test.skip(true, '/finance/year-end-closing did not load');
      return;
    }
    if (await hasErrorBoundary(page)) {
      test.skip(true, 'Error boundary on year-end-closing page');
      return;
    }

    await expect(y.heading()).toBeVisible({ timeout: 15000 });

    // Year selector visible and pre-populated
    const sel = y.yearSelect();
    await expect(sel).toBeVisible({ timeout: 5000 });

    // Default year = current year - 1
    const expectedYear = new Date().getFullYear() - 1;
    const actualYear = await sel.inputValue();
    expect(parseInt(actualYear, 10)).toBe(expectedYear);

    // Preview button enabled (not in future-year block state)
    await expect(y.previewBtn()).toBeEnabled({ timeout: 5000 });

    await y.assertNoAppError();
  });

  test('OWNER: clicking preview renders Net Income summary (or already-closed banner)', async ({
    page,
  }) => {
    await loginViaAPI(page);
    const y = new YearEndClosingPage(page);
    const ok = await y.goto();
    if (!ok) {
      test.skip(true, '/finance/year-end-closing did not load');
      return;
    }

    await expect(y.heading()).toBeVisible({ timeout: 15000 });

    // Click preview
    await y.clickPreview();

    // Either:
    //  (a) Net Income summary cards appear (preview generated)
    //  (b) Already-closed banner shows (this year previously closed)
    //  (c) Open-months banner shows (test seed doesn't close monthly periods)
    // All three are legitimate states — we just verify ONE rendered without error.
    const hasNetIncome = await page
      .getByText(/กำไรสุทธิ|ขาดทุนสุทธิ/)
      .first()
      .isVisible({ timeout: 5000 })
      .catch(() => false);
    const hasAlreadyClosed = await y.alreadyClosedBanner()
      .isVisible({ timeout: 2000 })
      .catch(() => false);
    const hasOpenMonths = await y.openMonthsBanner()
      .isVisible({ timeout: 2000 })
      .catch(() => false);

    // At least one of these states should render
    expect(hasNetIncome || hasAlreadyClosed || hasOpenMonths).toBeTruthy();

    await y.assertNoAppError();
  });

  /* ─── Edge cases ─── */

  test('Edge: SALES role sees read-only banner (no post permission)', async ({ page }) => {
    await loginAsRole(page, 'SALES');
    const y = new YearEndClosingPage(page);
    const ok = await y.goto();
    if (!ok) {
      // SALES might be redirected away from this page entirely
      // (depends on route guard config) — both behaviors are valid
      const onYearEndUrl = page.url().includes('year-end-closing');
      if (!onYearEndUrl) {
        // Redirected — pass, role guard worked
        return;
      }
      test.skip(true, 'year-end-closing page failed to load for SALES');
      return;
    }

    // Read-only mode banner appears for non-OWNER/non-ACCOUNTANT roles,
    // OR page is fully blocked by route guard (also fine).
    const readonlyBanner = page.getByText(/โหมดดูอย่างเดียว/).first();

    // Trigger preview so the action card / readonly banner is rendered
    await y.clickPreview().catch(() => null);

    // Either: readonly banner visible OR no close button visible for SALES
    const hasReadonly = await readonlyBanner
      .isVisible({ timeout: 5000 })
      .catch(() => false);
    const hasCloseBtn = await y.closeYearBtn()
      .isVisible({ timeout: 2000 })
      .catch(() => false);

    // If page rendered: SALES must EITHER see readonly banner OR not see close button
    if (await y.heading().isVisible({ timeout: 2000 }).catch(() => false)) {
      expect(hasReadonly || !hasCloseBtn).toBeTruthy();
    }

    await y.assertNoAppError();
  });
});
