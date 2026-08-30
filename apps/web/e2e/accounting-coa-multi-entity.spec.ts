import { test, expect } from '@playwright/test';
import { loginViaAPI, getAuthHeaders } from './helpers/auth';
import { unwrapResponse } from './helpers/api-utils';

/* ================================================================
   Chart of Accounts — multi-entity partitioning

   ⚠️ The `companyId` scoping this file used to assert NEVER SHIPPED.
   `model ChartOfAccount` (apps/api/prisma/schema.prisma) has no
   `companyId` column at all — the code comment on `code` says it
   outright: "no companyId scoping in A.4". `GET /chart-of-accounts`
   (chart-of-accounts.controller.ts) accepts only `type` / `status` /
   `q`; any `?companyId=` is silently ignored and the full chart comes
   back.

   The partition that DOES exist is the `S` code prefix (P3-SP5, see
   .claude/rules/accounting.md → "Chart prefix convention"):
     FINANCE → 11-1101, 21-1101, …   (seed-coa-finance.ts)
     SHOP    → S11-1101, S21-1101, … (seed-coa-shop.ts)
   Both live in the same table; the prefix is the partition key until
   Phase 3 SP7 splits the entities. Report-level entity scoping is a
   different endpoint: GET /expenses/ledger/trial-balance?scope=SHOP.
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
    const accounts = unwrapResponse(await res.json()) as Array<{ code: string }>;
    expect(Array.isArray(accounts)).toBeTruthy();
    // FINANCE seeds ~111 rows and SHOP ~57, so the combined chart comfortably
    // exceeds 50. (There is no "SHARED" tier — see the file header.)
    expect(accounts.length).toBeGreaterThan(50);
  });

  test('GET /chart-of-accounts returns both the FINANCE and the SHOP chart', async ({ page }) => {
    const res = await page.request.get(`${API_URL}/api/chart-of-accounts`, {
      headers: getAuthHeaders(),
    });
    expect(res.ok()).toBeTruthy();
    const accounts = unwrapResponse(await res.json()) as Array<{ code: string }>;
    expect(Array.isArray(accounts)).toBeTruthy();
    // FINANCE codes are bare (11-1101); SHOP codes carry the leading `S` (S11-1101).
    expect(accounts.some((a) => /^\d{2}-/.test(a.code))).toBeTruthy();
    expect(accounts.some((a) => a.code.startsWith('S'))).toBeTruthy();
  });

  test('SHOP-owned accounts are identified by the leading `S` code prefix', async ({ page }) => {
    const res = await page.request.get(`${API_URL}/api/chart-of-accounts`, {
      headers: getAuthHeaders(),
    });
    expect(res.ok()).toBeTruthy();
    const accounts = unwrapResponse(await res.json()) as Array<{ code: string }>;
    expect(Array.isArray(accounts)).toBeTruthy();

    const shopAccounts = accounts.filter((a) => a.code.startsWith('S'));
    expect(shopAccounts.length).toBeGreaterThan(0);
    // csv-fixture-loader accepts `^S?\d{2}-\d{4}$` — every seeded SHOP row must fit it.
    expect(shopAccounts.every((a) => /^S\d{2}-\d{4}$/.test(a.code))).toBeTruthy();
  });
});
