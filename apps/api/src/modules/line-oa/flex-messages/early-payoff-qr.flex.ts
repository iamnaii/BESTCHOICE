import { FlexMessagePayload, wrapFlexMessage, formatBaht } from './base-template';
import {
  buildPremiumBubble,
  createHeroAmount,
  createRow,
  createRowsBlock,
  createQRSection,
  createFooter,
} from './style-d';

export interface EarlyPayoffQRFlexData {
  customerName: string;
  contractNumber: string;
  /** Final amount the customer pays (post-discount). */
  totalPayoff: number;
  /** Original total before discount (for context). */
  originalAmount: number;
  /** Amount the customer saves (orig - totalPayoff). */
  savings: number;
  /** Discount percentage applied. */
  discountPct: number;
  /** PaySolutions hosted-page URL — embedded in QR. */
  paymentUrl: string;
  /** Order reference number (12 digits). */
  orderRef: string;
  /** Number of installments still outstanding. */
  remainingMonths: number;
  /** งวดที่ถึงกำหนดแล้ว — ชำระเต็มจำนวน ไม่ได้ส่วนลด (ฝ่ายบัญชี 16/10/2569 ข้อ 18.1) · ไม่ส่ง = ไม่แสดงแถว */
  dueMonths?: number;
}

/**
 * "ใบแจ้งปิดสัญญาก่อนกำหนด" — pushed to customer's LINE OA when cashier
 * triggers `POST /contracts/:id/early-payoff/qr`. Style D Premium Thai —
 * brand strip + payoff status bar + hero amount + savings badge + QR + footer.
 */
export function buildEarlyPayoffQRFlex(data: EarlyPayoffQRFlexData): FlexMessagePayload {
  const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=400x400&margin=10&data=${encodeURIComponent(data.paymentUrl)}`;

  // ส่วนลดจริงอาจเป็น 0 — ทุกงวดถึงกำหนดแล้ว (ฝ่ายบัญชี 18.1 แบบ ค) หรือส่วนลด 0% —
  // ห้ามอ้าง "ส่วนลด X%" / "ประหยัด" / ยอดเต็มเดิมขีดฆ่า เมื่อลูกค้าไม่ได้ส่วนลดจริง
  const hasSavings = data.savings > 0;
  const discountSuffix = hasSavings ? ` · ส่วนลด ${data.discountPct}%` : '';
  const dueMonths = Math.max(0, Math.floor(data.dueMonths ?? 0));
  const rows: ReturnType<typeof createRow>[] = [
    createRow('สัญญา', data.contractNumber),
    createRow('งวดคงเหลือ', `${data.remainingMonths} งวด`),
  ];
  if (dueMonths > 0) {
    rows.push(createRow('งวดที่ถึงกำหนดแล้ว (ไม่ได้ส่วนลด)', `${dueMonths} งวด`));
  }
  if (hasSavings) {
    rows.push(
      createRow('ยอดเต็มเดิม', formatBaht(data.originalAmount), {
        valueColor: '#94a3b8',
        valueDecoration: 'line-through',
      }),
    );
  }

  const bubble = buildPremiumBubble({
    role: 'payoff',
    tag: 'Early Payoff',
    section: {
      label: `ปิดสัญญาก่อนกำหนด${discountSuffix}`,
      headline: 'ใบแจ้งชำระ',
      subtle: `คุณ${data.customerName}`,
    },
    body: [
      createHeroAmount('payoff', formatBaht(data.totalPayoff), {
        cap: 'ยอดที่ต้องชำระ',
        savingsBadge: hasSavings ? `ประหยัด ${formatBaht(data.savings)}` : undefined,
      }),
      createRowsBlock(rows),
      createQRSection(qrImageUrl, 'สแกนด้วยแอปธนาคาร · บันทึกหน้าจอเก็บไว้ได้'),
      createFooter('หมดอายุ 30 นาที', `REF ${data.orderRef}`),
    ],
  });

  return wrapFlexMessage(
    `ใบแจ้งปิดสัญญา ${data.contractNumber} · ยอด ${formatBaht(data.totalPayoff)}${hasSavings ? ` (ส่วนลด ${data.discountPct}%)` : ''}`,
    bubble,
  );
}
