import { Prisma } from '@prisma/client';
import {
  accrual2AInputOf,
  buildPartialAccrual2ALines,
  NOTHING_ACCRUED,
} from '../../../modules/journal/build-accrual-2a-lines';
import type { JeLineInput } from '../../../modules/journal/journal-auto.service';
import { bangkokMidnight } from '../../../utils/date.util';
import type { ContractMoney } from '../money';
import {
  CARRY_FORWARD_ACCOUNTS,
  computeOpening,
  OPENING_EQUITY_ACCOUNT,
  OpeningInputError,
  OpeningMismatchError,
  type OpeningInput,
  type OpeningResult,
} from '../opening';

/**
 * รายการยกมารายสัญญา — ข้อมูลสังเคราะห์ทั้งหมด (ยอดตามตัวอย่าง CPA 17,000 / 12 งวด)
 *
 * สัญญามาตรฐาน: ยอดจัด 10,000 · ค่าคอม 1,000 · ดอกเบี้ย 6,000 · VAT 1,190 · 12 งวด
 * → งวด 1–11 = 1,416.66 + VAT 99.17 = 1,515.83 (ดอกเบี้ย 500) · งวด 12 รับเศษ = 1,416.74 + 99.13 = 1,515.87
 * ครบกำหนดวันที่ 15 ทุกเดือน งวด 1 = 15 ส.ค. 2026 … งวด 4 = 15 พ.ย. (ก่อนวันตัด) · งวด 5 = 15 ธ.ค. (หลังวันตัด)
 * วันตัด 2026-11-30 23:59:59 กรุงเทพ
 */

const D = (value: string) => new Prisma.Decimal(value);
const CUTOFF = new Date('2026-11-30T23:59:59+07:00');
const MONTHLY = '1515.83';
const LAST = '1515.87';

const MONEY: ContractMoney = {
  sellingPrice: D('12000'),
  downPayment: D('2000'),
  financedAmount: D('10000'),
  storeCommission: D('1000'),
  interestTotal: D('6000'),
  vatAmount: D('1190'),
  vatPct: D('0.07'),
  interestRate: D('0.05'),
  monthlyPayment: D(MONTHLY),
  totalMonths: 12,
};

/** งวดที่ `no` ครบกำหนดเที่ยงคืนกรุงเทพวันที่ 15 (งวด 1 = ส.ค. 2026) */
const dueOf = (no: number) => bangkokMidnight(2026, 6 + no, 15);
const amountOf = (no: number) => (no === 12 ? LAST : MONTHLY);

/** 12 งวด · `paid` = ยอดจ่ายของงวด (ไม่ระบุ = 0) · `dueDates` แทนวันครบกำหนดรายงวด */
function installments(
  paid: Record<number, string> = {},
  dueDates: Record<number, Date> = {},
): OpeningInput['installments'] {
  return Array.from({ length: 12 }, (_, i) => {
    const no = i + 1;
    return { installmentNo: no, dueDate: dueDates[no] ?? dueOf(no), paid: D(paid[no] ?? '0') };
  });
}

/** ยอดค้างแบบ PEAK = Σ (ค่างวด − ยอดจ่าย) ของงวดที่ยังค้าง (งวดที่จ่ายเกินไม่หักลบ) */
function peakRemainOf(paid: Record<number, string>, amount: (no: number) => string = amountOf) {
  let total = D('0');
  for (let no = 1; no <= 12; no++) {
    const rest = D(amount(no)).minus(paid[no] ?? '0');
    if (rest.gt(0)) total = total.plus(rest);
  }
  return total;
}

function opening(paid: Record<number, string>, over: Partial<OpeningInput> = {}): OpeningResult {
  return computeOpening({
    money: MONEY,
    installments: installments(paid),
    cutoff: CUTOFF,
    peakRemain: peakRemainOf(paid),
    ...over,
  });
}

const sum = (values: Prisma.Decimal[]) => values.reduce((s, v) => s.plus(v), D('0'));
/** ยอดสุทธิ Dr − Cr ของบัญชีในชุดบรรทัด (2 ตำแหน่ง) */
const net = (lines: JeLineInput[], code: string) =>
  sum(lines.filter((l) => l.accountCode === code).map((l) => l.dr.minus(l.cr))).toFixed(2);
const codes = (lines: JeLineInput[]) => lines.map((l) => l.accountCode);
const markersOf = (r: OpeningResult) =>
  r.priorReceiptMarkers.map((m) => ({
    installmentNo: m.installmentNo,
    amount: m.amount.toFixed(2),
  }));
/** ลูกหนี้หลังลง marker = Σ(11-2101 + 11-2103 + 11-2105) ของรายการยกมา − Σ marker */
const receivableAfterMarkers = (r: OpeningResult) =>
  ['11-2101', '11-2103', '11-2105']
    .reduce((s, code) => s.plus(net(r.openingLines, code)), D('0'))
    .minus(sum(r.priorReceiptMarkers.map((m) => m.amount)))
    .toFixed(2);
const stampOf = (r: OpeningResult, no: number) => {
  const s = r.stamps.find((x) => x.installmentNo === no);
  if (!s) throw new Error(`no stamp for installment ${no}`);
  return {
    accrued: s.accrued,
    accruedAmount: s.accruedAmount.toFixed(2),
    accruedVat: s.accruedVat.toFixed(2),
    accruedInterest: s.accruedInterest.toFixed(2),
    stampVat60: s.stampVat60,
  };
};

const PAID_1_TO_3 = { 1: MONTHLY, 2: MONTHLY, 3: MONTHLY };

describe('computeOpening', () => {
  it('งวด 1–3 จ่ายครบ งวด 4 ค้างเต็ม: สมดุล · มีแต่บัญชียกมา + 32-1101 · 11-2103 = ค่างวดงวด 4', () => {
    const r = opening(PAID_1_TO_3);

    expect(codes(r.openingLines)).toEqual([
      '11-2101',
      '11-2103',
      '11-2105',
      '11-2106',
      '21-2102',
      OPENING_EQUITY_ACCOUNT,
    ]);
    expect(sum(r.openingLines.map((l) => l.dr)).toFixed(2)).toBe(
      sum(r.openingLines.map((l) => l.cr)).toFixed(2),
    );
    // ส่วนที่ยังไม่ถึงกำหนด (งวด 5–12) = กลับด้านของ 2A ทั้งงวด · งวด 12 รับเศษ
    expect(net(r.openingLines, '11-2101')).toBe('11333.36'); // 7 × 1,416.66 + 1,416.74
    expect(net(r.openingLines, '11-2105')).toBe('793.32'); // 7 × 99.17 + 99.13
    expect(net(r.openingLines, '11-2106')).toBe('-4000.00'); // Cr 8 × 500
    // งวด 4 ถึงกำหนดแล้ว = ลูกหนี้ค้างชำระเต็มงวด · VAT ของงวด 4 คงอยู่ใน 21-2102 รอไล่ 1 ธ.ค.
    expect(net(r.openingLines, '11-2103')).toBe(MONTHLY);
    expect(net(r.openingLines, '21-2102')).toBe('-892.49'); // Cr 793.32 + 99.17
    expect(net(r.openingLines, OPENING_EQUITY_ACCOUNT)).toBe('-8750.02');
    expect(r.priorReceiptMarkers).toEqual([]);

    for (const no of [1, 2, 3, 4]) {
      expect(stampOf(r, no)).toEqual({
        accrued: true,
        accruedAmount: amountOf(no),
        accruedVat: '99.17',
        accruedInterest: '500.00',
        stampVat60: true,
      });
    }
    for (const no of [5, 6, 7, 8, 9, 10, 11, 12]) {
      expect(stampOf(r, no)).toEqual({
        accrued: false,
        accruedAmount: '0.00',
        accruedVat: '0.00',
        accruedInterest: '0.00',
        stampVat60: false,
      });
    }
    expect(r.stamps.map((s) => s.installmentNo)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it('งวด 4 จ่ายแล้ว 300: marker งวด 4 = 300 · 11-2103 ในรายการยกมา = ค่างวดเต็ม (marker เป็นตัวตัด 300)', () => {
    const r = opening({ ...PAID_1_TO_3, 4: '300' });

    expect(markersOf(r)).toEqual([{ installmentNo: 4, amount: '300.00' }]);
    expect(net(r.openingLines, '11-2103')).toBe(MONTHLY);
    expect(stampOf(r, 4)).toMatchObject({ accrued: true, stampVat60: true });
    // VAT ของส่วนที่ค้าง = 99.17 × 1,215.83 ÷ 1,515.83 = 79.543… → 79.54
    expect(net(r.catchUpLines, '21-2102')).toBe('79.54');
    expect(net(r.openingLines, '21-2102')).toBe('-872.86'); // Cr 793.32 + 79.54
  });

  it('งวด 6 (อนาคต) จ่ายล่วงหน้า 500: stamp ยังไม่ตั้งครบ ยอดสะสม = accruedAfter ของ 2A บางส่วน · marker งวด 6 = 500', () => {
    const r = opening({ ...PAID_1_TO_3, 6: '500' });
    const part = buildPartialAccrual2ALines(accrual2AInputOf(MONEY, 6), NOTHING_ACCRUED, D('500'));

    expect(stampOf(r, 6)).toEqual({
      accrued: false,
      accruedAmount: part.accruedAfter.amount.toFixed(2),
      accruedVat: part.accruedAfter.vat.toFixed(2),
      accruedInterest: part.accruedAfter.interest.toFixed(2),
      stampVat60: false,
    });
    // ตัวเลขทองของ 2A บางส่วน (ก1): VAT = 500 × 7/107 = 32.71 · มูลค่า 467.29 · ดอกเบี้ย 500 × 467.29 ÷ 1,416.66 = 164.93
    expect(stampOf(r, 6)).toMatchObject({
      accruedAmount: '500.00',
      accruedVat: '32.71',
      accruedInterest: '164.93',
    });
    expect(markersOf(r)).toEqual([{ installmentNo: 6, amount: '500.00' }]);
    // ส่วนที่ตั้งแล้วของงวด 6 อยู่ใน 11-2103 (marker ล้าง) · ส่วนที่เหลือของงวด 6 อยู่ในบัญชีของส่วนที่ยังไม่ตั้ง
    expect(net(r.openingLines, '11-2103')).toBe('2015.83'); // งวด 4 1,515.83 + งวด 6 500
    expect(net(r.openingLines, '11-2101')).toBe('10866.07'); // 11,333.36 − 467.29
    expect(net(r.openingLines, '11-2105')).toBe('760.61'); // 793.32 − 32.71
    expect(net(r.openingLines, '11-2106')).toBe('-3835.07'); // 4,000 − 164.93
    expect(net(r.openingLines, '21-2102')).toBe('-859.78'); // 760.61 + VAT งวด 4 99.17
    // งวดอนาคตไม่มี VAT ไล่ — มีแค่งวด 4
    expect(net(r.catchUpLines, '21-2102')).toBe('99.17');
  });

  it('งวด 4 ค้างเต็ม (ถึงกำหนดก่อนวันตัด): 21-2102 รวม VAT งวด 4 · catchUpLines = Dr 21-2102 / Cr 21-2101 เท่า VAT งวด 4', () => {
    const r = opening(PAID_1_TO_3);

    expect(r.catchUpLines.map((l) => [l.accountCode, l.dr.toFixed(2), l.cr.toFixed(2)])).toEqual([
      ['21-2102', '99.17', '0.00'],
      ['21-2101', '0.00', '99.17'],
    ]);
    const futureVat = D('793.32');
    expect(net(r.openingLines, '21-2102')).toBe(futureVat.plus('99.17').negated().toFixed(2));
  });

  describe.each([
    ['งวด 1–3 จ่ายครบ งวด 4 ค้างเต็ม', PAID_1_TO_3, '4000.00'],
    ['งวด 4 จ่าย 300', { ...PAID_1_TO_3, 4: '300' }, '4000.00'],
    ['งวด 6 จ่ายล่วงหน้า 500', { ...PAID_1_TO_3, 6: '500' }, '3835.07'],
    ['ยังไม่จ่ายเลย', {}, '4000.00'],
    [
      'จ่ายล่วงหน้างวด 5 ครบ + งวด 7 บางส่วน',
      { ...PAID_1_TO_3, 4: MONTHLY, 5: MONTHLY, 7: '1000' },
      null,
    ],
  ])('ทุกกรณี — %s', (_name, paid: Record<number, string>, unaccruedInterest: string | null) => {
    it('ไม่มีบรรทัด 41-1101 · มีแต่บัญชียกมา + 32-1101 · บัญชีละบรรทัด · ไม่มีบรรทัดยอดศูนย์ · สมดุล', () => {
      const r = opening(paid);
      const allowed = new Set<string>([...CARRY_FORWARD_ACCOUNTS, OPENING_EQUITY_ACCOUNT]);

      expect(codes(r.openingLines)).not.toContain('41-1101');
      expect(codes(r.catchUpLines)).not.toContain('41-1101');
      expect(codes(r.openingLines).every((c) => allowed.has(c))).toBe(true);
      expect(new Set(codes(r.openingLines)).size).toBe(r.openingLines.length);
      for (const line of [...r.openingLines, ...r.catchUpLines]) {
        // ฝั่งเดียวต่อบรรทัด ยอดบวก
        expect(line.dr.isZero() !== line.cr.isZero()).toBe(true);
        expect(line.dr.isNegative() || line.cr.isNegative()).toBe(false);
        expect(line.description).toBeTruthy();
      }
      expect(sum(r.openingLines.map((l) => l.dr)).eq(sum(r.openingLines.map((l) => l.cr)))).toBe(
        true,
      );
      expect(sum(r.catchUpLines.map((l) => l.dr)).eq(sum(r.catchUpLines.map((l) => l.cr)))).toBe(
        true,
      );
    });

    it('11-2106 = Σ ดอกเบี้ยของส่วนที่ยังไม่ตั้ง (Cr)', () => {
      const r = opening(paid);
      const part7 = buildPartialAccrual2ALines(
        accrual2AInputOf(MONEY, 7),
        NOTHING_ACCRUED,
        D('1000'),
      );
      // งวด 6, 8–12 ทั้งงวด + ส่วนที่เหลือของงวด 7
      const expected =
        unaccruedInterest ?? D('3000').plus(D('500').minus(part7.accruedAfter.interest)).toFixed(2);
      expect(net(r.openingLines, '11-2106')).toBe(D(expected).negated().toFixed(2));
    });

    it('Σ(11-2101 + 11-2103 + 11-2105) − marker = peakRemain · ไม่เท่า → throw OPENING_PEAK_MISMATCH', () => {
      const peakRemain = peakRemainOf(paid);
      expect(receivableAfterMarkers(opening(paid))).toBe(peakRemain.toFixed(2));

      for (const off of ['0.01', '-0.01']) {
        const call = () => opening(paid, { peakRemain: peakRemain.plus(off) });
        expect(call).toThrow(OpeningMismatchError);
        try {
          call();
        } catch (err) {
          const e = err as OpeningMismatchError;
          expect(e.code).toBe('OPENING_PEAK_MISMATCH');
          expect(e.peakRemain.toFixed(2)).toBe(peakRemain.plus(off).toFixed(2));
          expect(e.receivable.toFixed(2)).toBe(peakRemain.toFixed(2));
          // ข้อความไม่ยกยอดเงินมาพิมพ์
          expect(e.message).not.toContain(peakRemain.toFixed(2));
          expect(e.message).not.toContain(peakRemain.plus(off).toFixed(2));
        }
      }
    });
  });

  it('รายการยกมา + marker + VAT ไล่ = สัญญาที่เปิดในระบบตั้งแต่แรก (1A + 2A + ใบรับชำระ) ทุกบัญชียกมา', () => {
    // งวด 1–2 ครบ · งวด 3 จ่ายเกิน · งวด 4 บางส่วน 300 · งวด 5 ล่วงหน้าครบ · งวด 6 ล่วงหน้าบางส่วน 500
    const paid = { 1: MONTHLY, 2: MONTHLY, 3: '1600', 4: '300', 5: MONTHLY, 6: '500' };
    const r = opening(paid);

    // สัญญาที่เปิดในระบบ: 1A ทั้งสัญญา (เฉพาะบัญชียกมา) → 2A ที่ระบบลงถึงวันตัด → ใบรับชำระ Cr 11-2103
    const native = new Map<string, Prisma.Decimal>();
    const add = (code: string, amount: Prisma.Decimal) =>
      native.set(code, (native.get(code) ?? D('0')).plus(amount));
    add('11-2101', D('17000'));
    add('11-2105', D('1190'));
    add('11-2106', D('-6000'));
    add('21-2102', D('-1190'));
    for (const inst of installments(paid)) {
      const input = accrual2AInputOf(MONEY, inst.installmentNo);
      const due = inst.dueDate.getTime() < CUTOFF.getTime();
      const part = due
        ? buildPartialAccrual2ALines(input, NOTHING_ACCRUED, D('999999')) // ทั้งงวด
        : inst.paid.gt(0)
          ? buildPartialAccrual2ALines(input, NOTHING_ACCRUED, inst.paid)
          : null;
      for (const l of part?.lines ?? []) add(l.accountCode, l.dr.minus(l.cr));
      add('11-2103', Prisma.Decimal.min(inst.paid, part?.installmentTotal ?? inst.paid).negated());
    }

    const imported = [
      ...r.openingLines,
      ...r.priorReceiptMarkers.map((m) => ({
        accountCode: '11-2103',
        dr: D('0'),
        cr: m.amount,
        description: 'marker',
      })),
      ...r.catchUpLines,
    ];
    for (const code of CARRY_FORWARD_ACCOUNTS) {
      expect([code, net(imported, code)]).toEqual([code, (native.get(code) ?? D('0')).toFixed(2)]);
    }
    // 21-2101 ของรายการไล่ = VAT ของส่วนที่ค้างของงวดที่ถึงกำหนด (งวด 4) — ส่วนที่จ่ายแล้ว PEAK ยื่นไปแล้ว
    expect(net(r.catchUpLines, '21-2101')).toBe('-79.54');
  });

  it('ยังไม่ถึงกำหนดสักงวด: รายการยกมาเท่าฝั่งลูกหนี้ของ 1A ทั้งสัญญา (งวดสุดท้ายรับเศษ)', () => {
    const r = opening({}, { cutoff: new Date('2026-08-01T00:00:00+07:00') });

    expect(net(r.openingLines, '11-2101')).toBe('17000.00');
    expect(net(r.openingLines, '11-2105')).toBe('1190.00');
    expect(net(r.openingLines, '11-2106')).toBe('-6000.00');
    expect(net(r.openingLines, '21-2102')).toBe('-1190.00');
    expect(codes(r.openingLines)).not.toContain('11-2103');
    expect(r.catchUpLines).toEqual([]);
    expect(r.stamps.every((s) => !s.accrued && !s.stampVat60)).toBe(true);
  });

  it('งวดสุดท้ายรับเศษ: เหลือแต่งวด 12 → ยอดยกมา = 1,416.74 + VAT 99.13 ดอกเบี้ย 500', () => {
    const paid: Record<number, string> = {};
    for (let no = 1; no <= 11; no++) paid[no] = MONTHLY;
    const r = opening(paid);

    expect(net(r.openingLines, '11-2101')).toBe('1416.74');
    expect(net(r.openingLines, '11-2105')).toBe('99.13');
    expect(net(r.openingLines, '11-2106')).toBe('-500.00');
    expect(net(r.openingLines, '21-2102')).toBe('-99.13');
    expect(receivableAfterMarkers(r)).toBe(LAST);
    // งวด 5–11 จ่ายล่วงหน้าครบ = ตั้งครบแล้ว ไม่ใช่งวดถึงกำหนด
    expect(stampOf(r, 11)).toEqual({
      accrued: true,
      accruedAmount: MONTHLY,
      accruedVat: '99.17',
      accruedInterest: '500.00',
      stampVat60: false,
    });
    expect(r.priorReceiptMarkers).toEqual([]);
  });

  it('ทุกงวดถึงกำหนดและค้างเต็ม: 11-2103 = ยอดผ่อนรวม · VAT ทั้งสัญญาไล่ 1 ธ.ค. · ไม่มี 11-2106', () => {
    const r = opening({}, { cutoff: new Date('2027-08-01T00:00:00+07:00') });

    expect(net(r.openingLines, '11-2103')).toBe('18190.00');
    expect(codes(r.openingLines)).toEqual(['11-2103', '21-2102', OPENING_EQUITY_ACCOUNT]);
    expect(net(r.openingLines, '21-2102')).toBe('-1190.00');
    expect(net(r.catchUpLines, '21-2101')).toBe('-1190.00');
    expect(net(r.openingLines, OPENING_EQUITY_ACCOUNT)).toBe('-17000.00');
  });

  it('จ่ายครบทุกงวด: ไม่มีรายการยกมา ไม่มี marker ไม่มี VAT ไล่', () => {
    const paid: Record<number, string> = {};
    for (let no = 1; no <= 12; no++) paid[no] = amountOf(no);
    const r = opening(paid);

    expect(r.openingLines).toEqual([]);
    expect(r.catchUpLines).toEqual([]);
    expect(r.priorReceiptMarkers).toEqual([]);
    expect(r.stamps.every((s) => s.accrued)).toBe(true);
  });

  it('งวดที่จ่ายเกินค่างวด: นับเท่าค่างวด (ไม่มีลูกหนี้ติดลบ ไม่มี marker)', () => {
    const r = opening({ ...PAID_1_TO_3, 3: '1600' });

    expect(r.priorReceiptMarkers).toEqual([]);
    expect(net(r.openingLines, '11-2103')).toBe(MONTHLY); // งวด 4 อย่างเดียว
    expect(receivableAfterMarkers(r)).toBe(peakRemainOf(PAID_1_TO_3).toFixed(2));
  });

  it('วันครบกำหนด = วันตัด (30 พ.ย.) ถือว่าถึงกำหนด · 1 ธ.ค. ยังไม่ถึง', () => {
    const due30 = bangkokMidnight(2026, 10, 30);
    const due1Dec = bangkokMidnight(2026, 11, 1);
    const run = (dueDate: Date) =>
      computeOpening({
        money: MONEY,
        installments: installments(PAID_1_TO_3, { 5: dueDate }),
        cutoff: CUTOFF,
        peakRemain: peakRemainOf(PAID_1_TO_3),
      });

    expect(stampOf(run(due30), 5)).toMatchObject({ accrued: true, stampVat60: true });
    expect(net(run(due30).catchUpLines, '21-2102')).toBe('198.34'); // งวด 4 + งวด 5
    expect(stampOf(run(due1Dec), 5)).toMatchObject({ accrued: false, stampVat60: false });
    expect(net(run(due1Dec).catchUpLines, '21-2102')).toBe('99.17');
  });

  it('สัญญาไม่มี VAT (vatAmount 0): ไม่มีบรรทัด 11-2105 / 21-2102 และไม่มี VAT ไล่', () => {
    const money: ContractMoney = {
      ...MONEY,
      vatAmount: D('0'),
      vatPct: D('0'),
      monthlyPayment: D('1416.66'),
    };
    const amount = (no: number) => (no === 12 ? '1416.74' : '1416.66');
    const paid = { 1: '1416.66', 2: '1416.66', 3: '1416.66', 4: '300', 6: '500' };
    const r = computeOpening({
      money,
      installments: installments(paid),
      cutoff: CUTOFF,
      peakRemain: peakRemainOf(paid, amount),
    });

    expect(codes(r.openingLines)).not.toContain('11-2105');
    expect(codes(r.openingLines)).not.toContain('21-2102');
    expect(r.catchUpLines).toEqual([]);
    expect(r.stamps.every((s) => s.accruedVat.isZero())).toBe(true);
    expect(markersOf(r)).toEqual([
      { installmentNo: 4, amount: '300.00' },
      { installmentNo: 6, amount: '500.00' },
    ]);
    expect(receivableAfterMarkers(r)).toBe(peakRemainOf(paid, amount).toFixed(2));
  });

  it('สัญญาไม่มีดอกเบี้ย: ไม่มีบรรทัด 11-2106', () => {
    // ยอดก่อน VAT 11,000 · VAT 770 → งวด 916.66 + 64.17 = 980.83 · งวด 12 = 916.74 + 64.13 = 980.87
    const money: ContractMoney = {
      ...MONEY,
      interestTotal: D('0'),
      vatAmount: D('770'),
      interestRate: D('0'),
      monthlyPayment: D('980.83'),
    };
    const amount = (no: number) => (no === 12 ? '980.87' : '980.83');
    const paid = { 1: '980.83', 2: '980.83', 3: '980.83' };
    const r = computeOpening({
      money,
      installments: installments(paid),
      cutoff: CUTOFF,
      peakRemain: peakRemainOf(paid, amount),
    });

    expect(codes(r.openingLines)).not.toContain('11-2106');
    expect(r.stamps.every((s) => s.accruedInterest.isZero())).toBe(true);
    expect(receivableAfterMarkers(r)).toBe(peakRemainOf(paid, amount).toFixed(2));
  });

  describe('ข้อมูลเข้าผิด → OpeningInputError (OPENING_INPUT_INVALID)', () => {
    const base = (): OpeningInput => ({
      money: MONEY,
      installments: installments(PAID_1_TO_3),
      cutoff: CUTOFF,
      peakRemain: peakRemainOf(PAID_1_TO_3),
    });
    const expectInvalid = (input: OpeningInput) => {
      expect(() => computeOpening(input)).toThrow(OpeningInputError);
      try {
        computeOpening(input);
      } catch (err) {
        expect((err as OpeningInputError).code).toBe('OPENING_INPUT_INVALID');
      }
    };

    it('จำนวนงวดไม่เท่า totalMonths', () => {
      expectInvalid({ ...base(), installments: base().installments.slice(0, 11) });
    });

    it('เลขงวดซ้ำ / นอกช่วง 1..totalMonths', () => {
      const dup = base().installments.map((i) =>
        i.installmentNo === 12 ? { ...i, installmentNo: 11 } : i,
      );
      expectInvalid({ ...base(), installments: dup });
      const out = base().installments.map((i) =>
        i.installmentNo === 12 ? { ...i, installmentNo: 13 } : i,
      );
      expectInvalid({ ...base(), installments: out });
    });

    it('ยอดจ่ายติดลบ หรือเกิน 2 ตำแหน่ง', () => {
      const negative = base().installments.map((i) =>
        i.installmentNo === 5 ? { ...i, paid: D('-1') } : i,
      );
      expectInvalid({ ...base(), installments: negative });
      const fractional = base().installments.map((i) =>
        i.installmentNo === 5 ? { ...i, paid: D('0.001') } : i,
      );
      expectInvalid({ ...base(), installments: fractional });
    });

    it('วันครบกำหนด / วันตัดไม่ใช่วันที่', () => {
      const badDue = base().installments.map((i) =>
        i.installmentNo === 5 ? { ...i, dueDate: new Date('x') } : i,
      );
      expectInvalid({ ...base(), installments: badDue });
      expectInvalid({ ...base(), cutoff: new Date('x') });
    });
  });

  it('ไม่แก้ข้อมูลเข้า และลำดับงวดในข้อมูลเข้าไม่มีผล', () => {
    const input: OpeningInput = {
      money: MONEY,
      installments: installments({ ...PAID_1_TO_3, 6: '500' }).reverse(),
      cutoff: CUTOFF,
      peakRemain: peakRemainOf({ ...PAID_1_TO_3, 6: '500' }),
    };
    const before = input.installments.map((i) => i.installmentNo);
    const r = computeOpening(input);

    expect(input.installments.map((i) => i.installmentNo)).toEqual(before);
    expect(r.stamps.map((s) => s.installmentNo)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(net(r.openingLines, '11-2103')).toBe('2015.83');
  });
});
