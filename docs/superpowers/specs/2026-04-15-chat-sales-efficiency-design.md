# Chat Sales Efficiency — Phase 1

> AI Suggest Mode + Product Context + Ads Attribution + Lead Priority

## Problem

พนักงานขายตอบแชทไม่มีประสิทธิภาพ ปิดการขายไม่ได้:
1. **ไม่รู้จะตอบยังไง** — ไม่มี sales skill, ไม่มี script ช่วย
2. **หาข้อมูลไม่ทัน** — ต้องเปิดหน้าอื่นหาราคา/สต็อก/โปรแล้วกลับมาตอบ ทำให้ช้า
3. **จัดลำดับไม่ได้** — แชทเยอะแต่ไม่รู้ว่าคนไหนพร้อมซื้อ ตอบแบบ FIFO ทำให้เสีย lead ดีๆ
4. **ไม่รู้ ROI โฆษณา** — ลง Facebook + TikTok แต่ไม่รู้ว่าโฆษณาไหน convert จริง, cost per unit sold เท่าไหร่

## Phasing

| Phase | Scope | Goal |
|-------|-------|------|
| **Phase 1 (spec นี้)** | AI Suggest Mode, Product Context, Ads Attribution, Lead Priority | พนักงานตอบเร็วขึ้น + ปิดการขายได้มากขึ้น + รู้ ROI |
| **Phase 2 (spec ถัดไป)** | AI Auto Mode, ระบบเรียนรู้, 24 ชม. auto-response | AI ตอบเองได้ + ต้องใช้คนน้อยลงเรื่อยๆ |

## Existing System (ไม่ต้องสร้างใหม่)

ระบบที่มีอยู่แล้วและจะ build on top of:

- **Unified Inbox** — 5 channels (LINE Finance/Shop, Facebook, TikTok, Web), real-time WebSocket, assignment, tags, notes
- **Canned Responses** — templates with variables, Ctrl+K shortcut, 5 categories
- **CRM Pipeline** — 6 stages (NEW_LEAD → WON/LOST), lead tracking
- **Ads Tracking Page** — framework built (campaigns, attributions, conversions) แต่ยังไม่มี real-time data
- **Chat-to-Contract** — prefill contract from chat context
- **AI Assistant Service** — `ai-assistant.service.ts` มีอยู่แล้ว (conversation summary, tone adjustment)
- **Handoff System** — AI → Staff handoff ทำงานอยู่แล้ว
- **Product/Pricing/Promotion** — ข้อมูลสินค้า ราคา โปรโมชัน เงื่อนไขผ่อนอยู่ใน DB ครบ

## Feature 1: AI Suggest Mode

### How It Works

เมื่อลูกค้าส่งข้อความ → AI วิเคราะห์บทสนทนา + ดึงข้อมูลสินค้าจาก DB → เสนอ 2-3 ข้อความให้พนักงานเลือก

```
ลูกค้า: "iPhone 16 เท่าไหร่ ผ่อนได้ไหม"
         ↓
AI วิเคราะห์: intent=ASK_PRICE, product=iPhone 16
         ↓
ดึงข้อมูล: Product(iPhone 16) + PricingTemplate + Promotion(active)
         ↓
แสดง 2-3 ข้อความให้เลือก:
  [1] "iPhone 16 128GB ราคา 29,900 บาท ผ่อนเริ่มต้น 2,xxx/เดือน 
       ตอนนี้มีโปรแถมเคส+ฟิล์มด้วยครับ สนใจดูเงื่อนไขไหมครับ?"
  [2] "iPhone 16 มี 128GB (29,900) กับ 256GB (34,900) ครับ 
       ผ่อนได้ทั้ง 2 รุ่น ดาวน์เริ่มต้น 30% สนใจรุ่นไหนครับ?"
  [3] [แก้ไขเอง...]
         ↓
พนักงานกด [1] → ส่งเลย (หรือแก้ไขก่อนส่ง)
```

### UI — Suggestion Panel

แสดงใน ChatPanel (ใต้ message input area ของ UnifiedInboxPage):

- **Suggestion cards** — 2-3 ข้อความ AI แนะนำ กด 1 click เพื่อใส่ใน input
- **Edit before send** — กดแล้วข้อความเข้า input box, พนักงานแก้ไขได้ก่อนส่ง
- **Dismiss** — ปิด suggestion ได้ถ้าไม่ต้องการ
- **Loading state** — แสดง skeleton ระหว่าง AI คิด (target < 3 วินาที)
- **Product info chip** — แสดงสินค้าที่ AI ตรวจจับได้ (กดดูรายละเอียดเพิ่ม)

### AI Context Window

ข้อมูลที่ส่งให้ AI ในแต่ละ request:

1. **บทสนทนาล่าสุด** — 20 ข้อความล่าสุดของ session
2. **ข้อมูลลูกค้า** — ชื่อ, ประวัติซื้อ, สัญญาที่มี, credit score (จาก Customer360)
3. **ข้อมูลสินค้า** — ราคา, สต็อก, สเปค ของสินค้าที่ถูกพูดถึง (product search by keyword)
4. **โปรโมชันที่ active** — ส่วนลด, ของแถม, เงื่อนไขพิเศษ
5. **เงื่อนไขผ่อน** — จาก PricingTemplate (ดาวน์, จำนวนงวด, ดอกเบี้ย)
6. **Canned responses** — templates ที่เกี่ยวข้องกับ intent

### AI Provider

ใช้ Claude API (Anthropic SDK) — มี `ai-assistant.service.ts` อยู่แล้วเป็น base

### Mode Toggle

- **ตำแหน่ง**: Settings → Chat AI หรือ per-channel setting
- **สิทธิ์**: OWNER เท่านั้นที่เปิด/ปิดได้
- **Granularity**: เปิด/ปิดต่อ channel (เช่น เปิด Facebook, ปิด LINE)
- **Default**: ปิด (opt-in)

## Feature 2: Product Context ในแชท

### Smart Product Detection

เมื่อ AI ตรวจจับว่าลูกค้าพูดถึงสินค้า → แสดง product card ใน Customer360 panel (right panel ที่มีอยู่แล้ว):

- **Product card**: รูป, ชื่อ, ราคา, สต็อก (มี/หมด), สี
- **Pricing info**: ดาวน์ขั้นต่ำ, ค่างวด/เดือน, จำนวนงวด
- **Active promotions**: แสดงโปรที่ใช้ได้กับสินค้านี้
- **Quick action**: ปุ่ม "สร้างสัญญา" → เปิด ContractCreate prefilled

### Implementation

เพิ่ม section ใน Customer360Panel ชื่อ "สินค้าที่กำลังคุย" — ใช้ product keyword matching จากบทสนทนา

## Feature 3: Ads Attribution จากแชท

### Flow

```
ลูกค้าเห็นโฆษณา Facebook/TikTok
  ↓
กดลิงก์ → เข้า LINE/Web chat (มี UTM params หรือ referrer)
  ↓
ระบบบันทึก attribution: { channel, campaign, adSet, ad, source }
  ↓
พนักงานปิดการขาย → สร้างสัญญา
  ↓
ระบบผูก: attribution → CRM lead → contract → revenue
  ↓
Ads Dashboard: แสดง ROI, cost per unit, conversion rate ต่อ campaign
```

### Attribution Sources

| Source | วิธี detect | ข้อมูลที่ได้ |
|--------|------------|-------------|
| **Facebook click-to-chat** | `ref` parameter ใน LINE deep link / Messenger referral | campaign_id, ad_id |
| **TikTok click-to-chat** | UTM params ใน landing page → transfer to chat session | utm_source, utm_campaign, utm_content |
| **Direct referrer** | HTTP referrer จาก web widget | referrer URL |
| **Manual tag** | พนักงาน tag ว่า lead มาจากไหน (fallback) | staff-selected source |

### Ads Dashboard Enhancement

เพิ่มข้อมูลใน AdsTrackingPage ที่มีอยู่:

- **Cost per unit sold** = total ad spend / units sold from that campaign
- **Conversion funnel**: Impressions → Clicks → Chats → Leads → Contracts → Revenue
- **Top campaigns** by ROI
- **Channel comparison**: Facebook vs TikTok performance

### ข้อจำกัด Phase 1

- ไม่ sync ค่า spend จาก ad platform (ต้อง manual input หรือ CSV import)
- Track ได้เฉพาะ lead ที่ click-to-chat (ไม่ track walk-in จากโฆษณา)

## Feature 4: Lead Priority / Smart Queue

### Scoring

AI วิเคราะห์บทสนทนาแล้ว score 0-100:

| Signal | Weight | ตัวอย่าง |
|--------|--------|---------|
| **ถามราคา/ผ่อน** | +30 | "ผ่อนเดือนละเท่าไหร่" |
| **ระบุรุ่นชัดเจน** | +20 | "iPhone 16 Pro Max 256GB" |
| **ถามสต็อก/สี** | +15 | "มีสีน้ำเงินไหม" |
| **มีประวัติซื้อ** | +15 | returning customer |
| **ถาม location/เวลา** | +10 | "สาขาลาดพร้าวเปิดกี่โมง" |
| **แค่ถามทั่วไป** | +5 | "มีมือถือรุ่นไหนบ้าง" |
| **ข้อความเดียวแล้วหาย** | -10 | ส่งมา 1 ข้อความ ไม่ตอบต่อ |

### Display

- **Badge** บน conversation list: HOT (80+), WARM (50-79), COLD (<50)
- **Sort option**: เรียงตาม priority score (default) หรือ เวลา
- **Filter**: กรอง HOT leads เท่านั้น

## Implementation Notes

### New Files

| File | Purpose |
|------|---------|
| `apps/api/src/modules/staff-chat/ai-suggest.service.ts` | AI suggestion engine — build context, call Claude API, return suggestions |
| `apps/api/src/modules/staff-chat/product-detect.service.ts` | Product keyword detection from chat messages |
| `apps/api/src/modules/staff-chat/lead-scoring.service.ts` | Lead priority scoring based on conversation analysis |
| `apps/api/src/modules/ads/attribution.service.ts` | Ads attribution tracking from chat referrer/UTM |
| `apps/web/src/pages/UnifiedInboxPage/components/AiSuggestPanel.tsx` | UI for AI suggestion cards |
| `apps/web/src/pages/UnifiedInboxPage/components/ProductContextCard.tsx` | Product info card in Customer360 |

### Files to Modify

| File | Change |
|------|--------|
| `apps/api/src/modules/staff-chat/staff-chat.controller.ts` | Add `/suggest` endpoint |
| `apps/api/src/modules/staff-chat/staff-chat.gateway.ts` | Emit suggestions via WebSocket after new message |
| `apps/web/src/pages/UnifiedInboxPage/components/ChatPanel.tsx` | Add AiSuggestPanel below message input |
| `apps/web/src/pages/UnifiedInboxPage/components/Customer360Panel.tsx` | Add ProductContextCard section |
| `apps/web/src/pages/UnifiedInboxPage/components/ConversationList.tsx` | Add lead score badges + sort by priority |
| `apps/web/src/pages/AdsTrackingPage.tsx` | Add cost per unit, conversion funnel |
| `apps/api/src/modules/chat-engine/services/session-manager.service.ts` | Store attribution data on session create |
| `apps/api/src/modules/chat-adapters/*` | Extract referrer/UTM from incoming messages |

### Existing Code to Reuse

- `ai-assistant.service.ts` — extend with suggest prompt
- `chat-to-contract.service.ts` — product detection logic
- `chat-commerce.service.ts` — product lookup
- `ConversationTagService` — extend for lead score tags
- `AdsTrackingPage.tsx` — existing dashboard framework
- Ads backend (`/ads/campaigns`, attributions, conversions)

### Database Changes

```prisma
// เพิ่มใน ChatSession
model ChatSession {
  // ... existing fields
  leadScore       Int?            // 0-100 priority score
  leadTemperature String?         // HOT, WARM, COLD
  attributionId   String?         // link to AdsAttribution
  attribution     AdsAttribution? @relation(fields: [attributionId], references: [id])
}

// เพิ่มใน AdsAttribution (มีอยู่แล้ว — เพิ่ม fields)
model AdsAttribution {
  // ... existing fields
  chatSessionId   String?         // link back to chat session
  chatSession     ChatSession?
  utmSource       String?
  utmMedium       String?
  utmCampaign     String?
  utmContent      String?
  referrerUrl     String?
}
```

### Settings

```prisma
// เพิ่มใน CompanySettings หรือ ChatSettings
aiSuggestMode    Boolean @default(false)  // global toggle
aiSuggestChannels String[] @default([])   // channels ที่เปิด suggest
```

## Phase 2 Preview (ไม่อยู่ใน scope spec นี้)

เพื่อให้ Phase 1 ออกแบบรองรับ Phase 2:

- **AI Auto Mode**: เพิ่ม `aiAutoMode` setting + confidence threshold — ถ้า AI มั่นใจ > threshold → ส่งเอง, ถ้าไม่ → ส่งต่อพนักงาน
- **ระบบเรียนรู้**: เมื่อพนักงานแก้ไขข้อความ AI → บันทึกเป็น training pair (AI draft → human edit) → fine-tune prompt → AI ตอบดีขึ้น → ต้องใช้คนน้อยลง
- **24 ชม. auto-response**: combine Auto Mode + AfterHoursService ที่มีอยู่
