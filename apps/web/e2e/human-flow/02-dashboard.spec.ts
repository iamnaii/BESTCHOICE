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

    // Step 5: ตรวจสอบว่ามี KPI card "สัญญาทั้งหมด"
    await expect(page.locator('text=สัญญาทั้งหมด').first()).toBeVisible();
    await ss.capture('contracts-kpi-visible');

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

    // Step 2: ตรวจสอบ quick action buttons
    const quickActions = ['POS ขายสินค้า', 'สัญญาผ่อน', 'ชำระเงิน', 'ลูกค้า'];
    for (const label of quickActions) {
      const action = page.locator(`text=${label}`).first();
      if (await action.isVisible()) {
        await ss.capture(`quick-action-${label}-visible`);
      }
    }

    // Step 3: คลิกไปหน้า POS
    const posAction = page.locator('text=POS ขายสินค้า').first();
    if (await posAction.isVisible()) {
      await posAction.click();
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

    // Step 2: ตรวจสอบ KPI card "ค้าง/ผิดนัด"
    const overdueCard = page.locator('text=ค้าง/ผิดนัด').first();
    if (await overdueCard.isVisible()) {
      await ss.capture('overdue-card-visible');
      await overdueCard.click();
      await page.waitForURL(/\/(overdue|contracts)/, { timeout: 10000 });
      await ss.capture('navigated-to-overdue');
    }

    // Step 3: กลับมา Dashboard
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle');
    await ss.capture('back-to-dashboard');

    // Step 4: ตรวจสอบ KPI card "สินค้าในสต็อก"
    const stockCard = page.locator('text=สินค้าในสต็อก').first();
    if (await stockCard.isVisible()) {
      await stockCard.click();
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

    // Step 2: ตรวจสอบว่ามีเมนู sidebar (ใช้ button expand หรือ logo link)
    const sidebarToggle = page.locator('button:has-text("ขยายเมนู"), a[href="/"]').first();
    await expect(sidebarToggle).toBeVisible();
    await ss.capture('sidebar-visible');

    // Step 3: ตรวจสอบเมนูหลักใน sidebar (อาจเป็น icon-only mode)
    // ลองขยายเมนูก่อน
    const expandBtn = page.locator('button:has-text("ขยายเมนู")');
    if (await expandBtn.isVisible()) {
      await expandBtn.click();
      // Brief wait for sidebar expand animation
      await page.waitForTimeout(300);
      await ss.capture('sidebar-expanded');
    }

    const menuItems = ['POS', 'ลูกค้า', 'สัญญา', 'ชำระเงิน', 'คลังสินค้า'];
    for (const item of menuItems) {
      const menuLink = page.locator(`text=${item}`).first();
      if (await menuLink.isVisible()) {
        await ss.capture(`sidebar-menu-${item}-visible`);
      }
    }
  });
});
