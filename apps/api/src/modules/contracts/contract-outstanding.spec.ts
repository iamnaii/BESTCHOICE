import { Prisma } from '@prisma/client';
import { nextDueOf, outstandingOf, UNPAID_INSTALLMENT_WHERE } from './contract-outstanding';

const dec = (v: string) => new Prisma.Decimal(v);

describe('UNPAID_INSTALLMENT_WHERE', () => {
  it('กรองทั้ง soft-delete และงวดที่ปิดแล้ว — ขาดข้อใดข้อหนึ่งคงค้างเพี้ยนทันที', () => {
    expect(UNPAID_INSTALLMENT_WHERE).toEqual({ deletedAt: null, status: { not: 'PAID' } });
  });
});

describe('outstandingOf', () => {
  it('บวก (amountDue − amountPaid) ของทุกแถวที่ส่งเข้ามา', () => {
    expect(outstandingOf([
      { amountDue: dec('3200.00'), amountPaid: dec('0') },
      { amountDue: dec('3200.00'), amountPaid: dec('1200.50') },
    ])).toBe(5199.5);
  });

  it('clamp ที่ 0 เมื่อจ่ายเกิน (overpayment) ไม่คืนค่าติดลบ', () => {
    expect(outstandingOf([{ amountDue: dec('1000'), amountPaid: dec('1500') }])).toBe(0);
  });

  it('clamp ระดับผลรวม — แถวที่จ่ายเกินหักกับแถวที่ยังค้างได้ แต่ไม่ทะลุ 0', () => {
    expect(outstandingOf([
      { amountDue: dec('1000'), amountPaid: dec('1500') },
      { amountDue: dec('1000'), amountPaid: dec('0') },
    ])).toBe(500);
    expect(outstandingOf([
      { amountDue: dec('1000'), amountPaid: dec('5000') },
      { amountDue: dec('1000'), amountPaid: dec('0') },
    ])).toBe(0);
  });

  it('งวด PAID ที่จ่ายขาด = ส่วนลดปิดยอด ต้องไม่ถูกนับเป็นหนี้ (ผู้เรียกกรองด้วย UNPAID_INSTALLMENT_WHERE)', () => {
    // สัญญา 3 งวด: สองงวดแรกปิดแล้ว งวดที่ 2 ปิดด้วยส่วนลด 200 บาท
    const allRows = [
      { status: 'PAID', amountDue: dec('1000'), amountPaid: dec('1000') },
      { status: 'PAID', amountDue: dec('1000'), amountPaid: dec('800') },   // ส่วนลด 200
      { status: 'PENDING', amountDue: dec('1000'), amountPaid: dec('0') },
    ];
    // สูตรเก่า (บวกทุกแถว) รายงานส่วนลดเป็นคงค้าง = 1200
    expect(outstandingOf(allRows)).toBe(1200);
    // สูตรจริง: กรอง status != 'PAID' ก่อน ⇒ 1000
    const unpaid = allRows.filter(row => row.status !== 'PAID');
    expect(outstandingOf(unpaid)).toBe(1000);
  });

  it('ไม่ใช้ float — .1 + .2 ต้องได้ 0.3 ไม่ใช่ 0.30000000000000004', () => {
    expect(outstandingOf([
      { amountDue: '0.10', amountPaid: 0 },
      { amountDue: '0.20', amountPaid: 0 },
    ])).toBe(0.3);
  });

  it('รับ null/undefined จาก _sum ของ groupBy ที่ไม่มีแถวเลย', () => {
    expect(outstandingOf([{ amountDue: null, amountPaid: undefined }])).toBe(0);
  });

  it('ไม่มีแถว = ไม่มีหนี้ = 0', () => {
    expect(outstandingOf([])).toBe(0);
  });
});

describe('nextDueOf', () => {
  const rows = [
    { dueDate: new Date('2026-11-05T00:00:00Z'), amountDue: dec('3200'), amountPaid: dec('0'), installmentNo: 3 },
    // งวดที่ครบกำหนดเร็วที่สุด แต่ยอด **ไม่ใช่** ยอดที่น้อยที่สุด
    { dueDate: new Date('2026-09-25T00:00:00Z'), amountDue: dec('9600'), amountPaid: dec('0'), installmentNo: 1 },
    { dueDate: new Date('2026-10-05T00:00:00Z'), amountDue: dec('120.25'), amountPaid: dec('0'), installmentNo: 2 },
  ];

  it('คืนยอดของ "แถวที่ครบกำหนดเร็วที่สุด" ไม่ใช่ MIN(amountDue)', () => {
    const next = nextDueOf(rows);
    expect(next).toEqual({ dueDate: new Date('2026-09-25T00:00:00Z'), amountDue: 9600 });
    // กับดัก: MIN(amount_due) ของชุดนี้คือ 120.25 — ถ้าได้เลขนี้คือกลับไปเป็นบั๊กเดิม
    expect(next!.amountDue).not.toBe(120.25);
  });

  it('dueDate ชนกัน → งวดเลขน้อยกว่าเป็นงวดถัดไป (ผลลัพธ์เสถียร ไม่แกว่งตามลำดับแถว)', () => {
    const same = new Date('2026-09-25T00:00:00Z');
    const a = { dueDate: same, amountDue: dec('500'), amountPaid: dec('0'), installmentNo: 7 };
    const b = { dueDate: same, amountDue: dec('800'), amountPaid: dec('0'), installmentNo: 4 };
    expect(nextDueOf([a, b])!.amountDue).toBe(800);
    expect(nextDueOf([b, a])!.amountDue).toBe(800);
  });

  it('ไม่มีแถวที่ยังไม่ปิด = ไม่มีงวดถัดไป = null', () => {
    expect(nextDueOf([])).toBeNull();
  });
});
