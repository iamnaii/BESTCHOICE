# Pre-Merge Guard Report — Settings IA Redesign Branches
**Date**: 2026-06-24  
**Reviewed by**: Pre-Merge Guard (automated)  
**Branches reviewed**: 3 (see sections below)

---

## Summary Table

| Branch | Commits | Files | Recommendation |
|--------|---------|-------|----------------|
| `feat/settings-ia-redesign` | 11 | 18 | ✅ APPROVE |
| `feat/users-page-consolidation` | 9 | 10 | ⚠️ REVIEW |
| `feat/integrations-own-category` | 1 | 9 | ✅ APPROVE |

All three branches are **frontend-only** (no backend/API changes). No Critical issues found across any branch.

---

## Branch 1: `feat/settings-ia-redesign`

**Author**: iamnaii  
**Commits ahead of main**: 11  
**Files changed**: 18 (1744 insertions, 280 deletions)

### Change Summary
Complete IA redesign of the `/settings` panel:
- New `SettingsLayout` (registry-driven left-nav + search + mobile dropdown)
- New `SettingsIndexRedirect` (maps old `#hash` tabs → `/settings/:categoryId` paths)
- New `CategoryPage` (renders registry items: inline/route/external)
- New `settings-access.ts` (role-filtered category/item helpers + search)
- New `settings-registry.tsx` (8 categories, item-level role gates)
- Route expanded from `OWNER`-only to `OWNER | FINANCE_MANAGER | ACCOUNTANT`

### Critical Issues
_None found._

### Warnings

**W1 — Hash-to-category maps `offsite-backup` and `pdpa` to `system` (OWNER-only category)**  
File: `apps/web/src/pages/settings/SettingsIndexRedirect.tsx`  
```ts
'offsite-backup': 'system',
'pdpa': 'system',
```
If a FM/ACCOUNTANT hits an old bookmark like `/settings#offsite-backup`, they'll be redirected to `/settings/system` which renders empty for them (all system items are OWNER-only). Not a security issue — the registry filters correctly — but a confusing UX dead-end. Consider redirecting these to a "permission denied" message or simply omit them from the hash map so non-OWNER users fall through to their first visible category.

**W2 — No `QueryBoundary` on new settings pages**  
`SettingsLayout` and `CategoryPage` have no error boundary wrapper. These pages are registry-driven (no direct API calls), so a JS runtime error in a lazily-loaded component would produce a blank panel with no user-facing error. Low risk (settings pages are stable), but per project standard (`QueryBoundary` on ~44 pages in v1 hardening) this is inconsistent.

### Info

**I1 — `CategoryPage` route-item fallback `path ?? '#'`**  
```tsx
to={item.path ?? '#'}
```
All route items in the registry have paths defined, so `'#'` is unreachable in practice. But if a future item is added as `kind: 'route'` without a path, the Link renders a no-op `href="#"`. Add a runtime assertion or TS type guard to enforce `path` is required when `kind === 'route'`.

**I2 — Route guard relaxation is correct and intentional**  
`/settings` and `/settings/:categoryId` now accept `FINANCE_MANAGER` and `ACCOUNTANT`. This is the correct behavior: FM needs access to accounting/finance settings, ACC needs PEAK mapping. All sensitive items (VAT, periods, users, backup, etc.) still carry `roles: ['OWNER']` at the item level, enforced by `visibleItems()` in `CategoryPage`.

### Recommendation: ✅ APPROVE
No security regressions. Frontend-only, well-tested (new `settings-access.test.ts` + `CategoryPage.test.tsx`), follows all project conventions (semantic tokens, lazy loading, `Link`/`useNavigate` instead of raw `fetch`). Address W1 before or after merge — it's a UX improvement, not a blocker.

---

## Branch 2: `feat/users-page-consolidation`

**Author**: iamnaii  
**Commits ahead of main**: 9  
**Files changed**: 10 (661 insertions, 66 deletions)

### Change Summary
Consolidates the old `/settings#users` tab into `InternalControlTab`:
- Removes `UsersTab.tsx` (was a mix of user-management link + authority controls)
- Expands `InternalControlTab` to host all 4 authority controls: MakerCheckerToggle, ReversePermissionCard, ReverseReasonsManagementCard, PettyCashCustodianCard
- Adds backward-compat hash alias: `#users → internal-control`
- Updates E2E test `TAB_IDS` to replace `users` with `internal-control`
- Adds `InternalControlTab.test.tsx` verifying 5-card composition + 3 group headers
- Updates CLAUDE.md accounting.md with new navigation path

### Critical Issues
_None found._

### Warnings

**W1 — Potential merge conflict with `feat/settings-ia-redesign`**  
Both branches modify `apps/web/src/pages/SettingsPage/index.tsx` and `InternalControlTab.tsx`. The `settings-ia-redesign` branch appears to be a superset that builds on this work. Merging order matters:
- **Safe order**: merge `users-page-consolidation` first → then rebase/merge `settings-ia-redesign`
- **Risk**: if merged out of order, the InternalControlTab consolidation could be overwritten or cause conflicts

Verify whether `settings-ia-redesign` already incorporates these changes via its own commits before deciding merge order.

### Info

**I1 — Deleted `UsersTab.tsx` with no `// removed` comment**  
Correct per project convention ("avoid backwards-compatibility hacks like adding `// removed` comments"). The `#users` hash alias in `SettingsPage/index.tsx` provides backward compatibility.

**I2 — `PettyCashCustodianCard.tsx` comment updated**  
Line 28: comment updated from `#users` → `#internal-control`. Minor but correct.

### Recommendation: ⚠️ REVIEW
Code quality is good — no security issues, well-tested, follows conventions. The concern is **merge ordering** relative to `feat/settings-ia-redesign`. Confirm these are independent branches and not a precursor chain before merging. If `settings-ia-redesign` already includes this work, this branch may be redundant — check for overlap before merging both.

---

## Branch 3: `feat/integrations-own-category`

**Author**: iamnaii  
**Commits ahead of main**: 1  
**Files changed**: 9 (59 insertions, 30 deletions)

### Change Summary
Splits `integrations` out of the `system` settings category into its own top-level category:
- Adds `integrations` category with `hub` (OWNER + ACCOUNTANT) and `mdm` (OWNER) items
- Removes `integrations` and `mdm` from `system` category
- Narrows `system` category to `roles: ['OWNER']` (was `['OWNER', 'ACCOUNTANT']`)
- Adds redirect chain: `/settings/system/integrations` → `/settings/integrations/hub`
- Adds redirect: `/settings/system/mdm` → `/settings/integrations/mdm`
- Updates `menu.ts` fin-zone link to point to new path `/settings/integrations/hub`
- Updates all related tests (registry count 8→9, menu test, migration test)

### Critical Issues
_None found._

### Warnings

**W1 — Access narrowing for ACCOUNTANT on `system` category**  
`system.roles` changed from `['OWNER', 'ACCOUNTANT']` to `['OWNER']`. ACCOUNTANT previously could see the system category (specifically the integrations item within it). After this change, ACCOUNTANT sees the `integrations` category instead (with the same `hub` item). This is the correct redesign intent per CLAUDE.md — documented explicitly: _"ACCOUNTANT can see the integrations category (hub item has ACCOUNTANT role) but no longer sees system."_ Verified: no ACCOUNTANT access lost.

### Info

**I1 — Old `/settings/integrations` path now matches `:categoryId` route**  
The old path `/settings/integrations` is no longer an explicit redirect. It now resolves directly to `CategoryPage('integrations')` via the `:categoryId` route — which is the correct page. Backward compat is preserved naturally.

**I2 — Test coverage updated correctly**  
Registry count updated 8→9, menu test updated to assert `/settings/integrations` in OWNER sidebar, migration test updated to verify redirect chain. Good test hygiene.

### Recommendation: ✅ APPROVE
Clean, atomic, well-tested change. Proper redirect chain. No security regression — ACCOUNTANT access redirected (not removed).

---

## Branches Skipped

- **`fix/fb-webhook-integration-config`** (18 unique commits) — Diff against main is ~200k lines because this branch is based on a much older version of main and hasn't been rebased. Not reviewable in this format; recommend rebasing onto main before review.
- **`worktree-feat+sp7.1-dual-prisma-foundation`** and **`worktree-feat-shop-sales-ai-phase-a`** — No merge base with current main; treated as isolated worktree experiments, not merge candidates.
- **`chore/*` branches** (local-config-sync, owner-mobile-settings-bar, doc-config-single-source, dedupe-fin-zone-settings, stale-contacts-comments) — All 1-2 file changes, already merged to main or pending trivial PRs. No issues found.

---

## Overall Security Posture

All reviewed branches are **frontend-only**. No new NestJS controllers, no money arithmetic, no database queries, no new API endpoints. The security checklist items (guard coverage, Decimal precision, soft-delete, SQL injection) are not applicable to this diff set.

The one architectural note worth tracking: **the settings route now accepts FM and ACCOUNTANT**, which is the intended expansion. Backend API endpoints behind the settings pages already carry their own `@UseGuards(JwtAuthGuard, RolesGuard)` + `@Roles()` protection — the frontend role expansion does not weaken server-side security.
