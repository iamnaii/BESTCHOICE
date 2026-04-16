# Facebook Messenger Integration — Design Spec

**Date**: 2026-04-16
**Status**: Draft
**Approach**: Separate Facebook Domain Handler (Approach B)

---

## 1. Goal

เปิด Facebook Messenger เป็นช่องทางแชทลูกค้าของ BESTCHOICE เทียบเท่า LINE OA:
- รับแชทจาก Facebook Page → Unified Inbox ให้ staff ตอบ
- AI bot ตอบอัตโนมัติ (ตรวจยอด, สถานะสัญญา, แจ้งชำระ)
- Quick Replies, Templates, Persistent Menu เหมือน LINE
- Auto-sync Facebook Ads campaign data (spend, impressions, clicks)

**ไม่อยู่ใน scope**: Broadcast/Sponsored Messages, Facebook Login, TikTok/Web channels

---

## 2. What Already Exists

| Component | Status | File |
|-----------|--------|------|
| Facebook Adapter (send/receive) | Done | `chat-adapters/facebook.adapter.ts` |
| Webhook Controller (HMAC verify) | Done | `chat-adapters/facebook-webhook.controller.ts` |
| Chat Engine (router, rooms, handoff) | Done | `chat-engine/` |
| Unified Inbox + Channel Filter | Done | `UnifiedInboxPage/`, `ChannelFilter.tsx` |
| Channel Settings UI (FB config) | Done | `ChannelSettingsPage.tsx` |
| Ads Attribution (webhook → ROI) | Done | `ads-tracking/`, webhook referral extraction |
| `ChatChannel.FACEBOOK` enum | Done | `schema.prisma` |
| `AdsPlatform.FACEBOOK_ADS` enum | Done | `schema.prisma` |

---

## 3. What Needs To Be Built

### 3.1 Database Migration — `lineUserId` optional

**Problem**: `ChatRoom.lineUserId` is `String` (required). Facebook rooms can't set a LINE user ID.
Currently `RoomManagerService` sets `''` for non-LINE — but this is a schema debt.

**Change**:
```prisma
// Before
lineUserId String

// After
lineUserId String?
```

**Migration**: `ALTER TABLE "ChatRoom" ALTER COLUMN "lineUserId" DROP NOT NULL;`

**Impact**: Update `RoomManagerService.getOrCreateRoom()` — non-LINE channels pass `null` instead of `''`.

---

### 3.2 Facebook Domain Handler

New module: `apps/api/src/modules/facebook-domain/`

```
facebook-domain/
  facebook-domain.module.ts
  facebook-domain.handler.ts      # IDomainHandler implementation
  facebook-quick-reply.service.ts  # Quick reply button sets
  facebook-template.service.ts     # Generic/Button template builders
  facebook-persistent-menu.service.ts  # Persistent menu setup
  templates/                       # Facebook template builders
    balance-summary.template.ts
    payment-reminder.template.ts
    overdue-notice.template.ts
    payment-success.template.ts
    receipt.template.ts
    promptpay-qr.template.ts
    contract-signed.template.ts
```

#### 3.2.1 FacebookDomainHandler

Implements `IDomainHandler`:
- `supportedChannels: [ChatChannel.FACEBOOK]`
- `supportsChannel(channel)`: returns `channel === ChatChannel.FACEBOOK`

Logic branches (same as LINE finance-domain handler):
1. **Handoff active** → `{ replies: [] }` (staff handles)
2. **User not verified** → text reply asking to verify + quick reply buttons
3. **Image (slip)** → acknowledge + tag `['slip']` + delegate to SlipProcessingService
4. **Text** → route to AI/chatbot service for intent handling (ตรวจยอด, สัญญา, ชำระ, etc.)

Register via `DOMAIN_HANDLER_TOKEN` multi-provider in module.

#### 3.2.2 FacebookQuickReplyService

Convert LINE quick reply sets to Facebook format. Same 7 sets:

| Set | Buttons |
|-----|---------|
| `greeting()` | ดูสินค้า, สอบถามราคา, ดูสัญญา, คุยกับพนักงาน |
| `afterPayment()` | ดูใบเสร็จ, ดูยอดคงเหลือ, ดูสัญญา |
| `brandSelection()` | iPhone, Samsung, OPPO, vivo, Xiaomi, ดูทั้งหมด |
| `moreInfo()` | เงื่อนไขผ่อน, สาขาไหนบ้าง, ใช้เอกสารอะไร, คุยกับพนักงาน |
| `shopOnboarding()` | ลูกค้าใหม่, ลงทะเบียน |
| `financeOnboarding()` | ลงทะเบียน, วิธีชำระเงิน |
| `verifiedReturn()` | เช็คยอด, สัญญา, ช่วยเหลือ |

**Facebook format**:
```json
{
  "quick_replies": [
    { "content_type": "text", "title": "ดูสินค้า", "payload": "ดูสินค้า" }
  ]
}
```

**Constraint**: Facebook max 13 quick replies per message, title max 20 chars. All our buttons fit.

#### 3.2.3 FacebookTemplateService

Convert key LINE Flex Messages to Facebook Templates. Priority templates (customer-facing):

| LINE Flex | Facebook Template Type | Description |
|-----------|----------------------|-------------|
| `balance-summary` | **Generic Template** | Card with contract balance, next due date, progress |
| `payment-reminder` | **Button Template** | Due date, amount, "ชำระเงิน" button (URL) |
| `overdue-notice` | **Button Template** | Overdue amount, late fee, days overdue, "ชำระเงิน" button |
| `payment-success` | **Generic Template** | Amount paid, method, remaining installments |
| `receipt` | **Generic Template** | Receipt number, payer, method, balance |
| `promptpay-qr` | **Media Template** | QR code image + payment link button |
| `contract-signed` | **Generic Template** | Product name, monthly payment, months, download link |

**Not converting** (internal/staff-only or not relevant for FB):
- `daily-report` (internal staff)
- `receipt-history` (carousel — complex, defer)
- `welcome` (use text + quick replies instead)
- `verify-success` (use text)
- `campaign` (no broadcast on FB)
- `contract-selector` (use quick replies with postback)

**Facebook Generic Template format**:
```json
{
  "attachment": {
    "type": "template",
    "payload": {
      "template_type": "generic",
      "elements": [{
        "title": "ยอดคงเหลือ",
        "subtitle": "งวดถัดไป: 15 พ.ค. 2026 — ฿2,500",
        "buttons": [{ "type": "web_url", "url": "...", "title": "ชำระเงิน" }]
      }]
    }
  }
}
```

Templates are sent via `OutboundMessage.templatePayload` → `FacebookAdapter.sendMessage()` already handles this field.

#### 3.2.4 Persistent Menu

Facebook equivalent of LINE Rich Menu. Set via Graph API:

```
POST /{PAGE_ID}/messenger_profile
{
  "persistent_menu": [{
    "locale": "default",
    "composer_input_disabled": false,
    "call_to_actions": [
      { "type": "postback", "title": "เช็คยอด", "payload": "เช็คยอด" },
      { "type": "postback", "title": "ดูสัญญา", "payload": "ดูสัญญา" },
      { "type": "postback", "title": "ชำระเงิน", "payload": "ชำระ" },
      { "type": "postback", "title": "ประวัติชำระ", "payload": "ประวัติชำระ" },
      { "type": "postback", "title": "คุยกับพนักงาน", "payload": "คุยกับพนักงาน" }
    ]
  }]
}
```

**Constraints**: Max 3 top-level items (can nest up to 5 sub-items each). We'll use 3 top-level + nested:
- **เช็คข้อมูล** → เช็คยอด, ดูสัญญา, ประวัติชำระ
- **ชำระเงิน** → ชำระค่างวด
- **ติดต่อเรา** → คุยกับพนักงาน, แผนที่ร้าน

Service: `facebook-persistent-menu.service.ts`
- `setupMenu()` — called once on app init or via admin action
- `removeMenu()` — cleanup
- Reads `FB_PAGE_ACCESS_TOKEN` and `FB_PAGE_ID` from config

---

### 3.3 Facebook Adapter Fixes

Update `facebook.adapter.ts`:
- `sendMessage()` — handle `templatePayload` properly (currently sends raw, need to structure as FB attachment)
- Add `sendQuickReply(externalUserId, text, quickReplies[])` convenience method
- Handle postback events in webhook controller (persistent menu clicks → same as text messages)

Update `facebook-webhook.controller.ts`:
- Add postback handling in `processMessagingEvent()` — extract `event.postback.payload` as text message

---

### 3.4 Facebook Ads Sync

New service in existing `ads-tracking/` module.

**File**: `apps/api/src/modules/ads-tracking/facebook-ads-sync.service.ts`

**Functionality**:
- Cron job runs every 4 hours (`@Cron('0 */4 * * *')`)
- Calls Facebook Marketing API: `GET /act_{AD_ACCOUNT_ID}/campaigns?fields=name,status,daily_budget,lifetime_budget,insights{spend,impressions,clicks,reach}`
- Upserts `AdsCampaign` records (match by `platform=FACEBOOK_ADS` + `campaignId`)
- Updates: `campaignName`, `budget` (from daily/lifetime), `isActive` (from status)
- Creates `AdsAttribution` touch records from insights data

**Env vars**:
```
FB_AD_ACCOUNT_ID=act_123456789
```

**Note**: Uses same `FB_PAGE_ACCESS_TOKEN` if the token has `ads_read` permission, otherwise needs a separate user token with `ads_management` scope.

**Facebook Marketing API endpoint**:
```
GET https://graph.facebook.com/v25.0/act_{AD_ACCOUNT_ID}/campaigns
  ?fields=id,name,status,daily_budget,lifetime_budget,start_time,stop_time,insights{spend,impressions,clicks,reach,actions}
  &access_token={TOKEN}
```

---

### 3.5 Environment Variables

Add to `.env.example`:
```bash
# Facebook Messenger
FB_APP_SECRET=             # App Settings > Basic > App Secret
FB_PAGE_ACCESS_TOKEN=      # Messenger Settings > Generate Token
FB_PAGE_ID=                # Facebook Page ID
FB_VERIFY_TOKEN=           # Random string for webhook verification

# Facebook Ads (optional — for auto-sync)
FB_AD_ACCOUNT_ID=          # act_XXXXXXXXX from Ads Manager
```

---

### 3.6 RoomManagerService Fix

Update `getOrCreateRoom()`:
```typescript
// Before
lineUserId: isLineChannel ? params.externalUserId : '',

// After
lineUserId: isLineChannel ? params.externalUserId : null,
```

---

## 4. Facebook App Setup Guide

### 4.1 Create App
1. Go to developers.facebook.com → **Create App**
2. Use case: **ยืนยันตัวตนและเชื่อมต่อผู้คน (Facebook Login)**
3. App type: **Business**
4. Connect Business Portfolio

### 4.2 Add Products
1. **Messenger** — connect BESTCHOICE Facebook Page, generate Page Access Token
2. **Webhooks** — set callback URL: `https://<domain>/api/webhooks/facebook`
   - Verify token: same value as `FB_VERIFY_TOKEN` env var
   - Subscribe: `messages`, `messaging_postbacks`, `messaging_referrals`

### 4.3 Add Marketing API (for Ads Sync)
1. Add **Marketing API** product
2. Connect Ad Account
3. Ensure token has `ads_read` permission

### 4.4 App Review
For production (Live mode):
- `pages_messaging` — required for sending/receiving messages
- `pages_read_engagement` — required for reading page info
- `ads_read` — required for ads sync (optional)

### 4.5 Permissions Summary

| Permission | Required For |
|------------|-------------|
| `pages_messaging` | Send/receive messages via Messenger |
| `pages_read_engagement` | Read page info, user profiles |
| `pages_manage_metadata` | Set persistent menu, webhook subscriptions |
| `ads_read` | Read campaign data for ads sync |

---

## 5. Data Flow

### 5.1 Inbound Message (Customer → Bot)
```
Customer sends message on Facebook Page
  → Facebook POST /api/webhooks/facebook
  → FacebookWebhookController (verify HMAC)
  → MessageRouterService.routeInbound()
  → RoomManagerService.getOrCreateRoom() (externalUserId = FB PSID)
  → Save ChatMessage
  → Check handoff → Check AI auto-reply → Check after-hours
  → FacebookDomainHandler.handleMessage()
  → Build reply (text + quick replies or template)
  → FacebookAdapter.sendMessage()
  → Facebook Graph API → Customer sees reply
```

### 5.2 Ads Attribution Flow
```
Customer clicks Facebook Ad (Click-to-Messenger)
  → Opens Messenger with referral data
  → Webhook receives event.referral { ad_id, ref, source }
  → WebhookController extracts attribution
  → RoomManagerService creates room + AdsAttribution record
  → Customer chats, eventually signs contract
  → markConversion() links attribution to contract + revenue
  → AdsTrackingPage shows ROI
```

### 5.3 Ads Sync Flow
```
Cron (every 4h)
  → FacebookAdsSyncService.syncCampaigns()
  → GET /act_{AD_ACCOUNT_ID}/campaigns (Marketing API)
  → Upsert AdsCampaign records (spend, impressions, clicks)
  → AdsTrackingPage shows updated data
```

---

## 6. File Changes Summary

| Action | File |
|--------|------|
| **Migration** | `prisma/migrations/YYYYMMDD_facebook_lineUserId_optional/migration.sql` |
| **Schema** | `prisma/schema.prisma` — `lineUserId String?` |
| **New module** | `modules/facebook-domain/facebook-domain.module.ts` |
| **New handler** | `modules/facebook-domain/facebook-domain.handler.ts` |
| **New service** | `modules/facebook-domain/facebook-quick-reply.service.ts` |
| **New service** | `modules/facebook-domain/facebook-template.service.ts` |
| **New service** | `modules/facebook-domain/facebook-persistent-menu.service.ts` |
| **New templates** | `modules/facebook-domain/templates/*.template.ts` (7 files) |
| **New service** | `modules/ads-tracking/facebook-ads-sync.service.ts` |
| **Edit** | `modules/chat-engine/services/room-manager.service.ts` — null instead of '' |
| **Edit** | `modules/chat-adapters/facebook.adapter.ts` — templatePayload handling |
| **Edit** | `modules/chat-adapters/facebook-webhook.controller.ts` — postback handling |
| **Edit** | `app.module.ts` — import FacebookDomainModule |
| **Edit** | `.env.example` — add FB_* vars |
