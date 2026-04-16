import {
  FlexBubble,
  FlexMessagePayload,
  FlexComponent,
  COLORS,
  wrapFlexMessage,
} from './base-template';
import {
  STYLE_C,
  createStyleCHeader,
  createHintCards,
  createTipBox,
  createStyleCButtons,
} from './style-c';
import { ICONS } from './icons';

// ─── Promotion Flex ─────────────────────────────────────

export interface PromotionFlexData {
  title: string;
  subtitle: string;
  imageUrl?: string;
  ctaUrl?: string;
  ctaLabel?: string;
}

export function buildPromotionFlex(data: PromotionFlexData): FlexMessagePayload {
  const bodyContents: FlexComponent[] = [
    {
      type: 'text',
      text: data.title,
      size: 'xl',
      weight: 'bold',
      color: STYLE_C.TEXT.PRIMARY,
      wrap: true,
    },
    {
      type: 'text',
      text: data.subtitle,
      size: 'sm',
      color: STYLE_C.TEXT.SECONDARY,
      wrap: true,
      margin: 'md',
    },
  ];

  const bubble: FlexBubble = {
    type: 'bubble',
    size: 'mega',
    header: createStyleCHeader(
      ICONS.GIFT,
      'โปรโมชั่นพิเศษ',
      'BEST CHOICE',
      STYLE_C.GRADIENT.ORANGE,
    ),
    ...(data.imageUrl
      ? {
          hero: {
            type: 'image',
            url: data.imageUrl,
            size: 'full',
            aspectRatio: '20:13',
            aspectMode: 'cover',
          },
        }
      : {}),
    body: {
      type: 'box',
      layout: 'vertical',
      contents: bodyContents,
      paddingAll: '20px',
      spacing: 'sm',
    },
    ...(data.ctaUrl
      ? {
          footer: {
            type: 'box',
            layout: 'vertical',
            contents: [
              createStyleCButtons(
                data.ctaLabel || 'สนใจสอบถาม',
                { type: 'uri', label: data.ctaLabel || 'สนใจสอบถาม', uri: data.ctaUrl },
                STYLE_C.BUTTON.GREEN,
              ),
            ],
            paddingAll: '15px',
          },
        }
      : {}),
  };

  return wrapFlexMessage(`โปรโมชั่น: ${data.title}`, bubble);
}

// ─── Thank You Flex ─────────────────────────────────────

export interface ThankYouFlexData {
  customerName: string;
  message?: string;
}

export function buildThankYouFlex(data: ThankYouFlexData): FlexMessagePayload {
  const bubble: FlexBubble = {
    type: 'bubble',
    size: 'mega',
    header: createStyleCHeader(
      ICONS.CHECK_CIRCLE,
      'ขอบคุณค่ะ',
      'BEST CHOICE',
      STYLE_C.GRADIENT.GREEN,
    ),
    body: {
      type: 'box',
      layout: 'vertical',
      contents: [
        {
          type: 'text',
          text: `ยินดีด้วยค่ะ คุณ${data.customerName}`,
          size: 'lg',
          weight: 'bold',
          color: STYLE_C.TEXT.PRIMARY,
          align: 'center',
          wrap: true,
        },
        {
          type: 'text',
          text: data.message || 'ขอบคุณที่ชำระค่างวดครบถ้วน ขอบคุณที่ไว้วางใจ BEST CHOICE ค่ะ',
          size: 'sm',
          color: STYLE_C.TEXT.SECONDARY,
          align: 'center',
          wrap: true,
          margin: 'lg',
        },
        createTipBox(
          ICONS.GIFT,
          'หากสนใจสินค้าใหม่ สามารถติดต่อสาขาได้เลยค่ะ',
          STYLE_C.INFO_CARD_BG.SUCCESS,
          STYLE_C.BUTTON.GREEN,
        ),
      ],
      paddingAll: '20px',
      spacing: 'sm',
    },
  };

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
  const bodyContents: FlexComponent[] = [
    {
      type: 'text',
      text: data.productName,
      size: 'xl',
      weight: 'bold',
      color: STYLE_C.TEXT.PRIMARY,
      wrap: true,
    },
    ...(data.price
      ? [
          {
            type: 'text' as const,
            text: `ราคาเริ่มต้น ${data.price} บาท`,
            size: 'lg' as const,
            color: COLORS.DANGER,
            weight: 'bold' as const,
            margin: 'md' as const,
          },
        ]
      : []),
  ];

  // Hint cards for down/monthly
  if (data.downPayment || data.monthlyPayment) {
    const cards: Array<{ label: string; value: string; bgColor: string }> = [];
    if (data.downPayment) {
      cards.push({ label: 'ดาวน์', value: data.downPayment, bgColor: STYLE_C.HINT_CARD.GREEN });
    }
    if (data.monthlyPayment) {
      cards.push({
        label: 'ผ่อนต่อเดือน',
        value: data.monthlyPayment,
        bgColor: STYLE_C.HINT_CARD.YELLOW,
      });
    }
    if (cards.length > 0) {
      bodyContents.push(createHintCards(cards));
    }
  } else {
    bodyContents.push({
      type: 'text',
      text: 'ผ่อนสบาย 0% นาน 10 เดือน',
      size: 'sm',
      color: STYLE_C.TEXT.SECONDARY,
      margin: 'sm',
      wrap: true,
    });
  }

  // Tip box for freebie
  if (data.freebie) {
    bodyContents.push(
      createTipBox(
        ICONS.GIFT,
        `ของแถม: ${data.freebie}`,
        STYLE_C.TIP_BOX.ORANGE_BG,
        STYLE_C.TIP_BOX.ORANGE_TEXT,
      ),
    );
  }

  const bubble: FlexBubble = {
    type: 'bubble',
    size: 'mega',
    header: createStyleCHeader(
      ICONS.SMARTPHONE,
      'สินค้าใหม่เข้าแล้ว',
      'BEST CHOICE',
      STYLE_C.GRADIENT.ORANGE,
    ),
    ...(data.imageUrl
      ? {
          hero: {
            type: 'image',
            url: data.imageUrl,
            size: 'full',
            aspectRatio: '20:13',
            aspectMode: 'cover',
          },
        }
      : {}),
    body: {
      type: 'box',
      layout: 'vertical',
      contents: bodyContents,
      paddingAll: '20px',
      spacing: 'sm',
    },
    footer: {
      type: 'box',
      layout: 'vertical',
      contents: [
        createStyleCButtons(
          'สนใจสอบถาม',
          { type: 'uri', label: 'สนใจสอบถาม', uri: data.ctaUrl || 'https://bestchoice.com' },
          STYLE_C.BUTTON.GREEN,
        ),
      ],
      paddingAll: '15px',
    },
  };

  return wrapFlexMessage(`สินค้าใหม่: ${data.productName}`, bubble);
}
