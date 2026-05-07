import { FlexMessagePayload, wrapFlexMessage, formatBaht } from './base-template';
import {
  buildPremiumBubble,
  createRow,
  createRowsBlock,
  createProgressBar,
  createButton,
} from './style-d';

export interface ContractCompletedFlexData {
  customerName: string;
  contractNumber: string;
  productName: string;
  totalPaid: number;
  totalInstallments: number;
  startDate: string;
  endDate: string;
  loyaltyPointsEarned: number;
  shopUrl?: string;
  liffHistoryUrl?: string;
}

/**
 * "ปิดสัญญาครบ" — Celebration message sent when a customer fully pays off
 * a contract. Style D Premium Thai — brand strip + brand status bar +
 * completion section + total paid + loyalty points + browse-new CTA.
 */
export function buildContractCompletedFlex(data: ContractCompletedFlexData): FlexMessagePayload {
  const primaryAction = data.shopUrl
    ? ({ type: 'uri' as const, label: 'ดูเครื่องใหม่ ผ่อน 0%', uri: data.shopUrl })
    : ({ type: 'postback' as const, label: 'ดูเครื่องใหม่', data: 'action=browse_shop' });

  const secondaryAction = data.liffHistoryUrl
    ? ({ type: 'uri' as const, label: 'ดูประวัติสัญญา', uri: data.liffHistoryUrl })
    : ({ type: 'postback' as const, label: 'ดูประวัติสัญญา', data: 'action=view_completed' });

  const bubble = buildPremiumBubble({
    role: 'brand',
    tag: 'Completed',
    section: {
      label: 'ผ่อนครบทุกงวด · ขอบคุณที่ใช้บริการ',
      headline: data.contractNumber,
      subtle: data.productName,
      pill: { text: `✓ ผ่อนครบ ${data.totalInstallments} / ${data.totalInstallments} งวด`, role: 'success' },
    },
    body: [
      createProgressBar(data.totalInstallments, data.totalInstallments, 'brand'),
      createRowsBlock([
        createRow('ลูกค้า', data.customerName),
        createRow('รวมที่ชำระทั้งหมด', formatBaht(data.totalPaid), { valueColor: '#047857' }),
        createRow('ระยะเวลาผ่อน', `${data.startDate} – ${data.endDate}`),
        createRow('แต้มสะสมที่ได้รับ', `${data.loyaltyPointsEarned.toLocaleString()} แต้ม`, { valueColor: '#c2410c' }),
      ]),
    ],
    buttons: [
      createButton(primaryAction.label, primaryAction, 'primary'),
      createButton(secondaryAction.label, secondaryAction, 'outline'),
    ],
  });

  return wrapFlexMessage(
    `ยินดีด้วย! สัญญา ${data.contractNumber} ชำระครบแล้ว รับ ${data.loyaltyPointsEarned.toLocaleString()} แต้ม`,
    bubble,
  );
}
