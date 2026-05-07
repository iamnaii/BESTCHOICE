/**
 * Style D Design System — LINE Flex Message Helpers (Premium Thai)
 * BESTCHOICE 2026 — Apple-clean + Thai warmth
 *
 * Layout pattern per bubble:
 *   1. brand strip   — "BESTCHOICE · FINANCE" + role tag (uppercase, small)
 *   2. status bar    — 3px thin gradient bar in role color
 *   3. section       — label + headline + optional subtle + optional pill
 *   4. hero amount   — big number (4xl/5xl) on tinted backplate
 *   5. rows          — divider 1px, label gray + value bold
 *   6. qr section    — light gray frame around QR (no decoration)
 *   7. footer        — meta + ref number on subtle bg
 *   8. buttons       — primary / success / danger / payoff / outline
 *
 * Role tokens:
 *   success  — green   (paid, completed, brand-positive)
 *   warn     — amber   (urgent today, attention)
 *   danger   — red     (overdue, error)
 *   info     — blue    (reminder, neutral state)
 *   payoff   — orange  (early payoff discount, time-sensitive offers)
 *   brand    — emerald (welcome, neutral brand)
 */

import {
  FlexBox,
  FlexText,
  FlexButton,
  FlexBubble,
  FlexComponent,
  FlexMessagePayload,
  FlexImage,
  FlexSeparator,
} from './base-template';

export type {
  FlexBox,
  FlexText,
  FlexButton,
  FlexBubble,
  FlexComponent,
  FlexMessagePayload,
  FlexImage,
  FlexSeparator,
};

// ─── Style D Token Set ──────────────────────────────────
export type Role = 'success' | 'warn' | 'danger' | 'info' | 'payoff' | 'brand';

export const STYLE_D = {
  // Solid colors per role (used for status bars, pills, amounts, buttons)
  ROLE: {
    success: {
      bar: { type: 'linearGradient' as const, angle: '90deg', startColor: '#10b981', endColor: '#34d399' },
      pillBg: '#ecfdf5',
      pillText: '#047857',
      heroBg: '#f0fdf4',
      amount: '#047857',
      labelText: '#047857',
      tag: '#047857',
      buttonBg: '#047857',
      buttonText: '#FFFFFF',
    },
    warn: {
      bar: { type: 'linearGradient' as const, angle: '90deg', startColor: '#f59e0b', endColor: '#fbbf24' },
      pillBg: '#fef3c7',
      pillText: '#92400e',
      heroBg: '#fffbeb',
      amount: '#b45309',
      labelText: '#b45309',
      tag: '#b45309',
      buttonBg: '#b45309',
      buttonText: '#FFFFFF',
    },
    danger: {
      bar: { type: 'linearGradient' as const, angle: '90deg', startColor: '#ef4444', endColor: '#f87171' },
      pillBg: '#fef2f2',
      pillText: '#dc2626',
      heroBg: '#fef2f2',
      amount: '#dc2626',
      labelText: '#dc2626',
      tag: '#dc2626',
      buttonBg: '#dc2626',
      buttonText: '#FFFFFF',
    },
    info: {
      bar: { type: 'linearGradient' as const, angle: '90deg', startColor: '#3b82f6', endColor: '#60a5fa' },
      pillBg: '#eff6ff',
      pillText: '#1d4ed8',
      heroBg: '#eff6ff',
      amount: '#1d4ed8',
      labelText: '#1d4ed8',
      tag: '#1d4ed8',
      buttonBg: '#1d4ed8',
      buttonText: '#FFFFFF',
    },
    payoff: {
      bar: { type: 'linearGradient' as const, angle: '90deg', startColor: '#ea580c', endColor: '#f59e0b' },
      pillBg: '#fff7ed',
      pillText: '#c2410c',
      heroBg: '#fff7ed',
      amount: '#c2410c',
      labelText: '#c2410c',
      tag: '#c2410c',
      buttonBg: '#c2410c',
      buttonText: '#FFFFFF',
    },
    brand: {
      bar: { type: 'linearGradient' as const, angle: '90deg', startColor: '#059669', endColor: '#10b981' },
      pillBg: '#ecfdf5',
      pillText: '#047857',
      heroBg: '#f0fdf4',
      amount: '#0f172a',
      labelText: '#475569',
      tag: '#475569',
      buttonBg: '#0f172a',
      buttonText: '#FFFFFF',
    },
  },

  // Neutral palette
  TEXT: {
    HEAD: '#0f172a',         // headline near-black
    BODY: '#1e293b',         // body strong
    LABEL: '#64748b',        // row label gray
    MUTED: '#94a3b8',        // subtle / mute
    DIM: '#cbd5e1',          // very low contrast
  },
  BG: {
    BUBBLE: '#FFFFFF',
    QR_FRAME: '#fafafa',
    FOOTER: '#fafafa',
  },
  BORDER: {
    DIVIDER: '#f1f5f9',
    SUBTLE: '#e2e8f0',
  },
  BUTTON_OUTLINE_BORDER: '#e2e8f0',
} as const;

// ─── Helper: createBrandStrip ──────────────────────────
/**
 * Top brand strip: "BESTCHOICE · FINANCE" left + role tag uppercase right.
 * Sits ABOVE the status bar, no background (transparent on bubble white).
 */
export function createBrandStrip(role: Role, tag: string): FlexBox {
  const r = STYLE_D.ROLE[role];
  return {
    type: 'box',
    layout: 'horizontal',
    contents: [
      {
        type: 'text',
        text: 'BESTCHOICE · FINANCE',
        size: 'xxs',
        color: STYLE_D.TEXT.HEAD,
        weight: 'bold',
        flex: 1,
      } as FlexComponent,
      {
        type: 'text',
        text: tag.toUpperCase(),
        size: 'xxs',
        color: r.tag,
        weight: 'bold',
        align: 'end',
        flex: 0,
      } as FlexComponent,
    ],
    paddingTop: '14px',
    paddingStart: '20px',
    paddingEnd: '20px',
  } as FlexBox;
}

// ─── Helper: createStatusBar ───────────────────────────
/**
 * 3px thin gradient bar in role color. Sits below brand strip, above section.
 */
export function createStatusBar(role: Role): FlexBox {
  const r = STYLE_D.ROLE[role];
  return {
    type: 'box',
    layout: 'vertical',
    contents: [{ type: 'filler' }],
    background: r.bar,
    height: '3px',
    cornerRadius: '2px',
    width: '100%',
    paddingTop: '0px',
    paddingStart: '20px',
    paddingEnd: '20px',
  } as FlexBox;
}

// ─── Helper: createSectionHeader ───────────────────────
/**
 * Section after status bar: small uppercase label + headline + optional subtle + optional pill.
 */
export function createSectionHeader(
  role: Role,
  label: string,
  headline: string,
  subtle?: string,
  pill?: { text: string; role?: Role },
): FlexBox {
  const r = STYLE_D.ROLE[role];
  const contents: FlexComponent[] = [
    {
      type: 'text',
      text: label,
      size: 'xxs',
      color: r.labelText,
      weight: 'bold',
    } as FlexComponent,
    {
      type: 'text',
      text: headline,
      size: 'lg',
      color: STYLE_D.TEXT.HEAD,
      weight: 'bold',
      wrap: true,
      margin: 'xs',
    } as FlexComponent,
  ];
  if (subtle) {
    contents.push({
      type: 'text',
      text: subtle,
      size: 'sm',
      color: STYLE_D.TEXT.LABEL,
      wrap: true,
      margin: 'xs',
    } as FlexComponent);
  }
  if (pill) {
    contents.push(createPill(pill.text, pill.role ?? role, 'md'));
  }
  return {
    type: 'box',
    layout: 'vertical',
    contents,
    paddingTop: '16px',
    paddingStart: '20px',
    paddingEnd: '20px',
  } as FlexBox;
}

// ─── Helper: createPill ────────────────────────────────
/**
 * Pill chip: rounded badge with role-colored bg + text.
 */
export function createPill(text: string, role: Role, margin: 'sm' | 'md' | 'lg' = 'sm'): FlexBox {
  const r = STYLE_D.ROLE[role];
  return {
    type: 'box',
    layout: 'horizontal',
    contents: [
      {
        type: 'text',
        text,
        size: 'xxs',
        color: r.pillText,
        weight: 'bold',
        align: 'center',
      } as FlexComponent,
    ],
    backgroundColor: r.pillBg,
    cornerRadius: '100px',
    paddingAll: '6px',
    paddingStart: '12px',
    paddingEnd: '12px',
    margin,
    flex: 0,
  } as FlexBox;
}

// ─── Helper: createHeroAmount ──────────────────────────
/**
 * Big hero amount section. Tinted backplate in role color + optional label cap above + optional pill below.
 */
export function createHeroAmount(
  role: Role,
  amount: string,
  options?: {
    cap?: string;
    pill?: { text: string; role?: Role };
    savingsBadge?: string; // emerald gradient style — for early-payoff "ประหยัด X฿"
  },
): FlexBox {
  const r = STYLE_D.ROLE[role];
  const contents: FlexComponent[] = [];

  if (options?.cap) {
    contents.push({
      type: 'text',
      text: options.cap,
      size: 'xxs',
      color: STYLE_D.TEXT.LABEL,
      weight: 'bold',
      align: 'center',
    } as FlexComponent);
  }

  contents.push({
    type: 'text',
    text: amount,
    size: '4xl',
    color: r.amount,
    weight: 'bold',
    align: 'center',
    margin: options?.cap ? 'sm' : 'none',
  } as FlexComponent);

  if (options?.pill) {
    contents.push({
      type: 'box',
      layout: 'horizontal',
      contents: [createPill(options.pill.text, options.pill.role ?? role, 'sm')],
      justifyContent: 'center',
      margin: 'md',
    } as FlexBox);
  }

  if (options?.savingsBadge) {
    contents.push({
      type: 'box',
      layout: 'horizontal',
      contents: [
        {
          type: 'text',
          text: options.savingsBadge,
          size: 'xxs',
          color: '#FFFFFF',
          weight: 'bold',
          align: 'center',
        } as FlexComponent,
      ],
      backgroundColor: '#059669',
      cornerRadius: '100px',
      paddingAll: '7px',
      paddingStart: '14px',
      paddingEnd: '14px',
      margin: 'md',
      flex: 0,
    } as FlexBox);
  }

  return {
    type: 'box',
    layout: 'vertical',
    contents,
    backgroundColor: r.heroBg,
    cornerRadius: '12px',
    paddingAll: '20px',
    margin: 'lg',
  } as FlexBox;
}

// ─── Helper: createRow ─────────────────────────────────
/**
 * Single row: label left + value right. Used inside createRowsBlock.
 */
export function createRow(
  label: string,
  value: string,
  options?: { valueColor?: string; valueDecoration?: 'line-through' },
): FlexBox {
  return {
    type: 'box',
    layout: 'horizontal',
    contents: [
      {
        type: 'text',
        text: label,
        size: 'sm',
        color: STYLE_D.TEXT.LABEL,
        flex: 1,
      } as FlexComponent,
      {
        type: 'text',
        text: value,
        size: 'sm',
        color: options?.valueColor ?? STYLE_D.TEXT.HEAD,
        weight: 'bold',
        align: 'end',
        flex: 0,
        ...(options?.valueDecoration ? { decoration: options.valueDecoration } : {}),
      } as FlexComponent,
    ],
    paddingTop: '10px',
    paddingBottom: '10px',
  } as FlexBox;
}

// ─── Helper: createRowsBlock ───────────────────────────
/**
 * Block of rows separated by 1px dividers. Wrap createRow rows with separators between.
 */
export function createRowsBlock(rows: FlexBox[]): FlexBox {
  const contents: FlexComponent[] = [];
  rows.forEach((row, idx) => {
    if (idx > 0) {
      contents.push({
        type: 'separator',
        color: STYLE_D.BORDER.DIVIDER,
      } as FlexSeparator);
    }
    contents.push(row);
  });
  return {
    type: 'box',
    layout: 'vertical',
    contents,
    paddingStart: '20px',
    paddingEnd: '20px',
    margin: 'md',
  } as FlexBox;
}

// ─── Helper: createQRSection ───────────────────────────
/**
 * QR image inside a soft gray frame + tip text below. No decoration.
 */
export function createQRSection(qrImageUrl: string, tip?: string): FlexBox {
  const contents: FlexComponent[] = [
    {
      type: 'image',
      url: qrImageUrl,
      size: 'full',
      aspectRatio: '1:1',
      aspectMode: 'fit',
    } as FlexImage,
  ];
  if (tip) {
    contents.push({
      type: 'text',
      text: tip,
      size: 'xs',
      color: STYLE_D.TEXT.BODY,
      align: 'center',
      weight: 'bold',
      margin: 'md',
      wrap: true,
    } as FlexComponent);
  }
  return {
    type: 'box',
    layout: 'vertical',
    contents,
    backgroundColor: STYLE_D.BG.QR_FRAME,
    cornerRadius: '12px',
    paddingAll: '18px',
    margin: 'lg',
  } as FlexBox;
}

// ─── Helper: createProgressBar ─────────────────────────
/**
 * Slim progress bar (4px) — uppercase meta labels + role-colored fill.
 */
export function createProgressBar(
  current: number,
  total: number,
  role: Role = 'brand',
  options?: { leftLabel?: string; rightLabel?: string },
): FlexBox {
  const pct = Math.min(100, Math.max(0, Math.round((current / total) * 100)));
  const left = options?.leftLabel ?? 'ความคืบหน้า';
  const right = options?.rightLabel ?? `${current} / ${total} งวด`;
  const r = STYLE_D.ROLE[role];
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
            text: left,
            size: 'xxs',
            color: STYLE_D.TEXT.LABEL,
            weight: 'bold',
          } as FlexComponent,
          {
            type: 'text',
            text: right,
            size: 'xxs',
            color: STYLE_D.TEXT.LABEL,
            weight: 'bold',
            align: 'end',
          } as FlexComponent,
        ],
      } as FlexBox,
      {
        type: 'box',
        layout: 'horizontal',
        contents: [
          {
            type: 'box',
            layout: 'vertical',
            contents: [{ type: 'filler' }],
            background: r.bar,
            height: '4px',
            cornerRadius: '2px',
            width: `${Math.max(pct, 2)}%`,
          } as FlexBox,
          ...(pct < 100
            ? [
                {
                  type: 'box',
                  layout: 'vertical',
                  contents: [{ type: 'filler' }],
                  backgroundColor: STYLE_D.BORDER.DIVIDER,
                  height: '4px',
                  cornerRadius: '2px',
                  width: `${100 - pct}%`,
                } as FlexBox,
              ]
            : []),
        ],
        margin: 'sm',
        spacing: 'none',
      } as FlexBox,
    ],
    paddingStart: '20px',
    paddingEnd: '20px',
    margin: 'lg',
  } as FlexBox;
}

// ─── Helper: createFooter ──────────────────────────────
/**
 * Bottom footer: meta info left + ref number right. Subtle bg.
 */
export function createFooter(meta: string, ref?: string): FlexBox {
  const contents: FlexComponent[] = [
    {
      type: 'text',
      text: meta,
      size: 'xxs',
      color: STYLE_D.TEXT.MUTED,
      flex: 1,
    } as FlexComponent,
  ];
  if (ref) {
    contents.push({
      type: 'text',
      text: ref,
      size: 'xxs',
      color: STYLE_D.TEXT.LABEL,
      weight: 'bold',
      align: 'end',
      flex: 0,
    } as FlexComponent);
  }
  return {
    type: 'box',
    layout: 'horizontal',
    contents,
    backgroundColor: STYLE_D.BG.FOOTER,
    paddingAll: '14px',
    paddingStart: '20px',
    paddingEnd: '20px',
    margin: 'lg',
  } as FlexBox;
}

// ─── Helper: createButton ──────────────────────────────
export type ButtonAction =
  | { type: 'uri'; label: string; uri: string }
  | { type: 'postback'; label: string; data: string };

export type ButtonVariant = Role | 'primary' | 'outline';

/**
 * Premium button — solid role color or outline. Sits inside footer/buttons block.
 */
export function createButton(
  label: string,
  action: ButtonAction,
  variant: ButtonVariant = 'primary',
): FlexButton {
  if (variant === 'outline') {
    return {
      type: 'button',
      action,
      style: 'secondary',
      height: 'sm',
    } as FlexButton;
  }
  if (variant === 'primary') {
    return {
      type: 'button',
      action,
      style: 'primary',
      color: '#0f172a',
      height: 'sm',
    } as FlexButton;
  }
  const r = STYLE_D.ROLE[variant];
  return {
    type: 'button',
    action,
    style: 'primary',
    color: r.buttonBg,
    height: 'sm',
  } as FlexButton;
}

// ─── Helper: buildPremiumBubble ────────────────────────
/**
 * Compose a complete Premium Thai bubble.
 * Pass in body components (after section header) — function handles brand+statusBar+sectionHeader for you.
 */
export function buildPremiumBubble(input: {
  role: Role;
  tag: string;
  section: { label: string; headline: string; subtle?: string; pill?: { text: string; role?: Role } };
  body: FlexComponent[];
  buttons?: FlexButton[];
  size?: 'mega' | 'giga' | 'kilo';
}): FlexBubble {
  const headerStack: FlexComponent[] = [
    createBrandStrip(input.role, input.tag),
    createStatusBar(input.role),
    createSectionHeader(input.role, input.section.label, input.section.headline, input.section.subtle, input.section.pill),
  ];

  const bubble: FlexBubble = {
    type: 'bubble',
    size: input.size ?? 'mega',
    body: {
      type: 'box',
      layout: 'vertical',
      contents: [...headerStack, ...input.body],
      paddingAll: '0px',
      spacing: 'none',
    },
  };

  if (input.buttons && input.buttons.length > 0) {
    bubble.footer = {
      type: 'box',
      layout: 'vertical',
      contents: input.buttons,
      paddingAll: '14px',
      spacing: 'sm',
    };
  }

  return bubble;
}
