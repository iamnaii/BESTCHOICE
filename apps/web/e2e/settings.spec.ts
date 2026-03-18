import { test, expect } from '@playwright/test';
import { loginAsAdmin } from './helpers/auth';

test.describe('Settings Page - UI Elements Audit', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/settings', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('text=ตั้งค่าระบบ', { timeout: 15000 });
  });

  test('should display page header and save button', async ({ page }) => {
    await expect(page.locator('text=ตั้งค่าระบบ')).toBeVisible();
    await expect(page.locator('text=กำหนดพารามิเตอร์การทำงานของระบบ')).toBeVisible();
    await expect(page.locator('button', { hasText: 'บันทึกการตั้งค่า' })).toBeVisible();
  });

  test('should display lessor signature section', async ({ page }) => {
    await expect(page.locator('text=ลายเซ็นผู้ให้เช่าซื้อ (บริษัท)')).toBeVisible();
  });

  test('should display card reader section', async ({ page }) => {
    await expect(page.locator('text=เครื่องอ่านบัตรประชาชน')).toBeVisible();
  });

  test('should display interest config link', async ({ page }) => {
    await expect(page.locator('button', { hasText: 'ตั้งค่าดอกเบี้ย' })).toBeVisible();
  });

  test('should display all config group titles', async ({ page }) => {
    const groups = [
      'อัตราดอกเบี้ยและเงินดาวน์',
      'ค่าปรับและจำนวนงวด',
      'เกณฑ์การติดตามหนี้',
      'เกณฑ์เกรดลูกค้า',
      'PDPA และความปลอดภัย',
    ];
    for (const title of groups) {
      await expect(page.locator(`text=${title}`)).toBeVisible();
    }
  });

  test('should display all config input fields', async ({ page }) => {
    const fields = [
      // Group 1: Interest & Down Payment
      'อัตราดอกเบี้ยต่อเดือน (Flat rate)',
      'เงินดาวน์ขั้นต่ำ (%)',
      'ค่าคอมหน้าร้าน',
      'VAT',
      // Group 2: Late Fees & Installments
      'ค่าปรับจ่ายช้าต่อวัน (บาท)',
      'ค่าปรับสูงสุดต่องวด (บาท)',
      'ส่วนลดปิดบัญชีก่อนกำหนด (%)',
      'จำนวนงวดขั้นต่ำ (เดือน)',
      'จำนวนงวดสูงสุด (เดือน)',
      // Group 3: Debt Collection
      'จำนวนวันก่อนเปลี่ยนสถานะ OVERDUE',
      'จำนวนงวดค้างติดต่อกันก่อน DEFAULT',
      // Group 4: Customer Grades
      'เกณฑ์ Grade A (%)',
      'เกณฑ์ Grade B (%)',
      'เกณฑ์ Grade C (%)',
      // Group 5: PDPA & Security (newly added)
      'เวอร์ชัน Privacy Notice (PDPA)',
      'อายุ Link เอกสารลูกค้า (ชั่วโมง)',
    ];
    for (const label of fields) {
      await expect(page.locator(`text=${label}`)).toBeVisible();
    }
  });

  test('should show unsaved changes indicator when editing', async ({ page }) => {
    const firstInput = page.locator('input[type="number"]').first();
    await firstInput.fill('999');
    await expect(page.locator('text=มีการเปลี่ยนแปลงที่ยังไม่ได้บันทึก')).toBeVisible();
  });
});
