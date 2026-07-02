# AI Reply Consolidation — LINE Shop wiring, cost hygiene, runtime embeddings

- **Date:** 2026-07-02
- **Status:** Approved (brainstorm + scrutiny complete)
- **Owner decisions:** staged rollout แบบ Facebook / เก็บ keyword commands ถอดบอท Haiku เก่า / ถอด draft pipeline + UI ที่ตายแล้ว / replyToken-first สำหรับ LINE

## 1. Context — ปัญหาที่ยืนยันแล้วในโค้ด

ระบบ AI ตอบลูกค้าปัจจุบันมี 3 ปัญหาที่ตรวจสอบแล้วกับโค้ดจริง:

1. **LINE Shop ไม่ได้ใช้ SalesBot ตัวใหม่** — pipeline auto-reply (Sonnet 4.6 + grounding guard + capture_lead) ทำงานเฉพาะ Facebook (`routeInbound` มี caller เดียวคือ `facebook-webhook.controller.ts`) ส่วนข้อความอิสระบน LINE Shop ตกไปที่บอทเก่า `line-oa/chatbot.service.ts` (Haiku, 4 tools, ไม่มี grounding guard, ไม่มี handoff)
2. **เผา LLM ซ้ำซ้อนบน LINE Finance** — ทุกข้อความลูกค้าถูกตอบสดโดย `ChatbotFinanceService` แล้ว แต่ `saveMessage` ยังยิง `ChatAiDraftService.generateDraft` (trigger 2 จุด: `chat-engine/services/room-manager.service.ts:281` และ `chatbot-finance/services/chat-room.service.ts:134`) → intent classify (Haiku) + FinanceAI (Haiku/Sonnet) สร้าง draft ที่ไม่มีใครใช้ = 3 LLM calls ต่อ 1 ข้อความ ทั้งที่ต้องการแค่ 1 และตอน handoff ระบบ draft ก็ skip ตัวเอง (`chat-ai-draft.service.ts:50`) — draft บน LINE_FINANCE จึงเป็น waste 100%
3. **Training pairs ใหม่ไม่ถูก embed** — มีแค่ `apps/api/scripts/seed-fb-training.ts` ที่เขียน pgvector column; pairs ที่เกิดจาก staff feedback (ACCEPT/EDIT), cron สกัดรายวัน, และ CHATCONE import ไม่มี embedding → `getFewShotExamples` fallback เป็น top-quality แบบไม่ semantic สำหรับข้อมูลใหม่ทั้งหมด

ปัญหาแทรกที่เจอระหว่าง scrutiny (แก้ในงานนี้ด้วย):

- **ปุ่ม "รับช่วงต่อ" บนห้อง LINE_FINANCE เป็นหมัน** — take-over ตั้ง `aiPaused=true` แต่บอทไฟแนนซ์เช็คแค่ `handoffMode` (`chatbot-finance/services/handoff.service.ts:67-73`) บอทจึงตอบแทรกพนักงานต่อ
- **AiUsageLog นับไม่ครบ** — มีแค่ `FinanceAiService` ที่เรียก `aiUsage.record()`; sales-bot (Claude+Gemini), AiSuggest, intent router, บอทเก่า line-oa ไม่บันทึกเลย → dashboard งบ $10/วัน ต่ำกว่าจริง
- **Rate card ไม่มีราคา Gemini** — `ai-usage/ai-pricing.ts` เป็น Claude-only, unknown model ตกไป default $3/$15 (ราคา Sonnet) → ถ้าบันทึก Gemini ด้วยราคา default cost จะเกินจริง ~10 เท่า

## 2. Goals

- ข้อความอิสระบน LINE Shop ได้คำตอบจาก SalesBot pipeline เดียวกับ Facebook (gates, handoff, logging ครบ) แบบ staged rollout ที่ปิดได้ทันที
- LINE Finance: 1 ข้อความลูกค้า = 1 LLM call เท่านั้น
- ทุก LLM call ที่เหลือในระบบโผล่ใน AiUsageLog ด้วยราคาที่ถูกต้อง (รวม Gemini)
- ปุ่มรับช่วงต่อหยุดบอทได้จริงทุกช่องทาง
- AiTrainingPair ทุกแถวมี embedding ภายใน 24 ชม. หลังถูกสร้าง

## 3. Non-goals

- Hard-stop งบรายวัน (โค้ดระบุไว้แล้วว่าเป็นโปรเจกต์แยก — cron ยังเป็น alert-only)
- ยุบรวม 2 inbox (`/inbox` กับ `/chat`) — งานใหญ่แยกต่างหาก
- DB migration ลบ column `salesBotMode`/`serviceBotMode` — ปล่อยไว้ mark deprecated
- บันทึกค่าใช้จ่าย Vertex embedding ลง AiUsageLog (rate card เป็น LLM-centric; ค่า embedding ต่ำมาก)
- SHOP Sales AI Phase B/C และ AI Agent Registry

## 4. Workstream 1 — Cost hygiene + ถอด draft pipeline (ทำก่อน)

> เหตุผลที่ทำก่อน: WS2 จะเพิ่ม AI traffic ก้อนใหญ่ ต้องเห็น cost จริงและหยุด waste ก่อนเปิด

### 4.1 ถอด draft pipeline

| จุด | การเปลี่ยนแปลง |
|---|---|
| `chat-engine/services/room-manager.service.ts:281-289` | ลบ trigger `generateDraft` + ลบ injection `ChatAiDraftService` |
| `chatbot-finance/services/chat-room.service.ts:131-140` | ลบ trigger `generateDraft` + ลบ injection `ChatAiDraftService` |
| `chat-ai-draft/chat-ai-draft.service.ts` | ลบ `generateDraft`, `approveDraft`, `skipDraft`, `loadPrior` — **เก็บ** `takeOver`, `releaseToAi` (ใช้จริงจาก UnifiedInboxPage + ChatInboxPage) |
| `chat-ai-draft/chat-ai-draft.controller.ts` | ลบ endpoint `POST /chat-ai/approve`, `POST /chat-ai/skip/:id` — เก็บ `take-over/:roomId`, `release-to-ai/:roomId` |
| `chat-intent-router/` (ทั้งโมดูล) | ลบทิ้ง + เอาออกจาก `app.module.ts` (consumer เดียวคือ generateDraft) |
| `apps/web` ChatInboxPage | ถอด `AiDraftCard`, `useLatestDraft`, ส่วน draft ใน `AssistantSidebar` |
| `apps/web` AiSettingsPage | ถอด `PerBotModeCard` (โหมด OFF/HYBRID ไม่มีผลแล้ว) |
| `prisma/schema.prisma` | comment `/// @deprecated` บน `salesBotMode`, `serviceBotMode` — ไม่ migrate |

**Implementation note:** หลังถอด AiDraftCard ให้ตรวจว่า ChatMessage เก่าที่ `intent LIKE 'DRAFT:%'` และไม่เคย delivered ไม่ถูก render เป็น bubble ปกติในทั้ง 2 inbox — ถ้าโผล่ ให้ filter ออกจาก query รายการข้อความ

### 4.2 แก้ take-over ห้องไฟแนนซ์

- เพิ่มเมธอด `isBotSilenced(roomId)` ใน `chatbot-finance/services/handoff.service.ts` คืน `handoffMode || aiPaused`
- `chatbot-finance.service.ts:222` เปลี่ยนจาก `isInHandoffMode` เป็น `isBotSilenced` (ยังบันทึกข้อความลูกค้าเพื่อ history เหมือนเดิม แค่ไม่ตอบ)

### 4.3 AiUsage ครบทุก call site

- `sales-bot/sales-bot.service.ts` — เรียก `aiUsage.record()` หลังจบ `generateReply` (จุดเดียวคลุม Claude/Gemini/auto-reply/testSend; ข้อมูล model+tokens มีอยู่แล้วใน result) `service='sales-bot'`
- `staff-chat/services/ai-suggest.service.ts` — record หลัง suggest call, `service='ai-suggest'`
- `line-oa/chatbot.service.ts` — record (บอทเก่ายังรันช่วง staged rollout ของ WS2), `service='line-oa-legacy'`
- `chat-engine/services/after-hours.service.ts` — record หลัง `messages.create` (ยืนยันแล้วว่าใช้ Claude, มี static fallback เมื่อไม่มี key — เคส fallback ไม่ต้อง record), `service='after-hours'`
- `ai-usage/ai-pricing.ts` — เพิ่ม `gemini-2.5-flash` (ราคา ณ ก.ค. 2026: ตรวจจาก https://ai.google.dev/pricing ตอน implement) + แก้ doc comment จาก "Claude pricing" เป็น "LLM pricing"
- หมายเหตุ: bench CLI (`shop-ai-bench.cli.ts`) จะถูก record ด้วยเพราะเรียกผ่าน SalesBotService — ยอมรับได้ (เป็นการใช้จริง)

### 4.4 Tests (WS1)

- `chat-ai-draft.service.spec.ts` — เหลือเฉพาะ takeover/release
- `room-manager` + finance `chat-room` specs — ยืนยันไม่มี draft trigger
- `chatbot-finance.service.spec.ts` — เคสใหม่: `aiPaused=true` → บอทเงียบ + ข้อความถูกบันทึก
- `ai-pricing.spec.ts` — Gemini rates
- `sales-bot.service.spec.ts` — assert `aiUsage.record` ถูกเรียกด้วย model จาก provider

## 5. Workstream 2 — ต่อ LINE Shop เข้า SalesBot (staged)

### 5.1 replyToken-first delivery

- เพิ่ม `replyToken?: string` ใน `InboundMessage` และ `OutboundMessage` (`chat-engine/interfaces/channel-adapter.interface.ts`)
- `routeInbound` ส่ง `replyToken` ผ่านไปยัง `adapter.sendMessage` ทุกจุดที่ตอบกลับข้อความ inbound นั้น
- `chat-adapters/line-shop.adapter.ts` — ถ้ามี `replyToken` ให้เรียก reply API ก่อน (ฟรี, token อายุ ~1 นาที ใช้ครั้งเดียว) ถ้า fail (token หมดอายุ/ถูกใช้แล้ว) fallback เป็น `pushMessage` เดิม; adapter อื่น ignore field นี้
- เหตุผล: ข้อความ AI จะเป็น volume ก้อนใหญ่สุดของช่องทาง — reply ฟรี, push กินโควต้า plan รายเดือนของ LINE OA

### 5.2 Gate ที่ controller (ไม่ใช่ใน router)

Restructure `line-oa/line-oa-chatbot.controller.ts#handleTextMessage`:

1. แยกการจับคู่ pre-filter เป็น helper `matchCommand(text)` — `#owner`, เบอร์โทร self-link, เช็คยอด/งวด/ชำระ/ใบเสร็จ/ติดต่อ/สัญญา/ลงทะเบียน/ช่วยเหลือ, GREETING/ANDROID/IPAD keywords
2. **ถ้า match** → mirror + ทำงานเดิมทุกประการ (deterministic, ฟรี, ไม่แตะ)
3. **ถ้า freeform** → เช็ค rollout gate:
   - env `LINE_SHOP_AI_ENABLED` (default `false`) — master switch
   - env `LINE_SHOP_AI_WHITELIST_USER_IDS` (comma-separated) — ถ้าไม่ว่าง เฉพาะ userId ในลิสต์เข้า pipeline ใหม่; ถ้าว่าง = ทุกคน
   - **ผ่าน gate** → `messageRouter.routeInbound({..., replyToken})` — **ไม่เรียก `mirrorInbound` ก่อน** (router บันทึกเอง ไม่งั้นข้อความซ้ำ) — ได้ครบ: kill switch รายห้อง (`aiPaused`/`handoffMode`), `ai.autoChannels`, confidence threshold, per-session cap, handoff เมื่อไม่มั่นใจ, `AiAutoReplyLog`
   - **ไม่ผ่าน** → mirror + `handleFreeformMessage` บอทเก่า — ลูกค้านอก whitelist พฤติกรรมเหมือนวันนี้เป๊ะ ไม่มีวันเงียบ
4. เพิ่ม env ใหม่ 2 ตัวลง `.env.example`

Non-text (image/สลิป/sticker) — ไม่แตะ ทำงานเดิม

### 5.3 พฤติกรรมที่เปลี่ยนโดยตั้งใจ (เฉพาะผู้ใช้ที่เข้า pipeline ใหม่)

| สถานการณ์ | วันนี้ (บอทเก่า) | หลัง WS2 | เหตุผล |
|---|---|---|---|
| ห้องอยู่ใน handoff | บอทตอบแทรกพนักงาน | บอทเงียบ พนักงานคุย | semantics เดียวกับ Facebook — ถูกต้องกว่า |
| AI ไม่มั่นใจ (< threshold) | Haiku ตอบมั่วๆ ไปก่อน | เงียบ + แจ้งพนักงาน (handoff) | ป้องกันคำตอบผิดเรื่องเงิน/ราคา |
| นอกเวลา 10:00-20:00 + AI ปิด/error | Haiku ตอบ 24 ชม. | after-hours auto-reply | ตาม pattern Facebook |

แถม: แก้เงื่อนไข after-hours ใน `message-router.service.ts:245` ให้เช็ค `aiPaused` ด้วย (ปัจจุบันเช็คแค่ `handoffMode` — บอทเที่ยงคืนตอบแทรกห้องที่พนักงานรับช่วงแล้วได้)

### 5.4 Preconditions + rollout steps

Preconditions (มีครบแล้วใน prod จาก Facebook rollout): `shop_bot_central_branch_id` ตั้งแล้ว, persona ตั้งแล้ว

1. Deploy โค้ด — `LINE_SHOP_AI_ENABLED` ยังไม่ตั้ง = พฤติกรรมเดิม 100%
2. เจ้าของเปิด checkbox LINE Shop ใน `ai.autoChannels` (Settings → AI) + ตั้ง `LINE_SHOP_AI_ENABLED=true` + whitelist LINE userId ทีมงาน
3. ทีมทดสอบผ่าน LINE จริง → ดู AiAutoReplyLog + AiUsageLog + confidence
4. ขยาย whitelist → เคลียร์ whitelist (= เปิดทุกคน)
5. **Cleanup PR (แยกต่างหาก เมื่อเจ้าของยืนยัน rollout เสร็จ):** ลบ `line-oa/chatbot.service.ts` + `handleFreeformMessage` + gate envs; keyword commands + redirect keywords อยู่ต่อ

### 5.5 Tests (WS2)

- Controller spec: enabled+whitelisted → `routeInbound` ถูกเรียกพร้อม replyToken และไม่เรียก mirror; disabled/นอก whitelist → path เก่า; keyword command → ไม่แตะ gate
- `line-shop.adapter.spec.ts`: มี replyToken → reply API; reply fail → fallback push; ไม่มี token → push
- `message-router` spec: LINE_SHOP ผ่าน AI path + after-hours เช็ค aiPaused

## 6. Workstream 3 — Embedding backfill cron

- ไฟล์ใหม่ `staff-chat/services/embedding-backfill.cron.ts` (วางคู่ `training-extract.cron.ts`)
- ตารางเวลา: รายวัน 03:30 Asia/Bangkok (หลัง training-extract 03:00 จบ)
- Logic: query `AiTrainingPair` ที่ `embedding IS NULL` (raw SQL — Prisma ไม่รองรับ pgvector native, ใช้ pattern เดียวกับ `seed-fb-training.ts`) → `EmbeddingService.embedBatch` ทีละ 100 แถว → update ทีละ batch, cap 5,000 แถว/คืน (กัน runaway ครั้งแรกที่ backfill ของเก่าทั้งหมด)
- Idempotent (query เฉพาะแถวที่ยัง null), Sentry capture on failure ตาม pattern cron อื่น
- เลือก cron-only แทน fire-and-forget ตอนสร้าง pair: code path เดียวคลุมทุกแหล่ง (feedback/cron/import/แหล่งอนาคต), retrieval feed แค่ staff suggestions — ความสดช้าสุด 24 ชม. ยอมรับได้
- Test: cron spec — เลือกเฉพาะแถว null, batch ถูกขนาด, เคารพ cap, ไม่แตะแถวที่มี embedding แล้ว

## 7. Success criteria

1. **WS1:** ส่งข้อความหา LINE Finance 1 ครั้ง → `AiUsageLog` เพิ่ม 1 แถว (ไม่ใช่ 3) และไม่มี ChatMessage `DRAFT:%` ใหม่; กด "รับช่วงต่อ" บนห้องไฟแนนซ์ → ลูกค้าพิมพ์ต่อแล้วบอทไม่ตอบ; สลับ provider เป็น Gemini → cost ใน dashboard สมเหตุสมผล (ไม่ใช่ราคา Sonnet)
2. **WS2:** userId ใน whitelist พิมพ์ถามของ → ได้คำตอบ SalesBot ผ่าน reply API (เช็ค log ว่าไม่ push); userId นอก whitelist → คำตอบบอทเก่าเหมือนเดิม; ปิด `LINE_SHOP_AI_ENABLED` → กลับพฤติกรรมเดิมทันทีไม่ต้อง deploy
3. **WS3:** สร้าง training pair ใหม่ผ่าน feedback → มี embedding ภายใน 24 ชม.; `getFewShotExamples` คืน semantic match จาก pair ใหม่
4. ทุก workstream: `./tools/check-types.sh all` ผ่าน + test suite เขียว

## 8. Risks

| ความเสี่ยง | การจัดการ |
|---|---|
| replyToken หมดอายุระหว่าง AI คิดนาน (~1 นาที) | fallback push อัตโนมัติ — ลูกค้าได้ข้อความเสมอ |
| ลบ draft แล้วมีจุดเรียกที่มองไม่เห็น | TypeScript compile จับ (ลบเมธอดออกจาก service = compile error ทุก caller) |
| SalesBot persona เขียนมาสำหรับบริบท FB | ทดสอบผ่าน whitelist ก่อน — persona แก้ได้จากหน้า Settings ไม่ต้อง deploy |
| ข้อความ freeform ปนคำสั่ง (เช่น "เช็คยอดหน่อยครับ") | `matchCommand` ใช้ exact/includes matching เดิมทุกประการ — พฤติกรรมการจับคู่ไม่เปลี่ยน |
| Backfill คืนแรกเจอ pairs เก่าหลายหมื่นแถว | cap 5,000/คืน — ทยอยจบใน ~2 สัปดาห์ หรือรัน manual ครั้งเดียวก่อนเปิด cron |
