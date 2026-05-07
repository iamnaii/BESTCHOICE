import { FlexMessagePayload, wrapFlexMessage, formatBaht } from './base-template';
import {
  buildPremiumBubble,
  createHeroAmount,
  createRow,
  createRowsBlock,
  createQRSection,
  createFooter,
} from './style-d';

export interface PartialPaymentQRFlexData {
  customerName: string;
  contractNumber: string;
  installmentNo: number;
  totalInstallments: number;
  /** Full installment amount (what's expected). */
  fullAmount: number;
  /** Partial amount the customer is being asked to pay now. */
  partialAmount: number;
  /** PaySolutions hosted-page URL — embedded in QR. */
  paymentUrl: string;
  /** Numeric reference shown in the footer + used for webhook lookup. */
  orderRef: string;
}

/**
 * "ใบแจ้งชำระบางส่วน" — pushed to customer's LINE OA when cashier
 * triggers `POST /payments/:id/partial-qr`. Style D Premium Thai —
 * info role (blue), shows full installment amount struck through if
 * partial < full, with a pill calling out the remaining balance after
 * this payment lands.
 */
export function buildPartialPaymentQRFlex(data: PartialPaymentQRFlexData): FlexMessagePayload {
  const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=400x400&margin=10&data=${encodeURIComponent(data.paymentUrl)}`;

  const remainingAfterPay = Math.max(0, data.fullAmount - data.partialAmount);
  const isFullPayment = data.partialAmount >= data.fullAmount;

  const rows = [
    createRow('สัญญา', data.contractNumber),
    createRow('งวดที่', `${data.installmentNo} / ${data.totalInstallments}`),
  ];
  if (!isFullPayment) {
    rows.push(
      createRow('ค่างวดเต็ม', formatBaht(data.fullAmount), {
        valueColor: '#94a3b8',
      }),
      createRow('ค้างหลังจ่าย', formatBaht(remainingAfterPay), {
        valueColor: '#b45309',
      }),
    );
  }

  const bubble = buildPremiumBubble({
    role: 'info',
    tag: 'Partial Payment',
    section: {
      label: isFullPayment
        ? `ชำระค่างวด · งวดที่ ${data.installmentNo} / ${data.totalInstallments}`
        : `ชำระบางส่วน · งวดที่ ${data.installmentNo} / ${data.totalInstallments}`,
      headline: 'ใบแจ้งชำระ',
      subtle: `คุณ${data.customerName}`,
    },
    body: [
      createHeroAmount('info', formatBaht(data.partialAmount), {
        cap: 'ยอดที่ต้องชำระ',
        ...(isFullPayment
          ? {}
          : {
              pill: {
                text: `ค่างวดเต็ม ${formatBaht(data.fullAmount)} · ค้างหลังจ่าย ${formatBaht(remainingAfterPay)}`,
                role: 'info',
              },
            }),
      }),
      createRowsBlock(rows),
      createQRSection(qrImageUrl, 'สแกนด้วยแอปธนาคาร · บันทึกหน้าจอเก็บไว้ได้'),
      createFooter('หมดอายุ 24 ชั่วโมง', `REF ${data.orderRef}`),
    ],
  });

  return wrapFlexMessage(
    `ใบแจ้งชำระ ${data.contractNumber} งวด ${data.installmentNo} ยอด ${formatBaht(data.partialAmount)}`,
    bubble,
  );
}
