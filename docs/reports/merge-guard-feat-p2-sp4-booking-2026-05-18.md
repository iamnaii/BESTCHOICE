# Merge Guard Report — feat/p2-sp4-booking

**Date**: 2026-05-18  
**Branch**: `feat/p2-sp4-booking`  
**Author**: Akenarin Kongdach  
**Recommendation**: 🔴 **BLOCK** — 1 Critical issue must be fixed before merge

---

## File Changes Summary

| File | Lines Added | Notes |
|------|------------|-------|
| `apps/api/prisma/schema.prisma` | +95 | New `Booking`, `BookingItem` models |
| `apps/api/src/app.module.ts` | +3 | BookingsModule wired in |
| `apps/api/src/modules/bookings/__tests__/bookings.service.spec.ts` | +559 | Service unit tests |
| `apps/api/src/modules/bookings/booking-expire.cron.ts` | +35 | Daily 00:30 BKK auto-expire cron |
| `apps/api/src/modules/bookings/bookings.controller.ts` | +141 | REST controller |
| `apps/api/src/modules/bookings/bookings.module.ts` | +11 | Module wiring |
| `apps/api/src/modules/bookings/bookings.service.ts` | +823 | Core service (823 lines) |
| `apps/api/src/modules/bookings/dto/*.ts` | +184 | 4 DTO files |
| `apps/api/src/utils/sequence.util.ts` | +37 | `generateBookingNumber` added |
| `apps/web/src/pages/BookingsPage.tsx` | +892 | Full page component (892 lines) |
| `apps/web/e2e/bookings.spec.ts` | +68 | E2E smoke tests |
| `apps/web/src/App.tsx` | +13 | Route + lazy load |
| `apps/web/src/config/menu.ts` | +3 | Sidebar entry |
| `apps/web/src/pages/BookingsPage.test.tsx` | +47 | Unit tests |
| `docs/` | +161 | Roadmap doc |

---

## Issues

### 🔴 Critical — Must Fix Before Merge

#### C1 — `Number()` on Decimal commission rate (financial precision bug)

**File**: `apps/api/src/modules/bookings/bookings.service.ts`  
**Location**: `convertToSale()` method, commission calculation block

```typescript
// WRONG — current code
const commissionRate = rule?.rate ? Number(rule.rate) : 0.03;
const commissionAmount = totalAmount.mul(commissionRate).toDecimalPlaces(2);
await tx.salesCommission.create({
  data: {
    commissionRate,    // ← stored as JS float in a Decimal(5,4) column
    commissionAmount,
    ...
  }
});
```

`rule.rate` is `Decimal` from Prisma (mapped to `@db.Decimal(5, 4)`). Converting via `Number()` introduces IEEE-754 float precision loss before the `totalAmount.mul()` call. The `SalesCommission.commissionRate` column is `Decimal(5, 4)` — storing a float here violates the project rule **"use Prisma.Decimal, never Number()"**.

**Fix**:
```typescript
import { Prisma } from '@prisma/client';

const commissionRate = rule?.rate ?? new Prisma.Decimal('0.03');
const commissionAmount = totalAmount.mul(commissionRate).toDecimalPlaces(2);
await tx.salesCommission.create({
  data: {
    commissionRate,  // now Decimal — Prisma maps correctly to Decimal(5,4)
    commissionAmount,
    ...
  }
});
```

---

### 🟡 Warning — Should Fix

#### W1 — Frontend float subtraction on Decimal API values

**File**: `apps/web/src/pages/BookingsPage.tsx`  
**Locations**: `isPartialDeposit` guard + outstanding balance display

```typescript
// computed balance via float subtraction — can drift on large amounts
const isPartialDeposit =
  !!booking && Number(booking.depositAmount) < Number(booking.totalAmount);
const outstandingBalance = booking
  ? Number(booking.totalAmount) - Number(booking.depositAmount)
  : 0;

// display line also does float arithmetic
{fmtMoney(Number(booking.totalAmount) - Number(booking.depositAmount))}
```

`booking.depositAmount` and `booking.totalAmount` arrive as Decimal strings from the API. `Number()` coerces them to float before subtraction — fine for typical 2 d.p. Thai baht amounts but inconsistent with the codebase convention and will fail ESLint if `no-restricted-syntax` is ever added for `Number()` on financial fields.

**Suggested fix** (minimal): use `parseFloat` + `toFixed(2)` is equivalent but still float. The idiomatic fix for the comparison is:
```typescript
import { Decimal } from 'decimal.js'; // re-export from '@prisma/client'
const dep = new Decimal(booking.depositAmount);
const total = new Decimal(booking.totalAmount);
const isPartialDeposit = !!booking && dep.lessThan(total);
const outstandingBalance = booking ? total.minus(dep) : new Decimal(0);
```
Or use the existing `fmtMoney` utility if it already wraps Decimal math.

#### W2 — `Number(i.unitPrice)` sent in API create payload

**File**: `apps/web/src/pages/BookingsPage.tsx`  
**Location**: `createMutation.mutationFn`, items mapping

```typescript
items: items.map((i) => ({
  quantity: Number(i.quantity),
  unitPrice: Number(i.unitPrice),  // ← unnecessary if already numeric state
  ...
}))
```

`unitPrice` in local state is already `number`. `Number()` wrapping is redundant but harmless here (no Decimal string involved). Still worth removing for clarity.

---

### 🔵 Info

#### I1 — `bookings.service.ts` is 823 lines

The service handles 7 distinct operations (findAll, findOne, create, update, payDeposit, cancel, convertToSale, autoExpire). At 823 lines it is above the 500-line guidance. Consider splitting `convertToSale` and commission logic into a `BookingConversionService` or a shared `commissions-auto.service.ts` helper in a follow-up PR — not a blocker for this one.

#### I2 — `BookingsPage.tsx` is 892 lines

Same guidance — the CreateBookingDialog and BookingDetailDialog could be extracted to separate component files. Acceptable as-is for a first PR.

#### I3 — Test assertions use `Number()` on Decimal mock data

**File**: `apps/api/src/modules/bookings/__tests__/bookings.service.spec.ts`

```typescript
expect(Number(createArgs.data.totalAmount)).toBe(40990);
```

Acceptable in test context (converting mock Decimal for assertion comparison), but slightly brittle. `new Prisma.Decimal('40990').equals(createArgs.data.totalAmount)` is more type-safe. Low priority.

---

## What's Good ✅

- `@UseGuards(JwtAuthGuard, RolesGuard, BranchGuard)` at controller class level ✅
- `@Roles()` on every endpoint ✅
- Sentry capture in `booking-expire.cron.ts` (mirrors v2 pattern) ✅
- `deletedAt: null` in all queries ✅
- DTO validation with Thai error messages ✅
- No raw `$queryRaw` / SQL injection vectors ✅
- Frontend uses `api.post()` / `api.get()` — no raw `fetch()` ✅
- `queryClient.invalidateQueries()` called in all mutation `onSuccess` handlers ✅
- No hardcoded secrets or API keys ✅
- No hardcoded hex/gray CSS colors ✅
