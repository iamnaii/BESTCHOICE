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
  // NOTE: `payments` and `sales` intentionally omitted — those modules expose
  // no `DELETE /:id` endpoint (audit-trail by design). Records created during
  // tests stay in the dev DB; rely on `e2e-flow-` notes/prefix + manual
  // cleanup when seeding flows that produce them.
}

export function newSeedIds(): SeedIds {
  return {
    customers: [],
    products: [],
    bookings: [],
    quotes: [],
    contracts: [],
  };
}

/**
 * Unique-per-run suffix so seeded names never collide on retry.
 *
 * Uses `Date.now()` (monotonically increasing in ms) for ordering plus a
 * crypto-random tail to avoid collisions when two specs seed in the same ms.
 */
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
  // 13 digit national ID — Thai checksum isn't enforced for the dev seed.
  // Using `Date.now().toString().slice(-13)` is fine for E2E because tests do
  // not share customer rows and Date.now() is monotonic at ms resolution.
  const nationalId = input.nationalId ?? Date.now().toString().padStart(13, '9').slice(-13);
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

/* ─── Cleanup ─── */

/**
 * Best-effort cleanup of test data via DELETE endpoints.
 *
 * Only entities with a real `DELETE /:id` route are processed:
 *   - customers    — DELETE /api/customers/:id     (OWNER)
 *   - products     — DELETE /api/products/:id      (OWNER, BRANCH_MANAGER)
 *   - bookings     — DELETE /api/bookings/:id      (OWNER, BRANCH_MANAGER)
 *   - quotes       — DELETE /api/quotes/:id        (OWNER, BRANCH_MANAGER, SALES)
 *   - contracts    — DELETE /api/contracts/:id     (OWNER only)
 *
 * `payments` and `sales` are NOT cleaned up here — those modules expose no
 * DELETE route (audit-trail by design). Must pass an OWNER token so every
 * delete has permission to run.
 *
 * Logs a warning when delete returns non-2xx / non-404 (404 is fine — caller
 * may have rolled back the record). Failures do not throw — they're best-effort.
 */
export async function cleanupTestData(page: Page, token: string, ids: SeedIds): Promise<void> {
  const tasks: Array<{ entity: string; id: string; url: string }> = [];
  // Order matters loosely: child records first so FK constraints don't bite.
  // contracts → bookings → quotes → products → customers
  for (const id of ids.contracts) {
    tasks.push({ entity: 'contracts', id, url: `${API_URL}/api/contracts/${id}` });
  }
  for (const id of ids.bookings) {
    tasks.push({ entity: 'bookings', id, url: `${API_URL}/api/bookings/${id}` });
  }
  for (const id of ids.quotes) {
    tasks.push({ entity: 'quotes', id, url: `${API_URL}/api/quotes/${id}` });
  }
  for (const id of ids.products) {
    tasks.push({ entity: 'products', id, url: `${API_URL}/api/products/${id}` });
  }
  for (const id of ids.customers) {
    tasks.push({ entity: 'customers', id, url: `${API_URL}/api/customers/${id}` });
  }

  const results = await Promise.allSettled(
    tasks.map((t) => page.request.delete(t.url, { headers: headers(token) })),
  );

  results.forEach((r, idx) => {
    const t = tasks[idx];
    if (r.status === 'rejected') {
      // eslint-disable-next-line no-console
      console.warn(`[cleanupTestData] DELETE ${t.entity}/${t.id} threw:`, r.reason);
      return;
    }
    const status = r.value.status();
    if (status >= 200 && status < 300) return; // success
    if (status === 404) return; // already gone — fine
    // eslint-disable-next-line no-console
    console.warn(`[cleanupTestData] DELETE ${t.entity}/${t.id} → HTTP ${status} (not cleaned)`);
  });
}
