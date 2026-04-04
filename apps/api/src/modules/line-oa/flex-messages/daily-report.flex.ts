import {
  FlexBubble,
  FlexMessagePayload,
  COLORS,
  createHeader,
  createDetailRow,
  wrapFlexMessage,
  formatBaht,
} from './base-template';

export interface DailyReportData {
  date: string;
  todayPaymentCount: number;
  todayPaymentAmount: number;
  overdueCount: number;
  overdueAmount: number;
  defaultCount: number;
  newContractsToday: number;
  pendingApprovals: number;
}

export function buildDailyReportFlex(data: DailyReportData): FlexMessagePayload {
  const totalOverdue = data.overdueCount + data.defaultCount;
  const overdueColor = totalOverdue >= 10 ? COLORS.DANGER : totalOverdue > 0 ? COLORS.WARNING : COLORS.PRIMARY;

  const bubble: FlexBubble = {
    type: 'bubble',
    size: 'mega',
    header: createHeader('รายงานประจำวัน', data.date, COLORS.INFO),
    body: {
      type: 'box',
      layout: 'vertical',
      contents: [
        // ยอดรับชำระวันนี้
        {
          type: 'box',
          layout: 'vertical',
          contents: [
            {
              type: 'text',
              text: '💰 ยอดรับชำระวันนี้',
              size: 'sm',
              color: COLORS.MUTED,
              weight: 'bold',
            },
            {
              type: 'text',
              text: formatBaht(data.todayPaymentAmount),
              size: 'xl',
              color: COLORS.PRIMARY,
              weight: 'bold',
              margin: 'xs',
            },
            {
              type: 'text',
              text: `${data.todayPaymentCount} รายการ`,
              size: 'xs',
              color: COLORS.MUTED,
              margin: 'xs',
            },
          ],
          backgroundColor: '#F0FFF4',
          cornerRadius: '8px',
          paddingAll: '12px',
        },
        // separator
        {
          type: 'separator',
          margin: 'lg',
          color: '#EEEEEE',
        },
        // สัญญาใหม่ + pending
        createDetailRow('📋 สัญญาใหม่วันนี้', `${data.newContractsToday} สัญญา`),
        ...(data.pendingApprovals > 0
          ? [createDetailRow('⏳ รออนุมัติ', `${data.pendingApprovals} สัญญา`)]
          : []),
        // separator
        {
          type: 'separator',
          margin: 'lg',
          color: '#EEEEEE',
        },
        // ค้างชำระ
        {
          type: 'box',
          layout: 'vertical',
          contents: [
            {
              type: 'text',
              text: '⚠️ สัญญาค้างชำระ',
              size: 'sm',
              color: COLORS.MUTED,
              weight: 'bold',
            },
            {
              type: 'box',
              layout: 'horizontal',
              contents: [
                {
                  type: 'text',
                  text: `${totalOverdue} สัญญา`,
                  size: 'lg',
                  color: overdueColor,
                  weight: 'bold',
                  flex: 0,
                },
                {
                  type: 'text',
                  text: formatBaht(data.overdueAmount),
                  size: 'sm',
                  color: COLORS.MUTED,
                  align: 'end',
                  flex: 1,
                },
              ],
              margin: 'xs',
              justifyContent: 'space-between',
              alignItems: 'center',
            },
            ...(data.defaultCount > 0
              ? [
                  {
                    type: 'text' as const,
                    text: `(DEFAULT ${data.defaultCount} สัญญา)`,
                    size: 'xs',
                    color: COLORS.DANGER,
                    margin: 'xs',
                  },
                ]
              : []),
          ],
          backgroundColor: totalOverdue > 0 ? '#FFF8F0' : '#F0FFF4',
          cornerRadius: '8px',
          paddingAll: '12px',
          margin: 'lg',
        },
      ],
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
            label: 'เปิด Dashboard',
            uri: 'https://bestchoicephone.app',
          },
          style: 'primary',
          color: COLORS.INFO,
          height: 'sm',
        },
      ],
      paddingAll: '15px',
    },
  };

  return wrapFlexMessage(
    `รายงานประจำวัน ${data.date} — รับชำระ ${formatBaht(data.todayPaymentAmount)}, ค้างชำระ ${totalOverdue} สัญญา`,
    bubble,
  );
}
