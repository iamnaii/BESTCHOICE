# Settings — Sidebar-Driven Navigation (P5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** ทำให้ navigation ของ settings เป็น "ชุดเดียว" — sidebar (gear zone) แสดง 8 หมวดจาก settings-registry แทนรายการแบนๆ เดิม, และ panel เอา sub-nav ซ้ายออก (เหลือ content + search; มือถือคง dropdown). คลิกหมวดใน sidebar → `/settings/<cat>` → panel โชว์เนื้อหาหมวดนั้น

**Architecture:** sidebar gear-zone เดิม render `MenuSection[]` ที่ `zone:'settings'` (static ใน menu.ts). เปลี่ยนเป็น registry-driven: `getSidebarForRole(role,'settings')` คืน section เดียว "ตั้งค่าระบบ" ที่ items = `visibleCategories(role)` → `{label, path:/settings/<cat.id>, icon: cat.icon}`. Panel (`SettingsLayout`) ตัด sub-nav ซ้ายเดสก์ท็อปออก. ทำให้ navigation ไม่ซ้อน 2 ชั้น และขับด้วย registry เดียวกับ panel

**Tech Stack:** React 18 + TS + Vite + react-router v7 + Tailwind + Vitest

**Confirmed design (user, 2026-06-24):** sidebar = 8 categories (registry) · panel drops left sub-nav · operational reached via category → panel (accepted 2-click trade-off)

## Global Constraints
- Design tokens; functional+hooks; registry (`@/config/settings-registry` + `@/config/settings-access`) = source of truth
- Role filtering via `visibleCategories(role)` (handles OWNER/FM/ACC automatically); roles without settings gear → empty
- `/settings/*` (any depth) must resolve to the `settings` zone so the gear stays active + correct category highlights
- Don't break other zones (shop/fin) or non-settings sidebar sections
- Commit per task; branch `feat/settings-sidebar-driven-nav` (off main @ 11175ae9)

---

## File Structure
- **Modify** `apps/web/src/config/menu.ts` — registry-driven settings-zone section (helper + `getSidebarForRole` + `resolveZoneForPath`); remove now-dead static `zone:'settings'` sections from role configs
- **Modify** `apps/web/src/config/menu.test.ts` — assert settings zone = registry categories
- **Modify** `apps/web/src/components/layout/Sidebar.tsx` — ensure category link active-state uses prefix match for `/settings/<cat>`
- **Modify** `apps/web/src/pages/settings/SettingsLayout.tsx` — remove desktop left sub-nav (keep header + search + Outlet); keep mobile dropdown
- **Modify** `apps/web/src/pages/settings/CategoryPage.tsx` — add category-label heading (orientation, since sidebar drives selection)
- Tests: `SettingsLayout.test.tsx`, `CategoryPage.test.tsx`, `menu.test.ts`

---

## Task 1: Registry-driven settings-zone sidebar (menu.ts)

**Files:** Modify `apps/web/src/config/menu.ts`, `apps/web/src/config/menu.test.ts`

**Interfaces:**
- Consumes: `visibleCategories` (`@/config/settings-access`), `settingsRegistry` types, `Settings` icon
- Produces: `getSidebarForRole(role,'settings')` returns ONE section `{ key:'settings', label:'ตั้งค่าระบบ', icon: Settings, zone:'settings', items:[{label, path:'/settings/<catId>', icon: cat.icon}] }` per role; `resolveZoneForPath` returns `'settings'` for any `/settings*` path (gear roles)

- [ ] **Step 1: test (RED)** — in `menu.test.ts` add:
```ts
import { getSidebarForRole, resolveZoneForPath } from './menu';
// ...
it('OWNER settings zone = registry categories (8), as links to /settings/<cat>', () => {
  const secs = getSidebarForRole('OWNER', 'settings');
  const paths = secs.flatMap((s) => s.items.map((i) => i.path));
  expect(paths).toContain('/settings/company');
  expect(paths).toContain('/settings/system');
  expect(paths.every((p) => p.startsWith('/settings/'))).toBe(true);
  expect(paths).not.toContain('/users');      // operational no longer a sidebar quick-link
  expect(paths).not.toContain('/settings');   // bare panel root not listed; categories are
});
it('FINANCE_MANAGER settings zone = its visible categories (subset, no AI)', () => {
  const paths = getSidebarForRole('FINANCE_MANAGER', 'settings').flatMap((s) => s.items.map((i) => i.path));
  expect(paths).toContain('/settings/company');     // contacts
  expect(paths).not.toContain('/settings/ai');      // OWNER-only
});
it('resolveZoneForPath maps any /settings/* to settings zone (OWNER)', () => {
  expect(resolveZoneForPath('OWNER', '/settings/accounting')).toBe('settings');
  expect(resolveZoneForPath('OWNER', '/settings/accounting/chart')).toBe('settings');
});
```
Run: `cd apps/web && npx vitest run src/config/menu.test.ts` → FAIL

- [ ] **Step 2: helper + getSidebarForRole** — in `menu.ts`, add imports `import { visibleCategories } from './settings-access';` and `import type { SettingsRole } from './settings-registry';` (Settings icon already imported). Add helper near getSidebarForRole:
```ts
function buildSettingsZoneSections(role: string): MenuSection[] {
  const cats = visibleCategories(role as SettingsRole);
  if (cats.length === 0) return [];
  return [{
    key: 'settings',
    label: 'ตั้งค่าระบบ',
    icon: Settings,
    zone: 'settings',
    items: cats.map((c) => ({ label: c.label, path: `/settings/${c.id}`, icon: c.icon })),
  }];
}
```
Change the settings branch of `getSidebarForRole`:
```ts
  if (currentZone === 'settings') {
    return config.showSettingsGear ? buildSettingsZoneSections(role) : [];
  }
```

- [ ] **Step 3: resolveZoneForPath** — make `/settings*` resolve to settings zone. At the top of `resolveZoneForPath`, before the loop:
```ts
  if (path === '/settings' || path.startsWith('/settings/') || path.startsWith('/settings#')) {
    const cfg = ZONE_CONFIG[role];
    if (cfg?.showSettingsGear) return 'settings';
  }
```
(keeps the existing loop for non-settings paths)

- [ ] **Step 4: remove dead static settings sections** — in each role config (`OWNER_CONFIG`, `FINANCE_MANAGER_CONFIG`, `ACCOUNTANT_CONFIG`, others) delete the `MenuSection` objects with `zone: 'settings'` (they're no longer rendered — `getSidebarForRole` computes them). Verify by grep that no other code reads those specific section keys. KEEP non-settings sections untouched. (If a settings section also contained a `#contacts` deep-link relied on elsewhere, it's now covered by the company category — confirm contacts reachable via `/settings/company`.)

- [ ] **Step 5: green + type-check** — `cd apps/web && npx vitest run src/config/menu.test.ts` PASS; `./tools/check-types.sh web` 0 errors. Fix any menu.test assertions that referenced removed static settings paths (update to the registry-driven expectations).

- [ ] **Step 6: commit** — `git add apps/web/src/config/menu.ts apps/web/src/config/menu.test.ts && git commit -m "feat(settings): registry-driven settings-zone sidebar (8 categories replace flat list)"`

---

## Task 2: Sidebar category active-state (prefix match)

**Files:** Modify `apps/web/src/components/layout/Sidebar.tsx` (only if needed); Test via existing sidebar e2e/unit if present

- [ ] **Step 1: read `isItemActive` in Sidebar.tsx** — determine if it exact-matches or prefix-matches `item.path` against the current pathname. The category links are `/settings/<cat>`; when on `/settings/<cat>/<item>` or `/settings/<cat>#x`, the category link should still show active.

- [ ] **Step 2: if exact-only, add prefix handling for settings categories** — make a `/settings/<cat>` item active when `pathname === item.path || pathname.startsWith(item.path + '/')`. Keep existing behavior for non-settings items (don't broaden globally — scope the prefix rule to paths starting `/settings/`). Example guard inside `isItemActive`:
```ts
// settings category links: active on the category root and any of its item sub-routes
if (path.startsWith('/settings/')) {
  return pathname === path || pathname.startsWith(path + '/');
}
```
(place before the existing exact-match return; verify `pathname` source in the function)

- [ ] **Step 3: verify** — `./tools/check-types.sh web` 0 errors. If a Sidebar unit test exists, run it; else note manual smoke (active highlight on /settings/accounting and /settings/accounting/chart).

- [ ] **Step 4: commit** — `git add apps/web/src/components/layout/Sidebar.tsx && git commit -m "fix(settings): sidebar category link active on its sub-routes (prefix match)"`

> If `isItemActive` already prefix-matches correctly, skip Steps 2/4 and note "no change needed" in the report.

---

## Task 3: Panel — drop desktop sub-nav + category heading

**Files:** Modify `apps/web/src/pages/settings/SettingsLayout.tsx`, `apps/web/src/pages/settings/CategoryPage.tsx`; Tests `SettingsLayout.test.tsx`, `CategoryPage.test.tsx`

**Interfaces:** Consumes existing layout/page. Produces: desktop SettingsLayout = header + search + `<Outlet/>` (NO left category nav); mobile = header + search + `<select>` dropdown + `<Outlet/>`. CategoryPage renders the category label as an `<h2>` heading.

- [ ] **Step 1: tests (RED)** —
  - `SettingsLayout.test.tsx`: change/add a desktop test asserting the left category `<nav>` is GONE (e.g. the category nav links are not rendered on desktop) while the search input + Outlet content still render. Keep the mobile test asserting the `<select>` exists.
  - `CategoryPage.test.tsx`: add a test asserting the category label heading renders (e.g. `getByRole('heading', { name: 'ระบบ & ความปลอดภัย' })` for `system`).
  Run both → FAIL.

- [ ] **Step 2: SettingsLayout** — remove the desktop left `<nav>` block (the category list). Desktop branch becomes: `<div>{search}{<Outlet/>}</div>` (full-width content). Keep the mobile branch (`useIsMobile`) with the `<select>` dropdown + `<Outlet/>`. Remove now-unused imports (e.g. category `Link` mapping, `visibleItems` count if only used there — verify). Keep `searchSettings` + search box. Keep `visibleCategories` only if still used (mobile select uses it — keep for mobile).

- [ ] **Step 3: CategoryPage heading** — at the top of the rendered output (inside the existing return, before the groups), add:
```tsx
<h2 className="text-lg font-semibold text-foreground leading-snug mb-4">{cat.label}</h2>
```
(`cat` is already resolved; this gives orientation now that the sidebar drives selection)

- [ ] **Step 4: green + type-check** — run both test files + `cd apps/web && npx vitest run src/pages/settings` (green) + `./tools/check-types.sh web` (0).

- [ ] **Step 5: commit** — `git add apps/web/src/pages/settings/ && git commit -m "feat(settings): panel drops desktop sub-nav (sidebar drives categories) + category heading"`

---

## Task 4: Verification
- [ ] **Step 1:** `./tools/check-types.sh web` → 0
- [ ] **Step 2:** `cd apps/web && npx vitest run src/pages/settings src/config src/components` → green
- [ ] **Step 3: smoke (if dev runs):** gear-zone sidebar shows 8 categories (OWNER) / subset (FM/ACC); click "บัญชี & ภาษี" → `/settings/accounting`, sidebar highlights it, panel shows content WITHOUT its own left nav; `/settings/accounting/chart` keeps sidebar highlight; mobile (narrow) → panel dropdown works; CommandPalette search still jumps; `/settings/company` shows contacts.

---

## Self-Review
**Coverage:** sidebar = 8 categories (registry-driven, role-filtered) → Task 1; active-state on sub-routes → Task 2; panel sub-nav removed + heading → Task 3; zone resolution for /settings/* → Task 1 Step 3.
**Placeholder scan:** helper code + getSidebarForRole/resolveZoneForPath edits + SettingsLayout/CategoryPage edits all concrete. Task 2 conditional (skip if isItemActive already prefix) is a verify-with-action, not a placeholder.
**Type consistency:** `buildSettingsZoneSections(role): MenuSection[]`; uses `visibleCategories(role as SettingsRole)`; category items `{label,path,icon}` match `MenuItem`.

## Notes / trade-offs (user-accepted)
- operational pages (/users, /branches, /promotions, /contract-templates) now reached via category → panel link (2-click) instead of sidebar quick-link. User confirmed the unified-nav preference over quick-access.
- Mobile keeps the panel's `<select>` dropdown (sidebar is a drawer on mobile).
- CommandPalette still indexes all settings (global search/jump) — unchanged.
