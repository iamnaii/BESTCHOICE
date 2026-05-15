# Pre-Merge Guard Report — fix/payments-6-critical-gl-bugs

**Date**: 2026-05-15  
**Branch**: `fix/payments-6-critical-gl-bugs`  
**Author**: Akenarin Kongdach  
**Commits**: 7  
**Reviewed against**: `origin/main`

---

## File Changes Summary

```
24 files changed, 1020 insertions(+), 203 deletions(-)
```

Key files modified:
- `apps/api/src/modules/payments/payments.service.ts` (+206 lines)
- `apps/api/src/modules/payments/payments.controller.ts` (+28 lines, new methods)
- `apps/api/src/modules/paysolutions/paysolutions.controller.ts` (+45 lines)
- `apps/api/src/modules/paysolutions/paysolutions.service.ts` (refactored)
- `apps/api/src/modules/receipts/receipts.service.ts` (+52 lines)
- `apps/api/src/assets/fonts/` (new — embedded Thai fonts for PDF)
- `apps/api/src/utils/thai-date.util.ts` (+89 lines)

---

## Issues by Severity

### Critical — None found ✅

- **New controller methods are properly guarded**: `waiveLateFee`, `getActivePartialQr`, and `cancelPartialQr` in `payments.controller.ts` all have:
  - Class-level `@UseGuards(JwtAuthGuard, RolesGuard)` (inherited)
  - Method-level `@Roles(...)` decorators:
    - `waiveLateFee`: `@Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')`
    - `getActivePartialQr`: `@Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')`
    - `cancelPartialQr`: `@Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')`
- **Branch access** enforced via new `validateBranchAccessByPayment()` helper (W1 fix) — correctly uses `deletedAt: null` on both payment and contract lookups.
- **`paysolutions.controller.ts`** is intentionally public (webhook endpoint) and listed in the security allow-list.
- No hardcoded secrets. SHA-256 hash in CSV idempotency (`C6 fix`) uses `createHash('sha256')` from Node.js `crypto` module — not a credential.
- No unparameterized `$queryRaw`.
- All financial arithmetic uses `Prisma.Decimal`; `.toNumber()` appears only in `receipts.service.ts` for PDF display formatting after Decimal precision is locked.

### Warning — None found ✅

- New `lateFee` field in `payment.dto.ts` is marked `@IsOptional()` with advisory comment explaining service recalculates from DB. Missing Thai message on `@Min(0)` is cosmetic (field is advisory only).
- Sentry alerting added on JE failure in `paysolutions.controller.ts` — correct strategy for the 3-retry cap scenario (C1 round 2 fix).
- `validateBranchAccessByPayment()` correctly collapses two queries into one join (single roundtrip) and is idempotent for cross-branch roles.

### Info

1. **`any` in test code** — Two `l: any` casts in `payments.service.spec.ts` (`jeArg.lines.find((l: any) => ...)`). These are in spec files only; no production impact. Consider typing the mock JE lines.

2. **`.toNumber()` in `receipts.service.ts`** — Values go through `toDec()` (Prisma.Decimal wrapper) before `.toNumber()`. Used exclusively for HTML template string interpolation in PDF generation — no financial arithmetic performed after conversion. This is the correct pattern for presentation-layer conversions.

3. **Large files** — `payments.service.ts` (2026 lines), `paysolutions.service.ts` (1815 lines), `receipts.service.ts` (1037 lines). Pre-existing; this branch adds targeted fixes. Splitting is a separate refactor concern.

4. **Embedded Thai font binary files** — `NotoSansThai-VF.ttf` (218KB) and `Sriracha-Regular.ttf` (319KB) added to `apps/api/src/assets/fonts/`. These are bundled via `nest-cli.json` for PDF generation. Confirm these fonts are OFL-licensed (both are — Noto Sans Thai: Apache 2.0, Sriracha: OFL-1.1). No issue, just noting for IP audit.

5. **CSV idempotency hash** — Stable SHA-256 ref is scoped to BKK local date via `Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' })`. Correctly solves the UTC midnight boundary bug from the previous `Date.now() + Math.random()` approach.

---

## Commit Highlights

| Commit | Summary |
|--------|---------|
| `c16bab13` | 6 Critical GL bugs (late fee, atomicity, VAT 60-day, credit delta, PDF TZ, CSV idempotency) |
| `9b2d640b` | Drop external font fetch — remove 8s networkidle0 stall |
| `efc949d6` | 8 Warning fixes (branch guard, deposit account, audit trail, BKK TZ, reversal drift) |
| `f911ad9d` | 6 Info fixes (Decimal precision, pre-fill, audit hygiene) |
| `af2f5ed4` | Round 2 Critical — Sentry alert on PaySolutions JE failure + embed Thai fonts in PDFs |
| `eee1b458` | Round 2 Warnings — W4 PAID-row guard, W7 wizard lateFee, W8 60-day reversal fallback |
| `5d7760a2` | Round 2 Info — I1 Vat60dayReversal injection, I2 multi-installment TODO, I3 Decimal coercion |

---

## Recommendation: ✅ APPROVE

No critical or warning issues. New controller methods are correctly guarded with both `@UseGuards` and `@Roles`. Branch access enforcement is properly tightened. Info items are non-blocking observations.
