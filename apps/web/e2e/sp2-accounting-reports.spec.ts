import { test, expect } from '@playwright/test';
import { loginAsRole } from './helpers/auth';

test.describe('SP2 — Accounting Reports', () => {
  test('ACCOUNTANT can view Cash Flow', async ({ page }) => {
    await loginAsRole(page, 'ACCOUNTANT');
    await page.goto('/finance/cash-flow');
    await expect(page.getByText('งบกระแสเงินสด').first()).toBeVisible();
    await expect(page.getByText(/Indirect Method/).first()).toBeVisible();
  });

  test('ACCOUNTANT can view Equity Statement', async ({ page }) => {
    await loginAsRole(page, 'ACCOUNTANT');
    await page.goto('/finance/equity-statement');
    await expect(
      page.getByText('งบแสดงการเปลี่ยนแปลงในส่วนของผู้ถือหุ้น').first(),
    ).toBeVisible();
    // Caveat banner mentions "ค่าประมาณ"
    await expect(page.getByText(/ค่าประมาณ/).first()).toBeVisible();
  });

  test('ACCOUNTANT can view General Ledger with empty state before account is picked', async ({
    page,
  }) => {
    await loginAsRole(page, 'ACCOUNTANT');
    await page.goto('/finance/general-ledger');
    // Page header
    await expect(page.getByText('บัญชีแยกประเภท').first()).toBeVisible();
    // Empty-state copy
    await expect(page.getByText(/เลือกบัญชี/).first()).toBeVisible();
  });

  test('Intercompany aging tab shows buckets', async ({ page }) => {
    await loginAsRole(page, 'ACCOUNTANT');
    await page.goto('/accounting/intercompany');
    await page.getByRole('tab', { name: /รายการค้างจ่าย/ }).click();
    await expect(page.getByText(/0-30 วัน/).first()).toBeVisible();
  });

  test('SALES is blocked from accounting reports', async ({ page }) => {
    await loginAsRole(page, 'SALES');
    await page.goto('/finance/cash-flow');
    // ProtectedRoute redirects away from /finance/cash-flow for SALES.
    await expect(page).not.toHaveURL(/cash-flow/);
  });
});
