import { test, expect } from '@playwright/test';
import { loginViaAPI } from './helpers/auth';

test.describe('Product Create Page', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page);
  });

  test('should display product creation form', async ({ page }) => {
    await page.goto('/products/create', { waitUntil: 'domcontentloaded' });

    await expect(page.getByText('เพิ่มสินค้าใหม่').first()).toBeVisible({ timeout: 15000 });

    // Form sections should be visible
    await expect(page.getByText('ข้อมูลสินค้า').first()).toBeVisible({ timeout: 5000 });
  });

  test('should display product type selection', async ({ page }) => {
    await page.goto('/products/create', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('เพิ่มสินค้าใหม่').first()).toBeVisible({ timeout: 15000 });

    // Type selection
    await expect(page.getByText('ประเภท').first()).toBeVisible({ timeout: 5000 });
  });

  test('should display brand and model fields', async ({ page }) => {
    await page.goto('/products/create', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('เพิ่มสินค้าใหม่').first()).toBeVisible({ timeout: 15000 });

    await expect(page.getByText('ยี่ห้อ').first()).toBeVisible({ timeout: 5000 });
  });

  test('should display save button', async ({ page }) => {
    await page.goto('/products/create', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('เพิ่มสินค้าใหม่').first()).toBeVisible({ timeout: 15000 });

    await expect(page.getByText('บันทึกสินค้า').first()).toBeVisible({ timeout: 5000 });
  });
});

test.describe('Sticker Print Page', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page);
  });

  test('should display sticker print page', async ({ page }) => {
    await page.goto('/stickers', { waitUntil: 'domcontentloaded' });

    await expect(
      page.getByText('พิมพ์สติกเกอร์').or(page.getByText('สติกเกอร์')).first(),
    ).toBeVisible({ timeout: 15000 });

    await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
  });
});
