import { describe, it, expect, beforeAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { seedFinanceCoa } from '../../../../prisma/seed-coa-finance';
import { WhtAccrualTemplate } from './wht-accrual.template';
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

describe('WhtAccrualTemplate', () => {
  let journal: JournalAutoService;

  beforeAll(async () => {
    journal = await setup();
  });

  it('posts a balanced JE with VAT — PND3 (individual contractor)', async () => {
    const tmpl = new WhtAccrualTemplate(journal);

    const grossAmount = new Decimal('10000.00'); // e.g. accounting fee
    const vatAmount = new Decimal('700.00');       // 7% VAT
    const whtAmount = new Decimal('300.00');        // 3% WHT
    // net = 10000 + 700 - 300 = 10400

    const result = await tmpl.execute({
      expenseAccountCode: '53-1401', // accounting fees (must exist in CoA)
      grossAmount,
      vatAmount,
      whtCategory: 'PND3',
      whtAmount,
      depositAccountCode: '11-1101',
      vendorReference: 'TEST-PND3-001',
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

    // Dr expense account
    const expLine = lines.find((l) => l.accountCode === '53-1401');
    expect(expLine).toBeDefined();
    expect(new Decimal(expLine!.debit.toString()).toFixed(2)).toBe('10000.00');

    // Dr 11-4101 ภาษีซื้อ
    const vatLine = lines.find((l) => l.accountCode === '11-4101');
    expect(vatLine).toBeDefined();
    expect(new Decimal(vatLine!.debit.toString()).toFixed(2)).toBe('700.00');

    // Cr 11-1101 cash (net)
    const cashLine = lines.find((l) => l.accountCode === '11-1101');
    expect(cashLine).toBeDefined();
    expect(new Decimal(cashLine!.credit.toString()).toFixed(2)).toBe('10400.00');

    // Cr 21-3102 ภ.ง.ด. 3 ค้างจ่าย
    const whtLine = lines.find((l) => l.accountCode === '21-3102');
    expect(whtLine).toBeDefined();
    expect(new Decimal(whtLine!.credit.toString()).toFixed(2)).toBe('300.00');
  });

  it('omits 11-4101 line when vatAmount = 0', async () => {
    const tmpl = new WhtAccrualTemplate(journal);

    const result = await tmpl.execute({
      expenseAccountCode: '53-1401',
      grossAmount: new Decimal('5000.00'),
      vatAmount: new Decimal('0.00'),
      whtCategory: 'PND53',
      whtAmount: new Decimal('150.00'),
      depositAccountCode: '11-1101',
      vendorReference: 'TEST-PND53-NOVAT',
    });

    expect(result.entryNo).toMatch(/^JE-/);

    const je = await prisma.journalEntry.findFirst({
      where: { entryNumber: result.entryNo },
      include: { lines: true },
    });

    const lines = je!.lines;

    // No VAT line
    const vatLine = lines.find((l) => l.accountCode === '11-4101');
    expect(vatLine).toBeUndefined();

    // Balanced
    const totalDr = lines.reduce((s, l) => s.plus(l.debit.toString()), new Decimal(0));
    const totalCr = lines.reduce((s, l) => s.plus(l.credit.toString()), new Decimal(0));
    expect(totalDr.toFixed(2)).toBe(totalCr.toFixed(2));

    // Cr 21-3103 ภ.ง.ด. 53 ค้างจ่าย
    const whtLine = lines.find((l) => l.accountCode === '21-3103');
    expect(whtLine).toBeDefined();
    expect(new Decimal(whtLine!.credit.toString()).toFixed(2)).toBe('150.00');

    // Cr 11-1101 = 5000 - 150 = 4850
    const cashLine = lines.find((l) => l.accountCode === '11-1101');
    expect(cashLine).toBeDefined();
    expect(new Decimal(cashLine!.credit.toString()).toFixed(2)).toBe('4850.00');
  });

  it('routes PND1 to 21-3101 (payroll WHT)', async () => {
    const tmpl = new WhtAccrualTemplate(journal);

    const result = await tmpl.execute({
      expenseAccountCode: '53-1101',
      grossAmount: new Decimal('20000.00'),
      vatAmount: new Decimal('0.00'),
      whtCategory: 'PND1',
      whtAmount: new Decimal('400.00'),
      depositAccountCode: '11-1101',
      vendorReference: 'TEST-PND1-SALARY',
    });

    const je = await prisma.journalEntry.findFirst({
      where: { entryNumber: result.entryNo },
      include: { lines: true },
    });

    const whtLine = je!.lines.find((l) => l.accountCode === '21-3101');
    expect(whtLine).toBeDefined();
    expect(new Decimal(whtLine!.credit.toString()).toFixed(2)).toBe('400.00');

    // Balanced
    const totalDr = je!.lines.reduce((s, l) => s.plus(l.debit.toString()), new Decimal(0));
    const totalCr = je!.lines.reduce((s, l) => s.plus(l.credit.toString()), new Decimal(0));
    expect(totalDr.toFixed(2)).toBe(totalCr.toFixed(2));
  });

  it('routes PND53 to 21-3103 (corporate vendor WHT)', async () => {
    const tmpl = new WhtAccrualTemplate(journal);

    const result = await tmpl.execute({
      expenseAccountCode: '53-1401',
      grossAmount: new Decimal('8000.00'),
      vatAmount: new Decimal('560.00'),
      whtCategory: 'PND53',
      whtAmount: new Decimal('240.00'),
      depositAccountCode: '11-1101',
      vendorReference: 'TEST-PND53-CORP',
    });

    const je = await prisma.journalEntry.findFirst({
      where: { entryNumber: result.entryNo },
      include: { lines: true },
    });

    const whtLine = je!.lines.find((l) => l.accountCode === '21-3103');
    expect(whtLine).toBeDefined();
    expect(new Decimal(whtLine!.credit.toString()).toFixed(2)).toBe('240.00');

    // Balanced
    const totalDr = je!.lines.reduce((s, l) => s.plus(l.debit.toString()), new Decimal(0));
    const totalCr = je!.lines.reduce((s, l) => s.plus(l.credit.toString()), new Decimal(0));
    expect(totalDr.toFixed(2)).toBe(totalCr.toFixed(2));
  });
});
