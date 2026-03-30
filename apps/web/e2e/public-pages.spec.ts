import { test, expect } from '@playwright/test';

test.describe('Landing Page', () => {
  test('should display landing page without login', async ({ page }) => {
    await page.goto('/landing', { waitUntil: 'domcontentloaded' });

    // Hero section
    await expect(
      page.getByText('ร้านมือถือที่คุณไว้วางใจ').or(page.getByText('สินค้าคุณภาพ')).first(),
    ).toBeVisible({ timeout: 15000 });
  });

  test('should display hero buttons', async ({ page }) => {
    await page.goto('/landing', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    await expect(page.getByText('ดูสินค้าทั้งหมด').first()).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('ติดต่อเรา').first()).toBeVisible({ timeout: 5000 });
  });

  test('should display services section', async ({ page }) => {
    await page.goto('/landing', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    const services = ['สินค้ามีประกัน', 'ผ่อนชำระสบาย', 'ดูแลหลังการขาย'];
    let found = 0;
    for (const service of services) {
      if (await page.getByText(service).first().isVisible({ timeout: 3000 }).catch(() => false)) {
        found++;
      }
    }
    expect(found).toBeGreaterThan(0);
  });

  test('should display contact section', async ({ page }) => {
    await page.goto('/landing', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    // Scroll to bottom to check contact info
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1000);

    const contacts = ['โทรศัพท์', 'LINE', 'ที่ตั้งร้าน'];
    let found = 0;
    for (const contact of contacts) {
      if (await page.getByText(contact).first().isVisible({ timeout: 3000 }).catch(() => false)) {
        found++;
      }
    }
    expect(found).toBeGreaterThan(0);
  });

  test('should not display errors', async ({ page }) => {
    await page.goto('/landing', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
  });
});

test.describe('Forgot Password Page', () => {
  test('should display forgot password form', async ({ page }) => {
    await page.goto('/forgot-password', { waitUntil: 'domcontentloaded' });

    await expect(page.getByText('ลืมรหัสผ่าน').first()).toBeVisible({ timeout: 15000 });

    // Email input
    await expect(page.getByPlaceholder('email@example.com')).toBeVisible({ timeout: 5000 });

    // Submit button
    await expect(
      page.getByText('ส่งลิงก์รีเซ็ตรหัสผ่าน').first(),
    ).toBeVisible({ timeout: 5000 });
  });

  test('should display back to login link', async ({ page }) => {
    await page.goto('/forgot-password', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('ลืมรหัสผ่าน').first()).toBeVisible({ timeout: 15000 });

    await expect(
      page.getByText('กลับไปหน้าเข้าสู่ระบบ').first(),
    ).toBeVisible({ timeout: 5000 });
  });

  test('should not submit with empty email', async ({ page }) => {
    await page.goto('/forgot-password', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('ลืมรหัสผ่าน').first()).toBeVisible({ timeout: 15000 });

    await page.getByText('ส่งลิงก์รีเซ็ตรหัสผ่าน').first().click();

    // Should remain on the same page
    await expect(page).toHaveURL(/\/forgot-password/);
  });
});

test.describe('Reset Password Page', () => {
  test('should display reset password form or invalid link message', async ({ page }) => {
    // Navigate without a valid token — should show invalid link message
    await page.goto('/reset-password', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    // Either shows the form (with token) or invalid link message
    const hasForm = await page.getByText('ตั้งรหัสผ่านใหม่').isVisible({ timeout: 5000 }).catch(() => false);
    const hasError = await page.getByText('ลิงก์ไม่ถูกต้อง').isVisible({ timeout: 5000 }).catch(() => false);

    expect(hasForm || hasError).toBe(true);
  });
});
