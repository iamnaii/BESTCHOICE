# Merge Guard Report — `feat/payment-method-config-qr`

**Date**: 2026-05-08  
**Author**: iamnaii@MacBook-Pro-khxng-Akenarin.local  
**Commits**: 4

---

## File Changes Summary

| Area | Files | Net Change |
|------|-------|-----------|
| New module: `payment-method-config` | controller, service, 2 DTOs, module | +251 lines |
| `paysolutions.service.ts` | +326 lines (createEarlyPayoffQR + createPartialPaymentQR) | large |
| `payments.controller.ts` | +47 lines (3 new endpoints) | +47 |
| `payments.module.ts` | forwardRef wiring | +11 |
| New cron: `partial-payment-expire.cron.ts` | ACTIVE→EXPIRED sweep | +41 |
| Prisma schema | `PaymentMethodConfig` + `PartialPaymentLink` models | +89 lines |
| LINE OA flex messages | 14 flex messages redesigned to Style D | large |
| Migrations | 2 new migration files | +106 lines |
| Test files | spec updates | +3–6 lines each |

---

## Issues Found

### Critical

#### C1 — Direct Prisma calls in PaymentsController
**File**: `apps/api/src/modules/payments/payments.controller.ts` (lines ~296–330)

```typescript
// VIOLATION: controller calls this.prisma directly
@Get(':id/partial-qr/active')
async getActivePartialQr(@Param('id', ParseUUIDPipe) id: string) {
  return this.prisma.partialPaymentLink.findFirst({   // ← direct Prisma
    where: { paymentId: id, status: 'ACTIVE', expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
  });
}

@Delete(':id/partial-qr')
async cancelPartialQr(@Param('id', ParseUUIDPipe) id: string) {
  const link = await this.prisma.partialPaymentLink.findFirst(...);  // ← direct Prisma
  return this.prisma.partialPaymentLink.update(...);                  // ← direct Prisma
}
```

**Rule violated**: `backend.md` — "ห้ามเรียก PrismaService จาก controller โดยตรง — ต้องผ่าน service เสมอ"

**Fix**: Move `getActivePartialQr` and `cancelPartialQr` logic into `PaySolutionsService` (or a dedicated `PartialPaymentLinkService`), and call from the controller via that service. The `PrismaService` injection in `PaymentsController` should be removed.

---

### Warning

#### W1 — `Number()` on Decimal financial field passed to financial operation
**File**: `apps/api/src/modules/paysolutions/paysolutions.service.ts`

```typescript
// link.amount is Decimal(12,2) from DB; converted to number before passing to recordPayment
await this.paymentsService.recordPayment(
  payment.contractId,
  payment.installmentNo,
  Number(link.amount),   // ← Decimal → number on financial operation
  'ONLINE_GATEWAY',
  ...
);
```

**Rule**: `coding-standards.md` (Decimal rule, v3/v4 hardening) — "Decimal precision: 53 `Number()` → `Prisma.Decimal` ใน 12 services". `Number()` on two-decimal-place values rarely loses precision in practice, but it violates the project's explicit Decimal discipline.

**Fix**: Either update `recordPayment` signature to accept `Decimal | number` with internal `new Prisma.Decimal(amount)` coercion, or pass `link.amount` directly if `recordPayment` is updated to accept `Decimal`.

Note: `Number(payment.amountDue)` used in the LINE Flex builder is display-only and less critical, but the same pattern applies.

#### W2 — PartialPaymentLink missing `deletedAt`
**File**: `apps/api/prisma/schema.prisma` (new `PartialPaymentLink` model)

The model uses `status` + `cancelledAt` for lifecycle management but has no `deletedAt` field. `database.md` requires `deletedAt` on all models unless documented as an exception.

**Fix**: Either add `deletedAt DateTime? @map("deleted_at")` and a `/// Immutable...` comment, or add a documented exception comment explaining why status-transition replaces soft-delete (analogous to the `ProcessedWebhookEvent` exception pattern).

#### W3 — DTO defined inline in controller file
**File**: `apps/api/src/modules/payments/payments.controller.ts` (lines ~32–38)

```typescript
class CreatePartialQrDto {
  @IsNumber()
  @Min(1, { message: 'ยอดต้องมากกว่า 0 บาท' })
  amount!: number;
}
```

**Rule**: `backend.md` convention — DTOs belong in `dto/` subdirectory (e.g., `dto/create-partial-qr.dto.ts`). Inline DTO classes are non-standard and harder to find/test.

**Fix**: Move to `apps/api/src/modules/payments/dto/create-partial-qr.dto.ts`.

---

### Info

#### I1 — `partial-payment-expire.cron.ts` lacks Sentry job start/finish tracing
The new cron has `catch` → Sentry, which is good. However, per v2 hardening pattern, crons should also capture a Sentry check-in "start" before the operation and "finish" after, so missed runs are detected. The existing 17 crons follow this pattern.

#### I2 — PaymentsModule uses `forwardRef` circular dependency
`forwardRef(() => PaySolutionsService)` in `PaymentsController` and `forwardRef(() => PaymentsService)` in `PaySolutionsService` create a circular dependency. This is functional but indicates the partial-QR lifecycle logic may be better housed in a dedicated module (e.g., `PartialPaymentModule`) to break the cycle cleanly.

---

## New `PaymentMethodConfig` Module — No Issues

The new `payment-method-config` module (`controller`, `service`, DTOs) is well-structured:
- `@UseGuards(JwtAuthGuard, RolesGuard)` present at class level ✅
- All methods have `@Roles()` ✅
- DTOs use class-validator with Thai messages ✅
- Service uses `deletedAt: null` filters ✅
- Soft-delete implemented correctly ✅
- Duplicate guard before create ✅
- "Last account protection" guard in remove ✅

---

## Recommendation: 🚫 BLOCK

**C1 is a clear architecture violation** — controllers must not call Prisma directly. Must be fixed before merge.

W1 (Decimal precision) should also be resolved given the project's explicit v3/v4 hardening history on this topic. The call site passes the result directly into `recordPayment` which triggers financial journal entries.

W2 and W3 are lower priority but should be addressed in the same pass.
