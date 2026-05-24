import { test, expect } from '@playwright/test';

test.describe('Exchange request flow (SP2 same-price)', () => {
  test('SALES submits → OWNER approves', async ({ browser }) => {
    const salesCtx = await browser.newContext();
    const ownerCtx = await browser.newContext();
    const salesPage = await salesCtx.newPage();
    const ownerPage = await ownerCtx.newPage();

    try {
      // SALES login + submit
      await salesPage.goto('/login');
      await salesPage.fill('[name="email"]', 'sales1@bestchoice.com');
      await salesPage.fill('[name="password"]', 'admin1234');
      await salesPage.click('button[type="submit"]');
      await salesPage.waitForURL(/\/(dashboard|finance-portfolio|$)/);

      // Navigate to exchange form for seeded INSTALLMENT PHONE_USED contract
      await salesPage.goto('/insurance/exchange-request/new?contractId=sp1-ctr-used');
      await salesPage.waitForSelector('select', { timeout: 5000 });
      const opts = await salesPage.locator('select option').count();
      test.skip(opts < 2, 'no seed replacement available — run seed-sp1-used-exchange.sql first');

      await salesPage.selectOption('select', { index: 1 });
      await salesPage.click('button:has-text("ส่งคำขออนุมัติ")');
      await expect(salesPage.locator('text=ส่งคำขอเปลี่ยนเครื่องสำเร็จ')).toBeVisible({ timeout: 8000 });

      // OWNER approve
      await ownerPage.goto('/login');
      await ownerPage.fill('[name="email"]', 'admin@bestchoice.com');
      await ownerPage.fill('[name="password"]', 'admin1234');
      await ownerPage.click('button[type="submit"]');
      await ownerPage.waitForURL(/\/(dashboard|$)/);
      await ownerPage.goto('/insurance/exchange-requests');
      await ownerPage.waitForSelector('button:has-text("อนุมัติ")', { timeout: 5000 });
      await ownerPage.locator('button:has-text("อนุมัติ")').first().click();
      // Confirmation dialog
      await ownerPage.locator('button:has-text("ยืนยัน")').click();
      await expect(ownerPage.locator('text=อนุมัติ').first()).toBeVisible({ timeout: 8000 });
    } finally {
      await salesCtx.close();
      await ownerCtx.close();
    }
  });
});
