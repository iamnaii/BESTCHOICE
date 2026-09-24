/**
 * After-sales hub — end-to-end happy path (after-sales hub PR 2, Task 13 spec ข้อ 13)
 *
 * ครอบเส้นทางหลักที่ PR 2 เพิ่งต่อครบ: แจ้งปัญหาเครื่อง → ซ่อมที่ร้าน → ส่งมอบคืนลูกค้า → ปิดเคส
 * (แทนที่ wizard เก่า /insurance/new ที่ Task 13 ถอดออกไปแล้ว — ดู App.tsx).
 *
 * ข้อมูล seed ที่ใช้ (คงที่ทุกรอบ CI — .github/workflows/e2e-tests.yml รัน
 * `prisma migrate deploy` + `node apps/api/dist/prisma/seed.js` บน DB สดทุกครั้งก่อนรัน Playwright):
 *   - เครื่อง prod-001 (IMEI 350000000000001, iPhone 16 Pro Max, สาขา branch-002)
 *   - สัญญาผ่อน cont-001 (BCP-2025-001, ACTIVE) ผูกกับ prod-001, ลูกค้า cust-001,
 *     พนักงานขาย user-004 (sales1@bestchoice.com) ซึ่งอยู่สาขา branch-002 พอดี
 *     ⇒ lookupByImei ไม่ชน branch scope ของ SALES/BRANCH_MANAGER (repair-warranty.service.ts)
 *   - seed.ts ไม่มี AfterSalesCase/RepairTicket ผูก IMEI นี้เลย ⇒ ไม่มี openCase ค้าง
 *     ในรอบแรกของแต่ละ CI run (แต่ละ run ได้ DB สดของตัวเอง)
 *
 * ข้อความ/ปุ่มทุกตัวตรวจจาก source จริงก่อนใช้ (ตาม .claude/rules/coding-standards.md
 * "ข้อความ error ต้องชี้ทางที่ทำได้จริงวันนี้" — เปิดโค้ดหน้าจอปลายทางเสมอ ไม่เดาจากความจำ):
 *   - IntakeBox.tsx: input aria-label="เลข IMEI หรือเลขเครื่อง", ปุ่ม (ลิงก์) "แจ้งปัญหาเครื่อง"
 *     พาไป /after-sales/new?imei=<imei> ตรงๆ โดยไม่ต้องกด "เช็คประกัน" ก่อน
 *   - AfterSalesNewPage.tsx: title="แจ้งปัญหาเครื่อง", label "อาการที่ลูกค้าแจ้ง",
 *     IntakePhotos คือ input[type=file] เดียวบนหน้านี้, ปุ่ม "บันทึกและเปิดเคส"
 *   - after-sales.ts STAGE_LABEL.RECEIVED = 'รับเรื่องแล้ว', STAGE_LABEL.CLOSED = 'ปิดเคส'
 *   - after-sales.ts primaryAction(): outcome REPAIR + stage RECEIVED + ไม่มีศูนย์ซ่อม
 *     (repairSupplier ไม่ถูกเลือกตอนเปิดเคส) → ปุ่ม "บันทึกซ่อมเสร็จ (ซ่อมที่ร้าน)" (dialog mark-repaired)
 *     แล้ว stage READY_FOR_PICKUP → ปุ่ม "ส่งมอบคืนลูกค้า" (dialog return)
 *   - RepairActionDialogs.tsx MarkRepairedDialog: label "ค่าซ่อมจริง" (#mr-actual-cost),
 *     label "ผู้จ่ายค่าซ่อม" (#mr-payer, ตัวเลือก CUSTOMER = PAYER_LABEL.CUSTOMER 'ลูกค้าจ่าย'),
 *     ปุ่มยืนยัน = "ยืนยัน"
 *   - AfterSalesCasePage.tsx: ConfirmDialog(dialog==='return') confirmLabel="ยืนยันส่งมอบคืน"
 *   - after-sales-repair.service.ts returnToCustomer(): sync stage ตรงเป็น 'CLOSED' ทันที
 *     (ไม่ผ่าน DELIVERED ค้างให้เห็นทาง UI) ⇒ StageChip ขึ้น STAGE_LABEL.CLOSED = 'ปิดเคส' ทันที
 *   - repair-tickets returnToCustomer(payer=CUSTOMER) สร้าง OtherIncome DRAFT เลข
 *     OI-YYYYMMDD-NNNN (accounting.md "REPAIR_SERVICE — payer routing") — AfterSalesCasePage
 *     แสดง `docNumber` เสมอ แต่เป็นลิงก์ไป /other-income/:id เฉพาะ role ใน OTHER_INCOME_DETAIL_ROLES
 *     (OWNER/FINANCE_MANAGER/ACCOUNTANT) — SALES เห็นเป็นข้อความล้วน (ตั้งใจ, C4b final-fix brief)
 *     ⇒ เทสนี้ตรวจ "ข้อความ" OI- บนหน้า ไม่ตรวจ href โดยตั้งใจ
 *
 * รูปแนบ — buffer JPEG ขั้นต่ำ 12 ไบต์ (magic bytes FF D8 FF ...) ผ่านทั้งด่าน client
 * (EVIDENCE_IMAGE_ACCEPT/MAX_BYTES) และด่าน magic-byte ฝั่ง server (`isEvidenceImage`,
 * apps/api/src/utils/upload-image.util.ts) — รูปแบบเดียวกับ `fakeJpeg()` ใน
 * after-sales-flow.integration.spec.ts (ฝั่ง API, jest/vitest ไม่ใช่ Playwright).
 *
 * ─── branchId ของสาขาใน seed ───────────────────────────────────────────────
 * seed.ts ใช้ Branch.id แบบ literal ('branch-002' ฯลฯ) ไม่ใช่ UUID — เดิม `CreateCaseDto.branchId`
 * ประกาศ `@IsUUID()` ทำให้ POST /after-sales ตอบ 400 เสมอบน DB ที่ seed และเทสนี้ถูกพักด้วย
 * `test.fixme()`. ผ่อน validator แล้ว (เจ้าของเคาะ 2026-09-24): DTO เป็น `@IsString() @MinLength(1)`
 * แบบเดียวกับ contracts/dto/contract.dto.ts และ service ตรวจว่าสาขามีจริงหลังเช็ค scope (R16)
 * ⇒ รหัสสาขาไม่มีจริงได้ 400 "ไม่พบสาขา" — เทสนี้จึงรันจริงใน CI แล้ว
 */
import { test, expect } from '@playwright/test';
import { loginAsRole } from './helpers/auth';
import { gotoWithRetry } from './helpers/navigation';

test.describe.configure({ timeout: 60_000 });

// prod-001 — สัญญาผ่อน cont-001 (BCP-2025-001, ACTIVE, สาขา branch-002, พนักงานขาย user-004)
const SEED_IMEI = '350000000000001';

// 12-byte minimal JPEG — พอผ่าน magic-byte check (FF D8 FF ...) ไม่ต้องเป็นรูปจริง
// (byte-identical กับ fakeJpeg() ใน after-sales-flow.integration.spec.ts ฝั่ง API)
const FAKE_JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);

test.describe('After-sales hub — แจ้งปัญหาเครื่อง → ซ่อมที่ร้าน → ปิดเคส', () => {
  test('SALES เปิดเคสซ่อม ค่าซ่อมจริง 500 ผู้จ่ายลูกค้า จนปิดเคสพร้อมเอกสาร OI-', async ({
    page,
  }) => {
    await loginAsRole(page, 'SALES');

    // 1) /after-sales → กรอก IMEI → "แจ้งปัญหาเครื่อง" (ลิงก์ตรงไป /after-sales/new?imei=)
    const ok = await gotoWithRetry(page, '/after-sales');
    expect(ok, 'หน้า /after-sales ขึ้น error boundary').toBe(true);

    await page.getByLabel('เลข IMEI หรือเลขเครื่อง').fill(SEED_IMEI);
    await page.getByRole('link', { name: 'แจ้งปัญหาเครื่อง' }).click();

    await expect(page).toHaveURL(new RegExp(`/after-sales/new\\?imei=${SEED_IMEI}`));
    await expect(
      page.getByRole('heading', { name: 'แจ้งปัญหาเครื่อง', level: 1 }),
    ).toBeVisible({ timeout: 10_000 });

    // 2) อาการ + แนบรูป 1 + ทางออกซ่อม (ค่าเริ่มต้นก็เป็น REPAIR อยู่แล้ว — คลิกซ้ำเพื่อความชัดเจน)
    await page.getByLabel('อาการที่ลูกค้าแจ้ง').fill('จอแตกมุมขวาบน กดหน้าจอไม่ติดบางจุด');
    await page.locator('input[type="file"]').setInputFiles({
      name: 'intake.jpg',
      mimeType: 'image/jpeg',
      buffer: FAKE_JPEG,
    });
    await page.getByRole('button', { name: 'ซ่อม', exact: false }).first().click();

    // 3) บันทึกและเปิดเคส → หน้าเคส stage รับเรื่องแล้ว
    await page.getByRole('button', { name: 'บันทึกและเปิดเคส' }).click();
    // CI ต่อ `?zone=shop` ท้าย URL (โซนหน้าร้าน) — จับเฉพาะ path ไม่ยึดท้ายสตริง
    await expect(page).toHaveURL(/\/after-sales\/[0-9a-f-]{36}(\?|$)/, { timeout: 10_000 });
    await expect(page.getByText('รับเรื่องแล้ว').first()).toBeVisible({ timeout: 10_000 });

    // 4) "บันทึกซ่อมเสร็จ (ซ่อมที่ร้าน)" → ค่าซ่อมจริง 500 ผู้จ่ายลูกค้า → ยืนยัน
    await page.getByRole('button', { name: 'บันทึกซ่อมเสร็จ (ซ่อมที่ร้าน)' }).click();
    const markRepairedDialog = page.getByRole('dialog');
    await markRepairedDialog.getByLabel('ค่าซ่อมจริง').fill('500');
    await markRepairedDialog.getByLabel('ผู้จ่ายค่าซ่อม').selectOption('CUSTOMER');
    await markRepairedDialog.getByRole('button', { name: 'ยืนยัน' }).click();

    // 5) "ส่งมอบคืนลูกค้า" → ยืนยันส่งมอบคืน
    const returnBtn = page.getByRole('button', { name: 'ส่งมอบคืนลูกค้า' });
    await expect(returnBtn).toBeVisible({ timeout: 10_000 });
    await returnBtn.click();
    await page.getByRole('dialog').getByRole('button', { name: 'ยืนยันส่งมอบคืน' }).click();

    // 6) ปิดเคส + เอกสารรายได้อื่น OI- (ข้อความ — SALES ไม่เห็นเป็นลิงก์ ดูหมายเหตุหัวไฟล์)
    await expect(page.getByText('ปิดเคส').first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/OI-\d{8}-\d{4}/)).toBeVisible({ timeout: 10_000 });
  });
});
