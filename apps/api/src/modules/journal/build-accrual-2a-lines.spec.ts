import { Decimal } from '@prisma/client/runtime/library';
import {
  buildAccrual2ALines,
  buildAccrual2AReversalLines,
  isDueDateReached,
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
