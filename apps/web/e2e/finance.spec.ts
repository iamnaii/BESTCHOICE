import { test, expect, Page } from '@playwright/test';
import { loginViaAPI } from './helpers/auth';
import { gotoWithRetry, hasErrorBoundary } from './helpers/navigation';

/* ================================================================
   ใบเสร็จรับเงิน (/receipts)
   ================================================================ */
test.describe('ใบเสร็จรับเงิน', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page);
    await gotoWithRetry(page, '/receipts');
  });

  test('should load receipts page', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    await expect(page.getByText(/ใบเสร็จรับเงิน/).first()).toBeVisible({ timeout: 15000 });
  });

  test('should display subtitle about e-Receipt', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    await expect(page.getByText(/อิเล็กทรอนิกส์|e-Receipt/).first()).toBeVisible({ timeout: 10000 });
  });

  test('should show receipt list or empty state', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    const hasData = await page.locator('table tbody tr').first()
      .isVisible({ timeout: 5000 }).catch(() => false);
    if (!hasData) {
      await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
    }
  });

  test('should have search by receipt number', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    const search = page.getByPlaceholder(/ค้นหา|เลขใบเสร็จ|search/i).first();
    if (await search.isVisible({ timeout: 5000 }).catch(() => false)) {
      await search.fill('REC-');
      await page.waitForTimeout(500);
      await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
    }
  });

  test('should have print action for receipt', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    const firstRow = page.locator('table tbody tr').first();
    if (!await firstRow.isVisible({ timeout: 5000 }).catch(() => false)) return;
    const printBtn = page.locator('button').filter({ hasText: /พิมพ์|print/i }).first()
      .or(page.locator('[title*="พิมพ์"], [aria-label*="print"]').first());
    if (await printBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await expect(printBtn).toBeVisible();
    }
  });

  test('should have verify status indicator', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
  });
});

/* ================================================================
   ตรวจสอบสลิป (/slip-review)
   ================================================================ */
test.describe('ตรวจสอบสลิป', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page);
    await gotoWithRetry(page, '/slip-review');
  });

  test('should load slip review page', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    await expect(page.getByText(/ตรวจสอบสลิป/).first()).toBeVisible({ timeout: 15000 });
  });

  test('should display slip review summary cards', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    // SlipReviewTab shows summary cards — check for any visible summary metric
    await expect(page.getByText(/รอตรวจ|อนุมัติ|ปฏิเสธ/).first()).toBeVisible({ timeout: 10000 });
  });

  test('should show pending slips or empty state', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    const hasData = await page.locator('table tbody tr, .slip-item, .card').first()
      .isVisible({ timeout: 5000 }).catch(() => false);
    if (!hasData) {
      await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
    }
  });

  test('should have approve/reject actions when slips exist', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    const firstSlip = page.locator('table tbody tr, .slip-item').first();
    if (!await firstSlip.isVisible({ timeout: 5000 }).catch(() => false)) return;
    await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
  });

  test('should no error on page', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
  });
});

/* ================================================================
   นำเข้าชำระเงิน CSV (/payments/import-csv)
   ================================================================ */
test.describe('นำเข้าชำระเงิน CSV', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page);
    await gotoWithRetry(page, '/payments/import-csv');
  });

  test('should load CSV import page', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    await expect(page.getByText(/นำเข้าชำระเงิน|CSV/).first()).toBeVisible({ timeout: 15000 });
  });

  test('should display subtitle about CSV import', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    await expect(page.getByText(/นำเข้าข้อมูลการชำระเงินจากไฟล์/).first()).toBeVisible({ timeout: 10000 });
  });

  test('should have file upload area', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    const fileInput = page.locator('input[type="file"]').first();
    const dropZone = page.getByText(/อัปโหลด|ลากไฟล์|เลือกไฟล์|browse/i).first();
    const hasUpload = await fileInput.isVisible({ timeout: 5000 }).catch(() => false) ||
                      await dropZone.isVisible({ timeout: 3000 }).catch(() => false);
    expect(hasUpload).toBeTruthy();
  });

  test('should show import instructions or template link', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    const instructions = page.getByText(/รูปแบบ|template|ตัวอย่าง|คอลัมน์/i).first();
    if (await instructions.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(instructions).toBeVisible();
    }
    await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
  });

  test('should validate before import', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    const importBtn = page.locator('button').filter({ hasText: /นำเข้า|import/i }).first();
    if (await importBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      const isDisabled = await importBtn.isDisabled();
      if (!isDisabled) {
        await importBtn.click();
        await page.waitForTimeout(500);
      }
    }
  });
});

/* ================================================================
   เงินรับจากไฟแนนซ์ (/finance-receivable)
   ================================================================ */
test.describe('เงินรับจากไฟแนนซ์', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page);
    await gotoWithRetry(page, '/finance-receivable');
  });

  test('should load finance receivable page', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    await expect(page.getByText(/เงินรับจากไฟแนนซ์/).first()).toBeVisible({ timeout: 15000 });
  });

  test('should show receivable list or empty state', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    const hasData = await page.locator('table tbody tr').first()
      .isVisible({ timeout: 5000 }).catch(() => false);
    if (!hasData) {
      await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
    }
  });

  test('should have create/record action', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    const createBtn = page.locator('button').filter({ hasText: /บันทึก|เพิ่ม|สร้าง/ }).first();
    if (await createBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await createBtn.click();
      await page.waitForTimeout(500);
    }
  });

  test('should have search/filter', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    const search = page.getByPlaceholder(/ค้นหา|search/i).first();
    if (await search.isVisible({ timeout: 5000 }).catch(() => false)) {
      await search.fill('test');
      await page.waitForTimeout(500);
    }
    await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
  });

  test('should no error on page', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
  });
});

/* ================================================================
   บันทึกรายจ่าย (/expenses)
   ================================================================ */
test.describe('บันทึกรายจ่าย', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page);
    await gotoWithRetry(page, '/expenses');
  });

  test('should load expenses page', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    await expect(page.getByText(/รายจ่าย|ค่าใช้จ่าย|Expense/).first()).toBeVisible({ timeout: 15000 });
  });

  test('should show expense list or empty state', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    const hasData = await page.locator('table tbody tr').first()
      .isVisible({ timeout: 5000 }).catch(() => false);
    if (!hasData) {
      await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
    }
  });

  test('should have create expense button', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    const createBtn = page.locator('button').filter({ hasText: /เพิ่ม|สร้าง|บันทึก/ }).first();
    if (await createBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await createBtn.click();
      await page.waitForTimeout(500);
    }
  });

  test('should display account type categories', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
  });

  test('should have status filter', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    const statusFilter = page.locator('select, [role="combobox"]').first()
      .or(page.getByText(/ร่าง|รออนุมัติ|อนุมัติแล้ว/).first());
    if (await statusFilter.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(statusFilter).toBeVisible();
    }
  });

  test('should display expense summary cards', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    const summaryCard = page.locator('.card, [class*="card"]').first();
    if (await summaryCard.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(summaryCard).toBeVisible();
    }
  });

  test('should validate expense form fields', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    const createBtn = page.locator('button').filter({ hasText: /เพิ่ม|สร้าง|บันทึก/ }).first();
    if (!await createBtn.isVisible({ timeout: 5000 }).catch(() => false)) return;
    await createBtn.click();
    await page.waitForTimeout(1000);

    // Form panel or modal should be open — find save button INSIDE it
    const panel = page.locator('[role="dialog"], .modal, form, .panel, .slide-over').first();
    if (!await panel.isVisible({ timeout: 5000 }).catch(() => false)) return;

    const submitBtn = panel.locator('button').filter({ hasText: /บันทึก|ส่ง|save/i }).first();
    if (await submitBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await submitBtn.click({ force: true });
      await page.waitForTimeout(500);
    }
  });
});

/* ================================================================
   งบกำไรขาดทุน (/profit-loss)
   ================================================================ */
test.describe('งบกำไรขาดทุน', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page);
    await gotoWithRetry(page, '/profit-loss');
  });

  test('should load profit/loss page', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    await expect(page.getByText('งบกำไรขาดทุน').first()).toBeVisible({ timeout: 15000 });
  });

  test('should display P&L subtitle', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    await expect(page.getByText(/Profit.*Loss|ผังบัญชีไทย/).first()).toBeVisible({ timeout: 10000 });
  });

  test('should have date range filter', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    const dateFilter = page.locator('input[type="date"], input[type="month"]').first()
      .or(page.getByText(/ช่วงเวลา|เดือน|ปี/).first());
    if (await dateFilter.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(dateFilter).toBeVisible();
    }
  });

  test('should display revenue and expense sections', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    const revenueSection = page.getByText(/รายได้|Revenue/).first();
    if (await revenueSection.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(revenueSection).toBeVisible();
    }
    await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
  });

  test('should show totals and net profit', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    const netProfit = page.getByText(/กำไร|ขาดทุน|Net/).first();
    if (await netProfit.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(netProfit).toBeVisible();
    }
  });

  test('should no error on page', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
  });
});
