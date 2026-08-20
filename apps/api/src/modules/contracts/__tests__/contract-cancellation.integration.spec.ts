/**
 * Phase 3 Task 2 — Generic cancellation C-1: guards + sweep + ECL release + restore
 * (workbook 2026-08-19, spec §6 Flow C-1).
 *
 * Runner: vitest (DB-backed — jest ignores *.integration.spec.ts via
 * testPathIgnorePatterns). Run:
 *   cd apps/api && npx vitest run --no-file-parallelism \
 *     src/modules/contracts/__tests__/contract-cancellation.integration.spec.ts
 *
 * Setup pattern follows interco-netting.integration.spec.ts: real PrismaClient
 * (no Nest DI), synthetic JEs through JournalAutoService.createAndPost with
 * metadata shaped exactly like the real producers, prefix CANCELTEST- +
 * unique-per-run suffix, scoped cleanup (JournalPostAuditLog before
 * JournalEntry; ContractCancellation before JournalEntry — FK
 * reversalJournalEntryId).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { seedFinanceCoa } from '../../../../prisma/seed-coa-finance';
import { seedShopCoa } from '../../../../prisma/seed-coa-shop';
import { JournalAutoService } from '../../journal/journal-auto.service';
import { ExchangeCancelReversalTemplate } from '../../journal/cpa-templates/exchange-cancel-reversal.template';
import { EclStageReverseTemplate } from '../../journal/cpa-templates/ecl-stage-reverse.template';
import { ContractCancellationTemplate } from '../../journal/cpa-templates/contract-cancellation.template';
import { CompanyResolverService } from '../../journal/company-resolver.service';
import { ContractCancellationService } from '../services/contract-cancellation.service';
import { glContractBalance } from '../../journal/gl-contract-balance';

const prisma = new PrismaClient();

// ---------------------------------------------------------------------------
// Service wiring (real instances, no Nest DI)
// ---------------------------------------------------------------------------
const journalAuto = new JournalAutoService(prisma as never);
const sweepTemplate = new ExchangeCancelReversalTemplate(journalAuto, prisma as never);
const eclStageReverse = new EclStageReverseTemplate(journalAuto, prisma as never);
const template = new ContractCancellationTemplate(prisma as never, sweepTemplate, eclStageReverse);
const companyResolver = new CompanyResolverService(prisma as never);
const service = new ContractCancellationService(
  prisma as never,
  () => template,
  () => companyResolver,
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

async function ensureCompany(code: 'SHOP' | 'FINANCE'): Promise<string> {
  const existing = await prisma.companyInfo.findFirst({
    where: { companyCode: code, deletedAt: null },
  });
  if (existing) return existing.id;
  const created = await prisma.companyInfo.create({
    data: {
      nameTh: code === 'SHOP' ? 'BESTCHOICE SHOP' : 'BESTCHOICE FINANCE',
      taxId: code === 'SHOP' ? '0000000000001' : '0000000000002',
      companyCode: code,
      address: '1 Test Rd.',
      directorName: 'Test Director',
      vatRegistered: code === 'FINANCE',
      vatRate: new Decimal('0.0700'),
    },
  });
  return created.id;
}

/** Customer + product + ACTIVE contract row — prefix CANCELTEST- for cleanup. */
async function seedBaseContract(seq: number): Promise<{ contractId: string; productId: string }> {
  const tag = `${RUN}-${seq}`;
  const customer = await prisma.customer.create({
    data: {
      name: `__CANCELTEST_${tag}__`,
      phone: `096${RUN_NUM}${seq}`,
      nationalId: `CANCELTEST-${tag}`,
    },
  });
  createdCustomerIds.push(customer.id);

  const product = await prisma.product.create({
    data: {
      name: `Cancel Test Phone ${tag}`,
      brand: 'CancelTestBrand',
      model: `CancelModel-${tag}`,
      storage: '128GB',
      imeiSerial: `CANCELTEST-${tag}`,
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
      contractNumber: `CANCELTEST-${tag}`,
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
  return { contractId: contract.id, productId: product.id };
}

/** 1A synthetic — 17,000 gross shape (tag '1A' + metadata.contractId). */
async function seed1a(id: string) {
  await journalAuto.createAndPost({
    description: '1A synthetic (CANCELTEST)',
    companyId: financeId,
    metadata: { flow: 'test-1a', idempotencyKey: `ct1a:${id}`, contractId: id, tag: '1A' },
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

/** SHOP legs synthetic — inventory-transfer shape (2 JEs: COGS + revenue/receivable). */
async function seedShopLegs(id: string) {
  await journalAuto.createAndPost({
    description: 'SHOP COGS synthetic (CANCELTEST)',
    companyId: shopId,
    metadata: { flow: 'test-shop-cogs', idempotencyKey: `ctcogs:${id}`, contractId: id },
    lines: [
      { accountCode: 'S50-1101', dr: dec('6000'), cr: zero },
      { accountCode: 'S11-2001', dr: zero, cr: dec('6000') },
    ],
  });
  await journalAuto.createAndPost({
    description: 'SHOP revenue synthetic (CANCELTEST)',
    companyId: shopId,
    metadata: { flow: 'test-shop-revenue', idempotencyKey: `ctrev:${id}`, contractId: id },
    lines: [
      { accountCode: 'S11-3001', dr: dec('10000'), cr: zero },
      { accountCode: 'S11-3002', dr: dec('1000'), cr: zero },
      { accountCode: 'S41-1101', dr: zero, cr: dec('10000') },
      { accountCode: 'S41-1201', dr: zero, cr: dec('1000') },
    ],
  });
}

/** Down-payment synthetic — same shape/stamp as ShopDownPaymentTemplate (Dr cash / Cr S21-2001). */
async function seedDownPayment(id: string) {
  await journalAuto.createAndPost({
    description: 'down payment synthetic (CANCELTEST)',
    companyId: shopId,
    metadata: {
      flow: 'shop-down-payment',
      idempotencyKey: `ctdown:${id}`,
      contractId: id,
      tag: 'SHOP_DOWN_PAYMENT',
    },
    lines: [
      { accountCode: 'S11-1101', dr: dec('2000'), cr: zero },
      { accountCode: 'S21-2001', dr: zero, cr: dec('2000') },
    ],
  });
}

/** 2A accrual synthetic — 1 installment of the 17,000/12 shape. */
async function seed2a(id: string) {
  await journalAuto.createAndPost({
    description: '2A synthetic (CANCELTEST)',
    companyId: financeId,
    metadata: { flow: 'test-2a', idempotencyKey: `ct2a:${id}`, contractId: id, tag: '2A' },
    lines: [
      { accountCode: '11-2103', dr: dec('1515.83'), cr: zero },
      { accountCode: '21-2102', dr: dec('99.17'), cr: zero },
      { accountCode: '11-2106', dr: dec('500.00'), cr: zero },
      { accountCode: '11-2101', dr: zero, cr: dec('1416.66') },
      { accountCode: '11-2105', dr: zero, cr: dec('99.17') },
      { accountCode: '41-1101', dr: zero, cr: dec('500.00') },
      { accountCode: '21-2101', dr: zero, cr: dec('99.17') },
    ],
  });
}

/** Provision JE (flow='provision') + ACTIVE BadDebtProvision row. */
async function seedProvision(id: string): Promise<string> {
  const je = await journalAuto.createAndPost({
    description: 'ECL provision synthetic (CANCELTEST)',
    companyId: financeId,
    metadata: { flow: 'provision', idempotencyKey: `ctprov:${id}`, contractId: id },
    lines: [
      { accountCode: '51-1103', dr: dec('30.32'), cr: zero },
      { accountCode: '11-2102', dr: zero, cr: dec('30.32') },
    ],
  });
  await prisma.badDebtProvision.create({
    data: {
      contractId: id,
      provisionDate: new Date(),
      agingBucket: '1-30',
      daysOverdue: 10,
      outstandingAmount: dec('1515.83'),
      provisionRate: dec('0.02'),
      provisionAmount: dec('30.32'),
      status: 'ACTIVE',
    },
  });
  return je.id;
}

/** Pending payment + installment schedule rows (soft-delete assertion targets). */
async function seedScheduleRows(id: string) {
  await prisma.payment.create({
    data: {
      contractId: id,
      installmentNo: 1,
      dueDate: new Date('2026-08-01'),
      amountDue: dec('1515.83'),
      amountPaid: dec('0'),
      status: 'PENDING',
    },
  });
  await prisma.installmentSchedule.create({
    data: {
      contractId: id,
      installmentNo: 1,
      dueDate: new Date('2026-08-01'),
      principal: dec('1416.66'),
      interest: dec('500.00'),
      amountDue: dec('1515.83'),
    },
  });
}

/** Net Σ(Dr−Cr) for one account scoped to metadata.contractId (POSTED only). */
async function net(contractId: string, code: string): Promise<string> {
  return (await glContractBalance(prisma, contractId, code, 'dr')).toFixed(2);
}

async function requestAndApprove(contractId: string, refund = 0) {
  const cancellation = await service.requestCancellation(
    contractId,
    adminId,
    'ทดสอบยกเลิก C-1',
    refund,
  );
  return service.approveCancellation(cancellation.id, adminId);
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('Contract cancellation C-1 — guards + sweep + ECL + restore (real DB)', () => {
  beforeAll(async () => {
    await seedFinanceCoa(prisma);
    await seedShopCoa(prisma);

    shopId = await ensureCompany('SHOP');
    financeId = await ensureCompany('FINANCE');

    let admin = await prisma.user.findFirst({ where: { email: 'admin@bestchoice.com' } });
    if (!admin) {
      admin = await prisma.user.create({
        data: { email: 'admin@bestchoice.com', password: 'x', name: 'admin', role: 'OWNER' },
      });
    }
    adminId = admin.id;

    const existingBranch = await prisma.branch.findFirst({
      where: { name: '__cancel_test_branch__', deletedAt: null },
    });
    if (existingBranch) {
      branchId = existingBranch.id;
    } else {
      const branch = await prisma.branch.create({
        data: { name: '__cancel_test_branch__', companyId: shopId },
      });
      branchId = branch.id;
      createdBranchId = branch.id;
    }
  }, 120_000);

  afterAll(async () => {
    const jeIds = new Set<string>();
    for (const cid of createdContractIds) {
      const rows = await prisma.journalEntry.findMany({
        where: { metadata: { path: ['contractId'], equals: cid } as never },
        select: { id: true },
      });
      rows.forEach((r) => jeIds.add(r.id));
    }
    const jeIdList = [...jeIds];

    // FK order: JournalPostAuditLog + ContractCancellation reference journal_entries.
    await prisma.journalPostAuditLog.deleteMany({ where: { journalEntryId: { in: jeIdList } } });
    await prisma.contractCancellation.deleteMany({
      where: { contractId: { in: createdContractIds } },
    });
    await prisma.journalLine.deleteMany({ where: { journalEntryId: { in: jeIdList } } });
    await prisma.journalEntry.deleteMany({ where: { id: { in: jeIdList } } });

    await prisma.badDebtProvision.deleteMany({ where: { contractId: { in: createdContractIds } } });
    await prisma.payment.deleteMany({ where: { contractId: { in: createdContractIds } } });
    await prisma.installmentSchedule.deleteMany({
      where: { contractId: { in: createdContractIds } },
    });
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
  it('C-1: ยกเลิกก่อนตัดจ่าย → GL net 0 ทุกบัญชี + สัญญา CANCELED + product กลับ SHOP stock', async () => {
    const { contractId, productId } = await seedBaseContract(1);
    await seed1a(contractId);
    await seedDownPayment(contractId);
    await seedShopLegs(contractId);
    await seed2a(contractId);
    const provisionJeId = await seedProvision(contractId);
    await seedScheduleRows(contractId);

    const result = await requestAndApprove(contractId);
    expect(result.status).toBe('APPROVED');
    expect(result.reversalEntryNumber).toBeTruthy();

    // ทุกบัญชีของสัญญา net 0 — FINANCE + SHOP (glContractBalance keys by
    // metadata.contractId; the sweep mirrors carry it + companyId)
    for (const code of [
      '11-2101',
      '11-2103',
      '11-2105',
      '11-2106',
      '21-1101',
      '21-1102',
      '21-2101',
      '21-2102',
      '41-1101',
      'S11-3001',
      'S11-3002',
      'S41-1101',
      'S41-1201',
      'S50-1101',
      'S11-2001',
    ]) {
      expect(await net(contractId, code), `account ${code} must net 0`).toBe('0.00');
    }

    // 11-2102 = 0 ผ่าน "release ใบเดียว" (flow='stage-reverse' ใบใหม่ 1 ใบ)
    expect(await net(contractId, '11-2102')).toBe('0.00');
    const stageReverses = await prisma.journalEntry.findMany({
      where: {
        AND: [
          { metadata: { path: ['flow'], equals: 'stage-reverse' } } as never,
          { metadata: { path: ['contractId'], equals: contractId } } as never,
        ],
        deletedAt: null,
      },
      include: { lines: true },
    });
    expect(stageReverses.length).toBe(1);
    const releaseDr = stageReverses[0].lines.find((l) => l.accountCode === '11-2102');
    expect(new Decimal(releaseDr!.debit.toString()).toFixed(2)).toBe('30.32');

    // Fix Round 1 (Critical #1/#2): down JE (Dr cash / Cr S21-2001) ถูก exclude —
    // เงินสด SHOP ต้องไม่ถูกแตะ และ S21-2001 ค้างเป็น Cr downAmount โดยตั้งใจ
    // (เจ้าหนี้เงินดาวน์รอ SHOP จ่ายคืนลูกค้าจริง — ไม่ mirror เป็นเงินสดปลอม)
    expect((await glContractBalance(prisma, contractId, 'S21-2001', 'cr')).toFixed(2)).toBe(
      '2000.00',
    );
    expect((await glContractBalance(prisma, contractId, 'S11-1101', 'dr')).toFixed(2)).toBe(
      '2000.00', // เฉพาะขา Dr ของใบดาวน์เดิม — ไม่มี mirror line ใหม่แตะเงินสด
    );
    const downJe = await prisma.journalEntry.findFirstOrThrow({
      where: {
        AND: [
          { metadata: { path: ['flow'], equals: 'shop-down-payment' } } as never,
          { metadata: { path: ['contractId'], equals: contractId } } as never,
        ],
      },
    });
    expect(((downJe.metadata ?? {}) as Record<string, unknown>).reversed).toBeUndefined();
    const mirrorOfDown = await prisma.journalEntry.findFirst({
      where: { metadata: { path: ['reversesEntryId'], equals: downJe.id } as never },
    });
    expect(mirrorOfDown).toBeNull();

    // JE provision เดิมไม่ถูก mirror (excludeFlows) — ไม่มี stamp reversed และ
    // ไม่มี reversal JE ที่ชี้กลับมา
    const provisionJe = await prisma.journalEntry.findUniqueOrThrow({
      where: { id: provisionJeId },
    });
    expect(((provisionJe.metadata ?? {}) as Record<string, unknown>).reversed).toBeUndefined();
    const mirrorOfProvision = await prisma.journalEntry.findFirst({
      where: { metadata: { path: ['reversesEntryId'], equals: provisionJeId } as never },
    });
    expect(mirrorOfProvision).toBeNull();

    // BadDebtProvision rows → REVERSED
    const activeProvisions = await prisma.badDebtProvision.count({
      where: { contractId, status: 'ACTIVE', deletedAt: null },
    });
    expect(activeProvisions).toBe(0);
    const reversedProvisions = await prisma.badDebtProvision.count({
      where: { contractId, status: 'REVERSED', deletedAt: null },
    });
    expect(reversedProvisions).toBe(1);

    // Contract + product restore
    const contract = await prisma.contract.findUniqueOrThrow({ where: { id: contractId } });
    expect(contract.status).toBe('CANCELED');
    const product = await prisma.product.findUniqueOrThrow({ where: { id: productId } });
    expect(product.status).toBe('IN_STOCK');
    expect((product as { ownedByCompanyId?: string | null }).ownedByCompanyId).toBe(shopId);

    // payments + installmentSchedules soft-deleted
    expect(await prisma.payment.count({ where: { contractId, deletedAt: null } })).toBe(0);
    expect(await prisma.installmentSchedule.count({ where: { contractId, deletedAt: null } })).toBe(
      0,
    );

    // Cancellation row APPROVED + FK to first reversal JE
    const cancellationRow = await prisma.contractCancellation.findFirstOrThrow({
      where: { contractId },
    });
    expect(cancellationRow.status).toBe('APPROVED');
    expect(cancellationRow.reversalJournalEntryId).toBeTruthy();

    // Audit: reversalCount ทั้งชุด (1A + SHOP COGS + SHOP revenue + 2A = 4 ใบ)
    const audit = await prisma.auditLog.findFirst({
      where: { action: 'CONTRACT_CANCELED', entityId: contractId },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit).toBeTruthy();
    const newValue = audit!.newValue as Record<string, unknown>;
    expect(newValue.reversalCount).toBe(4);
    expect(newValue.reversalEntryNumber).toBe(result.reversalEntryNumber);
  }, 60_000);

  // -------------------------------------------------------------------------
  it('guard: มี Payment PAID ไม่ void → reject ข้อความ void ก่อน', async () => {
    const { contractId } = await seedBaseContract(2);
    await prisma.payment.create({
      data: {
        contractId,
        installmentNo: 1,
        dueDate: new Date('2026-08-01'),
        amountDue: dec('1515.83'),
        amountPaid: dec('1515.83'),
        status: 'PAID',
      },
    });

    await expect(requestAndApprove(contractId)).rejects.toThrow('void ใบเสร็จทั้งหมดก่อนยกเลิก');

    // Nothing changed: contract still ACTIVE, cancellation still PENDING
    const contract = await prisma.contract.findUniqueOrThrow({ where: { id: contractId } });
    expect(contract.status).toBe('ACTIVE');
    const cancellation = await prisma.contractCancellation.findFirstOrThrow({
      where: { contractId },
    });
    expect(cancellation.status).toBe('PENDING');
  }, 30_000);

  // -------------------------------------------------------------------------
  it('guard: สัญญาอยู่ใน batch DRAFT/PENDING_APPROVAL → reject บอกให้ถอนรอบก่อน', async () => {
    const { contractId } = await seedBaseContract(3);
    const batch = await prisma.interCoSettlementBatch.create({
      data: {
        batchNumber: `IC-CANCELTEST-${RUN}`,
        status: 'DRAFT',
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
    await prisma.interCoSettlementItem.create({
      data: {
        batchId: batch.id,
        contractId,
        financedGl: dec('10000.00'),
        commissionGl: dec('1000.00'),
        shopFinancedGl: dec('10000.00'),
        shopCommissionGl: dec('1000.00'),
      },
    });

    const err = await requestAndApprove(contractId).then(
      () => null,
      (e: Error) => e,
    );
    expect(err).toBeTruthy();
    expect(err!.message).toContain(`IC-CANCELTEST-${RUN}`);
    expect(err!.message).toContain('ถอน/ยกเลิกรอบก่อน');
  }, 30_000);

  // -------------------------------------------------------------------------
  it('guard: refundAmount > 0 → reject (deprecated — เงินคืนลูกค้าอยู่ฝั่ง SHOP)', async () => {
    const { contractId } = await seedBaseContract(4);

    await expect(requestAndApprove(contractId, 500)).rejects.toThrow(
      'refundAmount ไม่รองรับแล้ว',
    );
  }, 30_000);

  // -------------------------------------------------------------------------
  it('guard: 11-2107 SHOP_COLLECT ของสัญญาค้าง → reject', async () => {
    const { contractId } = await seedBaseContract(5);
    await journalAuto.createAndPost({
      description: 'SHOP_COLLECT synthetic (CANCELTEST)',
      companyId: financeId,
      metadata: {
        flow: 'test-shop-collect',
        idempotencyKey: `ctsc:${contractId}`,
        contractId,
        shopReceivableType: 'SHOP_COLLECT',
      },
      lines: [
        { accountCode: '11-2107', dr: dec('500'), cr: zero },
        { accountCode: '21-1103', dr: zero, cr: dec('500') },
      ],
    });

    await expect(requestAndApprove(contractId)).rejects.toThrow('หน้าร้านรับแทน');
  }, 30_000);

  // -------------------------------------------------------------------------
  it('tripwire: JE เงินสดที่ไม่รู้จัก (hand-JV) → reject ดัง ระบุ entryNumber ไม่ยกเลิกเงียบๆ', async () => {
    const { contractId } = await seedBaseContract(7);
    await seed1a(contractId);
    // Hand-JV synthetic: แตะเงินสด FINANCE (11-1101) โดย flow ไม่อยู่ใน deny-list
    const handJv = await journalAuto.createAndPost({
      description: 'hand JV cash synthetic (CANCELTEST)',
      companyId: financeId,
      metadata: { flow: 'test-hand-jv', idempotencyKey: `ctjv:${contractId}`, contractId },
      lines: [
        { accountCode: '11-1101', dr: dec('300'), cr: zero },
        { accountCode: '41-1102', dr: zero, cr: dec('300') },
      ],
    });
    const jvEntryNumber = (
      await prisma.journalEntry.findUniqueOrThrow({ where: { id: handJv.id } })
    ).entryNumber;

    const err = await requestAndApprove(contractId).then(
      () => null,
      (e: Error) => e,
    );
    expect(err).toBeTruthy();
    expect(err!.message).toContain(jvEntryNumber);
    expect(err!.message).toContain('เงินสด');

    // ห้ามมีใบไหนถูก mirror เลย — tripwire ต้องยิงก่อน sweep เริ่ม
    const reversals = await prisma.journalEntry.count({
      where: {
        AND: [
          { metadata: { path: ['flow'], equals: 'contract-cancellation' } } as never,
          { metadata: { path: ['contractId'], equals: contractId } } as never,
        ],
      },
    });
    expect(reversals).toBe(0);
    const contract = await prisma.contract.findUniqueOrThrow({ where: { id: contractId } });
    expect(contract.status).toBe('ACTIVE');
  }, 30_000);

  // -------------------------------------------------------------------------
  it('guard: เงินรับล่วงหน้า/เครดิต/ถังพักปรับดิวค้าง → reject ทุกถัง', async () => {
    const { contractId } = await seedBaseContract(8);
    const cancellation = await service.requestCancellation(
      contractId,
      adminId,
      'ทดสอบ park guard',
      0,
    );
    const expectParkReject = async () => {
      await expect(service.approveCancellation(cancellation.id, adminId)).rejects.toThrow(
        'มีเงินรับล่วงหน้า/เครดิตค้างบนสัญญา',
      );
    };

    await prisma.contract.update({
      where: { id: contractId },
      data: { advanceBalance: dec('100.00') },
    });
    await expectParkReject();

    await prisma.contract.update({
      where: { id: contractId },
      data: { advanceBalance: dec('0'), rescheduleAdvanceBalance: dec('50.00') },
    });
    await expectParkReject();

    await prisma.contract.update({
      where: { id: contractId },
      data: { rescheduleAdvanceBalance: dec('0'), creditBalance: dec('25.00') },
    });
    await expectParkReject();
  }, 30_000);

  // -------------------------------------------------------------------------
  it('guard: สัญญาไม่ ACTIVE → reject บอกใช้เส้นทาง JP5', async () => {
    const { contractId } = await seedBaseContract(6);
    const cancellation = await service.requestCancellation(
      contractId,
      adminId,
      'ทดสอบยกเลิกสัญญาไม่ ACTIVE',
      0,
    );
    await prisma.contract.update({ where: { id: contractId }, data: { status: 'TERMINATED' } });

    await expect(service.approveCancellation(cancellation.id, adminId)).rejects.toThrow(
      'เฉพาะสัญญาสถานะ ACTIVE',
    );
  }, 30_000);
});
