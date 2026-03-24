import { test, expect, Page } from '@playwright/test';
import { loginWithMock } from './helpers/mock-auth';

// ============================================================================
// BESTCHOICE Contract Detail - Status Summary Cards (Phase 14)
// Route: /contracts/:id
//
// Tests:
//   - 5 summary cards (Status, Workflow, Monthly, Paid, Total)
//   - Credit Balance card (when balance exists)
//   - Dunning Stage card with 4 levels
// ============================================================================

function buildMockContract(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    contractNumber: 'BCP-SUM-001',
    status: 'ACTIVE',
    workflowStatus: 'APPROVED',
    planType: 'BESTCHOICE',
    sellingPrice: '15000',
    downPayment: '3000',
    totalMonths: 10,
    interestRate: '0.08',
    interestTotal: '1200',
    financedAmount: '13200',
    monthlyPayment: '1320',
    paymentDueDay: 5,
    notes: '',
    creditBalance: null,
    dunningStage: null,
    contractHash: null,
    pdpaConsentId: null,
    reviewNotes: null,
    reviewedAt: null,
    reviewedBy: null,
    salespersonId: 'user-001',
    branchId: 'branch-1',
    customerId: 'cust-1',
    productId: 'prod-1',
    interestConfigId: null,
    createdAt: '2026-01-15T10:00:00.000Z',
    customer: { id: 'cust-1', name: 'ทดสอบ', phone: '0812345678', nationalId: '1234567890123' },
    customerSnapshot: null,
    product: { id: 'prod-1', name: 'iPhone 15', brand: 'Apple', model: 'iPhone 15', category: 'PHONE_NEW', color: null, storage: '128GB', serialNumber: null, imeiSerial: '123456789012345', costPrice: '12000', batteryHealth: null, warrantyExpired: false, warrantyExpireDate: null, hasBox: true, accessoryType: null, accessoryBrand: null },
    salesperson: { id: 'user-001', name: 'Admin' },
    branch: { id: 'branch-1', name: 'สาขาหลัก' },
    payments: [
      { id: 'p1', installmentNo: 1, dueDate: '2026-02-05', amountDue: '1320', amountPaid: '1320', lateFee: '0', status: 'PAID', paidDate: '2026-02-05', paymentMethod: 'CASH' },
      { id: 'p2', installmentNo: 2, dueDate: '2026-03-05', amountDue: '1320', amountPaid: '1320', lateFee: '0', status: 'PAID', paidDate: '2026-03-04', paymentMethod: 'CASH' },
      { id: 'p3', installmentNo: 3, dueDate: '2026-04-05', amountDue: '1320', amountPaid: null, lateFee: '0', status: 'PENDING', paidDate: null, paymentMethod: null },
    ],
    signatures: [],
    contractDocuments: [],
    creditCheck: null,
    interestConfig: null,
    ...overrides,
  };
}

async function mockContractSummary(page: Page, contractId: string, overrides: Record<string, unknown> = {}) {
  const contract = buildMockContract(contractId, overrides);

  await page.route(`**/api/contracts/${contractId}`, async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(contract) });
    } else { await route.continue(); }
  });

  await page.route(`**/api/contracts/${contractId}/early-payoff-quote`, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ remainingMonths: 8, remainingPrincipal: 10000, remainingInterest: 800, discount: 400, unpaidLateFees: 0, totalPayoff: 10400 }) });
  });

  await page.route(`**/api/contracts/${contractId}/documents`, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) });
  });

  await page.route(`**/api/contracts/${contractId}/documents/checklist`, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ complete: true, checklist: [] }) });
  });

  return contract;
}

test.describe('Phase 14: Contract Detail - Status Summary Cards', () => {
  test.beforeEach(async ({ page }) => {
    await loginWithMock(page);
  });

  // ── 14.1 All 5 summary cards display ──────────────────────────────────
  test('14.1 Shows 5 summary cards: Status, Workflow, Monthly, Paid, Total', async ({ page }) => {
    const contractId = 'test-sum-001';
    await mockContractSummary(page, contractId);

    await page.goto(`/contracts/${contractId}`, { waitUntil: 'networkidle' });

    // Card 1: Status
    await expect(page.getByText('สถานะสัญญา')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('ผ่อนอยู่')).toBeVisible();

    // Card 2: Workflow
    await expect(page.getByText('Workflow')).toBeVisible();

    // Card 3: Monthly payment
    await expect(page.getByText('ค่างวด/เดือน')).toBeVisible();
    await expect(page.getByText('1,320 ฿').first()).toBeVisible();

    // Card 4: Paid count
    await expect(page.getByText('ชำระแล้ว').first()).toBeVisible();
    await expect(page.getByText('2/10 งวด')).toBeVisible();

    // Card 5: Total financed
    await expect(page.getByText('ยอดผ่อนรวม')).toBeVisible();
    await expect(page.getByText('13,200 ฿').first()).toBeVisible();
  });

  // ── 14.2 Status labels for different statuses ─────────────────────────
  test('14.2 Status card shows correct Thai label for OVERDUE status', async ({ page }) => {
    const contractId = 'test-sum-002';
    await mockContractSummary(page, contractId, { status: 'OVERDUE' });

    await page.goto(`/contracts/${contractId}`, { waitUntil: 'networkidle' });

    await expect(page.getByText('ค้างชำระ')).toBeVisible({ timeout: 5000 });
  });

  test('14.2b Status card shows correct Thai label for DEFAULT status', async ({ page }) => {
    const contractId = 'test-sum-002b';
    await mockContractSummary(page, contractId, { status: 'DEFAULT' });

    await page.goto(`/contracts/${contractId}`, { waitUntil: 'networkidle' });

    await expect(page.getByText('ผิดนัด')).toBeVisible({ timeout: 5000 });
  });

  test('14.2c Status card shows correct Thai label for COMPLETED status', async ({ page }) => {
    const contractId = 'test-sum-002c';
    await mockContractSummary(page, contractId, { status: 'COMPLETED' });

    await page.goto(`/contracts/${contractId}`, { waitUntil: 'networkidle' });

    await expect(page.getByText('ครบ', { exact: true }).first()).toBeVisible({ timeout: 5000 });
  });

  test('14.2d Status card shows correct Thai label for EARLY_PAYOFF status', async ({ page }) => {
    const contractId = 'test-sum-002d';
    await mockContractSummary(page, contractId, { status: 'EARLY_PAYOFF' });

    await page.goto(`/contracts/${contractId}`, { waitUntil: 'networkidle' });

    await expect(page.getByText('ปิดก่อน')).toBeVisible({ timeout: 5000 });
  });

  // ── 14.3 Credit Balance card appears when balance > 0 ─────────────────
  test('14.3 Credit Balance card appears with positive balance', async ({ page }) => {
    const contractId = 'test-sum-003';
    await mockContractSummary(page, contractId, { creditBalance: '2500' });

    await page.goto(`/contracts/${contractId}`, { waitUntil: 'networkidle' });

    await expect(page.getByText('ยอดเครดิตคงเหลือ')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('2,500 ฿')).toBeVisible();
  });

  // ── 14.4 Credit Balance card hidden when balance is 0 ─────────────────
  test('14.4 Credit Balance card hidden when balance is zero', async ({ page }) => {
    const contractId = 'test-sum-004';
    await mockContractSummary(page, contractId, { creditBalance: '0' });

    await page.goto(`/contracts/${contractId}`, { waitUntil: 'networkidle' });

    await expect(page.getByText('ยอดเครดิตคงเหลือ')).not.toBeVisible();
  });

  // ── 14.5 Dunning stage REMINDER shows ──────────────────────────────────
  test('14.5 Dunning REMINDER card shows yellow indicator', async ({ page }) => {
    const contractId = 'test-sum-005';
    await mockContractSummary(page, contractId, {
      dunningStage: 'REMINDER', status: 'OVERDUE',
    });

    await page.goto(`/contracts/${contractId}`, { waitUntil: 'networkidle' });

    await expect(page.getByText('ระดับติดตามหนี้')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('แจ้งเตือน')).toBeVisible();
  });

  // ── 14.6 Dunning stage NOTICE ─────────────────────────────────────────
  test('14.6 Dunning NOTICE card shows orange indicator', async ({ page }) => {
    const contractId = 'test-sum-006';
    await mockContractSummary(page, contractId, {
      dunningStage: 'NOTICE', status: 'OVERDUE',
    });

    await page.goto(`/contracts/${contractId}`, { waitUntil: 'networkidle' });

    await expect(page.getByText('แจ้งค้างชำระ')).toBeVisible({ timeout: 5000 });
  });

  // ── 14.7 Dunning stage FINAL_WARNING ──────────────────────────────────
  test('14.7 Dunning FINAL_WARNING card shows red indicator', async ({ page }) => {
    const contractId = 'test-sum-007';
    await mockContractSummary(page, contractId, {
      dunningStage: 'FINAL_WARNING', status: 'DEFAULT',
    });

    await page.goto(`/contracts/${contractId}`, { waitUntil: 'networkidle' });

    await expect(page.getByText('เตือนครั้งสุดท้าย')).toBeVisible({ timeout: 5000 });
  });

  // ── 14.8 Dunning stage LEGAL_ACTION ───────────────────────────────────
  test('14.8 Dunning LEGAL_ACTION card shows severe red indicator', async ({ page }) => {
    const contractId = 'test-sum-008';
    await mockContractSummary(page, contractId, {
      dunningStage: 'LEGAL_ACTION', status: 'DEFAULT',
    });

    await page.goto(`/contracts/${contractId}`, { waitUntil: 'networkidle' });

    await expect(page.getByText('ดำเนินคดี')).toBeVisible({ timeout: 5000 });
  });

  // ── 14.9 Dunning stage NONE is hidden ─────────────────────────────────
  test('14.9 Dunning stage card is hidden when dunningStage is NONE', async ({ page }) => {
    const contractId = 'test-sum-009';
    await mockContractSummary(page, contractId, { dunningStage: 'NONE' });

    await page.goto(`/contracts/${contractId}`, { waitUntil: 'networkidle' });

    await expect(page.getByText('ระดับติดตามหนี้')).not.toBeVisible();
  });

  // ── 14.10 Paid count updates with payment data ────────────────────────
  test('14.10 Paid count shows correct X/Y based on payment statuses', async ({ page }) => {
    const contractId = 'test-sum-010';
    await mockContractSummary(page, contractId, {
      totalMonths: 6,
      payments: [
        { id: 'p1', installmentNo: 1, dueDate: '2026-02-05', amountDue: '1320', amountPaid: '1320', lateFee: '0', status: 'PAID', paidDate: '2026-02-05', paymentMethod: 'CASH' },
        { id: 'p2', installmentNo: 2, dueDate: '2026-03-05', amountDue: '1320', amountPaid: '1320', lateFee: '0', status: 'PAID', paidDate: '2026-03-04', paymentMethod: 'CASH' },
        { id: 'p3', installmentNo: 3, dueDate: '2026-04-05', amountDue: '1320', amountPaid: '1320', lateFee: '0', status: 'PAID', paidDate: '2026-04-03', paymentMethod: 'CASH' },
        { id: 'p4', installmentNo: 4, dueDate: '2026-05-05', amountDue: '1320', amountPaid: null, lateFee: '0', status: 'PENDING', paidDate: null, paymentMethod: null },
      ],
    });

    await page.goto(`/contracts/${contractId}`, { waitUntil: 'networkidle' });

    await expect(page.getByText('3/6 งวด')).toBeVisible({ timeout: 5000 });
  });
});
