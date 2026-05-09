// E2E: Asset Module Phase 3 — per-asset audit trail smoke test
// Login as FINANCE_MANAGER → create asset via API → POST it →
// fetch /api/assets/:id/audit and verify >=1 log entry.

import { test, expect } from '@playwright/test';
import { loginAsRole } from './helpers/auth';

const API_URL = process.env.API_DIRECT_URL || 'http://localhost:3000';

test('per-asset audit endpoint returns log entries', async ({ page }) => {
  await loginAsRole(page, 'FINANCE_MANAGER');
  const createRes = await page.request.post(`${API_URL}/api/assets`, {
    data: {
      name: `E2E Audit Test ${Date.now()}`,
      category: 'EQUIPMENT',
      basePrice: 5000,
      usefulLifeMonths: 12,
      purchaseDate: new Date().toISOString().slice(0, 10),
      paymentAccount: '11-1201',
    },
  });
  expect(createRes.ok()).toBeTruthy();
  const created = await createRes.json();
  await page.request.post(`${API_URL}/api/assets/${created.id}/post`);
  const auditRes = await page.request.get(`${API_URL}/api/assets/${created.id}/audit`);
  expect(auditRes.ok()).toBeTruthy();
  const audit = await auditRes.json();
  expect(Array.isArray(audit)).toBe(true);
  expect(audit.length).toBeGreaterThanOrEqual(1);
});
