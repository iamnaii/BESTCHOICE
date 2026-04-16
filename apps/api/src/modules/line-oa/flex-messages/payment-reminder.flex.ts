import { FlexBubble, FlexMessagePayload, wrapFlexMessage } from './base-template';
import {
  createStyleCHeader,
  createInfoCard,
  createStyleCProgress,
  createStyleCButtons,
  STYLE_C,
  FlexBox,
  FlexComponent,
} from './style-c';
import { ICONS } from './icons';
import { formatBaht } from './base-template';

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
  const isToday = data.daysUntilDue === 0;
  const isTomorrow = data.daysUntilDue === 1;
  const isUrgent = data.daysUntilDue <= 1;

  // Badge: danger for today/tomorrow, warning for upcoming
  const badge = isToday
    ? { text: 'วันนี้!', bg: STYLE_C.BADGE.DANGER.bg, textColor: STYLE_C.BADGE.DANGER.text }
    : isTomorrow
    ? { text: 'พรุ่งนี้', bg: STYLE_C.BADGE.DANGER.bg, textColor: STYLE_C.BADGE.DANGER.text }
    : { text: `อีก ${data.daysUntilDue} วัน`, bg: STYLE_C.BADGE.WARNING.bg, textColor: STYLE_C.BADGE.WARNING.text };

  const gradient = isUrgent ? STYLE_C.GRADIENT.ORANGE : STYLE_C.GRADIENT.GREEN;

  // Separator between header and info card
  const separator: FlexComponent = {
    type: 'separator',
    margin: 'lg',
    color: '#e2e8f0',
  } as FlexComponent;

  const detailRows: FlexComponent[] = [
    {
      type: 'box',
      layout: 'horizontal',
      contents: [
        { type: 'text', text: 'สัญญา', size: 'sm', color: STYLE_C.TEXT.SECONDARY, flex: 1 } as FlexComponent,
        { type: 'text', text: data.contractNumber, size: 'sm', color: STYLE_C.TEXT.PRIMARY, weight: 'bold', align: 'end' } as FlexComponent,
      ],
      margin: 'md',
    } as FlexBox,
    {
      type: 'box',
      layout: 'horizontal',
      contents: [
        { type: 'text', text: 'งวดที่', size: 'sm', color: STYLE_C.TEXT.SECONDARY, flex: 1 } as FlexComponent,
        { type: 'text', text: `${data.installmentNo}/${data.totalInstallments}`, size: 'sm', color: STYLE_C.TEXT.PRIMARY, weight: 'bold', align: 'end' } as FlexComponent,
      ],
      margin: 'sm',
    } as FlexBox,
    {
      type: 'box',
      layout: 'horizontal',
      contents: [
        { type: 'text', text: 'ครบกำหนด', size: 'sm', color: STYLE_C.TEXT.SECONDARY, flex: 1 } as FlexComponent,
        { type: 'text', text: data.dueDate, size: 'sm', color: STYLE_C.TEXT.PRIMARY, weight: 'bold', align: 'end' } as FlexComponent,
      ],
      margin: 'sm',
    } as FlexBox,
  ];

  const amountColor = isUrgent ? STYLE_C.BADGE.DANGER.text : STYLE_C.BUTTON.GREEN;

  const infoCard = createInfoCard(
    'ยอดชำระ',
    `งวด ${data.installmentNo}/${data.totalInstallments}`,
    formatBaht(data.amountDue),
    amountColor,
    `ครบกำหนด ${data.dueDate}`,
    STYLE_C.TEXT.MUTED,
    isUrgent ? STYLE_C.INFO_CARD_BG.DANGER : STYLE_C.INFO_CARD_BG.DEFAULT,
    isUrgent ? STYLE_C.INFO_CARD_BORDER.DANGER : undefined,
  );

  const progress = createStyleCProgress(
    data.installmentNo - 1,
    data.totalInstallments,
    STYLE_C.PROGRESS.GREEN,
  );

  const primaryAction = data.paymentUrl
    ? ({ type: 'uri' as const, label: 'ชำระเงิน', uri: data.paymentUrl })
    : ({ type: 'postback' as const, label: 'ชำระเงิน', data: `action=pay&contract=${data.contractNumber}` });

  const buttons = createStyleCButtons(
    'ชำระเงิน',
    primaryAction,
    isUrgent ? STYLE_C.BUTTON.RED : STYLE_C.BUTTON.GREEN,
    'รายละเอียด',
    { type: 'postback', label: 'รายละเอียด', data: `action=check_installments&contract=${data.contractNumber}` },
  );

  const bubble: FlexBubble = {
    type: 'bubble',
    size: 'mega',
    header: createStyleCHeader(
      ICONS.CREDIT_CARD,
      'แจ้งเตือนค่างวด',
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
        progress,
        ...detailRows,
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
    `แจ้งเตือน: ค่างวดที่ ${data.installmentNo} จำนวน ${formatBaht(data.amountDue)} ครบกำหนด ${data.dueDate}`,
    bubble,
  );
}
