import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { Prisma, PrismaClient } from '@prisma/client';
import { BadRequestException, ConflictException, HttpException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import * as Sentry from '@sentry/nestjs';

// Partial mock — the residual-alarm test (Task 5) asserts Sentry.captureMessage
// payloads; everything else in @sentry/nestjs stays real. Safe for the rest of
// the file: no other assertion reads Sentry, and without a DSN the real fns are
// no-ops anyway.
vi.mock('@sentry/nestjs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@sentry/nestjs')>();
  return { ...actual, captureMessage: vi.fn(), captureException: vi.fn() };
});
import { randomUUID } from 'crypto';
import { seedFinanceCoa } from '../../../../prisma/seed-coa-finance';
import { seedShopCoa } from '../../../../prisma/seed-coa-shop';
import { JournalAutoService } from '../../journal/journal-auto.service';
import { ShopCollectSettlementTemplate } from '../../journal/cpa-templates/shop-collect-settlement.template';
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
  shopCollectTypedBalance,
} from '../interco-typed-balance';
import { glContractBalance } from '../../journal/gl-contract-balance';

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
// Real template (not synthetic JE) — the double-clear tests below must prove
// the PRODUCTION settle path and the netting path see each other (final review C1).
// Also injected into the service for `settleRecallCash` (Phase 3 Task 6).
const shopCollectTemplate = new ShopCollectSettlementTemplate(journalAuto, prisma as never);
const settlementService = new IntercoSettlementService(
  prisma as never,
  pendingService,
  batchNumberService,
  pairedJournal,
  companyResolver,
  journalAuto,
  storageStub as never,
  shopCollectTemplate,
);

// Second REAL Postgres connection + full service wiring for the
// settleRecallCash concurrency test (Task 6 review fix) — mirrors the
// shop-collect race test (shop-collect-settlement.integration.spec.ts item 3):
// a single PrismaClient cannot truly overlap two Serializable interactive
// transactions — the second fails P2028 ("unable to start a transaction in
// the given time") at Prisma's ITX scheduler instead of ever racing at the
// DB. Two independent connections make the SSI race real.
const prisma2 = new PrismaClient();
const journalAuto2 = new JournalAutoService(prisma2 as never);
const pendingService2 = new IntercoPendingService(prisma2 as never);
const companyResolver2 = new CompanyResolverService(prisma2 as never);
const pairedJournal2 = new PairedJournalService(journalAuto2, prisma2 as never, companyResolver2);
const batchNumberService2 = new IntercoBatchNumberService(prisma2 as never);
const shopCollectTemplate2 = new ShopCollectSettlementTemplate(journalAuto2, prisma2 as never);
const settlementService2 = new IntercoSettlementService(
  prisma2 as never,
  pendingService2,
  batchNumberService2,
  pairedJournal2,
  companyResolver2,
  journalAuto2,
  storageStub as never,
  shopCollectTemplate2,
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

/**
 * Mirror synthetics ของ A.3/A.4 ตอนยกเลิก swap (C-2) — shape ตรง sweep engine
 * จริง (`ExchangeCancelReversalTemplate`): mirror ของ JE ที่มี stamp SWAP_CREDIT
 * carry stamp เดิมมาด้วย (final review 2026-08-19) ⇒ typed SWAP_CREDIT ของ
 * สัญญา net เป็น 0 ทั้งสองสมุดหลังยกเลิก เหลือแต่ PAYOUT_RECALL gross จาก
 * redirect. (Task 5 จะพิสูจน์ชุดนี้ซ้ำผ่าน flow exchange-cancel จริง)
 */
async function seedSwapCancelMirrors(id: string) {
  // mirror ของ A.3: Cr 11-2107 [SWAP_CREDIT carry]
  await journalAuto.createAndPost({
    description: 'A.3 mirror synthetic (C-2 cancel)',
    companyId: financeId,
    metadata: {
      tag: 'REVERSAL',
      flow: 'test-c2-cancel-sweep',
      idempotencyKey: `tc2m3:${id}`,
      contractId: id,
      shopReceivableType: 'SWAP_CREDIT',
    },
    lines: [
      { accountCode: '21-1106', dr: dec('8000'), cr: zero },
      { accountCode: '11-2107', dr: zero, cr: dec('8000') },
    ],
  });
  // mirror ของ A.4 (SHOP): Dr S21-3001 [SWAP_CREDIT carry, key newContractId]
  await journalAuto.createAndPost({
    description: 'A.4 mirror synthetic (C-2 cancel)',
    companyId: shopId,
    metadata: {
      tag: 'REVERSAL',
      flow: 'test-c2-cancel-sweep-shop',
      idempotencyKey: `tc2m4:${id}`,
      contractId: `${id}-old`,
      newContractId: id,
      shopReceivableType: 'SWAP_CREDIT',
    },
    lines: [
      { accountCode: 'S21-3001', dr: dec('8000'), cr: zero },
      { accountCode: 'S11-2002', dr: zero, cr: dec('8000') },
    ],
  });
}

interface LineRow {
  accountCode: string;
  debit: { toString(): string };
  credit: { toString(): string };
}

/** Σ of one side for a given account code over JE lines (same helper as the Phase 1 spec). */
function sumSide(lines: LineRow[], code: string, side: 'dr' | 'cr'): Decimal {
  return lines
    .filter((l) => l.accountCode === code)
    .reduce(
      (s, l) => s.plus(side === 'dr' ? l.debit.toString() : l.credit.toString()),
      new Decimal(0),
    );
}

/**
 * Σ deduction (swapCreditAmount + recallAmount) ของสัญญาหนึ่งใน batch สถานะ
 * POSTED ทั้งหมด — residual ที่แท้จริงตาม spec §4.7 ภายใต้สถาปัตยกรรม
 * "เลนส์ gross + item gate" คือ typed gross − ยอดนี้ (batch JE ไม่ stamp
 * contractId จึงไม่ลด typed balance ต่อสัญญาโดยตั้งใจ).
 */
async function sumPostedDeductions(client: PrismaClient, contractId: string): Promise<Decimal> {
  const items = await client.interCoSettlementItem.findMany({
    where: { contractId, deletedAt: null, batch: { status: 'POSTED', deletedAt: null } },
    select: { swapCreditAmount: true, recallAmount: true },
  });
  return items.reduce(
    (s, i) => s.plus(i.swapCreditAmount.toString()).plus(i.recallAmount.toString()),
    new Decimal(0),
  );
}

/**
 * Whole-account Σ(Dr−Cr) — NO metadata filter. Used to prove the batch JE's
 * Cr 11-2107 legs reduce the trial-balance-level balance normally even though
 * the typed per-contract lens (by design) never sees them.
 */
async function wholeAccountBalance(code: string): Promise<Decimal> {
  const rows = await prisma.$queryRaw<Array<{ balance: unknown }>>(Prisma.sql`
    SELECT COALESCE(SUM(jl.debit - jl.credit), 0)::decimal AS balance
    FROM journal_lines jl
    JOIN journal_entries je ON je.id = jl.journal_entry_id
    WHERE jl.account_code = ${code}
      AND jl.deleted_at IS NULL
      AND je.status = 'POSTED'
      AND je.deleted_at IS NULL
  `);
  return new Decimal(String(rows[0]?.balance ?? 0));
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
    // Settlement + reversal JEs carry metadata.settlementBatchId (NOT contractId
    // — architecture ruling: batch JEs must never stamp contractId, or they'd
    // leak into the typed lens) — sweep them by batch id like the Phase 1 spec.
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
    await prisma2.$disconnect();
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

  // ===========================================================================
  // Task 5 — approveBatch/reverseBatch: JE หักกลบสองสมุด (workbook จุดที่ 3) +
  // drift guard typed + residual alarm (spec §4.7, §5.1)
  //
  // Golden numbers (ชุดเดียวกับ Task 4): 2 settlement contracts (10,000+1,000
  // each) + swap credit 8,000 + recall 11,000 → totalAmount 22,000, deduction
  // 19,000, net 3,000 ทั้งสองสมุด.
  // ===========================================================================
  describe('approveBatch/reverseBatch — JE หักกลบสองสมุด + drift guard + residual (Task 5)', () => {
    let goldenNormalId: string;
    let goldenSwapId: string;
    let goldenRecallId: string;
    let goldenBatchId: string;
    let goldenFinanceJeId: string;
    let goldenShopJeId: string;
    let pre2107Balance: Decimal;

    beforeAll(async () => {
      // Safety nets (Phase 1 spec convention): a leftover SoD flag or CLOSED
      // 2026-08 period row from an aborted run must not fail approve.
      await prisma.systemConfig.deleteMany({ where: { key: 'interco_maker_checker_enabled' } });
      await prisma.accountingPeriod.deleteMany({
        where: { companyId: { in: [shopId, financeId] }, year: 2026, month: 8 },
      });

      goldenNormalId = await seedBaseContract(20);
      await seedNormalContract(goldenNormalId);
      goldenSwapId = await seedBaseContract(21);
      await seedSwapContract(goldenSwapId);
      goldenRecallId = await seedBaseContract(22);
      await seedRecallContract(goldenRecallId);
    }, 120_000);

    it(
      'approve → FINANCE JE ตรง workbook จุดที่ 3 + GL ล้างครบ',
      async () => {
        pre2107Balance = await wholeAccountBalance('11-2107');

        const batch = await settlementService.createBatch(
          {
            contractIds: [goldenNormalId, goldenSwapId],
            recallContractIds: [goldenRecallId],
            transferDate: '2026-08-20',
          },
          adminId,
        );
        createdBatchIds.push(batch.id);
        goldenBatchId = batch.id;

        await settlementService.submitBatch(batch.id, adminId);
        const posted = await settlementService.approveBatch(batch.id, adminId);
        expect(posted.status).toBe('POSTED');
        expect(posted.financeJournalEntryId).toBeTruthy();
        expect(posted.shopJournalEntryId).toBeTruthy();
        goldenFinanceJeId = posted.financeJournalEntryId!;
        goldenShopJeId = posted.shopJournalEntryId!;

        const je = await prisma.journalEntry.findUniqueOrThrow({
          where: { id: goldenFinanceJeId },
          include: { lines: true },
        });
        expect(sumSide(je.lines, '21-1101', 'dr').toFixed(2)).toBe('20000.00');
        expect(sumSide(je.lines, '21-1102', 'dr').toFixed(2)).toBe('2000.00');
        expect(sumSide(je.lines, '11-2107', 'cr').toFixed(2)).toBe('19000.00'); // 8,000 + 11,000
        expect(sumSide(je.lines, '11-1201', 'cr').toFixed(2)).toBe('3000.00'); // สุทธิ
        // 7 บรรทัดพอดี — แถว RECALL ต้องไม่สร้างบรรทัด Dr 21-1101 ยอด 0
        expect(je.lines).toHaveLength(7);

        const shopJe = await prisma.journalEntry.findUniqueOrThrow({
          where: { id: goldenShopJeId },
          include: { lines: true },
        });
        expect(sumSide(shopJe.lines, 'S21-3001', 'dr').toFixed(2)).toBe('19000.00');
        expect(sumSide(shopJe.lines, 'S11-1201', 'dr').toFixed(2)).toBe('3000.00');
        expect(sumSide(shopJe.lines, 'S11-3001', 'cr').toFixed(2)).toBe('20000.00');
        expect(sumSide(shopJe.lines, 'S11-3002', 'cr').toFixed(2)).toBe('2000.00');
        expect(shopJe.lines).toHaveLength(7);
        // ขา Dr S21-3001 แยก description ตามประเภทรายการหัก
        const s213001 = shopJe.lines.filter((l) => l.accountCode === 'S21-3001');
        expect(s213001.some((l) => l.description?.includes('ค่าเครื่องรับคืน'))).toBe(true);
        expect(s213001.some((l) => l.description?.includes('เรียกคืนยกเลิก'))).toBe(true);

        // ⚠️ สถาปัตยกรรม "เลนส์ gross + item gate" (batch JE ไม่ stamp contractId
        // จึงไม่เข้า typed lens โดยตั้งใจ): typed balance ต่อสัญญายังคง GROSS หลัง
        // approve; ความ settled อยู่ที่ InterCoSettlementItem POSTED.
        expect((await swapCreditFinanceBalance(prisma, goldenSwapId)).toFixed(2)).toBe('8000.00');
        // Residual ที่แท้จริง (spec §4.7) = typed gross − Σ deduction ใน batch POSTED = 0
        const postedSwapDeduction = await sumPostedDeductions(prisma, goldenSwapId);
        expect(
          (await swapCreditFinanceBalance(prisma, goldenSwapId))
            .minus(postedSwapDeduction)
            .toFixed(2),
        ).toBe('0.00');
        const postedRecallDeduction = await sumPostedDeductions(prisma, goldenRecallId);
        expect(
          (await recallFinanceBalance(prisma, goldenRecallId))
            .minus(postedRecallDeduction)
            .toFixed(2),
        ).toBe('0.00');

        // ระดับบัญชี (trial balance) ขา Cr ของ batch นับปกติ — ยอดทั้งบัญชี
        // 11-2107 ลดลง 19,000 จริง
        expect((await wholeAccountBalance('11-2107')).minus(pre2107Balance).toFixed(2)).toBe(
          '-19000.00',
        );

        // Settled gate: ทั้งสามสัญญาหลุดจากคิวของตัวเอง
        const pending = await pendingService.getPendingContracts();
        expect(pending.some((p) => p.contractId === goldenNormalId)).toBe(false);
        expect(pending.some((p) => p.contractId === goldenSwapId)).toBe(false);
        const recalls = await pendingService.getPendingRecalls();
        expect(recalls.some((r) => r.contractId === goldenRecallId)).toBe(false);
      },
      120_000,
    );

    it(
      'metadata.items ระบุ type/swapCredit/recall + netTransferAmount — และห้าม stamp contractId/shopReceivableType top-level',
      async () => {
        const [financeJe, shopJe] = await Promise.all([
          prisma.journalEntry.findUniqueOrThrow({ where: { id: goldenFinanceJeId } }),
          prisma.journalEntry.findUniqueOrThrow({ where: { id: goldenShopJeId } }),
        ]);
        for (const [je, book] of [
          [financeJe, 'FINANCE'],
          [shopJe, 'SHOP'],
        ] as const) {
          const meta = je.metadata as {
            flow?: string;
            idempotencyKey?: string;
            netTransferAmount?: string;
            contractId?: unknown;
            shopReceivableType?: unknown;
            items?: Array<Record<string, string>>;
          };
          // flow/idempotencyKey เดิมห้ามเปลี่ยน
          expect(meta.flow).toBe('interco-settlement-batch');
          expect(meta.idempotencyKey).toBe(`interco:${goldenBatchId}:${book}`);
          expect(meta.netTransferAmount).toBe('3000.00');
          // Architecture ruling: batch JE ห้าม stamp top-level contractId /
          // shopReceivableType — ไม่งั้นรั่วเข้า typed lens
          expect(meta.contractId).toBeUndefined();
          expect(meta.shopReceivableType).toBeUndefined();

          const items = meta.items!;
          const swapMeta = items.find((i) => i.contractId === goldenSwapId)!;
          expect(swapMeta.type).toBe('SETTLEMENT');
          expect(swapMeta.financed).toBe('10000.00');
          expect(swapMeta.commission).toBe('1000.00');
          expect(swapMeta.swapCredit).toBe('8000.00');
          expect(swapMeta.recall).toBe('0.00');
          const recallMeta = items.find((i) => i.contractId === goldenRecallId)!;
          expect(recallMeta.type).toBe('RECALL');
          expect(recallMeta.swapCredit).toBe('0.00');
          expect(recallMeta.recall).toBe('11000.00');
        }
      },
      60_000,
    );

    it(
      'drift guard (ก): JE แทรกบน 11-2107 SWAP_CREDIT หลัง submit → approve reject',
      async () => {
        const swapD = await seedBaseContract(23);
        await seedSwapContract(swapD);

        const batch = await settlementService.createBatch(
          { contractIds: [swapD], transferDate: '2026-08-20' },
          adminId,
        );
        createdBatchIds.push(batch.id);
        await settlementService.submitBatch(batch.id, adminId);

        // JE แทรก: เครดิตเปลี่ยนเครื่องงอกอีก 500 หลัง snapshot (สมุด FINANCE)
        await journalAuto.createAndPost({
          description: 'A.3 drift synthetic',
          companyId: financeId,
          metadata: {
            flow: 'exchange-buyback-receivable-11-2107',
            idempotencyKey: `ta3drift:${swapD}`,
            contractId: swapD,
            shopReceivableType: 'SWAP_CREDIT',
          },
          lines: [
            { accountCode: '11-2107', dr: dec('500'), cr: zero },
            { accountCode: '21-1106', dr: zero, cr: dec('500') },
          ],
        });

        await expect(settlementService.approveBatch(batch.id, adminId)).rejects.toThrow(
          /เปลี่ยนไปจากตอนสร้างรอบ/,
        );
        const after = await prisma.interCoSettlementBatch.findUniqueOrThrow({
          where: { id: batch.id },
        });
        expect(after.status).toBe('PENDING_APPROVAL');
        expect(after.financeJournalEntryId).toBeNull();
      },
      120_000,
    );

    it(
      'drift guard (ข): snapshot ไม่มีหัก (swapCreditAmount = 0) แต่เครดิต nettable (สองสมุดครบ) งอกหลัง snapshot → reject',
      async () => {
        const normalD = await seedBaseContract(24);
        await seedNormalContract(normalD);

        const batch = await settlementService.createBatch(
          { contractIds: [normalD], transferDate: '2026-08-20' },
          adminId,
        );
        createdBatchIds.push(batch.id);
        await settlementService.submitBatch(batch.id, adminId);

        // เครดิต NETTABLE โผล่หลัง snapshot บนสัญญาที่รอบนี้ไม่ได้หักอะไรไว้เลย
        // — ต้องครบทั้งสองสมุด (A.3 + A.4) ถึงนับเป็น drift; เครดิตสมุดเดียว
        // (A.3 อย่างเดียว = legacy swap, spec §11.4) จ่ายเต็มผ่านได้ — พิสูจน์ใน
        // เทส 'batch ไม่มี deduction (ปกติ + legacy swap §11.4)' ด้านล่าง
        await seedA3(normalD, '500');
        await seedA4(normalD, '500');

        await expect(settlementService.approveBatch(batch.id, adminId)).rejects.toThrow(
          /เปลี่ยนไปจากตอนสร้างรอบ/,
        );
      },
      120_000,
    );

    it(
      'drift guard RECALL: ยอดเรียกคืนเปลี่ยนหลัง snapshot → reject',
      async () => {
        const normalR = await seedBaseContract(25);
        await seedNormalContract(normalR);
        const recallR = await seedBaseContract(26);
        await seedRecallContract(recallR);

        const batch = await settlementService.createBatch(
          {
            contractIds: [normalR],
            recallContractIds: [recallR],
            transferDate: '2026-08-20',
          },
          adminId,
        );
        createdBatchIds.push(batch.id);
        await settlementService.submitBatch(batch.id, adminId);

        await journalAuto.createAndPost({
          description: 'C-2 recall drift synthetic',
          companyId: financeId,
          metadata: {
            flow: 'test-c2-recall',
            idempotencyKey: `tc2drift:${recallR}`,
            contractId: recallR,
            shopReceivableType: 'PAYOUT_RECALL',
          },
          lines: [
            { accountCode: '11-2107', dr: dec('500'), cr: zero },
            { accountCode: '21-1103', dr: zero, cr: dec('500') },
          ],
        });

        await expect(settlementService.approveBatch(batch.id, adminId)).rejects.toThrow(
          /เปลี่ยนไปจากตอนสร้างรอบ/,
        );
      },
      120_000,
    );

    it(
      'approve ผ่านสำหรับรอบที่มี recall row ทั้งที่สัญญานั้นมี SETTLEMENT item ใน batch POSTED เดิม (นิยาม Flow C-2) — และ net 0 ⇒ ไม่มีบรรทัดธนาคารทั้งสองสมุด',
      async () => {
        const normalH = await seedBaseContract(27);
        await seedNormalContract(normalH);
        const recallH = await seedBaseContract(28);
        await seedRecallContract(recallH);

        // Flow C-2 โดยนิยาม: สัญญา recall เคยถูกจ่ายในรอบ POSTED มาก่อน —
        // clash re-check ของ approve (step 2) ต้อง split ตาม itemType แบบเดียว
        // กับ submitBatch ไม่งั้นรอบ recall ตายตอน approve เสมอโดยโครงสร้าง.
        const hist = await seedBatch('POSTED', 4);
        await prisma.interCoSettlementItem.create({
          data: {
            batchId: hist.id,
            contractId: recallH,
            itemType: 'SETTLEMENT',
            financedGl: dec('10000.00'),
            commissionGl: dec('1000.00'),
            shopFinancedGl: dec('10000.00'),
            shopCommissionGl: dec('1000.00'),
          },
        });

        const batch = await settlementService.createBatch(
          {
            contractIds: [normalH],
            recallContractIds: [recallH],
            transferDate: '2026-08-20',
          },
          adminId,
        );
        createdBatchIds.push(batch.id);
        expect(batch.netTransferAmount!.toFixed(2)).toBe('0.00'); // 11,000 − 11,000

        await settlementService.submitBatch(batch.id, adminId);
        const posted = await settlementService.approveBatch(batch.id, adminId);
        expect(posted.status).toBe('POSTED');

        // net 0: ไม่มีบรรทัดธนาคารเลย — FINANCE 3 บรรทัด (Dr 21-1101/21-1102,
        // Cr 11-2107), SHOP 3 บรรทัด (Dr S21-3001, Cr S11-3001/S11-3002)
        const je = await prisma.journalEntry.findUniqueOrThrow({
          where: { id: posted.financeJournalEntryId! },
          include: { lines: true },
        });
        expect(sumSide(je.lines, '11-1201', 'cr').toFixed(2)).toBe('0.00');
        expect(sumSide(je.lines, '11-2107', 'cr').toFixed(2)).toBe('11000.00');
        expect(je.lines).toHaveLength(3);
        const shopJe = await prisma.journalEntry.findUniqueOrThrow({
          where: { id: posted.shopJournalEntryId! },
          include: { lines: true },
        });
        expect(sumSide(shopJe.lines, 'S11-1201', 'dr').toFixed(2)).toBe('0.00');
        expect(sumSide(shopJe.lines, 'S21-3001', 'dr').toFixed(2)).toBe('11000.00');
        expect(shopJe.lines).toHaveLength(3);
      },
      120_000,
    );

    it(
      'batch ไม่มี deduction (ปกติ + legacy swap §11.4) → JE รูปเดิมทุกบรรทัด, netTransferAmount = totalAmount, ไม่มีบรรทัด 11-2107/S21-3001',
      async () => {
        const normalP = await seedBaseContract(30);
        await seedNormalContract(normalP);
        // Legacy swap (finalize ก่อน Phase 1): มี 11-2107 [SWAP_CREDIT] 8,000
        // แต่ไม่มี S21-3001 → ไม่ eligible → เข้ารอบแบบจ่ายเต็ม และ approve
        // ต้องผ่าน ไม่ใช่ drift (spec §11.4: เครดิตของมันล้างผ่าน shop-collect
        // ตามเดิม เงิน 2 ขา — การหักกลบใช้กับสัญญาหลัง Phase 1 เท่านั้น เพราะ
        // ฝั่ง SHOP ไม่มี S21-3001 ให้ Dr). ถ้า guard ปฏิเสธ รอบที่มี legacy
        // swap จะอนุมัติไม่ได้ตลอดกาล (cancel → สร้างใหม่ก็ snapshot 0 เท่าเดิม).
        const legacyP = await seedBaseContract(31);
        await seedLegacySwapContract(legacyP);

        const batch = await settlementService.createBatch(
          { contractIds: [normalP, legacyP], transferDate: '2026-08-20' },
          adminId,
        );
        createdBatchIds.push(batch.id);
        expect(batch.totalAmount.toFixed(2)).toBe('22000.00');
        expect(batch.totalDeduction.toFixed(2)).toBe('0.00');
        // กันถอยหลัง: ไม่มีรายการหัก → ยอดโอนสุทธิ = ยอดรวมเป๊ะ
        expect(batch.netTransferAmount!.toFixed(2)).toBe('22000.00');

        await settlementService.submitBatch(batch.id, adminId);
        const posted = await settlementService.approveBatch(batch.id, adminId);
        expect(posted.status).toBe('POSTED');

        // FINANCE JE รูปเดิมทุกบรรทัด: Dr 21-1101 ×2 + Dr 21-1102 ×2 + Cr bank
        // เต็มจำนวน — ไม่มีบรรทัด 11-2107 แม้ legacy swap มีเครดิตค้าง 8,000
        const je = await prisma.journalEntry.findUniqueOrThrow({
          where: { id: posted.financeJournalEntryId! },
          include: { lines: true },
        });
        expect(sumSide(je.lines, '21-1101', 'dr').toFixed(2)).toBe('20000.00');
        expect(sumSide(je.lines, '21-1102', 'dr').toFixed(2)).toBe('2000.00');
        expect(sumSide(je.lines, '11-1201', 'cr').toFixed(2)).toBe('22000.00');
        expect(je.lines.some((l) => l.accountCode === '11-2107')).toBe(false);
        expect(je.lines).toHaveLength(5);

        // SHOP JE (เฉพาะ non-legacy): Dr bank เต็ม / Cr S11-3001+S11-3002 —
        // ไม่มีบรรทัด S21-3001
        const shopJe = await prisma.journalEntry.findUniqueOrThrow({
          where: { id: posted.shopJournalEntryId! },
          include: { lines: true },
        });
        expect(sumSide(shopJe.lines, 'S11-1201', 'dr').toFixed(2)).toBe('11000.00');
        expect(sumSide(shopJe.lines, 'S11-3001', 'cr').toFixed(2)).toBe('10000.00');
        expect(sumSide(shopJe.lines, 'S11-3002', 'cr').toFixed(2)).toBe('1000.00');
        expect(shopJe.lines.some((l) => l.accountCode === 'S21-3001')).toBe(false);
        expect(shopJe.lines).toHaveLength(3);

        // metadata ทั้งสองใบ: netTransferAmount = totalAmount (กันถอยหลัง)
        for (const jeId of [posted.financeJournalEntryId!, posted.shopJournalEntryId!]) {
          const meta = (await prisma.journalEntry.findUniqueOrThrow({ where: { id: jeId } }))
            .metadata as { netTransferAmount?: string };
          expect(meta.netTransferAmount).toBe(posted.totalAmount.toFixed(2));
        }

        // เครดิต 8,000 ของ legacy swap ยังค้างบน 11-2107 [SWAP_CREDIT] เต็มจำนวน
        // — รอล้างผ่าน shop-collect (ไม่ถูกแตะโดยรอบนี้)
        expect((await swapCreditFinanceBalance(prisma, legacyP)).toFixed(2)).toBe('8000.00');
      },
      120_000,
    );

    it(
      'residual alarm (spec §4.7): residual 0 → เงียบ; เครดิตงอกหลัง approve → Sentry warning พร้อมยอด residual',
      async () => {
        const swapA = await seedBaseContract(29);
        await seedSwapContract(swapA);

        const batch = await settlementService.createBatch(
          { contractIds: [swapA], transferDate: '2026-08-20' },
          adminId,
        );
        createdBatchIds.push(batch.id);
        await settlementService.submitBatch(batch.id, adminId);
        await settlementService.approveBatch(batch.id, adminId);

        const svcWithAlarm = settlementService as unknown as {
          alarmNettingResiduals(batchId: string): Promise<void>;
        };
        const captureMessage = vi.mocked(Sentry.captureMessage);
        const residualCalls = () =>
          captureMessage.mock.calls.filter(
            ([msg]) => msg === 'Interco netting: residual balance after approve',
          );

        // (a) หักครบพอดี → ไม่มี alarm
        captureMessage.mockClear();
        await svcWithAlarm.alarmNettingResiduals(batch.id);
        expect(residualCalls()).toHaveLength(0);

        // (b) เครดิตงอกอีก 500 หลัง approve → residual = 8,500 − 8,000 = 500
        await journalAuto.createAndPost({
          description: 'A.3 post-approve residual synthetic',
          companyId: financeId,
          metadata: {
            flow: 'exchange-buyback-receivable-11-2107',
            idempotencyKey: `ta3residual:${swapA}`,
            contractId: swapA,
            shopReceivableType: 'SWAP_CREDIT',
          },
          lines: [
            { accountCode: '11-2107', dr: dec('500'), cr: zero },
            { accountCode: '21-1106', dr: zero, cr: dec('500') },
          ],
        });
        captureMessage.mockClear();
        await svcWithAlarm.alarmNettingResiduals(batch.id);
        const calls = residualCalls();
        expect(calls).toHaveLength(1);
        const ctx = calls[0][1] as {
          level: string;
          tags: { subsystem: string };
          extra: { financeResidual: string; postedDeduction: string };
        };
        expect(ctx.level).toBe('warning');
        expect(ctx.tags.subsystem).toBe('interco-netting');
        expect(ctx.extra.postedDeduction).toBe('8000.00');
        expect(ctx.extra.financeResidual).toBe('500.00');
      },
      120_000,
    );

    it(
      'reverse → เครดิต/recall กลับเข้าคิวทั้งคู่ + mirror ครอบบรรทัดหักใหม่เอง',
      async () => {
        // Baseline ก่อน reverse — เทสก่อนหน้า (drift guards/net-0/residual)
        // seed 11-2107 เพิ่มระหว่างทาง จึงวัด delta ของการ reverse เองเท่านั้น
        // (ไม่ใช่เทียบกลับ pre-approve ของ golden batch)
        const preReverse2107 = await wholeAccountBalance('11-2107');

        const reversed = await settlementService.reverseBatch(
          goldenBatchId,
          adminId,
          'ทดสอบย้อนกลับรอบหักกลบ',
        );
        expect(reversed.status).toBe('REVERSED');

        // typed gross ไม่ขยับ (ไม่เคยขยับตั้งแต่ approve — เลนส์ gross)
        expect((await swapCreditFinanceBalance(prisma, goldenSwapId)).toFixed(2)).toBe('8000.00');

        // ทั้งสามสัญญากลับเข้าคิวของตัวเอง (item gate ปล่อยเอง — REVERSED ไม่นับ)
        const recalls = await pendingService.getPendingRecalls();
        expect(recalls.some((r) => r.contractId === goldenRecallId)).toBe(true);
        const pending = await pendingService.getPendingContracts();
        expect(pending.some((p) => p.contractId === goldenNormalId)).toBe(true);
        expect(pending.some((p) => p.contractId === goldenSwapId)).toBe(true);

        // Mirror generic ครอบบรรทัดใหม่เอง (brief Step 5c): reversal FINANCE มี
        // Dr 11-2107 19,000 / Dr 11-1201 3,000; reversal SHOP มี Cr S21-3001 19,000
        const reversals = await prisma.journalEntry.findMany({
          where: {
            metadata: { path: ['flow'], equals: 'interco-settlement-batch-reverse' } as never,
            deletedAt: null,
          },
          include: { lines: true },
        });
        const revFin = reversals.find(
          (je) =>
            (je.metadata as { reversesEntryId?: string }).reversesEntryId === goldenFinanceJeId,
        )!;
        expect(revFin).toBeDefined();
        expect(sumSide(revFin.lines, '11-2107', 'dr').toFixed(2)).toBe('19000.00');
        expect(sumSide(revFin.lines, '11-1201', 'dr').toFixed(2)).toBe('3000.00');
        expect(sumSide(revFin.lines, '21-1101', 'cr').toFixed(2)).toBe('20000.00');
        const revShop = reversals.find(
          (je) => (je.metadata as { reversesEntryId?: string }).reversesEntryId === goldenShopJeId,
        )!;
        expect(revShop).toBeDefined();
        expect(sumSide(revShop.lines, 'S21-3001', 'cr').toFixed(2)).toBe('19000.00');
        expect(sumSide(revShop.lines, 'S11-1201', 'cr').toFixed(2)).toBe('3000.00');

        // ระดับบัญชี: mirror คืน Dr 11-2107 เต็มยอดหัก 19,000 ของรอบ golden —
        // ล้างขา Cr −19,000 ที่ approve เคยลงไว้ (ยอด pre2107Balance + −19,000
        // ของ approve ถูกพิสูจน์ไปแล้วในเทส approve)
        expect((await wholeAccountBalance('11-2107')).minus(preReverse2107).toFixed(2)).toBe(
          '19000.00',
        );
      },
      120_000,
    );
  });

  // ===========================================================================
  // Final review C1 — กันหักซ้ำระหว่าง settleShopCollect กับ netting (สองด่าน)
  //
  // สาเหตุบั๊ก: ShopCollectSettlementTemplate คำนวณ outstanding แบบ type-blind
  // ตาม metadata.contractId ขณะที่ batch netting ล้างด้วยใบที่ไม่มี contractId
  // (สถาปัตยกรรม gross lens + item gate) และ drift guard อ่านเฉพาะ typed lens
  // — สองระบบมองไม่เห็นกัน ⇒ เงิน 8,000 ก้อนเดียวเคลียร์ได้สองรอบทั้งสองลำดับ.
  //
  // ด่าน (i): approveBatch เช็ค untyped 11-2107 balance − Σ deduction ใน batch
  //           POSTED อื่น ต้องยังคุ้มยอดหักของ item — ไม่คุ้ม = drift.
  // ด่าน (ii): template หัก Σ deduction ใน batch POSTED ออกจาก outstanding และ
  //           reject ทันทีเมื่อสัญญามีแถวหักใน batch PENDING_APPROVAL
  //           (DRAFT จงใจไม่ block — ด่าน (i) กันขา approve และ maker แก้ร่างได้).
  // ===========================================================================
  describe('กันหักซ้ำ shop-collect ↔ netting (final review C1)', () => {
    beforeAll(async () => {
      // Safety nets เดียวกับ Task 5 — บล็อกนี้ต้องรันแบบ -t filter เดี่ยวได้
      await prisma.systemConfig.deleteMany({ where: { key: 'interco_maker_checker_enabled' } });
      await prisma.accountingPeriod.deleteMany({
        where: { companyId: { in: [shopId, financeId] }, year: 2026, month: 8 },
      });
    }, 60_000);

    it(
      '(a) SHOP โอนผ่าน settle จริงระหว่าง batch DRAFT → approve ต้อง reject (drift ด่าน i)',
      async () => {
        const swapX = await seedBaseContract(40);
        await seedSwapContract(swapX);

        const batch = await settlementService.createBatch(
          { contractIds: [swapX], transferDate: '2026-08-20' },
          adminId,
        );
        createdBatchIds.push(batch.id);
        const item = batch.items.find((i) => i.contractId === swapX)!;
        expect(item.swapCreditAmount.toFixed(2)).toBe('8000.00');

        // SHOP โอนเงินสด 8,000 เข้ามาจริงระหว่าง batch ยัง DRAFT — เส้นทาง
        // template จริง (ด่าน (ii) จงใจไม่ block DRAFT จึงต้องผ่าน)
        const settled = await shopCollectTemplate.execute({
          contractId: swapX,
          depositAccountCode: '11-1201',
          amount: 8000,
          requestId: randomUUID(),
        });
        expect(settled.deduped).toBe(false);

        await settlementService.submitBatch(batch.id, adminId);

        // ก่อน fix: JE settle เป็นประเภท SHOP_COLLECT — typed SWAP_CREDIT lens
        // ไม่ขยับ = snapshot → drift guard เดิมผ่าน → approve หักซ้ำ Cr 11-2107
        // อีก 8,000 (บัญชีติดลบ, SHOP ได้สองเด้ง). หลัง fix: untyped balance
        // (0) − prior POSTED deductions (0) < 8,000 − 0.01 → drift.
        await expect(settlementService.approveBatch(batch.id, adminId)).rejects.toThrow(
          /เปลี่ยนไปจากตอนสร้างรอบ/,
        );
        const after = await prisma.interCoSettlementBatch.findUniqueOrThrow({
          where: { id: batch.id },
        });
        expect(after.status).toBe('PENDING_APPROVAL');
        expect(after.financeJournalEntryId).toBeNull();
      },
      120_000,
    );

    it(
      '(b) settle หลัง batch POSTED ที่หัก 8,000 ไปแล้ว → template reject ไม่มียอดค้าง (ด่าน ii)',
      async () => {
        const swapY = await seedBaseContract(41);
        await seedSwapContract(swapY);

        const batch = await settlementService.createBatch(
          { contractIds: [swapY], transferDate: '2026-08-20' },
          adminId,
        );
        createdBatchIds.push(batch.id);
        await settlementService.submitBatch(batch.id, adminId);
        const posted = await settlementService.approveBatch(batch.id, adminId);
        expect(posted.status).toBe('POSTED');

        // ก่อน fix: ขา Cr 11-2107 ของ batch ไม่มี metadata.contractId →
        // outstanding ต่อสัญญาของ template ไม่เคยลด (ยังเห็น 8,000) → เก็บ
        // เงินสดซ้ำจากยอดที่หักไปแล้วได้. หลัง fix: gross 8,000 − Σ deduction
        // ใน batch POSTED (8,000) = 0 → reject.
        await expect(
          shopCollectTemplate.execute({
            contractId: swapY,
            depositAccountCode: '11-1201',
            amount: 8000,
            requestId: randomUUID(),
          }),
        ).rejects.toThrow(/ไม่มียอด 11-2107 ค้างชำระ/);
      },
      120_000,
    );

    it(
      '(c) settle ระหว่าง batch PENDING_APPROVAL ที่มีแถวหัก → template reject ทันที (ด่าน ii)',
      async () => {
        const swapZ = await seedBaseContract(42);
        await seedSwapContract(swapZ);

        const batch = await settlementService.createBatch(
          { contractIds: [swapZ], transferDate: '2026-08-20' },
          adminId,
        );
        createdBatchIds.push(batch.id);
        await settlementService.submitBatch(batch.id, adminId);

        await expect(
          shopCollectTemplate.execute({
            contractId: swapZ,
            depositAccountCode: '11-1201',
            amount: 8000,
            requestId: randomUUID(),
          }),
        ).rejects.toThrow(/รอผลอนุมัติหรือถอนรอบก่อน/);

        // legacy path ต้องไม่พัง: ถอนรอบ (กลับ DRAFT — ไม่ block แล้ว) → settle ผ่าน
        await settlementService.withdrawBatch(batch.id, adminId);
        const settled = await shopCollectTemplate.execute({
          contractId: swapZ,
          depositAccountCode: '11-1201',
          amount: 8000,
          requestId: randomUUID(),
        });
        expect(settled.deduped).toBe(false);
      },
      120_000,
    );
  });

  // ===========================================================================
  // Phase 3 Task 4 — recall สูตร NET of POSTED deductions (ปิด carry b)
  //
  // เลขทองของเฟส: swap ที่ถูกหักเครดิต 8,000 ในรอบเก่า (POSTED) แล้วถูกยกเลิก
  // (C-2) มี typed PAYOUT_RECALL gross = 11,000 (redirect เต็มยอดที่ตัดจ่าย)
  // แต่เงินที่ FINANCE โอนจริงในรอบนั้น = 3,000 ⇒ ยอดเรียกคืนจริง = 3,000.
  // gross จะทำให้รอบถัดไปหักซ้ำ 8,000 (11-2107 ติดลบ, SHOP โดนหักสองเด้ง).
  //
  // Fixture ใช้ flow จริงถึงชั้น batch (create→submit→approve Phase 2 จริง);
  // การยกเลิก swap เป็น synthetic redirect JEs shape ตรง producer C-2
  // (Task 5 พิสูจน์ผ่าน exchange-cancel flow จริงซ้ำ).
  // ===========================================================================
  describe('recall สูตร net of POSTED deductions (Phase 3 Task 4 — carry b)', () => {
    let cancelledSwapId: string;
    let helperNormalId: string;
    let firstBatchId: string;
    let pre2107: Decimal;

    beforeAll(async () => {
      // Safety nets เดียวกับ Task 5 — บล็อกนี้ต้องรันแบบ -t filter เดี่ยวได้
      await prisma.systemConfig.deleteMany({ where: { key: 'interco_maker_checker_enabled' } });
      await prisma.accountingPeriod.deleteMany({
        where: { companyId: { in: [shopId, financeId] }, year: 2026, month: 8 },
      });
      pre2107 = await wholeAccountBalance('11-2107');

      // (1) swap ปกติ → รอบจ่ายแรกหักเครดิต 8,000 → POSTED
      cancelledSwapId = await seedBaseContract(50);
      await seedSwapContract(cancelledSwapId);
      const b1 = await settlementService.createBatch(
        { contractIds: [cancelledSwapId], transferDate: '2026-08-20' },
        adminId,
      );
      createdBatchIds.push(b1.id);
      firstBatchId = b1.id;
      await settlementService.submitBatch(b1.id, adminId);
      await settlementService.approveBatch(b1.id, adminId);

      // (2) ยกเลิก C-2 (synthetic): redirect PAYOUT_RECALL 11,000 ทั้งสองสมุด
      // + mirror A.3/A.4 [SWAP_CREDIT carry] → swap type net 0
      await seedRecallContract(cancelledSwapId);
      await seedSwapCancelMirrors(cancelledSwapId);

      helperNormalId = await seedBaseContract(51);
      await seedNormalContract(helperNormalId);
    }, 120_000);

    it('recall queue: สัญญาที่เคยถูกหักเครดิตในรอบเก่า → ยอดเรียกคืน net (11,000 − 8,000 = 3,000) ทั้งสองสมุด', async () => {
      const recalls = await pendingService.getPendingRecalls();
      const r = recalls.find((x) => x.contractId === cancelledSwapId)!;
      expect(r).toBeDefined();
      expect(r.recallGl.toFixed(2)).toBe('3000.00');
      expect(r.shopRecallGl.toFixed(2)).toBe('3000.00');

      // typed lens ยังเป็น gross โดยสถาปัตยกรรม (batch JE ไม่ stamp contractId)
      // — การ net เกิดที่คิว ไม่ใช่ที่ GL
      expect((await recallFinanceBalance(prisma, cancelledSwapId)).toFixed(2)).toBe('11000.00');
      expect((await recallShopBalance(prisma, cancelledSwapId)).toFixed(2)).toBe('11000.00');
      // mirror carry stamp → SWAP_CREDIT net 0 ทั้งสองสมุด
      expect((await swapCreditFinanceBalance(prisma, cancelledSwapId)).toFixed(2)).toBe('0.00');
      expect((await swapCreditShopBalance(prisma, cancelledSwapId)).toFixed(2)).toBe('0.00');
    });

    it(
      'recall net → batch รอบถัดไปหัก 3,000 → approve ผ่าน + 11-2107 ทั้งบัญชีกลับ 0 + residual alarm เงียบทั้งสองรอบ',
      async () => {
        const b2 = await settlementService.createBatch(
          {
            contractIds: [helperNormalId],
            recallContractIds: [cancelledSwapId],
            transferDate: '2026-08-20',
          },
          adminId,
        );
        createdBatchIds.push(b2.id);
        expect(b2.totalDeduction.toFixed(2)).toBe('3000.00');
        expect(b2.netTransferAmount!.toFixed(2)).toBe('8000.00'); // 11,000 − 3,000
        expect(b2.shopNetAmount!.toFixed(2)).toBe('8000.00');
        const recallItem = b2.items.find((i) => i.contractId === cancelledSwapId)!;
        expect(recallItem.itemType).toBe('RECALL');
        expect(recallItem.recallAmount.toFixed(2)).toBe('3000.00');

        await settlementService.submitBatch(b2.id, adminId);
        const posted = await settlementService.approveBatch(b2.id, adminId);
        expect(posted.status).toBe('POSTED');

        const je = await prisma.journalEntry.findUniqueOrThrow({
          where: { id: posted.financeJournalEntryId! },
          include: { lines: true },
        });
        expect(sumSide(je.lines, '11-2107', 'cr').toFixed(2)).toBe('3000.00');
        expect(sumSide(je.lines, '11-1201', 'cr').toFixed(2)).toBe('8000.00');
        const shopJe = await prisma.journalEntry.findUniqueOrThrow({
          where: { id: posted.shopJournalEntryId! },
          include: { lines: true },
        });
        expect(sumSide(shopJe.lines, 'S21-3001', 'dr').toFixed(2)).toBe('3000.00');
        expect(sumSide(shopJe.lines, 'S11-1201', 'dr').toFixed(2)).toBe('8000.00');

        // ทั้งบัญชี 11-2107 กลับเท่า baseline ก่อน fixture — Σ ทุกใบของ flow นี้
        // (+8,000 A.3 − 8,000 รอบแรก + 11,000 redirect − 8,000 mirror − 3,000
        // รอบ recall) = 0 พอดี. gross จะจบที่ −8,000 (หักซ้ำ)
        expect((await wholeAccountBalance('11-2107')).minus(pre2107).toFixed(2)).toBe('0.00');

        // สัญญาออกจากคิว recall (item POSTED + net เหลือ 0)
        const recalls = await pendingService.getPendingRecalls();
        expect(recalls.some((x) => x.contractId === cancelledSwapId)).toBe(false);

        // residual alarm เงียบทั้งรอบ recall และรอบเก่า — สูตร combined ต่อสัญญา
        // (carry b): สูตร per-type เดิม false-alarm บนรอบเก่าทันที
        // (typed SWAP_CREDIT 0 − Σposted 11,000 = −11,000)
        const svc = settlementService as unknown as {
          alarmNettingResiduals(batchId: string): Promise<void>;
        };
        const captureMessage = vi.mocked(Sentry.captureMessage);
        captureMessage.mockClear();
        await svc.alarmNettingResiduals(b2.id);
        await svc.alarmNettingResiduals(firstBatchId);
        expect(
          captureMessage.mock.calls.filter(
            ([msg]) => msg === 'Interco netting: residual balance after approve',
          ),
        ).toHaveLength(0);
      },
      120_000,
    );

    it(
      'drift RECALL สูตร net: JE แทรกทำ typed ขยับหลัง submit → net ≠ recallAmount → reject',
      async () => {
        // Fixture ชุดแยก (สัญญาแรกถูกใช้จน settle ไปแล้ว): swap → หัก 8,000
        // POSTED → C-2 synthetics → recall net 3,000
        const swap2 = await seedBaseContract(52);
        await seedSwapContract(swap2);
        const b1 = await settlementService.createBatch(
          { contractIds: [swap2], transferDate: '2026-08-20' },
          adminId,
        );
        createdBatchIds.push(b1.id);
        await settlementService.submitBatch(b1.id, adminId);
        await settlementService.approveBatch(b1.id, adminId);
        await seedRecallContract(swap2);
        await seedSwapCancelMirrors(swap2);

        const normal2 = await seedBaseContract(53);
        await seedNormalContract(normal2);
        const b2 = await settlementService.createBatch(
          { contractIds: [normal2], recallContractIds: [swap2], transferDate: '2026-08-20' },
          adminId,
        );
        createdBatchIds.push(b2.id);
        const item = b2.items.find((i) => i.contractId === swap2)!;
        expect(item.recallAmount.toFixed(2)).toBe('3000.00'); // snapshot = net
        await settlementService.submitBatch(b2.id, adminId);

        // JE แทรก: PAYOUT_RECALL งอกอีก 500 → live net = 3,500 ≠ snapshot 3,000
        await journalAuto.createAndPost({
          description: 'C-2 recall drift synthetic (net)',
          companyId: financeId,
          metadata: {
            flow: 'test-c2-recall',
            idempotencyKey: `tc2driftnet:${swap2}`,
            contractId: swap2,
            shopReceivableType: 'PAYOUT_RECALL',
          },
          lines: [
            { accountCode: '11-2107', dr: dec('500'), cr: zero },
            { accountCode: '21-1103', dr: zero, cr: dec('500') },
          ],
        });

        await expect(settlementService.approveBatch(b2.id, adminId)).rejects.toThrow(
          /เปลี่ยนไปจากตอนสร้างรอบ/,
        );
        const after = await prisma.interCoSettlementBatch.findUniqueOrThrow({
          where: { id: b2.id },
        });
        expect(after.status).toBe('PENDING_APPROVAL');
        expect(after.financeJournalEntryId).toBeNull();
      },
      120_000,
    );
  });

  // ===========================================================================
  // Phase 3 Task 6 — settleRecallCash: เส้นทางรับเงินสดคืน (spec §5.4 ทางเลือก
  // ที่สองนอกจากหักกลบรอบจ่าย). FINANCE reuse ShopCollectSettlementTemplate
  // ด้วย typeStamp 'PAYOUT_RECALL' (Dr <cash> / Cr 11-2107); SHOP โพสต์
  // Dr S21-3001 / Cr <shopPayoutAccountCode> — สองใบใน tx เดียว.
  // ===========================================================================
  describe('settleRecallCash — รับเงินสดคืนจากหน้าร้าน (Phase 3 Task 6)', () => {
    beforeAll(async () => {
      // Safety nets เดียวกับ Task 5 — บล็อกนี้ต้องรันแบบ -t filter เดี่ยวได้
      await prisma.systemConfig.deleteMany({ where: { key: 'interco_maker_checker_enabled' } });
      await prisma.accountingPeriod.deleteMany({
        where: { companyId: { in: [shopId, financeId] }, year: 2026, month: 8 },
      });
    }, 60_000);

    it(
      'settle เต็ม net (pure recall 11,000) → JE สองสมุดถูก stamp + typed หลุดคิว + GL ต่อสัญญา = 0 + เลนส์ SHOP_COLLECT ไม่ติดลบ',
      async () => {
        const recallP = await seedBaseContract(60);
        await seedRecallContract(recallP);
        const requestId = randomUUID();

        const result = await settlementService.settleRecallCash(
          recallP,
          { amount: 11000, financeDepositAccountCode: '11-1201', requestId },
          adminId,
        );
        expect(result.deduped).toBe(false);

        // FINANCE JE: Dr 11-1201 / Cr 11-2107 — stamp PAYOUT_RECALL บน flow
        // 'shop-collect-settlement' เดิมของ template
        const financeJe = await prisma.journalEntry.findFirstOrThrow({
          where: { entryNumber: result.financeEntryNo },
          include: { lines: true },
        });
        expect(sumSide(financeJe.lines, '11-1201', 'dr').toFixed(2)).toBe('11000.00');
        expect(sumSide(financeJe.lines, '11-2107', 'cr').toFixed(2)).toBe('11000.00');
        expect(financeJe.lines).toHaveLength(2);
        expect(financeJe.companyId).toBe(financeId);
        const finMeta = financeJe.metadata as Record<string, unknown>;
        expect(finMeta.flow).toBe('shop-collect-settlement');
        expect(finMeta.shopReceivableType).toBe('PAYOUT_RECALL');
        expect(finMeta.contractId).toBe(recallP);

        // SHOP JE: Dr S21-3001 / Cr S11-1201 (default) — flow ใหม่ + stamp
        const shopJe = await prisma.journalEntry.findFirstOrThrow({
          where: { entryNumber: result.shopEntryNo },
          include: { lines: true },
        });
        expect(sumSide(shopJe.lines, 'S21-3001', 'dr').toFixed(2)).toBe('11000.00');
        expect(sumSide(shopJe.lines, 'S11-1201', 'cr').toFixed(2)).toBe('11000.00');
        expect(shopJe.lines).toHaveLength(2);
        expect(shopJe.companyId).toBe(shopId);
        const shopMeta = shopJe.metadata as Record<string, unknown>;
        expect(shopMeta.flow).toBe('interco-recall-cash-shop');
        // สมมาตรกับ FINANCE leg (template key = `${contractId}:${requestId}`)
        expect(shopMeta.idempotencyKey).toBe(`${recallP}:${requestId}:SHOP`);
        expect(shopMeta.shopReceivableType).toBe('PAYOUT_RECALL');
        expect(shopMeta.contractId).toBe(recallP);

        // typed lens: settle JE stamp PAYOUT_RECALL + contractId → หักใน typed
        // ตรงๆ (ต่างจากขา batch ที่ไม่ stamp) — 11,000 − 11,000 = 0 ทั้งสองสมุด
        expect((await recallFinanceBalance(prisma, recallP)).toFixed(2)).toBe('0.00');
        expect((await recallShopBalance(prisma, recallP)).toFixed(2)).toBe('0.00');
        const recalls = await pendingService.getPendingRecalls();
        expect(recalls.some((x) => x.contractId === recallP)).toBe(false);

        // GL untyped ต่อสัญญา = 0 ทั้งสองบัญชีจริง
        expect((await glContractBalance(prisma, recallP, '11-2107', 'dr')).toFixed(2)).toBe('0.00');
        expect((await glContractBalance(prisma, recallP, 'S21-3001', 'cr')).toFixed(2)).toBe(
          '0.00',
        );

        // เลนส์ SHOP_COLLECT ต้องไม่นับใบ settle ที่ stamp PAYOUT_RECALL
        // (explicit stamp ชนะ flow fallback — SQL twin ต้องตรง classifyShopReceivable)
        expect((await shopCollectTypedBalance(prisma, recallP)).toFixed(2)).toBe('0.00');

        // AuditLog
        const audit = await prisma.auditLog.findFirst({
          where: { action: 'INTERCO_RECALL_CASH_SETTLED', entityId: recallP },
        });
        expect(audit).toBeTruthy();
        expect((audit!.newValue as Record<string, unknown>).amount).toBe('11000.00');
      },
      120_000,
    );

    it(
      'settle เกิน net → reject; settle บางส่วน → ผ่าน + คิวเหลือ net ลดลง',
      async () => {
        const recallQ = await seedBaseContract(61);
        await seedRecallContract(recallQ);

        await expect(
          settlementService.settleRecallCash(
            recallQ,
            { amount: 11000.02, financeDepositAccountCode: '11-1201', requestId: randomUUID() },
            adminId,
          ),
        ).rejects.toThrow(/เกินยอดเรียกคืน/);

        // บางส่วน 5,000 → ผ่าน, คิวเหลือ 6,000 ทั้งสองสมุด
        const partial = await settlementService.settleRecallCash(
          recallQ,
          { amount: 5000, financeDepositAccountCode: '11-1201', requestId: randomUUID() },
          adminId,
        );
        expect(partial.deduped).toBe(false);
        const recalls = await pendingService.getPendingRecalls();
        const r = recalls.find((x) => x.contractId === recallQ)!;
        expect(r).toBeDefined();
        expect(r.recallGl.toFixed(2)).toBe('6000.00');
        expect(r.shopRecallGl.toFixed(2)).toBe('6000.00');
      },
      120_000,
    );

    it(
      'มี RECALL item ใน batch เปิด (PENDING/DRAFT) → reject ด้วยข้อความชี้รอบ; ยกเลิกรอบแล้ว settle ผ่าน (เลือกบัญชีจ่ายฝั่ง SHOP ได้)',
      async () => {
        const normalX = await seedBaseContract(62);
        await seedNormalContract(normalX);
        const recallX = await seedBaseContract(63);
        await seedRecallContract(recallX);

        const batch = await settlementService.createBatch(
          {
            contractIds: [normalX],
            recallContractIds: [recallX],
            transferDate: '2026-08-20',
          },
          adminId,
        );
        createdBatchIds.push(batch.id);
        await settlementService.submitBatch(batch.id, adminId);

        // PENDING_APPROVAL → reject (settled gate จับอยู่แล้ว แต่ต้องได้ข้อความชัด)
        await expect(
          settlementService.settleRecallCash(
            recallX,
            { amount: 11000, financeDepositAccountCode: '11-1201', requestId: randomUUID() },
            adminId,
          ),
        ).rejects.toThrow(/รอบจ่าย/);

        // DRAFT ก็ block เช่นกัน (brief: เขียน guard ชัด รวม DRAFT)
        await settlementService.withdrawBatch(batch.id, adminId);
        await expect(
          settlementService.settleRecallCash(
            recallX,
            { amount: 11000, financeDepositAccountCode: '11-1201', requestId: randomUUID() },
            adminId,
          ),
        ).rejects.toThrow(/รอบจ่าย/);

        // ยกเลิกรอบ → settle ผ่าน (จ่ายจากเงินสดสาขา S11-1101 แทน default)
        await settlementService.cancelBatch(batch.id, adminId);
        const result = await settlementService.settleRecallCash(
          recallX,
          {
            amount: 11000,
            financeDepositAccountCode: '11-1201',
            shopPayoutAccountCode: 'S11-1101',
            requestId: randomUUID(),
          },
          adminId,
        );
        expect(result.deduped).toBe(false);
        const shopJe = await prisma.journalEntry.findFirstOrThrow({
          where: { entryNumber: result.shopEntryNo },
          include: { lines: true },
        });
        expect(sumSide(shopJe.lines, 'S11-1101', 'cr').toFixed(2)).toBe('11000.00');
        expect(sumSide(shopJe.lines, 'S21-3001', 'dr').toFixed(2)).toBe('11000.00');
      },
      120_000,
    );

    it(
      'swap-cancelled (recall net 3,000 — เลขทองของเฟส) → settle 3,000 ผ่าน gate ของ template + ทุกบัญชีปิดศูนย์',
      async () => {
        // Baseline ก่อน seed fixture ทั้งชุด — วัด delta ของ flow นี้ล้วนๆ
        const preFixture2107 = await wholeAccountBalance('11-2107');
        const preFixtureS21 = await wholeAccountBalance('S21-3001');

        // swap → รอบจ่ายหัก 8,000 POSTED → ยกเลิก C-2 (redirect 11,000 + mirrors)
        const swapC = await seedBaseContract(64);
        await seedSwapContract(swapC);
        const b1 = await settlementService.createBatch(
          { contractIds: [swapC], transferDate: '2026-08-20' },
          adminId,
        );
        createdBatchIds.push(b1.id);
        await settlementService.submitBatch(b1.id, adminId);
        await settlementService.approveBatch(b1.id, adminId);
        await seedRecallContract(swapC);
        await seedSwapCancelMirrors(swapC);

        // ยอดเรียกคืน net = 11,000 − 8,000 (ΣPOSTED deduction) = 3,000
        let recalls = await pendingService.getPendingRecalls();
        expect(recalls.find((x) => x.contractId === swapC)!.recallGl.toFixed(2)).toBe('3000.00');

        // Template gate (ii): untyped ต่อสัญญา 11,000 − ΣPOSTED 8,000 = 3,000
        // → settle 3,000 ต้องผ่านพอดี
        const result = await settlementService.settleRecallCash(
          swapC,
          { amount: 3000, financeDepositAccountCode: '11-1201', requestId: randomUUID() },
          adminId,
        );
        expect(result.deduped).toBe(false);

        // typed หลัง settle: fin = 11,000 − 3,000 = 8,000 → net = 8,000 −
        // 8,000 (ΣPOSTED) = 0 → หลุดคิว (เลขตาม brief Task 6)
        expect((await recallFinanceBalance(prisma, swapC)).toFixed(2)).toBe('8000.00');
        expect((await recallShopBalance(prisma, swapC)).toFixed(2)).toBe('8000.00');
        recalls = await pendingService.getPendingRecalls();
        expect(recalls.some((x) => x.contractId === swapC)).toBe(false);

        // ทั้งบัญชีจริง (untyped รวม batch legs) ปิดศูนย์ทั้งสองสมุด:
        // 11-2107: +8,000(A.3) −8,000(batch) +11,000(redirect) −8,000(mirror) −3,000(settle) = 0
        // S21-3001: −8,000(A.4) +8,000(batch) −11,000(redirect) +8,000(mirror) +3,000(settle) = 0
        expect((await wholeAccountBalance('11-2107')).minus(preFixture2107).toFixed(2)).toBe(
          '0.00',
        );
        expect((await wholeAccountBalance('S21-3001')).minus(preFixtureS21).toFixed(2)).toBe(
          '0.00',
        );
      },
      180_000,
    );

    it(
      'ยอดเรียกคืนสองสมุดไม่ตรงกัน → reject (ห้ามโพสต์ข้างเดียว)',
      async () => {
        const id = await seedBaseContract(65);
        await seedRecallMismatch(id); // FINANCE 11,000 / SHOP 10,000

        await expect(
          settlementService.settleRecallCash(
            id,
            { amount: 10000, financeDepositAccountCode: '11-1201', requestId: randomUUID() },
            adminId,
          ),
        ).rejects.toThrow(/สองสมุดไม่ตรงกัน/);
      },
      120_000,
    );

    it(
      'idempotency: requestId เดิม retry → คืนผลเดิมไม่โพสต์ซ้ำ (แม้สัญญาหลุดคิวแล้ว); ยอดต่างกัน → 409',
      async () => {
        const recallI = await seedBaseContract(66);
        await seedRecallContract(recallI);
        const requestId = randomUUID();

        const first = await settlementService.settleRecallCash(
          recallI,
          { amount: 11000, financeDepositAccountCode: '11-1201', requestId },
          adminId,
        );
        expect(first.deduped).toBe(false);

        // Retry หลัง settle เต็ม — สัญญาไม่อยู่ในคิวแล้ว แต่ idempotency ต้องมา
        // ก่อน guard คิว → คืนผลเดิม ไม่ throw
        const again = await settlementService.settleRecallCash(
          recallI,
          { amount: 11000, financeDepositAccountCode: '11-1201', requestId },
          adminId,
        );
        expect(again.deduped).toBe(true);
        expect(again.financeEntryNo).toBe(first.financeEntryNo);
        expect(again.shopEntryNo).toBe(first.shopEntryNo);

        // JE ไม่งอกซ้ำ (SHOP leg มีใบเดียว)
        const shopJes = await prisma.journalEntry.findMany({
          where: {
            AND: [
              { metadata: { path: ['flow'], equals: 'interco-recall-cash-shop' } as never },
              { metadata: { path: ['contractId'], equals: recallI } as never },
            ],
            deletedAt: null,
          },
        });
        expect(shopJes).toHaveLength(1);

        // requestId เดิมแต่ยอดใหม่ → 409 ห้ามกลืนเงียบ
        await expect(
          settlementService.settleRecallCash(
            recallI,
            { amount: 5000, financeDepositAccountCode: '11-1201', requestId },
            adminId,
          ),
        ).rejects.toThrow(ConflictException);
      },
      120_000,
    );

    it(
      'concurrency (2 REAL Postgres connections): สองคำขอพร้อมกัน**คนละ requestId** → settle ครั้งเดียว (Serializable) + GL ไม่ติดลบ',
      async () => {
        const recallC = await seedBaseContract(67);
        await seedRecallContract(recallC);

        // Warm up prisma2 ก่อนแข่ง (pattern เดียวกับ race test ของ shop-collect)
        // — connection แรกของ client ใหม่จ่าย cost ตั้งต้นที่ทำให้ฝั่ง A ชนะ
        // ก่อนที่ B จะยิง statement แรก = ไม่ได้ race จริง
        await prisma2.$queryRaw`SELECT 1`;

        // idempotency จับไม่ได้ (key ต่างกัน) — ภายใต้ READ COMMITTED ทั้งคู่
        // จะผ่าน guard "amount ≤ net" แล้ว over-settle (typed ติดลบ, เงินสด
        // เดบิตสองเด้ง). Serializable + SSI ต้องทำให้เหลือผู้ชนะรายเดียว.
        const results = await Promise.allSettled([
          settlementService.settleRecallCash(
            recallC,
            { amount: 11000, financeDepositAccountCode: '11-1201', requestId: randomUUID() },
            adminId,
          ),
          settlementService2.settleRecallCash(
            recallC,
            { amount: 11000, financeDepositAccountCode: '11-1201', requestId: randomUUID() },
            adminId,
          ),
        ]);
        const fulfilled = results.filter((r) => r.status === 'fulfilled');
        const rejected = results.filter(
          (r): r is PromiseRejectedResult => r.status === 'rejected',
        );
        expect(fulfilled).toHaveLength(1);
        expect(rejected).toHaveLength(1);

        // ผู้แพ้: ต้องเป็น HttpException สะอาดเสมอ (ห้าม raw Prisma/500) —
        // 409 (SSI abort → P2034 → ConflictException จาก template หรือ catch
        // ระดับ service ตอน commit) เมื่อ tx ทับซ้อนจริง, หรือ 400 (คิวว่าง/
        // เกินยอด) เมื่อผู้ชนะ commit ก่อนผู้แพ้เริ่ม snapshot — ทั้งสองเส้นทาง
        // ถูกต้อง: invariant ที่ปักคือเงิน settle ครั้งเดียวเท่านั้น
        const loserErr = rejected[0].reason as unknown;
        expect(
          loserErr instanceof HttpException,
          `Expected clean HttpException, got ${(loserErr as { constructor?: { name?: string } })?.constructor?.name}: ${(loserErr as Error)?.message}`,
        ).toBe(true);
        expect([400, 409]).toContain((loserErr as HttpException).getStatus());

        // GL invariant: settle ครั้งเดียวพอดี — typed = 0 (ไม่ติดลบ), untyped
        // ต่อสัญญา = 0, SHOP JE ใบเดียว
        expect((await recallFinanceBalance(prisma, recallC)).toFixed(2)).toBe('0.00');
        expect((await recallShopBalance(prisma, recallC)).toFixed(2)).toBe('0.00');
        expect((await glContractBalance(prisma, recallC, '11-2107', 'dr')).toFixed(2)).toBe(
          '0.00',
        );
        const shopJes = await prisma.journalEntry.findMany({
          where: {
            AND: [
              { metadata: { path: ['flow'], equals: 'interco-recall-cash-shop' } as never },
              { metadata: { path: ['contractId'], equals: recallC } as never },
            ],
            deletedAt: null,
          },
        });
        expect(shopJes).toHaveLength(1);
      },
      120_000,
    );
  });

  // ===========================================================================
  // Phase 4 Task 5 — approveBatch ↔ settleRecallCash: ปิด carry (d) ที่ต้นเหตุ
  // (isolation) แทนที่จะพึ่ง guard "RECALL item ใน batch เปิด" อย่างเดียว.
  //
  // หน้าต่างจริงที่ guard ปิดไม่ได้: settle เปิด tx **ก่อน** รอบจ่ายถูกสร้าง
  // (ตอนนั้นยังไม่มี item ให้ guard 1 เห็น) แล้วรอบจ่ายถูกสร้าง+ส่ง+อนุมัติ
  // จนจบภายในหน้าต่างนั้น — ทั้งสองฝั่งจึงเห็นยอดเรียกคืน net เต็ม 11,000
  // และหักคนละครั้ง = 11-2107 ติดลบ. `settleRecallCash` เป็น Serializable
  // อยู่แล้ว แต่ SSI ต้องการให้ **ทั้งคู่** เป็น Serializable จึงจะเกิด
  // rw-conflict (writer ที่เป็น READ COMMITTED ไม่ลงทะเบียน conflict กับ
  // SIRead lock ของใคร) — approve ที่ยัง default isolation จึงลอยผ่านไป.
  //
  // รอบจ่ายในเทสนี้ลงบัญชีเดือน **กรกฎาคม** ผ่าน `postedAtOverride` (D4
  // backdated round — ฟีเจอร์จริง) โดยตั้งใจ: เดือนเดียวกันจะชนเลขที่ใบสำคัญ
  // (`nextEntryNumber` อ่าน MAX ใต้ snapshot เก่าของ settle → P2002) ซึ่งเป็น
  // การ "รอด" โดยบังเอิญคนละกลไกกับที่เรากำลังพิสูจน์ และหายไปทันทีเมื่อสอง
  // ฝั่งลงคนละเดือน — เทสจึงต้องแยกเดือนเพื่อวัด isolation ล้วนๆ
  // ===========================================================================
  describe('approveBatch ↔ settleRecallCash — race สองคอนเนกชัน (Phase 4 Task 5, carry d)', () => {
    beforeAll(async () => {
      // Safety nets เดียวกับบล็อกอื่น — ต้องรันแบบ -t filter เดี่ยวได้
      await prisma.systemConfig.deleteMany({ where: { key: 'interco_maker_checker_enabled' } });
      await prisma.accountingPeriod.deleteMany({
        where: { companyId: { in: [shopId, financeId] }, year: 2026, month: { in: [7, 8] } },
      });
      // Warm-up ทั้งสองคอนเนกชัน + query plans ของเส้นทาง create/submit/approve
      // ก่อนเปิดหน้าต่างแข่ง — Prisma interactive tx มี timeout 5 วินาที และ
      // การ compile ครั้งแรกกินเวลาพอที่จะทำให้ settle time-out (P2028) แทนที่
      // จะได้แข่งจริง
      await prisma2.$queryRaw`SELECT 1`;
      const warmNormal = await seedBaseContract(80);
      await seedNormalContract(warmNormal);
      const warmBatch = await settlementService.createBatch(
        { contractIds: [warmNormal], transferDate: '2026-08-20' },
        adminId,
      );
      createdBatchIds.push(warmBatch.id);
      await settlementService.submitBatch(warmBatch.id, adminId);
      await settlementService.approveBatch(warmBatch.id, adminId, new Date(2026, 6, 15));
    }, 120_000);

    it(
      'settle เปิด tx ค้างไว้ แล้วรอบจ่ายที่มีแถว recall ของสัญญาเดียวกัน create→submit→approve จนจบ → ต้องมีฝ่ายแพ้ + 11-2107 ไม่ติดลบ',
      async () => {
        const recallR = await seedBaseContract(81);
        // baseline ก่อนตั้งหนี้เรียกคืน → delta ที่คาดหวังคือ +11,000 (ตั้งหนี้)
        // − 11,000 (หักครั้งเดียว) = 0 พอดี; หักสองเด้งจะได้ −11,000
        const pre2107 = await wholeAccountBalance('11-2107');
        await seedRecallContract(recallR); // gross 11,000 ทั้งสองสมุด, ไม่มี deduction เดิม
        const normalR = await seedBaseContract(82);
        await seedNormalContract(normalR); // เจ้าหนี้ 10,000 + 1,000 → คุ้มยอดหัก 11,000

        // Barrier: ค้าง settle ไว้หลังผ่าน guard ครบ (ก่อนโพสต์ใบแรก) — snapshot
        // ของ tx ถูกจับไปแล้วตอนนั้น ซึ่งคือหัวใจของหน้าต่าง TOCTOU
        let releaseGate!: () => void;
        const gate = new Promise<void>((resolve) => {
          releaseGate = resolve;
        });
        let gateHit = false;
        const realExecute = shopCollectTemplate2.execute.bind(shopCollectTemplate2);
        const spy = vi
          .spyOn(shopCollectTemplate2, 'execute')
          .mockImplementation(async (input, outerTx) => {
            gateHit = true;
            await gate;
            return realExecute(input, outerTx);
          });

        let settlePromise: Promise<unknown>;
        let approveOutcome: { ok: boolean; err?: unknown };
        try {
          settlePromise = settlementService2.settleRecallCash(
            recallR,
            { amount: 11000, financeDepositAccountCode: '11-1201', requestId: randomUUID() },
            adminId,
          );
          settlePromise.catch(() => undefined); // กัน unhandled rejection ระหว่างรอ
          const deadline = Date.now() + 4_000;
          while (!gateHit && Date.now() < deadline) {
            await new Promise((r) => setTimeout(r, 10));
          }
          expect(gateHit, 'settle ต้องผ่าน guard และเปิด tx ค้างไว้ก่อนเริ่มรอบจ่าย').toBe(true);

          const batch = await settlementService.createBatch(
            {
              contractIds: [normalR],
              recallContractIds: [recallR],
              transferDate: '2026-08-20',
            },
            adminId,
          );
          createdBatchIds.push(batch.id);
          expect(
            batch.items.find((i) => i.contractId === recallR)!.recallAmount.toFixed(2),
          ).toBe('11000.00');
          await settlementService.submitBatch(batch.id, adminId);
          approveOutcome = await settlementService
            .approveBatch(batch.id, adminId, new Date(2026, 6, 15))
            .then(() => ({ ok: true }))
            .catch((err: unknown) => ({ ok: false, err }));
        } finally {
          releaseGate!();
          spy.mockRestore();
        }

        const settleOutcome = await settlePromise!
          .then(() => ({ ok: true }) as { ok: boolean; err?: unknown })
          .catch((err: unknown) => ({ ok: false, err }));

        // ผู้แพ้ต้องเป็น HttpException สะอาด (409 SSI abort / 400 guard) — ห้าม
        // raw Prisma error (P2028 tx timeout = หน้าต่างไม่ได้แข่งจริง ต้องดังไว้)
        for (const outcome of [approveOutcome!, settleOutcome]) {
          if (outcome.ok) continue;
          const err = outcome.err;
          expect(
            err instanceof HttpException,
            `ผู้แพ้ต้องเป็น HttpException: ${(err as { constructor?: { name?: string } })?.constructor?.name}: ${(err as Error)?.message}`,
          ).toBe(true);
          expect([400, 409]).toContain((err as HttpException).getStatus());
        }

        // invariant หลัก: หักได้ครั้งเดียวเท่านั้น
        expect(
          [approveOutcome!.ok, settleOutcome.ok].filter(Boolean),
          'ทั้ง approve และ settle สำเร็จพร้อมกัน = หักซ้ำยอดเรียกคืนก้อนเดียว',
        ).toHaveLength(1);

        // เงิน: 11-2107 ทั้งบัญชี = +11,000 (ตั้งหนี้) − 11,000 (หักครั้งเดียว) = 0
        // ถ้าหักสองเด้ง จะเป็น −11,000
        expect((await wholeAccountBalance('11-2107')).minus(pre2107).toFixed(2)).toBe('0.00');
      },
      120_000,
    );
  });

  // ===========================================================================
  // Phase 4 Task 6 — precedence ของ typed lens: explicit stamp ต้องชนะ flow
  // fallback ให้ตรง `classifyShopReceivable` (EXPLICIT ก่อน FLOW_MAP).
  // เดิม `swapCreditFinanceBalance` + เลนส์ `swapCreditGl` + `glSwapCreditTotal`
  // + `SWAP_COND` ของรายงานอายุ เขียนเป็น `OR flow = 'exchange-buyback-...'`
  // แบบไม่ดู stamp ⇒ JE รูป A.3 ที่ stamp ประเภทอื่นถูกนับ **สองประเภทพร้อมกัน**
  // (SWAP_CREDIT + PAYOUT_RECALL) — เป็นบั๊กแบบเดียวกับที่ `shopCollectTypedBalance`
  // มี carve-out ปิดไปแล้วตั้งแต่ Phase 3 Task 6.
  // ===========================================================================
  describe('typed precedence — explicit stamp ชนะ flow fallback (Phase 4 Task 6)', () => {
    it(
      'JE flow A.3 ที่ stamp PAYOUT_RECALL → ไม่ถูกนับเป็น SWAP_CREDIT (helper + เลนส์ + ยอดทั้งบัญชี) และแถวเก่าทุกชนิดยอดเดิม',
      async () => {
        const beforeTotals = await pendingService.getReconcileTotals();

        // (1) JE รูป A.3 (flow เดิม) แต่ stamp explicit เป็น PAYOUT_RECALL
        const misStamped = await seedBaseContract(90);
        await seed1a(misStamped);
        await seedShopLegs(misStamped, '10000', '1000');
        await journalAuto.createAndPost({
          description: 'A.3 flow แต่ stamp PAYOUT_RECALL',
          companyId: financeId,
          metadata: {
            flow: 'exchange-buyback-receivable-11-2107',
            idempotencyKey: `ta3mis:${misStamped}`,
            contractId: misStamped,
            shopReceivableType: 'PAYOUT_RECALL',
          },
          lines: [
            { accountCode: '11-2107', dr: dec('5000'), cr: zero },
            { accountCode: '21-1103', dr: zero, cr: dec('5000') },
          ],
        });

        // (2) JE รูป A.3 ที่ stamp เป็นค่าที่ไม่อยู่ในสามประเภท → ต้องตกไป
        //     fallback เป็น SWAP_CREDIT เหมือนเดิม (ตรง EXPLICIT.has ที่ล้มเหลว
        //     แล้วไปต่อที่ FLOW_MAP ใน classifyShopReceivable)
        const oddStamped = await seedBaseContract(91);
        await journalAuto.createAndPost({
          description: 'A.3 flow แต่ stamp ค่าที่ไม่รู้จัก',
          companyId: financeId,
          metadata: {
            flow: 'exchange-buyback-receivable-11-2107',
            idempotencyKey: `ta3odd:${oddStamped}`,
            contractId: oddStamped,
            shopReceivableType: 'SOMETHING_ELSE',
          },
          lines: [
            { accountCode: '11-2107', dr: dec('4000'), cr: zero },
            { accountCode: '21-1106', dr: zero, cr: dec('4000') },
          ],
        });

        // --- แถวที่แก้: ต้องเป็น PAYOUT_RECALL ล้วน ไม่ปนเป็น SWAP_CREDIT ---
        expect((await swapCreditFinanceBalance(prisma, misStamped)).toFixed(2)).toBe('0.00');
        expect((await recallFinanceBalance(prisma, misStamped)).toFixed(2)).toBe('5000.00');
        const misRow = (await pendingService.getPendingContracts()).find(
          (p) => p.contractId === misStamped,
        )!;
        expect(misRow).toBeDefined();
        expect(misRow.swapCreditGl.toFixed(2)).toBe('0.00');
        expect(misRow.swapCreditEligible).toBe(false);

        // --- แถวเก่าทุกชนิดต้องให้ผลเดิมทุกบาท (regression) ---
        // (ก) A.3 ยุค Phase 1+ (stamp SWAP_CREDIT + flow A.3) → branch explicit
        expect((await swapCreditFinanceBalance(prisma, swapId)).toFixed(2)).toBe('8000.00');
        // (ข) A.3 ยุค legacy (ไม่มี stamp เลย + flow A.3) → branch fallback
        expect((await swapCreditFinanceBalance(prisma, legacySwapId)).toFixed(2)).toBe('8000.00');
        // (ค) stamp ค่าที่ไม่รู้จัก + flow A.3 → branch fallback (เหมือน (ข))
        expect((await swapCreditFinanceBalance(prisma, oddStamped)).toFixed(2)).toBe('4000.00');
        const oddRow = (await pendingService.getPendingContracts()).find(
          (p) => p.contractId === oddStamped,
        );
        // สัญญานี้ไม่มี 1A จึงไม่อยู่ในคิวรอจ่าย — เลนส์ต่อสัญญาตรวจผ่าน helper
        // ข้างบนแล้ว; ยอดทั้งบัญชีด้านล่างเป็นตัวยืนยันฝั่งเลนส์ของ (ค)
        expect(oddRow).toBeUndefined();

        // --- ยอด typed ทั้งบัญชี (twin ตัวที่สามใน interco-pending.service) ---
        const afterTotals = await pendingService.getReconcileTotals();
        // เพิ่มเฉพาะ (ค) 4,000 — (1) 5,000 ต้องไม่เข้ากอง SWAP_CREDIT
        expect(
          afterTotals.glSwapCreditTotal.minus(beforeTotals.glSwapCreditTotal).toFixed(2),
        ).toBe('4000.00');
        expect(
          afterTotals.glRecallTotal.minus(beforeTotals.glRecallTotal).toFixed(2),
        ).toBe('5000.00');
      },
      120_000,
    );
  });
});
