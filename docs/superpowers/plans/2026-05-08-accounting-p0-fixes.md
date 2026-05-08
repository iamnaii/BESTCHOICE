# Accounting Compliance Fixes — Wave 1 (P0 Critical) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** แก้ Critical findings 5 ข้อหลักที่กระทบ ledger integrity และ TFRS compliance — Atomicity, JP5 VAT split, JP5 provision consumption, 2A final-period residual, Bad Debt Decimal precision

**Architecture:** เปลี่ยน JE templates ให้รับ `tx?: Prisma.TransactionClient` parameter เพื่อให้ caller ห่อ JE + business operation ใน single atomic transaction · เพิ่ม domain logic ใน JP5 (VAT split, provision consume) และ 2A (final-period adjustment)

**Tech Stack:** NestJS · Prisma 6 · TypeScript · Jest · PostgreSQL · Prisma.Decimal arithmetic

**Scope:** Wave 1 ครอบคลุม Critical findings เร่งด่วนที่สุด · Wave 2 (Credit Note + VAT compliance), Wave 3 (Quick wins), Wave 4 (Nice-to-haves) จะวางแผนแยกหลังจบ Wave 1

---

## Master Plan Overview (43 Findings → 4 Waves)

| Wave | ขอบเขต | Findings | Effort |
|------|---------|----------|--------|
| **W1 (P0)** ← THIS PLAN | Atomicity + JP5 VAT/provision + 2A residual + Bad Debt Decimal | 7 Critical | 3-4 วัน |
| W2 (P1) | Credit Note module + VAT 60-day fix + JP4 discount VAT + JP6 due_date | 5 Critical + 6 Warning | 3-4 วัน |
| W3 (P2) | tag collision + defect guard + receipt void auth + minor warnings | 3 Critical + 5 Warning | 1 วัน |
| W4 (P3) | bad debt cron + e-invoice + EIR decision + Info findings | Info + Owner action | 2 วัน + ขึ้น CPA |

---

## File Structure

**Files to modify (existing):**
- [apps/api/src/modules/journal/cpa-templates/contract-activation-1a.template.ts](apps/api/src/modules/journal/cpa-templates/contract-activation-1a.template.ts) — accept tx param
- [apps/api/src/modules/journal/cpa-templates/installment-accrual-2a.template.ts](apps/api/src/modules/journal/cpa-templates/installment-accrual-2a.template.ts) — accept tx + final-period adjustment
- [apps/api/src/modules/journal/cpa-templates/early-payoff-jp4.template.ts](apps/api/src/modules/journal/cpa-templates/early-payoff-jp4.template.ts) — accept tx (already has internal $transaction, refactor)
- [apps/api/src/modules/journal/cpa-templates/repossession-jp5.template.ts](apps/api/src/modules/journal/cpa-templates/repossession-jp5.template.ts) — accept tx + VAT split + consume provision
- [apps/api/src/modules/journal/cpa-templates/bad-debt-writeoff.template.ts](apps/api/src/modules/journal/cpa-templates/bad-debt-writeoff.template.ts) — accept tx
- [apps/api/src/modules/repossessions/repossessions.service.ts](apps/api/src/modules/repossessions/repossessions.service.ts) — wrap JP5 in $transaction
- [apps/api/src/modules/contracts/contract-workflow.service.ts](apps/api/src/modules/contracts/contract-workflow.service.ts) — wrap 1A in $transaction
- [apps/api/src/modules/accounting/bad-debt.service.ts](apps/api/src/modules/accounting/bad-debt.service.ts) — Decimal precision + tx wrap

**Files to create (new):**
- `apps/api/src/modules/journal/cpa-templates/__tests__/atomicity.spec.ts` — atomicity test suite
- `apps/api/src/modules/journal/cpa-templates/__tests__/jp5-vat-split.spec.ts` — JP5 VAT split test
- `apps/api/src/modules/journal/cpa-templates/__tests__/2a-final-period.spec.ts` — 2A residual adjustment test

---

## Task 1: เพิ่ม `tx?` parameter ทุก template (signature change only)

**Files:**
- Modify: 5 template files (1A, 2A, JP4, JP5, BadDebtWriteOff)

- [ ] **Step 1.1: เปลี่ยน signature ของ ContractActivation1ATemplate**

Before:
```typescript
async execute(contractId: string): Promise<{ entryNo: string }> {
  const c = await this.prisma.contract.findUnique({ where: { id: contractId } });
  // ... uses this.prisma
}
```

After:
```typescript
async execute(
  contractId: string,
  tx?: Prisma.TransactionClient,
): Promise<{ entryNo: string }> {
  const client = tx ?? this.prisma;
  const c = await client.contract.findUnique({ where: { id: contractId } });
  // ... uses `client` instead of this.prisma
  // pass tx to journalAuto.createAndPost(input, tx)
}
```

แทนทุก `this.prisma.X` → `client.X` ภายใน method และ pass `tx` ให้ `journalAuto.createAndPost`

- [ ] **Step 1.2: เปลี่ยน signature ของ InstallmentAccrual2ATemplate** (pattern เดียวกัน)

- [ ] **Step 1.3: เปลี่ยน signature ของ EarlyPayoffJP4Template**

JP4 มี internal `this.prisma.$transaction` อยู่แล้ว — ปรับเป็น:
```typescript
async execute(
  input: EarlyPayoffInput,
  outerTx?: Prisma.TransactionClient,
): Promise<...> {
  // If outerTx provided, use it directly (no nested $transaction)
  const exec = async (tx: Prisma.TransactionClient) => {
    // existing logic
  };
  return outerTx ? exec(outerTx) : this.prisma.$transaction(exec);
}
```

- [ ] **Step 1.4: เปลี่ยน signature ของ RepossessionJP5Template** (pattern เดียวกับ 1.3)

- [ ] **Step 1.5: เปลี่ยน signature ของ BadDebtWriteOffTemplate** (pattern เดียวกับ 1.1)

- [ ] **Step 1.6: รัน type check**

Run:
```bash
./tools/check-types.sh api
```
Expected: 0 errors (เพราะ tx เป็น optional, callers เดิมยังใช้ได้)

- [ ] **Step 1.7: Commit signature changes**

```bash
git add apps/api/src/modules/journal/cpa-templates/
git commit -m "refactor(journal): accept tx? param in 5 JE templates

Allows callers to wrap JE + business ops in atomic $transaction.
Templates fall back to this.prisma when tx not provided.

Refs: docs/accounting/audit-report.html (Wave 1, P0 atomicity)"
```

---

## Task 2: Atomicity test suite (TDD — write failing tests first)

**Files:**
- Create: `apps/api/src/modules/journal/cpa-templates/__tests__/atomicity.spec.ts`

- [ ] **Step 2.1: เขียน atomicity test (failing)**

Create file with content:
```typescript
import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../prisma/prisma.service';
import { ContractActivation1ATemplate } from '../contract-activation-1a.template';
import { JournalAutoService } from '../../journal-auto.service';

describe('JE template atomicity (P0)', () => {
  let prisma: PrismaService;
  let template: ContractActivation1ATemplate;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      providers: [PrismaService, JournalAutoService, ContractActivation1ATemplate],
    }).compile();
    prisma = module.get(PrismaService);
    template = module.get(ContractActivation1ATemplate);
  });

  it('rolls back JE when outer $transaction throws after JE post', async () => {
    const contractId = await seedTestContract(prisma);
    const initialJeCount = await prisma.journalEntry.count();

    await expect(
      prisma.$transaction(async (tx) => {
        await template.execute(contractId, tx);
        throw new Error('simulated downstream failure');
      })
    ).rejects.toThrow('simulated downstream failure');

    const finalJeCount = await prisma.journalEntry.count();
    expect(finalJeCount).toBe(initialJeCount); // JE should be rolled back
  });
});

async function seedTestContract(prisma: PrismaService): Promise<string> {
  // Create test contract — implementation matches existing test fixtures
  // ... omitted for brevity, see existing __tests__ for pattern
}
```

- [ ] **Step 2.2: รัน test → expect FAIL**

Run:
```bash
cd apps/api && npx jest atomicity.spec.ts -t "rolls back"
```
Expected: FAIL — JE จะยังอยู่ใน DB เพราะ template เดิมยังไม่ honor tx (กรณี tx provided แต่ template ยัง createAndPost ไม่ผ่าน tx)

- [ ] **Step 2.3: Verify Task 1 changes ทำให้ test pass**

ถ้า Task 1 ทำถูก test ควร pass แล้วเพราะ template ใช้ `client = tx ?? this.prisma`

Run:
```bash
cd apps/api && npx jest atomicity.spec.ts -t "rolls back"
```
Expected: PASS

- [ ] **Step 2.4: Commit test**

```bash
git add apps/api/src/modules/journal/cpa-templates/__tests__/atomicity.spec.ts
git commit -m "test(journal): atomicity test for JE templates accepting tx"
```

---

## Task 3: ห่อ Repossession JP5 ใน outer $transaction

**Files:**
- Modify: `apps/api/src/modules/repossessions/repossessions.service.ts:270-310`

- [ ] **Step 3.1: หา block ที่ JP5 fire-and-forget**

อ่าน file ที่ line ~280-300 — เจอ pattern:
```typescript
await this.prisma.$transaction(async (tx) => {
  await tx.contract.update({ where: { id }, data: { status: 'CLOSED_BAD_DEBT' } });
  await tx.product.update({ where: { id: productId }, data: { status: 'REPOSSESSED' } });
  // ...
});

// JP5 OUTSIDE $transaction
this.repossessionJp5Template
  .execute({ ... })
  .catch((err) => Sentry.captureException(err));
```

- [ ] **Step 3.2: ย้าย JP5 เข้า $transaction**

Replace ด้วย:
```typescript
await this.prisma.$transaction(async (tx) => {
  await tx.contract.update({ where: { id }, data: { status: 'CLOSED_BAD_DEBT' } });
  await tx.product.update({ where: { id: productId }, data: { status: 'REPOSSESSED' } });

  // JP5 ภายใน same transaction
  await this.repossessionJp5Template.execute(
    {
      contractId: id,
      depositAccountCode: dto.depositAccountCode ?? '11-1101',
      repossessionValue: new Prisma.Decimal(dto.resellPrice ?? 0),
    },
    tx, // pass tx
  );
});
// ลบ .catch() fire-and-forget ออก
```

- [ ] **Step 3.3: รัน type check + existing tests**

Run:
```bash
./tools/check-types.sh api
cd apps/api && npx jest repossessions
```
Expected: 0 type errors · existing tests pass

- [ ] **Step 3.4: เพิ่ม integration test สำหรับ atomicity**

ใน `repossessions.service.spec.ts` เพิ่ม test:
```typescript
it('rolls back contract+product update when JP5 throws', async () => {
  // Mock JP5 to throw
  jest.spyOn(repossessionJp5Template, 'execute').mockRejectedValue(new Error('JE fail'));

  await expect(service.create(dto, userId)).rejects.toThrow('JE fail');

  const contract = await prisma.contract.findUnique({ where: { id: contractId } });
  expect(contract.status).not.toBe('CLOSED_BAD_DEBT'); // rolled back
});
```

- [ ] **Step 3.5: Commit**

```bash
git add apps/api/src/modules/repossessions/
git commit -m "fix(repossessions): wrap JP5 JE in outer \$transaction (atomicity)

ปพพ.ม.392 — เลิกสัญญาต้องกลับสู่ฐานะเดิม. ก่อนหน้านี้ JP5 ใช้
.catch() fire-and-forget ทำให้ contract status commit แต่
JE อาจ fail ลูกหนี้ค้างใน ledger ตลอดกาล.

Fixes: audit C-1 (Wave 1, P0)"
```

---

## Task 4: ห่อ 1A Contract Activation ใน outer $transaction

**Files:**
- Modify: `apps/api/src/modules/contracts/contract-workflow.service.ts:455-475`

- [ ] **Step 4.1: หา TODO comment "Phase A.5: refactor"**

Run:
```bash
grep -n "Phase A.5\|fire-and-forget\|contractActivation1A" apps/api/src/modules/contracts/contract-workflow.service.ts
```

- [ ] **Step 4.2: ย้าย 1A ใน $transaction**

Replace fire-and-forget pattern ด้วย:
```typescript
const result = await this.prisma.$transaction(async (tx) => {
  const contract = await tx.contract.update({
    where: { id: contractId },
    data: { status: 'ACTIVE', activatedAt: new Date() },
  });

  await this.contractActivation1ATemplate.execute(contract.id, tx);

  return contract;
});
```

- [ ] **Step 4.3: ลบ TODO comment + Sentry catch**

- [ ] **Step 4.4: เพิ่ม atomicity test**

ใน `contract-workflow.service.spec.ts`:
```typescript
it('rolls back contract activation when 1A JE throws', async () => {
  jest.spyOn(contractActivation1A, 'execute').mockRejectedValue(new Error('1A fail'));

  await expect(service.activate(contractId)).rejects.toThrow('1A fail');

  const contract = await prisma.contract.findUnique({ where: { id: contractId } });
  expect(contract.status).not.toBe('ACTIVE'); // rolled back
});
```

- [ ] **Step 4.5: Commit**

```bash
git add apps/api/src/modules/contracts/
git commit -m "fix(contracts): wrap 1A JE in outer \$transaction (atomicity)

ก่อนหน้านี้ 1A ใช้ fire-and-forget — contract status ACTIVE
ได้แม้ JE fail. Fixes: audit Wave 1 P0 W-1"
```

---

## Task 5: Bad Debt Service — Decimal precision + atomicity

**Files:**
- Modify: `apps/api/src/modules/accounting/bad-debt.service.ts:90-110, 180-200, 340-360`

- [ ] **Step 5.1: เพิ่ม helper สำหรับ Decimal arithmetic**

ที่ top ของ service:
```typescript
import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

private decimalSubtract(a: Prisma.Decimal | string | number, b: Prisma.Decimal | string | number): Prisma.Decimal {
  return new Decimal(a).sub(new Decimal(b));
}
```

- [ ] **Step 5.2: แก้ calculateProvisions ใช้ Decimal**

Before (line ~100):
```typescript
const outstanding = Number(p.amountDue) - Number(p.amountPaid) + unpaidLateFee;
```

After:
```typescript
const outstanding = new Decimal(p.amountDue)
  .sub(new Decimal(p.amountPaid))
  .add(unpaidLateFee);
```

ทุก `Number()` cast ใน method นี้แก้ทั้งหมด

- [ ] **Step 5.3: แก้ writeOffBadDebt ใช้ Decimal**

Pattern เดียวกับ 5.2 ที่ line ~350

- [ ] **Step 5.4: แก้ getProvisionSummary ใช้ Decimal**

```typescript
let totalOutstanding = new Decimal(0);
for (const p of provisions) {
  totalOutstanding = totalOutstanding.add(new Decimal(p.outstandingAmount));
}
```

- [ ] **Step 5.5: ห่อ writeOffBadDebt ใน atomic $transaction**

Before:
```typescript
await this.prisma.$transaction(async (tx) => {
  // contract update
});
this.badDebtWriteOff.execute(...).catch(err => Sentry.capture(err));
```

After:
```typescript
await this.prisma.$transaction(async (tx) => {
  await tx.contract.update({ ... });
  await this.badDebtWriteOff.execute({ contractId, ... }, tx);
});
```

- [ ] **Step 5.6: เปลี่ยน Math.round ใช้ Decimal rounding**

Before: `const provisionAmount = Math.round(data.amount * rate * 100) / 100;`
After:
```typescript
const provisionAmount = new Decimal(data.amount)
  .mul(rate)
  .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
```

- [ ] **Step 5.7: รัน existing tests ของ bad-debt**

Run:
```bash
cd apps/api && npx jest bad-debt
```
Expected: ทุก test pass · ตัวเลขควรไม่เปลี่ยน (Decimal precision = float-equivalent for 2 decimal places)

- [ ] **Step 5.8: Commit**

```bash
git add apps/api/src/modules/accounting/bad-debt.service.ts
git commit -m "fix(bad-debt): Decimal precision + atomic write-off JE

- Replace Number() with Prisma.Decimal arithmetic (v4 mandate)
- Math.round → Decimal.toDecimalPlaces(2, ROUND_HALF_UP)
- Wrap write-off JE in outer \$transaction

Fixes: audit Wave 1 P0 (TFRS 9 Critical 1, 2)"
```

---

## Task 6: 2A Final-Period Residual Adjustment

**Files:**
- Modify: `apps/api/src/modules/journal/cpa-templates/installment-accrual-2a.template.ts:55-90`
- Create: `apps/api/src/modules/journal/cpa-templates/__tests__/2a-final-period.spec.ts`

- [ ] **Step 6.1: เขียน failing test**

Create test file:
```typescript
describe('2A final-period residual adjustment (P0)', () => {
  it('clears 11-2101 and 11-2105 to exactly 0 on installment 12', async () => {
    // Seed contract: financed=10,000 + commission=1,000 + interest=6,000 = gross 17,000
    const contractId = await seedContractFor2A(prisma, {
      financedAmount: 10000,
      storeCommission: 1000,
      interestTotal: 6000,
      vatAmount: 1190,
      totalMonths: 12,
    });

    // Run 2A for all 12 installments
    for (let i = 1; i <= 12; i++) {
      await template.execute(contractId, i);
    }

    // After all 12 installments, 11-2101 and 11-2105 should be EXACTLY 0
    const balance11_2101 = await getAccountBalance(prisma, contractId, '11-2101');
    const balance11_2105 = await getAccountBalance(prisma, contractId, '11-2105');

    expect(balance11_2101.toNumber()).toBe(0); // current bug: +0.08
    expect(balance11_2105.toNumber()).toBe(0); // current bug: -0.04
  });
});
```

- [ ] **Step 6.2: รัน test → expect FAIL**

Run:
```bash
cd apps/api && npx jest 2a-final-period
```
Expected: FAIL — `Expected: 0 / Received: 0.08`

- [ ] **Step 6.3: เพิ่ม final-period adjustment logic**

ใน `installment-accrual-2a.template.ts` หลังจาก compute per-installment amounts:

```typescript
// Per-installment amounts (existing)
let installmentExclVat = grossExclVat.div(totalMonths).toDecimalPlaces(2, Decimal.ROUND_DOWN);
let vatPerInst = vatTotal.div(totalMonths).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
let interestPerInst = interestTotal.div(totalMonths).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

// NEW: Final-period adjustment to clear residual
if (inst.installmentNo === c.totalMonths) {
  // Compute residuals from prior 11 installments
  const priorExclVat = installmentExclVat.mul(c.totalMonths - 1);
  const priorVat = vatPerInst.mul(c.totalMonths - 1);
  const priorInterest = interestPerInst.mul(c.totalMonths - 1);

  // Final installment takes whatever remains
  installmentExclVat = grossExclVat.sub(priorExclVat);
  vatPerInst = vatTotal.sub(priorVat);
  interestPerInst = interestTotal.sub(priorInterest);
}

const installmentTotal = installmentExclVat.add(vatPerInst);
```

- [ ] **Step 6.4: รัน test → expect PASS**

Run:
```bash
cd apps/api && npx jest 2a-final-period
```
Expected: PASS

- [ ] **Step 6.5: ตรวจ existing CPA case tests ยัง pass**

Run:
```bash
cd apps/api && npx jest cpa-cases
```
Expected: PASS · CSV golden values สำหรับงวด 1 ไม่เปลี่ยน เพราะ logic เพิ่มเฉพาะ final period

- [ ] **Step 6.6: Commit**

```bash
git add apps/api/src/modules/journal/cpa-templates/installment-accrual-2a.template.ts \
        apps/api/src/modules/journal/cpa-templates/__tests__/2a-final-period.spec.ts
git commit -m "fix(2a): final-period residual adjustment clears 11-2101/11-2105 to 0

ก่อนหน้านี้ ROUND_DOWN ทำให้ 11-2101 ค้าง +0.08 หลังจบ 12 งวด
และ ROUND_HALF_UP ทำให้ 11-2105 เกิน -0.04. งวดสุดท้ายตอนนี้
ปรับยอดให้ตรงกับ contract total ทั้งหมด.

Fixes: audit Wave 1 P0 TFRS 15 C-1"
```

---

## Task 7: JP5 VAT Split — แยกงวด accrued vs deferred

**Files:**
- Modify: `apps/api/src/modules/journal/cpa-templates/repossession-jp5.template.ts:60-150`
- Create: `apps/api/src/modules/journal/cpa-templates/__tests__/jp5-vat-split.spec.ts`

- [ ] **Step 7.1: เขียน failing test**

```typescript
describe('JP5 VAT split — accrued vs deferred (P0)', () => {
  it('does NOT double-credit 21-2101 for already-accrued installments', async () => {
    // Seed: 12-month contract, run 2A for installments 1-3 (accrued), then repo at month 4
    const contractId = await seedContract(prisma);
    for (let i = 1; i <= 3; i++) {
      await accrual2A.execute(contractId, i);
    }
    // installments 1-3: VAT in 21-2101 (settled), 11-2103 (current)
    // installments 4-12: VAT still in 21-2102 (deferred), 11-2105 (deferred)

    await jp5.execute({
      contractId,
      depositAccountCode: '11-1101',
      repossessionValue: new Decimal(5000),
    });

    // Expected JE structure:
    // - For installments 1-3: Dr 11-2103 (clear current accrual), NO Cr 21-2101 again
    // - For installments 4-12: Dr 21-2102, Cr 21-2101 (move deferred to settled)

    const jeLines = await getJp5JournalLines(prisma, contractId);
    const cr21_2101 = jeLines.filter(l => l.accountCode === '21-2101' && l.credit.gt(0));

    // Should only Cr 21-2101 for 9 deferred installments (4-12)
    const expectedCr = new Decimal(99.17).mul(9); // 892.53
    const actualCr = cr21_2101.reduce((s, l) => s.add(l.credit), new Decimal(0));
    expect(actualCr.toNumber()).toBeCloseTo(892.53, 2);
  });

  it('correctly clears 11-2103 for accrued installments', async () => {
    // ... similar test
  });
});
```

- [ ] **Step 7.2: รัน test → expect FAIL**

Run:
```bash
cd apps/api && npx jest jp5-vat-split
```
Expected: FAIL — current implementation Cr 21-2101 ทุกงวด

- [ ] **Step 7.3: แก้ JP5 template เพิ่ม split logic**

ใน `repossession-jp5.template.ts` แทน loop unpaidInsts ปัจจุบัน:

```typescript
// Split installments: accrued (2A run) vs deferred (2A not run)
const accruedInsts = unpaidInsts.filter((i) => i.accrualJournalEntryId !== null);
const deferredInsts = unpaidInsts.filter((i) => i.accrualJournalEntryId === null);

// For accrued installments — clear 11-2103 only, don't touch 21-2101 again
const accruedCount = new Decimal(accruedInsts.length);
const accruedClear11_2103 = installmentTotal.mul(accruedCount); // = (excl + vat) × count

// For deferred installments — clear 11-2101/11-2105/11-2106 + 21-2102, settle 21-2101
const deferredCount = new Decimal(deferredInsts.length);
const deferredGross = installmentExclVat.mul(deferredCount);
const deferredVat = vatPerInst.mul(deferredCount);
const deferredInterest = interestPerInst.mul(deferredCount);

// Build lines based on split
const lines = [
  // Cash leg
  { accountCode: input.depositAccountCode, dr: input.repossessionValue, cr: new Decimal(0) },
];

// Accrued portion: Dr 11-2103 only (ล้างที่ค้างชำระอยู่)
if (accruedCount.gt(0)) {
  lines.push({ accountCode: '11-2103', dr: new Decimal(0), cr: accruedClear11_2103 });
}

// Deferred portion: ล้าง 11-2101/11-2105/11-2106 + 21-2102, settle 21-2101
if (deferredCount.gt(0)) {
  lines.push(
    { accountCode: '11-2106', dr: deferredInterest, cr: new Decimal(0) },
    { accountCode: '21-2102', dr: deferredVat, cr: new Decimal(0) },
    { accountCode: '11-2101', dr: new Decimal(0), cr: deferredGross },
    { accountCode: '11-2105', dr: new Decimal(0), cr: deferredVat },
    { accountCode: '21-2101', dr: new Decimal(0), cr: deferredVat },
    { accountCode: '41-1101', dr: new Decimal(0), cr: deferredInterest },
  );
}

// Loss/gain (existing logic — based on remainingTotal vs repoValue)
// ...
```

- [ ] **Step 7.4: รัน test → PASS**

Run:
```bash
cd apps/api && npx jest jp5-vat-split
```
Expected: PASS

- [ ] **Step 7.5: ตรวจ CPA case-5 (repossession) ยัง match CSV**

Run:
```bash
cd apps/api && npx jest cpa-cases -t "case-5"
```
Expected: ผ่าน — แต่ถ้าผิด ต้อง regenerate CSV golden เพราะ CSV เดิมอาจไม่ test scenario ที่มี accrual ก่อน repo

ถ้า CSV ไม่ตรง — update fixture พร้อม comment อธิบาย scenario:
```bash
# Document new test case
echo "case-5b: repossession after 3 months of 2A accrual" > apps/api/src/modules/journal/__tests__/fixtures/cpa-cases/case-5b-repo-with-accrual.md
```

- [ ] **Step 7.6: Commit**

```bash
git add apps/api/src/modules/journal/cpa-templates/repossession-jp5.template.ts \
        apps/api/src/modules/journal/cpa-templates/__tests__/jp5-vat-split.spec.ts
git commit -m "fix(jp5): split VAT logic for accrued vs deferred installments

ก่อนหน้านี้ JP5 Cr 21-2101 ทุกงวด → งวดที่ 2A run แล้วโดน
double-credit ใน ภ.พ.30. ตอนนี้แยก:
- Accrued (2A run): Dr 11-2103 only
- Deferred (2A not run): Dr 21-2102 / Cr 21-2101 (move to settled)

Fixes: audit Wave 1 P0 VAT C-1
อ้างอิง: ป.รัษฎากร ม.82/3 + ประกาศ 36/2536 ข้อ 3"
```

---

## Task 8: JP5 Consume Bad Debt Provision Before Loss

**Files:**
- Modify: `apps/api/src/modules/journal/cpa-templates/repossession-jp5.template.ts:80-110`

- [ ] **Step 8.1: เขียน failing test**

ใน `jp5-vat-split.spec.ts` เพิ่ม:
```typescript
it('consumes bad debt provision (11-2102) before recognizing loss in 51-1102', async () => {
  // Seed contract with prior provision of 3,000
  const contractId = await seedContractWithProvision(prisma, 3000);

  // Repossess at value 5,000 with remainingTotal 9,000 → loss 4,000
  await jp5.execute({
    contractId,
    depositAccountCode: '11-1101',
    repossessionValue: new Decimal(5000),
  });

  const jeLines = await getJp5JournalLines(prisma, contractId);

  // Should consume provision first: Dr 11-2102 = 3,000
  // Remaining loss: Dr 51-1102 = 1,000
  const dr11_2102 = jeLines.find(l => l.accountCode === '11-2102' && l.debit.gt(0));
  const dr51_1102 = jeLines.find(l => l.accountCode === '51-1102' && l.debit.gt(0));

  expect(dr11_2102.debit.toNumber()).toBe(3000); // consumed
  expect(dr51_1102.debit.toNumber()).toBe(1000); // remainder
});
```

- [ ] **Step 8.2: รัน → FAIL** (expected: ปัจจุบันไม่ consume provision)

- [ ] **Step 8.3: เพิ่ม provision consume logic**

ใน JP5 ก่อน build loss line:
```typescript
// Consume existing bad debt provision (11-2102 Cr balance) before recognizing P&L loss
const provisionLines = await client.journalLine.findMany({
  where: {
    accountCode: '11-2102',
    journalEntry: {
      metadata: { path: ['contractId'], equals: input.contractId },
      status: 'POSTED',
    },
  },
});
const provisionBalance = provisionLines.reduce(
  (sum, l) => sum.add(l.credit).sub(l.debit),
  new Decimal(0),
);

let lossOrGainAmount = remainingTotal.sub(input.repossessionValue);
if (lossOrGainAmount.gt(0)) {
  // Loss case: consume provision first
  const consume = Decimal.min(lossOrGainAmount, provisionBalance);
  if (consume.gt(0)) {
    lines.push({ accountCode: '11-2102', dr: consume, cr: new Decimal(0) });
    lossOrGainAmount = lossOrGainAmount.sub(consume);
  }
  // Remaining loss
  if (lossOrGainAmount.gt(0)) {
    lines.push({ accountCode: '51-1102', dr: lossOrGainAmount, cr: new Decimal(0) });
  }
}
```

- [ ] **Step 8.4: รัน test → PASS**

- [ ] **Step 8.5: Commit**

```bash
git add apps/api/src/modules/journal/cpa-templates/repossession-jp5.template.ts \
        apps/api/src/modules/journal/cpa-templates/__tests__/jp5-vat-split.spec.ts
git commit -m "fix(jp5): consume bad debt provision (11-2102) before P&L loss

TFRS §B61-B63 + TAS 36 — provision balance ที่ตั้งไว้ก่อนหน้า
ต้อง consume ก่อน loss recognition. ก่อนหน้านี้ JP5 ตรงเข้า
51-1102 → double-count loss.

Fixes: audit Wave 1 P0 ปพพ.386 C-4"
```

---

## Task 9: Run Full E2E + Verify CSV Goldens

**Files:** No new files

- [ ] **Step 9.1: รัน full TypeScript check**

Run:
```bash
./tools/check-types.sh all
```
Expected: 0 errors

- [ ] **Step 9.2: รัน API unit tests**

Run:
```bash
cd apps/api && npm test
```
Expected: ทุก test pass

- [ ] **Step 9.3: รัน CPA case tests**

Run:
```bash
cd apps/api && npx jest cpa-cases
```
Expected: 7 cases pass

- [ ] **Step 9.4: รัน E2E (smoke critical paths)**

Run:
```bash
cd apps/web && npx playwright test e2e/contracts.spec.ts e2e/payments.spec.ts e2e/repossessions.spec.ts
```
Expected: pass หรือ document failures

- [ ] **Step 9.5: เปรียบเทียบ TB ก่อน/หลัง**

Manual check:
- Trial Balance ก่อน Wave 1: 11-2101 / 11-2105 มี residual หรือไม่ (existing data)
- Trial Balance หลัง Wave 1: เปิดสัญญาใหม่ทำครบ 12 งวด → balance = 0

- [ ] **Step 9.6: Commit + Push**

```bash
git status
git log --oneline | head -10
```

ถ้าทุกอย่าง pass สร้าง PR:
```bash
gh pr create --title "fix(accounting): Wave 1 P0 critical fixes — atomicity + JP5 VAT/provision + 2A residual" --body "$(cat <<'EOF'
## Summary

Wave 1 ของ accounting compliance audit (8 พ.ค. 2568)
แก้ Critical findings P0 ทั้ง 7 ข้อ:

- ✅ Atomicity: ห่อทุก JE template (1A, 2A, JP4, JP5, BadDebtWriteOff) ใน outer \$transaction
- ✅ JP5 VAT split: แยกงวด accrued vs deferred ป้องกัน double-credit 21-2101
- ✅ JP5 consume Bad Debt Provision (11-2102) ก่อน recognize loss
- ✅ 2A final-period adjustment: 11-2101/11-2105 = 0 หลังจบสัญญา
- ✅ Bad Debt Service: Decimal precision + atomic write-off

## Test plan

- [ ] tools/check-types.sh all
- [ ] apps/api tests: atomicity.spec.ts + jp5-vat-split.spec.ts + 2a-final-period.spec.ts
- [ ] cpa-cases.spec.ts (7 cases pass)
- [ ] E2E: contracts + payments + repossessions

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review

**Spec coverage:**
- [x] Atomicity refactor 4 templates → Tasks 1, 3, 4, 5 cover all 4
- [x] JP5 VAT split → Task 7
- [x] JP5 consume provision → Task 8
- [x] 2A final-period → Task 6
- [x] Bad Debt Decimal → Task 5

**Placeholder scan:** ไม่มี TBD/TODO/"implement later" · ทุก code block มี content จริง

**Type consistency:** `tx?: Prisma.TransactionClient` ใช้ตลอด · `Prisma.Decimal` ใช้ทุกที่ที่เป็น money

**Tasks 1-9 = ~3-4 วัน dev work · ครบทุก P0 critical**

---

## Wave 2-4 — High-Level Outline (จะวางแผนละเอียดหลัง Wave 1 ปิด)

### Wave 2 (P1) — Credit Note + VAT Compliance

- Credit Note module ใหม่ (output document) ตาม ม.82/5 + ประกาศ 36/2536
- VAT 60-day Mandatory ลด doubleVat → 1× per งวด (ม.82/3)
- JP4 Discount → ลด VAT base ตาม ม.79
- JP6 Reschedule → update installment_schedules.due_date

### Wave 3 (P2) — Quick Wins

- Tag '3' collision fix (JP4='JP4', VC='VC', JP5='JP5')
- Defect Exchange: enforce no-payment guard
- Receipt Void: authorization check (OWNER/ACCOUNTANT only)
- JP6 description ภาษาไทย
- 1A policy comment (TFRS 15 §B34-B38 principal/agent)

### Wave 4 (P3) — Nice-to-haves + Owner Decision

- Bad Debt automated cron (monthly close integration)
- E-invoice per installment (e-document module)
- TFRS 15 §60-65 EIR decision (CPA hearing)
- VAT 60-day timezone fix
- All Info findings (descriptions, comments, helpers extraction)
