// E2E: Asset Module Phase 3 — asset journal smoke test
// Login as FINANCE_MANAGER → call /api/assets/journal?limit=10
// Verify paginated response shape (data + total + limit).

import { test, expect } from '@playwright/test';
import { loginAsRole } from './helpers/auth';

const API_URL = process.env.API_DIRECT_URL || 'http://localhost:3000';

test('asset journal endpoint returns paginated rows', async ({ page }) => {
  await loginAsRole(page, 'FINANCE_MANAGER');
  const res = await page.request.get(`${API_URL}/api/assets/journal?limit=10`);
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  expect(body).toHaveProperty('data');
  expect(body).toHaveProperty('total');
  expect(body.limit).toBe(10);
});
