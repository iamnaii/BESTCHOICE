import { Prisma } from '@prisma/client';
import type { LegacyReceipt } from '../legacy-book';
import {
  matchStatement,
  parseStatementCols,
  parseStatementCsv,
  statementCreditsCsv,
  type StatementCredit,
} from '../statement-matcher';

/** จับคู่ statement ธนาคารกับรายการรับเงินระบบเก่า — ข้อมูลสังเคราะห์ทั้งหมด (คำอธิบาย "โอนเงิน ทดสอบ") */

const D = (value: string | number) => new Prisma.Decimal(value);
/** เที่ยงคืนกรุงเทพของ `yyyy-mm-dd` (หรือ ISO เต็ม) */
const at = (date: string) => new Date(date.length === 10 ? `${date}T00:00:00+07:00` : date);

let nextLine = 2;
function c(amount: string | number, date: string): StatementCredit {
  return { line: nextLine++, date: at(date), amount: D(amount), description: 'โอนเงิน ทดสอบ' };
}

let nextReceipt = 1;
function rc(amount: string | number, date: string): LegacyReceipt {
  const id = String(nextReceipt++);
  return {
    legacyId: id,
    kind: 'INSTALLMENT',
    installmentLegacyId: `9${id}`,
    closeLegacyId: null,
    date: at(date),
    amount: D(amount),
    installment: D(amount),
    mulct: D(0),
    discount: D(0),
    slipPath: null,
    createdAt: at(date),
  };
}

/** ผลในรูปที่อ่านง่าย: คู่ = [บรรทัด, legacyId] · ที่เหลือ = บรรทัด */
function summary(result: ReturnType<typeof matchStatement>) {
  return {
    matched: result.matched.map(([credit, receipt]) => [credit.line, receipt.legacyId]),
    unmatched: result.unmatched.map((credit) => credit.line),
    ambiguous: result.ambiguous.map((credit) => credit.line),
  };
}

beforeEach(() => {
  nextLine = 2;
  nextReceipt = 1;
});

describe('matchStatement', () => {
  it('matches by exact amount within ±3 days, one-to-one', () => {
    const r = matchStatement([c(1500, '2026-10-01')], [rc(1500, '2026-10-03')]);
    expect(summary(r)).toEqual({ matched: [[2, '1']], unmatched: [], ambiguous: [] });
  });

  it('gives one receipt to one credit only — the nearer one', () => {
    const r = matchStatement(
      [c(1500, '2026-10-01'), c(1500, '2026-10-04')],
      [rc(1500, '2026-10-03')],
    );
    expect(summary(r)).toEqual({ matched: [[3, '1']], unmatched: [2], ambiguous: [] });
  });

  it('needs the exact amount (Decimal equality, not rounding)', () => {
    const r = matchStatement(
      [c('1500.00', '2026-10-05'), c('1500.00', '2026-10-15')],
      [rc('1500', '2026-10-05'), rc('1500.01', '2026-10-15')],
    );
    expect(summary(r)).toEqual({ matched: [[2, '1']], unmatched: [3], ambiguous: [] });
  });

  it.each<[string, string, number, boolean]>([
    ['3 calendar days later (over 72 hours)', '2026-10-04T23:59:00+07:00', 3, true],
    ['3 calendar days earlier', '2026-09-28', 3, true],
    ['4 calendar days later', '2026-10-05', 3, false],
    ['4 calendar days later with dayWindow 4', '2026-10-05', 4, true],
  ])('a receipt %s → matched %s', (_label, receiptDate, dayWindow, matched) => {
    const r = matchStatement([c(1500, '2026-10-01')], [rc(1500, receiptDate)], dayWindow);
    expect(summary(r)).toEqual(
      matched
        ? { matched: [[2, '1']], unmatched: [], ambiguous: [] }
        : { matched: [], unmatched: [2], ambiguous: [] },
    );
  });

  it('takes the nearest receipt when nothing else needs it, not the first one listed', () => {
    const r = matchStatement(
      [c(1500, '2026-10-05')],
      [rc(1500, '2026-10-02'), rc(1500, '2026-10-06')],
    );
    expect(summary(r)).toEqual({ matched: [[2, '2']], unmatched: [], ambiguous: [] });
  });

  it('matches as many credits as possible — moves a pick to a farther receipt inside the window', () => {
    const r = matchStatement(
      [c(1500, '2026-10-05'), c(1500, '2026-10-08')],
      [rc(1500, '2026-10-02'), rc(1500, '2026-10-06')],
    );
    // ใกล้สุดก่อนจะได้ 10-05 ↔ 10-06 แล้ว 10-08 ไม่มีคู่ (10-02 ห่าง 6 วัน) — แต่ 10-05 ↔ 10-02 (3 วัน)
    // + 10-08 ↔ 10-06 (2 วัน) จับได้ครบ ⇒ ต้องได้ทั้งสองบรรทัด (บรรทัดที่ "ไม่พบ" ปลอม = เสี่ยงบันทึกซ้ำ)
    expect(summary(r)).toEqual({
      matched: [
        [2, '1'],
        [3, '2'],
      ],
      unmatched: [],
      ambiguous: [],
    });
  });

  it('follows a chain of three re-assignments to match every credit', () => {
    const r = matchStatement(
      [c(1500, '2026-10-10'), c(1500, '2026-10-13'), c(1500, '2026-10-17')],
      [rc(1500, '2026-10-07'), rc(1500, '2026-10-11'), rc(1500, '2026-10-14')],
    );
    // ใกล้สุดก่อน: 10-10↔10-11 · 10-13↔10-14 · 10-17 เหลือแต่ 10-14 ที่ถูกใช้แล้ว
    // ⇒ 10-17 เอา 10-14 · 10-13 ย้ายไป 10-11 · 10-10 ย้ายไป 10-07 (3 วัน)
    expect(summary(r)).toEqual({
      matched: [
        [2, '1'],
        [3, '2'],
        [4, '3'],
      ],
      unmatched: [],
      ambiguous: [],
    });
  });

  it('decides a short group only after matching — a same-day receipt still goes to its lone credit', () => {
    const r = matchStatement(
      [c(1500, '2026-10-05'), c(1500, '2026-10-05'), c(1500, '2026-10-07')],
      [rc(1500, '2026-10-07')],
    );
    // 10-07 ↔ 10-07 (0 วัน) ต้องได้คู่ · กลุ่ม 10-05 มีรายการในช่วงวันแต่ไม่ได้เลย ⇒ กำกวมทั้งกลุ่ม
    expect(summary(r)).toEqual({ matched: [[4, '1']], unmatched: [], ambiguous: [2, 3] });
  });

  it('marks a same-day group ambiguous when other credits leave it short even at the maximum', () => {
    const r = matchStatement(
      [c(1500, '2026-10-05'), c(1500, '2026-10-05'), c(1500, '2026-10-06')],
      [rc(1500, '2026-10-05'), rc(1500, '2026-10-07')],
    );
    // 3 บรรทัด 2 รายการรับเงิน — กลุ่ม 10-05 มีรายการให้ครบ 2 แต่ 10-06 แย่งไป 1 (ใกล้กว่า)
    // ⇒ กลุ่ม 10-05 กำกวมทั้งกลุ่ม และรายการที่กลุ่มได้ไปไม่ถูกส่งต่อ
    expect(summary(r)).toEqual({ matched: [[4, '2']], unmatched: [], ambiguous: [2, 3] });
  });

  it('leaves same-amount same-day credits ambiguous', () => {
    const r = matchStatement(
      [c(1500, '2026-10-05'), c(1500, '2026-10-05')],
      [rc(1500, '2026-10-05')],
    );
    expect(r.ambiguous).toHaveLength(2);
    expect(r.matched).toHaveLength(0);
  });

  it('matches a same-day group when there are enough receipts', () => {
    const r = matchStatement(
      [c(1500, '2026-10-05'), c(1500, '2026-10-05')],
      [rc(1500, '2026-10-05'), rc(1500, '2026-10-07')],
    );
    expect(summary(r)).toEqual({
      matched: [
        [2, '1'],
        [3, '2'],
      ],
      unmatched: [],
      ambiguous: [],
    });
  });

  it('leaves a same-day group unmatched (not ambiguous) when no receipt fits at all', () => {
    const r = matchStatement(
      [c(1500, '2026-10-05'), c(1500, '2026-10-05')],
      [rc(900, '2026-10-05')],
    );
    expect(summary(r)).toEqual({ matched: [], unmatched: [2, 3], ambiguous: [] });
  });

  it('keeps a whole group of three ambiguous when only two receipts fit', () => {
    const r = matchStatement(
      [c(1500, '2026-10-05'), c(1500, '2026-10-05'), c(1500, '2026-10-05')],
      [rc(1500, '2026-10-05'), rc(1500, '2026-10-06')],
    );
    expect(summary(r)).toEqual({ matched: [], unmatched: [], ambiguous: [2, 3, 4] });
  });

  it('does not hand the receipts an ambiguous group claimed to another credit', () => {
    const r = matchStatement(
      [c(1500, '2026-10-05'), c(1500, '2026-10-05'), c(1500, '2026-10-07')],
      [rc(1500, '2026-10-05')],
    );
    // กลุ่ม 10-05 (ใกล้กว่า) จองรายการรับเงินไว้แต่ระบุไม่ได้ว่าของบรรทัดไหน → 10-07 ไม่ได้ของเหลือ
    expect(summary(r)).toEqual({ matched: [], unmatched: [4], ambiguous: [2, 3] });
  });

  it('keeps every list in statement line order and does not mutate the inputs', () => {
    const credits = [c(300, '2026-10-09'), c(200, '2026-10-01'), c(100, '2026-10-05')];
    const receipts = [rc(100, '2026-10-05'), rc(300, '2026-10-09')];
    const r = matchStatement([...credits].reverse(), receipts);
    expect(summary(r)).toEqual({
      matched: [
        [2, '2'],
        [4, '1'],
      ],
      unmatched: [3],
      ambiguous: [],
    });
    expect(receipts.map((x) => x.legacyId)).toEqual(['1', '2']);
  });
});

describe('parseStatementCsv', () => {
  it('parses Buddhist-era dates and thousands separators', () => {
    expect(
      parseStatementCsv('วันที่,ฝาก\n05/10/2569,"1,500.00"\n', {
        date: 'วันที่',
        amount: 'ฝาก',
      })[0],
    ).toMatchObject({ date: new Date('2026-10-04T17:00:00Z'), amount: new Prisma.Decimal('1500') });
  });

  it('reads dd/mm/yyyy and yyyy-mm-dd in either era, by header name, with the description', () => {
    const text =
      '﻿เวลา,รายการ,วันที่,ฝาก\n' +
      '10:00,โอนเงิน ทดสอบ 1,2026-10-05,100\n' +
      '11:00,"โอนเงิน, ทดสอบ 2",2569-10-06,200.5\n' +
      '12:00,,7/10/2026,300\n';
    const credits = parseStatementCsv(text, {
      date: 'วันที่',
      amount: 'ฝาก',
      description: 'รายการ',
    });
    expect(
      credits.map((x) => [x.line, x.date.toISOString(), x.amount.toFixed(2), x.description]),
    ).toEqual([
      [2, '2026-10-04T17:00:00.000Z', '100.00', 'โอนเงิน ทดสอบ 1'],
      [3, '2026-10-05T17:00:00.000Z', '200.50', 'โอนเงิน, ทดสอบ 2'],
      [4, '2026-10-06T17:00:00.000Z', '300.00', ''],
    ]);
  });

  it('keeps only money in (positive amounts) — withdrawal rows are skipped unchecked', () => {
    const text =
      'วันที่,ฝาก\n' +
      '01/10/2569,500\n' +
      'ยอดยกมา,\n' + // ไม่มียอดเข้า — ไม่ตรวจวันที่
      '02/10/2569,-200\n' +
      '03/10/2569,0.00\n' +
      '04/10/2569,1\n';
    const credits = parseStatementCsv(text, { date: 'วันที่', amount: 'ฝาก' });
    expect(credits.map((x) => [x.line, x.amount.toFixed(2), x.description])).toEqual([
      [2, '500.00', ''],
      [6, '1.00', ''],
    ]);
  });

  it.each<[string, string, RegExp]>([
    ['an impossible date', '31/09/2569,100', /บรรทัด 2 ช่อง วันที่ — วันที่ไม่มีจริง/],
    ['another date format', '2026/10/05,100', /บรรทัด 2 ช่อง วันที่ — วันที่ต้องเป็น/],
    ['a credit without a date', ',100', /บรรทัด 2 ช่อง วันที่ — ไม่มีค่า/],
    ['a malformed amount', '05/10/2569,1.5e3', /บรรทัด 2 ช่อง ฝาก — จำนวนเงินผิดรูปแบบ/],
  ])('rejects %s with the line and column, never the value', (_label, row, error) => {
    let message = '';
    try {
      parseStatementCsv(`วันที่,ฝาก\n${row}\n`, { date: 'วันที่', amount: 'ฝาก' });
    } catch (e) {
      message = e instanceof Error ? e.message : String(e);
    }
    expect(message).toMatch(error);
    expect(message).toMatch(/^อ่านไฟล์ statement ธนาคารไม่ได้: /);
    for (const value of row.split(',').filter(Boolean)) expect(message).not.toContain(value);
  });

  it('names the missing header columns, including a missing description column', () => {
    expect(() =>
      parseStatementCsv('วันที่,ฝาก\n05/10/2569,100\n', {
        date: 'วันที่',
        amount: 'ยอดเงิน',
        description: 'รายการ',
      }),
    ).toThrow(/ไม่มีคอลัมน์ ยอดเงิน, รายการ/);
  });
});

describe('parseStatementCols', () => {
  it('reads date / amount / optional description header names', () => {
    expect(parseStatementCols('date=วันที่,amount=ฝาก')).toEqual({ date: 'วันที่', amount: 'ฝาก' });
    expect(parseStatementCols('description=รายการ, date=วันที่ ,amount=เงิน=เข้า')).toEqual({
      date: 'วันที่',
      amount: 'เงิน=เข้า',
      description: 'รายการ',
    });
  });

  it.each<[string, RegExp]>([
    ['date=วันที่', /ต้องระบุ amount=/],
    ['amount=ฝาก', /ต้องระบุ date=/],
    ['date=วันที่,amount=ฝาก,memo=x', /ไม่รู้จัก memo/],
    ['date=วันที่,amount=ฝาก,date=x', /ระบุ date ซ้ำ/],
    ['date=,amount=ฝาก', /date ต้องมีชื่อหัวคอลัมน์/],
    ['date วันที่,amount=ฝาก', /ต้องเป็น ชื่อ=หัวคอลัมน์/],
  ])('rejects %s', (spec, error) => {
    expect(() => parseStatementCols(spec)).toThrow(error);
  });
});

describe('statementCreditsCsv', () => {
  it('writes line, Bangkok date, amount and description — quoting, and defusing spreadsheet formulas', () => {
    const credits: StatementCredit[] = [
      { line: 7, date: at('2026-10-05'), amount: D('1500'), description: 'โอนเงิน, ทดสอบ' },
      { line: 9, date: at('2026-10-06'), amount: D('20.5'), description: '=1+1' },
      { line: 12, date: at('2026-10-07'), amount: D('3'), description: '' },
    ];
    expect(statementCreditsCsv(credits)).toBe(
      'line,date,amount,description\n' +
        '7,2026-10-05,1500.00,"โอนเงิน, ทดสอบ"\n' +
        "9,2026-10-06,20.50,'=1+1\n" +
        '12,2026-10-07,3.00,\n',
    );
  });
});
