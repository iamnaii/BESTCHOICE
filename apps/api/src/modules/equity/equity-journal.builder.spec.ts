import { Prisma } from '@prisma/client';
import { buildEquityJournal, EQ_ACCOUNTS } from './equity-journal.builder';

const D = Prisma.Decimal;
const line = (
  over: Partial<{ amount: string; premium: string; paid: string; wht: string }> = {},
) => ({
  amount: new D(over.amount ?? '0'),
  premium: new D(over.premium ?? '0'),
  paid: new D(over.paid ?? '0'),
  wht: new D(over.wht ?? '0'),
});
const sum = (ls: { dr: Prisma.Decimal; cr: Prisma.Decimal }[]) => ({
  dr: ls.reduce((s, l) => s.plus(l.dr), new D(0)),
  cr: ls.reduce((s, l) => s.plus(l.cr), new D(0)),
});
const byCode = (ls: ReturnType<typeof buildEquityJournal>, code: string) =>
  ls.find((l) => l.accountCode === code);

describe('buildEquityJournal — goldens (Handover §8)', () => {
  it('CAP_INIT partial 1M/paid 700k → Dr bank 700k + Dr 11-1310 300k / Cr 31-1101 1M', () => {
    const j = buildEquityJournal({
      txnType: 'CAP_INIT',
      paymentAccountCode: '11-1201',
      lines: [
        line({ amount: '500000', paid: '500000' }),
        line({ amount: '300000', paid: '100000' }),
        line({ amount: '200000', paid: '100000' }),
      ],
    });
    expect(j).toHaveLength(3);
    expect(byCode(j, '11-1201')!.dr.toFixed(2)).toBe('700000.00');
    expect(byCode(j, EQ_ACCOUNTS.UNPAID_CAPITAL)!.dr.toFixed(2)).toBe('300000.00');
    expect(byCode(j, EQ_ACCOUNTS.COMMON_STOCK)!.cr.toFixed(2)).toBe('1000000.00');
    const t = sum(j);
    expect(t.dr.equals(t.cr)).toBe(true);
  });

  it('CAP_INIT paid เต็ม → ไม่มีบรรทัด 11-1310', () => {
    const j = buildEquityJournal({
      txnType: 'CAP_INIT',
      paymentAccountCode: '11-1201',
      lines: [line({ amount: '1000000', paid: '1000000' })],
    });
    expect(j).toHaveLength(2);
    expect(byCode(j, EQ_ACCOUNTS.UNPAID_CAPITAL)).toBeUndefined();
  });

  it('CAP_INIT paid > par รวม → throw (กัน JE ไม่ balance)', () => {
    expect(() =>
      buildEquityJournal({
        txnType: 'CAP_INIT',
        paymentAccountCode: '11-1201',
        lines: [line({ amount: '100', paid: '150' })],
      }),
    ).toThrow(/เกินมูลค่าหุ้นที่จองรวม/);
  });

  it('CAP_INC 500k + premium 100k → Dr bank 600k / Cr 31-1101 500k + Cr 31-1102 100k', () => {
    const j = buildEquityJournal({
      txnType: 'CAP_INC',
      paymentAccountCode: '11-1201',
      lines: [line({ amount: '500000', premium: '100000' })],
    });
    expect(byCode(j, '11-1201')!.dr.toFixed(2)).toBe('600000.00');
    expect(byCode(j, EQ_ACCOUNTS.COMMON_STOCK)!.cr.toFixed(2)).toBe('500000.00');
    expect(byCode(j, EQ_ACCOUNTS.SHARE_PREMIUM)!.cr.toFixed(2)).toBe('100000.00');
  });

  it('CAP_INC premium 0 → ไม่มีบรรทัด 31-1102', () => {
    const j = buildEquityJournal({
      txnType: 'CAP_INC',
      paymentAccountCode: '11-1201',
      lines: [line({ amount: '500000' })],
    });
    expect(byCode(j, EQ_ACCOUNTS.SHARE_PREMIUM)).toBeUndefined();
  });

  it('CAP_DEC 200k → Dr 31-1101 / Cr bank', () => {
    const j = buildEquityJournal({
      txnType: 'CAP_DEC',
      paymentAccountCode: '11-1201',
      lines: [line({ amount: '200000' })],
    });
    expect(byCode(j, EQ_ACCOUNTS.COMMON_STOCK)!.dr.toFixed(2)).toBe('200000.00');
    expect(byCode(j, '11-1201')!.cr.toFixed(2)).toBe('200000.00');
  });

  it('DRAW 50k → Dr 22-1102 / Cr cash', () => {
    const j = buildEquityJournal({
      txnType: 'DRAW',
      paymentAccountCode: '11-1101',
      lines: [line({ amount: '50000' })],
    });
    expect(byCode(j, EQ_ACCOUNTS.DIRECTOR_DRAWING)!.dr.toFixed(2)).toBe('50000.00');
    expect(byCode(j, '11-1101')!.cr.toFixed(2)).toBe('50000.00');
  });

  it('DIV_DEC 200k → Dr 32-1101 / Cr 21-4104', () => {
    const j = buildEquityJournal({
      txnType: 'DIV_DEC',
      lines: [line({ amount: '100000' }), line({ amount: '60000' }), line({ amount: '40000' })],
    });
    expect(byCode(j, EQ_ACCOUNTS.RETAINED_EARNINGS)!.dr.toFixed(2)).toBe('200000.00');
    expect(byCode(j, EQ_ACCOUNTS.DIVIDEND_PAYABLE)!.cr.toFixed(2)).toBe('200000.00');
  });

  it('DIV_PAY 200k หัก WHT 20k → Dr 21-4104 200k / Cr bank 180k + Cr 21-3104 20k', () => {
    const j = buildEquityJournal({
      txnType: 'DIV_PAY',
      paymentAccountCode: '11-1201',
      lines: [
        line({ amount: '100000', wht: '10000' }),
        line({ amount: '60000', wht: '6000' }),
        line({ amount: '40000', wht: '4000' }),
      ],
    });
    expect(byCode(j, EQ_ACCOUNTS.DIVIDEND_PAYABLE)!.dr.toFixed(2)).toBe('200000.00');
    expect(byCode(j, '11-1201')!.cr.toFixed(2)).toBe('180000.00');
    expect(byCode(j, EQ_ACCOUNTS.WHT_DIVIDEND)!.cr.toFixed(2)).toBe('20000.00');
  });

  it('DIV_PAY WHT 0 ทุกบรรทัด → ไม่มีบรรทัด 21-3104', () => {
    const j = buildEquityJournal({
      txnType: 'DIV_PAY',
      paymentAccountCode: '11-1201',
      lines: [line({ amount: '100000' })],
    });
    expect(byCode(j, EQ_ACCOUNTS.WHT_DIVIDEND)).toBeUndefined();
    expect(byCode(j, '11-1201')!.cr.toFixed(2)).toBe('100000.00');
  });

  it('PRIOR_ADJ DR_OTHER_CR_RE → Dr paAccount / Cr 32-1101', () => {
    const j = buildEquityJournal({
      txnType: 'PRIOR_ADJ',
      paAccountCode: '11-1201',
      paAmount: new D('15000'),
      paDirection: 'DR_OTHER_CR_RE',
      lines: [],
    });
    expect(byCode(j, '11-1201')!.dr.toFixed(2)).toBe('15000.00');
    expect(byCode(j, EQ_ACCOUNTS.RETAINED_EARNINGS)!.cr.toFixed(2)).toBe('15000.00');
  });

  it('PRIOR_ADJ DR_RE_CR_OTHER → Dr 32-1101 / Cr paAccount', () => {
    const j = buildEquityJournal({
      txnType: 'PRIOR_ADJ',
      paAccountCode: '11-1201',
      paAmount: new D('15000'),
      paDirection: 'DR_RE_CR_OTHER',
      lines: [],
    });
    expect(byCode(j, EQ_ACCOUNTS.RETAINED_EARNINGS)!.dr.toFixed(2)).toBe('15000.00');
    expect(byCode(j, '11-1201')!.cr.toFixed(2)).toBe('15000.00');
  });

  it('ทุกประเภท: ΣDr = ΣCr เสมอ (โครงสร้าง balanced)', () => {
    const cases = [
      {
        txnType: 'CAP_INIT' as const,
        paymentAccountCode: '11-1101',
        lines: [line({ amount: '999.99', paid: '250.00' })],
      },
      {
        txnType: 'DIV_PAY' as const,
        paymentAccountCode: '11-1101',
        lines: [line({ amount: '333.33', wht: '33.33' })],
      },
    ];
    for (const c of cases) {
      const t = sum(buildEquityJournal(c));
      expect(t.dr.equals(t.cr)).toBe(true);
    }
  });
});
