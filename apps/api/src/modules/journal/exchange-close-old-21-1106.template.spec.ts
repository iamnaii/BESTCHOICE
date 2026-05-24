import { Test } from '@nestjs/testing';
import { Decimal } from '@prisma/client/runtime/library';
import { ExchangeCloseOld21_1106Template } from './cpa-templates/exchange-close-old-21-1106.template';
import { JournalAutoService } from './journal-auto.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('ExchangeCloseOld21_1106Template', () => {
  let template: ExchangeCloseOld21_1106Template;
  let journal: any;

  beforeEach(async () => {
    journal = { createAndPost: jest.fn().mockResolvedValue({ id: 'je-uuid', entryNumber: 'JV-X' }) };
    const mod = await Test.createTestingModule({
      providers: [
        ExchangeCloseOld21_1106Template,
        { provide: PrismaService, useValue: {} },
        { provide: JournalAutoService, useValue: journal },
      ],
    }).compile();
    template = mod.get(ExchangeCloseOld21_1106Template);
  });

  it('LOSS branch: buyback 11,000 < (Gross 11,333.28 + VAT 793.36 = 12,126.64) → Dr 51-1102 1,126.64', async () => {
    await template.execute({
      oldContractId: 'old',
      buyback: new Decimal('11000'),
      oldGrossOutstanding: new Decimal('11333.28'),
      oldVatReceivableOutstanding: new Decimal('793.36'),
      oldUnearnedInterestOutstanding: new Decimal('2666.64'),
      oldDeferredVatOutstanding: new Decimal('793.36'),
    });

    const lines = journal.createAndPost.mock.calls[0][0].lines;
    const loss = lines.find((l: any) => l.accountCode === '51-1102');
    expect(loss).toBeDefined();
    expect(loss.dr.toFixed(2)).toBe('1126.64');
    const gain = lines.find((l: any) => l.accountCode === '41-1102');
    expect(gain).toBeUndefined();
    // Balance
    const drSum = lines.reduce((s: Decimal, l: any) => s.plus(l.dr), new Decimal(0));
    const crSum = lines.reduce((s: Decimal, l: any) => s.plus(l.cr), new Decimal(0));
    expect(drSum.toFixed(2)).toBe(crSum.toFixed(2));
  });

  it('GAIN branch: buyback 13,000 > 12,126.64 → Cr 41-1102 873.36', async () => {
    await template.execute({
      oldContractId: 'old',
      buyback: new Decimal('13000'),
      oldGrossOutstanding: new Decimal('11333.28'),
      oldVatReceivableOutstanding: new Decimal('793.36'),
      oldUnearnedInterestOutstanding: new Decimal('2666.64'),
      oldDeferredVatOutstanding: new Decimal('793.36'),
    });
    const lines = journal.createAndPost.mock.calls[0][0].lines;
    const gain = lines.find((l: any) => l.accountCode === '41-1102');
    expect(gain.cr.toFixed(2)).toBe('873.36');
    expect(lines.find((l: any) => l.accountCode === '51-1102')).toBeUndefined();
  });

  it('PERFECT branch: buyback 12,126.64 == threshold → no P&L line', async () => {
    await template.execute({
      oldContractId: 'old',
      buyback: new Decimal('12126.64'),
      oldGrossOutstanding: new Decimal('11333.28'),
      oldVatReceivableOutstanding: new Decimal('793.36'),
      oldUnearnedInterestOutstanding: new Decimal('2666.64'),
      oldDeferredVatOutstanding: new Decimal('793.36'),
    });
    const lines = journal.createAndPost.mock.calls[0][0].lines;
    expect(lines.find((l: any) => l.accountCode === '51-1102')).toBeUndefined();
    expect(lines.find((l: any) => l.accountCode === '41-1102')).toBeUndefined();
  });
});
