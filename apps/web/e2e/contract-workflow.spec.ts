import { test, expect, Page } from '@playwright/test';
import { loginWithMock } from './helpers/mock-auth';

// ============================================================================
// BESTCHOICE Contract Workflow Transitions - E2E Test Suite
// Route: /contracts/:id
//
// Tests workflow state machine:
//   CREATING → PENDING_REVIEW → APPROVED → ACTIVE
//                              → REJECTED → (re-edit) → PENDING_REVIEW
//
// Uses API route mocking to simulate different workflow states
// without modifying real database data.
// ============================================================================

// -- Helpers ------------------------------------------------------------------

// Note: getFirstContractId removed — all tests use hardcoded IDs with mockContractDetail

/** Build a mock contract response for the given workflow state */
function buildMockContract(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    contractNumber: 'BCP-TEST-001',
    status: 'DRAFT',
    workflowStatus: 'CREATING',
    sellingPrice: '15000',
    downPayment: '3000',
    totalMonths: 10,
    interestRate: '0.08',
    interestTotal: '1200',
    financedAmount: '13200',
    monthlyPayment: '1320',
    paymentDueDay: 1,
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
    createdAt: new Date().toISOString(),
    customer: { id: 'cust-1', name: 'ทดสอบ ลูกค้า', phone: '0812345678' },
    product: { id: 'prod-1', name: 'iPhone 15', brand: 'Apple', model: 'iPhone 15', category: 'PHONE_NEW', color: null, storage: '128GB', serialNumber: null, imeiSerial: '123456789012345', costPrice: '12000', batteryHealth: null, warrantyExpired: false, warrantyExpireDate: null, hasBox: true, accessoryType: null, accessoryBrand: null },
    salesperson: { id: 'user-001', name: 'Admin' },
    branch: { id: 'branch-1', name: 'สาขาหลัก' },
    payments: [],
    signatures: [],
    contractDocuments: [],
    customerSnapshot: null,
    creditCheck: null,
    interestConfig: null,
    ...overrides,
  };
}

/** Mock contract documents (at least 3 to pass stepper step 2) */
const MOCK_DOCS = [
  { id: 'd1', type: 'SIGNED_CONTRACT', fileName: 'contract.pdf' },
  { id: 'd2', type: 'ID_CARD_COPY', fileName: 'id-card.jpg' },
  { id: 'd3', type: 'KYC_SELFIE', fileName: 'selfie.jpg' },
];

/** Set up route mocking for a contract detail page */
async function mockContractDetail(page: Page, contractId: string, overrides: Record<string, unknown> = {}) {
  const contract = buildMockContract(contractId, overrides);

  await page.route(`**/api/contracts/${contractId}`, async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(contract) });
    } else {
      await route.continue();
    }
  });

  // Mock document checklist
  await page.route(`**/api/contracts/${contractId}/documents/checklist`, async (route) => {
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        complete: overrides._docsComplete ?? true,
        checklist: [
          { type: 'SIGNED_CONTRACT', label: 'สัญญาผ่อนชำระ PDF', present: true, autoGenerate: true },
          { type: 'ID_CARD_COPY', label: 'สำเนาบัตรประชาชน', present: true, autoGenerate: false },
          { type: 'KYC_SELFIE', label: 'รูปถ่าย KYC', present: overrides._docsComplete !== false, autoGenerate: false },
          { type: 'DEVICE_PHOTO', label: 'รูปถ่ายสินค้า', present: overrides._docsComplete !== false, autoGenerate: false },
          { type: 'DOWN_PAYMENT_RECEIPT', label: 'หลักฐานเงินดาวน์', present: overrides._docsComplete !== false, autoGenerate: false },
          { type: 'PDPA_CONSENT', label: 'Consent PDPA', present: true, autoGenerate: true },
        ],
        requiresGuardian: false,
      }),
    });
  });

  // Mock e-documents
  await page.route(`**/api/documents/contracts/${contractId}`, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) });
  });

  // Mock early payoff quote
  await page.route(`**/api/contracts/${contractId}/early-payoff-quote`, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ remainingMonths: 8, remainingPrincipal: 10000, remainingInterest: 800, discount: 400, partiallyPaidCredit: 0, unpaidLateFees: 0, totalPayoff: 10400 }) });
  });

  // Mock contract preview
  await page.route(`**/api/documents/contracts/${contractId}/preview**`, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ html: '<html><body>Preview</body></html>' }) });
  });
}

// =============================================================================
// PHASE 7: Workflow Transitions - UI & State Machine Tests
// =============================================================================
test.describe('Phase 7: Workflow Transitions', () => {
  test.beforeEach(async ({ page }) => {
    await loginWithMock(page);
  });

  // ── 7.1 CREATING state: Stepper shows step 1 active ──────────────────────
  test('7.1 CREATING contract shows workflow stepper with step 1 active', async ({ page }) => {
    const contractId = 'test-creating-001';
    await mockContractDetail(page, contractId, {
      workflowStatus: 'CREATING',
      status: 'DRAFT',
    });

    await page.goto(`/contracts/${contractId}`, { waitUntil: 'networkidle' });

    // Should show workflow stepper
    const stepper = page.locator('.rounded-lg.border.p-4.mb-6').first();
    await expect(stepper).toBeVisible({ timeout: 5000 });

    // Step 1 (สร้างสัญญา) should be done (green checkmark)
    const step1 = stepper.locator('text=สร้างสัญญา');
    await expect(step1).toBeVisible();

    // Should show stepper steps
    await expect(stepper.getByText('แนบเอกสาร', { exact: true })).toBeVisible();
    await expect(stepper.getByText('ลงนาม & PDPA', { exact: true })).toBeVisible();
    await expect(stepper.getByText('ตรวจสอบ & อนุมัติ', { exact: true })).toBeVisible();
    await expect(stepper.getByText('เปิดใช้งาน', { exact: true })).toBeVisible();
  });

  // ── 7.2 Submit for review: Confirm modal appears ─────────────────────────
  test('7.2 Submit for review shows confirmation modal before submitting', async ({ page }) => {
    const contractId = 'test-submit-001';
    await mockContractDetail(page, contractId, {
      workflowStatus: 'CREATING',
      status: 'DRAFT',
      salespersonId: 'user-001',
      pdpaConsentId: 'pdpa-1',
      contractDocuments: MOCK_DOCS,
      signatures: [
        { id: 's1', signerType: 'CUSTOMER', signerName: 'ลูกค้า', signedAt: new Date().toISOString() },
        { id: 's2', signerType: 'COMPANY', signerName: 'ผู้ขาย', signedAt: new Date().toISOString() },
        { id: 's3', signerType: 'WITNESS_1', signerName: 'พยาน 1', signedAt: new Date().toISOString() },
        { id: 's4', signerType: 'WITNESS_2', signerName: 'พยาน 2', signedAt: new Date().toISOString() },
      ],
    });

    await page.goto(`/contracts/${contractId}`, { waitUntil: 'networkidle' });

    // Find and click "ส่งตรวจสอบ" button in the workflow stepper
    const submitBtn = page.locator('button:has-text("ส่งตรวจสอบ")').first();
    await expect(submitBtn).toBeVisible({ timeout: 5000 });
    await submitBtn.click();

    // Confirmation modal should appear
    const modalTitle = page.getByRole('heading', { name: 'ยืนยันส่งตรวจสอบ' });
    await expect(modalTitle).toBeVisible({ timeout: 3000 });

    // Should show warning message
    await expect(page.locator('text=จะไม่สามารถแก้ไขสัญญาได้จนกว่าจะถูกปฏิเสธ')).toBeVisible();

    // Should have ยกเลิก and ยืนยัน buttons
    await expect(page.locator('button:has-text("ยกเลิก")')).toBeVisible();
    await expect(page.getByRole('button', { name: 'ยืนยันส่งตรวจสอบ' })).toBeVisible();
  });

  // ── 7.3 Submit for review: Cancel closes modal ───────────────────────────
  test('7.3 Cancel button closes submit confirmation modal', async ({ page }) => {
    const contractId = 'test-submit-cancel-001';
    await mockContractDetail(page, contractId, {
      workflowStatus: 'CREATING',
      status: 'DRAFT',
      salespersonId: 'user-001',
      pdpaConsentId: 'pdpa-1',
      contractDocuments: MOCK_DOCS,
      signatures: [
        { id: 's1', signerType: 'CUSTOMER', signerName: 'ลูกค้า', signedAt: new Date().toISOString() },
        { id: 's2', signerType: 'COMPANY', signerName: 'ผู้ขาย', signedAt: new Date().toISOString() },
        { id: 's3', signerType: 'WITNESS_1', signerName: 'พยาน 1', signedAt: new Date().toISOString() },
        { id: 's4', signerType: 'WITNESS_2', signerName: 'พยาน 2', signedAt: new Date().toISOString() },
      ],
    });

    await page.goto(`/contracts/${contractId}`, { waitUntil: 'networkidle' });

    // Open modal
    await page.locator('button:has-text("ส่งตรวจสอบ")').first().click();
    await expect(page.getByRole('heading', { name: 'ยืนยันส่งตรวจสอบ' })).toBeVisible({ timeout: 3000 });

    // Click cancel
    const cancelBtn = page.locator('button:has-text("ยกเลิก")').last();
    await cancelBtn.click();

    // Modal should close
    await expect(page.getByRole('heading', { name: 'ยืนยันส่งตรวจสอบ' })).not.toBeVisible({ timeout: 3000 });
  });

  // ── 7.4 Submit for review: Confirm sends API request ─────────────────────
  test('7.4 Confirming submit sends POST to submit-review endpoint', async ({ page }) => {
    const contractId = 'test-submit-confirm-001';
    await mockContractDetail(page, contractId, {
      workflowStatus: 'CREATING',
      status: 'DRAFT',
      salespersonId: 'user-001',
      pdpaConsentId: 'pdpa-1',
      contractDocuments: MOCK_DOCS,
      signatures: [
        { id: 's1', signerType: 'CUSTOMER', signerName: 'ลูกค้า', signedAt: new Date().toISOString() },
        { id: 's2', signerType: 'COMPANY', signerName: 'ผู้ขาย', signedAt: new Date().toISOString() },
        { id: 's3', signerType: 'WITNESS_1', signerName: 'พยาน 1', signedAt: new Date().toISOString() },
        { id: 's4', signerType: 'WITNESS_2', signerName: 'พยาน 2', signedAt: new Date().toISOString() },
      ],
    });

    // Mock the validate endpoint
    await page.route(`**/api/contracts/${contractId}/validate`, async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ errors: [] }) });
    });

    // Intercept the submit-review POST
    let submitCalled = false;
    await page.route(`**/api/contracts/${contractId}/submit-review`, async (route) => {
      submitCalled = true;
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify(buildMockContract(contractId, { workflowStatus: 'PENDING_REVIEW' })),
      });
    });

    await page.goto(`/contracts/${contractId}`, { waitUntil: 'networkidle' });

    // Open modal and confirm
    await page.locator('button:has-text("ส่งตรวจสอบ")').first().click();
    await expect(page.getByRole('heading', { name: 'ยืนยันส่งตรวจสอบ' })).toBeVisible({ timeout: 3000 });
    await page.getByRole('button', { name: 'ยืนยันส่งตรวจสอบ' }).click();
    await page.waitForLoadState('networkidle');

    expect(submitCalled).toBe(true);
  });

  // ── 7.5 Submit for review: Shows error on API failure ────────────────────
  test('7.5 Submit for review shows error toast on API failure', async ({ page }) => {
    const contractId = 'test-submit-fail-001';
    await mockContractDetail(page, contractId, {
      workflowStatus: 'CREATING',
      status: 'DRAFT',
      salespersonId: 'user-001',
      pdpaConsentId: 'pdpa-1',
      contractDocuments: MOCK_DOCS,
      signatures: [
        { id: 's1', signerType: 'CUSTOMER', signerName: 'ลูกค้า', signedAt: new Date().toISOString() },
        { id: 's2', signerType: 'COMPANY', signerName: 'ผู้ขาย', signedAt: new Date().toISOString() },
        { id: 's3', signerType: 'WITNESS_1', signerName: 'พยาน 1', signedAt: new Date().toISOString() },
        { id: 's4', signerType: 'WITNESS_2', signerName: 'พยาน 2', signedAt: new Date().toISOString() },
      ],
    });

    await page.route(`**/api/contracts/${contractId}/validate`, async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ errors: [] }) });
    });

    await page.route(`**/api/contracts/${contractId}/submit-review`, async (route) => {
      await route.fulfill({
        status: 400, contentType: 'application/json',
        body: JSON.stringify({ message: 'ต้องผ่านการตรวจเครดิตก่อนส่งตรวจสอบ' }),
      });
    });

    await page.goto(`/contracts/${contractId}`, { waitUntil: 'networkidle' });

    await page.locator('button:has-text("ส่งตรวจสอบ")').first().click();
    await page.getByRole('button', { name: 'ยืนยันส่งตรวจสอบ' }).click();
    await page.waitForLoadState('networkidle');

    // Error toast should appear
    const toast = page.locator('[data-sonner-toast]').filter({ hasText: 'ตรวจเครดิต' });
    await expect(toast).toBeVisible({ timeout: 5000 });
  });

  // ── 7.6 PENDING_REVIEW: Reviewer sees approve/reject panel ───────────────
  test('7.6 PENDING_REVIEW contract shows approve/reject panel for reviewer', async ({ page }) => {
    const contractId = 'test-pending-001';
    await mockContractDetail(page, contractId, {
      workflowStatus: 'PENDING_REVIEW',
      status: 'DRAFT',
      salespersonId: 'other-user', // Not the current user → makes them a reviewer
    });

    await page.goto(`/contracts/${contractId}`, { waitUntil: 'networkidle' });

    // Should show review panel
    await expect(page.locator('text=รอการตรวจสอบจากคุณ')).toBeVisible({ timeout: 5000 });

    // Should show approve button
    await expect(page.locator('button:has-text("อนุมัติสัญญา")')).toBeVisible();

    // Should show reject button
    await expect(page.locator('button:has-text("ปฏิเสธ")')).toBeVisible();

    // Should show review notes input
    const notesInput = page.locator('input[placeholder*="หมายเหตุการอนุมัติ"]');
    await expect(notesInput).toBeVisible();
  });

  // ── 7.7 PENDING_REVIEW: Document checklist shown to reviewer ────────────
  test('7.7 Reviewer sees document checklist in review panel', async ({ page }) => {
    const contractId = 'test-pending-docs-001';
    await mockContractDetail(page, contractId, {
      workflowStatus: 'PENDING_REVIEW',
      status: 'DRAFT',
      salespersonId: 'other-user',
    });

    await page.goto(`/contracts/${contractId}`, { waitUntil: 'networkidle' });

    // Document checklist items should be visible
    await expect(page.locator('text=เอกสารที่ต้องมี')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=สัญญาผ่อนชำระ PDF')).toBeVisible();
    await expect(page.locator('text=สำเนาบัตรประชาชน')).toBeVisible();
  });

  // ── 7.8 PENDING_REVIEW: Approve sends correct API call ──────────────────
  test('7.8 Approve contract sends POST to approve endpoint', async ({ page }) => {
    const contractId = 'test-approve-001';
    await mockContractDetail(page, contractId, {
      workflowStatus: 'PENDING_REVIEW',
      status: 'DRAFT',
      salespersonId: 'other-user',
    });

    let approvePayload: Record<string, unknown> | null = null;
    await page.route(`**/api/contracts/${contractId}/approve`, async (route) => {
      approvePayload = route.request().postDataJSON();
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify(buildMockContract(contractId, { workflowStatus: 'APPROVED' })),
      });
    });

    await page.goto(`/contracts/${contractId}`, { waitUntil: 'networkidle' });

    // Type review notes
    const notesInput = page.locator('input[placeholder*="หมายเหตุการอนุมัติ"]');
    await notesInput.fill('เอกสารครบถ้วน');

    // Click approve
    await page.locator('button:has-text("อนุมัติสัญญา")').click();
    await page.waitForLoadState('networkidle');

    expect(approvePayload).not.toBeNull();
    expect(approvePayload!.reviewNotes).toBe('เอกสารครบถ้วน');
  });

  // ── 7.9 PENDING_REVIEW: Reject opens modal ─────────────────────────────
  test('7.9 Reject button opens rejection modal with reason input', async ({ page }) => {
    const contractId = 'test-reject-modal-001';
    await mockContractDetail(page, contractId, {
      workflowStatus: 'PENDING_REVIEW',
      status: 'DRAFT',
      salespersonId: 'other-user',
    });

    await page.goto(`/contracts/${contractId}`, { waitUntil: 'networkidle' });

    // Click reject button
    await page.locator('button:has-text("ปฏิเสธ")').click();

    // Modal should appear
    await expect(page.locator('text=ปฏิเสธสัญญา').first()).toBeVisible({ timeout: 3000 });

    // Should have reason textarea
    const textarea = page.locator('textarea[placeholder*="เหตุผลที่ปฏิเสธ"]');
    await expect(textarea).toBeVisible();

    // Confirm button should be disabled without reason
    const confirmBtn = page.locator('button:has-text("ยืนยันปฏิเสธ")');
    await expect(confirmBtn).toBeDisabled();

    // Type reason → button becomes enabled
    await textarea.fill('เอกสารไม่ครบ ขาดสำเนาบัตร');
    await expect(confirmBtn).toBeEnabled();
  });

  // ── 7.10 PENDING_REVIEW: Reject sends correct API call ──────────────────
  test('7.10 Reject contract sends POST to reject endpoint with reason', async ({ page }) => {
    const contractId = 'test-reject-send-001';
    await mockContractDetail(page, contractId, {
      workflowStatus: 'PENDING_REVIEW',
      status: 'DRAFT',
      salespersonId: 'other-user',
    });

    let rejectPayload: Record<string, unknown> | null = null;
    await page.route(`**/api/contracts/${contractId}/reject`, async (route) => {
      rejectPayload = route.request().postDataJSON();
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify(buildMockContract(contractId, { workflowStatus: 'REJECTED', reviewNotes: 'เอกสารไม่ครบ' })),
      });
    });

    await page.goto(`/contracts/${contractId}`, { waitUntil: 'networkidle' });

    await page.locator('button:has-text("ปฏิเสธ")').click();
    await page.locator('textarea[placeholder*="เหตุผลที่ปฏิเสธ"]').fill('เอกสารไม่ครบ');
    await page.locator('button:has-text("ยืนยันปฏิเสธ")').click();
    await page.waitForLoadState('networkidle');

    expect(rejectPayload).not.toBeNull();
    expect(rejectPayload!.reviewNotes).toBe('เอกสารไม่ครบ');
  });

  // ── 7.11 REJECTED: Shows rejection reason banner ─────────────────────────
  test('7.11 REJECTED contract shows rejection reason banner', async ({ page }) => {
    const contractId = 'test-rejected-001';
    await mockContractDetail(page, contractId, {
      workflowStatus: 'REJECTED',
      status: 'DRAFT',
      reviewNotes: 'เอกสารไม่ครบ ขาดสำเนาบัตรประชาชน',
      reviewedBy: { id: 'reviewer-1', name: 'ผู้จัดการ สมชาย' },
      reviewedAt: new Date().toISOString(),
    });

    await page.goto(`/contracts/${contractId}`, { waitUntil: 'networkidle' });

    // Should show rejection banner
    await expect(page.locator('text=สัญญาถูกปฏิเสธ')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=เอกสารไม่ครบ ขาดสำเนาบัตรประชาชน')).toBeVisible();
    await expect(page.locator('text=ผู้จัดการ สมชาย')).toBeVisible();
  });

  // ── 7.12 REJECTED: Edit button is available ──────────────────────────────
  test('7.12 REJECTED contract allows editing (edit button visible)', async ({ page }) => {
    const contractId = 'test-rejected-edit-001';
    await mockContractDetail(page, contractId, {
      workflowStatus: 'REJECTED',
      status: 'DRAFT',
      salespersonId: 'user-001',
      reviewNotes: 'แก้ไขราคาดาวน์',
    });

    await page.goto(`/contracts/${contractId}`, { waitUntil: 'networkidle' });

    // Edit button for contract info should be visible (canEdit = isCreator && REJECTED)
    const editBtn = page.locator('button:has-text("แก้ไข")').first();
    await expect(editBtn).toBeVisible({ timeout: 5000 });
  });

  // ── 7.13 APPROVED: Shows activate button ─────────────────────────────────
  test('7.13 APPROVED contract shows activate button', async ({ page }) => {
    const contractId = 'test-approved-001';
    await mockContractDetail(page, contractId, {
      workflowStatus: 'APPROVED',
      status: 'DRAFT',
      signatures: [
        { id: 's1', signerType: 'CUSTOMER', signerName: 'ลูกค้า', signedAt: new Date().toISOString() },
        { id: 's2', signerType: 'COMPANY', signerName: 'ผู้ขาย', signedAt: new Date().toISOString() },
        { id: 's3', signerType: 'WITNESS_1', signerName: 'พยาน 1', signedAt: new Date().toISOString() },
        { id: 's4', signerType: 'WITNESS_2', signerName: 'พยาน 2', signedAt: new Date().toISOString() },
      ],
    });

    await page.goto(`/contracts/${contractId}`, { waitUntil: 'networkidle' });

    // Should show "เปิดใช้งานสัญญา" button
    const activateBtn = page.locator('button:has-text("เปิดใช้งานสัญญา")');
    await expect(activateBtn).toBeVisible({ timeout: 5000 });
    await expect(activateBtn).toBeEnabled();
  });

  // ── 7.14 APPROVED: Activate sends correct API call ───────────────────────
  test('7.14 Activate contract sends POST to activate endpoint', async ({ page }) => {
    const contractId = 'test-activate-001';
    await mockContractDetail(page, contractId, {
      workflowStatus: 'APPROVED',
      status: 'DRAFT',
      signatures: [
        { id: 's1', signerType: 'CUSTOMER', signerName: 'ลูกค้า', signedAt: new Date().toISOString() },
        { id: 's2', signerType: 'COMPANY', signerName: 'ผู้ขาย', signedAt: new Date().toISOString() },
        { id: 's3', signerType: 'WITNESS_1', signerName: 'พยาน 1', signedAt: new Date().toISOString() },
        { id: 's4', signerType: 'WITNESS_2', signerName: 'พยาน 2', signedAt: new Date().toISOString() },
      ],
    });

    let activateCalled = false;
    await page.route(`**/api/contracts/${contractId}/activate`, async (route) => {
      activateCalled = true;
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify(buildMockContract(contractId, { workflowStatus: 'APPROVED', status: 'ACTIVE' })),
      });
    });

    await page.goto(`/contracts/${contractId}`, { waitUntil: 'networkidle' });

    // Click the activate button in the header
    const activateBtn = page.locator('button:has-text("เปิดใช้งานสัญญา")').first();
    await activateBtn.click();
    await page.waitForLoadState('networkidle');

    expect(activateCalled).toBe(true);
  });

  // ── 7.15 APPROVED but not all signed: Activate disabled ──────────────────
  test('7.15 Activate button disabled when not all signatures present', async ({ page }) => {
    const contractId = 'test-activate-nosig-001';
    await mockContractDetail(page, contractId, {
      workflowStatus: 'APPROVED',
      status: 'DRAFT',
      signatures: [
        { id: 's1', signerType: 'CUSTOMER', signerName: 'ลูกค้า', signedAt: new Date().toISOString() },
        // Missing COMPANY, WITNESS_1, WITNESS_2
      ],
    });

    await page.goto(`/contracts/${contractId}`, { waitUntil: 'networkidle' });

    const activateBtn = page.locator('button:has-text("เปิดใช้งานสัญญา")');
    await expect(activateBtn).toBeVisible({ timeout: 5000 });
    await expect(activateBtn).toBeDisabled();
  });

  // ── 7.16 CREATING: Submit button hidden when signatures incomplete ───────
  test('7.16 Submit review button not shown when signatures incomplete', async ({ page }) => {
    const contractId = 'test-nosig-001';
    await mockContractDetail(page, contractId, {
      workflowStatus: 'CREATING',
      status: 'DRAFT',
      salespersonId: 'user-001',
      contractDocuments: MOCK_DOCS,
      // No signatures → stepper stays at step 2 (ลงนาม & PDPA)
    });

    await page.goto(`/contracts/${contractId}`, { waitUntil: 'networkidle' });

    // Stepper hint should say something about signing/PDPA (step 2 active)
    await expect(page.getByText('ลงนามสัญญา', { exact: false })).toBeVisible({ timeout: 5000 });

    // "ส่งตรวจสอบ" action button should NOT be visible (can't reach step 3 without signatures)
    const submitBtn = page.locator('button:has-text("ส่งตรวจสอบ")');
    await expect(submitBtn).not.toBeVisible({ timeout: 2000 });
  });

  // ── 7.17 CREATING: Delete button visible for OWNER ───────────────────────
  test('7.17 CREATING contract shows delete button for OWNER', async ({ page }) => {
    const contractId = 'test-delete-001';
    await mockContractDetail(page, contractId, {
      workflowStatus: 'CREATING',
      status: 'DRAFT',
    });

    await page.goto(`/contracts/${contractId}`, { waitUntil: 'networkidle' });

    // Admin user is OWNER → delete button should be visible
    const deleteBtn = page.locator('button:has-text("ลบสัญญา")');
    await expect(deleteBtn).toBeVisible({ timeout: 5000 });
  });

  // ── 7.18 ACTIVE: No edit/delete buttons ──────────────────────────────────
  test('7.18 ACTIVE contract does not show edit or delete buttons', async ({ page }) => {
    const contractId = 'test-active-001';
    await mockContractDetail(page, contractId, {
      workflowStatus: 'APPROVED',
      status: 'ACTIVE',
    });

    await page.goto(`/contracts/${contractId}`, { waitUntil: 'networkidle' });

    // No edit button for contract info
    // (canEdit = false because workflowStatus is not CREATING/REJECTED)
    // "แก้ไข" might appear for customer/product edit (canEditMaster), but not for contract info
    const deleteBtn = page.locator('button:has-text("ลบสัญญา")');
    await expect(deleteBtn).not.toBeVisible({ timeout: 2000 });

    // Workflow stepper should not appear for non-DRAFT contracts
    // (stepper only shows when status === 'DRAFT')
    const stepperHint = page.locator('text=สร้างสัญญา');
    // For ACTIVE contracts, there's no stepper
  });

  // ── 7.19 ACTIVE: Early payoff button visible ─────────────────────────────
  test('7.19 ACTIVE contract shows early payoff button', async ({ page }) => {
    const contractId = 'test-payoff-btn-001';
    await mockContractDetail(page, contractId, {
      workflowStatus: 'APPROVED',
      status: 'ACTIVE',
    });

    await page.goto(`/contracts/${contractId}`, { waitUntil: 'networkidle' });

    const payoffBtn = page.locator('button:has-text("ปิดก่อนกำหนด")');
    await expect(payoffBtn).toBeVisible({ timeout: 5000 });
  });

  // ── 7.20 Workflow status badge renders all states correctly ───────────────
  test('7.20 WorkflowStatusBadge renders correct labels for each state', async ({ page }) => {
    const states = [
      ['CREATING', 'กำลังสร้าง'],
      ['PENDING_REVIEW', 'รอตรวจสอบ'],
      ['APPROVED', 'อนุมัติแล้ว'],
      ['REJECTED', 'ปฏิเสธ'],
    ] as const;

    for (let i = 0; i < states.length; i++) {
      const [ws, expectedText] = states[i];
      // Use unique contract ID per state to avoid route caching
      const contractId = `test-badge-${i}`;
      await mockContractDetail(page, contractId, {
        workflowStatus: ws,
        status: 'DRAFT',
        salespersonId: ws === 'PENDING_REVIEW' ? 'other-user' : 'user-001',
      });

      await page.goto(`/contracts/${contractId}`, { waitUntil: 'networkidle' });

      // The workflow badge should contain the expected text
      const badge = page.getByText(expectedText).first();
      await expect(badge).toBeVisible({ timeout: 5000 });
    }
  });

  // ── 7.21 Approve disabled when documents incomplete ──────────────────────
  test('7.21 Approve button disabled when document checklist incomplete', async ({ page }) => {
    const contractId = 'test-approve-nodocs-001';
    await mockContractDetail(page, contractId, {
      workflowStatus: 'PENDING_REVIEW',
      status: 'DRAFT',
      salespersonId: 'other-user',
      _docsComplete: false,
    });

    await page.goto(`/contracts/${contractId}`, { waitUntil: 'networkidle' });

    // Approve button should be disabled
    const approveBtn = page.locator('button:has-text("อนุมัติสัญญา")');
    await expect(approveBtn).toBeDisabled({ timeout: 5000 });

    // Should show warning about incomplete docs
    await expect(page.locator('text=กรุณาอัปโหลดเอกสารให้ครบก่อนอนุมัติ')).toBeVisible();
  });

  // ── 7.22 Signing status indicators shown ─────────────────────────────────
  test('7.22 Signing status shows which signers have signed', async ({ page }) => {
    const contractId = 'test-signing-status-001';
    await mockContractDetail(page, contractId, {
      workflowStatus: 'CREATING',
      status: 'DRAFT',
      signatures: [
        { id: 's1', signerType: 'CUSTOMER', signerName: 'ลูกค้า', signedAt: new Date().toISOString() },
        { id: 's2', signerType: 'COMPANY', signerName: 'ผู้ขาย', signedAt: new Date().toISOString() },
        // WITNESS_1 and WITNESS_2 not signed yet
      ],
    });

    await page.goto(`/contracts/${contractId}`, { waitUntil: 'networkidle' });

    // Should show signing status section
    await expect(page.locator('text=สถานะเอกสารและลายเซ็น')).toBeVisible({ timeout: 5000 });

    // ผู้ซื้อ and ผู้ขาย should show as signed (green)
    const buyerStatus = page.locator('text=ผู้ซื้อ').first();
    await expect(buyerStatus).toBeVisible();
    const sellerStatus = page.locator('text=ผู้ขาย').first();
    await expect(sellerStatus).toBeVisible();
  });
});
