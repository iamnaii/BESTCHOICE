import { test, expect } from '@playwright/test';
import { loginViaAPI, getAuthHeaders } from './helpers/auth';
import { unwrapResponse } from './helpers/api-utils';

/* ================================================================
   Phase A.1a — Chart of Accounts multi-entity scoping
   Verifies the new companyId filter on GET /chart-of-accounts:
   - no param → returns all accounts (SHOP + FINANCE + SHARED)
   - companyId=SHARED → returns only accounts with companyId=null
   - companyId=<SHOP id> → returns only SHOP-owned accounts

   Schema change: ChartOfAccount.allowedCompanies dropped; ownership
   modelled via composite (companyId, code) per Wave 1 of A.1a.
   ================================================================ */

const API_URL = process.env.API_DIRECT_URL || 'http://localhost:3000';

test.describe('Accounting — CoA multi-entity (Phase A.1a)', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page);
  });

  test('GET /chart-of-accounts returns all accounts when no companyId param', async ({ page }) => {
    const res = await page.request.get(`${API_URL}/api/chart-of-accounts`, {
      headers: getAuthHeaders(),
    });
    expect(res.ok()).toBeTruthy();
    const accounts = unwrapResponse(await res.json()) as Array<{ companyId: string | null }>;
    expect(Array.isArray(accounts)).toBeTruthy();
    // After Wave 1 seed split, total chart should comfortably exceed 50 entries
    // across SHOP + FINANCE + any SHARED rows.
    expect(accounts.length).toBeGreaterThan(50);
  });

  test('GET /chart-of-accounts?companyId=SHARED returns only null-companyId accounts', async ({ page }) => {
    const res = await page.request.get(`${API_URL}/api/chart-of-accounts?companyId=SHARED`, {
      headers: getAuthHeaders(),
    });
    expect(res.ok()).toBeTruthy();
    const accounts = unwrapResponse(await res.json()) as Array<{ companyId: string | null }>;
    expect(Array.isArray(accounts)).toBeTruthy();
    // Every returned row must have companyId === null
    expect(accounts.every((a) => a.companyId === null)).toBeTruthy();
  });

  test('GET /chart-of-accounts?companyId=<SHOP_id> returns SHOP accounts only', async ({ page }) => {
    const cosRes = await page.request.get(`${API_URL}/api/companies`, {
      headers: getAuthHeaders(),
    });
    if (!cosRes.ok()) {
      test.skip(true, 'companies endpoint not available');
      return;
    }
    const companies = unwrapResponse(await cosRes.json()) as Array<{
      id: string;
      companyCode?: string;
    }>;
    const shop = companies.find((c) => c.companyCode === 'SHOP');
    if (!shop) {
      test.skip(true, 'SHOP company not configured');
      return;
    }

    const res = await page.request.get(
      `${API_URL}/api/chart-of-accounts?companyId=${shop.id}`,
      { headers: getAuthHeaders() },
    );
    expect(res.ok()).toBeTruthy();
    const accounts = unwrapResponse(await res.json()) as Array<{
      companyId: string | null;
    }>;
    expect(Array.isArray(accounts)).toBeTruthy();
    expect(accounts.length).toBeGreaterThan(0);
    expect(accounts.every((a) => a.companyId === shop.id)).toBeTruthy();
  });
});
