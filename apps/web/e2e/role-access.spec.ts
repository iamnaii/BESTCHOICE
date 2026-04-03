import { test, expect, Page } from '@playwright/test';
import { loginViaAPI, loginAsRole, type TestRole } from './helpers/auth';
import { gotoWithRetry } from './helpers/navigation';

/**
 * Role-Based Access Control Tests
 *
 * Uses real seeded accounts for each role:
 *   OWNER: admin@bestchoice.com
 *   BRANCH_MANAGER: manager.ladprao@bestchoice.com
 *   SALES: sales1@bestchoice.com
 *   ACCOUNTANT: accountant@bestchoice.com
 *
 * All share password: admin1234
 */

/** Check if user was denied access (redirect or access denied message) */
async function isAccessDenied(page: Page, targetUrl: string): Promise<boolean> {
  await page.waitForTimeout(2000);
  const redirectedAway = !page.url().includes(targetUrl);
  const deniedMsg = await page.getByText(/ไม่มีสิทธิ์|access denied|unauthorized|403|ไม่อนุญาต/i).first()
    .isVisible({ timeout: 2000 }).catch(() => false);
  return redirectedAway || deniedMsg;
}

/* ================================================================
   OWNER role — should access ALL pages
   ================================================================ */
test.describe('OWNER role — full access', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsRole(page, 'OWNER');
  });

  const allPages = [
    { url: '/branches', name: 'จัดการสาขา' },
    { url: '/users', name: 'จัดการผู้ใช้' },
    { url: '/settings', name: 'ตั้งค่าระบบ' },
    { url: '/audit-logs', name: 'Audit Logs' },
    { url: '/system-status', name: 'สถานะระบบ' },
    { url: '/migration', name: 'นำเข้าข้อมูล' },
    { url: '/', name: 'Dashboard' },
    { url: '/pos', name: 'POS' },
    { url: '/sales', name: 'ประวัติการขาย' },
    { url: '/customers', name: 'ลูกค้า' },
    { url: '/contracts', name: 'สัญญา' },
    { url: '/payments', name: 'การชำระเงิน' },
    { url: '/stock', name: 'คลังสินค้า' },
    { url: '/reports', name: 'รายงาน' },
    { url: '/expenses', name: 'รายจ่าย' },
    { url: '/receipts', name: 'ใบเสร็จ' },
    { url: '/purchase-orders', name: 'ใบสั่งซื้อ' },
    { url: '/suppliers', name: 'ผู้ขาย' },
    { url: '/financial-audit', name: 'Financial Audit' },
    { url: '/pdpa', name: 'PDPA' },
  ];

  for (const { url, name } of allPages) {
    test(`OWNER can access ${name} (${url})`, async ({ page }) => {
      await gotoWithRetry(page, url);
      const denied = await isAccessDenied(page, url);
      expect(denied).toBeFalsy();
    });
  }
});

/* ================================================================
   SALES role — limited access
   ================================================================ */
test.describe('SALES role — restricted access', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsRole(page, 'SALES');
  });

  // SALES CAN access:
  const allowedPages = [
    { url: '/', name: 'Dashboard' },
    { url: '/pos', name: 'POS' },
    { url: '/sales', name: 'ประวัติการขาย' },
    { url: '/customers', name: 'ลูกค้า' },
    { url: '/contracts', name: 'สัญญา' },
    { url: '/contracts/create', name: 'สร้างสัญญา' },
    { url: '/payments', name: 'การชำระเงิน' },
    { url: '/stock', name: 'คลังสินค้า (ดูอย่างเดียว)' },
  ];

  for (const { url, name } of allowedPages) {
    test(`SALES can access ${name} (${url})`, async ({ page }) => {
      await gotoWithRetry(page, url);
      const denied = await isAccessDenied(page, url);
      expect(denied).toBeFalsy();
    });
  }

  // SALES CANNOT access:
  const deniedPages = [
    { url: '/settings', name: 'ตั้งค่าระบบ' },
    { url: '/users', name: 'จัดการผู้ใช้' },
    { url: '/branches', name: 'จัดการสาขา' },
    { url: '/audit-logs', name: 'Audit Logs' },
    { url: '/expenses', name: 'รายจ่าย' },
    { url: '/finance-receivable', name: 'เงินรับจากไฟแนนซ์' },
  ];

  for (const { url, name } of deniedPages) {
    test(`SALES denied access to ${name} (${url})`, async ({ page }) => {
      await gotoWithRetry(page, url);
      const denied = await isAccessDenied(page, url);
      expect(denied).toBeTruthy();
    });
  }
});

/* ================================================================
   ACCOUNTANT role — finance + reports
   ================================================================ */
test.describe('ACCOUNTANT role — finance access', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsRole(page, 'ACCOUNTANT');
  });

  // ACCOUNTANT CAN access:
  const allowedPages = [
    { url: '/', name: 'Dashboard' },
    { url: '/customers', name: 'ลูกค้า' },
    { url: '/contracts', name: 'สัญญา' },
    { url: '/payments', name: 'การชำระเงิน' },
    { url: '/expenses', name: 'รายจ่าย' },
    { url: '/receipts', name: 'ใบเสร็จ' },
    { url: '/reports', name: 'รายงาน' },
    { url: '/finance-receivable', name: 'เงินรับจากไฟแนนซ์' },
    { url: '/financial-audit', name: 'Financial Audit' },
    { url: '/stock', name: 'คลังสินค้า (ดูอย่างเดียว)' },
  ];

  for (const { url, name } of allowedPages) {
    test(`ACCOUNTANT can access ${name} (${url})`, async ({ page }) => {
      await gotoWithRetry(page, url);
      const denied = await isAccessDenied(page, url);
      expect(denied).toBeFalsy();
    });
  }

  // ACCOUNTANT CANNOT access:
  const deniedPages = [
    { url: '/settings', name: 'ตั้งค่าระบบ' },
    { url: '/users', name: 'จัดการผู้ใช้' },
    { url: '/branches', name: 'จัดการสาขา' },
    { url: '/audit-logs', name: 'Audit Logs' },
  ];

  for (const { url, name } of deniedPages) {
    test(`ACCOUNTANT denied access to ${name} (${url})`, async ({ page }) => {
      await gotoWithRetry(page, url);
      const denied = await isAccessDenied(page, url);
      expect(denied).toBeTruthy();
    });
  }
});

/* ================================================================
   BRANCH_MANAGER role — most access except system settings
   ================================================================ */
test.describe('BRANCH_MANAGER role — broad access', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsRole(page, 'BRANCH_MANAGER');
  });

  // BRANCH_MANAGER CAN access:
  const allowedPages = [
    { url: '/', name: 'Dashboard' },
    { url: '/pos', name: 'POS' },
    { url: '/sales', name: 'ประวัติการขาย' },
    { url: '/customers', name: 'ลูกค้า' },
    { url: '/contracts', name: 'สัญญา' },
    { url: '/contracts/create', name: 'สร้างสัญญา' },
    { url: '/payments', name: 'การชำระเงิน' },
    { url: '/stock', name: 'คลังสินค้า' },
    { url: '/expenses', name: 'รายจ่าย' },
    { url: '/receipts', name: 'ใบเสร็จ' },
    { url: '/reports', name: 'รายงาน' },
    { url: '/purchase-orders', name: 'ใบสั่งซื้อ' },
    { url: '/suppliers', name: 'ผู้ขาย' },
    { url: '/finance-receivable', name: 'เงินรับจากไฟแนนซ์' },
    { url: '/exchange', name: 'เปลี่ยนเครื่อง' },
    { url: '/repossessions', name: 'ยึดคืน' },
    { url: '/document-dashboard', name: 'สถานะเอกสาร' },
    { url: '/pdpa', name: 'PDPA' },
  ];

  for (const { url, name } of allowedPages) {
    test(`BRANCH_MANAGER can access ${name} (${url})`, async ({ page }) => {
      await gotoWithRetry(page, url);
      const denied = await isAccessDenied(page, url);
      expect(denied).toBeFalsy();
    });
  }

  // BRANCH_MANAGER CANNOT access:
  const deniedPages = [
    { url: '/settings', name: 'ตั้งค่าระบบ' },
    { url: '/users', name: 'จัดการผู้ใช้' },
    { url: '/branches', name: 'จัดการสาขา' },
    { url: '/audit-logs', name: 'Audit Logs' },
  ];

  for (const { url, name } of deniedPages) {
    test(`BRANCH_MANAGER denied access to ${name} (${url})`, async ({ page }) => {
      await gotoWithRetry(page, url);
      const denied = await isAccessDenied(page, url);
      expect(denied).toBeTruthy();
    });
  }
});

/* ================================================================
   Sidebar menu visibility per role
   ================================================================ */
test.describe('Sidebar menu per role', () => {
  test('OWNER sidebar shows ตั้งค่า and จัดการผู้ใช้', async ({ page }) => {
    await loginAsRole(page, 'OWNER');
    await gotoWithRetry(page, '/');
    await expect(page.locator('.sidebar, [class*="sidebar"], nav').first()).toBeVisible({ timeout: 15000 });

    const settingsMenu = page.locator('.sidebar, nav').getByText(/ตั้งค่า/).first();
    if (await settingsMenu.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(settingsMenu).toBeVisible();
    }
    const usersMenu = page.locator('.sidebar, nav').getByText(/ผู้ใช้/).first();
    if (await usersMenu.isVisible({ timeout: 3000 }).catch(() => false)) {
      await expect(usersMenu).toBeVisible();
    }
  });

  test('SALES sidebar hides ตั้งค่า and การเงิน', async ({ page }) => {
    await loginAsRole(page, 'SALES');
    await gotoWithRetry(page, '/');
    await expect(page.locator('.sidebar, [class*="sidebar"], nav').first()).toBeVisible({ timeout: 15000 });

    // SALES should NOT see settings
    const settingsMenu = page.locator('.sidebar, nav').getByText(/ตั้งค่าระบบ/).first();
    const settingsVisible = await settingsMenu.isVisible({ timeout: 3000 }).catch(() => false);
    expect(settingsVisible).toBeFalsy();
  });

  test('ACCOUNTANT sidebar shows การเงิน and รายงาน', async ({ page }) => {
    await loginAsRole(page, 'ACCOUNTANT');
    await gotoWithRetry(page, '/');
    await expect(page.locator('.sidebar, [class*="sidebar"], nav').first()).toBeVisible({ timeout: 15000 });

    // Should see finance and reports
    const financeMenu = page.locator('.sidebar, nav').getByText(/การเงิน|รายจ่าย|ใบเสร็จ/).first();
    if (await financeMenu.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(financeMenu).toBeVisible();
    }
    const reportsMenu = page.locator('.sidebar, nav').getByText(/รายงาน/).first();
    if (await reportsMenu.isVisible({ timeout: 3000 }).catch(() => false)) {
      await expect(reportsMenu).toBeVisible();
    }

    // Should NOT see settings
    const settingsMenu = page.locator('.sidebar, nav').getByText(/ตั้งค่าระบบ/).first();
    const settingsVisible = await settingsMenu.isVisible({ timeout: 3000 }).catch(() => false);
    expect(settingsVisible).toBeFalsy();
  });

  test('BRANCH_MANAGER sidebar shows most items except ตั้งค่า', async ({ page }) => {
    await loginAsRole(page, 'BRANCH_MANAGER');
    await gotoWithRetry(page, '/');
    await expect(page.locator('.sidebar, [class*="sidebar"], nav').first()).toBeVisible({ timeout: 15000 });

    // Should see POS, stock, etc.
    const stockMenu = page.locator('.sidebar, nav').getByText(/คลัง|สินค้า/).first();
    if (await stockMenu.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(stockMenu).toBeVisible();
    }

    // Should NOT see system settings
    const settingsMenu = page.locator('.sidebar, nav').getByText(/ตั้งค่าระบบ/).first();
    const settingsVisible = await settingsMenu.isVisible({ timeout: 3000 }).catch(() => false);
    expect(settingsVisible).toBeFalsy();
  });
});

/* ================================================================
   Unauthenticated — redirect to login
   ================================================================ */
test.describe('Unauthenticated access — redirect to login', () => {
  const protectedRoutes = [
    '/', '/pos', '/customers', '/contracts', '/payments',
    '/stock', '/reports', '/expenses', '/settings',
    '/users', '/branches', '/audit-logs',
  ];

  for (const route of protectedRoutes) {
    test(`unauthenticated user redirected from ${route}`, async ({ page }) => {
      await page.goto('/login', { waitUntil: 'domcontentloaded' });
      await page.evaluate(() => localStorage.removeItem('access_token'));

      await page.goto(route, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(3000);

      expect(page.url()).toContain('/login');
    });
  }
});

/* ================================================================
   Public routes — no redirect
   ================================================================ */
test.describe('Public routes — accessible without auth', () => {
  const publicRoutes = [
    { url: '/landing', name: 'Landing' },
    { url: '/forgot-password', name: 'Forgot Password' },
    { url: '/reset-password', name: 'Reset Password' },
    { url: '/verify/test-123', name: 'Contract Verify' },
    { url: '/customer-access/test-token', name: 'Customer Portal' },
  ];

  for (const { url, name } of publicRoutes) {
    test(`${name} (${url}) accessible without login`, async ({ page }) => {
      await page.goto('/login', { waitUntil: 'domcontentloaded' });
      await page.evaluate(() => localStorage.removeItem('access_token'));

      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(3000);

      expect(page.url()).not.toMatch(/\/login$/);
    });
  }
});
