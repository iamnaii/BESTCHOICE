import { describe, it, expect, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import path from 'path';
import { Decimal } from '@prisma/client/runtime/library';
import { seedFinanceCoa } from '../../../../prisma/seed-coa-finance';
import { seedStandard17k12m } from '../__tests__/scenario-helpers';
import { loadCaseFromCsv } from '../__tests__/csv-fixture-loader';
import { diffGoldenJE } from '../__tests__/golden-je-matcher';
import { ContractActivation1ATemplate } from './contract-activation-1a.template';
import { InstallmentAccrual2ATemplate } from './installment-accrual-2a.template';
import {
  PaymentReceipt2BTemplate,
  calcLateFee,
  calcPostponeFee,
} from './payment-receipt-2b.template';
import { Vat60dayMandatoryTemplate } from './vat-60day-mandatory.template';
import { Vat60dayReversalTemplate } from './vat-60day-reversal.template';
import { JournalAutoService } from '../journal-auto.service';
import type { ActualJe } from '../__tests__/golden-je-matcher';

const prisma = new PrismaClient();

async function setup() {
  // Clean slate for each test
  if ('journalPostAuditLog' in prisma) {
    await (prisma as any).journalPostAuditLog.deleteMany({});
  }
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
  await prisma.payment.deleteMany({});
  await prisma.installmentSchedule.deleteMany({});
  await prisma.contract.deleteMany({});
  await seedFinanceCoa(prisma);

  // Ensure system admin user exists (needed by JournalAutoService.resolveSystemUserId)
  const exists = await prisma.user.findUnique({ where: { email: 'admin@bestchoice.com' } });
  if (!exists) {
    await prisma.user.create({
      data: {
        email: 'admin@bestchoice.com',
        password: 'x',
        name: 'admin',
        role: 'OWNER',
      },
    });
  }

  const c = await seedStandard17k12m(prisma);
  const journal = new JournalAutoService(prisma as any);

  // Run Template 1A (contract activation)
  await new ContractActivation1ATemplate(journal, prisma as any).execute(c.id);

  // Get first installment schedule
  const inst = await prisma.installmentSchedule.findFirstOrThrow({
    where: { contractId: c.id, installmentNo: 1 },
  });

  // Run Template 2A (accrual)
  await new InstallmentAccrual2ATemplate(journal, prisma as any).execute(inst.id);

  return { contract: c, inst, journal };
}

async function get2BLines(contractId: string): Promise<ActualJe[] | null> {
  const entries = await prisma.journalEntry.findMany({
    where: { metadata: { path: ['contractId'], equals: contractId } } as any,
    include: { lines: true },
  });

  const tag2B = entries.find((e) => (e.metadata as any)?.tag === '2B');
  if (!tag2B) return null;

  return [
    {
      tag: '2B',
      lines: tag2B.lines.map((l) => ({
        code: l.accountCode,
        dr: new Decimal(l.debit.toString()),
        cr: new Decimal(l.credit.toString()),
      })),
    },
  ];
}

describe('PaymentReceipt2BTemplate', () => {
  it('case 1 — overpay 0.17 routes to 53-1503', async () => {
    const { contract, inst, journal } = await setup();
    const tmpl = new PaymentReceipt2BTemplate(journal, prisma as any);

    await tmpl.execute({
      installmentScheduleId: inst.id,
      amountReceived: new Decimal('1516.00'),
      depositAccountCode: '11-1101',
    });

    const expected = loadCaseFromCsv(
      path.join(__dirname, '../__tests__/fixtures/cpa-cases/case-1-overpay.csv'),
    );
    const expected2B = expected.entries.filter((e) => e.tag === '2B');
    const actual = await get2BLines(contract.id);

    expect(actual).not.toBeNull();
    expect(actual?.length).toBe(1);
    const diff = diffGoldenJE(expected2B, actual!);
    expect(diff.diffs, diff.diffs.join('\n')).toEqual([]);
  });

  it('case 2 — underpay 0.83 routes to 52-1104', async () => {
    const { contract, inst, journal } = await setup();
    const tmpl = new PaymentReceipt2BTemplate(journal, prisma as any);

    await tmpl.execute({
      installmentScheduleId: inst.id,
      amountReceived: new Decimal('1515.00'),
      depositAccountCode: '11-1101',
      toleranceApproverId: 'test-approver-id',
    });

    const expected = loadCaseFromCsv(
      path.join(__dirname, '../__tests__/fixtures/cpa-cases/case-2-underpay.csv'),
    );
    const expected2B = expected.entries.filter((e) => e.tag === '2B');
    const actual = await get2BLines(contract.id);

    expect(actual).not.toBeNull();
    expect(actual?.length).toBe(1);
    const diff = diffGoldenJE(expected2B, actual!);
    expect(diff.diffs, diff.diffs.join('\n')).toEqual([]);
  });

  it('rejects overpay/underpay >1฿', async () => {
    const { inst, journal } = await setup();
    const tmpl = new PaymentReceipt2BTemplate(journal, prisma as any);

    await expect(
      tmpl.execute({
        installmentScheduleId: inst.id,
        amountReceived: new Decimal('1500.00'),
        depositAccountCode: '11-1101',
      }),
    ).rejects.toThrow(/exceeds tolerance/i);
  });

  it('rejects underpay without approver', async () => {
    const { inst, journal } = await setup();
    const tmpl = new PaymentReceipt2BTemplate(journal, prisma as any);

    await expect(
      tmpl.execute({
        installmentScheduleId: inst.id,
        amountReceived: new Decimal('1515.00'),
        depositAccountCode: '11-1101',
        // no toleranceApproverId
      }),
    ).rejects.toThrow(/approver/i);
  });

  it('triggers VAT 60-day reversal when installment has vat60dayJournalEntryId set', async () => {
    const { contract, inst, journal } = await setup();

    // Backdate and post the mandatory VAT 60-day JE
    await prisma.installmentSchedule.update({
      where: { id: inst.id },
      data: { dueDate: new Date(Date.now() - 70 * 24 * 60 * 60 * 1000) },
    });
    const mandatory = new Vat60dayMandatoryTemplate(journal, prisma as any);
    await mandatory.execute(inst.id);

    // Verify mandatory JE was set
    const instAfterMandatory = await prisma.installmentSchedule.findUniqueOrThrow({
      where: { id: inst.id },
    });
    expect(instAfterMandatory.vat60dayJournalEntryId).not.toBeNull();

    // Now run 2B with reversal injected
    const reversal = new Vat60dayReversalTemplate(journal, prisma as any);
    const tmpl = new PaymentReceipt2BTemplate(journal, prisma as any, reversal);

    await tmpl.execute({
      installmentScheduleId: inst.id,
      amountReceived: new Decimal('1515.83'),
      depositAccountCode: '11-1101',
    });

    // Verify 2B JE was posted
    const entry2B = await prisma.journalEntry.findFirst({
      where: { metadata: { path: ['tag'], equals: '2B' } } as any,
    });
    expect(entry2B).not.toBeNull();

    // Verify reversal JE was also posted
    const entryReversal = await prisma.journalEntry.findFirst({
      where: { metadata: { path: ['tag'], equals: 'VAT60-REVERSAL' } } as any,
    });
    expect(entryReversal).not.toBeNull();

    // Verify vat60dayJournalEntryId was cleared
    const instAfterPayment = await prisma.installmentSchedule.findUniqueOrThrow({
      where: { id: inst.id },
    });
    expect(instAfterPayment.vat60dayJournalEntryId).toBeNull();
  });

  it('does NOT trigger reversal when no 60-day VAT JE exists', async () => {
    const { inst, journal } = await setup();

    // No mandatory JE — vat60dayJournalEntryId is null
    const reversal = new Vat60dayReversalTemplate(journal, prisma as any);
    const tmpl = new PaymentReceipt2BTemplate(journal, prisma as any, reversal);

    await tmpl.execute({
      installmentScheduleId: inst.id,
      amountReceived: new Decimal('1515.83'),
      depositAccountCode: '11-1101',
    });

    // Should have 2B but no reversal
    const entry2B = await prisma.journalEntry.findFirst({
      where: { metadata: { path: ['tag'], equals: '2B' } } as any,
    });
    expect(entry2B).not.toBeNull();

    const entryReversal = await prisma.journalEntry.findFirst({
      where: { metadata: { path: ['tag'], equals: 'VAT60-REVERSAL' } } as any,
    });
    expect(entryReversal).toBeNull();
  });

  describe('advance handling', () => {
    it('overpay → advance: posts Cr 21-1103, no 53-1503 line', async () => {
      // installmentTotal = 1,515.83 (standard 17K/12M fixture)
      // Customer pays 1,600 — overpay = 84.17 → park to 21-1103
      const { contract, inst, journal } = await setup();
      const tmpl = new PaymentReceipt2BTemplate(journal, prisma as any);

      const advanceCredit = new Decimal('84.17');
      await tmpl.execute({
        installmentScheduleId: inst.id,
        amountReceived: new Decimal('1600.00'),
        depositAccountCode: '11-1101',
        advanceCredit,
      });

      const entry2B = await prisma.journalEntry.findFirstOrThrow({
        where: { metadata: { path: ['tag'], equals: '2B' } } as any,
        include: { lines: true },
      });
      const lines = entry2B.lines;

      // Must have Cr 21-1103 with advanceCredit
      const advance21_1103Cr = lines.find(
        (l) => l.accountCode === '21-1103' && new Decimal(l.credit.toString()).eq(advanceCredit),
      );
      expect(advance21_1103Cr, 'Cr 21-1103 advance line missing').not.toBeUndefined();

      // Must NOT have 53-1503 line (no rounding gain)
      const rounding53 = lines.find((l) => l.accountCode === '53-1503');
      expect(rounding53, '53-1503 should not appear').toBeUndefined();

      // Journal must balance (total Dr = total Cr)
      const totalDr = lines.reduce((acc, l) => acc.plus(l.debit.toString()), new Decimal(0));
      const totalCr = lines.reduce((acc, l) => acc.plus(l.credit.toString()), new Decimal(0));
      expect(totalDr.toFixed(2)).toBe(totalCr.toFixed(2));
    });

    it('consume: posts Dr 21-1103, partial cash', async () => {
      // installmentTotal = 1,515.83
      // Customer has 200 advance → pays 1,315.83 cash + consume 200
      const { contract, inst, journal } = await setup();
      const tmpl = new PaymentReceipt2BTemplate(journal, prisma as any);

      const advanceConsume = new Decimal('200.00');
      const cashAmount = new Decimal('1315.83');
      await tmpl.execute({
        installmentScheduleId: inst.id,
        amountReceived: cashAmount,
        depositAccountCode: '11-1101',
        advanceConsume,
      });

      const entry2B = await prisma.journalEntry.findFirstOrThrow({
        where: { metadata: { path: ['tag'], equals: '2B' } } as any,
        include: { lines: true },
      });
      const lines = entry2B.lines;

      // Dr 21-1103 = advanceConsume
      const advance21_1103Dr = lines.find(
        (l) =>
          l.accountCode === '21-1103' && new Decimal(l.debit.toString()).eq(advanceConsume),
      );
      expect(advance21_1103Dr, 'Dr 21-1103 consume line missing').not.toBeUndefined();

      // Dr 11-1101 = cashAmount
      const cashLine = lines.find(
        (l) =>
          l.accountCode === '11-1101' && new Decimal(l.debit.toString()).eq(cashAmount),
      );
      expect(cashLine, 'Dr 11-1101 cash line missing').not.toBeUndefined();

      // Cr 11-2103 = installmentTotal (1,515.83)
      const receivableLine = lines.find(
        (l) =>
          l.accountCode === '11-2103' &&
          new Decimal(l.credit.toString()).eq(new Decimal('1515.83')),
      );
      expect(receivableLine, 'Cr 11-2103 = 1515.83 missing').not.toBeUndefined();

      // Balanced
      const totalDr = lines.reduce((acc, l) => acc.plus(l.debit.toString()), new Decimal(0));
      const totalCr = lines.reduce((acc, l) => acc.plus(l.credit.toString()), new Decimal(0));
      expect(totalDr.toFixed(2)).toBe(totalCr.toFixed(2));
    });

    it('full-cover: 100% from advance, no Dr cash line', async () => {
      // installmentTotal = 1,515.83
      // Customer has 1,515.83 advance → pays 0 cash, fully covered by advance
      const { contract, inst, journal } = await setup();
      const tmpl = new PaymentReceipt2BTemplate(journal, prisma as any);

      const advanceConsume = new Decimal('1515.83');
      await tmpl.execute({
        installmentScheduleId: inst.id,
        amountReceived: new Decimal('0'),
        depositAccountCode: '11-1101',
        advanceConsume,
      });

      const entry2B = await prisma.journalEntry.findFirstOrThrow({
        where: { metadata: { path: ['tag'], equals: '2B' } } as any,
        include: { lines: true },
      });
      const lines = entry2B.lines;

      // No Dr 11-1101 cash line
      const cashLine = lines.find((l) => l.accountCode === '11-1101');
      expect(cashLine, '11-1101 should not appear when amountReceived=0').toBeUndefined();

      // Dr 21-1103 = 1,515.83
      const advance21_1103Dr = lines.find(
        (l) =>
          l.accountCode === '21-1103' && new Decimal(l.debit.toString()).eq(advanceConsume),
      );
      expect(advance21_1103Dr, 'Dr 21-1103 = 1515.83 missing').not.toBeUndefined();

      // Cr 11-2103 = 1,515.83
      const receivableLine = lines.find(
        (l) =>
          l.accountCode === '11-2103' &&
          new Decimal(l.credit.toString()).eq(new Decimal('1515.83')),
      );
      expect(receivableLine, 'Cr 11-2103 = 1515.83 missing').not.toBeUndefined();

      // Balanced
      const totalDr = lines.reduce((acc, l) => acc.plus(l.debit.toString()), new Decimal(0));
      const totalCr = lines.reduce((acc, l) => acc.plus(l.credit.toString()), new Decimal(0));
      expect(totalDr.toFixed(2)).toBe(totalCr.toFixed(2));
    });
  });

  describe('late fee (CPA case 6)', () => {
    it('on-time payment: lateFee=0, no 42-1103 line', async () => {
      const { contract, inst, journal } = await setup();
      const tmpl = new PaymentReceipt2BTemplate(journal, prisma as any);

      await tmpl.execute({
        installmentScheduleId: inst.id,
        amountReceived: new Decimal('1515.83'),
        depositAccountCode: '11-1101',
        lateFee: new Decimal(0),
      });

      const entry2B = await prisma.journalEntry.findFirstOrThrow({
        where: { metadata: { path: ['tag'], equals: '2B' } } as any,
        include: { lines: true },
      });
      expect(entry2B.lines.find((l) => l.accountCode === '42-1103')).toBeUndefined();
    });

    it('1-2 days overdue: 50฿ late fee → Cr 42-1103 = 50', async () => {
      const { contract, inst, journal } = await setup();
      const tmpl = new PaymentReceipt2BTemplate(journal, prisma as any);

      // Customer pays installmentTotal + 50฿ late fee
      const lateFee = new Decimal(50);
      await tmpl.execute({
        installmentScheduleId: inst.id,
        amountReceived: new Decimal('1515.83').plus(lateFee),
        depositAccountCode: '11-1101',
        lateFee,
      });

      const entry2B = await prisma.journalEntry.findFirstOrThrow({
        where: { metadata: { path: ['tag'], equals: '2B' } } as any,
        include: { lines: true },
      });
      const lines = entry2B.lines;

      // Dr cash = 1565.83 (installmentTotal + lateFee)
      const cash = lines.find((l) => l.accountCode === '11-1101')!;
      expect(cash.debit.toString()).toBe('1565.83');

      // Cr 11-2103 = installmentTotal only
      const recv = lines.find((l) => l.accountCode === '11-2103')!;
      expect(recv.credit.toString()).toBe('1515.83');

      // Cr 42-1103 = 50฿ late fee
      const lateFeeLine = lines.find((l) => l.accountCode === '42-1103')!;
      expect(lateFeeLine).toBeDefined();
      expect(lateFeeLine.credit.toString()).toBe('50');

      // Balanced
      const totalDr = lines.reduce((acc, l) => acc.plus(l.debit.toString()), new Decimal(0));
      const totalCr = lines.reduce((acc, l) => acc.plus(l.credit.toString()), new Decimal(0));
      expect(totalDr.toFixed(2)).toBe(totalCr.toFixed(2));
    });

    it('3+ days overdue: 100฿ late fee → Cr 42-1103 = 100', async () => {
      const { contract, inst, journal } = await setup();
      const tmpl = new PaymentReceipt2BTemplate(journal, prisma as any);

      const lateFee = new Decimal(100);
      await tmpl.execute({
        installmentScheduleId: inst.id,
        amountReceived: new Decimal('1515.83').plus(lateFee),
        depositAccountCode: '11-1101',
        lateFee,
      });

      const entry2B = await prisma.journalEntry.findFirstOrThrow({
        where: { metadata: { path: ['tag'], equals: '2B' } } as any,
        include: { lines: true },
      });
      const lateFeeLine = entry2B.lines.find((l) => l.accountCode === '42-1103')!;
      expect(lateFeeLine.credit.toString()).toBe('100');
    });

    it('late fee + overpay 0.17: 42-1103 + 53-1503 both posted', async () => {
      // installmentTotal = 1515.83, late fee = 50, customer pays 1566.00 (overpay 0.17 within tolerance)
      const { contract, inst, journal } = await setup();
      const tmpl = new PaymentReceipt2BTemplate(journal, prisma as any);

      await tmpl.execute({
        installmentScheduleId: inst.id,
        amountReceived: new Decimal('1566.00'),
        depositAccountCode: '11-1101',
        lateFee: new Decimal(50),
      });

      const entry2B = await prisma.journalEntry.findFirstOrThrow({
        where: { metadata: { path: ['tag'], equals: '2B' } } as any,
        include: { lines: true },
      });
      const lines = entry2B.lines;

      // Cr 42-1103 = 50
      const lateFeeLine = lines.find((l) => l.accountCode === '42-1103')!;
      expect(lateFeeLine.credit.toString()).toBe('50');

      // Cr 53-1503 = 0.17 (rounding diff after subtracting late fee)
      const rounding = lines.find((l) => l.accountCode === '53-1503')!;
      expect(rounding.credit.toString()).toBe('0.17');

      // Balanced
      const totalDr = lines.reduce((acc, l) => acc.plus(l.debit.toString()), new Decimal(0));
      const totalCr = lines.reduce((acc, l) => acc.plus(l.credit.toString()), new Decimal(0));
      expect(totalDr.toFixed(2)).toBe(totalCr.toFixed(2));
    });

    it('late fee with rounding > 1฿ (excluding lateFee) still rejected', async () => {
      const { inst, journal } = await setup();
      const tmpl = new PaymentReceipt2BTemplate(journal, prisma as any);

      // installmentTotal = 1515.83, late fee = 50
      // Customer pays 1500 + 50 = 1550 → after lateFee, rounding = 1500 - 1515.83 = -15.83 (>1฿)
      await expect(
        tmpl.execute({
          installmentScheduleId: inst.id,
          amountReceived: new Decimal('1550.00'),
          depositAccountCode: '11-1101',
          lateFee: new Decimal(50),
          toleranceApproverId: 'test-approver-id',
        }),
      ).rejects.toThrow(/exceeds tolerance/i);
    });
  });

  describe('partial clear', () => {
    it('partial: posts only Dr cash + Cr 11-2103 (amount), no tolerance check', async () => {
      const { inst, journal } = await setup();
      const tmpl = new PaymentReceipt2BTemplate(journal, prisma as any);

      const result = await tmpl.execute({
        installmentScheduleId: inst.id,
        amountReceived: new Decimal('800'),
        depositAccountCode: '11-1101',
        partialClear: true,
      });
      const je = await prisma.journalEntry.findFirstOrThrow({
        where: { entryNumber: result.entryNo },
        include: { lines: { orderBy: { createdAt: 'asc' } } },
      });
      expect(je.lines).toHaveLength(2);
      const cash = je.lines.find((l) => l.accountCode === '11-1101')!;
      expect(cash.debit.toString()).toBe('800');
      expect(cash.credit.toString()).toBe('0');
      const recv = je.lines.find((l) => l.accountCode === '11-2103')!;
      expect(recv.debit.toString()).toBe('0');
      expect(recv.credit.toString()).toBe('800');
      expect(je.lines.find((l) => l.accountCode === '53-1503')).toBeUndefined();
      expect(je.lines.find((l) => l.accountCode === '52-1104')).toBeUndefined();
      const totalDr = je.lines.reduce((s, l) => s.plus(l.debit.toString()), new Decimal(0));
      const totalCr = je.lines.reduce((s, l) => s.plus(l.credit.toString()), new Decimal(0));
      expect(totalDr.eq(totalCr)).toBe(true);
    });
  });
});

describe('calcLateFee', () => {
  it('returns 0 for 0 days overdue', () => {
    expect(calcLateFee(0).toString()).toBe('0');
  });

  it('returns 0 for negative days (early payment)', () => {
    expect(calcLateFee(-3).toString()).toBe('0');
  });

  it('returns 50 for 1-2 days overdue', () => {
    expect(calcLateFee(1).toString()).toBe('50');
    expect(calcLateFee(2).toString()).toBe('50');
  });

  it('returns 100 for 3+ days overdue', () => {
    expect(calcLateFee(3).toString()).toBe('100');
    expect(calcLateFee(30).toString()).toBe('100');
    expect(calcLateFee(365).toString()).toBe('100');
  });
});

describe('calcPostponeFee', () => {
  it('returns 0 for 0 days', () => {
    expect(calcPostponeFee(new Decimal('1515.83'), 0).toString()).toBe('0');
  });

  it('returns 0 for negative days', () => {
    expect(calcPostponeFee(new Decimal('1515.83'), -5).toString()).toBe('0');
  });

  it('1515.83 / 30 * 7 days = 353.69', () => {
    // 1515.83 / 30 = 50.5276666...
    // 50.5276666 * 7 = 353.6936666...
    // ROUND_DOWN to 2dp = 353.69
    expect(calcPostponeFee(new Decimal('1515.83'), 7).toString()).toBe('353.69');
  });

  it('1500 / 30 * 30 days = full installment 1500', () => {
    expect(calcPostponeFee(new Decimal('1500'), 30).toString()).toBe('1500');
  });

  it('rounds DOWN at 2dp (CPA Policy A spec — accountant hand-computed)', () => {
    // 100 / 30 * 1 = 3.3333... → 3.33 (truncate)
    expect(calcPostponeFee(new Decimal('100'), 1).toString()).toBe('3.33');
    // 100 / 30 * 2 = 6.6666... → 6.66 (truncate, NOT 6.67 — that would be HALF_UP)
    expect(calcPostponeFee(new Decimal('100'), 2).toString()).toBe('6.66');
    // 100 / 30 * 5 = 16.6666... → 16.66
    expect(calcPostponeFee(new Decimal('100'), 5).toString()).toBe('16.66');
  });
});
