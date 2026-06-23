# SHOP-side JE Wiring — P4 (ShopExpense, REPAIR_SERVICE scope) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a `REPAIR_SERVICE` (payer=SHOP) expense document is posted, book it on the **SHOP chart** via `ShopExpenseTemplate` (`Dr S51-xxxx / Cr S21-1103`) instead of the current FINANCE-coded accrual (`Cr 21-1104`).

**Architecture:** In `ExpenseDocumentLifecycleService.executePostBody()`, add a `documentType === 'REPAIR_SERVICE'` branch (before the generic accrual/same-day fall-through) that builds a `ShopExpenseInput` from the doc's single S-coded line + posts `ShopExpenseTemplate` inside the existing post `$transaction`, then updates the doc `status` + `journalEntryId` (mirroring the accrual template's side effect).

**Tech Stack:** NestJS, Prisma (PostgreSQL), TypeScript, jest (`--runInBand`).

**Spec:** `docs/superpowers/specs/2026-06-23-shop-je-wiring-design.md` (§6 ShopExpense + §5B).

**Scope (owner decision 2026-06-23): REPAIR_SERVICE only.** This is the one unambiguously-SHOP expense-doc type (auto-created by the repair-ticket flow with `payer=SHOP`, single line `S51-1105`). General `EXPENSE` docs and the broader "what company are expense docs" question (the module currently posts ALL expense docs under SHOP company with a hardcoded FINANCE `21-1104` Cr) are **out of scope** — left for a future expense-company remodel.

**Depends on P0+P1** (X5; `JournalModule` already exports `ShopExpenseTemplate`) — #1280. **Branch P4 off `feat/shop-trade-in`** (carries P1–P3); rebase onto `main` after #1280/#1281/#1282 merge. **Do not merge before #1280.**

## The bug this fixes (verified)
`executePostBody()` routes `REPAIR_SERVICE` docs (no `paymentMethod`) through `resolveTargetStatus` → `ACCRUAL` → `ExpenseAccrualTemplate.execute(id, tx)`. That template posts under the SHOP company (`getShopCompanyId`) but **hardcodes the Cr leg to `21-1104`** (FINANCE AP) (`expense-accrual.template.ts:~106`) — contaminating the SHOP chart with a FINANCE account. `ShopExpenseTemplate` (Cr → `S21-1103`) exists but has **zero callers**. P4 routes REPAIR_SERVICE to it.

## Global Constraints
- **Atomic:** `ShopExpenseTemplate.execute(input, tx)` uses the post `$transaction` tx (the same `tx` `executePostBody` receives); a JE failure rolls back the post.
- **REPAIR_SERVICE only:** branch on `doc.documentType === 'REPAIR_SERVICE'`; do NOT change the EXPENSE / CREDIT_NOTE / PAYROLL / VENDOR_SETTLEMENT / PETTY_CASH paths.
- **Mode:** `CASH` iff `doc.paymentMethod && doc.depositAccountCode` (mirror the existing `resolveTargetStatus` logic); else `ACCRUAL`. ACCRUAL → Cr `S21-1103` (template default). CASH → Cr `cashAccountCode = doc.depositAccountCode ?? branch.shopCashAccountCode` (must be an `S`-code; the template enforces S-prefix).
- **Single line:** REPAIR_SERVICE docs are created with exactly one line (`expense-document-create.service.ts` `createDraftForRepair`); throw a clear error if a REPAIR doc has ≠1 line (don't silently mis-post). `expenseAccountCode = line.category` (e.g. `S51-1105`); `amount = line.amountBeforeVat`.
- **Doc-level idempotency:** if `doc.journalEntryId` is already set, return the existing JE (mirror the accrual template) — and the template self-dedupes on `metadata.flow='shop-expense'` + `shop-expense:<docId>`.
- **Side effect:** after posting, `tx.expenseDocument.update({ status: <CASH?'POSTED':'ACCRUAL'>, journalEntryId })` — same as the accrual template does.
- **Money:** `Decimal` only (`new Decimal(x.toString())`); never `Number()`. No VAT/WHT on REPAIR (single-line, whtPercent=0).
- **Test runner:** `npm --prefix apps/api test -- <spec>` (repo root; `--runInBand`). **DI fan-out:** adding a required ctor dep to `ExpenseDocumentLifecycleService` breaks every TestingModule that constructs it — grep `rg -l "ExpenseDocumentLifecycleService" apps/api/src -g'*.spec.ts'` and update ALL; run the whole `src/modules/expense-documents` suite.

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `apps/api/src/modules/expense-documents/services/expense-document-lifecycle.service.ts` (modify ctor ~:53 + `executePostBody` ~:460) | inject `ShopExpenseTemplate`; route REPAIR_SERVICE → ShopExpense | 1 |
| the lifecycle service's spec + any other spec constructing it | DI mock + REPAIR-routing tests | 1 |

---

## Task 1: Route REPAIR_SERVICE expense docs to ShopExpense

**Files:**
- Modify: `apps/api/src/modules/expense-documents/services/expense-document-lifecycle.service.ts` (ctor + `executePostBody`)
- Test: the lifecycle service spec (locate via `rg -l "ExpenseDocumentLifecycleService" apps/api/src -g'*.spec.ts'`) + update every TestingModule that constructs it

**Interfaces:**
- Consumes: `ShopExpenseTemplate.execute(input: { idempotencyKey, expenseId, expenseNumber?, expenseAccountCode, amount: Decimal, mode: 'CASH'|'ACCRUAL', cashAccountCode?, payableAccountCode?, branchName?, postedAt? }, outerTx?): Promise<{ entryNo: string; journalEntryId: string }>` (exported by `JournalModule`, already imported by this module for the other templates).

- [ ] **Step 1: Write the failing tests.** In the lifecycle spec, add tests exercising `post()` (or `executePostBody`) for a REPAIR_SERVICE doc. Provide `ShopExpenseTemplate` as a mock `{ execute: jest.fn().mockResolvedValue({ entryNo: 'JE-1', journalEntryId: 'je-1' }) }`. Mock the tx so `tx.expenseDocument.findUniqueOrThrow` returns a REPAIR doc with one S-coded line. Assert:

```typescript
it('routes a REPAIR_SERVICE doc to ShopExpense (ACCRUAL → Cr S21-1103), not the FINANCE accrual', async () => {
  // doc: documentType 'REPAIR_SERVICE', status DRAFT, no paymentMethod/depositAccountCode,
  // journalEntryId null, expenseDetail.lines = [{ lineNo:1, category:'S51-1105', amountBeforeVat: Decimal(800) }],
  // branch { name:'สาขากลาง', shopCashAccountCode:'S11-1101' }
  await service.post('doc-1');   // or executePostBody(doc, tx) per the spec's harness
  expect(shopExpenseTemplate.execute).toHaveBeenCalledTimes(1);
  const input = shopExpenseTemplate.execute.mock.calls[0][0];
  expect(input).toMatchObject({ idempotencyKey: 'shop-expense:doc-1', expenseId: 'doc-1', expenseAccountCode: 'S51-1105', mode: 'ACCRUAL' });
  expect(input.amount.toString()).toBe('800');
  expect(input.cashAccountCode).toBeUndefined();        // ACCRUAL → no cash; payable defaults S21-1103
  expect(accrualTemplate.execute).not.toHaveBeenCalled(); // the FINANCE-Cr accrual is bypassed
  expect(tx.expenseDocument.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'ACCRUAL', journalEntryId: 'je-1' }) }));
});

it('still routes a non-REPAIR EXPENSE doc to the accrual template (unchanged)', async () => {
  // doc: documentType 'EXPENSE', no paymentMethod → ACCRUAL path
  await service.post('doc-2');
  expect(accrualTemplate.execute).toHaveBeenCalledWith('doc-2', expect.anything());
  expect(shopExpenseTemplate.execute).not.toHaveBeenCalled();
});
```

> Adapt to the spec's actual harness — it constructs `ExpenseDocumentLifecycleService` with all its injected templates (sameDay/accrual/creditNote/payroll/settlement/pettyCash) as mocks + `StatusTransitionService` + `PrismaService`. Add `ShopExpenseTemplate` to that provider set. Mock `prisma.$transaction`, the advisory lock, `validatePeriodOpen` (or the SHOP companyInfo lookup), and the attachment-threshold check so `post()` reaches the dispatch. If the existing harness tests `executePostBody` directly, mirror that.

- [ ] **Step 2: Run — expect FAIL.**

Run: `npm --prefix apps/api test -- <lifecycle-spec-path>`
Expected: FAIL.

- [ ] **Step 3: Implement.** Add the import + ctor dep:

```typescript
import { ShopExpenseTemplate } from '../../journal/cpa-templates/shop-expense.template';
import { Decimal } from '@prisma/client/runtime/library';
// constructor: add (required, no @Optional):
//   private readonly shopExpenseTemplate: ShopExpenseTemplate,
```

In `executePostBody`, add a branch **before** the `resolveTargetStatus` fall-through — alongside the other `documentType` branches (after the `PETTY_CASH_REIMBURSEMENT` branch, before `const target = this.transition.resolveTargetStatus(...)`):

```typescript
    if (doc.documentType === 'REPAIR_SERVICE') {
      // SHOP repair expense → post on the SHOP chart (Cr S21-1103 accrual / S-cash same-day),
      // NOT the generic accrual template which hardcodes the FINANCE Cr 21-1104.
      if (doc.journalEntryId) {
        const existing = await tx.journalEntry.findUnique({
          where: { id: doc.journalEntryId },
          select: { entryNumber: true },
        });
        return { entryNo: existing?.entryNumber ?? doc.journalEntryId, journalEntryId: doc.journalEntryId };
      }
      const full = await tx.expenseDocument.findUniqueOrThrow({
        where: { id },
        include: {
          expenseDetail: { include: { lines: { orderBy: { lineNo: 'asc' } } } },
          branch: { select: { name: true, shopCashAccountCode: true } },
        },
      });
      const lines = full.expenseDetail?.lines ?? [];
      if (lines.length !== 1) {
        throw new BadRequestException(
          `REPAIR_SERVICE expense doc ${id} must have exactly one line (got ${lines.length})`,
        );
      }
      const line = lines[0];
      const isCash = !!doc.paymentMethod && !!doc.depositAccountCode;
      const result = await this.shopExpenseTemplate.execute(
        {
          idempotencyKey: `shop-expense:${id}`,
          expenseId: id,
          expenseAccountCode: line.category,
          amount: new Decimal(line.amountBeforeVat.toString()),
          mode: isCash ? 'CASH' : 'ACCRUAL',
          cashAccountCode: isCash
            ? (doc.depositAccountCode ?? full.branch?.shopCashAccountCode ?? undefined)
            : undefined,
          branchName: full.branch?.name,
        },
        tx,
      );
      await tx.expenseDocument.update({
        where: { id },
        data: { status: isCash ? 'POSTED' : 'ACCRUAL', journalEntryId: result.journalEntryId },
      });
      return result;
    }
```

> `BadRequestException` is already imported in this file. Don't pass `expenseNumber` unless you confirm the exact field name on `ExpenseDocument` (it's optional on the input). Keep all other dispatch branches untouched.

- [ ] **Step 4: Wire DI.** The expense-documents module already imports `JournalModule` (it injects `ExpenseAccrualTemplate` etc., which `JournalModule` exports) — `ShopExpenseTemplate` is exported there too, so no module change is needed; confirm by grepping the module. Then `rg -l "ExpenseDocumentLifecycleService" apps/api/src -g'*.spec.ts'` and add `{ provide: ShopExpenseTemplate, useValue: { execute: jest.fn().mockResolvedValue({ entryNo:'JE-1', journalEntryId:'je-1' }) } }` to every TestingModule that constructs it.

- [ ] **Step 5: Run — expect PASS** (whole expense-documents suite) + typecheck.

Run: `npm --prefix apps/api test -- src/modules/expense-documents && (cd apps/api && npx tsc --noEmit -p tsconfig.json)`
Expected: all expense-documents suites PASS; tsc exit 0.

- [ ] **Step 6: Commit.**

```bash
git add apps/api/src/modules/expense-documents/services/expense-document-lifecycle.service.ts <touched spec files>
git commit -m "feat(expense-documents): route REPAIR_SERVICE posts to ShopExpense (Cr S21-1103, not FINANCE 21-1104)"
```

---

## Acceptance
- `apps/api` tsc 0; full `src/modules/expense-documents` suite green.
- A posted REPAIR_SERVICE doc (no payment) books `Dr S51-1105 / Cr S21-1103` under SHOP company (no `21-1104`); its `status` → ACCRUAL + `journalEntryId` set. A non-REPAIR EXPENSE doc still routes to the existing accrual template (unchanged). Re-posting a REPAIR doc with `journalEntryId` set returns the existing JE (no double-post).

## Out of scope / deferred
- **General `EXPENSE` docs + the expense-company model.** The module posts ALL expense docs under SHOP company with a hardcoded FINANCE `21-1104` Cr (and `11-4101` VAT in same-day) — a broader tangle (FINANCE central expenses would also mis-post). Untangling SHOP-vs-FINANCE for general expense docs is an owner/accountant remodel, not this task.
- **REPAIR_SERVICE settlement (payment) leg.** When a REPAIR accrual is later paid (VENDOR_SETTLEMENT), the SHOP-side `Dr S21-1103 / Cr S-cash` is not wired here (the settlement template is FINANCE-coded) — follow-up.
- **CASH-mode REPAIR with a non-S `depositAccountCode`** would make the template throw (S-prefix enforced); auto-created REPAIR docs are ACCRUAL (no deposit), so this is an edge — note for the settlement remodel.
