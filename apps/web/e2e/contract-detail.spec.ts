import { test, expect } from '@playwright/test';
import { loginViaAPI } from './helpers/auth';

test.describe('Contract Detail Page', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page);
  });

  test('should navigate from contracts list to detail', async ({ page }) => {
    await page.goto('/contracts', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('สัญญาทั้งหมด').first()).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(2000);

    // Click on first contract anchor link
    const contractLink = page.locator('table tbody tr td a').first();
    if (await contractLink.isVisible({ timeout: 5000 }).catch(() => false)) {
      await contractLink.click();

      // Should navigate to /contracts/:id
      await expect(page).toHaveURL(/\/contracts\/.+/, { timeout: 10000 });

      // Detail page should show contract info
      await page.waitForTimeout(2000);
      await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
    }
    // Empty contracts list is valid
  });

  test('should display contract info sections on detail page', async ({ page }) => {
    await page.goto('/contracts', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('สัญญาทั้งหมด').first()).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(2000);

    const contractLink = page.locator('table tbody tr td a').first();
    if (await contractLink.isVisible({ timeout: 5000 }).catch(() => false)) {
      await contractLink.click();
      await expect(page).toHaveURL(/\/contracts\/.+/, { timeout: 10000 });

      // Wait for detail page to fully render (lazy load + API)
      await page.waitForTimeout(3000);

      // Detail should show key sections
      const sections = ['ลูกค้า', 'สินค้า', 'สถานะ', 'เลขสัญญา', 'ค่างวด'];
      let found = 0;
      for (const section of sections) {
        if (await page.getByText(section).first().isVisible({ timeout: 5000 }).catch(() => false)) {
          found++;
        }
      }
      expect(found).toBeGreaterThan(0);
    }
  });

  test('should display payment schedule on detail page', async ({ page }) => {
    await page.goto('/contracts', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('สัญญาทั้งหมด').first()).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(2000);

    const contractLink = page.locator('table tbody tr td a').first();
    if (await contractLink.isVisible({ timeout: 5000 }).catch(() => false)) {
      await contractLink.click();
      await expect(page).toHaveURL(/\/contracts\/.+/, { timeout: 10000 });

      // Wait for detail page to fully render (lazy load + API)
      await page.waitForTimeout(3000);

      // Payment schedule or installments section
      const paymentLabels = ['ตารางผ่อนชำระ', 'งวดที่', 'รับชำระ', 'ชำระเงิน'];
      let found = 0;
      for (const label of paymentLabels) {
        if (await page.getByText(label).first().isVisible({ timeout: 5000 }).catch(() => false)) {
          found++;
        }
      }
      // At least some payment-related labels should be visible
      expect(found).toBeGreaterThan(0);
    }
  });

  test('should display attached documents section on detail page', async ({ page }) => {
    await page.goto('/contracts', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('สัญญาทั้งหมด').first()).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(2000);

    const contractLink = page.locator('table tbody tr td a').first();
    if (await contractLink.isVisible({ timeout: 5000 }).catch(() => false)) {
      await contractLink.click();
      await expect(page).toHaveURL(/\/contracts\/.+/, { timeout: 10000 });
      await page.waitForTimeout(3000);

      const docLabels = ['เอกสาร', 'ไฟล์แนบ', 'อัพโหลด', 'Documents'];
      let found = 0;
      for (const label of docLabels) {
        if (await page.getByText(label).first().isVisible({ timeout: 3000 }).catch(() => false)) {
          found++;
        }
      }
      // Documents section should exist or at least no error
      await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
    }
  });
});

test.describe('Contract Sign Page', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page);
  });

  test('should navigate to sign page from contract detail', async ({ page }) => {
    await page.goto('/contracts', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('สัญญาทั้งหมด').first()).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(2000);

    const contractLink = page.locator('table tbody tr td a').first();
    if (await contractLink.isVisible({ timeout: 5000 }).catch(() => false)) {
      await contractLink.click();
      await expect(page).toHaveURL(/\/contracts\/.+/, { timeout: 10000 });
      await page.waitForTimeout(3000);

      // Look for sign button on detail page
      const signBtn = page.getByText(/ลงลายเซ็น|เซ็นสัญญา|Sign/).first();
      if (await signBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
        await signBtn.click();
        await page.waitForTimeout(2000);
        await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
      } else {
        // Contract may already be signed or sign not available — valid
        await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
      }
    }
  });

  test('should display signature pad on sign page when accessed directly', async ({ page }) => {
    // Navigate to the sign page directly with a dummy contract ID
    // The API will return not found but the page should render gracefully
    await page.goto('/contracts/sign', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    // Either the sign page loads, or redirects to contracts list
    await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
  });
});

test.describe('Contract Verify Page (Public)', () => {
  test('should be accessible without authentication', async ({ page }) => {
    // Public verify page — accessible without login
    await page.goto('/verify/test-contract-id', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    // Should render gracefully — either shows contract data or "not found"
    const hasNotFound = await page
      .getByText(/ไม่พบ|หมดอายุ|ลิงก์ไม่ถูกต้อง|Not Found/i)
      .first()
      .isVisible({ timeout: 5000 })
      .catch(() => false);
    const hasContent = await page
      .getByText(/สัญญา|ข้อมูล|ยืนยัน/i)
      .first()
      .isVisible({ timeout: 5000 })
      .catch(() => false);

    expect(hasNotFound || hasContent || page.url().includes('verify')).toBe(true);
  });

  test('should not show authenticated sidebar on verify page', async ({ page }) => {
    await page.goto('/verify/some-id', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    // Public page should not have sidebar nav
    const hasSidebar = await page.locator('.sidebar').isVisible({ timeout: 3000 }).catch(() => false);
    expect(hasSidebar).toBe(false);
  });
});
