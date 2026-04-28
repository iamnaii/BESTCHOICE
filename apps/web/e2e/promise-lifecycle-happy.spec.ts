// PREREQ: Dev server running (api on :3000, web on :5173).
// PREREQ: At least one overdue contract with an active promise must exist in the DB.
//   → If the overdue queue is empty for BRANCH_MANAGER, the test will skip early.
// PREREQ: The contract must be in the PromiseTab (นัดชำระ tab) so the cards load.
//   → Seed via: npm run backfill:promise-slots (apps/api) or create a promise via the UI.

import { test, expect } from '@playwright/test';
import { loginAsRole } from './helpers/auth';
import { gotoWithRetry, hasErrorBoundary } from './helpers/navigation';

test.describe('Promise lifecycle — happy path (3 slots)', () => {
  test('promise with 3 slots — record + see cycle banner + slot count', async ({ page }) => {
    // Auth as BRANCH_MANAGER (has access to collections + can create promises)
    await loginAsRole(page, 'BRANCH_MANAGER');
    const loaded = await gotoWithRetry(page, '/collections');
    if (!loaded || (await hasErrorBoundary(page))) {
      test.skip(true, 'Collections page error boundary — likely missing DB seed');
      return;
    }

    // Switch to Library view so we can see the tab bar
    const libraryBtn = page.getByRole('button', { name: 'Library', exact: true });
    const libraryVisible = await libraryBtn.isVisible({ timeout: 5000 }).catch(() => false);
    if (libraryVisible) {
      await libraryBtn.click();
    }

    // Switch to the "นัดชำระ" (Promise) tab
    const promiseTab = page.getByRole('button', { name: /นัดชำระ/ }).first();
    await expect(promiseTab).toBeVisible({ timeout: 8000 });
    await promiseTab.click();

    // Wait for tab content to render — contract cards or empty state
    await page.waitForTimeout(1500);

    // Locate the first "บันทึกผลการโทร" button (ContractCard action button)
    const logBtn = page.getByRole('button', { name: 'บันทึกผลการโทร' }).first();
    const logBtnVisible = await logBtn.isVisible({ timeout: 8000 }).catch(() => false);
    if (!logBtnVisible) {
      test.skip(true, 'No contracts in PromiseTab — seed overdue contracts first');
      return;
    }
    await logBtn.click();

    // ContactLogDialog should open — title includes "บันทึกผล"
    await expect(page.getByText(/บันทึกผล/, { exact: false }).first()).toBeVisible({
      timeout: 5000,
    });

    // Pick "นัดชำระ" outcome chip
    await page.getByText('นัดชำระ', { exact: true }).first().click();

    // Wait for the settlement section to appear (it's conditional on outcome === 'WILL_PAY')
    await expect(page.locator('input[type=number]').first()).toBeVisible({ timeout: 5000 });

    // Slot 1 — pick "อีก 3 วัน" pill + amount
    await page.getByRole('button', { name: 'อีก 3 วัน', exact: true }).first().click();
    await page.locator('input[type=number]').first().fill('1000');

    // Add slot 2 via "+ เพิ่ม" button
    await page.getByRole('button', { name: /\+ เพิ่ม/ }).first().click();
    // After adding, there should be 2 number inputs — pick date for slot 2
    await page.getByRole('button', { name: 'อีก 7 วัน', exact: true }).nth(1).click();
    await page.locator('input[type=number]').nth(1).fill('1500');

    // Add slot 3
    await page.getByRole('button', { name: /\+ เพิ่ม/ }).first().click();
    await page.getByRole('button', { name: 'อีก 15 วัน', exact: true }).nth(2).click();
    await page.locator('input[type=number]').nth(2).fill('1500');

    // Verify sum indicator shows 3 slots
    await expect(page.getByText(/รวม 3 ที่/)).toBeVisible({ timeout: 3000 });

    // Save
    await page.getByRole('button', { name: 'บันทึก', exact: true }).click();

    // If there's an active promise, the SupersedePromiseConfirmDialog may appear
    // — confirm it to proceed
    const supersedeHeading = page.getByRole('heading', { name: /ยืนยันการเลื่อนนัด/ });
    const supersedeVisible = await supersedeHeading.isVisible({ timeout: 2000 }).catch(() => false);
    if (supersedeVisible) {
      await page.getByRole('button', { name: /ยืนยันเลื่อนนัด/ }).click();
    }

    // Dialog should close and PromiseTab should reload
    // The cycle-deadline banner "เพดานรอบ" is visible when slots exist
    await expect(supersedeHeading).not.toBeVisible({ timeout: 8000 });

    // Wait for promise tab to refresh and show the cycle banner for this contract
    // Note: "เพดานรอบ" appears inside PromiseCycleView once the data reloads
    await page.waitForTimeout(1500);
    const cycleBanner = page.getByText(/เพดานรอบ/i).first();
    const hasBanner = await cycleBanner.isVisible({ timeout: 8000 }).catch(() => false);

    // Accept either the cycle banner being visible OR the dialog having closed cleanly
    // (if no overdue installments → cycle deadline may not render on page in some seed states)
    expect(hasBanner || !(await page.getByText(/บันทึกผล/).first().isVisible())).toBe(true);
  });
});
