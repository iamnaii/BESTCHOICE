import { FlexBubble, FlexCarousel, FlexMessagePayload } from './base-template';
import {
  createStyleCHeader,
  createInfoCard,
  createStyleCProgress,
  createHintCards,
  createStyleCButtons,
  STYLE_C,
  FlexComponent,
} from './style-c';
import { ICONS } from './icons';
import { formatBaht } from './base-template';

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

export function buildBalanceSummaryFlex(data: BalanceSummaryData): FlexMessagePayload {
  if (data.contracts.length === 1) {
    const c = data.contracts[0];
    const bubble = buildContractBubble(c);
    return {
      type: 'flex',
      altText: `สรุปยอด: สัญญา ${c.contractNumber} ยอดค้าง ${formatBaht(c.totalOutstanding)}`,
      contents: bubble,
    };
  }

  const bubbles = data.contracts.slice(0, 10).map((c) => buildContractBubble(c));

  return {
    type: 'flex',
    altText: `สรุปยอด: คุณ${data.customerName} ${data.contracts.length} สัญญา`,
    contents: { type: 'carousel', contents: bubbles } as FlexCarousel,
  };
}

function buildContractBubble(
  c: BalanceSummaryData['contracts'][number],
): FlexBubble {
  const isOverdue = c.status === 'OVERDUE' || c.status === 'DEFAULT';

  const badge = isOverdue
    ? { text: 'ค้างชำระ', bg: STYLE_C.BADGE.DANGER.bg, textColor: STYLE_C.BADGE.DANGER.text }
    : { text: 'ปกติ', bg: STYLE_C.BADGE.SUCCESS.bg, textColor: STYLE_C.BADGE.SUCCESS.text };

  const gradient = isOverdue ? STYLE_C.GRADIENT.BLUE : STYLE_C.GRADIENT.BLUE;
  const amountColor = isOverdue ? STYLE_C.BADGE.DANGER.text : STYLE_C.TEXT.PRIMARY;

  // Separator
  const separator: FlexComponent = {
    type: 'separator',
    margin: 'lg',
    color: '#e2e8f0',
  } as FlexComponent;

  const infoCard = createInfoCard(
    'ยอดคงเหลือทั้งหมด',
    `สัญญา ${c.contractNumber}`,
    formatBaht(c.totalOutstanding),
    amountColor,
    undefined,
    undefined,
    STYLE_C.INFO_CARD_BG.DEFAULT,
    undefined,
  );

  // Hint cards: paid + next due
  const hintCards = createHintCards([
    {
      label: 'ชำระแล้ว',
      value: `${c.paidInstallments}/${c.totalInstallments} งวด`,
      bgColor: STYLE_C.HINT_CARD.GREEN,
    },
    {
      label: 'งวดถัดไป',
      value: c.nextDueDate ? formatBaht(c.nextAmountDue) : '-',
      bgColor: STYLE_C.HINT_CARD.YELLOW,
    },
  ]);

  const progress = createStyleCProgress(
    c.paidInstallments,
    c.totalInstallments,
    STYLE_C.PROGRESS.BLUE,
  );

  const buttons = createStyleCButtons(
    'ดูรายละเอียดสัญญา',
    { type: 'postback', label: 'ดูรายละเอียดสัญญา', data: `action=check_installments&contract=${c.contractNumber}` },
    STYLE_C.BUTTON.BLUE,
  );

  return {
    type: 'bubble',
    size: 'mega',
    header: createStyleCHeader(
      ICONS.BAR_CHART,
      'สรุปยอดสัญญา',
      'BESTCHOICE FINANCE',
      gradient,
      badge,
    ),
    body: {
      type: 'box',
      layout: 'vertical',
      contents: [
        separator,
        infoCard,
        hintCards,
        progress,
      ],
      paddingAll: '20px',
      spacing: 'none',
    },
    footer: {
      type: 'box',
      layout: 'vertical',
      contents: [buttons],
      paddingAll: '15px',
      spacing: 'sm',
    },
  };
}
