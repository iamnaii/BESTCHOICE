import { describe, it, expect, beforeAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { seedFinanceCoa } from '../../../../prisma/seed-coa-finance';
import { WhtRemittanceTemplate } from './wht-remittance.template';
import { JournalAutoService } from '../journal-auto.service';

const prisma = new PrismaClient();

async function setup() {
  await prisma.journalLine.deleteMany({});
  await prisma.journalEntry.deleteMany({});
  await seedFinanceCoa(prisma);

  const existing = await prisma.user.findFirst({ where: { email: 'admin@bestchoice.com' } });
  if (!existing) {
    await prisma.user.create({
      data: { email: 'admin@bestchoice.com', password: 'x', name: 'admin', role: 'OWNER' },
    });
  }

  return new JournalAutoService(prisma as any);
}

describe('WhtRemittanceTemplate', () => {
  let journal: JournalAutoService;

  beforeAll(async () => {
    journal = await setup();
  });

  it('posts a balanced JE clearing PND3 payable to RD', async () => {
    const tmpl = new WhtRemittanceTemplate(journal);
    const remittanceDate = new Date('2026-05-15');

    const result = await tmpl.execute({
      whtCategory: 'PND3',
      amount: new Decimal('300.00'),
      remittanceDate,
      depositAccountCode: '11-1101',
      vendorReference: 'REM-2026-05-PND3',
    });

    expect(result.entryNo).toMatch(/^JE-/);

    const je = await prisma.journalEntry.findFirst({
      where: { entryNumber: result.entryNo },
      include: { lines: true },
    });

    expect(je).toBeDefined();
    expect(je!.status).toBe('POSTED');

    const lines = je!.lines;

    // Balanced
    const totalDr = lines.reduce((s, l) => s.plus(l.debit.toString()), new Decimal(0));
    const totalCr = lines.reduce((s, l) => s.plus(l.credit.toString()), new Decimal(0));
    expect(totalDr.toFixed(2)).toBe(totalCr.toFixed(2));

    // Dr 21-3102 ภ.ง.ด. 3 ค้างจ่าย (clears liability)
    const whtLine = lines.find((l) => l.accountCode === '21-3102');
    expect(whtLine).toBeDefined();
    expect(new Decimal(whtLine!.debit.toString()).toFixed(2)).toBe('300.00');

    // Cr 11-1101 cash
    const cashLine = lines.find((l) => l.accountCode === '11-1101');
    expect(cashLine).toBeDefined();
    expect(new Decimal(cashLine!.credit.toString()).toFixed(2)).toBe('300.00');
  });

  it('clears PND1 payable (payroll) to RD', async () => {
    const tmpl = new WhtRemittanceTemplate(journal);

    const result = await tmpl.execute({
      whtCategory: 'PND1',
      amount: new Decimal('4000.00'),
      remittanceDate: new Date('2026-05-15'),
      depositAccountCode: '11-1101',
      vendorReference: 'REM-2026-05-PND1',
    });

    const je = await prisma.journalEntry.findFirst({
      where: { entryNumber: result.entryNo },
      include: { lines: true },
    });

    const lines = je!.lines;
    const totalDr = lines.reduce((s, l) => s.plus(l.debit.toString()), new Decimal(0));
    const totalCr = lines.reduce((s, l) => s.plus(l.credit.toString()), new Decimal(0));
    expect(totalDr.toFixed(2)).toBe(totalCr.toFixed(2));

    const whtLine = lines.find((l) => l.accountCode === '21-3101');
    expect(whtLine).toBeDefined();
    expect(new Decimal(whtLine!.debit.toString()).toFixed(2)).toBe('4000.00');
  });

  it('clears PND53 payable (corporate) to RD', async () => {
    const tmpl = new WhtRemittanceTemplate(journal);

    const result = await tmpl.execute({
      whtCategory: 'PND53',
      amount: new Decimal('240.00'),
      remittanceDate: new Date('2026-05-15'),
      depositAccountCode: '11-1101',
      vendorReference: 'REM-2026-05-PND53',
    });

    const je = await prisma.journalEntry.findFirst({
      where: { entryNumber: result.entryNo },
      include: { lines: true },
    });

    const lines = je!.lines;
    const totalDr = lines.reduce((s, l) => s.plus(l.debit.toString()), new Decimal(0));
    const totalCr = lines.reduce((s, l) => s.plus(l.credit.toString()), new Decimal(0));
    expect(totalDr.toFixed(2)).toBe(totalCr.toFixed(2));

    // Dr 21-3103 (PND53 payable cleared)
    const whtLine = lines.find((l) => l.accountCode === '21-3103');
    expect(whtLine).toBeDefined();
    expect(new Decimal(whtLine!.debit.toString()).toFixed(2)).toBe('240.00');
  });
});
