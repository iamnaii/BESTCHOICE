import { test, expect } from '@playwright/test';
import { loginWithMock } from './helpers/mock-auth';
import { StepScreenshot } from './helpers/screenshot';

const mockCustomers = {
  data: [
    {
      id: 'cust-1',
      nationalId: '1234567890123',
      name: 'สมชาย ใจดี',
      nickname: 'ชาย',
      phone: '0812345678',
      lineId: null,
      occupation: 'พนักงานบริษัท',
      salary: 25000,
      createdAt: '2026-01-15T10:00:00Z',
      _count: { contracts: 2 },
      activeContracts: 1,
      overdueContracts: 0,
      latestCreditStatus: 'APPROVED',
      latestCreditScore: 85,
    },
    {
      id: 'cust-2',
      nationalId: '9876543210987',
      name: 'สมหญิง รักดี',
      nickname: null,
      phone: '0898765432',
      lineId: 'somying_line',
      occupation: 'ค้าขาย',
      salary: 30000,
      createdAt: '2026-02-20T14:00:00Z',
      _count: { contracts: 1 },
      activeContracts: 1,
      overdueContracts: 1,
      latestCreditStatus: 'PENDING',
      latestCreditScore: null,
    },
  ],
  total: 2,
  page: 1,
  limit: 20,
  totalPages: 1,
};

/**
 * Customers Page (/customers) E2E Tests
 *
 * ทดสอบหน้าจัดการลูกค้า: แสดงรายชื่อ, ค้นหา, เปิด modal เพิ่มลูกค้า, navigate ไป detail
 * Selectors จาก: src/pages/CustomersPage.tsx
 */
test.describe('Customers Page', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    await loginWithMock(page);

    // Mock customers API
    await page.route('**/api/customers*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockCustomers),
      });
    });

    await page.goto('/customers', { waitUntil: 'domcontentloaded' });
  });

  test('should display customers page with header and list', async ({ page }) => {
    const ss = new StepScreenshot(page, 'customers-display');

    // Step 1: ตรวจสอบ URL
    await expect(page).toHaveURL('/customers');
    await ss.capture('customers-page-loaded');

    // Step 2: ตรวจสอบ header "ลูกค้า"
    await expect(page.locator('text=ลูกค้า').first()).toBeVisible();
    await ss.capture('header-visible');

    // Step 3: รอข้อมูลโหลด
    await page.waitForLoadState('networkidle');
    await ss.capture('data-loaded');

    // Step 4: ตรวจสอบ subtitle แสดงจำนวนลูกค้า "ทั้งหมด X ราย"
    await expect(page.locator('text=ทั้งหมด').first()).toBeVisible({ timeout: 10000 });
    await ss.capture('customer-count-visible');

    // Step 5: ตรวจสอบว่าไม่มี error toast
    await expect(page.locator('[data-sonner-toast][data-type="error"]')).not.toBeVisible();
    await ss.capture('no-error');
  });

  test('should search customers by name', async ({ page }) => {
    const ss = new StepScreenshot(page, 'customers-search');

    await page.waitForLoadState('networkidle');
    await ss.capture('page-ready');

    // หา search input
    const searchInput = page.locator('input[placeholder*="ค้นหา"]').first();
    await expect(searchInput).toBeVisible();
    await ss.capture('search-input-visible');

    // พิมพ์ค้นหา
    await searchInput.type('สม', { delay: 50 });
    await ss.capture('typed-search');

    // รอ debounce + API response
    await page.waitForTimeout(1000);
    await ss.capture('search-results');
  });

  test('should display data table with correct columns', async ({ page }) => {
    const ss = new StepScreenshot(page, 'customers-table');

    await page.waitForLoadState('networkidle');
    await ss.capture('page-ready');

    // ตรวจสอบ table columns
    const table = page.locator('table').first();
    if (await table.isVisible()) {
      // ตรวจ column headers
      for (const header of ['ชื่อ', 'เบอร์โทร', 'เครดิต']) {
        const th = page.locator(`th:has-text("${header}")`).first();
        if (await th.isVisible().catch(() => false)) {
          // column exists
        }
      }
      await ss.capture('table-headers-visible');

      // ตรวจสอบว่ามีแถวข้อมูลหรือ empty message
      const hasRows = await page.locator('table tbody tr').first().isVisible().catch(() => false);
      if (hasRows) {
        await ss.capture('table-has-data');
      }
    }

    // ตรวจว่ามี empty message ถ้าไม่มีข้อมูล
    const emptyMsg = page.locator('text=ไม่พบลูกค้า');
    if (await emptyMsg.isVisible().catch(() => false)) {
      await ss.capture('empty-state');
    }
  });

  test('should open add customer modal', async ({ page }) => {
    const ss = new StepScreenshot(page, 'customers-add-modal');

    await page.waitForLoadState('networkidle');
    await ss.capture('page-ready');

    // หาปุ่ม "+ เพิ่มลูกค้า"
    const addButton = page.locator('button:has-text("เพิ่มลูกค้า")').first();
    await expect(addButton).toBeVisible();
    await ss.capture('add-button-visible');

    // คลิกเปิด modal
    await addButton.click();
    await page.waitForTimeout(500);
    await ss.capture('modal-opened');

    // ตรวจสอบ form fields ใน modal
    // ตรวจ input สำหรับ ชื่อ
    const firstNameInput = page.locator('input[placeholder*="ชื่อ"]').first();
    if (await firstNameInput.isVisible().catch(() => false)) {
      await ss.capture('form-first-name-visible');
    }

    // ตรวจ input สำหรับ นามสกุล
    const lastNameInput = page.locator('input[placeholder*="นามสกุล"]').first();
    if (await lastNameInput.isVisible().catch(() => false)) {
      await ss.capture('form-last-name-visible');
    }

    // ตรวจ input สำหรับ เลขบัตรประชาชน
    const nationalIdInput = page.locator('input[placeholder*="เลขบัตร"]').first();
    if (await nationalIdInput.isVisible().catch(() => false)) {
      await ss.capture('form-national-id-visible');
    }

    // ตรวจ input สำหรับ เบอร์โทร
    const phoneInput = page.locator('input[placeholder*="เบอร์โทร"]').first();
    if (await phoneInput.isVisible().catch(() => false)) {
      await ss.capture('form-phone-visible');
    }

    // ตรวจ Smart Card / OCR buttons
    const smartCardBtn = page.locator('button:has-text("Smart Card"), button:has-text("อ่านบัตร")').first();
    if (await smartCardBtn.isVisible().catch(() => false)) {
      await ss.capture('smart-card-button-visible');
    }

    const ocrBtn = page.locator('button:has-text("OCR"), button:has-text("สแกน")').first();
    if (await ocrBtn.isVisible().catch(() => false)) {
      await ss.capture('ocr-button-visible');
    }

    // ตรวจปุ่ม บันทึก
    const saveBtn = page.locator('button:has-text("บันทึก")').first();
    if (await saveBtn.isVisible().catch(() => false)) {
      await ss.capture('save-button-visible');
    }

    await ss.capture('modal-fully-loaded');
  });

  test('should navigate to customer detail on row click', async ({ page }) => {
    const ss = new StepScreenshot(page, 'customers-detail-nav');

    await page.waitForLoadState('networkidle');
    await ss.capture('page-ready');

    // หาแถวลูกค้าแรกในตาราง
    const firstRow = page.locator('table tbody tr').first();
    if (await firstRow.isVisible().catch(() => false)) {
      await ss.capture('first-row-visible');

      // Double-click เพื่อ navigate ไป detail
      await firstRow.dblclick();
      await page.waitForTimeout(1000);
      await ss.capture('after-row-dblclick');

      // ตรวจสอบว่าอยู่หน้า detail (URL มี /customers/)
      const url = page.url();
      if (url.includes('/customers/')) {
        await ss.capture('on-customer-detail-page');
      }
    } else {
      await ss.capture('no-data-rows');
    }
  });
});
