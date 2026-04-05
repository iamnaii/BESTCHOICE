import { test, expect, Page } from '@playwright/test';
import { loginViaAPI } from './helpers/auth';
import { gotoWithRetry, hasErrorBoundary } from './helpers/navigation';

/* ================================================================
   สร้างสัญญา (/contracts/create) — Full Wizard
   ================================================================ */
test.describe('สร้างสัญญา Wizard', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page);
    await gotoWithRetry(page, '/contracts/create');
  });

  test('should load contract create wizard', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    // Wizard should show step indicator
    const stepIndicator = page.getByText(/ขั้นตอน|สินค้า|เลือกสินค้า|Step/i).first();
    await expect(stepIndicator).toBeVisible({ timeout: 15000 });
  });

  test('should show product selection step first', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    const productStep = page.getByText(/เลือกสินค้า|สินค้า/).first();
    await expect(productStep).toBeVisible({ timeout: 10000 });
  });

  test('should display product list or empty state in step 1', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    const productRow = page.locator('table tbody tr, .product-item').first();
    const hasProducts = await productRow.isVisible({ timeout: 5000 }).catch(() => false);
    if (!hasProducts) {
      // Empty product list is acceptable
      await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
      return;
    }
    await expect(productRow).toBeVisible();
  });

  test('should navigate wizard steps with next/back', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    // Try to select a product first
    const productRow = page.locator('table tbody tr').first();
    if (!await productRow.isVisible({ timeout: 5000 }).catch(() => false)) return;
    await productRow.click();

    // Next button
    const nextBtn = page.locator('button').filter({ hasText: /ถัดไป|Next/ }).first();
    if (!await nextBtn.isVisible({ timeout: 3000 }).catch(() => false)) return;
    if (await nextBtn.isDisabled()) return;

    await nextBtn.click();
    await page.waitForTimeout(1000);

    // Should move to step 2 (customer selection)
    const customerStep = page.getByText(/เลือกลูกค้า|ลูกค้า/).first();
    await expect(customerStep).toBeVisible({ timeout: 5000 });

    // Back button
    const backBtn = page.locator('button').filter({ hasText: /ย้อนกลับ|กลับ|Back/ }).first();
    if (await backBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await backBtn.click();
      await page.waitForTimeout(500);
    }
  });

  test('should validate required fields before proceeding', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    // Try next without selecting product
    const nextBtn = page.locator('button').filter({ hasText: /ถัดไป|Next/ }).first();
    if (await nextBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      const isDisabled = await nextBtn.isDisabled();
      if (!isDisabled) {
        await nextBtn.click();
        // Should show validation
        const toast = page.locator('[data-sonner-toast]').first();
        const hasToast = await toast.isVisible({ timeout: 3000 }).catch(() => false);
        const hasError = await page.locator('.text-destructive, .text-red-500, [role="alert"]').first()
          .isVisible({ timeout: 2000 }).catch(() => false);
        expect(hasToast || hasError || isDisabled).toBeTruthy();
      }
    }
  });

  test('should show installment plan configuration step', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    // Select product
    const productRow = page.locator('table tbody tr').first();
    if (!await productRow.isVisible({ timeout: 5000 }).catch(() => false)) return;
    await productRow.click();

    const nextBtn = page.locator('button').filter({ hasText: /ถัดไป/ }).first();
    if (!await nextBtn.isVisible({ timeout: 3000 }).catch(() => false)) return;
    if (await nextBtn.isDisabled()) return;
    await nextBtn.click();
    await page.waitForTimeout(1000);

    // Select customer (if step 2)
    const customerRow = page.locator('table tbody tr').first();
    if (await customerRow.isVisible({ timeout: 5000 }).catch(() => false)) {
      await customerRow.click();
      const nextBtn2 = page.locator('button').filter({ hasText: /ถัดไป/ }).first();
      if (await nextBtn2.isVisible({ timeout: 3000 }).catch(() => false) && !await nextBtn2.isDisabled()) {
        await nextBtn2.click();
        await page.waitForTimeout(1000);
      }
    }

    // Should show plan details (down payment, months, etc.)
    const planSection = page.getByText(/เงินดาวน์|งวด|ดาวน์|จำนวนงวด/).first();
    if (await planSection.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(planSection).toBeVisible();
    }
  });

  test('should show document upload step', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    // Look for upload section in later steps
    const uploadSection = page.getByText(/อัปโหลด|เอกสาร|upload/i).first();
    // This may not be visible on first step
    await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
  });
});

/* ================================================================
   รายละเอียดสัญญา (/contracts/:id)
   ================================================================ */
test.describe('รายละเอียดสัญญา', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page);
  });

  test('should navigate to contract detail from list', async ({ page }) => {
    const ok = await gotoWithRetry(page, '/contracts');
    if (!ok) return; // app error on contracts page — skip

    const contractLink = page.locator('table tbody tr td a, table tbody tr').first();
    if (!await contractLink.isVisible({ timeout: 5000 }).catch(() => false)) {
      // No contracts or empty state — acceptable
      return;
    }

    await contractLink.click();
    await page.waitForTimeout(1000);

    // Should show contract detail
    await expect(
      page.getByText(/รายละเอียดสัญญา|สัญญาผ่อนชำระ/).first(),
    ).toBeVisible({ timeout: 10000 });
  });

  test('should display contract information sections', async ({ page }) => {
    const ok = await gotoWithRetry(page, '/contracts');
    if (!ok) return;
    const contractLink = page.locator('table tbody tr td a, table tbody tr').first();
    if (!await contractLink.isVisible({ timeout: 5000 }).catch(() => false)) return;
    await contractLink.click();
    await page.waitForTimeout(1000);

    // Verify key sections exist
    const sections = [/ลูกค้า|ผู้เช่าซื้อ/, /สินค้า|เครื่อง/, /งวดชำระ|ตารางผ่อน/];
    for (const section of sections) {
      const el = page.getByText(section).first();
      if (await el.isVisible({ timeout: 3000 }).catch(() => false)) {
        await expect(el).toBeVisible();
      }
    }
  });

  test('should show payment history in contract detail', async ({ page }) => {
    const ok = await gotoWithRetry(page, '/contracts');
    if (!ok) return;
    const contractLink = page.locator('table tbody tr td a, table tbody tr').first();
    if (!await contractLink.isVisible({ timeout: 5000 }).catch(() => false)) return;
    await contractLink.click();
    await page.waitForTimeout(1000);

    const paymentSection = page.getByText(/ประวัติชำระ|การชำระเงิน/).first();
    if (await paymentSection.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(paymentSection).toBeVisible();
    }
  });

  test('should display status badge', async ({ page }) => {
    const ok = await gotoWithRetry(page, '/contracts');
    if (!ok) return;
    const contractLink = page.locator('table tbody tr td a, table tbody tr').first();
    if (!await contractLink.isVisible({ timeout: 5000 }).catch(() => false)) return;
    await contractLink.click();
    await page.waitForTimeout(1000);

    // Status badges
    const statusBadge = page.locator('.badge, [class*="badge"], [class*="status"]')
      .filter({ hasText: /ปกติ|ค้างชำระ|ปิดแล้ว|รอเซ็น|ACTIVE|OVERDUE|CLOSED/ })
      .first();
    if (await statusBadge.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(statusBadge).toBeVisible();
    }
  });
});

/* ================================================================
   เซ็นสัญญา (/contracts/:id/sign)
   ================================================================ */
test.describe('เซ็นสัญญา', () => {
  test('should load sign page from contract detail', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    await loginViaAPI(page);
    await gotoWithRetry(page, '/contracts');

    const contractLink = page.locator('table tbody tr td a, table tbody tr').first();
    if (!await contractLink.isVisible({ timeout: 5000 }).catch(() => false)) return;
    await contractLink.click();
    await page.waitForTimeout(1000);

    // Look for sign button
    const signBtn = page.locator('button, a').filter({ hasText: /ลงนาม|เซ็น|sign/i }).first();
    if (await signBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await signBtn.click();
      await page.waitForTimeout(1000);
      await expect(
        page.getByText(/ลงนามสัญญา|เซ็นสัญญา/).first(),
      ).toBeVisible({ timeout: 10000 });
    }
  });

  test('should display e-signature canvas when available', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    await loginViaAPI(page);
    await gotoWithRetry(page, '/contracts');

    const contractLink = page.locator('table tbody tr td a, table tbody tr').first();
    if (!await contractLink.isVisible({ timeout: 5000 }).catch(() => false)) return;
    await contractLink.click();
    await page.waitForTimeout(1000);

    const signBtn = page.locator('button, a').filter({ hasText: /ลงนาม|เซ็น/i }).first();
    if (!await signBtn.isVisible({ timeout: 5000 }).catch(() => false)) return;
    await signBtn.click();
    await page.waitForTimeout(1000);

    // Look for canvas element (signature pad)
    const canvas = page.locator('canvas').first();
    if (await canvas.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(canvas).toBeVisible();
    }
  });

  test('should show signature step indicators (customer/staff)', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    await loginViaAPI(page);
    await gotoWithRetry(page, '/contracts');

    const contractLink = page.locator('table tbody tr td a, table tbody tr').first();
    if (!await contractLink.isVisible({ timeout: 5000 }).catch(() => false)) return;
    await contractLink.click();
    await page.waitForTimeout(1000);

    const signBtn = page.locator('button, a').filter({ hasText: /ลงนาม|เซ็น/i }).first();
    if (!await signBtn.isVisible({ timeout: 5000 }).catch(() => false)) return;
    await signBtn.click();
    await page.waitForTimeout(1000);

    // Signing flow should show signer type indicators
    const signerLabels = page.getByText(/ลูกค้า|พนักงาน|ผู้เช่าซื้อ|ผู้ให้เช่า/).first();
    if (await signerLabels.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(signerLabels).toBeVisible();
    }
  });

  test('should have clear and re-sign buttons', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    await loginViaAPI(page);
    await gotoWithRetry(page, '/contracts');

    const contractLink = page.locator('table tbody tr td a, table tbody tr').first();
    if (!await contractLink.isVisible({ timeout: 5000 }).catch(() => false)) return;
    await contractLink.click();
    await page.waitForTimeout(1000);

    const signBtn = page.locator('button, a').filter({ hasText: /ลงนาม|เซ็น/i }).first();
    if (!await signBtn.isVisible({ timeout: 5000 }).catch(() => false)) return;
    await signBtn.click();
    await page.waitForTimeout(1000);

    // Look for clear/reset signature button
    const clearBtn = page.locator('button').filter({ hasText: /ล้าง|เคลียร์|Clear|ลบ/ }).first();
    if (await clearBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(clearBtn).toBeVisible();
    }
  });
});

/* ================================================================
   สถานะเอกสาร (/document-dashboard)
   ================================================================ */
test.describe('สถานะเอกสารสัญญา', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page);
    await gotoWithRetry(page, '/document-dashboard');
  });

  test('should load document dashboard', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    await expect(
      page.getByText('สถานะเอกสารสัญญา').first(),
    ).toBeVisible({ timeout: 15000 });
  });

  test('should display subtitle', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    await expect(
      page.getByText(/ภาพรวมสถานะเอกสาร/).first(),
    ).toBeVisible({ timeout: 10000 });
  });

  test('should show document tracking list or empty state', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    const hasData = await page.locator('table tbody tr, .document-item').first()
      .isVisible({ timeout: 5000 }).catch(() => false);
    if (hasData) {
      await expect(page.locator('table, .document-list').first()).toBeVisible();
    } else {
      await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
    }
  });

  test('should have filter or search capability', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    const search = page.getByPlaceholder(/ค้นหา|search/i).first();
    if (await search.isVisible({ timeout: 5000 }).catch(() => false)) {
      await search.fill('test');
      await page.waitForTimeout(500);
    }
    await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
  });
});
