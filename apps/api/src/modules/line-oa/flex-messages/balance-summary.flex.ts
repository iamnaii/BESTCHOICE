import {
  FlexBubble,
  FlexCarousel,
  FlexMessagePayload,
  COLORS,
  createHeader,
  createDetailRow,
  createAmountRow,
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

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'ปกติ',
  OVERDUE: 'ค้างชำระ',
  DEFAULT: 'ผิดนัด',
  COMPLETED: 'ชำระครบ',
  EARLY_PAYOFF: 'ปิดก่อนกำหนด',
};

export function buildBalanceSummaryFlex(data: BalanceSummaryData): FlexMessagePayload {
  if (data.contracts.length === 1) {
    // Single contract — use bubble
    const c = data.contracts[0];
    return buildSingleContractBubble(data.customerName, c);
  }

  // Multiple contracts — use carousel
  const bubbles = data.contracts.slice(0, 10).map((c) =>
    buildContractBubble(data.customerName, c),
  );

  return {
    type: 'flex',
    altText: `สรุปยอด: คุณ${data.customerName} ${data.contracts.length} สัญญา`,
    contents: {
      type: 'carousel',
      contents: bubbles,
    } as FlexCarousel,
  };
}

function buildSingleContractBubble(
  customerName: string,
  c: BalanceSummaryData['contracts'][number],
): FlexMessagePayload {
  const bubble = buildContractBubble(customerName, c);
  return {
    type: 'flex',
    altText: `สรุปยอด: สัญญา ${c.contractNumber} ยอดค้าง ${c.totalOutstanding.toLocaleString()} บาท`,
    contents: bubble,
  };
}

function buildContractBubble(
  customerName: string,
  c: BalanceSummaryData['contracts'][number],
): FlexBubble {
  const isOverdue = c.status === 'OVERDUE' || c.status === 'DEFAULT';
  const color = isOverdue ? COLORS.DANGER : COLORS.PRIMARY;
  const statusLabel = STATUS_LABELS[c.status] || c.status;

  return {
    type: 'bubble',
    size: 'mega',
    header: createHeader(
      'สรุปยอดค้างชำระ',
      `สัญญา ${c.contractNumber}`,
      color,
    ),
    body: {
      type: 'box',
      layout: 'vertical',
      contents: [
        {
          type: 'text',
          text: `คุณ${customerName}`,
          size: 'md',
          color: COLORS.DARK,
          weight: 'bold',
        },
        createAmountRow('ยอดค้างชำระ', c.totalOutstanding, color),
        {
          type: 'separator',
          margin: 'lg',
          color: '#EEEEEE',
        },
        createDetailRow('สถานะ', statusLabel),
        createDetailRow('ชำระแล้ว', `${c.paidInstallments}/${c.totalInstallments} งวด`),
        ...(c.nextDueDate
          ? [
              createDetailRow('งวดถัดไป', `${c.nextAmountDue.toLocaleString()} บาท`),
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
          ? [createPostbackButton('ชำระเงิน', `action=pay&contract=${c.contractNumber}`, color)]
          : []),
      ],
      paddingAll: '15px',
      spacing: 'sm',
    },
  };
}
