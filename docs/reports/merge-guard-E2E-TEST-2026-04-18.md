# Merge Guard Report — E2E-TEST

**Date**: 2026-04-18  
**Branch**: `E2E-TEST`  
**Author**: iamnaii <akenarin.ak@gmail.com>  
**Recommendation**: ✅ APPROVE (with warning)

---

## File Changes Summary

| Commit | Description | Files |
|--------|-------------|-------|
| `c8aa9498` | fix(security): wire up IDOR branch check in transfer detail controller | `products.controller.ts` (+5/-2) |
| `518ed6c6` | fix(security): resolve 8 critical/high security and correctness bugs | 11 files (+149/-62) |

Total: 12 files changed, 154 insertions, 64 deletions.

**Security fixes included:**
- D1 (CRITICAL): Payment idempotency check moved inside `$transaction` — fixes race condition for duplicate payments
- D2 (HIGH): Auth token rotation (`revoke + create`) wrapped in atomic `$transaction` — fixes user lockout on crash
- S12 (HIGH): HTTPS + MaxLength validation on `evidenceUrl` and `transactionRef` in `RecordPaymentDto`
- E3 (MEDIUM): Real-time late fee recalculation at payment time (before cron runs)
- NEW-4 (MEDIUM): `UploadDocumentDto` / `DeleteDocumentDto` replace plain objects on customer document endpoints
- NEW-5 (MEDIUM): IDOR branch-level check added to `getTransferById()`
- NEW-6 (MEDIUM): Batch pagination (500/batch) in dunning cron to prevent unbounded memory
- NEW-7 (LOW): `logger.warn()` added to 5 previously silent catch blocks

---

## Issues

### Critical
_None found._

### Warning

**W1 — payments.service.ts: `Number()` on Prisma Decimal fields in new late-fee code**  
File: `apps/api/src/modules/payments/payments.service.ts`

The new real-time late fee calculation (E3 fix) introduces:
```typescript
let lateFee = Number(payment.lateFee);           // lateFee is Decimal
const amountDue = Number(payment.amountDue) + lateFee; // amountDue is Decimal
```

Per project rules, `Number()` on `Decimal` fields can cause precision loss for large values. The original code that was replaced also used `Number(payment.amountDue) + Number(payment.lateFee)` (pre-existing violation), so the new code follows the same pattern rather than worsening it. However, the new late fee calculation path adds additional `Number()` calls.

Recommended fix: Replace with `Prisma.Decimal` arithmetic:
```typescript
let lateFee = new Prisma.Decimal(payment.lateFee);
const amountDue = new Prisma.Decimal(payment.amountDue).add(lateFee);
```
`config.value` and `capConfig.value` are string configs, so `Number()` there is acceptable.

### Info

**I1 — auth.service.ts: `expiresIn` parsing loses 'd' unit suffix**  
File: `apps/api/src/modules/auth/auth.service.ts`

The new token rotation code parses `JWT_REFRESH_EXPIRATION` (default `'7d'`) as:
```typescript
const days = parseInt(expiresIn) || 7;
```
`parseInt('7d')` returns `7` correctly (parseInt stops at non-numeric char), but this is fragile — an env value of `'2w'` would silently parse as `2` (days) instead of 14. Low risk since the env default is `'7d'`, but worth noting.

---

## Checklist

| Check | Result |
|-------|--------|
| New controllers have `@UseGuards(JwtAuthGuard)` | ✅ Pass — only existing controllers modified |
| No `Number()` on money/Decimal fields | ⚠️ W1 — new Number() on lateFee/amountDue (pre-existing pattern) |
| All queries include `deletedAt: null` | ✅ Pass |
| No hardcoded secrets | ✅ Pass |
| DTOs have class-validator decorators | ✅ Pass — new DTOs fully decorated |
| HTTPS validation on URL fields | ✅ Fixed (S12) |
| `queryClient.invalidateQueries()` after mutations | N/A — no frontend changes |
| Thai validation messages on new DTOs | ✅ Pass |
| No SQL injection risk | ✅ Pass |
| IDOR branch access check | ✅ Fixed (NEW-5 + c8aa9498) |
| Atomic transactions on critical operations | ✅ Fixed (D1, D2) |
