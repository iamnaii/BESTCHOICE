import { describe, it, expect } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { seedFinanceCoa } from '../../../../prisma/seed-coa-finance';
import { seedStandard17k12m } from '../__tests__/scenario-helpers';
import { JournalAutoService } from '../journal-auto.service';
import { RescheduleService } from '../../installments/reschedule.service';
import { RescheduleJP6Template } from './reschedule-jp6.template';
import { InstallmentAccrual2ATemplate } from './installment-accrual-2a.template';
import { PaymentReceipt2BTemplate } from './payment-receipt-2b.template';

const prisma = new PrismaClient();
const DEPOSIT = '11-1101';

async function setup() {
  await prisma.journalLine.deleteMany({});
  await prisma.journalEntry.deleteMany({});
  await prisma.receipt.deleteMany({});
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

/**
 * Pay installments 1-4 normally (2A + 2B) so installment 5 is overdue.
 */
async function payInstallments1to4(
  prisma: PrismaClient,
  journal: JournalAutoService,
  contractId: string,
) {
  const accrual = new InstallmentAccrual2ATemplate(journal, prisma as any);
  const pay = new PaymentReceipt2BTemplate(journal, prisma as any);
  const insts = await prisma.installmentSchedule.findMany({
    where: { contractId, installmentNo: { lte: 4 }, deletedAt: null },
    orderBy: { installmentNo: 'asc' },
  });
  for (const inst of insts) {
    await accrual.execute(inst.id);
    await pay.execute({
      installmentScheduleId: inst.id,
      amountReceived: new Decimal('1515.83'),
      depositAccountCode: DEPOSIT,
    });
  }
}

describe('RescheduleJP6Template', () => {
  describe('6a — split-pay (fee advance first, then full installment)', () => {
    it('posts fee-advance + final-consumption JEs with correct 21-1103 flows', async () => {
      const journal = await setup();
      const c = await seedStandard17k12m(prisma);

      // Pay installments 1-4
      await payInstallments1to4(prisma, journal, c.id);

      // Run reschedule: installment 5+, shift 16 days
      const svc = new RescheduleService(prisma as any);
      const { rescheduleFee } = await svc.execute({
        contractId: c.id,
        fromInstallmentNo: 5,
        daysToShift: 16,
      });
      expect(rescheduleFee.toFixed(2)).toBe('808.44');

      const tmpl = new RescheduleJP6Template(journal, prisma as any);

      // 6a Step 1: 02/05 — customer pays fee advance 808.44
      const { entryNo: feeEntryNo } = await tmpl.recordFeeAdvance({
        contractId: c.id,
        feeAmount: rescheduleFee,
        depositAccountCode: DEPOSIT,
      });
      expect(feeEntryNo).toBeTruthy();

      // 6a Step 2: 16/05 — normal 2A + 2B for installment 5 (full 1515.83)
      const inst5 = await prisma.installmentSchedule.findFirstOrThrow({
        where: { contractId: c.id, installmentNo: 5 },
      });
      const accrual = new InstallmentAccrual2ATemplate(journal, prisma as any);
      const pay = new PaymentReceipt2BTemplate(journal, prisma as any);
      await accrual.execute(inst5.id);
      await pay.execute({
        installmentScheduleId: inst5.id,
        amountReceived: new Decimal('1515.83'),
        depositAccountCode: DEPOSIT,
      });

      // Pay installments 6-11 normally
      const insts611 = await prisma.installmentSchedule.findMany({
        where: { contractId: c.id, installmentNo: { gte: 6, lte: 11 }, deletedAt: null },
        orderBy: { installmentNo: 'asc' },
      });
      for (const inst of insts611) {
        await accrual.execute(inst.id);
        await pay.execute({
          installmentScheduleId: inst.id,
          amountReceived: new Decimal('1515.83'),
          depositAccountCode: DEPOSIT,
        });
      }

      // Final installment 12: 2A (full 1515.83), then consume advance
      const inst12 = await prisma.installmentSchedule.findFirstOrThrow({
        where: { contractId: c.id, installmentNo: 12 },
      });
      await accrual.execute(inst12.id);

      const { entryNo: finalEntryNo } = await tmpl.consumeAdvanceOnFinalInstallment({
        contractId: c.id,
        installmentScheduleId: inst12.id,
        advanceAmount: rescheduleFee, // 808.44
        cashRemainder: new Decimal('707.40'), // 1515.84 - 808.44
        depositAccountCode: DEPOSIT,
      });
      expect(finalEntryNo).toBeTruthy();

      // Verify fee-advance JE: Dr 11-1101 808.44 / Cr 21-1103 808.44
      const feeJes = await prisma.journalEntry.findMany({
        where: { metadata: { path: ['flow'], equals: 'reschedule-fee' } } as any,
        include: { lines: true },
      });
      expect(feeJes.length).toBe(1);
      const feeLines = feeJes[0].lines;
      const feeDrLine = feeLines.find((l) => new Decimal(l.debit.toString()).gt(0));
      const feeCrLine = feeLines.find((l) => new Decimal(l.credit.toString()).gt(0));
      expect(feeDrLine?.accountCode).toBe(DEPOSIT);
      expect(new Decimal(feeDrLine!.debit.toString()).toFixed(2)).toBe('808.44');
      expect(feeCrLine?.accountCode).toBe('21-1103');
      expect(new Decimal(feeCrLine!.credit.toString()).toFixed(2)).toBe('808.44');

      // Verify final-consumption JE: Dr 21-1103 808.44 + Dr 11-1101 707.39 / Cr 11-2103 1515.83
      const finalJes = await prisma.journalEntry.findMany({
        where: { metadata: { path: ['flow'], equals: 'reschedule-final' } } as any,
        include: { lines: true },
      });
      expect(finalJes.length).toBe(1);
      const finalLines = finalJes[0].lines;
      const advanceDrLine = finalLines.find((l) => l.accountCode === '21-1103');
      const cashDrLine = finalLines.find(
        (l) => l.accountCode === DEPOSIT && new Decimal(l.debit.toString()).gt(0),
      );
      const receivableCrLine = finalLines.find((l) => l.accountCode === '11-2103');
      expect(new Decimal(advanceDrLine!.debit.toString()).toFixed(2)).toBe('808.44');
      expect(new Decimal(cashDrLine!.debit.toString()).toFixed(2)).toBe('707.40');
      expect(new Decimal(receivableCrLine!.credit.toString()).toFixed(2)).toBe('1515.84');
    });
  });

  describe('6b — bundled (installment + fee in one transaction)', () => {
    it('posts bundled + final-consumption JEs with correct 21-1103 flows', async () => {
      const journal = await setup();
      const c = await seedStandard17k12m(prisma);

      // Pay installments 1-4
      await payInstallments1to4(prisma, journal, c.id);

      // Run reschedule: installment 5+, shift 16 days
      const svc = new RescheduleService(prisma as any);
      const { rescheduleFee } = await svc.execute({
        contractId: c.id,
        fromInstallmentNo: 5,
        daysToShift: 16,
      });
      expect(rescheduleFee.toFixed(2)).toBe('808.44');

      const tmpl = new RescheduleJP6Template(journal, prisma as any);
      const inst5 = await prisma.installmentSchedule.findFirstOrThrow({
        where: { contractId: c.id, installmentNo: 5 },
      });

      // 6b: 2A accrual for installment 5, then bundled payment (1515.83 + 808.44 = 2324.27)
      // Note: we use 1515.83 as installmentAmount to match the CSV spec (close to actual 1515.84)
      const accrual = new InstallmentAccrual2ATemplate(journal, prisma as any);
      await accrual.execute(inst5.id);

      const { entryNo: bundledEntryNo } = await tmpl.recordBundledPayment({
        contractId: c.id,
        installmentScheduleId: inst5.id,
        installmentAmount: new Decimal('1515.83'), // caller provides actual amount received
        feeAmount: rescheduleFee,
        depositAccountCode: DEPOSIT,
      });
      expect(bundledEntryNo).toBeTruthy();

      // Record payment in DB to mark installment 5 as paid
      await prisma.payment.create({
        data: {
          contractId: c.id,
          installmentNo: 5,
          dueDate: inst5.dueDate,
          amountDue: new Decimal('1515.84'),
          amountPaid: new Decimal('1515.83'),
          status: 'PAID',
          paymentMethod: 'BANK_TRANSFER',
        },
      });

      // Pay installments 6-11 normally
      const pay = new PaymentReceipt2BTemplate(journal, prisma as any);
      const insts611 = await prisma.installmentSchedule.findMany({
        where: { contractId: c.id, installmentNo: { gte: 6, lte: 11 }, deletedAt: null },
        orderBy: { installmentNo: 'asc' },
      });
      for (const inst of insts611) {
        await accrual.execute(inst.id);
        await pay.execute({
          installmentScheduleId: inst.id,
          amountReceived: new Decimal('1515.83'),
          depositAccountCode: DEPOSIT,
        });
      }

      // Final installment 12: 2A then consume advance
      const inst12 = await prisma.installmentSchedule.findFirstOrThrow({
        where: { contractId: c.id, installmentNo: 12 },
      });
      await accrual.execute(inst12.id);

      const { entryNo: finalEntryNo } = await tmpl.consumeAdvanceOnFinalInstallment({
        contractId: c.id,
        installmentScheduleId: inst12.id,
        advanceAmount: rescheduleFee, // 808.44
        cashRemainder: new Decimal('707.40'), // 1515.84 - 808.44
        depositAccountCode: DEPOSIT,
      });
      expect(finalEntryNo).toBeTruthy();

      // Verify bundled JE: Dr 11-1101 2324.28 / Cr 11-2103 1515.84 + Cr 21-1103 808.44
      // (installmentAmount=1515.84 + feeAmount=808.44 = 2324.28)
      const bundledJes = await prisma.journalEntry.findMany({
        where: { metadata: { path: ['flow'], equals: 'reschedule-bundled' } } as any,
        include: { lines: true },
      });
      expect(bundledJes.length).toBe(1);
      const bundledLines = bundledJes[0].lines;
      const cashDrLine = bundledLines.find(
        (l) => l.accountCode === DEPOSIT && new Decimal(l.debit.toString()).gt(0),
      );
      const receivableCrLine = bundledLines.find((l) => l.accountCode === '11-2103');
      const advanceCrLine = bundledLines.find((l) => l.accountCode === '21-1103');
      // total = 1515.83 (hardcoded installmentAmount) + 808.44 = 2324.27
      expect(new Decimal(cashDrLine!.debit.toString()).toFixed(2)).toBe('2324.27');
      expect(new Decimal(receivableCrLine!.credit.toString()).toFixed(2)).toBe('1515.83');
      expect(new Decimal(advanceCrLine!.credit.toString()).toFixed(2)).toBe('808.44');

      // Verify final-consumption JE (same as 6a)
      const finalJes = await prisma.journalEntry.findMany({
        where: { metadata: { path: ['flow'], equals: 'reschedule-final' } } as any,
        include: { lines: true },
      });
      expect(finalJes.length).toBe(1);
      const finalLines = finalJes[0].lines;
      const advanceDrLine = finalLines.find((l) => l.accountCode === '21-1103');
      const cashDrLine2 = finalLines.find(
        (l) => l.accountCode === DEPOSIT && new Decimal(l.debit.toString()).gt(0),
      );
      const receivableCrLine2 = finalLines.find((l) => l.accountCode === '11-2103');
      expect(new Decimal(advanceDrLine!.debit.toString()).toFixed(2)).toBe('808.44');
      expect(new Decimal(cashDrLine2!.debit.toString()).toFixed(2)).toBe('707.40');
      // 808.44 + 707.40 = 1515.84
      expect(new Decimal(receivableCrLine2!.credit.toString()).toFixed(2)).toBe('1515.84');
    });
  });
});
