# Merge Guard Report — feat/seed-coa-cli

**Date**: 2026-05-06  
**Branch**: `feat/seed-coa-cli`  
**Author**: Akenarin Kongdach `<iamnaii@MacBook-Pro-khxng-Akenarin.local>`  
**Recommendation**: ✅ **APPROVE** — clean, no issues found

---

## File Changes Summary

| File | +Lines | -Lines | Type |
|------|--------|--------|------|
| `apps/api/src/cli/seed-coa.cli.ts` | +48 | 0 | New CLI tool |
| `apps/api/package.json` | +3 | -1 | npm script additions |
| `apps/web/src/pages/ChartOfAccountsPage.tsx` | +269 | -258 | UI rewrite for Phase A.4 schema |

**Total**: 3 files changed, 355 insertions(+), 269 deletions(−)

---

## Issues Found

### 🔴 Critical — None

- ✅ `seed-coa.cli.ts` is a one-off CLI tool (no HTTP controller) — no guards needed
- ✅ `$queryRaw` in CLI uses tagged template literal (`\`SELECT current_database()\``) — parameterized, safe from injection
- ✅ `EXPECTED_DB_NAME` guard prevents running against wrong database
- ✅ No hardcoded secrets or API keys
- ✅ `ChartOfAccountsPage.tsx` uses `api.get()` / `api.post()` / `api.patch()` / `api.delete()` — correct
- ✅ `queryClient.invalidateQueries(['chart-of-accounts'])` called after every mutation ✓

### 🟡 Warning — None

### 🔵 Info

**I-1: No `NODE_ENV=production` guard on `seed:coa` CLI**

`wipe-accounting.cli.ts` (from v3 hardening) requires `ALLOW_PROD_WIPE=YES_I_AM_SURE` when `NODE_ENV=production`. The new `seed-coa.cli.ts` is non-destructive (upsert-only, no deletes), so a production guard may not be strictly necessary. However, for consistency with the wipe CLI pattern, consider adding a warning log when `NODE_ENV=production` to signal intent. Low priority — the `EXPECTED_DB_NAME` guard is sufficient safety.

**I-2: Phase A.4 `ChartOfAccountsPage.tsx` schema alignment**

The `ChartOfAccountsPage.tsx` rewrite correctly drops old A.0-A.3 fields (`nameTh`/`nameEn`/`accountGroup`/`level`/`companyId`/`peakAccountCode`/`peakAccountId`) and adopts the new Phase A.4 schema (`name`, `type`, `normalBalance`, `category`, `vatApplicable`, `notes`, `status`). The client-side `typeFilter` matching via `a.type.startsWith(typeFilter)` correctly handles `สินทรัพย์ (Contra)` under the `สินทรัพย์` filter bucket.

---

## Verification Checklist

- [x] CLI safety: `EXPECTED_DB_NAME` mismatch → abort ✓
- [x] CLI idempotent: upsert-only, no deletes ✓
- [x] Frontend uses correct API pattern ✓
- [x] `invalidateQueries` present on all mutations ✓
