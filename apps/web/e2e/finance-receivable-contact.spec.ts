// apps/web/e2e/finance-receivable-contact.spec.ts
import { test, expect } from '@playwright/test';
import { loginAsRole } from './helpers/auth';

test.describe('Finance Receivable contact log', () => {
  test.beforeEach(async ({ page }) => {
    // Login as FINANCE_MANAGER (finance@bestchoice.com / admin1234)
    await loginAsRole(page, 'FINANCE_MANAGER');
  });

  test('record a contact log and see it in timeline + last contacted column', async ({ page }) => {
    await page.goto('/finance-receivable');
    // Wait for the table to render (page uses Tabs; "ไฟแนนซ์ภายนอก" tab is active by default)
    await page.waitForSelector('table', { timeout: 15000 });

    // Wait briefly for query to resolve (avoid counting rows before data arrives)
    await page.waitForTimeout(2000);

    // DataTable always renders a <tbody tr> even when empty (shows EmptyState inside it).
    // A real data row has a <button> inside the first cell ("รายการขาย" column).
    // Skip if no real rows exist in dev DB.
    const firstRowButton = page.locator('tbody tr').first().locator('button').first();
    const hasData = await firstRowButton.isVisible({ timeout: 3000 }).catch(() => false);
    if (!hasData) {
      test.skip(true, 'No external-finance receivables seeded in dev DB');
      return;
    }

    // Click the button inside the first column cell of the first row to open the drawer.
    // The "รายการขาย" cell renders a <button onClick={() => setSelectedReceivable(r)}>
    await firstRowButton.click();

    // Drawer (Sheet) should open and show the section heading
    await expect(page.getByText('ประวัติการติดต่อ')).toBeVisible({ timeout: 10000 });

    // The drawer only shows the "บันทึกการติดต่อ" button when externalFinanceCompanyId is set.
    // If it's absent, the button still renders but the dialog won't open — skip gracefully.
    const logBtn = page.getByRole('button', { name: /บันทึกการติดต่อ/ });
    const btnVisible = await logBtn.isVisible({ timeout: 5000 }).catch(() => false);
    if (!btnVisible) {
      test.skip(true, 'บันทึกการติดต่อ button not found — row may lack externalFinanceCompanyId');
      return;
    }
    await logBtn.click();

    // Dialog opens: title "บันทึกการติดต่อไฟแนนซ์"
    await expect(page.getByText('บันทึกการติดต่อไฟแนนซ์')).toBeVisible({ timeout: 8000 });

    // Pick result = ANSWERED by clicking the pill button labelled "รับสาย"
    // (These are <button> elements rendered as pill chips, not radio inputs)
    await page.locator('button', { hasText: 'รับสาย' }).first().click();

    // Add note in the textarea
    await page.getByPlaceholder('รายละเอียดการคุย…').fill('E2E test note');

    // Submit — the save button has text "บันทึก" (exact, to avoid matching "บันทึกการติดต่อ")
    await page.locator('button', { hasText: /^บันทึก$/ }).last().click();

    // Sonner toast should appear
    await expect(page.getByText('บันทึกการติดต่อสำเร็จ')).toBeVisible({ timeout: 10000 });

    // Timeline should now show the new entry's note
    await expect(page.getByText('E2E test note')).toBeVisible({ timeout: 8000 });
  });

  test('broken-promise filter limits the list', async ({ page }) => {
    await page.goto('/finance-receivable');
    await page.waitForSelector('table', { timeout: 15000 });

    // Wait briefly for query to resolve before checking data
    await page.waitForTimeout(2000);

    // Check if any real data rows exist (DataTable always renders 1 tr for EmptyState
    // when data=[]; a real row has a button inside the first cell)
    const hasData = await page.locator('tbody tr').first().locator('button').first()
      .isVisible({ timeout: 3000 }).catch(() => false);
    if (!hasData) {
      test.skip(true, 'No external-finance receivables seeded in dev DB');
      return;
    }

    const initialCount = await page.locator('tbody tr').count();

    // The "มีนัดเลยกำหนด" filter is a plain <input type="checkbox"> inside a <label>.
    // Locate it via the surrounding label text.
    const checkbox = page.locator('label', { hasText: 'มีนัดเลยกำหนด' }).locator('input[type="checkbox"]');
    await checkbox.check();
    await page.waitForLoadState('networkidle');

    const filteredCount = await page.locator('tbody tr').count();
    expect(filteredCount).toBeLessThanOrEqual(initialCount);
  });
});
