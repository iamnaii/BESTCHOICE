# Settings IA Redesign — P3 (Sidebar/CommandPalette/Scroll) + P4 (Cleanup) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ปิดงานรื้อ IA `/settings` — P3: ยุบ sidebar config เหลือ "ตั้งค่าระบบ" 1 entry + คง operational เป็นกลุ่ม "จัดการ", index settings เข้า CommandPalette, wire scroll-to-section. P4: cleanup (ลบ dead code, ลบ route ซ้ำ, แยก label PDPA ให้ชัด, เก็บ stale links/comments, อัปเดต docs)

**Architecture:** ทั้งหมดต่อยอด panel ที่ merge แล้ว (P1/P2a/P2b บน main). P3 เป็นงาน UX/navigation; P4 เป็นงาน cleanup. ทำเรียงลำดับ (หลาย task แตะ menu.ts/App.tsx ร่วมกัน)

**Tech Stack:** React 18 + TS + Vite + react-router v7 + Tailwind + Vitest

**Spec:** `docs/superpowers/specs/2026-06-23-settings-ia-redesign-design.md` (§8 sidebar, §7 fixes, out-of-scope P3/P4)

## Global Constraints

- Design-token classes only; functional components + hooks; Thai `leading-snug`
- Registry = source of truth; role guard via existing SettingsItemRoute
- **PDPA ไม่ใช่ dup** — `/pdpa` (consent/DSAR, OWNER+BM) ≠ settings `pdpa` item (encryption/strict, OWNER). **ห้าม merge** — แค่แยก label ให้ชัด
- operational pages คง path เดิม (users/branches/promotions/contract-templates/audit-logs/pdpa)
- Commit ทีละ task; branch `feat/settings-ia-redesign-p3p4` (off main)

---

## File Structure
- **Modify** `apps/web/src/config/menu.ts` — ยุบ config sidebar items, เพิ่มกลุ่ม "จัดการ", disambiguate PDPA label
- **Modify** `apps/web/src/config/menu.test.ts` — อัปเดต assertions
- **Modify** `apps/web/src/pages/settings/CategoryPage.tsx` — scroll-to-section useEffect
- **Modify** `apps/web/src/components/CommandPalette.tsx` — index settings registry items
- **Delete** `apps/web/src/pages/SettingsPage/components/SystemSettings.tsx` (dead) + its test if any
- **Modify** `apps/web/src/App.tsx` — ลบ document-config dup route (lines ~1271-1282)
- **Modify** stale links/comments: `PeakExportPage.tsx:135`, `AccountRolesPage.tsx:52`, `InterestConfigPage.tsx:75`, `ReverseConfirmDialog.tsx:29`, `PettyCashCustodianCard.tsx:31`
- **Modify** docs: `.claude/rules/accounting.md` (~600-614), `.claude/CLAUDE.md` (~262)

---

## Task 1 (P3): Wire scroll-to-section

**Files:** Modify `apps/web/src/pages/settings/CategoryPage.tsx`; Test `apps/web/src/pages/settings/__tests__/CategoryPage.test.tsx` (extend)

**Interfaces:** Consumes existing CategoryPage. Produces: on mount/hash-change, scroll the element whose `id` === `location.hash` into view.

- [ ] **Step 1: test (RED)** — extend CategoryPage.test.tsx. Add a test that mounts CategoryPage with a hash present and asserts `scrollIntoView` is called on the matching element. Use a spy:

```tsx
it('scrolls to the section matching the URL hash on mount', () => {
  const scrollSpy = vi.fn();
  window.HTMLElement.prototype.scrollIntoView = scrollSpy;
  window.location.hash = '#test-mode';
  role = 'OWNER';
  renderCat('system'); // existing helper; system has inline item id 'test-mode'
  expect(scrollSpy).toHaveBeenCalled();
});
```

Run: `cd apps/web && npx vitest run src/pages/settings/__tests__/CategoryPage.test.tsx` → FAIL (no scroll wired)

- [ ] **Step 2: implement** — in `CategoryPage.tsx`, add a `useEffect` after computing groups (uses `useEffect` + `useParams`-free, just window.location.hash; re-run when categoryId changes):

```tsx
import { useEffect } from 'react';
// ...inside CategoryPage, before return:
useEffect(() => {
  const hash = window.location.hash.slice(1);
  if (!hash) return;
  // defer to next frame so the section is in the DOM
  const el = document.getElementById(hash);
  if (el) el.scrollIntoView({ block: 'start' });
}, [categoryId]);
```

Run: same test → PASS. Also run full settings suite to ensure no regression: `cd apps/web && npx vitest run src/pages/settings`

- [ ] **Step 3: commit** — `git add apps/web/src/pages/settings/CategoryPage.tsx apps/web/src/pages/settings/__tests__/CategoryPage.test.tsx && git commit -m "feat(settings): scroll to section matching URL hash in CategoryPage"`

---

## Task 2 (P3): Index settings registry into CommandPalette

**Files:** Modify `apps/web/src/components/CommandPalette.tsx`; Test `apps/web/src/components/__tests__/CommandPalette.test.tsx` (create if absent, else extend)

**Interfaces:** Consumes `settingsRegistry` + `visibleCategories`/`visibleItems` (or just `settingsRegistry`) + category `icon`. Produces: settings items appear as palette entries (label, path, icon=category icon, roles) so search jumps to any setting.

- [ ] **Step 1: read CommandPalette.tsx** — confirm `NavEntry { label, path, icon, keywords?, roles? }`, the `pages` array, and `filterByRole`. The existing flat `{ label: 'ตั้งค่าระบบ', path: '/settings', ... }` entry stays (top-level).

- [ ] **Step 2: test (RED)** — add a test asserting a known settings item (e.g. "VAT" or "โหมดทดสอบ") appears as a palette entry with its `/settings/<cat>...` path and is role-filtered. Mock `useAuth` OWNER. (Mirror the existing palette test structure; if no test file, create one that renders the palette open and queries for the entry.)

Run → FAIL.

- [ ] **Step 3: implement** — build settings entries from the registry and concat into `pages`. Path rule: inline item → `/settings/${cat.id}#${item.id}`; route item → `/settings/${cat.id}/${item.id}`; external → `item.path`. icon = `cat.icon`. roles = `item.roles`. keywords = `[item.label, ...(item.keywords??[])].join(' ')`. Example:

```tsx
import { settingsRegistry } from '@/config/settings-registry';
// ...
const settingsEntries: NavEntry[] = settingsRegistry.flatMap((cat) =>
  cat.items.map((item) => ({
    label: `${cat.label} › ${item.label}`,
    path:
      item.kind === 'inline' ? `/settings/${cat.id}#${item.id}`
      : item.kind === 'route' ? `/settings/${cat.id}/${item.id}`
      : (item.path ?? '/settings'),
    icon: cat.icon,
    keywords: [item.label, ...(item.keywords ?? [])].join(' '),
    roles: item.roles,
  })),
);
// concat into the pages list used for filtering (e.g. const pages = [...basePages, ...settingsEntries])
```

Run test → PASS. Run `./tools/check-types.sh web` → 0.

- [ ] **Step 4: commit** — `git commit -m "feat(settings): index settings registry into CommandPalette for global search/jump"`

---

## Task 3 (P3): Collapse sidebar settings zone + "จัดการ" group + PDPA label

**Files:** Modify `apps/web/src/config/menu.ts`; Modify `apps/web/src/config/menu.test.ts`

**Interfaces:** Sidebar `owner-settings` group reduced to config-entry "ตั้งค่าระบบ" + a "จัดการ" operational group; `owner-ai` group removed (now reachable in panel); PDPA label disambiguated.

- [ ] **Step 1: read menu.ts** owner-settings (line ~736) + owner-ai (line ~757) + owner-settings-extra (line ~793) groups.

- [ ] **Step 2: edit `owner-settings` group** — keep ONLY the config entry pointing to the panel + move operational items into a clearly-labelled set. Replace the group's `items` with:

```tsx
        { label: 'ตั้งค่าระบบ', path: '/settings', icon: Settings },
        { label: 'ผู้ใช้ / พนักงาน', path: '/users', icon: UserCog },
        { label: 'สาขา', path: '/branches', icon: Building2 },
        { label: 'แบบสัญญา', path: '/contract-templates', icon: FileCheck },
        { label: 'โปรโมชัน', path: '/promotions', icon: BadgePercent },
        { label: 'PDPA (คำยินยอม/DSAR)', path: '/pdpa', icon: Shield },
```
(removes the 4 config deep-links: บัญชีตาม Role, บริษัท, ตั้งราคา, ตั้งค่า GFIN — now reachable in the panel + CommandPalette. PDPA relabelled to distinguish from the settings encryption item.)

- [ ] **Step 3: remove `owner-ai` group** — delete the entire `owner-ai` group object (5 AI items now reachable via the panel's AI category + CommandPalette). Keep `owner-settings-extra` (Audit Log) as-is OR fold its single item into owner-settings — leave as-is to minimize churn.

- [ ] **Step 4: keep `#contacts` deep-links** (owner-fin-master / fm-fin-master / acc-fin-master) — they redirect to `/settings/company#contacts` and now scroll (Task 1). No change needed.

- [ ] **Step 5: update menu.test.ts** — adjust any assertion that expected the removed config/AI sidebar paths. Add an assertion that `owner` settings zone contains `/settings` and the operational paths but NOT `/settings/ai/admin` / `/settings/finance/gfin` etc. Run: `cd apps/web && npx vitest run src/config/menu.test.ts` → PASS.

- [ ] **Step 6: type-check + commit** — `./tools/check-types.sh web` (0) → `git commit -m "feat(settings): collapse sidebar config into panel entry + จัดการ group, relabel PDPA"`

---

## Task 4 (P4): Remove dead code (SystemSettings + document-config dup route)

**Files:** Delete `apps/web/src/pages/SettingsPage/components/SystemSettings.tsx`; Modify `apps/web/src/App.tsx`

- [ ] **Step 1: confirm SystemSettings dead** — `cd "/d/BESTCHOICE APP/BESTCHOICE" && grep -rn "SystemSettings" apps/web/src` → expect only the file itself. If any importer, STOP + report.
- [ ] **Step 2: delete** — `git rm apps/web/src/pages/SettingsPage/components/SystemSettings.tsx` (+ its test file if one exists). (This also removes the stale `navigate('/settings/interest-config')` inside it.)
- [ ] **Step 3: remove document-config dup route** — in `App.tsx`, delete the SECOND `/settings/document-config` route (the `ComingSoonPage` one at ~lines 1271-1282). Keep the real `DocumentConfigPage` route (~line 475). Verify only one `/settings/document-config` route remains.
- [ ] **Step 4: verify** — `./tools/check-types.sh web` (0) + `cd apps/web && npx vitest run src/pages/settings src/config` (green). grep `grep -rn "ComingSoonPage" apps/web/src/App.tsx` — ensure remaining ComingSoon routes (brands/backup) untouched.
- [ ] **Step 5: commit** — `git commit -m "chore(settings): remove dead SystemSettings.tsx + duplicate document-config route"`

---

## Task 5 (P4): Tidy stale links + comments

**Files:** Modify `PeakExportPage.tsx`, `App.tsx` (PeriodsRedirect), `AccountRolesPage.tsx`, `InterestConfigPage.tsx`, `ReverseConfirmDialog.tsx`, `PettyCashCustodianCard.tsx`

- [ ] **Step 1: live link `PeakExportPage.tsx:135`** — `<Link to="/settings#peak-mapping">` → `<Link to="/settings/accounting#peak-mapping">` (canonical; peak-mapping is inline under accounting)
- [ ] **Step 2: PeriodsRedirect `App.tsx:18`** — `window.location.replace('/settings#periods')` → `window.location.replace('/settings/accounting#periods')` (canonical; periods inline under accounting). Update the comment on line 15 too.
- [ ] **Step 3: JSDoc comments (comment-only, change the path string)** —
  - `AccountRolesPage.tsx:52` `/settings/account-roles` → `/settings/access/account-roles`
  - `InterestConfigPage.tsx:75` `/settings#vat` → `/settings/accounting` (VAT inline there)
  - `ReverseConfirmDialog.tsx:29` `/settings#internal-control` → `/settings/access`
  - `PettyCashCustodianCard.tsx:31` `/settings#internal-control` → `/settings/access`
- [ ] **Step 4: verify** — `./tools/check-types.sh web` (0). grep `grep -rn "settings#\|settings/account-roles\|settings/interest-config" apps/web/src --include=*.tsx --include=*.ts | grep -v "HASH_TO_CATEGORY\|Navigate to\|\.test\."` → only acceptable residue (SettingsIndexRedirect map keys; redirect routes). Report what remains.
- [ ] **Step 5: commit** — `git commit -m "chore(settings): update stale settings links + JSDoc paths to canonical panel URLs"`

---

## Task 6 (P4): Update docs

**Files:** Modify `.claude/rules/accounting.md`, `.claude/CLAUDE.md`

- [ ] **Step 1: rewrite accounting.md "Settings UI consolidation" (~line 600-614)** — replace the old "5-tab hash hub" description with the new model:

```markdown
### Settings UI consolidation (P1–P2, 2026-06)

`/settings` is a registry-driven panel (`SettingsLayout` + left sub-nav + search + mobile dropdown), OWNER/FM/ACC with per-item role filtering from `apps/web/src/config/settings-registry.tsx` (8 categories: company / access / accounting / finance / products / comms / ai / system). Routes: `/settings` → first visible category; `/settings/:categoryId` (panel) → `SettingsCategoryRoute` (index) + `SettingsItemRoute` (`:itemId`). Inline items render as sections; route items render full pages inside the panel; pages with their own tabs (document-config, rich-menu) + operational pages (users/branches/promotions/contract-templates/audit-logs/pdpa) stay external. Old hash tabs (`#vat`, `#users`, etc.) and old `/settings/<name>` paths redirect to the new `/settings/<cat>/<item>` URLs. Helpers: `visibleCategories`/`visibleItems`/`searchSettings`/`findItem` in `settings-access.ts`.
```

- [ ] **Step 2: update CLAUDE.md Key Routes (~line 262)** — replace the stale `/settings(/interest-config/line-oa/sms/pricing-templates/companies)` fragment with `/settings (registry-driven panel: /settings/:categoryId; old paths redirect)`. Keep `/users`, `/branches`, etc.
- [ ] **Step 3: commit** — `git commit -m "docs(settings): update accounting.md + CLAUDE.md for the new settings panel IA"`

---

## Task 7: Verification

- [ ] **Step 1:** `./tools/check-types.sh web` → 0 errors
- [ ] **Step 2:** `cd apps/web && npx vitest run src/pages/settings src/config src/components` → green
- [ ] **Step 3:** grep no live stale settings links: `cd "/d/BESTCHOICE APP/BESTCHOICE" && grep -rn "to=\"/settings#\|to='/settings#\|navigate('/settings#" apps/web/src` → only SettingsIndexRedirect/PeriodsRedirect canonical residue
- [ ] **Step 4: smoke (if dev runs):** sidebar settings zone = "ตั้งค่าระบบ" + จัดการ group (no AI/config items); CommandPalette search "VAT"/"GFIN" → jumps into panel; open `/settings/accounting#vat` → scrolls to VAT; `/pdpa` vs panel PDPA labels distinct; `/settings/document-config` still loads real page.

---

## Self-Review

**Spec coverage:** §8 sidebar collapse + จัดการ group → Task 3 ✓; CommandPalette index → Task 2 ✓; scroll-to-section (carry from P1) → Task 1 ✓; P4 dead code (SystemSettings + doc-config dup) → Task 4 ✓; PDPA → Task 3/5 **(corrected: disambiguate not merge — they're different features)** ✓; stale links/comments → Task 5 ✓; docs → Task 6 ✓.

**Placeholder scan:** scroll useEffect, CommandPalette mapping, menu edits all have concrete code/targets. Doc rewrites have full replacement text. Verify steps have exact grep commands. No TBD.

**Type consistency:** `NavEntry` shape reused in Task 2; registry `kind`/`id`/`path` used consistently; menu group structure preserved.

## Out of scope / deferred
- Bundle optimization (registry static-imports settings pages) — separate perf pass
- Per-branch SHOP P&L, other unrelated settings perf
- Deeper a11y pass on search input (aria-label) — can fold into Task 2 if trivial
