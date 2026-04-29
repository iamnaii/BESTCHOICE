# Accounting Phase A.1b — Inter-Company JE Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement proper inter-company JE pairing for SHOP↔FINANCE flows. Undo A.1a commission fold, split contract activation across both entities, and add 4 missing JE patterns (bad debt provision, customer credit overpay/allocation, repossession resale).

**Architecture:** New helper `inter-company-link.util.ts` creates paired SHOP+FINANCE entries within a single `$transaction`. Links via shared UUID prefix in description (e.g. `[IC-abc123] ...`) — simpler than coupling to InterCompanyTransaction model. Single-side entries (bad debt provision, customer credit, repo resale) use existing `createAndPost` pattern.

**Tech Stack:** NestJS, Prisma, TypeScript, Jest (unit), Playwright (E2E), Sentry.

**Spec:** `docs/superpowers/specs/2026-04-29-accounting-phase-a1b-intercompany-je-design.md`
**Predecessor:** Phase A.1a PR #723 (squash `f77230c1`) — schema split SHOP+FINANCE charts, ACC remap, commission temporarily folded.
**Branch:** `feat/accounting-phase-a1b-intercompany-je` (already created from origin/main)

---

## Pre-flight

- [ ] **Step 1: Verify branch + clean tree**

Run: `git branch --show-current && git status --short`
Expected: branch `feat/accounting-phase-a1b-intercompany-je`, clean working tree (only mockups/ untracked is OK)

- [ ] **Step 2: Verify spec exists**

Run: `ls docs/superpowers/specs/2026-04-29-accounting-phase-a1b-intercompany-je-design.md`
Expected: file exists (commit `74d5614b`)

---

## Wave 1 — Foundation (Tasks 1-3)

### Task 1: Add `53-1804 Loss on Repossession Resale` to FINANCE seed

**Files:**
- Modify: `apps/api/prisma/seeds/chart-of-accounts-finance.ts`

- [ ] **Step 1: Read current FINANCE seed**

Run: `grep -nE "code: '53-" apps/api/prisma/seeds/chart-of-accounts-finance.ts`

- [ ] **Step 2: Add new account in 53-XXXX block**

In `apps/api/prisma/seeds/chart-of-accounts-finance.ts`, find the 53-XXXX section and add:

```diff
   { code: '53-1801', nameTh: 'ค่านายหน้าจ่าย SHOP [A.1b]', ... },
+  { code: '53-1804', nameTh: 'ขาดทุนจากการขายสินค้ายึดคืน', nameEn: 'Loss on Repossession Resale', accountGroup: AccountGroup.EXPENSE, level: 3 },
   { code: '53-1802', nameTh: 'ค่าธรรมเนียม PaySolutions', ... },
```

(Insert at logical position; alphabetical/numerical order acceptable.)

- [ ] **Step 3: Type check**

Run: `./tools/check-types.sh api`
Expected: 0 errors

- [ ] **Step 4: Commit**

```bash
git add apps/api/prisma/seeds/chart-of-accounts-finance.ts
git commit -m "feat(accounting): add 53-1804 Loss on Repossession Resale to FINANCE chart (Phase A.1b Wave 1a)

Required for repossession resale JE in A.1b — handles loss case when
resellPrice < bookValue.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

Note: prod will need re-seed after deploy to add this account. Will run via Cloud Run Job in Wave 5.

---

### Task 2: Create `inter-company-link.util.ts` helper

**Files:**
- Create: `apps/api/src/modules/journal/inter-company-link.util.ts`
- Test: `apps/api/src/modules/journal/inter-company-link.util.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/modules/journal/inter-company-link.util.spec.ts`:

```typescript
import { Prisma } from '@prisma/client';
import { generateInterCompanyId, formatInterCompanyDescription, parseInterCompanyId } from './inter-company-link.util';

describe('inter-company-link.util', () => {
  describe('generateInterCompanyId', () => {
    it('returns a UUID-shaped string', () => {
      const id = generateInterCompanyId();
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    });

    it('returns unique values across calls', () => {
      const a = generateInterCompanyId();
      const b = generateInterCompanyId();
      expect(a).not.toBe(b);
    });
  });

  describe('formatInterCompanyDescription', () => {
    it('prefixes description with [IC-<id>]', () => {
      const id = '11111111-2222-3333-4444-555555555555';
      const result = formatInterCompanyDescription(id, 'Contract activation CT-001');
      expect(result).toBe('[IC-11111111-2222-3333-4444-555555555555] Contract activation CT-001');
    });
  });

  describe('parseInterCompanyId', () => {
    it('extracts id from formatted description', () => {
      const desc = '[IC-11111111-2222-3333-4444-555555555555] Contract activation CT-001';
      expect(parseInterCompanyId(desc)).toBe('11111111-2222-3333-4444-555555555555');
    });

    it('returns null for non-prefixed description', () => {
      expect(parseInterCompanyId('Plain description without IC prefix')).toBeNull();
    });
  });
});
```

- [ ] **Step 2: Verify tests fail (file not yet created)**

Run: `cd apps/api && npx jest inter-company-link.util.spec.ts`
Expected: FAIL with "Cannot find module './inter-company-link.util'"

- [ ] **Step 3: Implement helper**

Create `apps/api/src/modules/journal/inter-company-link.util.ts`:

```typescript
import { randomUUID } from 'node:crypto';

/**
 * Inter-company JE link utility (Phase A.1b).
 *
 * Pairs SHOP + FINANCE journal entries by embedding a shared UUID in the
 * description: `[IC-<uuid>] <description>`. Lets us query paired entries
 * without coupling JournalEntry to a parent table (InterCompanyTransaction
 * is per-sale, not per-payment, so it doesn't fit per-installment commission).
 *
 * Usage:
 *   const id = generateInterCompanyId();
 *   const shopDesc = formatInterCompanyDescription(id, 'Contract activation CT-001 SHOP side');
 *   const financeDesc = formatInterCompanyDescription(id, 'Contract activation CT-001 FINANCE side');
 *   // Use both descriptions in createAndPost calls within same $transaction.
 */

const IC_PREFIX = /^\[IC-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\]\s*/i;

export function generateInterCompanyId(): string {
  return randomUUID();
}

export function formatInterCompanyDescription(intercompanyId: string, description: string): string {
  return `[IC-${intercompanyId}] ${description}`;
}

export function parseInterCompanyId(description: string): string | null {
  const match = description.match(IC_PREFIX);
  return match ? match[1] : null;
}
```

- [ ] **Step 4: Verify tests pass**

Run: `cd apps/api && npx jest inter-company-link.util.spec.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/journal/inter-company-link.util.ts apps/api/src/modules/journal/inter-company-link.util.spec.ts
git commit -m "feat(journal): add inter-company link helper (Phase A.1b Wave 1b)

Generates shared UUID + formats/parses description prefix [IC-<uuid>].
Used to pair SHOP+FINANCE journal entries without schema change.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Refactor `createContractActivationJournal` — split SHOP+FINANCE

**Files:**
- Modify: `apps/api/src/modules/journal/journal-auto.service.ts createContractActivationJournal` (line ~368)
- Modify: `apps/api/src/modules/contracts/contract-workflow.service.ts` activate path
- Test: `apps/api/src/modules/journal/journal-auto.service.spec.ts`

- [ ] **Step 1: Add failing test for split entries**

In `journal-auto.service.spec.ts`, find or create `describe('createContractActivationJournal')` and add:

```typescript
it('creates 2 paired entries for contract activation (SHOP + FINANCE) (A.1b)', async () => {
  const principal = new Decimal('10000');
  const commission = new Decimal('500');
  const interest = new Decimal('1000');
  const vat = new Decimal('805');
  const downPayment = new Decimal('1000');
  const sellingPrice = principal.plus(downPayment); // 11000
  const financedAmount = principal.plus(commission).plus(interest).plus(vat); // 12305
  const costPrice = new Decimal('8000');

  const tx = makeFakeTx();
  // Mock 2 companies — SHOP and FINANCE
  tx.companyInfo.findFirst = jest.fn().mockImplementation((args: any) => {
    if (args?.where?.companyCode === 'SHOP') return Promise.resolve({ id: 'co-SHOP', companyCode: 'SHOP' });
    if (args?.where?.companyCode === 'FINANCE') return Promise.resolve({ id: 'co-FINANCE', companyCode: 'FINANCE' });
    return Promise.resolve(null);
  });

  await service.createContractActivationJournal(tx, {
    contract: {
      id: 'c1', contractNumber: 'CT-001',
      sellingPrice, downPayment, financedAmount,
      interestTotal: interest,
      storeCommission: commission,
      vatAmount: vat,
    },
    product: { costPrice, category: 'มือถือใหม่' },
    userId: 'u1',
    shopCompanyId: 'co-SHOP',
    financeCompanyId: 'co-FINANCE',
  });

  // Expect 2 journalEntry.create calls (SHOP + FINANCE)
  expect(tx.captured).toHaveLength(2);

  // SHOP entry
  const shopEntry = tx.captured.find((e: any) => e.companyId === 'co-SHOP');
  expect(shopEntry).toBeTruthy();
  expect(shopEntry.description).toMatch(/^\[IC-/);
  const shopDr = shopEntry.lines.reduce((s: number, l: any) => s + (l.debit || 0), 0);
  const shopCr = shopEntry.lines.reduce((s: number, l: any) => s + (l.credit || 0), 0);
  expect(Math.abs(shopDr - shopCr)).toBeLessThan(0.01);

  // FINANCE entry
  const financeEntry = tx.captured.find((e: any) => e.companyId === 'co-FINANCE');
  expect(financeEntry).toBeTruthy();
  expect(financeEntry.description).toMatch(/^\[IC-/);
  const financeDr = financeEntry.lines.reduce((s: number, l: any) => s + (l.debit || 0), 0);
  const financeCr = financeEntry.lines.reduce((s: number, l: any) => s + (l.credit || 0), 0);
  expect(Math.abs(financeDr - financeCr)).toBeLessThan(0.01);

  // Both share same intercompany id
  const shopId = shopEntry.description.match(/\[IC-([^\]]+)\]/)?.[1];
  const financeId = financeEntry.description.match(/\[IC-([^\]]+)\]/)?.[1];
  expect(shopId).toBe(financeId);

  // Inter-company invariant: SHOP Due-from-FINANCE = FINANCE Due-to-SHOP
  const shopDueFrom = shopEntry.lines.find((l: any) => l.accountCode === '11-2105')?.debit || 0;
  const financeDueTo = financeEntry.lines.find((l: any) => l.accountCode === '21-1102')?.credit || 0;
  expect(shopDueFrom).toBeCloseTo(financeDueTo, 2);
  expect(shopDueFrom).toBeCloseTo(11500, 0); // sellingPrice + commission - downPayment = 11000 + 500 - 1000
});
```

Update `makeFakeTx` helper to capture `companyId` per entry if not already:

```typescript
function makeFakeTx() {
  const captured: any[] = [];
  return {
    captured,
    accountingPeriod: { findFirst: jest.fn().mockResolvedValue(null) },
    companyInfo: {
      findFirst: jest.fn().mockResolvedValue({ id: 'co1', companyCode: 'FINANCE' }),
      findUnique: jest.fn().mockResolvedValue({ companyCode: 'FINANCE' }),
    },
    chartOfAccount: {
      findMany: jest.fn().mockImplementation(({ where }: any) => {
        const codes = where?.code?.in || [];
        return Promise.resolve(codes.map((c: string) => ({ code: c, nameTh: c })));
      }),
    },
    journalEntry: {
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn().mockImplementation(({ data }) => {
        captured.push({
          lines: data.lines.create,
          companyId: data.companyId,
          description: data.description,
        });
        return Promise.resolve({ id: `entry-${captured.length}` });
      }),
    },
  };
}
```

- [ ] **Step 2: Verify test fails**

Run: `cd apps/api && npx jest journal-auto.service.spec.ts -t "creates 2 paired entries"`
Expected: FAIL — current method creates 1 entry only

- [ ] **Step 3: Refactor `createContractActivationJournal`**

In `journal-auto.service.ts`, replace `createContractActivationJournal`:

```typescript
async createContractActivationJournal(tx: Prisma.TransactionClient, params: {
  contract: {
    id: string;
    contractNumber: string;
    sellingPrice: Decimal;
    downPayment: Decimal;
    financedAmount: Decimal;
    interestTotal: Decimal;
    storeCommission: Decimal;
    vatAmount: Decimal;
  };
  product: { costPrice: Decimal; category: string | null };
  userId: string;
  shopCompanyId?: string | null;     // Phase A.1b
  financeCompanyId?: string | null;  // Phase A.1b
}): Promise<{ shopEntryId: string | null; financeEntryId: string | null }> {
  const SA = JournalAutoService.SHOP_ACC;
  const FA = JournalAutoService.FINANCE_ACC;
  const isUsed = (params.product.category || '').toLowerCase().includes('used') ||
    (params.product.category || '').includes('มือสอง');

  // Resolve company ids if not passed
  const shopCompanyId = params.shopCompanyId
    ?? (await tx.companyInfo.findFirst({ where: { companyCode: 'SHOP', deletedAt: null }, select: { id: true } }))?.id
    ?? null;
  const financeCompanyId = params.financeCompanyId
    ?? (await tx.companyInfo.findFirst({ where: { companyCode: 'FINANCE', deletedAt: null }, select: { id: true } }))?.id
    ?? null;

  if (!shopCompanyId || !financeCompanyId) {
    throw new InternalServerErrorException('SHOP and FINANCE companies must be configured for inter-company JE');
  }

  const c = params.contract;
  const intercompanyId = generateInterCompanyId();
  const baseDesc = `Contract activation ${c.contractNumber}`;

  // SHOP entry: Dr Cash + Dr Due-from-FINANCE / Cr Revenue + Cr Commission + Dr COGS / Cr Inventory
  const dueFromFinance = c.sellingPrice.plus(c.storeCommission).minus(c.downPayment);
  const shopRevenueAcc = isUsed ? SA.REVENUE_USED : SA.REVENUE_NEW;
  const shopCogsAcc = isUsed ? SA.COGS_USED : SA.COGS_NEW;
  const shopInventoryAcc = isUsed ? SA.INVENTORY_USED : SA.INVENTORY_NEW;

  const shopEntryId = await this.createAndPost(tx, {
    companyId: shopCompanyId,
    entryDate: new Date(),
    description: formatInterCompanyDescription(intercompanyId, `${baseDesc} (SHOP)`),
    referenceType: 'CONTRACT',
    referenceId: c.id,
    createdById: params.userId,
    lines: [
      { accountCode: SA.CASH, description: 'Down payment received', debit: c.downPayment.toNumber(), credit: 0 },
      { accountCode: SA.DUE_FROM_FINANCE, description: 'Receivable from FINANCE', debit: dueFromFinance.toNumber(), credit: 0 },
      { accountCode: shopRevenueAcc, description: 'Revenue from sale', debit: 0, credit: c.sellingPrice.toNumber() },
      { accountCode: SA.COMMISSION_INCOME, description: 'Commission income', debit: 0, credit: c.storeCommission.toNumber() },
      { accountCode: shopCogsAcc, description: 'Cost of goods sold', debit: params.product.costPrice.toNumber(), credit: 0 },
      { accountCode: shopInventoryAcc, description: 'Inventory removed', debit: 0, credit: params.product.costPrice.toNumber() },
    ],
  });

  // FINANCE entry: Dr HP Receivable / Cr Due-to-SHOP + Cr Interest + Cr VAT
  const dueToShop = dueFromFinance; // same amount, different name
  const financeEntryId = await this.createAndPost(tx, {
    companyId: financeCompanyId,
    entryDate: new Date(),
    description: formatInterCompanyDescription(intercompanyId, `${baseDesc} (FINANCE)`),
    referenceType: 'CONTRACT',
    referenceId: c.id,
    createdById: params.userId,
    lines: [
      { accountCode: FA.HP_RECEIVABLE, description: 'HP Receivable from customer', debit: c.financedAmount.toNumber(), credit: 0 },
      { accountCode: FA.DUE_TO_SHOP, description: 'Payable to SHOP', debit: 0, credit: dueToShop.toNumber() },
      { accountCode: FA.INTEREST_INCOME, description: 'Interest income (upfront)', debit: 0, credit: c.interestTotal.toNumber() },
      { accountCode: FA.VAT_OUTPUT, description: 'VAT output', debit: 0, credit: c.vatAmount.toNumber() },
    ],
  });

  return { shopEntryId, financeEntryId };
}
```

Add import at top:
```typescript
import { generateInterCompanyId, formatInterCompanyDescription } from './inter-company-link.util';
```

- [ ] **Step 4: Update `contract-workflow.service.ts` to pass both companyIds**

In `contract-workflow.service.ts` activate path, find the existing FINANCE company lookup and add SHOP:

```diff
   // Resolve FINANCE company id (HP receivable + interest income are FINANCE-side per F-3-027)
   const financeCompany = await this.prisma.companyInfo.findFirst({
     where: { companyCode: 'FINANCE', deletedAt: null },
     select: { id: true },
   });
   if (!financeCompany) {
     throw new InternalServerErrorException('FINANCE company not configured');
   }
+  // Phase A.1b: Resolve SHOP company id (revenue + COGS + commission income are SHOP-side)
+  const shopCompany = await this.prisma.companyInfo.findFirst({
+    where: { companyCode: 'SHOP', deletedAt: null },
+    select: { id: true },
+  });
+  if (!shopCompany) {
+    throw new InternalServerErrorException('SHOP company not configured');
+  }
```

Then in the `createContractActivationJournal` call:

```diff
       await this.journalAutoService.createContractActivationJournal(tx, {
-        companyId: financeCompany.id,
+        shopCompanyId: shopCompany.id,
+        financeCompanyId: financeCompany.id,
         contract: { ... },
         product: { ... },
         userId: contract.salespersonId,
       });
```

Remove the legacy single `companyId` field if any.

- [ ] **Step 5: Run tests + verify pass**

Run: `cd apps/api && npx jest journal-auto.service.spec.ts -t "creates 2 paired entries"`
Expected: PASS

Run full spec:
`cd apps/api && npx jest journal-auto.service.spec.ts contracts/contract-workflow`
Expected: All PASS (existing activation tests may need fixture updates — assert 2 entries instead of 1)

- [ ] **Step 6: TypeScript check**

Run: `cd apps/api && npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/journal/journal-auto.service.ts apps/api/src/modules/contracts/contract-workflow.service.ts apps/api/src/modules/journal/journal-auto.service.spec.ts apps/api/src/modules/contracts/contract-workflow.service.spec.ts
git commit -m "feat(journal): split contract activation into SHOP+FINANCE entries (Phase A.1b Wave 1c)

createContractActivationJournal now creates 2 paired journal entries:
- SHOP entry: Dr Cash + Dr Due-from-FINANCE / Cr Revenue + Commission + COGS/Inventory
- FINANCE entry: Dr HP Receivable / Cr Due-to-SHOP + Interest + VAT

Both entries share [IC-<uuid>] description prefix for paired lookup.

Inter-company invariant: SHOP's Due-from-FINANCE === FINANCE's Due-to-SHOP.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Wave 2 — Payment + Credit (Tasks 4-6)

### Task 4: Refactor `createPaymentJournal` — undo fold + Due-to-SHOP + SHOP commission entry

**Files:**
- Modify: `apps/api/src/modules/journal/journal-auto.service.ts createPaymentJournal` (line ~216)
- Test: `apps/api/src/modules/journal/journal-auto.service.spec.ts`

- [ ] **Step 1: Add failing test for split payment**

```typescript
it('creates FINANCE payment entry + SHOP commission entry when commission > 0 (A.1b)', async () => {
  const tx = makeFakeTx();
  tx.companyInfo.findFirst = jest.fn().mockImplementation((args: any) => {
    if (args?.where?.companyCode === 'SHOP') return Promise.resolve({ id: 'co-SHOP', companyCode: 'SHOP' });
    if (args?.where?.companyCode === 'FINANCE') return Promise.resolve({ id: 'co-FINANCE', companyCode: 'FINANCE' });
    return Promise.resolve(null);
  });

  await service.createPaymentJournal(tx, {
    payment: {
      id: 'p1',
      installmentNo: 1,
      amountPaid: new Decimal('1500'),
      monthlyPrincipal: new Decimal('1000'),
      monthlyInterest: new Decimal('100'),
      monthlyCommission: new Decimal('300'),
      vatAmount: new Decimal('100'),
      lateFee: new Decimal('0'),
      lateFeeWaived: false,
      paidDate: new Date(),
    },
    contract: { contractNumber: 'CT-001', branchId: 'b1' },
    userId: 'u1',
    shopCompanyId: 'co-SHOP',
    financeCompanyId: 'co-FINANCE',
  });

  expect(tx.captured).toHaveLength(2);

  const financeEntry = tx.captured.find((e: any) => e.companyId === 'co-FINANCE');
  expect(financeEntry).toBeTruthy();
  // FINANCE entry includes Due-to-SHOP credit for commission portion
  const dueToShopLine = financeEntry.lines.find((l: any) => l.accountCode === '21-1102');
  expect(dueToShopLine).toBeTruthy();
  expect(dueToShopLine.credit).toBeCloseTo(300, 2);
  // HP Receivable credit = principal only (no commission fold)
  const hpRecvLine = financeEntry.lines.find((l: any) => l.accountCode === '11-2102');
  expect(hpRecvLine.credit).toBeCloseTo(1000, 2);

  const shopEntry = tx.captured.find((e: any) => e.companyId === 'co-SHOP');
  expect(shopEntry).toBeTruthy();
  // SHOP entry: Dr Due-from-FINANCE / Cr Commission Income
  const dueFromFinanceLine = shopEntry.lines.find((l: any) => l.accountCode === '11-2105');
  expect(dueFromFinanceLine.debit).toBeCloseTo(300, 2);
  const commissionLine = shopEntry.lines.find((l: any) => l.accountCode === '42-1105');
  expect(commissionLine.credit).toBeCloseTo(300, 2);
});

it('creates only FINANCE entry when commission = 0 (A.1b)', async () => {
  const tx = makeFakeTx();
  tx.companyInfo.findFirst = jest.fn().mockImplementation((args: any) => {
    if (args?.where?.companyCode === 'SHOP') return Promise.resolve({ id: 'co-SHOP', companyCode: 'SHOP' });
    if (args?.where?.companyCode === 'FINANCE') return Promise.resolve({ id: 'co-FINANCE', companyCode: 'FINANCE' });
    return Promise.resolve(null);
  });

  await service.createPaymentJournal(tx, {
    payment: {
      id: 'p2',
      installmentNo: 1,
      amountPaid: new Decimal('1100'),
      monthlyPrincipal: new Decimal('1000'),
      monthlyInterest: new Decimal('100'),
      monthlyCommission: new Decimal('0'),  // ← zero
      vatAmount: new Decimal('0'),
      lateFee: new Decimal('0'),
      lateFeeWaived: false,
      paidDate: new Date(),
    },
    contract: { contractNumber: 'CT-002', branchId: 'b1' },
    userId: 'u1',
    shopCompanyId: 'co-SHOP',
    financeCompanyId: 'co-FINANCE',
  });

  // Only FINANCE entry — no SHOP entry when commission=0
  expect(tx.captured).toHaveLength(1);
  expect(tx.captured[0].companyId).toBe('co-FINANCE');
});
```

- [ ] **Step 2: Verify tests fail**

Run: `cd apps/api && npx jest journal-auto.service.spec.ts -t "A.1b"`
Expected: 2 fail

- [ ] **Step 3: Refactor `createPaymentJournal`**

In `journal-auto.service.ts`, replace `createPaymentJournal`:

```typescript
async createPaymentJournal(tx: Prisma.TransactionClient, params: {
  payment: {
    id: string;
    installmentNo: number;
    amountPaid: Decimal | number;
    monthlyPrincipal: Decimal | number | null;
    monthlyInterest: Decimal | number | null;
    monthlyCommission: Decimal | number | null;
    vatAmount: Decimal | number | null;
    lateFee: Decimal | number | null;
    lateFeeWaived: boolean;
    paidDate: Date | null;
  };
  contract: { contractNumber: string; branchId: string };
  userId: string;
  shopCompanyId?: string | null;     // A.1b
  financeCompanyId?: string | null;  // A.1b
}): Promise<{ financeEntryId: string | null; shopEntryId: string | null }> {
  const FA = JournalAutoService.FINANCE_ACC;
  const SA = JournalAutoService.SHOP_ACC;

  const shopCompanyId = params.shopCompanyId
    ?? (await tx.companyInfo.findFirst({ where: { companyCode: 'SHOP', deletedAt: null }, select: { id: true } }))?.id
    ?? null;
  const financeCompanyId = params.financeCompanyId
    ?? (await tx.companyInfo.findFirst({ where: { companyCode: 'FINANCE', deletedAt: null }, select: { id: true } }))?.id
    ?? null;
  if (!financeCompanyId) {
    throw new InternalServerErrorException('FINANCE company required for payment JE');
  }

  const principal = new Decimal(params.payment.monthlyPrincipal ?? 0);
  const interest = new Decimal(params.payment.monthlyInterest ?? 0);
  const commission = new Decimal(params.payment.monthlyCommission ?? 0);
  const vat = new Decimal(params.payment.vatAmount ?? 0);
  const effectiveLateFee = params.payment.lateFeeWaived ? new Decimal(0) : new Decimal(params.payment.lateFee ?? 0);
  const amountPaid = new Decimal(params.payment.amountPaid);

  const intercompanyId = commission.gt(0) ? generateInterCompanyId() : null;
  const baseDesc = `Payment ${params.contract.contractNumber} #${params.payment.installmentNo}`;

  // FINANCE entry: Dr Cash / Cr HP Receivable + Interest + Late Fee + VAT + Due-to-SHOP
  const financeDesc = intercompanyId
    ? formatInterCompanyDescription(intercompanyId, `${baseDesc} (FINANCE)`)
    : baseDesc;
  const financeEntryId = await this.createAndPost(tx, {
    companyId: financeCompanyId,
    entryDate: params.payment.paidDate ?? new Date(),
    description: financeDesc,
    referenceType: 'PAYMENT',
    referenceId: params.payment.id,
    createdById: params.userId,
    lines: [
      { accountCode: FA.CASH, description: 'Cash received', debit: amountPaid.toNumber(), credit: 0 },
      { accountCode: FA.HP_RECEIVABLE, description: 'HP Receivable principal', debit: 0, credit: principal.toNumber() },
      { accountCode: FA.INTEREST_INCOME, description: 'Interest income', debit: 0, credit: interest.toNumber() },
      { accountCode: FA.LATE_FEE_INCOME, description: 'Late fee income', debit: 0, credit: effectiveLateFee.toNumber() },
      { accountCode: FA.VAT_OUTPUT, description: 'VAT output', debit: 0, credit: vat.toNumber() },
      { accountCode: FA.DUE_TO_SHOP, description: 'Commission owed to SHOP', debit: 0, credit: commission.toNumber() },
    ],
  });

  // SHOP entry: only when commission > 0
  let shopEntryId: string | null = null;
  if (commission.gt(0) && shopCompanyId && intercompanyId) {
    shopEntryId = await this.createAndPost(tx, {
      companyId: shopCompanyId,
      entryDate: params.payment.paidDate ?? new Date(),
      description: formatInterCompanyDescription(intercompanyId, `${baseDesc} (SHOP commission)`),
      referenceType: 'PAYMENT',
      referenceId: params.payment.id,
      createdById: params.userId,
      lines: [
        { accountCode: SA.DUE_FROM_FINANCE, description: 'Commission receivable', debit: commission.toNumber(), credit: 0 },
        { accountCode: SA.COMMISSION_INCOME, description: 'Commission income', debit: 0, credit: commission.toNumber() },
      ],
    });
  }

  return { financeEntryId, shopEntryId };
}
```

REMOVE the A.1a Sentry alarm code (`commission-deferred` capture).

- [ ] **Step 4: Verify tests pass**

Run: `cd apps/api && npx jest journal-auto.service.spec.ts -t "A.1b"`
Expected: PASS (2 new tests)

Run full spec:
`cd apps/api && npx jest journal-auto.service.spec.ts`
Expected: All PASS (existing payment tests may need fixture updates)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/journal/journal-auto.service.ts apps/api/src/modules/journal/journal-auto.service.spec.ts
git commit -m "feat(journal): split payment JE — FINANCE + SHOP commission entries (Phase A.1b Wave 2a)

Undo A.1a commission fold:
- FINANCE entry: HP Receivable credit = principal (not principal+commission)
- FINANCE entry adds Due-to-SHOP credit for commission portion
- SHOP entry: Dr Due-from-FINANCE / Cr Commission Income (only when commission > 0)

Both entries share [IC-<uuid>] prefix when paired.

Removed Sentry commission-deferred alarm — no longer deferred.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Update payment callers (payments + paysolutions + contract-payment + data-audit)

**Files:**
- Modify: `apps/api/src/modules/payments/payments.service.ts` (3 createPaymentJournal calls)
- Modify: `apps/api/src/modules/paysolutions/paysolutions.service.ts`
- Modify: `apps/api/src/modules/contracts/contract-payment.service.ts`
- Modify: `apps/api/src/modules/data-audit/data-audit.service.ts`

- [ ] **Step 1: Find all createPaymentJournal callers**

Run: `grep -rn "createPaymentJournal" apps/api/src --include="*.ts" | grep -v ".spec.ts"`
Expected: 4 service files (payments, paysolutions, contract-payment, data-audit)

- [ ] **Step 2: Update each caller to pass both companyIds**

For each caller, the existing pattern resolves `financeCompanyId` only. Add SHOP resolution:

In `payments.service.ts`, find the existing `resolveFinanceCompanyId()` private helper added in Phase A.0. Add a parallel helper:

```typescript
private async resolveShopCompanyId(): Promise<string | null> {
  const shop = await this.prisma.companyInfo.findFirst({
    where: { companyCode: 'SHOP', deletedAt: null },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
  });
  return shop?.id ?? null;
}
```

For each `createPaymentJournal` call, hoist both lookups before `$transaction` and pass:

```diff
+const shopCompanyId = await this.resolveShopCompanyId();
 const financeCompanyId = await this.resolveFinanceCompanyId();
 ...
       await this.journalAutoService.createPaymentJournal(tx, {
+        shopCompanyId,
-        companyId: financeCompanyId,
+        financeCompanyId,
         payment: { ... },
         contract: { ... },
         userId: ...,
       });
```

Apply to all 3 sites in payments.service.ts. The `companyId` parameter is renamed to `financeCompanyId` per Task 4 signature.

- [ ] **Step 3: Apply same change to paysolutions.service.ts, contract-payment.service.ts, data-audit.service.ts**

In each, find the existing FINANCE lookup. Add SHOP lookup. Pass both. Each service file needs:

1. Add SHOP company lookup before `$transaction` (or reuse companyInfo.findFirst pattern)
2. Update createPaymentJournal call signature: drop `companyId`, add `shopCompanyId` + `financeCompanyId`

In paysolutions.service.ts, the existing pattern from Phase A.0 has `financeCompanyId` and `systemUserId` resolved before main tx. Add `shopCompanyId` to the same hoisting block.

- [ ] **Step 4: Type check**

Run: `cd apps/api && npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 5: Run affected specs**

Run: `cd apps/api && npx jest payments paysolutions contracts/contract-payment data-audit`
Expected: All PASS (mocks may need updating to include SHOP company in companyInfo.findFirst)

If existing test mocks return only FINANCE company on findFirst, update them to handle SHOP query too:

```typescript
prisma.companyInfo.findFirst = jest.fn().mockImplementation((args: any) => {
  if (args?.where?.companyCode === 'SHOP') return Promise.resolve({ id: 'co-SHOP' });
  if (args?.where?.companyCode === 'FINANCE') return Promise.resolve({ id: 'co-FINANCE' });
  return Promise.resolve(null);
});
```

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/payments/ apps/api/src/modules/paysolutions/ apps/api/src/modules/contracts/contract-payment.service.ts apps/api/src/modules/data-audit/data-audit.service.ts
git commit -m "feat(payments): pass shopCompanyId + financeCompanyId to JE callers (Phase A.1b Wave 2b)

Updated 4 services with createPaymentJournal calls (4 total call sites):
- payments.service.ts: recordPayment, autoAllocatePayment, allocateCreditBalance
- paysolutions.service.ts: handlePaymentCallback
- contracts/contract-payment.service.ts: earlyPayoff
- data-audit/data-audit.service.ts: backfillJournals

Each resolves SHOP companyId alongside FINANCE before \$transaction.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Add `createCustomerCreditOverpaymentJournal` + `createCreditAllocationJournal`

**Files:**
- Modify: `apps/api/src/modules/journal/journal-auto.service.ts` (2 new methods)
- Modify: `apps/api/src/modules/payments/payments.service.ts` (overpayment branch + allocateCreditBalance)
- Test: `apps/api/src/modules/journal/journal-auto.service.spec.ts`

- [ ] **Step 1: Add failing tests**

```typescript
describe('createCustomerCreditOverpaymentJournal (Phase A.1b)', () => {
  it('creates FINANCE entry: Dr Cash / Cr Customer Credit', async () => {
    const tx = makeFakeTx();
    tx.companyInfo.findFirst = jest.fn().mockResolvedValue({ id: 'co-FINANCE', companyCode: 'FINANCE' });

    const result = await (service as any).createCustomerCreditOverpaymentJournal(tx, {
      paymentId: 'p1',
      contractNumber: 'CT-001',
      overpaymentAmount: new Decimal('500'),
      userId: 'u1',
      financeCompanyId: 'co-FINANCE',
      paidDate: new Date(),
    });

    expect(tx.captured).toHaveLength(1);
    const entry = tx.captured[0];
    expect(entry.companyId).toBe('co-FINANCE');
    const cashLine = entry.lines.find((l: any) => l.accountCode === '11-1101');
    expect(cashLine.debit).toBeCloseTo(500, 2);
    const creditLine = entry.lines.find((l: any) => l.accountCode === '21-5101');
    expect(creditLine.credit).toBeCloseTo(500, 2);
  });
});

describe('createCreditAllocationJournal (Phase A.1b)', () => {
  it('creates FINANCE entry: Dr Customer Credit (not Cash) / Cr HP Receivable + Interest + ...', async () => {
    const tx = makeFakeTx();
    tx.companyInfo.findFirst = jest.fn().mockImplementation((args: any) => {
      if (args?.where?.companyCode === 'SHOP') return Promise.resolve({ id: 'co-SHOP', companyCode: 'SHOP' });
      if (args?.where?.companyCode === 'FINANCE') return Promise.resolve({ id: 'co-FINANCE', companyCode: 'FINANCE' });
      return Promise.resolve(null);
    });

    await (service as any).createCreditAllocationJournal(tx, {
      payment: {
        id: 'p2',
        installmentNo: 2,
        amountPaid: new Decimal('1500'),
        monthlyPrincipal: new Decimal('1000'),
        monthlyInterest: new Decimal('100'),
        monthlyCommission: new Decimal('300'),
        vatAmount: new Decimal('100'),
        lateFee: new Decimal('0'),
        lateFeeWaived: false,
        paidDate: new Date(),
      },
      contract: { contractNumber: 'CT-001', branchId: 'b1' },
      userId: 'u1',
      shopCompanyId: 'co-SHOP',
      financeCompanyId: 'co-FINANCE',
    });

    expect(tx.captured).toHaveLength(2);
    const financeEntry = tx.captured.find((e: any) => e.companyId === 'co-FINANCE');
    // Customer Credit debited (NOT Cash)
    const ccLine = financeEntry.lines.find((l: any) => l.accountCode === '21-5101');
    expect(ccLine.debit).toBeCloseTo(1500, 2);
    // No Cash line on FINANCE side
    const cashLine = financeEntry.lines.find((l: any) => l.accountCode === '11-1101');
    expect(cashLine).toBeUndefined();
  });
});
```

- [ ] **Step 2: Verify tests fail**

Run: `cd apps/api && npx jest journal-auto.service.spec.ts -t "Phase A.1b"`
Expected: 2 new fail

- [ ] **Step 3: Add 2 new methods**

In `journal-auto.service.ts`, add after `createPaymentJournal`:

```typescript
async createCustomerCreditOverpaymentJournal(tx: Prisma.TransactionClient, params: {
  paymentId: string;
  contractNumber: string;
  overpaymentAmount: Decimal;
  userId: string;
  financeCompanyId?: string | null;
  paidDate?: Date | null;
}): Promise<string | null> {
  const FA = JournalAutoService.FINANCE_ACC;
  const financeCompanyId = params.financeCompanyId
    ?? (await tx.companyInfo.findFirst({ where: { companyCode: 'FINANCE', deletedAt: null }, select: { id: true } }))?.id
    ?? null;
  if (!financeCompanyId) {
    throw new InternalServerErrorException('FINANCE company required for customer credit overpayment JE');
  }

  return this.createAndPost(tx, {
    companyId: financeCompanyId,
    entryDate: params.paidDate ?? new Date(),
    description: `Customer overpayment ${params.contractNumber}`,
    referenceType: 'CUSTOMER_CREDIT_OVERPAY',
    referenceId: params.paymentId,
    createdById: params.userId,
    lines: [
      { accountCode: FA.CASH, description: 'Cash overpayment received', debit: params.overpaymentAmount.toNumber(), credit: 0 },
      { accountCode: FA.CUSTOMER_CREDIT, description: 'Customer credit liability', debit: 0, credit: params.overpaymentAmount.toNumber() },
    ],
  });
}

async createCreditAllocationJournal(tx: Prisma.TransactionClient, params: {
  payment: {
    id: string;
    installmentNo: number;
    amountPaid: Decimal | number;
    monthlyPrincipal: Decimal | number | null;
    monthlyInterest: Decimal | number | null;
    monthlyCommission: Decimal | number | null;
    vatAmount: Decimal | number | null;
    lateFee: Decimal | number | null;
    lateFeeWaived: boolean;
    paidDate: Date | null;
  };
  contract: { contractNumber: string; branchId: string };
  userId: string;
  shopCompanyId?: string | null;
  financeCompanyId?: string | null;
}): Promise<{ financeEntryId: string | null; shopEntryId: string | null }> {
  const FA = JournalAutoService.FINANCE_ACC;
  const SA = JournalAutoService.SHOP_ACC;

  const shopCompanyId = params.shopCompanyId
    ?? (await tx.companyInfo.findFirst({ where: { companyCode: 'SHOP', deletedAt: null }, select: { id: true } }))?.id
    ?? null;
  const financeCompanyId = params.financeCompanyId
    ?? (await tx.companyInfo.findFirst({ where: { companyCode: 'FINANCE', deletedAt: null }, select: { id: true } }))?.id
    ?? null;
  if (!financeCompanyId) {
    throw new InternalServerErrorException('FINANCE company required for credit allocation JE');
  }

  const principal = new Decimal(params.payment.monthlyPrincipal ?? 0);
  const interest = new Decimal(params.payment.monthlyInterest ?? 0);
  const commission = new Decimal(params.payment.monthlyCommission ?? 0);
  const vat = new Decimal(params.payment.vatAmount ?? 0);
  const effectiveLateFee = params.payment.lateFeeWaived ? new Decimal(0) : new Decimal(params.payment.lateFee ?? 0);
  const amountAllocated = new Decimal(params.payment.amountPaid);

  const intercompanyId = commission.gt(0) ? generateInterCompanyId() : null;
  const baseDesc = `Credit allocation ${params.contract.contractNumber} #${params.payment.installmentNo}`;

  // FINANCE entry: Dr Customer Credit (instead of Cash) / Cr HP Receivable + ... + Due-to-SHOP
  const financeDesc = intercompanyId
    ? formatInterCompanyDescription(intercompanyId, `${baseDesc} (FINANCE)`)
    : baseDesc;
  const financeEntryId = await this.createAndPost(tx, {
    companyId: financeCompanyId,
    entryDate: params.payment.paidDate ?? new Date(),
    description: financeDesc,
    referenceType: 'CREDIT_ALLOCATION',
    referenceId: params.payment.id,
    createdById: params.userId,
    lines: [
      { accountCode: FA.CUSTOMER_CREDIT, description: 'Customer credit applied', debit: amountAllocated.toNumber(), credit: 0 },
      { accountCode: FA.HP_RECEIVABLE, description: 'HP Receivable principal', debit: 0, credit: principal.toNumber() },
      { accountCode: FA.INTEREST_INCOME, description: 'Interest income', debit: 0, credit: interest.toNumber() },
      { accountCode: FA.LATE_FEE_INCOME, description: 'Late fee income', debit: 0, credit: effectiveLateFee.toNumber() },
      { accountCode: FA.VAT_OUTPUT, description: 'VAT output', debit: 0, credit: vat.toNumber() },
      { accountCode: FA.DUE_TO_SHOP, description: 'Commission owed to SHOP', debit: 0, credit: commission.toNumber() },
    ],
  });

  // SHOP entry: only when commission > 0 (mirrors createPaymentJournal pattern)
  let shopEntryId: string | null = null;
  if (commission.gt(0) && shopCompanyId && intercompanyId) {
    shopEntryId = await this.createAndPost(tx, {
      companyId: shopCompanyId,
      entryDate: params.payment.paidDate ?? new Date(),
      description: formatInterCompanyDescription(intercompanyId, `${baseDesc} (SHOP commission)`),
      referenceType: 'CREDIT_ALLOCATION',
      referenceId: params.payment.id,
      createdById: params.userId,
      lines: [
        { accountCode: SA.DUE_FROM_FINANCE, description: 'Commission receivable', debit: commission.toNumber(), credit: 0 },
        { accountCode: SA.COMMISSION_INCOME, description: 'Commission income', debit: 0, credit: commission.toNumber() },
      ],
    });
  }

  return { financeEntryId, shopEntryId };
}
```

- [ ] **Step 4: Wire into payments.service.ts**

Find the overpayment branch (~line 405):

```diff
       const overpayment = remaining.gt(0) ? dRound(remaining) : d(0);
       if (overpayment.gt(0)) {
         await tx.contract.update({ data: { creditBalance: { increment: overpayment } } });
+        // Phase A.1b: post overpayment JE
+        await this.journalAutoService.createCustomerCreditOverpaymentJournal(tx, {
+          paymentId: result.id,
+          contractNumber: contract.contractNumber,
+          overpaymentAmount: overpayment,
+          userId: recordedById,
+          financeCompanyId,
+          paidDate: result.paidDate,
+        });
       }
```

Find `allocateCreditBalance` (~line 732). Replace `createPaymentJournal` call with `createCreditAllocationJournal`:

```diff
-      await this.journalAutoService.createPaymentJournal(tx, { ... });
+      await this.journalAutoService.createCreditAllocationJournal(tx, {
+        shopCompanyId,
+        financeCompanyId,
+        payment: { ... },
+        contract: { ... },
+        userId,
+      });
```

- [ ] **Step 5: Verify tests pass + commit**

Run: `cd apps/api && npx jest journal-auto.service.spec.ts payments`
Expected: All PASS

```bash
git add apps/api/src/modules/journal/journal-auto.service.ts apps/api/src/modules/payments/payments.service.ts apps/api/src/modules/journal/journal-auto.service.spec.ts apps/api/src/modules/payments/payments.service.spec.ts
git commit -m "feat(journal): add Customer Credit overpayment + allocation JEs (Phase A.1b Wave 2c)

createCustomerCreditOverpaymentJournal: Dr Cash / Cr Customer Credit on overpayment.
Wired into payments.service.recordPayment overpayment branch.

createCreditAllocationJournal: Dr Customer Credit (not Cash) / Cr HP Recv + ...
Replaces createPaymentJournal call in allocateCreditBalance.
Prevents the double-cash bug from audit F-1-004.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Wave 3 — Standalone JEs (Tasks 7-8)

### Task 7: Add `createBadDebtProvisionJournal` + wire into bad-debt.service

**Files:**
- Modify: `apps/api/src/modules/journal/journal-auto.service.ts` (1 new method)
- Modify: `apps/api/src/modules/accounting/bad-debt.service.ts calculateProvisions`
- Test: `apps/api/src/modules/journal/journal-auto.service.spec.ts` + `bad-debt.service.spec.ts`

- [ ] **Step 1: Add failing test for new JE method**

```typescript
describe('createBadDebtProvisionJournal (Phase A.1b)', () => {
  it('creates FINANCE entry Dr Bad Debt Expense / Cr Allowance for positive delta', async () => {
    const tx = makeFakeTx();
    tx.companyInfo.findFirst = jest.fn().mockResolvedValue({ id: 'co-FINANCE', companyCode: 'FINANCE' });

    await (service as any).createBadDebtProvisionJournal(tx, {
      contractId: 'c1',
      period: '2026-04',
      delta: new Decimal('500'),  // increment provision
      userId: 'u1',
      financeCompanyId: 'co-FINANCE',
    });

    expect(tx.captured).toHaveLength(1);
    const entry = tx.captured[0];
    const expLine = entry.lines.find((l: any) => l.accountCode === '53-1701');
    expect(expLine.debit).toBeCloseTo(500, 2);
    const allowanceLine = entry.lines.find((l: any) => l.accountCode === '11-2103');
    expect(allowanceLine.credit).toBeCloseTo(500, 2);
  });

  it('creates reversal entry Dr Allowance / Cr Bad Debt Expense for negative delta (recovery)', async () => {
    const tx = makeFakeTx();
    tx.companyInfo.findFirst = jest.fn().mockResolvedValue({ id: 'co-FINANCE', companyCode: 'FINANCE' });

    await (service as any).createBadDebtProvisionJournal(tx, {
      contractId: 'c1',
      period: '2026-04',
      delta: new Decimal('-200'),
      userId: 'u1',
      financeCompanyId: 'co-FINANCE',
    });

    const entry = tx.captured[0];
    const expLine = entry.lines.find((l: any) => l.accountCode === '53-1701');
    expect(expLine.credit).toBeCloseTo(200, 2);
    const allowanceLine = entry.lines.find((l: any) => l.accountCode === '11-2103');
    expect(allowanceLine.debit).toBeCloseTo(200, 2);
  });

  it('skips JE creation when delta is zero', async () => {
    const tx = makeFakeTx();
    tx.companyInfo.findFirst = jest.fn().mockResolvedValue({ id: 'co-FINANCE', companyCode: 'FINANCE' });

    const result = await (service as any).createBadDebtProvisionJournal(tx, {
      contractId: 'c1',
      period: '2026-04',
      delta: new Decimal('0'),
      userId: 'u1',
      financeCompanyId: 'co-FINANCE',
    });
    expect(result).toBeNull();
    expect(tx.captured).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Verify tests fail**

Run: `cd apps/api && npx jest journal-auto.service.spec.ts -t "createBadDebtProvisionJournal"`
Expected: FAIL

- [ ] **Step 3: Add method**

```typescript
async createBadDebtProvisionJournal(tx: Prisma.TransactionClient, params: {
  contractId: string;
  period: string;  // YYYY-MM
  delta: Decimal;  // positive = increment, negative = recovery
  userId: string;
  financeCompanyId?: string | null;
}): Promise<string | null> {
  if (params.delta.eq(0)) return null;

  const FA = JournalAutoService.FINANCE_ACC;
  const financeCompanyId = params.financeCompanyId
    ?? (await tx.companyInfo.findFirst({ where: { companyCode: 'FINANCE', deletedAt: null }, select: { id: true } }))?.id
    ?? null;
  if (!financeCompanyId) {
    throw new InternalServerErrorException('FINANCE company required for bad debt provision JE');
  }

  const isIncrement = params.delta.gt(0);
  const amount = params.delta.abs().toNumber();

  return this.createAndPost(tx, {
    companyId: financeCompanyId,
    entryDate: new Date(),
    description: `Bad debt provision ${isIncrement ? 'increment' : 'recovery'} ${params.period}`,
    referenceType: 'BAD_DEBT_PROVISION',
    referenceId: `${params.contractId}:${params.period}`,
    createdById: params.userId,
    lines: isIncrement ? [
      { accountCode: FA.BAD_DEBT_EXPENSE, description: 'Bad debt expense', debit: amount, credit: 0 },
      { accountCode: FA.ALLOWANCE_DOUBTFUL, description: 'Allowance for doubtful', debit: 0, credit: amount },
    ] : [
      { accountCode: FA.ALLOWANCE_DOUBTFUL, description: 'Allowance reversal', debit: amount, credit: 0 },
      { accountCode: FA.BAD_DEBT_EXPENSE, description: 'Bad debt recovery', debit: 0, credit: amount },
    ],
  });
}
```

- [ ] **Step 4: Wire into bad-debt.service.calculateProvisions**

In `bad-debt.service.ts`, find `calculateProvisions`. After existing BadDebtProvision createMany, compute delta vs previous period and call new method:

```typescript
// After provisions are persisted, post JE for delta vs previous period
const previousProvisions = await this.prisma.badDebtProvision.findMany({
  where: { /* previous period filter */ },
});
// ... compute delta per contract

for (const { contractId, delta, period } of deltas) {
  if (delta.eq(0)) continue;
  await this.journalAutoService.createBadDebtProvisionJournal(this.prisma, {
    contractId,
    period,
    delta,
    userId: 'system-bad-debt-cron',  // or actual userId from caller
  });
}
```

(Adapt to actual structure. The exact wire-in depends on existing calculateProvisions implementation.)

- [ ] **Step 5: Run tests + commit**

Run: `cd apps/api && npx jest journal-auto.service.spec.ts accounting/bad-debt`
Expected: All PASS

```bash
git add apps/api/src/modules/journal/journal-auto.service.ts apps/api/src/modules/accounting/bad-debt.service.ts apps/api/src/modules/journal/journal-auto.service.spec.ts apps/api/src/modules/accounting/bad-debt.service.spec.ts
git commit -m "feat(journal): add Bad Debt Provision JE (Phase A.1b Wave 3a)

createBadDebtProvisionJournal posts delta-based JE:
- Positive delta: Dr Bad Debt Expense (53-1701) / Cr Allowance (11-2103)
- Negative delta (recovery): reverse direction
- Zero delta: skip

Wired into bad-debt.service.calculateProvisions to post delta vs prior period.
Closes audit finding F-1-009 (Allowance never posted).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Add `createRepossessionResaleJournal` + wire into repossessions.service

**Files:**
- Modify: `apps/api/src/modules/journal/journal-auto.service.ts` (1 new method)
- Modify: `apps/api/src/modules/repossessions/repossessions.service.ts` (SOLD branch)
- Test: `journal-auto.service.spec.ts` + `repossessions.service.spec.ts`

- [ ] **Step 1: Add failing tests**

```typescript
describe('createRepossessionResaleJournal (Phase A.1b)', () => {
  it('creates entry with gain when resellPrice > bookValue', async () => {
    const tx = makeFakeTx();
    tx.companyInfo.findFirst = jest.fn().mockResolvedValue({ id: 'co-FINANCE', companyCode: 'FINANCE' });

    await (service as any).createRepossessionResaleJournal(tx, {
      repossessionId: 'r1',
      resellPrice: new Decimal('5000'),
      bookValue: new Decimal('3000'),
      userId: 'u1',
      financeCompanyId: 'co-FINANCE',
    });

    const entry = tx.captured[0];
    const cashLine = entry.lines.find((l: any) => l.accountCode === '11-1101');
    expect(cashLine.debit).toBeCloseTo(5000, 2);
    const inventoryLine = entry.lines.find((l: any) => l.accountCode === '11-3103');
    expect(inventoryLine.credit).toBeCloseTo(3000, 2);
    const incomeLine = entry.lines.find((l: any) => l.accountCode === '42-2104');
    expect(incomeLine.credit).toBeCloseTo(2000, 2);
  });

  it('creates entry with loss when resellPrice < bookValue', async () => {
    const tx = makeFakeTx();
    tx.companyInfo.findFirst = jest.fn().mockResolvedValue({ id: 'co-FINANCE', companyCode: 'FINANCE' });

    await (service as any).createRepossessionResaleJournal(tx, {
      repossessionId: 'r2',
      resellPrice: new Decimal('2000'),
      bookValue: new Decimal('3000'),
      userId: 'u1',
      financeCompanyId: 'co-FINANCE',
    });

    const entry = tx.captured[0];
    const cashLine = entry.lines.find((l: any) => l.accountCode === '11-1101');
    expect(cashLine.debit).toBeCloseTo(2000, 2);
    const lossLine = entry.lines.find((l: any) => l.accountCode === '53-1804');
    expect(lossLine.debit).toBeCloseTo(1000, 2);
    const inventoryLine = entry.lines.find((l: any) => l.accountCode === '11-3103');
    expect(inventoryLine.credit).toBeCloseTo(3000, 2);
  });
});
```

- [ ] **Step 2: Verify fails**

Run: `cd apps/api && npx jest journal-auto.service.spec.ts -t "createRepossessionResaleJournal"`
Expected: FAIL

- [ ] **Step 3: Add method**

```typescript
async createRepossessionResaleJournal(tx: Prisma.TransactionClient, params: {
  repossessionId: string;
  resellPrice: Decimal;
  bookValue: Decimal;
  userId: string;
  financeCompanyId?: string | null;
}): Promise<string | null> {
  const FA = JournalAutoService.FINANCE_ACC;
  const financeCompanyId = params.financeCompanyId
    ?? (await tx.companyInfo.findFirst({ where: { companyCode: 'FINANCE', deletedAt: null }, select: { id: true } }))?.id
    ?? null;
  if (!financeCompanyId) {
    throw new InternalServerErrorException('FINANCE company required for repossession resale JE');
  }

  const gainOrLoss = params.resellPrice.minus(params.bookValue);
  const isGain = gainOrLoss.gte(0);

  const lines = isGain ? [
    { accountCode: FA.CASH, description: 'Cash from resale', debit: params.resellPrice.toNumber(), credit: 0 },
    { accountCode: FA.REPO_INVENTORY, description: 'Repossessed inventory removed', debit: 0, credit: params.bookValue.toNumber() },
    { accountCode: FA.REPOSSESSION_INCOME, description: 'Gain on repossession resale', debit: 0, credit: gainOrLoss.toNumber() },
  ] : [
    { accountCode: FA.CASH, description: 'Cash from resale', debit: params.resellPrice.toNumber(), credit: 0 },
    { accountCode: '53-1804', description: 'Loss on repossession resale', debit: gainOrLoss.abs().toNumber(), credit: 0 },
    { accountCode: FA.REPO_INVENTORY, description: 'Repossessed inventory removed', debit: 0, credit: params.bookValue.toNumber() },
  ];

  return this.createAndPost(tx, {
    companyId: financeCompanyId,
    entryDate: new Date(),
    description: `Repossession resale ${params.repossessionId}`,
    referenceType: 'REPO_RESALE',
    referenceId: params.repossessionId,
    createdById: params.userId,
    lines,
  });
}
```

- [ ] **Step 4: Wire into repossessions.service.update SOLD branch**

In `repossessions.service.ts update`, find where status transitions to SOLD (~line 363 or 406). Add after the update:

```typescript
if (status === 'SOLD' && existing.resellPrice && existing.product) {
  const bookValue = new Decimal(existing.product.costPrice).plus(new Decimal(existing.repairCost ?? 0));
  await this.journalAutoService.createRepossessionResaleJournal(this.prisma, {
    repossessionId: existing.id,
    resellPrice: new Decimal(existing.resellPrice),
    bookValue,
    userId,
  });
}
```

(Exact field names depend on actual Repossession + Product schema.)

- [ ] **Step 5: Verify tests + commit**

Run: `cd apps/api && npx jest journal-auto.service.spec.ts repossessions`
Expected: All PASS

```bash
git add apps/api/src/modules/journal/journal-auto.service.ts apps/api/src/modules/repossessions/repossessions.service.ts apps/api/src/modules/journal/journal-auto.service.spec.ts apps/api/src/modules/repossessions/repossessions.service.spec.ts
git commit -m "feat(journal): add Repossession Resale JE (Phase A.1b Wave 3b)

createRepossessionResaleJournal handles gain + loss cases:
- Gain: Dr Cash / Cr Repo Inventory + Repossession Income
- Loss: Dr Cash + Loss on Repo (53-1804) / Cr Repo Inventory

Wired into repossessions.service.update on SOLD transition.
Closes audit finding F-1-018.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Wave 4 — Cleanup + Tests (Task 9)

### Task 9: Cross-spec mock updates + add E2E

**Files:**
- Modify: ~5-7 spec files (mocks for new method signatures)
- Create: `apps/web/e2e/accounting-inter-company-flow.spec.ts`

- [ ] **Step 1: Run full suite to identify mock-related failures**

Run: `cd apps/api && npx jest 2>&1 | tail -10`
Note baseline. Failures in modules touched (payments, contracts, paysolutions, contract-payment, data-audit, bad-debt, repossessions) need mock updates.

- [ ] **Step 2: Update mocks to handle new method signatures + 2 companies**

For each affected spec, ensure `companyInfo.findFirst` mock returns BOTH SHOP and FINANCE based on query:

```typescript
prisma.companyInfo.findFirst = jest.fn().mockImplementation((args: any) => {
  if (args?.where?.companyCode === 'SHOP') return Promise.resolve({ id: 'co-SHOP' });
  if (args?.where?.companyCode === 'FINANCE') return Promise.resolve({ id: 'co-FINANCE' });
  return Promise.resolve(null);
});
```

For payment-related specs that mock `createPaymentJournal`, update assertion to expect new signature with `shopCompanyId` and `financeCompanyId` separated.

- [ ] **Step 3: Create E2E spec**

Create `apps/web/e2e/accounting-inter-company-flow.spec.ts`:

```typescript
import { test, expect } from '@playwright/test';
import { loginViaAPI, getAuthHeaders } from './helpers/auth';

test.describe('Accounting — Inter-company flow (Phase A.1b)', () => {
  test('inter-company invariant: SHOP Due-from-FINANCE = FINANCE Due-to-SHOP', async ({ request }) => {
    const auth = await loginViaAPI(request, 'OWNER');

    // Query Trial Balance for both companies
    const cosRes = await request.get('/api/companies', { headers: getAuthHeaders(auth) });
    const companies = await cosRes.json();
    const shop = companies.find((c: any) => c.companyCode === 'SHOP');
    const finance = companies.find((c: any) => c.companyCode === 'FINANCE');
    test.skip(!shop || !finance, 'SHOP/FINANCE not configured');

    // Sum Due-from-FINANCE on SHOP side (account 11-2105)
    const shopTBRes = await request.get(`/api/journal-entries/trial-balance?companyId=${shop.id}`, { headers: getAuthHeaders(auth) });
    const shopTB = await shopTBRes.json();
    const shopDueFromFinance = (shopTB.find((row: any) => row.accountCode === '11-2105')?.debit ?? 0)
      - (shopTB.find((row: any) => row.accountCode === '11-2105')?.credit ?? 0);

    // Sum Due-to-SHOP on FINANCE side (account 21-1102)
    const financeTBRes = await request.get(`/api/journal-entries/trial-balance?companyId=${finance.id}`, { headers: getAuthHeaders(auth) });
    const financeTB = await financeTBRes.json();
    const financeDueToShop = (financeTB.find((row: any) => row.accountCode === '21-1102')?.credit ?? 0)
      - (financeTB.find((row: any) => row.accountCode === '21-1102')?.debit ?? 0);

    expect(Math.abs(shopDueFromFinance - financeDueToShop)).toBeLessThan(0.01);
  });

  test('GET /journal-entries finds entries with [IC- prefix in description after activation', async ({ request }) => {
    const auth = await loginViaAPI(request, 'OWNER');

    const jeRes = await request.get('/api/journal-entries?referenceType=CONTRACT&limit=10', { headers: getAuthHeaders(auth) });
    const jes = await jeRes.json();
    test.skip(!jes.data || jes.data.length === 0, 'No CONTRACT JEs in test DB');

    // At least one entry should have [IC- prefix
    const hasIC = jes.data.some((je: any) => je.description?.startsWith('[IC-'));
    expect(hasIC).toBeTruthy();
  });
});
```

- [ ] **Step 4: TypeScript check**

Run: `./tools/check-types.sh all`
Expected: 0 errors

- [ ] **Step 5: Run full test suite**

Run: `cd apps/api && npx jest 2>&1 | tail -10`
Expected: All PASS (existing 2177+ + ~50 new tests = ~2225+)

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/**/*.spec.ts apps/web/e2e/accounting-inter-company-flow.spec.ts
git commit -m "test: cross-spec mock updates + new E2E for Phase A.1b Wave 4

- Update companyInfo.findFirst mocks to handle SHOP + FINANCE queries
- Update createPaymentJournal call assertions for new signature
- Add E2E accounting-inter-company-flow: invariant check + IC prefix lookup

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Wave 5 — Verification + Push + PR (Tasks 10-12)

### Task 10: Full verification

- [ ] **Step 1: TypeScript check**

Run: `./tools/check-types.sh all`
Expected: 0 errors

- [ ] **Step 2: Lint**

Run: `cd apps/api && npm run lint 2>&1 | tail -3 && cd ../web && npm run lint 2>&1 | tail -3`
Expected: 0 errors (warnings OK)

- [ ] **Step 3: Full unit test suite**

Run: `cd apps/api && npx jest 2>&1 | tail -5`
Expected: All PASS, count ~2225+

- [ ] **Step 4: Verify commits**

Run: `git log --oneline origin/main..HEAD`
Expected: ~10 commits in dependency order

---

### Task 11: Final code-reviewer subagent

- [ ] **Step 1: Dispatch code-reviewer on entire branch**

Use code-reviewer subagent. Prompt should include:
- Spec file path
- Branch name
- Compare against `origin/main`
- Focus on: atomic JE pairs, balance math, inter-company invariant, no double-cash bugs

- [ ] **Step 2: Fix any CRITICAL findings inline**

If CRITICAL → dispatch fix subagent + re-review.
If WARNING/INFO → document, don't block.

---

### Task 12: Pre-deploy backup + push + open PR

- [ ] **Step 1: Pre-deploy backup**

Run: `gcloud sql backups create --instance=bestchoice-db --project=bestchoice-prod --description="pre-A1b-intercompany"`
Wait for completion.

- [ ] **Step 2: Push branch**

Run: `git push -u origin feat/accounting-phase-a1b-intercompany-je`
Expected: branch pushed

- [ ] **Step 3: Open PR**

Run: `gh pr create --title "feat(accounting): Phase A.1b — Inter-company JE wiring" --body "..."` with body covering:
- Summary of 5 JE patterns
- Inter-company invariant
- Pre-deploy backup mention
- Note A.1a commission fold undone
- Test plan checklist

- [ ] **Step 4: Report PR URL**

Print PR # and URL to user. Note that E2E may fail due to chat_snoozes drift (pre-existing main issue).

- [ ] **Step 5: Note re-seed needed for FINANCE chart**

After deploy, run Cloud Run Job to re-seed FINANCE chart (to add new `53-1804` account). Or manually create via UI. Document in PR body.

---

## Self-Review Checklist (post-write, parent verifies)

- [ ] Spec coverage: every JE pattern (3.2-3.6) has a task ✓
- [ ] Helper file (3.1) created in Task 2 ✓
- [ ] Pattern decisions (P1-P8) reflected in implementation ✓
- [ ] Atomic rollback covered by test (Task 3 step 1) ✓
- [ ] Inter-company invariant covered by E2E (Task 9) ✓
- [ ] No placeholder text (TBD/XXX) ✓
- [ ] All ACC code references match Phase A.1a partition (FA. / SA. prefix) ✓
- [ ] Pre-deploy backup included (Task 12) ✓

---

## Estimated Effort

| Wave | Tasks | Time |
|---|---|---|
| 1 (Foundation) | 1, 2, 3 | ~5 hr |
| 2 (Payment + Credit) | 4, 5, 6 | ~8 hr |
| 3 (Standalone JEs) | 7, 8 | ~3 hr |
| 4 (Cleanup + Tests) | 9 | ~6 hr |
| 5 (Verification + PR) | 10, 11, 12 | ~3 hr |
| Self-review + 2-stage subagent review + fix | — | ~3 hr |
| **Total** | **12 tasks** | **~28 hr** |
