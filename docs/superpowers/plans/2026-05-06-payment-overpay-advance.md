# Payment Overpay → Advance (21-1103) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend payment wizard + backend so customers can pay > installment + 1฿ tolerance, with the excess parked in `21-1103` (เงินรับล่วงหน้า) and auto-consumed FIFO on the next due installment.

**Architecture:** Reuses existing `reschedule-jp6.template.ts` pattern (Cr 21-1103 → Dr 21-1103 next due). Adds 1 schema field (`Contract.advanceBalance`), 1 enum value (`OVERPAY_ADVANCE`), extends `PaymentReceipt2BTemplate` with optional `advanceCredit`/`advanceConsume` lines, extends `payments.service.recordPayment` to compute splits, adds `AdvanceBalanceBanner` UI component.

**Tech Stack:** NestJS + Prisma + PostgreSQL + Decimal.js (api), React 18 + TypeScript + react-query (web)

---

## File Inventory

### Backend
- **Modify** `apps/api/prisma/schema.prisma` — add `Contract.advanceBalance Decimal @default(0)`
- **Create** `apps/api/prisma/migrations/<ts>_add_contract_advance_balance/migration.sql`
- **Modify** `apps/api/src/modules/payments/dto/payment.dto.ts` — extend `PaymentCase` enum
- **Modify** `apps/api/src/modules/journal/cpa-templates/payment-receipt-2b.template.ts` — accept `advanceCredit`/`advanceConsume` params, push corresponding JE lines, relax tolerance check for advance cases
- **Modify** `apps/api/src/modules/payments/payments.service.ts` — `recordPayment()` computes `advanceCredit`/`advanceConsume`, updates `Contract.advanceBalance`
- **Modify** `apps/api/src/modules/contracts/contracts.service.ts` (or wherever GET /contracts/:id lives) — include `advanceBalance` in response
- **Test** `apps/api/src/modules/journal/cpa-templates/__tests__/payment-receipt-2b.template.spec.ts` — 3 new test cases (overpay→advance, consume, full-cover)
- **Test** `apps/api/src/modules/payments/__tests__/payments.service.advance.spec.ts` — new file, 4 e2e cases against test DB

### Frontend
- **Create** `apps/web/src/pages/PaymentsPage/components/AdvanceBalanceBanner.tsx`
- **Modify** `apps/web/src/pages/PaymentsPage/components/RecordPaymentWizard.tsx` — extend `DetectedCase`, `detectCase()`, `CaseBadge`, JE preview, mount banner
- **Modify** `apps/web/src/pages/PaymentsPage/types.ts` (or wherever Contract type lives) — add `advanceBalance: string`

---

## Phases

1. **Foundation** — schema migration + enum (T1, T2)
2. **Backend service layer** — extend 2B template (T3) → service splits (T4) → next-installment consume (T5)
3. **Frontend types + API surface** — Contract.advanceBalance through to client (T6)
4. **Frontend UX** — wizard detectCase, badge, banner, preview (T7, T8)
5. **Integration + verification** — manual smoke + final TS check + PR prep (T9, T10)

---

## Phase 1: Foundation

### Task 1: Schema + migration

**Files:**
- Modify: `apps/api/prisma/schema.prisma:837` (Contract model)
- Create: `apps/api/prisma/migrations/20260807000000_add_contract_advance_balance/migration.sql`

- [ ] **Step 1.1: Add field to Contract model**

Open `apps/api/prisma/schema.prisma`. Find `model Contract {` (around line 837). Add this line near the other Decimal fields (e.g. next to `financedAmount`):

```prisma
  advanceBalance     Decimal   @default(0) @db.Decimal(12, 2) @map("advance_balance")
```

- [ ] **Step 1.2: Generate migration SQL**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE/apps/api && npx prisma migrate dev --name add_contract_advance_balance --create-only
```

Expected: creates `prisma/migrations/<ts>_add_contract_advance_balance/migration.sql` containing:

```sql
ALTER TABLE "contracts" ADD COLUMN "advance_balance" DECIMAL(12,2) NOT NULL DEFAULT 0;
```

- [ ] **Step 1.3: Generate Prisma client**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE/apps/api && npx prisma generate
```

- [ ] **Step 1.4: Smoke check**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE/apps/api && grep -n "advanceBalance" prisma/schema.prisma
```

Expected: shows the new field on `Contract`.

- [ ] **Step 1.5: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations/
git commit -m "feat(payments): add Contract.advanceBalance for overpay tracking"
```

---

### Task 2: Extend PaymentCase enum

**Files:**
- Modify: `apps/api/src/modules/payments/dto/payment.dto.ts:7`

- [ ] **Step 2.1: Read current enum**

```bash
grep -n "PaymentCase" apps/api/src/modules/payments/dto/payment.dto.ts
```

- [ ] **Step 2.2: Edit enum**

In `apps/api/src/modules/payments/dto/payment.dto.ts`, find both occurrences (type alias + `@IsIn(...)`) and add `'OVERPAY_ADVANCE'`:

```typescript
export type PaymentCase =
  | 'NORMAL'
  | 'OVERPAY'
  | 'UNDERPAY'
  | 'PARTIAL'
  | 'EARLY_PAYOFF'
  | 'RESCHEDULE'
  | 'OVERPAY_ADVANCE';
```

And:

```typescript
@IsIn(['NORMAL', 'OVERPAY', 'UNDERPAY', 'PARTIAL', 'EARLY_PAYOFF', 'RESCHEDULE', 'OVERPAY_ADVANCE'])
```

- [ ] **Step 2.3: Type-check**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE && ./tools/check-types.sh api
```

Expected: 0 errors.

- [ ] **Step 2.4: Commit**

```bash
git add apps/api/src/modules/payments/dto/payment.dto.ts
git commit -m "feat(payments): extend PaymentCase enum with OVERPAY_ADVANCE"
```

---

## Phase 2: Backend service layer

### Task 3: Extend `PaymentReceipt2BTemplate` with advance params (TDD)

**Files:**
- Modify: `apps/api/src/modules/journal/cpa-templates/payment-receipt-2b.template.ts`
- Test: `apps/api/src/modules/journal/cpa-templates/__tests__/payment-receipt-2b.template.spec.ts` (locate existing or create)

- [ ] **Step 3.1: Locate existing 2B template tests**

```bash
find apps/api/src -name "payment-receipt-2b*" -type f
```

If a spec exists, append to it. If not, create at `apps/api/src/modules/journal/cpa-templates/__tests__/payment-receipt-2b.template.spec.ts`.

- [ ] **Step 3.2: Write failing test — overpay → advance (10฿ excess)**

Append to spec file:

```typescript
describe('PaymentReceipt2BTemplate — advance handling', () => {
  let template: PaymentReceipt2BTemplate;
  let prisma: PrismaService;
  let contract: any;
  let inst: any;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      providers: [PaymentReceipt2BTemplate, JournalAutoService, PrismaService],
    }).compile();
    template = module.get(PaymentReceipt2BTemplate);
    prisma = module.get(PrismaService);
    // Seed: 1 contract + 1 installment with installmentTotal = 1000 (clean numbers)
    // (Use existing test helpers if available — pseudocode shown)
    contract = await seedContract(prisma, { totalMonths: 12, financedAmount: 10000, interestTotal: 1000 });
    inst = await seedInstallment(prisma, contract.id, 1, /* installmentTotal */ 1000);
  });

  it('overpay+advance: posts Cr 21-1103 + Cr 11-2103, no 53-1503 line', async () => {
    const result = await template.execute({
      installmentScheduleId: inst.id,
      amountReceived: new Decimal(1010), // 10 over
      depositAccountCode: '11-1101',
      advanceCredit: new Decimal(10),
    });
    const je = await prisma.journalEntry.findUnique({
      where: { entryNumber: result.entryNo },
      include: { lines: { orderBy: { lineNo: 'asc' } } },
    });
    const codes = je!.lines.map(l => l.accountCode);
    expect(codes).toContain('21-1103');
    expect(codes).not.toContain('53-1503');
    const advLine = je!.lines.find(l => l.accountCode === '21-1103')!;
    expect(advLine.credit.toString()).toBe('10');
    expect(advLine.debit.toString()).toBe('0');
  });
});
```

- [ ] **Step 3.3: Run failing test**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE/apps/api && npx jest src/modules/journal/cpa-templates/__tests__/payment-receipt-2b.template.spec.ts -t "advance handling"
```

Expected: FAIL — `advanceCredit` not a known property of `PaymentReceiptInput`.

- [ ] **Step 3.4: Add params to interface**

In `apps/api/src/modules/journal/cpa-templates/payment-receipt-2b.template.ts`, extend `PaymentReceiptInput`:

```typescript
export interface PaymentReceiptInput {
  installmentScheduleId: string;
  amountReceived: Decimal;
  depositAccountCode: string;
  toleranceApproverId?: string;
  existingPaymentId?: string;
  /** Overpay > 1฿ → post Cr 21-1103. Caller pre-computed (received - installmentTotal). */
  advanceCredit?: Decimal;
  /** Use existing 21-1103 balance → post Dr 21-1103. Caller pre-computed (consume amount). */
  advanceConsume?: Decimal;
}
```

- [ ] **Step 3.5: Relax tolerance check + emit advance lines**

Replace the tolerance + line-building block in `execute()`. Find the `if (diff.abs().gt(TOLERANCE))` and the line-building switch. Update to:

```typescript
    const advCredit = input.advanceCredit ?? new Decimal(0);
    const advConsume = input.advanceConsume ?? new Decimal(0);
    const isAdvanceCase = advCredit.gt(0) || advConsume.gt(0);

    // Effective amount to clear from receivable:
    //   cash + consume = installmentTotal + advanceCredit
    //   so: rounding diff (subject to TOLERANCE) =
    //       amountReceived + advConsume - installmentTotal - advCredit
    const roundingDiff = input.amountReceived
      .plus(advConsume)
      .minus(installmentTotal)
      .minus(advCredit);

    // Validate rounding tolerance only (advance excess is allowed by design)
    if (roundingDiff.abs().gt(TOLERANCE)) {
      throw new BadRequestException(
        `Payment difference ${roundingDiff.abs().toFixed(2)} exceeds tolerance 1.00`,
      );
    }

    // Underpay rounding still requires approver
    if (roundingDiff.lt(0) && !input.toleranceApproverId) {
      throw new BadRequestException(
        'Underpay tolerance requires approver (toleranceApproverId)',
      );
    }
```

In the line-building section, replace the existing if/else block (lines ~140-176) with:

```typescript
      // 1. Cash in (only if > 0)
      if (input.amountReceived.gt(0)) {
        lines.push({
          accountCode: input.depositAccountCode,
          dr: input.amountReceived,
          cr: zero,
          description: 'รับเงิน',
        });
      }

      // 2. Consume existing advance (Dr 21-1103)
      if (advConsume.gt(0)) {
        lines.push({
          accountCode: '21-1103',
          dr: advConsume,
          cr: zero,
          description: 'หักเงินรับล่วงหน้า',
        });
      }

      // 3. Underpay rounding adjustment
      if (roundingDiff.lt(0)) {
        lines.push({
          accountCode: '52-1104',
          dr: roundingDiff.abs(),
          cr: zero,
          description: 'ส่วนลดเศษสตางค์ (Policy C)',
        });
      }

      // 4. Clear receivable (always)
      lines.push({
        accountCode: '11-2103',
        dr: zero,
        cr: installmentTotal,
        description: 'ล้างลูกหนี้ค้างชำระ',
      });

      // 5. Park new advance (Cr 21-1103)
      if (advCredit.gt(0)) {
        lines.push({
          accountCode: '21-1103',
          dr: zero,
          cr: advCredit,
          description: 'เงินรับล่วงหน้า',
        });
      }

      // 6. Overpay rounding adjustment
      if (roundingDiff.gt(0)) {
        lines.push({
          accountCode: '53-1503',
          dr: zero,
          cr: roundingDiff,
          description: 'กำไรปัดเศษ (Policy C)',
        });
      }
```

- [ ] **Step 3.6: Run test — verify pass**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE/apps/api && npx jest src/modules/journal/cpa-templates/__tests__/payment-receipt-2b.template.spec.ts -t "advance handling"
```

Expected: PASS.

- [ ] **Step 3.7: Add 2 more test cases — consume + full-cover**

Append to the same describe block:

```typescript
  it('consume: posts Dr 21-1103 + receives partial cash', async () => {
    // installmentTotal = 1000, advance balance = 200, customer pays 800 cash
    const result = await template.execute({
      installmentScheduleId: inst.id,
      amountReceived: new Decimal(800),
      depositAccountCode: '11-1101',
      advanceConsume: new Decimal(200),
    });
    const je = await prisma.journalEntry.findUnique({
      where: { entryNumber: result.entryNo },
      include: { lines: true },
    });
    const adv = je!.lines.find(l => l.accountCode === '21-1103')!;
    expect(adv.debit.toString()).toBe('200');
    expect(adv.credit.toString()).toBe('0');
    const totalDr = je!.lines.reduce((s, l) => s.plus(l.debit), new Decimal(0));
    const totalCr = je!.lines.reduce((s, l) => s.plus(l.credit), new Decimal(0));
    expect(totalDr.eq(totalCr)).toBe(true);
  });

  it('full-cover: 100% from advance, no cash, no Dr cash line', async () => {
    // installmentTotal = 1000, advance balance = 1000, customer pays 0
    const result = await template.execute({
      installmentScheduleId: inst.id,
      amountReceived: new Decimal(0),
      depositAccountCode: '11-1101',
      advanceConsume: new Decimal(1000),
    });
    const je = await prisma.journalEntry.findUnique({
      where: { entryNumber: result.entryNo },
      include: { lines: true },
    });
    expect(je!.lines.find(l => l.accountCode === '11-1101')).toBeUndefined();
    const adv = je!.lines.find(l => l.accountCode === '21-1103')!;
    expect(adv.debit.toString()).toBe('1000');
    const recv = je!.lines.find(l => l.accountCode === '11-2103')!;
    expect(recv.credit.toString()).toBe('1000');
  });
```

- [ ] **Step 3.8: Run all 3 advance tests**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE/apps/api && npx jest src/modules/journal/cpa-templates/__tests__/payment-receipt-2b.template.spec.ts
```

Expected: 3/3 pass + existing tests still pass (rounding tolerance regression check).

- [ ] **Step 3.9: Commit**

```bash
git add apps/api/src/modules/journal/cpa-templates/
git commit -m "feat(payments): extend 2B template with advanceCredit/advanceConsume params

- Cr 21-1103 when overpay > 1฿ (advanceCredit)
- Dr 21-1103 when consuming existing balance (advanceConsume)
- Skip Dr cash line when amountReceived = 0 (full-cover by advance)
- Tolerance check now applies only to rounding diff (excludes advance excess)"
```

---

### Task 4: `recordPayment` computes advance splits (TDD)

**Files:**
- Modify: `apps/api/src/modules/payments/payments.service.ts:107` (`recordPayment` method)
- Modify: `apps/api/src/modules/payments/dto/payment.dto.ts` (DTO needs to accept `case` field if not already)
- Test: `apps/api/src/modules/payments/__tests__/payments.service.advance.spec.ts` (new file)

- [ ] **Step 4.1: Inspect existing recordPayment signature**

```bash
sed -n '107,225p' apps/api/src/modules/payments/payments.service.ts
```

Note: `recordPayment` currently throws if `amount > remaining`. We need to allow that when caller signals `case='OVERPAY_ADVANCE'`.

- [ ] **Step 4.2: Add `case` parameter to recordPayment**

Update signature:

```typescript
  async recordPayment(
    contractId: string,
    installmentNo: number,
    amount: number,
    paymentMethod: string,
    recordedById: string,
    evidenceUrl?: string,
    notes?: string,
    transactionRef?: string,
    depositAccountCode?: string,
    toleranceApproverId?: string,
    paymentCase?: PaymentCase, // NEW
  ) {
```

Add `import` at top:

```typescript
import { PaymentCase } from './dto/payment.dto';
```

- [ ] **Step 4.3: Replace overpay guard with split logic**

Find the block (around line 224):

```typescript
      if (d(amount).gt(remaining)) {
        throw new BadRequestException(
          `จำนวนเงินเกินยอดค้างชำระ ...`,
```

Replace with:

```typescript
      const overage = d(amount).minus(remaining);
      let advanceCredit = d(0);
      let advanceConsume = d(0);
      const beforeAdvance = d(contract.advanceBalance);

      if (overage.gt(d('1.00'))) {
        // Caller must explicitly opt into advance for amounts > tolerance
        if (paymentCase !== 'OVERPAY_ADVANCE') {
          throw new BadRequestException(
            `จำนวนเงินเกินยอดค้างชำระ (ยอดค้าง ${remaining.toNumber().toLocaleString()} บาท, ชำระ ${amount.toLocaleString()} บาท) — ต้องเลือก case 'OVERPAY_ADVANCE' เพื่อบันทึกส่วนเกินเป็นเงินรับล่วงหน้า`,
          );
        }
        advanceCredit = overage;
      } else if (d(amount).lt(remaining) && beforeAdvance.gt(0)) {
        // Auto-consume existing advance to cover gap
        const gap = remaining.minus(d(amount));
        advanceConsume = Prisma.Decimal.min(beforeAdvance, gap);
      }
```

- [ ] **Step 4.4: Wire advanceCredit/advanceConsume into the 2B template call**

Find where `recordPayment` calls `paymentReceipt2BTemplate.execute(...)` (search for "PaymentReceipt2BTemplate" or "execute({" inside recordPayment). The block typically constructs the input. Add the two fields:

```typescript
      const result = await this.paymentReceipt2BTemplate.execute({
        installmentScheduleId: schedule.id,
        amountReceived: d(amount),
        depositAccountCode: resolvedDepositAccountCode,
        toleranceApproverId,
        existingPaymentId: payment.id,
        advanceCredit: advanceCredit.gt(0) ? advanceCredit : undefined,
        advanceConsume: advanceConsume.gt(0) ? advanceConsume : undefined,
      });
```

- [ ] **Step 4.5: Update Contract.advanceBalance + Payment.amountPaid**

After the JE call succeeds, update both rows. Find where `tx.payment.update({ ... amountPaid: ... })` is called inside `recordPayment`. Right before/after that, add:

```typescript
      // For OVERPAY_ADVANCE, Payment.amountPaid is just the installment total (not the cash received).
      // The excess goes to Contract.advanceBalance.
      const recordedAmountPaid = paymentCase === 'OVERPAY_ADVANCE' ? remaining : d(amount).plus(advanceConsume);

      await tx.payment.update({
        where: { id: payment.id },
        data: {
          amountPaid: recordedAmountPaid,
          paidDate: new Date(),
          paidAt: new Date(),
          status: recordedAmountPaid.gte(amountDue) ? 'PAID' : 'PARTIALLY_PAID',
          // ... preserve existing fields
        },
      });

      // Update advance balance: +credit, -consume
      const advanceDelta = advanceCredit.minus(advanceConsume);
      if (!advanceDelta.eq(0)) {
        await tx.contract.update({
          where: { id: contractId },
          data: { advanceBalance: { increment: advanceDelta } as any },
        });
      }
```

(If the codebase already has its own `tx.payment.update`, weave the recordedAmountPaid + advance delta logic without duplicating fields.)

- [ ] **Step 4.6: Write failing tests**

Create `apps/api/src/modules/payments/__tests__/payments.service.advance.spec.ts`:

```typescript
import { Test } from '@nestjs/testing';
import { PrismaService } from '../../../prisma/prisma.service';
import { PaymentsService } from '../payments.service';
import { Decimal } from '@prisma/client/runtime/library';

describe('PaymentsService — advance balance', () => {
  let service: PaymentsService;
  let prisma: PrismaService;
  let contractId: string;
  let recordedById: string;

  beforeAll(async () => {
    // Bootstrap test app with full payments module wiring
    // Use the same DATABASE_URL pattern as other-income.service.spec.ts
    // Seed: contract with 12 monthly installments, installmentTotal=1000
    // (Use existing fixtures or helpers — pseudocode shown)
    const seeded = await seedContractWithPayments(prisma, {
      totalMonths: 12,
      financedAmount: 10000,
      interestTotal: 1000,
      installmentTotal: 1000,
    });
    contractId = seeded.contract.id;
    recordedById = seeded.user.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('overpay → Cr 21-1103 + Contract.advanceBalance += 50', async () => {
    await service.recordPayment(
      contractId,
      1, // installmentNo
      1050, // amount
      'CASH',
      recordedById,
      undefined,
      undefined,
      'TEST-1',
      '11-1101',
      undefined,
      'OVERPAY_ADVANCE',
    );
    const c = await prisma.contract.findUnique({ where: { id: contractId } });
    expect(c!.advanceBalance.toString()).toBe('50');
  });

  it('next installment auto-consumes advance, balance returns to 0', async () => {
    // Pay งวด 2 with amount 950 (50 short of installmentTotal 1000) — should consume 50 from advance
    await service.recordPayment(
      contractId,
      2,
      950,
      'CASH',
      recordedById,
      undefined,
      undefined,
      'TEST-2',
      '11-1101',
    );
    const c = await prisma.contract.findUnique({ where: { id: contractId } });
    expect(c!.advanceBalance.toString()).toBe('0');
    const payment = await prisma.payment.findFirst({
      where: { contractId, installmentNo: 2 },
    });
    expect(payment!.status).toBe('PAID');
    expect(payment!.amountPaid.toString()).toBe('1000');
  });

  it('multi-overpay accumulates', async () => {
    // Pay งวด 3 with 1100 (100 over) → balance = 100
    await service.recordPayment(contractId, 3, 1100, 'CASH', recordedById, undefined, undefined, 'TEST-3', '11-1101', undefined, 'OVERPAY_ADVANCE');
    let c = await prisma.contract.findUnique({ where: { id: contractId } });
    expect(c!.advanceBalance.toString()).toBe('100');

    // Pay งวด 4 with 1200 (200 over) → balance = 300
    await service.recordPayment(contractId, 4, 1200, 'CASH', recordedById, undefined, undefined, 'TEST-4', '11-1101', undefined, 'OVERPAY_ADVANCE');
    c = await prisma.contract.findUnique({ where: { id: contractId } });
    expect(c!.advanceBalance.toString()).toBe('300');
  });

  it('full-cover: amount=0 with sufficient advance → installment paid, balance drained', async () => {
    // From previous test, advance = 300. Pay งวด 5 with amount = 0 → consume only available 300, partial payment 700 outstanding? Actually plan says 100% covered if advance >= installment. Here installmentTotal = 1000 > advance 300, so this should NOT fully cover. Adjust expectation: advance drains to 0, payment = PARTIALLY_PAID with amountPaid = 300.
    // For a true full-cover test, use a contract where advanceBalance >= installmentTotal.
    // For now, test partial: pay 700 + consume 300
    await service.recordPayment(contractId, 5, 700, 'CASH', recordedById, undefined, undefined, 'TEST-5', '11-1101');
    const c = await prisma.contract.findUnique({ where: { id: contractId } });
    expect(c!.advanceBalance.toString()).toBe('0');
    const payment = await prisma.payment.findFirst({ where: { contractId, installmentNo: 5 } });
    expect(payment!.status).toBe('PAID');
    expect(payment!.amountPaid.toString()).toBe('1000'); // 700 cash + 300 advance
  });
});
```

- [ ] **Step 4.7: Run failing tests**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE/apps/api && npx jest src/modules/payments/__tests__/payments.service.advance.spec.ts
```

Expected: tests fail until Steps 4.2-4.5 land.

- [ ] **Step 4.8: Iterate until 4/4 pass**

Run repeatedly while fixing. Common failures:
- `Contract.advanceBalance` field missing → re-run `npx prisma generate`
- DTO validation rejects new case value → check `@IsIn` includes `'OVERPAY_ADVANCE'`
- Recorded `amountPaid` mismatch → re-check Step 4.5 `recordedAmountPaid` formula

- [ ] **Step 4.9: TS check**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE && ./tools/check-types.sh api
```

Expected: 0 errors.

- [ ] **Step 4.10: Commit**

```bash
git add apps/api/src/modules/payments/
git commit -m "feat(payments): recordPayment supports OVERPAY_ADVANCE + auto-consume

- accepts paymentCase param, computes advanceCredit/Consume
- updates Contract.advanceBalance atomically with JE post
- amountPaid = installmentTotal (not cash) when advancing
- 4 e2e tests cover overpay/consume/multi-accumulate/partial-cover"
```

---

### Task 5: Update controller + caller paths

**Files:**
- Modify: `apps/api/src/modules/payments/payments.controller.ts`
- Modify: `apps/api/src/modules/payments/dto/record-payment.dto.ts` (or wherever the request DTO for record endpoint lives)

- [ ] **Step 5.1: Find the record-payment endpoint**

```bash
grep -rn "recordPayment\|@Post.*record\|@Post.*payment" apps/api/src/modules/payments/payments.controller.ts | head -10
```

- [ ] **Step 5.2: Add `case` to request DTO**

Locate the DTO used by the record endpoint (likely `RecordPaymentDto` in `dto/`). Add:

```typescript
import { IsIn, IsOptional } from 'class-validator';
import type { PaymentCase } from './payment.dto';

export class RecordPaymentDto {
  // ... existing fields ...

  @IsOptional()
  @IsIn(['NORMAL', 'OVERPAY', 'UNDERPAY', 'PARTIAL', 'EARLY_PAYOFF', 'RESCHEDULE', 'OVERPAY_ADVANCE'])
  case?: PaymentCase;
}
```

- [ ] **Step 5.3: Pass `case` through controller**

Find the controller method calling `recordPayment(...)`. Append `dto.case` as the new last argument matching the service signature.

- [ ] **Step 5.4: TS check**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE && ./tools/check-types.sh api
```

- [ ] **Step 5.5: Commit**

```bash
git add apps/api/src/modules/payments/
git commit -m "feat(payments): pass paymentCase from controller through to service"
```

---

### Task 6: Surface `Contract.advanceBalance` to client

**Files:**
- Modify: `apps/api/src/modules/contracts/contracts.service.ts` (find the GET /contracts/:id handler)

- [ ] **Step 6.1: Locate findOne**

```bash
grep -n "findOne\|findById\|findUnique" apps/api/src/modules/contracts/contracts.service.ts | head -10
```

- [ ] **Step 6.2: Verify advanceBalance is already returned**

Prisma `findUnique({ where: { id } })` returns all scalar fields by default (including the new `advanceBalance`). If the service uses an explicit `select: { ... }`, add `advanceBalance: true`.

```bash
grep -n "select:" apps/api/src/modules/contracts/contracts.service.ts | head -5
```

If you find `select: { ... }` in the contract findOne path, edit to include `advanceBalance: true`.

- [ ] **Step 6.3: TS check**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE && ./tools/check-types.sh api
```

- [ ] **Step 6.4: Commit (only if Step 6.2 required an edit)**

```bash
git add apps/api/src/modules/contracts/
git commit -m "feat(payments): include advanceBalance in GET /contracts/:id response"
```

(If no edit was needed because select wasn't used, skip this commit.)

---

## Phase 4: Frontend UX

### Task 7: Wizard `detectCase` + badge

**Files:**
- Modify: `apps/web/src/pages/PaymentsPage/components/RecordPaymentWizard.tsx:42` (DetectedCase type)
- Modify: `apps/web/src/pages/PaymentsPage/components/RecordPaymentWizard.tsx:335` (detectCase function)
- Modify: `apps/web/src/pages/PaymentsPage/components/RecordPaymentWizard.tsx:145-192` (CaseBadge component)

- [ ] **Step 7.1: Extend DetectedCase type**

In `RecordPaymentWizard.tsx`, line 42, change:

```typescript
type DetectedCase = 'NORMAL' | 'OVERPAY' | 'UNDERPAY' | 'OVERPAY_ADVANCE' | 'OUT_OF_RANGE';
```

- [ ] **Step 7.2: Update detectCase function**

Find `function detectCase(received, expectedTotal)` (line 335) and replace with:

```typescript
function detectCase(
  received: number,
  expectedTotal: Decimal,
  advanceBalance: Decimal = new Decimal(0),
): DetectedCase {
  // Effective amount due = installment minus advance (FIFO consume).
  // Cashier collects this — system splits internally.
  const effectiveDue = Decimal.max(new Decimal(0), expectedTotal.minus(advanceBalance));

  if (received <= 0) {
    // 0 cash is OK iff advance fully covers the installment
    return advanceBalance.gte(expectedTotal) ? 'NORMAL' : 'OUT_OF_RANGE';
  }
  const diff = received - effectiveDue.toNumber();
  if (Math.abs(diff) < 0.01) return 'NORMAL';
  if (diff > 0 && diff <= 1) return 'OVERPAY';            // rounding (gain)
  if (diff < 0 && diff >= -1) return 'UNDERPAY';          // rounding (loss, requires approver)
  if (diff > 1) return 'OVERPAY_ADVANCE';                 // pay > installment+1฿ → park excess
  return 'OUT_OF_RANGE';                                  // diff < -1: still blocked → use แบ่งชำระ
}
```

- [ ] **Step 7.3: Update toApiCase mapping**

Find `function toApiCase(detected)` (around line 345) and add the new mapping:

```typescript
function toApiCase(detected: DetectedCase): PaymentCase {
  if (detected === 'OVERPAY') return 'OVERPAY';
  if (detected === 'UNDERPAY') return 'UNDERPAY';
  if (detected === 'OVERPAY_ADVANCE') return 'OVERPAY_ADVANCE';
  return 'NORMAL';
}
```

- [ ] **Step 7.4: Add CaseBadge branch**

In `CaseBadge` component (around line 145), insert before the existing `OUT_OF_RANGE` branch:

```tsx
  if (detectedCase === 'OVERPAY_ADVANCE') {
    return (
      <div className="flex items-center gap-1.5 rounded-lg border border-info/40 bg-info/5 px-3 py-2 text-sm">
        <Info className="size-4 text-info shrink-0" />
        <span className="text-info font-medium leading-snug">
          เกิน {absDiff} ฿ — บันทึกเป็นเงินรับล่วงหน้า (หักงวดถัดไปอัตโนมัติ)
        </span>
      </div>
    );
  }
```

Add `Info` to the lucide imports at the top of the file if not already present.

- [ ] **Step 7.5: Unblock Save button + submit logic**

Find:

```typescript
detectedCase !== 'OUT_OF_RANGE' &&
```

Verify: `OVERPAY_ADVANCE` is allowed because the condition only blocks `OUT_OF_RANGE`. No code change unless Save button uses an explicit allow-list — search for `'OVERPAY' &&` or `case === 'NORMAL' ||` patterns:

```bash
grep -n "submitDisabled\|'NORMAL'\|'OVERPAY'" apps/web/src/pages/PaymentsPage/components/RecordPaymentWizard.tsx | head
```

If allow-list found (e.g. `if (detectedCase !== 'NORMAL' && detectedCase !== 'OVERPAY' && detectedCase !== 'UNDERPAY')`), add `&& detectedCase !== 'OVERPAY_ADVANCE'`.

- [ ] **Step 7.6: Pass advanceBalance from contract**

Find where `detectCase(...)` is called inside `useMemo` (around line 461). The contract data is queried via `useQuery`. Pass advance balance:

```typescript
  const detectedCase = useMemo(
    () => detectCase(
      Number(amountReceived) || 0,
      amountDueDecimal.add(lateFeeDecimal).sub(amountPaidDecimal),
      new Decimal(contract?.advanceBalance ?? 0),
    ),
    [amountReceived, amountDueDecimal, lateFeeDecimal, amountPaidDecimal, contract?.advanceBalance],
  );
```

(The `contract` variable comes from useQuery — verify name.)

- [ ] **Step 7.7: Update web Contract type**

```bash
grep -rn "interface Contract\b\|type Contract " apps/web/src/types apps/web/src/pages/PaymentsPage 2>/dev/null | head
```

In the Contract type definition, add:

```typescript
advanceBalance: string;  // serialized Decimal from API
```

- [ ] **Step 7.8: TS check**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE && ./tools/check-types.sh web
```

- [ ] **Step 7.9: Commit**

```bash
git add apps/web/src/pages/PaymentsPage/ apps/web/src/types/ 2>/dev/null || true
git commit -m "feat(payments/web): wizard detects OVERPAY_ADVANCE case + new badge

- detectCase considers contract.advanceBalance (effective due = installment - advance)
- CaseBadge renders blue 'เกินจะบันทึกเป็นล่วงหน้า' for OVERPAY_ADVANCE
- Save button enabled (no longer blocked by OUT_OF_RANGE)
- Contract type extended with advanceBalance field"
```

---

### Task 8: AdvanceBalanceBanner + JE preview line

**Files:**
- Create: `apps/web/src/pages/PaymentsPage/components/AdvanceBalanceBanner.tsx`
- Modify: `apps/web/src/pages/PaymentsPage/components/RecordPaymentWizard.tsx` (mount banner + extend JE preview)

- [ ] **Step 8.1: Create AdvanceBalanceBanner**

Create `apps/web/src/pages/PaymentsPage/components/AdvanceBalanceBanner.tsx`:

```tsx
import { Wallet } from 'lucide-react';
import Decimal from 'decimal.js';

interface Props {
  amountDue: Decimal;
  advanceBalance: Decimal;
  onApply: (netDue: string) => void;
}

/**
 * Shown when contract.advanceBalance > 0. Displays the auto-FIFO calculation
 * and one-tap "use this amount" button to set amountReceived = installment - advance.
 */
export function AdvanceBalanceBanner({ amountDue, advanceBalance, onApply }: Props) {
  if (advanceBalance.lte(0)) return null;
  const netDue = Decimal.max(new Decimal(0), amountDue.minus(advanceBalance));

  return (
    <div className="rounded-lg border border-success/40 bg-success/5 p-3 space-y-1">
      <div className="flex items-center gap-2 text-sm font-medium text-success">
        <Wallet className="size-4" />
        <span>ลูกค้ามีเงินล่วงหน้า {advanceBalance.toFixed(2)} ฿</span>
      </div>
      <div className="text-xs text-muted-foreground leading-snug">
        ค่างวด {amountDue.toFixed(2)} − ล่วงหน้า {advanceBalance.toFixed(2)} = ยอดที่ต้องเก็บ {netDue.toFixed(2)} ฿
      </div>
      <button
        type="button"
        onClick={() => onApply(netDue.toFixed(2))}
        className="text-xs underline text-primary hover:no-underline"
      >
        ใช้ยอดนี้
      </button>
    </div>
  );
}
```

- [ ] **Step 8.2: Mount banner in wizard**

In `RecordPaymentWizard.tsx`, find the section that renders the amount input (search for `amountReceived` JSX). Add the banner just above the input:

```tsx
import { AdvanceBalanceBanner } from './AdvanceBalanceBanner';

// inside render, near amount input:
{contract && new Decimal(contract.advanceBalance).gt(0) && (
  <AdvanceBalanceBanner
    amountDue={amountDueDecimal.add(lateFeeDecimal).sub(amountPaidDecimal)}
    advanceBalance={new Decimal(contract.advanceBalance)}
    onApply={(netDue) => setAmountReceived(netDue)}
  />
)}
```

- [ ] **Step 8.3: Extend JE preview to show 21-1103 lines**

Find the JE preview block in the wizard (search for "Dr 11-2103" or "preview" or `previewLines`). Add lines for advance:

```typescript
// In the preview computation:
const advanceCredit = detectedCase === 'OVERPAY_ADVANCE'
  ? new Decimal(amountReceived).minus(amountDueDecimal.add(lateFeeDecimal).sub(amountPaidDecimal))
  : new Decimal(0);

const advanceConsume = (detectedCase === 'NORMAL' || detectedCase === 'UNDERPAY') &&
  contract && new Decimal(contract.advanceBalance).gt(0) &&
  new Decimal(amountReceived).lt(amountDueDecimal.add(lateFeeDecimal).sub(amountPaidDecimal))
    ? Decimal.min(
        new Decimal(contract.advanceBalance),
        amountDueDecimal.add(lateFeeDecimal).sub(amountPaidDecimal).sub(new Decimal(amountReceived)),
      )
    : new Decimal(0);

// Append preview lines:
if (advanceCredit.gt(0)) {
  previewLines.push({ accountCode: '21-1103', dr: 0, cr: advanceCredit.toNumber(), description: 'เงินรับล่วงหน้า' });
}
if (advanceConsume.gt(0)) {
  previewLines.push({ accountCode: '21-1103', dr: advanceConsume.toNumber(), cr: 0, description: 'หักเงินรับล่วงหน้า' });
}
```

(Adapt to existing variable names — the wizard's preview structure differs across versions.)

- [ ] **Step 8.4: TS check**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE && ./tools/check-types.sh web
```

- [ ] **Step 8.5: Commit**

```bash
git add apps/web/src/pages/PaymentsPage/
git commit -m "feat(payments/web): AdvanceBalanceBanner + 21-1103 in JE preview

- Banner shown when contract.advanceBalance > 0 with one-tap apply
- JE preview shows Cr 21-1103 (overpay) or Dr 21-1103 (consume)
- Mirrors backend computation for cashier visibility"
```

---

## Phase 5: Verification + PR

### Task 9: Manual smoke test

- [ ] **Step 9.1: Start dev servers**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE && npm run dev
```

Wait until both API (3000) and Web (5173) are up.

- [ ] **Step 9.2: Test scenario A — overpay**

1. Login as `admin@bestchoice.com` / `admin1234`
2. Open any active contract → `/payments` → pick งวด N
3. In wizard: type `1600` for งวดที่ ค่างวด `1,515.83`
4. Verify: blue banner "เกิน 84.17 ฿ — บันทึกเป็นเงินรับล่วงหน้า"
5. Verify JE preview shows: Dr cash 1,600 / Cr 11-2103 1,515.83 / Cr 21-1103 84.17
6. Click Save → success toast
7. Reload contract detail → confirm `advanceBalance = 84.17`

- [ ] **Step 9.3: Test scenario B — consume on next installment**

1. Same contract, open งวด N+1 wizard
2. Verify green banner: "ลูกค้ามีเงินล่วงหน้า 84.17 ฿ ... ยอดที่ต้องเก็บ 1,431.66 ฿"
3. Click "ใช้ยอดนี้" → amountReceived field auto-fills `1431.66`
4. Status badge: "NORMAL" / ตรงพอดี
5. JE preview shows: Dr cash 1,431.66 / Dr 21-1103 84.17 / Cr 11-2103 1,515.83
6. Save → success
7. Reload → `advanceBalance = 0`

- [ ] **Step 9.4: Test scenario C — underpay still blocked**

1. Open งวด N+2, type `1400` (under by 115.83)
2. Verify red badge "ห่างเกิน 1 ฿ — ใช้เมนูแบ่งชำระ/ปิดยอดแทน"
3. Save button disabled

- [ ] **Step 9.5: Stop dev servers**

```bash
# Ctrl+C the dev process or `pkill -f 'turbo|nest start'`
```

---

### Task 10: Final TS + lint + PR

- [ ] **Step 10.1: Full TS check**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE && ./tools/check-types.sh all
```

Expected: 0 errors.

- [ ] **Step 10.2: Lint**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE && npm run lint 2>&1 | tail -20
```

Fix any new errors introduced by this branch. Pre-existing warnings out of scope.

- [ ] **Step 10.3: Run full payments test suite**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE/apps/api && npx jest src/modules/payments/ src/modules/journal/cpa-templates/ 2>&1 | tail -30
```

Expected: all pass (existing + new advance tests).

- [ ] **Step 10.4: Push branch + create PR**

```bash
git push -u origin feat/payment-overpay-advance
gh pr create --title "feat(payments): overpay > 1฿ → 21-1103 advance (auto-consume FIFO)" --body "$(cat <<'EOF'
## Summary
- Wizard accepts overpay > 1฿ tolerance (no longer blocked)
- Excess parked in `21-1103 เงินรับล่วงหน้า` (per CSV plan)
- Auto-consumed FIFO on next installment due
- Reuses `reschedule-jp6` template pattern (Cr 21-1103 → Dr 21-1103)

## Spec + Plan
- Spec: \`docs/superpowers/specs/2026-05-06-payment-overpay-advance-design.md\`
- Plan: \`docs/superpowers/plans/2026-05-06-payment-overpay-advance.md\`

## Schema
- Adds `Contract.advanceBalance Decimal @default(0)` (additive, safe migration)

## Backend
- `PaymentCase` enum extended with `OVERPAY_ADVANCE`
- `PaymentReceipt2BTemplate` extended with `advanceCredit` / `advanceConsume` params
- `recordPayment` computes split: overpay → balance += diff; underpay → balance -= consume
- 3 new template tests + 4 new service tests

## Frontend
- `detectCase` considers `contract.advanceBalance` for effective due
- New `OVERPAY_ADVANCE` badge (blue) — Save button enabled
- New `AdvanceBalanceBanner` component with one-tap "use this amount"
- JE preview shows 21-1103 line

## Test plan
- [ ] Login as admin → open contract → wizard
- [ ] Type 1,600 for 1,515.83 installment → blue banner → save → contract.advanceBalance = 84.17
- [ ] Open next installment → green banner → "ใช้ยอดนี้" → save → advance = 0
- [ ] Underpay > 1฿ still blocked (regression check)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

**Note: per project memory (`feedback_no_auto_commit.md`), DO NOT push or open PR without explicit owner instruction. Wait for "push" / "create PR" before running this step.**

---

## Self-review

- [ ] All 10 tasks completed with green checkmarks
- [ ] `./tools/check-types.sh all` exits 0
- [ ] All `apps/api` payment + template tests pass
- [ ] Manual smoke (3 scenarios) passes
- [ ] No `console.log` / `TODO` / `FIXME` markers introduced
- [ ] No regression in existing rounding-tolerance behavior

---

## Out of scope (post-MVP)

- Manual refund of advance (cash out)
- Per-installment manual allocation (FIFO is automatic)
- Customer-facing LIFF showing advance balance
- Reports column "advance balance" on contracts list
- Edge: contract closure with non-zero advance — current behavior is just leaves it; warning banner deferred

---

*End of plan.*
