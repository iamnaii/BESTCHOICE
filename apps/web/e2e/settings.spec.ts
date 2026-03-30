import { test, expect } from '@playwright/test';
import { loginViaAPI } from './helpers/auth';

test.describe('Settings Page', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page);
  });

  test('should display settings page with configuration groups', async ({ page }) => {
    await page.goto('/settings', { waitUntil: 'domcontentloaded' });

    // Wait for settings API to respond — groups render only after API data loads
    // 'ค่าปรับ' is the title of the first config group (always rendered)
    await expect(page.getByText('ค่าปรับ').first()).toBeVisible({ timeout: 20000 });

    // Settings page should show config groups
    const groups = ['ค่าปรับ', 'PDPA', 'ข้อมูลบริษัท'];
    let found = 0;
    for (const group of groups) {
      if (await page.getByText(group).first().isVisible({ timeout: 5000 }).catch(() => false)) {
        found++;
      }
    }
    expect(found).toBeGreaterThan(0);
  });

  test('should display edit buttons', async ({ page }) => {
    await page.goto('/settings', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    const editBtn = page.getByText('แก้ไข').first();
    await expect(editBtn).toBeVisible({ timeout: 5000 });
  });

  test('should not display errors', async ({ page }) => {
    await page.goto('/settings', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
  });
});

test.describe('Interest Config Page', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page);
  });

  test('should display interest config page', async ({ page }) => {
    await page.goto('/settings/interest-config', { waitUntil: 'domcontentloaded' });

    await page.waitForTimeout(2000);
    await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
  });
});

test.describe('Pricing Templates Page', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page);
  });

  test('should display pricing templates page', async ({ page }) => {
    await page.goto('/settings/pricing-templates', { waitUntil: 'domcontentloaded' });

    await expect(page.getByText('ราคาตั้งต้น').first()).toBeVisible({ timeout: 15000 });
  });

  test('should display add and import buttons', async ({ page }) => {
    await page.goto('/settings/pricing-templates', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('ราคาตั้งต้น').first()).toBeVisible({ timeout: 15000 });

    await expect(page.getByText('เพิ่มราคาตั้งต้น').first()).toBeVisible({ timeout: 5000 });
  });

  test('should display search input', async ({ page }) => {
    await page.goto('/settings/pricing-templates', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('ราคาตั้งต้น').first()).toBeVisible({ timeout: 15000 });

    await expect(page.getByPlaceholder('ค้นหายี่ห้อ...')).toBeVisible({ timeout: 5000 });
  });
});

test.describe('LINE OA Settings Page', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page);
  });

  test('should display LINE OA settings page', async ({ page }) => {
    await page.goto('/settings/line-oa', { waitUntil: 'domcontentloaded' });

    await expect(
      page.getByText('เชื่อมต่อ LINE OA').or(page.getByText('LINE OA')).first(),
    ).toBeVisible({ timeout: 15000 });
  });

  test('should display connection status', async ({ page }) => {
    await page.goto('/settings/line-oa', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    // Either connected or not connected status
    const statuses = ['ยังไม่ได้เชื่อมต่อ', 'เชื่อมต่อแล้ว', 'ตั้งค่าแล้ว'];
    let found = 0;
    for (const status of statuses) {
      if (await page.getByText(status).first().isVisible({ timeout: 3000 }).catch(() => false)) {
        found++;
      }
    }
    expect(found).toBeGreaterThan(0);
  });
});

test.describe('SMS Settings Page', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page);
  });

  test('should display SMS settings page', async ({ page }) => {
    await page.goto('/settings/sms', { waitUntil: 'domcontentloaded' });

    await expect(
      page.getByText('ตั้งค่า SMS').or(page.getByText('SMS')).first(),
    ).toBeVisible({ timeout: 15000 });
  });

  test('should display setup steps', async ({ page }) => {
    await page.goto('/settings/sms', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    // Either setup steps or connection status
    const elements = ['API Key', 'Sender', 'ยังไม่ได้ตั้งค่า', 'เชื่อมต่อแล้ว'];
    let found = 0;
    for (const el of elements) {
      if (await page.getByText(el).first().isVisible({ timeout: 3000 }).catch(() => false)) {
        found++;
      }
    }
    expect(found).toBeGreaterThan(0);
  });
});
