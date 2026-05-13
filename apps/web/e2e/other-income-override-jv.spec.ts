import { test, expect } from '@playwright/test';
import { loginAsAdmin } from './helpers/auth';

test.describe('Other Income — Override JV', () => {
  test.beforeEach(async ({ page }) => {
    // Login as admin (OWNER role) using established pattern
    await loginAsAdmin(page);
  });

  test('creates DRAFT, toggles override, edits JV, POSTs, sees ✏ marker', async ({ page }) => {
    // Step 1: navigate to create new Other Income
    await page.goto('/other-income/new');

    // Wait for page to load (basic wait for form existence)
    await page.waitForSelector('form', { timeout: 10000 });

    // Fill in basic form fields — adapt field names to actual UI
    // Assuming form has fields for: amount, accountCode, description, etc.
    await page.fill('input[name="amount"]', '1000');
    await page.fill('input[name="description"]', 'Test override flow');

    // Fill in the auto-generated JV lines (selectors may vary)
    // Expected: first line is debit 1000, second line is credit 1000
    const drInput = page.locator('input[name="autoLines.0.debit"]');
    if (await drInput.count() > 0) {
      await drInput.fill('1000');
    }

    // Step 2: save as DRAFT
    await page.click('button:has-text("บันทึกร่าง")');

    // Wait for redirect to entry/view page
    await page.waitForURL(/\/other-income\/[a-f0-9-]+/, { timeout: 10000 });

    // Step 3: toggle override checkbox
    const overrideCheckbox = page.locator('input[type="checkbox"]:near(:text("ใช้เอง"))');
    if (await overrideCheckbox.count() > 0) {
      await overrideCheckbox.check();
    } else {
      // Fallback: look for checkbox by aria-label or other attribute
      await page.check('input:near(:text("Override"))');
    }

    // Wait for warning dialog to appear
    await expect(page.getByText('คุณกำลังจะแก้ไข')).toBeVisible({ timeout: 5000 });

    // Acknowledge the override
    const acknowledgeCheckbox = page.locator('input[type="checkbox"]:near(:text("ฉันเข้าใจ"))');
    if (await acknowledgeCheckbox.count() > 0) {
      await acknowledgeCheckbox.check();
    }

    // Click edit mode button
    await page.click('button:has-text("เปิดโหมดแก้ไข")');
    await page.waitForSelector('table, div[role="table"]', { timeout: 5000 });

    // Step 4: introduce a V1 violation (Dr != Cr)
    const firstDrInput = page.locator('input[type="number"]').first();
    await firstDrInput.fill('999999');

    // Verify error message appears
    await expect(page.getByText(/V1.*ผลต่าง/)).toBeVisible({ timeout: 5000 });

    // Verify POST button is disabled
    const postButton = page.getByRole('button', { name: /POST|บันทึก/ });
    if (await postButton.count() > 0) {
      await expect(postButton).toBeDisabled();
    }

    // Step 5: fix balance and POST
    await firstDrInput.fill('1000');

    // Wait for error to clear (no error text visible)
    await expect(page.getByText(/V1.*ผลต่าง/)).not.toBeVisible({ timeout: 3000 });

    // POST button should now be enabled
    if (await postButton.count() > 0) {
      await expect(postButton).toBeEnabled({ timeout: 3000 });
      await postButton.click();
    }

    // Wait for success message
    await expect(page.getByText(/บันทึกสำเร็จ|POSTED|สำเร็จ/)).toBeVisible({ timeout: 10000 });

    // Step 6: verify ✏ marker on list page
    await page.goto('/other-income');
    await page.waitForSelector('table, div[role="table"]', { timeout: 10000 });

    // Check for edit marker (✏) in the first row — selector may be in a cell or badge
    const editMarker = page.locator('text=/✏|แก้ไข|override/i').first();
    await expect(editMarker).toBeVisible({ timeout: 5000 });
  });

  test('V2 validation: blocks POST when only 1 line', async ({ page }) => {
    // Create a new entry
    await page.goto('/other-income/new');
    await page.waitForSelector('form', { timeout: 10000 });

    // Fill basic form
    await page.fill('input[name="amount"]', '500');

    // Save draft
    await page.click('button:has-text("บันทึกร่าง")');
    await page.waitForURL(/\/other-income\/[a-f0-9-]+/, { timeout: 10000 });

    // Toggle override
    await page.check('input[type="checkbox"]:near(:text("ใช้เอง"))');
    await expect(page.getByText('คุณกำลังจะแก้ไข')).toBeVisible({ timeout: 5000 });
    await page.check('input[type="checkbox"]:near(:text("ฉันเข้าใจ"))');
    await page.click('button:has-text("เปิดโหมดแก้ไข")');

    // Delete one line to leave only 1
    const deleteButtons = page.locator('button:has-text("ลบ")');
    if (await deleteButtons.count() > 0) {
      await deleteButtons.first().click();
    }

    // Expect V2 error (at least 2 lines required)
    await expect(page.getByText(/V2|อย่างน้อย.*2.*บรรทัด/)).toBeVisible({ timeout: 5000 });

    // POST button should be disabled
    const postButton = page.getByRole('button', { name: /POST|บันทึก/ });
    if (await postButton.count() > 0) {
      await expect(postButton).toBeDisabled();
    }
  });

  test('V5 validation: blocks POST when line has both Dr and Cr', async ({ page }) => {
    // Create a new entry
    await page.goto('/other-income/new');
    await page.waitForSelector('form', { timeout: 10000 });

    // Fill basic form
    await page.fill('input[name="amount"]', '750');

    // Save draft
    await page.click('button:has-text("บันทึกร่าง")');
    await page.waitForURL(/\/other-income\/[a-f0-9-]+/, { timeout: 10000 });

    // Toggle override
    await page.check('input[type="checkbox"]:near(:text("ใช้เอง"))');
    await expect(page.getByText('คุณกำลังจะแก้ไข')).toBeVisible({ timeout: 5000 });
    await page.check('input[type="checkbox"]:near(:text("ฉันเข้าใจ"))');
    await page.click('button:has-text("เปิดโหมดแก้ไข")');

    // Set both Dr and Cr on the same line
    const drInputs = page.locator('input[name*="debit"]');
    const crInputs = page.locator('input[name*="credit"]');

    if (await drInputs.count() > 0 && await crInputs.count() > 0) {
      await drInputs.first().fill('500');
      await crInputs.first().fill('250');
    }

    // Expect V5 error (Dr XOR Cr, not both)
    await expect(page.getByText(/V5|มีทั้ง Dr และ Cr/)).toBeVisible({ timeout: 5000 });

    // POST button should be disabled
    const postButton = page.getByRole('button', { name: /POST|บันทึก/ });
    if (await postButton.count() > 0) {
      await expect(postButton).toBeDisabled();
    }
  });
});
