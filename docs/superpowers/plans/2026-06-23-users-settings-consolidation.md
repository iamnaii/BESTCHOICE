# Users / Settings Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ลบแท็บ settings "ผู้ใช้งาน" ที่ซ้ำซ้อน ย้ายสวิตช์ควบคุม 4 อันเข้าแท็บ "ระบบควบคุม" ที่มีอยู่ และ alias ลิงก์เก่า `#users` → `#internal-control` โดย `/users` ไม่ถูกแตะ

**Architecture:** Direction B จาก spec — `/users` เป็นการจัดการผู้ใช้ล้วนๆ, นโยบายระบบ (Maker-Checker / สิทธิ์กลับรายการ / ผู้ดูแลเงินสดย่อย / โหมดทดสอบ) อยู่รวมกันใน `InternalControlTab` (`/settings#internal-control`) ซึ่งถือ `ReverseReasonsManagementCard` อยู่แล้ว → คู่ reverse กลับมารวม. ไม่ย้ายไฟล์ component (4 การ์ดอยู่ใน `SettingsPage/components/` อยู่แล้ว แค่เปลี่ยนผู้ import). Hash alias ทำในหน้าเดียวกัน ไม่ใช่ cross-route redirect.

**Tech Stack:** React 18 + TypeScript + Vite + Tailwind + shadcn/ui (Radix Tabs) + Vitest + Playwright (e2e)

**Spec:** `docs/superpowers/specs/2026-06-23-users-page-consolidation-design.md`

## Global Constraints

- Frontend: ใช้ design token semantic เท่านั้น — ห้าม hardcoded hex / `text-gray-*` / `bg-white` (ใช้ `text-muted-foreground`, `text-destructive`, ฯลฯ)
- Functional components + hooks เท่านั้น; UI text ภาษาไทย; Thai text ใช้ `leading-snug`
- **ห้ามแตะ** `apps/web/src/pages/UsersPage/**`, `apps/web/src/config/menu.ts`, และ**ห้ามย้าย/แก้ internals** ของ 4 การ์ดใน `SettingsPage/components/`
- คงสิทธิ์เดิม: `InternalControlTab` เป็น OWNER-only (ผ่าน `TABS` role gate ใน SettingsPage)
- Commit บ่อย, task ละ commit; branch ปัจจุบัน `feat/users-page-consolidation`

---

## File Structure

- **Modify** `apps/web/src/pages/SettingsPage/tabs/InternalControlTab.tsx` — ประกอบ 5 การ์ดเป็น 3 กลุ่มมีหัวข้อ (เดิมมี 1 การ์ด)
- **Create** `apps/web/src/pages/SettingsPage/tabs/__tests__/InternalControlTab.test.tsx` — เทส composition (mock การ์ดลูก)
- **Modify** `apps/web/src/pages/SettingsPage/index.tsx` — ถอด users tab + import, เพิ่ม hash alias, เปลี่ยน label internal-control
- **Delete** `apps/web/src/pages/SettingsPage/tabs/UsersTab.tsx`
- **Modify** `apps/web/src/pages/SettingsPage/__tests__/SettingsPage.test.tsx` — เทส alias + ไม่มี users tab + label ใหม่
- **Modify** `apps/web/e2e/settings-tabs.spec.ts` — `TAB_IDS` + คอมเมนต์
- **Modify** `.claude/rules/accounting.md` (บรรทัด 607) + `apps/web/src/pages/SettingsPage/components/PettyCashCustodianCard.tsx` (คอมเมนต์บรรทัด 31)

---

## Task 1: ขยาย InternalControlTab เป็น grouped layout (5 การ์ด)

**Files:**
- Modify: `apps/web/src/pages/SettingsPage/tabs/InternalControlTab.tsx`
- Test: `apps/web/src/pages/SettingsPage/tabs/__tests__/InternalControlTab.test.tsx`

**Interfaces:**
- Consumes (มีอยู่แล้ว, zero-prop named exports): `MakerCheckerToggle`, `ReversePermissionCard`, `ReverseReasonsManagementCard`, `PettyCashCustodianCard`, `TestModeToggle` จาก `../components/`
- Produces: `InternalControlTab` (named export, zero-prop) — แสดง 3 section headings: `'การอนุมัติ & สิทธิ์'`, `'เงินสด'`, `'ความปลอดภัย'`

- [ ] **Step 1: เขียนเทสที่ fail ก่อน**

สร้าง `apps/web/src/pages/SettingsPage/tabs/__tests__/InternalControlTab.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { InternalControlTab } from '../InternalControlTab';

// mock การ์ดลูกทั้ง 5 — เทสนี้ตรวจ "การประกอบ/จัดกลุ่ม" ไม่ใช่ internals ของการ์ด
vi.mock('../../components/MakerCheckerToggle', () => ({
  MakerCheckerToggle: () => <div>maker-checker</div>,
}));
vi.mock('../../components/ReversePermissionCard', () => ({
  ReversePermissionCard: () => <div>reverse-permission</div>,
}));
vi.mock('../../components/ReverseReasonsManagementCard', () => ({
  ReverseReasonsManagementCard: () => <div>reverse-reasons</div>,
}));
vi.mock('../../components/PettyCashCustodianCard', () => ({
  PettyCashCustodianCard: () => <div>petty-cash</div>,
}));
vi.mock('../../components/TestModeToggle', () => ({
  TestModeToggle: () => <div>test-mode</div>,
}));

describe('InternalControlTab', () => {
  it('แสดงการ์ดควบคุมครบ 5 อัน', () => {
    render(<InternalControlTab />);
    expect(screen.getByText('maker-checker')).toBeTruthy();
    expect(screen.getByText('reverse-permission')).toBeTruthy();
    expect(screen.getByText('reverse-reasons')).toBeTruthy();
    expect(screen.getByText('petty-cash')).toBeTruthy();
    expect(screen.getByText('test-mode')).toBeTruthy();
  });

  it('แสดงหัวข้อกลุ่มครบ 3 กลุ่ม', () => {
    render(<InternalControlTab />);
    expect(screen.getByText('การอนุมัติ & สิทธิ์')).toBeTruthy();
    expect(screen.getByText('เงินสด')).toBeTruthy();
    expect(screen.getByText('ความปลอดภัย')).toBeTruthy();
  });
});
```

- [ ] **Step 2: รันเทสให้เห็นว่า fail**

Run: `cd apps/web && npx vitest run src/pages/SettingsPage/tabs/__tests__/InternalControlTab.test.tsx`
Expected: FAIL — ปัจจุบัน InternalControlTab มีแค่ `reverse-reasons`; `maker-checker` / `petty-cash` / หัวข้อกลุ่ม หาไม่เจอ

- [ ] **Step 3: เขียน implementation**

แทนที่ทั้งไฟล์ `apps/web/src/pages/SettingsPage/tabs/InternalControlTab.tsx`:

```tsx
import { MakerCheckerToggle } from '../components/MakerCheckerToggle';
import { ReversePermissionCard } from '../components/ReversePermissionCard';
import { ReverseReasonsManagementCard } from '../components/ReverseReasonsManagementCard';
import { PettyCashCustodianCard } from '../components/PettyCashCustodianCard';
import { TestModeToggle } from '../components/TestModeToggle';

/**
 * InternalControlActionBar — Settings tab รวมการตั้งค่า "ควบคุมภายใน & สิทธิ์"
 * ทั้งหมดขององค์กร. Consolidated 2026-06-23 (Direction B): ย้าย 4 การ์ดจากแท็บ
 * "ผู้ใช้งาน" เดิม (Maker-Checker, สิทธิ์กลับรายการ, ผู้ดูแลเงินสดย่อย, โหมดทดสอบ)
 * มารวมที่นี่ เพื่อให้ /users เป็นการจัดการผู้ใช้ล้วนๆ. คู่ reverse (Setting 1
 * ReversePermissionCard + Setting 2 ReverseReasonsManagementCard) กลับมาอยู่ด้วยกัน.
 *
 * Permission gating: SettingsPage redirect non-OWNER ออกทั้ง route แล้ว ไม่ต้อง guard ซ้ำ.
 */
const sectionLabel = 'text-xs font-semibold uppercase tracking-wide text-muted-foreground leading-snug';

export function InternalControlTab() {
  return (
    <div className="space-y-6">
      <section className="space-y-4">
        <h3 className={sectionLabel}>การอนุมัติ & สิทธิ์</h3>
        <MakerCheckerToggle />
        <ReversePermissionCard />
        <ReverseReasonsManagementCard />
      </section>

      <section className="space-y-4">
        <h3 className={sectionLabel}>เงินสด</h3>
        <PettyCashCustodianCard />
      </section>

      <section className="space-y-4">
        <h3 className={`${sectionLabel} text-destructive`}>ความปลอดภัย</h3>
        <TestModeToggle />
      </section>
    </div>
  );
}
```

- [ ] **Step 4: รันเทสให้ผ่าน**

Run: `cd apps/web && npx vitest run src/pages/SettingsPage/tabs/__tests__/InternalControlTab.test.tsx`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/SettingsPage/tabs/InternalControlTab.tsx apps/web/src/pages/SettingsPage/tabs/__tests__/InternalControlTab.test.tsx
git commit -m "feat(settings): expand InternalControlTab to host all 4 authority controls (grouped)"
```

---

## Task 2: ถอดแท็บ "ผู้ใช้งาน" ออกจาก SettingsPage + hash alias + เปลี่ยน label

**Files:**
- Modify: `apps/web/src/pages/SettingsPage/index.tsx`
- Modify: `apps/web/src/pages/SettingsPage/__tests__/SettingsPage.test.tsx`
- Delete: `apps/web/src/pages/SettingsPage/tabs/UsersTab.tsx`

**Interfaces:**
- Consumes: `InternalControlTab` (จาก Task 1)
- Produces: SettingsPage — ไม่มี tab id `'users'` อีกต่อไป; hash `#users` resolve เป็น `'internal-control'`; แท็บ internal-control label = `'ระบบควบคุม & สิทธิ์'`

- [ ] **Step 1: เขียนเทสที่ fail ก่อน**

แก้ `apps/web/src/pages/SettingsPage/__tests__/SettingsPage.test.tsx` — เพิ่ม mock InternalControlTab ใต้บรรทัด mock ContactsTab เดิม:

```tsx
// stub tab bodies (avoid data fetching); only the active tab mounts.
vi.mock('../tabs/ContactsTab', () => ({ ContactsTab: () => <div>contacts-body</div> }));
vi.mock('../tabs/InternalControlTab', () => ({
  InternalControlTab: () => <div>internal-control-body</div>,
}));
```

แล้วเพิ่ม 2 เทสนี้ก่อนปิด `describe`:

```tsx
  it('ไม่มีแท็บ "ผู้ใช้งาน" แล้ว + มีแท็บ "ระบบควบคุม & สิทธิ์" (OWNER)', () => {
    mockRole = 'OWNER';
    renderAt();
    expect(screen.queryByRole('tab', { name: 'ผู้ใช้งาน' })).toBeNull();
    expect(screen.getByRole('tab', { name: 'ระบบควบคุม & สิทธิ์' })).toBeTruthy();
  });

  it('alias ลิงก์เก่า #users → เปิดแท็บ ระบบควบคุม & สิทธิ์ (OWNER)', () => {
    mockRole = 'OWNER';
    renderAt('#users');
    expect(screen.getByText('internal-control-body')).toBeTruthy();
  });
```

- [ ] **Step 2: รันเทสให้เห็นว่า fail**

Run: `cd apps/web && npx vitest run src/pages/SettingsPage/__tests__/SettingsPage.test.tsx`
Expected: FAIL — แท็บ "ผู้ใช้งาน" ยังอยู่ (`queryByRole` ไม่ null), label ยังเป็น "ระบบควบคุม", และ `#users` ยัง render UsersTab จริง (อาจ throw "No QueryClient set") แทน internal-control-body

- [ ] **Step 3: ลบ import + tab entry ของ UsersTab ใน `index.tsx`**

ลบบรรทัด import (บรรทัด 12):

```tsx
import { UsersTab } from './tabs/UsersTab';
```

ลบ entry นี้ออกจาก array `TABS` (บรรทัด 35):

```tsx
  { id: 'users', label: 'ผู้ใช้งาน', roles: ['OWNER'], render: () => <UsersTab /> },
```

- [ ] **Step 4: เปลี่ยน label internal-control ใน `index.tsx`**

แก้ entry internal-control (บรรทัด 36) จาก:

```tsx
  { id: 'internal-control', label: 'ระบบควบคุม', roles: ['OWNER'], render: () => <InternalControlTab /> },
```

เป็น:

```tsx
  { id: 'internal-control', label: 'ระบบควบคุม & สิทธิ์', roles: ['OWNER'], render: () => <InternalControlTab /> },
```

- [ ] **Step 5: เพิ่ม hash alias ใน `index.tsx`**

แก้ฟังก์ชัน `readHash` (บรรทัด 42-44) — เพิ่ม alias map + `resolveHash` ต่อท้าย:

```tsx
function readHash(): string {
  return typeof window !== 'undefined' ? window.location.hash.slice(1) : '';
}

// Backward-compat: แท็บ "ผู้ใช้งาน" (#users) ถูกยุบเข้า "ระบบควบคุม & สิทธิ์" (2026-06-23).
// ลิงก์/bookmark เก่า #users จึง map มาที่ internal-control ในหน้าเดียวกัน (ไม่ reload).
const TAB_ALIASES: Record<string, string> = { users: 'internal-control' };

function resolveHash(): string {
  const h = readHash();
  return TAB_ALIASES[h] ?? h;
}
```

จากนั้นเปลี่ยน `readHash()` เป็น `resolveHash()` ใน **2 จุด**:

จุดที่ 1 — initial `useState` (บรรทัด 56):

```tsx
  const [activeTab, setActiveTab] = useState<string>(() => {
    const h = resolveHash();
    const initialIds = TABS.filter((t) => t.roles.includes(role)).map((t) => t.id);
    return initialIds.includes(h) ? h : (initialIds[0] ?? '');
  });
```

จุดที่ 2 — `hashchange` handler (บรรทัด 73-74):

```tsx
    const handler = () => {
      const h = resolveHash();
      setActiveTab(visibleIds.includes(h) ? h : (visibleIds[0] ?? ''));
    };
```

> หมายเหตุ: effect sync hash เดิม (บรรทัด 62-69) จะเขียน `#internal-control` ทับ `#users` ให้เองผ่าน `history.replaceState` เพราะ `current !== window.location.hash.slice(1)` — ไม่ต้องแก้เพิ่ม.

- [ ] **Step 6: ลบไฟล์ UsersTab**

```bash
git rm apps/web/src/pages/SettingsPage/tabs/UsersTab.tsx
```

- [ ] **Step 7: รันเทสให้ผ่าน + type-check**

Run: `cd apps/web && npx vitest run src/pages/SettingsPage/__tests__/SettingsPage.test.tsx`
Expected: PASS (เทสเดิม 5 + ใหม่ 2 = 7 ผ่านทั้งหมด)

Run: `./tools/check-types.sh web`
Expected: 0 errors (ไม่มี reference `UsersTab` ค้าง)

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/pages/SettingsPage/index.tsx apps/web/src/pages/SettingsPage/__tests__/SettingsPage.test.tsx
git commit -m "feat(settings): remove redundant ผู้ใช้งาน tab, alias #users to internal-control"
```

---

## Task 3: อัปเดต e2e settings-tabs.spec.ts

**Files:**
- Modify: `apps/web/e2e/settings-tabs.spec.ts`

**Interfaces:**
- Consumes: SettingsPage หลัง Task 2 (ไม่มี tab id `'users'`)
- Produces: e2e ที่ `TAB_IDS` ตรงกับความจริง

- [ ] **Step 1: แก้คอมเมนต์หัวไฟล์ (บรรทัด 6)**

จาก:

```ts
 * /settings — 5-tab hub (company / vat / periods / attachment / users).
```

เป็น:

```ts
 * /settings — multi-tab hub. #users ถูกยุบเข้า #internal-control (2026-06-23).
```

- [ ] **Step 2: แก้ `TAB_IDS` (บรรทัด 14)**

จาก:

```ts
const TAB_IDS = ['company', 'vat', 'periods', 'attachment', 'users'] as const;
```

เป็น:

```ts
const TAB_IDS = ['company', 'vat', 'periods', 'attachment', 'internal-control'] as const;
```

- [ ] **Step 3: ตรวจ logic (ไม่ต้องรันถ้าไม่มี env e2e)**

ทวน: assertion `expect(count).toBeGreaterThanOrEqual(5)` ยังจริง (OWNER เห็น 9 แท็บ). `expect(TAB_IDS).toContain(finalHash || 'company')` ยังจริง (finalHash เป็น vat/company). ไม่มี assertion ที่อ้าง `'users'` โดยตรง.
ถ้ามี environment รัน e2e ได้: `cd apps/web && npx playwright test e2e/settings-tabs.spec.ts`
Expected: PASS (หรือ skip ถ้า server ไม่พร้อม — ทดสอบมี early-return `settingsMounted` อยู่แล้ว)

- [ ] **Step 4: Commit**

```bash
git add apps/web/e2e/settings-tabs.spec.ts
git commit -m "test(e2e): update settings TAB_IDS after #users consolidation"
```

---

## Task 4: อัปเดตเอกสาร + คอมเมนต์ stale

**Files:**
- Modify: `.claude/rules/accounting.md` (บรรทัด 607)
- Modify: `apps/web/src/pages/SettingsPage/components/PettyCashCustodianCard.tsx` (คอมเมนต์บรรทัด 31)

**Interfaces:** ไม่มี (docs/comments เท่านั้น)

- [ ] **Step 1: แก้ accounting.md บรรทัด 607**

ใน section "Settings UI consolidation" จาก:

```markdown
- `#users` — MakerCheckerToggle + link to `/users`
```

เป็น:

```markdown
- `#internal-control` — ระบบควบคุม & สิทธิ์: ReverseReasonsManagementCard + (ย้ายมา 2026-06-23) MakerCheckerToggle, ReversePermissionCard, PettyCashCustodianCard, TestModeToggle. แท็บ `#users` เดิมถูกยุบ — `/settings#users` alias มาที่นี่. การจัดการผู้ใช้จริงอยู่ที่ `/users`
```

- [ ] **Step 2: แก้คอมเมนต์ PettyCashCustodianCard.tsx (บรรทัด 31)**

จาก:

```tsx
 * D1.1.5.5 — Petty Cash custodian picker. Lives on the /settings#users
 * tab (OWNER-only). Reads the configured custodian role + currently
```

เป็น:

```tsx
 * D1.1.5.5 — Petty Cash custodian picker. Lives on the /settings#internal-control
 * tab (OWNER-only). Reads the configured custodian role + currently
```

- [ ] **Step 3: ตรวจไม่มี stale อื่นค้าง**

Run: `cd "/d/BESTCHOICE APP/BESTCHOICE" && grep -rn "settings#users" apps/web/src .claude || echo "clean"`
Expected: `clean` (หรือไม่มีผลลัพธ์)

- [ ] **Step 4: Commit**

```bash
git add .claude/rules/accounting.md apps/web/src/pages/SettingsPage/components/PettyCashCustodianCard.tsx
git commit -m "docs(settings): update #users references after consolidation into internal-control"
```

---

## Task 5: Verification รวม

**Files:** ไม่มี (รันตรวจ + commit ปิดงานถ้าจำเป็น)

- [ ] **Step 1: type-check ทั้ง web**

Run: `./tools/check-types.sh web`
Expected: 0 errors

- [ ] **Step 2: รันเทส SettingsPage ทั้งหมด**

Run: `cd apps/web && npx vitest run src/pages/SettingsPage`
Expected: PASS ทั้งหมด (SettingsPage.test.tsx 8, InternalControlTab.test.tsx 2, + เทส tab อื่นที่มีอยู่)

- [ ] **Step 3: smoke ด้วยตา (ถ้ารัน dev ได้)**

เปิด `/settings#internal-control` → เห็น 3 กลุ่ม (การอนุมัติ & สิทธิ์ / เงินสด / ความปลอดภัย) + การ์ดครบ 5. เปิด `/settings#users` → เด้งมาแท็บเดียวกัน, URL กลายเป็น `#internal-control`. เปิด `/users` → เหมือนเดิมเป๊ะ (ไม่มีแท็บที่ 3).

---

## Self-Review (ผู้เขียนแผนตรวจเอง)

**Spec coverage:**
- §4.1 ถอด users tab + alias + rename → Task 2 ✓
- §4.2 InternalControlTab grouped 5 การ์ด → Task 1 ✓
- §4.3 ลบ UsersTab → Task 2 Step 6 ✓
- §4.4 ไม่แตะ /users → ไม่มี task แตะ UsersPage ✓
- §4.5 ไม่แตะเมนู → ไม่มี task แตะ menu.ts ✓
- §5 edge case FM #users → alias internal-control (OWNER-only) → ตกแท็บแรก: logic เดิม `visibleIds.includes` ครอบ (FM ไม่มี internal-control ใน visibleIds → fallback contacts) ✓
- §6 เทส → Task 1,2,3 ✓ §7 docs → Task 4 ✓

**Placeholder scan:** ไม่มี TBD/“handle edge cases”/โค้ดลอย — ทุก step มีโค้ด/คำสั่งจริง ✓

**Type consistency:** ชื่อ export `InternalControlTab` ตรงทุก task; label `'ระบบควบคุม & สิทธิ์'` ตรงระหว่าง Task 2 (index.tsx) กับเทส; section heading `'การอนุมัติ & สิทธิ์' / 'เงินสด' / 'ความปลอดภัย'` ตรงระหว่าง Task 1 impl กับเทส; `resolveHash`/`TAB_ALIASES` นิยามใน Task 2 Step 5 ก่อนใช้ ✓
