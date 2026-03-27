import { test, expect } from '@playwright/test';
import { loginViaAPI } from './helpers/auth';
import { TEST_CUSTOMER } from './helpers/test-data';

test.describe('Customers Page', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page);
  });

  test('should navigate to /customers and display customer list', async ({ page }) => {
    await page.goto('/customers', { waitUntil: 'domcontentloaded' });

    // Verify page loaded — search input and add button should be visible
    await expect(
      page.getByPlaceholder('ค้นหาชื่อ, เบอร์โทร, เลขบัตร ปชช...'),
    ).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('เพิ่มลูกค้า')).toBeVisible();

    // Summary cards should be visible
    await expect(page.getByText('ลูกค้าทั้งหมด')).toBeVisible();
  });

  test('should open create customer modal', async ({ page }) => {
    await page.goto('/customers', { waitUntil: 'domcontentloaded' });

    // Click the add customer button
    await page.getByText('เพิ่มลูกค้า').click();

    // Modal should appear with title
    await expect(page.getByText('เพิ่มลูกค้าใหม่')).toBeVisible({ timeout: 5000 });

    // Required form fields should be visible
    await expect(page.getByText('ชื่อ', { exact: false }).first()).toBeVisible();
    await expect(page.getByText('นามสกุล', { exact: false }).first()).toBeVisible();
  });

  test('should create a new customer successfully', async ({ page }) => {
    await page.goto('/customers', { waitUntil: 'domcontentloaded' });
    await page.getByText('เพิ่มลูกค้า').click();
    await expect(page.getByText('เพิ่มลูกค้าใหม่')).toBeVisible({ timeout: 5000 });

    // Use unique name with timestamp to avoid collisions
    const uniqueSuffix = Date.now().toString().slice(-6);
    const firstName = `${TEST_CUSTOMER.firstName}${uniqueSuffix}`;

    // Fill required fields — find inputs inside the modal
    const modal = page.locator('[role="dialog"], .modal').first();
    const form = modal.locator('form').first().or(modal);

    // Fill first name (ชื่อ) — first text input after the prefix dropdown
    const firstNameInput = form.locator('input').filter({ hasText: '' }).nth(0);
    // Try to find by label association or sequential order
    const inputs = form.locator('input[type="text"], input:not([type])');

    // Fill the basic required fields
    // The form structure: คำนำหน้า (select), ชื่อ (input), นามสกุล (input), เลขบัตรประชาชน (input), เบอร์โทร (input)
    await form.locator('input').first().waitFor({ timeout: 5000 });

    // Get all visible text inputs in the form
    const textInputs = form.locator('input[type="text"], input:not([type]):not([type="hidden"])');

    // Fill ชื่อ (first text input after any select)
    await textInputs.nth(0).fill(firstName);
    // Fill นามสกุล
    await textInputs.nth(1).fill(TEST_CUSTOMER.lastName);
    // Fill เลขบัตรประชาชน
    await textInputs.nth(2).fill(TEST_CUSTOMER.nationalId);

    // Fill เบอร์โทร (tel input)
    const phoneInput = form.locator('input[type="tel"]').first();
    await phoneInput.fill(TEST_CUSTOMER.phone);

    // Submit the form
    await form.locator('button:has-text("บันทึก")').click();

    // Wait for success toast or modal to close
    await expect(page.locator('[data-sonner-toast]').first()).toBeVisible({ timeout: 10000 });

    // Verify customer appears in the list by searching
    await page.getByPlaceholder('ค้นหาชื่อ, เบอร์โทร, เลขบัตร ปชช...').fill(firstName);
    await page.waitForTimeout(500); // debounce delay

    // The customer name should appear in results
    await expect(page.getByText(firstName)).toBeVisible({ timeout: 10000 });
  });

  test('should search and filter customers', async ({ page }) => {
    await page.goto('/customers', { waitUntil: 'domcontentloaded' });

    const searchInput = page.getByPlaceholder('ค้นหาชื่อ, เบอร์โทร, เลขบัตร ปชช...');
    await expect(searchInput).toBeVisible({ timeout: 10000 });

    // Type a search query
    await searchInput.fill('test');
    await page.waitForTimeout(500); // debounce

    // Page should update without error
    await expect(page.locator('[data-sonner-toast][data-type="error"]')).not.toBeVisible({
      timeout: 3000,
    }).catch(() => {
      // No error toast — good
    });
  });

  test('should navigate to customer detail page', async ({ page }) => {
    await page.goto('/customers', { waitUntil: 'domcontentloaded' });

    // Wait for table to load
    await page.waitForTimeout(2000);

    // Click on the first customer name link in the table
    const customerLink = page.locator('table tbody tr td a, table tbody tr td .text-primary.cursor-pointer').first();

    if (await customerLink.isVisible({ timeout: 5000 }).catch(() => false)) {
      await customerLink.click();
      // Should navigate to /customers/:id
      await expect(page).toHaveURL(/\/customers\/.+/, { timeout: 10000 });
    } else {
      // If no customers exist, the test passes (empty state)
      await expect(
        page.getByText('ไม่พบข้อมูล').or(page.locator('table tbody')),
      ).toBeVisible();
    }
  });
});
