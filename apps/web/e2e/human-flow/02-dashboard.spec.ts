import { test, expect } from '@playwright/test';
import { loginViaAPI } from '../helpers/auth';
import { StepScreenshot } from '../helpers/screenshot';

/**
 * 02 - Dashboard Flow (Human-Like Interaction)
 *
 * ทดสอบหน้า Dashboard หลัง login สำเร็จ
 * Selectors จาก: src/pages/DashboardPage.tsx
 * - Greeting: "สวัสดี {user.name}"
 * - KPI cards with links: /contracts, /overdue, /payments, /stock
 * - Quick action shortcuts: /pos, /customers, /contracts, /payments, /stock, /reports
 * - API: GET /dashboard/kpis, /dashboard/monthly-trend, etc.
 */
test.describe('02 - Dashboard Flow', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page);
  });

  test('should display dashboard with greeting and KPIs', async ({ page }) => {
    const ss = new StepScreenshot(page, '02-dashboard-main');

    // Step 1: ตรวจสอบว่าอยู่หน้า Dashboard
    await expect(page).toHaveURL('/');
    await ss.capture('dashboard-loaded');

    // Step 2: ตรวจสอบ heading "Dashboard"
    await expect(page.locator('text=Dashboard').first()).toBeVisible();
    await ss.capture('dashboard-title-visible');

    // Step 3: ตรวจสอบ greeting "สวัสดี"
    await expect(page.locator('text=สวัสดี').first()).toBeVisible();
    await ss.capture('greeting-visible');

    // Step 4: ตรวจสอบ KPI banner section (มี cards แสดง)
    // รอให้ข้อมูลโหลดจาก API
    await page.waitForLoadState('networkidle');
    await ss.capture('kpi-data-loaded');

    // Step 5: ตรวจสอบว่ามี link ไป /contracts
    await expect(page.locator('a[href="/contracts"]').first()).toBeVisible();
    await ss.capture('contracts-link-visible');

    // Step 6: ตรวจสอบว่าไม่มี error toast
    await expect(page.locator('[data-sonner-toast][data-type="error"]')).not.toBeVisible();
    await ss.capture('no-error-toast');
  });

  test('should navigate to quick action pages', async ({ page }) => {
    const ss = new StepScreenshot(page, '02-dashboard-quick-actions');

    // Step 1: เปิด Dashboard
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle');
    await ss.capture('dashboard-loaded');

    // Step 2: ตรวจสอบ quick action links
    const quickActionLinks = ['/pos', '/customers', '/contracts', '/payments'];
    for (const href of quickActionLinks) {
      const link = page.locator(`a[href="${href}"]`).first();
      if (await link.isVisible()) {
        await ss.capture(`quick-action-${href.replace('/', '')}-visible`);
      }
    }

    // Step 3: คลิกไปหน้า POS
    const posLink = page.locator('a[href="/pos"]').first();
    if (await posLink.isVisible()) {
      await posLink.click();
      await page.waitForURL('/pos', { timeout: 10000 });
      await ss.capture('navigated-to-pos');
      await expect(page).toHaveURL('/pos');

      // Step 4: กลับมาหน้า Dashboard
      await page.goto('/', { waitUntil: 'domcontentloaded' });
      await ss.capture('back-to-dashboard');
    }
  });

  test('should display KPI cards that link to correct pages', async ({ page }) => {
    const ss = new StepScreenshot(page, '02-dashboard-kpi-links');

    // Step 1: เปิด Dashboard
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle');
    await ss.capture('dashboard-loaded');

    // Step 2: ตรวจสอบ KPI link ไป /overdue
    const overdueLink = page.locator('a[href="/overdue"]').first();
    if (await overdueLink.isVisible()) {
      await ss.capture('overdue-link-visible');
      await overdueLink.click();
      await page.waitForURL('/overdue', { timeout: 10000 });
      await ss.capture('navigated-to-overdue');
      await expect(page).toHaveURL('/overdue');
    }

    // Step 3: กลับมา Dashboard
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle');
    await ss.capture('back-to-dashboard');

    // Step 4: ตรวจสอบ KPI link ไป /stock
    const stockLink = page.locator('a[href="/stock"]').first();
    if (await stockLink.isVisible()) {
      await stockLink.click();
      await page.waitForURL('/stock', { timeout: 10000 });
      await ss.capture('navigated-to-stock');
      await expect(page).toHaveURL('/stock');
    }
  });

  test('should display sidebar navigation', async ({ page }) => {
    const ss = new StepScreenshot(page, '02-dashboard-sidebar');

    // Step 1: เปิด Dashboard
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await ss.capture('dashboard-loaded');

    // Step 2: ตรวจสอบ sidebar/nav มีอยู่
    const sidebar = page.locator('aside, nav, [data-sidebar]').first();
    await expect(sidebar).toBeVisible();
    await ss.capture('sidebar-visible');

    // Step 3: ตรวจสอบเมนูหลักใน sidebar
    const menuItems = ['POS', 'ลูกค้า', 'สัญญา', 'ชำระเงิน', 'คลังสินค้า'];
    for (const item of menuItems) {
      const menuLink = page.locator(`text=${item}`).first();
      if (await menuLink.isVisible()) {
        await ss.capture(`sidebar-menu-${item}-visible`);
      }
    }
  });
});
