import {
  FlexBubble,
  FlexMessagePayload,
  COLORS,
  GRADIENTS,
  createHeader,
  createDetailRow,
  createAmountRow,
  createPostbackButton,
  wrapFlexMessage,
} from './base-template';

export interface OverdueNoticeData {
  customerName: string;
  contractNumber: string;
  installmentNo: number;
  totalInstallments: number;
  amountDue: number;
  lateFee: number;
  totalOutstanding: number;
  dueDate: string;
  daysOverdue: number;
}

export function buildOverdueNoticeFlex(data: OverdueNoticeData): FlexMessagePayload {
  const bubble: FlexBubble = {
    type: 'bubble',
    size: 'mega',
    header: createHeader('⚠️ แจ้งค้างชำระ', `สัญญา ${data.contractNumber}`, GRADIENTS.RED),
    body: {
      type: 'box',
      layout: 'vertical',
      contents: [
        {
          type: 'text',
          text: `คุณ${data.customerName}`,
          size: 'md',
          color: COLORS.DARK,
          weight: 'bold',
        },
        // Overdue badge
        {
          type: 'box',
          layout: 'horizontal',
          contents: [
            {
              type: 'text',
              text: `❗ เลยกำหนด ${data.daysOverdue} วัน`,
              size: 'sm',
              color: COLORS.WHITE,
              weight: 'bold',
              align: 'center',
            },
          ],
          backgroundColor: COLORS.DANGER,
          cornerRadius: '20px',
          paddingAll: '8px',
          margin: 'md',
        },
        createAmountRow('ยอดค้างชำระ', data.totalOutstanding, COLORS.DANGER),
        {
          type: 'separator',
          margin: 'lg',
          color: COLORS.BORDER,
        },
        createDetailRow('งวดที่', `${data.installmentNo}/${data.totalInstallments}`),
        createDetailRow('ค่างวด', `฿${data.amountDue.toLocaleString()}`),
        ...(data.lateFee > 0
          ? [createDetailRow('ค่าปรับ', `+฿${data.lateFee.toLocaleString()}`, COLORS.DANGER)]
          : []),
        createDetailRow('ครบกำหนด', data.dueDate),
        // Warning box
        {
          type: 'box',
          layout: 'vertical',
          contents: [
            {
              type: 'text',
              text: '⚠️ กรุณาชำระโดยเร็ว เพื่อหลีกเลี่ยงค่าปรับเพิ่มเติม',
              size: 'xs',
              color: COLORS.DANGER,
              wrap: true,
            },
          ],
          backgroundColor: COLORS.DANGER_LIGHT,
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
        createPostbackButton('💳 ชำระเงินทันที', `action=pay&contract=${data.contractNumber}`, COLORS.DANGER),
        createPostbackButton('📋 ดูรายละเอียด', `action=check_balance&contract=${data.contractNumber}`, '#AAAAAA'),
      ],
      paddingAll: '15px',
      spacing: 'sm',
    },
  };

  return wrapFlexMessage(
    `แจ้งค้างชำระ: งวดที่ ${data.installmentNo} ยอด ${data.totalOutstanding.toLocaleString()} บาท เลยกำหนด ${data.daysOverdue} วัน`,
    bubble,
  );
}
