# Facebook App Review — Resubmission Progress (Session Resume)

**Last updated**: 2026-05-09 22:00 ICT
**Submission ID**: 2756954288011332
**Owner**: Akenarin Kongdach
**Reviewer Test Account**: `reviewer@bestchoice.com` (role: ACCOUNTANT — NOT yet created)

ใช้ไฟล์นี้เป็น **single source of truth** ให้ session ใหม่ทำต่อได้

---

## 📊 Status Overview

### Code Deployments (Production-ready)

| Commit | What | Status |
|---|---|---|
| `ad4e837c` | Static privacy.html + terms.html + 8 new endpoints + 13 panel cards + submission doc | ✅ Deployed |
| `af5eeca7` | Pre-flight + smoke-test scripts + ops checklist | ✅ Deployed |
| `b6046df9` | Thai-only translation (reverted) | ✅ Deployed (then superseded) |
| `8c3d4a2b` | Revert Thai-only → bilingual format | ✅ Deployed |
| `a37d922d` | Allow ACCOUNTANT role on /settings/integrations + controller | ✅ Deployed |
| `84db977e` | Fix admin.bestchoicephone.app → bestchoicephone.app in docs | ✅ Deployed |

### Pre-flight 14/14 PASS (verified 2026-05-09 20:35)

```
✓ https://bestchoicephone.app/privacy.html → 200, "Privacy Policy" title, no SPA shell
✓ https://bestchoicephone.app/terms.html → 200, "Terms of Service" title
✓ robots.txt allows .html for FacebookBot + facebookexternalhit
✓ Data Deletion Callback live (HTTP 400 = signature reject = working)
✓ Deauthorize Callback live (HTTP 200)
✓ Admin panel reachable
```

---

## ✅ Done (in Meta App Dashboard)

### App Settings → Basic
- ✅ Privacy Policy URL = `https://bestchoicephone.app/privacy.html`
- ✅ Terms of Service URL = `https://bestchoicephone.app/terms.html`
- ✅ App Mode = Live
- ✅ Business Verification = Approved
- ✅ Email contact verified
- ✅ City field = "Mueang Lopburi" (English, validated)

### App Review → Submission Queue (9 permissions added)
- ✅ pages_show_list
- ✅ pages_messaging
- ✅ pages_manage_metadata
- ✅ pages_utility_messaging
- ✅ pages_read_engagement
- ✅ pages_manage_engagement
- ✅ pages_read_user_content (added later as dependency)
- ✅ ads_read
- ✅ business_management

### App Review → 5-Step Checklist Progress

| # | Step | Status |
|---|---|---|
| 1 | การตรวจสอบยืนยัน (Verification) | ✅ Done |
| 2 | การตั้งค่าแอพ (App Settings) | ✅ Done |
| 3 | การใช้งานที่อนุญาต (Permitted Usage — fill form per permission) | 🟡 In progress (8/9 descriptions filled, screencasts ⭕) |
| 4 | การจัดการข้อมูล (Data Handling) | 🟡 In progress |
| 5 | คำแนะนำของผู้ตรวจสอบ (Reviewer Instructions) | ⭕ Not started |

---

## 🚧 Currently working on

**Step 4 — การจัดการข้อมูล (Data Handling form)**

### Fields filled

| Field | Value | Status |
|---|---|---|
| processor-0 | ใช่ (มี data processor) | ✅ |
| processor-2 (name) | Google Cloud Platform (Google LLC) | ✅ |
| processor-2a (service category) | โซลูชั่นและบริการสารสนเทศ รวมถึงการจัดเก็บและการประมวลผลข้อมูลในระบบคลาวด์ | ✅ |
| processor-2b (countries) | **สิงคโปร์, สหรัฐอเมริกา** (NOT Thailand — server is in asia-southeast1 = Singapore) | ✅ |
| responsible-1 (data controller) | BESTCHOICE PHONE CO., LTD. (Lopburi, Thailand) | ✅ |
| responsible-2 (country of controller) | ไทย (company IS Thai-based, even though servers are in Singapore) | ✅ |
| requests-3 (data shared with public authorities, last 12mo) | **ไม่ได้ให้** | ✅ |
| requests-4 (policies for public auth requests) | **ติ๊ก 3 ข้อ**: ทบทวนกฎหมาย + จำกัดข้อมูล + จัดทำเอกสาร | 🟡 only 1 ticked, need to add 2 more |

### Action: complete requests-4 + scroll for any remaining fields

---

## 📝 9 Permission Descriptions (Ready to Paste)

ใช้ภาษาอังกฤษทั้งหมด — Meta reviewers prefer English. URL: `bestchoicephone.app` (NO admin subdomain).

### 1️⃣ pages_read_user_content

```
BESTCHOICE is an installment payment management system for mobile phone shops in Thailand. We use pages_read_user_content together with pages_read_engagement to read user-generated comments on posts owned by Pages we manage (specifically BESTCHOICE Phone Shop). This is required to enable our AI assistant to scan new comments delivered via the Facebook feed webhook, classify intent (price inquiry, complaint, spam, generic praise), and surface them in our /chat inbox at bestchoicephone.app/chat for staff to prioritize replies.

We do NOT read comments on posts owned by other Pages or users — only posts owned by Pages we manage. The data flow is: Customer comments on our post → Facebook webhook delivers to our backend at api.bestchoicephone.app/api/webhooks/facebook/feed → AI assistant classifies intent → staff sees pre-classified comment in admin inbox.

Retention: comment text + commenter PSID retained for active conversation + 90 days for audit (per Thai PDPA Section 26).

We do NOT share Facebook data with third parties, do NOT use it for advertising to other people, and do NOT post on the user's behalf.
```

### 2️⃣ business_management

```
BESTCHOICE operates Facebook advertising accounts owned by our Business Manager (BESTCHOICE Business Manager). We use business_management to programmatically list the ad accounts and Pages owned by our BM, so we can populate dropdown selectors in our admin panel at bestchoicephone.app/marketing/ads-insights.

Specifically:

1. We call GET /me/businesses to identify the user's accessible Business Managers.

2. We call GET /{business-id}/owned_ad_accounts to list ad accounts owned by BESTCHOICE Business Manager (currently 3 ad accounts, one per branch). We use these IDs to fetch insights via ads_read.

3. We call GET /{business-id}/owned_pages to cross-reference which Facebook Pages our BM owns.

Without business_management, our 4 admin staff would have to manually copy-paste each ad account ID into our system, which is error-prone — BESTCHOICE has 3 ad accounts and they rotate occasionally as we open new branches.

We use this permission READ-ONLY. We do NOT:
- Create or modify Business assets
- Add or remove users from the Business Manager
- Assign or revoke permissions on assets
- Modify any Page or ad account settings via this permission
- Share Business Manager data with third parties

The connection flow: an admin user logs into bestchoicephone.app, connects their Facebook account once, and the system caches the BM ID + ad account list for up to 7 days before re-fetching.
```

### 3️⃣ ads_read

```
BESTCHOICE is an installment payment management system for mobile phone shops in Thailand. Our marketing team uses ads_read to analyze the performance of Facebook ad campaigns we run to drive phone sales and customer engagement. The data feeds an internal dashboard at bestchoicephone.app/marketing/ads-insights which is read-only — no edits, no campaign creation through this app.

Specifically:

1. We call GET /act_{AD_ACCOUNT_ID}/insights with fields=spend,impressions,clicks,reach,cpc,ctr and date_preset=last_30d to pull aggregated 30-day metrics per ad account (BESTCHOICE has 3 ad accounts, one per branch).

2. We use breakdowns=age,gender,region,placement,device_platform to understand audience composition — which phone-model creatives drive the most messenger conversations from cost-conscious 25-40 year-olds in Bangkok metro vs upcountry.

3. We compare CTR between video creative vs static image ads to inform future creative direction.

4. We detect underperforming campaigns in time to pause them via Ads Manager UI (manual — not via this app).

We do NOT create, modify, or delete ads through this permission. All ad management is done manually through the Meta Ads Manager UI by our 1-2 marketing staff. We do NOT share insights data with third parties. We do NOT use any user-level identifiers — Insights API returns aggregate metrics only (no individual user IDs in our query patterns).

Data flow: scheduled cron at api.bestchoicephone.app pulls insights once daily → cached in our PostgreSQL database for fast dashboard rendering → 4 admin staff can view via /marketing/ads-insights → CSV export for archival.

Retention: aggregated metrics stored for 365 days. We rely on Facebook's own retention for source data.
```

**ads_read checkbox**: ✅ ติ๊ก "ระบุสิทธิ์การเข้าถึง API ไปยังข้อมูลประสิทธิภาพโฆษณาของคุณเพื่อใช้ในแดชบอร์ดที่กำหนดเองและการวิเคราะห์ข้อมูล"

### 4️⃣ pages_manage_engagement

```
BESTCHOICE Phone Shop runs Facebook ads and organic posts that receive 50-100 comments per day across active ad creatives. We use pages_manage_engagement to enable our AI assistant ("BESTCHOICE Sales Bot", powered by Claude Sonnet 4.6) to respond to customer questions publicly and to enable our staff to moderate inappropriate content.

Specifically:

1. AI auto-reply: when a customer comments on our post or boosted ad with a question (e.g. "iPhone 15 Pro ผ่อนกี่งวด" / "ดอกเบี้ยกี่เปอร์เซ็นต์"), our AI assistant replies publicly via POST /{comment-id}/comments with a templated answer drawn from our product catalog. This reduces median response time from 4-6 hours (manual) to 30 seconds. AI replies are throttled to one reply per comment thread to avoid spam.

2. Page like: our staff can like helpful customer comments via POST /{comment-id}/likes to acknowledge engagement.

3. Hide spam: when staff identify spam, abusive language, or off-topic content via our /chat inbox at bestchoicephone.app/chat, they can hide the comment via POST /{comment-id} with is_hidden=true. We do NOT delete comments — hidden comments are reversible if mistakenly flagged.

We do NOT comment on posts owned by other Pages or users — only posts owned by Pages we manage. Our backend explicitly verifies comment.parent_id is in our managed Pages list before any write action. Every AI reply and admin hide is logged in our AuditLog table for accountability.

We do NOT use this permission to:
- Auto-like content unrelated to our customer service
- Mass-comment for promotional purposes
- Delete customer comments without staff review
- Engage with content not owned by our Pages

Data flow: Comment posted on our Page → Facebook feed webhook → backend at api.bestchoicephone.app/api/webhooks/facebook/feed → AI classifier (uses pages_read_user_content + pages_read_engagement) → if confident, AI replies via POST /{comment-id}/comments → audit logged.
```

### 5️⃣ pages_utility_messaging

```
BESTCHOICE uses pages_utility_messaging to send templated transactional notifications to customers who have an active conversation with our Page on Messenger. We use templates with named placeholders ({{customerName}}, {{orderId}}, {{amount}}, {{dueDate}}) for three specific event types:

1. payment_due_reminder — sent within the customer-initiated 24-hour window when the customer asks about payment status, replied via messaging_type=RESPONSE. Template renders to: "สวัสดีคุณ {{customerName}} ใบงวด #{{orderId}} ยอด {{amount}} บาท ครบกำหนด {{dueDate}} นะคะ".

2. order_confirmation — sent immediately after a customer initiates an order confirmation request via Messenger.

3. contract_ready — notifies the customer that their installment contract is ready for digital signature.

Template selection and placeholder values are populated server-side by our admin staff via a controlled UI at bestchoicephone.app — staff cannot send arbitrary text. The server validates the template key against an allow-list of 3 named templates and renders the message before calling POST /{PAGE_ID}/messages.

We deliberately do NOT use any deprecated message tags (ACCOUNT_UPDATE, CONFIRMED_EVENT_UPDATE, POST_PURCHASE_UPDATE deprecated 2026-04-27). Out-of-window reminders go via LINE Official Account or SMS — Messenger is reserved for customer-initiated conversations only.

We do NOT send unsolicited promotional messages. We do NOT use this permission to send marketing campaigns. We do NOT share Messenger conversation data with third parties.

Retention: PSID + message text retained for active conversation + 90 days for audit (per Thai PDPA Section 26).
```

### 6️⃣ pages_manage_metadata

```
BESTCHOICE uses pages_manage_metadata to subscribe our app to Page webhook events for our connected Facebook Page (BESTCHOICE Phone Shop). This is required to receive real-time webhooks from Facebook so our backend at api.bestchoicephone.app/api/webhooks/facebook/* can react to customer activity within seconds.

Specifically, we call POST /{PAGE_ID}/subscribed_apps with subscribed_fields including:
- messages — to receive Messenger messages from customers
- messaging_postbacks — to handle quick reply button taps
- message_deliveries — for delivery status tracking
- message_reads — for read receipt tracking
- feed — to receive notifications when customers comment on our posts/ads

Without this permission, our app would have to poll the Graph API for new messages and comments, which is inefficient, increases latency from seconds to minutes, and conflicts with Meta's rate limit guidelines.

The subscription is performed once during initial Page connection at bestchoicephone.app/settings/integrations and re-verified weekly. Our app is the sole subscriber for these fields on our Page.

We do NOT use this permission to:
- Modify Page name, profile picture, or other public Page settings
- Change Page category, description, or contact info
- Subscribe other Pages we don't own
- Override or delete subscriptions of other apps on the same Page

We use this permission strictly for webhook subscription management — no other Page metadata is read or written.
```

### 7️⃣ pages_read_engagement

```
BESTCHOICE uses pages_read_engagement to read post-level and comment-level engagement metrics on posts owned by Pages we manage (BESTCHOICE Phone Shop). This is paired with pages_read_user_content to enable customer service and sentiment analysis on our 50-100 daily comments.

Specifically:

1. We call GET /{PAGE_ID}/feed?fields=id,message,created_time,comments.limit(0).summary(true) to list our recent posts with comment counts. This populates the feed view in our admin /chat inbox at bestchoicephone.app/chat for staff to monitor.

2. We call GET /{POST_ID}/comments?fields=id,from,message,created_time,parent,like_count to read comment threads under our posts and ads. The like_count helps us identify which customer questions resonate most with the audience.

3. We aggregate reaction summaries (like, love, angry, etc.) per post type to inform marketing creative direction — e.g. which phone-model post type drives the highest positive engagement.

4. The cron at api.bestchoicephone.app pulls new comments every 5 minutes via this permission, complementing the real-time feed webhook. This dual-channel approach ensures no comment is missed even during webhook delivery delays.

We use this permission READ-ONLY in combination with pages_read_user_content (which provides user-content access). We do NOT modify, delete, or hide any content via this permission — those actions go through pages_manage_engagement separately.

We do NOT read posts or comments on Pages we don't own. The Page Access Token we use is scoped to BESTCHOICE Phone Shop only.

Retention: comment metadata + reaction counts retained for active + 90 days. Aggregated reaction summaries (anonymized) retained for 365 days for marketing analysis.
```

### 8️⃣ pages_messaging

**Description (textarea 1):**

```
BESTCHOICE uses pages_messaging to allow our AI assistant ("BESTCHOICE Sales Bot", powered by Claude Sonnet 4.6) and human staff to reply to customers who message our Page on Messenger about installment plans, payment status, phone availability, and after-sales service.

All replies are sent within the 24-hour customer-initiated response window using messaging_type=RESPONSE. We do NOT use any deprecated message tags (ACCOUNT_UPDATE, CONFIRMED_EVENT_UPDATE, POST_PURCHASE_UPDATE deprecated 2026-04-27).

Specifically:

1. Customers initiate a conversation by messaging BESTCHOICE Phone Shop on Messenger with questions like "งวดผ่อนเดือนหน้าจ่ายเท่าไหร่" / "iPhone 15 Pro มีไหม".

2. Our backend at api.bestchoicephone.app/api/webhooks/facebook/messages receives the message via webhook within 1 second.

3. The Sales Bot processes intent (Claude Sonnet 4.6 fine-tuned on product catalog + pricing) and replies via POST /{PAGE_ID}/messages with messaging_type=RESPONSE within 1-3 seconds.

4. If bot confidence is below 0.7, the conversation escalates to a human staff member via /chat inbox at bestchoicephone.app/chat where staff can reply manually.

We do NOT send unsolicited promotional messages. We do NOT broadcast marketing content. Customer payment-due reminders go via LINE Official Account or SMS — never Messenger.

Volume: 200-400 customer-initiated conversations per month.

Opt-out: customers replying "หยุด" / "STOP" trigger the bot to pause auto-replies; conversation continues only with human takeover.

Retention: PSID + message content retained for active conversation + 90 days for audit (per Thai PDPA Section 26).
```

**Page dropdown**: เลือก **BESTCHOICE Phone Shop**

**Reproduction Instructions (textarea 2 — clear default text first):**

```
Pre-condition: From a separate non-admin Facebook account, send a message to the connected BESTCHOICE Phone Shop Page on Messenger within the last 1 hour, e.g. "งวดผ่อนเดือนหน้าจ่ายเท่าไหร่". This establishes a 24-hour customer-initiated response window with a real PSID.

Step 1: Login to admin panel at https://bestchoicephone.app/login using the test reviewer credentials provided in the App Settings test users section.

Step 2: Navigate to Settings → Integrations. Confirm the connected Page shows "BESTCHOICE Phone Shop" with its Page ID.

Step 3: Open browser DevTools (Network tab, filter "graph.facebook.com").

Step 4: Scroll to "Facebook App Review Panel" section and locate the card titled "ตอบ Messenger ลูกค้า (24hr RESPONSE)".

Step 5: Paste the sender PSID from the pre-condition step into the "PSID ผู้รับ" field. The reply text "สวัสดีค่ะ ขอบคุณที่ติดต่อ BESTCHOICE มีอะไรให้ช่วยคะ?" is pre-filled.

Step 6: Click the "ยิง API" button. DevTools Network tab shows:
- Request: POST https://graph.facebook.com/v25.0/{PAGE_ID}/messages
- Body: {"messaging_type":"RESPONSE","recipient":{"id":"<PSID>"},"message":{"text":"..."}}
- Response: 200 OK with message_id

Step 7: Switch to the Messenger mobile app on the second Facebook account. The reply message is delivered within 1-2 seconds and visible in the conversation thread.

Production usage: The same backend route is invoked automatically by our Sales Bot worker (Claude Sonnet 4.6) when a customer message arrives via webhook at api.bestchoicephone.app/api/webhooks/facebook/messages. Reviewer can also observe live conversations at bestchoicephone.app/chat where messages stream in real-time.
```

### 9️⃣ pages_show_list

```
BESTCHOICE uses pages_show_list exclusively in the Page connection flow at bestchoicephone.app/settings/integrations. When a BESTCHOICE staff member with admin role connects their Facebook account for the first time, we call GET /me/accounts?fields=id,name,category,tasks to display only the Pages they manage so they can pick the correct one (BESTCHOICE Phone Shop).

Without this permission, staff would have to copy-paste Page IDs and Page Access Tokens manually from Facebook Business Suite, which is error-prone and exposes long-lived tokens to clipboard managers and screen recordings.

After the user picks a Page, we store the resulting page-scoped access token (encrypted at rest with AES-256) and never call /me/accounts again for that account. The connection is one-time per admin user — pages_show_list is not used in any production cron or runtime path.

We have 4 admin staff accounts that need to connect Pages, so this permission is needed at Advanced Access level (Standard Access only allows app admins/devs/testers, which doesn't cover production staff).

We do NOT use this permission to:
- Discover Pages the user doesn't manage
- Connect to Pages the user hasn't explicitly selected
- Re-authenticate without user action

The permission is requested with minimal scope: only id, name, category, and tasks fields are read. We do not request access_token from this endpoint — Page Access Tokens are obtained separately via the Page connection consent flow.
```

---

## 📊 Step 4 — Data Handling Form Answers

### Filled-in answers

| Field | Value |
|---|---|
| processor-0 (have processor?) | ใช่ |
| processor-2 (name) | Google Cloud Platform (Google LLC) |
| processor-2a (service) | โซลูชั่นและบริการสารสนเทศ รวมถึงการจัดเก็บและการประมวลผลข้อมูลในระบบคลาวด์ |
| processor-2b (countries) | สิงคโปร์, สหรัฐอเมริกา |
| responsible-1 (controller) | BESTCHOICE PHONE CO., LTD. info |
| responsible-2 (controller country) | ไทย |
| requests-3 (data given to public auth) | ไม่ได้ให้ |
| requests-4 (policies, tick 3 boxes) | ✅ ทบทวนกฎหมาย, ✅ จำกัดข้อมูล, ✅ จัดทำเอกสาร |

### Long-form text for processor-2 (if needed)

```
Google Cloud Platform (operated by Google LLC)

Services used:
- Cloud Run (application hosting for bestchoicephone.app and api.bestchoicephone.app)
- Cloud SQL PostgreSQL 16 (primary database)
- Cloud Storage (file uploads, encrypted at rest)
- Firebase Hosting (static asset CDN)

Region: asia-southeast1 (Singapore)

Data Processing Agreement: Google Cloud Data Processing Addendum
Sub-processors: per Google's published list at https://cloud.google.com/terms/subprocessors
Purpose: Application hosting and database storage in Southeast Asia
Cross-border transfer mechanism: Standard Contractual Clauses (SCCs)
Website: https://cloud.google.com
```

### Long-form text for responsible-2 / DPO (if needed)

```
Akenarin Kongdach
Position: Owner / Founder / Chief Privacy Officer
Email: akenarin.ak@gmail.com
Phone: (available on request via email)
Address: 456/19-21 Narai Maharaj Road, Thalae Chubsorn Sub-district, Mueang Lopburi District, Lopburi Province 15000, Thailand

Responsibilities:
- Handling data subject access requests (PDPA Section 30)
- Processing deletion requests within 30 days (PDPA Section 33)
- Responding to Meta Platform Data deletion callbacks
- Breach notification within 72 hours per PDPA requirements
- Liaison with Thailand Personal Data Protection Committee (PDPC) when required
```

---

## 📝 Step 5 — Reviewer Instructions (NEXT)

### Test Account

```
URL: https://bestchoicephone.app/login
Email: reviewer@bestchoice.com
Password: <strong password — generate fresh, save in password manager>
Role: ACCOUNTANT (now has access after commit a37d922d)
```

### Test Step-by-step Instructions (paste in form)

```
=== Test Account ===
URL: https://bestchoicephone.app/login
Email: reviewer@bestchoice.com
Password: <provided to Meta via secure form>
Role: ACCOUNTANT (full access to Facebook App Review Panel)

=== Test Page & Business Manager ===
Page name: BESTCHOICE Phone Shop
Page ID: <fill in actual Page ID>
Business Manager: BESTCHOICE Business Manager
BM ID: <fill in actual BM ID>
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
   - "ส่ง Utility Template (มี placeholder)" → pages_utility_messaging
   - "Subscribe Page Webhooks" → pages_manage_metadata
   - "AI ตอบ Comment ลูกค้า" → pages_manage_engagement
   - "Like Comment" → pages_manage_engagement
   - "ซ่อน Comment (สแปม)" → pages_manage_engagement
5. Click "ยิง API" on each card → DevTools Network tab shows real Graph API call.

=== Pre-requisites for write actions ===

- pages_messaging test: send message from non-admin Facebook user to Page within last 1 hour, paste sender PSID into card
- pages_manage_engagement test: ensure customer comment exists on recent Page post; paste comment ID
- pages_utility_messaging test: PSID must have messaged within last 24 hours

=== What we DO NOT do ===

- Do NOT use deprecated message tags (ACCOUNT_UPDATE, CONFIRMED_EVENT_UPDATE, POST_PURCHASE_UPDATE)
- Do NOT send unprompted promotional messages — Messenger replies are RESPONSE within 24-hr window
- Do NOT create or modify ads via API
- Do NOT publish videos
- Do NOT comment on posts owned by other Pages or users
- Do NOT modify Business Manager assets (read-only access)
- Do NOT delete comments without staff confirmation (hide reversibly instead)
```

---

## 🎬 Screencast Plan (Required before Submit)

### Pre-recording Checklist

| ✓ | Item |
|---|---|
| □ | Reviewer account created (`reviewer@bestchoice.com`, ACCOUNTANT role) |
| □ | Page Access Token configured in Integration Hub |
| □ | Page ID known |
| □ | Ad Account ID (act_NUMBER) known |
| □ | Business Manager ID known |
| □ | PSID active (within 24 hr) |
| □ | Comment ID on recent post (from non-admin user) |
| □ | Spam Comment ID (for hide demo) |
| □ | DevTools open + filter "graph.facebook.com" + Preserve log ON |

### 8 Screencasts to Record

| # | Permission | Length | Pre-req |
|---|---|---|---|
| 1 | pages_show_list | 45s | — |
| 2 | pages_messaging | 90s | PSID active |
| 3 | pages_manage_metadata | 45s | — |
| 4 | pages_utility_messaging | 90s | PSID active + 4 placeholder values |
| 5 | pages_read_engagement | 75s | Comment ID |
| 6 | pages_manage_engagement | 120s | Comment + spam Comment ID |
| 7 | ads_read | 60s | Ad Account ID |
| 8 | business_management | 75s | Business Manager ID |

(Note: pages_read_user_content can be combined with pages_read_engagement — same flow)

### Every Clip MUST Show 3 Parts

1. **Asset Selection** — Page name visible in app UI
2. **Live Send Action** — DevTools shows `graph.facebook.com/v25.0/...` API call
3. **Native Client Delivery** — switch to Messenger mobile / FB native, message visible

### Compress After Recording

```bash
for f in *.mov; do
  ffmpeg -i "$f" -crf 28 -preset slow -c:v libx264 -c:a aac -b:a 96k "${f%.mov}.mp4"
done
ls -lh *.mp4   # verify under 100MB each
```

---

## 📋 Final Submit Checklist

| ✓ | Step |
|---|---|
| □ | All 9 permissions have description ✅ in Step 3 |
| □ | All 9 permissions have screencast uploaded |
| □ | All 9 permissions have agree checkbox ticked |
| □ | Step 4 (Data Handling) complete — all fields filled |
| □ | Step 5 (Reviewer Instructions) complete — test account + step-by-step |
| □ | Pre-flight `./tools/fb-app-review-preflight.sh` PASS 14/14 |
| □ | Smoke test `./tools/fb-app-review-smoke.sh` PASS — generates "Activity detected" |
| □ | Wait 24 hr after smoke test for Meta Dashboard to show activity |
| □ | All 5 checklist items in App Review main page = ✅ |
| □ | Click "ส่งเพื่อรับการตรวจสอบ" |
| □ | Save Submission ID |

---

## 🐛 Known Issues / Things to Fix

### URL fix needed in already-saved forms

Forms 1-4 likely have `admin.bestchoicephone.app` (wrong subdomain). Need to:
- Go back to Step 3 (การใช้งานที่อนุญาต)
- Click "เริ่มต้นใช้งาน" or "แก้ไข" on each card
- In description text → replace `admin.bestchoicephone.app` → `bestchoicephone.app`
- Re-save

Affected: pages_read_user_content, business_management, ads_read, pages_manage_engagement

(Forms 5-9 should have correct URL since I caught the issue at form 8)

### API test calls (0/1) on most permissions

After running smoke test (`./tools/fb-app-review-smoke.sh`), each permission's API test counter will go to 1/1. Wait 24 hr for Meta Dashboard to detect.

### Screencast required for ALL 9 permissions

Without screencast, Submit button stays grey. Record day = full day commitment.

---

## 🛠 Useful Tools Created

| Tool | Purpose | Location |
|---|---|---|
| Pre-flight check | Verify URLs, callbacks, robots.txt before submit | `tools/fb-app-review-preflight.sh` |
| Smoke test | Generate API activity for all 9 permissions | `tools/fb-app-review-smoke.sh` |
| Operations checklist | Full operational runbook | `docs/guides/FACEBOOK-APP-REVIEW-OPERATIONS.md` |
| Submission package | Use cases + screencast scripts | `docs/guides/FACEBOOK-APP-REVIEW-SUBMISSION.md` |
| Endpoint runbook | Graph API endpoint mapping | `docs/guides/FACEBOOK-APP-REVIEW.md` |
| **This file** | Session resume / progress tracker | `docs/guides/FACEBOOK-APP-REVIEW-PROGRESS.md` |

---

## 📞 Contact / Reference

- Owner: Akenarin Kongdach (akenarin.ak@gmail.com)
- App ID: 2736219233418171
- Business ID: 1766813540286850
- Submission ID: 2756954288011332
- Production: https://bestchoicephone.app
- API: https://api.bestchoicephone.app
- Privacy: https://bestchoicephone.app/privacy.html
- Terms: https://bestchoicephone.app/terms.html

---

## 🔄 How to Resume in New Session

1. Open this file first: `docs/guides/FACEBOOK-APP-REVIEW-PROGRESS.md`
2. Check "Status Overview" + "Currently working on" sections
3. Continue from where left off
4. Update "Last updated" timestamp + status as you progress
5. Reference description blocks above for paste-ready content
6. When done, mark final checklist items as completed
