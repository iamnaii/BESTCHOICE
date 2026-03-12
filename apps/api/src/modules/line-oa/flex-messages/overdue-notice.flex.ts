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
    header: createHeader(
      'แจ้งค้างชำระ',
      `สัญญา ${data.contractNumber}`,
      COLORS.DANGER,
    ),
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
        {
          type: 'text',
          text: `เลยกำหนดชำระ ${data.daysOverdue} วัน`,
          size: 'sm',
          color: COLORS.DANGER,
          weight: 'bold',
          margin: 'sm',
        },
        createAmountRow('ยอดค้างชำระ', data.totalOutstanding, COLORS.DANGER),
        {
          type: 'separator',
          margin: 'lg',
          color: '#EEEEEE',
        },
        createDetailRow('งวดที่', `${data.installmentNo}/${data.totalInstallments}`),
        createDetailRow('ค่างวด', `${data.amountDue.toLocaleString()} บาท`),
        ...(data.lateFee > 0
          ? [createDetailRow('ค่าปรับ', `${data.lateFee.toLocaleString()} บาท`)]
          : []),
        createDetailRow('ครบกำหนด', data.dueDate),
        {
          type: 'box',
          layout: 'vertical',
          contents: [
            {
              type: 'text',
              text: 'กรุณาชำระโดยเร็ว เพื่อป้องกันค่าปรับเพิ่มเติม',
              size: 'xs',
              color: COLORS.DANGER,
              wrap: true,
            },
          ],
          backgroundColor: '#FFF3F0',
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
        createPostbackButton('ชำระเงินทันที', `action=pay&contract=${data.contractNumber}`, COLORS.DANGER),
        createPostbackButton('ดูรายละเอียด', `action=check_balance&contract=${data.contractNumber}`, '#AAAAAA'),
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
