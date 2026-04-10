import { formatDateShort } from '../../../utils/thai-date.util';
import {
  FlexMessagePayload,
  FlexBubble,
  FlexComponent,
  COLORS,
  GRADIENTS,
  createHeader,
  createDetailRow,
} from './base-template';

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
  const gradient = data.receiptType === 'CREDIT_NOTE' ? GRADIENTS.ORANGE : GRADIENTS.GREEN;

  const bodyContents: FlexComponent[] = [
    // Receipt Number
    {
      type: 'box' as const,
      layout: 'vertical' as const,
      contents: [
        {
          type: 'text' as const,
          text: 'เลขใบเสร็จ',
          size: 'xs',
          color: COLORS.MUTED,
        },
        {
          type: 'text' as const,
          text: data.receiptNumber,
          size: 'sm',
          weight: 'bold',
          color: COLORS.PRIMARY,
        },
      ],
    },
    // Product & Contract
    ...(data.productName || data.contractNumber ? [
      { type: 'separator' as const, margin: 'md', color: COLORS.BORDER },
      ...(data.productName ? [createDetailRow('สินค้า', data.productName)] : []),
      ...(data.contractNumber ? [createDetailRow('เลขสัญญา', data.contractNumber)] : []),
    ] : []),
    { type: 'separator' as const, margin: 'md', color: COLORS.BORDER },
    // Payment Details
    createDetailRow('ผู้ชำระ', data.payerName),
    createDetailRow('วันที่', formatDateShort(data.paidDate)),
    ...(data.paymentMethod ? [createDetailRow('วิธีชำระ', methodLabels[data.paymentMethod] || data.paymentMethod)] : []),
    ...(data.installmentNo ? [createDetailRow('งวดที่', data.installmentNo.toString())] : []),
    // Amount Box
    {
      type: 'box' as const,
      layout: 'vertical' as const,
      contents: [
        {
          type: 'text' as const,
          text: 'จำนวนเงินที่ชำระ',
          size: 'xs',
          color: COLORS.MUTED,
          align: 'center' as const,
        },
        {
          type: 'text' as const,
          text: `฿${data.amount.toLocaleString()}`,
          size: 'xxl',
          weight: 'bold',
          color: COLORS.PRIMARY,
          align: 'center' as const,
          margin: 'sm',
        },
      ],
      backgroundColor: COLORS.SUCCESS_LIGHT,
      paddingAll: '16px',
      cornerRadius: '12px',
      margin: 'lg',
    },
    // Remaining Balance
    ...(data.remainingBalance != null && data.remainingBalance > 0 ? [
      {
        type: 'box' as const,
        layout: 'vertical' as const,
        contents: [
          {
            type: 'text' as const,
            text: 'ยอดคงเหลือ',
            size: 'xs',
            color: COLORS.MUTED,
            align: 'center' as const,
          },
          {
            type: 'text' as const,
            text: `฿${data.remainingBalance.toLocaleString()}`,
            size: 'xl',
            weight: 'bold',
            color: COLORS.WARNING,
            align: 'center' as const,
          },
          ...(data.remainingMonths != null ? [{
            type: 'text' as const,
            text: `เหลืออีก ${data.remainingMonths} งวด`,
            size: 'xs',
            color: COLORS.MUTED,
            align: 'center' as const,
            margin: 'sm',
          }] : []),
        ],
        backgroundColor: COLORS.WARNING_LIGHT,
        paddingAll: '12px',
        cornerRadius: '12px',
        margin: 'md',
      },
    ] : []),
  ];

  const bubble: FlexBubble = {
    type: 'bubble',
    size: 'mega',
    header: createHeader(`${typeInfo.emoji} ${typeInfo.text}`, 'BESTCHOICE', gradient),
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
        {
          type: 'button',
          action: { type: 'uri', label: '🔍 ตรวจสอบใบเสร็จ', uri: data.verifyUrl },
          style: 'primary',
          color: COLORS.PRIMARY,
          height: 'sm',
        },
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
