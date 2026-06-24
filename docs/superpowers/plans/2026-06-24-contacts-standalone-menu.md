# Contacts — Standalone Menu + Page (P6) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** แยก "สมุดผู้ติดต่อ" ออกจาก settings panel (หมวด "บริษัท & สาขา") ให้เป็นเมนูของตัวเองในโซน "ตั้งค่ากลาง" (เหนือ 8 หมวด) ชี้ไปหน้า `/contacts` ที่มีอยู่แล้ว

**Architecture:** หน้า `/contacts` (`ContactsPage` → `ContactsTab`) มีอยู่แล้ว (App.tsx). งานคือ: (1) gear-zone sidebar เพิ่มกลุ่ม "ข้อมูลหลัก" ที่มี item เดียว "สมุดผู้ติดต่อ → /contacts" ไว้บนสุด (เหนือ section "ตั้งค่าระบบ" ที่เป็น 8 หมวด); (2) เอา `contacts` ออกจาก registry หมวด company (เลิกซ้ำใน panel); (3) เก็บ CommandPalette + redirect + guard ให้ชี้ /contacts. user เลือก placement (ก) = gear zone.

**Tech Stack:** React 18 + TS + Vite + react-router v7 + Tailwind + Vitest

**Confirmed (user, 2026-06-24):** placement (ก) — gear-zone own group, above the 8 categories.

## Global Constraints
- registry = source of truth for the 8 categories; the "ข้อมูลหลัก" contacts group is a deliberate standalone sidebar group (contacts is master-data, not a settings category)
- contacts roles = OWNER/FM/ACC (registry had `roles: ALL` = these 3 gear roles); all gear roles see the contacts group
- `/contacts` page already exists — do NOT rebuild it; just link + guard
- Don't break the 8-category settings sidebar (P5) or other zones
- Commit per task; branch `feat/settings-contacts-standalone` (off main @ 6ee011ad)

## File Structure
- **Modify** `apps/web/src/config/menu.ts` — `buildSettingsZoneSections` returns `[ข้อมูลหลัก(contacts→/contacts), ตั้งค่าระบบ(categories)]`; FM/ACC bottomNav contacts → `/contacts`
- **Modify** `apps/web/src/config/menu.test.ts`
- **Modify** `apps/web/src/config/settings-registry.tsx` — remove `contacts` item from `company` category (+ drop now-unused ContactsTab import)
- **Modify** `apps/web/src/config/__tests__/settings-registry.test.ts`, `apps/web/src/config/__tests__/settings-access.test.ts`
- **Modify** `apps/web/src/components/CommandPalette.tsx` — add `สมุดผู้ติดต่อ → /contacts` page entry (+ test)
- **Modify** `apps/web/src/pages/settings/SettingsIndexRedirect.tsx` — old `#contacts` → `/contacts` (+ test)
- **Modify** `apps/web/src/App.tsx` — guard `/contacts` + `/contacts/:id` with roles OWNER/FM/ACC

---

## Task 1: Gear-zone "ข้อมูลหลัก" group (menu.ts)

**Files:** `apps/web/src/config/menu.ts`, `apps/web/src/config/menu.test.ts`

**Interfaces:** `buildSettingsZoneSections(role)` returns 2 sections for gear roles: `{key:'master-data', label:'ข้อมูลหลัก', icon: BookUser, zone:'settings', items:[{label:'สมุดผู้ติดต่อ', path:'/contacts', icon: BookUser}]}` THEN the existing `{key:'settings', label:'ตั้งค่าระบบ', ...categories}`.

- [ ] **Step 1: test (RED)** — in menu.test.ts add:
```ts
it('OWNER settings zone has ข้อมูลหลัก > สมุดผู้ติดต่อ → /contacts above the categories', () => {
  const secs = getSidebarForRole('OWNER', 'settings');
  expect(secs[0].key).toBe('master-data');
  expect(secs[0].items.map((i) => i.path)).toEqual(['/contacts']);
  expect(secs.some((s) => s.key === 'settings')).toBe(true); // categories still present
});
it('FM/ACC also get the contacts master-data group in settings zone', () => {
  for (const r of ['FINANCE_MANAGER', 'ACCOUNTANT']) {
    const paths = getSidebarForRole(r, 'settings').flatMap((s) => s.items.map((i) => i.path));
    expect(paths).toContain('/contacts');
  }
});
```
Run: `cd apps/web && npx vitest run src/config/menu.test.ts` → FAIL

- [ ] **Step 2: implement** — in `menu.ts`, edit `buildSettingsZoneSections` (BookUser already imported):
```ts
function buildSettingsZoneSections(role: string): MenuSection[] {
  const cats = visibleCategories(role as SettingsRole);
  if (cats.length === 0) return [];
  const masterData: MenuSection = {
    key: 'master-data', label: 'ข้อมูลหลัก', icon: BookUser, zone: 'settings',
    items: [{ label: 'สมุดผู้ติดต่อ', path: '/contacts', icon: BookUser }],
  };
  const settings: MenuSection = {
    key: 'settings', label: 'ตั้งค่าระบบ', icon: Settings, zone: 'settings',
    items: cats.map((c) => ({ label: c.label, path: `/settings/${c.id}`, icon: c.icon })),
  };
  return [masterData, settings];
}
```

- [ ] **Step 3: FM/ACC bottomNav** — change FM + ACC `bottomNav.settings` contacts entry from `path: '/settings/company'` to `path: '/contacts'` (it was set to /settings/company in P5; now contacts has its own page). Keep label "ผู้ติดต่อ" + icon.

- [ ] **Step 4: green + type-check** — `cd apps/web && npx vitest run src/config/menu.test.ts` PASS; `./tools/check-types.sh web` 0. Update any menu.test assertion that expected `secs[0].key === 'settings'` (now master-data is first).

- [ ] **Step 5: commit** — `git add apps/web/src/config/menu.ts apps/web/src/config/menu.test.ts && git commit -m "feat(contacts): add สมุดผู้ติดต่อ as own gear-zone group → /contacts"`

---

## Task 2: Remove contacts from the registry company category

**Files:** `apps/web/src/config/settings-registry.tsx`, `apps/web/src/config/__tests__/settings-registry.test.ts`, `apps/web/src/config/__tests__/settings-access.test.ts`

**Interfaces:** `company` category no longer has a `contacts` item. Consequence: FM/ACC (who only saw `company` via contacts) no longer see the `company` category in the panel — that's intended (company-info/entities/branches are OWNER-only; contacts now standalone).

- [ ] **Step 1: tests (RED)** — update/add:
  - settings-registry.test.ts: if any test asserts a `contacts` item under company, change it to assert contacts is ABSENT from company items.
  - settings-access.test.ts: the existing `'FINANCE_MANAGER ... company (contacts)'` expectation must change — FM no longer sees `company` category (company items are all OWNER-only now). Update to assert `visibleCategories('FINANCE_MANAGER')` does NOT include `company`, and still includes accounting/finance/comms. (Read the current assertions first; adjust to the new reality, don't gut.)
  Run: `cd apps/web && npx vitest run src/config` → FAIL

- [ ] **Step 2: implement** — in `settings-registry.tsx`, delete the `{ id: 'contacts', ... component: ContactsTab ... }` line from the `company` category items. Remove the now-unused `import { ContactsTab } from '@/pages/SettingsPage/tabs/ContactsTab';` (verify ContactsTab isn't referenced elsewhere in the registry — it isn't).

- [ ] **Step 3: green + type-check** — `cd apps/web && npx vitest run src/config` PASS; `./tools/check-types.sh web` 0.

- [ ] **Step 4: commit** — `git add apps/web/src/config/settings-registry.tsx apps/web/src/config/__tests__/ && git commit -m "feat(contacts): remove contacts from settings company category (now standalone)"`

---

## Task 3: CommandPalette entry + hash redirect + route guard

**Files:** `apps/web/src/components/CommandPalette.tsx` (+ test), `apps/web/src/pages/settings/SettingsIndexRedirect.tsx` (+ test), `apps/web/src/App.tsx`

- [ ] **Step 1: CommandPalette test (RED)** — assert "สมุดผู้ติดต่อ" appears as a palette entry with path `/contacts` (OWNER). Run → FAIL (the registry-derived contacts entry is gone now).

- [ ] **Step 2: CommandPalette impl** — add to the base `pages` array (near the `ลูกค้า → /customers` entry, line ~56):
```tsx
{ label: 'สมุดผู้ติดต่อ', path: '/contacts', icon: BookUser, keywords: 'contacts ผู้ติดต่อ ผู้ขาย supplier ไฟแนนซ์', roles: ['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT'] },
```
(import `BookUser` from lucide-react if not already imported in CommandPalette.tsx). Run palette test → PASS.

- [ ] **Step 3: SettingsIndexRedirect test (RED)** — assert old `#contacts` now redirects to `/contacts` (not `/settings/company`). Run → FAIL.

- [ ] **Step 4: SettingsIndexRedirect impl** — read `SettingsIndexRedirect.tsx`. Remove `contacts` from `HASH_TO_CATEGORY` and add a dedicated redirect: in the effect, if `hash === 'contacts'` → `navigate('/contacts', { replace: true })` before the category-mapping logic. (Or add a separate `HASH_TO_PATH: Record<string,string> = { contacts: '/contacts' }` checked first.) Keep the other hash mappings intact. Run test → PASS.

- [ ] **Step 5: App.tsx guard** — wrap the existing `/contacts` and `/contacts/:id` routes (App.tsx ~482-483) with `<ProtectedRoute roles={['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT']}>...</ProtectedRoute>` (they're currently bare). Match the ProtectedRoute usage pattern of adjacent routes.

- [ ] **Step 6: green + type-check** — `cd apps/web && npx vitest run src/components src/pages/settings` PASS; `./tools/check-types.sh web` 0.

- [ ] **Step 7: commit** — `git add apps/web/src/components/CommandPalette.tsx apps/web/src/pages/settings/SettingsIndexRedirect.tsx apps/web/src/App.tsx && git commit -m "feat(contacts): palette entry + #contacts→/contacts redirect + guard /contacts route"`

---

## Task 4: Verification
- [ ] **Step 1:** `./tools/check-types.sh web` → 0
- [ ] **Step 2:** `cd apps/web && npx vitest run src/pages/settings src/config src/components` → green
- [ ] **Step 3:** grep no stale contacts-in-panel ref: `cd "/d/BESTCHOICE APP/BESTCHOICE" && grep -rn "settings/company#contacts\|id: 'contacts'" apps/web/src --include=*.ts --include=*.tsx | grep -v "\.test\."` → expect only acceptable residue (report)
- [ ] **Step 4: smoke (if dev runs):** gear-zone sidebar shows "ข้อมูลหลัก > สมุดผู้ติดต่อ" on top, then 8/subset categories; click → `/contacts` page (not inside panel); `/settings/company` no longer lists contacts; old `/settings#contacts` → `/contacts`; CommandPalette "สมุดผู้ติดต่อ" → /contacts; SALES/BM can't reach /contacts (guard).

---

## Self-Review
**Coverage:** standalone contacts group in gear zone → Task 1; removed from panel category → Task 2; palette + redirect + guard → Task 3.
**Placeholder scan:** all steps have concrete code/targets. Test-update steps say "read current, adjust to new reality, don't gut".
**Type consistency:** `buildSettingsZoneSections` returns `MenuSection[]`; master-data section shape matches; BookUser icon reused; contacts roles OWNER/FM/ACC consistent across menu/palette/guard.

## Notes
- After removing contacts, FM/ACC no longer see the `company` category in the settings panel (its remaining items are OWNER-only) — intended; contacts is reached via the new ข้อมูลหลัก group + /contacts page + palette.
- `/contacts` page (ContactsPage→ContactsTab) unchanged.
