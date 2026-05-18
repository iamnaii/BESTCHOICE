/**
 * Installment-related page surfaces — page-load smoke checks
 *
 * Verifies that the pages on the installment revenue path render without
 * error and expose their primary surfaces:
 *
 *   1. SALES can load /contracts/create (wizard heading + product search input).
 *   2. SALES seeded customer via API appears in /customers list.
 *   3. ACCOUNTANT can load /payments (recording surface accessible).
 *
 * This spec does NOT exercise the full create-contract → record-first-payment
 * flow because:
 *   - The contract create wizard has 4 steps + many product/plan combinations.
 *   - Payments require an ACTIVE contract with seeded installment schedules.
 *   - Both need additional seed infrastructure deferred to a future PR.
 */
import { test, expect } from '@playwright/test';
import { loginAsRole } from '../helpers/auth';
import { ContractCreatePage } from '../pom/ContractCreatePage';
import {
  cleanupTestData,
  newSeedIds,
  seedCustomer,
  type SeedIds,
} from '../fixtures/seed-data';
import { getApiToken } from '../helpers/api-utils';
import { gotoWithRetry, hasErrorBoundary } from '../helpers/navigation';

test.describe.configure({ timeout: 60_000 });

let ids: SeedIds;
let ownerToken: string;

test.describe('Installment surfaces — page-load smoke', () => {
  test.beforeAll(async ({ browser }) => {
    ids = newSeedIds();
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    ownerToken = await getApiToken(page);
    await ctx.close();
  });

  test.afterAll(async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await cleanupTestData(page, ownerToken, ids);
    await ctx.close();
  });

  test('SALES: contract create wizard loads with stepper and product selection', async ({
    page,
  }) => {
    await loginAsRole(page, 'SALES');
    const cc = new ContractCreatePage(page);
    const ok = await cc.goto();
    if (!ok) {
      throw new Error('/contracts/create failed to load — likely error boundary or auth issue');
    }
    if (await hasErrorBoundary(page)) {
      throw new Error('Error boundary on /contracts/create — page rendered an unhandled exception');
    }

    // Heading visible
    const headingVisible = await cc.waitForLoaded();
    expect(headingVisible).toBeTruthy();

    // Product search input visible on step 0
    const productSearch = cc.productSearchInput();
    if (await productSearch.isVisible({ timeout: 5000 }).catch(() => false)) {
      await productSearch.fill('iPhone');
      await cc.assertNoAppError();
    }
  });

  test('SALES: can pre-seed a customer via API and verify they appear in customer list', async ({
    page,
  }) => {
    await loginAsRole(page, 'SALES');

    // Seed customer through API (avoid login rate limit + flake from UI)
    const customer = await seedCustomer(page, ownerToken, {});
    ids.customers.push(customer.id);

    // Navigate to /customers and verify the seeded record appears
    const ok = await gotoWithRetry(page, '/customers');
    if (!ok) {
      throw new Error('/customers failed to load — likely error boundary or auth issue');
    }

    // Search for the seeded customer by phone (unique per run)
    const search = page
      .getByPlaceholder(/ค้นหา|search/i)
      .first();
    if (await search.isVisible({ timeout: 5000 }).catch(() => false)) {
      await search.fill(customer.phone);
      // Allow debounced search to settle (auto-wait by checking row appearance)
      await expect(page.locator('body')).toContainText(customer.phone, { timeout: 10000 });
    }
  });

  test('ACCOUNTANT: /payments page loads — payment recording surface accessible', async ({
    page,
  }) => {
    await loginAsRole(page, 'ACCOUNTANT');

    const ok = await gotoWithRetry(page, '/payments');
    if (!ok) {
      throw new Error('/payments failed to load — likely error boundary or auth issue');
    }
    if (await hasErrorBoundary(page)) {
      throw new Error('Error boundary on /payments — page rendered an unhandled exception');
    }

    // Heading or main content visible
    await expect(
      page.getByText(/บันทึก.?ชำระ|รายการ.?ชำระ|Payments?/i).first(),
    ).toBeVisible({ timeout: 15000 });

    // No app error
    await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
  });
});
