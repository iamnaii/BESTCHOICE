import {
  FlexBubble,
  FlexMessagePayload,
  COLORS,
  GRADIENTS,
  createHeader,
  createDetailRow,
  createAmountRow,
  createProgressBar,
  createPostbackButton,
  createUriButton,
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
  const isUrgent = data.daysUntilDue <= 1;
  const gradient = isUrgent ? GRADIENTS.ORANGE : GRADIENTS.GREEN;
  const urgencyText =
    data.daysUntilDue === 0
      ? '⏰ วันนี้ครบกำหนด!'
      : data.daysUntilDue <= 1
      ? '⏰ ครบกำหนดพรุ่งนี้!'
      : `อีก ${data.daysUntilDue} วัน`;

  const bubble: FlexBubble = {
    type: 'bubble',
    size: 'mega',
    header: createHeader('💰 แจ้งเตือนค่างวด', `สัญญา ${data.contractNumber}`, gradient),
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
        createAmountRow('ยอดชำระ', data.amountDue, isUrgent ? COLORS.WARNING : COLORS.PRIMARY),
        createProgressBar(data.installmentNo - 1, data.totalInstallments, COLORS.PRIMARY),
        {
          type: 'separator',
          margin: 'lg',
          color: COLORS.BORDER,
        },
        createDetailRow('งวดที่', `${data.installmentNo}/${data.totalInstallments}`),
        createDetailRow('ครบกำหนด', data.dueDate),
        createDetailRow('เหลือเวลา', urgencyText, isUrgent ? COLORS.WARNING : COLORS.TEXT),
        {
          type: 'box',
          layout: 'vertical',
          contents: [
            {
              type: 'text',
              text: '💡 ชำระตรงเวลา รับ 1 แต้ม / 100 บาท',
              size: 'xs',
              color: COLORS.PRIMARY,
              wrap: true,
            },
          ],
          backgroundColor: COLORS.SUCCESS_LIGHT,
          cornerRadius: '8px',
          paddingAll: '12px',
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
        data.paymentUrl
          ? createUriButton('💳 ชำระเงิน', data.paymentUrl, COLORS.PRIMARY)
          : createPostbackButton('💳 ชำระเงิน', `action=pay&contract=${data.contractNumber}`, COLORS.PRIMARY),
        createPostbackButton('📋 ดูรายละเอียด', `action=check_installments&contract=${data.contractNumber}`, '#AAAAAA'),
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
