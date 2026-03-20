import { test, expect, Page } from '@playwright/test';
import { loginWithMock } from './helpers/mock-auth';

// ============================================================================
// BESTCHOICE Contract Detail - Early Payoff Flow (Phase 9)
// Route: /contracts/:id
//
// Tests early payoff quote display and closing workflow:
//   - Early payoff quote display (remaining months, principal, discount)
//   - Click close early → Modal with payment methods
//   - Confirm → POST API
//   - Cancel modal
// ============================================================================

function buildMockContract(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    contractNumber: 'BCP-PAYOFF-001',
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
      { id: 'p1', installmentNo: 1, dueDate: '2026-02-05', amountDue: '1320', amountPaid: '1320', lateFee: '0', status: 'PAID', paidDate: '2026-02-05', paymentMethod: 'CASH' },
      { id: 'p2', installmentNo: 2, dueDate: '2026-03-05', amountDue: '1320', amountPaid: '1320', lateFee: '0', status: 'PAID', paidDate: '2026-03-04', paymentMethod: 'CASH' },
    ],
    signatures: [
      { id: 's1', signerType: 'CUSTOMER', signedAt: '2026-01-15T10:00:00.000Z' },
      { id: 's2', signerType: 'COMPANY', signedAt: '2026-01-15T10:00:00.000Z' },
      { id: 's3', signerType: 'WITNESS_1', signedAt: '2026-01-15T10:00:00.000Z' },
      { id: 's4', signerType: 'WITNESS_2', signedAt: '2026-01-15T10:00:00.000Z' },
    ],
    contractDocuments: [],
    creditCheck: null,
    interestConfig: null,
    ...overrides,
  };
}

const PAYOFF_QUOTE = {
  remainingMonths: 8,
  remainingPrincipal: 9600,
  remainingInterest: 768,
  discount: 384,
  partiallyPaidCredit: 0,
  unpaidLateFees: 0,
  totalPayoff: 9984,
};

async function mockContractWithPayoff(page: Page, contractId: string, overrides: Record<string, unknown> = {}) {
  const contract = buildMockContract(contractId, overrides);

  await page.route(`**/api/contracts/${contractId}`, async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(contract) });
    } else {
      await route.continue();
    }
  });

  await page.route(`**/api/contracts/${contractId}/early-payoff-quote`, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(PAYOFF_QUOTE) });
  });

  await page.route(`**/api/contracts/${contractId}/documents`, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) });
  });

  await page.route(`**/api/contracts/${contractId}/documents/checklist`, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ complete: true, checklist: [] }) });
  });

  await page.route(`**/api/contracts/${contractId}/preview**`, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ html: '<html><body>Preview</body></html>' }) });
  });

  return contract;
}

test.describe('Phase 9: Contract Detail - Early Payoff Flow', () => {
  test.beforeEach(async ({ page }) => {
    await loginWithMock(page);
  });

  // ── 9.1 Early payoff quote section displays for ACTIVE contracts ─────
  test('9.1 Early payoff quote displays remaining months, principal, and discount', async ({ page }) => {
    const contractId = 'test-payoff-001';
    await mockContractWithPayoff(page, contractId);

    await page.goto(`/contracts/${contractId}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);

    // Quote section header
    await expect(page.getByText('ประเมินปิดก่อนกำหนด')).toBeVisible({ timeout: 5000 });

    // Remaining months
    await expect(page.getByText('งวดคงเหลือ')).toBeVisible();
    await expect(page.getByText('8 งวด')).toBeVisible();

    // Remaining principal
    await expect(page.getByText('เงินต้นคงเหลือ')).toBeVisible();
    await expect(page.getByText('9,600 ฿')).toBeVisible();

    // Interest discount
    await expect(page.getByText('ส่วนลดดอกเบี้ย (50%)')).toBeVisible();
    await expect(page.getByText('-384 ฿')).toBeVisible();

    // Total payoff
    await expect(page.getByText('ยอดปิดสัญญา')).toBeVisible();
    await expect(page.getByText('9,984 ฿')).toBeVisible();
  });

  // ── 9.2 Click early payoff opens modal with payment methods ──────────
  test('9.2 Click early payoff button opens modal with payment method selection', async ({ page }) => {
    const contractId = 'test-payoff-002';
    await mockContractWithPayoff(page, contractId);

    await page.goto(`/contracts/${contractId}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);

    // Click the early payoff button
    await page.locator('button:has-text("ปิดก่อนกำหนด")').click();

    // Modal should appear
    await expect(page.getByRole('heading', { name: 'ปิดสัญญาก่อนกำหนด' })).toBeVisible({ timeout: 3000 });

    // Should show total payoff amount
    // Modal content - total payoff amount
    await expect(page.getByText('9,984 ฿').first()).toBeVisible();

    // Payment method dropdown
    await expect(page.locator('label:has-text("วิธีชำระ")')).toBeVisible();
    const select = page.locator('select').last();
    await expect(select).toBeVisible();

    // Should have 3 payment options
    await expect(select.locator('option:has-text("เงินสด")')).toHaveCount(1);
    await expect(select.locator('option:has-text("โอนเงิน")')).toHaveCount(1);
    await expect(select.locator('option:has-text("QR/E-Wallet")')).toHaveCount(1);

    // Cancel and confirm buttons
    await expect(page.locator('button:has-text("ยกเลิก")')).toBeVisible();
    await expect(page.locator('button:has-text("ยืนยันปิดสัญญา")')).toBeVisible();
  });

  // ── 9.3 Confirm early payoff sends POST API ──────────────────────────
  test('9.3 Confirm early payoff sends POST to early-payoff endpoint', async ({ page }) => {
    const contractId = 'test-payoff-003';
    await mockContractWithPayoff(page, contractId);

    // Intercept early payoff POST
    let apiCalled = false;
    let apiBody: Record<string, unknown> = {};
    await page.route(`**/api/contracts/${contractId}/early-payoff`, async (route) => {
      apiCalled = true;
      apiBody = route.request().postDataJSON();
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ ...buildMockContract(contractId), status: 'EARLY_PAYOFF' }),
      });
    });

    await page.goto(`/contracts/${contractId}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);

    // Open modal
    await page.locator('button:has-text("ปิดก่อนกำหนด")').click();
    await expect(page.getByRole('heading', { name: 'ปิดสัญญาก่อนกำหนด' })).toBeVisible({ timeout: 3000 });

    // Select bank transfer
    const select = page.locator('select').last();
    await select.selectOption('BANK_TRANSFER');

    // Confirm
    await page.locator('button:has-text("ยืนยันปิดสัญญา")').click();
    await page.waitForTimeout(2000);

    expect(apiCalled).toBe(true);
    expect(apiBody.paymentMethod).toBe('BANK_TRANSFER');
  });

  // ── 9.4 Cancel early payoff modal ────────────────────────────────────
  test('9.4 Cancel button closes early payoff modal', async ({ page }) => {
    const contractId = 'test-payoff-004';
    await mockContractWithPayoff(page, contractId);

    await page.goto(`/contracts/${contractId}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);

    // Open modal
    await page.locator('button:has-text("ปิดก่อนกำหนด")').click();
    await expect(page.getByRole('heading', { name: 'ปิดสัญญาก่อนกำหนด' })).toBeVisible({ timeout: 3000 });

    // Click cancel
    await page.locator('button:has-text("ยกเลิก")').last().click();

    // Modal should close
    await expect(page.getByRole('heading', { name: 'ปิดสัญญาก่อนกำหนด' })).not.toBeVisible({ timeout: 3000 });
  });

  // ── 9.5 Early payoff quote not shown for DRAFT contracts ──────────────
  test('9.5 Early payoff quote is not shown for DRAFT contracts', async ({ page }) => {
    const contractId = 'test-payoff-005';
    await mockContractWithPayoff(page, contractId, {
      status: 'DRAFT',
      workflowStatus: 'CREATING',
    });

    await page.goto(`/contracts/${contractId}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);

    // Quote section should NOT appear
    await expect(page.getByText('ประเมินปิดก่อนกำหนด')).not.toBeVisible();

    // Early payoff button should NOT appear
    await expect(page.locator('button:has-text("ปิดก่อนกำหนด")')).not.toBeVisible();
  });

  // ── 9.6 Unpaid late fees shown in quote ───────────────────────────────
  test('9.6 Early payoff quote shows unpaid late fees when present', async ({ page }) => {
    const contractId = 'test-payoff-006';

    const contract = buildMockContract(contractId, { status: 'OVERDUE' });
    await page.route(`**/api/contracts/${contractId}`, async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(contract) });
      } else { await route.continue(); }
    });

    await page.route(`**/api/contracts/${contractId}/early-payoff-quote`, async (route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ ...PAYOFF_QUOTE, unpaidLateFees: 500, totalPayoff: 10484 }),
      });
    });

    await page.route(`**/api/contracts/${contractId}/documents`, async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) });
    });

    await page.route(`**/api/contracts/${contractId}/documents/checklist`, async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ complete: true, checklist: [] }) });
    });

    await page.goto(`/contracts/${contractId}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);

    await expect(page.getByText('ค่าปรับค้างชำระ')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('500 ฿')).toBeVisible();
  });
});
