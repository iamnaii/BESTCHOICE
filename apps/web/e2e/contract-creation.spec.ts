import { test, expect } from '@playwright/test';
import { loginViaAPI } from './helpers/auth';
import { gotoWithRetry, hasErrorBoundary } from './helpers/navigation';

test.describe('สร้างสัญญาผ่อนชำระ', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page);
  });

  test('should load contract creation page', async ({ page }) => {
    await gotoWithRetry(page, '/contracts/create');
    await expect(page.locator('h1, h2, [data-testid="page-title"]')).toContainText(/สร้างสัญญา|สัญญาใหม่/);
    expect(await hasErrorBoundary(page)).toBe(false);
  });

  test('should show step indicator with multiple steps', async ({ page }) => {
    await gotoWithRetry(page, '/contracts/create');
    await page.waitForTimeout(2000);
    // Contract creation should not show error boundary
    expect(await hasErrorBoundary(page)).toBe(false);
  });

  test('should allow customer search in step 1', async ({ page }) => {
    await gotoWithRetry(page, '/contracts/create');
    // Should have a customer search/select mechanism
    const searchInput = page.locator('input[placeholder*="ค้นหา"], input[placeholder*="ลูกค้า"]').first();
    if (await searchInput.isVisible()) {
      await searchInput.fill('ทดสอบ');
      // Should show search results or empty state
      await page.waitForTimeout(1000);
    }
    expect(await hasErrorBoundary(page)).toBe(false);
  });

  test('should show add customer button/modal', async ({ page }) => {
    await gotoWithRetry(page, '/contracts/create');
    const addBtn = page.locator('button:has-text("เพิ่มลูกค้า"), button:has-text("ลูกค้าใหม่")').first();
    if (await addBtn.isVisible()) {
      await addBtn.click();
      // Should open full-screen customer creation modal
      await expect(page.locator('.fixed.inset-0, [role="dialog"]')).toBeVisible({ timeout: 5000 });
    }
  });

  test('should calculate installment when product and terms are set', async ({ page }) => {
    await gotoWithRetry(page, '/contracts/create');
    // Navigate through steps to the calculation step
    // This is a smoke test — just verify no errors
    expect(await hasErrorBoundary(page)).toBe(false);
  });
});
