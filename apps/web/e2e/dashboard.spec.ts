import { test, expect } from '@playwright/test';
import { loginViaAPI } from './helpers/auth';

test.describe('Dashboard Page', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page);
  });

  test('should display dashboard with heading', async ({ page }) => {
    // loginViaAPI navigates to / already
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible({
      timeout: 15000,
    });
  });

  test('should display summary stat cards', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible({
      timeout: 15000,
    });

    // Dashboard should have summary widgets / stat cards
    const body = page.locator('body');
    await expect(body).not.toContainText('เกิดข้อผิดพลาด');

    // Look for common dashboard stat labels
    const statLabels = ['สัญญา', 'ลูกค้า', 'ชำระ', 'ค้างชำระ', 'รายได้', 'สินค้า'];
    let found = 0;
    for (const label of statLabels) {
      if (await page.getByText(label).first().isVisible({ timeout: 3000 }).catch(() => false)) {
        found++;
      }
    }
    expect(found).toBeGreaterThan(0);
  });

  test('should not display any server errors', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible({
      timeout: 15000,
    });
    await page.waitForTimeout(2000);
    await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
  });
});
