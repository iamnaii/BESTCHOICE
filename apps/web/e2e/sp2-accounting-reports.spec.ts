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
    await expect(page.getByText('งบแสดงการเปลี่ยนแปลงในส่วนของผู้ถือหุ้น').first()).toBeVisible();
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

  // NOTE: there is no "รายการค้างจ่าย" tab and no bucket report on this page.
  // IntercompanySettlementPage has 4 tabs — รอจ่าย / รอบจ่าย / อายุลูกหนี้หน้าร้าน /
  // กระทบยอด — and the ageing tab (interco/AgingTab.tsx) is a per-contract table with
  // an "อายุ (วัน)" column, not 0–30/31–60 buckets. Bucket copy lives on a different
  // page entirely (/expenses/ap-aging, APAgingPage.tsx, and it uses an en dash).
  test('Intercompany aging tab shows per-contract ageing', async ({ page }) => {
    await loginAsRole(page, 'ACCOUNTANT');
    await page.goto('/accounting/intercompany');
    await page.getByRole('tab', { name: 'อายุลูกหนี้หน้าร้าน' }).click();
    await expect(page.getByText('อายุ (วัน)').first()).toBeVisible();
  });

  test('SALES is blocked from accounting reports', async ({ page }) => {
    await loginAsRole(page, 'SALES');
    await page.goto('/finance/cash-flow');
    // ProtectedRoute redirects away from /finance/cash-flow for SALES.
    await expect(page).not.toHaveURL(/cash-flow/);
  });
});
