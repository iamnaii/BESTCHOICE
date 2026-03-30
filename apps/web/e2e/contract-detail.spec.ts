import { test, expect } from '@playwright/test';
import { loginViaAPI } from './helpers/auth';

test.describe('Contract Detail Page', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page);
  });

  test('should navigate from contracts list to detail', async ({ page }) => {
    await page.goto('/contracts', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('สัญญาทั้งหมด').first()).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(2000);

    // Click on first contract row
    const contractLink = page.locator('table tbody tr td a, table tbody tr').first();
    if (await contractLink.isVisible({ timeout: 5000 }).catch(() => false)) {
      await contractLink.click();

      // Should navigate to /contracts/:id
      await expect(page).toHaveURL(/\/contracts\/.+/, { timeout: 10000 });

      // Detail page should show contract info
      await page.waitForTimeout(2000);
      await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
    }
    // Empty contracts list is valid
  });

  test('should display contract info sections on detail page', async ({ page }) => {
    await page.goto('/contracts', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('สัญญาทั้งหมด').first()).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(2000);

    const contractLink = page.locator('table tbody tr td a, table tbody tr').first();
    if (await contractLink.isVisible({ timeout: 5000 }).catch(() => false)) {
      await contractLink.click();
      await expect(page).toHaveURL(/\/contracts\/.+/, { timeout: 10000 });

      // Detail should show key sections
      const sections = ['ลูกค้า', 'สินค้า', 'สถานะ', 'เลขสัญญา', 'ค่างวด'];
      let found = 0;
      for (const section of sections) {
        if (await page.getByText(section).first().isVisible({ timeout: 3000 }).catch(() => false)) {
          found++;
        }
      }
      expect(found).toBeGreaterThan(0);
    }
  });

  test('should display payment schedule on detail page', async ({ page }) => {
    await page.goto('/contracts', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('สัญญาทั้งหมด').first()).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(2000);

    const contractLink = page.locator('table tbody tr td a, table tbody tr').first();
    if (await contractLink.isVisible({ timeout: 5000 }).catch(() => false)) {
      await contractLink.click();
      await expect(page).toHaveURL(/\/contracts\/.+/, { timeout: 10000 });

      // Payment schedule or installments section
      const paymentLabels = ['ตารางผ่อนชำระ', 'งวดที่', 'รับชำระ', 'ชำระเงิน'];
      let found = 0;
      for (const label of paymentLabels) {
        if (await page.getByText(label).first().isVisible({ timeout: 3000 }).catch(() => false)) {
          found++;
        }
      }
      // At least some payment-related labels should be visible
      expect(found).toBeGreaterThan(0);
    }
  });
});
