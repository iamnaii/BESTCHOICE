# Merge Guard Report — feat/sticker-print-redesign

**Date**: 2026-05-08  
**Branch**: `feat/sticker-print-redesign`  
**Author**: Akenarin Kongdach  
**Files changed**: 33 (API service + LINE OA flex messages + frontend page + tests)

---

## Summary

Redesigns the `/stickers` page for 50×30 mm thermal printing with a bulk-list, adds sticker rate config to settings (OWNER only), adds `rate1`/`rate2` down+term fields to pricing-templates, wires bulk-print into the stock list, and migrates 14 LINE OA customer-facing flex messages from Style C to the new Style D Premium Thai design system.

### Key file changes
| File | Change |
|------|--------|
| `apps/web/src/pages/StickerPrintPage.tsx` | Full redesign — thermal print layout |
| `apps/web/src/pages/StockPage/index.tsx` | Bulk-print sticker action in toolbar |
| `apps/api/src/modules/stickers/stickers.service.ts` | New `getProductStickerData()` + `getDefaults()` methods |
| `apps/api/src/modules/stickers/stickers.controller.ts` | New `GET /sticker-templates/products/data` endpoint |
| `apps/api/src/modules/pricing-templates/…` | rate1/rate2 down+term DTO fields |
| `apps/api/src/modules/line-oa/flex-messages/*.ts` | 14 files migrated to `style-d.ts` |

---

## Issues by Severity

### 🔴 Critical (must fix before merge)

#### C-1: `Number()` on Prisma Decimal fields in `stickers.service.ts`

`apps/api/src/modules/stickers/stickers.service.ts` — `getProductStickerData()`:

```typescript
// ALL 5 lines below violate the "use Prisma.Decimal" rule
cashPrice: pricing ? Number(pricing.cashPrice) : null,
// rate1 block
downPayment: pricing.rate1DownPayment !== null
  ? Number(pricing.rate1DownPayment)   // ← VIOLATION
  : defaults.rate1Down,
monthlyPrice: Number(pricing.installmentBestchoicePrice),  // ← VIOLATION
// rate2 block
downPayment: pricing.rate2DownPayment !== null
  ? Number(pricing.rate2DownPayment)   // ← VIOLATION
  : defaults.rate2Down,
monthlyPrice: Number(pricing.installmentFinancePrice),     // ← VIOLATION
```

`cashPrice`, `rate1DownPayment`, `installmentBestchoicePrice`, `rate2DownPayment`, and `installmentFinancePrice` are `@db.Decimal(12,2)` columns in Prisma schema. Converting them with `Number()` loses precision (floating-point rounding) and violates the project's money handling convention.

**Fix**: Use `.toNumber()` on the Decimal instance (which gives a JS number with proper rounding) or pass `new Prisma.Decimal(value)` downstream. For display/print contexts where a JS number is ultimately needed, use `pricing.cashPrice.toNumber()` rather than `Number(pricing.cashPrice)` — this makes the intent explicit and respects Prisma's Decimal type.

```typescript
// Correct pattern:
cashPrice: pricing ? pricing.cashPrice.toNumber() : null,
downPayment: pricing.rate1DownPayment !== null
  ? pricing.rate1DownPayment.toNumber()
  : defaults.rate1Down,
monthlyPrice: pricing.installmentBestchoicePrice.toNumber(),
```

### ⚠️ Warning (should fix)

#### W-1: `Number()` on string SystemConfig values — minor inconsistency

`stickers.service.ts` — `getDefaults()`:
```typescript
rate1Down: Number(map.get('sticker.rate1.defaultDown') ?? 0),
rate1Term: Number(map.get('sticker.rate1.defaultTerm') ?? 24),
```
`SystemConfig.value` is stored as `String`. Converting with `Number()` here is acceptable (not a Decimal field), but `parseInt` / `parseFloat` would be more explicit about the expected type. Low priority.

### ℹ️ Info

- Line OA flex message migration (14 files) to Style D: clean refactor, no security impact.
- `stickers.controller.ts`: new `GET /sticker-templates/products/data` endpoint has `@Roles('OWNER', 'BRANCH_MANAGER', 'SALES')` ✓
- `StickerPrintPage.tsx` form inputs use `Number(e.target.value)` for controlled state — acceptable for HTML input → number conversion, not a Decimal violation.
- `deletedAt: null` filters present in all new Prisma queries ✓
- No raw `fetch()` in frontend components ✓
- No hardcoded secrets ✓

---

## Recommendation: 🔴 BLOCK

**5 Critical violations** of the `Number()` on Decimal money fields rule.  
Fix C-1 first, then re-review. The W-1 warning is minor and can be addressed separately.
