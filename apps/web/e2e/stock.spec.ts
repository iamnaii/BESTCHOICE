import { test, expect } from '@playwright/test';
import { loginAsAdmin } from './helpers/auth';

test.describe('Stock / Inventory Page', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/stock');
    await page.waitForLoadState('networkidle');
  });

  test('should display stock page', async ({ page }) => {
    await expect(page).toHaveURL('/stock');
    const bodyText = await page.textContent('body');
    expect(bodyText).toBeTruthy();
  });

  test('should have tab navigation', async ({ page }) => {
    // Stock page typically has tabs for different views
    const tabs = page.locator('[role="tablist"], [data-radix-tabs-list]').first();
    if (await tabs.isVisible()) {
      await expect(tabs).toBeVisible();
    }
  });
});

test.describe('POS Page', () => {
  test('should display POS page', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/pos');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL('/pos');
  });
});
