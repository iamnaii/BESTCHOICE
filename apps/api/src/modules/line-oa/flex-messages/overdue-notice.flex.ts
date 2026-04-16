import { FlexBubble, FlexMessagePayload, wrapFlexMessage } from './base-template';
import {
  createStyleCHeader,
  createInfoCard,
  createTipBox,
  createStyleCButtons,
  STYLE_C,
  FlexBox,
  FlexComponent,
} from './style-c';
import { ICONS } from './icons';
import { formatBaht } from './base-template';

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
  const badge = {
    text: 'ค้างชำระ',
    bg: STYLE_C.BADGE.DANGER.bg,
    textColor: STYLE_C.BADGE.DANGER.text,
  };

  // Separator
  const separator: FlexComponent = {
    type: 'separator',
    margin: 'lg',
    color: '#e2e8f0',
  } as FlexComponent;

  // Breakdown sub text
  const breakdownText =
    data.lateFee > 0
      ? `ค่างวด ${formatBaht(data.amountDue)} + ค่าปรับ ${formatBaht(data.lateFee)}`
      : `ค่างวด ${formatBaht(data.amountDue)}`;

  const infoCard = createInfoCard(
    'สัญญา ' + data.contractNumber,
    `เกินกำหนด ${data.daysOverdue} วัน`,
    formatBaht(data.totalOutstanding),
    STYLE_C.BADGE.DANGER.text,
    breakdownText,
    STYLE_C.BADGE.DANGER.text,
    STYLE_C.INFO_CARD_BG.DANGER,
    STYLE_C.INFO_CARD_BORDER.DANGER,
  );

  const detailRows: FlexComponent[] = [
    {
      type: 'box',
      layout: 'horizontal',
      contents: [
        { type: 'text', text: 'งวดที่', size: 'sm', color: STYLE_C.TEXT.SECONDARY, flex: 1 } as FlexComponent,
        { type: 'text', text: `${data.installmentNo}/${data.totalInstallments}`, size: 'sm', color: STYLE_C.TEXT.PRIMARY, weight: 'bold', align: 'end' } as FlexComponent,
      ],
      margin: 'md',
    } as FlexBox,
    {
      type: 'box',
      layout: 'horizontal',
      contents: [
        { type: 'text', text: 'ครบกำหนดชำระ', size: 'sm', color: STYLE_C.TEXT.SECONDARY, flex: 1 } as FlexComponent,
        { type: 'text', text: data.dueDate, size: 'sm', color: STYLE_C.TEXT.PRIMARY, weight: 'bold', align: 'end' } as FlexComponent,
      ],
      margin: 'sm',
    } as FlexBox,
  ];

  const tipBox = createTipBox(
    ICONS.INFO_CIRCLE,
    'ชำระภายในวันนี้เพื่อหลีกเลี่ยงค่าปรับเพิ่มเติม',
    STYLE_C.TIP_BOX.ORANGE_BG,
    STYLE_C.TIP_BOX.ORANGE_TEXT,
  );

  const buttons = createStyleCButtons(
    'ชำระเงินทันที',
    { type: 'postback', label: 'ชำระเงินทันที', data: `action=pay&contract=${data.contractNumber}` },
    STYLE_C.BUTTON.RED,
    'ติดต่อเจ้าหน้าที่',
    { type: 'postback', label: 'ติดต่อเจ้าหน้าที่', data: `action=contact_staff&contract=${data.contractNumber}` },
  );

  const bubble: FlexBubble = {
    type: 'bubble',
    size: 'mega',
    header: createStyleCHeader(
      ICONS.ALERT_TRIANGLE,
      'แจ้งเตือนค้างชำระ',
      'BESTCHOICE FINANCE',
      STYLE_C.GRADIENT.RED,
      badge,
    ),
    body: {
      type: 'box',
      layout: 'vertical',
      contents: [
        separator,
        infoCard,
        ...detailRows,
        tipBox,
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

  return wrapFlexMessage(
    `แจ้งค้างชำระ: งวดที่ ${data.installmentNo} ยอด ${formatBaht(data.totalOutstanding)} เลยกำหนด ${data.daysOverdue} วัน`,
    bubble,
  );
}
