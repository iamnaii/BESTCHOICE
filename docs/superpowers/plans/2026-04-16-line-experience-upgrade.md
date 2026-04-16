# LINE Experience Upgrade — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade LINE OA experience for both SHOP and FINANCE channels — personalized Rich Menus, interactive greeting flow, Style C Flex Messages (no emoji, SVG icons), and context-aware chatbot.

**Architecture:** Extend existing `line-oa` module. Add per-user Rich Menu switching via LINE Messaging API. Rewrite all 12 Flex templates to Style C design language. Add tool-use to Claude Haiku chatbot for contract/payment data lookup. All changes are additive — no breaking changes to existing flows.

**Tech Stack:** NestJS, Prisma, LINE Messaging API, LINE Flex Message v2, Claude Haiku (Anthropic SDK with tool use)

**Design Spec:** `docs/superpowers/specs/2026-04-16-line-experience-design.md`

---

## File Map

### New Files
- `apps/api/src/modules/line-oa/flex-messages/icons.ts` — Icon URL constants for S3/CDN hosted icons
- `apps/api/src/modules/line-oa/flex-messages/style-c.ts` — Style C design system (new colors, helpers for card header, info card, badge, progress)
- `apps/api/src/modules/line-oa/flex-messages/welcome.flex.ts` — Welcome greeting Flex template
- `apps/api/src/modules/line-oa/flex-messages/verify-success.flex.ts` — Verify success Flex template
- `apps/api/src/modules/line-oa/chatbot/chatbot-tools.ts` — Tool definitions + handlers for context-aware chatbot

### Modified Files
- `apps/api/src/modules/line-oa/rich-menu/rich-menu.service.ts` — Add `linkRichMenuToUser`, `unlinkRichMenuFromUser`
- `apps/api/src/modules/line-oa/line-oa-chatbot.controller.ts` — Rewrite follow/unfollow handlers for greeting + menu switching
- `apps/api/src/modules/line-oa/line-oa.service.ts` — Add `findCustomerByLineId` enhancements, greeting helpers
- `apps/api/src/modules/line-oa/chatbot.service.ts` — Add tool use for contract/payment data
- `apps/api/src/modules/line-oa/chatbot-system-prompt.constants.ts` — Update system prompt for context-aware mode
- `apps/api/src/modules/line-oa/quick-reply.service.ts` — Add onboarding quick replies
- `apps/api/src/modules/line-oa/flex-messages/base-template.ts` — Add Style C color palette
- `apps/api/src/modules/line-oa/flex-messages/payment-reminder.flex.ts` — Rewrite to Style C
- `apps/api/src/modules/line-oa/flex-messages/overdue-notice.flex.ts` — Rewrite to Style C
- `apps/api/src/modules/line-oa/flex-messages/payment-success.flex.ts` — Rewrite to Style C
- `apps/api/src/modules/line-oa/flex-messages/balance-summary.flex.ts` — Rewrite to Style C
- `apps/api/src/modules/line-oa/flex-messages/promptpay-qr.flex.ts` — Rewrite to Style C
- `apps/api/src/modules/line-oa/flex-messages/contract-signed.flex.ts` — Rewrite to Style C
- `apps/api/src/modules/line-oa/flex-messages/campaign.flex.ts` — Rewrite to Style C
- `apps/api/src/modules/line-oa/flex-messages/contract-selector.flex.ts` — Rewrite to Style C
- `apps/api/src/modules/line-oa/flex-messages/receipt.flex.ts` — Rewrite to Style C
- `apps/api/src/modules/line-oa/flex-messages/receipt-history.flex.ts` — Rewrite to Style C
- `apps/api/src/modules/line-oa/flex-messages/daily-report.flex.ts` — Rewrite to Style C
- `apps/api/src/modules/line-oa/flex-messages/index.ts` — Export new modules
- `apps/api/src/modules/line-oa/liff-api.controller.ts` — Add Rich Menu switch after verify success

---

## Task 1: Style C Design System Foundation

**Files:**
- Create: `apps/api/src/modules/line-oa/flex-messages/icons.ts`
- Create: `apps/api/src/modules/line-oa/flex-messages/style-c.ts`
- Modify: `apps/api/src/modules/line-oa/flex-messages/base-template.ts`

- [ ] **Step 1: Create icon URL constants**

Create `apps/api/src/modules/line-oa/flex-messages/icons.ts`:

```ts
/**
 * Icon URLs for LINE Flex Message — Style C Design System
 * Icons hosted on S3/CDN as PNG (LINE Flex doesn't support inline SVG)
 *
 * Placeholder URLs until actual icons are uploaded.
 * Replace BASE_URL with actual S3 bucket URL after upload.
 */

const BASE_URL = process.env.ICON_BASE_URL || 'https://storage.googleapis.com/bestchoice-assets/icons';

export const ICONS = {
  // Finance
  CREDIT_CARD: `${BASE_URL}/credit-card.png`,
  DOLLAR_SIGN: `${BASE_URL}/dollar-sign.png`,
  BAR_CHART: `${BASE_URL}/bar-chart.png`,
  CALCULATOR: `${BASE_URL}/calculator.png`,

  // Status
  CHECK_CIRCLE: `${BASE_URL}/check-circle.png`,
  ALERT_TRIANGLE: `${BASE_URL}/alert-triangle.png`,
  INFO_CIRCLE: `${BASE_URL}/info-circle.png`,
  CLOCK: `${BASE_URL}/clock.png`,

  // Documents
  FILE_TEXT: `${BASE_URL}/file-text.png`,
  LIST: `${BASE_URL}/list.png`,
  RECEIPT: `${BASE_URL}/receipt.png`,

  // Communication
  MESSAGE_CIRCLE: `${BASE_URL}/message-circle.png`,
  PHONE: `${BASE_URL}/phone.png`,

  // Products
  SMARTPHONE: `${BASE_URL}/smartphone.png`,
  GIFT: `${BASE_URL}/gift.png`,
  MAP_PIN: `${BASE_URL}/map-pin.png`,

  // Actions
  QR_CODE: `${BASE_URL}/qr-code.png`,
  ACTIVITY: `${BASE_URL}/activity.png`,
} as const;
```

- [ ] **Step 2: Create Style C design system helpers**

Create `apps/api/src/modules/line-oa/flex-messages/style-c.ts`:

```ts
/**
 * Style C Design System — Card with Status + Progress
 * Design language: icon header (44px) + status badge + info card (rounded-12) + progress bar + CTA
 */
import {
  FlexBox,
  FlexText,
  FlexIcon,
  FlexButton,
  FlexBubble,
  FlexComponent,
  FlexMessagePayload,
  COLORS,
} from './base-template';

// ─── Style C Color Palette ──────────────────────────────
export const STYLE_C = {
  // Semantic gradients (for icon backgrounds)
  GREEN: { startColor: '#10b981', endColor: '#059669' },
  RED: { startColor: '#ef4444', endColor: '#dc2626' },
  BLUE: { startColor: '#3b82f6', endColor: '#2563eb' },
  ORANGE: { startColor: '#f59e0b', endColor: '#ea580c' },

  // Badge colors
  BADGE_SUCCESS: { bg: '#dcfce7', text: '#16a34a' },
  BADGE_DANGER: { bg: '#fee2e2', text: '#dc2626' },
  BADGE_WARNING: { bg: '#fef3c7', text: '#d97706' },
  BADGE_INFO: { bg: '#dbeafe', text: '#2563eb' },

  // Info card backgrounds
  CARD_DEFAULT: '#f8fafc',
  CARD_SUCCESS: '#f0fdf4',
  CARD_DANGER: '#fef2f2',
  CARD_WARNING: '#fffbeb',

  // Info card borders
  BORDER_SUCCESS: '#bbf7d0',
  BORDER_DANGER: '#fecaca',

  // Text
  TEXT_PRIMARY: '#1e293b',
  TEXT_SECONDARY: '#64748b',
  TEXT_MUTED: '#888888',

  // Buttons
  BTN_GREEN: '#10b981',
  BTN_RED: '#dc2626',
  BTN_BLUE: '#3b82f6',
  BTN_SECONDARY_BORDER: '#e2e8f0',

  // Progress bar
  PROGRESS_BG: '#e2e8f0',
  PROGRESS_GREEN: '#10b981',
  PROGRESS_BLUE: '#3b82f6',

  // Hint cards
  HINT_GREEN: '#f0fdf4',
  HINT_YELLOW: '#fef3c7',

  // Tip box
  TIP_ORANGE_BG: '#fff7ed',
  TIP_ORANGE_TEXT: '#c2410c',
} as const;

/**
 * Style C header: icon (44px rounded) + title/subtitle + optional badge
 */
export function createStyleCHeader(
  iconUrl: string,
  title: string,
  subtitle: string,
  gradient: { startColor: string; endColor: string },
  badge?: { text: string; bg: string; color: string },
): FlexBox {
  const headerContents: FlexComponent[] = [
    // Icon
    {
      type: 'box',
      layout: 'vertical',
      contents: [
        { type: 'image', url: iconUrl, size: 'xxs', aspectRatio: '1:1', aspectMode: 'fit' } as FlexComponent,
      ],
      width: '44px',
      height: '44px',
      cornerRadius: '12px',
      background: { type: 'linearGradient', angle: '135deg', ...gradient },
      justifyContent: 'center',
      alignItems: 'center',
    },
    // Title + Subtitle
    {
      type: 'box',
      layout: 'vertical',
      contents: [
        { type: 'text', text: title, size: 'sm', weight: 'bold', color: STYLE_C.TEXT_PRIMARY } as FlexText,
        { type: 'text', text: subtitle, size: 'xxs', color: STYLE_C.TEXT_MUTED } as FlexText,
      ],
      flex: 1,
    },
  ];

  // Badge (optional)
  if (badge) {
    headerContents.push({
      type: 'box',
      layout: 'horizontal',
      contents: [
        { type: 'text', text: badge.text, size: 'xxs', color: badge.color, weight: 'bold', align: 'center' } as FlexText,
      ],
      backgroundColor: badge.bg,
      cornerRadius: '20px',
      paddingAll: '4px',
      paddingStart: '10px',
      paddingEnd: '10px',
    });
  }

  return {
    type: 'box',
    layout: 'horizontal',
    contents: headerContents,
    spacing: 'lg',
    paddingAll: '16px',
    alignItems: 'center',
  };
}

/**
 * Style C info card — rounded background with key-value data
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
  const contents: FlexComponent[] = [
    {
      type: 'box',
      layout: 'horizontal',
      contents: [
        { type: 'text', text: topLeft, size: 'xxs', color: STYLE_C.TEXT_MUTED } as FlexText,
        { type: 'text', text: topRight, size: 'xxs', color: STYLE_C.TEXT_MUTED, align: 'end' } as FlexText,
      ],
    },
    { type: 'text', text: amount, size: 'xl', weight: 'bold', color: amountColor, margin: 'sm' } as FlexText,
  ];

  if (subText) {
    contents.push({
      type: 'text',
      text: subText,
      size: 'xxs',
      color: subTextColor || STYLE_C.TEXT_MUTED,
      margin: 'sm',
      wrap: true,
    } as FlexText);
  }

  return {
    type: 'box',
    layout: 'vertical',
    contents,
    backgroundColor: bgColor || STYLE_C.CARD_DEFAULT,
    cornerRadius: '12px',
    paddingAll: '14px',
    ...(borderColor ? { borderColor, borderWidth: '1px' } : {}),
  };
}

/**
 * Style C progress bar with labels
 */
export function createStyleCProgress(
  paidCount: number,
  totalCount: number,
  color: string,
  leftLabel?: string,
  rightLabel?: string,
): FlexBox {
  const pct = Math.min(100, Math.round((paidCount / totalCount) * 100));
  return {
    type: 'box',
    layout: 'vertical',
    contents: [
      {
        type: 'box',
        layout: 'horizontal',
        contents: [
          { type: 'text', text: leftLabel || `ชำระแล้ว ${paidCount} งวด`, size: 'xxs', color: STYLE_C.TEXT_MUTED } as FlexText,
          { type: 'text', text: rightLabel || `เหลือ ${totalCount - paidCount} งวด`, size: 'xxs', color: STYLE_C.TEXT_MUTED, align: 'end' } as FlexText,
        ],
      },
      {
        type: 'box',
        layout: 'horizontal',
        contents: [
          {
            type: 'box',
            layout: 'vertical',
            contents: [{ type: 'filler' }],
            backgroundColor: color,
            height: '8px',
            cornerRadius: '4px',
            width: `${Math.max(pct, 3)}%`,
          },
          ...(pct < 100
            ? [{
                type: 'box' as const,
                layout: 'vertical' as const,
                contents: [{ type: 'filler' as const }],
                backgroundColor: STYLE_C.PROGRESS_BG,
                height: '8px',
                cornerRadius: '4px',
                width: `${100 - pct}%`,
              }]
            : []),
        ],
        margin: 'sm',
        spacing: 'none',
      },
    ],
    margin: 'lg',
  };
}

/**
 * Style C hint cards row (2-3 small stat cards)
 */
export function createHintCards(
  cards: Array<{ label: string; value: string; valueColor: string; bgColor: string }>,
): FlexBox {
  return {
    type: 'box',
    layout: 'horizontal',
    contents: cards.map((card) => ({
      type: 'box' as const,
      layout: 'vertical' as const,
      contents: [
        { type: 'text', text: card.label, size: 'xxs', color: '#666666', align: 'center' } as FlexText,
        { type: 'text', text: card.value, size: 'sm', weight: 'bold', color: card.valueColor, align: 'center', margin: 'xs' } as FlexText,
      ],
      backgroundColor: card.bgColor,
      cornerRadius: '10px',
      paddingAll: '10px',
      flex: 1,
    })),
    spacing: 'sm',
    margin: 'md',
  };
}

/**
 * Style C tip box (info/warning message)
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
      { type: 'icon', url: iconUrl, size: 'sm' } as FlexIcon,
      { type: 'text', text, size: 'xxs', color: textColor, wrap: true, flex: 1 } as FlexText,
    ],
    backgroundColor: bgColor,
    cornerRadius: '8px',
    paddingAll: '10px',
    spacing: 'sm',
    margin: 'md',
  };
}

/**
 * Style C primary + secondary button row
 */
export function createStyleCButtons(
  primaryLabel: string,
  primaryAction: { type: 'uri'; uri: string } | { type: 'postback'; data: string },
  primaryColor: string,
  secondaryLabel?: string,
  secondaryAction?: { type: 'uri'; uri: string } | { type: 'postback'; data: string },
): FlexBox {
  const contents: FlexComponent[] = [
    {
      type: 'button',
      action: { type: primaryAction.type, label: primaryLabel, ...primaryAction } as any,
      style: 'primary',
      color: primaryColor,
      height: 'sm',
    } as FlexButton,
  ];

  if (secondaryLabel && secondaryAction) {
    contents.push({
      type: 'button',
      action: { type: secondaryAction.type, label: secondaryLabel, ...secondaryAction } as any,
      style: 'secondary',
      height: 'sm',
    } as FlexButton);
  }

  return {
    type: 'box',
    layout: 'horizontal',
    contents,
    spacing: 'sm',
    paddingAll: '16px',
  };
}
```

- [ ] **Step 3: Update base-template.ts — add Style C colors**

Add to `apps/api/src/modules/line-oa/flex-messages/base-template.ts` after the existing `COLORS` object:

```ts
// ─── Style C Palette (re-exported from style-c.ts for convenience) ────
export { STYLE_C } from './style-c';
export { ICONS } from './icons';
```

- [ ] **Step 4: Update index.ts — export new modules**

Add to `apps/api/src/modules/line-oa/flex-messages/index.ts`:

```ts
export * from './icons';
export * from './style-c';
export * from './welcome.flex';
export * from './verify-success.flex';
```

Also add any missing exports (receipt, receipt-history, contract-selector, daily-report).

- [ ] **Step 5: Run type check**

Run: `./tools/check-types.sh api`
Expected: 0 errors

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/line-oa/flex-messages/icons.ts apps/api/src/modules/line-oa/flex-messages/style-c.ts apps/api/src/modules/line-oa/flex-messages/base-template.ts apps/api/src/modules/line-oa/flex-messages/index.ts
git commit -m "feat(line): add Style C design system foundation — icons, colors, helpers"
```

---

## Task 2: Rich Menu Personalized Switching

**Files:**
- Modify: `apps/api/src/modules/line-oa/rich-menu/rich-menu.service.ts`

- [ ] **Step 1: Add per-user Rich Menu methods to RichMenuService**

Add these methods to `apps/api/src/modules/line-oa/rich-menu/rich-menu.service.ts`:

```ts
/**
 * Link a specific Rich Menu to a single user (personalized menu)
 */
async linkRichMenuToUser(userId: string, richMenuId: string): Promise<void> {
  if (!this.lineChannelAccessToken) {
    throw new BadRequestException('LINE channel access token not configured');
  }

  const url = `${this.lineApiBaseUrl}/user/${userId}/richmenu/${richMenuId}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${this.lineChannelAccessToken}`,
    },
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    this.logger.error(`Failed to link Rich Menu to user ${userId}: ${response.status} ${errorBody}`);
    throw new InternalServerErrorException(`Failed to link Rich Menu: ${response.status}`);
  }

  this.logger.log(`Rich Menu ${richMenuId} linked to user ${userId}`);
}

/**
 * Unlink Rich Menu from a specific user (falls back to default)
 */
async unlinkRichMenuFromUser(userId: string): Promise<void> {
  if (!this.lineChannelAccessToken) {
    throw new BadRequestException('LINE channel access token not configured');
  }

  const url = `${this.lineApiBaseUrl}/user/${userId}/richmenu`;
  const response = await fetch(url, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${this.lineChannelAccessToken}`,
    },
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok && response.status !== 404) {
    const errorBody = await response.text();
    this.logger.error(`Failed to unlink Rich Menu from user ${userId}: ${response.status} ${errorBody}`);
    throw new InternalServerErrorException(`Failed to unlink Rich Menu: ${response.status}`);
  }

  this.logger.log(`Rich Menu unlinked from user ${userId}`);
}

/**
 * Get Rich Menu ID from SystemConfig by key.
 * Keys: line.richMenu.shopDefault, line.richMenu.shopVerified,
 *        line.richMenu.financeDefault, line.richMenu.financeVerified
 */
async getRichMenuIdFromConfig(key: string): Promise<string | null> {
  // Inject PrismaService via constructor if not already available
  // This method reads from SystemConfig table
  const config = await this.prisma.systemConfig.findFirst({
    where: { key, deletedAt: null },
  });
  return config?.value ?? null;
}

/**
 * Switch user to the appropriate Rich Menu based on verification status.
 * @param userId LINE user ID
 * @param isVerified whether the customer has linked their account
 * @param channel 'shop' or 'finance'
 */
async switchRichMenu(userId: string, isVerified: boolean, channel: 'shop' | 'finance'): Promise<void> {
  const keyPrefix = `line.richMenu.${channel}`;
  const key = isVerified ? `${keyPrefix}Verified` : `${keyPrefix}Default`;
  const richMenuId = await this.getRichMenuIdFromConfig(key);

  if (!richMenuId) {
    this.logger.warn(`Rich Menu config not found for key: ${key}`);
    return;
  }

  await this.linkRichMenuToUser(userId, richMenuId);
}
```

Note: `RichMenuService` needs `PrismaService` injected. Add to constructor:

```ts
constructor(
  private configService: ConfigService,
  private prisma: PrismaService,
) {
```

And add the import at top of file.

- [ ] **Step 2: Run type check**

Run: `./tools/check-types.sh api`
Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/modules/line-oa/rich-menu/rich-menu.service.ts
git commit -m "feat(line): add per-user Rich Menu switching — linkToUser, switchRichMenu"
```

---

## Task 3: Greeting & Onboarding Flow

**Files:**
- Create: `apps/api/src/modules/line-oa/flex-messages/welcome.flex.ts`
- Create: `apps/api/src/modules/line-oa/flex-messages/verify-success.flex.ts`
- Modify: `apps/api/src/modules/line-oa/quick-reply.service.ts`
- Modify: `apps/api/src/modules/line-oa/line-oa-chatbot.controller.ts`
- Modify: `apps/api/src/modules/line-oa/line-oa.service.ts`

- [ ] **Step 1: Create Welcome Flex template**

Create `apps/api/src/modules/line-oa/flex-messages/welcome.flex.ts`:

```ts
import { FlexBubble, FlexMessagePayload, wrapFlexMessage } from './base-template';
import { STYLE_C, createStyleCButtons } from './style-c';
import { ICONS } from './icons';

export interface WelcomeFlexData {
  oaType: 'shop' | 'finance';
  liffRegisterUrl: string;
}

export function buildWelcomeFlex(data: WelcomeFlexData): FlexMessagePayload {
  const isShop = data.oaType === 'shop';
  const title = isShop ? 'ยินดีต้อนรับสู่ BESTCHOICE!' : 'สวัสดีค่ะ! BESTCHOICE FINANCE';
  const description = isShop
    ? 'ร้านมือถือครบวงจร ผ่อนสบาย ดอกเบี้ยต่ำ'
    : 'จัดการสัญญาผ่อนชำระ ชำระค่างวด ดูประวัติ ได้ที่นี่เลย';

  const gradient = STYLE_C.GREEN;

  const features = isShop
    ? [
        { icon: ICONS.SMARTPHONE, label: 'สินค้าหลากหลาย' },
        { icon: ICONS.CALCULATOR, label: 'คำนวณค่างวด' },
        { icon: ICONS.GIFT, label: 'โปรโมชั่นพิเศษ' },
      ]
    : [
        { icon: ICONS.CREDIT_CARD, label: 'ชำระค่างวด' },
        { icon: ICONS.FILE_TEXT, label: 'ดูสัญญา' },
        { icon: ICONS.ACTIVITY, label: 'ประวัติชำระ' },
      ];

  const bubble: FlexBubble = {
    type: 'bubble',
    size: 'mega',
    header: {
      type: 'box',
      layout: 'vertical',
      contents: [
        {
          type: 'image',
          url: ICONS.SMARTPHONE,
          size: 'xxs',
          aspectRatio: '1:1',
          aspectMode: 'fit',
        },
        {
          type: 'text',
          text: title,
          size: 'lg',
          weight: 'bold',
          color: '#FFFFFF',
          align: 'center',
          margin: 'md',
        },
        {
          type: 'text',
          text: isShop ? 'BESTCHOICE SHOP' : 'BESTCHOICE FINANCE',
          size: 'xs',
          color: '#FFFFFFCC',
          align: 'center',
          margin: 'sm',
        },
        {
          type: 'text',
          text: description,
          size: 'xs',
          color: '#FFFFFFAA',
          align: 'center',
          margin: 'sm',
          wrap: true,
        },
      ],
      background: { type: 'linearGradient', angle: '135deg', ...gradient },
      paddingAll: '24px',
      justifyContent: 'center',
      alignItems: 'center',
    },
    body: {
      type: 'box',
      layout: 'vertical',
      contents: [
        {
          type: 'box',
          layout: 'horizontal',
          contents: features.map((f) => ({
            type: 'box' as const,
            layout: 'vertical' as const,
            contents: [
              {
                type: 'image',
                url: f.icon,
                size: 'xxs',
                aspectRatio: '1:1',
                aspectMode: 'fit',
              } as any,
              {
                type: 'text',
                text: f.label,
                size: 'xxs',
                color: '#666666',
                align: 'center',
                margin: 'sm',
              } as any,
            ],
            backgroundColor: '#f0fdf4',
            cornerRadius: '10px',
            paddingAll: '12px',
            flex: 1,
            alignItems: 'center',
          })),
          spacing: 'sm',
        },
      ],
      paddingAll: '16px',
    },
    footer: {
      type: 'box',
      layout: 'vertical',
      contents: [
        {
          type: 'button',
          action: { type: 'uri', label: 'ลงทะเบียนสัญญา', uri: data.liffRegisterUrl },
          style: 'primary',
          color: STYLE_C.BTN_GREEN,
          height: 'sm',
        },
        {
          type: 'button',
          action: { type: 'message', label: 'วิธีชำระเงิน', text: 'วิธีชำระเงิน' },
          style: 'secondary',
          height: 'sm',
          margin: 'sm',
        },
      ],
      paddingAll: '16px',
    },
  };

  return wrapFlexMessage(`ยินดีต้อนรับสู่ ${isShop ? 'BESTCHOICE SHOP' : 'BESTCHOICE FINANCE'}`, bubble);
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
          type: 'box',
          layout: 'horizontal',
          contents: [
            {
              type: 'box',
              layout: 'vertical',
              contents: [
                {
                  type: 'image',
                  url: ICONS.CHECK_CIRCLE,
                  size: 'xxs',
                  aspectRatio: '1:1',
                  aspectMode: 'fit',
                } as any,
              ],
              width: '40px',
              height: '40px',
              cornerRadius: '10px',
              background: { type: 'linearGradient', angle: '135deg', ...STYLE_C.GREEN },
              justifyContent: 'center',
              alignItems: 'center',
            },
            {
              type: 'box',
              layout: 'vertical',
              contents: [
                { type: 'text', text: 'ยินดีต้อนรับกลับมา!', size: 'md', weight: 'bold', color: STYLE_C.TEXT_PRIMARY } as any,
                { type: 'text', text: `คุณ${customerName}`, size: 'sm', color: STYLE_C.TEXT_SECONDARY } as any,
              ],
              flex: 1,
            },
          ],
          spacing: 'lg',
          alignItems: 'center',
        },
      ],
      paddingAll: '16px',
    },
  };

  return wrapFlexMessage('ยินดีต้อนรับกลับมา!', bubble);
}
```

- [ ] **Step 2: Create Verify Success Flex template**

Create `apps/api/src/modules/line-oa/flex-messages/verify-success.flex.ts`:

```ts
import { FlexBubble, FlexMessagePayload, wrapFlexMessage } from './base-template';
import { STYLE_C, createStyleCHeader, createInfoCard } from './style-c';
import { ICONS } from './icons';

export interface VerifySuccessData {
  customerName: string;
  contractNumber: string;
  totalInstallments: number;
  monthlyAmount: number;
}

export function buildVerifySuccessFlex(data: VerifySuccessData): FlexMessagePayload {
  const bubble: FlexBubble = {
    type: 'bubble',
    size: 'mega',
    body: {
      type: 'box',
      layout: 'vertical',
      contents: [
        createStyleCHeader(
          ICONS.CHECK_CIRCLE,
          'ลงทะเบียนสำเร็จ!',
          'BESTCHOICE FINANCE',
          STYLE_C.GREEN,
          { text: 'สำเร็จ', bg: STYLE_C.BADGE_SUCCESS.bg, color: STYLE_C.BADGE_SUCCESS.text },
        ),
        { type: 'separator', color: '#f0f0f0' },
        {
          type: 'box',
          layout: 'vertical',
          contents: [
            createInfoCard(
              `คุณ${data.customerName}`,
              `สัญญา ${data.contractNumber}`,
              `฿${data.monthlyAmount.toLocaleString('th-TH')} / เดือน`,
              STYLE_C.TEXT_PRIMARY,
              `${data.totalInstallments} งวด`,
            ),
          ],
          paddingAll: '16px',
        },
      ],
    },
    footer: {
      type: 'box',
      layout: 'horizontal',
      contents: [
        {
          type: 'button',
          action: { type: 'message', label: 'เช็คยอด', text: 'เช็คยอด' },
          style: 'primary',
          color: STYLE_C.BTN_GREEN,
          height: 'sm',
        },
        {
          type: 'button',
          action: { type: 'message', label: 'ดูสัญญา', text: 'สัญญา' },
          style: 'secondary',
          height: 'sm',
        },
      ],
      paddingAll: '16px',
      spacing: 'sm',
    },
  };

  return wrapFlexMessage('ลงทะเบียนสำเร็จ!', bubble);
}
```

- [ ] **Step 3: Add onboarding quick replies**

Add to `apps/api/src/modules/line-oa/quick-reply.service.ts`:

```ts
/** Quick replies for new customer onboarding (SHOP OA) */
shopOnboarding(): LineQuickReplyItem[] {
  return [
    { type: 'action', action: { type: 'message', label: 'ฉันเป็นลูกค้าใหม่', text: 'ลูกค้าใหม่' } },
    { type: 'action', action: { type: 'message', label: 'ฉันมีสัญญาอยู่แล้ว', text: 'ลงทะเบียน' } },
  ];
}

/** Quick replies for new customer onboarding (FINANCE OA) */
financeOnboarding(): LineQuickReplyItem[] {
  return [
    { type: 'action', action: { type: 'message', label: 'ลงทะเบียนสัญญา', text: 'ลงทะเบียน' } },
    { type: 'action', action: { type: 'message', label: 'วิธีชำระเงิน', text: 'วิธีชำระเงิน' } },
  ];
}

/** Quick replies for verified customer returning */
verifiedReturn(): LineQuickReplyItem[] {
  return [
    { type: 'action', action: { type: 'message', label: 'เช็คยอด', text: 'เช็คยอด' } },
    { type: 'action', action: { type: 'message', label: 'ดูสัญญา', text: 'สัญญา' } },
    { type: 'action', action: { type: 'message', label: 'ช่วยเหลือ', text: 'ช่วยเหลือ' } },
  ];
}
```

- [ ] **Step 4: Rewrite handleFollow in line-oa-chatbot.controller.ts**

Replace the `handleFollow` method in `apps/api/src/modules/line-oa/line-oa-chatbot.controller.ts`:

```ts
private async handleFollow(event: any): Promise<void> {
  const userId = event.source.userId;

  // Check if this user is already linked to a customer (re-follow)
  const customer = await this.lineOaService.findCustomerByLineId(userId);

  if (customer) {
    // Re-follow — customer already verified
    // Switch to verified Rich Menu
    await this.richMenuService.switchRichMenu(userId, true, 'shop'); // or 'finance' based on OA channel
    // Send re-welcome Flex
    const reWelcomeFlex = buildReWelcomeFlex(customer.firstName || 'ลูกค้า');
    const quickReply = this.quickReplyService.verifiedReturn();
    await this.replyWithFlex(event.replyToken, reWelcomeFlex, quickReply);
  } else {
    // New user — send welcome + onboarding
    // Switch to default Rich Menu
    await this.richMenuService.switchRichMenu(userId, false, 'shop');
    // Send welcome Flex
    const liffRegisterUrl = this.getLiffRegisterUrl();
    const welcomeFlex = buildWelcomeFlex({ oaType: 'shop', liffRegisterUrl });
    const quickReply = this.quickReplyService.shopOnboarding();
    await this.replyWithFlex(event.replyToken, welcomeFlex, quickReply);
  }
}
```

Note: Import `buildWelcomeFlex`, `buildReWelcomeFlex` from flex-messages. Inject `RichMenuService` into the controller constructor if not already there.

The actual `replyWithFlex` helper needs to send a Flex Message via reply token — adapt from existing reply logic in the controller.

- [ ] **Step 5: Add Rich Menu switch to LIFF verify success**

Modify `apps/api/src/modules/line-oa/liff-api.controller.ts` — after `confirmLinkLine` succeeds:

```ts
// After successful verification, switch Rich Menu to verified
if (lineId) {
  try {
    await this.richMenuService.switchRichMenu(lineId, true, 'finance');
    // Send verify success Flex via push message
    const verifyFlex = buildVerifySuccessFlex({
      customerName: customer.firstName || 'ลูกค้า',
      contractNumber: contract?.contractNumber || '',
      totalInstallments: contract?.totalInstallments || 0,
      monthlyAmount: Number(contract?.monthlyPayment || 0),
    });
    await this.lineOaService.pushFlexMessage(lineId, verifyFlex);
  } catch (err) {
    this.logger.error('Failed to switch Rich Menu after verify', err);
    // Non-blocking — don't fail the verify request
  }
}
```

- [ ] **Step 6: Run type check**

Run: `./tools/check-types.sh api`
Expected: 0 errors

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/line-oa/flex-messages/welcome.flex.ts apps/api/src/modules/line-oa/flex-messages/verify-success.flex.ts apps/api/src/modules/line-oa/quick-reply.service.ts apps/api/src/modules/line-oa/line-oa-chatbot.controller.ts apps/api/src/modules/line-oa/liff-api.controller.ts apps/api/src/modules/line-oa/line-oa.service.ts
git commit -m "feat(line): interactive greeting flow — welcome, onboarding, rich menu switch on verify"
```

---

## Task 4: Flex Message Visual Upgrade — Payment Reminder

**Files:**
- Modify: `apps/api/src/modules/line-oa/flex-messages/payment-reminder.flex.ts`

- [ ] **Step 1: Rewrite payment-reminder.flex.ts to Style C**

Replace the entire content of `apps/api/src/modules/line-oa/flex-messages/payment-reminder.flex.ts`:

```ts
import { FlexBubble, FlexMessagePayload, wrapFlexMessage, formatBaht } from './base-template';
import { STYLE_C, createStyleCHeader, createInfoCard, createStyleCProgress } from './style-c';
import { ICONS } from './icons';

export interface PaymentReminderData {
  customerName: string;
  contractNumber: string;
  installmentNo: number;
  totalInstallments: number;
  amountDue: number;
  dueDate: string;
  daysUntilDue: number;
  paymentUrl?: string;
}

export function buildPaymentReminderFlex(data: PaymentReminderData): FlexMessagePayload {
  const isUrgent = data.daysUntilDue <= 1;

  // Badge
  const badgeText = data.daysUntilDue === 0
    ? 'วันนี้!'
    : data.daysUntilDue <= 1
    ? 'พรุ่งนี้'
    : `อีก ${data.daysUntilDue} วัน`;
  const badge = isUrgent
    ? { text: badgeText, bg: STYLE_C.BADGE_DANGER.bg, color: STYLE_C.BADGE_DANGER.text }
    : { text: badgeText, bg: STYLE_C.BADGE_WARNING.bg, color: STYLE_C.BADGE_WARNING.text };

  const bubble: FlexBubble = {
    type: 'bubble',
    size: 'mega',
    body: {
      type: 'box',
      layout: 'vertical',
      contents: [
        // Header: icon + title + badge
        createStyleCHeader(
          ICONS.CREDIT_CARD,
          'แจ้งเตือนค่างวด',
          'BESTCHOICE FINANCE',
          STYLE_C.GREEN,
          badge,
        ),
        // Separator
        { type: 'separator', color: '#f0f0f0' },
        // Body
        {
          type: 'box',
          layout: 'vertical',
          contents: [
            // Info card
            createInfoCard(
              `สัญญา ${data.contractNumber}`,
              `งวด ${data.installmentNo}/${data.totalInstallments}`,
              formatBaht(data.amountDue),
              STYLE_C.TEXT_PRIMARY,
              `ครบกำหนด ${data.dueDate}`,
              isUrgent ? STYLE_C.BADGE_DANGER.text : STYLE_C.BADGE_WARNING.text,
            ),
            // Progress bar
            createStyleCProgress(
              data.installmentNo - 1,
              data.totalInstallments,
              STYLE_C.PROGRESS_GREEN,
            ),
          ],
          paddingAll: '16px',
        },
      ],
    },
    footer: {
      type: 'box',
      layout: 'horizontal',
      contents: [
        {
          type: 'button',
          action: data.paymentUrl
            ? { type: 'uri', label: 'ชำระเงิน', uri: data.paymentUrl }
            : { type: 'postback', label: 'ชำระเงิน', data: `action=pay&contract=${data.contractNumber}` },
          style: 'primary',
          color: STYLE_C.BTN_GREEN,
          height: 'sm',
        },
        {
          type: 'button',
          action: { type: 'postback', label: 'รายละเอียด', data: `action=check_installments&contract=${data.contractNumber}` },
          style: 'secondary',
          height: 'sm',
        },
      ],
      paddingAll: '16px',
      spacing: 'sm',
    },
  };

  return wrapFlexMessage(
    `แจ้งเตือน: ค่างวดที่ ${data.installmentNo} จำนวน ${formatBaht(data.amountDue)} ครบกำหนด ${data.dueDate}`,
    bubble,
  );
}
```

- [ ] **Step 2: Run type check**

Run: `./tools/check-types.sh api`
Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/modules/line-oa/flex-messages/payment-reminder.flex.ts
git commit -m "feat(line): upgrade payment-reminder Flex to Style C"
```

---

## Task 5: Flex Message Visual Upgrade — Overdue Notice

**Files:**
- Modify: `apps/api/src/modules/line-oa/flex-messages/overdue-notice.flex.ts`

- [ ] **Step 1: Rewrite overdue-notice.flex.ts to Style C**

Replace the entire content. Follow the same pattern as Task 4 but use:
- Icon: `ICONS.ALERT_TRIANGLE`
- Gradient: `STYLE_C.RED`
- Badge: `{ text: 'ค้างชำระ', bg: STYLE_C.BADGE_DANGER.bg, color: STYLE_C.BADGE_DANGER.text }`
- Info card: `STYLE_C.CARD_DANGER` background, `STYLE_C.BORDER_DANGER` border
- Show: overdue days, late fee breakdown, total amount (red)
- Tip box: `createTipBox(ICONS.INFO_CIRCLE, 'ชำระภายในวันนี้เพื่อหลีกเลี่ยงค่าปรับเพิ่มเติม', STYLE_C.TIP_ORANGE_BG, STYLE_C.TIP_ORANGE_TEXT)`
- Primary CTA: "ชำระเงินทันที" (red button)
- Secondary link: "ติดต่อเจ้าหน้าที่"

Keep the same `OverdueNoticeData` interface. Preserve all existing data fields.

- [ ] **Step 2: Run type check and commit**

```bash
./tools/check-types.sh api
git add apps/api/src/modules/line-oa/flex-messages/overdue-notice.flex.ts
git commit -m "feat(line): upgrade overdue-notice Flex to Style C"
```

---

## Task 6: Flex Message Visual Upgrade — Payment Success

**Files:**
- Modify: `apps/api/src/modules/line-oa/flex-messages/payment-success.flex.ts`

- [ ] **Step 1: Rewrite payment-success.flex.ts to Style C**

Follow the same pattern:
- Icon: `ICONS.CHECK_CIRCLE`
- Gradient: `STYLE_C.GREEN`
- Badge: `{ text: 'สำเร็จ', bg: STYLE_C.BADGE_SUCCESS.bg, color: STYLE_C.BADGE_SUCCESS.text }`
- Info card: `STYLE_C.CARD_SUCCESS` background, `STYLE_C.BORDER_SUCCESS` border
- Show: contract number, installment X/Y, amount (green), payment date/time
- Progress bar: updated to reflect payment (installmentNo / totalInstallments)
- Primary CTA: "ดูใบเสร็จ" (green button)
- Secondary: "ดูสัญญา"

Keep the same `PaymentSuccessData` interface.

- [ ] **Step 2: Run type check and commit**

```bash
./tools/check-types.sh api
git add apps/api/src/modules/line-oa/flex-messages/payment-success.flex.ts
git commit -m "feat(line): upgrade payment-success Flex to Style C"
```

---

## Task 7: Flex Message Visual Upgrade — Balance Summary

**Files:**
- Modify: `apps/api/src/modules/line-oa/flex-messages/balance-summary.flex.ts`

- [ ] **Step 1: Rewrite balance-summary.flex.ts to Style C**

- Icon: `ICONS.BAR_CHART`
- Gradient: `STYLE_C.BLUE`
- Badge: dynamic — green "ปกติ" or red "ค้างชำระ" based on status
- Info card: total remaining balance (large number)
- Hint cards row: ชำระแล้ว (green) + งวดถัดไป (yellow)
- Progress bar: blue color (`STYLE_C.PROGRESS_BLUE`)
- Primary CTA: "ดูรายละเอียดสัญญา" (blue button)

Keep the same `BalanceSummaryData` interface.

- [ ] **Step 2: Run type check and commit**

```bash
./tools/check-types.sh api
git add apps/api/src/modules/line-oa/flex-messages/balance-summary.flex.ts
git commit -m "feat(line): upgrade balance-summary Flex to Style C"
```

---

## Task 8: Flex Message Visual Upgrade — Remaining Templates

**Files:**
- Modify: `apps/api/src/modules/line-oa/flex-messages/promptpay-qr.flex.ts`
- Modify: `apps/api/src/modules/line-oa/flex-messages/contract-signed.flex.ts`
- Modify: `apps/api/src/modules/line-oa/flex-messages/campaign.flex.ts`
- Modify: `apps/api/src/modules/line-oa/flex-messages/contract-selector.flex.ts`
- Modify: `apps/api/src/modules/line-oa/flex-messages/receipt.flex.ts`
- Modify: `apps/api/src/modules/line-oa/flex-messages/receipt-history.flex.ts`
- Modify: `apps/api/src/modules/line-oa/flex-messages/daily-report.flex.ts`

- [ ] **Step 1: Upgrade promptpay-qr.flex.ts**

Style C header with `ICONS.QR_CODE` + green gradient. Keep QR image display. Add info card for amount + contract. Green CTA.

- [ ] **Step 2: Upgrade contract-signed.flex.ts**

Style C header with `ICONS.FILE_TEXT` + green gradient + badge "เปิดสัญญา". Info card with contract details. Progress bar starting at 0%.

- [ ] **Step 3: Upgrade campaign.flex.ts**

Orange gradient full header (like mockup #6). Hint cards for ดาวน์/ผ่อน. Tip box for ของแถม. Orange gradient CTA "สนใจสอบถาม".

- [ ] **Step 4: Upgrade contract-selector.flex.ts**

Style C header with `ICONS.FILE_TEXT`. Each contract as a selectable card with status badge + amount.

- [ ] **Step 5: Upgrade receipt.flex.ts**

Style C header with `ICONS.RECEIPT` + green gradient + badge "สำเร็จ". Info card with receipt details.

- [ ] **Step 6: Upgrade receipt-history.flex.ts**

Style C header with `ICONS.LIST` + green gradient. List of recent receipts as compact rows.

- [ ] **Step 7: Upgrade daily-report.flex.ts**

Style C header with `ICONS.BAR_CHART` + blue gradient. Staff-only — keep data-rich layout but apply Style C colors.

- [ ] **Step 8: Run type check**

Run: `./tools/check-types.sh api`
Expected: 0 errors

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/modules/line-oa/flex-messages/
git commit -m "feat(line): upgrade remaining 7 Flex templates to Style C"
```

---

## Task 9: Chatbot Context-Aware

**Files:**
- Create: `apps/api/src/modules/line-oa/chatbot/chatbot-tools.ts`
- Modify: `apps/api/src/modules/line-oa/chatbot.service.ts`
- Modify: `apps/api/src/modules/line-oa/chatbot-system-prompt.constants.ts`

- [ ] **Step 1: Create chatbot tool definitions**

Create `apps/api/src/modules/line-oa/chatbot/chatbot-tools.ts`:

```ts
/**
 * Tool definitions for context-aware chatbot (Claude Haiku tool use)
 */

export const CHATBOT_TOOLS = [
  {
    name: 'getContractSummary',
    description: 'ดึงข้อมูลสรุปสัญญาทั้งหมดของลูกค้า — ยอมคงเหลือ, งวดถัดไป, สถานะ',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [] as string[],
    },
  },
  {
    name: 'getPaymentHistory',
    description: 'ดึงประวัติการชำระเงิน 5 รายการล่าสุด',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [] as string[],
    },
  },
  {
    name: 'getNextPayment',
    description: 'ดึงข้อมูลงวดถัดไป — วันครบกำหนด, ยอดที่ต้องชำระ',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [] as string[],
    },
  },
  {
    name: 'getEarlyPayoff',
    description: 'คำนวณยอดปิดสัญญาก่อนกำหนด',
    input_schema: {
      type: 'object' as const,
      properties: {
        contractNumber: { type: 'string', description: 'เลขสัญญา (ถ้าลูกค้าระบุ)' },
      },
      required: [] as string[],
    },
  },
];

export type ChatbotToolName = 'getContractSummary' | 'getPaymentHistory' | 'getNextPayment' | 'getEarlyPayoff';
```

- [ ] **Step 2: Add tool handler to chatbot.service.ts**

Modify `apps/api/src/modules/line-oa/chatbot.service.ts`:

1. Import `CHATBOT_TOOLS` and `ChatbotToolName`
2. Add `PrismaService` to constructor injection
3. Change `generateResponse` to accept optional `lineUserId` parameter
4. If `lineUserId` provided → lookup customer → if found, add tools to Claude call
5. Handle tool_use responses by executing the tool and returning results

```ts
async generateResponse(userMessage: string, lineUserId?: string): Promise<string | null> {
  if (!this.anthropic) return null;

  // Check if customer is linked
  let customerContext: any = null;
  if (lineUserId) {
    customerContext = await this.prisma.customer.findFirst({
      where: { lineId: lineUserId, deletedAt: null },
      include: {
        contracts: {
          where: { status: { in: ['ACTIVE', 'OVERDUE'] }, deletedAt: null },
          include: { payments: { where: { deletedAt: null }, orderBy: { paidAt: 'desc' }, take: 5 } },
        },
      },
    });
  }

  const tools = customerContext ? CHATBOT_TOOLS : undefined;
  const systemPrompt = customerContext
    ? `${CHATBOT_SYSTEM_PROMPT}\n\nลูกค้าที่กำลังสนทนา: ${customerContext.firstName} ${customerContext.lastName || ''} — มี ${customerContext.contracts.length} สัญญา`
    : CHATBOT_SYSTEM_PROMPT;

  try {
    const response = await this.anthropic.messages.create({
      model: this.model,
      max_tokens: this.maxTokens,
      system: systemPrompt,
      tools,
      messages: [{ role: 'user', content: userMessage }],
    });

    // Handle tool use
    if (response.stop_reason === 'tool_use') {
      const toolUseBlock = response.content.find((b) => b.type === 'tool_use');
      if (toolUseBlock && toolUseBlock.type === 'tool_use') {
        const toolResult = await this.executeTool(toolUseBlock.name as ChatbotToolName, customerContext);
        // Second call with tool result
        const followUp = await this.anthropic.messages.create({
          model: this.model,
          max_tokens: this.maxTokens,
          system: systemPrompt,
          tools,
          messages: [
            { role: 'user', content: userMessage },
            { role: 'assistant', content: response.content },
            { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUseBlock.id, content: JSON.stringify(toolResult) }] },
          ],
        });
        const textBlock = followUp.content.find((b) => b.type === 'text');
        return textBlock && textBlock.type === 'text' ? textBlock.text : null;
      }
    }

    // Normal text response
    const textBlock = response.content.find((b) => b.type === 'text');
    return textBlock && textBlock.type === 'text' ? textBlock.text : null;
  } catch (error) {
    this.logger.error('Chatbot error:', error);
    return null;
  }
}

private async executeTool(toolName: ChatbotToolName, customer: any): Promise<any> {
  switch (toolName) {
    case 'getContractSummary':
      return customer.contracts.map((c: any) => ({
        contractNumber: c.contractNumber,
        status: c.status,
        remainingBalance: Number(c.remainingBalance),
        installmentNo: c.paidInstallments + 1,
        totalInstallments: c.totalInstallments,
        monthlyPayment: Number(c.monthlyPayment),
        nextDueDate: c.nextDueDate,
      }));
    case 'getPaymentHistory':
      return customer.contracts.flatMap((c: any) =>
        c.payments.map((p: any) => ({
          contractNumber: c.contractNumber,
          amount: Number(p.amount),
          paidAt: p.paidAt,
          method: p.method,
        })),
      ).slice(0, 5);
    case 'getNextPayment':
      const active = customer.contracts.find((c: any) => c.status === 'ACTIVE');
      if (!active) return { message: 'ไม่พบสัญญาที่ active' };
      return {
        contractNumber: active.contractNumber,
        amount: Number(active.monthlyPayment),
        dueDate: active.nextDueDate,
        installmentNo: active.paidInstallments + 1,
        totalInstallments: active.totalInstallments,
      };
    case 'getEarlyPayoff':
      const contract = customer.contracts.find((c: any) => c.status === 'ACTIVE');
      if (!contract) return { message: 'ไม่พบสัญญาที่ active' };
      return {
        contractNumber: contract.contractNumber,
        remainingBalance: Number(contract.remainingBalance),
        message: 'กดปุ่ม "ปิดสัญญาก่อนกำหนด" เพื่อดูยอดปิดที่แน่นอน',
      };
    default:
      return { error: 'Unknown tool' };
  }
}
```

- [ ] **Step 3: Update system prompt**

Add to `apps/api/src/modules/line-oa/chatbot-system-prompt.constants.ts` at the end of `CHATBOT_SYSTEM_PROMPT`:

```ts
// Append context-aware instructions
export const CHATBOT_CONTEXT_INSTRUCTIONS = `

เมื่อลูกค้าถามเกี่ยวกับยอดเงิน สัญญา หรือการชำระ:
- ใช้ tools ที่มี (getContractSummary, getPaymentHistory, getNextPayment, getEarlyPayoff) เพื่อดึงข้อมูลจริง
- ตอบข้อมูลให้ครบถ้วน กระชับ
- แนะนำให้ลูกค้ากดปุ่มใน Rich Menu เพื่อดำเนินการ (ชำระเงิน, ดูสัญญา)
- ห้ามสร้างข้อมูลเอง ถ้าไม่ได้รับจาก tool ให้แจ้งว่าไม่สามารถดึงข้อมูลได้
- ข้อมูลยอดเงินให้แสดงเป็นตัวเลข format: ฿X,XXX.XX
`;
```

- [ ] **Step 4: Update chatbot controller to pass lineUserId**

In `apps/api/src/modules/line-oa/line-oa-chatbot.controller.ts`, update `handleFreeformMessage`:

```ts
// Change from:
const aiResponse = await this.chatbotService.generateResponse(text);
// Change to:
const aiResponse = await this.chatbotService.generateResponse(text, event.source.userId);
```

- [ ] **Step 5: Run type check**

Run: `./tools/check-types.sh api`
Expected: 0 errors

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/line-oa/chatbot/ apps/api/src/modules/line-oa/chatbot.service.ts apps/api/src/modules/line-oa/chatbot-system-prompt.constants.ts apps/api/src/modules/line-oa/line-oa-chatbot.controller.ts
git commit -m "feat(line): context-aware chatbot — tool use for contract/payment data lookup"
```

---

## Task 10: Final Integration & Type Check

**Files:**
- All modified files

- [ ] **Step 1: Full type check**

Run: `./tools/check-types.sh all`
Expected: 0 errors for both api and web

- [ ] **Step 2: Verify all flex-messages exports**

Check that `apps/api/src/modules/line-oa/flex-messages/index.ts` exports all modules including new ones (welcome, verify-success, icons, style-c).

- [ ] **Step 3: Verify RichMenuService is properly injected everywhere**

Ensure `RichMenuService` is in the constructor of `LineOaChatbotController` and `LiffApiController`. Check `line-oa.module.ts` has it as a provider and export.

- [ ] **Step 4: Commit final integration**

```bash
git add -A
git commit -m "feat(line): LINE Experience Upgrade — all-in-one integration complete"
```

---

## Summary

| Task | Description | Complexity |
|------|-------------|-----------|
| 1 | Style C design system foundation | Medium |
| 2 | Rich Menu personalized switching | Medium |
| 3 | Greeting & onboarding flow | High |
| 4 | Flex upgrade: payment-reminder | Low |
| 5 | Flex upgrade: overdue-notice | Low |
| 6 | Flex upgrade: payment-success | Low |
| 7 | Flex upgrade: balance-summary | Low |
| 8 | Flex upgrade: remaining 7 templates | Medium |
| 9 | Chatbot context-aware | High |
| 10 | Final integration & type check | Low |

**Dependencies:** Task 1 must be done first (all others depend on style-c.ts + icons.ts). Tasks 2-9 can be parallelized after Task 1. Task 10 is final.
