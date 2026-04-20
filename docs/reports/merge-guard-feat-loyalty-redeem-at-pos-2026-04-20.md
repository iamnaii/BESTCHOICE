# Merge Guard Report — feat/loyalty-redeem-at-pos

**Date**: 2026-04-20  
**Branch**: `feat/loyalty-redeem-at-pos`  
**Author**: Akenarin Kongdach  
**Commits**: 2  
- `f99b88d0 feat(sales): allow loyalty points redemption at POS (T6-C1)`
- `373edc04 feat(notifications): kill-switch ปิด SMS แจ้งเตือนการชำระ`

**Recommendation**: 🟡 REVIEW (block on C1)

---

## File Changes Summary

| File | +/- | Purpose |
|------|-----|---------|
| `apps/api/src/modules/sales/sales.service.ts` | +70 / -3 | Loyalty redemption logic at POS |
| `apps/api/src/modules/sales/dto/sale.dto.ts` | +8 | `loyaltyPointsRedeemed?: number` DTO field |
| `apps/api/src/modules/notifications/notifications.service.ts` | +28 / -13 | SMS kill-switch for payment reminders + overdue notices |
| `apps/api/src/modules/notifications/scheduler.service.ts` | +3 / -1 | SMS kill-switch for dunning escalations |
| `apps/api/src/utils/sms-payment-reminder.util.ts` | +15 | Kill-switch utility — reads `SMS_PAYMENT_REMINDER_DISABLED` env |
| `.env.example` | +5 | Documents `SMS_PAYMENT_REMINDER_DISABLED=false` |

---

## Issues

### 🔴 Critical

#### C1 — Loyalty redemption is not atomic with the sale — discount applied without guaranteed point deduction

**File**: `apps/api/src/modules/sales/sales.service.ts` lines ~282–315

The flow is:
1. Pre-validate customer loyalty balance (lines ~224–244)
2. Commit the sale (`createCashSale` / `createInstallmentSale` / `createExternalFinanceSale`) — **sale is now persisted** with a discount = baseDiscount + loyaltyPoints
3. In a *separate* try/catch block, attempt to deduct loyalty balance and create `LoyaltyRedemption` record

```typescript
// Sale already committed ↑
try {
  await this.prisma.$transaction(async (tx) => {
    await tx.loyaltyRedemption.create(...)
    await tx.customer.update({ data: { loyaltyBalance: { decrement: loyaltyPoints } } })
  });
} catch (err) {
  (sale as any)._loyaltyRedemptionFailed = err instanceof Error ? err.message : String(err);
}
```

**If the second transaction fails** (DB transient error, constraint violation, deadlock), the customer receives the discount for free — their points balance is not decremented. There is no Sentry alert, no retry, and no compensating transaction. The comment says "support flow will reconcile" but there is no mechanism to detect the failure in production.

This is a financial integrity issue: a loyalty discount is applied but the liability (point balance) is not reliably settled.

**Fix**: Include the loyalty deduction inside the same `$transaction` as the sale creation, passing `loyaltyPoints` and `customerId` into the per-type private methods (`createCashSale` etc.) so the entire operation is atomic. If the sale type methods cannot be refactored, at minimum add Sentry capture on the catch block so the failure surfaces in the monitoring dashboard.

---

### ⚠️ Warning

#### W1 — `_loyaltyRedemptionFailed` leaks internal error to API consumers via `as any`

**File**: `apps/api/src/modules/sales/sales.service.ts` line ~312

```typescript
(sale as any)._loyaltyRedemptionFailed = err instanceof Error ? err.message : String(err);
```

The internal error message is attached to the sale response object with a type-unsafe cast. This:
1. Exposes internal DB error messages to API consumers
2. Is not part of the typed response contract — callers can't reliably detect it
3. Has no Sentry capture for on-call visibility

At minimum, add a Sentry capture; consider logging only (not returning in the response) and using a proper status field in the typed response.

#### W2 — Missing Sentry capture on loyalty deduction failure

**File**: `apps/api/src/modules/sales/sales.service.ts` catch block ~line 310

Other financial error paths in this codebase (PaySolutions, commissions) capture to Sentry. The silent catch here bypasses that convention, meaning a stream of failed point deductions would go unnoticed until a reconciliation audit.

#### W3 — `dto.customerId` assumed present in loyalty pre-check without validation

**File**: `apps/api/src/modules/sales/sales.service.ts` line ~224

```typescript
const customer = await this.prisma.customer.findUnique({
  where: { id: dto.customerId },  // undefined if omitted
  ...
});
if (!customer || customer.deletedAt) throw new NotFoundException('ไม่พบลูกค้า');
```

`dto.customerId` has no `@IsNotEmpty()` validation in the DTO for the loyalty path. If `loyaltyPointsRedeemed > 0` but `customerId` is absent, Prisma will query `where: { id: undefined }` which returns null → `NotFoundException('ไม่พบลูกค้า')` — a misleading error. Add a guard: `if (loyaltyPoints > 0 && !dto.customerId) throw new BadRequestException('ต้องระบุ customerId เมื่อใช้แต้ม')`.

---

### ℹ️ Info

#### I1 — SMS kill-switch implementation is clean

`isSmsPaymentReminderDisabled()` is a single-purpose utility, documented clearly, covers all three reminder paths (upcoming payment, overdue notice, dunning escalation), and `.env.example` is updated. Other SMS channels (OTP, KYC, manual) are unaffected.

#### I2 — `discountAmount: new Prisma.Decimal(loyaltyPoints)` — correct Decimal usage ✓

Points discount correctly uses `Prisma.Decimal` for the `LoyaltyRedemption.discountAmount` field.

#### I3 — `loyaltyBalance Int` — correct; `decrement: loyaltyPoints` type-safe ✓

Schema uses `Int` for loyalty points. The `decrement` call with an `Int` value is type-safe.

#### I4 — DTO validation decorators present on `loyaltyPointsRedeemed` ✓

`@IsNumber`, `@IsOptional`, `@Type(() => Number)`, `@Min(0)` with Thai message — complete.

---

## Verdict

**🟡 REVIEW** — The SMS kill-switch (commit `373edc04`) is solid and can merge independently. The loyalty POS feature (commit `f99b88d0`) has a Critical financial integrity gap (C1): the sale discount is committed before the point deduction, with no atomic rollback or alerting if the deduction fails. Recommend fixing C1 before merge, and addressing W1/W2 (Sentry + response cleanup).
