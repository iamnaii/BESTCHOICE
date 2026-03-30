import { test, expect } from '@playwright/test';
import { loginViaAPI } from './helpers/auth';

test.describe('Notifications Page', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page);
  });

  test('should display notifications page', async ({ page }) => {
    await page.goto('/notifications', { waitUntil: 'domcontentloaded' });

    await expect(page.getByText('แจ้งเตือน').first()).toBeVisible({ timeout: 15000 });
  });

  test('should display notification channels', async ({ page }) => {
    await page.goto('/notifications', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('แจ้งเตือน').first()).toBeVisible({ timeout: 15000 });

    const channels = ['LINE', 'SMS', 'ในระบบ'];
    let found = 0;
    for (const channel of channels) {
      if (await page.getByText(channel).first().isVisible({ timeout: 3000 }).catch(() => false)) {
        found++;
      }
    }
    expect(found).toBeGreaterThan(0);
  });

  test('should display action buttons', async ({ page }) => {
    await page.goto('/notifications', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('แจ้งเตือน').first()).toBeVisible({ timeout: 15000 });

    const buttons = ['ส่งเตือนก่อนครบกำหนด', 'ส่งทวงหนี้ค้างชำระ', 'ส่งการแจ้งเตือน'];
    let found = 0;
    for (const btn of buttons) {
      if (await page.getByText(btn).first().isVisible({ timeout: 3000 }).catch(() => false)) {
        found++;
      }
    }
    expect(found).toBeGreaterThan(0);
  });

  test('should not display errors', async ({ page }) => {
    await page.goto('/notifications', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
  });
});

test.describe('PDPA Page', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page);
  });

  test('should display PDPA page', async ({ page }) => {
    await page.goto('/pdpa', { waitUntil: 'domcontentloaded' });

    await page.waitForTimeout(2000);
    await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
  });
});
