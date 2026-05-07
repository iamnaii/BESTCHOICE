# Pre-Merge Guard Report — 2026-05-07

**Run time**: 2026-05-07 (end-of-day)
**Author**: Akenarin Kongdach
**Guard version**: v3 (post-merge retrospective)

---

## Summary

All 3 candidate branches were already squash-merged to `main` before this guard run completed. No open PRs remain. This report documents the retrospective quality review of that merged code.

| Branch | Merged As | Status | Recommendation |
|--------|-----------|--------|----------------|
| `fix/cpa-template-spec-fk-cleanup` | #774 | Merged | APPROVE (test-only) |
| `feat/sticker-print-redesign` | #772 | Merged | APPROVE w/ warning |
| `feat/payment-method-config-qr` | #773 | Merged | APPROVE w/ warning |

---

## Branch 1: `fix/cpa-template-spec-fk-cleanup` → merged as #774

### File Changes
- 15 test spec files modified, +187 lines, 0 deletions of production code
- All changes in `apps/api/src/modules/journal/__tests__/` and `cpa-templates/*.spec.ts`

### What It Does
Adds missing FK-safe cleanup order to test `setup()` / `beforeAll()` blocks. Each spec was deleting `JournalEntry` before child tables (`Receipt`, `EDocument`, `Signature`, `ContractDocument`, `PromiseSlot`, `CallLog`, `Repossession`, etc.), which caused FK constraint violations under Restrict mode (hardened in v3). PR extends #774's fix to all remaining template spec files.

### Issues Found
None.

### Recommendation: APPROVE ✅
Pure test infrastructure fix. No production risk, no security concerns, no business logic changes.

---

## Branch 2: `feat/sticker-print-redesign` → merged as #772

### File Changes
33 files, +3932 / −2129 lines (includes docs plan files)

Key changes:
- `apps/api/src/modules/stickers/stickers.service.ts` — +159 lines (getStickerData extended with rates/warranty/logo, batch endpoint)
- `apps/api/src/modules/stickers/stickers.controller.ts` — new `GET /sticker-templates/products/data` batch endpoint
- `apps/web/src/pages/StickerPrintPage.tsx` — 50×30mm thermal layout redesign
- `apps/api/src/modules/line-oa/flex-messages/style-d.ts` — new 654-line design system (Style D Premium Thai)
- 13 LINE Flex files refactored to Style D

### Issues Found

#### Warning ⚠️ — `Number()` on Decimal price fields in stickers.service.ts
```typescript
// stickers.service.ts lines 168–185
cashPrice: pricing ? Number(pricing.cashPrice) : null,
rate1: {
  downPayment: pricing.rate1DownPayment !== null ? Number(pricing.rate1DownPayment) : ...,
  monthlyPrice: Number(pricing.installmentBestchoicePrice),
}
```
`cashPrice`, `rate1DownPayment`, `installmentBestchoicePrice` are `Decimal @db.Decimal(12,2)` fields. These are used for sticker print display only (not arithmetic), so precision loss is cosmetic, but the pattern violates project rule to avoid `Number()` on Decimal fields.

**Suggested fix**: Return `pricing.cashPrice.toFixed(2)` or keep as `Prisma.Decimal` in the response type, letting the frontend format.

#### Info ℹ️ — style-d.ts is 654 lines
New design system file. Acceptable as a standalone module, but could be split into `style-d.primitives.ts` + `style-d.templates.ts` if it grows further.

#### Info ℹ️ — Sticker controller `parseInt()` on pagination params
```typescript
// stickers.controller.ts
page ? parseInt(page) : undefined,
limit ? parseInt(limit) : undefined,
```
`parseInt` without radix; should be `parseInt(page, 10)`. Low severity.

### Recommendation: APPROVE ✅ (already merged)
No Critical issues. `Number()` on display-only Decimal fields is a Warning. Security controls correct: JwtAuthGuard + RolesGuard on all endpoints, @Roles decorators present on every method.

---

## Branch 3: `feat/payment-method-config-qr` → merged as #773

### File Changes
58 files, +5829 / −2212 lines

Key new additions:
- `apps/api/src/modules/payment-method-config/` — new NestJS module (controller, service, DTOs, module)
- `apps/api/src/modules/paysolutions/paysolutions.service.ts` — +447 lines (createPartialPaymentQR, createEarlyPayoffQR, handlePartialPaymentCallback)
- `apps/api/src/modules/paysolutions/partial-payment-expire.cron.ts` — new cron (expire stale QR links)
- `apps/web/src/pages/PaymentMethodSettingsPage.tsx` — new 397-line settings page
- `apps/web/src/pages/PaymentsPage/components/QrSentBadge.tsx` — new 170-line QR badge component
- `apps/web/src/pages/PaymentsPage/components/RecordPaymentWizard.tsx` — +256 lines (3-method step + send-QR flow)
- New LINE Flex: `partial-payment-qr.flex.ts`, `early-payoff-qr.flex.ts`

### Issues Found

#### Critical ⚠️ — `Number(link.amount)` passed to `recordPayment()` in financial context

**File**: `apps/api/src/modules/paysolutions/paysolutions.service.ts` (now in main via #773)

```typescript
// handlePartialPaymentCallback — auto-records payment after webhook
await this.paymentsService.recordPayment(
  payment.contractId,
  payment.installmentNo,
  Number(link.amount),   // ← link.amount is Decimal @db.Decimal(12,2)
  'ONLINE_GATEWAY',
  systemUser.id,
  ...
);
```

`PartialPaymentLink.amount` is a `Decimal @db.Decimal(12,2)` field. Converting to `Number()` before passing to `recordPayment()` risks floating-point precision issues. `recordPayment`'s signature currently accepts `amount: number` — but this interface should be updated to accept `Prisma.Decimal | number` and the call site should pass `link.amount` directly.

For typical Thai installment amounts (≤ 100,000 THB), JavaScript `Number` has sufficient precision. However, the pattern has been explicitly hardened in v4 (53 `Number()` → `Prisma.Decimal` conversions), and this is a payment-recording path — the **highest** business risk area.

**Additional `Number()` calls on Decimal fields** (display/logging only — lower severity):
```typescript
fullAmount: Number(payment.amountDue),          // LINE Flex display
amountPaid: Number(payment.amountPaid),          // LINE Flex display
extra: { amount: Number(link.amount) }           // Sentry logging context
```

#### Warning ⚠️ — `Number()` on Decimal sticker price fields
Same as Branch 2 above (stickers.service.ts lines 106–185). Carried forward from sticker branch.

#### Warning ⚠️ — `Number()` in SystemConfig defaults for sticker rates
```typescript
rate1Down: Number(map.get('sticker.rate1.defaultDown') ?? 0),
rate1Term: Number(map.get('sticker.rate1.defaultTerm') ?? 24),
```
These read strings from SystemConfig and convert to Number for non-financial display/config defaults. Acceptable but inconsistent with Decimal policy.

#### Info ℹ️ — New `PaymentMethodConfig` controller: security controls correct
```typescript
@Controller('payment-method-configs')
@UseGuards(JwtAuthGuard, RolesGuard)                   // ✅ class-level guard
export class PaymentMethodConfigController {
  @Get()    @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')  // ✅
  @Post()   @Roles('OWNER', 'FINANCE_MANAGER')           // ✅ write restricted
  @Patch()  @Roles('OWNER', 'FINANCE_MANAGER')           // ✅
  @Delete() @Roles('OWNER', 'FINANCE_MANAGER')           // ✅
}
```

#### Info ℹ️ — Service soft-delete and deletedAt: null patterns: correct
All queries in `payment-method-config.service.ts` include `deletedAt: null`. Delete uses `update({ data: { deletedAt: new Date() } })`. ✅

#### Info ℹ️ — React Query patterns: correct
`PaymentMethodSettingsPage.tsx` uses `useQuery` + `useMutation`, `invalidateQueries` after every mutation, `api.get()`/`api.post()` from `@/lib/api`. ✅

### Recommendation: APPROVE w/ follow-up ticket ✅ (already merged)

Security controls, soft-delete patterns, and React Query patterns are all correct. The `Number(link.amount)` in `recordPayment()` path (now in `main`) is the most important follow-up.

---

## Follow-up Actions Required

### 🔴 Ticket needed: Fix `Number(link.amount)` in paysolutions payment-recording path

**File**: `apps/api/src/modules/paysolutions/paysolutions.service.ts`

Two options:
1. Update `recordPayment()` signature to accept `Decimal | number` and use `new Prisma.Decimal(link.amount)` inside
2. Call `link.amount` directly (Prisma already returns it as `Prisma.Decimal`) without `Number()` cast — requires updating the `amount: number` param in `payments.service.ts`

**Priority**: Medium — not causing current bugs (precision safe for ≤100k THB range), but violates hardening standards established in v4.

### 🟡 Cleanup: Delete stale remote branches

All 3 branches can be deleted since their content is in main:
```bash
git push origin --delete fix/cpa-template-spec-fk-cleanup
git push origin --delete feat/sticker-print-redesign
git push origin --delete feat/payment-method-config-qr
```

---

## Test Coverage

- `stickers.service.spec.ts` — 278 new tests added ✅
- `paysolutions.service.spec.ts` — spec updated with partial-payment scenarios ✅
- No new E2E tests for the partial-payment QR flow (deferred)

---

*Generated by Pre-Merge Guard agent — iamnaii/bestchoice — 2026-05-07*
