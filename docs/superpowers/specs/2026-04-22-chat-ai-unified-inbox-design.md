# Chat Unified Inbox + Dual AI Bots — Design Spec

- **Date:** 2026-04-22
- **Owner:** Akenarin (founder + dev)
- **Target:** Ship in 2 weeks (Hybrid C mode by end of Week 1, Full A autonomous mode by end of Week 2)
- **Status:** Draft — awaiting implementation plan

---

## 1. Goal

Deliver a chat experience where:

1. **Staff** see every customer conversation (LINE + Facebook) in one unified inbox with AI context, suggestions, and customer data side-by-side.
2. **Customers** get replies that feel like they are talking to an experienced BESTCHOICE sales person (for buying inquiries) or a patient BESTCHOICE collections specialist (for service/billing). AI tone, knowledge, and closing skill come from real historical conversations of top staff.
3. By end of Week 2, AI handles ~100% of routine conversations autonomously; staff only get handoffs for edge cases.

Success criteria (measured in `AiAutoReplyLog` + `ChatMessage`):

- AI auto-reply rate ≥ 80% of inbound messages by Day 14
- Staff CSAT on AI suggestions ≥ 4/5 during Week 1 (Hybrid C)
- Customer thumbs-up rate ≥ 70% on AI replies
- Zero "hallucinated price / hallucinated stock" incidents (tracked via tool-call audit)
- Average response time < 60s for auto-replied messages

---

## 2. Scope

### In scope

- Two separate AI personas:
  - **บอทขาย** (sales) — new customer inquiries, product recommendation, installment calc, objection handling, promotion, trade-in quote, credit-check handoff
  - **น้องเบส** (service, already exists in `chatbot-finance/`) — balance, schedule, fine calc, payment slip review, bank info, handoff
- **Intent Router** — classifies each inbound message and routes to the correct bot (fallback = bounce to other bot if wrong confidence).
- **Unified Inbox UI** at `/chat` — staff-facing page covering both channels (LINE OA, Facebook) and both bots.
- **Historical chat extraction pipeline** — one-time job that pulls 12 months of LINE OA + Facebook conversations, normalizes them, and uses them for three purposes: knowledge base seeding, style/persona extraction, and RAG retrieval.
- **Guardrails** — confidence threshold, no-go word list, hallucination guard (AI must cite tool output), human override, full audit log.
- **Week 1 = Hybrid C:** AI drafts, staff confirms or edits before sending.
- **Week 2 = Full A:** AI auto-sends; staff only handle handoffs and monitor.

### Out of scope (explicitly)

- TikTok and web-widget channels (foundation exists but not prioritized in this sprint)
- CHATCONE two-way sync (read-only import only, already supported)
- Voice/phone call integration
- Fine-tuning a custom model (we use prompt engineering + RAG + few-shot on Claude Haiku/Sonnet)
- Multi-language support beyond Thai + basic English
- New LINE OA provisioning (we stay on existing finance OA; sales OA is a future split)

---

## 3. Architecture

```
  LINE OA webhook      Facebook Page webhook
          \                    /
           \                  /
            ▼                ▼
        ┌──────────────────────────┐
        │ Intent Router Service    │  ← Claude Haiku, <500ms, classifies:
        │ (new: modules/chat-      │    sales | service | greeting | complaint
        │  intent-router)          │
        └───────────┬──────────────┘
                    │
        ┌───────────┴──────────────┐
        ▼                          ▼
  ┌──────────────┐          ┌──────────────┐
  │ บอทขาย        │          │ น้องเบส       │
  │ (new:         │          │ (existing:   │
  │  sales-bot)   │          │  chatbot-    │
  │               │          │  finance)    │
  └──────┬───────┘          └──────┬───────┘
         │                          │
         └──────────┬───────────────┘
                    ▼
        ┌──────────────────────────┐
        │ ChatRoom + ChatMessage    │
        │ (existing schema)         │
        └───────────┬──────────────┘
                    ▼
        ┌──────────────────────────┐
        │ Unified Inbox UI          │
        │ /chat (new page)          │
        └──────────────────────────┘
```

### Why two bots, shared inbox (rejected alternatives)

- **Rejected: single bot with dual personality.** Prompt complexity explodes; one persona's bad behavior bleeds into the other; harder to A/B test and tune independently.
- **Rejected: two separate LINE OAs.** Forces customers to know which OA to add; doubles the cost of LINE/FB setup; staff lose the "one place to look" benefit; violates the "already-works" infra of single webhook.
- **Accepted: two bots behind one router, one inbox.** Clean persona separation in prompts + routing; shared `ChatRoom` means staff see everything in one UI; easy fallback if router misclassifies.

---

## 4. Components (new vs. existing)

### New modules/pages

| Component | Path | Purpose |
|-----------|------|---------|
| `chat-intent-router` | `apps/api/src/modules/chat-intent-router/` | Classify inbound → route to `sales-bot` or `chatbot-finance` |
| `sales-bot` | `apps/api/src/modules/sales-bot/` | Persona "บอทขาย"; tools: product search, installment calc, stock check, promo lookup, trade-in estimator, credit-check request, handoff |
| `chat-history-extractor` | `apps/api/src/modules/chat-history-extractor/` | One-off batch job: LINE OA + FB Graph API → normalize → `AiTrainingPair` |
| `chat-rag-index` | `apps/api/src/modules/chat-rag-index/` | Embedding index on `ChatMessage` for retrieval at runtime |
| `/chat` page | `apps/web/src/pages/ChatInboxPage.tsx` | Staff unified inbox |
| `/chat/:roomId` drawer | component inside `ChatInboxPage` | Per-room conversation view + AI sidebar |

### Existing — reuse, do not rebuild

- `ChatRoom`, `ChatMessage`, `ChatKnowledgeBase`, `ChatAutoTrigger`, `AiTrainingPair`, `AiAutoReplyLog` (Prisma)
- `staff-chat/room-manager.service.ts` — already implements unified inbox backend for rooms
- `chatbot-finance/` — service bot (น้องเบส), enhanced with full conversation history window
- `line-oa/chatbot.service.ts` — Claude Haiku orchestration, tool-use pattern
- `ai-import.service.ts` — CSV/JSON importer with CHATCONE_IMPORT format; extractor writes to this format
- `LineOaSettingsPage`, `AiSettingsPage` — settings surface, add new toggles

---

## 5. Data flow — one customer message

**Inbound (customer → staff/AI):**

1. LINE OA or FB webhook → existing receiver
2. Persist `ChatMessage` (direction=INBOUND)
3. Call `chat-intent-router.classify(message, roomContext)` → `{ intent, confidence, routeTo }`
4. If `routeTo=sales` → `sales-bot.generateReply(message, roomContext, ragContext)`
   If `routeTo=service` → `chatbot-finance.generateReply(...)` (existing)
5. Bot builds prompt from: system persona + customer snapshot + RAG top-5 past similar conversations + tool results
6. Claude returns draft reply + confidence + tools used
7. **Hybrid C (Week 1):** save `ChatMessage` with status=DRAFT, surface to staff sidebar as "AI suggests"
8. **Full A (Week 2):** if confidence ≥ threshold and no guardrail trip → send via LINE/FB Send API, status=SENT_AUTO. Else → handoff.
9. Write `AiAutoReplyLog` with full audit payload.

**Outbound (staff → customer) in Hybrid C:**

1. Staff sees AI draft in sidebar, clicks Send / Edit / Skip / Take-over
2. Take-over sets `room.aiPaused=true` — no auto-reply in this room until staff unsets
3. Staff message saves as `ChatMessage` direction=OUTBOUND, status=SENT_BY_STAFF

**Guardrail trips (any bot, any mode):**

- `no-go` word match → force handoff, notify staff
- Confidence < threshold (default 0.7, configurable per bot) → force handoff
- Tool call fails / returns uncertain data → force handoff, never fabricate
- Customer says "คุยกับคน" / "พนักงาน" → immediate handoff, AI silent

---

## 6. AI personas

### บอทขาย (Sales Bot)

- **Role:** Experienced BESTCHOICE sales advisor. Warm, consultative, knows every model in stock, never pushy but always closing.
- **Persona source:** Layer-2 extraction — analyze top-performing staff's conversations (chosen by owner during Week 1 Day 3 extraction), distill tone/vocabulary/closing patterns into system prompt.
- **Tools available:**
  - `search_products(query, budget, useCase)` — Query `Product` table with filters
  - `calculate_installment(productId, downPct, tenure)` — reuse existing useContractCalculation logic via API
  - `check_stock(productId, branchId?)` — current stock per branch
  - `list_promotions(productId?)` — active `Promotion` records
  - `estimate_trade_in(model, condition)` — reuse existing trade-in pricing table
  - `request_credit_check(customerData)` — write-only: creates a `CreditCheck` draft record for staff review
  - `handoff_to_human(reason)`
- **Closing behavior:** after product + plan agreed, bot proposes next step ("จองเครื่องที่สาขา" / "ส่ง ID card ให้ staff") rather than just dropping.
- **Never:** quote a price not returned by `calculate_installment`, promise stock without `check_stock`, promise credit approval.

### น้องเบส (Service Bot, existing — enhanced)

- **Role:** Patient, accurate, empathetic on overdue conversations. Keeps tone respectful during collections.
- **Enhancements in this sprint:**
  - Add **full conversation history window** (currently only injects current message + customer snapshot)
  - Adopt same guardrail framework as sales bot
  - Surface its draft replies through the same Unified Inbox UI in Hybrid C mode
- **Tools:** existing (`get_current_balance`, `get_payment_schedule`, `calculate_fine`, `list_recent_receipts`, `get_bank_info`, `search_knowledge_base`, `handoff_to_human`)

### Intent Router

- **Model:** Claude Haiku (fast, cheap), max 500ms budget
- **Input:** current message + last 3 messages in room + customer.tags
- **Output:** `{ intent: sales | service | greeting | complaint | unknown, confidence, routeTo }`
- `greeting` → default to `service` if customer has active contract, else `sales`
- `complaint` → route to handoff queue directly, no bot reply
- `unknown` with confidence < 0.5 → handoff

---

## 7. Historical chat extraction pipeline

**Volume:** 12 months, ~1k–10k conversations across LINE OA + Facebook (owner estimate).

### LINE OA

- No bulk export API. Options:
  - **Preferred:** LINE Messaging API `/v2/bot/followers/ids` → iterate users → `/v2/bot/profile/{userId}` + fetch via webhook replay store. Our current setup logs all inbound via webhooks already into `ChatMessage` when the bot is connected, so for LINE the history is mostly already in `ChatMessage` — the gap is anything older than the bot's connection date.
  - **Fallback:** manual CSV export from LINE OA Manager for rooms predating bot connection.
- Deliverable: normalized rows `{ roomId, channel=LINE, senderRole, text, createdAt }`.

### Facebook Page

- **Graph API `/me/conversations?fields=participants,messages{message,from,created_time}&limit=100`** → paginate.
- Long-lived Page Access Token required (owner provides).
- Deliverable: same normalized schema.

### Processing (one-off batch)

1. Run extractor → dump to `/tmp/chat-history-2026q2/` as JSON files.
2. Import via existing `ai-import.service.ts` (`CHATCONE_IMPORT` format) → `AiTrainingPair` table (customer-message → staff-answer).
3. Claude batch job over all pairs to extract:
   - **FAQ patterns** → upsert into `ChatKnowledgeBase`
   - **Product mentions + prices** → cross-check with `Product` table, flag discrepancies for owner review
   - **Objection-response pairs** → tagged subset of `AiTrainingPair` used for sales-bot few-shot
   - **Promotion history** → enrich `Promotion` table if missing
4. **Style extraction:** owner identifies top-performing staff (≤3 people). Claude analyzes only their messages → generates a persona document (`docs/superpowers/specs/sales-persona.md`) → seeded into sales-bot system prompt.
5. **RAG indexing:** embed all outbound staff messages from the last 12 months. At runtime, retrieve top-5 by cosine similarity to current customer message and inject as "Reference conversations" in the bot prompt.

### PDPA / Privacy

- Historical chats contain PII (phone, ID). Extraction pipeline strips ID card numbers + full DOB before persisting to training pairs. Phone numbers are hashed for RAG indexing; restored only via `customerId` join at display time.
- Training pairs retention: 24 months (matches audit log policy).

---

## 8. Unified Inbox UI (`/chat`)

### Layout (3-column, desktop)

```
┌────────┬────────────────────────┬────────────────────┐
│ Rooms  │ Conversation           │ Assistant + Context│
│ (left) │ (center)               │ (right)            │
│        │                        │                    │
│ Filter │ [date divider]         │ Customer card      │
│ - All  │ customer: ...          │ - name, phone      │
│ - Sales│ staff/AI: ...          │ - active contracts │
│ - Serv │ [AI draft box — Hybrid]│ - balance, overdue │
│ - SLA! │ [customer]             │                    │
│        │ [typing...]            │ AI suggestion      │
│ Room 1 │                        │ - draft text       │
│ Room 2 │                        │ - confidence: 0.82 │
│ Room 3 │                        │ - tools used       │
│ ...    │                        │ - [Send][Edit][Skip│
│        │                        │                    │
│        │ [compose box]          │ Suggested actions  │
│        │ [Send as staff]        │ - เสนอโปร X        │
│        │                        │ - เช็คสต็อก สาขา Y │
└────────┴────────────────────────┴────────────────────┘
```

### Room list (left)

- Filters: channel (LINE/FB/All), bot (sales/service/all), status (open, handoff, SLA-breach, auto-handled)
- Each row: avatar, customer name (or external ID), last message preview, unread badge, channel icon, SLA indicator (🟢/🟡/🔴)
- Sort: by last message desc; SLA-breach pinned top.
- Realtime: websocket (reuse existing staff-chat socket) or polling every 10s for MVP.

### Conversation (center)

- Messages grouped by day, show sender role (customer / staff name / AI-sales / AI-service)
- AI messages visually distinguished (emerald left border, tiny "AI · confidence 0.82" label)
- Compose box with: text, emoji, attachment, canned-reply picker (pulls from `ChatKnowledgeBase`)
- In **Hybrid C**: AI draft appears above compose box with Send / Edit / Skip. Edit copies into compose, staff sends manually.
- In **Full A**: no draft box — AI has already sent. Staff can type to take over; typing auto-pauses AI for this room.

### Assistant sidebar (right)

- **Customer card:** link to `/customers/:id`, phone (click-to-call), active contract status (emerald badge if paid-on-time, amber if due soon, red if overdue)
- **AI reasoning:** collapsible — shows intent, confidence, tools used, RAG reference room IDs
- **Suggested next actions:** 2–3 buttons (e.g., "ส่งโปรฯ รุ่น X", "เปิด POS สร้าง quote", "นัดมาสาขา") — each generates a pre-filled draft or opens the relevant page
- **Quick stats:** response-time on this room, AI auto-reply rate, CSAT from this customer

### Design tokens / visual

- Follow existing `.claude/rules/frontend.md`: `bg-background`, `bg-card`, emerald primary, no hardcoded grays, `leading-snug` for Thai text.
- Mobile: collapse to single column, swipe between room list / conversation / sidebar.

### Routing

- Page path: `/chat` (default = inbox list)
- `/chat?room=:roomId` opens a specific room in center column
- Add to `MainLayout` nav under "สื่อสาร" group (or wherever LineOaSettings sits now)
- Role access: `OWNER`, `BRANCH_MANAGER`, `FINANCE_MANAGER`, `ACCOUNTANT`, `SALES` — all can view rooms in their scope (BranchGuard logic for branch-scoped roles; OWNER/FINANCE_MANAGER see all).

---

## 9. Guardrails

1. **Confidence threshold** — per-bot config in `AiSettings`. Default sales=0.70, service=0.75 (service bot deals with money → stricter). Configurable via `AiSettingsPage`.
2. **No-go word list** — stored in DB (new table `ChatNoGoTerm` or extend `ChatKnowledgeBase` with type=NO_GO). Defaults: legal terms ("ทนาย", "แจ้งความ", "ผู้บริโภค"), threats ("โกง", "หลอก"), competitor names (owner provides), extreme profanity. Match → force handoff, notify staff channel.
3. **Hallucination guard** — before send, a post-processor checks every numeric claim (price, stock count, dates) against the tool-call outputs that were in this turn's context. Mismatch → discard reply, retry once, then handoff.
4. **Human override** — "Take over" button sets `room.aiPaused=true` with `pausedByUserId`. AI stops responding in that room. Unpause explicit only. `aiPaused` expires after 24h idle to avoid orphaned rooms.
5. **Audit log** — every AI reply writes `AiAutoReplyLog`: input message, full prompt, model, tools called, tool results, draft reply, confidence, final action (sent / draft / handoff), cost in USD. Retention 12 months (matches existing audit log policy).
6. **Rate limit** — same customer can trigger ≤ 10 AI replies per minute; above that → handoff + Sentry alert (possible abuse / bug loop).
7. **Sentry integration** — catch all errors in bot services, tag with `bot=sales|service`, `room=roomId`. Use existing Sentry wiring.

---

## 10. Timeline (revised with realistic risk buffer)

### Week 1 — Hybrid C (AI suggests, staff confirms)

| Day | Deliverable |
|-----|-------------|
| 1 | Chat extractor skeleton; FB Graph token provisioned; LINE existing data audit |
| 2 | Extract 12 months → normalize → import to `AiTrainingPair`; PII scrubber |
| 3 | Claude batch knowledge extraction → seed `ChatKnowledgeBase`, persona doc draft |
| 4 | Unified Inbox UI skeleton (`/chat`) — room list + conversation column, no AI sidebar yet |
| 5 | Intent Router module + tests; Assistant sidebar UI (AI draft + customer card) |
| 6 | Sales bot v1 — `search_products`, `calculate_installment`, `list_promotions`, `handoff_to_human` + objection-handling prompt; wire into Intent Router |
| 7 | น้องเบส full-history-window upgrade; full flow demo (internal) |

### Week 2 — Full A (autonomous)

| Day | Deliverable |
|-----|-------------|
| 8 | RAG embedding pipeline + retrieval at runtime |
| 9 | Sales bot v2 — `check_stock`, `request_credit_check`, `estimate_trade_in` |
| 10 | Style-guide extraction finalized; sales persona locked in system prompt |
| 11 | Guardrails: no-go list, hallucination check, rate limit, aiPaused toggle |
| 12 | A/B gate — 20% customer traffic to auto-reply mode, rest still Hybrid C; monitor `AiAutoReplyLog` + Sentry |
| 13 | Fix top-3 issues from A/B; widen to 50% |
| 14 | Full rollout if metrics ≥ success criteria; else stay at 50% and iterate |

**Slip contingency:** if Day 14 metrics miss (e.g., auto-reply rate <60% or CSAT <3.5), stay in Hybrid C indefinitely and iterate weekly. Do not force Full A to meet a date.

---

## 11. Testing strategy

- **Unit:** intent router classification (20+ labeled examples), tool functions (product search, installment calc), guardrail matchers (no-go, hallucination).
- **Integration:** webhook → intent router → bot → ChatMessage persisted; Hybrid C draft flow; Full A auto-send flow; handoff flow.
- **E2E (Playwright):** staff opens `/chat`, sees rooms, approves an AI draft, sends; staff clicks Take-over, AI stops; staff filters by SLA-breach.
- **Prompt regression suite:** 50 golden conversations (25 sales, 25 service) → replay through bot → snapshot outputs → diff on prompt changes. Breaking changes require owner review.
- **Shadow mode (Day 12–14):** run Full A in background on 100% traffic but don't actually send; compare AI draft vs. what staff actually sent. Measure divergence before going live.

---

## 12. Rollback plan

- `AiSettings.aiMode` flag per bot: `OFF | HYBRID | FULL`. Toggle in `AiSettingsPage`, effective immediately.
- If bad reply goes out: staff uses Take-over per room + owner can `OFF` the whole bot in one click.
- Draft + auto-reply history never deleted — full forensics via `AiAutoReplyLog`.

---

## 13. Open questions (non-blocking)

These can be decided during implementation:

1. Which staff members are "top performers" for persona extraction? (Owner to identify during Day 3)
2. Embedding provider — Claude doesn't offer embeddings; use OpenAI `text-embedding-3-small` or Voyage AI? (Leaning OpenAI for maturity + cost)
3. Should `/chat` replace `/notifications` in left nav or sit alongside?
4. Do we allow staff to edit an already-sent AI auto-reply (correction flow)?
5. Facebook Page token renewal strategy — long-lived tokens expire every 60 days; add a cron to refresh?

---

## 14. Dependencies

- **External:** LINE Messaging API credentials (we have), Facebook Page Access Token (owner to provide), OpenAI API key for embeddings (if chosen).
- **Internal:** `Product`, `Promotion`, `Stock`, `Branch`, `CreditCheck`, `Customer` tables — all exist.
- **No new Prisma migrations expected** other than: `ChatNoGoTerm` (or `ChatKnowledgeBase.type` extension) and `ChatRoom.aiPaused` + `ChatRoom.pausedByUserId` if not already present. To be confirmed during plan step.
