# Merge Guard Report — `chore/card-reader-paths-filter`

**Date**: 2026-05-11  
**Branch**: `chore/card-reader-paths-filter`  
**Author**: Akenarin Kongdach  
**Last commit**: 2026-04-23 (`6405f7cf`)  
**Recommendation**: ✅ APPROVE

---

## File Changes Summary

| Commit | Description |
|--------|-------------|
| `6405f7cf` | ci(card-reader): only build on relevant path changes |
| `907da0b9` | fix(credit-check): prevent duplicate submissions + fix contradictory badges |
| `3d891170` | feat(line-oa): test-send all Flex templates (owner preview) (#672) |
| `359e0df6` | feat(customers): OWNER-only delete with active-contract block (#673) |

**TypeScript files modified**:

- `.github/workflows/build-card-reader.yml` (CI only)
- `apps/api/src/modules/credit-check/credit-check.service.ts`
- `apps/api/src/modules/credit-check/credit-check.service.spec.ts` (+3 tests)
- `apps/api/src/modules/customers/customers.controller.ts`
- `apps/api/src/modules/customers/customers.service.ts`
- `apps/api/src/modules/customers/customers.service.spec.ts` (+49 lines)
- `apps/api/src/modules/line-oa/line-oa.controller.ts`
- `apps/web/src/pages/CustomersPage.tsx`

---

## Issues by Severity

### Critical
_None found._

### Warning
_None found._

### Info

**I1 — CI path filter: `package-lock.json` change triggers full card-reader build**  
File: `.github/workflows/build-card-reader.yml`  
The path filter includes `package-lock.json` as a trigger for the Windows card-reader build. A routine `npm install` affecting only web or API dependencies will unnecessarily trigger the 5m30s Windows build.  
Action: Consider narrowing to `apps/card-reader/package.json` or `apps/card-reader/package-lock.json` if a separate lockfile exists there.

---

## Positive Changes (approve in spirit)

- **Customer DELETE restricted to `OWNER` only** — was previously accessible to `BRANCH_MANAGER`. Combined with the active-contract block check in `customers.service.ts`, this prevents accidental or unauthorized deletion of customers with active/overdue/default contracts.
- **Credit-check idempotency**: `createForCustomer` returns existing record for identical submissions within 30 seconds (double-click / retry protection). Identified by `{customerId, bankName, statementMonths, createdAt >= now-30s}`. Correctly includes `deletedAt: null` in the dedup query.
- **LINE OA Flex template registry** extended from 14 → 18 types. OWNER-only endpoint, no security concern.
- **Frontend**: Trash-icon delete action on `CustomersPage.tsx` gated behind OWNER role check + `ConfirmDialog` before calling DELETE.

---

## Recommendation

**✅ APPROVE** — All changes are additive security/correctness improvements. No critical or warning-level issues. The CI info item is low priority and can be addressed in a follow-up.
