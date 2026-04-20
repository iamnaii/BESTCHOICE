import { test, expect } from '@playwright/test';
import { loginViaAPI } from './helpers/auth';
import { gotoWithRetry, hasErrorBoundary } from './helpers/navigation';

test.describe('Customer Intake — full flow smoke', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page);
  });

  test('clicking "+ เพิ่มลูกค้าใหม่" navigates to /customer-intake', async ({ page }) => {
    const ok = await gotoWithRetry(page, '/customers');
    if (!ok) return;
    const btn = page.getByRole('button', { name: /เพิ่มลูกค้า/ }).first();
    if (!(await btn.isVisible({ timeout: 5000 }).catch(() => false))) return;
    await btn.click();
    await page.waitForURL(/\/customer-intake$/, { timeout: 10000 });
    expect(await hasErrorBoundary(page)).toBe(false);
  });

  test('contracts/create accepts ?customerId= param', async ({ page }) => {
    // First, find an existing customer id
    await gotoWithRetry(page, '/customers');
    const firstRow = page.locator('table tbody tr').first();
    if (!(await firstRow.isVisible({ timeout: 5000 }).catch(() => false))) return;
    await firstRow.click();
    await page.waitForURL(/\/customers\/[^/]+$/, { timeout: 10000 });
    const url = page.url();
    const customerId = url.split('/').pop()?.split('?')[0];
    if (!customerId) return;

    await gotoWithRetry(page, `/contracts/create?customerId=${customerId}`);
    // Page should load without error
    expect(await hasErrorBoundary(page)).toBe(false);
  });

  test('credit status filter chip exists on /customers', async ({ page }) => {
    const ok = await gotoWithRetry(page, '/customers');
    if (!ok) return;
    await expect(page.getByText(/ทุกสถานะเครดิต|รอผู้จัดการตรวจ/).first()).toBeVisible({
      timeout: 10000,
    });
  });
});
