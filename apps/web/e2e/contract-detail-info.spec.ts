import { test, expect, Page } from '@playwright/test';
import { loginViaAPI } from './helpers/auth';

// ============================================================================
// BESTCHOICE Contract Detail - Info Cards & Editing (Phase 8)
// Route: /contracts/:id
//
// Tests contract detail info cards display and inline editing:
//   - Contract info card (selling price, down payment, months, interest)
//   - Customer info card (name, phone, occupation)
//   - Product info card (brand, model, IMEI)
//   - Edit contract → form + calculation preview
//   - Save edit → PATCH API
// ============================================================================

const baseURL = 'http://localhost:5173';

function buildMockContract(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    contractNumber: 'BCP-INFO-001',
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
    notes: 'หมายเหตุทดสอบ',
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
    customer: { id: 'cust-1', name: 'สมชาย ใจดี', phone: '0891234567', nationalId: '1234567890123' },
    customerSnapshot: {
      name: 'สมชาย ใจดี',
      phone: '0891234567',
      prefix: 'นาย',
      nickname: 'ชาย',
      occupation: 'พนักงานบริษัท',
      salary: '25000',
    },
    product: {
      id: 'prod-1', name: 'iPhone 15 Pro', brand: 'Apple', model: 'iPhone 15 Pro',
      category: 'PHONE_NEW', color: 'Natural Titanium', storage: '256GB',
      serialNumber: 'SN-ABC123', imeiSerial: '353456789012345',
      costPrice: '12000', batteryHealth: null, warrantyExpired: false,
      warrantyExpireDate: null, hasBox: true, accessoryType: null, accessoryBrand: null,
    },
    salesperson: { id: 'user-001', name: 'Admin' },
    branch: { id: 'branch-1', name: 'สาขาหลัก' },
    payments: [],
    signatures: [],
    contractDocuments: [],
    creditCheck: null,
    interestConfig: { id: 'ic-1', name: 'Standard', storeCommissionPct: '0.10', vatPct: '0.07' },
    ...overrides,
  };
}

async function mockContractDetail(page: Page, contractId: string, overrides: Record<string, unknown> = {}) {
  const contract = buildMockContract(contractId, overrides);

  await page.route(`**/api/contracts/${contractId}`, async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(contract) });
    } else {
      await route.continue();
    }
  });

  await page.route(`**/api/contracts/${contractId}/documents/checklist`, async (route) => {
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ complete: true, checklist: [] }),
    });
  });

  await page.route(`**/api/contracts/${contractId}/documents`, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) });
  });

  await page.route(`**/api/contracts/${contractId}/early-payoff-quote`, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ remainingMonths: 8, remainingPrincipal: 10000, remainingInterest: 800, discount: 400, partiallyPaidCredit: 0, unpaidLateFees: 0, totalPayoff: 10400 }) });
  });

  await page.route(`**/api/contracts/${contractId}/preview**`, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ html: '<html><body>Preview</body></html>' }) });
  });

  return contract;
}

// =============================================================================
// PHASE 8: Contract Detail - Info Cards & Editing
// =============================================================================
test.describe('Phase 8: Contract Detail - Info Cards & Editing', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page);
  });

  // ── 8.1 Contract info card displays all financial details ─────────────
  test('8.1 Contract info card displays selling price, down payment, months, interest', async ({ page }) => {
    const contractId = 'test-info-001';
    await mockContractDetail(page, contractId);

    await page.goto(`/contracts/${contractId}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);

    // Contract info section header
    await expect(page.getByText('ข้อมูลสัญญา', { exact: false })).toBeVisible({ timeout: 5000 });

    // Financial details
    await expect(page.getByText('ราคาขาย')).toBeVisible();
    await expect(page.getByText('15,000 ฿')).toBeVisible();

    await expect(page.getByText('เงินดาวน์')).toBeVisible();
    await expect(page.getByText('3,000 ฿')).toBeVisible();

    await expect(page.getByText('จำนวนงวด')).toBeVisible();
    await expect(page.getByText('10 เดือน')).toBeVisible();

    await expect(page.getByText('อัตราดอกเบี้ย')).toBeVisible();
    await expect(page.getByText('8.0%')).toBeVisible();

    // Loan amount (sellingPrice - downPayment)
    await expect(page.getByText('ยอดปล่อย (Loan)')).toBeVisible();
    await expect(page.getByText('12,000 ฿')).toBeVisible();

    // Interest total
    await expect(page.getByText('ดอกเบี้ยรวม')).toBeVisible();
    await expect(page.getByText('1,200 ฿')).toBeVisible();

    // Financed amount
    await expect(page.getByText('ยอดจัดไฟแนนซ์')).toBeVisible();
    await expect(page.getByText('13,200 ฿')).toBeVisible();

    // Payment due day
    await expect(page.getByText('วันชำระ')).toBeVisible();
    await expect(page.getByText('ทุกวันที่ 5')).toBeVisible();

    // Salesperson and branch
    await expect(page.getByText('พนักงานขาย')).toBeVisible();
    await expect(page.getByText('Admin')).toBeVisible();
    await expect(page.getByText('สาขา')).toBeVisible();
    await expect(page.getByText('สาขาหลัก')).toBeVisible();

    // Notes
    await expect(page.getByText('หมายเหตุ')).toBeVisible();
    await expect(page.getByText('หมายเหตุทดสอบ')).toBeVisible();
  });

  // ── 8.2 Customer info card displays name, phone, occupation ──────────
  test('8.2 Customer info card displays name, phone, and occupation from snapshot', async ({ page }) => {
    const contractId = 'test-info-002';
    await mockContractDetail(page, contractId);

    await page.goto(`/contracts/${contractId}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);

    // Customer section header
    await expect(page.getByText('ข้อมูลลูกค้า')).toBeVisible({ timeout: 5000 });

    // Snapshot badge
    await expect(page.getByText('ณ วันที่สร้างสัญญา')).toBeVisible();

    // Customer name with prefix from snapshot
    await expect(page.getByText('นายสมชาย ใจดี')).toBeVisible();

    // Nickname
    await expect(page.getByText('ชื่อเล่น')).toBeVisible();
    await expect(page.getByText('ชาย')).toBeVisible();

    // Phone
    await expect(page.getByText('เบอร์โทร')).toBeVisible();
    await expect(page.getByText('0891234567')).toBeVisible();

    // Occupation
    await expect(page.getByText('อาชีพ')).toBeVisible();
    await expect(page.getByText('พนักงานบริษัท')).toBeVisible();

    // Salary
    await expect(page.getByText('รายได้')).toBeVisible();
    await expect(page.getByText('25,000 ฿')).toBeVisible();

    // Link to customer detail
    await expect(page.getByText('ดูรายละเอียดลูกค้า (ข้อมูลปัจจุบัน)')).toBeVisible();
  });

  // ── 8.3 Product info card displays brand, model, IMEI ────────────────
  test('8.3 Product info card displays brand, model, IMEI, and other details', async ({ page }) => {
    const contractId = 'test-info-003';
    await mockContractDetail(page, contractId);

    await page.goto(`/contracts/${contractId}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);

    // Product section header
    await expect(page.getByText('ข้อมูลสินค้า')).toBeVisible({ timeout: 5000 });

    // Brand + Model
    await expect(page.getByText('Apple iPhone 15 Pro')).toBeVisible();

    // Product name
    await expect(page.getByText('iPhone 15 Pro')).toBeVisible();

    // Color
    await expect(page.getByText('สี')).toBeVisible();
    await expect(page.getByText('Natural Titanium')).toBeVisible();

    // Storage
    await expect(page.getByText('ความจุ')).toBeVisible();
    await expect(page.getByText('256GB')).toBeVisible();

    // IMEI
    await expect(page.getByText('IMEI')).toBeVisible();
    await expect(page.getByText('353456789012345')).toBeVisible();

    // Serial Number
    await expect(page.getByText('S/N')).toBeVisible();
    await expect(page.getByText('SN-ABC123')).toBeVisible();

    // Link to product detail
    await expect(page.getByText('ดูรายละเอียดสินค้า')).toBeVisible();
  });

  // ── 8.4 Edit button shows form with calculation preview ──────────────
  test('8.4 Click edit button shows form with calculation preview', async ({ page }) => {
    const contractId = 'test-info-004';
    // salespersonId matches the logged-in user (user-001) and CREATING status → canEdit = true
    await mockContractDetail(page, contractId, {
      workflowStatus: 'CREATING',
      status: 'DRAFT',
      salespersonId: 'user-001',
    });

    await page.goto(`/contracts/${contractId}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);

    // Find the edit button in the contract info section
    const contractInfoSection = page.locator('.rounded-lg.border.p-6').filter({ hasText: 'ข้อมูลสัญญา' });
    const editBtn = contractInfoSection.locator('button:has-text("แก้ไข")');
    await expect(editBtn).toBeVisible({ timeout: 5000 });
    await editBtn.click();

    // Form fields should appear
    await expect(page.locator('label:has-text("ราคาขาย") + input, label:has-text("ราคาขาย") ~ input').first()).toBeVisible({ timeout: 3000 });
    await expect(page.locator('label:has-text("เงินดาวน์")')).toBeVisible();
    await expect(page.locator('label:has-text("จำนวนงวด (เดือน)")')).toBeVisible();
    await expect(page.locator('label:has-text("อัตราดอกเบี้ย")')).toBeVisible();
    await expect(page.locator('label:has-text("วันชำระ")')).toBeVisible();
    await expect(page.locator('label:has-text("หมายเหตุ")')).toBeVisible();

    // Calculation preview should be visible
    await expect(page.getByText('ยอดปล่อย:')).toBeVisible();
    await expect(page.getByText('ค่าคอมหน้าร้าน')).toBeVisible();
    await expect(page.getByText('ดอกเบี้ยรวม:')).toBeVisible();
    await expect(page.getByText('VAT')).toBeVisible();
    await expect(page.getByText('ค่างวด/เดือน:')).toBeVisible();

    // Cancel and Save buttons
    await expect(page.getByRole('button', { name: 'ยกเลิก' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'บันทึก' })).toBeVisible();
  });

  // ── 8.5 Cancel editing reverts to display mode ────────────────────────
  test('8.5 Cancel editing returns to info card display mode', async ({ page }) => {
    const contractId = 'test-info-005';
    await mockContractDetail(page, contractId, {
      workflowStatus: 'CREATING',
      status: 'DRAFT',
      salespersonId: 'user-001',
    });

    await page.goto(`/contracts/${contractId}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);

    // Enter edit mode
    const contractInfoSection = page.locator('.rounded-lg.border.p-6').filter({ hasText: 'ข้อมูลสัญญา' });
    await contractInfoSection.locator('button:has-text("แก้ไข")').click();
    await expect(page.getByRole('button', { name: 'ยกเลิก' })).toBeVisible({ timeout: 3000 });

    // Cancel
    await page.getByRole('button', { name: 'ยกเลิก' }).click();

    // Should be back in display mode - original values visible
    await expect(page.getByText('15,000 ฿')).toBeVisible({ timeout: 3000 });
    await expect(page.getByText('10 เดือน')).toBeVisible();
  });

  // ── 8.6 Save edit sends PATCH API ─────────────────────────────────────
  test('8.6 Save edit sends PATCH API with form data', async ({ page }) => {
    const contractId = 'test-info-006';
    await mockContractDetail(page, contractId, {
      workflowStatus: 'CREATING',
      status: 'DRAFT',
      salespersonId: 'user-001',
    });

    // Intercept PATCH request
    let patchCalled = false;
    let patchBody: Record<string, unknown> = {};
    await page.route(`**/api/contracts/${contractId}`, async (route) => {
      if (route.request().method() === 'PATCH') {
        patchCalled = true;
        patchBody = route.request().postDataJSON();
        const updated = buildMockContract(contractId, { sellingPrice: '20000' });
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(updated) });
      } else {
        const contract = buildMockContract(contractId, { workflowStatus: 'CREATING', status: 'DRAFT', salespersonId: 'user-001' });
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(contract) });
      }
    });

    await page.goto(`/contracts/${contractId}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);

    // Enter edit mode
    const contractInfoSection = page.locator('.rounded-lg.border.p-6').filter({ hasText: 'ข้อมูลสัญญา' });
    await contractInfoSection.locator('button:has-text("แก้ไข")').click();
    await page.waitForTimeout(500);

    // Modify selling price
    const sellingPriceInput = page.locator('input[type="number"]').first();
    await sellingPriceInput.fill('20000');

    // Click save
    await page.getByRole('button', { name: 'บันทึก' }).click();
    await page.waitForTimeout(2000);

    expect(patchCalled).toBe(true);
    expect(patchBody.sellingPrice).toBe(20000);
  });

  // ── 8.7 Edit form shows validation errors for invalid data ────────────
  test('8.7 Edit form shows validation errors for invalid data', async ({ page }) => {
    const contractId = 'test-info-007';
    await mockContractDetail(page, contractId, {
      workflowStatus: 'CREATING',
      status: 'DRAFT',
      salespersonId: 'user-001',
    });

    await page.goto(`/contracts/${contractId}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);

    // Enter edit mode
    const contractInfoSection = page.locator('.rounded-lg.border.p-6').filter({ hasText: 'ข้อมูลสัญญา' });
    await contractInfoSection.locator('button:has-text("แก้ไข")').click();
    await page.waitForTimeout(500);

    // Set totalMonths to 0
    const monthsInputs = page.locator('input[type="number"]');
    // The 3rd number input should be totalMonths (sellingPrice, downPayment, totalMonths)
    await monthsInputs.nth(2).fill('0');
    await page.waitForTimeout(300);

    // Should show validation error
    await expect(page.getByText('จำนวนงวดต้องมากกว่า 0')).toBeVisible();

    // Save button should be disabled
    const saveBtn = page.getByRole('button', { name: 'บันทึก' });
    await expect(saveBtn).toBeDisabled();
  });

  // ── 8.8 Edit button not shown when user cannot edit ───────────────────
  test('8.8 Edit button is hidden when contract is not in CREATING/REJECTED status', async ({ page }) => {
    const contractId = 'test-info-008';
    await mockContractDetail(page, contractId, {
      workflowStatus: 'PENDING_REVIEW',
      status: 'DRAFT',
      salespersonId: 'user-001',
    });

    await page.goto(`/contracts/${contractId}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);

    // The contract info section should not have an edit button
    const contractInfoSection = page.locator('.rounded-lg.border.p-6').filter({ hasText: 'ข้อมูลสัญญา' });
    await expect(contractInfoSection).toBeVisible({ timeout: 5000 });

    // Edit button should NOT appear for contract info (canEdit=false when PENDING_REVIEW)
    const editBtns = contractInfoSection.locator('button:has-text("แก้ไข")');
    await expect(editBtns).toHaveCount(0);
  });

  // ── 8.9 Payment due day shows "สิ้นเดือน" for day 31 ─────────────────
  test('8.9 Payment due day shows สิ้นเดือน for day 31', async ({ page }) => {
    const contractId = 'test-info-009';
    await mockContractDetail(page, contractId, { paymentDueDay: 31 });

    await page.goto(`/contracts/${contractId}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);

    await expect(page.getByText('สิ้นเดือน')).toBeVisible({ timeout: 5000 });
  });

  // ── 8.10 Customer info without snapshot uses direct customer data ─────
  test('8.10 Customer info without snapshot falls back to customer data', async ({ page }) => {
    const contractId = 'test-info-010';
    await mockContractDetail(page, contractId, {
      customerSnapshot: null,
      customer: { id: 'cust-1', name: 'ทดสอบ ไม่มี Snapshot', phone: '0999999999', nationalId: '9999999999999' },
    });

    await page.goto(`/contracts/${contractId}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);

    // Should use direct customer name (no prefix since no snapshot)
    await expect(page.getByText('ทดสอบ ไม่มี Snapshot')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('0999999999')).toBeVisible();

    // Snapshot badge should NOT appear
    await expect(page.getByText('ณ วันที่สร้างสัญญา')).not.toBeVisible();
  });

  // ── 8.11 Calculation preview updates when form values change ──────────
  test('8.11 Calculation preview updates when editing form values', async ({ page }) => {
    const contractId = 'test-info-011';
    await mockContractDetail(page, contractId, {
      workflowStatus: 'CREATING',
      status: 'DRAFT',
      salespersonId: 'user-001',
    });

    await page.goto(`/contracts/${contractId}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);

    // Enter edit mode
    const contractInfoSection = page.locator('.rounded-lg.border.p-6').filter({ hasText: 'ข้อมูลสัญญา' });
    await contractInfoSection.locator('button:has-text("แก้ไข")').click();
    await page.waitForTimeout(500);

    // Change selling price to 20000 (loan = 20000 - 3000 = 17000)
    const sellingPriceInput = page.locator('input[type="number"]').first();
    await sellingPriceInput.fill('20000');
    await page.waitForTimeout(300);

    // Preview should update - check for ยอดปล่อย: 17,000 ฿
    await expect(page.getByText('ยอดปล่อย: 17,000 ฿')).toBeVisible({ timeout: 3000 });
  });

  // ── 8.12 Interest config name displayed next to interest rate ─────────
  test('8.12 Interest config name shown alongside interest rate', async ({ page }) => {
    const contractId = 'test-info-012';
    await mockContractDetail(page, contractId, {
      interestConfig: { id: 'ic-1', name: 'Premium Plan', storeCommissionPct: '0.10', vatPct: '0.07' },
    });

    await page.goto(`/contracts/${contractId}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);

    // Should show interest rate with config name
    await expect(page.getByText('8.0% (Premium Plan)')).toBeVisible({ timeout: 5000 });
  });
});
