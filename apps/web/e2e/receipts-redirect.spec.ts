import { test, expect } from '@playwright/test';
import { loginViaAPI } from './helpers/auth';

test.describe('Receipts redirect', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page);
  });

  test('/receipts redirects to /payments?tab=receipts', async ({ page }) => {
    await page.goto('/receipts');
    await page.waitForURL(/\/payments\?tab=receipts/, { timeout: 10000 });
    // Verify tab content loads
    await expect(page.getByText(/ใบเสร็จ|Receipt/i).first()).toBeVisible({ timeout: 10000 });
  });
});
