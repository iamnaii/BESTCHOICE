// E2E: Depreciation Module Phase 2 — preview + manual run
// Login as FINANCE_MANAGER → create + post asset via API → preview period →
// manual run → verify run appears in list. Mirrors assets-create-post.spec.ts
// pattern: drive heavy lifting through page.request (auth header set by
// loginAsRole) so we exercise the full HTTP stack without flaky form-fill.

import { test, expect } from '@playwright/test';
import { loginAsRole } from './helpers/auth';

const API_URL = process.env.API_DIRECT_URL || 'http://localhost:3000';

test.describe('Depreciation — manual run', () => {
  test('preview + manual run depreciation via API', async ({ page }) => {
    // Depreciation run requires OWNER or FINANCE_MANAGER
    await loginAsRole(page, 'FINANCE_MANAGER');

    // Create + post an asset so there's something to depreciate
    const createRes = await page.request.post(`${API_URL}/api/assets`, {
      data: {
        name: `E2E Depr Test ${Date.now()}`,
        category: 'EQUIPMENT',
        basePrice: 36000,
        usefulLifeMonths: 36,
        purchaseDate: '2026-01-15',
        paymentAccount: '11-1201',
      },
    });

    if (!createRes.ok()) {
      const body = await createRes.text();
      throw new Error(`POST /api/assets failed (${createRes.status()}): ${body}`);
    }

    const created = await createRes.json();
    expect(created.id).toBeTruthy();

    const postRes = await page.request.post(`${API_URL}/api/assets/${created.id}/post`);
    expect(postRes.ok()).toBeTruthy();

    // Pick the current month as the period (cron-safe for any test timing)
    const now = new Date();
    const period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    // Preview
    const previewRes = await page.request.get(
      `${API_URL}/api/depreciation/preview/${period}`,
    );
    expect(previewRes.ok()).toBeTruthy();
    const preview = await previewRes.json();
    expect(preview.assetCount).toBeGreaterThanOrEqual(1);

    // Run
    const runRes = await page.request.post(`${API_URL}/api/depreciation/run`, {
      data: { period },
    });
    expect(runRes.ok()).toBeTruthy();
    const run = await runRes.json();
    expect(run.assetCount).toBeGreaterThanOrEqual(1);
    expect(run.status).toBe('POSTED');

    // Verify it appears in list
    const listRes = await page.request.get(`${API_URL}/api/depreciation`);
    expect(listRes.ok()).toBeTruthy();
    const list = await listRes.json();
    expect(
      list.find((r: { period: string }) => r.period === period),
    ).toBeTruthy();
  });
});
