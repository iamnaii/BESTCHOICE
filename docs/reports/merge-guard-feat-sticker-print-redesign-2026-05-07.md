# Pre-Merge Guard Report

**Branch**: `feat/sticker-print-redesign`
**Author**: Akenarin Kongdach
**Date**: 2026-05-07
**Reviewer**: Pre-Merge Guard (automated)

---

## File Changes Summary

- **33 files changed**, 3,932 insertions(+), 2,129 deletions(-)
- `apps/web/src/pages/StickerPrintPage.tsx` — major redesign (+338/-338 net change)
- `apps/web/src/pages/StockPage/index.tsx` — wire sticker print into manager toolbar
- `apps/web/src/pages/PricingTemplatesPage.tsx` — add rate1/rate2 down + term inputs
- `apps/web/src/pages/SettingsPage/components/StickerSettings.tsx` — new sticker config UI
- Prisma schema: new `StickerTemplate` soft-delete + `hasWarranty` field, batch limit
- Plan docs: `docs/plans/2026-05-07-product-sticker-print.md` (1,493 lines)

**Note**: This branch is a subset of `feat/payment-method-config-qr` (commits are shared up to and including the sticker work). If `payment-method-config-qr` merges first, this branch becomes stale.

---

## Issues

### 🔴 Critical (must fix before merge)

No critical security issues found. Guards, roles, and soft-delete filters are correctly applied on new API surface.

---

### 🟡 Warning (should fix)

#### W-1: `Number()` on Prisma Decimal pricing fields
**Files**: `apps/web/src/pages/StickerPrintPage.tsx`, `apps/web/src/pages/SettingsPage/components/StickerSettings.tsx`

```ts
cashPrice: pricing ? Number(pricing.cashPrice) : null,
Number(pricing.rate1DownPayment)
Number(pricing.installmentBestchoicePrice)
Number(pricing.rate2DownPayment)
Number(pricing.installmentFinancePrice)
```

`pricing.*` fields come from the `PricingTemplate` model where these are `Decimal` type. The values are used for display (sticker label rendering), so precision loss is unlikely to matter for typical Thai baht amounts. However it is inconsistent with the v4 hardening rule that eliminated `Number()` on all Decimal financial fields.

**Fix**: Use `.toNumber()` instead of `Number()` for clarity, or accept as-is given pure display context. If passing these values to any calculation (e.g., computing totals on the sticker), switch to `Prisma.Decimal` arithmetic instead.

---

#### W-2: `onChange` handlers use inline `Number()` without input validation
**File**: `apps/web/src/pages/StickerPrintPage.tsx`

```tsx
onChange={(e) => setForm((f) => ({ ...f, rate1DownPayment: e.target.value === '' ? undefined : Number(e.target.value) }))}
```

If the user types a non-numeric value (e.g., "abc"), `Number("abc")` returns `NaN` which silently poisons the form state. There is no validation before the conversion.

**Fix**: Use `parseFloat` with a fallback or validate with `isNaN()`:
```tsx
const val = parseFloat(e.target.value);
rate1DownPayment: isNaN(val) ? undefined : val
```
Or switch the form to react-hook-form + zod (consistent with the v4 POS/Customers modernization).

---

### ℹ️ Info

#### I-1: `StickerTemplate` model correctly uses soft-delete pattern
New `StickerTemplate` model has `deletedAt DateTime?`, UUID pk, and `createdAt`/`updatedAt`. The service correctly filters with `deletedAt: null`. Batch limit guard prevents oversized requests. No concerns.

#### I-2: Plan doc committed to `docs/plans/` (1,493 lines)
Large plan doc is checked in. This is acceptable as project documentation but may become stale as the feature evolves. Consider moving to a `docs/specs/` directory for archival clarity.

---

## Summary

| Severity | Count | Status |
|----------|-------|--------|
| Critical | 0 | — |
| Warning  | 2 | Should fix |
| Info     | 2 | Low priority |

## Recommendation: 🟡 REVIEW

No blocking issues. Two warnings should be addressed before merge:
- **W-1** (Decimal/Number pattern inconsistency) is low risk for display-only fields but violates the v4 hardening convention
- **W-2** (NaN from `Number()` on free-text input) can silently corrupt form state

If `feat/payment-method-config-qr` merges first, this branch should be rebased to avoid re-introducing any stale code.
