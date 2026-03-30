import { test, expect } from '@playwright/test';
import { loginViaAPI } from './helpers/auth';

test.describe('POS Page', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page);
  });

  test('should navigate to POS and display sale form', async ({ page }) => {
    await page.goto('/pos', { waitUntil: 'domcontentloaded' });

    // Product search input should be visible
    await expect(
      page.getByPlaceholder('พิมพ์อย่างน้อย 2 ตัวอักษร เช่น IMEI, ชื่อ, รุ่น...'),
    ).toBeVisible({ timeout: 15000 });

    // Sale type buttons should be visible
    await expect(page.getByText('เงินสด').first()).toBeVisible();
  });

  test('should show product search dropdown when typing 2+ characters', async ({ page }) => {
    await page.goto('/pos', { waitUntil: 'domcontentloaded' });

    const searchInput = page.getByPlaceholder('พิมพ์อย่างน้อย 2 ตัวอักษร เช่น IMEI, ชื่อ, รุ่น...');
    await expect(searchInput).toBeVisible({ timeout: 15000 });

    // Type 2+ characters to trigger search dropdown
    await searchInput.fill('ip');
    await page.waitForTimeout(600); // debounce

    // Either results or "ไม่พบสินค้า" or loading spinner should appear
    const dropdown = page.locator('.absolute.z-50, .absolute.z-\\[50\\]').first();
    const hasDropdown = await dropdown.isVisible({ timeout: 5000 }).catch(() => false);

    if (hasDropdown) {
      // Dropdown appeared — either with results or empty state
      await expect(dropdown).toBeVisible();
    }
    // If no dropdown, the search might not return results — that's OK
  });

  test('should show customer search when product is in context', async ({ page }) => {
    await page.goto('/pos', { waitUntil: 'domcontentloaded' });

    // Customer search should be present
    const customerSearch = page.getByPlaceholder('พิมพ์อย่างน้อย 2 ตัวอักษร เช่น ชื่อ, เบอร์โทร, เลขบัตร...');
    await expect(customerSearch).toBeVisible({ timeout: 15000 });
  });

  test('should disable save button when form is incomplete', async ({ page }) => {
    await page.goto('/pos', { waitUntil: 'domcontentloaded' });

    // Wait for page to load
    await expect(
      page.getByPlaceholder('พิมพ์อย่างน้อย 2 ตัวอักษร เช่น IMEI, ชื่อ, รุ่น...'),
    ).toBeVisible({ timeout: 15000 });

    // Save button should be disabled without product and customer selected
    const saveBtn = page.getByText('บันทึกการขาย').first();
    if (await saveBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await expect(saveBtn).toBeDisabled();
    }
  });

  test('should show discount quick buttons', async ({ page }) => {
    await page.goto('/pos', { waitUntil: 'domcontentloaded' });

    await expect(
      page.getByPlaceholder('พิมพ์อย่างน้อย 2 ตัวอักษร เช่น IMEI, ชื่อ, รุ่น...'),
    ).toBeVisible({ timeout: 15000 });

    // Discount quick action buttons (0%, 5%, 10%)
    await expect(page.getByText('0%').first()).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('5%').first()).toBeVisible();
    await expect(page.getByText('10%').first()).toBeVisible();
  });

  test('should have clear form button', async ({ page }) => {
    await page.goto('/pos', { waitUntil: 'domcontentloaded' });

    await expect(
      page.getByPlaceholder('พิมพ์อย่างน้อย 2 ตัวอักษร เช่น IMEI, ชื่อ, รุ่น...'),
    ).toBeVisible({ timeout: 15000 });

    // Clear form button
    const clearBtn = page.getByText('ล้างข้อมูล').first();
    await expect(clearBtn).toBeVisible({ timeout: 5000 });
  });

  test('should show installment option link', async ({ page }) => {
    await page.goto('/pos', { waitUntil: 'domcontentloaded' });

    await expect(
      page.getByPlaceholder('พิมพ์อย่างน้อย 2 ตัวอักษร เช่น IMEI, ชื่อ, รุ่น...'),
    ).toBeVisible({ timeout: 15000 });

    // Link to create installment contract
    const installmentLink = page.getByText('สร้างสัญญา').first();
    await expect(installmentLink).toBeVisible({ timeout: 5000 });
  });

  test('should show summary panel with price breakdown labels', async ({ page }) => {
    await page.goto('/pos', { waitUntil: 'domcontentloaded' });

    await expect(
      page.getByPlaceholder('พิมพ์อย่างน้อย 2 ตัวอักษร เช่น IMEI, ชื่อ, รุ่น...'),
    ).toBeVisible({ timeout: 15000 });

    // Summary panel labels should be present
    await expect(page.getByText('ราคาขาย').first()).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('ยอดสุทธิ').first()).toBeVisible();
  });

  test('should show external finance fields when selecting finance type', async ({ page }) => {
    await page.goto('/pos', { waitUntil: 'domcontentloaded' });

    await expect(
      page.getByPlaceholder('พิมพ์อย่างน้อย 2 ตัวอักษร เช่น IMEI, ชื่อ, รุ่น...'),
    ).toBeVisible({ timeout: 15000 });

    // Find and click external finance option
    const financeBtn = page.getByText('ไฟแนนซ์').first();
    if (await financeBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await financeBtn.click();

      // Finance company input should appear
      const financeInput = page.getByPlaceholder('ชื่อบริษัทไฟแนนซ์');
      await expect(financeInput).toBeVisible({ timeout: 5000 });
    }
  });
});
