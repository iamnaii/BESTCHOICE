# Merge Guard Report — feat/expense-documents-pr3

**Date**: 2026-05-10  
**Branch**: `feat/expense-documents-pr3`  
**Author**: Akenarin Kongdach  
**Base**: `origin/main`  
**Recommendation**: 🔴 BLOCK

---

## File Changes Summary

| Metric | Value |
|--------|-------|
| Files changed | 74 |
| Insertions | +11,960 |
| Deletions | −3,899 |
| Commits | 35 |

**Key areas touched:**
- New `expense-documents` module (controller, service, DTOs, sub-services)
- `PayrollDetail` + `PayrollLine` schema + 3 migrations
- `CreditNoteDetail` schema + migration
- `ExpenseAccrualTemplate`, `ExpenseSameDayTemplate`, `CreditNoteTemplate`, `PayrollTemplate` journal templates
- Frontend: `ExpensesPage.tsx`, `CreditNoteForm`, `PayrollForm`
- Legacy `accounting` expense endpoints removed (replaced)

---

## Issues

### 🔴 Critical

#### 1. `voidDocument()` does NOT create a reverse JE for POSTED/ACCRUAL documents

**File**: `apps/api/src/modules/expense-documents/expense-documents.service.ts` (~line 510)  
**File**: `apps/api/src/modules/expense-documents/services/status-transition.service.ts`

`assertCanVoid()` allows voiding from **any** non-VOIDED status — including `ACCRUAL` and `POSTED`. When a POSTED or ACCRUAL document is voided, the service only logs a warning and skips the reverse JE:

```ts
// PR-1 just flips status to VOIDED. Followup work in journal helper.
if (doc.journalEntryId) {
  this.logger.warn(`Voiding doc ${id} with posted JE — reverse JE TODO in journal helper`);
}
return tx.expenseDocument.update({ where: { id }, data: { status: 'VOIDED' } });
```

**Impact**: A posted expense document carrying `Dr 51-XXXX / Cr 21-1101` will leave the JE alive on the books after voiding. Trial balance will overstate expenses and AP. This violates TFRS for NPAEs (full accrual reversal requirement) and the pattern established in `accounting-expense-fixes` which does create a `ExpenseReverseTemplate` on void.

**Required fix**: Either implement the reverse JE template before merging, or hard-block voiding of `ACCRUAL`/`POSTED` status in `assertCanVoid()` until the reverse JE is ready.

---

### ⚠️ Warning

#### 2. Missing `deletedAt: null` in `findUniqueOrThrow` queries inside transactions

**File**: `apps/api/src/modules/expense-documents/expense-documents.service.ts`  
Lines: ~457, ~490, ~521

```ts
const doc = await tx.expenseDocument.findUniqueOrThrow({ where: { id } });
```

`findUniqueOrThrow` does not filter soft-deleted records. A user who knows a deleted document's ID can still `POST`, `VOID`, or `UPDATE` it. The soft-delete guard in `softDelete()` checks `deletedAt` manually, but `post()`, `update()`, and `voidDocument()` do not.

**Required fix**: Change to `findUniqueOrThrow({ where: { id, deletedAt: null } })` or add `if (doc.deletedAt) throw new NotFoundException(...)` immediately after the fetch in each method.

#### 3. `@IsNumber()` validators without Thai error messages on 8 DTO fields

**Files**: `dto/create-credit-note.dto.ts`, `dto/create-payroll.dto.ts`

Eight `@IsNumber({ maxDecimalPlaces: 2 })` decorators have no `message` option, producing generic English-language validation errors that break the Thai UI convention established in all other DTOs.

**Required fix**: Add `{ message: 'กรุณาระบุจำนวนเงินที่ถูกต้อง' }` (or field-specific Thai message) to each `@IsNumber()` call.

#### 4. `ExpensesPage.tsx` approaching maintainability threshold

**File**: `apps/web/src/pages/ExpensesPage.tsx` (910 lines)

Single file handles list, filters, forms, and three document-type modals. Not blocking, but close to the project's implicit 500-line split threshold.

---

### ℹ️ Info

#### 5. `.toNumber()` on `totalAmount` Decimal in summary aggregate

**File**: `apps/api/src/modules/expense-documents/expense-documents.service.ts` (~line 378)

```ts
accrualUnpaidTotal: accrualUnpaid._sum.totalAmount?.toNumber() ?? 0,
```

For amounts up to 12 digits, JS `number` is sufficient. Fine for display; not a precision risk at current data volumes.

#### 6. `password: 'placeholder'` in integration test fixture

**File**: `apps/api/src/modules/expense-documents/__tests__/full-lifecycle.integration.spec.ts`

Literal string used as a test fixture password (not a real credential). Not a security issue; just cosmetic.

---

## Recommendation

**🔴 BLOCK** — The void-without-reverse-JE issue (#1) is a P0 accounting integrity bug: every voided POSTED/ACCRUAL expense leaves phantom journal lines on the books. The fix is either implementing the reverse JE template (preferred) or blocking the operation at the status-transition layer until it is ready. Issues #2 and #3 are straightforward fixes that should also be resolved before merge.
