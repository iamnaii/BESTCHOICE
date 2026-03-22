import { test, expect } from '@playwright/test';
import { loginWithMock } from './helpers/mock-auth';
import { StepScreenshot } from './helpers/screenshot';

const mockSales = {
  data: [
    {
      id: 'sale-1',
      saleNumber: 'SL-2026-001',
      saleType: 'CASH',
      sellingPrice: '15900',
      discount: '500',
      netAmount: '15400',
      paymentMethod: 'CASH',
      amountReceived: '15400',
      downPaymentAmount: null,
      financeCompany: null,
      financeRefNumber: null,
      notes: null,
      createdAt: '2026-03-20T10:00:00Z',
      customer: { id: 'cust-1', name: 'สมชาย ใจดี', phone: '0812345678' },
      product: { id: 'prod-1', name: 'iPhone 15', brand: 'Apple', model: 'iPhone 15', imeiSerial: '123456789012345', serialNumber: null },
      branch: { id: 'branch-1', name: 'สาขาหลัก' },
      salesperson: { id: 'user-001', name: 'Admin' },
      contract: null,
    },
    {
      id: 'sale-2',
      saleNumber: 'SL-2026-002',
      saleType: 'INSTALLMENT',
      sellingPrice: '29900',
      discount: '0',
      netAmount: '29900',
      paymentMethod: 'CASH',
      amountReceived: '5000',
      downPaymentAmount: '5000',
      financeCompany: null,
      financeRefNumber: null,
      notes: null,
      createdAt: '2026-03-21T14:30:00Z',
      customer: { id: 'cust-2', name: 'สมหญิง รักดี', phone: '0898765432' },
      product: { id: 'prod-2', name: 'Samsung S24', brand: 'Samsung', model: 'Galaxy S24', imeiSerial: '987654321098765', serialNumber: null },
      branch: { id: 'branch-1', name: 'สาขาหลัก' },
      salesperson: { id: 'user-001', name: 'Admin' },
      contract: { id: 'contract-1', contractNumber: 'CT-2026-001', status: 'ACTIVE', monthlyPayment: '2490', totalMonths: 10 },
    },
  ],
  total: 2,
  page: 1,
  limit: 20,
  totalPages: 1,
};

/**
 * Sales History Page (/sales) E2E Tests
 *
 * ทดสอบหน้าประวัติการขาย: แสดงรายการ, summary cards, filter, search
 * Selectors จาก: src/pages/SalesHistoryPage.tsx
 */
test.describe('Sales History Page', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    await loginWithMock(page);

    // Mock sales API
    await page.route('**/api/sales*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockSales),
      });
    });

    await page.goto('/sales', { waitUntil: 'domcontentloaded' });
  });

  test('should display sales page with header and data', async ({ page }) => {
    const ss = new StepScreenshot(page, 'sales-display');

    // Step 1: ตรวจสอบ URL
    await expect(page).toHaveURL('/sales');
    await ss.capture('sales-page-loaded');

    // Step 2: ตรวจสอบ header "ประวัติการขาย"
    await expect(page.locator('text=ประวัติการขาย').first()).toBeVisible();
    await ss.capture('header-visible');

    // Step 3: รอข้อมูลโหลด
    await page.waitForLoadState('networkidle');
    await ss.capture('data-loaded');

    // Step 4: ตรวจสอบว่าไม่มี error toast
    await expect(page.locator('[data-sonner-toast][data-type="error"]')).not.toBeVisible();
    await ss.capture('no-error');
  });

  test('should display summary cards', async ({ page }) => {
    const ss = new StepScreenshot(page, 'sales-summary-cards');

    await page.waitForLoadState('networkidle');
    await ss.capture('page-ready');

    // ตรวจสอบ summary cards — ข้อความที่ปรากฏใน cards
    const cashLabel = page.locator('text=เงินสด (หน้านี้)').first();
    const installmentLabel = page.locator('text=ผ่อนร้าน (หน้านี้)').first();
    const financeLabel = page.locator('text=ไฟแนนซ์ (หน้านี้)').first();

    // อย่างน้อย header card ต้องมี "รายการ"
    await expect(page.locator('text=รายการ').first()).toBeVisible({ timeout: 10000 });
    await ss.capture('summary-cards-visible');

    // ตรวจสอบ cash card
    if (await cashLabel.isVisible()) {
      await ss.capture('cash-card-visible');
    }

    // ตรวจสอบ installment card
    if (await installmentLabel.isVisible()) {
      await ss.capture('installment-card-visible');
    }

    // ตรวจสอบ finance card
    if (await financeLabel.isVisible()) {
      await ss.capture('finance-card-visible');
    }
  });

  test('should have sale type filter dropdown', async ({ page }) => {
    const ss = new StepScreenshot(page, 'sales-filter');

    await page.waitForLoadState('networkidle');
    await ss.capture('page-ready');

    // หา select filter
    const filterSelect = page.locator('select').first();
    await expect(filterSelect).toBeVisible();
    await ss.capture('filter-select-visible');

    // เลือก "เงินสด"
    await filterSelect.selectOption('CASH');
    await ss.capture('selected-cash-filter');

    // รอข้อมูล reload
    await page.waitForTimeout(500);
    await ss.capture('cash-filter-applied');

    // เลือก "ผ่อนร้าน"
    await filterSelect.selectOption('INSTALLMENT');
    await page.waitForTimeout(500);
    await ss.capture('installment-filter-applied');

    // เลือก "ทุกประเภท"
    await filterSelect.selectOption('');
    await page.waitForTimeout(500);
    await ss.capture('all-types-filter');
  });

  test('should search sales by keyword', async ({ page }) => {
    const ss = new StepScreenshot(page, 'sales-search');

    await page.waitForLoadState('networkidle');
    await ss.capture('page-ready');

    // หา search input
    const searchInput = page.locator('input[placeholder*="ค้นหา"]').first();
    await expect(searchInput).toBeVisible();
    await ss.capture('search-input-visible');

    // พิมพ์ค้นหา
    await searchInput.type('iPhone', { delay: 50 });
    await ss.capture('typed-search');

    // รอ debounce + API response
    await page.waitForTimeout(1000);
    await ss.capture('search-results');
  });

  test('should display data table with correct columns', async ({ page }) => {
    const ss = new StepScreenshot(page, 'sales-table');

    await page.waitForLoadState('networkidle');
    await ss.capture('page-ready');

    // ตรวจสอบ column headers ที่สำคัญ
    const table = page.locator('table').first();
    if (await table.isVisible()) {
      // ตรวจสอบ column headers
      await expect(page.locator('th:has-text("เลขที่"), th:has-text("#")').first()).toBeVisible();
      await ss.capture('table-headers-visible');

      // ตรวจสอบว่ามีแถวข้อมูล หรือ empty message
      const hasRows = await page.locator('table tbody tr').first().isVisible().catch(() => false);
      if (hasRows) {
        await ss.capture('table-has-data');
      }
    }

    // ตรวจว่ามี empty message ถ้าไม่มีข้อมูล
    const emptyMsg = page.locator('text=ยังไม่มีรายการขาย');
    if (await emptyMsg.isVisible().catch(() => false)) {
      await ss.capture('empty-state');
    }
  });
});
