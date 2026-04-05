import {
  FlexBubble,
  FlexMessagePayload,
  COLORS,
  createHeader,
  createUriButton,
  wrapFlexMessage,
} from './base-template';

// ─── Promotion Flex ─────────────────────────────────────

export interface PromotionFlexData {
  title: string;
  subtitle: string;
  imageUrl?: string;
  ctaUrl?: string;
  ctaLabel?: string;
}

export function buildPromotionFlex(data: PromotionFlexData): FlexMessagePayload {
  const bubble: FlexBubble = {
    type: 'bubble',
    size: 'mega',
    header: createHeader('โปรโมชั่นพิเศษ', 'BEST CHOICE', COLORS.INFO),
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
      contents: [
        {
          type: 'text',
          text: data.title,
          size: 'xl',
          weight: 'bold',
          color: COLORS.DARK,
          wrap: true,
        },
        {
          type: 'text',
          text: data.subtitle,
          size: 'sm',
          color: COLORS.MUTED,
          wrap: true,
          margin: 'md',
        },
      ],
      paddingAll: '20px',
      spacing: 'sm',
    },
    ...(data.ctaUrl
      ? {
          footer: {
            type: 'box',
            layout: 'vertical',
            contents: [
              createUriButton(data.ctaLabel || 'ดูรายละเอียด', data.ctaUrl, COLORS.INFO),
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
    header: createHeader('ขอบคุณค่ะ', 'BEST CHOICE', COLORS.PRIMARY),
    body: {
      type: 'box',
      layout: 'vertical',
      contents: [
        {
          type: 'text',
          text: '🎉',
          size: '3xl',
          align: 'center',
        },
        {
          type: 'text',
          text: `ยินดีด้วยค่ะ คุณ${data.customerName}`,
          size: 'lg',
          weight: 'bold',
          color: COLORS.DARK,
          align: 'center',
          wrap: true,
          margin: 'md',
        },
        {
          type: 'text',
          text: data.message || 'ขอบคุณที่ชำระค่างวดครบถ้วน ขอบคุณที่ไว้วางใจ BEST CHOICE ค่ะ',
          size: 'sm',
          color: COLORS.MUTED,
          align: 'center',
          wrap: true,
          margin: 'lg',
        },
        {
          type: 'box',
          layout: 'vertical',
          contents: [
            {
              type: 'text',
              text: 'หากสนใจสินค้าใหม่ สามารถติดต่อสาขาได้เลยค่ะ',
              size: 'xs',
              color: COLORS.PRIMARY,
              align: 'center',
              wrap: true,
            },
          ],
          backgroundColor: '#E8F5E9',
          cornerRadius: '8px',
          paddingAll: '12px',
          margin: 'xl',
        },
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
}

export function buildNewProductFlex(data: NewProductFlexData): FlexMessagePayload {
  const bubble: FlexBubble = {
    type: 'bubble',
    size: 'mega',
    header: createHeader('สินค้าใหม่เข้าแล้ว!', 'BEST CHOICE', COLORS.WARNING),
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
      contents: [
        {
          type: 'text',
          text: data.productName,
          size: 'xl',
          weight: 'bold',
          color: COLORS.DARK,
          wrap: true,
        },
        ...(data.price
          ? [
              {
                type: 'text' as const,
                text: `ราคาเริ่มต้น ${data.price} บาท`,
                size: 'lg',
                color: COLORS.DANGER,
                weight: 'bold',
                margin: 'md',
              },
            ]
          : []),
        {
          type: 'text',
          text: 'ผ่อนสบาย 0% นาน 10 เดือน',
          size: 'sm',
          color: COLORS.MUTED,
          margin: 'sm',
          wrap: true,
        },
      ],
      paddingAll: '20px',
      spacing: 'sm',
    },
    footer: {
      type: 'box',
      layout: 'vertical',
      contents: [
        createUriButton(
          'ดูรายละเอียด',
          data.ctaUrl || 'https://bestchoice.com',
          COLORS.WARNING,
        ),
      ],
      paddingAll: '15px',
    },
  };

  return wrapFlexMessage(`สินค้าใหม่: ${data.productName}`, bubble);
}
