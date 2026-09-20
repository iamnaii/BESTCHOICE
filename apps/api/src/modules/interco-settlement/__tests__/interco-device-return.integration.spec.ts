import { ConflictException } from '@nestjs/common';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { ContractStatus, InterCoBatchStatus, Prisma, PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import * as Sentry from '@sentry/nestjs';

// Partial mock — residual-alarm assertions (Task 8) อ่าน Sentry.captureMessage; ที่เหลือของ
// @sentry/nestjs เป็นของจริง (ไม่มี DSN = no-op) — shape เดียวกับ interco-netting spec
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
import { glContractBalance } from '../../journal/gl-contract-balance';
import { IntercoPendingService } from '../interco-pending.service';
import { IntercoBatchNumberService } from '../interco-batch-number.service';
import { IntercoSettlementService } from '../interco-settlement.service';
import { IntercoAgingService, negativeTypedFields } from '../interco-aging.service';
import {
  SHOP_RECEIVABLE_TYPES,
  classifyShopReceivable,
} from '../../journal/shop-receivable-type.util';
import {
  deviceReturnFinanceBalance,
  deviceReturnShopBalance,
  recallFinanceBalance,
  recallShopBalance,
  shopCollectShopBalance,
  shopCollectTypedBalance,
  swapCreditFinanceBalance,
  swapCreditShopBalance,
} from '../interco-typed-balance';

/**
 * ใบรับเครื่องคืน — ประเภทลูกหนี้ DEVICE_RETURN ครบทุกเลนส์ + แถวหักประเภทที่ 3 ในรอบจ่าย
 * INTER-CO + รับเงินสดสำรอง + ด่านใบรับโอน (spec 2026-09-20 §6.2–§6.5) บน DB จริง.
 *
 * Phase 1 ไม่มี producer จริง (JP5 ที่ stamp DEVICE_RETURN มาใน Phase 2 —
 * RepossessionsService.createInTx) จึง seed JE สังเคราะห์ผ่าน JournalAutoService.createAndPost
 * ด้วย metadata shape ตรง producer:
 *   - FINANCE JP5 (golden §6.5) → Dr 11-2107 [DEVICE_RETURN] 7,000 + ขาอื่นของการยึด
 *   - SHOP intake (flow 'shop-repossession-intake') → Cr S21-1104 [DEVICE_RETURN] 7,000
 *   - สัญญาปกติ Y (1A + SHOP legs) → เจ้าหนี้ 10,000 + 1,000 ให้รอบจ่ายมีเงินให้หัก
 *
 * Harness conventions ตาม interco-netting.integration.spec.ts (real PrismaClient ไม่ใช้
 * Nest DI, seedFinanceCoa/seedShopCoa, cleanup แบบ scoped, JournalPostAuditLog ลบก่อน JE).
 * Fixture prefix DRTEST- สำหรับ cleanup; assertion ระดับบัญชีเป็น **delta** เสมอ (DB แชร์กับ
 * suite อื่น).
 */

const prisma = new PrismaClient();
const journalAuto = new JournalAutoService(prisma as never);
const pendingService = new IntercoPendingService(prisma as never);
const companyResolver = new CompanyResolverService(prisma as never);
const pairedJournal = new PairedJournalService(journalAuto, prisma as never, companyResolver);
const batchNumberService = new IntercoBatchNumberService(prisma as never);
const agingService = new IntercoAgingService(prisma as never);
// uploadSlip (StorageService dep) unused by this suite — stub instead of real S3.
const storageStub = { upload: async () => undefined, delete: async () => undefined };
// Real template — Task 6 พิสูจน์ด่าน §6.4 ผ่านเส้นทาง production จริง และ Task 9 ใช้เป็น
// FINANCE leg ของ settleDeductionCash
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

// Unique-per-run suffix — leftovers ของ run ที่ crash (unique nationalId/imeiSerial/phone)
// ชนกับ run นี้ไม่ได้
const RUN = Date.now().toString(36);
const RUN_NUM = String(Date.now() % 1_000_000).padStart(6, '0');

const dec = (s: string) => new Decimal(s);
const zero = dec('0');

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

/**
 * Customer + product + contract — prefix DRTEST- for cleanup. `status` default ACTIVE;
 * สัญญาที่ "ยึดแล้ว" ส่ง 'CLOSED_BAD_DEBT' (เครื่อง REPOSSESSED / ย้ายไป SHOP / PHONE_USED
 * ตามที่ JP5 ทำจริง) — hydrate ของคิวค่าเครื่องคืนต้องไม่กรองสถานะนี้ออก
 */
async function seedBaseContract(seq: number, status: ContractStatus = 'ACTIVE'): Promise<string> {
  const tag = `${RUN}-${seq}`;
  const repossessed = status === 'CLOSED_BAD_DEBT';
  const customer = await prisma.customer.create({
    data: {
      name: `__DRTEST_${tag}__`,
      phone: `095${RUN_NUM}${seq}`,
      nationalId: `DRTEST-${tag}`,
    },
  });
  createdCustomerIds.push(customer.id);

  const product = await prisma.product.create({
    data: {
      name: `Device Return Test ${tag}`,
      brand: 'DrTestBrand',
      model: `DrModel-${tag}`,
      storage: '128GB',
      imeiSerial: `DRTEST-${tag}`,
      category: repossessed ? 'PHONE_USED' : 'PHONE_NEW',
      costPrice: dec('6000.00'),
      installmentPrice: dec('12000.00'),
      branchId,
      status: repossessed ? 'REPOSSESSED' : 'SOLD_INSTALLMENT',
      ownedByCompanyId: repossessed ? shopId : financeId,
    },
  });
  createdProductIds.push(product.id);

  const contract = await prisma.contract.create({
    data: {
      contractNumber: `DRTEST-${tag}`,
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
      status,
    },
  });
  createdContractIds.push(contract.id);
  return contract.id;
}

/** 1A synthetic — สัญญาเข้าคิวรอจ่าย (21-1101 10,000 / 21-1102 1,000). */
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

/** SHOP legs synthetic (S11-3001/S11-3002 receivable) — shape เดียวกับ interco-netting spec. */
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

/** สัญญาขายปกติ Y: payable 10,000+1,000 + SHOP legs เท่ากัน — เงินของรอบจ่ายที่ค่าเครื่องคืนจะถูกหักออก */
async function seedNormalContract(id: string) {
  await seed1a(id);
  await seedShopLegs(id, '10000', '1000');
}

/**
 * JE คู่ของใบรับเครื่องคืนหลังยืนยัน — shape ตรง producer ของ Phase 2 (RepossessionsService.createInTx):
 *   FINANCE JP5 (golden §6.5 — สัญญา 17,000/12 งวด จ่าย 4 ยังไม่ accrual ราคาประเมิน 7,000):
 *     Dr 11-2107 7,000 · Dr 11-2106 4,000 · Dr 21-2102 793.32 · Dr 51-1102 5,126.68
 *     / Cr 11-2101 11,333.36 · Cr 11-2105 793.32 · Cr 21-2101 793.32 · Cr 41-1101 4,000  (Σ 16,920.00)
 *   SHOP intake (ShopCollectShopLegs.postRepossessionIntake): Dr S11-2002 / Cr S21-1104 [ราคาประเมิน]
 * ทั้งสองใบ stamp shopReceivableType DEVICE_RETURN + metadata.contractId (key ของทุกเลนส์).
 * JP5 ยัง stamp shopReceivable '11-2107' (marker เก่าของ JP4/JP5) — explicit stamp ต้องชนะ
 * ไม่งั้นเลนส์ SHOP_COLLECT นับซ้ำ (นี่คือเหตุที่ IN-list ต้องมี DEVICE_RETURN — Task 3).
 * `shopAmount` ต่างจาก 7,000 = fixture สองสมุดไม่ตรง (guard tests).
 */
async function seedDeviceReturnPair(contractId: string, opts: { shopAmount?: string } = {}) {
  const contract = await prisma.contract.findUniqueOrThrow({
    where: { id: contractId },
    select: { productId: true },
  });
  await journalAuto.createAndPost({
    description: 'JP5 synthetic (ใบรับเครื่องคืน)',
    companyId: financeId,
    metadata: {
      flow: 'test-jp5-device-return',
      idempotencyKey: `tjp5dr:${contractId}`,
      tag: 'JP5',
      contractId,
      shopReceivableType: 'DEVICE_RETURN',
      shopReceivable: '11-2107',
    },
    lines: [
      { accountCode: '11-2107', dr: dec('7000.00'), cr: zero },
      { accountCode: '11-2106', dr: dec('4000.00'), cr: zero },
      { accountCode: '21-2102', dr: dec('793.32'), cr: zero },
      { accountCode: '51-1102', dr: dec('5126.68'), cr: zero },
      { accountCode: '11-2101', dr: zero, cr: dec('11333.36') },
      { accountCode: '11-2105', dr: zero, cr: dec('793.32') },
      { accountCode: '21-2101', dr: zero, cr: dec('793.32') },
      { accountCode: '41-1101', dr: zero, cr: dec('4000.00') },
    ],
  });
  const shopAmount = dec(opts.shopAmount ?? '7000.00');
  await journalAuto.createAndPost({
    description: 'SHOP intake synthetic (ใบรับเครื่องคืน)',
    companyId: shopId,
    metadata: {
      flow: 'shop-repossession-intake',
      idempotencyKey: `shop-repossession-intake:${contractId}`,
      contractId,
      productId: contract.productId,
      companyCode: 'SHOP',
      shopReceivableType: 'DEVICE_RETURN',
    },
    lines: [
      { accountCode: 'S11-2002', dr: shopAmount, cr: zero },
      { accountCode: 'S21-1104', dr: zero, cr: shopAmount },
    ],
  });
}

interface LineRow {
  accountCode: string;
  debit: { toString(): string };
  credit: { toString(): string };
}

/** Σ of one side for a given account code over JE lines. */
function sumSide(lines: LineRow[], code: string, side: 'dr' | 'cr'): Decimal {
  return lines
    .filter((l) => l.accountCode === code)
    .reduce(
      (s, l) => s.plus(side === 'dr' ? l.debit.toString() : l.credit.toString()),
      new Decimal(0),
    );
}

/** Whole-account Σ(Dr−Cr) — NO metadata filter (ขา Cr ของ batch นับปกติแม้เลนส์ typed ไม่เห็น). */
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

/**
 * สัญญา swap ตาม workbook Case 8 (payable 10,000+1,000 / SHOP legs เท่ากัน / เครดิตรับซื้อ 8,000):
 * A.3 → 11-2107 [SWAP_CREDIT] (flow legacy + explicit stamp), A.4 → S21-1104 [SWAP_CREDIT] key
 * ด้วย metadata.newContractId. ใช้เป็น "สัญญาที่เคยถูกหักเครดิตในรอบจ่าย แล้วภายหลังถูกยึด".
 */
async function seedSwapContract(id: string) {
  await seed1a(id);
  await seedShopLegs(id, '10000', '1000');
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
      { accountCode: 'S21-1104', dr: zero, cr: dec('8000') },
    ],
  });
}

/** Minimal batch row (ไม่มี JE) — สำหรับ settled-gate/clash fixtures. */
async function seedBatch(status: InterCoBatchStatus, seq: number) {
  const batch = await prisma.interCoSettlementBatch.create({
    data: {
      batchNumber: `IC-DRTEST-${RUN}-${seq}`,
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

let normalId: string;
let schemaProbeId: string;
/** สัญญา X — ยึดแล้ว (CLOSED_BAD_DEBT) มีคู่ JE DEVICE_RETURN 7,000/7,000 */
let deviceReturnId: string;
let baselineTotals: Awaited<ReturnType<IntercoPendingService['getReconcileTotals']>>;

describe('ใบรับเครื่องคืน — DEVICE_RETURN ครบทุกเลนส์ + รอบจ่าย INTER-CO (real DB)', () => {
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
      where: { name: '__device_return_test_branch__', deletedAt: null },
    });
    if (existingBranch) {
      branchId = existingBranch.id;
    } else {
      const branch = await prisma.branch.create({
        data: { name: '__device_return_test_branch__', companyId: shopId },
      });
      branchId = branch.id;
      createdBranchId = branch.id;
    }

    normalId = await seedBaseContract(1);
    await seedNormalContract(normalId);
    schemaProbeId = await seedBaseContract(99);
    // Whole-account baselines BEFORE this run's DEVICE_RETURN seeds — assertion เป็น delta
    baselineTotals = await pendingService.getReconcileTotals();

    deviceReturnId = await seedBaseContract(2, 'CLOSED_BAD_DEBT');
    await seedDeviceReturnPair(deviceReturnId);
  }, 120_000);

  afterAll(async () => {
    try {
      const jeIds = new Set<string>();
      for (const cid of createdContractIds) {
        for (const key of ['contractId', 'newContractId']) {
          const rows = await prisma.journalEntry.findMany({
            where: { metadata: { path: [key], equals: cid } as never },
            select: { id: true },
          });
          rows.forEach((r) => jeIds.add(r.id));
        }
      }
      // Settlement + reversal JEs carry metadata.settlementBatchId (NOT contractId — architecture ruling)
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

      await prisma.interCoSettlementItem.deleteMany({
        where: { batchId: { in: createdBatchIds } },
      });
      await prisma.interCoSettlementBatch.deleteMany({ where: { id: { in: createdBatchIds } } });

      await prisma.contract.deleteMany({ where: { id: { in: createdContractIds } } });
      await prisma.product.deleteMany({ where: { id: { in: createdProductIds } } });
      await prisma.customer.deleteMany({ where: { id: { in: createdCustomerIds } } });
      if (createdBranchId) {
        try {
          await prisma.branch.delete({ where: { id: createdBranchId } });
        } catch (error) {
          // Leave only branches referenced by rows outside this spec's scope.
          if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2003') {
            throw error;
          }
        }
      }
    } finally {
      await prisma.$disconnect();
    }
  }, 120_000);

  // ===========================================================================
  // Task 1 — schema
  // ===========================================================================
  it('schema: InterCoSettlementItem รับ itemType DEVICE_RETURN + deviceReturnAmount (migration 20261003000000)', async () => {
    // batch CANCELLED — ไม่เข้า settled gate / Σ deduction ของเลนส์ใด (ไม่รบกวนเทสถัดไป)
    const batch = await seedBatch('CANCELLED', 1);
    const item = await prisma.interCoSettlementItem.create({
      data: {
        batchId: batch.id,
        contractId: schemaProbeId,
        itemType: 'DEVICE_RETURN',
        financedGl: zero,
        commissionGl: zero,
        shopFinancedGl: zero,
        shopCommissionGl: zero,
        deviceReturnAmount: dec('7000.00'),
      },
    });
    expect(item.itemType).toBe('DEVICE_RETURN');
    expect(item.deviceReturnAmount.toFixed(2)).toBe('7000.00');
    // คอลัมน์เดิม default 0 — ไม่ถูกแตะ
    expect(item.swapCreditAmount.toFixed(2)).toBe('0.00');
    expect(item.recallAmount.toFixed(2)).toBe('0.00');

    // แถวเดิมที่ไม่ส่ง deviceReturnAmount → default 0 (additive migration)
    const legacy = await prisma.interCoSettlementItem.create({
      data: {
        batchId: batch.id,
        contractId: normalId,
        itemType: 'SETTLEMENT',
        financedGl: dec('10000.00'),
        commissionGl: dec('1000.00'),
        shopFinancedGl: dec('10000.00'),
        shopCommissionGl: dec('1000.00'),
      },
    });
    expect(legacy.deviceReturnAmount.toFixed(2)).toBe('0.00');
  });
  // ===========================================================================
  // Task 3 — typed balances + classify (SQL twins ของ classifyShopReceivable)
  // ===========================================================================
  describe('typed balances — DEVICE_RETURN แยกประเภทจริง (Task 3)', () => {
    it('deviceReturnFinanceBalance/ShopBalance = 7,000 ทั้งสองสมุด; ประเภทอื่นของ X = 0; สัญญาปกติ = 0', async () => {
      expect((await deviceReturnFinanceBalance(prisma, deviceReturnId)).toFixed(2)).toBe('7000.00');
      expect((await deviceReturnShopBalance(prisma, deviceReturnId)).toFixed(2)).toBe('7000.00');

      // explicit stamp ชนะ marker เก่า (shopReceivable '11-2107' บน JP5) — ห้ามรั่วเข้า SHOP_COLLECT
      expect((await shopCollectTypedBalance(prisma, deviceReturnId)).toFixed(2)).toBe('0.00');
      expect((await shopCollectShopBalance(prisma, deviceReturnId)).toFixed(2)).toBe('0.00');
      expect((await swapCreditFinanceBalance(prisma, deviceReturnId)).toFixed(2)).toBe('0.00');
      expect((await swapCreditShopBalance(prisma, deviceReturnId)).toFixed(2)).toBe('0.00');
      expect((await recallFinanceBalance(prisma, deviceReturnId)).toFixed(2)).toBe('0.00');
      expect((await recallShopBalance(prisma, deviceReturnId)).toFixed(2)).toBe('0.00');

      expect((await deviceReturnFinanceBalance(prisma, normalId)).toFixed(2)).toBe('0.00');
      expect((await deviceReturnShopBalance(prisma, normalId)).toFixed(2)).toBe('0.00');
    });

    it('classifyShopReceivable ของ JE ทั้งสองใบ = DEVICE_RETURN (anti-drift util ↔ SQL)', async () => {
      const jes = await prisma.journalEntry.findMany({
        where: {
          metadata: { path: ['contractId'], equals: deviceReturnId } as never,
          deletedAt: null,
        },
        include: { lines: true },
      });
      const typed = jes.filter((je) =>
        je.lines.some((l) => l.accountCode === '11-2107' || l.accountCode === 'S21-1104'),
      );
      expect(typed).toHaveLength(2);
      for (const je of typed) {
        expect(classifyShopReceivable(je.metadata)).toBe('DEVICE_RETURN');
      }
      expect(SHOP_RECEIVABLE_TYPES).toContain('DEVICE_RETURN');
    });
  });
  // ===========================================================================
  // Task 4 — คิวค่าเครื่องคืน (mirror ของคิว recall) + reconcile totals
  // ===========================================================================
  describe('คิวค่าเครื่องคืน — getPendingDeviceReturns + glDeviceReturnTotal (Task 4)', () => {
    it('X (CLOSED_BAD_DEBT) อยู่ในคิวที่ 7,000 ทั้งสองสมุด; ไม่โผล่คิวรอจ่าย/คิวเรียกคืน; Y ไม่โผล่คิวนี้', async () => {
      const contract = await prisma.contract.findUniqueOrThrow({ where: { id: deviceReturnId } });
      expect(contract.status).toBe('CLOSED_BAD_DEBT'); // hydrate ต้องไม่กรองสถานะนี้

      const rows = await pendingService.getPendingDeviceReturns();
      const row = rows.find((r) => r.contractId === deviceReturnId)!;
      expect(row).toBeDefined();
      expect(row.deviceReturnGl.toFixed(2)).toBe('7000.00');
      expect(row.shopDeviceReturnGl.toFixed(2)).toBe('7000.00');
      expect(row.contractNumber.startsWith('DRTEST-')).toBe(true);
      expect(row.customerName).toContain('__DRTEST_');
      expect(rows.some((r) => r.contractId === normalId)).toBe(false);

      const pending = await pendingService.getPendingContracts();
      expect(pending.some((p) => p.contractId === deviceReturnId)).toBe(false);
      expect(pending.some((p) => p.contractId === normalId)).toBe(true);
      const recalls = await pendingService.getPendingRecalls();
      expect(recalls.some((r) => r.contractId === deviceReturnId)).toBe(false);
    });

    it('reconcile totals: glDeviceReturnTotal +7,000 และ glShopBuybackTotal +7,000 (delta จาก baseline); ยอดเดิมยังอยู่ครบ', async () => {
      const totals = await pendingService.getReconcileTotals();
      expect(totals.glDeviceReturnTotal.minus(baselineTotals.glDeviceReturnTotal).toFixed(2)).toBe(
        '7000.00',
      );
      expect(totals.glShopBuybackTotal.minus(baselineTotals.glShopBuybackTotal).toFixed(2)).toBe(
        '7000.00',
      );
      // SWAP_CREDIT / PAYOUT_RECALL ไม่ขยับ (แยกประเภทจริง)
      expect(totals.glSwapCreditTotal.minus(baselineTotals.glSwapCreditTotal).toFixed(2)).toBe(
        '0.00',
      );
      expect(totals.glRecallTotal.minus(baselineTotals.glRecallTotal).toFixed(2)).toBe('0.00');
      expect(totals.pendingTotal).toBeDefined();
      expect(totals.drift).toBeDefined();
    });

    it('same-type NET preserves prior swap credit; only open DEVICE_RETURN items gate the queue', async () => {
      const g = await seedBaseContract(3, 'CLOSED_BAD_DEBT');
      await seedDeviceReturnPair(g);

      // (a) สัญญาที่ยึดเคยถูกจ่ายในรอบ POSTED มาก่อนโดยนิยาม — item SETTLEMENT (ไม่มีอะไรหัก)
      //     ต้องไม่บังคิวค่าเครื่องคืน
      const b1 = await seedBatch('POSTED', 2);
      await prisma.interCoSettlementItem.create({
        data: {
          batchId: b1.id,
          contractId: g,
          itemType: 'SETTLEMENT',
          financedGl: dec('10000.00'),
          commissionGl: dec('1000.00'),
          shopFinancedGl: dec('10000.00'),
          shopCommissionGl: dec('1000.00'),
        },
      });
      let rows = await pendingService.getPendingDeviceReturns();
      expect(rows.find((r) => r.contractId === g)!.deviceReturnGl.toFixed(2)).toBe('7000.00');

      // (b) DEVICE_RETURN item ใน batch PENDING_APPROVAL → ตัดออกจากคิว
      const b2 = await seedBatch('PENDING_APPROVAL', 3);
      const gateItem = await prisma.interCoSettlementItem.create({
        data: {
          batchId: b2.id,
          contractId: g,
          itemType: 'DEVICE_RETURN',
          financedGl: zero,
          commissionGl: zero,
          shopFinancedGl: zero,
          shopCommissionGl: zero,
          deviceReturnAmount: dec('7000.00'),
        },
      });
      rows = await pendingService.getPendingDeviceReturns();
      expect(rows.some((r) => r.contractId === g)).toBe(false);
      expect(rows.some((r) => r.contractId === deviceReturnId)).toBe(true); // X ไม่เกี่ยว

      // (c) รอบนั้น CANCELLED → item หลุด gate → กลับเข้าคิวเต็ม 7,000 (REVERSED/CANCELLED ไม่นับ)
      await prisma.interCoSettlementBatch.update({
        where: { id: b2.id },
        data: { status: 'CANCELLED' },
      });
      rows = await pendingService.getPendingDeviceReturns();
      expect(rows.find((r) => r.contractId === g)!.deviceReturnGl.toFixed(2)).toBe('7000.00');

      // (ง) สูตร NET same-type (spec §6.3 ฉบับตัดสิน): deduction ของ item **ประเภทอื่น** ใน batch
      //     POSTED ต้อง**ไม่**ลดค่าเครื่องคืน — SETTLEMENT item ของ b1 ถือ swapCreditAmount 8,000
      //     (สัญญา swap ที่เคยถูกหักเครดิตแล้วภายหลังถูกยึด) → ยังอยู่ในคิวที่ 7,000 ทั้งสองสมุด
      //     (สูตร all-types เดิมจะได้ 7,000 − 8,000 < 0 = หลุดคิวทั้งที่หนี้มีจริง)
      await prisma.interCoSettlementItem.updateMany({
        where: { batchId: b1.id, contractId: g },
        data: { swapCreditAmount: dec('8000.00') },
      });
      rows = await pendingService.getPendingDeviceReturns();
      const netRow = rows.find((r) => r.contractId === g)!;
      expect(netRow).toBeDefined();
      expect(netRow.deviceReturnGl.toFixed(2)).toBe('7000.00');
      expect(netRow.shopDeviceReturnGl.toFixed(2)).toBe('7000.00');

      // cleanup ของเทสนี้เอง — deduction สังเคราะห์ที่ไม่มี GL หนุนต้องไม่ค้างไปกวน
      // Σ settledDeduction ทั้งตารางของ getTypedAccountDrift (Task 5)
      await prisma.interCoSettlementItem.delete({ where: { id: gateItem.id } });
      await prisma.interCoSettlementItem.deleteMany({ where: { batchId: b1.id } });
      await prisma.interCoSettlementBatch.deleteMany({ where: { id: { in: [b1.id, b2.id] } } });
    });
  });
  // ===========================================================================
  // Task 5 — รายงานอายุ + กระทบยอดระดับบัญชี (anti-drift บังคับตาม spec §6.2)
  // ===========================================================================
  describe('รายงานอายุ + getTypedAccountDrift (Task 5)', () => {
    it('แถว X: deviceReturnGross 7,000 เข้ากลุ่ม interco, กระจก SHOP 7,000, ไม่ mismatch, ไม่ใช่ legacy, อายุ 0 วัน', async () => {
      const res = await agingService.getShopReceivableAging();
      const row = res.rows.find((r) => r.contractId === deviceReturnId)!;
      expect(row).toBeDefined();
      expect(row.deviceReturnGross.toFixed(2)).toBe('7000.00');
      expect(row.swapCreditGross.toFixed(2)).toBe('0.00');
      expect(row.payoutRecallGross.toFixed(2)).toBe('0.00');
      expect(row.shopCollect.toFixed(2)).toBe('0.00'); // marker shopReceivable '11-2107' ต้องไม่รั่ว
      expect(row.settledDeduction.toFixed(2)).toBe('0.00');
      expect(row.intercoNet.toFixed(2)).toBe('7000.00');
      expect(row.shopMirrorDeviceReturnGross.toFixed(2)).toBe('7000.00');
      expect(row.shopMirrorGross.toFixed(2)).toBe('7000.00');
      expect(row.shopMirrorSwapGross.toFixed(2)).toBe('0.00');
      expect(row.shopMirrorRecallGross.toFixed(2)).toBe('0.00');
      expect(row.shopMirrorCollectGross.toFixed(2)).toBe('0.00');
      expect(row.shopMirrorNet.toFixed(2)).toBe('7000.00');
      expect(row.bookMismatch).toBe(false);
      expect(row.legacyOneBook).toBe(false);
      expect(row.intercoAgeDays).toBe(0);
      expect(row.shopCollectAgeDays).toBeNull();
      // totals นับ X (ไม่ใช่ legacy) — อย่างน้อยเท่ายอดของ X
      expect(res.totals.intercoNet.gte('7000.00')).toBe(true);
    });

    it('สองสมุดไม่ตรง (FINANCE 7,000 / SHOP 6,000) → bookMismatch = true และแถวยังรายงาน', async () => {
      const id = await seedBaseContract(4, 'CLOSED_BAD_DEBT');
      await seedDeviceReturnPair(id, { shopAmount: '6000.00' });
      const res = await agingService.getShopReceivableAging();
      const row = res.rows.find((r) => r.contractId === id)!;
      expect(row).toBeDefined();
      expect(row.intercoNet.toFixed(2)).toBe('7000.00');
      expect(row.shopMirrorNet.toFixed(2)).toBe('6000.00');
      expect(row.bookMismatch).toBe(true);
    });

    it('getTypedAccountDrift: seed คู่ DEVICE_RETURN ใหม่ → lens/account ขยับ 7,000 เท่ากัน, drift ไม่ขยับ (ทั้ง 11-2107 และ S21-1104)', async () => {
      const before = await agingService.getTypedAccountDrift();
      const id = await seedBaseContract(5, 'CLOSED_BAD_DEBT');
      await seedDeviceReturnPair(id);
      const after = await agingService.getTypedAccountDrift();
      expect(after.map((d) => d.accountCode)).toEqual(['11-2107', 'S21-1104']);
      for (const code of ['11-2107', 'S21-1104']) {
        const b = before.find((d) => d.accountCode === code)!;
        const a = after.find((d) => d.accountCode === code)!;
        expect(a.accountTotal.minus(b.accountTotal).toFixed(2)).toBe('7000.00');
        expect(a.lensTotal.minus(b.lensTotal).toFixed(2)).toBe('7000.00');
        expect(a.settledDeduction.minus(b.settledDeduction).toFixed(2)).toBe('0.00');
        expect(a.drift.minus(b.drift).abs().lte('0.01')).toBe(true);
      }
    });

    it('negativeTypedFields รายงานช่อง deviceReturnGross / shopMirrorDeviceReturnGross ที่ติดลบ (แหล่งเดียวของ reconcile cron)', () => {
      const base = {
        intercoNet: dec('0'),
        shopCollect: dec('0'),
        shopMirrorNet: dec('0'),
        shopMirrorCollectGross: dec('0'),
        deviceReturnGross: dec('0'),
        shopMirrorDeviceReturnGross: dec('0'),
        legacyOneBook: false,
      };
      expect(negativeTypedFields(base)).toEqual([]);
      const fields = negativeTypedFields({
        ...base,
        deviceReturnGross: dec('-7000'),
        shopMirrorDeviceReturnGross: dec('-7000'),
      }).map((f) => f.field);
      expect(fields).toEqual(['deviceReturnGross', 'shopMirrorDeviceReturnGross']);
      // แถว legacy ยังใช้ยอดรวมระดับสัญญา (ไม่แตะกติกาเดิม)
      expect(
        negativeTypedFields({ ...base, legacyOneBook: true, deviceReturnGross: dec('-1') }),
      ).toEqual([]);
    });
    it('POSTED device return deductions reduce both aging nets and account lenses equally', async () => {
      const id = await seedBaseContract(6, 'CLOSED_BAD_DEBT');
      await seedDeviceReturnPair(id);
      const before = await agingService.getTypedAccountDrift();
      const batch = await seedBatch('POSTED', 5);
      await prisma.interCoSettlementItem.create({
        data: {
          batchId: batch.id,
          contractId: id,
          itemType: 'DEVICE_RETURN',
          financedGl: zero,
          commissionGl: zero,
          shopFinancedGl: zero,
          shopCommissionGl: zero,
          deviceReturnAmount: dec('2000.00'),
        },
      });
      // Batch clearing legs deliberately have no contractId/type stamp: deductions supply the lens.
      for (const [companyId, accountCode, bankCode, finance] of [
        [financeId, '11-2107', '11-1201', true],
        [shopId, 'S21-1104', 'S11-1201', false],
      ] as const) {
        await journalAuto.createAndPost({
          description: 'Synthetic device return batch clearing',
          companyId,
          metadata: {
            flow: 'test-device-return-clearing',
            idempotencyKey: `${batch.id}:${companyId}`,
            settlementBatchId: batch.id,
          },
          lines: [
            { accountCode, dr: finance ? zero : dec('2000'), cr: finance ? dec('2000') : zero },
            {
              accountCode: bankCode,
              dr: finance ? dec('2000') : zero,
              cr: finance ? zero : dec('2000'),
            },
          ],
        });
      }
      const row = (await agingService.getShopReceivableAging()).rows.find(
        (r) => r.contractId === id,
      )!;
      expect(row.settledDeduction.toFixed(2)).toBe('2000.00');
      expect(row.intercoNet.toFixed(2)).toBe('5000.00');
      expect(row.shopMirrorNet.toFixed(2)).toBe('5000.00');
      expect(row.bookMismatch).toBe(false);
      const after = await agingService.getTypedAccountDrift();
      for (const a of after) {
        const b = before.find((d) => d.accountCode === a.accountCode)!;
        expect(a.accountTotal.minus(b.accountTotal).toFixed(2)).toBe('-2000.00');
        expect(a.lensTotal.minus(b.lensTotal).toFixed(2)).toBe('0.00');
        expect(a.settledDeduction.minus(b.settledDeduction).toFixed(2)).toBe('2000.00');
        expect(a.drift.minus(b.drift).abs().lte('0.01')).toBe(true);
      }
    });
  });
  // ===========================================================================
  // Task 6 — ด่านใบรับโอนจากหน้าร้าน (§6.4) ผ่านเส้นทาง production จริง
  // ===========================================================================
  describe('ด่านใบรับโอนจากหน้าร้าน — ShopCollectSettlementTemplate (Task 6)', () => {
    it('สัญญาที่มีค่าเครื่องคืนค้าง → ใบรับโอน (typeStamp เริ่มต้น) ถูกปฏิเสธ และ GL ไม่ขยับ', async () => {
      const id = await seedBaseContract(600, 'CLOSED_BAD_DEBT');
      await seedDeviceReturnPair(id);

      await expect(
        shopCollectTemplate.execute({
          contractId: id,
          depositAccountCode: '11-1201',
          amount: 7000,
          requestId: randomUUID(),
        }),
      ).rejects.toThrow(/ค่าเครื่องคืนที่ต้องหักผ่านรอบจ่าย INTER-CO/);

      expect((await glContractBalance(prisma, id, '11-2107', 'dr')).toFixed(2)).toBe('7000.00');
      expect((await deviceReturnFinanceBalance(prisma, id)).toFixed(2)).toBe('7000.00');
      // ยังอยู่ในคิวค่าเครื่องคืน — ทางล้างเดียวคือรอบจ่าย/รับเงินสด (Task 7-9)
      const rows = await pendingService.getPendingDeviceReturns();
      expect(rows.some((r) => r.contractId === id)).toBe(true);
    });
  });

  describe('Task 6 - historical DEVICE_RETURN at zero balance', () => {
    it('cleared typed history still blocks a generic receipt against unrelated legacy balance', async () => {
      const id = await seedBaseContract(601, 'CLOSED_BAD_DEBT');
      await seedDeviceReturnPair(id);
      await journalAuto.createAndPost({
        description: 'Synthetic typed cash clearing',
        companyId: financeId,
        metadata: {
          contractId: id,
          flow: 'test-device-return-cash',
          idempotencyKey: id,
          shopReceivableType: 'DEVICE_RETURN',
        },
        lines: [
          { accountCode: '11-2107', dr: zero, cr: dec('7000') },
          { accountCode: '11-1201', dr: dec('7000'), cr: zero },
        ],
      });
      expect((await deviceReturnFinanceBalance(prisma, id)).toFixed(2)).toBe('0.00');
      await journalAuto.createAndPost({
        description: 'Legacy shop collection fixture',
        companyId: financeId,
        metadata: {
          contractId: id,
          flow: 'test-legacy-shop-collect',
          idempotencyKey: id,
          shopReceivableType: 'SHOP_COLLECT',
        },
        lines: [
          { accountCode: '11-2107', dr: dec('7000'), cr: zero },
          { accountCode: '11-1201', dr: zero, cr: dec('7000') },
        ],
      });
      const before = await prisma.journalEntry.count();
      await expect(
        shopCollectTemplate.execute({
          contractId: id,
          depositAccountCode: '11-1201',
          amount: 7000,
          requestId: randomUUID(),
        }),
      ).rejects.toThrow(/INTER-CO/);
      expect(await prisma.journalEntry.count()).toBe(before);
      expect((await glContractBalance(prisma, id, '11-2107', 'dr')).toFixed(2)).toBe('7000.00');
      expect((await deviceReturnFinanceBalance(prisma, id)).toFixed(2)).toBe('0.00');
    });
  });
  // ===========================================================================
  // Task 7 — createBatch/updateBatch/submitBatch: snapshot แถว DEVICE_RETURN + guards
  // (DRAFT ไม่ lock สัญญา — fixture X/Y ใช้ซ้ำได้จน submit)
  // ===========================================================================
  // Track guard calls too: a regression may unexpectedly create a batch before rejection fails.
  async function createTrackedBatch(...args: Parameters<typeof settlementService.createBatch>) {
    const batch = await settlementService.createBatch(...args);
    createdBatchIds.push(batch.id);
    return batch;
  }

  describe('createBatch/updateBatch/submitBatch — แถว DEVICE_RETURN (Task 7)', () => {
    it('golden §6.5: Y (10,000+1,000) + ค่าเครื่องคืน X 7,000 → totals 11,000 / หัก 7,000 / โอนสุทธิ 4,000 ทั้งสองสมุด', async () => {
      const batch = await createTrackedBatch(
        {
          contractIds: [normalId],
          deviceReturnContractIds: [deviceReturnId],
          transferDate: '2026-09-20',
        },
        adminId,
      );

      expect(batch.totalAmount.toFixed(2)).toBe('11000.00');
      expect(batch.shopPostedAmount.toFixed(2)).toBe('11000.00');
      expect(batch.totalDeduction.toFixed(2)).toBe('7000.00');
      expect(batch.netTransferAmount!.toFixed(2)).toBe('4000.00');
      expect(batch.shopNetAmount!.toFixed(2)).toBe('4000.00');
      expect(batch.items).toHaveLength(2);

      const dr = batch.items.find((i) => i.contractId === deviceReturnId)!;
      expect(dr.itemType).toBe('DEVICE_RETURN');
      expect(dr.deviceReturnAmount.toFixed(2)).toBe('7000.00');
      expect(dr.swapCreditAmount.toFixed(2)).toBe('0.00');
      expect(dr.recallAmount.toFixed(2)).toBe('0.00');
      expect(dr.financedGl.toFixed(2)).toBe('0.00');
      expect(dr.commissionGl.toFixed(2)).toBe('0.00');
      expect(dr.shopFinancedGl.toFixed(2)).toBe('0.00');
      expect(dr.shopCommissionGl.toFixed(2)).toBe('0.00');
      expect(dr.legacyNoShop).toBe(false);

      const y = batch.items.find((i) => i.contractId === normalId)!;
      expect(y.itemType).toBe('SETTLEMENT');
      expect(y.deviceReturnAmount.toFixed(2)).toBe('0.00');
      expect(y.financedGl.toFixed(2)).toBe('10000.00');
    });

    it('guard: ยอดสุทธิติดลบ (มีแต่ค่าเครื่องคืน ไม่มีสัญญาจ่าย) → reject', async () => {
      await expect(
        createTrackedBatch(
          {
            contractIds: [],
            deviceReturnContractIds: [deviceReturnId],
            transferDate: '2026-09-20',
          },
          adminId,
        ),
      ).rejects.toThrow(/เกินยอดจ่ายของรอบ/);
    });

    it('guard: สองสมุดไม่ตรง (7,000 / 6,000) → reject; สัญญาปกติในรายการค่าเครื่องคืน → reject; ซ้ำสองรายการ → reject', async () => {
      const mismatch = await seedBaseContract(7, 'CLOSED_BAD_DEBT');
      await seedDeviceReturnPair(mismatch, { shopAmount: '6000.00' });
      await expect(
        createTrackedBatch(
          {
            contractIds: [normalId],
            deviceReturnContractIds: [mismatch],
            transferDate: '2026-09-20',
          },
          adminId,
        ),
      ).rejects.toThrow(/ยอดค่าเครื่องคืนสองสมุดไม่ตรงกัน/);

      await expect(
        createTrackedBatch(
          { contractIds: [], deviceReturnContractIds: [normalId], transferDate: '2026-09-20' },
          adminId,
        ),
      ).rejects.toThrow(/ไม่อยู่ในคิวค่าเครื่องคืน/);

      await expect(
        createTrackedBatch(
          {
            contractIds: [normalId],
            deviceReturnContractIds: [normalId],
            transferDate: '2026-09-20',
          },
          adminId,
        ),
      ).rejects.toThrow(/ทั้งรายการจ่ายและรายการค่าเครื่องคืน/);
    });

    it('updateBatch: re-snapshot เพิ่มแถว DEVICE_RETURN + totals ใหม่', async () => {
      const y = await seedBaseContract(8);
      await seedNormalContract(y);
      const batch = await createTrackedBatch(
        { contractIds: [y], transferDate: '2026-09-20' },
        adminId,
      );
      expect(batch.totalDeduction.toFixed(2)).toBe('0.00');

      const updated = await settlementService.updateBatch(
        batch.id,
        { contractIds: [y], deviceReturnContractIds: [deviceReturnId], transferDate: '2026-09-20' },
        adminId,
      );
      expect(updated.items).toHaveLength(2);
      expect(updated.totalDeduction.toFixed(2)).toBe('7000.00');
      expect(updated.netTransferAmount!.toFixed(2)).toBe('4000.00');
      expect(updated.shopNetAmount!.toFixed(2)).toBe('4000.00');
      const drItem = updated.items.find((i) => i.contractId === deviceReturnId)!;
      expect(drItem.itemType).toBe('DEVICE_RETURN');
      expect(drItem.deviceReturnAmount.toFixed(2)).toBe('7000.00');
    });

    it('submitBatch: แถว DEVICE_RETURN ที่สัญญามี SETTLEMENT item เก่าใน batch POSTED (ยึดหลังเคยถูกจ่าย) → submit ผ่าน; batch ที่สองจับสัญญาเดิม → reject', async () => {
      const yA = await seedBaseContract(9);
      await seedNormalContract(yA);
      const yB = await seedBaseContract(10);
      await seedNormalContract(yB);
      const xOld = await seedBaseContract(11, 'CLOSED_BAD_DEBT');
      await seedDeviceReturnPair(xOld);

      // สัญญาที่ถูกยึดเคยถูกจ่ายในรอบ POSTED มาก่อนโดยนิยาม — SETTLEMENT item ถาวร
      const hist = await seedBatch('POSTED', 4);
      await prisma.interCoSettlementItem.create({
        data: {
          batchId: hist.id,
          contractId: xOld,
          itemType: 'SETTLEMENT',
          financedGl: dec('10000.00'),
          commissionGl: dec('1000.00'),
          shopFinancedGl: dec('10000.00'),
          shopCommissionGl: dec('1000.00'),
        },
      });

      const b1 = await createTrackedBatch(
        { contractIds: [yA], deviceReturnContractIds: [xOld], transferDate: '2026-09-20' },
        adminId,
      );
      const b2 = await createTrackedBatch(
        { contractIds: [yB], deviceReturnContractIds: [xOld], transferDate: '2026-09-20' },
        adminId,
      );

      const submitted = await settlementService.submitBatch(b1.id, adminId);
      expect(submitted.status).toBe('PENDING_APPROVAL');

      await expect(settlementService.submitBatch(b2.id, adminId)).rejects.toThrow(
        /อยู่ในรอบจ่ายอื่นแล้ว/,
      );
      // xOld หลุดคิวค่าเครื่องคืนระหว่างที่ b1 ค้างอนุมัติ (settled gate)
      const rows = await pendingService.getPendingDeviceReturns();
      expect(rows.some((r) => r.contractId === xOld)).toBe(false);
    });
  });
  // ===========================================================================
  // Task 8 — approve/reverse: golden §6.5 สองสมุด + drift + residual + reverse
  // ===========================================================================
  describe('approveBatch/reverseBatch — golden §6.5 (Task 8)', () => {
    let goldenNormalId: string;
    let goldenDrId: string;
    let goldenBatchId: string;
    let goldenFinanceJeId: string;
    let goldenShopJeId: string;
    let preApprove2107: Decimal;
    let preApproveS21: Decimal;
    let preApproveDrift: Awaited<ReturnType<IntercoAgingService['getTypedAccountDrift']>>;

    beforeAll(async () => {
      // Safety nets (convention ของ netting spec): SoD flag / งวด 2026-09 ที่ปิดจาก run ก่อน
      await prisma.systemConfig.deleteMany({ where: { key: 'interco_maker_checker_enabled' } });
      await prisma.accountingPeriod.deleteMany({
        where: { companyId: { in: [shopId, financeId] }, year: 2026, month: 9 },
      });
      goldenNormalId = await seedBaseContract(20);
      await seedNormalContract(goldenNormalId);
      goldenDrId = await seedBaseContract(21, 'CLOSED_BAD_DEBT');
      await seedDeviceReturnPair(goldenDrId);
    }, 120_000);

    it('approve → FINANCE Dr 21-1101 10,000 · Dr 21-1102 1,000 / Cr 11-2107 7,000 · Cr 11-1201 4,000; SHOP Dr S21-1104 7,000 · Dr S11-1201 4,000 / Cr S11-3001 10,000 · Cr S11-3002 1,000', async () => {
      preApprove2107 = await wholeAccountBalance('11-2107');
      preApproveS21 = await wholeAccountBalance('S21-1104');
      preApproveDrift = await agingService.getTypedAccountDrift();

      const batch = await createTrackedBatch(
        {
          contractIds: [goldenNormalId],
          deviceReturnContractIds: [goldenDrId],
          transferDate: '2026-09-20',
        },
        adminId,
      );
      goldenBatchId = batch.id;
      await settlementService.submitBatch(batch.id, adminId);
      const posted = await settlementService.approveBatch(batch.id, adminId);
      expect(posted.status).toBe('POSTED');
      goldenFinanceJeId = posted.financeJournalEntryId!;
      goldenShopJeId = posted.shopJournalEntryId!;

      const je = await prisma.journalEntry.findUniqueOrThrow({
        where: { id: goldenFinanceJeId },
        include: { lines: true },
      });
      expect(sumSide(je.lines, '21-1101', 'dr').toFixed(2)).toBe('10000.00');
      expect(sumSide(je.lines, '21-1102', 'dr').toFixed(2)).toBe('1000.00');
      expect(sumSide(je.lines, '11-2107', 'cr').toFixed(2)).toBe('7000.00');
      expect(sumSide(je.lines, '11-1201', 'cr').toFixed(2)).toBe('4000.00');
      expect(je.lines).toHaveLength(4); // แถว DEVICE_RETURN ไม่สร้าง Dr 21-1101 ยอด 0
      const cr2107 = je.lines.find((l) => l.accountCode === '11-2107')!;
      expect(cr2107.description).toContain('หักค่าเครื่องคืน');

      const shopJe = await prisma.journalEntry.findUniqueOrThrow({
        where: { id: goldenShopJeId },
        include: { lines: true },
      });
      expect(sumSide(shopJe.lines, 'S21-1104', 'dr').toFixed(2)).toBe('7000.00');
      expect(sumSide(shopJe.lines, 'S11-1201', 'dr').toFixed(2)).toBe('4000.00');
      expect(sumSide(shopJe.lines, 'S11-3001', 'cr').toFixed(2)).toBe('10000.00');
      expect(sumSide(shopJe.lines, 'S11-3002', 'cr').toFixed(2)).toBe('1000.00');
      expect(shopJe.lines).toHaveLength(4);
      const drS21 = shopJe.lines.find((l) => l.accountCode === 'S21-1104')!;
      expect(drS21.description).toContain('ค่าเครื่องคืน');

      // เลนส์ gross + item gate: typed ไม่ขยับ, item POSTED = หักแล้ว, X หลุดคิว
      expect((await deviceReturnFinanceBalance(prisma, goldenDrId)).toFixed(2)).toBe('7000.00');
      expect((await deviceReturnShopBalance(prisma, goldenDrId)).toFixed(2)).toBe('7000.00');
      const rows = await pendingService.getPendingDeviceReturns();
      expect(rows.some((r) => r.contractId === goldenDrId)).toBe(false);
      const pending = await pendingService.getPendingContracts();
      expect(pending.some((p) => p.contractId === goldenNormalId)).toBe(false);

      // ระดับบัญชี (trial balance): ขา Cr/Dr ของ batch นับปกติ
      expect((await wholeAccountBalance('11-2107')).minus(preApprove2107).toFixed(2)).toBe(
        '-7000.00',
      );
      expect((await wholeAccountBalance('S21-1104')).minus(preApproveS21).toFixed(2)).toBe(
        '7000.00',
      );

      // กระทบยอดระดับบัญชี: drift ไม่ขยับ (accountTotal −7,000 = expected −7,000 ผ่าน settledDeduction +7,000)
      const drift = await agingService.getTypedAccountDrift();
      for (const code of ['11-2107', 'S21-1104']) {
        const b = preApproveDrift.find((d) => d.accountCode === code)!;
        const a = drift.find((d) => d.accountCode === code)!;
        expect(a.settledDeduction.minus(b.settledDeduction).toFixed(2)).toBe('7000.00');
        expect(a.drift.minus(b.drift).abs().lte('0.01')).toBe(true);
      }
    }, 120_000);

    it('metadata.items ของทั้งสองใบ: type DEVICE_RETURN + deviceReturn 7000.00; ไม่ stamp contractId/shopReceivableType top-level', async () => {
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
        expect(meta.flow).toBe('interco-settlement-batch');
        expect(meta.idempotencyKey).toBe(`interco:${goldenBatchId}:${book}`);
        expect(meta.netTransferAmount).toBe('4000.00');
        expect(meta.contractId).toBeUndefined();
        expect(meta.shopReceivableType).toBeUndefined();
        const drMeta = meta.items!.find((i) => i.contractId === goldenDrId)!;
        expect(drMeta.type).toBe('DEVICE_RETURN');
        expect(drMeta.deviceReturn).toBe('7000.00');
        expect(drMeta.swapCredit).toBe('0.00');
        expect(drMeta.recall).toBe('0.00');
        expect(drMeta.financed).toBe('0.00');
        const yMeta = meta.items!.find((i) => i.contractId === goldenNormalId)!;
        expect(yMeta.type).toBe('SETTLEMENT');
        expect(yMeta.deviceReturn).toBe('0.00');
      }
      // JE ทั้งสองใบไม่เข้าเลนส์ใด — classify = UNKNOWN (ตามสถาปัตยกรรม)
      expect(classifyShopReceivable(financeJe.metadata)).toBe('UNKNOWN');
    });

    it('residual alarm เงียบหลัง approve (typed gross 7,000 − Σ POSTED deduction 7,000 = 0)', async () => {
      const svc = settlementService as unknown as {
        alarmNettingResiduals(batchId: string): Promise<void>;
      };
      const captureMessage = vi.mocked(Sentry.captureMessage);
      captureMessage.mockClear();
      await svc.alarmNettingResiduals(goldenBatchId);
      expect(
        captureMessage.mock.calls.filter(
          ([msg]) => msg === 'Interco netting: residual balance after approve',
        ),
      ).toHaveLength(0);
    });

    it('drift guard: JE DEVICE_RETURN แทรกหลัง submit → approve reject (net 7,500 ≠ snapshot 7,000)', async () => {
      const y = await seedBaseContract(22);
      await seedNormalContract(y);
      const x = await seedBaseContract(23, 'CLOSED_BAD_DEBT');
      await seedDeviceReturnPair(x);

      const batch = await createTrackedBatch(
        { contractIds: [y], deviceReturnContractIds: [x], transferDate: '2026-09-20' },
        adminId,
      );
      await settlementService.submitBatch(batch.id, adminId);

      await journalAuto.createAndPost({
        description: 'DEVICE_RETURN drift synthetic',
        companyId: financeId,
        metadata: {
          flow: 'test-jp5-device-return',
          idempotencyKey: `tjp5drift:${x}`,
          contractId: x,
          shopReceivableType: 'DEVICE_RETURN',
        },
        lines: [
          { accountCode: '11-2107', dr: dec('500'), cr: zero },
          { accountCode: '21-1103', dr: zero, cr: dec('500') },
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
    }, 120_000);

    it('approve ผ่านทั้งที่สัญญาค่าเครื่องคืนมี SETTLEMENT item ใน batch POSTED เดิม (ยึดหลังเคยถูกจ่าย — clash type-aware ที่ approve)', async () => {
      const y = await seedBaseContract(24);
      await seedNormalContract(y);
      const x = await seedBaseContract(25, 'CLOSED_BAD_DEBT');
      await seedDeviceReturnPair(x);
      const hist = await seedBatch('POSTED', 800);
      await prisma.interCoSettlementItem.create({
        data: {
          batchId: hist.id,
          contractId: x,
          itemType: 'SETTLEMENT',
          financedGl: dec('10000.00'),
          commissionGl: dec('1000.00'),
          shopFinancedGl: dec('10000.00'),
          shopCommissionGl: dec('1000.00'),
        },
      });

      const batch = await createTrackedBatch(
        { contractIds: [y], deviceReturnContractIds: [x], transferDate: '2026-09-20' },
        adminId,
      );
      await settlementService.submitBatch(batch.id, adminId);
      const posted = await settlementService.approveBatch(batch.id, adminId);
      expect(posted.status).toBe('POSTED');
    }, 120_000);

    it('กติกาที่ตัดสิน (same-type NET): swap ที่ถูกหักเครดิต 8,000 ในรอบ POSTED แล้วถูกยึด (ค่าเครื่องคืน 7,000) → คิวเห็น 7,000, รอบถัดไปหัก 7,000 ผ่าน drift guard, ทั้งบัญชีปิดพอดี, residual alarm เงียบ', async () => {
      const pre2107 = await wholeAccountBalance('11-2107');
      const preS21 = await wholeAccountBalance('S21-1104');

      // (1) swap ปกติ → รอบจ่ายแรกหักเครดิต 8,000 → POSTED (A.3 ไม่ถูก mirror เพราะไม่ได้ยกเลิก)
      const swap = await seedBaseContract(26);
      await seedSwapContract(swap);
      const b1 = await createTrackedBatch(
        { contractIds: [swap], transferDate: '2026-09-20' },
        adminId,
      );
      await settlementService.submitBatch(b1.id, adminId);
      await settlementService.approveBatch(b1.id, adminId);
      expect((await swapCreditFinanceBalance(prisma, swap)).toFixed(2)).toBe('8000.00'); // เลนส์ gross

      // (2) ภายหลังถูกยึด → คู่ JE DEVICE_RETURN 7,000 (สัญญา → CLOSED_BAD_DEBT)
      await prisma.contract.update({ where: { id: swap }, data: { status: 'CLOSED_BAD_DEBT' } });
      await seedDeviceReturnPair(swap);

      // คิวค่าเครื่องคืน: NET หักเฉพาะ deviceReturnAmount — เครดิตสวอป 8,000 ที่หักไปแล้วไม่เกี่ยว
      // (สูตร all-types จะได้ 7,000 − 8,000 < 0 ⇒ หลุดคิวทั้งที่หนี้ค่าเครื่องคืนมีจริง)
      let rows = await pendingService.getPendingDeviceReturns();
      const row = rows.find((r) => r.contractId === swap)!;
      expect(row).toBeDefined();
      expect(row.deviceReturnGl.toFixed(2)).toBe('7000.00');
      expect(row.shopDeviceReturnGl.toFixed(2)).toBe('7000.00');
      // รายงานอายุ (สูตร combined ระดับสัญญา — ไม่เปลี่ยน): 8,000 + 7,000 − 8,000 = 7,000
      const aging = await agingService.getShopReceivableAging();
      const agingRow = aging.rows.find((r) => r.contractId === swap)!;
      expect(agingRow.intercoNet.toFixed(2)).toBe('7000.00');
      expect(agingRow.shopMirrorNet.toFixed(2)).toBe('7000.00');
      expect(agingRow.bookMismatch).toBe(false);

      // (3) รอบถัดไป: Y ปกติ + ค่าเครื่องคืนของ swap → approve ผ่าน (drift branch ใช้ same-type;
      //     ด่าน (i) untyped 15,000 − 8,000 = 7,000 ≥ 7,000)
      const y = await seedBaseContract(27);
      await seedNormalContract(y);
      const b2 = await createTrackedBatch(
        { contractIds: [y], deviceReturnContractIds: [swap], transferDate: '2026-09-20' },
        adminId,
      );
      expect(b2.items.find((i) => i.contractId === swap)!.deviceReturnAmount.toFixed(2)).toBe(
        '7000.00',
      );
      await settlementService.submitBatch(b2.id, adminId);
      const posted = await settlementService.approveBatch(b2.id, adminId);
      expect(posted.status).toBe('POSTED');
      const je = await prisma.journalEntry.findUniqueOrThrow({
        where: { id: posted.financeJournalEntryId! },
        include: { lines: true },
      });
      expect(sumSide(je.lines, '11-2107', 'cr').toFixed(2)).toBe('7000.00');
      expect(sumSide(je.lines, '11-1201', 'cr').toFixed(2)).toBe('4000.00');

      // ทั้งบัญชี: +8,000 (A.3) −8,000 (b1) +7,000 (JP5) −7,000 (b2) = 0 ทั้งสองสมุด
      expect((await wholeAccountBalance('11-2107')).minus(pre2107).toFixed(2)).toBe('0.00');
      expect((await wholeAccountBalance('S21-1104')).minus(preS21).toFixed(2)).toBe('0.00');
      rows = await pendingService.getPendingDeviceReturns();
      expect(rows.some((r) => r.contractId === swap)).toBe(false);

      // residual alarm (สูตร combined — ไม่เปลี่ยน): typed 8,000 + 7,000 − Σ POSTED 15,000 = 0 ทั้งสองรอบ
      const svc = settlementService as unknown as {
        alarmNettingResiduals(batchId: string): Promise<void>;
      };
      const captureMessage = vi.mocked(Sentry.captureMessage);
      captureMessage.mockClear();
      await svc.alarmNettingResiduals(b1.id);
      await svc.alarmNettingResiduals(b2.id);
      expect(
        captureMessage.mock.calls.filter(
          ([msg]) => msg === 'Interco netting: residual balance after approve',
        ),
      ).toHaveLength(0);
    }, 180_000);

    it('reverse → X กลับเข้าคิวที่ 7,000, Y กลับเข้าคิวรอจ่าย, mirror ครอบบรรทัดหักเอง, บัญชีกลับเท่าก่อน approve', async () => {
      const preReverse2107 = await wholeAccountBalance('11-2107');
      const reversed = await settlementService.reverseBatch(
        goldenBatchId,
        adminId,
        'ทดสอบย้อนกลับรอบหักค่าเครื่องคืน',
      );
      expect(reversed.status).toBe('REVERSED');

      const rows = await pendingService.getPendingDeviceReturns();
      expect(rows.find((r) => r.contractId === goldenDrId)!.deviceReturnGl.toFixed(2)).toBe(
        '7000.00',
      );
      const pending = await pendingService.getPendingContracts();
      expect(pending.some((p) => p.contractId === goldenNormalId)).toBe(true);

      const reversals = await prisma.journalEntry.findMany({
        where: {
          metadata: { path: ['flow'], equals: 'interco-settlement-batch-reverse' } as never,
          deletedAt: null,
        },
        include: { lines: true },
      });
      const revFin = reversals.find(
        (je) => (je.metadata as { reversesEntryId?: string }).reversesEntryId === goldenFinanceJeId,
      )!;
      expect(revFin).toBeDefined();
      expect(sumSide(revFin.lines, '11-2107', 'dr').toFixed(2)).toBe('7000.00');
      expect(sumSide(revFin.lines, '11-1201', 'dr').toFixed(2)).toBe('4000.00');
      expect(sumSide(revFin.lines, '21-1101', 'cr').toFixed(2)).toBe('10000.00');
      const revShop = reversals.find(
        (je) => (je.metadata as { reversesEntryId?: string }).reversesEntryId === goldenShopJeId,
      )!;
      expect(revShop).toBeDefined();
      expect(sumSide(revShop.lines, 'S21-1104', 'cr').toFixed(2)).toBe('7000.00');
      expect(sumSide(revShop.lines, 'S11-1201', 'cr').toFixed(2)).toBe('4000.00');

      expect((await wholeAccountBalance('11-2107')).minus(preReverse2107).toFixed(2)).toBe(
        '7000.00',
      );
    }, 120_000);
  });
  // ===========================================================================
  // Task 9 — settleDeductionCash(DEVICE_RETURN): รับเงินสดสำรอง (spec §6.3)
  // ===========================================================================
  describe('settleDeductionCash — รับเงินสดค่าเครื่องคืน (Task 9)', () => {
    beforeAll(async () => {
      await prisma.systemConfig.deleteMany({ where: { key: 'interco_maker_checker_enabled' } });
      await prisma.accountingPeriod.deleteMany({
        where: { companyId: { in: [shopId, financeId] }, year: 2026, month: 9 },
      });
    }, 60_000);

    it('settle เต็ม 7,000 → FINANCE ใบ shop-collect-settlement stamp DEVICE_RETURN + SHOP Dr S21-1104 / Cr S11-1202 (default) stamp DEVICE_RETURN; typed = 0; หลุดคิว; audit', async () => {
      const x = await seedBaseContract(30, 'CLOSED_BAD_DEBT');
      await seedDeviceReturnPair(x);
      const requestId = randomUUID();

      const result = await settlementService.settleDeductionCash(
        x,
        'DEVICE_RETURN',
        { amount: 7000, financeDepositAccountCode: '11-1201', requestId },
        adminId,
      );
      expect(result.deduped).toBe(false);

      const financeJe = await prisma.journalEntry.findFirstOrThrow({
        where: { entryNumber: result.financeEntryNo },
        include: { lines: true },
      });
      expect(sumSide(financeJe.lines, '11-1201', 'dr').toFixed(2)).toBe('7000.00');
      expect(sumSide(financeJe.lines, '11-2107', 'cr').toFixed(2)).toBe('7000.00');
      expect(financeJe.lines).toHaveLength(2);
      expect(financeJe.companyId).toBe(financeId);
      expect(financeJe.description).toContain('ค่าเครื่องคืน');
      const finMeta = financeJe.metadata as Record<string, unknown>;
      expect(finMeta.flow).toBe('shop-collect-settlement');
      expect(finMeta.shopReceivableType).toBe('DEVICE_RETURN');
      expect(finMeta.contractId).toBe(x);

      const shopJe = await prisma.journalEntry.findFirstOrThrow({
        where: { entryNumber: result.shopEntryNo },
        include: { lines: true },
      });
      expect(sumSide(shopJe.lines, 'S21-1104', 'dr').toFixed(2)).toBe('7000.00');
      expect(sumSide(shopJe.lines, 'S11-1202', 'cr').toFixed(2)).toBe('7000.00'); // default SHOP_PAYING_BANK
      expect(shopJe.lines).toHaveLength(2);
      expect(shopJe.companyId).toBe(shopId);
      const shopMeta = shopJe.metadata as Record<string, unknown>;
      expect(shopMeta.flow).toBe('interco-device-return-cash-shop');
      expect(shopMeta.idempotencyKey).toBe(`${x}:${requestId}:SHOP`);
      expect(shopMeta.shopReceivableType).toBe('DEVICE_RETURN');
      expect(shopMeta.contractId).toBe(x);
      expect(shopJe.lines.find((l) => l.accountCode === 'S21-1104')!.description).toBe(
        `ล้างเจ้าหนี้ FINANCE-ค่าเครื่องคืน DRTEST-${RUN}-30`,
      );

      // typed lens: ใบ settle stamp DEVICE_RETURN + contractId → หักใน typed ตรงๆ → 0 ทั้งสองสมุด
      expect((await deviceReturnFinanceBalance(prisma, x)).toFixed(2)).toBe('0.00');
      expect((await deviceReturnShopBalance(prisma, x)).toFixed(2)).toBe('0.00');
      expect((await pendingService.getPendingDeviceReturns()).some((r) => r.contractId === x)).toBe(
        false,
      );
      expect((await glContractBalance(prisma, x, '11-2107', 'dr')).toFixed(2)).toBe('0.00');
      expect((await glContractBalance(prisma, x, 'S21-1104', 'cr')).toFixed(2)).toBe('0.00');
      // explicit stamp ชนะ flow fallback 'shop-collect-settlement' — ไม่รั่วเข้าเลนส์ SHOP_COLLECT
      expect((await shopCollectTypedBalance(prisma, x)).toFixed(2)).toBe('0.00');

      const audit = await prisma.auditLog.findFirst({
        where: { action: 'INTERCO_DEVICE_RETURN_CASH_SETTLED', entityId: x },
      });
      expect(audit).toBeTruthy();
      const nv = audit!.newValue as Record<string, unknown>;
      expect(nv.amount).toBe('7000.00');
      expect(nv.deviceReturnNetBefore).toBe('7000.00');
      expect(nv.shopPayoutAccountCode).toBe('S11-1202');
      expect(nv.requestId).toBe(requestId);
      const retry = await settlementService.settleDeductionCash(
        x,
        'DEVICE_RETURN',
        { amount: 7000, financeDepositAccountCode: '11-1201', requestId },
        adminId,
      );
      expect(retry).toEqual({ ...result, deduped: true });
      expect(
        await prisma.auditLog.count({
          where: { action: 'INTERCO_DEVICE_RETURN_CASH_SETTLED', entityId: x },
        }),
      ).toBe(1);
    }, 120_000);

    it('settle เกิน net → reject; บางส่วน 3,000 → ผ่าน + คิวเหลือ 4,000 ทั้งสองสมุด; retry requestId เดิม → deduped; ยอดต่าง → 409', async () => {
      const x = await seedBaseContract(31, 'CLOSED_BAD_DEBT');
      await seedDeviceReturnPair(x);

      await expect(
        settlementService.settleDeductionCash(
          x,
          'DEVICE_RETURN',
          { amount: 7000.02, financeDepositAccountCode: '11-1201', requestId: randomUUID() },
          adminId,
        ),
      ).rejects.toThrow(/เกินยอดค่าเครื่องคืนคงเหลือ/);

      const requestId = randomUUID();
      const partial = await settlementService.settleDeductionCash(
        x,
        'DEVICE_RETURN',
        { amount: 3000, financeDepositAccountCode: '11-1201', requestId },
        adminId,
      );
      expect(partial.deduped).toBe(false);
      const row = (await pendingService.getPendingDeviceReturns()).find((r) => r.contractId === x)!;
      expect(row.deviceReturnGl.toFixed(2)).toBe('4000.00');
      expect(row.shopDeviceReturnGl.toFixed(2)).toBe('4000.00');
      // A FINANCE-only receipt with this requestId must never gain a lone SHOP cash leg.
      const foreignRequest = randomUUID();
      await journalAuto.createAndPost({
        description: 'Existing receipt request marker',
        companyId: financeId,
        metadata: {
          flow: 'shop-collect-settlement',
          idempotencyKey: `${x}:${foreignRequest}`,
          contractId: x,
          requestId: foreignRequest,
          amount: '100.00',
          shopReceivableType: 'SHOP_COLLECT',
        },
        lines: [
          { accountCode: '11-1201', dr: dec('100'), cr: zero },
          { accountCode: '21-1103', dr: zero, cr: dec('100') },
        ],
      });
      await expect(
        settlementService.settleDeductionCash(
          x,
          'DEVICE_RETURN',
          { amount: 100, financeDepositAccountCode: '11-1201', requestId: foreignRequest },
          adminId,
        ),
      ).rejects.toThrow(ConflictException);
      expect(
        await prisma.journalEntry.count({
          where: { metadata: { path: ['requestId'], equals: foreignRequest } },
        }),
      ).toBe(1);
      // A valid FINANCE post followed by a failed SHOP post must roll back both books.
      const failedRequest = randomUUID();
      await expect(
        settlementService.settleDeductionCash(
          x,
          'DEVICE_RETURN',
          {
            amount: 100,
            financeDepositAccountCode: '11-1201',
            shopPayoutAccountCode: 'S-NOT-AN-ACCOUNT',
            requestId: failedRequest,
          },
          adminId,
        ),
      ).rejects.toThrow();
      expect(
        await prisma.journalEntry.count({
          where: { metadata: { path: ['requestId'], equals: failedRequest } },
        }),
      ).toBe(0);
      expect((await deviceReturnFinanceBalance(prisma, x)).toFixed(2)).toBe('4000.00');
      expect((await deviceReturnShopBalance(prisma, x)).toFixed(2)).toBe('4000.00');

      const again = await settlementService.settleDeductionCash(
        x,
        'DEVICE_RETURN',
        { amount: 3000, financeDepositAccountCode: '11-1201', requestId },
        adminId,
      );
      expect(again.deduped).toBe(true);
      expect(again.shopEntryNo).toBe(partial.shopEntryNo);

      await expect(
        settlementService.settleDeductionCash(
          x,
          'DEVICE_RETURN',
          { amount: 1000, financeDepositAccountCode: '11-1201', requestId },
          adminId,
        ),
      ).rejects.toThrow(ConflictException);
    }, 120_000);

    it('มี DEVICE_RETURN item ใน batch เปิด (PENDING/DRAFT) → reject ชี้รอบ; ยกเลิกรอบแล้ว settle ผ่าน (เลือกบัญชี S11-1101 ได้)', async () => {
      const y = await seedBaseContract(32);
      await seedNormalContract(y);
      const x = await seedBaseContract(33, 'CLOSED_BAD_DEBT');
      await seedDeviceReturnPair(x);

      const batch = await settlementService.createBatch(
        { contractIds: [y], deviceReturnContractIds: [x], transferDate: '2026-09-20' },
        adminId,
      );
      createdBatchIds.push(batch.id);
      await settlementService.submitBatch(batch.id, adminId);
      await expect(
        settlementService.settleDeductionCash(
          x,
          'DEVICE_RETURN',
          { amount: 7000, financeDepositAccountCode: '11-1201', requestId: randomUUID() },
          adminId,
        ),
      ).rejects.toThrow(/รายการค่าเครื่องคืนในรอบจ่าย/);

      await settlementService.withdrawBatch(batch.id, adminId); // DRAFT ก็ block
      await expect(
        settlementService.settleDeductionCash(
          x,
          'DEVICE_RETURN',
          { amount: 7000, financeDepositAccountCode: '11-1201', requestId: randomUUID() },
          adminId,
        ),
      ).rejects.toThrow(/รายการค่าเครื่องคืนในรอบจ่าย/);

      await settlementService.cancelBatch(batch.id, adminId);
      const result = await settlementService.settleDeductionCash(
        x,
        'DEVICE_RETURN',
        {
          amount: 7000,
          financeDepositAccountCode: '11-1201',
          shopPayoutAccountCode: 'S11-1101',
          requestId: randomUUID(),
        },
        adminId,
      );
      const shopJe = await prisma.journalEntry.findFirstOrThrow({
        where: { entryNumber: result.shopEntryNo },
        include: { lines: true },
      });
      expect(sumSide(shopJe.lines, 'S11-1101', 'cr').toFixed(2)).toBe('7000.00');
    }, 120_000);

    it('สองสมุดไม่ตรง / ไม่อยู่ในคิว → reject (ห้ามโพสต์ข้างเดียว)', async () => {
      const mismatch = await seedBaseContract(34, 'CLOSED_BAD_DEBT');
      await seedDeviceReturnPair(mismatch, { shopAmount: '6000.00' });
      await expect(
        settlementService.settleDeductionCash(
          mismatch,
          'DEVICE_RETURN',
          { amount: 6000, financeDepositAccountCode: '11-1201', requestId: randomUUID() },
          adminId,
        ),
      ).rejects.toThrow(/ยอดค่าเครื่องคืนสองสมุดไม่ตรงกัน/);

      await expect(
        settlementService.settleDeductionCash(
          normalId,
          'DEVICE_RETURN',
          { amount: 100, financeDepositAccountCode: '11-1201', requestId: randomUUID() },
          adminId,
        ),
      ).rejects.toThrow(/ไม่อยู่ในคิวค่าเครื่องคืน/);
    }, 120_000);

    it('กติกาที่ตัดสิน (same-type NET): swap ที่ถูกหักเครดิต 8,000 แล้วถูกยึด → รับเงินสดค่าเครื่องคืน 7,000 ผ่านทั้ง cap ของคิวและด่าน untyped ของ template', async () => {
      const swap = await seedBaseContract(36);
      await seedSwapContract(swap);
      const b1 = await settlementService.createBatch(
        { contractIds: [swap], transferDate: '2026-09-20' },
        adminId,
      );
      createdBatchIds.push(b1.id);
      await settlementService.submitBatch(b1.id, adminId);
      await settlementService.approveBatch(b1.id, adminId);
      await prisma.contract.update({ where: { id: swap }, data: { status: 'CLOSED_BAD_DEBT' } });
      await seedDeviceReturnPair(swap);

      // cap = net จากคิว (same-type) = 7,000; template gate (ii) untyped ระดับสัญญา:
      // 8,000 (A.3) + 7,000 (JP5) − Σ POSTED ทุกประเภท 8,000 = 7,000 → settle 7,000 พอดี
      const result = await settlementService.settleDeductionCash(
        swap,
        'DEVICE_RETURN',
        { amount: 7000, financeDepositAccountCode: '11-1201', requestId: randomUUID() },
        adminId,
      );
      expect(result.deduped).toBe(false);
      expect((await deviceReturnFinanceBalance(prisma, swap)).toFixed(2)).toBe('0.00');
      expect((await deviceReturnShopBalance(prisma, swap)).toFixed(2)).toBe('0.00');
      expect((await swapCreditFinanceBalance(prisma, swap)).toFixed(2)).toBe('8000.00'); // เลนส์ gross ไม่ขยับ
      expect(
        (await pendingService.getPendingDeviceReturns()).some((r) => r.contractId === swap),
      ).toBe(false);
      // untyped ต่อสัญญาหลัง settle = 15,000 − 7,000 = 8,000 = เครดิตสวอปที่รอบ b1 หักไปแล้ว
      // (ขา Cr ของ batch ไม่ stamp contractId — สถาปัตยกรรมเดิม)
      expect((await glContractBalance(prisma, swap, '11-2107', 'dr')).toFixed(2)).toBe('8000.00');
      // รายงานอายุ (combined): 8,000 + 0 − 8,000 = 0 — ไม่มีหนี้ค้าง ไม่ mismatch
      const agingRow = (await agingService.getShopReceivableAging()).rows.find(
        (r) => r.contractId === swap,
      );
      expect(agingRow).toBeUndefined(); // intercoNet 0 + ไม่ mismatch ⇒ ไม่ใช่ "หนี้ที่ต้องไปตาม"
    }, 180_000);

    it('wrapper settleRecallCash ยัง byte-identical: flow interco-recall-cash-shop, Cr S11-1201 default, audit INTERCO_RECALL_CASH_SETTLED', async () => {
      const r = await seedBaseContract(35);
      await seedRecallContract(r);
      const result = await settlementService.settleRecallCash(
        r,
        { amount: 11000, financeDepositAccountCode: '11-1201', requestId: randomUUID() },
        adminId,
      );
      const shopJe = await prisma.journalEntry.findFirstOrThrow({
        where: { entryNumber: result.shopEntryNo },
        include: { lines: true },
      });
      expect((shopJe.metadata as Record<string, unknown>).flow).toBe('interco-recall-cash-shop');
      expect((shopJe.metadata as Record<string, unknown>).shopReceivableType).toBe('PAYOUT_RECALL');
      expect(sumSide(shopJe.lines, 'S11-1201', 'cr').toFixed(2)).toBe('11000.00');
      expect(shopJe.lines.find((l) => l.accountCode === 'S21-1104')!.description).toBe(
        `ล้างเจ้าหนี้ FINANCE-เรียกคืนยกเลิก DRTEST-${RUN}-35`,
      );
      const audit = await prisma.auditLog.findFirst({
        where: { action: 'INTERCO_RECALL_CASH_SETTLED', entityId: r },
      });
      expect((audit!.newValue as Record<string, unknown>).recallNetBefore).toBe('11000.00');
      expect((await recallFinanceBalance(prisma, r)).toFixed(2)).toBe('0.00');
    }, 120_000);
  });
});

/** สัญญายกเลิก C-2 (shape ตาม netting spec) — regression ว่า settleRecallCash ยัง byte-identical */
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
      { accountCode: '21-1103', dr: zero, cr: dec('11000') },
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
      { accountCode: 'S21-1104', dr: zero, cr: dec('11000') },
      { accountCode: 'S11-1201', dr: dec('11000'), cr: zero },
    ],
  });
}
