import { test, expect } from '@playwright/test';

test.describe('Insurance wizard — IMEI-driven flow (SP1)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.fill('[name="email"]', 'manager.ladprao@bestchoice.com');
    await page.fill('[name="password"]', 'admin1234');
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/(dashboard|finance-portfolio)/);
  });

  test('block message when IMEI not in DB', async ({ page }) => {
    await page.goto('/insurance/new');
    await page.fill('input[placeholder*="359"]', 'NOT_A_REAL_IMEI_999');
    await page.click('button:has-text("ค้นหา")');
    await expect(page.locator('text=ไม่พบเครื่องในระบบ')).toBeVisible();
  });

  test('found IMEI shows preview + active buttons', async ({ page }) => {
    // Assumes seed data has at least one device sold via Sale with IMEI present
    // Skip if no seed — get the IMEI from the contracts list
    await page.goto('/contracts');
    const firstImei = await page.locator('[data-imei]').first().getAttribute('data-imei');
    test.skip(!firstImei, 'No seed IMEI to test against');

    await page.goto('/insurance/new');
    await page.fill('input[placeholder*="359"]', firstImei!);
    await page.click('button:has-text("ค้นหา")');
    await expect(page.locator('button:has-text("รับเข้าซ่อม")')).toBeEnabled();
  });
});
