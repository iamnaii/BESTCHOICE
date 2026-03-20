import { test, expect, Page } from '@playwright/test';
import { loginWithMock } from './helpers/mock-auth';

// ============================================================================
// BESTCHOICE Contracts List - Table & Navigation (Phase 13)
// Route: /contracts
//
// Tests:
//   - Table columns display correctly
//   - Click contract number → navigate to detail
//   - Pagination works
//   - Empty state + Error state + Retry
// ============================================================================

function buildContractItem(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    contractNumber: `BCP-${id.padStart(4, '0')}`,
    status: 'ACTIVE',
    workflowStatus: 'APPROVED',
    sellingPrice: '15000',
    downPayment: '3000',
    monthlyPayment: '1320',
    totalMonths: 10,
    paymentDueDay: 5,
    createdAt: '2026-01-15T10:00:00.000Z',
    customer: { id: `cust-${id}`, name: `ลูกค้า ${id}`, phone: `08${id}1234567`.slice(0, 10) },
    product: { id: `prod-${id}`, name: 'iPhone 15', brand: 'Apple', model: 'iPhone 15', category: 'PHONE_NEW' },
    branch: { id: 'branch-1', name: 'สาขาหลัก' },
    salesperson: { id: 'user-001', name: 'Admin' },
    reviewedBy: null,
    signatures: [{ signerType: 'CUSTOMER' }, { signerType: 'COMPANY' }],
    _count: { payments: 2, contractDocuments: 3 },
    ...overrides,
  };
}

async function mockContractsListPaginated(page: Page, options: { totalItems?: number; currentPage?: number; pageSize?: number; errorMode?: boolean } = {}) {
  const { totalItems = 25, currentPage = 1, pageSize = 10, errorMode = false } = options;

  await page.route('**/api/contracts?*', async (route) => {
    if (errorMode) {
      await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'Internal Server Error' }) });
      return;
    }

    const url = new URL(route.request().url());
    const requestedPage = parseInt(url.searchParams.get('page') || '1', 10);

    const totalPages = Math.ceil(totalItems / pageSize);
    const startIdx = (requestedPage - 1) * pageSize;
    const endIdx = Math.min(startIdx + pageSize, totalItems);

    const data = [];
    for (let i = startIdx; i < endIdx; i++) {
      data.push(buildContractItem(String(i + 1)));
    }

    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        data,
        total: totalItems,
        page: requestedPage,
        totalPages,
      }),
    });
  });
}

test.describe('Phase 13: Contracts List - Table & Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await loginWithMock(page);
  });

  // ── 13.1 Table displays all expected columns ──────────────────────────
  test('13.1 Contracts table shows all expected column headers', async ({ page }) => {
    await mockContractsListPaginated(page, { totalItems: 3 });

    await page.goto('/contracts', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);

    // Column headers
    await expect(page.getByText('เลขสัญญา')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('ลูกค้า', { exact: true })).toBeVisible();
    await expect(page.getByText('สินค้า')).toBeVisible();
    await expect(page.getByText('Workflow', { exact: true })).toBeVisible();
    await expect(page.getByText('ลงนาม')).toBeVisible();
    await expect(page.getByText('สถานะ', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('ค่างวด')).toBeVisible();
    await expect(page.getByText('พนักงาน')).toBeVisible();
  });

  // ── 13.2 Table shows contract data correctly ──────────────────────────
  test('13.2 Table rows show correct contract data', async ({ page }) => {
    await mockContractsListPaginated(page, { totalItems: 3 });

    await page.goto('/contracts', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);

    // Contract numbers
    await expect(page.getByText('BCP-0001')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('BCP-0002')).toBeVisible();
    await expect(page.getByText('BCP-0003')).toBeVisible();

    // Customer name
    await expect(page.getByText('ลูกค้า 1')).toBeVisible();

    // Product info
    await expect(page.locator('text=Apple iPhone 15').first()).toBeVisible();

    // Monthly payment
    await expect(page.locator('text=1,320 ฿').first()).toBeVisible();

    // Signature count (2/4)
    await expect(page.locator('text=2/4').first()).toBeVisible();
  });

  // ── 13.3 Click contract number navigates to detail ────────────────────
  test('13.3 Click contract number navigates to detail page', async ({ page }) => {
    await mockContractsListPaginated(page, { totalItems: 3 });

    // Mock the detail page for contract 1
    await page.route('**/api/contracts/1', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200, contentType: 'application/json',
          body: JSON.stringify({
            ...buildContractItem('1'),
            interestTotal: '1200', financedAmount: '13200', interestRate: '0.08',
            notes: '', creditBalance: null, dunningStage: null, contractHash: null,
            pdpaConsentId: null, reviewNotes: null, reviewedAt: null,
            customerSnapshot: null, creditCheck: null, interestConfig: null,
            payments: [], contractDocuments: [],
          }),
        });
      } else { await route.continue(); }
    });

    await page.route('**/api/contracts/1/documents', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) });
    });

    await page.route('**/api/contracts/1/documents/checklist', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ complete: true, checklist: [] }) });
    });

    await page.goto('/contracts', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);

    // Click the first contract number link
    await page.locator('a:has-text("BCP-0001")').click();
    await page.waitForURL('**/contracts/1', { timeout: 5000 });
  });

  // ── 13.4 Pagination works ─────────────────────────────────────────────
  test('13.4 Pagination navigates between pages', async ({ page }) => {
    await mockContractsListPaginated(page, { totalItems: 25 });

    await page.goto('/contracts', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);

    // Should show page 1 data
    await expect(page.getByText('BCP-0001')).toBeVisible({ timeout: 5000 });

    // Find pagination - look for next page button or page 2
    const nextBtn = page.locator('button:has-text("ถัดไป"), button:has-text("Next"), button:has-text(">"), button:has-text("2")').first();
    if (await nextBtn.isVisible()) {
      await nextBtn.click();
      await page.waitForTimeout(1500);

      // Should now show different contracts (page 2)
      // URL should reflect page change
      expect(page.url()).toContain('page=2');
    }
  });

  // ── 13.5 Empty state shows message ────────────────────────────────────
  test('13.5 Empty state shows ยังไม่มีสัญญา message', async ({ page }) => {
    await mockContractsListPaginated(page, { totalItems: 0 });

    await page.goto('/contracts', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);

    await expect(page.getByText('ยังไม่มีสัญญา')).toBeVisible({ timeout: 5000 });
  });

  // ── 13.6 Error state shows retry button ───────────────────────────────
  test('13.6 Error state shows error message with retry button', async ({ page }) => {
    await mockContractsListPaginated(page, { errorMode: true });

    await page.goto('/contracts', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    // Error message
    await expect(page.getByText('เกิดข้อผิดพลาด')).toBeVisible({ timeout: 5000 });

    // Retry button
    await expect(page.locator('button:has-text("ลองใหม่")')).toBeVisible();
  });

  // ── 13.7 Retry button refetches data ──────────────────────────────────
  test('13.7 Retry button refetches contract data', async ({ page }) => {
    let shouldFail = true;
    await page.route('**/api/contracts?*', async (route) => {
      if (shouldFail) {
        await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'Error' }) });
      } else {
        await route.fulfill({
          status: 200, contentType: 'application/json',
          body: JSON.stringify({ data: [buildContractItem('1')], total: 1, page: 1, totalPages: 1 }),
        });
      }
    });

    await page.goto('/contracts', { waitUntil: 'domcontentloaded' });

    // Wait for react-query to exhaust retries and show error (may take up to 15s)
    await expect(page.getByText('เกิดข้อผิดพลาด')).toBeVisible({ timeout: 20000 });

    // Now switch to success mode and retry
    shouldFail = false;
    await page.locator('button:has-text("ลองใหม่")').click();

    // Should now show data
    await expect(page.getByText('BCP-0001')).toBeVisible({ timeout: 10000 });
  });

  // ── 13.8 Signatures column shows ครบ when all 4 signed ────────────────
  test('13.8 Signatures column shows ครบ (4/4) when all signed', async ({ page }) => {
    await page.route('**/api/contracts?*', async (route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({
          data: [buildContractItem('1', {
            signatures: [
              { signerType: 'CUSTOMER' }, { signerType: 'COMPANY' },
              { signerType: 'WITNESS_1' }, { signerType: 'WITNESS_2' },
            ],
          })],
          total: 1, page: 1, totalPages: 1,
        }),
      });
    });

    await page.goto('/contracts', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);

    await expect(page.getByText('ครบ (4/4)')).toBeVisible({ timeout: 5000 });
  });

  // ── 13.9 Product category badge shows correctly ───────────────────────
  test('13.9 Product category badge shows มือ1 for PHONE_NEW', async ({ page }) => {
    await mockContractsListPaginated(page, { totalItems: 3 });

    await page.goto('/contracts', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);

    await expect(page.locator('text=มือ1').first()).toBeVisible({ timeout: 5000 });
  });
});
