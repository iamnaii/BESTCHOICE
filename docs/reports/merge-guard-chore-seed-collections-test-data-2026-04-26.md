# Pre-Merge Guard Report

**Branch**: `chore/seed-collections-test-data`
**Author**: Akenarin Kongdach
**Date**: 2026-04-26
**Commit**: d4a4f44b
**Reviewer**: Pre-Merge Guard (automated)

---

## File Changes Summary

| File | Lines Added | Lines Removed |
|------|------------|--------------|
| `scripts/seed-collections-test-data.ts` | +273 | 0 |
| `scripts/cleanup-collections-test-data.ts` | +162 | 0 |

**Total**: 2 new files, 435 lines added

---

## Issues by Severity

### Critical
_None found._

### Warning
_None found._

### Info

**`scripts/seed-collections-test-data.ts` — cross-boundary import**
- The script imports directly from `apps/api/src/utils/crypto.util` and `apps/api/src/utils/pii.util`. This is intentional for a one-off script that needs to reuse PII encryption logic, but it means the script will break if those utilities are moved or refactored. Acceptable for a maintenance script; just note it in the runbook.

**Both scripts — one-off intent**
- Scripts are documented as one-off but don't enforce a "never run twice" guard at the filename/tag level. The idempotency marker (`__SEED_2026_04_25__`) is hardcoded to a specific date, which is the correct design — a re-run with a new date creates new data.

---

## Positive Observations

- All monetary fields correctly use `new Prisma.Decimal(...)` (no `Number()` on money).
- Every query correctly includes `deletedAt: null` filter.
- Dry-run mode (`--commit` flag) with clear console output.
- Anti-blast guard: refuses to run if more than 25 records match the marker.
- Double-check on customer name prefix `[TEST] ` before deleting anything.
- Cleanup script scrambles unique fields (`nationalId`, `phone`) after soft-delete so re-seeding works without constraint violations.
- No secrets, API keys, or sensitive data hardcoded.

---

## Recommendation

**APPROVE**

Clean, well-guarded utility scripts. Safe to merge. No code path changes to production logic.
