# Pre-Merge Guard Report

**Branch**: `feat/payroll-backfill` (PR-D: Employee profiles + payroll user-FK backfill CLIs)
**Author**: Akenarin Kongdach <iamnaii@MacBook-Pro-khxng-Akenarin.local>
**Report Date**: 2026-06-12
**Recommendation**: ⚠️ REVIEW (one Warning — PII in logs)

---

## Branch Summary

PR-D builds on top of PR-A/B/C (all employee-master commits are included). Unique new commits:

| SHA | Message |
|-----|---------|
| `b92ecc24` | feat(backfill): backfill:payroll-user-fk CLI (tier-1 taxId auto, tier-2 name audited) |
| `1c60c048` | feat(backfill): backfill:employee-profiles CLI (provision profiles for active staff) |
| `1d0d17dc` | docs(backfill): PR-D implementation plan |

### New CLI Scripts
- `apps/api/src/cli/backfill-employee-profiles.cli.ts`
- `apps/api/src/cli/backfill-payroll-user-fk.cli.ts`

---

## Security & Guard Review

### `backfill-employee-profiles.cli.ts`
✅ Requires `EXPECTED_DB_NAME` env var, validates against `current_database()` before any writes
✅ Dry-run by default (`--apply` flag required to write)
✅ Production requires `ALLOW_PROD_BACKFILL=YES_I_AM_SURE` + 5-second abort window
✅ Idempotent: skips users that already have a profile
✅ No PII in log output (only user IDs and counts)

### `backfill-payroll-user-fk.cli.ts`
✅ Same EXPECTED_DB_NAME + ALLOW_PROD_BACKFILL guards as above
✅ Dry-run by default
✅ Tier-2 (name-match) requires separate `--tier=2` flag and owner CSV review
✅ Audit log written for every tier-2 link (`PAYROLL_FK_MATCHED_BY_NAME` action)
⚠️ **PII written to stdout/Cloud Logging** — see W-1 below

---

## Issues Found

### Critical
*None*

### Warning

| # | File | Issue |
|---|------|-------|
| W-1 | `apps/api/src/cli/backfill-payroll-user-fk.cli.ts` L163–172 | The CSV written to `matched-by-name.csv` includes `employeeTaxId` (Thai National ID — 13-digit personal ID number). For Cloud Run Jobs with ephemeral filesystems, the CLI **also dumps the full CSV rows to stdout** (L170–173) so the owner can retrieve them from Cloud Logging. This means Thai National IDs end up in GCP Cloud Logging, which violates the project security rule *"ห้าม log PII (ข้อมูลส่วนบุคคล)"*. **Fix options**: (a) mask the tax ID in the stdout dump (e.g. `XXXXX1234` last 4 digits only); (b) omit `employeeTaxId` column from the stdout CSV and keep it only in the local file for local dev runs; (c) upload the CSV to an owner-access-only GCS bucket instead of dumping to stdout. |

### Info

| # | File | Issue |
|---|------|-------|
| I-1 | `backfill-payroll-user-fk.cli.ts` | All issues from the `feat/payroll-employee-link` report (W-1 re: `TwoFactorController`) also apply here since this branch contains PR-C. |
| I-2 | `backfill-employee-profiles.cli.ts` | `position` and `baseSalary` are intentionally left `NULL` post-backfill for OWNER to fill in the master UI. This is correct and documented — just noting it as expected incomplete data post-migration. |

---

## CLI Safety Architecture (Positive Findings)

The backfill design follows the same safety pattern as `wipe-accounting.cli.ts`:

- **DB identity check** via `SELECT current_database()` before any writes
- **Dry-run by default** with explicit opt-in (`--apply`)
- **Production gate** via a separate `ALLOW_PROD_BACKFILL` env var
- **Idempotency** via `userId IS NULL` guard on the update predicate — safe to re-run
- **Audit trail** — every tier-2 name-match link writes a `PAYROLL_FK_MATCHED_BY_NAME` AuditLog row
- **Separated confidence tiers** — tier-1 (taxId match, auto) vs tier-2 (name match, requires owner review CSV)

---

## Verdict

The backfill CLIs are well-designed and correctly safety-gated. The only actionable finding is **W-1**: `employeeTaxId` (Thai National ID) is printed to stdout/Cloud Logging, which constitutes PII logging in violation of the security policy. Mask or omit the tax ID from the stdout dump before running in production. The local `matched-by-name.csv` file is acceptable for local dev review.

**Merge order requirement**: This branch (PR-D) must be merged **after** `feat/payroll-employee-link` (PR-C), as it builds on top of the employee profile migration.
