// E2E: Asset Module Phase 3 — register endpoint smoke test
// Login as FINANCE_MANAGER → call /api/assets/register?asOfDate=today
// Verify response shape includes data + summary.totalNbv.

import { test, expect } from '@playwright/test';
import { loginAsRole, getRoleAuthHeaders } from './helpers/auth';
import { unwrapResponse } from './helpers/api-utils';

const API_URL = process.env.API_DIRECT_URL || 'http://localhost:3000';

test('register endpoint returns historical NBV', async ({ page }) => {
  await loginAsRole(page, 'FINANCE_MANAGER');
  const today = new Date().toISOString().slice(0, 10);
  // page.request needs its own headers — loginAsRole's setExtraHTTPHeaders
  // only covers requests the page itself makes.
  const res = await page.request.get(`${API_URL}/api/assets/register?asOfDate=${today}`, {
    headers: getRoleAuthHeaders('FINANCE_MANAGER'),
  });
  expect(res.ok()).toBeTruthy();
  // Unwrap { success, data, timestamp } — otherwise toHaveProperty('data')
  // passes against the envelope itself and 'summary' is never reached.
  const body = unwrapResponse(await res.json());
  expect(body).toHaveProperty('data');
  expect(body).toHaveProperty('summary');
  expect(body.summary).toHaveProperty('totalNbv');
});
