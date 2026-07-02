import { FlexMessagePayload, wrapFlexMessage, formatBaht } from './base-template';
import {
  buildPremiumBubble,
  createHeroAmount,
  createRow,
  createRowsBlock,
  createQRSection,
  createFooter,
} from './style-d';

export interface RescheduleQRFlexData {
  customerName: string;
  contractNumber: string;
  installmentNo: number;
  daysToShift: number;
  /** วันครบกำหนดใหม่ (หลังเลื่อน) — pre-formatted Thai date string. */
  newDueDateText: string;
  /** ค่าธรรมเนียมเลื่อนดิว (0 เมื่อ 6b — รวมกับงวดถัดไป). */
  rescheduleFee: number;
  /** ค่าปรับค้างของช่วงที่เกินกำหนดมาแล้ว (0 ถ้าไม่มี). */
  lateFee: number;
  /** ยอดรวมที่ต้องชำระผ่าน QR นี้. */
  collectAmount: number;
  paymentUrl: string;
  orderRef: string;
}

/**
 * "ใบแจ้งชำระปรับดิว" — pushed to the customer's LINE OA when the cashier
 * triggers `POST /payments/:id/reschedule-qr`. Style D Premium Thai — warning
 * role (amber): the due date shifts ONLY after this QR is paid
 * (เงินไม่เข้า ดิวไม่เลื่อน — owner directive 2026-07-02).
 */
export function buildRescheduleQRFlex(data: RescheduleQRFlexData): FlexMessagePayload {
  const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=400x400&margin=10&data=${encodeURIComponent(data.paymentUrl)}`;

  const rows = [
    createRow('สัญญา', data.contractNumber),
    createRow('เลื่อนงวดที่', `${data.installmentNo} (+${data.daysToShift} วัน)`),
    createRow('ครบกำหนดใหม่', data.newDueDateText),
  ];
  if (data.rescheduleFee > 0) {
    rows.push(createRow('ค่าธรรมเนียมปรับดิว', formatBaht(data.rescheduleFee)));
  }
  if (data.lateFee > 0) {
    rows.push(createRow('ค่าปรับล่าช้า', formatBaht(data.lateFee), { valueColor: '#b45309' }));
  }

  const bubble = buildPremiumBubble({
    role: 'warn',
    tag: 'Reschedule',
    section: {
      label: `ปรับดิว · งวดที่ ${data.installmentNo}`,
      headline: 'ใบแจ้งชำระปรับดิว',
      subtle: `คุณ${data.customerName}`,
    },
    body: [
      createHeroAmount('warn', formatBaht(data.collectAmount), {
        cap: 'ยอดที่ต้องชำระ',
        pill: {
          text: `ชำระแล้วดิวเลื่อนเป็น ${data.newDueDateText}`,
          role: 'warn',
        },
      }),
      createRowsBlock(rows),
      createQRSection(qrImageUrl, 'สแกนด้วยแอปธนาคาร · วันครบกำหนดจะเลื่อนเมื่อชำระสำเร็จ'),
      createFooter('หมดอายุ 24 ชั่วโมง', `REF ${data.orderRef}`),
    ],
  });

  return wrapFlexMessage(
    `ใบแจ้งชำระปรับดิว ${data.contractNumber} งวด ${data.installmentNo} ยอด ${formatBaht(data.collectAmount)}`,
    bubble,
  );
}
