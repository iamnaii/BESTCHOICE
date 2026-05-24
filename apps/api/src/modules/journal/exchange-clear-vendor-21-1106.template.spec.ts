import { Test } from '@nestjs/testing';
import { Decimal } from '@prisma/client/runtime/library';
import { InternalServerErrorException } from '@nestjs/common';
import { ExchangeClearVendor21_1106Template } from './cpa-templates/exchange-clear-vendor-21-1106.template';
import { JournalAutoService } from './journal-auto.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('ExchangeClearVendor21_1106Template', () => {
  let template: ExchangeClearVendor21_1106Template;
  let journal: any;

  beforeEach(async () => {
    journal = { createAndPost: jest.fn().mockResolvedValue({ id: 'je-uuid', entryNumber: 'JV-X' }) };
    const mod = await Test.createTestingModule({
      providers: [
        ExchangeClearVendor21_1106Template,
        { provide: PrismaService, useValue: {} },
        { provide: JournalAutoService, useValue: journal },
      ],
    }).compile();
    template = mod.get(ExchangeClearVendor21_1106Template);
  });

  it('perfect-offset: posts Dr 21-1101 + Dr 21-1102 = Cr 21-1106 (no cash leg)', async () => {
    await template.execute({
      newContractId: 'new',
      buyback: new Decimal('11000'),
      newVendorYodjat: new Decimal('10000'),
      newVendorCommission: new Decimal('1000'),
    });
    const lines = journal.createAndPost.mock.calls[0][0].lines;
    expect(lines.find((l: any) => l.accountCode === '21-1101').dr.toFixed(2)).toBe('10000.00');
    expect(lines.find((l: any) => l.accountCode === '21-1102').dr.toFixed(2)).toBe('1000.00');
    expect(lines.find((l: any) => l.accountCode === '21-1106').cr.toFixed(2)).toBe('11000.00');
    // No cash account (11-11xx or 11-12xx)
    expect(lines.find((l: any) => /^11-1[12]/.test(l.accountCode))).toBeUndefined();
    // Balanced
    const drSum = lines.reduce((s: Decimal, l: any) => s.plus(l.dr), new Decimal(0));
    const crSum = lines.reduce((s: Decimal, l: any) => s.plus(l.cr), new Decimal(0));
    expect(drSum.toFixed(2)).toBe(crSum.toFixed(2));
  });

  it('throws when buyback != vendor sum (defensive)', async () => {
    await expect(
      template.execute({
        newContractId: 'new',
        buyback: new Decimal('11000'),
        newVendorYodjat: new Decimal('10000'),
        newVendorCommission: new Decimal('500'),
      }),
    ).rejects.toThrow(InternalServerErrorException);
  });
});
