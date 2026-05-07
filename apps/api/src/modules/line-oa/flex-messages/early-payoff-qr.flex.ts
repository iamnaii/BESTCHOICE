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
}

/**
 * "ใบแจ้งปิดสัญญาก่อนกำหนด" — pushed to customer's LINE OA when cashier
 * triggers `POST /contracts/:id/early-payoff/qr`. Style D Premium Thai —
 * brand strip + payoff status bar + hero amount + savings badge + QR + footer.
 */
export function buildEarlyPayoffQRFlex(data: EarlyPayoffQRFlexData): FlexMessagePayload {
  const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=400x400&margin=10&data=${encodeURIComponent(data.paymentUrl)}`;

  const bubble = buildPremiumBubble({
    role: 'payoff',
    tag: 'Early Payoff',
    section: {
      label: `ปิดสัญญาก่อนกำหนด · ส่วนลด ${data.discountPct}%`,
      headline: 'ใบแจ้งชำระ',
      subtle: `คุณ${data.customerName}`,
    },
    body: [
      createHeroAmount('payoff', formatBaht(data.totalPayoff), {
        cap: 'ยอดที่ต้องชำระ',
        savingsBadge: `ประหยัด ${formatBaht(data.savings)}`,
      }),
      createRowsBlock([
        createRow('สัญญา', data.contractNumber),
        createRow('งวดคงเหลือ', `${data.remainingMonths} งวด`),
        createRow('ยอดเต็มเดิม', formatBaht(data.originalAmount), {
          valueColor: '#94a3b8',
          valueDecoration: 'line-through',
        }),
      ]),
      createQRSection(qrImageUrl, 'สแกนด้วยแอปธนาคาร · บันทึกหน้าจอเก็บไว้ได้'),
      createFooter('หมดอายุ 30 นาที', `REF ${data.orderRef}`),
    ],
  });

  return wrapFlexMessage(
    `ใบแจ้งปิดสัญญา ${data.contractNumber} · ยอด ${formatBaht(data.totalPayoff)} (ส่วนลด ${data.discountPct}%)`,
    bubble,
  );
}
