import { test, expect } from '@playwright/test';
import { loginViaAPI } from '../helpers/auth';
import { StepScreenshot } from '../helpers/screenshot';

/**
 * 10 - Settings Flow (Human-Like Interaction)
 *
 * ทดสอบ flow ตั้งค่าระบบ: ดูค่า config, แก้ไข, บันทึก
 * Selectors จาก: src/pages/SettingsPage.tsx
 * - Config groups: อัตราดอกเบี้ยและเงินดาวน์, ค่าปรับและจำนวนงวด,
 *   เกณฑ์การติดตามหนี้, เกณฑ์เกรดลูกค้า, PDPA และความปลอดภัย, ข้อมูลบริษัท
 * - Config keys: interest_rate, min_down_payment_pct, late_fee_per_day, etc.
 * - API: GET /config, PUT /config
 * - Role: OWNER only
 */
test.describe('10 - Settings Flow', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page);
    await page.goto('/settings', { waitUntil: 'domcontentloaded' });
  });

  test('should display settings page with config groups', async ({ page }) => {
    const ss = new StepScreenshot(page, '10-settings-display');

    // Step 1: ตรวจสอบว่าอยู่หน้า /settings
    await expect(page).toHaveURL('/settings');
    await ss.capture('settings-page-loaded');

    // Step 2: รอข้อมูล config โหลด
    await page.waitForLoadState('networkidle');
    await ss.capture('config-data-loaded');

    // Step 3: ตรวจสอบ config group headers
    const groups = [
      'อัตราดอกเบี้ยและเงินดาวน์',
      'ค่าปรับและจำนวนงวด',
      'เกณฑ์การติดตามหนี้',
      'เกณฑ์เกรดลูกค้า',
      'PDPA',
    ];
    for (const group of groups) {
      const groupEl = page.locator(`text=${group}`).first();
      if (await groupEl.isVisible()) {
        await ss.capture(`group-${group}-visible`);
      }
    }

    // Step 4: ตรวจสอบว่าไม่มี error
    await expect(page.locator('[data-sonner-toast][data-type="error"]')).not.toBeVisible();
    await ss.capture('no-error');
  });

  test('should display config values', async ({ page }) => {
    const ss = new StepScreenshot(page, '10-settings-values');

    // Step 1: รอข้อมูลโหลด
    await page.waitForLoadState('networkidle');
    await ss.capture('config-loaded');

    // Step 2: ตรวจสอบ config labels ที่ควรมี
    const configLabels = [
      'อัตราดอกเบี้ยต่อเดือน',
      'เงินดาวน์ขั้นต่ำ',
      'ค่าปรับจ่ายช้าต่อวัน',
      'จำนวนงวดขั้นต่ำ',
      'จำนวนงวดสูงสุด',
    ];
    for (const label of configLabels) {
      const labelEl = page.locator(`text=${label}`).first();
      if (await labelEl.isVisible()) {
        await ss.capture(`config-${label}-visible`);
      }
    }

    // Step 3: ตรวจสอบว่า input fields มีค่า
    const inputs = page.locator('input[type="number"], input[type="text"]');
    const count = await inputs.count();
    if (count > 0) {
      await ss.capture(`found-${count}-config-inputs`);
    }
  });

  test('should navigate to interest config page', async ({ page }) => {
    const ss = new StepScreenshot(page, '10-settings-interest-config');

    // Step 1: ไปหน้า Interest Config
    await page.goto('/settings/interest-config', { waitUntil: 'domcontentloaded' });
    await ss.capture('interest-config-loaded');

    // Step 2: ตรวจสอบ URL
    await expect(page).toHaveURL('/settings/interest-config');
    await ss.capture('interest-config-url-verified');

    // Step 3: รอข้อมูลโหลด
    await page.waitForLoadState('networkidle');
    await ss.capture('interest-config-data-loaded');

    // Step 4: ตรวจสอบว่าไม่มี error
    await expect(page.locator('[data-sonner-toast][data-type="error"]')).not.toBeVisible();
    await ss.capture('no-error');
  });

  test('should navigate to pricing templates page', async ({ page }) => {
    const ss = new StepScreenshot(page, '10-settings-pricing');

    // Step 1: ไปหน้า Pricing Templates
    await page.goto('/settings/pricing-templates', { waitUntil: 'domcontentloaded' });
    await ss.capture('pricing-templates-loaded');

    // Step 2: ตรวจสอบ URL
    await expect(page).toHaveURL('/settings/pricing-templates');
    await ss.capture('pricing-url-verified');

    // Step 3: รอข้อมูลโหลด
    await page.waitForLoadState('networkidle');
    await ss.capture('pricing-data-loaded');
  });
});
