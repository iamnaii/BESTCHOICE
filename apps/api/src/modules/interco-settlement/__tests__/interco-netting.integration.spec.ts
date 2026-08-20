import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { BadRequestException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { seedFinanceCoa } from '../../../../prisma/seed-coa-finance';
import { seedShopCoa } from '../../../../prisma/seed-coa-shop';
import { JournalAutoService } from '../../journal/journal-auto.service';
import { CompanyResolverService } from '../../journal/company-resolver.service';
import { PairedJournalService } from '../../journal/paired-journal.service';
import { IntercoPendingService } from '../interco-pending.service';
import { IntercoBatchNumberService } from '../interco-batch-number.service';
import { IntercoSettlementService } from '../interco-settlement.service';
import {
  swapCreditFinanceBalance,
  swapCreditShopBalance,
  recallFinanceBalance,
  recallShopBalance,
} from '../interco-typed-balance';

/**
 * หักกลบ 11-2107 ในรอบจ่าย INTER-CO — เลนส์ + typed balances (Phase 2 Task 3,
 * spec §4.1/§5.4) against a REAL database.
 *
 * Synthetic seeds go through `JournalAutoService.createAndPost` (never direct
 * inserts) with metadata shaped EXACTLY like the real producers:
 *   - 1A synthetic       → 21-1101/21-1102 payable (tag '1A', metadata.contractId)
 *   - SHOP legs synthetic→ S11-3001/S11-3002 receivable (metadata.contractId)
 *   - A.3 synthetic      → 11-2107 [SWAP_CREDIT] (flow
 *     'exchange-buyback-receivable-11-2107' + explicit stamp — Phase 1 shape)
 *   - A.4 synthetic      → S21-3001 [SWAP_CREDIT] keyed by metadata.newContractId
 *     (ShopExchangeReturnTemplate stamp since Phase 2 Task 1)
 *   - C-2 recall synthetic (spec §5.4 shape — the real producer lands in
 *     Phase 3) → 11-2107 + S21-3001 [PAYOUT_RECALL] keyed by metadata.contractId
 *
 * The legacy-swap case posts A.3 with NO explicit stamp — proving the lens's
 * flow-fallback condition matches `classifyShopReceivable`'s FLOW_MAP
 * (shop-receivable-type.util.ts). Both SQL twins (interco-typed-balance.ts +
 * the lens queries in interco-pending.service.ts) must stay consistent with
 * that util — this spec is the anti-drift net.
 *
 * Harness conventions follow `interco-settlement.integration.spec.ts`
 * (real PrismaClient, no Nest DI, seedFinanceCoa/seedShopCoa, scoped cleanup
 * with JournalPostAuditLog cleared before JournalEntry).
 */

const prisma = new PrismaClient();

// ---------------------------------------------------------------------------
// Service wiring (real instances, no Nest DI)
// ---------------------------------------------------------------------------
const journalAuto = new JournalAutoService(prisma as never);
const pendingService = new IntercoPendingService(prisma as never);
const companyResolver = new CompanyResolverService(prisma as never);
const pairedJournal = new PairedJournalService(journalAuto, prisma as never, companyResolver);
const batchNumberService = new IntercoBatchNumberService(prisma as never);
// uploadSlip (StorageService dep) unused by this suite — stub instead of real S3.
const storageStub = { upload: async () => undefined, delete: async () => undefined };
const settlementService = new IntercoSettlementService(
  prisma as never,
  pendingService,
  batchNumberService,
  pairedJournal,
  companyResolver,
  journalAuto,
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

let adminId: string;
let shopId: string;
let financeId: string;
let branchId: string;

// Unique-per-run suffix so a crashed earlier run's leftovers (unique
// nationalId/imeiSerial/phone) can never collide with this run.
const RUN = Date.now().toString(36);
const RUN_NUM = String(Date.now() % 1_000_000).padStart(6, '0');

const dec = (s: string) => new Decimal(s);
const zero = dec('0');

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

/** Customer + product + contract row — prefix INTERCO-NET- for cleanup. */
async function seedBaseContract(seq: number): Promise<string> {
  const tag = `${RUN}-${seq}`;
  const customer = await prisma.customer.create({
    data: {
      name: `__INTERCO_NET_${tag}__`,
      phone: `097${RUN_NUM}${seq}`,
      nationalId: `INTERCONET-${tag}`,
    },
  });
  createdCustomerIds.push(customer.id);

  const product = await prisma.product.create({
    data: {
      name: `Interco Net Test ${tag}`,
      brand: 'IntercoNetBrand',
      model: `NetModel-${tag}`,
      storage: '128GB',
      imeiSerial: `INTERCO-NET-${tag}`,
      category: 'PHONE_NEW',
      costPrice: dec('6000.00'),
      installmentPrice: dec('12000.00'),
      branchId,
      status: 'SOLD_INSTALLMENT',
      ownedByCompanyId: financeId,
    },
  });
  createdProductIds.push(product.id);

  const contract = await prisma.contract.create({
    data: {
      contractNumber: `INTERCO-NET-${tag}`,
      customerId: customer.id,
      productId: product.id,
      branchId,
      salespersonId: adminId,
      planType: 'STORE_WITH_INTEREST',
      sellingPrice: dec('12000.00'),
      downPayment: dec('2000.00'),
      financedAmount: dec('10000.00'),
      interestRate: dec('0.0500'),
      totalMonths: 12,
      interestTotal: dec('6000.00'),
      storeCommission: dec('1000.00'),
      vatAmount: dec('1190.00'),
      vatPct: dec('0.0700'),
      monthlyPayment: dec('1515.83'),
      status: 'ACTIVE',
    },
  });
  createdContractIds.push(contract.id);
  return contract.id;
}

/** 1A synthetic — puts the contract into the pending queue (21-1101/21-1102). */
async function seed1a(id: string) {
  await journalAuto.createAndPost({
    description: '1A synthetic',
    companyId: financeId,
    metadata: { flow: 'test-1a', idempotencyKey: `t1a:${id}`, contractId: id, tag: '1A' },
    lines: [
      { accountCode: '11-2101', dr: dec('17000'), cr: zero },
      { accountCode: '11-2105', dr: dec('1190'), cr: zero },
      { accountCode: '21-1101', dr: zero, cr: dec('10000') },
      { accountCode: '21-1102', dr: zero, cr: dec('1000') },
      { accountCode: '11-2106', dr: zero, cr: dec('6000') },
      { accountCode: '21-2102', dr: zero, cr: dec('1190') },
    ],
  });
}

/**
 * สัญญา swap ตาม workbook Case 8: payable 10,000+1,000 / SHOP legs เท่ากัน /
 * credit 8,000 — A.3 stamps SWAP_CREDIT explicitly (Phase 1 shape), A.4 keys
 * S21-3001 by metadata.newContractId (Phase 2 Task 1 stamp).
 */
async function seedSwapContract(id: string) {
  await seed1a(id);
  await journalAuto.createAndPost({
    description: 'SHOP legs synthetic',
    companyId: shopId,
    metadata: { flow: 'test-shop-legs', idempotencyKey: `tsl:${id}`, contractId: id },
    lines: [
      { accountCode: 'S11-3001', dr: dec('10000'), cr: zero },
      { accountCode: 'S11-3002', dr: dec('1000'), cr: zero },
      { accountCode: 'S41-1101', dr: zero, cr: dec('10000') },
      { accountCode: 'S41-1201', dr: zero, cr: dec('1000') },
    ],
  });
  await journalAuto.createAndPost({
    description: 'A.3 synthetic',
    companyId: financeId,
    metadata: {
      flow: 'exchange-buyback-receivable-11-2107',
      idempotencyKey: `ta3:${id}`,
      contractId: id,
      shopReceivableType: 'SWAP_CREDIT',
    },
    lines: [
      { accountCode: '11-2107', dr: dec('8000'), cr: zero },
      { accountCode: '21-1106', dr: zero, cr: dec('8000') },
    ],
  });
  await journalAuto.createAndPost({
    description: 'A.4 synthetic',
    companyId: shopId,
    metadata: {
      flow: 'shop-exchange-return',
      idempotencyKey: `ta4:${id}`,
      contractId: `${id}-old`,
      newContractId: id,
      shopReceivableType: 'SWAP_CREDIT',
    },
    lines: [
      { accountCode: 'S11-2002', dr: dec('8000'), cr: zero },
      { accountCode: 'S21-3001', dr: zero, cr: dec('8000') },
    ],
  });
}

/**
 * สัญญา swap ยุคก่อน Phase 1: A.3 อย่างเดียว (ไม่มี A.4/S21-3001) และ **ไม่มี
 * explicit stamp** — เลนส์ต้อง classify จาก flow (FLOW_MAP fallback ใน
 * shop-receivable-type.util.ts) และ eligibility ต้องเป็น false (mixed-era,
 * spec §11.4).
 */
async function seedLegacySwapContract(id: string) {
  await seed1a(id);
  await journalAuto.createAndPost({
    description: 'A.3 legacy synthetic (no explicit stamp)',
    companyId: financeId,
    metadata: {
      flow: 'exchange-buyback-receivable-11-2107',
      idempotencyKey: `ta3legacy:${id}`,
      contractId: id,
    },
    lines: [
      { accountCode: '11-2107', dr: dec('8000'), cr: zero },
      { accountCode: '21-1106', dr: zero, cr: dec('8000') },
    ],
  });
}

/** สัญญายกเลิก C-2 (spec §5.4 shape — producer จริงมาใน Phase 3). */
async function seedRecallContract(id: string) {
  await journalAuto.createAndPost({
    description: 'C-2 recall synthetic',
    companyId: financeId,
    metadata: {
      flow: 'test-c2-recall',
      idempotencyKey: `tc2:${id}`,
      contractId: id,
      shopReceivableType: 'PAYOUT_RECALL',
    },
    lines: [
      { accountCode: '11-2107', dr: dec('11000'), cr: zero },
      { accountCode: '21-1103', dr: zero, cr: dec('11000') }, // ขาคู่ synthetic ให้ balance เท่านั้น
    ],
  });
  await journalAuto.createAndPost({
    description: 'C-2 recall SHOP synthetic',
    companyId: shopId,
    metadata: {
      flow: 'test-c2-recall-shop',
      idempotencyKey: `tc2s:${id}`,
      contractId: id,
      shopReceivableType: 'PAYOUT_RECALL',
    },
    lines: [
      { accountCode: 'S21-3001', dr: zero, cr: dec('11000') },
      { accountCode: 'S11-1201', dr: dec('11000'), cr: zero }, // ขาคู่ synthetic
    ],
  });
}

/** SHOP legs synthetic (S11-3001/S11-3002 receivable) — same shape as inside seedSwapContract. */
async function seedShopLegs(id: string, financed: string, commission: string) {
  await journalAuto.createAndPost({
    description: 'SHOP legs synthetic',
    companyId: shopId,
    metadata: { flow: 'test-shop-legs', idempotencyKey: `tsl:${id}`, contractId: id },
    lines: [
      { accountCode: 'S11-3001', dr: dec(financed), cr: zero },
      { accountCode: 'S11-3002', dr: dec(commission), cr: zero },
      { accountCode: 'S41-1101', dr: zero, cr: dec(financed) },
      { accountCode: 'S41-1201', dr: zero, cr: dec(commission) },
    ],
  });
}

/**
 * Minimal balanced 1A-shaped payable (21-1101/21-1102 only — the lens reads
 * nothing else) with a custom financed/commission split for guard fixtures.
 */
async function seed1aCustom(id: string, financed: string, commission: string) {
  await journalAuto.createAndPost({
    description: '1A synthetic (custom amounts)',
    companyId: financeId,
    metadata: { flow: 'test-1a', idempotencyKey: `t1a:${id}`, contractId: id, tag: '1A' },
    lines: [
      { accountCode: '11-2101', dr: dec(financed).plus(dec(commission)), cr: zero },
      { accountCode: '21-1101', dr: zero, cr: dec(financed) },
      { accountCode: '21-1102', dr: zero, cr: dec(commission) },
    ],
  });
}

/** สัญญาขายปกติ (ไม่ใช่ swap): payable 10,000+1,000 + SHOP legs เท่ากัน — ไม่มี 11-2107. */
async function seedNormalContract(id: string) {
  await seed1a(id);
  await seedShopLegs(id, '10000', '1000');
}

/** A.3 synthetic (11-2107 [SWAP_CREDIT], explicit stamp — Phase 1 shape) ยอด custom. */
async function seedA3(id: string, amount: string) {
  await journalAuto.createAndPost({
    description: 'A.3 synthetic',
    companyId: financeId,
    metadata: {
      flow: 'exchange-buyback-receivable-11-2107',
      idempotencyKey: `ta3:${id}`,
      contractId: id,
      shopReceivableType: 'SWAP_CREDIT',
    },
    lines: [
      { accountCode: '11-2107', dr: dec(amount), cr: zero },
      { accountCode: '21-1106', dr: zero, cr: dec(amount) },
    ],
  });
}

/** A.4 synthetic (S21-3001 [SWAP_CREDIT] keyed by metadata.newContractId) ยอด custom. */
async function seedA4(id: string, amount: string) {
  await journalAuto.createAndPost({
    description: 'A.4 synthetic',
    companyId: shopId,
    metadata: {
      flow: 'shop-exchange-return',
      idempotencyKey: `ta4:${id}`,
      contractId: `${id}-old`,
      newContractId: id,
      shopReceivableType: 'SWAP_CREDIT',
    },
    lines: [
      { accountCode: 'S11-2002', dr: dec(amount), cr: zero },
      { accountCode: 'S21-3001', dr: zero, cr: dec(amount) },
    ],
  });
}

/**
 * Workbook IF-guard fixture: payable 4,000+1,000 = 5,000 แต่เครดิตรับซื้อ
 * 8,000 (eligible ทั้งสองสมุด) — เครดิต ≥ เจ้าหนี้ ต้องถูก reject.
 */
async function seedOverCreditSwap(id: string) {
  await seed1aCustom(id, '4000', '1000');
  await seedShopLegs(id, '4000', '1000');
  await seedA3(id, '8000');
  await seedA4(id, '8000');
}

/** สองสมุดไม่ตรง: A.3 = 8,000 แต่ S21-3001 = 7,000 (ทั้งคู่ > 0 → mismatch, ไม่ใช่ legacy). */
async function seedMismatchSwap(id: string) {
  await seed1a(id);
  await seedShopLegs(id, '10000', '1000');
  await seedA3(id, '8000');
  await seedA4(id, '7000');
}

/** ยอดเรียกคืนสองสมุดไม่ตรง: FINANCE 11,000 / SHOP 10,000. */
async function seedRecallMismatch(id: string) {
  await journalAuto.createAndPost({
    description: 'C-2 recall synthetic (mismatch)',
    companyId: financeId,
    metadata: {
      flow: 'test-c2-recall',
      idempotencyKey: `tc2:${id}`,
      contractId: id,
      shopReceivableType: 'PAYOUT_RECALL',
    },
    lines: [
      { accountCode: '11-2107', dr: dec('11000'), cr: zero },
      { accountCode: '21-1103', dr: zero, cr: dec('11000') },
    ],
  });
  await journalAuto.createAndPost({
    description: 'C-2 recall SHOP synthetic (mismatch)',
    companyId: shopId,
    metadata: {
      flow: 'test-c2-recall-shop',
      idempotencyKey: `tc2s:${id}`,
      contractId: id,
      shopReceivableType: 'PAYOUT_RECALL',
    },
    lines: [
      { accountCode: 'S21-3001', dr: zero, cr: dec('10000') },
      { accountCode: 'S11-1201', dr: dec('10000'), cr: zero },
    ],
  });
}

/** Minimal batch row for the settled-gate test — no JE involved. */
async function seedBatch(status: 'POSTED' | 'PENDING_APPROVAL', seq: number) {
  const batch = await prisma.interCoSettlementBatch.create({
    data: {
      batchNumber: `IC-NETTEST-${RUN}-${seq}`,
      status,
      transferDate: new Date(),
      financeBankCode: '11-1201',
      shopBankCode: 'S11-1201',
      totalFinanced: dec('10000.00'),
      totalCommission: dec('1000.00'),
      totalAmount: dec('11000.00'),
      shopPostedAmount: dec('11000.00'),
      makerId: adminId,
    },
  });
  createdBatchIds.push(batch.id);
  return batch;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

let swapId: string;
let legacySwapId: string;
let recallId: string;
let recall2Id: string;
let baselineTotals: Awaited<ReturnType<IntercoPendingService['getReconcileTotals']>>;

describe('Interco netting lens — swapCreditGl + recall queue + typed balances (real DB)', () => {
  beforeAll(async () => {
    await seedFinanceCoa(prisma);
    await seedShopCoa(prisma);

    const shop = await prisma.companyInfo.findFirstOrThrow({
      where: { companyCode: 'SHOP', deletedAt: null },
    });
    const finance = await prisma.companyInfo.findFirstOrThrow({
      where: { companyCode: 'FINANCE', deletedAt: null },
    });
    shopId = shop.id;
    financeId = finance.id;

    let admin = await prisma.user.findFirst({ where: { email: 'admin@bestchoice.com' } });
    if (!admin) {
      admin = await prisma.user.create({
        data: { email: 'admin@bestchoice.com', password: 'x', name: 'admin', role: 'OWNER' },
      });
    }
    adminId = admin.id;

    const existingBranch = await prisma.branch.findFirst({
      where: { name: '__interco_netting_test_branch__', deletedAt: null },
    });
    if (existingBranch) {
      branchId = existingBranch.id;
    } else {
      const branch = await prisma.branch.create({
        data: { name: '__interco_netting_test_branch__', companyId: shopId },
      });
      branchId = branch.id;
      createdBranchId = branch.id;
    }

    // Whole-account baselines BEFORE this run's seeds — the reconcile test
    // asserts DELTAS so leftover balances from other suites can't break it.
    baselineTotals = await pendingService.getReconcileTotals();

    swapId = await seedBaseContract(1);
    await seedSwapContract(swapId);

    legacySwapId = await seedBaseContract(2);
    await seedLegacySwapContract(legacySwapId);

    recallId = await seedBaseContract(3);
    await seedRecallContract(recallId);

    recall2Id = await seedBaseContract(4);
    await seedRecallContract(recall2Id);
  }, 120_000);

  afterAll(async () => {
    // Sweep every JE this spec produced: metadata.contractId ∈ {ids, `${id}-old`
    // (the A.4 synthetic's fake old contract)} plus metadata.newContractId ∈ ids.
    const jeIds = new Set<string>();
    for (const cid of createdContractIds) {
      for (const key of ['contractId', 'newContractId']) {
        const rows = await prisma.journalEntry.findMany({
          where: { metadata: { path: [key], equals: cid } as never },
          select: { id: true },
        });
        rows.forEach((r) => jeIds.add(r.id));
      }
      const oldRows = await prisma.journalEntry.findMany({
        where: { metadata: { path: ['contractId'], equals: `${cid}-old` } as never },
        select: { id: true },
      });
      oldRows.forEach((r) => jeIds.add(r.id));
    }
    const jeIdList = [...jeIds];

    // JournalPostAuditLog FK-references journal_entries — clear first (a48fe1fe convention)
    await prisma.journalPostAuditLog.deleteMany({ where: { journalEntryId: { in: jeIdList } } });
    await prisma.journalLine.deleteMany({ where: { journalEntryId: { in: jeIdList } } });
    await prisma.journalEntry.deleteMany({ where: { id: { in: jeIdList } } });

    await prisma.interCoSettlementItem.deleteMany({ where: { batchId: { in: createdBatchIds } } });
    await prisma.interCoSettlementBatch.deleteMany({ where: { id: { in: createdBatchIds } } });

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
  it('เลนส์เห็น swapCreditGl + eligible บนสัญญา swap — โดยยอด/พฤติกรรมเดิมไม่ขยับ', async () => {
    const pending = await pendingService.getPendingContracts();
    const row = pending.find((p) => p.contractId === swapId)!;
    expect(row).toBeDefined();

    // ฟิลด์ใหม่
    expect(row.swapCreditGl.toFixed(2)).toBe('8000.00');
    expect(row.shopBuybackPayableGl.toFixed(2)).toBe('8000.00');
    expect(row.swapCreditEligible).toBe(true);

    // พฤติกรรมเดิมของเลนส์ต้องไม่ขยับ (Task 3 = additive only)
    expect(row.financedGl.toFixed(2)).toBe('10000.00');
    expect(row.commissionGl.toFixed(2)).toBe('1000.00');
    expect(row.shopFinancedGl.toFixed(2)).toBe('10000.00');
    expect(row.shopCommissionGl.toFixed(2)).toBe('1000.00');
    expect(row.legacyNoShop).toBe(false);

    // สัญญา recall (ไม่มีเจ้าหนี้ 21-1101/21-1102) ต้องไม่โผล่ในคิวรอจ่าย
    expect(pending.some((p) => p.contractId === recallId)).toBe(false);
  });

  it('สัญญา swap ยุคก่อน Phase 1 (ไม่มี S21-3001, A.3 ไม่มี explicit stamp) → ไม่ eligible', async () => {
    const pending = await pendingService.getPendingContracts();
    const row = pending.find((p) => p.contractId === legacySwapId)!;
    expect(row).toBeDefined();

    // flow-fallback ('exchange-buyback-receivable-11-2107') ต้องนับเป็น SWAP_CREDIT
    // — สอดคล้อง FLOW_MAP ใน shop-receivable-type.util.ts
    expect(row.swapCreditGl.toFixed(2)).toBe('8000.00');
    expect(row.shopBuybackPayableGl.toFixed(2)).toBe('0.00');
    expect(row.swapCreditEligible).toBe(false);
  });

  it('recall queue เห็นสัญญายกเลิก + ยอดสองสมุดตรง', async () => {
    const recalls = await pendingService.getPendingRecalls();
    const r = recalls.find((x) => x.contractId === recallId)!;
    expect(r).toBeDefined();
    expect(r.recallGl.toFixed(2)).toBe('11000.00');
    expect(r.shopRecallGl.toFixed(2)).toBe('11000.00');
    expect(r.contractNumber.startsWith('INTERCO-NET-')).toBe(true);
    expect(r.customerName).toContain('__INTERCO_NET_');

    // สัญญา swap (SWAP_CREDIT เท่านั้น ไม่มี PAYOUT_RECALL) ต้องไม่โผล่ในคิว recall
    expect(recalls.some((x) => x.contractId === swapId)).toBe(false);
    expect(recalls.some((x) => x.contractId === legacySwapId)).toBe(false);
  });

  it('typed-balance helpers ตรงกับเลนส์', async () => {
    expect((await swapCreditFinanceBalance(prisma, swapId)).toFixed(2)).toBe('8000.00');
    expect((await swapCreditShopBalance(prisma, swapId)).toFixed(2)).toBe('8000.00');
    expect((await recallFinanceBalance(prisma, recallId)).toFixed(2)).toBe('11000.00');
    expect((await recallShopBalance(prisma, recallId)).toFixed(2)).toBe('11000.00');

    // แยกประเภทจริง: สัญญา swap ไม่มี PAYOUT_RECALL และสัญญา recall ไม่มี SWAP_CREDIT
    expect((await recallFinanceBalance(prisma, swapId)).toFixed(2)).toBe('0.00');
    expect((await swapCreditFinanceBalance(prisma, recallId)).toFixed(2)).toBe('0.00');
    // legacy A.3 (flow-only, no stamp) นับเป็น SWAP_CREDIT ผ่าน flow fallback
    expect((await swapCreditFinanceBalance(prisma, legacySwapId)).toFixed(2)).toBe('8000.00');
    expect((await swapCreditShopBalance(prisma, legacySwapId)).toFixed(2)).toBe('0.00');
  });

  it('reconcile totals เพิ่ม 3 ยอดทั้งบัญชี — delta ตรงกับ seed ของ run นี้', async () => {
    const totals = await pendingService.getReconcileTotals();

    // swap A.3 (explicit) 8,000 + legacy A.3 (flow-only) 8,000
    expect(
      totals.glSwapCreditTotal.minus(baselineTotals.glSwapCreditTotal).toFixed(2),
    ).toBe('16000.00');
    // recall ×2 (11,000 each)
    expect(totals.glRecallTotal.minus(baselineTotals.glRecallTotal).toFixed(2)).toBe('22000.00');
    // S21-3001 ไม่กรอง type: A.4 8,000 + recall SHOP ×2 (11,000 each)
    expect(
      totals.glShopBuybackTotal.minus(baselineTotals.glShopBuybackTotal).toFixed(2),
    ).toBe('30000.00');

    // ยอดเดิมยังอยู่ครบ (additive only)
    expect(totals.pendingTotal).toBeDefined();
    expect(totals.glFinanceTotal).toBeDefined();
    expect(totals.glShopTotal).toBeDefined();
    expect(totals.drift).toBeDefined();
  });

  it('recall settled gate: SETTLEMENT item เดิมไม่บังคิว — RECALL item ใน batch เปิดเท่านั้นที่ตัดออก', async () => {
    // (a) Flow C-2 โดยนิยาม = สัญญาที่เคยถูกจ่ายในรอบ POSTED มาก่อน — item
    // SETTLEMENT เดิมนั้นต้องไม่บังคิว recall (ไม่งั้นคิวนี้ว่างตลอดกาลโดยโครงสร้าง)
    const b1 = await seedBatch('POSTED', 1);
    await prisma.interCoSettlementItem.create({
      data: {
        batchId: b1.id,
        contractId: recall2Id,
        itemType: 'SETTLEMENT',
        financedGl: dec('10000.00'),
        commissionGl: dec('1000.00'),
        shopFinancedGl: dec('10000.00'),
        shopCommissionGl: dec('1000.00'),
      },
    });
    let recalls = await pendingService.getPendingRecalls();
    expect(recalls.some((x) => x.contractId === recall2Id)).toBe(true);

    // (b) RECALL item ใน batch เปิด (PENDING_APPROVAL) → ตัดออกจากคิว
    const b2 = await seedBatch('PENDING_APPROVAL', 2);
    await prisma.interCoSettlementItem.create({
      data: {
        batchId: b2.id,
        contractId: recall2Id,
        itemType: 'RECALL',
        financedGl: dec('0.00'),
        commissionGl: dec('0.00'),
        shopFinancedGl: dec('0.00'),
        shopCommissionGl: dec('0.00'),
        recallAmount: dec('11000.00'),
      },
    });
    recalls = await pendingService.getPendingRecalls();
    expect(recalls.some((x) => x.contractId === recall2Id)).toBe(false);
    // สัญญา recall อื่นที่ไม่มี item ยังอยู่ในคิวตามเดิม
    expect(recalls.some((x) => x.contractId === recallId)).toBe(true);
  });

  // ===========================================================================
  // Task 4 — createBatch/updateBatch/submitBatch: snapshot + guards (spec §5.1)
  //
  // NOTE ordering: this nested block runs AFTER the lens/reconcile tests above,
  // so its extra 11-2107/S21-3001 seeds cannot disturb the baseline-delta
  // assertions. DRAFT batches never lock a contract out of either queue
  // (OPEN_BATCH_STATUSES = PENDING_APPROVAL/POSTED), so fixtures are reusable
  // across tests until a submitBatch happens.
  // ===========================================================================
  describe('createBatch/updateBatch/submitBatch — snapshot หักกลบ + guards', () => {
    let normalId: string;

    beforeAll(async () => {
      normalId = await seedBaseContract(5);
      await seedNormalContract(normalId);
    }, 60_000);

    it('createBatch: swap + recall → totals ถูก (workbook: 22,000 − 19,000 = 3,000)', async () => {
      const batch = await settlementService.createBatch(
        {
          contractIds: [normalId, swapId],
          recallContractIds: [recallId],
          transferDate: '2026-08-20',
        },
        adminId,
      );
      createdBatchIds.push(batch.id);

      expect(batch.totalAmount.toFixed(2)).toBe('22000.00'); // 11,000 + 11,000
      expect(batch.totalDeduction.toFixed(2)).toBe('19000.00'); // 8,000 + 11,000
      expect(batch.netTransferAmount!.toFixed(2)).toBe('3000.00');
      expect(batch.shopNetAmount!.toFixed(2)).toBe('3000.00'); // shopPosted 22,000 − 19,000
      expect(batch.shopPostedAmount.toFixed(2)).toBe('22000.00');
      expect(batch.items).toHaveLength(3);

      const recallItem = batch.items.find((i) => i.contractId === recallId)!;
      expect(recallItem.itemType).toBe('RECALL');
      expect(recallItem.recallAmount.toFixed(2)).toBe('11000.00');
      expect(recallItem.swapCreditAmount.toFixed(2)).toBe('0.00');
      // แถว RECALL ไม่มีเจ้าหนี้/ลูกหนี้ของตัวเอง + ไม่ใช่ legacy
      expect(recallItem.financedGl.toFixed(2)).toBe('0.00');
      expect(recallItem.commissionGl.toFixed(2)).toBe('0.00');
      expect(recallItem.shopFinancedGl.toFixed(2)).toBe('0.00');
      expect(recallItem.shopCommissionGl.toFixed(2)).toBe('0.00');
      expect(recallItem.legacyNoShop).toBe(false);

      const swapItem = batch.items.find((i) => i.contractId === swapId)!;
      expect(swapItem.itemType).toBe('SETTLEMENT');
      expect(swapItem.swapCreditAmount.toFixed(2)).toBe('8000.00');
      expect(swapItem.recallAmount.toFixed(2)).toBe('0.00');

      const normalItem = batch.items.find((i) => i.contractId === normalId)!;
      expect(normalItem.itemType).toBe('SETTLEMENT');
      expect(normalItem.swapCreditAmount.toFixed(2)).toBe('0.00');
    });

    it('guard: เครดิต ≥ เจ้าหนี้สัญญานั้น (workbook IF) → reject', async () => {
      const id = await seedBaseContract(6);
      await seedOverCreditSwap(id); // payable 5,000 / credit 8,000 (eligible)

      await expect(
        settlementService.createBatch(
          { contractIds: [id], transferDate: '2026-08-20' },
          adminId,
        ),
      ).rejects.toThrow(/ราคารับซื้อ/);
    });

    it('guard: ยอดสุทธิทั้งรอบติดลบ (มีแต่ recall ไม่มี settlement) → reject', async () => {
      await expect(
        settlementService.createBatch(
          { contractIds: [], recallContractIds: [recallId], transferDate: '2026-08-20' },
          adminId,
        ),
      ).rejects.toThrow(/เกินยอดจ่ายของรอบ/);
    });

    it('guard: เครดิตเปลี่ยนเครื่องสองสมุดไม่ตรง (A.3 8,000 / S21-3001 7,000) → reject', async () => {
      const id = await seedBaseContract(7);
      await seedMismatchSwap(id);

      await expect(
        settlementService.createBatch(
          { contractIds: [id], transferDate: '2026-08-20' },
          adminId,
        ),
      ).rejects.toThrow(/ไม่ตรงกัน/);
    });

    it('guard: ยอดเรียกคืนสองสมุดไม่ตรง → reject', async () => {
      const id = await seedBaseContract(8);
      await seedRecallMismatch(id); // FINANCE 11,000 / SHOP 10,000

      await expect(
        settlementService.createBatch(
          { contractIds: [], recallContractIds: [id], transferDate: '2026-08-20' },
          adminId,
        ),
      ).rejects.toThrow(/ยอดเรียกคืนสองสมุดไม่ตรงกัน/);
    });

    it('guard: สัญญาเดียวกันอยู่ทั้งรายการจ่ายและรายการเรียกคืน → reject', async () => {
      await expect(
        settlementService.createBatch(
          { contractIds: [swapId], recallContractIds: [swapId], transferDate: '2026-08-20' },
          adminId,
        ),
      ).rejects.toThrow(/ทั้งรายการจ่ายและรายการเรียกคืน/);
    });

    it('guard: recall id ที่ไม่อยู่ในคิวเรียกคืน → reject พร้อมเลขสัญญา', async () => {
      await expect(
        settlementService.createBatch(
          { contractIds: [], recallContractIds: [normalId], transferDate: '2026-08-20' },
          adminId,
        ),
      ).rejects.toThrow(/ไม่อยู่ในคิวเรียกคืน/);
    });

    it('legacy swap (ไม่ eligible) → เข้ารอบได้แบบไม่หัก (swapCreditAmount = 0)', async () => {
      const batch = await settlementService.createBatch(
        { contractIds: [legacySwapId], transferDate: '2026-08-20' },
        adminId,
      );
      createdBatchIds.push(batch.id);

      expect(batch.totalAmount.toFixed(2)).toBe('11000.00');
      expect(batch.totalDeduction.toFixed(2)).toBe('0.00');
      expect(batch.netTransferAmount!.toFixed(2)).toBe('11000.00');
      // legacyNoShop → shopPosted 0, deduction 0 → shopNet 0 (ไม่ติดลบ)
      expect(batch.shopNetAmount!.toFixed(2)).toBe('0.00');

      const item = batch.items[0];
      expect(item.itemType).toBe('SETTLEMENT');
      expect(item.swapCreditAmount.toFixed(2)).toBe('0.00');
      expect(item.legacyNoShop).toBe(true);
    });

    it('updateBatch: re-snapshot ทุก field ใหม่รวม recall rows + totals ใหม่', async () => {
      const normalD = await seedBaseContract(9);
      await seedNormalContract(normalD);
      const recall5 = await seedBaseContract(10);
      await seedRecallContract(recall5);

      const batch = await settlementService.createBatch(
        { contractIds: [normalD], transferDate: '2026-08-20' },
        adminId,
      );
      createdBatchIds.push(batch.id);
      expect(batch.totalDeduction.toFixed(2)).toBe('0.00');
      expect(batch.netTransferAmount!.toFixed(2)).toBe('11000.00');

      const updated = await settlementService.updateBatch(
        batch.id,
        {
          contractIds: [normalD],
          recallContractIds: [recall5],
          transferDate: '2026-08-20',
        },
        adminId,
      );

      expect(updated.totalDeduction.toFixed(2)).toBe('11000.00');
      expect(updated.netTransferAmount!.toFixed(2)).toBe('0.00'); // 11,000 − 11,000
      expect(updated.shopNetAmount!.toFixed(2)).toBe('0.00');
      expect(updated.items).toHaveLength(2);
      const recallItem = updated.items.find((i) => i.contractId === recall5)!;
      expect(recallItem.itemType).toBe('RECALL');
      expect(recallItem.recallAmount.toFixed(2)).toBe('11000.00');
    });

    it('submitBatch: recall row ที่มี SETTLEMENT item เก่าใน batch POSTED (นิยาม Flow C-2) → submit ผ่าน', async () => {
      const normalC = await seedBaseContract(11);
      await seedNormalContract(normalC);
      const recall3 = await seedBaseContract(12);
      await seedRecallContract(recall3);

      // Flow C-2 โดยนิยาม: สัญญาเคยถูกจ่ายในรอบ POSTED มาก่อน — มี SETTLEMENT
      // item ถาวรค้างอยู่. Re-check ของ submit ต้องไม่นับ item นั้นเป็น clash
      // ของแถว RECALL (mirror gate ของ getPendingRecalls) ไม่งั้นทุกรอบที่มี
      // แถวหักเรียกคืนจริงจะ submit ไม่ได้ตลอดกาลโดยโครงสร้าง.
      const hist = await seedBatch('POSTED', 3);
      await prisma.interCoSettlementItem.create({
        data: {
          batchId: hist.id,
          contractId: recall3,
          itemType: 'SETTLEMENT',
          financedGl: dec('10000.00'),
          commissionGl: dec('1000.00'),
          shopFinancedGl: dec('10000.00'),
          shopCommissionGl: dec('1000.00'),
        },
      });

      const batch = await settlementService.createBatch(
        {
          contractIds: [normalC],
          recallContractIds: [recall3],
          transferDate: '2026-08-20',
        },
        adminId,
      );
      createdBatchIds.push(batch.id);

      const submitted = await settlementService.submitBatch(batch.id, adminId);
      expect(submitted.status).toBe('PENDING_APPROVAL');
    });

    it('submitBatch: recall ถูก batch อื่นจับไป (PENDING_APPROVAL) ระหว่างทาง → reject', async () => {
      const normalA = await seedBaseContract(13);
      await seedNormalContract(normalA);
      const normalB = await seedBaseContract(14);
      await seedNormalContract(normalB);
      const recall4 = await seedBaseContract(15);
      await seedRecallContract(recall4);

      // สอง maker แข่งกันจับ recall4 — DRAFT สร้างได้ทั้งคู่ (ไม่ lock)
      const b1 = await settlementService.createBatch(
        { contractIds: [normalA], recallContractIds: [recall4], transferDate: '2026-08-20' },
        adminId,
      );
      createdBatchIds.push(b1.id);
      const b2 = await settlementService.createBatch(
        { contractIds: [normalB], recallContractIds: [recall4], transferDate: '2026-08-20' },
        adminId,
      );
      createdBatchIds.push(b2.id);

      await settlementService.submitBatch(b1.id, adminId); // จับ recall4 (PENDING_APPROVAL)

      await expect(settlementService.submitBatch(b2.id, adminId)).rejects.toThrow(
        BadRequestException,
      );
      await expect(settlementService.submitBatch(b2.id, adminId)).rejects.toThrow(
        /อยู่ในรอบจ่ายอื่นแล้ว/,
      );
    });
  });
});
