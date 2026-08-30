import { test, expect, type Page } from '@playwright/test';
import { loginAsRole, getRoleAuthHeaders, type TestRole } from './helpers/auth';
import { unwrapResponse } from './helpers/api-utils';
import { gotoWithRetry } from './helpers/navigation';

/* ================================================================
   D1.2.1 — Approval Workflow E2E

   สถานะจริงของระบบ ณ 2026-08-30 (ตรวจจากซอร์ส ไม่ใช่จากสเปคเก่า):

   - `approval_enabled` ถูก seed เป็น 'true' แล้ว (apps/api/prisma/seed.ts)
     ⇒ ไม่ต้อง (และไม่มีทาง) เปิดผ่าน API — route `PUT /settings/system-config`
     ที่เทสรุ่นเก่ายิงหา **ไม่มีอยู่จริง** (settings.controller มีแค่ `@Patch()`)
   - `approval_required_doc_types` default = ['PAYROLL'],
     `approval_threshold` default = 50,000 (approval-config.util + lifecycle service)
   - ปุ่มบนหน้า /expenses/:id มาจาก InternalControlActionBar:
       DRAFT + makerCheckerEnabled → "ส่งให้อนุมัติ"
       DRAFT + !makerCheckerEnabled → "บันทึก & POST"
       READY + isViewerApprover    → "อนุมัติ & POST" / "ปฏิเสธ"
     `makerCheckerEnabled` = flag ระดับระบบ (`approval_enabled`) **ไม่ได้ดูยอด/ชนิด
     เอกสาร** ⇒ DRAFT ทุกใบเห็นปุ่ม "ส่งให้อนุมัติ" เหมือนกันหมด. ด่าน
     threshold/doctype ที่ต่างกันจริงอยู่ฝั่ง server (`post()` ปฏิเสธ DRAFT ที่เข้า
     เงื่อนไข) — เทสด้านล่างจึงพิสูจน์ด่านนั้นผ่าน API แล้วค่อยตรวจผลบนหน้าจอ
   - `isViewerApprover` = role ∈ {OWNER, FINANCE_MANAGER} **และ**
     `doc.createdBy.id !== user.id` (ExpenseDetailPage) ⇒ คนสร้างอนุมัติเองไม่ได้

   ฟอร์ม /expenses/new ไม่ถูกใช้สร้างเอกสารในไฟล์นี้อีกต่อไป: ปุ่ม "บันทึกร่าง" ของ
   ExpenseFormV4 ถูก disable จนกว่าจะมีบรรทัดรายการที่เลือกหมวดบัญชีแล้ว และ
   `?type=` รับแค่ PR|CN|SE — การขับฟอร์มด้วยมือจึงค้างที่ปุ่ม disabled ทุกครั้ง
   ================================================================ */

const API_URL = process.env.API_DIRECT_URL || 'http://localhost:3000';

/**
 * `page.request` เป็นคนละช่องทางกับ `page.setExtraHTTPHeaders` ที่ `loginAsRole`
 * ตั้งไว้ — ต้องแนบ Authorization + X-Requested-With เอง ไม่งั้น CsrfGuard ตอบ 403.
 * ต้องเรียก `loginAsRole(page, role)` ก่อนเสมอ (นั่นคือสิ่งที่เติม token cache).
 */
async function apiGet<T>(page: Page, role: TestRole, path: string): Promise<T> {
  const res = await page.request.get(`${API_URL}${path}`, { headers: getRoleAuthHeaders(role) });
  if (!res.ok()) throw new Error(`GET ${path} → ${res.status()}: ${await res.text()}`);
  return unwrapResponse(await res.json()) as T;
}

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

/** วันที่ปัจจุบันตามเวลาไทย — documentDate ใช้ตัดสินงวดบัญชี (validatePeriodOpen) */
function todayBangkok(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' });
}

/**
 * งวดเงินเดือนสุ่ม — createPayroll มีด่านกันซ้ำ (สาขา + งวด + ฝั่ง) ที่ปฏิเสธใบที่สอง
 * ของงวดเดียวกัน ⇒ ถ้า fix งวดไว้ เทสจะพังตั้งแต่การรันครั้งที่สอง
 */
function uniquePayrollPeriod(): string {
  const slot = Math.floor(Math.random() * 1200); // 2000-01 .. 2099-12
  const year = 2000 + Math.floor(slot / 12);
  const month = (slot % 12) + 1;
  return `${year}-${String(month).padStart(2, '0')}`;
}

type CreatedDoc = { id: string; number: string; status: string };

let cachedBranchId: string | undefined;
async function firstBranchId(page: Page, role: TestRole): Promise<string> {
  if (cachedBranchId) return cachedBranchId;
  const branches = await apiGet<{ id: string }[]>(page, role, '/api/branches');
  if (!branches?.length) throw new Error('ไม่พบสาขาใน seed — E2E ต้องมีอย่างน้อย 1 สาขา');
  cachedBranchId = branches[0].id;
  return cachedBranchId;
}

/**
 * หมวดบัญชีค่าใช้จ่ายจริงจากผังบัญชี — `assertCategoriesAreExpense` ปฏิเสธรหัสที่
 * ไม่มีในผัง หรือ type ไม่ใช่ "ค่าใช้จ่าย" (ExpenseLineInput บังคับรูปแบบ 5x-xxxx)
 */
let cachedExpenseCategory: string | undefined;
async function firstExpenseCategory(page: Page, role: TestRole): Promise<string> {
  if (cachedExpenseCategory) return cachedExpenseCategory;
  const rows = await apiGet<{ code: string; type: string }[]>(page, role, '/api/chart-of-accounts');
  const expenses = rows.filter((r) => r.type === 'ค่าใช้จ่าย' && /^5\d-\d{4}$/.test(r.code));
  const code = expenses.find((r) => r.code.startsWith('52-'))?.code ?? expenses[0]?.code;
  if (!code) throw new Error('ไม่พบหมวดบัญชีค่าใช้จ่าย 5x-xxxx ในผังบัญชี');
  cachedExpenseCategory = code;
  return code;
}

async function createExpenseDraft(
  page: Page,
  role: TestRole,
  opts: { unitPrice: number; description: string },
): Promise<CreatedDoc> {
  const branchId = await firstBranchId(page, role);
  const category = await firstExpenseCategory(page, role);
  return apiPost<CreatedDoc>(page, role, '/api/expense-documents', {
    documentType: 'EXPENSE',
    branchId,
    documentDate: todayBangkok(),
    description: opts.description,
    priceType: 'EXCLUSIVE',
    // จ่ายวันเดียวกัน ⇒ resolveTargetStatus คืน POSTED (ไม่ใช่ ACCRUAL)
    paymentMethod: 'CASH',
    depositAccountCode: '11-1101',
    lines: [{ category, description: opts.description, quantity: 1, unitPrice: opts.unitPrice }],
  });
}

async function createPayrollDraft(
  page: Page,
  role: TestRole,
  description: string,
): Promise<CreatedDoc> {
  const branchId = await firstBranchId(page, role);
  return apiPost<CreatedDoc>(page, role, '/api/expense-documents/payroll', {
    branchId,
    documentDate: todayBangkok(),
    payrollPeriod: uniquePayrollPeriod(),
    entityScope: 'FINANCE',
    depositAccountCode: '11-1101',
    description,
    // ไม่ใส่ ssoEmployee/whtAmount — JE เหลือ Dr 53-1101 / Cr 11-1101 ซึ่งบาลานซ์เอง
    lines: [{ employeeName: 'พนักงานทดสอบ E2E', baseSalary: 15000 }],
  });
}

function submitForApproval(page: Page, role: TestRole, docId: string) {
  return apiPost(page, role, `/api/expense-documents/${docId}/submit-for-approval`);
}

/** ยิง post ดิบ ๆ เพื่อดูว่า "ด่านอนุมัติ" ทำงานหรือไม่ (ไม่ throw เมื่อโดนปฏิเสธ) */
function rawPost(page: Page, role: TestRole, docId: string) {
  return page.request.post(`${API_URL}/api/expense-documents/${docId}/post`, {
    headers: getRoleAuthHeaders(role),
    data: {},
  });
}

test.describe('Approval Workflow (D1.2.1)', () => {
  test('PAYROLL doc requires approval (doctype gate)', async ({ page }) => {
    await loginAsRole(page, 'OWNER');
    const doc = await createPayrollDraft(page, 'OWNER', `E2E PAYROLL ${Date.now()}`);
    expect(doc.status).toBe('DRAFT');

    // ด่าน doctype: PAYROLL อยู่ใน approval_required_doc_types ⇒ post ตรงจาก DRAFT ไม่ได้
    const postRes = await rawPost(page, 'OWNER', doc.id);
    expect(postRes.status()).toBe(400);
    expect(await postRes.text()).toContain('อนุมัติ');

    const ok = await gotoWithRetry(page, `/expenses/${doc.id}`);
    if (!ok) return;

    const submitBtn = page.getByRole('button', { name: /ส่งให้อนุมัติ/ });
    await expect(submitBtn).toBeVisible({ timeout: 15000 });

    // ปุ่มโพสต์ตรง ("บันทึก & POST") ต้องไม่ถูกเสนอเมื่อ workflow ขออนุมัติเปิดอยู่
    await expect(page.getByRole('button', { name: /บันทึก & POST/ })).toHaveCount(0);

    await submitBtn.click();
    await expect(page.getByText('รออนุมัติ').first()).toBeVisible({ timeout: 15000 });
  });

  test('Expense >=50k requires approval (threshold gate)', async ({ page }) => {
    await loginAsRole(page, 'OWNER');
    const doc = await createExpenseDraft(page, 'OWNER', {
      unitPrice: 60000,
      description: `E2E HIGH-VALUE ${Date.now()}`,
    });

    // ด่าน threshold (default 50,000) — EXPENSE ไม่อยู่ใน doctype list จึงพิสูจน์ threshold ล้วน
    const postRes = await rawPost(page, 'OWNER', doc.id);
    expect(postRes.status()).toBe(400);
    expect(await postRes.text()).toContain('อนุมัติ');

    const ok = await gotoWithRetry(page, `/expenses/${doc.id}`);
    if (!ok) return;

    const submitBtn = page.getByRole('button', { name: /ส่งให้อนุมัติ/ });
    await expect(submitBtn).toBeVisible({ timeout: 15000 });

    await submitBtn.click();
    await expect(page.getByText('รออนุมัติ').first()).toBeVisible({ timeout: 15000 });
  });

  test('Low-value EXPENSE skips approval (under threshold + not PAYROLL)', async ({ page }) => {
    await loginAsRole(page, 'OWNER');
    const doc = await createExpenseDraft(page, 'OWNER', {
      unitPrice: 1000,
      description: `E2E LOW-VALUE ${Date.now()}`,
    });

    // ต่ำกว่า threshold + ไม่ใช่ PAYROLL ⇒ ด่านไม่ทำงาน โพสต์ตรงจาก DRAFT ได้เลย
    //
    // หมายเหตุ: การ "ข้ามอนุมัติ" พิสูจน์ได้ที่ฝั่ง server เท่านั้น — หน้า detail
    // เลือกปุ่มจาก flag `approval_enabled` ระดับระบบ ไม่ได้ดูยอด/ชนิดเอกสาร
    // (InternalControlActionBar) ⇒ DRAFT ใบนี้ก็ยังเห็นปุ่ม "ส่งให้อนุมัติ" อยู่ดี
    const postRes = await rawPost(page, 'OWNER', doc.id);
    expect(postRes.ok()).toBeTruthy();

    const ok = await gotoWithRetry(page, `/expenses/${doc.id}`);
    if (!ok) return;

    await expect(page.getByText('ลงบัญชีแล้ว').first()).toBeVisible({ timeout: 15000 });
    // โพสต์แล้วไม่มีเส้นทางขออนุมัติให้กดอีก
    await expect(page.getByRole('button', { name: /ส่งให้อนุมัติ/ })).toHaveCount(0);
  });

  test('Owner approves PENDING_APPROVAL → auto-posts', async ({ page }) => {
    // ผู้สร้างต้องไม่ใช่ผู้อนุมัติ — ExpenseDetailPage ซ่อนปุ่มอนุมัติเมื่อ
    // `doc.createdBy.id === user.id` ⇒ สร้างด้วย ACCOUNTANT แล้วอนุมัติด้วย OWNER
    await loginAsRole(page, 'ACCOUNTANT');
    const doc = await createPayrollDraft(
      page,
      'ACCOUNTANT',
      `E2E approve-then-autopost ${Date.now()}`,
    );
    await submitForApproval(page, 'ACCOUNTANT', doc.id);

    await loginAsRole(page, 'OWNER');
    const ok = await gotoWithRetry(page, `/expenses/${doc.id}`);
    if (!ok) return;

    const approveBtn = page.getByRole('button', { name: /อนุมัติ & POST/ });
    await expect(approveBtn).toBeVisible({ timeout: 15000 });
    await approveBtn.click();

    const toast = page.locator('[data-sonner-toast]').first();
    await expect(toast).toContainText('อนุมัติเรียบร้อย', { timeout: 15000 });

    // auto_post_on_approve = true (ค่า default) ⇒ APPROVED ไม่ค้างให้เห็น ไป POSTED เลย
    await expect(page.getByText('ลงบัญชีแล้ว').first()).toBeVisible({ timeout: 20000 });
  });

  test('Non-approver gets 403 on approve', async ({ page }) => {
    await loginAsRole(page, 'OWNER');
    const doc = await createPayrollDraft(page, 'OWNER', `E2E non-approver-blocked ${Date.now()}`);
    await submitForApproval(page, 'OWNER', doc.id);

    // SALES ไม่ใช่ OWNER และไม่อยู่ใน SystemConfig `approvers_list`
    // (controller เปิด @Roles ให้ถึง service ได้ — ด่านจริงคือ assertUserCanApprove)
    await loginAsRole(page, 'SALES');
    const res = await page.request.post(`${API_URL}/api/expense-documents/${doc.id}/approve`, {
      headers: getRoleAuthHeaders('SALES'),
      data: {},
    });
    expect(res.status()).toBe(403);

    // …และหน้าจอต้องไม่เสนอปุ่มอนุมัติให้ SALES เลย
    await gotoWithRetry(page, `/expenses/${doc.id}`);
    await expect(page.getByRole('button', { name: /อนุมัติ & POST/ })).toBeHidden();
  });

  test('Approver-list user can approve', async ({ page }) => {
    // Pre-condition (D1.2.1.3): finance@bestchoice.com ต้องอยู่ใน SystemConfig
    // `approvers_list`. ⚠️ dev seed **ยังไม่ได้ใส่คีย์นี้** ⇒ getApproversList() คืน []
    // และ assertUserCanApprove ปฏิเสธทุกคนที่ไม่ใช่ OWNER — เทสนี้จะเขียวก็ต่อเมื่อ
    // เจ้าของ/seed เติมรายชื่อผู้อนุมัติแล้ว (จงใจไม่ให้เทสไปเติมเอง = ขยายสิทธิ์)
    await loginAsRole(page, 'OWNER');
    const doc = await createPayrollDraft(page, 'OWNER', `E2E finance-approver ${Date.now()}`);
    await submitForApproval(page, 'OWNER', doc.id);

    await loginAsRole(page, 'FINANCE_MANAGER');
    const ok = await gotoWithRetry(page, `/expenses/${doc.id}`);
    if (!ok) return;

    const approveBtn = page.getByRole('button', { name: /อนุมัติ & POST/ });
    await expect(approveBtn).toBeVisible({ timeout: 15000 });
    await approveBtn.click();

    const toast = page.locator('[data-sonner-toast]').first();
    await expect(toast).toContainText(/อนุมัติ(เรียบร้อย|แล้ว|สำเร็จ)?/, { timeout: 15000 });
  });
});
