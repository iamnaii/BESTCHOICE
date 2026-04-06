import { test, expect } from '@playwright/test';
import { loginAsRole } from './helpers/auth';
import { gotoWithRetry } from './helpers/navigation';

/**
 * P1 E2E Tests: Stock Count + CSV Import + Slip Review
 *
 * Tests role-based access for inventory and finance operations
 * that are not covered by existing stock-management.spec.ts or payments.spec.ts.
 */
test.describe('Stock & Finance Operations', () => {
  test('BRANCH_MANAGER can access stock count page', async ({ page }) => {
    await loginAsRole(page, 'BRANCH_MANAGER');
    await gotoWithRetry(page, '/stock/count');
    const denied = !page.url().includes('/stock/count');
    expect(denied).toBeFalsy();
  });

  test('ACCOUNTANT can access CSV import page', async ({ page }) => {
    await loginAsRole(page, 'ACCOUNTANT');
    await gotoWithRetry(page, '/payments/import-csv');
    const denied = !page.url().includes('/payments/import-csv');
    expect(denied).toBeFalsy();
  });

  test('ACCOUNTANT can access slip review', async ({ page }) => {
    await loginAsRole(page, 'ACCOUNTANT');
    await gotoWithRetry(page, '/payments?tab=slip-review');
    await page.waitForTimeout(2000);
    // Should be on payments page
    expect(page.url()).toContain('/payments');
  });

  test('stock count page shows count interface', async ({ page }) => {
    await loginAsRole(page, 'OWNER');
    await gotoWithRetry(page, '/stock/count');
    await page.waitForTimeout(3000);
    // Should show stock count UI elements
    const pageContent = await page.textContent('body');
    expect(pageContent).toMatch(/ตรวจนับ|สต็อก|stock|count/i);
  });
});
