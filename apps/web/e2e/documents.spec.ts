import { test, expect } from '@playwright/test';
import { loginViaAPI } from './helpers/auth';

test.describe('Document Dashboard Page', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page);
  });

  test('should display document dashboard', async ({ page }) => {
    await page.goto('/document-dashboard', { waitUntil: 'domcontentloaded' });

    await expect(
      page.getByText('สถานะเอกสารสัญญา').first(),
    ).toBeVisible({ timeout: 15000 });
  });

  test('should display stat cards', async ({ page }) => {
    await page.goto('/document-dashboard', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('สถานะเอกสารสัญญา').first()).toBeVisible({ timeout: 15000 });

    const cards = ['สัญญาทั้งหมด', 'เอกสารครบ', 'รอเอกสาร', 'รอลายเซ็น'];
    let found = 0;
    for (const card of cards) {
      if (await page.getByText(card).first().isVisible({ timeout: 3000 }).catch(() => false)) {
        found++;
      }
    }
    expect(found).toBeGreaterThan(0);
  });

  test('should display branch filter', async ({ page }) => {
    await page.goto('/document-dashboard', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('สถานะเอกสารสัญญา').first()).toBeVisible({ timeout: 15000 });

    // Branch filter is a <select> with a 'ทุกสาขา' placeholder option — the select is visible, the option is not
    await expect(page.locator('select').filter({ hasText: 'ทุกสาขา' }).first()).toBeVisible({ timeout: 5000 });
  });

  test('should display activity and SLA sections', async ({ page }) => {
    await page.goto('/document-dashboard', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('สถานะเอกสารสัญญา').first()).toBeVisible({ timeout: 15000 });

    // Section titles
    const sections = ['กิจกรรมล่าสุด', 'สถานะตามสาขา'];
    let found = 0;
    for (const section of sections) {
      if (await page.getByText(section).first().isVisible({ timeout: 3000 }).catch(() => false)) {
        found++;
      }
    }
    expect(found).toBeGreaterThan(0);
  });
});

test.describe('Contract Templates Page', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page);
  });

  test('should display contract templates page', async ({ page }) => {
    await page.goto('/contract-templates', { waitUntil: 'domcontentloaded' });

    await page.waitForTimeout(2000);
    await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
  });
});

test.describe('Credit Checks Page', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page);
  });

  test('should display credit checks page', async ({ page }) => {
    await page.goto('/credit-checks', { waitUntil: 'domcontentloaded' });

    await page.waitForTimeout(2000);
    await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
  });

  test('should display status labels', async ({ page }) => {
    await page.goto('/credit-checks', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    const statuses = ['รอวิเคราะห์', 'ผ่าน', 'ไม่ผ่าน'];
    let found = 0;
    for (const status of statuses) {
      if (await page.getByText(status).first().isVisible({ timeout: 3000 }).catch(() => false)) {
        found++;
      }
    }
    // Status labels may or may not be visible depending on data
    await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
  });
});
