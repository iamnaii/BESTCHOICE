import {
  FlexBubble,
  FlexMessagePayload,
  COLORS,
  GRADIENTS,
  createHeader,
  createDetailRow,
  createProgressBar,
  wrapFlexMessage,
} from './base-template';

export interface PaymentSuccessData {
  customerName: string;
  contractNumber: string;
  installmentNo: number;
  totalInstallments: number;
  amountPaid: number;
  paymentMethod: string;
  paidDate: string;
  remainingInstallments: number;
}

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  CASH: 'เงินสด',
  BANK_TRANSFER: 'โอนเงิน',
  QR_EWALLET: 'QR/E-Wallet',
  PROMPTPAY: 'พร้อมเพย์',
};

export function buildPaymentSuccessFlex(data: PaymentSuccessData): FlexMessagePayload {
  const methodLabel = PAYMENT_METHOD_LABELS[data.paymentMethod] || data.paymentMethod;
  const isComplete = data.remainingInstallments === 0;

  const bubble: FlexBubble = {
    type: 'bubble',
    size: 'mega',
    header: createHeader(
      isComplete ? '🎉 ชำระครบแล้ว!' : '✅ ชำระเงินสำเร็จ',
      `สัญญา ${data.contractNumber}`,
      GRADIENTS.GREEN,
    ),
    body: {
      type: 'box',
      layout: 'vertical',
      contents: [
        // Amount display
        {
          type: 'box',
          layout: 'vertical',
          contents: [
            {
              type: 'text',
              text: '✓',
              size: '3xl',
              color: COLORS.PRIMARY,
              align: 'center',
              weight: 'bold',
            },
            {
              type: 'text',
              text: `฿${data.amountPaid.toLocaleString()}`,
              size: 'xxl',
              color: COLORS.PRIMARY,
              align: 'center',
              weight: 'bold',
              margin: 'sm',
            },
            {
              type: 'text',
              text: 'ชำระเรียบร้อยแล้ว',
              size: 'xs',
              color: COLORS.MUTED,
              align: 'center',
              margin: 'sm',
            },
          ],
          backgroundColor: COLORS.SUCCESS_LIGHT,
          cornerRadius: '12px',
          paddingAll: '16px',
        },
        // Progress
        createProgressBar(data.installmentNo, data.totalInstallments, COLORS.PRIMARY),
        {
          type: 'separator',
          margin: 'lg',
          color: COLORS.BORDER,
        },
        createDetailRow('ลูกค้า', `คุณ${data.customerName}`),
        createDetailRow('งวดที่', `${data.installmentNo}/${data.totalInstallments}`),
        createDetailRow('ช่องทาง', methodLabel),
        createDetailRow('วันที่ชำระ', data.paidDate),
        ...(isComplete
          ? [
              {
                type: 'box' as const,
                layout: 'vertical' as const,
                contents: [
                  {
                    type: 'text' as const,
                    text: '🎊 ชำระครบทุกงวดแล้ว ขอบคุณค่ะ',
                    size: 'sm',
                    color: COLORS.PRIMARY,
                    weight: 'bold',
                    align: 'center',
                    wrap: true,
                  },
                ],
                backgroundColor: COLORS.SUCCESS_LIGHT,
                cornerRadius: '8px',
                paddingAll: '12px',
                margin: 'xl',
              },
            ]
          : [createDetailRow('งวดคงเหลือ', `${data.remainingInstallments} งวด`)]),
      ],
      paddingAll: '20px',
      spacing: 'sm',
    },
    footer: {
      type: 'box',
      layout: 'vertical',
      contents: [
        {
          type: 'text',
          text: isComplete
            ? '🌟 ขอบคุณที่ไว้วางใจ BEST CHOICE'
            : '💡 ชำระตรงเวลาทุกงวด สะสมแต้มแลกส่วนลด',
          size: 'xs',
          color: COLORS.MUTED,
          align: 'center',
          wrap: true,
        },
      ],
      paddingAll: '15px',
    },
  };

  return wrapFlexMessage(
    `ชำระเงินสำเร็จ: งวดที่ ${data.installmentNo} จำนวน ${data.amountPaid.toLocaleString()} บาท`,
    bubble,
  );
}
