import { test, expect } from '@playwright/test';
import { loginViaAPI, getAuthHeaders } from './helpers/auth';
import { unwrapResponse } from './helpers/api-utils';

/* ================================================================
   Inter-company JE invariant

   ⚠️ This file used to query `GET /journal-entries/trial-balance
   ?companyId=…`. That endpoint was REMOVED — journal.controller.ts
   says so in a comment, and the request now falls through to
   `@Get(':id')` with id='trial-balance' → 404. The replacement,
   `GET /expenses/ledger/trial-balance`, takes `scope=FINANCE|SHOP|ALL`
   (prefix-based), never `companyId`, and returns a completely
   different shape ({ sections, perScope, isBalanced, … }).

   The clearing accounts this file named were wrong too:
   intercompany.service.ts documents that the old formula read FINANCE
   from 21-1102 only (missing 21-1101, the bulk of the payable) and
   SHOP from 11-2105 — a dead Phase A.3 placeholder nothing posts to.
   The live formula is FINANCE 21-1101 + 21-1102 (Cr−Dr) vs SHOP
   S11-3001 + S11-3002 (Dr−Cr), and it already has an endpoint:
   GET /accounting/intercompany/balance.

   NOTE: `balanced === true` is NOT asserted on purpose. A nonzero
   drift is an EXPECTED condition (`driftNote` on the response says
   so): contracts activated before 2026-06-23 (`legacyNoShop`) and
   contracts with an empty `storeCommission` (COMMISSION_ONLY_GAP)
   have no SHOP-side receivable at all.
   ================================================================ */

const API_URL = process.env.API_DIRECT_URL || 'http://localhost:3000';

test.describe('Accounting — Inter-company JE invariant', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page);
  });

  test('GET /accounting/intercompany/balance reports both books and their drift', async ({
    page,
  }) => {
    const res = await page.request.get(`${API_URL}/api/accounting/intercompany/balance`, {
      headers: getAuthHeaders(),
    });
    expect(res.ok()).toBeTruthy();

    const balance = unwrapResponse(await res.json()) as {
      financeOwesToShop: number;
      shopReceivableFromFinance: number;
      balanced: boolean;
      drift: number;
      driftNote: string;
    };

    expect(typeof balance.financeOwesToShop).toBe('number');
    expect(typeof balance.shopReceivableFromFinance).toBe('number');
    expect(typeof balance.drift).toBe('number');
    expect(typeof balance.balanced).toBe('boolean');

    // drift is defined as SHOP receivable − FINANCE payable; the three numbers
    // must stay internally consistent even when the drift itself is nonzero.
    expect(
      Math.abs(balance.drift - (balance.shopReceivableFromFinance - balance.financeOwesToShop)),
      `Inconsistent response: drift=${balance.drift}, SHOP=${balance.shopReceivableFromFinance}, FINANCE=${balance.financeOwesToShop}`,
    ).toBeLessThan(0.01);
    expect(balance.balanced).toBe(Math.abs(balance.drift) < 0.01);
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
