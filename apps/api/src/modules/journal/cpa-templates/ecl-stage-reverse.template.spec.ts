import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { seedFinanceCoa } from '../../../../prisma/seed-coa-finance';
import { seedStandard17k12m } from '../__tests__/scenario-helpers';
import { ContractActivation1ATemplate } from './contract-activation-1a.template';
import { EclStageReverseTemplate } from './ecl-stage-reverse.template';
import { JournalAutoService } from '../journal-auto.service';

const prisma = new PrismaClient();

async function setup() {
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
  await prisma.badDebtProvision.deleteMany({});
  await prisma.payment.deleteMany({});
  await prisma.installmentSchedule.deleteMany({});
  await prisma.contract.deleteMany({});
  await seedFinanceCoa(prisma);

  const existing = await prisma.user.findFirst({ where: { email: 'admin@bestchoice.com' } });
  if (!existing) {
    await prisma.user.create({
      data: { email: 'admin@bestchoice.com', password: 'x', name: 'admin', role: 'OWNER' },
    });
  }

  return new JournalAutoService(prisma as any);
}

describe('EclStageReverseTemplate', () => {
  let journal: JournalAutoService;
  let contractId: string;

  beforeAll(async () => {
    journal = await setup();
    const c = await seedStandard17k12m(prisma);
    contractId = c.id;
    await new ContractActivation1ATemplate(journal, prisma as any).execute(contractId);
  });

  beforeEach(async () => {
    if ('journalPostAuditLog' in prisma) {
      await (prisma as any).journalPostAuditLog.deleteMany({});
    }
    await prisma.journalLine.deleteMany({
      where: { journalEntry: { metadata: { path: ['tag'], equals: 'ECL-STAGE-REVERSE' } } as any },
    });
    await prisma.journalEntry.deleteMany({
      where: { metadata: { path: ['tag'], equals: 'ECL-STAGE-REVERSE' } as any },
    });
  });

  it('posts a balanced reverse JE Dr 11-2102 / Cr 51-1103 with stage metadata', async () => {
    const tmpl = new EclStageReverseTemplate(journal, prisma as any);
    const result = await tmpl.execute({
      contractId,
      reverseAmount: new Decimal('195.00'),
      fromBucket: '31-60',
      toBucket: '1-30',
      period: '2026-05',
    });

    expect(result).not.toBeNull();
    expect(result!.entryNo).toMatch(/^JE-/);

    const je = await prisma.journalEntry.findFirstOrThrow({
      where: { metadata: { path: ['tag'], equals: 'ECL-STAGE-REVERSE' } } as any,
      include: { lines: true },
    });

    const meta = je.metadata as any;
    expect(meta.fromBucket).toBe('31-60');
    expect(meta.toBucket).toBe('1-30');
    expect(meta.reverseAmount).toBe('195.00');

    const dr = je.lines.find((l) => l.accountCode === '11-2102')!;
    const cr = je.lines.find((l) => l.accountCode === '51-1103')!;
    expect(dr.debit.toString()).toBe('195');
    expect(cr.credit.toString()).toBe('195');

    const totalDr = je.lines.reduce((s, l) => s.plus(l.debit.toString()), new Decimal(0));
    const totalCr = je.lines.reduce((s, l) => s.plus(l.credit.toString()), new Decimal(0));
    expect(totalDr.toFixed(2)).toBe(totalCr.toFixed(2));
  });

  it('returns null and posts no JE when reverseAmount is zero', async () => {
    const tmpl = new EclStageReverseTemplate(journal, prisma as any);
    const result = await tmpl.execute({
      contractId,
      reverseAmount: new Decimal(0),
      fromBucket: '1-30',
      toBucket: 'CURRENT',
    });
    expect(result).toBeNull();

    const count = await prisma.journalEntry.count({
      where: { metadata: { path: ['tag'], equals: 'ECL-STAGE-REVERSE' } } as any,
    });
    expect(count).toBe(0);
  });

  it('returns null and posts no JE when reverseAmount is negative', async () => {
    const tmpl = new EclStageReverseTemplate(journal, prisma as any);
    const result = await tmpl.execute({
      contractId,
      reverseAmount: new Decimal('-10'),
      fromBucket: '1-30',
      toBucket: 'CURRENT',
    });
    expect(result).toBeNull();
  });

  it('uses provided period when given; defaults to current YYYY-MM otherwise', async () => {
    const tmpl = new EclStageReverseTemplate(journal, prisma as any);

    await tmpl.execute({
      contractId,
      reverseAmount: new Decimal('5'),
      fromBucket: '31-60',
      toBucket: '1-30',
      period: '2099-12',
    });

    const je = await prisma.journalEntry.findFirstOrThrow({
      where: { metadata: { path: ['period'], equals: '2099-12' } } as any,
    });
    expect((je.metadata as any).period).toBe('2099-12');
  });
});
