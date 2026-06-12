# Merge Guard Report — `feat/payroll-backfill` (PR-D)

**Date**: 2026-06-12  
**Author**: Akenarin Kongdach  
**Branch**: `feat/payroll-backfill`  
**Unique commits vs main**: 158 (branch diverged; scope of this review = the 3 commits unique to PR-D on top of `feat/payroll-employee-link`)

---

## File Changes Summary (unique to this branch vs `feat/payroll-employee-link`)

| File | Type |
|---|---|
| `apps/api/src/cli/backfill-payroll-user-fk.cli.ts` | New CLI tool |
| `apps/api/src/cli/backfill-employee-profiles.cli.ts` | New CLI tool |
| `apps/api/src/cli/backfill-payroll-user-fk.cli.spec.ts` | Tests |
| `apps/api/src/cli/backfill-employee-profiles.cli.spec.ts` | Tests |
| `apps/api/package.json` | New npm scripts |
| `docs/...` | PR-D implementation plan |

---

## Commit Summary (unique vs PR-C)

1. `docs(backfill)`: PR-D implementation plan
2. `feat(backfill)`: `backfill:employee-profiles` CLI — provisions Employee profiles for all active users who lack one
3. `feat(backfill)`: `backfill:payroll-user-fk` CLI — links legacy `PayrollLine` rows to a `User` FK using tier-1 (taxId) and tier-2 (name) matching

---

## Issues

### Critical — None

### Warning — None

### Info

**Backfill CLIs have appropriate safety guards**

```ts
// Requires EXPECTED_DB_NAME → verified against current_database()
// Requires ALLOW_PROD_BACKFILL=YES_I_AM_SURE for production
// Dry-run by default; --apply flag required to write
// Tier-2 name matches written to CSV for owner review; only applied with --tier=2
```

Mirrors the pattern from the existing `wipe-accounting.cli.ts` safety guards (CLAUDE.md §v3). `$queryRaw` usage is `SELECT current_database()` only — a static template literal with no interpolation. All data queries use the typed Prisma ORM. No raw SQL injection surface.

**Tier-2 matching is conservative**

Name-based matching (`tier2`) requires an exact name match to a single active user. Ambiguous matches (2+ users with the same name) are never auto-linked — exported to CSV for manual review only. The audit log action `PAYROLL_FK_MATCHED_BY_NAME` is written for every tier-2 link applied.

**Idempotency correctly enforced**

Both CLIs scan only rows with `userId IS NULL` and guard writes with `userId: null` in `updateMany` — re-running never double-links or double-audits.

**`$queryRaw` uses are parameterized**

All analytics/report service `$queryRaw` calls in this branch use tagged template literals (Prisma's safe parameterized API). No string concatenation into raw SQL found.

---

## Recommendation: **APPROVE**

No security issues. Backfill CLIs follow the established safety-guard pattern. All database writes are guarded by dry-run default + explicit env flags. No new API endpoints or controllers in this PR-D slice.

> Note: This branch builds on `feat/payroll-employee-link` (PR-C — also approved). Must be merged after PR-C lands, or squashed together. The 158-commit divergence from main is shared history with PR-C; only 3 commits are unique to PR-D.
