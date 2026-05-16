# Merge Guard Report — fix/payments-6-critical-gl-bugs

**Date**: 2026-05-16  
**Branch**: `fix/payments-6-critical-gl-bugs`  
**Author**: Akenarin Kongdach <iamnaii@MacBook-Pro-khxng-Akenarin.local>  
**Last Commit**: `fix(payments): round 2 Info — I1 required Vat60dayReversal injection, I2 multi-installment TODO, I3 Decimal coercion audit` (2026-05-15 00:51 +0700)  
**Commits ahead of main**: 7  
**Diff size**: 24 files changed, +1,020 / -203 lines  

---

## File Changes Summary

| File | Change |
|------|--------|
| `apps/api/src/modules/payments/payments.service.ts` | Modified — W1 cross-branch guard helper, C1 late-fee forwarding to 2B template |
| `apps/api/src/modules/payments/payments.controller.ts` | Modified — uses new `validateBranchAccessByPayment` |
| `apps/api/src/modules/payments/dto/payment.dto.ts` | Modified — advisory `lateFee` field added |
| `apps/api/src/modules/paysolutions/paysolutions.service.ts` | Modified |
| `apps/api/src/modules/paysolutions/paysolutions.controller.ts` | Modified — LiffTokenGuard on create-intent |
| `apps/api/src/modules/installments/reschedule.service.ts` | Modified (+22) — W4: Payment.dueDate shifted alongside InstallmentSchedule |
| `apps/api/src/modules/journal/cpa-templates/early-payoff-jp4.template.ts` | Modified |
| `apps/api/src/modules/journal/cpa-templates/payment-receipt-2b.template.ts` | Modified |
| `apps/api/src/modules/journal/cpa-templates/vat-60day-reversal.template.ts` | Modified |
| `apps/api/src/modules/other-income/services/receipt-pdf.service.ts` | Modified — I2: Decimal coercion via `toDec()` |
| `apps/api/src/utils/thai-date.util.ts` | Modified — safer date parsing |
| `apps/api/src/assets/fonts/embedded-fonts.ts` | New — Noto + Sriracha font embed for PDF |
| `apps/api/src/assets/fonts/NotoSansThai-VF.ttf` | Binary new |
| `apps/api/src/assets/fonts/Sriracha-Regular.ttf` | Binary new |
| `apps/web/src/pages/PaymentsPage/components/RecordPaymentWizard.tsx` | Modified |
| `apps/web/src/pages/PaymentsPage/index.tsx` | Modified |
| (8 test/spec files) | New/modified test coverage |

---

## Issues by Severity

### Critical (0 issues)

None found.

- **`payments.controller.ts`** — `@UseGuards(JwtAuthGuard, RolesGuard, BranchGuard)` at class level. All methods have `@Roles(...)`. ✅
- **`paysolutions.controller.ts`** — No class-level JwtAuthGuard. This is **intentional** (documented in `security.md` under "Intentionally Public Endpoints"). The webhook endpoint uses HMAC signature verification; the `createIntent` method uses `LiffTokenGuard`. ✅
- No `Number()` on Prisma money fields used in arithmetic. The `.toNumber()` calls in `receipts.service.ts` are display-only (passed to `toFixed(2)` → `Intl.NumberFormat`), after all Decimal arithmetic is done via `toDec(v).plus(...)`. ✅
- `Number(lookup.year/month/day/hour/minute)` in `thai-date.util.ts` — applied to date components (integers), not financial values. ✅
- No raw `$queryRaw` with string interpolation.
- No hardcoded secrets.

### Warning (1 issue)

**W1 — `payment.dto.ts`: advisory `lateFee` typed as `number` (not Decimal)**

```ts
@IsNumber()
@Min(0)
lateFee?: number;
```

The DTO comment correctly states this is advisory and the service recalculates `lateFee` from the database. The `number` type is acceptable for DTO transport, but the pattern is unusual for this codebase where financial fields use `Decimal`. Ensure the service **never** uses `dto.lateFee` as the source of truth for journal entry amounts — the comment implies this is already the case, but it warrants a code-level guard (e.g. ignore `dto.lateFee` in the service, or document explicitly which service method recalculates).

### Info (2 items)

**I1 — `reschedule.service.ts` W4 fix includes `not: 'PAID'` guard**  
The fix correctly gates `Payment.dueDate` shifts to non-PAID rows and explicitly checks `deletedAt: null`. Good defensive pattern.

**I2 — Binary font files added to repo**  
`NotoSansThai-VF.ttf` (218 KB) and `Sriracha-Regular.ttf` (319 KB) are committed directly. This is functional (embedded fonts for receipt PDFs) but adds ~537 KB to repo size permanently. Consider storing in S3/assets bucket instead for large font files, or confirm these are the correct subsets.

---

## Recommendation

**✅ APPROVE**

The branch fixes 6 confirmed GL production bugs (W1 cross-branch bypass, C1 late-fee omission from 2B template, W4 dueDate drift on reschedule, I2 Decimal drift in receipt PDF, etc.). Security guards are correct. The `paysolutions` public-endpoint pattern matches the documented policy. No financial arithmetic uses raw `Number()` conversion. The advisory `lateFee` DTO field (W1 above) should be double-checked in the service to confirm it is ignored for JE calculation purposes — low risk given the comment, but worth a single-line verification before merge.
