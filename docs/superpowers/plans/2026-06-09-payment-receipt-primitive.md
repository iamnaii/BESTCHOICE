# Payment-Receipt Primitive (PR-843 / I2 — Phase 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the single shared "post a payment receipt for delta X on one installment" primitive (a new `PaymentReceiptTemplate` cpa-template), proven with unit + real-DB e2e, while changing **zero** existing payment-path behaviour (the template is dormant until Phase 3 wires the callers).

**Architecture:** A pure money-math function `splitReceipt()` (no Nest, no DB, no throw — mirrors `computeInstallmentBreakdown`) computes `principalCleared / lateFeePortion / overpayRounding / underpayRounding` from `delta` + the installment's prior-cleared amounts. A thin injectable `PaymentReceiptTemplate.execute()` reconstructs `priorPrincipalCleared` (Σ Cr 11-2103) and `priorLateFeeBooked` (Σ Cr 42-1103) from this installment's prior `tag:'receipt'` JE lines, calls `splitReceipt()`, enforces tolerance/approver, and posts ONE balanced JE via `journal.createAndPost(input, outerTx?)`. Every receipt — partial or completing — clears only what it actually covers, so `Σ(Cr 11-2103) per installment == installmentTotal` and `Σ(Cr 42-1103) == lateFee` hold for ANY receipt sequence and ANY path. The ~0.01 `monthlyPayment − installmentTotal` divergence (the Attempt-B failure) falls out naturally as the final receipt's `overpayRounding → 53-1503`.

**Tech Stack:** NestJS, Prisma (PostgreSQL), `@prisma/client/runtime/library` `Decimal`, jest (`--runInBand`), real-DB e2e via `npm run test:e2e`.

---

## Scope (this PR)

IN: new `split-receipt.ts` pure fn + unit spec; new `payment-receipt.template.ts` + DI registration; real-DB e2e covering the Σ-invariants. **No edits** to `payments.service.ts`, `paysolutions.service.ts`, or the existing `payment-receipt-2b*.template.ts` — those migrations are Phase 3. Merging this is safe on auto-deploy `main` because nothing calls the new template.

OUT (Phase 3+): wiring recordPayment / autoAllocate / paysolutions / applyCreditBalance onto the primitive; legacy-`2B`-partial interop for in-flight installments; flipping `recordpayment-prior-partial.e2e-spec.ts` to assert success; updating `paysolutions.callback-money.spec.ts`.

## Accounting treatment (re-confirm with accountant before merge — consistent with existing 2B + `accounting.md`)

- Cr **11-2103** = principal cleared this receipt; Σ across receipts == `installmentTotal`.
- Cr **42-1103** = late-fee booked this receipt (non-VAT penalty income); Σ == `lateFee`.
- Overpay rounding (>0, ≤1฿) → Cr **53-1503**; underpay close (≤1฿, final receipt only, needs `toleranceApproverId`) → Dr **52-1104**. Same routing as `PaymentReceipt2BTemplate`.
- Surplus beyond `installmentTotal + lateFee` is parked by the caller as `advanceCredit` → Cr **21-1103**; existing advance supplied via `advanceConsume` → Dr **21-1103**. Never silently dropped.

## File Structure

- Create `apps/api/src/modules/journal/split-receipt.ts` — pure allocation math. One responsibility: turn `(delta, installmentTotal, lateFee, prior*, advance*, isFinalReceipt)` into JE-ready amounts. No imports beyond `Decimal`.
- Create `apps/api/src/modules/journal/split-receipt.spec.ts` — jest unit goldens (no DB). NOTE: spec lives at the journal module ROOT, NOT under `__tests__/` (the main jest config ignores `journal/**/__tests__/**.spec.ts`; mirrors `compute-installment-breakdown.spec.ts`).
- Create `apps/api/src/modules/journal/cpa-templates/payment-receipt.template.ts` — injectable; reconstruction + `splitReceipt` + `createAndPost`; `outerTx`-aware.
- Modify `apps/api/src/modules/journal/journal.module.ts` — register `PaymentReceiptTemplate` as provider + export (mirror `PaymentReceipt2BSplitTemplate` at lines 71 & 126).
- Create `apps/api/e2e/payment-receipt-primitive.e2e-spec.ts` — real-DB Σ-invariant proof (mirror harness of `e2e/recordpayment-prior-partial.e2e-spec.ts`).

---

### Task 0: Branch

- [ ] **Step 1: Create the Phase-2 branch off main**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE
git checkout main && git pull --ff-only
git checkout -b feat/payment-receipt-primitive
```

Expected: on a fresh `feat/payment-receipt-primitive` branch.

---

### Task 1: Pure `splitReceipt()` allocation function

**Files:**
- Create: `apps/api/src/modules/journal/split-receipt.ts`
- Test: `apps/api/src/modules/journal/split-receipt.spec.ts`

- [ ] **Step 1: Write the failing unit spec**

Create `apps/api/src/modules/journal/split-receipt.spec.ts`:

```ts
import { Decimal } from '@prisma/client/runtime/library';
import { splitReceipt, SplitReceiptInput } from '../split-receipt';

const D = (v: string | number) => new Decimal(v);

// Base: 17K/12M standard fixture → installmentTotal = 1515.83 (accounting.md).
const base: Omit<SplitReceiptInput, 'delta'> = {
  installmentTotal: D('1515.83'),
  lateFee: D(0),
  priorPrincipalCleared: D(0),
  priorLateFeeBooked: D(0),
  advanceConsume: D(0),
  advanceCredit: D(0),
  isFinalReceipt: false,
};

describe('splitReceipt — per-receipt allocation (Σ-invariant primitive)', () => {
  it('pure partial: delta < principalRemaining clears only delta, leaves remainder', () => {
    const r = splitReceipt({ ...base, delta: D('800') });
    expect(r.principalCleared.toFixed(2)).toBe('800.00');
    expect(r.lateFeePortion.toFixed(2)).toBe('0.00');
    expect(r.overpayRounding.toFixed(2)).toBe('0.00');
    expect(r.underpayRounding.toFixed(2)).toBe('0.00');
    expect(r.principalRemainingAfter.toFixed(2)).toBe('715.83');
  });

  it('COMPLETING a prior partial (the bug case): prior=800, delta=715.83 → clears 715.83, no throw, remainder 0', () => {
    const r = splitReceipt({ ...base, delta: D('715.83'), priorPrincipalCleared: D('800') });
    expect(r.principalCleared.toFixed(2)).toBe('715.83');
    expect(r.overpayRounding.toFixed(2)).toBe('0.00');
    expect(r.underpayRounding.toFixed(2)).toBe('0.00');
    expect(r.principalRemainingAfter.toFixed(2)).toBe('0.00');
  });

  it('late fee split: delta = installmentTotal + lateFee → principal + 42-1103 split, no rounding', () => {
    const r = splitReceipt({ ...base, lateFee: D('100'), delta: D('1615.83') });
    expect(r.principalCleared.toFixed(2)).toBe('1515.83');
    expect(r.lateFeePortion.toFixed(2)).toBe('100.00');
    expect(r.overpayRounding.toFixed(2)).toBe('0.00');
    expect(r.principalRemainingAfter.toFixed(2)).toBe('0.00');
  });

  it('overpay rounding (monthlyPayment > installmentTotal by 0.01) → 53-1503 gain', () => {
    const r = splitReceipt({ ...base, delta: D('1515.84') });
    expect(r.principalCleared.toFixed(2)).toBe('1515.83');
    expect(r.overpayRounding.toFixed(2)).toBe('0.01');
    expect(r.underpayRounding.toFixed(2)).toBe('0.00');
    expect(r.principalRemainingAfter.toFixed(2)).toBe('0.00');
  });

  it('underpay close on FINAL receipt (monthlyPayment < installmentTotal by 0.01) → 52-1104, full clear', () => {
    const r = splitReceipt({ ...base, delta: D('1515.82'), isFinalReceipt: true });
    expect(r.principalCleared.toFixed(2)).toBe('1515.83'); // full clear incl. absorbed 0.01
    expect(r.underpayRounding.toFixed(2)).toBe('0.01');
    expect(r.overpayRounding.toFixed(2)).toBe('0.00');
    expect(r.principalRemainingAfter.toFixed(2)).toBe('0.00');
  });

  it('same 0.01 short but NOT final → stays partial, no 52-1104', () => {
    const r = splitReceipt({ ...base, delta: D('1515.82'), isFinalReceipt: false });
    expect(r.principalCleared.toFixed(2)).toBe('1515.82');
    expect(r.underpayRounding.toFixed(2)).toBe('0.00');
    expect(r.principalRemainingAfter.toFixed(2)).toBe('0.01');
  });

  it('advance consume supplements delta toward the installment total', () => {
    const r = splitReceipt({ ...base, delta: D('700'), advanceConsume: D('815.83') });
    expect(r.principalCleared.toFixed(2)).toBe('1515.83');
    expect(r.principalRemainingAfter.toFixed(2)).toBe('0.00');
  });

  it('advance credit (parked surplus) is removed before allocation — clean clear, no over-rounding', () => {
    const r = splitReceipt({ ...base, delta: D('2000'), advanceCredit: D('484.17') });
    expect(r.principalCleared.toFixed(2)).toBe('1515.83');
    expect(r.overpayRounding.toFixed(2)).toBe('0.00');
  });

  it('over-collection beyond tolerance surfaces as overpayRounding > 1 (template will reject/park)', () => {
    const r = splitReceipt({ ...base, delta: D('1600') });
    expect(r.principalCleared.toFixed(2)).toBe('1515.83');
    expect(r.overpayRounding.toFixed(2)).toBe('84.17');
  });
});
```

- [ ] **Step 2: Run the spec — verify it fails (module not found)**

Run: `cd apps/api && npx jest --runInBand split-receipt`
Expected: FAIL — `Cannot find module '../split-receipt'`.

- [ ] **Step 3: Implement the pure function**

Create `apps/api/src/modules/journal/split-receipt.ts`:

```ts
import { Decimal } from '@prisma/client/runtime/library';

const TOLERANCE = new Decimal('1.00');

export interface SplitReceiptInput {
  /** Cash (or customer-credit) received THIS receipt for THIS installment. */
  delta: Decimal;
  /** installmentTotal from computeInstallmentBreakdown (the 2A-accrual basis). */
  installmentTotal: Decimal;
  /** Total late fee owed on this installment (0 when none / waived). */
  lateFee: Decimal;
  /** Σ Cr 11-2103 already posted for this installment by prior receipts. */
  priorPrincipalCleared: Decimal;
  /** Σ Cr 42-1103 already posted for this installment by prior receipts. */
  priorLateFeeBooked: Decimal;
  /** Existing 21-1103 advance consumed to supplement delta (Dr 21-1103). */
  advanceConsume: Decimal;
  /** Surplus parked as new 21-1103 advance (Cr 21-1103) — excluded from allocation. */
  advanceCredit: Decimal;
  /**
   * True when this receipt is intended to CLOSE the installment. Lets a residual
   * underpay in (0, 1฿] route to 52-1104 (force-close). When false, any residual
   * stays outstanding (installment remains PARTIALLY_PAID).
   */
  isFinalReceipt: boolean;
}

export interface SplitReceiptResult {
  /** Cr 11-2103 — principal cleared this receipt (incl. an absorbed final ≤1฿ residual). */
  principalCleared: Decimal;
  /** Cr 42-1103 — late fee booked this receipt. */
  lateFeePortion: Decimal;
  /** Cr 53-1503 — overpay rounding (≥0). >1฿ signals a tolerance breach for the template. */
  overpayRounding: Decimal;
  /** Dr 52-1104 — underpay close (≥0, ≤1฿, final receipt only). */
  underpayRounding: Decimal;
  /** Outstanding principal after this receipt (0 when fully cleared). */
  principalRemainingAfter: Decimal;
}

/**
 * Pure per-receipt allocation. No Nest, no DB, no throw — tolerance/approver
 * enforcement lives in PaymentReceiptTemplate so this stays a unit-testable
 * money-math function (mirrors computeInstallmentBreakdown).
 */
export function splitReceipt(input: SplitReceiptInput): SplitReceiptResult {
  const zero = new Decimal(0);
  const principalRemaining = Decimal.max(
    input.installmentTotal.minus(input.priorPrincipalCleared),
    zero,
  );
  const lateFeeRemaining = Decimal.max(input.lateFee.minus(input.priorLateFeeBooked), zero);

  // Funds to allocate = cash delta + advance consumed − surplus parked as advance.
  const available = input.delta.plus(input.advanceConsume).minus(input.advanceCredit);

  let principalCleared = Decimal.max(Decimal.min(available, principalRemaining), zero);
  const afterPrincipal = available.minus(principalCleared);
  const lateFeePortion = Decimal.min(Decimal.max(afterPrincipal, zero), lateFeeRemaining);
  const leftover = afterPrincipal.minus(lateFeePortion); // ≥ 0 by construction

  let overpayRounding = leftover;
  let underpayRounding = zero;
  let principalRemainingAfter = principalRemaining.minus(principalCleared);

  // Final-receipt underpay close: a small residual ≤1฿ is absorbed by 52-1104 so
  // the receivable clears exactly. Only when nothing is left over (no overpay).
  if (
    input.isFinalReceipt &&
    leftover.eq(0) &&
    principalRemainingAfter.gt(0) &&
    principalRemainingAfter.lte(TOLERANCE)
  ) {
    underpayRounding = principalRemainingAfter;
    principalCleared = principalCleared.plus(principalRemainingAfter); // full clear
    principalRemainingAfter = zero;
    overpayRounding = zero;
  }

  return { principalCleared, lateFeePortion, overpayRounding, underpayRounding, principalRemainingAfter };
}
```

- [ ] **Step 4: Run the spec — verify it passes**

Run: `cd apps/api && npx jest --runInBand split-receipt`
Expected: PASS — 9 passing.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/journal/split-receipt.ts apps/api/src/modules/journal/split-receipt.spec.ts
git commit -m "feat(payments): pure splitReceipt() per-receipt JE allocation (PR-843/I2 Phase 2)"
```

---

### Task 2: `PaymentReceiptTemplate` (reconstruction + JE post)

**Files:**
- Create: `apps/api/src/modules/journal/cpa-templates/payment-receipt.template.ts`

- [ ] **Step 1: Write the template**

Create `apps/api/src/modules/journal/cpa-templates/payment-receipt.template.ts`:

```ts
import { Injectable, BadRequestException, Optional } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { JournalAutoService } from '../journal-auto.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { AccountRoleService } from '../account-role.service';
import { computeInstallmentBreakdown } from '../compute-installment-breakdown';
import { splitReceipt, SplitReceiptResult } from '../split-receipt';

const TOLERANCE = new Decimal('1.00');

export interface PaymentReceiptPrimitiveInput {
  installmentScheduleId: string;
  /** Cash (or customer-credit) received THIS receipt for THIS installment. */
  delta: Decimal;
  /** Cash code (11-11xx / 11-12xx) OR '21-5101' for the credit-balance path. */
  debitAccountCode: string;
  /** Total late fee owed on this installment (default 0). */
  lateFee?: Decimal;
  /** Existing 21-1103 advance consumed to supplement delta (default 0). */
  advanceConsume?: Decimal;
  /** Surplus parked as new 21-1103 advance (default 0). */
  advanceCredit?: Decimal;
  /** True when this receipt closes the installment (enables ≤1฿ underpay close). */
  isFinalReceipt?: boolean;
  /** Required when the final receipt underpays by ≤1฿ (52-1104 route). */
  toleranceApproverId?: string;
  /** Caller-owned Payment row id → JE reference. Omitted → generated UUID. */
  paymentId?: string;
}

/**
 * PaymentReceiptTemplate — the single "post a receipt for delta X" primitive
 * (PR-843 / I2). Generalises the applyCreditBalance custom-delta JE + the
 * 2B-split sumPriorPartials reconstruction. Every receipt clears only what it
 * covers, so Σ(Cr 11-2103) per installment == installmentTotal and
 * Σ(Cr 42-1103) == lateFee for ANY receipt sequence / ANY path.
 *
 * JE:
 *   Dr debitAccountCode      delta            (skip if 0)
 *   Dr 21-1103               advanceConsume   (if > 0)
 *   Dr 52-1104               underpayRounding (final ≤1฿ close; needs approver)
 *     Cr 11-2103             principalCleared
 *     Cr 42-1103             lateFeePortion   (if > 0)
 *     Cr 53-1503             overpayRounding  (if > 0)
 *     Cr 21-1103             advanceCredit    (if > 0)
 */
@Injectable()
export class PaymentReceiptTemplate {
  constructor(
    private readonly journal: JournalAutoService,
    private readonly prisma: PrismaService,
    @Optional() private readonly roles?: AccountRoleService,
  ) {}

  /**
   * Reconstruct prior cleared amounts for this installment from its own prior
   * `tag:'receipt'` JE lines: Σ Cr 11-2103 (principal) and Σ Cr 42-1103 (late fee).
   */
  private async reconstructPrior(
    readClient: Prisma.TransactionClient | PrismaService,
    installmentScheduleId: string,
  ): Promise<{ priorPrincipalCleared: Decimal; priorLateFeeBooked: Decimal }> {
    const entries = await readClient.journalEntry.findMany({
      where: {
        AND: [
          { metadata: { path: ['tag'], equals: 'receipt' } } as any,
          {
            metadata: { path: ['installmentScheduleId'], equals: installmentScheduleId },
          } as any,
        ],
      },
      include: { lines: true },
    });
    let priorPrincipalCleared = new Decimal(0);
    let priorLateFeeBooked = new Decimal(0);
    for (const e of entries) {
      for (const l of e.lines) {
        const cr = new Decimal(l.credit.toString());
        if (l.accountCode === '11-2103') priorPrincipalCleared = priorPrincipalCleared.plus(cr);
        else if (l.accountCode === '42-1103') priorLateFeeBooked = priorLateFeeBooked.plus(cr);
      }
    }
    return { priorPrincipalCleared, priorLateFeeBooked };
  }

  async execute(
    input: PaymentReceiptPrimitiveInput,
    outerTx?: Prisma.TransactionClient,
  ): Promise<{ entryNo: string; split: SplitReceiptResult }> {
    const readClient: Prisma.TransactionClient | PrismaService = outerTx ?? this.prisma;

    const inst = await readClient.installmentSchedule.findUniqueOrThrow({
      where: { id: input.installmentScheduleId },
      include: { contract: true },
    });
    const c = inst.contract;

    const { installmentTotal } = computeInstallmentBreakdown({
      financedAmount: c.financedAmount.toString(),
      storeCommission: c.storeCommission != null ? c.storeCommission.toString() : null,
      interestTotal: c.interestTotal.toString(),
      vatAmount: c.vatAmount != null ? c.vatAmount.toString() : null,
      totalMonths: c.totalMonths,
    });

    const { priorPrincipalCleared, priorLateFeeBooked } = await this.reconstructPrior(
      readClient,
      inst.id,
    );

    const delta = input.delta;
    const lateFee = input.lateFee ?? new Decimal(0);
    const advanceConsume = input.advanceConsume ?? new Decimal(0);
    const advanceCredit = input.advanceCredit ?? new Decimal(0);

    // Precondition for splitReceipt (review I-1): funds to allocate must be ≥0.
    // A mis-computed advanceCredit must never silently produce a negative JE line.
    if (advanceCredit.gt(delta.plus(advanceConsume))) {
      throw new BadRequestException(
        `advanceCredit ${advanceCredit.toFixed(2)} exceeds available funds (delta + advanceConsume ${delta.plus(advanceConsume).toFixed(2)})`,
      );
    }

    const split = splitReceipt({
      delta,
      installmentTotal,
      lateFee,
      priorPrincipalCleared,
      priorLateFeeBooked,
      advanceConsume,
      advanceCredit,
      isFinalReceipt: input.isFinalReceipt ?? false,
    });

    // Tolerance enforcement (template-side; the pure fn stays Nest-free).
    if (split.overpayRounding.gt(TOLERANCE)) {
      throw new BadRequestException(
        `Payment difference ${split.overpayRounding.toFixed(2)} exceeds tolerance 1.00`,
      );
    }
    if ((input.isFinalReceipt ?? false) && split.principalRemainingAfter.gt(TOLERANCE)) {
      throw new BadRequestException(
        `Cannot close installment — residual ${split.principalRemainingAfter.toFixed(2)} exceeds tolerance 1.00`,
      );
    }
    if (split.underpayRounding.gt(0) && !input.toleranceApproverId) {
      throw new BadRequestException('Underpay tolerance requires approver (toleranceApproverId)');
    }

    const zero = new Decimal(0);
    const overpayCode = this.roles?.tryCode('adj_overpay') ?? '53-1503';
    const underpayCode = this.roles?.tryCode('adj_underpay') ?? '52-1104';

    const lines: { accountCode: string; dr: Decimal; cr: Decimal; description?: string }[] = [];
    if (delta.gt(0)) {
      lines.push({ accountCode: input.debitAccountCode, dr: delta, cr: zero, description: 'รับเงิน' });
    }
    if (advanceConsume.gt(0)) {
      lines.push({ accountCode: '21-1103', dr: advanceConsume, cr: zero, description: 'หักเงินรับล่วงหน้า' });
    }
    if (split.underpayRounding.gt(0)) {
      lines.push({ accountCode: underpayCode, dr: split.underpayRounding, cr: zero, description: 'ส่วนลดเศษสตางค์ (ปิดยอด)' });
    }
    if (split.principalCleared.gt(0)) {
      lines.push({ accountCode: '11-2103', dr: zero, cr: split.principalCleared, description: 'ล้างลูกหนี้ค้างชำระ' });
    }
    if (split.lateFeePortion.gt(0)) {
      lines.push({ accountCode: '42-1103', dr: zero, cr: split.lateFeePortion, description: 'ค่าปรับชำระล่าช้า' });
    }
    if (split.overpayRounding.gt(0)) {
      lines.push({ accountCode: overpayCode, dr: zero, cr: split.overpayRounding, description: 'กำไรปัดเศษ' });
    }
    if (advanceCredit.gt(0)) {
      lines.push({ accountCode: '21-1103', dr: zero, cr: advanceCredit, description: 'เงินรับล่วงหน้า' });
    }

    const result = await this.journal.createAndPost(
      {
        description: `รับชำระงวด #${inst.installmentNo} — สัญญา ${c.contractNumber}`,
        reference: input.paymentId ?? randomUUID(),
        metadata: {
          tag: 'receipt',
          contractId: c.id,
          installmentScheduleId: inst.id,
          paymentId: input.paymentId ?? null,
          deltaApplied: delta.toString(),
          principalCleared: split.principalCleared.toString(),
          lateFeePortion: split.lateFeePortion.toString(),
        },
        lines,
      },
      outerTx,
    );

    return { entryNo: result.entryNumber, split };
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `cd /Users/iamnaii/Desktop/App/BESTCHOICE && ./tools/check-types.sh api`
Expected: 0 errors (template compiles; not yet referenced anywhere).

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/modules/journal/cpa-templates/payment-receipt.template.ts
git commit -m "feat(payments): PaymentReceiptTemplate primitive — reconstruct prior + post delta JE (PR-843/I2 Phase 2)"
```

---

### Task 3: Register `PaymentReceiptTemplate` in the journal module

**Files:**
- Modify: `apps/api/src/modules/journal/journal.module.ts` (add to `providers` near line 71 and `exports` near line 126)

- [ ] **Step 1: Add the import + provider + export**

In `apps/api/src/modules/journal/journal.module.ts`, add the import next to the other cpa-template imports:

```ts
import { PaymentReceiptTemplate } from './cpa-templates/payment-receipt.template';
```

Add `PaymentReceiptTemplate,` to the `providers` array (next to `PaymentReceipt2BSplitTemplate,`) and to the `exports` array (next to `PaymentReceipt2BSplitTemplate,`).

- [ ] **Step 2: Typecheck + boot the module graph via the existing journal unit suite**

Run: `cd apps/api && npx jest --runInBand journal --runTestsByPath src/modules/journal/split-receipt.spec.ts && cd .. && ./tools/check-types.sh api`
Expected: split-receipt PASS; 0 type errors. (Registration is DI-only; no behaviour change.)

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/modules/journal/journal.module.ts
git commit -m "chore(journal): register PaymentReceiptTemplate provider/export (PR-843/I2 Phase 2)"
```

---

### Task 4: Real-DB e2e — Σ-invariants across a multi-receipt sequence

**Files:**
- Create: `apps/api/e2e/payment-receipt-primitive.e2e-spec.ts`

This is the constraint-mandated proof: NO template mocking, real PrismaService, scoped self-cleanup, `audit_logs` never deleted. Harness mirrors `e2e/recordpayment-prior-partial.e2e-spec.ts`.

- [ ] **Step 1: Write the e2e spec**

Create `apps/api/e2e/payment-receipt-primitive.e2e-spec.ts`:

```ts
/**
 * REAL-DB e2e for the PaymentReceiptTemplate primitive (PR-843 / I2 Phase 2).
 * Proves Σ(Cr 11-2103) per installment == installmentTotal and Σ(Cr 42-1103) ==
 * lateFee across ANY receipt sequence, with NO template mocking. Harness mirrors
 * recordpayment-prior-partial.e2e-spec.ts (HAS_DB gate, scoped cleanup).
 *
 * Run:
 *   export DATABASE_URL="postgresql://iamnaii@localhost:5432/bestchoice"
 *   cd apps/api && npm run test:e2e -- payment-receipt-primitive
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../src/prisma/prisma.service';
import { JournalAutoService } from '../src/modules/journal/journal-auto.service';
import { PaymentReceiptTemplate } from '../src/modules/journal/cpa-templates/payment-receipt.template';
import { ContractActivation1ATemplate } from '../src/modules/journal/cpa-templates/contract-activation-1a.template';
import { computeInstallmentBreakdown } from '../src/modules/journal/compute-installment-breakdown';
import { seedFinanceCoa } from '../prisma/seed-coa-finance';
import { seedStandard17k12m } from '../src/modules/journal/__tests__/scenario-helpers';

const HAS_DB = !!process.env.DATABASE_URL;
const describeOrSkip = HAS_DB ? describe : describe.skip;

describeOrSkip('PaymentReceiptTemplate primitive — Σ-invariants (real DB e2e)', () => {
  let prisma: PrismaService;
  let template: PaymentReceiptTemplate;
  let contractId: string;
  let instId: string;
  let installmentTotal: Decimal;
  let createdFinanceCompanyId: string | null = null;

  const sumCredits = async (accountCode: string): Promise<Decimal> => {
    const lines = await prisma.journalLine.findMany({
      where: {
        accountCode,
        journalEntry: { metadata: { path: ['installmentScheduleId'], equals: instId } as any },
      },
      select: { credit: true },
    });
    return lines.reduce((a, l) => a.plus(new Decimal(l.credit.toString())), new Decimal(0));
  };
  const sumDebits = async (accountCode: string): Promise<Decimal> => {
    const lines = await prisma.journalLine.findMany({
      where: {
        accountCode,
        journalEntry: { metadata: { path: ['installmentScheduleId'], equals: instId } as any },
      },
      select: { debit: true },
    });
    return lines.reduce((a, l) => a.plus(new Decimal(l.debit.toString())), new Decimal(0));
  };

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    await seedFinanceCoa(prisma as any);
    await prisma.user.upsert({
      where: { email: 'admin@bestchoice.com' },
      create: { email: 'admin@bestchoice.com', password: 'x', name: 'admin', role: 'OWNER' },
      update: {},
    });
    const existingFin = await prisma.companyInfo.findFirst({
      where: { companyCode: 'FINANCE', deletedAt: null },
      select: { id: true },
    });
    if (!existingFin) {
      const fin = await prisma.companyInfo.create({
        data: {
          nameTh: 'E2E Finance Co.',
          taxId: '9999999999998',
          companyCode: 'FINANCE',
          address: '1 E2E Rd.',
          directorName: 'E2E Director',
          vatRegistered: true,
          vatRate: '0.0700',
        },
      });
      createdFinanceCompanyId = fin.id;
    }
    const c = await seedStandard17k12m(prisma as any);
    contractId = c.id;
    const journal = new JournalAutoService(prisma as any);
    await new ContractActivation1ATemplate(journal, prisma as any).execute(c.id);
    const inst = await prisma.installmentSchedule.findFirstOrThrow({
      where: { contractId: c.id, installmentNo: 1 },
    });
    instId = inst.id;
    installmentTotal = computeInstallmentBreakdown({
      financedAmount: c.financedAmount.toString(),
      storeCommission: c.storeCommission != null ? c.storeCommission.toString() : null,
      interestTotal: c.interestTotal.toString(),
      vatAmount: c.vatAmount != null ? c.vatAmount.toString() : null,
      totalMonths: c.totalMonths,
    }).installmentTotal;
    template = new PaymentReceiptTemplate(journal, prisma as any);
  }, 120_000);

  afterAll(async () => {
    if (!prisma) return;
    const step = async (fn: () => Promise<unknown>) => {
      try { await fn(); } catch { /* best-effort */ }
    };
    try {
      if (!contractId) return;
      const jes = await prisma.journalEntry.findMany({
        where: {
          OR: [
            { referenceId: contractId },
            { metadata: { path: ['contractId'], equals: contractId } as any },
          ],
        },
        select: { id: true },
      });
      const ids = jes.map((e) => e.id);
      if (ids.length) {
        await step(() => prisma.journalLine.deleteMany({ where: { journalEntryId: { in: ids } } }));
        await step(() => prisma.journalEntry.deleteMany({ where: { id: { in: ids } } }));
      }
      // audit_logs is IMMUTABLE — never deleted.
      await step(() => prisma.payment.deleteMany({ where: { contractId } }));
      await step(() => prisma.installmentSchedule.deleteMany({ where: { contractId } }));
      await step(() => prisma.contract.deleteMany({ where: { id: contractId } }));
      if (createdFinanceCompanyId) {
        await step(() => prisma.companyInfo.deleteMany({ where: { id: createdFinanceCompanyId! } }));
      }
    } finally {
      await prisma.$disconnect();
    }
  }, 120_000);

  it('partial → partial → completion: Σ(Cr 11-2103) == installmentTotal, every receipt ledgered', async () => {
    const remainder = installmentTotal.minus(500).minus(600); // 3rd receipt closes it
    await template.execute({ installmentScheduleId: instId, delta: new Decimal('500'), debitAccountCode: '11-1101' });
    await template.execute({ installmentScheduleId: instId, delta: new Decimal('600'), debitAccountCode: '11-1101' });
    const third = await template.execute({
      installmentScheduleId: instId,
      delta: remainder,
      debitAccountCode: '11-1101',
      isFinalReceipt: true,
    });

    // 3 distinct receipt JEs (no completion re-clears the whole installment).
    const jeCount = await prisma.journalEntry.count({
      where: { metadata: { path: ['installmentScheduleId'], equals: instId } as any },
    });
    expect(jeCount).toBe(3);

    const credited = await sumCredits('11-2103');
    expect(credited.toFixed(2)).toBe(installmentTotal.toFixed(2)); // credited exactly once per baht
    expect(third.split.principalRemainingAfter.toFixed(2)).toBe('0.00');
  }, 120_000);
});
```

- [ ] **Step 2: Run the e2e — verify GREEN**

Run:
```bash
export DATABASE_URL="postgresql://iamnaii@localhost:5432/bestchoice"
cd apps/api && npm run test:e2e -- payment-receipt-primitive
```
Expected: PASS — `jeCount == 3`, `Σ(Cr 11-2103) == installmentTotal`. (If `DATABASE_URL` is unset the suite is `describe.skip` — set it to run for real.)

- [ ] **Step 3: Commit**

```bash
git add apps/api/e2e/payment-receipt-primitive.e2e-spec.ts
git commit -m "test(e2e): PaymentReceiptTemplate Σ-invariant across partial→partial→complete (PR-843/I2 Phase 2)"
```

---

### Task 5: Real-DB e2e — late fee, overpay surplus, underpay close

**Files:**
- Modify: `apps/api/e2e/payment-receipt-primitive.e2e-spec.ts` (add 3 `it()` blocks; reuse a fresh installment per case)

- [ ] **Step 1: Add a fresh-installment helper + the 3 cases**

Add inside the `describeOrSkip` block (each case uses a different `installmentNo` to keep reconstruction isolated; point `instId` at it via a small helper):

```ts
  const useInstallment = async (installmentNo: number) => {
    const inst = await prisma.installmentSchedule.findFirstOrThrow({
      where: { contractId, installmentNo },
    });
    instId = inst.id;
  };

  it('late fee: delta = installmentTotal + 100 books Cr 42-1103 == 100, no throw', async () => {
    await useInstallment(2);
    await template.execute({
      installmentScheduleId: instId,
      delta: installmentTotal.plus(100),
      lateFee: new Decimal('100'),
      debitAccountCode: '11-1101',
      isFinalReceipt: true,
    });
    expect((await sumCredits('11-2103')).toFixed(2)).toBe(installmentTotal.toFixed(2));
    expect((await sumCredits('42-1103')).toFixed(2)).toBe('100.00');
  }, 120_000);

  it('over-collection beyond tolerance with no advanceCredit → rejects (surplus never silently dropped)', async () => {
    await useInstallment(3);
    await expect(
      template.execute({
        installmentScheduleId: instId,
        delta: installmentTotal.plus(50), // 50฿ surplus, not parked
        debitAccountCode: '11-1101',
        isFinalReceipt: true,
      }),
    ).rejects.toThrow(/exceeds tolerance 1\.00/i);
  }, 120_000);

  it('over-collection parked as advanceCredit → Cr 21-1103 == surplus, clean clear', async () => {
    await useInstallment(4);
    await template.execute({
      installmentScheduleId: instId,
      delta: installmentTotal.plus(50),
      advanceCredit: new Decimal('50'),
      debitAccountCode: '11-1101',
      isFinalReceipt: true,
    });
    expect((await sumCredits('11-2103')).toFixed(2)).toBe(installmentTotal.toFixed(2));
    expect((await sumCredits('21-1103')).toFixed(2)).toBe('50.00');
  }, 120_000);

  it('final underpay 0.01 with approver → Dr 52-1104 == 0.01, installment fully cleared', async () => {
    await useInstallment(5);
    await template.execute({
      installmentScheduleId: instId,
      delta: installmentTotal.minus(new Decimal('0.01')),
      debitAccountCode: '11-1101',
      isFinalReceipt: true,
      toleranceApproverId: (await prisma.user.findFirstOrThrow({ where: { email: 'admin@bestchoice.com' } })).id,
    });
    expect((await sumCredits('11-2103')).toFixed(2)).toBe(installmentTotal.toFixed(2));
    expect((await sumDebits('52-1104')).toFixed(2)).toBe('0.01');
  }, 120_000);
```

- [ ] **Step 2: Run the full e2e — verify GREEN**

Run:
```bash
export DATABASE_URL="postgresql://iamnaii@localhost:5432/bestchoice"
cd apps/api && npm run test:e2e -- payment-receipt-primitive
```
Expected: PASS — all 5 cases green.

- [ ] **Step 3: Commit**

```bash
git add apps/api/e2e/payment-receipt-primitive.e2e-spec.ts
git commit -m "test(e2e): PaymentReceiptTemplate late-fee/overpay/underpay-close cases (PR-843/I2 Phase 2)"
```

---

### Task 6: Phase gate — adversarial review + accountant sign-off + PR

- [ ] **Step 1: Full type + unit gate**

Run: `cd /Users/iamnaii/Desktop/App/BESTCHOICE && ./tools/check-types.sh api && cd apps/api && npx jest --runInBand split-receipt`
Expected: 0 type errors; split-receipt PASS.

- [ ] **Step 2: Adversarial self-review against the invariant**

Re-read every JE branch in `payment-receipt.template.ts` and confirm, line by line: for each path that can run, Dr total == Cr total, and `Σ(Cr 11-2103) per installment` can never exceed `installmentTotal`. Confirm the `overpayRounding > 1฿` reject + the `isFinalReceipt && residual > 1฿` reject + the underpay-approver reject all fire before `createAndPost`. (Use superpowers:requesting-code-review for a second set of eyes.)

- [ ] **Step 3: Accountant sign-off (BLOCKING — regulated, TFRS for NPAEs)**

Present the JE treatment table from the "Accounting treatment" section above to the accountant. Do NOT open the PR for merge until signed off (`main` auto-deploys to prod).

- [ ] **Step 4: Open the PR**

```bash
git push -u origin feat/payment-receipt-primitive
gh pr create --title "PR-843/I2 Phase 2 — PaymentReceiptTemplate primitive (dormant)" \
  --body "Shared per-receipt JE primitive + pure splitReceipt() + real-DB e2e Σ-invariants. No existing path changed — template is dormant until Phase 3 migration. Accountant-signed-off JE treatment in docs/superpowers/plans/2026-06-09-payment-receipt-primitive.md."
```

---

## Self-Review

**Spec coverage:** Primitive form = new cpa-template ✓ (Task 2). Pure allocation per the brief's formula ✓ (Task 1). Reconstruct prior from JE lines ✓ (`reconstructPrior`). Parameterized debit account (cash | 21-5101) ✓ (`debitAccountCode`). Advance legs ✓ (`advanceConsume`/`advanceCredit`). outerTx-aware ✓. lateFee→42-1103 ✓. rounding→53-1503/52-1104 ✓. Σ-invariants proven on real DB ✓ (Tasks 4–5). No existing-path edits (safe auto-deploy) ✓ (Scope). Accountant gate ✓ (Task 6).

**Deferred to Phase 3 (documented, not gaps):** migrating the 5 callers; legacy `2B`-partial reconstruction interop for installments mid-flight at deploy; flipping `recordpayment-prior-partial.e2e-spec.ts`; `paysolutions.callback-money.spec.ts` update.

**Type consistency:** `splitReceipt` returns `{ principalCleared, lateFeePortion, overpayRounding, underpayRounding, principalRemainingAfter }` — same names used in the template's line assembly and both spec files. `execute()` returns `{ entryNo, split }`; e2e reads `.split.principalRemainingAfter`. `createAndPost(input, outerTx)` matches the live signature (`{ description, reference, metadata, lines }`, lines use `dr`/`cr`).
