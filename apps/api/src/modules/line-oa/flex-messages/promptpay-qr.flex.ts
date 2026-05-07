import { FlexMessagePayload, wrapFlexMessage, formatBaht } from './base-template';
import {
  buildPremiumBubble,
  createHeroAmount,
  createRow,
  createRowsBlock,
  createQRSection,
  createFooter,
  createButton,
} from './style-d';

export interface PromptPayQrData {
  customerName: string;
  contractNumber: string;
  installmentNo: number;
  totalInstallments: number;
  amount: number;
  qrImageUrl: string;
  accountName: string;
  maskedPromptPayId: string;
  paymentLinkUrl?: string;
}

export function buildPromptPayQrFlex(data: PromptPayQrData): FlexMessagePayload {
  const bubble = buildPremiumBubble({
    role: 'success',
    tag: 'Payment QR',
    section: {
      label: `ชำระค่างวด · งวดที่ ${data.installmentNo} / ${data.totalInstallments}`,
      headline: 'PromptPay QR',
      subtle: `คุณ${data.customerName}`,
    },
    body: [
      createHeroAmount('success', formatBaht(data.amount), {
        cap: 'ยอดชำระ',
      }),
      createQRSection(data.qrImageUrl, 'สแกนด้วยแอปธนาคาร · บันทึกหน้าจอเก็บไว้ได้'),
      createRowsBlock([
        createRow('สัญญา', data.contractNumber),
        createRow('PromptPay', data.maskedPromptPayId),
        createRow('ชื่อบัญชี', data.accountName),
      ]),
      createFooter('หมดอายุ 30 นาที', data.contractNumber),
    ],
    buttons: data.paymentLinkUrl
      ? [createButton('ส่งสลิปชำระเงิน', { type: 'uri', label: 'ส่งสลิปชำระเงิน', uri: data.paymentLinkUrl }, 'success')]
      : undefined,
  });

  return wrapFlexMessage(
    `ชำระเงิน สัญญา ${data.contractNumber} งวด ${data.installmentNo} จำนวน ฿${data.amount.toLocaleString()}`,
    bubble,
  );
}
