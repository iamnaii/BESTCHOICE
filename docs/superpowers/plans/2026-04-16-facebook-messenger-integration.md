# Facebook Messenger Integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable Facebook Messenger as a full chat channel with AI bot, quick replies, templates, persistent menu, and ads sync — matching LINE OA capabilities.

**Architecture:** Separate `facebook-domain` NestJS module with its own domain handler, quick reply service, template service, and persistent menu service. Registered via `DOMAIN_HANDLER_TOKEN` multi-provider. Ads sync is a cron service added to the existing `ads-tracking` module. Existing Facebook adapter and webhook controller are extended, not replaced.

**Tech Stack:** NestJS, Prisma, Facebook Graph API v25.0, Facebook Marketing API v25.0

**Spec:** `docs/superpowers/specs/2026-04-16-facebook-messenger-integration-design.md`

---

## Task 1: Database Migration — `lineUserId` Optional

Make `ChatRoom.lineUserId` nullable so Facebook rooms don't need a dummy value.

**Files:**
- Modify: `apps/api/prisma/schema.prisma:2965`
- Create: `apps/api/prisma/migrations/YYYYMMDD_make_line_user_id_optional/migration.sql`
- Modify: `apps/api/src/modules/chat-engine/services/room-manager.service.ts:104`

- [ ] **Step 1: Update Prisma schema**

In `apps/api/prisma/schema.prisma`, change line 2965:

```prisma
// Before
lineUserId     String    @map("line_user_id")

// After
lineUserId     String?   @map("line_user_id")
```

- [ ] **Step 2: Generate migration**

```bash
cd apps/api && npx prisma migrate dev --name make_line_user_id_optional
```

Expected: Migration created. The generated SQL should contain:
```sql
ALTER TABLE "chat_rooms" ALTER COLUMN "line_user_id" DROP NOT NULL;
```

- [ ] **Step 3: Update RoomManagerService**

In `apps/api/src/modules/chat-engine/services/room-manager.service.ts`, change line 104:

```typescript
// Before
lineUserId: isLineChannel ? params.externalUserId : '',

// After
lineUserId: isLineChannel ? params.externalUserId : null,
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd apps/api && npx tsc --noEmit
```

Expected: 0 errors

- [ ] **Step 5: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations/ apps/api/src/modules/chat-engine/services/room-manager.service.ts
git commit -m "feat: make ChatRoom.lineUserId optional for non-LINE channels"
```

---

## Task 2: Webhook Postback Handling

Add postback event support to the Facebook webhook controller so persistent menu clicks and button taps work.

**Files:**
- Modify: `apps/api/src/modules/chat-adapters/facebook-webhook.controller.ts:117-156`

- [ ] **Step 1: Add postback handling to processMessagingEvent**

In `apps/api/src/modules/chat-adapters/facebook-webhook.controller.ts`, replace the `processMessagingEvent` method:

```typescript
/**
 * Process a single messaging event from Facebook.
 * Supports: text messages, attachments (image/audio/video/file), postbacks.
 * Ignores: read receipts, delivery confirmations, echoes.
 */
private async processMessagingEvent(event: any): Promise<void> {
  const senderId: string | undefined = event.sender?.id;
  const message = event.message;
  const postback = event.postback;

  // Skip echo messages (sent by our page), delivery, and read events
  if (!senderId) return;

  // Handle postback events (persistent menu clicks, button taps)
  if (postback && !message) {
    const referral = postback.referral ?? event.referral;
    const attribution = referral
      ? {
          utmSource: 'facebook',
          utmCampaign: referral.ad_id ?? referral.ref ?? undefined,
          utmContent: referral.ref ?? undefined,
          referrerUrl: referral.source ?? undefined,
        }
      : undefined;

    const inbound: InboundMessage = {
      externalMessageId: `postback_${Date.now()}_${senderId}`,
      externalUserId: senderId,
      channel: ChatChannel.FACEBOOK,
      type: MessageType.TEXT,
      text: postback.payload ?? postback.title ?? '',
      rawPayload: event,
      timestamp: event.timestamp ? new Date(event.timestamp) : new Date(),
      attribution,
    };

    this.logger.log(
      `[FB Webhook] Postback from PSID ${senderId}: "${postback.payload}"`,
    );

    await this.messageRouter.routeInbound(inbound);
    return;
  }

  if (!message || message.is_echo) return;

  const { type, text, mediaUrl } = this.parseMessage(message);

  // Extract Facebook referral / ad attribution data
  const referral = event.referral ?? event.postback?.referral;
  const attribution = referral
    ? {
        utmSource: 'facebook',
        utmCampaign: referral.ad_id ?? referral.ref ?? undefined,
        utmContent: referral.ref ?? undefined,
        referrerUrl: referral.source ?? undefined,
      }
    : undefined;

  const inbound: InboundMessage = {
    externalMessageId: message.mid,
    externalUserId: senderId,
    channel: ChatChannel.FACEBOOK,
    type,
    text: text ?? undefined,
    mediaUrl: mediaUrl ?? undefined,
    rawPayload: event,
    timestamp: event.timestamp ? new Date(event.timestamp) : new Date(),
    attribution,
  };

  this.logger.log(
    `[FB Webhook] Inbound ${type} from PSID ${senderId} (mid: ${message.mid})${attribution ? ' [with attribution]' : ''}`,
  );

  await this.messageRouter.routeInbound(inbound);
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd apps/api && npx tsc --noEmit
```

Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/modules/chat-adapters/facebook-webhook.controller.ts
git commit -m "feat: add Facebook postback event handling for persistent menu"
```

---

## Task 3: Facebook Adapter — Template & Quick Reply Support

Enhance `FacebookAdapter.sendMessage()` to properly handle `templatePayload` and add a quick reply helper.

**Files:**
- Modify: `apps/api/src/modules/chat-adapters/facebook.adapter.ts:49-82`

- [ ] **Step 1: Update sendMessage to handle templatePayload and quickReplies**

In `apps/api/src/modules/chat-adapters/facebook.adapter.ts`, replace the `sendMessage` method:

```typescript
async sendMessage(message: OutboundMessage): Promise<SendResult> {
  if (!this.isConfigured) {
    return { success: false, error: 'Facebook page access token or page ID not configured' };
  }

  try {
    const fbMessage: Record<string, unknown> = {};

    if (message.templatePayload) {
      // Template payload (Generic, Button, Media templates)
      fbMessage.attachment = message.templatePayload;

      // Attach quick_replies if present alongside template
      if (message.templatePayload.quick_replies) {
        fbMessage.quick_replies = message.templatePayload.quick_replies;
        delete (fbMessage.attachment as Record<string, unknown>).quick_replies;
      }
    } else if (message.text) {
      fbMessage.text = message.text;
    }

    // Quick replies can also be set directly on templatePayload root
    if (message.templatePayload?.quick_replies && !fbMessage.quick_replies) {
      fbMessage.quick_replies = message.templatePayload.quick_replies;
    }

    const body: Record<string, unknown> = {
      messaging_type: 'RESPONSE',
      recipient: { id: message.externalUserId },
      message: fbMessage,
    };

    const res = await fetch(`${this.graphApiUrl}?access_token=${this.pageAccessToken}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errBody = await res.text();
      this.logger.error(`[FB] API error ${res.status}: ${errBody}`);
      return { success: false, error: errBody };
    }

    const data = (await res.json()) as { message_id?: string };
    return { success: true, externalMessageId: data.message_id };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    this.logger.error(`[FB] send failed: ${errorMsg}`);
    return { success: false, error: errorMsg };
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd apps/api && npx tsc --noEmit
```

Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/modules/chat-adapters/facebook.adapter.ts
git commit -m "feat: enhance Facebook adapter with template and quick reply support"
```

---

## Task 4: Facebook Quick Reply Service

Create `FacebookQuickReplyService` — same 7 button sets as LINE but in Facebook format.

**Files:**
- Create: `apps/api/src/modules/facebook-domain/facebook-quick-reply.service.ts`

- [ ] **Step 1: Create the service**

Create `apps/api/src/modules/facebook-domain/facebook-quick-reply.service.ts`:

```typescript
import { Injectable } from '@nestjs/common';

/**
 * Facebook Quick Reply button format.
 * https://developers.facebook.com/docs/messenger-platform/send-messages/quick-replies
 *
 * Constraints:
 * - Max 13 quick replies per message
 * - Title max 20 characters
 * - Payload max 1,000 characters
 */
export interface FacebookQuickReply {
  content_type: 'text';
  title: string;
  payload: string;
}

@Injectable()
export class FacebookQuickReplyService {
  /** Quick Reply สำหรับทักทาย/ข้อความแรก */
  greeting(): FacebookQuickReply[] {
    return [
      { content_type: 'text', title: '📱 ดูสินค้า', payload: 'ดูสินค้า' },
      { content_type: 'text', title: '💰 สอบถามราคา', payload: 'สอบถามราคา' },
      { content_type: 'text', title: '📄 ดูสัญญา', payload: 'ดูสัญญา' },
      { content_type: 'text', title: '💬 คุยกับพนักงาน', payload: 'คุยกับพนักงาน' },
    ];
  }

  /** Quick Reply หลังชำระเงิน */
  afterPayment(): FacebookQuickReply[] {
    return [
      { content_type: 'text', title: '🧾 ดูใบเสร็จ', payload: 'ดูใบเสร็จ' },
      { content_type: 'text', title: '💰 ดูยอดคงเหลือ', payload: 'ดูยอดคงเหลือ' },
      { content_type: 'text', title: '📄 ดูสัญญา', payload: 'ดูสัญญา' },
    ];
  }

  /** Quick Reply สำหรับเลือก brand */
  brandSelection(): FacebookQuickReply[] {
    return [
      { content_type: 'text', title: '🍎 iPhone', payload: 'iPhone' },
      { content_type: 'text', title: '📱 Samsung', payload: 'Samsung' },
      { content_type: 'text', title: '📱 OPPO', payload: 'OPPO' },
      { content_type: 'text', title: '📱 vivo', payload: 'vivo' },
      { content_type: 'text', title: '📱 Xiaomi', payload: 'Xiaomi' },
      { content_type: 'text', title: '🔍 อื่นๆ', payload: 'ดูทั้งหมด' },
    ];
  }

  /** Quick Reply สำหรับถามข้อมูลเพิ่ม */
  moreInfo(): FacebookQuickReply[] {
    return [
      { content_type: 'text', title: '💳 เงื่อนไขผ่อน', payload: 'เงื่อนไขผ่อน' },
      { content_type: 'text', title: '📍 สาขา', payload: 'สาขาไหนบ้าง' },
      { content_type: 'text', title: '📋 เอกสาร', payload: 'ใช้เอกสารอะไร' },
      { content_type: 'text', title: '💬 คุยกับพนักงาน', payload: 'คุยกับพนักงาน' },
    ];
  }

  /** Quick Reply สำหรับ onboarding ใหม่ (ลูกค้า FB = ไม่แยก shop/finance) */
  onboarding(): FacebookQuickReply[] {
    return [
      { content_type: 'text', title: 'ลูกค้าใหม่', payload: 'ลูกค้าใหม่' },
      { content_type: 'text', title: 'มีสัญญาอยู่แล้ว', payload: 'ลงทะเบียน' },
      { content_type: 'text', title: 'วิธีชำระเงิน', payload: 'วิธีชำระเงิน' },
    ];
  }

  /** Quick Reply สำหรับลูกค้า verified ที่กลับมา */
  verifiedReturn(): FacebookQuickReply[] {
    return [
      { content_type: 'text', title: 'เช็คยอด', payload: 'เช็คยอด' },
      { content_type: 'text', title: 'ดูสัญญา', payload: 'สัญญา' },
      { content_type: 'text', title: 'ช่วยเหลือ', payload: 'ช่วยเหลือ' },
    ];
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd apps/api && npx tsc --noEmit
```

Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/modules/facebook-domain/facebook-quick-reply.service.ts
git commit -m "feat: add FacebookQuickReplyService with 6 button sets"
```

---

## Task 5: Facebook Template Service

Create templates that convert key LINE Flex Messages into Facebook Generic/Button/Media templates.

**Files:**
- Create: `apps/api/src/modules/facebook-domain/facebook-template.service.ts`

- [ ] **Step 1: Create the template service**

Create `apps/api/src/modules/facebook-domain/facebook-template.service.ts`:

```typescript
import { Injectable } from '@nestjs/common';

/**
 * Facebook Template builder — converts business data into Facebook Messenger
 * template payloads (Generic, Button, Media).
 *
 * Equivalent of LINE Flex Messages but using Facebook's template format.
 * https://developers.facebook.com/docs/messenger-platform/send-messages/template/generic
 *
 * Each method returns a templatePayload object ready for OutboundMessage.templatePayload.
 */
@Injectable()
export class FacebookTemplateService {
  /**
   * Balance summary — shows contract balance as a Generic Template card.
   * LINE equivalent: balance-summary.flex.ts
   */
  balanceSummary(data: {
    contractNumber: string;
    totalInstallments: number;
    paidInstallments: number;
    nextDueDate: string | null;
    nextAmountDue: number;
    totalOutstanding: number;
    status: string;
    paymentUrl?: string;
  }): Record<string, unknown> {
    const isOverdue = data.status === 'OVERDUE' || data.status === 'DEFAULT';
    const statusText = isOverdue ? '⚠️ ค้างชำระ' : '✅ ปกติ';

    return {
      type: 'template',
      payload: {
        template_type: 'generic',
        elements: [
          {
            title: `สรุปยอดสัญญา ${data.contractNumber}`,
            subtitle: [
              `สถานะ: ${statusText}`,
              `ยอดคงเหลือ: ฿${this.formatNumber(data.totalOutstanding)}`,
              `ชำระแล้ว: ${data.paidInstallments}/${data.totalInstallments} งวด`,
              data.nextDueDate
                ? `งวดถัดไป: ${data.nextDueDate} — ฿${this.formatNumber(data.nextAmountDue)}`
                : 'ชำระครบแล้ว',
            ].join('\n'),
            buttons: [
              ...(data.paymentUrl
                ? [{ type: 'web_url', url: data.paymentUrl, title: 'ชำระเงิน' }]
                : [{ type: 'postback', title: 'ชำระเงิน', payload: 'ชำระ' }]),
              { type: 'postback', title: 'ดูรายละเอียด', payload: `ดูสัญญา ${data.contractNumber}` },
            ],
          },
        ],
      },
    };
  }

  /**
   * Payment reminder — shows upcoming due date as a Button Template.
   * LINE equivalent: payment-reminder.flex.ts
   */
  paymentReminder(data: {
    contractNumber: string;
    installmentNo: number;
    totalInstallments: number;
    amountDue: number;
    dueDate: string;
    daysUntilDue: number;
    paymentUrl?: string;
  }): Record<string, unknown> {
    const urgency =
      data.daysUntilDue === 0
        ? '🔴 วันนี้!'
        : data.daysUntilDue === 1
        ? '🟠 พรุ่งนี้'
        : `🟢 อีก ${data.daysUntilDue} วัน`;

    return {
      type: 'template',
      payload: {
        template_type: 'button',
        text: [
          `📋 แจ้งเตือนค่างวด ${urgency}`,
          `สัญญา: ${data.contractNumber}`,
          `งวดที่: ${data.installmentNo}/${data.totalInstallments}`,
          `ยอดชำระ: ฿${this.formatNumber(data.amountDue)}`,
          `ครบกำหนด: ${data.dueDate}`,
        ].join('\n'),
        buttons: [
          data.paymentUrl
            ? { type: 'web_url', url: data.paymentUrl, title: 'ชำระเงิน' }
            : { type: 'postback', title: 'ชำระเงิน', payload: 'ชำระ' },
          { type: 'postback', title: 'ดูรายละเอียด', payload: `ดูสัญญา ${data.contractNumber}` },
        ],
      },
    };
  }

  /**
   * Overdue notice — shows overdue amount as a Button Template.
   * LINE equivalent: overdue-notice.flex.ts
   */
  overdueNotice(data: {
    contractNumber: string;
    totalOverdue: number;
    lateFee: number;
    daysOverdue: number;
    paymentUrl?: string;
  }): Record<string, unknown> {
    return {
      type: 'template',
      payload: {
        template_type: 'button',
        text: [
          `⚠️ แจ้งเตือนค้างชำระ`,
          `สัญญา: ${data.contractNumber}`,
          `ค้างชำระ: ฿${this.formatNumber(data.totalOverdue)}`,
          `ค่าปรับล่าช้า: ฿${this.formatNumber(data.lateFee)}`,
          `เลยกำหนด: ${data.daysOverdue} วัน`,
        ].join('\n'),
        buttons: [
          data.paymentUrl
            ? { type: 'web_url', url: data.paymentUrl, title: 'ชำระเงินตอนนี้' }
            : { type: 'postback', title: 'ชำระเงินตอนนี้', payload: 'ชำระ' },
          { type: 'postback', title: 'คุยกับพนักงาน', payload: 'คุยกับพนักงาน' },
        ],
      },
    };
  }

  /**
   * Payment success — confirmation card after payment.
   * LINE equivalent: payment-success.flex.ts
   */
  paymentSuccess(data: {
    contractNumber: string;
    amountPaid: number;
    method: string;
    remainingInstallments: number;
    receiptNo?: string;
  }): Record<string, unknown> {
    return {
      type: 'template',
      payload: {
        template_type: 'generic',
        elements: [
          {
            title: '✅ ชำระเงินสำเร็จ',
            subtitle: [
              `สัญญา: ${data.contractNumber}`,
              `จำนวน: ฿${this.formatNumber(data.amountPaid)}`,
              `ช่องทาง: ${data.method}`,
              `งวดคงเหลือ: ${data.remainingInstallments} งวด`,
              data.receiptNo ? `เลขที่ใบเสร็จ: ${data.receiptNo}` : '',
            ]
              .filter(Boolean)
              .join('\n'),
            buttons: [
              { type: 'postback', title: 'ดูใบเสร็จ', payload: 'ดูใบเสร็จ' },
              { type: 'postback', title: 'ดูยอดคงเหลือ', payload: 'ดูยอดคงเหลือ' },
            ],
          },
        ],
      },
    };
  }

  /**
   * Receipt — payment receipt card.
   * LINE equivalent: receipt.flex.ts
   */
  receipt(data: {
    receiptNo: string;
    customerName: string;
    amountPaid: number;
    method: string;
    paidDate: string;
    remainingBalance: number;
  }): Record<string, unknown> {
    return {
      type: 'template',
      payload: {
        template_type: 'generic',
        elements: [
          {
            title: `🧾 ใบเสร็จ #${data.receiptNo}`,
            subtitle: [
              `ลูกค้า: ${data.customerName}`,
              `จำนวน: ฿${this.formatNumber(data.amountPaid)}`,
              `ช่องทาง: ${data.method}`,
              `วันที่: ${data.paidDate}`,
              `ยอดคงเหลือ: ฿${this.formatNumber(data.remainingBalance)}`,
            ].join('\n'),
            buttons: [
              { type: 'postback', title: 'ดูยอดคงเหลือ', payload: 'ดูยอดคงเหลือ' },
            ],
          },
        ],
      },
    };
  }

  /**
   * PromptPay QR — shows QR code image with payment link.
   * LINE equivalent: promptpay-qr.flex.ts
   */
  promptpayQr(data: {
    qrImageUrl: string;
    amount: number;
    paymentUrl?: string;
  }): Record<string, unknown> {
    return {
      type: 'template',
      payload: {
        template_type: 'generic',
        elements: [
          {
            title: `💳 สแกนจ่าย ฿${this.formatNumber(data.amount)}`,
            subtitle: 'สแกน QR Code เพื่อชำระเงินผ่าน PromptPay',
            image_url: data.qrImageUrl,
            buttons: data.paymentUrl
              ? [{ type: 'web_url', url: data.paymentUrl, title: 'ชำระผ่านลิงก์' }]
              : [{ type: 'postback', title: 'ยืนยันการชำระ', payload: 'ยืนยันชำระ' }],
          },
        ],
      },
    };
  }

  /**
   * Contract signed — new contract confirmation card.
   * LINE equivalent: contract-signed.flex.ts
   */
  contractSigned(data: {
    contractNumber: string;
    productName: string;
    monthlyPayment: number;
    totalMonths: number;
    downloadUrl?: string;
  }): Record<string, unknown> {
    return {
      type: 'template',
      payload: {
        template_type: 'generic',
        elements: [
          {
            title: `📄 สัญญาเช่าซื้อ ${data.contractNumber}`,
            subtitle: [
              `สินค้า: ${data.productName}`,
              `ค่างวด: ฿${this.formatNumber(data.monthlyPayment)}/เดือน`,
              `จำนวน: ${data.totalMonths} งวด`,
            ].join('\n'),
            buttons: [
              ...(data.downloadUrl
                ? [{ type: 'web_url', url: data.downloadUrl, title: 'ดาวน์โหลดสัญญา' }]
                : []),
              { type: 'postback', title: 'เช็คยอด', payload: 'เช็คยอด' },
            ],
          },
        ],
      },
    };
  }

  private formatNumber(n: number): string {
    return n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd apps/api && npx tsc --noEmit
```

Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/modules/facebook-domain/facebook-template.service.ts
git commit -m "feat: add FacebookTemplateService with 7 template builders"
```

---

## Task 6: Facebook Persistent Menu Service

Create service to set/remove persistent menu via Graph API.

**Files:**
- Create: `apps/api/src/modules/facebook-domain/facebook-persistent-menu.service.ts`

- [ ] **Step 1: Create the service**

Create `apps/api/src/modules/facebook-domain/facebook-persistent-menu.service.ts`:

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Manages the Facebook Messenger persistent menu via Graph API.
 * Equivalent of LINE Rich Menu.
 *
 * Constraints:
 * - Max 3 top-level items
 * - Each top-level can have up to 5 nested items
 * - Title max 30 characters
 *
 * API: POST /{PAGE_ID}/messenger_profile
 * https://developers.facebook.com/docs/messenger-platform/reference/messenger-profile-api/persistent-menu
 */
@Injectable()
export class FacebookPersistentMenuService {
  private readonly logger = new Logger(FacebookPersistentMenuService.name);
  private readonly pageAccessToken?: string;
  private readonly pageId?: string;

  constructor(private configService: ConfigService) {
    this.pageAccessToken = this.configService.get<string>('FB_PAGE_ACCESS_TOKEN');
    this.pageId = this.configService.get<string>('FB_PAGE_ID');
  }

  private get isConfigured(): boolean {
    return !!this.pageAccessToken && !!this.pageId;
  }

  /**
   * Set the persistent menu for the Facebook Page.
   * Call once on setup or when menu needs updating.
   */
  async setupMenu(): Promise<{ success: boolean; error?: string }> {
    if (!this.isConfigured) {
      return { success: false, error: 'Facebook not configured' };
    }

    const menu = {
      persistent_menu: [
        {
          locale: 'default',
          composer_input_disabled: false,
          call_to_actions: [
            {
              type: 'nested',
              title: '📊 เช็คข้อมูล',
              call_to_actions: [
                { type: 'postback', title: 'เช็คยอด', payload: 'เช็คยอด' },
                { type: 'postback', title: 'ดูสัญญา', payload: 'ดูสัญญา' },
                { type: 'postback', title: 'ประวัติชำระ', payload: 'ประวัติชำระ' },
              ],
            },
            {
              type: 'postback',
              title: '💳 ชำระเงิน',
              payload: 'ชำระ',
            },
            {
              type: 'nested',
              title: '📞 ติดต่อเรา',
              call_to_actions: [
                { type: 'postback', title: 'คุยกับพนักงาน', payload: 'คุยกับพนักงาน' },
                {
                  type: 'web_url',
                  title: 'แผนที่ร้าน',
                  url: 'https://maps.google.com/?q=BESTCHOICE',
                },
              ],
            },
          ],
        },
      ],
    };

    try {
      const res = await fetch(
        `https://graph.facebook.com/v25.0/${this.pageId}/messenger_profile?access_token=${this.pageAccessToken}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(menu),
        },
      );

      if (!res.ok) {
        const errBody = await res.text();
        this.logger.error(`[FB Menu] Setup failed ${res.status}: ${errBody}`);
        return { success: false, error: errBody };
      }

      this.logger.log('[FB Menu] Persistent menu set successfully');
      return { success: true };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.logger.error(`[FB Menu] Setup error: ${errorMsg}`);
      return { success: false, error: errorMsg };
    }
  }

  /**
   * Remove the persistent menu from the Facebook Page.
   */
  async removeMenu(): Promise<{ success: boolean; error?: string }> {
    if (!this.isConfigured) {
      return { success: false, error: 'Facebook not configured' };
    }

    try {
      const res = await fetch(
        `https://graph.facebook.com/v25.0/${this.pageId}/messenger_profile?access_token=${this.pageAccessToken}`,
        {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fields: ['persistent_menu'] }),
        },
      );

      if (!res.ok) {
        const errBody = await res.text();
        this.logger.error(`[FB Menu] Remove failed ${res.status}: ${errBody}`);
        return { success: false, error: errBody };
      }

      this.logger.log('[FB Menu] Persistent menu removed');
      return { success: true };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.logger.error(`[FB Menu] Remove error: ${errorMsg}`);
      return { success: false, error: errorMsg };
    }
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd apps/api && npx tsc --noEmit
```

Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/modules/facebook-domain/facebook-persistent-menu.service.ts
git commit -m "feat: add FacebookPersistentMenuService for Messenger persistent menu"
```

---

## Task 7: Facebook Domain Handler

Create the main domain handler that processes inbound Facebook messages and routes to AI/quick replies/templates.

**Files:**
- Create: `apps/api/src/modules/facebook-domain/facebook-domain.handler.ts`

- [ ] **Step 1: Create the handler**

Create `apps/api/src/modules/facebook-domain/facebook-domain.handler.ts`:

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { ChatChannel, MessageType } from '@prisma/client';
import {
  IDomainHandler,
  DomainContext,
  DomainResult,
} from '../chat-engine/interfaces/domain-handler.interface';
import { OutboundMessage } from '../chat-engine/interfaces/channel-adapter.interface';
import { FacebookQuickReplyService, FacebookQuickReply } from './facebook-quick-reply.service';

/**
 * FacebookDomainHandler — processes messages from Facebook Messenger.
 *
 * Separate from LINE handlers to allow Facebook-specific customization
 * (templates, quick replies, persistent menu payloads).
 *
 * Logic branches:
 * 1. Handoff active → don't process (staff handles)
 * 2. Not verified → prompt with onboarding quick replies
 * 3. Image (slip) → acknowledge + tag
 * 4. Text → AI route (same as LINE finance, handled by AI auto-reply in MessageRouter)
 */
@Injectable()
export class FacebookDomainHandler implements IDomainHandler {
  readonly supportedChannels: ChatChannel[] = [ChatChannel.FACEBOOK];
  private readonly logger = new Logger(FacebookDomainHandler.name);

  constructor(private quickReply: FacebookQuickReplyService) {}

  supportsChannel(channel: ChatChannel): boolean {
    return this.supportedChannels.includes(channel);
  }

  async handleMessage(context: DomainContext): Promise<DomainResult> {
    const { room, message, isVerified, isHandoff } = context;

    // If in handoff mode, don't process with AI
    if (isHandoff) {
      return { replies: [] };
    }

    // If not verified, prompt for verification with onboarding quick replies
    if (!isVerified) {
      return {
        replies: [
          this.buildTextReplyWithQuickReplies(
            message.externalUserId,
            'สวัสดีค่ะ ยินดีต้อนรับสู่ BESTCHOICE 🏪\nรบกวนยืนยันตัวตนก่อนนะคะ เพื่อความปลอดภัยของข้อมูลค่ะ 🔐',
            this.quickReply.onboarding(),
          ),
        ],
      };
    }

    // Handle image messages (slip processing)
    if (message.type === MessageType.IMAGE && message.mediaUrl) {
      return {
        replies: [
          this.buildTextReplyWithQuickReplies(
            message.externalUserId,
            'ได้รับสลิปแล้วค่ะ กำลังตรวจสอบ... 🔍',
            this.quickReply.afterPayment(),
          ),
        ],
        tags: ['slip'],
      };
    }

    // Handle text messages
    // The AI auto-reply in MessageRouter handles intent detection.
    // This handler provides fallback quick replies when AI doesn't fire.
    if (message.text) {
      this.logger.debug(
        `[FacebookDomain] text from room ${room.id}: ${message.text.substring(0, 50)}`,
      );

      // Handle specific payloads from persistent menu / quick replies
      const payload = message.text.trim();

      if (payload === 'คุยกับพนักงาน') {
        return {
          replies: [
            this.buildTextReply(
              message.externalUserId,
              'กำลังส่งต่อให้พนักงานค่ะ รอสักครู่นะคะ 🙏',
            ),
          ],
          shouldHandoff: true,
          handoffReason: 'ลูกค้าขอพูดกับพนักงานผ่าน Facebook',
          handoffPriority: 'normal',
        };
      }

      // For other text, return empty replies to let AI auto-reply handle it.
      // If AI auto-reply is off/errors, the message is stored for staff.
      return { replies: [] };
    }

    return { replies: [] };
  }

  private buildTextReply(
    externalUserId: string,
    text: string,
  ): OutboundMessage {
    return {
      externalUserId,
      channel: ChatChannel.FACEBOOK,
      type: MessageType.TEXT,
      text,
    };
  }

  private buildTextReplyWithQuickReplies(
    externalUserId: string,
    text: string,
    quickReplies: FacebookQuickReply[],
  ): OutboundMessage {
    return {
      externalUserId,
      channel: ChatChannel.FACEBOOK,
      type: MessageType.TEXT,
      text,
      templatePayload: { quick_replies: quickReplies },
    };
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd apps/api && npx tsc --noEmit
```

Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/modules/facebook-domain/facebook-domain.handler.ts
git commit -m "feat: add FacebookDomainHandler with quick replies and handoff"
```

---

## Task 8: Facebook Domain Module + Registration

Create the NestJS module and register the domain handler via `DOMAIN_HANDLER_TOKEN`.

**Files:**
- Create: `apps/api/src/modules/facebook-domain/facebook-domain.module.ts`
- Modify: `apps/api/src/modules/chat-adapters/chat-adapters.module.ts`
- Modify: `apps/api/src/app.module.ts`

- [ ] **Step 1: Create the module**

Create `apps/api/src/modules/facebook-domain/facebook-domain.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { FacebookDomainHandler } from './facebook-domain.handler';
import { FacebookQuickReplyService } from './facebook-quick-reply.service';
import { FacebookTemplateService } from './facebook-template.service';
import { FacebookPersistentMenuService } from './facebook-persistent-menu.service';
import { DOMAIN_HANDLER_TOKEN } from '../chat-engine/interfaces/domain-handler.interface';

/**
 * FacebookDomainModule — handles Facebook Messenger business logic.
 *
 * Provides:
 * - FacebookDomainHandler (registered as DOMAIN_HANDLER_TOKEN)
 * - FacebookQuickReplyService (7 button sets)
 * - FacebookTemplateService (7 template builders)
 * - FacebookPersistentMenuService (persistent menu setup)
 */
@Module({
  providers: [
    FacebookDomainHandler,
    FacebookQuickReplyService,
    FacebookTemplateService,
    FacebookPersistentMenuService,
    {
      provide: DOMAIN_HANDLER_TOKEN,
      useExisting: FacebookDomainHandler,
    },
  ],
  exports: [
    FacebookDomainHandler,
    FacebookQuickReplyService,
    FacebookTemplateService,
    FacebookPersistentMenuService,
    DOMAIN_HANDLER_TOKEN,
  ],
})
export class FacebookDomainModule {}
```

- [ ] **Step 2: Import FacebookDomainModule in ChatAdaptersModule**

In `apps/api/src/modules/chat-adapters/chat-adapters.module.ts`, add the import:

```typescript
import { FacebookDomainModule } from '../facebook-domain/facebook-domain.module';

@Module({
  imports: [ChatbotFinanceModule, LineOaModule, ChatEngineModule, FacebookDomainModule],
  // ... rest unchanged
})
export class ChatAdaptersModule {}
```

- [ ] **Step 3: Import FacebookDomainModule in AppModule**

In `apps/api/src/app.module.ts`, add the import alongside other modules:

```typescript
import { FacebookDomainModule } from './modules/facebook-domain/facebook-domain.module';
```

Add `FacebookDomainModule` to the `imports` array (after `ChatAdaptersModule`).

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd apps/api && npx tsc --noEmit
```

Expected: 0 errors

- [ ] **Step 5: Verify the API starts and handler is registered**

```bash
cd apps/api && npm run start:dev
```

Expected in logs: `Registered adapter: FACEBOOK` and `Registered 3 domain handler(s)` (LINE_FINANCE, LINE_SHOP, FACEBOOK)

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/facebook-domain/facebook-domain.module.ts apps/api/src/modules/chat-adapters/chat-adapters.module.ts apps/api/src/app.module.ts
git commit -m "feat: register FacebookDomainModule with DOMAIN_HANDLER_TOKEN"
```

---

## Task 9: Facebook Ads Sync Service

Create a cron service to auto-sync campaign data from Facebook Marketing API.

**Files:**
- Create: `apps/api/src/modules/ads-tracking/facebook-ads-sync.service.ts`
- Modify: `apps/api/src/modules/ads-tracking/ads-tracking.module.ts` (add provider)

- [ ] **Step 1: Create the sync service**

Create `apps/api/src/modules/ads-tracking/facebook-ads-sync.service.ts`:

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { AdsPlatform, Prisma } from '@prisma/client';
import * as Sentry from '@sentry/node';

/**
 * FacebookAdsSyncService — syncs campaign data from Facebook Marketing API.
 *
 * Runs every 4 hours to pull campaign spend, impressions, clicks, and reach.
 * Upserts AdsCampaign records matched by (platform=FACEBOOK_ADS, campaignId).
 *
 * API: GET /act_{AD_ACCOUNT_ID}/campaigns?fields=id,name,status,...
 * https://developers.facebook.com/docs/marketing-api/reference/ad-campaign-group/
 *
 * Required env:
 * - FB_AD_ACCOUNT_ID (e.g. "act_123456789")
 * - FB_PAGE_ACCESS_TOKEN (must have ads_read permission)
 */
@Injectable()
export class FacebookAdsSyncService {
  private readonly logger = new Logger(FacebookAdsSyncService.name);
  private readonly adAccountId?: string;
  private readonly accessToken?: string;

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
  ) {
    this.adAccountId = this.configService.get<string>('FB_AD_ACCOUNT_ID');
    this.accessToken = this.configService.get<string>('FB_PAGE_ACCESS_TOKEN');
  }

  private get isConfigured(): boolean {
    return !!this.adAccountId && !!this.accessToken;
  }

  /**
   * Sync campaigns every 4 hours.
   * Runs at minute 0 of hours 0, 4, 8, 12, 16, 20.
   */
  @Cron('0 */4 * * *')
  async syncCampaigns(): Promise<void> {
    if (!this.isConfigured) {
      this.logger.debug('[FB Ads Sync] Not configured — skipping');
      return;
    }

    this.logger.log('[FB Ads Sync] Starting campaign sync...');

    try {
      const campaigns = await this.fetchCampaigns();
      let upserted = 0;

      for (const campaign of campaigns) {
        await this.upsertCampaign(campaign);
        upserted++;
      }

      this.logger.log(`[FB Ads Sync] Synced ${upserted} campaigns`);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.logger.error(`[FB Ads Sync] Failed: ${errorMsg}`);
      Sentry.captureException(err, { tags: { cron: 'facebook-ads-sync' } });
    }
  }

  private async fetchCampaigns(): Promise<FbCampaignData[]> {
    const fields = [
      'id',
      'name',
      'status',
      'daily_budget',
      'lifetime_budget',
      'start_time',
      'stop_time',
      'insights{spend,impressions,clicks,reach}',
    ].join(',');

    const url = `https://graph.facebook.com/v25.0/${this.adAccountId}/campaigns?fields=${fields}&access_token=${this.accessToken}`;

    const res = await fetch(url, {
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Facebook Marketing API ${res.status}: ${body}`);
    }

    const json = (await res.json()) as { data: FbCampaignData[] };
    return json.data ?? [];
  }

  private async upsertCampaign(fb: FbCampaignData): Promise<void> {
    const budget = fb.lifetime_budget
      ? Number(fb.lifetime_budget) / 100 // FB returns in cents
      : fb.daily_budget
      ? Number(fb.daily_budget) / 100
      : 0;

    const insights = fb.insights?.data?.[0];
    const spend = insights?.spend ? Number(insights.spend) : undefined;

    // Find existing campaign
    const existing = await this.prisma.adsCampaign.findFirst({
      where: {
        platform: AdsPlatform.FACEBOOK_ADS,
        campaignId: fb.id,
        deletedAt: null,
      },
    });

    const data = {
      campaignName: fb.name,
      budget: new Prisma.Decimal(spend ?? budget),
      isActive: fb.status === 'ACTIVE',
      startDate: fb.start_time ? new Date(fb.start_time) : undefined,
      endDate: fb.stop_time ? new Date(fb.stop_time) : undefined,
    };

    if (existing) {
      await this.prisma.adsCampaign.update({
        where: { id: existing.id },
        data,
      });
    } else {
      await this.prisma.adsCampaign.create({
        data: {
          platform: AdsPlatform.FACEBOOK_ADS,
          campaignId: fb.id,
          ...data,
        },
      });
    }
  }
}

/** Raw response shape from Facebook Marketing API */
interface FbCampaignData {
  id: string;
  name: string;
  status: string;
  daily_budget?: string;
  lifetime_budget?: string;
  start_time?: string;
  stop_time?: string;
  insights?: {
    data?: Array<{
      spend?: string;
      impressions?: string;
      clicks?: string;
      reach?: string;
    }>;
  };
}
```

- [ ] **Step 2: Register in AdsTrackingModule**

Find `apps/api/src/modules/ads-tracking/ads-tracking.module.ts` and add `FacebookAdsSyncService` to `providers`:

```typescript
import { FacebookAdsSyncService } from './facebook-ads-sync.service';

// Add to providers array:
providers: [AdsTrackingService, AdsTrackingController, FacebookAdsSyncService],
```

If AdsTrackingModule doesn't use a separate `providers` array (controller-in-module pattern), add `FacebookAdsSyncService` to the providers list.

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd apps/api && npx tsc --noEmit
```

Expected: 0 errors

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/ads-tracking/facebook-ads-sync.service.ts apps/api/src/modules/ads-tracking/ads-tracking.module.ts
git commit -m "feat: add FacebookAdsSyncService — cron syncs campaigns from Marketing API"
```

---

## Task 10: Environment Variables + Documentation

Add Facebook env vars to `.env.example` and update the actual `.env` for development.

**Files:**
- Modify: `apps/api/.env` (add placeholder FB vars)

- [ ] **Step 1: Add FB vars to .env**

Add the following to `apps/api/.env` (at the end, with comments):

```bash
# ─── Facebook Messenger ───────────────────────────
FB_APP_SECRET=             # App Settings > Basic > App Secret
FB_PAGE_ACCESS_TOKEN=      # Messenger Settings > Generate Token
FB_PAGE_ID=                # Facebook Page ID
FB_VERIFY_TOKEN=bestchoice_fb_verify_2026  # Random string for webhook verification

# ─── Facebook Ads (optional — for auto-sync) ──────
FB_AD_ACCOUNT_ID=          # act_XXXXXXXXX from Ads Manager
```

- [ ] **Step 2: Commit**

```bash
git add apps/api/.env
git commit -m "chore: add Facebook env var placeholders to .env"
```

---

## Task 11: Verify End-to-End + TypeScript Check

Final verification that everything compiles and the API starts.

**Files:** None (verification only)

- [ ] **Step 1: Full TypeScript check**

```bash
./tools/check-types.sh all
```

Expected: 0 errors in both `api` and `web`

- [ ] **Step 2: Start API and verify handler registration**

```bash
cd apps/api && npm run start:dev
```

Expected in logs:
- `Registered adapter: FACEBOOK`
- `Registered 3 domain handler(s)` (or similar — confirming FACEBOOK handler loaded)
- No startup errors

- [ ] **Step 3: Verify webhook endpoint is accessible**

```bash
curl "http://localhost:3000/webhooks/facebook?hub.mode=subscribe&hub.verify_token=bestchoice_fb_verify_2026&hub.challenge=test123"
```

Expected: `test123` (the challenge echoed back)

- [ ] **Step 4: Final commit (if any fixes were needed)**

```bash
git add -A
git commit -m "fix: resolve issues from integration verification"
```
