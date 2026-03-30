import { test, expect } from '@playwright/test';
import { loginViaAPI } from './helpers/auth';

test.describe('Exchange Page', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page);
  });

  test('should display exchange page', async ({ page }) => {
    await page.goto('/exchange', { waitUntil: 'domcontentloaded' });

    await expect(page.getByText('เปลี่ยนเครื่อง').first()).toBeVisible({ timeout: 15000 });
  });

  test('should display step indicators', async ({ page }) => {
    await page.goto('/exchange', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('เปลี่ยนเครื่อง').first()).toBeVisible({ timeout: 15000 });

    const steps = ['เลือกข้อมูล', 'ใบเสนอราคา', 'ยืนยัน', 'เสร็จสิ้น'];
    let found = 0;
    for (const step of steps) {
      if (await page.getByText(step).first().isVisible({ timeout: 3000 }).catch(() => false)) {
        found++;
      }
    }
    expect(found).toBeGreaterThan(0);
  });

  test('should display contract selection dropdown', async ({ page }) => {
    await page.goto('/exchange', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('เปลี่ยนเครื่อง').first()).toBeVisible({ timeout: 15000 });

    // Contract selection
    await expect(
      page.getByText('เลือกสัญญาเดิม').or(page.locator('select').first()).first(),
    ).toBeVisible({ timeout: 5000 });
  });

  test('should not display errors', async ({ page }) => {
    await page.goto('/exchange', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
  });
});

test.describe('Repossessions Page', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page);
  });

  test('should display repossessions page', async ({ page }) => {
    await page.goto('/repossessions', { waitUntil: 'domcontentloaded' });

    await expect(
      page.getByText('ยึดคืน').first(),
    ).toBeVisible({ timeout: 15000 });
  });

  test('should display add repossession button', async ({ page }) => {
    await page.goto('/repossessions', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('ยึดคืน').first()).toBeVisible({ timeout: 15000 });

    await expect(
      page.getByText('บันทึกการยึดคืน').first(),
    ).toBeVisible({ timeout: 5000 });
  });

  test('should display summary cards', async ({ page }) => {
    await page.goto('/repossessions', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('ยึดคืน').first()).toBeVisible({ timeout: 15000 });

    const cards = ['เครื่องที่ขายแล้ว', 'ราคาตีรวม', 'กำไร/ขาดทุน'];
    let found = 0;
    for (const card of cards) {
      if (await page.getByText(card).first().isVisible({ timeout: 3000 }).catch(() => false)) {
        found++;
      }
    }
    expect(found).toBeGreaterThan(0);
  });

  test('should filter by status', async ({ page }) => {
    await page.goto('/repossessions', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('ยึดคืน').first()).toBeVisible({ timeout: 15000 });

    const statusFilter = page.locator('select').filter({
      has: page.locator('option:has-text("ทุกสถานะ")'),
    }).first();

    if (await statusFilter.isVisible({ timeout: 5000 }).catch(() => false)) {
      await statusFilter.selectOption({ index: 1 });
      await page.waitForTimeout(500);
    }

    await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
  });
});
