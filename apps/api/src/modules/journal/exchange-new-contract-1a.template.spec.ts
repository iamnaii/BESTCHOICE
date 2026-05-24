import { Test } from '@nestjs/testing';
import { Decimal } from '@prisma/client/runtime/library';
import { ExchangeNewContract1ATemplate } from './cpa-templates/exchange-new-contract-1a.template';
import { JournalAutoService } from './journal-auto.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('ExchangeNewContract1ATemplate', () => {
  let template: ExchangeNewContract1ATemplate;
  let prisma: any;
  let journal: any;

  beforeEach(async () => {
    prisma = { contract: { findUniqueOrThrow: jest.fn() } };
    journal = {
      createAndPost: jest.fn().mockResolvedValue({ id: 'je-uuid', entryNumber: 'JV-2026-001' }),
    };
    const mod = await Test.createTestingModule({
      providers: [
        ExchangeNewContract1ATemplate,
        { provide: PrismaService, useValue: prisma },
        { provide: JournalAutoService, useValue: journal },
      ],
    }).compile();
    template = mod.get(ExchangeNewContract1ATemplate);
  });

  it('posts new-contract activation JE (mirror of ContractActivation1A)', async () => {
    prisma.contract.findUniqueOrThrow.mockResolvedValue({
      id: 'new-ctr',
      contractNumber: 'EX-001',
      financedAmount: new Decimal('10000'),
      storeCommission: new Decimal('1000'),
      interestTotal: new Decimal('2666.64'),
      vatAmount: new Decimal('793.36'),
    });

    const result = await template.execute('new-ctr');

    expect(result.entryNumber).toBe('JV-2026-001');
    expect(journal.createAndPost).toHaveBeenCalledTimes(1);
    const call = journal.createAndPost.mock.calls[0][0];
    // Balance check
    const drSum = call.lines.reduce((s: Decimal, l: any) => s.plus(l.dr), new Decimal(0));
    const crSum = call.lines.reduce((s: Decimal, l: any) => s.plus(l.cr), new Decimal(0));
    expect(drSum.toFixed(2)).toBe(crSum.toFixed(2));
    // 6 expected lines with correct account codes
    const codes = call.lines.map((l: any) => l.accountCode);
    expect(codes).toEqual(
      expect.arrayContaining(['11-2101', '11-2105', '21-1101', '21-1102', '11-2106', '21-2102']),
    );
    expect(codes).toHaveLength(6);
  });

  it('falls back to 10% commission when storeCommission is null', async () => {
    prisma.contract.findUniqueOrThrow.mockResolvedValue({
      id: 'new-ctr-2',
      contractNumber: 'EX-002',
      financedAmount: new Decimal('10000'),
      storeCommission: null,
      interestTotal: new Decimal('2000'),
      vatAmount: null,
    });

    await template.execute('new-ctr-2');

    const call = journal.createAndPost.mock.calls[0][0];
    const drSum = call.lines.reduce((s: Decimal, l: any) => s.plus(l.dr), new Decimal(0));
    const crSum = call.lines.reduce((s: Decimal, l: any) => s.plus(l.cr), new Decimal(0));
    expect(drSum.toFixed(2)).toBe(crSum.toFixed(2));

    // commission line (21-1102 Cr) should be 10% of 10000 = 1000.00
    const commLine = call.lines.find((l: any) => l.accountCode === '21-1102');
    expect(commLine.cr.toFixed(2)).toBe('1000.00');
  });

  it('returns { id, entryNumber } from createAndPost', async () => {
    prisma.contract.findUniqueOrThrow.mockResolvedValue({
      id: 'new-ctr-3',
      contractNumber: 'EX-003',
      financedAmount: new Decimal('5000'),
      storeCommission: new Decimal('500'),
      interestTotal: new Decimal('1000'),
      vatAmount: new Decimal('455'),
    });

    const result = await template.execute('new-ctr-3');
    expect(result.id).toBe('je-uuid');
    expect(result.entryNumber).toBe('JV-2026-001');
  });
});
