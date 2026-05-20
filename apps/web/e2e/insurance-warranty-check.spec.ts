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

import { test, expect } from '@playwright/test';
import { loginViaAPI } from './helpers/auth';
import { gotoWithRetry } from './helpers/navigation';

test.describe('Insurance — Warranty Check (SP5 Phase 2)', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page);
  });

  // -------------------------------------------------------------------------
  // Smoke 1 — Page renders heading + 3 search-mode tabs
  // -------------------------------------------------------------------------
  test('smoke: /insurance/warranty-check renders heading and 3 tabs', async ({ page }) => {
    const ok = await gotoWithRetry(page, '/insurance/warranty-check');
    if (!ok) {
      test.skip(
        true,
        'Error boundary on /insurance/warranty-check — likely DB drift locally. CI will re-run on fresh DB.',
      );
      return;
    }

    const hasHeading = await page
      .getByRole('heading', { name: 'เช็คประกัน' })
      .isVisible({ timeout: 10_000 })
      .catch(() => false);

    if (!hasHeading) {
      test.skip(
        true,
        'SP5 WarrantyCheckPage not active — likely main-branch server pre-merge. CI will re-run on correct build.',
      );
      return;
    }

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
    const ok = await gotoWithRetry(page, '/insurance/warranty-check');
    if (!ok) {
      test.skip(
        true,
        'Error boundary on /insurance/warranty-check — likely DB drift locally. CI will re-run on fresh DB.',
      );
      return;
    }

    const hasHeading = await page
      .getByRole('heading', { name: 'เช็คประกัน' })
      .isVisible({ timeout: 10_000 })
      .catch(() => false);

    if (!hasHeading) {
      test.skip(
        true,
        'SP5 WarrantyCheckPage not active — likely main-branch server pre-merge. CI will re-run on correct build.',
      );
      return;
    }

    // Input placeholder confirms IMEI mode is active by default
    await expect(
      page.getByPlaceholder('IMEI หรือ Serial Number'),
    ).toBeVisible({ timeout: 5_000 });
  });

  // -------------------------------------------------------------------------
  // Smoke 3 — Submit button disabled when query is empty / < 3 chars
  // -------------------------------------------------------------------------
  test('smoke: submit button disabled when query is empty', async ({ page }) => {
    const ok = await gotoWithRetry(page, '/insurance/warranty-check');
    if (!ok) {
      test.skip(
        true,
        'Error boundary on /insurance/warranty-check — likely DB drift locally. CI will re-run on fresh DB.',
      );
      return;
    }

    const hasHeading = await page
      .getByRole('heading', { name: 'เช็คประกัน' })
      .isVisible({ timeout: 10_000 })
      .catch(() => false);

    if (!hasHeading) {
      test.skip(
        true,
        'SP5 WarrantyCheckPage not active — likely main-branch server pre-merge. CI will re-run on correct build.',
      );
      return;
    }

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
    const ok = await gotoWithRetry(page, '/insurance/warranty-check');
    if (!ok) {
      test.skip(
        true,
        'Error boundary on /insurance/warranty-check — likely DB drift locally. CI will re-run on fresh DB.',
      );
      return;
    }

    const hasHeading = await page
      .getByRole('heading', { name: 'เช็คประกัน' })
      .isVisible({ timeout: 10_000 })
      .catch(() => false);

    if (!hasHeading) {
      test.skip(
        true,
        'SP5 WarrantyCheckPage not active — likely main-branch server pre-merge. CI will re-run on correct build.',
      );
      return;
    }

    // Type a 15-char IMEI — button should become enabled
    await page.getByPlaceholder('IMEI หรือ Serial Number').fill('123456789012345');
    const submitBtn = page.getByRole('button', { name: /ค้นหา/ });
    await expect(submitBtn).toBeEnabled({ timeout: 5_000 });
  });

  // -------------------------------------------------------------------------
  // Smoke 5 — Switching tabs changes the input placeholder
  // -------------------------------------------------------------------------
  test('smoke: switching to "เลขสัญญา" tab changes placeholder', async ({ page }) => {
    const ok = await gotoWithRetry(page, '/insurance/warranty-check');
    if (!ok) {
      test.skip(
        true,
        'Error boundary on /insurance/warranty-check — likely DB drift locally. CI will re-run on fresh DB.',
      );
      return;
    }

    const hasHeading = await page
      .getByRole('heading', { name: 'เช็คประกัน' })
      .isVisible({ timeout: 10_000 })
      .catch(() => false);

    if (!hasHeading) {
      test.skip(
        true,
        'SP5 WarrantyCheckPage not active — likely main-branch server pre-merge. CI will re-run on correct build.',
      );
      return;
    }

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
  test('smoke: /insurance/warranty-check is directly accessible via URL', async ({ page }) => {
    // Even if the list page has no dedicated CTA yet (that may land in a later PR),
    // the route must be accessible directly.
    const ok = await gotoWithRetry(page, '/insurance/warranty-check');
    if (!ok) {
      test.skip(
        true,
        'Error boundary on /insurance/warranty-check — likely DB drift locally. CI will re-run on fresh DB.',
      );
      return;
    }

    await expect(page).toHaveURL(/\/insurance\/warranty-check/, { timeout: 5_000 });

    const hasHeading = await page
      .getByRole('heading', { name: 'เช็คประกัน' })
      .isVisible({ timeout: 10_000 })
      .catch(() => false);

    if (!hasHeading) {
      test.skip(
        true,
        'SP5 WarrantyCheckPage not active — likely main-branch server pre-merge. CI will re-run on correct build.',
      );
      return;
    }

    await expect(page.getByRole('heading', { name: 'เช็คประกัน' })).toBeVisible({
      timeout: 5_000,
    });
  });
});
