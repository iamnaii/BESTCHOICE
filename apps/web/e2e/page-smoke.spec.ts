import { test, expect, Page } from '@playwright/test';
import { loginAsRole, loginViaAPI, type TestRole } from './helpers/auth';
import { gotoWithRetry, hasErrorBoundary } from './helpers/navigation';

/**
 * Page Smoke Tests — visit every route and verify it renders without crashing.
 *
 * Unlike role-access.spec.ts (checks permissions), this test checks RENDERING:
 * - Does the page load without hitting the error boundary?
 * - Does meaningful content appear (not a blank white page)?
 *
 * Usage:
 *   npx playwright test e2e/page-smoke.spec.ts                    # all
 *   npx playwright test e2e/page-smoke.spec.ts -g "OWNER"         # OWNER pages only
 *   npx playwright test e2e/page-smoke.spec.ts -g "SALES"         # SALES pages only
 *   npx playwright test e2e/page-smoke.spec.ts -g "Public"        # public pages only
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Assert the page rendered without error boundary and has visible content */
async function assertPageLoaded(page: Page, url: string) {
  const loaded = await gotoWithRetry(page, url);

  // Check error boundary
  const errorVisible = await hasErrorBoundary(page);
  expect(errorVisible, `Error boundary visible on ${url}`).toBeFalsy();
  expect(loaded, `Page failed to load: ${url}`).toBeTruthy();

  // Page should have some visible content (not blank)
  // Check for common layout elements: sidebar, heading, main content, loading states
  const hasContent = await page.locator('main, .sidebar, h1, h2, [role="heading"], table, form, [class*="card"], [class*="Card"], [class*="skeleton"], [class*="Skeleton"], [class*="spinner"], [class*="loading"], button, select, input')
    .first()
    .isVisible({ timeout: 8000 })
    .catch(() => false);

  expect(hasContent, `Page ${url} appears blank — no main content found`).toBeTruthy();
}

// ---------------------------------------------------------------------------
// Route definitions per role
// ---------------------------------------------------------------------------

interface SmokeRoute {
  url: string;
  name: string;
}

/** All routes accessible by OWNER (everything) */
const OWNER_PAGES: SmokeRoute[] = [
  // Dashboard & Core
  { url: '/', name: 'Dashboard' },
  { url: '/pos', name: 'POS ขายสินค้า' },
  { url: '/sales', name: 'ประวัติการขาย' },
  { url: '/customers', name: 'รายชื่อลูกค้า' },
  { url: '/contracts', name: 'รายการสัญญา' },
  { url: '/contract-templates', name: 'เทมเพลตสัญญา' },
  { url: '/payments', name: 'การชำระเงิน' },
  { url: '/payments/import-csv', name: 'นำเข้า CSV ชำระเงิน' },
  { url: '/overdue', name: 'ค้างชำระ' },
  { url: '/slip-review', name: 'ตรวจสอบสลิป' },

  // Inventory & Supply
  { url: '/stock', name: 'คลังสินค้า' },
  { url: '/stock/transfers', name: 'โอนสินค้า' },
  { url: '/stock/alerts', name: 'แจ้งเตือนสต็อก' },
  { url: '/stock/adjustments', name: 'ปรับสต็อก' },
  { url: '/stock/count', name: 'นับสต็อก' },
  { url: '/stock/workflow', name: 'Inventory Workflow' },
  { url: '/stickers', name: 'พิมพ์สติกเกอร์' },
  { url: '/suppliers', name: 'รายชื่อผู้ขาย' },
  { url: '/purchase-orders', name: 'ใบสั่งซื้อ' },

  // Finance
  { url: '/expenses', name: 'รายจ่าย' },
  { url: '/receipts', name: 'ใบเสร็จ' },
  { url: '/reports', name: 'รายงาน' },
  { url: '/profit-loss', name: 'กำไรขาดทุน' },
  { url: '/financial-audit', name: 'ตรวจสอบการเงิน' },
  { url: '/finance-receivable', name: 'เงินรับจากไฟแนนซ์' },

  // Collections & Risk
  { url: '/exchange', name: 'เปลี่ยนเครื่อง' },
  { url: '/repossessions', name: 'ยึดคืน' },
  { url: '/inspections', name: 'ตรวจสภาพ' },

  // Admin & Settings
  { url: '/branches', name: 'จัดการสาขา' },
  { url: '/users', name: 'จัดการผู้ใช้' },
  { url: '/settings', name: 'ตั้งค่าระบบ' },
  { url: '/settings/interest-config', name: 'ตั้งค่าดอกเบี้ย' },
  { url: '/settings/pricing-templates', name: 'เทมเพลตราคา' },
  { url: '/settings/line-oa', name: 'LINE OA' },
  { url: '/settings/sms', name: 'SMS' },
  { url: '/audit-logs', name: 'Audit Logs' },
  { url: '/system-status', name: 'สถานะระบบ' },
  { url: '/migration', name: 'นำเข้าข้อมูล' },
  { url: '/notifications', name: 'การแจ้งเตือน' },
  { url: '/document-dashboard', name: 'สถานะเอกสาร' },
  { url: '/pdpa', name: 'PDPA' },
];

/** Routes BRANCH_MANAGER can access */
const BRANCH_MANAGER_PAGES: SmokeRoute[] = [
  { url: '/', name: 'Dashboard' },
  { url: '/pos', name: 'POS ขายสินค้า' },
  { url: '/sales', name: 'ประวัติการขาย' },
  { url: '/customers', name: 'รายชื่อลูกค้า' },
  { url: '/contracts', name: 'รายการสัญญา' },
  { url: '/contracts/create', name: 'สร้างสัญญา' },
  { url: '/payments', name: 'การชำระเงิน' },
  { url: '/overdue', name: 'ค้างชำระ' },
  { url: '/stock', name: 'คลังสินค้า' },
  { url: '/stock/transfers', name: 'โอนสินค้า' },
  { url: '/stock/workflow', name: 'Inventory Workflow' },
  { url: '/suppliers', name: 'รายชื่อผู้ขาย' },
  { url: '/purchase-orders', name: 'ใบสั่งซื้อ' },
  { url: '/expenses', name: 'รายจ่าย' },
  { url: '/receipts', name: 'ใบเสร็จ' },
  { url: '/reports', name: 'รายงาน' },
  { url: '/finance-receivable', name: 'เงินรับจากไฟแนนซ์' },
  { url: '/exchange', name: 'เปลี่ยนเครื่อง' },
  { url: '/repossessions', name: 'ยึดคืน' },
  { url: '/document-dashboard', name: 'สถานะเอกสาร' },
  { url: '/pdpa', name: 'PDPA' },
];

/** Routes SALES can access */
const SALES_PAGES: SmokeRoute[] = [
  { url: '/', name: 'Dashboard' },
  { url: '/pos', name: 'POS ขายสินค้า' },
  { url: '/sales', name: 'ประวัติการขาย' },
  { url: '/customers', name: 'รายชื่อลูกค้า' },
  { url: '/contracts', name: 'รายการสัญญา' },
  { url: '/contracts/create', name: 'สร้างสัญญา' },
  { url: '/payments', name: 'การชำระเงิน' },
  { url: '/stock', name: 'คลังสินค้า' },
];

/** Routes ACCOUNTANT can access */
const ACCOUNTANT_PAGES: SmokeRoute[] = [
  { url: '/', name: 'Dashboard' },
  { url: '/customers', name: 'รายชื่อลูกค้า' },
  { url: '/contracts', name: 'รายการสัญญา' },
  { url: '/payments', name: 'การชำระเงิน' },
  { url: '/expenses', name: 'รายจ่าย' },
  { url: '/receipts', name: 'ใบเสร็จ' },
  { url: '/reports', name: 'รายงาน' },
  { url: '/profit-loss', name: 'กำไรขาดทุน' },
  { url: '/finance-receivable', name: 'เงินรับจากไฟแนนซ์' },
  { url: '/financial-audit', name: 'ตรวจสอบการเงิน' },
  { url: '/slip-review', name: 'ตรวจสอบสลิป' },
  { url: '/stock', name: 'คลังสินค้า' },
];

/** Public routes — no login required */
const PUBLIC_PAGES: SmokeRoute[] = [
  { url: '/login', name: 'เข้าสู่ระบบ' },
  { url: '/landing', name: 'Landing Page' },
  { url: '/forgot-password', name: 'ลืมรหัสผ่าน' },
  { url: '/reset-password', name: 'ตั้งรหัสผ่านใหม่' },
];

// ---------------------------------------------------------------------------
// Test: OWNER — all pages
// ---------------------------------------------------------------------------
test.describe('OWNER smoke — all pages render', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsRole(page, 'OWNER');
  });

  for (const { url, name } of OWNER_PAGES) {
    test(`${name} (${url})`, async ({ page }) => {
      await assertPageLoaded(page, url);
    });
  }
});

// ---------------------------------------------------------------------------
// Test: BRANCH_MANAGER
// ---------------------------------------------------------------------------
test.describe('BRANCH_MANAGER smoke — pages render', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsRole(page, 'BRANCH_MANAGER');
  });

  for (const { url, name } of BRANCH_MANAGER_PAGES) {
    test(`${name} (${url})`, async ({ page }) => {
      await assertPageLoaded(page, url);
    });
  }
});

// ---------------------------------------------------------------------------
// Test: SALES
// ---------------------------------------------------------------------------
test.describe('SALES smoke — pages render', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsRole(page, 'SALES');
  });

  for (const { url, name } of SALES_PAGES) {
    test(`${name} (${url})`, async ({ page }) => {
      await assertPageLoaded(page, url);
    });
  }
});

// ---------------------------------------------------------------------------
// Test: ACCOUNTANT
// ---------------------------------------------------------------------------
test.describe('ACCOUNTANT smoke — pages render', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsRole(page, 'ACCOUNTANT');
  });

  for (const { url, name } of ACCOUNTANT_PAGES) {
    test(`${name} (${url})`, async ({ page }) => {
      await assertPageLoaded(page, url);
    });
  }
});

// ---------------------------------------------------------------------------
// Test: Public pages (no auth)
// ---------------------------------------------------------------------------
test.describe('Public smoke — pages render without auth', () => {
  for (const { url, name } of PUBLIC_PAGES) {
    test(`${name} (${url})`, async ({ page }) => {
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1000);

      const errorVisible = await hasErrorBoundary(page);
      expect(errorVisible, `Error boundary on public page ${url}`).toBeFalsy();

      // Public pages should show some content (form, heading, etc.)
      const hasContent = await page.locator('form, h1, h2, [role="heading"], main, [class*="card"], [class*="Card"], button')
        .first()
        .isVisible({ timeout: 5000 })
        .catch(() => false);

      expect(hasContent, `Public page ${url} appears blank`).toBeTruthy();
    });
  }
});
