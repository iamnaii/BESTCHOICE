import {
  FlexBubble,
  FlexMessagePayload,
  FlexComponent,
  COLORS,
  createHeader,
  createDetailRow,
  createAmountRow,
  wrapFlexMessage,
} from './base-template';

export interface DailySummaryData {
  date: string;
  overdueContracts: number;
  totalOverdueAmount: number;
  paymentsDueToday: number;
  paymentsDueTodayAmount: number;
  paymentsReceivedYesterday: number;
  amountReceivedYesterday: number;
  newContracts: number;
}

export function buildDailySummaryFlex(data: DailySummaryData): FlexMessagePayload {
  const bodyContents: FlexComponent[] = [
    {
      type: 'text',
      text: `สรุปประจำวัน ${data.date}`,
      size: 'md',
      color: COLORS.DARK,
      weight: 'bold',
    },
    {
      type: 'separator',
      margin: 'lg',
      color: '#EEEEEE',
    },
    // Overdue section
    {
      type: 'text',
      text: '📋 สัญญาค้างชำระ',
      size: 'sm',
      color: COLORS.DANGER,
      weight: 'bold',
      margin: 'lg',
    },
    createDetailRow('จำนวนสัญญา', `${data.overdueContracts} รายการ`),
    createAmountRow('ยอดค้างรวม', data.totalOverdueAmount, COLORS.DANGER),
    {
      type: 'separator',
      margin: 'lg',
      color: '#EEEEEE',
    },
    // Due today section
    {
      type: 'text',
      text: '📅 ครบกำหนดวันนี้',
      size: 'sm',
      color: COLORS.WARNING,
      weight: 'bold',
      margin: 'lg',
    },
    createDetailRow('จำนวนงวด', `${data.paymentsDueToday} รายการ`),
    createAmountRow('ยอดรวม', data.paymentsDueTodayAmount, COLORS.WARNING),
    {
      type: 'separator',
      margin: 'lg',
      color: '#EEEEEE',
    },
    // Yesterday received section
    {
      type: 'text',
      text: '💰 รับชำระเมื่อวาน',
      size: 'sm',
      color: COLORS.PRIMARY,
      weight: 'bold',
      margin: 'lg',
    },
    createDetailRow('จำนวนรายการ', `${data.paymentsReceivedYesterday} รายการ`),
    createAmountRow('ยอดรวม', data.amountReceivedYesterday, COLORS.PRIMARY),
  ];

  if (data.newContracts > 0) {
    bodyContents.push(
      {
        type: 'separator',
        margin: 'lg',
        color: '#EEEEEE',
      },
      createDetailRow('สัญญาใหม่เมื่อวาน', `${data.newContracts} รายการ`),
    );
  }

  const bubble: FlexBubble = {
    type: 'bubble',
    size: 'mega',
    header: createHeader(
      'สรุปประจำวัน',
      `BEST CHOICE Daily Report`,
      COLORS.INFO,
    ),
    body: {
      type: 'box',
      layout: 'vertical',
      contents: bodyContents,
      paddingAll: '20px',
      spacing: 'sm',
    },
  };

  return wrapFlexMessage(
    `สรุปประจำวัน ${data.date}: ค้างชำระ ${data.overdueContracts} รายการ, ครบกำหนดวันนี้ ${data.paymentsDueToday} รายการ`,
    bubble,
  );
}
