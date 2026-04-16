import { formatDateShort } from '../../../utils/thai-date.util';
import {
  FlexMessagePayload,
  FlexBubble,
  FlexComponent,
  COLORS,
  formatBaht,
} from './base-template';
import {
  STYLE_C,
  createStyleCHeader,
  createInfoCard,
  createStyleCButtons,
} from './style-c';
import { ICONS } from './icons';

export interface ReceiptData {
  receiptNumber: string;
  receiptType: string;
  payerName: string;
  amount: number;
  installmentNo?: number;
  remainingBalance?: number;
  remainingMonths?: number;
  paymentMethod?: string;
  paidDate: string;
  productName?: string;
  contractNumber?: string;
  verifyUrl: string;
}

const typeLabels: Record<string, { text: string; emoji: string }> = {
  PAYMENT: { text: 'ใบเสร็จรับเงิน', emoji: '🧾' },
  DOWN_PAYMENT: { text: 'ใบเสร็จเงินดาวน์', emoji: '💰' },
  EARLY_PAYOFF: { text: 'ใบเสร็จปิดยอด', emoji: '⚡' },
  CREDIT_NOTE: { text: 'ใบลดหนี้', emoji: '📋' },
};

const methodLabels: Record<string, string> = {
  CASH: 'เงินสด',
  BANK_TRANSFER: 'โอนเงิน',
  QR_EWALLET: 'QR/E-Wallet',
  PROMPTPAY: 'พร้อมเพย์',
};

export function buildReceiptMessage(data: ReceiptData): FlexMessagePayload {
  const typeInfo = typeLabels[data.receiptType] || { text: 'ใบเสร็จ', emoji: '🧾' };
  const isCreditNote = data.receiptType === 'CREDIT_NOTE';
  const gradient = isCreditNote ? STYLE_C.GRADIENT.ORANGE : STYLE_C.GRADIENT.GREEN;
  const amountColor = isCreditNote ? COLORS.WARNING : STYLE_C.BUTTON.GREEN;
  const cardBg = isCreditNote ? STYLE_C.INFO_CARD_BG.WARNING : STYLE_C.INFO_CARD_BG.SUCCESS;

  const bodyContents: FlexComponent[] = [
    // Receipt number header
    {
      type: 'box',
      layout: 'horizontal',
      contents: [
        {
          type: 'text',
          text: 'เลขใบเสร็จ',
          size: 'xs',
          color: STYLE_C.TEXT.SECONDARY,
          flex: 1,
        },
        {
          type: 'text',
          text: data.receiptNumber,
          size: 'xs',
          color: STYLE_C.BUTTON.GREEN,
          weight: 'bold',
          align: 'end',
          flex: 0,
        },
      ],
      justifyContent: 'space-between',
    },
    // Product & Contract
    ...(data.productName
      ? [
          {
            type: 'box' as const,
            layout: 'horizontal' as const,
            contents: [
              {
                type: 'text' as const,
                text: 'สินค้า',
                size: 'xs',
                color: STYLE_C.TEXT.SECONDARY,
                flex: 1,
              },
              {
                type: 'text' as const,
                text: data.productName,
                size: 'xs',
                color: STYLE_C.TEXT.PRIMARY,
                weight: 'bold' as const,
                align: 'end' as const,
                flex: 2,
                wrap: true,
              },
            ],
            justifyContent: 'space-between' as const,
            margin: 'sm' as const,
          },
        ]
      : []),
    ...(data.contractNumber
      ? [
          {
            type: 'box' as const,
            layout: 'horizontal' as const,
            contents: [
              {
                type: 'text' as const,
                text: 'เลขสัญญา',
                size: 'xs',
                color: STYLE_C.TEXT.SECONDARY,
                flex: 1,
              },
              {
                type: 'text' as const,
                text: data.contractNumber,
                size: 'xs',
                color: STYLE_C.TEXT.PRIMARY,
                weight: 'bold' as const,
                align: 'end' as const,
                flex: 0,
              },
            ],
            justifyContent: 'space-between' as const,
            margin: 'sm' as const,
          },
        ]
      : []),
    // Separator
    { type: 'separator', margin: 'md', color: '#e2e8f0' },
    // Payer + date + method + installment
    {
      type: 'box',
      layout: 'horizontal',
      contents: [
        { type: 'text', text: 'ผู้ชำระ', size: 'xs', color: STYLE_C.TEXT.SECONDARY, flex: 1 },
        {
          type: 'text',
          text: data.payerName,
          size: 'xs',
          color: STYLE_C.TEXT.PRIMARY,
          weight: 'bold',
          align: 'end',
          flex: 2,
          wrap: true,
        },
      ],
      justifyContent: 'space-between',
      margin: 'sm',
    },
    {
      type: 'box',
      layout: 'horizontal',
      contents: [
        { type: 'text', text: 'วันที่', size: 'xs', color: STYLE_C.TEXT.SECONDARY, flex: 1 },
        {
          type: 'text',
          text: formatDateShort(data.paidDate),
          size: 'xs',
          color: STYLE_C.TEXT.PRIMARY,
          weight: 'bold',
          align: 'end',
          flex: 0,
        },
      ],
      justifyContent: 'space-between',
      margin: 'sm',
    },
    ...(data.paymentMethod
      ? [
          {
            type: 'box' as const,
            layout: 'horizontal' as const,
            contents: [
              {
                type: 'text' as const,
                text: 'วิธีชำระ',
                size: 'xs',
                color: STYLE_C.TEXT.SECONDARY,
                flex: 1,
              },
              {
                type: 'text' as const,
                text: methodLabels[data.paymentMethod] || data.paymentMethod,
                size: 'xs',
                color: STYLE_C.TEXT.PRIMARY,
                weight: 'bold' as const,
                align: 'end' as const,
                flex: 0,
              },
            ],
            justifyContent: 'space-between' as const,
            margin: 'sm' as const,
          },
        ]
      : []),
    ...(data.installmentNo
      ? [
          {
            type: 'box' as const,
            layout: 'horizontal' as const,
            contents: [
              {
                type: 'text' as const,
                text: 'งวดที่',
                size: 'xs',
                color: STYLE_C.TEXT.SECONDARY,
                flex: 1,
              },
              {
                type: 'text' as const,
                text: data.installmentNo.toString(),
                size: 'xs',
                color: STYLE_C.TEXT.PRIMARY,
                weight: 'bold' as const,
                align: 'end' as const,
                flex: 0,
              },
            ],
            justifyContent: 'space-between' as const,
            margin: 'sm' as const,
          },
        ]
      : []),
    // Amount info card
    createInfoCard(
      'จำนวนเงินที่ชำระ',
      '',
      formatBaht(data.amount),
      amountColor,
      undefined,
      undefined,
      cardBg,
    ),
    // Remaining balance
    ...(data.remainingBalance != null && data.remainingBalance > 0
      ? [
          createInfoCard(
            'ยอดคงเหลือ',
            data.remainingMonths != null ? `เหลืออีก ${data.remainingMonths} งวด` : '',
            formatBaht(data.remainingBalance),
            COLORS.WARNING,
            undefined,
            undefined,
            STYLE_C.INFO_CARD_BG.WARNING,
          ),
        ]
      : []),
  ];

  const bubble: FlexBubble = {
    type: 'bubble',
    size: 'mega',
    header: createStyleCHeader(
      ICONS.RECEIPT,
      typeInfo.text,
      'BESTCHOICE',
      gradient,
      { text: 'สำเร็จ', bg: STYLE_C.BADGE.SUCCESS.bg, textColor: STYLE_C.BADGE.SUCCESS.text },
    ),
    body: {
      type: 'box',
      layout: 'vertical',
      contents: bodyContents,
      paddingAll: '20px',
      spacing: 'sm',
    },
    footer: {
      type: 'box',
      layout: 'vertical',
      contents: [
        createStyleCButtons(
          'ตรวจสอบใบเสร็จ',
          { type: 'uri', label: 'ตรวจสอบใบเสร็จ', uri: data.verifyUrl },
          STYLE_C.BUTTON.GREEN,
        ),
      ],
      paddingAll: '12px',
    },
  };

  return {
    type: 'flex',
    altText: `${typeInfo.text} #${data.receiptNumber}`,
    contents: bubble,
  };
}
