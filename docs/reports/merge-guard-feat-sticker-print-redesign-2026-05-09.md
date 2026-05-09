# Merge Guard Report — feat/sticker-print-redesign

**Date**: 2026-05-09  
**Branch**: `feat/sticker-print-redesign`  
**Author**: Akenarin Kongdach  
**Commits**: 10 (subset shared with `feat/payment-method-config-qr`)  
**Recommendation**: ⚠️ REVIEW

---

## File Changes Summary

| Area | Files | Net lines |
|------|-------|----------|
| Web: `StickerPrintPage.tsx` (full redesign) | 1 | +338 / −large |
| Web: `StockPage/index.tsx` (bulk-print button) | 1 | +12 / −small |
| API: LINE OA flex messages (Style C → D rewrite) | 13 | +1,854 / −2,189 |
| API: Prisma schema (pricing template fields) | 1 | +8 |
| API: sticker batch endpoint | 1 | +~30 |
| Plans/docs | 2 | +1,714 |
| **Total** | **33** | **+3,932 / −2,129** |

**Note**: This branch is an ancestor of `feat/payment-method-config-qr`. The sticker + LINE OA commits are shared. The QR/partial-payment API additions are NOT included in this branch.

---

## Issues

### ⚠️ Warning — `Number()` on Decimal pricing fields in sticker data endpoint

**File**: sticker data service (new batch endpoint `GET /sticker-templates/products/data`)

```ts
cashPrice: pricing ? Number(pricing.cashPrice) : null,
downPayment: pricing.rate1DownPayment !== null
  ? Number(pricing.rate1DownPayment)
  : defaults.rate1Down,
monthlyPrice: Number(pricing.installmentBestchoicePrice),
```

`cashPrice`, `rate1DownPayment`, `installmentBestchoicePrice`, `installmentFinancePrice` are all `Decimal @db.Decimal(12, 2)` in the Prisma schema. Converting with `Number()` violates the project convention. For sticker display (print labels), the values are consumed as display strings so there is no financial recording impact. Precision loss is theoretically impossible at THB Decimal(12,2) scale within IEEE-754 double.

**Suggested fix**: Replace all `Number(x)` → `x.toNumber()` with a brief comment marking the JSON serialization boundary. This makes intent searchable.

---

### ⚠️ Warning — `Number()` on SystemConfig defaults for sticker rates

**File**: sticker data service

```ts
rate1Down: Number(map.get('sticker.rate1.defaultDown') ?? 0),
rate1Term: Number(map.get('sticker.rate1.defaultTerm') ?? 24),
```

`map.get()` returns a `string | undefined` from `SystemConfig.value`. Converting with `Number()` on a config string is standard. Not a Decimal issue. Noted for completeness — no change needed.

---

## Things That Look Good

| Check | Result |
|-------|--------|
| New `GET /sticker-templates/products/data` endpoint has `@Roles('OWNER', 'BRANCH_MANAGER', 'SALES')` | ✅ |
| Existing `StickersController` already has class-level `@UseGuards(JwtAuthGuard, RolesGuard)` — new method inherits it | ✅ |
| Batch limit enforced: `productIds.length > 100 → BadRequestException` | ✅ |
| No new controller introduced | ✅ |
| No raw `$queryRaw` SQL | ✅ |
| No hardcoded secrets | ✅ |
| Frontend `StickerPrintPage` uses `useQuery` from react-query (not raw `fetch`) | ✅ |
| Sticker print page does not perform financial write operations | ✅ |
| `StockPage` bulk-print uses URL `?ids=...` query string — no mutation side-effects | ✅ |
| LINE OA Style D rewrite: purely visual, no auth/data logic changes | ✅ |

---

## Recommendation

**⚠️ REVIEW** — No Criticals. Single Warning: `Number()` on Prisma Decimal fields at the sticker data endpoint's JSON boundary. Display-only context — no financial recording risk.

**Suggested action before merge**: Replace `Number(pricing.*)` with `.toNumber()` to signal the Decimal→float serialization boundary explicitly. This also keeps the codebase consistent with the v4 convention fix (53 `Number()` → `Prisma.Decimal` purge).

If this branch is intended to be merged before `feat/payment-method-config-qr`, ensure the shared LINE OA Style D commits don't conflict during the subsequent merge.
