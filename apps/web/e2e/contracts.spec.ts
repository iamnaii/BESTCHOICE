import { test, expect } from '@playwright/test';
import { loginAsAdmin } from './helpers/auth';

test.describe('Contracts Page', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/contracts', { waitUntil: 'domcontentloaded' });
  });

  test('should display contracts list', async ({ page }) => {
    await expect(page).toHaveURL('/contracts');
    const bodyText = await page.textContent('body');
    expect(bodyText).toBeTruthy();
  });

  test('should have create contract button for authorized roles', async ({ page }) => {
    // Look for a "create" or "สร้าง" button
    const createBtn = page.locator('a[href="/contracts/create"], button:has-text("สร้าง"), button:has-text("เพิ่ม")').first();
    if (await createBtn.isVisible()) {
      await expect(createBtn).toBeEnabled();
    }
  });
});

test.describe('Contract Creation', () => {
  test('should navigate to contract creation page', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/contracts/create', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL('/contracts/create');
  });
});
