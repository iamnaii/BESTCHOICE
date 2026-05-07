# Pre-Merge Guard Report

**Branch**: `feat/payment-method-config-qr`
**Author**: Akenarin Kongdach
**Date**: 2026-05-07
**Reviewer**: Pre-Merge Guard (automated)

---

## File Changes Summary

- **58 files changed**, 5,829 insertions(+), 2,212 deletions(-)
- New module: `apps/api/src/modules/payment-method-config/` (controller, service, DTOs, module)
- New feature: Partial-payment QR (`PaymentsController` + `PaysolutionsService` extensions)
- New LINE flex: `early-payoff-qr.flex.ts`, `partial-payment-qr.flex.ts`
- LINE flex refactor: 14 customer-facing messages migrated to Style D Premium Thai
- New frontend pages: `PaymentMethodSettingsPage`, `QrSentBadge`, `RecordPaymentWizard` updates
- Route: `/settings/payment-methods` (OWNER + FINANCE_MANAGER gated)

---

## Issues

### 🔴 Critical (must fix before merge)

#### C-1: Direct PrismaService calls inside a controller
**File**: `apps/api/src/modules/payments/payments.controller.ts`
**Methods**: `getActivePartialQr()` and `cancelPartialQr()`

Both methods inject `PrismaService` directly into the controller and query `partialPaymentLink` without going through a service. This violates the core backend rule: *"ห้ามเรียก PrismaService จาก controller โดยตรง — ต้องผ่าน service เสมอ"*.

```ts
// controller does this — VIOLATES rule
const link = await this.prisma.partialPaymentLink.findFirst({ ... });
await this.prisma.partialPaymentLink.update({ where: { id: link.id }, data: { ... } });
```

**Fix**: Move the two `partialPaymentLink` queries to `PaymentsService` (or `PaysolutionsService`) as `getActivePartialQr(paymentId)` and `cancelPartialQr(paymentId)`, then call those from the controller. Remove `private prisma: PrismaService` from the controller constructor.

---

#### C-2: `Number()` on Decimal financial fields passed to payment recording
**File**: `apps/api/src/modules/paysolutions/paysolutions.service.ts`

```ts
Number(link.amount)   // passed directly to recordPayment() — precision loss
```

`link.amount` is a Prisma `Decimal` field (`@db.Decimal(12,2)`). Converting via `Number()` can lose precision on amounts ≥ 2^53 satoshis (not Thai baht concern), but more importantly breaks the project-wide rule established in v4 hardening: *"53 `Number()` → `Prisma.Decimal` ใน 12 services (0 `Number(_sum` remaining)"*.

The value is passed directly to `recordPayment()`, meaning the actual payment amount may be truncated.

**Fix**: Use `new Prisma.Decimal(link.amount)` or simply pass `link.amount` directly (it is already `Decimal`):
```ts
// before
Number(link.amount)
// after
link.amount  // already Prisma.Decimal
```

Also fix the Sentry extra field:
```ts
extra: { paymentId: link.paymentId, amount: link.amount.toFixed(2) }
```

---

### 🟡 Warning (should fix)

#### W-1: Payment URL sent to external third-party QR service
**Files**:
- `apps/api/src/modules/line-oa/flex-messages/early-payoff-qr.flex.ts`
- `apps/api/src/modules/line-oa/flex-messages/partial-payment-qr.flex.ts`
- `apps/web/src/pages/PaymentsPage/components/QrSentBadge.tsx`

All three locations use `https://api.qrserver.com/v1/create-qr-code/` to generate QR images from payment URLs:

```ts
const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=400x400&margin=10&data=${encodeURIComponent(data.paymentUrl)}`;
```

This sends live PaySolutions payment URLs to an external public service. The QR server could theoretically cache, log, or expose these URLs. LINE Flex messages embed the `qrImageUrl` and will request it at render time from LINE's servers too — meaning the payment URL travels through 2 external services (api.qrserver.com → LINE CDN).

**Fix**: Use a server-side QR code library (`qrcode` npm package — already a common dependency) to generate a base64 PNG, or self-host a QR endpoint (`GET /qr?data=...` with CSP origin validation). For frontend display, `qrcode.react` renders QR client-side with no external requests.

---

#### W-2: `Number()` on Prisma Decimal pricing fields (sticker/display path)
**Files**:
- `apps/api/src/modules/paysolutions/paysolutions.service.ts` — `Number(payment.amountDue)` in flex message
- `apps/web/src/pages/StickerPrintPage.tsx` — `Number(pricing.cashPrice)`, `Number(pricing.rate1DownPayment)`, `Number(pricing.installmentBestchoicePrice)`, `Number(pricing.rate2DownPayment)`, `Number(pricing.installmentFinancePrice)`

`payment.amountDue` is `Decimal` — use `.toNumber()` (preferred for display) or `Number()` is acceptable when *only* rendering display text. However the `fullAmount: Number(payment.amountDue)` is passed into the flex object type (`fullAmount: number`) — if the flex template later does arithmetic on this value, precision is lost.

**Fix**: For display-only fields, `Number()` → `.toNumber()` is functionally equivalent. The real concern is `fullAmount` in the flex data interface — consider keeping it as `string` (via `formatBaht()`) rather than `number` to avoid accidental arithmetic.

---

#### W-3: Inline DTO class defined in controller file
**File**: `apps/api/src/modules/payments/payments.controller.ts`

```ts
class CreatePartialQrDto {
  @IsNumber()
  @Min(1, { message: 'ยอดต้องมากกว่า 0 บาท' })
  amount!: number;
}
```

DTOs should live in a `dto/` subdirectory per the project pattern (reference: `apps/api/src/modules/customers/dto/`).

**Fix**: Move to `apps/api/src/modules/payments/dto/create-partial-qr.dto.ts`.

---

### ℹ️ Info

#### I-1: `@IsNumber()` on `amount` in `CreatePartialQrDto` — consider `@IsDecimal()` or `@IsPositive()`
The DTO uses `amount: number` (JavaScript number). This is fine for the HTTP layer (JSON numbers), but the value flows into `createPartialPaymentQR({ amount: dto.amount })` where it is stored as Prisma `Decimal`. Works correctly but is inconsistent with the Decimal-first pattern.

#### I-2: `orderRef = String(Date.now()).slice(-12)` — low collision risk
`Date.now()` sliced to 12 chars is not guaranteed unique under concurrent requests in the same millisecond. Low risk for current load but worth noting for when volume increases. Consider `nanoid(12)` or a DB sequence instead.

#### I-3: Prisma schema adds `PaymentMethodConfig` model (new table)
Migration included. The model correctly has `createdAt`, `updatedAt`, `deletedAt` and uses UUID PK. Soft-delete pattern is implemented properly. No concern here — just noting the schema change.

---

## Summary

| Severity | Count | Status |
|----------|-------|--------|
| Critical | 2 | Must fix before merge |
| Warning  | 3 | Should fix |
| Info     | 3 | Low priority |

## Recommendation: 🔴 BLOCK

Two critical issues prevent merge:
1. **C-1** — `PaymentsController` directly queries Prisma (violates backend architecture rule)
2. **C-2** — `Number(link.amount)` passed to `recordPayment()` (financial precision regression, violates v4 hardening rule)

The payment-method config module itself (`PaymentMethodConfigController` + `PaymentMethodConfigService`) is well-structured and passes all checks. Only the partial-QR additions to `PaymentsController`/`PaysolutionsService` need fixes.

The external QR service issue (W-1) is a security/privacy concern that should also be addressed before shipping to production, as it sends live payment URLs to a public third-party API.
