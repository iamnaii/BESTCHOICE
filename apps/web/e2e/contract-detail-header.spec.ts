import { test, expect, Page } from '@playwright/test';
import { loginViaAPI } from './helpers/auth';

// ============================================================================
// BESTCHOICE Contract Detail - Header Actions & Edge Cases (Phase 15)
// Route: /contracts/:id
//
// Tests:
//   - Header buttons: ลงนาม/เอกสาร, พิมพ์สัญญา, กลับ
//   - Conditional buttons based on status (เปิดใช้งาน, ปิดก่อนกำหนด, ส่งลิงก์)
//   - Mobile responsive layout
//   - Loading state
// ============================================================================

function buildMockContract(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    contractNumber: 'BCP-HDR-001',
    status: 'DRAFT',
    workflowStatus: 'CREATING',
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
    payments: [],
    signatures: [],
    contractDocuments: [],
    creditCheck: null,
    interestConfig: null,
    ...overrides,
  };
}

async function mockContractHeader(page: Page, contractId: string, overrides: Record<string, unknown> = {}) {
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

  await page.route(`**/api/contracts/${contractId}/preview**`, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ html: '<html><body>Preview</body></html>' }) });
  });

  return contract;
}

test.describe('Phase 15: Contract Detail - Header Actions & Edge Cases', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page);
  });

  // ── 15.1 Header shows ลงนาม/เอกสาร and พิมพ์สัญญา buttons ──────────
  test('15.1 Header shows ลงนาม/เอกสาร and พิมพ์สัญญา buttons always', async ({ page }) => {
    const contractId = 'test-hdr-001';
    await mockContractHeader(page, contractId);

    await page.goto(`/contracts/${contractId}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);

    await expect(page.locator('button:has-text("ลงนาม/เอกสาร")')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('button:has-text("พิมพ์สัญญา")')).toBeVisible();
    await expect(page.locator('button:has-text("กลับ")')).toBeVisible();
  });

  // ── 15.2 ลงนาม/เอกสาร navigates to sign page ────────────────────────
  test('15.2 ลงนาม/เอกสาร button navigates to sign page', async ({ page }) => {
    const contractId = 'test-hdr-002';
    await mockContractHeader(page, contractId);

    await page.goto(`/contracts/${contractId}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);

    await page.locator('button:has-text("ลงนาม/เอกสาร")').click();
    await page.waitForURL(`**/contracts/${contractId}/sign`, { timeout: 5000 });
  });

  // ── 15.3 กลับ button navigates to contracts list ─────────────────────
  test('15.3 กลับ button navigates back to contracts list', async ({ page }) => {
    const contractId = 'test-hdr-003';
    await mockContractHeader(page, contractId);

    // Mock contracts list for navigation target
    await page.route('**/api/contracts?*', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [], total: 0, page: 1, totalPages: 0 }) });
    });

    await page.goto(`/contracts/${contractId}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);

    await page.locator('button:has-text("กลับ")').click();
    await page.waitForURL('**/contracts', { timeout: 5000 });
  });

  // ── 15.4 เปิดใช้งานสัญญา button for APPROVED + DRAFT (all signed) ────
  test('15.4 Activate button visible for APPROVED DRAFT contract with all signatures', async ({ page }) => {
    const contractId = 'test-hdr-004';
    await mockContractHeader(page, contractId, {
      status: 'DRAFT',
      workflowStatus: 'APPROVED',
      signatures: [
        { id: 's1', signerType: 'CUSTOMER', signedAt: '2026-01-15T10:00:00.000Z' },
        { id: 's2', signerType: 'COMPANY', signedAt: '2026-01-15T10:00:00.000Z' },
        { id: 's3', signerType: 'WITNESS_1', signedAt: '2026-01-15T10:00:00.000Z' },
        { id: 's4', signerType: 'WITNESS_2', signedAt: '2026-01-15T10:00:00.000Z' },
      ],
    });

    await page.goto(`/contracts/${contractId}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);

    const activateBtn = page.locator('button:has-text("เปิดใช้งานสัญญา")');
    await expect(activateBtn).toBeVisible({ timeout: 5000 });
    await expect(activateBtn).toBeEnabled();
  });

  // ── 15.5 Activate button disabled without all signatures ──────────────
  test('15.5 Activate button disabled when not all signatures present', async ({ page }) => {
    const contractId = 'test-hdr-005';
    await mockContractHeader(page, contractId, {
      status: 'DRAFT',
      workflowStatus: 'APPROVED',
      signatures: [
        { id: 's1', signerType: 'CUSTOMER', signedAt: '2026-01-15T10:00:00.000Z' },
      ],
    });

    await page.goto(`/contracts/${contractId}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);

    const activateBtn = page.locator('button:has-text("เปิดใช้งานสัญญา")');
    await expect(activateBtn).toBeVisible({ timeout: 5000 });
    await expect(activateBtn).toBeDisabled();
  });

  // ── 15.6 ปิดก่อนกำหนด button for ACTIVE contracts ────────────────────
  test('15.6 Early payoff button visible for ACTIVE contracts', async ({ page }) => {
    const contractId = 'test-hdr-006';
    await mockContractHeader(page, contractId, { status: 'ACTIVE', workflowStatus: 'APPROVED' });

    await page.goto(`/contracts/${contractId}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);

    await expect(page.locator('button:has-text("ปิดก่อนกำหนด")')).toBeVisible({ timeout: 5000 });
  });

  // ── 15.7 ปิดก่อนกำหนด button hidden for DRAFT contracts ──────────────
  test('15.7 Early payoff button hidden for DRAFT contracts', async ({ page }) => {
    const contractId = 'test-hdr-007';
    await mockContractHeader(page, contractId, { status: 'DRAFT', workflowStatus: 'CREATING' });

    await page.goto(`/contracts/${contractId}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);

    await expect(page.locator('button:has-text("ปิดก่อนกำหนด")')).not.toBeVisible();
  });

  // ── 15.8 ส่งลิงก์ลูกค้า button for ACTIVE/OVERDUE/COMPLETED ──────────
  test('15.8 Customer link button visible for ACTIVE contracts', async ({ page }) => {
    const contractId = 'test-hdr-008';
    await mockContractHeader(page, contractId, { status: 'ACTIVE', workflowStatus: 'APPROVED' });

    await page.goto(`/contracts/${contractId}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);

    await expect(page.locator('button:has-text("ส่งลิงก์ลูกค้า")')).toBeVisible({ timeout: 5000 });
  });

  // ── 15.9 ส่งลิงก์ลูกค้า hidden for DRAFT contracts ───────────────────
  test('15.9 Customer link button hidden for DRAFT contracts', async ({ page }) => {
    const contractId = 'test-hdr-009';
    await mockContractHeader(page, contractId, { status: 'DRAFT', workflowStatus: 'CREATING' });

    await page.goto(`/contracts/${contractId}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);

    await expect(page.locator('button:has-text("ส่งลิงก์ลูกค้า")')).not.toBeVisible();
  });

  // ── 15.10 Delete button for OWNER + CREATING ──────────────────────────
  test('15.10 Delete button visible for OWNER with CREATING workflow', async ({ page }) => {
    const contractId = 'test-hdr-010';
    await mockContractHeader(page, contractId, {
      status: 'DRAFT',
      workflowStatus: 'CREATING',
      salespersonId: 'user-001',
    });

    await page.goto(`/contracts/${contractId}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);

    await expect(page.locator('button:has-text("ลบสัญญา")')).toBeVisible({ timeout: 5000 });
  });

  // ── 15.11 Delete button for REJECTED workflow ─────────────────────────
  test('15.11 Delete button visible for OWNER with REJECTED workflow', async ({ page }) => {
    const contractId = 'test-hdr-011';
    await mockContractHeader(page, contractId, {
      status: 'DRAFT',
      workflowStatus: 'REJECTED',
      salespersonId: 'user-001',
      reviewNotes: 'ข้อมูลไม่ครบ',
    });

    await page.goto(`/contracts/${contractId}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);

    await expect(page.locator('button:has-text("ลบสัญญา")')).toBeVisible({ timeout: 5000 });
  });

  // ── 15.12 Mobile responsive - buttons wrap correctly ──────────────────
  test('15.12 Header buttons wrap on mobile viewport', async ({ page }) => {
    const contractId = 'test-hdr-012';
    await mockContractHeader(page, contractId, { status: 'ACTIVE', workflowStatus: 'APPROVED' });

    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 812 });

    await page.goto(`/contracts/${contractId}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);

    // All key buttons should still be visible (they flex-wrap)
    await expect(page.locator('button:has-text("ลงนาม/เอกสาร")')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('button:has-text("พิมพ์สัญญา")')).toBeVisible();
    await expect(page.locator('button:has-text("กลับ")')).toBeVisible();
  });

  // ── 15.13 Loading state shows spinner ─────────────────────────────────
  test('15.13 Loading state shows spinner before data loads', async ({ page }) => {
    const contractId = 'test-hdr-013';

    // Delay the API response to show loading
    await page.route(`**/api/contracts/${contractId}`, async (route) => {
      await new Promise(resolve => setTimeout(resolve, 3000));
      const contract = buildMockContract(contractId);
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(contract) });
    });

    await page.route(`**/api/contracts/${contractId}/documents`, async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) });
    });

    await page.goto(`/contracts/${contractId}`, { waitUntil: 'domcontentloaded' });

    // Should show loading spinner
    const spinner = page.locator('.animate-spin');
    await expect(spinner).toBeVisible({ timeout: 2000 });
  });

  // ── 15.14 Contract number displayed in header ─────────────────────────
  test('15.14 Contract number is displayed in page header', async ({ page }) => {
    const contractId = 'test-hdr-014';
    await mockContractHeader(page, contractId, { contractNumber: 'BCP-9999' });

    await page.goto(`/contracts/${contractId}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);

    await expect(page.getByText('BCP-9999')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('รายละเอียดสัญญาผ่อนชำระ')).toBeVisible();
  });

  // ── 15.15 Activate button sends POST to activate endpoint ─────────────
  test('15.15 Activate button sends POST to activate endpoint', async ({ page }) => {
    const contractId = 'test-hdr-015';
    await mockContractHeader(page, contractId, {
      status: 'DRAFT',
      workflowStatus: 'APPROVED',
      signatures: [
        { id: 's1', signerType: 'CUSTOMER', signedAt: '2026-01-15T10:00:00.000Z' },
        { id: 's2', signerType: 'COMPANY', signedAt: '2026-01-15T10:00:00.000Z' },
        { id: 's3', signerType: 'WITNESS_1', signedAt: '2026-01-15T10:00:00.000Z' },
        { id: 's4', signerType: 'WITNESS_2', signedAt: '2026-01-15T10:00:00.000Z' },
      ],
    });

    let activateCalled = false;
    await page.route(`**/api/contracts/${contractId}/activate`, async (route) => {
      activateCalled = true;
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ ...buildMockContract(contractId), status: 'ACTIVE', workflowStatus: 'APPROVED' }),
      });
    });

    await page.goto(`/contracts/${contractId}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);

    await page.locator('button:has-text("เปิดใช้งานสัญญา")').click();
    await page.waitForTimeout(2000);

    expect(activateCalled).toBe(true);
  });

  // ── 15.16 Rejected status shows rejection reason ──────────────────────
  test('15.16 Rejected contract shows rejection reason and reviewer info', async ({ page }) => {
    const contractId = 'test-hdr-016';
    await mockContractHeader(page, contractId, {
      status: 'DRAFT',
      workflowStatus: 'REJECTED',
      reviewNotes: 'เอกสารไม่ครบถ้วน กรุณาแนบสำเนาบัตรประชาชน',
      reviewedBy: { id: 'reviewer-1', name: 'ผู้จัดการ ทดสอบ' },
      reviewedAt: '2026-03-15T14:30:00.000Z',
    });

    await page.goto(`/contracts/${contractId}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);

    // Rejection banner
    await expect(page.getByText('สัญญาถูกปฏิเสธ')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('เอกสารไม่ครบถ้วน กรุณาแนบสำเนาบัตรประชาชน')).toBeVisible();
    await expect(page.getByText('ผู้จัดการ ทดสอบ')).toBeVisible();
  });
});
