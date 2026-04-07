import { test, expect } from '@playwright/test';
import { loginAsRole } from './helpers/auth';
import { gotoWithRetry } from './helpers/navigation';

/**
 * P1 E2E Tests: Branch Transfers + Supplier CRUD + PO Receiving
 *
 * Tests role-based access for supply chain operations
 * that complement existing procurement.spec.ts and stock-management.spec.ts.
 */
test.describe('Supply Chain Operations', () => {
  test('BRANCH_MANAGER can view branch transfers', async ({ page }) => {
    await loginAsRole(page, 'BRANCH_MANAGER');
    await gotoWithRetry(page, '/stock/transfers');
    await page.waitForTimeout(2000);
    expect(page.url()).toContain('/stock/transfers');
  });

  test('OWNER can access suppliers page', async ({ page }) => {
    await loginAsRole(page, 'OWNER');
    await gotoWithRetry(page, '/suppliers');
    await page.waitForTimeout(2000);
    const pageContent = await page.textContent('body');
    expect(pageContent).toMatch(/ผู้ขาย|supplier/i);
  });

  test('OWNER can access purchase orders', async ({ page }) => {
    await loginAsRole(page, 'OWNER');
    await gotoWithRetry(page, '/purchase-orders');
    await page.waitForTimeout(2000);
    expect(page.url()).toContain('/purchase-orders');
  });

  test('SALES cannot access purchase orders', async ({ page }) => {
    await loginAsRole(page, 'SALES');
    await gotoWithRetry(page, '/purchase-orders');
    await page.waitForTimeout(3000);
    // Should be redirected or see access denied
    const url = page.url();
    const deniedHeading = await page.locator('h1:has-text("ไม่มีสิทธิ์")').isVisible({ timeout: 2000 }).catch(() => false);
    const denied = !url.includes('/purchase-orders') || deniedHeading;
    expect(denied).toBeTruthy();
  });
});
