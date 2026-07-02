# AI Reply Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retire the dead AI-draft pipeline + make every LLM call visible in AiUsageLog (WS1), route LINE Shop freeform messages into the SalesBot auto-reply pipeline behind a staged gate with replyToken-first delivery (WS2), and nightly-embed AiTrainingPairs so semantic retrieval covers fresh data (WS3).

**Architecture:** All changes follow the existing NestJS module→service→Prisma pattern. WS2 reuses the battle-tested `MessageRouterService.routeInbound` path (Facebook's) — the rollout gate lives in the LINE webhook controller so misconfiguration degrades to the legacy bot, never to silence. Spec: `docs/superpowers/specs/2026-07-02-ai-reply-consolidation-design.md`.

**Tech Stack:** NestJS + Prisma (apps/api), React + TanStack Query (apps/web), Jest specs colocated as `*.spec.ts`, pgvector via raw SQL, Vertex AI embeddings.

## Global Constraints

- Work on branch `feat/ai-reply-consolidation` (already exists; spec committed).
- User-facing strings in Thai; code identifiers in English (`.claude/rules/coding-standards.md`).
- Never hard-delete rows; no DB migration in this plan (schema change is a `///` comment only — no `prisma migrate` run needed).
- Prettier: semi, single quotes, printWidth 100, 2-space tabs.
- Frontend: design tokens only (no `text-gray-*`, no hex); `toast` from sonner; TanStack Query for data.
- Commit style: `type(scope): summary` (see git log for examples).
- Type check command: `./tools/check-types.sh api` / `./tools/check-types.sh all` (run from repo root).
- Jest (API): run from repo root with `npx jest --config apps/api/jest.config.js <path>` — if that config path fails, use `cd apps/api && npx jest <path relative to apps/api>`.
- `AiUsageModule` is `@Global()` and exports `AiUsageService` — inject it anywhere WITHOUT touching module imports.
- The fire-and-forget usage-record idiom is `void this.aiUsage.record({...})` (record never throws; see `finance-ai.service.ts:136-155` for the canonical call).

---

## WS1 — Cost hygiene + retire draft pipeline

### Task 1: Finance take-over gate (`isBotSilenced`)

**Files:**
- Modify: `apps/api/src/modules/chatbot-finance/services/handoff.service.ts` (method `isInHandoffMode` at ~line 67)
- Modify: `apps/api/src/modules/chatbot-finance/services/chatbot-finance.service.ts:222`
- Modify: `apps/api/src/modules/chatbot-finance/services/chatbot-finance.service.spec.ts` (~lines 81-83 mock + the handoff-gate test ~line 139)
- Test (create if absent): `apps/api/src/modules/chatbot-finance/services/handoff.service.spec.ts`

**Interfaces:**
- Consumes: `HandoffService` constructor is `(prisma: PrismaService, staffNotify: StaffNotificationService)`.
- Produces: `HandoffService.isBotSilenced(roomId: string): Promise<boolean>` — replaces `isInHandoffMode` (which is then deleted; it had exactly one caller).

- [ ] **Step 1: Write the failing unit test**

Check whether `handoff.service.spec.ts` exists (`ls apps/api/src/modules/chatbot-finance/services/ | grep handoff`). If it exists, append the `describe` block; if not, create the file with:

```ts
import { HandoffService } from './handoff.service';

describe('HandoffService.isBotSilenced', () => {
  const make = (room: { handoffMode: boolean; aiPaused: boolean } | null) => {
    const prisma = {
      chatRoom: { findUnique: jest.fn().mockResolvedValue(room) },
    };
    return new HandoffService(prisma as any, {} as any);
  };

  it('returns true when room is in handoff mode', async () => {
    expect(await make({ handoffMode: true, aiPaused: false }).isBotSilenced('r1')).toBe(true);
  });

  it('returns true when staff took over (aiPaused)', async () => {
    expect(await make({ handoffMode: false, aiPaused: true }).isBotSilenced('r1')).toBe(true);
  });

  it('returns false when neither flag is set', async () => {
    expect(await make({ handoffMode: false, aiPaused: false }).isBotSilenced('r1')).toBe(false);
  });

  it('returns false when room does not exist', async () => {
    expect(await make(null).isBotSilenced('r1')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx jest src/modules/chatbot-finance/services/handoff.service.spec.ts`
Expected: FAIL — `isBotSilenced is not a function`

- [ ] **Step 3: Implement `isBotSilenced`, delete `isInHandoffMode`**

In `handoff.service.ts`, replace the existing `isInHandoffMode` method (verify with `grep -rn "isInHandoffMode" apps/api/src --include="*.ts" | grep -v spec` that `chatbot-finance.service.ts:222` is the only caller) with:

```ts
  /**
   * true เมื่อบอทต้องเงียบ: ห้องอยู่ใน handoff (ส่งต่อพนักงาน) หรือ aiPaused
   * (พนักงานกด "รับช่วงต่อ" จาก inbox) — เดิมเช็คแค่ handoffMode ทำให้ปุ่ม
   * รับช่วงต่อไม่หยุดบอทไฟแนนซ์
   */
  async isBotSilenced(roomId: string): Promise<boolean> {
    const room = await this.prisma.chatRoom.findUnique({
      where: { id: roomId },
      select: { handoffMode: true, aiPaused: true },
    });
    return Boolean(room?.handoffMode || room?.aiPaused);
  }
```

In `chatbot-finance.service.ts:222`, change the gate:

```ts
    // Handoff/take-over gate — handoff หรือพนักงานรับช่วงต่อ (aiPaused) → bot หยุดตอบ
    if (await this.handoff.isBotSilenced(session.id)) {
      this.logger.log(`[Finance] Skip — session ${session.id} silenced (handoff/aiPaused)`);
```

(keep the message-save + return body unchanged)

- [ ] **Step 4: Update the ChatbotFinanceService spec**

In `chatbot-finance.service.spec.ts`: change the mock at ~line 81-83 to `handoff = { isBotSilenced: jest.fn().mockResolvedValue(false) };` and the gate test at ~line 139 to `handoff.isBotSilenced.mockResolvedValue(true);` (assertions unchanged: message saved, no AI, no reply).

- [ ] **Step 5: Run both suites**

Run: `cd apps/api && npx jest src/modules/chatbot-finance/services/handoff.service.spec.ts src/modules/chatbot-finance/services/chatbot-finance.service.spec.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/chatbot-finance
git commit -m "fix(chatbot-finance): take-over (aiPaused) now silences the finance bot"
```

---

### Task 2: Remove both draft-generation triggers

**Files:**
- Modify: `apps/api/src/modules/chat-engine/services/room-manager.service.ts` (trigger at ~281-289 + import + constructor param)
- Modify: `apps/api/src/modules/chatbot-finance/services/chat-room.service.ts` (import line 6, constructor lines 21-22, trigger lines 131-140)
- Modify: `apps/api/src/modules/chat-engine/chat-engine.module.ts` (drop `forwardRef(() => ChatAiDraftModule)` + import)
- Modify: `apps/api/src/modules/chatbot-finance/chatbot-finance.module.ts` (drop `forwardRef(() => ChatAiDraftModule)` from imports array + import statement)

**Interfaces:**
- Consumes: nothing new.
- Produces: `RoomManagerService.saveMessage` and finance `ChatRoomService.saveMessage` no longer reference `ChatAiDraftService` at all — Task 3 relies on this to shrink the service.

- [ ] **Step 1: Delete the trigger blocks + injections**

In both files remove: the `ChatAiDraftService` import, the `@Optional() @Inject(forwardRef(() => ChatAiDraftService)) private chatAiDraftService?: ChatAiDraftService` constructor param (exact decorator shape per file — also drop `forwardRef`/`Optional`/`Inject` imports if now unused), and this block (identical comment in both files):

```ts
    // Fire-and-forget AI draft generation for inbound customer messages.
    // ChatAiDraftService internally respects room.aiPaused and AiSettings mode.
    // Never block webhook ACK on draft generation.
    if (params.role === MessageRole.CUSTOMER && this.chatAiDraftService) {
      this.chatAiDraftService.generateDraft(msg.id).catch((err) => {
        this.logger.error(
          `[ChatAiDraft] draft generation failed for ${msg.id}: ${err instanceof Error ? err.message : err}`,
        );
      });
    }
```

- [ ] **Step 2: Clean the two module files**

`chat-engine.module.ts`: `imports: [forwardRef(() => StaffChatModule)]` (remove the ChatAiDraftModule entry + its import statement).
`chatbot-finance.module.ts`: remove `forwardRef(() => ChatAiDraftModule)` from the imports array + the import statement.

- [ ] **Step 3: Fix any spec stubs that provided ChatAiDraftService**

Run: `grep -rln "ChatAiDraftService" apps/api/src --include="*.spec.ts"`
For each hit OUTSIDE `chat-ai-draft/`, remove the `{ provide: ChatAiDraftService, useValue: ... }` entry + import.

- [ ] **Step 4: Typecheck + run touched suites**

Run: `./tools/check-types.sh api && cd apps/api && npx jest src/modules/chat-engine src/modules/chatbot-finance`
Expected: PASS (0 type errors)

- [ ] **Step 5: Commit**

```bash
git add apps/api
git commit -m "refactor(chat): remove dead draft-generation triggers from message save paths"
```

---

### Task 3: Strip ChatAiDraftService to take-over/release; delete intent router

**Files:**
- Modify: `apps/api/src/modules/chat-ai-draft/chat-ai-draft.service.ts` (keep only `takeOver`/`releaseToAi`)
- Modify: `apps/api/src/modules/chat-ai-draft/chat-ai-draft.controller.ts` (keep only take-over/release endpoints)
- Modify: `apps/api/src/modules/chat-ai-draft/chat-ai-draft.module.ts`
- Delete: `apps/api/src/modules/chat-ai-draft/dto/approve-draft.dto.ts` (and the dto/ dir if now empty)
- Delete: `apps/api/src/modules/chat-intent-router/` (3 files)
- Modify: `apps/api/src/app.module.ts` (import line ~95 + array entry ~305 for ChatIntentRouterModule)
- Modify: `apps/api/src/modules/chat-ai-draft/chat-ai-draft.service.spec.ts`

**Interfaces:**
- Consumes: Task 2 done (no external `generateDraft` callers remain).
- Produces: `ChatAiDraftService` = `{ takeOver(roomId, staffId): Promise<{paused:boolean}>, releaseToAi(roomId, staffId): Promise<{released:boolean}> }` with constructor `(prisma: PrismaService, gateway?: IChatGateway)`. Endpoints kept verbatim: `POST /chat-ai/take-over/:roomId`, `POST /chat-ai/release-to-ai/:roomId` (frontend at `apps/web/src/pages/chat/lib/chat-api.ts:74-78` + `UnifiedInboxPage/index.tsx:277,310` depends on these paths).

- [ ] **Step 1: Verify no remaining callers of the dying methods**

Run: `grep -rn "generateDraft\|approveDraft\|skipDraft\|ChatIntentRouterService" apps/api/src --include="*.ts" | grep -v "chat-ai-draft/\|chat-intent-router/"`
Expected: no output. (If anything appears, stop — Task 2 missed a site.)

- [ ] **Step 2: Rewrite the service (full replacement)**

`chat-ai-draft.service.ts` becomes exactly: the current file minus `generateDraft`, `approveDraft`, `skipDraft`, `loadPrior`, minus imports `NotFoundException`, `ChatChannel`, `ChatIntentRouterService`, `SalesBotService`, `FinanceAiService`, `LineFinanceClientService`, minus the `SHOP_CHANNELS` const, minus those constructor params. Header comment:

```ts
/**
 * Take-over / release-to-AI controls for the staff inboxes.
 * WS1 (2026-07): the legacy draft pipeline (generateDraft/approve/skip) was retired —
 * live bots (AiAutoReplyService บน SHOP channels, ChatbotFinance บน LINE_FINANCE)
 * เป็นคนตอบลูกค้าแล้ว เหลือเฉพาะปุ่มรับช่วงต่อ/ส่งกลับ AI
 */
```

Constructor keeps only `prisma` + optional `gateway`. `takeOver`/`releaseToAi` bodies unchanged (verbatim).

- [ ] **Step 3: Rewrite controller + module**

Controller: keep imports `Controller, Param, Post, Req, UseGuards` + guards/roles + service; delete `Body`, `ApproveDraftDto` import, and the `generate`/`approve`/`skip` endpoints. Keep `take-over`/`release-to-ai` endpoints verbatim.

Module (full replacement):

```ts
import { Module, forwardRef } from '@nestjs/common';
import { ChatAiDraftService } from './chat-ai-draft.service';
import { ChatAiDraftController } from './chat-ai-draft.controller';
import { StaffChatModule } from '../staff-chat/staff-chat.module';

@Module({
  // CHAT_GATEWAY_TOKEN — takeOver/releaseToAi emit chat:room:update ให้ inbox refresh
  imports: [forwardRef(() => StaffChatModule)],
  controllers: [ChatAiDraftController],
  providers: [ChatAiDraftService],
  exports: [ChatAiDraftService],
})
export class ChatAiDraftModule {}
```

Delete `dto/approve-draft.dto.ts`. Delete the `chat-intent-router/` directory. In `app.module.ts` remove the `ChatIntentRouterModule` import line and array entry (`ChatAiDraftModule` stays — its controller is live).

- [ ] **Step 4: Shrink the spec**

`chat-ai-draft.service.spec.ts` keeps ONLY the `takeOver` test and the `releaseToAi` describe (both currently in the file — copy assertions verbatim), with the reduced TestingModule:

```ts
import { Test } from '@nestjs/testing';
import { ChatAiDraftService } from './chat-ai-draft.service';
import { PrismaService } from '../../prisma/prisma.service';

async function build(prisma: any) {
  const mod = await Test.createTestingModule({
    providers: [ChatAiDraftService, { provide: PrismaService, useValue: prisma }],
  }).compile();
  return mod.get(ChatAiDraftService);
}
```

(the `$transaction` mock stays `jest.fn((fn: any) => fn(prisma))`; assertions for `AI_RELEASED` audit log verbatim from the current suite)

- [ ] **Step 5: Typecheck + tests + commit**

Run: `./tools/check-types.sh api && cd apps/api && npx jest src/modules/chat-ai-draft`
Expected: PASS

```bash
git add apps/api
git commit -m "refactor(chat-ai-draft): retire draft pipeline — keep take-over/release; drop intent router"
```

---

### Task 4: Hide legacy drafts server-side + remove draft UI + deprecate mode fields

**Files:**
- Modify: `apps/api/src/modules/chat-engine/services/room-manager.service.ts` (`getRecentMessages` where-clause, ~line 311)
- Modify: chat-engine room-manager spec (add filter assertion)
- Modify: `apps/web/src/pages/chat/components/AssistantSidebar.tsx`
- Delete: `apps/web/src/pages/chat/components/AiDraftCard.tsx`
- Modify: `apps/web/src/pages/chat/hooks/useAiDraft.ts` (keep `useTakeOver`/`useReleaseToAi` only)
- Modify: `apps/web/src/pages/chat/lib/chat-api.ts` (delete `approveDraft`, `skipDraft`)
- Modify: `apps/web/src/pages/chat/components/MessageBubble.tsx` (remove `isDraft` styling/badge)
- Modify: `apps/web/src/pages/AiSettingsPage.tsx` (delete `PerBotModeCard` + `PerBotSettings` + render at ~line 517)
- Modify: `apps/api/prisma/schema.prisma` (deprecation comments on `AiSettings.salesBotMode`/`serviceBotMode`)

**Interfaces:**
- Consumes: Task 3's surviving endpoints.
- Produces: `GET /staff-chat/rooms/:id/messages` never returns undelivered `DRAFT:%` messages (both inboxes call this endpoint; UnifiedInbox previously rendered them as plain BOT bubbles — a real display bug this fixes).

- [ ] **Step 1: Failing API test — draft filter**

In the room-manager spec (find it: `ls apps/api/src/modules/chat-engine/services/*.spec.ts`), add using the suite's existing prisma mock pattern:

```ts
  it('excludes undelivered legacy drafts from recent messages', async () => {
    await service.getRecentMessages('r1', 20);
    expect(prisma.chatMessage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          NOT: { intent: { startsWith: 'DRAFT:' }, deliveredAt: null },
        }),
      }),
    );
  });
```

Run it — expected FAIL (where-clause mismatch).

- [ ] **Step 2: Implement the filter**

In `getRecentMessages`:

```ts
      where: {
        roomId,
        deletedAt: null,
        // WS1: ซ่อน draft เก่าที่ไม่เคยส่งถึงลูกค้า — pipeline ถูกถอดแล้ว
        NOT: { intent: { startsWith: 'DRAFT:' }, deliveredAt: null },
      },
```

Run the spec — PASS.

- [ ] **Step 3: Frontend removal**

- `AssistantSidebar.tsx`: remove `AiDraftCard` import + `useLatestDraft` from the hook import; delete `const { data: draft } = useLatestDraft(roomId);`; delete the entire `{draft ? (<AiDraftCard .../>) : (<Card>...ไม่มีข้อความร่าง...</Card>)}` block. CustomerCard + take-over/release buttons stay.
- Delete `AiDraftCard.tsx`.
- `useAiDraft.ts`: delete `useLatestDraft`, `useApproveDraft`, `useSkipDraft`; in `useTakeOver`/`useReleaseToAi` remove the `['chat-latest-draft', roomId]` invalidation lines; prune now-unused imports (`useQuery`, `approveDraft`, `skipDraft`, `fetchMessages`, `Message`).
- `chat-api.ts`: delete the `approveDraft` + `skipDraft` functions.
- `pages/chat/components/MessageBubble.tsx`: delete `const isDraft = ...`, the `isDraft && 'border-l-4 border-emerald-500 ...'` class line, and the `{isDraft && (<Badge ...>Draft</Badge>)}` block (+ `Badge` import if unused elsewhere in the file).
- `AiSettingsPage.tsx`: delete the `PerBotSettings` interface, the whole `PerBotModeCard` function, and `<PerBotModeCard />` in the page JSX. Remove imports that become unused (check: `Bot` icon and `Select*` are also used by other cards — only remove what the linter flags).

- [ ] **Step 4: Schema deprecation comments**

On the `AiSettings` model fields in `schema.prisma` add above each of `salesBotMode` and `serviceBotMode`:

```prisma
  /// @deprecated WS1 2026-07: draft pipeline retired — ไม่มีผลต่อระบบแล้ว (คงคอลัมน์ไว้ ไม่ migrate)
```

No migration, no `prisma generate` required for comment-only changes (run it anyway if the typecheck complains).

- [ ] **Step 5: Verify + commit**

Run: `./tools/check-types.sh all && npm --prefix apps/web test && cd apps/api && npx jest src/modules/chat-engine`
Expected: PASS (fix any test referencing deleted components)

```bash
git add apps/api apps/web
git commit -m "feat(chat): hide undelivered legacy drafts; remove dead draft UI from inbox + settings"
```

---

### Task 5: Gemini rates in the LLM rate card

**Files:**
- Modify: `apps/api/src/modules/ai-usage/ai-pricing.ts`
- Modify: the pricing spec (find it: `ls apps/api/src/modules/ai-usage/*.spec.ts` — pricing cases live in one of the 4 ai-usage specs)

**Interfaces:**
- Produces: `ratesFor('gemini-2.5-flash')` returns a real rate (not the default). Task 6 depends on this so Gemini calls don't get costed at Sonnet rates.

- [ ] **Step 1: Verify current Gemini pricing**

Check https://ai.google.dev/pricing for `gemini-2.5-flash` text input/output per-1M-token USD prices. The values below are the 2026-07 spec-time snapshot ($0.30 in / $2.50 out) — if the live page differs, use the live numbers in BOTH the constant and the test.

- [ ] **Step 2: Failing test**

```ts
  it('prices gemini-2.5-flash at its own rate, not the Claude default', () => {
    expect(ratesFor('gemini-2.5-flash')).toEqual({ inputPer1M: 0.3, outputPer1M: 2.5 });
    expect(computeCostUsd('gemini-2.5-flash', 1_000_000, 1_000_000)).toBeCloseTo(2.8, 6);
  });
```

Run: FAIL (returns default 3/15).

- [ ] **Step 3: Implement**

In `RATE_CARD` add after the Claude block:

```ts
  // Gemini (SHOP sales-bot alternate provider) — https://ai.google.dev/pricing (snapshot 2026-07)
  'gemini-2.5-flash': { inputPer1M: 0.3, outputPer1M: 2.5 },
```

Update the file's header comment from "Per-model Claude pricing" to "Per-model LLM pricing (Claude + Gemini)".

- [ ] **Step 4: Run + commit**

Run: `cd apps/api && npx jest src/modules/ai-usage` → PASS

```bash
git add apps/api/src/modules/ai-usage
git commit -m "feat(ai-usage): add Gemini rates to the LLM rate card"
```

---

### Task 6: SalesBotService records usage

**Files:**
- Modify: `apps/api/src/modules/sales-bot/sales-bot.service.ts` (constructor ~line 61; three return points at ~lines 132, 141, 177)
- Modify: `apps/api/src/modules/sales-bot/sales-bot.service.spec.ts` (`build()` helper ~line 16; direct-construction at ~line 180)

**Interfaces:**
- Consumes: `AiUsageService.record(entry: UsageRecord)` (`ai-usage.service.ts:46`), global module.
- Produces: every `generateReply` completion writes one `AiUsageLog` row `service='sales-bot'`.

- [ ] **Step 1: Failing test**

In the spec: add to `build()` — `const aiUsage = { record: jest.fn() };`, provider `{ provide: AiUsageService, useValue: aiUsage },` (+ import `AiUsageService` from `'../ai-usage/ai-usage.service'` — relative path `../ai-usage/ai-usage.service` from `sales-bot/`), and `aiUsage` in the returned object. New test:

```ts
  it('records usage via AiUsageService with the provider-reported model', async () => {
    const chat = jest.fn().mockResolvedValue({
      text: 'สวัสดีค่ะ สนใจรุ่นไหนคะ',
      toolCalls: [],
      inputTokens: 120,
      outputTokens: 25,
      modelName: 'claude-sonnet-4-6',
    } satisfies LlmChatResponse);
    const { svc, aiUsage } = await build(chat);
    await svc.generateReply({ text: 'สวัสดี', roomId: 'r1', customerId: null });
    expect(aiUsage.record).toHaveBeenCalledWith({
      service: 'sales-bot',
      method: 'generateReply',
      model: 'claude-sonnet-4-6',
      inputTokens: 120,
      outputTokens: 25,
      status: 'success',
    });
  });
```

Run: FAIL (DI error first — that's expected red).

- [ ] **Step 2: Implement**

- Import: `import { AiUsageService } from '../ai-usage/ai-usage.service';`
- Constructor: append 8th param `private readonly aiUsage: AiUsageService,`
- Private helper:

```ts
  private recordUsage(modelUsed: string, inputTokens: number, outputTokens: number): void {
    void this.aiUsage.record({
      service: 'sales-bot',
      method: 'generateReply',
      model: modelUsed || 'unknown',
      inputTokens,
      outputTokens,
      status: 'success',
    });
  }
```

- Insert `this.recordUsage(modelUsed, totalIn, totalOut);` immediately BEFORE each of the three `return {` statements in `generateReply` (grounding-blocked ~line 132, normal reply ~line 141, max-hops fallback ~line 177).
- Spec gotcha: the `estimateConfidence` describe constructs the service directly with 7 positional `{} as any` args (~line 180) — append an 8th `{} as any, // AiUsageService`.

- [ ] **Step 3: Run + commit**

Run: `cd apps/api && npx jest src/modules/sales-bot` → PASS (all existing tests + new one)

```bash
git add apps/api/src/modules/sales-bot
git commit -m "feat(sales-bot): record token usage/cost to AiUsageLog"
```

---

### Task 7: Instrument ai-suggest, legacy LINE bot, after-hours

**Files:**
- Modify: `apps/api/src/modules/staff-chat/services/ai-suggest.service.ts`
- Modify: `apps/api/src/modules/line-oa/chatbot.service.ts`
- Modify: `apps/api/src/modules/chat-engine/services/after-hours.service.ts`

**Interfaces:**
- Consumes: `AiUsageService` (global). None of these three services currently has its own spec (known repo gap) — this task is verified by typecheck + the full-suite run; the volume path (sales-bot) got test coverage in Task 6.

- [ ] **Step 1: ai-suggest**

Import `AiUsageService`; append constructor param `private aiUsage: AiUsageService,`. Immediately after the `const response = await this.anthropic.messages.create({...});` (~line 59 of the try block):

```ts
      void this.aiUsage.record({
        service: 'ai-suggest',
        method: 'suggest',
        model: this.MODEL,
        inputTokens: response.usage?.input_tokens ?? 0,
        outputTokens: response.usage?.output_tokens ?? 0,
        status: 'success',
      });
```

Mock mode (`!this.anthropic`) returns before this point → no fake cost rows (spec §4.3 requirement).

- [ ] **Step 2: legacy LINE bot**

Import `AiUsageService`; append constructor param `private aiUsage: AiUsageService,`. Add helper:

```ts
  private recordUsage(msg: Anthropic.Message): void {
    void this.aiUsage.record({
      service: 'line-oa-legacy',
      method: 'generateResponse',
      model: ChatbotService.MODEL,
      inputTokens: msg.usage?.input_tokens ?? 0,
      outputTokens: msg.usage?.output_tokens ?? 0,
      status: 'success',
    });
  }
```

Call `this.recordUsage(response);` right after the first `messages.create` resolves, and `this.recordUsage(followUp);` right after the follow-up call (tool-use turns = 2 rows = accurate per-call accounting).

- [ ] **Step 3: after-hours**

Import `AiUsageService`; constructor becomes `(private configService: ConfigService, private aiUsage: AiUsageService)`. Extract the inline model string into `private static readonly MODEL = 'claude-haiku-4-5-20251001';`, use it in `messages.create`, and after the create resolves (before the textBlock handling):

```ts
      void this.aiUsage.record({
        service: 'after-hours',
        method: 'getAutoReply',
        model: AfterHoursService.MODEL,
        inputTokens: response.usage?.input_tokens ?? 0,
        outputTokens: response.usage?.output_tokens ?? 0,
        status: 'success',
      });
```

Static-fallback path (no key / error) records nothing — no tokens were spent.

- [ ] **Step 4: Fix direct constructions if any**

Run: `grep -rn "new AfterHoursService\|new ChatbotService(\|new AiSuggestService" apps/api/src --include="*.ts"`
Append `{} as any` args to any hits (spec files).

- [ ] **Step 5: Verify + commit**

Run: `./tools/check-types.sh api && cd apps/api && npx jest src/modules/staff-chat src/modules/line-oa src/modules/chat-engine`
Expected: PASS

```bash
git add apps/api
git commit -m "feat(ai-usage): instrument ai-suggest, legacy LINE bot, and after-hours calls"
```

---

## WS2 — LINE Shop → SalesBot (staged)

### Task 8: replyToken plumbing + after-hours aiPaused fix

**Files:**
- Modify: `apps/api/src/modules/chat-engine/interfaces/channel-adapter.interface.ts`
- Modify: `apps/api/src/modules/chat-engine/services/message-router.service.ts` (AI send ~line 184; after-hours condition ~245 + send ~252; domain-handler loop ~309)
- Create: `apps/api/src/modules/chat-engine/services/message-router.service.spec.ts`

**Interfaces:**
- Consumes: constructor `MessageRouterService(roomManager, handoffManager, configService, afterHoursService?, aiAutoReplyService?, adapters?, handlers?, gateway?)` — direct instantiation with 5 args is valid for tests.
- Produces: `InboundMessage.replyToken?: string` and `OutboundMessage.replyToken?: string`; `routeInbound` threads the inbound token into the FIRST outbound send of each reply path. Task 9's adapter and Task 10's controller rely on these exact field names.

- [ ] **Step 1: Failing tests (new spec file)**

```ts
import { MessageRouterService } from './message-router.service';
import { ChatChannel, MessageType } from '@prisma/client';

const baseMsg = {
  externalMessageId: 'em1',
  externalUserId: 'U1',
  channel: ChatChannel.LINE_SHOP,
  type: MessageType.TEXT,
  text: 'สนใจ iPhone 15',
  replyToken: 'rt-1',
};

function makeRouter(opts: {
  room?: any;
  aiEligible?: boolean;
  aiResult?: any;
  afterHours?: boolean;
}) {
  const room = opts.room ?? { id: 'r1', handoffMode: false, aiPaused: false, verifiedAt: null };
  const roomManager = {
    getOrCreateRoom: jest.fn().mockResolvedValue(room),
    saveMessage: jest.fn().mockResolvedValue({ id: 'm1' }),
  };
  const handoffManager = { initiateHandoff: jest.fn() };
  const configService = { get: jest.fn().mockReturnValue(undefined) };
  const afterHours = {
    isAfterHours: jest.fn().mockReturnValue(opts.afterHours ?? false),
    getAutoReply: jest.fn().mockResolvedValue('นอกเวลาทำการค่ะ'),
  };
  const aiAutoReply = {
    shouldAutoReply: jest.fn().mockResolvedValue(opts.aiEligible ?? false),
    autoReply: jest.fn().mockResolvedValue(opts.aiResult ?? null),
    logAutoReply: jest.fn().mockResolvedValue(undefined),
  };
  const adapter = {
    channel: ChatChannel.LINE_SHOP,
    sendMessage: jest.fn().mockResolvedValue({ success: true }),
  };
  const router = new MessageRouterService(
    roomManager as any,
    handoffManager as any,
    configService as any,
    afterHours as any,
    aiAutoReply as any,
  );
  router.registerAdapter(adapter as any);
  return { router, adapter, aiAutoReply, afterHours, roomManager };
}

describe('MessageRouterService — replyToken + aiPaused', () => {
  it('threads the inbound replyToken into a confident AI reply', async () => {
    const { router, adapter } = makeRouter({
      aiEligible: true,
      aiResult: { reply: 'มีค่ะ', confidence: 0.9, toolsUsed: [], inputTokens: 1, outputTokens: 1 },
    });
    await router.routeInbound(baseMsg as any);
    expect(adapter.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'มีค่ะ', replyToken: 'rt-1' }),
    );
  });

  it('threads the replyToken into the after-hours reply', async () => {
    const { router, adapter } = makeRouter({ afterHours: true });
    await router.routeInbound(baseMsg as any);
    expect(adapter.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'นอกเวลาทำการค่ะ', replyToken: 'rt-1' }),
    );
  });

  it('does NOT send after-hours reply when staff took over (aiPaused)', async () => {
    const { router, adapter } = makeRouter({
      afterHours: true,
      room: { id: 'r1', handoffMode: false, aiPaused: true, verifiedAt: null },
    });
    await router.routeInbound(baseMsg as any);
    expect(adapter.sendMessage).not.toHaveBeenCalled();
  });
});
```

Run: `cd apps/api && npx jest src/modules/chat-engine/services/message-router.service.spec.ts`
Expected: FAIL (no replyToken threading; after-hours ignores aiPaused)

- [ ] **Step 2: Implement**

Interface additions:

```ts
  /** LINE reply token — ใช้ครั้งเดียว อายุ ~60 วิ; LINE adapters ใช้ reply API (ฟรี) ก่อน fallback เป็น push */
  replyToken?: string;
```

(add the same optional field + comment to BOTH `InboundMessage` and `OutboundMessage`)

`routeInbound` changes:
1. AI-confident send (~line 184): add `replyToken: message.replyToken,` to the `adapter.sendMessage({...})` object.
2. After-hours condition (~line 245): `if (this.afterHoursService?.isAfterHours() && !room.handoffMode && !room.aiPaused) {` — and add `replyToken: message.replyToken,` to its send.
3. Domain-handler loop (~line 309): first reply gets the token —

```ts
        for (const [i, reply] of result.replies.entries()) {
          const sendResult = await adapter.sendMessage({
            ...reply,
            replyToken: i === 0 ? message.replyToken : undefined,
          });
```

(rest of loop body unchanged)

- [ ] **Step 3: Run + commit**

Run: `cd apps/api && npx jest src/modules/chat-engine` → PASS

```bash
git add apps/api/src/modules/chat-engine
git commit -m "feat(chat-engine): thread LINE replyToken through routeInbound; after-hours respects aiPaused"
```

---

### Task 9: LineShopAdapter reply-first delivery

**Files:**
- Modify: `apps/api/src/modules/chat-adapters/line-shop.adapter.ts` (`sendMessage`, ~lines 28-48)
- Create: `apps/api/src/modules/chat-adapters/line-shop.adapter.spec.ts`

**Interfaces:**
- Consumes: `OutboundMessage.replyToken` (Task 8); `LineOaService.replyMessage(replyToken, messages, 'line-shop')` + `pushMessage(to, messages, 'line-shop')` (both `line-oa.service.ts:55-69`, same payload array type).
- Produces: reply-API-first sends for LINE Shop (free) with push fallback (paid quota).

- [ ] **Step 1: Failing tests (new spec file)**

```ts
import { LineShopAdapter } from './line-shop.adapter';

describe('LineShopAdapter.sendMessage', () => {
  const make = () => {
    const lineOa = {
      replyMessage: jest.fn().mockResolvedValue(undefined),
      pushMessage: jest.fn().mockResolvedValue(undefined),
    };
    return { adapter: new LineShopAdapter(lineOa as any), lineOa };
  };
  const base = {
    externalUserId: 'U1',
    channel: 'LINE_SHOP' as any,
    type: 'TEXT' as any,
    text: 'สวัสดีค่ะ',
  };

  it('uses the reply API when replyToken is present', async () => {
    const { adapter, lineOa } = make();
    const res = await adapter.sendMessage({ ...base, replyToken: 'rt-1' });
    expect(lineOa.replyMessage).toHaveBeenCalledWith('rt-1', expect.any(Array), 'line-shop');
    expect(lineOa.pushMessage).not.toHaveBeenCalled();
    expect(res.success).toBe(true);
  });

  it('falls back to push when the reply call fails (token used/expired)', async () => {
    const { adapter, lineOa } = make();
    lineOa.replyMessage.mockRejectedValue(new Error('Invalid reply token'));
    const res = await adapter.sendMessage({ ...base, replyToken: 'rt-expired' });
    expect(lineOa.pushMessage).toHaveBeenCalledWith('U1', expect.any(Array), 'line-shop');
    expect(res.success).toBe(true);
  });

  it('pushes directly when no replyToken', async () => {
    const { adapter, lineOa } = make();
    await adapter.sendMessage(base);
    expect(lineOa.replyMessage).not.toHaveBeenCalled();
    expect(lineOa.pushMessage).toHaveBeenCalled();
  });
});
```

Run → FAIL (replyMessage never called).

- [ ] **Step 2: Implement**

Replace the try-block body of `sendMessage`:

```ts
    try {
      const payload = this.buildLinePayload(message);
      if (!payload) {
        return { success: true };
      }
      // The local LineMessagePayload union covers text/flex/sticker only,
      // but the LINE Messaging API itself accepts image/video/location too.
      // Cast through unknown so the broader payload reaches the API unchanged.
      const messages = [payload as unknown as LineMessagePayload];

      // Reply-token-first: reply API ฟรี, push กินโควต้า plan รายเดือน.
      // Token ใช้ครั้งเดียว/หมดอายุ ~60 วิ — fail แล้ว fallback เป็น push เสมอ
      if (message.replyToken) {
        try {
          await this.lineOaService.replyMessage(message.replyToken, messages, 'line-shop');
          return { success: true };
        } catch (err) {
          this.logger.warn(
            `[LineShopAdapter] reply failed — falling back to push: ${err instanceof Error ? err.message : err}`,
          );
        }
      }

      await this.lineOaService.pushMessage(message.externalUserId, messages, 'line-shop');
      return { success: true };
    } catch (err) {
```

(outer catch unchanged)

- [ ] **Step 3: Run + commit**

Run: `cd apps/api && npx jest src/modules/chat-adapters` → PASS

```bash
git add apps/api/src/modules/chat-adapters
git commit -m "feat(chat-adapters): LINE Shop reply-token-first delivery with push fallback"
```

---

### Task 10: Controller gate — freeform to SalesBot behind the staged rollout

**Files:**
- Modify: `apps/api/src/modules/line-oa/line-oa-chatbot.controller.ts` (`handleTextMessage` ~lines 227-308 restructured; new private methods)
- Create: `apps/api/src/modules/line-oa/line-oa-chatbot.controller.spec.ts`
- Modify: `.env.example` (repo root — the 7KB one)

**Interfaces:**
- Consumes: `AiAutoReplyService.getSettings(): Promise<AiAutoSettings>` (fields `aiAutoEnabled: boolean`, `aiAutoChannels: string[]`) — exported by StaffChatModule, which LineOaModule already forwardRef-imports; `messageRouter.routeInbound` + `InboundMessage.replyToken` (Task 8).
- Produces: env gate `LINE_SHOP_AI_ENABLED` + `LINE_SHOP_AI_WHITELIST_USER_IDS`; the Settings checkbox (`ai.autoChannels` ∋ LINE_SHOP + `ai.autoEnabled`) is the instant kill — any gate miss falls back to the legacy bot, never silence.

- [ ] **Step 1: Failing tests (new spec file)**

```ts
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { LineOaChatbotController } from './line-oa-chatbot.controller';
import { LineOaService } from './line-oa.service';
import { ChatbotService } from './chatbot.service';
import { QuickReplyService } from './quick-reply.service';
import { RichMenuService } from './rich-menu/rich-menu.service';
import { PrismaService } from '../../prisma/prisma.service';
import { PromptPayQrService } from './promptpay/promptpay-qr.service';
import { PaymentLinkService } from './payment-links/payment-link.service';
import { StorageService } from '../storage/storage.service';
import { WebhookDedupService } from '../chatbot-finance/services/webhook-dedup.service';
import { MessageRouterService } from '../chat-engine/services/message-router.service';
import { QuickReplyPostbackRouterService } from '../staff-chat/services/quick-reply-postback-router.service';
import { AiAutoReplyService } from '../staff-chat/services/ai-auto-reply.service';

const makeEvent = (text: string, userId = 'U-test') => ({
  type: 'message' as const,
  replyToken: 'rt-1',
  source: { type: 'user' as const, userId },
  message: { id: 'mid-1', type: 'text' as const, text },
});

describe('LineOaChatbotController — WS2 staged AI gate', () => {
  let controller: LineOaChatbotController;
  let lineOaService: any;
  let chatbotService: any;
  let messageRouter: any;
  let aiAutoReply: any;
  let envValues: Record<string, string | undefined>;

  beforeEach(async () => {
    envValues = {
      LINE_SHOP_AI_ENABLED: 'true',
      LINE_SHOP_AI_WHITELIST_USER_IDS: 'U-test',
    };
    lineOaService = {
      replyMessage: jest.fn().mockResolvedValue(undefined),
      findCustomerByLineId: jest.fn().mockResolvedValue({ name: 'สมชาย', contracts: [] }),
      selfLinkByPhone: jest.fn(),
    };
    chatbotService = { generateResponse: jest.fn().mockResolvedValue('คำตอบจากบอทเก่า') };
    messageRouter = {
      mirrorInbound: jest.fn().mockResolvedValue(undefined),
      routeInbound: jest.fn().mockResolvedValue(undefined),
    };
    aiAutoReply = {
      getSettings: jest
        .fn()
        .mockResolvedValue({ aiAutoEnabled: true, aiAutoChannels: ['LINE_SHOP'] }),
    };

    const mod: TestingModule = await Test.createTestingModule({
      controllers: [LineOaChatbotController],
      providers: [
        { provide: LineOaService, useValue: lineOaService },
        { provide: ChatbotService, useValue: chatbotService },
        { provide: QuickReplyService, useValue: {} },
        { provide: RichMenuService, useValue: {} },
        { provide: PrismaService, useValue: {} },
        { provide: PromptPayQrService, useValue: {} },
        { provide: PaymentLinkService, useValue: {} },
        { provide: StorageService, useValue: {} },
        { provide: WebhookDedupService, useValue: {} },
        { provide: MessageRouterService, useValue: messageRouter },
        { provide: ConfigService, useValue: { get: jest.fn((k: string) => envValues[k]) } },
        { provide: QuickReplyPostbackRouterService, useValue: {} },
        { provide: AiAutoReplyService, useValue: aiAutoReply },
      ],
    }).compile();
    controller = mod.get(LineOaChatbotController);
  });

  const handleText = (text: string, userId?: string) =>
    (controller as any).handleTextMessage(makeEvent(text, userId));

  it('routes whitelisted freeform into routeInbound with replyToken (no mirror, no legacy bot)', async () => {
    await handleText('สนใจ iPhone 15 ครับ');
    expect(messageRouter.routeInbound).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'LINE_SHOP',
        text: 'สนใจ iPhone 15 ครับ',
        replyToken: 'rt-1',
      }),
    );
    expect(messageRouter.mirrorInbound).not.toHaveBeenCalled();
    expect(chatbotService.generateResponse).not.toHaveBeenCalled();
  });

  it('keyword commands keep the legacy deterministic path', async () => {
    await handleText('เช็คยอด');
    expect(messageRouter.routeInbound).not.toHaveBeenCalled();
    expect(messageRouter.mirrorInbound).toHaveBeenCalled();
    expect(lineOaService.replyMessage).toHaveBeenCalled();
  });

  it('non-whitelisted user falls back to the legacy bot', async () => {
    await handleText('สนใจ iPhone', 'U-other');
    expect(messageRouter.routeInbound).not.toHaveBeenCalled();
    expect(chatbotService.generateResponse).toHaveBeenCalled();
    expect(messageRouter.mirrorInbound).toHaveBeenCalled();
  });

  it('LINE_SHOP_AI_ENABLED!=true falls back to the legacy bot', async () => {
    envValues.LINE_SHOP_AI_ENABLED = 'false';
    await handleText('สนใจ iPhone');
    expect(messageRouter.routeInbound).not.toHaveBeenCalled();
    expect(chatbotService.generateResponse).toHaveBeenCalled();
  });

  it('Settings checkbox off (autoChannels without LINE_SHOP) falls back to the legacy bot', async () => {
    aiAutoReply.getSettings.mockResolvedValue({ aiAutoEnabled: true, aiAutoChannels: ['FACEBOOK'] });
    await handleText('สนใจ iPhone');
    expect(messageRouter.routeInbound).not.toHaveBeenCalled();
    expect(chatbotService.generateResponse).toHaveBeenCalled();
  });

  it('getSettings failure falls back to the legacy bot (never silence)', async () => {
    aiAutoReply.getSettings.mockRejectedValue(new Error('db down'));
    await handleText('สนใจ iPhone');
    expect(messageRouter.routeInbound).not.toHaveBeenCalled();
    expect(chatbotService.generateResponse).toHaveBeenCalled();
  });
});
```

Run → FAIL (DI: controller doesn't take AiAutoReplyService yet).

- [ ] **Step 2: Implement the controller restructure**

Add imports: `import { AiAutoReplyService } from '../staff-chat/services/ai-auto-reply.service';` and append constructor param `private aiAutoReply: AiAutoReplyService,`.

Replace `handleTextMessage` with:

```ts
  private async handleTextMessage(event: LineMessageEvent): Promise<void> {
    if (event.message.type !== 'text') return;
    const text = event.message.text.trim();
    const textLower = text.toLowerCase();
    const userId = event.source.userId;

    // Owner self-register (pre-filter)
    if (textLower === '#owner') {
      await this.mirrorText(event, text);
      await this.handleOwnerRegister(userId, event.replyToken);
      return;
    }

    // Self-link by phone — legacy fall-through: เบอร์ที่ link ไม่สำเร็จแต่ user
    // เคย link แล้ว จะไหลต่อเป็นข้อความปกติ (mirror ไปแล้ว)
    let alreadyMirrored = false;
    if (/^0\d{9}$/.test(text)) {
      await this.mirrorText(event, text);
      alreadyMirrored = true;
      const handled = await this.handleSelfLinkByPhone(userId, text, event.replyToken);
      if (handled) return;
    }

    // Deterministic keyword commands (ฟรี ไม่ใช้ AI — เส้นทางเดิมทุกประการ)
    const command = this.matchCommand(textLower, userId, event.replyToken);
    if (command) {
      if (!alreadyMirrored) await this.mirrorText(event, text);
      await command();
      return;
    }

    // Freeform → WS2 staged gate. ผ่าน gate → routeInbound บันทึกข้อความเอง
    // (ห้าม mirror ก่อน ไม่งั้น save ซ้ำ). Edge: phone fall-through ที่ mirror
    // ไปแล้ว → ใช้ legacy เพื่อเลี่ยง double-save
    if (!alreadyMirrored && (await this.shouldRouteToSalesAi(userId))) {
      await this.messageRouter.routeInbound({
        externalMessageId: event.message.id,
        externalUserId: userId,
        channel: ChatChannel.LINE_SHOP,
        type: MessageType.TEXT,
        text,
        replyToken: event.replyToken,
      });
      return;
    }

    if (!alreadyMirrored) await this.mirrorText(event, text);
    await this.handleFreeformMessage(text, event.replyToken, userId);
  }
```

New private methods (bodies of `handleOwnerRegister`/`handleSelfLinkByPhone` are the EXISTING inline blocks from old lines 247-281, moved verbatim — reply texts unchanged):

```ts
  private async mirrorText(event: LineMessageEvent, text: string): Promise<void> {
    if (event.message.type !== 'text') return;
    try {
      await this.messageRouter.mirrorInbound({
        externalMessageId: event.message.id,
        externalUserId: event.source.userId,
        channel: ChatChannel.LINE_SHOP,
        type: MessageType.TEXT,
        text,
      });
    } catch (err) {
      this.logger.warn(`[SHOP mirror] text: ${err instanceof Error ? err.message : err}`);
    }
  }

  private async handleOwnerRegister(userId: string, replyToken: string): Promise<void> {
    try {
      await this.prisma.systemConfig.upsert({
        where: { key: 'owner_line_id' },
        create: { key: 'owner_line_id', value: userId, label: 'LINE User ID เจ้าของ' },
        update: { value: userId },
      });
      await this.lineOaService.replyMessage(replyToken, [
        { type: 'text', text: `บันทึก Owner LINE ID เรียบร้อยแล้วค่ะ\n\nUser ID: ${userId}\n\nตอนนี้สามารถใช้ "ส่งทดสอบ" จากหน้าตั้งค่า LINE OA ได้เลยค่ะ` },
      ], 'line-shop');
    } catch {
      await this.lineOaService.replyMessage(replyToken, [
        { type: 'text', text: 'ไม่สามารถบันทึกได้ กรุณาลองใหม่อีกครั้ง' },
      ], 'line-shop');
    }
  }

  /** @returns true = จบ flow แล้ว (ตอบลูกค้าไปแล้ว), false = fall through เป็นข้อความปกติ */
  private async handleSelfLinkByPhone(
    userId: string,
    phone: string,
    replyToken: string,
  ): Promise<boolean> {
    const result = await this.lineOaService.selfLinkByPhone(userId, phone);
    if (result.success && result.customerName) {
      await this.lineOaService.replyMessage(replyToken, [
        { type: 'text', text: `ผูกบัญชีสำเร็จค่ะ คุณ${result.customerName} 🎉\n\nตอนนี้สามารถใช้คำสั่งต่างๆ ได้แล้วค่ะ:\n• "เช็คยอด" - ดูยอดค้างชำระ\n• "งวด" - ดูตารางค่างวด\n• "ชำระ" - ชำระเงิน` },
      ], 'line-shop');
      return true;
    }
    const existing = await this.lineOaService.findCustomerByLineId(userId);
    if (!existing) {
      await this.lineOaService.replyMessage(replyToken, [
        { type: 'text', text: 'ไม่พบข้อมูลเบอร์โทรนี้ในระบบค่ะ กรุณาตรวจสอบเบอร์โทร หรือติดต่อสาขาเพื่อลงทะเบียน' },
      ], 'line-shop');
      return true;
    }
    return false;
  }

  /** จับคู่ keyword commands — ลำดับการเช็คต้องตรงกับ if-chain เดิมเป๊ะ */
  private matchCommand(
    textLower: string,
    userId: string,
    replyToken: string,
  ): (() => Promise<void>) | null {
    if (['ยอด', 'เช็คยอด', 'ยอดค้าง', 'balance'].includes(textLower))
      return () => this.handleCheckBalance(userId, replyToken);
    if (['งวด', 'ตารางงวด', 'installment'].includes(textLower))
      return () => this.handleCheckInstallments(userId, replyToken);
    if (['ชำระ', 'จ่าย', 'pay', 'payment'].includes(textLower))
      return () => this.handlePaymentRequest(userId, replyToken);
    if (['ใบเสร็จ', 'receipt'].includes(textLower))
      return () => this.handleReceipt(userId, replyToken);
    if (['ติดต่อ', 'contact'].includes(textLower))
      return () => this.handleContact(userId, replyToken);
    if (['สัญญา', 'contract'].includes(textLower))
      return () => this.handleContractLink(userId, replyToken);
    if (['ลงทะเบียน', 'register', 'สมัคร'].includes(textLower))
      return () => this.handleRegisterLink(userId, replyToken);
    if (['ช่วยเหลือ', 'help', 'เมนู', 'menu'].includes(textLower))
      return () => this.handleHelp(replyToken);
    if (GREETING_KEYWORDS.some((kw) => textLower.includes(kw)))
      return () => this.handleGreeting(replyToken);
    if (ANDROID_KEYWORDS.some((kw) => textLower.includes(kw)))
      return () => this.handleAndroidRedirect(replyToken);
    if (IPAD_USED_KEYWORDS.some((kw) => textLower.includes(kw)))
      return () => this.handleIpadUsedRedirect(replyToken);
    return null;
  }

  /**
   * WS2 staged gate — ต้องผ่านครบ 3 ชั้น: env master switch, env whitelist,
   * และ Settings ของเจ้าของ (ai.autoEnabled + LINE_SHOP ใน ai.autoChannels =
   * instant kill, มีผลใน ~60 วิ ไม่ต้อง deploy). พลาดชั้นไหน → บอทเก่า ไม่มีทางเงียบ
   */
  private async shouldRouteToSalesAi(userId: string): Promise<boolean> {
    if (this.configService.get<string>('LINE_SHOP_AI_ENABLED') !== 'true') return false;
    const whitelist = (this.configService.get<string>('LINE_SHOP_AI_WHITELIST_USER_IDS') ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (whitelist.length > 0 && !whitelist.includes(userId)) return false;
    try {
      const settings = await this.aiAutoReply.getSettings();
      return settings.aiAutoEnabled && settings.aiAutoChannels.includes('LINE_SHOP');
    } catch (err) {
      this.logger.warn(
        `[ShopAI gate] getSettings failed — falling back to legacy bot: ${err instanceof Error ? err.message : err}`,
      );
      return false;
    }
  }
```

- [ ] **Step 3: .env.example**

Append to the repo-root `.env.example`:

```
# WS2 — LINE Shop → SalesBot staged rollout (spec 2026-07-02-ai-reply-consolidation)
# instant kill ตัวจริงคือ checkbox LINE Shop ใน /settings/ai/assistant (ai.autoChannels)
LINE_SHOP_AI_ENABLED=false
LINE_SHOP_AI_WHITELIST_USER_IDS=
```

- [ ] **Step 4: Run + commit**

Run: `cd apps/api && npx jest src/modules/line-oa && ./tools/check-types.sh api` (second command from repo root)
Expected: PASS — all 6 new tests + existing line-oa suites

```bash
git add apps/api .env.example
git commit -m "feat(line-oa): staged gate routes LINE Shop freeform into the SalesBot pipeline"
```

---

## WS3 — Embedding backfill

### Task 11: Nightly embedding backfill cron

**Files:**
- Create: `apps/api/src/modules/staff-chat/cron/embedding-backfill.cron.ts`
- Create: `apps/api/src/modules/staff-chat/cron/embedding-backfill.cron.spec.ts`
- Modify: `apps/api/src/modules/staff-chat/staff-chat.module.ts` (providers array — add `EmbeddingBackfillCron` + import)
- Modify: `apps/api/src/modules/staff-chat/staff-chat.controller.ts` (manual trigger endpoint + constructor injection)
- Modify: `apps/api/src/modules/staff-chat/staff-chat.controller.spec.ts` (add `{ provide: EmbeddingBackfillCron, useValue: {} }`)

**Interfaces:**
- Consumes: `EmbeddingService.isReady(): boolean`, `.getModel(): string`, `.embedBatch(texts: string[], 'RETRIEVAL_DOCUMENT'): Promise<number[][]>`, `.toPgvector(v: number[]): string` (all in `staff-chat/services/embedding.service.ts`); DB columns `ai_training_pairs.embedding vector(768)`, `embedding_model`, `embedded_at`.
- Produces: `EmbeddingBackfillCron.backfillEmbeddings(): Promise<{ embedded: number }>` — runs 03:30 BKK (after training-extract at 03:00); manual trigger `POST /staff-chat/ai/embedding-backfill` (OWNER).

- [ ] **Step 1: Failing tests (new spec file)**

```ts
import { EmbeddingBackfillCron } from './embedding-backfill.cron';

describe('EmbeddingBackfillCron', () => {
  const makeEmbedding = (ready = true) => ({
    isReady: jest.fn().mockReturnValue(ready),
    getModel: jest.fn().mockReturnValue('text-multilingual-embedding-002'),
    embedBatch: jest.fn().mockResolvedValue([[0.1, 0.2]]),
    toPgvector: jest.fn((v: number[]) => `[${v.join(',')}]`),
  });

  it('skips entirely when the embedding service is not ready', async () => {
    const prisma = { $queryRaw: jest.fn(), $executeRaw: jest.fn() };
    const cron = new EmbeddingBackfillCron(prisma as any, makeEmbedding(false) as any);
    const res = await cron.backfillEmbeddings();
    expect(res.embedded).toBe(0);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('embeds null-embedding rows in batches and stops when drained', async () => {
    const prisma = {
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([
          { id: 'a', customer_message: 'ผ่อนยังไง' },
          { id: 'b', customer_message: 'ร้านอยู่ไหน' },
        ])
        .mockResolvedValueOnce([]),
      $executeRaw: jest.fn().mockResolvedValue(1),
    };
    const embedding = makeEmbedding();
    embedding.embedBatch.mockResolvedValue([[0.1], [0.2]]);
    const cron = new EmbeddingBackfillCron(prisma as any, embedding as any);
    const res = await cron.backfillEmbeddings();
    expect(embedding.embedBatch).toHaveBeenCalledWith(
      ['ผ่อนยังไง', 'ร้านอยู่ไหน'],
      'RETRIEVAL_DOCUMENT',
    );
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(2);
    expect(res.embedded).toBe(2);
  });

  it('returns the partial count when a batch throws (Sentry captured, no crash)', async () => {
    const prisma = {
      $queryRaw: jest.fn().mockResolvedValueOnce([{ id: 'a', customer_message: 'x' }]),
      $executeRaw: jest.fn(),
    };
    const embedding = makeEmbedding();
    embedding.embedBatch.mockRejectedValue(new Error('vertex down'));
    const cron = new EmbeddingBackfillCron(prisma as any, embedding as any);
    const res = await cron.backfillEmbeddings();
    expect(res.embedded).toBe(0);
  });
});
```

Run → FAIL (module not found).

- [ ] **Step 2: Implement the cron (full file)**

```ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../../../prisma/prisma.service';
import { EmbeddingService } from '../services/embedding.service';

const EMBED_BATCH = 100;
// กัน runaway คืนแรกที่ backfill ของเก่าทั้งหมด — ทยอยจบเอง หรือยิง manual trigger ซ้ำได้
const NIGHTLY_CAP = 5000;

/**
 * WS3 — เติม embedding ให้ AiTrainingPair ที่ยังไม่มี (pairs จาก feedback/cron/import
 * ถูกสร้างแบบไม่มี embedding — semantic retrieval เลยมองไม่เห็นข้อมูลใหม่)
 * รัน 03:30 BKK หลัง training-extract (03:00) จบ
 */
@Injectable()
export class EmbeddingBackfillCron {
  private readonly logger = new Logger(EmbeddingBackfillCron.name);

  constructor(
    private prisma: PrismaService,
    private embedding: EmbeddingService,
  ) {}

  @Cron('30 3 * * *', { timeZone: 'Asia/Bangkok' })
  async backfillEmbeddings(): Promise<{ embedded: number }> {
    if (!this.embedding.isReady()) {
      this.logger.warn('Embedding service not ready (GOOGLE_CLOUD_PROJECT unset) — skip backfill');
      return { embedded: 0 };
    }

    let embedded = 0;
    try {
      while (embedded < NIGHTLY_CAP) {
        const batchSize = Math.min(EMBED_BATCH, NIGHTLY_CAP - embedded);
        const rows = await this.prisma.$queryRaw<{ id: string; customer_message: string }[]>`
          SELECT id, customer_message
          FROM ai_training_pairs
          WHERE embedding IS NULL
          ORDER BY created_at ASC
          LIMIT ${batchSize}
        `;
        if (rows.length === 0) break;

        const vectors = await this.embedding.embedBatch(
          rows.map((r) => r.customer_message),
          'RETRIEVAL_DOCUMENT',
        );
        const model = this.embedding.getModel();

        for (let i = 0; i < rows.length; i++) {
          await this.prisma.$executeRaw`
            UPDATE ai_training_pairs
            SET embedding = ${this.embedding.toPgvector(vectors[i])}::vector,
                embedding_model = ${model},
                embedded_at = NOW()
            WHERE id = ${rows[i].id}
          `;
        }

        embedded += rows.length;
        this.logger.log(`Embedded ${embedded} training pairs so far`);
      }

      this.logger.log(`Embedding backfill done: ${embedded} pairs`);
      return { embedded };
    } catch (error) {
      this.logger.error('Embedding-backfill cron failed', error);
      Sentry.captureException(error, {
        tags: { kind: 'cron-job', cron: 'embedding-backfill' },
      });
      return { embedded };
    }
  }
}
```

- [ ] **Step 3: Register + manual trigger**

- `staff-chat.module.ts`: import `EmbeddingBackfillCron` from `'./cron/embedding-backfill.cron'`; append to the providers array (next to `TrainingExtractCron`).
- `staff-chat.controller.ts`: inject `private embeddingBackfillCron: EmbeddingBackfillCron` and add next to the existing `ai/training-extract` endpoint (~line 708):

```ts
  @Post('ai/embedding-backfill')
  @Roles('OWNER')
  async triggerEmbeddingBackfill() {
    return this.embeddingBackfillCron.backfillEmbeddings();
  }
```

- `staff-chat.controller.spec.ts`: add `{ provide: EmbeddingBackfillCron, useValue: {} },` to the provider stubs (~line 80).

- [ ] **Step 4: Run + commit**

Run: `cd apps/api && npx jest src/modules/staff-chat && ./tools/check-types.sh api` (second from repo root)
Expected: PASS

```bash
git add apps/api
git commit -m "feat(staff-chat): nightly embedding backfill cron for AiTrainingPairs"
```

---

### Task 12: Full verification sweep

**Files:** none (verification only; fix-forward anything that breaks)

- [ ] **Step 1: Full typecheck**

Run: `./tools/check-types.sh all`
Expected: 0 errors both apps

- [ ] **Step 2: Full API + web test suites**

Run: `cd apps/api && npx jest` then `npm --prefix apps/web test`
Expected: all green. Likely follow-ups if red: spec stubs referencing removed providers (`ChatAiDraftService` deps, `ChatIntentRouterService`), or web tests importing deleted components — fix by removing the stale references, not by re-adding code.

- [ ] **Step 3: Grep sweep for stragglers**

Run: `grep -rn "chat-intent-router\|generateDraft\|approveDraft\|skipDraft\|useLatestDraft\|AiDraftCard\|PerBotModeCard\|isInHandoffMode" apps --include="*.ts" --include="*.tsx" | grep -v node_modules | grep -v dist`
Expected: no output (docs/ hits are fine).

- [ ] **Step 4: Commit any fixes + report**

```bash
git add -A && git commit -m "chore(ai): verification sweep fixes for AI reply consolidation" || echo "nothing to fix"
```

Then report per `superpowers:verification-before-completion` — include actual command outputs.

**Post-merge rollout runbook (owner actions, not code):**
1. Deploy — env unset ⇒ behavior identical to today.
2. In `/settings/ai/assistant`: enable checkbox LINE Shop in AI Auto Mode channels (ai.autoChannels).
3. Set Cloud Run env `LINE_SHOP_AI_ENABLED=true` + `LINE_SHOP_AI_WHITELIST_USER_IDS=<team LINE userIds>`.
4. Team tests via real LINE; watch `/settings/ai/admin` (cost) + AiAutoReplyLog (confidence/handoffs). (หมายเหตุ: cap ต่อห้องนับตลอดอายุห้องและไม่ reset ตอน release/take-over — ถ้าทดสอบแล้วบอทเงียบ ให้เช็ค AiAutoReplyLog ว่าชน cap ก่อนสรุปว่า bug; ปรับ ai.autoMaxRepliesPerSession ได้จากหน้า Settings)
5. Widen whitelist → clear it (= everyone). Instant kill anytime = uncheck the LINE Shop checkbox (~60s, no deploy).
6. Final separate PR (not in this plan): delete `line-oa/chatbot.service.ts`, `handleFreeformMessage`, the gate envs; run `POST /staff-chat/ai/embedding-backfill` once if the nightly cap is still draining the backlog.
