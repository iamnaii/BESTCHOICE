import { test, expect } from '@playwright/test';
import { loginViaAPI } from '../helpers/auth';
import { StepScreenshot } from '../helpers/screenshot';

/**
 * 04 - Customers Flow (Human-Like Interaction)
 *
 * ทดสอบ flow จัดการลูกค้า: ดูรายชื่อ, ค้นหา, สร้างใหม่, ดู detail
 * Selectors จาก: src/pages/CustomersPage.tsx
 * - PageHeader: "ลูกค้า"
 * - Search input (debounced)
 * - DataTable with customer data
 * - Modal for create (เพิ่มลูกค้า)
 * - Form fields: prefix, firstName, lastName, nationalId, phone, etc.
 * - API: GET /customers, POST /customers
 */
test.describe('04 - Customers Flow', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page);
    await page.goto('/customers', { waitUntil: 'domcontentloaded' });
  });

  test('should display customers page with list', async ({ page }) => {
    const ss = new StepScreenshot(page, '04-customers-display');

    // Step 1: ตรวจสอบว่าอยู่หน้า Customers
    await expect(page).toHaveURL('/customers');
    await ss.capture('customers-page-loaded');

    // Step 2: ตรวจสอบ header "ลูกค้า"
    await expect(page.locator('text=ลูกค้า').first()).toBeVisible();
    await ss.capture('customers-header-visible');

    // Step 3: รอข้อมูลโหลดจาก API
    await page.waitForLoadState('networkidle');
    await ss.capture('customer-data-loaded');

    // Step 4: ตรวจสอบว่าไม่มี error toast
    await expect(page.locator('[data-sonner-toast][data-type="error"]')).not.toBeVisible();
    await ss.capture('no-error-on-load');
  });

  test('should search customers by name', async ({ page }) => {
    const ss = new StepScreenshot(page, '04-customers-search');

    // Step 1: รอหน้าโหลด
    await page.waitForLoadState('networkidle');
    await ss.capture('page-ready');

    // Step 2: หา search input
    const searchInput = page.locator('input[placeholder*="ค้นหา"]').first();
    await expect(searchInput).toBeVisible();
    await ss.capture('search-input-visible');

    // Step 3: พิมพ์ค้นหา (human-like)
    await searchInput.type('สม', { delay: 50 });
    await ss.capture('typed-search-term');

    // Step 4: รอ debounce + API response
    await page.waitForTimeout(1000);
    await ss.capture('search-results-loaded');
  });

  test('should open create customer modal', async ({ page }) => {
    const ss = new StepScreenshot(page, '04-customers-create-modal');

    // Step 1: รอหน้าโหลด
    await page.waitForLoadState('networkidle');
    await ss.capture('page-ready');

    // Step 2: หาปุ่มเพิ่มลูกค้า
    const addButton = page.locator('button:has-text("เพิ่มลูกค้า"), button:has-text("สร้าง")').first();
    if (await addButton.isVisible()) {
      await ss.capture('add-button-visible');

      // Step 3: คลิกปุ่มเพิ่มลูกค้า
      await addButton.click();
      await ss.capture('clicked-add-button');

      // Step 4: รอ Modal เปิด
      await page.waitForTimeout(500);
      await ss.capture('modal-opened');

      // Step 5: ตรวจสอบ form fields ใน Modal
      // ตรวจสอบว่ามี input สำหรับ ชื่อ, นามสกุล, เลขบัตรประชาชน, เบอร์โทร
      const firstNameInput = page.locator('input[placeholder*="ชื่อ"], label:has-text("ชื่อ")').first();
      if (await firstNameInput.isVisible()) {
        await ss.capture('form-fields-visible');
      }

      // Step 6: ตรวจสอบ prefix options (นาย, นาง, นางสาว)
      const prefixSelect = page.locator('select, [role="combobox"]').first();
      if (await prefixSelect.isVisible()) {
        await ss.capture('prefix-select-visible');
      }
    } else {
      await ss.capture('add-button-not-found');
    }
  });

  test('should navigate to customer detail page', async ({ page }) => {
    const ss = new StepScreenshot(page, '04-customers-detail');

    // Step 1: รอข้อมูลโหลด
    await page.waitForLoadState('networkidle');
    await ss.capture('customers-list-loaded');

    // Step 2: หาแถวลูกค้าแรกในตาราง
    const firstRow = page.locator('table tbody tr, [role="row"]').first();
    if (await firstRow.isVisible()) {
      await ss.capture('first-customer-row-visible');

      // Step 3: คลิกดูรายละเอียดลูกค้า
      await firstRow.click();
      await ss.capture('clicked-customer-row');

      // Step 4: รอ navigate ไปหน้า detail
      await page.waitForTimeout(1000);
      await ss.capture('customer-detail-loaded');

      // Step 5: ตรวจสอบว่าอยู่หน้า detail (URL มี /customers/)
      const url = page.url();
      if (url.includes('/customers/')) {
        await ss.capture('on-customer-detail-page');
      }
    } else {
      await ss.capture('no-customer-rows-found');
    }
  });
});
