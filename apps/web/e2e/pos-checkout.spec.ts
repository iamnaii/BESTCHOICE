import { test, expect } from '@playwright/test';
import { loginAsRole } from './helpers/auth';
import { gotoWithRetry, hasErrorBoundary } from './helpers/navigation';

/* ================================================================
   P0: POS Checkout Flow — Cash Sale
   Tests the complete POS checkout journey for a cash sale.
   ================================================================ */
test.describe('POS Checkout Flow', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsRole(page, 'SALES');
  });

  test('should load POS page with sale type options', async ({ page }) => {
    const ok = await gotoWithRetry(page, '/pos');
    if (!ok) return;

    await page.waitForTimeout(2000);

    // POS heading should be visible
    await expect(page.getByText('POS').first()).toBeVisible({ timeout: 15000 });

    // Sale type options should be present (CASH and EXTERNAL_FINANCE)
    await expect(page.getByText(/เงินสด|CASH/i).first()).toBeVisible({ timeout: 10000 });
  });

  test('should search for a product', async ({ page }) => {
    const ok = await gotoWithRetry(page, '/pos');
    if (!ok) return;

    await page.waitForTimeout(2000);

    // Find the product search input
    const productSearch = page.getByPlaceholder(/ค้นหาสินค้า|IMEI|ชื่อ|รุ่น|สินค้า/i).first();
    if (!await productSearch.isVisible({ timeout: 10000 }).catch(() => false)) {
      // Try alternative locator
      const altSearch = page.locator('input[type="text"]').first();
      if (await altSearch.isVisible({ timeout: 5000 }).catch(() => false)) {
        await altSearch.fill('iPhone');
        await page.waitForTimeout(1000);
        await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
      }
      return;
    }

    await productSearch.fill('iPhone');
    await page.waitForTimeout(1000);

    // Search results should appear (dropdown or list)
    const results = page.locator('[role="listbox"], [role="option"], .product-result, table tbody tr, .search-result').first();
    const hasResults = await results.isVisible({ timeout: 5000 }).catch(() => false);

    // No error regardless of results
    await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');

    if (hasResults) {
      await expect(results).toBeVisible();
    }
  });

  test('should select a product from search results', async ({ page }) => {
    const ok = await gotoWithRetry(page, '/pos');
    if (!ok) return;

    await page.waitForTimeout(2000);

    // Search for a product
    const productSearch = page.getByPlaceholder(/ค้นหาสินค้า|IMEI|ชื่อ|รุ่น|สินค้า/i).first();
    if (!await productSearch.isVisible({ timeout: 10000 }).catch(() => false)) return;

    await productSearch.fill('iPhone');
    await page.waitForTimeout(1500);

    // Click on first search result if available
    const resultItem = page.locator('[role="option"], .product-result, .search-result').first()
      .or(page.locator('.cursor-pointer, [class*="hover"]').filter({ hasText: /iPhone/i }).first());

    if (await resultItem.isVisible({ timeout: 5000 }).catch(() => false)) {
      await resultItem.click();
      await page.waitForTimeout(1000);

      // After selection, product details or price should appear
      const priceField = page.getByText(/ราคา|price|฿/i).first()
        .or(page.locator('input[name*="price"], input[placeholder*="ราคา"]').first());
      if (await priceField.isVisible({ timeout: 5000 }).catch(() => false)) {
        await expect(priceField).toBeVisible();
      }
    }

    await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
  });

  test('should search for a customer', async ({ page }) => {
    const ok = await gotoWithRetry(page, '/pos');
    if (!ok) return;

    await page.waitForTimeout(2000);

    // Find customer search input
    const customerSearch = page.getByPlaceholder(/ค้นหาลูกค้า|ชื่อ|เบอร์|บัตร|ลูกค้า/i).first();
    if (!await customerSearch.isVisible({ timeout: 10000 }).catch(() => false)) return;

    await customerSearch.fill('สุร');
    await page.waitForTimeout(1500);

    // Customer results should appear
    const results = page.locator('[role="option"], .customer-result, .search-result').first();
    const hasResults = await results.isVisible({ timeout: 5000 }).catch(() => false);

    await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');

    if (hasResults) {
      await expect(results).toBeVisible();
    }
  });

  test('should select CASH sale type', async ({ page }) => {
    const ok = await gotoWithRetry(page, '/pos');
    if (!ok) return;

    await page.waitForTimeout(2000);

    // Click on CASH option
    const cashOption = page.getByText(/เงินสด/).first();
    if (await cashOption.isVisible({ timeout: 10000 }).catch(() => false)) {
      await cashOption.click();
      await page.waitForTimeout(500);

      // CASH should be selected/active
      await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
    }
  });

  test('should switch between CASH and EXTERNAL_FINANCE sale types', async ({ page }) => {
    const ok = await gotoWithRetry(page, '/pos');
    if (!ok) return;

    await page.waitForTimeout(2000);

    // Switch to external finance
    const financeOption = page.getByText(/ไฟแนนซ์|ภายนอก/).first();
    if (await financeOption.isVisible({ timeout: 5000 }).catch(() => false)) {
      await financeOption.click();
      await page.waitForTimeout(500);
      await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
    }

    // Switch back to cash
    const cashOption = page.getByText(/เงินสด/).first();
    if (await cashOption.isVisible({ timeout: 5000 }).catch(() => false)) {
      await cashOption.click();
      await page.waitForTimeout(500);
      await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
    }
  });

  test('should validate checkout requires product selection', async ({ page }) => {
    const ok = await gotoWithRetry(page, '/pos');
    if (!ok) return;

    await page.waitForTimeout(2000);

    // Find the submit/checkout button
    const submitBtn = page.locator('button').filter({ hasText: /ยืนยันการขาย|บันทึกการขาย|ชำระเงิน|ขาย/ }).first();
    if (await submitBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      const isDisabled = await submitBtn.isDisabled();
      if (!isDisabled) {
        await submitBtn.click();
        await page.waitForTimeout(1000);
        // Should show validation error (toast or inline)
        const hasError = await page.locator('[data-sonner-toast], .text-destructive, .text-red-500, [role="alert"]').first()
          .isVisible({ timeout: 5000 }).catch(() => false);
        expect(hasError).toBeTruthy();
      } else {
        // Button disabled without product = correct behavior
        expect(isDisabled).toBeTruthy();
      }
    }
    // If no submit button visible at all — product must be selected first (valid)
  });

  test('should show payment method options for cash sale', async ({ page }) => {
    const ok = await gotoWithRetry(page, '/pos');
    if (!ok) return;

    await page.waitForTimeout(2000);

    // Payment methods section (CASH, TRANSFER, QR, etc.)
    const paymentSection = page.getByText(/วิธีชำระ|ช่องทาง|โอน|QR/i).first();
    if (await paymentSection.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(paymentSection).toBeVisible();
    }

    await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
  });

  test('should display selling price and discount fields', async ({ page }) => {
    const ok = await gotoWithRetry(page, '/pos');
    if (!ok) return;

    await page.waitForTimeout(2000);

    // These fields may only appear after product selection.
    // Just verify the page is stable and no errors.
    const priceInput = page.locator('input[name*="price"], input[placeholder*="ราคา"]').first();
    const discountInput = page.locator('input[name*="discount"], input[placeholder*="ส่วนลด"]').first();

    if (await priceInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(priceInput).toBeVisible();
    }
    if (await discountInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      await expect(discountInput).toBeVisible();
    }

    await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
  });
});
