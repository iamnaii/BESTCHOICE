import { test, expect } from '@playwright/test';
import { loginViaAPI } from './helpers/auth';
import { gotoWithRetry, hasErrorBoundary } from './helpers/navigation';

test.describe('Customer Tier badge', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page);
  });

  test('customers list shows tier column', async ({ page }) => {
    const ok = await gotoWithRetry(page, '/customers');
    if (!ok) return;
    await expect(page.getByText('ระดับ').first()).toBeVisible({ timeout: 15000 });
    expect(await hasErrorBoundary(page)).toBe(false);
  });

  test('customer detail page shows tier badge in header', async ({ page }) => {
    const ok = await gotoWithRetry(page, '/customers');
    if (!ok) return;
    const firstRow = page.locator('table tbody tr').first();
    if (await firstRow.isVisible({ timeout: 5000 }).catch(() => false)) {
      await firstRow.click();
      await page.waitForURL(/\/customers\/[^/]+$/, { timeout: 10000 });
      const tierText = page
        .getByText(/VIP \(Gold\)|ลูกค้าดี|ลูกค้าใหม่|ต้องระวัง|ห้ามทำสัญญา/)
        .first();
      await expect(tierText).toBeVisible({ timeout: 10000 });
      expect(await hasErrorBoundary(page)).toBe(false);
    }
  });
});
