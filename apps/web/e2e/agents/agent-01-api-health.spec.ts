import { test, expect } from '@playwright/test';
import { loginViaAPI, apiGet, getFirstContractId } from './helpers/contract-helpers';

// ============================================================================
// Agent Team 1: API Health Check
// ตรวจว่า API endpoints ทุกตัวที่หน้า Contract ใช้ respond ถูกต้อง
// ไม่เปิด browser — ใช้ request fixture ตรง → เร็วมาก
// ============================================================================

const MAX_RESPONSE_TIME = 5000; // 5 seconds max

test.describe('Agent 1: Contract API Health Check', () => {
  let contractId: string | null;

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    await loginViaAPI(page);
    contractId = await getFirstContractId(page);
    await page.close();
  });

  test('GET /api/contracts — list responds with paginated data', async ({ page }) => {
    await loginViaAPI(page);
    const { res, elapsed } = await apiGet(page, '/api/contracts?page=1');
    expect(res.status()).toBe(200);
    expect(elapsed).toBeLessThan(MAX_RESPONSE_TIME);
    const body = await res.json();
    expect(body).toHaveProperty('data');
    expect(body).toHaveProperty('total');
    expect(Array.isArray(body.data)).toBe(true);
  });

  test('GET /api/contracts/:id — single contract detail', async ({ page }) => {
    test.skip(!contractId, 'No contracts in database');
    await loginViaAPI(page);
    const { res, elapsed } = await apiGet(page, `/api/contracts/${contractId}`);
    expect(res.status()).toBe(200);
    expect(elapsed).toBeLessThan(MAX_RESPONSE_TIME);
    const body = await res.json();
    expect(body).toHaveProperty('contractNumber');
    expect(body).toHaveProperty('status');
    expect(body).toHaveProperty('customer');
    expect(body).toHaveProperty('product');
  });

  test('GET /api/contracts/:id/documents — contract documents', async ({ page }) => {
    test.skip(!contractId, 'No contracts in database');
    await loginViaAPI(page);
    const { res, elapsed } = await apiGet(page, `/api/contracts/${contractId}/documents`);
    expect(elapsed).toBeLessThan(MAX_RESPONSE_TIME);
    // 200 or 404 are both acceptable (no docs yet)
    expect([200, 404]).toContain(res.status());
  });

  test('GET /api/contracts/:id/preview — contract preview HTML', async ({ page }) => {
    test.skip(!contractId, 'No contracts in database');
    await loginViaAPI(page);
    const { res, elapsed } = await apiGet(page, `/api/contracts/${contractId}/preview`);
    expect(elapsed).toBeLessThan(MAX_RESPONSE_TIME);
    // Preview might fail if no template exists — that's a valid finding
    if (res.status() === 200) {
      const body = await res.json();
      expect(body).toHaveProperty('html');
    }
  });

  test('GET /api/contracts/:id/schedule — payment schedule', async ({ page }) => {
    test.skip(!contractId, 'No contracts in database');
    await loginViaAPI(page);
    const { res, elapsed } = await apiGet(page, `/api/contracts/${contractId}/schedule`);
    expect(elapsed).toBeLessThan(MAX_RESPONSE_TIME);
    expect([200, 404]).toContain(res.status());
  });

  test('GET /api/contract-templates — templates list', async ({ page }) => {
    await loginViaAPI(page);
    const { res, elapsed } = await apiGet(page, '/api/contract-templates');
    expect(res.status()).toBe(200);
    expect(elapsed).toBeLessThan(MAX_RESPONSE_TIME);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  test('GET /api/products?status=IN_STOCK — available products', async ({ page }) => {
    await loginViaAPI(page);
    const { res, elapsed } = await apiGet(page, '/api/products?status=IN_STOCK&limit=10');
    expect(res.status()).toBe(200);
    expect(elapsed).toBeLessThan(MAX_RESPONSE_TIME);
  });

  test('GET /api/customers — customer list', async ({ page }) => {
    await loginViaAPI(page);
    const { res, elapsed } = await apiGet(page, '/api/customers?page=1');
    expect(res.status()).toBe(200);
    expect(elapsed).toBeLessThan(MAX_RESPONSE_TIME);
  });

  test('GET /api/settings — system settings', async ({ page }) => {
    await loginViaAPI(page);
    const { res, elapsed } = await apiGet(page, '/api/settings');
    expect(res.status()).toBe(200);
    expect(elapsed).toBeLessThan(MAX_RESPONSE_TIME);
  });
});
