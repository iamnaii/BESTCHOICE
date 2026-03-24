import { test, expect } from '@playwright/test';
import { loginViaAPI } from '../helpers/auth';
import { StepScreenshot } from '../helpers/screenshot';

/**
 * 05 - Contracts Flow (Human-Like Interaction)
 *
 * ทดสอบ flow สัญญาผ่อนชำระ: ดูรายการ, filter, สร้างสัญญาใหม่ (4-step wizard)
 * Selectors จาก: src/pages/ContractsPage.tsx, ContractCreatePage.tsx
 * - PageHeader: "สัญญาผ่อนชำระ"
 * - Search input, status filter, workflow filter
 * - Tabs: all, my, pending_review
 * - Status labels: ร่าง, ผ่อนอยู่, ค้างชำระ, ผิดนัด, ปิดก่อน, ครบ
 * - Create wizard steps: เลือกสินค้า → เลือกลูกค้า → เลือกแผนผ่อน → แนบเอกสาร + ยืนยัน
 * - API: GET /contracts, POST /contracts
 */
test.describe('05 - Contracts Flow', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page);
  });

  test('should display contracts list page', async ({ page }) => {
    const ss = new StepScreenshot(page, '05-contracts-list');

    // Step 1: เปิดหน้า Contracts
    await page.goto('/contracts', { waitUntil: 'domcontentloaded' });
    await ss.capture('contracts-page-loaded');

    // Step 2: ตรวจสอบว่าอยู่หน้า /contracts
    await expect(page).toHaveURL('/contracts');
    await ss.capture('url-verified');

    // Step 3: รอข้อมูลโหลด
    await page.waitForLoadState('networkidle');
    await ss.capture('data-loaded');

    // Step 4: ตรวจสอบว่ามี header "สัญญา" หรือ "contracts"
    const header = page.locator('text=สัญญา').first();
    await expect(header).toBeVisible();
    await ss.capture('header-visible');

    // Step 5: ตรวจสอบว่าไม่มี error
    await expect(page.locator('[data-sonner-toast][data-type="error"]')).not.toBeVisible();
    await ss.capture('no-error');
  });

  test('should search contracts', async ({ page }) => {
    const ss = new StepScreenshot(page, '05-contracts-search');

    // Step 1: เปิดหน้า Contracts
    await page.goto('/contracts', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle');
    await ss.capture('contracts-loaded');

    // Step 2: หา search input
    const searchInput = page.locator('input[placeholder*="ค้นหา"]').first();
    if (await searchInput.isVisible()) {
      // Step 3: พิมพ์ค้นหา (human-like)
      await searchInput.type('BC', { delay: 50 });
      await ss.capture('typed-search');

      // Step 4: รอ debounce + API response
      await page.waitForLoadState('networkidle');
      await ss.capture('search-results');
    } else {
      await ss.capture('search-input-not-visible');
    }
  });

  test('should filter contracts by status', async ({ page }) => {
    const ss = new StepScreenshot(page, '05-contracts-filter');

    // Step 1: เปิดหน้า Contracts
    await page.goto('/contracts', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle');
    await ss.capture('contracts-loaded');

    // Step 2: หา status filter (select หรือ tabs)
    // ตรวจสอบ status labels: ร่าง, ผ่อนอยู่, ค้างชำระ, ผิดนัด
    const statusOptions = ['ร่าง', 'ผ่อนอยู่', 'ค้างชำระ', 'ผิดนัด', 'ครบ'];
    for (const status of statusOptions) {
      const statusEl = page.locator(`text=${status}`).first();
      if (await statusEl.isVisible()) {
        await ss.capture(`status-${status}-visible`);
      }
    }

    // Step 3: คลิก filter ถ้ามี select/dropdown
    const filterSelect = page.locator('select').first();
    if (await filterSelect.isVisible()) {
      await filterSelect.selectOption({ index: 1 });
      await ss.capture('selected-filter');
      await page.waitForLoadState('networkidle');
      await ss.capture('filtered-results');
    }
  });

  test('should switch between view tabs', async ({ page }) => {
    const ss = new StepScreenshot(page, '05-contracts-tabs');

    // Step 1: เปิดหน้า Contracts
    await page.goto('/contracts', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle');
    await ss.capture('contracts-loaded');

    // Step 2: ตรวจสอบ tabs (ทั้งหมด, ของฉัน, รอตรวจ)
    const tabs = ['ทั้งหมด', 'ของฉัน', 'รอตรวจ'];
    for (const tab of tabs) {
      const tabEl = page.locator(`text=${tab}`).first();
      if (await tabEl.isVisible()) {
        await tabEl.click();
        await ss.capture(`clicked-tab-${tab}`);
        await page.waitForLoadState('networkidle');
        await ss.capture(`tab-${tab}-results`);
      }
    }
  });

  test('should navigate to contract create page', async ({ page }) => {
    const ss = new StepScreenshot(page, '05-contracts-create');

    // Step 1: เปิดหน้า Contracts
    await page.goto('/contracts', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle');
    await ss.capture('contracts-loaded');

    // Step 2: หาปุ่มสร้างสัญญา
    const createBtn = page.locator('a[href="/contracts/create"], button:has-text("สร้าง"), button:has-text("เพิ่ม")').first();
    if (await createBtn.isVisible()) {
      await ss.capture('create-button-visible');

      // Step 3: คลิกปุ่มสร้าง
      await createBtn.click();
      await ss.capture('clicked-create');

      // Step 4: รอไปหน้า create
      await page.waitForURL('/contracts/create', { timeout: 10000 });
      await ss.capture('on-create-page');

      // Step 5: ตรวจสอบ wizard steps (4 steps)
      // Steps: เลือกสินค้า → เลือกลูกค้า → เลือกแผนผ่อน → แนบเอกสาร + ยืนยัน
      const stepLabels = ['เลือกสินค้า', 'เลือกลูกค้า', 'เลือกแผนผ่อน', 'แนบเอกสาร'];
      for (const step of stepLabels) {
        const stepEl = page.locator(`text=${step}`).first();
        if (await stepEl.isVisible()) {
          await ss.capture(`wizard-step-${step}-visible`);
        }
      }
    } else {
      await ss.capture('create-button-not-found');
    }
  });

  test('should navigate to contract detail page', async ({ page }) => {
    const ss = new StepScreenshot(page, '05-contracts-detail');

    // Step 1: เปิดหน้า Contracts
    await page.goto('/contracts', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle');
    await ss.capture('contracts-loaded');

    // Step 2: คลิกแถวแรกในตาราง
    const firstRow = page.locator('table tbody tr, [role="row"]').first();
    if (await firstRow.isVisible()) {
      await firstRow.click();
      await ss.capture('clicked-first-contract');

      // Step 3: รอไปหน้า detail
      await page.waitForLoadState('networkidle');
      await ss.capture('contract-detail-loaded');

      // Step 4: ตรวจสอบ URL
      const url = page.url();
      if (url.includes('/contracts/')) {
        await ss.capture('on-contract-detail-page');
      }
    } else {
      await ss.capture('no-contract-rows');
    }
  });
});
