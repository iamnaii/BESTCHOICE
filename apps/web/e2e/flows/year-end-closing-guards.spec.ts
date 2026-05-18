/**
 * Year-end closing — page-load + guard smoke checks
 *
 * Verifies the surfaces on /finance/year-end-closing without exercising the
 * destructive close path. Specifically:
 *
 *   1. ACCOUNTANT can load the page; the year selector defaults to last year
 *      and the preview button is enabled.
 *   2. OWNER preview click renders ONE of: net-income summary, already-closed
 *      banner, or open-months banner (depends on monthly close state — all
 *      three states are legitimate in a CI seed).
 *   3. FINANCE_MANAGER (route-allowed but canPost=false) sees the read-only
 *      banner OR no "ปิดบัญชีปี" button.
 *
 * The actual year-end close JE is unit-tested in
 * apps/api/src/modules/accounting/closing.service.spec.ts and the page state
 * machine in apps/web/src/pages/YearEndClosingPage.test.tsx. A real flow spec
 * needs all 12 monthly periods CLOSED — not currently part of the E2E seed,
 * deferred to a future PR that adds period-seeding infrastructure.
 */
import { test, expect } from '@playwright/test';
import { loginAsRole, loginViaAPI } from '../helpers/auth';
import { YearEndClosingPage } from '../pom/YearEndClosingPage';
import { hasErrorBoundary } from '../helpers/navigation';

// Flow specs may need longer per-test budget (multi-step UI + SPA route waits).
test.describe.configure({ timeout: 60_000 });

test.describe('Year-end closing — page-load + guards', () => {
  test('ACCOUNTANT: /finance/year-end-closing loads, preview button visible, year selector defaults to last year', async ({
    page,
  }) => {
    await loginAsRole(page, 'ACCOUNTANT');
    const y = new YearEndClosingPage(page);
    const ok = await y.goto();
    if (!ok) {
      throw new Error('/finance/year-end-closing failed to load — likely error boundary or auth issue');
    }
    if (await hasErrorBoundary(page)) {
      throw new Error('Error boundary on /finance/year-end-closing — page rendered an unhandled exception');
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

  test('OWNER: clicking preview renders Net Income summary OR open-months banner OR already-closed banner', async ({
    page,
  }) => {
    await loginViaAPI(page);
    const y = new YearEndClosingPage(page);
    const ok = await y.goto();
    if (!ok) {
      throw new Error('/finance/year-end-closing failed to load — likely error boundary or auth issue');
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

  test('FINANCE_MANAGER: page loads but readonly banner shown OR close button hidden (canPost=false)', async ({
    page,
  }) => {
    // FINANCE_MANAGER has page access (route allowed) but cannot post —
    // exercises the read-only banner / hidden-close-button branch.
    // SALES would hit the route guard and never see the page, so this role
    // is the right one for asserting the read-only UI path.
    await loginAsRole(page, 'FINANCE_MANAGER');
    const y = new YearEndClosingPage(page);
    const ok = await y.goto();
    if (!ok) {
      throw new Error('/finance/year-end-closing failed to load for FINANCE_MANAGER');
    }

    await expect(y.heading()).toBeVisible({ timeout: 15000 });

    // Trigger preview so the action card / readonly banner is rendered
    await y.clickPreview().catch(() => null);

    const readonlyBanner = page.getByText(/โหมดดูอย่างเดียว/).first();
    const hasReadonly = await readonlyBanner
      .isVisible({ timeout: 5000 })
      .catch(() => false);
    const hasCloseBtn = await y.closeYearBtn()
      .isVisible({ timeout: 2000 })
      .catch(() => false);

    // FINANCE_MANAGER must EITHER see the readonly banner OR not see the close button
    expect(hasReadonly || !hasCloseBtn).toBeTruthy();

    await y.assertNoAppError();
  });
});
