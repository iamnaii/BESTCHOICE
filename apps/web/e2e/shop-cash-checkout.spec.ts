import { test, expect } from '@playwright/test';

test.describe.skip('Phase 2: cash checkout — enable after PaySolutions sandbox + seed fixtures', () => {
  test('browse → reserve → cart → checkout → place order', async ({ page }) => {
    await page.goto('http://localhost:5174/products');
    await page.getByText('iPhone', { exact: false }).first().click();
    await page.getByRole('button', { name: /ซื้อเลย/ }).click();
    await expect(page).toHaveURL(/\/cart/);
    await page.getByRole('button', { name: /ดำเนินการชำระเงิน/ }).click();
    await expect(page).toHaveURL(/\/checkout/);
    // login + fill address + ship + pay: complete once fixtures land
  });
});
