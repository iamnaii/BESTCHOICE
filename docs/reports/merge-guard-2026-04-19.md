# Pre-Merge Guard Report — 2026-04-19

**Reviewed by**: Pre-Merge Guard Agent  
**Date**: 2026-04-19  
**Branches reviewed**: 3 most-recently active (feat/fix) branches

---

## Branch 1: `feat/loyalty-redeem-at-pos`

**Author**: Akenarin Kongdach <iamnaii@MacBook-Pro-khxng-Akenarin.local>  
**Commits**: 2 (feat: loyalty redemption at POS + SMS kill-switch)

### File Changes Summary
| File | Change |
|------|--------|
| `apps/api/src/modules/sales/sales.service.ts` | +70/-24 — loyalty balance check + redemption flow |
| `apps/api/src/modules/sales/dto/sale.dto.ts` | +8 — `loyaltyPointsRedeemed` field |
| `apps/api/src/modules/notifications/notifications.service.ts` | +18/-10 — SMS kill-switch |
| `apps/api/src/modules/notifications/scheduler.service.ts` | +3/-1 — SMS kill-switch |
| `apps/api/src/utils/sms-payment-reminder.util.ts` | +15 (new) — kill-switch util |

---

### Issues

#### 🔴 CRITICAL — Must fix before merge

**C1: Race condition on loyalty balance check (financial integrity)**  
File: `apps/api/src/modules/sales/sales.service.ts`

The balance check happens _outside_ the transaction that performs the deduction:

```typescript
// ~line 228 — OUTSIDE transaction
const customer = await this.prisma.customer.findUnique(...);
if (customer.loyaltyBalance < loyaltyPoints) throw ...

// ... ~70 lines later ...

// ~line 295 — SEPARATE $transaction
await this.prisma.$transaction(async (tx) => {
  await tx.customer.update({ data: { loyaltyBalance: { decrement: loyaltyPoints } } });
});
```

Two concurrent POS sales for the same customer can both pass the pre-check with the same `loyaltyBalance`, then both decrement — resulting in double-spend of loyalty points. The balance check and decrement **must be atomic**. Fix: move the check inside the same `$transaction` and use `WHERE loyaltyBalance >= loyaltyPoints` as the deduct guard:

```typescript
const updated = await tx.customer.updateMany({
  where: { id: dto.customerId, loyaltyBalance: { gte: loyaltyPoints } },
  data: { loyaltyBalance: { decrement: loyaltyPoints } },
});
if (updated.count === 0) throw new BadRequestException('แต้มไม่เพียงพอ');
```

**C2: Internal error message leaked to API client**  
File: `apps/api/src/modules/sales/sales.service.ts`

```typescript
(sale as any)._loyaltyRedemptionFailed = err instanceof Error ? err.message : String(err);
```

This sets an internal error message (stack details, DB error strings) directly on the sale response object, which is returned to the frontend and potentially logged or displayed. Leaks internal system details. Fix: log via `this.logger.error()` + Sentry capture; do not attach error text to the response.

---

#### 🟡 WARNING — Should fix

**W1: Non-atomic sale + redemption (two separate transactions)**  
File: `apps/api/src/modules/sales/sales.service.ts`

The sale is committed first (`createCashSale` / `createInstallmentSale` each run inside `$transaction`), then loyalty deduction runs in a _separate_ `$transaction`. If the DB drops the connection between these two operations the customer receives the loyalty discount without their points being deducted. For a financial system this is a reconciliation risk.

Recommended fix: pass the loyalty deduction into the sale's own Prisma transaction so both operations share the same ACID boundary. Requires refactoring `createCashSale` / `createInstallmentSale` to accept an optional `tx` parameter or a post-hook.

**W2: `loyaltyPointsRedeemed` cap check uses pre-tax selling price**  
File: `apps/api/src/modules/sales/sales.service.ts`

```typescript
if (loyaltyPoints > dto.sellingPrice - baseDiscount) {
  throw new BadRequestException('จำนวนแต้มที่แลกเกินยอดสุทธิ');
}
```

`dto.sellingPrice` is the gross amount. For `INSTALLMENT` sales the final `netAmount` includes interest and may differ from `sellingPrice - discount`. The cap should be validated against the final `netAmount` computed by the relevant sale-type helper, not the raw DTO price.

---

#### ℹ️ INFO

- `eslint-disable-next-line @typescript-eslint/no-explicit-any` appears twice — acceptable given the type narrowing needed, but C2 fix above would remove both.
- SMS kill-switch logic is clean and correct. No issues with that portion.

---

### Recommendation: 🔴 BLOCK

Must resolve C1 (race condition) and C2 (error leak) before merge. W1 is strongly recommended to fix simultaneously.

---

---

## Branch 2: `feat/disable-sms-payment-reminder`

**Author**: Akenarin Kongdach <iamnaii@MacBook-Pro-khxng-Akenarin.local>  
**Commits**: 1 (feat: kill-switch ปิด SMS แจ้งเตือนการชำระ)

### File Changes Summary
| File | Change |
|------|--------|
| `apps/api/src/modules/notifications/notifications.service.ts` | +18/-10 — check kill-switch at 3 call sites |
| `apps/api/src/modules/notifications/scheduler.service.ts` | +2/-1 — check kill-switch |
| `apps/api/src/utils/sms-payment-reminder.util.ts` | +15 (new) — `isSmsPaymentReminderDisabled()` |
| `.env.example` | +5 — documents `SMS_PAYMENT_REMINDER_DISABLED` |

### Issues

No Critical, Warning, or Info issues found.

- Kill-switch reads `process.env.SMS_PAYMENT_REMINDER_DISABLED` directly — NestJS `ConfigService` would be more idiomatic, but this is a simple boolean env flag and the pattern is acceptable (consistent with other kill-switches in the codebase).
- All 3 SMS call sites are covered: `sendPaymentReminders`, `sendOverdueNotices`, dunning escalation fallback.
- LINE / OTP / broadcast channels are correctly unaffected.
- Warning logs are appropriate and identifiable (`[SMS-REMINDER-OFF]` prefix).

### Recommendation: ✅ APPROVE

---

---

## Branch 3: `feat/peak-daily-sync-cron-v2`

**Author**: Akenarin Kongdach <iamnaii@MacBook-Pro-khxng-Akenarin.local>  
**Commits**: 1 (feat: daily sync cron at 23:30 Asia/Bangkok T6-C8)

### File Changes Summary
| File | Change |
|------|--------|
| `apps/api/src/modules/peak/peak-sync.cron.ts` | +60 (new) — `PeakSyncCron` class |
| `apps/api/src/modules/peak/peak-sync.cron.spec.ts` | +72 (new) — 5 unit tests |
| `apps/api/src/modules/peak/peak.module.ts` | +2/-1 — register `PeakSyncCron` |

### Issues

No Critical, Warning, or Info issues found.

- `PeakController` (existing) already has `@UseGuards(JwtAuthGuard, RolesGuard)` + `@Roles('OWNER')` — cron addition does not loosen any guards.
- Sentry capture on both partial errors (`captureMessage` warning level) and full exceptions (`captureException`) — matches v3 hardening pattern.
- `isConfigured()` guard prevents silent failures when PEAK is not set up.
- Idempotency via `peakSyncedAt = null` filter in `exportJournalEntries` — re-running is safe.
- 5-scenario test suite covers: skip when unconfigured, window size, success count, Sentry warning on errors, exception swallowing.
- Cron schedule `30 23 * * *` `Asia/Bangkok` is reasonable for end-of-business-day sync.

### Recommendation: ✅ APPROVE

---

## Summary

| Branch | Recommendation | Blocking Issues |
|--------|---------------|-----------------|
| `feat/loyalty-redeem-at-pos` | 🔴 BLOCK | C1 race condition, C2 error leak |
| `feat/disable-sms-payment-reminder` | ✅ APPROVE | None |
| `feat/peak-daily-sync-cron-v2` | ✅ APPROVE | None |
