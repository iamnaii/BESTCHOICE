import { test, expect } from '@playwright/test';
import { loginViaAPI } from './helpers/auth';

test.describe('Receipts Page', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page);
  });

  test('should display receipts page', async ({ page }) => {
    await page.goto('/receipts', { waitUntil: 'domcontentloaded' });

    await expect(
      page.getByText('ใบเสร็จรับเงิน').first(),
    ).toBeVisible({ timeout: 15000 });
  });

  test('should display search input', async ({ page }) => {
    await page.goto('/receipts', { waitUntil: 'domcontentloaded' });

    await expect(
      page.getByPlaceholder('ค้นหาเลขสัญญา / ชื่อลูกค้า / เบอร์โทร / เลขใบเสร็จ...'),
    ).toBeVisible({ timeout: 15000 });
  });

  test('should display summary cards', async ({ page }) => {
    await page.goto('/receipts', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('ใบเสร็จรับเงิน').first()).toBeVisible({ timeout: 15000 });

    await expect(page.getByText('จำนวนใบเสร็จ').first()).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('ยอดรวม').first()).toBeVisible({ timeout: 5000 });
  });

  test('should search receipts', async ({ page }) => {
    await page.goto('/receipts', { waitUntil: 'domcontentloaded' });

    const searchInput = page.getByPlaceholder('ค้นหาเลขสัญญา / ชื่อลูกค้า / เบอร์โทร / เลขใบเสร็จ...');
    await expect(searchInput).toBeVisible({ timeout: 15000 });

    await searchInput.fill('BCP');
    await page.waitForTimeout(500);

    await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
  });

  test('should filter receipts by type', async ({ page }) => {
    await page.goto('/receipts', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('ใบเสร็จรับเงิน').first()).toBeVisible({ timeout: 15000 });

    const typeFilter = page.locator('select').filter({
      has: page.locator('option:has-text("ทุกประเภท")'),
    }).first();

    if (await typeFilter.isVisible({ timeout: 5000 }).catch(() => false)) {
      await typeFilter.selectOption({ index: 1 });
      await page.waitForTimeout(500);
    }

    await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
  });
});

test.describe('Slip Review Page', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page);
  });

  test('should display slip review page', async ({ page }) => {
    await page.goto('/slip-review', { waitUntil: 'domcontentloaded' });

    await expect(
      page.getByText('ตรวจสอบสลิปชำระเงิน').first(),
    ).toBeVisible({ timeout: 15000 });
  });

  test('should display summary cards', async ({ page }) => {
    await page.goto('/slip-review', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('ตรวจสอบสลิปชำระเงิน').first()).toBeVisible({ timeout: 15000 });

    await expect(page.getByText('รอตรวจ').first()).toBeVisible({ timeout: 5000 });
  });

  test('should display status filter buttons', async ({ page }) => {
    await page.goto('/slip-review', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('ตรวจสอบสลิปชำระเงิน').first()).toBeVisible({ timeout: 15000 });

    const statuses = ['รอตรวจ', 'อนุมัติแล้ว', 'ปฏิเสธแล้ว'];
    let found = 0;
    for (const status of statuses) {
      if (await page.getByText(status).first().isVisible({ timeout: 3000 }).catch(() => false)) {
        found++;
      }
    }
    expect(found).toBeGreaterThan(0);
  });

  test('should search slips', async ({ page }) => {
    await page.goto('/slip-review', { waitUntil: 'domcontentloaded' });

    const searchInput = page.getByPlaceholder('ค้นหาชื่อลูกค้า / เลขสัญญา...');
    await expect(searchInput).toBeVisible({ timeout: 15000 });

    await searchInput.fill('test');
    await page.waitForTimeout(500);

    await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
  });
});
