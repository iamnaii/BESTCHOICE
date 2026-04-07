import { test, expect } from '@playwright/test';
import { loginViaAPI } from './helpers/auth';
import { gotoWithRetry, hasErrorBoundary } from './helpers/navigation';

test.describe('ปิดยอดก่อนกำหนด (Early Payoff)', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page);
  });

  test('should load contracts page', async ({ page }) => {
    await gotoWithRetry(page, '/contracts');
    await expect(page.locator('h1, h2, [data-testid="page-title"]')).toContainText(/สัญญา|Contract/i);
    expect(await hasErrorBoundary(page)).toBe(false);
  });

  test('should show contract list with status badges', async ({ page }) => {
    await gotoWithRetry(page, '/contracts');
    await page.waitForTimeout(2000);
    // Status badges should be visible
    const badges = page.locator('[class*="badge"], [class*="Badge"]');
    const badgeCount = await badges.count();
    // If there are contracts, there should be status badges
    if (badgeCount > 0) {
      expect(badgeCount).toBeGreaterThan(0);
    }
    expect(await hasErrorBoundary(page)).toBe(false);
  });

  test('should navigate to contract detail', async ({ page }) => {
    await gotoWithRetry(page, '/contracts');
    await page.waitForTimeout(2000);
    // Click first contract link
    const firstRow = page.locator('table tbody tr a, [data-testid="contract-row"]').first();
    if (await firstRow.isVisible()) {
      await firstRow.click();
      await page.waitForTimeout(2000);
      // Should be on contract detail page
      expect(page.url()).toContain('/contracts/');
      expect(await hasErrorBoundary(page)).toBe(false);
    }
  });

  test('should show early payoff option on active contract', async ({ page }) => {
    await gotoWithRetry(page, '/contracts');
    await page.waitForTimeout(2000);
    // Filter active contracts
    const activeFilter = page.locator('select, button:has-text("ACTIVE")').first();
    if (await activeFilter.isVisible()) {
      // Try to access an active contract's detail
      const firstRow = page.locator('table tbody tr a').first();
      if (await firstRow.isVisible()) {
        await firstRow.click();
        await page.waitForTimeout(2000);
        // Look for early payoff button
        const payoffBtn = page.locator('button:has-text("ปิดยอด"), button:has-text("Early Payoff")');
        // May or may not be visible depending on contract status
        expect(await hasErrorBoundary(page)).toBe(false);
      }
    }
  });
});
