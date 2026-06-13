# Pre-Merge Guard Report

**Branch**: `feat/payroll-backfill`
**Author**: Akenarin Kongdach <iamnaii@MacBook-Pro-khxng-Akenarin.local>
**Date**: 2026-06-13
**Reviewed by**: Pre-Merge Guard Agent

---

## File Changes Summary

| Commit | Files | Description |
|--------|-------|-------------|
| `1d0d17dc` | docs only | PR-D implementation plan |
| `1c60c048` | `backfill-employee-profiles.cli.ts`, spec | CLI to provision `EmployeeProfile` rows for active staff |
| `b92ecc24` | `backfill-payroll-user-fk.cli.ts`, spec | CLI to backfill `PayrollLine.userId` FK (tier-1 taxId, tier-2 name) |

**Scope**: Two one-time backfill CLIs (PR-D of the employee master epic). No NestJS controllers,
no API endpoints, no frontend changes — all CLI/script code.

---

## Issues Found

### Critical
_None._

### Warning
_None._

### Info

- **`$queryRaw` template literal usage** (`b92ecc24`, `1c60c048`):
  Both CLIs use `prisma.$queryRaw\`SELECT current_database()\`` as a parameterized template
  literal for the DB name validation guard. No string interpolation into the query — safe. ✅

- **DB name guard is correctly multi-layered** (`b92ecc24`):
  1. `EXPECTED_DB_NAME` env var required
  2. Actual DB name from `current_database()` must match
  3. Prod runs require `ALLOW_PROD_BACKFILL=YES_I_AM_SURE`
  4. 5-second abort window on prod
  5. Idempotent: only touches rows where `userId IS NULL` ✅

- **Tier-2 (name-match) audit trail**: All tier-2 matches write a
  `PAYROLL_FK_MATCHED_BY_NAME` AuditLog row and require `BACKFILL_ACTOR_USER_ID` — correct
  segregation of confidence levels. ✅

- **`deletedAt: null` in all queries**:
  - `user.findMany({ where: { deletedAt: null } })` ✅
  - `user.findFirst({ where: { id: actorId, deletedAt: null } })` ✅
  - `employeeProfile` queries include `deletedAt: null` ✅

- **No money field handling**: These CLIs only write `userId` UUID FKs — no financial
  arithmetic. Not applicable.

- **No new HTTP endpoints exposed**: CLI-only — no controller guard review needed.

- **`resolvePayrollMatch` is exported and unit-tested** (`backfill-payroll-user-fk.cli.spec.ts`):
  The pure matching function is isolated and independently testable. Good design. ✅

- **CSV output for tier-2 matches** (`matched-by-name.csv`): Written to CWD, not committed.
  Intended for owner review before applying. Acceptable for a one-time migration tool.

---

## Recommendation

**✅ APPROVE**

Both backfill CLIs follow the established backfill pattern from the codebase
(EXPECTED_DB_NAME guard, idempotency, audit log, dry-run mode). The tier-1/tier-2
confidence split with mandatory owner review for name-based matches is a sound design.
No production API surface changed; these are operator-run migration tools.

**Pre-run checklist** (operational, not blocking merge):
1. Run CLI-A (`backfill:employee-profiles`) first — match targets must have profiles
2. Run CLI-B dry-run to preview tier-1/tier-2 counts
3. Review `matched-by-name.csv` before applying tier-2 with `--tier=2`
4. Confirm `BACKFILL_ACTOR_USER_ID` is a real OWNER/ACCOUNTANT UUID for audit
