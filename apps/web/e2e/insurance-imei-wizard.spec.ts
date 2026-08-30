import { test, expect, type Page } from '@playwright/test';
import { loginAsRole, getRoleAuthHeaders } from './helpers/auth';
import { unwrapResponse } from './helpers/api-utils';

/**
 * ปลายทาง API ต้องเป็น "โฮสต์ของ API ตรง ๆ" ไม่ใช่ baseURL ของหน้าเว็บ —
 * ใน CI หน้าเว็บถูกเสิร์ฟด้วย `npx serve -s apps/web/dist` (e2e-tests.yml) ซึ่ง
 * **ไม่มี proxy /api** ⇒ `/api/...` ตกลง SPA fallback แล้วคืน index.html พร้อม
 * HTTP 200 ⇒ `res.ok()` เป็นจริง แต่ `res.json()` ระเบิดว่า
 * `Unexpected token '<', "<!DOCTYPE "... is not valid JSON` (อาการเดิมของเทสนี้)
 */
const API_URL = process.env.API_DIRECT_URL || 'http://localhost:3000';

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

  /**
   * ปุ่มค้นหาของ wizard ต้องระบุชื่อแบบ exact เท่านั้น
   *
   * TopBar มีปุ่มค้นหารวม (`aria-label="ค้นหา (Ctrl+K)"` + ข้อความ "ค้นหา... (⌘K)"
   * — TopBar.tsx:214-222) ซึ่ง **อยู่ก่อนเนื้อหาหน้าใน DOM** ⇒ selector เดิม
   * `button:has-text("ค้นหา")` แมตช์ 2 ตัว และ `page.click()` (API เก่า ไม่ strict)
   * กดตัวแรก = เปิด Command Palette แทนที่จะยิง lookup ⇒ ข้อความผลลัพธ์ไม่มีวันขึ้น
   * (พิสูจน์แล้ว: locator นับได้ 2, ไม่มี request /repair-tickets/lookup-by-imei เลย)
   * ชื่อ accessible ของปุ่มใน ImeiLookupStep คือ "ค้นหา" เป๊ะ ๆ (ImeiLookupStep.tsx:80-82)
   */
  const searchButton = (page: Page) => page.getByRole('button', { name: 'ค้นหา', exact: true });

  test('block message when IMEI not in DB', async ({ page }) => {
    await page.goto('/insurance/new');
    await page.fill('input[placeholder*="359"]', 'NOT_A_REAL_IMEI_999');
    await searchButton(page).click();
    await expect(page.locator('text=ไม่พบเครื่องในระบบ')).toBeVisible();
  });

  test('found IMEI shows preview + active buttons', async ({ page }) => {
    // แหล่ง IMEI จริงคือ **สินค้า** ไม่ใช่รายการสัญญา — `GET /contracts` include
    // product แค่ id/name/brand/model/category (contract-query.service.ts:88)
    // ไม่มี `imeiSerial` เลย ⇒ โค้ดเดิมอ่าน `payload.data[0].product.imeiSerial`
    // ได้ undefined เสมอ แล้ว test.skip เงียบ ๆ ต่อให้เรียก API ถูกต้องแล้วก็ตาม
    // ส่วน lookup-by-imei หาเครื่องจากตาราง products ตรง ๆ
    // (repair-warranty.service.ts:317-330) จึงพอแค่มีเครื่องที่มี IMEI
    const res = await page.request.get(`${API_URL}/api/products?limit=100`, {
      headers: getRoleAuthHeaders('BRANCH_MANAGER'),
    });
    expect(res.ok(), `GET /products ล้มเหลว: HTTP ${res.status()}`).toBeTruthy();

    // envelope กลาง { success, data, timestamp } ครอบ payload paginated อีกชั้น
    const payload = unwrapResponse(await res.json()) as {
      data: Array<{ imeiSerial: string | null }>;
    };
    const imei = payload.data
      .map((p) => p.imeiSerial)
      .find((v): v is string => !!v && v.trim().length >= 4);

    // seed สร้างเครื่องที่มี IMEI ไว้ 27 เครื่อง (prisma/seed.ts:388-421) —
    // ถ้าไม่เจอเลยแปลว่าข้อมูลตั้งต้นหาย ไม่ใช่เหตุให้ข้ามเทส
    expect(imei, 'ไม่พบสินค้าที่มี IMEI ในระบบ — ตรวจ seed ของฐานข้อมูลทดสอบ').toBeTruthy();

    await page.goto('/insurance/new');
    await page.fill('input[placeholder*="359"]', imei!);
    await searchButton(page).click();

    // การ์ดพรีวิวกับปุ่มลงมือเรนเดอร์คู่กันเมื่อ found=true เท่านั้น
    // (ImeiLookupStep.tsx:95-104) — พรีวิวโชว์ IMEI ในบรรทัดรองของช่อง "เครื่อง"
    // (บรรทัด 121) ซึ่งเป็น text node จริง ไม่ใช่ค่าในช่องกรอก
    await expect(page.getByText(imei!, { exact: false }).first()).toBeVisible();
    await expect(page.locator('button:has-text("รับเข้าซ่อม")')).toBeEnabled();
  });
});
