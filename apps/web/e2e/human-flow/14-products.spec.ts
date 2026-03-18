import { test, expect } from '@playwright/test';
import { loginViaAPI } from '../helpers/auth';
import { StepScreenshot } from '../helpers/screenshot';

/**
 * 14 - Products Flow (Human-Like Interaction)
 *
 * ทดสอบ flow จัดการ Products: ดูรายการ, ค้นหา, สร้างสินค้า
 * Route: /products, /products/create, /products/:id
 * API: GET /products, POST /products
 */
test.describe('14 - Products Flow', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page);
  });

  test('should display products page', async ({ page }) => {
    const ss = new StepScreenshot(page, '14-products-display');

    await page.goto('/products', { waitUntil: 'domcontentloaded' });
    // /products redirects to /stock?tab=list
    await expect(page).toHaveURL(/\/(products|stock)/);
    await ss.capture('products-page-loaded');

    // ตรวจสอบ header
    await expect(page.locator('text=สินค้า').first()).toBeVisible();
    await ss.capture('products-header-visible');

    await page.waitForLoadState('networkidle');
    await ss.capture('data-loaded');

    await expect(page.locator('[data-sonner-toast][data-type="error"]')).not.toBeVisible();
    await ss.capture('no-error');
  });

  test('should search products', async ({ page }) => {
    const ss = new StepScreenshot(page, '14-products-search');

    await page.goto('/products', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle');
    await ss.capture('page-ready');

    const searchInput = page.locator('input[placeholder*="ค้นหา"], input[type="search"], input[type="text"]').first();
    if (await searchInput.isVisible()) {
      await searchInput.fill('iPhone');
      await ss.capture('typed-search');
      await page.waitForTimeout(500);
      await ss.capture('search-results');
    }
  });

  test('should navigate to create product page', async ({ page }) => {
    const ss = new StepScreenshot(page, '14-products-create');

    await page.goto('/products/create', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/(products\/create|stock)/);
    await ss.capture('create-product-page-loaded');

    // ตรวจสอบ form fields
    const nameInput = page.locator('input[name="name"], input[placeholder*="ชื่อ"]').first();
    if (await nameInput.isVisible()) {
      await ss.capture('form-fields-visible');
    }

    await expect(page.locator('[data-sonner-toast][data-type="error"]')).not.toBeVisible();
    await ss.capture('no-error');
  });

  test('should navigate to product detail', async ({ page }) => {
    const ss = new StepScreenshot(page, '14-products-detail');

    await page.goto('/products', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle');
    await ss.capture('page-ready');

    const firstRow = page.locator('table tbody tr, [data-row]').first();
    if (await firstRow.isVisible()) {
      await firstRow.click();
      await page.waitForTimeout(500);
      await ss.capture('clicked-product');
    }
  });
});
