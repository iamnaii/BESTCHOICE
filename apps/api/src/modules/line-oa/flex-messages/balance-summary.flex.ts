import {
  FlexBubble,
  FlexCarousel,
  FlexMessagePayload,
  COLORS,
  GRADIENTS,
  createHeader,
  createDetailRow,
  createAmountRow,
  createProgressBar,
  createBadge,
  createPostbackButton,
} from './base-template';

export interface BalanceSummaryData {
  customerName: string;
  contracts: Array<{
    contractNumber: string;
    totalInstallments: number;
    paidInstallments: number;
    nextDueDate: string | null;
    nextAmountDue: number;
    totalOutstanding: number;
    status: string;
  }>;
}

const STATUS_CONFIG: Record<string, { label: string; bg: string; text: string }> = {
  ACTIVE: { label: '✅ ปกติ', bg: COLORS.SUCCESS_LIGHT, text: COLORS.PRIMARY },
  OVERDUE: { label: '❌ ค้างชำระ', bg: COLORS.DANGER_LIGHT, text: COLORS.DANGER },
  DEFAULT: { label: '⚠️ ผิดนัด', bg: COLORS.DANGER_LIGHT, text: COLORS.DANGER },
  COMPLETED: { label: '🎉 ชำระครบ', bg: COLORS.SUCCESS_LIGHT, text: COLORS.PRIMARY },
  EARLY_PAYOFF: { label: '⚡ ปิดก่อนกำหนด', bg: COLORS.INFO_LIGHT, text: COLORS.INFO },
};

export function buildBalanceSummaryFlex(data: BalanceSummaryData): FlexMessagePayload {
  if (data.contracts.length === 1) {
    const c = data.contracts[0];
    const bubble = buildContractBubble(data.customerName, c);
    return {
      type: 'flex',
      altText: `สรุปยอด: สัญญา ${c.contractNumber} ยอดค้าง ฿${c.totalOutstanding.toLocaleString()}`,
      contents: bubble,
    };
  }

  const bubbles = data.contracts.slice(0, 10).map((c) =>
    buildContractBubble(data.customerName, c),
  );

  return {
    type: 'flex',
    altText: `สรุปยอด: คุณ${data.customerName} ${data.contracts.length} สัญญา`,
    contents: { type: 'carousel', contents: bubbles } as FlexCarousel,
  };
}

function buildContractBubble(
  customerName: string,
  c: BalanceSummaryData['contracts'][number],
): FlexBubble {
  const isOverdue = c.status === 'OVERDUE' || c.status === 'DEFAULT';
  const gradient = isOverdue ? GRADIENTS.RED : GRADIENTS.GREEN;
  const amountColor = isOverdue ? COLORS.DANGER : COLORS.PRIMARY;
  const statusCfg = STATUS_CONFIG[c.status] || { label: c.status, bg: COLORS.LIGHT_BG, text: COLORS.TEXT };

  return {
    type: 'bubble',
    size: 'mega',
    header: createHeader('📊 สรุปยอด', `สัญญา ${c.contractNumber}`, gradient),
    body: {
      type: 'box',
      layout: 'vertical',
      contents: [
        {
          type: 'box',
          layout: 'horizontal',
          contents: [
            {
              type: 'text',
              text: `คุณ${customerName}`,
              size: 'md',
              color: COLORS.DARK,
              weight: 'bold',
              flex: 1,
            },
            createBadge(statusCfg.label, statusCfg.bg, statusCfg.text),
          ],
          alignItems: 'center',
        },
        createAmountRow('ยอดค้างชำระ', c.totalOutstanding, amountColor),
        createProgressBar(c.paidInstallments, c.totalInstallments, amountColor),
        {
          type: 'separator',
          margin: 'lg',
          color: COLORS.BORDER,
        },
        createDetailRow('ชำระแล้ว', `${c.paidInstallments}/${c.totalInstallments} งวด`),
        ...(c.nextDueDate
          ? [
              createDetailRow('งวดถัดไป', `฿${c.nextAmountDue.toLocaleString()}`),
              createDetailRow('ครบกำหนด', c.nextDueDate),
            ]
          : []),
      ],
      paddingAll: '20px',
      spacing: 'sm',
    },
    footer: {
      type: 'box',
      layout: 'vertical',
      contents: [
        ...(c.totalOutstanding > 0
          ? [createPostbackButton('💳 ชำระเงิน', `action=pay&contract=${c.contractNumber}`, amountColor)]
          : []),
      ],
      paddingAll: '15px',
      spacing: 'sm',
    },
  };
}
