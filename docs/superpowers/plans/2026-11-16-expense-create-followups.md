# หน้าเพิ่มเอกสารค่าใช้จ่าย — แก้จุดค้าง 5 ข้อหลังรอบ PEAK Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ปิดจุดค้าง 5 ข้อของหน้า "ค่าใช้จ่ายดำเนินงาน › เพิ่มเอกสารใหม่" (`/expenses/new`) ที่ final review รอบ 1/2 ของงาน PEAK (merge แล้วเป็น `809471ba0`) จดไว้: คำเตือนออกจากหน้าที่ขึ้นผิดจังหวะ · ลำดับ Tab ของปุ่มลบรายการ · ใบลดหนี้ผูกเอกสารต้นทางกับผลค้นหาและโฟกัสหลุด · `useIsMobile` อ่านความกว้างผิดตัว · ช่องวันที่อ่านอย่างเดียวพื้นเทาโปร่ง

**Architecture:** แก้ที่ต้นเหตุทีละจุด ไม่แตะ payload / API / การคำนวณ — (1) hook จอแคบกลางอ่าน `mql.matches` และอ่านค่าแรกตอนสร้าง state (2) `ThaiDateInput` ทับสไตล์ `[[readonly]]` ของ `inputVariants` เพราะ readOnly มีไว้กันพิมพ์เท่านั้น (3) ย้ายตรรกะคำเตือนออกจากหน้าไปไว้ใน hook `useLeaveGuard` ที่แยก "ระบบเปลี่ยนเอง" (`asSystem`) กับ "ฟอร์มตรงกับที่บันทึก/เปล่าแล้ว" (`markPristine`) ออกจากการแก้ของผู้ใช้ (4) ใบลดหนี้เก็บเอกสารที่เลือกไว้ใน state ของตัวเอง และย้ายโฟกัสไปที่สิ่งที่เพิ่งขึ้นมา (5) ย้ายเซลล์ปุ่มลบลงแถวล่างของแต่ละบรรทัด (คำตัดสินเจ้าของ 2026-11-16)

**Tech Stack:** React 19 + TypeScript + Vite + Tailwind 4 (tailwind-merge 3) + shadcn/Radix + TanStack Query 5 + Vitest + Testing Library

## Global Constraints

- งานนี้แก้เฉพาะ `apps/web/src` — ห้ามแก้ `apps/api` ทุกไฟล์
- ห้ามเปลี่ยน payload ที่ส่ง server: ห้ามแก้ `mutationFn` ของ `saveMutation`, `initial()`, `itemCount`, `ready` ใน `ExpenseFormV4.tsx` · ห้ามแก้ body ที่คาดหวังใน `ExpenseFormV4.payloads.test.tsx` (ถ้าต้องแก้ แปลว่า logic เปลี่ยน — หยุดแล้วรายงาน)
- ไม่มีข้อความใหม่ที่ตามองเห็น · ข้อความใหม่สำหรับโปรแกรมอ่านหน้าจอมีอันเดียว: `aria-label` ของการ์ดเอกสารต้นฉบับ = `` `เอกสารต้นฉบับที่เลือก ${number}` `` (Task 4)
- สี: token เท่านั้น ห้าม hex / `gray-*` / `text-white` · รวม class ด้วย `cn()` เสมอ · ข้อความไทยใช้ `leading-snug`
- คำตัดสินเจ้าของ 2026-11-16: ปุ่มลบในตารางรายการ (รายจ่าย + เงินสดย่อย) **ย้ายลงแถวล่าง** (ระดับเดียวกับช่องคำอธิบาย) เพื่อให้ Tab ไล่ตามที่ตาเห็น — การ์ดจอแคบไม่เปลี่ยน
- เริ่มจาก main `a14ce969d` (รวม #1784 แล้ว — ช่องเลือกบัญชีเป็น `AccountCombobox` · ไฟล์เทสต์ของ `expense-form-v4` mock `@/components/accounting/AccountCombobox` อยู่แล้ว) · เทสต์ใหม่ใช้ mock ที่ไฟล์มีอยู่ ห้ามเพิ่ม mock ของช่องเลือกบัญชีชุดใหม่ · **ห้ามแตะ import และบล็อก `vi.mock` ของช่องเลือกบัญชี**
- คำสั่งเทสต์ทุกตัวรันจาก `apps/web`: `npx vitest run <path>` · type check: `npx tsc --noEmit` (จาก `apps/web`) · เครื่อง Windows นี้มีเทสต์ล้มอยู่ก่อนที่ไม่เกี่ยว 5 ไฟล์: `src/components/trade-in/TradeInFlow.test.tsx`, `src/pages/PaymentsPage/components/__tests__/RecordPaymentWizard.preview-params.test.ts`, `src/pages/StockPage/ProductsPage.test.tsx`, `src/pages/__tests__/headerNowrap.test.ts`, `src/pages/__tests__/tabsButtonRowsNowrap.test.ts` — ไม่ต้องแก้
- Commit ลงท้ายด้วยบรรทัดว่างแล้ว `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` · ห้าม push / merge / deploy เอง

## ที่มาของแต่ละข้อ (อ่านประกอบ)

| ข้อ | ที่มา | Task |
|---|---|---|
| `useIsMobile` อ่าน `innerWidth` | final review รอบ 1 M-9 · แผนรอบ 2 "นอกขอบเขต" | 1 |
| ช่องวันที่อ่านอย่างเดียวพื้นโปร่ง | field-scale P2 F1 ×4 (แถวเลขผู้เสียภาษี/วันที่ใบกำกับ) · ต้นเหตุ `[[readonly]]:bg-muted/80 [[readonly]]:cursor-not-allowed` ใน `components/ui/input.tsx:11` | 2 |
| คำเตือนออกจากหน้าขึ้นผิดจังหวะ | final review รอบ 2 M-7 (เริ่มเปล่า · กดก่อนรายการตั้งหนี้โหลด · โหลดใบเงินเดือนกลับหลังส่งไม่ผ่าน) | 3 |
| ใบลดหนี้ผูกกับผลค้นหา + โฟกัสหลุด | final review รอบ 2 M-4 + M-13 | 4 |
| ลำดับ Tab ของปุ่มลบ | final review รอบ 1 M-5 · รอบ 2 M-12 | 5 |

## File Structure

| ไฟล์ | หน้าที่ | Task |
|---|---|---|
| `apps/web/src/hooks/useIsMobile.ts` (แก้) | จอแคบกว่า 1024px จาก media query | 1 |
| `apps/web/src/hooks/useIsMobile.test.ts` (เขียนใหม่ทั้งไฟล์) | เทสต์ของ hook | 1 |
| `apps/web/src/components/ui/ThaiDateInput.tsx` (แก้) | ช่องวันที่ — ไม่ใช้หน้าตา readonly | 2 |
| `apps/web/src/components/ui/ThaiDateInput.test.tsx` (เพิ่มเทสต์) | | 2 |
| `apps/web/src/components/expense-form-v4/useLeaveGuard.ts` (ใหม่) | คำเตือนก่อนปิดแท็บ — ทุกกติกาอยู่ที่นี่ | 3 |
| `apps/web/src/components/expense-form-v4/__tests__/useLeaveGuard.test.tsx` (ใหม่) | | 3 |
| `apps/web/src/components/expense-form-v4/ExpenseFormV4.tsx` (แก้) | ใช้ `useLeaveGuard` แทนตรรกะเดิม | 3 |
| `apps/web/src/components/expense-form-v4/SettlementLinesSection.tsx` (แก้) | prop `onAutoChange` สำหรับการติ๊กของระบบ | 3 |
| `apps/web/src/components/expense-form-v4/__tests__/ExpenseFormV4.page.test.tsx` (เพิ่มเทสต์) | | 3 |
| `apps/web/src/components/expense-form-v4/__tests__/ExpenseFormV4.payroll.test.tsx` (เพิ่มเทสต์) | | 3 |
| `apps/web/src/components/expense-form-v4/CreditNoteLinesSection.tsx` (แก้) | เก็บเอกสารที่เลือก + ย้ายโฟกัส | 4 |
| `apps/web/src/components/expense-form-v4/__tests__/ExpenseFormV4.round2.test.tsx` (เพิ่มเทสต์) | | 4 |
| `apps/web/src/components/expense-form-v4/ItemLinesSection.tsx` (แก้) | ปุ่มลบแถวล่าง (ตารางจอกว้าง) | 5 |
| `apps/web/src/components/expense-form-v4/PettyCashLinesSection.tsx` (แก้) | ปุ่มลบแถวล่าง (ตารางจอกว้าง) | 5 |
| `apps/web/src/components/expense-form-v4/__tests__/ItemLinesSection.layout.test.tsx` (เพิ่มเทสต์) | | 5 |
| `apps/web/src/components/expense-form-v4/__tests__/PettyCashLinesSection.test.tsx` (เพิ่มเทสต์) | | 5 |

---

### Task 0: เตรียม branch + ภาพก่อนแก้ (controller ทำเอง ไม่ส่ง subagent)

- [ ] **Step 1: สร้าง branch จาก main**

```bash
cd "d:/BESTCHOICE APP/BESTCHOICE"
git status -sb            # ต้องสะอาดและอยู่ที่ main...origin/main
git checkout -b fix/expense-create-followups
git log --oneline -1      # a14ce969d (หรือ main ล่าสุด)
```

- [ ] **Step 2: วัด field-scale ก่อนแก้ (baseline)**

พอร์ต 5195 / 5196 เป็นของ session อื่น — ใช้ 5197 · ห้ามปิด process ตามพอร์ต

```bash
cd "d:/BESTCHOICE APP/BESTCHOICE"
LOCAL_PREVIEW_PORT=5197 npm run local:preview
node tools/field-scale/check.mjs --label followups-base --routes expense-new,payroll-new
```

Expected: exit 0 · `.tmp/field-scale/followups-base/report.md` มี P2 F1 `background` ของแถว "เลขประจำตัวผู้เสียภาษี" / "วันที่ใบกำกับ" (ตัวที่ Task 2 จะแก้)

- [ ] **Step 3: บันทึก baseline ลง ledger**

เพิ่มบรรทัดใน `.superpowers/sdd/progress.md`:

```
== Follow-ups (plan 2026-11-16-expense-create-followups) — branch fix/expense-create-followups from <sha> · field-scale baseline followups-base ==
```

---

### Task 1: `useIsMobile` อ่าน `mql.matches` และอ่านค่าแรกตอนสร้าง state

**ปัญหา:** hook ตอนนี้เริ่มที่ `undefined` (คืน `false`) แล้วอ่าน `window.innerWidth` ⇒ มือถือวาดตารางจอใหญ่ก่อนหนึ่งเฟรม และของที่ล้นจอทำให้ layout viewport ของมือถือกว้างขึ้น (`innerWidth` กว้างกว่าจอจริง) จนค้างที่ตารางจอใหญ่ · hook นี้ใช้ทั้งระบบ (19 ไฟล์)

**Files:**
- Modify: `apps/web/src/hooks/useIsMobile.ts` (ทั้งไฟล์ 20 บรรทัด)
- Test: `apps/web/src/hooks/useIsMobile.test.ts` (เขียนใหม่ทั้งไฟล์)

**Interfaces:**
- Produces: `useIsMobile(): boolean` — ลายเซ็นเดิม ผู้เรียกไม่ต้องแก้

- [ ] **Step 1: เขียนเทสต์ใหม่ทั้งไฟล์**

แทนเนื้อหาทั้งหมดของ `apps/web/src/hooks/useIsMobile.test.ts` ด้วย:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useIsMobile } from './useIsMobile';

// jsdom ไม่มี media query — mock ที่กำหนดผล `matches` เองและยิง change ได้
// innerWidth ตั้งแยกจาก matches โดยตั้งใจ: hook ต้องเชื่อ media query ไม่ใช่ innerWidth
function installMatchMediaMock({ matches, innerWidth = 1280 }: { matches: boolean; innerWidth?: number }) {
  const listeners: Array<() => void> = [];
  const mql = {
    matches,
    media: '',
    onchange: null,
    addEventListener: (_evt: string, cb: () => void) => {
      listeners.push(cb);
    },
    removeEventListener: (_evt: string, cb: () => void) => {
      const i = listeners.indexOf(cb);
      if (i >= 0) listeners.splice(i, 1);
    },
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => true,
  };
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: innerWidth });
  const matchMedia = vi.fn().mockReturnValue(mql);
  Object.defineProperty(window, 'matchMedia', { configurable: true, writable: true, value: matchMedia });
  return {
    matchMedia,
    listenerCount: () => listeners.length,
    fireChange: (next: boolean) => {
      mql.matches = next;
      listeners.forEach((l) => l());
    },
  };
}

describe('useIsMobile', () => {
  let originalMatchMedia: typeof window.matchMedia;
  let originalInnerWidth: number;

  beforeEach(() => {
    originalMatchMedia = window.matchMedia;
    originalInnerWidth = window.innerWidth;
  });

  afterEach(() => {
    Object.defineProperty(window, 'matchMedia', { configurable: true, writable: true, value: originalMatchMedia });
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: originalInnerWidth });
  });

  it('ถามด้วย media query (max-width: 1023px) — 1024 ขึ้นไปเป็นจอใหญ่', () => {
    const { matchMedia } = installMatchMediaMock({ matches: false });
    renderHook(() => useIsMobile());
    expect(matchMedia).toHaveBeenCalledWith('(max-width: 1023px)');
  });

  it('จอแคบ: ค่าใน render แรกเป็น true เลย ไม่วาดแบบจอใหญ่ก่อนหนึ่งเฟรม', () => {
    installMatchMediaMock({ matches: true, innerWidth: 390 });
    const seen: boolean[] = [];
    renderHook(() => {
      const value = useIsMobile();
      seen.push(value);
      return value;
    });
    expect(seen[0]).toBe(true);
  });

  it('เชื่อ media query ไม่ใช่ innerWidth — ของที่ล้นจอทำให้ innerWidth ของมือถือกว้างเกินจอจริง', () => {
    installMatchMediaMock({ matches: true, innerWidth: 1280 });
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(true);
  });

  it('จอใหญ่คืน false', () => {
    installMatchMediaMock({ matches: false, innerWidth: 1280 });
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);
  });

  it('เปลี่ยนตาม change ของ media query ทั้งสองทาง', () => {
    const { fireChange } = installMatchMediaMock({ matches: false });
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);
    act(() => fireChange(true));
    expect(result.current).toBe(true);
    act(() => fireChange(false));
    expect(result.current).toBe(false);
  });

  it('ถอด listener ตอน unmount', () => {
    const { listenerCount } = installMatchMediaMock({ matches: false });
    const { unmount } = renderHook(() => useIsMobile());
    expect(listenerCount()).toBe(1);
    unmount();
    expect(listenerCount()).toBe(0);
  });
});
```

- [ ] **Step 2: รันให้เห็นว่าล้ม**

Run: `npx vitest run src/hooks/useIsMobile.test.ts`
Expected: FAIL 3 ตัว — "ค่าใน render แรกเป็น true เลย" (ได้ false), "เชื่อ media query ไม่ใช่ innerWidth" (ได้ false), "เปลี่ยนตาม change" (ได้ false หลัง fireChange(true))

- [ ] **Step 3: แก้ hook**

แทนเนื้อหาทั้งหมดของ `apps/web/src/hooks/useIsMobile.ts` ด้วย:

```ts
import { useState, useEffect } from 'react';

const MOBILE_BREAKPOINT = 1024;
const MOBILE_QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`;

/**
 * จอแคบกว่า 1024px — ตัดสินด้วย media query เท่านั้น ไม่อ่าน `window.innerWidth`:
 * ของที่ล้นจอขยาย layout viewport ของมือถือ ทำให้ innerWidth กว้างกว่าจอจริง แล้วหน้าค้างที่ตารางจอใหญ่
 * ค่าแรกอ่านตอนสร้าง state — จอแคบไม่ต้องวาดแบบจอใหญ่ก่อนหนึ่งเฟรม
 */
export function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => window.matchMedia(MOBILE_QUERY).matches);

  useEffect(() => {
    const mql = window.matchMedia(MOBILE_QUERY);
    const onChange = () => setIsMobile(mql.matches);
    mql.addEventListener('change', onChange);
    // ค่าอาจเปลี่ยนระหว่าง render แรกกับตอนผูก listener
    onChange();
    return () => mql.removeEventListener('change', onChange);
  }, []);

  return isMobile;
}
```

- [ ] **Step 4: รันเทสต์ของ hook ให้ผ่าน**

Run: `npx vitest run src/hooks/useIsMobile.test.ts`
Expected: PASS 6/6

- [ ] **Step 5: รันเทสต์ที่ใช้ hook จริง (ไม่ mock) — ต้องไม่มีอะไรเปลี่ยน**

`src/test/setup.ts` ตอบ `matches: false` ทุก query ⇒ เท่ากับ jsdom `innerWidth` 1024 เดิม (จอใหญ่) · เทสต์อื่นที่แทน `matchMedia` มีตัวเดียว (`components/ui/combobox.test.tsx` ตอบ true เฉพาะ `(pointer: coarse)`)

Run: `npx vitest run src/components/ui/combobox.test.tsx src/components/expense-form-v4 src/pages/ExpenseDocumentNewPage.test.tsx`
Expected: PASS ทั้งหมด

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/hooks/useIsMobile.ts apps/web/src/hooks/useIsMobile.test.ts
git commit -m "fix(web): useIsMobile อ่าน mql.matches และค่าแรกตอนสร้าง state (ไม่อ่าน innerWidth)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: ช่องวันที่ (`ThaiDateInput`) ไม่ใช้หน้าตาช่อง readonly

**ปัญหา:** `<input readOnly>` ใน `ThaiDateInput` มีไว้กันพิมพ์ (เลือกวันจากปฏิทินเท่านั้น) แต่ผู้เรียกที่ส่ง `className={formControlClass}` ได้ `[[readonly]]:bg-muted/80 [[readonly]]:cursor-not-allowed` จาก `inputVariants` (`components/ui/input.tsx:11`) ⇒ พื้นเทาโปร่งข้างช่องพื้นทึบ (field-scale P2 F1) และเคอร์เซอร์ "ห้ามกด" บนช่องที่กดได้ · `disabled` ยังแสดงแบบปิดใช้งานตามเดิม (ไม่แตะ)

ตรวจแล้ว: `twMerge('… [[readonly]]:bg-muted/80 [[readonly]]:cursor-not-allowed …', '[[readonly]]:bg-background [[readonly]]:cursor-pointer')` เหลือเฉพาะตัวหลัง

**Files:**
- Modify: `apps/web/src/components/ui/ThaiDateInput.tsx:204-207`
- Test: `apps/web/src/components/ui/ThaiDateInput.test.tsx` (เพิ่ม describe ท้ายไฟล์)

- [ ] **Step 1: เขียนเทสต์ที่ล้ม**

เพิ่ม import บรรทัดบนสุดของไฟล์ (ต่อจาก `import ThaiDateInput from './ThaiDateInput';`):

```ts
import { formControlClass } from './form-styles';
```

เพิ่ม describe ท้ายไฟล์:

```ts
describe('ThaiDateInput — หน้าตาเท่าช่องกรอกอื่น', () => {
  it('รับ formControlClass แล้วไม่ได้พื้นเทาโปร่งและเคอร์เซอร์ห้ามกดของช่อง readonly (readOnly มีไว้กันพิมพ์ ช่องยังกดเลือกวันได้)', () => {
    render(
      <ThaiDateInput value="2026-09-13" onChange={vi.fn()} aria-label="วันที่ใบกำกับ" className={formControlClass} />,
    );
    const input = screen.getByLabelText('วันที่ใบกำกับ');
    expect(input).toHaveAttribute('readonly');
    expect(input).not.toHaveClass('[[readonly]]:bg-muted/80');
    expect(input).not.toHaveClass('[[readonly]]:cursor-not-allowed');
    expect(input).toHaveClass('[[readonly]]:bg-background', '[[readonly]]:cursor-pointer');
  });

  it('disabled ยังเป็นช่องปิดใช้งาน', () => {
    render(
      <ThaiDateInput value="2026-09-13" onChange={vi.fn()} aria-label="วันที่ใบกำกับ" className={formControlClass} disabled />,
    );
    expect(screen.getByLabelText('วันที่ใบกำกับ')).toBeDisabled();
  });
});
```

- [ ] **Step 2: รันให้เห็นว่าล้ม**

Run: `npx vitest run src/components/ui/ThaiDateInput.test.tsx`
Expected: FAIL ที่ `not.toHaveClass('[[readonly]]:bg-muted/80')` (ตัว disabled ผ่านอยู่แล้ว)

- [ ] **Step 3: แก้ className ของ input**

ใน `ThaiDateInput.tsx` แทน

```tsx
            className={cn(
              'w-full px-3 py-2 pr-9 border border-input rounded-lg text-sm bg-background cursor-pointer focus:outline-hidden focus:ring-2 focus:ring-ring/30',
              className,
            )}
```

ด้วย

```tsx
            className={cn(
              'w-full px-3 py-2 pr-9 border border-input rounded-lg text-sm bg-background cursor-pointer focus:outline-hidden focus:ring-2 focus:ring-ring/30',
              className,
              // readOnly มีไว้กันพิมพ์เท่านั้น — ช่องนี้กดเลือกวันได้ จึงทับพื้นเทา/เคอร์เซอร์ห้ามกดของช่อง readonly ใน inputVariants
              '[[readonly]]:bg-background [[readonly]]:cursor-pointer',
            )}
```

- [ ] **Step 4: รันให้ผ่าน**

Run: `npx vitest run src/components/ui/ThaiDateInput.test.tsx`
Expected: PASS ทั้งไฟล์

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/ui/ThaiDateInput.tsx apps/web/src/components/ui/ThaiDateInput.test.tsx
git commit -m "fix(web): ช่องวันที่ไม่ใช้พื้นเทาโปร่ง/เคอร์เซอร์ห้ามกดของช่อง readonly

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: คำเตือนออกจากหน้า — แยกการเปลี่ยนของระบบและฟอร์มที่บันทึกแล้วออกจากการแก้ของผู้ใช้

**ปัญหา (final review รอบ 2 M-7):** ตรรกะเดิม (`ExpenseFormV4.tsx:634-658`) = "ผู้ใช้แตะฟอร์มเมื่อไหร่ก็ตาม แล้ว state เปลี่ยน ⇒ เตือน" ⇒ เตือนผิดจังหวะ 3 กรณี:
1. กด **"เริ่มเปล่า"** — ฟอร์มถูกล้างเป็นฟอร์มเปล่า (ไม่มีอะไรให้เสีย) แต่ถูกนับเป็นการแก้
2. **จ่ายชำระเจ้าหนี้: กดแป้น/คลิกก่อนรายการตั้งหนี้โหลด** — ระบบติ๊กใบให้ทีหลัง (`SettlementLinesSection.tsx:130-158`) ถูกนับเป็นการแก้
3. **ใบเงินเดือน: บันทึกแล้วแต่ส่งขออนุมัติ/ลงบัญชีไม่ผ่าน** (`PayrollSavedError`) — โหลดใบที่บันทึกแล้วกลับมาแต่คำเตือนยังค้าง

**วิธี:** hook `useLeaveGuard(state)` ไฟล์เดียว:
- `captureProps` — ผูกที่กรอบฟอร์ม (กด/พิมพ์/เปลี่ยนค่า = ผู้ใช้แตะแล้ว) แบบเดิม
- `asSystem(change)` — state ที่ `change` เปลี่ยนเป็นของระบบ ไม่นับ (ติ๊กใบเจ้าหนี้ · ปรับยอดเมื่อปิดจ่ายบางส่วน · ปิดเงินสดย่อยตามค่าตั้ง)
- `markPristine()` — ฟอร์มตรงกับของที่บันทึก/ฟอร์มเปล่าแล้ว: ปลดคำเตือน และการแตะก่อนหน้าไม่นับอีก (กดเริ่มเปล่า · บันทึกสำเร็จ · โหลดใบเงินเดือนที่บันทึกแล้วกลับมา) — แทน effect `saveMutation.isSuccess` เดิมที่พึ่งลำดับการประกาศ effect

**ข้อจำกัดที่รู้ (เขียนไว้ใน docblock):** ถ้าการเปลี่ยนของระบบกับของผู้ใช้ลงใน commit เดียวกัน รอบนั้นไม่ถูกนับ — ในทางปฏิบัติไม่เกิดผลผิด เพราะการกด/พิมพ์ของผู้ใช้ตั้ง "แตะแล้ว" ไว้ และการเปลี่ยนรอบถัดไปจะถูกนับ · การพิมพ์ระหว่างกำลังบันทึกไม่ถูกเตือน (มีมาก่อน — บันทึกสำเร็จแล้วหน้าปิดหรือโหลดใบกลับทับอยู่ดี)

**Files:**
- Create: `apps/web/src/components/expense-form-v4/useLeaveGuard.ts`
- Create: `apps/web/src/components/expense-form-v4/__tests__/useLeaveGuard.test.tsx`
- Modify: `apps/web/src/components/expense-form-v4/ExpenseFormV4.tsx` (8 จุด — Step 6)
- Modify: `apps/web/src/components/expense-form-v4/SettlementLinesSection.tsx:33-37, 87, 153, 177`
- Test: `apps/web/src/components/expense-form-v4/__tests__/ExpenseFormV4.page.test.tsx` (เพิ่ม 3 เทสต์ใน describe เดิม)
- Test: `apps/web/src/components/expense-form-v4/__tests__/ExpenseFormV4.payroll.test.tsx` (เพิ่ม 1 เทสต์)

**Interfaces:**
- Produces: `useLeaveGuard(state: unknown): { dirty: boolean; markPristine: () => void; asSystem: (change: () => void) => void; captureProps: { onPointerDownCapture: () => void; onKeyDownCapture: () => void; onChangeCapture: () => void } }`
- Produces: `SettlementLinesSection` prop ใหม่ `onAutoChange?: (v: SettlementFormFields) => void` (ไม่ส่ง = ใช้ `onChange` — พฤติกรรมเดิม)

- [ ] **Step 1: เขียนเทสต์ของ hook (ล้มเพราะยังไม่มีไฟล์)**

สร้าง `apps/web/src/components/expense-form-v4/__tests__/useLeaveGuard.test.tsx`:

```tsx
// apps/web/src/components/expense-form-v4/__tests__/useLeaveGuard.test.tsx
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useLeaveGuard } from '../useLeaveGuard';

type Guard = ReturnType<typeof useLeaveGuard>;

const mountGuard = () =>
  renderHook(({ state }: { state: object }) => useLeaveGuard(state), {
    initialProps: { state: { n: 0 } as object },
  });

/** ผู้ใช้กดแป้นในกรอบฟอร์ม */
const touch = (guard: Guard) => act(() => guard.captureProps.onKeyDownCapture());
const beforeUnloadAdded = (spy: { mock: { calls: unknown[][] } }) =>
  spy.mock.calls.some((c) => c[0] === 'beforeunload');

afterEach(() => vi.restoreAllMocks());

describe('useLeaveGuard', () => {
  it('ผู้ใช้แตะฟอร์มแล้ว state เปลี่ยน → ผูก beforeunload ที่กันการปิดแท็บ', () => {
    const add = vi.spyOn(window, 'addEventListener');
    const { result, rerender } = mountGuard();
    touch(result.current);
    rerender({ state: { n: 1 } });
    expect(result.current.dirty).toBe(true);
    const handler = add.mock.calls.find((c) => c[0] === 'beforeunload')![1] as (e: Event) => void;
    const event = new Event('beforeunload', { cancelable: true });
    handler(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it('state เปลี่ยนตอนผู้ใช้ยังไม่แตะฟอร์ม → ไม่ผูก', () => {
    const add = vi.spyOn(window, 'addEventListener');
    const { result, rerender } = mountGuard();
    rerender({ state: { n: 1 } });
    expect(result.current.dirty).toBe(false);
    expect(beforeUnloadAdded(add)).toBe(false);
  });

  it('แตะแล้วแต่ state เปลี่ยนจากระบบ (asSystem) → ไม่นับ · การเปลี่ยนครั้งถัดไปของผู้ใช้นับ', () => {
    const { result, rerender } = mountGuard();
    touch(result.current);
    act(() => result.current.asSystem(() => rerender({ state: { n: 1 } })));
    expect(result.current.dirty).toBe(false);
    rerender({ state: { n: 2 } });
    expect(result.current.dirty).toBe(true);
  });

  it('markPristine ถอด beforeunload และการแตะก่อนหน้านั้นไม่นับอีก', () => {
    const remove = vi.spyOn(window, 'removeEventListener');
    const { result, rerender } = mountGuard();
    touch(result.current);
    rerender({ state: { n: 1 } });
    expect(result.current.dirty).toBe(true);
    act(() => result.current.markPristine());
    expect(result.current.dirty).toBe(false);
    expect(beforeUnloadAdded(remove)).toBe(true);
    rerender({ state: { n: 2 } });
    expect(result.current.dirty).toBe(false);
    touch(result.current);
    rerender({ state: { n: 3 } });
    expect(result.current.dirty).toBe(true);
  });
});
```

- [ ] **Step 2: รันให้เห็นว่าล้ม**

Run: `npx vitest run src/components/expense-form-v4/__tests__/useLeaveGuard.test.tsx`
Expected: FAIL — `Failed to resolve import "../useLeaveGuard"`

- [ ] **Step 3: สร้าง hook**

สร้าง `apps/web/src/components/expense-form-v4/useLeaveGuard.ts`:

```ts
// apps/web/src/components/expense-form-v4/useLeaveGuard.ts
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/**
 * คำเตือนก่อนปิด/รีเฟรชแท็บ (beforeunload) เมื่อผู้ใช้แก้ฟอร์มแล้วยังไม่บันทึก
 *
 * "แก้" = state ของฟอร์มเปลี่ยน หลังผู้ใช้แตะฟอร์ม (กด · พิมพ์ · เปลี่ยนค่า ในกรอบที่ผูก `captureProps`)
 * ไม่นับ:
 * - การเปลี่ยนที่ระบบทำเอง — ห่อด้วย `asSystem` (ติ๊กใบเจ้าหนี้ตามค่าตั้ง · ปรับยอดเมื่อปิดจ่ายบางส่วน ·
 *   ปิดเงินสดย่อยตามค่าตั้ง) แม้ผู้ใช้เพิ่งกดแป้นก่อนข้อมูลโหลดเสร็จ
 * - หลัง `markPristine` — ฟอร์มตรงกับของที่บันทึกแล้ว หรือเพิ่งล้างเป็นฟอร์มเปล่า (การแตะก่อนหน้านั้นไม่นับอีก)
 *
 * ข้อจำกัดที่รู้: ถ้าการเปลี่ยนของระบบกับของผู้ใช้ลงใน commit เดียวกัน รอบนั้นไม่ถูกนับ — ผลไม่ผิด
 * เพราะการกด/พิมพ์ตั้ง "แตะแล้ว" ไว้ และการเปลี่ยนรอบถัดไป (รวมของระบบที่ตามมา) จะถูกนับ
 */
export function useLeaveGuard(state: unknown) {
  const [dirty, setDirty] = useState(false);
  const interacted = useRef(false);
  const systemChangePending = useRef(false);

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
    if (systemChangePending.current) {
      systemChangePending.current = false;
      return;
    }
    if (interacted.current) setDirty(true);
  }, [state]);

  const markPristine = useCallback(() => {
    interacted.current = false;
    setDirty(false);
  }, []);

  /** เรียกเฉพาะเมื่อ `change` เปลี่ยน state จริง — ไม่งั้นการเปลี่ยนครั้งถัดไปของผู้ใช้จะถูกข้าม */
  const asSystem = useCallback((change: () => void) => {
    systemChangePending.current = true;
    change();
  }, []);

  const captureProps = useMemo(() => {
    const markInteracted = () => {
      interacted.current = true;
    };
    return {
      onPointerDownCapture: markInteracted,
      onKeyDownCapture: markInteracted,
      onChangeCapture: markInteracted,
    };
  }, []);

  return { dirty, markPristine, asSystem, captureProps };
}
```

- [ ] **Step 4: รันเทสต์ของ hook ให้ผ่าน**

Run: `npx vitest run src/components/expense-form-v4/__tests__/useLeaveGuard.test.tsx`
Expected: PASS 4/4

- [ ] **Step 5: เขียนเทสต์ระดับหน้าที่ล้ม (3 กรณีของ M-7)**

(ก) `ExpenseFormV4.page.test.tsx` — เพิ่ม `act` ในบรรทัด import ของ Testing Library (บรรทัด 2):

```ts
import { act, render, screen, waitFor, within } from '@testing-library/react';
```

แล้วเพิ่ม 3 เทสต์ท้าย `describe('ExpenseFormV4 — หน้าเต็ม', …)` (ต่อจากเทสต์ "เปิดจ่ายเจ้าหนี้แล้วระบบติ๊กใบให้เอง …"):

```tsx
  it('กด เริ่มเปล่า บนฟอร์มที่ยังไม่แก้ ไม่ผูก beforeunload', async () => {
    const add = vi.spyOn(window, 'addEventListener');
    const user = mount();
    await user.click(screen.getByRole('button', { name: /^เริ่มเปล่า/ }));
    await new Promise((r) => setTimeout(r, 50));
    expect(add.mock.calls.some((c) => c[0] === 'beforeunload')).toBe(false);
    add.mockRestore();
  });

  it('แก้ฟอร์มแล้วกด เริ่มเปล่า — ฟอร์มกลับเป็นเปล่าและถอด beforeunload', async () => {
    const remove = vi.spyOn(window, 'removeEventListener');
    const user = mount();
    await fillExpenseLine(user, { account: '53-1101', unitPrice: '850' });
    await user.click(screen.getByRole('button', { name: /^เริ่มเปล่า/ }));
    await waitFor(() => expect(remove.mock.calls.some((c) => c[0] === 'beforeunload')).toBe(true));
    expect(screen.getAllByLabelText('ราคา/หน่วย')[0]).not.toHaveDisplayValue('850');
    remove.mockRestore();
  });

  it('จ่ายเจ้าหนี้: คลิก/กดแป้นก่อนรายการตั้งหนี้โหลด แล้วระบบติ๊กใบให้ — ไม่ผูก beforeunload', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const base = apiGet.getMockImplementation()!;
    apiGet.mockImplementation((path: string) =>
      path.includes('status=ACCRUAL') ? gate.then(() => base(path)) : base(path),
    );
    const add = vi.spyOn(window, 'addEventListener');
    const user = mount({ initialDocType: 'VENDOR_SETTLEMENT' });
    // คลิกหัวหน้า + กด Tab ในกรอบฟอร์ม ก่อนรายการโหลด (Tab แรกออกจาก body — ตัวที่สองเกิดในกรอบฟอร์ม)
    await user.click(screen.getByRole('heading', { level: 1 }));
    await user.tab();
    await user.tab();
    act(() => release());
    await waitForSettlementDoc('EX-009');
    await new Promise((r) => setTimeout(r, 50));
    expect(add.mock.calls.some((c) => c[0] === 'beforeunload')).toBe(false);
    add.mockRestore();
  });
```

(ข) `ExpenseFormV4.payroll.test.tsx` — เพิ่มเทสต์ท้าย `describe('ExpenseFormV4 payroll — save and submit before the cutoff', …)` (ต่อจากเทสต์ "shows the SUBMIT_CUTOFF message …"):

```tsx
  it('ส่งขออนุมัติไม่ผ่านแต่ใบบันทึกแล้ว: โหลดใบกลับมาแล้วไม่เหลือคำเตือนก่อนออกจากหน้า', async () => {
    flags.approvalEnabled = true;
    flags.approvalRequiredDocTypes = ['PAYROLL'];
    const events: string[] = [];
    const add = vi.spyOn(window, 'addEventListener').mockImplementation(((type: string) => {
      if (type === 'beforeunload') events.push('add');
    }) as typeof window.addEventListener);
    const remove = vi.spyOn(window, 'removeEventListener').mockImplementation(((type: string) => {
      if (type === 'beforeunload') events.push('remove');
    }) as typeof window.removeEventListener);
    try {
      apiPost.mockImplementation((path: string) => {
        if (path === '/expense-documents/payroll') return Promise.resolve({ data: { id: 'new-1' } });
        if (path === '/expense-documents/new-1/submit-for-approval') {
          return Promise.reject({
            response: { status: 409, data: { code: 'PAYROLL_SUBMIT_CUTOFF', message: CUTOFF_MESSAGE } },
          });
        }
        return Promise.resolve({ data: {} });
      });
      const user = userEvent.setup();
      mount();
      await user.click(await screen.findByRole('button', { name: 'เลือกพนักงาน' }));
      await waitFor(() => expect(events).toContain('add'));
      docs['new-1'] = storedDoc('new-1', [ELIGIBLE_LINE]);
      await user.click(screen.getByRole('button', { name: 'บันทึกและขออนุมัติ' }));
      expect(await screen.findByRole('alert')).toHaveTextContent(CUTOFF_MESSAGE);
      // ใบที่บันทึกแล้วถูกโหลดกลับ (แผงตรวจมาจากใบที่เก็บไว้)
      expect(await screen.findByRole('heading', { name: 'วันที่ต้องตรวจ (1)' })).toBeInTheDocument();
      await waitFor(() => expect(events[events.length - 1]).toBe('remove'));
    } finally {
      add.mockRestore();
      remove.mockRestore();
    }
  });
```

- [ ] **Step 6: รันให้เห็นว่าเทสต์ระดับหน้าล้ม (โค้ดหน้ายังไม่แก้)**

Run: `npx vitest run src/components/expense-form-v4/__tests__/ExpenseFormV4.page.test.tsx src/components/expense-form-v4/__tests__/ExpenseFormV4.payroll.test.tsx`
Expected: FAIL 4 ตัวที่เพิ่ง (เริ่มเปล่า ×2 · กดก่อนโหลด · ส่งขออนุมัติไม่ผ่าน) · ตัวเดิมผ่าน

- [ ] **Step 7: แก้ `SettlementLinesSection.tsx`**

(1) Props (บรรทัด 33-37) แทนด้วย:

```ts
interface Props {
  branchId: string;
  value: SettlementFormFields;
  onChange: (v: SettlementFormFields) => void;
  /** การเปลี่ยนที่ระบบทำเอง (ติ๊กใบตามค่าตั้ง · ปรับยอดเมื่อปิดจ่ายบางส่วน) — ไม่ส่ง = ใช้ onChange */
  onAutoChange?: (v: SettlementFormFields) => void;
}
```

(2) ลายเซ็น (บรรทัด 87):

```ts
export function SettlementLinesSection({ branchId, value, onChange, onAutoChange = onChange }: Props) {
```

(3) ใน effect ติ๊กใบ (บรรทัด 153) แทน `if (added > 0) onChange({ ...value, selections: pre });` ด้วย:

```ts
    if (added > 0) onAutoChange({ ...value, selections: pre });
```

(4) ใน effect ปรับยอดเมื่อปิดจ่ายบางส่วน (บรรทัด 177) แทน `if (mutated) onChange({ ...value, selections: next });` ด้วย:

```ts
    if (mutated) onAutoChange({ ...value, selections: next });
```

`toggle` / `updateAmount` (การกดของผู้ใช้) ใช้ `onChange` ตามเดิม · `SettlementPayeeFields` ไม่แตะ

- [ ] **Step 8: แก้ `ExpenseFormV4.tsx` (8 จุด)**

(1) import — ต่อจาก `import { useFormCompute } from './useFormCompute';`:

```ts
import { useLeaveGuard } from './useLeaveGuard';
```

(2) ต่อจากบรรทัด `const patch = (p: Partial<ExpenseFormState>) => setState((s) => ({ ...s, ...p }));`:

```ts
  // คำเตือนก่อนปิดแท็บ — ประกาศก่อน effect ของระบบด้านล่าง (ปิดเงินสดย่อย) ที่ใช้ asSystem
  const leaveGuard = useLeaveGuard(state);
```

(3) `openSavedDraft` — แทน

```ts
    const { data } = await api.get<PayrollDocForEdit>(`/expense-documents/${id}`);
    if (data.payroll) applyPayrollDoc({ ...data, payroll: data.payroll });
```

ด้วย

```ts
    const { data } = await api.get<PayrollDocForEdit>(`/expense-documents/${id}`);
    // ใบที่โหลดกลับคือใบที่บันทึกแล้ว — ไม่ใช่การแก้ค้าง (ทั้งหลัง "บันทึกร่าง + คิดยอด" และหลังส่งขออนุมัติ/ลงบัญชีไม่ผ่าน)
    leaveGuard.markPristine();
    if (data.payroll) applyPayrollDoc({ ...data, payroll: data.payroll });
```

(4) effect ปิดเงินสดย่อยตามค่าตั้ง — แทน `      patch({ docType: 'EXPENSE_SAMEDAY' });` ในบล็อก `if (!pettyCashEnabled && state.docType === 'PETTY_CASH_REIMBURSEMENT')` ด้วย:

```ts
      leaveGuard.asSystem(() => patch({ docType: 'EXPENSE_SAMEDAY' }));
```

(5) `onSuccess` ของ `saveMutation` — บรรทัดแรกในฟังก์ชัน (ก่อน `queryClient.invalidateQueries({ queryKey: ['expenses'] });`):

```ts
      // บันทึกแล้ว — ปลดคำเตือนก่อนออกจากหน้า (แทน effect saveMutation.isSuccess เดิม)
      leaveGuard.markPristine();
```

(6) ลบบล็อกนี้ทั้งก้อน (ใต้ `const jePanelId = useId();`):

```ts
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

(7) กรอบฟอร์ม — แทน

```tsx
    <div
      className="-mb-[calc(5rem+env(safe-area-inset-bottom,0px))] pt-4 lg:-mb-8"
      onPointerDownCapture={markInteracted}
      onKeyDownCapture={markInteracted}
      onChangeCapture={markInteracted}
    >
```

ด้วย

```tsx
    <div className="-mb-[calc(5rem+env(safe-area-inset-bottom,0px))] pt-4 lg:-mb-8" {...leaveGuard.captureProps}>
```

(8) QuickStart "เริ่มเปล่า" — แทน

```ts
              if (m === 'blank')
                setState(initial(branchId, user?.defaultCashAccountCode || '11-1101'));
```

ด้วย

```ts
              if (m === 'blank') {
                // ฟอร์มกลับเป็นฟอร์มเปล่า — ไม่มีอะไรให้เสีย ไม่ต้องเตือนก่อนออก
                leaveGuard.markPristine();
                setState(initial(branchId, user?.defaultCashAccountCode || '11-1101'));
              }
```

และ `SettlementLinesSection` (บล็อก `เอกสารตั้งหนี้ที่จะล้าง`) — เพิ่ม prop:

```tsx
            <SettlementLinesSection
              branchId={state.branchId}
              value={state.settlement}
              onChange={(s) => patch({ settlement: s })}
              onAutoChange={(s) => leaveGuard.asSystem(() => patch({ settlement: s }))}
            />
```

หลังแก้ ตรวจว่าใน `ExpenseFormV4.tsx` ไม่เหลือ `interacted` / `markInteracted` / `setDirty` / `dirty` (`useRef` ยังใช้ที่ `noticeRef` — คง import ไว้)

- [ ] **Step 9: รันให้ผ่าน**

Run: `npx vitest run src/components/expense-form-v4`
Expected: PASS ทั้งโฟลเดอร์ — รวมเทสต์เดิม "ผูก beforeunload หลังผู้ใช้แก้ฟอร์ม" · "เลือกบัญชีด้วยการคลิกอย่างเดียว ก็ผูก beforeunload" · "บันทึกสำเร็จแล้วถอด beforeunload" · "เปิดจ่ายเจ้าหนี้แล้วระบบติ๊กใบให้เอง …" · payroll "หลังบันทึกร่าง + คิดยอดแล้วโหลดใบกลับมา …" และ `SettlementLinesSection.test.tsx` · `ExpenseFormV4.payloads.test.tsx` ไม่ถูกแก้

- [ ] **Step 10: Type check**

Run: `npx tsc --noEmit`
Expected: exit 0

- [ ] **Step 11: Commit**

```bash
git add apps/web/src/components/expense-form-v4/useLeaveGuard.ts \
  apps/web/src/components/expense-form-v4/__tests__/useLeaveGuard.test.tsx \
  apps/web/src/components/expense-form-v4/ExpenseFormV4.tsx \
  apps/web/src/components/expense-form-v4/SettlementLinesSection.tsx \
  apps/web/src/components/expense-form-v4/__tests__/ExpenseFormV4.page.test.tsx \
  apps/web/src/components/expense-form-v4/__tests__/ExpenseFormV4.payroll.test.tsx
git commit -m "fix(web): คำเตือนออกจากหน้าไม่นับการเปลี่ยนของระบบ เริ่มเปล่า และใบที่โหลดกลับหลังบันทึก

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: ใบลดหนี้ — เก็บเอกสารต้นฉบับที่เลือกไว้เอง และย้ายโฟกัสหลังเลือก/เปลี่ยน

**ปัญหา:**
- M-4: `selectedDoc` หาจากผลค้นหาปัจจุบัน (`CreditNoteLinesSection.tsx:54`) — `staleTime` 0 ⇒ กลับมาที่หน้าต่างแล้วผลค้นหาโหลดใหม่ไม่มีเอกสารนั้น (เช่น ถูกลดหนี้เต็มแล้วโดยคนอื่น / ค้นด้วยคำที่ผลเปลี่ยน) ⇒ การ์ดเอกสารและแถว "รับเงินคืนเข้า" หายทั้งที่ `originalDocumentId` ยังตั้งอยู่
- M-13: กดเลือกเอกสาร (ปุ่มในรายการ) หรือกด "เปลี่ยน" แล้วปุ่มที่กดหายไป ⇒ โฟกัสหลุดไป `<body>`

**วิธี:** เก็บ `OriginalDoc` ที่ผู้ใช้เลือกไว้ใน state ของ component (ใช้ก่อนผลค้นหา) · หลังเลือก โฟกัสการ์ดเอกสารที่เลือก (`tabIndex={-1}` + `role="group"` + `aria-label`) · หลัง "เปลี่ยน" โฟกัสช่องค้นหา

**Files:**
- Modify: `apps/web/src/components/expense-form-v4/CreditNoteLinesSection.tsx`
- Test: `apps/web/src/components/expense-form-v4/__tests__/ExpenseFormV4.round2.test.tsx` (เพิ่ม 2 เทสต์ใน `describe('ใบลดหนี้ — รับเงินคืนเข้า', …)`)

- [ ] **Step 1: เขียนเทสต์ที่ล้ม**

แก้ import ของไฟล์เทสต์ (บรรทัด 2 และ 5):

```ts
import { act, render, screen, waitFor, within } from '@testing-library/react';
```

```ts
import { QueryClient, QueryClientProvider, focusManager } from '@tanstack/react-query';
```

เพิ่ม 2 เทสต์ท้าย `describe('ใบลดหนี้ — รับเงินคืนเข้า', …)`:

```tsx
  it('เลือกเอกสารต้นฉบับแล้วโฟกัสไปที่การ์ดเอกสารที่เลือก · กด เปลี่ยน แล้วโฟกัสกลับช่องค้นหา', async () => {
    const user = mount();
    await chooseKind(user, 'CREDIT_NOTE');
    await pickCreditNoteSource(user, 'EX-0', /EX-001/);
    const card = await screen.findByRole('group', { name: 'เอกสารต้นฉบับที่เลือก EX-001' });
    expect(card).toHaveFocus();
    await user.click(within(card).getByRole('button', { name: 'เปลี่ยน' }));
    expect(screen.getByLabelText('ค้นหาเลข EX-... / ผู้ขาย (3 ตัวขึ้นไป)')).toHaveFocus();
  });

  it('ผลค้นหาโหลดใหม่ (กลับมาที่หน้าต่าง) แล้วไม่มีเอกสารนั้น — การ์ดและแถว รับเงินคืนเข้า ยังอยู่', async () => {
    const user = mount();
    await chooseKind(user, 'CREDIT_NOTE');
    await pickCreditNoteSource(user, 'EX-0', /EX-001/);
    await screen.findByRole('region', { name: 'รับเงินคืนเข้า' });
    const searchCalls = () => apiGet.mock.calls.filter((c) => String(c[0]).includes('search=')).length;
    const before = searchCalls();
    const base = apiGet.getMockImplementation()!;
    apiGet.mockImplementation((path: string) =>
      path.startsWith('/expense-documents?') && path.includes('search=')
        ? Promise.resolve({ data: { data: [] } })
        : base(path),
    );
    try {
      act(() => focusManager.setFocused(false));
      act(() => focusManager.setFocused(true));
      await waitFor(() => expect(searchCalls()).toBeGreaterThan(before));
      expect(screen.getByRole('group', { name: 'เอกสารต้นฉบับที่เลือก EX-001' })).toBeInTheDocument();
      expect(screen.getByRole('region', { name: 'รับเงินคืนเข้า' })).toBeInTheDocument();
    } finally {
      focusManager.setFocused(undefined);
    }
  });
```

- [ ] **Step 2: รันให้เห็นว่าล้ม**

Run: `npx vitest run src/components/expense-form-v4/__tests__/ExpenseFormV4.round2.test.tsx`
Expected: FAIL 2 ตัวใหม่ — หา group "เอกสารต้นฉบับที่เลือก EX-001" ไม่เจอ (ตัวแรก) · หลังโหลดใหม่การ์ด/แถวหาย (ตัวที่สอง)

- [ ] **Step 3: แก้ `CreditNoteLinesSection.tsx`**

(1) import React (บรรทัด 1):

```ts
import { useEffect, useId as useUiFieldId, useRef, useState } from 'react';
```

(2) แทน

```ts
  const selectedDoc = searchResults?.data.find((d) => d.id === state.originalDocumentId);
```

ด้วย

```ts
  // เอกสารที่ผู้ใช้เลือกเก็บไว้เอง — ผลค้นหาโหลดใหม่ (กลับมาที่หน้าต่าง) แล้วไม่มีเอกสารนั้น การ์ดและแถว "รับเงินคืนเข้า" ต้องไม่หาย
  const [pickedDoc, setPickedDoc] = useState<OriginalDoc | null>(null);
  const selectedDoc =
    pickedDoc && pickedDoc.id === state.originalDocumentId
      ? pickedDoc
      : searchResults?.data.find((d) => d.id === state.originalDocumentId);

  // ปุ่มที่ผู้ใช้กดหายไปหลังเลือก/เปลี่ยนเอกสาร — ย้ายโฟกัสไปที่สิ่งที่เพิ่งขึ้นมา ไม่ให้หลุดไปที่ body
  const selectedCardRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const focusAfterRender = useRef<'selected' | 'search' | null>(null);
  useEffect(() => {
    const target =
      focusAfterRender.current === 'selected'
        ? selectedCardRef.current
        : focusAfterRender.current === 'search'
          ? searchInputRef.current
          : null;
    if (!target) return;
    focusAfterRender.current = null;
    target.focus();
  });
```

(3) `switchMode` — ต่อจาก `setSearch('');` เพิ่ม:

```ts
    setPickedDoc(null);
```

(4) การ์ดเอกสารที่เลือก — แทนบรรทัดเปิด

```tsx
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary/30 bg-primary/5 p-3">
```

ด้วย

```tsx
                <div
                  ref={selectedCardRef}
                  tabIndex={-1}
                  role="group"
                  aria-label={`เอกสารต้นฉบับที่เลือก ${selectedDoc.number}`}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary/30 bg-primary/5 p-3"
                >
```

(5) ปุ่ม "เปลี่ยน" — แทน onClick

```tsx
                    onClick={() => {
                      onChange({ originalDocumentId: '' });
                      setSearch('');
                    }}
```

ด้วย

```tsx
                    onClick={() => {
                      onChange({ originalDocumentId: '' });
                      setSearch('');
                      setPickedDoc(null);
                      focusAfterRender.current = 'search';
                    }}
```

(6) ช่องค้นหา — เพิ่ม `ref={searchInputRef}` ที่ `<input aria-label="ค้นหาเลข EX-... / ผู้ขาย (3 ตัวขึ้นไป)"`:

```tsx
                    <input ref={searchInputRef} aria-label="ค้นหาเลข EX-... / ผู้ขาย (3 ตัวขึ้นไป)"
```

(7) ปุ่มเลือกเอกสารในรายการ — แทนบรรทัดแรกใน onClick `onChange({ originalDocumentId: doc.id });` ด้วย:

```tsx
                              setPickedDoc(doc);
                              focusAfterRender.current = 'selected';
                              onChange({ originalDocumentId: doc.id });
```

(ส่วนเติมรายการจากเอกสารต้นฉบับใต้บรรทัดนั้นคงเดิม)

- [ ] **Step 4: รันให้ผ่าน**

Run: `npx vitest run src/components/expense-form-v4/__tests__/ExpenseFormV4.round2.test.tsx src/components/expense-form-v4/__tests__/ExpenseFormV4.payloads.test.tsx`
Expected: PASS ทั้งสองไฟล์ (body ของใบลดหนี้ใน payloads เท่าเดิม)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/expense-form-v4/CreditNoteLinesSection.tsx \
  apps/web/src/components/expense-form-v4/__tests__/ExpenseFormV4.round2.test.tsx
git commit -m "fix(web): ใบลดหนี้เก็บเอกสารต้นฉบับที่เลือกไว้เอง และย้ายโฟกัสหลังเลือก/เปลี่ยน

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: ปุ่มลบรายการอยู่แถวล่าง — Tab ไล่ตามที่ตาเห็น (คำตัดสินเจ้าของ 2026-11-16)

**ปัญหา:** ตารางจอกว้างของรายจ่าย (`ItemLinesSection.tsx:271`) และเงินสดย่อย (`PettyCashLinesSection.tsx:182`) วางเซลล์ปุ่มลบ `rowSpan={2}` ไว้ในแถวบน ⇒ Tab ไปถึงปุ่มลบก่อนช่องแถวล่าง (คำอธิบาย / เลขใบกำกับฯ / รายละเอียด) · ตารางแก้ลำดับไม่ได้ถ้าเซลล์ยังอยู่แถวบน ⇒ ย้ายเซลล์ปุ่มลบไปท้ายแถวล่าง แถวบนเหลือเซลล์ว่าง · การ์ดจอแคบไม่แตะ · ชื่อปุ่ม (`ลบรายการ` / `ลบรายการ #n`) คงเดิม

**Files:**
- Modify: `apps/web/src/components/expense-form-v4/ItemLinesSection.tsx:271-281, 294-306`
- Modify: `apps/web/src/components/expense-form-v4/PettyCashLinesSection.tsx:182-193, 215`
- Test: `apps/web/src/components/expense-form-v4/__tests__/ItemLinesSection.layout.test.tsx`
- Test: `apps/web/src/components/expense-form-v4/__tests__/PettyCashLinesSection.test.tsx`

- [ ] **Step 1: เขียนเทสต์ที่ล้ม**

(ก) `ItemLinesSection.layout.test.tsx` — บรรทัด import ของ Testing Library:

```ts
import { act, render, screen } from '@testing-library/react';
```

เพิ่มเทสต์ท้าย `describe('ItemLinesSection — ตารางและการ์ด', …)`:

```tsx
  it('ปุ่มลบอยู่แถวล่างของบรรทัด — Tab ไล่ WHT% → คำอธิบาย → ต้องห้าม → ? → ลบ', async () => {
    const user = userEvent.setup();
    mount();
    const del = screen.getAllByRole('button', { name: 'ลบรายการ' })[0];
    const description = screen.getAllByLabelText('คำอธิบาย')[0];
    expect(del.closest('tr')).toBe(description.closest('tr'));
    act(() => screen.getAllByRole('combobox', { name: 'WHT%' })[0].focus());
    await user.tab();
    expect(description).toHaveFocus();
    await user.tab();
    expect(screen.getAllByRole('checkbox', { name: /ค่าใช้จ่ายต้องห้าม/ })[0]).toHaveFocus();
    await user.tab();
    expect(screen.getAllByRole('button', { name: 'ดูประเภทค่าใช้จ่ายต้องห้าม (ม.65 ตรี)' })[0]).toHaveFocus();
    await user.tab();
    expect(del).toHaveFocus();
  });
```

(ข) `PettyCashLinesSection.test.tsx` — บรรทัด import ของ Testing Library:

```ts
import { act, render, screen } from '@testing-library/react';
```

เพิ่มเทสต์ท้าย `describe('PettyCashLinesSection', …)` ระดับบนสุด:

```tsx
  it('ปุ่มลบอยู่แถวล่างของบรรทัด — Tab ไล่ VAT % → เลขใบกำกับฯ → รายละเอียด → ลบ', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    // สองบรรทัด — ปุ่มลบของบรรทัดแรกจึงกดได้ (บรรทัดเดียวปุ่มถูกปิด ไม่อยู่ในลำดับ Tab)
    await user.click(screen.getByRole('button', { name: 'เพิ่มรายการ' }));
    const del = screen.getByRole('button', { name: 'ลบรายการ #1' });
    const invoice = screen.getAllByLabelText('เลขใบกำกับฯ')[0];
    expect(del.closest('tr')).toBe(invoice.closest('tr'));
    act(() => screen.getAllByRole('combobox', { name: 'VAT %' })[0].focus());
    await user.tab();
    expect(invoice).toHaveFocus();
    await user.tab();
    expect(screen.getAllByLabelText('รายละเอียด')[0]).toHaveFocus();
    await user.tab();
    expect(del).toHaveFocus();
  });
```

- [ ] **Step 2: รันให้เห็นว่าล้ม**

Run: `npx vitest run src/components/expense-form-v4/__tests__/ItemLinesSection.layout.test.tsx src/components/expense-form-v4/__tests__/PettyCashLinesSection.test.tsx`
Expected: FAIL 2 ตัวใหม่ที่ `expect(del.closest('tr')).toBe(...)`

- [ ] **Step 3: แก้ `ItemLinesSection.tsx` (ตารางจอกว้าง)**

แทนเซลล์ปุ่มลบในแถวบน

```tsx
                <td rowSpan={2} className={cn(cell, 'px-0')}>
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
```

ด้วย

```tsx
                {/* ปุ่มลบอยู่แถวล่าง — Tab ไล่ตามที่ตาเห็น: บัญชี → ตัวเลข → คำอธิบาย → ต้องห้าม → ลบ (เจ้าของเลือก 2026-11-16) */}
                <td className={cell} />
              </tr>
```

แล้วในแถวล่าง ต่อจากเซลล์ `colSpan={6}` (ที่มี checkbox ค่าใช้จ่ายต้องห้าม) ก่อน `</tr>` เพิ่ม:

```tsx
                <td className={cn(cell, 'px-0 pt-0 pb-2.5')}>
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
```

- [ ] **Step 4: แก้ `PettyCashLinesSection.tsx` (ตารางจอกว้าง)**

แทนเซลล์ปุ่มลบในแถวบน

```tsx
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
```

ด้วย

```tsx
                {/* ปุ่มลบอยู่แถวล่าง — Tab ไล่ตามที่ตาเห็น: ผู้ขาย → บัญชี → ยอด → VAT → เลขใบกำกับฯ → รายละเอียด → ลบ (เจ้าของเลือก 2026-11-16) */}
                <td className={cell} />
              </tr>
```

แล้วในแถวล่าง แทน `<td colSpan={3} />` ด้วย:

```tsx
                <td colSpan={3} />
                <td className={cn(cell, 'px-0 pt-0 pb-2.5')}>
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
```

- [ ] **Step 5: รันให้ผ่าน**

Run: `npx vitest run src/components/expense-form-v4`
Expected: PASS ทั้งโฟลเดอร์ (เทสต์เดิมที่นับปุ่ม `ลบรายการ` / `ลบรายการ #n` และหัวคอลัมน์ยังผ่าน)

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/expense-form-v4/ItemLinesSection.tsx \
  apps/web/src/components/expense-form-v4/PettyCashLinesSection.tsx \
  apps/web/src/components/expense-form-v4/__tests__/ItemLinesSection.layout.test.tsx \
  apps/web/src/components/expense-form-v4/__tests__/PettyCashLinesSection.test.tsx
git commit -m "fix(web): ปุ่มลบรายการอยู่แถวล่างของบรรทัด ลำดับ Tab ตรงกับที่ตาเห็น

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: ตรวจทั้ง branch (controller ทำเอง)

- [ ] **Step 1: เทสต์ทั้งเว็บ + type + lint**

```bash
cd "d:/BESTCHOICE APP/BESTCHOICE/apps/web"
npx vitest run
npx tsc --noEmit
npx eslint src/hooks/useIsMobile.ts src/hooks/useIsMobile.test.ts src/components/ui/ThaiDateInput.tsx src/components/ui/ThaiDateInput.test.tsx src/components/expense-form-v4
```

Expected: vitest ล้มเฉพาะ 5 ไฟล์ที่รู้อยู่แล้ว (Global Constraints) · tsc exit 0 · eslint ไม่มี error

- [ ] **Step 2: field-scale เทียบก่อน/หลัง**

```bash
cd "d:/BESTCHOICE APP/BESTCHOICE"
LOCAL_PREVIEW_PORT=5197 npm run local:preview
node tools/field-scale/check.mjs --label followups-end --routes expense-new,payroll-new
node tools/field-scale/check.mjs --compare followups-base followups-end
```

Expected: compare exit 0 (ไม่มี P1/P2 ใหม่) · P2 F1 `background` ของแถวเลขผู้เสียภาษี/วันที่ใบกำกับอยู่ในรายการ "fixed"

- [ ] **Step 3: ดูจอจริงที่ 1440 และ 390 (final review รอบ 1 M-9 ขอให้ spot-check หลังแก้ `useIsMobile`)**

เปิด preview (`http://127.0.0.1:5197`) ด้วย Playwright / Chrome DevTools MCP ที่กว้าง 1440 และ 390:
`/expenses/new` · `/expenses/new?type=SE` · `/expenses/new?type=CN` · `/expenses/new?type=PR` · เงินสดย่อย (เลือกจากเมนูประเภทเอกสาร)
ตรวจ: 390 = การ์ดต่อบรรทัด ไม่มีตารางจอใหญ่โผล่ ไม่มีเลื่อนแนวนอนทั้งหน้า · 1440 = ปุ่มลบอยู่แถวล่างของแต่ละบรรทัด (รายจ่าย + เงินสดย่อย) · ช่องวันที่ใบกำกับพื้นเดียวกับช่องข้าง ๆ · ถ่ายภาพเก็บไว้ใน `.tmp/followups-shots/`

- [ ] **Step 4: final whole-branch review**

ตาม superpowers:subagent-driven-development (review package `git merge-base main HEAD`..HEAD)

- [ ] **Step 5: รายงานเจ้าของ แล้วรอคำสั่ง** — ห้าม push / merge / deploy เอง
