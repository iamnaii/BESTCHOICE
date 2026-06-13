# Pre-Merge Guard Report: fix/ci-pre-existing-test-failures

**Date**: 2026-06-13  
**Branch**: `origin/fix/ci-pre-existing-test-failures`  
**Authors**: Akenarin Kongdach, iamnaii  
**Commits ahead of main**: 178  
**Last commit**: 2026-06-08  

---

## File Changes Summary

- **408 TypeScript/TSX files changed** vs `main` (large accumulated branch)
- Top 2 commits are test-only CI fixes (`fix(ci): repair 3 pre-existing test failures`, `ci(e2e): exclude incomplete approval-workflow harness`)
- The bulk of the diff represents accumulated feature work across 176 earlier commits
- Key changed areas: `accounting.service.ts` (+2073 lines), `staff-chat.controller.ts`, `notifications.service.ts`, `scheduler.service.ts`, `data-audit.service.ts`

---

## Issues by Severity

### 🔴 CRITICAL

**C1 — PII access control removed from `GET /staff-chat/rooms/:id`**  
File: `apps/api/src/modules/staff-chat/staff-chat.controller.ts`

The `getRoom` method had an explicit, commented guard preventing SALES-role users from reading rooms not assigned to them. The code comment explicitly noted that room payloads contain customer PII (phone/nationalId). This guard was removed entirely:

```ts
// BEFORE (protected):
async getRoom(@Param('id') id: string, @Req() req: ...) {
  const room = await this.roomManager.findById(id);
  if (!room) throw new NotFoundException('ไม่พบห้องแชท');
  // SALES may only open rooms assigned to them (or still unassigned).
  // The room payload includes customer PII (phone/nationalId), so a SALES
  // user must not be able to read an arbitrary room by guessing its id.
  if (req.user.role === 'SALES' && room.assignedToId && room.assignedToId !== req.user.id) {
    throw new ForbiddenException('ไม่มีสิทธิ์เข้าถึงห้องแชทนี้');
  }
  return room;
}

// AFTER (unprotected):
async getRoom(@Param('id') id: string) {
  return this.roomManager.findById(id);
}
```

Any authenticated SALES user can now enumerate any customer room UUID and read full PII. This is a PDPA/security regression. **Must restore the SALES-role check before merge.**

---

**C2 — `Number()` on Decimal money fields in financial calculations (non-display)**  
Files: `accounting.service.ts`, `data-audit.service.ts`, `scheduler.service.ts`, `notifications.service.ts`, `paysolutions.service.ts`

Multiple new arithmetic operations convert `Prisma.Decimal` to JavaScript `number` before doing sums/subtractions — introducing floating-point precision loss at the exact points where financial accuracy matters. v4 hardening explicitly purged this pattern from 53 sites across 12 services.

Examples in non-display calculation contexts:
```ts
// accounting.service.ts
const remaining = Number(p.amountDue) - Number(p.amountPaid ?? 0);

// data-audit.service.ts
.reduce((sum, p) => sum + Number(p.amountDue) - Number(p.amountPaid), 0)

// scheduler.service.ts
const outstanding = Number(payment.amountDue) - Number(payment.amountPaid) + Number(payment.lateFee);
(sum, p) => sum + (Number(p.amountDue) - Number(p.amountPaid) + Number(p.lateFee))
const amountDue = Number(payment.amountDue) + Number(payment.lateFee) - Number(payment.amountPaid);

// paysolutions.service.ts
fullAmount: Number(payment.amountDue),
amount: Number(payment.amountDue),
```

Note: `Number().toLocaleString()` and `Number().toFixed()` for display-only formatting are acceptable and are NOT flagged here.

**Fix**: Use `new Prisma.Decimal(x).sub(y).add(z)` for arithmetic, reserve `.toNumber()` only at serialization boundaries.

---

### 🟡 WARNING

**W1 — `queryClient.invalidateQueries()` patterns not verified in 6+ new mutations**  
TSX changes include new `useMutation` calls in reporting/accounting pages. Full TSX diff was too large to enumerate all cases, but spot-checks in accounting controller integration show cache invalidation is missing on some mutation side effects.

**W2 — `any` type in new production service methods**  
`documents.service.ts` uses `contract: any` and `payments: any[]` in contract document generation — high risk for silent type errors in legal document output.

**W3 — Thai validation messages inconsistent on 2 new DTOs**  
Some new `UpdateDto` classes in the accounting module use English error messages (e.g., `{ message: 'Required' }`) rather than Thai (per project convention `{ message: 'กรุณาระบุ...' }`).

---

### 🔵 INFO

**I1 — `$queryRaw` usage is safe (parameterized)**  
10 new `$queryRaw` calls in `accounting.service.ts` all use `Prisma.sql` tagged template literals — properly parameterized, no SQL injection risk.

**I2 — New controllers retain proper guards**  
All other new/changed controllers (`accounting.controller.ts`, `shop-promotions.controller.ts`, `shop-installment-apply.controller.ts`) correctly carry `@UseGuards(JwtAuthGuard, RolesGuard)` at the class level with `@Roles()` on each method.

**I3 — Large accumulated diff complicates review**  
At 408 changed TS files, individual reviewer attention may miss issues. Consider splitting into smaller, focused PRs.

---

## Recommendation: 🔴 BLOCK

Two blockers must be resolved before merge:

1. **C1** — Restore the SALES-role PII access guard in `StaffChatController.getRoom()`. The original code and comment were correct; this removal is a regression.

2. **C2** — Convert financial `Number()` arithmetic in `accounting.service.ts`, `data-audit.service.ts`, `scheduler.service.ts`, and `notifications.service.ts` to `Prisma.Decimal` operations. This directly repeats the pattern that v4 hardening fixed in 53 places.
