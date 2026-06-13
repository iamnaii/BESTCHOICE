# Pre-Merge Guard Report — 2026-06-13

**Reviewed by**: Pre-Merge Guard Agent  
**Date**: 2026-06-13  
**Branches reviewed**: 3 (out of 367 unmerged)

> **Selection rationale**: Focused on the 3 most recently active feature branches.
> `worktree-feat+sp7.1-dual-prisma-foundation` and `worktree-feat-shop-sales-ai-phase-a`
> were newly fetched today (previously unknown to this repo clone).
> `fix/ci-pre-existing-test-failures` (2026-06-08) was the most recent non-meta branch.
>
> **Note on history**: These branches have no git merge-base with `origin/main` (squash-merge
> workflow). Reviews are based on diff of branch tip vs main HEAD tree, and manual inspection
> of new/modified files.

---

## Branch 1: `worktree-feat+sp7.1-dual-prisma-foundation`

**Author**: Akenarin Kongdach  
**Last commit**: 2026-05-19 `ci: nudge PR sync (GitHub webhook stuck — memory pattern)`  
**Size**: 53 new TS/TSX files, ~1,000+ lines of new backend code

### What this branch adds (not yet in `main`)
- `quotes` module — full CRUD for ใบเสนอราคา (quotes.controller, quotes.service, 3 DTOs, PDF template)
- `drafts` module — federated read of DRAFT-status docs across Quote/Contract/Expense/OtherIncome
- `two-factor` module — TOTP-based 2FA enrollment/disable/backup-codes endpoints
- `bank-reconciliation.service.ts` — bank statement ↔ Payment row matching
- Frontend: `QuotesPage.tsx`, `DraftsPage.tsx`, `SetupTwoFactorPage.tsx`

### File changes summary
```
apps/api/src/modules/quotes/           +6 files  (controller, service, 3 DTOs, PDF template)
apps/api/src/modules/drafts/           +3 files  (controller, service, module)
apps/api/src/modules/two-factor/       +5 files  (controller, service, module, 2 DTOs)
apps/api/src/modules/accounting/       +2 files  (bank-reconciliation service + spec)
apps/web/src/pages/QuotesPage.tsx      new
apps/web/src/pages/DraftsPage.tsx      new
apps/web/src/pages/SetupTwoFactorPage.tsx  new
```

---

### Issues

#### 🔴 CRITICAL — Must fix before merge

**C1 — `TwoFactorController` missing `RolesGuard` and `@Roles()` on every method**
- File: `apps/api/src/modules/two-factor/two-factor.controller.ts:12`
- Problem: Controller declares `@UseGuards(JwtAuthGuard)` but **omits `RolesGuard`**. None of
  the four endpoints (`/enroll`, `/confirm`, `/disable`, `/backup-codes`) have a `@Roles()`
  decorator. Per `security.md`: "ทุก method ต้องมี `@Roles(...)` decorator ระบุ roles ที่เข้าถึงได้"
- Risk: Any authenticated user of any role can call all 2FA endpoints including `disable` and
  `backup-codes/regenerate`. A `SALES` user who has no 2FA should not be able to call
  `regenerateBackupCodes`. More critically, the absence of role guards is a pattern violation
  that disables defence-in-depth.
- Fix: Add `RolesGuard` to the class-level `@UseGuards()`. Add `@Roles(...)` to each method —
  at minimum all authenticated roles (`'OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES'`)
  since 2FA is a personal account feature, but the guard must still be present.

```ts
// Current (line 11–13):
@UseGuards(JwtAuthGuard)
@Controller('2fa')
export class TwoFactorController {

// Required:
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('2fa')
export class TwoFactorController {
  // ...
  @Post('enroll')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
```

---

#### 🟡 WARNING — Should fix

**W1 — `BankReconciliationService` uses `Number()` on `Prisma.Decimal` money field**
- File: `apps/api/src/modules/accounting/bank-reconciliation.service.ts:126,140`
- Problem: `Number(p.amountPaid)` coerces `Payment.amountPaid` (`Decimal(12,2)`) to a JS float
  before passing to `amountMatches()`. Amounts like `฿100,000.99` are representable in IEEE-754
  but loses the guarantee that `Prisma.Decimal` provides for exact arithmetic.
- Fix: Accept `Prisma.Decimal | number` in `amountMatches` and use Decimal comparison internally:
  ```ts
  private amountMatches(a: Prisma.Decimal | number, b: number): boolean {
    return new Prisma.Decimal(a).sub(new Prisma.Decimal(b)).abs()
      .lte(BankReconciliationService.AMOUNT_TOLERANCE_BAHT);
  }
  ```

**W2 — `SetupTwoFactorPage.tsx` uses `useEffect` + direct `api.post()` instead of `useMutation`**
- File: `apps/web/src/pages/SetupTwoFactorPage.tsx:33–45`
- Problem: The initial 2FA enrollment POST runs inside a bare `useEffect`, violating the
  frontend rule "ห้ามใช้ raw `useEffect` + `fetch` สำหรับ data fetching".
- Fix: Wrap in `useMutation` for the enrollment trigger. The confirm/backup steps at lines 59+
  already use async functions called from event handlers (acceptable for one-shot mutations,
  but should also use `useMutation` for consistent loading/error state).

---

#### 🔵 INFO

**I1 — `QuoteItem` model missing `updatedAt` and `deletedAt`**
- File: `apps/api/prisma/schema.prisma` (QuoteItem model)
- Problem: Deviates from the 3-timestamp convention without a `///` comment explaining why.
  The model uses `onDelete: Cascade` (acceptable per database.md) and a delete-and-recreate
  update pattern (deleteMany + create), so soft-delete would be unusual here.
- Fix: Add `/// Line items are replaced atomically (deleteMany + create) — updatedAt/deletedAt omitted intentionally; Cascade delete handles lifecycle.` comment to document the exception.

---

### Recommendation: **REVIEW** — fix C1 before merge

---

## Branch 2: `worktree-feat-shop-sales-ai-phase-a`

**Author**: Akenarin Kongdach  
**Last commit**: 2026-05-20 `fix(shop-ai): switch promptpay-qr to ESM default import (lint blocker)`  
**Size**: Superset of branch 1 + additional modules

### What this branch adds (beyond main + branch 1)
- `finance-tax` module — VAT/WHT monthly aggregation for ภ.พ.30 / ภ.ง.ด. filing
  (`finance-tax.controller.ts`, `finance-tax.service.ts`)
- `repair-tickets` module — 6-status repair lifecycle (already landed in main)
- `intercompany-report.service.ts` — SHOP↔FINANCE inter-company reconciliation report

### File changes summary (unique vs branch 1)
```
apps/api/src/modules/finance-tax/      +4 files  (controller, service, module, DTO, spec)
apps/api/src/modules/accounting/intercompany-report.service.ts  new
apps/api/src/modules/repair-tickets/   already in main (not re-reviewed)
```

---

### Issues

#### 🟡 WARNING — Should fix

**W1 — `FinanceTaxService` uses `Number()` on `Prisma.Decimal` journal line fields**
- File: `apps/api/src/modules/finance-tax/finance-tax.service.ts:113-114, 197-198, 283-284`
- Problem: `Number(l.debit ?? 0)` and `Number(l.credit ?? 0)` converts `JournalLine.debit`
  and `JournalLine.credit` (`Decimal(12,2)` in schema) to JS floats before numeric aggregation.
  For VAT/WHT reporting, precision errors compound across hundreds of lines — a 0.001 float
  drift per line becomes visible in ภ.พ.30 totals vs the actual ledger.
- Fix: Replace with `Prisma.Decimal` arithmetic throughout the aggregation loops:
  ```ts
  // Instead of:
  let vatOutput = 0;
  const debit = Number(l.debit ?? 0);
  vatOutput += credit - debit;

  // Use:
  let vatOutput = new Prisma.Decimal(0);
  const debit = new Prisma.Decimal(l.debit ?? 0);
  vatOutput = vatOutput.add(credit.sub(debit));
  ```

---

#### 🔵 INFO

**I1 — `FinanceTaxController` missing `BranchGuard`**
- File: `apps/api/src/modules/finance-tax/finance-tax.controller.ts:8`
- Problem: `@UseGuards(JwtAuthGuard, RolesGuard)` — no `BranchGuard`. This appears intentional
  (cross-company reporting endpoint keyed by `companyId`, not `branchId`) but is not documented.
- Fix: Add a comment: `// BranchGuard intentionally omitted — this is a company-scoped aggregate`

---

### Recommendation: **REVIEW** — fix W1 (Decimal precision in tax reports) before merge

---

## Branch 3: `fix/ci-pre-existing-test-failures`

**Author**: Akenarin Kongdach  
**Last commit**: 2026-06-08 `ci(e2e): exclude the incomplete approval-workflow harness (#1192)`

### Status: Content already in `main`

All significant changes from this branch are present in the `main` working tree:
- `late-fee.util.ts` — EXISTS in main
- `finance-receivable.dto.ts` `@Max(1)` fix — EXISTS in main
- `jest-e2e.json` `testPathIgnorePatterns` — EXISTS in main

The branch appears to be a leftover reference that was squash-merged incrementally into main.
No new code to review.

---

### Recommendation: **APPROVE** — no outstanding changes; branch can be deleted

---

## Summary Table

| Branch | Last Commit | Critical | Warning | Info | Recommendation |
|--------|------------|---------|---------|------|----------------|
| `worktree-feat+sp7.1-dual-prisma-foundation` | 2026-05-19 | 1 | 2 | 1 | **BLOCK** — fix C1 first |
| `worktree-feat-shop-sales-ai-phase-a` | 2026-05-20 | 0 | 1 | 1 | **REVIEW** |
| `fix/ci-pre-existing-test-failures` | 2026-06-08 | 0 | 0 | 0 | **APPROVE** |

## Action Items

1. **`TwoFactorController`** (`worktree-feat+sp7.1-dual-prisma-foundation`) — Add `RolesGuard` + `@Roles()` to all 4 endpoints. **Blocks merge.**
2. **`BankReconciliationService`** — Replace `Number(p.amountPaid)` with `Prisma.Decimal` comparison.
3. **`FinanceTaxService`** (`worktree-feat-shop-sales-ai-phase-a`) — Replace `Number(l.debit/credit)` with `Prisma.Decimal` accumulation. Tax report precision is production-critical.
4. **`SetupTwoFactorPage.tsx`** — Convert `useEffect`+`api.post` enrollment to `useMutation`.
5. **`fix/ci-pre-existing-test-failures`** — Safe to delete; all content is in `main`.
