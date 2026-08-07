/**
 * Task 3 integration test — shop-collect settlement (Dr cash / Cr 11-2107)
 *
 * Runner: vitest (DB-backed, *.integration.spec.ts is jest-ignored)
 * Run:    cd apps/api && npx vitest run --no-file-parallelism src/modules/contracts/shop-collect-settlement.integration.spec.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { seedFinanceCoa } from '../../../prisma/seed-coa-finance';
import { seedStandard17k12m } from '../journal/__tests__/scenario-helpers';
import { ContractActivation1ATemplate } from '../journal/cpa-templates/contract-activation-1a.template';
import { JournalAutoService } from '../journal/journal-auto.service';
import { ContractPaymentService } from './contract-payment.service';
import { ProductsService } from '../products/products.service';
import { EarlyPayoffJP4Template } from '../journal/cpa-templates/early-payoff-jp4.template';
import { Vat60dayReversalTemplate } from '../journal/cpa-templates/vat-60day-reversal.template';
import { ShopCollectSettlementTemplate } from '../journal/cpa-templates/shop-collect-settlement.template';
import { EclStageReverseTemplate } from '../journal/cpa-templates/ecl-stage-reverse.template';

const prisma = new PrismaClient();

function buildService(): ContractPaymentService {
  const journal = new JournalAutoService(prisma as any);
  const vat60Reversal = new Vat60dayReversalTemplate(journal, prisma as any);
  const jp4 = new EarlyPayoffJP4Template(journal, prisma as any, vat60Reversal);
  const products = new ProductsService(prisma as any);
  const settlementTemplate = new ShopCollectSettlementTemplate(journal, prisma as any);
  const eclStageReverseTemplate = new EclStageReverseTemplate(journal, prisma as any);
  return new ContractPaymentService(prisma as any, products, journal, jp4, settlementTemplate, { generateReceipt: async () => undefined } as any, eclStageReverseTemplate);
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
    // JournalPostAuditLog rows (asset flows) FK-reference journal_entries — clear
    // them first or this deleteMany trips P2003 when an asset spec ran earlier.
    await prisma.journalPostAuditLog.deleteMany({});
    await prisma.journalLine.deleteMany({});
    await prisma.journalEntry.deleteMany({});
    await prisma.payment.deleteMany({});
    await prisma.installmentSchedule.deleteMany({});
    // T1-C7 guard: see cn-issue-on-writeoff.spec.ts (Phase 3 Task 3) — a
    // contract written off via the real writeOffBadDebt() has a permanent
    // (immutable) badDebtWriteOffAuditLog row FK-referencing it.
    const woPoisoned = await prisma.badDebtWriteOffAuditLog.findMany({ select: { contractId: true } });
    await prisma.contract.deleteMany({ where: { id: { notIn: woPoisoned.map((p) => p.contractId) } } });
    await prisma.$disconnect();
  });

  beforeAll(async () => {
    // Clean slate
    // JournalPostAuditLog rows (asset flows) FK-reference journal_entries — clear
    // them first or this deleteMany trips P2003 when an asset spec ran earlier.
    await prisma.journalPostAuditLog.deleteMany({});
    await prisma.journalLine.deleteMany({});
    await prisma.journalEntry.deleteMany({});
    await prisma.payment.deleteMany({});
    await prisma.installmentSchedule.deleteMany({});
    // T1-C7 guard: see cn-issue-on-writeoff.spec.ts (Phase 3 Task 3) — a
    // contract written off via the real writeOffBadDebt() has a permanent
    // (immutable) badDebtWriteOffAuditLog row FK-referencing it.
    const woPoisoned = await prisma.badDebtWriteOffAuditLog.findMany({ select: { contractId: true } });
    await prisma.contract.deleteMany({ where: { id: { notIn: woPoisoned.map((p) => p.contractId) } } });

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

  it('PARTIAL REMITTANCE: two partial settlements each post a balanced Dr cash / Cr 11-2107 JE and net 11-2107 ends at 0', async () => {
    // 1. Activate + shop-collect payoff → creates a Dr 11-2107 balance (= outstanding S)
    const cPartial = await seedStandard17k12m(prisma);
    const journalPartial = new JournalAutoService(prisma as any);
    await new ContractActivation1ATemplate(journalPartial, prisma as any).execute(cPartial.id);
    await seedPendingPayments(cPartial.id, cPartial.installmentCount);

    await svc.earlyPayoff(cPartial.id, userId, {
      paymentMethod: 'CASH',
      discountPct: 50,
      collectedByShop: true,
    } as any);

    const outstanding = await getNet11_2107(cPartial.id);
    expect(outstanding.gt(0), `Expected 11-2107 balance > 0 after shop-collect payoff, got ${outstanding.toFixed(2)}`).toBe(true);

    // Split into two DIFFERENT partial amounts A and (S − A).
    // Use 1/3 rounded down so amountA ≠ amountB (avoids the idempotency guard
    // which keys on contractId + amount — same amount on same contract is treated
    // as a double-submit and is correctly skipped).
    const amountA = outstanding.div(3).toDecimalPlaces(2, Decimal.ROUND_DOWN);
    const amountB = outstanding.minus(amountA);

    // 2. First partial settlement (amount = A < S)
    const result1 = await svc.shopCollectSettlement(cPartial.id, userId, {
      depositAccountCode: '11-1201',
      amount: amountA.toNumber(),
    });
    expect(result1, 'First partial settlement should return an entryNo').toBeDefined();

    // Mid-point: outstanding should now be S − A
    const midBalance = await getNet11_2107(cPartial.id);
    expect(
      midBalance.minus(amountB).abs().lte('0.01'),
      `Expected mid-point 11-2107 balance ≈ ${amountB.toFixed(2)}, got ${midBalance.toFixed(2)}`,
    ).toBe(true);

    // 3. Second partial settlement (amount = S − A)
    const result2 = await svc.shopCollectSettlement(cPartial.id, userId, {
      depositAccountCode: '11-1201',
      amount: amountB.toNumber(),
    });
    expect(result2, 'Second partial settlement should return an entryNo').toBeDefined();

    // 4. Net 11-2107 must be 0 after both partials
    const finalBalance = await getNet11_2107(cPartial.id);
    expect(
      finalBalance.abs().lte('0.01'),
      `Expected net 11-2107 ≈ 0 after both partial settlements, got ${finalBalance.toFixed(2)}`,
    ).toBe(true);

    // 5. Both JEs should exist, each balanced
    const settlementJes = await prisma.journalEntry.findMany({
      where: {
        AND: [
          { metadata: { path: ['flow'], equals: 'shop-collect-settlement' } } as any,
          { metadata: { path: ['contractId'], equals: cPartial.id } } as any,
        ],
        deletedAt: null,
      },
      include: { lines: true },
    });
    expect(settlementJes.length).toBe(2);

    for (const je of settlementJes) {
      const drSum = je.lines.reduce((s, l) => s.plus(new Decimal(l.debit.toString())), new Decimal(0));
      const crSum = je.lines.reduce((s, l) => s.plus(new Decimal(l.credit.toString())), new Decimal(0));
      expect(
        drSum.minus(crSum).abs().lte('0.01'),
        `Settlement JE ${je.entryNumber} must be balanced: Dr=${drSum.toFixed(2)} Cr=${crSum.toFixed(2)}`,
      ).toBe(true);

      const drLine = je.lines.find((l) => l.accountCode === '11-1201' && new Decimal(l.debit.toString()).gt(0));
      expect(drLine, `Expected Dr 11-1201 line in settlement JE ${je.entryNumber}`).toBeDefined();

      const crLine = je.lines.find((l) => l.accountCode === '11-2107' && new Decimal(l.credit.toString()).gt(0));
      expect(crLine, `Expected Cr 11-2107 line in settlement JE ${je.entryNumber}`).toBeDefined();
    }
  });

  it('requestId ต่างกัน ยอดเท่ากัน → post 2 JE (โอนซ้ำยอดเท่ากันโดยตั้งใจต้องไม่หาย)', async () => {
    // Seed a fresh contract with its OWN Dr 11-2107 balance — never reuse another
    // case's contract, the 11-2107 balances would mix across cases.
    const cPartial2 = await seedStandard17k12m(prisma);
    const journalPartial2 = new JournalAutoService(prisma as any);
    await new ContractActivation1ATemplate(journalPartial2, prisma as any).execute(cPartial2.id);
    await seedPendingPayments(cPartial2.id, cPartial2.installmentCount);

    await svc.earlyPayoff(cPartial2.id, userId, {
      paymentMethod: 'CASH',
      discountPct: 50,
      collectedByShop: true,
    } as any);

    const outstanding = await getNet11_2107(cPartial2.id);
    expect(outstanding.gt(0), `Expected 11-2107 balance > 0, got ${outstanding.toFixed(2)}`).toBe(true);

    // Same amount posted twice (equal halves — floor-rounded so the second call
    // never exceeds the remaining outstanding).
    const amount = outstanding.div(2).toDecimalPlaces(2, Decimal.ROUND_DOWN);

    await svc.shopCollectSettlement(cPartial2.id, userId, {
      depositAccountCode: '11-1201',
      amount: amount.toNumber(),
      requestId: '11111111-1111-4111-8111-111111111111',
    });
    await svc.shopCollectSettlement(cPartial2.id, userId, {
      depositAccountCode: '11-1201',
      amount: amount.toNumber(),
      requestId: '22222222-2222-4222-8222-222222222222',
    });

    const jes = await prisma.journalEntry.findMany({
      where: {
        AND: [
          { metadata: { path: ['flow'], equals: 'shop-collect-settlement' } } as any,
          { metadata: { path: ['contractId'], equals: cPartial2.id } } as any,
        ],
        deletedAt: null,
      },
    });
    expect(jes).toHaveLength(2);
  });

  it('requestId เดิมซ้ำ → JE เดียว (retry ปลอดภัย แม้หลังยอดถูกล้างหมดแล้ว)', async () => {
    const cRetry = await seedStandard17k12m(prisma);
    const journalRetry = new JournalAutoService(prisma as any);
    await new ContractActivation1ATemplate(journalRetry, prisma as any).execute(cRetry.id);
    await seedPendingPayments(cRetry.id, cRetry.installmentCount);

    await svc.earlyPayoff(cRetry.id, userId, {
      paymentMethod: 'CASH',
      discountPct: 50,
      collectedByShop: true,
    } as any);

    const outstanding = await getNet11_2107(cRetry.id);
    expect(outstanding.gt(0), `Expected 11-2107 balance > 0, got ${outstanding.toFixed(2)}`).toBe(true);

    const requestId = '33333333-3333-4333-8333-333333333333';

    // First call settles the FULL outstanding balance — outstanding is 0 by the
    // time the retry lands, proving the requestId check runs BEFORE the
    // outstanding computation (retry after full clearance must still succeed
    // idempotently instead of tripping the no-balance guard).
    const r1 = await svc.shopCollectSettlement(cRetry.id, userId, {
      depositAccountCode: '11-1201',
      amount: outstanding.toNumber(),
      requestId,
    });
    const r2 = await svc.shopCollectSettlement(cRetry.id, userId, {
      depositAccountCode: '11-1201',
      amount: outstanding.toNumber(),
      requestId,
    });
    expect(r1, 'First call should succeed').toBeDefined();
    expect(r2, 'Retry with same requestId should succeed idempotently').toBeDefined();

    const jes = await prisma.journalEntry.findMany({
      where: {
        AND: [
          { metadata: { path: ['flow'], equals: 'shop-collect-settlement' } } as any,
          { metadata: { path: ['contractId'], equals: cRetry.id } } as any,
        ],
        deletedAt: null,
      },
    });
    expect(jes).toHaveLength(1);
  });

  it('requestId เดิมซ้ำแต่ยอดเปลี่ยน → ConflictException (ห้ามกลืนเงียบ ยอดใหม่ต้องไม่หาย)', async () => {
    const cAmountChange = await seedStandard17k12m(prisma);
    const journalAmountChange = new JournalAutoService(prisma as any);
    await new ContractActivation1ATemplate(journalAmountChange, prisma as any).execute(cAmountChange.id);
    await seedPendingPayments(cAmountChange.id, cAmountChange.installmentCount);

    await svc.earlyPayoff(cAmountChange.id, userId, {
      paymentMethod: 'CASH',
      discountPct: 50,
      collectedByShop: true,
    } as any);

    const outstanding = await getNet11_2107(cAmountChange.id);
    expect(outstanding.gt(0), `Expected 11-2107 balance > 0, got ${outstanding.toFixed(2)}`).toBe(true);

    const requestId = '44444444-4444-4444-8444-444444444444';

    // First call: settle half the outstanding balance.
    const firstAmount = outstanding.div(2).toDecimalPlaces(2, Decimal.ROUND_DOWN);
    const r1 = await svc.shopCollectSettlement(cAmountChange.id, userId, {
      depositAccountCode: '11-1201',
      amount: firstAmount.toNumber(),
      requestId,
    });
    expect(r1, 'First call should succeed').toBeDefined();

    // Simulates: client saw a timeout on the first call, dialog stayed open
    // (same requestId), operator edited the amount and resubmitted. The new
    // amount must still be within the (now-reduced) outstanding balance.
    const secondAmount = outstanding.minus(firstAmount).minus('2');
    expect(
      secondAmount.gt(0),
      `Fixture sanity: expected a positive alternate amount, got ${secondAmount.toFixed(2)}`,
    ).toBe(true);

    await expect(
      svc.shopCollectSettlement(cAmountChange.id, userId, {
        depositAccountCode: '11-1201',
        amount: secondAmount.toNumber(),
        requestId,
      }),
    ).rejects.toThrow(ConflictException);

    await expect(
      svc.shopCollectSettlement(cAmountChange.id, userId, {
        depositAccountCode: '11-1201',
        amount: secondAmount.toNumber(),
        requestId,
      }),
    ).rejects.toThrow('คำขอนี้ถูกบันทึกไปแล้ว');

    // Only the first JE should exist for this contract.
    const jes = await prisma.journalEntry.findMany({
      where: {
        AND: [
          { metadata: { path: ['flow'], equals: 'shop-collect-settlement' } } as any,
          { metadata: { path: ['contractId'], equals: cAmountChange.id } } as any,
        ],
        deletedAt: null,
      },
    });
    expect(jes).toHaveLength(1);

    // Net 11-2107 must reflect only the first (accepted) amount.
    const finalBalance = await getNet11_2107(cAmountChange.id);
    expect(
      finalBalance.minus(outstanding.minus(firstAmount)).abs().lte('0.01'),
      `Expected net 11-2107 to reflect only the first settlement (${outstanding.minus(firstAmount).toFixed(2)}), got ${finalBalance.toFixed(2)}`,
    ).toBe(true);
  });
});
