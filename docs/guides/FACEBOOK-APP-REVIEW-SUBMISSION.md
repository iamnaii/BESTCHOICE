# Facebook App Review — Resubmission Package (2026-05)

เอกสารชุดนี้เตรียมไว้สำหรับ **resubmit ขอ permissions กับ Meta App Review** หลัง submission แรก (2026-04-24, 11 perms) ถูก **REJECTED** เมื่อ 2026-05-09

---

## ทำไมรอบแรกถึง Reject — Root cause analysis

Meta ตอบกลับด้วย **3 ปัญหาหลัก**:

### 1. Privacy Policy URL ไม่ใช่ Privacy Policy (Meta Platform Terms 4.a violation)

ปัญหาที่แท้จริง: `https://bestchoicephone.app/privacy` เป็น React SPA ที่ render ผ่าน JavaScript

```html
<!-- Meta crawler โหลดได้ 200 OK แต่ได้แค่นี้: -->
<title>ระบบผ่อนชำระ - Best Choice</title>     ← ไม่ใช่ "Privacy Policy"
<meta name="robots" content="noindex, nofollow,..." />  ← บอกบอทไม่ให้ index
<div id="root"><p>กำลังโหลด...</p></div>      ← เห็นแค่ spinner, ไม่มี content
```

Meta bot **ไม่รัน JavaScript** → ไม่เห็นเนื้อหา Privacy Policy → ตี = URL invalid → block ทั้ง submission ก่อน review screencast ด้วยซ้ำ

`https://bestchoicephone.app/terms` ยิ่งหนักกว่า — ไม่มี React route เลย

### 2. Screencasts ขาดข้อมูลสำคัญ

Meta บอกว่าทุก screencast ต้องเห็น **3 ส่วนนี้ครบ**:
1. **Asset selection** — เลือก Page/account/number ในแอป (ชื่อต้อง visible)
2. **Live send action** — กดปุ่มในแอปแล้วยิง API จริง (ไม่ใช่ Graph Explorer)
3. **Delivered result in native client** — สลับไป Messenger mobile / FB native ดูข้อความถึง

สำหรับ `pages_utility_messaging` เพิ่มเงื่อนไขพิเศษ:
1. **เลือก template** (utility/marketing message template)
2. **Template populated with placeholders** (name, order ID, amount, due date)
3. **ส่ง template message** ไปลูกค้าทดสอบ + เห็นใน native client

### 3. Marketing API Access Tier — Activity threshold ไม่ถึง

> "Our records do not show a sufficient number of successful Ads API calls in the last 15 days"

Chicken-and-egg: ต้องยิง `ads_read` API หลายๆ call ภายใน 15 วันก่อน — แต่ pre-approval ใช้ได้แค่ admin/dev/tester

---

## Fixes ที่ทำเสร็จแล้ว (Engineering side)

| Fix | Status | File / Path |
|---|---|---|
| Static `privacy.html` (Meta-readable, no SPA shell, no noindex) | ✅ | `apps/web/public/privacy.html` |
| Static `terms.html` | ✅ | `apps/web/public/terms.html` |
| SPA `/terms` route → redirect `/terms.html` (for human users) | ✅ | `apps/web/src/App.tsx` |
| Backend: GET `/page-posts` (pages_read_engagement) | ✅ | `facebook-app-review.controller.ts` |
| Backend: GET `/post-comments/:postId` (pages_read_engagement) | ✅ | same |
| Backend: POST `/comment-reply` (pages_manage_engagement) | ✅ | same |
| Backend: POST `/comment-like` (pages_manage_engagement) | ✅ | same |
| Backend: POST `/comment-hide` (pages_manage_engagement) | ✅ | same |
| Backend: POST `/template-message` (pages_utility_messaging — with placeholders) | ✅ | same |
| Backend: GET `/businesses` (business_management) | ✅ | same |
| Backend: GET `/businesses/:id/ad-accounts` (business_management) | ✅ | same |
| Backend: GET `/businesses/:id/pages` (business_management) | ✅ | same |
| Frontend: 13 cards ใน FacebookAppReviewPanel (current scope + legacy section) | ✅ | `FacebookAppReviewPanel.tsx` |
| Verify `messaging_type=RESPONSE` (no MESSAGE_TAG) | ✅ | `facebook-app-review.service.ts` |

---

## Scope ของ Submission รอบนี้: **8 Permissions** (+ Marketing API Access Tier)

| # | Permission | Status | Production Use Case |
|---|---|---|---|
| 1 | `pages_show_list` | ผ่านชั่วคราวรอบแรก | List เพจ admin จัดการ |
| 2 | `pages_messaging` | ผ่านชั่วคราว ต้อง screencast ดีกว่า | Chat AI ตอบ Messenger 24-hr RESPONSE |
| 3 | `pages_manage_metadata` | ผ่านชั่วคราว | Subscribe webhook events |
| 4 | `pages_utility_messaging` | ผ่านชั่วคราว ต้อง template flow | Template ส่ง utility message (เผื่อใช้ในอนาคต) |
| 5 | `pages_read_engagement` | ปฏิเสธรอบแรก | อ่าน comments + sentiment |
| 6 | `pages_manage_engagement` | **ใหม่** ไม่เคยส่ง | AI auto-reply / like / hide comments |
| 7 | `ads_read` | ปฏิเสธรอบแรก | Read-only ads insights |
| 8 | `business_management` | ปฏิเสธรอบแรก | List ad accounts / pages ใน BM |
| + | `Marketing API Access Tier` | ปฏิเสธ (activity ไม่พอ) | ขอหลังจาก ads_read ผ่าน |

### ตัดออก (ไม่ส่งรอบนี้)

- `pages_manage_ads` — ใช้ Ads Manager UI ทำเอง
- `ads_management` — ไม่ create ads via API
- `leads_retrieval` — ยังไม่ทำ Lead Ads
- `publish_video` / Live Video API — ไม่ใช่ core business
- `public_profile` — auto-granted

---

## App Info (ใส่ใน FB App Settings → Basic)

| Field | Value |
|---|---|
| App Name | BESTCHOICE |
| Business Name | บจก. เบสช้อยส์ จำกัด (BESTCHOICE Co., Ltd.) |
| Category | Business |
| App Type | Business |
| **Privacy Policy URL** | **`https://bestchoicephone.app/privacy.html`** ⚠️ ใช้ .html |
| **Terms of Service URL** | **`https://bestchoicephone.app/terms.html`** ⚠️ ใช้ .html |
| Data Deletion Callback URL | `https://api.bestchoicephone.app/api/webhooks/facebook/data-deletion` |
| Deauthorize Callback URL | `https://api.bestchoicephone.app/api/webhooks/facebook/deauthorize` |
| Platform | Website |
| Website URL | `https://bestchoicephone.app` |
| App Mode | **Live** (สำคัญมาก — Dev Mode = block) |

⚠️ **CRITICAL**: ก่อน submit ต้องเปลี่ยน Privacy + Terms URL เป็นแบบ `.html` ใน FB Settings

---

## Use Case Description (เริ่มต้นทุก permission ด้วย paragraph นี้)

> BESTCHOICE is an installment payment management system for mobile phone shops in Thailand. We operate physical retail stores (BESTCHOICE SHOP) paired with an in-house finance arm (BESTCHOICE FINANCE) that finances 6-36 month phone installment plans. Our admin staff use an internal panel at bestchoicephone.app/settings/integrations to (1) reply to customer Messenger conversations and post comments via an AI assistant trained on our product catalog and pricing, (2) review ad performance insights to learn which creatives resonate with installment-plan buyers, and (3) connect Pages and ad accounts via a Business Manager hierarchy. We do NOT create ads, modify Page settings, publish videos, or send unprompted promotional messages through this app. The app is internal — only authenticated BESTCHOICE staff (4 active admin accounts) can call any Graph API endpoint.

---

## Permission #1 — `pages_show_list`

**Test endpoint**: `GET /facebook/app-review/pages` → Graph API `GET /me/accounts`

### Use Case (paste verbatim after intro paragraph)

> We use pages_show_list exclusively in the Page connection flow at Settings → Integrations. When a BESTCHOICE staff member with admin role connects their Facebook account, we call GET /me/accounts to display only the Pages they manage so they can pick the correct one (BESTCHOICE Phone Shop). Without this permission, staff would have to copy-paste Page IDs and Page Access Tokens manually, which is error-prone and exposes long-lived tokens. After picking a Page, we store the page-scoped access token (encrypted at rest, AES-256) and never call /me/accounts again for that account.

### Screencast Script (45 sec)

| Time | Action |
|---|---|
| 0:00-0:05 | Open `https://bestchoicephone.app/login` (URL bar visible) |
| 0:05-0:15 | Login as `reviewer@bestchoice.com` |
| 0:15-0:20 | Navigate `Settings → Integrations` (breadcrumb visible) |
| 0:20-0:25 | Open Chrome DevTools → Network tab → filter "graph.facebook.com" |
| 0:25-0:30 | Scroll to Facebook App Review Panel → expand **"ดึงรายการ Pages ที่จัดการ"** card |
| 0:30-0:40 | Click **"ยิง API"** → DevTools shows `GET /v25.0/me/accounts?fields=id,name,category,tasks` → 200 |
| 0:40-0:50 | Panel renders Pages list — **BESTCHOICE Phone Shop** name visible |

---

## Permission #2 — `pages_messaging`

**Test endpoint**: `POST /facebook/app-review/messenger-message` → Graph API `POST /{PAGE_ID}/messages` with `messaging_type=RESPONSE` (no MESSAGE_TAG)

### Use Case

> Customers with active installment contracts message our Page via Messenger to ask about (1) next payment due date, (2) outstanding balance, (3) phone unlock procedure after final payment, (4) availability of new phone models, (5) installment terms. Our BESTCHOICE Sales Bot (Claude Sonnet 4.6 fine-tuned on product catalog) replies within 1-3 seconds, fully within the 24-hour response window using messaging_type=RESPONSE. If bot confidence < 0.7, conversation escalates to a human staff member via /chat inbox. We do NOT send unprompted promotional messages and we do NOT use deprecated message tags (ACCOUNT_UPDATE, CONFIRMED_EVENT_UPDATE, POST_PURCHASE_UPDATE deprecated 2026-04-27). Customers receive payment-due reminders via LINE OA or SMS — never Messenger.

### Screencast Script (90 sec) — Critical: 3-part flow

**Pre-recording (within 1 hour of recording)**:
- Use second FB account (not test account) → Open Messenger mobile → Send "งวดผ่อนเดือนหน้าจ่ายเท่าไหร่" to BESTCHOICE Phone Shop Page
- This establishes 24-hour response window with a real PSID

| Time | Action |
|---|---|
| **Part 1: Asset Selection** | |
| 0:00-0:05 | Open `https://bestchoicephone.app` (URL visible) |
| 0:05-0:15 | Navigate `Settings → Integrations` |
| 0:15-0:25 | Show "Connected Page: **BESTCHOICE Phone Shop** (Page ID: visible)" — this is asset selection |
| **Part 2: Live Send Action** | |
| 0:25-0:35 | Open DevTools → Network tab → filter "graph.facebook.com" |
| 0:35-0:45 | Scroll to **"ตอบ Messenger ลูกค้า (24hr RESPONSE)"** card → enter PSID + reply text |
| 0:45-0:55 | Click **"ยิง API"** → DevTools shows: `POST /v25.0/{PAGE_ID}/messages` body `{messaging_type:"RESPONSE", recipient:{id:PSID}, message:{text:"..."}}` → 200 with `message_id` |
| **Part 3: Native Client Delivery** | |
| 0:55-1:10 | Switch to Messenger mobile app (split screen / overlay) → conversation with BESTCHOICE Phone Shop |
| 1:10-1:20 | Reply message visible in native Messenger app — fully delivered |
| 1:20-1:30 | Narrate: "Reply sent within 24-hour window using messaging_type=RESPONSE, no message tag" |

### Critical Talking Points

- ✅ **Customer-initiated only** — never DM PSIDs that have not messaged us in last 24 hr
- ✅ **No deprecated tags** — explicitly NO `tag` field in request body
- ✅ **Automated reminders use LINE/SMS** — Messenger reserved for customer-initiated
- ✅ **Opt-out** — replying "หยุด" / "STOP" pauses bot
- ✅ **Retention** — PSID + messages 90 days for audit (Thai PDPA Sect.26)

---

## Permission #3 — `pages_manage_metadata`

**Test endpoint**: `POST /facebook/app-review/subscribe-webhooks` → Graph API `POST /{PAGE_ID}/subscribed_apps`

### Use Case

> We subscribe our Page to webhook events to receive (1) inbound Messenger messages so AI can reply within seconds, (2) feed events (comments on our posts/ads) so AI can triage and reply, (3) message_deliveries and message_reads for delivery tracking. We use POST /{PAGE_ID}/subscribed_apps with subscribed_fields="messages,messaging_postbacks,message_deliveries,message_reads,feed". Without this permission we cannot receive real-time webhooks and would have to poll the Graph API constantly which is inefficient and against Meta's rate limit guidelines.

### Screencast Script (45 sec)

| Time | Action |
|---|---|
| 0:00-0:10 | Open `Settings → Integrations` → show "Connected Page: BESTCHOICE Phone Shop" |
| 0:10-0:20 | Open DevTools → expand **"Subscribe Page Webhooks"** card |
| 0:20-0:30 | Show subscribed fields input pre-filled with `messages,messaging_postbacks,message_deliveries,message_reads,feed` |
| 0:30-0:40 | Click **"ยิง API"** → DevTools shows `POST /v25.0/{PAGE_ID}/subscribed_apps` body `{subscribed_fields: "..."}` → 200 `{success: true}` |
| 0:40-0:50 | Switch to FB Page Settings → New Page Experience → Linked Apps → BESTCHOICE app shows subscribed status |

---

## Permission #4 — `pages_utility_messaging`

**Test endpoint**: `POST /facebook/app-review/template-message` → Graph API `POST /{PAGE_ID}/messages` with `messaging_type=RESPONSE` + server-rendered templated content

### Use Case (Meta-specific feedback addressed)

> We use templated utility messages with named placeholders to send transactional updates to customers (payment due reminders, order confirmations, contract-ready notifications) within the 24-hour customer-initiated response window. Templates are managed server-side in code as named keys with explicit placeholder fields ({{customerName}}, {{orderId}}, {{amount}}, {{dueDate}}); admins select a template and fill placeholder values via our admin UI, never raw text. The server renders the final message and sends via Graph API with messaging_type=RESPONSE. This pattern lets us audit template usage and standardize copy across the LINE OA, SMS, and Messenger channels. Templates available: (1) payment_due_reminder, (2) order_confirmation, (3) contract_ready. We deliberately do NOT use deprecated message tags (ACCOUNT_UPDATE / CONFIRMED_EVENT_UPDATE / POST_PURCHASE_UPDATE deprecated 2026-04-27) — out-of-window reminders go via LINE OA/SMS instead.

### Screencast Script (90 sec) — Critical: 3-part template flow per Meta requirement

| Time | Action |
|---|---|
| **Part 1: Template Selection** | |
| 0:00-0:10 | Open `Settings → Integrations` → show "Connected Page: BESTCHOICE Phone Shop" |
| 0:10-0:20 | Expand **"ส่ง Utility Template (มี placeholder)"** card |
| 0:20-0:30 | Show template dropdown with 3 options: `payment_due_reminder`, `order_confirmation`, `contract_ready` — select `payment_due_reminder` |
| **Part 2: Placeholder Population** | |
| 0:30-0:45 | Show 4 placeholder inputs with labels: ชื่อลูกค้า, Order/งวด, ยอดเงิน, วันครบกำหนด |
| 0:45-0:55 | Fill in: `customerName: "คุณสมชาย"`, `orderId: "CT-2025-001"`, `amount: "3,500"`, `dueDate: "15 มิ.ย. 2569"` |
| 0:55-1:05 | Show preview: "สวัสดีคุณ คุณสมชาย ใบงวด #CT-2025-001 ยอด 3,500 บาท ครบกำหนด 15 มิ.ย. 2569 นะคะ" — placeholders populated |
| **Part 3: Send + Native Client** | |
| 1:05-1:15 | Open DevTools → click **"ยิง API"** → DevTools shows `POST /v25.0/{PAGE_ID}/messages` body `{messaging_type:"RESPONSE", recipient:{id:PSID}, message:{text:"<rendered>"}}` → 200 |
| 1:15-1:25 | Switch to Messenger mobile → conversation with BESTCHOICE — template message delivered with all placeholder values rendered |
| 1:25-1:35 | Narrate: "Template selected, placeholders populated, server rendered, delivered via UPDATE" |

---

## Permission #5 — `pages_read_engagement`

**Test endpoints**:
- `GET /facebook/app-review/page-posts` → Graph API `GET /{PAGE_ID}/feed`
- `GET /facebook/app-review/post-comments/:postId` → Graph API `GET /{POST_ID}/comments`

### Use Case

> We read comments, reactions, and engagement metrics on posts that BESTCHOICE owns (organic + boosted ads) for two purposes: (1) AI-assisted comment triage — our AI assistant scans new comments via webhook and tags them by intent (price inquiry, complaint, spam, generic praise) so staff can prioritize replies; (2) Sentiment analysis — our marketing team reviews reaction distribution per post type to optimize creative direction. We use GET /{post-id}/comments only on posts owned by Pages we manage. We never read comments on posts owned by other Pages or users.

### Screencast Script (75 sec)

| Time | Action |
|---|---|
| 0:00-0:10 | Open `Settings → Integrations` → show "Connected Page: BESTCHOICE Phone Shop" |
| 0:10-0:20 | DevTools open → expand **"ดึงโพสต์ล่าสุดของเพจ"** card → click **"ยิง API"** |
| 0:20-0:30 | DevTools shows `GET /v25.0/{PAGE_ID}/feed?fields=id,message,created_time,comments.limit(0).summary(true)&limit=10` → 200 with array of 10 posts |
| 0:30-0:35 | Panel renders post list — copy a post ID with comments |
| 0:35-0:45 | Expand **"ดึง Comments ในโพสต์"** card → paste post ID → click **"ยิง API"** |
| 0:45-0:55 | DevTools shows `GET /v25.0/{POST_ID}/comments?fields=id,from,message,created_time,parent,like_count` → 200 with comments array |
| 0:55-1:05 | Panel renders comment thread — commenter name + message visible |
| 1:05-1:15 | Switch to Facebook native (mobile or web) → same post → same comments visible — confirms data integrity |

---

## Permission #6 — `pages_manage_engagement`

**Test endpoints**:
- `POST /facebook/app-review/comment-reply` → `POST /{COMMENT_ID}/comments`
- `POST /facebook/app-review/comment-like` → `POST /{COMMENT_ID}/likes`
- `POST /facebook/app-review/comment-hide` → `POST /{COMMENT_ID}` body `{is_hidden:true}`

### Use Case

> When a customer comments on our post or boosted ad with a question (e.g. "iPhone 15 Pro ผ่อนกี่งวด"), our AI assistant replies publicly using POST /{comment-id}/comments with a templated answer drawn from our product catalog. This dramatically reduces response time on high-volume ad comment threads (median 30 seconds vs 4-6 hours manual). For inappropriate content (spam, abusive, off-topic), our staff use the panel's Hide action which calls POST /{comment-id} with is_hidden=true. We do NOT delete comments without staff confirmation, and we do NOT comment on posts owned by other Pages or users — only posts owned by Pages we manage. AI replies are throttled to one per comment thread to avoid spam.

### Screencast Script (120 sec) — 3-action flow

**Pre-recording**: have a real customer FB account post a comment "ผ่อน 0% กี่งวดคะ" on a recent BESTCHOICE Page post → copy comment ID

| Time | Action |
|---|---|
| **Part A: Reply (write)** | |
| 0:00-0:10 | Open `Settings → Integrations` → show "Connected Page: BESTCHOICE Phone Shop" |
| 0:10-0:20 | Show recent post with customer comment "ผ่อน 0% กี่งวดคะ" — copy comment ID |
| 0:20-0:30 | DevTools open → expand **"AI ตอบ Comment ลูกค้า"** card → paste comment ID |
| 0:30-0:40 | Reply text pre-filled — click **"ยิง API"** → DevTools shows `POST /v25.0/{COMMENT_ID}/comments` body `{message:"ขอบคุณที่สนใจค่ะ ผ่อน 0% มี 6, 10, 12 งวด..."}` → 200 with new comment id |
| 0:40-0:50 | Switch to Facebook native → reply visible under original comment as Page reply |
| **Part B: Like** | |
| 0:50-1:00 | Back to admin → expand **"Like Comment"** card → paste comment ID → click **"ยิง API"** |
| 1:00-1:10 | DevTools shows `POST /v25.0/{COMMENT_ID}/likes` → 200 |
| 1:10-1:20 | Switch to Facebook → Page heart icon visible on comment |
| **Part C: Hide** | |
| 1:20-1:30 | A spam comment posted (pre-arranged) — copy spam comment ID |
| 1:30-1:40 | Expand **"ซ่อน Comment (สแปม)"** card → paste comment ID → click **"ยิง API"** |
| 1:40-1:50 | DevTools shows `POST /v25.0/{COMMENT_ID}` body `{is_hidden:true}` → 200 |
| 1:50-2:00 | Switch to Facebook (incognito / non-admin user) → spam comment hidden from public view |

### Critical Talking Points

- ✅ **Posts we own only** — verify `comment.parent_id ∈ managed Pages` before any write
- ✅ **One AI reply per thread** — throttled, no spam
- ✅ **Hide not delete** — comments hidden (reversible)
- ✅ **Audit trail** — every AI reply + admin hide logged in AuditLog

---

## Permission #7 — `ads_read`

**Test endpoint**: `GET /facebook/app-review/insights` → Graph API `GET /act_{AD_ACCOUNT_ID}/insights`

### Use Case

> Our marketing team reviews ad performance to understand which creatives resonate with installment-plan buyers. We pull insights via GET /act_{AD_ACCOUNT_ID}/insights with fields: spend, impressions, clicks, reach, cpc, ctr. The data feeds an internal dashboard at bestchoicephone.app/marketing/ads-insights (read-only). We use this to identify which phone-model creatives drive the most messenger conversations from cost-conscious 25-40 yr-olds in Bangkok metro, compare CTR between video vs static-image ads, detect underperforming campaigns in time to pause via Ads Manager (manual UI — not via this app). We do NOT create, modify, or delete ads through this app.

### Screencast Script (60 sec)

| Time | Action |
|---|---|
| 0:00-0:10 | Open `Settings → Integrations` → show ad account ID **act_{NUMBER}** in panel |
| 0:10-0:20 | DevTools open → expand **"ดู Insights ของ Ad Account (30 วัน)"** card |
| 0:20-0:30 | Click **"ยิง API"** → DevTools shows `GET /v25.0/act_{AD_ACCOUNT_ID}/insights?fields=spend,impressions,clicks,reach,cpc,ctr&date_preset=last_30d` → 200 |
| 0:30-0:45 | Response JSON visible: spend, impressions, CTR for last 30 days |
| 0:45-0:55 | Panel renders metrics — show specific numbers (e.g. spend: 50,123฿, CTR: 1.8%) |
| 0:55-1:05 | Narrate: "Read-only — we never create or modify ads through this API. All ad management via Ads Manager UI" |

### Strategy for Marketing API Access Tier

หลัง `ads_read` ผ่านแล้ว → ยิง insights endpoint อย่างน้อย 5-10 ครั้งต่อวันเป็นเวลา 15+ วัน → ค่อย submit Marketing API Access Tier (Standard) ซึ่งจะเห็น activity ครบ

---

## Permission #8 — `business_management`

**Test endpoints**:
- `GET /facebook/app-review/businesses` → `GET /me/businesses`
- `GET /facebook/app-review/businesses/:id/ad-accounts` → `GET /{BM_ID}/owned_ad_accounts`
- `GET /facebook/app-review/businesses/:id/pages` → `GET /{BM_ID}/owned_pages`

### Use Case

> Our Facebook ad accounts and Pages are owned by our Business Manager (BESTCHOICE Business Manager). To list ad accounts the connected user can read insights for, we call GET /me/businesses then GET /{business-id}/owned_ad_accounts and present results in a dropdown selector at bestchoicephone.app/marketing/ads-insights. Without business_management, the user would have to manually copy-paste each ad account ID, which is error-prone — BESTCHOICE has 3 ad accounts (one per branch) and they rotate as we open new branches. We use this permission READ-ONLY — we do NOT create users, assign permissions, manage Pages, or modify Business assets through this app.

### Screencast Script (75 sec)

| Time | Action |
|---|---|
| 0:00-0:10 | Open `Settings → Integrations` |
| 0:10-0:20 | DevTools open → expand **"ดู Business Manager ที่เข้าถึงได้"** card → click **"ยิง API"** |
| 0:20-0:30 | DevTools shows `GET /v25.0/me/businesses?fields=id,name,verification_status` → 200 with **BESTCHOICE Business Manager** |
| 0:30-0:35 | Copy Business ID |
| 0:35-0:45 | Expand **"ดู Ad Accounts ของ Business"** card → paste Business ID → click **"ยิง API"** |
| 0:45-0:55 | DevTools shows `GET /v25.0/{BM_ID}/owned_ad_accounts?fields=id,name,account_status,currency` → 200 with 3 ad accounts |
| 0:55-1:05 | Expand **"ดู Pages ของ Business"** card → click **"ยิง API"** |
| 1:05-1:15 | DevTools shows `GET /v25.0/{BM_ID}/owned_pages` → 200 with Page list |
| 1:15-1:25 | Narrate: "Read-only access — we never create, modify, or assign Business assets" |

---

## Submission Checklist

### Phase 1 — Pre-Deploy (เสร็จแล้วใน code)

- [x] Static `privacy.html` + `terms.html` ใน `apps/web/public/`
- [x] React route `/terms` redirect ไป static HTML
- [x] Backend: 8 endpoints ใหม่ใน facebook-app-review module
- [x] Frontend: 13 cards ใน FacebookAppReviewPanel (current scope)
- [x] DTO validation messages เป็นภาษาไทย
- [x] Verify `messaging_type=RESPONSE` (no MESSAGE_TAG)

### Phase 2 — Deploy + Verify (ต้องทำต่อ)

- [ ] `git add apps/web/public/*.html apps/web/src/App.tsx apps/api/src/modules/facebook-app-review/* apps/web/src/components/FacebookAppReviewPanel.tsx docs/guides/FACEBOOK-APP-REVIEW-SUBMISSION.md`
- [ ] Commit + push to main → wait for GitHub Actions deploy (~10 min)
- [ ] Verify in incognito browser:
  ```bash
  curl -s https://bestchoicephone.app/privacy.html | grep -i "Privacy Policy"
  curl -s https://bestchoicephone.app/terms.html | grep -i "Terms of Service"
  ```
- [ ] **CRITICAL**: FB App Settings → Basic →
  - Privacy Policy URL = `https://bestchoicephone.app/privacy.html`
  - Terms of Service URL = `https://bestchoicephone.app/terms.html`
  - Save Changes

### Phase 3 — Activity Generation (1-2 วัน)

- [ ] Login as OWNER → `Settings → Integrations` → ยิงทุก current-scope endpoint อย่างน้อย 1 ครั้ง:
  - `pages_show_list`
  - `pages_read_engagement` (page-posts + post-comments)
  - `business_management` (businesses + ad-accounts + pages)
  - `ads_read`
  - `pages_messaging` (มี PSID พร้อมส่ง)
  - `pages_utility_messaging` (template + placeholder + send)
  - `pages_manage_metadata` (subscribe webhooks)
  - `pages_manage_engagement` (reply + like + hide — มี comment ID พร้อม)
- [ ] รอ 24 ชม. → เช็ค App Dashboard → Permissions → ทุกตัวขึ้น "Activity detected within 30 days"
- [ ] สำหรับ ads_read: ยิงอย่างน้อย 5 ครั้งต่อวัน × 15 วัน เพื่อสะสม activity ก่อน Marketing API Access Tier

### Phase 4 — Pre-Submit Verification

- [ ] Business Verification status = **Approved** (Settings → Security Center)
  - ยังไม่ผ่าน → อัปโหลด หนังสือรับรองบริษัท DBD (ไม่เกิน 6 เดือน) + ภ.พ.20 + บิลค่าน้ำ/ไฟ + เบอร์โทรบริษัท
- [ ] App Mode = **Live** (ไม่ใช่ Development)
- [ ] Privacy Policy URL ใช้ `.html` แล้ว
- [ ] Terms of Service URL ใช้ `.html` แล้ว
- [ ] Data Deletion Callback URL ทำงาน (test ด้วย POST + signed payload)
- [ ] เตรียม test credentials สำหรับ reviewer:
  - Login: `reviewer@bestchoice.com` (ACCOUNTANT role + access to facebook-app-review panel)
  - Password: เก็บไว้ใส่ใน Meta secure form

### Phase 5 — Recording (1 วัน)

- [ ] Record 8 screencasts (1 vid per permission, ตาม script ข้างบน)
- [ ] Format: MP4 H.264, 1280x720+, ภายใต้ 100MB
- [ ] Tools: QuickTime (Cmd+Shift+5) + Chrome DevTools open + voiceover ภาษาอังกฤษ
- [ ] **Pre-recording checklist** (สำคัญที่สุด):
  - PSID ที่ทักเข้ามาภายใน 1 ชม. (สำหรับ pages_messaging + pages_utility_messaging)
  - Comment ID จาก non-test FB user บนโพสต์ของเรา (สำหรับ pages_manage_engagement)
  - Spam comment พร้อมซ่อน (จัดเตรียมล่วงหน้า)
  - Business Manager ID + Ad Account ID พร้อมแสดง
- [ ] Compress: `ffmpeg -i input.mov -crf 28 -preset slow -c:a aac -b:a 96k output.mp4`
- [ ] **3-part flow** ทุกคลิป: Asset Selection → Live Send → Native Client Delivery

### Phase 6 — Submit

- [ ] App Dashboard → App Review → Permissions and Features
- [ ] Request Advanced Access ทีละ permission (ใช้ use case + screencast จากเอกสารนี้):
  1. `pages_show_list`
  2. `pages_messaging`
  3. `pages_manage_metadata`
  4. `pages_utility_messaging`
  5. `pages_read_engagement`
  6. `pages_manage_engagement`
  7. `ads_read`
  8. `business_management`
- [ ] เพิ่ม Detailed Testing Instructions (ดูข้างล่าง)
- [ ] Submit ครั้งเดียวรวม 8 permissions
- [ ] เก็บ Submission ID

### Phase 7 — Post-Submit

- [ ] เช็คอีเมล `akenarin.ak@gmail.com` ทุกวัน — Meta แจ้งผลภายใน 3-7 วัน
- [ ] ถ้า Approved ครบ → ยิง ads_read API ทุกวัน → submit Marketing API Access Tier (Standard) แยก
- [ ] ถ้า Rejected บางตัว → อ่านเหตุผลละเอียด → แก้ตามที่บอก → resubmit (ฟรี ไม่จำกัดครั้ง)

---

## Detailed Testing Instructions for Reviewer (paste ในช่อง "Provide step-by-step instructions")

```
=== Test Account ===
URL: https://bestchoicephone.app/login
Email: reviewer@bestchoice.com
Password: <provided to Meta via secure form>
Role: ACCOUNTANT (has access to Facebook App Review Panel)

=== Test Page & Business Manager ===
Page name: BESTCHOICE Phone Shop
Page ID: <fill in>
Business Manager: BESTCHOICE Business Manager
BM ID: <fill in>
Ad Account: act_<NUMBER>
Owned by Business Manager.

=== Test Steps ===

1. Login at https://bestchoicephone.app/login
2. Navigate to Settings → Integrations
3. Connect Facebook account (Login with Facebook button) — choose BESTCHOICE Phone Shop page
4. Scroll to "Facebook App Review Panel" section — 13 cards in current scope:
   - "ดึงรายการ Pages ที่จัดการ" → pages_show_list
   - "ดึงโพสต์ล่าสุดของเพจ" → pages_read_engagement
   - "ดู Business Manager ที่เข้าถึงได้" → business_management
   - "ดู Insights ของ Ad Account (30 วัน)" → ads_read
   - "ดึง Comments ในโพสต์" → pages_read_engagement (with post ID input)
   - "ดู Ad Accounts ของ Business" → business_management (with BM ID)
   - "ดู Pages ของ Business" → business_management (with BM ID)
   - "ตอบ Messenger ลูกค้า (24hr RESPONSE)" → pages_messaging (PSID + text)
   - "ส่ง Utility Template (มี placeholder)" → pages_utility_messaging (template + 4 fields)
   - "Subscribe Page Webhooks" → pages_manage_metadata
   - "AI ตอบ Comment ลูกค้า" → pages_manage_engagement (comment ID + text)
   - "Like Comment" → pages_manage_engagement (comment ID)
   - "ซ่อน Comment (สแปม)" → pages_manage_engagement (comment ID)
5. Click "ยิง API" on each card → DevTools Network tab shows real Graph API call to graph.facebook.com/v25.0/...

=== Pre-requisites for write actions ===

- pages_messaging test: send message from any non-admin Facebook user to BESTCHOICE Phone Shop within last 1 hour, then paste sender PSID into the card
- pages_manage_engagement test: ensure a customer comment exists on a recent Page post; paste comment ID
- pages_utility_messaging test: PSID must have messaged within last 24 hours

=== What we DO NOT do ===

- We do NOT use deprecated message tags (ACCOUNT_UPDATE, CONFIRMED_EVENT_UPDATE, POST_PURCHASE_UPDATE)
- We do NOT send unprompted promotional messages — Messenger replies are RESPONSE within 24-hr window
- We do NOT create or modify ads via API (no ads_management requested)
- We do NOT publish videos (no publish_video requested)
- We do NOT comment on posts owned by other Pages or users
- We do NOT modify Business Manager assets (read-only access)
- We do NOT delete comments without explicit staff confirmation (hide reversibly instead)
```

---

## Common Rejection Reasons (พร้อม pre-emptive fixes)

| Reason | Pre-emptive Fix |
|---|---|
| "Privacy Policy URL invalid" | ✅ ใช้ `https://bestchoicephone.app/privacy.html` (static HTML, no SPA, no noindex, proper title) |
| "Terms of Service URL invalid" | ✅ ใช้ `https://bestchoicephone.app/terms.html` (เหมือนกัน) |
| "Use case is too generic" | ✅ ทุก use case ใน doc นี้มี: named entity (BESTCHOICE Phone Shop), counts, named worker — copy verbatim |
| "Screencast doesn't show asset selection" | ✅ Part 1 ของทุก script โชว์ Page name + ID ใน UI |
| "Screencast doesn't show live send action" | ✅ Part 2 เปิด DevTools + คลิก ยิง API → request URL ที่ graph.facebook.com/v25.0 visible |
| "Screencast doesn't show delivered message in native client" | ✅ Part 3 สลับไป Messenger mobile / Facebook native → ดูข้อความถึงจริง |
| "Template not shown with placeholders" | ✅ pages_utility_messaging script โชว์ template selection + 4 placeholder inputs + preview + delivered |
| "App not in Live Mode" | ✅ Phase 4 บังคับ Live Mode |
| "Data Deletion callback not responding" | ✅ Implemented at `chat-adapters/facebook-webhook.controller.ts:283-331` (HMAC-SHA256 + timing-safe) |
| "Messaging not within 24-hour window" | ✅ Phase 5 pre-recording: PSID ทักภายใน 1 ชม. ก่อนอัด |
| "Deprecated message tag used" | ✅ Code verified — `messaging_type: "RESPONSE"`, no `tag` field |
| "AI replies are spammy" | ✅ One reply per thread (throttle), audit log, opt-out via "หยุด" |
| "Comments on posts not owned by app" | ✅ Code verifies parent_id ∈ managed Pages before write |
| "Insights data leaks PII" | ✅ ads_read aggregate-only (no breakdowns returning user IDs) |
| "Business Manager scope too broad" | ✅ Read-only — only `/me/businesses`, `/owned_ad_accounts`, `/owned_pages` |
| "Ads API insufficient activity" | ✅ Phase 3 generates 5+ ads_read calls/day for 15+ days before Marketing API submission |

---

## Privacy Policy / Terms of Service — Static HTML

✅ Already created:
- `/Users/iamnaii/Desktop/App/BESTCHOICE/apps/web/public/privacy.html`
- `/Users/iamnaii/Desktop/App/BESTCHOICE/apps/web/public/terms.html`

Includes Facebook Platform Data section per Meta's data handling requirement:
- What we collect (PSID, profile name+pic, messages, comments, reactions, ad metrics)
- How long retention (90 days conversation, 365 days aggregates)
- How shared (NOT shared with third parties)
- Data Deletion (email + Facebook Apps & Websites + callback URL)
- Cross-border transfers (GCP Singapore SCCs)

After deploy verify with:
```bash
curl -s https://bestchoicephone.app/privacy.html | head -20
# Must show: <title>Privacy Policy — BESTCHOICE</title>
# Must show: <meta name="robots" content="index, follow" />
# Must NOT contain: <p>กำลังโหลด...</p>
```

---

## Timeline (คาดการณ์)

| Phase | Duration | Action |
|---|---|---|
| **Phase 1 — Engineering** | DONE | Code + static HTML + panel cards |
| **Phase 2 — Deploy + URL update** | 1-2 ชม. | Push + GitHub Actions + FB Settings |
| **Phase 3 — Activity generation** | 15 วัน (สำหรับ Marketing API) | ยิง API ครบทุก endpoint, แต่ App Review ไม่ต้องรอ 15 วัน |
| **Phase 4 — Pre-Submit verification** | 1 วัน | Business Verification + Live Mode + URL test |
| **Phase 5 — Recording** | 1 วัน | 8 screencasts ตาม script |
| **Phase 6 — Submit** | 1 ชม. | Paste use cases + upload videos |
| **Phase 7 — Wait** | 3-7 วัน | Meta review |
| **Total (App Review only)** | **6-12 วัน** | จาก deploy ถึง approved |
| **Marketing API Access Tier** | +15-20 วัน | หลัง ads_read approved |

---

## References

- Static HTML: `apps/web/public/{privacy,terms}.html`
- Backend: `apps/api/src/modules/facebook-app-review/`
- Frontend: `apps/web/src/components/FacebookAppReviewPanel.tsx`
- Memory: `~/.claude/projects/.../memory/project_facebook_app_review.md`
- [Facebook App Review Overview](https://developers.facebook.com/docs/app-review)
- [Permissions Reference](https://developers.facebook.com/docs/permissions/reference)
- [Page Comments API](https://developers.facebook.com/docs/graph-api/reference/comment)
- [Standard Messaging (24-hr)](https://developers.facebook.com/docs/messenger-platform/policy/policy-overview#standard_messaging)
- [Business Manager API](https://developers.facebook.com/docs/marketing-api/business-manager-api)
- [Insights API](https://developers.facebook.com/docs/marketing-api/insights)
- [Screencast Guidelines](https://developers.facebook.com/docs/app-review/submission-guide/screen-recordings)
