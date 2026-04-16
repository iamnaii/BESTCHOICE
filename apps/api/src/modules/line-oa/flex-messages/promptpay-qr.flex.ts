import {
  FlexMessagePayload,
  FlexBubble,
  FlexComponent,
  formatBaht,
  wrapFlexMessage,
} from './base-template';
import {
  STYLE_C,
  createStyleCHeader,
  createInfoCard,
  createStyleCButtons,
} from './style-c';
import { ICONS } from './icons';

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
  const bodyContents: FlexComponent[] = [
    // QR Code image
    {
      type: 'image',
      url: data.qrImageUrl,
      size: 'full',
      aspectRatio: '1:1',
      aspectMode: 'fit',
      margin: 'none',
    },
    // Amount info card
    createInfoCard(
      `คุณ${data.customerName}`,
      `งวดที่ ${data.installmentNo}/${data.totalInstallments}`,
      formatBaht(data.amount),
      STYLE_C.BUTTON.GREEN,
      undefined,
      undefined,
      STYLE_C.INFO_CARD_BG.SUCCESS,
      STYLE_C.INFO_CARD_BORDER.SUCCESS,
    ),
    // PromptPay details row
    {
      type: 'box',
      layout: 'vertical',
      contents: [
        {
          type: 'text',
          text: `PromptPay: ${data.maskedPromptPayId}`,
          size: 'xs',
          color: STYLE_C.TEXT.SECONDARY,
          align: 'center',
        },
        {
          type: 'text',
          text: `ชื่อบัญชี: ${data.accountName}`,
          size: 'xs',
          color: STYLE_C.TEXT.MUTED,
          align: 'center',
          margin: 'sm',
        },
      ],
      margin: 'md',
    },
    // Hint text
    {
      type: 'text',
      text: 'สแกน QR หรือกดปุ่มด้านล่างเพื่อชำระเงิน',
      size: 'xs',
      color: STYLE_C.TEXT.MUTED,
      align: 'center',
      wrap: true,
      margin: 'md',
    },
  ];

  const bubble: FlexBubble = {
    type: 'bubble',
    size: 'mega',
    header: createStyleCHeader(
      ICONS.QR_CODE,
      'ชำระเงิน',
      `สัญญา ${data.contractNumber}`,
      STYLE_C.GRADIENT.GREEN,
    ),
    body: {
      type: 'box',
      layout: 'vertical',
      contents: bodyContents,
      paddingAll: '20px',
      spacing: 'sm',
    },
    footer: data.paymentLinkUrl
      ? {
          type: 'box',
          layout: 'vertical',
          contents: [
            createStyleCButtons(
              'ส่งสลิปชำระเงิน',
              { type: 'uri', label: 'ส่งสลิปชำระเงิน', uri: data.paymentLinkUrl },
              STYLE_C.BUTTON.GREEN,
            ),
          ],
          paddingAll: '12px',
        }
      : undefined,
  };

  return wrapFlexMessage(
    `ชำระเงิน สัญญา ${data.contractNumber} งวด ${data.installmentNo} จำนวน ฿${data.amount.toLocaleString()}`,
    bubble,
  );
}
