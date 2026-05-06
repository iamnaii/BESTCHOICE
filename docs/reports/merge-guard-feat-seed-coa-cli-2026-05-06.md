# Merge Guard Report — feat/seed-coa-cli

**Date**: 2026-05-06  
**Branch**: `feat/seed-coa-cli`  
**Author**: Akenarin Kongdach  
**Commits ahead of main**: 24  
**Recommendation**: ✅ APPROVE (1 Warning to note)

---

## File Changes Summary

| File | +Lines | -Lines | Notes |
|------|--------|--------|-------|
| `apps/api/src/cli/seed-coa.cli.ts` | +48 | 0 | New non-destructive CoA upsert CLI |
| `apps/web/src/pages/ChartOfAccountsPage.tsx` | +318 | -254 | Phase A.4 schema migration: old fields → new fields |
| `apps/api/package.json` | +4 | -1 | New `seed:coa` npm script |

**Total**: 3 files, +355 / -269 lines

---

## Issues

### 🟡 Warning

#### W-001 — `ChartOfAccountsPage.tsx` reaches 572 lines
**File**: `apps/web/src/pages/ChartOfAccountsPage.tsx`  
**Detail**: After the Phase A.4 field rename refactor, the page is 572 lines — above the 500-line soft limit. The page contains an inline `ExpenseFormPanel`-style form, filter bar, and table. The size was inherited from the previous version; this branch improves the layout (removes stale enum fields) but doesn't increase it significantly.  
**Recommendation**: Acceptable for now. Consider extracting `<CoaFormDrawer>` and `<CoaTable>` into sub-components in a follow-up.

---

### ℹ️ Info

#### I-001 — `$queryRaw` in `seed-coa.cli.ts` is safe
**File**: `apps/api/src/cli/seed-coa.cli.ts` (L35)  
**Detail**: `prisma.$queryRaw\`SELECT current_database()\`` uses a Prisma tagged template literal with no user-controlled input. This is parameterized by design and carries no SQL injection risk. The pattern matches the existing `wipe-accounting.cli.ts` safety guard.

#### I-002 — CLI is idempotent but has no dry-run flag
**File**: `apps/api/src/cli/seed-coa.cli.ts`  
**Detail**: The CLI is safe to re-run (upsert, no deletes) and requires `EXPECTED_DB_NAME` env guard before touching the DB. A `--dry-run` flag would be a nice-to-have for prod validation, but is not required for correctness.

---

## Security Checklist

| Check | Result |
|-------|--------|
| CLI requires explicit `EXPECTED_DB_NAME` guard | ✅ Aborts if env not set |
| CLI checks actual DB name before any writes | ✅ `$queryRaw SELECT current_database()` comparison |
| No hardcoded credentials or connection strings | ✅ Uses `DATABASE_URL` env via PrismaClient default |
| `ChartOfAccountsPage` uses `api.get/post` | ✅ No raw fetch |
| No new backend endpoints in this branch | ✅ Frontend + CLI only |

---

## Recommendation: ✅ APPROVE

Small, well-scoped branch. The new `seed-coa.cli.ts` follows the same safety guard pattern as `wipe-accounting.cli.ts` (EXPECTED_DB_NAME check + `$queryRaw` db-name validation). The `ChartOfAccountsPage` refactor correctly aligns the UI with the Phase A.4 schema (removing stale `accountGroup`/`isActive`/`companyId` fields). No critical issues.
