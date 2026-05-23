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

  test('found IMEI shows preview + active buttons', async ({ page, request }) => {
    // Fetch a real IMEI via the contracts API rather than relying on a DOM
    // attribute that doesn't exist (former approach silently skipped). The API
    // is the source of truth for what's in the DB.
    const contractsRes = await request.get('/api/contracts?limit=1');
    if (!contractsRes.ok()) test.skip(true, 'Contracts API not reachable');
    const payload = await contractsRes.json();
    const imei = payload?.data?.[0]?.product?.imeiSerial ?? payload?.[0]?.product?.imeiSerial;
    test.skip(!imei, 'No seed contract with IMEI to test against');

    await page.goto('/insurance/new');
    await page.fill('input[placeholder*="359"]', imei);
    await page.click('button:has-text("ค้นหา")');
    await expect(page.locator('button:has-text("รับเข้าซ่อม")')).toBeEnabled();
  });
});
