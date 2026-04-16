/**
 * Style C Design System — LINE Flex Message Helpers
 * BESTCHOICE 2026 — Modern card-based visual language
 */

import {
  FlexBox,
  FlexText,
  FlexButton,
  FlexBubble,
  FlexComponent,
  FlexMessagePayload,
  FlexImage,
} from './base-template';

// Re-export to satisfy import — FlexIcon, FlexText used indirectly via FlexComponent
export type { FlexBox, FlexText, FlexButton, FlexBubble, FlexComponent, FlexMessagePayload, FlexImage };

// ─── Style C Color Palette ──────────────────────────────
export const STYLE_C = {
  GRADIENT: {
    GREEN: { type: 'linearGradient' as const, angle: '135deg', startColor: '#10b981', endColor: '#059669' },
    RED: { type: 'linearGradient' as const, angle: '135deg', startColor: '#ef4444', endColor: '#dc2626' },
    BLUE: { type: 'linearGradient' as const, angle: '135deg', startColor: '#3b82f6', endColor: '#2563eb' },
    ORANGE: { type: 'linearGradient' as const, angle: '135deg', startColor: '#f59e0b', endColor: '#ea580c' },
  },
  BADGE: {
    SUCCESS: { bg: '#dcfce7', text: '#16a34a' },
    DANGER: { bg: '#fee2e2', text: '#dc2626' },
    WARNING: { bg: '#fef3c7', text: '#d97706' },
    INFO: { bg: '#dbeafe', text: '#2563eb' },
  },
  INFO_CARD_BG: {
    DEFAULT: '#f8fafc',
    SUCCESS: '#f0fdf4',
    DANGER: '#fef2f2',
    WARNING: '#fffbeb',
  },
  INFO_CARD_BORDER: {
    SUCCESS: '#bbf7d0',
    DANGER: '#fecaca',
  },
  TEXT: {
    PRIMARY: '#1e293b',
    SECONDARY: '#64748b',
    MUTED: '#888888',
  },
  BUTTON: {
    GREEN: '#10b981',
    RED: '#dc2626',
    BLUE: '#3b82f6',
    SECONDARY_BORDER: '#e2e8f0',
  },
  PROGRESS: {
    BG: '#e2e8f0',
    GREEN: '#10b981',
    BLUE: '#3b82f6',
  },
  HINT_CARD: {
    GREEN: '#f0fdf4',
    YELLOW: '#fef3c7',
  },
  TIP_BOX: {
    ORANGE_BG: '#fff7ed',
    ORANGE_TEXT: '#c2410c',
  },
} as const;

// ─── Helper: createStyleCHeader ─────────────────────────
/**
 * Create Style C header with icon (44px rounded gradient bg) + title/subtitle + optional badge pill
 */
export function createStyleCHeader(
  iconUrl: string,
  title: string,
  subtitle: string,
  gradient: { type: 'linearGradient'; angle: string; startColor: string; endColor: string },
  badge?: { text: string; bg: string; textColor: string },
): FlexBox {
  const badgeComponents: FlexComponent[] = badge
    ? [
        {
          type: 'box',
          layout: 'horizontal',
          contents: [
            {
              type: 'text',
              text: badge.text,
              size: 'xs',
              color: badge.textColor,
              weight: 'bold',
            },
          ],
          backgroundColor: badge.bg,
          cornerRadius: '20px',
          paddingAll: '4px',
          paddingStart: '10px',
          paddingEnd: '10px',
          margin: 'sm',
        } as FlexBox,
      ]
    : [];

  return {
    type: 'box',
    layout: 'vertical',
    contents: [
      {
        type: 'box',
        layout: 'horizontal',
        contents: [
          // Icon with gradient background
          {
            type: 'box',
            layout: 'vertical',
            contents: [
              {
                type: 'image',
                url: iconUrl,
                size: '28px',
                aspectRatio: '1:1',
                aspectMode: 'fit',
              } as FlexImage,
            ],
            width: '44px',
            height: '44px',
            cornerRadius: '12px',
            background: gradient,
            justifyContent: 'center',
            alignItems: 'center',
          } as FlexBox,
          // Title + subtitle
          {
            type: 'box',
            layout: 'vertical',
            contents: [
              {
                type: 'text',
                text: title,
                size: 'lg',
                color: '#FFFFFF',
                weight: 'bold',
                wrap: true,
              } as FlexComponent,
              {
                type: 'text',
                text: subtitle,
                size: 'xs',
                color: '#FFFFFF99',
                wrap: true,
              } as FlexComponent,
              ...badgeComponents,
            ],
            margin: 'md',
            flex: 1,
          } as FlexBox,
        ],
        alignItems: 'center',
      },
    ],
    background: gradient,
    paddingAll: '20px',
    paddingBottom: '24px',
  };
}

// ─── Helper: createInfoCard ─────────────────────────────
/**
 * Create a rounded info card with top labels + amount + optional sub text
 */
export function createInfoCard(
  topLeft: string,
  topRight: string,
  amount: string,
  amountColor: string,
  subText?: string,
  subTextColor?: string,
  bgColor?: string,
  borderColor?: string,
): FlexBox {
  const subComponents: FlexComponent[] = subText
    ? [
        {
          type: 'text',
          text: subText,
          size: 'xs',
          color: subTextColor || STYLE_C.TEXT.MUTED,
          align: 'center',
          margin: 'sm',
          wrap: true,
        } as FlexComponent,
      ]
    : [];

  return {
    type: 'box',
    layout: 'vertical',
    contents: [
      {
        type: 'box',
        layout: 'horizontal',
        contents: [
          {
            type: 'text',
            text: topLeft,
            size: 'xs',
            color: STYLE_C.TEXT.SECONDARY,
            flex: 1,
          } as FlexComponent,
          {
            type: 'text',
            text: topRight,
            size: 'xs',
            color: STYLE_C.TEXT.SECONDARY,
            align: 'end',
            flex: 0,
          } as FlexComponent,
        ],
        justifyContent: 'space-between',
      } as FlexBox,
      {
        type: 'text',
        text: amount,
        size: 'xxl',
        color: amountColor,
        weight: 'bold',
        align: 'center',
        margin: 'md',
      } as FlexComponent,
      ...subComponents,
    ],
    backgroundColor: bgColor || STYLE_C.INFO_CARD_BG.DEFAULT,
    cornerRadius: '12px',
    paddingAll: '16px',
    margin: 'lg',
    ...(borderColor ? { borderColor, borderWidth: '1px' } : {}),
  };
}

// ─── Helper: createStyleCProgress ──────────────────────
/**
 * Create a progress bar (8px height) with paid/total count + optional labels
 */
export function createStyleCProgress(
  paidCount: number,
  totalCount: number,
  color: string,
  leftLabel?: string,
  rightLabel?: string,
): FlexBox {
  const pct = Math.min(100, Math.round((paidCount / totalCount) * 100));
  const displayLeft = leftLabel || `${paidCount}/${totalCount} งวด`;
  const displayRight = rightLabel || `${pct}%`;

  return {
    type: 'box',
    layout: 'vertical',
    contents: [
      // Labels row
      {
        type: 'box',
        layout: 'horizontal',
        contents: [
          {
            type: 'text',
            text: displayLeft,
            size: 'xs',
            color: STYLE_C.TEXT.SECONDARY,
          } as FlexComponent,
          {
            type: 'text',
            text: displayRight,
            size: 'xs',
            color,
            weight: 'bold',
            align: 'end',
          } as FlexComponent,
        ],
        justifyContent: 'space-between',
      } as FlexBox,
      // Track
      {
        type: 'box',
        layout: 'horizontal',
        contents: [
          // Filled portion
          {
            type: 'box',
            layout: 'vertical',
            contents: [{ type: 'filler' }],
            backgroundColor: color,
            height: '8px',
            cornerRadius: '4px',
            width: `${Math.max(pct, 2)}%`,
          } as FlexBox,
          // Empty portion
          ...(pct < 100
            ? [
                {
                  type: 'box',
                  layout: 'vertical',
                  contents: [{ type: 'filler' }],
                  backgroundColor: STYLE_C.PROGRESS.BG,
                  height: '8px',
                  cornerRadius: '4px',
                  width: `${100 - pct}%`,
                } as FlexBox,
              ]
            : []),
        ],
        margin: 'sm',
        spacing: 'none',
      } as FlexBox,
    ],
    margin: 'lg',
  };
}

// ─── Helper: createHintCards ────────────────────────────
/**
 * Create a row of 2-3 small stat cards
 */
export function createHintCards(
  cards: Array<{ label: string; value: string; bgColor: string }>,
): FlexBox {
  return {
    type: 'box',
    layout: 'horizontal',
    contents: cards.map((card) => ({
      type: 'box',
      layout: 'vertical',
      contents: [
        {
          type: 'text',
          text: card.value,
          size: 'sm',
          color: STYLE_C.TEXT.PRIMARY,
          weight: 'bold',
          align: 'center',
        } as FlexComponent,
        {
          type: 'text',
          text: card.label,
          size: 'xxs',
          color: STYLE_C.TEXT.SECONDARY,
          align: 'center',
          margin: 'xs',
          wrap: true,
        } as FlexComponent,
      ],
      backgroundColor: card.bgColor,
      cornerRadius: '10px',
      paddingAll: '12px',
      flex: 1,
    })) as FlexComponent[],
    spacing: 'sm',
    margin: 'lg',
  };
}

// ─── Helper: createTipBox ───────────────────────────────
/**
 * Create an info/warning tip box with icon + text
 */
export function createTipBox(
  iconUrl: string,
  text: string,
  bgColor: string,
  textColor: string,
): FlexBox {
  return {
    type: 'box',
    layout: 'horizontal',
    contents: [
      {
        type: 'image',
        url: iconUrl,
        size: '16px',
        aspectRatio: '1:1',
        aspectMode: 'fit',
        flex: 0,
      } as FlexImage,
      {
        type: 'text',
        text,
        size: 'xs',
        color: textColor,
        wrap: true,
        margin: 'sm',
        flex: 1,
      } as FlexComponent,
    ],
    backgroundColor: bgColor,
    cornerRadius: '8px',
    paddingAll: '12px',
    margin: 'lg',
    alignItems: 'center',
  };
}

// ─── Helper: createStyleCButtons ───────────────────────
/**
 * Create a button row with primary + optional secondary button
 */
export function createStyleCButtons(
  primaryLabel: string,
  primaryAction: { type: 'uri'; label: string; uri: string } | { type: 'postback'; label: string; data: string },
  primaryColor: string,
  secondaryLabel?: string,
  secondaryAction?: { type: 'uri'; label: string; uri: string } | { type: 'postback'; label: string; data: string },
): FlexBox {
  const buttons: FlexComponent[] = [
    {
      type: 'button',
      action: primaryAction,
      style: 'primary',
      color: primaryColor,
      height: 'sm',
      flex: secondaryLabel ? 1 : undefined,
    } as FlexButton,
  ];

  if (secondaryLabel && secondaryAction) {
    buttons.push({
      type: 'button',
      action: secondaryAction,
      style: 'secondary',
      height: 'sm',
      flex: 1,
    } as FlexButton);
  }

  return {
    type: 'box',
    layout: 'horizontal',
    contents: buttons,
    spacing: 'sm',
    margin: 'lg',
  };
}
