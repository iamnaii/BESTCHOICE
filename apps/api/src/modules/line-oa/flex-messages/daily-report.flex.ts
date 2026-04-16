import {
  FlexBubble,
  FlexMessagePayload,
  FlexComponent,
  wrapFlexMessage,
  formatBaht,
} from './base-template';
import {
  STYLE_C,
  createStyleCHeader,
  createInfoCard,
  createHintCards,
  createTipBox,
  createStyleCButtons,
} from './style-c';
import { ICONS } from './icons';

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
  const overdueColor =
    totalOverdue >= 10 ? STYLE_C.BUTTON.RED : totalOverdue > 0 ? '#d97706' : STYLE_C.BUTTON.GREEN;

  const bodyContents: FlexComponent[] = [
    // ยอดรับชำระวันนี้
    createInfoCard(
      'ยอดรับชำระวันนี้',
      `${data.todayPaymentCount} รายการ`,
      formatBaht(data.todayPaymentAmount),
      STYLE_C.BUTTON.GREEN,
      undefined,
      undefined,
      STYLE_C.INFO_CARD_BG.SUCCESS,
    ),
    // Stats row: สัญญาใหม่ + รออนุมัติ
    createHintCards([
      {
        label: 'สัญญาใหม่วันนี้',
        value: `${data.newContractsToday} สัญญา`,
        bgColor: STYLE_C.HINT_CARD.GREEN,
      },
      {
        label: 'รออนุมัติ',
        value: `${data.pendingApprovals} สัญญา`,
        bgColor: STYLE_C.HINT_CARD.YELLOW,
      },
    ]),
    // Separator
    { type: 'separator', margin: 'lg', color: '#e2e8f0' },
    // ค้างชำระ section
    {
      type: 'box',
      layout: 'vertical',
      contents: [
        {
          type: 'text',
          text: 'สัญญาค้างชำระ',
          size: 'xs',
          color: STYLE_C.TEXT.SECONDARY,
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
              color: STYLE_C.TEXT.SECONDARY,
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
                text: `DEFAULT ${data.defaultCount} สัญญา`,
                size: 'xs',
                color: STYLE_C.BUTTON.RED,
                margin: 'xs',
                weight: 'bold' as const,
              },
            ]
          : []),
      ],
      backgroundColor: totalOverdue > 0 ? STYLE_C.INFO_CARD_BG.WARNING : STYLE_C.INFO_CARD_BG.SUCCESS,
      cornerRadius: '12px',
      paddingAll: '14px',
      margin: 'lg',
    },
  ];

  // Tip box if there are overdue/default contracts
  if (totalOverdue > 0) {
    bodyContents.push(
      createTipBox(
        ICONS.ALERT_TRIANGLE,
        `มีสัญญาค้างชำระ ${totalOverdue} สัญญา กรุณาติดตามลูกค้า`,
        '#fff7ed',
        '#c2410c',
      ),
    );
  }

  const bubble: FlexBubble = {
    type: 'bubble',
    size: 'mega',
    header: createStyleCHeader(
      ICONS.BAR_CHART,
      'รายงานประจำวัน',
      data.date,
      STYLE_C.GRADIENT.BLUE,
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
        createStyleCButtons(
          'เปิด Dashboard',
          { type: 'uri', label: 'เปิด Dashboard', uri: 'https://bestchoicephone.app' },
          STYLE_C.BUTTON.BLUE,
        ),
      ],
      paddingAll: '15px',
    },
  };

  return wrapFlexMessage(
    `รายงานประจำวัน ${data.date} — รับชำระ ${formatBaht(data.todayPaymentAmount)}, ค้างชำระ ${totalOverdue} สัญญา`,
    bubble,
  );
}
