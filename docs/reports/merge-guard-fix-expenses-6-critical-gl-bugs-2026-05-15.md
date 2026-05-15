# Merge Guard Report — fix/expenses-6-critical-gl-bugs

**Date**: 2026-05-15  
**Branch**: `fix/expenses-6-critical-gl-bugs`  
**Author**: Akenarin Kongdach  
**Reviewed against**: `origin/main`

---

## File Changes Summary

| Category | Count |
|---|---|
| Files changed | 23 |
| Insertions | +1,822 |
| Deletions | -111 |

**Key files touched:**
- `apps/api/src/modules/expense-documents/expense-documents.service.ts` — 362 lines changed (largest change)
- `apps/api/src/modules/journal/journal-auto.service.ts` — C9 period guard removed from `createAndPost`
- `apps/api/src/modules/journal/cpa-templates/vendor-settlement.template.ts` — major update
- `apps/api/src/modules/expense-documents/services/je-preview.service.ts` — 92 lines
- `apps/api/src/modules/journal/utils/wht-form-type.ts` — new utility
- `apps/web/src/pages/PaymentVoucherPage.tsx` — WHT certificate Decimal precision
- `apps/web/src/pages/PaymentVoucherPage.test.tsx` — new test file (110 lines)
- `apps/web/src/components/expense-form-v4/ExpenseFormV4.tsx` — BKK timezone fix + JE preview gating

---

## Issues by Severity

### Critical — None Found

All critical checks passed:

- **Guards**: No new controllers introduced. All existing controllers retain `@UseGuards(JwtAuthGuard, RolesGuard)`. The `ExpenseDocumentsService` changes are service-layer only.
- **`Number()` on money**: The one new addition `Number.isFinite(Number(rawThreshold))` is a config threshold check (non-financial, non-stored value) — acceptable. All financial computation uses `Prisma.Decimal` or `decimal.js`.
- **`deletedAt: null`**: All new `findFirst`/`findMany` queries on `companyInfo`, `chartOfAccount`, and `expenseDocument` include `deletedAt: null`. Verified on `shopForPeriod`, `shopForVoidPeriod`, and `shop` lookups.
- **Hardcoded secrets**: None found.
- **SQL injection**: The `$executeRawUnsafe` for `pg_advisory_xact_lock(hashtext($1))` is parameterized with `dto.originalDocumentId` as a proper argument. No string interpolation into raw SQL.
- **`@Roles()`**: No new endpoints introduced. No change to roles on existing endpoints.

**Critical architectural change verified safe**: Removing `validatePeriodOpen()` from `JournalAutoService.createAndPost()` (C9 fix). The commit comment documents the 10 verified call sites that already guard period-lock at their own service boundaries. The period guard was actually *breaking* atomicity (a reopened period would roll back the Payment record mid-transaction). Removal is correct per the documented analysis.

---

### Warning — 2 Found

**W-EXP-01: `ADJUSTMENT_ALLOWLIST` boot-validation depends on seeded CoA**

`expense-documents.service.ts` — `onModuleInit()` validates that all 4 allowlist codes (`52-1104`, `52-1106`, `53-1303`, `53-1503`) exist in `chart_of_accounts`. If the app boots against a fresh DB before the accounting wipe+reseed (Phase A.4 migration sequence), it will throw a startup error and crash the module. This is *intentional design* (fail loud) per the comment, and matches the Phase A.4 deployment runbook. **Verify that staging/prod migration sequences run wipe+reseed before deploying this branch.** No code change required.

**W-EXP-02: `PaymentVoucherPage.tsx` — hardcoded Tailwind color class `text-emerald-600`**

`apps/web/src/pages/PaymentVoucherPage.tsx` (via `AssetEntryPage.tsx` diff context, confirmed in the VoucherPage diff):
```tsx
className="inline-flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400"
```
The frontend rules prohibit hardcoded Tailwind color classes — should use `text-primary` or a CSS variable token. However, this specific usage is for a "validation passed" state indicator, and `text-emerald-600` matches the theme's primary emerald accent. The dark variant `dark:text-emerald-400` is also present. Minor rules violation — no functional risk, but inconsistent with the `AssetStatusBadge.tsx` approach (which also uses `text-emerald-600`).

**Action**: Consider replacing with `text-primary` token on a follow-up cleanup PR. Not a blocker.

---

### Info — 2 Items

**I-EXP-01: `wht-form-type.ts` utility — good centralization**

New `apps/api/src/modules/journal/utils/wht-form-type.ts` exports `assertWhtFormType()` and `isWhtFormType()`. This consolidates scattered `!== 'PND3' && !== 'PND53'` checks. The 48-line test file `wht-form-type.spec.ts` covers the utility fully. No issues.

**I-EXP-02: `expenseDocument.findOne` — 2 round-trips**

`expense-documents.service.ts` — `findOne()` now does a first query for `documentType` and then a second typed query. This is a pragmatic workaround for Prisma's conditional include limitation. For a read path the extra roundtrip is acceptable (~1ms PostgreSQL round-trip on Cloud Run same-region). Not worth adding complexity for.

---

## Security Checks

| Check | Result |
|---|---|
| `JwtAuthGuard` on all new controllers | ✅ Pass (no new controllers) |
| `@Roles()` on all new methods | ✅ Pass (no new endpoints) |
| No `Number()` on stored money fields | ✅ Pass (only config threshold check) |
| `deletedAt: null` in all new queries | ✅ Pass |
| No hardcoded secrets/API keys | ✅ Pass |
| SQL injection (parameterized raw SQL) | ✅ Pass (`$executeRawUnsafe` properly parameterized) |
| DTO validation decorators | ✅ Pass (`create-payroll.dto.ts` changes reviewed — validators present) |
| Frontend uses `api.get()`/`api.post()` (no raw fetch) | ✅ Pass |
| `queryClient.invalidateQueries()` after mutations | ✅ Pass (no new mutations introduced) |
| Thai validation messages on DTOs | ✅ Pass |

---

## Recommendation: **APPROVE**

The branch fixes 6 GL bugs across the expense module: adjustment account allow-list, aging date calculation (BKK calendar days), CN lock order, period guard placement, daily summary multi-line attribution, and WHT certificate Decimal precision. The C9 period-guard removal from `createAndPost` is the riskiest change but is well-justified with a documented inventory of all guarded call sites. Two minor warnings: deployment sequencing for `onModuleInit` CoA validation, and a non-blocking Tailwind color token violation. Neither blocks merge.
