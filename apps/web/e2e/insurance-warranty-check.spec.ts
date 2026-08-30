/**
 * Insurance — Warranty Check page (smoke tests, SP5 Phase 2)
 *
 * Covers /insurance/warranty-check: heading, 3 search-mode tabs, default mode,
 * submit button disabled state, and enabled state after typing.
 * Also covers navigating from /insurance list page to warranty-check.
 *
 * Smoke-only: does NOT submit a search or assert result cards — that requires
 * seeded product/contract data.
 *
 * WarrantyCheckPage default mode = 'imei' (see WarrantyCheckPage.tsx:33).
 * Submit button is disabled when query.length < 3 (see line 107).
 */

import { test, expect, type Page } from '@playwright/test';
import { loginViaAPI } from './helpers/auth';
import { gotoWithRetry } from './helpers/navigation';

test.describe('Insurance — Warranty Check (SP5 Phase 2)', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page);
  });

  /**
   * หน้าเช็คประกันถูกยุบเป็น "แท็บ" ใน /insurance แล้ว (path เดิม redirect ให้)
   * หัวข้อของหน้าจึงเป็น "รับซ่อม/รับประกัน" ส่วน "เช็คประกัน" กลายเป็น role=tab
   * — เดิมเทสชุดนี้ guard ด้วย heading ชื่อ 'เช็คประกัน' ซึ่งหลังย้ายจะกลายเป็น
   * test.skip เงียบ ๆ ทั้ง 5 เคส (เลิกปกป้องฟีเจอร์โดยไม่มีใครรู้) จึงเปลี่ยนมารอ
   * แท็บที่ถูกเลือกแทน
   */
  async function gotoWarrantyTab(page: Page): Promise<void> {
    await gotoWithRetry(page, '/insurance?tab=warranty');
    await expect(page.getByRole('tab', { name: 'เช็คประกัน' })).toHaveAttribute(
      'data-state',
      'active',
      { timeout: 10_000 },
    );
  }


  // -------------------------------------------------------------------------
  // Smoke 1 — Page renders heading + 3 search-mode tabs
  // -------------------------------------------------------------------------
  test('smoke: แท็บเช็คประกันแสดงโหมดค้นหาครบ 3 แบบ', async ({ page }) => {
    await gotoWarrantyTab(page);

    // All 3 search mode tabs visible
    await expect(page.getByRole('button', { name: 'ลูกค้า' })).toBeVisible({ timeout: 5_000 });
    await expect(page.getByRole('button', { name: 'IMEI/Serial' })).toBeVisible({
      timeout: 5_000,
    });
    await expect(page.getByRole('button', { name: 'เลขสัญญา' })).toBeVisible({ timeout: 5_000 });
  });

  // -------------------------------------------------------------------------
  // Smoke 2 — Default tab is IMEI/Serial (implementation default)
  // -------------------------------------------------------------------------
  test('smoke: default search mode is IMEI/Serial', async ({ page }) => {
    await gotoWarrantyTab(page);

    // Input placeholder confirms IMEI mode is active by default
    await expect(
      page.getByPlaceholder('IMEI หรือ Serial Number'),
    ).toBeVisible({ timeout: 5_000 });
  });

  // -------------------------------------------------------------------------
  // Smoke 3 — Submit button disabled when query is empty / < 3 chars
  // -------------------------------------------------------------------------
  test('smoke: submit button disabled when query is empty', async ({ page }) => {
    await gotoWarrantyTab(page);

    // Submit button should be disabled when query is empty
    const submitBtn = page.getByRole('button', { name: /ค้นหา/ });
    await expect(submitBtn).toBeDisabled({ timeout: 5_000 });

    // Type 2 chars (below the >=3 threshold) — still disabled
    await page.getByPlaceholder('IMEI หรือ Serial Number').fill('12');
    await expect(submitBtn).toBeDisabled({ timeout: 5_000 });
  });

  // -------------------------------------------------------------------------
  // Smoke 4 — Submit button enabled after typing >= 3 chars
  // -------------------------------------------------------------------------
  test('smoke: submit button enabled after typing a query (>=3 chars)', async ({ page }) => {
    await gotoWarrantyTab(page);

    // Type a 15-char IMEI — button should become enabled
    await page.getByPlaceholder('IMEI หรือ Serial Number').fill('123456789012345');
    const submitBtn = page.getByRole('button', { name: /ค้นหา/ });
    await expect(submitBtn).toBeEnabled({ timeout: 5_000 });
  });

  // -------------------------------------------------------------------------
  // Smoke 5 — Switching tabs changes the input placeholder
  // -------------------------------------------------------------------------
  test('smoke: switching to "เลขสัญญา" tab changes placeholder', async ({ page }) => {
    await gotoWarrantyTab(page);

    // Switch to contract mode
    await page.getByRole('button', { name: 'เลขสัญญา' }).click();
    await expect(
      page.getByPlaceholder('เลขที่สัญญา เช่น CN-2026-0001'),
    ).toBeVisible({ timeout: 5_000 });
  });

  // -------------------------------------------------------------------------
  // Smoke 6 — /insurance list page: navigate to /insurance/warranty-check
  //           (CTA presence depends on InsurancePage implementation)
  // -------------------------------------------------------------------------
  test('smoke: path เดิม /insurance/warranty-check redirect เข้าแท็บ (ลิงก์เก่าไม่ตาย)', async ({ page }) => {
    await gotoWithRetry(page, '/insurance/warranty-check');
    await expect(page).toHaveURL(/\/insurance\?tab=warranty/, { timeout: 10_000 });
    await expect(page.getByRole('tab', { name: 'เช็คประกัน' })).toHaveAttribute(
      'data-state',
      'active',
      { timeout: 10_000 },
    );
  });
});
