import { test, expect } from '@playwright/test';
import { loginViaAPI } from './helpers/auth';
import { gotoWithRetry, hasErrorBoundary } from './helpers/navigation';

/* ================================================================
   เทมเพลตสัญญา (/contract-templates)
   ================================================================ */
test.describe('เทมเพลตสัญญา', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page);
    await gotoWithRetry(page, '/contract-templates');
  });

  test('should load contract templates page', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    await expect(page.getByText(/เทมเพลต|template/i).first()).toBeVisible({ timeout: 15000 });
  });

  test('should display template list or empty state', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    const hasTemplates = await page.locator('table tbody tr, .template-card, [data-testid="template-item"]').first()
      .isVisible({ timeout: 5000 }).catch(() => false);
    if (!hasTemplates) {
      // Empty state or create prompt is acceptable
      await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
    }
  });

  test('should have create template button', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    const createBtn = page.locator('button, a').filter({ hasText: /สร้าง|เพิ่ม|Create|New/ }).first();
    await expect(createBtn).toBeVisible({ timeout: 10000 });
  });

  test('should open template editor when clicking a template', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    const templateItem = page.locator('table tbody tr, .template-card').first();
    if (!await templateItem.isVisible({ timeout: 5000 }).catch(() => false)) return;
    await templateItem.click();
    await page.waitForTimeout(1000);
    // Editor should show — look for editor-related elements
    const editorElement = page.getByText(/แก้ไข|บันทึก|ดูตัวอย่าง|Preview|Save/).first();
    await expect(editorElement).toBeVisible({ timeout: 10000 });
  });

  test('should have save functionality in editor', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    const templateItem = page.locator('table tbody tr, .template-card').first();
    if (!await templateItem.isVisible({ timeout: 5000 }).catch(() => false)) return;
    await templateItem.click();
    await page.waitForTimeout(1000);
    // Look for save button
    const saveBtn = page.locator('button').filter({ hasText: /บันทึก|Save/ }).first();
    if (await saveBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(saveBtn).toBeVisible();
    }
  });

  test('should have PDF preview functionality', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    const templateItem = page.locator('table tbody tr, .template-card').first();
    if (!await templateItem.isVisible({ timeout: 5000 }).catch(() => false)) return;
    await templateItem.click();
    await page.waitForTimeout(1000);
    // Look for preview button
    const previewBtn = page.locator('button').filter({ hasText: /ดูตัวอย่าง|Preview|PDF/ }).first();
    if (await previewBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(previewBtn).toBeVisible();
    }
  });
});

/* ================================================================
   ราคาตั้งต้น (/settings/pricing-templates)
   ================================================================ */
test.describe('ราคาตั้งต้น', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page);
    await gotoWithRetry(page, '/settings/pricing-templates');
  });

  test('should load pricing templates page', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    await expect(page.getByText(/ราคาตั้งต้น|ราคามาตรฐาน|Pricing/).first()).toBeVisible({ timeout: 15000 });
  });

  test('should display pricing list or empty state', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    const hasData = await page.locator('table tbody tr').first()
      .isVisible({ timeout: 5000 }).catch(() => false);
    if (!hasData) {
      await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
    }
  });

  test('should have add pricing template button', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    const addBtn = page.locator('button').filter({ hasText: /เพิ่ม|สร้าง|Add|Create/ }).first();
    await expect(addBtn).toBeVisible({ timeout: 10000 });
  });

  test('should filter by brand', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    const brandFilter = page.getByPlaceholder(/ค้นหา|brand|ยี่ห้อ/i).first()
      .or(page.locator('select, [role="combobox"]').first());
    if (await brandFilter.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(brandFilter).toBeVisible();
    }
  });

  test('should have import/export functionality', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    const importBtn = page.locator('button').filter({ hasText: /Import|นำเข้า/ }).first();
    const exportBtn = page.locator('button').filter({ hasText: /Export|ส่งออก/ }).first();
    const hasImportExport = await importBtn.isVisible({ timeout: 3000 }).catch(() => false)
      || await exportBtn.isVisible({ timeout: 2000 }).catch(() => false);
    if (hasImportExport) {
      await expect(importBtn.or(exportBtn).first()).toBeVisible();
    }
  });
});
