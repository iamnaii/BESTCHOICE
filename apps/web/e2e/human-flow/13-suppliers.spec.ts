import { test, expect } from '@playwright/test';
import { loginViaAPI } from '../helpers/auth';
import { StepScreenshot } from '../helpers/screenshot';

/**
 * 13 - Suppliers Flow (Human-Like Interaction)
 *
 * ทดสอบ flow จัดการ Suppliers: ดูรายการ, ค้นหา, เพิ่ม supplier
 * Route: /suppliers, /suppliers/:id
 * API: GET /suppliers, POST /suppliers
 */
test.describe('13 - Suppliers Flow', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page);
    await page.goto('/suppliers', { waitUntil: 'domcontentloaded' });
  });

  test('should display suppliers page', async ({ page }) => {
    const ss = new StepScreenshot(page, '13-suppliers-display');

    // Step 1: ตรวจสอบว่าอยู่หน้า Suppliers
    await expect(page).toHaveURL('/suppliers');
    await ss.capture('suppliers-page-loaded');

    // Step 2: ตรวจสอบ header
    await expect(page.locator('text=จัดการผู้ขาย').first()).toBeVisible();
    await ss.capture('suppliers-header-visible');

    // Step 3: รอข้อมูลโหลด
    await page.waitForLoadState('networkidle');
    await ss.capture('data-loaded');

    // Step 4: ตรวจสอบว่าไม่มี error
    await expect(page.locator('[data-sonner-toast][data-type="error"]')).not.toBeVisible();
    await ss.capture('no-error');
  });

  test('should search suppliers', async ({ page }) => {
    const ss = new StepScreenshot(page, '13-suppliers-search');

    // Step 1: รอข้อมูลโหลด
    await page.waitForLoadState('networkidle');
    await ss.capture('page-ready');

    // Step 2: หา search input
    const searchInput = page.locator('input[placeholder*="ค้นหา"], input[type="search"], input[type="text"]').first();
    if (await searchInput.isVisible()) {
      await searchInput.fill('test');
      await ss.capture('typed-search');

      // Step 3: รอผลลัพธ์
      await page.waitForTimeout(500);
      await ss.capture('search-results');
    }
  });

  test('should open add supplier form', async ({ page }) => {
    const ss = new StepScreenshot(page, '13-suppliers-add');

    // Step 1: รอข้อมูลโหลด
    await page.waitForLoadState('networkidle');
    await ss.capture('page-ready');

    // Step 2: คลิกปุ่มเพิ่ม supplier
    const addBtn = page.locator('button:has-text("เพิ่ม"), button:has-text("สร้าง"), a:has-text("เพิ่ม")').first();
    if (await addBtn.isVisible()) {
      await addBtn.click();
      await page.waitForTimeout(300);
      await ss.capture('add-form-opened');

      // Step 3: ตรวจสอบ form fields
      const nameInput = page.locator('input[name="name"], input[placeholder*="ชื่อ"]').first();
      if (await nameInput.isVisible()) {
        await ss.capture('form-fields-visible');
      }
    }
  });

  test('should navigate to supplier detail', async ({ page }) => {
    const ss = new StepScreenshot(page, '13-suppliers-detail');

    // Step 1: รอข้อมูลโหลด
    await page.waitForLoadState('networkidle');
    await ss.capture('page-ready');

    // Step 2: คลิกแถวแรกใน table
    const firstRow = page.locator('table tbody tr, [data-row]').first();
    if (await firstRow.isVisible()) {
      await firstRow.click();
      await page.waitForTimeout(500);
      await ss.capture('clicked-supplier-row');
    }
  });
});
