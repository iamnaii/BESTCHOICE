# Merge Guard Report — `fix/payments-6-critical-gl-bugs`

**Date**: 2026-05-16  
**Author**: Akenarin Kongdach  
**Branch**: `fix/payments-6-critical-gl-bugs` vs `main`  
**Commits**: 7  
**Files changed**: 24 (+1,020 / −203)

---

## File Changes Summary

| File | Change |
|------|--------|
| `payments.service.ts` | +206 / −2 — branch access, credit-delta, BKK TZ, Decimal precision |
| `paysolutions.service.ts` | +124 / −56 — atomicity, Sentry on JE failure, re-throw on webhook |
| `paysolutions.controller.ts` | +38 / −5 — Sentry capture on webhook failure; re-throw |
| `payments.controller.ts` | +28 / −6 — explicit branch access on 4 methods (W1 fix) |
| `receipts.service.ts` | +52 / −10 — BKK TZ receipt numbering; Thai font embed; Decimal display |
| `early-payoff-jp4.template.ts` | +22 / −0 — required Vat60dayReversal injection; 60d VAT cleanup |
| `payment-receipt-2b.template.ts` | +23 / −0 — late-fee GL fix |
| `vat-60day-reversal.template.ts` | +53 / −0 — reversal template extended |
| `reschedule.service.ts` | +22 / −0 — reschedule late-fee handling |
| `thai-date.util.ts` | +89 / −27 — BKK timezone date helpers |
| `payment.dto.ts` | +11 / −0 — DTO additions |
| `RecordPaymentWizard.tsx` | +6 / −0 — pre-fill lateFee from server |
| `PaymentsPage/index.tsx` | +6 / −0 — UI guard |
| Font assets (2 × .ttf) | New — embedded Thai fonts for PDF |
| 7 test files | +466 / −100 — coverage for all fixes |

---

## Issues Found

### Critical — None ✅

- No new unguarded controllers; existing controllers have `@UseGuards(JwtAuthGuard, RolesGuard)` and `@Roles(...)` intact
- `paysolutions.controller.ts` (intentionally public) unchanged — still on the allow-list
- Branch access enforced explicitly on 4 controller methods that BranchGuard missed (W1 fix): `waiveLateFee`, `createPartialQr`, `getActivePartialQr`, `cancelPartialQr`
- All new Prisma queries include `deletedAt: null`
- No hardcoded secrets
- No `$queryRaw` added
- No raw `fetch()` in frontend

### Warning

- **`.toDecimalPlaces(2).toNumber()` on aggregate totals** in `payments.service.ts` (`totalAmount`, `totalLateFees` in daily summary).  
  These values are returned as plain JSON to the UI summary card and are display-only. The arithmetic is done via `Prisma.Decimal` before `.toNumber()` is called, so precision is preserved for calculation. The concern is that `.toNumber()` at the aggregate layer could silently lose sub-satang precision in edge cases. Suggested follow-up: consider returning these as `string` (`.toFixed(2)`) to be consistent with other financial API responses.

- **`.toNumber()` in `receipts.service.ts` PDF generation** — `toDec(amount).toNumber()` pattern is used for PDF display values. All arithmetic runs through `Prisma.Decimal`; `.toNumber()` is only called at the HTML template boundary where `Intl.NumberFormat` takes over. This is acceptable but worth noting.

### Info

- `payments.service.ts` is **2,026 lines** and `paysolutions.service.ts` is **1,815 lines** — both exceed 500-line threshold. Split (e.g., `PaymentQueryService`, `PaymentMutationService`) recommended for a future chore.
- `vat60Reversal` dependency changed from `@Optional()` to required in `EarlyPayoffJP4Template` — startup failure is now explicit rather than silent runtime skip. This is a positive safety change.
- Binary font assets (`.ttf`) added to `apps/api/src/assets/fonts/` — legitimate fix for Cloud Run PDF rendering. `nest-cli.json` updated to bundle them into `dist/`.

---

## Key Fixes Verified

| Fix ID | Description | Verified |
|--------|-------------|---------|
| C1 (payments) | Late-fee posted to 42-1103 (was missing GL entry) | ✅ |
| C2 | PaySolutions webhook atomicity: JE + Payment in same `$transaction` | ✅ |
| C3 | VAT 60-day reversal on early payoff (11-2104/21-2103 cleanup) | ✅ |
| C4 | Credit-delta precision via Prisma.Decimal | ✅ |
| C5 | PDF timezone fix (BKK) + embedded Thai fonts | ✅ |
| C6 | CSV import idempotency | ✅ |
| Round 2 C1 | Sentry capture on PaySolutions JE failure + re-throw for retry | ✅ |
| W1 | Explicit branch access on 4 controller methods | ✅ |

---

## Recommendation

**APPROVE** ✅ (with follow-up note)

No blocking issues. The branch-access gaps (W1) are correctly plugged. PaySolutions webhook now surfaces JE failures to Sentry and re-throws for retry — this matches the runbook in the code comment. The Warning on `.toDecimalPlaces(2).toNumber()` for aggregate display is acceptable for summary-card use cases but should be addressed in a follow-up chore (return as string).
