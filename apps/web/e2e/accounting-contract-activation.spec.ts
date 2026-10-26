import { test, expect } from '@playwright/test';
import { loginViaAPI, getAuthHeaders } from './helpers/auth';
import { unwrapResponse } from './helpers/api-utils';

import { backlogFixtures } from './helpers/backlog-fixtures';

const API_URL = process.env.API_DIRECT_URL || 'http://localhost:3000';

test.describe('Accounting — Contract Activation creates JE (Phase A.0)', () => {
  test('all recent JournalEntries are balanced (F-1-002 — no silent unbalanced post)', async ({
    page,
  }) => {
    await loginViaAPI(page);
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

    // For every entry in the recent window, debit-sum must equal credit-sum.
    // Even one unbalanced entry = F-1-002 regression.
    for (const entry of body.data) {
      const debitSum = entry.lines.reduce((s, l) => s + Number(l.debit || 0), 0);
      const creditSum = entry.lines.reduce((s, l) => s + Number(l.credit || 0), 0);
      // Allow 0.01 rounding tolerance for Decimal serialization
      expect(
        Math.abs(debitSum - creditSum),
        `Entry ${entry.entryNumber} unbalanced: Dr=${debitSum} Cr=${creditSum}`,
      ).toBeLessThan(0.01);
    }
  });

  test('activated contracts each have at least one related JournalEntry (F-2-001)', async ({
    page,
  }) => {
    const fixtures = backlogFixtures();
    await loginViaAPI(page);
    const contract = fixtures.activation;
    const activated = await page.request.post(`${API_URL}/api/contracts/${contract.id}/activate`, {
      headers: getAuthHeaders(),
    });
    expect(activated.ok(), await activated.text()).toBe(true);
    expect(unwrapResponse(await activated.json())).toMatchObject({
      id: contract.id,
      status: 'ACTIVE',
    });
    const response = await page.request.get(
      `${API_URL}/api/contracts/${contract.id}/journal-entries`,
      { headers: getAuthHeaders() },
    );
    expect(response.status()).toBe(200);
    const entries = unwrapResponse(await response.json()) as Array<{
      tag: string;
      companyCode: string;
      lines: Array<{ debit: string; credit: string }>;
    }>;
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.some((entry) => entry.tag === '1A' && entry.companyCode === 'FINANCE')).toBe(
      true,
    );
    expect(entries.some((entry) => entry.companyCode === 'SHOP')).toBe(true);
    const product = await page.request.get(`${API_URL}/api/products/${contract.productId}`, {
      headers: getAuthHeaders(),
    });
    expect(product.status()).toBe(200);
    expect(unwrapResponse(await product.json())).toMatchObject({
      status: 'SOLD_INSTALLMENT',
      ownedByCompanyId: fixtures.financeCompanyId,
    });
    for (const entry of entries) {
      expect(entry.lines.length).toBeGreaterThan(1);
      const debit = entry.lines.reduce(
        (sum, line) => sum + Math.round(Number(line.debit) * 100),
        0,
      );
      const credit = entry.lines.reduce(
        (sum, line) => sum + Math.round(Number(line.credit) * 100),
        0,
      );
      expect(debit).toBeGreaterThan(0);
      expect(debit).toBe(credit);
    }
  });
});
