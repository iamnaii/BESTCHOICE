import { test, expect } from '@playwright/test';
import { loginAsRole } from './helpers/auth';

test.describe('Insurance wizard — IMEI-driven flow (SP1)', () => {
  // เดิมกรอกฟอร์มล็อกอินเองด้วย `[name="email"]` ซึ่ง **ไม่มีในหน้าจอ** — LoginPage
  // ใช้ id="email" / data-testid="login-email" ไม่มี attribute name เลย ⇒ page.fill
  // รอจนหมดเวลา 15 วิ ทุกครั้ง และต่อให้แก้ selector ก็ยังติดบรรทัดถัดไป เพราะ
  // waitForURL รอ /dashboard ซึ่งไม่ใช่ route ที่มีอยู่ (ปลายทางหลังล็อกอินมาจาก
  // getLandingPathForRole ซึ่งขึ้นกับโซนของแต่ละ role)
  // ⇒ ใช้ helper กลางที่ฉีด token ตรงแทน — ไม่ต้องพึ่งรูปร่างของฟอร์มหรือปลายทาง
  test.beforeEach(async ({ page }) => {
    await loginAsRole(page, 'BRANCH_MANAGER');
  });

  test('block message when IMEI not in DB', async ({ page }) => {
    await page.goto('/insurance/new');
    await page.fill('input[placeholder*="359"]', 'NOT_A_REAL_IMEI_999');
    await page.click('button:has-text("ค้นหา")');
    await expect(page.locator('text=ไม่พบเครื่องในระบบ')).toBeVisible();
  });

  test('found IMEI shows preview + active buttons', async ({ page, request }) => {
    // Fetch a real IMEI via the contracts API rather than relying on a DOM
    // attribute that doesn't exist (former approach silently skipped). The API
    // is the source of truth for what's in the DB.
    const contractsRes = await request.get('/api/contracts?limit=1');
    if (!contractsRes.ok()) test.skip(true, 'Contracts API not reachable');
    const payload = await contractsRes.json();
    const imei = payload?.data?.[0]?.product?.imeiSerial ?? payload?.[0]?.product?.imeiSerial;
    test.skip(!imei, 'No seed contract with IMEI to test against');

    await page.goto('/insurance/new');
    await page.fill('input[placeholder*="359"]', imei);
    await page.click('button:has-text("ค้นหา")');
    await expect(page.locator('button:has-text("รับเข้าซ่อม")')).toBeEnabled();
  });
});
