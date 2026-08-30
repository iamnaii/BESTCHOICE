// E2E: Asset Module Phase 3 — asset journal smoke test
// Login as FINANCE_MANAGER → call /api/assets/journal?limit=10
// Verify paginated response shape (data + total + limit).

import { test, expect } from '@playwright/test';
import { loginAsRole, getRoleAuthHeaders } from './helpers/auth';
import { unwrapResponse } from './helpers/api-utils';

const API_URL = process.env.API_DIRECT_URL || 'http://localhost:3000';

test('asset journal endpoint returns paginated rows', async ({ page }) => {
  await loginAsRole(page, 'FINANCE_MANAGER');
  // page.request needs its own headers — loginAsRole's setExtraHTTPHeaders
  // only covers requests the page itself makes.
  const res = await page.request.get(`${API_URL}/api/assets/journal?limit=10`, {
    headers: getRoleAuthHeaders('FINANCE_MANAGER'),
  });
  expect(res.ok()).toBeTruthy();
  // API wraps every success body in { success, data, timestamp }
  const body = unwrapResponse(await res.json());
  expect(body).toHaveProperty('data');
  expect(body).toHaveProperty('total');
  expect(body.limit).toBe(10);
});
