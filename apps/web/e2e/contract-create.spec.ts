import { test, expect, Page } from '@playwright/test';
import { loginWithMock } from './helpers/mock-auth';

// ============================================================================
// BESTCHOICE Contract Creation - 4-Step Wizard (Phase 16)
// Route: /contracts/create
//
// Tests:
//   - Step indicators display
//   - Step 0: Product search + selection
//   - Step 1: Customer search + selection + credit check gating
//   - Step 2: Plan details + calculation preview
//   - Step 3: Document upload section + submit buttons
//   - Navigation (next/back/cancel)
//   - Submission flow (draft + submit for review)
// ============================================================================

const MOCK_PRODUCTS = [
  {
    id: 'prod-1', name: 'iPhone 15', brand: 'Apple', model: 'iPhone 15',
    category: 'PHONE_NEW', status: 'IN_STOCK', branchId: 'branch-1',
    branch: { id: 'branch-1', name: 'สาขาหลัก' },
    prices: [
      { id: 'price-1', label: 'ราคาผ่อน BESTCHOICE', amount: '15000', isDefault: true },
      { id: 'price-2', label: 'ราคาสด', amount: '13000', isDefault: false },
    ],
  },
  {
    id: 'prod-2', name: 'Samsung Galaxy S24', brand: 'Samsung', model: 'Galaxy S24',
    category: 'PHONE_NEW', status: 'IN_STOCK', branchId: 'branch-1',
    branch: { id: 'branch-1', name: 'สาขาหลัก' },
    prices: [
      { id: 'price-3', label: 'ราคาผ่อน BESTCHOICE', amount: '12000', isDefault: true },
    ],
  },
];

const MOCK_CUSTOMERS = [
  { id: 'cust-1', name: 'สมชาย ใจดี', phone: '0812345678', nationalId: '1234567890123', salary: '25000', occupation: 'พนักงาน' },
  { id: 'cust-2', name: 'สมหญิง รักดี', phone: '0898765432', nationalId: '9876543210987', salary: '30000', occupation: 'ธุรกิจส่วนตัว' },
];

const INTEREST_CONFIG = {
  id: 'ic-1', name: 'มือถือใหม่', productCategories: ['PHONE_NEW'],
  interestRate: '0.08', minDownPaymentPct: '0.15', storeCommissionPct: '0.10',
  vatPct: '0.07', minInstallmentMonths: 6, maxInstallmentMonths: 12,
};

async function mockCreatePageApis(page: Page, options: { creditApproved?: boolean; emptyProducts?: boolean } = {}) {
  const { creditApproved = true, emptyProducts = false } = options;

  await page.route('**/api/products?*', async (route) => {
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ data: emptyProducts ? [] : MOCK_PRODUCTS, total: emptyProducts ? 0 : 2 }),
    });
  });

  await page.route('**/api/customers?*', async (route) => {
    const url = new URL(route.request().url());
    const search = url.searchParams.get('search') || '';
    const filtered = search ? MOCK_CUSTOMERS.filter(c => c.name.includes(search) || c.phone.includes(search)) : MOCK_CUSTOMERS;
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ data: filtered, total: filtered.length }),
    });
  });

  await page.route('**/api/customers/*/credit-check/latest', async (route) => {
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify(creditApproved ? { id: 'cc-1', status: 'APPROVED', aiScore: 85 } : { id: 'cc-2', status: 'PENDING', aiScore: null }),
    });
  });

  await page.route('**/api/interest-configs/by-category/*', async (route) => {
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify(INTEREST_CONFIG),
    });
  });

  await page.route('**/api/sales/config', async (route) => {
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ interestRate: 0.08, minDownPaymentPct: 0.15, storeCommissionPct: 0.10, vatPct: 0.07, minInstallmentMonths: 6, maxInstallmentMonths: 12 }),
    });
  });

  await page.route('**/api/contracts', async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({
        status: 201, contentType: 'application/json',
        body: JSON.stringify({ id: 'new-contract-1', contractNumber: 'BCP-NEW-001' }),
      });
    } else {
      await route.continue();
    }
  });

  await page.route('**/api/contracts/new-contract-1/documents', async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'doc-1' }) });
    } else {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) });
    }
  });

  await page.route('**/api/contracts/new-contract-1/submit-review', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) });
  });

  // Mock detail page for redirect after creation
  await page.route('**/api/contracts/new-contract-1', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ id: 'new-contract-1', contractNumber: 'BCP-NEW-001', status: 'DRAFT', workflowStatus: 'CREATING', planType: 'STORE_DIRECT', sellingPrice: '15000', downPayment: '2250', totalMonths: 6, interestRate: '0.08', interestTotal: '600', financedAmount: '13200', monthlyPayment: '2200', paymentDueDay: 1, notes: '', creditBalance: null, dunningStage: null, contractHash: null, pdpaConsentId: null, reviewNotes: null, reviewedAt: null, reviewedBy: null, createdAt: '2026-01-15T10:00:00.000Z', customer: MOCK_CUSTOMERS[0], product: MOCK_PRODUCTS[0], salesperson: { id: 'user-001', name: 'Admin' }, branch: { id: 'branch-1', name: 'สาขาหลัก' }, payments: [], signatures: [], contractDocuments: [], creditCheck: null, interestConfig: null }),
      });
    } else { await route.continue(); }
  });

  await page.route('**/api/contracts/new-contract-1/early-payoff-quote', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ remainingMonths: 6, remainingPrincipal: 12000, remainingInterest: 600, discount: 300, unpaidLateFees: 0, totalPayoff: 12300 }) });
  });

  await page.route('**/api/contracts/new-contract-1/documents/checklist', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ complete: false, checklist: [] }) });
  });

  await page.route('**/api/customers', async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({
        status: 201, contentType: 'application/json',
        body: JSON.stringify({ id: 'cust-new', name: 'ลูกค้าใหม่ ทดสอบ', phone: '0899999999', nationalId: '1111111111111' }),
      });
    } else { await route.continue(); }
  });
}

test.describe('Phase 16: Contract Creation - 4-Step Wizard', () => {
  test.beforeEach(async ({ page }) => {
    await loginWithMock(page);
  });

  // ── 16.1 Page header and step indicators ──────────────────────────────
  test('16.1 Shows page header and 4-step indicators', async ({ page }) => {
    await mockCreatePageApis(page);
    await page.goto('/contracts/create', { waitUntil: 'networkidle' });

    await expect(page.getByText('สร้างสัญญาผ่อนชำระ')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('เลือกสินค้า').first()).toBeVisible();

    // Step numbers 1-4
    await expect(page.locator('text=1').first()).toBeVisible();
  });

  // ── 16.2 Step 0: Product list displays ─────────────────────────────────
  test('16.2 Step 0 shows product list with search input', async ({ page }) => {
    await mockCreatePageApis(page);
    await page.goto('/contracts/create', { waitUntil: 'networkidle' });

    // Search input
    await expect(page.locator('input[placeholder*="ค้นหาสินค้า"]')).toBeVisible({ timeout: 5000 });

    // Product cards (brand + model rendered together, also product name below)
    await expect(page.locator('text=Apple iPhone 15').first()).toBeVisible();
    await expect(page.locator('text=Samsung Galaxy S24').first()).toBeVisible();

    // Price display
    await expect(page.getByText('15,000 ฿').first()).toBeVisible();
  });

  // ── 16.3 Step 0: Empty products shows message ─────────────────────────
  test('16.3 Step 0 shows empty message when no products', async ({ page }) => {
    await mockCreatePageApis(page, { emptyProducts: true });
    await page.goto('/contracts/create', { waitUntil: 'networkidle' });

    await expect(page.getByText('ไม่พบสินค้าที่พร้อมขาย')).toBeVisible({ timeout: 5000 });
  });

  // ── 16.4 Next button disabled without product selection ────────────────
  test('16.4 Next button disabled when no product selected', async ({ page }) => {
    await mockCreatePageApis(page);
    await page.goto('/contracts/create', { waitUntil: 'networkidle' });

    const nextBtn = page.locator('button:has-text("ถัดไป")');
    await expect(nextBtn).toBeVisible({ timeout: 5000 });
    await expect(nextBtn).toBeDisabled();
  });

  // ── 16.5 Select product enables next ──────────────────────────────────
  test('16.5 Selecting product enables next button', async ({ page }) => {
    await mockCreatePageApis(page);
    await page.goto('/contracts/create', { waitUntil: 'networkidle' });

    // Click a product
    await page.getByText('Apple iPhone 15').click();

    const nextBtn = page.locator('button:has-text("ถัดไป")');
    await expect(nextBtn).toBeEnabled();
  });

  // ── 16.6 Navigate to Step 1: Customer selection ────────────────────────
  test('16.6 Step 1 shows customer list and add-new button', async ({ page }) => {
    await mockCreatePageApis(page);
    await page.goto('/contracts/create', { waitUntil: 'networkidle' });

    // Select product and go next
    await page.getByText('Apple iPhone 15').click();
    await page.locator('button:has-text("ถัดไป")').click();
    await page.waitForLoadState('networkidle');

    // Step 1 elements
    await expect(page.getByText('เลือกลูกค้า').first()).toBeVisible({ timeout: 5000 });
    await expect(page.locator('input[placeholder*="ค้นหาลูกค้า"]')).toBeVisible();
    await expect(page.getByText('เพิ่มลูกค้าใหม่')).toBeVisible();

    // Customer cards
    await expect(page.getByText('สมชาย ใจดี')).toBeVisible();
    await expect(page.getByText('สมหญิง รักดี')).toBeVisible();
  });

  // ── 16.7 Credit check approved allows next ─────────────────────────────
  test('16.7 Customer with approved credit shows ผ่าน and allows next', async ({ page }) => {
    await mockCreatePageApis(page, { creditApproved: true });
    await page.goto('/contracts/create', { waitUntil: 'networkidle' });

    // Go to step 1
    await page.getByText('Apple iPhone 15').click();
    await page.locator('button:has-text("ถัดไป")').click();
    await page.waitForLoadState('networkidle');

    // Select customer
    await page.getByText('สมชาย ใจดี').click();
    await page.waitForLoadState('networkidle');

    // Credit status shows approved
    await expect(page.getByText('สถานะเครดิต: ผ่าน')).toBeVisible({ timeout: 5000 });

    // Next button enabled
    await expect(page.locator('button:has-text("ถัดไป")')).toBeEnabled();
  });

  // ── 16.8 Credit check not approved blocks next ─────────────────────────
  test('16.8 Customer without credit approval blocks next and shows warning', async ({ page }) => {
    await mockCreatePageApis(page, { creditApproved: false });
    await page.goto('/contracts/create', { waitUntil: 'networkidle' });

    // Go to step 1
    await page.getByText('Apple iPhone 15').click();
    await page.locator('button:has-text("ถัดไป")').click();
    await page.waitForLoadState('networkidle');

    // Select customer
    await page.getByText('สมชาย ใจดี').click();
    await page.waitForLoadState('networkidle');

    // Warning message
    await expect(page.getByText('ลูกค้าต้องผ่านการตรวจเครดิตก่อนถึงจะสร้างสัญญาได้')).toBeVisible({ timeout: 5000 });

    // "Go to credit check" button
    await expect(page.getByText('ไปตรวจเครดิต')).toBeVisible();

    // Next disabled
    await expect(page.locator('button:has-text("ถัดไป")')).toBeDisabled();
  });

  // ── 16.9 Step 2: Plan details with calculation ─────────────────────────
  test('16.9 Step 2 shows plan form and calculation summary', async ({ page }) => {
    await mockCreatePageApis(page);
    await page.goto('/contracts/create', { waitUntil: 'networkidle' });

    // Navigate to step 2
    await page.getByText('Apple iPhone 15').click();
    await page.locator('button:has-text("ถัดไป")').click();
    await page.waitForLoadState('networkidle');
    await page.getByText('สมชาย ใจดี').click();
    await page.locator('button:has-text("ถัดไป")').click();
    await page.waitForLoadState('networkidle');

    // Step 2 label
    await expect(page.getByText('เลือกแผนผ่อน').first()).toBeVisible({ timeout: 5000 });

    // Form fields (use label locator to avoid matching calc summary)
    await expect(page.locator('label:has-text("เงินดาวน์")')).toBeVisible();
    await expect(page.locator('label:has-text("จำนวนงวด")')).toBeVisible();
    await expect(page.locator('label:has-text("วันที่ครบกำหนดชำระ")')).toBeVisible();

    // Calculation summary
    await expect(page.getByText('สรุปการคำนวณ')).toBeVisible();
    await expect(page.getByText('ยอดปล่อย (Loan)')).toBeVisible();
  });

  // ── 16.10 Step 2: Interest config badge shows ──────────────────────────
  test('16.10 Step 2 shows interest config badge', async ({ page }) => {
    await mockCreatePageApis(page);
    await page.goto('/contracts/create', { waitUntil: 'networkidle' });

    // Navigate to step 2
    await page.getByText('Apple iPhone 15').click();
    await page.locator('button:has-text("ถัดไป")').click();
    await page.waitForLoadState('networkidle');
    await page.getByText('สมชาย ใจดี').click();
    await page.locator('button:has-text("ถัดไป")').click();
    await page.waitForLoadState('networkidle');

    await expect(page.getByText('ใช้ดอกเบี้ยตาม:')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('มือถือใหม่')).toBeVisible();
  });

  // ── 16.11 Step 3: Document upload section ──────────────────────────────
  test('16.11 Step 3 shows document upload zones and submit buttons', async ({ page }) => {
    await mockCreatePageApis(page);
    await page.goto('/contracts/create', { waitUntil: 'networkidle' });

    // Navigate to step 3
    await page.getByText('Apple iPhone 15').click();
    await page.locator('button:has-text("ถัดไป")').click();
    await page.waitForLoadState('networkidle');
    await page.getByText('สมชาย ใจดี').click();
    await page.locator('button:has-text("ถัดไป")').click();
    await page.waitForLoadState('networkidle');
    await page.locator('button:has-text("ถัดไป")').click();
    await page.waitForLoadState('networkidle');

    // Step 3 heading
    await expect(page.getByRole('heading', { name: 'แนบเอกสาร' })).toBeVisible({ timeout: 5000 });

    // Required document types
    await expect(page.getByText('สำเนาบัตรประชาชน (หน้า)')).toBeVisible();
    await expect(page.getByText('รูปถ่ายลูกค้าถือบัตรประชาชน')).toBeVisible();
    await expect(page.getByText('รูปถ่ายสินค้า')).toBeVisible();
    await expect(page.getByText('หลักฐานการชำระเงินดาวน์')).toBeVisible();

    // Optional documents header
    await expect(page.getByText('เอกสารเพิ่มเติม (ไม่บังคับ)')).toBeVisible();

    // Submit buttons
    await expect(page.locator('button:has-text("บันทึกร่าง")')).toBeVisible();
    await expect(page.locator('button:has-text("สร้าง + ส่งตรวจสอบ")')).toBeVisible();
  });

  // ── 16.12 Back button works ────────────────────────────────────────────
  test('16.12 Back button navigates to previous step', async ({ page }) => {
    await mockCreatePageApis(page);
    await page.goto('/contracts/create', { waitUntil: 'networkidle' });

    // Go to step 1
    await page.getByText('Apple iPhone 15').click();
    await page.locator('button:has-text("ถัดไป")').click();
    await page.waitForLoadState('networkidle');

    // Should be on step 1
    await expect(page.getByText('เลือกลูกค้า').first()).toBeVisible({ timeout: 5000 });

    // Click back
    await page.locator('button:has-text("ย้อนกลับ")').click();

    // Should be back on step 0
    await expect(page.locator('input[placeholder*="ค้นหาสินค้า"]')).toBeVisible({ timeout: 5000 });
  });

  // ── 16.13 Back button hidden on step 0 ─────────────────────────────────
  test('16.13 Back button is hidden on step 0', async ({ page }) => {
    await mockCreatePageApis(page);
    await page.goto('/contracts/create', { waitUntil: 'networkidle' });

    // Back button should be invisible on step 0
    const backBtn = page.locator('button:has-text("ย้อนกลับ")');
    await expect(backBtn).not.toBeVisible();
  });

  // ── 16.14 Cancel button navigates to contracts list ────────────────────
  test('16.14 Cancel button navigates to contracts list', async ({ page }) => {
    await mockCreatePageApis(page);

    // Also mock contracts list for the redirect
    await page.route('**/api/contracts?*', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [], total: 0, page: 1, totalPages: 0 }) });
    });

    await page.goto('/contracts/create', { waitUntil: 'networkidle' });

    await page.locator('button:has-text("ยกเลิก")').click();
    await page.waitForURL('**/contracts', { timeout: 5000 });
  });

  // ── 16.15 Submit draft sends POST ──────────────────────────────────────
  test('16.15 Save draft sends POST to contracts endpoint', async ({ page }) => {
    await mockCreatePageApis(page);

    let apiCalled = false;
    let apiBody: Record<string, unknown> = {};
    await page.route('**/api/contracts', async (route) => {
      if (route.request().method() === 'POST') {
        apiCalled = true;
        apiBody = route.request().postDataJSON();
        await route.fulfill({
          status: 201, contentType: 'application/json',
          body: JSON.stringify({ id: 'new-contract-1', contractNumber: 'BCP-NEW-001' }),
        });
      } else { await route.continue(); }
    });

    await page.goto('/contracts/create', { waitUntil: 'networkidle' });

    // Step 0: Select product
    await page.getByText('Apple iPhone 15').click();
    await page.locator('button:has-text("ถัดไป")').click();
    await page.waitForLoadState('networkidle');

    // Step 1: Select customer
    await page.getByText('สมชาย ใจดี').click();
    await page.locator('button:has-text("ถัดไป")').click();
    await page.waitForLoadState('networkidle');

    // Step 2: Skip (defaults are fine)
    await page.locator('button:has-text("ถัดไป")').click();
    await page.waitForLoadState('networkidle');

    // Step 3: Save draft
    await page.locator('button:has-text("บันทึกร่าง")').click();
    await page.waitForLoadState('networkidle');

    expect(apiCalled).toBe(true);
    expect(apiBody.productId).toBe('prod-1');
    expect(apiBody.customerId).toBe('cust-1');
    expect(apiBody.planType).toBe('STORE_DIRECT');
  });

  // ── 16.16 Submit for review sends POST + submit-review ─────────────────
  test('16.16 Create + submit review sends POST and then submit-review', async ({ page }) => {
    await mockCreatePageApis(page);

    let submitReviewCalled = false;
    await page.route('**/api/contracts/new-contract-1/submit-review', async (route) => {
      submitReviewCalled = true;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) });
    });

    await page.goto('/contracts/create', { waitUntil: 'networkidle' });

    // Navigate through all steps
    await page.getByText('Apple iPhone 15').click();
    await page.locator('button:has-text("ถัดไป")').click();
    await page.waitForLoadState('networkidle');
    await page.getByText('สมชาย ใจดี').click();
    await page.locator('button:has-text("ถัดไป")').click();
    await page.waitForLoadState('networkidle');
    await page.locator('button:has-text("ถัดไป")').click();
    await page.waitForLoadState('networkidle');

    // Click create + submit
    await page.locator('button:has-text("สร้าง + ส่งตรวจสอบ")').click();
    await page.waitForLoadState('networkidle');

    expect(submitReviewCalled).toBe(true);
  });

  // ── 16.17 Add new customer button opens modal ──────────────────────────
  test('16.17 Add new customer button opens customer creation modal', async ({ page }) => {
    await mockCreatePageApis(page);
    await page.goto('/contracts/create', { waitUntil: 'networkidle' });

    // Go to step 1
    await page.getByText('Apple iPhone 15').click();
    await page.locator('button:has-text("ถัดไป")').click();
    await page.waitForLoadState('networkidle');

    // Click add new customer
    await page.getByText('เพิ่มลูกค้าใหม่').click();

    // Modal should open with form sections
    await expect(page.getByText('ข้อมูลส่วนตัว')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('ข้อมูลติดต่อ')).toBeVisible();
    await expect(page.getByText('รายชื่อบุคคลอ้างอิง')).toBeVisible();
  });

  // ── 16.18 Step 3 summary panel expandable ──────────────────────────────
  test('16.18 Step 3 has expandable contract summary panel', async ({ page }) => {
    await mockCreatePageApis(page);
    await page.goto('/contracts/create', { waitUntil: 'networkidle' });

    // Navigate to step 3
    await page.getByText('Apple iPhone 15').click();
    await page.locator('button:has-text("ถัดไป")').click();
    await page.waitForLoadState('networkidle');
    await page.getByText('สมชาย ใจดี').click();
    await page.locator('button:has-text("ถัดไป")').click();
    await page.waitForLoadState('networkidle');
    await page.locator('button:has-text("ถัดไป")').click();
    await page.waitForLoadState('networkidle');

    // Summary panel
    const summary = page.locator('summary:has-text("สรุปสัญญาก่อนยืนยัน")');
    await expect(summary).toBeVisible({ timeout: 5000 });

    // Click to expand
    await summary.click();

    // Should show product and customer info
    await expect(page.getByText('สมชาย ใจดี').first()).toBeVisible();
  });

  // ── 16.19 Step 2 month selector shows correct range ────────────────────
  test('16.19 Step 2 month selector shows 6-12 month range', async ({ page }) => {
    await mockCreatePageApis(page);
    await page.goto('/contracts/create', { waitUntil: 'networkidle' });

    // Navigate to step 2
    await page.getByText('Apple iPhone 15').click();
    await page.locator('button:has-text("ถัดไป")').click();
    await page.waitForLoadState('networkidle');
    await page.getByText('สมชาย ใจดี').click();
    await page.locator('button:has-text("ถัดไป")').click();
    await page.waitForLoadState('networkidle');

    // Month selector should have options 6-12
    const monthSelect = page.locator('select').first();
    await expect(monthSelect.locator('option:has-text("6 เดือน")')).toHaveCount(1);
    await expect(monthSelect.locator('option:has-text("12 เดือน")')).toHaveCount(1);
  });

  // ── 16.20 Step 2 payment due day selector ──────────────────────────────
  test('16.20 Step 2 due day selector includes 1-28 and สิ้นเดือน', async ({ page }) => {
    await mockCreatePageApis(page);
    await page.goto('/contracts/create', { waitUntil: 'networkidle' });

    // Navigate to step 2
    await page.getByText('Apple iPhone 15').click();
    await page.locator('button:has-text("ถัดไป")').click();
    await page.waitForLoadState('networkidle');
    await page.getByText('สมชาย ใจดี').click();
    await page.locator('button:has-text("ถัดไป")').click();
    await page.waitForLoadState('networkidle');

    // Due day selector should have end-of-month option
    const dueDaySelect = page.locator('select').nth(1);
    await expect(dueDaySelect.locator('option:has-text("สิ้นเดือน")')).toHaveCount(1);
  });
});
