import {
  FlexMessagePayload,
  FlexBubble,
  COLORS,
  createHeader,
  createDetailRow,
  createUriButton,
  wrapFlexMessage,
} from './base-template';

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
  const bubble: FlexBubble = {
    type: 'bubble',
    size: 'mega',
    header: createHeader(
      'ชำระเงิน',
      `สัญญา ${data.contractNumber}`,
      COLORS.INFO,
    ),
    hero: {
      type: 'image',
      url: data.qrImageUrl,
      size: 'full',
      aspectRatio: '1:1',
      aspectMode: 'fit',
    },
    body: {
      type: 'box',
      layout: 'vertical',
      contents: [
        {
          type: 'text',
          text: `คุณ${data.customerName}`,
          size: 'md',
          weight: 'bold',
          color: COLORS.DARK,
        },
        createDetailRow('งวดที่', `${data.installmentNo}/${data.totalInstallments}`),
        createDetailRow('ยอดชำระ', `${data.amount.toLocaleString()} บาท`),
        {
          type: 'separator',
          margin: 'lg',
          color: '#EEEEEE',
        },
        {
          type: 'text',
          text: `PromptPay: ${data.maskedPromptPayId}`,
          size: 'xs',
          color: COLORS.MUTED,
          margin: 'lg',
          align: 'center',
        },
        {
          type: 'text',
          text: `ชื่อ: ${data.accountName}`,
          size: 'xs',
          color: COLORS.MUTED,
          margin: 'sm',
          align: 'center',
        },
        {
          type: 'text',
          text: 'สแกน QR หรือกดปุ่มด้านล่าง',
          size: 'xs',
          color: COLORS.MUTED,
          margin: 'md',
          align: 'center',
        },
      ],
      paddingAll: '20px',
    },
    footer: data.paymentLinkUrl
      ? {
          type: 'box',
          layout: 'vertical',
          contents: [
            createUriButton('ส่งสลิปชำระเงิน', data.paymentLinkUrl, COLORS.PRIMARY),
          ],
          paddingAll: '12px',
        }
      : undefined,
  };

  return wrapFlexMessage(
    `ชำระเงิน สัญญา ${data.contractNumber} งวด ${data.installmentNo} จำนวน ${data.amount.toLocaleString()} บาท`,
    bubble,
  );
}
