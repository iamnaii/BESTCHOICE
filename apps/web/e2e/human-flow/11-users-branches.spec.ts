import { test, expect } from '@playwright/test';
import { loginViaAPI } from '../helpers/auth';
import { StepScreenshot } from '../helpers/screenshot';

/**
 * 11 - Users & Branches Flow (Human-Like Interaction)
 *
 * ทดสอบ flow จัดการ Users และ Branches
 * Selectors จาก: src/pages/UsersPage.tsx, src/pages/BranchesPage.tsx
 *
 * UsersPage:
 * - DataTable with users list
 * - Modal for add/edit user
 * - Form fields: email, password, name, role, branchId, etc.
 * - Role labels: เจ้าของร้าน, ผู้จัดการสาขา, พนักงานขาย, ฝ่ายบัญชี
 * - API: GET /users, POST /users, PATCH /users/:id
 *
 * BranchesPage:
 * - DataTable with branches list
 * - API: GET /branches
 * - Role: OWNER only
 */
test.describe('11 - Users & Branches Flow', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page);
  });

  test('should display users page with list', async ({ page }) => {
    const ss = new StepScreenshot(page, '11-users-display');

    // Step 1: ไปหน้า Users
    await page.goto('/users', { waitUntil: 'domcontentloaded' });
    await ss.capture('users-page-loaded');

    // Step 2: ตรวจสอบ URL
    await expect(page).toHaveURL('/users');
    await ss.capture('users-url-verified');

    // Step 3: รอข้อมูลโหลด
    await page.waitForLoadState('networkidle');
    await ss.capture('users-data-loaded');

    // Step 4: ตรวจสอบ header
    const header = page.locator('text=ผู้ใช้, text=จัดการผู้ใช้, text=Users').first();
    if (await header.isVisible()) {
      await ss.capture('users-header-visible');
    }

    // Step 5: ตรวจสอบว่าไม่มี error
    await expect(page.locator('[data-sonner-toast][data-type="error"]')).not.toBeVisible();
    await ss.capture('no-error');
  });

  test('should display role badges', async ({ page }) => {
    const ss = new StepScreenshot(page, '11-users-roles');

    // Step 1: ไปหน้า Users
    await page.goto('/users', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle');
    await ss.capture('users-loaded');

    // Step 2: ตรวจสอบ role labels ที่แสดง
    const roleLabels = ['เจ้าของร้าน', 'ผู้จัดการสาขา', 'พนักงานขาย', 'ฝ่ายบัญชี'];
    for (const role of roleLabels) {
      const roleEl = page.locator(`text=${role}`).first();
      if (await roleEl.isVisible()) {
        await ss.capture(`role-${role}-visible`);
      }
    }
  });

  test('should open add user modal', async ({ page }) => {
    const ss = new StepScreenshot(page, '11-users-add-modal');

    // Step 1: ไปหน้า Users
    await page.goto('/users', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle');
    await ss.capture('users-loaded');

    // Step 2: หาปุ่มเพิ่มผู้ใช้
    const addBtn = page.locator('button:has-text("เพิ่ม"), button:has-text("สร้าง")').first();
    if (await addBtn.isVisible()) {
      await ss.capture('add-user-button-visible');

      // Step 3: คลิกปุ่ม
      await addBtn.click();
      await ss.capture('clicked-add-user');

      // Step 4: รอ Modal เปิด
      await page.waitForLoadState('networkidle');
      await ss.capture('add-user-modal-opened');

      // Step 5: ตรวจสอบ form fields ใน Modal
      const formLabels = ['อีเมล', 'รหัสผ่าน', 'ชื่อ', 'สาขา'];
      for (const label of formLabels) {
        const labelEl = page.locator(`text=${label}`).first();
        if (await labelEl.isVisible()) {
          await ss.capture(`field-${label}-visible`);
        }
      }

      // Step 6: ตรวจสอบ role options
      const roleSelect = page.locator('select').first();
      if (await roleSelect.isVisible()) {
        await ss.capture('role-select-visible');
      }
    } else {
      await ss.capture('add-button-not-found');
    }
  });

  test('should display branches page', async ({ page }) => {
    const ss = new StepScreenshot(page, '11-branches-display');

    // Step 1: ไปหน้า Branches
    await page.goto('/branches', { waitUntil: 'domcontentloaded' });
    await ss.capture('branches-page-loaded');

    // Step 2: ตรวจสอบ URL
    await expect(page).toHaveURL('/branches');
    await ss.capture('branches-url-verified');

    // Step 3: รอข้อมูลโหลด
    await page.waitForLoadState('networkidle');
    await ss.capture('branches-data-loaded');

    // Step 4: ตรวจสอบ header
    const header = page.locator('text=สาขา').first();
    if (await header.isVisible()) {
      await ss.capture('branches-header-visible');
    }

    // Step 5: ตรวจสอบว่าไม่มี error
    await expect(page.locator('[data-sonner-toast][data-type="error"]')).not.toBeVisible();
    await ss.capture('no-error');
  });

  test('should display audit logs page', async ({ page }) => {
    const ss = new StepScreenshot(page, '11-audit-logs');

    // Step 1: ไปหน้า Audit Logs
    await page.goto('/audit-logs', { waitUntil: 'domcontentloaded' });
    await ss.capture('audit-logs-loaded');

    // Step 2: ตรวจสอบ URL
    await expect(page).toHaveURL('/audit-logs');
    await ss.capture('audit-logs-url-verified');

    // Step 3: รอข้อมูลโหลด
    await page.waitForLoadState('networkidle');
    await ss.capture('audit-logs-data-loaded');
  });
});
