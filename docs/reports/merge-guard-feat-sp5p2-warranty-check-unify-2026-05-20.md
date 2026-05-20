# Merge Guard Report — feat/sp5p2-warranty-check-unify

**Date**: 2026-05-20  
**Branch**: `feat/sp5p2-warranty-check-unify`  
**Author**: Akenarin Kongdach  
**Reviewer**: Pre-Merge Guard (automated)

---

## File Changes Summary

| Category | Count |
|---|---|
| Files changed | 12 |
| Insertions | +1,048 |
| Deletions | −579 |

Key files:
- `apps/web/src/pages/insurance/WarrantyCheckPage.tsx` — **new** (172 lines)
- `apps/web/src/pages/insurance/WarrantyCheckPage.test.tsx` — **new** (215 lines)
- `apps/web/src/pages/insurance/CreateRepairTicketPage.tsx` — **deleted** (528 lines, replaced by wizard flow)
- `apps/web/e2e/insurance-warranty-check.spec.ts` — **new** E2E smoke spec (225 lines)
- `apps/web/e2e/insurance-wizard-repair.spec.ts` — **new** E2E smoke spec
- `apps/web/e2e/insurance-wizard-exchange.spec.ts` — **new** E2E smoke spec
- `apps/web/src/components/DefectExchangeRedirect.tsx` — **new** redirect component

---

## Issues Found

### Critical
_None found._

### Warning
_None found._

### Info
_None found._

---

## Security Checks

| Check | Result |
|---|---|
| New controllers with missing `@UseGuards` | ✅ No new controllers |
| `Number()` on money/Decimal fields | ✅ None |
| `findMany`/`findFirst` missing `deletedAt: null` | ✅ None (no new queries) |
| Hardcoded secrets / API keys | ✅ None |
| Raw `fetch()` in React components | ✅ None — uses `api.get()` + `useQuery` correctly |
| Unparameterized `$queryRaw` | ✅ None |
| Missing `@Roles()` on controller methods | ✅ N/A (no new controllers) |

---

## Pattern Compliance

- `WarrantyCheckPage.tsx` uses `useQuery` + `api.get()` — correct pattern
- No `useEffect` + raw `fetch()` data fetching
- No `any` types in new files
- E2E specs follow existing `loginViaAPI` + `gotoWithRetry` helper pattern
- Test file includes `test.skip()` fallbacks for DB-drift in local environments (resilient CI pattern)

---

## Recommendation

**✅ APPROVE**

Branch is clean: no backend changes (frontend + E2E only), proper React Query patterns throughout, thorough test coverage including unit tests and 3 new E2E smoke specs. Old `CreateRepairTicketPage.tsx` safely replaced by the wizard flow introduced in `feat/sp5p2-wizard`.
