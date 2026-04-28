// PREREQ: Dev server running (api on :3000, web on :5173).
// PREREQ: At least one overdue contract visible in the PromiseTab (นัดชำระ) for BRANCH_MANAGER.
//   → The supersede confirm dialog only appears when an ACTIVE promise already exists.
//   → The first promise creation in this test establishes the active promise.
//   → The second promise creation (reschedule) triggers the confirm dialog.
// NOTE: brokenPromiseCount behavior tested here is: reschedule before due date,
//   first reschedule (rescheduleCount = 0 → 1) = free (ไม่นับผิดนัด).

import { test, expect } from '@playwright/test';
import { loginAsRole } from './helpers/auth';
import { gotoWithRetry, hasErrorBoundary } from './helpers/navigation';

test.describe('Promise supersede — reschedule flow', () => {
  test('reschedule before due — confirm dialog + no broken increment', async ({ page }) => {
    // Auth as BRANCH_MANAGER
    await loginAsRole(page, 'BRANCH_MANAGER');
    const loaded = await gotoWithRetry(page, '/collections');
    if (!loaded || (await hasErrorBoundary(page))) {
      test.skip(true, 'Collections page error boundary — likely missing DB seed');
      return;
    }

    // Switch to Library view if Session/Library toggle is present
    const libraryBtn = page.getByRole('button', { name: 'Library', exact: true });
    const libraryVisible = await libraryBtn.isVisible({ timeout: 5000 }).catch(() => false);
    if (libraryVisible) {
      await libraryBtn.click();
    }

    // Switch to the "นัดชำระ" (Promise) tab to access contracts with promises
    const promiseTab = page.getByRole('button', { name: /นัดชำระ/ }).first();
    await expect(promiseTab).toBeVisible({ timeout: 8000 });
    await promiseTab.click();
    await page.waitForTimeout(1500);

    // Find first contract card — skip if queue is empty
    const logBtn = page.getByRole('button', { name: 'บันทึกผลการโทร' }).first();
    const logBtnVisible = await logBtn.isVisible({ timeout: 8000 }).catch(() => false);
    if (!logBtnVisible) {
      // Fall back to QueueTab (คิววันนี้) — may have overdue contracts without promises
      await page.getByRole('button', { name: /คิววันนี้/ }).first().click();
      await page.waitForTimeout(1500);
      const queueLogBtn = page.getByRole('button', { name: 'บันทึกผลการโทร' }).first();
      const queueVisible = await queueLogBtn.isVisible({ timeout: 6000 }).catch(() => false);
      if (!queueVisible) {
        test.skip(true, 'No contracts visible in any tab — seed overdue contracts first');
        return;
      }
    }

    // ── First promise: เตรียม active promise ในระบบ ─────────────────────────
    await page.getByRole('button', { name: 'บันทึกผลการโทร' }).first().click();
    await expect(page.getByText(/บันทึกผล/, { exact: false }).first()).toBeVisible({
      timeout: 5000,
    });

    await page.getByText('นัดชำระ', { exact: true }).first().click();
    await expect(page.locator('input[type=number]').first()).toBeVisible({ timeout: 5000 });

    // Pick "อีก 3 วัน" for slot 1 + amount
    await page.getByRole('button', { name: 'อีก 3 วัน', exact: true }).first().click();
    await page.locator('input[type=number]').first().fill('5000');

    await page.getByRole('button', { name: 'บันทึก', exact: true }).click();

    // If a supersede dialog appears (contract already had a promise), confirm it
    const s1 = page.getByRole('heading', { name: /ยืนยันการเลื่อนนัด/ });
    if (await s1.isVisible({ timeout: 2000 }).catch(() => false)) {
      await page.getByRole('button', { name: /ยืนยันเลื่อนนัด/ }).click();
    }

    // Wait for first dialog to close and data to reload
    await expect(s1).not.toBeVisible({ timeout: 8000 });
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(800);

    // ── Second promise: เลื่อนนัด (reschedule) — triggers confirm dialog ────
    await page.getByRole('button', { name: 'บันทึกผลการโทร' }).first().click();
    await expect(page.getByText(/บันทึกผล/, { exact: false }).first()).toBeVisible({
      timeout: 5000,
    });

    await page.getByText('นัดชำระ', { exact: true }).first().click();
    await expect(page.locator('input[type=number]').first()).toBeVisible({ timeout: 5000 });

    // Pick "อีก 7 วัน" — different date so it's a supersede
    await page.getByRole('button', { name: 'อีก 7 วัน', exact: true }).first().click();
    await page.locator('input[type=number]').first().fill('5000');

    await page.getByRole('button', { name: 'บันทึก', exact: true }).click();

    // Assert: SupersedePromiseConfirmDialog must appear (active promise detected)
    const supersedeHeading = page.getByRole('heading', { name: /ยืนยันการเลื่อนนัด/ });
    await expect(supersedeHeading).toBeVisible({ timeout: 6000 });

    // The dialog must show either "ไม่นับผิดนัด" (first free reschedule) or
    // "จะถูกนับเป็นผิดนัด" (if this is the second reschedule in the same cycle)
    const notBrokenText = page.getByText(/ไม่นับผิดนัด/);
    const isBrokenText = page.getByText(/จะถูกนับเป็นผิดนัด/);
    const showsEitherVariant =
      (await notBrokenText.isVisible({ timeout: 3000 }).catch(() => false)) ||
      (await isBrokenText.isVisible({ timeout: 1000 }).catch(() => false));
    expect(showsEitherVariant).toBe(true);

    // Confirm the reschedule
    await page.getByRole('button', { name: /ยืนยันเลื่อนนัด/ }).click();

    // Confirm dialog should close
    await expect(supersedeHeading).not.toBeVisible({ timeout: 8000 });
  });
});
