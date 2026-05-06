import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { AutoJournalService } from '../services/auto-journal.service';
import { goldenCases } from './fixtures/golden-cases';

const D = (n: number | string) => new Prisma.Decimal(n);

const sumDr = (lines: any[]) =>
  lines.reduce((s, l) => s.plus(l.debit), D(0));
const sumCr = (lines: any[]) =>
  lines.reduce((s, l) => s.plus(l.credit), D(0));

describe('AutoJournalService — Pattern A', () => {
  let service: AutoJournalService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [AutoJournalService],
    }).compile();
    service = module.get(AutoJournalService);
  });

  it('bank interest (no VAT, with WHT 15%) — balanced', () => {
    const lines = service.generate(goldenCases.bankInterest);
    expect(sumDr(lines).eq(sumCr(lines))).toBe(true);
    expect(lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ accountCode: '11-1201', debit: D(850), credit: D(0) }),
        expect.objectContaining({ accountCode: '11-4103', debit: D(150), credit: D(0) }),
        expect.objectContaining({ accountCode: '42-1102', debit: D(0), credit: D(1000) }),
      ]),
    );
    expect(lines).toHaveLength(3);
  });

  it('gain on disposal (VAT 7%, WHT 1%) — balanced + VAT line', () => {
    const lines = service.generate(goldenCases.gainOnDisposal);
    expect(sumDr(lines).eq(sumCr(lines))).toBe(true);
    expect(
      lines.find((l) => l.accountCode === '21-2101' && l.credit.eq(700)),
    ).toBeDefined();
    expect(
      lines.find((l) => l.accountCode === '42-1105' && l.credit.eq(10000)),
    ).toBeDefined();
  });

  it('bank interest with bank fee — adjustment in Dr (ขาด)', () => {
    const lines = service.generate(goldenCases.bankInterestWithFee);
    expect(sumDr(lines).eq(sumCr(lines))).toBe(true);
    expect(
      lines.find(
        (l) => l.accountCode === '53-1503' && l.debit.eq(10),
      ),
    ).toBeDefined();
  });

  it('over-payment — adjustment in Cr (เกิน)', () => {
    const overpaid = {
      ...goldenCases.bankInterest,
      amountReceived: D(870),
      adjustments: [
        { lineNo: 1, accountCode: '53-1503', amount: D(20), note: 'roundup' },
      ],
    };
    const lines = service.generate(overpaid);
    expect(sumDr(lines).eq(sumCr(lines))).toBe(true);
    expect(
      lines.find(
        (l) => l.accountCode === '53-1503' && l.credit.eq(20),
      ),
    ).toBeDefined();
  });

  it('omits Dr cash line when amountReceived = 0 (rare edge)', () => {
    const noCash = { ...goldenCases.bankInterest, amountReceived: D(0) };
    const lines = service.generate(noCash);
    expect(lines.find((l) => l.accountCode === '11-1201')).toBeUndefined();
  });

  it('multi-item document — multiple Cr 42-XXXX lines', () => {
    const multi = {
      ...goldenCases.gainOnDisposal,
      items: [
        { ...goldenCases.gainOnDisposal.items[0] },
        {
          lineNo: 2,
          accountCode: '42-1105',
          accountName: 'กำไรจากการจำหน่ายสินทรัพย์',
          quantity: D(1),
          unitAmount: D(5000),
          discountAmount: D(0),
          vatPct: D(7),
          whtPct: D(1),
          amountBeforeVat: D(5000),
          vatAmount: D(350),
          whtAmount: D(50),
        },
      ],
      amountReceived: D(15900),
      incomeGross: D(15000),
      vatAmount: D(1050),
      whtAmount: D(150),
      netReceived: D(15900),
      totalAmount: D(16050),
    };
    const lines = service.generate(multi);
    expect(sumDr(lines).eq(sumCr(lines))).toBe(true);
    const incomeLines = lines.filter((l) => l.accountCode === '42-1105');
    expect(incomeLines).toHaveLength(2);
  });
});
