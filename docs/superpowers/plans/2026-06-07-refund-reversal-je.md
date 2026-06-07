# Refund Reversal JE — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a refund's bank reversal is confirmed (`RefundsService.markReversed`), atomically post the reversing JE for the original payment (reuse `ReceiptVoidReversalTemplate`) and restore the installment to its true unpaid state.

**Architecture:** `markReversed` becomes a `$transaction`: period guard → flip refund→PROCESSED → reverse the original payment JE via the existing A.5a template → revert `payment` to unpaid → audit. A small backward-compatible `flow` param is added to `ReceiptVoidReversalTemplate` so the refund's reversal is labelled `'refund-reversal'`. Backend only.

**Tech Stack:** NestJS 11, Prisma 6, `Prisma.Decimal`, Jest + ts-jest.

**Spec:** `docs/superpowers/specs/2026-06-07-refund-reversal-je-design.md`
**Branch:** `feat/refund-reversal-je` (off main, already checked out)

**Critical constraint:** Changes the ledger (posts a reversal JE + reverts the payment). Plan ends at **open PR — do NOT merge** (merge to `main` auto-deploys to prod). Accountant sign-off required.

---

## File Structure

- **Modify:** `apps/api/src/modules/journal/cpa-templates/receipt-void-reversal.template.ts` — add optional `opts?: { flow?: string }` (default `'receipt-void'`), used in the idempotency lookup + the metadata stamp.
- **Modify:** `apps/api/src/modules/refunds/refunds.service.ts` — `markReversed` → `$transaction` with JE reversal + payment revert; inject the template + `Logger`; import `validatePeriodOpen`.
- **Modify:** `apps/api/src/modules/refunds/refunds.module.ts` — `imports: [JournalModule]`.
- **Test:** `apps/api/src/modules/journal/cpa-templates/receipt-void-reversal.template.spec.ts` (extend or create) — flow param.
- **Test:** `apps/api/src/modules/refunds/refunds.service.spec.ts` (extend or create) — markReversed.

---

## Task 1: `flow` param on `ReceiptVoidReversalTemplate`

**Files:**
- Modify: `apps/api/src/modules/journal/cpa-templates/receipt-void-reversal.template.ts`
- Test: `apps/api/src/modules/journal/cpa-templates/receipt-void-reversal.template.spec.ts`

- [ ] **Step 1: Inspect the existing spec (extend, don't clobber)**

Run: `ls apps/api/src/modules/journal/cpa-templates/receipt-void-reversal.template.spec.ts && head -40 apps/api/src/modules/journal/cpa-templates/receipt-void-reversal.template.spec.ts`
If it exists, you'll append a `describe`. If not, create the file with the full content from Step 2.

- [ ] **Step 2: Write the failing test**

Create/append `receipt-void-reversal.template.spec.ts`:

```ts
import { Prisma } from '@prisma/client';
import { JournalAutoService } from '../journal-auto.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { ReceiptVoidReversalTemplate } from './receipt-void-reversal.template';

describe('ReceiptVoidReversalTemplate flow param', () => {
  function setup() {
    const findFirst = jest.fn().mockResolvedValue(null); // no existing reversal
    const findUnique = jest.fn().mockResolvedValue({
      id: 'je-1',
      entryNumber: 'JE-0001',
      status: 'POSTED',
      metadata: {},
      lines: [
        { accountCode: '11-1201', debit: new Prisma.Decimal(100), credit: new Prisma.Decimal(0), description: 'x' },
        { accountCode: '11-2101', debit: new Prisma.Decimal(0), credit: new Prisma.Decimal(100), description: 'y' },
      ],
    });
    const update = jest.fn().mockResolvedValue({});
    const prisma = {
      journalEntry: { findFirst, findUnique, update },
    } as unknown as PrismaService;
    const createAndPost = jest.fn().mockResolvedValue({ entryNumber: 'JE-0002' });
    const journal = { createAndPost } as unknown as JournalAutoService;
    const tpl = new ReceiptVoidReversalTemplate(journal, prisma);
    return { tpl, findFirst, createAndPost };
  }

  it('default flow is receipt-void (unchanged)', async () => {
    const { tpl, findFirst, createAndPost } = setup();
    await tpl.voidReceipt('je-1');
    // idempotency keyed on default flow
    const idemWhere = findFirst.mock.calls[0][0].where.AND;
    expect(idemWhere).toEqual(
      expect.arrayContaining([{ metadata: { path: ['flow'], equals: 'receipt-void' } }]),
    );
    expect(createAndPost.mock.calls[0][0].metadata.flow).toBe('receipt-void');
  });

  it('opts.flow overrides both the idempotency lookup and the metadata stamp', async () => {
    const { tpl, findFirst, createAndPost } = setup();
    await tpl.voidReceipt('je-1', undefined, { flow: 'refund-reversal' });
    const idemWhere = findFirst.mock.calls[0][0].where.AND;
    expect(idemWhere).toEqual(
      expect.arrayContaining([{ metadata: { path: ['flow'], equals: 'refund-reversal' } }]),
    );
    expect(createAndPost.mock.calls[0][0].metadata.flow).toBe('refund-reversal');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd apps/api && npx jest src/modules/journal/cpa-templates/receipt-void-reversal.template.spec.ts -t "flow param" --runInBand`
Expected: FAIL — the second test gets `'receipt-void'` (param ignored), and/or `voidReceipt` rejects the 3rd arg type.

- [ ] **Step 4: Implement the param**

In `receipt-void-reversal.template.ts`:

(4a) Change the signature:
```ts
  async voidReceipt(
    originalJournalEntryId: string,
    tx?: Prisma.TransactionClient,
    opts?: { flow?: string },
  ): Promise<{ entryNo: string }> {
    const client = tx ?? this.prisma;
    const flow = opts?.flow ?? 'receipt-void';
```
(The first line of the body — `const client = tx ?? this.prisma;` — already exists; add the `const flow` line right after it.)

(4b) In the idempotency `findFirst`, replace the hardcoded flow:
```ts
          { metadata: { path: ['flow'], equals: flow } } as Prisma.JournalEntryWhereInput,
```
(4c) In the `createAndPost` metadata, replace `flow: 'receipt-void',` with:
```ts
          flow,
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/api && npx jest src/modules/journal/cpa-templates/receipt-void-reversal.template.spec.ts --runInBand`
Expected: PASS (both new tests + any pre-existing ones).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/journal/cpa-templates/receipt-void-reversal.template.ts apps/api/src/modules/journal/cpa-templates/receipt-void-reversal.template.spec.ts
git commit -m "feat(journal): optional flow param on ReceiptVoidReversalTemplate (default receipt-void)" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: `markReversed` posts the reversal + reverts the payment

**Files:**
- Modify: `apps/api/src/modules/refunds/refunds.service.ts`
- Modify: `apps/api/src/modules/refunds/refunds.module.ts`
- Test: `apps/api/src/modules/refunds/refunds.service.spec.ts`

- [ ] **Step 1: Inspect the existing service spec (extend, don't clobber)**

Run: `ls apps/api/src/modules/refunds/refunds.service.spec.ts && grep -n "markReversed\|describe(" apps/api/src/modules/refunds/refunds.service.spec.ts`
If it exists, append the `describe` below and reuse its construction helper if compatible. If not, create the file with the content from Step 2.

- [ ] **Step 2: Write the failing test**

Create/append `refunds.service.spec.ts`. Mock `validatePeriodOpen` at the top:

```ts
jest.mock('../../utils/period-lock.util', () => ({ validatePeriodOpen: jest.fn() }));

import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ReceiptVoidReversalTemplate } from '../journal/cpa-templates/receipt-void-reversal.template';
import { RefundsService } from './refunds.service';
import { validatePeriodOpen } from '../../utils/period-lock.util';

const APPROVED_REFUND = {
  id: 'refund-1',
  paymentId: 'pay-1',
  status: 'APPROVED',
  deletedAt: null,
  bankReversalLockedAt: null,
  bankReversalRef: null,
};

function setup(refund: Record<string, unknown> = APPROVED_REFUND, originalJe: unknown = { id: 'je-1' }) {
  const tx = {
    refund: { update: jest.fn().mockResolvedValue({ ...refund, status: 'PROCESSED' }) },
    journalEntry: { findFirst: jest.fn().mockResolvedValue(originalJe) },
    payment: { update: jest.fn().mockResolvedValue({}) },
  };
  const prisma = {
    refund: { findUnique: jest.fn().mockResolvedValue(refund) },
    $transaction: jest.fn().mockImplementation(async (cb: (t: typeof tx) => unknown) => cb(tx)),
  } as unknown as PrismaService;
  const audit = { log: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;
  const voidReceipt = jest.fn().mockResolvedValue({ entryNo: 'JE-REV-1' });
  const template = { voidReceipt } as unknown as ReceiptVoidReversalTemplate;
  const svc = new RefundsService(prisma, audit, template);
  return { svc, prisma, tx, audit, voidReceipt };
}

const DTO = { bankReversalRef: 'BANKREF-1', notes: 'reversed' } as never;

describe('RefundsService.markReversed — ledger reversal', () => {
  beforeEach(() => (validatePeriodOpen as jest.Mock).mockReset().mockResolvedValue(undefined));

  it('reverses the original payment JE (flow refund-reversal) and reverts the payment to unpaid', async () => {
    const { svc, tx, voidReceipt } = setup();
    await svc.markReversed('refund-1', DTO, 'user-1', 'OWNER');

    expect(tx.journalEntry.findFirst).toHaveBeenCalledWith({
      where: { referenceType: 'PAYMENT', referenceId: 'pay-1', status: 'POSTED', deletedAt: null },
    });
    expect(voidReceipt).toHaveBeenCalledWith('je-1', tx, { flow: 'refund-reversal' });
    expect(tx.payment.update).toHaveBeenCalledWith({
      where: { id: 'pay-1' },
      data: { status: 'PENDING', amountPaid: 0, paidDate: null },
    });
    expect(tx.refund.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'refund-1' }, data: expect.objectContaining({ status: 'PROCESSED' }) }),
    );
  });

  it('legacy payment with no POSTED JE: skips the reversal but still reverts the payment', async () => {
    const { svc, tx, voidReceipt } = setup(APPROVED_REFUND, null);
    await svc.markReversed('refund-1', DTO, 'user-1', 'OWNER');
    expect(voidReceipt).not.toHaveBeenCalled();
    expect(tx.payment.update).toHaveBeenCalled();
  });

  it('closed period: throws and commits nothing', async () => {
    const { svc, tx } = setup();
    (validatePeriodOpen as jest.Mock).mockRejectedValue(new Error('period closed'));
    await expect(svc.markReversed('refund-1', DTO, 'user-1', 'OWNER')).rejects.toThrow('period closed');
    expect(tx.payment.update).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd apps/api && npx jest src/modules/refunds/refunds.service.spec.ts -t "ledger reversal" --runInBand`
Expected: FAIL — `RefundsService` constructor takes 2 args (no template), `markReversed` doesn't call the template / payment.update.

- [ ] **Step 4: Wire DI — module + constructor + imports**

(4a) `refunds.module.ts` — add the JournalModule import. Add at the top with the other imports:
```ts
import { JournalModule } from '../journal/journal.module';
```
and add an `imports` array to the `@Module({...})` (keep existing `controllers`/`providers`/`exports`):
```ts
  imports: [JournalModule],
```

(4b) `refunds.service.ts` — extend the imports at the top of the file:
```ts
import { Logger } from '@nestjs/common';
import { validatePeriodOpen } from '../../utils/period-lock.util';
import { ReceiptVoidReversalTemplate } from '../journal/cpa-templates/receipt-void-reversal.template';
```
(`Logger` may already be imported from `@nestjs/common` alongside the exceptions — if so, just add `Logger` to that existing import instead of a new line.)

(4c) Add the logger field + inject the template in the constructor:
```ts
  private readonly logger = new Logger(RefundsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly receiptVoidReversalTemplate: ReceiptVoidReversalTemplate,
  ) {}
```

- [ ] **Step 5: Rewrite `markReversed` body (writes inside a `$transaction`)**

Replace the section from `const now = new Date();` through `return updated;` with:

```ts
    const now = new Date();
    const { updated, reversalEntryNo } = await this.prisma.$transaction(async (tx) => {
      // The reversal JE posts to the current period — guard it's open (mirror voidReceipt).
      await validatePeriodOpen(tx, now);

      const updated = await tx.refund.update({
        where: { id: refundId },
        data: {
          status: 'PROCESSED',
          bankReversalRef: dto.bankReversalRef,
          bankReversalAt: now,
          bankReversalNotes: dto.notes,
          // T1-C8 — freeze bankReversalRef / bankReversalAt on first write.
          bankReversalLockedAt: now,
        },
      });

      // Refund = correcting an erroneous booking → reverse the original payment JE
      // in full (refunds are always full). Reuses the proven A.5a mirror.
      let reversalEntryNo: string | null = null;
      const originalEntry = await tx.journalEntry.findFirst({
        where: { referenceType: 'PAYMENT', referenceId: refund.paymentId, status: 'POSTED', deletedAt: null },
      });
      if (originalEntry) {
        const rev = await this.receiptVoidReversalTemplate.voidReceipt(originalEntry.id, tx, { flow: 'refund-reversal' });
        reversalEntryNo = rev.entryNo;
      } else {
        this.logger.warn(
          `[refund ${refundId}] no POSTED payment JE for payment ${refund.paymentId} — reverting payment without a reversal JE (legacy)`,
        );
      }

      // Restore the installment to its true unpaid state (the booking was wrong).
      // Planned-schedule fields (monthlyPrincipal/Interest/Commission, amountDue) and
      // lateFee are left as-is — they describe the plan, not this reverted payment.
      await tx.payment.update({
        where: { id: refund.paymentId },
        data: { status: 'PENDING', amountPaid: 0, paidDate: null },
      });

      return { updated, reversalEntryNo };
    });

    await this.audit.log({
      userId,
      action: 'REFUND_PROCESSED',
      entity: 'Refund',
      entityId: refundId,
      oldValue: { status: 'APPROVED' },
      newValue: {
        status: 'PROCESSED',
        bankReversalRef: dto.bankReversalRef,
        reversalEntryNo,
      },
    });

    return updated;
```

(The guard block above it — `findUnique`, the APPROVED / role / write-once-lock checks — stays unchanged, before the transaction.)

- [ ] **Step 6: Run test to verify it passes**

Run: `cd apps/api && npx jest src/modules/refunds/refunds.service.spec.ts --runInBand`
Expected: PASS (the 3 new tests + any pre-existing markReversed/refund tests).

- [ ] **Step 7: Lint both changed files**

Run: `cd apps/api && npx eslint 'src/modules/refunds/refunds.service.ts' 'src/modules/refunds/refunds.module.ts'`
Expected: 0 errors.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/modules/refunds/refunds.service.ts apps/api/src/modules/refunds/refunds.module.ts apps/api/src/modules/refunds/refunds.service.spec.ts
git commit -m "feat(refunds): markReversed posts reversal JE + reverts payment (error-correction)" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Regression + PR (no merge)

**Files:** none (verification only)

- [ ] **Step 1: Run the refunds + journal-template suites in isolation**

Run: `cd apps/api && npx jest src/modules/refunds src/modules/journal/cpa-templates/receipt-void-reversal.template.spec.ts --runInBand`
Expected: PASS. If a pre-existing refund spec asserted the old "no JE / no payment change" behavior, update that assertion to match the new behavior (the spec is now wrong, not the code) and note it in the commit.

- [ ] **Step 2: Confirm receipts.voidReceipt still compiles against the new template signature**

Run: `cd apps/api && npx jest src/modules/receipts --runInBand`
Expected: PASS — `voidReceipt`'s existing 2-arg call `this.receiptVoidReversalTemplate.voidReceipt(originalEntry.id, tx)` is unaffected (3rd param optional, default `'receipt-void'`).

- [ ] **Step 3: Push + open PR (do NOT merge)**

```bash
git push -u origin feat/refund-reversal-je
gh pr create --base main --head feat/refund-reversal-je \
  --title "feat(refunds): markReversed posts the ledger reversal JE + reverts the payment" \
  --body "Implements docs/superpowers/specs/2026-06-07-refund-reversal-je-design.md. On a confirmed full bank-reversal refund, markReversed now (in one \$transaction) posts the reversing JE for the original payment (reuses ReceiptVoidReversalTemplate with flow='refund-reversal') and reverts the installment to its true unpaid state (PENDING/0/null). Period-guarded + idempotent. Refund = correcting an erroneous booking, so it deliberately reverts the payment (unlike voidReceipt's credit-note model) and lets normal overdue/dunning re-apply. **Changes the ledger — needs accountant sign-off before merge (merge auto-deploys to prod).** 🤖 Generated with Claude Code"
```

- [ ] **Step 4: STOP — do not merge.** Report the PR is open and needs accountant sign-off before merge/deploy.

---

## Self-Review

- **Spec coverage:** $transaction ✓ (T2 S5); period guard ✓ (T2 S5 validatePeriodOpen); reverse JE via template ✓ (T2 S5); flow param ✓ (T1); revert payment to PENDING/0/null ✓ (T2 S5); legacy no-JE edge ✓ (T2 S2/S5); DI wiring ✓ (T2 S4); idempotency = template's (unchanged) ✓; audit + reversalEntryNo ✓ (T2 S5). Out of scope (partial refunds, other states, frontend, dunning suppression) — not touched ✓.
- **Placeholders:** none — exact code/commands throughout.
- **Type consistency:** template `voidReceipt(id, tx?, opts?:{flow?:string})` matches the call `voidReceipt(originalEntry.id, tx, {flow:'refund-reversal'})`; `reversalEntryNo` typed `string | null` and read from `rev.entryNo`; constructor `(prisma, audit, receiptVoidReversalTemplate)` matches the spec's `new RefundsService(prisma, audit, template)`.
