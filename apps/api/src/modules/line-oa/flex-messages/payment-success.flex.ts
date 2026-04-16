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

export interface PaymentSuccessData {
  customerName: string;
  contractNumber: string;
  installmentNo: number;
  totalInstallments: number;
  amountPaid: number;
  paymentMethod: string;
  paidDate: string;
  remainingInstallments: number;
}

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  CASH: 'เงินสด',
  BANK_TRANSFER: 'โอนเงิน',
  QR_EWALLET: 'QR/E-Wallet',
  PROMPTPAY: 'พร้อมเพย์',
};

export function buildPaymentSuccessFlex(data: PaymentSuccessData): FlexMessagePayload {
  const methodLabel = PAYMENT_METHOD_LABELS[data.paymentMethod] || data.paymentMethod;
  const isComplete = data.remainingInstallments === 0;

  const badge = {
    text: 'สำเร็จ',
    bg: STYLE_C.BADGE.SUCCESS.bg,
    textColor: STYLE_C.BADGE.SUCCESS.text,
  };

  // Separator
  const separator: FlexComponent = {
    type: 'separator',
    margin: 'lg',
    color: '#e2e8f0',
  } as FlexComponent;

  const infoCard = createInfoCard(
    'สัญญา ' + data.contractNumber,
    `งวดที่ ${data.installmentNo}/${data.totalInstallments}`,
    formatBaht(data.amountPaid),
    STYLE_C.BUTTON.GREEN,
    `ชำระเมื่อ ${data.paidDate} — ${methodLabel}`,
    STYLE_C.TEXT.MUTED,
    STYLE_C.INFO_CARD_BG.SUCCESS,
    STYLE_C.INFO_CARD_BORDER.SUCCESS,
  );

  const progress = createStyleCProgress(
    data.installmentNo,
    data.totalInstallments,
    STYLE_C.PROGRESS.GREEN,
  );

  const detailRows: FlexComponent[] = [
    {
      type: 'box',
      layout: 'horizontal',
      contents: [
        { type: 'text', text: 'ช่องทาง', size: 'sm', color: STYLE_C.TEXT.SECONDARY, flex: 1 } as FlexComponent,
        { type: 'text', text: methodLabel, size: 'sm', color: STYLE_C.TEXT.PRIMARY, weight: 'bold', align: 'end' } as FlexComponent,
      ],
      margin: 'md',
    } as FlexBox,
    ...(isComplete
      ? []
      : [
          {
            type: 'box',
            layout: 'horizontal',
            contents: [
              { type: 'text', text: 'งวดคงเหลือ', size: 'sm', color: STYLE_C.TEXT.SECONDARY, flex: 1 } as FlexComponent,
              { type: 'text', text: `${data.remainingInstallments} งวด`, size: 'sm', color: STYLE_C.TEXT.PRIMARY, weight: 'bold', align: 'end' } as FlexComponent,
            ],
            margin: 'sm',
          } as FlexBox,
        ]),
  ];

  const buttons = createStyleCButtons(
    'ดูใบเสร็จ',
    { type: 'postback', label: 'ดูใบเสร็จ', data: `action=view_receipt&contract=${data.contractNumber}&installment=${data.installmentNo}` },
    STYLE_C.BUTTON.GREEN,
    'ดูสัญญา',
    { type: 'postback', label: 'ดูสัญญา', data: `action=check_installments&contract=${data.contractNumber}` },
  );

  const bubble: FlexBubble = {
    type: 'bubble',
    size: 'mega',
    header: createStyleCHeader(
      ICONS.CHECK_CIRCLE,
      'ชำระเงินสำเร็จ',
      'BESTCHOICE FINANCE',
      STYLE_C.GRADIENT.GREEN,
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
    `ชำระเงินสำเร็จ: งวดที่ ${data.installmentNo} จำนวน ${formatBaht(data.amountPaid)}`,
    bubble,
  );
}
