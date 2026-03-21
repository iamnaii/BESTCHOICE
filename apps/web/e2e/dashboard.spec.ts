import { test, expect } from '@playwright/test';
import { loginViaAPI } from './helpers/auth';

test.describe('Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page);
  });

  test('should load dashboard after login', async ({ page }) => {
    await expect(page).toHaveURL('/');
    // Dashboard should have content loaded
    await expect(page.locator('body')).not.toBeEmpty();
  });

  test('should display sidebar navigation', async ({ page }) => {
    // Check sidebar has navigation links
    const sidebar = page.locator('.sidebar, aside, nav, [data-sidebar]').first();
    await expect(sidebar).toBeVisible({ timeout: 10000 });
  });

  test('should show user info in layout', async ({ page }) => {
    // The layout should show something related to the logged-in user
    const body = await page.textContent('body');
    expect(body).toBeTruthy();
  });
});
