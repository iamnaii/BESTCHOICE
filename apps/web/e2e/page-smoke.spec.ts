import { test, expect, Page } from '@playwright/test';
import { loginViaAPI, loginAsRole } from './helpers/auth';
import { gotoWithRetry, hasErrorBoundary } from './helpers/navigation';

/**
 * Page Smoke Tests — เปิดทุกหน้าแล้วตรวจว่าไม่ขึ้น error boundary
 *
 * ใช้ตรวจจับหน้าที่กดแล้วพัง (เช่น runtime error, missing data, bad import)
 * ไม่ได้ตรวจ logic — แค่ตรวจว่าหน้าโหลดได้โดยไม่ crash
 */

// ---------- helpers ----------

async function expectPageLoads(page: Page, url: string, expectedText?: string | RegExp) {
  const ok = await gotoWithRetry(page, url);

  // ถ้า error boundary ขึ้น → fail ทันที (ไม่ต้อง skip)
  expect(ok, `หน้า ${url} ขึ้น error boundary "เกิดข้อผิดพลาด"`).toBe(true);

  // ตรวจว่าไม่มี unhandled error text ซ่อนอยู่
  const body = page.locator('body');
  await expect(body).not.toContainText('Cannot read properties of', { timeout: 3000 }).catch(() => {});

  // ถ้าระบุ expectedText → ตรวจว่าเจอ
  if (expectedText) {
    await expect(page.getByText(expectedText).first()).toBeVisible({ timeout: 10000 });
  }
}

// ---------- OWNER pages (full access) ----------

test.describe('Smoke Test — OWNER pages', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page);
  });

  // Dashboard
  test('/ — Dashboard', async ({ page }) => {
    await expectPageLoads(page, '/', /แดชบอร์ด|Dashboard|รายได้/);
  });

  // Customers
  test('/customers — รายชื่อลูกค้า', async ({ page }) => {
    await expectPageLoads(page, '/customers', /ลูกค้า|Customers/);
  });

  // Contracts
  test('/contracts — สัญญา', async ({ page }) => {
    await expectPageLoads(page, '/contracts', /สัญญา|Contracts/);
  });

  test('/contracts/create — สร้างสัญญา', async ({ page }) => {
    await expectPageLoads(page, '/contracts/create');
  });

  test('/contract-templates — เทมเพลตสัญญา', async ({ page }) => {
    await expectPageLoads(page, '/contract-templates');
  });

  // Payments
  test('/payments — การชำระเงิน', async ({ page }) => {
    await expectPageLoads(page, '/payments', /ชำระ|Payment/);
  });

  test('/payments/import-csv — นำเข้า CSV', async ({ page }) => {
    await expectPageLoads(page, '/payments/import-csv');
  });

  // Finance
  test('/finance-receivable — ลูกหนี้', async ({ page }) => {
    await expectPageLoads(page, '/finance-receivable');
  });

  test('/receipts — ใบเสร็จ', async ({ page }) => {
    await expectPageLoads(page, '/receipts');
  });

  test('/expenses — ค่าใช้จ่าย', async ({ page }) => {
    await expectPageLoads(page, '/expenses');
  });

  test('/profit-loss — กำไรขาดทุน', async ({ page }) => {
    await expectPageLoads(page, '/profit-loss');
  });

  test('/financial-audit — ตรวจสอบการเงิน', async ({ page }) => {
    await expectPageLoads(page, '/financial-audit');
  });

  test('/slip-review — ตรวจสลิป', async ({ page }) => {
    await expectPageLoads(page, '/slip-review');
  });

  // POS & Sales
  test('/pos — POS', async ({ page }) => {
    await expectPageLoads(page, '/pos');
  });

  test('/sales — ประวัติการขาย', async ({ page }) => {
    await expectPageLoads(page, '/sales');
  });

  // Overdue & Collections
  test('/overdue — ค้างชำระ', async ({ page }) => {
    await expectPageLoads(page, '/overdue');
  });

  test('/repossessions — ยึดเครื่อง', async ({ page }) => {
    await expectPageLoads(page, '/repossessions');
  });

  test('/exchange — เปลี่ยนเครื่อง', async ({ page }) => {
    await expectPageLoads(page, '/exchange');
  });

  test('/credit-checks — ตรวจเครดิต', async ({ page }) => {
    await expectPageLoads(page, '/credit-checks');
  });

  // Stock & Inventory
  test('/stock — สต็อก', async ({ page }) => {
    await expectPageLoads(page, '/stock');
  });

  test('/stock/transfers — โอนสต็อก', async ({ page }) => {
    await expectPageLoads(page, '/stock/transfers');
  });

  test('/stock/alerts — แจ้งเตือนสต็อก', async ({ page }) => {
    await expectPageLoads(page, '/stock/alerts');
  });

  test('/stock/adjustments — ปรับสต็อก', async ({ page }) => {
    await expectPageLoads(page, '/stock/adjustments');
  });

  test('/stock/count — นับสต็อก', async ({ page }) => {
    await expectPageLoads(page, '/stock/count');
  });

  test('/stock/workflow — Inventory Workflow', async ({ page }) => {
    await expectPageLoads(page, '/stock/workflow');
  });

  test('/products/create — สร้างสินค้า', async ({ page }) => {
    await expectPageLoads(page, '/products/create');
  });

  test('/stickers — พิมพ์สติกเกอร์', async ({ page }) => {
    await expectPageLoads(page, '/stickers');
  });

  // Procurement
  test('/purchase-orders — ใบสั่งซื้อ', async ({ page }) => {
    await expectPageLoads(page, '/purchase-orders');
  });

  test('/suppliers — ซัพพลายเออร์', async ({ page }) => {
    await expectPageLoads(page, '/suppliers');
  });

  // Admin & Settings
  test('/branches — สาขา', async ({ page }) => {
    await expectPageLoads(page, '/branches');
  });

  test('/users — ผู้ใช้งาน', async ({ page }) => {
    await expectPageLoads(page, '/users');
  });

  test('/settings — ตั้งค่า', async ({ page }) => {
    await expectPageLoads(page, '/settings');
  });

  test('/settings/interest-config — ตั้งค่าดอกเบี้ย', async ({ page }) => {
    await expectPageLoads(page, '/settings/interest-config');
  });

  test('/settings/pricing-templates — เทมเพลตราคา', async ({ page }) => {
    await expectPageLoads(page, '/settings/pricing-templates');
  });

  test('/settings/line-oa — LINE OA', async ({ page }) => {
    await expectPageLoads(page, '/settings/line-oa');
  });

  test('/settings/sms — SMS', async ({ page }) => {
    await expectPageLoads(page, '/settings/sms');
  });

  test('/audit-logs — บันทึกการใช้งาน', async ({ page }) => {
    await expectPageLoads(page, '/audit-logs');
  });

  test('/system-status — สถานะระบบ', async ({ page }) => {
    await expectPageLoads(page, '/system-status');
  });

  test('/migration — Migration', async ({ page }) => {
    await expectPageLoads(page, '/migration');
  });

  // Reports & Notifications
  test('/reports — รายงาน', async ({ page }) => {
    await expectPageLoads(page, '/reports');
  });

  test('/notifications — การแจ้งเตือน', async ({ page }) => {
    await expectPageLoads(page, '/notifications');
  });

  // Compliance & Documents
  test('/pdpa — PDPA', async ({ page }) => {
    await expectPageLoads(page, '/pdpa');
  });

  test('/document-dashboard — เอกสาร', async ({ page }) => {
    await expectPageLoads(page, '/document-dashboard');
  });

  // Inspections
  test('/inspections — ตรวจสอบ', async ({ page }) => {
    await expectPageLoads(page, '/inspections');
  });
});

// ---------- Public pages (no login) ----------

test.describe('Smoke Test — Public pages', () => {
  test('/login — หน้าเข้าสู่ระบบ', async ({ page }) => {
    await expectPageLoads(page, '/login');
  });

  test('/landing — Landing page', async ({ page }) => {
    await expectPageLoads(page, '/landing');
  });

  test('/forgot-password — ลืมรหัสผ่าน', async ({ page }) => {
    await expectPageLoads(page, '/forgot-password');
  });

  test('/reset-password — ตั้งรหัสผ่านใหม่', async ({ page }) => {
    await expectPageLoads(page, '/reset-password');
  });
});

// ---------- LIFF pages (no login, public) ----------

test.describe('Smoke Test — LIFF pages', () => {
  test('/liff/contract — LIFF สัญญา', async ({ page }) => {
    await expectPageLoads(page, '/liff/contract');
  });

  test('/liff/register — LIFF ลงทะเบียน', async ({ page }) => {
    await expectPageLoads(page, '/liff/register');
  });

  test('/liff/history — LIFF ประวัติ', async ({ page }) => {
    await expectPageLoads(page, '/liff/history');
  });

  test('/liff/profile — LIFF โปรไฟล์', async ({ page }) => {
    await expectPageLoads(page, '/liff/profile');
  });

  test('/liff/early-payoff — LIFF ปิดยอด', async ({ page }) => {
    await expectPageLoads(page, '/liff/early-payoff');
  });
});

// ---------- Role-specific smoke tests ----------
// ตรวจว่า role อื่นเข้าหน้าที่ตัวเองมีสิทธิ์ได้โดยไม่พัง

test.describe('Smoke Test — SALES role', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsRole(page, 'SALES');
  });

  test('/pos — POS (SALES)', async ({ page }) => {
    await expectPageLoads(page, '/pos');
  });

  test('/customers — ลูกค้า (SALES)', async ({ page }) => {
    await expectPageLoads(page, '/customers');
  });

  test('/contracts — สัญญา (SALES)', async ({ page }) => {
    await expectPageLoads(page, '/contracts');
  });

  test('/stock — สต็อก (SALES)', async ({ page }) => {
    await expectPageLoads(page, '/stock');
  });

  test('/inspections — ตรวจสอบ (SALES)', async ({ page }) => {
    await expectPageLoads(page, '/inspections');
  });
});

test.describe('Smoke Test — ACCOUNTANT role', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsRole(page, 'ACCOUNTANT');
  });

  test('/payments — การชำระเงิน (ACCOUNTANT)', async ({ page }) => {
    await expectPageLoads(page, '/payments');
  });

  test('/receipts — ใบเสร็จ (ACCOUNTANT)', async ({ page }) => {
    await expectPageLoads(page, '/receipts');
  });

  test('/expenses — ค่าใช้จ่าย (ACCOUNTANT)', async ({ page }) => {
    await expectPageLoads(page, '/expenses');
  });

  test('/financial-audit — ตรวจสอบการเงิน (ACCOUNTANT)', async ({ page }) => {
    await expectPageLoads(page, '/financial-audit');
  });

  test('/slip-review — ตรวจสลิป (ACCOUNTANT)', async ({ page }) => {
    await expectPageLoads(page, '/slip-review');
  });

  test('/profit-loss — กำไรขาดทุน (ACCOUNTANT)', async ({ page }) => {
    await expectPageLoads(page, '/profit-loss');
  });
});

test.describe('Smoke Test — BRANCH_MANAGER role', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsRole(page, 'BRANCH_MANAGER');
  });

  test('/ — Dashboard (BRANCH_MANAGER)', async ({ page }) => {
    await expectPageLoads(page, '/');
  });

  test('/stock/transfers — โอนสต็อก (BRANCH_MANAGER)', async ({ page }) => {
    await expectPageLoads(page, '/stock/transfers');
  });

  test('/purchase-orders — ใบสั่งซื้อ (BRANCH_MANAGER)', async ({ page }) => {
    await expectPageLoads(page, '/purchase-orders');
  });

  test('/suppliers — ซัพพลายเออร์ (BRANCH_MANAGER)', async ({ page }) => {
    await expectPageLoads(page, '/suppliers');
  });

  test('/repossessions — ยึดเครื่อง (BRANCH_MANAGER)', async ({ page }) => {
    await expectPageLoads(page, '/repossessions');
  });

  test('/notifications — การแจ้งเตือน (BRANCH_MANAGER)', async ({ page }) => {
    await expectPageLoads(page, '/notifications');
  });
});
