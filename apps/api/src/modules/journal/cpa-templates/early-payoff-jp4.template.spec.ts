import { describe, it, expect } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { seedFinanceCoa } from '../../../../prisma/seed-coa-finance';
import { seedStandard17k12m } from '../__tests__/scenario-helpers';
import { ContractActivation1ATemplate } from './contract-activation-1a.template';
import { InstallmentAccrual2ATemplate } from './installment-accrual-2a.template';
import { PaymentReceipt2BTemplate } from './payment-receipt-2b.template';
import { EarlyPayoffJP4Template } from './early-payoff-jp4.template';
import { JournalAutoService } from '../journal-auto.service';

const prisma = new PrismaClient();

async function setup() {
  await prisma.journalLine.deleteMany({});
  await prisma.journalEntry.deleteMany({});
  await prisma.receipt.deleteMany({});
  await prisma.eDocument.deleteMany({});
  await prisma.signature.deleteMany({});
  await prisma.contractDocument.deleteMany({});
  await prisma.partialPaymentLink.deleteMany({});
  await prisma.warrantyAuditLog.deleteMany({});
  await prisma.badDebtWriteOffAuditLog.deleteMany({});
  await prisma.promiseSlot.deleteMany({});
  await prisma.callLog.deleteMany({});
  await prisma.dunningAction.deleteMany({});
  await prisma.repossession.deleteMany({});
  await prisma.installmentSchedule.deleteMany({});
  await prisma.payment.deleteMany({});
  await prisma.contract.deleteMany({});
  await seedFinanceCoa(prisma);

  const exists = await prisma.user.findUnique({ where: { email: 'admin@bestchoice.com' } });
  if (!exists) {
    await prisma.user.create({
      data: { email: 'admin@bestchoice.com', password: 'x', name: 'admin', role: 'OWNER' },
    });
  }

  return new JournalAutoService(prisma as any);
}

/** Helper — fetch the early-payoff JE with all lines (assumes exactly 1 exists). */
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

/**
 * Helper — pay first N installments (accrual + 2B receipt at 1515.83 ฿/งวด).
 * NOTE: Replaces the CSV-golden test from pre-Wave-2 because case-4 CSV did not
 * implement ม.79 + ม.86/10 (Cr 21-2101 was full deferred VAT). New logic posts
 * Cr 21-2101 = remainingDeferredVat - vatOnDiscount.
 */
async function payFirstN(
  journal: JournalAutoService,
  contractId: string,
  n: number,
): Promise<void> {
  const accrual = new InstallmentAccrual2ATemplate(journal, prisma as any);
  const pay = new PaymentReceipt2BTemplate(journal, prisma as any);
  const insts = await prisma.installmentSchedule.findMany({
    where: { contractId },
    orderBy: { installmentNo: 'asc' },
  });
  for (let i = 0; i < n; i++) {
    await accrual.execute(insts[i].id);
    await pay.execute({
      installmentScheduleId: insts[i].id,
      amountReceived: new Decimal('1515.83'),
      depositAccountCode: '11-1101',
    });
  }
}

describe('EarlyPayoffJP4Template', () => {
  it('Wave 2 T3 — 50% discount lowers VAT base per ม.79 + ม.86/10', async () => {
    const journal = await setup();
    const c = await seedStandard17k12m(prisma);
    await new ContractActivation1ATemplate(journal, prisma as any).execute(c.id);
    await payFirstN(journal, c.id, 6);

    const tmpl = new EarlyPayoffJP4Template(journal, prisma as any);
    await tmpl.execute({
      contractId: c.id,
      depositAccountCode: '11-1101',
      interestDiscountPercent: new Decimal('50'),
    });

    // Math (17K/12M, 6 unpaid):
    //   remainingDeferredInterest = 500 × 6      = 3,000.00
    //   discount                   = 50% × 3,000  = 1,500.00
    //   vatOnDiscount              = 1,500 × 0.07 =   105.00
    //   remainingDeferredVat       = 99.17 × 6   =   595.02
    //   settleVat                  = 595.02 - 105 = 490.02
    //   remainingGross             = 1,416.66 × 6 = 8,499.96
    //   settlement                 = 8,499.96 - 1,500 + 490.02 = 7,489.98
    const je = await getEarlyPayoffJe(c.id);

    const cr21_2101 = je.lines.find((l) => l.accountCode === '21-2101');
    expect(cr21_2101).toBeDefined();
    // Cr 21-2101 must equal settleVat (reduced by vatOnDiscount per ม.79), NOT full deferred VAT
    expect(new Decimal(cr21_2101!.credit.toString()).toNumber()).toBeCloseTo(490.02, 2);

    // Dr 21-2102 still cleared in full (deferred VAT account closed)
    const dr21_2102 = je.lines.find((l) => l.accountCode === '21-2102');
    expect(new Decimal(dr21_2102!.debit.toString()).toNumber()).toBeCloseTo(595.02, 2);

    // Customer cash payment reduced by vatOnDiscount
    const drCash = je.lines.find((l) => l.accountCode === '11-1101');
    expect(drCash).toBeDefined();
    expect(new Decimal(drCash!.debit.toString()).toNumber()).toBeCloseTo(7489.98, 2);

    // Discount line still present
    const dr52_1106 = je.lines.find((l) => l.accountCode === '52-1106');
    expect(new Decimal(dr52_1106!.debit.toString()).toNumber()).toBeCloseTo(1500, 2);

    // Metadata records the credit-back for traceability (per ม.86/10)
    const meta = je.metadata as Record<string, string>;
    expect(meta.vatCreditBackOnDiscount).toBe('105.00');
    expect(meta.settleVat).toBe('490.02');

    // JE balanced
    const totalDr = je.lines.reduce(
      (s, l) => s.plus(new Decimal(l.debit.toString())),
      new Decimal(0),
    );
    const totalCr = je.lines.reduce(
      (s, l) => s.plus(new Decimal(l.credit.toString())),
      new Decimal(0),
    );
    expect(totalDr.minus(totalCr).abs().lte('0.01')).toBe(true);
    expect(totalDr.toNumber()).toBeCloseTo(12585, 2);
  });

  it('Wave 2 T3 — zero discount = no VAT credit back (Cr 21-2101 = full deferred VAT)', async () => {
    const journal = await setup();
    const c = await seedStandard17k12m(prisma);
    await new ContractActivation1ATemplate(journal, prisma as any).execute(c.id);
    await payFirstN(journal, c.id, 6);

    const tmpl = new EarlyPayoffJP4Template(journal, prisma as any);
    await tmpl.execute({
      contractId: c.id,
      depositAccountCode: '11-1101',
      interestDiscountPercent: new Decimal('0'),
    });

    const je = await getEarlyPayoffJe(c.id);

    // No 52-1106 line when discount = 0
    const dr52_1106 = je.lines.find((l) => l.accountCode === '52-1106');
    expect(dr52_1106, 'no 52-1106 when discount = 0').toBeUndefined();

    // Cr 21-2101 = full remainingDeferredVat (595.02)
    const cr21_2101 = je.lines.find((l) => l.accountCode === '21-2101');
    expect(cr21_2101).toBeDefined();
    expect(new Decimal(cr21_2101!.credit.toString()).toNumber()).toBeCloseTo(595.02, 2);

    // settlement = remainingGross + remainingDeferredVat = 8499.96 + 595.02 = 9094.98
    const drCash = je.lines.find((l) => l.accountCode === '11-1101');
    expect(new Decimal(drCash!.debit.toString()).toNumber()).toBeCloseTo(9094.98, 2);

    const meta = je.metadata as Record<string, string>;
    expect(meta.vatCreditBackOnDiscount).toBe('0.00');
    expect(meta.settleVat).toBe('595.02');
  });

  it('Wave 2 T3 — 100% discount = full VAT credit back (Cr 21-2101 reduced by full deferred VAT)', async () => {
    const journal = await setup();
    const c = await seedStandard17k12m(prisma);
    await new ContractActivation1ATemplate(journal, prisma as any).execute(c.id);
    await payFirstN(journal, c.id, 6);

    const tmpl = new EarlyPayoffJP4Template(journal, prisma as any);
    await tmpl.execute({
      contractId: c.id,
      depositAccountCode: '11-1101',
      interestDiscountPercent: new Decimal('100'),
    });

    // discount = 3000, vatOnDiscount = 210, settleVat = 595.02 - 210 = 385.02
    const je = await getEarlyPayoffJe(c.id);

    const cr21_2101 = je.lines.find((l) => l.accountCode === '21-2101');
    expect(new Decimal(cr21_2101!.credit.toString()).toNumber()).toBeCloseTo(385.02, 2);

    // settlement = 8499.96 - 3000 + 385.02 = 5884.98
    const drCash = je.lines.find((l) => l.accountCode === '11-1101');
    expect(new Decimal(drCash!.debit.toString()).toNumber()).toBeCloseTo(5884.98, 2);

    const meta = je.metadata as Record<string, string>;
    expect(meta.vatCreditBackOnDiscount).toBe('210.00');
  });

  it('marks all remaining installments as PAID', async () => {
    const journal = await setup();
    const c = await seedStandard17k12m(prisma);
    await new ContractActivation1ATemplate(journal, prisma as any).execute(c.id);

    const accrual = new InstallmentAccrual2ATemplate(journal, prisma as any);
    const pay = new PaymentReceipt2BTemplate(journal, prisma as any);
    const insts = await prisma.installmentSchedule.findMany({
      where: { contractId: c.id },
      orderBy: { installmentNo: 'asc' },
    });

    for (let i = 0; i < 6; i++) {
      await accrual.execute(insts[i].id);
      await pay.execute({
        installmentScheduleId: insts[i].id,
        amountReceived: new Decimal('1515.83'),
        depositAccountCode: '11-1101',
      });
    }

    const tmpl = new EarlyPayoffJP4Template(journal, prisma as any);
    await tmpl.execute({
      contractId: c.id,
      depositAccountCode: '11-1101',
      interestDiscountPercent: new Decimal('50'),
    });

    // After early payoff, all 12 installments should have a PAID Payment record
    const paidCount = await prisma.payment.count({
      where: { contractId: c.id, status: 'PAID' },
    });
    const totalInsts = await prisma.installmentSchedule.count({
      where: { contractId: c.id },
    });
    expect(paidCount, 'all installments should have PAID Payment records after early payoff').toBe(
      totalInsts,
    );
  });

  it('throws when all installments are already paid', async () => {
    const journal = await setup();
    const c = await seedStandard17k12m(prisma);
    await new ContractActivation1ATemplate(journal, prisma as any).execute(c.id);

    // Mark all as PAID by creating Payment records for all installments
    const allInsts = await prisma.installmentSchedule.findMany({ where: { contractId: c.id } });
    for (const inst of allInsts) {
      await prisma.payment.create({
        data: {
          contractId: c.id,
          installmentNo: inst.installmentNo,
          dueDate: inst.dueDate,
          amountDue: new Decimal('1515.83'),
          amountPaid: new Decimal('1515.83'),
          paidDate: new Date(),
          paidAt: new Date(),
          status: 'PAID',
        },
      });
    }

    const tmpl = new EarlyPayoffJP4Template(journal, prisma as any);
    await expect(
      tmpl.execute({
        contractId: c.id,
        depositAccountCode: '11-1101',
        interestDiscountPercent: new Decimal('50'),
      }),
    ).rejects.toThrow(/already paid/i);
  });
});
