# Merge Guard Report — `E2E-TEST`

**Date**: 2026-05-11  
**Branch**: `E2E-TEST`  
**Author**: iamnaii (Akenarin Kongdach)  
**Last commit**: 2026-04-03 (`c8aa9498`)  
**Recommendation**: ⚠️ REVIEW — stale branch, verify no merge conflicts before merging

---

## File Changes Summary

| Commit | Description |
|--------|-------------|
| `c8aa9498` | fix(security): wire up IDOR branch check in transfer detail controller |
| `518ed6c6` | fix(security): resolve 8 critical/high security and correctness bugs |
| `5594dbc6` | test: add comprehensive E2E test suite — 382 tests across 20 spec files |

**TypeScript files modified** (security commits `518ed6c6`, `c8aa9498`):

- `apps/api/src/modules/auth/auth.service.ts`
- `apps/api/src/modules/auth/auth.service.spec.ts`
- `apps/api/src/modules/contracts/contract-document.service.ts`
- `apps/api/src/modules/customers/customers.controller.ts`
- `apps/api/src/modules/customers/dto/document.dto.ts` (new file)
- `apps/api/src/modules/documents/documents.service.ts`
- `apps/api/src/modules/line-oa/line-oa.controller.ts`
- `apps/api/src/modules/overdue/overdue.service.ts`
- `apps/api/src/modules/payments/dto/payment.dto.ts`
- `apps/api/src/modules/payments/payments.service.ts`
- `apps/api/src/modules/products/products.controller.ts`
- `apps/api/src/modules/products/products-stock.service.ts`
- `apps/web/e2e/` (20 new spec files, 382 tests)

---

## Issues by Severity

### Critical
_None found in the security fix commits themselves._

### Warning

**W1 — Branch is 5+ weeks old, likely has merge conflicts with main**  
Last commit was 2026-04-03. Main has advanced by 50+ commits since then (based on shallow clone). Several files touched by this branch (`payments.service.ts`, `auth.service.ts`, `customers.controller.ts`) are high-activity files likely modified in subsequent PRs.  
Action: Rebase onto current main and resolve conflicts before merging. Run `./tools/check-types.sh all` after rebase.

### Info

**I1 — E2E tests may need updating after 5 weeks of product changes**  
File: `apps/web/e2e/` (20 spec files)  
The 382 E2E tests were written against the state of the app as of 2026-04-03. UI selectors, page routes, or API responses may have changed in subsequent PRs. Run `npx playwright test` after rebasing to identify broken specs.

---

## Security Fixes (all correct, approve in spirit)

**D1 (CRITICAL — fixed)**: Payment `transactionRef` idempotency check moved inside `$transaction` to prevent race condition causing duplicate payments.

**D2 (HIGH — fixed)**: Auth token rotation (revoke old + create new) wrapped in atomic `$transaction` to prevent user lockout on crash between the two operations.

**S12 (HIGH — fixed)**: `evidenceUrl` DTO now validates HTTPS URL format + `MaxLength` to prevent URL tampering with external/malicious URLs.

**E3 (MEDIUM — fixed)**: Real-time late fee calculation at payment time — if the nightly cron hasn't run yet, recalculates from `dueDate` + system config.

**NEW-4 (MEDIUM — fixed)**: `UploadDocumentDto` typed DTO replaces plain `{ url: string }` objects for customer document upload/delete endpoints.

**IDOR (HIGH — fixed)**: `GET /products/transfers/:transferId` now passes `@CurrentUser()` to `getTransferById()` in `products-stock.service.ts`, activating the previously-dead branch-level access check.

---

## Recommendation

**⚠️ REVIEW** — The security fixes in this branch are all correct and necessary. The only concern is **branch staleness**: it predates main by 5+ weeks. Recommend:

1. `git rebase origin/main` on this branch
2. Resolve any merge conflicts in `payments.service.ts`, `auth.service.ts`, `customers.controller.ts`
3. Run `./tools/check-types.sh all` — 0 errors required
4. Run `npx playwright test` — investigate any newly-broken specs
5. Then merge
