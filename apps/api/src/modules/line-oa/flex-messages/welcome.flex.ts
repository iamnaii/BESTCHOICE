import {
  FlexBubble,
  FlexMessagePayload,
  FlexComponent,
  COLORS,
  wrapFlexMessage,
} from './base-template';
import { STYLE_C, createStyleCHeader } from './style-c';
import { ICONS } from './icons';

export interface WelcomeFlexData {
  oaType: 'shop' | 'finance';
  liffRegisterUrl: string;
}

export function buildWelcomeFlex(data: WelcomeFlexData): FlexMessagePayload {
  const isShop = data.oaType === 'shop';

  const title = isShop ? 'ยินดีต้อนรับสู่ BESTCHOICE!' : 'สวัสดีค่ะ! BESTCHOICE FINANCE';
  const subtitle = isShop
    ? 'ร้านมือถือครบวงจร ผ่อนสบาย ดอกเบี้ยต่ำ'
    : 'จัดการสัญญาผ่อนชำระ ชำระค่างวด ดูประวัติ ได้ที่นี่เลย';

  const featureIcons = isShop
    ? [
        { icon: ICONS.SMARTPHONE, label: 'มือถือ\nครบทุกรุ่น' },
        { icon: ICONS.CALCULATOR, label: 'ผ่อนสบาย\nดาวน์น้อย' },
        { icon: ICONS.GIFT, label: 'ของแถม\nทุกสัญญา' },
      ]
    : [
        { icon: ICONS.CREDIT_CARD, label: 'ชำระ\nค่างวด' },
        { icon: ICONS.FILE_TEXT, label: 'ดู\nสัญญา' },
        { icon: ICONS.ACTIVITY, label: 'ประวัติ\nการชำระ' },
      ];

  const primaryButtonLabel = isShop ? '📋 ลงทะเบียนสัญญา' : '📋 ลงทะเบียนสัญญา';
  const secondaryButtonLabel = isShop ? '💬 วิธีชำระเงิน' : '💬 วิธีชำระเงิน';

  const bubble: FlexBubble = {
    type: 'bubble',
    size: 'mega',
    header: createStyleCHeader(
      isShop ? ICONS.SMARTPHONE : ICONS.CREDIT_CARD,
      title,
      subtitle,
      STYLE_C.GRADIENT.GREEN,
      { text: '✨ ยินดีต้อนรับ', bg: 'rgba(255,255,255,0.2)', textColor: '#FFFFFF' },
    ),
    body: {
      type: 'box',
      layout: 'vertical',
      contents: [
        // Feature icons row
        {
          type: 'box',
          layout: 'horizontal',
          contents: featureIcons.map((f) => ({
            type: 'box',
            layout: 'vertical',
            contents: [
              {
                type: 'image',
                url: f.icon,
                size: '32px',
                aspectRatio: '1:1',
                aspectMode: 'fit',
                align: 'center',
              },
              {
                type: 'text',
                text: f.label,
                size: 'xxs',
                color: STYLE_C.TEXT.SECONDARY,
                align: 'center',
                margin: 'sm',
                wrap: true,
              },
            ],
            backgroundColor: STYLE_C.INFO_CARD_BG.SUCCESS,
            cornerRadius: '10px',
            paddingAll: '12px',
            flex: 1,
            alignItems: 'center',
          })) as FlexComponent[],
          spacing: 'sm',
          margin: 'md',
        },
        // Tip text
        {
          type: 'box',
          layout: 'horizontal',
          contents: [
            {
              type: 'image',
              url: ICONS.INFO_CIRCLE,
              size: '16px',
              aspectRatio: '1:1',
              aspectMode: 'fit',
              flex: 0,
            },
            {
              type: 'text',
              text: isShop
                ? 'ลงทะเบียนเพื่อผูกบัญชี LINE กับสัญญาผ่อนของคุณ'
                : 'ลงทะเบียนเพื่อเช็คยอด ชำระค่างวด และดูประวัติได้ทันที',
              size: 'xs',
              color: STYLE_C.TEXT.SECONDARY,
              wrap: true,
              margin: 'sm',
              flex: 1,
            },
          ],
          backgroundColor: STYLE_C.HINT_CARD.GREEN,
          cornerRadius: '8px',
          paddingAll: '12px',
          margin: 'lg',
          alignItems: 'center',
        },
      ],
      paddingAll: '20px',
    },
    footer: {
      type: 'box',
      layout: 'vertical',
      contents: [
        {
          type: 'button',
          action: {
            type: 'uri',
            label: primaryButtonLabel,
            uri: data.liffRegisterUrl,
          },
          style: 'primary',
          color: STYLE_C.BUTTON.GREEN,
          height: 'sm',
        },
        {
          type: 'button',
          action: {
            type: 'message',
            label: secondaryButtonLabel,
            text: 'วิธีชำระเงิน',
          },
          style: 'secondary',
          height: 'sm',
          margin: 'sm',
        },
      ],
      paddingAll: '15px',
      spacing: 'sm',
    },
  };

  return wrapFlexMessage(
    isShop
      ? 'ยินดีต้อนรับสู่ BESTCHOICE! ร้านมือถือครบวงจร'
      : 'สวัสดีค่ะ! BESTCHOICE FINANCE จัดการสัญญาผ่อนชำระ',
    bubble,
  );
}

export function buildReWelcomeFlex(customerName: string): FlexMessagePayload {
  const bubble: FlexBubble = {
    type: 'bubble',
    size: 'kilo',
    body: {
      type: 'box',
      layout: 'horizontal',
      contents: [
        {
          type: 'image',
          url: ICONS.CHECK_CIRCLE,
          size: '28px',
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
              text: 'ยินดีต้อนรับกลับมา!',
              size: 'md',
              weight: 'bold',
              color: STYLE_C.TEXT.PRIMARY,
            },
            {
              type: 'text',
              text: `คุณ${customerName}`,
              size: 'sm',
              color: STYLE_C.BUTTON.GREEN,
              weight: 'bold',
              margin: 'xs',
            },
          ],
          margin: 'md',
          flex: 1,
        },
      ],
      backgroundColor: STYLE_C.INFO_CARD_BG.SUCCESS,
      cornerRadius: '12px',
      paddingAll: '16px',
      alignItems: 'center',
    },
  };

  return wrapFlexMessage(`ยินดีต้อนรับกลับมา คุณ${customerName}!`, bubble);
}
