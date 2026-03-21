import { test, expect } from '@playwright/test';
import { loginWithMock } from './helpers/mock-auth';

/** Mock settings data matching the ConfigItem[] shape expected by SettingsPage */
const mockSettings = [
  { id: '1', key: 'interest_rate', value: '2.5', label: 'อัตราดอกเบี้ยต่อเดือน (Flat rate)' },
  { id: '2', key: 'min_down_payment_pct', value: '20', label: 'เงินดาวน์ขั้นต่ำ (%)' },
  { id: '3', key: 'store_commission_pct', value: '0.10', label: 'ค่าคอมหน้าร้าน' },
  { id: '4', key: 'vat_pct', value: '0.07', label: 'VAT' },
  { id: '5', key: 'late_fee_per_day', value: '50', label: 'ค่าปรับจ่ายช้าต่อวัน (บาท)' },
  { id: '6', key: 'late_fee_cap', value: '500', label: 'ค่าปรับสูงสุดต่องวด (บาท)' },
  { id: '7', key: 'early_payoff_discount', value: '5', label: 'ส่วนลดปิดบัญชีก่อนกำหนด (%)' },
  { id: '8', key: 'min_installment_months', value: '3', label: 'จำนวนงวดขั้นต่ำ (เดือน)' },
  { id: '9', key: 'max_installment_months', value: '24', label: 'จำนวนงวดสูงสุด (เดือน)' },
  { id: '10', key: 'overdue_days_threshold', value: '7', label: 'จำนวนวันก่อนเปลี่ยนสถานะ OVERDUE' },
  { id: '11', key: 'default_consecutive_months', value: '3', label: 'จำนวนงวดค้างติดต่อกันก่อน DEFAULT' },
  { id: '12', key: 'grade_a_threshold', value: '90', label: 'เกณฑ์ Grade A (%)' },
  { id: '13', key: 'grade_b_threshold', value: '70', label: 'เกณฑ์ Grade B (%)' },
  { id: '14', key: 'grade_c_threshold', value: '50', label: 'เกณฑ์ Grade C (%)' },
  { id: '15', key: 'pdpa_privacy_notice_version', value: '1.0', label: 'เวอร์ชัน Privacy Notice (PDPA)' },
  { id: '16', key: 'customer_access_token_hours', value: '24', label: 'อายุ Link เอกสารลูกค้า (ชั่วโมง)' },
  { id: '17', key: 'lessor_signature_image', value: '', label: null },
  { id: '18', key: 'lessor_signer_name', value: '', label: null },
];

test.describe('Settings Page - UI Elements Audit', () => {
  test.beforeEach(async ({ page }) => {
    await loginWithMock(page);

    // Mock /api/settings to return full config array
    await page.route('**/api/settings', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(mockSettings),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true }),
        });
      }
    });

    // Mock interest-configs endpoint
    await page.route('**/api/interest-configs**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([]),
      });
    });

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
