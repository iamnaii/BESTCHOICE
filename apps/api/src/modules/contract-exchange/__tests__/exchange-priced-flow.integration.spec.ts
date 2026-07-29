import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
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
import { ExchangeClearVendor21_1106Template } from '../../journal/cpa-templates/exchange-clear-vendor-21-1106.template';
import { ShopExchangeReturnTemplate } from '../../journal/cpa-templates/shop-exchange-return.template';
import { ExchangeEclReversalTemplate } from '../../journal/cpa-templates/exchange-ecl-reversal.template';
import { ExchangeCancelReversalTemplate } from '../../journal/cpa-templates/exchange-cancel-reversal.template';
import { ExchangeCancelPenaltyTemplate } from '../../journal/cpa-templates/exchange-cancel-penalty.template';
import { InstallmentAccrualCron } from '../../journal/cron/installment-accrual.cron';

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
 *      11,333.28 (1,416.66 × 8); loss plug 51-1102 = GL-derived 4,126.68.
 *   2. ECL — provision 30.32 on the old contract → A.5 Dr 11-2102 / Cr 42-1106
 *      30.32, BadDebtProvision row REVERSED, GL 11-2102 = 0.
 *   3. Cancel day-15 — every JE mirror-reversed (per-account net 0 across
 *      originals + reversals), penalty 400.00 (5% × 8,000) → 42-1107, old
 *      contract restored to ACTIVE, and the 2A cron backfills a missed
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
  new ExchangeClearVendor21_1106Template(journal, prisma as never),
  new ShopExchangeReturnTemplate(journal, prisma as never, companyResolver),
  new ExchangeEclReversalTemplate(journal, prisma as never),
  companyResolver,
);
const cancelSvc = new ExchangeCancelService(
  prisma as never,
  audit,
  companyResolver,
  new ExchangeCancelReversalTemplate(journal, prisma as never),
  new ExchangeCancelPenaltyTemplate(journal, prisma as never),
);
const accrualCron = new InstallmentAccrualCron(prisma as never, accrual2a);

// ---------------------------------------------------------------------------
// Tracked rows for SCOPED cleanup
// ---------------------------------------------------------------------------
const createdContractIds: string[] = [];
const createdProductIds: string[] = [];
const createdCustomerIds: string[] = [];
const createdRequestIds: string[] = [];
let createdBranchId: string | null = null;
let savedPenaltyPct: { value: string; label: string | null } | null = null;
let penaltyPctExisted = false;

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
      costPrice: new Decimal('8000.00'),
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
 * Plan mirrors computeExchangePlan(15,000, 12, 0.05):
 *   financed 15,000 + commission 1,500 + interest 9,000, VAT 1,785, monthly 2,273.75
 */
async function seedNewContractAndRequest(fix: SwapFixture, tag: string, buyback: string) {
  const newContract = await prisma.contract.create({
    data: {
      contractNumber: `EXCHTEST-NEW-${tag}-${Date.now()}`,
      customerId: fix.customerId,
      productId: fix.newProductId,
      branchId,
      salespersonId: adminId,
      planType: 'STORE_WITH_INTEREST',
      sellingPrice: new Decimal('15000.00'),
      downPayment: new Decimal('0.00'),
      financedAmount: new Decimal('15000.00'),
      interestRate: new Decimal('0.0500'),
      totalMonths: 12,
      interestTotal: new Decimal('9000.00'),
      storeCommission: new Decimal('1500.00'),
      vatAmount: new Decimal('1785.00'),
      vatPct: new Decimal('0.0700'),
      monthlyPayment: new Decimal('2273.75'),
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
      newMonthlyPayment: new Decimal('2273.75'),
      newInterestTotal: new Decimal('9000.00'),
      newVatAmount: new Decimal('1785.00'),
      newStoreCommission: new Decimal('1500.00'),
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

    // Deterministic penalty: capture + pin exchange_cancel_penalty_pct = 5,
    // restore original in afterAll (crash-safe upsert pattern — never delete
    // an operator's row mid-suite).
    const saved = await prisma.systemConfig.findUnique({
      where: { key: 'exchange_cancel_penalty_pct' },
    });
    penaltyPctExisted = !!saved;
    savedPenaltyPct = saved ? { value: saved.value, label: saved.label } : null;
    await prisma.systemConfig.upsert({
      where: { key: 'exchange_cancel_penalty_pct' },
      create: { key: 'exchange_cancel_penalty_pct', value: '5' },
      update: { value: '5' },
    });
  }, 120_000);

  afterAll(async () => {
    // Restore config FIRST (crash-safe ordering)
    if (penaltyPctExisted && savedPenaltyPct) {
      await prisma.systemConfig.update({
        where: { key: 'exchange_cancel_penalty_pct' },
        data: { value: savedPenaltyPct.value, label: savedPenaltyPct.label },
      });
    } else {
      await prisma.systemConfig.deleteMany({ where: { key: 'exchange_cancel_penalty_pct' } });
    }

    // Collect every JE this spec produced: (a) anything stamped
    // metadata.contractId with one of our contracts (1A/2A/receipt-sims/A.1-A.3/
    // A.5/penalty/provision-seed + their mirrors), (b) request-linked ids —
    // covers A.4 (no metadata.contractId) and its reversal via reversalJeIds.
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
      expect(sumSide(je2Lines, '41-1101', 'cr').toFixed(2)).toBe('4000.00');
      expect(sumSide(je2Lines, '11-2106', 'dr').toFixed(2)).toBe('4000.00');
      expect(sumSide(je2Lines, '21-2102', 'dr').toFixed(2)).toBe('793.32');
      // Loss plug = threshold (11,333.36 + 793.32) − buyback 8,000 = GL-true 4,126.68
      expect(sumSide(je2Lines, '51-1102', 'dr').toFixed(2)).toBe('4126.68');

      // --- A.3: vendor clearance + cash top-up (16,500 − 8,000 = 8,500)
      expect(sumSide(je3Lines, '21-1101', 'dr').toFixed(2)).toBe('15000.00');
      expect(sumSide(je3Lines, '21-1102', 'dr').toFixed(2)).toBe('1500.00');
      expect(sumSide(je3Lines, '11-1101', 'cr').toFixed(2)).toBe('8500.00');

      // --- A.4: SHOP re-intake at costPrice, posted under SHOP company
      const je4 = await prisma.journalEntry.findUniqueOrThrow({
        where: { id: req.je4Id! },
        include: { lines: true },
      });
      expect(je4.companyId).toBe(shopCompanyId);
      expect(sumSide(je4.lines, 'S11-2002', 'dr').toFixed(2)).toBe('8000.00');
      expect(sumSide(je4.lines, 'S50-1102', 'cr').toFixed(2)).toBe('8000.00');

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
    },
    120_000,
  );

  // -------------------------------------------------------------------------
  it(
    'ECL: old contract carries provision 30.32 → A.5 Dr 11-2102 / Cr 42-1106 = 30.32 + BadDebtProvision REVERSED',
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
      expect(sumSide(je5.lines, '42-1106', 'cr').toFixed(2)).toBe('30.32');
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
    'Cancel day-15: all JEs mirror-reversed (per-account net 0), penalty 400.00 → 42-1107, old ACTIVE + 2A cron backfills',
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

      const { newContract, request } = await seedNewContractAndRequest(fix, '100003', '8000');
      await activateAndFinalize(newContract.id, fix.newProductId);

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

      // --- Backdate the swap 15 days → PENALTY_8_30D window, then REAL cancel
      await prisma.contract.update({
        where: { id: fix.oldContractId },
        data: { exchangedAt: new Date(Date.now() - 15 * DAY) },
      });
      const result = await cancelSvc.cancel(
        request.id,
        'ทดสอบยกเลิกเปลี่ยนเครื่องภายในวันที่ 15 (integration)',
        { id: adminId, role: 'OWNER', branchId: null },
      );
      expect(result.cancelWindow).toBe('PENALTY_8_30D');
      expect(result.penaltyAmount).toBe('400.00'); // 5% × 8,000

      const req = await prisma.contractExchangeRequest.findUniqueOrThrow({
        where: { id: request.id },
      });
      expect(req.status).toBe('CANCELED');
      expect(req.reversalJeIds.length).toBe(4); // A.1 + A.2 + A.3 + A.4 (no A.5 here)
      expect(req.penaltyJeId).toBeTruthy();

      // --- Penalty JE: Dr cash 400.00 / Cr 42-1107 400.00
      const penaltyLines = await getJeLines(req.penaltyJeId!);
      expect(sumSide(penaltyLines, '11-1101', 'dr').toFixed(2)).toBe('400.00');
      expect(sumSide(penaltyLines, '42-1107', 'cr').toFixed(2)).toBe('400.00');

      // --- Mirror-reverse completeness: originals + reversals net 0 per account
      const pairIds = [req.je1aId!, req.je2Id!, req.je3Id!, req.je4Id!, ...req.reversalJeIds];
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

      // --- New-contract GL: everything nets 0
      for (const [code, side] of [
        ['11-2101', 'dr'],
        ['11-2105', 'dr'],
        ['11-2106', 'cr'],
        ['21-2102', 'cr'],
        ['21-1101', 'cr'],
        ['21-1102', 'cr'],
        ['21-1106', 'cr'],
        ['11-1101', 'dr'],
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

      // --- Lifecycle 1: finalize a PRICED swap, then cancel on day 5 (FREE_7D)
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
      expect(cancelResult.cancelWindow).toBe('FREE_7D');

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
