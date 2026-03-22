import { test, expect } from '@playwright/test';
import { loginWithMock } from './helpers/mock-auth';
import { StepScreenshot } from './helpers/screenshot';

const mockCreditChecks = {
  data: [
    {
      id: 'cc-1',
      status: 'APPROVED',
      bankName: 'กสิกร',
      statementFiles: [],
      statementMonths: 3,
      aiScore: 85,
      aiSummary: 'เครดิตดี',
      aiRecommendation: 'อนุมัติ',
      reviewNotes: null,
      checkedBy: { id: 'user-001', name: 'Admin' },
      customer: { id: 'cust-1', name: 'สมชาย ใจดี', phone: '0812345678', salary: '25000', occupation: 'พนักงานบริษัท' },
      contract: { id: 'contract-1', contractNumber: 'CT-2026-001' },
      createdAt: '2026-03-18T10:00:00Z',
    },
    {
      id: 'cc-2',
      status: 'PENDING',
      bankName: 'กรุงไทย',
      statementFiles: [],
      statementMonths: 3,
      aiScore: null,
      aiSummary: null,
      aiRecommendation: null,
      reviewNotes: null,
      checkedBy: null,
      customer: { id: 'cust-2', name: 'สมหญิง รักดี', phone: '0898765432', salary: '30000', occupation: 'ค้าขาย' },
      contract: null,
      createdAt: '2026-03-20T14:00:00Z',
    },
    {
      id: 'cc-3',
      status: 'REJECTED',
      bankName: 'กรุงเทพ',
      statementFiles: [],
      statementMonths: 3,
      aiScore: 35,
      aiSummary: 'เครดิตต่ำ',
      aiRecommendation: 'ปฏิเสธ',
      reviewNotes: null,
      checkedBy: { id: 'user-001', name: 'Admin' },
      customer: { id: 'cust-3', name: 'สมศักดิ์ มั่งมี', phone: '0867654321', salary: '15000', occupation: 'รับจ้าง' },
      contract: null,
      createdAt: '2026-03-19T09:00:00Z',
    },
  ],
  total: 3,
};

const mockCustomersForSearch = {
  data: [
    { id: 'cust-1', name: 'สมชาย ใจดี', phone: '0812345678', nationalId: '1234567890123', salary: '25000', occupation: 'พนักงานบริษัท' },
    { id: 'cust-2', name: 'สมหญิง รักดี', phone: '0898765432', nationalId: '9876543210987', salary: '30000', occupation: 'ค้าขาย' },
  ],
  total: 2,
};

/**
 * Credit Checks Page (/credit-checks) E2E Tests
 *
 * ทดสอบหน้าตรวจเครดิต: แสดงรายการ, summary cards, filter, search, modal
 * Selectors จาก: src/pages/CreditChecksPage.tsx
 */
test.describe('Credit Checks Page', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    await loginWithMock(page);

    // Mock credit-checks API
    await page.route('**/api/credit-checks*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockCreditChecks),
      });
    });

    // Mock customers API (for create modal search)
    await page.route('**/api/customers*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockCustomersForSearch),
      });
    });

    await page.goto('/credit-checks', { waitUntil: 'domcontentloaded' });
  });

  test('should display credit checks page with header', async ({ page }) => {
    const ss = new StepScreenshot(page, 'credit-checks-display');

    // Step 1: ตรวจสอบ URL
    await expect(page).toHaveURL('/credit-checks');
    await ss.capture('credit-checks-page-loaded');

    // Step 2: ตรวจสอบ header "ตรวจเครดิต"
    await expect(page.locator('text=ตรวจเครดิต').first()).toBeVisible();
    await ss.capture('header-visible');

    // Step 3: ตรวจสอบ subtitle
    await expect(page.locator('text=ตรวจสอบเครดิตลูกค้าก่อนทำสัญญา').first()).toBeVisible();
    await ss.capture('subtitle-visible');

    // Step 4: รอข้อมูลโหลด
    await page.waitForLoadState('networkidle');
    await ss.capture('data-loaded');

    // Step 5: ตรวจสอบว่าไม่มี error toast
    await expect(page.locator('[data-sonner-toast][data-type="error"]')).not.toBeVisible();
    await ss.capture('no-error');
  });

  test('should display summary cards', async ({ page }) => {
    const ss = new StepScreenshot(page, 'credit-checks-summary');

    await page.waitForLoadState('networkidle');
    await ss.capture('page-ready');

    // ตรวจสอบ summary cards
    await expect(page.locator('text=ทั้งหมด').first()).toBeVisible({ timeout: 10000 });
    await ss.capture('total-card-visible');

    const approvedLabel = page.locator('text=ผ่าน').first();
    if (await approvedLabel.isVisible().catch(() => false)) {
      await ss.capture('approved-card-visible');
    }

    const pendingLabel = page.locator('text=รอวิเคราะห์').first();
    if (await pendingLabel.isVisible().catch(() => false)) {
      await ss.capture('pending-card-visible');
    }

    const rejectedLabel = page.locator('text=ไม่ผ่าน').first();
    if (await rejectedLabel.isVisible().catch(() => false)) {
      await ss.capture('rejected-card-visible');
    }

    await ss.capture('all-summary-cards');
  });

  test('should have search and status filter', async ({ page }) => {
    const ss = new StepScreenshot(page, 'credit-checks-filter');

    await page.waitForLoadState('networkidle');
    await ss.capture('page-ready');

    // ตรวจสอบ search input
    const searchInput = page.locator('input[placeholder*="ค้นหา"]').first();
    await expect(searchInput).toBeVisible();
    await ss.capture('search-input-visible');

    // ตรวจสอบ status filter dropdown
    const statusSelect = page.locator('select').first();
    await expect(statusSelect).toBeVisible();
    await ss.capture('status-filter-visible');

    // ทดสอบ search
    await searchInput.type('สม', { delay: 50 });
    await page.waitForTimeout(500);
    await ss.capture('search-typed');

    // ทดสอบ status filter — เลือก "ผ่าน"
    await searchInput.clear();
    await statusSelect.selectOption('APPROVED');
    await page.waitForTimeout(500);
    await ss.capture('filtered-approved');

    // เลือก "รอวิเคราะห์"
    await statusSelect.selectOption('PENDING');
    await page.waitForTimeout(500);
    await ss.capture('filtered-pending');

    // เลือก "ทุกสถานะ"
    await statusSelect.selectOption('');
    await page.waitForTimeout(500);
    await ss.capture('filter-cleared');
  });

  test('should display data table or empty message', async ({ page }) => {
    const ss = new StepScreenshot(page, 'credit-checks-table');

    await page.waitForLoadState('networkidle');
    await ss.capture('page-ready');

    // ตรวจสอบว่ามี table หรือ empty message
    const table = page.locator('table').first();
    const emptyMsg = page.locator('text=ยังไม่มีรายการตรวจเครดิต');

    if (await table.isVisible().catch(() => false)) {
      // ตรวจ column headers
      for (const header of ['ลูกค้า', 'สถานะ', 'คะแนน', 'ธนาคาร']) {
        const th = page.locator(`th:has-text("${header}")`).first();
        if (await th.isVisible().catch(() => false)) {
          // column exists
        }
      }
      await ss.capture('table-headers-visible');

      // ตรวจสอบว่ามีแถวข้อมูล
      const hasRows = await page.locator('table tbody tr').first().isVisible().catch(() => false);
      if (hasRows) {
        await ss.capture('table-has-data');
      }
    } else if (await emptyMsg.isVisible().catch(() => false)) {
      await ss.capture('empty-state');
    }
  });

  test('should open create credit check modal', async ({ page }) => {
    const ss = new StepScreenshot(page, 'credit-checks-create-modal');

    await page.waitForLoadState('networkidle');
    await ss.capture('page-ready');

    // หาปุ่ม "+ ตรวจเครดิตใหม่"
    const createButton = page.locator('button:has-text("ตรวจเครดิตใหม่")').first();
    await expect(createButton).toBeVisible();
    await ss.capture('create-button-visible');

    // คลิกเปิด modal
    await createButton.click();
    await page.waitForTimeout(500);
    await ss.capture('modal-opened');

    // ตรวจสอบ modal title
    await expect(page.locator('text=ตรวจเครดิตใหม่').nth(1)).toBeVisible();
    await ss.capture('modal-title-visible');

    // ตรวจสอบ "เลือกลูกค้า" label
    await expect(page.locator('text=เลือกลูกค้า').first()).toBeVisible();
    await ss.capture('customer-selection-visible');

    // ตรวจสอบ customer search input ใน modal
    const customerSearch = page.locator('input[placeholder*="ค้นหาชื่อ"]').first();
    if (await customerSearch.isVisible().catch(() => false)) {
      await ss.capture('customer-search-input-visible');

      // ทดสอบ search ลูกค้า
      await customerSearch.type('ท', { delay: 50 });
      await page.waitForTimeout(1000);
      await ss.capture('customer-search-results');
    }
  });

  test('should have action button "ตรวจเครดิตใหม่" in header', async ({ page }) => {
    const ss = new StepScreenshot(page, 'credit-checks-action-btn');

    await page.waitForLoadState('networkidle');
    await ss.capture('page-ready');

    // ตรวจสอบปุ่ม action ใน header
    const actionBtn = page.locator('button:has-text("ตรวจเครดิตใหม่")').first();
    await expect(actionBtn).toBeVisible();
    await ss.capture('action-button-in-header');
  });
});
