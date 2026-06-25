/**
 * Task 3 integration test — shop-collect settlement (Dr cash / Cr 11-2107)
 *
 * Runner: vitest (DB-backed, *.integration.spec.ts is jest-ignored)
 * Run:    cd apps/api && npx vitest run --no-file-parallelism src/modules/contracts/shop-collect-settlement.integration.spec.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { BadRequestException } from '@nestjs/common';
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
 * Compute the net 11-2107 balance (ΣDr − ΣCr) over all POSTED journal lines
 * whose parent JE has metadata.contractId === contractId.
 */
async function getNet11_2107(contractId: string): Promise<Decimal> {
  const lines = await prisma.journalLine.findMany({
    where: {
      accountCode: '11-2107',
      journalEntry: {
        AND: [
          { metadata: { path: ['contractId'], equals: contractId } } as any,
          { deletedAt: null },
        ],
      },
    },
    select: { debit: true, credit: true },
  });
  const totalDr = lines.reduce((s, l) => s.plus(new Decimal(l.debit.toString())), new Decimal(0));
  const totalCr = lines.reduce((s, l) => s.plus(new Decimal(l.credit.toString())), new Decimal(0));
  return totalDr.minus(totalCr);
}

describe('shop-collect-settlement integration', () => {
  let userId: string;
  let svc: ContractPaymentService;

  afterAll(async () => {
    await prisma.journalLine.deleteMany({});
    await prisma.journalEntry.deleteMany({});
    await prisma.payment.deleteMany({});
    await prisma.installmentSchedule.deleteMany({});
    await prisma.contract.deleteMany({});
    await prisma.$disconnect();
  });

  beforeAll(async () => {
    // Clean slate
    await prisma.journalLine.deleteMany({});
    await prisma.journalEntry.deleteMany({});
    await prisma.payment.deleteMany({});
    await prisma.installmentSchedule.deleteMany({});
    await prisma.contract.deleteMany({});

    await seedFinanceCoa(prisma);
    await ensureFinanceCompany();
    userId = await ensureAdminUser();
    svc = buildService();
  });

  it('SETTLEMENT: Dr 11-1201 / Cr 11-2107 zeroes the shop receivable balance', async () => {
    // 1. Activate a contract via Task 2 shop-collect flow → creates Dr 11-2107 balance
    const c = await seedStandard17k12m(prisma);
    const journal = new JournalAutoService(prisma as any);
    await new ContractActivation1ATemplate(journal, prisma as any).execute(c.id);
    await seedPendingPayments(c.id, c.installmentCount);

    await svc.earlyPayoff(c.id, userId, {
      paymentMethod: 'CASH',
      discountPct: 50,
      collectedByShop: true,
    } as any);

    // Confirm there is a positive 11-2107 balance after shop-collect payoff
    const balanceBefore = await getNet11_2107(c.id);
    expect(
      balanceBefore.gt(0),
      `Expected Dr 11-2107 balance > 0 after shop-collect payoff, got ${balanceBefore.toFixed(2)}`,
    ).toBe(true);

    const settlementAmount = balanceBefore;

    // 2. Call settlement service — Dr 11-1201 / Cr 11-2107
    await svc.shopCollectSettlement(c.id, userId, {
      depositAccountCode: '11-1201',
      amount: settlementAmount.toNumber(),
    });

    // 3. Assert: net 11-2107 balance returns to 0
    const balanceAfter = await getNet11_2107(c.id);
    expect(
      balanceAfter.abs().lte('0.01'),
      `Expected net 11-2107 ≈ 0 after settlement, got ${balanceAfter.toFixed(2)}`,
    ).toBe(true);

    // 4. Assert: a balanced Dr 11-1201 / Cr 11-2107 JE was posted
    const settlementJe = await prisma.journalEntry.findFirst({
      where: {
        AND: [
          { metadata: { path: ['flow'], equals: 'shop-collect-settlement' } } as any,
          { metadata: { path: ['contractId'], equals: c.id } } as any,
        ],
        deletedAt: null,
      },
      include: { lines: true },
    });
    expect(settlementJe, 'Expected settlement JE to be created').not.toBeNull();

    const drLine = settlementJe!.lines.find(
      (l) => l.accountCode === '11-1201' && new Decimal(l.debit.toString()).gt(0),
    );
    expect(drLine, 'Expected Dr 11-1201 line in settlement JE').toBeDefined();

    const crLine = settlementJe!.lines.find(
      (l) => l.accountCode === '11-2107' && new Decimal(l.credit.toString()).gt(0),
    );
    expect(crLine, 'Expected Cr 11-2107 line in settlement JE').toBeDefined();

    // Assert JE is balanced
    const totalDr = settlementJe!.lines.reduce(
      (s, l) => s.plus(new Decimal(l.debit.toString())),
      new Decimal(0),
    );
    const totalCr = settlementJe!.lines.reduce(
      (s, l) => s.plus(new Decimal(l.credit.toString())),
      new Decimal(0),
    );
    expect(
      totalDr.minus(totalCr).abs().lte('0.01'),
      `Settlement JE must be balanced: Dr=${totalDr.toFixed(2)} Cr=${totalCr.toFixed(2)}`,
    ).toBe(true);
  });

  it('OVER-SETTLE GUARD: amount > outstanding + 0.01 → BadRequestException', async () => {
    // Activate + payoff a second contract
    const c2 = await seedStandard17k12m(prisma);
    const journal = new JournalAutoService(prisma as any);
    await new ContractActivation1ATemplate(journal, prisma as any).execute(c2.id);
    await seedPendingPayments(c2.id, c2.installmentCount);

    await svc.earlyPayoff(c2.id, userId, {
      paymentMethod: 'CASH',
      discountPct: 50,
      collectedByShop: true,
    } as any);

    const outstanding = await getNet11_2107(c2.id);
    const overAmount = outstanding.plus('100').toNumber(); // definitely > outstanding + 0.01

    await expect(
      svc.shopCollectSettlement(c2.id, userId, {
        depositAccountCode: '11-1201',
        amount: overAmount,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('VOID REGRESSION: voided shop-collect payoff JE → outstanding = 0 → settlement throws BadRequestException', async () => {
    // 1. Activate a contract + shop-collect payoff → creates Dr 11-2107 balance
    const cVoid = await seedStandard17k12m(prisma);
    const journalVoid = new JournalAutoService(prisma as any);
    await new ContractActivation1ATemplate(journalVoid, prisma as any).execute(cVoid.id);
    await seedPendingPayments(cVoid.id, cVoid.installmentCount);

    await svc.earlyPayoff(cVoid.id, userId, {
      paymentMethod: 'CASH',
      discountPct: 50,
      collectedByShop: true,
    } as any);

    // Confirm positive 11-2107 balance exists before voiding
    const balanceBeforeVoid = await getNet11_2107(cVoid.id);
    expect(balanceBeforeVoid.gt(0), `Expected 11-2107 balance > 0 after shop-collect payoff, got ${balanceBeforeVoid.toFixed(2)}`).toBe(true);

    // 2. VOID the early-payoff journal entry (simulates VOIDED status via DB update)
    const payoffJe = await prisma.journalEntry.findFirst({
      where: {
        AND: [
          { metadata: { path: ['contractId'], equals: cVoid.id } } as any,
          { metadata: { path: ['flow'], equals: 'early-payoff' } } as any,
          { deletedAt: null },
        ],
      },
    });
    expect(payoffJe, 'Expected a jp4 early-payoff JE to exist').not.toBeNull();

    await prisma.journalEntry.update({
      where: { id: payoffJe!.id },
      data: { status: 'VOIDED' },
    });

    // 3. The outstanding-balance query now filters POSTED only → balance = 0
    //    → settlement must throw BadRequestException (no-balance guard)
    await expect(
      svc.shopCollectSettlement(cVoid.id, userId, {
        depositAccountCode: '11-1201',
        amount: balanceBeforeVoid.toNumber(),
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('NO-BALANCE GUARD: settling a contract with no 11-2107 balance → BadRequestException', async () => {
    // A regular (non-shop-collect) payoff contract — no 11-2107 line
    const c3 = await seedStandard17k12m(prisma);
    const journal = new JournalAutoService(prisma as any);
    await new ContractActivation1ATemplate(journal, prisma as any).execute(c3.id);
    await seedPendingPayments(c3.id, c3.installmentCount);

    // FINANCE-direct payoff (no 11-2107)
    await svc.earlyPayoff(c3.id, userId, {
      paymentMethod: 'CASH',
      discountPct: 50,
      depositAccountCode: '11-1101',
    } as any);

    // Try to settle — should throw because outstanding = 0
    await expect(
      svc.shopCollectSettlement(c3.id, userId, {
        depositAccountCode: '11-1201',
        amount: 100,
      }),
    ).rejects.toThrow(BadRequestException);
  });
});
