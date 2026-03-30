import { test, expect } from '@playwright/test';
import { loginViaAPI } from './helpers/auth';

test.describe('Users Management Page', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page);
  });

  test('should display users page', async ({ page }) => {
    await page.goto('/users', { waitUntil: 'domcontentloaded' });

    await expect(page.getByText('จัดการผู้ใช้').first()).toBeVisible({ timeout: 15000 });
  });

  test('should display add user button', async ({ page }) => {
    await page.goto('/users', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('จัดการผู้ใช้').first()).toBeVisible({ timeout: 15000 });

    await expect(page.getByText('เพิ่มผู้ใช้').first()).toBeVisible({ timeout: 5000 });
  });

  test('should display user table with columns', async ({ page }) => {
    await page.goto('/users', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('จัดการผู้ใช้').first()).toBeVisible({ timeout: 15000 });

    const table = page.locator('table').first();
    if (await table.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(table.getByText('ชื่อ').first()).toBeVisible();
      await expect(table.getByText('ตำแหน่ง').first()).toBeVisible();
    }
  });

  test('should open add user modal', async ({ page }) => {
    await page.goto('/users', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('เพิ่มผู้ใช้').first()).toBeVisible({ timeout: 15000 });

    await page.getByText('เพิ่มผู้ใช้').first().click();

    await expect(page.getByText('เพิ่มผู้ใช้ใหม่')).toBeVisible({ timeout: 5000 });
  });
});

test.describe('Branches Page', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page);
  });

  test('should display branches page', async ({ page }) => {
    await page.goto('/branches', { waitUntil: 'domcontentloaded' });

    await expect(page.getByText('จัดการสาขา').first()).toBeVisible({ timeout: 15000 });
  });

  test('should display add branch button', async ({ page }) => {
    await page.goto('/branches', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('จัดการสาขา').first()).toBeVisible({ timeout: 15000 });

    await expect(page.getByText('เพิ่มสาขา').first()).toBeVisible({ timeout: 5000 });
  });

  test('should display branch table', async ({ page }) => {
    await page.goto('/branches', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('จัดการสาขา').first()).toBeVisible({ timeout: 15000 });

    const table = page.locator('table').first();
    if (await table.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(table.getByText('ชื่อสาขา').first()).toBeVisible();
    }
  });
});

test.describe('Audit Logs Page', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page);
  });

  test('should display audit logs page', async ({ page }) => {
    await page.goto('/audit-logs', { waitUntil: 'domcontentloaded' });

    await expect(
      page.getByText('Audit Logs').or(page.getByText('ประวัติการทำงาน')).first(),
    ).toBeVisible({ timeout: 15000 });
  });

  test('should display summary cards', async ({ page }) => {
    await page.goto('/audit-logs', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    const cards = ['วันนี้', '7 วันล่าสุด', 'ทั้งหมด'];
    let found = 0;
    for (const card of cards) {
      if (await page.getByText(card).first().isVisible({ timeout: 3000 }).catch(() => false)) {
        found++;
      }
    }
    expect(found).toBeGreaterThan(0);
  });

  test('should display filter controls', async ({ page }) => {
    await page.goto('/audit-logs', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    // Filter labels
    const filters = ['Entity', 'Action'];
    let found = 0;
    for (const filter of filters) {
      if (await page.getByText(filter).first().isVisible({ timeout: 3000 }).catch(() => false)) {
        found++;
      }
    }
    expect(found).toBeGreaterThan(0);
  });
});

test.describe('System Status Page', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page);
  });

  test('should display system status page', async ({ page }) => {
    await page.goto('/system-status', { waitUntil: 'domcontentloaded' });

    await expect(
      page.getByText('สถานะระบบ').first(),
    ).toBeVisible({ timeout: 15000 });
  });

  test('should display service status cards', async ({ page }) => {
    await page.goto('/system-status', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('สถานะระบบ').first()).toBeVisible({ timeout: 15000 });

    const services = ['Frontend', 'API Server', 'Database'];
    let found = 0;
    for (const service of services) {
      if (await page.getByText(service).first().isVisible({ timeout: 3000 }).catch(() => false)) {
        found++;
      }
    }
    expect(found).toBeGreaterThan(0);
  });

  test('should display refresh button', async ({ page }) => {
    await page.goto('/system-status', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('สถานะระบบ').first()).toBeVisible({ timeout: 15000 });

    await expect(page.getByText('รีเฟรช').first()).toBeVisible({ timeout: 5000 });
  });
});

test.describe('Migration Page', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page);
  });

  test('should display migration page', async ({ page }) => {
    await page.goto('/migration', { waitUntil: 'domcontentloaded' });

    await expect(page.getByText('นำเข้าข้อมูล').first()).toBeVisible({ timeout: 15000 });
  });

  test('should display import mode buttons', async ({ page }) => {
    await page.goto('/migration', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('นำเข้าข้อมูล').first()).toBeVisible({ timeout: 15000 });

    const modes = ['ลูกค้า', 'สัญญา'];
    let found = 0;
    for (const mode of modes) {
      if (await page.getByText(mode).first().isVisible({ timeout: 3000 }).catch(() => false)) {
        found++;
      }
    }
    expect(found).toBeGreaterThan(0);
  });

  test('should not display errors', async ({ page }) => {
    await page.goto('/migration', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    await expect(page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
  });
});
