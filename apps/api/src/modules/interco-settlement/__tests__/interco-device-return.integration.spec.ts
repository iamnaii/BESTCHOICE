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
import { IntercoAgingService } from '../interco-aging.service';

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
  }, 120_000);

  afterAll(async () => {
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
});
