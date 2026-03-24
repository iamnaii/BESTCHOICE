import { test, expect, Page } from '@playwright/test';
import { loginWithMock } from './helpers/mock-auth';

// ============================================================================
// BESTCHOICE Contract Detail - Customer Link, QR, Delete (Phase 11)
// Route: /contracts/:id
//
// Tests:
//   - Customer link generation → Modal + copy
//   - QR Verify section display
//   - Delete contract → confirm → DELETE API
//   - Credit Balance card + apply credit button
//   - Dunning Stage indicator
// ============================================================================

function buildMockContract(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    contractNumber: 'BCP-ACT-001',
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
    payments: [],
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

async function mockContract(page: Page, contractId: string, overrides: Record<string, unknown> = {}) {
  const contract = buildMockContract(contractId, overrides);

  await page.route(`**/api/contracts/${contractId}`, async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(contract) });
    } else if (route.request().method() === 'DELETE') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) });
    } else {
      await route.continue();
    }
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

test.describe('Phase 11: Contract Detail - Customer Link, QR, Delete', () => {
  test.beforeEach(async ({ page }) => {
    await loginWithMock(page);
  });

  // ── 11.1 Customer link button generates link and shows modal ──────────
  test('11.1 Send customer link button opens modal with copyable link', async ({ page }) => {
    const contractId = 'test-action-001';
    await mockContract(page, contractId);

    // Mock customer link generation
    await page.route(`**/api/contracts/${contractId}/customer-link`, async (route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ url: 'https://example.com', token: 'test-token-abc', expiresAt: '2026-03-22T10:00:00.000Z' }),
      });
    });

    await page.goto(`/contracts/${contractId}`, { waitUntil: 'networkidle' });

    // Click send customer link button
    await page.locator('button:has-text("ส่งลิงก์ลูกค้า")').click();

    // Modal should appear
    await expect(page.getByRole('heading', { name: 'ลิงก์สำหรับลูกค้า' })).toBeVisible({ timeout: 5000 });

    // Should show expiry info
    await expect(page.getByText('มีอายุ 48 ชม.')).toBeVisible();

    // Should have a readonly input with the link
    const linkInput = page.locator('input[readonly]');
    await expect(linkInput).toBeVisible();
    const linkValue = await linkInput.inputValue();
    expect(linkValue).toContain('customer-access/test-token-abc');

    // Copy button should be visible
    await expect(page.locator('button:has-text("คัดลอก")')).toBeVisible();
  });

  // ── 11.2 QR Verify section shows when contract has hash ───────────────
  test('11.2 QR Verify section displays when contractHash exists', async ({ page }) => {
    const contractId = 'test-action-002';
    await mockContract(page, contractId, {
      contractHash: 'abc123def456ghi789jkl012mno345',
    });

    await page.goto(`/contracts/${contractId}`, { waitUntil: 'networkidle' });

    // QR section should appear
    await expect(page.getByText('ตรวจสอบสัญญา (QR Verify)')).toBeVisible({ timeout: 5000 });

    // Hash preview
    await expect(page.getByText('abc123def456gh')).toBeVisible();

    // Verified indicator
    await expect(page.getByText('สัญญาได้รับการยืนยันแล้ว')).toBeVisible();
  });

  // ── 11.3 QR Verify section hidden without hash ────────────────────────
  test('11.3 QR Verify section is hidden when no contractHash', async ({ page }) => {
    const contractId = 'test-action-003';
    await mockContract(page, contractId, { contractHash: null });

    await page.goto(`/contracts/${contractId}`, { waitUntil: 'networkidle' });

    await expect(page.getByText('ตรวจสอบสัญญา (QR Verify)')).not.toBeVisible();
  });

  // ── 11.4 Delete contract sends DELETE API after confirm ───────────────
  test('11.4 Delete contract calls DELETE API after window.confirm', async ({ page }) => {
    const contractId = 'test-action-004';
    await mockContract(page, contractId, {
      status: 'DRAFT',
      workflowStatus: 'CREATING',
      salespersonId: 'user-001',
    });

    // Intercept DELETE
    let deleteCalled = false;
    await page.route(`**/api/contracts/${contractId}`, async (route) => {
      if (route.request().method() === 'DELETE') {
        deleteCalled = true;
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) });
      } else {
        const contract = buildMockContract(contractId, { status: 'DRAFT', workflowStatus: 'CREATING', salespersonId: 'user-001' });
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(contract) });
      }
    });

    // Auto-accept window.confirm
    page.on('dialog', async (dialog) => {
      expect(dialog.message()).toContain('ยืนยันลบสัญญานี้');
      await dialog.accept();
    });

    await page.goto(`/contracts/${contractId}`, { waitUntil: 'networkidle' });

    // Click delete button (only visible for OWNER + CREATING/REJECTED)
    const deleteBtn = page.locator('button:has-text("ลบสัญญา")');
    await expect(deleteBtn).toBeVisible({ timeout: 5000 });
    await deleteBtn.click();
    await page.waitForLoadState('networkidle');

    expect(deleteCalled).toBe(true);
  });

  // ── 11.5 Credit Balance card displays with apply button ───────────────
  test('11.5 Credit Balance card shows balance and apply credit button', async ({ page }) => {
    const contractId = 'test-action-005';
    await mockContract(page, contractId, {
      creditBalance: '1500',
      status: 'ACTIVE',
    });

    await page.goto(`/contracts/${contractId}`, { waitUntil: 'networkidle' });

    // Credit balance card
    await expect(page.getByText('ยอดเครดิตคงเหลือ')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('1,500 ฿')).toBeVisible();

    // Apply credit button
    await expect(page.locator('button:has-text("ใช้เครดิตชำระ")')).toBeVisible();
  });

  // ── 11.6 Credit Balance card hidden when balance is zero/null ─────────
  test('11.6 Credit Balance card is hidden when no balance', async ({ page }) => {
    const contractId = 'test-action-006';
    await mockContract(page, contractId, { creditBalance: null });

    await page.goto(`/contracts/${contractId}`, { waitUntil: 'networkidle' });

    await expect(page.getByText('ยอดเครดิตคงเหลือ')).not.toBeVisible();
  });

  // ── 11.7 Dunning stage REMINDER ───────────────────────────────────────
  test('11.7 Dunning stage shows แจ้งเตือน for REMINDER', async ({ page }) => {
    const contractId = 'test-action-007';
    await mockContract(page, contractId, { dunningStage: 'REMINDER', status: 'OVERDUE' });

    await page.goto(`/contracts/${contractId}`, { waitUntil: 'networkidle' });

    await expect(page.getByText('ระดับติดตามหนี้')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('แจ้งเตือน')).toBeVisible();
  });

  // ── 11.8 Dunning stage LEGAL_ACTION ───────────────────────────────────
  test('11.8 Dunning stage shows ดำเนินคดี for LEGAL_ACTION', async ({ page }) => {
    const contractId = 'test-action-008';
    await mockContract(page, contractId, { dunningStage: 'LEGAL_ACTION', status: 'DEFAULT' });

    await page.goto(`/contracts/${contractId}`, { waitUntil: 'networkidle' });

    await expect(page.getByText('ระดับติดตามหนี้')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('ดำเนินคดี')).toBeVisible();
  });

  // ── 11.9 Dunning stage NOTICE ─────────────────────────────────────────
  test('11.9 Dunning stage shows แจ้งค้างชำระ for NOTICE', async ({ page }) => {
    const contractId = 'test-action-009';
    await mockContract(page, contractId, { dunningStage: 'NOTICE', status: 'OVERDUE' });

    await page.goto(`/contracts/${contractId}`, { waitUntil: 'networkidle' });

    await expect(page.getByText('แจ้งค้างชำระ')).toBeVisible({ timeout: 5000 });
  });

  // ── 11.10 Dunning stage FINAL_WARNING ─────────────────────────────────
  test('11.10 Dunning stage shows เตือนครั้งสุดท้าย for FINAL_WARNING', async ({ page }) => {
    const contractId = 'test-action-010';
    await mockContract(page, contractId, { dunningStage: 'FINAL_WARNING', status: 'DEFAULT' });

    await page.goto(`/contracts/${contractId}`, { waitUntil: 'networkidle' });

    await expect(page.getByText('เตือนครั้งสุดท้าย')).toBeVisible({ timeout: 5000 });
  });

  // ── 11.11 Delete button hidden for non-OWNER or non-CREATING status ──
  test('11.11 Delete button is hidden for ACTIVE contracts', async ({ page }) => {
    const contractId = 'test-action-011';
    await mockContract(page, contractId, { status: 'ACTIVE', workflowStatus: 'APPROVED' });

    await page.goto(`/contracts/${contractId}`, { waitUntil: 'networkidle' });

    await expect(page.locator('button:has-text("ลบสัญญา")')).not.toBeVisible();
  });

  // ── 11.12 Apply credit sends POST to payments/apply-credit ────────────
  test('11.12 Apply credit button sends POST to apply-credit endpoint', async ({ page }) => {
    const contractId = 'test-action-012';
    await mockContract(page, contractId, {
      creditBalance: '2000',
      status: 'ACTIVE',
    });

    let applyCreditCalled = false;
    await page.route(`**/api/payments/apply-credit/${contractId}`, async (route) => {
      applyCreditCalled = true;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) });
    });

    // Auto-accept confirm dialog
    page.on('dialog', async (dialog) => {
      await dialog.accept();
    });

    await page.goto(`/contracts/${contractId}`, { waitUntil: 'networkidle' });

    await page.locator('button:has-text("ใช้เครดิตชำระ")').click();
    await page.waitForLoadState('networkidle');

    expect(applyCreditCalled).toBe(true);
  });
});
