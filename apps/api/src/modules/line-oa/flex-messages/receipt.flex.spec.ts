import { buildReceiptMessage } from './receipt.flex';

/**
 * ข้อความใบเสร็จทาง LINE (PR3 — คำตอบเจ้าของ ถ4 2026-09-30): ใบของเงินที่เข้าทางลิงก์ชำระและการใช้เครดิตชำระ
 * ส่งข้อความนี้แบบเดียวกับหน้ารับชำระ ⇒ แถว "วิธีชำระ" ต้องเป็นข้อความเดียวกับใบเสร็จ PDF ไม่ใช่รหัสดิบ
 */
describe('buildReceiptMessage — ป้ายวิธีชำระ', () => {
  const base = {
    receiptNumber: 'RT-202610-00001',
    receiptType: 'INSTALLMENT',
    payerName: 'ลูกค้าทดสอบ',
    amount: 1515.83,
    installmentNo: 1,
    paidDate: '2026-10-02T03:00:00.000Z',
    verifyUrl: 'https://example.invalid/verify/RT-202610-00001',
  };

  it.each([
    ['ONLINE_GATEWAY', 'ชำระออนไลน์'],
    ['CREDIT_BALANCE', 'ใช้ยอดเครดิตในสัญญา'],
    ['CARD', 'บัตร (EDC)'],
    ['CASH', 'เงินสด'],
  ])('ช่องทาง %s → แถววิธีชำระ "%s" (ไม่ใช่รหัสดิบ)', (paymentMethod, label) => {
    const json = JSON.stringify(buildReceiptMessage({ ...base, paymentMethod }));

    expect(json).toContain(`"${label}"`);
    expect(json).not.toContain(`"${paymentMethod}"`);
  });
});

/** PR4ข: ใบปรับดิว 6a และใบรับเงินส่วนเกินลิงก์ชำระได้หัวข้อความของตัวเอง (ไม่ใช่ "ใบเสร็จ" ลอย ๆ) */
describe('buildReceiptMessage — หัวข้อความตามประเภทใบ (PR4ข)', () => {
  const base = {
    receiptNumber: 'RT-202610-00050',
    payerName: 'ลูกค้าทดสอบ',
    amount: 500,
    paidDate: '2026-10-16T03:00:00.000Z',
    verifyUrl: 'https://example.invalid/verify/RT-202610-00050',
    paymentMethod: 'ONLINE_GATEWAY',
  };

  it.each([
    ['RESCHEDULE_FEE', 'ใบเสร็จค่าธรรมเนียมปรับดิว'],
    ['ADVANCE_SURPLUS', 'ใบเสร็จเงินรับล่วงหน้า'],
  ])('ประเภท %s → หัวข้อความ "%s"', (receiptType, headline) => {
    const json = JSON.stringify(buildReceiptMessage({ ...base, receiptType }));

    expect(json).toContain(`"${headline}"`);
  });
});
