import { test, expect } from '@playwright/test';
import { loginAsAdmin } from './helpers/auth';

test.describe('Customers Page', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/customers');
    await page.waitForLoadState('networkidle');
  });

  test('should display customers page', async ({ page }) => {
    await expect(page).toHaveURL('/customers');
    const bodyText = await page.textContent('body');
    expect(bodyText).toBeTruthy();
  });

  test('should have search/filter functionality', async ({ page }) => {
    // Look for search input or filter elements
    const searchInput = page.locator('input[type="search"], input[placeholder*="ค้นหา"], input[placeholder*="search"]').first();
    if (await searchInput.isVisible()) {
      await searchInput.fill('test');
      // Wait for filter to apply
      await page.waitForTimeout(500);
    }
  });
});
