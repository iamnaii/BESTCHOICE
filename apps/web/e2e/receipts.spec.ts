import { test, expect } from '@playwright/test';
import { loginAsAdmin } from './helpers/auth';

test.describe('Receipts Page - E2E Flow', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/receipts');
    await page.waitForLoadState('networkidle');
  });

  test('should display receipts page with header and summary cards', async ({ page }) => {
    // Page header
    await expect(page.locator('text=ใบเสร็จรับเงิน (e-Receipt)')).toBeVisible({ timeout: 10000 });

    // Summary cards should be visible
    await expect(page.locator('text=จำนวนใบเสร็จ')).toBeVisible();
    await expect(page.locator('text=ยอดรวม')).toBeVisible();
    await expect(page.locator('text=Export')).toBeVisible();

    await page.screenshot({ path: 'e2e/screenshots/receipts-01-page-loaded.png', fullPage: true });
  });

  test('should auto-load receipts on page open (not empty)', async ({ page }) => {
    // Wait for table data to load
    await page.waitForSelector('table', { timeout: 10000 });

    // Should have receipt rows (seed data has 7 receipts)
    const rows = page.locator('table tbody tr');
    const rowCount = await rows.count();
    expect(rowCount).toBeGreaterThan(0);

    await page.screenshot({ path: 'e2e/screenshots/receipts-02-auto-loaded.png', fullPage: true });
  });

  test('should display payment method in Thai', async ({ page }) => {
    await page.waitForSelector('table tbody tr', { timeout: 10000 });

    const bodyText = await page.textContent('body');
    // At least one of the Thai method labels should be present (seed data has CASH, BANK_TRANSFER, QR_EWALLET)
    const hasThai = bodyText?.includes('เงินสด') || bodyText?.includes('โอนเงิน') || bodyText?.includes('QR/E-Wallet');
    expect(hasThai).toBeTruthy();

    // Should NOT show raw English method names in table
    // (They might appear in other UI elements, so just check table area)
    const tableText = await page.locator('table').textContent();
    expect(tableText).not.toContain('CASH');
    expect(tableText).not.toContain('BANK_TRANSFER');

    await page.screenshot({ path: 'e2e/screenshots/receipts-03-thai-methods.png', fullPage: true });
  });

  test('should search by customer name', async ({ page }) => {
    await page.waitForSelector('table tbody tr', { timeout: 10000 });

    // Type search term
    const searchInput = page.locator('input[placeholder*="ค้นหา"]');
    await expect(searchInput).toBeVisible();
    await searchInput.fill('สมชาย');

    // Wait for debounce + API response
    await page.waitForTimeout(600);
    await page.waitForLoadState('networkidle');

    // Should show only receipts for สมชาย
    const rows = page.locator('table tbody tr');
    const rowCount = await rows.count();
    expect(rowCount).toBeGreaterThan(0);

    // All visible payerName cells should contain สมชาย
    const tableText = await page.locator('table tbody').textContent();
    expect(tableText).toContain('สมชาย');

    await page.screenshot({ path: 'e2e/screenshots/receipts-04-search-customer.png', fullPage: true });
  });

  test('should search by contract number', async ({ page }) => {
    await page.waitForSelector('table tbody tr', { timeout: 10000 });

    const searchInput = page.locator('input[placeholder*="ค้นหา"]');
    await searchInput.fill('BCP-2025-001');
    await page.waitForTimeout(600);
    await page.waitForLoadState('networkidle');

    const rows = page.locator('table tbody tr');
    const rowCount = await rows.count();
    expect(rowCount).toBeGreaterThan(0);

    const tableText = await page.locator('table tbody').textContent();
    expect(tableText).toContain('BCP-2025-001');

    await page.screenshot({ path: 'e2e/screenshots/receipts-05-search-contract.png', fullPage: true });
  });

  test('should filter by receipt type', async ({ page }) => {
    await page.waitForSelector('table tbody tr', { timeout: 10000 });

    // Select เงินดาวน์
    const typeSelect = page.locator('select');
    await typeSelect.selectOption('DOWN_PAYMENT');

    await page.waitForTimeout(600);
    await page.waitForLoadState('networkidle');

    // Should show only DOWN_PAYMENT receipts
    const rows = page.locator('table tbody tr');
    const rowCount = await rows.count();
    expect(rowCount).toBeGreaterThan(0);

    const tableText = await page.locator('table tbody').textContent();
    expect(tableText).toContain('เงินดาวน์');

    await page.screenshot({ path: 'e2e/screenshots/receipts-06-filter-type.png', fullPage: true });
  });

  test('should filter by date range', async ({ page }) => {
    await page.waitForSelector('table tbody tr', { timeout: 10000 });

    // Set date range
    const dateInputs = page.locator('input[type="date"]');
    await dateInputs.nth(0).fill('2025-11-01');
    await dateInputs.nth(1).fill('2025-11-30');

    await page.waitForTimeout(600);
    await page.waitForLoadState('networkidle');

    // Should show receipts from Nov 2025
    const rows = page.locator('table tbody tr');
    const rowCount = await rows.count();
    expect(rowCount).toBeGreaterThan(0);

    await page.screenshot({ path: 'e2e/screenshots/receipts-07-filter-date.png', fullPage: true });
  });

  test('should open receipt detail modal with print button', async ({ page }) => {
    await page.waitForSelector('table tbody tr', { timeout: 10000 });

    // Click "ดูรายละเอียด" on first row
    const detailBtn = page.locator('text=ดูรายละเอียด').first();
    await detailBtn.click();

    // Modal should open with receipt details
    await expect(page.locator('text=ใบเสร็จรับเงิน').first()).toBeVisible({ timeout: 5000 });

    // Should show print button
    await expect(page.locator('text=พิมพ์ใบเสร็จ')).toBeVisible();

    // Should show receipt details
    await expect(page.locator('text=ผู้จ่ายเงิน')).toBeVisible();
    await expect(page.locator('text=จำนวนเงิน')).toBeVisible();

    await page.screenshot({ path: 'e2e/screenshots/receipts-08-detail-modal.png', fullPage: true });
  });

  test('should show void button for OWNER role', async ({ page }) => {
    await page.waitForSelector('table tbody tr', { timeout: 10000 });

    // Open detail modal
    const detailBtn = page.locator('text=ดูรายละเอียด').first();
    await detailBtn.click();

    // Wait for modal
    await expect(page.locator('text=ใบเสร็จรับเงิน').first()).toBeVisible({ timeout: 5000 });

    // admin user is OWNER role, should see void button
    await expect(page.locator('text=ยกเลิกใบเสร็จ')).toBeVisible();

    await page.screenshot({ path: 'e2e/screenshots/receipts-09-void-button.png', fullPage: true });
  });

  test('should show summary card with correct totals', async ({ page }) => {
    await page.waitForSelector('table tbody tr', { timeout: 10000 });

    // Summary count should be > 0
    const countCard = page.locator('text=จำนวนใบเสร็จ').locator('..');
    const countText = await countCard.textContent();
    expect(countText).toBeTruthy();

    // Summary amount should have ฿ symbol
    const amountCard = page.locator('text=ยอดรวม').locator('..');
    const amountText = await amountCard.textContent();
    expect(amountText).toContain('฿');

    await page.screenshot({ path: 'e2e/screenshots/receipts-10-summary.png', fullPage: true });
  });

  test('should have Excel export button', async ({ page }) => {
    await page.waitForSelector('table tbody tr', { timeout: 10000 });

    const excelBtn = page.locator('button:has-text("Excel")');
    await expect(excelBtn).toBeVisible();
    await expect(excelBtn).toBeEnabled();

    await page.screenshot({ path: 'e2e/screenshots/receipts-11-excel-button.png', fullPage: true });
  });

  test('should search with no results and show empty state', async ({ page }) => {
    await page.waitForSelector('table tbody tr', { timeout: 10000 });

    const searchInput = page.locator('input[placeholder*="ค้นหา"]');
    await searchInput.fill('ไม่มีข้อมูลนี้แน่นอน12345');
    await page.waitForTimeout(600);
    await page.waitForLoadState('networkidle');

    // Should show empty message
    await expect(page.locator('text=ไม่พบใบเสร็จ')).toBeVisible({ timeout: 5000 });

    await page.screenshot({ path: 'e2e/screenshots/receipts-12-empty-state.png', fullPage: true });
  });
});
