import { Page } from '@playwright/test';

/**
 * API utility helpers for E2E tests.
 * Provides direct API access for setup/teardown/verification.
 */

const API_URL = process.env.API_DIRECT_URL || 'http://localhost:3000';

/** Standard headers for API calls */
function headers(token: string) {
  return {
    'X-Requested-With': 'XMLHttpRequest',
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

/** Get a fresh token via API login */
export async function getApiToken(page: Page, email = 'admin@bestchoice.com', password = 'admin1234'): Promise<string> {
  const res = await page.request.post(`${API_URL}/api/auth/login`, {
    data: { email, password },
    headers: { 'X-Requested-With': 'XMLHttpRequest' },
  });
  if (!res.ok()) throw new Error(`Login failed: ${res.status()}`);
  const data = await res.json();
  return data.accessToken;
}

/* ─── Customer CRUD ─── */

export async function createCustomer(page: Page, token: string, data: {
  firstName: string; lastName: string; nationalId: string; phone: string;
  nickname?: string; email?: string;
}) {
  const res = await page.request.post(`${API_URL}/api/customers`, {
    data,
    headers: headers(token),
  });
  if (!res.ok()) {
    const body = await res.text();
    throw new Error(`Create customer failed (${res.status()}): ${body}`);
  }
  return res.json();
}

export async function deleteCustomer(page: Page, token: string, id: string) {
  const res = await page.request.delete(`${API_URL}/api/customers/${id}`, {
    headers: headers(token),
  });
  // Soft delete may return 200 or 204; 404 is ok if already deleted
  return res.ok() || res.status() === 404;
}

export async function searchCustomers(page: Page, token: string, search: string) {
  const res = await page.request.get(`${API_URL}/api/customers?search=${encodeURIComponent(search)}&limit=5`, {
    headers: headers(token),
  });
  if (!res.ok()) return { data: [], total: 0 };
  return res.json();
}

/* ─── Expense CRUD ─── */

export async function createExpense(page: Page, token: string, data: {
  branchId: string; accountType: string; category: string;
  description: string; amount: string; expenseDate: string;
}) {
  const res = await page.request.post(`${API_URL}/api/expenses`, {
    data: { ...data, vatAmount: '0', withholdingTax: '0' },
    headers: headers(token),
  });
  if (!res.ok()) {
    const body = await res.text();
    throw new Error(`Create expense failed (${res.status()}): ${body}`);
  }
  return res.json();
}

export async function deleteExpense(page: Page, token: string, id: string) {
  const res = await page.request.delete(`${API_URL}/api/expenses/${id}`, {
    headers: headers(token),
  });
  return res.ok() || res.status() === 404;
}

/* ─── Branch helpers ─── */

export async function getBranches(page: Page, token: string) {
  const res = await page.request.get(`${API_URL}/api/branches`, {
    headers: headers(token),
  });
  if (!res.ok()) return [];
  const data = await res.json();
  return Array.isArray(data) ? data : data.data || [];
}

/* ─── Supplier CRUD ─── */

export async function createSupplier(page: Page, token: string, data: {
  name: string; contactName: string; phone: string;
}) {
  const res = await page.request.post(`${API_URL}/api/suppliers`, {
    data,
    headers: headers(token),
  });
  if (!res.ok()) {
    const body = await res.text();
    throw new Error(`Create supplier failed (${res.status()}): ${body}`);
  }
  return res.json();
}

export async function deleteSupplier(page: Page, token: string, id: string) {
  const res = await page.request.delete(`${API_URL}/api/suppliers/${id}`, {
    headers: headers(token),
  });
  return res.ok() || res.status() === 404;
}

/* ─── Product helpers ─── */

export async function getProducts(page: Page, token: string, status = 'IN_STOCK') {
  const res = await page.request.get(`${API_URL}/api/products?status=${status}&limit=5`, {
    headers: headers(token),
  });
  if (!res.ok()) return { data: [], total: 0 };
  return res.json();
}
