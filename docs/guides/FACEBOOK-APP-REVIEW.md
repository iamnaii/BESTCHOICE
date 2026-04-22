# Facebook App Review — Permission Testing Runbook

คู่มือยิง API ทุก endpoint เพื่อให้ Facebook App Dashboard บันทึกว่าแต่ละ permission
"มีการเรียกใช้ API อย่างน้อย 1 ครั้ง" ก่อนส่ง App Review

## ข้อควรรู้ก่อนเริ่ม

1. ผลการทดสอบแต่ละครั้ง**มีอายุ 30 วัน** — ยิงแล้วต้องส่ง review ภายใน 30 วัน ไม่งั้นต้องยิงใหม่
2. ผลจะปรากฏใน dashboard **ภายใน 24 ชั่วโมง** หลังยิงสำเร็จ
3. ต้องยิงจาก **Live Mode** เท่านั้น — Dev Mode ไม่นับ
4. ทุก endpoint เป็น `OWNER`-only และอยู่ใต้ `/api/facebook/app-review/*`

## Environment variables ที่ต้องตั้ง

| ENV | ใช้ทำอะไร |
|---|---|
| `FB_PAGE_ACCESS_TOKEN` | Page token (messaging + page management) |
| `FB_PAGE_ID` | Facebook Page ID |
| `FB_USER_ACCESS_TOKEN` | User token (จำเป็นสำหรับ `GET /me/accounts`) |
| `FB_AD_ACCOUNT_ID` | รูปแบบ `act_123456789` |
| `FB_SYSTEM_USER_TOKEN` | (optional) fallback สำหรับ Marketing API |

## Permission → Endpoint mapping

| Permission | Endpoint | Method | Graph API ที่เรียก |
|---|---|---|---|
| `pages_show_list` | `/facebook/app-review/pages` | GET | `GET /me/accounts` |
| `pages_manage_ads` | `/facebook/app-review/promotable-posts` | GET | `GET /{PAGE_ID}/promotable_posts` |
| `pages_utility_messaging` | `/facebook/app-review/utility-message` | POST | `POST /{PAGE_ID}/messages` (tag=ACCOUNT_UPDATE) |
| `ads_management` + `Ads Management Standard Access` | `/facebook/app-review/campaigns` | POST | `POST /act_{AD_ACCOUNT}/campaigns` |
| `ads_management` (update) | `/facebook/app-review/campaigns/:id/status` | PATCH | `POST /{CAMPAIGN_ID}` |
| `leads_retrieval` | `/facebook/app-review/lead-forms` + `/lead-forms/:id/leads` | GET | `GET /{PAGE_ID}/leadgen_forms`, `GET /{FORM_ID}/leads` |
| `Live Video API` | `/facebook/app-review/live-videos` | POST | `POST /{PAGE_ID}/live_videos` |
| `publish_video` | `/facebook/app-review/videos` | POST | `POST /{PAGE_ID}/videos` |

Permissions ที่มีโค้ดเรียกอยู่แล้วจาก feature อื่น:

| Permission | เรียกจาก |
|---|---|
| `public_profile` | `integrations.service.ts` (test connection), `facebook.adapter.ts` (getUserProfile) |
| `pages_messaging` | `facebook.adapter.ts` (sendMessage) |
| `pages_read_engagement` | `facebook-extractor.source.ts`, `live-videos`, `promotable-posts` ด้านบน |
| `pages_manage_metadata` | `facebook-persistent-menu.service.ts` |
| `ads_read` + `business_management` | `facebook-ads-sync.service.ts` (cron sync campaigns) |

## ขั้นตอนทดสอบ (ยิงตามลำดับ)

ยิงจากเครื่องที่ล็อกอินเป็น OWNER แล้ว (ใช้ JWT จาก `/auth/login`). เปลี่ยน `$TOKEN` เป็น JWT ของคุณ

```bash
export API=https://api.bestchoice.example.com
export TOKEN=<jwt-access-token>
```

### 1. `pages_show_list`
```bash
curl -X GET "$API/api/facebook/app-review/pages" \
  -H "Authorization: Bearer $TOKEN"
```

### 2. `pages_manage_ads` + `pages_read_engagement`
```bash
curl -X GET "$API/api/facebook/app-review/promotable-posts" \
  -H "Authorization: Bearer $TOKEN"
```

### 3. `pages_utility_messaging`
แทนที่ `PSID` ด้วย PSID ของลูกค้าที่เคยคุยกับเพจ (ภายใน 24 ชม. หรือ subscribed แล้ว)
```bash
curl -X POST "$API/api/facebook/app-review/utility-message" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "recipientPsid": "<PSID>",
    "text": "แจ้งเตือน: ค่างวดครบกำหนดชำระวันที่ 1 พ.ค. 2569",
    "tag": "ACCOUNT_UPDATE"
  }'
```

### 4. `ads_management` + `Ads Management Standard Access` (create)
สร้าง campaign แบบ PAUSED — ไม่ยิง ads จริง ไม่เสียเงิน
```bash
curl -X POST "$API/api/facebook/app-review/campaigns" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "App Review Test Campaign",
    "objective": "OUTCOME_TRAFFIC",
    "dailyBudget": 20
  }'
```
เก็บ `id` จาก response ไว้ใช้ขั้นตอนต่อไป

### 5. `ads_management` (update — ใช้ id จากขั้นตอน 4)
```bash
curl -X PATCH "$API/api/facebook/app-review/campaigns/<CAMPAIGN_ID>/status" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "status": "PAUSED" }'
```

### 6. `leads_retrieval` (list forms)
```bash
curl -X GET "$API/api/facebook/app-review/lead-forms" \
  -H "Authorization: Bearer $TOKEN"
```

### 7. `leads_retrieval` (fetch leads — ใช้ form_id จากขั้นตอน 6)
```bash
curl -X GET "$API/api/facebook/app-review/lead-forms/<FORM_ID>/leads" \
  -H "Authorization: Bearer $TOKEN"
```

### 8. `Live Video API`
สร้าง live video แบบ SCHEDULED_UNPUBLISHED — ไม่ออกอากาศ
```bash
curl -X POST "$API/api/facebook/app-review/live-videos" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "BESTCHOICE Live Test",
    "description": "Product showcase",
    "status": "SCHEDULED_UNPUBLISHED",
    "plannedStartTime": 1735689600
  }'
```

### 9. `publish_video`
ต้องมี URL public ที่เข้าถึงวิดีโอ `.mp4` ได้
```bash
curl -X POST "$API/api/facebook/app-review/videos" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "fileUrl": "https://example.com/bestchoice-sample.mp4",
    "title": "BESTCHOICE sample",
    "description": "App Review test upload"
  }'
```

## ตรวจสอบผล

1. เปิด Facebook App Dashboard → App Review → API Calls
2. รอ 5-24 ชม. สถานะจะเปลี่ยนจาก "การทดสอบเรียกใช้ API 0 ครั้ง" → "ทดสอบแล้ว"
3. ถ้า permission ไหนยังไม่ขึ้น → เช็ค log ฝั่ง API (`[FB App Review]`) ว่ายิงสำเร็จจริงไหม

## ปัญหาที่พบบ่อย

| อาการ | สาเหตุ | วิธีแก้ |
|---|---|---|
| `(#200) Requires pages_messaging_subscriptions` | ส่ง utility message ไปยัง PSID ที่ไม่ได้ opt-in | ใช้ PSID ที่เคยทักเพจภายใน 24 ชม. |
| `(#100) No permission to access ad account` | Token ไม่มี scope หรือ ad account ไม่ได้ผูกกับ Business | เพิ่ม System User + assign ad account |
| `Live Video API not available` | App ยังไม่ได้ enable Live Video API product | ใน dashboard → Products → Add Live Video API |
| `publish_video` error 400 `file_url is not reachable` | URL ไม่ public หรือ MIME ไม่ใช่ video | ใช้ direct `.mp4` URL ที่เข้าถึงได้จาก FB CDN |

## ไฟล์ที่เกี่ยวข้อง

- Service: `apps/api/src/modules/facebook-app-review/facebook-app-review.service.ts`
- Controller: `apps/api/src/modules/facebook-app-review/facebook-app-review.controller.ts`
- DTOs: `apps/api/src/modules/facebook-app-review/dto/facebook-app-review.dto.ts`
