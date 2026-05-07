import { FlexBubble, FlexMessagePayload, FlexComponent, wrapFlexMessage } from './base-template';
import {
  buildPremiumBubble,
  createRow,
  createRowsBlock,
  createButton,
  createPill,
  type FlexBox,
} from './style-d';

// ─── Promotion Flex ─────────────────────────────────────

export interface PromotionFlexData {
  title: string;
  subtitle: string;
  imageUrl?: string;
  ctaUrl?: string;
  ctaLabel?: string;
}

export function buildPromotionFlex(data: PromotionFlexData): FlexMessagePayload {
  const bubble = buildPremiumBubble({
    role: 'payoff',
    tag: 'Promotion',
    section: {
      label: 'โปรโมชั่นพิเศษ',
      headline: data.title,
      subtle: data.subtitle,
    },
    body: [],
    buttons: data.ctaUrl
      ? [createButton(data.ctaLabel || 'สนใจสอบถาม', { type: 'uri', label: data.ctaLabel || 'สนใจสอบถาม', uri: data.ctaUrl }, 'payoff')]
      : undefined,
  });

  if (data.imageUrl) {
    bubble.hero = {
      type: 'image',
      url: data.imageUrl,
      size: 'full',
      aspectRatio: '20:13',
      aspectMode: 'cover',
    };
  }

  return wrapFlexMessage(`โปรโมชั่น: ${data.title}`, bubble);
}

// ─── Thank You Flex ─────────────────────────────────────

export interface ThankYouFlexData {
  customerName: string;
  message?: string;
}

export function buildThankYouFlex(data: ThankYouFlexData): FlexMessagePayload {
  const bubble = buildPremiumBubble({
    role: 'success',
    tag: 'Thank You',
    section: {
      label: 'ขอบคุณค่ะ',
      headline: `คุณ${data.customerName}`,
      subtle: data.message || 'ขอบคุณที่ชำระค่างวดครบถ้วน · ขอบคุณที่ไว้วางใจ BESTCHOICE',
      pill: { text: 'หากสนใจสินค้าใหม่ ติดต่อสาขาได้เลย', role: 'success' },
    },
    body: [],
  });

  return wrapFlexMessage(`ขอบคุณ คุณ${data.customerName}`, bubble);
}

// ─── New Product Flex ───────────────────────────────────

export interface NewProductFlexData {
  productName: string;
  imageUrl?: string;
  price?: string;
  ctaUrl?: string;
  downPayment?: string;
  monthlyPayment?: string;
  freebie?: string;
}

export function buildNewProductFlex(data: NewProductFlexData): FlexMessagePayload {
  const rows: FlexBox[] = [];
  if (data.price) rows.push(createRow('ราคา', `${data.price} ฿`, { valueColor: '#dc2626' }));
  if (data.downPayment) rows.push(createRow('ดาวน์', data.downPayment, { valueColor: '#047857' }));
  if (data.monthlyPayment) rows.push(createRow('ผ่อน/เดือน', data.monthlyPayment, { valueColor: '#c2410c' }));
  if (!data.downPayment && !data.monthlyPayment && !data.price) {
    rows.push(createRow('โปรโมชั่น', 'ผ่อน 0% · 10 เดือน'));
  }

  const body: FlexComponent[] = rows.length > 0 ? [createRowsBlock(rows)] : [];

  if (data.freebie) {
    body.push({
      type: 'box',
      layout: 'vertical',
      contents: [
        {
          type: 'box',
          layout: 'horizontal',
          contents: [createPill(`🎁 ของแถม: ${data.freebie}`, 'payoff', 'sm')],
          justifyContent: 'center',
        },
      ],
      paddingStart: '20px',
      paddingEnd: '20px',
      margin: 'md',
    });
  }

  const bubble: FlexBubble = buildPremiumBubble({
    role: 'payoff',
    tag: 'New Product',
    section: {
      label: 'สินค้าใหม่เข้าแล้ว',
      headline: data.productName,
    },
    body,
    buttons: [
      createButton('สนใจสอบถาม', { type: 'uri', label: 'สนใจสอบถาม', uri: data.ctaUrl || 'https://bestchoice.com' }, 'payoff'),
    ],
  });

  if (data.imageUrl) {
    bubble.hero = {
      type: 'image',
      url: data.imageUrl,
      size: 'full',
      aspectRatio: '20:13',
      aspectMode: 'cover',
    };
  }

  return wrapFlexMessage(`สินค้าใหม่: ${data.productName}`, bubble);
}
