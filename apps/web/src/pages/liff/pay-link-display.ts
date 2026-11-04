import type { LiffPayAllocationLine, LiffPayAmountKind } from '@installment/shared';

/**
 * Task 42 (คำตัดสินเจ้าของ #44) — ถ้อยคำของหน้า `/pay/:token` ตามข้อมูลที่ server ส่ง (`GET /line-oa/pay/:token`) — หน้าเว็บไม่เดาจากยอด
 */

/** หัวยอด (ป้ายเล็กเหนือยอด) — "ยอดปิดสัญญา" เฉพาะลิงก์ PAYOFF */
const PAY_AMOUNT_LABEL: Record<LiffPayAmountKind, string> = {
  DUE: 'ยอดที่ต้องชำระ',
  PAYOFF: 'ยอดปิดสัญญา',
  OUTSTANDING: 'ยอดค้างชำระ',
  PROMISE: 'ยอดนัดชำระ',
};

/** ค่าที่ไม่รู้จัก (API เวอร์ชันก่อนหน้า) = "ยอดที่ต้องชำระ" */
export function payAmountLabel(kind: LiffPayAmountKind | undefined): string {
  return (kind && PAY_AMOUNT_LABEL[kind]) || PAY_AMOUNT_LABEL.DUE;
}

/** ป้ายของแถว "นำไปชำระ (งวดเก่าก่อน)" */
export function payAllocationLineLabel(line: LiffPayAllocationLine): string {
  switch (line.kind) {
    case 'INSTALLMENT':
      return `งวดที่ ${line.installmentNo} · ค่างวด`;
    case 'INSTALLMENT_REMAINING':
      return `งวดที่ ${line.installmentNo} · ค่างวดคงเหลือ`;
    case 'LATE_FEE':
      return `งวดที่ ${line.installmentNo} · ค่าปรับล่าช้า`;
    case 'PARTIAL':
      return `งวดที่ ${line.installmentNo} · ชำระบางส่วน`;
    case 'LEFT_AFTER':
      return `งวดที่ ${line.installmentNo} ยังค้างหลังชำระ`;
    case 'SURPLUS':
      // webhook พักเงินที่เกินทุกงวดค้างเป็นเงินรับล่วงหน้า (หักงวดถัดไป)
      return 'ส่วนเกิน · เก็บเป็นเงินรับล่วงหน้า';
  }
}
