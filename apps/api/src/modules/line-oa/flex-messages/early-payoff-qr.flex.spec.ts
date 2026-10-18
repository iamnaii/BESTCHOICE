import { buildEarlyPayoffQRFlex } from './early-payoff-qr.flex';

describe('buildEarlyPayoffQRFlex — ข้อความส่วนลดต้องตามยอดจริง (ฝ่ายบัญชี 16/10/2569 ข้อ 18.1)', () => {
  const base = {
    customerName: 'บีม',
    contractNumber: 'CT-2026-0001',
    totalPayoff: 36991.97,
    originalAmount: 44152,
    savings: 7160.03,
    discountPct: 50,
    paymentUrl: 'https://pay.example/x',
    orderRef: '123456789012',
    remainingMonths: 12,
  };

  it('มีส่วนลดจริง → หัวข้อ + alt text บอก % · ป้ายประหยัด · แถวยอดเต็มเดิม', () => {
    const json = JSON.stringify(buildEarlyPayoffQRFlex(base));
    expect(json).toContain('ปิดสัญญาก่อนกำหนด · ส่วนลด 50%');
    expect(json).toContain('ประหยัด ฿7,160.03');
    expect(json).toContain('ยอดเต็มเดิม');
    expect(json).toContain('(ส่วนลด 50%)');
  });

  it('ส่วนลด 0 (ทุกงวดถึงกำหนดแล้ว) → ไม่อ้าง % · ไม่มีป้ายประหยัด · ไม่มีแถวยอดเต็มเดิมขีดฆ่า', () => {
    const json = JSON.stringify(buildEarlyPayoffQRFlex({ ...base, totalPayoff: 44152, savings: 0 }));
    expect(json).not.toContain('50%');
    expect(json).not.toContain('ประหยัด');
    expect(json).not.toContain('ยอดเต็มเดิม');
    expect(json).toContain('ปิดสัญญาก่อนกำหนด');
    expect(json).toContain('ยอดที่ต้องชำระ');
  });

  it('มีงวดถึงกำหนดแล้ว → แถวบอกจำนวนงวดที่ชำระเต็มจำนวน (ไม่ได้ส่วนลด)', () => {
    const json = JSON.stringify(buildEarlyPayoffQRFlex({ ...base, dueMonths: 4 }));
    expect(json).toContain('งวดที่ถึงกำหนดแล้ว (ไม่ได้ส่วนลด)');
    expect(json).toContain('4 งวด');
  });

  it('ไม่มีงวดถึงกำหนด / API เก่าไม่ส่ง → ไม่มีแถวนั้น', () => {
    expect(JSON.stringify(buildEarlyPayoffQRFlex(base))).not.toContain('งวดที่ถึงกำหนดแล้ว');
    expect(JSON.stringify(buildEarlyPayoffQRFlex({ ...base, dueMonths: 0 }))).not.toContain('งวดที่ถึงกำหนดแล้ว');
  });
});
