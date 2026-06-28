# Merge Guard Report — Settings P6 Stack
**Date:** 2026-06-28  
**Agent:** Pre-Merge Guard (automated)  
**Branches reviewed:** 3 (stacked PR series)

---

## Branches

| # | Branch | Author | Last commit | Commits vs main |
|---|--------|--------|-------------|-----------------|
| 1 | `feat/settings-contacts-standalone` | iamnaii | 2026-06-24 | 4 commits |
| 2 | `feat/contacts-into-settings-submenu` | iamnaii | 2026-06-24 | 1 commit (on #1) |
| 3 | `feat/integrations-own-category` | iamnaii | 2026-06-24 | 1 commit (on #2) |

These form a **stacked PR series** (P6 phase of the settings-navigation redesign). Branch 3 is the leaf and already contains all changes from branches 1 and 2. The changes correspond to items documented in `.claude/rules/accounting.md` under "Settings UI consolidation (P1–P6, 2026-06)".

---

## File Changes Summary

All three branches are **pure frontend changes** — zero backend (`apps/api/`) modifications.

| Branch | Files changed | Additions | Deletions | Scope |
|--------|--------------|-----------|-----------|-------|
| `settings-contacts-standalone` | 11 | +263 | -62 | Route guard, CommandPalette, registry, redirect logic |
| `contacts-into-settings-submenu` | 9 | +68 | -71 | Label rename "สมุดผู้ติดต่อ"→"รายชื่อผู้ติดต่อ", nav consolidation |
| `integrations-own-category` | 9 | +59 | -30 | Splits `integrations` into own settings category, redirect chain |

### Key files modified
- `apps/web/src/App.tsx` — route definitions and redirect chains
- `apps/web/src/config/menu.ts` — sidebar/zone configuration
- `apps/web/src/config/settings-registry.tsx` — settings panel category registry
- `apps/web/src/config/settings-access.ts` tests — role-visibility assertions
- `apps/web/src/pages/settings/SettingsIndexRedirect.tsx` — hash→path redirect table
- `apps/web/src/components/CommandPalette.tsx` — global search entries

---

## Security Checks

| Check | Result |
|-------|--------|
| New controllers without `@UseGuards(JwtAuthGuard)` | N/A — no backend changes |
| `Number()` on financial fields | **None found** |
| Missing `deletedAt: null` in new queries | N/A — no Prisma queries |
| Hardcoded secrets or API keys | **None found** |
| Missing `@Roles()` on controller methods | N/A — no backend changes |
| Unparameterized `$queryRaw` | N/A — no backend changes |
| Raw `fetch()` in new React components | **None found** |
| Missing `queryClient.invalidateQueries()` after mutations | N/A — no mutations |
| Thai validation messages on new DTOs | N/A — no new DTOs |

---

## Issues Found

### Critical (must fix before merge)
*None*

### Warning (should fix)
*None*

### Info / Observations

**1. Security improvement in branch 1 (`settings-contacts-standalone`)**  
`/contacts` and `/contacts/:id` were previously unguarded routes — accessible to all authenticated users including `SALES` role. This branch correctly wraps them with `ProtectedRoute roles={['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT']}`. Positive change.

**2. Label rename is consistent**  
Branch 2 renames "สมุดผู้ติดต่อ" → "รายชื่อผู้ติดต่อ" in all relevant UI strings. The old keyword is preserved in the CommandPalette `keywords` field for backward search compat — good practice.

**3. Redirect chain correctness**  
Branch 3 establishes a two-hop redirect from legacy paths:
- `/settings/system/integrations` → `/settings/integrations/hub` ✓
- `/settings/system/mdm` → `/settings/integrations/mdm` ✓
- `/settings/mdm-test` → `/settings/integrations/mdm` ✓
- `/settings/integrations` → resolves via `:categoryId` dynamic route (no explicit redirect needed) ✓

All redirect paths are covered by updated tests.

**4. Stacked PRs — merge order matters**  
Branch 3 tip (`feat/integrations-own-category`) already includes the full history of all 3 branches. If squash-merging, only branch 3 needs to be merged. If merging as separate PRs, order must be: 1 → 2 → 3.

**5. Test coverage maintained**  
Each branch updates its own test files to keep assertions accurate. No tests were deleted without replacement.

---

## Recommendation

| Branch | Recommendation |
|--------|---------------|
| `feat/settings-contacts-standalone` | ✅ APPROVE |
| `feat/contacts-into-settings-submenu` | ✅ APPROVE |
| `feat/integrations-own-category` | ✅ APPROVE |

**Action:** Merge branch 3 (`feat/integrations-own-category`) to main — it contains the complete P6 settings navigation redesign. No blocking issues found. Recommend running `./tools/check-types.sh web` and the frontend test suite before merging to confirm no regressions.
