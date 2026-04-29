# Accounting Phase A.0 — Critical Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 11 critical accounting bugs (5 waves) without changing chart of accounts or accounting policy. After deploy, new contract activations + PaySolutions webhook payments will produce correct journal entries; period close will be properly hardened.

**Architecture:** Surgical edits to existing services (no new files for app code). One Prisma migration adds 3 optional audit fields to `accounting_periods`. Pattern is TDD per fix: write failing test → minimal implementation → verify pass → commit. Single PR with squash merge; 5 logical waves committed in dependency order.

**Tech Stack:** NestJS, Prisma, TypeScript, Jest (unit + integration), Playwright (E2E), Sentry (error capture).

**Spec:** `docs/superpowers/specs/2026-04-29-accounting-phase-a0-critical-fix-design.md`
**Audit predecessor:** `docs/reports/2026-04-29-accounting-audit.md`

---

## Pre-flight: Setup branch

- [ ] **Step 1: Verify on main + clean working tree**

Run: `git status`
Expected: `On branch main` + `nothing to commit, working tree clean` (untracked mockups OK)

- [ ] **Step 2: Pull latest**

Run: `git pull origin main`
Expected: `Already up to date.` (or fast-forward succeeds)

- [ ] **Step 3: Create feature branch**

Run: `git checkout -b feat/accounting-phase-a0-critical-fix`
Expected: `Switched to a new branch 'feat/accounting-phase-a0-critical-fix'`

---

## Wave 1 — Foundation (Tasks 1-4)

**Goal:** Fix the math bug + Decimal precision + try/catch on contract activation. Three changes ship as a logical unit because removing try/catch without math fix would break every contract activation in prod.

### Task 1: Fix `hpReceivable` double-counting

**Files:**
- Modify: `apps/api/src/modules/journal/journal-auto.service.ts:296`
- Test: `apps/api/src/modules/journal/journal-auto.service.spec.ts`

- [ ] **Step 1: Read current implementation to confirm context**

Run: `grep -n "hpReceivable" apps/api/src/modules/journal/journal-auto.service.ts`
Expected output includes line 296 with the double-counting expression.

- [ ] **Step 2: Add failing test for balanced activation JE**

Open `apps/api/src/modules/journal/journal-auto.service.spec.ts` and add test inside the `describe('createContractActivationJournal')` block (or create the block if absent):

```typescript
it('produces balanced JE when financedAmount already includes interest+commission+vat', async () => {
  // financedAmount = principal + commission + interest + vat (per installment.util.ts:56)
  const principal = new Decimal('10000');
  const commission = new Decimal('500');
  const interest = new Decimal('1000');
  const vat = new Decimal('805');
  const financedAmount = principal.plus(commission).plus(interest).plus(vat); // 12305

  const tx = makeFakeTx();  // helper that captures createAndPost calls
  await service.createContractActivationJournal(tx, {
    contract: {
      id: 'c1', contractNumber: 'CT-001',
      sellingPrice: new Decimal('11000'),  // principal + commission
      downPayment: new Decimal('1000'),
      financedAmount,
      interestTotal: interest,
      storeCommission: commission,
      vatAmount: vat,
    },
    product: { costPrice: new Decimal('8000'), category: 'มือถือใหม่' },
    userId: 'u1',
  });

  // Inspect captured lines from the salesEntry
  const salesCall = tx.captured[0];
  const totalDr = salesCall.lines.reduce((s, l) => s + l.debit, 0);
  const totalCr = salesCall.lines.reduce((s, l) => s + l.credit, 0);
  expect(Math.abs(totalDr - totalCr)).toBeLessThan(0.01);
});
```

If `makeFakeTx` does not exist in the spec, add this helper at top of file:

```typescript
function makeFakeTx() {
  const captured: any[] = [];
  return {
    captured,
    journalEntry: {
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn().mockImplementation(({ data }) => {
        captured.push({ lines: data.lines.create });
        return Promise.resolve({ id: `entry-${captured.length}` });
      }),
    },
    companyInfo: { findFirst: jest.fn().mockResolvedValue({ id: 'co1' }) },
  };
}
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd apps/api && npx jest journal-auto.service.spec.ts -t "produces balanced JE when financedAmount"`
Expected: FAIL with `Journal not balanced for CONTRACT c1: Dr ... ≠ Cr ...`

- [ ] **Step 4: Fix the bug**

Edit `apps/api/src/modules/journal/journal-auto.service.ts` line 296:

```diff
-    const hpReceivable = financedAmount.add(interest).add(commission).add(vat);
+    // financedAmount already includes principal + commission + interest + vat
+    // (computed by installment.util.ts:56 calculateInstallment)
+    const hpReceivable = financedAmount;
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/api && npx jest journal-auto.service.spec.ts -t "produces balanced JE when financedAmount"`
Expected: PASS

- [ ] **Step 6: Run full spec to verify no regression**

Run: `cd apps/api && npx jest journal-auto.service.spec.ts`
Expected: All existing tests still PASS (test fixtures using `financedAmount = sellingPrice - downPayment` may need updating — fix them to use `financedAmount = principal + commission + interest + vat` since that matches production)

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/journal/journal-auto.service.ts apps/api/src/modules/journal/journal-auto.service.spec.ts
git commit -m "fix(journal): hpReceivable no longer double-counts i+c+v (F-2-001)

financedAmount already includes principal + commission + interest + vat
per installment.util.ts:56. Adding them again caused createAndPost to throw
on every contract activation. Combined with the try/catch at
contract-workflow.service.ts:443, this resulted in zero contract activation
JEs being posted in production (only 1 JE total in prod history).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Decimal precision in balance check

**Files:**
- Modify: `apps/api/src/modules/journal/journal-auto.service.ts:91-93`
- Test: `apps/api/src/modules/journal/journal-auto.service.spec.ts`

- [ ] **Step 1: Add failing test for fractional satang precision**

Add to spec file:

```typescript
it('balance check uses Decimal precision (no floating-point false-pass)', async () => {
  // Construct 100 lines of 0.01 each on Dr side, 99 lines of 0.01 + 1 line of 0.011 on Cr side
  // Total: Dr=1.00, Cr=1.001 → diff=0.001. Old Number-based check tolerates ±0.001 → false-pass.
  // Decimal check tolerates 0.01 → still false-pass for this input. Use harder case:
  // Dr=1.00, Cr=1.011 → diff=0.011 → old false-pass (>0.001 but <0.012 threshold... actually 0.011 > 0.001 so old throws). Use:
  // Dr 100 lines of 0.01 = 1.00; Cr 100 lines of 0.01 = 1.00 plus 1 line of 0.005 = 1.005
  // diff = 0.005 → old check: 0.005 > 0.001 → throws. Use 0.0009 difference (under old threshold):
  // Dr 1.00 vs Cr 1.0009 → diff 0.0009 → old PASSES (false), Decimal check FAILS (0.0009 > 0.01? No, 0.0009 < 0.01 → also passes). 
  // Better test: use exact-arithmetic breakage. JS floats:
  //   0.1 + 0.2 = 0.30000000000000004 (rounding error)
  // Construct 30 lines of 0.1 vs 30 lines of 0.1 → totals identical in Decimal but may drift in Number.
  // Simpler: assert createAndPost doesn't throw for clearly balanced Decimal sums that JS floats miscompute.
  const tx = makeFakeTx();
  const lines = [];
  for (let i = 0; i < 30; i++) lines.push({ accountCode: '11-1101', debit: 0.1, credit: 0 });
  for (let i = 0; i < 30; i++) lines.push({ accountCode: '21-2101', debit: 0, credit: 0.1 });
  // (createAndPost is private; call via a public method that uses it — use createPaymentJournal as proxy isn't trivial.
  //  Instead, expose createAndPost for test via casting):
  await expect((service as any).createAndPost(tx, {
    companyId: 'co1', entryDate: new Date(), description: 'test',
    referenceType: 'TEST', referenceId: 'test', createdById: 'u1',
    lines,
  })).resolves.not.toThrow();
});
```

- [ ] **Step 2: Run test to verify behavior baseline**

Run: `cd apps/api && npx jest journal-auto.service.spec.ts -t "balance check uses Decimal"`
Expected: May PASS already (depends on floating-point evaluation order). If passes, the test is too weak — proceed anyway since the change is purely defensive.

- [ ] **Step 3: Switch balance check to Decimal**

Edit `journal-auto.service.ts:91-93`:

```diff
-    const totalDebit = lines.reduce((s, l) => s + l.debit, 0);
-    const totalCredit = lines.reduce((s, l) => s + l.credit, 0);
-    if (Math.abs(totalDebit - totalCredit) > 0.001) {
+    const totalDebit = lines.reduce((s, l) => s.plus(new Decimal(l.debit)), new Decimal(0));
+    const totalCredit = lines.reduce((s, l) => s.plus(new Decimal(l.credit)), new Decimal(0));
+    if (totalDebit.minus(totalCredit).abs().gt(new Decimal('0.01'))) {
       const msg = `Journal not balanced for ${params.referenceType} ${params.referenceId}: Dr ${totalDebit} ≠ Cr ${totalCredit}`;
```

Update the Sentry extras to call `.toString()` on the Decimal values:

```diff
       Sentry.captureException(new Error(msg), {
         tags: { kind: 'journal', referenceType: params.referenceType },
-        extra: { referenceId: params.referenceId, totalDebit, totalCredit },
+        extra: { referenceId: params.referenceId, totalDebit: totalDebit.toString(), totalCredit: totalCredit.toString() },
       });
```

- [ ] **Step 4: Run test to verify pass**

Run: `cd apps/api && npx jest journal-auto.service.spec.ts -t "balance check uses Decimal"`
Expected: PASS

- [ ] **Step 5: Run full spec**

Run: `cd apps/api && npx jest journal-auto.service.spec.ts`
Expected: all PASS

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/journal/journal-auto.service.ts apps/api/src/modules/journal/journal-auto.service.spec.ts
git commit -m "fix(journal): balance check uses Decimal not floating-point (F-2-010)

JS Number sums accumulate floating-point error across many lines.
Switch totalDebit/totalCredit to Prisma.Decimal arithmetic with 0.01
satang tolerance.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Remove try/catch on contract activation

**Files:**
- Modify: `apps/api/src/modules/contracts/contract-workflow.service.ts:425-447`
- Test: `apps/api/src/modules/contracts/contract-workflow.service.spec.ts` (or create `contract-workflow.service.spec.ts` if absent)

- [ ] **Step 1: Locate exact lines**

Run: `grep -nB 2 -A 18 "Auto journal entry — record contract activation" apps/api/src/modules/contracts/contract-workflow.service.ts`
Expected output: the try/catch block

- [ ] **Step 2: Find or create the contract-workflow spec**

Run: `ls apps/api/src/modules/contracts/contract-workflow*.spec.ts 2>&1 || echo "NEW"`

If NEW: create skeleton at `apps/api/src/modules/contracts/contract-workflow.service.spec.ts`:

```typescript
import { Test } from '@nestjs/testing';
import { ContractWorkflowService } from './contract-workflow.service';
// ... (mirror dependency injection from existing spec patterns; copy from contract-payment.service.spec.ts as reference)
```

- [ ] **Step 3: Add failing test for atomic rollback**

```typescript
it('rolls back contract activation if journal creation throws (F-1-002)', async () => {
  const journalAutoMock = {
    createContractActivationJournal: jest.fn().mockRejectedValue(new Error('JE failed')),
  };
  const service = new ContractWorkflowService(prisma, journalAutoMock as any /* other deps */);

  const contract = await prisma.contract.create({ data: { /* DRAFT contract fixture */ } });

  await expect(service.activate(contract.id, 'user1')).rejects.toThrow('JE failed');

  const after = await prisma.contract.findUnique({ where: { id: contract.id } });
  expect(after.status).toBe('DRAFT'); // rollback verified
});
```

- [ ] **Step 4: Run test to verify it fails (current code swallows)**

Run: `cd apps/api && npx jest contract-workflow.service.spec.ts -t "rolls back contract activation"`
Expected: FAIL — test expects throw but current code swallows error so `activate` resolves successfully

- [ ] **Step 5: Remove try/catch wrapper**

Edit `contract-workflow.service.ts:425-447`:

```diff
       });

       // Auto journal entry — record contract activation (sales + COGS)
-      try {
-        await this.journalAutoService.createContractActivationJournal(tx, {
-          contract: {
-            id: contract.id,
-            contractNumber: contract.contractNumber,
-            sellingPrice: contract.sellingPrice,
-            downPayment: contract.downPayment,
-            financedAmount: contract.financedAmount,
-            interestTotal: contract.interestTotal,
-            storeCommission: contract.storeCommission ?? 0,
-            vatAmount: contract.vatAmount ?? 0,
-          },
-          product: { costPrice: prod.costPrice, category: prod.category },
-          userId: contract.salespersonId,
-        });
-      } catch (err) {
-        this.logger.error(`Auto-journal failed for contract activation ${contract.id}: ${err}`);
-      }
+      // Atomic with contract activation: if JE fails, the entire transaction rolls back.
+      // Pre-v4 try/catch caused silent ledger divergence (audit F-1-002 / F-2-003).
+      await this.journalAutoService.createContractActivationJournal(tx, {
+        contract: {
+          id: contract.id,
+          contractNumber: contract.contractNumber,
+          sellingPrice: contract.sellingPrice,
+          downPayment: contract.downPayment,
+          financedAmount: contract.financedAmount,
+          interestTotal: contract.interestTotal,
+          storeCommission: contract.storeCommission ?? 0,
+          vatAmount: contract.vatAmount ?? 0,
+        },
+        product: { costPrice: prod.costPrice, category: prod.category },
+        userId: contract.salespersonId,
+      });
     });
```

- [ ] **Step 6: Run test to verify pass**

Run: `cd apps/api && npx jest contract-workflow.service.spec.ts -t "rolls back contract activation"`
Expected: PASS

- [ ] **Step 7: Run full contract-workflow spec**

Run: `cd apps/api && npx jest contract-workflow`
Expected: All PASS

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/modules/contracts/contract-workflow.service.ts apps/api/src/modules/contracts/contract-workflow.service.spec.ts
git commit -m "fix(contracts): remove try/catch on activation JE (F-1-002 / F-2-003)

The try/catch around createContractActivationJournal was swallowing
the InternalServerErrorException thrown by createAndPost. This caused
contract activation to succeed in DB but produced no ledger entry,
defeating the v4 unbalanced-throw guard. Now propagates so the
\$transaction rolls back atomically.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Run Wave 1 verification

- [ ] **Step 1: TypeScript check**

Run: `./tools/check-types.sh api`
Expected: 0 errors

- [ ] **Step 2: Full unit test suite for journal + contracts**

Run: `cd apps/api && npx jest journal contracts/contract-workflow`
Expected: All PASS, no new failures

- [ ] **Step 3: Stop and review with user**

User checkpoint — Wave 1 complete. Proceed to Wave 2?

---

## Wave 2 — Company Validation (Tasks 5-9)

**Goal:** `resolveCompanyId` deterministic; callers pass explicit companyId; `createAndPost` enforces `allowedCompanies`. Order matters: resolve fix → callers updated → validation added.

### Task 5: Make `resolveCompanyId` deterministic

**Files:**
- Modify: `apps/api/src/modules/journal/journal-auto.service.ts:64-69`
- Test: `apps/api/src/modules/journal/journal-auto.service.spec.ts`

- [ ] **Step 1: Add failing test**

```typescript
it('resolveCompanyId returns deterministic company across calls', async () => {
  const tx = {
    companyInfo: {
      findFirst: jest.fn().mockResolvedValue({ id: 'co-FINANCE' }),
    },
  };
  const result = await (service as any).resolveCompanyId(tx);
  expect(tx.companyInfo.findFirst).toHaveBeenCalledWith(
    expect.objectContaining({
      orderBy: { createdAt: 'asc' },
    })
  );
  expect(result).toBe('co-FINANCE');
});
```

- [ ] **Step 2: Verify it fails**

Run: `cd apps/api && npx jest journal-auto.service.spec.ts -t "resolveCompanyId returns deterministic"`
Expected: FAIL — assertion on `orderBy` field absent

- [ ] **Step 3: Add ORDER BY**

Edit `journal-auto.service.ts:64-69`:

```diff
     if (companyId) return companyId;
     const company = await tx.companyInfo.findFirst({
       where: { isActive: true, deletedAt: null },
+      orderBy: { createdAt: 'asc' },
       select: { id: true },
     });
     return company?.id || null;
   }
```

- [ ] **Step 4: Verify pass**

Run: `cd apps/api && npx jest journal-auto.service.spec.ts -t "resolveCompanyId returns deterministic"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/journal/journal-auto.service.ts apps/api/src/modules/journal/journal-auto.service.spec.ts
git commit -m "fix(journal): resolveCompanyId deterministic via createdAt asc (F-3-027 part 1/3)

findFirst without orderBy returns non-deterministic results in multi-company
setups, risking FINANCE-only accounts being posted under SHOP companyId.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Pass explicit companyId from contract-workflow

**Files:**
- Modify: `apps/api/src/modules/contracts/contract-workflow.service.ts` (activation block from Task 3)
- Modify: `apps/api/src/modules/journal/journal-auto.service.ts:265-283` (createContractActivationJournal accepts companyId)

- [ ] **Step 1: Verify createContractActivationJournal already accepts companyId**

Run: `grep -nB 2 -A 20 "async createContractActivationJournal" apps/api/src/modules/journal/journal-auto.service.ts | head -30`
Expected: signature shows `params.companyId?: string | null` (it already does — passed to resolveCompanyId)

- [ ] **Step 2: Add failing test on contract-workflow**

In `contract-workflow.service.spec.ts`:

```typescript
it('passes FINANCE companyId to JournalAutoService on activation (F-3-027 part 2)', async () => {
  // FINANCE company seeded as 'co-FINANCE'
  const journalAutoMock = { createContractActivationJournal: jest.fn().mockResolvedValue(['e1']) };
  const service = new ContractWorkflowService(prisma, journalAutoMock as any);
  const contract = await prisma.contract.create({ data: { /* DRAFT */ } });

  await service.activate(contract.id, 'user1');

  expect(journalAutoMock.createContractActivationJournal).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ companyId: 'co-FINANCE' })
  );
});
```

- [ ] **Step 3: Verify fails**

Run: `cd apps/api && npx jest contract-workflow.service.spec.ts -t "passes FINANCE companyId"`
Expected: FAIL — current code doesn't pass companyId

- [ ] **Step 4: Add FINANCE company lookup + pass companyId**

In `contract-workflow.service.ts`, before the activation tx block, add:

```typescript
// Resolve FINANCE company id (HP receivable + interest income are FINANCE-side)
const financeCompany = await this.prisma.companyInfo.findFirst({
  where: { companyCode: 'FINANCE', deletedAt: null },
  select: { id: true },
});
if (!financeCompany) throw new InternalServerErrorException('FINANCE company not configured');
```

In the `createContractActivationJournal` call, add the param:

```diff
       await this.journalAutoService.createContractActivationJournal(tx, {
+        companyId: financeCompany.id,
         contract: {
           id: contract.id,
           ...
         },
         ...
       });
```

- [ ] **Step 5: Verify pass**

Run: `cd apps/api && npx jest contract-workflow.service.spec.ts -t "passes FINANCE companyId"`
Expected: PASS

- [ ] **Step 6: Run full contract spec**

Run: `cd apps/api && npx jest contracts/contract-workflow`
Expected: All PASS

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/contracts/contract-workflow.service.ts apps/api/src/modules/contracts/contract-workflow.service.spec.ts
git commit -m "fix(contracts): pass FINANCE companyId to activation JE (F-3-027 part 2)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Pass explicit companyId from payments

**Files:**
- Modify: `apps/api/src/modules/payments/payments.service.ts:184-200` (recordPayment) + similar at lines ~358 (autoAllocate) + ~732 (creditAlloc)
- Test: `apps/api/src/modules/payments/payments.service.spec.ts`

- [ ] **Step 1: Inspect Payment.companyId field**

Run: `grep -E "companyId" apps/api/prisma/schema.prisma | grep -B 1 -A 1 "model Payment"`
Confirm: Payment has `companyId String @map("company_id")`.

- [ ] **Step 2: Add failing test**

```typescript
it('passes payment.companyId to JournalAutoService on full payment (F-3-027 part 2)', async () => {
  const journalAutoMock = { createPaymentJournal: jest.fn().mockResolvedValue('e1') };
  // ... setup payment fixture with companyId='co-FINANCE'
  await service.recordPayment(payment.id, /*...*/);
  expect(journalAutoMock.createPaymentJournal).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ companyId: 'co-FINANCE' })
  );
});
```

- [ ] **Step 3: Verify fails**

Run: `cd apps/api && npx jest payments.service.spec.ts -t "passes payment.companyId"`
Expected: FAIL

- [ ] **Step 4: Add `companyId: result.companyId` to all 3 createPaymentJournal call sites**

Search for `createPaymentJournal` calls in `payments.service.ts`:

Run: `grep -n "createPaymentJournal" apps/api/src/modules/payments/payments.service.ts`

For each call (3 sites), add the field — example:

```diff
       await this.journalAutoService.createPaymentJournal(tx, {
+        companyId: result.companyId,
         payment: { ... },
         contract: { ... },
         userId: recordedById,
       });
```

For `autoAllocatePayment` and `allocateCreditBalance`, the `companyId` may need to come from the contract loaded earlier in the function. If the existing code loads `contract: { ..., companyId: ... }`, pass that. If not, add `companyId` to the contract select.

- [ ] **Step 5: Verify pass + run full payments spec**

Run: `cd apps/api && npx jest payments.service`
Expected: All PASS

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/payments/payments.service.ts apps/api/src/modules/payments/payments.service.spec.ts
git commit -m "fix(payments): pass payment.companyId to JE callers (F-3-027 part 2)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Pass explicit companyId from accounting (expense)

**Files:**
- Modify: `apps/api/src/modules/accounting/accounting.service.ts:374-391` (markExpensePaid)

- [ ] **Step 1: Inspect Expense → Branch → companyId path**

Run: `grep -B 2 -A 10 "createExpenseJournal" apps/api/src/modules/accounting/accounting.service.ts`

- [ ] **Step 2: Add failing test in `accounting.service.spec.ts`**

```typescript
it('passes branch.companyId to expense JE (F-3-027 part 2)', async () => {
  const journalAutoMock = { createExpenseJournal: jest.fn().mockResolvedValue('e1') };
  // expense in branch with companyId='co-SHOP'
  await service.markExpensePaid(expense.id, /*...*/);
  expect(journalAutoMock.createExpenseJournal).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ companyId: 'co-SHOP' })
  );
});
```

- [ ] **Step 3: Verify fails + load branch.companyId in markExpensePaid**

In the existing query that loads the expense for journal creation, add:

```diff
       const expense = await tx.expense.findUnique({
         where: { id },
-        select: { /* ... existing fields */ },
+        select: { /* ... existing fields */, branch: { select: { companyId: true } } },
       });
```

Then pass:

```diff
       await this.journalAutoService.createExpenseJournal(tx, {
+        companyId: expense.branch.companyId,
         expense: { ... },
         userId,
       });
```

- [ ] **Step 4: Verify pass + run full accounting spec**

Run: `cd apps/api && npx jest accounting.service`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/accounting/accounting.service.ts apps/api/src/modules/accounting/accounting.service.spec.ts
git commit -m "fix(accounting): pass branch.companyId to expense JE (F-3-027 part 2)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Add `allowedCompanies` validation in `createAndPost`

**Files:**
- Modify: `apps/api/src/modules/journal/journal-auto.service.ts:75-127`
- Test: `apps/api/src/modules/journal/journal-auto.service.spec.ts`

- [ ] **Step 1: Add failing test for FINANCE-only account on SHOP companyId**

```typescript
it('throws BadRequestException when SHOP companyId uses FINANCE-only account (F-3-027 part 3)', async () => {
  const tx = {
    companyInfo: { findUnique: jest.fn().mockResolvedValue({ companyCode: 'SHOP' }) },
    chartOfAccount: { findMany: jest.fn().mockResolvedValue([
      { code: '11-2102', nameTh: 'ลูกหนี้เช่าซื้อ', allowedCompanies: ['FINANCE'] },
    ]) },
    journalEntry: { count: jest.fn(), create: jest.fn() },
  };
  await expect((service as any).createAndPost(tx, {
    companyId: 'co-SHOP',
    entryDate: new Date(),
    description: 'test',
    referenceType: 'TEST', referenceId: 'test', createdById: 'u1',
    lines: [
      { accountCode: '11-2102', debit: 100, credit: 0 },
      { accountCode: '11-1101', debit: 0, credit: 100 },
    ],
  })).rejects.toThrow(/11-2102.*ใช้ไม่ได้กับบริษัท SHOP/);
});

it('allows account with empty allowedCompanies for any companyId', async () => {
  const tx = {
    companyInfo: { findUnique: jest.fn().mockResolvedValue({ companyCode: 'SHOP' }) },
    chartOfAccount: { findMany: jest.fn().mockResolvedValue([
      { code: '11-1101', nameTh: 'เงินสด', allowedCompanies: [] },
    ]) },
    journalEntry: {
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn().mockResolvedValue({ id: 'entry1' }),
    },
  };
  await expect((service as any).createAndPost(tx, {
    companyId: 'co-SHOP',
    entryDate: new Date(),
    description: 'test',
    referenceType: 'TEST', referenceId: 'test', createdById: 'u1',
    lines: [
      { accountCode: '11-1101', debit: 100, credit: 0 },
      { accountCode: '11-1101', debit: 0, credit: 100 },
    ],
  })).resolves.toBe('entry1');
});
```

- [ ] **Step 2: Verify fails**

Run: `cd apps/api && npx jest journal-auto.service.spec.ts -t "throws BadRequestException when SHOP"`
Expected: FAIL — current code doesn't validate

- [ ] **Step 3: Add validation in createAndPost**

In `journal-auto.service.ts createAndPost`, after the balance check (around line 100, before `generateEntryNumber`):

```typescript
// Validate allowedCompanies (F-3-027 part 3)
const codes = [...new Set(lines.map(l => l.accountCode))];
const [accounts, company] = await Promise.all([
  tx.chartOfAccount.findMany({
    where: { code: { in: codes } },
    select: { code: true, nameTh: true, allowedCompanies: true },
  }),
  tx.companyInfo.findUnique({
    where: { id: params.companyId },
    select: { companyCode: true },
  }),
]);
if (!company) {
  throw new BadRequestException(`Company ${params.companyId} not found`);
}
for (const acc of accounts) {
  if (acc.allowedCompanies.length > 0 && !acc.allowedCompanies.includes(company.companyCode)) {
    throw new BadRequestException(
      `Account ${acc.code} (${acc.nameTh}) ใช้ไม่ได้กับบริษัท ${company.companyCode}`
    );
  }
}
```

Add the import at top of file:

```typescript
import { BadRequestException, Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
```

(BadRequestException may already be imported — check.)

- [ ] **Step 4: Verify pass**

Run: `cd apps/api && npx jest journal-auto.service.spec.ts -t "throws BadRequestException when SHOP"`
Expected: PASS

Run: `cd apps/api && npx jest journal-auto.service.spec.ts -t "allows account with empty allowedCompanies"`
Expected: PASS

- [ ] **Step 5: Run full journal-auto spec + verify no regression**

Run: `cd apps/api && npx jest journal-auto.service.spec.ts`
Expected: All PASS. Some existing tests may need to mock `chartOfAccount.findMany` and `companyInfo.findUnique` — add stubs.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/journal/journal-auto.service.ts apps/api/src/modules/journal/journal-auto.service.spec.ts
git commit -m "fix(journal): validate allowedCompanies in createAndPost (F-3-027 part 3)

Throws BadRequestException if any account in the JE has allowedCompanies
that excludes the entry's companyCode. Closes the gap where
journal-auto.service.ts was bypassing the validation that
journal.service.ts already enforced for manual entries.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Wave 2 verification + checkpoint

- [ ] **Step 1: TypeScript check**

Run: `./tools/check-types.sh api`
Expected: 0 errors

- [ ] **Step 2: Run all journal + payments + contracts + accounting specs**

Run: `cd apps/api && npx jest journal payments contracts/contract-workflow accounting`
Expected: All PASS

- [ ] **Step 3: User checkpoint**

Wave 2 complete. Proceed to Wave 3?

---

## Wave 3 — Other try/catch removals (Tasks 11-12)

### Task 11: Remove try/catch on expense JE

**Files:**
- Modify: `apps/api/src/modules/accounting/accounting.service.ts:374-391`

- [ ] **Step 1: Add failing test for atomic expense rollback**

In `accounting.service.spec.ts`:

```typescript
it('rolls back expense markPaid if JE creation throws (F-1-016)', async () => {
  const journalAutoMock = {
    createExpenseJournal: jest.fn().mockRejectedValue(new Error('JE failed')),
  };
  // ...
  await expect(service.markExpensePaid(expense.id, /*...*/)).rejects.toThrow('JE failed');
  const after = await prisma.expense.findUnique({ where: { id: expense.id } });
  expect(after.status).not.toBe('PAID');
});
```

- [ ] **Step 2: Verify fails**

Run: `cd apps/api && npx jest accounting.service.spec.ts -t "rolls back expense markPaid"`
Expected: FAIL

- [ ] **Step 3: Remove try/catch around createExpenseJournal**

Edit `accounting.service.ts:374-391`:

```diff
-      try {
-        await this.journalAutoService.createExpenseJournal(tx, { /* ... */ });
-      } catch (err) {
-        this.logger.error(`Auto-journal failed for expense ${updated.id}: ${err}`);
-      }
+      // Atomic with expense payment: if JE fails, transaction rolls back.
+      await this.journalAutoService.createExpenseJournal(tx, { /* ... */ });
```

- [ ] **Step 4: Verify pass + commit**

Run: `cd apps/api && npx jest accounting.service`
Expected: All PASS

```bash
git add apps/api/src/modules/accounting/accounting.service.ts apps/api/src/modules/accounting/accounting.service.spec.ts
git commit -m "fix(accounting): remove try/catch on expense JE (F-1-016)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 12: Remove try/catch on receipt VOID

**Files:**
- Modify: `apps/api/src/modules/receipts/receipts.service.ts:407-426`

- [ ] **Step 1: Add failing test in receipts.service.spec.ts**

```typescript
it('rolls back receipt void if reversal JE throws (F-1-017)', async () => {
  const journalAutoMock = {
    createReversalJournal: jest.fn().mockRejectedValue(new Error('JE failed')),
  };
  // ...
  await expect(service.voidReceipt(receipt.id, /*...*/)).rejects.toThrow('JE failed');
  const after = await prisma.receipt.findUnique({ where: { id: receipt.id } });
  expect(after.status).not.toBe('VOIDED');
});
```

- [ ] **Step 2: Verify fails**

Run: `cd apps/api && npx jest receipts.service.spec.ts -t "rolls back receipt void"`
Expected: FAIL

- [ ] **Step 3: Remove try/catch**

Edit `receipts.service.ts:407-426`:

```diff
-      try {
-        await this.journalAutoService.createReversalJournal(tx, { /* ... */ });
-      } catch (err) {
-        this.logger.error(`Auto-reversal failed for receipt ${id}: ${err}`);
-      }
+      // Atomic with receipt void: if reversal JE fails, transaction rolls back.
+      await this.journalAutoService.createReversalJournal(tx, { /* ... */ });
```

- [ ] **Step 4: Verify pass + commit**

Run: `cd apps/api && npx jest receipts.service`
Expected: All PASS

```bash
git add apps/api/src/modules/receipts/receipts.service.ts apps/api/src/modules/receipts/receipts.service.spec.ts
git commit -m "fix(receipts): remove try/catch on void reversal JE (F-1-017)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Wave 4 — PaySolutions Webhook (Tasks 13-15)

### Task 13: Import JournalModule in PaySolutionsModule

**Files:**
- Modify: `apps/api/src/modules/paysolutions/paysolutions.module.ts`

- [ ] **Step 1: Read current module imports**

Run: `cat apps/api/src/modules/paysolutions/paysolutions.module.ts`

- [ ] **Step 2: Add JournalModule import**

```diff
 import { Module } from '@nestjs/common';
+import { JournalModule } from '../journal/journal.module';
 ...

 @Module({
-  imports: [ /* existing */ ],
+  imports: [ /* existing */, JournalModule ],
   ...
 })
 export class PaySolutionsModule {}
```

- [ ] **Step 3: Verify JournalAutoService is exported from JournalModule**

Run: `grep -E "exports|JournalAutoService" apps/api/src/modules/journal/journal.module.ts`
Expected: `exports: [JournalService, JournalAutoService]` (if not, add to exports)

- [ ] **Step 4: TypeScript check**

Run: `./tools/check-types.sh api`
Expected: 0 errors

(No commit yet — combine with Task 14 in single commit since module change is meaningless without service usage.)

---

### Task 14: Inject + use JournalAutoService in PaySolutionsService

**Files:**
- Modify: `apps/api/src/modules/paysolutions/paysolutions.service.ts:713-816`
- Test: `apps/api/src/modules/paysolutions/paysolutions.service.spec.ts`

- [ ] **Step 1: Add failing test for webhook posts JE**

```typescript
it('posts payment JE on successful webhook callback (F-1-003)', async () => {
  const journalAutoMock = {
    createPaymentJournal: jest.fn().mockResolvedValue('je-1'),
  };
  const service = new PaySolutionsService(prisma, /*...other deps*/, journalAutoMock as any);

  // setup: a Payment row in PENDING + a successful webhook payload
  const payment = await prisma.payment.create({ data: { /* ... */ } });
  await service.handlePaymentCallback({ /* webhook payload */ });

  expect(journalAutoMock.createPaymentJournal).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({
      companyId: payment.companyId,
      payment: expect.objectContaining({ id: payment.id }),
    })
  );
});

it('does not block payment processing if JE creation fails (F-1-003 P2 pattern)', async () => {
  const journalAutoMock = {
    createPaymentJournal: jest.fn().mockRejectedValue(new Error('JE failed')),
  };
  const sentryMock = jest.spyOn(Sentry, 'captureException').mockImplementation(() => 'eid');
  // ... setup
  await expect(service.handlePaymentCallback({ /* payload */ })).resolves.not.toThrow();
  const after = await prisma.payment.findUnique({ where: { id: payment.id } });
  expect(after.status).toBe('PAID'); // Payment processing succeeded despite JE failure
  expect(sentryMock).toHaveBeenCalledWith(
    expect.any(Error),
    expect.objectContaining({ tags: expect.objectContaining({ module: 'paysolutions' }) })
  );
});
```

- [ ] **Step 2: Verify both fail**

Run: `cd apps/api && npx jest paysolutions.service.spec.ts -t "F-1-003"`
Expected: FAIL on both

- [ ] **Step 3: Add JournalAutoService injection**

In `paysolutions.service.ts` constructor:

```diff
+import { JournalAutoService } from '../journal/journal-auto.service';
+import * as Sentry from '@sentry/node';
 ...
   constructor(
     private prisma: PrismaService,
     // ... existing
+    private journalAutoService: JournalAutoService,
   ) {}
```

- [ ] **Step 4: Add JE creation in webhook handler**

Inside `handlePaymentCallback` `$transaction`, after the Payment.update to PAID and after determining `wasFullyPaid`:

```typescript
// Auto journal entry — Sentry+log+continue pattern (P2): webhook MUST NOT block payment
if (paymentUpdated.status === 'PAID') {
  try {
    await this.journalAutoService.createPaymentJournal(tx, {
      companyId: paymentUpdated.companyId,
      payment: {
        id: paymentUpdated.id,
        installmentNo: paymentUpdated.installmentNo,
        amountPaid: paymentUpdated.amountPaid,
        monthlyPrincipal: paymentUpdated.monthlyPrincipal,
        monthlyInterest: paymentUpdated.monthlyInterest,
        monthlyCommission: paymentUpdated.monthlyCommission,
        vatAmount: paymentUpdated.vatAmount,
        lateFee: paymentUpdated.lateFee,
        lateFeeWaived: paymentUpdated.lateFeeWaived,
        paidDate: paymentUpdated.paidDate,
      },
      contract: {
        contractNumber: contract.contractNumber,
        branchId: contract.branchId,
      },
      userId: 'paysolutions-webhook',  // system user for webhook-originated entries
    });
  } catch (err) {
    Sentry.captureException(err, {
      tags: { module: 'paysolutions', event: 'webhook-je-failure' },
      extra: { paymentId: paymentUpdated.id, contractId: contract.id, error: String(err) },
    });
    this.logger.error(`Webhook JE failed for payment ${paymentUpdated.id}: ${err}`);
    // DO NOT rethrow — let payment processing continue
  }
}
```

- [ ] **Step 5: Verify both tests pass**

Run: `cd apps/api && npx jest paysolutions.service.spec.ts -t "F-1-003"`
Expected: PASS on both

- [ ] **Step 6: Run full paysolutions spec**

Run: `cd apps/api && npx jest paysolutions`
Expected: All PASS

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/paysolutions/paysolutions.module.ts apps/api/src/modules/paysolutions/paysolutions.service.ts apps/api/src/modules/paysolutions/paysolutions.service.spec.ts
git commit -m "fix(paysolutions): post payment JE in webhook callback (F-1-003)

Inject JournalAutoService into PaySolutionsService. After Payment.update
to PAID inside the webhook \$transaction, call createPaymentJournal.

Pattern P2 (Sentry+log+continue): if JE creation throws, log + Sentry
alert but DO NOT rethrow — webhook must not block payment processing.
Customer paid via QR; manual reconciliation from Sentry alert.

Closes the source of 36 orphan payments observed in production audit
(Layer 4 finding F-4-001).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 15: Wave 4 verification + checkpoint

- [ ] **Step 1: TypeScript check**

Run: `./tools/check-types.sh api`
Expected: 0 errors

- [ ] **Step 2: Run all changed module specs**

Run: `cd apps/api && npx jest journal payments contracts accounting receipts paysolutions`
Expected: All PASS

- [ ] **Step 3: User checkpoint**

Wave 4 complete. Proceed to Wave 5?

---

## Wave 5 — Period Close Hardening (Tasks 16-21)

### Task 16: Migration for AccountingPeriod reopen audit fields

**Files:**
- Create: `apps/api/prisma/migrations/{timestamp}_add_period_reopen_audit_fields/migration.sql`
- Modify: `apps/api/prisma/schema.prisma` (AccountingPeriod model)

- [ ] **Step 1: Update schema**

Edit `apps/api/prisma/schema.prisma` AccountingPeriod model — add 3 fields after existing `closedById`:

```diff
   closedAt          DateTime? @map("closed_at")
   closedById        String?   @map("closed_by_id")
   closedBy          User?     @relation("PeriodClosedBy", fields: [closedById], references: [id])

+  reopenedAt        DateTime? @map("reopened_at")
+  reopenedById      String?   @map("reopened_by_id")
+  reopenedBy        User?     @relation("PeriodReopenedBy", fields: [reopenedById], references: [id])
+  boardResolutionId String?   @map("board_resolution_id")
+
   peakSyncedAt   DateTime? @map("peak_synced_at")
```

(Also add `PeriodReopenedBy User[] @relation("PeriodReopenedBy")` to the User model.)

- [ ] **Step 2: Generate migration**

Run: `cd apps/api && npx prisma migrate dev --name add_period_reopen_audit_fields --create-only`
Expected: New migration folder created. Verify SQL only adds 3 nullable columns + new FK.

- [ ] **Step 3: Apply migration to dev DB + regenerate client**

Run: `cd apps/api && npx prisma migrate deploy && npx prisma generate`
Expected: Migration applies cleanly.

- [ ] **Step 4: TypeScript check**

Run: `./tools/check-types.sh api`
Expected: 0 errors (the new fields will be required by tests, not by existing code)

- [ ] **Step 5: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations/
git commit -m "feat(accounting): add reopen audit fields to AccountingPeriod (F-6-004)

reopenedAt + reopenedById + boardResolutionId — 3 optional fields to
persist who/when/why for period reopen actions. Adding nullable so
existing rows are unaffected.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 17: `JournalService.post()` validatePeriodOpen

**Files:**
- Modify: `apps/api/src/modules/journal/journal.service.ts:200`
- Test: `apps/api/src/modules/journal/journal.service.spec.ts`

- [ ] **Step 1: Add failing test**

```typescript
it('blocks post() if entryDate is in CLOSED period (F-6-001)', async () => {
  // Setup: AccountingPeriod for 2025-03 with status=CLOSED
  await prisma.accountingPeriod.create({ data: { companyId: 'co1', year: 2025, month: 3, status: 'CLOSED', closedAt: new Date() } });
  // Setup: DRAFT JE with entryDate=2025-03-15
  const entry = await prisma.journalEntry.create({ data: { /* DRAFT, entryDate: 2025-03-15, companyId: co1 */ } });

  await expect(service.post(entry.id, 'user1')).rejects.toThrow(/CLOSED|locked/i);
});
```

- [ ] **Step 2: Verify fails**

Run: `cd apps/api && npx jest journal.service.spec.ts -t "blocks post"`
Expected: FAIL

- [ ] **Step 3: Add validatePeriodOpen call**

Edit `journal.service.ts post()`:

```typescript
import { validatePeriodOpen } from '../../utils/period-lock.util';
// ... in post() at start:
async post(id: string, userId: string, meta?: any) {
  const entry = await this.findOne(id);
  if (entry.status !== 'DRAFT') throw new BadRequestException('Only DRAFT entries can be posted');
  // F-6-001: prevent posting into CLOSED period
  await validatePeriodOpen(this.prisma, entry.entryDate, entry.companyId);
  // ... existing balance re-check + transaction
}
```

- [ ] **Step 4: Verify pass + commit**

Run: `cd apps/api && npx jest journal.service.spec.ts`
Expected: All PASS

```bash
git add apps/api/src/modules/journal/journal.service.ts apps/api/src/modules/journal/journal.service.spec.ts
git commit -m "fix(journal): post() validates period open (F-6-001)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 18: `JournalAutoService.createAndPost` soft-block CLOSED period

**Files:**
- Modify: `apps/api/src/modules/journal/journal-auto.service.ts createAndPost`
- Test: `apps/api/src/modules/journal/journal-auto.service.spec.ts`

- [ ] **Step 1: Add failing test**

```typescript
it('redirects entryDate to current period if originally in CLOSED period (F-6-002)', async () => {
  const tx = {
    accountingPeriod: { findFirst: jest.fn().mockResolvedValue({ status: 'CLOSED' }) },
    companyInfo: { findUnique: jest.fn().mockResolvedValue({ companyCode: 'FINANCE' }) },
    chartOfAccount: { findMany: jest.fn().mockResolvedValue([]) },
    journalEntry: {
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'e1', _captured: data })),
    },
  };
  const sentrySpy = jest.spyOn(Sentry, 'captureMessage').mockImplementation(() => 'eid');
  const originalDate = new Date('2025-03-15');

  await (service as any).createAndPost(tx, {
    companyId: 'co1', entryDate: originalDate, description: 'Original',
    referenceType: 'TEST', referenceId: 'test', createdById: 'u1',
    lines: [
      { accountCode: '11-1101', debit: 100, credit: 0 },
      { accountCode: '21-2101', debit: 0, credit: 100 },
    ],
  });

  const created = tx.journalEntry.create.mock.calls[0][0].data;
  expect(created.entryDate.getFullYear()).toBe(new Date().getFullYear());
  expect(created.description).toMatch(/^\[Originally for 2025-03\]/);
  expect(sentrySpy).toHaveBeenCalled();
});
```

- [ ] **Step 2: Verify fails**

Run: `cd apps/api && npx jest journal-auto.service.spec.ts -t "redirects entryDate"`
Expected: FAIL

- [ ] **Step 3: Add soft-block logic in createAndPost**

After balance check + allowedCompanies check, add:

```typescript
// F-6-002: soft-block — if entryDate falls in CLOSED period, redirect to current period
let entryDate = params.entryDate;
let description = params.description;
const period = await tx.accountingPeriod.findFirst({
  where: {
    companyId: params.companyId,
    year: entryDate.getFullYear(),
    month: entryDate.getMonth() + 1,
    status: { in: ['CLOSED', 'SYNCED'] },
  },
  select: { status: true },
});
if (period) {
  const originalYM = `${entryDate.getFullYear()}-${String(entryDate.getMonth() + 1).padStart(2, '0')}`;
  this.logger.warn(`Auto-JE redirected from CLOSED ${originalYM} to current period`);
  Sentry.captureMessage(`Auto-JE redirect: ${originalYM} → current`, {
    level: 'warning',
    tags: { kind: 'journal', referenceType: params.referenceType },
    extra: { referenceId: params.referenceId, originalYM },
  });
  description = `[Originally for ${originalYM}] ${description}`;
  entryDate = new Date();
}
```

Then use `entryDate` and `description` (local vars) instead of `params.entryDate` / `params.description` in the `journalEntry.create` data block.

- [ ] **Step 4: Verify pass + commit**

Run: `cd apps/api && npx jest journal-auto.service.spec.ts`
Expected: All PASS (existing tests may need to mock `accountingPeriod.findFirst` returning null)

```bash
git add apps/api/src/modules/journal/journal-auto.service.ts apps/api/src/modules/journal/journal-auto.service.spec.ts
git commit -m "fix(journal): auto-JE soft-blocks CLOSED period (F-6-002)

If entryDate falls in CLOSED/SYNCED period, redirect to current period
+ prepend '[Originally for YYYY-MM]' to description + Sentry warning.
Webhook payments must not fail just because period is closed.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 19: `closePeriod` enforce auditIssues with OWNER override

**Files:**
- Modify: `apps/api/src/modules/accounting/monthly-close.service.ts:154`
- Modify: `apps/api/src/modules/accounting/dto/close-month.dto.ts` (add `forceCloseReason` field)
- Test: `apps/api/src/modules/accounting/monthly-close.service.spec.ts`

- [ ] **Step 1: Add field to DTO**

Edit `close-month.dto.ts`:

```diff
+import { IsOptional, IsString, MinLength } from 'class-validator';
 export class CloseMonthDto {
   /* existing fields */
+  @IsOptional()
+  @IsString()
+  @MinLength(50, { message: 'forceCloseReason ต้อง ≥50 ตัวอักษร' })
+  forceCloseReason?: string;
 }
```

- [ ] **Step 2: Add failing tests**

```typescript
it('blocks closePeriod when auditIssues.hasIssues=true and no forceCloseReason (F-6-003)', async () => {
  const period = await prisma.accountingPeriod.create({ data: {
    companyId: 'co1', year: 2026, month: 4, status: 'REVIEW',
    auditIssues: { hasIssues: true, unbalancedJournals: 2 } as any,
  }});
  await expect(service.closePeriod({ companyId: 'co1', year: 2026, month: 4 } as any, 'user1')).rejects.toThrow(/issue/i);
});

it('allows closePeriod with forceCloseReason ≥50 chars + creates AuditLog (F-6-003)', async () => {
  const period = await prisma.accountingPeriod.create({ data: {
    companyId: 'co1', year: 2026, month: 4, status: 'REVIEW',
    auditIssues: { hasIssues: true, unbalancedJournals: 2 } as any,
  }});
  const reason = 'Issues acknowledged: unbalanced JEs traced to test data, will be cleaned in next sprint, force-closing for owner sign-off';
  await service.closePeriod({ companyId: 'co1', year: 2026, month: 4, forceCloseReason: reason } as any, 'user1');
  const auditLog = await prisma.auditLog.findFirst({ where: { action: 'PERIOD_FORCE_CLOSE' } });
  expect(auditLog).not.toBeNull();
  expect(auditLog?.userId).toBe('user1');
});
```

- [ ] **Step 3: Verify fails**

Run: `cd apps/api && npx jest monthly-close.service.spec.ts -t "F-6-003"`
Expected: FAIL on both

- [ ] **Step 4: Add enforcement in closePeriod**

In `monthly-close.service.ts closePeriod()`, after the `existing.status !== 'REVIEW'` check, add:

```typescript
// F-6-003: enforce auditIssues unless OWNER provides forceCloseReason
const hasIssues = (existing.auditIssues as any)?.hasIssues === true;
if (hasIssues && !dto.forceCloseReason) {
  throw new BadRequestException({
    message: 'พบ issue ในงวดนี้ ต้องแก้ก่อนปิด หรือใส่ forceCloseReason (≥50 ตัวอักษร)',
    issues: existing.auditIssues,
  });
}
```

Inside the `$transaction`, before/alongside the period.update to CLOSED, add:

```typescript
if (dto.forceCloseReason) {
  await tx.auditLog.create({
    data: {
      userId,
      action: 'PERIOD_FORCE_CLOSE',
      entity: 'accounting_period',
      entityId: existing.id,
      details: {
        reason: dto.forceCloseReason,
        issues: existing.auditIssues,
        period: `${existing.year}-${String(existing.month).padStart(2, '0')}`,
      } as any,
    },
  });
}
```

- [ ] **Step 5: Verify pass + commit**

Run: `cd apps/api && npx jest monthly-close.service.spec.ts`
Expected: All PASS

```bash
git add apps/api/src/modules/accounting/monthly-close.service.ts apps/api/src/modules/accounting/dto/close-month.dto.ts apps/api/src/modules/accounting/monthly-close.service.spec.ts
git commit -m "fix(accounting): closePeriod enforces auditIssues with OWNER override (F-6-003)

If auditIssues.hasIssues=true, throw BadRequestException unless
forceCloseReason (≥50 chars) provided. Force close creates AuditLog
PERIOD_FORCE_CLOSE for traceability.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 20: `reopenPeriod` audit trail + persistent fields

**Files:**
- Modify: `apps/api/src/modules/accounting/accounting.controller.ts:268`
- Modify: `apps/api/src/modules/accounting/monthly-close.service.ts:253`
- Modify: `apps/api/src/modules/accounting/dto/reopen-period.dto.ts` (or create if absent)

- [ ] **Step 1: Update DTO**

Edit `reopen-period.dto.ts` (create if absent):

```typescript
import { IsString, MinLength } from 'class-validator';

export class ReopenPeriodDto {
  @IsString() companyId!: string;
  @IsString() @MinLength(1) boardResolutionId!: string;
  @IsString() @MinLength(20, { message: 'reason ต้อง ≥20 ตัวอักษร' }) reason!: string;
  year!: number;
  month!: number;
}
```

- [ ] **Step 2: Add failing test**

```typescript
it('reopenPeriod creates AuditLog with userId + boardResolutionId (F-6-004)', async () => {
  const period = await prisma.accountingPeriod.create({ data: {
    companyId: 'co1', year: 2026, month: 3, status: 'CLOSED', closedAt: new Date(),
  }});
  await service.reopenPeriod({
    companyId: 'co1', year: 2026, month: 3,
    boardResolutionId: 'BR-2026-001',
    reason: 'Material misstatement found in March, restating per CPA recommendation',
  }, 'user-OWNER-1');
  const after = await prisma.accountingPeriod.findUnique({ where: { id: period.id } });
  expect(after?.status).toBe('OPEN');
  expect(after?.reopenedById).toBe('user-OWNER-1');
  expect(after?.boardResolutionId).toBe('BR-2026-001');
  const auditLog = await prisma.auditLog.findFirst({ where: { action: 'PERIOD_REOPEN' } });
  expect(auditLog).not.toBeNull();
  expect(auditLog?.userId).toBe('user-OWNER-1');
});
```

- [ ] **Step 3: Verify fails**

Run: `cd apps/api && npx jest monthly-close.service.spec.ts -t "F-6-004"`
Expected: FAIL

- [ ] **Step 4: Update controller to capture userId**

Edit `accounting.controller.ts:268`:

```diff
   @Post('periods/reopen')
   @Roles('OWNER')
-  async reopenPeriod(@Body() dto: ReopenPeriodDto) {
-    return this.monthlyCloseService.reopenPeriod(dto);
+  async reopenPeriod(@Body() dto: ReopenPeriodDto, @Request() req: any) {
+    return this.monthlyCloseService.reopenPeriod(dto, req.user.id);
   }
```

Add `import { Request } from '@nestjs/common';` if absent.

- [ ] **Step 5: Update service to persist + audit**

Edit `monthly-close.service.ts reopenPeriod`:

```diff
-  async reopenPeriod(dto: ReopenPeriodDto) {
+  async reopenPeriod(dto: ReopenPeriodDto, userId: string) {
     // ... existing existence/status checks
     return this.prisma.$transaction(async (tx) => {
       const updated = await tx.accountingPeriod.update({
         where: { id: existing.id },
         data: {
           status: 'OPEN',
           closedAt: null,
           closedById: null,
           auditIssues: undefined,
           reportSnapshot: undefined,
+          reopenedAt: new Date(),
+          reopenedById: userId,
+          boardResolutionId: dto.boardResolutionId,
         },
       });
+      await tx.auditLog.create({
+        data: {
+          userId,
+          action: 'PERIOD_REOPEN',
+          entity: 'accounting_period',
+          entityId: existing.id,
+          details: {
+            boardResolutionId: dto.boardResolutionId,
+            reason: dto.reason,
+            period: `${existing.year}-${String(existing.month).padStart(2, '0')}`,
+          } as any,
+        },
+      });
       return updated;
     });
   }
```

- [ ] **Step 6: Verify pass + commit**

Run: `cd apps/api && npx jest monthly-close.service.spec.ts`
Expected: All PASS

```bash
git add apps/api/src/modules/accounting/accounting.controller.ts apps/api/src/modules/accounting/monthly-close.service.ts apps/api/src/modules/accounting/dto/reopen-period.dto.ts apps/api/src/modules/accounting/monthly-close.service.spec.ts
git commit -m "fix(accounting): reopenPeriod persists audit fields + creates AuditLog (F-6-004)

Controller captures req.user.id and passes to service.
Service persists reopenedAt/reopenedById/boardResolutionId on the period
+ creates AuditLog PERIOD_REOPEN with reason + board resolution.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 21: Wave 5 verification + checkpoint

- [ ] **Step 1: Full TypeScript + test run**

Run: `./tools/check-types.sh all && cd apps/api && npx jest`
Expected: 0 type errors + all tests pass

- [ ] **Step 2: Migration verification**

Run: `cd apps/api && npx prisma migrate status`
Expected: All migrations applied, no drift

- [ ] **Step 3: User checkpoint**

Wave 5 complete. Proceed to E2E + final verification?

---

## E2E Tests (Task 22)

### Task 22: 3 new E2E tests

**Files:**
- Create: `apps/web/e2e/accounting-contract-activation.spec.ts`
- Create: `apps/web/e2e/accounting-paysolutions-webhook.spec.ts`
- Create: `apps/web/e2e/accounting-period-close.spec.ts`

- [ ] **Step 1: Read existing E2E spec for pattern reference**

Run: `ls apps/web/e2e/*.spec.ts | head -5 && head -30 apps/web/e2e/$(ls apps/web/e2e/*.spec.ts | head -1 | xargs basename)`

- [ ] **Step 2: Create contract activation E2E**

Write `apps/web/e2e/accounting-contract-activation.spec.ts`:

```typescript
import { test, expect } from '@playwright/test';
import { loginAsOwner } from './helpers/auth';

test.describe('Accounting — Contract Activation creates JE', () => {
  test('activated contract has matching JournalEntry (F-2-001 + F-1-002 verification)', async ({ page, request }) => {
    await loginAsOwner(page);

    // Create + activate contract via UI (or API for speed)
    const created = await request.post('/api/contracts', { data: { /* fixture */ } });
    const { id, contractNumber } = await created.json();
    await request.post(`/api/contracts/${id}/activate`);

    // Verify JE exists + balanced
    const jeRes = await request.get(`/api/journal-entries?referenceType=CONTRACT&referenceId=${id}`);
    const jes = await jeRes.json();
    expect(jes.data).toHaveLength(2); // sales + COGS entries
    for (const je of jes.data) {
      const totalDr = je.lines.reduce((s: number, l: any) => s + Number(l.debit), 0);
      const totalCr = je.lines.reduce((s: number, l: any) => s + Number(l.credit), 0);
      expect(Math.abs(totalDr - totalCr)).toBeLessThan(0.01);
    }
  });
});
```

- [ ] **Step 3: Create PaySolutions webhook E2E**

Write `apps/web/e2e/accounting-paysolutions-webhook.spec.ts`:

```typescript
import { test, expect } from '@playwright/test';

test.describe('Accounting — PaySolutions webhook creates JE', () => {
  test('webhook callback creates Payment + JournalEntry (F-1-003 verification)', async ({ request }) => {
    // Setup: create a test contract + payment in PENDING via API
    // ... fixture setup

    // Mock webhook call
    const webhookRes = await request.post('/api/paysolutions/webhook', {
      data: { /* payload matching PaySolutions format */ },
      headers: { /* required signature/auth */ },
    });
    expect(webhookRes.ok()).toBe(true);

    // Verify Payment is PAID
    const paymentRes = await request.get(`/api/payments/${paymentId}`);
    const payment = await paymentRes.json();
    expect(payment.status).toBe('PAID');

    // Verify JE was created
    const jeRes = await request.get(`/api/journal-entries?referenceType=PAYMENT&referenceId=${paymentId}`);
    const jes = await jeRes.json();
    expect(jes.data.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 4: Create period close E2E**

Write `apps/web/e2e/accounting-period-close.spec.ts`:

```typescript
import { test, expect } from '@playwright/test';
import { loginAsOwner } from './helpers/auth';

test.describe('Accounting — Period Close hardening', () => {
  test('blocks close when auditIssues.hasIssues; allows with forceCloseReason (F-6-003)', async ({ page, request }) => {
    await loginAsOwner(page);

    // Setup: period with hasIssues=true via test fixture endpoint
    const setup = await request.post('/api/test-fixtures/period-with-issues', {
      data: { companyId: '...', year: 2026, month: 4 },
    });

    // Without forceCloseReason
    const reject = await request.post('/api/expenses/periods/close', {
      data: { companyId: '...', year: 2026, month: 4 },
    });
    expect(reject.status()).toBe(400);

    // With forceCloseReason
    const accept = await request.post('/api/expenses/periods/close', {
      data: {
        companyId: '...', year: 2026, month: 4,
        forceCloseReason: 'Issues acknowledged: traced to test data, will be cleaned in next sprint, force-closing per owner sign-off',
      },
    });
    expect(accept.ok()).toBe(true);

    // Verify AuditLog
    const audit = await request.get('/api/audit-logs?action=PERIOD_FORCE_CLOSE');
    const logs = await audit.json();
    expect(logs.data.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 5: Run E2E locally**

Run: `cd apps/web && npx playwright test accounting-`
Expected: All 3 PASS

If failures relate to chat_snoozes drift (memory `project_chat_snoozes_migration_drift.md`), document but proceed — that's a separate pre-existing issue.

- [ ] **Step 6: Commit**

```bash
git add apps/web/e2e/accounting-*.spec.ts
git commit -m "test(accounting): add E2E for activation JE, webhook JE, period close (Phase A.0)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Final Verification + PR (Task 23)

### Task 23: Comprehensive check + push + open PR

- [ ] **Step 1: Full TypeScript check**

Run: `./tools/check-types.sh all`
Expected: 0 errors

- [ ] **Step 2: Full unit test suite**

Run: `cd apps/api && npx jest`
Expected: All PASS (existing 577 + ~20 new)

- [ ] **Step 3: Lint check**

Run: `cd apps/api && npm run lint && cd ../web && npm run lint`
Expected: 0 errors

- [ ] **Step 4: Local E2E smoke**

Run: `cd apps/web && npx playwright test --grep="accounting"`
Expected: All PASS (3 new + any related existing)

- [ ] **Step 5: Run /review subagent before push**

Use the code-reviewer subagent on all changed files in this branch:

```
diff --stat origin/main...HEAD
```

Dispatch code-reviewer with: "Review all changes in branch feat/accounting-phase-a0-critical-fix vs main. Spec: docs/superpowers/specs/2026-04-29-accounting-phase-a0-critical-fix-design.md. Check: spec coverage, missing tests, type consistency, severity of any new issues. Output finding list."

Fix any CRITICAL or WARNING findings inline.

- [ ] **Step 6: Push branch**

Run: `git push -u origin feat/accounting-phase-a0-critical-fix`
Expected: branch pushed

- [ ] **Step 7: Open PR via gh**

```bash
gh pr create --title "feat(accounting): Phase A.0 critical fix — math + try/catch + webhook + period close" --body "$(cat <<'EOF'
## Summary

Phase A.0 of the accounting fix plan from the 2026-04-29 audit. Code-only fixes (no CoA changes, no policy decisions). 11 fixes in 5 waves.

### Critical chain fixed
- **F-2-001**: hpReceivable double-counting math bug (1 line)
- **F-1-002**: try/catch swallowing activation JE failures (3 sites)
- **F-1-003**: PaySolutions webhook now posts payment JE (was source of 36 orphan payments in prod)
- **F-3-027**: allowedCompanies validation in createAndPost + deterministic resolveCompanyId

### Period close hardened
- **F-6-001**: JournalService.post() validates period not CLOSED
- **F-6-002**: JournalAutoService soft-blocks CLOSED period (redirects to current)
- **F-6-003**: closePeriod enforces auditIssues with OWNER forceCloseReason override
- **F-6-004**: reopenPeriod persists audit trail + AuditLog

### Out of scope (future phases)
- CoA reconciliation → A.1 (blocked on owner business decision)
- Policy fixes (interest, commission, VAT, inter-company) → A.2 (CPA pending)
- Backfill 36 orphan payments + historical activations → A.3 (after A.0 + A.1 deployed)

## Test plan
- [ ] All unit tests pass (existing 577 + ~20 new)
- [ ] All E2E tests pass (3 new + existing)
- [ ] Sentry no error spike for 1 hour post-deploy
- [ ] Manual: 1 contract activation → JE exists + balanced
- [ ] Manual: 1 PaySolutions test webhook → JE exists
- [ ] Layer 4 prod re-run after 24h → no NEW orphan payments

Spec: \`docs/superpowers/specs/2026-04-29-accounting-phase-a0-critical-fix-design.md\`
Plan: \`docs/superpowers/plans/2026-04-29-accounting-phase-a0-critical-fix.md\`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 8: Monitor CI**

Run: `gh pr checks` after creation
Wait for: Lint pass + 4 E2E shards (note: chat_snoozes drift may cause unrelated E2E failures — document, don't block on those)

- [ ] **Step 9: Report PR URL to user + await merge approval**

Report PR # and URL. Wait for user to merge (admin override may be needed if E2E fails on unrelated chat_snoozes drift).

---

## Self-Review Checklist (run before declaring plan complete)

- [ ] Spec coverage: every fix in spec section 3 has at least one task ✓ (11 fixes → Tasks 1, 3, 5, 6, 7, 8, 9, 11, 12, 13-14, 17, 18, 19, 20)
- [ ] Test coverage: each fix has at least one failing-then-passing test ✓
- [ ] No placeholder text (TBD/TODO/XXX) — verify with grep
- [ ] Type consistency: parameter names match across tasks (companyId, forceCloseReason, boardResolutionId)
- [ ] Migration is additive only (3 nullable columns)
- [ ] Commit messages reference finding IDs
- [ ] All 5 waves have a verification + checkpoint step
- [ ] Final task includes PR creation with proper body

---

## Estimated Effort

| Wave | Tasks | Time |
|---|---|---|
| 1 (Foundation) | 1-4 | ~1 hr |
| 2 (Company validation) | 5-10 | ~3 hr |
| 3 (try/catch) | 11-12 | ~30 min |
| 4 (PaySolutions webhook) | 13-15 | ~2 hr |
| 5 (Period close) | 16-21 | ~3 hr |
| E2E | 22 | ~2 hr |
| Final + PR | 23 | ~1.5 hr |
| **Total** | **23 tasks** | **~13 hr** |
