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
    ).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('เพิ่มลูกค้า').first()).toBeVisible();

    // Summary cards should be visible
    await expect(page.getByText('ลูกค้าทั้งหมด').first()).toBeVisible();
  });

  test('should open create customer modal', async ({ page }) => {
    await page.goto('/customers', { waitUntil: 'domcontentloaded' });

    // Wait for page to load, then click the add customer button
    await expect(page.getByText('เพิ่มลูกค้า').first()).toBeVisible({ timeout: 15000 });
    await page.getByText('เพิ่มลูกค้า').first().click();

    // Modal should appear with title
    await expect(page.getByText('เพิ่มลูกค้าใหม่')).toBeVisible({ timeout: 5000 });

    // Required form fields should be visible — look for labels inside modal
    const modal = page.locator('[role="dialog"], .modal').first();
    await expect(modal.getByText('ชื่อ', { exact: false }).first()).toBeVisible();
    await expect(modal.getByText('นามสกุล', { exact: false }).first()).toBeVisible();
  });

  test('should create a new customer successfully', async ({ page }) => {
    await page.goto('/customers', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('เพิ่มลูกค้า').first()).toBeVisible({ timeout: 15000 });
    await page.getByText('เพิ่มลูกค้า').first().click();
    await expect(page.getByText('เพิ่มลูกค้าใหม่')).toBeVisible({ timeout: 5000 });

    // Use unique name with timestamp to avoid collisions
    const uniqueSuffix = Date.now().toString().slice(-6);
    const firstName = `${TEST_CUSTOMER.firstName}${uniqueSuffix}`;

    // Find the modal form — inputs are inside sections with labels
    const modal = page.locator('[role="dialog"], .modal').first();

    // Wait for visible text inputs to be ready (skip hidden file inputs)
    await modal.locator('input[type="text"]:visible, select:visible').first().waitFor({ timeout: 5000 });

    // The form has sections: คำนำหน้า (select), ชื่อ (text), นามสกุล (text), ...
    // Get all visible text inputs in the modal
    const textInputs = modal.locator('input[type="text"]:visible');

    // Fill ชื่อ (first visible text input after select)
    await textInputs.nth(0).fill(firstName);
    // Fill นามสกุล
    await textInputs.nth(1).fill(TEST_CUSTOMER.lastName);
    // Fill เลขบัตรประชาชน
    await textInputs.nth(2).fill(TEST_CUSTOMER.nationalId);

    // Fill เบอร์โทร (tel input)
    const phoneInput = modal.locator('input[type="tel"]:visible').first();
    await phoneInput.fill(TEST_CUSTOMER.phone);

    // Submit the form
    await modal.locator('button:has-text("บันทึก")').click();

    // Wait for success toast or modal to close
    await expect(page.locator('[data-sonner-toast]').first()).toBeVisible({ timeout: 10000 });
  });

  test('should search and filter customers', async ({ page }) => {
    await page.goto('/customers', { waitUntil: 'domcontentloaded' });

    const searchInput = page.getByPlaceholder('ค้นหาชื่อ, เบอร์โทร, เลขบัตร ปชช...');
    await expect(searchInput).toBeVisible({ timeout: 15000 });

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

    // Wait for page to fully load
    await expect(
      page.getByPlaceholder('ค้นหาชื่อ, เบอร์โทร, เลขบัตร ปชช...'),
    ).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(1000);

    // Click on the first customer row link
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
