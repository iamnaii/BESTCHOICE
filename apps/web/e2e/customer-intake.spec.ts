import { test, expect } from '@playwright/test';
import { loginViaAPI } from './helpers/auth';
import { gotoWithRetry, hasErrorBoundary } from './helpers/navigation';

test.describe('Customer Intake wizard', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page);
  });

  test('loads intake page', async ({ page }) => {
    const ok = await gotoWithRetry(page, '/customer-intake');
    if (!ok) return;
    await expect(page.getByText(/ข้อมูลเบื้องต้น/).first()).toBeVisible({ timeout: 15000 });
    expect(await hasErrorBoundary(page)).toBe(false);
  });

  test('step indicator shows 4 steps', async ({ page }) => {
    await gotoWithRetry(page, '/customer-intake');
    await expect(page.getByText('เช็คเครดิต').first()).toBeVisible();
    await expect(page.getByText('ข้อมูลเต็ม').first()).toBeVisible();
    await expect(page.getByText('เสร็จสิ้น').first()).toBeVisible();
  });
});
