# หน้าเพิ่มเอกสารค่าใช้จ่าย — ปิด 2 ข้อที่เหลือจาก PR #1785 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** (1) ใบลดหนี้: สลับประเภทเอกสารไปแล้วกลับมา การ์ดเอกสารต้นฉบับและแถว "รับเงินคืนเข้า" ต้องกลับมาครบ (2) ยืนยันด้วยตาและปักด้วยเทสต์ว่าช่องวันที่ "ประกันศูนย์ถึง" ของเครื่องมือสองมีพื้นเดียวกับช่องข้าง ๆ ทั้งจอสว่างและจอมืด

**Architecture:** (1) `CreditNoteLinesSection` ถูกถอดออกจากหน้าเมื่อเปลี่ยนประเภท แล้วสร้างใหม่ตอนกลับมา ⇒ เอกสารที่เลือก (`pickedDoc` state) หายแต่ `state.originalDocumentId` ยังอยู่ — เพิ่มการโหลดเอกสารนั้นตาม id (`GET /expense-documents/:id` — คืน number / vendorName / totalAmount / status / documentDate / expenseDetail.lines / branch ครบ ใช้สิทธิ์ชุดเดียวกับการสร้างใบลดหนี้) เฉพาะเมื่อไม่มีทั้ง `pickedDoc` และผลค้นหา (2) ไม่ต้องแก้โค้ด — `UsedDeviceDetailsFields` ส่ง `bg-card` ของตัวเอง และ `ThaiDateInput` (หลัง #1785) ไม่ทับพื้นของผู้เรียก ⇒ เพิ่มเทสต์กันถอยหลัง + ดูจอจริง

**Tech Stack:** React 19 + TypeScript + TanStack Query 5 + Vitest + Testing Library · Playwright (ดูจอ)

## Global Constraints

- แก้เฉพาะ `apps/web/src` — ห้ามแก้ `apps/api` ทุกไฟล์ · ห้ามเปลี่ยน payload ที่ส่ง server (body ที่คาดหวังใน `ExpenseFormV4.payloads.test.tsx` ห้ามแก้)
- ไม่มีข้อความใหม่บนจอ · ระหว่างโหลดเอกสารต้นฉบับตาม id ไม่แสดงอะไรในช่องนั้น (ไม่ใช้ข้อความ "กำลังโหลด…" ใหม่) · โหลดไม่สำเร็จ = แสดงช่องค้นหาแบบเดิม
- ห้ามแตะ import และบล็อก `vi.mock` ของช่องเลือกบัญชี (`@/components/accounting/AccountCombobox`) ในไฟล์เทสต์
- คำสั่งเทสต์รันจาก `apps/web`: `npx vitest run <path>` · type check `npx tsc --noEmit` · เครื่อง Windows นี้มีเทสต์ล้มอยู่ก่อน 5 ไฟล์: `src/components/trade-in/TradeInFlow.test.tsx`, `src/pages/PaymentsPage/components/__tests__/RecordPaymentWizard.preview-params.test.ts`, `src/pages/StockPage/ProductsPage.test.tsx`, `src/pages/__tests__/headerNowrap.test.ts`, `src/pages/__tests__/tabsButtonRowsNowrap.test.ts` — ไม่ต้องแก้
- Commit ลงท้ายด้วยบรรทัดว่างแล้ว `Co-Authored-By:` ของโมเดลที่เขียน commit นั้น · ห้าม push / merge / deploy เอง
- local preview ใช้พอร์ต 5197 (`LOCAL_PREVIEW_PORT=5197`) · ห้ามปิด process ตามพอร์ต · ห้ามใช้เบราว์เซอร์ Playwright MCP ที่ session อื่นถืออยู่ — ใช้สคริปต์ Playwright ของตัวเอง

---

### Task 0: เตรียม branch (controller)

- [ ] **Step 1:**

```bash
cd "d:/BESTCHOICE APP/BESTCHOICE"
git checkout main && git pull --ff-only
git checkout -b fix/expense-create-followups-2
git add docs/superpowers/plans/2026-11-17-expense-create-followups-2.md
git commit -m "docs(plan): ปิด 2 ข้อที่เหลือของหน้าเพิ่มเอกสารค่าใช้จ่าย

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 1: ใบลดหนี้ — โหลดเอกสารต้นฉบับตาม id เมื่อส่วนนี้ถูกสร้างใหม่

**ปัญหา:** `ExpenseFormV4.tsx:882` แสดง `CreditNoteLinesSection` เฉพาะประเภท `CREDIT_NOTE` ⇒ เลือก EX-001 → เปลี่ยนเป็นเงินสดย่อย → กลับมาใบลดหนี้: component ถูกสร้างใหม่ `pickedDoc` = null และ `search` = '' (ผลค้นหาปิด) ⇒ `selectedDoc` ไม่มี ⇒ การ์ดหาย ช่องค้นหาโผล่ แถว "รับเงินคืนเข้า" หาย ทั้งที่ `state.originalDocumentId` ยังตั้งอยู่ (แถว "รายการที่จะลด" ยังแสดง และบันทึกยังส่ง id)

**Files:**
- Modify: `apps/web/src/components/expense-form-v4/CreditNoteLinesSection.tsx` (ช่วงประกาศ `pickedDoc` / `selectedDoc` บรรทัด ~55-60 และบล็อกเลือกเอกสาร ~158)
- Test: `apps/web/src/components/expense-form-v4/__tests__/ExpenseFormV4.round2.test.tsx` (เพิ่ม 2 เทสต์ท้าย `describe('ใบลดหนี้ — รับเงินคืนเข้า', …)`)

- [ ] **Step 1: เขียนเทสต์ที่ล้ม**

เพิ่มท้าย `describe('ใบลดหนี้ — รับเงินคืนเข้า', …)` (ใช้ `mount`, `chooseKind`, `pickCreditNoteSource`, `apiGet`, `originalDoc` ที่มีในไฟล์อยู่แล้ว):

```tsx
  it('สลับไปประเภทอื่นแล้วกลับมาใบลดหนี้ — การ์ดเอกสารต้นฉบับและแถว รับเงินคืนเข้า กลับมาครบ', async () => {
    const base = apiGet.getMockImplementation()!;
    apiGet.mockImplementation((path: string) =>
      path === '/expense-documents/orig-1' ? Promise.resolve({ data: originalDoc() }) : base(path),
    );
    const user = mount();
    await chooseKind(user, 'CREDIT_NOTE');
    await pickCreditNoteSource(user, 'EX-0', /EX-001/);
    await screen.findByRole('region', { name: 'รับเงินคืนเข้า' });
    await chooseKind(user, 'PETTY_CASH');
    await chooseKind(user, 'CREDIT_NOTE');
    expect(await screen.findByRole('group', { name: 'เอกสารต้นฉบับที่เลือก EX-001' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'รับเงินคืนเข้า' })).toBeInTheDocument();
    expect(screen.queryByLabelText('ค้นหาเลข EX-... / ผู้ขาย (3 ตัวขึ้นไป)')).not.toBeInTheDocument();
  });

  it('กลับมาใบลดหนี้แล้วโหลดเอกสารต้นฉบับไม่สำเร็จ — แสดงช่องค้นหาให้เลือกใหม่', async () => {
    const base = apiGet.getMockImplementation()!;
    apiGet.mockImplementation((path: string) =>
      path === '/expense-documents/orig-1' ? Promise.reject(new Error('ไม่พบเอกสาร')) : base(path),
    );
    const user = mount();
    await chooseKind(user, 'CREDIT_NOTE');
    await pickCreditNoteSource(user, 'EX-0', /EX-001/);
    await screen.findByRole('region', { name: 'รับเงินคืนเข้า' });
    await chooseKind(user, 'PETTY_CASH');
    await chooseKind(user, 'CREDIT_NOTE');
    expect(await screen.findByLabelText('ค้นหาเลข EX-... / ผู้ขาย (3 ตัวขึ้นไป)')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: /^เอกสารต้นฉบับที่เลือก/ })).not.toBeInTheDocument();
  });
```

- [ ] **Step 2: รันให้เห็นว่าล้ม**

Run: `npx vitest run src/components/expense-form-v4/__tests__/ExpenseFormV4.round2.test.tsx`
Expected: เทสต์แรก FAIL (หา group "เอกสารต้นฉบับที่เลือก EX-001" ไม่เจอหลังกลับมา) · เทสต์ที่สองผ่านอยู่แล้ว (พฤติกรรมเดิมคือแสดงช่องค้นหา — เทสต์นี้ปักว่าทางล้มเหลวต้องคงเดิม) · เทสต์เดิมผ่าน

- [ ] **Step 3: แก้ `CreditNoteLinesSection.tsx`**

แทนบล็อก

```ts
  const selectedDoc =
    pickedDoc && pickedDoc.id === state.originalDocumentId
      ? pickedDoc
      : searchResults?.data.find((d) => d.id === state.originalDocumentId);
```

ด้วย

```ts
  const fromPick = pickedDoc && pickedDoc.id === state.originalDocumentId ? pickedDoc : undefined;
  const fromSearch = searchResults?.data.find((d) => d.id === state.originalDocumentId);
  // ส่วนนี้ถูกสร้างใหม่ (สลับประเภทเอกสารไปแล้วกลับมา) — pickedDoc และคำค้นหาหาย แต่ฟอร์มยังจำ id ไว้
  // ⇒ โหลดเอกสารนั้นตาม id · โหลดไม่สำเร็จ = แสดงช่องค้นหาให้เลือกใหม่ตามเดิม
  const needsOriginalLoad = !isStandalone && !!state.originalDocumentId && !fromPick && !fromSearch;
  const originalQuery = useQuery<OriginalDoc>({
    queryKey: ['cn-original', state.originalDocumentId],
    queryFn: async () => (await api.get(`/expense-documents/${state.originalDocumentId}`)).data,
    enabled: needsOriginalLoad,
    retry: false,
  });
  const fromLoad =
    needsOriginalLoad && originalQuery.data?.id === state.originalDocumentId ? originalQuery.data : undefined;
  const selectedDoc = fromPick ?? fromSearch ?? fromLoad;
  const loadingOriginal = needsOriginalLoad && originalQuery.isPending && !originalQuery.isError;
```

`isStandalone` ต้องประกาศก่อนบล็อกนี้ (มีอยู่แล้วที่ต้น component — ถ้าอยู่หลัง ให้ย้ายบล็อกนี้ไปไว้หลัง `isStandalone`)

แล้วในส่วน "เอกสารต้นฉบับ" แทนเงื่อนไขเปิด

```tsx
              {state.originalDocumentId && selectedDoc ? (
```

ด้วย

```tsx
              {loadingOriginal ? null : state.originalDocumentId && selectedDoc ? (
```

(ระหว่างโหลดไม่แสดงอะไรในช่อง — ไม่มีข้อความใหม่ · ส่วนที่เหลือของ JSX คงเดิม)

- [ ] **Step 4: รันให้ผ่าน**

Run: `npx vitest run src/components/expense-form-v4`
Expected: PASS ทั้งโฟลเดอร์ (รวม payloads — body ใบลดหนี้เท่าเดิม)

Run: `npx tsc --noEmit`
Expected: exit 0

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/expense-form-v4/CreditNoteLinesSection.tsx \
  apps/web/src/components/expense-form-v4/__tests__/ExpenseFormV4.round2.test.tsx
git commit -m "fix(web): ใบลดหนี้โหลดเอกสารต้นฉบับตาม id เมื่อสลับประเภทแล้วกลับมา

Co-Authored-By: <model ที่เขียน commit> <noreply@anthropic.com>"
```

---

### Task 2: เทสต์กันถอยหลัง — ช่องวันที่ "ประกันศูนย์ถึง" พื้นเดียวกับช่องแบตเตอรี่

**ที่มา:** final review ของ #1785 (Important 1) พบว่ารุ่นกลางของ `ThaiDateInput` (commit `060c5bf2e`) ทับพื้น `bg-card` ของ `UsedDeviceDetailsFields` ด้วย `[[readonly]]:bg-background` (selector `[readonly]` แรงกว่า) — แก้แล้วก่อน merge (`411ff0c32`) แต่ field-scale วัดไม่ถึงจอนี้ ⇒ ปักด้วยเทสต์

**Files:**
- Create: `apps/web/src/components/product/__tests__/UsedDeviceDetailsFields.test.tsx`

- [ ] **Step 1: เขียนเทสต์**

```tsx
// apps/web/src/components/product/__tests__/UsedDeviceDetailsFields.test.tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import UsedDeviceDetailsFields from '../UsedDeviceDetailsFields';

const value = { batteryHealth: '89', warrantyExpired: false, warrantyExpireDate: '2027-01-31', hasBox: true };

const backgroundClasses = (el: HTMLElement) => [...el.classList].filter((c) => /(^|:)bg-/.test(c));

describe('UsedDeviceDetailsFields — ช่องวันที่ประกันศูนย์', () => {
  it('ช่องวันที่ใช้พื้นเดียวกับช่องแบตเตอรี่ (bg-card) — ThaiDateInput ไม่ทับพื้นของผู้เรียก', () => {
    render(<UsedDeviceDetailsFields value={value} onChange={vi.fn()} idPrefix="t" />);
    const battery = screen.getByLabelText(/% แบตเตอรี่/);
    const date = screen.getByLabelText('ประกันศูนย์ถึง');
    expect(date).toHaveAttribute('readonly');
    expect(backgroundClasses(battery)).toEqual(['bg-card']);
    expect(backgroundClasses(date)).toEqual(['bg-card']);
  });
});
```

- [ ] **Step 2: รันให้ผ่าน (ต้องผ่านทันที — พฤติกรรมถูกอยู่แล้ว)**

Run: `npx vitest run src/components/product/__tests__/UsedDeviceDetailsFields.test.tsx`
Expected: PASS

- [ ] **Step 3: พิสูจน์ว่าเทสต์จับรุ่นที่ผิดได้ แล้วคืนไฟล์**

```bash
cd "d:/BESTCHOICE APP/BESTCHOICE"
git show 060c5bf2e:apps/web/src/components/ui/ThaiDateInput.tsx > apps/web/src/components/ui/ThaiDateInput.tsx
(cd apps/web && npx vitest run src/components/product/__tests__/UsedDeviceDetailsFields.test.tsx)   # Expected: FAIL — date มี [[readonly]]:bg-background
git checkout -- apps/web/src/components/ui/ThaiDateInput.tsx
git status --short    # Expected: เหลือเฉพาะไฟล์เทสต์ใหม่ (untracked)
(cd apps/web && npx vitest run src/components/product/__tests__/UsedDeviceDetailsFields.test.tsx)   # Expected: PASS
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/product/__tests__/UsedDeviceDetailsFields.test.tsx
git commit -m "test(web): ช่องวันที่ประกันศูนย์ของเครื่องมือสองพื้นเดียวกับช่องข้าง ๆ

Co-Authored-By: <model ที่เขียน commit> <noreply@anthropic.com>"
```

---

### Task 3: ตรวจทั้ง branch + ดูจอจริง (controller)

- [ ] **Step 1: เทสต์ทั้งเว็บ + type**

```bash
cd "d:/BESTCHOICE APP/BESTCHOICE/apps/web"
npx vitest run
npx tsc --noEmit
```

Expected: vitest ล้มเฉพาะ 5 ไฟล์ที่รู้อยู่แล้ว · tsc exit 0

- [ ] **Step 2: ดูจอจริงบน preview (จอสว่าง + จอมืด, 1440 + 390)**

```bash
cd "d:/BESTCHOICE APP/BESTCHOICE"
LOCAL_PREVIEW_PORT=5197 npm run local:preview
```

สคริปต์ Playwright ของ controller (scratchpad, `require('@playwright/test')` ผ่าน `createRequire` ที่ `package.json` ของ repo · ตั้งธีมด้วย `localStorage.setItem('theme', 'light'|'dark')` ใน `addInitScript` · บล็อกทุกคำขอที่ไม่ใช่ GET ใต้ `/api/**`):
1. **เครื่องมือสอง:** หา id ด้วย `GET http://127.0.0.1:5197/api/admin/products?category=PHONE_USED&limit=1` → เปิด `/products/<id>` → กดปุ่ม "แก้ไขข้อมูล" → ถ่ายภาพหน้าต่าง "แก้ไขข้อมูลสินค้า" ส่วน "ข้อมูลมือสอง" · อ่าน `getComputedStyle(...).backgroundColor` ของช่อง "% แบตเตอรี่" และช่อง "ประกันศูนย์ถึง" ต้องเท่ากันทั้งสองธีม · ไม่มีเครื่องมือสองใน preview = บันทึกไว้ใน ledger ว่าดูจอไม่ได้ (เทสต์ Task 2 ปักไว้แทน)
2. **ใบลดหนี้:** เปิด `/expenses/new?type=CN` ที่ 1440 + 390 ถ่ายภาพหลังโหลด (ไม่มีเลื่อนแนวนอนทั้งหน้า — `document.documentElement.scrollWidth - innerWidth === 0`)

ภาพเก็บ `.tmp/followups2-shots/`

- [ ] **Step 3: final whole-branch review** ตาม superpowers:subagent-driven-development (`git merge-base main HEAD`..HEAD)

- [ ] **Step 4: รายงานเจ้าของ แล้วรอคำสั่ง** — ห้าม push / merge / deploy เอง
