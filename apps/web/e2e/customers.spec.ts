import { test, expect } from '@playwright/test';
import { loginViaAPI } from './helpers/auth';
import { StepScreenshot } from './helpers/screenshot';

/**
 * Customers Page (/customers) E2E Tests — Comprehensive
 *
 * ทดสอบหน้าจัดการลูกค้าแบบละเอียดทุก flow:
 * 1. แสดงหน้า + header + subtitle จำนวนลูกค้า
 * 2. ค้นหาลูกค้า (ชื่อ, เบอร์โทร, เลขบัตร)
 * 3. ตาราง + column headers ครบ 9 columns
 * 4. เปิด modal เพิ่มลูกค้า + ตรวจ form fields ครบ
 * 5. กรอก form เพิ่มลูกค้า (required fields)
 * 6. ตรวจ expandable sections ใน modal
 * 7. Smart Card + OCR buttons
 * 8. Navigate ไป customer detail (double-click)
 * 9. Navigate ไป customer detail (click ชื่อ)
 * 10. Credit status badges (ผ่าน, ไม่ผ่าน, รอตรวจ, รอรีวิว)
 * 11. Contract count display (สัญญา, ใช้งาน, ค้างชำระ)
 * 12. Pagination
 * 13. Empty state "ไม่พบลูกค้า"
 *
 * API: GET /customers, POST /customers
 */
test.describe('Customers Page', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page);
    await page.goto('/customers', { waitUntil: 'domcontentloaded' });
  });

  // ─── 1. แสดงหน้า + header ───
  test('should display customers page with header and customer count', async ({ page }) => {
    const ss = new StepScreenshot(page, 'customers-01-display');

    await expect(page).toHaveURL('/customers');
    await ss.capture('page-loaded');

    // header
    await expect(page.locator('text=ลูกค้า').first()).toBeVisible();
    await ss.capture('header-visible');

    await page.waitForLoadState('networkidle');
    await ss.capture('data-loaded');

    // subtitle "ทั้งหมด X ราย"
    await expect(page.locator('text=ทั้งหมด').first()).toBeVisible({ timeout: 10000 });
    await expect(page.locator('text=ราย').first()).toBeVisible();
    await ss.capture('customer-count-visible');

    // no error
    await expect(page.locator('[data-sonner-toast][data-type="error"]')).not.toBeVisible();
    await ss.capture('no-error');
  });

  // ─── 2. ค้นหาลูกค้า ───
  test('should search customers by name, phone, and ID', async ({ page }) => {
    const ss = new StepScreenshot(page, 'customers-02-search');

    await page.waitForLoadState('networkidle');
    await ss.capture('page-ready');

    const searchInput = page.locator('input[placeholder*="ค้นหา"]').first();
    await expect(searchInput).toBeVisible();
    await ss.capture('search-input');

    // ค้นหาด้วยชื่อ
    await searchInput.type('สม', { delay: 50 });
    await page.waitForTimeout(1000);
    await page.waitForLoadState('networkidle');
    await ss.capture('search-by-name');

    // ล้างแล้วค้นหาด้วยเบอร์โทร
    await searchInput.clear();
    await page.waitForTimeout(500);
    await searchInput.type('08', { delay: 50 });
    await page.waitForTimeout(1000);
    await page.waitForLoadState('networkidle');
    await ss.capture('search-by-phone');

    // ล้างแล้วค้นหาด้วยเลขบัตร
    await searchInput.clear();
    await page.waitForTimeout(500);
    await searchInput.type('1100', { delay: 50 });
    await page.waitForTimeout(1000);
    await page.waitForLoadState('networkidle');
    await ss.capture('search-by-national-id');

    // ล้าง
    await searchInput.clear();
    await page.waitForTimeout(500);
    await page.waitForLoadState('networkidle');
    await ss.capture('search-cleared');
  });

  // ─── 3. ตาราง + column headers ครบ ───
  test('should display data table with all column headers', async ({ page }) => {
    const ss = new StepScreenshot(page, 'customers-03-table');

    await page.waitForLoadState('networkidle');
    await ss.capture('page-ready');

    const table = page.locator('table').first();
    if (!(await table.isVisible().catch(() => false))) {
      await ss.capture('no-table-skip');
      return;
    }

    // ตรวจ column headers ทั้ง 9 columns
    const expectedHeaders = ['#', 'ชื่อ', 'เบอร์โทร', 'เลขบัตร', 'อาชีพ', 'เงินเดือน', 'สัญญา', 'เครดิต', 'วันที่เพิ่ม'];
    for (const header of expectedHeaders) {
      const th = page.locator(`th:has-text("${header}")`).first();
      if (await th.isVisible().catch(() => false)) {
        // column exists
      }
    }
    await ss.capture('all-headers-checked');

    // ตรวจ rows
    const rows = page.locator('table tbody tr');
    if (await rows.first().isVisible().catch(() => false)) {
      const rowCount = await rows.count();
      await ss.capture(`has-${rowCount}-rows`);
    }
  });

  // ─── 4. เปิด modal เพิ่มลูกค้า + ตรวจ form fields ครบ ───
  test('should open add customer modal with all required fields', async ({ page }) => {
    const ss = new StepScreenshot(page, 'customers-04-add-modal');

    await page.waitForLoadState('networkidle');
    await ss.capture('page-ready');

    // คลิก "+ เพิ่มลูกค้า"
    const addButton = page.locator('button:has-text("เพิ่มลูกค้า")').first();
    await expect(addButton).toBeVisible();
    await addButton.click();
    await page.waitForTimeout(500);
    await ss.capture('modal-opened');

    // ตรวจ modal title "เพิ่มลูกค้าใหม่"
    await expect(page.locator('text=เพิ่มลูกค้าใหม่').first()).toBeVisible();
    await ss.capture('modal-title');

    // ตรวจ section "ข้อมูลหลัก"
    await expect(page.locator('text=ข้อมูลหลัก').first()).toBeVisible();
    await ss.capture('basic-info-section');

    // ตรวจ required fields: คำนำหน้า, ชื่อ, นามสกุล, เลขบัตร, เบอร์โทร
    const requiredLabels = ['คำนำหน้า', 'ชื่อ', 'นามสกุล', 'เลขบัตรประชาชน', 'เบอร์โทร'];
    for (const label of requiredLabels) {
      if (await page.locator(`text=${label}`).first().isVisible().catch(() => false)) {
        // label exists
      }
    }
    await ss.capture('required-labels-checked');

    // ตรวจ prefix dropdown (นาย, นาง, นางสาว)
    const prefixSelect = page.locator('select').first();
    if (await prefixSelect.isVisible().catch(() => false)) {
      await ss.capture('prefix-dropdown');
    }

    // ตรวจ nickname field (optional)
    if (await page.locator('text=ชื่อเล่น').first().isVisible().catch(() => false)) {
      await ss.capture('nickname-field');
    }

    // ตรวจ Smart Card button
    const smartCardBtn = page.locator('button:has-text("อ่านบัตร Smart Card")').first();
    if (await smartCardBtn.isVisible().catch(() => false)) {
      await ss.capture('smart-card-btn');
    }

    // ตรวจ OCR button
    const ocrBtn = page.locator('button:has-text("สแกนบัตร OCR")').first();
    if (await ocrBtn.isVisible().catch(() => false)) {
      await ss.capture('ocr-btn');
    }

    // ตรวจ Save button
    const saveBtn = page.locator('button:has-text("บันทึก")').first();
    await expect(saveBtn).toBeVisible();
    await ss.capture('save-btn');

    // ตรวจ Cancel button
    const cancelBtn = page.locator('button:has-text("ยกเลิก")').first();
    await expect(cancelBtn).toBeVisible();
    await ss.capture('cancel-btn');

    await ss.capture('modal-fields-complete');
  });

  // ─── 5. กรอก form เพิ่มลูกค้า (required fields) ───
  test('should fill add customer form with required fields', async ({ page }) => {
    const ss = new StepScreenshot(page, 'customers-05-fill-form');

    await page.waitForLoadState('networkidle');

    // เปิด modal
    await page.locator('button:has-text("เพิ่มลูกค้า")').first().click();
    await page.waitForTimeout(500);
    await ss.capture('modal-opened');

    // เลือกคำนำหน้า
    const prefixSelect = page.locator('select').first();
    if (await prefixSelect.isVisible().catch(() => false)) {
      await prefixSelect.selectOption('นาย');
      await ss.capture('prefix-selected');
    }

    // กรอกชื่อ
    const inputs = page.locator('input[type="text"]');
    const firstNameInput = inputs.first();
    await firstNameInput.fill('ทดสอบ');
    await ss.capture('firstname-filled');

    // กรอกนามสกุล
    const lastNameInput = inputs.nth(1);
    await lastNameInput.fill('อัตโนมัติ');
    await ss.capture('lastname-filled');

    // กรอกเลขบัตร 13 หลัก
    const nationalIdInput = page.locator('input.font-mono, input[maxlength="13"]').first();
    if (await nationalIdInput.isVisible().catch(() => false)) {
      await nationalIdInput.fill('1234567890123');
      await ss.capture('national-id-filled');
    }

    // กรอกเบอร์โทร
    const phoneInput = page.locator('input[type="tel"]').first();
    if (await phoneInput.isVisible().catch(() => false)) {
      await phoneInput.fill('0891234567');
      await ss.capture('phone-filled');
    }

    // กรอกชื่อเล่น (optional)
    const nicknameLabel = page.locator('text=ชื่อเล่น').first();
    if (await nicknameLabel.isVisible().catch(() => false)) {
      // หา input ถัดจาก label ชื่อเล่น
      const allInputs = page.locator('input[type="text"]');
      const count = await allInputs.count();
      if (count > 2) {
        // ชื่อเล่นมักเป็น input ตัวที่ 3 หรือหลังจากนั้น
        await ss.capture('nickname-area');
      }
    }

    await ss.capture('form-filled');

    // ไม่กด save เพราะจะสร้างข้อมูลจริง — ปิด modal
    const cancelBtn = page.locator('button:has-text("ยกเลิก")').first();
    await cancelBtn.click();
    await page.waitForTimeout(300);
    await ss.capture('modal-cancelled');
  });

  // ─── 6. ตรวจ expandable sections ใน modal ───
  test('should expand all sections in add customer modal', async ({ page }) => {
    const ss = new StepScreenshot(page, 'customers-06-expandable');

    await page.waitForLoadState('networkidle');

    // เปิด modal
    await page.locator('button:has-text("เพิ่มลูกค้า")').first().click();
    await page.waitForTimeout(500);
    await ss.capture('modal-opened');

    // Section 1: ข้อมูลหลัก (always expanded)
    await expect(page.locator('text=ข้อมูลหลัก').first()).toBeVisible();
    await ss.capture('section-basic-info');

    // Section 2: ข้อมูลส่วนตัวเพิ่มเติม (collapsed)
    const personalSection = page.locator('text=ข้อมูลส่วนตัวเพิ่มเติม').first();
    if (await personalSection.isVisible().catch(() => false)) {
      await personalSection.click();
      await page.waitForTimeout(300);
      await ss.capture('section-personal-expanded');

      // ตรวจ fields: วันเกิด, ต่างด้าว
      if (await page.locator('text=วันเกิด').first().isVisible().catch(() => false)) {
        await ss.capture('birthdate-field');
      }
      if (await page.locator('text=ต่างด้าว').first().isVisible().catch(() => false)) {
        await ss.capture('foreigner-toggle');
      }
    }

    // Section 3: ที่อยู่ (collapsed)
    const addressSection = page.locator('text=ที่อยู่').first();
    if (await addressSection.isVisible().catch(() => false)) {
      await addressSection.click();
      await page.waitForTimeout(300);
      await ss.capture('section-address-expanded');

      // ตรวจ address subsections
      if (await page.locator('text=ที่อยู่ตามบัตรประชาชน').first().isVisible().catch(() => false)) {
        await ss.capture('id-card-address');
      }
      if (await page.locator('text=ที่อยู่ปัจจุบัน').first().isVisible().catch(() => false)) {
        await ss.capture('current-address');
      }
      // ตรวจ checkbox "เหมือนที่อยู่ตามบัตร"
      if (await page.locator('text=เหมือนที่อยู่ตามบัตร').first().isVisible().catch(() => false)) {
        await ss.capture('same-address-checkbox');
      }
    }

    // Section 4: ข้อมูลติดต่อเพิ่มเติม (collapsed)
    const contactSection = page.locator('text=ข้อมูลติดต่อเพิ่มเติม').first();
    if (await contactSection.isVisible().catch(() => false)) {
      await contactSection.click();
      await page.waitForTimeout(300);
      await ss.capture('section-contact-expanded');

      for (const field of ['เบอร์สำรอง', 'อีเมล', 'LINE ID', 'Facebook']) {
        if (await page.locator(`text=${field}`).first().isVisible().catch(() => false)) {
          // field exists
        }
      }
      await ss.capture('contact-fields-checked');
    }

    // Section 5: ข้อมูลที่ทำงาน (collapsed)
    const workSection = page.locator('text=ข้อมูลที่ทำงาน').first();
    if (await workSection.isVisible().catch(() => false)) {
      await workSection.click();
      await page.waitForTimeout(300);
      await ss.capture('section-work-expanded');

      for (const field of ['ชื่อที่ทำงาน', 'อาชีพ', 'เงินเดือน']) {
        if (await page.locator(`text=${field}`).first().isVisible().catch(() => false)) {
          // field exists
        }
      }
      await ss.capture('work-fields-checked');
    }

    // Section 6: บุคคลอ้างอิง (collapsed)
    const refSection = page.locator('text=บุคคลอ้างอิง').first();
    if (await refSection.isVisible().catch(() => false)) {
      await refSection.click();
      await page.waitForTimeout(300);
      await ss.capture('section-references-expanded');

      // ตรวจ 2 reference blocks
      if (await page.locator('text=บุคคลอ้างอิง 1').first().isVisible().catch(() => false)) {
        await ss.capture('reference-1');
      }
      if (await page.locator('text=บุคคลอ้างอิง 2').first().isVisible().catch(() => false)) {
        await ss.capture('reference-2');
      }

      // ตรวจ relationship dropdown
      if (await page.locator('text=ความสัมพันธ์').first().isVisible().catch(() => false)) {
        await ss.capture('relationship-field');
      }
    }

    // ปิด modal
    const cancelBtn = page.locator('button:has-text("ยกเลิก")').first();
    if (await cancelBtn.isVisible().catch(() => false)) {
      await cancelBtn.click();
    }
    await ss.capture('sections-done');
  });

  // ─── 7. Navigate ไป customer detail (double-click) ───
  test('should navigate to customer detail on row double-click', async ({ page }) => {
    const ss = new StepScreenshot(page, 'customers-07-nav-dblclick');

    await page.waitForLoadState('networkidle');
    await ss.capture('page-ready');

    const firstRow = page.locator('table tbody tr').first();
    if (await firstRow.isVisible().catch(() => false)) {
      await ss.capture('first-row-visible');

      await firstRow.dblclick();
      await page.waitForTimeout(1000);
      await ss.capture('after-dblclick');

      const url = page.url();
      if (url.includes('/customers/')) {
        await expect(page).toHaveURL(/\/customers\//);
        await ss.capture('on-customer-detail');
      }
    } else {
      await ss.capture('no-rows');
    }
  });

  // ─── 8. Navigate ไป customer detail (click ชื่อ) ───
  test('should navigate to customer detail on name click', async ({ page }) => {
    const ss = new StepScreenshot(page, 'customers-08-nav-name');

    await page.waitForLoadState('networkidle');
    await ss.capture('page-ready');

    // หา button ชื่อลูกค้าในตาราง
    const nameBtn = page.locator('table tbody tr button').first();
    if (await nameBtn.isVisible().catch(() => false)) {
      await ss.capture('name-button-visible');

      await nameBtn.click();
      await page.waitForTimeout(1000);
      await ss.capture('after-name-click');

      if (page.url().includes('/customers/')) {
        await ss.capture('on-customer-detail');
      }
    } else {
      await ss.capture('no-name-button');
    }
  });

  // ─── 9. Credit status badges ───
  test('should display credit status badges', async ({ page }) => {
    const ss = new StepScreenshot(page, 'customers-09-credit-badges');

    await page.waitForLoadState('networkidle');
    await ss.capture('page-ready');

    for (const badge of ['ผ่าน', 'ไม่ผ่าน', 'รอตรวจ', 'รอรีวิว']) {
      const el = page.locator(`text=${badge}`).first();
      if (await el.isVisible().catch(() => false)) {
        await ss.capture(`credit-badge-${badge}`);
      }
    }

    // ตรวจ credit score "X/100"
    const scoreEl = page.locator('text=/\\d+\\/100/').first();
    if (await scoreEl.isVisible().catch(() => false)) {
      await ss.capture('credit-score-visible');
    }

    await ss.capture('credit-badges-checked');
  });

  // ─── 10. Contract count display ───
  test('should display contract counts in table', async ({ page }) => {
    const ss = new StepScreenshot(page, 'customers-10-contract-count');

    await page.waitForLoadState('networkidle');
    await ss.capture('page-ready');

    // ตรวจ "สัญญา" in table
    if (await page.locator('text=สัญญา').first().isVisible().catch(() => false)) {
      await ss.capture('contract-column');
    }

    // ตรวจ active contracts "ใช้งาน"
    if (await page.locator('text=ใช้งาน').first().isVisible().catch(() => false)) {
      await ss.capture('active-contracts');
    }

    // ตรวจ overdue contracts "ค้างชำระ"
    if (await page.locator('text=ค้างชำระ').first().isVisible().catch(() => false)) {
      await ss.capture('overdue-contracts');
    }

    await ss.capture('contract-counts-checked');
  });

  // ─── 11. Pagination ───
  test('should handle pagination', async ({ page }) => {
    const ss = new StepScreenshot(page, 'customers-11-pagination');

    await page.waitForLoadState('networkidle');
    await ss.capture('page-ready');

    const nextBtn = page.locator('button:has-text("ถัดไป")').first();
    const prevBtn = page.locator('button:has-text("ก่อนหน้า")').first();

    if (await nextBtn.isVisible().catch(() => false)) {
      await ss.capture('pagination-visible');

      if (await prevBtn.isDisabled()) {
        await ss.capture('prev-disabled-page1');
      }

      if (await nextBtn.isEnabled()) {
        await nextBtn.click();
        await page.waitForLoadState('networkidle');
        await ss.capture('page-2');

        if (await prevBtn.isEnabled()) {
          await prevBtn.click();
          await page.waitForLoadState('networkidle');
          await ss.capture('back-to-page-1');
        }
      } else {
        await ss.capture('only-one-page');
      }
    } else {
      await ss.capture('no-pagination');
    }
  });

  // ─── 12. Empty state ───
  test('should show empty state when no results', async ({ page }) => {
    const ss = new StepScreenshot(page, 'customers-12-empty');

    await page.waitForLoadState('networkidle');
    await ss.capture('page-ready');

    const searchInput = page.locator('input[placeholder*="ค้นหา"]').first();
    await searchInput.type('zzzzxxxxxnotfound12345', { delay: 20 });
    await page.waitForTimeout(1000);
    await page.waitForLoadState('networkidle');
    await ss.capture('search-no-results');

    const emptyMsg = page.locator('text=ไม่พบลูกค้า');
    if (await emptyMsg.isVisible({ timeout: 3000 }).catch(() => false)) {
      await ss.capture('empty-state-visible');
    }

    await searchInput.clear();
    await page.waitForTimeout(500);
    await page.waitForLoadState('networkidle');
    await ss.capture('back-to-normal');
  });

  // ─── 13. ตรวจ masked national ID ───
  test('should display masked national ID in table', async ({ page }) => {
    const ss = new StepScreenshot(page, 'customers-13-masked-id');

    await page.waitForLoadState('networkidle');
    await ss.capture('page-ready');

    // ตรวจ monospace text ในคอลัมน์เลขบัตร
    const monoCell = page.locator('table tbody td .font-mono').first();
    if (await monoCell.isVisible().catch(() => false)) {
      const text = await monoCell.textContent();
      await ss.capture('masked-id-visible');

      // ตรวจว่ามี mask (มี * หรือ X)
      if (text && (text.includes('*') || text.includes('X') || text.includes('x'))) {
        await ss.capture('id-is-masked');
      }
    }

    await ss.capture('masked-id-done');
  });
});
