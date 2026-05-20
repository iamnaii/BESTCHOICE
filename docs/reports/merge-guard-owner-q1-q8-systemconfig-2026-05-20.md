# Merge Guard Report — feat/owner-q1-q8-systemconfig

**Date**: 2026-05-20  
**Branch**: `feat/owner-q1-q8-systemconfig`  
**Author**: Akenarin Kongdach <iamnaii@MacBook-Pro-khxng-Akenarin.local>  
**Recommendation**: ⚠️ **REVIEW** — review Warnings before merge

---

## File Changes Summary

| File | Lines ± | Notes |
|---|---|---|
| `apps/api/e2e/approval-workflow.e2e-spec.ts` | +1 | Adds `$executeRawUnsafe` to prismaMock |
| `apps/api/prisma/migrations/20260955000000_owner_q1q8_systemconfig_decisions/migration.sql` | +45 | New migration — 4 SystemConfig upserts |
| `apps/api/src/modules/expense-documents/dto/create-petty-cash.dto.ts` | +5/-3 | Comment-only updates (no code change) |
| `apps/api/src/modules/expense-documents/services/__tests__/petty-cash.service.spec.ts` | +6/-6 | Updated default account assertion `11-1201` → `11-1103` |
| `apps/api/src/modules/expense-documents/services/petty-cash.service.ts` | +7/-2 | Changes hardcoded fallback default `11-1201` → `11-1103` |
| `apps/web/src/components/expense-form-v4/types.ts` | +2/-1 | Comment-only update |
| `docs/superpowers/owner-pending-decisions-2026-05-19.html` | +599 | Owner decision summary HTML doc |
| `docs/superpowers/specs/2026-05-19-owner-q6-vat-key-cleanup.md` | +116 | Spec doc |
| `docs/superpowers/specs/2026-05-19-phase-a5-brief.md` | +271 | Phase A.5 brief |

**9 files changed, 1054 insertions(+), 10 deletions(-)**  
_(~980 of those lines are docs, not code)_

---

## Issues Found

### Critical (0)

None. No guards bypassed, no financial `Number()` casts, no raw SQL in service code.

---

### Warning (2)

#### W1 — `$executeRawUnsafe` added to e2e prismaMock without explanation

**File**: `apps/api/e2e/approval-workflow.e2e-spec.ts:114`

```typescript
$executeRawUnsafe: jest.fn(async () => 0) as any,
```

The mock was added to fix 4 failing tests. This implies the `approval-workflow` service (or a service it calls, likely `DocNumberService` advisory-lock path) invokes `$executeRawUnsafe` at runtime. `$executeRawUnsafe` bypasses Prisma's parameterization — if user input is ever interpolated into these queries, it becomes a SQL injection vector.

**Action required**: Confirm the real call site and verify that no user-controlled strings are interpolated. If it's the advisory lock pattern (e.g. `SELECT pg_advisory_xact_lock(hashtext($1))`), parameterization via `$executeRaw` (tagged template) would be safer. The fix itself does not introduce risk but the underlying call site should be audited.

#### W2 — `viewer_role_enabled = 'true'` flag enabled with no @Roles() wiring

**File**: `apps/api/prisma/migrations/20260955000000_.../migration.sql`

The migration sets `viewer_role_enabled = 'true'` in `system_config`. Per the migration comment, the actual `@Roles()` wiring for `VIEWER` on protected routes is deferred to a follow-up PR. Until that PR lands, the flag is a no-op.

This is safe — a flag with no wiring does nothing. However, if the follow-up PR is delayed and someone interprets the flag as "VIEWER role is fully operational," it could cause confusion. Consider adding a `TODO` comment referencing the follow-up PR number once it exists.

---

### Info (2)

#### I1 — Migration file uses non-calendar timestamp `20260955`

The migration file name `20260955000000_owner_q1q8_systemconfig_decisions` uses `55` as the day-component, which is not a real calendar date. This appears to be an established project convention (e.g. `20260946000000_add_peak_code_to_chart_of_accounts` uses `46` in the same position) for ordering purposes. Prisma sorts migrations alphabetically, so this works correctly. Not a bug — noted for awareness.

#### I2 — Large HTML doc committed to `docs/superpowers/`

`owner-pending-decisions-2026-05-19.html` is 599 lines of rendered HTML. Storing binary-equivalent generated HTML in git makes diffs noisy. Consider storing the source (Markdown or JSON) and rendering on demand. Not a blocker.

---

## Migration Analysis

The SQL migration is well-structured:
- Uses `ON CONFLICT (key) DO UPDATE` — correctly idempotent
- Clears `deleted_at = NULL` on conflict — handles soft-deleted rows
- Uses `gen_random_uuid()::text` for IDs — consistent with schema convention
- All 4 changes are business decisions signed off by owner (Q1/Q2/Q4/Q8 documented)

The key business change is: **Petty Cash default float account flips `11-1201` → `11-1103`**. The service-level fallback default is updated in parallel (`petty-cash.service.ts`). Together these provide defense-in-depth for environments that miss the migration.
