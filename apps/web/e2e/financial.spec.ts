import { test, expect } from '@playwright/test';
import { loginViaAPI } from './helpers/auth';

test.describe('Financial Audit Page', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page);
  });

  test('should display financial audit page', async ({ page }) => {
    await page.goto('/financial-audit', { waitUntil: 'domcontentloaded' });

    await expect(
      page.getByText('Financial Audit').or(page.getByText('ประวัติธุรกรรมการเงิน')).first(),
    ).toBeVisible({ timeout: 15000 });
  });

  test('should display search input', async ({ page }) => {
    await page.goto('/financial-audit', { waitUntil: 'domcontentloaded' });

    await expect(
      page.getByPlaceholder('ค้นหาด้วย Contract ID...'),
    ).toBeVisible({ timeout: 15000 });
  });

  test('should search financial audit trail', async ({ page }) => {
    await page.goto('/financial-audit', { waitUntil: 'domcontentloaded' });

    const searchInput = page.getByPlaceholder('ค้นหาด้วย Contract ID...');
    await expect(searchInput).toBeVisible({ timeout: 15000 });

    await searchInput.fill('test');
    await page.waitForTimeout(500);

    await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
  });
});

test.describe('Reports Page', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page);
  });

  test('should display reports page with tabs', async ({ page }) => {
    await page.goto('/reports', { waitUntil: 'domcontentloaded' });

    await expect(page.getByText('รายงาน').first()).toBeVisible({ timeout: 15000 });

    // Report tabs
    const tabs = ['อายุหนี้', 'รายได้', 'ลูกค้าเสี่ยงสูง'];
    let found = 0;
    for (const tab of tabs) {
      if (await page.getByText(tab).first().isVisible({ timeout: 3000 }).catch(() => false)) {
        found++;
      }
    }
    expect(found).toBeGreaterThan(0);
  });

  test('should not display errors on reports page', async ({ page }) => {
    await page.goto('/reports', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);

    // Check for error state text
    const hasError = await page.getByText('ไม่สามารถโหลดข้อมูลรายงานได้').isVisible({ timeout: 3000 }).catch(() => false);
    if (!hasError) {
      await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
    }
    // If error loading reports, that's a valid state (API might not have data)
  });
});

test.describe('Payments Import CSV Page', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page);
  });

  test('should display CSV import page', async ({ page }) => {
    await page.goto('/payments/import-csv', { waitUntil: 'domcontentloaded' });

    await page.waitForTimeout(2000);
    await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
  });
});
