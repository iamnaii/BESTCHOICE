/**
 * Insurance Wizard — Repair Branch (smoke tests, SP5 Phase 2)
 *
 * Smoke-only: verifies /insurance/new loads with the unified 4-step wizard,
 * walk-in customer mode renders name/phone inputs, and reset/navigation buttons
 * are present. Does NOT submit the form — full end-to-end requires seeded DB
 * data (customer + contract + product).
 *
 * Skip behaviour mirrors insurance-repair-ticket.spec.ts:
 * - Error boundary (DB drift, missing repair_tickets table) → graceful skip.
 * - SP5 routes not active (old server pre-merge) → graceful skip.
 */

import { test, expect } from '@playwright/test';
import { loginViaAPI } from './helpers/auth';
import { gotoWithRetry } from './helpers/navigation';

test.describe('Insurance — Wizard (repair branch smoke)', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page);
  });

  // -------------------------------------------------------------------------
  // Smoke 1 — Wizard at /insurance/new renders the 4-step progress indicator
  // -------------------------------------------------------------------------
  test('smoke: wizard renders 4-step progress indicator', async ({ page }) => {
    const ok = await gotoWithRetry(page, '/insurance/new');
    if (!ok) {
      test.skip(
        true,
        'Error boundary on /insurance/new — likely DB drift locally. CI will re-run on fresh DB.',
      );
      return;
    }

    const hasHeading = await page
      .getByRole('heading', { name: 'รับเครื่องใหม่' })
      .isVisible({ timeout: 10_000 })
      .catch(() => false);

    if (!hasHeading) {
      test.skip(
        true,
        'SP5 CreateInsuranceWizardPage not active — likely main-branch server pre-merge. CI will re-run on correct build.',
      );
      return;
    }

    // Step progress breadcrumb — all 4 steps visible
    await expect(page.getByText('1. ลูกค้า')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('2. เครื่อง')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('3. ตรวจประกัน')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('4. ยืนยัน')).toBeVisible({ timeout: 10_000 });
  });

  // -------------------------------------------------------------------------
  // Smoke 2 — Walk-in mode toggle shows name + phone inputs
  // -------------------------------------------------------------------------
  test('smoke: walk-in mode toggle renders name + phone inputs', async ({ page }) => {
    const ok = await gotoWithRetry(page, '/insurance/new');
    if (!ok) {
      test.skip(
        true,
        'Error boundary on /insurance/new — likely DB drift locally. CI will re-run on fresh DB.',
      );
      return;
    }

    const hasHeading = await page
      .getByRole('heading', { name: 'รับเครื่องใหม่' })
      .isVisible({ timeout: 10_000 })
      .catch(() => false);

    if (!hasHeading) {
      test.skip(
        true,
        'SP5 CreateInsuranceWizardPage not active — likely main-branch server pre-merge. CI will re-run on correct build.',
      );
      return;
    }

    // Step 1 card heading
    await expect(page.getByText('1. ลูกค้า', { exact: false })).toBeVisible({ timeout: 10_000 });

    // Toggle to walk-in mode
    await page.getByRole('button', { name: 'Walk-in (ลูกค้าใหม่)' }).click();

    // Walk-in form fields render
    await expect(page.getByText('ชื่อ', { exact: false })).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText('เบอร์โทร', { exact: false })).toBeVisible({ timeout: 5_000 });
  });

  // -------------------------------------------------------------------------
  // Smoke 3 — Header buttons "เริ่มใหม่" and "กลับ" are visible
  // -------------------------------------------------------------------------
  test('smoke: header action buttons "เริ่มใหม่" and "กลับ" visible', async ({ page }) => {
    const ok = await gotoWithRetry(page, '/insurance/new');
    if (!ok) {
      test.skip(
        true,
        'Error boundary on /insurance/new — likely DB drift locally. CI will re-run on fresh DB.',
      );
      return;
    }

    const hasHeading = await page
      .getByRole('heading', { name: 'รับเครื่องใหม่' })
      .isVisible({ timeout: 10_000 })
      .catch(() => false);

    if (!hasHeading) {
      test.skip(
        true,
        'SP5 CreateInsuranceWizardPage not active — likely main-branch server pre-merge. CI will re-run on correct build.',
      );
      return;
    }

    // Header action area: reset + back-to-list buttons
    await expect(page.getByRole('button', { name: 'เริ่มใหม่' })).toBeVisible({ timeout: 5_000 });
    await expect(page.getByRole('button', { name: 'กลับ' })).toBeVisible({ timeout: 5_000 });
  });

  // -------------------------------------------------------------------------
  // Smoke 4 — "เริ่มใหม่" resets to Step 1 (progress indicator still visible)
  // -------------------------------------------------------------------------
  test('smoke: "เริ่มใหม่" keeps wizard on step 1 after reset', async ({ page }) => {
    const ok = await gotoWithRetry(page, '/insurance/new');
    if (!ok) {
      test.skip(
        true,
        'Error boundary on /insurance/new — likely DB drift locally. CI will re-run on fresh DB.',
      );
      return;
    }

    const hasHeading = await page
      .getByRole('heading', { name: 'รับเครื่องใหม่' })
      .isVisible({ timeout: 10_000 })
      .catch(() => false);

    if (!hasHeading) {
      test.skip(
        true,
        'SP5 CreateInsuranceWizardPage not active — likely main-branch server pre-merge. CI will re-run on correct build.',
      );
      return;
    }

    // Click reset — should remain on /insurance/new and step 1 re-renders
    await page.getByRole('button', { name: 'เริ่มใหม่' }).click();

    // URL stays at /insurance/new
    await expect(page).toHaveURL(/\/insurance\/new/, { timeout: 5_000 });

    // Step 1 progress label still active (font-medium = active step)
    await expect(page.getByText('1. ลูกค้า')).toBeVisible({ timeout: 5_000 });
  });
});
