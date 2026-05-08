# Pre-Merge Guard Report — feat/payment-method-config-qr

**Date**: 2026-05-08  
**Branch**: `feat/payment-method-config-qr`  
**Author**: Akenarin Kongdach  
**Reviewed by**: Pre-Merge Guard (automated)

---

## File Changes Summary

| Area | Files | Net |
|------|-------|-----|
| API: payment-method-config module (new) | 4 | +252 |
| API: paysolutions.service.ts (partial + payoff QR) | 1 | +326 |
| API: payments.controller.ts (3 new QR endpoints) | 1 | +77 |
| API: partial-payment-expire.cron.ts (new) | 1 | +41 |
| API: stickers.service.ts (pricing integration) | 1 | +159 |
| API: app.module.ts, migrations | 3 | +109 |
| Web: PaymentMethodSettingsPage.tsx (new) | 1 | +397 |
| Web: RecordPaymentWizard.tsx, QrSentBadge.tsx | 2 | +426 |
| Web: StickerPrintPage.tsx, PricingTemplatesPage.tsx | 2 | +100 |
| LINE OA: flex messages (14 redesigned + 2 new) | 16 | +1700 |
| Docs/plans | 2 | +1714 |
| **Total** | **58 files** | **+5829 / -2212** |

---

## Issues Found

### 🔴 Critical (must fix before merge)

#### C1 — `Number()` on Decimal money field in webhook payment-recording path

**File**: `apps/api/src/modules/paysolutions/paysolutions.service.ts`  
**Line**: ~463 (in `handlePartialPaymentWebhook`, new code)

```ts
await this.paymentsService.recordPayment(
  payment.contractId,
  payment.installmentNo,
  Number(link.amount),   // ← Prisma.Decimal → number conversion
  'ONLINE_GATEWAY',
  ...
);
```

`link.amount` is `Decimal @db.Decimal(12,2)` on `PartialPaymentLink`. Converting via `Number()` before passing to `recordPayment` violates the Decimal precision rule. While the existing `recordPayment` signature itself uses `number` (a pre-existing issue), the conversion here is new and should be explicit about precision boundaries.

**Fix**: Use `link.amount.toNumber()` for intent clarity, and file a follow-up to type `recordPayment`'s `amount` as `Prisma.Decimal | number` to enforce strict typing at the boundary.

---

#### C2 — `Number()` on `payment.amountDue` passed into partial-QR Flex context

**File**: `apps/api/src/modules/paysolutions/paysolutions.service.ts`  
**Line**: ~328 (in `createPartialPaymentQR`)

```ts
fullAmount: Number(payment.amountDue),
```

`amountDue` is `Decimal @db.Decimal(12,2)`. Even though this is used only for Flex message rendering (not financial recording), the project convention is to never call `Number()` on Decimal money fields. Use `.toNumber()` for display or format explicitly with `payment.amountDue.toString()`.

---

### 🟡 Warning (should fix before merge)

#### W1 — `CreatePartialQrDto` defined inline in controller

**File**: `apps/api/src/modules/payments/payments.controller.ts`

```ts
class CreatePartialQrDto {
  @IsNumber()
  @Min(1, { message: 'ยอดต้องมากกว่า 0 บาท' })
  amount!: number;
}
```

Per backend conventions, DTOs must live in a `dto/` subdirectory as separate files. This class is structurally fine (has validation decorators) but should be moved to `apps/api/src/modules/payments/dto/create-partial-qr.dto.ts`.

#### W2 — 6× `Number()` on Decimal pricing fields in stickers service

**File**: `apps/api/src/modules/stickers/stickers.service.ts`  
**Lines**: ~164-185

```ts
cashPrice: pricing ? Number(pricing.cashPrice) : null,
Number(pricing.rate1DownPayment)
Number(pricing.installmentBestchoicePrice)
Number(pricing.rate2DownPayment)
Number(pricing.installmentFinancePrice)
```

These fields (`cashPrice`, `rate1DownPayment`, `installmentBestchoicePrice`, etc.) are `Decimal @db.Decimal(12,2)` on the `PricingTemplate` model. The usage here is display-only (sticker label rendering), but the rule still applies. Replace with `.toNumber()` to match project convention and distinguish from accidental precision loss.

#### W3 — Missing Thai validation message on `@IsNumber()` in `CreatePartialQrDto`

**File**: `apps/api/src/modules/payments/payments.controller.ts`

```ts
@IsNumber()   // ← missing { message: 'กรุณาระบุจำนวนเงิน' }
```

The `@Min` has a Thai message but `@IsNumber` doesn't. If the client sends a non-numeric value, the error will be in English.

---

### 🔵 Info

#### I1 — `bg-white` on QR code container

**File**: `apps/web/src/pages/PaymentMethodSettingsPage.tsx`

```tsx
className="size-64 rounded-lg border border-border bg-white p-2"
```

Design token rule says to avoid `bg-white`. However, QR codes require a white background to be scannable — `bg-background` may render as off-white in dark mode and break QR readability. If the project does not support dark mode, replace with `bg-background`. If dark mode is possible, the `bg-white` is justified and should have an inline comment noting the reason.

#### I2 — Large files

- `apps/web/src/pages/PaymentMethodSettingsPage.tsx` — 397 lines (new file, close to the 500-line warning threshold)
- `apps/api/src/modules/paysolutions/paysolutions.service.ts` — +447 lines net; total file length may exceed 600 lines

These don't block merge but should be noted for future splitting.

---

## Positive Notes

- `PaymentMethodConfigController` properly has `@UseGuards(JwtAuthGuard, RolesGuard)` at class level with `@Roles()` on every method. ✓
- New QR endpoints on `PaymentsController` properly inherit the class-level guards. ✓
- New `PartialPaymentLink` DB lookup queries all include `status` + `expiresAt` guards (no missing `deletedAt: null` issue since the model uses `status` enum instead). ✓
- Idempotency: existing active QR cancelled before creating a new one — prevents double-payment. ✓
- Sentry + `AbortController` timeout on all new PaySolutions HTTP calls. ✓
- `partial-payment-expire.cron.ts` expires stale `ACTIVE` links. ✓

---

## Recommendation: 🔴 BLOCK

Fix **C1** (webhook `Number(link.amount)`) and **C2** (`Number(payment.amountDue)`) before merging. Both involve `Number()` on Decimal financial fields in production paths. **W1–W3** should also be addressed in the same pass.
