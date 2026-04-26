# Facebook App Review — Submission Package

เอกสารชุดนี้เตรียมไว้สำหรับ **submit ขอ permissions กับ Meta App Review** หลังจากยิง API ครบตาม runbook ใน [FACEBOOK-APP-REVIEW.md](./FACEBOOK-APP-REVIEW.md) แล้ว

> **อัปเดต 2026-04-26 (post-ultrareview):** เอกสารฉบับเดิมอ้างถึงหน้าจอที่ไม่มีในระบบจริง (Promotion Dashboard / Lead Ads Sync / Video Library) และใช้ tag `ACCOUNT_UPDATE` ที่ Meta ประกาศ deprecate มีผล **2026-04-27**. ฉบับนี้รีวิวใหม่ให้ตรงกับ UI จริง (`Settings → Integrations → Facebook App Review Panel`) และเปลี่ยนกลยุทธ์ messaging.

## Scope ของ Submission รอบนี้: **6 Permissions** (ตัด Live Video API ออก)

1. `pages_show_list` — list connected pages
2. `pages_manage_ads` — identify promotable posts
3. `pages_messaging` (เปลี่ยนจาก `pages_utility_messaging`) — response messaging within 24-hour window
4. `ads_management` + `ads_read` — create/manage campaigns
5. `leads_retrieval` — import Lead Ads leads (critical)
6. `publish_video` — upload product review videos

**ตัด Live Video API ออกเพราะ**: ไม่ใช่ core business (ดูเหตุผลล่างสุดของไฟล์)

> **BLOCKER ที่ต้องตัดสินใจก่อน submit (เพิ่มใหม่ 2026-04-26)**:
>
> เดิมเอกสารระบุใช้ `pages_utility_messaging` + tag `ACCOUNT_UPDATE`. Meta deprecate tag นี้ **มีผล 2026-04-27** (พร้อม `CONFIRMED_EVENT_UPDATE` / `POST_PURCHASE_UPDATE`).
>
> **ทางเลือก** (เลือกอย่างใดอย่างหนึ่งก่อน submit):
>
> **A. ใช้ 24-hour RESPONSE window อย่างเดียว** (แนะนำ)
> - ขอแค่ `pages_messaging` (มาตรฐาน)
> - ส่งข้อความได้ภายใน 24 ชม. หลังลูกค้าทักมา (any content)
> - Use case: ลูกค้าทักมาถาม payment → ตอบ + ส่ง reminder ในการสนทนาเดียวกันได้
> - Reminder อัตโนมัติ (cron) → **ใช้ LINE/SMS แทน** (ระบบมี LINE OA + SMS adapter อยู่แล้ว)
>
> **B. ใช้ HUMAN_AGENT tag** (มี constraint)
> - ต้องเปิด "Human Agent" feature ใน Page settings ก่อน
> - Window 7 วัน หลังลูกค้าทัก
> - ต้องเป็น human-led service (ไม่ใช่ automated reminder cron)
>
> **ตัดสินใจที่: (A) เพราะ cron auto-reminder มี LINE/SMS อยู่แล้ว, ลด surface ที่ Meta ต้อง audit, ถูกที่สุด**
>
> ถ้าเลือก (A) → service code ต้องอัปเดต default tag ออกจาก `ACCOUNT_UPDATE` → ดู *Code changes required* ด้านล่าง

## App Info (ต้องกรอกในฟอร์ม Meta)

| Field | Value |
|---|---|
| App Name | BESTCHOICE |
| App ID | ดูจาก developers.facebook.com/apps |
| Business Name | บจก. เบสท์ช้อยส์โฟน (BESTCHOICE SHOP) + บจก. เบสท์ช้อยส์ไฟแนนซ์ |
| Category | Business |
| App Type | Business |
| Privacy Policy URL | `https://bestchoicephone.app/privacy` |
| Terms of Service URL | `https://bestchoicephone.app/terms` |
| Data Deletion Callback URL | `https://api.bestchoicephone.app/api/webhooks/facebook/data-deletion` |
| Deauthorize Callback URL | `https://api.bestchoicephone.app/api/webhooks/facebook/deauthorize` |
| Platform | Website |
| Website URL | `https://bestchoicephone.app` |

> **โดเมน admin จริง**: `https://admin.bestchoicephone.app` (ไม่ใช่ `admin.bestchoice.com` ตามฉบับเก่า)

---

## How It Works — Overview (paste ในช่อง "How will your app use this permission?")

> BESTCHOICE is an installment payment management system for mobile phone shops in Thailand. Customers purchase phones through flexible installment plans (down payment + monthly payments over 6-36 months). The business operates physical retail stores and manages the full customer lifecycle from lead capture, contract signing, payment collection, to overdue recovery.
>
> We use Facebook Pages, Messenger, Lead Ads, and Marketing APIs to (1) capture new leads via lead generation campaigns, (2) reply to customers via Messenger within the 24-hour response window when they message our Page about their installment contract, (3) promote product content through paid ads, and (4) publish product review videos about phones and installment plan demos. All Graph API actions originate from a single admin panel — `Settings → Integrations → Facebook App Review Panel` — which exposes one button per permission for the reviewer to test.

---

## Where the actual UI lives (อ่านก่อนอัด screencast)

ระบบจริงไม่มีหน้า "Promotion Dashboard" / "Lead Ads Sync" / "Video Library" แยกจากกัน — ทุก Graph API call ที่ Meta ต้องเห็นถูกรวมไว้ใน **panel เดียว**:

- **เส้นทาง**: `https://admin.bestchoicephone.app/settings/integrations`
- **Component**: `apps/web/src/components/FacebookAppReviewPanel.tsx`
- **เลื่อนลงไปส่วน Facebook App Review Panel** — มีปุ่มเดี่ยวต่อ permission พร้อม payload preview + response view

หน้านี้คือ "การยอมรับ" ตาม Meta convention: review tooling ที่ owner กดทดสอบ Graph API ได้แบบ deterministic (ไม่ต้อง simulate user flow ข้ามหลายหน้า) — Meta accept ได้ตราบเท่าที่ screencast แสดง API call จริงไปที่ `graph.facebook.com/v25.0/...` พร้อม payload ที่ตรงกับ permission

---

## Permission #1 — `pages_show_list`

### Use Case Description

> Our admin users (shop owners and branch managers) need to connect their Facebook Pages to BESTCHOICE so we can automate messaging, ad management, and lead syncing per-page. We call `GET /me/accounts` to display a list of Pages they manage. Without this permission, the user would have to manually copy-paste Page IDs and Page Access Tokens from Facebook Business Suite, which is error-prone and insecure.

### Screencast Script (30-45 sec)

1. **[0:00-0:05]** Show admin login at `admin.bestchoicephone.app/login`
2. **[0:05-0:15]** Log in as OWNER, navigate to **Settings → Integrations**
3. **[0:15-0:25]** Scroll to **Facebook App Review Panel** — click the **"ดึงรายการ Pages ที่จัดการ"** button (key `pages_show_list`)
4. **[0:25-0:40]** DevTools Network tab shows `GET https://graph.facebook.com/v25.0/me/accounts?fields=id,name,access_token,tasks` — response with managed Pages list rendered in panel
5. **[0:40-0:50]** Narrate: "This list comes from `pages_show_list` — the only place we call this is on the connect-page flow"

### Technical Endpoint

```
GET https://graph.facebook.com/v25.0/me/accounts?fields=id,name,access_token,tasks
```

Backend route (OWNER-only): `GET /facebook/app-review/pages`

---

## Permission #2 — `pages_manage_ads`

### Use Case Description

> After connecting a Page, shop owners want to identify which of their organic posts are eligible for paid promotion (boosting). The Facebook App Review Panel exposes a single test action that calls `GET /{page-id}/published_posts?fields=is_eligible_for_promotion` and renders the result. In production usage, the same data is consumed by the boost-from-post action wired into our paid ads workflow (Permission #4).

### Screencast Script (30-45 sec)

1. **[0:00-0:10]** Open **Settings → Integrations → Facebook App Review Panel**
2. **[0:10-0:25]** Click **"ดูโพสต์ที่ boost ได้"** (`pages_manage_ads`)
3. **[0:25-0:35]** DevTools shows `GET https://graph.facebook.com/v25.0/{PAGE_ID}/published_posts?fields=id,message,is_eligible_for_promotion`
4. **[0:35-0:50]** Panel renders posts table with green "eligible" badge — indicate that this is the same field consumed by the boost-post writer test (Permission #4)

### Technical Endpoint

```
GET https://graph.facebook.com/v25.0/{PAGE_ID}/published_posts?fields=id,message,is_eligible_for_promotion
```

Backend route: `GET /facebook/app-review/promotable-posts`

---

## Permission #3 — `pages_messaging` (RESPONSE within 24-hour window)

> **เปลี่ยนจากฉบับเก่า**: ขอ `pages_messaging` (มาตรฐาน) แทน `pages_utility_messaging` + ACCOUNT_UPDATE (deprecated 2026-04-27)

### Use Case Description

> When a customer with an active installment contract messages our Page asking about their payment status, our staff (or our chat bot answering installment questions) replies within the 24-hour response window using `messaging_type=RESPONSE`. We do not send unprompted promotional messages and we do not use deprecated message tags. Customers who want automated reminders before each due date receive them via LINE OA (separate channel) or SMS — Facebook Messenger is reserved for customer-initiated conversations.

### Screencast Script (45-60 sec)

1. **[0:00-0:10]** Open **Settings → Integrations → Facebook App Review Panel**
2. **[0:10-0:25]** Click **"ส่งข้อความตอบลูกค้า (24-hr window)"** (`standard_message`) — input PSID of test customer who messaged the Page within the last hour
3. **[0:25-0:40]** DevTools shows `POST https://graph.facebook.com/v25.0/{PAGE_ID}/messages` with `messaging_type: 'RESPONSE'` (no MESSAGE_TAG)
4. **[0:40-0:55]** Switch to Messenger mobile — show message arrived
5. **[0:55-1:05]** Back to admin — show webhook log entry for both inbound (customer ask) and outbound (staff reply)

### Technical Endpoint

```
POST https://graph.facebook.com/v25.0/{PAGE_ID}/messages
{
  "recipient": {"id": "PSID"},
  "messaging_type": "RESPONSE",
  "message": {"text": "..."}
}
```

Backend route: `POST /facebook/app-review/standard-message`

### Critical talking points

- **Customer-initiated only** — we never send messages to PSIDs that have not messaged us in the last 24 hours
- **No deprecated tags** — we explicitly do not use `ACCOUNT_UPDATE`, `CONFIRMED_EVENT_UPDATE`, or `POST_PURCHASE_UPDATE` (deprecated 2026-04-27)
- **Automated reminders use LINE/SMS** — Messenger is human-driven only
- **Opt-out automatic** — replying "หยุด" / "STOP" pauses the conversation
- **Retention**: PSID kept only while the conversation is active + 90 days for audit

### Code changes required (before submit)

```ts
// apps/api/src/modules/facebook-app-review/facebook-app-review.service.ts:106-107
// BEFORE
messaging_type: 'MESSAGE_TAG',
tag: dto.tag ?? 'ACCOUNT_UPDATE',

// AFTER
messaging_type: 'RESPONSE',
// no tag — RESPONSE allows any content within 24-hr window
```

→ remove the `tag` field from `SendUtilityMessageDto`. Rename test action `utility_message` → `standard_message` ใน `FacebookAppReviewPanel.tsx`. Update DTO Thai validation message.

---

## Permission #4 — `ads_management` + `ads_read`

### Use Case Description

> Shop branches run Facebook Ad campaigns to drive phone sales and installment-plan leads. The admin panel surfaces a single test action per ads endpoint so a reviewer can exercise create/update/insights flows directly. Production usage triggers the same backend routes from inline campaign actions in the Facebook App Review Panel (initially) and will be exposed in a richer dashboard once the permission is approved and we have real campaign data to display.

### Screencast Script (60-75 sec)

1. **[0:00-0:15]** Open **Settings → Integrations → Facebook App Review Panel**
2. **[0:15-0:30]** Click **"สร้าง Campaign (PAUSED)"** (`create_campaign`) — input name, daily budget, objective (LEAD_GENERATION). DevTools shows `POST https://graph.facebook.com/v25.0/act_{AD_ACCOUNT_ID}/campaigns`
3. **[0:30-0:45]** Click **"เปลี่ยนสถานะ Campaign"** (`update_campaign_status`) — pass campaign id from step 2 → DevTools shows `POST /{CAMPAIGN_ID}` with `{status: ACTIVE}`
4. **[0:45-1:00]** Click **"ดู Insights ของ Ad Account (30 วัน)"** (`ads_insights`) — DevTools shows `GET /act_{AD_ACCOUNT_ID}/insights`
5. **[1:00-1:15]** Panel renders insights JSON (spend, impressions, CTR)

### Technical Endpoint

```
POST https://graph.facebook.com/v25.0/act_{AD_ACCOUNT_ID}/campaigns
  { name, objective, status: "PAUSED", special_ad_categories: [] }
POST https://graph.facebook.com/v25.0/{CAMPAIGN_ID}
  { status: "ACTIVE" }
GET  https://graph.facebook.com/v25.0/act_{AD_ACCOUNT_ID}/insights
```

Backend routes:
- `POST /facebook/app-review/campaigns`
- `PATCH /facebook/app-review/campaigns/:id/status`
- `GET /facebook/app-review/insights`

---

## Permission #5 — `leads_retrieval`

### Use Case Description

> We run Facebook Lead Ads targeting people interested in phone installment plans. When a user submits a lead form on Facebook, we import that lead into BESTCHOICE customer database so our sales team can follow up within minutes. The Facebook App Review Panel exposes one test for listing forms and one for fetching leads from a chosen form; the same backend routes are called by an existing `LeadFormSyncCron` (every 30 minutes) once the permission is approved.

### Screencast Script (45-60 sec)

1. **[0:00-0:10]** Open **Settings → Integrations → Facebook App Review Panel**
2. **[0:10-0:25]** Click **"ดูรายการ Lead Forms ของเพจ"** (`lead_forms_list`) — DevTools shows `GET /{PAGE_ID}/leadgen_forms`
3. **[0:25-0:45]** Click **"ดึง Leads ของฟอร์มที่เลือก"** (`lead_form_leads`) — DevTools shows `GET /{FORM_ID}/leads?fields=id,created_time,field_data`
4. **[0:45-1:00]** Navigate to **Customers** page — show new customers with `source="facebook-lead-ad"` populated automatically by the cron-equivalent code path that the test triggers

### Technical Endpoint

```
GET https://graph.facebook.com/v25.0/{PAGE_ID}/leadgen_forms?fields=id,name,status
GET https://graph.facebook.com/v25.0/{FORM_ID}/leads?fields=id,created_time,field_data
```

Backend routes:
- `GET /facebook/app-review/lead-forms`
- `GET /facebook/app-review/lead-forms/:id/leads`

---

## Permission #6 — `publish_video`

### Use Case Description

> Our marketing team creates product demo videos. The admin panel surfaces a test action that publishes a sample video file to the connected Page via `POST /{page-id}/videos` with `file_url`. In production, the same backend route is invoked from the per-product publish workflow once the permission is approved and the video CMS is fully wired (currently pending — see roadmap).

### Screencast Script (30-45 sec)

1. **[0:00-0:10]** Open **Settings → Integrations → Facebook App Review Panel**
2. **[0:10-0:25]** Click **"Publish Video to Page"** (`publish_video`) — input title, description, and a hosted MP4 URL
3. **[0:25-0:40]** DevTools shows `POST https://graph.facebook.com/v25.0/{PAGE_ID}/videos` with `file_url`, response includes Facebook video id
4. **[0:40-0:55]** Switch to Facebook Page → video appears under Videos tab

### Technical Endpoint

```
POST https://graph.facebook.com/v25.0/{PAGE_ID}/videos
  { file_url: "https://...mp4", title, description }
```

Backend route: `POST /facebook/app-review/videos`

---

## ~~Permission #7 — Live Video API~~ (ตัดออกจาก submission นี้)

**Decision: ไม่ส่ง Live Video API ใน submission รอบนี้** (2026-04-22)

### เหตุผล
- BESTCHOICE = ร้านผ่อนมือถือ ไม่ใช่ media/streaming business
- ปัจจุบัน 0 lives บนเพจ — ไม่มีหลักฐาน usage จริงให้ reviewer
- Screencast ต้องอัด OBS setup + stream key + broadcast — reviewer เข้มเรื่องนี้มาก
- Meta ชอบถาม "ทำไมไม่ใช้ Creator Studio?" → ตอบยาก
- ยิ่ง permission น้อย → approve เร็วขึ้น

### ถ้าจะ resubmit ทีหลัง
- Backend code ยังคงอยู่ที่ `apps/api/src/modules/facebook-app-review/` (ไม่ต้องลบ)
- Runbook ยังคงอยู่ที่ [FACEBOOK-APP-REVIEW.md](./FACEBOOK-APP-REVIEW.md)
- เงื่อนไขก่อน resubmit: ต้องมี **business case จริง** (live ขายจริง 3-5 ครั้ง/เดือน ติดต่อกัน 2 เดือน) แล้วค่อยส่ง App Review พร้อม analytics stats

---

## Submission Checklist

### Pre-Submit (วันนี้ — 24 ชม.)

- [x] ยิง API ครบ 6 permissions ที่ submit + ทดสอบ Live Video API (ไม่ submit) (2026-04-22)
- [ ] **อัปเดต service code**: เปลี่ยน default `messaging_type` จาก MESSAGE_TAG/ACCOUNT_UPDATE → RESPONSE (ดู Permission #3 → Code changes required)
- [ ] รอ 24 ชม. — ตรวจ **App Dashboard → App Review → Permissions and Features** ว่าทุก permission ขึ้น **"Activity detected within 30 days"**
- [ ] เปลี่ยน permission request จาก `pages_utility_messaging` → `pages_messaging`

### Business Verification (ถ้ายังไม่ผ่าน — 3-5 วัน)

- [ ] ไป **App Dashboard → Settings → Business Verification**
- [ ] อัปโหลดเอกสาร: **หนังสือรับรองบริษัท (คัดใหม่ไม่เกิน 6 เดือน)**, **ภ.พ.20** (สำหรับ FINANCE ที่จด VAT)
- [ ] กรอกที่อยู่จริง + เบอร์โทรที่รับสายได้ (Meta อาจโทรมาเช็ค)
- [ ] รอ Meta review 2-5 วันทำการ

### Data Use Checkup

- [ ] **App Dashboard → Data Use Checkup** — ทบทวนข้อมูลที่ใช้ทุก 12 เดือน
- [ ] ยืนยัน data usage ตรงกับ use case ที่ระบุ
- [ ] ยืนยัน compliance กับ Platform Terms

### App Review Submission

- [ ] **App Dashboard → App Review → Permissions and Features**
- [ ] แต่ละ permission คลิก **"Request Advanced Access"**
  - วาง use case description จากเอกสารนี้ลงช่อง **"How will your app use this permission?"**
  - วาง Detailed Testing Instructions (ดู [FACEBOOK-APP-REVIEW.md](./FACEBOOK-APP-REVIEW.md))
  - อัปโหลด **screencast วิดีโอ** (MP4, ภายใต้ 100MB)
- [ ] กด **Submit for Review** ทีละ permission หรือรวมส่งครั้งเดียว

### Post-Submit

- [ ] เก็บ **Review Request ID** ทุก permission ไว้ติดตาม
- [ ] เช็คอีเมล (เจ้าของแอพ) ทุกวัน — Meta ส่งผลภายใน 3-7 วัน
- [ ] ถ้า **Rejected** → อ่านเหตุผลอย่างละเอียด → แก้ตามที่บอก → Resubmit
- [ ] ถ้า **Approved** → Switch App เป็น **Live Mode**

---

## Common Rejection Reasons

| Reason | วิธีแก้ |
|---|---|
| "Use case is too generic" | เพิ่ม **specific business scenario**: ใครใช้ ทำอะไร ทำไม + step-by-step flow |
| "Screencast doesn't show permission usage" | อัดใหม่ให้เห็น **API call ชัดเจน** — open DevTools Network tab แสดง request ไปที่ `graph.facebook.com/v25.0/...` |
| "Privacy policy missing data handling" | อัปเดต privacy policy ให้ระบุ: เก็บ PSID, เก็บนานแค่ไหน, ใช้ทำอะไร, customer sharing ไม่มี |
| "App not in Live Mode" | ไป **Settings → Basic → App Mode → Live** |
| "Data Deletion callback not responding" | ทดสอบ endpoint — Meta ส่ง POST + ต้องตอบ `{url, confirmation_code}` JSON |
| "Messaging not within 24-hour window" | ยืนยันว่า PSID test ใน screencast ทักมาภายใน 1 ชม. ก่อนอัด — ใช้ webhook log เป็นหลักฐาน |
| "Deprecated message tag used" | อย่าใช้ `ACCOUNT_UPDATE` / `CONFIRMED_EVENT_UPDATE` / `POST_PURCHASE_UPDATE` (deprecated 2026-04-27) |

---

## Screencast Recording Setup

### Tools
- **macOS**: QuickTime Player (Cmd+Shift+5) หรือ OBS Studio
- **Resolution**: 1280x720 minimum (1920x1080 ok)
- **Format**: MP4, H.264
- **Length**: 30-90 วินาทีต่อ permission
- **File size**: ภายใต้ 100MB

### Recording Tips
1. **เตรียม test data ก่อน** — login admin, set up customer with PSID who messaged the Page in the last hour, prepare test video file URL
2. **เปิด DevTools Network tab** ให้เห็น API calls ไปที่ `graph.facebook.com/v25.0`
3. **Narrate เป็นภาษาอังกฤษ** (หรือเพิ่ม subtitle)
4. **Mouse pointer visible**
5. **Compress video** ก่อน upload — ใช้ HandBrake หรือ `ffmpeg -crf 28 -preset slow`

---

## Privacy Policy Text (แนะนำเพิ่ม)

```markdown
### Facebook Platform Data

When you message our Facebook Page, we collect:
- Facebook user ID (PSID) — used to reply within the 24-hour response window
- Name and profile picture — displayed in our admin panel for staff reference
- Messages you send to our Page — stored to maintain conversation context

Data retention:
- PSID and messages are retained for the duration of the active conversation
  plus 90 days for audit (per Thai PDPA Section 26)
- You may request deletion at any time by emailing privacy@bestchoice.com

Data sharing:
- We do NOT share your Facebook data with third parties
- Data is accessed only by BESTCHOICE staff for customer service purposes
- Data is stored encrypted in our Thailand-based secure database

Your rights:
- Request access, correction, or deletion of your data
- Disconnect Facebook via Settings → Privacy → Apps and Websites → BESTCHOICE
```

---

## Data Deletion Callback

Endpoint implemented ที่ [facebook-webhook.controller.ts:283-331](../../apps/api/src/modules/chat-adapters/facebook-webhook.controller.ts#L283-L331)

### Production URL
```
POST https://api.bestchoicephone.app/api/webhooks/facebook/data-deletion
```

### Implementation status
- [x] Route: `POST /api/webhooks/facebook/data-deletion`
- [x] Signature verification ด้วย HMAC-SHA256 + `FB_APP_SECRET`
- [x] Timing-safe compare (ป้องกัน timing attack)
- [x] Return JSON `{url, confirmation_code}` ตาม spec
- [x] Status URL: `https://bestchoicephone.app/privacy?deletion={code}`
- [x] Logging ใน application logger

### Known gap (declare honestly with Meta if asked)

ปัจจุบันระบบยัง **ไม่ persist** Facebook PSID ลง Customer table — ระบบใช้ PSID แค่ใน-memory cache ระหว่าง conversation. เมื่อได้รับ deletion request:
- Endpoint ตอบ `{url, confirmation_code}` ตาม spec
- ไม่มี data จริงให้ลบ → compliant by design

หาก roadmap ต่อยอดให้ persist PSID ลง `Customer.facebookUserId` (อยู่ระหว่างวางแผน), ต้องเพิ่ม:
- [ ] Queue deletion job เมื่อ user_id มีใน Customer.facebookUserId
- [ ] Soft-delete Customer + remove PSID + log `DataAuditLog`
- [ ] Update status page แสดง actual deletion progress

### Deauthorize Callback
```
POST https://api.bestchoicephone.app/api/webhooks/facebook/deauthorize
```
ดู [facebook-webhook.controller.ts:336](../../apps/api/src/modules/chat-adapters/facebook-webhook.controller.ts#L336)

---

## Timeline (คาดการณ์)

| Phase | Duration | Action |
|---|---|---|
| **วันนี้** | — | service code update + เปลี่ยน permission request |
| **+24 ชม.** | 1 วัน | รอ App Dashboard แสดง "Activity detected" |
| **+1-3 วัน** | 1-3 วัน | กรอก use case + อัด screencast + submit |
| **+3-10 วัน** | 3-7 วัน | รอ Meta review |
| **Total** | **5-14 วัน** | จาก submit ถึง approved (ถ้าไม่ถูก reject) |

---

## References

- [FACEBOOK-APP-REVIEW.md](./FACEBOOK-APP-REVIEW.md) — Runbook ยิง API ให้ครบ permissions
- [Facebook App Review Overview](https://developers.facebook.com/docs/app-review)
- [Permissions Reference](https://developers.facebook.com/docs/permissions/reference)
- [Messaging Tags Deprecation Notice](https://developers.facebook.com/docs/messenger-platform/send-messages/message-tags) (2026-04-27)
- [24-Hour Standard Messaging Window](https://developers.facebook.com/docs/messenger-platform/policy/policy-overview#standard_messaging)
- [Data Deletion Callback](https://developers.facebook.com/docs/development/create-an-app/app-dashboard/data-deletion-callback)
