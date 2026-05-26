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

  test('SALES role can access /letters page (no redirect)', async ({ page }) => {
    await loginAsRole(page, 'SALES');

    const lettersResponse = page.waitForResponse(
      (r) => r.url().includes('/overdue/letters') && r.status() === 200,
    );
    await page.goto('/letters', { waitUntil: 'domcontentloaded' });
    await lettersResponse;

    // Backend `@Roles` allows SALES; frontend ProtectedRoute lets them in.
    // Cancel-button absence on individual rows is covered by the backend
    // role test (POST /overdue/letters/:id/cancel returns 403 for SALES) +
    // unit-tested in LetterTable component logic — asserting on tab labels
    // here is brittle (the "CANCELLED" status tab also has text "ยกเลิก").
    await expect(page.getByRole('heading', { name: 'จัดการจดหมาย' })).toBeVisible();
    expect(page.url()).toContain('/letters');
  });
});
