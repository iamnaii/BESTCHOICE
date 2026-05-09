// E2E: Asset Module Phase 3 — asset summary report smoke test
// Login as FINANCE_MANAGER → call /api/reports/asset-summary for each groupBy
// Verify response is an array.

import { test, expect } from '@playwright/test';
import { loginAsRole } from './helpers/auth';

const API_URL = process.env.API_DIRECT_URL || 'http://localhost:3000';

test('summary report returns array for each groupBy', async ({ page }) => {
  await loginAsRole(page, 'FINANCE_MANAGER');
  for (const groupBy of ['category', 'custodian', 'location']) {
    const res = await page.request.get(`${API_URL}/api/reports/asset-summary?groupBy=${groupBy}`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  }
});
