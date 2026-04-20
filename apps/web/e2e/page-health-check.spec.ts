import { test, expect, Page, ConsoleMessage } from '@playwright/test';
import { loginAsRole, type TestRole } from './helpers/auth';
import { gotoWithRetry, hasErrorBoundary } from './helpers/navigation';

/**
 * Page Health Check — extends page-smoke.spec.ts with deeper checks:
 * 1. Error boundary detection (same as smoke)
 * 2. Console.error collection (filtered for benign noise)
 * 3. 5xx network error detection
 * 4. Blank page detection
 *
 * Also adds FINANCE_MANAGER role which page-smoke doesn't cover.
 *
 * Usage:
 *   npx playwright test e2e/page-health-check.spec.ts
 *   npx playwright test e2e/page-health-check.spec.ts -g "OWNER"
 *   npx playwright test e2e/page-health-check.spec.ts -g "FINANCE_MANAGER"
 */

// Known benign errors to ignore
const BENIGN_PATTERNS = [
  'favicon',
  'ResizeObserver loop',
  'ResizeObserver loop completed with undelivered notifications',
  'net::ERR_CONNECTION_REFUSED', // dev HMR websocket disconnect
  'WebSocket',
  '[HMR]',
  '[vite]',
  'Download the React DevTools',
];

function isBenign(text: string): boolean {
  return BENIGN_PATTERNS.some((p) => text.includes(p));
}

interface HealthRoute {
  url: string;
  name: string;
}

// ─── Route definitions per role ────────────────────────────────

const OWNER_PAGES: HealthRoute[] = [
  { url: '/', name: 'Dashboard' },
  { url: '/pos', name: 'POS' },
  { url: '/sales', name: 'ประวัติการขาย' },
  { url: '/customers', name: 'รายชื่อลูกค้า' },
  { url: '/contracts', name: 'รายการสัญญา' },
  { url: '/contract-templates', name: 'เทมเพลตสัญญา' },
  { url: '/payments', name: 'การชำระเงิน' },
  { url: '/payments/import-csv', name: 'นำเข้า CSV' },
  { url: '/overdue', name: 'ค้างชำระ' },
  { url: '/slip-review', name: 'ตรวจสอบสลิป' },
  { url: '/stock', name: 'คลังสินค้า' },
  { url: '/stock/transfers', name: 'โอนสินค้า' },
  { url: '/stock/alerts', name: 'แจ้งเตือนสต็อก' },
  { url: '/stock/adjustments', name: 'ปรับสต็อก' },
  { url: '/stock/count', name: 'นับสต็อก' },
  { url: '/stock/workflow', name: 'Inventory Workflow' },
  { url: '/stickers', name: 'พิมพ์สติกเกอร์' },
  { url: '/suppliers', name: 'ผู้ขาย' },
  { url: '/purchase-orders', name: 'ใบสั่งซื้อ' },
  { url: '/expenses', name: 'รายจ่าย' },
  { url: '/receipts', name: 'ใบเสร็จ' },
  { url: '/reports', name: 'รายงาน' },
  { url: '/profit-loss', name: 'กำไรขาดทุน' },
  { url: '/financial-audit', name: 'ตรวจสอบการเงิน' },
  { url: '/finance-receivable', name: 'เงินรับไฟแนนซ์' },
  { url: '/commissions', name: 'คอมมิชชัน' },
  { url: '/tax-reports', name: 'ภาษี' },
  { url: '/trade-in', name: 'รับซื้อมือสอง' },
  { url: '/promotions', name: 'โปรโมชัน' },
  { url: '/exchange', name: 'เปลี่ยนเครื่อง' },
  { url: '/repossessions', name: 'ยึดคืน' },
  { url: '/inspections', name: 'ตรวจสภาพ' },
  { url: '/branches', name: 'สาขา' },
  { url: '/users', name: 'ผู้ใช้' },
  { url: '/settings', name: 'ตั้งค่า' },
  { url: '/settings/interest-config', name: 'ดอกเบี้ย' },
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

const FINANCE_MANAGER_PAGES: HealthRoute[] = [
  { url: '/', name: 'Dashboard' },
  { url: '/customers', name: 'ลูกค้า' },
  { url: '/contracts', name: 'สัญญา' },
  { url: '/payments', name: 'ชำระเงิน' },
  { url: '/overdue', name: 'ค้างชำระ' },
  { url: '/expenses', name: 'รายจ่าย' },
  { url: '/receipts', name: 'ใบเสร็จ' },
  { url: '/reports', name: 'รายงาน' },
  { url: '/profit-loss', name: 'กำไรขาดทุน' },
  { url: '/finance-receivable', name: 'เงินรับไฟแนนซ์' },
  { url: '/financial-audit', name: 'ตรวจสอบการเงิน' },
  { url: '/commissions', name: 'คอมมิชชัน' },
  { url: '/slip-review', name: 'ตรวจสอบสลิป' },
];

const BRANCH_MANAGER_PAGES: HealthRoute[] = [
  { url: '/', name: 'Dashboard' },
  { url: '/pos', name: 'POS' },
  { url: '/sales', name: 'ประวัติการขาย' },
  { url: '/customers', name: 'ลูกค้า' },
  { url: '/contracts', name: 'สัญญา' },
  { url: '/payments', name: 'ชำระเงิน' },
  { url: '/overdue', name: 'ค้างชำระ' },
  { url: '/stock', name: 'คลังสินค้า' },
  { url: '/stock/transfers', name: 'โอนสินค้า' },
  { url: '/suppliers', name: 'ผู้ขาย' },
  { url: '/purchase-orders', name: 'ใบสั่งซื้อ' },
  { url: '/expenses', name: 'รายจ่าย' },
  { url: '/receipts', name: 'ใบเสร็จ' },
  { url: '/reports', name: 'รายงาน' },
  { url: '/finance-receivable', name: 'เงินรับไฟแนนซ์' },
  { url: '/exchange', name: 'เปลี่ยนเครื่อง' },
  { url: '/repossessions', name: 'ยึดคืน' },
];

const ACCOUNTANT_PAGES: HealthRoute[] = [
  { url: '/', name: 'Dashboard' },
  { url: '/customers', name: 'ลูกค้า' },
  { url: '/contracts', name: 'สัญญา' },
  { url: '/payments', name: 'ชำระเงิน' },
  { url: '/expenses', name: 'รายจ่าย' },
  { url: '/receipts', name: 'ใบเสร็จ' },
  { url: '/reports', name: 'รายงาน' },
  { url: '/profit-loss', name: 'กำไรขาดทุน' },
  { url: '/finance-receivable', name: 'เงินรับไฟแนนซ์' },
  { url: '/financial-audit', name: 'ตรวจสอบการเงิน' },
  { url: '/slip-review', name: 'ตรวจสอบสลิป' },
  { url: '/stock', name: 'คลังสินค้า' },
];

const SALES_PAGES: HealthRoute[] = [
  { url: '/', name: 'Dashboard' },
  { url: '/pos', name: 'POS' },
  { url: '/sales', name: 'ประวัติการขาย' },
  { url: '/customers', name: 'ลูกค้า' },
  { url: '/contracts', name: 'สัญญา' },
  { url: '/payments', name: 'ชำระเงิน' },
  { url: '/stock', name: 'คลังสินค้า' },
];

const ROLE_PAGES: Record<TestRole, HealthRoute[]> = {
  OWNER: OWNER_PAGES,
  FINANCE_MANAGER: FINANCE_MANAGER_PAGES,
  BRANCH_MANAGER: BRANCH_MANAGER_PAGES,
  ACCOUNTANT: ACCOUNTANT_PAGES,
  SALES: SALES_PAGES,
};

// ─── Test suites per role ──────────────────────────────────────

for (const [role, pages] of Object.entries(ROLE_PAGES) as [TestRole, HealthRoute[]][]) {
  test.describe(`${role} — Page Health Check`, () => {
    test.beforeEach(async ({ page }) => {
      await loginAsRole(page, role);
    });

    for (const { url, name } of pages) {
      test(`${name} (${url}) — no errors`, async ({ page }) => {
        const consoleErrors: string[] = [];
        const networkErrors: { url: string; status: number }[] = [];

        // Collect console errors
        page.on('console', (msg: ConsoleMessage) => {
          if (msg.type() === 'error' && !isBenign(msg.text())) {
            consoleErrors.push(msg.text());
          }
        });

        // Collect 5xx network errors
        page.on('response', (resp) => {
          if (resp.status() >= 500) {
            networkErrors.push({ url: resp.url(), status: resp.status() });
          }
        });

        // Navigate
        const loaded = await gotoWithRetry(page, url);

        // 1. No error boundary
        const errorVisible = await hasErrorBoundary(page);
        expect(errorVisible, `Error boundary visible on ${url}`).toBeFalsy();
        expect(loaded, `Page failed to load: ${url}`).toBeTruthy();

        // 2. No console.error (filtered)
        expect(
          consoleErrors,
          `Console errors on ${url}: ${consoleErrors.join(' | ')}`,
        ).toHaveLength(0);

        // 3. No 5xx network responses
        expect(
          networkErrors,
          `5xx errors on ${url}: ${networkErrors.map((e) => `${e.status} ${e.url}`).join(' | ')}`,
        ).toHaveLength(0);

        // 4. Page has visible content (not blank)
        const hasContent = await page
          .locator(
            'main, .sidebar, h1, h2, [role="heading"], table, form, [class*="card"], [class*="Card"], [class*="skeleton"], [class*="Skeleton"], button, select, input',
          )
          .first()
          .isVisible({ timeout: 8000 })
          .catch(() => false);
        expect(hasContent, `${url} appears blank`).toBeTruthy();
      });
    }
  });
}
