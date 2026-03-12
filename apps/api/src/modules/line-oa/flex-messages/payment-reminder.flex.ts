import {
  FlexBubble,
  FlexMessagePayload,
  COLORS,
  createHeader,
  createDetailRow,
  createAmountRow,
  createPostbackButton,
  wrapFlexMessage,
} from './base-template';

export interface PaymentReminderData {
  customerName: string;
  contractNumber: string;
  installmentNo: number;
  totalInstallments: number;
  amountDue: number;
  dueDate: string;
  daysUntilDue: number;
  paymentUrl?: string;
}

export function buildPaymentReminderFlex(data: PaymentReminderData): FlexMessagePayload {
  const urgencyText =
    data.daysUntilDue <= 1
      ? 'ครบกำหนดพรุ่งนี้!'
      : `อีก ${data.daysUntilDue} วัน`;

  const bubble: FlexBubble = {
    type: 'bubble',
    size: 'mega',
    header: createHeader(
      'แจ้งเตือนค่างวด',
      `สัญญา ${data.contractNumber}`,
      COLORS.PRIMARY,
    ),
    body: {
      type: 'box',
      layout: 'vertical',
      contents: [
        {
          type: 'text',
          text: `สวัสดีค่ะ คุณ${data.customerName}`,
          size: 'md',
          color: COLORS.DARK,
          weight: 'bold',
        },
        createAmountRow('ยอดชำระ', data.amountDue, COLORS.PRIMARY),
        {
          type: 'separator',
          margin: 'lg',
          color: '#EEEEEE',
        },
        createDetailRow('งวดที่', `${data.installmentNo}/${data.totalInstallments}`),
        createDetailRow('ครบกำหนด', data.dueDate),
        createDetailRow('เหลือเวลา', urgencyText),
        {
          type: 'text',
          text: 'กรุณาชำระเงินก่อนครบกำหนด เพื่อหลีกเลี่ยงค่าปรับ',
          size: 'xs',
          color: COLORS.MUTED,
          wrap: true,
          margin: 'xl',
        },
      ],
      paddingAll: '20px',
      spacing: 'sm',
    },
    footer: {
      type: 'box',
      layout: 'vertical',
      contents: [
        createPostbackButton('ชำระเงิน', `action=pay&contract=${data.contractNumber}`, COLORS.PRIMARY),
        createPostbackButton('ดูรายละเอียด', `action=check_installments&contract=${data.contractNumber}`, '#AAAAAA'),
      ],
      paddingAll: '15px',
      spacing: 'sm',
    },
  };

  return wrapFlexMessage(
    `แจ้งเตือน: ค่างวดที่ ${data.installmentNo} จำนวน ${data.amountDue.toLocaleString()} บาท ครบกำหนด ${data.dueDate}`,
    bubble,
  );
}
