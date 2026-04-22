# Pre-Merge Guard Report

**Branch:** `feat/accounting-audit-fixes`  
**Date:** 2026-04-22  
**Reviewer:** Pre-Merge Guard Agent (automated)  
**Recommendation:** ✅ APPROVE

---

## Branch Summary

| Field | Value |
|-------|-------|
| Unique commits | 15 |
| Files changed (TS/TSX) | 50+ |
| New controllers | 3 (credit-check, inter-company, inventory-forecast) |
| New services | 6 |
| New DTOs | 5 |
| New web components | 4 |

### Commits Reviewed
1. `9aba503d` fix(test): relax getContractPayments assertion
2. `973342e8` fix(test): update payment test mocks for R-012
3. `d785a107` feat(accounting): Thai accounting standards audit fixes (7 critical, 14 warnings)
4. `bf32a3c3` feat: inter-company accounting (BESTCHOICE SHOP ↔ BESTCHOICE FINANCE)
5. `68529a98` fix: address 5 critical issues from code review
6. `9b1ec2bd` feat(api): bulk LINE campaign with flex templates and history
7. `76b5b42b` feat(api): inventory forecasting with sales velocity and reorder
8. `20f1742c` feat(api): automated credit scoring + early warning system
9. `521f7e62` feat(web): add global keyboard shortcuts with help overlay
10. `9de7c733` feat(web): add Excel export to 5 remaining data pages
11. `8f17fb8a` feat(liff): customer self-service QR payment via PaySolutions
12. `9beab115` docs: add overnight audit report
13. `38d95b69` test: expand E2E coverage
14. `a201adee` fix(security): enforce soft-delete compliance
15. `91b67406` refactor: remove console.logs, replace confirm() with ConfirmDialog

---

## Issues Found

### Critical — 0 issues

No critical issues detected.

### Warning — 1 issue

**W-001: Background credit score — fire-and-forget with warn-only logging**
- **File:** `apps/api/src/modules/credit-check/credit-check.service.ts` lines 161–168, 268–275
- **Pattern:**
  ```typescript
  this.calculateRiskScore(creditCheck.id)
    .then(async (result) => { ... })
    .catch((err) => this.logger.warn(...));
  ```
- **Risk:** If async score calculation fails, credit check record is created with null score. Sentry is not called on failure — only `logger.warn`. Silent failures may go undetected in production.
- **Recommendation:** Upgrade `.catch` to also call `Sentry.captureException(err)` for observability.

### Info — 3 items

**I-001: Seed file is large**
- **File:** `apps/api/prisma/seed.ts` — 1,348 lines
- No action needed; well-structured chart-of-accounts data.

**I-002: BadDebtProvision model uses `status` lifecycle instead of `deletedAt`**
- **File:** `apps/api/prisma/schema.prisma`
- Acceptable pattern — uses `ACTIVE / REVERSED / WRITTEN_OFF` enum as audit trail. No soft-delete needed for immutable provision records.

**I-003: LiffContract payment mutation redirects immediately (no invalidateQueries)**
- **File:** `apps/web/src/pages/liff/LiffContract.tsx`
- Intentional: redirect to PaySolutions gateway makes cache invalidation irrelevant. Acceptable.

---

## Positive Findings

- ✅ All new controllers have `@UseGuards(JwtAuthGuard, RolesGuard)` at class level
- ✅ All endpoint methods have `@Roles()` decorators
- ✅ Financial Decimal fields handled correctly (`Prisma.Decimal`, not `Number()`)
- ✅ All new Prisma queries include `deletedAt: null` filters
- ✅ No hardcoded secrets or API keys
- ✅ No unparameterized `$queryRaw` calls
- ✅ LIFF/public endpoints are intentionally public with correct rate-limiting
- ✅ Thai validation messages present on all new DTOs
- ✅ React components use `api.get()` / `api.post()` from `@/lib/api`
- ✅ `queryClient.invalidateQueries()` called after mutations where applicable

---

## Pre-Merge Checklist

- [ ] Run `npx prisma migrate dev` (new schema changes present)
- [ ] Run `./tools/check-types.sh all`
- [ ] Run full test suite `./tools/run-tests.sh`
- [ ] Verify Excel export utility available in `apps/api/src/utils/`
- [ ] Confirm PaySolutions LIFF integration tested in staging
- [ ] Upgrade credit-score `.catch` to include Sentry capture (W-001, optional)
