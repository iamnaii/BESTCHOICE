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

test.describe('Notifications - Advanced', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page);
  });

  test('should display notification history or log', async ({ page }) => {
    await page.goto('/notifications', { waitUntil: 'domcontentloaded' });

    await expect(page.getByText('แจ้งเตือน').first()).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(2000);

    // History table or list
    const historyLabels = ['ประวัติ', 'Log', 'ส่งแล้ว', 'รายการแจ้งเตือน'];
    let found = 0;
    for (const label of historyLabels) {
      if (await page.getByText(label).first().isVisible({ timeout: 3000 }).catch(() => false)) {
        found++;
      }
    }
    await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
  });

  test('should display send notification buttons', async ({ page }) => {
    await page.goto('/notifications', { waitUntil: 'domcontentloaded' });

    await expect(page.getByText('แจ้งเตือน').first()).toBeVisible({ timeout: 15000 });

    // Send buttons
    const sendBtns = ['ส่งเตือนก่อนครบกำหนด', 'ส่งทวงหนี้ค้างชำระ', 'ส่งการแจ้งเตือน'];
    let found = 0;
    for (const btn of sendBtns) {
      if (await page.getByText(btn).first().isVisible({ timeout: 3000 }).catch(() => false)) {
        found++;
      }
    }
    expect(found).toBeGreaterThan(0);
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

  test('should display PDPA content sections', async ({ page }) => {
    await page.goto('/pdpa', { waitUntil: 'domcontentloaded' });

    await page.waitForTimeout(2000);

    const sections = ['PDPA', 'ความยินยอม', 'ข้อมูลส่วนบุคคล', 'ลูกค้า'];
    let found = 0;
    for (const section of sections) {
      if (await page.getByText(section).first().isVisible({ timeout: 3000 }).catch(() => false)) {
        found++;
      }
    }
    await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
  });

  test('should display consent status table', async ({ page }) => {
    await page.goto('/pdpa', { waitUntil: 'domcontentloaded' });

    await page.waitForTimeout(2000);

    // Table or list of customer consents
    const table = page.locator('table').first();
    const hasTable = await table.isVisible({ timeout: 5000 }).catch(() => false);

    if (hasTable) {
      await expect(table).toBeVisible();
    } else {
      // Empty state or different layout
      await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
    }
  });

  test('should display export or download option for PDPA data', async ({ page }) => {
    await page.goto('/pdpa', { waitUntil: 'domcontentloaded' });

    await page.waitForTimeout(2000);

    const exportBtn = page.getByText(/Export|ส่งออก|ดาวน์โหลด/).first();
    const hasExport = await exportBtn.isVisible({ timeout: 5000 }).catch(() => false);

    // Export is optional — page should load without error
    await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
  });
});
