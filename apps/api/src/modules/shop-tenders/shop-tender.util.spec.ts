import { BadRequestException } from '@nestjs/common';
import { firstTransferReference, normalizeTenders } from './shop-tender.util';

describe('normalizeTenders', () => {
  const amounts = (rows: { amount: { toString(): string } }[]) => rows.map((r) => r.amount.toString());

  it('accepts a single cash tender for the full amount and drops any reference on cash', () => {
    const rows = normalizeTenders([{ method: 'CASH', amount: 12500, reference: 'ignored' }], 12500);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ method: 'CASH', reference: null, seq: 1, seqTotal: 1 });
    expect(amounts(rows)).toEqual(['12500']);
  });

  it('accepts a split bill whose rows add up exactly, numbering them 1..n', () => {
    const rows = normalizeTenders(
      [
        { method: 'CASH', amount: 5000 },
        { method: 'BANK_TRANSFER', amount: '4900.50', reference: '  014820931177 ' },
      ],
      '9900.50',
    );
    expect(rows.map((r) => [r.method, r.seq, r.seqTotal, r.reference])).toEqual([
      ['CASH', 1, 2, null],
      ['BANK_TRANSFER', 2, 2, '014820931177'],
    ]);
    expect(amounts(rows)).toEqual(['5000', '4900.5']);
  });

  it.each(['BANK_TRANSFER', 'QR_EWALLET'])('rejects %s without a reference', (method) => {
    expect(() => normalizeTenders([{ method, amount: 100 }], 100)).toThrow(BadRequestException);
    expect(() => normalizeTenders([{ method, amount: 100, reference: '   ' }], 100)).toThrow(/เลขอ้างอิง/);
  });

  it('rejects a reference shorter than 6 characters or longer than 128', () => {
    expect(() => normalizeTenders([{ method: 'BANK_TRANSFER', amount: 100, reference: '12345' }], 100)).toThrow(/อย่างน้อย 6/);
    expect(() => normalizeTenders([{ method: 'BANK_TRANSFER', amount: 100, reference: 'x'.repeat(129) }], 100)).toThrow(/128/);
    expect(normalizeTenders([{ method: 'BANK_TRANSFER', amount: 100, reference: '123456' }], 100)[0].reference).toBe('123456');
  });

  it('rejects rows that do not add up to the amount due — short or over', () => {
    expect(() => normalizeTenders([{ method: 'CASH', amount: 9500 }], 9900)).toThrow(/ยังขาด 400/);
    expect(() => normalizeTenders([{ method: 'CASH', amount: 10000 }], 9900)).toThrow(/เกิน 100/);
  });

  it('rejects more than 4 rows, zero or negative amounts, sub-satang amounts and unknown methods', () => {
    const five = Array.from({ length: 5 }, () => ({ method: 'CASH', amount: 20 }));
    expect(() => normalizeTenders(five, 100)).toThrow(/4/);
    expect(() => normalizeTenders([{ method: 'CASH', amount: 0 }, { method: 'CASH', amount: 100 }], 100)).toThrow(/มากกว่า 0/);
    expect(() => normalizeTenders([{ method: 'CASH', amount: -1 }], -1)).toThrow(BadRequestException);
    expect(() => normalizeTenders([{ method: 'CASH', amount: '100.005' }], '100.005')).toThrow(/ทศนิยม/);
    expect(() => normalizeTenders([{ method: 'CARD', amount: 100 }], 100)).toThrow(/วิธีรับเงิน/);
    expect(() => normalizeTenders([{ method: 'CREDIT_BALANCE', amount: 100 }], 100)).toThrow(/วิธีรับเงิน/);
  });

  it('returns no rows when nothing is due, and refuses rows sent for a zero amount', () => {
    expect(normalizeTenders(undefined, 0, { method: 'BANK_TRANSFER', reference: 'unused' })).toEqual([]);
    expect(normalizeTenders([], 0)).toEqual([]);
    expect(() => normalizeTenders([{ method: 'CASH', amount: 100 }], 0)).toThrow(/ไม่มียอดที่ต้องรับ/);
  });

  describe('legacy single-method callers (no tenders array)', () => {
    it('builds one row from the old fields and defaults an omitted method to CASH', () => {
      expect(normalizeTenders(undefined, 3000, { method: 'CASH' })).toMatchObject([{ method: 'CASH', seq: 1, seqTotal: 1 }]);
      expect(normalizeTenders(undefined, 3000, {})).toMatchObject([{ method: 'CASH' }]);
      expect(normalizeTenders([], 3000, { method: 'QR_EWALLET', reference: 'QR5569012044' })).toMatchObject([
        { method: 'QR_EWALLET', reference: 'QR5569012044' },
      ]);
    });

    it('applies the same mandatory-reference rule to the old fields', () => {
      expect(() => normalizeTenders(undefined, 3000, { method: 'BANK_TRANSFER' })).toThrow(/เลขอ้างอิง/);
    });
  });
});

describe('firstTransferReference', () => {
  it('returns the first non-cash reference, or null for an all-cash bill', () => {
    const split = normalizeTenders(
      [
        { method: 'CASH', amount: 1 },
        { method: 'QR_EWALLET', amount: 2, reference: 'QR-000001' },
        { method: 'BANK_TRANSFER', amount: 3, reference: 'TR-000002' },
      ],
      6,
    );
    expect(firstTransferReference(split)).toBe('QR-000001');
    expect(firstTransferReference(normalizeTenders([{ method: 'CASH', amount: 6 }], 6))).toBeNull();
  });
});
