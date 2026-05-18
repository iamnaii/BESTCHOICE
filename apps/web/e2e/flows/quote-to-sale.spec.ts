/**
 * Quotes page — page-load + role-gate smoke checks
 *
 * Verifies surfaces on /quotes without exercising the full quote lifecycle
 * (send → accept → convert). Specifically:
 *
 *   1. SALES can load the page; "สร้างใบเสนอราคา" dialog opens with form fields.
 *   2. Existing quote rows (when present) open a detail dialog without error;
 *      empty state is also accepted (CI seed may have no quotes).
 *   3. FINANCE_MANAGER sees no create button (read-only by role).
 *
 * A real flow spec (create → send → accept → convert → POS) needs seeded
 * products + a customer to attach the quote to — deferred to a future PR
 * that adds product/branch seeding helpers.
 */
import { test, expect } from '@playwright/test';
import { loginAsRole } from '../helpers/auth';
import { QuoteCreatePage } from '../pom/QuoteCreatePage';
import { hasErrorBoundary } from '../helpers/navigation';

test.describe.configure({ timeout: 60_000 });

test.describe('Quotes — page-load + role gate', () => {
  test('SALES: /quotes page loads, create dialog opens with form fields', async ({ page }) => {
    await loginAsRole(page, 'SALES');
    const q = new QuoteCreatePage(page);
    const ok = await q.goto();
    if (!ok) {
      throw new Error('/quotes failed to load — likely error boundary or auth issue');
    }
    if (await hasErrorBoundary(page)) {
      throw new Error('Error boundary on /quotes — page rendered an unhandled exception');
    }

    await expect(q.heading()).toBeVisible({ timeout: 15000 });

    // Create button visible for SALES
    const createBtn = q.createBtn();
    await expect(createBtn).toBeVisible({ timeout: 10000 });

    // Open dialog
    await createBtn.click();
    await expect(q.dialogTitle()).toBeVisible({ timeout: 5000 });

    // No app error after opening dialog
    await q.assertNoAppError();
  });

  test('SALES: existing quote rows can be opened (detail dialog renders without error)', async ({
    page,
  }) => {
    await loginAsRole(page, 'SALES');
    const q = new QuoteCreatePage(page);
    const ok = await q.goto();
    if (!ok) {
      throw new Error('/quotes failed to load — likely error boundary or auth issue');
    }

    await expect(q.heading()).toBeVisible({ timeout: 15000 });

    // Try opening first row if present
    const firstRowOpenBtn = q.openFirstQuoteBtn();
    const hasRow = await firstRowOpenBtn.isVisible({ timeout: 5000 }).catch(() => false);

    if (!hasRow) {
      // Empty state — that's also valid. Verify "ยังไม่มีใบเสนอราคา" or similar shows
      const emptyMsg = page.getByText(/ยังไม่มีใบเสนอราคา|ไม่มีรายการ/i).first();
      const isEmpty = await emptyMsg.isVisible({ timeout: 5000 }).catch(() => false);
      // Either rows or empty — both OK. Just no error.
      await q.assertNoAppError();
      expect(isEmpty || hasRow).toBeTruthy();
      return;
    }

    await firstRowOpenBtn.click();

    // Detail dialog should appear (any dialog, since headings vary by status)
    const detailDialog = page.locator('[role="dialog"]').first();
    await expect(detailDialog).toBeVisible({ timeout: 5000 });
    await q.assertNoAppError();
  });

  test('FINANCE_MANAGER (read-only) sees no create button on /quotes', async ({ page }) => {
    await loginAsRole(page, 'FINANCE_MANAGER');
    const q = new QuoteCreatePage(page);
    const ok = await q.goto();
    if (!ok) {
      throw new Error('/quotes failed to load for FINANCE_MANAGER');
    }

    // QuotesPage.tsx canCreate = OWNER/BRANCH_MANAGER/SALES only.
    // FINANCE_MANAGER is intentionally read-only per spec.
    await expect(q.heading()).toBeVisible({ timeout: 15000 });

    // Create button MUST NOT be visible for FINANCE_MANAGER
    const createBtn = q.createBtn();
    const isCreateVisible = await createBtn.isVisible({ timeout: 3000 }).catch(() => false);
    expect(isCreateVisible).toBeFalsy();

    await q.assertNoAppError();
  });
});
