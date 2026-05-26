import { test, expect } from '@playwright/test';
import { loginViaAPI, loginAsRole } from './helpers/auth';

test.describe('/letters page', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page);
  });

  test('owner sees 5 tabs', async ({ page }) => {
    await page.goto('/letters', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'จัดการจดหมาย' })).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByText('รอพิมพ์', { exact: false }).first()).toBeVisible();
    await expect(page.getByText('พิมพ์แล้ว', { exact: false }).first()).toBeVisible();
    await expect(page.getByText('ส่งแล้ว', { exact: false }).first()).toBeVisible();
    await expect(page.getByText('ตีกลับ', { exact: false }).first()).toBeVisible();
    await expect(page.getByText('ยกเลิก', { exact: false }).first()).toBeVisible();
  });

  test('search filter triggers q= request', async ({ page }) => {
    await page.goto('/letters', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'จัดการจดหมาย' })).toBeVisible({
      timeout: 15000,
    });

    const requestPromise = page.waitForRequest(
      (req) => req.url().includes('/overdue/letters') && req.url().includes('q='),
      { timeout: 10000 },
    );
    await page.getByPlaceholder(/ค้นหา/).fill('สมชาย');
    await requestPromise;
  });

  test('Export Excel button triggers a download', async ({ page }) => {
    await page.goto('/letters', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'จัดการจดหมาย' })).toBeVisible({
      timeout: 15000,
    });

    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: /Export Excel/ }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/letters-.*\.xlsx/);
  });

  test('SALES role: no row Cancel button (X icon)', async ({ page }) => {
    await loginAsRole(page, 'SALES');
    await page.goto('/letters', { waitUntil: 'domcontentloaded' });

    // Allow some time for data to load
    await page.waitForTimeout(500);

    // Bulk Cancel button text should not appear for SALES role
    // (only OWNER/BRANCH_MANAGER can cancel letters)
    await expect(page.getByRole('button', { name: 'ยกเลิก', exact: true })).toHaveCount(0);
  });
});
