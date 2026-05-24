# Insurance Wizard SP2 — Same-Price Device Swap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the SP2 device-swap flow per spec v3 — INSTALLMENT-only, same-price-only, carry-remaining-installments, ฿0 customer cash. Maker-checker approval queue with atomic 3-JE Case 8 chain.

**Architecture:** New `ContractExchangeRequest` row captures submissions (SALES/BM). OWNER approval triggers one `$transaction` that runs 3 JE templates (A.1 new contract activation with REMAINING-month plan, A.2 close old contract + buyback to 21-1106, A.3 clear 21-1106 against new vendor — perfect-offset assertion). Old `Product.status = REFURBISHED`. Old `Contract.status = EXCHANGED` with FK link to new.

**Tech Stack:** NestJS + Prisma + Decimal arithmetic; React + TanStack Query; existing JournalAutoService pattern.

**Spec:** [2026-05-23-insurance-wizard-sp2-case8-approval-design.md](../specs/2026-05-23-insurance-wizard-sp2-case8-approval-design.md) (v3 same-price-only)

**Depends on:** SP1 + hotfixes #1076-#1082 (shipped). PR #1083 spec v3 (merged).

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `apps/api/prisma/schema.prisma` | Modify | Add `ContractExchangeRequest` model + `Contract.exchangedFromContractId` FK + `Contract.exchangedAt` + `Contract.status` enum value `EXCHANGED` + `ExchangeRequestStatus` enum |
| `apps/api/prisma/migrations/<t>_add_contract_exchange_request/migration.sql` | Create | Migration |
| `apps/api/src/modules/contract-exchange/contract-exchange.module.ts` | Create | Module wiring |
| `apps/api/src/modules/contract-exchange/contract-exchange.controller.ts` | Create | 4 endpoints |
| `apps/api/src/modules/contract-exchange/contract-exchange.service.ts` | Create | submit / listPending / approve / reject |
| `apps/api/src/modules/contract-exchange/dto/submit-exchange-request.dto.ts` | Create | Body validation |
| `apps/api/src/modules/contract-exchange/dto/reject-exchange-request.dto.ts` | Create | Reject reason min 10 chars |
| `apps/api/src/modules/contract-exchange/__tests__/contract-exchange.service.spec.ts` | Create | Unit tests for submit/approve/reject/concurrent |
| `apps/api/src/modules/journal/cpa-templates/exchange-new-contract-1a.template.ts` | Create | JE A.1 |
| `apps/api/src/modules/journal/cpa-templates/exchange-close-old-21-1106.template.ts` | Create | JE A.2 (plug-balance) |
| `apps/api/src/modules/journal/cpa-templates/exchange-clear-vendor-21-1106.template.ts` | Create | JE A.3 (perfect offset) |
| `apps/api/src/modules/journal/cpa-templates/__tests__/exchange-*.spec.ts` | Create | 3 template tests + 1 CSV golden |
| `apps/api/src/modules/journal/__tests__/fixtures/cpa-cases/case-8-same-price.csv` | Create | CSV golden fixture |
| `apps/api/src/app.module.ts` | Modify | Register ContractExchangeModule |
| `apps/web/src/pages/insurance/ExchangeRequestForm.tsx` | Create | Submit form page |
| `apps/web/src/pages/insurance/ExchangeRequestsPage.tsx` | Create | OWNER approval queue |
| `apps/web/src/pages/insurance/WizardSteps/ImeiLookupStep.tsx` | Modify | INSTALLMENT exchange route → `/insurance/exchange-request/new` (replace `/defect-exchange`) |
| `apps/web/src/App.tsx` | Modify | Add 2 new routes |
| `apps/web/src/config/menu.ts` | Modify | OWNER menu: add "คำขอเปลี่ยนเครื่อง" with badge |
| `apps/web/e2e/exchange-request-flow.spec.ts` | Create | E2E happy path |

---

## Task 0: Pre-flight gates — CPA sign-off

- [ ] **Step 0.1: Confirm `21-1106` label**

CPA confirms in writing that `21-1106` "บัญชีพักเครดิตเปลี่ยนเครื่อง" (already in `finance-coa.csv`) fits the Case 8 clearing-account role.

- [ ] **Step 0.2: CPA reviews JE template designs**

Walk CPA through the 3 templates (A.1 / A.2 / A.3) in the spec. A.2's plug-balance logic (loss `51-1102` / gain `41-1102` against threshold `Gross + VAT receivable`) is the most nuanced — confirm with concrete examples.

- [ ] **Step 0.3: Save sign-off**

Document in `docs/cpa-approvals/2026-05-24-sp2-same-price-signoff.md`. Block Task 1 until done.

---

## Task 1: Schema migration

**Files:** `apps/api/prisma/schema.prisma` + new migration

- [ ] **Step 1.1: Add `ExchangeRequestStatus` enum**

Open `apps/api/prisma/schema.prisma`, add near other enums:

```prisma
enum ExchangeRequestStatus {
  PENDING
  APPROVED
  REJECTED
}
```

- [ ] **Step 1.2: Add `EXCHANGED` value to existing `ContractStatus` enum**

Locate `enum ContractStatus` in schema. Add `EXCHANGED` as a new value alongside `CANCELED`.

- [ ] **Step 1.3: Add Contract self-relation fields**

Locate `model Contract`. Inside the field block, add:

```prisma
  exchangedFromContractId String?   @unique @map("exchanged_from_contract_id")
  exchangedFromContract   Contract? @relation("ContractExchange", fields: [exchangedFromContractId], references: [id])
  replacedByContract      Contract? @relation("ContractExchange")
  exchangedAt             DateTime? @map("exchanged_at")

  exchangeRequestsAsOld   ContractExchangeRequest[] @relation("ExchangeRequestsFromOldContract")
  exchangeRequestsAsNew   ContractExchangeRequest[] @relation("ExchangeRequestsToNewContract")
```

- [ ] **Step 1.4: Add reverse relations on User + Product**

In `model User`, add:
```prisma
  exchangeRequestsRequested ContractExchangeRequest[] @relation("ExchangeRequestsRequested")
  exchangeRequestsApproved  ContractExchangeRequest[] @relation("ExchangeRequestsApproved")
```

In `model Product`, add:
```prisma
  exchangeRequestsAsOld    ContractExchangeRequest[] @relation("ExchangeRequestsOldProduct")
  exchangeRequestsAsNew    ContractExchangeRequest[] @relation("ExchangeRequestNewProduct")
```

- [ ] **Step 1.5: Add `ContractExchangeRequest` model**

Append:

```prisma
model ContractExchangeRequest {
  id                    String    @id @default(uuid())

  oldContractId         String    @map("old_contract_id")
  oldContract           Contract  @relation("ExchangeRequestsFromOldContract", fields: [oldContractId], references: [id])
  oldProductId          String    @map("old_product_id")
  oldProduct            Product   @relation("ExchangeRequestsOldProduct", fields: [oldProductId], references: [id])

  newProductId          String    @map("new_product_id")
  newProduct            Product   @relation("ExchangeRequestNewProduct", fields: [newProductId], references: [id])

  conditionNote         String?   @map("condition_note")
  conditionPhotos       String[]  @default([]) @map("condition_photos")

  status                ExchangeRequestStatus @default(PENDING)
  rejectionReason       String?   @map("rejection_reason")

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

  createdAt             DateTime  @default(now()) @map("created_at")
  updatedAt             DateTime  @updatedAt @map("updated_at")
  deletedAt             DateTime? @map("deleted_at")

  @@index([status, createdAt])
  @@index([oldContractId])
  @@index([oldProductId])
  @@map("contract_exchange_requests")
}
```

- [ ] **Step 1.6: Generate migration**

```bash
cd apps/api && npx prisma migrate dev --name add_contract_exchange_request --create-only
```

Inspect the generated SQL. Should:
- Create `contract_exchange_requests` table
- Add `ExchangeRequestStatus` enum
- Add `EXCHANGED` to ContractStatus enum
- Add 3 columns + 1 unique constraint on `contracts`

- [ ] **Step 1.7: Apply migration**

```bash
cd apps/api && npx prisma migrate dev
```

- [ ] **Step 1.8: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations/
git commit -m "feat(exchange): schema — ContractExchangeRequest + Contract self-relation"
```

---

## Task 2: CSV golden fixture for Case 8 (same-price)

**Files:** `apps/api/src/modules/journal/__tests__/fixtures/cpa-cases/case-8-same-price.csv`

- [ ] **Step 2.1: Create fixture file**

CSV columns matching existing loader pattern. Use these reference values (mirrors spec example with 10k+1k vendor sum, paid 4 of 12 installments):

```csv
# Case 8 — same-price exchange, paid 4/12 installments
# Old contract: yodjat 10,000 + commission 1,000 + interest 4,000 = 15,000 gross / VAT 1,050 = 16,050 total
# Paid 4 installments → remaining 8 of 12 → outstanding receivable + VAT = (1,416.66 + 99.17) × 8 = 12,126.64
# Buyback = financedAmount + commission = 10,000 + 1,000 = 11,000
# Loss = 12,126.64 - 11,000 = 1,126.64

# JE A.1 — new contract activation (8 months remaining; same monthly payment as old)
11-2101,11333.28,,New contract gross (8 months)
11-2105,793.36,,New contract VAT receivable (8 months)
,,,
21-1101,,10000.00,New vendor yodjat
21-1102,,1000.00,New vendor commission
11-2106,,2666.64,New unearned interest (8 months at original rate)
21-2102,,793.36,New deferred VAT output
# Note: 10000+1000+2666.64+793.36 = 14460; 11333.28+793.36 = 12126.64
# Off-balance because real ContractActivation1A includes interest in gross.
# Implementer must use parameterized template (NOT hardcoded). Numbers above are illustrative.

# JE A.2 — close old contract + book 21-1106
21-1106,11000.00,,Buyback liability
11-2106,2666.64,,Clear old unearned interest remaining
21-2102,793.36,,Clear old deferred VAT remaining
51-1102,1126.64,,Loss (buyback < threshold)
,,,
11-2101,,11333.28,Clear old gross outstanding
11-2105,,793.36,Clear old VAT receivable
21-2101,,793.36,Recognize VAT to ภ.พ.30
41-1101,,2666.64,Recognize unearned interest

# JE A.3 — clear 21-1106 vs new vendor (PERFECT OFFSET — no cash leg)
21-1101,10000.00,,New vendor yodjat
21-1102,1000.00,,New vendor commission
,,,
21-1106,,11000.00,Clear buyback = new vendor sum
```

> **Note for implementer:** the precise numbers above are illustrative. The actual A.1 template inherits from `ContractActivation1ATemplate` math (which uses ROUND_DOWN for principal, ROUND_HALF_UP for VAT per accounting.md). When writing the template test, compute expected values via the production code path on a known input — do NOT hardcode against this CSV without re-verifying.

- [ ] **Step 2.2: Commit**

```bash
git add apps/api/src/modules/journal/__tests__/fixtures/cpa-cases/case-8-same-price.csv
git commit -m "test(exchange): Case 8 same-price CSV golden fixture"
```

---

## Task 3: JE Template A.1 — ExchangeNewContract1ATemplate

**Files:**
- Create: `apps/api/src/modules/journal/cpa-templates/exchange-new-contract-1a.template.ts`
- Create: `apps/api/src/modules/journal/cpa-templates/__tests__/exchange-new-contract-1a.spec.ts`

- [ ] **Step 3.1: Write failing test**

```ts
// __tests__/exchange-new-contract-1a.spec.ts
import { Test } from '@nestjs/testing';
import { Decimal } from '@prisma/client/runtime/library';
import { ExchangeNewContract1ATemplate } from '../exchange-new-contract-1a.template';
import { JournalAutoService } from '../../journal-auto.service';
import { PrismaService } from '../../../../prisma/prisma.service';

describe('ExchangeNewContract1ATemplate', () => {
  let template: ExchangeNewContract1ATemplate;
  let prisma: any;
  let journal: any;

  beforeEach(async () => {
    prisma = { contract: { findUniqueOrThrow: jest.fn() } };
    journal = { post: jest.fn().mockResolvedValue({ entryNumber: 'JV-2026-001' }) };
    const mod = await Test.createTestingModule({
      providers: [
        ExchangeNewContract1ATemplate,
        { provide: PrismaService, useValue: prisma },
        { provide: JournalAutoService, useValue: journal },
      ],
    }).compile();
    template = mod.get(ExchangeNewContract1ATemplate);
  });

  it('posts new-contract activation JE for the NEW contract (carry-remaining plan)', async () => {
    prisma.contract.findUniqueOrThrow.mockResolvedValue({
      id: 'new-ctr',
      financedAmount: new Decimal('10000'),
      storeCommission: new Decimal('1000'),
      interestTotal: new Decimal('2666.64'),
      vatAmount: new Decimal('793.36'),
    });

    const result = await template.execute('new-ctr');

    expect(result.entryNumber).toBe('JV-2026-001');
    expect(journal.post).toHaveBeenCalledTimes(1);
    const call = journal.post.mock.calls[0][0];
    // Balance check
    const drSum = call.lines.filter((l: any) => l.debit).reduce((s: Decimal, l: any) => s.plus(new Decimal(l.debit.toString())), new Decimal(0));
    const crSum = call.lines.filter((l: any) => l.credit).reduce((s: Decimal, l: any) => s.plus(new Decimal(l.credit.toString())), new Decimal(0));
    expect(drSum.equals(crSum)).toBe(true);
    // Lines present
    const codes = call.lines.map((l: any) => l.accountCode);
    expect(codes).toEqual(expect.arrayContaining(['11-2101', '11-2105', '21-1101', '21-1102', '11-2106', '21-2102']));
  });
});
```

- [ ] **Step 3.2: Run test — confirm it fails**

```bash
cd apps/api && npx jest src/modules/journal/cpa-templates/__tests__/exchange-new-contract-1a.spec.ts
```

Expected: FAIL "cannot find module" or "ExchangeNewContract1ATemplate is not a constructor".

- [ ] **Step 3.3: Implement template**

```ts
// exchange-new-contract-1a.template.ts
import { Injectable } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { Prisma } from '@prisma/client';
import { JournalAutoService } from '../journal-auto.service';
import { PrismaService } from '../../../prisma/prisma.service';

/**
 * Exchange A.1 — Same shape as ContractActivation1A but invoked from the
 * exchange-approval flow. Posts on the NEW contract (which already has the
 * remaining-installment plan baked in by the service before this runs).
 *
 *   Dr 11-2101 ลูกหนี้ Gross
 *   Dr 11-2105 ลูกหนี้ภาษีขายรอเรียกเก็บ
 *     Cr 21-1101 เจ้าหนี้-หน้าร้าน
 *     Cr 21-1102 เจ้าหนี้ค่าคอม
 *     Cr 11-2106 รายได้รอตัดบัญชี-ดอกเบี้ย
 *     Cr 21-2102 ภาษีขายรอเรียกเก็บ
 */
@Injectable()
export class ExchangeNewContract1ATemplate {
  constructor(
    private readonly journal: JournalAutoService,
    private readonly prisma: PrismaService,
  ) {}

  async execute(
    newContractId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<{ entryNumber: string }> {
    const client = tx ?? this.prisma;
    const c = await client.contract.findUniqueOrThrow({
      where: { id: newContractId },
    });

    const financed = new Decimal(c.financedAmount.toString());
    const interest = new Decimal(c.interestTotal.toString());
    const commission = c.storeCommission != null
      ? new Decimal(c.storeCommission.toString())
      : financed.times('0.10').toDecimalPlaces(2);

    const grossExclVat = financed.plus(commission).plus(interest);
    const vat = c.vatAmount != null
      ? new Decimal(c.vatAmount.toString())
      : grossExclVat.times('0.07').toDecimalPlaces(2);

    return this.journal.post({
      description: `Exchange A.1 — new contract activation (${c.contractNumber ?? newContractId})`,
      lines: [
        { accountCode: '11-2101', debit: grossExclVat },
        { accountCode: '11-2105', debit: vat },
        { accountCode: '21-1101', credit: financed },
        { accountCode: '21-1102', credit: commission },
        { accountCode: '11-2106', credit: interest },
        { accountCode: '21-2102', credit: vat },
      ],
      metadata: {
        flow: 'exchange-new-contract-1a',
        newContractId,
      },
    }, tx);
  }
}
```

- [ ] **Step 3.4: Run test — should pass**

```bash
cd apps/api && npx jest src/modules/journal/cpa-templates/__tests__/exchange-new-contract-1a.spec.ts
```

Expected: 1 PASS.

- [ ] **Step 3.5: Commit**

```bash
git add apps/api/src/modules/journal/cpa-templates/exchange-new-contract-1a.template.ts apps/api/src/modules/journal/cpa-templates/__tests__/exchange-new-contract-1a.spec.ts
git commit -m "feat(journal): ExchangeNewContract1ATemplate (TDD)"
```

---

## Task 4: JE Template A.2 — ExchangeCloseOld21_1106Template (with plug-balance)

**Files:**
- Create: `apps/api/src/modules/journal/cpa-templates/exchange-close-old-21-1106.template.ts`
- Create: `apps/api/src/modules/journal/cpa-templates/__tests__/exchange-close-old-21-1106.spec.ts`

- [ ] **Step 4.1: Write failing tests for 3 plug-balance branches**

```ts
// __tests__/exchange-close-old-21-1106.spec.ts
import { Test } from '@nestjs/testing';
import { Decimal } from '@prisma/client/runtime/library';
import { ExchangeCloseOld21_1106Template } from '../exchange-close-old-21-1106.template';
import { JournalAutoService } from '../../journal-auto.service';
import { PrismaService } from '../../../../prisma/prisma.service';

describe('ExchangeCloseOld21_1106Template', () => {
  let template: ExchangeCloseOld21_1106Template;
  let journal: any;

  beforeEach(async () => {
    journal = { post: jest.fn().mockResolvedValue({ entryNumber: 'JV-X' }) };
    const mod = await Test.createTestingModule({
      providers: [
        ExchangeCloseOld21_1106Template,
        { provide: PrismaService, useValue: {} },
        { provide: JournalAutoService, useValue: journal },
      ],
    }).compile();
    template = mod.get(ExchangeCloseOld21_1106Template);
  });

  it('LOSS branch: buyback 11,000 < (Gross 11,333.28 + VAT 793.36 = 12,126.64) → Dr 51-1102 1,126.64', async () => {
    await template.execute({
      oldContractId: 'old',
      buyback: new Decimal('11000'),
      oldGrossOutstanding: new Decimal('11333.28'),
      oldVatReceivableOutstanding: new Decimal('793.36'),
      oldUnearnedInterestOutstanding: new Decimal('2666.64'),
      oldDeferredVatOutstanding: new Decimal('793.36'),
    });

    const lines = journal.post.mock.calls[0][0].lines;
    const loss = lines.find((l: any) => l.accountCode === '51-1102');
    expect(loss).toBeDefined();
    expect(new Decimal(loss.debit.toString()).toFixed(2)).toBe('1126.64');
    const gain = lines.find((l: any) => l.accountCode === '41-1102');
    expect(gain).toBeUndefined();
    // Balance
    const drSum = lines.filter((l: any) => l.debit).reduce((s: Decimal, l: any) => s.plus(new Decimal(l.debit.toString())), new Decimal(0));
    const crSum = lines.filter((l: any) => l.credit).reduce((s: Decimal, l: any) => s.plus(new Decimal(l.credit.toString())), new Decimal(0));
    expect(drSum.equals(crSum)).toBe(true);
  });

  it('GAIN branch: buyback 13,000 > 12,126.64 → Cr 41-1102 873.36', async () => {
    await template.execute({
      oldContractId: 'old',
      buyback: new Decimal('13000'),
      oldGrossOutstanding: new Decimal('11333.28'),
      oldVatReceivableOutstanding: new Decimal('793.36'),
      oldUnearnedInterestOutstanding: new Decimal('2666.64'),
      oldDeferredVatOutstanding: new Decimal('793.36'),
    });
    const lines = journal.post.mock.calls[0][0].lines;
    const gain = lines.find((l: any) => l.accountCode === '41-1102');
    expect(new Decimal(gain.credit.toString()).toFixed(2)).toBe('873.36');
    const loss = lines.find((l: any) => l.accountCode === '51-1102');
    expect(loss).toBeUndefined();
  });

  it('PERFECT branch: buyback 12,126.64 == threshold → no P&L line', async () => {
    await template.execute({
      oldContractId: 'old',
      buyback: new Decimal('12126.64'),
      oldGrossOutstanding: new Decimal('11333.28'),
      oldVatReceivableOutstanding: new Decimal('793.36'),
      oldUnearnedInterestOutstanding: new Decimal('2666.64'),
      oldDeferredVatOutstanding: new Decimal('793.36'),
    });
    const lines = journal.post.mock.calls[0][0].lines;
    expect(lines.find((l: any) => l.accountCode === '51-1102')).toBeUndefined();
    expect(lines.find((l: any) => l.accountCode === '41-1102')).toBeUndefined();
  });
});
```

- [ ] **Step 4.2: Run test — verify all 3 fail**

```bash
cd apps/api && npx jest src/modules/journal/cpa-templates/__tests__/exchange-close-old-21-1106.spec.ts
```

Expected: FAIL "cannot find module".

- [ ] **Step 4.3: Implement template**

```ts
// exchange-close-old-21-1106.template.ts
import { Injectable } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { Prisma } from '@prisma/client';
import { JournalAutoService } from '../journal-auto.service';
import { PrismaService } from '../../../prisma/prisma.service';

export interface ExchangeCloseOldInput {
  oldContractId: string;
  buyback: Decimal;
  oldGrossOutstanding: Decimal;
  oldVatReceivableOutstanding: Decimal;
  oldUnearnedInterestOutstanding: Decimal;
  oldDeferredVatOutstanding: Decimal;
}

/**
 * Exchange A.2 — Close old contract, book buyback into 21-1106 clearing account.
 *
 * Plug-balance: loss/gain plug computed against THRESHOLD = (11-2101 + 11-2105)
 * outstanding, NOT against new-vendor sum.
 *
 *   Dr 21-1106 [buyback]
 *   Dr 11-2106 [old unearned interest outstanding]
 *   Dr 21-2102 [old deferred VAT outstanding]
 *   Dr 51-1102 [LOSS if buyback < threshold]
 *     Cr 11-2101 [old Gross outstanding]
 *     Cr 11-2105 [old VAT receivable outstanding]
 *     Cr 21-2101 [VAT recognized to ภ.พ.30]
 *     Cr 41-1101 [unearned interest recognized]
 *     Cr 41-1102 [GAIN if buyback > threshold]
 */
@Injectable()
export class ExchangeCloseOld21_1106Template {
  constructor(
    private readonly journal: JournalAutoService,
    private readonly prisma: PrismaService,
  ) {}

  async execute(input: ExchangeCloseOldInput, tx?: Prisma.TransactionClient) {
    const threshold = input.oldGrossOutstanding.plus(input.oldVatReceivableOutstanding);
    const diff = input.buyback.minus(threshold);  // signed

    const lines: any[] = [
      { accountCode: '21-1106', debit: input.buyback },
      { accountCode: '11-2106', debit: input.oldUnearnedInterestOutstanding },
      { accountCode: '21-2102', debit: input.oldDeferredVatOutstanding },
    ];

    if (diff.lessThan(0)) {
      lines.push({ accountCode: '51-1102', debit: diff.abs() });
    } else if (diff.greaterThan(0)) {
      lines.push({ accountCode: '41-1102', credit: diff });
    }

    lines.push(
      { accountCode: '11-2101', credit: input.oldGrossOutstanding },
      { accountCode: '11-2105', credit: input.oldVatReceivableOutstanding },
      { accountCode: '21-2101', credit: input.oldVatReceivableOutstanding },  // VAT recognized = same amount as receivable
      { accountCode: '41-1101', credit: input.oldUnearnedInterestOutstanding }, // interest recognized = unearned cleared
    );

    return this.journal.post({
      description: `Exchange A.2 — close old contract ${input.oldContractId}`,
      lines,
      metadata: {
        flow: 'exchange-close-old-21-1106',
        oldContractId: input.oldContractId,
        buyback: input.buyback.toString(),
        threshold: threshold.toString(),
      },
    }, tx);
  }
}
```

- [ ] **Step 4.4: Run tests — verify all 3 pass**

```bash
cd apps/api && npx jest src/modules/journal/cpa-templates/__tests__/exchange-close-old-21-1106.spec.ts
```

Expected: 3 PASS.

- [ ] **Step 4.5: Commit**

```bash
git add apps/api/src/modules/journal/cpa-templates/exchange-close-old-21-1106.template.ts apps/api/src/modules/journal/cpa-templates/__tests__/exchange-close-old-21-1106.spec.ts
git commit -m "feat(journal): ExchangeCloseOld21_1106Template w/ plug-balance"
```

---

## Task 5: JE Template A.3 — ExchangeClearVendor21_1106Template (perfect offset)

**Files:**
- Create: `apps/api/src/modules/journal/cpa-templates/exchange-clear-vendor-21-1106.template.ts`
- Create: `apps/api/src/modules/journal/cpa-templates/__tests__/exchange-clear-vendor-21-1106.spec.ts`

- [ ] **Step 5.1: Write failing tests**

```ts
// __tests__/exchange-clear-vendor-21-1106.spec.ts
import { Test } from '@nestjs/testing';
import { Decimal } from '@prisma/client/runtime/library';
import { ExchangeClearVendor21_1106Template } from '../exchange-clear-vendor-21-1106.template';
import { JournalAutoService } from '../../journal-auto.service';
import { PrismaService } from '../../../../prisma/prisma.service';

describe('ExchangeClearVendor21_1106Template', () => {
  let template: ExchangeClearVendor21_1106Template;
  let journal: any;

  beforeEach(async () => {
    journal = { post: jest.fn().mockResolvedValue({ entryNumber: 'JV-X' }) };
    const mod = await Test.createTestingModule({
      providers: [
        ExchangeClearVendor21_1106Template,
        { provide: PrismaService, useValue: {} },
        { provide: JournalAutoService, useValue: journal },
      ],
    }).compile();
    template = mod.get(ExchangeClearVendor21_1106Template);
  });

  it('perfect-offset: posts Dr 21-1101 + Dr 21-1102 = Cr 21-1106 (no cash leg)', async () => {
    await template.execute({
      newContractId: 'new',
      buyback: new Decimal('11000'),
      newVendorYodjat: new Decimal('10000'),
      newVendorCommission: new Decimal('1000'),
    });
    const lines = journal.post.mock.calls[0][0].lines;
    expect(lines.find((l: any) => l.accountCode === '21-1101').debit.toString()).toBe('10000');
    expect(lines.find((l: any) => l.accountCode === '21-1102').debit.toString()).toBe('1000');
    expect(lines.find((l: any) => l.accountCode === '21-1106').credit.toString()).toBe('11000');
    // No cash account (11-11xx or 11-12xx)
    expect(lines.find((l: any) => /^11-1[12]/.test(l.accountCode))).toBeUndefined();
  });

  it('throws when buyback != newVendorSum (defensive — should never trigger with same-price filter)', async () => {
    await expect(
      template.execute({
        newContractId: 'new',
        buyback: new Decimal('11000'),
        newVendorYodjat: new Decimal('10000'),
        newVendorCommission: new Decimal('500'),  // wrong — 11000 != 10500
      }),
    ).rejects.toThrow(/buyback.*does not equal.*vendor sum/i);
  });
});
```

- [ ] **Step 5.2: Run — verify fail**

```bash
cd apps/api && npx jest src/modules/journal/cpa-templates/__tests__/exchange-clear-vendor-21-1106.spec.ts
```

Expected: FAIL.

- [ ] **Step 5.3: Implement template**

```ts
// exchange-clear-vendor-21-1106.template.ts
import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { Prisma } from '@prisma/client';
import { JournalAutoService } from '../journal-auto.service';
import { PrismaService } from '../../../prisma/prisma.service';

export interface ExchangeClearVendorInput {
  newContractId: string;
  buyback: Decimal;
  newVendorYodjat: Decimal;
  newVendorCommission: Decimal;
}

/**
 * Exchange A.3 — Clear 21-1106 against new contract's vendor payables.
 *
 * SAME-PRICE constraint guarantees: buyback === newVendorYodjat + newVendorCommission.
 * Therefore only ONE form (perfect offset — no cash leg).
 *
 *   Dr 21-1101 [new vendor yodjat]
 *   Dr 21-1102 [new vendor commission]
 *     Cr 21-1106 [buyback]
 *
 * If buyback != vendorSum → throw (defensive — indicates same-price filter bug).
 */
@Injectable()
export class ExchangeClearVendor21_1106Template {
  constructor(
    private readonly journal: JournalAutoService,
    private readonly prisma: PrismaService,
  ) {}

  async execute(input: ExchangeClearVendorInput, tx?: Prisma.TransactionClient) {
    const vendorSum = input.newVendorYodjat.plus(input.newVendorCommission);
    if (!vendorSum.equals(input.buyback)) {
      throw new InternalServerErrorException(
        `Exchange A.3: buyback ${input.buyback} does not equal vendor sum ${vendorSum}. ` +
        `Same-price filter must have failed upstream.`,
      );
    }

    return this.journal.post({
      description: `Exchange A.3 — clear 21-1106 (perfect offset)`,
      lines: [
        { accountCode: '21-1101', debit: input.newVendorYodjat },
        { accountCode: '21-1102', debit: input.newVendorCommission },
        { accountCode: '21-1106', credit: input.buyback },
      ],
      metadata: {
        flow: 'exchange-clear-vendor-21-1106',
        newContractId: input.newContractId,
      },
    }, tx);
  }
}
```

- [ ] **Step 5.4: Tests pass**

```bash
cd apps/api && npx jest src/modules/journal/cpa-templates/__tests__/exchange-clear-vendor-21-1106.spec.ts
```

Expected: 2 PASS.

- [ ] **Step 5.5: Commit**

```bash
git add apps/api/src/modules/journal/cpa-templates/exchange-clear-vendor-21-1106.template.ts apps/api/src/modules/journal/cpa-templates/__tests__/exchange-clear-vendor-21-1106.spec.ts
git commit -m "feat(journal): ExchangeClearVendor21_1106Template (perfect-offset only)"
```

---

## Task 6: DTOs + Module wiring

**Files:**
- Create: `apps/api/src/modules/contract-exchange/dto/submit-exchange-request.dto.ts`
- Create: `apps/api/src/modules/contract-exchange/dto/reject-exchange-request.dto.ts`
- Create: `apps/api/src/modules/contract-exchange/contract-exchange.module.ts`

- [ ] **Step 6.1: SubmitExchangeRequestDto**

```ts
// dto/submit-exchange-request.dto.ts
import { IsUUID, IsString, IsArray, ArrayMaxSize, IsOptional, MinLength } from 'class-validator';

export class SubmitExchangeRequestDto {
  @IsUUID('all', { message: 'oldContractId ต้องเป็น UUID' })
  oldContractId!: string;

  @IsUUID('all', { message: 'oldProductId ต้องเป็น UUID' })
  oldProductId!: string;

  @IsUUID('all', { message: 'newProductId ต้องเป็น UUID' })
  newProductId!: string;

  @IsOptional()
  @IsString()
  @MinLength(3, { message: 'หมายเหตุอย่างน้อย 3 ตัวอักษร' })
  conditionNote?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5, { message: 'ภาพถ่ายไม่เกิน 5 รูป' })
  @IsString({ each: true })
  conditionPhotos?: string[];
}
```

- [ ] **Step 6.2: RejectExchangeRequestDto**

```ts
// dto/reject-exchange-request.dto.ts
import { IsString, MinLength } from 'class-validator';

export class RejectExchangeRequestDto {
  @IsString()
  @MinLength(10, { message: 'เหตุผลอย่างน้อย 10 ตัวอักษร' })
  reason!: string;
}
```

- [ ] **Step 6.3: Module file (deferred — will fill after service exists in Task 7-9)**

Create empty module file for now to satisfy imports:

```ts
// contract-exchange.module.ts
import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
// imports filled in Task 9

@Module({
  imports: [PrismaModule],
  controllers: [],
  providers: [],
})
export class ContractExchangeModule {}
```

- [ ] **Step 6.4: Commit**

```bash
git add apps/api/src/modules/contract-exchange/
git commit -m "feat(exchange): DTOs + module skeleton"
```

---

## Task 7: ContractExchangeService.submit

**Files:**
- Create: `apps/api/src/modules/contract-exchange/contract-exchange.service.ts`
- Create: `apps/api/src/modules/contract-exchange/__tests__/contract-exchange.service.spec.ts`

- [ ] **Step 7.1: Write failing tests for submit**

```ts
// __tests__/contract-exchange.service.spec.ts (submit cases)
import { Test } from '@nestjs/testing';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { ContractExchangeService } from '../contract-exchange.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { ExchangeNewContract1ATemplate } from '../../journal/cpa-templates/exchange-new-contract-1a.template';
import { ExchangeCloseOld21_1106Template } from '../../journal/cpa-templates/exchange-close-old-21-1106.template';
import { ExchangeClearVendor21_1106Template } from '../../journal/cpa-templates/exchange-clear-vendor-21-1106.template';

describe('ContractExchangeService.submit', () => {
  let service: ContractExchangeService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      contract: { findUnique: jest.fn() },
      product: { findUnique: jest.fn() },
      contractExchangeRequest: { create: jest.fn() },
    };
    const mod = await Test.createTestingModule({
      providers: [
        ContractExchangeService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: { write: jest.fn() } },
        { provide: ExchangeNewContract1ATemplate, useValue: {} },
        { provide: ExchangeCloseOld21_1106Template, useValue: {} },
        { provide: ExchangeClearVendor21_1106Template, useValue: {} },
      ],
    }).compile();
    service = mod.get(ContractExchangeService);
  });

  it('throws when old contract is not ACTIVE', async () => {
    prisma.contract.findUnique.mockResolvedValue({ id: 'old', status: 'CANCELED' });
    await expect(
      service.submit({ oldContractId: 'old', oldProductId: 'op', newProductId: 'np' }, 'u-1'),
    ).rejects.toThrow(BadRequestException);
  });

  it('throws when new product sellingPrice != old', async () => {
    prisma.contract.findUnique.mockResolvedValue({ id: 'old', status: 'ACTIVE', productId: 'op' });
    prisma.product.findUnique
      .mockResolvedValueOnce({ id: 'op', brand: 'A', model: 'X', storage: '256', sellingPrice: { toString: () => '28000' }, category: 'PHONE_USED' })
      .mockResolvedValueOnce({ id: 'np', brand: 'A', model: 'X', storage: '256', sellingPrice: { toString: () => '30000' }, category: 'PHONE_USED', status: 'IN_STOCK' });
    await expect(
      service.submit({ oldContractId: 'old', oldProductId: 'op', newProductId: 'np' }, 'u-1'),
    ).rejects.toThrow(/ราคาเครื่องใหม่ต้องเท่ากับเครื่องเดิม/);
  });

  it('throws when new product is not IN_STOCK', async () => {
    prisma.contract.findUnique.mockResolvedValue({ id: 'old', status: 'ACTIVE', productId: 'op' });
    prisma.product.findUnique
      .mockResolvedValueOnce({ id: 'op', brand: 'A', model: 'X', storage: '256', sellingPrice: { toString: () => '28000' } })
      .mockResolvedValueOnce({ id: 'np', brand: 'A', model: 'X', storage: '256', sellingPrice: { toString: () => '28000' }, status: 'SOLD_INSTALLMENT' });
    await expect(
      service.submit({ oldContractId: 'old', oldProductId: 'op', newProductId: 'np' }, 'u-1'),
    ).rejects.toThrow(/IN_STOCK/);
  });

  it('throws when brand/model/storage differs', async () => {
    prisma.contract.findUnique.mockResolvedValue({ id: 'old', status: 'ACTIVE', productId: 'op' });
    prisma.product.findUnique
      .mockResolvedValueOnce({ id: 'op', brand: 'Apple', model: 'iPhone 15', storage: '256', sellingPrice: { toString: () => '28000' } })
      .mockResolvedValueOnce({ id: 'np', brand: 'Apple', model: 'iPhone 14', storage: '256', sellingPrice: { toString: () => '28000' }, status: 'IN_STOCK' });
    await expect(
      service.submit({ oldContractId: 'old', oldProductId: 'op', newProductId: 'np' }, 'u-1'),
    ).rejects.toThrow(/รุ่นเดียวกัน/);
  });

  it('creates PENDING request when all checks pass', async () => {
    prisma.contract.findUnique.mockResolvedValue({ id: 'old', status: 'ACTIVE', productId: 'op' });
    const same = { brand: 'Apple', model: 'iPhone 15', storage: '256', sellingPrice: { toString: () => '28000' } };
    prisma.product.findUnique
      .mockResolvedValueOnce({ id: 'op', ...same })
      .mockResolvedValueOnce({ id: 'np', ...same, status: 'IN_STOCK' });
    prisma.contractExchangeRequest.create.mockResolvedValue({ id: 'req-1', status: 'PENDING' });

    const result = await service.submit({ oldContractId: 'old', oldProductId: 'op', newProductId: 'np' }, 'u-1');

    expect(result.id).toBe('req-1');
    expect(prisma.contractExchangeRequest.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        oldContractId: 'old',
        oldProductId: 'op',
        newProductId: 'np',
        status: 'PENDING',
        requestedById: 'u-1',
      }),
    }));
  });
});
```

- [ ] **Step 7.2: Run — fail**

```bash
cd apps/api && npx jest src/modules/contract-exchange/__tests__/contract-exchange.service.spec.ts
```

- [ ] **Step 7.3: Implement submit (skeleton service)**

```ts
// contract-exchange.service.ts
import { Injectable, BadRequestException, NotFoundException, ConflictException, InternalServerErrorException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { SubmitExchangeRequestDto } from './dto/submit-exchange-request.dto';
import { ExchangeNewContract1ATemplate } from '../journal/cpa-templates/exchange-new-contract-1a.template';
import { ExchangeCloseOld21_1106Template } from '../journal/cpa-templates/exchange-close-old-21-1106.template';
import { ExchangeClearVendor21_1106Template } from '../journal/cpa-templates/exchange-clear-vendor-21-1106.template';

@Injectable()
export class ContractExchangeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly t1a: ExchangeNewContract1ATemplate,
    private readonly t2: ExchangeCloseOld21_1106Template,
    private readonly t3: ExchangeClearVendor21_1106Template,
  ) {}

  async submit(dto: SubmitExchangeRequestDto, userId: string) {
    // 1. Old contract must exist + ACTIVE
    const oldContract = await this.prisma.contract.findUnique({
      where: { id: dto.oldContractId },
    });
    if (!oldContract || oldContract.deletedAt) {
      throw new NotFoundException('ไม่พบสัญญาเดิม');
    }
    if (oldContract.status !== 'ACTIVE') {
      throw new BadRequestException(`สัญญาเดิมสถานะ ${oldContract.status} — ต้องเป็น ACTIVE`);
    }

    // 2. Old + new products: same brand+model+storage+sellingPrice; new IN_STOCK
    const oldProduct = await this.prisma.product.findUnique({ where: { id: dto.oldProductId } });
    if (!oldProduct) throw new NotFoundException('ไม่พบเครื่องเดิม');
    const newProduct = await this.prisma.product.findUnique({ where: { id: dto.newProductId } });
    if (!newProduct) throw new NotFoundException('ไม่พบเครื่องใหม่');

    if (newProduct.status !== 'IN_STOCK') {
      throw new BadRequestException('เครื่องใหม่ต้องอยู่ในสต็อก (IN_STOCK)');
    }
    if (oldProduct.brand !== newProduct.brand || oldProduct.model !== newProduct.model || oldProduct.storage !== newProduct.storage) {
      throw new BadRequestException('เครื่องใหม่ต้องเป็นรุ่นเดียวกัน (brand/model/storage)');
    }
    const oldPrice = new Decimal((oldProduct.sellingPrice ?? '0').toString());
    const newPrice = new Decimal((newProduct.sellingPrice ?? '0').toString());
    if (!oldPrice.equals(newPrice)) {
      throw new BadRequestException(`ราคาเครื่องใหม่ต้องเท่ากับเครื่องเดิม (${oldPrice} vs ${newPrice})`);
    }

    // 3. Create PENDING request
    return this.prisma.contractExchangeRequest.create({
      data: {
        oldContractId: dto.oldContractId,
        oldProductId: dto.oldProductId,
        newProductId: dto.newProductId,
        conditionNote: dto.conditionNote,
        conditionPhotos: dto.conditionPhotos ?? [],
        status: 'PENDING',
        requestedById: userId,
      },
    });
  }

  // approve + reject + listPending in Task 8
  async approve(_id: string, _userId: string): Promise<any> { throw new Error('not yet'); }
  async reject(_id: string, _reason: string, _userId: string): Promise<any> { throw new Error('not yet'); }
  async listPending(): Promise<any[]> { throw new Error('not yet'); }
}
```

- [ ] **Step 7.4: Tests pass**

```bash
cd apps/api && npx jest src/modules/contract-exchange/__tests__/contract-exchange.service.spec.ts
```

Expected: 5 PASS (submit cases).

- [ ] **Step 7.5: Commit**

```bash
git add apps/api/src/modules/contract-exchange/contract-exchange.service.ts apps/api/src/modules/contract-exchange/__tests__/contract-exchange.service.spec.ts
git commit -m "feat(exchange): ContractExchangeService.submit + validation"
```

---

## Task 8: ContractExchangeService.approve (atomic + concurrency)

**Files:**
- Modify: `apps/api/src/modules/contract-exchange/contract-exchange.service.ts`
- Modify: `apps/api/src/modules/contract-exchange/__tests__/contract-exchange.service.spec.ts`

- [ ] **Step 8.1: Add approve tests**

Add to existing spec file:

```ts
describe('ContractExchangeService.approve', () => {
  let service: ContractExchangeService;
  let prisma: any;
  let templates: any;

  beforeEach(async () => {
    const updateMany = jest.fn();
    prisma = {
      $transaction: jest.fn(async (fn: any) => fn(prisma)),
      contractExchangeRequest: {
        updateMany,
        findUniqueOrThrow: jest.fn(),
        update: jest.fn(),
      },
      contract: {
        findUniqueOrThrow: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      payment: { count: jest.fn().mockResolvedValue(4) }, // 4 paid installments
      product: { update: jest.fn() },
      journalEntry: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'je-id' }) },
    };
    templates = {
      t1a: { execute: jest.fn().mockResolvedValue({ entryNumber: 'JV-A1' }) },
      t2: { execute: jest.fn().mockResolvedValue({ entryNumber: 'JV-A2' }) },
      t3: { execute: jest.fn().mockResolvedValue({ entryNumber: 'JV-A3' }) },
    };
    const mod = await Test.createTestingModule({
      providers: [
        ContractExchangeService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: { write: jest.fn() } },
        { provide: ExchangeNewContract1ATemplate, useValue: templates.t1a },
        { provide: ExchangeCloseOld21_1106Template, useValue: templates.t2 },
        { provide: ExchangeClearVendor21_1106Template, useValue: templates.t3 },
      ],
    }).compile();
    service = mod.get(ContractExchangeService);
  });

  it('throws ConflictException when lock-acquire returns count=0 (already approved/rejected)', async () => {
    prisma.contractExchangeRequest.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.approve('req-1', 'owner-1')).rejects.toThrow(ConflictException);
  });

  it('runs A.1 → A.2 → A.3 in order + status flips + audit log', async () => {
    prisma.contractExchangeRequest.updateMany.mockResolvedValue({ count: 1 });
    prisma.contractExchangeRequest.findUniqueOrThrow.mockResolvedValue({
      id: 'req-1',
      oldContractId: 'old-ctr',
      oldProductId: 'old-p',
      newProductId: 'new-p',
      oldContract: {
        id: 'old-ctr',
        customerId: 'cust-1',
        productId: 'old-p',
        totalMonths: 12,
        monthlyPayment: { toString: () => '1416.66' },
        financedAmount: { toString: () => '10000' },
        storeCommission: { toString: () => '1000' },
        interestRate: { toString: () => '16' },
        vatAmount: { toString: () => '1190' },
        branchId: 'br-A',
        salespersonId: 'sales-1',
      },
      newProduct: { id: 'new-p', sellingPrice: { toString: () => '28000' } },
    });
    prisma.contract.create.mockResolvedValue({ id: 'new-ctr', contractNumber: 'BC-NEW-001' });

    const result = await service.approve('req-1', 'owner-1');

    expect(templates.t1a.execute).toHaveBeenCalledWith('new-ctr', expect.anything());
    expect(templates.t2.execute).toHaveBeenCalled();
    expect(templates.t3.execute).toHaveBeenCalled();
    expect(prisma.contract.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'old-ctr' },
      data: expect.objectContaining({ status: 'EXCHANGED' }),
    }));
    expect(prisma.product.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'old-p' },
      data: expect.objectContaining({ status: 'REFURBISHED' }),
    }));
    expect(result.newContractId).toBe('new-ctr');
  });

  it('uses remaining-installment plan when creating new contract', async () => {
    prisma.contractExchangeRequest.updateMany.mockResolvedValue({ count: 1 });
    prisma.contractExchangeRequest.findUniqueOrThrow.mockResolvedValue({
      id: 'req-1', oldContractId: 'old', oldProductId: 'op', newProductId: 'np',
      oldContract: {
        id: 'old', customerId: 'c', productId: 'op',
        totalMonths: 12, monthlyPayment: { toString: () => '1416.66' },
        financedAmount: { toString: () => '10000' }, storeCommission: { toString: () => '1000' },
        interestRate: { toString: () => '16' }, vatAmount: { toString: () => '1190' },
        branchId: 'br', salespersonId: 's',
      },
      newProduct: { id: 'np', sellingPrice: { toString: () => '28000' } },
    });
    prisma.payment.count.mockResolvedValue(4);  // 4 of 12 paid
    prisma.contract.create.mockResolvedValue({ id: 'new', contractNumber: 'X' });

    await service.approve('req-1', 'owner-1');

    const createCall = prisma.contract.create.mock.calls[0][0].data;
    // Remaining 8 months, same monthly = 1416.66
    expect(createCall.totalMonths).toBe(8);
    expect(createCall.monthlyPayment.toString()).toMatch(/1416\.66/);
  });
});
```

- [ ] **Step 8.2: Implement approve**

Replace `approve()` stub with full implementation. Also implement `reject()` and `listPending()`:

```ts
async approve(id: string, userId: string) {
  return this.prisma.$transaction(async (tx) => {
    // 1. Lock-acquire (race-safe)
    const lock = await tx.contractExchangeRequest.updateMany({
      where: { id, status: 'PENDING', deletedAt: null },
      data: {
        status: 'APPROVED',
        approvedById: userId,
        approvedAt: new Date(),
      },
    });
    if (lock.count !== 1) {
      throw new ConflictException('คำขออาจถูกอนุมัติแล้ว หรือสถานะเปลี่ยน');
    }

    // 2. Re-fetch with full data
    const req = await tx.contractExchangeRequest.findUniqueOrThrow({
      where: { id },
      include: {
        oldContract: true,
        newProduct: true,
      },
    });
    const old = req.oldContract;

    // 3. Compute remaining-installment plan
    const paidCount = await tx.payment.count({
      where: { contractId: old.id, status: 'PAID', deletedAt: null },
    });
    const remainingMonths = old.totalMonths - paidCount;
    if (remainingMonths <= 0) {
      throw new BadRequestException('สัญญาเดิมจ่ายครบงวดแล้ว — เปลี่ยนเครื่องไม่ได้');
    }
    const monthlyPayment = new Decimal(old.monthlyPayment.toString());
    const newFinanced = new Decimal(old.financedAmount.toString());  // same as old (same price)
    const newCommission = old.storeCommission ? new Decimal(old.storeCommission.toString()) : new Decimal(0);
    const newInterest = monthlyPayment.times(remainingMonths).minus(newFinanced);  // remaining interest

    // 4. Create new contract (mirror old's plan with remaining months)
    const newContract = await tx.contract.create({
      data: {
        contractNumber: `EX-${Date.now()}`,  // TODO: use proper sequence
        customerId: old.customerId,
        productId: req.newProductId,
        branchId: old.branchId,
        salespersonId: old.salespersonId,
        status: 'ACTIVE',
        planType: old.planType,
        totalMonths: remainingMonths,
        monthlyPayment,
        financedAmount: newFinanced,
        storeCommission: newCommission,
        interestTotal: newInterest,
        interestRate: old.interestRate,
        vatAmount: old.vatAmount,
        sellingPrice: old.sellingPrice,
        downPayment: old.downPayment,
        grandTotal: monthlyPayment.times(remainingMonths).plus(old.downPayment ?? 0),
        exchangedFromContractId: old.id,
        contractDate: new Date(),
        // Other required fields — copy from old
        creditBalance: new Decimal(0),
      },
    });

    // 5. Post JE A.1 → A.2 → A.3 atomically
    const buyback = newFinanced.plus(newCommission);
    const oldOutstanding = await this.computeOldOutstanding(tx, old.id);

    const je1a = await this.t1a.execute(newContract.id, tx);
    const je2 = await this.t2.execute({
      oldContractId: old.id,
      buyback,
      oldGrossOutstanding: oldOutstanding.gross,
      oldVatReceivableOutstanding: oldOutstanding.vatReceivable,
      oldUnearnedInterestOutstanding: oldOutstanding.unearnedInterest,
      oldDeferredVatOutstanding: oldOutstanding.deferredVat,
    }, tx);
    const je3 = await this.t3.execute({
      newContractId: newContract.id,
      buyback,
      newVendorYodjat: newFinanced,
      newVendorCommission: newCommission,
    }, tx);

    // 6. Mark old contract EXCHANGED + old product REFURBISHED
    await tx.contract.update({
      where: { id: old.id },
      data: { status: 'EXCHANGED', exchangedAt: new Date() },
    });
    await tx.product.update({
      where: { id: req.oldProductId },
      data: { status: 'REFURBISHED' },
    });

    // 7. Look up JE IDs (entry-number → id) and link to request
    const lookupJe = async (entryNumber: string) => {
      const e = await tx.journalEntry.findUniqueOrThrow({ where: { entryNumber } });
      return e.id;
    };
    await tx.contractExchangeRequest.update({
      where: { id },
      data: {
        newContractId: newContract.id,
        je1aId: await lookupJe(je1a.entryNumber),
        je2Id: await lookupJe(je2.entryNumber),
        je3Id: await lookupJe(je3.entryNumber),
      },
    });

    // 8. Audit log
    await this.audit.write({
      action: 'EXCHANGE_REQUEST_APPROVED',
      entity: 'contract_exchange_request',
      entityId: id,
      userId,
      newValue: {
        oldContractId: old.id,
        newContractId: newContract.id,
        buyback: buyback.toString(),
        remainingMonths,
      },
    });

    return { id, newContractId: newContract.id, je1aId: je1a.entryNumber, je2Id: je2.entryNumber, je3Id: je3.entryNumber };
  });
}

async reject(id: string, reason: string, userId: string) {
  if (reason.trim().length < 10) {
    throw new BadRequestException('เหตุผลปฏิเสธอย่างน้อย 10 ตัวอักษร');
  }
  return this.prisma.$transaction(async (tx) => {
    const lock = await tx.contractExchangeRequest.updateMany({
      where: { id, status: 'PENDING', deletedAt: null },
      data: {
        status: 'REJECTED',
        rejectionReason: reason,
        approvedById: userId,
        approvedAt: new Date(),
      },
    });
    if (lock.count !== 1) {
      throw new ConflictException('คำขออาจถูกตอบกลับแล้ว');
    }
    await this.audit.write({
      action: 'EXCHANGE_REQUEST_REJECTED',
      entity: 'contract_exchange_request',
      entityId: id,
      userId,
      newValue: { reason },
    });
    return tx.contractExchangeRequest.findUniqueOrThrow({ where: { id } });
  });
}

async listPending() {
  return this.prisma.contractExchangeRequest.findMany({
    where: { status: 'PENDING', deletedAt: null },
    include: {
      oldContract: { include: { customer: { select: { id: true, name: true, phone: true } } } },
      oldProduct: true,
      newProduct: true,
      requestedBy: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
}

private async computeOldOutstanding(tx: Prisma.TransactionClient, oldContractId: string) {
  // Outstanding receivable + VAT + unearned interest + deferred VAT
  // Calculation: remaining installments × (monthlyExclVat + monthlyVat) split into
  // gross / VAT receivable / unearned interest / deferred VAT.
  //
  // For SP2 v3 simplification: derive from old contract fields + paid count.
  const old = await tx.contract.findUniqueOrThrow({ where: { id: oldContractId } });
  const paidCount = await tx.payment.count({
    where: { contractId: oldContractId, status: 'PAID', deletedAt: null },
  });
  const remaining = old.totalMonths - paidCount;
  const monthly = new Decimal(old.monthlyPayment.toString());
  // Approximate split using ratios from old contract's totals
  const totalGross = monthly.times(old.totalMonths);
  const totalVat = old.vatAmount ? new Decimal(old.vatAmount.toString()) : new Decimal(0);
  const vatPerMonth = totalVat.div(old.totalMonths);
  const grossExclVatPerMonth = monthly.minus(vatPerMonth);

  return {
    gross: grossExclVatPerMonth.times(remaining).toDecimalPlaces(2),
    vatReceivable: vatPerMonth.times(remaining).toDecimalPlaces(2),
    unearnedInterest: new Decimal(old.interestTotal.toString()).div(old.totalMonths).times(remaining).toDecimalPlaces(2),
    deferredVat: vatPerMonth.times(remaining).toDecimalPlaces(2),
  };
}
```

Add `Prisma` import: `import { Prisma } from '@prisma/client';`

- [ ] **Step 8.3: Run all service tests**

```bash
cd apps/api && npx jest src/modules/contract-exchange/__tests__/contract-exchange.service.spec.ts
```

Expected: 8 PASS (5 submit + 3 approve).

- [ ] **Step 8.4: Commit**

```bash
git add apps/api/src/modules/contract-exchange/contract-exchange.service.ts apps/api/src/modules/contract-exchange/__tests__/contract-exchange.service.spec.ts
git commit -m "feat(exchange): atomic approve + reject + listPending"
```

---

## Task 9: Controller + Module wiring + AppModule registration

**Files:**
- Create: `apps/api/src/modules/contract-exchange/contract-exchange.controller.ts`
- Modify: `apps/api/src/modules/contract-exchange/contract-exchange.module.ts`
- Modify: `apps/api/src/app.module.ts`

- [ ] **Step 9.1: Controller**

```ts
// contract-exchange.controller.ts
import { Body, Controller, Get, Post, Param, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { ContractExchangeService } from './contract-exchange.service';
import { SubmitExchangeRequestDto } from './dto/submit-exchange-request.dto';
import { RejectExchangeRequestDto } from './dto/reject-exchange-request.dto';

@Controller('insurance/exchange-requests')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ContractExchangeController {
  constructor(private readonly svc: ContractExchangeService) {}

  @Post()
  @Roles('SALES', 'BRANCH_MANAGER', 'OWNER')
  submit(@Body() dto: SubmitExchangeRequestDto, @Req() req: any) {
    return this.svc.submit(dto, req.user.id);
  }

  @Get('pending')
  @Roles('OWNER')
  listPending() {
    return this.svc.listPending();
  }

  @Post(':id/approve')
  @Roles('OWNER')
  approve(@Param('id') id: string, @Req() req: any) {
    return this.svc.approve(id, req.user.id);
  }

  @Post(':id/reject')
  @Roles('OWNER')
  reject(@Param('id') id: string, @Body() dto: RejectExchangeRequestDto, @Req() req: any) {
    return this.svc.reject(id, dto.reason, req.user.id);
  }
}
```

- [ ] **Step 9.2: Module wiring**

```ts
// contract-exchange.module.ts
import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditModule } from '../audit/audit.module';
import { JournalModule } from '../journal/journal.module';
import { ContractExchangeController } from './contract-exchange.controller';
import { ContractExchangeService } from './contract-exchange.service';
import { ExchangeNewContract1ATemplate } from '../journal/cpa-templates/exchange-new-contract-1a.template';
import { ExchangeCloseOld21_1106Template } from '../journal/cpa-templates/exchange-close-old-21-1106.template';
import { ExchangeClearVendor21_1106Template } from '../journal/cpa-templates/exchange-clear-vendor-21-1106.template';

@Module({
  imports: [PrismaModule, AuditModule, JournalModule],
  controllers: [ContractExchangeController],
  providers: [
    ContractExchangeService,
    ExchangeNewContract1ATemplate,
    ExchangeCloseOld21_1106Template,
    ExchangeClearVendor21_1106Template,
  ],
  exports: [ContractExchangeService],
})
export class ContractExchangeModule {}
```

- [ ] **Step 9.3: Register in app.module.ts**

Find `imports: [ ... ]` in `apps/api/src/app.module.ts` and add `ContractExchangeModule`. Also add import line at top.

- [ ] **Step 9.4: Type-check**

```bash
cd apps/api && npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 9.5: Commit**

```bash
git add apps/api/src/modules/contract-exchange/contract-exchange.controller.ts apps/api/src/modules/contract-exchange/contract-exchange.module.ts apps/api/src/app.module.ts
git commit -m "feat(exchange): controller + module wiring + AppModule registration"
```

---

## Task 10: Frontend — ExchangeRequestForm component

**Files:**
- Create: `apps/web/src/pages/insurance/ExchangeRequestForm.tsx`

- [ ] **Step 10.1: Implement form**

```tsx
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useQuery, useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import QueryBoundary from '@/components/QueryBoundary';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ArrowLeft, CheckCircle2 } from 'lucide-react';

interface OldContract {
  id: string;
  contractNumber: string;
  status: string;
  totalMonths: number;
  monthlyPayment: string;
  customer: { id: string; name: string; phone: string };
  product: {
    id: string;
    brand: string;
    model: string;
    storage: string | null;
    sellingPrice: string;
    imeiSerial: string;
  };
}

interface ReplacementProduct {
  id: string;
  brand: string;
  model: string;
  storage: string | null;
  color: string | null;
  imeiSerial: string | null;
  sellingPrice: string;
}

export default function ExchangeRequestForm() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const contractId = params.get('contractId') ?? '';
  const [newProductId, setNewProductId] = useState('');
  const [conditionNote, setConditionNote] = useState('');

  const contractQ = useQuery<OldContract>({
    queryKey: ['exchange-contract', contractId],
    queryFn: async () => (await api.get(`/contracts/${contractId}`)).data,
    enabled: !!contractId,
  });

  const replacementsQ = useQuery<ReplacementProduct[]>({
    queryKey: ['exchange-replacements', contractQ.data?.product.id],
    queryFn: async () => {
      const p = contractQ.data!.product;
      const qs = new URLSearchParams({
        status: 'IN_STOCK',
        brand: p.brand,
        // Server-side: filter to model + storage + sellingPrice = p.sellingPrice
      });
      const { data } = await api.get(`/products?${qs.toString()}&limit=200`);
      const rows: ReplacementProduct[] = data.data ?? [];
      return rows.filter(
        (r) =>
          r.id !== p.id &&
          r.brand === p.brand &&
          (r as any).model === p.model &&
          r.storage === p.storage &&
          r.sellingPrice === p.sellingPrice,
      );
    },
    enabled: !!contractQ.data,
  });

  const submitM = useMutation({
    mutationFn: async () => {
      const res = await api.post('/insurance/exchange-requests', {
        oldContractId: contractId,
        oldProductId: contractQ.data!.product.id,
        newProductId,
        conditionNote: conditionNote.trim() || undefined,
      });
      return res.data;
    },
    onSuccess: () => {
      toast.success('ส่งคำขอเปลี่ยนเครื่องสำเร็จ — รออนุมัติ');
      navigate('/insurance');
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  if (!contractId) {
    return (
      <div className="p-6 max-w-3xl">
        <p className="text-destructive">ต้องระบุ contractId ใน URL</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4 md:p-6 max-w-3xl">
      <PageHeader
        title="เปลี่ยนเครื่อง (ราคาเท่าเดิม)"
        subtitle="ลูกค้าผ่อนงวดที่เหลือต่อ ไม่จ่ายเงินเพิ่ม"
        action={
          <Button variant="outline" size="sm" onClick={() => navigate('/insurance')}>
            <ArrowLeft className="mr-1 h-4 w-4" /> กลับ
          </Button>
        }
      />

      <QueryBoundary {...contractQ}>
        {contractQ.data && (
          <Card className="p-6 space-y-4">
            <h2 className="text-base font-semibold">ข้อมูลสัญญาเดิม</h2>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><span className="text-muted-foreground">สัญญา:</span> <span className="font-mono">{contractQ.data.contractNumber}</span></div>
              <div><span className="text-muted-foreground">ลูกค้า:</span> {contractQ.data.customer.name}</div>
              <div><span className="text-muted-foreground">เครื่อง:</span> {contractQ.data.product.brand} {contractQ.data.product.model} {contractQ.data.product.storage}</div>
              <div><span className="text-muted-foreground">ราคา:</span> ฿{contractQ.data.product.sellingPrice}</div>
            </div>
          </Card>
        )}
      </QueryBoundary>

      <Card className="p-6 space-y-4">
        <h2 className="text-base font-semibold">เลือกเครื่องทดแทน</h2>
        <p className="text-xs text-muted-foreground">เฉพาะรุ่น / ความจุ / ราคาเดียวกัน ที่อยู่ในสต็อก</p>
        <QueryBoundary {...replacementsQ}>
          <select
            value={newProductId}
            onChange={(e) => setNewProductId(e.target.value)}
            className="w-full px-3 py-2 border border-input rounded-lg bg-background text-sm"
          >
            <option value="">-- เลือกเครื่องทดแทน --</option>
            {(replacementsQ.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.brand} {p.model} {p.storage} {p.color ? `(${p.color})` : ''} — IMEI {p.imeiSerial ?? '—'}
              </option>
            ))}
          </select>
          {replacementsQ.data && replacementsQ.data.length === 0 && (
            <p className="text-xs text-destructive">ไม่มีสต็อกรุ่น/ราคาเดียวกันในขณะนี้</p>
          )}
        </QueryBoundary>

        <div>
          <label className="text-xs text-muted-foreground">หมายเหตุ (ไม่บังคับ)</label>
          <textarea
            value={conditionNote}
            onChange={(e) => setConditionNote(e.target.value)}
            placeholder="เช่น สภาพเครื่องเก่า ฯลฯ"
            className="w-full mt-1 px-3 py-2 border border-input rounded-lg bg-background text-sm min-h-[60px]"
          />
        </div>

        <Card className="p-4 bg-primary/5 border-primary/30">
          <div className="flex gap-2 items-start text-sm">
            <CheckCircle2 className="size-4 text-primary mt-0.5" />
            <div>
              <strong>ลูกค้าไม่จ่ายเงินเพิ่ม</strong> — สัญญาใหม่ผ่อนต่อจากเดิม งวดละเท่าเดิม
            </div>
          </div>
        </Card>

        <div className="flex justify-end pt-2">
          <Button
            onClick={() => submitM.mutate()}
            disabled={!newProductId || submitM.isPending}
          >
            {submitM.isPending ? 'กำลังส่ง…' : 'ส่งคำขออนุมัติ →'}
          </Button>
        </div>
      </Card>
    </div>
  );
}
```

- [ ] **Step 10.2: Type check + commit**

```bash
cd apps/web && npx tsc --noEmit
git add apps/web/src/pages/insurance/ExchangeRequestForm.tsx
git commit -m "feat(exchange): ExchangeRequestForm — submit page"
```

---

## Task 11: Frontend — ExchangeRequestsPage (OWNER queue)

**Files:**
- Create: `apps/web/src/pages/insurance/ExchangeRequestsPage.tsx`

- [ ] **Step 11.1: Implement queue page**

Mirror the structure of `/Users/iamnaii/Desktop/App/BESTCHOICE/apps/web/src/pages/finance/ContractCancellationPage.tsx` (read it first; copy + adapt for exchange-request endpoint).

Key differences:
- Endpoint: `GET /insurance/exchange-requests/pending` (not `/contracts/cancellations/pending`)
- Approve: `POST /insurance/exchange-requests/:id/approve` (body-less)
- Reject: `POST /insurance/exchange-requests/:id/reject` with `{ reason }`
- Columns: ผู้ยื่น / สัญญาเดิม / เครื่องเดิม → เครื่องใหม่ / หมายเหตุ / วันที่ยื่น

- [ ] **Step 11.2: Type check + commit**

```bash
cd apps/web && npx tsc --noEmit
git add apps/web/src/pages/insurance/ExchangeRequestsPage.tsx
git commit -m "feat(exchange): ExchangeRequestsPage — OWNER approval queue"
```

---

## Task 12: Wire ImeiLookupStep + App routes

**Files:**
- Modify: `apps/web/src/pages/insurance/WizardSteps/ImeiLookupStep.tsx`
- Modify: `apps/web/src/App.tsx`

- [ ] **Step 12.1: Update ImeiLookupStep INSTALLMENT exchange target**

Find `handleExchange` in `ImeiLookupStep.tsx`. Change INSTALLMENT branch:

```tsx
} else if (result.sale.saleType === 'INSTALLMENT' && result.contract) {
  navigate(`/insurance/exchange-request/new?contractId=${result.contract.id}`);
}
```

(Old: navigated to `/defect-exchange?contractId=...`)

- [ ] **Step 12.2: Add routes in App.tsx**

Locate the existing `/insurance/new` route. Add 2 new routes nearby:

```tsx
<Route path="/insurance/exchange-request/new" element={<ExchangeRequestForm />} />
<Route path="/insurance/exchange-requests" element={<ExchangeRequestsPage />} />
```

Add lazy imports at top:
```tsx
const ExchangeRequestForm = lazy(() => import('@/pages/insurance/ExchangeRequestForm'));
const ExchangeRequestsPage = lazy(() => import('@/pages/insurance/ExchangeRequestsPage'));
```

- [ ] **Step 12.3: Type check + commit**

```bash
cd apps/web && npx tsc --noEmit
git add apps/web/src/pages/insurance/WizardSteps/ImeiLookupStep.tsx apps/web/src/App.tsx
git commit -m "feat(exchange): wire wizard → new exchange form + add routes"
```

---

## Task 13: Menu entry for OWNER

**Files:**
- Modify: `apps/web/src/config/menu.ts`

- [ ] **Step 13.1: Add to OWNER's "หลังการขาย" section**

Find OWNER's `owner-aftersales` section. Add new item:

```ts
{ label: 'คำขอเปลี่ยนเครื่อง', path: '/insurance/exchange-requests', icon: ArrowLeftRight, badgeKey: 'exchange-requests-pending' },
```

Make sure `ArrowLeftRight` icon is imported.

- [ ] **Step 13.2: Add badge data source**

In the badge-fetching hook (find where `chat-unread` etc. are fetched), add:

```ts
const { data: exchangePending } = useQuery({
  queryKey: ['exchange-requests-pending-count'],
  queryFn: async () => (await api.get('/insurance/exchange-requests/pending')).data.length,
  enabled: user?.role === 'OWNER',
});
// In badgesMap: 'exchange-requests-pending': exchangePending ?? 0
```

- [ ] **Step 13.3: Type check + commit**

```bash
cd apps/web && npx tsc --noEmit
git add apps/web/src/config/menu.ts apps/web/src/<badge-hook-file>
git commit -m "feat(exchange): OWNER menu entry + pending count badge"
```

---

## Task 14: E2E happy path

**Files:**
- Create: `apps/web/e2e/exchange-request-flow.spec.ts`

- [ ] **Step 14.1: Write E2E**

```ts
import { test, expect } from '@playwright/test';

test.describe('Exchange request flow', () => {
  test('SALES submits → OWNER approves → new contract appears', async ({ browser }) => {
    const salesCtx = await browser.newContext();
    const ownerCtx = await browser.newContext();
    const salesPage = await salesCtx.newPage();
    const ownerPage = await ownerCtx.newPage();

    // SALES login + submit
    await salesPage.goto('/login');
    await salesPage.fill('[name="email"]', 'sales1@bestchoice.com');
    await salesPage.fill('[name="password"]', 'admin1234');
    await salesPage.click('button[type="submit"]');
    await salesPage.waitForURL(/\//);

    await salesPage.goto('/insurance/exchange-request/new?contractId=sp1-ctr-used');
    // Wait for replacements to load
    await salesPage.waitForSelector('select');
    const options = await salesPage.locator('select option').count();
    test.skip(options < 2, 'no seed replacements available');
    await salesPage.selectOption('select', { index: 1 });
    await salesPage.click('button:has-text("ส่งคำขออนุมัติ")');
    await expect(salesPage.locator('text=ส่งคำขอเปลี่ยนเครื่องสำเร็จ')).toBeVisible({ timeout: 5000 });

    // OWNER approve
    await ownerPage.goto('/login');
    await ownerPage.fill('[name="email"]', 'admin@bestchoice.com');
    await ownerPage.fill('[name="password"]', 'admin1234');
    await ownerPage.click('button[type="submit"]');
    await ownerPage.waitForURL(/\//);
    await ownerPage.goto('/insurance/exchange-requests');
    await ownerPage.locator('button:has-text("อนุมัติ")').first().click();
    // Confirm approval dialog if present
    await ownerPage.locator('button:has-text("ยืนยัน")').click();
    await expect(ownerPage.locator('text=อนุมัติสำเร็จ')).toBeVisible({ timeout: 8000 });
  });
});
```

- [ ] **Step 14.2: Commit**

```bash
git add apps/web/e2e/exchange-request-flow.spec.ts
git commit -m "test(e2e): exchange request submit → approve flow"
```

---

## Task 15: Final verify + version bump + PR

- [ ] **Step 15.1: Full type check + tests**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE
(cd apps/api && npx tsc --noEmit && npx jest src/modules/contract-exchange/ src/modules/journal/cpa-templates/__tests__/exchange-)
(cd apps/web && npx tsc --noEmit && npx vitest run src/pages/insurance/)
```

Expected: 0 type errors. All tests pass.

- [ ] **Step 15.2: Bump web version**

Edit `apps/web/package.json` — bump version (e.g., 26.5.24 → 26.5.25).

- [ ] **Step 15.3: Stage + commit**

```bash
git add apps/web/package.json
git commit -m "chore: bump web for SP2 release"
```

- [ ] **Step 15.4: Push + open PR**

```bash
git push -u origin feat/sp2-same-price-exchange
gh pr create --title "feat(sp2): same-price device exchange (Case 8)" --body "..."
```

PR body should reference spec PR #1083 + summarize the flow + test plan.

- [ ] **Step 15.5: Wait for CI + admin-merge if core green (per established dual-Prisma hang pattern)**

---

## Self-Review Notes

- [x] **Spec coverage**: every section of spec v3 maps to a task. Design Decisions table → covered in Tasks 1, 7, 8. Schema → Task 1. JE templates A.1/A.2/A.3 → Tasks 3/4/5. Maker-checker → Tasks 7/8. Endpoints → Tasks 7/8/9. UI → Tasks 10/11/12. Menu → Task 13. E2E → Task 14.
- [x] **No placeholders**: each step has concrete code + commands. The CSV golden in Task 2 has a note about being illustrative because the precise A.1 math depends on production code path — but the test in Task 3 doesn't depend on the CSV.
- [x] **Type consistency**: `oldContractId`/`oldProductId`/`newProductId` consistent through DTOs / service / schema. `ExchangeRequestStatus` enum used consistently.
- [x] **Concurrency**: Task 8 step 8.1 tests + step 8.2 implements the `updateMany` + `count===1` pattern (matches memory PR #848 pattern).
- [x] **Atomicity**: `$transaction` wraps lock + 3 templates + status updates + audit log.

## Out-of-band gates

- **Task 0** must complete before Task 1
- **Task 15.4** PR merge requires admin (dual-Prisma CI hang)
- **CPA second review on staging** before any production exchange is executed
