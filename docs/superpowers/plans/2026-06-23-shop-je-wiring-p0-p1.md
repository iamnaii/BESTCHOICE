# SHOP-side JE Wiring — P0 + P1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the SHOP-side journal-entry templates for the installment lifecycle so `/shop/accounting` Trial Balance + P&L reflect real activity, gated behind PEAK isolation.

**Architecture:** A new `ShopAccountResolver` maps product category → S-coded inventory/COGS/revenue accounts and branch → cash till. The 4 lifecycle templates (already built + golden-spec'd) are injected into their trigger services and called synchronously inside each trigger's existing Prisma `$transaction`, following the `contract-exchange.service.ts:396` pattern. A new finance-settlement module exposes the "FINANCE paid SHOP" action.

**Tech Stack:** NestJS, Prisma (PostgreSQL), TypeScript, jest (`--runInBand`).

**Spec:** `docs/superpowers/specs/2026-06-23-shop-je-wiring-design.md` (commit `bb3e50ac`). Branch: `feat/shop-je-wiring`.

**Scope:** P0 (prereqs) + P1 (installment lifecycle) only. P2 ShopCashSale / P3 ShopTradeIn / P4 ShopExpense are **separate follow-on plans** (each its own working deliverable) authored after P1 ships.

## Global Constraints

- **X5 is a hard gate:** no SHOP JE wiring (Tasks 5-8) may merge until both PEAK export queries are FINANCE-filtered (Tasks 1-2 on `main`).
- **Atomic (D-1):** every SHOP template is called with the trigger's outer `tx`; a SHOP-JE failure must roll back the host operation.
- **D-8:** `ShopInventoryTransfer` is fed `salePrice = downPayment + financedAmount` (NOT raw `sellingPrice`) so its strict financing-identity assertion holds by construction and can never throw at activation.
- **D-5:** TABLET reuses PHONE_NEW codes (S41-1101 / S50-1101 / S11-2001).
- **Money:** always `Decimal`; construct from Prisma decimals via `new Decimal(x.toString())`; never `Number()`.
- **Idempotency:** templates self-dedupe on `metadata.flow + metadata.idempotencyKey`; callers pass a stable key per entity.
- **SHOP companyId:** templates resolve it internally via `CompanyResolverService.getShopCompanyId(tx)`; callers do NOT pass companyId.
- **Account codes:** all SHOP codes are `S`-prefixed; templates throw `BadRequestException` on non-S codes.
- **Test runner:** `npm --prefix apps/api test -- <relativeSpecPath>` (the `test` script is `jest --runInBand --forceExit`).
- **Commit cadence:** one commit per task (after its tests pass).

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `apps/api/src/modules/peak/peak.service.ts` (modify) | add FINANCE companyId filter to `exportJournalEntries` | 1 |
| `apps/api/src/modules/peak/peak.service.spec.ts` (modify) | regression: findMany filtered by companyId | 1 |
| `apps/api/src/modules/accounting/peak-export.service.ts` (modify) | add FINANCE companyId filter to `exportJournalWithPeakCodes` | 2 |
| `apps/api/src/modules/accounting/peak-export.service.spec.ts` (create) | regression for path 2 | 2 |
| `apps/api/prisma/schema.prisma` + `migrations/20260974000000_add_shop_cash_account_code_to_branch/migration.sql` | `Branch.shopCashAccountCode` | 3 |
| `apps/api/src/modules/journal/shop-account-resolver.service.ts` (create) | category→S-codes + branch→cash, fail-closed | 4 |
| `apps/api/src/modules/journal/shop-account-resolver.service.spec.ts` (create) | resolver unit tests | 4 |
| `apps/api/src/modules/journal/journal.module.ts` (modify) | register + export `ShopAccountResolver` | 4 |
| `apps/api/src/modules/contracts/contract-workflow.service.ts` (modify) | inject + call `ShopInventoryTransferTemplate` in activate() standard branch | 5 |
| `apps/api/src/modules/contracts/contracts.module.ts` (modify) | provide resolver+template deps | 5 |
| `apps/api/src/modules/contracts/services/contract-lifecycle.service.ts` (modify) | call `ShopDownPaymentTemplate` in create() (guarded) + refactor softDelete() to callback `$tx` + `ShopDownPaymentReversalTemplate` | 6, 7 |
| `apps/api/src/modules/shop-finance-settlement/*` (create) | module + service + controller + DTO for ShopFinanceReceipt | 8 |
| `apps/api/src/app.module.ts` (modify) | register `ShopFinanceSettlementModule` | 8 |

---

## Task 1: X5 — FINANCE-filter `PeakService.exportJournalEntries`

**Files:**
- Modify: `apps/api/src/modules/peak/peak.service.ts:42-46` (ctor), `:70-87` (findMany)
- Test: `apps/api/src/modules/peak/peak.service.spec.ts:20-53` (providers)

**Interfaces:**
- Consumes: `CompanyResolverService.getFinanceCompanyId(tx?): Promise<string>` (exported by `JournalModule`, which `PeakModule` already imports).
- Produces: nothing new.

- [ ] **Step 1: Add the regression test.** In `peak.service.spec.ts`, add `{ provide: CompanyResolverService, useValue: { getFinanceCompanyId: jest.fn().mockResolvedValue('finance-co-id') } }` to the `providers` array (and `import { CompanyResolverService } from '../journal/company-resolver.service';`). Add this test:

```typescript
it('only exports FINANCE-company entries (X5 — SHOP S-prefix excluded)', async () => {
  mockPeakHeaders();
  prisma.journalEntry.findMany.mockResolvedValue([]);
  await service.exportJournalEntries(new Date('2026-06-01'), new Date('2026-06-30'));
  expect(prisma.journalEntry.findMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: expect.objectContaining({ companyId: 'finance-co-id' }),
    }),
  );
});
```

- [ ] **Step 2: Run it — expect FAIL** (`where` has no `companyId`).

Run: `npm --prefix apps/api test -- src/modules/peak/peak.service.spec.ts`
Expected: FAIL on the new test (`companyId` not in where).

- [ ] **Step 3: Implement.** Inject the resolver and filter:

```typescript
// top of file, with other imports
import { CompanyResolverService } from '../journal/company-resolver.service';

// constructor (peak.service.ts:42-46) — add the param
constructor(
  private prisma: PrismaService,
  private configService: ConfigService,
  private integrationConfig: IntegrationConfigService,
  private companyResolver: CompanyResolverService,
) {}

// inside exportJournalEntries, before the findMany (after the isConfigured guard):
const financeCompanyId = await this.companyResolver.getFinanceCompanyId();
const entries = await this.prisma.journalEntry.findMany({
  where: {
    status: 'POSTED',
    entryDate: { gte: startDate, lte: endDate },
    deletedAt: null,
    peakSyncedAt: null,
    companyId: financeCompanyId,
  },
  include: { lines: true, company: { select: { nameTh: true } } },
  orderBy: { entryDate: 'asc' },
});
```

- [ ] **Step 4: Run tests — expect PASS** (new test + existing suite).

Run: `npm --prefix apps/api test -- src/modules/peak/peak.service.spec.ts`
Expected: PASS (all).

- [ ] **Step 5: Commit.**

```bash
git add apps/api/src/modules/peak/peak.service.ts apps/api/src/modules/peak/peak.service.spec.ts
git commit -m "fix(peak): X5 — scope PEAK push export to FINANCE company (exclude SHOP S-prefix)"
```

---

## Task 2: X5 — FINANCE-filter `PeakExportService.exportJournalWithPeakCodes`

**Files:**
- Modify: `apps/api/src/modules/accounting/peak-export.service.ts:9-11` (ctor), `:60-88` (findMany)
- Test: `apps/api/src/modules/accounting/peak-export.service.spec.ts` (create)

**Interfaces:**
- Consumes: `CompanyResolverService.getFinanceCompanyId()` (exported by `JournalModule`, imported by `AccountingModule`).

- [ ] **Step 1: Write the failing test** (`peak-export.service.spec.ts`):

```typescript
import { Test } from '@nestjs/testing';
import { PeakExportService } from './peak-export.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CompanyResolverService } from '../journal/company-resolver.service';

describe('PeakExportService', () => {
  let service: PeakExportService;
  let prisma: any;

  beforeEach(async () => {
    prisma = { journalLine: { findMany: jest.fn().mockResolvedValue([]) }, chartOfAccount: { findMany: jest.fn().mockResolvedValue([]) } };
    const mod = await Test.createTestingModule({
      providers: [
        PeakExportService,
        { provide: PrismaService, useValue: prisma },
        { provide: CompanyResolverService, useValue: { getFinanceCompanyId: jest.fn().mockResolvedValue('finance-co-id') } },
      ],
    }).compile();
    service = mod.get(PeakExportService);
  });

  it('scopes the export to FINANCE company (X5)', async () => {
    await service.exportJournalWithPeakCodes(new Date('2026-06-01'), new Date('2026-06-30'));
    expect(prisma.journalLine.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          journalEntry: expect.objectContaining({ companyId: 'finance-co-id' }),
        }),
      }),
    );
  });
});
```

> If `exportJournalWithPeakCodes` has a different arg list, read `peak-export.service.ts:27` and match it; the assertion on `journalLine.findMany` where-clause is the load-bearing part.

- [ ] **Step 2: Run it — expect FAIL** (missing `companyId`; possibly also a DI error until ctor updated).

Run: `npm --prefix apps/api test -- src/modules/accounting/peak-export.service.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implement.**

```typescript
import { CompanyResolverService } from '../journal/company-resolver.service';

@Injectable()
export class PeakExportService {
  constructor(
    private prisma: PrismaService,
    private companyResolver: CompanyResolverService,
  ) {}
  // ... inside exportJournalWithPeakCodes, before the findMany:
  // const financeCompanyId = await this.companyResolver.getFinanceCompanyId();
  // then add `companyId: financeCompanyId` INSIDE the nested journalEntry: { ... } where block:
  //   journalEntry: { status: 'POSTED', entryDate: { gte: periodStart, lte: periodEnd }, deletedAt: null, companyId: financeCompanyId },
}
```

- [ ] **Step 4: Run tests — expect PASS.**

Run: `npm --prefix apps/api test -- src/modules/accounting/peak-export.service.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add apps/api/src/modules/accounting/peak-export.service.ts apps/api/src/modules/accounting/peak-export.service.spec.ts
git commit -m "fix(peak): X5 — scope CSV PEAK export to FINANCE company"
```

---

## Task 3: `Branch.shopCashAccountCode` column

**Files:**
- Modify: `apps/api/prisma/schema.prisma:538-585` (Branch model)
- Create: `apps/api/prisma/migrations/20260974000000_add_shop_cash_account_code_to_branch/migration.sql`

**Interfaces:**
- Produces: `Branch.shopCashAccountCode: string | null` (column `shop_cash_account_code`).

- [ ] **Step 1: Add the field to schema.prisma.** Inside `model Branch`, right after the `deletedAt DateTime? @map("deleted_at")` line:

```prisma
  shopCashAccountCode String?   @map("shop_cash_account_code")
```

- [ ] **Step 2: Create the migration SQL** at `apps/api/prisma/migrations/20260974000000_add_shop_cash_account_code_to_branch/migration.sql`:

```sql
-- Add the SHOP per-branch cash-till account code (S11-110x). Nullable: set per branch
-- in settings before SHOP cash-route JEs (down payment / cash sale / trade-in) post.
ALTER TABLE "branches" ADD COLUMN IF NOT EXISTS "shop_cash_account_code" TEXT;
```

- [ ] **Step 3: Regenerate the client + validate** (no DB needed for either):

Run: `cd apps/api && npx prisma generate && npx prisma validate`
Expected: "The schema ... is valid 🚀" and client regenerated (so `branch.shopCashAccountCode` typechecks in Task 4).

- [ ] **Step 4: Verify no drift for this table** (from-empty diff includes the new column):

Run: `cd /Users/iamnaii/Desktop/App/BESTCHOICE && npx prisma migrate diff --from-empty --to-schema-datamodel apps/api/prisma/schema.prisma --script | grep shop_cash_account_code`
Expected: a line containing `"shop_cash_account_code" TEXT` (confirms schema + intent match).

- [ ] **Step 5: Commit.**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations/20260974000000_add_shop_cash_account_code_to_branch/
git commit -m "feat(branch): add shopCashAccountCode (per-branch SHOP cash till) + migration"
```

---

## Task 4: `ShopAccountResolver`

**Files:**
- Create: `apps/api/src/modules/journal/shop-account-resolver.service.ts`
- Test: `apps/api/src/modules/journal/shop-account-resolver.service.spec.ts`
- Modify: `apps/api/src/modules/journal/journal.module.ts:40-49` (import), `:99-108` (providers), `:151-160` (exports)

**Interfaces:**
- Consumes: `PrismaService`; `Branch.shopCashAccountCode` (Task 3); `ProductCategory` from `@prisma/client`.
- Produces:
  - `resolveProductAccounts(category: ProductCategory): { inventoryAccountCode: string; cogsAccountCode: string; revenueAccountCode: string }` (sync)
  - `resolveBranchCashAccount(branchId: string, tx?: Prisma.TransactionClient): Promise<string>` (throws if unconfigured)
  - `static readonly SHOP_RECEIVING_BANK = 'S11-1201'`

- [ ] **Step 1: Write the failing test** (`shop-account-resolver.service.spec.ts`):

```typescript
import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ShopAccountResolver } from './shop-account-resolver.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('ShopAccountResolver', () => {
  let resolver: ShopAccountResolver;
  let prisma: any;

  beforeEach(async () => {
    prisma = { branch: { findUnique: jest.fn() } };
    const mod = await Test.createTestingModule({
      providers: [ShopAccountResolver, { provide: PrismaService, useValue: prisma }],
    }).compile();
    resolver = mod.get(ShopAccountResolver);
  });

  it('maps PHONE_NEW + TABLET to the new-phone S-codes', () => {
    const expected = { inventoryAccountCode: 'S11-2001', cogsAccountCode: 'S50-1101', revenueAccountCode: 'S41-1101' };
    expect(resolver.resolveProductAccounts('PHONE_NEW')).toEqual(expected);
    expect(resolver.resolveProductAccounts('TABLET')).toEqual(expected);
  });

  it('maps PHONE_USED and ACCESSORY to their S-codes', () => {
    expect(resolver.resolveProductAccounts('PHONE_USED')).toEqual({ inventoryAccountCode: 'S11-2002', cogsAccountCode: 'S50-1102', revenueAccountCode: 'S41-1102' });
    expect(resolver.resolveProductAccounts('ACCESSORY')).toEqual({ inventoryAccountCode: 'S11-2003', cogsAccountCode: 'S50-1103', revenueAccountCode: 'S41-1103' });
  });

  it('resolves a configured branch cash account', async () => {
    prisma.branch.findUnique.mockResolvedValue({ shopCashAccountCode: 'S11-1102' });
    await expect(resolver.resolveBranchCashAccount('br-1')).resolves.toBe('S11-1102');
  });

  it('fail-closed: throws when branch has no shopCashAccountCode', async () => {
    prisma.branch.findUnique.mockResolvedValue({ shopCashAccountCode: null });
    await expect(resolver.resolveBranchCashAccount('br-1')).rejects.toThrow(BadRequestException);
  });
});
```

- [ ] **Step 2: Run it — expect FAIL** (module not found).

Run: `npm --prefix apps/api test -- src/modules/journal/shop-account-resolver.service.spec.ts`
Expected: FAIL ("Cannot find module './shop-account-resolver.service'").

- [ ] **Step 3: Implement** `shop-account-resolver.service.ts`:

```typescript
import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma, ProductCategory } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export interface ShopProductAccounts {
  inventoryAccountCode: string;
  cogsAccountCode: string;
  revenueAccountCode: string;
}

/**
 * Single source of truth for resolving SHOP-side account codes:
 * product category → inventory/COGS/revenue S-codes, and branch → cash till.
 */
@Injectable()
export class ShopAccountResolver {
  /** SHOP bank that receives inflows (down/cash-sale transfer + FINANCE settlement). */
  static readonly SHOP_RECEIVING_BANK = 'S11-1201';
  /** SHOP bank that funds outflows (branch expenses, transfer trade-in payout). */
  static readonly SHOP_PAYING_BANK = 'S11-1202';

  constructor(private readonly prisma: PrismaService) {}

  /** TABLET reuses PHONE_NEW codes (D-5); dedicated tablet S-codes deferred. */
  resolveProductAccounts(category: ProductCategory): ShopProductAccounts {
    switch (category) {
      case 'PHONE_USED':
        return { inventoryAccountCode: 'S11-2002', cogsAccountCode: 'S50-1102', revenueAccountCode: 'S41-1102' };
      case 'ACCESSORY':
        return { inventoryAccountCode: 'S11-2003', cogsAccountCode: 'S50-1103', revenueAccountCode: 'S41-1103' };
      case 'PHONE_NEW':
      case 'TABLET':
        return { inventoryAccountCode: 'S11-2001', cogsAccountCode: 'S50-1101', revenueAccountCode: 'S41-1101' };
      default:
        throw new BadRequestException(`ShopAccountResolver: unknown ProductCategory "${category as string}"`);
    }
  }

  /** Fail-closed: a branch must have shopCashAccountCode set before SHOP cash JEs can post. */
  async resolveBranchCashAccount(branchId: string, tx?: Prisma.TransactionClient): Promise<string> {
    const client = (tx ?? this.prisma) as Prisma.TransactionClient;
    const branch = await client.branch.findUnique({
      where: { id: branchId },
      select: { shopCashAccountCode: true },
    });
    if (!branch?.shopCashAccountCode) {
      throw new BadRequestException(
        `ShopAccountResolver: branch ${branchId} has no shopCashAccountCode — set it in branch settings before posting SHOP cash entries`,
      );
    }
    return branch.shopCashAccountCode;
  }
}
```

- [ ] **Step 4: Register in `journal.module.ts`** — add `import { ShopAccountResolver } from './shop-account-resolver.service';` near line 40, and add `ShopAccountResolver,` to BOTH the providers array (near `CompanyResolverService` at :99-108) and the exports array (:151-160).

- [ ] **Step 5: Run tests — expect PASS.**

Run: `npm --prefix apps/api test -- src/modules/journal/shop-account-resolver.service.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit.**

```bash
git add apps/api/src/modules/journal/shop-account-resolver.service.ts apps/api/src/modules/journal/shop-account-resolver.service.spec.ts apps/api/src/modules/journal/journal.module.ts
git commit -m "feat(journal): add ShopAccountResolver (category->S-codes + branch->cash, fail-closed)"
```

---

## Task 5: Wire `ShopInventoryTransferTemplate` into `activate()` (atomic, standard branch)

**Files:**
- Modify: `apps/api/src/modules/contracts/contract-workflow.service.ts:25-33` (ctor), `:418-506` ($tx body, after the 1A call at :494)
- Modify: `apps/api/src/modules/contracts/contracts.module.ts` (ensure `ShopInventoryTransferTemplate` + `ShopAccountResolver` injectable — both exported by `JournalModule`, which the contracts module imports; no re-provide needed, just confirm the import)
- Test: `apps/api/src/modules/contracts/contract-workflow.service.spec.ts` (add a wiring test; create the file if absent following the `contract-exchange.service.spec.ts:1-63` pattern)

**Interfaces:**
- Consumes: `ShopInventoryTransferTemplate.execute(input: ShopInventoryTransferInput, outerTx?): Promise<ShopInventoryTransferResult>`; `ShopAccountResolver.resolveProductAccounts(category)`; `ShopDownPaymentTemplate.execute(...)` + `ShopAccountResolver.resolveBranchCashAccount(branchId, tx)` (in-flight catch-up only).
- Produces: posts the SHOP inventory-transfer JE pair inside the activation `$tx` (+ a catch-up down JE for pre-P1 contracts).

- [ ] **Step 1: Write the failing test.** In `contract-workflow.service.spec.ts`, build a `TestingModule` providing `ContractWorkflowService` with mocked `PrismaService`, `ShopInventoryTransferTemplate` (`{ execute: jest.fn().mockResolvedValue({ batchId:'b', cogsEntryNo:'c', cogsJournalEntryId:'cj', revenueEntryNo:'r', revenueJournalEntryId:'rj' }) }`), `ContractActivation1ATemplate` (`{ execute: jest.fn() }`), `ShopAccountResolver` (`{ resolveProductAccounts: jest.fn().mockReturnValue({ inventoryAccountCode:'S11-2001', cogsAccountCode:'S50-1101', revenueAccountCode:'S41-1101' }) }`), and the other ctor deps as `{}` mocks. Make `prisma.$transaction` invoke its callback with a `tx` mock. Assert:

```typescript
it('posts ShopInventoryTransfer with salePrice = down + financed at activation', async () => {
  // arrange: findOne returns an APPROVED/DRAFT standard contract with product
  // sellingPrice 20000, downPayment 2000, financedAmount 18000, storeCommission 1500,
  // product { category:'PHONE_NEW', costPrice: 15000 }, no exchangedFromContractId.
  await service.activate('c-1');
  const input = shopInventoryTransferTemplate.execute.mock.calls[0][0];
  expect(input.salePrice.toString()).toBe('20000'); // down(2000)+financed(18000) — NOT raw sellingPrice
  expect(input.downAmount.toString()).toBe('2000');
  expect(input.financedAmount.toString()).toBe('18000');
  expect(input.commission.toString()).toBe('1500');
  expect(input.costPrice.toString()).toBe('15000');
  expect(input).toMatchObject({ inventoryAccountCode: 'S11-2001', cogsAccountCode: 'S50-1101', revenueAccountCode: 'S41-1101', idempotencyKey: 'shop-inventory-transfer:c-1' });
  // called with the same tx as ContractActivation1A (2nd arg present)
  expect(shopInventoryTransferTemplate.execute.mock.calls[0][1]).toBeDefined();
});

it('posts a catch-up ShopDownPayment for an in-flight contract with down but no down JE', async () => {
  // down 2000, but tx.journalEntry.findFirst returns null (no prior down JE → pre-P1 contract)
  tx.journalEntry.findFirst.mockResolvedValue(null);
  shopAccountResolver.resolveBranchCashAccount.mockResolvedValue('S11-1102');
  await service.activate('c-1');
  expect(shopDownPaymentTemplate.execute).toHaveBeenCalledTimes(1);
  expect(shopDownPaymentTemplate.execute.mock.calls[0][0]).toMatchObject({ idempotencyKey: 'shop-down-payment:c-1', cashAccountCode: 'S11-1102' });
});

it('skips the catch-up when a down JE already exists (post-P1 contract)', async () => {
  tx.journalEntry.findFirst.mockResolvedValue({ id: 'down-je-1' });
  await service.activate('c-1');
  expect(shopDownPaymentTemplate.execute).not.toHaveBeenCalled();
});
```

> Mirror the provider/mocked-prisma setup from `contract-exchange.service.spec.ts:1-63`. Also provide `{ provide: ShopDownPaymentTemplate, useValue: { execute: jest.fn() } }`. For `$transaction`, use `prisma.$transaction = jest.fn(async (cb) => cb(tx))` where `tx` is an object of jest.fn()s (`product.findUnique` → returns RESERVED product, `contract.update`, `product.update`, `sale.create`, `journalEntry.findFirst`, etc.). Stub `productsService.transferOwnership`, `generateInstallmentSchedules` (spy), and `generateSaleNumber`. In the first test set `tx.journalEntry.findFirst.mockResolvedValue({ id: 'down-je-1' })` so the catch-up is skipped.

- [ ] **Step 2: Run it — expect FAIL** (template not called / DI missing).

Run: `npm --prefix apps/api test -- src/modules/contracts/contract-workflow.service.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implement.** Add to the constructor (`:25-33`):

```typescript
import { ShopInventoryTransferTemplate } from '../journal/cpa-templates/shop-inventory-transfer.template';
import { ShopDownPaymentTemplate } from '../journal/cpa-templates/shop-down-payment.template';
import { ShopAccountResolver } from '../journal/shop-account-resolver.service';
import { Decimal } from '@prisma/client/runtime/library';
// ...
constructor(
  private prisma: PrismaService,
  private notificationsService: NotificationsService,
  private journalAutoService: JournalAutoService,
  private contractActivation1ATemplate: ContractActivation1ATemplate,
  private productsService: ProductsService,
  private contractExchangeService: ContractExchangeService,
  private shopInventoryTransferTemplate: ShopInventoryTransferTemplate,
  private shopDownPaymentTemplate: ShopDownPaymentTemplate,
  private shopAccountResolver: ShopAccountResolver,
  @Optional() private testMode?: TestModeService,
) {}
```

In the `else` (standard) branch, immediately after `await this.contractActivation1ATemplate.execute(contract.id, tx);` (`:494`):

```typescript
        // SHOP-side: post inventory transfer (COGS + revenue + receivables + down clearance),
        // atomic with the FINANCE 1A entry. salePrice is reconstructed as down+financed (D-8)
        // so the template's financing-identity assertion holds by construction.
        const downAmount = new Decimal(contract.downPayment.toString());
        const financedAmount = new Decimal(contract.financedAmount.toString());

        // In-flight rollout guard (spec §12): a contract created BEFORE this feature
        // shipped never got a ShopDownPayment JE, but ShopInventoryTransfer below will
        // Dr S21-2001 to "clear" the down payable. If no down JE exists yet, post a
        // catch-up ShopDownPayment first so the clearance lands against a real credit.
        if (downAmount.gt(0)) {
          const downJe = await tx.journalEntry.findFirst({
            where: {
              AND: [
                { metadata: { path: ['flow'], equals: 'shop-down-payment' } as any },
                { metadata: { path: ['idempotencyKey'], equals: `shop-down-payment:${contract.id}` } as any },
              ],
              deletedAt: null,
            },
            select: { id: true },
          });
          if (!downJe) {
            const cashAccountCode = await this.shopAccountResolver.resolveBranchCashAccount(contract.branchId, tx);
            await this.shopDownPaymentTemplate.execute(
              {
                idempotencyKey: `shop-down-payment:${contract.id}`,
                contractId: contract.id,
                contractNumber: contract.contractNumber,
                cashAccountCode,
                downAmount,
              },
              tx,
            );
          }
        }

        const acc = this.shopAccountResolver.resolveProductAccounts(contract.product.category);
        await this.shopInventoryTransferTemplate.execute(
          {
            idempotencyKey: `shop-inventory-transfer:${contract.id}`,
            contractId: contract.id,
            contractNumber: contract.contractNumber,
            productId: contract.productId,
            inventoryAccountCode: acc.inventoryAccountCode,
            cogsAccountCode: acc.cogsAccountCode,
            revenueAccountCode: acc.revenueAccountCode,
            costPrice: new Decimal(contract.product.costPrice.toString()),
            salePrice: downAmount.plus(financedAmount),
            downAmount,
            financedAmount,
            commission: contract.storeCommission ? new Decimal(contract.storeCommission.toString()) : new Decimal(0),
          },
          tx,
        );
```

> `productName` is omitted (optional on the input); add it only if you confirm a `Product.name`/`model` field via `findOne`'s include. `contract.product.costPrice` is non-null in schema but follow the exchange precedent if a null-guard is desired. The catch-up keeps the standard (post-P1) path a no-op extra `findFirst` (the down JE already exists from Task 6) while making pre-P1 contracts self-heal.

- [ ] **Step 4: Run tests — expect PASS** (new test + existing contract-workflow suite).

Run: `npm --prefix apps/api test -- src/modules/contracts/contract-workflow.service.spec.ts`
Expected: PASS.

- [ ] **Step 5: Verify DI graph compiles** (the contracts module resolves the new deps via `JournalModule` exports):

Run: `npm --prefix apps/api test -- src/modules/contracts/contract-workflow.service.spec.ts` and `cd apps/api && npx tsc --noEmit -p tsconfig.json`
Expected: tests PASS; tsc exit 0. If Nest reports "can't resolve ShopInventoryTransferTemplate/ShopAccountResolver", confirm `contracts.module.ts` `imports` includes `JournalModule` (it already imports it for `ContractActivation1ATemplate`); both new deps are exported from `JournalModule` (Task 4).

- [ ] **Step 6: Commit.**

```bash
git add apps/api/src/modules/contracts/contract-workflow.service.ts apps/api/src/modules/contracts/contract-workflow.service.spec.ts
git commit -m "feat(contracts): post ShopInventoryTransfer atomically at contract activation (D-1/D-8)"
```

---

## Task 6: Wire `ShopDownPaymentTemplate` into `create()` (guarded `downPayment > 0`)

**Files:**
- Modify: `apps/api/src/modules/contracts/services/contract-lifecycle.service.ts:33` (ctor — add deps), `:131-211` (inside the create `$transaction`, after `tx.payment.createMany`)
- Test: `apps/api/src/modules/contracts/services/contract-lifecycle.service.spec.ts` (add a wiring test)

**Interfaces:**
- Consumes: `ShopDownPaymentTemplate.execute(input: ShopDownPaymentInput, outerTx?): Promise<{entryNo,journalEntryId}>`; `ShopAccountResolver.resolveBranchCashAccount(branchId, tx)`.

- [ ] **Step 1: Write the failing test.** Build a `ContractLifecycleService` `TestingModule` with mocked deps; mock `prisma.$transaction = jest.fn(async (cb) => cb(tx))` and the resolver to return `'S11-1102'`. Assert two behaviors:

```typescript
it('posts ShopDownPayment when downPayment > 0', async () => {
  // create() called with dto.downPayment = 2000, branchId 'br-1'
  await service.create({ ...dto, downPayment: 2000, branchId: 'br-1' } as any, 'sp-1');
  expect(shopAccountResolver.resolveBranchCashAccount).toHaveBeenCalledWith('br-1', tx);
  const input = shopDownPaymentTemplate.execute.mock.calls[0][0];
  expect(input).toMatchObject({ idempotencyKey: expect.stringContaining('shop-down-payment:'), cashAccountCode: 'S11-1102' });
  expect(input.downAmount.toString()).toBe('2000');
});

it('skips ShopDownPayment when downPayment = 0', async () => {
  await service.create({ ...dto, downPayment: 0 } as any, 'sp-1');
  expect(shopDownPaymentTemplate.execute).not.toHaveBeenCalled();
});
```

> `tx` must expose `contract.create` (returns `{ id:'c-1', contractNumber:'CN-1', ... }`), `payment.createMany`, `product.update`, plus whatever the create body calls (credit-check link, customer snapshot). Mirror the existing `contract-lifecycle.service.spec.ts` setup if present; otherwise mirror `contract-exchange.service.spec.ts`.

- [ ] **Step 2: Run — expect FAIL.**

Run: `npm --prefix apps/api test -- src/modules/contracts/services/contract-lifecycle.service.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implement.** Add ctor deps + import:

```typescript
import { ShopDownPaymentTemplate } from '../../journal/cpa-templates/shop-down-payment.template';
import { ShopAccountResolver } from '../../journal/shop-account-resolver.service';
import { Decimal } from '@prisma/client/runtime/library';
```

Inside the create `$transaction`, after `await tx.payment.createMany({ data: payments });` and before `return newContract;`:

```typescript
          // SHOP-side: record the down payment received at contract creation.
          const downPayment = new Decimal(dto.downPayment.toString());
          if (downPayment.gt(0)) {
            const cashAccountCode = await this.shopAccountResolver.resolveBranchCashAccount(dto.branchId, tx);
            await this.shopDownPaymentTemplate.execute(
              {
                idempotencyKey: `shop-down-payment:${newContract.id}`,
                contractId: newContract.id,
                contractNumber: newContract.contractNumber,
                cashAccountCode,
                downAmount: downPayment,
              },
              tx,
            );
          }
```

- [ ] **Step 4: Run — expect PASS.**

Run: `npm --prefix apps/api test -- src/modules/contracts/services/contract-lifecycle.service.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add apps/api/src/modules/contracts/services/contract-lifecycle.service.ts apps/api/src/modules/contracts/services/contract-lifecycle.service.spec.ts
git commit -m "feat(contracts): post ShopDownPayment at contract creation when down > 0"
```

---

## Task 7: Wire `ShopDownPaymentReversalTemplate` into `softDelete()` (pre-activation void)

**Files:**
- Modify: `apps/api/src/modules/contracts/services/contract-lifecycle.service.ts:460-557` (refactor array-form `$transaction` → callback form, add reversal)
- Test: same spec as Task 6 (add reversal test)

**Interfaces:**
- Consumes: `ShopDownPaymentReversalTemplate.execute(input: ShopDownPaymentReversalInput, outerTx?)`; reuses `ShopAccountResolver.resolveBranchCashAccount`.

> **Why a refactor:** `softDelete` currently uses the **array form** `this.prisma.$transaction([...])` which cannot host an `async` template call. Convert it to the **callback form** `this.prisma.$transaction(async (tx) => { ... })`, replacing each `this.prisma.X` with `tx.X`, then add the reversal. Use `ContractCancellationService.approveCancellation` (`contract-cancellation.service.ts:76-159`) as the structural reference for callback-form `$tx` + `template.execute(input, tx)` + audit.

- [ ] **Step 1: Write the failing test:**

```typescript
it('reverses the SHOP down payment when voiding a DRAFT contract that had a down JE', async () => {
  // query.findOne returns DRAFT/CREATING contract with downPayment 2000, branchId 'br-1'
  // a shop-down-payment JE exists for this contract:
  tx.journalEntry.findFirst.mockResolvedValue({ id: 'down-je-1' });
  shopAccountResolver.resolveBranchCashAccount.mockResolvedValue('S11-1102');
  await service.softDelete('c-1', 'user-1');
  const input = shopDownPaymentReversalTemplate.execute.mock.calls[0][0];
  expect(input).toMatchObject({ idempotencyKey: 'shop-down-payment-reversal:c-1', refundAccountCode: 'S11-1102', originalJournalEntryId: 'down-je-1' });
  expect(input.downAmount.toString()).toBe('2000');
});

it('does NOT reverse when no down JE was posted', async () => {
  tx.journalEntry.findFirst.mockResolvedValue(null);
  await service.softDelete('c-1', 'user-1');
  expect(shopDownPaymentReversalTemplate.execute).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run — expect FAIL.**

Run: `npm --prefix apps/api test -- src/modules/contracts/services/contract-lifecycle.service.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implement.** Refactor the `$transaction([...])` block to callback form and add the reversal before the soft-delete update:

```typescript
    await this.prisma.$transaction(async (tx) => {
      // Reverse the SHOP down-payment JE if one was posted for this DRAFT contract.
      const downPayment = new Decimal(contract.downPayment.toString());
      if (downPayment.gt(0)) {
        const downJe = await tx.journalEntry.findFirst({
          where: {
            AND: [
              { metadata: { path: ['flow'], equals: 'shop-down-payment' } as any },
              { metadata: { path: ['idempotencyKey'], equals: `shop-down-payment:${id}` } as any },
            ],
            deletedAt: null,
          },
          select: { id: true },
        });
        if (downJe) {
          const refundAccountCode = await this.shopAccountResolver.resolveBranchCashAccount(contract.branchId, tx);
          await this.shopDownPaymentReversalTemplate.execute(
            {
              idempotencyKey: `shop-down-payment-reversal:${id}`,
              contractId: id,
              contractNumber: contract.contractNumber,
              refundAccountCode,
              downAmount: downPayment,
              originalJournalEntryId: downJe.id,
            },
            tx,
          );
        }
      }

      await tx.contract.update({ where: { id }, data: { deletedAt: now } });
      if (cascadedSignatures > 0) {
        await tx.signature.updateMany({ where: { contractId: id, deletedAt: null }, data: { deletedAt: now } });
      }
      await tx.creditCheck.updateMany({ where: { contractId: id }, data: { contractId: null } });
      await tx.kycVerification.updateMany({ where: { contractId: id, deletedAt: null }, data: { deletedAt: now } });
      await tx.product.updateMany({ where: { id: contract.productId, status: 'RESERVED' }, data: { status: 'IN_STOCK' } });
      await tx.auditLog.create({
        data: {
          userId, action: 'CONTRACT_DELETE', entity: 'contract', entityId: id,
          oldValue: { contractNumber: contract.contractNumber, status: contract.status, workflowStatus: contract.workflowStatus },
          newValue: { cascadedSignatures },
        },
      });
    });
```

Add ctor dep `private shopDownPaymentReversalTemplate: ShopDownPaymentReversalTemplate` + import from `../../journal/cpa-templates/shop-down-payment-reversal.template`.

- [ ] **Step 4: Run — expect PASS** (new tests + existing softDelete tests; verify the callback refactor preserves all original updates).

Run: `npm --prefix apps/api test -- src/modules/contracts/services/contract-lifecycle.service.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add apps/api/src/modules/contracts/services/contract-lifecycle.service.ts apps/api/src/modules/contracts/services/contract-lifecycle.service.spec.ts
git commit -m "feat(contracts): reverse SHOP down payment when voiding a pre-activation DRAFT (callback-form tx)"
```

---

## Task 8: Finance-settlement module — `POST /shop/finance-settlements` + `GET .../pending`

**Files:**
- Create: `apps/api/src/modules/shop-finance-settlement/shop-finance-settlement.module.ts`
- Create: `apps/api/src/modules/shop-finance-settlement/shop-finance-settlement.service.ts`
- Create: `apps/api/src/modules/shop-finance-settlement/shop-finance-settlement.controller.ts`
- Create: `apps/api/src/modules/shop-finance-settlement/dto/finance-settlement.dto.ts`
- Test: `apps/api/src/modules/shop-finance-settlement/shop-finance-settlement.service.spec.ts`
- Modify: `apps/api/src/app.module.ts` (register module)

**Interfaces:**
- Consumes: `ShopFinanceReceiptTemplate.execute(input: ShopFinanceReceiptInput, outerTx?): Promise<{entryNo,journalEntryId}>` + `Contract` rows.
- Produces: `settle(contractIds: string[], bankAccountCode, postedAt?): Promise<...>` and `listPending(): Promise<Contract[]>`.

- [ ] **Step 1: DTO.** Create `dto/finance-settlement.dto.ts`:

```typescript
import { IsArray, IsString, IsOptional, ArrayNotEmpty } from 'class-validator';

export class SettleFinanceDto {
  @IsArray()
  @ArrayNotEmpty({ message: 'ต้องระบุสัญญาอย่างน้อย 1 รายการ' })
  @IsString({ each: true })
  contractIds: string[];

  /** SHOP receiving bank (S11-12XX). Defaults to ShopAccountResolver.SHOP_RECEIVING_BANK. */
  @IsOptional()
  @IsString()
  bankAccountCode?: string;

  @IsOptional()
  @IsString()
  postedAt?: string;
}
```

- [ ] **Step 2: Write the failing service test** (`shop-finance-settlement.service.spec.ts`):

```typescript
import { Test } from '@nestjs/testing';
import { Decimal } from '@prisma/client/runtime/library';
import { ShopFinanceSettlementService } from './shop-finance-settlement.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ShopFinanceReceiptTemplate } from '../journal/cpa-templates/shop-finance-receipt.template';

describe('ShopFinanceSettlementService', () => {
  let service: ShopFinanceSettlementService;
  let prisma: any;
  let template: any;

  beforeEach(async () => {
    prisma = {
      contract: { findMany: jest.fn() },
      journalEntry: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn(async (cb) => cb(prisma)),
    };
    template = { execute: jest.fn().mockResolvedValue({ entryNo: 'JE-1', journalEntryId: 'je-1' }) };
    const mod = await Test.createTestingModule({
      providers: [
        ShopFinanceSettlementService,
        { provide: PrismaService, useValue: prisma },
        { provide: ShopFinanceReceiptTemplate, useValue: template },
      ],
    }).compile();
    service = mod.get(ShopFinanceSettlementService);
  });

  it('posts a ShopFinanceReceipt per contract with financed+commission from the contract', async () => {
    prisma.contract.findMany.mockResolvedValue([
      { id: 'c-1', contractNumber: 'CN-1', financedAmount: new Decimal('18000'), storeCommission: new Decimal('1500'), status: 'ACTIVE', deletedAt: null },
    ]);
    await service.settle({ contractIds: ['c-1'] });
    const input = template.execute.mock.calls[0][0];
    expect(input).toMatchObject({ idempotencyKey: 'finance-receipt-c-1', contractId: 'c-1', bankAccountCode: 'S11-1201' });
    expect(input.financedAmount.toString()).toBe('18000');
    expect(input.commission.toString()).toBe('1500');
  });

  it('listPending returns ACTIVE contracts without a shop-finance-receipt JE', async () => {
    prisma.contract.findMany.mockResolvedValue([{ id: 'c-1' }, { id: 'c-2' }]);
    prisma.journalEntry.findMany.mockResolvedValue([{ metadata: { contractId: 'c-1' } }]);
    const pending = await service.listPending();
    expect(pending.map((c: any) => c.id)).toEqual(['c-2']);
  });
});
```

- [ ] **Step 3: Run — expect FAIL** (module not found).

Run: `npm --prefix apps/api test -- src/modules/shop-finance-settlement/shop-finance-settlement.service.spec.ts`
Expected: FAIL.

- [ ] **Step 4: Implement the service** (`shop-finance-settlement.service.ts`):

```typescript
import { Injectable } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../../prisma/prisma.service';
import { ShopFinanceReceiptTemplate } from '../journal/cpa-templates/shop-finance-receipt.template';
import { ShopAccountResolver } from '../journal/shop-account-resolver.service';
import { SettleFinanceDto } from './dto/finance-settlement.dto';

/** Contract statuses that count as "has been activated" for settlement purposes. */
const ACTIVATED_STATUSES = ['ACTIVE', 'OVERDUE', 'DEFAULT', 'EARLY_PAYOFF', 'COMPLETED'] as const;

@Injectable()
export class ShopFinanceSettlementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly shopFinanceReceiptTemplate: ShopFinanceReceiptTemplate,
  ) {}

  async settle(dto: SettleFinanceDto) {
    const bankAccountCode = dto.bankAccountCode ?? ShopAccountResolver.SHOP_RECEIVING_BANK;
    const postedAt = dto.postedAt ? new Date(dto.postedAt) : undefined;
    const contracts = await this.prisma.contract.findMany({
      where: { id: { in: dto.contractIds }, deletedAt: null },
      select: { id: true, contractNumber: true, financedAmount: true, storeCommission: true },
    });
    const results: { contractId: string; entryNo: string }[] = [];
    for (const c of contracts) {
      const res = await this.shopFinanceReceiptTemplate.execute({
        idempotencyKey: `finance-receipt-${c.id}`,
        contractId: c.id,
        contractNumber: c.contractNumber,
        bankAccountCode,
        financedAmount: new Decimal(c.financedAmount.toString()),
        commission: c.storeCommission ? new Decimal(c.storeCommission.toString()) : new Decimal(0),
        postedAt,
      });
      results.push({ contractId: c.id, entryNo: res.entryNo });
    }
    return { settled: results.length, results };
  }

  /** Activated contracts that do not yet have a shop-finance-receipt JE. */
  async listPending() {
    const contracts = await this.prisma.contract.findMany({
      where: { status: { in: [...ACTIVATED_STATUSES] }, deletedAt: null },
      select: { id: true, contractNumber: true, financedAmount: true, storeCommission: true, branchId: true },
    });
    const settledJEs = await this.prisma.journalEntry.findMany({
      where: { metadata: { path: ['flow'], equals: 'shop-finance-receipt' } as any, deletedAt: null },
      select: { metadata: true },
    });
    const settledIds = new Set(
      settledJEs.map((j) => (j.metadata as any)?.contractId).filter(Boolean),
    );
    return contracts.filter((c) => !settledIds.has(c.id));
  }
}
```

- [ ] **Step 5: Implement the controller** (`shop-finance-settlement.controller.ts`):

```typescript
import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { ShopFinanceSettlementService } from './shop-finance-settlement.service';
import { SettleFinanceDto } from './dto/finance-settlement.dto';

@ApiTags('Shop Finance Settlement')
@ApiBearerAuth('JWT')
@Controller('shop/finance-settlements')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ShopFinanceSettlementController {
  constructor(private readonly service: ShopFinanceSettlementService) {}

  @Post()
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  settle(@Body() dto: SettleFinanceDto) {
    return this.service.settle(dto);
  }

  @Get('pending')
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  pending() {
    return this.service.listPending();
  }
}
```

> No `BranchGuard` — this aggregates cross-branch like the other SHOP-accounting endpoints; `BRANCH_MANAGER` intentionally excluded.

- [ ] **Step 6: Implement the module** (`shop-finance-settlement.module.ts`) + register in `app.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { JournalModule } from '../journal/journal.module';
import { ShopFinanceSettlementService } from './shop-finance-settlement.service';
import { ShopFinanceSettlementController } from './shop-finance-settlement.controller';

@Module({
  imports: [PrismaModule, JournalModule], // JournalModule exports ShopFinanceReceiptTemplate
  controllers: [ShopFinanceSettlementController],
  providers: [ShopFinanceSettlementService],
})
export class ShopFinanceSettlementModule {}
```

Add `ShopFinanceSettlementModule` to the `imports` array in `apps/api/src/app.module.ts`.

- [ ] **Step 7: Run — expect PASS** + typecheck.

Run: `npm --prefix apps/api test -- src/modules/shop-finance-settlement/shop-finance-settlement.service.spec.ts && cd apps/api && npx tsc --noEmit -p tsconfig.json`
Expected: tests PASS; tsc exit 0.

- [ ] **Step 8: Commit.**

```bash
git add apps/api/src/modules/shop-finance-settlement/ apps/api/src/app.module.ts
git commit -m "feat(shop): finance-settlement endpoint — POST /shop/finance-settlements + GET pending (ShopFinanceReceipt)"
```

---

## Acceptance (run after Task 8)

- [ ] Full API typecheck: `cd apps/api && npx tsc --noEmit -p tsconfig.json` → exit 0.
- [ ] Touched-module tests: `npm --prefix apps/api test -- src/modules/peak src/modules/journal src/modules/contracts src/modules/shop-finance-settlement` → all green.
- [ ] Existing SHOP template golden specs still green: `npm --prefix apps/api test -- src/modules/journal/shop-templates`.
- [ ] Manual reasoning check: an installment contract created with down 2000 / financed 18000 / commission 1500 → after create: `S21-2001` Cr 2000; after activate: COGS + revenue 20000 + `S11-3001` 18000 + `S11-3002` 1500 + `S21-2001` Dr 2000 (cleared); after settle: `S11-1201` Dr 19500 / `S11-3001`+`S11-3002` cleared → SHOP TB for this contract nets to inventory-out + cash-in, balanced.
- [ ] X5: no `S`-prefix JE appears in either PEAK export (Tasks 1-2 tests prove the `companyId` filter).

## Out of scope (separate plans)
- **P2** ShopCashSale (per-product, bundle-aware — see spec §6B), **P3** ShopTradeIn, **P4** ShopExpense.
- Branch settings UI for `shopCashAccountCode` (a small frontend follow-on; the column + fail-closed guard ship here, the UI to set it is P2-adjacent — until then set it via seed/SQL for go-live).
- Removing the `/shop/accounting` disclaimer banner (owner decision after rollout).
