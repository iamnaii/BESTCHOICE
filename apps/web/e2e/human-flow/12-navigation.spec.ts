import { test, expect } from '@playwright/test';
import { loginViaAPI, logout } from '../helpers/auth';
import { StepScreenshot } from '../helpers/screenshot';

/**
 * 12 - Navigation Flow (Human-Like Interaction)
 *
 * ทดสอบ Sidebar navigation ทุกเมนู, protected routes, role-based access, redirect
 * Selectors จาก: src/App.tsx, src/components/layout/MainLayout.tsx
 *
 * Protected routes ที่ต้อง login:
 * /, /pos, /customers, /contracts, /payments, /stock, /overdue, /reports, /settings, /users, /branches
 *
 * Role-based routes:
 * - OWNER only: /settings, /users, /branches, /audit-logs, /system-status, /migration
 * - OWNER + BRANCH_MANAGER: /stock/transfers, /stock/alerts, /purchase-orders, /exchange, /repossessions
 * - OWNER + BRANCH_MANAGER + ACCOUNTANT: /reports, /receipts, /slip-review, /financial-audit
 */
test.describe('12 - Navigation Flow', () => {
  test.describe.configure({ mode: 'serial' });

  test('should redirect to login for unauthenticated users', async ({ page }) => {
    const ss = new StepScreenshot(page, '12-nav-auth-redirect');

    // Step 1: ลองเข้าหน้า Dashboard โดยไม่ login
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await ss.capture('tried-dashboard-without-login');

    // Step 2: รอ redirect
    await page.waitForTimeout(2000);
    await ss.capture('after-redirect');

    // Step 3: ตรวจสอบว่า redirect ไป login หรือ landing
    const url = page.url();
    const isOnLoginOrLanding = url.includes('/login') || url.includes('/landing');
    expect(isOnLoginOrLanding).toBe(true);
    await ss.capture('redirected-to-login');
  });

  test('should navigate to all main routes', async ({ page }) => {
    const ss = new StepScreenshot(page, '12-nav-main-routes');

    // Step 1: Login
    await loginViaAPI(page);
    await ss.capture('logged-in');

    // Step 2: ทดสอบ navigate ไปทุก route หลัก
    const mainRoutes = [
      { path: '/', name: 'dashboard' },
      { path: '/pos', name: 'pos' },
      { path: '/customers', name: 'customers' },
      { path: '/contracts', name: 'contracts' },
      { path: '/payments', name: 'payments' },
      { path: '/stock', name: 'stock' },
      { path: '/overdue', name: 'overdue' },
    ];

    for (const route of mainRoutes) {
      await page.goto(route.path, { waitUntil: 'domcontentloaded' });
      await ss.capture(`navigated-to-${route.name}`);

      // ตรวจสอบว่าไม่ redirect กลับ login
      await expect(page).toHaveURL(route.path);

      // ตรวจสอบว่าไม่มี error toast
      await expect(page.locator('[data-sonner-toast][data-type="error"]')).not.toBeVisible();
      await ss.capture(`${route.name}-no-error`);
    }
  });

  test('should navigate to OWNER-only routes', async ({ page }) => {
    const ss = new StepScreenshot(page, '12-nav-owner-routes');

    // Step 1: Login as admin (OWNER role)
    await loginViaAPI(page);
    await ss.capture('logged-in-as-owner');

    // Step 2: ทดสอบ OWNER-only routes
    const ownerRoutes = [
      { path: '/settings', name: 'settings' },
      { path: '/users', name: 'users' },
      { path: '/branches', name: 'branches' },
      { path: '/audit-logs', name: 'audit-logs' },
      { path: '/system-status', name: 'system-status' },
    ];

    for (const route of ownerRoutes) {
      await page.goto(route.path, { waitUntil: 'domcontentloaded' });
      await ss.capture(`owner-route-${route.name}`);

      // ตรวจสอบว่า OWNER สามารถเข้าได้
      await expect(page).toHaveURL(route.path);
      await ss.capture(`${route.name}-accessible`);
    }
  });

  test('should navigate to financial routes', async ({ page }) => {
    const ss = new StepScreenshot(page, '12-nav-financial-routes');

    // Step 1: Login
    await loginViaAPI(page);
    await ss.capture('logged-in');

    // Step 2: ทดสอบ financial routes
    const financialRoutes = [
      { path: '/reports', name: 'reports' },
      { path: '/receipts', name: 'receipts' },
      { path: '/slip-review', name: 'slip-review' },
      { path: '/financial-audit', name: 'financial-audit' },
    ];

    for (const route of financialRoutes) {
      await page.goto(route.path, { waitUntil: 'domcontentloaded' });
      await ss.capture(`financial-route-${route.name}`);
      await expect(page).toHaveURL(route.path);
      await ss.capture(`${route.name}-accessible`);
    }
  });

  test('should navigate to inventory routes', async ({ page }) => {
    const ss = new StepScreenshot(page, '12-nav-inventory-routes');

    // Step 1: Login
    await loginViaAPI(page);
    await ss.capture('logged-in');

    // Step 2: ทดสอบ inventory routes
    const inventoryRoutes = [
      { path: '/stock', name: 'stock' },
      { path: '/stock/transfers', name: 'stock-transfers' },
      { path: '/stock/alerts', name: 'stock-alerts' },
      { path: '/stock/adjustments', name: 'stock-adjustments' },
      { path: '/stock/count', name: 'stock-count' },
      { path: '/purchase-orders', name: 'purchase-orders' },
      { path: '/suppliers', name: 'suppliers' },
    ];

    for (const route of inventoryRoutes) {
      await page.goto(route.path, { waitUntil: 'domcontentloaded' });
      await ss.capture(`inventory-route-${route.name}`);
      await expect(page).toHaveURL(route.path);
      await ss.capture(`${route.name}-accessible`);
    }
  });

  test('should navigate to additional feature routes', async ({ page }) => {
    const ss = new StepScreenshot(page, '12-nav-feature-routes');

    // Step 1: Login
    await loginViaAPI(page);
    await ss.capture('logged-in');

    // Step 2: ทดสอบ feature routes
    const featureRoutes = [
      { path: '/sales', name: 'sales-history' },
      { path: '/credit-checks', name: 'credit-checks' },
      { path: '/exchange', name: 'exchange' },
      { path: '/repossessions', name: 'repossessions' },
      { path: '/notifications', name: 'notifications' },
      { path: '/document-dashboard', name: 'document-dashboard' },
      { path: '/pdpa', name: 'pdpa' },
    ];

    for (const route of featureRoutes) {
      await page.goto(route.path, { waitUntil: 'domcontentloaded' });
      await ss.capture(`feature-route-${route.name}`);
      await expect(page).toHaveURL(route.path);
      await ss.capture(`${route.name}-accessible`);
    }
  });

  test('should redirect unknown routes to dashboard', async ({ page }) => {
    const ss = new StepScreenshot(page, '12-nav-unknown-route');

    // Step 1: Login
    await loginViaAPI(page);
    await ss.capture('logged-in');

    // Step 2: ลองเข้า route ที่ไม่มีอยู่
    await page.goto('/nonexistent-page', { waitUntil: 'domcontentloaded' });
    await ss.capture('tried-unknown-route');

    // Step 3: ตรวจสอบว่า redirect ไป dashboard (/)
    await expect(page).toHaveURL('/');
    await ss.capture('redirected-to-dashboard');
  });

  test('should allow public routes without login', async ({ page }) => {
    const ss = new StepScreenshot(page, '12-nav-public-routes');

    // Step 1: ทดสอบ public routes โดยไม่ login
    const publicRoutes = [
      { path: '/login', name: 'login' },
      { path: '/landing', name: 'landing' },
      { path: '/forgot-password', name: 'forgot-password' },
    ];

    for (const route of publicRoutes) {
      await page.goto(route.path, { waitUntil: 'domcontentloaded' });
      await ss.capture(`public-route-${route.name}`);
      await expect(page).toHaveURL(route.path);
      await ss.capture(`${route.name}-accessible-without-login`);
    }
  });

  test('should navigate via sidebar menu clicks', async ({ page }) => {
    const ss = new StepScreenshot(page, '12-nav-sidebar-clicks');

    // Step 1: Login
    await loginViaAPI(page);
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle');
    await ss.capture('on-dashboard');

    // Step 2: หา sidebar menu items และคลิก
    const menuTexts = [
      { text: 'POS', expectedUrl: '/pos' },
      { text: 'ลูกค้า', expectedUrl: '/customers' },
      { text: 'สัญญา', expectedUrl: '/contracts' },
      { text: 'ชำระเงิน', expectedUrl: '/payments' },
    ];

    for (const menu of menuTexts) {
      // หา link ใน sidebar
      const sidebarLink = page.locator(`aside a:has-text("${menu.text}"), nav a:has-text("${menu.text}")`).first();
      if (await sidebarLink.isVisible()) {
        await sidebarLink.click();
        await page.waitForURL(menu.expectedUrl, { timeout: 10000 });
        await ss.capture(`sidebar-${menu.text}-clicked`);
        await expect(page).toHaveURL(menu.expectedUrl);
        await ss.capture(`sidebar-${menu.text}-navigated`);
      }
    }
  });
});
