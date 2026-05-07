import { FlexBubble, FlexMessagePayload, wrapFlexMessage } from './base-template';
import {
  buildPremiumBubble,
  createRow,
  createRowsBlock,
  createButton,
  createPill,
  STYLE_D,
} from './style-d';

export interface WelcomeFlexData {
  oaType: 'shop' | 'finance';
  liffRegisterUrl: string;
}

export function buildWelcomeFlex(data: WelcomeFlexData): FlexMessagePayload {
  const isShop = data.oaType === 'shop';

  const headline = isShop ? 'ยินดีต้อนรับสู่ BESTCHOICE' : 'BESTCHOICE FINANCE';
  const subtle = isShop
    ? 'ร้านมือถือครบวงจร · ผ่อนสบาย ดอกเบี้ยต่ำ'
    : 'จัดการสัญญาผ่อน · ชำระค่างวด · ดูประวัติ ได้ที่นี่';

  const featureRows = isShop
    ? [
        createRow('สินค้า', 'มือถือทุกรุ่น'),
        createRow('ผ่อน', 'ดาวน์น้อย ผ่อนสบาย'),
        createRow('ของแถม', 'ทุกสัญญา'),
      ]
    : [
        createRow('ชำระค่างวด', 'PromptPay QR · โอน'),
        createRow('ดูสัญญา', 'รายละเอียดผ่อนชำระ'),
        createRow('ประวัติ', 'การชำระย้อนหลัง'),
      ];

  const bubble = buildPremiumBubble({
    role: 'brand',
    tag: 'Welcome',
    section: {
      label: 'ลูกค้าใหม่',
      headline,
      subtle,
      pill: { text: 'พร้อมรับบริการ', role: 'success' },
    },
    body: [
      createRowsBlock(featureRows),
    ],
    buttons: [
      createButton('ลงทะเบียนสัญญา', { type: 'uri', label: 'ลงทะเบียนสัญญา', uri: data.liffRegisterUrl }, 'primary'),
      createButton('วิธีชำระเงิน', { type: 'message', label: 'วิธีชำระเงิน', text: 'วิธีชำระเงิน' } as never, 'outline'),
    ],
  });

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
      layout: 'vertical',
      contents: [
        {
          type: 'text',
          text: 'BESTCHOICE · FINANCE',
          size: 'xxs',
          color: STYLE_D.TEXT.HEAD,
          weight: 'bold',
        },
        {
          type: 'text',
          text: 'ยินดีต้อนรับกลับมา',
          size: 'lg',
          weight: 'bold',
          color: STYLE_D.TEXT.HEAD,
          margin: 'md',
        },
        {
          type: 'text',
          text: `คุณ${customerName}`,
          size: 'sm',
          color: STYLE_D.TEXT.LABEL,
          margin: 'xs',
        },
        {
          type: 'box',
          layout: 'horizontal',
          contents: [createPill('พร้อมรับบริการ', 'success', 'sm')],
          margin: 'md',
        },
      ],
      paddingAll: '20px',
    },
  };

  return wrapFlexMessage(`ยินดีต้อนรับกลับมา คุณ${customerName}!`, bubble);
}
