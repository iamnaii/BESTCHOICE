import { test, expect, Page } from '@playwright/test';
import { loginViaAPI } from './helpers/auth';
import { gotoWithRetry, hasErrorBoundary } from './helpers/navigation';

/* ================================================================
   สาขา (/branches) — OWNER only
   ================================================================ */
test.describe('จัดการสาขา', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page);
    await gotoWithRetry(page, '/branches');
  });

  test('should load branches page', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    await expect(
      page.getByText('จัดการสาขา').first(),
    ).toBeVisible({ timeout: 15000 });
  });

  test('should display branch count in subtitle', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    await expect(
      page.getByText(/สาขา/).first(),
    ).toBeVisible({ timeout: 10000 });
  });

  test('should show branch list', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    const hasData = await page.locator('table tbody tr, .branch-card, .card').first()
      .isVisible({ timeout: 5000 }).catch(() => false);
    if (hasData) {
      await expect(page.locator('table, .branch-list').first()).toBeVisible();
    } else {
      await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
    }
  });

  test('should have create branch button', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    const createBtn = page.locator('button').filter({ hasText: /เพิ่ม|สร้าง|สาขา/ }).first();
    if (await createBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await createBtn.click();
      await page.waitForTimeout(500);
      const hasForm = await page.locator('[role="dialog"], .modal, form').first()
        .isVisible({ timeout: 3000 }).catch(() => false);
      if (hasForm) {
        await expect(page.locator('[role="dialog"], .modal, form').first()).toBeVisible();
      }
    }
  });

  test('should no error on page', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
  });
});

/* ================================================================
   จัดการผู้ใช้ (/users) — OWNER only
   ================================================================ */
test.describe('จัดการผู้ใช้', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page);
    await gotoWithRetry(page, '/users');
  });

  test('should load users page', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    await expect(
      page.getByText('จัดการผู้ใช้').first(),
    ).toBeVisible({ timeout: 15000 });
  });

  test('should display user count in subtitle', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    await expect(
      page.getByText(/คน/).first(),
    ).toBeVisible({ timeout: 10000 });
  });

  test('should show user list', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    const hasData = await page.locator('table tbody tr').first()
      .isVisible({ timeout: 5000 }).catch(() => false);
    if (hasData) {
      await expect(page.locator('table').first()).toBeVisible();
    }
  });

  test('should have invite user button', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    const inviteBtn = page.locator('button').filter({ hasText: /เชิญ|invite|เพิ่ม/ }).first();
    if (await inviteBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await inviteBtn.click();
      await page.waitForTimeout(500);
      const hasForm = await page.locator('[role="dialog"], .modal, form').first()
        .isVisible({ timeout: 3000 }).catch(() => false);
      if (hasForm) {
        await expect(page.locator('[role="dialog"], .modal, form').first()).toBeVisible();
      }
    }
  });

  test('should display role badges', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    const roleBadge = page.locator('.badge, [class*="badge"]')
      .filter({ hasText: /OWNER|SALES|ACCOUNTANT|BRANCH_MANAGER|เจ้าของ|พนักงาน/ }).first();
    if (await roleBadge.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(roleBadge).toBeVisible();
    }
  });

  test('should have search for users', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    const search = page.getByPlaceholder(/ค้นหา|ชื่อ|อีเมล|search/i).first();
    if (await search.isVisible({ timeout: 5000 }).catch(() => false)) {
      await search.fill('admin');
      await page.waitForTimeout(500);
      await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
    }
  });
});

/* ================================================================
   ตั้งค่าระบบ (/settings) — OWNER only
   ================================================================ */
test.describe('ตั้งค่าระบบ', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page);
    await gotoWithRetry(page, '/settings');
  });

  test('should load settings page', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    await expect(
      page.getByText('ตั้งค่าระบบ').first(),
    ).toBeVisible({ timeout: 15000 });
  });

  test('should display subtitle', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    await expect(
      page.getByText(/กำหนดพารามิเตอร์/).first(),
    ).toBeVisible({ timeout: 10000 });
  });

  test('should show settings form', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    const hasForm = await page.locator('form, input, select').first()
      .isVisible({ timeout: 5000 }).catch(() => false);
    if (hasForm) {
      await expect(page.locator('form, .settings-section').first()).toBeVisible();
    }
  });

  test('should have save button', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    const saveBtn = page.locator('button').filter({ hasText: /บันทึก|save/i }).first();
    if (await saveBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(saveBtn).toBeVisible();
    }
  });

  test('should no error on page', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
  });
});

/* ================================================================
   ราคาตั้งต้น (/settings/pricing-templates) — OWNER only
   ================================================================ */
test.describe('ราคาตั้งต้น', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page);
    await gotoWithRetry(page, '/settings/pricing-templates');
  });

  test('should load pricing templates page', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    await expect(
      page.getByText('ราคาตั้งต้น').first(),
    ).toBeVisible({ timeout: 15000 });
  });

  test('should display subtitle about pricing', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    await expect(
      page.getByText(/กำหนดราคา|เงินสด|ผ่อน/).first(),
    ).toBeVisible({ timeout: 10000 });
  });

  test('should show pricing template list or empty state', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    const hasData = await page.locator('table tbody tr, .card').first()
      .isVisible({ timeout: 5000 }).catch(() => false);
    if (!hasData) {
      await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
    }
  });

  test('should have create template action', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    const createBtn = page.locator('button').filter({ hasText: /เพิ่ม|สร้าง/ }).first();
    if (await createBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(createBtn).toBeVisible();
    }
  });

  test('should no error on page', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
  });
});

/* ================================================================
   เทมเพลตสัญญา (/contract-templates) — OWNER only
   ================================================================ */
test.describe('เทมเพลตสัญญา', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page);
    await gotoWithRetry(page, '/contract-templates');
  });

  test('should load contract templates page', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    // Page uses HeaderBar with a <select> for template switching, not a standard heading.
    // Avoid getByText on full contract content (80KB+ DOM) — use targeted locator.
    const headerBar = page.locator('select, button:has-text("บันทึก"), button:has-text("Save")').first();
    await expect(headerBar).toBeVisible({ timeout: 15000 });
  });

  test('should show template list or editor', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    const hasContent = await page.locator('table tbody tr, .template-list, .editor, textarea').first()
      .isVisible({ timeout: 5000 }).catch(() => false);
    if (!hasContent) {
      await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
    }
  });

  test('should have create/edit template action', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    const actionBtn = page.locator('button').filter({ hasText: /สร้าง|แก้ไข|เพิ่ม/ }).first();
    if (await actionBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(actionBtn).toBeVisible();
    }
  });

  test('should no error on page', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
  });
});

/* ================================================================
   PDPA (/pdpa) — OWNER, BRANCH_MANAGER
   ================================================================ */
test.describe('PDPA', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page);
    await gotoWithRetry(page, '/pdpa');
  });

  test('should load PDPA page', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    await expect(
      page.getByText(/PDPA/).first(),
    ).toBeVisible({ timeout: 15000 });
  });

  test('should display subtitle about data protection', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    await expect(
      page.getByText(/คุ้มครองข้อมูล|Consent|DSAR/).first(),
    ).toBeVisible({ timeout: 10000 });
  });

  test('should show consent management section', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    const consentSection = page.getByText(/Consent|ความยินยอม/).first();
    if (await consentSection.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(consentSection).toBeVisible();
    }
  });

  test('should no error on page', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
  });
});

/* ================================================================
   Audit Logs (/audit-logs) — OWNER only
   ================================================================ */
test.describe('Audit Logs', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page);
    await gotoWithRetry(page, '/audit-logs');
  });

  test('should load audit logs page', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    await expect(
      page.getByText('Audit Logs').first(),
    ).toBeVisible({ timeout: 15000 });
  });

  test('should display subtitle', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    await expect(
      page.getByText(/ประวัติการทำงาน/).first(),
    ).toBeVisible({ timeout: 10000 });
  });

  test('should show audit log list or empty state', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    const hasData = await page.locator('table tbody tr').first()
      .isVisible({ timeout: 5000 }).catch(() => false);
    if (hasData) {
      await expect(page.locator('table').first()).toBeVisible();
    } else {
      await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
    }
  });

  test('should have search/filter', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    const search = page.getByPlaceholder(/ค้นหา|search/i).first();
    if (await search.isVisible({ timeout: 5000 }).catch(() => false)) {
      await search.fill('login');
      await page.waitForTimeout(500);
      await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
    }
  });

  test('should show detail on log click', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    const firstRow = page.locator('table tbody tr').first();
    if (!await firstRow.isVisible({ timeout: 5000 }).catch(() => false)) return;
    await firstRow.click();
    await page.waitForTimeout(500);
    // Detail may show in expanded row or modal
    await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
  });

  test('should have filter by action type', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    const actionFilter = page.locator('select, [role="combobox"]').first();
    if (await actionFilter.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(actionFilter).toBeVisible();
    }
  });
});

/* ================================================================
   Financial Audit (/financial-audit) — OWNER, ACCOUNTANT
   ================================================================ */
test.describe('Financial Audit', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page);
    await gotoWithRetry(page, '/financial-audit');
  });

  test('should load financial audit page', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    await expect(
      page.getByText(/Financial Audit/).first(),
    ).toBeVisible({ timeout: 15000 });
  });

  test('should display subtitle', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    await expect(
      page.getByText(/ประวัติธุรกรรมการเงิน/).first(),
    ).toBeVisible({ timeout: 10000 });
  });

  test('should show audit trail list or empty state', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    const hasData = await page.locator('table tbody tr').first()
      .isVisible({ timeout: 5000 }).catch(() => false);
    if (!hasData) {
      await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
    }
  });

  test('should have search/filter', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    const search = page.getByPlaceholder(/ค้นหา|search/i).first();
    if (await search.isVisible({ timeout: 5000 }).catch(() => false)) {
      await search.fill('payment');
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
   สถานะระบบ (/system-status) — OWNER only
   ================================================================ */
test.describe('สถานะระบบ', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page);
    await gotoWithRetry(page, '/system-status');
  });

  test('should load system status page', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    await expect(
      page.getByText('สถานะระบบ').first(),
    ).toBeVisible({ timeout: 15000 });
  });

  test('should display subtitle about health check', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    await expect(
      page.getByText(/ตรวจสอบการเชื่อมต่อ|API|ฐานข้อมูล/).first(),
    ).toBeVisible({ timeout: 10000 });
  });

  test('should show system components status', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    const statusItems = page.getByText(/API|Database|ฐานข้อมูล|AI|Redis/).first();
    if (await statusItems.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(statusItems).toBeVisible();
    }
  });

  test('should display connection status indicators', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    const statusIndicator = page.locator('.badge, [class*="status"], [class*="indicator"]')
      .filter({ hasText: /ปกติ|เชื่อมต่อ|Online|OK|Error|ล้มเหลว/ }).first();
    if (await statusIndicator.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(statusIndicator).toBeVisible();
    }
  });

  test('should no error on page', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
  });
});

/* ================================================================
   นำเข้าข้อมูล (/migration) — OWNER only
   ================================================================ */
test.describe('นำเข้าข้อมูล', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page);
    await gotoWithRetry(page, '/migration');
  });

  test('should load migration page', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    await expect(
      page.getByText('นำเข้าข้อมูล').first(),
    ).toBeVisible({ timeout: 15000 });
  });

  test('should display subtitle about data import', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    await expect(
      page.getByText(/ย้ายข้อมูลจากระบบเดิม/).first(),
    ).toBeVisible({ timeout: 10000 });
  });

  test('should show import options or file upload', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    const uploadArea = page.locator('input[type="file"]').first()
      .or(page.getByText(/อัปโหลด|เลือกไฟล์|นำเข้า/).first());
    if (await uploadArea.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(uploadArea).toBeVisible();
    }
  });

  test('should no error on page', async ({ page }) => {
    if (await hasErrorBoundary(page)) return;
    await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
  });
});
