import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { seedFinanceCoa } from '../../../../prisma/seed-coa-finance';
import { seedShopCoa } from '../../../../prisma/seed-coa-shop';
import { glContractBalance } from '../../journal/gl-contract-balance';
import { JournalAutoService } from '../../journal/journal-auto.service';
import { CompanyResolverService } from '../../journal/company-resolver.service';
import { PairedJournalService } from '../../journal/paired-journal.service';
import { ContractActivation1ATemplate } from '../../journal/cpa-templates/contract-activation-1a.template';
import { ShopInventoryTransferTemplate } from '../../journal/cpa-templates/shop-inventory-transfer.template';
import { IntercoPendingService } from '../interco-pending.service';
import { IntercoBatchNumberService } from '../interco-batch-number.service';
import { IntercoSettlementService } from '../interco-settlement.service';
import { CreateBatchDto } from '../dto/create-batch.dto';

/**
 * เมนู "จ่ายให้หน้าร้าน (INTER-CO)" — approve/reverse E2E against a REAL
 * database (Task 4). Runs the actual service/template chain (1A → SHOP
 * inventory-transfer → createBatch → submitBatch → approveBatch/reverseBatch)
 * and asserts GL TRUTH via the same `glContractBalance` helper the templates
 * themselves use, not in-memory numbers.
 *
 * `glContractBalance` filters on JE-level `metadata.contractId` — by design
 * (spec §4) the settlement-batch JE does NOT carry a top-level `contractId`
 * (it carries `metadata.items[]` instead, since one JE spans many contracts),
 * so `glContractBalance` alone never "sees" the settlement JE. To verify a
 * specific contract's GL nets to 0 (or is restored) across BOTH the
 * originating JE (1A / shop-inventory-transfer, which DO carry
 * metadata.contractId) AND the settlement/reversal JE (which don't),
 * `combinedContractBalance` below adds in the settlement/reversal JE's own
 * lines matched by `description` containing the contract number — every
 * per-contract line this module posts embeds the contract number in its
 * description for exactly this traceability reason.
 *
 * Harness conventions follow `exchange-priced-flow.integration.spec.ts`
 * (real PrismaClient, no NestJS DI, seedFinanceCoa/seedShopCoa, scoped
 * cleanup, JournalPostAuditLog cleared before JournalEntry).
 */

const prisma = new PrismaClient();

// ---------------------------------------------------------------------------
// Service wiring (real instances, no Nest DI)
// ---------------------------------------------------------------------------
const journal = new JournalAutoService(prisma as never);
const companyResolver = new CompanyResolverService(prisma as never);
const pairedJournal = new PairedJournalService(journal, prisma as never, companyResolver);
const act1a = new ContractActivation1ATemplate(journal, prisma as never);
const shopTransfer = new ShopInventoryTransferTemplate(journal, prisma as never, companyResolver);
const pendingService = new IntercoPendingService(prisma as never);
const batchNumberService = new IntercoBatchNumberService(prisma as never);
// Task 5 added `uploadSlip` (StorageService dep) to the service — unused by
// this approve/reverse-focused suite, stubbed out rather than wiring real
// S3/GCS config just to satisfy the constructor.
const storageStub = { upload: async () => undefined, delete: async () => undefined };
const svc = new IntercoSettlementService(
  prisma as never,
  pendingService,
  batchNumberService,
  pairedJournal,
  companyResolver,
  journal,
  storageStub as never,
);

// ---------------------------------------------------------------------------
// Tracked rows for SCOPED cleanup
// ---------------------------------------------------------------------------
const createdContractIds: string[] = [];
const createdProductIds: string[] = [];
const createdCustomerIds: string[] = [];
const createdBatchIds: string[] = [];
let createdBranchId: string | null = null;

let adminId: string; // maker across every scenario
let approverId: string; // distinct approver (SoD)
let shopCompanyId: string;
let financeCompanyId: string;
let branchId: string;

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

interface ContractFixture {
  id: string;
  contractNumber: string;
  productId: string;
}

/**
 * Standard 12,000/12,000 contract (financed 10,000 + commission 1,000 +
 * interest 6,000 — same CPA golden numbers used across the codebase's other
 * integration specs). `storeCommission = null` exercises the 1A 10% fallback
 * (spec F4) — financed 10,000 × 10% = 1,000, same number as the explicit case,
 * so golden-1's totals stay simple while still proving the fallback path ran.
 */
async function seedContract(
  tag: string,
  storeCommission: string | null = '1000.00',
): Promise<ContractFixture> {
  const customer = await prisma.customer.create({
    data: {
      name: `__IC_TEST_${tag}__`,
      phone: `0898${tag.padStart(6, '0')}`,
      nationalId: `ICTEST-${tag}`,
    },
  });
  createdCustomerIds.push(customer.id);

  const product = await prisma.product.create({
    data: {
      name: `IC Test ${tag}`,
      brand: 'ICTestBrand',
      model: `ICModel-${tag}`,
      storage: '128GB',
      imeiSerial: `ICTEST-${tag}`,
      category: 'PHONE_NEW',
      costPrice: new Decimal('6000.00'),
      installmentPrice: new Decimal('12000.00'),
      branchId,
      status: 'SOLD_INSTALLMENT',
      ownedByCompanyId: financeCompanyId,
    },
  });
  createdProductIds.push(product.id);

  const contract = await prisma.contract.create({
    data: {
      contractNumber: `ICTEST-${tag}-${Date.now()}`,
      customerId: customer.id,
      productId: product.id,
      branchId,
      salespersonId: adminId,
      planType: 'STORE_WITH_INTEREST',
      sellingPrice: new Decimal('12000.00'),
      downPayment: new Decimal('2000.00'),
      financedAmount: new Decimal('10000.00'),
      interestRate: new Decimal('0.0500'),
      totalMonths: 12,
      interestTotal: new Decimal('6000.00'),
      storeCommission: storeCommission === null ? null : new Decimal(storeCommission),
      vatAmount: new Decimal('1190.00'),
      vatPct: new Decimal('0.0700'),
      monthlyPayment: new Decimal('1515.83'),
      status: 'ACTIVE',
    },
  });
  createdContractIds.push(contract.id);

  return { id: contract.id, contractNumber: contract.contractNumber, productId: product.id };
}

/** Real 1A + real SHOP inventory-transfer — the "wired since 2026-06-23" path. */
async function activateWithShop(fix: ContractFixture, commission = '1000.00'): Promise<void> {
  await act1a.execute(fix.id);
  await shopTransfer.execute({
    idempotencyKey: `ic-test-activation-${fix.id}`,
    contractId: fix.id,
    contractNumber: fix.contractNumber,
    productId: fix.productId,
    inventoryAccountCode: 'S11-2001',
    cogsAccountCode: 'S50-1101',
    revenueAccountCode: 'S41-1101',
    costPrice: new Decimal('6000.00'),
    salePrice: new Decimal('12000.00'),
    downAmount: new Decimal('2000.00'),
    financedAmount: new Decimal('10000.00'),
    commission: new Decimal(commission),
  });
}

/** Real 1A only — simulates a pre-2026-06-23 (or contract-exchange-origin) contract: legacyNoShop. */
async function activateLegacyNoShop(fix: ContractFixture): Promise<void> {
  await act1a.execute(fix.id);
}

function batchDto(contractIds: string[], transferDate: string): CreateBatchDto {
  return { contractIds, transferDate };
}

interface LineRow {
  accountCode: string;
  debit: { toString(): string };
  credit: { toString(): string };
}

function sumSide(lines: LineRow[], code: string, side: 'dr' | 'cr'): Decimal {
  return lines
    .filter((l) => l.accountCode === code)
    .reduce(
      (s, l) => s.plus(side === 'dr' ? l.debit.toString() : l.credit.toString()),
      new Decimal(0),
    );
}

/**
 * GL for one contract/account across BOTH the JE-level-metadata lens
 * (`glContractBalance` — catches 1A / shop-inventory-transfer) AND any extra
 * JE ids (settlement / reversal) whose per-contract lines are matched by
 * `description` containing the contract number. See file-level jsdoc.
 */
async function combinedContractBalance(
  contractId: string,
  contractNumber: string,
  accountCode: string,
  side: 'dr' | 'cr',
  extraJeIds: Array<string | null | undefined>,
): Promise<Decimal> {
  const base = await glContractBalance(prisma, contractId, accountCode, side);
  const jeIds = extraJeIds.filter((x): x is string => !!x);
  if (jeIds.length === 0) return base;

  const lines = await prisma.journalLine.findMany({
    where: {
      journalEntryId: { in: jeIds },
      accountCode,
      description: { contains: contractNumber },
    },
  });
  const extra = lines.reduce((sum, l) => {
    const signed =
      side === 'dr'
        ? new Decimal(l.debit.toString()).minus(l.credit.toString())
        : new Decimal(l.credit.toString()).minus(l.debit.toString());
    return sum.plus(signed);
  }, new Decimal(0));
  return base.plus(extra);
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('Inter-co settlement batch — approve/reverse (real DB)', () => {
  beforeAll(async () => {
    await seedFinanceCoa(prisma);
    await seedShopCoa(prisma);

    const shop = await prisma.companyInfo.findFirstOrThrow({
      where: { companyCode: 'SHOP', deletedAt: null },
    });
    const finance = await prisma.companyInfo.findFirstOrThrow({
      where: { companyCode: 'FINANCE', deletedAt: null },
    });
    shopCompanyId = shop.id;
    financeCompanyId = finance.id;

    let admin = await prisma.user.findFirst({ where: { email: 'admin@bestchoice.com' } });
    if (!admin) {
      admin = await prisma.user.create({
        data: { email: 'admin@bestchoice.com', password: 'x', name: 'admin', role: 'OWNER' },
      });
    }
    adminId = admin.id;

    let approver = await prisma.user.findFirst({
      where: { email: 'interco-approver-test@bestchoice.com' },
    });
    if (!approver) {
      approver = await prisma.user.create({
        data: {
          email: 'interco-approver-test@bestchoice.com',
          password: 'x',
          name: 'interco approver (test)',
          role: 'FINANCE_MANAGER',
        },
      });
    }
    approverId = approver.id;

    const existingBranch = await prisma.branch.findFirst({
      where: { name: '__interco_settlement_test_branch__', deletedAt: null },
    });
    if (existingBranch) {
      branchId = existingBranch.id;
    } else {
      const branch = await prisma.branch.create({
        data: { name: '__interco_settlement_test_branch__', companyId: shopCompanyId },
      });
      branchId = branch.id;
      createdBranchId = branch.id;
    }

    // Safety net: clear any stray CLOSED AccountingPeriod row for the month
    // every "happy path" scenario below transfers in (2026-07), so a leftover
    // row from an unrelated spec/manual test can never spuriously fail these.
    await prisma.accountingPeriod.deleteMany({
      where: { companyId: { in: [shopCompanyId, financeCompanyId] }, year: 2026, month: 7 },
    });
  }, 120_000);

  afterAll(async () => {
    // (a) JEs tagged with one of our contracts (1A + shop-inventory-transfer + the manual drift JV)
    const jeIds = new Set<string>();
    for (const cid of createdContractIds) {
      const rows = await prisma.journalEntry.findMany({
        where: { metadata: { path: ['contractId'], equals: cid } as never },
        select: { id: true },
      });
      rows.forEach((r) => jeIds.add(r.id));
    }
    // (b) settlement + reversal JEs tagged with one of our batches
    for (const bid of createdBatchIds) {
      const rows = await prisma.journalEntry.findMany({
        where: { metadata: { path: ['settlementBatchId'], equals: bid } as never },
        select: { id: true },
      });
      rows.forEach((r) => jeIds.add(r.id));
    }
    const jeIdList = [...jeIds];

    // JournalPostAuditLog FK-references journal_entries — clear first (a48fe1fe convention)
    await prisma.journalPostAuditLog.deleteMany({ where: { journalEntryId: { in: jeIdList } } });
    await prisma.journalLine.deleteMany({ where: { journalEntryId: { in: jeIdList } } });
    await prisma.journalEntry.deleteMany({ where: { id: { in: jeIdList } } });

    await prisma.interCoSettlementItem.deleteMany({ where: { batchId: { in: createdBatchIds } } });
    await prisma.interCoSettlementBatch.deleteMany({ where: { id: { in: createdBatchIds } } });

    await prisma.accountingPeriod.deleteMany({
      where: { companyId: shopCompanyId, year: 2020, month: 1 },
    });

    await prisma.contract.deleteMany({ where: { id: { in: createdContractIds } } });
    await prisma.product.deleteMany({ where: { id: { in: createdProductIds } } });
    await prisma.customer.deleteMany({ where: { id: { in: createdCustomerIds } } });
    if (createdBranchId) {
      try {
        await prisma.branch.delete({ where: { id: createdBranchId } });
      } catch {
        // referenced by rows outside this spec's scope — leave it
      }
    }
    await prisma.$disconnect();
  }, 120_000);

  // -------------------------------------------------------------------------
  it(
    'golden 1: two contracts (explicit commission + 10% fallback) → approve → GL nets 0 per contract, JE totals correct, batch POSTED',
    async () => {
      const a = await seedContract('g1a', '1000.00');
      const b = await seedContract('g1b', null); // storeCommission null → 1A fallback 10% of 10,000 = 1,000.00
      await activateWithShop(a, '1000.00');
      await activateWithShop(b, '1000.00');

      expect((await glContractBalance(prisma, a.id, '21-1101', 'cr')).toFixed(2)).toBe('10000.00');
      expect((await glContractBalance(prisma, b.id, '21-1102', 'cr')).toFixed(2)).toBe('1000.00'); // fallback confirmed

      const batch = await svc.createBatch(batchDto([a.id, b.id], '2026-07-15'), adminId);
      createdBatchIds.push(batch.id);
      await svc.submitBatch(batch.id, adminId);
      const posted = await svc.approveBatch(batch.id, approverId);

      expect(posted.status).toBe('POSTED');
      expect(posted.financeJournalEntryId).toBeTruthy();
      expect(posted.shopJournalEntryId).toBeTruthy();

      const financeJe = await prisma.journalEntry.findUniqueOrThrow({
        where: { id: posted.financeJournalEntryId! },
        include: { lines: true },
      });
      expect(financeJe.companyId).toBe(financeCompanyId);
      expect(sumSide(financeJe.lines, '21-1101', 'dr').toFixed(2)).toBe('20000.00');
      expect(sumSide(financeJe.lines, '21-1102', 'dr').toFixed(2)).toBe('2000.00');
      expect(sumSide(financeJe.lines, batch.financeBankCode, 'cr').toFixed(2)).toBe('22000.00');

      const shopJe = await prisma.journalEntry.findUniqueOrThrow({
        where: { id: posted.shopJournalEntryId! },
        include: { lines: true },
      });
      expect(shopJe.companyId).toBe(shopCompanyId);
      expect(sumSide(shopJe.lines, batch.shopBankCode, 'dr').toFixed(2)).toBe('22000.00');
      expect(sumSide(shopJe.lines, 'S11-3001', 'cr').toFixed(2)).toBe('20000.00');
      expect(sumSide(shopJe.lines, 'S11-3002', 'cr').toFixed(2)).toBe('2000.00');

      for (const c of [a, b]) {
        expect(
          (
            await combinedContractBalance(c.id, c.contractNumber, '21-1101', 'cr', [
              posted.financeJournalEntryId,
            ])
          ).toFixed(2),
        ).toBe('0.00');
        expect(
          (
            await combinedContractBalance(c.id, c.contractNumber, '21-1102', 'cr', [
              posted.financeJournalEntryId,
            ])
          ).toFixed(2),
        ).toBe('0.00');
        expect(
          (
            await combinedContractBalance(c.id, c.contractNumber, 'S11-3001', 'dr', [
              posted.shopJournalEntryId,
            ])
          ).toFixed(2),
        ).toBe('0.00');
        expect(
          (
            await combinedContractBalance(c.id, c.contractNumber, 'S11-3002', 'dr', [
              posted.shopJournalEntryId,
            ])
          ).toFixed(2),
        ).toBe('0.00');
      }
    },
    120_000,
  );

  // -------------------------------------------------------------------------
  it(
    'golden 2: legacy contract (1A only, no SHOP JE) → legacyNoShop=true, approve → FINANCE JE only, shopJournalEntryId null',
    async () => {
      const c = await seedContract('g2', '1000.00');
      await activateLegacyNoShop(c);

      const batch = await svc.createBatch(batchDto([c.id], '2026-07-15'), adminId);
      createdBatchIds.push(batch.id);
      expect(batch.items[0].legacyNoShop).toBe(true);
      expect(batch.shopPostedAmount.toString()).toBe('0');

      await svc.submitBatch(batch.id, adminId);
      const posted = await svc.approveBatch(batch.id, approverId);

      expect(posted.financeJournalEntryId).toBeTruthy();
      expect(posted.shopJournalEntryId).toBeNull();
      expect(posted.shopPostedAmount.toString()).toBe('0');
    },
    120_000,
  );

  // -------------------------------------------------------------------------
  it(
    'golden 3: manual JV posted after snapshot drifts the GL → approve rejects, message names the contract, no partial post',
    async () => {
      const c = await seedContract('g3', '1000.00');
      await activateWithShop(c, '1000.00');

      const batch = await svc.createBatch(batchDto([c.id], '2026-07-15'), adminId);
      createdBatchIds.push(batch.id);
      await svc.submitBatch(batch.id, adminId);

      // Manual JV drifts 21-1101 for this contract between snapshot and approve.
      await journal.createAndPost({
        description: '[integration-seed] manual JV drift',
        metadata: { flow: 'ic-test-manual-jv', contractId: c.id },
        lines: [
          { accountCode: '21-1101', dr: new Decimal('500.00'), cr: new Decimal(0) },
          { accountCode: '11-1201', dr: new Decimal(0), cr: new Decimal('500.00') },
        ],
      });

      await expect(svc.approveBatch(batch.id, approverId)).rejects.toThrow(BadRequestException);
      await expect(svc.approveBatch(batch.id, approverId)).rejects.toThrow(
        new RegExp(c.contractNumber),
      );

      const batchAfter = await prisma.interCoSettlementBatch.findUniqueOrThrow({
        where: { id: batch.id },
      });
      expect(batchAfter.status).toBe('PENDING_APPROVAL');
      expect(batchAfter.financeJournalEntryId).toBeNull();
    },
    120_000,
  );

  // -------------------------------------------------------------------------
  it(
    'golden 4: double-batch guard — second batch rejected while first is open, succeeds after reverse',
    async () => {
      const c = await seedContract('g4', '1000.00');
      await activateWithShop(c, '1000.00');

      const batch1 = await svc.createBatch(batchDto([c.id], '2026-07-15'), adminId);
      createdBatchIds.push(batch1.id);
      await svc.submitBatch(batch1.id, adminId);

      await expect(
        svc.createBatch(batchDto([c.id], '2026-07-16'), adminId),
      ).rejects.toThrow(BadRequestException);

      const posted1 = await svc.approveBatch(batch1.id, approverId);
      await svc.reverseBatch(
        posted1.id,
        approverId,
        'ทดสอบยกเลิกรอบจ่ายเพื่อพิสูจน์ pending คืนสถานะ (integration)',
      );

      const batch2 = await svc.createBatch(batchDto([c.id], '2026-07-17'), adminId);
      createdBatchIds.push(batch2.id);
      expect(batch2.id).not.toBe(batch1.id);
    },
    120_000,
  );

  // -------------------------------------------------------------------------
  it('golden 5a: maker approving own batch → Forbidden', async () => {
    const c = await seedContract('g5a', '1000.00');
    await activateWithShop(c, '1000.00');

    const batch = await svc.createBatch(batchDto([c.id], '2026-07-15'), adminId);
    createdBatchIds.push(batch.id);
    await svc.submitBatch(batch.id, adminId);

    await expect(svc.approveBatch(batch.id, adminId)).rejects.toThrow(ForbiddenException);
  }, 120_000);

  it(
    'golden 5b: SHOP period closed for the transfer month → approve rejects, message names SHOP',
    async () => {
      const c = await seedContract('g5b', '1000.00');
      await activateWithShop(c, '1000.00');

      await prisma.accountingPeriod.create({
        data: { companyId: shopCompanyId, year: 2020, month: 1, status: 'CLOSED' },
      });

      const batch = await svc.createBatch(batchDto([c.id], '2020-01-15'), adminId);
      createdBatchIds.push(batch.id);
      await svc.submitBatch(batch.id, adminId);

      await expect(svc.approveBatch(batch.id, approverId)).rejects.toThrow(/SHOP/);
    },
    120_000,
  );

  // -------------------------------------------------------------------------
  it(
    'golden 6: reverse — both JEs mirror-reversed (tag REVERSAL + reversesEntryId), GL restored per contract, batch REVERSED, pending shows contracts again',
    async () => {
      const a = await seedContract('g6a', '1000.00');
      const b = await seedContract('g6b', '1000.00');
      await activateWithShop(a, '1000.00');
      await activateWithShop(b, '1000.00');

      const batch = await svc.createBatch(batchDto([a.id, b.id], '2026-07-15'), adminId);
      createdBatchIds.push(batch.id);
      await svc.submitBatch(batch.id, adminId);
      const posted = await svc.approveBatch(batch.id, approverId);

      const reversed = await svc.reverseBatch(
        posted.id,
        approverId,
        'ทดสอบย้อนกลับรอบจ่าย integration — ตรวจ GL คืนยอด',
      );
      expect(reversed.status).toBe('REVERSED');
      expect(reversed.reverseReason).toContain('ทดสอบย้อนกลับ');

      const auditRow = await prisma.auditLog.findFirst({
        where: {
          entity: 'interco_settlement_batch',
          entityId: batch.id,
          action: 'INTERCO_BATCH_REVERSED',
        },
        orderBy: { createdAt: 'desc' },
      });
      const { financeReversalJeId, shopReversalJeId } = auditRow!.newValue as {
        financeReversalJeId: string;
        shopReversalJeId: string;
      };
      expect(financeReversalJeId).toBeTruthy();
      expect(shopReversalJeId).toBeTruthy();

      const financeReversalJe = await prisma.journalEntry.findUniqueOrThrow({
        where: { id: financeReversalJeId },
      });
      expect((financeReversalJe.metadata as Record<string, unknown>).tag).toBe('REVERSAL');
      expect((financeReversalJe.metadata as Record<string, unknown>).reversesEntryId).toBe(
        posted.financeJournalEntryId,
      );

      const shopReversalJe = await prisma.journalEntry.findUniqueOrThrow({
        where: { id: shopReversalJeId },
      });
      expect((shopReversalJe.metadata as Record<string, unknown>).tag).toBe('REVERSAL');
      expect((shopReversalJe.metadata as Record<string, unknown>).reversesEntryId).toBe(
        posted.shopJournalEntryId,
      );

      for (const c of [a, b]) {
        expect(
          (
            await combinedContractBalance(c.id, c.contractNumber, '21-1101', 'cr', [
              posted.financeJournalEntryId,
              financeReversalJeId,
            ])
          ).toFixed(2),
        ).toBe('10000.00');
        expect(
          (
            await combinedContractBalance(c.id, c.contractNumber, '21-1102', 'cr', [
              posted.financeJournalEntryId,
              financeReversalJeId,
            ])
          ).toFixed(2),
        ).toBe('1000.00');
        expect(
          (
            await combinedContractBalance(c.id, c.contractNumber, 'S11-3001', 'dr', [
              posted.shopJournalEntryId,
              shopReversalJeId,
            ])
          ).toFixed(2),
        ).toBe('10000.00');
        expect(
          (
            await combinedContractBalance(c.id, c.contractNumber, 'S11-3002', 'dr', [
              posted.shopJournalEntryId,
              shopReversalJeId,
            ])
          ).toFixed(2),
        ).toBe('1000.00');
      }

      const pending = await pendingService.getPendingContracts();
      const pendingIds = pending.map((p) => p.contractId);
      expect(pendingIds).toContain(a.id);
      expect(pendingIds).toContain(b.id);
    },
    120_000,
  );
});
