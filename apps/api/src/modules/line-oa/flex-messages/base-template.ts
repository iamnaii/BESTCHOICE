/**
 * LINE Flex Message Base Template & Utilities
 * Shared types and helpers for building Flex Messages
 */

// ─── Colors ─────────────────────────────────────────────
export const COLORS = {
  PRIMARY: '#1DB446',       // Green - brand / success
  DANGER: '#DD2C00',        // Red - overdue / urgent
  WARNING: '#FF6F00',       // Orange - warning
  INFO: '#0367D3',          // Blue - info
  MUTED: '#888888',         // Gray - secondary text
  DARK: '#333333',          // Dark - primary text
  LIGHT_BG: '#F5F5F5',     // Light gray - background
  WHITE: '#FFFFFF',
} as const;

// ─── Flex Message Types ─────────────────────────────────
export interface FlexMessagePayload {
  type: 'flex';
  altText: string;
  contents: FlexBubble | FlexCarousel;
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
    footer?: { backgroundColor?: string };
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
  backgroundColor?: string;
  cornerRadius?: string;
  flex?: number;
  justifyContent?: string;
  alignItems?: string;
  action?: FlexAction;
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

// ─── Helper Functions ───────────────────────────────────

/**
 * Create a colored header box
 */
export function createHeader(title: string, subtitle: string, color: string): FlexBox {
  return {
    type: 'box',
    layout: 'vertical',
    contents: [
      {
        type: 'text',
        text: 'BEST CHOICE',
        size: 'xs',
        color: '#FFFFFF',
        weight: 'bold',
      },
      {
        type: 'text',
        text: title,
        size: 'lg',
        color: '#FFFFFF',
        weight: 'bold',
        margin: 'sm',
      },
      {
        type: 'text',
        text: subtitle,
        size: 'xs',
        color: '#FFFFFFBB',
        margin: 'sm',
      },
    ],
    backgroundColor: color,
    paddingAll: '20px',
  };
}

/**
 * Create a detail row (label + value, horizontal)
 */
export function createDetailRow(label: string, value: string): FlexBox {
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
        color: COLORS.DARK,
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
 * Create an amount row with large text
 */
export function createAmountRow(label: string, amount: number, color: string): FlexBox {
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
        text: `${amount.toLocaleString()} บาท`,
        size: 'xl',
        color,
        weight: 'bold',
        align: 'end',
        flex: 0,
      },
    ],
    justifyContent: 'space-between',
    alignItems: 'center',
    margin: 'lg',
  };
}

/**
 * Create a URI button
 */
export function createUriButton(label: string, uri: string, color: string): FlexButton {
  return {
    type: 'button',
    action: {
      type: 'uri',
      label,
      uri,
    },
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
    action: {
      type: 'postback',
      label,
      data,
    },
    style: 'primary',
    color,
    height: 'sm',
  };
}

/**
 * Wrap a bubble in a Flex Message payload
 */
export function wrapFlexMessage(altText: string, bubble: FlexBubble): FlexMessagePayload {
  return {
    type: 'flex',
    altText,
    contents: bubble,
  };
}

/**
 * Format Thai Baht currency
 */
export function formatBaht(amount: number): string {
  return `${amount.toLocaleString('th-TH')} บาท`;
}
