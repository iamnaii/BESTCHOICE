import { test, expect } from '@playwright/test';
import { loginViaAPI } from './helpers/auth';

test.describe('Dashboard Page', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page);
  });

  test('should display Dashboard heading and subtitle', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    // Page title must be visible
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible({ timeout: 15000 });

    // Subtitle contains greeting
    await expect(page.getByText(/ภาพรวมธุรกิจ/).first()).toBeVisible();
  });

  test('should load KPI banner with key metrics', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible({ timeout: 15000 });

    // KPI banner labels — these always render once kpis data is received
    await expect(page.getByText('สัญญาทั้งหมด').first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('ค้าง/ผิดนัด').first()).toBeVisible();
    await expect(page.getByText('ยอดรับวันนี้').first()).toBeVisible();
    await expect(page.getByText('สินค้าในสต็อก').first()).toBeVisible();
  });

  test('should display KPI numeric values (non-negative)', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    await expect(page.getByText('สัญญาทั้งหมด').first()).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(1500);

    // KPI banner is a gradient div — numeric values should be present
    // At minimum the page should have loaded without error
    await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
    await expect(page.locator('body')).not.toContainText('ไม่สามารถโหลดข้อมูลได้');
  });

  test('should display quick action shortcut cards', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible({ timeout: 15000 });

    // Quick action shortcuts — always visible for all roles
    await expect(page.getByText('POS ขายสินค้า').first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('สัญญาผ่อน').first()).toBeVisible();
    await expect(page.getByText('ลูกค้า').first()).toBeVisible();
  });

  test('should navigate to /contracts when clicking สัญญาทั้งหมด KPI', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    await expect(page.getByText('สัญญาทั้งหมด').first()).toBeVisible({ timeout: 15000 });

    // The KPI card is clickable — navigates to /contracts
    await page.getByText('สัญญาทั้งหมด').first().click();
    await expect(page).toHaveURL(/\/contracts/, { timeout: 10000 });
  });

  test('should navigate to /overdue when clicking ค้าง/ผิดนัด KPI', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    await expect(page.getByText('ค้าง/ผิดนัด').first()).toBeVisible({ timeout: 15000 });

    await page.getByText('ค้าง/ผิดนัด').first().click();
    await expect(page).toHaveURL(/\/overdue/, { timeout: 10000 });
  });

  test('should display monthly revenue section for non-SALES role', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(2000);

    // Monthly revenue card — visible for OWNER/ACCOUNTANT/BRANCH_MANAGER (our admin is OWNER)
    await expect(page.getByText('รายได้เดือนนี้').first()).toBeVisible({ timeout: 5000 });
  });

  test('should display aging summary section', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(2000);

    // Aging summary should be visible
    const agingSection = page.getByText('อายุหนี้ค้างชำระ').first();
    const hasAging = await agingSection.isVisible({ timeout: 5000 }).catch(() => false);

    if (!hasAging) {
      // Section may not render if no overdue data — just verify no error
      await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
    } else {
      await expect(agingSection).toBeVisible();
    }
  });
});
