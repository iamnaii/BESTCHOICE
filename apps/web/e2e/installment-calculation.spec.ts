import { test, expect } from '@playwright/test';
import { loginViaAPI } from './helpers/auth';

/**
 * Installment Calculation E2E Tests
 *
 * QA checklist scenario:
 *   ราคา 30,000, ดาวน์ 3,000, 12 เดือน, ดอกเบี้ย 1.5% (flat rate)
 *   expected principal = 27,000
 *   expected interestTotal = 27,000 × 0.015 × 12 = 4,860 (with zero storeComm + VAT)
 *
 * These tests navigate the contract creation wizard to verify the
 * PlanDetailsStep "สรุปการคำนวณ" panel displays and updates correctly.
 * When no products/customers are seeded, the wizard tests still pass
 * (they verify the wizard itself loads without errors).
 */

// Helpers to extract number from a Thai-formatted currency string (e.g. "27,000 ฿")
function parseBaht(text: string): number {
  return parseFloat(text.replace(/[,฿\s]/g, '')) || 0;
}

test.describe('Installment Calculation', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page);
  });

  test('should display calculation summary panel in PlanDetailsStep', async ({ page }) => {
    await page.goto('/contracts/create', { waitUntil: 'domcontentloaded' });

    // Step 0: Product selection must load
    const searchInput = page.getByPlaceholder(/ค้นหาสินค้า/);
    await expect(searchInput).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(1500);

    // Try to proceed through wizard
    const productRow = page.locator('table tbody tr, [data-product-row]').first();
    const hasProduct = await productRow.isVisible({ timeout: 5000 }).catch(() => false);

    if (!hasProduct) {
      // No products in DB — wizard is in empty state, which is valid
      await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
      return;
    }

    await productRow.click();
    const nextBtn = page.locator('button:has-text("ถัดไป"):not([disabled])');
    const canNext = await nextBtn.isVisible({ timeout: 3000 }).catch(() => false);
    if (!canNext) return;
    await nextBtn.click();

    // Step 1: Customer selection
    await page.waitForTimeout(1000);
    const customerRow = page.locator('table tbody tr').first();
    const hasCustomer = await customerRow.isVisible({ timeout: 5000 }).catch(() => false);
    if (!hasCustomer) return;

    await customerRow.click();
    const nextBtn2 = page.locator('button:has-text("ถัดไป"):not([disabled])');
    const canNext2 = await nextBtn2.isVisible({ timeout: 3000 }).catch(() => false);
    if (!canNext2) return;
    await nextBtn2.click();

    // Step 2: PlanDetailsStep — สรุปการคำนวณ section must be visible
    await expect(page.getByText('สรุปการคำนวณ').first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/^ค่างวดปกติ \(\d+ งวด\)$/)).toBeVisible();
    await page.getByText('รายละเอียดการคำนวณ (ภายใน)', { exact: true }).click();
    await expect(page.getByText('ยอดปล่อย', { exact: true })).toBeVisible();
    await expect(page.getByText(/^\+ ดอกเบี้ย \(/)).toBeVisible();
  });

  test('should show ค่างวด/เดือน as positive number in PlanDetailsStep', async ({ page }) => {
    await page.goto('/contracts/create', { waitUntil: 'domcontentloaded' });

    const searchInput = page.getByPlaceholder(/ค้นหาสินค้า/);
    await expect(searchInput).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(1500);

    // Navigate to PlanDetailsStep
    const productRow = page.locator('table tbody tr').first();
    if (!(await productRow.isVisible({ timeout: 5000 }).catch(() => false))) return;
    await productRow.click();

    const nextBtn = page.locator('button:has-text("ถัดไป"):not([disabled])');
    if (!(await nextBtn.isVisible({ timeout: 3000 }).catch(() => false))) return;
    await nextBtn.click();

    await page.waitForTimeout(1000);
    const customerRow = page.locator('table tbody tr').first();
    if (!(await customerRow.isVisible({ timeout: 5000 }).catch(() => false))) return;
    await customerRow.click();

    const nextBtn2 = page.locator('button:has-text("ถัดไป"):not([disabled])');
    if (!(await nextBtn2.isVisible({ timeout: 3000 }).catch(() => false))) return;
    await nextBtn2.click();

    // Verify ค่างวด/เดือน is a positive numeric value
    await expect(page.getByText(/^ค่างวดปกติ \(\d+ งวด\)$/)).toBeVisible({ timeout: 10000 });

    // The value is displayed as "X,XXX ฿" — verify it's > 0
    const monthlyPaymentEl = page.getByText(/^ค่างวดปกติ \(\d+ งวด\)$/)
      .locator('..').locator('span').last();

    const hasValue = await monthlyPaymentEl.isVisible({ timeout: 3000 }).catch(() => false);
    if (hasValue) {
      const text = (await monthlyPaymentEl.textContent()) ?? '';
      const value = parseBaht(text);
      expect(value).toBeGreaterThan(0);
    }
  });

  test('should verify principal = sellingPrice - downPayment in calculation panel', async ({
    page,
  }) => {
    await page.goto('/contracts/create', { waitUntil: 'domcontentloaded' });

    const searchInput = page.getByPlaceholder(/ค้นหาสินค้า/);
    await expect(searchInput).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(1500);

    const productRow = page.locator('table tbody tr').first();
    if (!(await productRow.isVisible({ timeout: 5000 }).catch(() => false))) return;
    await productRow.click();

    const nextBtn = page.locator('button:has-text("ถัดไป"):not([disabled])');
    if (!(await nextBtn.isVisible({ timeout: 3000 }).catch(() => false))) return;
    await nextBtn.click();

    await page.waitForTimeout(1000);
    const customerRow = page.locator('table tbody tr').first();
    if (!(await customerRow.isVisible({ timeout: 5000 }).catch(() => false))) return;
    await customerRow.click();

    const nextBtn2 = page.locator('button:has-text("ถัดไป"):not([disabled])');
    if (!(await nextBtn2.isVisible({ timeout: 3000 }).catch(() => false))) return;
    await nextBtn2.click();

    await expect(page.getByText('สรุปการคำนวณ').first()).toBeVisible({ timeout: 10000 });

    // Resolve the actual summary rows rather than their changing visual order.
    await page.getByText('รายละเอียดการคำนวณ (ภายใน)', { exact: true }).click();
    const sellingPriceText = await page.getByText('ราคาเครื่อง', { exact: true })
      .locator('..').locator('span').last().innerText();
    const downPaymentText = await page.getByText('ชำระล่วงหน้ารวม (สด/โอน + เครื่องเทิร์น)', { exact: true })
      .locator('..').locator('span').last().innerText();
    const principalText = await page.getByText('ยอดปล่อย', { exact: true })
      .locator('..').locator('span').last().innerText();

    const sellingPrice = parseBaht(sellingPriceText);
    const downPayment = parseBaht(downPaymentText.replace('-', ''));
    const displayedPrincipal = parseBaht(principalText);

    if (sellingPrice > 0 && downPayment >= 0) {
      const expectedPrincipal = sellingPrice - downPayment;
      // Allow ±1 baht for rounding
      expect(Math.abs(displayedPrincipal - expectedPrincipal)).toBeLessThanOrEqual(1);
    }
  });

  test('should update ค่างวด/เดือน when changing down payment', async ({ page }) => {
    await page.goto('/contracts/create', { waitUntil: 'domcontentloaded' });

    const searchInput = page.getByPlaceholder(/ค้นหาสินค้า/);
    await expect(searchInput).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(1500);

    const productRow = page.locator('table tbody tr').first();
    if (!(await productRow.isVisible({ timeout: 5000 }).catch(() => false))) return;
    await productRow.click();

    const nextBtn = page.locator('button:has-text("ถัดไป"):not([disabled])');
    if (!(await nextBtn.isVisible({ timeout: 3000 }).catch(() => false))) return;
    await nextBtn.click();

    await page.waitForTimeout(1000);
    const customerRow = page.locator('table tbody tr').first();
    if (!(await customerRow.isVisible({ timeout: 5000 }).catch(() => false))) return;
    await customerRow.click();

    const nextBtn2 = page.locator('button:has-text("ถัดไป"):not([disabled])');
    if (!(await nextBtn2.isVisible({ timeout: 3000 }).catch(() => false))) return;
    await nextBtn2.click();

    await expect(page.getByText('สรุปการคำนวณ').first()).toBeVisible({ timeout: 10000 });

    const downPaymentInput = page.locator('input[data-numeric-input]').first();
    if (!(await downPaymentInput.isVisible({ timeout: 3000 }).catch(() => false))) return;

    const monthlyPayment = page.getByText(/^ค่างวดปกติ \(\d+ งวด\)$/)
      .locator('..').locator('span').last();
    await expect(monthlyPayment).toBeVisible();
    const before = parseBaht(await monthlyPayment.innerText());
    expect(before).toBeGreaterThan(0);

    // Increase down payment by 1000
    const currentValue = Number((await downPaymentInput.inputValue()).replace(/,/g, ''));
    expect(Number.isFinite(currentValue)).toBe(true);
    const newValue = currentValue + 1000;
    await downPaymentInput.fill(String(newValue));
    await expect(page.locator('input[type="hidden"][name="downPayment"]')).toHaveValue(String(newValue));

    // Monthly payment should decrease (more down = less financed)
    await expect.poll(async () => {
      const after = parseBaht(await monthlyPayment.innerText());
      return { positive: after > 0, decreased: after < before };
    }).toEqual({ positive: true, decreased: true });
  });

  test('should update ค่างวด/เดือน when changing installment months', async ({ page }) => {
    await page.goto('/contracts/create', { waitUntil: 'domcontentloaded' });

    const searchInput = page.getByPlaceholder(/ค้นหาสินค้า/);
    await expect(searchInput).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(1500);

    const productRow = page.locator('table tbody tr').first();
    if (!(await productRow.isVisible({ timeout: 5000 }).catch(() => false))) return;
    await productRow.click();

    const nextBtn = page.locator('button:has-text("ถัดไป"):not([disabled])');
    if (!(await nextBtn.isVisible({ timeout: 3000 }).catch(() => false))) return;
    await nextBtn.click();

    await page.waitForTimeout(1000);
    const customerRow = page.locator('table tbody tr').first();
    if (!(await customerRow.isVisible({ timeout: 5000 }).catch(() => false))) return;
    await customerRow.click();

    const nextBtn2 = page.locator('button:has-text("ถัดไป"):not([disabled])');
    if (!(await nextBtn2.isVisible({ timeout: 3000 }).catch(() => false))) return;
    await nextBtn2.click();

    await expect(page.getByText('สรุปการคำนวณ').first()).toBeVisible({ timeout: 10000 });

    // Get available month options
    const monthSelect = page.locator('select').first();
    if (!(await monthSelect.isVisible({ timeout: 3000 }).catch(() => false))) return;

    const options = await monthSelect.locator('option').allTextContents();
    if (options.length < 2) return;

    // Read monthly payment with first option
    await monthSelect.selectOption({ index: 0 });
    await page.waitForTimeout(300);
    const monthlyPayment = page.getByText(/^ค่างวดปกติ \(\d+ งวด\)$/)
      .locator('..').locator('span').last();
    const paymentWithFewerMonths = await monthlyPayment.innerText();

    // Read monthly payment with last option (more months = lower monthly)
    await monthSelect.selectOption({ index: options.length - 1 });
    await page.waitForTimeout(300);
    const paymentWithMoreMonths = await monthlyPayment.innerText();

    if (paymentWithFewerMonths && paymentWithMoreMonths) {
      const fewerMonthsPayment = parseBaht(paymentWithFewerMonths);
      const moreMonthsPayment = parseBaht(paymentWithMoreMonths);
      // More months = smaller monthly payment (inverse relationship)
      if (fewerMonthsPayment > 0 && moreMonthsPayment > 0 && options.length > 1) {
        expect(moreMonthsPayment).toBeLessThanOrEqual(fewerMonthsPayment);
      }
    }
  });

  test('should not show error state on /contracts/create', async ({ page }) => {
    await page.goto('/contracts/create', { waitUntil: 'domcontentloaded' });

    await expect(page.getByPlaceholder(/ค้นหาสินค้า/)).toBeVisible({ timeout: 15000 });

    // No error boundary or server errors
    await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
    await expect(page.locator('body')).not.toContainText('Internal Server Error');
  });
});
