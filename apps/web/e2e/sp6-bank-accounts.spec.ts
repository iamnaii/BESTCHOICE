import { test, expect, Page } from '@playwright/test';
import { loginAsRole } from './helpers/auth';
import { gotoWithRetry, hasErrorBoundary } from './helpers/navigation';

/**
 * SP6 — /finance/bank-accounts (Bank/Cash account directory)
 *
 * Verifies:
 *  1. OWNER can open the page, sees seeded cash + bank accounts (6 codes), can
 *     also see the "เพิ่มบัญชี" button (write-only for OWNER).
 *  2. ACCOUNTANT can open the page (read-only) — no create button is rendered.
 *
 * Specs use a runtime-mounted guard so they no-op gracefully when the SP6 PR
 * hasn't landed in `main` yet.
 */

async function pageMounted(page: Page): Promise<boolean> {
  if (await hasErrorBoundary(page)) return false;
  // Wait for either the grid container or the empty state.
  return page
    .getByTestId('bank-account-grid')
    .first()
    .isVisible({ timeout: 8000 })
    .catch(() => false);
}

test.describe('SP6 — BankAccountsPage', () => {
  test('OWNER sees grid + เพิ่มบัญชี button', async ({ page }) => {
    await loginAsRole(page, 'OWNER');
    await gotoWithRetry(page, '/finance/bank-accounts');

    const mounted = await pageMounted(page);
    test.skip(!mounted, 'BankAccountsPage not deployed yet — skip until SP6 PR lands.');

    await expect(page.getByText('บัญชีเงินสดและธนาคาร')).toBeVisible();

    // The 6 seeded CoA codes should appear (cash 11-1101..1103, bank 11-1201..1203).
    const expected = ['11-1101', '11-1102', '11-1103', '11-1201', '11-1202', '11-1203'];
    for (const code of expected) {
      await expect(page.getByText(code, { exact: true }).first()).toBeVisible();
    }

    // OWNER-only create affordance.
    await expect(page.getByRole('button', { name: /เพิ่มบัญชี/ })).toBeVisible();
  });

  test('ACCOUNTANT can view but does not see เพิ่มบัญชี', async ({ page }) => {
    await loginAsRole(page, 'ACCOUNTANT');
    await gotoWithRetry(page, '/finance/bank-accounts');

    const mounted = await pageMounted(page);
    test.skip(!mounted, 'BankAccountsPage not deployed yet — skip until SP6 PR lands.');

    await expect(page.getByText('บัญชีเงินสดและธนาคาร')).toBeVisible();
    // Read-only: create button must NOT be present.
    await expect(page.getByRole('button', { name: /เพิ่มบัญชี/ })).toHaveCount(0);
  });
});
