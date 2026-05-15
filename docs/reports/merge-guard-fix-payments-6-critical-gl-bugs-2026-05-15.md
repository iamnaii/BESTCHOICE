# Merge Guard Report — fix/payments-6-critical-gl-bugs

**Date**: 2026-05-15  
**Branch**: `fix/payments-6-critical-gl-bugs`  
**Author**: Akenarin Kongdach  
**Reviewed against**: `origin/main`

---

## File Changes Summary

| Category | Count |
|---|---|
| Files changed | 24 |
| Insertions | +1,020 |
| Deletions | -203 |

**Key files touched:**
- `apps/api/src/modules/payments/payments.service.ts` — 206 lines changed
- `apps/api/src/modules/paysolutions/paysolutions.service.ts` — major refactor
- `apps/api/src/modules/journal/cpa-templates/early-payoff-jp4.template.ts` — VAT 60-day reversal wired
- `apps/api/src/modules/journal/cpa-templates/vat-60day-reversal.template.ts` — W8 legacy fallback + Sentry
- `apps/api/src/modules/receipts/receipts.service.ts` — Thai PDF font embed + Decimal precision
- `apps/api/src/utils/thai-date.util.ts` — BKK timezone fix across all formatters
- `apps/api/src/modules/payments/payments.controller.ts` — branch guard on 4 endpoints
- `apps/api/src/assets/fonts/embedded-fonts.ts` — new file (Thai font embed)
- `apps/web/src/pages/PaymentsPage/` — 2 frontend files (late-fee pre-fill, lateFee payload)

---

## Issues by Severity

### Critical — None Found

All critical checks passed:

- **Guards**: `PaymentsController` already has `@UseGuards(JwtAuthGuard, RolesGuard)` at class level. The new `validateBranchAccessByPayment()` helper closes a cross-branch bypass on `waive-late-fee`, `createPartialQr`, `getActivePartialQr`, and `cancelPartialQr` endpoints — these routes now validate branch access explicitly since the class-level `BranchGuard` only fires when `branchId` is in the request body.
- **`PaySolutionsController`**: still correctly exempt from `JwtAuthGuard` (uses `LiffTokenGuard` on LIFF endpoints, HMAC signature verification on webhook). Matches the documented public endpoint allow-list.
- **`Number()` on money**: all previous `Number()` calls on financial fields replaced with `Prisma.Decimal`. New `creditBalance` return changed from `Number()` to `.toFixed(2)` string. `lateFeeDec`, `totalOwedDec`, `amountPaidDec` all use `Prisma.Decimal`. The `toNumber()` usages in `receipts.service.ts` are display-only (PDF HTML template, not stored back to DB) — acceptable per convention.
- **`deletedAt: null`**: all new queries include soft-delete filter. `validateBranchAccessByPayment` checks `payment.deletedAt` and `contract.deletedAt` after fetch. `payment.count` for LINE receipt counter now includes `deletedAt: null` (I6 fix).
- **No hardcoded secrets or API keys** found.
- **SQL injection**: the only raw SQL call (`$executeRawUnsafe` for advisory lock in expenses branch, not this branch) is properly parameterized. This branch has no new raw SQL.
- **`@Roles()`**: all new/modified controller methods have `@Roles()` decorators.

---

### Warning — 1 Found

**W-PAY-01: `toNumber()` on receipt display fields — acceptable but worth noting**

`apps/api/src/modules/receipts/receipts.service.ts` lines 717-725:
```ts
const total = toDec(receipt.amount).toNumber();
const amountBeforeVat = receipt.amountBeforeVat ? toDec(receipt.amountBeforeVat).toNumber() : null;
```
These values are passed to a PDF HTML template for display formatting. The `toDec()` helper ensures full Decimal precision before `toNumber()` — values go through `fmt()` which calls `.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })`. This matches the comment's intent ("Display uses `.toFixed(2)` before Intl.NumberFormat so the print output is satang-accurate"). The conversion to number is safe here since amounts are capped at `Decimal(12,2)` in the DB schema (well within IEEE-754 safe integer range). **Verdict: acceptable — no action required**, but annotated for future reviewers.

---

### Info — 2 Items

**I-PAY-01: CSV idempotency hash comment references backfill**

`payments.service.ts` — the new SHA-256 stable ref for CSV import correctly uses BKK timezone for date component. Comment explains the "Round 2 C6 fix" rationale (UTC vs BKK midnight). No code issue — the `stableRef` logic is correct.

**I-PAY-02: Vat60day reversal legacy fallback TODO**

`vat-60day-reversal.template.ts` — the `TODO` references a backfill script (`backfill-vat60-metadata.cli.ts`) that doesn't exist yet. The Sentry warning captures context to identify how many contracts need backfill. This is a known deferred task, not a blocker, but should be tracked.

---

## Security Checks

| Check | Result |
|---|---|
| `JwtAuthGuard` on all new controllers | ✅ Pass (controller is existing, already guarded) |
| `@Roles()` on all new methods | ✅ Pass |
| No `Number()` on stored money fields | ✅ Pass |
| `deletedAt: null` in all new queries | ✅ Pass |
| No hardcoded secrets/API keys | ✅ Pass |
| SQL injection (parameterized raw SQL) | ✅ Pass (no new raw SQL) |
| DTO validation decorators | ✅ Pass (`lateFee` field has `@IsOptional()`, `@IsNumber()`, `@Min(0)`) |
| Frontend uses `api.get()`/`api.post()` (no raw fetch) | ✅ Pass |
| `queryClient.invalidateQueries()` after mutations | ✅ Pass (existing pattern, not changed) |
| Thai validation messages on DTOs | ✅ Pass |

---

## Recommendation: **APPROVE**

This branch fixes 6 confirmed GL production bugs (branch-guard bypass, deposit account code mis-routing, audit trail gaps, Decimal precision, idempotency, LINE receipt counter). All critical patterns are correctly followed. One minor display-layer `toNumber()` is annotated but not a bug. The Vat60day backfill TODO should be tracked as a follow-up issue.
