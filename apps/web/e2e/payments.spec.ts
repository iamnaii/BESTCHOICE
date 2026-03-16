import { test, expect } from '@playwright/test';
import { loginAsAdmin } from './helpers/auth';

test.describe('Payments Page', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/payments');
    await page.waitForLoadState('networkidle');
  });

  test('should display payments page', async ({ page }) => {
    await expect(page).toHaveURL('/payments');
    const bodyText = await page.textContent('body');
    expect(bodyText).toBeTruthy();
  });
});

test.describe('Overdue Page', () => {
  test('should display overdue tracking', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/overdue');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL('/overdue');
  });
});

test.describe('Slip Review Page', () => {
  test('should display slip review page', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/slip-review');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL('/slip-review');
  });
});
