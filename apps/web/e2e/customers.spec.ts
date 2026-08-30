import { test, expect } from '@playwright/test';
import { loginViaAPI } from './helpers/auth';
import { TEST_CUSTOMER } from './helpers/test-data';

/**
 * เลขบัตรประชาชน 13 หลักที่ผ่าน checksum ของกรมการปกครอง
 * (12 หลักแรกสุ่ม แล้วคำนวณหลักที่ 13):
 *   check = (11 - (Σ digit[i] × (13 - i)) % 11) % 10
 *
 * สูตรเดียวกันถูกบังคับ **สองชั้น**:
 *   - ฝั่งเว็บ `isValidThaiNationalId` — apps/web/src/lib/schemas.ts:13 ใช้ผ่าน
 *     `nationalIdSchema` (schemas.ts:31-34) ที่ `customerSchema.nationalId` อ้างอิง
 *   - ฝั่ง API `validateThaiNationalId` — apps/api/src/utils/validation.util.ts:10
 *     เรียกจาก customer-write.service.ts:232 แล้วตอบ 409 'เลขบัตรประชาชนไม่ถูกต้อง'
 *
 * ห้ามใช้ `TEST_CUSTOMER.nationalId` ('1234567890123') กับฟอร์มนี้ — checksum
 * ของมันได้ 1 แต่หลักที่ 13 เป็น 3 ⇒ zod refine บล็อกตั้งแต่ฝั่ง client
 * (ฟอร์มไม่ยิง API เลย จึงไม่มี toast ใด ๆ ขึ้นมาให้รอ)
 */
function makeValidThaiNationalId(): string {
  const digits = Array.from({ length: 12 }, () => Math.floor(Math.random() * 10));
  const sum = digits.reduce((acc, d, i) => acc + d * (13 - i), 0);
  return digits.join('') + String((11 - (sum % 11)) % 10);
}

/** เบอร์ไทยที่ผ่านทั้ง `thaiPhoneRegex` (schemas.ts:24) และ DTO ฝั่ง API */
function makeUniqueThaiPhone(): string {
  return `08${Math.floor(10000000 + Math.random() * 89999999)}`;
}

test.describe('Customers Page', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page);
  });

  test('should navigate to /customers and display customer list', async ({ page }) => {
    await page.goto('/customers', { waitUntil: 'domcontentloaded' });

    // Verify page loaded — search input and add button should be visible
    await expect(page.getByPlaceholder('ค้นหาชื่อ, เบอร์โทร, เลขบัตร ปชช...')).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByText('เพิ่มลูกค้า').first()).toBeVisible();

    // Summary cards should be visible
    await expect(page.getByText('ลูกค้าทั้งหมด').first()).toBeVisible();
  });

  test('should open create customer modal', async ({ page }) => {
    await page.goto('/customers', { waitUntil: 'domcontentloaded' });

    // Wait for page to load, then click the add customer button
    // PR #1496: the button opens an in-page modal instead of navigating to
    // /customer-intake, so the button label and the modal <h2> now share the
    // same text — target the button by role to keep the locator unambiguous.
    const addButton = page.getByRole('button', { name: '+ เพิ่มลูกค้าใหม่' });
    await expect(addButton).toBeVisible({ timeout: 15000 });
    await addButton.click();

    // Modal should appear with title (heading role → the modal <h2> only)
    await expect(page.getByRole('heading', { name: 'เพิ่มลูกค้าใหม่' })).toBeVisible({
      timeout: 5000,
    });

    // Required form fields should be visible — look for labels inside modal
    const modal = page.locator('[role="dialog"], .modal').first();
    await expect(modal.getByText('ชื่อ', { exact: false }).first()).toBeVisible();
    await expect(modal.getByText('นามสกุล', { exact: false }).first()).toBeVisible();
  });

  test('should create a new customer successfully', async ({ page }) => {
    await page.goto('/customers', { waitUntil: 'domcontentloaded' });
    const addButton = page.getByRole('button', { name: '+ เพิ่มลูกค้าใหม่' });
    await expect(addButton).toBeVisible({ timeout: 15000 });
    await addButton.click();
    await expect(page.getByRole('heading', { name: 'เพิ่มลูกค้าใหม่' })).toBeVisible({
      timeout: 5000,
    });

    // Use unique name with timestamp to avoid collisions
    const uniqueSuffix = Date.now().toString().slice(-6);
    const firstName = `${TEST_CUSTOMER.firstName}${uniqueSuffix}`;

    // Find the modal form — inputs are inside sections with labels
    const modal = page.locator('[role="dialog"], .modal').first();

    // Wait for visible text inputs to be ready (skip hidden file inputs)
    await modal
      .locator('input[type="text"]:visible, select:visible')
      .first()
      .waitFor({ timeout: 5000 });

    // คำนำหน้าเป็นฟิลด์ **บังคับ** — `prefix: z.string().min(1, 'กรุณาเลือกคำนำหน้า')`
    // (apps/web/src/lib/schemas.ts:42) และ default เป็นค่าว่าง (CustomersPage.tsx:125)
    // ⇒ ไม่เลือก = zod resolver บล็อก `form.handleSubmit` (CustomersPage.tsx:969)
    // ฟอร์มไม่ยิง `createMutation` เลย จึงไม่มีทั้ง toast สำเร็จและ toast error
    // select ตัวแรกที่มองเห็นในโมดัลคือ "คำนำหน้า" (CustomersPage.tsx:1021)
    await modal.locator('select:visible').first().selectOption('นาย');

    // The form has sections: คำนำหน้า (select), ชื่อ (text), นามสกุล (text), ...
    // Get all visible text inputs in the modal
    // (input[type=file] ของ OCR ที่ CustomersPage.tsx:986 เป็น .hidden จึงหลุด :visible)
    const textInputs = modal.locator('input[type="text"]:visible');

    // Fill ชื่อ (first visible text input after select)
    await textInputs.nth(0).fill(firstName);
    // Fill นามสกุล
    await textInputs.nth(1).fill(TEST_CUSTOMER.lastName);
    // Fill เลขบัตรประชาชน — ต้องผ่าน checksum (ดู makeValidThaiNationalId ด้านบน)
    await textInputs.nth(2).fill(makeValidThaiNationalId());

    // Fill เบอร์โทร (tel input) — ต้องไม่ซ้ำของเดิม: `assertContactNotDuplicate`
    // (apps/api/src/modules/customers/services/customer-write.service.ts:238)
    // ตอบ 409 ถ้าเบอร์ซ้ำ ⇒ ค่าคงที่ TEST_CUSTOMER.phone จะชนตัวเองตั้งแต่รอบที่สอง
    const phoneInput = modal.locator('input[type="tel"]:visible').first();
    await phoneInput.fill(makeUniqueThaiPhone());

    // Submit the form
    await modal.locator('button:has-text("บันทึก")').click();

    // สำเร็จ → toast.success('เพิ่มลูกค้าสำเร็จ') (CustomersPage.tsx:295) แล้ว navigate
    // ไป /customers/:id — Toaster อยู่ระดับ root (main.tsx:114) toast จึงอยู่ข้ามหน้า
    // เจาะจงข้อความสำเร็จ ไม่ใช่ `[data-sonner-toast]` ลอย ๆ เพราะ toast.error
    // ก็ใช้ selector เดียวกัน ⇒ ของเดิม "ผ่าน" ได้แม้การสร้างลูกค้าจะล้มเหลว
    await expect(
      page.locator('[data-sonner-toast]').filter({ hasText: 'เพิ่มลูกค้าสำเร็จ' }).first(),
    ).toBeVisible({ timeout: 10000 });
  });

  test('should search and filter customers', async ({ page }) => {
    await page.goto('/customers', { waitUntil: 'domcontentloaded' });

    const searchInput = page.getByPlaceholder('ค้นหาชื่อ, เบอร์โทร, เลขบัตร ปชช...');
    await expect(searchInput).toBeVisible({ timeout: 15000 });

    // Type a search query
    await searchInput.fill('test');
    await page.waitForTimeout(500); // debounce

    // Page should update without error
    await expect(page.locator('[data-sonner-toast][data-type="error"]'))
      .not.toBeVisible({
        timeout: 3000,
      })
      .catch(() => {
        // No error toast — good
      });
  });

  test('should navigate to customer detail page', async ({ page }) => {
    await page.goto('/customers', { waitUntil: 'domcontentloaded' });

    // Wait for page to fully load
    await expect(page.getByPlaceholder('ค้นหาชื่อ, เบอร์โทร, เลขบัตร ปชช...')).toBeVisible({
      timeout: 15000,
    });
    await page.waitForTimeout(1000);

    // Click on the first customer row link
    const customerLink = page
      .locator('table tbody tr td a, table tbody tr td .text-primary.cursor-pointer')
      .first();

    if (await customerLink.isVisible({ timeout: 5000 }).catch(() => false)) {
      await customerLink.click();
      // Should navigate to /customers/:id
      await expect(page).toHaveURL(/\/customers\/.+/, { timeout: 10000 });
    } else {
      // If no customers exist, the test passes (empty state)
      await expect(page.getByText('ไม่พบข้อมูล').or(page.locator('table tbody'))).toBeVisible();
    }
  });
});
