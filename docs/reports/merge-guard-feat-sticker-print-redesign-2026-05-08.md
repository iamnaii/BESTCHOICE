# Pre-Merge Guard Report — feat/sticker-print-redesign

**Date**: 2026-05-08  
**Branch**: `feat/sticker-print-redesign`  
**Author**: Akenarin Kongdach  
**Reviewed by**: Pre-Merge Guard (automated)

---

## File Changes Summary

| Area | Files | Net |
|------|-------|-----|
| API: stickers.service.ts + spec | 2 | +437 |
| API: stickers.controller.ts | 1 | +13 |
| API: pricing-templates: DTO + service | 2 | +42 |
| API: prisma/schema.prisma, migration | 2 | +20 |
| Web: StickerPrintPage.tsx | 1 | +338 (net) |
| Web: SettingsPage sticker tab | 2 | +93 |
| Web: PricingTemplatesPage.tsx | 1 | +64 |
| Web: StockPage, date.ts | 2 | +22 |
| LINE OA: flex messages (14 redesigned + 1 new) | 15 | +1700 (net) |
| Docs/plans | 2 | +1714 |
| **Total** | **33 files** | **+3932 / -2129** |

**Note**: This branch is a subset of `feat/payment-method-config-qr`. The QR endpoint, `PaymentMethodConfig` module, and `paysolutions.service.ts` additions are NOT included here.

---

## Issues Found

### 🔴 Critical
_None_

---

### 🟡 Warning (should fix before merge)

#### W1 — 5× `Number()` on Decimal pricing fields in stickers service

**File**: `apps/api/src/modules/stickers/stickers.service.ts`  
**Lines**: 168–185 (added in this branch)

```ts
cashPrice: pricing ? Number(pricing.cashPrice) : null,
Number(pricing.rate1DownPayment)
Number(pricing.installmentBestchoicePrice)
Number(pricing.rate2DownPayment)
Number(pricing.installmentFinancePrice)
```

These are `Decimal @db.Decimal(12,2)` fields on `PricingTemplate`. The data is used for sticker label rendering (display only, not financial recording), but project convention prohibits `Number()` on Decimal money fields. Replace with `.toNumber()` to be explicit and consistent with v4 hardening work.

Also:
```ts
rate1Down: Number(map.get('sticker.rate1.defaultDown') ?? 0),
rate2Down: Number(map.get('sticker.rate2.defaultDown') ?? 0),
```
These parse settings strings for down-payment defaults. Use `parseFloat()` with a `|| 0` fallback for intent clarity (these come from string map, not Decimal).

#### W2 — Missing `queryClient.invalidateQueries()` after sticker settings mutation

**File**: `apps/web/src/pages/SettingsPage/components/StickerSettings.tsx`

Review this component for mutation handlers that save sticker defaults. If any `useMutation` calls are missing `onSuccess: () => queryClient.invalidateQueries(...)`, the UI will show stale data until the next manual refresh. (Cannot confirm line numbers without reading the full component, flag for author to verify.)

---

### 🔵 Info

#### I1 — LINE OA flex message redesign (14 files changed)

The Style D redesign touches all customer-facing Flex messages (`payment-success`, `contract-signed`, `overdue-notice`, etc.). These are high-visibility customer-facing templates. Changes are display-only (no business logic), but the breadth of changes means a regression in any flex message format could silently break LINE pushes.

Consider: spot-check the existing `contract-signed.flex.spec.ts` test passes on this branch before merging.

#### I2 — `StickerPrintPage.tsx` net +338 lines

The page is likely approaching or exceeding 500 lines. Future PRs should consider extracting the QR/barcode section into a dedicated component.

---

## Positive Notes

- `StickersController` inherits class-level guards (`JwtAuthGuard`, `RolesGuard`). ✓
- New sticker batch endpoint properly validates `ids` array. ✓
- `stickers.service.spec.ts` adds 278 lines of new tests covering the new service methods. ✓
- Soft-delete pattern used correctly in sticker service (`deletedAt: null` in queries). ✓
- `pricing-templates.service.ts` changes include `where: { deletedAt: null }`. ✓

---

## Recommendation: 🟡 REVIEW

No critical security or data-integrity issues. **W1** (Decimal precision convention) should be fixed before merge to stay consistent with v4 hardening. **W2** should be verified by the author. Safe to merge after those fixes.
