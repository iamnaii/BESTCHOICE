import { Decimal } from '@prisma/client/runtime/library';
import {
  AccruedSoFar,
  NOTHING_ACCRUED,
  accrual2AInputOf,
  accruedSoFarOf,
  buildAccrual2ALines,
  buildAccrual2AReversalLines,
  buildPartialAccrual2ALines,
  buildRemainderAccrual2ALines,
  isDueDateReached,
  mirrorAccrual2APart,
  sortAccrual2AReversalLines,
  resolveAccrualPeriodCheckDate,
  resolveAccrualPostingDate,
} from './build-accrual-2a-lines';

/**
 * สัญญามาตรฐาน 17,000 / 12 งวด (ตัวเลขเดียวกับ seedStandard17k12m และ CSV กรณีที่ 1):
 * ยอดจัด 10,000 + ค่าคอม 1,000 + ดอกเบี้ย 6,000 = 17,000 · VAT 1,190
 */
const CONTRACT_17K_12M = {
  financedAmount: '10000',
  storeCommission: '1000',
  interestTotal: '6000',
  vatAmount: '1190',
  totalMonths: 12,
};

const sum = (values: Decimal[]) => values.reduce((s, v) => s.plus(v), new Decimal(0));

describe('buildAccrual2ALines', () => {
  it('งวดปกติ: 7 บรรทัด ยอดตามคู่มือ (1,515.83 / 99.17 / 500.00 / 1,416.66) และ Dr = Cr', () => {
    const out = buildAccrual2ALines({ ...CONTRACT_17K_12M, installmentNo: 3 });

    expect(out.lines.map((l) => [l.accountCode, l.dr.toFixed(2), l.cr.toFixed(2)])).toEqual([
      ['11-2103', '1515.83', '0.00'],
      ['21-2102', '99.17', '0.00'],
      ['11-2106', '500.00', '0.00'],
      ['11-2101', '0.00', '1416.66'],
      ['11-2105', '0.00', '99.17'],
      ['41-1101', '0.00', '500.00'],
      ['21-2101', '0.00', '99.17'],
    ]);
    expect(out.installmentTotal.toFixed(2)).toBe('1515.83');
    expect(sum(out.lines.map((l) => l.dr)).toFixed(2)).toBe('2115.00');
    expect(sum(out.lines.map((l) => l.cr)).toFixed(2)).toBe('2115.00');
  });

  it('งวดสุดท้าย: รับเศษปัดทั้งหมด (1,515.87 / 99.13 / 500.00 / 1,416.74)', () => {
    const out = buildAccrual2ALines({ ...CONTRACT_17K_12M, installmentNo: 12 });

    expect(out.lines.map((l) => [l.accountCode, l.dr.toFixed(2), l.cr.toFixed(2)])).toEqual([
      ['11-2103', '1515.87', '0.00'],
      ['21-2102', '99.13', '0.00'],
      ['11-2106', '500.00', '0.00'],
      ['11-2101', '0.00', '1416.74'],
      ['11-2105', '0.00', '99.13'],
      ['41-1101', '0.00', '500.00'],
      ['21-2101', '0.00', '99.13'],
    ]);
    expect(out.installmentTotal.toFixed(2)).toBe('1515.87');
  });

  it('คำอธิบายบรรทัดตรงกับที่รอบกลางคืนลงอยู่เดิมทุกตัวอักษร', () => {
    const out = buildAccrual2ALines({ ...CONTRACT_17K_12M, installmentNo: 1 });
    expect(out.lines.map((l) => l.description)).toEqual([
      'ลูกหนี้ค้างชำระ (Accrual)',
      'ล้าง ภาษีขายรอเรียกเก็บ',
      'ล้าง รายได้รอตัดบัญชี-ดอกเบี้ย',
      'ลูกหนี้ Gross (ลด excl.VAT)',
      'ลูกหนี้ภาษีขายรอฯ (ล้าง)',
      'รายได้ดอกเบี้ย (รับรู้)',
      'ภาษีขาย ภ.พ.30',
    ]);
  });
});

describe('buildAccrual2AReversalLines', () => {
  it('งวดปกติ: กระจกของ 2A — บัญชีและยอดเดิม สลับฝั่ง เรียงตามรูปที่เสนอฝ่ายบัญชี', () => {
    const out = buildAccrual2AReversalLines({ ...CONTRACT_17K_12M, installmentNo: 3 });

    expect(out.lines.map((l) => [l.accountCode, l.dr.toFixed(2), l.cr.toFixed(2)])).toEqual([
      ['11-2101', '1416.66', '0.00'],
      ['11-2105', '99.17', '0.00'],
      ['21-2101', '99.17', '0.00'],
      ['41-1101', '500.00', '0.00'],
      ['11-2103', '0.00', '1515.83'],
      ['21-2102', '0.00', '99.17'],
      ['11-2106', '0.00', '500.00'],
    ]);
    expect(out.installmentTotal.toFixed(2)).toBe('1515.83');
    expect(sum(out.lines.map((l) => l.dr)).toFixed(2)).toBe('2115.00');
    expect(sum(out.lines.map((l) => l.cr)).toFixed(2)).toBe('2115.00');
  });

  it('งวดสุดท้าย: ใช้ยอดที่รับเศษปัด (1,515.87 / 99.13 / 1,416.74)', () => {
    const out = buildAccrual2AReversalLines({ ...CONTRACT_17K_12M, installmentNo: 12 });

    expect(out.lines.map((l) => [l.accountCode, l.dr.toFixed(2), l.cr.toFixed(2)])).toEqual([
      ['11-2101', '1416.74', '0.00'],
      ['11-2105', '99.13', '0.00'],
      ['21-2101', '99.13', '0.00'],
      ['41-1101', '500.00', '0.00'],
      ['11-2103', '0.00', '1515.87'],
      ['21-2102', '0.00', '99.13'],
      ['11-2106', '0.00', '500.00'],
    ]);
  });

  it('ทุกบรรทัดของ 2A มีคู่กลับครบ (ไม่มีสำเนายอดชุดที่สอง) และคำอธิบายขึ้นต้นด้วย [กลับรายการ]', () => {
    for (const installmentNo of [1, 7, 12]) {
      const forward = buildAccrual2ALines({ ...CONTRACT_17K_12M, installmentNo });
      const reverse = buildAccrual2AReversalLines({ ...CONTRACT_17K_12M, installmentNo });
      const key = (accountCode: string, dr: Decimal, cr: Decimal) =>
        `${accountCode}:${dr.toFixed(2)}:${cr.toFixed(2)}`;

      expect(reverse.lines.map((l) => key(l.accountCode, l.cr, l.dr)).sort()).toEqual(
        forward.lines.map((l) => key(l.accountCode, l.dr, l.cr)).sort(),
      );
      for (const line of reverse.lines) {
        const original = forward.lines.find((l) => l.accountCode === line.accountCode)!;
        expect(line.description).toBe(`[กลับรายการ] ${original.description}`);
      }
    }
  });
});

describe('sortAccrual2AReversalLines', () => {
  const codes = (lines: { accountCode: string }[]) => lines.map((l) => l.accountCode);

  it('เรียงตามรูปที่เสนอฝ่ายบัญชี ไม่ว่าบรรทัดจะเข้ามาลำดับใด และไม่แก้ array ที่ส่งเข้ามา', () => {
    const posted = buildAccrual2ALines({ ...CONTRACT_17K_12M, installmentNo: 3 }).lines;
    const before = codes(posted);

    expect(codes(sortAccrual2AReversalLines(posted))).toEqual([
      '11-2101',
      '11-2105',
      '21-2101',
      '41-1101',
      '11-2103',
      '21-2102',
      '11-2106',
    ]);
    expect(codes(sortAccrual2AReversalLines([...posted].reverse()))).toEqual([
      '11-2101',
      '11-2105',
      '21-2101',
      '41-1101',
      '11-2103',
      '21-2102',
      '11-2106',
    ]);
    expect(codes(posted)).toEqual(before);
  });

  it('บัญชีที่ไม่อยู่ในรูป (ไม่ควรมี) ไม่ถูกทิ้ง — ต่อท้ายตามลำดับเดิม', () => {
    const sorted = sortAccrual2AReversalLines([
      { accountCode: '99-0002' },
      { accountCode: '11-2106' },
      { accountCode: '99-0001' },
      { accountCode: '11-2101' },
    ]);

    expect(codes(sorted)).toEqual(['11-2101', '11-2106', '99-0002', '99-0001']);
  });
});

describe('resolveAccrualPostingDate', () => {
  const DUE_12_OCT = new Date('2026-10-11T17:00:00.000Z'); // 12 ต.ค. 2569 00:00 เวลาไทย

  it('รับเงินก่อนครบกำหนด → ใช้วันที่รับเงิน', () => {
    const receipt = new Date('2026-09-29T03:00:00.000Z'); // 29 ก.ย. 10:00 เวลาไทย
    expect(resolveAccrualPostingDate(DUE_12_OCT, receipt)).toBe(receipt);
  });

  it('รับเงินหลังครบกำหนด (รอบกลางคืนตกหล่น) → ใช้วันครบกำหนด', () => {
    const receipt = new Date('2026-10-15T03:00:00.000Z');
    expect(resolveAccrualPostingDate(DUE_12_OCT, receipt)).toBe(DUE_12_OCT);
  });

  it('รับเงินวันครบกำหนดพอดี (หลังเที่ยงคืนไทย) → ใช้วันครบกำหนด', () => {
    const receipt = new Date('2026-10-12T02:00:00.000Z'); // 12 ต.ค. 09:00 เวลาไทย
    expect(resolveAccrualPostingDate(DUE_12_OCT, receipt)).toBe(DUE_12_OCT);
  });

  it('รับเงินย้อนหลัง (วันที่อย่างเดียว = เที่ยงคืน UTC) ก่อนครบกำหนด → ใช้วันที่รับเงิน', () => {
    const receipt = new Date('2026-10-10'); // 10 ต.ค. 07:00 เวลาไทย
    expect(resolveAccrualPostingDate(DUE_12_OCT, receipt)).toBe(receipt);
  });
});

describe('resolveAccrualPeriodCheckDate', () => {
  const DUE_1_OCT = new Date('2026-09-30T17:00:00.000Z'); // 1 ต.ค. 2569 00:00 เวลาไทย

  it('รับเงินก่อนครบกำหนด → ตรวจงวดด้วยวันที่รับเงิน (Date ตัวเดียวกับที่ใบรับชำระถูกตรวจ)', () => {
    const receipt = new Date('2026-09-29T03:00:00.000Z'); // 29 ก.ย. 10:00 เวลาไทย
    expect(resolveAccrualPeriodCheckDate(DUE_1_OCT, receipt)).toBe(receipt);
  });

  it('รับเงิน 00:30 ของวันที่ 1 ซึ่งเป็นวันครบกำหนด → 2A ลงวันครบกำหนด แต่ตรวจงวดด้วยวันที่รับเงิน', () => {
    const receipt = new Date('2026-09-30T17:30:00.000Z'); // 1 ต.ค. 00:30 เวลาไทย
    expect(resolveAccrualPostingDate(DUE_1_OCT, receipt)).toBe(DUE_1_OCT);
    expect(resolveAccrualPeriodCheckDate(DUE_1_OCT, receipt)).toBe(receipt);
  });

  it('รับเงิน 08:00 ของวันครบกำหนด (คนละวันตามเวลา UTC) → ยังตรวจงวดด้วยวันที่รับเงิน', () => {
    const receipt = new Date('2026-10-01T01:00:00.000Z'); // 1 ต.ค. 08:00 เวลาไทย
    expect(resolveAccrualPostingDate(DUE_1_OCT, receipt)).toBe(DUE_1_OCT);
    expect(resolveAccrualPeriodCheckDate(DUE_1_OCT, receipt)).toBe(receipt);
  });

  it('รับเงินหลังวันครบกำหนด (คนละวันตามปฏิทินไทย) → ตรวจงวดด้วยวันครบกำหนด เหมือนรอบกลางคืน', () => {
    const receipt = new Date('2026-10-05T03:00:00.000Z'); // 5 ต.ค. 10:00 เวลาไทย
    expect(resolveAccrualPeriodCheckDate(DUE_1_OCT, receipt)).toBe(DUE_1_OCT);
  });
});

describe('isDueDateReached', () => {
  const DUE_12_OCT = new Date('2026-10-11T17:00:00.000Z'); // 12 ต.ค. 2569 00:00 เวลาไทย

  it('วันก่อนวันครบกำหนด (23:59 เวลาไทย) → ยังไม่ถึง', () => {
    expect(isDueDateReached(DUE_12_OCT, new Date('2026-10-11T16:59:00.000Z'))).toBe(false);
  });

  it('วันครบกำหนดเอง ตั้งแต่ 00:00 เวลาไทย → ถึงแล้ว (รอบกลางคืน 00:01 ของวันนั้นเลือกงวดนี้)', () => {
    expect(isDueDateReached(DUE_12_OCT, new Date('2026-10-11T17:00:00.000Z'))).toBe(true);
    expect(isDueDateReached(DUE_12_OCT, new Date('2026-10-12T16:59:00.000Z'))).toBe(true);
  });

  it('หลังวันครบกำหนด → ถึงแล้ว', () => {
    expect(isDueDateReached(DUE_12_OCT, new Date('2026-10-13T03:00:00.000Z'))).toBe(true);
  });

  it('วันครบกำหนดที่ไม่ได้เก็บที่เที่ยงคืนไทย (เที่ยงคืน UTC = 07:00 เวลาไทย) → ตัดสินตามวันปฏิทินไทย', () => {
    const dueUtcMidnight = new Date('2026-10-12T00:00:00.000Z'); // 12 ต.ค. 07:00 เวลาไทย
    expect(isDueDateReached(dueUtcMidnight, new Date('2026-10-11T17:30:00.000Z'))).toBe(true); // 12 ต.ค. 00:30
    expect(isDueDateReached(dueUtcMidnight, new Date('2026-10-11T16:30:00.000Z'))).toBe(false); // 11 ต.ค. 23:30
  });
});

/**
 * ตั้งลูกหนี้งวดเท่ายอดที่รับ (คำตอบฝ่ายบัญชี ก1 "แบบ ข" 29/09/2569 — ตัวอย่างที่ฝ่ายบัญชีเลือก):
 *   ภาษีขาย = HALF_UP(ยอดที่รับ × 7/107) · มูลค่า = ยอดที่รับ − ภาษีขาย
 *   ดอกเบี้ย = HALF_UP(ดอกเบี้ยของงวด × มูลค่า ÷ มูลค่าของงวด) · ส่วนที่เหลือ = ยอดของงวด − ยอดที่ตั้งไปแล้ว ทีละบัญชี
 */
describe('ตั้งลูกหนี้งวดเท่ายอดที่รับ (ก1)', () => {
  const dec = (v: string) => new Decimal(v);
  /** งวดของตัวอย่างที่ฝ่ายบัญชีตอบ: 6,078.67 = 5,681.00 (ดอกเบี้ย 2,392.00) + VAT 397.67 — สัญญา 10 งวด */
  const CONTRACT_ACCOUNTANT = {
    financedAmount: '29900',
    storeCommission: '2990',
    interestTotal: '23920',
    vatAmount: '3976.70',
    totalMonths: 10,
  };
  const triples = (lines: { accountCode: string; dr: Decimal; cr: Decimal }[]) =>
    lines.map((l) => [l.accountCode, l.dr.toFixed(2), l.cr.toFixed(2)]);
  const accruedAfter = (a: AccruedSoFar) => [a.amount, a.vat, a.interest].map((v) => v.toFixed(2));
  const expectBalanced = (lines: { dr: Decimal; cr: Decimal }[]) =>
    expect(sum(lines.map((l) => l.dr)).toFixed(2)).toBe(sum(lines.map((l) => l.cr)).toFixed(2));

  it('ฐานของตัวอย่าง: งวดละ 6,078.67 = 5,681.00 + 397.67 · ดอกเบี้ย 2,392.00', () => {
    const full = buildAccrual2ALines({ ...CONTRACT_ACCOUNTANT, installmentNo: 3 });
    expect(full.installmentTotal.toFixed(2)).toBe('6078.67');
    expect(full.installmentExclVat.toFixed(2)).toBe('5681.00');
    expect(full.vatPerInst.toFixed(2)).toBe('397.67');
    expect(full.interestPerInst.toFixed(2)).toBe('2392.00');
  });

  it('ตัวอย่างฝ่ายบัญชี: รับ 3,000.00 ก่อนครบกำหนด → VAT 196.26 · มูลค่า 2,803.74 · ดอกเบี้ย 1,180.52', () => {
    const part = buildPartialAccrual2ALines(
      { ...CONTRACT_ACCOUNTANT, installmentNo: 3 },
      NOTHING_ACCRUED,
      dec('3000'),
    );

    expect(triples(part.lines)).toEqual([
      ['11-2103', '3000.00', '0.00'],
      ['21-2102', '196.26', '0.00'],
      ['11-2106', '1180.52', '0.00'],
      ['11-2101', '0.00', '2803.74'],
      ['11-2105', '0.00', '196.26'],
      ['41-1101', '0.00', '1180.52'],
      ['21-2101', '0.00', '196.26'],
    ]);
    expectBalanced(part.lines); // Σ 4,376.78
    expect(sum(part.lines.map((l) => l.dr)).toFixed(2)).toBe('4376.78');
    expect(part.kind).toBe('PARTIAL');
    expect(part.completes).toBe(false);
    expect(accruedAfter(part.accruedAfter)).toEqual(['3000.00', '196.26', '1180.52']);
  });

  it('ตัวอย่างฝ่ายบัญชี: ส่วนที่เหลือ = ยอดของงวด − ส่วนที่ตั้งไปแล้ว → 3,078.67 · VAT 201.41 · มูลค่า 2,877.26 · ดอกเบี้ย 1,211.48', () => {
    const input = { ...CONTRACT_ACCOUNTANT, installmentNo: 3 };
    const first = buildPartialAccrual2ALines(input, NOTHING_ACCRUED, dec('3000'));
    const rest = buildRemainderAccrual2ALines(input, first.accruedAfter);

    expect(triples(rest.lines)).toEqual([
      ['11-2103', '3078.67', '0.00'],
      ['21-2102', '201.41', '0.00'],
      ['11-2106', '1211.48', '0.00'],
      ['11-2101', '0.00', '2877.26'],
      ['11-2105', '0.00', '201.41'],
      ['41-1101', '0.00', '1211.48'],
      ['21-2101', '0.00', '201.41'],
    ]);
    expectBalanced(rest.lines); // Σ 4,491.56
    expect(rest.kind).toBe('REMAINDER');
    expect(rest.completes).toBe(true);
    // สองรายการรวมกัน = ทั้งงวดพอดี
    expect(accruedAfter(rest.accruedAfter)).toEqual(['6078.67', '397.67', '2392.00']);
  });

  it('สัญญา 17,000/12 งวด 3: รับ 1,000 → 65.42 / 934.58 / 329.85 แล้วรับ 515.83 ที่เหลือ → 33.75 / 482.08 / 170.15', () => {
    const input = { ...CONTRACT_17K_12M, installmentNo: 3 };
    const first = buildPartialAccrual2ALines(input, NOTHING_ACCRUED, dec('1000'));
    expect(triples(first.lines)).toEqual([
      ['11-2103', '1000.00', '0.00'],
      ['21-2102', '65.42', '0.00'],
      ['11-2106', '329.85', '0.00'],
      ['11-2101', '0.00', '934.58'],
      ['11-2105', '0.00', '65.42'],
      ['41-1101', '0.00', '329.85'],
      ['21-2101', '0.00', '65.42'],
    ]);
    expectBalanced(first.lines); // Σ 1,395.27

    // ใบที่สองจ่ายส่วนที่เหลือพอดี — ทั้งทางใบรับชำระ (ยอดที่รับ) และรอบกลางคืน (ส่วนที่เหลือ) ได้บรรทัดเดียวกัน
    const viaReceipt = buildPartialAccrual2ALines(input, first.accruedAfter, dec('515.83'));
    const viaNightly = buildRemainderAccrual2ALines(input, first.accruedAfter);
    expect(triples(viaReceipt.lines)).toEqual(triples(viaNightly.lines));
    expect(triples(viaNightly.lines)).toEqual([
      ['11-2103', '515.83', '0.00'],
      ['21-2102', '33.75', '0.00'],
      ['11-2106', '170.15', '0.00'],
      ['11-2101', '0.00', '482.08'],
      ['11-2105', '0.00', '33.75'],
      ['41-1101', '0.00', '170.15'],
      ['21-2101', '0.00', '33.75'],
    ]);
    expect(viaReceipt.kind).toBe('REMAINDER');
    expect(viaReceipt.completes).toBe(true);
  });

  it('สามครั้งก่อนครบกำหนด 500 / 600 / 415.83 → ครั้งสุดท้ายรับเศษ ยอดรวมเท่างวดพอดี (1,515.83 / 99.17 / 500.00)', () => {
    const input = { ...CONTRACT_17K_12M, installmentNo: 3 };
    const a = buildPartialAccrual2ALines(input, NOTHING_ACCRUED, dec('500'));
    const b = buildPartialAccrual2ALines(input, a.accruedAfter, dec('600'));
    const c = buildPartialAccrual2ALines(input, b.accruedAfter, dec('415.83'));

    expect(
      [a, b, c].map((p) =>
        [p.portion.total, p.portion.vat, p.portion.exclVat, p.portion.interest].map((v) =>
          v.toFixed(2),
        ),
      ),
    ).toEqual([
      ['500.00', '32.71', '467.29', '164.93'],
      ['600.00', '39.25', '560.75', '197.91'],
      ['415.83', '27.21', '388.62', '137.16'],
    ]);
    expect([a.kind, b.kind, c.kind]).toEqual(['PARTIAL', 'PARTIAL', 'REMAINDER']);
    expect(accruedAfter(c.accruedAfter)).toEqual(['1515.83', '99.17', '500.00']);
    for (const p of [a, b, c]) expectBalanced(p.lines);
  });

  it('งวดสุดท้าย (1,515.87 = 1,416.74 + 99.13): รับ 1,000 → 65.42 / 934.58 / 329.83 · ส่วนที่เหลือ 515.87 → 33.71 / 482.16 / 170.17', () => {
    const input = { ...CONTRACT_17K_12M, installmentNo: 12 };
    const first = buildPartialAccrual2ALines(input, NOTHING_ACCRUED, dec('1000'));
    const rest = buildRemainderAccrual2ALines(input, first.accruedAfter);

    expect(
      [first.portion.total, first.portion.vat, first.portion.exclVat, first.portion.interest].map(
        (v) => v.toFixed(2),
      ),
    ).toEqual(['1000.00', '65.42', '934.58', '329.83']);
    expect(
      [rest.portion.total, rest.portion.vat, rest.portion.exclVat, rest.portion.interest].map((v) =>
        v.toFixed(2),
      ),
    ).toEqual(['515.87', '33.71', '482.16', '170.17']);
    expect(accruedAfter(rest.accruedAfter)).toEqual(['1515.87', '99.13', '500.00']);
  });

  it('ยอดที่รับถึงส่วนที่เหลือ (เช่น ยอดเรียกเก็บ 1,516 รับ 1,515.83 แบบบางส่วน) → ตั้งทั้งงวดในรายการเดียว (FULL) และงวดตั้งครบ', () => {
    const input = { ...CONTRACT_17K_12M, installmentNo: 3 };
    const part = buildPartialAccrual2ALines(input, NOTHING_ACCRUED, dec('1515.83'));

    expect(triples(part.lines)).toEqual(triples(buildAccrual2ALines(input).lines));
    expect(part.kind).toBe('FULL');
    expect(part.completes).toBe(true);
    // ยอดเกินส่วนที่เหลือถูกตัดที่ส่วนที่เหลือ — ไม่มีบัญชีใดเกินยอดของงวด
    const over = buildPartialAccrual2ALines(input, NOTHING_ACCRUED, dec('1600'));
    expect(triples(over.lines)).toEqual(triples(part.lines));
  });

  it('ขอบ: เหลือ 0.01 ของมูลค่า — ภาษีขายและดอกเบี้ยตั้งหมดตั้งแต่ใบก่อน ส่วนที่เหลือมีเฉพาะ 11-2103/11-2101', () => {
    const input = { ...CONTRACT_17K_12M, installmentNo: 3 };
    const first = buildPartialAccrual2ALines(input, NOTHING_ACCRUED, dec('1515.82'));
    expect(
      [first.portion.vat, first.portion.exclVat, first.portion.interest].map((v) => v.toFixed(2)),
    ).toEqual(['99.17', '1416.65', '500.00']);
    const rest = buildRemainderAccrual2ALines(input, first.accruedAfter);
    expect(triples(rest.lines)).toEqual([
      ['11-2103', '0.01', '0.00'],
      ['21-2102', '0.00', '0.00'],
      ['11-2106', '0.00', '0.00'],
      ['11-2101', '0.00', '0.01'],
      ['11-2105', '0.00', '0.00'],
      ['41-1101', '0.00', '0.00'],
      ['21-2101', '0.00', '0.00'],
    ]);
  });

  it('ยอดที่รับ ≤ 0 → ส่วนศูนย์ (ผู้ลงข้ามเอง)', () => {
    const part = buildPartialAccrual2ALines(
      { ...CONTRACT_17K_12M, installmentNo: 3 },
      NOTHING_ACCRUED,
      dec('0'),
    );
    expect(part.portion.total.toFixed(2)).toBe('0.00');
    expect(part.completes).toBe(false);
  });

  it('งวดที่ยังไม่เคยตั้ง: ส่วนที่เหลือ = buildAccrual2ALines ทุกตัวอักษร (รอบกลางคืน/ใบที่ทำให้ครบไม่เปลี่ยน)', () => {
    const input = { ...CONTRACT_17K_12M, installmentNo: 7 };
    const rest = buildRemainderAccrual2ALines(input, NOTHING_ACCRUED);
    expect(rest.lines).toEqual(buildAccrual2ALines(input).lines);
    expect(rest.kind).toBe('FULL');
  });

  it('กระจกของรายการบางส่วน = บัญชีเดิม สลับฝั่ง เรียงตามรูปที่เสนอฝ่ายบัญชี', () => {
    const part = buildPartialAccrual2ALines(
      { ...CONTRACT_17K_12M, installmentNo: 3 },
      NOTHING_ACCRUED,
      dec('1000'),
    );
    expect(triples(mirrorAccrual2APart(part))).toEqual([
      ['11-2101', '934.58', '0.00'],
      ['11-2105', '65.42', '0.00'],
      ['21-2101', '65.42', '0.00'],
      ['41-1101', '329.85', '0.00'],
      ['11-2103', '0.00', '1000.00'],
      ['21-2102', '0.00', '65.42'],
      ['11-2106', '0.00', '329.85'],
    ]);
  });

  it('accruedSoFarOf: อ่านสามคอลัมน์ · คอลัมน์ที่ไม่มีมา (select ลืมเลือก) → throw ไม่อ่านเป็น 0', () => {
    expect(
      accruedAfter(
        accruedSoFarOf({
          accruedAmount: dec('1000'),
          accruedVat: dec('65.42'),
          accruedInterest: dec('329.85'),
        }),
      ),
    ).toEqual(['1000.00', '65.42', '329.85']);
    expect(
      accruedAfter(
        accruedSoFarOf({
          accruedAmount: dec('0'),
          accruedVat: dec('0'),
          accruedInterest: dec('0'),
        }),
      ),
    ).toEqual(['0.00', '0.00', '0.00']);
    expect(() => accruedSoFarOf({} as never)).toThrow('accruedAmount is missing');
    expect(() =>
      accruedSoFarOf({ accruedAmount: dec('1000'), accruedInterest: dec('329.85') } as never),
    ).toThrow('accruedVat is missing');
    expect(() =>
      accruedSoFarOf({
        accruedAmount: dec('1000'),
        accruedVat: dec('65.42'),
        accruedInterest: null,
      } as never),
    ).toThrow('accruedInterest is missing');
  });

  it('accrual2AInputOf: แถวสัญญา → ข้อมูลเข้าของตัวสร้าง (null ส่งต่อเป็น null)', () => {
    expect(
      accrual2AInputOf(
        {
          financedAmount: dec('10000'),
          storeCommission: null,
          interestTotal: dec('6000'),
          vatAmount: null,
          totalMonths: 12,
        },
        4,
      ),
    ).toEqual({
      financedAmount: '10000',
      storeCommission: null,
      interestTotal: '6000',
      vatAmount: null,
      totalMonths: 12,
      installmentNo: 4,
    });
  });
});
