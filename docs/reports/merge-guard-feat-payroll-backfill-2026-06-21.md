# Merge Guard Report — feat/payroll-backfill + feat/employee-master + fix/ci-pre-existing-test-failures

**Date**: 2026-06-21  
**Reviewer**: Pre-Merge Guard (automated)  
**Branches reviewed**: feat/payroll-backfill, feat/employee-master, fix/ci-pre-existing-test-failures  
**Author**: Akenarin Kongdach (akenarin.ak@gmail.com)

---

## Branch Overview

All three branches share a common ancestor (`Merge fix/master-data-settings-zone`, 2026-06-13). They build on each other in this order:

```
main → feat/employee-master (12 unique commits)
     → feat/payroll-backfill (+146 more commits, includes employee-master)
     → fix/ci-pre-existing-test-failures (+23 more commits, includes both)
```

**Scale**: 713 files changed, 491 TS/TSX files, 158 commits total since divergence from main.

---

## 🔴 CRITICAL — Must Fix Before Merge

### C-1: SALES User PII Authorization Bypass in `staff-chat.controller.ts`

**File**: `apps/api/src/modules/staff-chat/staff-chat.controller.ts`  
**Branch**: feat/payroll-backfill (and downstream)

The original `GET /chat/rooms/:id` endpoint had an explicit authorization check preventing SALES users from accessing chat rooms assigned to other staff:

```typescript
// REMOVED:
if (req.user.role === 'SALES' && room.assignedToId && room.assignedToId !== req.user.id) {
  throw new ForbiddenException('ไม่มีสิทธิ์เข้าถึงห้องแชทนี้');
}
```

The new code reduces this to:

```typescript
async getRoom(@Param('id') id: string) {
  return this.roomManager.findById(id);
}
```

The `findById()` method in `room-manager.service.ts` returns `customer.nationalId` in the response:

```typescript
customer: { select: { id: true, name: true, phone: true, nationalId: true } }
```

**Impact**: Any SALES user can now call `GET /chat/rooms/<uuid>` to retrieve another customer's PII (`nationalId`, `phone`) for any room, including those assigned to other staff. This is a PDPA violation and a direct regression from a documented security control. The room UUID is not secret (sent over WebSocket events).

**Required fix**: Restore the SALES user check in the controller, or move the authorization logic into `findById(roomId, { userId, userRole })` in the service layer.

---

## 🟡 WARNING — Should Fix Before Merge

### W-1: `Number()` on Prisma Decimal Money Fields in `scheduler.service.ts`

**File**: `apps/api/src/modules/notifications/scheduler.service.ts`

```typescript
// ADDED (violates Decimal precision rule):
(sum, p) => sum + (Number(p.amountDue) - Number(p.amountPaid) + Number(p.lateFee))
const lateFee = contract.payments.reduce((sum, p) => sum + Number(p.lateFee), 0);
const amountDue = Number(payment.amountDue) + Number(payment.lateFee) - Number(payment.amountPaid);
```

These are `@db.Decimal(12,2)` fields. Using `Number()` causes floating-point precision loss in SMS notification calculations. While not directly used in journal entries, rounding errors can cause mismatched notification amounts (e.g. "14,999.99 บาท" vs "15,000.00 บาท").

**Required fix**: Use `.toNumber()` via Prisma.Decimal arithmetic, or use Prisma.Decimal methods (`p.amountDue.sub(p.amountPaid).add(p.lateFee)`).

### W-2: `Number()` on Decimal in `bank-reconciliation.service.ts`

**File**: `apps/api/src/modules/accounting/bank-reconciliation.service.ts`

```typescript
this.amountMatches(Number(p.amountPaid), line.amount)
```

The `amountMatches` method uses `Math.abs(a - b) <= TOLERANCE` which requires `number`. However, `p.amountPaid` is `Prisma.Decimal`. This is acceptable IF `line.amount` is also a number from the bank import, but the conversion should be explicit via `.toNumber()` with a comment explaining why, not bare `Number()`.

### W-3: `two-factor.controller.ts` Missing `RolesGuard` and `@Roles()`

**File**: `apps/api/src/modules/two-factor/two-factor.controller.ts`

The new 2FA controller uses `@UseGuards(JwtAuthGuard)` only at the class level. Per security rules, every controller should pair `JwtAuthGuard` with `RolesGuard` and each method should have `@Roles()`. While 2FA management is intentionally available to any authenticated user, the absence of `RolesGuard` is an inconsistency that could cause confusion during future audits.

**Recommended fix**:
```typescript
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('2fa')
export class TwoFactorController {
  @Post('enroll')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  async startEnrollment(...)
```

### W-4: `.toNumber()` Overuse in `accounting.service.ts` Report Methods

**File**: `apps/api/src/modules/accounting/accounting.service.ts`

103 new `.toNumber()` conversions in report/P&L service methods. While `.toNumber()` is acceptable in read-only reporting (values go to JSON response, not back to DB), the volume suggests a systematic pattern that deserves a second review. Any of these being copy-pasted into write paths would introduce precision bugs.

### W-5: `Number()` on Decimal Fields in `contracts.service.ts`

**File**: `apps/api/src/modules/contracts/contracts.service.ts`

```typescript
sellingPrice: Number(contract.sellingPrice),
downPayment: Number(contract.downPayment),
monthlyPayment: Number(contract.monthlyPayment),
financedAmount: Number(created.financedAmount),
```

These are in response-mapping code (contract preview/creation response). While they don't go back to the DB, the pattern of bare `Number()` vs `.toNumber()` is inconsistent with codebase conventions (hardening v4 converted 53 such cases).

---

## 🔵 INFO — Awareness Items

### I-1: TypeScript `any` Usage — 118 New Instances

The diff adds 118 new `: any` or `as any` occurrences. Most appear in test files and utility code but some in production service files. No immediate blocking risk, but creates future maintenance burden.

### I-2: `shop-reviews.controller.ts` — Intentionally Public `GET` Endpoints

**File**: `apps/api/src/modules/shop-reviews/shop-reviews.controller.ts`

`GET /:productId` and `GET /:productId/summary` have no `@UseGuards` — intentionally public as documented in `security.md` (shop-* storefront family). The `POST /` create endpoint correctly uses `JwtAuthGuard`. Confirm this is intentional design for anonymous shoppers.

### I-3: `shop-installment-apply.controller.ts` — POST Public by Design

The `POST /shop/applications` endpoint lacks `JwtAuthGuard` intentionally (anonymous shopper flow). The controller comment documents this. No action needed; confirming alignment with `security.md`.

### I-4: `feat/employee-master` Unique Commits — Clean

The 12 commits unique to `feat/employee-master` (employee backend module: CRUD, provision, soft-delete, audit) are well-structured. `EmployeesController` has `@UseGuards(JwtAuthGuard, RolesGuard)` at class level and `@Roles()` on every method. DTOs have Thai validation messages. No critical issues.

### I-5: `fix/ci-pre-existing-test-failures` Notable Fix

`8578057b` — `commissionRate @Max(1)` DTO guard prevents negative `netExpectedAmount` in finance-receivable. Good defensive fix with test coverage.

---

## File Change Summary

| Scope | Count |
|-------|-------|
| Total files changed vs main | 713 |
| TS/TSX files changed | 491 |
| New controllers (all branches) | 2 new: `two-factor.controller.ts`, `crm.controller.ts` |
| New services | 15+ |
| New DTOs | 5 |
| Unique commits (feat/payroll-backfill) | 158 |

---

## Recommendations

| Branch | Decision | Reason |
|--------|----------|--------|
| `feat/payroll-backfill` | **BLOCK** | C-1: SALES PII bypass is a PDPA regression |
| `feat/employee-master` | **REVIEW** | Clean backend, but included in payroll-backfill; fix C-1 first |
| `fix/ci-pre-existing-test-failures` | **REVIEW** | Good fixes, but downstream of payroll-backfill; C-1 must be resolved in the chain |

**Recommended next step**: Fix `staff-chat.controller.ts` `getRoom()` to restore the SALES cross-assignment guard, then re-run this check.
