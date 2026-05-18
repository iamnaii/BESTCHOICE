/**
 * Seed-data helpers for E2E flow specs.
 *
 * These helpers create real records via the API (no mocks) and return their
 * ids so each spec can clean up in afterAll. Don't pollute the dev DB —
 * always call cleanupTestData(page, ids) from an afterAll hook.
 *
 * Naming convention: every test record gets a 'e2e-flow-' prefix in a notes/
 * field where supported, plus a unique timestamp suffix on names so reruns
 * never collide.
 */

import { Page } from '@playwright/test';
import { unwrapResponse } from '../helpers/api-utils';

const API_URL = process.env.API_DIRECT_URL || 'http://localhost:3000';

function headers(token: string) {
  return {
    'X-Requested-With': 'XMLHttpRequest',
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

export interface SeedIds {
  customers: string[];
  products: string[];
  bookings: string[];
  quotes: string[];
  contracts: string[];
  sales: string[];
  payments: string[];
}

export function newSeedIds(): SeedIds {
  return {
    customers: [],
    products: [],
    bookings: [],
    quotes: [],
    contracts: [],
    sales: [],
    payments: [],
  };
}

/** Unique-per-run suffix so seeded names never collide on retry */
export function runSuffix() {
  return `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

/* ─── Customer ─── */

export interface SeedCustomerInput {
  firstName?: string;
  lastName?: string;
  phone?: string;
  nationalId?: string;
}

export async function seedCustomer(
  page: Page,
  token: string,
  input: SeedCustomerInput = {},
): Promise<{ id: string; name: string; phone: string }> {
  const suffix = runSuffix();
  // 13 digit national ID — Thai checksum isn't enforced for the dev seed
  const nationalId = input.nationalId ?? `199${suffix.replace(/\D/g, '').padStart(10, '9').slice(-10)}`;
  const phone = input.phone ?? `08${Math.floor(10000000 + Math.random() * 89999999)}`;
  const firstName = input.firstName ?? 'ทดสอบ';
  const lastName = input.lastName ?? `อัตโนมัติ-${suffix.slice(-6)}`;

  const res = await page.request.post(`${API_URL}/api/customers`, {
    headers: headers(token),
    data: { firstName, lastName, nationalId, phone, nickname: 'E2E' },
  });
  if (!res.ok()) {
    const body = await res.text();
    throw new Error(`seedCustomer failed (${res.status()}): ${body}`);
  }
  const c = unwrapResponse(await res.json());
  return { id: c.id, name: `${c.firstName} ${c.lastName}`, phone: c.phone };
}

/* ─── Branch lookup ─── */

export async function getFirstBranch(page: Page, token: string): Promise<{ id: string; name: string }> {
  const res = await page.request.get(`${API_URL}/api/branches`, { headers: headers(token) });
  if (!res.ok()) throw new Error(`getFirstBranch failed: ${res.status()}`);
  const data = unwrapResponse(await res.json());
  const list = Array.isArray(data) ? data : (data.data ?? []);
  if (list.length === 0) throw new Error('No branches available');
  return { id: list[0].id, name: list[0].name };
}

/* ─── Product lookup ─── */

export async function getFirstInStockProduct(
  page: Page,
  token: string,
): Promise<{ id: string; name: string; sellingPrice: string } | null> {
  const res = await page.request.get(`${API_URL}/api/products?status=IN_STOCK&limit=10`, {
    headers: headers(token),
  });
  if (!res.ok()) return null;
  const data = unwrapResponse(await res.json());
  const list = (data.data ?? data ?? []) as Array<{
    id: string;
    name?: string;
    productName?: string;
    sellingPrice?: string | number;
    price?: string | number;
  }>;
  if (list.length === 0) return null;
  const p = list[0];
  return {
    id: p.id,
    name: p.name ?? p.productName ?? 'สินค้าทดสอบ',
    sellingPrice: String(p.sellingPrice ?? p.price ?? '0'),
  };
}

/* ─── AccountingPeriod (monthly close prep) ─── */

export interface SeedClosedPeriodInput {
  year: number;
  month: number;
  companyId?: string; // FINANCE companyId if you have it; left optional
}

/** Best-effort close a monthly period — returns true if closed or already closed */
export async function seedClosedPeriod(
  page: Page,
  token: string,
  input: SeedClosedPeriodInput,
): Promise<boolean> {
  // Pull the FINANCE company if not provided
  let companyId = input.companyId;
  if (!companyId) {
    const c = await page.request.get(`${API_URL}/api/companies`, { headers: headers(token) });
    if (c.ok()) {
      const raw = unwrapResponse(await c.json());
      const list = (raw.data ?? raw ?? []) as Array<{ id: string; companyCode?: string }>;
      const finance = list.find((x) => x.companyCode === 'FINANCE') ?? list[0];
      companyId = finance?.id;
    }
  }
  if (!companyId) return false;

  // The endpoint optionally accepts forceCloseReason — for tests we always pass one,
  // it is ignored when there are no audit issues.
  const longReason =
    'E2E seed: closing month for year-end-closing test prerequisite. Audit waived for test fixture.';
  const res = await page.request.post(`${API_URL}/api/expenses/periods/close`, {
    headers: headers(token),
    data: { companyId, year: input.year, month: input.month, forceCloseReason: longReason },
  });
  // 200 = closed now; 409/400 with 'already closed' is fine; 404 = no period to close yet (skip)
  if (res.ok()) return true;
  const text = await res.text().catch(() => '');
  if (/already.?closed|ปิด.?แล้ว/i.test(text)) return true;
  return false;
}

/* ─── Cleanup ─── */

export async function cleanupTestData(page: Page, token: string, ids: SeedIds): Promise<void> {
  // Best-effort delete — ignore failures (record may have been mutated downstream)
  await Promise.allSettled([
    ...ids.payments.map((id) =>
      page.request.delete(`${API_URL}/api/payments/${id}`, { headers: headers(token) }),
    ),
    ...ids.contracts.map((id) =>
      page.request.delete(`${API_URL}/api/contracts/${id}`, { headers: headers(token) }),
    ),
    ...ids.sales.map((id) =>
      page.request.delete(`${API_URL}/api/sales/${id}`, { headers: headers(token) }),
    ),
    ...ids.bookings.map((id) =>
      page.request.delete(`${API_URL}/api/bookings/${id}`, { headers: headers(token) }),
    ),
    ...ids.quotes.map((id) =>
      page.request.delete(`${API_URL}/api/quotes/${id}`, { headers: headers(token) }),
    ),
    ...ids.customers.map((id) =>
      page.request.delete(`${API_URL}/api/customers/${id}`, { headers: headers(token) }),
    ),
  ]);
}
