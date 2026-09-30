import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  PP30_INCLUDES_MANDATORY_60DAY,
  Pp30Client,
  Pp30OutputVatLine,
  Pp30OutputVatSummary,
  classifyOutputVatReduction,
  computePp30OutputVat,
  pp30MonthRange,
  resolvePp30CompanyId,
  summarizePp30OutputVat,
  toPp30OutputVatJson,
} from './pp30-output-vat';

/**
 * ภาษีขายของแบบ ภ.พ.30 — ตัวคำนวณเดียว (jest, ไม่ต่อฐานข้อมูล)
 * ตัวเลขทองมาจากสัญญามาตรฐาน 17,000 / 12 งวด (VAT ต่องวด 99.17 — accounting.md "Rounding Modes")
 * และ Scenario A ของ `jp5-vat-split.spec.ts` (JP5: ใบลดหนี้ 99.17 + ภาษีถึงกำหนด 793.32)
 * ภาษีขาย 60 วัน (21-2103) เป็นข้อมูลประกอบ ไม่รวมในยอด (`PP30_INCLUDES_MANDATORY_60DAY = false` — รอฝ่ายบัญชี)
 */

const D = (value: string) => new Prisma.Decimal(value);

let seq = 0;
function line(
  accountCode: string,
  debit: string,
  credit: string,
  entry: {
    referenceType?: string | null;
    metadata?: Prisma.JsonValue | null;
    /** F1 (fix round 1): true = จำลองรายการที่มีบรรทัดพี่น้องบน 21-3201 — ไม่ส่ง/undefined = ไม่ใช่ (ค่าเดิม) */
    isVatSettlement?: boolean;
  } = {},
): Pp30OutputVatLine {
  seq += 1;
  return {
    accountCode,
    debit: D(debit),
    credit: D(credit),
    journalEntry: {
      id: `je-${seq}`,
      entryNumber: `JE-202610-${String(seq).padStart(5, '0')}`,
      entryDate: new Date('2026-10-15T05:00:00.000Z'),
      referenceType: entry.referenceType === undefined ? 'AUTO' : entry.referenceType,
      description: `รายการที่ ${seq}`,
      metadata: entry.metadata === undefined ? null : entry.metadata,
      ...(entry.isVatSettlement === undefined ? {} : { isVatSettlement: entry.isVatSettlement }),
    },
  };
}

// metadata รูปเดียวกับที่ template แต่ละตัวเขียนจริง
const META_2A = { tag: '2A', contractId: 'c-1', installmentScheduleId: 'inst-3' };
const META_RECEIPT_ACCRUAL_VOID = {
  tag: 'REVERSAL',
  flow: 'receipt-accrual-void',
  idempotencyKey: 'receipt-accrual-void:je-2a',
  originalEntryId: 'je-2a',
  originalEntryNumber: 'JE-202610-00001',
  contractId: 'c-1',
};
const META_EXCHANGE_CANCEL = {
  tag: 'REVERSAL',
  flow: 'exchange-cancel',
  idempotencyKey: 'cancel:je-9',
  originalEntryId: 'je-9',
  reversesEntryId: 'je-9',
  contractId: 'c-4',
};
// รูปที่งานแยกถัดไป "ยกเลิกรายการบัญชีด้วยมือ" จะเขียน — PR นี้ยังไม่มีผู้สร้าง metadata นี้ (ตัวจัดประเภทรองรับไว้ก่อน)
const META_JOURNAL_VOID = {
  tag: 'REVERSAL',
  flow: 'journal-void',
  idempotencyKey: 'journal-void:je-7',
  originalEntryId: 'je-7',
  originalEntryNumber: 'JE-202609-00007',
  reversesEntryId: 'je-7',
};
const META_JP5 = {
  tag: 'JP5',
  flow: 'repossession',
  contractId: 'c-2',
  creditNoteIssued: true,
  creditNoteVatAmount: '99.17',
};
const META_WRITE_OFF = {
  tag: 'BAD-DEBT',
  flow: 'write-off',
  idempotencyKey: 'c-3',
  contractId: 'c-3',
  creditNoteIssued: true,
  creditNoteVatAmount: '297.51',
};
const META_OTHER_INCOME = {
  source: 'OTHER_INCOME',
  docNumber: 'OI-20261001-0001',
  otherIncomeId: 'oi-1',
};
const META_OTHER_INCOME_R = {
  source: 'OTHER_INCOME',
  docNumber: 'OI-20261015-0002-R',
  otherIncomeId: 'oi-1:reversal',
};
const META_VAT60 = {
  tag: 'VAT60-MANDATORY',
  flow: 'mandatory',
  contractId: 'c-1',
  vatPerInst: '99.17',
};
const META_VAT60_REV = { tag: 'VAT60-REVERSAL', flow: 'reversal', contractId: 'c-1' };

/**
 * กฎกระทบยอดที่ต้องจริงทุกกรณี: รวม − หัก = สุทธิ · ภาษีขาย = สุทธิ 21-2101 (+ สุทธิ 21-2103 เฉพาะเมื่อรวม 60 วัน)
 */
function expectReconciles(s: Pp30OutputVatSummary) {
  const { reversal, creditNote, other, total } = s.reductions;
  expect(reversal.plus(creditNote).plus(other).toFixed(2)).toBe(total.toFixed(2));
  expect(s.settledGross.minus(total).toFixed(2)).toBe(s.settledNet.toFixed(2));
  expect(s.mandatory60Day.credit.minus(s.mandatory60Day.debit).toFixed(2)).toBe(
    s.mandatory60Day.net.toFixed(2),
  );
  const expectedTotal = s.mandatory60DayIncluded
    ? s.settledNet.plus(s.mandatory60Day.net)
    : s.settledNet;
  expect(expectedTotal.toFixed(2)).toBe(s.totalOutputVat.toFixed(2));
}

describe('summarizePp30OutputVat', () => {
  it('ยกเลิกใบเสร็จแล้วตั้งลูกหนี้งวดใหม่ในเดือนเดียวกัน: เครดิต 99.17 · กลับ 99.17 · ตั้งใหม่ 99.17 ⇒ 99.17 (เดิมนับได้ 198.34)', () => {
    const reversalLine = line('21-2101', '99.17', '0', { metadata: META_RECEIPT_ACCRUAL_VOID });
    const s = summarizePp30OutputVat([
      line('21-2101', '0', '99.17', { metadata: META_2A }),
      reversalLine,
      line('21-2101', '0', '99.17', { metadata: { ...META_2A, trigger: 'receipt' } }),
    ]);

    expect(toPp30OutputVatJson(s)).toEqual({
      settledGross: '198.34',
      reductionReversal: '99.17',
      reductionCreditNote: '0.00',
      reductionOther: '0.00',
      reductionTotal: '99.17',
      settledNet: '99.17',
      mandatory60DayCredit: '0.00',
      mandatory60DayDebit: '0.00',
      mandatory60DayNet: '0.00',
      mandatory60DayIncluded: false,
      totalOutputVat: '99.17',
    });
    expect(s.reductionLines).toEqual([
      {
        entryId: reversalLine.journalEntry.id,
        entryNumber: reversalLine.journalEntry.entryNumber,
        entryDate: reversalLine.journalEntry.entryDate,
        description: reversalLine.journalEntry.description,
        kind: 'REVERSAL',
        amount: D('99.17'),
      },
    ]);
    expectReconciles(s);
  });

  it('ยึดคืน JP5 (Scenario A): รายการเดียวมีทั้งเดบิต 99.17 (ใบลดหนี้) และเครดิต 793.32 (ภาษีถึงกำหนด) ⇒ 694.15', () => {
    const s = summarizePp30OutputVat([
      line('21-2101', '99.17', '0', { metadata: META_JP5 }),
      line('21-2101', '0', '793.32', { metadata: META_JP5 }),
    ]);

    expect(s.settledGross.toFixed(2)).toBe('793.32');
    expect(s.reductions.creditNote.toFixed(2)).toBe('99.17');
    expect(s.reductions.reversal.toFixed(2)).toBe('0.00');
    expect(s.settledNet.toFixed(2)).toBe('694.15');
    expect(s.totalOutputVat.toFixed(2)).toBe('694.15');
    expect(s.reductionLines.map((r) => r.kind)).toEqual(['CREDIT_NOTE']);
    expectReconciles(s);
  });

  it('ตัดหนี้สูญ: ใบลดหนี้ 3 งวด 297.51 · ภาษีถึงกำหนด 892.49 ⇒ 594.98', () => {
    const s = summarizePp30OutputVat([
      line('21-2101', '297.51', '0', { metadata: META_WRITE_OFF }),
      line('21-2101', '0', '892.49', { metadata: META_WRITE_OFF }),
    ]);

    expect(s.reductions.creditNote.toFixed(2)).toBe('297.51');
    expect(s.settledNet.toFixed(2)).toBe('594.98');
    expectReconciles(s);
  });

  it('รายการกลับที่ไม่มี tag นับเป็นกลับรายการ (ยกเลิกด้วยมือแบบเดิม · เอกสารรายได้อื่น -R) · เดบิตที่ระบุที่มาไม่ได้อยู่ "อื่น ๆ" ไม่หาย', () => {
    const s = summarizePp30OutputVat([
      line('21-2101', '0', '99.17', { metadata: META_2A }),
      line('21-2101', '0', '14.00', { metadata: META_OTHER_INCOME }),
      line('21-2101', '14.00', '0', { metadata: META_OTHER_INCOME_R }),
      line('21-2101', '0', '7.00', { referenceType: null }),
      line('21-2101', '7.00', '0', { referenceType: 'REVERSAL' }),
      line('21-2101', '3.00', '0', { referenceType: null }),
    ]);

    expect(toPp30OutputVatJson(s)).toMatchObject({
      settledGross: '120.17',
      reductionReversal: '21.00',
      reductionCreditNote: '0.00',
      reductionOther: '3.00',
      reductionTotal: '24.00',
      settledNet: '96.17',
      totalOutputVat: '96.17',
    });
    expect(s.reductionLines.map((r) => [r.kind, r.amount.toFixed(2)])).toEqual([
      ['REVERSAL', '14.00'],
      ['REVERSAL', '7.00'],
      ['OTHER', '3.00'],
    ]);
    expectReconciles(s);
  });

  it('ภาษีขาย 60 วัน (21-2103) นับสุทธิเป็นข้อมูลประกอบ: ตั้ง 99.17 × 2 · กลับรายการ 99.17 ⇒ 99.17 — ไม่รวมในยอด ภ.พ.30 (รอฝ่ายบัญชี)', () => {
    const s = summarizePp30OutputVat([
      line('21-2101', '0', '99.17', { metadata: META_2A }),
      line('21-2103', '0', '99.17', { metadata: META_VAT60 }),
      line('21-2103', '0', '99.17', { metadata: META_VAT60 }),
      line('21-2103', '99.17', '0', { metadata: META_VAT60_REV }),
    ]);

    expect(s.mandatory60Day.credit.toFixed(2)).toBe('198.34');
    expect(s.mandatory60Day.debit.toFixed(2)).toBe('99.17');
    expect(s.mandatory60Day.net.toFixed(2)).toBe('99.17');
    expect(s.mandatory60DayIncluded).toBe(false);
    expect(s.totalOutputVat.toFixed(2)).toBe('99.17'); // 2A 99.17 เท่านั้น (เดิม 198.34)
    expect(s.reductionLines).toEqual([]); // เดบิต 21-2103 ไม่ใช่ "รายการที่ลดภาษีขาย 21-2101"
    expectReconciles(s);
  });

  it('เดือนที่มีแต่รายการกลับรายการของเดือนก่อน ⇒ ติดลบตามจริง ไม่ปัดเป็นศูนย์', () => {
    const s = summarizePp30OutputVat([
      line('21-2101', '99.17', '0', { metadata: META_EXCHANGE_CANCEL }),
    ]);

    expect(toPp30OutputVatJson(s).totalOutputVat).toBe('-99.17');
    expect(s.reductions.reversal.toFixed(2)).toBe('99.17');
    expectReconciles(s);
  });

  it('เดือนว่าง ⇒ ศูนย์ทุกช่อง', () => {
    const s = summarizePp30OutputVat([]);

    expect(toPp30OutputVatJson(s)).toEqual({
      settledGross: '0.00',
      reductionReversal: '0.00',
      reductionCreditNote: '0.00',
      reductionOther: '0.00',
      reductionTotal: '0.00',
      settledNet: '0.00',
      mandatory60DayCredit: '0.00',
      mandatory60DayDebit: '0.00',
      mandatory60DayNet: '0.00',
      mandatory60DayIncluded: false,
      totalOutputVat: '0.00',
    });
    expect(s.reductionLines).toEqual([]);
  });

  it('บรรทัดของบัญชีอื่นถูกข้าม (ตัวคำนวณนับเฉพาะ 21-2101 และ 21-2103)', () => {
    const s = summarizePp30OutputVat([
      line('11-4101', '70.00', '0'),
      line('21-2102', '0', '99.17'),
      line('21-2101', '0', '99.17', { metadata: META_2A }),
    ]);

    expect(s.totalOutputVat.toFixed(2)).toBe('99.17');
    expect(s.reductions.total.toFixed(2)).toBe('0.00');
  });

  it('เดือนตุลาคมของ spec ต่อฐานจริง: 2A 99.17 × 2 · กลับ 99.17 · JP5 (99.17 / 793.32) ⇒ 793.32 · 60 วัน 99.17 × 2 − 99.17 = 99.17 เป็นข้อมูลประกอบ', () => {
    const s = summarizePp30OutputVat([
      line('21-2101', '0', '99.17', { metadata: META_2A }),
      line('21-2101', '0', '99.17', { metadata: META_2A }),
      line('21-2101', '99.17', '0', { metadata: META_EXCHANGE_CANCEL }),
      line('21-2101', '99.17', '0', { metadata: META_JP5 }),
      line('21-2101', '0', '793.32', { metadata: META_JP5 }),
      line('21-2103', '0', '99.17', { metadata: META_VAT60 }),
      line('21-2103', '0', '99.17', { metadata: META_VAT60 }),
      line('21-2103', '99.17', '0', { metadata: META_VAT60_REV }),
    ]);

    expect(toPp30OutputVatJson(s)).toEqual({
      settledGross: '991.66',
      reductionReversal: '99.17',
      reductionCreditNote: '99.17',
      reductionOther: '0.00',
      reductionTotal: '198.34',
      settledNet: '793.32',
      mandatory60DayCredit: '198.34',
      mandatory60DayDebit: '99.17',
      mandatory60DayNet: '99.17',
      mandatory60DayIncluded: false,
      totalOutputVat: '793.32',
    });
    expectReconciles(s);
  });

  it('F1: รายการปิดภาษี (VAT close) ที่แตะ 21-3201 ไม่กระทบยอดใดๆ — Dr 21-2101 500 / Cr 11-4101 Y / Cr 21-3201 (500−Y) ไม่ถูกนับทั้งบรรทัด', () => {
    const s = summarizePp30OutputVat([
      line('21-2101', '0', '99.17', { metadata: META_2A }),
      line('21-2101', '500.00', '0', { isVatSettlement: true }),
    ]);

    expect(toPp30OutputVatJson(s)).toMatchObject({
      settledGross: '99.17',
      reductionReversal: '0.00',
      reductionCreditNote: '0.00',
      reductionOther: '0.00',
      reductionTotal: '0.00',
      settledNet: '99.17',
      totalOutputVat: '99.17',
    });
    expect(s.reductionLines).toEqual([]);
    expectReconciles(s);
  });

  it('F1: รายการกลับของรายการปิดภาษี (เครดิต 21-2101 500 · tag REVERSAL · แตะ 21-3201) ไม่ถูกนับเข้า settledGross เช่นกัน', () => {
    const s = summarizePp30OutputVat([
      line('21-2101', '0', '99.17', { metadata: META_2A }),
      line('21-2101', '0', '500.00', { metadata: { tag: 'REVERSAL' }, isVatSettlement: true }),
    ]);

    expect(s.settledGross.toFixed(2)).toBe('99.17'); // ไม่รวม 500 ของรายการกลับรายการปิดภาษี
    expect(toPp30OutputVatJson(s)).toMatchObject({
      settledGross: '99.17',
      reductionTotal: '0.00',
      settledNet: '99.17',
      totalOutputVat: '99.17',
    });
    expect(s.reductionLines).toEqual([]);
    expectReconciles(s);
  });

  it('F1: จ่ายภาษีตรงไม่ผ่าน 21-3201 (Dr 21-2101 / Cr ธนาคาร) ยังนับเป็น "อื่น ๆ" ตามเดิม (ข้อจำกัดที่รู้ตัว)', () => {
    const s = summarizePp30OutputVat([
      line('21-2101', '0', '99.17', { metadata: META_2A }),
      line('21-2101', '50.00', '0'), // Dr 21-2101 / Cr ธนาคาร ตรง ๆ ไม่มีบรรทัด 21-3201 ในรายการเดียวกัน
    ]);

    expect(s.reductions.other.toFixed(2)).toBe('50.00');
    expect(s.reductionLines.map((r) => r.kind)).toEqual(['OTHER']);
    expect(s.settledNet.toFixed(2)).toBe('49.17');
    expectReconciles(s);
  });

  it('F1 (fix round 2): รายการปิด/ชำระภาษีขายที่แตะทั้ง 21-2101 และ 21-2103 พร้อมกัน (Dr 21-2101 99.17 + Dr 21-2103 99.17 / Cr 21-3201) ไม่กระทบตัวเลขใดๆ เลย — เดิมฝั่ง 21-2103 ยังรั่วเข้า mandatory60Day (round 1 กันเฉพาะฝั่ง 21-2101)', () => {
    const baseLines = [
      line('21-2101', '0', '99.17', { metadata: META_2A }),
      line('21-2103', '0', '99.17', { metadata: META_VAT60 }),
      line('21-2103', '99.17', '0', { metadata: META_VAT60_REV }),
    ];
    const baseline = summarizePp30OutputVat(baseLines);
    const withSettlement = summarizePp30OutputVat([
      ...baseLines,
      // รายการปิด/ชำระภาษีขาย: Dr 21-2101 99.17 + Dr 21-2103 99.17 / Cr 21-3201 198.34 (Cr 21-3201 ไม่ได้อยู่ในอินพุตของ
      // summarizePp30OutputVat เพราะตัวคำนวณอ่านเฉพาะ 21-2101/21-2103 — isVatSettlement: true จำลองสิ่งที่
      // toPp30OutputVatLine จะคำนวณให้จริงเมื่อรายการมีบรรทัดพี่น้องบน 21-3201)
      line('21-2101', '99.17', '0', { isVatSettlement: true }),
      line('21-2103', '99.17', '0', { isVatSettlement: true }),
    ]);

    // "ทุกตัวเลข 60 วันไม่เปลี่ยน" ตามที่ F1 ต้องการ — เทียบทั้งก้อนกับ baseline ที่ไม่มีรายการปิดภาษีเลย
    expect(toPp30OutputVatJson(withSettlement)).toEqual(toPp30OutputVatJson(baseline));
    expect(withSettlement.reductionLines).toEqual(baseline.reductionLines);

    expect(toPp30OutputVatJson(withSettlement)).toEqual({
      settledGross: '99.17',
      reductionReversal: '0.00',
      reductionCreditNote: '0.00',
      reductionOther: '0.00',
      reductionTotal: '0.00',
      settledNet: '99.17',
      mandatory60DayCredit: '99.17',
      mandatory60DayDebit: '99.17', // เฉพาะ VAT60_REV — ไม่รวมเดบิต 99.17 ของรายการปิดภาษี (เดิมได้ 198.34)
      mandatory60DayNet: '0.00',
      mandatory60DayIncluded: false,
      totalOutputVat: '99.17',
    });
    expectReconciles(withSettlement);
  });
});

describe('PP30_INCLUDES_MANDATORY_60DAY', () => {
  it('false จนกว่าฝ่ายบัญชีจะตอบ — เปลี่ยนค่าต้องแก้ข้อความ "ยังไม่รวม" บนหน้า /finance/vat และในไฟล์ Excel ภ.พ.30 พร้อมกัน', () => {
    expect(PP30_INCLUDES_MANDATORY_60DAY).toBe(false);
  });
});

describe('classifyOutputVatReduction', () => {
  it.each<[string, string, { referenceType: string | null; metadata: Prisma.JsonValue | null }]>([
    [
      'ยกเลิกใบเสร็จ — กลับรายการตั้งลูกหนี้งวด (PR #1654)',
      'REVERSAL',
      { referenceType: 'AUTO', metadata: META_RECEIPT_ACCRUAL_VOID },
    ],
    [
      'ยกเลิกเปลี่ยนเครื่อง / ยกเลิกสัญญา (engine กระจกกลาง)',
      'REVERSAL',
      { referenceType: 'AUTO', metadata: META_EXCHANGE_CANCEL },
    ],
    [
      'ยกเลิกรายการบัญชีด้วยมือ — รายการกลับมี metadata (flow journal-void · งานแยกถัดไป)',
      'REVERSAL',
      { referenceType: 'REVERSAL', metadata: META_JOURNAL_VOID },
    ],
    [
      'ยกเลิกรายการบัญชีด้วยมือ — รายการกลับไม่มี metadata (referenceType REVERSAL)',
      'REVERSAL',
      { referenceType: 'REVERSAL', metadata: null },
    ],
    [
      'เอกสารรายได้อื่นแบบกลับรายการ -R',
      'REVERSAL',
      { referenceType: 'AUTO', metadata: META_OTHER_INCOME_R },
    ],
    ['ยึดคืน JP5 — ใบลดหนี้ ม.82/5', 'CREDIT_NOTE', { referenceType: 'AUTO', metadata: META_JP5 }],
    [
      'ตัดหนี้สูญ — ใบลดหนี้ ม.82/5',
      'CREDIT_NOTE',
      { referenceType: 'AUTO', metadata: META_WRITE_OFF },
    ],
    [
      'รายการ JP5 ที่ flow ไม่ใช่ repossession',
      'OTHER',
      { referenceType: 'AUTO', metadata: { tag: 'JP5', flow: 'other' } },
    ],
    [
      'ตั้งค่าเผื่อหนี้สงสัยจะสูญ (tag BAD-DEBT แต่ไม่ใช่ write-off)',
      'OTHER',
      { referenceType: 'AUTO', metadata: { tag: 'BAD-DEBT', flow: 'provision' } },
    ],
    [
      'เอกสารรายได้อื่นต้นฉบับ (ไม่ใช่ -R)',
      'OTHER',
      { referenceType: 'AUTO', metadata: META_OTHER_INCOME },
    ],
    [
      'JV มือ (ไม่มี metadata ไม่มี referenceType)',
      'OTHER',
      { referenceType: null, metadata: null },
    ],
    [
      'metadata เป็น array (ข้อมูลผิดรูป)',
      'OTHER',
      { referenceType: 'AUTO', metadata: ['REVERSAL'] },
    ],
  ])('%s → %s', (_label, expected, entry) => {
    expect(classifyOutputVatReduction(entry)).toBe(expected);
  });
});

describe('pp30MonthRange — เดือนตามปฏิทินไทย ไม่ขึ้นกับเขตเวลาของโปรเซส', () => {
  it('ตุลาคม 2569: [1 ต.ค. 00:00 น., 1 พ.ย. 00:00 น.) เวลาไทย', () => {
    expect(pp30MonthRange(2026, 10)).toEqual({
      gte: new Date('2026-09-30T17:00:00.000Z'),
      lt: new Date('2026-10-31T17:00:00.000Z'),
    });
  });

  it('ธันวาคมข้ามปี และมกราคม', () => {
    expect(pp30MonthRange(2026, 12).lt).toEqual(new Date('2026-12-31T17:00:00.000Z'));
    expect(pp30MonthRange(2027, 1).gte).toEqual(new Date('2026-12-31T17:00:00.000Z'));
  });

  it('กุมภาพันธ์ปีอธิกสุรทิน', () => {
    expect(pp30MonthRange(2028, 2)).toEqual({
      gte: new Date('2028-01-31T17:00:00.000Z'),
      lt: new Date('2028-02-29T17:00:00.000Z'),
    });
  });

  it.each<[number, number]>([
    [2026, 0],
    [2026, 13],
    [Number.NaN, 5],
    [2026, Number.NaN],
    [2026, 1.5],
    [1999, 5],
  ])('ปี %s เดือน %s → 400 "ปี/เดือนไม่ถูกต้อง"', (year, month) => {
    expect(() => pp30MonthRange(year, month)).toThrow(
      new BadRequestException('ปี/เดือนไม่ถูกต้อง'),
    );
  });
});

describe('computePp30OutputVat — query ของเดือน', () => {
  function mockClient(byAccount: Record<string, Pp30OutputVatLine[]>) {
    const findMany = jest.fn((args: { where: { accountCode: string } }) =>
      Promise.resolve(byAccount[args.where.accountCode] ?? []),
    );
    const findFirst = jest.fn();
    return {
      client: { journalLine: { findMany }, companyInfo: { findFirst } } as unknown as Pp30Client,
      findMany,
      findFirst,
    };
  }

  it('ยิงสอง query (21-2101 และ 21-2103): POSTED · ไม่ถูกลบ · บริษัทที่ส่งมา · entryDate ในเดือนไทย · ไม่กรองเฉพาะเครดิต', async () => {
    const { client, findMany } = mockClient({});

    await computePp30OutputVat(client, { companyId: 'fin-co', year: 2026, month: 10 });

    expect(findMany).toHaveBeenCalledTimes(2);
    const expectedArgs = (accountCode: string) => ({
      where: {
        accountCode,
        deletedAt: null,
        journalEntry: {
          deletedAt: null,
          status: 'POSTED',
          companyId: 'fin-co',
          entryDate: {
            gte: new Date('2026-09-30T17:00:00.000Z'),
            lt: new Date('2026-10-31T17:00:00.000Z'),
          },
        },
      },
      select: {
        accountCode: true,
        debit: true,
        credit: true,
        journalEntry: {
          select: {
            id: true,
            entryNumber: true,
            entryDate: true,
            referenceType: true,
            description: true,
            metadata: true,
            lines: {
              where: { accountCode: '21-3201', deletedAt: null },
              select: { id: true },
              take: 1,
            },
          },
        },
      },
      orderBy: [
        { journalEntry: { entryDate: 'asc' } },
        { journalEntry: { entryNumber: 'asc' } },
        { id: 'asc' },
      ],
    });
    expect(findMany).toHaveBeenCalledWith(expectedArgs('21-2101'));
    expect(findMany).toHaveBeenCalledWith(expectedArgs('21-2103'));
  });

  it('รวมผลของสอง query แล้วสรุปยอด พร้อมคืนบรรทัดและช่วงเดือน', async () => {
    const credit2a = line('21-2101', '0', '99.17', { metadata: META_2A });
    const vat60 = line('21-2103', '0', '99.17', { metadata: META_VAT60 });
    const { client } = mockClient({ '21-2101': [credit2a], '21-2103': [vat60] });

    const r = await computePp30OutputVat(client, { companyId: 'fin-co', year: 2026, month: 10 });

    expect(r.totalOutputVat.toFixed(2)).toBe('99.17'); // 21-2103 ไม่รวม
    expect(r.mandatory60Day.net.toFixed(2)).toBe('99.17');
    expect(r.lines).toEqual([credit2a, vat60]);
    expect(r).toMatchObject({ companyId: 'fin-co', year: 2026, month: 10 });
    expect(r.range.gte).toEqual(new Date('2026-09-30T17:00:00.000Z'));
  });

  it('ปี/เดือนผิดรูป → 400 และไม่ยิง query', async () => {
    const { client, findMany } = mockClient({});

    await expect(
      computePp30OutputVat(client, { companyId: 'fin-co', year: 2026, month: 13 }),
    ).rejects.toThrow('ปี/เดือนไม่ถูกต้อง');
    expect(findMany).not.toHaveBeenCalled();
  });

  it.each<[string, string | undefined]>([
    ['สตริงว่าง', ''],
    ['ไม่ส่งมา (GET /tax/pp30-preview ที่ไม่มี companyId)', undefined],
  ])(
    'บริษัท%s → 400 "กรุณาระบุบริษัท" และไม่ยิง query (เดิม: ไม่กรองบริษัท = รวมทุกบริษัท)',
    async (_label, companyId) => {
      const { client, findMany } = mockClient({});

      await expect(
        computePp30OutputVat(client, { companyId: companyId as string, year: 2026, month: 10 }),
      ).rejects.toThrow('กรุณาระบุบริษัท');
      expect(findMany).not.toHaveBeenCalled();
    },
  );
});

describe('resolvePp30CompanyId', () => {
  function clientWith(finance: { id: string } | null) {
    const findFirst = jest.fn().mockResolvedValue(finance);
    return {
      client: {
        journalLine: { findMany: jest.fn() },
        companyInfo: { findFirst },
      } as unknown as Pp30Client,
      findFirst,
    };
  }

  it('ผู้เรียกส่งบริษัทมา → ใช้ตามนั้น ไม่ค้นฐานข้อมูล', async () => {
    const { client, findFirst } = clientWith({ id: 'fin-co' });

    await expect(resolvePp30CompanyId(client, 'shop-co')).resolves.toBe('shop-co');
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('ไม่ส่ง → บริษัท FINANCE ที่ยังไม่ถูกลบ', async () => {
    const { client, findFirst } = clientWith({ id: 'fin-co' });

    await expect(resolvePp30CompanyId(client)).resolves.toBe('fin-co');
    expect(findFirst).toHaveBeenCalledWith({
      where: { companyCode: 'FINANCE', deletedAt: null },
      select: { id: true },
    });
  });

  it('ไม่มีบริษัท FINANCE → 400 ข้อความไทย', async () => {
    const { client } = clientWith(null);

    await expect(resolvePp30CompanyId(client)).rejects.toThrow(
      'ไม่พบข้อมูลบริษัทฝั่ง FINANCE (บริษัทที่จดภาษีมูลค่าเพิ่ม) — กรุณาติดต่อผู้ดูแลระบบ',
    );
  });
});
