# หน้าสร้างเอกสารค่าใช้จ่ายแบบ PEAK — รอบ 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** หน้า `/expenses/new` เป็นหน้าเต็มโครง PEAK สำหรับทั้ง 6 ประเภทเอกสาร โดย "บันทึกค่าใช้จ่าย" (จ่ายทันที + ตั้งหนี้) ได้เนื้อในแบบ PEAK ครบ ส่วนอีก 4 ประเภทอยู่ในกรอบใหม่ด้วยเนื้อในเดิม และ payload ที่ส่งไป API เหมือนเดิมทุกฟิลด์

**Architecture:** `ExpenseFormV4` ยังถือ state, effect และ `saveMutation` เดิมทั้งหมด เปลี่ยนเฉพาะ JSX ที่ return ให้ประกอบจาก component แสดงผลใหม่ใต้ `components/expense-form-v4/layout/` เทสต์จับ payload ของฟอร์มปัจจุบันถูกเขียนและผ่านก่อน แล้วใช้เป็นตาข่ายตลอดการเปลี่ยนหน้าตา

**Tech Stack:** React 18, TypeScript, Tailwind (token ใน `apps/web/src/index.css`), shadcn/Radix (`components/ui/dropdown-menu`), TanStack Query, Vitest + Testing Library

**Spec:** `docs/superpowers/specs/2026-11-16-expense-create-peak-layout-design.md` · **Mockup:** https://claude.ai/artifact/9nJkBWATAsx5XfZJXR6VrD

รอบ 2 (เนื้อในของจ่ายเจ้าหนี้ / ใบลดหนี้ / เงินสดย่อย + แถว "รับเงินคืนเข้า") มีแผนแยก เขียนหลังรอบ 1 ส่ง

## Global Constraints

- ห้ามแก้ `apps/api` และห้ามแก้ `initial()`, effect ทุกตัว, `saveMutation`, `itemCount`, `ready` ใน `ExpenseFormV4.tsx`
- ห้ามแก้ body ที่คาดหวังใน `ExpenseFormV4.payloads.test.tsx` หลัง Task 1 — ถ้าต้องแก้ แปลว่า logic เปลี่ยน ให้หยุดแล้วรายงาน
- ข้อความบนจอ: ใช้ข้อความเดิมของฟอร์มทุกคำ ข้อความใหม่มีเฉพาะที่ระบุในแผนนี้
- สี: token เท่านั้น (`bg-card`, `text-muted-foreground`, `border-border`, `bg-primary text-primary-foreground`, `text-warning-strong`) ห้าม hex, `gray-*`, `amber-*`, `text-white`
- ช่องกรอกใช้ `formControlClass` / `formLabelClass` (`components/ui/form-styles.ts`), `NativeSelect`, `NumberInput`, `ReadOnlyField`
- ข้อความไทยใช้ `leading-snug` · ปุ่มและช่องแตะสูงอย่างน้อย `min-h-11`
- Dropdown ใช้ตัวที่โปรแกรมใช้อยู่แล้วเท่านั้น (spec §9.1): รายการสั้น = `NativeSelect` · บัญชี = `AccountSearchDropdown` (ค้นหาได้) · ผู้ขาย = `VendorCombobox` (ค้นหาได้) · บัญชีเงิน = `CashAccountSelect` · เมนูประเภท = `components/ui/dropdown-menu` — ไม่สร้าง dropdown ชนิดใหม่ (ตัวกลาง `Combobox` เป็นงานรอบ 2 ของ spec `2026-11-14-dropdown-search-field-scale-design.md`)
- ไม่ย้ายและไม่เปลี่ยนชื่อ `AdjustmentSection.tsx` (`pages/__tests__/tabsButtonRowsNowrap.test.ts` อ่านซอร์สไฟล์นี้)
- Commit เฉพาะเมื่อเจ้าของสั่งให้เริ่มทำแผนนี้ · ข้อความ commit ลงท้ายด้วย `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
- คำสั่งเทสต์ทุกตัวรันจาก `apps/web`: `npx vitest run <path>`

## File Structure

| ไฟล์ | สถานะ | หน้าที่ |
|---|---|---|
| `apps/web/src/components/expense-form-v4/__tests__/ExpenseFormV4.payloads.test.tsx` | สร้าง | จับ POST body ของทุกประเภท (ยกเว้นเงินเดือน) |
| `apps/web/src/components/expense-form-v4/__tests__/expense-form-driver.ts` | สร้าง | ขั้นตอนกดจอ — ไฟล์เดียวที่แก้ได้เมื่อหน้าตาเปลี่ยน |
| `apps/web/src/components/expense-form-v4/layout/DocCard.tsx` | สร้าง | การ์ดใหญ่ของหน้า |
| `.../layout/FormRow.tsx` | สร้าง | แถวหนึ่งส่วน (ป้ายซ้าย / ป้ายบน) |
| `.../layout/SummaryBox.tsx` | สร้าง | ตัวเลขย่อย + ยอดเด่น |
| `.../layout/StickyActionBar.tsx` | สร้าง | แถบปุ่มติดล่างจอ |
| `.../layout/DocTypeMenu.tsx` | สร้าง | เมนูสลับประเภท (แทน `DocTypePicker`) |
| `.../layout/DocHeader.tsx` | สร้าง | หัวการ์ด |
| `.../layout/PaymentSection.tsx` | สร้าง | ส่วนชำระเงิน |
| `apps/web/src/pages/other-income/components/AccountSearchDropdown.tsx` + เทสต์ | แก้ | แสดงเลขบัญชี + หัวข้อกลุ่ม (Task 4b) |
| `.../layout/__tests__/*.test.tsx` | สร้าง | เทสต์ของ component ข้างบน |
| `.../VendorSection.tsx` | แก้ | แยก `PricingSection` · ตัดช่องเลขใบกำกับ |
| `.../ItemLinesSection.tsx` | แก้ | ตารางบนจอใหญ่ · การ์ดบนจอเล็ก |
| `.../ExpenseFormV4.tsx` | แก้ | JSX ที่ return + `beforeunload` |
| `.../DocTypePicker.tsx` + เทสต์ | ลบ | ไม่มีผู้ใช้หลัง Task 6 |
| `apps/web/src/pages/ExpenseDocumentNewPage.tsx` + เทสต์ | แก้ | `?branch=` · กลับหน้ารายการพร้อมตัวกรอง |
| `apps/web/src/pages/ExpensesPage.tsx` + `ExpensesPage.ux.test.tsx` | แก้ | เลิก modal · ปุ่มสร้างพาไปหน้าเต็ม |
| `apps/web/src/components/layout/mobile-nav-visibility.ts` + เทสต์ | สร้าง | ตัดสินว่า path ไหนแสดงเมนูล่าง |
| `apps/web/src/components/layout/MainLayout.tsx` | แก้ | ใช้ฟังก์ชันข้างบน |
| `apps/api/e2e/ui-fields/fields.audit-spec.ts`, `dialogs.audit-spec.ts`, `tools/field-scale/routes.mjs` | แก้ | ให้ตรงหน้าใหม่ |

---

### Task 0: Branch

- [ ] **Step 1: แตก branch จาก `feat/field-scale-round1`**

```bash
cd "d:/BESTCHOICE APP/BESTCHOICE"
git status --short            # ต้องมีแค่ไฟล์ spec/plan ของงานนี้
# feat/field-scale-round1 ถูก squash-merge เข้า main แล้ว (#1780) — แตกจาก main
git fetch origin main
git switch -c feat/expense-create-peak-layout origin/main
```

- [ ] **Step 2: Commit spec และแผน**

```bash
git add docs/superpowers/specs/2026-11-16-expense-create-peak-layout-design.md docs/superpowers/plans/2026-11-16-expense-create-peak-layout-round1.md
git commit -m "docs: spec + round 1 plan for PEAK-style expense create page"
```

---

### Task 1: เทสต์จับ payload ของฟอร์มปัจจุบัน

เทสต์ชุดนี้ต้องผ่านกับโค้ด**ก่อน**แก้อะไร ถ้าเคสใดไม่ผ่านเพราะ driver กดจอไม่ถูก ให้แก้ driver ไม่ใช่แก้ฟอร์ม

**Files:**
- Create: `apps/web/src/components/expense-form-v4/__tests__/expense-form-driver.ts`
- Create: `apps/web/src/components/expense-form-v4/__tests__/ExpenseFormV4.payloads.test.tsx`

**Interfaces:**
- Produces: `chooseKind(user, kind)`, `fillExpenseLine(user, {account, unitPrice}, index?)`, `openAdjustments(user)`, `saveDraft(user)`, type `Kind = 'EXPENSE_PAID' | 'EXPENSE_UNPAID' | 'VENDOR_SETTLEMENT' | 'CREDIT_NOTE' | 'PETTY_CASH'` — Task 6 แก้เนื้อในของฟังก์ชันเหล่านี้โดยคงชื่อและ signature

- [ ] **Step 1: เขียน driver สำหรับหน้าจอปัจจุบัน**

```ts
// apps/web/src/components/expense-form-v4/__tests__/expense-form-driver.ts
import { screen, waitFor } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';
import { expect } from 'vitest';

/** ประเภทเอกสารในมุมของผู้ใช้ — วิธีเลือกบนจออยู่ในไฟล์นี้ไฟล์เดียว */
export type Kind = 'EXPENSE_PAID' | 'EXPENSE_UNPAID' | 'VENDOR_SETTLEMENT' | 'CREDIT_NOTE' | 'PETTY_CASH';

const CHIP: Record<Kind, RegExp> = {
  EXPENSE_PAID: /^จ่ายทันที/,
  EXPENSE_UNPAID: /^ตั้งหนี้/,
  VENDOR_SETTLEMENT: /^จ่ายเจ้าหนี้/,
  CREDIT_NOTE: /^ใบลดหนี้/,
  PETTY_CASH: /^เงินสดย่อย/,
};

export async function chooseKind(user: UserEvent, kind: Kind) {
  await user.click(screen.getByRole('button', { name: CHIP[kind] }));
}

export async function fillExpenseLine(
  user: UserEvent,
  line: { account: string; unitPrice: string },
  index = 0,
) {
  await user.selectOptions(screen.getAllByLabelText('บัญชีค่าใช้จ่าย')[index], line.account);
  const price = screen.getAllByLabelText('ราคา/หน่วย')[index];
  await user.clear(price);
  await user.type(price, line.unitPrice);
}

/** เปิดส่วนที่มีช่อง "ยอดที่จ่ายจริง" — หน้าจอปัจจุบันแสดงอยู่แล้วเมื่อเป็นจ่ายทันที */
export async function openAdjustments(_user: UserEvent) {
  await screen.findByLabelText('ยอดที่จ่ายจริง');
}

export async function saveDraft(user: UserEvent) {
  const button = screen.getByRole('button', { name: 'บันทึกร่าง' });
  await waitFor(() => expect(button).toBeEnabled());
  await user.click(button);
}
```

- [ ] **Step 2: เขียนเทสต์ payload**

```tsx
// apps/web/src/components/expense-form-v4/__tests__/ExpenseFormV4.payloads.test.tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { chooseKind, fillExpenseLine, openAdjustments, saveDraft, type Kind } from './expense-form-driver';

/**
 * จับ body ที่ฟอร์มส่งไป API ของทุกประเภทเอกสาร (เงินเดือนอยู่ใน ExpenseFormV4.payroll.test.tsx)
 * งานเปลี่ยนหน้าตา (spec 2026-11-16) แก้ได้เฉพาะ expense-form-driver.ts — ห้ามแก้ body ที่คาดหวังในไฟล์นี้
 */

const apiGet = vi.fn();
const apiPost = vi.fn();
vi.mock('@/lib/api', () => ({
  default: {
    get: (...a: unknown[]) => apiGet(...a),
    post: (...a: unknown[]) => apiPost(...a),
    patch: vi.fn(),
  },
  getErrorMessage: (e: { message?: string }) => e?.message ?? 'ผิดพลาด',
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'me', name: 'ผู้ทดสอบ', role: 'OWNER', branchId: 'b1', defaultCashAccountCode: '11-1101' },
  }),
}));
vi.mock('@/hooks/useAccountingPermissions', () => ({
  useAccountingPermissions: () => ({ can: () => true, isError: false, isPending: false, refetch: vi.fn() }),
}));
// ค่าที่ฟอร์มอ่านจาก useUiFlags — ถ้าส่วนใดอ่าน flag อื่น ให้เติมค่าจาก DEFAULT_UI_FLAGS (hooks/useUiFlags.ts)
const flags = vi.hoisted(() => ({ smartDoctypeSwitchEnabled: false }));
vi.mock('@/hooks/useUiFlags', () => ({
  useUiFlags: () => ({
    smartSwitchThresholdDays: 0,
    pettyCashEnabled: true,
    templatesEnabled: false,
    approvalEnabled: false,
    approvalThreshold: 1000,
    approvalRequiredDocTypes: [],
    taxExemptWarningEnabled: true,
    whtRates: [{ rate: 0, label: 'ไม่หัก' }, { rate: 3, label: '3% — ค่าบริการ' }],
    adjustmentCodes: { underpay: '52-1104', overpay: '53-1503' },
    settlementDefaultTick: 'all',
    settlementMaxBillsPerDoc: 100,
    settlementPartialPaymentEnabled: true,
    ...flags,
  }),
}));
// ตัวเลือกผู้ขายจริงค้น server — แทนด้วยปุ่มที่เลือกผู้ขายคนเดียว
vi.mock('../VendorCombobox', () => ({
  VendorCombobox: ({ id, value, onSelectSupplier }: { id?: string; value: string; onSelectSupplier: (s: unknown) => void }) => (
    <button id={id} type="button" onClick={() => onSelectSupplier({ name: 'ร้านตัวอย่าง', taxId: '', supplierId: 'sup-1' })}>
      {value || 'เลือกผู้ขาย'}
    </button>
  ),
}));
vi.mock('@/pages/other-income/components/AccountSearchDropdown', () => ({
  // ตัวเลือกบัญชีจริงเป็น popover ค้นหาได้ (มีเทสต์ของตัวเอง) — แทนด้วยปุ่มที่เลือก 53-1101
  AccountSearchDropdown: (props: { value: string; onChange: (code: string) => void; 'aria-label'?: string }) => (
    <button type="button" aria-label={props['aria-label'] ?? 'บัญชี'} onClick={() => props.onChange('53-1101')}>
      {props.value || '—'}
    </button>
  ),
}));
// ปฏิทินไทยเป็น popover — แทนด้วยช่องวันที่ธรรมดาที่ส่งค่า ISO เหมือนของจริง
vi.mock('@/components/ui/ThaiDateInput', () => ({
  default: ({ id, value, onChange }: { id?: string; value: string; onChange: (e: { target: { value: string } }) => void }) => (
    <input id={id} aria-label="วันที่ใบกำกับ (ทดสอบ)" value={value} onChange={(e) => onChange({ target: { value: e.target.value } })} />
  ),
}));

import { ExpenseFormV4 } from '../ExpenseFormV4';

const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
const ACCRUAL_DOC = {
  id: 'acc-1', number: 'EX-009', vendorName: 'เจ้าหนี้ตัวอย่าง', totalAmount: '1000.00',
  documentDate: today, status: 'ACCRUAL', branch: { id: 'b1', name: 'สาขาทดสอบ' },
};
const ORIGINAL_DOC = {
  id: 'orig-1', number: 'EX-001', vendorName: 'ผู้ขายเดิม', totalAmount: '1070.00', status: 'POSTED',
  documentDate: '2026-11-01', expenseDetail: { lines: [{ category: '53-1101', amountBeforeVat: '1000' }] },
  branch: { id: 'b1', name: 'สาขาทดสอบ' },
};

beforeEach(() => {
  vi.clearAllMocks();
  flags.smartDoctypeSwitchEnabled = false;
  apiGet.mockImplementation((path: string) => {
    if (path === '/chart-of-accounts/grouped') {
      return Promise.resolve({ data: { groups: [{ accounts: [{ code: '53-1101', name: 'ค่าไฟฟ้า' }] }] } });
    }
    if (path.startsWith('/expense-documents?') && path.includes('status=ACCRUAL')) {
      return Promise.resolve({ data: { data: [ACCRUAL_DOC] } });
    }
    if (path.startsWith('/expense-documents?') && path.includes('search=')) {
      return Promise.resolve({ data: { data: [ORIGINAL_DOC] } });
    }
    if (path.endsWith('/cn-cap')) {
      return Promise.resolve({ data: { originalTotal: '1070.00', usedTotal: '0.00', remainingCap: '1070.00' } });
    }
    return Promise.resolve({ data: [] });
  });
  apiPost.mockImplementation((path: string) => {
    if (path === '/expense-documents/preview-je') {
      return Promise.resolve({
        data: {
          flow: 'expense-same-day', lines: [],
          totals: {
            subtotal: '850.00', vatAmount: '59.50', withholdingTax: '0.00', totalAmount: '909.50',
            netPayment: '909.50', drSum: '909.50', crSum: '909.50', balanced: true,
          },
        },
      });
    }
    return Promise.resolve({ data: { id: 'new-1' } });
  });
});

function mount() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <ExpenseFormV4 branchId="b1" onSaved={vi.fn()} onClose={vi.fn()} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

const bodyOf = async (path: string) => {
  await waitFor(() => expect(apiPost.mock.calls.some((c) => c[0] === path)).toBe(true));
  return apiPost.mock.calls.find((c) => c[0] === path)![1];
};

const EXPENSE_LINE = { category: '53-1101', quantity: 1, unitPrice: 850, discount: 0, vatPercent: 7, whtPercent: 0 };

describe('ExpenseFormV4 — body ที่ส่งไป API', () => {
  it('รายจ่ายจ่ายทันที ส่งวิธีจ่ายและบัญชีเงิน', async () => {
    const user = mount();
    await chooseKind(user, 'EXPENSE_PAID');
    await fillExpenseLine(user, { account: '53-1101', unitPrice: '850' });
    await saveDraft(user);
    expect(await bodyOf('/expense-documents')).toEqual({
      documentType: 'EXPENSE', branchId: 'b1', documentDate: today, priceType: 'EXCLUSIVE',
      paymentMethod: 'CASH', depositAccountCode: '11-1101', taxDisallowed: false,
      lines: [EXPENSE_LINE],
    });
  });

  it('รายจ่ายตั้งหนี้ ไม่ส่งวิธีจ่ายและบัญชีเงิน', async () => {
    const user = mount();
    await chooseKind(user, 'EXPENSE_UNPAID');
    await fillExpenseLine(user, { account: '53-1101', unitPrice: '850' });
    await saveDraft(user);
    expect(await bodyOf('/expense-documents')).toEqual({
      documentType: 'EXPENSE', branchId: 'b1', documentDate: today, priceType: 'EXCLUSIVE',
      taxDisallowed: false, lines: [EXPENSE_LINE],
    });
  });

  it('รายจ่ายจ่ายทันทีที่กรอกยอดจ่ายจริง ส่ง amountPaid', async () => {
    const user = mount();
    await chooseKind(user, 'EXPENSE_PAID');
    await fillExpenseLine(user, { account: '53-1101', unitPrice: '850' });
    await openAdjustments(user);
    await user.type(screen.getByLabelText('ยอดที่จ่ายจริง'), '910');
    await saveDraft(user);
    expect(await bodyOf('/expense-documents')).toEqual({
      documentType: 'EXPENSE', branchId: 'b1', documentDate: today, priceType: 'EXCLUSIVE',
      paymentMethod: 'CASH', depositAccountCode: '11-1101', taxDisallowed: false,
      lines: [EXPENSE_LINE], amountPaid: '910',
    });
  });

  it('วันที่ใบกำกับย้อนหลังเมื่อเปิดสลับอัตโนมัติ กลายเป็นตั้งหนี้', async () => {
    flags.smartDoctypeSwitchEnabled = true;
    const user = mount();
    fireEvent.change(screen.getByLabelText('วันที่ใบกำกับ (ทดสอบ)'), { target: { value: '2026-01-05' } });
    await fillExpenseLine(user, { account: '53-1101', unitPrice: '850' });
    await saveDraft(user);
    expect(await bodyOf('/expense-documents')).toEqual({
      documentType: 'EXPENSE', branchId: 'b1', documentDate: '2026-01-05', priceType: 'EXCLUSIVE',
      taxDisallowed: false, lines: [EXPENSE_LINE],
    });
  });

  it('จ่ายเจ้าหนี้ ส่งเอกสารที่เลือกและบัญชีเงิน', async () => {
    const user = mount();
    await chooseKind(user, 'VENDOR_SETTLEMENT');
    await screen.findByText('EX-009');
    await saveDraft(user);
    expect(await bodyOf('/expense-documents/settlement')).toEqual({
      branchId: 'b1', documentDate: today, depositAccountCode: '11-1101', paymentMethod: 'BANK_TRANSFER',
      lines: [{ clearedDocumentId: 'acc-1', amountSettled: 1000 }],
    });
  });

  it('ใบลดหนี้แบบอ้างอิงเอกสาร ส่งเอกสารต้นฉบับและบัญชีเงิน', async () => {
    const user = mount();
    await chooseKind(user, 'CREDIT_NOTE');
    await user.type(screen.getByLabelText('ค้นหาเลข EX-... / ผู้ขาย (3 ตัวขึ้นไป)'), 'EX-0');
    await user.click(await screen.findByRole('button', { name: /EX-001/ }));
    await user.type(await screen.findByLabelText(/^เหตุผล/), 'คืนสินค้า');
    await saveDraft(user);
    expect(await bodyOf('/expense-documents/credit-note')).toEqual({
      mode: 'LINKED', branchId: 'b1', documentDate: today, originalDocumentId: 'orig-1',
      reason: 'คืนสินค้า', depositAccountCode: '11-1101',
      lines: [{ category: '53-1101', quantity: 1, unitPrice: 1000, discount: 0, vatPercent: 7, whtPercent: 0 }],
    });
  });

  it('ใบลดหนี้แบบไม่มีเอกสารต้นทาง ส่งชื่อผู้ขาย ไม่ส่งบัญชีเงิน', async () => {
    const user = mount();
    await chooseKind(user, 'CREDIT_NOTE');
    await user.click(screen.getByRole('button', { name: /^ไม่มีเอกสารต้นทาง/ }));
    await user.type(screen.getByLabelText(/^ชื่อผู้ขาย/), 'ร้านตัวอย่าง');
    await user.type(screen.getByLabelText(/^เหตุผล/), 'ส่วนลดพิเศษ');
    await fillExpenseLine(user, { account: '53-1101', unitPrice: '500' });
    await saveDraft(user);
    expect(await bodyOf('/expense-documents/credit-note')).toEqual({
      mode: 'STANDALONE', branchId: 'b1', documentDate: today, vendorName: 'ร้านตัวอย่าง',
      reason: 'ส่วนลดพิเศษ',
      lines: [{ category: '53-1101', quantity: 1, unitPrice: 500, discount: 0, vatPercent: 7, whtPercent: 0 }],
    });
  });

  it('เงินสดย่อย ส่งบรรทัดพร้อมผู้ขายและบัญชีเงิน', async () => {
    const user = mount();
    await chooseKind(user, 'PETTY_CASH' as Kind);
    await user.click(screen.getByRole('button', { name: 'เลือกผู้ขาย' }));
    await user.click(screen.getByRole('button', { name: 'บัญชี' }));
    await user.type(screen.getByPlaceholderText('0.00'), '120');
    await saveDraft(user);
    expect(await bodyOf('/expense-documents/petty-cash')).toEqual({
      branchId: 'b1', documentDate: today, depositAccountCode: '11-1101',
      lines: [{ supplierName: 'ร้านตัวอย่าง', supplierId: 'sup-1', category: '53-1101', amount: 120, vatPercent: 0 }],
    });
  });
});
```

- [ ] **Step 3: รันกับฟอร์มปัจจุบัน**

Run: `npx vitest run src/components/expense-form-v4/__tests__/ExpenseFormV4.payloads.test.tsx`
Expected: PASS 8 เคส

เคสที่ไม่ผ่าน ให้แยกสาเหตุ:
- หา element ไม่เจอ / ปุ่มยังปิด → แก้ `expense-form-driver.ts` หรือ mock (เช่น flag ที่ขาดใน `useUiFlags`)
- body ต่างจากที่คาด → เทียบกับ `saveMutation` ใน `ExpenseFormV4.tsx:337-549` แล้วแก้ body ที่คาดหวังให้ตรงกับ**พฤติกรรมปัจจุบัน** พร้อมบันทึกในข้อความ commit ว่าแก้เคสใดและเพราะอะไร (แก้ได้เฉพาะใน Task นี้)

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/expense-form-v4/__tests__/expense-form-driver.ts apps/web/src/components/expense-form-v4/__tests__/ExpenseFormV4.payloads.test.tsx
git commit -m "test(web): pin expense form request bodies before the layout change"
```

---

### Task 2: component โครงหน้า — DocCard, FormRow, SummaryBox, StickyActionBar

**Files:**
- Create: `apps/web/src/components/expense-form-v4/layout/DocCard.tsx`, `FormRow.tsx`, `SummaryBox.tsx`, `StickyActionBar.tsx`
- Test: `apps/web/src/components/expense-form-v4/layout/__tests__/layout-primitives.test.tsx`

**Interfaces:**
- Produces:
  - `DocCard({ banner?: ReactNode; children: ReactNode })`
  - `FormRow({ title: string; layout?: 'side' | 'stacked'; complete?: boolean; action?: ReactNode; children: ReactNode })`
  - `SummaryBox({ rows: { label: string; value: string }[]; total: { label: string; value: string } })`
  - `StickyActionBar({ summary: ReactNode; notices?: ReactNode; children: ReactNode })`

- [ ] **Step 1: เขียนเทสต์ที่ยังไม่ผ่าน**

```tsx
// apps/web/src/components/expense-form-v4/layout/__tests__/layout-primitives.test.tsx
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DocCard } from '../DocCard';
import { FormRow } from '../FormRow';
import { SummaryBox } from '../SummaryBox';
import { StickyActionBar } from '../StickyActionBar';

describe('โครงหน้าเอกสาร', () => {
  it('FormRow แสดงหัวข้อ เนื้อหา และปุ่มท้ายหัวข้อ', () => {
    render(<FormRow title="ข้อมูลผู้ขาย" action={<button type="button">ย่อ/ขยาย</button>}><p>เนื้อหา</p></FormRow>);
    const row = screen.getByRole('region', { name: 'ข้อมูลผู้ขาย' });
    expect(within(row).getByText('เนื้อหา')).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: 'ย่อ/ขยาย' })).toBeInTheDocument();
  });

  it('SummaryBox แสดงตัวเลขตามที่ได้รับ ไม่คำนวณเอง', () => {
    render(<SummaryBox rows={[{ label: 'มูลค่าก่อนภาษี', value: '850.00' }, { label: 'ภาษีมูลค่าเพิ่ม', value: '—' }]} total={{ label: 'จำนวนเงินทั้งสิ้น', value: '909.50' }} />);
    expect(screen.getByText('มูลค่าก่อนภาษี').nextElementSibling).toHaveTextContent('850.00');
    expect(screen.getByText('ภาษีมูลค่าเพิ่ม').nextElementSibling).toHaveTextContent('—');
    expect(screen.getByText('จำนวนเงินทั้งสิ้น').parentElement).toHaveTextContent('909.50');
  });

  it('StickyActionBar วางข้อความแจ้งเตือนไว้ก่อนแถวปุ่ม', () => {
    render(<StickyActionBar summary={<span>1 รายการ</span>} notices={<p role="alert">ผิดพลาด</p>}><button type="button">บันทึกร่าง</button></StickyActionBar>);
    const alert = screen.getByRole('alert');
    const button = screen.getByRole('button', { name: 'บันทึกร่าง' });
    expect(alert.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('DocCard วางแบนเนอร์ไว้บนสุด', () => {
    render(<DocCard banner={<p>แบนเนอร์</p>}><p>เนื้อหา</p></DocCard>);
    expect(screen.getByText('แบนเนอร์').compareDocumentPosition(screen.getByText('เนื้อหา')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
```

- [ ] **Step 2: รันให้เห็นว่าไม่ผ่าน**

Run: `npx vitest run src/components/expense-form-v4/layout/__tests__/layout-primitives.test.tsx`
Expected: FAIL — หาไฟล์ `../DocCard` ไม่เจอ

- [ ] **Step 3: เขียน component**

```tsx
// apps/web/src/components/expense-form-v4/layout/DocCard.tsx
import type { ReactNode } from 'react';

/** การ์ดใหญ่ใบเดียวของหน้าเอกสาร — แถวข้างในคั่นกันด้วยเส้นของ FormRow */
export function DocCard({ banner, children }: { banner?: ReactNode; children: ReactNode }) {
  return (
    <div className="min-w-0 rounded-xl border border-border bg-card px-4 sm:px-6">
      {banner && <div className="pt-4">{banner}</div>}
      {children}
    </div>
  );
}
```

```tsx
// apps/web/src/components/expense-form-v4/layout/FormRow.tsx
import { useId, type ReactNode } from 'react';
import { CheckCircle2, Circle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  title: string;
  /** side = ป้ายซ้าย (จอ ≥ lg) · stacked = ป้ายบน เนื้อหากว้างเต็ม (ตาราง) */
  layout?: 'side' | 'stacked';
  /** ไม่ส่ง = ไม่มีเครื่องหมาย · สถานะนี้ซ้ำกับบรรทัด "พร้อมบันทึก" ในแถบล่าง จึงซ่อนจาก screen reader */
  complete?: boolean;
  action?: ReactNode;
  children: ReactNode;
}

export function FormRow({ title, layout = 'side', complete, action, children }: Props) {
  const headingId = useId();
  const Mark = complete ? CheckCircle2 : Circle;
  return (
    <section
      aria-labelledby={headingId}
      className={cn('border-t border-border py-5', layout === 'side' && 'lg:grid lg:grid-cols-[200px_minmax(0,1fr)] lg:gap-6')}
    >
      <div className={cn('mb-3 flex items-center justify-between gap-3', layout === 'side' && 'lg:mb-0 lg:items-start')}>
        <h3 id={headingId} className="flex items-center gap-2 text-sm font-semibold leading-snug">
          {complete !== undefined && (
            <Mark className={cn('size-4 shrink-0', complete ? 'text-primary' : 'text-muted-foreground')} aria-hidden="true" />
          )}
          {title}
        </h3>
        {action}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}
```

```tsx
// apps/web/src/components/expense-form-v4/layout/SummaryBox.tsx
interface Props {
  /** ค่าที่จัดรูปแล้ว — component นี้ไม่คำนวณและไม่จัดรูปตัวเลข */
  rows: { label: string; value: string }[];
  total: { label: string; value: string };
}

export function SummaryBox({ rows, total }: Props) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-x-8 gap-y-4">
      <dl className="grid grid-cols-[auto_auto] gap-x-8 gap-y-1.5 text-sm leading-snug">
        {rows.map((row) => (
          <div key={row.label} className="contents">
            <dt className="text-muted-foreground">{row.label}</dt>
            <dd className="text-right tabular-nums">{row.value}</dd>
          </div>
        ))}
      </dl>
      <div className="flex w-full items-baseline justify-between gap-4 rounded-lg bg-primary px-5 py-4 text-primary-foreground sm:w-80">
        <span className="text-sm font-medium leading-snug">{total.label}</span>
        <span className="text-2xl font-bold leading-snug tabular-nums">{total.value}</span>
      </div>
    </div>
  );
}
```

```tsx
// apps/web/src/components/expense-form-v4/layout/StickyActionBar.tsx
import type { ReactNode } from 'react';

interface Props {
  summary: ReactNode;
  /** ข้อความแจ้งเตือน — อยู่เหนือแถวปุ่มเสมอ ไม่ถูกแถบบัง */
  notices?: ReactNode;
  children: ReactNode;
}

/** แถบปุ่มติดขอบล่างจอ · ขอบซ้ายขวาติดลบเท่า padding ของ PageShell (px-4 / lg:px-7) */
export function StickyActionBar({ summary, notices, children }: Props) {
  return (
    <div className="sticky bottom-0 z-20 -mx-4 mt-6 border-t border-border bg-background lg:-mx-7">
      {notices}
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:px-7">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm leading-snug">{summary}</div>
        <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap">{children}</div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: รันให้ผ่าน**

Run: `npx vitest run src/components/expense-form-v4/layout/__tests__/layout-primitives.test.tsx`
Expected: PASS 4 เคส

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/expense-form-v4/layout
git commit -m "feat(web): layout primitives for the document create page"
```

---

### Task 3: DocTypeMenu และ DocHeader

**Files:**
- Create: `apps/web/src/components/expense-form-v4/layout/DocTypeMenu.tsx`, `DocHeader.tsx`
- Test: `apps/web/src/components/expense-form-v4/layout/__tests__/DocTypeMenu.test.tsx`

**Interfaces:**
- Consumes: `DocType` จาก `../types`
- Produces:
  - `docTypeLabel(t: DocType): string` — `EXPENSE_SAMEDAY`/`EXPENSE_ACCRUAL` → `'บันทึกค่าใช้จ่าย'` · `VENDOR_SETTLEMENT` → `'จ่ายชำระเจ้าหนี้'` · `PAYROLL` → `'เงินเดือน'` · `CREDIT_NOTE` → `'ใบลดหนี้'` · `PETTY_CASH_REIMBURSEMENT` → `'เงินสดย่อย'`
  - `DocTypeMenu({ value: DocType; onChange: (t: DocType) => void; pettyCashEnabled?: boolean; payrollEnabled?: boolean; locked?: boolean })`
  - `DocHeader({ docType, onDocTypeChange, pettyCashEnabled, payrollEnabled, typeLocked, statusLabel, branchName?, documentNumber?, taxInvoice?: { value: string; onChange: (v: string) => void } })`

- [ ] **Step 1: เขียนเทสต์ที่ยังไม่ผ่าน** (รวมกติกาเจ้าของ 2026-10-28 ที่ย้ายมาจาก `DocTypePicker.payroll.test.tsx`)

```tsx
// apps/web/src/components/expense-form-v4/layout/__tests__/DocTypeMenu.test.tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DocTypeMenu, docTypeLabel } from '../DocTypeMenu';

const open = async () => {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: /^เปลี่ยนประเภทเอกสาร/ }));
  return user;
};

describe('DocTypeMenu', () => {
  it('จ่ายทันทีและตั้งหนี้ใช้ชื่อเดียวกัน', () => {
    expect(docTypeLabel('EXPENSE_SAMEDAY')).toBe('บันทึกค่าใช้จ่าย');
    expect(docTypeLabel('EXPENSE_ACCRUAL')).toBe('บันทึกค่าใช้จ่าย');
  });

  it('แสดงครบ 5 รายการเมื่อเปิดทุกอย่าง', async () => {
    render(<DocTypeMenu value="EXPENSE_SAMEDAY" onChange={() => {}} />);
    await open();
    expect(screen.getAllByRole('menuitem').map((i) => i.textContent)).toEqual([
      'บันทึกค่าใช้จ่าย', 'จ่ายชำระเจ้าหนี้', 'เงินเดือน', 'ใบลดหนี้', 'เงินสดย่อย',
    ]);
  });

  // คำตัดสินเจ้าของ 2026-10-28 — ผู้จัดการสาขาไม่เห็น "เงินเดือน"
  it('ไม่มีเงินเดือนเมื่อ payrollEnabled=false และไม่มีเงินสดย่อยเมื่อปิด flag', async () => {
    render(<DocTypeMenu value="EXPENSE_SAMEDAY" onChange={() => {}} payrollEnabled={false} pettyCashEnabled={false} />);
    await open();
    expect(screen.queryByRole('menuitem', { name: 'เงินเดือน' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'เงินสดย่อย' })).not.toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'ใบลดหนี้' })).toBeInTheDocument();
  });

  it('เลือกประเภทอื่นแล้วส่งค่า · เลือกบันทึกค่าใช้จ่ายจากประเภทอื่นได้จ่ายทันที', async () => {
    const onChange = vi.fn();
    const { rerender } = render(<DocTypeMenu value="EXPENSE_SAMEDAY" onChange={onChange} />);
    let user = await open();
    await user.click(screen.getByRole('menuitem', { name: 'ใบลดหนี้' }));
    expect(onChange).toHaveBeenLastCalledWith('CREDIT_NOTE');
    rerender(<DocTypeMenu value="CREDIT_NOTE" onChange={onChange} />);
    user = await open();
    await user.click(screen.getByRole('menuitem', { name: 'บันทึกค่าใช้จ่าย' }));
    expect(onChange).toHaveBeenLastCalledWith('EXPENSE_SAMEDAY');
  });

  it('อยู่ที่ตั้งหนี้แล้วเลือกบันทึกค่าใช้จ่ายซ้ำ ไม่เปลี่ยนเป็นจ่ายทันที', async () => {
    const onChange = vi.fn();
    render(<DocTypeMenu value="EXPENSE_ACCRUAL" onChange={onChange} />);
    const user = await open();
    await user.click(screen.getByRole('menuitem', { name: 'บันทึกค่าใช้จ่าย' }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('locked แสดงชื่ออย่างเดียว ไม่มีปุ่มเปิดเมนู', () => {
    render(<DocTypeMenu value="PAYROLL" onChange={() => {}} locked />);
    expect(screen.getByRole('heading', { name: 'เงินเดือน' })).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: รันให้เห็นว่าไม่ผ่าน**

Run: `npx vitest run src/components/expense-form-v4/layout/__tests__/DocTypeMenu.test.tsx`
Expected: FAIL — หาไฟล์ `../DocTypeMenu` ไม่เจอ

- [ ] **Step 3: เขียน DocTypeMenu**

```tsx
// apps/web/src/components/expense-form-v4/layout/DocTypeMenu.tsx
import { Check, ChevronDown } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { DocType } from '../types';

type MenuKey = 'EXPENSE' | 'VENDOR_SETTLEMENT' | 'PAYROLL' | 'CREDIT_NOTE' | 'PETTY_CASH_REIMBURSEMENT';

const ITEMS: { key: MenuKey; label: string }[] = [
  { key: 'EXPENSE', label: 'บันทึกค่าใช้จ่าย' },
  { key: 'VENDOR_SETTLEMENT', label: 'จ่ายชำระเจ้าหนี้' },
  { key: 'PAYROLL', label: 'เงินเดือน' },
  { key: 'CREDIT_NOTE', label: 'ใบลดหนี้' },
  { key: 'PETTY_CASH_REIMBURSEMENT', label: 'เงินสดย่อย' },
];

const menuKeyOf = (t: DocType): MenuKey =>
  t === 'EXPENSE_SAMEDAY' || t === 'EXPENSE_ACCRUAL' ? 'EXPENSE' : t;

export const docTypeLabel = (t: DocType): string =>
  ITEMS.find((item) => item.key === menuKeyOf(t))!.label;

interface Props {
  value: DocType;
  onChange: (t: DocType) => void;
  /** false = ไม่มีรายการ "เงินสดย่อย" (flag ปิด) */
  pettyCashEnabled?: boolean;
  /** false = ไม่มีรายการ "เงินเดือน" (ผู้จัดการสาขา — คำตัดสินเจ้าของ 2026-10-28) */
  payrollEnabled?: boolean;
  /** โหมดแก้ไขใบเงินเดือน — แสดงชื่ออย่างเดียว */
  locked?: boolean;
}

const titleClass = 'text-xl font-semibold leading-snug text-primary sm:text-2xl';

export function DocTypeMenu({ value, onChange, pettyCashEnabled = true, payrollEnabled = true, locked = false }: Props) {
  const current = menuKeyOf(value);
  if (locked) return <h2 className={titleClass}>{docTypeLabel(value)}</h2>;

  const items = ITEMS.filter(
    (item) =>
      (pettyCashEnabled || item.key !== 'PETTY_CASH_REIMBURSEMENT') && (payrollEnabled || item.key !== 'PAYROLL'),
  );
  const pick = (key: MenuKey) => {
    if (key === current) return;
    // "จ่ายทันที/ตั้งหนี้" เลือกในส่วนชำระเงิน — มาจากประเภทอื่นเริ่มที่จ่ายทันทีเหมือนกดชิปเดิม
    onChange(key === 'EXPENSE' ? 'EXPENSE_SAMEDAY' : key);
  };

  return (
    <h2 className="m-0">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`เปลี่ยนประเภทเอกสาร: ${docTypeLabel(value)}`}
            className="flex min-h-11 items-center gap-2 rounded-md text-left"
          >
            <span className={titleClass}>{docTypeLabel(value)}</span>
            <ChevronDown className="size-5 shrink-0 text-primary" aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-64">
          {items.map((item) => (
            <DropdownMenuItem
              key={item.key}
              onSelect={() => pick(item.key)}
              className="flex min-h-11 items-center justify-between gap-3 text-sm leading-snug"
            >
              {item.label}
              {item.key === current && <Check className="size-4 text-primary" aria-hidden="true" />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </h2>
  );
}
```

- [ ] **Step 4: เขียน DocHeader**

```tsx
// apps/web/src/components/expense-form-v4/layout/DocHeader.tsx
import { useId } from 'react';
import { formControlClass, formLabelClass } from '@/components/ui/form-styles';
import { ReadOnlyField } from '@/components/ui/readonly-field';
import type { DocType } from '../types';
import { DocTypeMenu } from './DocTypeMenu';

interface Props {
  docType: DocType;
  onDocTypeChange: (t: DocType) => void;
  pettyCashEnabled: boolean;
  payrollEnabled: boolean;
  typeLocked: boolean;
  statusLabel: string;
  branchName?: string;
  /** ไม่ส่ง = เอกสารใหม่ (server ออกเลขตอนบันทึก) */
  documentNumber?: string;
  /** ส่งเฉพาะประเภทที่มีช่องเลขใบกำกับ (รายจ่าย, ใบลดหนี้) */
  taxInvoice?: { value: string; onChange: (value: string) => void };
}

export function DocHeader({
  docType, onDocTypeChange, pettyCashEnabled, payrollEnabled, typeLocked,
  statusLabel, branchName, documentNumber, taxInvoice,
}: Props) {
  const fieldId = useId();
  return (
    <div className="flex flex-wrap items-start justify-between gap-4 py-5">
      <div className="flex min-w-0 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <DocTypeMenu
            value={docType}
            onChange={onDocTypeChange}
            pettyCashEnabled={pettyCashEnabled}
            payrollEnabled={payrollEnabled}
            locked={typeLocked}
          />
          <span className="shrink-0 rounded bg-muted px-2 py-1 text-xs leading-snug text-muted-foreground">
            {statusLabel}
          </span>
        </div>
        {branchName && <p className="text-sm leading-snug text-muted-foreground">สาขา: {branchName}</p>}
      </div>
      <div className="grid w-full grid-cols-1 gap-3 sm:w-auto sm:grid-cols-2">
        {taxInvoice && (
          <div>
            <label htmlFor={`${fieldId}-inv`} className={formLabelClass}>เลขใบกำกับ</label>
            <input
              id={`${fieldId}-inv`}
              type="text"
              value={taxInvoice.value}
              onChange={(e) => taxInvoice.onChange(e.target.value)}
              placeholder="INV-..."
              className={formControlClass}
            />
          </div>
        )}
        <div>
          <label htmlFor={`${fieldId}-no`} className={formLabelClass}>เลขที่เอกสาร</label>
          <ReadOnlyField id={`${fieldId}-no`} value={documentNumber ?? 'ออกเลขเมื่อบันทึก'} />
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: รันให้ผ่าน**

Run: `npx vitest run src/components/expense-form-v4/layout/__tests__/DocTypeMenu.test.tsx`
Expected: PASS 6 เคส
ถ้าเมนูไม่เปิดใน jsdom (Radix ต้องการ pointer capture) ให้ดูวิธีที่ `pages/ExpensesPage.ux.test.tsx` เปิดเมนูแถว แล้วใช้วิธีเดียวกันใน helper `open()`

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/expense-form-v4/layout
git commit -m "feat(web): document type menu and card header for the expense create page"
```

---

### Task 4: PaymentSection

**Files:**
- Create: `apps/web/src/components/expense-form-v4/layout/PaymentSection.tsx`
- Test: `apps/web/src/components/expense-form-v4/layout/__tests__/PaymentSection.test.tsx`

**Interfaces:**
- Produces:

```ts
interface PaymentSectionProps {
  /** ตัวเลือกบัญชีเงิน (label + CashAccountSelect) */
  picker: ReactNode;
  /** เฉพาะรายจ่าย: สลับ จ่ายแล้ว/ยังไม่ชำระ */
  unpaid?: { active: boolean; onMarkUnpaid: () => void; onMarkPaid: () => void; backdatedHint: boolean };
  /** ไม่ส่ง = ไม่มีสวิตช์ พื้นฐาน/ขั้นสูง */
  advanced?: { hasData: boolean; onClear: () => void; content: ReactNode };
  /** ข้อความใต้ตัวเลือกบัญชี (หมายเหตุของเงินเดือน) */
  footer?: ReactNode;
}
```

- [ ] **Step 1: เขียนเทสต์ที่ยังไม่ผ่าน**

```tsx
// apps/web/src/components/expense-form-v4/layout/__tests__/PaymentSection.test.tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PaymentSection } from '../PaymentSection';

const picker = <div>ตัวเลือกบัญชี</div>;
const content = <div>รายการปรับปรุง</div>;
const unpaid = (over: Partial<{ active: boolean; backdatedHint: boolean }> = {}) => ({
  active: false, backdatedHint: false, onMarkUnpaid: vi.fn(), onMarkPaid: vi.fn(), ...over,
});

describe('PaymentSection', () => {
  it('พื้นฐาน: เห็นตัวเลือกบัญชี ไม่เห็นรายการปรับปรุง · กดขั้นสูงแล้วเห็น', async () => {
    render(<PaymentSection picker={picker} advanced={{ hasData: false, onClear: vi.fn(), content }} />);
    expect(screen.getByText('ตัวเลือกบัญชี')).toBeInTheDocument();
    expect(screen.queryByText('รายการปรับปรุง')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: 'ขั้นสูง' }));
    expect(screen.getByText('รายการปรับปรุง')).toBeInTheDocument();
  });

  it('มีข้อมูลปรับปรุง: เปิดขั้นสูงเอง และกลับพื้นฐานไม่ได้จนกว่าจะล้าง', async () => {
    const onClear = vi.fn();
    render(<PaymentSection picker={picker} advanced={{ hasData: true, onClear, content }} />);
    expect(screen.getByText('รายการปรับปรุง')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'พื้นฐาน' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'ล้างรายการปรับปรุง' }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it('ไม่มี advanced: ไม่มีสวิตช์ พื้นฐาน/ขั้นสูง', () => {
    render(<PaymentSection picker={picker} footer={<p>หมายเหตุ</p>} />);
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    expect(screen.getByText('หมายเหตุ')).toBeInTheDocument();
  });

  it('กดยังไม่ชำระเงินแล้วเรียก onMarkUnpaid', async () => {
    const u = unpaid();
    render(<PaymentSection picker={picker} unpaid={u} />);
    await userEvent.click(screen.getByRole('button', { name: 'ยังไม่ชำระเงิน (ตั้งหนี้ไว้ก่อน)' }));
    expect(u.onMarkUnpaid).toHaveBeenCalledTimes(1);
  });

  it('ยังไม่ชำระ: ย่อเหลือบรรทัดเดียว มีลิงก์กลับ และไม่มีตัวเลือกบัญชี', async () => {
    const u = unpaid({ active: true, backdatedHint: true });
    render(<PaymentSection picker={picker} unpaid={u} />);
    expect(screen.getByText('ยังไม่ชำระเงิน — ตั้งหนี้ไว้ก่อน')).toBeInTheDocument();
    expect(screen.getByText('วันที่ใบกำกับไม่ใช่วันนี้ — เอกสารนี้ตั้งหนี้ไว้ก่อน')).toBeInTheDocument();
    expect(screen.queryByText('ตัวเลือกบัญชี')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'เพิ่มข้อมูลชำระเงิน' }));
    expect(u.onMarkPaid).toHaveBeenCalledTimes(1);
  });

  it('ยังไม่ชำระแต่มีข้อมูลปรับปรุงค้าง: เตือนและมีปุ่มล้าง', async () => {
    const onClear = vi.fn();
    render(<PaymentSection picker={picker} unpaid={unpaid({ active: true })} advanced={{ hasData: true, onClear, content }} />);
    expect(screen.getByRole('status')).toHaveTextContent('มีรายการปรับปรุงที่กรอกไว้ ซึ่งจะถูกบันทึกไปด้วย');
    await userEvent.click(screen.getByRole('button', { name: 'ล้างรายการปรับปรุง' }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: รันให้เห็นว่าไม่ผ่าน**

Run: `npx vitest run src/components/expense-form-v4/layout/__tests__/PaymentSection.test.tsx`
Expected: FAIL — หาไฟล์ `../PaymentSection` ไม่เจอ

- [ ] **Step 3: เขียน PaymentSection**

```tsx
// apps/web/src/components/expense-form-v4/layout/PaymentSection.tsx
import { useId, useState, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface Props {
  picker: ReactNode;
  unpaid?: { active: boolean; onMarkUnpaid: () => void; onMarkPaid: () => void; backdatedHint: boolean };
  advanced?: { hasData: boolean; onClear: () => void; content: ReactNode };
  footer?: ReactNode;
}

const linkClass = 'min-h-11 px-1 text-sm font-medium leading-snug text-primary underline underline-offset-2';

/** ส่วนชำระเงินแบบ PEAK — โหมด พื้นฐาน/ขั้นสูง เป็น state ของหน้าจอ ไม่มีผลกับ payload */
export function PaymentSection({ picker, unpaid, advanced, footer }: Props) {
  const headingId = useId();
  const [mode, setMode] = useState<'basic' | 'advanced'>('basic');
  // ข้อมูลที่กรอกไว้ต้องมองเห็นเสมอ — มีข้อมูลปรับปรุง = ขั้นสูง
  const showAdvanced = !!advanced && (mode === 'advanced' || advanced.hasData);

  if (unpaid?.active) {
    return (
      <section aria-labelledby={headingId} className="border-t border-border py-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm leading-snug">
            <h3 id={headingId} className="flex items-center gap-2 font-semibold">
              <Clock className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              ชำระเงิน
            </h3>
            <span className="text-muted-foreground">ยังไม่ชำระเงิน — ตั้งหนี้ไว้ก่อน</span>
          </div>
          <button type="button" className={linkClass} onClick={unpaid.onMarkPaid}>เพิ่มข้อมูลชำระเงิน</button>
        </div>
        {unpaid.backdatedHint && (
          <p className="mt-1 text-sm leading-snug text-muted-foreground">
            วันที่ใบกำกับไม่ใช่วันนี้ — เอกสารนี้ตั้งหนี้ไว้ก่อน
          </p>
        )}
        {advanced?.hasData && (
          <div role="status" className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2">
            <span className="flex items-center gap-2 text-sm leading-snug text-warning-strong">
              <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
              มีรายการปรับปรุงที่กรอกไว้ ซึ่งจะถูกบันทึกไปด้วย
            </span>
            <Button type="button" variant="outline" className="min-h-11" onClick={advanced.onClear}>ล้างรายการปรับปรุง</Button>
          </div>
        )}
      </section>
    );
  }

  return (
    <section aria-labelledby={headingId} className="border-t border-border py-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
          <h3 id={headingId} className="flex items-center gap-2 text-sm font-semibold leading-snug">
            <CheckCircle2 className="size-4 shrink-0 text-primary" aria-hidden="true" />
            ชำระเงิน
          </h3>
          {advanced && (
            <div role="radiogroup" aria-label="โหมดชำระเงิน" className="flex gap-4 text-sm leading-snug">
              <label className="flex min-h-11 items-center gap-1.5">
                <input
                  type="radio"
                  name={`${headingId}-mode`}
                  className="size-4 accent-primary"
                  checked={!showAdvanced}
                  disabled={advanced.hasData}
                  onChange={() => setMode('basic')}
                />
                พื้นฐาน
              </label>
              <label className="flex min-h-11 items-center gap-1.5">
                <input
                  type="radio"
                  name={`${headingId}-mode`}
                  className="size-4 accent-primary"
                  checked={showAdvanced}
                  onChange={() => setMode('advanced')}
                />
                ขั้นสูง
              </label>
            </div>
          )}
        </div>
        {unpaid && (
          <button type="button" className={linkClass} onClick={unpaid.onMarkUnpaid}>
            ยังไม่ชำระเงิน (ตั้งหนี้ไว้ก่อน)
          </button>
        )}
      </div>
      <div className="space-y-4 rounded-lg border border-dashed border-primary/30 bg-primary/5 p-4">
        {picker}
        {footer}
        {showAdvanced && advanced && (
          <div className="space-y-3 border-t border-primary/20 pt-4">
            {advanced.content}
            {advanced.hasData && (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm leading-snug text-muted-foreground">
                  มีรายการปรับปรุงอยู่ จึงกลับไป "พื้นฐาน" ไม่ได้จนกว่าจะล้างรายการ
                </p>
                <Button type="button" variant="outline" className="min-h-11" onClick={advanced.onClear}>ล้างรายการปรับปรุง</Button>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
```

- [ ] **Step 4: รันให้ผ่าน**

Run: `npx vitest run src/components/expense-form-v4/layout/__tests__/PaymentSection.test.tsx`
Expected: PASS 6 เคส

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/expense-form-v4/layout
git commit -m "feat(web): PEAK-style payment section with paid/unpaid and advanced mode"
```

---

### Task 4b: ตัวเลือกบัญชีแสดงเลขบัญชี + หัวข้อกลุ่ม (ทุกหน้าที่ใช้ `AccountSearchDropdown`)

คำตัดสินเจ้าของ 2026-11-16: ตัวเลือกบัญชีแบบค้นหาแสดง `เลขบัญชี - ชื่อ` และมีหัวข้อกลุ่มในรายการ แบบหน้า PEAK — มีผลกับทุกผู้ใช้ของ component นี้
(รายได้อื่น `ItemsTable` / `AdjustmentTable` / `EditableJournalTable`, เงินสดย่อย, และตารางรายจ่ายหลัง Task 5) · กลับคำสั่ง 2026-06-03 เฉพาะตัวเลือกนี้ ·
ชื่อยังตัดข้อความในวงเล็บตาม `accountDisplayName` เหมือนเดิม · ช่องเลือกบัญชีแบบ `NativeSelect` ในหน้าอื่นไม่แตะ

**Files:**
- Modify: `apps/web/src/pages/other-income/components/AccountSearchDropdown.tsx`
- Modify: `apps/web/src/pages/other-income/components/__tests__/AccountSearchDropdown.test.tsx`
- Modify: `apps/web/src/utils/accountName.ts` (คอมเมนต์หัวไฟล์)

**Interfaces:**
- Produces: `AccountSearchDropdown` props เดิมทุกตัว · ข้อความในปุ่มและในแต่ละตัวเลือก = `` `${code} - ${accountDisplayName(name)}` `` · ตัวเลือกอยู่ใต้ `role="group"` ที่ `aria-label` = ชื่อกลุ่ม (`CoaGroup.category`)

- [ ] **Step 1: เขียนเทสต์ที่ยังไม่ผ่าน** — เพิ่มใน `describe` หลักของ `AccountSearchDropdown.test.tsx`

```tsx
  it('แสดงเลขบัญชีนำหน้าชื่อ ทั้งในปุ่มและในรายการ', async () => {
    const user = userEvent.setup();
    render(<Harness initialValue="42-1105" />);
    expect(screen.getByRole('combobox')).toHaveTextContent('42-1105 - รายได้ดอกเบี้ยธนาคาร');
    await user.click(screen.getByRole('combobox'));
    expect(screen.getByRole('option', { name: '42-1101 - รายได้ค่าบริการ' })).toBeInTheDocument();
    // ชื่อยังตัดข้อความในวงเล็บตามเดิม
    expect(screen.getByRole('option', { name: '53-1301 - ค่าเช่า' })).toBeInTheDocument();
  });

  it('จัดตัวเลือกใต้หัวข้อกลุ่ม และไม่แสดงกลุ่มที่ไม่มีตัวเลือกเหลือ', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('combobox'));
    const income = screen.getByRole('group', { name: 'รายได้อื่น' });
    expect(within(income).getAllByRole('option')).toHaveLength(4);
    expect(within(screen.getByRole('group', { name: 'ค่าใช้จ่าย' })).getAllByRole('option')).toHaveLength(1);
    await user.type(screen.getByRole('textbox', { name: SEARCH }), '53-13');
    expect(screen.queryByRole('group', { name: 'รายได้อื่น' })).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: '53-1301 - ค่าเช่า' })).toBeInTheDocument();
  });

  it('ตัวกรองของผู้เรียกยังมีผล — กลุ่มที่ถูกกรองออกทั้งกลุ่มไม่แสดง', async () => {
    const user = userEvent.setup();
    render(<Harness filter={only42} />);
    await user.click(screen.getByRole('combobox'));
    expect(screen.queryByRole('group', { name: 'ค่าใช้จ่าย' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('option')).toHaveLength(4);
  });
```

และแก้เทสต์เดิมที่จับชื่อตัวเลือกแบบตรงทั้งคำ (บรรทัด ~150): `{ name: /^รายได้ดอกเบี้ยธนาคาร$/ }` → `{ name: '42-1105 - รายได้ดอกเบี้ยธนาคาร' }`
(เทสต์ที่ใช้ `toHaveTextContent('รายได้…')` หรือ regex ไม่ผูกหัวท้ายยังผ่านโดยไม่ต้องแก้)

- [ ] **Step 2: รันให้เห็นว่าไม่ผ่าน**

Run: `npx vitest run src/pages/other-income/components/__tests__/AccountSearchDropdown.test.tsx`
Expected: FAIL 3 เคสใหม่ + เคสที่แก้ชื่อ (ปุ่มและตัวเลือกยังไม่มีเลขบัญชี · ไม่มี `group`)

- [ ] **Step 3: แก้ `AccountSearchDropdown.tsx`**

แทนบล็อกที่คำนวณ `allAccounts` … `selected` (ถัดจาก `const optionId = ...`) ด้วย:

```tsx
  const allGroups = groups?.groups ?? [];
  const allAccounts: CoaItem[] = allGroups.flatMap((g) => g.accounts);
  const term = search.toLowerCase();
  const matches = (a: CoaItem) =>
    (filter ? filter(a) : true) &&
    (term ? a.code.toLowerCase().includes(term) || a.name.toLowerCase().includes(term) : true);
  // กลุ่มตามผังบัญชี — กลุ่มที่ไม่มีตัวเลือกเหลือหลังกรอง/ค้นหาไม่แสดง
  const visibleGroups = allGroups
    .map((g) => ({ category: g.category, accounts: g.accounts.filter(matches) }))
    .filter((g) => g.accounts.length > 0);
  // ลำดับของคีย์บอร์ด = ลำดับที่แสดงบนจอ
  const filtered = visibleGroups.flatMap((g) => g.accounts);
  const selectable = filtered.filter((a) => !isBlocked(a.code));
  const selected = allAccounts.find((a) => a.code === value);
  /** เลขบัญชีนำหน้าชื่อ (คำตัดสินเจ้าของ 2026-11-16 — แบบหน้า PEAK) */
  const labelOf = (a: CoaItem) => `${a.code} - ${accountDisplayName(a.name)}`;
```

ในปุ่ม trigger แทน `<span className="truncate">{accountDisplayName(selected.name)}</span>` ด้วย `<span className="truncate">{labelOf(selected)}</span>`

ใน listbox แทน `filtered.map((a) => { ... })` ด้วยการวนตามกลุ่ม โดย**ไม่แก้เนื้อในของตัวเลือก** ยกเว้นข้อความ:

```tsx
          {!isLoading &&
            visibleGroups.map((g) => (
              <div key={g.category} role="group" aria-label={g.category}>
                <div aria-hidden="true" className="px-3 pt-2 pb-1 text-xs leading-snug text-muted-foreground">
                  {g.category}
                </div>
                {g.accounts.map((a) => {
                  /* เนื้อในเดิมของ filtered.map ทั้งก้อน (isSel, blocked, reason, isActive และ <div role="option" …>) */
                })}
              </div>
            ))}
```

และในตัวเลือก แทน `<span className="truncate">{accountDisplayName(a.name)}</span>` ด้วย `<span className="truncate">{labelOf(a)}</span>`

- [ ] **Step 4: แก้คอมเมนต์หัวไฟล์ `utils/accountName.ts`**

ต่อท้ายย่อหน้า "Owner preference: …" ด้วย:

```ts
 *
 * 2026-11-16 (owner): the SEARCHABLE account picker (`AccountSearchDropdown`) shows
 * `code - name` plus chart group headings, like PEAK. It still runs the name through
 * this function (parentheticals stay dropped). Plain `NativeSelect` account pickers
 * keep name-only until the shared `AccountCombobox` (dropdown spec 2026-11-14 §9.1).
```

- [ ] **Step 5: รันให้ผ่าน รวมผู้ใช้ของ component นี้**

Run: `npx vitest run src/pages/other-income src/utils/__tests__/accountName.test.ts`
Expected: PASS ทั้งหมด · ถ้าเทสต์ของ `ItemsTable` / `AdjustmentTable` / `EditableJournalTable` ล้มเพราะจับชื่อตัวเลือกตรงทั้งคำ ให้แก้ชื่อที่คาดหวังเป็น `เลขบัญชี - ชื่อ`

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/other-income/components apps/web/src/utils/accountName.ts
git commit -m "feat(web): searchable account picker shows code and chart group headings"
```

---

### Task 5: ตารางรายการ และแยกส่วนราคาและภาษี

**Files:**
- Modify: `apps/web/src/components/expense-form-v4/ItemLinesSection.tsx`
- Modify: `apps/web/src/components/expense-form-v4/VendorSection.tsx`
- Test: `apps/web/src/components/expense-form-v4/__tests__/ItemLinesSection.layout.test.tsx`

**Interfaces:**
- Consumes: `useIsMobile()` จาก `@/hooks/useIsMobile` (true เมื่อจอแคบกว่า 1024px)
- Consumes: `AccountSearchDropdown` จาก `@/pages/other-income/components/AccountSearchDropdown` (ตัวเลือกบัญชีที่ค้นหาได้ ใช้อยู่ในรายได้อื่นและเงินสดย่อย)
- Produces: `ItemLinesSection` props เดิม · `VendorSection({ state, onChange })` (ผู้ขาย, ประเภทผู้ขาย, เลขประจำตัวผู้เสียภาษี, วันที่ใบกำกับ) · `PricingSection({ state, onChange })` (ประเภทราคา + ค่าใช้จ่ายต้องห้าม) export จาก `VendorSection.tsx`

- [ ] **Step 1: เขียนเทสต์ที่ยังไม่ผ่าน**

```tsx
// apps/web/src/components/expense-form-v4/__tests__/ItemLinesSection.layout.test.tsx
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';

// ผังบัญชี: ขอแบบกรอง type = เฉพาะค่าใช้จ่าย · ขอทั้งหมด = มีบัญชีรายได้ปนมา
vi.mock('@/lib/api', () => ({
  default: {
    get: vi.fn((_path: string, config?: { params?: { type?: string } }) =>
      Promise.resolve({
        data: {
          groups: [
            { accounts: [{ code: '53-1101', name: 'ค่าไฟฟ้า' }, { code: '53-1102', name: 'ค่าน้ำประปา' }] },
            ...(config?.params?.type ? [] : [{ accounts: [{ code: '41-1101', name: 'รายได้ดอกเบี้ย' }] }]),
          ],
        },
      }),
    ),
  },
}));
vi.mock('@/hooks/useUiFlags', () => ({ useUiFlags: () => ({ whtRates: [{ rate: 0, label: 'ไม่หัก' }] }) }));
const mobile = vi.hoisted(() => ({ value: false }));
vi.mock('@/hooks/useIsMobile', () => ({ useIsMobile: () => mobile.value }));

import { ItemLinesSection } from '../ItemLinesSection';
import { newLine } from '../types';

const mount = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ItemLinesSection lines={[newLine(), newLine()]} onChange={() => {}} priceTypeLabel="ราคาไม่รวม VAT" />
    </QueryClientProvider>,
  );

beforeEach(() => { mobile.value = false; });
beforeAll(() => {
  // jsdom ไม่มี scrollIntoView — ตัวเลือกบัญชีเลื่อนแถวที่ไฮไลต์เข้ามาในจอ
  HTMLElement.prototype.scrollIntoView ??= () => {};
});

describe('ItemLinesSection — ตารางและการ์ด', () => {
  it('จอใหญ่เป็นตารางเดียว หัวคอลัมน์ "จำนวนเงิน" และทุกช่องมีชื่อ', () => {
    mount();
    expect(screen.getAllByRole('table')).toHaveLength(1);
    expect(screen.getByRole('columnheader', { name: 'จำนวนเงิน' })).toBeInTheDocument();
    // ลำดับคอลัมน์ตามหน้า PEAK
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual([
      '#', 'บัญชีค่าใช้จ่าย / คำอธิบาย', 'จำนวน', 'ราคา/หน่วย', 'ส่วนลด', 'VAT%', 'จำนวนเงิน', 'WHT%', 'ลบ',
    ]);
    // ปุ่ม WHT% แสดงข้อความสั้น — คำอธิบายเต็มอยู่ในรายการที่เปิดออกมา
    expect(screen.getAllByRole('combobox', { name: 'WHT%' })[0]).toHaveTextContent('ไม่หัก');
    expect(screen.queryByText('ก่อนภาษี')).not.toBeInTheDocument();
    for (const name of ['บัญชีค่าใช้จ่าย', 'คำอธิบาย', 'จำนวน', 'ราคา/หน่วย', 'ส่วนลด', 'VAT%', 'WHT%']) {
      expect(screen.getAllByLabelText(name)).toHaveLength(2);
    }
    expect(screen.getAllByRole('button', { name: 'ลบรายการ' })).toHaveLength(2);
  });

  it('จอเล็กเป็นการ์ดต่อบรรทัด ไม่มีตาราง และช่องยังมีชื่อเดิม', () => {
    mobile.value = true;
    mount();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getAllByLabelText('ราคา/หน่วย')).toHaveLength(2);
    expect(screen.getAllByText('จำนวนเงิน')).toHaveLength(2);
  });

  it('ตัวเลือกบัญชีพิมพ์ค้นหาได้ และมีเฉพาะบัญชีค่าใช้จ่าย', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(screen.getAllByRole('combobox', { name: 'บัญชีค่าใช้จ่าย' })[0]);
    expect(await screen.findByRole('option', { name: '53-1101 - ค่าไฟฟ้า' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /รายได้ดอกเบี้ย/ })).not.toBeInTheDocument();
    await user.type(screen.getByPlaceholderText('ค้นหารหัส หรือ ชื่อบัญชี'), 'ประปา');
    expect(screen.getByRole('option', { name: /ค่าน้ำประปา/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /ค่าไฟฟ้า/ })).not.toBeInTheDocument();
  });

  it('ช่องที่ชื่อเดียวกันมี id ไม่ซ้ำ', () => {
    mount();
    const ids = screen.getAllByLabelText('ราคา/หน่วย').map((n) => n.id).filter(Boolean);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
```

- [ ] **Step 2: รันให้เห็นว่าไม่ผ่าน**

Run: `npx vitest run src/components/expense-form-v4/__tests__/ItemLinesSection.layout.test.tsx`
Expected: FAIL — ไม่มี `table` และยังมีข้อความ "ก่อนภาษี"

- [ ] **Step 3: แก้ `ItemLinesSection.tsx`**

เพิ่ม import:

```tsx
import ScreenTable from '@/components/ui/ScreenTable';
import { useIsMobile } from '@/hooks/useIsMobile';
import { AccountSearchDropdown } from '@/pages/other-income/components/AccountSearchDropdown';
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select';
```

ใน component หลัง `const whtOptions = ...` เพิ่ม `const isMobile = useIsMobile();` และตัวเลือกบัญชีที่ค้นหาได้ ใช้ร่วมสองแบบ โดยชุดตัวเลือก**เท่าเดิม** (บัญชีที่ `useCoaGroups({ type: 'ค่าใช้จ่าย' })` คืนมา):

```tsx
  // ชุดบัญชีเดิมของ dropdown นี้ — AccountSearchDropdown โหลดผังทั้งหมด จึงกรองด้วยรหัสชุดนี้
  const expenseCodes = new Set(groups.flatMap((g) => g.accounts.map((a) => a.code)));
  const accountPicker = (line: ExpenseLineForm) => (
    <AccountSearchDropdown
      aria-label="บัญชีค่าใช้จ่าย"
      value={line.category}
      onChange={(code) => updateLine(line.uid, { category: code })}
      filter={(a) => expenseCodes.has(a.code)}
      placeholder="— เลือก —"
    />
  );
```

ลบ import `accountDisplayName` ถ้าไม่มีผู้ใช้เหลือ

แทน `return (...)` ทั้งก้อนด้วย: การ์ดเดิมเมื่อ `isMobile` (คง markup เดิมทุกบรรทัด เปลี่ยนเฉพาะป้าย `ก่อนภาษี` เป็น `จำนวนเงิน` และแทน `<NativeSelect>` ของบัญชีด้วย `{accountPicker(line)}` โดยให้ป้าย "บัญชีค่าใช้จ่าย" ของการ์ดเป็น `<span className={formLabelClass}>` (ปุ่มมีชื่อจาก `aria-label` แล้ว)) และตารางเมื่อไม่ใช่:

```tsx
  const footer = (
    <>
      <button data-ui-control="button"
        type="button"
        onClick={addLine}
        className="flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-border py-3 text-sm text-muted-foreground hover:border-primary hover:text-foreground lg:w-auto lg:px-6"
      >
        <Plus className="size-4" /> เพิ่มบัญชี
      </button>
      <p className="text-xs leading-snug text-muted-foreground">
        {priceTypeLabel} — ระบบคำนวณ VAT และภาษีหัก ณ ที่จ่ายเมื่อดูตัวอย่างหรือบันทึก
      </p>
    </>
  );

  if (isMobile) {
    return (
      <div className="space-y-3">
        {/* การ์ดต่อบรรทัด — markup เดิมของ lines.map(...) ทั้งก้อน */}
        {footer}
      </div>
    );
  }

  const cell = 'px-[3px] py-1.5 align-top';
  // ช่องตัวเลขในตาราง: กรอบ 44px เท่าช่องอื่น แต่ระยะซ้ายขวาแคบลงให้พอกับคอลัมน์ 96px
  const num = `${formControlClass} px-2 text-right tabular-nums`;
  const head = 'px-2 py-2.5 text-xs font-semibold leading-snug text-muted-foreground whitespace-nowrap';
  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-lg border border-border">
        <ScreenTable className="w-full min-w-[52rem] table-fixed text-sm">
          <colgroup>
            <col className="w-6" />
            <col />
            <col className="w-19" />
            <col className="w-24" />
            <col className="w-24" />
            <col className="w-16" />
            <col className="w-24" />
            <col className="w-19" />
            <col className="w-9" />
          </colgroup>
          <thead className="bg-muted/50">
            <tr>
              <th scope="col" className={`${head} text-center`}>#</th>
              <th scope="col" className={`${head} text-left`}>บัญชีค่าใช้จ่าย / คำอธิบาย</th>
              <th scope="col" className={`${head} text-right`}>จำนวน</th>
              <th scope="col" className={`${head} text-right`}>ราคา/หน่วย</th>
              <th scope="col" className={`${head} text-right`}>ส่วนลด</th>
              <th scope="col" className={`${head} text-right`}>VAT%</th>
              <th scope="col" className={`${head} text-right`}>จำนวนเงิน</th>
              <th scope="col" className={`${head} text-right`}>WHT%</th>
              <th scope="col" className={head}><span className="sr-only">ลบ</span></th>
            </tr>
          </thead>
          {/* สัดส่วนคอลัมน์ตามหน้า PEAK (ตัวเลขทั้งหมดแถวเดียว · คำอธิบายอยู่แถวล่างใต้บัญชี) */}
          {lines.map((line, idx) => (
            <tbody key={line.uid} className="border-t border-border">
              <tr>
                <td rowSpan={2} className={`${cell} pt-4 text-center text-xs text-muted-foreground`}>{idx + 1}</td>
                <td className={cell}>{accountPicker(line)}</td>
                <td className={cell}>
                  <NumberInput unstyled id={`${fieldId}-${line.uid}-q`} aria-label="จำนวน" step="0.01"
                    value={line.quantity}
                    onChange={(e) => updateLine(line.uid, { quantity: e.target.value })}
                    className={num} />
                </td>
                <td className={cell}>
                  <NumberInput unstyled id={`${fieldId}-${line.uid}-u`} aria-label="ราคา/หน่วย" step="0.01"
                    value={line.unitPrice}
                    onChange={(e) => updateLine(line.uid, { unitPrice: e.target.value })}
                    className={num} />
                </td>
                <td className={cell}>
                  <NumberInput unstyled id={`${fieldId}-${line.uid}-d`} aria-label="ส่วนลด" step="0.01"
                    value={line.discount}
                    onChange={(e) => updateLine(line.uid, { discount: e.target.value })}
                    className={num} />
                </td>
                <td className={cell}>
                  <Select value={line.vatPercent} onValueChange={(v) => updateLine(line.uid, { vatPercent: v })}>
                    <SelectTrigger aria-label="VAT%" className="w-full px-2">
                      <span className="tabular-nums">{line.vatPercent}%</span>
                    </SelectTrigger>
                    <SelectContent align="end">
                      <SelectItem value="0">0%</SelectItem>
                      <SelectItem value="7">7%</SelectItem>
                    </SelectContent>
                  </Select>
                </td>
                <td className={`${cell} px-2 pt-4 text-right font-medium tabular-nums`}>
                  {formatNumberDecimal(computeBeforeVat(line))}
                </td>
                <td className={cell}>
                  {/* ช่องแคบแบบ PEAK: ปุ่มแสดงแค่อัตรา · รายการที่เปิดออกมาแสดงคำอธิบายเต็ม ("3% — ค่าบริการ") */}
                  <Select value={line.whtPercent} onValueChange={(v) => updateLine(line.uid, { whtPercent: v })}>
                    <SelectTrigger aria-label="WHT%" className="w-full px-2">
                      <span className="tabular-nums">{parseFloat(line.whtPercent) > 0 ? `${line.whtPercent}%` : 'ไม่หัก'}</span>
                    </SelectTrigger>
                    <SelectContent align="end">
                      {whtOptions.map((o) => (
                        <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </td>
                <td rowSpan={2} className={cell}>
                  <button data-ui-control="button"
                    type="button"
                    onClick={() => removeLine(line.uid)}
                    disabled={lines.length === 1}
                    className="flex min-h-11 w-full items-center justify-center rounded-md text-muted-foreground hover:text-destructive disabled:opacity-30"
                    aria-label="ลบรายการ"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </td>
              </tr>
              <tr>
                <td className={`${cell} pt-0 pb-2.5`}>
                  <input id={`${fieldId}-${line.uid}-2`}
                    type="text"
                    aria-label="คำอธิบาย"
                    value={line.description}
                    onChange={(e) => updateLine(line.uid, { description: e.target.value })}
                    placeholder="ค่าไฟฟ้าสาขา A เดือน เม.ย. 2569"
                    className={formControlClass}
                  />
                </td>
                <td colSpan={6} className={`${cell} pt-0 pb-2.5`}>
                  <div className="flex min-h-11 items-center gap-2 pl-1.5">
                    <label className="flex cursor-pointer items-center gap-2 text-xs leading-snug text-muted-foreground hover:text-foreground">
                      <input
                        type="checkbox"
                        checked={line.taxDisallowed === true}
                        onChange={(e) => updateLine(line.uid, { taxDisallowed: e.target.checked })}
                      />
                      <span>บรรทัดนี้เป็น <span className="font-medium">ค่าใช้จ่ายต้องห้าม</span></span>
                    </label>
                    <TaxDisallowedHint compact />
                  </div>
                </td>
              </tr>
            </tbody>
          ))}
        </ScreenTable>
      </div>
      {footer}
    </div>
  );
```

ความกว้างคอลัมน์ = สัดส่วนของหน้า PEAK (เจ้าของสั่ง 2026-11-16 "ขอขนาดเท่า PEAK"): PEAK วัดจากหน้าจริง # 24 · บัญชี 368 · จำนวน 97 · ราคา/หน่วย 96 · ส่วนลด 96 · ภาษี 49 · มูลค่า 96 · หัก ณ ที่จ่าย 73 · ลบ 25 (รวม 924px) · ของเรา # 24 · บัญชี = ที่เหลือ · จำนวน 76 · ราคา/หน่วย 96 · ส่วนลด 96 · VAT% 64 · จำนวนเงิน 96 · WHT% 76 · ลบ 36 — บนการ์ดกว้าง 924px (จอ 1280px ที่เปิดเมนูข้าง) ช่องบัญชีกว้าง 360px (PEAK 368px) และกว้างขึ้นตามจอ (สูงสุดราว 490px) · เมนูรายการบัญชีที่เปิดออกมากว้างเท่าช่อง เหมือน PEAK · VAT%/WHT% ใช้ `Select` ของ `components/ui/select` (ตัวเดียวกับ `CashAccountSelect`) เพราะปุ่มแสดงข้อความสั้นได้ขณะที่รายการแสดงคำอธิบายเต็ม — `NativeSelect` ในคอลัมน์ 84px จะทำให้ "15% — ต่างประเทศ" ขาดกลางคำ (ข้อพบ S3-07 ของ spec 2026-11-14) · การ์ดมือถือคง `NativeSelect` เดิม

ข้อความยาวของช่องติ๊กรายบรรทัด ("ใช้เฉพาะกรณีเอกสารปน…") อยู่ในการ์ดมือถือเหมือนเดิม ในตารางใช้ข้อความสั้นข้างบน คำอธิบายเต็มอยู่ใน `TaxDisallowedHint`

- [ ] **Step 4: แก้ `VendorSection.tsx` — แยก `PricingSection` และตัดช่องเลขใบกำกับ**

ใน `VendorSection`: ลบบล็อก `<div>` ของช่อง "เลขใบกำกับ" (`${fieldId}-4`) และบล็อกของ "ประเภทราคา" (`${fieldId}-6`) ออกจาก grid · เปลี่ยน grid เป็น `grid grid-cols-1 gap-4 sm:grid-cols-2` · ลบกล่อง "ค่าใช้จ่ายต้องห้าม" ท้าย component แล้วย้ายทั้งสองส่วนไป component ใหม่ในไฟล์เดียวกัน:

```tsx
export function PricingSection({ state, onChange }: Props) {
  const fieldId = useFieldId();
  return (
    <div className="flex flex-wrap items-start gap-x-6 gap-y-4">
      <div className="w-full sm:w-56">
        <label htmlFor={`${fieldId}-price`} className="block text-xs font-medium mb-1">ประเภทราคา</label>
        <NativeSelect wrapperClassName="max-w-full w-full min-w-0" id={`${fieldId}-price`}
          value={state.priceType}
          onChange={(e) => onChange({ priceType: e.target.value as 'EXCLUSIVE' | 'INCLUSIVE' })}
          className={formControlClass}
        >
          <option value="EXCLUSIVE">ไม่รวม VAT</option>
          <option value="INCLUSIVE">รวม VAT</option>
        </NativeSelect>
      </div>
      <div className="min-w-0 flex-1 rounded-lg border border-border bg-muted/30 px-3 py-2.5 sm:min-w-80">
        {/* ย้ายเนื้อหาในกล่อง "ค่าใช้จ่ายต้องห้าม" เดิมมาทั้งก้อน: label + checkbox + คำอธิบาย + <TaxDisallowedHint /> */}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: รันเทสต์ของ Task นี้และเทสต์ payload**

Run: `npx vitest run src/components/expense-form-v4/__tests__/ItemLinesSection.layout.test.tsx src/components/expense-form-v4/__tests__/ItemLinesSection.readonly.test.tsx`
Expected: PASS

เทสต์ payload จะยังไม่ผ่านจนกว่า Task 6 จะวาง `PricingSection` และช่องเลขใบกำกับกลับเข้าไป — ทำ Task 6 ต่อทันทีใน commit เดียวกัน

---

### Task 6: `ExpenseFormV4` — กรอบหน้าใหม่ทั้ง 6 ประเภท

**Files:**
- Modify: `apps/web/src/components/expense-form-v4/ExpenseFormV4.tsx`
- Modify: `apps/web/src/components/expense-form-v4/__tests__/expense-form-driver.ts`
- Delete: `apps/web/src/components/expense-form-v4/DocTypePicker.tsx`, `__tests__/DocTypePicker.payroll.test.tsx`
- Test: `apps/web/src/components/expense-form-v4/__tests__/ExpenseFormV4.page.test.tsx`

**Interfaces:**
- Consumes: ทุก component ของ Task 2–5
- Produces: prop ใหม่ของ `ExpenseFormV4`: `branchName?: string`

- [ ] **Step 1: เขียนเทสต์พฤติกรรมของหน้าใหม่ (ยังไม่ผ่าน)**

ใช้ mock ชุดเดียวกับ `ExpenseFormV4.payloads.test.tsx` (คัดลอกบล็อก `vi.mock(...)` ทั้งหมด, `beforeEach` และ `mount()` มาไว้ในไฟล์นี้ โดยให้ `mount(props)` รับ prop เพิ่ม)

```tsx
// apps/web/src/components/expense-form-v4/__tests__/ExpenseFormV4.page.test.tsx  (ส่วน describe)
describe('ExpenseFormV4 — หน้าเต็ม', () => {
  it('ไม่เป็น dialog และแสดงชื่อสาขากับเลขที่เอกสารที่หัวการ์ด', () => {
    mount({ branchName: 'สาขาทดสอบ' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText('สาขา: สาขาทดสอบ')).toBeInTheDocument();
    expect(screen.getByLabelText('เลขที่เอกสาร')).toHaveValue('ออกเลขเมื่อบันทึก');
  });

  it('สรุปข้อมูลแสดง — เมื่อยังไม่มีผลคำนวณ และแสดงยอดจาก server เมื่อมี', async () => {
    const user = mount();
    const summary = screen.getByRole('region', { name: 'สรุปข้อมูล' });
    expect(within(summary).getByText('จำนวนเงินทั้งสิ้น').parentElement).toHaveTextContent('—');
    await fillExpenseLine(user, { account: '53-1101', unitPrice: '850' });
    await waitFor(() =>
      expect(within(summary).getByText('จำนวนเงินทั้งสิ้น').parentElement).toHaveTextContent('909.50'),
    );
  });

  it('ตัวอย่างรายการบัญชีย่อไว้ และบอกว่าสมดุลที่หัวแถว', async () => {
    const user = mount();
    await fillExpenseLine(user, { account: '53-1101', unitPrice: '850' });
    const row = screen.getByRole('region', { name: 'ตัวอย่างรายการบัญชี' });
    await within(row).findByText(/สมดุล/);
    expect(within(row).queryByRole('table')).not.toBeInTheDocument();
    await user.click(within(row).getByRole('button', { name: 'ย่อ/ขยาย' }));
    expect(await within(row).findByRole('table')).toBeInTheDocument();
  });

  it('กดยังไม่ชำระเงินขณะมียอดจ่ายจริง ขึ้นคำเตือนและล้างได้', async () => {
    const user = mount();
    await fillExpenseLine(user, { account: '53-1101', unitPrice: '850' });
    await openAdjustments(user);
    await user.type(screen.getByLabelText('ยอดที่จ่ายจริง'), '910');
    await chooseKind(user, 'EXPENSE_UNPAID');
    expect(screen.getByRole('status')).toHaveTextContent('มีรายการปรับปรุงที่กรอกไว้ ซึ่งจะถูกบันทึกไปด้วย');
    await user.click(screen.getByRole('button', { name: 'ล้างรายการปรับปรุง' }));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    await saveDraft(user);
    expect((await bodyOf('/expense-documents')).amountPaid).toBeUndefined();
  });

  it('ผูก beforeunload หลังผู้ใช้แก้ฟอร์ม', async () => {
    const add = vi.spyOn(window, 'addEventListener');
    const user = mount();
    expect(add.mock.calls.some((c) => c[0] === 'beforeunload')).toBe(false);
    await fillExpenseLine(user, { account: '53-1101', unitPrice: '850' });
    expect(add.mock.calls.some((c) => c[0] === 'beforeunload')).toBe(true);
    add.mockRestore();
  });
});
```

import ที่ต้องมีเพิ่มจากไฟล์ payload: `within` จาก `@testing-library/react`

- [ ] **Step 2: รันให้เห็นว่าไม่ผ่าน**

Run: `npx vitest run src/components/expense-form-v4/__tests__/ExpenseFormV4.page.test.tsx`
Expected: FAIL — ฟอร์มยังเป็น `dialog`

- [ ] **Step 3: แก้ import และ props ของ `ExpenseFormV4.tsx`**

- ลบ import: `DocTypePicker`, `CashAccountVisualPicker`, `FileText`, `Users`, `Banknote`, `Receipt`, `Check` (ที่ไม่ได้ใช้แล้ว — ให้ `tsc` บอก) และรวม import `SHOP_CASH_ACCOUNT_CODES` เดิมเข้ากับบรรทัด `CashAccountSelect` ข้างล่าง · ไฟล์ `CashAccountVisualPicker.tsx` คงไว้ (`SsoReportPage` ยังใช้)
- เพิ่ม `useId` ใน import จาก `react` และ `const payById = useId();` ถัดจาก `const queryClient = useQueryClient();`
- เพิ่ม import:

```tsx
import { Star } from 'lucide-react';
import { CashAccountSelect, SHOP_CASH_ACCOUNT_CODES } from '@/components/CashAccountSelect';
import { formLabelClass } from '@/components/ui/form-styles';
import { VendorSection, PricingSection } from './VendorSection';
import { DocCard } from './layout/DocCard';
import { DocHeader } from './layout/DocHeader';
import { docTypeLabel } from './layout/DocTypeMenu';
import { FormRow } from './layout/FormRow';
import { PaymentSection } from './layout/PaymentSection';
import { StickyActionBar } from './layout/StickyActionBar';
import { SummaryBox } from './layout/SummaryBox';
```

- ใน `interface Props` เพิ่ม `/** ชื่อสาขาของเอกสาร — แสดงที่หัวการ์ด */ branchName?: string;` และรับใน signature
- ใน `interface PayrollDocForEdit` เพิ่ม `number?: string;`
- เพิ่ม state (ถัดจาก `loadedStatus`): `const [loadedNumber, setLoadedNumber] = useState<string | undefined>();` และใน `applyPayrollDoc` ถัดจาก `setLoadedStatus(doc.status);` เพิ่ม `setLoadedNumber(doc.number);`

- [ ] **Step 4: เพิ่มตัวแปรของหน้าจอและ `beforeunload`** (วางหลังบรรทัด `const ready = ...`)

```tsx
  // ---- ส่วนของหน้าจอ (ไม่มีผลกับ payload) ----
  const [showJe, setShowJe] = useState(false);
  const [dirty, setDirty] = useState(false);
  const markDirty = () => setDirty(true);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  useEffect(() => {
    if (saveMutation.isSuccess) setDirty(false);
  }, [saveMutation.isSuccess, saveMutation.submittedAt]);

  const money = (v?: string) => (v === undefined ? '—' : formatNumberDecimal(v));
  const hasAdjustmentData = state.adjustments.length > 0 || state.amountPaid.trim() !== '';
  const clearAdjustments = () => patch({ adjustments: [], amountPaid: '' });
  const backdatedHint =
    smartDoctypeSwitchEnabled &&
    state.docType === 'EXPENSE_ACCRUAL' &&
    !invoiceIsToday &&
    daysBackdated > smartSwitchThresholdDays;
  const statusLabel = (loadedStatus && SENT_BACK_STATUS_LABEL[loadedStatus]) || 'ร่าง';
  const showVendor = isPreviewType || state.docType === 'CREDIT_NOTE';
  const showPayment = isPreviewType || state.docType === 'PAYROLL' || state.docType === 'VENDOR_SETTLEMENT' || state.docType === 'PETTY_CASH_REIMBURSEMENT';
  const hasAdjustmentSection = isPreviewType || state.docType === 'VENDOR_SETTLEMENT';
```

- [ ] **Step 5: แทนสถานะโหลดร่าง (สองก้อน `fixed inset-0` ใน `if (editDocId && !editLoaded)`)**

```tsx
  if (editDocId && !editLoaded) {
    if (editQuery.isError) {
      return (
        <DocCard>
          <div role="alert" className="flex flex-col gap-3 py-8 text-sm">
            <p className="flex items-center gap-2 font-semibold leading-snug text-destructive">
              <AlertTriangle className="size-4 shrink-0" aria-hidden="true" /> โหลดใบเงินเดือนไม่สำเร็จ
            </p>
            <p className="text-muted-foreground leading-snug">{getErrorMessage(editQuery.error)}</p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" className="min-h-11" onClick={onClose}>ปิด</Button>
              <Button type="button" className="min-h-11" onClick={() => void editQuery.refetch()}>ลองใหม่</Button>
            </div>
          </div>
        </DocCard>
      );
    }
    return (
      <DocCard>
        <div role="status" className="flex items-center gap-3 py-8 text-sm text-muted-foreground">
          <Clock className="size-4 animate-pulse" aria-hidden="true" /> กำลังโหลดร่างใบเงินเดือน…
        </div>
      </DocCard>
    );
  }
```

- [ ] **Step 6: แทน `return (...)` หลักทั้งก้อน และลบ function `Section` กับ `Stat` ท้ายไฟล์**

ก่อน `return` ย้ายการคำนวณของบัญชีปรับผลต่าง (IIFE เดิมในส่วน "บัญชีปรับผลต่าง") ออกมาเป็นตัวแปร โดย**ไม่แก้สูตร**:

```tsx
  const adjustmentNode = hasAdjustmentSection
    ? (() => {
        let netExpected = '0.00';
        if (isPreviewType) {
          netExpected = preview?.totals.netPayment ?? '0.00';
        } else {
          const sumSettled = [...state.settlement.selections.values()].reduce(
            (s, sel) => s + (parseFloat(sel.amount) || 0),
            0,
          );
          const wht = parseFloat(state.settlement.whtAmount) || 0;
          netExpected = (sumSettled - wht).toFixed(2);
        }
        const paidNum = state.amountPaid.trim() !== '' ? parseFloat(state.amountPaid) : parseFloat(netExpected);
        const netNum = parseFloat(netExpected) || 0;
        const diff = (paidNum - netNum).toFixed(2);
        return (
          <AdjustmentSection
            diff={diff}
            amountPaid={state.amountPaid}
            onAmountPaidChange={(v) => patch({ amountPaid: v })}
            adjustments={state.adjustments}
            onChange={(rows) => patch({ adjustments: rows })}
            netExpected={netExpected}
          />
        );
      })()
    : null;
```

```tsx
  return (
    <div
      className="-mb-[calc(5rem+env(safe-area-inset-bottom,0px))] pt-4 lg:-mb-8"
      onInputCapture={markDirty}
      onChangeCapture={markDirty}
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={onClose}
          className="flex min-h-11 shrink-0 items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> กลับ
        </button>
        {!showQuickStart && !editDocId && (
          <Button type="button" variant="outline" className="min-h-11 gap-1.5" onClick={() => setShowQuickStart(true)}>
            <Star className="size-4" aria-hidden="true" /> ใช้แม่แบบ
          </Button>
        )}
      </div>

      {showQuickStart && (
        <div className="mb-4">
          {/* <QuickStartPanel ... /> เดิมทั้งก้อน — props และ handler ไม่เปลี่ยน */}
        </div>
      )}

      <DocCard
        banner={
          loadedStatus && SENT_BACK_STATUS_LABEL[loadedStatus] ? (
            <p role="status" className="flex items-start gap-2 rounded-lg border border-info/30 bg-info/10 px-3 py-2 text-sm text-foreground leading-snug">
              <Clock className="size-4 mt-0.5 shrink-0 text-info" aria-hidden="true" />
              {`ใบนี้${SENT_BACK_STATUS_LABEL[loadedStatus]} — บันทึกแล้วใบจะกลับเป็นร่าง ต้องส่งขออนุมัติอีกครั้ง`}
            </p>
          ) : undefined
        }
      >
        <DocHeader
          docType={state.docType}
          onDocTypeChange={(t) => patch({ docType: t })}
          pettyCashEnabled={pettyCashEnabled}
          payrollEnabled={canManagePayroll(user?.role)}
          typeLocked={!!draftId}
          statusLabel={statusLabel}
          branchName={branchName}
          documentNumber={loadedNumber}
          taxInvoice={showVendor ? { value: state.taxInvoiceNo, onChange: (v) => patch({ taxInvoiceNo: v }) } : undefined}
        />

        {showVendor && (
          <FormRow title="ข้อมูลผู้ขาย" complete={!!state.vendorName && !!state.documentDate}>
            <VendorSection state={state} onChange={patch} />
          </FormRow>
        )}
        {showVendor && (
          <FormRow title="ราคาและภาษี" complete>
            <PricingSection state={state} onChange={patch} />
          </FormRow>
        )}

        {isPreviewType && (
          <FormRow title="รายการ" layout="stacked" complete={itemCount > 0}>
            <ItemLinesSection
              lines={state.lines}
              onChange={(lines) => patch({ lines })}
              priceTypeLabel={state.priceType === 'INCLUSIVE' ? 'ราคารวม VAT' : 'ราคาไม่รวม VAT'}
            />
          </FormRow>
        )}
        {state.docType === 'PAYROLL' && (
          <FormRow title="งวดเงินเดือน + พนักงาน" layout="stacked">
            {/* <PayrollLinesSection ... /> เดิมทั้งก้อน — props ไม่เปลี่ยน */}
          </FormRow>
        )}
        {state.docType === 'VENDOR_SETTLEMENT' && (
          <FormRow title="เอกสารตั้งหนี้ที่จะล้าง" layout="stacked">
            <SettlementLinesSection
              branchId={state.branchId}
              value={state.settlement}
              onChange={(s) => patch({ settlement: s })}
            />
          </FormRow>
        )}
        {state.docType === 'PETTY_CASH_REIMBURSEMENT' && pettyCashEnabled && (
          <FormRow title="รายการเงินสดย่อย" layout="stacked">
            <PettyCashLinesSection value={state.pettyCash} onChange={(pc) => patch({ pettyCash: pc })} />
          </FormRow>
        )}
        {state.docType === 'CREDIT_NOTE' && (
          <FormRow title="ใบลดหนี้ — เอกสารต้นฉบับ + รายการ" layout="stacked">
            <CreditNoteLinesSection state={state} onChange={patch} onLinesChange={(lines) => patch({ lines })} />
          </FormRow>
        )}

        {isPreviewType && (
          <FormRow title="สรุปข้อมูล">
            <SummaryBox
              rows={[
                { label: 'มูลค่าก่อนภาษี', value: money(preview?.totals.subtotal) },
                { label: 'ภาษีมูลค่าเพิ่ม', value: money(preview?.totals.vatAmount) },
                { label: 'หัก ณ ที่จ่าย', value: money(preview?.totals.withholdingTax) },
              ]}
              total={{ label: 'จำนวนเงินทั้งสิ้น', value: money(preview?.totals.totalAmount) }}
            />
          </FormRow>
        )}

        {showPayment && (
          <PaymentSection
            picker={
              <div className="w-full sm:max-w-md">
                <label htmlFor={payById} className={formLabelClass}>ชำระโดย</label>
                <CashAccountSelect
                  id={payById}
                  placeholder="เลือกบัญชีจ่ายเงิน"
                  value={state.depositAccountCode}
                  onChange={(code) => patch({ depositAccountCode: code })}
                  codes={
                    state.docType === 'PAYROLL' && state.payroll.entityScope === 'SHOP'
                      ? SHOP_CASH_ACCOUNT_CODES
                      : undefined
                  }
                />
              </div>
            }
            unpaid={
              isPreviewType
                ? {
                    active: state.docType === 'EXPENSE_ACCRUAL',
                    onMarkUnpaid: () => patch({ docType: 'EXPENSE_ACCRUAL' }),
                    onMarkPaid: () => patch({ docType: 'EXPENSE_SAMEDAY' }),
                    backdatedHint,
                  }
                : undefined
            }
            advanced={
              adjustmentNode ? { hasData: hasAdjustmentData, onClear: clearAdjustments, content: adjustmentNode } : undefined
            }
            footer={
              state.docType === 'PAYROLL' ? (
                <p className="text-xs text-muted-foreground leading-snug">
                  {state.payroll.entityScope === 'SHOP'
                    ? 'เงินเดือนพนักงานสาขาจ่ายจากบัญชีของหน้าร้าน (SHOP) เท่านั้น'
                    : 'เงินเดือนส่วนกลางจ่ายจากบัญชีของ FINANCE'}
                </p>
              ) : undefined
            }
          />
        )}

        {isPreviewType && (
          <FormRow
            title="ตัวอย่างรายการบัญชี"
            layout="stacked"
            action={
              <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-1">
                <span className={cn('flex items-center gap-1.5 text-sm leading-snug', preview?.totals.balanced ? 'text-primary' : 'text-muted-foreground')}>
                  {preview?.totals.balanced && <CheckCircle2 className="size-4 shrink-0" aria-hidden="true" />}
                  {error
                    ? 'คำนวณไม่ได้'
                    : !preview
                      ? loading ? 'กำลังคำนวณ…' : 'ยังไม่มีรายการ'
                      : preview.totals.balanced
                        ? `สมดุล เดบิต ${formatNumberDecimal(preview.totals.drSum)} = เครดิต ${formatNumberDecimal(preview.totals.crSum)}`
                        : 'ยังไม่สมดุล'}
                </span>
                <button
                  type="button"
                  aria-expanded={showJe || !!error}
                  onClick={() => setShowJe((v) => !v)}
                  className="min-h-11 px-1 text-sm font-medium leading-snug text-primary"
                >
                  ย่อ/ขยาย
                </button>
              </div>
            }
          >
            {(showJe || !!error) && <JePreview preview={preview} loading={loading} error={error} />}
          </FormRow>
        )}

        <FormRow title="ผู้บันทึก & ผู้อนุมัติ">
          <ApproverSection />
        </FormRow>
      </DocCard>

      <StickyActionBar
        notices={
          <>
            {!maySubmit && (
              <p className="mx-auto w-full max-w-6xl px-4 py-2 text-sm text-muted-foreground lg:px-7" role="status">
                {permissions.isError ? 'โหลดสิทธิ์ไม่สำเร็จ' : permissions.isPending ? 'กำลังตรวจสอบสิทธิ์…' : "ไม่มีสิทธิ์ลงบัญชี รายจ่าย — สามารถบันทึกร่างได้"}
                {permissions.isError && <Button variant="ghost" onClick={() => permissions.refetch()}>ลองใหม่</Button>}
              </p>
            )}
            {payrollNotice && (
              <div
                ref={noticeRef}
                tabIndex={-1}
                role="alert"
                className={cn(
                  'flex items-start gap-2 border-b px-4 py-2 text-sm leading-snug focus:outline-hidden lg:px-7',
                  payrollNotice.tone === 'warning'
                    ? 'border-warning/40 bg-warning/10 text-warning-strong'
                    : 'border-destructive/30 bg-destructive/10 text-destructive',
                )}
              >
                {payrollNotice.tone === 'warning' ? (
                  <Clock className="size-4 mt-0.5 shrink-0" aria-hidden="true" />
                ) : (
                  <AlertTriangle className="size-4 mt-0.5 shrink-0" aria-hidden="true" />
                )}
                <p className="min-w-0">{payrollNotice.message}</p>
              </div>
            )}
          </>
        }
        summary={
          <>
            <span className="font-semibold">{docTypeLabel(state.docType)}</span>
            <span className="text-muted-foreground">{itemCount} รายการ</span>
            <span className={cn('flex items-center gap-1', ready ? 'text-success' : 'text-muted-foreground')}>
              {ready ? <CheckCircle2 className="size-3" /> : <Clock className="size-3" />}
              {ready ? 'พร้อมบันทึก' : 'ยังไม่ครบ'}
            </span>
          </>
        }
      >
        <Button variant="ghost" onClick={onClose} className="col-span-2 min-h-11 sm:col-span-1">
          ยกเลิก
        </Button>
        <Button
          className="h-auto min-h-11 whitespace-normal py-2"
          variant="outline"
          onClick={() => startSave({ andPost: false })}
          disabled={!ready || saveMutation.isPending}
        >
          บันทึกร่าง
        </Button>
        <Button
          className="h-auto min-h-11 whitespace-normal py-2"
          onClick={() => startSave({ andPost: true })}
          disabled={!ready || saveMutation.isPending || !maySubmit}
          title={!maySubmit ? "ไม่มีสิทธิ์ลงบัญชี รายจ่าย — สามารถบันทึกร่างได้" : undefined}
        >
          {requiresApproval ? 'บันทึกและขออนุมัติ' : 'บันทึกและลงบัญชี'}
        </Button>
      </StickyActionBar>
    </div>
  );
```

จุดที่มีคอมเมนต์ `{/* ... เดิมทั้งก้อน */}` (`QuickStartPanel`, `PayrollLinesSection`): ตัดและวาง JSX เดิมจากไฟล์ก่อนแก้ โดยไม่เปลี่ยน props หรือ handler

- [ ] **Step 7: แก้ driver ให้กดจอแบบใหม่ (ชื่อและ signature เดิม)**

```ts
// expense-form-driver.ts — แทน CHIP, chooseKind, fillExpenseLine และ openAdjustments
export async function fillExpenseLine(
  user: UserEvent,
  line: { account: string; unitPrice: string },
  index = 0,
) {
  // เทสต์ที่ใช้ driver นี้แทน AccountSearchDropdown ด้วยปุ่มที่เลือก 53-1101 เสมอ
  expect(line.account).toBe('53-1101');
  await user.click(screen.getAllByRole('button', { name: 'บัญชีค่าใช้จ่าย' })[index]);
  const price = screen.getAllByLabelText('ราคา/หน่วย')[index];
  await user.clear(price);
  await user.type(price, line.unitPrice);
}

const MENU_ITEM: Partial<Record<Kind, string>> = {
  VENDOR_SETTLEMENT: 'จ่ายชำระเจ้าหนี้',
  CREDIT_NOTE: 'ใบลดหนี้',
  PETTY_CASH: 'เงินสดย่อย',
};

export async function chooseKind(user: UserEvent, kind: Kind) {
  if (kind === 'EXPENSE_PAID') {
    // หน้าเปิดมาเป็นจ่ายแล้ว — กดเฉพาะเมื่ออยู่ที่ "ยังไม่ชำระ"
    const addPayment = screen.queryByRole('button', { name: 'เพิ่มข้อมูลชำระเงิน' });
    if (addPayment) await user.click(addPayment);
    return;
  }
  if (kind === 'EXPENSE_UNPAID') {
    await user.click(screen.getByRole('button', { name: 'ยังไม่ชำระเงิน (ตั้งหนี้ไว้ก่อน)' }));
    return;
  }
  await user.click(screen.getByRole('button', { name: /^เปลี่ยนประเภทเอกสาร/ }));
  await user.click(await screen.findByRole('menuitem', { name: MENU_ITEM[kind]! }));
}

export async function openAdjustments(user: UserEvent) {
  await user.click(screen.getByRole('radio', { name: 'ขั้นสูง' }));
  await screen.findByLabelText('ยอดที่จ่ายจริง');
}
```

- [ ] **Step 8: ลบ `DocTypePicker` และเทสต์ของมัน**

```bash
git rm apps/web/src/components/expense-form-v4/DocTypePicker.tsx apps/web/src/components/expense-form-v4/__tests__/DocTypePicker.payroll.test.tsx
```

กติกา "ผู้จัดการสาขาไม่เห็นเงินเดือน" ถูกปักใหม่ใน `DocTypeMenu.test.tsx` (Task 3) แล้ว

- [ ] **Step 9: รันเทสต์ทั้งโฟลเดอร์ฟอร์ม**

Run: `npx vitest run src/components/expense-form-v4`
Expected: PASS ทุกไฟล์ รวม `ExpenseFormV4.payloads.test.tsx` (8 เคส **โดยไม่แก้ body ที่คาดหวัง**), `ExpenseFormV4.payroll.test.tsx`, `ExpenseFormV4.page.test.tsx`

ถ้า `ExpenseFormV4.payroll.test.tsx` ไม่ผ่านเพราะหาปุ่ม/ข้อความไม่เจอ ให้ดูว่าข้อความใดหายจากหน้าใหม่ แล้วคืนข้อความนั้น (กติกา: ข้อความเดิมอยู่ครบ) ไม่แก้เทสต์

- [ ] **Step 10: ตรวจ type และ commit**

Run: `cd ../.. && ./tools/check-types.sh web`
Expected: 0 errors

```bash
git add -A apps/web/src/components/expense-form-v4
git commit -m "feat(web): expense create form as a full page with PEAK-style layout"
```

---

### Task 7: ทางเข้าหน้า — สาขา, กลับหน้ารายการ, เมนูล่างมือถือ

**Files:**
- Modify: `apps/web/src/pages/ExpenseDocumentNewPage.tsx`, `ExpenseDocumentNewPage.test.tsx`
- Modify: `apps/web/src/pages/ExpensesPage.tsx`, `ExpensesPage.ux.test.tsx`
- Create: `apps/web/src/components/layout/mobile-nav-visibility.ts`, `apps/web/src/components/layout/__tests__/mobile-nav-visibility.test.ts`
- Modify: `apps/web/src/components/layout/MainLayout.tsx:206`

**Interfaces:**
- Produces: `showsMobileBottomNav(pathname: string): boolean` · router state `{ listSearch: string }` ที่หน้ารายการส่งให้หน้าสร้าง

- [ ] **Step 1: เขียนเทสต์ที่ยังไม่ผ่าน**

```ts
// apps/web/src/components/layout/__tests__/mobile-nav-visibility.test.ts
import { describe, expect, it } from 'vitest';
import { showsMobileBottomNav } from '../mobile-nav-visibility';

describe('showsMobileBottomNav', () => {
  it.each(['/inbox', '/inbox/room-1', '/expenses/new'])('ซ่อนที่ %s', (path) => {
    expect(showsMobileBottomNav(path)).toBe(false);
  });
  it.each(['/', '/expenses', '/expenses/abc', '/expenses/newsletter', '/inboxes'])('แสดงที่ %s', (path) => {
    expect(showsMobileBottomNav(path)).toBe(true);
  });
});
```

เพิ่มใน `ExpenseDocumentNewPage.test.tsx` (ใน `describe` เดิม — mock ของฟอร์มในไฟล์นี้แสดง `branchId` เป็นข้อความอยู่แล้ว ให้เพิ่มปุ่มเรียก `onSaved` ใน mock: `<button type="button" onClick={() => onSaved()}>บันทึก</button>` และรับ `onSaved` ใน props ของ mock):

```tsx
  it('?branch= ที่อยู่ในรายการสาขา ใช้สาขานั้น แม้ผู้ใช้มีสาขาประจำ', async () => {
    mocks.user.branchId = 'assigned';
    mocks.get.mockResolvedValue({ data: [{ id: 'assigned', name: 'ก' }, { id: 'branch-x', name: 'ข' }] });
    open('/expenses/new?branch=branch-x');
    expect(await screen.findByTestId('expense-form')).toHaveTextContent('branch-x');
  });
  it('?branch= ที่ไม่อยู่ในรายการ ถูกเมิน', async () => {
    mocks.user.branchId = 'assigned';
    mocks.get.mockResolvedValue({ data: [{ id: 'assigned', name: 'ก' }] });
    open('/expenses/new?branch=someone-else');
    expect(await screen.findByTestId('expense-form')).toHaveTextContent('assigned');
  });
  it('มี ?branch= แต่รายการสาขายังไม่มา ยังไม่แสดงฟอร์ม', () => {
    mocks.user.branchId = 'assigned';
    mocks.get.mockReturnValue(new Promise(() => {}));
    open('/expenses/new?branch=branch-x');
    expect(screen.queryByTestId('expense-form')).not.toBeInTheDocument();
  });
```

เพิ่มเทสต์กลับหน้ารายการ (ต้องให้ `open()` รับ state: เปลี่ยน `initialEntries={[path]}` เป็น `initialEntries={[typeof path === 'string' ? path : path]}` และให้ `Location` แสดง `pathname + search`):

```tsx
  it('บันทึกแล้วกลับหน้ารายการพร้อมตัวกรองเดิม', async () => {
    mocks.user.branchId = 'assigned'; mocks.get.mockReturnValue(new Promise(() => {}));
    open({ pathname: '/expenses/new', state: { listSearch: '?tab=accrual&branch=b1' } });
    fireEvent.click(screen.getByRole('button', { name: 'บันทึก' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/expenses?tab=accrual&branch=b1');
  });
```

ใน `ExpensesPage.ux.test.tsx`: ลบ `role="dialog"` ออกจาก mock ของฟอร์ม (บรรทัด 26) แล้วเพิ่ม:

```tsx
describe('สร้างเอกสารใหม่', () => {
  it('รายจ่าย (EX) พาไปหน้าเต็มพร้อมสาขาที่กรองอยู่ ไม่เปิด dialog', async () => {
    const user = userEvent.setup();
    apiGet.mockImplementation((path: string) => Promise.resolve({ data: path.startsWith('/expense-documents?') ? { data: [], total: 0 } : [] }));
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/expenses?branch=branch-1']}><ExpensesPage /><LocationProbe /></MemoryRouter>
    </QueryClientProvider>);
    await user.click(await screen.findByRole('button', { name: /สร้างเอกสารใหม่/ }));
    await user.click(screen.getByRole('button', { name: 'รายจ่าย (EX)' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/expenses/new?branch=branch-1');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: รันให้เห็นว่าไม่ผ่าน**

Run: `npx vitest run src/components/layout/__tests__/mobile-nav-visibility.test.ts src/pages/ExpenseDocumentNewPage.test.tsx src/pages/ExpensesPage.ux.test.tsx`
Expected: FAIL ในเคสใหม่ทั้งหมด

- [ ] **Step 3: เขียน `mobile-nav-visibility.ts` และใช้ใน `MainLayout.tsx`**

```ts
// apps/web/src/components/layout/mobile-nav-visibility.ts
/** หน้าที่มีแถบของตัวเองติดขอบล่างจอ — ไม่แสดงเมนูล่างของแอป */
const HIDDEN = /^\/(?:inbox(?:\/|$)|expenses\/new$)/;

export function showsMobileBottomNav(pathname: string): boolean {
  return !HIDDEN.test(pathname);
}
```

`MainLayout.tsx:206` — แทน `{isMobile && !/^\/inbox(?:\/|$)/.test(pathname) && <MobileBottomNav />}` ด้วย:

```tsx
      {isMobile && showsMobileBottomNav(pathname) && <MobileBottomNav />}
```

พร้อม `import { showsMobileBottomNav } from './mobile-nav-visibility';`

- [ ] **Step 4: แก้ `ExpenseDocumentNewPage.tsx`**

```tsx
import { useLocation, useNavigate, useSearchParams } from 'react-router';
```

แทนบรรทัด `const branchId = user?.branchId || branches.data?.[0]?.id;` ด้วย:

```tsx
  // ?branch= จากตัวกรองของหน้ารายการ — ใช้เฉพาะสาขาที่ผู้ใช้เห็นในรายการ
  const requestedBranch = searchParams.get('branch') ?? '';
  const waitingForBranches = !!requestedBranch && branches.isPending;
  const requestedIsVisible = !!requestedBranch && !!branches.data?.some((b) => b.id === requestedBranch);
  const branchId = waitingForBranches
    ? undefined
    : (requestedIsVisible ? requestedBranch : '') || user?.branchId || branches.data?.[0]?.id;
  const branchName = branches.data?.find((b) => b.id === branchId)?.name;
  // กลับหน้ารายการพร้อมตัวกรองที่ผู้ใช้ตั้งไว้ (หน้ารายการส่งมาใน router state)
  const location = useLocation();
  const listPath = `/expenses${(location.state as { listSearch?: string } | null)?.listSearch ?? ''}`;
```

ทุก `navigate('/expenses')` ในไฟล์ (ปุ่มย้อนของ `PageHeader` สองจุด, `onClose`, `onSaved`) เปลี่ยนเป็น `navigate(listPath)` และส่ง prop เพิ่มให้ฟอร์ม:

```tsx
    <ExpenseFormV4
      key={branchId}
      branchId={branchId}
      branchName={branchName}
      ...
```

- [ ] **Step 5: แก้ `ExpensesPage.tsx`**

- ลบ `import { ExpenseFormV4 } ...` (บรรทัด 27), `const [showForm, setShowForm] = useState(false);` (155), `openCreate` (253), `handleFormSaved` (260) และบล็อก `{showForm && (<ExpenseFormV4 ... />)}` (735-741)
- เพิ่มถัดจากที่ `openCreate` เคยอยู่:

```tsx
  // หน้าสร้างรับสาขาจากตัวกรอง และกลับมาที่ตัวกรองเดิมหลังบันทึก/ยกเลิก
  const goCreate = (type?: 'CN' | 'PR' | 'SE') => {
    const params = new URLSearchParams();
    if (type) params.set('type', type);
    if (branchFilter) params.set('branch', branchFilter);
    const query = params.toString();
    const listSearch = searchParams.toString();
    navigate(`/expenses/new${query ? `?${query}` : ''}`, { state: { listSearch: listSearch ? `?${listSearch}` : '' } });
  };
```

- ในเมนู "สร้างเอกสารใหม่" (บรรทัด 669-678) แทน handler สี่ปุ่ม: `openCreate()` → `goCreate()` · `navigate('/expenses/new?type=CN')` → `goCreate('CN')` · `'PR'` และ `'SE'` เช่นเดียวกัน
- ค้น `openCreate` ทั้งไฟล์ ถ้ามีผู้เรียกอื่น (เช่นปุ่มในสถานะว่าง) เปลี่ยนเป็น `goCreate()`

- [ ] **Step 6: รันให้ผ่าน**

Run: `npx vitest run src/components/layout src/pages/ExpenseDocumentNewPage.test.tsx src/pages/ExpensesPage.ux.test.tsx`
Expected: PASS

- [ ] **Step 7: ตรวจ type, รันเทสต์ web ทั้งหมด, commit**

Run: `cd ../.. && ./tools/check-types.sh web && npm run test --workspace=apps/web`
Expected: 0 type errors · เทสต์ผ่านทั้งหมด (รวม `components/ui/field-guards.inventory.test.ts` และ `pages/__tests__/*.test.ts` ที่สแกนซอร์ส — ถ้าตัวใดล้มเพราะไฟล์ใหม่ ให้แก้ไฟล์ใหม่ตามกติกาที่เทสต์นั้นบอก ไม่เพิ่มข้อยกเว้น)

```bash
git add -A apps/web/src
git commit -m "feat(web): expense create opens as a page — branch from list filter, return to filtered list"
```

---

### Task 8: ชุดตรวจหน้าจอ และการตรวจก่อนส่ง

**Files:**
- Modify: `apps/api/e2e/ui-fields/fields.audit-spec.ts:207-222`
- Modify: `apps/api/e2e/ui-fields/dialogs.audit-spec.ts:37`
- Modify: `tools/field-scale/routes.mjs:234-242` (เฉพาะเมื่อขั้นตอนเปิดหน้าเปลี่ยน)

- [ ] **Step 1: บันทึกผลของชุดตรวจก่อนแก้ (baseline)**

รันบน commit ก่อน Task 5 (`git stash` ไม่ได้ใช้ — ใช้ worktree ชั่วคราวหรือดูผลรันล่าสุดถ้ามี) ตามคำสั่งใน `docs/guides/form-field-qa.md`:

```bash
DOCS_QA_SKIP_PREPARE=1 bash tools/docs-integration.sh --roots "$PWD/apps/api/e2e/ui-fields" --testRegex 'fields\.audit-spec\.ts$' --globals '{"ts-jest":{"isolatedModules":true,"diagnostics":false}}' --runInBand
```

จดเคสที่ล้มอยู่ก่อนแล้ว (คาดว่ามีบรรทัดที่หาปุ่ม `เพิ่มแบบ manual` — ข้อความจริงคือ `เพิ่มแบบ ด้วยตนเอง`) เพื่อแยกจากเคสที่ล้มเพราะงานนี้ ถ้ารัน harness ไม่ได้ในเครื่อง ให้รายงานตามจริงและข้ามไป Step 2

- [ ] **Step 2: แก้ `fields.audit-spec.ts` ส่วน `/expenses/new`**

บรรทัด 208-217 ใช้ป้ายและปุ่มที่หน้าใหม่ยังมีชื่อเดิม (`ประเภทผู้ขาย`, `เลขใบกำกับ`, `จำนวน`, `ราคา/หน่วย`, `เพิ่มบัญชี`, `ลบรายการ`) จึงไม่ต้องแก้ บรรทัด 220-222 (บัญชีปรับ) ต้องเปิด "ขั้นสูง" ก่อน — แทรกก่อนบรรทัด 220:

```ts
    await p.getByRole('radio',{name:'ขั้นสูง',exact:true}).check();
```

และถ้า baseline ใน Step 1 ยืนยันว่าบรรทัด 220 ล้มอยู่ก่อนเพราะชื่อปุ่ม ให้รายงานแยก ไม่แก้ในงานนี้

- [ ] **Step 3: แก้ `dialogs.audit-spec.ts:37`**

```ts
        { name: 'expense-accrual', path: '/expenses/new', buttons: ['ยังไม่ชำระเงิน (ตั้งหนี้ไว้ก่อน)'] },
```

- [ ] **Step 4: รันชุดตรวจทั้งสาม**

```bash
DOCS_QA_SKIP_PREPARE=1 bash tools/docs-integration.sh --roots "$PWD/apps/api/e2e/ui-fields" --testRegex '(fields|dialogs)\.audit-spec\.ts$' --globals '{"ts-jest":{"isolatedModules":true,"diagnostics":false}}' --runInBand
node tools/field-scale/check.mjs
```

Expected: ไม่มีเคสล้มใหม่เทียบกับ baseline · เส้นทาง `expense-new` และ `payroll-new` ของ field-scale ผ่าน (ถ้า `check.mjs` ต้องการ argument ให้ดูหัวไฟล์ `tools/field-scale/check.mjs`)

- [ ] **Step 5: ตรวจบนแอปจริง**

```bash
npm run local:check
```

แล้วเปิดแอปจาก checkout นี้ (`npm run dev`, บัญชี `admin@bestchoice.com` ตาม `.claude/CLAUDE.md`) ลองที่จอ 1280px และ 390px ทั้งจอสว่างและจอมืด:

1. `/expenses?branch=<สาขา>` → สร้างเอกสารใหม่ › รายจ่าย (EX): เป็นหน้าเต็ม, หัวการ์ดแสดงสาขาที่กรอง
2. กรอก 2 บรรทัด → กล่องสรุปและตัวอย่างรายการบัญชีมีตัวเลข → บันทึกร่าง → กลับหน้ารายการพร้อมตัวกรองเดิม และเอกสารใหม่อยู่ในรายการ
3. กด "ยังไม่ชำระเงิน" → บันทึกและลงบัญชี → เอกสารสถานะตั้งหนี้
4. เปิดครบอีก 4 ประเภทจากเมนูที่หัวการ์ด: ช่องและปุ่มเดิมอยู่ครบ กดบันทึกร่างได้
5. ตัวเลือกบัญชี: ปุ่มและรายการแสดง `เลขบัญชี - ชื่อ` · รายการมีหัวข้อกลุ่ม · พิมพ์เลขบัญชีแล้วค้นเจอ · ลองที่หน้ารายได้อื่นและเงินสดย่อยด้วยว่าแสดงแบบเดียวกันและบันทึกได้ตามเดิม
5. Dropdown ทุกตัวในหน้า: สูง 44px เท่าช่องอื่น · เปิดแล้วเมนูไม่ถูกตารางตัด · ข้อความไม่ขาดกลางคำ (ดู WHT% ตัวเลือก "15% — ต่างประเทศ") · บัญชีค่าใช้จ่ายพิมพ์ค้นหาได้
6. `/expenses/new?edit=<ใบเงินเดือนร่าง>`: เลขที่เอกสารเป็นเลขจริง เมนูประเภทถูกล็อก
7. มือถือ: ไม่มีเมนูล่างของแอป แถบปุ่มติดขอบล่างและไม่บังข้อความแจ้งเตือน
8. แถบปุ่มชิดขอบล่างจอทั้งตอนเลื่อนและตอนสุดหน้า (ไม่มีช่องว่างใต้แถบ)

ถ่ายภาพหน้าจอข้อ 1, 3, 6 ส่งเจ้าของ

- [ ] **Step 6: Commit**

```bash
git add apps/api/e2e/ui-fields tools/field-scale
git commit -m "test: point field audits at the new expense create page"
```

---

## Self-Review

- **ครอบ spec:** §4.1 → Task 2–4 · §4.2 → Task 5–7 (ไฟล์ของจ่ายเจ้าหนี้/เงินสดย่อย/ใบลดหนี้ = รอบ 2) · §5.1, §5.5, §5.6 → Task 5–6 · §6 → Task 4, 6 · §7.1–7.4 → Task 6–7 (แถว "รับเงินคืนเข้า" = รอบ 2) · §8 → Task 2, 5, 7 · §10.1 → Task 1 · §10.2–10.3 → Task 3, 4, 6, 7 · §10.4, §11 → Task 8
- **ต่างจาก spec โดยตั้งใจ:** ข้อความเมื่อวันที่ย้อนหลังใช้ "วันที่ใบกำกับไม่ใช่วันนี้ — เอกสารนี้ตั้งหนี้ไว้ก่อน" (แสดงจากสถานะปัจจุบัน ไม่ได้ติดตามว่าระบบเป็นผู้สลับ เพื่อไม่แตะ effect) — spec §6 กติกา 2 ถูกแก้ให้ตรงแล้ว
- **ชื่อที่ใช้ข้าม Task:** `chooseKind` / `fillExpenseLine` / `openAdjustments` / `saveDraft` (Task 1, 6) · `docTypeLabel` (Task 3, 6) · `PricingSection` (Task 5, 6) · `showsMobileBottomNav` (Task 7) · router state `listSearch` (Task 7 ทั้งสองฝั่ง)
