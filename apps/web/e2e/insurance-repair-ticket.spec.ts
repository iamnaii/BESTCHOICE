/**
 * Insurance / Repair Ticket — E2E smoke tests (SP5 Phase 2)
 *
 * These tests cover the basic rendering and navigation of the
 * /insurance module. Full API-mutation happy path (create → send → repair →
 * return) requires a live DB with seeded data and is covered by jest unit
 * tests (apps/api/src/modules/repair-tickets/__tests__/).
 *
 * The smoke tests run against a dev or CI environment with the app running
 * at http://localhost:5173 (web) + http://localhost:3000 (API).
 *
 * ─── ที่ต้องรู้ก่อนแก้ไฟล์นี้ (สภาพจริงของหน้าจอ ณ 2026-08-30) ───────────────
 *
 * 1. ปุ่มสร้างใบซ่อมชื่อ **"รับเครื่องเข้าซ่อม"** ไม่ใช่ "รับเครื่องใหม่"
 *    — InsurancePage.tsx:258-262 (ปุ่มใน PageHeader) และ :229-232 (CTA ซ้ำในสถานะ
 *    ว่างเปล่า ข้อความเดียวกันเป๊ะ) ⇒ ต้องใช้ `.first()` = ปุ่มบน PageHeader ตาม
 *    ลำดับ DOM ไม่งั้นชน strict mode เมื่อคิวซ่อมว่าง
 *
 * 2. หน้า /insurance/new เป็น **wizard 2 ขั้นที่เริ่มด้วยการสแกน IMEI**
 *    (CreateInsuranceWizardPage.tsx:111-174 → ImeiLookupStep) หัวข้อคือ
 *    "รับเครื่องเข้าซ่อม" เช่นกัน — ฟอร์ม walk-in (#deviceBrand / #deviceModel /
 *    #deviceImei) **ถูกถอดออกจากระบบ** ตอน SP1 ยุบ wizard 4 ขั้นเหลือ 2 ขั้น
 *    (commit 70ede2834 "feat(insurance): SP1 — IMEI-driven wizard UX", สเปคระบุ
 *    ตรง ๆ ว่า "Input: IMEI/Serial only (no walk-in)") — ไม่มี id เหล่านี้เหลือใน
 *    apps/web/src แม้แต่ที่เดียว (DevicePickerStep.tsx ที่ยังมีฟิลด์คล้ายกันเป็น
 *    ไฟล์กำพร้า ไม่มีใคร import)
 *
 * 3. ด่าน skip เดิม ("เซิร์ฟเวอร์ยังเป็น main ก่อน merge SP5" / "DB drift")
 *    ถูกถอดออกแล้ว — routes ขึ้น production มานานและ CI รัน `prisma migrate deploy`
 *    + seed ทุกครั้ง (e2e-tests.yml) ⇒ เงื่อนไขพวกนั้นเหลือแค่ทำให้เทสข้ามเงียบ ๆ
 *    เมื่อหน้าจอเปลี่ยนชื่อ (ซึ่งเกิดขึ้นจริงกับ 2 เคสในไฟล์นี้)
 */

import { test, expect, type Page } from '@playwright/test';
import { loginViaAPI } from './helpers/auth';
import { gotoWithRetry } from './helpers/navigation';

/** ปุ่มสร้างใบซ่อม — `.first()` = ปุ่มบน PageHeader (ดูหมายเหตุ 1 ด้านบน) */
const createTicketButton = (page: Page) =>
  page.getByRole('button', { name: 'รับเครื่องเข้าซ่อม' }).first();

test.describe('Insurance / Repair Ticket (SP5 Phase 2)', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page);
  });

  // -------------------------------------------------------------------------
  // Smoke 1 — List page renders + "รับเครื่องเข้าซ่อม" button is visible
  // -------------------------------------------------------------------------
  test('smoke: list page renders + create button visible', async ({ page }) => {
    const ok = await gotoWithRetry(page, '/insurance');
    expect(ok, 'หน้า /insurance ขึ้น error boundary (ดู console/API ของ /repair-tickets)').toBe(
      true,
    );

    await expect(page.getByRole('heading', { name: 'รับซ่อม/รับประกัน' })).toBeVisible({
      timeout: 10_000,
    });

    // The create button should always be visible (OWNER role)
    await expect(createTicketButton(page)).toBeVisible({ timeout: 10_000 });
  });

  // -------------------------------------------------------------------------
  // Smoke 2 — Create page renders wizard step 1 (สแกน IMEI)
  // -------------------------------------------------------------------------
  test('smoke: create page renders wizard step 1', async ({ page }) => {
    const ok = await gotoWithRetry(page, '/insurance/new');
    expect(ok, 'หน้า /insurance/new ขึ้น error boundary').toBe(true);

    await expect(page.getByRole('heading', { name: 'รับเครื่องเข้าซ่อม' })).toBeVisible({
      timeout: 10_000,
    });

    // ป้ายบอกขั้นตอนของ wizard (CreateInsuranceWizardPage.tsx:116-134)
    await expect(page.getByText('1. สแกน IMEI')).toBeVisible();
    await expect(page.getByText('2. รายละเอียดซ่อม')).toBeVisible();

    // Step 1 — ImeiLookupStep: หัวข้อ + ช่องกรอก + ปุ่มค้นหา
    await expect(page.getByRole('heading', { name: 'สแกน IMEI / Serial' })).toBeVisible();
    const imeiInput = page.getByPlaceholder('359123456789012');
    await expect(imeiInput).toBeVisible();
    await expect(page.getByRole('button', { name: 'ค้นหา', exact: true })).toBeVisible();

    // ช่องกรอกรับค่าได้จริง (สิ่งเดียวที่ยังเหลือจากเคส "ฟอร์มรับค่า walk-in" เดิม —
    // ฟิลด์ยี่ห้อ/รุ่น/IMEI แบบกรอกมือถูกถอดออกไปแล้ว ดูหมายเหตุ 2 ด้านบน)
    await imeiInput.fill('350000000000001');
    await expect(imeiInput).toHaveValue('350000000000001');
  });

  // -------------------------------------------------------------------------
  // Smoke 3 — Navigate list → create via button click
  // -------------------------------------------------------------------------
  test('smoke: click "รับเครื่องเข้าซ่อม" navigates to /insurance/new', async ({ page }) => {
    const ok = await gotoWithRetry(page, '/insurance');
    expect(ok, 'หน้า /insurance ขึ้น error boundary').toBe(true);

    await expect(page.getByRole('heading', { name: 'รับซ่อม/รับประกัน' })).toBeVisible({
      timeout: 10_000,
    });

    // Click the create button in the PageHeader area
    await createTicketButton(page).click();

    await expect(page).toHaveURL(/\/insurance\/new/, { timeout: 10_000 });

    // Verify the wizard loaded
    await expect(page.getByRole('heading', { name: 'รับเครื่องเข้าซ่อม' })).toBeVisible({
      timeout: 10_000,
    });
  });

  // -------------------------------------------------------------------------
  // เคสที่ 4 เดิม ("create form accepts walk-in input") ถูกลบ — ฟีเจอร์หายจากระบบ
  //
  // มันกรอก #deviceBrand / #deviceModel / #deviceImei / #defectDescription บน
  // /insurance/new ซึ่งเป็นฟอร์มของ wizard 4 ขั้นยุคเก่า commit 70ede2834 (SP1)
  // ถอดโหมด walk-in ออกทั้งชุด ("Input: IMEI/Serial only (no walk-in)") — ขั้นที่ 2
  // (DefectDescriptionStep, มี #defectDescription) จะเรนเดอร์ก็ต่อเมื่อ lookup ด้วย
  // IMEI เจอเครื่องแล้วเท่านั้น ซึ่ง insurance-imei-wizard.spec.ts คุมอยู่ครบทั้ง
  // ขาเจอและไม่เจอ ส่วนด่าน "IMEI สั้นกว่า 4 ตัวอักษร" มีเทสหน่วยคุมไว้แล้วที่
  // apps/web/src/pages/insurance/__tests__/ImeiLookupStep.test.tsx:40
  // -------------------------------------------------------------------------
});
