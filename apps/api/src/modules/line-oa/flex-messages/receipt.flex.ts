import {
  FlexMessagePayload,
  FlexBubble,
  FlexComponent,
  COLORS,
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

const typeLabels: Record<string, string> = {
  PAYMENT: 'ใบเสร็จรับเงิน',
  DOWN_PAYMENT: 'ใบเสร็จเงินดาวน์',
  EARLY_PAYOFF: 'ใบเสร็จปิดยอด',
  CREDIT_NOTE: 'ใบลดหนี้',
};

const methodLabels: Record<string, string> = {
  CASH: 'เงินสด',
  BANK_TRANSFER: 'โอนเงิน',
  QR_EWALLET: 'QR/E-Wallet',
};

export function buildReceiptMessage(data: ReceiptData): FlexMessagePayload {
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
      { type: 'separator' as const, margin: 'md' },
      ...(data.productName ? [createDetailRow('สินค้า', data.productName)] : []),
      ...(data.contractNumber ? [createDetailRow('เลขสัญญา', data.contractNumber)] : []),
    ] : []),

    { type: 'separator' as const, margin: 'md' },

    // Payment Details
    createDetailRow('ผู้ชำระ', data.payerName),
    createDetailRow('วันที่', new Date(data.paidDate).toLocaleDateString('th-TH')),
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
          size: 'sm',
          color: COLORS.MUTED,
          align: 'center' as const,
        },
        {
          type: 'text' as const,
          text: `${data.amount.toLocaleString()} ฿`,
          size: 'xxl',
          weight: 'bold',
          color: COLORS.PRIMARY,
          align: 'center' as const,
        },
      ],
      backgroundColor: '#f0fdf4',
      paddingAll: '15px',
      cornerRadius: '8px',
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
            size: 'sm',
            color: COLORS.MUTED,
            align: 'center' as const,
          },
          {
            type: 'text' as const,
            text: `${data.remainingBalance.toLocaleString()} ฿`,
            size: 'xl',
            weight: 'bold',
            color: '#ea580c',
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
        backgroundColor: '#fef3c7',
        paddingAll: '12px',
        cornerRadius: '8px',
        margin: 'md',
      },
    ] : []),
  ];

  const bubble: FlexBubble = {
    type: 'bubble',
    header: createHeader(
      typeLabels[data.receiptType] || 'ใบเสร็จ',
      'BESTCHOICE',
      data.receiptType === 'CREDIT_NOTE' ? COLORS.WARNING : COLORS.PRIMARY
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
        {
          type: 'button',
          action: {
            type: 'uri',
            label: 'ตรวจสอบใบเสร็จ',
            uri: data.verifyUrl,
          },
          style: 'primary',
          height: 'sm',
        },
      ],
      paddingAll: '10px',
    },
  };

  return {
    type: 'flex',
    altText: `${typeLabels[data.receiptType] || 'ใบเสร็จ'} #${data.receiptNumber}`,
    contents: bubble,
  };
}