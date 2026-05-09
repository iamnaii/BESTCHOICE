// E2E: Asset Module Phase 3 — register endpoint smoke test
// Login as FINANCE_MANAGER → call /api/assets/register?asOfDate=today
// Verify response shape includes data + summary.totalNbv.

import { test, expect } from '@playwright/test';
import { loginAsRole } from './helpers/auth';

const API_URL = process.env.API_DIRECT_URL || 'http://localhost:3000';

test('register endpoint returns historical NBV', async ({ page }) => {
  await loginAsRole(page, 'FINANCE_MANAGER');
  const today = new Date().toISOString().slice(0, 10);
  const res = await page.request.get(`${API_URL}/api/assets/register?asOfDate=${today}`);
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  expect(body).toHaveProperty('data');
  expect(body).toHaveProperty('summary');
  expect(body.summary).toHaveProperty('totalNbv');
});
