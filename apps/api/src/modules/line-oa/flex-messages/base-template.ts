/**
 * LINE Flex Message Base Template & Utilities
 * BESTCHOICE Design System — 2026 Brand Refresh
 */

// ─── Brand Colors ──────────────────────────────────────
export const COLORS = {
  // Primary brand
  PRIMARY: '#1DB446',
  PRIMARY_DARK: '#158C36',
  PRIMARY_LIGHT: '#E8F5E9',

  // Semantic
  DANGER: '#DD2C00',
  DANGER_LIGHT: '#FFF3F0',
  WARNING: '#FF6F00',
  WARNING_LIGHT: '#FFF8E1',
  INFO: '#0367D3',
  INFO_LIGHT: '#E3F2FD',
  SUCCESS: '#1DB446',
  SUCCESS_LIGHT: '#E8F5E9',

  // Neutral
  DARK: '#1A1A2E',
  TEXT: '#333333',
  MUTED: '#888888',
  SUBTLE: '#AAAAAA',
  BORDER: '#EEEEEE',
  LIGHT_BG: '#F7F8FA',
  WHITE: '#FFFFFF',
} as const;

// ─── Gradient Backgrounds ──────────────────────────────
export const GRADIENTS = {
  GREEN: { type: 'linearGradient' as const, angle: '135deg', startColor: '#1DB446', endColor: '#0D8A36' },
  RED: { type: 'linearGradient' as const, angle: '135deg', startColor: '#E53935', endColor: '#C62828' },
  ORANGE: { type: 'linearGradient' as const, angle: '135deg', startColor: '#FF8F00', endColor: '#E65100' },
  BLUE: { type: 'linearGradient' as const, angle: '135deg', startColor: '#1E88E5', endColor: '#1565C0' },
  DARK: { type: 'linearGradient' as const, angle: '135deg', startColor: '#2C3E50', endColor: '#1A1A2E' },
};

// ─── Flex Message Types ─────────────────────────────────
export interface FlexMessagePayload {
  type: 'flex';
  altText: string;
  contents: FlexBubble | FlexCarousel;
  quickReply?: {
    items: Array<{
      type: 'action';
      action:
        | { type: 'message'; label: string; text: string }
        | { type: 'uri'; label: string; uri: string }
        | { type: 'postback'; label: string; data: string; displayText?: string };
    }>;
  };
}

export interface FlexBubble {
  type: 'bubble';
  size?: 'nano' | 'micro' | 'kilo' | 'mega' | 'giga';
  header?: FlexBox;
  hero?: FlexImage;
  body?: FlexBox;
  footer?: FlexBox;
  styles?: {
    header?: { backgroundColor?: string };
    hero?: { backgroundColor?: string };
    body?: { backgroundColor?: string };
    footer?: { backgroundColor?: string; separator?: boolean };
  };
}

export interface FlexCarousel {
  type: 'carousel';
  contents: FlexBubble[];
}

export interface FlexBox {
  type: 'box';
  layout: 'horizontal' | 'vertical' | 'baseline';
  contents: FlexComponent[];
  spacing?: string;
  margin?: string;
  paddingAll?: string;
  paddingTop?: string;
  paddingBottom?: string;
  paddingStart?: string;
  paddingEnd?: string;
  backgroundColor?: string;
  background?: { type: string; angle?: string; startColor?: string; endColor?: string };
  cornerRadius?: string;
  flex?: number;
  justifyContent?: string;
  alignItems?: string;
  action?: FlexAction;
  width?: string;
  height?: string;
  borderColor?: string;
  borderWidth?: string;
}

export interface FlexText {
  type: 'text';
  text: string;
  size?: string;
  weight?: string;
  color?: string;
  align?: string;
  wrap?: boolean;
  margin?: string;
  flex?: number;
  decoration?: string;
  offsetTop?: string;
}

export interface FlexImage {
  type: 'image';
  url: string;
  size?: string;
  aspectRatio?: string;
  aspectMode?: string;
  margin?: string;
  flex?: number;
}

export interface FlexButton {
  type: 'button';
  action: FlexAction;
  style?: 'primary' | 'secondary' | 'link';
  color?: string;
  height?: string;
  margin?: string;
}

export interface FlexSeparator {
  type: 'separator';
  margin?: string;
  color?: string;
}

export interface FlexFiller {
  type: 'filler';
  flex?: number;
}

export interface FlexIcon {
  type: 'icon';
  url: string;
  size?: string;
  margin?: string;
}

export type FlexComponent = FlexBox | FlexText | FlexImage | FlexButton | FlexSeparator | FlexFiller | FlexIcon;

export interface FlexAction {
  type: 'uri' | 'postback' | 'message';
  label: string;
  uri?: string;
  data?: string;
  text?: string;
}

// ─── New Design System Helpers ─────────────────────────

/**
 * Create a gradient header with brand logo text + title + subtitle.
 * Accepts either a gradient object or a plain color string for backward compatibility.
 */
export function createHeader(
  title: string,
  subtitle: string,
  colorOrGradient: string | typeof GRADIENTS[keyof typeof GRADIENTS],
): FlexBox {
  const isGradient = typeof colorOrGradient === 'object';
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
            text: '◆',
            size: 'sm',
            color: '#FFFFFF',
          },
          {
            type: 'text',
            text: 'BEST CHOICE',
            size: 'xs',
            color: '#FFFFFFCC',
            weight: 'bold',
            margin: 'sm',
          },
        ],
        alignItems: 'center',
      },
      {
        type: 'text',
        text: title,
        size: 'xl',
        color: '#FFFFFF',
        weight: 'bold',
        margin: 'md',
      },
      {
        type: 'text',
        text: subtitle,
        size: 'xs',
        color: '#FFFFFF99',
        margin: 'sm',
      },
    ],
    ...(isGradient
      ? { background: colorOrGradient }
      : { backgroundColor: colorOrGradient as string }),
    paddingAll: '20px',
    paddingBottom: '24px',
  };
}

/**
 * Create a detail row (label + value)
 */
export function createDetailRow(label: string, value: string, valueColor?: string): FlexBox {
  return {
    type: 'box',
    layout: 'horizontal',
    contents: [
      {
        type: 'text',
        text: label,
        size: 'sm',
        color: COLORS.MUTED,
        flex: 0,
      },
      {
        type: 'text',
        text: value,
        size: 'sm',
        color: valueColor || COLORS.TEXT,
        align: 'end',
        weight: 'bold',
        flex: 0,
      },
    ],
    justifyContent: 'space-between',
    margin: 'md',
  };
}

/**
 * Create a large amount display with label
 */
export function createAmountRow(label: string, amount: number, color: string): FlexBox {
  return {
    type: 'box',
    layout: 'vertical',
    contents: [
      {
        type: 'text',
        text: label,
        size: 'xs',
        color: COLORS.MUTED,
        align: 'center',
      },
      {
        type: 'text',
        text: `฿${amount.toLocaleString()}`,
        size: 'xxl',
        color,
        weight: 'bold',
        align: 'center',
        margin: 'sm',
      },
    ],
    backgroundColor: color === COLORS.DANGER ? COLORS.DANGER_LIGHT : COLORS.SUCCESS_LIGHT,
    cornerRadius: '12px',
    paddingAll: '16px',
    margin: 'lg',
  };
}

/**
 * Create a progress bar (e.g., 3/12 installments paid)
 */
export function createProgressBar(current: number, total: number, color: string): FlexBox {
  const pct = Math.min(100, Math.round((current / total) * 100));
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
            text: `${current}/${total} งวด`,
            size: 'xs',
            color: COLORS.MUTED,
          },
          {
            type: 'text',
            text: `${pct}%`,
            size: 'xs',
            color,
            weight: 'bold',
            align: 'end',
          },
        ],
      },
      // Track
      {
        type: 'box',
        layout: 'horizontal',
        contents: [
          // Filled
          {
            type: 'box',
            layout: 'vertical',
            contents: [{ type: 'filler' }],
            backgroundColor: color,
            height: '6px',
            cornerRadius: '3px',
            width: `${Math.max(pct, 3)}%`,
          },
          // Empty
          ...(pct < 100 ? [{
            type: 'box' as const,
            layout: 'vertical' as const,
            contents: [{ type: 'filler' as const }],
            backgroundColor: '#E0E0E0',
            height: '6px',
            cornerRadius: '3px',
            width: `${100 - pct}%`,
          }] : []),
        ],
        margin: 'sm',
        spacing: 'none',
      },
    ],
    margin: 'lg',
  };
}

/**
 * Create a status badge
 */
export function createBadge(text: string, bgColor: string, textColor: string): FlexBox {
  return {
    type: 'box',
    layout: 'horizontal',
    contents: [
      {
        type: 'text',
        text,
        size: 'xs',
        color: textColor,
        weight: 'bold',
        align: 'center',
      },
    ],
    backgroundColor: bgColor,
    cornerRadius: '20px',
    paddingAll: '6px',
    paddingStart: '12px',
    paddingEnd: '12px',
    width: 'auto' as unknown as string,
  };
}

/**
 * Create a URI button with rounded style
 */
export function createUriButton(label: string, uri: string, color: string): FlexButton {
  return {
    type: 'button',
    action: { type: 'uri', label, uri },
    style: 'primary',
    color,
    height: 'sm',
  };
}

/**
 * Create a postback button
 */
export function createPostbackButton(label: string, data: string, color: string): FlexButton {
  return {
    type: 'button',
    action: { type: 'postback', label, data },
    style: 'primary',
    color,
    height: 'sm',
  };
}

/**
 * Wrap a bubble in a Flex Message payload
 */
export function wrapFlexMessage(altText: string, bubble: FlexBubble): FlexMessagePayload {
  return { type: 'flex', altText, contents: bubble };
}

/**
 * Format Thai Baht currency
 */
export function formatBaht(amount: number): string {
  return `฿${amount.toLocaleString('th-TH')}`;
}

export { STYLE_C } from './style-c';
export { ICONS } from './icons';
