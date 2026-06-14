# Merge Guard Report — `feat/payroll-backfill`

**Date**: 2026-06-14  
**Author**: Akenarin Kongdach (iamnaii@MacBook-Pro-khxng-Akenarin.local)  
**Last commit**: `feat(backfill): backfill:payroll-user-fk CLI (tier-1 taxId auto, tier-2 name audited) (PR-D)` (2026-06-05)  
**Commits ahead of fork point**: 13  
**Recommendation**: ⚠️ REVIEW

---

## File Changes Summary

| Category | Count |
|----------|-------|
| Total files changed | 95 |
| TypeScript/TSX files | ~80 |
| Insertions | 10,201 |
| Deletions | 959 |

This branch includes all of `feat/payroll-employee-link` (PR-C) plus adds three new backfill CLI tools (PR-D): `backfill-payroll-user-fk`, `backfill-employee-profiles`, `backfill-expense-vendor-fk`.

---

## Issues

### Critical — None

- All new/modified controllers properly guarded with `@UseGuards(JwtAuthGuard, RolesGuard)` and `@Roles(...)` on every method ✅
- No `Number()` on money fields — payroll DTOs use `@IsNumber({ maxDecimalPlaces: 2 })` and service uses `Prisma.Decimal` ✅
- All `findMany`/`findFirst` queries include `deletedAt: null` ✅
- No hardcoded secrets ✅
- No unparameterized `$queryRaw` — CLIs use parameterized template literals for DB name checks only ✅
- No raw `fetch()` in React components — all use `@/lib/api/employees` which wraps `api.get/post` from `@/lib/api` ✅
- All mutations call `qc.invalidateQueries()` ✅

### Warning — Requires Owner Sign-Off

#### W1: 2FA Authentication Removed (inherited from feat/payroll-employee-link)

Same as the `fix/ci-pre-existing-test-failures` branch — 2FA has been removed from the auth flow. **See merge-guard report for that branch for full details.** Requires explicit owner confirmation before merge.

#### W2: PII Logging in Backfill CLIs

Files: `apps/api/src/cli/backfill-payroll-user-fk.cli.ts`, `apps/api/src/cli/backfill-employee-profiles.cli.ts`

The backfill CLIs emit employee data to stdout via `console.log`:
- Employee names (matched by name for tier-2 matching)
- Tax IDs (`taxId`) used for tier-1 auto-match
- A CSV file of name matches is written to a local path

These CLIs are one-time data migration tools intended for production runs. In a production context, stdout may be captured in Cloud Run job logs which are retained by GCP. The PII log content (names, tax IDs) would then appear in log storage. This is acceptable for a controlled migration run but the operator should be aware of this and ensure log retention is appropriate per the system's PDPA policy.

### Info

- The three new CLIs follow the established pattern from `wipe-accounting.cli.ts`: DB name guard, `ALLOW_PROD_BACKFILL` guard, dry-run mode by default
- The `backfill-payroll-user-fk` tier-2 ambiguity handling (skip multi-match, output to CSV) is prudent — avoids wrong-user links
- New React components (`EditEmployeeDialog`, `EmployeeCombobox`, `ProvisionEmployeeDialog`) all follow established patterns: `useQuery`/`useMutation`, `queryClient.invalidateQueries`, and `api.*` from `@/lib/api`
- All new files are well under 500 lines

---

## Decision

**⚠️ REVIEW** — No Critical issues. Two warnings: W1 (2FA removal, inherited) needs owner sign-off. W2 (PII in CLI logs) is informational — acceptable for a one-time migration tool but should be noted in the runbook.
