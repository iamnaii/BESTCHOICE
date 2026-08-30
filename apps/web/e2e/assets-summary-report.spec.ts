// E2E: Asset Module Phase 3 — asset summary report smoke test
// Login as FINANCE_MANAGER → call /api/reports/asset-summary for each groupBy
// Verify response is an array.

import { test, expect } from '@playwright/test';
import { loginAsRole, getRoleAuthHeaders } from './helpers/auth';
import { unwrapResponse } from './helpers/api-utils';

const API_URL = process.env.API_DIRECT_URL || 'http://localhost:3000';

test('summary report returns array for each groupBy', async ({ page }) => {
  await loginAsRole(page, 'FINANCE_MANAGER');
  for (const groupBy of ['category', 'custodian', 'location']) {
    // page.request needs its own headers — loginAsRole's setExtraHTTPHeaders
    // only covers requests the page itself makes.
    const res = await page.request.get(`${API_URL}/api/reports/asset-summary?groupBy=${groupBy}`, {
      headers: getRoleAuthHeaders('FINANCE_MANAGER'),
    });
    expect(res.ok()).toBeTruthy();
    // The array lives under .data of the { success, data, timestamp } envelope
    const body = unwrapResponse(await res.json());
    expect(Array.isArray(body)).toBe(true);
  }
});
