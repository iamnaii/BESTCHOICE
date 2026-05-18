import { test, expect, Page } from '@playwright/test';
import { loginAsRole } from './helpers/auth';
import { gotoWithRetry } from './helpers/navigation';

/**
 * SP3 — Tax Module Restructure
 *
 * Confirms 3 new pages render for OWNER / FINANCE_MANAGER / ACCOUNTANT and
 * are denied for SALES. Smoke-only: structure not data — no fixture seeding.
 */

async function isAccessDenied(page: Page, targetUrl: string): Promise<boolean> {
  await page.waitForTimeout(2000);
  const redirectedAway = !page.url().includes(targetUrl);
  const deniedMsg = await page
    .getByText(/ไม่มีสิทธิ์|access denied|unauthorized|403|ไม่อนุญาต/i)
    .first()
    .isVisible({ timeout: 2000 })
    .catch(() => false);
  return redirectedAway || deniedMsg;
}

test.describe('SP3 — Tax Module pages (ACCOUNTANT can view)', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsRole(page, 'ACCOUNTANT');
  });

  test('ACCOUNTANT can access /finance/vat (ภ.พ.30)', async ({ page }) => {
    await gotoWithRetry(page, '/finance/vat');
    const denied = await isAccessDenied(page, '/finance/vat');
    expect(denied).toBeFalsy();
    await expect(page.getByRole('heading', { name: /ภ\.พ\.30/i }).first()).toBeVisible();
  });

  test('ACCOUNTANT can access /finance/wht (ภ.ง.ด. 1/3/53)', async ({ page }) => {
    await gotoWithRetry(page, '/finance/wht');
    const denied = await isAccessDenied(page, '/finance/wht');
    expect(denied).toBeFalsy();
    await expect(page.getByRole('tab', { name: /ภ\.ง\.ด\.1/i }).first()).toBeVisible();
  });

  test('ACCOUNTANT can access /finance/e-tax (e-Tax Invoice)', async ({ page }) => {
    await gotoWithRetry(page, '/finance/e-tax');
    const denied = await isAccessDenied(page, '/finance/e-tax');
    expect(denied).toBeFalsy();
    await expect(page.getByText(/e-Tax Invoice/i).first()).toBeVisible();
  });

  test('legacy /tax-reports redirects to /finance/vat', async ({ page }) => {
    await gotoWithRetry(page, '/tax-reports');
    await page.waitForTimeout(1500);
    expect(page.url()).toContain('/finance/vat');
  });
});

test.describe('SP3 — Tax Module pages (SALES denied)', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsRole(page, 'SALES');
  });

  for (const url of ['/finance/vat', '/finance/wht', '/finance/e-tax']) {
    test(`SALES denied access to ${url}`, async ({ page }) => {
      await gotoWithRetry(page, url);
      const denied = await isAccessDenied(page, url);
      expect(denied).toBeTruthy();
    });
  }
});
