# Chat Sales Efficiency — Phase 2

> AI Auto Mode + Feedback Loop + Training Data Import + Performance Dashboard

## Problem

Phase 1 ให้ AI แนะนำข้อความให้พนักงานเลือก — แต่ยังต้องมีพนักงานนั่งตอบตลอด ไม่สามารถตอบ 24 ชม. ได้ และ AI ยังไม่เรียนรู้จากวิธีตอบของพนักงาน

## Phase 1 ที่มีอยู่แล้ว (build on top of)

- `AiSuggestService` — builds context + calls Claude → return 2-3 suggestions
- `ProductDetectService` — detect products from messages
- `LeadScoringService` — score 0-100 + HOT/WARM/COLD
- `AiSuggestPanel` — frontend suggestion cards
- `AfterHoursService` — auto-reply นอกเวลา
- Handoff system — AI ↔ Staff transition (`HandoffManagerService`)
- `MessageRouterService` — central message pipeline (inbound → handoff check → handler → adapter send)

## Feature 1: AI Auto Mode

### How It Works

```
ลูกค้าส่งข้อความ
  ↓
MessageRouter.routeInbound()
  ↓
Check: AI Auto Mode เปิดสำหรับ channel นี้?
  ├─ NO → ปกติ (suggest mode / handoff to staff)
  └─ YES ↓
       AiSuggestService.suggest(sessionId)
         ↓
       confidence >= threshold?
         ├─ YES → ส่งข้อความ #1 (highest confidence) ให้ลูกค้าทันที
         │         บันทึก: { autoReplied: true, confidence }
         └─ NO  → HandoffManager.initiateHandoff()
                   ส่งต่อพนักงาน + แจ้ง notification
```

### Settings (OWNER only)

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `aiAutoEnabled` | boolean | false | เปิด/ปิด auto mode (global) |
| `aiAutoChannels` | string[] | [] | channel ที่เปิด auto mode |
| `aiAutoConfidenceThreshold` | number | 80 | 0-100 slider — AI ต้องมั่นใจ >= ค่านี้ถึงตอบเอง |
| `aiAutoMaxRepliesPerSession` | number | 5 | จำกัดจำนวนครั้งที่ AI ตอบเองต่อ session ก่อน handoff |

### UI — Settings Page

เพิ่ม section ใน Settings: "AI Chat Assistant"
- Toggle เปิด/ปิด Auto Mode
- Channel checkboxes (LINE Finance, LINE Shop, Facebook, TikTok, Web)
- Confidence threshold slider (0-100%) พร้อมคำอธิบาย: "ยิ่งสูง AI ยิ่งตอบน้อย แต่แม่นกว่า"
- Max replies per session input

### Integration with AfterHoursService

เมื่อ AI Auto Mode เปิด → AfterHoursService ไม่ต้องส่ง "ขณะนี้อยู่นอกเวลาทำการ" อีก เพราะ AI ตอบแทนได้เลย ส่งเฉพาะเมื่อ AI Auto Mode ปิดเท่านั้น

### ลูกค้าไม่รู้ว่าคุยกับ AI

ข้อความที่ AI ส่งจะเหมือนพนักงานตอบปกติ ไม่มี prefix หรือ disclaimer ใดๆ

## Feature 2: Feedback Loop (ระบบเรียนรู้)

### Training Pair Collection

เมื่อพนักงานใช้ AI suggest:

**Case A: พนักงานเลือกข้อความ AI แล้วแก้ไขก่อนส่ง**
```
บันทึก: {
  type: 'EDIT',
  sessionId,
  aiDraft: "ข้อความที่ AI แนะนำ",
  humanEdit: "ข้อความที่พนักงานแก้แล้วส่ง",
  intent: "answer_price",
  customerMessage: "ข้อความลูกค้าก่อนหน้า",
  quality: null  // ยังไม่ rate
}
```

**Case B: พนักงานเลือกข้อความ AI แล้วส่งตรงไม่แก้**
```
บันทึก: {
  type: 'ACCEPT',
  sessionId,
  aiDraft: "ข้อความที่ AI แนะนำ",
  humanEdit: null,
  intent: "answer_price",
  customerMessage: "ข้อความลูกค้าก่อนหน้า",
  quality: null
}
```

**Case C: พนักงาน dismiss AI suggestion แล้วพิมพ์เอง**
```
บันทึก: {
  type: 'REJECT',
  sessionId,
  aiDraft: "ข้อความที่ AI แนะนำ",
  humanEdit: "ข้อความที่พนักงานพิมพ์เอง",
  intent: null,
  customerMessage: "ข้อความลูกค้าก่อนหน้า",
  quality: null
}
```

### Few-Shot Learning

เมื่อ AI suggest ถูกเรียก → ดึง top 5-10 training pairs ที่เกี่ยวข้อง (match by intent/keywords) → ใส่เป็น few-shot examples ใน prompt:

```
## ตัวอย่างข้อความที่ดีจากพนักงาน

ลูกค้า: "iPhone 16 Pro ราคาเท่าไหร่"
พนักงาน: "iPhone 16 Pro 128GB ราคา 39,900 บาทครับ ผ่อนเริ่มต้น 3,xxx/เดือน ตอนนี้แถมเคสกันกระแทกด้วยครับ สนใจจะจองไว้ไหมครับ?"

ลูกค้า: "ผ่อนกี่เดือนได้บ้าง"
พนักงาน: "ผ่อนได้ 6, 10, 12 เดือนครับ ดาวน์ขั้นต่ำ 30% ดอกเบี้ย 0% สำหรับ 6 เดือนครับ อยากให้คำนวณค่างวดให้ดูไหมครับ?"
```

### Quality Scoring

Training pairs มี quality score:
- `ACCEPT` (ส่งตรง) = quality 1.0 (AI ตอบดีมาก)
- `EDIT` (แก้เล็กน้อย, edit distance < 30%) = quality 0.7
- `EDIT` (แก้มาก, edit distance >= 30%) = quality 0.3
- `REJECT` (dismiss) = quality 0.0 (AI ตอบไม่ตรง)

ใช้ human-edited version เป็น "correct answer" สำหรับ few-shot

## Feature 3: Training Data Import

### Import Page (OWNER only)

หน้า Settings → "AI Training Data" สำหรับ import ประวัติแชทเก่า:

**Sources:**
1. **Chatcone import** — upload CSV/JSON file
2. **ระบบ (Unified Inbox)** — ดึงจาก ChatMessage table อัตโนมัติ

### Chatcone Import Flow

```
OWNER upload ไฟล์ CSV/JSON
  ↓
ระบบ parse → แยกเป็นคู่สนทนา (ลูกค้าถาม → พนักงานตอบ)
  ↓
สร้าง training pairs: { customerMessage, staffResponse, source: 'CHATCONE_IMPORT' }
  ↓
แสดง preview จำนวน pairs ที่จะ import
  ↓
OWNER กด confirm → import เข้า DB
```

**Supported formats:**
- CSV: columns `timestamp, sender_type (customer/staff), message`
- JSON: array of `{ timestamp, senderType, message }`

### Auto-extract from Unified Inbox

Cron job (daily) ดึงบทสนทนาจาก ChatMessage:
- หาคู่ CUSTOMER message → STAFF reply (ข้อความที่ตอบภายใน 5 นาที)
- สร้าง training pairs อัตโนมัติ: `{ customerMessage, staffResponse, source: 'SYSTEM_EXTRACT' }`
- Skip คู่ที่มีอยู่แล้ว (deduplicate)

### Dashboard

แสดงใน Training Data page:
- จำนวน training pairs ทั้งหมด (แยกตาม source)
- จำนวน pairs ที่ quality >= 0.7 (usable for few-shot)
- ปุ่ม "Re-extract" สำหรับ manual trigger

## Feature 4: AI Performance Dashboard

### Metrics

| Metric | คำนวณ | แสดงเป็น |
|--------|-------|---------|
| **Auto-reply rate** | AI ตอบเอง / ข้อความลูกค้าทั้งหมด | % + trend |
| **Handoff rate** | ส่งต่อพนักงาน / ข้อความลูกค้าทั้งหมด | % + trend |
| **Accept rate** | พนักงานส่งตรง / suggestions ทั้งหมด | % + trend |
| **Edit rate** | พนักงานแก้แล้วส่ง / suggestions ทั้งหมด | % |
| **Reject rate** | พนักงาน dismiss / suggestions ทั้งหมด | % |
| **Avg confidence** | เฉลี่ย confidence ของ AI suggestions | % |
| **Training pairs** | จำนวน pairs ทั้งหมด | count |

### UI

เพิ่ม tab "AI Performance" ใน chatbot-finance page หรือสร้างหน้าใหม่ `/settings/ai-chat`:
- Summary cards (auto-reply rate, accept rate, training pairs)
- Line chart: accept rate over time (วัดว่า AI ดีขึ้นไหม)
- Line chart: handoff rate over time (ลดลง = AI ดีขึ้น)
- Filter by channel, date range

## Implementation Notes

### New Database Models

```prisma
model AiTrainingPair {
  id              String    @id @default(uuid())
  type            String    // ACCEPT, EDIT, REJECT
  source          String    // SUGGEST_FEEDBACK, CHATCONE_IMPORT, SYSTEM_EXTRACT
  sessionId       String?   @map("session_id")
  session         ChatSession? @relation(fields: [sessionId], references: [id])
  customerMessage String    @map("customer_message") @db.Text
  aiDraft         String?   @map("ai_draft") @db.Text
  humanEdit       String?   @map("human_edit") @db.Text
  intent          String?
  quality         Float?    // 0.0 - 1.0
  usedInPrompt    Boolean   @default(false) @map("used_in_prompt")
  createdAt       DateTime  @default(now()) @map("created_at")

  @@index([intent, quality])
  @@index([source])
  @@map("ai_training_pairs")
}

model AiAutoReplyLog {
  id              String    @id @default(uuid())
  sessionId       String    @map("session_id")
  session         ChatSession @relation(fields: [sessionId], references: [id])
  customerMessage String    @map("customer_message") @db.Text
  aiReply         String    @map("ai_reply") @db.Text
  confidence      Float
  autoSent        Boolean   @map("auto_sent") // true = AI sent, false = handoff
  handoffReason   String?   @map("handoff_reason")
  createdAt       DateTime  @default(now()) @map("created_at")

  @@index([sessionId])
  @@index([autoSent, createdAt])
  @@map("ai_auto_reply_logs")
}
```

### New Files

| File | Purpose |
|------|---------|
| `apps/api/src/modules/staff-chat/services/ai-auto-reply.service.ts` | Auto mode logic: check settings → suggest → send if confident → handoff if not |
| `apps/api/src/modules/staff-chat/services/ai-training.service.ts` | Manage training pairs: save feedback, extract from chat, select few-shot examples |
| `apps/api/src/modules/staff-chat/services/ai-import.service.ts` | Parse & import Chatcone CSV/JSON |
| `apps/api/src/modules/staff-chat/services/ai-metrics.service.ts` | Calculate performance metrics |
| `apps/api/src/modules/staff-chat/cron/training-extract.cron.ts` | Daily cron: auto-extract training pairs from ChatMessage |
| `apps/web/src/pages/AiSettingsPage.tsx` | OWNER settings: auto mode toggle, threshold slider, channel selection |
| `apps/web/src/pages/AiTrainingPage.tsx` | Training data dashboard + Chatcone import upload |
| `apps/web/src/pages/AiPerformancePage.tsx` | Performance metrics + charts |

### Files to Modify

| File | Change |
|------|--------|
| `apps/api/prisma/schema.prisma` | Add AiTrainingPair, AiAutoReplyLog models + relation to ChatSession |
| `apps/api/src/modules/chat-engine/services/message-router.service.ts` | Add auto-reply check before handoff/domain handler |
| `apps/api/src/modules/staff-chat/services/ai-suggest.service.ts` | Add few-shot examples from training pairs into prompt |
| `apps/api/src/modules/staff-chat/staff-chat.controller.ts` | Add endpoints: training feedback, import, metrics, settings |
| `apps/api/src/modules/staff-chat/staff-chat.gateway.ts` | Emit feedback event when staff edits/accepts/rejects suggestion |
| `apps/web/src/pages/UnifiedInboxPage/components/AiSuggestPanel.tsx` | Track accept/edit/reject actions |
| `apps/web/src/pages/UnifiedInboxPage/components/ChatPanel.tsx` | Send feedback data when sending message |
| `apps/web/src/App.tsx` | Add routes for new pages |
| `apps/web/src/config/menu.ts` | Add AI settings/training/performance to OWNER menu |

### Existing Code to Reuse

- `AiSuggestService.suggest()` — reuse for auto-reply (pick highest confidence suggestion)
- `HandoffManagerService.initiateHandoff()` — handoff when confidence low
- `AfterHoursService` — skip auto-reply message when auto mode active
- `MessageRouterService.routeInbound()` — insertion point for auto-reply check
- `BullMQ` cron pattern — existing cron jobs as reference for training extract
