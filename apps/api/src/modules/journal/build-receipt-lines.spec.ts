import { Decimal } from '@prisma/client/runtime/library';
import { buildReceiptLines } from './build-receipt-lines';
import { SplitReceiptResult } from './split-receipt';

const D = (n: number | string) => new Decimal(n);

const split = (over: Partial<SplitReceiptResult> = {}): SplitReceiptResult => ({
  principalCleared: D(0),
  lateFeePortion: D(0),
  overpayRounding: D(0),
  underpayRounding: D(0),
  principalRemainingAfter: D(0),
  ...over,
});

const sum = (lines: { dr: Decimal; cr: Decimal }[], k: 'dr' | 'cr') =>
  lines.reduce((s, l) => s.plus(l[k]), new Decimal(0));

describe('buildReceiptLines', () => {
  it('plain full receipt (no late fee, no advance): Dr cash / Cr 11-2103, balanced', () => {
    const lines = buildReceiptLines({
      split: split({ principalCleared: D('1515.83') }),
      debitAccountCode: '11-1201',
      delta: D('1515.83'),
      advanceConsume: D(0),
      advanceCredit: D(0),
      lateFeeWaived: D(0),
      overpayCode: '53-1503',
      underpayCode: '52-1104',
    });
    expect(lines.find((l) => l.accountCode === '11-1201')?.dr.toFixed(2)).toBe('1515.83');
    expect(lines.find((l) => l.accountCode === '11-2103')?.cr.toFixed(2)).toBe('1515.83');
    expect(lines.some((l) => l.accountCode === '52-1105')).toBe(false);
    expect(sum(lines, 'dr').toFixed(2)).toBe(sum(lines, 'cr').toFixed(2));
  });

  it('GROSS WAIVER golden: Dr cash 1456.66 + Dr 21-1103 84.17 + Dr 52-1105 25 / Cr 11-2103 1515.83 + Cr 42-1103 50 (one line)', () => {
    const lines = buildReceiptLines({
      // splitReceipt was fed the NET late fee (gross 50 − waived 25 = 25)
      split: split({ principalCleared: D('1515.83'), lateFeePortion: D('25') }),
      debitAccountCode: '11-1201',
      delta: D('1456.66'),
      advanceConsume: D('84.17'),
      advanceCredit: D(0),
      lateFeeWaived: D('25'),
      overpayCode: '53-1503',
      underpayCode: '52-1104',
    });

    expect(lines.find((l) => l.accountCode === '11-1201')?.dr.toFixed(2)).toBe('1456.66');
    expect(lines.find((l) => l.accountCode === '21-1103' && l.dr.gt(0))?.dr.toFixed(2)).toBe('84.17');
    expect(lines.find((l) => l.accountCode === '52-1105')?.dr.toFixed(2)).toBe('25.00');
    expect(lines.find((l) => l.accountCode === '11-2103')?.cr.toFixed(2)).toBe('1515.83');

    // Cr 42-1103 must be a SINGLE line = gross (net 25 + waived 25 = 50) — matches mockup
    const cr42 = lines.filter((l) => l.accountCode === '42-1103');
    expect(cr42).toHaveLength(1);
    expect(cr42[0].cr.toFixed(2)).toBe('50.00');

    // Balanced at 1,565.83
    expect(sum(lines, 'dr').toFixed(2)).toBe('1565.83');
    expect(sum(lines, 'cr').toFixed(2)).toBe('1565.83');
  });

  it('late fee with NO waiver: Cr 42-1103 = full late fee, no 52-1105', () => {
    const lines = buildReceiptLines({
      split: split({ principalCleared: D('1515.83'), lateFeePortion: D('50') }),
      debitAccountCode: '11-1101',
      delta: D('1565.83'),
      advanceConsume: D(0),
      advanceCredit: D(0),
      lateFeeWaived: D(0),
      overpayCode: '53-1503',
      underpayCode: '52-1104',
    });
    expect(lines.find((l) => l.accountCode === '42-1103')?.cr.toFixed(2)).toBe('50.00');
    expect(lines.some((l) => l.accountCode === '52-1105')).toBe(false);
    expect(sum(lines, 'dr').toFixed(2)).toBe(sum(lines, 'cr').toFixed(2));
  });

  it('overpay + underpay rounding + advance credit route to their accounts', () => {
    const over = buildReceiptLines({
      split: split({ principalCleared: D('1000'), overpayRounding: D('0.50') }),
      debitAccountCode: '11-1101', delta: D('1000.50'), advanceConsume: D(0),
      advanceCredit: D(0), lateFeeWaived: D(0), overpayCode: '53-1503', underpayCode: '52-1104',
    });
    expect(over.find((l) => l.accountCode === '53-1503')?.cr.toFixed(2)).toBe('0.50');

    const under = buildReceiptLines({
      split: split({ principalCleared: D('1000'), underpayRounding: D('0.50') }),
      debitAccountCode: '11-1101', delta: D('999.50'), advanceConsume: D(0),
      advanceCredit: D(0), lateFeeWaived: D(0), overpayCode: '53-1503', underpayCode: '52-1104',
    });
    expect(under.find((l) => l.accountCode === '52-1104')?.dr.toFixed(2)).toBe('0.50');

    const credit = buildReceiptLines({
      split: split({ principalCleared: D('900') }),
      debitAccountCode: '11-1101', delta: D('1000'), advanceConsume: D(0),
      advanceCredit: D('100'), lateFeeWaived: D(0), overpayCode: '53-1503', underpayCode: '52-1104',
    });
    expect(credit.find((l) => l.accountCode === '21-1103' && l.cr.gt(0))?.cr.toFixed(2)).toBe('100.00');
  });

  // PR4 ต2(ก) — เงินเข้าถัง (Cr 21-1103) = พักภาษีขาย Dr 21-2102 / Cr 21-2101 ในรายการเดียวกัน (G3: 500 → 32.71)
  it('advanceCredit 500 → park VAT 32.71 (Dr 21-2102 / Cr 21-2101) right after Cr 21-1103, byte-identical description', () => {
    const lines = buildReceiptLines({
      split: split({ principalCleared: D('1515.83') }),
      debitAccountCode: '11-1101', delta: D('2015.83'), advanceConsume: D(0),
      advanceCredit: D('500'), lateFeeWaived: D(0), overpayCode: '53-1503', underpayCode: '52-1104',
    });
    const codes = lines.map((l) => l.accountCode);
    const park = codes.indexOf('21-1103');
    expect(codes.slice(park)).toEqual(['21-1103', '21-2102', '21-2101']);
    const dr2102 = lines.find((l) => l.accountCode === '21-2102')!;
    const cr2101 = lines.find((l) => l.accountCode === '21-2101')!;
    expect(dr2102.dr.toFixed(2)).toBe('32.71');
    expect(dr2102.cr.toFixed(2)).toBe('0.00');
    expect(cr2101.cr.toFixed(2)).toBe('32.71');
    expect(dr2102.description).toBe('ภาษีขายของเงินรับล่วงหน้า (รับรู้ ณ วันรับ)');
    expect(cr2101.description).toBe(dr2102.description);
    // ยอด Dr = Cr ยังสมดุล (คู่ภาษีสมดุลกันเอง)
    const sum = (k: 'dr' | 'cr') => lines.reduce((s, l) => s.plus(l[k]), D(0));
    expect(sum('dr').toFixed(2)).toBe(sum('cr').toFixed(2));
  });

  // PR4 ต3(ก) — เงินออกจากถัง (Dr 21-1103 / Dr 21-5101) = ขากลับ Dr 21-2101 / Cr 21-2102 เท่าที่ผู้เรียก resolve มา
  it('advanceConsume 250 + advanceVatConsume 16.36 → Dr 21-2101 / Cr 21-2102 16.36 right after Dr 21-1103, balanced', () => {
    const lines = buildReceiptLines({
      split: split({ principalCleared: D('1515.83') }),
      debitAccountCode: '11-1101', delta: D('1265.83'), advanceConsume: D('250'),
      advanceCredit: D(0), lateFeeWaived: D(0), overpayCode: '53-1503', underpayCode: '52-1104',
      advanceVatConsume: D('16.36'),
    });
    const codes = lines.map((l) => l.accountCode);
    const i = codes.indexOf('21-1103');
    expect(codes.slice(i, i + 3)).toEqual(['21-1103', '21-2101', '21-2102']);
    const dr2101 = lines.find((l) => l.accountCode === '21-2101')!;
    const cr2102 = lines.find((l) => l.accountCode === '21-2102')!;
    expect(dr2101.dr.toFixed(2)).toBe('16.36');
    expect(cr2102.cr.toFixed(2)).toBe('16.36');
    expect(dr2101.description).toBe('ภาษีขายของเงินรับล่วงหน้าที่หักเข้างวด (รับรู้แล้วตอนรับ)');
    const sum = (k: 'dr' | 'cr') => lines.reduce((s, l) => s.plus(l[k]), D(0));
    expect(sum('dr').toFixed(2)).toBe(sum('cr').toFixed(2));
  });

  it('ใช้เครดิตชำระ (debit 21-5101) + advanceVatConsume → ขากลับตามหลังบรรทัดเดบิต · ไม่ส่ง advanceVatConsume = ไม่มีขากลับ (G7)', () => {
    const withVat = buildReceiptLines({
      split: split({ principalCleared: D('1515.83') }),
      debitAccountCode: '21-5101', delta: D('1515.83'), advanceConsume: D(0),
      advanceCredit: D(0), lateFeeWaived: D(0), overpayCode: '53-1503', underpayCode: '52-1104',
      advanceVatConsume: D('99.17'),
    });
    expect(withVat.map((l) => l.accountCode).slice(0, 3)).toEqual(['21-5101', '21-2101', '21-2102']);
    expect(withVat.find((l) => l.accountCode === '21-2101')!.dr.toFixed(2)).toBe('99.17');

    const noVat = buildReceiptLines({
      split: split({ principalCleared: D('1515.83') }),
      debitAccountCode: '21-5101', delta: D('1515.83'), advanceConsume: D(0),
      advanceCredit: D(0), lateFeeWaived: D(0), overpayCode: '53-1503', underpayCode: '52-1104',
    });
    expect(noVat.some((l) => l.accountCode === '21-2101' || l.accountCode === '21-2102')).toBe(false);
  });

  it('advanceCredit 0 → no 21-2102 / 21-2101 lines (ขาภาษีของเงินพักเท่านั้น)', () => {
    const lines = buildReceiptLines({
      split: split({ principalCleared: D('1515.83') }),
      debitAccountCode: '11-1101', delta: D('1515.83'), advanceConsume: D(0),
      advanceCredit: D(0), lateFeeWaived: D(0), overpayCode: '53-1503', underpayCode: '52-1104',
    });
    expect(lines.some((l) => l.accountCode === '21-2102' || l.accountCode === '21-2101')).toBe(false);
  });
});
