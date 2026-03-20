import { test, expect, Page } from '@playwright/test';
import { loginViaAPI } from './helpers/auth';

// ============================================================================
// BESTCHOICE Contracts List - Filters & Tabs (Phase 12)
// Route: /contracts
//
// Tests:
//   - Tab ทั้งหมด / สัญญาของฉัน / รอตรวจสอบ
//   - Search filter → URL update
//   - Status filter dropdown
//   - Workflow filter dropdown (only on "ทั้งหมด" tab)
// ============================================================================

function buildMockContractList(overrides: Record<string, unknown>[] = []) {
  const defaults = [
    {
      id: 'c1', contractNumber: 'BCP-0001', status: 'ACTIVE', workflowStatus: 'APPROVED',
      sellingPrice: '15000', downPayment: '3000', monthlyPayment: '1320', totalMonths: 10,
      paymentDueDay: 5, createdAt: '2026-01-15T10:00:00.000Z',
      customer: { id: 'cust-1', name: 'สมชาย ใจดี', phone: '0891234567' },
      product: { id: 'prod-1', name: 'iPhone 15', brand: 'Apple', model: 'iPhone 15', category: 'PHONE_NEW' },
      branch: { id: 'branch-1', name: 'สาขาหลัก' },
      salesperson: { id: 'user-001', name: 'Admin' },
      reviewedBy: null,
      signatures: [{ signerType: 'CUSTOMER' }, { signerType: 'COMPANY' }, { signerType: 'WITNESS_1' }, { signerType: 'WITNESS_2' }],
      _count: { payments: 2, contractDocuments: 3 },
    },
    {
      id: 'c2', contractNumber: 'BCP-0002', status: 'DRAFT', workflowStatus: 'PENDING_REVIEW',
      sellingPrice: '20000', downPayment: '5000', monthlyPayment: '1800', totalMonths: 12,
      paymentDueDay: 10, createdAt: '2026-02-01T10:00:00.000Z',
      customer: { id: 'cust-2', name: 'สมหญิง แสนดี', phone: '0899876543' },
      product: { id: 'prod-2', name: 'Samsung S24', brand: 'Samsung', model: 'Galaxy S24', category: 'PHONE_NEW' },
      branch: { id: 'branch-1', name: 'สาขาหลัก' },
      salesperson: { id: 'user-002', name: 'พนักงาน ทดสอบ' },
      reviewedBy: null,
      signatures: [{ signerType: 'CUSTOMER' }],
      _count: { payments: 0, contractDocuments: 2 },
    },
    {
      id: 'c3', contractNumber: 'BCP-0003', status: 'OVERDUE', workflowStatus: 'APPROVED',
      sellingPrice: '12000', downPayment: '2000', monthlyPayment: '1100', totalMonths: 10,
      paymentDueDay: 1, createdAt: '2025-12-01T10:00:00.000Z',
      customer: { id: 'cust-3', name: 'วิชัย รักดี', phone: '0887654321' },
      product: { id: 'prod-3', name: 'iPhone 14', brand: 'Apple', model: 'iPhone 14', category: 'PHONE_USED' },
      branch: { id: 'branch-1', name: 'สาขาหลัก' },
      salesperson: { id: 'user-001', name: 'Admin' },
      reviewedBy: null,
      signatures: [{ signerType: 'CUSTOMER' }, { signerType: 'COMPANY' }, { signerType: 'WITNESS_1' }, { signerType: 'WITNESS_2' }],
      _count: { payments: 3, contractDocuments: 4 },
    },
  ];

  return {
    data: overrides.length > 0 ? overrides : defaults,
    total: overrides.length > 0 ? overrides.length : defaults.length,
    page: 1,
    totalPages: 1,
  };
}

async function mockContractsList(page: Page, responseOverride?: Record<string, unknown>) {
  await page.route('**/api/contracts?*', async (route) => {
    const url = new URL(route.request().url());
    const search = url.searchParams.get('search') || '';
    const status = url.searchParams.get('status') || '';
    const workflowStatus = url.searchParams.get('workflowStatus') || '';

    let result = buildMockContractList();

    if (responseOverride) {
      result = { ...result, ...responseOverride };
    }

    // Basic filtering simulation
    if (search) {
      result.data = result.data.filter((c: any) =>
        c.contractNumber.includes(search) || c.customer.name.includes(search)
      );
    }
    if (status) {
      result.data = result.data.filter((c: any) => c.status === status);
    }
    if (workflowStatus) {
      result.data = result.data.filter((c: any) => c.workflowStatus === workflowStatus);
    }

    result.total = result.data.length;

    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify(result),
    });
  });
}

test.describe('Phase 12: Contracts List - Filters & Tabs', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page);
  });

  // ── 12.1 Tab ทั้งหมด shows all contracts ──────────────────────────────
  test('12.1 Tab ทั้งหมด shows all contracts by default', async ({ page }) => {
    await mockContractsList(page);

    await page.goto('/contracts', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);

    // Tab "ทั้งหมด" should be active
    const allTab = page.locator('button:has-text("ทั้งหมด")');
    await expect(allTab).toBeVisible({ timeout: 5000 });
    await expect(allTab).toHaveClass(/border-primary|text-primary/);

    // Should show contracts
    await expect(page.getByText('BCP-0001')).toBeVisible();
    await expect(page.getByText('BCP-0002')).toBeVisible();
    await expect(page.getByText('BCP-0003')).toBeVisible();
  });

  // ── 12.2 Tab สัญญาของฉัน filters by current user ─────────────────────
  test('12.2 Tab สัญญาของฉัน switches to my contracts view', async ({ page }) => {
    await mockContractsList(page);

    await page.goto('/contracts', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);

    // Click "สัญญาของฉัน"
    await page.locator('button:has-text("สัญญาของฉัน")').click();
    await page.waitForTimeout(1000);

    // URL should contain tab=my
    expect(page.url()).toContain('tab=my');

    // Tab should be active
    const myTab = page.locator('button:has-text("สัญญาของฉัน")');
    await expect(myTab).toHaveClass(/border-primary|text-primary/);
  });

  // ── 12.3 Tab รอตรวจสอบ shows pending review ───────────────────────────
  test('12.3 Tab รอตรวจสอบ filters to pending review contracts', async ({ page }) => {
    await mockContractsList(page);

    await page.goto('/contracts', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);

    // "รอตรวจสอบ" tab (manager only - Admin is OWNER)
    const pendingTab = page.locator('button:has-text("รอตรวจสอบ")');
    await expect(pendingTab).toBeVisible({ timeout: 5000 });
    await pendingTab.click();
    await page.waitForTimeout(1000);

    // URL should contain tab=pending_review
    expect(page.url()).toContain('tab=pending_review');
  });

  // ── 12.4 Search filter updates URL ────────────────────────────────────
  test('12.4 Search filter updates URL params', async ({ page }) => {
    await mockContractsList(page);

    await page.goto('/contracts', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);

    // Type in search
    const searchInput = page.locator('input[placeholder*="ค้นหา"]');
    await expect(searchInput).toBeVisible({ timeout: 5000 });
    await searchInput.fill('BCP-0001');
    await page.waitForTimeout(1000);

    // URL should contain q=BCP-0001
    expect(page.url()).toContain('q=BCP-0001');
  });

  // ── 12.5 Status filter dropdown ───────────────────────────────────────
  test('12.5 Status filter dropdown filters contracts', async ({ page }) => {
    await mockContractsList(page);

    await page.goto('/contracts', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);

    // Find status filter select
    const statusSelect = page.locator('select').first();
    await expect(statusSelect).toBeVisible({ timeout: 5000 });

    // Should have status options
    await expect(statusSelect.locator('option:has-text("ทุกสถานะ")')).toHaveCount(1);
    await expect(statusSelect.locator('option:has-text("ร่าง")')).toHaveCount(1);
    await expect(statusSelect.locator('option:has-text("ผ่อนอยู่")')).toHaveCount(1);
    await expect(statusSelect.locator('option:has-text("ค้างชำระ")')).toHaveCount(1);

    // Select "ผ่อนอยู่"
    await statusSelect.selectOption('ACTIVE');
    await page.waitForTimeout(1000);

    // URL should contain status=ACTIVE
    expect(page.url()).toContain('status=ACTIVE');
  });

  // ── 12.6 Workflow filter only visible on ทั้งหมด tab ──────────────────
  test('12.6 Workflow filter dropdown is only visible on ทั้งหมด tab', async ({ page }) => {
    await mockContractsList(page);

    await page.goto('/contracts', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);

    // On ทั้งหมด tab, workflow filter should be visible
    const workflowSelect = page.locator('select').nth(1);
    await expect(workflowSelect).toBeVisible({ timeout: 5000 });
    await expect(workflowSelect.locator('option:has-text("ทุก Workflow")')).toHaveCount(1);
    await expect(workflowSelect.locator('option:has-text("กำลังสร้าง")')).toHaveCount(1);
    await expect(workflowSelect.locator('option:has-text("รอตรวจสอบ")')).toHaveCount(1);
    await expect(workflowSelect.locator('option:has-text("อนุมัติแล้ว")')).toHaveCount(1);

    // Switch to "สัญญาของฉัน" tab
    await page.locator('button:has-text("สัญญาของฉัน")').click();
    await page.waitForTimeout(1000);

    // Workflow filter should be hidden on non-all tabs
    await expect(page.locator('select').nth(1)).not.toBeVisible();
  });

  // ── 12.7 Workflow filter filters contracts ────────────────────────────
  test('12.7 Workflow filter filters contracts by workflow status', async ({ page }) => {
    await mockContractsList(page);

    await page.goto('/contracts', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);

    // Select "รอตรวจสอบ" in workflow filter
    const workflowSelect = page.locator('select').nth(1);
    await workflowSelect.selectOption('PENDING_REVIEW');
    await page.waitForTimeout(1000);

    // URL should contain workflow=PENDING_REVIEW
    expect(page.url()).toContain('workflow=PENDING_REVIEW');
  });

  // ── 12.8 Create button navigates to create page ───────────────────────
  test('12.8 Create contract button navigates to create page', async ({ page }) => {
    await mockContractsList(page);

    await page.goto('/contracts', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);

    const createBtn = page.locator('button:has-text("สร้างสัญญา")');
    await expect(createBtn).toBeVisible({ timeout: 5000 });
    await createBtn.click();

    await page.waitForURL('**/contracts/create', { timeout: 5000 });
  });
});
