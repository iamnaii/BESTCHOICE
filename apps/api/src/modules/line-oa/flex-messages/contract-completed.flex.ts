import { FlexBubble, FlexMessagePayload, wrapFlexMessage, FlexComponent, formatBaht } from './base-template';
import { STYLE_C, createStyleCHeader, createStyleCButtons, FlexBox } from './style-c';
import { ICONS } from './icons';

export interface ContractCompletedFlexData {
  customerName: string;
  contractNumber: string;
  productName: string;
  totalPaid: number;
  totalInstallments: number;
  startDate: string; // e.g. "ก.พ. 2567"
  endDate: string; // e.g. "ก.พ. 2568"
  loyaltyPointsEarned: number;
  /** URL to browse new phones / next contract offer */
  shopUrl?: string;
  /** LIFF URL to view completed contract history */
  liffHistoryUrl?: string;
}

/**
 * "ปิดสัญญาครบ" — Celebration message sent when a customer fully pays off
 * a contract (all installments PAID). Announces ownership transfer,
 * summarizes the contract journey, and awards loyalty points with a CTA
 * to browse the next product.
 */
export function buildContractCompletedFlex(data: ContractCompletedFlexData): FlexMessagePayload {
  // Product card (indigo gradient smartphone icon + name + contract number)
  const productCard: FlexBox = {
    type: 'box',
    layout: 'horizontal',
    contents: [
      {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'image',
            url: ICONS.SMARTPHONE,
            size: '24px',
            aspectRatio: '1:1',
            aspectMode: 'fit',
          },
        ],
        width: '42px',
        height: '42px',
        cornerRadius: '12px',
        background: STYLE_C.GRADIENT.BLUE,
        justifyContent: 'center',
        alignItems: 'center',
      } as FlexBox,
      {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'text',
            text: data.productName,
            size: 'sm',
            color: STYLE_C.TEXT.PRIMARY,
            weight: 'bold',
            wrap: true,
          } as FlexComponent,
          {
            type: 'text',
            text: data.contractNumber,
            size: 'xxs',
            color: STYLE_C.TEXT.SECONDARY,
            margin: 'xs',
          } as FlexComponent,
        ],
        margin: 'md',
        flex: 1,
      } as FlexBox,
    ],
    backgroundColor: '#eef2ff',
    cornerRadius: '12px',
    paddingAll: '14px',
    alignItems: 'center',
    margin: 'lg',
  };

  const row = (label: string, value: string): FlexBox =>
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
        } as FlexComponent,
      ],
      margin: 'md',
    }) as FlexBox;

  // Loyalty points callout (amber gradient card)
  const loyaltyCallout: FlexBox = {
    type: 'box',
    layout: 'horizontal',
    contents: [
      {
        type: 'image',
        url: ICONS.GIFT,
        size: '18px',
        aspectRatio: '1:1',
        aspectMode: 'fit',
        flex: 0,
      },
      {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'text',
            text: `รับ ${data.loyaltyPointsEarned.toLocaleString()} แต้มสะสม`,
            size: 'sm',
            color: '#78350f',
            weight: 'bold',
          } as FlexComponent,
          {
            type: 'text',
            text: 'ใช้ส่วนลดดาวน์เครื่องใหม่ได้',
            size: 'xxs',
            color: '#92400e',
            margin: 'xs',
          } as FlexComponent,
        ],
        margin: 'md',
        flex: 1,
      } as FlexBox,
    ],
    backgroundColor: '#fef3c7',
    cornerRadius: '12px',
    paddingAll: '14px',
    alignItems: 'center',
    margin: 'lg',
  };

  const primaryAction = data.shopUrl
    ? ({ type: 'uri' as const, label: 'ดูเครื่องใหม่ ผ่อน 0%', uri: data.shopUrl })
    : ({ type: 'postback' as const, label: 'ดูเครื่องใหม่', data: 'action=browse_shop' });

  const secondaryAction = data.liffHistoryUrl
    ? ({ type: 'uri' as const, label: 'ดูประวัติสัญญา', uri: data.liffHistoryUrl })
    : ({ type: 'postback' as const, label: 'ดูประวัติสัญญา', data: 'action=view_completed' });

  const buttons = createStyleCButtons(
    'ดูเครื่องใหม่ ผ่อน 0%',
    primaryAction,
    STYLE_C.BUTTON.BLUE,
    'ดูประวัติสัญญา',
    secondaryAction,
  );

  const bubble: FlexBubble = {
    type: 'bubble',
    size: 'mega',
    header: createStyleCHeader(
      ICONS.CHECK_CIRCLE,
      'ยินดีด้วย! ผ่อนครบแล้ว',
      `คุณ${data.customerName} · กรรมสิทธิ์เครื่องเป็นของคุณแล้ว`,
      STYLE_C.GRADIENT.BLUE,
      { text: 'ปิดสัญญาครบ', bg: 'rgba(255,255,255,0.2)', textColor: '#FFFFFF' },
    ),
    body: {
      type: 'box',
      layout: 'vertical',
      contents: [
        productCard,
        row('ยอดรวมที่ชำระ', formatBaht(data.totalPaid)),
        row('จำนวนงวด', `${data.totalInstallments}/${data.totalInstallments}`),
        row('ระยะเวลาผ่อน', `${data.startDate} – ${data.endDate}`),
        { type: 'separator', margin: 'lg', color: '#e2e8f0' } as FlexComponent,
        loyaltyCallout,
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
    `ยินดีด้วย! สัญญา ${data.contractNumber} ชำระครบแล้ว รับ ${data.loyaltyPointsEarned.toLocaleString()} แต้ม`,
    bubble,
  );
}
