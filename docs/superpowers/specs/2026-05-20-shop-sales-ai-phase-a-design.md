# SHOP Sales AI Auto-Responder — Phase A (Design Spec)

**Sub-project:** SHOP-AI-A (Phase A; Phase B/C deferred — see §10)
**สถานะ:** Design draft 2026-05-20 — pending owner sign-off
**Effort:** ~4-6 working days (1 dev full-time)
**Tracking issue:** TBD (open after spec sign-off)
**Predecessors:** PR #1047 (AI menu relocate + Persona viewer)
**Source playbook:** `คู่มือขายมือถือผ่อน-บัตรใบเดียว-Sales-Playbook.pdf` (46 หน้า, owner-provided 2026-05-20)

---

## 1. Problem Statement

ปัจจุบัน BESTCHOICE SHOP รับลูกค้าผ่านรวมแชท (LINE Shop OA + Facebook Page + TikTok + Web widget) แต่:

- AI auto-reply ที่มีอยู่ ([AiAutoReplyService](apps/api/src/modules/staff-chat/services/ai-auto-reply.service.ts)) ใช้ `AiSuggestService` (single-shot Claude call ไม่มี tool) → ตอบราคา/ผ่อน/promotion **ได้ไม่แม่นยำ (เสี่ยง hallucination)**
- AI Draft pipeline ที่มีอยู่ ([ChatAiDraftService](apps/api/src/modules/chat-ai-draft/chat-ai-draft.service.ts)) สร้าง draft ให้ staff approve → ปิดดีลช้า, ต้องมี staff online เกือบ 24/7
- Sales playbook 46 หน้าที่ owner เพิ่งเขียน define การขายเชิงรุก (persona detection, 3-combo Anchor, 8 objections, cross-sell, lead capture) — ปัจจุบัน AI ไม่ทำตาม

**Phase A goal:** เปิด AI 100% auto-respond ใน SHOP channels (LINE Shop, FB, Web) ตามแนวทาง playbook โดยใช้ infrastructure ที่มีอยู่ + เพิ่ม `capture_lead` tool + แก้ bug ที่ block UX ที่ owner เลือก

## 2. Goals / Non-Goals

### Goals
- **G1** — SHOP AI ตอบ 100% ใน LINE Shop OA / FB / Web ตามแนวทาง playbook
- **G2** — AI ตรวจจับ buying signal → ส่ง PromptPay QR + สร้าง Customer draft + handoff ให้ SALES verify KYC
- **G3** — Red flag → handoff อัตโนมัติ
- **G4** — Staff เห็น AI ทำงาน realtime + กดปุ่ม "รับช่วงต่อ" หยุด AI (Q4 UX = B)
- **G5** — Owner toggle on/off ผ่าน UI; เปลี่ยน channel allowlist ได้

### Non-Goals (Phase A)
- Follow-up cron (3d/7d/14d/30d re-engagement) — Phase B
- Lost customer re-engagement (>6 เดือน) — Phase B
- Trade-in vision (รูปเครื่องเก่า → ตีราคา) — Phase C
- KPI dashboard (Chat-to-Close, AOV, Block Rate) — Phase C
- Per-branch routing (AI ถามสาขา) — Phase B (Phase A ใช้ central branch เดียว)
- Service intent บน SHOP channel — handoff for now (separate "shop-service-bot" → Phase B)
- TikTok outbound — adapter เป็น stub, รอ TikTok BM API access
- Persona editable UI (owner edit prompt) — Phase A+ optional, default = dev redeploy

## 3. Decisions Locked (จาก brainstorming Q1-Q4 + 4 รอบ scrutiny)

| Decision | Choice | Rationale |
|---|---|---|
| Scope | A. Thin slice (sales + combo + upsell + cross-sell + lead capture) | 80% of playbook value; Phase B/C add lifecycle |
| Closing flow | A. AI ส่ง QR + ขอชื่อ/เบอร์/ที่อยู่ + Customer draft; SALES verify KYC | playbook §10.5 ส่ง QR ≤10s; PDPA principle of data minimization — ไม่เก็บ ปชช.ผ่าน chatbot |
| Branch routing | A. Central online hub branch | ลด question count; delivery-first (Kerry/Flash) |
| Staff UX | B. Visible AI + 🤖 badge + "รับช่วงต่อ" toggle | trust + override + training signal |
| Architecture | 1. Extend existing `sales-bot` + `AiAutoReplyService` | infra 80% มีอยู่แล้ว; karpathy guideline |

## 4. Existing Infrastructure Inventory (verified)

| Component | Path | Status |
|---|---|---|
| SalesBotService (Claude Sonnet 4.6 + 3-hop tool loop) | [sales-bot/sales-bot.service.ts](apps/api/src/modules/sales-bot/sales-bot.service.ts) | ✅ live |
| Tools: search_products, calculate_installment, list_promotions, handoff_to_human | [sales-bot/tools/](apps/api/src/modules/sales-bot/tools/) | ✅ live |
| SHOP_SALES_PERSONA (shared by sales-bot + ai-suggest) | [staff-chat/prompts/sales-persona.ts](apps/api/src/modules/staff-chat/prompts/sales-persona.ts) | ✅ live — needs playbook rewrite |
| AiAutoReplyService (auto-send pipeline w/ confidence threshold + cap) | [staff-chat/services/ai-auto-reply.service.ts](apps/api/src/modules/staff-chat/services/ai-auto-reply.service.ts) | ✅ live — needs SalesBot upgrade |
| AiSuggestService (staff manual suggest) | [staff-chat/services/ai-suggest.service.ts](apps/api/src/modules/staff-chat/services/ai-suggest.service.ts) | ✅ keep for staff button (different purpose) |
| ChatIntentRouter (Claude Haiku classifier) | [chat-intent-router/chat-intent-router.service.ts](apps/api/src/modules/chat-intent-router/chat-intent-router.service.ts) | ✅ live — skip for SHOP in Phase A |
| ChatRoom.aiPaused / aiPausedById / aiPausedAt | [schema.prisma:4774-4777](apps/api/prisma/schema.prisma#L4774-L4777) | ✅ live |
| `takeOver(roomId, staffId)` endpoint | [chat-ai-draft.service.ts:181-192](apps/api/src/modules/chat-ai-draft/chat-ai-draft.service.ts#L181-L192) | ✅ live — needs mirror `releaseToAi` |
| ChatRoom.handoffMode / handoffReason / handoffTaggedAt | [schema.prisma:4754-4758](apps/api/prisma/schema.prisma#L4754-L4758) | ✅ live |
| AiSettings table + salesBotMode (OFF/HYBRID/FULL) | [schema.prisma:5906](apps/api/prisma/schema.prisma#L5906) | ⚠️ FULL ไม่ implement — deprecate; ใช้ `ai.autoEnabled` แทน |
| ai_auto_reply_logs table | schema.prisma | ✅ live — needs +4 fields |
| AiAutoReplyLog handoff path via HandoffManager | [message-router.service.ts:196-215](apps/api/src/modules/chat-engine/services/message-router.service.ts#L196-L215) | ✅ live |
| Adapters: LINE Finance / LINE Shop / Facebook / Web Widget — sendMessage() | [chat-adapters/](apps/api/src/modules/chat-adapters/) | ✅ live |
| TikTok adapter sendMessage() | tiktok.adapter.ts | ⚠️ stub (TikTok BM API credentials needed) |
| AiSettingsPage (toggle/channels/threshold/cap UI) | [AiSettingsPage.tsx](apps/web/src/pages/AiSettingsPage.tsx) | ✅ live — extend for central branch + PromptPay |
| AiPersonaPage (read-only viewer) | [AiPersonaPage.tsx](apps/web/src/pages/AiPersonaPage.tsx) | ✅ live — keep, do not extend in Phase A |
| AssistantSidebar (chat inbox panel) | [chat/components/AssistantSidebar.tsx](apps/web/src/pages/chat/components/AssistantSidebar.tsx) | ✅ live — extend for take-over UI |
| RoomListItem (room badge in inbox) | [chat/components/RoomListItem.tsx](apps/web/src/pages/chat/components/RoomListItem.tsx) | ✅ live — extend for AI status badge |
| Customer model (nationalId nullable, lineIdShop, chatConsent, status, branchId required) | [schema.prisma:770-920](apps/api/prisma/schema.prisma#L770) | ✅ live |

## 5. Architecture

### 5.1 Data Flow (inbound → outbound)

```
inbound msg (LINE Shop / FB / Web webhook)
  ↓ MessageRouterService.routeInbound()
ChatRoom found/created
ChatMessage saved (role=CUSTOMER) ← roomManager.saveMessage()
                                      ↓ fire-and-forget chat-ai-draft.generateDraft()
                                      ↓ [chat-ai-draft.service.ts:26 must check
                                      ↓  aiPaused || handoffMode → skip]
                                      ↓ HYBRID mode → DRAFT created (existing behavior)
                                      ↓ OFF mode → skip
  ↓ gateway notify staff (room list refresh)
  ↓ check handoffMode → return (skip AI)
  ↓ shouldAutoReply(session):
    ✓ aiAutoEnabled
    ✓ channel in aiAutoChannels
    ✓ sentCount < aiAutoMaxRepliesPerSession (default raised 5→50)
    ✗ aiPaused                                     ← NEW guard (Blocker 1)
    ✗ handoffMode                                  ← NEW guard (Blocker 2)
  ↓ if false → fall to AfterHoursService
  
AiAutoReplyService.autoReply(roomId, customerMessage)
  ↓ NEW: skip intent router for SHOP channels (Phase A)
  ↓ NEW: fetch priorMessages via roomManager.getRecentMessages(roomId, 5)
  ↓ NEW: SalesBotService.generateReply({text, roomId, customerId, priorMessages})
        ↓ Claude Sonnet 4.6 tool loop (max 3 hops)
        ↓ tools: search_products / calculate_installment / list_promotions
                 / handoff_to_human / capture_lead ← NEW tool
        ↓ if handoff_to_human called → ChatRoom.handoffMode=true (existing tool behavior)
        ↓ if capture_lead called → Customer draft + return PromptPay QR url
  ↓ confidence ≥ threshold (default 0.80, reworked estimateConfidence)
     greeting/qualifier: 0.9, tool-used: 0.95, short/incomplete: 0.6, handoff: 0.3
  ↓ if low confidence → handoff path (existing)
  ↓ adapter = adapterMap.get(session.channel)
  ↓ adapter.sendMessage({externalUserId, channel, type:'TEXT', text})
  ↓ roomManager.saveMessage({roomId, role: BOT, text, intent: 'AUTO:sales'}) ← Blocker 2 fix
  ↓ AiAutoReplyLog row {autoSent: true, intent, toolsUsed, inputTokens, outputTokens} ← migration
```

### 5.2 Why this avoids double-send

`chat-ai-draft.generateDraft()` will NOT send (only creates DRAFT row for HYBRID mode). `AiAutoReplyService.autoReply()` is the ONLY path that calls `adapter.sendMessage()` for auto-reply. Both can fire on the same inbound but only one performs network send.

### 5.3 Failure modes

| Failure | Behavior |
|---|---|
| Claude API timeout/error | catch in message-router:217-222 → fall through to AfterHours / no reply (log error) |
| Adapter sendMessage fails | log error, save BOT msg locally, no retry (customer will re-engage if needed) |
| capture_lead DB transaction fails | tool returns `{error: ...}` → Claude generates apology + handoff_to_human |
| PromptPay QR generation fails | tool returns no QR url, just lead created + handoff (SALES sends QR manually) |
| `shop_bot_central_branch_id` not set | AiAutoReplyService refuses to enable → log warning, fall through |
| `shop_bot_promptpay_id` not set | capture_lead returns lead-only (no QR), AI tells customer SALES will send QR |

## 6. Backend Changes (13 items, locked after Round 4 scrutiny)

| # | File | Change |
|---|---|---|
| 1 | [ai-auto-reply.service.ts:17-33](apps/api/src/modules/staff-chat/services/ai-auto-reply.service.ts#L17-L33) | `shouldAutoReply` add `if (session.aiPaused \|\| session.handoffMode) return false` |
| 2 | [chat-ai-draft.service.ts:26](apps/api/src/modules/chat-ai-draft/chat-ai-draft.service.ts#L26) | Add `\|\| inbound.room.handoffMode` to skip check |
| 3 | [ai-auto-reply.service.ts:98](apps/api/src/modules/staff-chat/services/ai-auto-reply.service.ts#L98) + `.env.example` | Raise default `aiAutoMaxRepliesPerSession` fallback: code `?? '5'` → `?? '50'` + `.env.example` `AI_AUTO_MAX_REPLIES=50`. SystemConfig override unchanged |
| 4 | [ai-auto-reply.service.ts:43-49](apps/api/src/modules/staff-chat/services/ai-auto-reply.service.ts#L43-L49) | Replace `aiSuggest.suggest()` with: **duplicate loadPrior inline (~12 lines)** from chat-ai-draft.service.ts:194 → fetch last 5 msgs → `SalesBotService.generateReply({text, roomId, customerId, priorMessages})` |
| 5 | [sales-bot.service.ts:139-144](apps/api/src/modules/sales-bot/sales-bot.service.ts#L139-L144) | Rework `estimateConfidence`: greeting/qualifier (no tool, complete sentence ≥20 chars) = 0.9; tool-used = 0.95; short = 0.6; handoff = 0.3. Update `sales-bot.service.spec.ts` to match |
| 6 | NEW [sales-bot/tools/capture-lead.tool.ts](apps/api/src/modules/sales-bot/tools/) | See §7 |
| 7 | [staff-chat/prompts/sales-persona.ts](apps/api/src/modules/staff-chat/prompts/sales-persona.ts) | Rewrite per playbook: 4-persona detection trigger sentences, 3-Combo Anchor rule, 8 objections one-liners, red flag list, capture_lead trigger ("เอา/โอเค"), drop "ขอเอกสาร 2 แบบ" section |
| 8 | Prisma migration | (a) `ai_auto_reply_logs` + `intent String?, toolsUsed String[] @default([]), inputTokens Int?, outputTokens Int?` ; (b) `Customer` + `acquisitionSource String? @map("acquisition_source")` + `@@index([acquisitionSource])` |
| 9 | NEW endpoint `ChatAiDraftService.releaseToAi(roomId, staffId)` | Mirror `takeOver`: set `aiPaused=false, aiPausedAt=null, aiPausedById=null`; AuditLog action='AI_RELEASED' |
| 10 | [message-router.service.ts:179-183](apps/api/src/modules/chat-engine/services/message-router.service.ts#L179-L183) | Pass `intent: 'AUTO:sales'` to `roomManager.saveMessage()` (Phase A always sales since intent router skipped for SHOP channels) |
| 11 | NEW 4 SystemConfig keys | `shop_bot_central_branch_id` (uuid String), `shop_bot_promptpay_id` (string — Thai mobile, national ID, or juristic tax ID), `shop_bot_handoff_message` (string default "ขออนุญาตเรียกแอดมินมาช่วยตอบนะคะ"), `shop_bot_test_user_id` (string — owner's LINE userId for adapter test send) |
| 12 | NEW guard | `AiAutoReplyService.shouldAutoReply` fail-loud if SHOP channel + missing `shop_bot_central_branch_id` → log warning + return false |
| 13 | Defense-in-depth: skip when adapter not configured | `shouldAutoReply` check `adapter.isConfigured` early-exit (handles owner accidentally adding TIKTOK to channels) |
| 14 | Fork [staff-chat/prompts/sales-persona.ts](apps/api/src/modules/staff-chat/prompts/sales-persona.ts) | Split into `SHOP_SALES_PERSONA_BASE` (tone+identity, no tool mandate) used by AiSuggestService; `SHOP_SALES_PERSONA_BOT` (extends BASE + tool rules from playbook §3-§10) used by SalesBotService. Prevents AiSuggest from emitting orphan tool-mandate replies |
| 15 | Deprecate `salesBotMode='FULL'` | Update [schema.prisma:5908](apps/api/prisma/schema.prisma#L5908) comment to `// OFF \| HYBRID` only; remove `'FULL'` option from DTO + UI dropdown ([AiSettingsPage.tsx](apps/web/src/pages/AiSettingsPage.tsx) if exposed). Equivalence: FULL behavior = `ai.autoEnabled=true` (separate config) |

## 7. `capture_lead` Tool

### Schema
```typescript
{
  name: 'capture_lead',
  description: 'Call after customer confirms purchase (says "เอา/โอเค/สนใจ"). Captures lead, creates Customer draft, initiates handoff to staff for KYC verification, returns PromptPay QR url for down payment.',
  input_schema: {
    type: 'object',
    properties: {
      customerName: { type: 'string', description: 'ชื่อลูกค้า (ขออย่างน้อย firstname)' },
      phone: { type: 'string', description: 'เบอร์โทร 10 หลัก' },
      address: { type: 'string', description: 'ที่อยู่จัดส่ง (ตัวเลือก ถ้ามี)' },
      productId: { type: 'string', description: 'productId จาก search_products' },
      packageChoice: { type: 'string', enum: ['A', 'B', 'C'], description: 'แพ็คผ่อนที่ลูกค้าเลือก (A=ดาวน์เบา, B=กลาง, C=หนัก)' },
      downAmount: { type: 'number', description: 'ยอดดาวน์ที่จะส่ง QR' }
    },
    required: ['customerName', 'phone', 'productId', 'packageChoice', 'downAmount']
  }
}
```

### Side effects (in `$transaction`)
1. `Customer.create({ name, phone, branchId: shop_bot_central_branch_id, chatConsent: true, chatConsentAt: now(), lineIdShop: room.lineUserId, status: 'ACTIVE', acquisitionSource: 'AI_CHAT' })`
2. `ChatRoom.update({ customerId: <new id> })`
3. `ChatRoom.update({ handoffMode: true, handoffReason: 'lead_captured', handoffTaggedAt: now(), handoffStaffId: null })`
4. `AuditLog.create({ action: 'AI_LEAD_CAPTURED', entity: 'customer', entityId: <new id>, newValue: { productId, packageChoice, downAmount } })`

### Returns
```typescript
{
  customerId: string,
  promptPayQr: string | null,   // data URL of QR png (null if shop_bot_promptpay_id unset)
  downAmount: number,
  handoffMessage: string        // suggested closing message AI uses to wrap conversation
}
```

QR generation: install `promptpay-qr` npm package (verified missing as of 2026-05-20) → generate EMV-co PromptPay payload → pass to existing `qrcode` v1.5.4 lib → return as data URL.

### Edge cases
- `phone` invalid format → Claude returns ask-for-clarification message instead of calling tool
- `productId` not in stock → tool returns `{error: 'out_of_stock'}` → Claude offers alternative + recalls search_products
- **Existing Customer match** → `Prisma.customer.findFirst({ where: { phone, lineIdShop: room.lineUserId } })` composite match (`Customer.phone` is NOT unique). If match → update + `acquisitionSource='AI_CHAT_RETURN'`; if no match → create new + `acquisitionSource='AI_CHAT'`
- `shop_bot_promptpay_id` not set → return `{customerId, promptPayQr: null, ...}` — AI tells customer SALES will send QR

## 8. Frontend Changes

### F1. RoomListItem — AI status badge
[chat/components/RoomListItem.tsx](apps/web/src/pages/chat/components/RoomListItem.tsx)
- 🟢 + "AI" — `aiAutoEnabled` + channel allowed + NOT (aiPaused || handoffMode)
- 🟡 + "พนักงาน" — `aiPaused=true`
- 🔴 + "ต้องตอบ" — `handoffMode=true`
- Filter chips at top of room list: "ทั้งหมด | AI | พนักงาน | รอตอบ"

### F2. AssistantSidebar — Take over / Release toggle
[chat/components/AssistantSidebar.tsx](apps/web/src/pages/chat/components/AssistantSidebar.tsx)
- If `aiPaused=false`: button "🙋‍♀️ รับช่วงต่อ" → POST `/chat-ai-draft/take-over` (existing)
- If `aiPaused=true`: button "↩️ ส่งกลับให้ AI" → POST `/chat-ai-draft/release-to-ai` (NEW endpoint per Backend #9)
- Show last tool called (debug visibility, only visible to OWNER/FINANCE_MANAGER/BRANCH_MANAGER)

### F3. Extend AiSettingsPage — central branch + PromptPay setup
[AiSettingsPage.tsx](apps/web/src/pages/AiSettingsPage.tsx)
- New section "🏪 SHOP Bot Setup":
  - Select branch dropdown → save `shop_bot_central_branch_id`
  - PromptPay number input + QR preview → save `shop_bot_promptpay_id`
  - Test send button: ส่งข้อความไปยัง `shop_bot_test_user_id` SystemConfig (owner's personal LINE ID) → verify adapter + token + delivery
- DO NOT touch AiPersonaPage (read-only viewer stays)

### F4. Inbox message bubble — AI indicator
- ChatMessage rendered with `role=BOT` + `intent.startsWith('AUTO:')` → small 🤖 icon + hover tooltip "AI ตอบอัตโนมัติ"
- `intent.startsWith('DRAFT:')` → existing DRAFT badge (unchanged)

## 9. SHOP_SALES_PERSONA Rewrite Outline

Sections (full text TBD during implementation):
1. **Identity** — keep "BESTCHOICE ผ่อนไอโฟน บัตรประชาชนใบเดียว ลพบุรี" + central branch info from SystemConfig (templatized: `{{branch_name}}`, `{{branch_address}}`, `{{branch_phone}}`)
2. **Tone rules** — playbook §2.3 (พี่/หนู, ห้ามคำ "ติดบูโร/blacklist/ไม่ผ่าน")
3. **4-Persona detection** — playbook §1: A ไรเดอร์ / B แม่ค้า / C นักศึกษา / D ฟื้นเครดิต — trigger sentences + hooks
4. **3-Combo Anchor pricing rule** — playbook §5: ทุกครั้งที่ตอบราคา = 3 แพ็ค (A ดาวน์เบา / B กลาง = อยากให้เลือก / C ดาวน์หนัก) ผ่าน `calculate_installment` tool
5. **8 Objections playbook** — playbook §9: แพง / ขอคิด / Samsung Finance+ / กลัวโกง / ต้องปรึกษาแฟน / ดอกเบี้ย / ผ่อนนาน / iCloud ก๊อป
6. **Upsell + Cross-sell rules** — playbook §11-§12: เสนอ upgrade ความจุ + เคส/ฟิล์ม/AirPods **หลัง** ลูกค้าตกลงเครื่องเท่านั้น
7. **Buying signal → capture_lead** — playbook §10.1: ตอบ "เอา/โอเค/สนใจ/ส่งของยังไง/จ่ายดาวน์ยังไง" → ขอชื่อ/เบอร์/ที่อยู่ → call `capture_lead`
8. **Red Flag triggers → handoff_to_human** — playbook §4.4 + new: ขอหลายเครื่อง / Pro Max+ดาวน์น้อย / ปฏิเสธ selfie+บัตร / ผ่อนแทนคนอื่น / ใช้คำหยาบ / ลูกค้าขอคุยกับคน / คำถามนอก scope (เคลม/ซ่อม/คืน/complain)
9. **MDM framing** — playbook §8: ถ้าลูกค้าถามเรื่องค้างงวด → reframe เป็น "ระบบป้องกันการขโมย"; ตอบตรง ๆ + ให้ทางแก้ + แนะนำ "ค่างวด ≤ 30% ของรายได้"
10. **Removed:** "ขอเอกสาร 2 แบบ" section (Q2 = SALES does KYC, AI ไม่ขอ ปชช)

## 10. Out of Scope (Phase B/C)

- **Phase B:** Follow-up cron lifecycle (3d/7d/14d/30d re-engagement, §15.3), lost-customer re-targeting (§14, "ลูกค้าเก่า = เหมืองทอง"), per-branch routing (§13 multi-branch), service-bot สำหรับ shop channels (เคลม/ซ่อม), persona editable UI (live edit prompt without redeploy)
- **Phase C:** Trade-in vision (§15.1 ส่งรูป → ตีราคา), KPI dashboard (§16.2 Chat-to-Close/AOV/Block Rate), Lead scoring + A/B prompt testing, TikTok outbound (waiting on BM API access)

## 11. Ops / Pre-flight Checklist

- [ ] Owner designate central branch (Branch row exists + branchId noted)
- [ ] Owner กำหนด PromptPay เลขกลาง (single account สำหรับ online sales ดาวน์ — Thai mobile / national ID / juristic tax ID)
- [ ] Owner ส่ง LINE userId ตัวเอง → set `shop_bot_test_user_id`
- [ ] Dev: SHOP_SALES_PERSONA rewrite per §9 (BASE + BOT variants) — **owner reviews compressed prompt before production toggle**
- [ ] Dev: install `promptpay-qr` npm package (verified missing 2026-05-20) — `npm i promptpay-qr -w apps/api`
- [ ] DB: migration (a) `ai_auto_reply_logs` + 4 fields + (b) `Customer.acquisitionSource`
- [ ] Verify [facebook.adapter.ts](apps/api/src/modules/chat-adapters/facebook.adapter.ts) Page access token configured in IntegrationConfig
- [ ] Verify LINE Shop OA channel access token configured
- [ ] Smoke test: send mock inbound to Shop OA → AI replies → Customer draft created → check ai_auto_reply_logs row + handoff state
- [ ] Production SystemConfig: `ai.autoEnabled=true`, `ai.autoChannels=['LINE_SHOP','FACEBOOK','WEB']`, `shop_bot_central_branch_id=<uuid>`, `shop_bot_promptpay_id=<number>`
- [ ] Production SystemConfig: `ai.autoConfidenceThreshold=80`, `ai.autoMaxRepliesPerSession=50`
- [ ] Document TikTok = read-only banner in AiSettingsPage (TIKTOK in channels = no-op until BM API access)
- [ ] Train SALES team on new "🙋‍♀️ รับช่วงต่อ" + "↩️ ส่งกลับให้ AI" workflow

## 12. Testing Strategy

| Layer | Tests |
|---|---|
| Unit | Update [sales-bot.service.spec.ts](apps/api/src/modules/sales-bot/sales-bot.service.spec.ts) — new `estimateConfidence` mapping + handoff path |
| Unit | NEW [capture-lead.tool.spec.ts](apps/api/src/modules/sales-bot/tools/) — happy path, duplicate phone, out-of-stock product, missing promptpay config, transaction rollback |
| Unit | NEW [ai-auto-reply.service.spec.ts](apps/api/src/modules/staff-chat/services/) — all `shouldAutoReply` branches (aiPaused, handoffMode, channel allowlist, cap), autoReply with SalesBot mock, intent prefix written, handoff fallback |
| Unit | Update [chat-ai-draft.service.spec.ts](apps/api/src/modules/chat-ai-draft/chat-ai-draft.service.spec.ts) — handoffMode skip check |
| Integration | NEW: simulated FB webhook → message-router → AiAutoReply → SalesBot mock → capture_lead → assert Customer row + ChatRoom.handoffMode + adapter.sendMessage called |
| Manual QA (staging) | Test 5 personas via LINE Shop OA test account: A ไรเดอร์ ("iPhone 13 ดาวน์เท่าไหร่"), B แม่ค้า ("iPhone 15 Pro กล้องดีมั้ย"), C นักศึกษา ("ผ่อนได้ไหม เป็นนักศึกษา"), D ฟื้นเครดิต ("ติดบูโรอยู่"), red flag ("ขอ Pro Max ดาวน์ 490") |
| Manual QA | Take-over toggle: รับช่วง → AI หยุด → ส่งกลับ → AI ตอบต่อ |
| Manual QA | capture_lead flow: ลูกค้าตอบ "เอา" → AI ขอชื่อ/เบอร์/ที่อยู่ → ส่ง QR → check Customer draft + handoff |
| Load | Simulate 100 concurrent inbounds → verify no double-send, no race on aiPaused, ai_auto_reply_logs all written |

## 13. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Double-send between chat-ai-draft DRAFT + AiAutoReply send | Design ensures only AiAutoReply calls adapter; chat-ai-draft is DRAFT-only. Add integration test |
| AI hallucinates price/promotion (no tool call) | persona prompt §9 mandates "ALWAYS use calculate_installment for prices, NEVER guess" (existing rule); confidence rework treats no-tool greeting as high confidence (intentional — greetings don't need data) |
| Customer gives fake info → AI captures bad lead | Acceptable: SALES verifies before contract; ChatRoom + AuditLog provide full trail |
| Claude API quota exhausted | Failure mode falls through to AfterHours auto-reply; staff gets notified via error log + Sentry |
| Owner mis-configures channels (e.g., includes LINE_FINANCE) | LINE_FINANCE channel has its own bot (FinanceAI via chat-ai-draft); AiAutoReply would also fire = double-bot. Mitigation: document allowlist `['LINE_SHOP','FACEBOOK','WEB']` only; add UI validation |
| Persona prompt is stale relative to playbook | Phase A: dev redeploy required (read-only viewer). Phase A+: enable DB-stored persona for owner edit |
| Take-over button doesn't actually pause AI | Blocker 1 fix: shouldAutoReply checks aiPaused. Test covers exact path |
| Playbook compression fidelity loss | 46-page playbook → ~3-5kb Claude prompt. Mitigation: owner reviews compressed prompt before production toggle (in §11 checklist). Implementer drafts prompt → owner sign-off → only then enable `ai.autoEnabled=true` |

## 14. References

- Source playbook: `คู่มือขายมือถือผ่อน-บัตรใบเดียว-Sales-Playbook.pdf` (owner-provided, 2026-05-20)
- BESTCHOICE business model: [CLAUDE.md](.claude/CLAUDE.md) — Multi-Entity Structure section
- Existing patterns: PR #1047 (AI menu relocate), chatbot-finance "น้องเบส" reference
- World Bank Underbanked stats: ~4.98M Thai adults (playbook §2)
