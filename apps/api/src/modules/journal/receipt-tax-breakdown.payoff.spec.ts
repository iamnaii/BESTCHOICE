import { Decimal } from '@prisma/client/runtime/library';
import {
  earlyPayoffReceiptTax,
  parseReceiptTax,
  receiptTaxColumns,
  RECEIPT_TAX_VERSION,
} from './receipt-tax-breakdown';

/**
 * ใบปิดยอดก่อนกำหนดเป็นใบกำกับภาษีตามบัญชี (ฝ่ายบัญชี 16/10/2569 ข้อ 16.1/16.2 "ok" · mockup เจ้าของเคาะ 18/10/2569
 * `7WWhgoL9ovNxPHji7m6tGf`): มูลค่า/ภาษีจากรายการ JP4 + ภาษีคงเหลือของงวดตามกติกา PR3 · ส่วนลดดอกเบี้ยปิดยอด (52-1106)
 * เป็นแถวแยกไม่ลดฐานภาษี · เงินพักค่าปรับดิว/เงินรับล่วงหน้าที่หักเป็นแถวติดลบพร้อมภาษีที่ออกใบกำกับไปแล้ว (ข้อ 13–14).
 * Invariant ใหม่: amountBeforeVat + vatAmount + roundingAmount + lateFeeAmount − discountAmount = amount
 */
const D = (v: string | number) => new Decimal(v);
const ZERO = D(0);

const base = {
  amount: D('15189.98'),
  receivableCleared: D('18190.00'),
  installmentVat: D('1190.00'),
  lateFees: ZERO,
  discount: D('3000.02'),
  parkRelief: ZERO,
  advanceRelief: ZERO,
  creditRelief: ZERO,
  advanceVatReversal: ZERO,
  roundingGain: ZERO,
  excessIncome: ZERO,
};

describe('earlyPayoffReceiptTax — ค่าที่ใบปิดยอดพิมพ์ (ตามรายการบัญชี)', () => {
  it('16.1 ยังไม่จ่ายเลย 12 งวด: ฐาน 17,000.00 · ภาษี 1,190.00 · ส่วนลด 3,000.02 · เงินที่รับ 15,189.98', () => {
    expect(earlyPayoffReceiptTax(base)).toEqual({
      version: RECEIPT_TAX_VERSION,
      amount: '15189.98',
      amountBeforeVat: '17000.00',
      vatAmount: '1190.00',
      roundingAmount: '0.00',
      lateFeeAmount: '0.00',
      lateFeeWaivedAmount: '0.00',
      advanceAmount: '0.00',
      advanceVatAmount: '0.00',
      discountAmount: '3000.02',
    });
  });

  it('16.2 มีเงินพักค่าปรับดิว 1,044 (ภาษี 68.30 ออกใบกำกับไปแล้ว): แถวหัก −1,044.00/−68.30 · ภาษีใบ 1,121.70 · ฐาน 16,024.30', () => {
    const tax = earlyPayoffReceiptTax({
      ...base,
      amount: D('14318.16'),
      discount: D('2827.84'),
      parkRelief: D('1044.00'),
      advanceVatReversal: D('68.30'),
    });
    expect(tax).toMatchObject({
      amount: '14318.16',
      amountBeforeVat: '16024.30',
      vatAmount: '1121.70',
      advanceAmount: '-1044.00',
      advanceVatAmount: '-68.30',
      discountAmount: '2827.84',
    });
  });

  it('กระดาน 3 (18.1 ค้าง 4 จาก 8 งวด): ลูกหนี้ 12,126.68 · ภาษี 793.32 · ส่วนลด 1,000.03 → ฐาน 11,333.36 · รับ 11,126.65', () => {
    const tax = earlyPayoffReceiptTax({
      ...base,
      amount: D('11126.65'),
      receivableCleared: D('12126.68'),
      installmentVat: D('793.32'),
      discount: D('1000.03'),
    });
    expect(tax).toMatchObject({ amountBeforeVat: '11333.36', vatAmount: '793.32', discountAmount: '1000.03' });
  });

  it('ค่าปรับ + ปัดเศษเก็บเกิน + เงินรับล่วงหน้าถังรวม + เครดิต (ไม่มีภาษี): ทุกแถวเข้าช่องของตัวเอง', () => {
    // รับ = 18,190 − 3,000.02 + ค่าปรับ 100 + ปัดเศษ 0.33 − ถังรวม 500 − เครดิต 200 = 14,590.31
    const tax = earlyPayoffReceiptTax({
      ...base,
      amount: D('14590.31'),
      lateFees: D('100'),
      roundingGain: D('0.33'),
      advanceRelief: D('500'),
      creditRelief: D('200'),
      advanceVatReversal: D('32.71'), // ขากลับภาษีของถังรวม 500 (HALF_UP 500×7/107)
    });
    expect(tax).toMatchObject({
      lateFeeAmount: '100.00',
      roundingAmount: '0.33',
      advanceAmount: '-700.00',
      advanceVatAmount: '-32.71',
      vatAmount: '1157.29',
      amountBeforeVat: '16332.71', // 17,000 + (−700 + 32.71)
      discountAmount: '3000.02',
    });
  });

  it('มีเงินรับเกินยอดปิด (18.2 excessIncome > 0) → null (ใบพิมพ์แบบเดิม)', () => {
    expect(earlyPayoffReceiptTax({ ...base, excessIncome: D('5.00') })).toBeNull();
  });

  it('ยอดไม่ลงตัว (identity ≠ เงินที่รับ) หรือค่าติดลบ → null', () => {
    expect(earlyPayoffReceiptTax({ ...base, amount: D('15189.00') })).toBeNull();
    expect(earlyPayoffReceiptTax({ ...base, discount: D('-1') })).toBeNull();
    expect(earlyPayoffReceiptTax({ ...base, receivableCleared: D('18190.01') })).toBeNull(); // ลูกหนี้ไม่ลงตัวกับเงินที่รับ
  });
});

describe('parseReceiptTax / receiptTaxColumns — ช่อง discountAmount (optional)', () => {
  const v1 = {
    version: 1,
    amount: '6079.00',
    amountBeforeVat: '5681.00',
    vatAmount: '397.67',
    roundingAmount: '0.33',
    lateFeeAmount: '0.00',
    lateFeeWaivedAmount: '0.00',
    advanceAmount: '0.00',
    advanceVatAmount: '0.00',
  };

  it('stamp เดิมไม่มี discountAmount → ผ่านเหมือนเดิม · คอลัมน์ discountAmount = 0', () => {
    const parsed = parseReceiptTax(v1);
    expect(parsed).not.toBeNull();
    expect(parsed!.discountAmount).toBeUndefined();
    expect(receiptTaxColumns(parsed!).discountAmount.toFixed(2)).toBe('0.00');
  });

  it('มี discountAmount → invariant ลบส่วนลด · คอลัมน์ได้ค่านั้น', () => {
    const stamp = { ...v1, amount: '15189.98', amountBeforeVat: '17000.00', vatAmount: '1190.00', roundingAmount: '0.00', discountAmount: '3000.02' };
    const parsed = parseReceiptTax(stamp);
    expect(parsed?.discountAmount).toBe('3000.02');
    expect(receiptTaxColumns(parsed!).discountAmount.toFixed(2)).toBe('3000.02');
    // ส่วนลดผิด → invariant ไม่ลงตัว
    expect(parseReceiptTax({ ...stamp, discountAmount: '3000.00' })).toBeNull();
    // รูปไม่ใช่เงิน 2 ตำแหน่ง
    expect(parseReceiptTax({ ...stamp, discountAmount: '3000' })).toBeNull();
  });
});

describe('earlyPayoffReceiptTax — ผลลัพธ์ติดลบ = ไม่ใช่ใบกำกับภาษีตามบัญชี (ผู้ตรวจอิสระ I1)', () => {
  it('ภาษีของแถวหักเกินภาษีของงวด (เงินพักหักงวดสุดท้ายพอดี: 99.13 − 99.17 = −0.04) → null', () => {
    // งวด 12 ภาษี 99.13 · เงินพัก 1,515.87 ภาษีขากลับ HALF_UP(1,515.87 × 7/107) = 99.17 → vatAmount −0.04
    expect(
      earlyPayoffReceiptTax({
        ...base,
        amount: ZERO,
        receivableCleared: D('1515.87'),
        installmentVat: D('99.13'),
        discount: ZERO,
        parkRelief: D('1515.87'),
        advanceVatReversal: D('99.17'),
      }),
    ).toBeNull();
  });

  it('ฐานก่อนภาษีติดลบ (ลูกหนี้ตามบัญชีเล็กกว่าเงินของลูกค้าที่หัก) → null', () => {
    // ลูกหนี้ 1,000 · ภาษี 65.42 · หักถังรวม 1,500 (ภาษีขากลับ 98.13) · เงินรับ 0 · ส่วนลด 0 → เกินหนี้ 500 → ตามรายการจะเป็น excess
    // แต่ถ้า excess ถูกส่งมาเป็น 0 (ข้อมูลผิดปกติ) ต้องไม่ได้ใบที่ฐานติดลบ
    expect(
      earlyPayoffReceiptTax({
        ...base,
        amount: ZERO,
        receivableCleared: D('1000.00'),
        installmentVat: D('65.42'),
        discount: ZERO,
        advanceRelief: D('1500.00'),
        advanceVatReversal: D('98.13'),
        roundingGain: D('500.00'),
      }),
    ).toBeNull();
  });
});
