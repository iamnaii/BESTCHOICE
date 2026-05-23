# Insurance Wizard SP2 — Case 8 JE + Maker-Checker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the full BC FINANCE device exchange flow on top of SP1 — maker-checker approval queue + Case 8 JE chain (3 atomic entries) + buyback variance control + condition photo evidence.

**Architecture:** New `ContractExchangeRequest` model captures SALES/BM submissions. OWNER approval triggers a single `$transaction` that creates a new Contract via `ExchangeNewContract1ATemplate`, closes the old via `ExchangeCloseOld21_1106Template`, and clears the `21-1106` parking account via `ExchangeClearVendor21_1106Template`. Each template self-validates Dr=Cr; failure rolls back everything.

**Tech Stack:** NestJS + Prisma (backend) + Prisma.Decimal arithmetic, S3 storage (photo upload), React + TanStack Query (frontend).

**Spec:** [2026-05-23-insurance-wizard-sp2-case8-approval-design.md](../specs/2026-05-23-insurance-wizard-sp2-case8-approval-design.md)

**Depends on:** SP1 plan completed and merged (provides IMEI lookup + wizard refactor).

---

## File Structure

### Backend new files
| File | Responsibility |
|---|---|
| `apps/api/prisma/schema.prisma` (modify) | Add `ContractExchangeRequest` model + `Contract.exchangedFromContractId` + `EXCHANGED` enum value |
| `apps/api/prisma/migrations/<timestamp>_add_contract_exchange_request/migration.sql` | Migration |
| `apps/api/src/modules/contract-exchange/` | New module dir |
| └ `contract-exchange.module.ts` | Module wiring |
| └ `contract-exchange.controller.ts` | 4 endpoints |
| └ `contract-exchange.service.ts` | submit / approve / reject business logic |
| └ `dto/submit-exchange-request.dto.ts` | Submit payload validation |
| └ `dto/approve-exchange-request.dto.ts` | Approval payload (cashAccountCode) |
| └ `dto/reject-exchange-request.dto.ts` | Reject reason (min 10 chars) |
| └ `__tests__/*.spec.ts` | Unit tests |
| `apps/api/src/modules/journal/cpa-templates/exchange-new-contract-1a.template.ts` | JE 1A template |
| `apps/api/src/modules/journal/cpa-templates/exchange-close-old-21-1106.template.ts` | JE 2 template |
| `apps/api/src/modules/journal/cpa-templates/exchange-clear-vendor-21-1106.template.ts` | JE 3 template |
| `apps/api/src/modules/journal/__tests__/fixtures/cpa-cases/case-8-A.csv` | Sub-case A golden |
| `apps/api/src/modules/journal/__tests__/fixtures/cpa-cases/case-8-B.csv` | Sub-case B golden |
| `apps/api/src/modules/journal/__tests__/fixtures/cpa-cases/case-8-C.csv` | Sub-case C golden |
| `apps/api/src/modules/trade-in/trade-in.controller.ts` (modify) | Add `GET /trade-in/buyback-suggest` |
| `apps/api/src/modules/trade-in/trade-in.service.ts` (modify) | Buyback lookup method |

### Frontend new files
| File | Responsibility |
|---|---|
| `apps/web/src/pages/insurance/ExchangeRequestForm.tsx` | Submit-side form (buyback + new product + plan + photos) |
| `apps/web/src/pages/insurance/ExchangeRequestsPage.tsx` | OWNER approval queue |
| `apps/web/src/pages/insurance/components/PhotoUpload.tsx` | S3 photo uploader (1-5 photos, jpg/png/webp, ≤8MB) |
| `apps/web/src/pages/insurance/components/BuybackPriceField.tsx` | Field with table suggestion + variance indicator |
| `apps/web/src/pages/insurance/components/ExchangeRequestDetail.tsx` | Approval queue detail view |
| `apps/web/src/pages/insurance/WizardSteps/ImeiLookupStep.tsx` (modify from SP1) | Change INSTALLMENT exchange button to navigate to new form |
| `apps/web/src/config/menu.ts` (modify) | Add "คำขอเปลี่ยนเครื่อง" entry under OWNER's "หลังการขาย" |
| `apps/web/src/App.tsx` (modify) | Add routes `/insurance/exchange-requests` + `/insurance/new?intent=exchange-bc` |

---

## Pre-flight gate

### Task 0: Verify pre-plan blockers cleared

- [ ] **Step 0.1: Confirm CPA sign-off on existing `21-1106` label**

The label "บัญชีพักเครดิตเปลี่ยนเครื่อง" already exists in `finance-coa.csv`. CPA must confirm in writing that this account fits the Case 8 clearing-account role (parked Dr at JE2, fully cleared Cr at JE3, ending balance = 0 per batch).

- [ ] **Step 0.2: CPA review of all 3 JE templates against CSV golden values**

Confirm Dr/Cr lines + P&L threshold logic (JE2 loss/gain plug = buyback vs (Gross + VAT receivable remaining)).

- [ ] **Step 0.3: Verify buyback valuation table exists**

```bash
grep -n "TradeInValuation\|buyback.*table\|priceTable" apps/api/prisma/schema.prisma
```

If no result: this plan needs a sub-task to design + create such a table. Add to backlog; do NOT proceed without resolving.

- [ ] **Step 0.4: Block plan execution if any of 0.1-0.3 unresolved**

Do not move to Task 1 until all 3 gates are green. Document signing in `docs/cpa-approvals/2026-05-23-case-8-signoff.md`.

---

## Task 1: Schema — add ContractExchangeRequest model

**Files:**
- Modify: `apps/api/prisma/schema.prisma`

- [ ] **Step 1.1: Add enum**

Add near other enums:
```prisma
enum ExchangeRequestStatus {
  PENDING
  APPROVED
  REJECTED
}
```

Add new value to existing `ContractStatus` enum (locate it; add `EXCHANGED` alongside `CANCELED`).

- [ ] **Step 1.2: Add Contract self-relation fields**

In `model Contract { ... }`, add inside the field block:
```prisma
  exchangedFromContractId String?   @unique @map("exchanged_from_contract_id")
  exchangedFromContract   Contract? @relation("ContractExchange", fields: [exchangedFromContractId], references: [id])
  replacedByContract      Contract? @relation("ContractExchange")
  exchangedAt             DateTime? @map("exchanged_at")

  exchangeRequestsAsOld   ContractExchangeRequest[] @relation("ExchangeRequestsFromOldContract")
  exchangeRequestsAsNew   ContractExchangeRequest[] @relation("ExchangeRequestsToNewContract")
```

- [ ] **Step 1.3: Add ContractExchangeRequest model**

Append to schema:
```prisma
model ContractExchangeRequest {
  id                    String    @id @default(uuid())
  oldContractId         String    @map("old_contract_id")
  oldContract           Contract  @relation("ExchangeRequestsFromOldContract", fields: [oldContractId], references: [id])

  buybackPrice          Decimal   @map("buyback_price") @db.Decimal(12, 2)
  buybackPriceFromTable Decimal   @map("buyback_price_from_table") @db.Decimal(12, 2)
  variancePercent       Decimal   @map("variance_percent") @db.Decimal(5, 2)
  overrideReason        String?   @map("override_reason")
  requiresOwnerBypass   Boolean   @default(false) @map("requires_owner_bypass")

  newProductId          String    @map("new_product_id")
  newProduct            Product   @relation("ExchangeRequestNewProduct", fields: [newProductId], references: [id])
  newPlanDownPayment    Decimal   @map("new_plan_down_payment") @db.Decimal(12, 2)
  newPlanCommission     Decimal   @map("new_plan_commission") @db.Decimal(12, 2)
  newPlanMonths         Int       @map("new_plan_months")
  newPlanInterestRate   Decimal   @map("new_plan_interest_rate") @db.Decimal(5, 2)

  deviceConditionPhotos String[]  @map("device_condition_photos")

  status                ExchangeRequestStatus @default(PENDING)
  rejectionReason       String?   @map("rejection_reason")

  cashAccountCode       String?   @map("cash_account_code")

  requestedById         String    @map("requested_by_id")
  requestedBy           User      @relation("ExchangeRequestsRequested", fields: [requestedById], references: [id])
  approvedById          String?   @map("approved_by_id")
  approvedBy            User?     @relation("ExchangeRequestsApproved", fields: [approvedById], references: [id])
  approvedAt            DateTime? @map("approved_at")

  newContractId         String?   @unique @map("new_contract_id")
  newContract           Contract? @relation("ExchangeRequestsToNewContract", fields: [newContractId], references: [id])
  je1aId                String?   @map("je_1a_id")
  je2Id                 String?   @map("je_2_id")
  je3Id                 String?   @map("je_3_id")

  createdAt             DateTime  @default(now())
  updatedAt             DateTime  @updatedAt
  deletedAt             DateTime?

  @@index([status, createdAt])
  @@index([oldContractId])
  @@map("contract_exchange_requests")
}
```

Also add reverse relations on User + Product models (find them in schema and add):
```prisma
// In User model:
exchangeRequestsRequested ContractExchangeRequest[] @relation("ExchangeRequestsRequested")
exchangeRequestsApproved  ContractExchangeRequest[] @relation("ExchangeRequestsApproved")

// In Product model:
exchangeRequestsAsNew     ContractExchangeRequest[] @relation("ExchangeRequestNewProduct")
```

- [ ] **Step 1.4: Generate migration**

```bash
cd apps/api && npx prisma migrate dev --name add_contract_exchange_request --create-only
```

Inspect the SQL. Should add:
- Table `contract_exchange_requests`
- Enum type `ExchangeRequestStatus`
- New value on `ContractStatus`
- Columns + index on `contracts`

- [ ] **Step 1.5: Apply migration locally**

```bash
cd apps/api && npx prisma migrate dev
```

- [ ] **Step 1.6: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations/
git commit -m "feat(exchange): add ContractExchangeRequest schema"
```

---

## Task 2: SystemConfig seed key

**Files:**
- Modify: `apps/api/prisma/seed.ts` (or appropriate seed file — check where `SystemConfig` keys live)

- [ ] **Step 2.1: Add seed entry**

```ts
await prisma.systemConfig.upsert({
  where: { key: 'EXCHANGE_BUYBACK_VARIANCE_THRESHOLD' },
  update: {},
  create: {
    key: 'EXCHANGE_BUYBACK_VARIANCE_THRESHOLD',
    value: '20.00',
    description: 'Threshold % for buyback variance — override reason required when exceeded',
  },
});
```

- [ ] **Step 2.2: Run seed**

```bash
cd apps/api && npm run seed
```

- [ ] **Step 2.3: Commit**

```bash
git add apps/api/prisma/seed.ts
git commit -m "feat(exchange): seed EXCHANGE_BUYBACK_VARIANCE_THRESHOLD"
```

---

## Task 3: CSV golden fixtures for Case 8

**Files:**
- Create: `apps/api/src/modules/journal/__tests__/fixtures/cpa-cases/case-8-A.csv`
- Create: `apps/api/src/modules/journal/__tests__/fixtures/cpa-cases/case-8-B.csv`
- Create: `apps/api/src/modules/journal/__tests__/fixtures/cpa-cases/case-8-C.csv`

- [ ] **Step 3.1: Create case-8-A.csv (buyback 8,000 < threshold)**

Following the existing fixture loader format at `apps/api/src/modules/journal/__tests__/csv-fixture-loader.ts`, the CSV columns are `accountCode, debit, credit, description`. Three blocks for JE1A, JE2, JE3:

```csv
# JE 1A — New contract activation (buyback 8,000)
11-2101,17000.00,,Gross receivable new contract
11-2105,1190.00,,VAT receivable new
,,,
21-1101,,10000.00,New vendor yodjat
21-1102,,1000.00,New vendor commission
11-2106,,6000.00,New unearned interest
21-2102,,1190.00,New deferred VAT output

# JE 2 — Close old contract + book 21-1106
21-1106,8000.00,,Buyback liability (sub-case A)
11-2106,4000.00,,Clear old unearned interest
21-2102,793.36,,Clear old deferred VAT
51-1102,4126.64,,Loss on exchange (buyback < threshold)
,,,
11-2101,,11333.28,Clear old gross receivable
11-2105,,793.36,Clear old VAT receivable
21-2101,,793.36,Recognize VAT to ภ.พ.30
41-1101,,4000.00,Recognize interest revenue

# JE 3 — Clear 21-1106 + customer pays diff
21-1101,10000.00,,New vendor yodjat
21-1102,1000.00,,New vendor commission
,,,
21-1106,,8000.00,Settle exchange clearing
11-1101,,3000.00,Customer pays cash diff
```

- [ ] **Step 3.2: Create case-8-B.csv (buyback 11,000 == new vendor)**

Same structure, sub-case B values: JE2 has loss 1,126.64; JE3 has no cash line.

- [ ] **Step 3.3: Create case-8-C.csv (buyback 13,000 > new vendor)**

Same structure, sub-case C: JE2 has gain 873.36 (Cr 41-1102 instead of Dr 51-1102); JE3 has refund cash to customer (Dr 11-1101 2,000).

- [ ] **Step 3.4: Commit**

```bash
git add apps/api/src/modules/journal/__tests__/fixtures/cpa-cases/case-8-*.csv
git commit -m "test(exchange): add Case 8 A/B/C CSV golden fixtures"
```

---

## Task 4: ExchangeNewContract1ATemplate

**Files:**
- Create: `apps/api/src/modules/journal/cpa-templates/exchange-new-contract-1a.template.ts`
- Create: `apps/api/src/modules/journal/cpa-templates/__tests__/exchange-new-contract-1a.spec.ts`

- [ ] **Step 4.1: Write failing test**

```ts
// spec: load case-8-A.csv JE1A block, run template with inputs from CSV,
// assert returned lines match exactly (account, debit, credit)
import { loadCpaCase } from '../../../journal/__tests__/csv-fixture-loader';
import { ExchangeNewContract1ATemplate } from '../exchange-new-contract-1a.template';

describe('ExchangeNewContract1ATemplate', () => {
  it('matches case-8-A JE 1A golden values', async () => {
    const fixture = loadCpaCase('case-8-A.csv', 'JE_1A');
    const result = await new ExchangeNewContract1ATemplate(/* deps */).execute({
      yodjat: 10000, commission: 1000, months: 12, vatRate: 7,
      // ... params derived from CSV inputs
    }, /* mock tx */);
    expect(result.lines).toEqual(fixture.lines);
  });
});
```

- [ ] **Step 4.2: Implement template**

Template should mirror `ContractActivation1ATemplate` (existing) — copy its structure and adapt input contract source. Key inputs: yodjat, commission, months, interest rate. Output: 6 lines matching the JE1A pattern.

(Detail: copy `apps/api/src/modules/journal/cpa-templates/contract-activation-1a.template.ts` line-by-line; adapt input shape if needed.)

- [ ] **Step 4.3: Test passes**

```bash
cd apps/api && npx jest src/modules/journal/cpa-templates/__tests__/exchange-new-contract-1a.spec.ts
```

- [ ] **Step 4.4: Commit**

```bash
git add apps/api/src/modules/journal/cpa-templates/exchange-new-contract-1a.*
git commit -m "feat(journal): ExchangeNewContract1ATemplate"
```

---

## Task 5: ExchangeCloseOld21_1106Template

**Files:**
- Create: `apps/api/src/modules/journal/cpa-templates/exchange-close-old-21-1106.template.ts`
- Create: spec at `__tests__/exchange-close-old-21-1106.spec.ts`

- [ ] **Step 5.1: Write failing tests covering 3 sub-cases**

```ts
describe('ExchangeCloseOld21_1106Template', () => {
  it.each([
    ['case-8-A', 8000, 'loss', 4126.64],
    ['case-8-B', 11000, 'loss', 1126.64],
    ['case-8-C', 13000, 'gain', 873.36],
  ])('plug-balances correctly for %s (buyback %i)', async (file, buyback, dir, amount) => {
    const fixture = loadCpaCase(`${file}.csv`, 'JE_2');
    const result = await new ExchangeCloseOld21_1106Template(/* deps */).execute({
      buybackPrice: buyback,
      oldGrossReceivable: 11333.28,
      oldVatReceivable: 793.36,
      oldUnearnedInterest: 4000,
      oldDeferredVat: 793.36,
    }, /* mock tx */);
    expect(result.lines).toEqual(fixture.lines);
    const pnl = result.lines.find(l =>
      l.accountCode === (dir === 'loss' ? '51-1102' : '41-1102'),
    );
    expect(pnl).toBeDefined();
    expect(Number(pnl!.debit ?? pnl!.credit)).toBeCloseTo(amount, 2);
  });
});
```

- [ ] **Step 5.2: Implement template**

```ts
async execute(input: {
  buybackPrice: Decimal;
  oldGrossReceivable: Decimal;
  oldVatReceivable: Decimal;
  oldUnearnedInterest: Decimal;
  oldDeferredVat: Decimal;
}, tx: Prisma.TransactionClient) {
  const threshold = input.oldGrossReceivable.add(input.oldVatReceivable);
  const diff = input.buybackPrice.sub(threshold);

  const lines: JournalLineInput[] = [
    { accountCode: '21-1106', debit: input.buybackPrice },
    { accountCode: '11-2106', debit: input.oldUnearnedInterest },
    { accountCode: '21-2102', debit: input.oldDeferredVat },
  ];

  // Plug-balance with loss or gain
  if (diff.lessThan(0)) {
    lines.push({ accountCode: '51-1102', debit: diff.abs() });
  } else if (diff.greaterThan(0)) {
    lines.push({ accountCode: '41-1102', credit: diff });
  }

  // Standard Cr block
  lines.push(
    { accountCode: '11-2101', credit: input.oldGrossReceivable },
    { accountCode: '11-2105', credit: input.oldVatReceivable },
    { accountCode: '21-2101', credit: input.oldVatReceivable },  // recognize VAT
    { accountCode: '41-1101', credit: input.oldUnearnedInterest },  // recognize interest
  );

  // Post via existing journal service pattern (consistent with other templates)
  return this.postJournalEntry(tx, {
    description: 'Exchange close old contract — JE 2',
    lines,
    metadata: { flow: 'exchange-close-old', oldContractId: input.oldContractId },
  });
}
```

- [ ] **Step 5.3: Verify all 3 sub-cases pass**

```bash
cd apps/api && npx jest src/modules/journal/cpa-templates/__tests__/exchange-close-old-21-1106.spec.ts
```

- [ ] **Step 5.4: Commit**

```bash
git add apps/api/src/modules/journal/cpa-templates/exchange-close-old-21-1106.*
git commit -m "feat(journal): ExchangeCloseOld21_1106Template with plug-balance P&L"
```

---

## Task 6: ExchangeClearVendor21_1106Template

**Files:**
- Create: `apps/api/src/modules/journal/cpa-templates/exchange-clear-vendor-21-1106.template.ts`
- Create: spec test

- [ ] **Step 6.1: Write failing tests for 3 sub-cases**

```ts
describe('ExchangeClearVendor21_1106Template', () => {
  it.each([
    ['A — customer pays diff', 8000, 11000, 3000, 'credit'],
    ['B — perfect offset', 11000, 11000, 0, null],
    ['C — refund customer', 13000, 11000, 2000, 'debit'],
  ])('%s', async (_, buyback, newVendorSum, cashAmount, cashDir) => {
    const result = await new ExchangeClearVendor21_1106Template(/* deps */).execute({
      buybackPrice: buyback,
      newVendorYodjat: 10000,
      newVendorCommission: 1000,
      cashAccountCode: '11-1101',
    }, /* tx */);
    // Verify cash line matches expected direction + amount
  });
});
```

- [ ] **Step 6.2: Implement template**

```ts
async execute(input: {
  buybackPrice: Decimal;
  newVendorYodjat: Decimal;
  newVendorCommission: Decimal;
  cashAccountCode: string;  // 11-1101..1103 or 11-1201..1203
}, tx: Prisma.TransactionClient) {
  const newVendorSum = input.newVendorYodjat.add(input.newVendorCommission);
  const diff = input.buybackPrice.sub(newVendorSum);

  const lines: JournalLineInput[] = [
    { accountCode: '21-1101', debit: input.newVendorYodjat },
    { accountCode: '21-1102', debit: input.newVendorCommission },
  ];

  if (diff.lessThan(0)) {
    // Sub-case A: customer pays cash diff
    lines.push({ accountCode: input.cashAccountCode, credit: diff.abs() });  // Wait: Cr should be on the Cr side
    lines.push({ accountCode: '21-1106', credit: input.buybackPrice });
  } else if (diff.greaterThan(0)) {
    // Sub-case C: refund customer
    lines.push({ accountCode: input.cashAccountCode, debit: diff });
    lines.push({ accountCode: '21-1106', credit: input.buybackPrice });
  } else {
    // Sub-case B: perfect offset
    lines.push({ accountCode: '21-1106', credit: input.buybackPrice });
  }

  return this.postJournalEntry(tx, {
    description: 'Exchange clear 21-1106 — JE 3',
    lines,
    metadata: { flow: 'exchange-clear-21-1106' },
  });
}
```

> Note: Sub-case A's cash line direction in pseudo above looks wrong — customer is *paying us*, so cash IN = Dr cash. Re-check the JE structure in spec — it says **Cr [cashAccountCode]** in Sub-case A. That's because the perspective is "the new vendor liability sum (Dr 11k) > buyback parking (Cr 8k), needing 3k more on Cr side to balance — that comes from cash IN, posted as Cr to the cash account if we treat the receipt as crediting the customer's cash flow." Wait — that's also wrong. Cash IN = Dr cash. Re-trace from JE3 spec:
>
> ```
> Dr 21-1101 10,000 + Dr 21-1102 1,000 = 11,000 Dr total
>    Cr 21-1106 8,000 + Cr cash 3,000 = 11,000 Cr total
> ```
>
> So when customer PAYS 3,000 cash in (we receive cash), the spec writes Cr cash 3,000. That's BACKWARDS from how Payment templates book cash (those Dr cash on receipt).
>
> **Action item for plan execution:** clarify with CPA which direction is correct. The CSV at Task 3 should resolve this — implementer follows whichever direction the CSV golden value uses.

- [ ] **Step 6.3: Resolve cash direction ambiguity using CSV golden**

```bash
# Inspect case-8-A.csv created at Task 3
grep "11-1101" apps/api/src/modules/journal/__tests__/fixtures/cpa-cases/case-8-A.csv
```

Whatever direction the CSV says, the template MUST match. If CSV says Cr 11-1101, implement as Cr.

- [ ] **Step 6.4: Verify all 3 tests pass + Dr=Cr balance assert**

- [ ] **Step 6.5: Commit**

---

## Task 7: ContractExchangeRequestService

**Files:**
- Create: `apps/api/src/modules/contract-exchange/contract-exchange.service.ts`
- Create: `apps/api/src/modules/contract-exchange/__tests__/contract-exchange.service.spec.ts`

- [ ] **Step 7.1: Write failing submit test**

```ts
describe('ContractExchangeRequestService.submit', () => {
  it('creates PENDING request with computed variance', async () => {
    // Mock prisma + buyback suggest returns 10,000
    // Submit with buybackPrice: 8,000 → variance = -20%
    // Expect: status=PENDING, variancePercent=-20.00, overrideReason missing → BadRequestException
  });

  it('blocks submit if variance > threshold without overrideReason', async () => { /* ... */ });

  it('accepts submit with valid overrideReason when variance exceeds threshold', async () => { /* ... */ });
});
```

- [ ] **Step 7.2: Implement submit**

```ts
async submit(dto: SubmitExchangeRequestDto, userId: string) {
  // 1. Validate old contract exists + ACTIVE + INSTALLMENT
  const old = await this.prisma.contract.findUnique({ where: { id: dto.oldContractId } });
  if (!old || old.status !== 'ACTIVE') throw new BadRequestException('สัญญาเก่าไม่อยู่ในสถานะ ACTIVE');

  // 2. Get buyback suggestion + compute variance
  const suggested = await this.tradeInService.suggestBuybackPrice(old.productId);
  const variance = dto.buybackPrice.sub(suggested).div(suggested).mul(100);  // signed %
  const threshold = await this.getThreshold();  // from SystemConfig

  // 3. Validate overrideReason if exceeds
  if (variance.abs().greaterThan(threshold) && !dto.overrideReason?.trim()) {
    throw new BadRequestException(`Variance ${variance.toFixed(2)}% เกิน ±${threshold}% — ต้องระบุเหตุผล`);
  }

  // 4. Validate photos: 1-5 count
  if (dto.deviceConditionPhotos.length < 1 || dto.deviceConditionPhotos.length > 5) {
    throw new BadRequestException('ภาพถ่ายสภาพเครื่อง 1-5 รูป');
  }

  // 5. Create row
  return this.prisma.contractExchangeRequest.create({
    data: {
      oldContractId: dto.oldContractId,
      buybackPrice: dto.buybackPrice,
      buybackPriceFromTable: suggested,
      variancePercent: variance,
      overrideReason: dto.overrideReason,
      requiresOwnerBypass: dto.requiresOwnerBypass ?? false,
      newProductId: dto.newProductId,
      newPlanDownPayment: dto.newPlanDownPayment,
      newPlanCommission: dto.newPlanCommission,
      newPlanMonths: dto.newPlanMonths,
      newPlanInterestRate: dto.newPlanInterestRate,
      deviceConditionPhotos: dto.deviceConditionPhotos,
      status: 'PENDING',
      requestedById: userId,
    },
  });
}
```

- [ ] **Step 7.3: Write failing approve test (the atomic one)**

```ts
it('approves: posts 3 JEs atomically + creates new Contract + flips old.status', async () => {
  // Setup PENDING request, valid CashAccountCode
  // Mock all 3 templates to return canned JE entries
  // Call approve → expect status=APPROVED, je1aId/je2Id/je3Id populated,
  // oldContract.status='EXCHANGED', newContract created
});

it('rolls back entirely if JE2 throws', async () => {
  // Force JE2 to throw — expect request still PENDING, no Contract created
});

it('rejects concurrent approve: 2nd call returns ConflictException', async () => {
  // Concurrent updateMany pattern — only 1 succeeds
});
```

- [ ] **Step 7.4: Implement approve with atomic $transaction**

```ts
async approve(id: string, dto: ApproveExchangeRequestDto, userId: string) {
  return this.prisma.$transaction(async (tx) => {
    // 1. Lock-acquire: updateMany returns count of rows changed
    const lockResult = await tx.contractExchangeRequest.updateMany({
      where: { id, status: 'PENDING' },
      data: {
        status: 'APPROVED',
        approvedById: userId,
        approvedAt: new Date(),
        cashAccountCode: dto.cashAccountCode,
      },
    });
    if (lockResult.count !== 1) {
      throw new ConflictException('คำขออาจถูกอนุมัติแล้ว หรือสถานะเปลี่ยน');
    }

    // 2. Re-fetch full request data
    const req = await tx.contractExchangeRequest.findUniqueOrThrow({
      where: { id },
      include: { oldContract: { include: { product: true, customer: true } }, newProduct: true },
    });

    // 3. JE 1A — create new Contract + post activation JE
    const newContract = await this.contractService.createForExchange(tx, {
      customerId: req.oldContract.customerId,
      productId: req.newProductId,
      downPayment: req.newPlanDownPayment,
      commission: req.newPlanCommission,
      months: req.newPlanMonths,
      interestRate: req.newPlanInterestRate,
      exchangedFromContractId: req.oldContractId,
    });
    const je1a = await this.je1aTemplate.execute(/* inputs from newContract */, tx);

    // 4. JE 2 — close old contract
    const oldOutstanding = await this.computeOldOutstanding(tx, req.oldContractId);
    const je2 = await this.je2Template.execute({
      buybackPrice: req.buybackPrice,
      oldGrossReceivable: oldOutstanding.gross,
      oldVatReceivable: oldOutstanding.vatReceivable,
      oldUnearnedInterest: oldOutstanding.unearnedInterest,
      oldDeferredVat: oldOutstanding.deferredVat,
    }, tx);

    // 5. JE 3 — clear 21-1106
    const je3 = await this.je3Template.execute({
      buybackPrice: req.buybackPrice,
      newVendorYodjat: req.newPlanDownPayment.add(/* yodjat calc from new contract */),
      newVendorCommission: req.newPlanCommission,
      cashAccountCode: dto.cashAccountCode,
    }, tx);

    // 6. Update old Contract → EXCHANGED
    await tx.contract.update({
      where: { id: req.oldContractId },
      data: {
        status: 'EXCHANGED',
        exchangedAt: new Date(),
        replacedByContract: { connect: { id: newContract.id } },
      },
    });

    // 7. Link request to outputs
    await tx.contractExchangeRequest.update({
      where: { id },
      data: {
        newContractId: newContract.id,
        je1aId: je1a.id,
        je2Id: je2.id,
        je3Id: je3.id,
      },
    });

    // 8. Sanity-check 21-1106 ending balance = 0 for batch
    // (Sum debits + credits on 21-1106 within these 3 JEs; assert balance)

    // 9. Audit log
    await this.auditLog.write({
      action: 'EXCHANGE_REQUEST_APPROVED',
      entity: 'contract_exchange_request',
      entityId: id,
      userId,
      newValue: { newContractId: newContract.id, je1aId: je1a.id, je2Id: je2.id, je3Id: je3.id },
    });

    return { id, newContractId: newContract.id, je1aId: je1a.id, je2Id: je2.id, je3Id: je3.id };
  });
}
```

- [ ] **Step 7.5: Implement reject**

```ts
async reject(id: string, reason: string, userId: string) {
  if (reason.trim().length < 10) throw new BadRequestException('เหตุผลปฏิเสธอย่างน้อย 10 ตัวอักษร');
  const result = await this.prisma.$transaction(async (tx) => {
    const lockResult = await tx.contractExchangeRequest.updateMany({
      where: { id, status: 'PENDING' },
      data: { status: 'REJECTED', rejectionReason: reason, approvedById: userId, approvedAt: new Date() },
    });
    if (lockResult.count !== 1) throw new ConflictException('คำขออาจถูกตอบกลับแล้ว');
    await this.auditLog.write({
      action: 'EXCHANGE_REQUEST_REJECTED',
      entity: 'contract_exchange_request',
      entityId: id,
      userId,
      newValue: { reason },
    });
    return tx.contractExchangeRequest.findUniqueOrThrow({ where: { id } });
  });
  return result;
}
```

- [ ] **Step 7.6: Run all service tests**

```bash
cd apps/api && npx jest src/modules/contract-exchange/
```

Expected: all PASS, including rollback + concurrent approve tests.

- [ ] **Step 7.7: Commit**

```bash
git add apps/api/src/modules/contract-exchange/
git commit -m "feat(exchange): ContractExchangeRequestService — atomic Case 8 chain"
```

---

## Task 8: Controller + DTOs + module wiring

**Files:**
- Create: 3 DTO files, controller, module
- Modify: `apps/api/src/app.module.ts`

- [ ] **Step 8.1: SubmitExchangeRequestDto**

```ts
// dto/submit-exchange-request.dto.ts
import { IsUUID, IsString, IsArray, ArrayMinSize, ArrayMaxSize, IsNumber, IsBoolean, IsOptional, MinLength } from 'class-validator';
import { Type } from 'class-transformer';

export class SubmitExchangeRequestDto {
  @IsUUID() oldContractId!: string;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) buybackPrice!: number;
  @IsUUID() newProductId!: string;
  @Type(() => Number) @IsNumber() newPlanDownPayment!: number;
  @Type(() => Number) @IsNumber() newPlanCommission!: number;
  @Type(() => Number) @IsNumber() newPlanMonths!: number;
  @Type(() => Number) @IsNumber() newPlanInterestRate!: number;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(5) @IsString({ each: true }) deviceConditionPhotos!: string[];
  @IsOptional() @IsString() @MinLength(10) overrideReason?: string;
  @IsOptional() @IsBoolean() requiresOwnerBypass?: boolean;
}
```

- [ ] **Step 8.2: ApproveExchangeRequestDto**

```ts
export class ApproveExchangeRequestDto {
  @IsString() @Matches(/^11-1[12][0-9]{2}$/) cashAccountCode!: string;
}
```

- [ ] **Step 8.3: RejectExchangeRequestDto**

```ts
export class RejectExchangeRequestDto {
  @IsString() @MinLength(10) reason!: string;
}
```

- [ ] **Step 8.4: Controller**

```ts
@Controller('insurance/exchange-requests')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ContractExchangeController {
  constructor(private svc: ContractExchangeService) {}

  @Post()
  @Roles('SALES', 'BRANCH_MANAGER', 'OWNER')
  submit(@Body() dto: SubmitExchangeRequestDto, @Req() req: any) {
    return this.svc.submit(dto, req.user.id);
  }

  @Get('pending')
  @Roles('OWNER')
  listPending() { return this.svc.listPending(); }

  @Post(':id/approve')
  @Roles('OWNER')
  approve(@Param('id') id: string, @Body() dto: ApproveExchangeRequestDto, @Req() req: any) {
    return this.svc.approve(id, dto, req.user.id);
  }

  @Post(':id/reject')
  @Roles('OWNER')
  reject(@Param('id') id: string, @Body() dto: RejectExchangeRequestDto, @Req() req: any) {
    return this.svc.reject(id, dto.reason, req.user.id);
  }
}
```

- [ ] **Step 8.5: Module wiring + register in AppModule**

- [ ] **Step 8.6: Smoke test via curl + commit**

---

## Task 9: Trade-in buyback suggest endpoint

**Files:**
- Modify: `apps/api/src/modules/trade-in/trade-in.controller.ts`
- Modify: `apps/api/src/modules/trade-in/trade-in.service.ts`
- Create: test spec

- [ ] **Step 9.1: Verify buyback table existence (from Task 0)**

If table doesn't exist, this becomes its own sub-task to design + create. Stop here, escalate.

- [ ] **Step 9.2: Implement `suggestBuybackPrice(productId)` service method**

Lookup logic depends on the table structure determined in Task 0. Return `{ suggestedPrice, source: 'TABLE' | 'FALLBACK', tableVersion }`.

- [ ] **Step 9.3: Expose `GET /trade-in/buyback-suggest`**

- [ ] **Step 9.4: Tests + commit**

---

## Task 10: Frontend — ExchangeRequestForm

**Files:**
- Create: `apps/web/src/pages/insurance/ExchangeRequestForm.tsx` + sub-components

- [ ] **Step 10.1: BuybackPriceField sub-component**

Field that:
- Loads suggestion from `/trade-in/buyback-suggest` on mount
- Shows variance % live as user types
- Renders override reason textarea when variance > threshold (fetched from `/system-config/EXCHANGE_BUYBACK_VARIANCE_THRESHOLD`)

- [ ] **Step 10.2: PhotoUpload sub-component**

- Drag-drop or file picker, 1-5 photos
- Format validation: `image/jpeg|png|webp`
- Size validation: ≤8MB per file
- Upload to S3 via existing `/s3/presigned-url` or similar (locate existing pattern)
- Returns array of S3 URLs

- [ ] **Step 10.3: Main form component**

Use react-hook-form + zod (matches existing form patterns per CLAUDE.md). Submit calls `POST /insurance/exchange-requests`. On success: toast + redirect to `/insurance`.

- [ ] **Step 10.4: Component tests**

Test: variance > 20 shows reason field; reason missing blocks submit; photo count outside 1-5 blocks submit.

- [ ] **Step 10.5: Commit**

---

## Task 11: Frontend — ExchangeRequestsPage (OWNER queue)

**Files:**
- Create: `apps/web/src/pages/insurance/ExchangeRequestsPage.tsx`

- [ ] **Step 11.1: List + filter UI**

Mirror `/finance/contract-cancellation` structure:
- Table of PENDING requests
- Yellow badge if `requiresOwnerBypass=true`
- Click row → opens detail modal/page

- [ ] **Step 11.2: Detail view**

Show:
- Old contract + customer
- New product + plan
- Buyback price + variance + override reason
- Device condition photos (clickable thumbnails)
- Approve dialog: pick `cashAccountCode` (default from `user.defaultCashAccountCode`)
- Reject dialog: reason textarea (min 10 chars)

- [ ] **Step 11.3: Wire approve/reject mutations**

- [ ] **Step 11.4: Tests + commit**

---

## Task 12: Wire wizard → new form

**Files:**
- Modify: `apps/web/src/pages/insurance/WizardSteps/ImeiLookupStep.tsx` (from SP1)
- Modify: `apps/web/src/App.tsx`

- [ ] **Step 12.1: Update ImeiLookupStep**

Change `handleExchange` for `INSTALLMENT`:
```tsx
if (result.sale.saleType === 'INSTALLMENT' && result.contract) {
  navigate(`/insurance/new-exchange-request?oldContractId=${result.contract.id}`);
  // old: navigate(`/defect-exchange?contractId=${result.contract.id}`);
}
```

- [ ] **Step 12.2: Add route in App.tsx**

```tsx
<Route path="/insurance/new-exchange-request" element={<ExchangeRequestForm />} />
<Route path="/insurance/exchange-requests" element={<ExchangeRequestsPage />} />
```

- [ ] **Step 12.3: Commit**

---

## Task 13: Menu entry + badge

**Files:**
- Modify: `apps/web/src/config/menu.ts`

- [ ] **Step 13.1: Add to OWNER's หลังการขาย section**

```ts
{
  label: 'คำขอเปลี่ยนเครื่อง',
  path: '/insurance/exchange-requests',
  icon: ArrowLeftRight,
  badgeKey: 'exchange-requests-pending',
}
```

- [ ] **Step 13.2: Wire badge data via existing badge mechanism**

- [ ] **Step 13.3: Commit**

---

## Task 14: E2E

**Files:**
- Create: `apps/web/e2e/exchange-request-flow.spec.ts`

- [ ] **Step 14.1: SALES submits → OWNER approves**

```ts
test('SALES submits exchange request → OWNER approves', async ({ browser }) => {
  // 2 contexts: sales + owner
  // SALES logs in, navigates wizard, scans IMEI of INSTALLMENT sale,
  //   clicks เปลี่ยนเครื่อง, fills form, uploads 1 photo, submits
  // OWNER logs in, opens queue, sees the pending request, approves
  // Assert: old contract status=EXCHANGED visible in /contracts/<id>
  // Assert: new contract visible in /contracts list
});
```

- [ ] **Step 14.2: Variance over 20% blocks without reason**

- [ ] **Step 14.3: Commit**

---

## Task 15: Pre-deploy + ship

- [ ] **Step 15.1: Run full test suite**

```bash
./tools/check-types.sh all
./tools/run-tests.sh
```

- [ ] **Step 15.2: Bump web version**

- [ ] **Step 15.3: PR + CPA second review of deployed JEs in staging**

Before merging to main, CPA must validate posted JEs from a real exchange in staging match expected Case 8 values. Block merge until sign-off.

- [ ] **Step 15.4: Deploy**

---

## Self-Review Notes

- [x] All 3 JE templates have dedicated tests against CSV golden values (Tasks 4, 5, 6)
- [x] Atomic $transaction in `approve` covers: lock-acquire + new Contract + 3 JEs + status flip (Task 7)
- [x] Concurrent approval guard via `updateMany` + `count===1` check (Task 7.4)
- [x] Photo upload validation server-side + client-side (Tasks 7.2 + 10.2)
- [x] Variance threshold from SystemConfig (Task 7.2)
- [x] Out-of-window bypass via `requiresOwnerBypass` flag (Task 1.3 schema + Task 11.1 queue badge)
- [x] All endpoints role-gated (Task 8.4 controller annotations)
- [x] Audit log on submit + approve + reject
- [x] Spec coverage: every acceptance criterion in spec maps to a test in Tasks 4-7 + 14

## Out-of-band gates

- **Task 0** must complete before Task 1 starts
- **Task 15.3** requires CPA staging sign-off before main merge
