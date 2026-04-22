import { FlexBubble, FlexMessagePayload, wrapFlexMessage, FlexComponent, formatBaht } from './base-template';
import { STYLE_C, createStyleCHeader, createInfoCard, createStyleCButtons, FlexBox } from './style-c';
import { ICONS } from './icons';

export interface EarlyPayoffSuccessFlexData {
  customerName: string;
  contractNumber: string;
  amountPaid: number; // ยอดที่ชำระจริง (totalPayoff)
  originalAmount: number; // ยอดเต็มก่อนหักส่วนลด
  savings: number; // จำนวนที่ประหยัด
  payoffDate: string; // formatted Thai date e.g. "15 เม.ย. 2568"
  /** URL to receipt PDF download (already wrapped by withLiffToken) */
  receiptUrl?: string;
  /** Branch URL or message for picking up the device */
  branchPickupHint?: string;
}

/**
 * "ปิดยอดสำเร็จ" — Sent when a customer successfully closes a contract
 * early via the 50% interest-discount promotion. The hero highlights the
 * amount saved (emerald) rather than the amount paid (amber), to
 * reinforce the "you got a deal" framing used throughout LiffEarlyPayoff.
 */
export function buildEarlyPayoffSuccessFlex(data: EarlyPayoffSuccessFlexData): FlexMessagePayload {
  // Amber chrome header mirrors LiffEarlyPayoff's discount chamber hue.
  const amberGradient = STYLE_C.GRADIENT.ORANGE;

  // Hero info card — emphasize savings (emerald) not amount paid
  const savingsCard = createInfoCard(
    'ประหยัดไปทั้งหมด',
    'ส่วนลดพิเศษ 50%',
    formatBaht(data.savings),
    STYLE_C.BUTTON.GREEN,
    `ยอดที่ชำระ ${formatBaht(data.amountPaid)} (ยอดเต็ม ${formatBaht(data.originalAmount)})`,
    STYLE_C.TEXT.SECONDARY,
    STYLE_C.INFO_CARD_BG.SUCCESS,
    STYLE_C.INFO_CARD_BORDER.SUCCESS,
  );

  const row = (label: string, value: string, mono = false): FlexBox =>
    ({
      type: 'box',
      layout: 'horizontal',
      contents: [
        { type: 'text', text: label, size: 'sm', color: STYLE_C.TEXT.SECONDARY, flex: 1 } as FlexComponent,
        {
          type: 'text',
          text: value,
          size: 'sm',
          color: STYLE_C.TEXT.PRIMARY,
          weight: 'bold',
          align: 'end',
          ...(mono ? {} : {}),
        } as FlexComponent,
      ],
      margin: 'md',
    }) as FlexBox;

  // Strike-through original amount styled via text decoration hint
  const originalRow: FlexBox = {
    type: 'box',
    layout: 'horizontal',
    contents: [
      { type: 'text', text: 'ยอดเต็มเดิม', size: 'sm', color: STYLE_C.TEXT.SECONDARY, flex: 1 } as FlexComponent,
      {
        type: 'text',
        text: formatBaht(data.originalAmount),
        size: 'sm',
        color: STYLE_C.TEXT.MUTED,
        decoration: 'line-through',
        align: 'end',
      } as FlexComponent,
    ],
    margin: 'md',
  };

  const buttons = createStyleCButtons(
    'ดาวน์โหลดใบเสร็จ',
    data.receiptUrl
      ? { type: 'uri' as const, label: 'ดาวน์โหลดใบเสร็จ', uri: data.receiptUrl }
      : { type: 'postback' as const, label: 'ดาวน์โหลดใบเสร็จ', data: `action=download_receipt&contract=${data.contractNumber}` },
    STYLE_C.BUTTON.GREEN,
    'ติดต่อรับเครื่อง',
    { type: 'postback', label: 'ติดต่อรับเครื่อง', data: `action=pickup&contract=${data.contractNumber}` },
  );

  const pickupHint: FlexComponent[] = data.branchPickupHint
    ? [
        {
          type: 'text',
          text: data.branchPickupHint,
          size: 'xxs',
          color: STYLE_C.TEXT.MUTED,
          align: 'center',
          margin: 'sm',
          wrap: true,
        } as FlexComponent,
      ]
    : [];

  const bubble: FlexBubble = {
    type: 'bubble',
    size: 'mega',
    header: createStyleCHeader(
      ICONS.CHECK_CIRCLE,
      'ปิดยอดสำเร็จ',
      `คุณ${data.customerName} · ประหยัดดอกเบี้ย 50%`,
      amberGradient,
      { text: 'EARLY PAYOFF', bg: 'rgba(255,255,255,0.2)', textColor: '#FFFFFF' },
    ),
    body: {
      type: 'box',
      layout: 'vertical',
      contents: [
        savingsCard,
        { type: 'separator', margin: 'lg', color: '#e2e8f0' } as FlexComponent,
        row('ยอดที่ชำระ', formatBaht(data.amountPaid)),
        originalRow,
        row('สัญญา', data.contractNumber),
        row('ปิดเมื่อ', data.payoffDate),
      ],
      paddingAll: '20px',
      spacing: 'none',
    },
    footer: {
      type: 'box',
      layout: 'vertical',
      contents: [buttons, ...pickupHint],
      paddingAll: '15px',
      spacing: 'sm',
    },
  };

  return wrapFlexMessage(
    `ปิดยอดสัญญา ${data.contractNumber} สำเร็จ · ประหยัดไป ${formatBaht(data.savings)}`,
    bubble,
  );
}
