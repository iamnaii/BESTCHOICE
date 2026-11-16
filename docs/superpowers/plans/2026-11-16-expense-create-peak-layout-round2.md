# หน้าสร้างเอกสารค่าใช้จ่ายแบบ PEAK — รอบ 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ทำเนื้อในของ จ่ายชำระเจ้าหนี้ / ใบลดหนี้ (รวมแถว "รับเงินคืนเข้า") / เงินสดย่อย ให้เป็นโครงแบบ PEAK เหมือนรายจ่าย และเก็บข้อย่อยที่ค้างจากรอบ 1 — ทั้ง 6 ประเภทเป็นแบบ PEAK ครบ

**Architecture:** `ExpenseFormV4` ยังถือ state, effect และการบันทึกทั้งหมด รอบนี้แก้เฉพาะ JSX ของหน้าและ component ของแต่ละส่วน · สูตรยอดรวมของจ่ายเจ้าหนี้และเงินสดย่อยย้ายออกเป็นฟังก์ชันบริสุทธิ์สองตัว (สูตรเดิมทุกตัวอักษร) เพื่อให้ `SummaryBox` ของหน้าและตารางใช้ตัวเลขชุดเดียวกัน · ใบลดหนี้คืน `FormRow` หลายแถวจาก component เดียว (state ค้นหาและ query อยู่ที่เดิม)

**Tech Stack:** React 18 + TypeScript + Vite + Tailwind 4 + shadcn/Radix + TanStack Query + Vitest + Testing Library (`apps/web`)

**Spec:** `docs/superpowers/specs/2026-11-16-expense-create-peak-layout-design.md` §5.2–5.5, §6, §8, §10.2, §12 แถว 2
**รอบ 1:** `docs/superpowers/plans/2026-11-16-expense-create-peak-layout-round1.md` · PR #1781 (branch `feat/expense-create-peak-layout`, HEAD `28b4f9ab4`)

## Global Constraints

- ห้ามแก้ `apps/api/src` (แก้ได้เฉพาะ `apps/api/e2e/ui-fields/*` ใน Task 9 ถ้าชื่อปุ่ม/ป้ายที่ชุดตรวจใช้เปลี่ยน)
- ใน `ExpenseFormV4.tsx` ห้ามแก้ `initial()`, effect เดิมของ logic ทุกตัว, `saveMutation`, `itemCount`, `ready` · แก้ได้เฉพาะ JSX ที่ return และบล็อก "ส่วนของหน้าจอ (ไม่มีผลกับ payload)" (ตัวแปร `dirty`, `showJe`, `money`, ฯลฯ ที่รอบ 1 เพิ่ม)
- ห้ามแก้ body ที่คาดหวัง (`toEqual({...})`) ใน `ExpenseFormV4.payloads.test.tsx` — ถ้าต้องแก้ แปลว่า logic เปลี่ยน ให้หยุดแล้วรายงาน · ขั้นตอนกดจอแก้ได้ที่ `expense-form-driver.ts` ไฟล์เดียว
- ข้อความบนจอ: ใช้ข้อความเดิมของฟอร์มทุกคำ · ข้อความใหม่มีเฉพาะที่ระบุในแผนนี้ (รายการอยู่ท้ายแผน หัวข้อ "ข้อความใหม่")
- สี: token เท่านั้น (`bg-card`, `text-muted-foreground`, `border-border`, `bg-primary text-primary-foreground`, `text-warning-strong`, `bg-warning/10`) ห้าม hex, `gray-*`, `amber-*`, `text-white` · รวม class ด้วย `cn()` เสมอ (ต่อสตริงแล้ว class หลังไม่ทับ class หน้า)
- ช่องกรอกใช้ `formControlClass` / `formLabelClass` (`components/ui/form-styles.ts`) · ปุ่มและช่องแตะสูงอย่างน้อย `min-h-11` · ข้อความไทยใช้ `leading-snug`
- Dropdown ใช้ตัวที่มีอยู่แล้ว: บัญชี = `AccountSearchDropdown` · ผู้ขาย = `VendorCombobox` · บัญชีเงิน = `CashAccountSelect` · รายการสั้นในตาราง = `Select` ของ `components/ui/select` · เมนูประเภท = `components/ui/dropdown-menu`
- ตารางที่มี `min-w-*` ต้องอยู่ในกล่อง `relative overflow-x-auto` และ**ห้ามใส่ `sr-only` ในตาราง** — หัวคอลัมน์ที่ไม่มีข้อความใช้ `aria-label` บน `<th>` (บั๊กรอบ 1: `sr-only` หลุดกล่องเลื่อน ดันหน้ากว้าง 843px บนจอ 390)
- ไม่ย้ายและไม่เปลี่ยนชื่อ `AdjustmentSection.tsx` และคงข้อความ `เพิ่มแบบ ด้วยตนเอง` (`pages/__tests__/tabsButtonRowsNowrap.test.ts` อ่านซอร์สไฟล์นี้)
- คำสั่งเทสต์ทุกตัวรันจาก `apps/web`: `npx vitest run <path>` · เครื่อง Windows นี้มีเทสต์ล้มอยู่ก่อนที่ไม่เกี่ยว: 9 ตัวใน `src/pages/__tests__/headerNowrap*` + `tabsButtonRowsNowrap*`, `RecordPaymentWizard.preview-params`, TradeInFlow/ProductsPage timeout — ไม่ต้องแก้
- Commit ลงท้ายด้วยบรรทัดว่างแล้ว `Co-Authored-By:` ของโมเดลที่เขียน commit นั้น (คำสั่ง commit ในแผนใช้ Opus 5.5 เป็นตัวอย่าง) · ห้าม push / merge / deploy เอง

## โครงไฟล์

| ไฟล์ | รอบนี้ทำอะไร |
|---|---|
| `components/expense-form-v4/__tests__/expense-form-driver.ts` | รับขั้นตอนกดจอของ SE/CN/PC จากไฟล์ payload test (Task 1) แล้วแก้ตามหน้าตาใหม่ |
| `components/expense-form-v4/settlement-totals.ts` (ใหม่) | `settlementTotals(value)` — รวมยอดที่จ่าย / หัก ณ ที่จ่าย / ตัดเงินสดสุทธิ |
| `components/expense-form-v4/SettlementLinesSection.tsx` | export ใหม่ `SettlementPayeeFields` · ตารางใช้ token + ช่องมีชื่อ · ถอดแถวรวมท้ายกล่อง |
| `components/expense-form-v4/CreditNoteLinesSection.tsx` | คืน `FormRow` 2–3 แถว: อ้างอิงเอกสาร / รายการที่จะลด / รับเงินคืนเข้า |
| `components/expense-form-v4/petty-cash-totals.ts` (ใหม่) | `pettyCashTotals(value)` — ยอดต่อบรรทัด + ผลรวม |
| `components/expense-form-v4/PettyCashLinesSection.tsx` | export ใหม่ `PettyCashCustodianField` · ตารางสัดส่วน PEAK (สองแถวต่อรายการ) |
| `components/expense-form-v4/ExpenseFormV4.tsx` | JSX: แถวใหม่ของ SE/PC, ถอด `FormRow` ที่ห่อใบลดหนี้, เครื่องหมายครบของแถวผู้ขาย, ปุ่มย่อ/ขยาย, ตัวจับการแก้ฟอร์ม |
| `components/expense-form-v4/layout/DocTypeMenu.tsx` | หัวเรื่องเป็น `h1` · รายการเป็น radio item (บอกรายการที่เลือกอยู่) |
| `components/expense-form-v4/layout/PaymentSection.tsx` | ขั้นสูงไม่ยุบเองเมื่อข้อมูลหมด · ปุ่ม "พื้นฐาน" ที่ล็อกมีคำอธิบายผูก |
| `components/expense-form-v4/AdjustmentSection.tsx` | ถอดเลข "5" · หัวข้อเป็น `h4` |
| เทสต์ใหม่ | `__tests__/settlement-totals.test.ts`, `SettlementLinesSection.test.tsx`, `petty-cash-totals.test.ts`, `PettyCashLinesSection.test.tsx`, `ExpenseFormV4.round2.test.tsx` |

---

### Task 0: Branch + commit แผน

**Files:**
- Create: `docs/superpowers/plans/2026-11-16-expense-create-peak-layout-round2.md` (ไฟล์นี้)

- [ ] **Step 1: แตก branch จาก branch ของรอบ 1**

```bash
cd "d:/BESTCHOICE APP/BESTCHOICE"
git fetch origin
gh pr view 1781 --json state -q .state
git checkout feat/expense-create-peak-layout
git status --short          # ต้องไม่มีไฟล์ค้าง ยกเว้นไฟล์แผนนี้
git checkout -b feat/expense-create-peak-layout-round2
```

ถ้าคำสั่ง `gh pr view` ตอบ `MERGED` (PR รอบ 1 ถูก squash เข้า main แล้ว) ให้ย้ายฐานทันทีหลังแตก branch:

```bash
git rebase --onto origin/main 28b4f9ab4
```

- [ ] **Step 2: Commit แผน**

```bash
git add docs/superpowers/plans/2026-11-16-expense-create-peak-layout-round2.md
git commit -m "docs: plan round 2 of the PEAK-style expense create page" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 1: ย้ายขั้นตอนกดจอของ SE / CN / PC เข้า driver

ไฟล์ payload test ยังมีขั้นตอนกดจอของสามประเภทนี้เขียนตรง ๆ ในเทสต์ รอบนี้หน้าตาของสามประเภทจะเปลี่ยน จึงย้ายขั้นตอนเข้า driver ก่อน (ยังไม่เปลี่ยนหน้าตา เทสต์ต้องเขียวทั้งก่อนและหลัง) Task ถัดไปจะแก้เฉพาะ driver

**Files:**
- Modify: `apps/web/src/components/expense-form-v4/__tests__/expense-form-driver.ts`
- Modify: `apps/web/src/components/expense-form-v4/__tests__/ExpenseFormV4.payloads.test.tsx` (เฉพาะบรรทัดขั้นตอน — ห้ามแตะ `toEqual({...})`)

**Interfaces:**
- Produces (ใช้ใน Task 2–8):
  - `waitForSettlementDoc(docNumber: string): Promise<void>`
  - `pickCreditNoteSource(user: UserEvent, search: string, docNumber: RegExp): Promise<void>`
  - `chooseCreditNoteStandalone(user: UserEvent): Promise<void>`
  - `fillCreditNoteVendorName(user: UserEvent, name: string): Promise<void>`
  - `fillCreditNoteReason(user: UserEvent, reason: string): Promise<void>`
  - `fillPettyCashLine(user: UserEvent, line: { amount: string }): Promise<void>`

- [ ] **Step 1: เพิ่ม helper ท้ายไฟล์ driver**

ต่อท้าย `expense-form-driver.ts`:

```ts
/** จ่ายเจ้าหนี้ — รอให้รายการเอกสารตั้งหนี้โหลด (ระบบติ๊กให้เองตามค่าตั้ง) */
export async function waitForSettlementDoc(docNumber: string) {
  await screen.findByText(docNumber);
}

/** ใบลดหนี้โหมดอ้างอิง — ค้นเอกสารต้นฉบับแล้วเลือก */
export async function pickCreditNoteSource(user: UserEvent, search: string, docNumber: RegExp) {
  await user.type(screen.getByLabelText('ค้นหาเลข EX-... / ผู้ขาย (3 ตัวขึ้นไป)'), search);
  await user.click(await screen.findByRole('button', { name: docNumber }));
}

export async function chooseCreditNoteStandalone(user: UserEvent) {
  await user.click(screen.getByRole('button', { name: /^ไม่มีเอกสารต้นทาง/ }));
}

export async function fillCreditNoteVendorName(user: UserEvent, name: string) {
  await user.type(screen.getByLabelText(/^ชื่อผู้ขาย/), name);
}

export async function fillCreditNoteReason(user: UserEvent, reason: string) {
  await user.type(await screen.findByLabelText(/^เหตุผล/), reason);
}

/** เงินสดย่อย — บรรทัดแรก: เลือกผู้ขาย (ปุ่มแทน VendorCombobox) · เลือกบัญชี 53-1101 (ปุ่มแทน AccountSearchDropdown) · กรอกยอด */
export async function fillPettyCashLine(user: UserEvent, line: { amount: string }) {
  await user.click(screen.getByRole('button', { name: 'เลือกผู้ขาย' }));
  await user.click(screen.getByRole('button', { name: 'บัญชี' }));
  await user.type(screen.getByPlaceholderText('0.00'), line.amount);
}
```

- [ ] **Step 2: ให้ payload test เรียก helper**

ใน `ExpenseFormV4.payloads.test.tsx` แก้บรรทัด import เป็น:

```ts
import {
  chooseCreditNoteStandalone, chooseKind, fillCreditNoteReason, fillCreditNoteVendorName, fillExpenseLine,
  fillPettyCashLine, openAdjustments, pickCreditNoteSource, saveDraft, waitForSettlementDoc,
} from './expense-form-driver';
```

แล้วแทนขั้นตอนใน 4 เทสต์ (บรรทัด `expect(await bodyOf(...)).toEqual({...})` ของแต่ละเทสต์คงเดิมทุกตัวอักษร):

```ts
  it('จ่ายเจ้าหนี้ ส่งเอกสารที่เลือกและบัญชีเงิน', async () => {
    const user = mount();
    await chooseKind(user, 'VENDOR_SETTLEMENT');
    await waitForSettlementDoc('EX-009');
    await saveDraft(user);
```

```ts
  it('ใบลดหนี้แบบอ้างอิงเอกสาร ส่งเอกสารต้นฉบับและบัญชีเงิน', async () => {
    const user = mount();
    await chooseKind(user, 'CREDIT_NOTE');
    await pickCreditNoteSource(user, 'EX-0', /EX-001/);
    await fillCreditNoteReason(user, 'คืนสินค้า');
    await saveDraft(user);
```

```ts
  it('ใบลดหนี้แบบไม่มีเอกสารต้นทาง ส่งชื่อผู้ขาย ไม่ส่งบัญชีเงิน', async () => {
    const user = mount();
    await chooseKind(user, 'CREDIT_NOTE');
    await chooseCreditNoteStandalone(user);
    await fillCreditNoteVendorName(user, 'ร้านตัวอย่าง');
    await fillCreditNoteReason(user, 'ส่วนลดพิเศษ');
    await fillExpenseLine(user, { account: '53-1101', unitPrice: '500' });
    await saveDraft(user);
```

```ts
  it('เงินสดย่อย ส่งบรรทัดพร้อมผู้ขายและบัญชีเงิน', async () => {
    const user = mount();
    await chooseKind(user, 'PETTY_CASH');
    await fillPettyCashLine(user, { amount: '120' });
    await saveDraft(user);
```

ถ้า import `screen`, `type Kind` ในไฟล์นี้ไม่มีผู้ใช้แล้ว ให้ลบออกจากบรรทัด import (เทสต์ "รายจ่ายจ่ายทันทีที่กรอกยอดจ่ายจริง" และ "วันที่ใบกำกับย้อนหลัง" ยังใช้ `screen` / `fireEvent`)

- [ ] **Step 3: รันเทสต์ — ต้องผ่านเท่าเดิม**

Run: `npx vitest run src/components/expense-form-v4/__tests__/ExpenseFormV4.payloads.test.tsx`
Expected: `Tests  8 passed (8)`

- [ ] **Step 4: ยืนยันว่า body ที่คาดหวังไม่ถูกแตะ**

Run (จาก root ของ repo):

```bash
git diff -U0 -- apps/web/src/components/expense-form-v4/__tests__/ExpenseFormV4.payloads.test.tsx | grep -E "^[-+]" | grep -E "documentType|branchId|depositAccountCode|lines:|mode:|reason:|vendorName:|amountPaid|clearedDocumentId|supplierName"
```

Expected: ไม่มีบรรทัดออกมา

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/expense-form-v4/__tests__/expense-form-driver.ts apps/web/src/components/expense-form-v4/__tests__/ExpenseFormV4.payloads.test.tsx
git commit -m "test(web): move settlement/credit-note/petty-cash screen steps into the form driver" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: จ่ายชำระเจ้าหนี้ — แถวผู้รับเงิน, ตาราง, กล่องสรุป

Spec §5.2: ข้อมูลผู้รับเงิน → ตารางเอกสารตั้งหนี้ที่จะล้าง → `SummaryBox` (รวมยอดที่จ่าย · หัก ณ ที่จ่าย · ยอดเด่น "ตัดเงินสดสุทธิ") → ชำระเงิน

**Files:**
- Create: `apps/web/src/components/expense-form-v4/settlement-totals.ts`
- Create: `apps/web/src/components/expense-form-v4/__tests__/settlement-totals.test.ts`
- Create: `apps/web/src/components/expense-form-v4/__tests__/SettlementLinesSection.test.tsx`
- Create: `apps/web/src/components/expense-form-v4/__tests__/ExpenseFormV4.round2.test.tsx`
- Modify: `apps/web/src/components/expense-form-v4/SettlementLinesSection.tsx`
- Modify: `apps/web/src/components/expense-form-v4/ExpenseFormV4.tsx` (JSX + บล็อกส่วนของหน้าจอ)

**Interfaces:**
- Consumes: `waitForSettlementDoc`, `chooseKind` (driver) · `SummaryBox({ rows, total })`, `FormRow({ title, layout?, complete?, action?, children })` (รอบ 1)
- Produces:
  - `settlementTotals(value: SettlementFormFields): { count: number; sumSelected: number; wht: number; cashLeg: number }`
  - `SettlementPayeeFields({ value, onChange }: { value: SettlementFormFields; onChange: (v: SettlementFormFields) => void })`
  - ไฟล์เทสต์ `ExpenseFormV4.round2.test.tsx` พร้อม `mount()`, `bodyOf()`, ตัวแปร hoisted `source` (สถานะของเอกสารต้นฉบับ) และ `mobile` — Task 3, 4, 5, 8 เติมเทสต์ในไฟล์นี้

- [ ] **Step 1: เขียนเทสต์ของ `settlementTotals` (ต้องล้ม)**

`apps/web/src/components/expense-form-v4/__tests__/settlement-totals.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { settlementTotals } from '../settlement-totals';
import type { SettlementFormFields } from '../types';

const fields = (over: Partial<SettlementFormFields> = {}): SettlementFormFields => ({
  selections: new Map(), vendorName: '', vendorSupplierId: '', whtAmount: '', whtFormType: '', ...over,
});

describe('settlementTotals', () => {
  it('ยังไม่เลือกใบใด ทุกยอดเป็นศูนย์', () => {
    expect(settlementTotals(fields())).toEqual({ count: 0, sumSelected: 0, wht: 0, cashLeg: 0 });
  });

  it('รวมยอดที่จ่ายของใบที่เลือก แล้วหักภาษีหัก ณ ที่จ่าย', () => {
    const selections = new Map([
      ['a', { docId: 'a', amount: '1000.00' }],
      ['b', { docId: 'b', amount: '250.50' }],
    ]);
    expect(settlementTotals(fields({ selections, whtAmount: '30' }))).toEqual({
      count: 2, sumSelected: 1250.5, wht: 30, cashLeg: 1220.5,
    });
  });

  it('ยอดที่พิมพ์ไม่เป็นตัวเลขนับเป็นศูนย์', () => {
    const selections = new Map([['a', { docId: 'a', amount: '' }]]);
    expect(settlementTotals(fields({ selections, whtAmount: 'x' }))).toEqual({
      count: 1, sumSelected: 0, wht: 0, cashLeg: 0,
    });
  });
});
```

Run: `npx vitest run src/components/expense-form-v4/__tests__/settlement-totals.test.ts`
Expected: FAIL — หาไฟล์ `../settlement-totals` ไม่เจอ

- [ ] **Step 2: เขียน `settlementTotals`**

`apps/web/src/components/expense-form-v4/settlement-totals.ts`:

```ts
import type { SettlementFormFields } from './types';

/**
 * ยอดของใบจ่ายเจ้าหนี้ — สูตรเดิมของ SettlementLinesSection:
 * รวมยอดที่จ่ายของใบที่เลือก − ภาษีหัก ณ ที่จ่าย = เงินที่ตัดจริง
 */
export function settlementTotals(value: SettlementFormFields) {
  const sumSelected = [...value.selections.values()].reduce(
    (s, sel) => s + (parseFloat(sel.amount) || 0),
    0,
  );
  const wht = parseFloat(value.whtAmount) || 0;
  return { count: value.selections.size, sumSelected, wht, cashLeg: sumSelected - wht };
}
```

Run: `npx vitest run src/components/expense-form-v4/__tests__/settlement-totals.test.ts`
Expected: `Tests  3 passed (3)`

- [ ] **Step 3: เขียนเทสต์ของ section (ต้องล้ม)**

`apps/web/src/components/expense-form-v4/__tests__/SettlementLinesSection.test.tsx`:

```tsx
import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const flags = vi.hoisted(() => ({ settlementPartialPaymentEnabled: true }));
vi.mock('@/hooks/useUiFlags', () => ({
  useUiFlags: () => ({ settlementDefaultTick: 'all', settlementMaxBillsPerDoc: 100, ...flags }),
}));
vi.mock('@/lib/api', () => ({
  default: {
    get: vi.fn(() =>
      Promise.resolve({
        data: {
          data: [{
            id: 'acc-1', number: 'EX-009', vendorName: 'เจ้าหนี้ตัวอย่าง', totalAmount: '1000.00',
            documentDate: '2026-11-01', status: 'ACCRUAL', branch: { id: 'b1', name: 'สาขาทดสอบ' },
          }],
        },
      }),
    ),
  },
}));
vi.mock('../VendorCombobox', () => ({
  VendorCombobox: ({ id, value }: { id?: string; value: string }) => (
    <button id={id} type="button">{value || 'เลือกผู้ขาย'}</button>
  ),
}));

import { SettlementLinesSection, SettlementPayeeFields } from '../SettlementLinesSection';
import type { SettlementFormFields } from '../types';

const empty = (): SettlementFormFields => ({
  selections: new Map(), vendorName: '', vendorSupplierId: '', whtAmount: '', whtFormType: '',
});

function Harness() {
  const [value, setValue] = useState(empty);
  return (
    <>
      <SettlementPayeeFields value={value} onChange={setValue} />
      <SettlementLinesSection branchId="b1" value={value} onChange={setValue} />
    </>
  );
}

const mount = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <Harness />
    </QueryClientProvider>,
  );

beforeEach(() => { flags.settlementPartialPaymentEnabled = true; });

describe('SettlementLinesSection', () => {
  it('ช่องติ๊กและช่องจำนวนที่จ่ายมีชื่อของใบนั้น', async () => {
    mount();
    expect(await screen.findByRole('checkbox', { name: 'เลือก EX-009' })).toBeChecked();
    expect(await screen.findByLabelText('จำนวนที่จ่ายของ EX-009')).toHaveDisplayValue('1,000.00');
  });

  it('ไม่มีแถวรวมท้ายกล่อง — ยอดรวมอยู่ในกล่องสรุปของหน้า', async () => {
    mount();
    await screen.findByText('EX-009');
    expect(screen.queryByText('ตัดเงินสดสุทธิ')).not.toBeInTheDocument();
    expect(screen.queryByText('รวมยอดที่จ่าย')).not.toBeInTheDocument();
  });

  it('ปิดการชำระบางส่วน: คำเตือนใช้สี token และช่องยอดถูกล็อก', async () => {
    flags.settlementPartialPaymentEnabled = false;
    mount();
    const notice = screen.getByText('การชำระบางส่วนถูกปิดในการตั้งค่าระบบ — ทุกใบที่เลือกจะถูกล็อกที่ยอดเต็ม');
    expect(notice).toHaveClass('text-warning-strong');
    expect(notice.className).not.toMatch(/amber/);
    expect(await screen.findByLabelText('ยอดที่จ่ายของ EX-009 ล็อกที่ยอดเต็ม')).toBeDisabled();
  });

  it('ผู้รับเงินและภาษีหัก ณ ที่จ่ายมีป้ายผูกกับช่อง', () => {
    mount();
    expect(screen.getByLabelText('ผู้รับเงิน (ถ้ารวมเจ้าหนี้คนเดียว)')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'หัก ณ ที่จ่าย' })).toBeInTheDocument();
    expect(screen.getByLabelText('ประเภทภาษีหัก ณ ที่จ่าย')).toBeInTheDocument();
    expect(screen.getByLabelText('ยอดภาษีหัก ณ ที่จ่าย')).toBeInTheDocument();
  });
});
```

Run: `npx vitest run src/components/expense-form-v4/__tests__/SettlementLinesSection.test.tsx`
Expected: FAIL — `SettlementPayeeFields` ไม่มีใน export

- [ ] **Step 4: แก้ `SettlementLinesSection.tsx`**

(ก) แก้ import ตอนต้นไฟล์ — เพิ่ม `useId` และ `formLabelClass`:

```tsx
import { useEffect, useId, useMemo, useRef } from 'react';
```

```tsx
import { formControlClass, formLabelClass } from '@/components/ui/form-styles';
```

(ข) เพิ่ม component ใหม่ **เหนือ** `export function SettlementLinesSection`:

```tsx
/** ผู้รับเงิน + ภาษีหัก ณ ที่จ่าย — แถว "ข้อมูลผู้รับเงิน" ของหน้า (ช่องเดิม ค่าเดิม) */
export function SettlementPayeeFields({ value, onChange }: Pick<Props, 'value' | 'onChange'>) {
  const fieldId = useId();
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <div>
        <label htmlFor={`${fieldId}-payee`} className={formLabelClass}>
          ผู้รับเงิน (ถ้ารวมเจ้าหนี้คนเดียว)
        </label>
        <VendorCombobox
          id={`${fieldId}-payee`}
          value={value.vendorName}
          onSelectSupplier={(s) =>
            onChange({
              ...value,
              vendorName: s.name,
              vendorSupplierId: s.supplierId,
              ...(s.whtFormType ? { whtFormType: s.whtFormType } : {}),
            })
          }
        />
      </div>
      <div role="group" aria-labelledby={`${fieldId}-wht`}>
        <span id={`${fieldId}-wht`} className={formLabelClass}>หัก ณ ที่จ่าย</span>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <NativeSelect wrapperClassName="max-w-full w-auto" aria-label="ประเภทภาษีหัก ณ ที่จ่าย"
            value={value.whtFormType}
            onChange={(e) =>
              onChange({ ...value, whtFormType: e.target.value as 'PND3' | 'PND53' | '' })
            }
          >
            <option value="">ไม่ระบุ</option>
            <option value="PND53">ภงด.53</option>
            <option value="PND3">ภงด.3</option>
          </NativeSelect>
          <NumberInput unstyled
            step="0.01"
            value={value.whtAmount}
            onChange={(e) => onChange({ ...value, whtAmount: e.target.value })}
            aria-label="ยอดภาษีหัก ณ ที่จ่าย" placeholder="ยอด WHT"
            className={cn(formControlClass, 'text-right font-mono')}
          />
        </div>
      </div>
    </div>
  );
}
```

(ค) ใน `SettlementLinesSection` ลบสามบรรทัดที่คำนวณ `sumSelected`, `whtN`, `cashLeg` (อยู่เหนือ `return`) — ไม่มีผู้ใช้แล้ว · effect ทั้งสองตัว, `toggle`, `updateAmount` **ไม่แตะ**

(ง) แทน `return (...)` ทั้งก้อนด้วย:

```tsx
  const noticeClass = 'rounded-lg border px-3 py-2 text-xs leading-snug';
  return (
    <div className="space-y-3">
      {!settlementPartialPaymentEnabled && (
        <div
          className={cn(noticeClass, 'border-warning/40 bg-warning/10 text-warning-strong')}
          role="status"
          aria-live="polite"
        >
          การชำระบางส่วนถูกปิดในการตั้งค่าระบบ — ทุกใบที่เลือกจะถูกล็อกที่ยอดเต็ม
        </div>
      )}

      {(showApproachingCap || exceedsCap) && (
        <div
          className={cn(
            noticeClass,
            exceedsCap
              ? 'border-destructive/40 bg-destructive/10 text-destructive'
              : 'border-warning/40 bg-warning/10 text-warning-strong',
          )}
          role="status"
          aria-live="polite"
        >
          {exceedsCap
            ? `เลือกใบเกินจำกัด ${settlementMaxBillsPerDoc} ใบต่อเอกสาร (เลือก ${selectedCount}) — กรุณาแยกเป็นหลายเอกสาร`
            : `ใกล้ถึงจำกัด ${settlementMaxBillsPerDoc} ใบต่อเอกสาร (เลือกแล้ว ${selectedCount})`}
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-border">
        <div className="border-b border-border bg-muted/50 px-4 py-2.5 text-xs font-medium leading-snug">
          เจ้าหนี้คงค้างของสาขา ({docs.length} รายการรอจ่าย — เลือกที่ต้องการเคลียร์ สูงสุด {settlementMaxBillsPerDoc} ใบ/เอกสาร)
        </div>
        {docs.length === 0 ? (
          <div className="p-6 text-center text-sm leading-snug text-muted-foreground">
            ไม่มีเจ้าหนี้คงค้างในสาขานี้
          </div>
        ) : (
          <div className="relative overflow-x-auto">
            <ScreenTable className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th scope="col" aria-label="เลือก" className="w-11 p-2" />
                  <th scope="col" className="p-2 text-left">เลขเอกสาร</th>
                  <th scope="col" className="p-2 text-left">ผู้ขาย</th>
                  <th scope="col" className="p-2 text-right">ยอดรวม</th>
                  <th scope="col" className="p-2 text-right">จำนวนที่จ่าย</th>
                </tr>
              </thead>
              <tbody>
                {docs.map((doc) => {
                  const isSelected = value.selections.has(doc.id);
                  const sel = value.selections.get(doc.id);
                  return (
                    <tr key={doc.id} className={cn('border-b border-border/50', isSelected && 'bg-primary/5')}>
                      <td className="p-0">
                        <label className="flex min-h-11 min-w-11 cursor-pointer items-center justify-center">
                          <input
                            type="checkbox"
                            aria-label={`เลือก ${doc.number}`}
                            checked={isSelected}
                            onChange={() => toggle(doc)}
                            className="size-4 accent-primary"
                          />
                        </label>
                      </td>
                      <td className="p-2 font-mono text-sm">{doc.number}</td>
                      <td className="p-2 leading-snug">{doc.vendorName ?? '—'}</td>
                      <td className="p-2 text-right font-mono">{formatNumberDecimal(doc.totalAmount)}</td>
                      <td className="p-1.5">
                        {isSelected &&
                          (settlementPartialPaymentEnabled ? (
                            <NumberInput unstyled
                              step="0.01"
                              min="0.01"
                              value={sel!.amount}
                              onChange={(e) => updateAmount(doc.id, e.target.value)}
                              aria-label={`จำนวนที่จ่ายของ ${doc.number}`}
                              className={cn(formControlClass, 'ml-auto w-36 px-2 text-right font-mono')}
                            />
                          ) : (
                            // D1.3.6.3 OFF — ล็อกที่ยอดเต็ม · title บอกเหตุผลของนโยบาย
                            <NumberInput unstyled
                              step="0.01"
                              min="0.01"
                              value={doc.totalAmount}
                              readOnly
                              disabled
                              title="การชำระบางส่วนถูกปิดในการตั้งค่าระบบ — ต้องชำระเต็มจำนวน"
                              aria-label={`ยอดที่จ่ายของ ${doc.number} ล็อกที่ยอดเต็ม`}
                              className={cn(formControlClass, 'ml-auto w-36 cursor-not-allowed px-2 text-right font-mono opacity-70')}
                            />
                          ))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </ScreenTable>
          </div>
        )}
      </div>
    </div>
  );
```

Run: `npx vitest run src/components/expense-form-v4/__tests__/SettlementLinesSection.test.tsx`
Expected: `Tests  4 passed (4)`

- [ ] **Step 5: สร้างไฟล์เทสต์ระดับฟอร์มของรอบ 2 (เทสต์ของ SE ต้องล้ม)**

`apps/web/src/components/expense-form-v4/__tests__/ExpenseFormV4.round2.test.tsx`:

```tsx
// apps/web/src/components/expense-form-v4/__tests__/ExpenseFormV4.round2.test.tsx
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { chooseKind, waitForSettlementDoc } from './expense-form-driver';

/**
 * เนื้อในของ จ่ายเจ้าหนี้ / ใบลดหนี้ / เงินสดย่อย (แผนรอบ 2) — mock ชุดเดียวกับ ExpenseFormV4.page.test.tsx
 * ต่างกันสองจุด: บัญชีเงินเป็น <select> ธรรมดา (เลือกค่าได้ใน jsdom) และสลับจอมือถือได้ด้วย mobile.value
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
vi.mock('@/hooks/useUiFlags', () => ({
  useUiFlags: () => ({
    smartDoctypeSwitchEnabled: false,
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
  }),
}));
const mobile = vi.hoisted(() => ({ value: false }));
vi.mock('@/hooks/useIsMobile', () => ({ useIsMobile: () => mobile.value }));
vi.mock('../VendorCombobox', () => ({
  VendorCombobox: ({ id, value, onSelectSupplier }: { id?: string; value: string; onSelectSupplier: (s: unknown) => void }) => (
    <button id={id} type="button" onClick={() => onSelectSupplier({ name: 'ร้านตัวอย่าง', taxId: '', supplierId: 'sup-1' })}>
      {value || 'เลือกผู้ขาย'}
    </button>
  ),
}));
vi.mock('@/pages/other-income/components/AccountSearchDropdown', () => ({
  AccountSearchDropdown: (props: { value: string; onChange: (code: string) => void; 'aria-label'?: string }) => (
    <button type="button" aria-label={props['aria-label'] ?? 'บัญชี'} onClick={() => props.onChange('53-1101')}>
      {props.value || '—'}
    </button>
  ),
}));
vi.mock('@/components/ui/ThaiDateInput', () => ({
  default: ({ id, value, onChange }: { id?: string; value: string; onChange: (e: { target: { value: string } }) => void }) => (
    <input id={id} aria-label="วันที่ใบกำกับ (ทดสอบ)" value={value} onChange={(e) => onChange({ target: { value: e.target.value } })} />
  ),
}));
// ตัวเลือกบัญชีเงินจริงเป็น Radix Select — แทนด้วย <select> ที่ส่งรหัสบัญชีเหมือนของจริง
vi.mock('@/components/CashAccountSelect', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/CashAccountSelect')>();
  return {
    ...actual,
    CashAccountSelect: ({ id, value, onChange, codes = actual.CASH_ACCOUNT_CODES }: {
      id?: string; value?: string; onChange: (code: string) => void; codes?: readonly string[];
    }) => (
      <select id={id} value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
        {codes.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
    ),
  };
});

import { ExpenseFormV4 } from '../ExpenseFormV4';

const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
const ACCRUAL_DOC = {
  id: 'acc-1', number: 'EX-009', vendorName: 'เจ้าหนี้ตัวอย่าง', totalAmount: '1000.00',
  documentDate: today, status: 'ACCRUAL', branch: { id: 'b1', name: 'สาขาทดสอบ' },
};
/** สถานะของเอกสารต้นฉบับที่การค้นหาใบลดหนี้คืนมา — POSTED = จ่ายแล้ว · ACCRUAL = ยังตั้งหนี้อยู่ */
const source = vi.hoisted(() => ({ status: 'POSTED' }));
const originalDoc = () => ({
  id: 'orig-1', number: 'EX-001', vendorName: 'ผู้ขายเดิม', totalAmount: '1070.00', status: source.status,
  documentDate: '2026-11-01', expenseDetail: { lines: [{ category: '53-1101', amountBeforeVat: '1000' }] },
  branch: { id: 'b1', name: 'สาขาทดสอบ' },
});

beforeEach(() => {
  vi.clearAllMocks();
  mobile.value = false;
  source.status = 'POSTED';
  apiGet.mockImplementation((path: string) => {
    if (path === '/chart-of-accounts/grouped') {
      return Promise.resolve({ data: { groups: [{ accounts: [{ code: '53-1101', name: 'ค่าไฟฟ้า' }] }] } });
    }
    if (path.startsWith('/expense-documents?') && path.includes('status=ACCRUAL')) {
      return Promise.resolve({ data: { data: [ACCRUAL_DOC] } });
    }
    if (path.startsWith('/expense-documents?') && path.includes('search=')) {
      return Promise.resolve({ data: { data: [originalDoc()] } });
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

// ใช้ใน Task 4 และ Task 8
const bodyOf = async (path: string) => {
  await waitFor(() => expect(apiPost.mock.calls.some((c) => c[0] === path)).toBe(true));
  return apiPost.mock.calls.find((c) => c[0] === path)![1];
};

describe('จ่ายชำระเจ้าหนี้', () => {
  it('มีแถวข้อมูลผู้รับเงิน และกล่องสรุปคิดจากใบที่เลือกกับภาษีหัก ณ ที่จ่าย', async () => {
    const user = mount();
    await chooseKind(user, 'VENDOR_SETTLEMENT');
    await waitForSettlementDoc('EX-009');
    expect(screen.getByRole('region', { name: 'ข้อมูลผู้รับเงิน' })).toBeInTheDocument();
    const summary = screen.getByRole('region', { name: 'สรุปข้อมูล' });
    await waitFor(() =>
      expect(within(summary).getByText('ตัดเงินสดสุทธิ').parentElement).toHaveTextContent('1,000.00'),
    );
    expect(within(summary).getByText('รวมยอดที่จ่าย').parentElement).toHaveTextContent('1,000.00');
    await user.type(screen.getByLabelText('ยอดภาษีหัก ณ ที่จ่าย'), '30');
    expect(within(summary).getByText('หัก ณ ที่จ่าย').parentElement).toHaveTextContent('30.00');
    expect(within(summary).getByText('ตัดเงินสดสุทธิ').parentElement).toHaveTextContent('970.00');
  });
});
```

หมายเหตุ: `bodyOf` ยังไม่มีผู้ใช้จนถึง Task 4 (tsconfig ของ `apps/web` ตั้ง `noUnusedLocals: false`) · `NumberInput` แสดงตัวเลขแบบมีจุลภาคคั่นหลักพัน เทสต์จึงเทียบกับ `1,000.00`

Run: `npx vitest run src/components/expense-form-v4/__tests__/ExpenseFormV4.round2.test.tsx`
Expected: FAIL — ไม่พบ region ชื่อ "ข้อมูลผู้รับเงิน"

- [ ] **Step 6: ต่อแถวใหม่ใน `ExpenseFormV4.tsx`**

(ก) import:

```tsx
import { SettlementLinesSection, SettlementPayeeFields } from './SettlementLinesSection';
import { settlementTotals } from './settlement-totals';
```

(ข) ในบล็อก "ส่วนของหน้าจอ" ใต้บรรทัด `const money = ...` เพิ่ม:

```tsx
  // จ่ายเจ้าหนี้ — ตัวเลขชุดเดียวกับที่ตารางเคยแสดงท้ายกล่อง (ยังไม่เลือกใบใด = —)
  const seTotals = settlementTotals(state.settlement);
  const seMoney = (n: number) => (seTotals.count === 0 ? '—' : formatNumberDecimal(n));
```

(ค) แทนบล็อก `{state.docType === 'VENDOR_SETTLEMENT' && (<FormRow title="เอกสารตั้งหนี้ที่จะล้าง" ...>...)}` ด้วย:

```tsx
        {state.docType === 'VENDOR_SETTLEMENT' && (
          <FormRow title="ข้อมูลผู้รับเงิน" complete>
            <SettlementPayeeFields value={state.settlement} onChange={(s) => patch({ settlement: s })} />
          </FormRow>
        )}
        {state.docType === 'VENDOR_SETTLEMENT' && (
          <FormRow title="เอกสารตั้งหนี้ที่จะล้าง" layout="stacked" complete={itemCount > 0}>
            <SettlementLinesSection
              branchId={state.branchId}
              value={state.settlement}
              onChange={(s) => patch({ settlement: s })}
            />
          </FormRow>
        )}
```

(ง) ใต้บล็อก `{isPreviewType && (<FormRow title="สรุปข้อมูล">...)}` เพิ่ม:

```tsx
        {state.docType === 'VENDOR_SETTLEMENT' && (
          <FormRow title="สรุปข้อมูล">
            <SummaryBox
              rows={[
                { label: 'รวมยอดที่จ่าย', value: seMoney(seTotals.sumSelected) },
                { label: 'หัก ณ ที่จ่าย', value: seMoney(seTotals.wht) },
              ]}
              total={{ label: 'ตัดเงินสดสุทธิ', value: seMoney(seTotals.cashLeg) }}
            />
          </FormRow>
        )}
```

- [ ] **Step 7: รันเทสต์ทั้งกลุ่ม**

Run: `npx vitest run src/components/expense-form-v4`
Expected: ผ่านทั้งหมด (รวม payload test 8 ตัว)

Run: `npx tsc --noEmit -p .`
Expected: exit 0

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/components/expense-form-v4
git commit -m "feat(web): PEAK-style vendor settlement — payee row, named table fields, summary box" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: ใบลดหนี้ — แยกเป็นแถว "อ้างอิงเอกสาร" และ "รายการที่จะลด"

Spec §5.3 · component เดียวคืน `FormRow` หลายแถว เพราะ state การค้นหา (`search`) และผลค้น (`selectedDoc`) ต้องใช้ร่วมกันทั้งแถวอ้างอิงและแถวรับเงินคืน (Task 4)

**Files:**
- Modify: `apps/web/src/components/expense-form-v4/CreditNoteLinesSection.tsx` (เขียนส่วน render ใหม่ทั้งก้อน)
- Modify: `apps/web/src/components/expense-form-v4/ExpenseFormV4.tsx` (JSX 2 จุด)
- Test: `apps/web/src/components/expense-form-v4/__tests__/ExpenseFormV4.round2.test.tsx`

**Interfaces:**
- Consumes: `FormRow` · `pickCreditNoteSource`, `chooseCreditNoteStandalone` (driver)
- Produces: `CreditNoteLinesSection({ state, onChange, onLinesChange })` — props เดิม แต่**คืน `FormRow` เอง** ผู้เรียกห้ามห่อ `FormRow` ซ้ำ

- [ ] **Step 1: เขียนเทสต์ (ต้องล้ม)**

ใน `ExpenseFormV4.round2.test.tsx` แก้ import ของ driver เป็น:

```ts
import { chooseCreditNoteStandalone, chooseKind, pickCreditNoteSource, waitForSettlementDoc } from './expense-form-driver';
```

แล้วต่อท้ายไฟล์:

```tsx
describe('ใบลดหนี้', () => {
  it('แยกเป็นแถว อ้างอิงเอกสาร และ รายการที่จะลด — ตารางขึ้นหลังเลือกเอกสารต้นฉบับ', async () => {
    const user = mount();
    await chooseKind(user, 'CREDIT_NOTE');
    expect(screen.getByRole('region', { name: 'อ้างอิงเอกสาร' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'รายการที่จะลด' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /เอกสารต้นฉบับ \+ รายการ/ })).not.toBeInTheDocument();
    await pickCreditNoteSource(user, 'EX-0', /EX-001/);
    expect(await screen.findByRole('region', { name: 'รายการที่จะลด' })).toBeInTheDocument();
    expect(screen.getAllByLabelText(/^เหตุผล/)).toHaveLength(1);
  });

  it('โหมดไม่มีเอกสารต้นทาง มีช่องเหตุผลช่องเดียว และตารางรายการขึ้นทันที', async () => {
    const user = mount();
    await chooseKind(user, 'CREDIT_NOTE');
    await chooseCreditNoteStandalone(user);
    expect(screen.getByRole('region', { name: 'รายการที่จะลด' })).toBeInTheDocument();
    expect(screen.getAllByLabelText(/^เหตุผล/)).toHaveLength(1);
    expect(screen.getByLabelText(/^ชื่อผู้ขาย/)).toBeInTheDocument();
  });

  it('โหมดอ้างอิง: แถวข้อมูลผู้ขายครบเมื่อมีวันที่ · โหมดไม่มีเอกสารต้นทางต้องมีชื่อผู้ขายด้วย', async () => {
    const user = mount();
    await chooseKind(user, 'CREDIT_NOTE');
    const mark = () =>
      within(screen.getByRole('region', { name: 'ข้อมูลผู้ขาย' })).getByRole('heading').querySelector('svg');
    expect(mark()).toHaveClass('text-primary');
    await chooseCreditNoteStandalone(user);
    expect(mark()).toHaveClass('text-muted-foreground');
  });
});
```

Run: `npx vitest run src/components/expense-form-v4/__tests__/ExpenseFormV4.round2.test.tsx`
Expected: FAIL — ไม่พบ region "อ้างอิงเอกสาร"

- [ ] **Step 2: แก้ `CreditNoteLinesSection.tsx`**

(ก) แทน import ตอนต้นไฟล์ด้วย:

```tsx
import { useId as useUiFieldId, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { Search, AlertCircle, Link2, FilePlus2 } from 'lucide-react';
import { ExpenseFormState, ExpenseLineForm } from './types';
import { ItemLinesSection } from './ItemLinesSection';
import { FormRow } from './layout/FormRow';
import { formControlClass, formLabelClass } from '@/components/ui/form-styles';
import { formatNumberDecimal } from '@/utils/formatters';
import { cn } from '@/lib/utils';
```

(ข) ส่วน `interface OriginalDoc`, `interface Props`, query ทั้งสองตัว, `lineTotal`, `remaining`, `exceedsCap`, `switchMode` **คงเดิมทุกบรรทัด** · แก้เฉพาะ docblock เหนือ component ให้เพิ่มบรรทัด:

```tsx
 * คืน FormRow ของตัวเอง (อ้างอิงเอกสาร / รายการที่จะลด) — ผู้เรียกไม่ต้องห่อ FormRow
```

(ค) แทน `return (...)` ทั้งก้อนด้วย:

```tsx
  const validCount = state.lines.filter((l) => l.category && parseFloat(l.unitPrice) > 0).length;
  const referenceComplete =
    !!state.cnReason.trim() && (isStandalone ? !!state.vendorName.trim() : !!state.originalDocumentId);
  const modeCard = (active: boolean) =>
    cn(
      'flex min-h-11 items-start gap-2 rounded-lg border p-3 text-left transition',
      active ? 'border-primary bg-primary/5 ring-1 ring-primary/40' : 'border-border bg-card hover:bg-accent',
    );

  return (
    <>
      <FormRow title="อ้างอิงเอกสาร" complete={referenceComplete}>
        <div className="space-y-4">
          {/* C4.1 — เลือกโหมด */}
          <div role="group" aria-labelledby={`${uiFieldId}-mode`}>
            <span id={`${uiFieldId}-mode`} className={formLabelClass}>โหมดใบลดหนี้</span>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <button type="button" onClick={() => switchMode('LINKED')} className={modeCard(!isStandalone)} aria-pressed={!isStandalone}>
                <Link2 className={cn('mt-0.5 size-4 shrink-0', !isStandalone ? 'text-primary' : 'text-muted-foreground')} aria-hidden="true" />
                <div className="space-y-0.5">
                  <div className="text-sm font-medium leading-snug">อ้างอิงใบเดิม</div>
                  <div className="text-xs leading-snug text-muted-foreground">
                    ลด/คืนจากเอกสาร EX ต้นทาง · ภ.30 link อัตโนมัติ
                  </div>
                </div>
              </button>
              <button type="button" onClick={() => switchMode('STANDALONE')} className={modeCard(isStandalone)} aria-pressed={isStandalone}>
                <FilePlus2 className={cn('mt-0.5 size-4 shrink-0', isStandalone ? 'text-primary' : 'text-muted-foreground')} aria-hidden="true" />
                <div className="space-y-0.5">
                  <div className="text-sm font-medium leading-snug">ไม่มีเอกสารต้นทาง</div>
                  <div className="text-xs leading-snug text-muted-foreground">
                    ผู้ขายคืนเงินโดยไม่มีใบกำกับเดิม · ระบุผู้ขายเอง
                  </div>
                </div>
              </button>
            </div>
          </div>

          {/* โหมดอ้างอิง — เลือกเอกสารต้นฉบับ */}
          {!isStandalone && (
            <div>
              <span className={formLabelClass}>เอกสารต้นฉบับ</span>
              {state.originalDocumentId && selectedDoc ? (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary/30 bg-primary/5 p-3">
                  <div className="min-w-0 leading-snug">
                    <div className="font-mono text-sm">{selectedDoc.number}</div>
                    <div className="text-sm">
                      {selectedDoc.vendorName ?? '—'} · ยอด {formatNumberDecimal(selectedDoc.totalAmount)} ฿
                    </div>
                    {capInfo && (
                      <div className="mt-1 text-xs text-muted-foreground">
                        เหลือลดได้: {formatNumberDecimal(capInfo.remainingCap)} ฿ (ใช้ไปแล้ว{' '}
                        {formatNumberDecimal(capInfo.usedTotal)} ฿)
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      onChange({ originalDocumentId: '' });
                      setSearch('');
                    }}
                    className="min-h-11 px-2 text-sm leading-snug text-destructive hover:underline"
                  >
                    เปลี่ยน
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                    <input aria-label="ค้นหาเลข EX-... / ผู้ขาย (3 ตัวขึ้นไป)"
                      type="text"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="ค้นหาเลข EX-... / ผู้ขาย (3 ตัวขึ้นไป)"
                      className={cn(formControlClass, 'pl-10')}
                    />
                  </div>
                  <p className="text-xs leading-snug text-muted-foreground">เลือกเอกสาร EX ที่ต้องการลดหนี้</p>
                  {(searchResults?.data ?? []).length > 0 && (
                    <div className="max-h-56 overflow-y-auto rounded-lg border border-border">
                      {searchResults!.data
                        .filter((d) => ['POSTED', 'ACCRUAL'].includes(d.status))
                        .map((doc) => (
                          <button
                            type="button"
                            key={doc.id}
                            onClick={() => {
                              onChange({ originalDocumentId: doc.id });
                              // เติมรายการจากเอกสารต้นฉบับ (ถ้ามี)
                              const sourceLines = doc.expenseDetail?.lines ?? [];
                              if (sourceLines.length > 0) {
                                onLinesChange(
                                  sourceLines.map((l, idx) => ({
                                    uid: `cn-${idx}-${Math.random().toString(36).slice(2)}`,
                                    category: l.category,
                                    description: '',
                                    quantity: '1',
                                    unitPrice: l.amountBeforeVat,
                                    discount: '0',
                                    vatPercent: '7',
                                    whtPercent: '0',
                                  })),
                                );
                              }
                            }}
                            className="flex min-h-11 w-full items-center justify-between gap-3 border-b border-border px-3 py-2 text-left text-sm leading-snug last:border-b-0 hover:bg-accent"
                          >
                            <div className="min-w-0">
                              <div className="font-mono">{doc.number}</div>
                              <div className="text-xs text-muted-foreground">
                                {doc.vendorName ?? '—'} · {doc.status}
                              </div>
                            </div>
                            <div className="shrink-0 font-mono text-sm">{formatNumberDecimal(doc.totalAmount)}</div>
                          </button>
                        ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* โหมดไม่มีเอกสารต้นทาง — ระบุผู้ขายเอง */}
          {isStandalone && (
            <div className="space-y-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor={`${uiFieldId}-2`} className={formLabelClass}>
                    ชื่อผู้ขาย <span className="text-destructive">*</span>
                  </label>
                  <input id={`${uiFieldId}-2`}
                    type="text"
                    value={state.vendorName}
                    onChange={(e) => onChange({ vendorName: e.target.value })}
                    placeholder="เช่น บจก. แอลฟ่า เซอร์วิส"
                    maxLength={255}
                    className={formControlClass}
                  />
                </div>
                <div>
                  <label htmlFor={`${uiFieldId}-3`} className={formLabelClass}>เลขผู้เสียภาษี (ทางเลือก)</label>
                  <input id={`${uiFieldId}-3`}
                    type="text"
                    value={state.vendorTaxId}
                    onChange={(e) => onChange({ vendorTaxId: e.target.value })}
                    placeholder="13 หลัก"
                    maxLength={20}
                    className={cn(formControlClass, 'font-mono')}
                  />
                </div>
              </div>
              <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/5 p-2 text-xs leading-snug text-warning-strong">
                <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                <span>ใบลดหนี้ที่ไม่มีเอกสารต้นทางไม่จำกัดยอดตามเอกสารเดิม โปรดตรวจยอดก่อนลงบัญชี</span>
              </div>
            </div>
          )}

          <div>
            <label htmlFor={`${uiFieldId}-1`} className={formLabelClass}>
              เหตุผลลดหนี้ <span className="text-destructive">*</span>
            </label>
            <input id={`${uiFieldId}-1`}
              type="text"
              value={state.cnReason}
              onChange={(e) => onChange({ cnReason: e.target.value })}
              placeholder={
                isStandalone
                  ? 'เช่น คืนเงินมัดจำ, ส่วนลดพิเศษ, ปรับยอด AP'
                  : 'เช่น สินค้าคืน, ปรับราคา, ส่วนลดหลังการขาย'
              }
              className={formControlClass}
            />
          </div>
        </div>
      </FormRow>

      {/* รายการ — โหมดไม่มีเอกสารต้นทางแสดงเสมอ · โหมดอ้างอิงแสดงหลังเลือกเอกสาร */}
      {(isStandalone || state.originalDocumentId) && (
        <FormRow title="รายการที่จะลด" layout="stacked" complete={validCount > 0}>
          <ItemLinesSection
            lines={state.lines}
            onChange={onLinesChange}
            priceTypeLabel={state.priceType === 'INCLUSIVE' ? 'ราคารวม VAT' : 'ราคาไม่รวม VAT'}
          />
          {exceedsCap && (
            <div role="alert" className="mt-2 flex items-start gap-2 text-sm leading-snug text-destructive">
              <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>ยอดรายการเกินที่ลดได้สูงสุด {formatNumberDecimal(remaining)} ฿</span>
            </div>
          )}
        </FormRow>
      )}
    </>
  );
```

ไอคอน `FileText` ไม่มีผู้ใช้แล้ว (ลบออกจาก import ตาม (ก) แล้ว)

- [ ] **Step 3: แก้ `ExpenseFormV4.tsx` สองจุด**

(ก) แทนบล็อกใบลดหนี้:

```tsx
        {state.docType === 'CREDIT_NOTE' && (
          <CreditNoteLinesSection state={state} onChange={patch} onLinesChange={(lines) => patch({ lines })} />
        )}
```

(ข) เครื่องหมายครบของแถว "ข้อมูลผู้ขาย" — ใบลดหนี้โหมดอ้างอิงไม่ใช้ชื่อผู้ขาย:

```tsx
        {showVendor && (
          <FormRow
            title="ข้อมูลผู้ขาย"
            complete={
              state.docType === 'CREDIT_NOTE' && state.cnMode === 'LINKED'
                ? !!state.documentDate
                : !!state.vendorName && !!state.documentDate
            }
          >
            <VendorSection state={state} onChange={patch} />
          </FormRow>
        )}
```

- [ ] **Step 4: รันเทสต์**

Run: `npx vitest run src/components/expense-form-v4`
Expected: ผ่านทั้งหมด (payload test ของใบลดหนี้ทั้งสองโหมดยังผ่าน)

Run: `npx tsc --noEmit -p .`
Expected: exit 0

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/expense-form-v4
git commit -m "feat(web): credit note as PEAK rows — reference row + items row, one reason field" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: ใบลดหนี้ — แถว "รับเงินคืนเข้า"

ฟอร์มส่ง `depositAccountCode` ของใบลดหนี้โหมดอ้างอิงอยู่แล้ววันนี้ (ค่าเริ่มต้นของผู้ใช้) แต่ไม่มีช่องให้เห็นหรือเลือก แถวนี้เปิดให้เลือก **ไม่เพิ่มฟิลด์ใน payload**

ฝั่ง server (`apps/api/src/modules/journal/cpa-templates/credit-note.template.ts`): เอกสารต้นฉบับ `POSTED` (จ่ายแล้ว) → `Dr <depositAccountCode>` (รับเงินคืนเข้าบัญชีนั้น) · เอกสารต้นฉบับ `ACCRUAL` (ยังตั้งหนี้) → `Dr 21-1104` ลดเจ้าหนี้ **ไม่ใช้บัญชีเงิน** ⇒ แถวนี้แสดงเฉพาะเมื่อเอกสารต้นฉบับที่เลือกเป็น `POSTED` (ข้อ D1 ท้ายแผน — แคบกว่า spec §5.3 ที่เขียนว่า "เฉพาะโหมดอ้างอิง")

**Files:**
- Modify: `apps/web/src/components/expense-form-v4/CreditNoteLinesSection.tsx`
- Test: `apps/web/src/components/expense-form-v4/__tests__/ExpenseFormV4.round2.test.tsx`

**Interfaces:**
- Consumes: `CashAccountSelect({ id, value, onChange, placeholder })` จาก `@/components/CashAccountSelect` · `selectedDoc` (ตัวแปรเดิมใน component) · `bodyOf`, `source` (ไฟล์เทสต์ของ Task 2) · `fillCreditNoteReason`, `saveDraft` (driver)

- [ ] **Step 1: เขียนเทสต์ (ต้องล้ม)**

ใน `ExpenseFormV4.round2.test.tsx` แก้ import ของ driver เป็น:

```ts
import {
  chooseCreditNoteStandalone, chooseKind, fillCreditNoteReason, pickCreditNoteSource, saveDraft, waitForSettlementDoc,
} from './expense-form-driver';
```

แล้วต่อท้ายไฟล์:

```tsx
describe('ใบลดหนี้ — รับเงินคืนเข้า', () => {
  it('เอกสารต้นฉบับจ่ายแล้ว: บัญชีที่เลือกในแถว รับเงินคืนเข้า คือค่าที่ส่งไป', async () => {
    const user = mount();
    await chooseKind(user, 'CREDIT_NOTE');
    await pickCreditNoteSource(user, 'EX-0', /EX-001/);
    await fillCreditNoteReason(user, 'คืนสินค้า');
    const row = await screen.findByRole('region', { name: 'รับเงินคืนเข้า' });
    const account = within(row).getByRole('combobox');
    expect(account).toHaveValue('11-1101');
    await user.selectOptions(account, '11-1201');
    await saveDraft(user);
    expect(await bodyOf('/expense-documents/credit-note')).toMatchObject({
      mode: 'LINKED', originalDocumentId: 'orig-1', reason: 'คืนสินค้า', depositAccountCode: '11-1201',
    });
  });

  it('เอกสารต้นฉบับยังตั้งหนี้อยู่: ไม่มีแถว รับเงินคืนเข้า', async () => {
    source.status = 'ACCRUAL';
    const user = mount();
    await chooseKind(user, 'CREDIT_NOTE');
    await pickCreditNoteSource(user, 'EX-0', /EX-001/);
    await screen.findByRole('region', { name: 'รายการที่จะลด' });
    expect(screen.queryByRole('region', { name: 'รับเงินคืนเข้า' })).not.toBeInTheDocument();
  });

  it('โหมดไม่มีเอกสารต้นทาง: ไม่มีแถว รับเงินคืนเข้า', async () => {
    const user = mount();
    await chooseKind(user, 'CREDIT_NOTE');
    await chooseCreditNoteStandalone(user);
    expect(screen.queryByRole('region', { name: 'รับเงินคืนเข้า' })).not.toBeInTheDocument();
  });
});
```

Run: `npx vitest run src/components/expense-form-v4/__tests__/ExpenseFormV4.round2.test.tsx`
Expected: FAIL — ไม่พบ region "รับเงินคืนเข้า"

- [ ] **Step 2: เพิ่มแถวใน `CreditNoteLinesSection.tsx`**

(ก) import:

```tsx
import { CashAccountSelect } from '@/components/CashAccountSelect';
```

(ข) ต่อจากบล็อก `{(isStandalone || state.originalDocumentId) && (<FormRow title="รายการที่จะลด" ...>)}` ก่อนปิด `</>`:

```tsx
      {/* เอกสารต้นฉบับที่จ่ายแล้ว (POSTED) — server ลง Dr บัญชีนี้ · ต้นฉบับที่ยังตั้งหนี้ลดเจ้าหนี้ ไม่ใช้บัญชีเงิน */}
      {!isStandalone && selectedDoc?.status === 'POSTED' && (
        <FormRow title="รับเงินคืนเข้า" complete={!!state.depositAccountCode}>
          <div className="w-full sm:max-w-md">
            <label htmlFor={`${uiFieldId}-refund`} className="sr-only">รับเงินคืนเข้า</label>
            <CashAccountSelect
              id={`${uiFieldId}-refund`}
              placeholder="รับเงินคืนเข้า"
              value={state.depositAccountCode}
              onChange={(code) => onChange({ depositAccountCode: code })}
            />
          </div>
        </FormRow>
      )}
```

(`sr-only` ตรงนี้อยู่นอกตารางและนอกกล่องเลื่อน จึงไม่เข้าข้อห้ามใน Global Constraints)

- [ ] **Step 3: รันเทสต์**

Run: `npx vitest run src/components/expense-form-v4`
Expected: ผ่านทั้งหมด · payload test "ใบลดหนี้แบบอ้างอิงเอกสาร" ยังได้ `depositAccountCode: '11-1101'` (ไม่ได้แตะตัวเลือก)

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/expense-form-v4
git commit -m "feat(web): credit note shows the refund account row when the source document was paid" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: เงินสดย่อย — แถวผู้ดูแล, ตารางสัดส่วน PEAK, กล่องสรุป

Spec §5.4 · ปัญหาที่เจอรอบ 1: ช่อง "หมวดบัญชี" กว้างราว 93px ข้อความ "เลือกหมวดบัญชี" ขึ้น 3 บรรทัด และ "เลข - ชื่อ" ถูกตัดเกือบหมด
ตารางใหม่ใช้แบบเดียวกับตารางรายจ่าย: สองแถวต่อรายการ — แถวบน # / ผู้ขาย / หมวดบัญชี / จำนวน / VAT % / รวม / ลบ · แถวล่าง เลขใบกำกับฯ (ใต้ผู้ขาย) + รายละเอียด (ใต้หมวดบัญชี)
ความกว้าง: # 24 · ผู้ขาย 208 · จำนวน 112 · VAT % 80 · รวม 96 · ลบ 44 · หมวดบัญชี = ที่เหลือ (ราว 335px บนการ์ด 899px ที่จอ 1280 เปิดเมนูข้าง)

**Files:**
- Create: `apps/web/src/components/expense-form-v4/petty-cash-totals.ts`
- Create: `apps/web/src/components/expense-form-v4/__tests__/petty-cash-totals.test.ts`
- Create: `apps/web/src/components/expense-form-v4/__tests__/PettyCashLinesSection.test.tsx`
- Modify: `apps/web/src/components/expense-form-v4/PettyCashLinesSection.tsx` (เขียนใหม่ทั้งไฟล์)
- Modify: `apps/web/src/components/expense-form-v4/ExpenseFormV4.tsx` (JSX + บล็อกส่วนของหน้าจอ)
- Modify: `apps/web/src/components/expense-form-v4/__tests__/expense-form-driver.ts` (`fillPettyCashLine`)
- Test: `apps/web/src/components/expense-form-v4/__tests__/ExpenseFormV4.round2.test.tsx`

**Interfaces:**
- Produces:
  - `pettyCashTotals(value: PettyCashFormFields): { lines: { uid: string; base: number; vat: number; total: number }[]; sumBase: number; sumVat: number; sumTotal: number }`
  - `PettyCashCustodianField({ value, onChange }: { value: PettyCashFormFields; onChange: (v: PettyCashFormFields) => void })`
  - `PettyCashLinesSection({ value, onChange })` — props เดิม ไม่มีช่องผู้ดูแลและไม่มีบรรทัดสรุปที่หัวส่วนแล้ว

- [ ] **Step 1: เขียนเทสต์ของ `pettyCashTotals` (ต้องล้ม)**

`apps/web/src/components/expense-form-v4/__tests__/petty-cash-totals.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { pettyCashTotals } from '../petty-cash-totals';
import { newPettyCashLine } from '../types';

describe('pettyCashTotals', () => {
  it('คิด VAT ต่อบรรทัดแล้วรวม', () => {
    const totals = pettyCashTotals({
      custodianName: '',
      lines: [
        newPettyCashLine({ uid: 'a', amount: '100', vatPercent: '7' }),
        newPettyCashLine({ uid: 'b', amount: '50.50', vatPercent: '0' }),
      ],
    });
    expect(totals.lines).toEqual([
      { uid: 'a', base: 100, vat: 7, total: 107 },
      { uid: 'b', base: 50.5, vat: 0, total: 50.5 },
    ]);
    expect(totals.sumBase).toBe(150.5);
    expect(totals.sumVat).toBe(7);
    expect(totals.sumTotal).toBe(157.5);
  });

  it('บรรทัดที่ยังไม่กรอกยอดนับเป็นศูนย์', () => {
    const totals = pettyCashTotals({ custodianName: '', lines: [newPettyCashLine({ uid: 'a' })] });
    expect(totals).toMatchObject({ sumBase: 0, sumVat: 0, sumTotal: 0 });
  });
});
```

Run: `npx vitest run src/components/expense-form-v4/__tests__/petty-cash-totals.test.ts`
Expected: FAIL — หาไฟล์ `../petty-cash-totals` ไม่เจอ

- [ ] **Step 2: เขียน `pettyCashTotals`**

`apps/web/src/components/expense-form-v4/petty-cash-totals.ts`:

```ts
import type { PettyCashFormFields } from './types';

/**
 * ยอดของใบเงินสดย่อย — สูตรเดิมของ PettyCashLinesSection:
 * VAT ต่อบรรทัด = round(ฐาน × อัตรา) / 100 · รวมต่อบรรทัด = ฐาน + VAT
 */
export function pettyCashTotals(value: PettyCashFormFields) {
  const lines = value.lines.map((l) => {
    const base = parseFloat(l.amount) || 0;
    const vatPct = parseFloat(l.vatPercent) || 0;
    const vat = Math.round(base * vatPct) / 100;
    return { uid: l.uid, base, vat, total: base + vat };
  });
  const sumBase = lines.reduce((s, l) => s + l.base, 0);
  const sumVat = lines.reduce((s, l) => s + l.vat, 0);
  return { lines, sumBase, sumVat, sumTotal: sumBase + sumVat };
}
```

Run: `npx vitest run src/components/expense-form-v4/__tests__/petty-cash-totals.test.ts`
Expected: `Tests  2 passed (2)`

- [ ] **Step 3: เขียนเทสต์ของ section (ต้องล้ม)**

`apps/web/src/components/expense-form-v4/__tests__/PettyCashLinesSection.test.tsx`:

```tsx
import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/hooks/useUserNames', () => ({ useUserNames: () => ['สมชาย ใจดี'] }));
vi.mock('../VendorCombobox', () => ({
  VendorCombobox: ({ value, onSelectSupplier }: { value: string; onSelectSupplier: (s: unknown) => void }) => (
    <button type="button" onClick={() => onSelectSupplier({ name: 'ร้านตัวอย่าง', taxId: '', supplierId: 'sup-1' })}>
      {value || 'เลือกผู้ขาย'}
    </button>
  ),
}));
vi.mock('@/pages/other-income/components/AccountSearchDropdown', () => ({
  AccountSearchDropdown: (props: { value: string; onChange: (code: string) => void; 'aria-label'?: string }) => (
    <button type="button" aria-label={props['aria-label'] ?? 'บัญชี'} onClick={() => props.onChange('53-1101')}>
      {props.value || '—'}
    </button>
  ),
}));

import { PettyCashCustodianField, PettyCashLinesSection } from '../PettyCashLinesSection';
import { newPettyCashLine, type PettyCashFormFields } from '../types';

function Harness() {
  const [value, setValue] = useState<PettyCashFormFields>(() => ({
    custodianName: '', lines: [newPettyCashLine()],
  }));
  return (
    <>
      <PettyCashCustodianField value={value} onChange={setValue} />
      <PettyCashLinesSection value={value} onChange={setValue} />
    </>
  );
}

describe('PettyCashLinesSection', () => {
  it('หัวคอลัมน์ตามสัดส่วนใหม่ และทุกช่องในตารางมีชื่อ', () => {
    render(<Harness />);
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent || h.getAttribute('aria-label'))).toEqual([
      '#', 'ผู้ขาย/ผู้รับเงิน / เลขใบกำกับฯ', 'หมวดบัญชี / รายละเอียด', 'จำนวน', 'VAT %', 'รวม', 'ลบ',
    ]);
    expect(screen.getByRole('button', { name: 'หมวดบัญชี' })).toBeInTheDocument();
    for (const name of ['จำนวน', 'VAT %', 'เลขใบกำกับฯ', 'รายละเอียด']) {
      expect(screen.getByLabelText(name)).toBeInTheDocument();
    }
    expect(screen.getByRole('button', { name: 'ลบรายการ #1' })).toBeDisabled();
  });

  it('กล่องเลื่อนของตารางเป็น relative และในตารางไม่มี sr-only', () => {
    render(<Harness />);
    const table = screen.getByRole('table');
    expect(table.parentElement).toHaveClass('relative', 'overflow-x-auto');
    expect(table.querySelector('.sr-only')).toBeNull();
  });

  it('ไม่มีบรรทัดสรุปที่หัวส่วน · แถวรวมท้ายตารางคิดจากยอดที่กรอก', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    expect(screen.queryByText(/ผู้ขาย · รวม/)).not.toBeInTheDocument();
    await user.type(screen.getByLabelText('จำนวน'), '120');
    const footer = screen.getByRole('table').querySelector('tfoot')!;
    expect(footer).toHaveTextContent('รวม');
    expect(footer).toHaveTextContent('120.00');
  });

  it('เพิ่มรายการแล้วลบได้ และผู้ดูแลเงินสดย่อยมีป้ายผูกกับช่อง', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'เพิ่มรายการ' }));
    expect(screen.getAllByLabelText('จำนวน')).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: 'ลบรายการ #2' }));
    expect(screen.getAllByLabelText('จำนวน')).toHaveLength(1);
    expect(screen.getByLabelText('ผู้ดูแลเงินสดย่อย')).toBeInTheDocument();
    expect(screen.getByText('ไม่บังคับ')).toBeInTheDocument();
  });
});
```

Run: `npx vitest run src/components/expense-form-v4/__tests__/PettyCashLinesSection.test.tsx`
Expected: FAIL — `PettyCashCustodianField` ไม่มีใน export

- [ ] **Step 4: เขียน `PettyCashLinesSection.tsx` ใหม่ทั้งไฟล์**

```tsx
import { useId } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { NumberInput } from '@/components/ui/NumberInput';
import { NameAutocomplete } from '@/components/ui/NameAutocomplete';
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select';
import { formControlClass } from '@/components/ui/form-styles';
import { AccountSearchDropdown } from '@/pages/other-income/components/AccountSearchDropdown';
import { useUserNames } from '@/hooks/useUserNames';
import { formatNumberDecimal } from '@/utils/formatters';
import { cn } from '@/lib/utils';
import { PettyCashFormFields, newPettyCashLine } from './types';
import { pettyCashTotals } from './petty-cash-totals';
import { VendorCombobox } from './VendorCombobox';

interface Props {
  value: PettyCashFormFields;
  onChange: (v: PettyCashFormFields) => void;
}

/** ผู้ดูแลเงินสดย่อย — แถวของตัวเองในหน้า (ชื่อแถวเป็นป้ายที่มองเห็น) */
export function PettyCashCustodianField({ value, onChange }: Props) {
  const custodianId = useId();
  const custodianNames = useUserNames();
  return (
    <div className="w-full sm:max-w-md">
      <label htmlFor={custodianId} className="sr-only">ผู้ดูแลเงินสดย่อย</label>
      <NameAutocomplete
        id={custodianId}
        value={value.custodianName}
        onChange={(v) => onChange({ ...value, custodianName: v })}
        options={custodianNames}
        placeholder="ชื่อพนักงานที่ดูแลเงินสดย่อย"
      />
      <p className="mt-1.5 text-xs leading-snug text-muted-foreground">ไม่บังคับ</p>
    </div>
  );
}

/**
 * C1.6 — รายการเงินสดย่อย · ต่อบรรทัด: ผู้ขาย, หมวดบัญชี, รายละเอียด, จำนวน, VAT %, เลขใบกำกับฯ
 * ไม่มีภาษีหัก ณ ที่จ่าย (ผู้ขายที่ต้องหักใช้เอกสารรายจ่ายปกติ)
 * สัดส่วนคอลัมน์แบบตารางรายจ่าย: ตัวเลขแถวบน · เลขใบกำกับฯ กับรายละเอียดอยู่แถวล่าง
 */
export function PettyCashLinesSection({ value, onChange }: Props) {
  const updateLine = (uid: string, p: Partial<(typeof value.lines)[number]>) => {
    onChange({ ...value, lines: value.lines.map((l) => (l.uid === uid ? { ...l, ...p } : l)) });
  };
  const removeLine = (uid: string) => {
    if (value.lines.length === 1) return;
    onChange({ ...value, lines: value.lines.filter((l) => l.uid !== uid) });
  };
  const addLine = () => onChange({ ...value, lines: [...value.lines, newPettyCashLine()] });

  const totals = pettyCashTotals(value);
  const money = (n: number) => formatNumberDecimal(n.toString(), 2);

  const cell = 'px-[3px] py-1.5 align-top';
  const head = 'px-2 py-2.5 text-xs font-semibold leading-snug text-muted-foreground whitespace-nowrap';
  const foot = 'px-2 py-2.5 text-right tabular-nums';

  return (
    <div className="space-y-3">
      {/* relative: ทุกอย่างในตารางต้องถูกตัดอยู่ในกล่องเลื่อนนี้ (จอเล็กเลื่อนแนวนอน) */}
      <div className="relative overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[52rem] table-fixed text-sm">
          <colgroup>
            <col className="w-6" />
            <col className="w-52" />
            <col />
            <col className="w-28" />
            <col className="w-20" />
            <col className="w-24" />
            <col className="w-11" />
          </colgroup>
          <thead className="bg-muted/50">
            <tr>
              <th scope="col" className={cn(head, 'text-center')}>#</th>
              <th scope="col" className={cn(head, 'text-left')}>ผู้ขาย/ผู้รับเงิน / เลขใบกำกับฯ</th>
              <th scope="col" className={cn(head, 'text-left')}>หมวดบัญชี / รายละเอียด</th>
              <th scope="col" className={cn(head, 'text-right')}>จำนวน</th>
              <th scope="col" className={cn(head, 'text-right')}>VAT %</th>
              <th scope="col" className={cn(head, 'text-right')}>รวม</th>
              <th scope="col" aria-label="ลบ" className={head} />
            </tr>
          </thead>
          {value.lines.map((l, idx) => (
            <tbody key={l.uid} className="border-t border-border">
              <tr>
                <td rowSpan={2} className={cn(cell, 'pt-4 text-center text-xs tabular-nums text-muted-foreground')}>
                  {idx + 1}
                </td>
                <td className={cell}>
                  <VendorCombobox
                    value={l.supplierName}
                    onSelectSupplier={(s) => updateLine(l.uid, { supplierName: s.name, supplierId: s.supplierId })}
                  />
                </td>
                <td className={cell}>
                  <AccountSearchDropdown
                    aria-label="หมวดบัญชี"
                    value={l.category}
                    onChange={(code) => updateLine(l.uid, { category: code })}
                    filter={(a) => a.code.startsWith('53-')}
                    placeholder="เลือกหมวดบัญชี"
                  />
                </td>
                <td className={cell}>
                  <NumberInput unstyled
                    aria-label="จำนวน"
                    step="0.01"
                    min="0"
                    value={l.amount}
                    onChange={(e) => updateLine(l.uid, { amount: e.target.value })}
                    placeholder="0.00"
                    className={cn(formControlClass, 'px-2 text-right tabular-nums')}
                  />
                </td>
                <td className={cell}>
                  <Select value={l.vatPercent} onValueChange={(v) => updateLine(l.uid, { vatPercent: v })}>
                    <SelectTrigger aria-label="VAT %" className="h-11 w-full px-2">
                      <span className="tabular-nums">{l.vatPercent}%</span>
                    </SelectTrigger>
                    <SelectContent align="end">
                      <SelectItem value="0">0%</SelectItem>
                      <SelectItem value="7">7%</SelectItem>
                    </SelectContent>
                  </Select>
                </td>
                <td className={cn(cell, 'px-2 pt-4 text-right font-medium tabular-nums')}>
                  {money(totals.lines[idx].total)}
                </td>
                <td rowSpan={2} className={cn(cell, 'px-0')}>
                  <button data-ui-control="button" data-ui-icon="true"
                    type="button"
                    onClick={() => removeLine(l.uid)}
                    disabled={value.lines.length === 1}
                    aria-label={`ลบรายการ #${idx + 1}`}
                    className="flex min-h-11 w-full items-center justify-center rounded-md text-muted-foreground hover:text-destructive disabled:cursor-not-allowed disabled:opacity-30"
                  >
                    <Trash2 className="size-4" aria-hidden="true" />
                  </button>
                </td>
              </tr>
              <tr>
                <td className={cn(cell, 'pt-0 pb-2.5')}>
                  <input
                    type="text"
                    aria-label="เลขใบกำกับฯ"
                    value={l.taxInvoiceNo}
                    onChange={(e) => updateLine(l.uid, { taxInvoiceNo: e.target.value })}
                    placeholder="เลขใบกำกับฯ"
                    className={formControlClass}
                  />
                </td>
                <td className={cn(cell, 'pt-0 pb-2.5')}>
                  <input
                    type="text"
                    aria-label="รายละเอียด"
                    value={l.description}
                    onChange={(e) => updateLine(l.uid, { description: e.target.value })}
                    placeholder="รายละเอียด"
                    className={formControlClass}
                  />
                </td>
                <td colSpan={3} />
              </tr>
            </tbody>
          ))}
          <tfoot className="border-t border-border bg-muted/30">
            <tr>
              <td colSpan={3} className="px-2 py-2.5 text-right leading-snug text-muted-foreground">รวม</td>
              <td className={foot}>{money(totals.sumBase)}</td>
              <td className={cn(foot, 'text-muted-foreground')}>{money(totals.sumVat)}</td>
              <td className={cn(foot, 'font-medium')}>{money(totals.sumTotal)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      <button data-ui-control="button"
        type="button"
        onClick={addLine}
        className="flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-border py-3 text-sm leading-snug text-muted-foreground hover:border-primary hover:text-foreground lg:w-auto lg:px-6"
      >
        <Plus className="size-4" aria-hidden="true" /> เพิ่มรายการ
      </button>
    </div>
  );
}
```

Run: `npx vitest run src/components/expense-form-v4/__tests__/PettyCashLinesSection.test.tsx`
Expected: `Tests  4 passed (4)`

- [ ] **Step 5: แก้ driver — ตัวเลือกบัญชีของเงินสดย่อยมีชื่อใหม่**

ใน `expense-form-driver.ts` แก้ `fillPettyCashLine`:

```ts
/** เงินสดย่อย — บรรทัดแรก: เลือกผู้ขาย (ปุ่มแทน VendorCombobox) · เลือกบัญชี 53-1101 (ปุ่มแทน AccountSearchDropdown) · กรอกยอด */
export async function fillPettyCashLine(user: UserEvent, line: { amount: string }) {
  await user.click(screen.getByRole('button', { name: 'เลือกผู้ขาย' }));
  await user.click(screen.getByRole('button', { name: 'หมวดบัญชี' }));
  await user.type(screen.getByLabelText('จำนวน'), line.amount);
}
```

- [ ] **Step 6: เขียนเทสต์ระดับฟอร์ม (ต้องล้ม)**

ใน `ExpenseFormV4.round2.test.tsx` เพิ่ม `fillPettyCashLine` ใน import ของ driver แล้วต่อท้ายไฟล์:

```tsx
describe('เงินสดย่อย', () => {
  it('มีแถวผู้ดูแลเงินสดย่อย และกล่องสรุปคิดจากรายการ', async () => {
    const user = mount();
    await chooseKind(user, 'PETTY_CASH');
    expect(screen.getByRole('region', { name: 'ผู้ดูแลเงินสดย่อย' })).toBeInTheDocument();
    const summary = screen.getByRole('region', { name: 'สรุปข้อมูล' });
    expect(within(summary).getByText('จำนวนเงินทั้งสิ้น').parentElement).toHaveTextContent('—');
    await fillPettyCashLine(user, { amount: '120' });
    expect(within(summary).getByText('มูลค่าก่อนภาษี').parentElement).toHaveTextContent('120.00');
    expect(within(summary).getByText('ภาษีมูลค่าเพิ่ม').parentElement).toHaveTextContent('0.00');
    expect(within(summary).getByText('จำนวนเงินทั้งสิ้น').parentElement).toHaveTextContent('120.00');
  });
});
```

Run: `npx vitest run src/components/expense-form-v4/__tests__/ExpenseFormV4.round2.test.tsx`
Expected: FAIL — ไม่พบ region "ผู้ดูแลเงินสดย่อย"

- [ ] **Step 7: ต่อแถวใหม่ใน `ExpenseFormV4.tsx`**

(ก) import:

```tsx
import { PettyCashCustodianField, PettyCashLinesSection } from './PettyCashLinesSection';
import { pettyCashTotals } from './petty-cash-totals';
```

(ข) ในบล็อก "ส่วนของหน้าจอ" ใต้ `seMoney` เพิ่ม:

```tsx
  // เงินสดย่อย — ตัวเลขชุดเดียวกับแถวรวมท้ายตาราง (ยังไม่มียอด = —)
  const pcTotals = pettyCashTotals(state.pettyCash);
  const pcMoney = (n: number) => (pcTotals.sumTotal === 0 ? '—' : formatNumberDecimal(n));
```

(ค) แทนบล็อก `{state.docType === 'PETTY_CASH_REIMBURSEMENT' && pettyCashEnabled && (...)}` (คงคอมเมนต์ D1.1.5.1 ที่อยู่เหนือบล็อกไว้) ด้วย:

```tsx
        {state.docType === 'PETTY_CASH_REIMBURSEMENT' && pettyCashEnabled && (
          <FormRow title="ผู้ดูแลเงินสดย่อย" complete>
            <PettyCashCustodianField value={state.pettyCash} onChange={(pc) => patch({ pettyCash: pc })} />
          </FormRow>
        )}
        {state.docType === 'PETTY_CASH_REIMBURSEMENT' && pettyCashEnabled && (
          <FormRow title="รายการเงินสดย่อย" layout="stacked" complete={itemCount > 0}>
            <PettyCashLinesSection value={state.pettyCash} onChange={(pc) => patch({ pettyCash: pc })} />
          </FormRow>
        )}
```

(ง) ใต้บล็อก "สรุปข้อมูล" ของ `VENDOR_SETTLEMENT` (Task 2) เพิ่ม:

```tsx
        {state.docType === 'PETTY_CASH_REIMBURSEMENT' && pettyCashEnabled && (
          <FormRow title="สรุปข้อมูล">
            <SummaryBox
              rows={[
                { label: 'มูลค่าก่อนภาษี', value: pcMoney(pcTotals.sumBase) },
                { label: 'ภาษีมูลค่าเพิ่ม', value: pcMoney(pcTotals.sumVat) },
              ]}
              total={{ label: 'จำนวนเงินทั้งสิ้น', value: pcMoney(pcTotals.sumTotal) }}
            />
          </FormRow>
        )}
```

(ป้ายใช้คำเดียวกับกล่องสรุปของรายจ่าย — ข้อ D2 ท้ายแผน)

- [ ] **Step 8: รันเทสต์**

Run: `npx vitest run src/components/expense-form-v4`
Expected: ผ่านทั้งหมด (payload test "เงินสดย่อย" ผ่านด้วย driver ที่แก้ใน Step 5)

Run: `npx tsc --noEmit -p .`
Expected: exit 0

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/components/expense-form-v4
git commit -m "feat(web): PEAK-style petty cash — custodian row, wide account column, summary box" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: เก็บข้อย่อยด้านการเข้าถึงจากรอบ 1

รายการจาก `.superpowers/sdd/final-review-report.md` (M-1, M-2, M-3) + ledger Task 4:
หน้าไม่มี `h1` · เมนูประเภทไม่บอกรายการที่เลือกอยู่ · เลข "5" ที่เหลือจากฟอร์มแบบเดิมและหัวข้อ `h2` ซ้อนใน `h3` · ปุ่ม "ย่อ/ขยาย" ไม่บอกว่าย่ออะไร · โหมดขั้นสูงยุบเองเมื่อผู้ใช้ลบรายการปรับปรุงจนหมด

**Files:**
- Modify: `apps/web/src/components/expense-form-v4/layout/DocTypeMenu.tsx`
- Modify: `apps/web/src/components/expense-form-v4/layout/__tests__/DocTypeMenu.test.tsx`
- Modify: `apps/web/src/components/expense-form-v4/__tests__/expense-form-driver.ts` (`chooseKind`)
- Modify: `apps/web/src/components/expense-form-v4/AdjustmentSection.tsx:107-118`
- Modify: `apps/web/src/components/expense-form-v4/__tests__/AdjustmentSection.readonly.test.tsx`
- Modify: `apps/web/src/components/expense-form-v4/layout/PaymentSection.tsx`
- Modify: `apps/web/src/components/expense-form-v4/layout/__tests__/PaymentSection.test.tsx`
- Modify: `apps/web/src/components/expense-form-v4/ExpenseFormV4.tsx` (ปุ่มย่อ/ขยาย)
- Modify: `apps/web/src/components/expense-form-v4/__tests__/ExpenseFormV4.page.test.tsx` (ชื่อปุ่ม)

- [ ] **Step 1: แก้เทสต์ของ `DocTypeMenu` (ต้องล้ม)**

ใน `DocTypeMenu.test.tsx`:
- แทนทุก `'menuitem'` ด้วย `'menuitemradio'` (7 ตำแหน่ง: `findAllByRole`, `findByRole`, `queryByRole`)
- แก้เทสต์ "locked" และเพิ่มสองเทสต์:

```tsx
  it('locked แสดงชื่ออย่างเดียว ไม่มีปุ่มเปิดเมนู', () => {
    render(<DocTypeMenu value="PAYROLL" onChange={() => {}} locked />);
    expect(screen.getByRole('heading', { level: 1, name: 'เงินเดือน' })).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('ชื่อเอกสารเป็นหัวเรื่องระดับ 1 ของหน้า', () => {
    render(<DocTypeMenu value="EXPENSE_SAMEDAY" onChange={() => {}} />);
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
  });

  it('บอกรายการที่เลือกอยู่ด้วย aria-checked', async () => {
    render(<DocTypeMenu value="CREDIT_NOTE" onChange={() => {}} />);
    await open();
    expect(await screen.findByRole('menuitemradio', { name: 'ใบลดหนี้' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('menuitemradio', { name: 'เงินเดือน' })).toHaveAttribute('aria-checked', 'false');
  });
```

Run: `npx vitest run src/components/expense-form-v4/layout/__tests__/DocTypeMenu.test.tsx`
Expected: FAIL — ไม่พบ role `menuitemradio`

- [ ] **Step 2: แก้ `DocTypeMenu.tsx`**

(ก) import:

```tsx
import { ChevronDown } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
```

(ข) แทนตั้งแต่บรรทัด `if (locked) return ...` ถึงท้าย component:

```tsx
  if (locked) return <h1 className={titleClass}>{docTypeLabel(value)}</h1>;

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
    <h1 className="m-0">
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
          {/* radio item: จุดหน้ารายการ + aria-checked บอกประเภทที่เลือกอยู่ */}
          <DropdownMenuRadioGroup value={current} onValueChange={(key) => pick(key as MenuKey)}>
            {items.map((item) => (
              <DropdownMenuRadioItem key={item.key} value={item.key} className="min-h-11 text-sm leading-snug">
                {item.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </h1>
  );
```

- [ ] **Step 3: แก้ driver ให้หา `menuitemradio`**

ใน `expense-form-driver.ts` บรรทัดสุดท้ายของ `chooseKind`:

```ts
  await user.click(await screen.findByRole('menuitemradio', { name: MENU_ITEM[kind]! }));
```

Run: `npx vitest run src/components/expense-form-v4/layout/__tests__/DocTypeMenu.test.tsx src/components/expense-form-v4/__tests__`
Expected: ผ่านทั้งหมด

- [ ] **Step 4: `AdjustmentSection` — ถอดเลข "5" และลดระดับหัวข้อ (เทสต์ก่อน)**

ใน `AdjustmentSection.readonly.test.tsx` ต่อท้าย `describe`:

```tsx
  it('หัวข้อเป็นระดับ 4 (อยู่ใต้หัวข้อ ชำระเงิน) และไม่มีเลขขั้นของฟอร์มแบบเดิม', () => {
    render(
      <AdjustmentSection
        diff="0.00"
        amountPaid=""
        onAmountPaidChange={() => {}}
        adjustments={[]}
        onChange={() => {}}
        netExpected="100.00"
      />,
    );
    expect(screen.getByRole('heading', { level: 4, name: 'บัญชีปรับผลต่าง' })).toBeInTheDocument();
    expect(screen.queryByText('5')).not.toBeInTheDocument();
  });
```

Run: `npx vitest run src/components/expense-form-v4/__tests__/AdjustmentSection.readonly.test.tsx`
Expected: FAIL — ไม่พบ heading ระดับ 4

ใน `AdjustmentSection.tsx` แทนบล็อก `<div className="flex items-start gap-3 mb-3">...</div>` (บรรทัด 108–118) ด้วย:

```tsx
      <div className="mb-3">
        <h4 className="text-base font-semibold leading-snug">บัญชีปรับผลต่าง</h4>
        <p className="text-xs leading-snug text-muted-foreground">
          ใช้เมื่อจำนวนเงินที่จ่ายจริงไม่ตรงกับยอดที่ใบกำกับฯ ระบุ (ปัดเศษ / ส่วนลดเล็กน้อย / จ่ายเกิน / จ่ายน้อย)
        </p>
      </div>
```

Run: `npx vitest run src/components/expense-form-v4/__tests__/AdjustmentSection.readonly.test.tsx`
Expected: `Tests  3 passed (3)`

- [ ] **Step 5: `PaymentSection` — ขั้นสูงไม่ยุบเอง + คำอธิบายผูกกับปุ่มที่ล็อก (เทสต์ก่อน)**

ใน `PaymentSection.test.tsx` ต่อท้าย `describe`:

```tsx
  it('ข้อมูลปรับปรุงหมดแล้ว ยังอยู่ที่ขั้นสูงจนกว่าผู้ใช้จะกดพื้นฐานเอง', async () => {
    const props = { hasData: true, onClear: vi.fn(), content };
    const { rerender } = render(<PaymentSection picker={picker} advanced={props} />);
    rerender(<PaymentSection picker={picker} advanced={{ ...props, hasData: false }} />);
    expect(screen.getByText('รายการปรับปรุง')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'พื้นฐาน' })).toBeEnabled();
    await userEvent.click(screen.getByRole('radio', { name: 'พื้นฐาน' }));
    expect(screen.queryByText('รายการปรับปรุง')).not.toBeInTheDocument();
  });

  it('ปุ่มพื้นฐานที่ล็อกอยู่ มีคำอธิบายผูกไว้', () => {
    render(<PaymentSection picker={picker} advanced={{ hasData: true, onClear: vi.fn(), content }} />);
    expect(screen.getByRole('radio', { name: 'พื้นฐาน' })).toHaveAccessibleDescription(
      'มีรายการปรับปรุงอยู่ จึงกลับไป "พื้นฐาน" ไม่ได้จนกว่าจะล้างรายการ',
    );
  });
```

Run: `npx vitest run src/components/expense-form-v4/layout/__tests__/PaymentSection.test.tsx`
Expected: FAIL — เทสต์แรก: "รายการปรับปรุง" หายหลัง `hasData` เป็น false · เทสต์สอง: ไม่มีคำอธิบาย

ใน `PaymentSection.tsx`:

(ก) ใต้บรรทัด `const [mode, setMode] = useState<'basic' | 'advanced'>('basic');` เพิ่ม:

```tsx
  // มีข้อมูลปรับปรุง = ค้างที่ขั้นสูง — ลบข้อมูลจนหมดแล้วก็ไม่ยุบเอง ผู้ใช้กด "พื้นฐาน" เอง
  if (advanced?.hasData && mode === 'basic') setMode('advanced');
```

(ข) radio "พื้นฐาน" เพิ่ม `aria-describedby`:

```tsx
                <input
                  type="radio"
                  name={`${headingId}-mode`}
                  className="size-4 accent-primary"
                  checked={!showAdvanced}
                  disabled={advanced.hasData}
                  aria-describedby={advanced.hasData ? `${headingId}-locked` : undefined}
                  onChange={() => setMode('basic')}
                />
```

(ค) ย่อหน้าคำอธิบายใส่ `id`:

```tsx
                <p id={`${headingId}-locked`} className="text-sm leading-snug text-muted-foreground">
                  มีรายการปรับปรุงอยู่ จึงกลับไป "พื้นฐาน" ไม่ได้จนกว่าจะล้างรายการ
                </p>
```

Run: `npx vitest run src/components/expense-form-v4/layout/__tests__/PaymentSection.test.tsx`
Expected: `Tests  8 passed (8)`

- [ ] **Step 6: ปุ่ม "ย่อ/ขยาย" ของตัวอย่างรายการบัญชี (เทสต์ก่อน)**

ใน `ExpenseFormV4.page.test.tsx` เทสต์ "ตัวอย่างรายการบัญชีย่อไว้ และบอกว่าสมดุลที่หัวแถว" แทนสองบรรทัดสุดท้ายด้วย:

```tsx
    const toggle = within(row).getByRole('button', { name: 'ย่อ/ขยาย ตัวอย่างรายการบัญชี' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await user.click(toggle);
    expect(await within(row).findByRole('table')).toBeInTheDocument();
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(document.getElementById(toggle.getAttribute('aria-controls')!)).toContainElement(within(row).getByRole('table'));
```

Run: `npx vitest run src/components/expense-form-v4/__tests__/ExpenseFormV4.page.test.tsx`
Expected: FAIL — ไม่พบปุ่มชื่อ "ย่อ/ขยาย ตัวอย่างรายการบัญชี"

ใน `ExpenseFormV4.tsx`:

(ก) ในบล็อก "ส่วนของหน้าจอ" ใต้ `const [showJe, setShowJe] = useState(false);` เพิ่ม:

```tsx
  const jePanelId = useId();
```

(ข) แทนปุ่มย่อ/ขยายและเนื้อหาของแถว "ตัวอย่างรายการบัญชี":

```tsx
                <button
                  type="button"
                  aria-label="ย่อ/ขยาย ตัวอย่างรายการบัญชี"
                  aria-expanded={showJe || !!error}
                  aria-controls={jePanelId}
                  disabled={!!error}
                  onClick={() => setShowJe((v) => !v)}
                  className="min-h-11 px-1 text-sm font-medium leading-snug text-primary disabled:opacity-50"
                >
                  ย่อ/ขยาย
                </button>
```

```tsx
            <div id={jePanelId}>
              {(showJe || !!error) && <JePreview preview={preview} loading={loading} error={error} />}
            </div>
```

(คำนวณไม่ได้ = ตารางเปิดค้างให้เห็นข้อผิดพลาด ปุ่มจึงถูกปิด — เดิมกดแล้วไม่มีอะไรเกิด)

Run: `npx vitest run src/components/expense-form-v4`
Expected: ผ่านทั้งหมด

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/expense-form-v4
git commit -m "fix(web): expense page a11y — h1 title, checked doc type, heading order, named preview toggle, sticky advanced mode" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: เตือนก่อนออกจากหน้าเมื่อแก้ฟอร์มด้วยการคลิก

วันนี้ `beforeunload` ผูกเมื่อมี event `input`/`change` เท่านั้น — เลือกบัญชีด้วยการคลิก, เปลี่ยน VAT/WHT, สลับประเภท, กด "ยังไม่ชำระเงิน", ใช้แม่แบบ **ไม่ผูก** (ขัด spec §7.3 "เมื่อฟอร์มถูกแก้แล้ว") และพิมพ์ในช่องค้นหาบัญชีกลับผูกทั้งที่ไม่ได้แก้เอกสาร
วิธีใหม่: ผูกเมื่อ `state` ของฟอร์มเปลี่ยน**หลังจากผู้ใช้แตะฟอร์มแล้ว** (การเปลี่ยน state ที่ระบบทำเองตอนเปิดหน้าไม่นับ)

**Files:**
- Modify: `apps/web/src/components/expense-form-v4/ExpenseFormV4.tsx` (บล็อกส่วนของหน้าจอ + container ชั้นนอกสุด)
- Test: `apps/web/src/components/expense-form-v4/__tests__/ExpenseFormV4.page.test.tsx`

- [ ] **Step 1: เขียนเทสต์**

ใน `ExpenseFormV4.page.test.tsx` ต่อท้าย `describe`:

```tsx
  it('เลือกบัญชีด้วยการคลิกอย่างเดียว ก็ผูก beforeunload', async () => {
    const add = vi.spyOn(window, 'addEventListener');
    const user = mount();
    await user.click(screen.getAllByRole('button', { name: 'บัญชีค่าใช้จ่าย' })[0]);
    await waitFor(() => expect(add.mock.calls.some((c) => c[0] === 'beforeunload')).toBe(true));
    add.mockRestore();
  });

  it('บันทึกสำเร็จแล้วถอด beforeunload', async () => {
    const remove = vi.spyOn(window, 'removeEventListener');
    const user = mount();
    await fillExpenseLine(user, { account: '53-1101', unitPrice: '850' });
    await saveDraft(user);
    await bodyOf('/expense-documents');
    await waitFor(() => expect(remove.mock.calls.some((c) => c[0] === 'beforeunload')).toBe(true));
    remove.mockRestore();
  });
```

Run: `npx vitest run src/components/expense-form-v4/__tests__/ExpenseFormV4.page.test.tsx`
Expected: เทสต์ "เลือกบัญชีด้วยการคลิกอย่างเดียว" FAIL (ปุ่มแทนตัวเลือกบัญชีไม่ยิง `input`/`change`) · เทสต์ "บันทึกสำเร็จแล้วถอด" PASS อยู่แล้ว — เป็นตาข่ายของการแก้ในขั้นถัดไป

- [ ] **Step 2: แก้ตัวจับการแก้ฟอร์ม**

ใน `ExpenseFormV4.tsx` บล็อก "ส่วนของหน้าจอ" แทนตั้งแต่ `const [dirty, setDirty] = useState(false);` ถึง effect `if (saveMutation.isSuccess) setDirty(false);` ด้วย:

```tsx
  const [dirty, setDirty] = useState(false);
  // ผู้ใช้แตะฟอร์มแล้วหรือยัง — state ที่ระบบเปลี่ยนเองตอนเปิดหน้า (ติ๊กเจ้าหนี้ให้, flag) ไม่นับเป็นการแก้
  const interacted = useRef(false);
  const markInteracted = () => {
    interacted.current = true;
  };
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  // ลำดับสำคัญ: effect นี้ต้องอยู่ก่อน effect [state] — บันทึกแล้วโหลดร่างกลับมา (state เปลี่ยน) ต้องไม่นับเป็นการแก้
  useEffect(() => {
    if (saveMutation.isSuccess) {
      interacted.current = false;
      setDirty(false);
    }
  }, [saveMutation.isSuccess, saveMutation.submittedAt]);
  useEffect(() => {
    if (interacted.current) setDirty(true);
  }, [state]);
```

ลบ `const markDirty = () => setDirty(true);` (ไม่มีผู้ใช้แล้ว)

แก้ container ชั้นนอกสุดของหน้า:

```tsx
    <div
      className="-mb-[calc(5rem+env(safe-area-inset-bottom,0px))] pt-4 lg:-mb-8"
      onPointerDownCapture={markInteracted}
      onKeyDownCapture={markInteracted}
      onChangeCapture={markInteracted}
    >
```

(เมนูและ popover ที่เปิดผ่าน portal ยังอยู่ใน React tree ของ container นี้ event จึงมาถึง)

- [ ] **Step 3: รันเทสต์**

Run: `npx vitest run src/components/expense-form-v4`
Expected: ผ่านทั้งหมด รวมเทสต์เดิม "ผูก beforeunload หลังผู้ใช้แก้ฟอร์ม" และเทสต์เงินเดือน (`ExpenseFormV4.payroll.test.tsx`)

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/expense-form-v4
git commit -m "fix(web): arm the leave-page warning on any form change made after user input" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: เทสต์ที่ยังขาด

ช่องว่างจาก spec §10.2 และรายงานตรวจรอบ 1 (M-10, ledger Task 7) — เทสต์ในข้อนี้ตรวจพฤติกรรมที่มีอยู่แล้ว จึงผ่านตั้งแต่เขียน (ไม่มีขั้น "ต้องล้ม")

**Files:**
- Modify: `apps/web/src/components/expense-form-v4/__tests__/ExpenseFormV4.round2.test.tsx`
- Modify: `apps/web/src/pages/ExpenseDocumentNewPage.test.tsx`
- Modify: `apps/web/src/pages/ExpensesPage.ux.test.tsx`

- [ ] **Step 1: การ์ดมือถือส่ง body เดียวกับตารางจอใหญ่**

ใน `ExpenseFormV4.round2.test.tsx` เพิ่ม `fillExpenseLine` ใน import ของ driver แล้วต่อท้ายไฟล์:

```tsx
describe('จอมือถือ', () => {
  it('รายการเป็นการ์ด และ body ที่ส่งเหมือนจอใหญ่', async () => {
    mobile.value = true;
    const user = mount();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    await fillExpenseLine(user, { account: '53-1101', unitPrice: '850' });
    await saveDraft(user);
    expect(await bodyOf('/expense-documents')).toEqual({
      documentType: 'EXPENSE', branchId: 'b1', documentDate: today, priceType: 'EXCLUSIVE',
      paymentMethod: 'CASH', depositAccountCode: '11-1101', taxDisallowed: false,
      lines: [{ category: '53-1101', quantity: 1, unitPrice: 850, discount: 0, vatPercent: 7, whtPercent: 0 }],
    });
  });
});
```

Run: `npx vitest run src/components/expense-form-v4/__tests__/ExpenseFormV4.round2.test.tsx`
Expected: ผ่านทั้งหมด · ถ้า body ต่างจากนี้ แปลว่าการ์ดมือถือผูกค่าไม่ตรงกับตาราง — **หยุดแล้วรายงาน** (อย่าแก้ body ในเทสต์)

- [ ] **Step 2: หน้าใหม่ — ใบลดหนี้/จ่ายเจ้าหนี้รับ `?branch=` และปุ่มยกเลิกกลับพร้อมตัวกรอง**

ใน `ExpenseDocumentNewPage.test.tsx`:

(ก) ให้ฟอร์มจำลองมีปุ่มยกเลิก — แก้ mock ของ `ExpenseFormV4`:

```tsx
vi.mock('@/components/expense-form-v4/ExpenseFormV4', () => ({
  ExpenseFormV4: ({ branchId, initialDocType, editDocId, onDraftSaved, onSaved, onClose }: { branchId: string; initialDocType?: string; editDocId?: string; onDraftSaved?: (id: string) => void; onSaved?: () => void; onClose?: () => void }) => {
    const [instance] = useState(() => ++formInstances);
    return (<div>
      <div data-testid="instance">{instance}</div>
      <div data-testid="expense-form">{branchId} / {initialDocType} / {editDocId}</div>
      <button type="button" onClick={() => onDraftSaved?.('new-1')}>บันทึกร่าง + คิดยอด</button>
      <button type="button" onClick={() => onSaved?.()}>บันทึก</button>
      <button type="button" onClick={() => onClose?.()}>ยกเลิก</button>
    </div>);
  },
}));
```

(ข) ต่อท้าย `describe`:

```tsx
  it.each([['CN', 'CREDIT_NOTE'], ['SE', 'VENDOR_SETTLEMENT']])(
    '?type=%s&branch= เปิดฟอร์มประเภทนั้นในสาขาที่ส่งมา',
    async (type, docType) => {
      mocks.user.branchId = 'assigned';
      mocks.get.mockResolvedValue({ data: [{ id: 'assigned', name: 'ก' }, { id: 'branch-x', name: 'ข' }] });
      open(`/expenses/new?type=${type}&branch=branch-x`);
      expect(await screen.findByTestId('expense-form')).toHaveTextContent(`branch-x / ${docType} /`);
    },
  );
  it('ยกเลิกแล้วกลับหน้ารายการพร้อมตัวกรองเดิม', () => {
    mocks.user.branchId = 'assigned'; mocks.get.mockReturnValue(new Promise(() => {}));
    open({ pathname: '/expenses/new', search: '?type=CN', state: { listSearch: '?tab=accrual&branch=b1' } });
    fireEvent.click(screen.getByRole('button', { name: 'ยกเลิก' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/expenses?tab=accrual&branch=b1');
  });
```

Run: `npx vitest run src/pages/ExpenseDocumentNewPage.test.tsx`
Expected: ผ่านทั้งหมด

- [ ] **Step 3: หน้ารายการ — แก้ไขใบเงินเดือนส่งตัวกรองไปด้วย**

ใน `ExpensesPage.ux.test.tsx`:

(ก) ใต้ `function LocationProbe()` เพิ่ม:

```tsx
function StateProbe() { const l = useLocation(); return <output data-testid="state">{JSON.stringify(l.state)}</output>; }
```

(ข) ใน `describe('สร้างเอกสารใหม่', ...)` ต่อท้าย:

```tsx
  it('แก้ไขใบเงินเดือนจากรายการที่กรองอยู่ ส่งตัวกรองไปกับหน้าแก้ไข', async () => {
    const row = { id: 'expense-1', number: 'EX-001', status: 'DRAFT', documentType: 'PAYROLL', vendorName: 'ผู้ขายตัวอย่าง',
      branchId: 'branch-1', branch: { id: 'branch-1', name: 'สาขาตัวอย่าง' },
      documentDate: '2026-10-19', createdAt: '2026-10-19', totalAmount: '1000', netPayment: '1000', expenseDetail: { lines: [] },
    };
    apiGet.mockImplementation((path: string) => Promise.resolve({ data:
      path.startsWith('/expense-documents?') ? { data: [row], total: 1 }
      : path.includes('/summary') ? { totalCount: 1, byStatus: {}, accrualUnpaidCount: 0, accrualUnpaidTotal: '0' } : [],
    }));
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/expenses?branch=branch-1']}><ExpensesPage /><LocationProbe /><StateProbe /></MemoryRouter>
    </QueryClientProvider>);
    await userEvent.click(await screen.findByRole('button', { name: 'เมนู EX-001' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'แก้ไข' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/expenses/new?edit=expense-1');
    expect(screen.getByTestId('state')).toHaveTextContent('"listSearch":"?branch=branch-1"');
  });
```

Run: `npx vitest run src/pages/ExpensesPage.ux.test.tsx`
Expected: ผ่านทั้งหมด

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/expense-form-v4/__tests__/ExpenseFormV4.round2.test.tsx apps/web/src/pages/ExpenseDocumentNewPage.test.tsx apps/web/src/pages/ExpensesPage.ux.test.tsx
git commit -m "test(web): mobile payload parity, CN/SE branch entry, cancel path, payroll edit keeps the list filter" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: ชุดตรวจหน้าจอ, เอกสาร, การตรวจก่อนส่ง

**Files:**
- Modify: `tools/field-scale/routes.mjs` (เพิ่มเส้นทางใบลดหนี้และจ่ายเจ้าหนี้)
- Modify: `docs/superpowers/specs/2026-11-16-expense-create-peak-layout-design.md` (สถานะ + ข้อ 5.3, 5.4)
- Modify (เฉพาะถ้าจำเป็น): `apps/api/e2e/ui-fields/fields.audit-spec.ts`, `apps/api/e2e/ui-fields/dialogs.audit-spec.ts`

- [ ] **Step 1: ตรวจว่าชุดตรวจหน้าจอยังอ้างชื่อที่มีจริง**

ชุดตรวจใช้ชื่อเหล่านี้กับหน้า `/expenses/new` (รอบนี้ไม่ได้เปลี่ยน): ป้าย `ประเภทผู้ขาย`, `เลขใบกำกับ`, `จำนวน`, `ราคา/หน่วย`, `Dr/Cr` · ปุ่ม `เพิ่มบัญชี`, `ลบรายการ`, `เพิ่มแบบ ด้วยตนเอง`, `ลบบัญชีปรับ #1`, `ยังไม่ชำระเงิน (ตั้งหนี้ไว้ก่อน)` · radio `ขั้นสูง`

Run (จาก root ของ repo):

```bash
grep -n "expenses/new" -A20 apps/api/e2e/ui-fields/fields.audit-spec.ts | grep -o "getBy[A-Za-z]*([^)]*)" | sort -u
grep -n "expense-" apps/api/e2e/ui-fields/dialogs.audit-spec.ts
```

เทียบทุกชื่อกับโค้ดปัจจุบัน:

```bash
cd apps/web && grep -rn "เพิ่มบัญชี\|aria-label=\"ลบรายการ\"\|เพิ่มแบบ ด้วยตนเอง\|ลบบัญชีปรับ\|ยังไม่ชำระเงิน (ตั้งหนี้ไว้ก่อน)" src/components/expense-form-v4 --include=*.tsx | grep -v __tests__ | cut -c1-140
```

Expected: ทุกชื่อยังมีในซอร์ส · ถ้าชื่อใดหาย ให้แก้ selector ใน audit spec ให้ตรงชื่อใหม่ (แก้เฉพาะไฟล์ใน `apps/api/e2e/ui-fields/`)
หมายเหตุ: `dialogs.audit-spec.ts` บรรทัดที่ใช้ `getByRole('menuitem', ...)` เป็นของหน้าอื่น (`c.menu`) เคสของรายจ่ายเปิดด้วย `?type=` ไม่ได้กดเมนูประเภท — ไม่ต้องแก้

- [ ] **Step 2: เพิ่มเส้นทางวัดสเกลช่องกรอก**

ใน `tools/field-scale/routes.mjs` ใต้บรรทัด `{ id: 'expense-new', ... }` เพิ่ม:

```js
  // หน้าใบลดหนี้ / จ่ายเจ้าหนี้แบบ PEAK (รอบ 2) — ไม่อยู่ใน appendix ก ของ spec 2026-11-14
  { id: 'credit-note-new', path: '/expenses/new?type=CN', appendix: [], mocks: M.expense },
  { id: 'settlement-new', path: '/expenses/new?type=SE', appendix: [], mocks: M.expense },
```

Run: `node --test tools/field-scale/check.test.mjs`
Expected: ผ่านทั้งหมด (เทสต์ตรวจว่าทุก route มี `mocks` และ `appendix` เป็น array)

- [ ] **Step 3: วัดสเกลช่องกรอกเทียบกับรอบ 1**

ต้องมี local preview รันอยู่ (วิธีเปิดและตัวเลือกอยู่ในคอมเมนต์หัวไฟล์ `tools/field-scale/check.mjs`)

```bash
node tools/field-scale/check.mjs --label peak-r2 --routes expense-new,payroll-new,credit-note-new,settlement-new
node tools/field-scale/check.mjs --compare final-polish peak-r2
```

Expected: `expense-new` และ `payroll-new` ไม่มีข้อ P1/P2 ใหม่เทียบกับ `final-polish` · สองเส้นทางใหม่ไม่มี P1
ข้อที่พบให้แก้ในไฟล์ของ Task 2–5 แล้วรันซ้ำ · ถ้าเครื่องนี้รัน preview ไม่ได้ ให้บันทึกในรายงานว่าขั้นนี้ยังไม่ได้รัน (ห้ามรายงานว่าผ่าน)

- [ ] **Step 4: อัปเดต spec ให้ตรงของจริง**

ใน `docs/superpowers/specs/2026-11-16-expense-create-peak-layout-design.md`:

(ก) บรรทัดสถานะ (บรรทัด 3):

```markdown
สถานะ: รอบที่ 1 อยู่ใน PR #1781 · รอบที่ 2 เขียนโค้ดแล้วบน feat/expense-create-peak-layout-round2
```

(ข) ข้อ 5.3 — แทนประโยค `**แถว "รับเงินคืนเข้า"** (เฉพาะโหมดอ้างอิง): ...` ด้วย:

```markdown
**แถว "รับเงินคืนเข้า"** (โหมดอ้างอิง และเอกสารต้นฉบับที่เลือกเป็น `POSTED` คือจ่ายแล้ว): `CashAccountSelect` ผูกกับ `state.depositAccountCode`
— เอกสารต้นฉบับที่ยังตั้งหนี้ (`ACCRUAL`) server ลดเจ้าหนี้ (`Dr 21-1104`) ไม่ใช้บัญชีเงิน จึงไม่แสดงแถวนี้
```

(ค) ข้อ 5.4 — แทนทั้งย่อหน้าด้วย:

```markdown
ผู้ดูแลเงินสดย่อย — ไม่บังคับ (แถวของตัวเอง) → ตารางรายการสัดส่วนเดียวกับรายจ่าย: แถวบน # / ผู้ขาย / หมวดบัญชี / จำนวน / VAT % / รวม / ลบ ·
แถวล่าง เลขใบกำกับฯ + รายละเอียด · ความกว้าง # 24 · ผู้ขาย 208 · จำนวน 112 · VAT % 80 · รวม 96 · ลบ 44 · หมวดบัญชี = ที่เหลือ (มีแถวรวมท้ายตาราง) →
`SummaryBox` (มูลค่าก่อนภาษี · ภาษีมูลค่าเพิ่ม · ยอดเด่น "จำนวนเงินทั้งสิ้น" — คำเดียวกับรายจ่าย) → ชำระเงิน (เลือกบัญชีอย่างเดียว)
```

(ง) ข้อ 6 กติกา 3 — ต่อท้ายประโยค:

```markdown
 · ล้างแล้วยังอยู่ที่ "ขั้นสูง" จนกว่าผู้ใช้จะกด "พื้นฐาน" เอง
```

(จ) ข้อ 7.3 บรรทัด `beforeunload` — แทนด้วย:

```markdown
- เพิ่ม `beforeunload` เมื่อข้อมูลของฟอร์มเปลี่ยนหลังผู้ใช้แตะฟอร์มแล้ว (พิมพ์ คลิกเลือก สลับประเภท ใช้แม่แบบ) และยังไม่ได้บันทึก (กันรีเฟรช/ปิดแท็บ)
```

- [ ] **Step 5: รันชุดตรวจทั้งหมดของงานนี้**

```bash
cd apps/web
npx vitest run src/components/expense-form-v4 src/pages/ExpenseDocumentNewPage.test.tsx src/pages/ExpensesPage.ux.test.tsx src/pages/other-income/components src/components/layout
npx tsc --noEmit -p .
npx eslint src/components/expense-form-v4 src/pages/ExpenseDocumentNewPage.tsx src/pages/ExpensesPage.tsx
```

Expected: เทสต์ผ่านทั้งหมด · `tsc` exit 0 · ESLint ไม่มี error (warning ของ `eslint-disable` เดิมใน effect ที่ห้ามแตะ 4 จุดเป็นของเดิม)

ตรวจสีและข้อห้าม:

```bash
git diff 28b4f9ab4 HEAD -- apps/web/src | grep "^+" | grep -nE "amber-|gray-[0-9]|text-white|#[0-9a-fA-F]{6}\b" || echo "no forbidden colours"
git diff 28b4f9ab4 HEAD --stat -- apps/api/src | tail -1
```

Expected: `no forbidden colours` · ไม่มีไฟล์ใน `apps/api/src` เปลี่ยน (ถ้า rebase ไป main แล้ว ใช้ `origin/main` แทน `28b4f9ab4`)

- [ ] **Step 6: เปิดดูหน้าจริงใน local preview**

local preview ไม่มี API ผังบัญชี (ตอบ 501) ตัวเลือกบัญชีจะว่าง — ตอนเปิดหน้าด้วยเครื่องมือเบราว์เซอร์ ให้ใส่สคริปต์นี้ก่อนแอปโหลด (init script) เพื่อป้อนผังบัญชีตัวอย่าง:

```js
(() => {
  const groups = [
    { category: 'ค่าใช้จ่ายเกี่ยวกับบุคลากร', accounts: [
      { code: '53-1101', name: 'เงินเดือน ค่าจ้าง' }, { code: '53-1103', name: 'ค่าล่วงเวลา' },
    ] },
    { category: 'วัสดุสิ้นเปลืองและอุปกรณ์สำนักงาน', accounts: [
      { code: '53-1202', name: 'ค่าเครื่องเขียนแบบพิมพ์ (หมึก กระดาษ ซอง เทปใส)' }, { code: '53-1203', name: 'อากรแสตมป์' },
    ] },
  ];
  const cash = [
    { code: '11-1101', name: 'เงินสด - สุทธินีย์ คงเดช' }, { code: '11-1201', name: 'ธนาคาร - กสิกรไทย ออมทรัพย์' },
  ];
  const toData = (o) => 'data:application/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(o));
  const open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    const u = String(url);
    if (u.includes('/chart-of-accounts/grouped')) return open.call(this, 'GET', toData({ groups }), ...rest);
    if (u.includes('/chart-of-accounts/by-codes')) return open.call(this, 'GET', toData(cash), ...rest);
    return open.call(this, method, url, ...rest);
  };
})();
```

ตรวจที่จอ 1280 (เปิดเมนูข้าง) และ 390 ทั้งโหมดสว่างและมืด — บันทึกผลแต่ละข้อ (ผ่าน/ไม่ผ่าน + ตัวเลขที่วัด) ลงรายงาน:

1. จ่ายชำระเจ้าหนี้ (`/expenses/new?type=SE`): มีแถว ข้อมูลผู้รับเงิน / เอกสารตั้งหนี้ที่จะล้าง / สรุปข้อมูล / ชำระเงิน · `document.documentElement.scrollWidth === innerWidth` ที่ 390
2. ใบลดหนี้ (`?type=CN`): แถว อ้างอิงเอกสาร · สลับโหมดได้ · โหมดไม่มีเอกสารต้นทางมีตารางรายการ · ไม่มีกล่องซ้อนกล่อง
3. เงินสดย่อย (เลือกจากเมนูประเภท): ช่องหมวดบัญชีกว้างอย่างน้อย 320px ที่จอ 1280 และข้อความ "เลือกหมวดบัญชี" อยู่บรรทัดเดียว · เลือกบัญชีแล้วเห็น "53-1202 - ค่าเครื่องเขียนแบบพิมพ์" ไม่ถูกตัดกลางรหัส · ตารางไม่มีแถบเลื่อนแนวนอนที่จอ 1280 (`scrollWidth === clientWidth` ของกล่องเลื่อน) · ที่ 390 ตารางเลื่อนแนวนอนในกล่อง หน้าไม่เลื่อน
4. เงินเดือน (`?type=PR`): หน้าตาเท่ารอบ 1 (รอบนี้ไม่ได้แก้) · ไม่มีการเลื่อนแนวนอนของหน้า ที่ 390
5. เมนูประเภท: รายการที่เลือกอยู่มีจุดหน้าชื่อ · กดคีย์บอร์ด Enter/ลูกศรได้
6. โหมดขั้นสูงของรายจ่าย: ไม่มีเลข "5" · เพิ่มรายการปรับปรุงแล้วลบจนหมด แผงยังเปิดอยู่
7. เลือกบัญชีด้วยการคลิกแล้วรีเฟรช: เบราว์เซอร์ถามก่อนออกจากหน้า

- [ ] **Step 7: Commit**

```bash
git add tools/field-scale/routes.mjs docs/superpowers/specs/2026-11-16-expense-create-peak-layout-design.md apps/api/e2e/ui-fields
git commit -m "docs+tools: round 2 spec updates and field-scale routes for credit note and settlement" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## ข้อที่ต่างจาก spec — เจ้าของรับทราบแล้ว (2026-11-16)

เจ้าของเลือก D1 ตามแผน (แถวรับเงินคืนเข้าเฉพาะต้นฉบับที่จ่ายแล้ว) และสั่งเริ่มทำแบบ subagent ต่อเนื่องหลังเห็น D2/D3 ในสรุปแผน

| ข้อ | spec เขียนว่า | แผนนี้ทำ | เหตุผล |
|---|---|---|---|
| D1 | แถว "รับเงินคืนเข้า" แสดง "เฉพาะโหมดอ้างอิง" (§5.3) | แสดงเฉพาะโหมดอ้างอิง **และ** เอกสารต้นฉบับจ่ายแล้ว (`POSTED`) | เอกสารต้นฉบับที่ยังตั้งหนี้ server ลดเจ้าหนี้ ไม่ใช้บัญชีเงิน — ให้เลือกบัญชีที่ไม่มีผลจะทำให้เข้าใจผิด · ถ้าเจ้าของให้แสดงทุกครั้งในโหมดอ้างอิง ตัดเงื่อนไข `selectedDoc?.status === 'POSTED'` ใน Task 4 Step 2 และแก้เทสต์ข้อ 2 ของ Task 4 Step 1 ให้คาดว่ามีแถว |
| D2 | กล่องสรุปของเงินสดย่อยใช้ป้าย "ฐาน · VAT · รวม" (§5.4) | ใช้ "มูลค่าก่อนภาษี · ภาษีมูลค่าเพิ่ม · จำนวนเงินทั้งสิ้น" | คำเดียวกับกล่องสรุปของรายจ่าย ความหมายเดียวกัน · แถวรวมท้ายตารางยังใช้คำว่า "รวม" ตามเดิม |
| D3 | ตารางเงินสดย่อย "ตารางรายการเดิม" (§5.4) | จัดคอลัมน์ใหม่เป็นสองแถวต่อรายการ | ของเดิมช่องหมวดบัญชีกว้าง 93px อ่านไม่ออกหลังแสดง "เลข - ชื่อ" (พบตอนตรวจรอบ 1) |

## ข้อความใหม่บนจอ (ทั้งหมดของรอบนี้)

- ชื่อแถว: `ข้อมูลผู้รับเงิน` (spec §5.2) · `อ้างอิงเอกสาร` (spec §5.3) · `รับเงินคืนเข้า` (spec §5.3) · `ผู้ดูแลเงินสดย่อย` และ `ไม่บังคับ` (แยกจากป้ายเดิม "ผู้ดูแลเงินสดย่อย — ไม่บังคับ") · `รายการที่จะลด` (เดิมเป็นป้ายเล็กเหนือตาราง)
- หัวคอลัมน์เงินสดย่อย: `ผู้ขาย/ผู้รับเงิน / เลขใบกำกับฯ` · `หมวดบัญชี / รายละเอียด` (รวมหัวคอลัมน์เดิมสองคู่) · placeholder `เลขใบกำกับฯ` (เดิม `ทางเลือก`)
- ข้อความที่**หายไป**: บรรทัด "N รายการ · N ผู้ขาย · รวม N ฿" ของเงินสดย่อย (spec §4.2) · เลข "5" หน้าหัวข้อบัญชีปรับผลต่าง · หัวกล่องย่อย "ข้อมูลผู้ขาย — ระบุเอง — ไม่มีเอกสารต้นฉบับ" ของใบลดหนี้โหมดไม่มีเอกสารต้นทาง (ช่องยังอยู่ครบ)
- ชื่อที่ผู้ใช้โปรแกรมอ่านหน้าจอได้ยิน (ไม่เห็นบนจอ): `เลือก <เลขเอกสาร>`, `จำนวนที่จ่ายของ <เลขเอกสาร>`, `หมวดบัญชี`, `เลขใบกำกับฯ`, `รายละเอียด`, `ย่อ/ขยาย ตัวอย่างรายการบัญชี`

## นอกขอบเขตของรอบนี้

- `useIsMobile` (ใช้ร่วมทั้งระบบ) อ่าน `window.innerWidth` — ควรแก้เป็น `mql.matches` ใน PR แยก
- แถบปุ่มติดล่างจออาจบังช่องที่โฟกัสอยู่ (ไม่มี `scroll-padding-bottom`) · ลำดับ Tab ของปุ่มลบในตารางรายจ่าย · ปุ่มลบของรายจ่ายชื่อซ้ำกันทุกแถว
- ตัวเลือกผู้ขายในตาราง (`VendorCombobox`) ยังไม่มีชื่อสำหรับโปรแกรมอ่านหน้าจอ (ต้องแก้ที่ `ContactCombobox` ซึ่งใช้ทั้งระบบ)
- รายการในหัวข้อ 13 ของ spec (ปุ่ม "จ่าย" ในหน้าอายุเจ้าหนี้, ปุ่มบันทึกร่างสองปุ่มของเงินเดือน, ช่องของใบลดหนี้ที่ไม่ได้ส่งไป server)
- งาน dropdown รอบ 2 (`Combobox` กลาง — spec `2026-11-14-dropdown-search-field-scale-design.md` R2-3a)
