# Merge Guard Report — `fix/a1-d1-2-1-5-payroll-pii-audit`

**Date**: 2026-05-17  
**Branch**: `fix/a1-d1-2-1-5-payroll-pii-audit`  
**Author**: Akenarin Kongdach  
**Commits** (3):
1. feat(a1): D1.2.1.5 — notification_on_pending
2. fix(a1): D1.2.1.5 — notifyApprovers + APPROVAL_REQUESTED audit on submitForApproval
3. fix(a1): D1.2.1.5 follow-up — enrich APPROVAL_REQUESTED audit with PII-safe doc summary

---

## File Changes Summary

| File | Change |
|------|--------|
| `expense-documents.controller.ts` | New `POST :id/submit-for-approval` endpoint |
| `expense-documents.module.ts` | Added `NotificationsModule` import |
| `expense-documents.service.ts` | Added `submitForApproval()` + `notifyApprovers()` private helper |
| `settings.service.ts` | Added `notificationOnPending: boolean` to `getUiFlags()` |
| `settings.service.spec.ts` | 2 tests for `notificationOnPending` toggle |
| `useUiFlags.ts` (web) | Added `notificationOnPending: boolean` to `UiFlags` interface |
| 9× `__tests__/*.spec.ts` | Existing test constructors updated to pass `notifications` mock as new DI arg |
| `expense-documents.service.spec.ts` | 292-line addition: 9 new test cases for `submitForApproval` + PDPA audit payload |

---

## Issues Found

### Critical

**[CRIT-1] `PENDING_APPROVAL` is not in the `DocumentStatus` enum — runtime bomb**

```ts
// expense-documents.service.ts
const PENDING_APPROVAL = 'PENDING_APPROVAL' as unknown as DocumentStatus;
const result = await tx.expenseDocument.update({
  where: { id },
  data: { status: PENDING_APPROVAL },
});
```

The `DocumentStatus` enum in `prisma/schema.prisma` contains only:
```
DRAFT | ACCRUAL | POSTED | VOIDED
```

`PENDING_APPROVAL` is absent. The `as unknown as DocumentStatus` cast silences TypeScript but does **not** change what Prisma sends to PostgreSQL. At runtime, Prisma will attempt to write the string `'PENDING_APPROVAL'` into the `status` column, which has a PostgreSQL `enum` constraint. PostgreSQL will throw:
```
invalid input value for enum "DocumentStatus": "PENDING_APPROVAL"
```

The code comment acknowledges this dependency on "D1.2.1.6's schema migration" from a separate branch. That migration is **not yet merged into main** (`grep` of `apps/api/prisma/migrations/` confirms no migration adds `PENDING_APPROVAL` to `DocumentStatus`).

**This branch must NOT be merged before the D1.2.1.6 migration branch.** If merged as-is, calling `POST /expense-documents/:id/submit-for-approval` will throw a 500 on every request.

**Fix required**: either (a) merge D1.2.1.6 first and remove the cast, or (b) gate the entire `submitForApproval` method behind a feature flag that prevents execution until the migration runs.

---

### Warning

**[WARN-1] `findUniqueOrThrow` without `deletedAt: null` in WHERE**

```ts
const doc = await tx.expenseDocument.findUniqueOrThrow({
  where: { id },   // ← no deletedAt: null
  ...
});
if (doc.deletedAt) throw new NotFoundException('เอกสารถูกลบแล้ว');
```

The project convention (`.claude/rules/database.md`) is to include `deletedAt: null` in the WHERE clause so soft-deleted records are never loaded. Here the record is loaded first and the soft-delete check is applied manually. Functionally equivalent, but:
- Unnecessarily loads all `include` relations for a deleted doc before throwing
- Diverges from the codebase pattern, increasing the chance of future callers copying the manual check and forgetting it

**Fix**: change to `where: { id, deletedAt: null }` and replace the manual check with `if (!doc) throw new NotFoundException(...)`.

**[WARN-2] `$executeRawUnsafe` for advisory lock — warrants attention**

```ts
await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(hashtext($1))`, `post:${id}`);
```

The query is **parameterized** (`$1` bound to the `id` string), so there is no SQL injection risk. The `id` value comes from `@Param('id')` which is a UUID string validated at the controller level. This is the same advisory-lock pattern used elsewhere in the codebase (e.g., `post()`). Flagged as warning for awareness only — the pattern is safe.

---

### Info

**[INFO-1] PDPA audit payload is well-designed**  
The `APPROVAL_REQUESTED` audit log correctly omits employee names, tax IDs, and per-line salary figures from PAYROLL documents. Only `payrollPeriod` + `lineCount` are stored — compliant with Thai PDPA §6 as documented in the code.

**[INFO-2] `notifyApprovers` runs outside `$transaction` — correct**  
Notification fan-out after the status flip is intentionally placed outside the transaction. A notification failure will not roll back the `PENDING_APPROVAL` state transition. `Promise.allSettled` ensures one delivery failure doesn't abort others. This is the correct pattern.

**[INFO-3] Test suite is thorough**  
9 test cases cover: fan-out when enabled, skip when disabled, fallback to OWNERs, notification failure non-blocking, APPROVAL_REQUESTED audit atomicity, PDPA safety for EXPENSE/PAYROLL/CREDIT_NOTE types, and compliance queryability by `documentNumber`.

---

## Security Notes

- New endpoint `POST :id/submit-for-approval` inherits class-level `@UseGuards(JwtAuthGuard, RolesGuard, BranchGuard)` from `ExpenseDocumentsController`. ✅
- Method-level `@Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')` is present. ✅
- Notification payload (subject/message) contains only document number, type, amount — no PII. ✅
- Approver list is validated against the User table (active + not soft-deleted) before sending. ✅

---

## Recommendation: 🚫 BLOCK

**Blocker**: [CRIT-1] — merging without the D1.2.1.6 `DocumentStatus` migration will produce a 500 error on every `submitForApproval` call.

**Required before merge**:
1. Merge the D1.2.1.6 schema migration branch into main first (adds `PENDING_APPROVAL` to `DocumentStatus` enum)
2. Remove `as unknown as DocumentStatus` cast — use the real enum value
3. Fix `findUniqueOrThrow` to include `deletedAt: null` in WHERE [WARN-1]

The implementation quality (PDPA handling, test coverage, notification resilience) is solid — the only blocker is the missing enum dependency.
