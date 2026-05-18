# Merge Guard Report — hotfix/pdpa-extract-pii-module

**Date**: 2026-05-18  
**Branch**: `hotfix/pdpa-extract-pii-module`  
**Author**: Akenarin Kongdach  
**Base**: `origin/main`

---

## File Changes Summary

| File | Status | Lines |
|------|--------|-------|
| `apps/api/src/modules/customers/customer-pii.module.ts` | NEW | +22 |
| `apps/api/src/modules/customers/customers.module.ts` | MODIFIED | +4/-7 |
| `apps/api/src/modules/pdpa/pdpa.module.ts` | MODIFIED | +10/-2 |

**Total**: 3 files, +33/−6

---

## Context

This hotfix resolves a production boot crash introduced when `P3-SP4` (#1015) and `P3-SP5` (#1016) merged to `main`. `PDPAModule` was importing `CustomersModule`, which transitively pulled in `OverdueModule → ChatEngineModule → StaffChatModule`, creating a circular dependency that crashed the NestJS bootstrap with:

> "Nest cannot create the PDPAModule instance. The module at index [1] of the PDPAModule 'imports' array is undefined."

**Fix approach**: Extract `CustomerPiiService` into a leaf `CustomerPiiModule` that depends only on `PrismaModule`. `PDPAModule` now imports this leaf module directly, avoiding the transitive cycle entirely.

---

## Issues by Severity

### Critical
_None found._

### Warning
_None found._

### Info

**I-1**: This branch is a superset of `hotfix/pdpa-circular-import` (identical code, plus one empty CI-trigger commit `5fd0ad28`). Both branches target the same fix. Merge `pdpa-extract-pii-module` (the newer one) and close/delete `pdpa-circular-import` to avoid confusion.

---

## Verification Checklist

- [x] New `CustomerPiiModule` has `@UseGuards` — N/A (module has no controller)
- [x] `PDPAModule` still imports `AuthModule` without `forwardRef` wrapping (cleaned up from intermediate commit)
- [x] `CustomerPiiService` is re-exported from `CustomersModule` via `CustomerPiiModule` — existing consumers unaffected
- [x] No `Number()` on money fields
- [x] No hardcoded secrets
- [x] No raw SQL

---

## Recommendation

**APPROVE**

Clean, minimal hotfix. The leaf-module extraction is the correct long-term solution (preferable to `forwardRef` which masks structural issues). No security or data-integrity concerns.
