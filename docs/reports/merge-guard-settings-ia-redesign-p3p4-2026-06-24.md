# Merge Guard Report — feat/settings-ia-redesign-p3p4
**Date**: 2026-06-24  
**Branch**: `feat/settings-ia-redesign-p3p4`  
**Author**: iamnaii <akenarin.ak@gmail.com>  
**Commits ahead of main**: 9  
**Last updated**: 25 hours ago  

---

## File Changes Summary
16 files changed, 492 insertions(+), 251 deletions(−)

| File | Type | Changes |
|------|------|---------|
| `apps/web/src/components/CommandPalette.tsx` | Frontend | +30 lines — settings registry indexed into palette |
| `apps/web/src/components/CommandPalette.test.tsx` | Test | +174 lines — new file, full test suite for registry integration |
| `apps/web/src/pages/settings/CategoryPage.tsx` | Frontend | +12 lines — scroll-to-hash useEffect |
| `apps/web/src/pages/settings/__tests__/CategoryPage.test.tsx` | Test | +18 lines — scroll + hooks-stability tests |
| `apps/web/src/pages/SettingsPage/components/SystemSettings.tsx` | Frontend | −192 lines — dead component deleted |
| `apps/web/src/config/menu.ts` | Frontend | −20 lines — collapsed AI sidebar group, relabelled PDPA |
| `apps/web/src/App.tsx` | Frontend | −12 lines — removed dead `/settings/document-config` ComingSoon route |
| `apps/web/src/config/menu.test.ts` | Test | +39 lines — P3 collapse assertions |
| `.claude/CLAUDE.md`, `.claude/rules/accounting.md` | Docs | URL path updates |
| `apps/web/src/pages/AccountRolesPage.tsx`, `InterestConfigPage.tsx`, `PeakExportPage.tsx`, `PettyCashCustodianCard.tsx`, `ReverseConfirmDialog.tsx` | Frontend | 1-line JSDoc/comment URL fixes each |

All changes are **frontend-only** (web app). No backend (NestJS/Prisma) files touched.

---

## Security Checklist

| Check | Result |
|-------|--------|
| New controllers with missing `@UseGuards` | N/A — no new controllers |
| `Number()` on money fields | None found |
| Missing `deletedAt: null` in queries | N/A — no new queries |
| Hardcoded secrets or API keys | None found |
| Missing `@Roles()` on controller methods | N/A |
| SQL injection via unparameterized `$queryRaw` | N/A |

---

## Issues Found

### Critical
_None._

### Warning

**W1 — `window.location.hash` in useEffect instead of `useLocation().hash` (CategoryPage.tsx:36)**

```tsx
useEffect(() => {
  const hash = window.location.hash.slice(1);   // reads DOM directly
  if (!hash) return;
  const el = document.getElementById(hash);
  if (el) el.scrollIntoView({ block: 'start' });
}, [categoryId]);
```

`window.location.hash` is not reactive — if the hash changes via React Router `<Link to="#section">` within the same category (same `categoryId`), the effect won't re-fire and the scroll won't happen. In practice every settings deep-link changes `categoryId` (e.g. `/settings/accounting#periods`), so this is a no-op regression scenario, but it's fragile. Preferred pattern: `const { hash } = useLocation(); useEffect(() => { ... }, [hash, categoryId])`.

**Severity**: Low — no current broken scenario, but fragile for future hash-only nav within same category.

### Info

**I1 — CommandPalette settings deduplication is hash-based (correct)**  
The `.filter((e) => !pages.some((p) => p.path === e.path))` check dedupes by `path`. This works for exact `/branches` and `/users` but would miss deduplication of hash-anchored paths like `/settings/accounting#vat` if a base page entry pointed there. Currently no base page uses hash paths, so this is safe.

**I2 — `SystemSettings.tsx` deletion (192 lines)**  
Component is unused after this change. Deletion is clean — no other files import it. Verified by the diff (no import references remain).

**I3 — Redirect target corrected**  
`PeriodsRedirect` now points to `/settings/accounting#periods` (was `/settings#periods`). The old `#periods` hash link was unreachable since the panel moved to `/:categoryId` subroutes. Fix is correct.

---

## Recommendation

**APPROVE** — Frontend-only refactor with good test coverage. No security or data-integrity issues. One low-severity warning (W1) that can be improved as a follow-up.

**Merge order note**: This branch should merge BEFORE `feat/settings-sidebar-driven-nav` and `feat/integrations-own-category` (they stack on top of it).
