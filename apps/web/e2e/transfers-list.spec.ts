import { test, expect } from '@playwright/test';
import { loginAsRole } from './helpers/auth';

const API_URL = process.env.API_DIRECT_URL ?? 'http://localhost:3000';

test('list cross-asset transfers via API', async ({ page }) => {
  await loginAsRole(page, 'FINANCE_MANAGER');

  const createRes = await page.request.post(`${API_URL}/api/assets`, {
    data: {
      name: 'E2E Transfer Test',
      category: 'EQUIPMENT',
      basePrice: 10000,
      usefulLifeMonths: 24,
      purchaseDate: new Date().toISOString().slice(0, 10),
      paymentAccount: '11-1201',
      custodian: 'Alice',
      location: 'HQ',
    },
  });
  const created = await createRes.json();
  await page.request.post(`${API_URL}/api/assets/${created.id}/post`);

  await page.request.post(`${API_URL}/api/assets/${created.id}/transfer`, {
    data: {
      transferDate: new Date().toISOString().slice(0, 10),
      toCustodian: 'Bob',
      reason: 'E2E test transfer',
    },
  });

  const listRes = await page.request.get(`${API_URL}/api/asset-transfers?search=E2E+Transfer+Test`);
  expect(listRes.ok()).toBeTruthy();
  const list = await listRes.json();
  expect(list.total).toBeGreaterThanOrEqual(1);
  const found = list.data.find(
    (r: { asset: { id: string }; toCustodian: string }) =>
      r.asset.id === created.id && r.toCustodian === 'Bob',
  );
  expect(found).toBeTruthy();
});
