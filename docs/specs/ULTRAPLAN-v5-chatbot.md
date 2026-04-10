# Ultraplan v5 — Chatbot Finance Hardening & Improvement

**วันที่:** 2026-04-10
**สถานะ:** Draft
**Module:** `apps/api/src/modules/chatbot-finance/` (15 services, 2,600+ lines)

---

## Context

Module "น้องเบส" (Finance Bot) เป็น AI chatbot บน LINE OA สำหรับเก็บเงินค่างวดและบริการลูกค้า สร้างระหว่าง ultraplan v3-v4 ครบ Phase A-E แต่:

- **ไม่มี test เลย** (0 spec files) — project มี 577 API tests ใน modules อื่น
- มี **bugs ด้าน security** (webhook signature ใช้ `JSON.stringify`, ไม่มี idempotency, ไม่ validate input length)
- **ไม่มี Sentry** บน critical paths (AI failure, LINE API error, vision error)
- **AI metadata** (toolsUsed, costUsd) ไม่ถูก save ลง DB
- **ไม่มี learning loop** — bot ไม่เรียนรู้จาก feedback หรือ handoff
- มี **improvement proposal** (`docs/sops/chatbot-improvement-proposal.md`) รอ board approve

---

## Phase 1 — P0: Security & Correctness Fixes (~3 วัน)

### 1.1 Webhook Signature: ใช้ Raw Body แทน JSON.stringify (S)
**Bug**: `guards/line-finance-webhook.guard.ts:47` ใช้ `JSON.stringify(request.body)` คำนวณ HMAC — อาจไม่ตรงกับ raw bytes ที่ LINE ส่งมา
- เพิ่ม rawBody middleware scope เฉพาะ webhook routes
- เปลี่ยน guard ให้ใช้ `request.rawBody`
- แก้ `line-oa/line-webhook.guard.ts` ด้วย

### 1.2 Webhook Idempotency: Dedup ด้วย webhookEventId (S)
**Bug**: `chatbot-finance.controller.ts:37` ไม่ check `webhookEventId` / `isRedelivery` — LINE retry = bot ตอบซ้ำ
- เพิ่ม in-memory Set + TTL (5 นาที) สำหรับ dedup

### 1.3 Input Length Validation ก่อนส่ง Claude (S)
**Bug**: `chatbot-finance.service.ts:194` ส่ง user text ไม่มี limit — เสี่ยง token bomb
- Truncate ที่ 2,000 ตัวอักษร ก่อนส่ง AI, เก็บ full text ใน DB

### 1.4 Save Missing AI Metadata: toolsUsed + costUsd (S)
**Bug**: `chat-session.service.ts` saveMessage ไม่มี `toolsUsed`, `costUsd`, `visionExtracted`
- Extend `saveMessage()` params
- คำนวณ costUsd จาก token counts

### 1.5 Fix Fire-and-Forget Staff Notifications (S)
**Bug**: `slip-processing.service.ts:103,163,180` ใช้ `void` ไม่มี `.catch()` — unhandled promise rejection
- เพิ่ม `.catch()` + Sentry ทุกจุด

**ไฟล์:**
- `apps/api/src/main.ts`
- `guards/line-finance-webhook.guard.ts`
- `line-oa/line-webhook.guard.ts`
- `chatbot-finance.controller.ts`
- `services/chatbot-finance.service.ts`
- `services/chat-session.service.ts`
- `services/slip-processing.service.ts`

---

## Phase 2 — P0: Test Foundation (~5 วัน)

7 spec files / ~55 test cases:

| File | Tests | เรื่อง |
|------|-------|--------|
| `tool-executor.spec.ts` | ~8 | tool shape, unknown tool, scoping |
| `verification.service.spec.ts` | ~10 | OTP flow, cooldown, attempts |
| `chatbot-finance.service.spec.ts` | ~8 | orchestration: verify/text/image/handoff/follow |
| `auto-trigger.service.spec.ts` | ~8 | offset selection, idempotency, failure |
| `slip-processing.service.spec.ts` | ~8 | vision/account/amount matching |
| `finance-ai.service.spec.ts` | ~6 | enabled check, message building, history limit |
| `knowledge.service.spec.ts` | ~7 | search scoring, CRUD, soft-delete |

---

## Phase 3 — P1: Observability & Sentry (~2 วัน)

### 3.1 Sentry บน AI Failures (S)
- `finance-ai.service.ts` catch block + max iterations → Sentry

### 3.2 Sentry บน Vision/Slip Errors (S)
- `vision.service.ts` API error + `slip-processing.service.ts` upload failure → Sentry

### 3.3 Sentry บน LINE API Failures (S)
- `line-finance-client.service.ts` + `line-staff-client.service.ts` → Sentry

### 3.4 Standardize Intent Constants (S)
- สร้าง `constants/intents.ts` typed const
- เพิ่ม intents ที่ขาด: `follow_greeting`, `unsupported_type`, `ai_max_iterations`

### 3.5 Enhanced Analytics: Date Range + Cost (M)
- Date range filter, cost breakdown, handoff resolution time
- Frontend date picker + chart

---

## Phase 4 — P1: Code Quality & DRY (~1 วัน)

### 4.1 Extract `formatThaiDate` Utility (S)
- Duplicated ใน `finance-tools.service.ts` + `auto-trigger.service.ts` → `utils/thai-date.ts`

### 4.2 Extract `maskPhone` Utility (S)
- Duplicated ใน `verification.service.ts` + `staff-notification.service.ts` → `utils/mask-phone.ts`

### 4.3 Reminder Templates ใช้ Config แทน Hardcode (S)
- `reminder-templates.ts` hardcode bank block → inject จาก `FinanceConfigService`

---

## Phase 5 — P1: System Prompt + KB Improvement (~3 วัน)

> ต้อง board approve ก่อน (ตาม improvement proposal)

### 5.1 System Prompt Enhancement (M)
- เพิ่ม Product Knowledge section: iPhone/iPad only, Android redirect, จุดขาย
- **ไม่ replace** prompt เดิม — augment เท่านั้น

### 5.2 Seed KB กับ Scenario Templates (S)
- สร้าง KB entries จาก 9 scenarios ใน proposal

### 5.3 Metrics สำหรับ Proposal KPIs (M)
- Intent categories: `android_redirect`, `product_inquiry`, `onboarding`
- แสดงใน analytics page

---

## Phase 6 — P1: Continuous Learning System (~5 วัน)

ระบบที่ทำให้ bot **เรียนรู้และพัฒนาการตอบกลับตลอดเวลา**

### 6.1 Customer Feedback Collection (M)

**DB:**
```prisma
model ChatFeedback {
  id           String   @id @default(uuid())
  sessionId    String
  messageId    String?
  rating       Int            // 0=👎, 1=👍
  feedbackText String?
  createdAt    DateTime @default(now())
  session      ChatSession @relation(fields: [sessionId], references: [id])
}
```

**Flow:** หลัง bot ตอบจาก tool → ส่ง Quick Reply "ข้อมูลถูกต้องไหมคะ? 👍/👎" → save rating
- ถามเฉพาะหลัง tool-use reply, ไม่เกิน 1 ครั้ง/conversation

### 6.2 Handoff Learning: เรียนรู้จาก Staff (M)

**DB:**
```prisma
model ChatKbSuggestion {
  id                String   @id @default(uuid())
  sessionId         String
  customerQuestion  String
  staffAnswer       String
  suggestedIntent   String
  suggestedKeywords String[]
  suggestedTemplate String
  source            String   // 'handoff' | 'low_rating' | 'auto_analysis'
  status            String   @default("PENDING") // PENDING | APPROVED | REJECTED
  reviewedById      String?
  reviewedAt        DateTime?
  kbEntryId         String?
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
}
```

**Flow:** Handoff จบ → extract customer Q + staff A → สร้าง KB Suggestion → admin approve → KB โต

### 6.3 Auto-Analysis: Weekly Batch (M)

**Cron:** ทุกวันจันทร์ 06:00
1. รวบรวม conversations 7 วันล่าสุด
2. จัดกลุ่ม: สำเร็จ (ไม่ handoff + 👍) vs ล้มเหลว (handoff / 👎)
3. Claude วิเคราะห์ failed conversations → สร้าง KB Suggestions
4. Notify admin

### 6.4 Admin Dashboard: Learning Hub (M)

หน้าใหม่ `/chatbot-finance/learning`:
- **KB Suggestions Queue** — approve/reject/edit suggestions
- **Feedback Overview** — % positive, trend chart
- **Learning Metrics** — handoff rate over time, auto-resolve rate, top unresolved intents

### 6.5 Auto-Adjust KB Priority (S)

- Feedback 👍 → KB entry priority +1
- Feedback 👎 → KB entry priority -2
- KB self-organize — คำตอบดีขึ้นมาก่อน

### Learning Loop สรุป

```
ลูกค้า feedback 👍 → KB priority ↑ (auto)
ลูกค้า feedback 👎 → flag → admin review → ปรับ KB
Staff handoff → extract Q&A → KB Suggestion → admin approve → KB โต
Weekly analysis → Claude วิเคราะห์ fails → KB Suggestion → admin approve → KB โต

ผล: bot ฉลาดขึ้นเรื่อยๆ → handoff rate ลด → ลูกค้าพอใจมากขึ้น
```

---

## Phase 7 — P2: Performance & Cost Optimization (~4 วัน)

### 7.1 Anthropic Prompt Caching (M)
- `cache_control: { type: "ephemeral" }` บน system prompt → ลด cost ~90%

### 7.2 Model Routing: Haiku สำหรับ Simple Queries (M)
- Simple queries → Haiku, Tool use → Sonnet

### 7.3 Multi-Contract Support (M)
- `finance-tools.service.ts:194` ใช้ `findFirst()` → detect multiple contracts → disambiguation

### 7.4 Vision ใช้ Haiku แทน Sonnet (S)
- `vision.service.ts:46` Sonnet → Haiku สำหรับ slip extraction → ลด cost ~80%

### 7.5 KB Search: ปรับ Scoring (S)
- Thai word tokenization, weighted keywords, fuzzy matching

---

## Summary

| Phase | เรื่อง | Items | ระยะเวลา | Priority |
|-------|--------|-------|----------|----------|
| 1 | Security & Correctness | 5 | ~3 วัน | P0 |
| 2 | Test Foundation | 7 (55 tests) | ~5 วัน | P0 |
| 3 | Observability & Sentry | 5 | ~2 วัน | P1 |
| 4 | Code Quality & DRY | 3 | ~1 วัน | P1 |
| 5 | System Prompt + KB | 3 | ~3 วัน | P1 |
| **6** | **Continuous Learning** | **5** | **~5 วัน** | **P1** |
| 7 | Performance & Cost | 5 | ~4 วัน | P2 |
| **รวม** | | **33 items** | **~23 วัน** | |

## Dependencies

```
Phase 1 + 2 (parallel) → Phase 3 → Phase 4
                           ↓
                      Phase 5 (+ board approval)
                           ↓
                      Phase 6 (Learning)
                           ↓
                      Phase 7 (Performance)
```

## Verification

1. **Phase 1-2**: `npx jest --testPathPattern chatbot-finance` → ทุก test ผ่าน
2. **Phase 3**: Sentry dashboard → events ขึ้น
3. **Phase 5**: ทดสอบ 20 scenarios ตาม improvement proposal
4. **Phase 6**: feedback → suggestion สร้าง → approve → KB entry → bot ใช้ตอบได้
5. **Phase 7**: costUsd ก่อน/หลัง ใน analytics
6. **ทุก Phase**: `./tools/check-types.sh all` → 0 errors
