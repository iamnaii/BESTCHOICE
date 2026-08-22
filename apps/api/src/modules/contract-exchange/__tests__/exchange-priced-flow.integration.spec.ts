import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Prisma, PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { seedFinanceCoa } from '../../../../prisma/seed-coa-finance';
import { seedShopCoa } from '../../../../prisma/seed-coa-shop';
import { ContractExchangeService } from '../contract-exchange.service';
import { ExchangeCancelService } from '../contract-exchange-cancel.service';
import { AuditService } from '../../audit/audit.service';
import { CompanyResolverService } from '../../journal/company-resolver.service';
import { JournalAutoService } from '../../journal/journal-auto.service';
import { glContractBalance } from '../../journal/gl-contract-balance';
import { ContractActivation1ATemplate } from '../../journal/cpa-templates/contract-activation-1a.template';
import { InstallmentAccrual2ATemplate } from '../../journal/cpa-templates/installment-accrual-2a.template';
import { ExchangeNewContract1ATemplate } from '../../journal/cpa-templates/exchange-new-contract-1a.template';
import { ExchangeCloseOld21_1106Template } from '../../journal/cpa-templates/exchange-close-old-21-1106.template';
import { ExchangeBuybackReceivable11_2107Template } from '../../journal/cpa-templates/exchange-buyback-receivable-11-2107.template';
import { ShopExchangeReturnTemplate } from '../../journal/cpa-templates/shop-exchange-return.template';
import { ExchangeEclReversalTemplate } from '../../journal/cpa-templates/exchange-ecl-reversal.template';
import { ExchangeCancelReversalTemplate } from '../../journal/cpa-templates/exchange-cancel-reversal.template';
import { ShopCollectSettlementTemplate } from '../../journal/cpa-templates/shop-collect-settlement.template';
import { InstallmentAccrualCron } from '../../journal/cron/installment-accrual.cron';
import { ShopInventoryTransferTemplate } from '../../journal/cpa-templates/shop-inventory-transfer.template';
import { ShopAccountResolver } from '../../journal/shop-account-resolver.service';
import { IntercoPendingService } from '../../interco-settlement/interco-pending.service';
import { PairedJournalService } from '../../journal/paired-journal.service';
import { IntercoBatchNumberService } from '../../interco-settlement/interco-batch-number.service';
import { IntercoSettlementService } from '../../interco-settlement/interco-settlement.service';
import {
  recallFinanceBalance,
  recallShopBalance,
  swapCreditFinanceBalance,
  swapCreditShopBalance,
} from '../../interco-settlement/interco-typed-balance';

/**
 * Device Swap priced flow — workbook E2E against a REAL database (Task 14).
 *
 * Runs the actual service/template chain (submit → approve → finalizeAfterActivation
 * → cancel / approveMemo) and asserts GL TRUTH, not workbook multiplication formulas:
 *
 *   1. Case 2A — old 10,000/12@0.05 contract with 4 REALLY-accrued-and-paid
 *      installments → finalize posts A.1-A.4; 21-1106 nets 0 across A.2/A.3
 *      (workbook CRITICAL CHECK); every old-contract receivable account nets 0;
 *      Cr 11-2101 = GL-true 11,333.36 (17,000 − 4×1,416.66), NOT the straight-line
 *      11,333.28 (1,416.66 × 8); loss plug 51-1102 = GL-derived 126.68
 *      (วิธีสุทธิ, workbook 2026-08-19 — A.2 no longer posts Cr 41-1101).
 *      A.3 (2026-08-03 owner order — SUPERSEDES D5 for this path) is now a
 *      2-line JE: Dr 11-2107 8,000 / Cr 21-1106 8,000 — NO cash leg, and
 *      21-1101/21-1102 are NOT cleared (they stay outstanding at 15,000 /
 *      1,500 for the normal "จ่ายให้หน้าร้าน" INTER-CO batch).
 *      Also asserts F2 (CPA ตอบข้อ 3, 2026-08-01): ShopInventoryTransferTemplate
 *      posts on the NEW contract too (S41-1101 15,000 / S41-1201 1,500 /
 *      S50-1101↔S11-2001 9,000) and its S11-3001/S11-3002 receivables now STAY
 *      outstanding too (the D5 instant-settlement leg was deleted 2026-08-03),
 *      with S11-1201 untouched. Consequence asserted explicitly: the contract
 *      DOES appear in the INTER-CO pending queue with legacyNoShop = false.
 *   2. ECL — provision 30.32 on the old contract → A.5 Dr 11-2102 / Cr 51-1103
 *      30.32 (CPA 2026-08-01: single-standard release account, was 42-1106),
 *      BadDebtProvision row REVERSED, GL 11-2102 = 0.
 *   3. Cancel day-15 / day-45 — owner removed the cancellation-fee rule +
 *      time windows entirely (2026-07-31): every JE mirror-reversed
 *      (per-account net 0 across originals + reversals), NO 42-1107 penalty
 *      JE ever posts, penaltyAmount stays null regardless of days elapsed,
 *      old contract restored to ACTIVE, and the 2A cron backfills a missed
 *      installment on the next tick (contract no longer EXCHANGED).
 *   4. MEMO — same model + price: zero new JEs, contract.productId swapped.
 *
 * Harness conventions follow the accounting *.integration.spec.ts suites
 * (real PrismaClient, seedFinanceCoa/seedShopCoa, admin@bestchoice.com system
 * user) — but cleanup here is SCOPED to rows this spec created (unscoped
 * deleteMany broke immutable-audit rows in a past wave), and
 * JournalPostAuditLog is cleared before journal entries (commit a48fe1fe).
 */

const prisma = new PrismaClient();

// ---------------------------------------------------------------------------
// Service wiring (real instances, no Nest DI)
// ---------------------------------------------------------------------------
const journal = new JournalAutoService(prisma as never);
const companyResolver = new CompanyResolverService(prisma as never);
const audit = new AuditService(prisma as never);
const act1a = new ContractActivation1ATemplate(journal, prisma as never);
const accrual2a = new InstallmentAccrual2ATemplate(journal, prisma as never);
const svc = new ContractExchangeService(
  prisma as never,
  audit,
  new ExchangeNewContract1ATemplate(journal, prisma as never),
  new ExchangeCloseOld21_1106Template(journal, prisma as never),
  new ExchangeBuybackReceivable11_2107Template(journal, prisma as never),
  new ShopExchangeReturnTemplate(journal, prisma as never, companyResolver),
  new ExchangeEclReversalTemplate(journal, prisma as never),
  companyResolver,
  new ShopInventoryTransferTemplate(journal, prisma as never, companyResolver),
  new ShopAccountResolver(prisma as never),
);
const cancelSvc = new ExchangeCancelService(
  prisma as never,
  audit,
  companyResolver,
  new ExchangeCancelReversalTemplate(journal, prisma as never),
);
const accrualCron = new InstallmentAccrualCron(prisma as never, accrual2a);
const intercoPending = new IntercoPendingService(prisma as never);
// Interco batch flow (Task 5 — C-2): REAL IntercoSettlementService so the batch
// POSTED state + JEs come from the production path (same wiring shape as
// contract-cancellation.integration.spec.ts; StorageService stubbed — uploadSlip unused).
const pairedJournal = new PairedJournalService(journal, prisma as never, companyResolver);
const batchNumberService = new IntercoBatchNumberService(prisma as never);
const storageStub = { upload: async () => undefined, delete: async () => undefined };
// settleRecallCash (Phase 3 Task 6) dep — unused by this suite.
const shopCollectTemplate = new ShopCollectSettlementTemplate(journal, prisma as never);
const settlementService = new IntercoSettlementService(
  prisma as never,
  intercoPending,
  batchNumberService,
  pairedJournal,
  companyResolver,
  journal,
  storageStub as never,
  shopCollectTemplate,
);

// ---------------------------------------------------------------------------
// Tracked rows for SCOPED cleanup
// ---------------------------------------------------------------------------
const createdContractIds: string[] = [];
const createdProductIds: string[] = [];
const createdCustomerIds: string[] = [];
const createdRequestIds: string[] = [];
const createdBatchIds: string[] = [];
let createdBranchId: string | null = null;

let adminId: string;
let shopCompanyId: string;
let financeCompanyId: string;
let branchId: string;

const DAY = 86_400_000;

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

interface SwapFixture {
  customerId: string;
  oldProductId: string;
  newProductId: string;
  oldContractId: string;
}

/**
 * Old contract = the standard 17K/12M loan math the CPA goldens use:
 *   financed 10,000 + commission 1,000 + interest 6,000 (0.05/mo × 12)
 *   grossExclVat 17,000, VAT 1,190, installmentTotal 1,515.83
 */
async function seedSwapFixture(
  tag: string,
  opts: { schedule?: 'PAST4_FUTURE8' | 'FUTURE12' | 'NONE'; memo?: boolean } = {},
): Promise<SwapFixture> {
  const customer = await prisma.customer.create({
    data: {
      name: `__EXCH_TEST_${tag}__`,
      phone: `0899${tag.padStart(6, '0')}`,
      nationalId: `EXCHTEST-${tag}`,
    },
  });
  createdCustomerIds.push(customer.id);

  const model = opts.memo ? 'MemoModel' : `PricedModel-${tag}`;
  const oldProduct = await prisma.product.create({
    data: {
      name: `Exch Test Old ${tag}`,
      brand: 'ExchTestBrand',
      model,
      storage: '128GB',
      imeiSerial: `EXCHTEST-${tag}-OLD`,
      category: 'PHONE_NEW',
      // 7,500 ≠ buyback 8,000 โดยตั้งใจ (Task 5) — ให้ assertion "cancel restore
      // costPrice" แยกแยะได้จริงระหว่างค่าเดิมกับค่าที่ A.4 เขียนทับ (ถ้าเท่ากัน
      // การ restore ที่พังก็ยัง pass แบบบังเอิญ). ไม่มี golden อื่นอ้างค่านี้:
      // สัญญาเก่า seed ตรงผ่าน prisma (ไม่ผ่าน activation → ไม่มี COGS/S50 JE)
      // และ A.4 รูปใหม่ book ที่ราคารับซื้อ ไม่ใช่ costPrice.
      costPrice: new Decimal('7500.00'),
      installmentPrice: new Decimal('12000.00'),
      branchId,
      status: 'SOLD_INSTALLMENT',
      ownedByCompanyId: financeCompanyId,
    },
  });
  createdProductIds.push(oldProduct.id);

  // MEMO mode requires same model AND newPrice === old contract sellingPrice
  const newProduct = await prisma.product.create({
    data: {
      name: `Exch Test New ${tag}`,
      brand: 'ExchTestBrand',
      model: opts.memo ? 'MemoModel' : `PricedModel-${tag}-NEW`,
      storage: '128GB',
      imeiSerial: `EXCHTEST-${tag}-NEW`,
      category: 'PHONE_NEW',
      costPrice: new Decimal(opts.memo ? '8000.00' : '9000.00'),
      installmentPrice: new Decimal(opts.memo ? '12000.00' : '15000.00'),
      branchId,
      status: 'IN_STOCK',
      ownedByCompanyId: shopCompanyId,
    },
  });
  createdProductIds.push(newProduct.id);

  const contract = await prisma.contract.create({
    data: {
      contractNumber: `EXCHTEST-${tag}-${Date.now()}`,
      customerId: customer.id,
      productId: oldProduct.id,
      branchId,
      salespersonId: adminId,
      planType: 'STORE_WITH_INTEREST',
      sellingPrice: new Decimal('12000.00'),
      downPayment: new Decimal('2000.00'),
      financedAmount: new Decimal('10000.00'),
      interestRate: new Decimal('0.0500'),
      totalMonths: 12,
      interestTotal: new Decimal('6000.00'),
      storeCommission: new Decimal('1000.00'),
      vatAmount: new Decimal('1190.00'),
      vatPct: new Decimal('0.0700'),
      monthlyPayment: new Decimal('1515.83'),
      status: 'ACTIVE',
    },
  });
  createdContractIds.push(contract.id);

  if (opts.schedule && opts.schedule !== 'NONE') {
    const now = Date.now();
    for (let i = 1; i <= 12; i++) {
      const dueDate =
        opts.schedule === 'PAST4_FUTURE8' && i <= 4
          ? new Date(now - (5 - i) * 30 * DAY) // -120d, -90d, -60d, -30d
          : new Date(now + i * 30 * DAY);
      await prisma.installmentSchedule.create({
        data: {
          contractId: contract.id,
          installmentNo: i,
          dueDate,
          principal: new Decimal('833.33'),
          interest: new Decimal('500.00'),
          amountDue: new Decimal('1515.83'),
        },
      });
    }
  }

  return {
    customerId: customer.id,
    oldProductId: oldProduct.id,
    newProductId: newProduct.id,
    oldContractId: contract.id,
  };
}

/**
 * Direct new-contract + APPROVED request seed (tests 2/3 — the full real
 * submit/approve path is exercised end-to-end in test 1; here the SEED is
 * simplified but finalize/cancel still run the REAL service code).
 * Default plan mirrors computeExchangePlan(15,000, 12, 0.05):
 *   financed 15,000 + commission 1,500 + interest 9,000, VAT 1,785, monthly 2,273.75
 * Optional `plan` override (Task 5 golden ใช้ 10,000/1,000/6,000/1,190/1,515.83 —
 * เจ้าหนี้ 11,000 ตรงเลขทอง Phase 2/3).
 */
async function seedNewContractAndRequest(
  fix: SwapFixture,
  tag: string,
  buyback: string,
  plan?: { financed: string; commission: string; interest: string; vat: string; monthly: string },
) {
  const p = plan ?? {
    financed: '15000.00',
    commission: '1500.00',
    interest: '9000.00',
    vat: '1785.00',
    monthly: '2273.75',
  };
  const newContract = await prisma.contract.create({
    data: {
      contractNumber: `EXCHTEST-NEW-${tag}-${Date.now()}`,
      customerId: fix.customerId,
      productId: fix.newProductId,
      branchId,
      salespersonId: adminId,
      planType: 'STORE_WITH_INTEREST',
      sellingPrice: new Decimal(p.financed),
      downPayment: new Decimal('0.00'),
      financedAmount: new Decimal(p.financed),
      interestRate: new Decimal('0.0500'),
      totalMonths: 12,
      interestTotal: new Decimal(p.interest),
      storeCommission: new Decimal(p.commission),
      vatAmount: new Decimal(p.vat),
      vatPct: new Decimal('0.0700'),
      monthlyPayment: new Decimal(p.monthly),
      status: 'ACTIVE',
      exchangedFromContractId: fix.oldContractId,
    },
  });
  createdContractIds.push(newContract.id);

  const request = await prisma.contractExchangeRequest.create({
    data: {
      oldContractId: fix.oldContractId,
      oldProductId: fix.oldProductId,
      newProductId: fix.newProductId,
      status: 'APPROVED',
      mode: 'PRICED',
      buybackPrice: new Decimal(buyback),
      deviceCondition: 'A',
      depositAccountCode: '11-1101',
      newTotalMonths: 12,
      newInterestRate: new Decimal('0.0500'),
      newMonthlyPayment: new Decimal(p.monthly),
      newInterestTotal: new Decimal(p.interest),
      newVatAmount: new Decimal(p.vat),
      newStoreCommission: new Decimal(p.commission),
      requestedById: adminId,
      approvedById: adminId,
      approvedAt: new Date(),
      newContractId: newContract.id,
    },
  });
  createdRequestIds.push(request.id);

  return { newContract, request };
}

/** Mirror ContractWorkflowService.activate's exchange branch: flip states + finalize in ONE tx. */
async function activateAndFinalize(newContractId: string, newProductId: string) {
  const newContract = await prisma.contract.findUniqueOrThrow({ where: { id: newContractId } });
  const newProduct = await prisma.product.findUniqueOrThrow({ where: { id: newProductId } });
  await prisma.$transaction(async (tx) => {
    await tx.contract.update({ where: { id: newContractId }, data: { status: 'ACTIVE' } });
    await tx.product.update({
      where: { id: newProductId },
      data: { status: 'SOLD_INSTALLMENT', ownedByCompanyId: financeCompanyId },
    });
    await svc.finalizeAfterActivation(
      {
        id: newContract.id,
        productId: newContract.productId,
        exchangedFromContractId: newContract.exchangedFromContractId as string,
        financedAmount: newContract.financedAmount,
        storeCommission: newContract.storeCommission,
        contractNumber: newContract.contractNumber,
        downPayment: newContract.downPayment,
        productCategory: newProduct.category,
        productCostPrice: newProduct.costPrice,
      },
      tx,
    );
  });
}

/** Post a 2B-shaped receipt sim: Dr cash / Cr 11-2103 for one full installment. */
async function postReceiptSim(contractId: string, installmentNo: number) {
  const zero = new Decimal(0);
  const amount = new Decimal('1515.83');
  await journal.createAndPost({
    description: `[integration-seed] receipt sim งวด #${installmentNo}`,
    metadata: { tag: '2B', flow: 'exchange-integration-receipt-sim', contractId, installmentNo },
    lines: [
      { accountCode: '11-1101', dr: amount, cr: zero, description: 'เงินสดรับชำระ' },
      { accountCode: '11-2103', dr: zero, cr: amount, description: 'ล้างลูกหนี้ค้างชำระ' },
    ],
  });
}

/**
 * Whole-account Σ(Dr−Cr) — NO metadata filter (same helper as the cancellation
 * spec). C-2 assertions use DELTAS of this: the batch JE deliberately carries
 * no metadata.contractId, so the per-contract lens cannot see "payable = 0
 * after settlement" — only the account-level balance can prove "= 0 ก่อน
 * cancel และไม่ติดลบหลัง redirect".
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
 * Look up the 2 JE ids F2 posts at finalize — ShopInventoryTransferTemplate's
 * COGS + revenue legs. (A third, `ExchangeShopInstantSettlementTemplate`'s
 * instant receipt, existed 2026-08-02→2026-08-03 and was removed when the
 * owner reversed D5 for this path: SHOP now waits for the INTER-CO batch too.)
 * Neither id is stored on the ContractExchangeRequest row (traceability is
 * metadata-only by design, same as the swept 2A accruals), so tests that need
 * them explicitly (e.g. for a "pair originals with reversals" completeness
 * check) must look them up the same way the cancel sweep itself does.
 */
async function findShopInventoryTransferJeIds(newContractId: string): Promise<string[]> {
  const cogsJe = await prisma.journalEntry.findFirstOrThrow({
    where: {
      metadata: { path: ['idempotencyKey'], equals: `shop-inventory-transfer:${newContractId}` } as never,
    },
  });
  const batchId = (cogsJe.metadata as Record<string, unknown>).batchId as string;
  const revenueJe = await prisma.journalEntry.findFirstOrThrow({
    where: {
      AND: [
        { metadata: { path: ['flow'], equals: 'shop-inventory-transfer-revenue' } as never },
        { metadata: { path: ['batchId'], equals: batchId } as never },
      ],
    },
  });
  return [cogsJe.id, revenueJe.id];
}

async function getJeLines(jeId: string): Promise<LineRow[]> {
  const je = await prisma.journalEntry.findUniqueOrThrow({
    where: { id: jeId },
    include: { lines: true },
  });
  return je.lines;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('Device Swap priced flow (workbook E2E — real DB)', () => {
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

    const existingBranch = await prisma.branch.findFirst({
      where: { name: '__exch_swap_test_branch__', deletedAt: null },
    });
    if (existingBranch) {
      branchId = existingBranch.id;
    } else {
      const branch = await prisma.branch.create({
        data: { name: '__exch_swap_test_branch__', companyId: shopCompanyId },
      });
      branchId = branch.id;
      createdBranchId = branch.id;
    }

    // Safety nets for the REAL approveBatch path (Task 5 C-2 — same convention
    // as contract-cancellation.integration.spec.ts): a leftover SoD flag or
    // CLOSED 2026-08 period row from an aborted run must not fail approve.
    await prisma.systemConfig.deleteMany({ where: { key: 'interco_maker_checker_enabled' } });
    await prisma.accountingPeriod.deleteMany({
      where: { companyId: { in: [shopCompanyId, financeCompanyId] }, year: 2026, month: 8 },
    });
  }, 120_000);

  afterAll(async () => {
    // Collect every JE this spec produced: (a) anything stamped
    // metadata.contractId with one of our contracts (1A/2A/receipt-sims/A.1-A.5
    // + their mirrors — A.4 stamps contractId = oldContractId since 2026-08-19),
    // (b) request-linked ids + reversalJeIds as a belt-and-suspenders sweep.
    const jeIds = new Set<string>();
    for (const cid of createdContractIds) {
      const rows = await prisma.journalEntry.findMany({
        where: { metadata: { path: ['contractId'], equals: cid } as never },
        select: { id: true },
      });
      rows.forEach((r) => jeIds.add(r.id));
    }
    const reqs = await prisma.contractExchangeRequest.findMany({
      where: { id: { in: createdRequestIds } },
    });
    for (const r of reqs) {
      for (const id of [r.je1aId, r.je2Id, r.je3Id, r.je4Id, r.eclReversalJeId, r.penaltyJeId]) {
        if (id) jeIds.add(id);
      }
      r.reversalJeIds.forEach((id) => jeIds.add(id));
    }
    // Batch JEs carry metadata.settlementBatchId — NOT contractId (architecture
    // ruling) — sweep them by batch id like the cancellation spec (Task 5 C-2).
    for (const bid of createdBatchIds) {
      const rows = await prisma.journalEntry.findMany({
        where: { metadata: { path: ['settlementBatchId'], equals: bid } as never },
        select: { id: true },
      });
      rows.forEach((r) => jeIds.add(r.id));
    }
    const jeIdList = [...jeIds];

    // JournalPostAuditLog FK-references journal_entries — clear first (a48fe1fe)
    await prisma.journalPostAuditLog.deleteMany({ where: { journalEntryId: { in: jeIdList } } });
    await prisma.journalLine.deleteMany({ where: { journalEntryId: { in: jeIdList } } });
    await prisma.journalEntry.deleteMany({ where: { id: { in: jeIdList } } });

    await prisma.badDebtProvision.deleteMany({ where: { contractId: { in: createdContractIds } } });
    await prisma.contractExchangeRequest.deleteMany({ where: { id: { in: createdRequestIds } } });
    await prisma.payment.deleteMany({ where: { contractId: { in: createdContractIds } } });
    await prisma.installmentSchedule.deleteMany({
      where: { contractId: { in: createdContractIds } },
    });
    // InterCoSettlementItem FK-references contracts with onDelete: Restrict —
    // clear items + batches before the contracts they reference.
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
  it(
    'Case 2A: swap buyback 8,000 → A.1-A.4 posted, 21-1106 nets 0, old-contract GL cleared, loss = GL-true',
    async () => {
      const fix = await seedSwapFixture('100001', { schedule: 'PAST4_FUTURE8' });

      // --- Real old-side history: 1A activation + 2A accrual ×4 + receipts ×4
      await act1a.execute(fix.oldContractId);
      const insts = await prisma.installmentSchedule.findMany({
        where: { contractId: fix.oldContractId, installmentNo: { lte: 4 } },
        orderBy: { installmentNo: 'asc' },
      });
      for (const inst of insts) {
        await accrual2a.execute(inst.id);
      }
      for (let i = 1; i <= 4; i++) {
        await postReceiptSim(fix.oldContractId, i);
      }
      // Guard precondition: 11-2103 fully cleared by the 4 receipts
      expect(
        (await glContractBalance(prisma, fix.oldContractId, '11-2103', 'dr')).toFixed(2),
      ).toBe('0.00');

      // --- Real submit (server-side plan math + tier snapshot)
      const submitted = await svc.submit(
        {
          oldContractId: fix.oldContractId,
          oldProductId: fix.oldProductId,
          newProductId: fix.newProductId,
          buybackPrice: '8000',
          deviceCondition: 'A',
          newTotalMonths: 12,
          newInterestRate: '0.05',
          depositAccountCode: '11-1101',
        } as never,
        { id: adminId, role: 'OWNER', branchId: null },
      );
      // No TradeInValuation row for this model → no ราคากลาง → REVIEW tier
      expect(submitted.approvalTier).toBe('REVIEW');
      // NCV snapshot = GL gross 11,333.36 − unearned 4,000.00
      expect(new Decimal(submitted.ncvSnapshot.toString()).toFixed(2)).toBe('7333.36');
      createdRequestIds.push(submitted.id);

      // --- Real approve (creates the DRAFT EXCH- contract from the plan snapshot)
      const approved = await svc.approve(submitted.id, { id: adminId, role: 'OWNER', branchId: null }, {});
      expect(approved.newContractId).toBeTruthy();
      const newContractId = approved.newContractId as string;
      createdContractIds.push(newContractId);

      const newContract = await prisma.contract.findUniqueOrThrow({
        where: { id: newContractId },
      });
      expect(newContract.contractNumber.startsWith('EXCH-')).toBe(true);
      expect(new Decimal(newContract.financedAmount.toString()).toFixed(2)).toBe('15000.00');
      expect(new Decimal(newContract.monthlyPayment.toString()).toFixed(2)).toBe('2273.75');
      expect(new Decimal(newContract.interestTotal.toString()).toFixed(2)).toBe('9000.00');
      expect(new Decimal(newContract.vatAmount!.toString()).toFixed(2)).toBe('1785.00');

      // --- Activate (sign-then-activate) → REAL finalizeAfterActivation in one tx
      await activateAndFinalize(newContractId, fix.newProductId);

      const req = await prisma.contractExchangeRequest.findUniqueOrThrow({
        where: { id: submitted.id },
      });
      expect(req.je1aId).toBeTruthy();
      expect(req.je2Id).toBeTruthy();
      expect(req.je3Id).toBeTruthy();
      expect(req.je4Id).toBeTruthy();
      expect(req.eclReversalJeId).toBeNull(); // no provision on this contract

      // --- CRITICAL workbook check: 21-1106 nets 0 across A.2 (Dr) + A.3 (Cr)
      const je2Lines = await getJeLines(req.je2Id!);
      const je3Lines = await getJeLines(req.je3Id!);
      const dr1106 = sumSide(je2Lines, '21-1106', 'dr');
      const cr1106 = sumSide(je3Lines, '21-1106', 'cr');
      expect(dr1106.toFixed(2)).toBe('8000.00');
      expect(dr1106.minus(cr1106).toFixed(2)).toBe('0.00');

      // --- A.2 clears the old contract at GL truth, not straight-line math:
      // Cr 11-2101 = 17,000 − 4×1,416.66 = 11,333.36 (NOT 1,416.66×8 = 11,333.28)
      expect(sumSide(je2Lines, '11-2101', 'cr').toFixed(2)).toBe('11333.36');
      expect(sumSide(je2Lines, '11-2105', 'cr').toFixed(2)).toBe('793.32');
      expect(sumSide(je2Lines, '21-2101', 'cr').toFixed(2)).toBe('793.32');
      // วิธีสุทธิ (workbook 2026-08-19): A.2 ไม่ตั้งรายได้ 41-1101 อีกต่อไป
      expect(sumSide(je2Lines, '41-1101', 'cr').toFixed(2)).toBe('0.00');
      expect(sumSide(je2Lines, '11-2106', 'dr').toFixed(2)).toBe('4000.00');
      expect(sumSide(je2Lines, '21-2102', 'dr').toFixed(2)).toBe('793.32');
      // Loss plug (วิธีสุทธิ) = (buyback 8,000 + unearned 4,000 + deferredVat 793.32)
      // − (gross 11,333.36 + vatRec 793.32 ×2) = −126.68
      expect(sumSide(je2Lines, '51-1102', 'dr').toFixed(2)).toBe('126.68');

      // --- A.3 (คำสั่งเจ้าของ 2026-08-03 — supersedes D5 for this path):
      // ตั้งลูกหนี้-หน้าร้าน 11-2107 ล้าง 21-1106 เท่านั้น. EXACTLY 2 lines —
      // ไม่มีขาเงินสด และไม่แตะเจ้าหนี้สัญญาใหม่ (21-1101/21-1102) เลย.
      expect(sumSide(je3Lines, '11-2107', 'dr').toFixed(2)).toBe('8000.00');
      expect(sumSide(je3Lines, '21-1106', 'cr').toFixed(2)).toBe('8000.00');
      expect(je3Lines).toHaveLength(2);
      expect(je3Lines.some((l) => l.accountCode === '21-1101')).toBe(false);
      expect(je3Lines.some((l) => l.accountCode === '21-1102')).toBe(false);
      // ไม่มีบรรทัดเงินสด/ธนาคารใดๆ (11-11xx / 11-12xx) ในใบนี้
      expect(je3Lines.some((l) => /^11-1[12]0[123]$/.test(l.accountCode))).toBe(false);

      // --- A.4 (workbook 2026-08-19): SHOP ซื้อเครื่องเดิมคืนที่ "ราคารับซื้อ"
      // Dr S11-2002 [buyback] / Cr S21-3001 [buyback], posted under SHOP company.
      // The old shape (Cr S50-1102 at costPrice) is retired — forward-only.
      const je4 = await prisma.journalEntry.findUniqueOrThrow({
        where: { id: req.je4Id! },
        include: { lines: true },
      });
      expect(je4.companyId).toBe(shopCompanyId);
      expect(sumSide(je4.lines, 'S11-2002', 'dr').toFixed(2)).toBe('8000.00');
      expect(sumSide(je4.lines, 'S50-1102', 'cr').toFixed(2)).toBe('0.00');
      expect(sumSide(je4.lines, 'S21-3001', 'cr').toFixed(2)).toBe('8000.00');
      expect((je4.metadata as Record<string, unknown>).shopReceivableType).toBe('SWAP_CREDIT');
      // Phase 2 Task 1: batch item = สัญญาใหม่ — the SHOP netting lens (Task 3)
      // queries S21-3001 by metadata.newContractId directly (no join through
      // the request row in SQL), so A.4 must stamp the NEW contract id too.
      expect((je4.metadata as Record<string, unknown>).newContractId).toBe(newContractId);

      // --- F2 (CPA ตอบข้อ 3, 2026-08-01): the NEW contract also gets the
      // SHOP-side ShopInventoryTransferTemplate mirror a normal activation
      // gets — COGS (S50-1101/S11-2001, costPrice 9,000) + revenue
      // (S41-1101 salePrice 15,000 / S41-1201 commission 1,500). downPayment
      // on an exchange new contract is always 0, so no S21-2001 line.
      expect(
        (await glContractBalance(prisma, newContractId, 'S41-1101', 'cr')).toFixed(2),
      ).toBe('15000.00');
      expect(
        (await glContractBalance(prisma, newContractId, 'S41-1201', 'cr')).toFixed(2),
      ).toBe('1500.00');
      expect(
        (await glContractBalance(prisma, newContractId, 'S50-1101', 'dr')).toFixed(2),
      ).toBe('9000.00');
      expect(
        (await glContractBalance(prisma, newContractId, 'S11-2001', 'cr')).toFixed(2),
      ).toBe('9000.00');

      // --- คำสั่งเจ้าของ 2026-08-03 (SUPERSEDES D5 for this path): the
      // instant-settlement leg is GONE. S11-3001/S11-3002 stay OUTSTANDING at
      // financedAmount/commission (this reverts the 2026-08-02 goldens of
      // 0.00/0.00) and S11-1201 is never touched at finalize — SHOP now waits
      // for the same "จ่ายให้หน้าร้าน" batch a normal sale waits for.
      expect(
        (await glContractBalance(prisma, newContractId, 'S11-3001', 'dr')).toFixed(2),
      ).toBe('15000.00');
      expect(
        (await glContractBalance(prisma, newContractId, 'S11-3002', 'dr')).toFixed(2),
      ).toBe('1500.00');
      expect(
        (await glContractBalance(prisma, newContractId, 'S11-1201', 'dr')).toFixed(2),
      ).toBe('0.00');
      // No SHOP settlement JE exists at all for this contract any more.
      expect(
        await prisma.journalEntry.findFirst({
          where: {
            metadata: {
              path: ['idempotencyKey'],
              equals: `exchange-shop-receipt:${newContractId}`,
            } as never,
          },
        }),
      ).toBeNull();

      // --- FINANCE side: A.1's vendor payables stay OUTSTANDING (A.3 no
      // longer nets them against the buyback). 11-2107 carries the buyback as
      // a FINANCE receivable on SHOP instead — cleared later by the existing
      // shop-collect settlement path (Dr <cash> / Cr 11-2107).
      expect(
        (await glContractBalance(prisma, newContractId, '21-1101', 'cr')).toFixed(2),
      ).toBe('15000.00');
      expect(
        (await glContractBalance(prisma, newContractId, '21-1102', 'cr')).toFixed(2),
      ).toBe('1500.00');
      expect(
        (await glContractBalance(prisma, newContractId, '11-2107', 'dr')).toFixed(2),
      ).toBe('8000.00');
      // A.4 ใหม่ (workbook 2026-08-19): SHOP ตั้งเจ้าหนี้ FINANCE = ราคารับซื้อ รอหักกลบรอบจ่าย
      expect(
        (await glContractBalance(prisma, fix.oldContractId, 'S21-3001', 'cr')).toFixed(2),
      ).toBe('8000.00');
      // ยืนยันว่าไม่มีเงินสด/ธนาคารขยับบนสัญญาใหม่เลยในวัน finalize
      expect(
        (await glContractBalance(prisma, newContractId, '11-1101', 'dr')).toFixed(2),
      ).toBe('0.00');
      expect(
        (await glContractBalance(prisma, newContractId, '11-1201', 'dr')).toFixed(2),
      ).toBe('0.00');

      // --- INTER-CO pending engine (interco-pending.service.ts): an exchange
      // contract NOW DOES surface in getPendingContracts() — this assertion is
      // the exact INVERSE of what this spec asserted before 2026-08-03 (when
      // A.3 cleared 21-1101/21-1102 in the same tx and the HAVING
      // `SUM(credit-debit) > 0` lens therefore never saw the row). It settles
      // through the normal "จ่ายให้หน้าร้าน" batch like an ordinary sale, and
      // carries legacyNoShop = false because the F2 SHOP leg left real
      // S11-3001/S11-3002 balances for the batch's SHOP half to clear.
      const pendingAfter = await intercoPending.getPendingContracts();
      const pendingRow = pendingAfter.find((p) => p.contractId === newContractId);
      expect(pendingRow, 'exchange contract must appear in the INTER-CO pending queue').toBeDefined();
      expect(pendingRow!.financedGl.toFixed(2)).toBe('15000.00');
      expect(pendingRow!.commissionGl.toFixed(2)).toBe('1500.00');
      expect(pendingRow!.shopFinancedGl.toFixed(2)).toBe('15000.00');
      expect(pendingRow!.shopCommissionGl.toFixed(2)).toBe('1500.00');
      expect(pendingRow!.legacyNoShop).toBe(false);
      // Netting lens tie-in (Phase 2 Task 6): through the REAL templates —
      // A.3 (ExchangeBuybackReceivable11_2107Template stamps
      // metadata.contractId = newContractId + shopReceivableType SWAP_CREDIT)
      // and A.4 (ShopExchangeReturnTemplate stamps metadata.newContractId +
      // SWAP_CREDIT) — the SAME pending row must carry the buyback on BOTH
      // books and be eligible for netting in the settlement round. This is
      // the end-to-end proof that the producer stamps and the lens SQL
      // (interco-pending.service.ts) join up — not just synthetic seeds.
      expect(pendingRow!.swapCreditGl.toFixed(2)).toBe('8000.00');
      expect(pendingRow!.shopBuybackPayableGl.toFixed(2)).toBe('8000.00');
      expect(pendingRow!.swapCreditEligible).toBe(true);

      // --- Old-contract GL: every receivable/deferral account nets EXACTLY 0
      for (const [code, side] of [
        ['11-2101', 'dr'],
        ['11-2105', 'dr'],
        ['11-2103', 'dr'],
        ['11-2106', 'cr'],
        ['21-2102', 'cr'],
      ] as const) {
        expect(
          (await glContractBalance(prisma, fix.oldContractId, code, side)).toFixed(2),
          `old-contract GL ${code} must net 0 after finalize`,
        ).toBe('0.00');
      }

      // --- Status flips
      const oldContract = await prisma.contract.findUniqueOrThrow({
        where: { id: fix.oldContractId },
      });
      expect(oldContract.status).toBe('EXCHANGED');
      expect(oldContract.exchangedAt).not.toBeNull();
      const oldProduct = await prisma.product.findUniqueOrThrow({
        where: { id: fix.oldProductId },
      });
      expect(oldProduct.status).toBe('REFURBISHED');
      expect(oldProduct.ownedByCompanyId).toBe(shopCompanyId);
      // A.4 (workbook 2026-08-19): costPrice ถูกเขียนทับเป็นราคารับซื้อ (ต้นทุนจริง
      // ของ SHOP รอบใหม่) และค่าเดิมถูก snapshot ไว้บน request row ให้ cancel restore
      expect(new Decimal(oldProduct.costPrice!.toString()).toFixed(2)).toBe('8000.00');
      expect(req.previousCostPrice).not.toBeNull();
      expect(new Decimal(req.previousCostPrice!.toString()).toFixed(2)).toBe('7500.00');
    },
    120_000,
  );

  // -------------------------------------------------------------------------
  it(
    'ECL: old contract carries provision 30.32 → A.5 Dr 11-2102 / Cr 51-1103 = 30.32 + BadDebtProvision REVERSED',
    async () => {
      const fix = await seedSwapFixture('100002', { schedule: 'NONE' });
      await act1a.execute(fix.oldContractId);

      // Seed the ECL state: provision JE (Cr 11-2102 tagged contractId) + ACTIVE row
      const zero = new Decimal(0);
      const provision = new Decimal('30.32');
      await journal.createAndPost({
        description: '[integration-seed] ECL provision B1',
        metadata: { flow: 'exchange-integration-provision-seed', contractId: fix.oldContractId },
        lines: [
          { accountCode: '51-1103', dr: provision, cr: zero },
          { accountCode: '11-2102', dr: zero, cr: provision },
        ],
      });
      const provisionRow = await prisma.badDebtProvision.create({
        data: {
          contractId: fix.oldContractId,
          provisionDate: new Date(),
          agingBucket: '1-30',
          daysOverdue: 15,
          outstandingAmount: new Decimal('1515.83'),
          provisionRate: new Decimal('0.0200'),
          provisionAmount: provision,
          status: 'ACTIVE',
        },
      });

      const { newContract, request } = await seedNewContractAndRequest(fix, '100002', '8000');
      await activateAndFinalize(newContract.id, fix.newProductId);

      const req = await prisma.contractExchangeRequest.findUniqueOrThrow({
        where: { id: request.id },
      });
      expect(req.eclReversalJeId).toBeTruthy();

      const je5 = await prisma.journalEntry.findUniqueOrThrow({
        where: { id: req.eclReversalJeId! },
        include: { lines: true },
      });
      expect(sumSide(je5.lines, '11-2102', 'dr').toFixed(2)).toBe('30.32');
      expect(sumSide(je5.lines, '51-1103', 'cr').toFixed(2)).toBe('30.32');
      expect((je5.metadata as Record<string, unknown>).reversedProvision).toBe('30.32');

      const rowAfter = await prisma.badDebtProvision.findUniqueOrThrow({
        where: { id: provisionRow.id },
      });
      expect(rowAfter.status).toBe('REVERSED');

      expect(
        (await glContractBalance(prisma, fix.oldContractId, '11-2102', 'cr')).toFixed(2),
      ).toBe('0.00');
    },
    120_000,
  );

  // -------------------------------------------------------------------------
  it(
    'Cancel day-15: all JEs mirror-reversed (per-account net 0), NO penalty JE (owner removed the rule 2026-07-31), old ACTIVE + 2A cron backfills',
    async () => {
      const fix = await seedSwapFixture('100003', { schedule: 'FUTURE12' });
      await act1a.execute(fix.oldContractId);

      // GL snapshot after 1A (this is what cancel must restore)
      const pre = {
        gross: await glContractBalance(prisma, fix.oldContractId, '11-2101', 'dr'),
        vatRec: await glContractBalance(prisma, fix.oldContractId, '11-2105', 'dr'),
        unearned: await glContractBalance(prisma, fix.oldContractId, '11-2106', 'cr'),
        deferredVat: await glContractBalance(prisma, fix.oldContractId, '21-2102', 'cr'),
      };
      expect(pre.gross.toFixed(2)).toBe('17000.00');

      // costPrice เดิมของเครื่องเก่า (fixture = 7,500 ≠ buyback 8,000) — A.4 จะ
      // เขียนทับตอน finalize และ cancel ต้อง restore กลับค่านี้ (scrutiny finding 3)
      const originalCostPrice = new Decimal(
        (
          await prisma.product.findUniqueOrThrow({
            where: { id: fix.oldProductId },
            select: { costPrice: true },
          })
        ).costPrice!.toString(),
      );

      const { newContract, request } = await seedNewContractAndRequest(fix, '100003', '8000');
      await activateAndFinalize(newContract.id, fix.newProductId);

      // Precondition ของ assertion restore ด้านล่าง: A.4 เขียนทับ costPrice =
      // ราคารับซื้อ (8,000) ซึ่งต้อง "ต่าง" จากค่าเดิม — ถ้าสองค่านี้เท่ากัน
      // การ restore ที่พังจะ pass แบบบังเอิญ
      const costAfterFinalize = await prisma.product.findUniqueOrThrow({
        where: { id: fix.oldProductId },
        select: { costPrice: true },
      });
      expect(new Decimal(costAfterFinalize.costPrice!.toString()).toFixed(2)).toBe('8000.00');
      expect(originalCostPrice.toFixed(2)).toBe('7500.00');

      // F2 SHOP JEs are never stored on the request row (metadata-only
      // traceability) — look them up explicitly for the pair-completeness
      // check below (the sweep still finds + reverses them regardless).
      const shopJeIds = await findShopInventoryTransferJeIds(newContract.id);

      // --- Negative catch-up proof: while old contract is EXCHANGED the 2A
      // cron must SKIP its due installment (status exclusion list).
      const inst1 = await prisma.installmentSchedule.findFirstOrThrow({
        where: { contractId: fix.oldContractId, installmentNo: 1 },
      });
      await prisma.installmentSchedule.update({
        where: { id: inst1.id },
        data: { dueDate: new Date(Date.now() - 3 * DAY) },
      });
      await accrualCron.tick();
      expect(
        (
          await prisma.installmentSchedule.findUniqueOrThrow({ where: { id: inst1.id } })
        ).accrualJournalEntryId,
      ).toBeNull();

      // --- Backdate the swap 15 days, then REAL cancel. Owner removed the
      // 7/8-30-day windows + 5% penalty entirely (2026-07-31) — cancel now
      // succeeds identically regardless of days elapsed, with no penalty JE.
      await prisma.contract.update({
        where: { id: fix.oldContractId },
        data: { exchangedAt: new Date(Date.now() - 15 * DAY) },
      });
      const result = await cancelSvc.cancel(
        request.id,
        'ทดสอบยกเลิกเปลี่ยนเครื่องภายในวันที่ 15 (integration)',
        { id: adminId, role: 'OWNER', branchId: null },
      );
      expect(result.cancelWindow).toBe('FREE');
      expect(result.penaltyAmount).toBeNull();

      const req = await prisma.contractExchangeRequest.findUniqueOrThrow({
        where: { id: request.id },
      });
      expect(req.status).toBe('CANCELED');
      // A.1 + A.2 + A.3 + A.4 (no A.5 here) + the 2 SHOP JEs F2 posts on the
      // new contract at finalize (ShopInventoryTransfer COGS + revenue) —
      // swept via metadata.contractId, same mechanism as the 2A accruals in
      // the day-45 case below. Was 7 until 2026-08-03: the D5
      // ExchangeShopInstantSettlement receipt is gone (owner order — SHOP now
      // settles through the INTER-CO batch instead of instantly at finalize).
      expect(req.reversalJeIds.length).toBe(6);
      expect(req.penaltyJeId).toBeNull();
      expect(req.penaltyAmount).toBeNull();

      // --- Mirror JEs must carry shopReceivableType (final review 2026-08-19).
      // A.3 + A.4 stamp SWAP_CREDIT; if their mirrors don't copy it, a canceled
      // swap leaves +buyback SWAP_CREDIT and -buyback UNKNOWN on 11-2107/
      // S21-3001 — the Phase 2 netting lens (sum per type) then sees a phantom
      // SWAP_CREDIT balance even though the real GL nets 0.
      for (const stampedId of [req.je3Id!, req.je4Id!]) {
        const mirror = await prisma.journalEntry.findFirstOrThrow({
          where: { metadata: { path: ['reversesEntryId'], equals: stampedId } as never },
        });
        expect(
          (mirror.metadata as Record<string, unknown>).shopReceivableType,
          `mirror of ${stampedId} must carry shopReceivableType`,
        ).toBe('SWAP_CREDIT');
        // Phase 2 Task 1: mirrors must also carry newContractId — the SHOP
        // lens sums S21-3001 per NEW contract, so a canceled swap's mirror
        // without the key would leave a phantom per-contract balance.
        expect(
          (mirror.metadata as Record<string, unknown>).newContractId,
          `mirror of ${stampedId} must carry newContractId`,
        ).toBe(newContract.id);
      }

      // --- NO 42-1107 penalty JE anywhere in this spec's journal rows
      const anyPenaltyLine = await prisma.journalLine.findFirst({
        where: { accountCode: '42-1107' },
      });
      expect(anyPenaltyLine).toBeNull();

      // --- Mirror-reverse completeness: originals + reversals net 0 per account
      const pairIds = [req.je1aId!, req.je2Id!, req.je3Id!, req.je4Id!, ...shopJeIds, ...req.reversalJeIds];
      const pairLines = await prisma.journalLine.findMany({
        where: { journalEntryId: { in: pairIds } },
      });
      const perAccount = new Map<string, Decimal>();
      for (const l of pairLines) {
        const net = (perAccount.get(l.accountCode) ?? new Decimal(0))
          .plus(l.debit.toString())
          .minus(l.credit.toString());
        perAccount.set(l.accountCode, net);
      }
      expect(perAccount.size).toBeGreaterThan(0);
      for (const [code, net] of perAccount) {
        expect(net.abs().lt('0.005'), `account ${code} must net 0 across JE+reversal`).toBe(true);
      }

      // --- Old-contract GL restored to the pre-finalize snapshot
      expect(
        (await glContractBalance(prisma, fix.oldContractId, '11-2101', 'dr')).toFixed(2),
      ).toBe(pre.gross.toFixed(2));
      expect(
        (await glContractBalance(prisma, fix.oldContractId, '11-2105', 'dr')).toFixed(2),
      ).toBe(pre.vatRec.toFixed(2));
      expect(
        (await glContractBalance(prisma, fix.oldContractId, '11-2106', 'cr')).toFixed(2),
      ).toBe(pre.unearned.toFixed(2));
      expect(
        (await glContractBalance(prisma, fix.oldContractId, '21-2102', 'cr')).toFixed(2),
      ).toBe(pre.deferredVat.toFixed(2));
      expect(
        (await glContractBalance(prisma, fix.oldContractId, '21-1106', 'cr')).toFixed(2),
      ).toBe('0.00');

      // --- New-contract GL: everything nets 0 (incl. F2's SHOP legs and the
      // 11-2107 buyback receivable A.3 now opens instead of a cash leg)
      for (const [code, side] of [
        ['11-2101', 'dr'],
        ['11-2105', 'dr'],
        ['11-2106', 'cr'],
        ['21-2102', 'cr'],
        ['21-1101', 'cr'],
        ['21-1102', 'cr'],
        ['21-1106', 'cr'],
        ['11-2107', 'dr'],
        ['11-1101', 'dr'],
        ['S11-3001', 'dr'],
        ['S11-3002', 'dr'],
        ['S11-1201', 'dr'],
        ['S41-1101', 'cr'],
        ['S41-1201', 'cr'],
        ['S50-1101', 'dr'],
        ['S11-2001', 'cr'],
      ] as const) {
        expect(
          (await glContractBalance(prisma, newContract.id, code, side)).toFixed(2),
          `new-contract GL ${code} must net 0 after cancel`,
        ).toBe('0.00');
      }

      // --- State restoration
      const oldAfter = await prisma.contract.findUniqueOrThrow({
        where: { id: fix.oldContractId },
      });
      expect(oldAfter.status).toBe('ACTIVE');
      expect(oldAfter.exchangedAt).toBeNull();
      const newAfter = await prisma.contract.findUniqueOrThrow({ where: { id: newContract.id } });
      expect(newAfter.status).toBe('CANCELED');
      // C1a: the @unique exchangedFromContractId pointer is nulled at cancel —
      // history lives on the request row; the old contract can be re-exchanged.
      expect(newAfter.exchangedFromContractId).toBeNull();
      const oldProd = await prisma.product.findUniqueOrThrow({ where: { id: fix.oldProductId } });
      expect(oldProd.status).toBe('SOLD_INSTALLMENT');
      expect(oldProd.ownedByCompanyId).toBe(financeCompanyId);
      // costPrice ของเครื่องเก่าต้องถูก restore กลับค่าก่อน finalize (scrutiny finding 3)
      expect(new Decimal(oldProd.costPrice!.toString()).toFixed(2)).toBe(
        originalCostPrice.toFixed(2),
      );
      const newProd = await prisma.product.findUniqueOrThrow({ where: { id: fix.newProductId } });
      expect(newProd.status).toBe('IN_STOCK');
      expect(newProd.ownedByCompanyId).toBe(shopCompanyId);

      // --- Catch-up: contract no longer EXCHANGED → next 2A tick backfills งวด #1
      await accrualCron.tick();
      const inst1After = await prisma.installmentSchedule.findUniqueOrThrow({
        where: { id: inst1.id },
      });
      expect(inst1After.accrualJournalEntryId).not.toBeNull();
      expect(
        (await glContractBalance(prisma, fix.oldContractId, '11-2103', 'dr')).toFixed(2),
      ).toBe('1515.83');
    },
    120_000,
  );

  // -------------------------------------------------------------------------
  // Owner decision 2026-07-31: the old 30-day cancellation cap is gone —
  // prove cancel succeeds identically past it (day 45) end-to-end against a
  // real DB. A REAL 45-day-old swap would already have 2A accrual JEs posted
  // on the NEW contract (its own installments came due) — seed 2 real
  // accruals via InstallmentAccrual2ATemplate (same template the daily cron
  // uses) so this proves the cancel sweep reverses MORE than just the 4 core
  // swap JEs, i.e. the metadata.contractId sweep in
  // ExchangeCancelReversalTemplate actually catches JEs it never received an
  // explicit id for.
  it(
    'Cancel day-45 (past the old 30-day cap): SUCCEEDS — window FREE, no penalty JE, 2A accruals on the new contract swept + net 0',
    async () => {
      const fix = await seedSwapFixture('100006', { schedule: 'NONE' });
      await act1a.execute(fix.oldContractId);

      const { newContract, request } = await seedNewContractAndRequest(fix, '100006', '8000');
      await activateAndFinalize(newContract.id, fix.newProductId);
      const shopJeIds = await findShopInventoryTransferJeIds(newContract.id);

      // --- Seed 2 REAL 2A accruals on the NEW contract (installments #1-#2
      // already due by day 45). Uses the same template the daily cron calls —
      // not a hand-rolled JE — so the sweep is proven against production code.
      const newInst1 = await prisma.installmentSchedule.create({
        data: {
          contractId: newContract.id,
          installmentNo: 1,
          dueDate: new Date(Date.now() - 40 * DAY),
          principal: new Decimal('1250.00'),
          interest: new Decimal('750.00'),
          amountDue: new Decimal('2273.75'),
        },
      });
      const newInst2 = await prisma.installmentSchedule.create({
        data: {
          contractId: newContract.id,
          installmentNo: 2,
          dueDate: new Date(Date.now() - 10 * DAY),
          principal: new Decimal('1250.00'),
          interest: new Decimal('750.00'),
          amountDue: new Decimal('2273.75'),
        },
      });
      const accrual1 = await accrual2a.execute(newInst1.id);
      const accrual2 = await accrual2a.execute(newInst2.id);
      expect(accrual1).not.toBeNull();
      expect(accrual2).not.toBeNull();
      // Look up the accrual JEs by their installmentScheduleId tag (not
      // entryNumber — that's not guaranteed globally unique across companies)
      // so the "mirror-reverse completeness" check below can include them.
      const accrualJe1 = await prisma.journalEntry.findFirstOrThrow({
        where: { metadata: { path: ['installmentScheduleId'], equals: newInst1.id } as never },
      });
      const accrualJe2 = await prisma.journalEntry.findFirstOrThrow({
        where: { metadata: { path: ['installmentScheduleId'], equals: newInst2.id } as never },
      });

      await prisma.contract.update({
        where: { id: fix.oldContractId },
        data: { exchangedAt: new Date(Date.now() - 45 * DAY) },
      });
      const result = await cancelSvc.cancel(
        request.id,
        'ทดสอบยกเลิกเปลี่ยนเครื่องวันที่ 45 (integration — เกินเพดานเดิม + มี 2A accrual)',
        { id: adminId, role: 'OWNER', branchId: null },
      );
      expect(result.cancelWindow).toBe('FREE');
      expect(result.penaltyAmount).toBeNull();

      const req = await prisma.contractExchangeRequest.findUniqueOrThrow({
        where: { id: request.id },
      });
      expect(req.status).toBe('CANCELED');
      expect(req.penaltyJeId).toBeNull();
      expect(req.penaltyAmount).toBeNull();
      // (ก) A.1 + A.2 + A.3 + A.4 (no A.5 here) + the 2 F2 SHOP JEs
      // (ShopInventoryTransfer COGS + revenue, posted at finalize) + the 2
      // swept 2A accrual JEs on the new contract — proves the metadata sweep,
      // not just the 4 explicitly-tracked core swap JEs, actually ran.
      // Was 9 until 2026-08-03 (the D5 instant-settlement receipt is gone).
      expect(req.reversalJeIds.length).toBe(8);

      // --- NO 42-1107 penalty JE anywhere in this spec's journal rows
      const anyPenaltyLine = await prisma.journalLine.findFirst({
        where: { accountCode: '42-1107' },
      });
      expect(anyPenaltyLine).toBeNull();

      // (ข) Sweep-at-scale: every account the 2A accruals touched nets to 0
      // on the new contract's GL. glContractBalance aggregates ALL POSTED
      // lines tagged metadata.contractId = newContract.id regardless of
      // which specific JE ids we know about — so this proves the swept
      // accruals were actually reversed, not just the 4 core swap JEs.
      for (const [code, side] of [
        ['11-2103', 'dr'],
        ['11-2101', 'dr'],
        ['11-2106', 'cr'],
        ['11-2105', 'dr'],
        ['21-2102', 'cr'],
        ['21-2101', 'cr'],
        ['41-1101', 'cr'],
        ['21-1101', 'cr'],
        ['21-1102', 'cr'],
        ['11-2107', 'dr'],
        ['S11-3001', 'dr'],
        ['S11-3002', 'dr'],
        ['S11-1201', 'dr'],
        ['S41-1101', 'cr'],
        ['S41-1201', 'cr'],
        ['S50-1101', 'dr'],
        ['S11-2001', 'cr'],
      ] as const) {
        expect(
          (await glContractBalance(prisma, newContract.id, code, side)).toFixed(2),
          `new-contract GL ${code} must net 0 after cancel (incl. swept 2A accruals + F2 SHOP legs)`,
        ).toBe('0.00');
      }

      // (ค) Mirror-reverse completeness (existing check, still passing): originals
      // + reversals net 0 per account — now includes the 2 accrual JE ids
      // explicitly so their pair is complete (their reversals are only
      // discoverable via the sweep, never stored on the request row).
      const pairIds = [
        req.je1aId!,
        req.je2Id!,
        req.je3Id!,
        req.je4Id!,
        ...shopJeIds,
        accrualJe1.id,
        accrualJe2.id,
        ...req.reversalJeIds,
      ];
      const pairLines = await prisma.journalLine.findMany({
        where: { journalEntryId: { in: pairIds } },
      });
      const perAccount = new Map<string, Decimal>();
      for (const l of pairLines) {
        const net = (perAccount.get(l.accountCode) ?? new Decimal(0))
          .plus(l.debit.toString())
          .minus(l.credit.toString());
        perAccount.set(l.accountCode, net);
      }
      expect(perAccount.size).toBeGreaterThan(0);
      for (const [code, net] of perAccount) {
        expect(net.abs().lt('0.005'), `account ${code} must net 0 across JE+reversal`).toBe(true);
      }

      // --- State restoration
      const oldAfter = await prisma.contract.findUniqueOrThrow({
        where: { id: fix.oldContractId },
      });
      expect(oldAfter.status).toBe('ACTIVE');
      expect(oldAfter.exchangedAt).toBeNull();
      const newAfter = await prisma.contract.findUniqueOrThrow({ where: { id: newContract.id } });
      expect(newAfter.status).toBe('CANCELED');
      expect(newAfter.exchangedFromContractId).toBeNull();
    },
    120_000,
  );

  // ===========================================================================
  // Phase 3 Task 5 — exchange-cancel C-2 (workbook §5.5): ยกเลิก swap หลังรอบจ่าย
  // POSTED. เลขทองของเฟส: เจ้าหนี้ 11,000 (10,000+1,000) หักเครดิตสวอป 8,000
  // → FINANCE โอนจริง 3,000 → recall net = 3,000.
  // ===========================================================================
  it(
    'Task 5 (C-2): ยกเลิก swap หลังรอบจ่าย POSTED → PAYOUT_RECALL net 3,000 + GL ทุกบัญชีถูก',
    async () => {
      // Baselines BEFORE seeding — C-2 assertions are account-level DELTAS
      // (batch JEs carry no metadata.contractId — per-contract lens can't see
      // them; and glContractBalance ก็แยกไม่ออก เพราะ mirror ตรงของ A.1 ทำให้
      // per-contract net = 0 เหมือนกันทั้งถูกและผิด — ระดับบัญชีเท่านั้นที่เห็น)
      const payableCodes = ['21-1101', '21-1102', 'S11-3001', 'S11-3002'] as const;
      const deltaCodes = [...payableCodes, '11-2107', 'S21-3001'] as const;
      const preSeed: Record<string, Decimal> = {};
      for (const code of deltaCodes) preSeed[code] = await wholeAccountBalance(code);

      const fix = await seedSwapFixture('100007', { schedule: 'NONE' });
      await act1a.execute(fix.oldContractId);

      // New contract = เลขทอง: financed 10,000 + commission 1,000 (เจ้าหนี้ 11,000),
      // interest 6,000 / VAT 1,190 (มาตรฐาน 17K), buyback 8,000
      const { newContract, request } = await seedNewContractAndRequest(fix, '100007', '8000', {
        financed: '10000.00',
        commission: '1000.00',
        interest: '6000.00',
        vat: '1190.00',
        monthly: '1515.83',
      });
      await activateAndFinalize(newContract.id, fix.newProductId);

      // --- รอบจ่ายจริง (create → submit → approve): หักเครดิตสวอป 8,000 อัตโนมัติ
      // (swapCreditEligible จาก A.3/A.4) → โอนสุทธิ 3,000
      const batch = await settlementService.createBatch(
        { contractIds: [newContract.id], transferDate: '2026-08-20' },
        adminId,
      );
      createdBatchIds.push(batch.id);
      const batchRow = await prisma.interCoSettlementBatch.findUniqueOrThrow({
        where: { id: batch.id },
      });
      expect(new Decimal(batchRow.totalAmount.toString()).toFixed(2)).toBe('11000.00');
      expect(new Decimal(batchRow.totalDeduction.toString()).toFixed(2)).toBe('8000.00');
      expect(new Decimal(batchRow.netTransferAmount!.toString()).toFixed(2)).toBe('3000.00');
      await settlementService.submitBatch(batch.id, adminId);
      const posted = await settlementService.approveBatch(batch.id, adminId);
      expect(posted.status).toBe('POSTED');

      // หลัง approve: delta จาก preSeed = เจ้าหนี้ของสัญญา "เก่า" เท่านั้น
      // (act1a ของสัญญาเก่า Cr 10,000/1,000 ค้างตลอดเทส — สัญญาเก่า seed ตรง
      // ไม่มี SHOP legs ⇒ ฝั่ง S = 0). แปลว่าเจ้าหนี้ของสัญญาใหม่ถูก batch
      // settle เป็น 0 แล้วจริง — จุดตั้งต้นของ "ไม่ติดลบหลัง redirect".
      // (helper คิด Dr−Cr ⇒ เจ้าหนี้คงค้างเป็นค่าลบ)
      expect((await wholeAccountBalance('21-1101')).minus(preSeed['21-1101']).toFixed(2)).toBe(
        '-10000.00',
      );
      expect((await wholeAccountBalance('21-1102')).minus(preSeed['21-1102']).toFixed(2)).toBe(
        '-1000.00',
      );
      expect((await wholeAccountBalance('S11-3001')).minus(preSeed['S11-3001']).toFixed(2)).toBe(
        '0.00',
      );
      expect((await wholeAccountBalance('S11-3002')).minus(preSeed['S11-3002']).toFixed(2)).toBe(
        '0.00',
      );

      // Snapshot จุดตั้งต้นก่อน cancel — ทุก assertion หลังจากนี้เป็น delta
      // "ข้ามการ cancel" ล้วนๆ
      const preCancel: Record<string, Decimal> = {};
      for (const code of deltaCodes) preCancel[code] = await wholeAccountBalance(code);

      // --- REAL cancel (C-2)
      const result = await cancelSvc.cancel(
        request.id,
        'ทดสอบยกเลิกเปลี่ยนเครื่องหลังตัดจ่ายรอบจ่าย (Task 5 C-2)',
        { id: adminId, role: 'OWNER', branchId: null },
      );

      // RED proof เดิม (ก่อน Task 5): mirror ตรงกลับ → delta ข้าม cancel ของ
      // 21-1101 = +10,000 / 21-1102 = +1,000 (Dr งอกทั้งที่ batch ล้างไปแล้ว =
      // เจ้าหนี้ติดลบเท่ายอดสัญญาใหม่ กลบเจ้าหนี้สัญญาเก่าจนบัญชีโชว์ 0) และ
      // S11-3001/S11-3002 = −10,000/−1,000 ฝั่ง SHOP. C-2 ต้อง redirect ⇒ 0.
      for (const code of payableCodes) {
        expect(
          (await wholeAccountBalance(code)).minus(preCancel[code]).toFixed(2),
          `account ${code} must not move across a C-2 cancel (redirect, not mirror)`,
        ).toBe('0.00');
      }

      // 11-2107 delta ข้าม cancel = +3,000 Dr (เงินที่ต้องเรียกคืนจริง):
      // mirror A.3 −8,000 + redirect 11,000
      expect((await wholeAccountBalance('11-2107')).minus(preCancel['11-2107']).toFixed(2)).toBe(
        '3000.00',
      );
      // S21-3001 sym ฝั่ง SHOP: mirror A.4 +8,000 + redirect −11,000
      // (helper คิด Dr−Cr ⇒ เจ้าหนี้สุทธิ 3,000 = −3,000)
      expect((await wholeAccountBalance('S21-3001')).minus(preCancel['S21-3001']).toFixed(2)).toBe(
        '-3000.00',
      );

      expect(result.cancelWindow).toBe('AFTER_PAYOUT');

      // --- typed lenses: SWAP_CREDIT net 0 ทั้งสองสมุด (A.3/A.4 + mirror ของมัน),
      // PAYOUT_RECALL gross 11,000 ทั้งสองสมุด (จาก redirect legs)
      expect((await swapCreditFinanceBalance(prisma, newContract.id)).toFixed(2)).toBe('0.00');
      expect((await swapCreditShopBalance(prisma, newContract.id)).toFixed(2)).toBe('0.00');
      expect((await recallFinanceBalance(prisma, newContract.id)).toFixed(2)).toBe('11000.00');
      expect((await recallShopBalance(prisma, newContract.id)).toFixed(2)).toBe('11000.00');

      // --- คิวเรียกคืน (Task 4 net): gross 11,000 − Σ deduction POSTED 8,000 = 3,000
      const recalls = await intercoPending.getPendingRecalls();
      const recallRow = recalls.find((r) => r.contractId === newContract.id);
      expect(recallRow, 'canceled swap must appear in the recall queue').toBeDefined();
      expect(recallRow!.recallGl.toFixed(2)).toBe('3000.00');
      expect(recallRow!.shopRecallGl.toFixed(2)).toBe('3000.00');

      // --- Request row + redirect mirror ของ A.1
      const req = await prisma.contractExchangeRequest.findUniqueOrThrow({
        where: { id: request.id },
      });
      expect(req.status).toBe('CANCELED');
      expect(req.cancelWindow).toBe('AFTER_PAYOUT');
      // A.1 + A.2 + A.3 + A.4 + 2 F2 SHOP JEs (ไม่มี A.5/2A ในเคสนี้)
      expect(req.reversalJeIds.length).toBe(6);
      const a1Mirror = await prisma.journalEntry.findFirstOrThrow({
        where: { metadata: { path: ['reversesEntryId'], equals: req.je1aId! } as never },
        include: { lines: true },
      });
      expect((a1Mirror.metadata as Record<string, unknown>).shopReceivableType).toBe(
        'PAYOUT_RECALL',
      );
      expect(sumSide(a1Mirror.lines, '11-2107', 'dr').toFixed(2)).toBe('11000.00');
      expect(
        a1Mirror.lines.some((l) => l.accountCode === '21-1101' || l.accountCode === '21-1102'),
      ).toBe(false);

      // --- Phase 1 restores ยังทำงานครบ: สัญญาเก่า ACTIVE, เครื่องเก่ากลับ
      // FINANCE + costPrice restore (7,500 ≠ buyback 8,000 โดยตั้งใจ)
      const oldAfter = await prisma.contract.findUniqueOrThrow({
        where: { id: fix.oldContractId },
      });
      expect(oldAfter.status).toBe('ACTIVE');
      expect(oldAfter.exchangedAt).toBeNull();
      const oldProd = await prisma.product.findUniqueOrThrow({ where: { id: fix.oldProductId } });
      expect(oldProd.status).toBe('SOLD_INSTALLMENT');
      expect(oldProd.ownedByCompanyId).toBe(financeCompanyId);
      expect(new Decimal(oldProd.costPrice!.toString()).toFixed(2)).toBe('7500.00');
      const newAfter = await prisma.contract.findUniqueOrThrow({ where: { id: newContract.id } });
      expect(newAfter.status).toBe('CANCELED');
      expect(newAfter.exchangedFromContractId).toBeNull();
      const newProd = await prisma.product.findUniqueOrThrow({ where: { id: fix.newProductId } });
      expect(newProd.status).toBe('IN_STOCK');
      expect(newProd.ownedByCompanyId).toBe(shopCompanyId);

      // --- AuditLog: recallAmount = net เงินสดจริง (11,000 − 8,000) + AFTER_PAYOUT
      const audit = await prisma.auditLog.findFirst({
        where: { action: 'EXCHANGE_CANCELED', entityId: request.id },
        orderBy: { createdAt: 'desc' },
      });
      expect(audit).toBeTruthy();
      const newValue = audit!.newValue as Record<string, unknown>;
      expect(newValue.window).toBe('AFTER_PAYOUT');
      expect(newValue.recallAmount).toBe('3000.00');
      expect(newValue.batchNumbers).toEqual([batchRow.batchNumber]);
    },
    120_000,
  );

  // -------------------------------------------------------------------------
  it(
    'Task 5 guard: swap อยู่ใน batch DRAFT/PENDING_APPROVAL → reject บอกถอนรอบก่อน',
    async () => {
      const fix = await seedSwapFixture('100008', { schedule: 'NONE' });
      await act1a.execute(fix.oldContractId);
      const { newContract, request } = await seedNewContractAndRequest(fix, '100008', '8000');
      await activateAndFinalize(newContract.id, fix.newProductId);

      // Synthetic DRAFT batch + item (guard ไม่สน snapshot shape — pattern
      // เดียวกับ guard test ใน contract-cancellation.integration.spec.ts)
      const batch = await prisma.interCoSettlementBatch.create({
        data: {
          batchNumber: `IC-EXCHTEST-${Date.now()}`,
          status: 'DRAFT',
          transferDate: new Date(),
          financeBankCode: '11-1201',
          shopBankCode: 'S11-1201',
          totalFinanced: new Decimal('15000.00'),
          totalCommission: new Decimal('1500.00'),
          totalAmount: new Decimal('16500.00'),
          shopPostedAmount: new Decimal('16500.00'),
          makerId: adminId,
        },
      });
      createdBatchIds.push(batch.id);
      await prisma.interCoSettlementItem.create({
        data: {
          batchId: batch.id,
          contractId: newContract.id,
          financedGl: new Decimal('15000.00'),
          commissionGl: new Decimal('1500.00'),
          shopFinancedGl: new Decimal('15000.00'),
          shopCommissionGl: new Decimal('1500.00'),
        },
      });

      const err = await cancelSvc
        .cancel(request.id, 'ทดสอบ guard รอบจ่ายเปิด (Task 5)', {
          id: adminId,
          role: 'OWNER',
          branchId: null,
        })
        .then(
          () => null,
          (e: Error) => e,
        );
      expect(err, 'cancel must be rejected while the batch is open').toBeTruthy();
      expect(err!.message).toContain(batch.batchNumber);
      expect(err!.message).toContain('ถอน/ยกเลิกรอบก่อน');

      // Nothing changed: request still APPROVED, old still EXCHANGED, new still ACTIVE
      const reqAfter = await prisma.contractExchangeRequest.findUniqueOrThrow({
        where: { id: request.id },
      });
      expect(reqAfter.status).toBe('APPROVED');
      expect(reqAfter.reversalJeIds.length).toBe(0);
      const oldAfter = await prisma.contract.findUniqueOrThrow({
        where: { id: fix.oldContractId },
      });
      expect(oldAfter.status).toBe('EXCHANGED');
      const newAfter = await prisma.contract.findUniqueOrThrow({ where: { id: newContract.id } });
      expect(newAfter.status).toBe('ACTIVE');
    },
    120_000,
  );

  // -------------------------------------------------------------------------
  // Final review Phase 3 (Important 2ก): park guard 3 ถังบนสัญญาใหม่ — 6a fee
  // เข้าถังพักโดยไม่ set amountPaid จึงหลุด paid-guard เดิม (reschedule บนสัญญา
  // swap ที่ค้าง 45 วันคืองาน collections ปกติ). ยกเลิกทั้งที่เงินสดจริงยังค้าง
  // = ghost balance บนสัญญา CANCELED โดยไม่มีทางใช้/คืน.
  it(
    'final review: สัญญาใหม่มีเงินพักปรับดิว (6a) ค้าง → cancel reject ก่อนแตะ JE',
    async () => {
      const fix = await seedSwapFixture('100009', { schedule: 'NONE' });
      await act1a.execute(fix.oldContractId);
      const { newContract, request } = await seedNewContractAndRequest(fix, '100009', '8000');
      await activateAndFinalize(newContract.id, fix.newProductId);

      // 6a fee sim: เงินเข้าถังพักปรับดิวโดยไม่มี Payment.amountPaid ใดๆ
      await prisma.contract.update({
        where: { id: newContract.id },
        data: { rescheduleAdvanceBalance: new Decimal('100.00') },
      });

      const err = await cancelSvc
        .cancel(request.id, 'ทดสอบ park guard บนสัญญาใหม่ (final review)', {
          id: adminId,
          role: 'OWNER',
          branchId: null,
        })
        .then(
          () => null,
          (e: Error) => e,
        );
      expect(err, 'cancel must be rejected while park balances remain').toBeTruthy();
      expect(err!.message).toContain('เงินรับล่วงหน้า');

      // Reject ก่อน sweep — ไม่มี reversal JE, request ยัง APPROVED, สัญญาใหม่ยัง ACTIVE
      const reversals = await prisma.journalEntry.count({
        where: {
          AND: [
            { metadata: { path: ['flow'], equals: 'exchange-cancel' } as never },
            { metadata: { path: ['contractId'], equals: newContract.id } as never },
          ],
        },
      });
      expect(reversals).toBe(0);
      const reqAfter = await prisma.contractExchangeRequest.findUniqueOrThrow({
        where: { id: request.id },
      });
      expect(reqAfter.status).toBe('APPROVED');
      const newAfter = await prisma.contract.findUniqueOrThrow({ where: { id: newContract.id } });
      expect(newAfter.status).toBe('ACTIVE');
    },
    120_000,
  );

  // -------------------------------------------------------------------------
  // Final review Phase 3 (Important 2ข): positive cash tripwire — hand-JV
  // เงินสดที่ stamp metadata.contractId = สัญญาใหม่ อยู่ในชุด sweep candidates
  // ที่ engine จะ mirror (fabricate เงินสด) → ต้อง reject ระบุ entryNumber.
  // JE ปกติของ swap (A.1-A.5 / SHOP legs / 2A / provision) ไม่มีบัญชีเงินสด
  // จึงไม่ trip — tripwire คือชั้นกันของที่ไม่รู้จักเท่านั้น.
  it(
    'final review tripwire: hand-JV เงินสด stamped สัญญาใหม่ → cancel reject ระบุ entryNumber',
    async () => {
      const fix = await seedSwapFixture('100010', { schedule: 'NONE' });
      await act1a.execute(fix.oldContractId);
      const { newContract, request } = await seedNewContractAndRequest(fix, '100010', '8000');
      await activateAndFinalize(newContract.id, fix.newProductId);

      const zero = new Decimal(0);
      const jv = await journal.createAndPost({
        description: 'hand JV cash synthetic (EXCHTEST)',
        metadata: {
          flow: 'test-hand-jv-cash',
          idempotencyKey: `exjvc:${newContract.id}`,
          contractId: newContract.id,
        },
        lines: [
          { accountCode: '11-1101', dr: new Decimal('500'), cr: zero },
          { accountCode: '41-1102', dr: zero, cr: new Decimal('500') },
        ],
      });
      const jvEntryNumber = (
        await prisma.journalEntry.findUniqueOrThrow({ where: { id: jv.id } })
      ).entryNumber;

      const err = await cancelSvc
        .cancel(request.id, 'ทดสอบ tripwire เงินสด (final review)', {
          id: adminId,
          role: 'OWNER',
          branchId: null,
        })
        .then(
          () => null,
          (e: Error) => e,
        );
      expect(err, 'cancel must trip on an unknown cash JE').toBeTruthy();
      expect(err!.message).toContain(jvEntryNumber);
      expect(err!.message).toContain('เงินสด');

      // Reject ก่อน sweep เริ่ม — ไม่มีใบไหนถูก mirror เลย + request ยัง APPROVED
      const reversals = await prisma.journalEntry.count({
        where: {
          AND: [
            { metadata: { path: ['flow'], equals: 'exchange-cancel' } as never },
            { metadata: { path: ['contractId'], equals: newContract.id } as never },
          ],
        },
      });
      expect(reversals).toBe(0);
      const jvAfter = await prisma.journalEntry.findUniqueOrThrow({ where: { id: jv.id } });
      expect(((jvAfter.metadata ?? {}) as Record<string, unknown>).reversed).toBeUndefined();
      const reqAfter = await prisma.contractExchangeRequest.findUniqueOrThrow({
        where: { id: request.id },
      });
      expect(reqAfter.status).toBe('APPROVED');
    },
    120_000,
  );

  // -------------------------------------------------------------------------
  it(
    'MEMO: same model + price → zero new JEs, contract.productId swapped',
    async () => {
      const fix = await seedSwapFixture('100004', { schedule: 'NONE', memo: true });
      await act1a.execute(fix.oldContractId); // make the JE count meaningful

      const jeCountBefore = await prisma.journalEntry.count();

      const submitted = await svc.submit(
        {
          oldContractId: fix.oldContractId,
          oldProductId: fix.oldProductId,
          newProductId: fix.newProductId,
          conditionNote: 'จอแตก เปลี่ยนเครื่องรุ่นเดิม',
        } as never,
        { id: adminId, role: 'OWNER', branchId: null },
      );
      expect(submitted.mode).toBe('MEMO');
      expect(submitted.status).toBe('PENDING');
      createdRequestIds.push(submitted.id);

      const approved = await svc.approve(submitted.id, { id: adminId, role: 'OWNER', branchId: null }, {
        memoAddendumSigned: true,
        memoMdmSwapped: true,
      } as never);
      expect(approved.mode).toBe('MEMO');
      expect(approved.newContractId).toBeNull();

      // Zero accounting impact (workbook Case 1 — TFRS 9 modification)
      const jeCountAfter = await prisma.journalEntry.count();
      expect(jeCountAfter).toBe(jeCountBefore);

      // Device swapped in place on the SAME contract
      const contract = await prisma.contract.findUniqueOrThrow({
        where: { id: fix.oldContractId },
      });
      expect(contract.productId).toBe(fix.newProductId);
      expect(contract.status).toBe('ACTIVE');

      const oldProd = await prisma.product.findUniqueOrThrow({ where: { id: fix.oldProductId } });
      expect(oldProd.status).toBe('REFURBISHED');
      expect(oldProd.ownedByCompanyId).toBe(shopCompanyId);
      // New device inherits the old device's status + FINANCE ownership
      const newProd = await prisma.product.findUniqueOrThrow({ where: { id: fix.newProductId } });
      expect(newProd.status).toBe('SOLD_INSTALLMENT');
      expect(newProd.ownedByCompanyId).toBe(financeCompanyId);

      const req = await prisma.contractExchangeRequest.findUniqueOrThrow({
        where: { id: submitted.id },
      });
      expect(req.status).toBe('APPROVED');
      expect(req.memoAppliedAt).not.toBeNull();

      // Phase 5 Task 5 ข้อ 0 — audit ต้องมีแถวจริงใน DB. เดิม `audit.log` ถูก
      // await **ข้างใน** `$transaction` ของ approveMemo ⇒ `AuditService.log`
      // เปิด root-client `$transaction` ซ้อน ⇒ P2028 ⇒ log() กลืน error ทิ้ง
      // ⇒ ย้ายกรรมสิทธิ์เครื่องสองตัว + เปลี่ยน productId บนสัญญาโดยไม่มี audit
      // เลย (Task 4 พิสูจน์ไว้ว่า 0 แถวหลัง approve สำเร็จ 4 ครั้ง)
      const memoAudit = await prisma.auditLog.findFirst({
        where: { action: 'EXCHANGE_MEMO_APPLIED', entityId: submitted.id },
      });
      expect(memoAudit).toBeTruthy();
      const memoAuditValue = memoAudit!.newValue as Record<string, unknown>;
      expect(memoAuditValue.contractId).toBe(fix.oldContractId);
      expect(memoAuditValue.oldProductId).toBe(fix.oldProductId);
      expect(memoAuditValue.newProductId).toBe(fix.newProductId);
    },
    120_000,
  );

  // -------------------------------------------------------------------------
  // C1 (final review 2026-07-29): cancel → re-exchange must NOT be bricked.
  // Two failure modes existed: (a) the CANCELED EXCH- contract kept the @unique
  // exchangedFromContractId pointer → second approve's contract.create P2002;
  // (b) the first lifecycle's still-POSTED (mirror-reversed) A.2/A.4/A.5 JEs
  // held the contract-keyed idempotency slots → second finalize P2002. Fixed by
  // nulling the pointer at cancel + re-keying A.2/A.4/A.5 with request.id.
  it(
    'C1: re-exchange after cancel — same old contract submit→approve→finalize succeeds, 21-1106 nets 0 again',
    async () => {
      const fix = await seedSwapFixture('100005', { schedule: 'FUTURE12' });
      await act1a.execute(fix.oldContractId);

      // --- Lifecycle 1: finalize a PRICED swap, then cancel on day 5 (FREE)
      const first = await seedNewContractAndRequest(fix, '100005', '8000');
      await activateAndFinalize(first.newContract.id, fix.newProductId);
      await prisma.contract.update({
        where: { id: fix.oldContractId },
        data: { exchangedAt: new Date(Date.now() - 5 * DAY) },
      });
      const cancelResult = await cancelSvc.cancel(
        first.request.id,
        'ทดสอบยกเลิกก่อนเปลี่ยนเครื่องรอบสอง (integration C1)',
        { id: adminId, role: 'OWNER', branchId: null },
      );
      expect(cancelResult.cancelWindow).toBe('FREE');

      // Pointer nulled (C1a) — precondition for the second attempt
      const firstAfterCancel = await prisma.contract.findUniqueOrThrow({
        where: { id: first.newContract.id },
      });
      expect(firstAfterCancel.exchangedFromContractId).toBeNull();

      // --- Lifecycle 2: REAL submit → approve → finalize on the SAME old contract
      const submitted = await svc.submit(
        {
          oldContractId: fix.oldContractId,
          oldProductId: fix.oldProductId,
          newProductId: fix.newProductId, // back IN_STOCK after cancel
          buybackPrice: '8000',
          deviceCondition: 'A',
          newTotalMonths: 12,
          newInterestRate: '0.05',
          depositAccountCode: '11-1101',
        } as never,
        { id: adminId, role: 'OWNER', branchId: null },
      );
      createdRequestIds.push(submitted.id);
      expect(submitted.approvalTier).toBe('REVIEW'); // no valuation row

      // approve = contract.create with exchangedFromContractId = old id —
      // this is the exact statement that threw P2002 before the fix.
      const approved = await svc.approve(
        submitted.id,
        { id: adminId, role: 'OWNER', branchId: null },
        {},
      );
      expect(approved.newContractId).toBeTruthy();
      const secondContractId = approved.newContractId as string;
      createdContractIds.push(secondContractId);

      // finalize = A.2/A.4 (+A.5) post — request-scoped keys (C1b) must not
      // collide with lifecycle 1's still-POSTED mirror-reversed originals.
      await activateAndFinalize(secondContractId, fix.newProductId);

      const req2 = await prisma.contractExchangeRequest.findUniqueOrThrow({
        where: { id: submitted.id },
      });
      expect(req2.je1aId).toBeTruthy();
      expect(req2.je2Id).toBeTruthy();
      expect(req2.je3Id).toBeTruthy();
      expect(req2.je4Id).toBeTruthy();

      // 21-1106 nets 0 again across the SECOND A.2 (Dr) + A.3 (Cr)
      const je2Lines = await getJeLines(req2.je2Id!);
      const je3Lines = await getJeLines(req2.je3Id!);
      const dr1106 = sumSide(je2Lines, '21-1106', 'dr');
      expect(dr1106.toFixed(2)).toBe('8000.00');
      expect(dr1106.minus(sumSide(je3Lines, '21-1106', 'cr')).toFixed(2)).toBe('0.00');

      // Old-contract GL fully cleared again (originals + reversals + round 2).
      // (21-1106 is checked across je2/je3 lines above, not per-contract GL —
      // the offsetting Cr is tagged to the NEW contract via A.3, same as test 1.)
      for (const [code, side] of [
        ['11-2101', 'dr'],
        ['11-2105', 'dr'],
        ['11-2103', 'dr'],
        ['11-2106', 'cr'],
        ['21-2102', 'cr'],
      ] as const) {
        expect(
          (await glContractBalance(prisma, fix.oldContractId, code, side)).toFixed(2),
          `old-contract GL ${code} must net 0 after re-exchange finalize`,
        ).toBe('0.00');
      }

      const oldAfter = await prisma.contract.findUniqueOrThrow({
        where: { id: fix.oldContractId },
      });
      expect(oldAfter.status).toBe('EXCHANGED');
      const secondContract = await prisma.contract.findUniqueOrThrow({
        where: { id: secondContractId },
      });
      expect(secondContract.status).toBe('ACTIVE');
      expect(secondContract.exchangedFromContractId).toBe(fix.oldContractId);
    },
    120_000,
  );
});
