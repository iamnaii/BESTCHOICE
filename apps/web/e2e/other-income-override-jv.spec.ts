import { test, expect, type Page } from '@playwright/test';
import { loginAsRole, getRoleAuthHeaders, type TestRole } from './helpers/auth';
import { unwrapResponse } from './helpers/api-utils';

/* ================================================================
   Other Income — Override JV

   สิ่งที่ตรวจจากซอร์สจริง (ต่างจากสมมติฐานของเทสรุ่นก่อนหน้า):

   - UI override ทั้งชุดอยู่บน **หน้า entry** (`/other-income/new`) ตั้งแต่แรก
     ไม่ต้องบันทึกร่างก่อน: checkbox "ใช้เอง (Override)" → OverrideConfirmDialog →
     EditableJournalTable (OtherIncomeEntryPage.tsx §6). ส่วน OtherIncomeViewPage
     ไม่ import สองคอมโพเนนต์นี้เลย — มีแค่ป้ายอ่านอย่างเดียว
   - ชื่อฟิลด์มาจาก react-hook-form `register()` เป็น field path:
     `items.0.unitAmount` / `items.0.description` / `items.0.whtPct` /
     `amountReceived` — ไม่มี input ชื่อ `amount` หรือ `description` ในหน้านี้
   - ช่อง Dr/Cr ของ EditableJournalTable เป็น controlled input ผ่าน prop `onChange`
     **ไม่มี attribute `name`** ⇒ ต้องอ้างด้วยตำแหน่งคอลัมน์ในตาราง (ตารางเดียว
     บนหน้านี้) ปุ่มลบบรรทัดมี aria-label "ลบบรรทัดที่ N"
   - marker บนหน้ารายการเป็นไอคอน lucide ที่มี `aria-label="Override JV"`
     ไม่ใช่ text node "✏"
   ================================================================ */

const API_URL = process.env.API_DIRECT_URL || 'http://localhost:3000';

/** `page.request` ไม่เห็น header ที่ `loginAsRole` ตั้งไว้ — ต้องแนบเองทุกครั้ง */
async function apiPost<T>(
  page: Page,
  role: TestRole,
  path: string,
  data: unknown = {},
): Promise<T> {
  const res = await page.request.post(`${API_URL}${path}`, {
    headers: getRoleAuthHeaders(role),
    data,
  });
  if (!res.ok()) throw new Error(`POST ${path} → ${res.status()}: ${await res.text()}`);
  return unwrapResponse(await res.json()) as T;
}

function todayBangkok(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' });
}

/**
 * เปิดหน้าบันทึกรายได้อื่นแล้วกรอกยอดขั้นต่ำให้ Auto Journal มี 2 บรรทัดพอดี
 * (Cr รายได้ / Dr เงินรับ) — whtPct ค่า default คือ 1% ซึ่งจะเพิ่มบรรทัด 11-4103
 * เข้ามาเป็นบรรทัดที่ 3 ทำให้ index ของช่อง Dr/Cr เลื่อน
 */
async function openEntryPage(page: Page, amount: string) {
  await page.goto('/other-income/new');
  await page.waitForSelector('form', { timeout: 20000 });

  await page.selectOption('select[name="items.0.whtPct"]', '0');
  await page.fill('input[name="items.0.unitAmount"]', amount);
  await page.fill('input[name="items.0.description"]', 'E2E override JV');
  await page.fill('input[name="amountReceived"]', amount);
}

/**
 * เปิดโหมด override — ใช้ `.click()` ไม่ใช่ `.check()`: checkbox เป็น controlled
 * (`checked={overrideMode}`) และยังไม่ถูกติ๊กจนกว่าจะกดยืนยันใน dialog ⇒ `.check()`
 * จะรอสถานะ checked จน timeout
 */
async function enterOverrideMode(page: Page) {
  await page.locator('label:has-text("ใช้เอง (Override)") input[type="checkbox"]').click();

  await expect(page.getByText('คุณกำลังจะแก้ไข Auto Journal ด้วยตนเอง').first()).toBeVisible({
    timeout: 10000,
  });
  await page.locator('#override-ack-checkbox').click();
  await page.getByRole('button', { name: 'เปิดโหมดแก้ไข' }).click();

  // EditableJournalTable = <table> เดียวบนหน้านี้ (ItemsTable/AdjustmentTable ใช้ div)
  await expect(page.locator('table')).toBeVisible({ timeout: 10000 });
}

/** ปุ่ม POST บนแถบล่าง — maker-checker ของ other-income ปิดอยู่ (คีย์ไม่ถูก seed) */
function postButton(page: Page) {
  return page.getByRole('button', { name: /บันทึก & POST/ });
}

test.describe('Other Income — Override JV', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsRole(page, 'OWNER');
  });

  test('override mode on /other-income/new — V1 blocks POST until Dr = Cr', async ({ page }) => {
    await openEntryPage(page, '1000');
    await enterOverrideMode(page);

    // 2 บรรทัด × (Dr, Cr) — ช่องอื่นในตารางเป็น text ไม่ใช่ number
    const numeric = page.locator('table input[type="number"]');
    await expect(numeric).toHaveCount(4);

    // บรรทัดที่ 2 = Dr เงินรับ → ทำให้ Dr ≠ Cr
    await numeric.nth(2).fill('999999');
    await expect(page.getByText(/V1:/).first()).toBeVisible({ timeout: 10000 });

    // canPost = false ⇒ ปุ่ม POST ถูกปิด (หน้านี้ยังขาดลูกค้าอยู่แล้วด้วย —
    // การยืนยันที่ชี้ขาดคือข้อความ V1 ด้านบน)
    await expect(postButton(page)).toBeDisabled();

    // แก้ให้บาลานซ์ → V1 ต้องหายไป
    await numeric.nth(2).fill('1000');
    await expect(page.getByText(/V1:/)).toHaveCount(0);
  });

  test('V2 validation: blocks POST when only 1 line', async ({ page }) => {
    await openEntryPage(page, '500');
    await enterOverrideMode(page);

    // ปุ่มลบของ EditableJournalTable = aria-label "ลบบรรทัดที่ N"
    // (คนละตัวกับ "ลบรายการ" ของ ItemsTable)
    await page.getByRole('button', { name: 'ลบบรรทัดที่ 2' }).click();

    await expect(page.getByText(/ต้องมีอย่างน้อย 2 บรรทัด/).first()).toBeVisible({
      timeout: 10000,
    });
    await expect(postButton(page)).toBeDisabled();
  });

  test('V5 validation: blocks POST when a line has neither Dr nor Cr', async ({ page }) => {
    await openEntryPage(page, '750');
    await enterOverrideMode(page);

    // ⚠️ สาขา "มีทั้ง Dr และ Cr ในบรรทัดเดียว" **สร้างผ่าน UI ไม่ได้** —
    // EditableJournalTable ล้างอีกฝั่งเป็น 0 ทุกครั้งที่แก้ (onChange ของช่อง Dr
    // ตั้ง credit:0 และกลับกัน) ⇒ สาขาของ V5 ที่เอื้อมถึงได้จริงคือ "ไม่มีทั้ง Dr และ Cr"
    // (ฝั่ง server ยังกันเคส "มีทั้งสอง" ไว้ — ครอบด้วย journal-override.service.spec.ts)
    const numeric = page.locator('table input[type="number"]');
    await numeric.nth(1).fill('0'); // ล้าง Cr ของบรรทัดรายได้

    await expect(page.getByText(/ไม่มีทั้ง Dr และ Cr/).first()).toBeVisible({ timeout: 10000 });
    await expect(postButton(page)).toBeDisabled();
  });

  test('POST with override JV shows the ✏ marker in the list', async ({ page }) => {
    // CounterpartyPicker บังคับเลือกผู้ติดต่อจริง (ทางเดิม free-text ถูกถอดออกใน P2b)
    // ⇒ เส้นทาง POST เต็มรูปแบบสร้างผ่าน API แล้วค่อยตรวจ marker บนหน้ารายการ
    const doc = await apiPost<{ id: string; docNumber: string }>(
      page,
      'OWNER',
      '/api/other-income',
      {
        issueDate: todayBangkok(),
        dueDate: todayBangkok(),
        paymentDate: todayBangkok(),
        priceType: 'EXCLUSIVE',
        counterpartyName: `E2E Override JV ${Date.now()}`,
        paymentAccountCode: '11-1201',
        amountReceived: 1000,
        items: [
          {
            accountCode: '42-1102',
            description: 'E2E override JV',
            quantity: 1,
            unitAmount: 1000,
            discountAmount: 0,
            vatPct: 0,
            whtPct: 0,
          },
        ],
      },
    );

    await apiPost(page, 'OWNER', `/api/other-income/${doc.id}/post`, {
      override: true,
      overrideLines: [
        { accountCode: '42-1102', debit: 0, credit: 1000, description: 'E2E override — รายได้' },
        { accountCode: '11-1201', debit: 1000, credit: 0, description: 'E2E override — รับเงิน' },
      ],
    });

    await page.goto('/other-income');
    await page.getByPlaceholder('ค้นหาเลขเอกสาร / คู่ค้า').fill(doc.docNumber);

    const row = page.locator('tr', { hasText: doc.docNumber });
    await expect(row.locator('[aria-label="Override JV"]')).toBeVisible({ timeout: 15000 });
  });
});
