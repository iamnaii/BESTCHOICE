# Merge Guard Report — feat/sticker-print-redesign

**Date**: 2026-05-07  
**Branch**: `feat/sticker-print-redesign`  
**Author**: Akenarin Kongdach  
**Reviewed by**: Pre-Merge Guard (automated)

---

## File Changes Summary

| Files | Insertions | Deletions |
|-------|-----------|-----------|
| 33 | +3,932 | −2,129 |

### What changed
1. **LINE OA flex messages** — 14 customer-facing messages redesigned from Style C → Style D Premium Thai (`balance-summary`, `campaign`, `contract-completed`, `contract-selector`, `contract-signed`, `early-payoff-success`, `link-contract`, `overdue-notice`, `payment-reminder`, `payment-success`, `promptpay-qr`, `receipt-history`, `receipt`, `welcome`)
2. **`StickerPrintPage.tsx`** — Redesigned for 50×30 mm thermal sticker with bulk list + batch print
3. **`SettingsPage`** — Sticker rate defaults section (OWNER only, guarded)
4. **`PricingTemplatesPage.tsx`** — Added `rate1DownPayment`, `rate2DownPayment`, `rate1TermMonths` fields
5. **Backend** — New `GET /sticker-templates/products/data` batch endpoint; pricing-templates DTO extended

---

## Issues

### Critical
_None_

### Warning
_None_

### Info

**[INFO-1] `Number(e.target.value)` in form onChange handlers**  
Files: `SettingsPage/components/StickerSettings.tsx`, `PricingTemplatesPage.tsx`  
Fields: `rate1DownPayment`, `rate2DownPayment`, `rate1TermMonths`, `rate2TermMonths`

These are HTML `<input type="number">` onChange handlers parsing a string from the DOM into a JS number for local form state before the value is sent to the API. This is UI form state, not a backend Prisma financial calculation — no precision risk. Not a violation of the Decimal rule (which targets `_sum` and backend service arithmetic).

**[INFO-2] `Number(previewData.selling_price)` in sticker print preview**  
File: `StickerPrintPage.tsx`  
Usage: `(Number(previewData.selling_price) || 0).toLocaleString()} ฿` — display-only formatting in the sticker preview DOM. The value is not used for any financial calculation.

**[INFO-3] Hardcoded hex colors in LINE Flex Message templates**  
Files: `apps/api/src/modules/line-oa/flex-messages/*.flex.ts` via `style-d.ts`  
Example: `createRow('ราคา', ..., { valueColor: '#dc2626' })`

The frontend rule against hardcoded hex values applies to React/Tailwind CSS. LINE Flex Messages are JSON payloads sent to LINE's API, which requires hex color literals — CSS variables are not supported by LINE. Acceptable.

**[INFO-4] New `sticker-templates` batch endpoint — `@Roles` verified**  
The new `GET /sticker-templates/products/data` endpoint adds `@Roles('OWNER', 'BRANCH_MANAGER', 'SALES')` on top of the existing class-level `@UseGuards(JwtAuthGuard, RolesGuard)`. Guard coverage is complete.

---

## Verdict

**✅ APPROVE**

All Info items are either display-only patterns or external-API requirements. No security, data integrity, or correctness issues. Style D redesign is internally consistent and all 14 flex builders have corresponding `.spec.ts` coverage.

> Note: `feat/payment-method-config-qr` is built on top of this branch — if merging sequentially, merge sticker first.
