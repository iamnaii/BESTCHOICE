# Merge Guard Report — feat/sticker-print-redesign

**Date**: 2026-05-08  
**Branch**: `feat/sticker-print-redesign`  
**Author**: Akenarin Kongdach (akenarin.ak@gmail.com)  
**Merge base**: `9849213f` (PR #771)  
**Commits ahead of main**: 23

## File Changes Summary

| Area | Files | +/- |
|------|-------|-----|
| LINE OA Flex messages (14 redesigned to Style D) | 14 `.flex.ts` files | large refactor |
| Stickers service (new fields, batch endpoint) | `stickers.service.ts`, `stickers.controller.ts` | +159 |
| Sticker print page redesign (50×30mm thermal) | `StickerPrintPage.tsx` | +338 / -substantial |
| Stock page (bulk-print action) | `StockPage/index.tsx` | +12 |
| Pricing templates (rate1/rate2 down+term) | `pricing-templates.service.ts`, `PricingTemplatesPage.tsx` | moderate |
| Settings (sticker rate defaults section) | `SettingsPage`, `StickerSettings.tsx` | +82 |
| Schema (rate fields on PricingTemplate) | `schema.prisma` | +4 fields |
| Docs/plans | `docs/plans/` | +1714 (docs only) |

**Total TS/TSX**: 33 files, ~3932 insertions, ~2129 deletions

## What Changed

- `/stickers` redesigned as a 50×30mm thermal print layout with bulk-list catalog picker
- 14 LINE OA customer-facing Flex messages upgraded to "Style D Premium Thai" (`style-d.ts` system)
- New batch endpoint `GET /stickers/products/data?ids=<comma-separated>` for catalog bulk fetch
- PricingTemplate model gains `rate1DownPayment`, `rate1TermMonths`, `rate2DownPayment`, `rate2TermMonths`
- Sticker rate defaults configurable via SystemConfig keys (`sticker.rate1.*`, `sticker.rate2.*`)
- Side menu now includes 'พิมพ์สติกเกอร์' for all roles

---

## Issues Found

### Critical
_None_

### Warning

**W1 — `Number()` on Decimal price fields in `stickers.service.ts`**

`apps/api/src/modules/stickers/stickers.service.ts` (new additions):

```typescript
cashPrice: pricing ? Number(pricing.cashPrice) : null,           // L164
  pricing.rate1DownPayment !== null
    ? Number(pricing.rate1DownPayment)                            // L169
    : defaults.rate1Down,
monthlyPrice: Number(pricing.installmentBestchoicePrice),         // L171
  pricing.rate2DownPayment !== null
    ? Number(pricing.rate2DownPayment)                            // L179
    : defaults.rate2Down,
monthlyPrice: Number(pricing.installmentFinancePrice),            // L181
```

All of these are `Decimal @db.Decimal(12,2)` fields. v4 hardening explicitly eliminated `Number()` on money Decimals across 12 services. While these values are used for display-only (label printing), the pattern sets a precedent and v4 rules now require `Prisma.Decimal` throughout.

**Fix**: Return as `string` (`.toString()`) for display, or cast intentionally with a comment explaining this is display-only and precision is adequate for 2dp Thai Baht amounts.

---

**W2 — Batch endpoint `GET /stickers/products/data` accepts unvalidated string IDs**

`apps/api/src/modules/stickers/stickers.controller.ts`:

```typescript
getStickerDataBatch(@Query('ids') ids?: string) {
  const productIds = ids.split(',').map((s) => s.trim()).filter(Boolean);
  // ← no UUID format validation
  return this.stickersService.getStickerDataBatch(productIds);
}
```

If a client passes non-UUID strings (e.g., `?ids=foo,bar`), PostgreSQL will throw an invalid-input-syntax error when Prisma queries the `id UUID` column. The response would be a 500 rather than a 400.

**Fix**: Add UUID format validation before passing to service:
```typescript
import { validate as isUuid } from 'uuid';
const productIds = ids.split(',').map((s) => s.trim()).filter(isUuid);
```
Or use a NestJS `ParseArrayPipe` with UUID validation.

### Info

**I1 — Hardcoded hex colors in LINE OA Flex messages**

14 flex message files contain hardcoded hex values (`#047857`, `#dc2626`, etc.). This is expected and necessary — LINE Flex messages are JSON payloads sent to LINE's API, not React components, so CSS variable tokens cannot be used. No action needed.

**I2 — Hardcoded hex colors in sticker thermal label code**

Thermal label print code (`StickerPrintPage.tsx`) uses hardcoded colors. Print/receipt contexts are an established exception per existing patterns (e.g., `ReceiptPage.tsx`). No action needed.

---

## Recommendation: 🔶 REVIEW

No critical security issues. Two warnings should be addressed before merge:
- W1: Replace `Number()` with `.toString()` (display) or `Prisma.Decimal` (calculation) on price fields
- W2: Add UUID format validation to the batch sticker endpoint to return 400 instead of 500 on bad input

Guards, roles, and soft-delete are all correctly in place.
