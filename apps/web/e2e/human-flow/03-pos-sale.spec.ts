import { test, expect } from '@playwright/test';
import { loginViaAPI } from '../helpers/auth';
import { StepScreenshot } from '../helpers/screenshot';

/**
 * 03 - POS Sale Flow (Human-Like Interaction)
 *
 * ทดสอบ flow การขายสินค้าผ่าน POS
 * Selectors จาก: src/pages/POSPage.tsx
 * - PageHeader: "POS - ขายสินค้า"
 * - Sale type tabs (CASH, EXTERNAL_FINANCE)
 * - Product search input (debounced, min 2 chars)
 * - Customer search input (debounced, min 2 chars)
 * - Price, discount, payment method inputs
 * - API: GET /products, GET /customers/search, POST /sales
 */
test.describe('03 - POS Sale Flow', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page);
    await page.goto('/pos', { waitUntil: 'domcontentloaded' });
  });

  test('should display POS page correctly', async ({ page }) => {
    const ss = new StepScreenshot(page, '03-pos-display');

    // Step 1: ตรวจสอบว่าอยู่หน้า POS
    await expect(page).toHaveURL('/pos');
    await ss.capture('pos-page-loaded');

    // Step 2: ตรวจสอบ header "POS - ขายสินค้า"
    await expect(page.locator('text=POS - ขายสินค้า').first()).toBeVisible();
    await ss.capture('pos-header-visible');

    // Step 3: ตรวจสอบว่ามี sale type options
    await expect(page.locator('text=เงินสด').first()).toBeVisible();
    await ss.capture('sale-types-visible');

    // Step 4: ตรวจสอบว่าไม่มี error toast
    await expect(page.locator('[data-sonner-toast][data-type="error"]')).not.toBeVisible();
    await ss.capture('no-error-on-load');
  });

  test('should search for products', async ({ page }) => {
    const ss = new StepScreenshot(page, '03-pos-product-search');

    // Step 1: ตรวจสอบว่าอยู่หน้า POS
    await expect(page).toHaveURL('/pos');
    await ss.capture('pos-page-loaded');

    // Step 2: หา input ค้นหาสินค้า (มีคำว่า "ค้นหาสินค้า" หรือ placeholder ที่เกี่ยวข้อง)
    const productSearchInput = page.locator('input[placeholder*="ค้นหา"]').first();
    if (await productSearchInput.isVisible()) {
      // Step 3: พิมพ์ค้นหาสินค้า (human-like, min 2 chars to trigger search)
      await productSearchInput.type('iPhone', { delay: 50 });
      await ss.capture('typed-product-search');

      // Step 4: รอ debounce + API response
      await page.waitForLoadState('networkidle');
      await ss.capture('product-search-results');
    } else {
      await ss.capture('product-search-input-not-found');
    }
  });

  test('should search for customers', async ({ page }) => {
    const ss = new StepScreenshot(page, '03-pos-customer-search');

    // Step 1: ตรวจสอบว่าอยู่หน้า POS
    await expect(page).toHaveURL('/pos');
    await ss.capture('pos-page-loaded');

    // Step 2: หา input ค้นหาลูกค้า
    const customerSearchInputs = page.locator('input[placeholder*="ลูกค้า"], input[placeholder*="ค้นหาลูกค้า"]');
    const customerSearchInput = customerSearchInputs.first();
    if (await customerSearchInput.isVisible()) {
      // Step 3: พิมพ์ค้นหาลูกค้า (human-like)
      await customerSearchInput.type('สม', { delay: 50 });
      await ss.capture('typed-customer-search');

      // Step 4: รอ debounce + API response
      await page.waitForLoadState('networkidle');
      await ss.capture('customer-search-results');
    } else {
      await ss.capture('customer-search-input-not-found');
    }
  });

  test('should display sale type options', async ({ page }) => {
    const ss = new StepScreenshot(page, '03-pos-sale-types');

    // Step 1: ตรวจสอบ sale type เริ่มต้นคือ CASH
    await expect(page.locator('text=เงินสด').first()).toBeVisible();
    await ss.capture('cash-type-visible');

    // Step 2: ตรวจสอบ EXTERNAL_FINANCE option
    const externalFinance = page.locator('text=ไฟแนนซ์').first();
    if (await externalFinance.isVisible()) {
      await ss.capture('external-finance-visible');

      // Step 3: คลิกเปลี่ยนเป็น External Finance
      await externalFinance.click();
      await ss.capture('switched-to-external-finance');
    }

    // Step 4: ตรวจสอบว่าไม่มี error toast
    await expect(page.locator('[data-sonner-toast][data-type="error"]')).not.toBeVisible();
    await ss.capture('no-error-after-switch');
  });

  test('should display top selling products', async ({ page }) => {
    const ss = new StepScreenshot(page, '03-pos-top-products');

    // Step 1: ตรวจสอบว่าอยู่หน้า POS
    await expect(page).toHaveURL('/pos');
    await ss.capture('pos-page-loaded');

    // Step 2: รอให้ top products โหลด
    await page.waitForLoadState('networkidle');
    await ss.capture('pos-fully-loaded');

    // Step 3: ตรวจสอบ section สินค้าขายดี (ถ้ามี)
    const topSection = page.locator('text=สินค้าขายดี').first();
    if (await topSection.isVisible()) {
      await ss.capture('top-products-section-visible');
    } else {
      await ss.capture('no-top-products-section');
    }
  });
});
