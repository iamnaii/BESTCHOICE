import { test, expect } from '@playwright/test';
import { loginAsRole, getRoleAuthHeaders } from './helpers/auth';
import { unwrapResponse } from './helpers/api-utils';
import { backlogFixtures } from './helpers/backlog-fixtures';
const API_URL = process.env.API_DIRECT_URL || 'http://localhost:3000';

test.describe('Accounting — PaySolutions webhook creates JE (F-1-003)', () => {
  test('webhook endpoint exists and rejects unsigned/invalid payloads', async ({ request }) => {
    const res = await request.post(`${API_URL}/api/paysolutions/webhook`, {
      data: { invalid: 'payload' },
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status()).toBe(200);
    expect(unwrapResponse(await res.json())).toEqual({ received: true, processed: false });
  });

  test('recent PAID payments via gateway have matching JournalEntry (F-1-003)', async ({
    page,
  }) => {
    const f = backlogFixtures().gateway;
    await loginAsRole(page, 'OWNER');
    const headers = getRoleAuthHeaders('OWNER');
    const readPayments = async () => {
      const r = await page.request.get(`${API_URL}/api/payments/contract/${f.id}`, { headers });
      expect(r.status()).toBe(200);
      return unwrapResponse(await r.json()).data;
    };
    const readEntries = async () => {
      const r = await page.request.get(`${API_URL}/api/payments/contract/${f.id}/journal-entries`, {
        headers,
      });
      expect(r.status()).toBe(200);
      return unwrapResponse(await r.json());
    };
    const before = (await readPayments()).find((p: { id: string }) => p.id === f.paymentId);
    expect(before.status).toBe('PENDING');
    const unsigned = await page.request.post(`${API_URL}/api/paysolutions/webhook`, {
      data: f.rawPayload,
      headers: { 'Content-Type': 'application/json' },
    });
    expect(unwrapResponse(await unsigned.json())).toMatchObject({ processed: false });
    expect((await readPayments()).find((p: { id: string }) => p.id === f.paymentId)).toMatchObject({
      status: 'PENDING',
    });
    const send = () =>
      page.request.post(`${API_URL}/api/paysolutions/webhook`, {
        data: f.rawPayload,
        headers: { 'Content-Type': 'application/json', 'x-paysolutions-signature': f.signature },
      });
    const response = await send();
    expect(response.status(), await response.text()).toBe(200);
    expect(unwrapResponse(await response.json())).toEqual({ received: true, processed: true });
    const paid = (await readPayments()).find((p: { id: string }) => p.id === f.paymentId);
    expect(paid).toMatchObject({ status: 'PAID', paymentMethod: 'ONLINE_GATEWAY' });
    expect(Number(paid.amountPaid)).toBe(Number(before.amountDue));
    const entries = await readEntries();
    const matched = entries.filter((e: { paymentId?: string }) => e.paymentId === f.paymentId);
    expect(matched.length).toBeGreaterThan(0);
    const receipts = matched.filter((entry: { tag: string }) => entry.tag === 'receipt');
    expect(receipts).toHaveLength(1);
    const cashDebit = receipts[0].lines
      .filter((line: { accountCode: string }) => /^11-12/.test(line.accountCode))
      .reduce(
        (sum: number, line: { debit: string }) => sum + Math.round(Number(line.debit) * 100),
        0,
      );
    expect(cashDebit).toBe(Math.round(Number(before.amountDue) * 100));
    for (const entry of matched) {
      expect(entry.lines.length).toBeGreaterThan(1);
      const debit = entry.lines.reduce(
        (sum: number, line: { debit: string }) => sum + Math.round(Number(line.debit) * 100),
        0,
      );
      const credit = entry.lines.reduce(
        (sum: number, line: { credit: string }) => sum + Math.round(Number(line.credit) * 100),
        0,
      );
      expect(debit).toBeGreaterThan(0);
      expect(debit).toBe(credit);
    }
    expect((await send()).status()).toBe(200);
    expect((await readEntries()).map((e: { id: string }) => e.id).sort()).toEqual(
      entries.map((e: { id: string }) => e.id).sort(),
    );
    expect(
      (await readPayments()).find((p: { id: string }) => p.id === f.paymentId).amountPaid,
    ).toBe(paid.amountPaid);
  });
});
