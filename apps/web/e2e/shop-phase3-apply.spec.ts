import { test, expect } from '@playwright/test';

// Marked describe.skip until production seed fixtures for a known product ID +
// PaySolutions sandbox credentials land. The module + controller are wired and
// covered by API jest suites; these smoke tests exist to unblock the full user
// journey later.
test.describe.skip('Phase 3: apply — enable after seed fixtures', () => {
  test('installment apply submits successfully', async ({ page }) => {
    await page.goto('http://localhost:5174/apply/<product-id>');
    await page.getByLabel('ชื่อ-นามสกุล').fill('บีม ทดสอบ');
    await page.getByLabel('เบอร์โทร').fill('0812345678');
    await page.getByLabel('เลขบัตรประชาชน').fill('1234567890123');
    await page.getByRole('button', { name: /ส่งใบสมัคร/ }).click();
    await expect(page).toHaveURL(/\/apply\/success\//);
  });

  // trade-in submit flow was folded into /sell (unified instant-quote wizard) — see sell.spec instead.
  // saving plan (ออมดาวน์) ถูกถอดออกทั้งเว็บลูกค้าและแอดมิน 2026-09-28 (คำสั่งเจ้าของ) — ไม่มี route ให้ทดสอบแล้ว
});
