import { test, expect } from '@playwright/test';
import { loginViaAPI, getAuthHeaders } from './helpers/auth';
import { unwrapResponse } from './helpers/api-utils';

/* ================================================================
   Phase A.1b — Inter-company JE invariant

   After Phase A.1b, contract activation and payment posting create
   PAIRED journal entries on SHOP + FINANCE companies via the
   inter-company clearing accounts:
     - SHOP side:    11-2105 Due-from-FINANCE
     - FINANCE side: 21-1102 Due-to-SHOP

   Invariant: across ALL posted JEs, the net debit on SHOP's
   Due-from-FINANCE must equal the net credit on FINANCE's
   Due-to-SHOP. Any drift means a paired entry was lost or
   one-sided.

   Strategy: query trial-balance per company, compare balances on
   the two clearing accounts.
   ================================================================ */

const API_URL = process.env.API_DIRECT_URL || 'http://localhost:3000';

const SHOP_DUE_FROM_FINANCE = '11-2105';
const FINANCE_DUE_TO_SHOP = '21-1102';

test.describe('Accounting — Inter-company JE invariant (Phase A.1b)', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page);
  });

  test('SHOP Due-from-FINANCE balance equals FINANCE Due-to-SHOP balance', async ({ page }) => {
    const cosRes = await page.request.get(`${API_URL}/api/companies`, {
      headers: getAuthHeaders(),
    });

    if (!cosRes.ok()) {
      test.skip(true, 'companies endpoint unavailable');
      return;
    }

    const companies = unwrapResponse(await cosRes.json()) as Array<{
      id: string;
      companyCode: string;
    }>;
    const shop = companies.find((c) => c.companyCode === 'SHOP');
    const finance = companies.find((c) => c.companyCode === 'FINANCE');

    if (!shop || !finance) {
      test.skip(true, 'SHOP/FINANCE companies not configured in dev DB');
      return;
    }

    const shopTBRes = await page.request.get(
      `${API_URL}/api/journal-entries/trial-balance?companyId=${shop.id}`,
      { headers: getAuthHeaders() },
    );
    expect(shopTBRes.ok()).toBeTruthy();
    const shopTB = unwrapResponse(await shopTBRes.json()) as {
      accounts: Array<{ code: string; balance: number }>;
      balanced: boolean;
    };

    const financeTBRes = await page.request.get(
      `${API_URL}/api/journal-entries/trial-balance?companyId=${finance.id}`,
      { headers: getAuthHeaders() },
    );
    expect(financeTBRes.ok()).toBeTruthy();
    const financeTB = unwrapResponse(await financeTBRes.json()) as {
      accounts: Array<{ code: string; balance: number }>;
      balanced: boolean;
    };

    // Each company's own trial balance must balance independently
    expect(shopTB.balanced, 'SHOP trial balance must be balanced').toBeTruthy();
    expect(financeTB.balanced, 'FINANCE trial balance must be balanced').toBeTruthy();

    const shopDueFrom = shopTB.accounts.find((a) => a.code === SHOP_DUE_FROM_FINANCE);
    const financeDueTo = financeTB.accounts.find((a) => a.code === FINANCE_DUE_TO_SHOP);

    if (!shopDueFrom && !financeDueTo) {
      test.skip(true, 'no inter-company activity yet — both clearing accounts unused');
      return;
    }

    // SHOP Due-from-FINANCE: asset, normal balance = debit positive
    // FINANCE Due-to-SHOP:    liability, normal balance = credit (so balance field = -credit)
    // For the invariant, compare absolute amounts.
    const shopDueFromAmount = shopDueFrom ? shopDueFrom.balance : 0;
    const financeDueToAmount = financeDueTo ? -financeDueTo.balance : 0;

    expect(
      Math.abs(shopDueFromAmount - financeDueToAmount),
      `Inter-company drift: SHOP Due-from-FINANCE=${shopDueFromAmount} but FINANCE Due-to-SHOP=${financeDueToAmount}`,
    ).toBeLessThan(0.01);
  });

  test('every recent JournalEntry is balanced (no silent unbalanced post)', async ({ page }) => {
    // Sanity check covering both companies — extends the Phase A.0 check.
    const res = await page.request.get(`${API_URL}/api/journal-entries?limit=100`, {
      headers: getAuthHeaders(),
    });

    expect(res.ok()).toBeTruthy();
    const body = unwrapResponse(await res.json()) as {
      data: Array<{
        id: string;
        entryNumber: string;
        lines: Array<{ debit: string | number; credit: string | number }>;
      }>;
    };

    expect(Array.isArray(body.data)).toBeTruthy();

    for (const entry of body.data) {
      const debitSum = entry.lines.reduce((s, l) => s + Number(l.debit || 0), 0);
      const creditSum = entry.lines.reduce((s, l) => s + Number(l.credit || 0), 0);
      expect(
        Math.abs(debitSum - creditSum),
        `Entry ${entry.entryNumber} unbalanced: Dr=${debitSum} Cr=${creditSum}`,
      ).toBeLessThan(0.01);
    }
  });
});
