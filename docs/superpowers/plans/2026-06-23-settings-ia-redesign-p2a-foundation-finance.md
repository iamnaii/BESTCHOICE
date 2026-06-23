# Settings IA Redesign — P2a (Outlet Foundation + Finance migration) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** เปลี่ยน settings panel ให้ render หน้า config "ใต้ layout" ผ่าน react-router `<Outlet>` แล้วย้ายหมวด **finance** (ดอกเบี้ย/GFIN/ช่องทางชำระเงิน) เป็น URL ใหม่ `/settings/finance/<item>` + redirect ของเก่า — เป็น proof ของ pattern ที่หมวดอื่นจะตามใน P2b

**Architecture:** P1 สร้าง panel ที่ render `<CategoryPage>` ตรงๆ. P2a เปลี่ยน `SettingsLayout` ให้ render `<Outlet>` แล้วผูก nested routes: `index → SettingsCategoryRoute` (หน้าหมวด) และ `:itemId → SettingsItemRoute` (หน้า config เต็มใน panel). route-item ใน registry เปลี่ยน `kind:'external'`→`'route'` + ใส่ `component` (หน้าเดิม) + path ใหม่. หน้า config ที่มีแท็บ/sub-nav ของตัวเอง (เช่น document-config) คงเป็น `external` เต็มจอ (P2b). ทั้งหมด registry-driven ไม่ duplicate route ต่อหน้า

**Tech Stack:** React 18 + TS + Vite + react-router v7 + Tailwind + Vitest

**Spec:** `docs/superpowers/specs/2026-06-23-settings-ia-redesign-design.md` (§4.3 routes, §5 mapping, structural fix: complex pages → external)
**Builds on:** P1 (PR #1286) — `settings-registry`, `settings-access`, `SettingsLayout`, `CategoryPage`, `SettingsIndexRedirect`

## Global Constraints

- Design-token semantic classes only (no hardcoded hex/`text-gray-*`/`bg-white`); functional components + hooks; Thai uses `leading-snug`
- Registry = single source of truth; role guard derives from registry (`item.roles`)
- **ห้ามแตะ internals** ของหน้า config ที่ย้าย (InterestConfigPage, GfinConfigPage, PaymentMethodSettingsPage) — แค่ผูก route ใหม่ + redirect
- หน้า config ที่มีแท็บ/sub-nav ของตัวเอง → `kind:'external'` เปิดเต็มจอ (ไม่ฝังใน Outlet) — finance ทั้ง 3 หน้าเป็นหน้าเดี่ยว เหมาะกับ `kind:'route'`
- กัน URL เก่าพัง: redirect ทุก path เดิม + **แก้ internal links** ที่ชี้ path เก่า (ไม่พึ่ง redirect อย่างเดียว)
- `/settings` + ลูกทั้งหมด guard `['OWNER','FINANCE_MANAGER','ACCOUNTANT']` (P1) — `SettingsItemRoute` กรองเพิ่มตาม `item.roles`
- Commit ทีละ task; branch จะ stack ต่อจาก P1 (`feat/settings-ia-redesign`) หรือ branch ใหม่หลัง P1 merge

---

## File Structure

- **Modify** `apps/web/src/pages/settings/SettingsLayout.tsx` — content area `<CategoryPage>` → `<Outlet/>`
- **Create** `apps/web/src/pages/settings/SettingsCategoryRoute.tsx` — index child: อ่าน `:categoryId` → `<CategoryPage categoryId>`
- **Create** `apps/web/src/pages/settings/SettingsItemRoute.tsx` — `:itemId` child: อ่าน `:categoryId/:itemId` → render `item.component` (kind route) + role guard
- **Modify** `apps/web/src/config/settings-access.ts` — add `findItem(categoryId, itemId)`
- **Modify** `apps/web/src/pages/settings/CategoryPage.tsx` — route-item → internal link `/settings/<cat>/<item>` (รับ categoryId เข้า ItemSection)
- **Modify** `apps/web/src/config/settings-registry.tsx` — finance 3 items → `kind:'route'` + `component` + new path
- **Modify** `apps/web/src/App.tsx` — nested routes under `/settings/:categoryId`; replace finance old routes with redirects
- **Modify** `apps/web/src/config/menu.ts` — GFIN link → new path
- **Modify** `apps/web/src/pages/SettingsPage/components/SystemSettings.tsx` — interest link → new path (IF still rendered; verify)

---

## Task 1: Outlet foundation + migrate finance/interest (proof)

**Files:**
- Modify: `apps/web/src/pages/settings/SettingsLayout.tsx`
- Create: `apps/web/src/pages/settings/SettingsCategoryRoute.tsx`, `apps/web/src/pages/settings/SettingsItemRoute.tsx`
- Modify: `apps/web/src/config/settings-access.ts`, `apps/web/src/config/settings-registry.tsx`, `apps/web/src/pages/settings/CategoryPage.tsx`, `apps/web/src/App.tsx`, `apps/web/src/pages/SettingsPage/components/SystemSettings.tsx`
- Test: `apps/web/src/pages/settings/__tests__/SettingsItemRoute.test.tsx`, update `apps/web/src/config/__tests__/settings-access.test.ts`

**Interfaces:**
- Consumes (P1): `categoryById`, `visibleItems`, `CategoryPage({categoryId})`, registry types
- Produces:
  - `findItem(categoryId, itemId): { category: SettingsCategory; item: SettingsItem } | undefined`
  - `SettingsCategoryRoute()` (reads `:categoryId`)
  - `SettingsItemRoute()` (reads `:categoryId`,`:itemId`; renders `item.component` for kind `route`; else `<Navigate to="/settings/:categoryId" replace>`)

- [ ] **Step 1: เพิ่ม `findItem` helper + test (RED)**

ใน `apps/web/src/config/__tests__/settings-access.test.ts` เพิ่ม import `findItem` และ test:

```ts
  it('findItem คืน category+item ที่ถูกต้อง', () => {
    const r = findItem('finance', 'interest');
    expect(r?.item.id).toBe('interest');
    expect(r?.category.id).toBe('finance');
    expect(findItem('finance', 'nope')).toBeUndefined();
    expect(findItem('nope', 'interest')).toBeUndefined();
  });
```

Run: `cd apps/web && npx vitest run src/config/__tests__/settings-access.test.ts`
Expected: FAIL — `findItem is not a function`

- [ ] **Step 2: implement `findItem` (GREEN)**

ต่อท้าย `apps/web/src/config/settings-access.ts`:

```ts
export function findItem(
  categoryId: string,
  itemId: string,
): { category: SettingsCategory; item: SettingsItem } | undefined {
  const category = categoryById(categoryId);
  const item = category?.items.find((i) => i.id === itemId);
  return category && item ? { category, item } : undefined;
}
```

Run: `cd apps/web && npx vitest run src/config/__tests__/settings-access.test.ts`
Expected: PASS

- [ ] **Step 3: migrate finance items in registry → `kind:'route'` + component + new path**

ใน `apps/web/src/config/settings-registry.tsx` เพิ่ม imports (ใกล้ imports อื่น):

```tsx
import InterestConfigPage from '@/pages/InterestConfigPage';
import GfinConfigPage from '@/pages/GfinConfigPage';
import PaymentMethodSettingsPage from '@/pages/PaymentMethodSettingsPage';
```

แทน 3 รายการ finance (เดิม kind:'external') ด้วย:

```tsx
      { id: 'interest', label: 'ดอกเบี้ย', roles: ['OWNER'], kind: 'route', component: InterestConfigPage, path: '/settings/finance/interest' },
      { id: 'gfin', label: 'GFIN', roles: ['OWNER'], kind: 'route', component: GfinConfigPage, path: '/settings/finance/gfin' },
      { id: 'payment-methods', label: 'ช่องทางชำระเงิน', roles: ['OWNER', 'FINANCE_MANAGER'], kind: 'route', component: PaymentMethodSettingsPage, path: '/settings/finance/payment-methods' },
```

> Note: `component` field already typed `ComponentType` (P1). `path` for kind:'route' is the NEW canonical path.

- [ ] **Step 4: CategoryPage — route-items link to new path (pass categoryId into ItemSection)**

แก้ `apps/web/src/pages/settings/CategoryPage.tsx`. เปลี่ยน `ItemSection` ให้รับ `categoryId` และแยก kind `route`:

```tsx
function ItemSection({ item, categoryId }: { item: SettingsItem; categoryId: string }) {
  if (item.kind === 'inline' && item.component) {
    const C = item.component;
    return (
      <div id={item.id} className="scroll-mt-20">
        <C />
      </div>
    );
  }
  const to = item.kind === 'route' ? `/settings/${categoryId}/${item.id}` : (item.path ?? '#');
  return (
    <Link
      to={to}
      className="flex items-center justify-between rounded-xl border border-border/60 bg-card p-4 hover:bg-accent transition-colors"
    >
      <span className="text-sm font-medium text-foreground leading-snug">{item.label}</span>
      <ChevronRight className="size-4 text-muted-foreground" />
    </Link>
  );
}
```

และตรงที่ render เปลี่ยนเป็นส่ง categoryId:

```tsx
          {g.items.map((item) => (
            <ItemSection key={item.id} item={item} categoryId={cat.id} />
          ))}
```

> CategoryPage.test.tsx เดิมยังผ่าน (system หมวดไม่มี route-item; external ยังลิงก์ path เดิม). ไม่ต้องแก้เทสนั้น.

- [ ] **Step 5: SettingsLayout → `<Outlet/>`**

ใน `apps/web/src/pages/settings/SettingsLayout.tsx`:
- เปลี่ยน import `import { useParams, useNavigate, Link } from 'react-router';` → เพิ่ม `Outlet`: `import { useParams, useNavigate, Link, Outlet } from 'react-router';`
- ลบ import `import { CategoryPage } from './CategoryPage';`
- แทน `<CategoryPage categoryId={categoryId} />` **ทั้ง 2 ที่** (mobile branch + desktop branch) ด้วย `<Outlet />`

- [ ] **Step 6: SettingsCategoryRoute + SettingsItemRoute (with test, RED→GREEN)**

สร้างเทส `apps/web/src/pages/settings/__tests__/SettingsItemRoute.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router';
import { SettingsItemRoute } from '../SettingsItemRoute';

let role = 'OWNER';
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { role } }) }));
vi.mock('@/pages/InterestConfigPage', () => ({ default: () => <div>interest-page</div> }));

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/settings/:categoryId/:itemId" element={<SettingsItemRoute />} />
        <Route path="/settings/:categoryId" element={<div>category-fallback</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('SettingsItemRoute', () => {
  it('render component ของ route-item (interest)', () => {
    role = 'OWNER';
    renderAt('/settings/finance/interest');
    expect(screen.getByText('interest-page')).toBeTruthy();
  });

  it('role ไม่มีสิทธิ์ → redirect ไปหน้าหมวด', () => {
    role = 'FINANCE_MANAGER'; // interest = OWNER-only
    renderAt('/settings/finance/interest');
    expect(screen.getByText('category-fallback')).toBeTruthy();
  });

  it('item ไม่รู้จัก → redirect ไปหน้าหมวด', () => {
    role = 'OWNER';
    renderAt('/settings/finance/nope');
    expect(screen.getByText('category-fallback')).toBeTruthy();
  });
});
```

Run: `cd apps/web && npx vitest run src/pages/settings/__tests__/SettingsItemRoute.test.tsx`
Expected: FAIL — module not found

สร้าง `apps/web/src/pages/settings/SettingsCategoryRoute.tsx`:

```tsx
import { useParams } from 'react-router';
import { CategoryPage } from './CategoryPage';

export function SettingsCategoryRoute() {
  const { categoryId = '' } = useParams<{ categoryId: string }>();
  return <CategoryPage categoryId={categoryId} />;
}
```

สร้าง `apps/web/src/pages/settings/SettingsItemRoute.tsx`:

```tsx
import { useParams, Navigate } from 'react-router';
import { useAuth } from '@/contexts/AuthContext';
import { findItem } from '@/config/settings-access';
import type { SettingsRole } from '@/config/settings-registry';

export function SettingsItemRoute() {
  const { user } = useAuth();
  const role = (user?.role ?? '') as SettingsRole;
  const { categoryId = '', itemId = '' } = useParams<{ categoryId: string; itemId: string }>();
  const found = findItem(categoryId, itemId);

  // ไม่พบ / ไม่ใช่ route / ไม่มี component / role ไม่ถึง → กลับหน้าหมวด
  if (!found || found.item.kind !== 'route' || !found.item.component || !found.item.roles.includes(role)) {
    return <Navigate to={`/settings/${categoryId}`} replace />;
  }
  const C = found.item.component;
  return <C />;
}
```

Run: `cd apps/web && npx vitest run src/pages/settings/__tests__/SettingsItemRoute.test.tsx`
Expected: PASS (3 tests)

- [ ] **Step 7: App.tsx — nested routes + finance redirects + remove old finance routes**

ใน `apps/web/src/App.tsx`:

(a) เพิ่ม lazy imports ของ 2 route components (ใกล้ของ P1):

```tsx
const SettingsCategoryRoute = lazy(() =>
  import('@/pages/settings/SettingsCategoryRoute').then((m) => ({ default: m.SettingsCategoryRoute })),
);
const SettingsItemRoute = lazy(() =>
  import('@/pages/settings/SettingsItemRoute').then((m) => ({ default: m.SettingsItemRoute })),
);
```

(b) เปลี่ยน route `/settings/:categoryId` (P1) ให้มี children:

```tsx
          <Route
            path="/settings/:categoryId"
            element={
              <ProtectedRoute roles={['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT']}>
                <SettingsLayout />
              </ProtectedRoute>
            }
          >
            <Route index element={<SettingsCategoryRoute />} />
            <Route path=":itemId" element={<SettingsItemRoute />} />
          </Route>
```

(c) แทน route เดิม 3 อันด้วย redirect (เก็บ `<Navigate>` — path ล้วน ไม่มี hash):
- `/settings/interest-config` (App.tsx ~784) → `<Navigate to="/settings/finance/interest" replace />`
- `/settings/gfin-rates` (~800) → `<Navigate to="/settings/finance/gfin" replace />`
- `/settings/payment-methods` (~479) → `<Navigate to="/settings/finance/payment-methods" replace />`

ตัวอย่าง (interest):

```tsx
          <Route path="/settings/interest-config" element={<Navigate to="/settings/finance/interest" replace />} />
```

> ลบ element เดิม (`<ProtectedRoute>...<InterestConfigPage/>...`) ออก. lazy import ของ 3 หน้านี้ยังคงไว้ (registry ใช้ผ่าน SettingsItemRoute) — จริงๆ registry import เองแล้ว ดังนั้น lazy import เดิมใน App.tsx ของ 3 หน้านี้ที่ไม่ถูกใช้แล้วให้ลบ (verify ไม่มี reference อื่น). ตรวจ: `InterestConfigPage`, `GfinConfigPage`, `PaymentMethodSettingsPage` — ถ้า App.tsx ไม่อ้างแล้ว ลบ lazy import 3 บรรทัด (App.tsx:64,85,219).

- [ ] **Step 8: แก้ internal links → path ใหม่**

(a) `apps/web/src/config/menu.ts:747`:
```tsx
        { label: 'ตั้งค่า GFIN', path: '/settings/finance/gfin', icon: Calculator },
```

(b) `apps/web/src/pages/SettingsPage/components/SystemSettings.tsx:173` — **verify ก่อน**ว่า SystemSettings ยังถูก render ที่ไหน (old hub ถูกลบใน P1): `grep -rn "SystemSettings" apps/web/src`. ถ้ายังถูกใช้ → เปลี่ยน `navigate('/settings/interest-config')` เป็น `navigate('/settings/finance/interest')`. ถ้าเป็น dead code (ไม่มีผู้ render) → ปล่อยไว้ + บันทึกใน report ว่าเป็น dead (P4 จะลบ).

- [ ] **Step 9: routing test (RED→GREEN) — finance ผ่าน panel + redirect**

สร้าง `apps/web/src/pages/settings/__tests__/finance-migration.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route, Navigate } from 'react-router';
import { SettingsLayout } from '../SettingsLayout';
import { SettingsCategoryRoute } from '../SettingsCategoryRoute';
import { SettingsItemRoute } from '../SettingsItemRoute';

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { role: 'OWNER' } }) }));
vi.mock('@/hooks/useIsMobile', () => ({ useIsMobile: () => false }));
vi.mock('@/pages/InterestConfigPage', () => ({ default: () => <div>interest-page</div> }));
vi.mock('@/pages/GfinConfigPage', () => ({ default: () => <div>gfin-page</div> }));
vi.mock('@/pages/PaymentMethodSettingsPage', () => ({ default: () => <div>payment-page</div> }));

function App({ entry }: { entry: string }) {
  return (
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/settings/interest-config" element={<Navigate to="/settings/finance/interest" replace />} />
        <Route path="/settings/:categoryId" element={<SettingsLayout />}>
          <Route index element={<SettingsCategoryRoute />} />
          <Route path=":itemId" element={<SettingsItemRoute />} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

describe('finance migration', () => {
  it('/settings/finance/interest → render หน้า interest ใน panel (มี nav ข้างซ้าย)', () => {
    render(<App entry="/settings/finance/interest" />);
    expect(screen.getByText('interest-page')).toBeTruthy();
    // panel nav ยังอยู่ (link หมวด finance)
    expect(screen.getByRole('link', { name: /การเงิน/ })).toBeTruthy();
  });

  it('old /settings/interest-config → redirect ไป /settings/finance/interest', async () => {
    render(<App entry="/settings/interest-config" />);
    await waitFor(() => expect(screen.getByText('interest-page')).toBeTruthy());
  });
});
```

Run: `cd apps/web && npx vitest run src/pages/settings/__tests__/finance-migration.test.tsx`
Expected: PASS (2 tests)

- [ ] **Step 10: type-check + commit**

Run: `./tools/check-types.sh web`
Expected: 0 errors

```bash
git add apps/web/src/pages/settings/ apps/web/src/config/ apps/web/src/App.tsx apps/web/src/config/menu.ts apps/web/src/pages/SettingsPage/components/SystemSettings.tsx
git commit -m "feat(settings): P2a Outlet foundation + migrate finance category to /settings/finance/*"
```

---

## Task 2: Verification (finance fully in-panel + no regressions)

**Files:** ไม่มี (รันตรวจ)

- [ ] **Step 1: type-check ทั้ง web**

Run: `./tools/check-types.sh web`
Expected: 0 errors

- [ ] **Step 2: settings + config tests**

Run: `cd apps/web && npx vitest run src/pages/settings src/config`
Expected: PASS ทั้งหมด (รวม SettingsItemRoute 3, finance-migration 2, settings-access +1)

- [ ] **Step 3: grep ยืนยันไม่มี internal link ชี้ finance path เก่า (นอกจาก redirect/comment)**

Run: `cd "/d/BESTCHOICE APP/BESTCHOICE" && grep -rn "settings/interest-config\|settings/gfin-rates\|settings/payment-methods" apps/web/src --include=*.ts --include=*.tsx | grep -v "Navigate to" | grep -vi "//"`
Expected: ไม่มีผลลัพธ์ (หรือมีแต่ comment ที่ยอมรับได้ — รายงานสิ่งที่เจอ)

- [ ] **Step 4: smoke ด้วยตา (ถ้ารัน dev ได้)**

`/settings/finance` → เห็นการ์ด 3 ลิงก์ (ดอกเบี้ย/GFIN/ช่องทางชำระเงิน). คลิก "ดอกเบี้ย" → URL `/settings/finance/interest`, หน้า InterestConfig render **ในpanel** (nav ซ้ายยังอยู่). เปิด `/settings/interest-config` (bookmark เก่า) → เด้งไป `/settings/finance/interest`.

---

## Self-Review (ผู้เขียนแผนตรวจเอง)

**Spec coverage (P2a ส่วน):**
- §4.3 `/settings/:categoryId/:itemId` → SettingsLayout + Outlet → Task 1 Step 5-7 ✓
- §5 finance items → kind:'route' + new path → Task 1 Step 3 ✓; redirect เก่า → Step 7c ✓
- structural fix (route-item ใน panel ผ่าน Outlet; หน้ามีแท็บ→external) → finance เป็นหน้าเดี่ยว เหมาะ route ✓ (document-config ฯลฯ ยัง external — P2b)
- internal-link update (ไม่พึ่ง redirect) → Step 8 ✓
- role guard ระดับ item → SettingsItemRoute ✓

**Placeholder scan:** Step 8b มีเงื่อนไข "verify ว่า SystemSettings ยัง render ไหม" — เป็น verify step ที่มีคำสั่ง grep + การกระทำชัดทั้ง 2 ทาง (live→แก้ link; dead→บันทึก) ไม่ใช่ placeholder ✓ ไม่มี TBD อื่น

**Type consistency:** `findItem` signature (access.ts) ตรงกับที่ SettingsItemRoute เรียก; `SettingsCategoryRoute`/`SettingsItemRoute` named exports ตรงกับ lazy import ใน App.tsx; `CategoryPage({categoryId})` prop เดิมคงไว้ (SettingsCategoryRoute ส่งให้); registry route-item มี `component` (ComponentType, P1 type) + `path` ✓

## Out of scope (P2b — แผนแยกถัดไป, pattern เดียวกัน)
- ย้ายหมวดที่เหลือทีละหมวด: accounting (chart/peak-sync/e-tax — document-config คง external เพราะ 9 แท็บ), products (pricing/stickers + promotions/contract-templates คง external operational), comms (line-oa/rich-menu/greeting/sms/channels/dunning/collections), ai (5 หน้า — ตรวจหน้าที่มีแท็บใน → external), company (entities), access (account-roles), system (integrations/mdm)
- operational external (users/branches/promotions/contract-templates/audit-logs/system-status) — คง path เดิม (spec §5)
- scroll-to-section wiring (carry จาก P1) — ทำพร้อม P2b หรือ P3
- P3 sidebar collapse + CommandPalette index · P4 dedup PDPA / ลบ doc-config dup / เลิก general
