/**
 * Task 2 integration test — collectedByShop routes early-payoff Dr to 11-2107
 *
 * Runner: vitest (DB-backed, *.integration.spec.ts is jest-ignored)
 * Run:    cd apps/api && npx vitest run --no-file-parallelism src/modules/contracts/shop-collect-payoff.integration.spec.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { seedFinanceCoa } from '../../../prisma/seed-coa-finance';
import { seedStandard17k12m } from '../journal/__tests__/scenario-helpers';
import { ContractActivation1ATemplate } from '../journal/cpa-templates/contract-activation-1a.template';
import { JournalAutoService } from '../journal/journal-auto.service';
import { ContractPaymentService } from './contract-payment.service';
import { ProductsService } from '../products/products.service';
import { EarlyPayoffJP4Template } from '../journal/cpa-templates/early-payoff-jp4.template';
import { Vat60dayReversalTemplate } from '../journal/cpa-templates/vat-60day-reversal.template';
import { ShopCollectSettlementTemplate } from '../journal/cpa-templates/shop-collect-settlement.template';

const prisma = new PrismaClient();
const CASH_ACCOUNT_CODES = ['11-1101', '11-1102', '11-1103', '11-1201', '11-1202', '11-1203'];

function buildService(): ContractPaymentService {
  const journal = new JournalAutoService(prisma as any);
  const vat60Reversal = new Vat60dayReversalTemplate(journal, prisma as any);
  const jp4 = new EarlyPayoffJP4Template(journal, prisma as any, vat60Reversal);
  const products = new ProductsService(prisma as any);
  const settlementTemplate = new ShopCollectSettlementTemplate(journal, prisma as any);
  return new ContractPaymentService(prisma as any, products, journal, jp4, settlementTemplate);
}

async function ensureFinanceCompany(): Promise<void> {
  const existing = await prisma.companyInfo.findFirst({ where: { companyCode: 'FINANCE' } });
  if (!existing) {
    await prisma.companyInfo.create({
      data: {
        nameTh: 'BESTCHOICE FINANCE',
        taxId: '0000000000002',
        companyCode: 'FINANCE',
        address: '1 Finance Rd.',
        directorName: 'Test Director',
        vatRegistered: true,
        vatRate: new Decimal('0.0700'),
      },
    });
  }
}

async function ensureAdminUser(): Promise<string> {
  let admin = await prisma.user.findFirst({ where: { email: 'admin@bestchoice.com' } });
  if (!admin) {
    admin = await prisma.user.create({
      data: { email: 'admin@bestchoice.com', password: 'x', name: 'admin', role: 'OWNER' },
    });
  }
  return admin.id;
}

/**
 * Seed PENDING Payment rows for all installments of a contract.
 * The earlyPayoff service method operates on payment rows
 * (not installmentSchedule directly) — without these rows, unpaidCount = 0
 * and the JE amounts are all zero.
 * Mirror the pattern from bad-debt.streak-provision.integration.spec.ts.
 */
async function seedPendingPayments(contractId: string, installmentCount: number): Promise<void> {
  const installmentTotal = new Decimal('1515.83');
  const startDate = new Date('2025-01-01');
  for (let installmentNo = 1; installmentNo <= installmentCount; installmentNo++) {
    const dueDate = new Date(startDate);
    dueDate.setMonth(dueDate.getMonth() + installmentNo);
    await prisma.payment.upsert({
      where: { contractId_installmentNo: { contractId, installmentNo } },
      create: {
        contractId,
        installmentNo,
        amountDue: installmentTotal,
        amountPaid: new Decimal('0'),
        dueDate,
        status: 'PENDING',
      },
      update: {
        amountDue: installmentTotal,
        amountPaid: new Decimal('0'),
        dueDate,
        status: 'PENDING',
      },
    });
  }
}

/**
 * Fetch the early-payoff JE (tagged flow='early-payoff') for a contract.
 * Returns { lines, metadata }.
 */
async function getEarlyPayoffJe(contractId: string) {
  const entries = await prisma.journalEntry.findMany({
    where: {
      AND: [
        { metadata: { path: ['contractId'], equals: contractId } } as any,
        { metadata: { path: ['flow'], equals: 'early-payoff' } } as any,
      ],
    },
    include: { lines: true },
  });
  expect(entries.length, 'expected exactly 1 early-payoff JE').toBe(1);
  return entries[0];
}

describe('shop-collect-payoff integration', () => {
  let userId: string;

  /** FK-safe cleanup to avoid leaking rows into other specs.
   *  NOTE: auditLog is immutable (T2-C4 trigger) — cannot delete; omit it.
   *  Cleanup order: lines → entries → payments → schedules → contracts (FK-safe).
   */
  afterAll(async () => {
    await prisma.journalLine.deleteMany({});
    await prisma.journalEntry.deleteMany({});
    await prisma.payment.deleteMany({});
    await prisma.installmentSchedule.deleteMany({});
    await prisma.contract.deleteMany({});
    await prisma.$disconnect();
  });

  beforeAll(async () => {
    // Clean slate (auditLog is immutable — skip it)
    await prisma.journalLine.deleteMany({});
    await prisma.journalEntry.deleteMany({});
    await prisma.payment.deleteMany({});
    await prisma.installmentSchedule.deleteMany({});
    await prisma.contract.deleteMany({});

    await seedFinanceCoa(prisma);
    await ensureFinanceCompany();
    userId = await ensureAdminUser();
  });

  it('SHOP-COLLECT: Dr 11-2107 = settlement, no cash Dr line, JE balanced', async () => {
    // Activate a standard 17K/12M contract
    const c = await seedStandard17k12m(prisma);
    const journal = new JournalAutoService(prisma as any);
    await new ContractActivation1ATemplate(journal, prisma as any).execute(c.id);

    // Seed PENDING payment rows — earlyPayoff counts unpaidPayments from Payment table,
    // not InstallmentSchedule. Without these rows, unpaidCount=0 and all JE amounts=0.
    await seedPendingPayments(c.id, c.installmentCount);

    // Call earlyPayoff with collectedByShop=true
    const svc = buildService();
    await svc.earlyPayoff(c.id, userId, {
      paymentMethod: 'CASH',
      discountPct: 50,
      collectedByShop: true,
    } as any);

    // Fetch the early-payoff JE
    const je = await getEarlyPayoffJe(c.id);

    // Assert: Dr 11-2107 exists with non-zero debit (= settlement amount)
    const dr11_2107 = je.lines.find((l) => l.accountCode === '11-2107');
    expect(dr11_2107, 'Expected a Dr 11-2107 line on the early-payoff JE').toBeDefined();
    expect(
      new Decimal(dr11_2107!.debit.toString()).gt(0),
      `Dr 11-2107 should be > 0, got ${dr11_2107!.debit.toString()}`,
    ).toBe(true);
    expect(
      new Decimal(dr11_2107!.credit.toString()).toNumber(),
      'Cr side of 11-2107 should be 0',
    ).toBe(0);

    // Assert: NO cash-account Dr line
    const cashDrLine = je.lines.find(
      (l) => CASH_ACCOUNT_CODES.includes(l.accountCode) && new Decimal(l.debit.toString()).gt(0),
    );
    expect(
      cashDrLine,
      'There should be NO cash-account Dr line when collectedByShop=true',
    ).toBeUndefined();

    // Assert: JE is balanced (totalDr === totalCr within ±0.01)
    const totalDr = je.lines.reduce(
      (s, l) => s.plus(new Decimal(l.debit.toString())),
      new Decimal(0),
    );
    const totalCr = je.lines.reduce(
      (s, l) => s.plus(new Decimal(l.credit.toString())),
      new Decimal(0),
    );
    expect(
      totalDr.minus(totalCr).abs().lte('0.01'),
      `JE should be balanced: Dr=${totalDr.toFixed(2)} Cr=${totalCr.toFixed(2)}`,
    ).toBe(true);
    expect(totalDr.gt(0), 'JE totalDr must be > 0').toBe(true);

    // Assert: metadata stamps present
    const meta = je.metadata as Record<string, unknown>;
    expect(meta.collectedByShop, 'metadata.collectedByShop should be true').toBe(true);
    expect(meta.shopReceivable, 'metadata.shopReceivable should be 11-2107').toBe('11-2107');
  });

  it('QUOTE: getEarlyPayoffQuote with depositAccountCode=11-2107 returns journalPreview with Dr 11-2107 line', async () => {
    const c3 = await seedStandard17k12m(prisma);
    const journal = new JournalAutoService(prisma as any);
    await new ContractActivation1ATemplate(journal, prisma as any).execute(c3.id);
    await seedPendingPayments(c3.id, c3.installmentCount);

    const svc = buildService();
    const quote = await svc.getEarlyPayoffQuote(c3.id, 50, '11-2107');

    // journalPreview.lines should contain a Dr 11-2107 line (debit > 0)
    const dr11_2107 = quote.journalPreview.lines.find(
      (l: { accountCode: string; debit: string }) =>
        l.accountCode === '11-2107' && new Decimal(l.debit).gt(0),
    );
    expect(dr11_2107, 'getEarlyPayoffQuote preview should include Dr 11-2107 when depositCode=11-2107').toBeDefined();

    // JE preview should be balanced
    expect(
      quote.journalPreview.isBalanced,
      'Quote journalPreview should be balanced',
    ).toBe(true);

    // No cash-account Dr line in preview
    const cashDrLine = quote.journalPreview.lines.find(
      (l: { accountCode: string; debit: string }) =>
        CASH_ACCOUNT_CODES.includes(l.accountCode) && new Decimal(l.debit).gt(0),
    );
    expect(cashDrLine, 'No cash Dr line should appear when 11-2107 is the deposit code').toBeUndefined();
  });

  it('FINANCE-DIRECT: WITHOUT collectedByShop, Dr lands on cash account (unchanged behaviour)', async () => {
    const c2 = await seedStandard17k12m(prisma);
    const journal = new JournalAutoService(prisma as any);
    await new ContractActivation1ATemplate(journal, prisma as any).execute(c2.id);

    // Seed PENDING payments for the FINANCE-direct contract as well
    await seedPendingPayments(c2.id, c2.installmentCount);

    const svc = buildService();
    await svc.earlyPayoff(c2.id, userId, {
      paymentMethod: 'CASH',
      discountPct: 50,
      depositAccountCode: '11-1101',
      // collectedByShop intentionally omitted
    } as any);

    const je = await getEarlyPayoffJe(c2.id);

    // Assert: cash account Dr exists
    const cashDrLine = je.lines.find(
      (l) => l.accountCode === '11-1101' && new Decimal(l.debit.toString()).gt(0),
    );
    expect(cashDrLine, 'FINANCE-direct: Dr 11-1101 should be present').toBeDefined();

    // Assert: NO 11-2107 Dr line
    const dr11_2107 = je.lines.find(
      (l) => l.accountCode === '11-2107' && new Decimal(l.debit.toString()).gt(0),
    );
    expect(dr11_2107, 'FINANCE-direct: 11-2107 Dr should NOT appear').toBeUndefined();
  });
});
