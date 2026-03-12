import {
  FlexBubble,
  FlexMessagePayload,
  COLORS,
  createHeader,
  createDetailRow,
  createAmountRow,
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
};

export function buildPaymentSuccessFlex(data: PaymentSuccessData): FlexMessagePayload {
  const methodLabel = PAYMENT_METHOD_LABELS[data.paymentMethod] || data.paymentMethod;

  const bubble: FlexBubble = {
    type: 'bubble',
    size: 'mega',
    header: createHeader(
      'ชำระเงินสำเร็จ',
      `สัญญา ${data.contractNumber}`,
      COLORS.PRIMARY,
    ),
    body: {
      type: 'box',
      layout: 'vertical',
      contents: [
        // Checkmark icon area
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
              text: 'ชำระเงินเรียบร้อยแล้ว',
              size: 'md',
              color: COLORS.PRIMARY,
              align: 'center',
              weight: 'bold',
              margin: 'sm',
            },
          ],
          paddingAll: '10px',
        },
        {
          type: 'separator',
          margin: 'lg',
          color: '#EEEEEE',
        },
        createDetailRow('ลูกค้า', `คุณ${data.customerName}`),
        createAmountRow('จำนวนเงิน', data.amountPaid, COLORS.PRIMARY),
        createDetailRow('งวดที่', `${data.installmentNo}/${data.totalInstallments}`),
        createDetailRow('ช่องทาง', methodLabel),
        createDetailRow('วันที่ชำระ', data.paidDate),
        ...(data.remainingInstallments > 0
          ? [createDetailRow('งวดคงเหลือ', `${data.remainingInstallments} งวด`)]
          : [
              {
                type: 'box' as const,
                layout: 'vertical' as const,
                contents: [
                  {
                    type: 'text' as const,
                    text: 'ชำระครบทุกงวดแล้ว ขอบคุณค่ะ',
                    size: 'sm',
                    color: COLORS.PRIMARY,
                    weight: 'bold',
                    align: 'center',
                  },
                ],
                backgroundColor: '#E8F5E9',
                cornerRadius: '8px',
                paddingAll: '12px',
                margin: 'xl',
              },
            ]),
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
          text: 'ขอบคุณที่ชำระตรงเวลาค่ะ',
          size: 'xs',
          color: COLORS.MUTED,
          align: 'center',
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
