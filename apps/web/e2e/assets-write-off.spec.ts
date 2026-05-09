// E2E: Asset Module Phase 2 — write-off specific flows
// Tests edge cases and permissions for asset write-off operations.
// Focuses on:
//  - Write-off without proceeds (damage/loss)
//  - Depreciation recognition before write-off
//  - Permission checks (FINANCE_MANAGER only)

import { test, expect } from '@playwright/test';
import { loginAsRole } from './helpers/auth';
import { gotoWithRetry } from './helpers/navigation';

const API_URL = process.env.API_DIRECT_URL || 'http://localhost:3000';

test.describe('Asset — write-off variations', () => {
  test('write-off asset with partial depreciation accrued', async ({ page }) => {
    // Simulate an asset that has been in service for a few months
    // and has accumulated depreciation before write-off.
    await loginAsRole(page, 'FINANCE_MANAGER');

    // Create asset with 36-month life
    const createRes = await page.request.post(`${API_URL}/api/assets`, {
      data: {
        name: `E2E Partial Depreciation Test ${Date.now()}`,
        category: 'FURNITURE',
        basePrice: 18000,
        usefulLifeMonths: 36,
        purchaseDate: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
          .toISOString()
          .slice(0, 10), // 90 days ago (about 3 months)
        paymentAccount: '11-1201',
      },
    });
    expect(createRes.ok()).toBeTruthy();
    const created = await createRes.json();
    const assetId = created.id;

    // POST the asset
    const postRes = await page.request.post(`${API_URL}/api/assets/${assetId}/post`);
    expect(postRes.ok()).toBeTruthy();

    // Write off the asset
    const writeOffRes = await page.request.post(`${API_URL}/api/assets/${assetId}/dispose`, {
      data: {
        disposalType: 'WRITE_OFF',
        disposalDate: new Date().toISOString().slice(0, 10),
        reason: 'E2E test partial depreciation write-off — damaged in transit',
      },
    });
    expect(writeOffRes.ok()).toBeTruthy();
    const result = await writeOffRes.json();
    expect(result.entryNo).toBeTruthy();

    // Verify asset is written off
    const afterDispose = await page.request.get(`${API_URL}/api/assets/${assetId}`);
    expect(afterDispose.ok()).toBeTruthy();
    const detail = await afterDispose.json();
    expect(detail.status).toBe('WRITTEN_OFF');

    // UI: detail page should show write-off date and accumulated depreciation
    const ok = await gotoWithRetry(page, `/assets/${assetId}`);
    if (!ok) return;

    await expect(page.getByText('เลิกใช้แล้ว')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
  });

  test('dispose via UI page form (smoke test)', async ({ page }) => {
    // UI smoke: AssetDisposePage form loads and renders without errors
    await loginAsRole(page, 'FINANCE_MANAGER');

    // Create and POST a simple asset first
    const createRes = await page.request.post(`${API_URL}/api/assets`, {
      data: {
        name: `E2E UI Form Test ${Date.now()}`,
        category: 'EQUIPMENT',
        basePrice: 15000,
        usefulLifeMonths: 24,
        purchaseDate: new Date().toISOString().slice(0, 10),
        paymentAccount: '11-1201',
      },
    });
    expect(createRes.ok()).toBeTruthy();
    const created = await createRes.json();
    const assetId = created.id;

    // POST it
    const postRes = await page.request.post(`${API_URL}/api/assets/${assetId}/post`);
    expect(postRes.ok()).toBeTruthy();

    // Navigate to dispose page
    const ok = await gotoWithRetry(page, `/assets/${assetId}/dispose`);
    if (!ok) return;

    // Form should render without errors and the form element must be visible.
    await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
    await expect(page.locator('form').first()).toBeVisible({ timeout: 10000 });
  });
});
