# Merge Guard Report — feat/payment-method-config-qr

**Date**: 2026-05-08  
**Branch**: `feat/payment-method-config-qr`  
**Author**: Akenarin Kongdach  
**Files changed**: 58 (superset of `feat/sticker-print-redesign` + new PaymentMethodConfig module + partial-QR endpoints)

---

## Summary

Built on top of `feat/sticker-print-redesign` (shares first 7 commits). Adds:

1. **PaymentMethodConfig module** — maps payment methods (QR, CASH, TRANSFER) to cash account codes; settings page for OWNER/FINANCE_MANAGER.
2. **Partial-payment QR endpoints** — `POST /payments/:id/partial-qr`, `GET /payments/:id/partial-qr/active`, `DELETE /payments/:id/partial-qr` — creates a PaySolutions QR for a partial installment amount, pushes LINE flex, records payment on webhook callback.
3. **Payment wizard reorder** — QR method + send-QR UX in cashier flow.
4. All changes from `feat/sticker-print-redesign` (see separate report for sticker issues).

### Key new files
| File | Change |
|------|--------|
| `apps/api/src/modules/payment-method-config/payment-method-config.controller.ts` | New CRUD controller |
| `apps/api/src/modules/payment-method-config/payment-method-config.service.ts` | New service |
| `apps/api/src/modules/payments/payments.controller.ts` | 3 new partial-QR endpoints |
| `apps/api/src/modules/paysolutions/paysolutions.service.ts` | Partial-QR webhook handler |
| `apps/api/src/app.module.ts` | `PaymentMethodConfigModule` registered |

---

## Issues by Severity

### 🔴 Critical (must fix before merge)

#### C-1 through C-5: Inherited from `feat/sticker-print-redesign`

All 5 `Number()` on Prisma Decimal violations in `stickers.service.ts` are present here. See `merge-guard-feat-sticker-print-redesign-2026-05-08.md` C-1 for details.

#### C-6: `Number()` on Decimal `payment.amountDue` in `payments.controller.ts`

```typescript
// apps/api/src/modules/payments/payments.controller.ts
const flex = buildPartialPaymentQRFlex({
  ...
  fullAmount: Number(payment.amountDue),  // ← VIOLATION: amountDue is @db.Decimal(12,2)
  ...
});
```

`Payment.amountDue` is a `Decimal` column. `Number()` risks precision loss.

**Fix**: `fullAmount: payment.amountDue.toNumber()`

#### C-7: `Number()` on Decimal `link.amount` — 2 occurrences in `payments.controller.ts`

```typescript
// Occurrence 1 — passed to recordPayment
await this.paymentsService.recordPayment(
  payment.contractId,
  payment.installmentNo,
  Number(link.amount),    // ← VIOLATION
  ...
);

// Occurrence 2 — Sentry extra
extra: { paymentId: link.paymentId, amount: Number(link.amount) },  // ← VIOLATION
```

`PartialPaymentLink.amount` is a `Decimal` column. The `recordPayment()` call is the more critical one — passing a float to financial recording is dangerous.

**Fix**: `link.amount.toNumber()` (or pass `new Prisma.Decimal(link.amount)` if recordPayment accepts Decimal).

---

### ⚠️ Warning (should fix)

#### W-1: PrismaService injected directly into `PaymentsController`

```typescript
// payments.controller.ts — new constructor
constructor(
  private prisma: PrismaService,   // ← WARNING: controllers must not access Prisma directly
  private paymentsService: PaymentsService,
  private paySolutionsService: PaySolutionsService,
  private lineOaService: LineOaService,
) {}
```

The backend rule (`backend.md`) states: **"ห้ามเรียก PrismaService จาก controller โดยตรง"**. The partial-QR methods (`@Post(':id/partial-qr')`, etc.) call `this.prisma.partialPaymentLink.*` and `this.prisma.payment.*` / `this.prisma.contract.*` directly.

**Fix**: Move partial-QR DB logic into a dedicated `PartialQrService` or extend `PaymentsService`. The controller should only call a service method.

#### W-2: Inherited from `feat/sticker-print-redesign`

`Number()` on string SystemConfig values (minor). See report W-1.

---

### ℹ️ Info

- **`PaymentMethodConfigController`**: Properly guarded:
  - `@UseGuards(JwtAuthGuard, RolesGuard)` at class level ✓
  - `@Roles(...)` on all 4 endpoints ✓
  - DB access goes through `PaymentMethodConfigService` ✓
  - All queries include `deletedAt: null` ✓
  - Soft-delete on delete: `{ deletedAt: new Date(), enabled: false }` ✓
- **New `PaymentMethodConfigModule`** registered in `app.module.ts` ✓
- No hardcoded secrets ✓
- No `$queryRaw` SQL injection risk ✓
- No raw `fetch()` in frontend components ✓
- Partial-QR webhook: idempotency check via `PartialPaymentLink.status` before recording — good ✓
- Sentry capture on partial-payment record failure ✓

---

## Recommendation: 🔴 BLOCK

**7 Critical violations** (5 inherited from sticker-print-redesign + 2 new Decimal violations in partial-QR flow).  
**1 Warning** for PrismaService injection in controller (architecture violation).

Fix order:
1. Fix all `Number(decimal)` → `decimal.toNumber()` across stickers.service.ts and payments.controller.ts.
2. Move partial-QR DB logic from controller into a service layer.
3. Re-review after fixes.
