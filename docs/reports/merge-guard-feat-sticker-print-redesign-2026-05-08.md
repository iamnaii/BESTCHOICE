# Merge Guard Report — `feat/sticker-print-redesign`

**Date**: 2026-05-08  
**Author**: iamnaii@MacBook-Pro-khxng-Akenarin.local  
**Commits**: 6

---

## File Changes Summary

| Area | Files | Net Change |
|------|-------|-----------|
| `stickers.service.ts` | Redesigned `getStickerData` + new `getStickerDataBatch` | +125 lines |
| `stickers.service.spec.ts` | New unit test file | +278 lines |
| `stickers.controller.ts` | New `GET products/data` batch endpoint | +13 lines |
| `StickerPrintPage.tsx` | Redesigned sticker print page | +338 lines (net) |
| `PricingTemplatesPage.tsx` | Add rate1/rate2 down+term inputs | +64 lines |
| `SettingsPage/StickerSettings.tsx` | New sticker settings component | +82 lines |
| `SettingsPage/index.tsx` | Wire StickerSettings tab | +11 lines |
| `StockPage/index.tsx` | Wire sticker print link | +12 lines |
| `apps/web/src/lib/date.ts` | `formatGregorianDate` utility | +10 lines |
| `pricing-templates.service.ts` | Add rate fields | +4 lines |
| `pricing-templates/dto/pricing-template.dto.ts` | Add rate fields | +38 lines |
| Prisma schema | 4 new optional fields on `PricingTemplate` | +5 lines |
| Migration | `add_sticker_rate_fields_to_pricing_template` | +15 lines |
| Plans/docs | 2 design docs added | +1,714 lines |
| LINE OA flex | 14 flex messages (same as QR branch — shared base) | large |

**33 files changed, 3,932 insertions(+), 2,129 deletions(−)**

---

## Issues Found

### Critical
_None_

---

### Warning

#### W1 — `Number()` used on Decimal money fields in `StickerData` interface
**File**: `apps/api/src/modules/stickers/stickers.service.ts` (lines ~128–153)

```typescript
cashPrice: pricing ? Number(pricing.cashPrice) : null,
rate1: pricing ? {
  downPayment: pricing.rate1DownPayment !== null
    ? Number(pricing.rate1DownPayment)   // Decimal → number
    : defaults.rate1Down,
  monthlyPrice: Number(pricing.installmentBestchoicePrice),  // Decimal → number
  termMonths: pricing.rate1TermMonths ?? defaults.rate1Term,
} : null,
// ... rate2 same pattern
```

The `StickerData` response interface uses `number | null` types. These values are display-only (sticker print), not used in financial calculations. For 2-decimal-place amounts this won't cause precision loss in practice. However, the project's explicit v3/v4 Decimal hardening discipline ("0 `Number(_sum` remaining") means any new `Number()` on price fields should be scrutinized.

**Fix options**:
- Keep `number` return type for the display interface (sticker print is read-only display, not accounting), but add a `// display-only — intentional Decimal→number` comment so future reviewers don't flag this mechanically.
- Alternatively, return `string` from the API (`.toFixed(2)`) and let the frontend parse, following the pattern other display endpoints use.

#### W2 — `loadDefaults()` silently returns `0 / 24 / 0 / 12` when `SystemConfig` rows are absent
**File**: `apps/api/src/modules/stickers/stickers.service.ts` (lines ~94–103)

```typescript
rate1Down: Number(map.get('sticker.rate1.defaultDown') ?? 0),
rate1Term: Number(map.get('sticker.rate1.defaultTerm') ?? 24),
```

If the `SystemConfig` keys are not seeded, the sticker will silently show default values (0 down, 24 months) with no indication to the user that configuration is missing. This could produce misleading stickers. The system has no validation that these keys exist.

**Fix**: Add a startup/settings check warning if the four `sticker.*` keys are not found, or document that these must be seeded.

---

### Info

#### I1 — `useEffect` usage in `StickerPrintPage.tsx` is acceptable
`useEffect` is used only for URL param → state initialization on mount. Data fetching uses `useQuery` with `api.get()` correctly. No violation.

#### I2 — `bg-white text-black` in `StickerCard` is acceptable in print context
The `StickerCard` component uses `bg-white text-black` explicitly for print output. The frontend rule exempts "print/receipt context" from the semantic-token requirement. This is correct usage.

#### I3 — Batch endpoint limit of 100 is enforced server-side only
`GET /sticker-templates/products/data?ids=...` validates max 100 IDs in the controller. The frontend should also guard this before sending to provide a better UX error. Currently the frontend can send any number of IDs and only gets a 400 from the API.

#### I4 — `stickers.service.spec.ts` is unit-test only (no integration tests)
The new `getStickerDataBatch` method is tested via mock-only unit tests. There are no integration tests covering the batch endpoint. This is consistent with the existing test pattern in this module and not a blocker.

---

## Security Check

- `StickersController.getStickerDataBatch`: `@UseGuards(JwtAuthGuard, RolesGuard)` inherited from class-level guard ✅
- New endpoint has `@Roles('OWNER', 'BRANCH_MANAGER', 'SALES')` ✅
- `ids` query param is split/trimmed and limited to 100 — no SQL injection vector (uses Prisma parameterized `where: { id: productId }`) ✅
- No secrets or hardcoded values ✅

---

## Recommendation: 👀 REVIEW

No Critical issues. The branch is functionally sound with good test coverage. Two warnings need a decision:

1. **W1** (Decimal→number on price fields): Low practical risk for sticker display, but should be documented as intentional or fixed to comply with project standards.
2. **W2** (silent SystemConfig fallbacks): Low risk but could confuse users if config keys are absent.

Resolve W1 with a comment at minimum before merging to avoid triggering the next automated Decimal audit.
