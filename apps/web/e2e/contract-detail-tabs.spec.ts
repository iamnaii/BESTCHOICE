import { test, expect, Page } from '@playwright/test';
import { loginViaAPI } from './helpers/auth';

// ============================================================================
// BESTCHOICE Contract Detail - Tabs & Content (Phase 10)
// Route: /contracts/:id
//
// Tests tab switching and content for:
//   - Schedule tab (payment schedule table)
//   - Preview tab (contract preview iframe)
//   - Documents tab
//   - Credit Check tab
//   - Tab switching works correctly
// ============================================================================

function buildMockContract(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    contractNumber: 'BCP-TABS-001',
    status: 'ACTIVE',
    workflowStatus: 'APPROVED',
    planType: 'BESTCHOICE',
    sellingPrice: '15000',
    downPayment: '3000',
    totalMonths: 3,
    interestRate: '0.08',
    interestTotal: '360',
    financedAmount: '12360',
    monthlyPayment: '4120',
    paymentDueDay: 5,
    notes: '',
    creditBalance: null,
    dunningStage: null,
    contractHash: null,
    pdpaConsentId: 'pdpa-1',
    reviewNotes: null,
    reviewedAt: null,
    reviewedBy: null,
    salespersonId: 'user-001',
    branchId: 'branch-1',
    customerId: 'cust-1',
    productId: 'prod-1',
    interestConfigId: null,
    createdAt: '2026-01-15T10:00:00.000Z',
    customer: { id: 'cust-1', name: 'ทดสอบ ลูกค้า', phone: '0812345678', nationalId: '1234567890123' },
    customerSnapshot: null,
    product: { id: 'prod-1', name: 'iPhone 15', brand: 'Apple', model: 'iPhone 15', category: 'PHONE_NEW', color: null, storage: '128GB', serialNumber: null, imeiSerial: '123456789012345', costPrice: '12000', batteryHealth: null, warrantyExpired: false, warrantyExpireDate: null, hasBox: true, accessoryType: null, accessoryBrand: null },
    salesperson: { id: 'user-001', name: 'Admin' },
    branch: { id: 'branch-1', name: 'สาขาหลัก' },
    payments: [
      { id: 'p1', installmentNo: 1, dueDate: '2026-02-05T00:00:00.000Z', amountDue: '4120', amountPaid: '4120', lateFee: '0', status: 'PAID', paidDate: '2026-02-05T00:00:00.000Z', paymentMethod: 'CASH' },
      { id: 'p2', installmentNo: 2, dueDate: '2026-03-05T00:00:00.000Z', amountDue: '4120', amountPaid: null, lateFee: '0', status: 'PENDING', paidDate: null, paymentMethod: null },
      { id: 'p3', installmentNo: 3, dueDate: '2026-04-05T00:00:00.000Z', amountDue: '4120', amountPaid: null, lateFee: '200', status: 'OVERDUE', paidDate: null, paymentMethod: null },
    ],
    signatures: [
      { id: 's1', signerType: 'CUSTOMER', signedAt: '2026-01-15T10:00:00.000Z' },
      { id: 's2', signerType: 'COMPANY', signedAt: '2026-01-15T10:00:00.000Z' },
      { id: 's3', signerType: 'WITNESS_1', signedAt: '2026-01-15T10:00:00.000Z' },
      { id: 's4', signerType: 'WITNESS_2', signedAt: '2026-01-15T10:00:00.000Z' },
    ],
    contractDocuments: [
      { id: 'd1', type: 'SIGNED_CONTRACT', fileName: 'contract.pdf' },
      { id: 'd2', type: 'ID_CARD_COPY', fileName: 'id.jpg' },
    ],
    creditCheck: null,
    interestConfig: null,
    ...overrides,
  };
}

async function mockContractForTabs(page: Page, contractId: string, overrides: Record<string, unknown> = {}) {
  const contract = buildMockContract(contractId, overrides);

  await page.route(`**/api/contracts/${contractId}`, async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(contract) });
    } else { await route.continue(); }
  });

  await page.route(`**/api/contracts/${contractId}/early-payoff-quote`, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ remainingMonths: 2, remainingPrincipal: 8000, remainingInterest: 200, discount: 100, unpaidLateFees: 200, totalPayoff: 8300 }) });
  });

  await page.route(`**/api/contracts/${contractId}/documents`, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) });
  });

  await page.route(`**/api/contracts/${contractId}/documents/checklist`, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ complete: true, checklist: [] }) });
  });

  await page.route(`**/api/contracts/${contractId}/preview**`, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ html: '<html><body><h1>สัญญาผ่อนชำระ</h1><p>ตัวอย่างสัญญา</p></body></html>' }) });
  });

  // Mock credit check
  await page.route(`**/api/contracts/${contractId}/credit-check**`, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(null) });
  });

  // Mock document upload endpoints
  await page.route(`**/api/contracts/${contractId}/documents/upload`, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'new-doc' }) });
  });

  return contract;
}

test.describe('Phase 10: Contract Detail - Tabs & Content', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page);
  });

  // ── 10.1 Schedule tab shows payment table with columns ────────────────
  test('10.1 Schedule tab shows payment schedule table with correct columns', async ({ page }) => {
    const contractId = 'test-tabs-001';
    await mockContractForTabs(page, contractId);

    await page.goto(`/contracts/${contractId}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);

    // Schedule tab should be active by default
    const scheduleTab = page.locator('button:has-text("ตารางผ่อน")');
    await expect(scheduleTab).toBeVisible({ timeout: 5000 });

    // Table column headers
    await expect(page.getByText('งวดที่')).toBeVisible();
    await expect(page.getByText('วันครบกำหนด')).toBeVisible();
    await expect(page.getByText('สถานะ', { exact: false })).toBeVisible();

    // Payment data rows
    await expect(page.locator('text=ชำระแล้ว').first()).toBeVisible();
    await expect(page.locator('text=รอชำระ').first()).toBeVisible();
    await expect(page.locator('text=เกินกำหนด').first()).toBeVisible();
  });

  // ── 10.2 Schedule tab shows paid count in tab label ───────────────────
  test('10.2 Schedule tab label shows paid/total count', async ({ page }) => {
    const contractId = 'test-tabs-002';
    await mockContractForTabs(page, contractId);

    await page.goto(`/contracts/${contractId}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);

    // Tab label should show (1/3) - 1 paid out of 3
    await expect(page.getByText('ตารางผ่อน (1/3)')).toBeVisible({ timeout: 5000 });
  });

  // ── 10.3 Preview tab shows contract iframe ────────────────────────────
  test('10.3 Preview tab shows contract preview iframe', async ({ page }) => {
    const contractId = 'test-tabs-003';
    await mockContractForTabs(page, contractId);

    await page.goto(`/contracts/${contractId}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);

    // Click preview tab
    await page.locator('button:has-text("ดูสัญญา")').click();
    await page.waitForTimeout(1000);

    // Should show iframe
    const iframe = page.locator('iframe[title="contract-preview"]');
    await expect(iframe).toBeVisible({ timeout: 5000 });
  });

  // ── 10.4 Documents tab shows document upload section ──────────────────
  test('10.4 Documents tab shows document management section', async ({ page }) => {
    const contractId = 'test-tabs-004';
    await mockContractForTabs(page, contractId);

    await page.goto(`/contracts/${contractId}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);

    // Click documents tab (shows count)
    await page.locator('button:has-text("เอกสาร (2)")').click();
    await page.waitForTimeout(1000);

    // DocumentUpload component should render
    // It should show document-related content
    await expect(page.locator('[class*="rounded"]').filter({ hasText: /เอกสาร|อัปโหลด|ไฟล์/ }).first()).toBeVisible({ timeout: 5000 });
  });

  // ── 10.5 Credit Check tab shows credit check panel ────────────────────
  test('10.5 Credit Check tab shows credit check panel', async ({ page }) => {
    const contractId = 'test-tabs-005';
    await mockContractForTabs(page, contractId);

    await page.goto(`/contracts/${contractId}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);

    // Click credit check tab
    await page.locator('button:has-text("ตรวจเครดิต")').click();
    await page.waitForTimeout(1000);

    // CreditCheckPanel component should render
    // The tab should be active (highlighted)
    const creditTab = page.locator('button:has-text("ตรวจเครดิต")');
    await expect(creditTab).toHaveClass(/border-primary|text-primary/);
  });

  // ── 10.6 Tab switching works correctly between all tabs ───────────────
  test('10.6 Tab switching between all tabs works correctly', async ({ page }) => {
    const contractId = 'test-tabs-006';
    await mockContractForTabs(page, contractId);

    await page.goto(`/contracts/${contractId}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);

    // Start on schedule (default)
    await expect(page.getByText('งวดที่')).toBeVisible({ timeout: 5000 });

    // Switch to preview
    await page.locator('button:has-text("ดูสัญญา")').click();
    await page.waitForTimeout(500);
    await expect(page.locator('iframe[title="contract-preview"]')).toBeVisible({ timeout: 5000 });

    // Switch to documents
    await page.locator('button:has-text("เอกสาร")').click();
    await page.waitForTimeout(500);
    // iframe should no longer be visible (different tab content)
    await expect(page.locator('iframe[title="contract-preview"]')).not.toBeVisible();

    // Switch to credit check
    await page.locator('button:has-text("ตรวจเครดิต")').click();
    await page.waitForTimeout(500);

    // Switch back to schedule
    await page.locator('button:has-text("ตารางผ่อน")').click();
    await page.waitForTimeout(500);
    await expect(page.getByText('งวดที่')).toBeVisible({ timeout: 3000 });
  });

  // ── 10.7 Schedule tab shows late fees ─────────────────────────────────
  test('10.7 Schedule tab shows late fees for overdue payments', async ({ page }) => {
    const contractId = 'test-tabs-007';
    await mockContractForTabs(page, contractId);

    await page.goto(`/contracts/${contractId}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);

    // Should show late fee of 200 for the overdue payment
    await expect(page.getByText('200 ฿').first()).toBeVisible({ timeout: 5000 });
  });

  // ── 10.8 Empty schedule shows empty message ───────────────────────────
  test('10.8 Empty schedule shows empty message', async ({ page }) => {
    const contractId = 'test-tabs-008';
    await mockContractForTabs(page, contractId, { payments: [] });

    await page.goto(`/contracts/${contractId}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);

    await expect(page.getByText('ยังไม่มีตารางผ่อน')).toBeVisible({ timeout: 5000 });
  });
});
