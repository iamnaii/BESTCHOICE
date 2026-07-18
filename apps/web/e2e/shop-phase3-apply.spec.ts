import { test, expect } from '@playwright/test';

// Marked describe.skip until production seed fixtures for a known product ID +
// PaySolutions sandbox credentials land. The module + controller are wired and
// covered by API jest suites; these smoke tests exist to unblock the full user
// journey later.
test.describe.skip('Phase 3: apply + trade-in + saving plan — enable after seed fixtures', () => {
  test('installment apply submits successfully', async ({ page }) => {
    await page.goto('http://localhost:5174/apply/<product-id>');
    await page.getByLabel('ชื่อ-นามสกุล').fill('บีม ทดสอบ');
    await page.getByLabel('เบอร์โทร').fill('0812345678');
    await page.getByLabel('เลขบัตรประชาชน').fill('1234567890123');
    await page.getByRole('button', { name: /ส่งใบสมัคร/ }).click();
    await expect(page).toHaveURL(/\/apply\/success\//);
  });

  // trade-in submit flow was folded into /sell (unified instant-quote wizard) — see sell.spec instead.

  test('saving plan create + pay intent flow', async ({ page }) => {
    await page.goto('http://localhost:5174/saving-plan/create');
    await page.getByLabel(/รุ่น/).fill('iPhone 13');
    await page.getByLabel(/เป้าหมาย/).fill('9000');
    await page.getByRole('button', { name: /สร้างแผน/ }).click();
    await expect(page).toHaveURL(/\/saving-plan\/[0-9a-f-]+/);
  });
});
