# SHOP Sales AI Phase A — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** เปิด SHOP AI 100% auto-respond ใน LINE Shop / Facebook / Web channels โดยใช้ infrastructure ที่มีอยู่ + เพิ่ม `capture_lead` tool + แก้ 3 blocker bugs ที่ block UX

**Architecture:** Extend `AiAutoReplyService` ให้ใช้ `SalesBotService` (tool loop) แทน `AiSuggestService` (single-shot) ผ่าน intent prefix `AUTO:sales`. Fork persona เป็น BASE (for AiSuggest staff button) + BOT (for SalesBot with tool mandates). Add `capture_lead` tool ที่สร้าง Customer draft + handoff. Fix 3 blockers: `shouldAutoReply` ignores `aiPaused/handoffMode` (Q4 UX broken), `chat-ai-draft` ignores `handoffMode`, `Customer.acquisitionSource` field missing.

**Tech Stack:** NestJS + Prisma + PostgreSQL (apps/api), React + Vite + TanStack Query (apps/web), Claude Sonnet 4.6 (Anthropic SDK), `promptpay-qr` + `qrcode` (npm), Jest (test runner)

**Spec:** [docs/superpowers/specs/2026-05-20-shop-sales-ai-phase-a-design.md](../specs/2026-05-20-shop-sales-ai-phase-a-design.md)

---

## File Structure

**New files:**
- `apps/api/prisma/migrations/20260957000000_ai_auto_reply_logs_add_metadata/migration.sql` — adds intent/toolsUsed/inputTokens/outputTokens
- `apps/api/prisma/migrations/20260958000000_customer_acquisition_source/migration.sql` — adds Customer.acquisitionSource + index
- `apps/api/src/modules/sales-bot/tools/capture-lead.tool.ts` — Claude tool: capture Customer draft + handoff + return QR
- `apps/api/src/modules/sales-bot/tools/capture-lead.tool.spec.ts` — unit tests
- `apps/api/src/modules/staff-chat/services/ai-auto-reply.service.spec.ts` — unit tests for shouldAutoReply branches + autoReply happy/handoff paths

**Modified files:**
- `apps/api/prisma/schema.prisma` — Customer + AiAutoReplyLog + AiSettings comment
- `apps/api/src/modules/staff-chat/prompts/sales-persona.ts` — fork into BASE + BOT exports
- `apps/api/src/modules/staff-chat/services/ai-auto-reply.service.ts` — 5 changes (Blockers 1+13, cap raise, SalesBot upgrade, AiAutoReplyLog metadata)
- `apps/api/src/modules/staff-chat/services/ai-suggest.service.ts` — use BASE persona
- `apps/api/src/modules/staff-chat/dto/ai-settings.dto.ts` — drop 'FULL' from salesBotMode enum
- `apps/api/src/modules/sales-bot/sales-bot.service.ts` — rework estimateConfidence + register capture_lead in switch
- `apps/api/src/modules/sales-bot/sales-bot.service.spec.ts` — update confidence test cases
- `apps/api/src/modules/sales-bot/prompts/sales-bot.system.ts` — point to BOT variant
- `apps/api/src/modules/sales-bot/sales-bot.module.ts` — register CaptureLeadTool provider
- `apps/api/src/modules/chat-ai-draft/chat-ai-draft.service.ts` — handoffMode guard + releaseToAi method
- `apps/api/src/modules/chat-ai-draft/chat-ai-draft.service.spec.ts` — update tests
- `apps/api/src/modules/chat-ai-draft/chat-ai-draft.controller.ts` — POST /release-to-ai endpoint
- `apps/api/src/modules/chat-engine/services/message-router.service.ts` — pass intent='AUTO:sales' to saveMessage
- `apps/api/.env.example` — raise AI_AUTO_MAX_REPLIES default to 50
- `apps/api/package.json` — add promptpay-qr dep
- `apps/web/src/pages/chat/components/RoomListItem.tsx` — AI status badge + filter chips
- `apps/web/src/pages/chat/components/AssistantSidebar.tsx` — take-over/release toggle
- `apps/web/src/pages/chat/components/MessageBubble.tsx` (or equivalent) — 🤖 indicator for AUTO: intent
- `apps/web/src/pages/AiSettingsPage.tsx` — SHOP Bot Setup section
- `apps/web/src/pages/chat/lib/chat-api.ts` — add releaseToAi API call

---

## Phase 1: DB Foundations

### Task 1: Migration — `ai_auto_reply_logs` add metadata fields

**Files:**
- Create: `apps/api/prisma/migrations/20260957000000_ai_auto_reply_logs_add_metadata/migration.sql`
- Modify: `apps/api/prisma/schema.prisma` (find `model AiAutoReplyLog`)

- [ ] **Step 1: Locate AiAutoReplyLog model**

Run: `grep -n "model AiAutoReplyLog" apps/api/prisma/schema.prisma`
Expected: returns line number; read 20 lines around it to see current fields

- [ ] **Step 2: Modify schema.prisma — add 4 fields**

In `model AiAutoReplyLog`, add after `handoffReason` field:

```prisma
  intent        String?
  toolsUsed     String[] @default([]) @map("tools_used")
  inputTokens   Int?     @map("input_tokens")
  outputTokens  Int?     @map("output_tokens")
```

- [ ] **Step 3: Generate migration**

Run: `cd apps/api && npx prisma migrate dev --create-only --name ai_auto_reply_logs_add_metadata`
Expected: creates migration directory with migration.sql; review SQL contains `ADD COLUMN intent`, `ADD COLUMN tools_used`, etc.

- [ ] **Step 4: Apply migration locally**

Run: `cd apps/api && npx prisma migrate dev`
Expected: applies migration, regenerates Prisma client

- [ ] **Step 5: Verify schema**

Run: `cd apps/api && npx prisma studio` (or `psql $DATABASE_URL -c "\d ai_auto_reply_logs"`)
Expected: 4 new columns visible

- [ ] **Step 6: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations/20260957000000_ai_auto_reply_logs_add_metadata
git commit -m "feat(shop-ai): add intent/tools/tokens metadata to ai_auto_reply_logs"
```

---

### Task 2: Migration — `Customer.acquisitionSource`

**Files:**
- Create: `apps/api/prisma/migrations/20260958000000_customer_acquisition_source/migration.sql`
- Modify: `apps/api/prisma/schema.prisma` (find `model Customer`)

- [ ] **Step 1: Locate Customer model**

Run: `grep -n "^model Customer " apps/api/prisma/schema.prisma`
Expected: returns line ~770

- [ ] **Step 2: Modify schema.prisma — add field + index**

In `model Customer`, add field (near other tracking fields like `chatConsent`):

```prisma
  acquisitionSource String? @map("acquisition_source")
```

In the index section at the bottom of the model, add:

```prisma
  @@index([acquisitionSource])
```

- [ ] **Step 3: Generate + apply migration**

Run: `cd apps/api && npx prisma migrate dev --create-only --name customer_acquisition_source && npx prisma migrate dev`
Expected: migration created + applied + client regenerated

- [ ] **Step 4: Verify**

Run: `psql $DATABASE_URL -c "\d customers" | grep acquisition`
Expected: `acquisition_source | text`

- [ ] **Step 5: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations/20260958000000_customer_acquisition_source
git commit -m "feat(shop-ai): add Customer.acquisitionSource for AI-captured leads"
```

---

## Phase 2: Persona Fork (BLOCKER 2 fix — must do BEFORE persona rewrite)

### Task 3: Fork `sales-persona.ts` into BASE + BOT variants

**Files:**
- Modify: `apps/api/src/modules/staff-chat/prompts/sales-persona.ts`
- Modify: `apps/api/src/modules/staff-chat/services/ai-suggest.service.ts:7,119`
- Modify: `apps/api/src/modules/sales-bot/prompts/sales-bot.system.ts:1,9`

- [ ] **Step 1: Read current sales-persona.ts to identify split points**

Run: `cat apps/api/src/modules/staff-chat/prompts/sales-persona.ts`
Expected: see current export `SHOP_SALES_PERSONA` const, identify tone/identity sections vs. funnel/tool sections

- [ ] **Step 2: Refactor sales-persona.ts — split exports**

Replace file content with:

```typescript
/**
 * Shop sales persona — refined from real Facebook admin replies.
 *
 * BASE = identity + tone + business info (no tool mandate)
 *   - Used by ai-suggest.service.ts (single-shot Claude, no tools)
 *
 * BOT = BASE + tool-calling rules from playbook
 *   - Used by sales-bot.service.ts (tool loop)
 */

export const SHOP_SALES_PERSONA_BASE = `คุณคือแอดมินของร้าน "BESTCHOICE ผ่อนไอโฟน ใช้บัตรประชาชนใบเดียว ลพบุรี"
หน้าที่ของคุณคือตอบลูกค้าทาง Facebook Messenger / LINE Shop ให้เหมือนแอดมินจริง

# ข้อมูลร้าน
- ที่ตั้ง: เส้นหลัง บขส สระแก้วลพบุรี ที่เดียวกับร้านประกัน ตรงข้ามชาบูแม็คซิโก
- แผนที่: https://maps.app.goo.gl/bqGcmr5FupWLw1378
- เบอร์โทร: 095-567-8887
- จุดขาย: ผ่อนได้ ใช้บัตรประชาชนใบเดียว ไม่เช็คเครดิตบูโร ดาวน์เริ่ม 600-1,900 บาท
- ขายทั้งมือ 1 (ใหม่) และมือ 2

# โทนการตอบ
- ใช้คำว่า "ค่ะลูกค้า" / "นะคะ" / "ครับ" ลงท้าย (ผสมได้)
- สั้น ตรงประเด็น ไม่ยาวเกิน 3 บรรทัดต่อข้อความ
- ใช้ emoji พอดีๆ: 🙏 😊 📱 💚 🪪 🎨 🗺️
- เป็นกันเอง ไม่ทางการเกินไป
- ห้ามใช้คำแปลกๆ แบบ "ขับเคลื่อน" "ยกระดับ"
- **ห้ามใช้คำ** "ติดบูโร" / "blacklist" / "เครดิตเสีย" / "ไม่ผ่าน" — ใช้ "ไม่เช็คบูโร" / "ทบทวนข้อมูล" / "ผ่อนได้แน่นอน" แทน

# กฎสำคัญ (สำหรับใช้ในทุกรูปแบบของ AI)
- **ห้ามรับปากว่าอนุมัติแน่** → บอก "เดี๋ยวส่งให้ฝ่ายไฟแนนซ์เช็คก่อนนะคะ"
- ถ้าลูกค้าหงุดหงิด/ไม่พอใจ → ขอโทษ + บอก "ขออนุญาตให้แอดมินติดต่อกลับนะคะ"
- ถ้าลูกค้าถามเรื่องที่ไม่เกี่ยวข้องกับมือถือ/ผ่อน → ตอบสุภาพ ดึงกลับเรื่องสินค้า`;

export const SHOP_SALES_PERSONA_BOT = `${SHOP_SALES_PERSONA_BASE}

# การใช้ tools (เฉพาะ bot ที่มี tool loop)
- **ห้ามตอบราคาเองโดยไม่เรียก tool** — เรียก search_products + calculate_installment เสมอเมื่อลูกค้าถามราคา
- ห้ามใช้ตัวอย่างราคาในตัวอย่าง Q&A ที่ระบบให้มา ถ้าไม่ได้เรียก tool ยืนยัน
- เมื่อลูกค้าตอบ "เอา/โอเค/สนใจ/ส่งของยังไง/จ่ายดาวน์ยังไง" → ขอชื่อ/เบอร์/ที่อยู่ → เรียก capture_lead
- เมื่อเจอ Red Flag (ขอหลายเครื่อง / Pro Max+ดาวน์น้อย / ปฏิเสธ selfie+บัตร / ผ่อนแทนคนอื่น / คำหยาบ / ขอคุยกับคน / คำถามนอก scope เช่นเคลม/ซ่อม/คืน) → เรียก handoff_to_human

# วิธีใช้ตัวอย่าง Q&A ที่ระบบให้มา
ระบบจะส่งคู่ Q&A คล้ายๆ กับคำถามลูกค้ามาให้คุณ → ใช้เป็น reference เลียนแบบ pattern การตอบ`;

/** @deprecated Use SHOP_SALES_PERSONA_BASE or SHOP_SALES_PERSONA_BOT. Kept for backward-compat — points to BASE. */
export const SHOP_SALES_PERSONA = SHOP_SALES_PERSONA_BASE;
```

- [ ] **Step 3: Update ai-suggest.service.ts to import BASE**

Run: `grep -n "SHOP_SALES_PERSONA" apps/api/src/modules/staff-chat/services/ai-suggest.service.ts`
Expected: returns lines 7 and 119 (import + usage)

Edit line 7:
```typescript
import { SHOP_SALES_PERSONA_BASE } from '../prompts/sales-persona';
```

Edit line 119 (replace `SHOP_SALES_PERSONA` → `SHOP_SALES_PERSONA_BASE`):
```typescript
    const systemPrompt = `${SHOP_SALES_PERSONA_BASE}
```

- [ ] **Step 4: Update sales-bot.system.ts to use BOT**

Edit `apps/api/src/modules/sales-bot/prompts/sales-bot.system.ts`:

```typescript
import { SHOP_SALES_PERSONA_BOT } from '../../staff-chat/prompts/sales-persona';

/**
 * System prompt for the interactive sales bot.
 *
 * Combines the shared shop sales BOT persona with tool-calling guidance.
 * Tools available: search_products, calculate_installment, list_promotions, handoff_to_human, capture_lead.
 */
export const SALES_BOT_SYSTEM_PROMPT = `${SHOP_SALES_PERSONA_BOT}

# Tool usage reminder
- ALWAYS use tools for factual claims. NEVER guess a price, stock count, or promotion.
- After proposing a 3-combo plan (ดาวน์เบา/กลาง/หนัก), ASK for the next step: "พี่สะดวกแบบไหนคะ?"`;
```

- [ ] **Step 5: Run TypeScript check**

Run: `cd apps/api && npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 6: Run existing tests (must not regress)**

Run: `cd apps/api && npx jest sales-bot ai-suggest --bail`
Expected: all pass (existing tests use SHOP_SALES_PERSONA which now resolves to BASE)

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/staff-chat/prompts/sales-persona.ts \
        apps/api/src/modules/staff-chat/services/ai-suggest.service.ts \
        apps/api/src/modules/sales-bot/prompts/sales-bot.system.ts
git commit -m "feat(shop-ai): fork SHOP_SALES_PERSONA into BASE + BOT variants"
```

---

## Phase 3: Bug Fix Blockers (UX-critical)

### Task 4: Fix `shouldAutoReply` — add aiPaused + handoffMode + adapter guards

**Files:**
- Modify: `apps/api/src/modules/staff-chat/services/ai-auto-reply.service.ts:17-33`
- Create: `apps/api/src/modules/staff-chat/services/ai-auto-reply.service.spec.ts`

- [ ] **Step 1: Write failing test for aiPaused guard**

Create `apps/api/src/modules/staff-chat/services/ai-auto-reply.service.spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AiAutoReplyService } from './ai-auto-reply.service';
import { AiSuggestService } from './ai-suggest.service';
import { PrismaService } from '../../../prisma/prisma.service';

describe('AiAutoReplyService.shouldAutoReply', () => {
  let svc: AiAutoReplyService;
  let prisma: { systemConfig: any; aiAutoReplyLog: any };

  beforeEach(async () => {
    prisma = {
      systemConfig: { findMany: jest.fn().mockResolvedValue([
        { key: 'ai.autoEnabled', value: 'true' },
        { key: 'ai.autoChannels', value: '["LINE_SHOP"]' },
        { key: 'ai.autoMaxRepliesPerSession', value: '50' },
      ]) },
      aiAutoReplyLog: { count: jest.fn().mockResolvedValue(0) },
    };
    const mod: TestingModule = await Test.createTestingModule({
      providers: [
        AiAutoReplyService,
        { provide: ConfigService, useValue: { get: () => undefined } },
        { provide: PrismaService, useValue: prisma },
        { provide: AiSuggestService, useValue: {} },
      ],
    }).compile();
    svc = mod.get(AiAutoReplyService);
  });

  it('returns false when room.aiPaused is true', async () => {
    const session = { id: 'r1', channel: 'LINE_SHOP', aiPaused: true, handoffMode: false };
    expect(await svc.shouldAutoReply(session)).toBe(false);
  });

  it('returns false when room.handoffMode is true', async () => {
    const session = { id: 'r1', channel: 'LINE_SHOP', aiPaused: false, handoffMode: true };
    expect(await svc.shouldAutoReply(session)).toBe(false);
  });

  it('returns true for active LINE_SHOP room', async () => {
    const session = { id: 'r1', channel: 'LINE_SHOP', aiPaused: false, handoffMode: false };
    expect(await svc.shouldAutoReply(session)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx jest ai-auto-reply.service.spec --no-coverage`
Expected: FAIL — "returns false when room.aiPaused is true" fails because current shouldAutoReply doesn't check aiPaused

- [ ] **Step 3: Modify shouldAutoReply**

Edit `apps/api/src/modules/staff-chat/services/ai-auto-reply.service.ts` `shouldAutoReply` method (lines 17-33), add guards BEFORE existing checks:

```typescript
  async shouldAutoReply(session: any): Promise<boolean> {
    // Blocker fixes: respect take-over + handoff signals
    if (session.aiPaused) return false;
    if (session.handoffMode) return false;

    const settings = await this.getSettings();

    if (!settings.aiAutoEnabled) return false;

    // Check channel allowlist
    if (settings.aiAutoChannels.length > 0 && !settings.aiAutoChannels.includes(session.channel))
      return false;

    // Check per-room reply cap
    const sentCount = await this.prisma.aiAutoReplyLog.count({
      where: { roomId: session.id, autoSent: true },
    });
    if (sentCount >= settings.aiAutoMaxRepliesPerSession) return false;

    return true;
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && npx jest ai-auto-reply.service.spec --no-coverage`
Expected: 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/staff-chat/services/ai-auto-reply.service.ts \
        apps/api/src/modules/staff-chat/services/ai-auto-reply.service.spec.ts
git commit -m "fix(shop-ai): shouldAutoReply must respect aiPaused + handoffMode guards"
```

---

### Task 5: Fix `chat-ai-draft.generateDraft` — add handoffMode guard

**Files:**
- Modify: `apps/api/src/modules/chat-ai-draft/chat-ai-draft.service.ts:26`
- Modify: `apps/api/src/modules/chat-ai-draft/chat-ai-draft.service.spec.ts`

- [ ] **Step 1: Locate current check**

Run: `sed -n '20,35p' apps/api/src/modules/chat-ai-draft/chat-ai-draft.service.ts`
Expected: see `if (inbound.room.aiPaused) {` on line 26

- [ ] **Step 2: Add failing test for handoffMode skip**

Read `apps/api/src/modules/chat-ai-draft/chat-ai-draft.service.spec.ts` to find existing test pattern. Add a new test case (paste at end of existing `describe('generateDraft', ...)` block):

```typescript
  it('skips draft when room.handoffMode is true', async () => {
    const handoffRoom = {
      id: 'room-handoff',
      aiPaused: false,
      handoffMode: true,
      customerId: 'c1',
      lineUserId: 'u1',
      channel: 'LINE_SHOP',
    };
    (prisma.chatMessage.findUnique as jest.Mock).mockResolvedValueOnce({
      id: 'msg-1',
      roomId: handoffRoom.id,
      text: 'hi',
      room: handoffRoom,
    });
    const result = await service.generateDraft('msg-1');
    expect(result.draftMessageId).toBe('');
    expect(prisma.chatMessage.create).not.toHaveBeenCalled();
  });
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd apps/api && npx jest chat-ai-draft.service.spec -t "skips draft when room.handoffMode" --no-coverage`
Expected: FAIL — generateDraft proceeds to create draft

- [ ] **Step 4: Modify generateDraft guard**

Edit line 26 of `chat-ai-draft.service.ts`:

Before:
```typescript
    if (inbound.room.aiPaused) {
      this.logger.log(`Room ${inbound.room.id} AI paused — skipping draft`);
      return { draftMessageId: '' };
    }
```

After:
```typescript
    if (inbound.room.aiPaused || inbound.room.handoffMode) {
      this.logger.log(`Room ${inbound.room.id} AI paused/handoff — skipping draft`);
      return { draftMessageId: '' };
    }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/api && npx jest chat-ai-draft.service.spec --no-coverage`
Expected: all PASS (new test + existing tests)

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/chat-ai-draft/chat-ai-draft.service.ts \
        apps/api/src/modules/chat-ai-draft/chat-ai-draft.service.spec.ts
git commit -m "fix(shop-ai): chat-ai-draft skips draft when handoffMode active"
```

---

### Task 6: Raise default reply cap 5 → 50

**Files:**
- Modify: `apps/api/src/modules/staff-chat/services/ai-auto-reply.service.ts:98`
- Modify: `apps/api/.env.example`

- [ ] **Step 1: Locate the default value**

Run: `grep -n "AI_AUTO_MAX_REPLIES" apps/api/src/modules/staff-chat/services/ai-auto-reply.service.ts apps/api/.env.example`
Expected: shows line 98 with `?? '5'` and any .env.example entry

- [ ] **Step 2: Modify code default**

Edit ai-auto-reply.service.ts line 98:

Before:
```typescript
      aiAutoMaxRepliesPerSession: configMap.has('ai.autoMaxRepliesPerSession')
        ? Number(configMap.get('ai.autoMaxRepliesPerSession'))
        : Number(this.config.get<string>('AI_AUTO_MAX_REPLIES') ?? '5'),
```

After:
```typescript
      aiAutoMaxRepliesPerSession: configMap.has('ai.autoMaxRepliesPerSession')
        ? Number(configMap.get('ai.autoMaxRepliesPerSession'))
        : Number(this.config.get<string>('AI_AUTO_MAX_REPLIES') ?? '50'),
```

- [ ] **Step 3: Update .env.example**

In `apps/api/.env.example`, find `AI_AUTO_MAX_REPLIES` line (or add if missing):

```
AI_AUTO_MAX_REPLIES=50
```

- [ ] **Step 4: Run TypeScript check**

Run: `cd apps/api && npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/staff-chat/services/ai-auto-reply.service.ts \
        apps/api/.env.example
git commit -m "feat(shop-ai): raise AI_AUTO_MAX_REPLIES default 5→50 for sales convo length"
```

---

## Phase 4: `capture_lead` Tool

### Task 7: Install `promptpay-qr` dependency

**Files:**
- Modify: `apps/api/package.json`
- Modify: `apps/api/package-lock.json` (auto)

- [ ] **Step 1: Install package**

Run: `cd apps/api && npm install promptpay-qr`
Expected: package added; lock file updated; verify version in apps/api/package.json

- [ ] **Step 2: Verify type definitions**

Run: `cd apps/api && cat node_modules/promptpay-qr/package.json | grep -E "types|typings"`
Expected: types entry exists OR add `@types/promptpay-qr` if needed (test usage in tool will reveal)

- [ ] **Step 3: Commit**

```bash
git add apps/api/package.json apps/api/package-lock.json
git commit -m "chore(shop-ai): add promptpay-qr dep for capture_lead tool"
```

---

### Task 8: Create `capture_lead` tool

**Files:**
- Create: `apps/api/src/modules/sales-bot/tools/capture-lead.tool.ts`
- Create: `apps/api/src/modules/sales-bot/tools/capture-lead.tool.spec.ts`

- [ ] **Step 1: Write the failing test (happy path)**

Create `apps/api/src/modules/sales-bot/tools/capture-lead.tool.spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { CaptureLeadTool } from './capture-lead.tool';
import { PrismaService } from '../../../prisma/prisma.service';

describe('CaptureLeadTool', () => {
  let tool: CaptureLeadTool;
  let prisma: any;
  let txClient: any;

  beforeEach(async () => {
    txClient = {
      customer: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
      chatRoom: { update: jest.fn() },
      auditLog: { create: jest.fn() },
    };
    prisma = {
      $transaction: jest.fn((fn) => fn(txClient)),
      chatRoom: { findUnique: jest.fn() },
      systemConfig: { findMany: jest.fn() },
      user: { findFirst: jest.fn().mockResolvedValue({ id: 'system-user-1' }) },
    };
    const mod: TestingModule = await Test.createTestingModule({
      providers: [
        CaptureLeadTool,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    tool = mod.get(CaptureLeadTool);
  });

  it('creates new Customer + handoff + returns QR for first-time lead', async () => {
    prisma.chatRoom.findUnique.mockResolvedValue({
      id: 'room-1',
      lineUserId: 'line-user-1',
      customerId: null,
    });
    prisma.systemConfig.findMany.mockResolvedValue([
      { key: 'shop_bot_central_branch_id', value: 'branch-central' },
      { key: 'shop_bot_promptpay_id', value: '0812345678' },
    ]);
    txClient.customer.findFirst.mockResolvedValue(null);
    txClient.customer.create.mockResolvedValue({ id: 'cust-1' });

    const result = await tool.run({
      customerName: 'พี่เอ',
      phone: '0899999999',
      productId: 'prod-1',
      packageChoice: 'B',
      downAmount: 2900,
      roomId: 'room-1',
    });

    expect(txClient.customer.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        name: 'พี่เอ',
        phone: '0899999999',
        branchId: 'branch-central',
        chatConsent: true,
        lineIdShop: 'line-user-1',
        acquisitionSource: 'AI_CHAT',
        status: 'ACTIVE',
      }),
    }));
    expect(txClient.chatRoom.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        customerId: 'cust-1',
        handoffMode: true,
        handoffReason: 'lead_captured',
      }),
    }));
    expect(txClient.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        userId: 'system-user-1',
        action: 'AI_LEAD_CAPTURED',
        entity: 'customer',
        entityId: 'cust-1',
      }),
    }));
    expect(result.customerId).toBe('cust-1');
    expect(result.promptPayQr).toMatch(/^data:image\/png;base64,/);
    expect(result.downAmount).toBe(2900);
  });

  it('matches existing Customer by phone + lineIdShop composite', async () => {
    prisma.chatRoom.findUnique.mockResolvedValue({
      id: 'room-2',
      lineUserId: 'line-user-2',
      customerId: null,
    });
    prisma.systemConfig.findMany.mockResolvedValue([
      { key: 'shop_bot_central_branch_id', value: 'branch-central' },
      { key: 'shop_bot_promptpay_id', value: '0812345678' },
    ]);
    txClient.customer.findFirst.mockResolvedValue({ id: 'cust-existing' });

    const result = await tool.run({
      customerName: 'พี่บี',
      phone: '0888888888',
      productId: 'prod-2',
      packageChoice: 'A',
      downAmount: 490,
      roomId: 'room-2',
    });

    expect(txClient.customer.findFirst).toHaveBeenCalledWith({
      where: { phone: '0888888888', lineIdShop: 'line-user-2', deletedAt: null },
    });
    expect(txClient.customer.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'cust-existing' },
      data: expect.objectContaining({ acquisitionSource: 'AI_CHAT_RETURN' }),
    }));
    expect(txClient.customer.create).not.toHaveBeenCalled();
    expect(result.customerId).toBe('cust-existing');
  });

  it('returns lead-only (promptPayQr=null) when shop_bot_promptpay_id missing', async () => {
    prisma.chatRoom.findUnique.mockResolvedValue({
      id: 'room-3',
      lineUserId: 'line-user-3',
      customerId: null,
    });
    prisma.systemConfig.findMany.mockResolvedValue([
      { key: 'shop_bot_central_branch_id', value: 'branch-central' },
      // shop_bot_promptpay_id intentionally missing
    ]);
    txClient.customer.findFirst.mockResolvedValue(null);
    txClient.customer.create.mockResolvedValue({ id: 'cust-3' });

    const result = await tool.run({
      customerName: 'พี่ซี',
      phone: '0877777777',
      productId: 'prod-3',
      packageChoice: 'A',
      downAmount: 490,
      roomId: 'room-3',
    });

    expect(result.promptPayQr).toBeNull();
    expect(result.handoffMessage).toContain('แอดมิน');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx jest capture-lead.tool.spec --no-coverage`
Expected: FAIL — `Cannot find module './capture-lead.tool'`

- [ ] **Step 3: Implement the tool**

Create `apps/api/src/modules/sales-bot/tools/capture-lead.tool.ts`:

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const generatePayload = require('promptpay-qr');
import * as QRCode from 'qrcode';

export const CAPTURE_LEAD_TOOL = {
  name: 'capture_lead',
  description:
    'Call after customer confirms purchase (says "เอา/โอเค/สนใจ"). Captures lead, creates Customer draft, initiates handoff to staff for KYC verification, returns PromptPay QR url for down payment.',
  input_schema: {
    type: 'object',
    properties: {
      customerName: { type: 'string', description: 'ชื่อลูกค้า (ขออย่างน้อย firstname)' },
      phone: { type: 'string', description: 'เบอร์โทร 10 หลัก' },
      address: { type: 'string', description: 'ที่อยู่จัดส่ง (ตัวเลือก ถ้ามี)' },
      productId: { type: 'string', description: 'productId จาก search_products' },
      packageChoice: {
        type: 'string',
        enum: ['A', 'B', 'C'],
        description: 'แพ็คผ่อนที่ลูกค้าเลือก (A=ดาวน์เบา, B=กลาง, C=หนัก)',
      },
      downAmount: { type: 'number', description: 'ยอดดาวน์ที่จะส่ง QR' },
    },
    required: ['customerName', 'phone', 'productId', 'packageChoice', 'downAmount'],
  },
};

export interface CaptureLeadInput {
  customerName: string;
  phone: string;
  address?: string;
  productId: string;
  packageChoice: 'A' | 'B' | 'C';
  downAmount: number;
  roomId: string;
}

export interface CaptureLeadResult {
  customerId: string;
  promptPayQr: string | null;
  downAmount: number;
  handoffMessage: string;
}

@Injectable()
export class CaptureLeadTool {
  private readonly logger = new Logger(CaptureLeadTool.name);

  constructor(private readonly prisma: PrismaService) {}

  async run(input: CaptureLeadInput): Promise<CaptureLeadResult> {
    const room = await this.prisma.chatRoom.findUnique({
      where: { id: input.roomId },
      select: { id: true, lineUserId: true, customerId: true },
    });
    if (!room) {
      throw new Error(`Room not found: ${input.roomId}`);
    }

    // Find system user (required for AuditLog.userId — AI-driven action has no human staff)
    // Same pattern as cron jobs: installment-accrual.cron.ts:145
    const systemUser = await this.prisma.user.findFirst({
      where: { isSystemUser: true },
      select: { id: true },
    });
    if (!systemUser) {
      throw new Error('System user (isSystemUser=true) not found — required for AI audit logs');
    }

    const configs = await this.prisma.systemConfig.findMany({
      where: {
        key: { in: ['shop_bot_central_branch_id', 'shop_bot_promptpay_id'] },
        deletedAt: null,
      },
    });
    const configMap = new Map(configs.map((c) => [c.key, c.value]));
    const branchId = configMap.get('shop_bot_central_branch_id');
    const promptpayId = configMap.get('shop_bot_promptpay_id');

    if (!branchId) {
      throw new Error('shop_bot_central_branch_id not configured');
    }

    const customerId = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.customer.findFirst({
        where: {
          phone: input.phone,
          lineIdShop: room.lineUserId,
          deletedAt: null,
        },
      });

      let cId: string;
      if (existing) {
        await tx.customer.update({
          where: { id: existing.id },
          data: {
            name: input.customerName,
            acquisitionSource: 'AI_CHAT_RETURN',
          },
        });
        cId = existing.id;
      } else {
        const created = await tx.customer.create({
          data: {
            name: input.customerName,
            phone: input.phone,
            branchId,
            chatConsent: true,
            chatConsentAt: new Date(),
            lineIdShop: room.lineUserId,
            status: 'ACTIVE',
            acquisitionSource: 'AI_CHAT',
          },
        });
        cId = created.id;
      }

      await tx.chatRoom.update({
        where: { id: input.roomId },
        data: {
          customerId: cId,
          handoffMode: true,
          handoffReason: 'lead_captured',
          handoffTaggedAt: new Date(),
        },
      });

      await tx.auditLog.create({
        data: {
          userId: systemUser.id,  // required: AuditLog.userId is NOT nullable
          action: 'AI_LEAD_CAPTURED',
          entity: 'customer',
          entityId: cId,
          newValue: {
            productId: input.productId,
            packageChoice: input.packageChoice,
            downAmount: input.downAmount,
            address: input.address ?? null,
          },
        },
      });

      return cId;
    });

    let qrDataUrl: string | null = null;
    let handoffMessage = `ทางร้านจะติดต่อกลับเร็วๆ นี้นะคะ`;

    if (promptpayId) {
      try {
        const payload = generatePayload(promptpayId, { amount: input.downAmount });
        qrDataUrl = await QRCode.toDataURL(payload);
        handoffMessage = `ส่ง QR ดาวน์ ${input.downAmount.toLocaleString()} บาท แล้วนะคะ พอโอนเสร็จแอดมินจะติดต่อกลับเพื่อยืนยันสัญญาค่ะ 🙏`;
      } catch (err) {
        this.logger.error(
          `PromptPay QR generation failed for room ${input.roomId}: ${err instanceof Error ? err.message : err}`,
        );
      }
    } else {
      handoffMessage = `ทางแอดมินจะส่ง QR ดาวน์ ${input.downAmount.toLocaleString()} บาท ให้พี่ในแชทนี้นะคะ 🙏`;
    }

    return {
      customerId,
      promptPayQr: qrDataUrl,
      downAmount: input.downAmount,
      handoffMessage,
    };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && npx jest capture-lead.tool.spec --no-coverage`
Expected: 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/sales-bot/tools/capture-lead.tool.ts \
        apps/api/src/modules/sales-bot/tools/capture-lead.tool.spec.ts
git commit -m "feat(shop-ai): add capture_lead tool — Customer draft + handoff + PromptPay QR"
```

---

### Task 9: Register CaptureLeadTool in sales-bot module

**Files:**
- Modify: `apps/api/src/modules/sales-bot/sales-bot.module.ts`
- Modify: `apps/api/src/modules/sales-bot/sales-bot.service.ts`

- [ ] **Step 1: Read current module providers**

Run: `cat apps/api/src/modules/sales-bot/sales-bot.module.ts`
Expected: see existing providers array

- [ ] **Step 2: Add CaptureLeadTool to providers**

Edit `apps/api/src/modules/sales-bot/sales-bot.module.ts` — add import + provider:

```typescript
import { CaptureLeadTool } from './tools/capture-lead.tool';

// In @Module decorator:
providers: [
  SalesBotService,
  SearchProductsTool,
  CalculateInstallmentTool,
  ListPromotionsTool,
  HandoffToHumanTool,
  CaptureLeadTool, // NEW
],
```

(Match existing structure — paste at end of providers array)

- [ ] **Step 3: Modify sales-bot.service.ts — register tool**

Edit `apps/api/src/modules/sales-bot/sales-bot.service.ts`:

Import (add near top):
```typescript
import { CaptureLeadTool, CAPTURE_LEAD_TOOL } from './tools/capture-lead.tool';
```

Inject in constructor:
```typescript
  constructor(
    private readonly searchProducts: SearchProductsTool,
    private readonly calcInstallment: CalculateInstallmentTool,
    private readonly listPromotions: ListPromotionsTool,
    private readonly handoff: HandoffToHumanTool,
    private readonly captureLead: CaptureLeadTool, // NEW
  ) {}
```

In `generateReply` add to tools array:
```typescript
    const tools = [
      SEARCH_PRODUCTS_TOOL,
      CALCULATE_INSTALLMENT_TOOL,
      LIST_PROMOTIONS_TOOL,
      HANDOFF_TO_HUMAN_TOOL,
      CAPTURE_LEAD_TOOL, // NEW
    ];
```

In `runTool` switch add case:
```typescript
      case 'capture_lead':
        return this.captureLead.run({
          customerName: String(input.customerName ?? ''),
          phone: String(input.phone ?? ''),
          address: input.address as string | undefined,
          productId: String(input.productId ?? ''),
          packageChoice: input.packageChoice as 'A' | 'B' | 'C',
          downAmount: Number(input.downAmount ?? 0),
          roomId,
        });
```

- [ ] **Step 4: Run TypeScript check**

Run: `cd apps/api && npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 5: Run existing sales-bot test**

Run: `cd apps/api && npx jest sales-bot --no-coverage`
Expected: all existing tests PASS (no behavior change yet for cases that don't call capture_lead)

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/sales-bot/sales-bot.module.ts \
        apps/api/src/modules/sales-bot/sales-bot.service.ts
git commit -m "feat(shop-ai): wire capture_lead tool into SalesBotService"
```

---

## Phase 5: Confidence Rework + Brain Upgrade

### Task 10: Rework `estimateConfidence` per spec mapping

**Files:**
- Modify: `apps/api/src/modules/sales-bot/sales-bot.service.ts:139-144`
- Modify: `apps/api/src/modules/sales-bot/sales-bot.service.spec.ts`

- [ ] **Step 1: Locate existing estimateConfidence + test**

Run: `grep -n "estimateConfidence\|toolsUsed" apps/api/src/modules/sales-bot/sales-bot.service.spec.ts`
Expected: see test references for confidence values

- [ ] **Step 2: Add/update failing tests**

In `apps/api/src/modules/sales-bot/sales-bot.service.spec.ts`, add `describe` block for `estimateConfidence`:

```typescript
describe('estimateConfidence (reworked)', () => {
  // Use bracket-access for the private method (already pattern in some specs)
  const svc = new SalesBotService(
    {} as any, {} as any, {} as any, {} as any, {} as any,
  );

  it('greeting/qualifier (no tool, complete sentence) → 0.9', () => {
    const c = (svc as any).estimateConfidence('สวัสดีค่ะพี่ สนใจรุ่นไหนคะ?', []);
    expect(c).toBe(0.9);
  });

  it('tool-used reply → 0.95', () => {
    const c = (svc as any).estimateConfidence('iPhone 15 ราคา 28,900 ค่ะ', ['calculate_installment']);
    expect(c).toBe(0.95);
  });

  it('short/incomplete reply → 0.6', () => {
    const c = (svc as any).estimateConfidence('ค่ะ', []);
    expect(c).toBe(0.6);
  });

  it('handoff_to_human used → 0.3', () => {
    const c = (svc as any).estimateConfidence('ขออนุญาตเรียกแอดมินมาช่วยตอบนะคะ', ['handoff_to_human']);
    expect(c).toBe(0.3);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd apps/api && npx jest sales-bot.service.spec -t "estimateConfidence" --no-coverage`
Expected: FAIL — current scheme returns different values

- [ ] **Step 4: Rework estimateConfidence**

Replace `apps/api/src/modules/sales-bot/sales-bot.service.ts` `estimateConfidence` method:

```typescript
  /**
   * Confidence used by AiAutoReplyService threshold gating (default 0.80).
   *
   * Mapping (Phase A — see spec §6 #5):
   * - handoff_to_human used        → 0.3  (signal to handoff path, do not auto-send)
   * - short/incomplete (< 20 char) → 0.6  (below default threshold; skip)
   * - tool-used reply              → 0.95 (high confidence: fact-grounded)
   * - greeting/qualifier (no tool) → 0.9  (high: opener doesn't need data)
   */
  private estimateConfidence(reply: string, toolsUsed: string[]): number {
    if (toolsUsed.includes('handoff_to_human')) return 0.3;
    if (reply.trim().length < 20) return 0.6;
    if (toolsUsed.length > 0) return 0.95;
    return 0.9;
  }
```

- [ ] **Step 5: Run tests to verify pass**

Run: `cd apps/api && npx jest sales-bot --no-coverage`
Expected: all PASS (4 new + existing — note: existing tests asserting 0.5/0.8/0.3 must be updated to new values)

- [ ] **Step 6: Update any other test cases asserting old confidence values**

Search and replace:
Run: `grep -n "confidence.*0\\.5\|confidence.*0\\.8" apps/api/src/modules/sales-bot/sales-bot.service.spec.ts`
For each match, decide: tool-used → expect 0.95; no-tool greeting → expect 0.9; remove if no longer applicable

Re-run: `cd apps/api && npx jest sales-bot --no-coverage`
Expected: all PASS

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/sales-bot/sales-bot.service.ts \
        apps/api/src/modules/sales-bot/sales-bot.service.spec.ts
git commit -m "feat(shop-ai): rework estimateConfidence — greeting=0.9, tool=0.95, short=0.6, handoff=0.3"
```

---

### Task 11: Upgrade `AiAutoReplyService.autoReply` to use SalesBot

**Files:**
- Modify: `apps/api/src/modules/staff-chat/services/ai-auto-reply.service.ts:35-50`
- Modify: `apps/api/src/modules/staff-chat/staff-chat.module.ts` (import SalesBotModule)
- Modify: `apps/api/src/modules/staff-chat/services/ai-auto-reply.service.spec.ts`

- [ ] **Step 1: Add failing integration-style test for SalesBot use**

In `apps/api/src/modules/staff-chat/services/ai-auto-reply.service.spec.ts`, add:

```typescript
describe('AiAutoReplyService.autoReply', () => {
  let svc: AiAutoReplyService;
  let salesBot: { generateReply: jest.Mock };
  let prisma: any;

  beforeEach(async () => {
    salesBot = { generateReply: jest.fn() };
    prisma = {
      chatMessage: { findMany: jest.fn().mockResolvedValue([]) },
      systemConfig: { findMany: jest.fn().mockResolvedValue([
        { key: 'ai.autoConfidenceThreshold', value: '80' },
      ]) },
    };
    const mod: TestingModule = await Test.createTestingModule({
      providers: [
        AiAutoReplyService,
        { provide: ConfigService, useValue: { get: () => undefined } },
        { provide: PrismaService, useValue: prisma },
        { provide: AiSuggestService, useValue: { suggest: jest.fn() } },
        // NEW dep: SalesBotService
        { provide: SalesBotService, useValue: salesBot },
      ],
    }).compile();
    svc = mod.get(AiAutoReplyService);
  });

  it('uses SalesBotService and returns reply when confidence ≥ threshold', async () => {
    salesBot.generateReply.mockResolvedValue({
      reply: 'iPhone 15 ราคา 28,900 บาทค่ะ ดาวน์เริ่ม 490',
      confidence: 0.95,
      toolsUsed: ['calculate_installment'],
      inputTokens: 100,
      outputTokens: 50,
    });

    const result = await svc.autoReply('room-1', 'iPhone 15 ราคา?');

    expect(salesBot.generateReply).toHaveBeenCalledWith(expect.objectContaining({
      text: 'iPhone 15 ราคา?',
      roomId: 'room-1',
    }));
    expect(result).toEqual(expect.objectContaining({
      reply: expect.stringContaining('iPhone 15'),
      confidence: 0.95,
    }));
  });

  it('returns null when confidence < threshold', async () => {
    salesBot.generateReply.mockResolvedValue({
      reply: 'ขออนุญาตเรียกแอดมิน',
      confidence: 0.3,
      toolsUsed: ['handoff_to_human'],
      inputTokens: 50,
      outputTokens: 30,
    });
    const result = await svc.autoReply('room-2', 'ขอผ่อน iPhone 5 เครื่อง');
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Add import for SalesBotService in spec**

Add to top of spec file:
```typescript
import { SalesBotService } from '../../sales-bot/sales-bot.service';
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd apps/api && npx jest ai-auto-reply.service.spec --no-coverage`
Expected: FAIL — `Nest can't resolve dependencies of AiAutoReplyService (?, ...)` (SalesBotService not declared as constructor dep)

- [ ] **Step 4: Modify AiAutoReplyService**

Edit `apps/api/src/modules/staff-chat/services/ai-auto-reply.service.ts`:

Add imports at top:
```typescript
import { SalesBotService, SalesBotResult } from '../../sales-bot/sales-bot.service';
import { MessageRole } from '@prisma/client';
```

Update constructor:
```typescript
  constructor(
    private config: ConfigService,
    private prisma: PrismaService,
    private aiSuggest: AiSuggestService,
    private salesBot: SalesBotService, // NEW
  ) {}
```

Replace `autoReply` body (lines 35-50):

```typescript
  async autoReply(
    roomId: string,
    customerMessage: string,
  ): Promise<({ reply: string; confidence: number } & Partial<SalesBotResult>) | null> {
    const settings = await this.getSettings();
    const threshold = settings.aiAutoConfidenceThreshold / 100;

    // Fetch room context (customerId) + last 5 prior messages (duplicate of loadPrior pattern)
    const room = await this.prisma.chatRoom.findUnique({
      where: { id: roomId },
      select: { customerId: true },
    });

    const priorRows = await this.prisma.chatMessage.findMany({
      where: { roomId, deletedAt: null, text: { not: null } },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: { role: true, text: true },
    });
    const priorMessages = priorRows.reverse().map((r) => ({
      role: (r.role === MessageRole.BOT || r.role === MessageRole.STAFF
        ? 'assistant'
        : 'user') as 'assistant' | 'user',
      content: r.text ?? '',
    }));

    const result = await this.salesBot.generateReply({
      text: customerMessage,
      roomId,
      customerId: room?.customerId ?? null,
      priorMessages,
    });

    if (result.confidence < threshold) return null;

    return {
      reply: result.reply,
      confidence: result.confidence,
      toolsUsed: result.toolsUsed,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
    };
  }
```

- [ ] **Step 5: Wire SalesBotModule import**

Edit `apps/api/src/modules/staff-chat/staff-chat.module.ts`:

Add to imports array (top of @Module decorator):
```typescript
import { SalesBotModule } from '../sales-bot/sales-bot.module';

// In @Module:
imports: [
  // ...existing imports
  SalesBotModule,
],
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd apps/api && npx jest ai-auto-reply.service.spec --no-coverage`
Expected: 5 tests PASS (3 from Task 4 + 2 new)

- [ ] **Step 7: Run TypeScript check**

Run: `cd apps/api && npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/modules/staff-chat/services/ai-auto-reply.service.ts \
        apps/api/src/modules/staff-chat/services/ai-auto-reply.service.spec.ts \
        apps/api/src/modules/staff-chat/staff-chat.module.ts
git commit -m "feat(shop-ai): AiAutoReplyService uses SalesBotService (tool loop + intent-aware)"
```

---

### Task 12: Pass `intent='AUTO:sales'` + new metadata fields in AiAutoReplyLog

**Files:**
- Modify: `apps/api/src/modules/chat-engine/services/message-router.service.ts:179-191`
- Modify: `apps/api/src/modules/staff-chat/services/ai-auto-reply.service.ts:52-70` (logAutoReply signature)

- [ ] **Step 1: Update `logAutoReply` to accept new fields**

Edit `apps/api/src/modules/staff-chat/services/ai-auto-reply.service.ts` — extend logAutoReply params (lines 52-70):

```typescript
  async logAutoReply(params: {
    roomId: string;
    customerMessage: string;
    aiReply: string;
    confidence: number;
    autoSent: boolean;
    handoffReason?: string;
    intent?: string;
    toolsUsed?: string[];
    inputTokens?: number;
    outputTokens?: number;
  }): Promise<void> {
    await this.prisma.aiAutoReplyLog.create({
      data: {
        roomId: params.roomId,
        customerMessage: params.customerMessage,
        aiReply: params.aiReply,
        confidence: params.confidence,
        autoSent: params.autoSent,
        handoffReason: params.handoffReason,
        intent: params.intent,
        toolsUsed: params.toolsUsed ?? [],
        inputTokens: params.inputTokens,
        outputTokens: params.outputTokens,
      },
    });
  }
```

- [ ] **Step 2: Update `message-router.service.ts:179-191` saveMessage call**

Edit `apps/api/src/modules/chat-engine/services/message-router.service.ts` lines 179-191 (inside autoReply success branch):

Before (current):
```typescript
            await this.roomManager.saveMessage({
              roomId: room.id,
              role: MessageRole.BOT,
              text: result.reply,
            });
          }
          await this.aiAutoReplyService.logAutoReply({
            roomId: room.id,
            customerMessage,
            aiReply: result.reply,
            confidence: result.confidence,
            autoSent: true,
          });
```

After:
```typescript
            await this.roomManager.saveMessage({
              roomId: room.id,
              role: MessageRole.BOT,
              text: result.reply,
              intent: 'AUTO:sales', // Phase A: SHOP channels always sales (intent router skipped)
              toolsUsed: result.toolsUsed,
              inputTokens: result.inputTokens,
              outputTokens: result.outputTokens,
            });
          }
          await this.aiAutoReplyService.logAutoReply({
            roomId: room.id,
            customerMessage,
            aiReply: result.reply,
            confidence: result.confidence,
            autoSent: true,
            intent: 'AUTO:sales',
            toolsUsed: result.toolsUsed,
            inputTokens: result.inputTokens,
            outputTokens: result.outputTokens,
          });
```

- [ ] **Step 3: Run TypeScript check**

Run: `cd apps/api && npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 4: Run impacted tests**

Run: `cd apps/api && npx jest message-router ai-auto-reply --no-coverage`
Expected: all PASS (tests don't assert on intent/tools yet, so backward compatible)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/chat-engine/services/message-router.service.ts \
        apps/api/src/modules/staff-chat/services/ai-auto-reply.service.ts
git commit -m "feat(shop-ai): tag AI auto-sends with intent=AUTO:sales + log tools/tokens"
```

---

## Phase 6: Adapter Guard (Defense-in-depth)

### Task 13: `shouldAutoReply` check adapter.isConfigured

**Files:**
- Modify: `apps/api/src/modules/staff-chat/services/ai-auto-reply.service.ts:17-33` (shouldAutoReply)
- Modify: spec file

- [ ] **Step 1: Identify adapter access pattern**

Run: `grep -n "adapterMap\|CHANNEL_ADAPTER_TOKEN" apps/api/src/modules/chat-engine/services/message-router.service.ts | head -5`
Expected: see how message-router uses adapterMap

- [ ] **Step 2: Decide injection approach**

Decision: Inject ChannelRegistry / adapterMap is complex (cross-module). Simpler: add a config map of "channels known to have a working sendMessage" in AiAutoReplyService settings logic. For Phase A, hard-code:

In `apps/api/src/modules/staff-chat/services/ai-auto-reply.service.ts` shouldAutoReply, add after channel allowlist check (before sentCount):

```typescript
    // Defense-in-depth: skip channels whose adapter is stub (TikTok)
    const STUB_CHANNELS = new Set(['TIKTOK']);
    if (STUB_CHANNELS.has(session.channel)) return false;
```

- [ ] **Step 3: Add failing test**

In `ai-auto-reply.service.spec.ts` add to `describe('AiAutoReplyService.shouldAutoReply', ...)`:

```typescript
  it('returns false for TIKTOK channel even if in allowlist (stub adapter)', async () => {
    prisma.systemConfig.findMany.mockResolvedValueOnce([
      { key: 'ai.autoEnabled', value: 'true' },
      { key: 'ai.autoChannels', value: '["LINE_SHOP","TIKTOK"]' },
      { key: 'ai.autoMaxRepliesPerSession', value: '50' },
    ]);
    const session = { id: 'r-tt', channel: 'TIKTOK', aiPaused: false, handoffMode: false };
    expect(await svc.shouldAutoReply(session)).toBe(false);
  });
```

- [ ] **Step 4: Run test (should fail before step 2 edit applied; if step 2 already applied, should pass)**

Run: `cd apps/api && npx jest ai-auto-reply.service.spec -t "TIKTOK" --no-coverage`
Expected: PASS (we already applied the code in step 2)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/staff-chat/services/ai-auto-reply.service.ts \
        apps/api/src/modules/staff-chat/services/ai-auto-reply.service.spec.ts
git commit -m "feat(shop-ai): defense-in-depth — block TIKTOK auto-reply (stub adapter)"
```

---

### Task 14: `shouldAutoReply` fail-loud if central branch not configured

**Files:**
- Modify: `apps/api/src/modules/staff-chat/services/ai-auto-reply.service.ts` (shouldAutoReply)

- [ ] **Step 1: Add failing test**

In `ai-auto-reply.service.spec.ts` `describe('shouldAutoReply')` add:

```typescript
  it('returns false when shop_bot_central_branch_id is not configured', async () => {
    prisma.systemConfig.findMany
      .mockResolvedValueOnce([
        { key: 'ai.autoEnabled', value: 'true' },
        { key: 'ai.autoChannels', value: '["LINE_SHOP"]' },
        { key: 'ai.autoMaxRepliesPerSession', value: '50' },
      ])
      .mockResolvedValueOnce([]); // shop_bot_central_branch_id missing
    const session = { id: 'r-c', channel: 'LINE_SHOP', aiPaused: false, handoffMode: false };
    expect(await svc.shouldAutoReply(session)).toBe(false);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx jest ai-auto-reply.service.spec -t "central_branch_id" --no-coverage`
Expected: FAIL — current code doesn't check

- [ ] **Step 3: Implement guard**

In `ai-auto-reply.service.ts` shouldAutoReply, add BEFORE returning true at end:

```typescript
    // Fail-loud guard: SHOP channels require central branch + promptpay configured
    const SHOP_CHANNELS = new Set(['LINE_SHOP', 'FACEBOOK', 'WEB']);
    if (SHOP_CHANNELS.has(session.channel)) {
      const cfg = await this.prisma.systemConfig.findMany({
        where: { key: 'shop_bot_central_branch_id', deletedAt: null },
      });
      if (cfg.length === 0 || !cfg[0].value) {
        this.logger.warn(
          `shop_bot_central_branch_id not configured — AI auto-reply disabled for ${session.channel}`,
        );
        return false;
      }
    }

    return true;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && npx jest ai-auto-reply.service.spec --no-coverage`
Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/staff-chat/services/ai-auto-reply.service.ts \
        apps/api/src/modules/staff-chat/services/ai-auto-reply.service.spec.ts
git commit -m "feat(shop-ai): fail-loud when shop_bot_central_branch_id not set"
```

---

## Phase 7: Release-to-AI Endpoint

### Task 15: Add `releaseToAi(roomId, staffId)` service method

**Files:**
- Modify: `apps/api/src/modules/chat-ai-draft/chat-ai-draft.service.ts`
- Modify: `apps/api/src/modules/chat-ai-draft/chat-ai-draft.service.spec.ts`

- [ ] **Step 1: Add failing test**

In `chat-ai-draft.service.spec.ts` add (ensure `prisma.$transaction` mock exists in beforeEach: `$transaction: jest.fn((fn) => fn(prisma))`):

```typescript
describe('releaseToAi', () => {
  it('resets aiPaused flags + writes AI_RELEASED audit log in $transaction', async () => {
    (prisma.chatRoom.update as jest.Mock).mockResolvedValueOnce({ id: 'room-1' });
    (prisma.auditLog.create as jest.Mock).mockResolvedValueOnce({ id: 'audit-1' });
    const result = await service.releaseToAi('room-1', 'staff-1');
    expect(prisma.chatRoom.update).toHaveBeenCalledWith({
      where: { id: 'room-1' },
      data: { aiPaused: false, aiPausedAt: null, aiPausedById: null },
    });
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: {
        userId: 'staff-1',
        action: 'AI_RELEASED',
        entity: 'chat_room',
        entityId: 'room-1',
      },
    });
    expect(result.released).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify fails**

Run: `cd apps/api && npx jest chat-ai-draft.service.spec -t "releaseToAi" --no-coverage`
Expected: FAIL — method doesn't exist

- [ ] **Step 3: Implement releaseToAi**

In `chat-ai-draft.service.ts`, add after `takeOver` method:

```typescript
  async releaseToAi(roomId: string, staffId: string): Promise<{ released: boolean }> {
    await this.prisma.$transaction(async (tx) => {
      await tx.chatRoom.update({
        where: { id: roomId },
        data: { aiPaused: false, aiPausedAt: null, aiPausedById: null },
      });
      await tx.auditLog.create({
        data: {
          userId: staffId,
          action: 'AI_RELEASED',
          entity: 'chat_room',
          entityId: roomId,
        },
      });
    });
    this.logger.log(`Room ${roomId} released back to AI by staff ${staffId}`);
    return { released: true };
  }
```

- [ ] **Step 4: Run test to verify passes**

Run: `cd apps/api && npx jest chat-ai-draft.service.spec --no-coverage`
Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/chat-ai-draft/chat-ai-draft.service.ts \
        apps/api/src/modules/chat-ai-draft/chat-ai-draft.service.spec.ts
git commit -m "feat(shop-ai): add ChatAiDraftService.releaseToAi (mirror of takeOver)"
```

---

### Task 16: Wire `POST /chat-ai-draft/release-to-ai` controller endpoint

**Files:**
- Modify: `apps/api/src/modules/chat-ai-draft/chat-ai-draft.controller.ts`

- [ ] **Step 1: Read current controller**

Run: `cat apps/api/src/modules/chat-ai-draft/chat-ai-draft.controller.ts`
Expected: see existing `takeOver` endpoint pattern

- [ ] **Step 2: Add release-to-ai endpoint**

In `chat-ai-draft.controller.ts`, add a new method matching the pattern of `takeOver`:

```typescript
  @Post('release-to-ai/:roomId')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  async releaseToAi(@Param('roomId') id: string, @Req() req: { user: { id: string } }) {
    return this.svc.releaseToAi(id, req.user.id);
  }
```

(Roles + signature match existing `takeOver` exactly for symmetry.)

(Match exact `@Roles` set + decorator imports already used by takeOver in same file.)

- [ ] **Step 3: TypeScript check**

Run: `cd apps/api && npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/chat-ai-draft/chat-ai-draft.controller.ts
git commit -m "feat(shop-ai): expose POST /chat-ai-draft/release-to-ai/:roomId"
```

---

## Phase 8: Deprecate `salesBotMode='FULL'`

### Task 17: Remove 'FULL' from AiSettings.salesBotMode

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (line ~5908 comment)
- Modify: `apps/api/src/modules/staff-chat/dto/ai-settings.dto.ts`
- Modify: any UI dropdown that exposes salesBotMode

- [ ] **Step 1: Update schema.prisma comment**

Edit line 5908 of `apps/api/prisma/schema.prisma`:

Before:
```prisma
  salesBotMode                  String   @default("HYBRID") @map("sales_bot_mode") // OFF | HYBRID | FULL
  serviceBotMode                String   @default("HYBRID") @map("service_bot_mode") // OFF | HYBRID | FULL
```

After:
```prisma
  salesBotMode                  String   @default("HYBRID") @map("sales_bot_mode") // OFF | HYBRID (FULL deprecated 2026-05-20 — use ai.autoEnabled SystemConfig instead)
  serviceBotMode                String   @default("HYBRID") @map("service_bot_mode") // OFF | HYBRID
```

- [ ] **Step 1.5: Verify no production records have salesBotMode='FULL'**

Run on production DB (or staging mirror):
`psql $DATABASE_URL -c "SELECT id, sales_bot_mode FROM ai_settings WHERE sales_bot_mode = 'FULL';"`
Expected: 0 rows. If non-zero, manually update to 'HYBRID' before proceeding: `UPDATE ai_settings SET sales_bot_mode='HYBRID' WHERE sales_bot_mode='FULL';`

- [ ] **Step 2: Search for 'FULL' usage in DTOs / validators / UI**

Run: `grep -rn "'FULL'\|\"FULL\"" apps/api/src/modules/staff-chat apps/web/src 2>/dev/null | grep -v ".spec\|.test"`
Expected: list of files referencing FULL

- [ ] **Step 3: Remove FULL from any enum validator**

For each match in step 2, remove FULL option (e.g., `@IsIn(['OFF', 'HYBRID'])` instead of `@IsIn(['OFF', 'HYBRID', 'FULL'])`)

- [ ] **Step 4: Remove FULL from UI dropdown options**

If any AiSettingsPage / SettingsPage select shows FULL, remove that option.

- [ ] **Step 5: TypeScript check**

Run: `cd apps/api && npx tsc --noEmit && cd ../web && npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 6: Run all impacted tests**

Run: `cd apps/api && npx jest staff-chat chat-ai-draft --no-coverage`
Expected: all PASS

- [ ] **Step 7: Commit**

```bash
git add apps/api/prisma/schema.prisma \
        apps/api/src/modules/staff-chat/dto/ai-settings.dto.ts \
        apps/web/src/pages/AiSettingsPage.tsx
git commit -m "chore(shop-ai): deprecate AiSettings.salesBotMode='FULL' (use ai.autoEnabled instead)"
```

---

## Phase 9: Frontend Changes

### Task 18: F1 — AI status badge + filter chips in RoomListItem

**Files:**
- Modify: `apps/web/src/pages/chat/ChatInboxPage.tsx` (lift `aiSettings` query + pass prop + filter chips)
- Modify: `apps/web/src/pages/chat/components/RoomListItem.tsx` (accept aiSettings prop, render badge)

- [ ] **Step 0: Lift `aiSettings` query in ChatInboxPage (parent)**

In `ChatInboxPage.tsx` near other queries:
```typescript
const aiSettingsQuery = useQuery<{
  autoModeEnabled: boolean;
  enabledChannels: string[];
}>({
  queryKey: ['ai-settings'],
  queryFn: () => api.get('/staff-chat/ai/settings').then((r: any) => r.data),
});
```

Pass to RoomListItem in render loop:
```tsx
<RoomListItem room={room} aiSettings={aiSettingsQuery.data} />
```

(Single query — N rooms read from same cache, avoids N+1)

- [ ] **Step 1: Read current RoomListItem to understand structure**

Run: `head -100 apps/web/src/pages/chat/components/RoomListItem.tsx`
Expected: see existing badge rendering (read/unread, handoff status)

- [ ] **Step 2: Add AiStatusBadge sub-component**

At top of `RoomListItem.tsx` (or inline if file is small), add:

```typescript
function AiStatusBadge({
  aiAutoEnabled,
  channel,
  enabledChannels,
  aiPaused,
  handoffMode,
}: {
  aiAutoEnabled: boolean;
  channel: string;
  enabledChannels: string[];
  aiPaused: boolean;
  handoffMode: boolean;
}) {
  if (handoffMode) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-destructive">
        <span className="size-2 rounded-full bg-destructive" />
        ต้องตอบ
      </span>
    );
  }
  if (aiPaused) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-amber-600">
        <span className="size-2 rounded-full bg-amber-500" />
        พนักงาน
      </span>
    );
  }
  const channelAllowed =
    aiAutoEnabled && enabledChannels.length > 0 && enabledChannels.includes(channel);
  if (channelAllowed) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-emerald-600">
        <span className="size-2 rounded-full bg-emerald-500" />
        AI
      </span>
    );
  }
  return null;
}
```

- [ ] **Step 3: Render badge in RoomListItem (accept aiSettings prop from parent — see Step 0)**

Update component signature: `function RoomListItem({ room, aiSettings }: { room: Room; aiSettings?: AiSettings })`

Inside the existing component's JSX (next to existing badges), add:

```tsx
<AiStatusBadge
  aiAutoEnabled={aiSettings?.autoModeEnabled ?? false}
  channel={room.channel}
  enabledChannels={aiSettings?.enabledChannels ?? []}
  aiPaused={room.aiPaused}
  handoffMode={room.handoffMode}
/>
```

- [ ] **Step 4: Add filter chips to ChatInboxPage**

Find the inbox toolbar section in `apps/web/src/pages/chat/ChatInboxPage.tsx` and add above room list:

```tsx
<div className="flex gap-2 px-3 py-2 border-b">
  {(['all', 'ai', 'human', 'pending'] as const).map((key) => (
    <button
      key={key}
      onClick={() => setFilter(key)}
      className={cn(
        'px-2 py-1 text-xs rounded-full border',
        filter === key ? 'bg-primary text-primary-foreground' : 'bg-background',
      )}
    >
      {{ all: 'ทั้งหมด', ai: 'AI', human: 'พนักงาน', pending: 'รอตอบ' }[key]}
    </button>
  ))}
</div>
```

Plumb `filter` state via `useState<'all'|'ai'|'human'|'pending'>('all')` and apply filter in room list render:

```typescript
const filteredRooms = rooms.filter((r) => {
  if (filter === 'ai') return !r.aiPaused && !r.handoffMode;
  if (filter === 'human') return r.aiPaused;
  if (filter === 'pending') return r.handoffMode;
  return true;
});
```

- [ ] **Step 5: Manual smoke test**

Run: `cd apps/web && npm run dev`
Open: http://localhost:5173/chat
Expected: room list shows colored dots + filter chips; clicking chips filters; with aiPaused=true row gets 🟡 พนักงาน badge

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/chat/components/RoomListItem.tsx \
        apps/web/src/pages/chat/ChatInboxPage.tsx
git commit -m "feat(shop-ai): AI status badge + filter chips in รวมแชท"
```

---

### Task 19: F2 — Take-over / Release-to-AI button in AssistantSidebar

**Files:**
- Modify: `apps/web/src/pages/chat/components/AssistantSidebar.tsx`
- Modify: `apps/web/src/pages/chat/lib/chat-api.ts`

- [ ] **Step 1: Add API client method**

Run: `grep -n "takeOver\|take-over" apps/web/src/pages/chat/lib/chat-api.ts`
Expected: see existing takeOver method signature

Add (next to existing takeOver):
```typescript
export async function releaseToAi(roomId: string) {
  return api.post<{ released: true }>(`/chat-ai-draft/release-to-ai/${roomId}`);
}
```

- [ ] **Step 2: Add toggle button in AssistantSidebar**

In `apps/web/src/pages/chat/components/AssistantSidebar.tsx`, find current take-over button (if exists, otherwise locate the action area) and replace with:

```tsx
{room.aiPaused ? (
  <Button
    onClick={async () => {
      await releaseToAi(room.id);
      queryClient.invalidateQueries({ queryKey: ['chat-room', room.id] });
      toast.success('ส่งกลับให้ AI ตอบต่อแล้ว');
    }}
    variant="outline"
    className="w-full"
  >
    ↩️ ส่งกลับให้ AI
  </Button>
) : (
  <Button
    onClick={async () => {
      await takeOver(room.id);
      queryClient.invalidateQueries({ queryKey: ['chat-room', room.id] });
      toast.success('รับช่วงต่อแล้ว — AI หยุดตอบห้องนี้');
    }}
    variant="default"
    className="w-full"
  >
    🙋‍♀️ รับช่วงต่อ
  </Button>
)}
```

(Wire `queryClient = useQueryClient()` + `toast` from sonner per existing imports in file.)

- [ ] **Step 3: Manual smoke test**

In `/chat`, open a room. Click "🙋‍♀️ รับช่วงต่อ" → toast appears → button changes to "↩️ ส่งกลับให้ AI" → click again → reverts.
Expected: DB `chat_rooms.ai_paused` toggles; badge color in room list updates (after invalidate)

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/chat/components/AssistantSidebar.tsx \
        apps/web/src/pages/chat/lib/chat-api.ts
git commit -m "feat(shop-ai): take-over / release-to-AI toggle button in AssistantSidebar"
```

---

### Task 20a: Extend `/staff-chat/ai/settings` PATCH to accept shop_bot_* keys

**Files:**
- Modify: `apps/api/src/modules/staff-chat/dto/ai-settings.dto.ts` (add 3 fields)
- Modify: `apps/api/src/modules/staff-chat/services/ai-auto-reply.service.ts` (`updateSettings` writes 3 new SystemConfig keys)

- [ ] **Step 1: Extend UpdateAiSettingsDto**

Add 3 optional fields to `UpdateAiSettingsDto` class:
```typescript
  @IsOptional() @IsString()
  shopBotCentralBranchId?: string;

  @IsOptional() @IsString()
  shopBotPromptpayId?: string;

  @IsOptional() @IsString()
  shopBotTestUserId?: string;
```

Also extend `AiAutoSettings` interface (return type) with same 3 fields.

- [ ] **Step 2: Extend `updateSettings` to write 3 new keys**

In `ai-auto-reply.service.ts` `updateSettings` method, add to the `entries` array (mirror existing block):
```typescript
    if (dto.shopBotCentralBranchId !== undefined) {
      entries.push({
        key: 'shop_bot_central_branch_id',
        value: dto.shopBotCentralBranchId,
        label: 'SHOP Bot central branch ID',
      });
    }
    if (dto.shopBotPromptpayId !== undefined) {
      entries.push({
        key: 'shop_bot_promptpay_id',
        value: dto.shopBotPromptpayId,
        label: 'SHOP Bot PromptPay ID',
      });
    }
    if (dto.shopBotTestUserId !== undefined) {
      entries.push({
        key: 'shop_bot_test_user_id',
        value: dto.shopBotTestUserId,
        label: 'SHOP Bot test LINE userId',
      });
    }
```

Also extend `getSettings` to read these 3 keys (add to `keys` array + return values).

- [ ] **Step 3: TypeScript check + run tests**

Run: `cd apps/api && npx tsc --noEmit && npx jest staff-chat --no-coverage`
Expected: 0 errors, tests pass

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/staff-chat/dto/ai-settings.dto.ts \
        apps/api/src/modules/staff-chat/services/ai-auto-reply.service.ts
git commit -m "feat(shop-ai): extend ai/settings PATCH to accept shop_bot_* keys"
```

---

### Task 20: F3 — SHOP Bot Setup section in AiSettingsPage

**Files:**
- Modify: `apps/web/src/pages/AiSettingsPage.tsx`

- [ ] **Step 1: Read AiSettingsPage structure**

Run: `wc -l apps/web/src/pages/AiSettingsPage.tsx && grep -n "Card\|Section\|<form\|onSubmit" apps/web/src/pages/AiSettingsPage.tsx | head`
Expected: see existing form/card structure

- [ ] **Step 2: Add SHOP Bot Setup section component**

After the existing AiSettingsForm component in `AiSettingsPage.tsx`, add:

```typescript
function ShopBotSetupForm() {
  const queryClient = useQueryClient();
  const [branchId, setBranchId] = useState('');
  const [promptpayId, setPromptpayId] = useState('');
  const [testUserId, setTestUserId] = useState('');

  // Read SHOP bot config from same ai-settings endpoint (extended in Task 20a)
  const settingsQuery = useQuery<any>({
    queryKey: ['ai-settings'],
    queryFn: () => api.get('/staff-chat/ai/settings').then((r: any) => r.data),
  });

  const branchesQuery = useQuery({
    queryKey: ['branches'],
    queryFn: () => api.get('/branches').then((r: any) => r.data),
  });

  useEffect(() => {
    if (!settingsQuery.data) return;
    setBranchId(settingsQuery.data.shopBotCentralBranchId ?? '');
    setPromptpayId(settingsQuery.data.shopBotPromptpayId ?? '');
    setTestUserId(settingsQuery.data.shopBotTestUserId ?? '');
  }, [settingsQuery.data]);

  const saveMutation = useMutation({
    mutationFn: () =>
      api.patch('/staff-chat/ai/settings', {
        shopBotCentralBranchId: branchId,
        shopBotPromptpayId: promptpayId,
        shopBotTestUserId: testUserId,
      }),
    onSuccess: () => {
      toast.success('บันทึก SHOP Bot Setup เรียบร้อย');
      queryClient.invalidateQueries({ queryKey: ['ai-settings'] });
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>🏪 SHOP Bot Setup</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <Label>Central Branch (เก็บ AI-captured leads)</Label>
          <Select value={branchId} onValueChange={setBranchId}>
            <SelectTrigger><SelectValue placeholder="เลือกสาขา" /></SelectTrigger>
            <SelectContent>
              {(branchesQuery.data ?? []).map((b: any) => (
                <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>PromptPay ID (เบอร์มือถือ / เลข ปชช. / เลขผู้เสียภาษีนิติบุคคล)</Label>
          <Input value={promptpayId} onChange={(e) => setPromptpayId(e.target.value)} />
        </div>
        <div>
          <Label>Test LINE userId (owner — ใช้ส่งข้อความทดสอบ)</Label>
          <Input value={testUserId} onChange={(e) => setTestUserId(e.target.value)} />
        </div>
        <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
          บันทึก
        </Button>
      </CardContent>
    </Card>
  );
}
```

Render in the page below existing AiSettingsForm:
```tsx
<ShopBotSetupForm />
```

- [ ] **Step 3: (no separate endpoint needed — Task 20a extended /staff-chat/ai/settings PATCH)**

- [ ] **Step 4: Manual smoke test**

Open: `/settings/ai`
Expected: SHOP Bot Setup card appears; can pick branch + enter PromptPay + save; toast on success; reload preserves values

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/AiSettingsPage.tsx
git commit -m "feat(shop-ai): SHOP Bot Setup section — central branch + PromptPay + test userId"
```

---

### Task 21: F4 — 🤖 indicator on AI auto-send messages

**Files:**
- Modify: `apps/web/src/pages/chat/components/MessageBubble.tsx`

- [ ] **Step 1: Read MessageBubble.tsx to find BOT message branch**

Run: `cat apps/web/src/pages/chat/components/MessageBubble.tsx`
Expected: identify the render branch where `msg.role === 'BOT'` is handled (DRAFT badge etc.)

- [ ] **Step 2: Add AUTO: badge logic**

Find where BOT messages render. Add:

```tsx
{msg.role === 'BOT' && msg.intent?.startsWith('AUTO:') && (
  <span className="ml-2 text-xs text-emerald-600" title="AI ตอบอัตโนมัติ">
    🤖
  </span>
)}
{msg.role === 'BOT' && msg.intent?.startsWith('DRAFT:') && (
  /* existing DRAFT badge — unchanged */
  null
)}
```

(Keep existing DRAFT rendering as-is; this only adds the 🤖 for AUTO: prefix.)

- [ ] **Step 3: Manual smoke test**

After Task 12 deployment, AI-sent messages should appear with 🤖 icon. Test by triggering an inbound on staging.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/chat/components/MessageBubble.tsx
git commit -m "feat(shop-ai): 🤖 indicator on AI auto-sent messages in conversation view"
```

---

## Phase 10: Integration Test

### Task 22: End-to-end integration test

**Files:**
- Create: `apps/api/src/modules/staff-chat/services/__tests__/shop-ai-flow.integration.spec.ts`

- [ ] **Step 1: Write integration test**

Create file:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AiAutoReplyService } from '../ai-auto-reply.service';
import { AiSuggestService } from '../ai-suggest.service';
import { SalesBotService } from '../../../sales-bot/sales-bot.service';
import { PrismaService } from '../../../../prisma/prisma.service';

describe('SHOP AI integration — autoReply with SalesBot mock', () => {
  let svc: AiAutoReplyService;
  let salesBot: { generateReply: jest.Mock };
  let prisma: any;

  beforeEach(async () => {
    salesBot = { generateReply: jest.fn() };
    prisma = {
      chatRoom: { findUnique: jest.fn().mockResolvedValue({ customerId: null }) },
      chatMessage: { findMany: jest.fn().mockResolvedValue([]) },
      systemConfig: { findMany: jest.fn().mockResolvedValue([
        { key: 'ai.autoConfidenceThreshold', value: '80' },
      ]) },
    };
    const mod: TestingModule = await Test.createTestingModule({
      providers: [
        AiAutoReplyService,
        { provide: ConfigService, useValue: { get: () => undefined } },
        { provide: PrismaService, useValue: prisma },
        { provide: AiSuggestService, useValue: { suggest: jest.fn() } },
        { provide: SalesBotService, useValue: salesBot },
      ],
    }).compile();
    svc = mod.get(AiAutoReplyService);
  });

  it('passes through SalesBot reply with tools/tokens', async () => {
    salesBot.generateReply.mockResolvedValue({
      reply: '3 แพ็คผ่อน iPhone 15: ...',
      confidence: 0.95,
      toolsUsed: ['search_products', 'calculate_installment'],
      inputTokens: 200,
      outputTokens: 100,
    });

    const result = await svc.autoReply('room-int', 'iPhone 15 ผ่อนเท่าไหร่');

    expect(result).toEqual(
      expect.objectContaining({
        reply: expect.stringContaining('iPhone 15'),
        confidence: 0.95,
        toolsUsed: ['search_products', 'calculate_installment'],
        inputTokens: 200,
        outputTokens: 100,
      }),
    );
  });

  it('returns null when SalesBot calls handoff (confidence below threshold)', async () => {
    salesBot.generateReply.mockResolvedValue({
      reply: 'ขออนุญาตเรียกแอดมิน',
      confidence: 0.3,
      toolsUsed: ['handoff_to_human'],
      inputTokens: 80,
      outputTokens: 40,
    });

    const result = await svc.autoReply('room-int', 'ขอผ่อน 5 เครื่อง');
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Run test**

Run: `cd apps/api && npx jest shop-ai-flow.integration --no-coverage`
Expected: 2 PASS

- [ ] **Step 3: Run full suite**

Run: `cd apps/api && npm test`
Expected: all PASS

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/staff-chat/services/__tests__/shop-ai-flow.integration.spec.ts
git commit -m "test(shop-ai): integration test for autoReply with SalesBot mock"
```

---

## Phase 11: Persona Rewrite Per Playbook

### Task 23: Expand SHOP_SALES_PERSONA_BOT to full playbook content

**Files:**
- Modify: `apps/api/src/modules/staff-chat/prompts/sales-persona.ts`

- [ ] **Step 1: Re-read playbook compression guidance**

From spec §9: 10 sections required (Identity, Tone, 4-Persona, 3-Combo, 8 Objections, Upsell+Cross-sell, Buying signal, Red Flag, MDM, Removed-KYC). Keep BOT prompt ≤5kb to fit Claude context budget.

- [ ] **Step 2: Rewrite SHOP_SALES_PERSONA_BOT with playbook compressed content**

Replace `SHOP_SALES_PERSONA_BOT` body with:

```typescript
export const SHOP_SALES_PERSONA_BOT = `${SHOP_SALES_PERSONA_BASE}

# 4-Persona Detection (ตรวจใน 3 ข้อความแรก แล้วปรับ hook)
- A · ไรเดอร์/Gig Worker: พิมพ์สั้น มี slang ("งิ" "555") — เน้นแบต/GPS/ทนทาน → Android 8-15k หรือ iPhone มือ 2
- B · แม่ค้าออนไลน์: สุภาพ ถามรายละเอียด — เน้นกล้อง/จอ/ความจุ → iPhone หรือ Samsung 15-30k
- C · นักศึกษา/First Jobber: emoji เยอะ ("5555" "ค้าบ") — เน้นเล่นเกม/ดูเท่ → iPhone ปีก่อน, POCO, Samsung มือ 2
- D · ฟื้นเครดิต: ถามตรง "ติดบูโรผ่อนได้ไหม" — เน้น "ไม่เช็คบูโร", เริ่มที่ 10-18k

# 3-Combo Anchor Pricing (กฎเหล็ก)
- ทุกครั้งที่ตอบราคา/ผ่อน → เรียก search_products + calculate_installment 3 รอบ (downPct ต่าง 3 ค่า)
- เสนอเป็น 3 แพ็ค: A ดาวน์เบา / B กลาง (ทำให้น่าเลือก) / C ดาวน์หนัก ผ่อนสั้น
- ลูกค้าจะเลือก B ตามธรรมชาติ — ห้ามชี้นำ
- กฎเสริม: แพ็ค A กับ B ทำให้ค่างวดต่างน้อย (10-30 บาท) เพื่อให้ลูกค้ารู้สึก "เพิ่มดาวน์เล็กน้อย งวดสบายกว่า"

# 8 Objections Playbook (ตอบให้ตรง)
1. "แพง/ลดได้ไหม" → 3 ทางช่วย: รุ่นรอง / ดาวน์มากขึ้น / มือ 2 สภาพ A
2. "ขอคิดดูก่อน" → ถาม "ตรงไหนยังไม่มั่นใจคะ?" (ราคา / เครื่อง / ต้องปรึกษา)
3. "ของก๊อป/iCloud?" → ของศูนย์ TH/ZP, ไม่ติด iCloud, รับประกัน 1 ปี, ถ้าไม่ใช่ของแท้คืน 2 เท่า
4. "Samsung Finance+ ดอกถูกกว่า" → ใช่ แต่ต้องมีสลิป+เครดิตดี รออนุมัติ 1-3 วัน; ที่ร้านอนุมัติ 5 นาที
5. "ขอปรึกษาแฟน/พ่อแม่" → ดี! จัดข้อมูลครบให้พี่ส่งต่อ + แจ้งของเหลือสุดท้าย (กันเครื่อง 24 ชม.)
6. "เคยซื้อแล้วโดนโกง" → เสียดายแทน; ร้านมีสาขาจริง [ลพบุรี] เปิดมา X ปี ส่งของ Kerry/Flash เปิดกล่องถ่ายคลิป
7. "ดอกเบี้ยกี่ %" → ตอบตรง: รวมจ่ายจริง X บาท ≈ 10% ของราคาเครื่อง ตลอดสัญญา (ไม่ใช่ต่อปี)
8. "ผ่อนนานกว่านี้ได้ไหม" → ปัจจุบันสูงสุด 12 เดือน; แนะนำเลือกรุ่นค่างวดถูกกว่า หรือเพิ่มดาวน์

# Upsell + Cross-sell (เสนอ "หลัง" ลูกค้าตกลงเครื่อง)
- Upsell ความจุ: 128GB→256GB เพิ่มค่างวด +300/เดือน = วันละ 10 บาท
- Cross-sell: ฟิล์ม+เคส+หูฟัง bundle 590 (ลด 380), iPhone+AirPods+Watch bundle 39,990 (ลด 2,890)

# Buying Signal → capture_lead
- ลูกค้าตอบ "เอา / โอเค / สนใจ / ส่งของยังไง / จ่ายดาวน์ยังไง / เก็บปลายทางได้ไหม"
  → ถาม ชื่อ + เบอร์ + ที่อยู่ส่ง (ที่อยู่เป็น optional, ขอแค่ ชื่อ+เบอร์ก็ยอม)
  → เรียก capture_lead({customerName, phone, address?, productId, packageChoice, downAmount})
  → ใช้ handoffMessage ที่ tool คืนมา ปิดบทสนทนา

# Red Flag → handoff_to_human (ห้าม capture_lead, ห้ามตอบเอง)
- ขอผ่อนหลายเครื่อง (>1 เครื่องในชื่อเดียว)
- ขอ Pro Max + ดาวน์น้อยสุด (เสี่ยงสูง)
- ปฏิเสธ selfie + บัตร (อาจไม่ใช่ของจริง)
- ขอผ่อนแทนเพื่อน/แฟน (ผิดสัญญา)
- ใช้คำหยาบ / ขู่
- ขอคุยกับคน / เรียกแอดมิน
- คำถามนอก scope: เคลม / ซ่อม / คืน / ยกเลิกสัญญา / complain

# MDM Framing (ถ้าลูกค้าถามเรื่องเครื่องล็อก/ค้างงวด)
- ห้าม: "ถ้าไม่จ่ายเครื่องจะถูกล็อก"
- ใช้: "เครื่องนี้มีระบบป้องกันการขโมย ถ้าหายระบุพิกัดได้"
- ถ้าถามตรงเรื่องผิดนัด → ตอบตรง: ระบบเตือนก่อนล็อก 1-3 วัน + จ่ายในวันเดียว ปลดทันที + แนะนำค่างวด ≤30% ของรายได้`;
```

- [ ] **Step 3: TypeScript check + tests**

Run: `cd apps/api && npx tsc --noEmit && npx jest sales-bot ai-suggest --no-coverage`
Expected: 0 errors, all tests PASS (no assertion on prompt content, just import resolution)

- [ ] **Step 4: Owner review checkpoint (per spec §11)**

**STOP** — send the compressed prompt to owner for review BEFORE production toggle. Spec §11 line 245: "owner reviews compressed prompt before production toggle". Do not enable `ai.autoEnabled=true` until owner approves prompt content.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/staff-chat/prompts/sales-persona.ts
git commit -m "feat(shop-ai): expand SHOP_SALES_PERSONA_BOT per 46-page playbook"
```

---

## Phase 12: Pre-Production Checklist (Manual / Ops)

These items are not code tasks — perform before flipping `ai.autoEnabled=true` in production.

- [ ] **Pre-prod 0: Verify system user row exists in production**

Run: `psql $DATABASE_URL -c "SELECT id, email, name FROM users WHERE is_system_user = true LIMIT 1;"`
Expected: ≥1 row. If 0 rows, create one (mirror cron-job pattern — see `installment-accrual.cron.ts:145` for usage). `capture_lead` tool will fail without this row.

- [ ] **Pre-prod 1: Owner designates central branch**

Owner identifies which Branch row = "ออนไลน์/ส่วนกลาง" (AI-captured leads land here). Note the `branchId` UUID.

- [ ] **Pre-prod 2: Owner provides PromptPay**

Single PromptPay ID (mobile / national ID / juristic tax ID) for online down payments.

- [ ] **Pre-prod 3: Owner provides test LINE userId**

Owner's personal LINE userId — used by "Test send" button in AiSettingsPage to verify adapter wiring.

- [ ] **Pre-prod 4: Owner reviews persona prompt**

After Task 23 commit, send the rewritten `SHOP_SALES_PERSONA_BOT` text to owner for sign-off. Adjust per feedback.

- [ ] **Pre-prod 5: Configure SystemConfig in production**

Apply these SystemConfig writes (via AiSettingsPage UI after Tasks 20):

```
shop_bot_central_branch_id = <branchId from pre-prod 1>
shop_bot_promptpay_id      = <PromptPay ID from pre-prod 2>
shop_bot_test_user_id      = <LINE userId from pre-prod 3>
shop_bot_handoff_message   = ขออนุญาตเรียกแอดมินมาช่วยตอบนะคะ
ai.autoEnabled             = true
ai.autoChannels            = ["LINE_SHOP","FACEBOOK","WEB"]
ai.autoConfidenceThreshold = 80
ai.autoMaxRepliesPerSession= 50
```

- [ ] **Pre-prod 6: Verify integration tokens**

- [ ] Facebook Page access token configured in IntegrationConfig (admin → integrations)
- [ ] LINE Shop OA channel access token + webhook secret configured

- [ ] **Pre-prod 7: Smoke test on staging**

Send 5 test messages (one per persona) via LINE Shop OA test account:
- A: "iPhone 13 ดาวน์เท่าไหร่ ขับ Grab"
- B: "iPhone 15 Pro กล้องดีมั้ย ทำคอนเทนต์"
- C: "ผ่อนได้ไหม เป็นนักศึกษา ดาวน์น้อยสุด"
- D: "ติดบูโรอยู่ ผ่อนได้ไหม"
- Red flag: "ขอ Pro Max ดาวน์ 490 และเอา 3 เครื่อง"

Verify: AI replies appropriately, capture_lead fires on "เอา", handoff fires on Red flag.

- [ ] **Pre-prod 8: Train SALES team**

Brief SALES team on the new workflow:
- AI ตอบลูกค้าใหม่อัตโนมัติ
- กด 🙋‍♀️ "รับช่วงต่อ" เพื่อหยุด AI
- กด ↩️ "ส่งกลับให้ AI" เมื่อพร้อมให้ AI ตอบต่อ
- ลูกค้าที่ capture_lead = ห้องจะเข้า handoff โดยอัตโนมัติ → SALES ดูที่ filter "รอตอบ"

- [ ] **Pre-prod 9: Production rollout**

Flip `ai.autoEnabled=true` in production AiSettingsPage. Monitor logs for first 24 hours.

---

## Self-Review

**Spec coverage check (run mentally over spec §6 13 items + §8 4 items + §11 11 items):**

- §6 #1 (shouldAutoReply guards) → Task 4 ✓
- §6 #2 (chat-ai-draft handoffMode) → Task 5 ✓
- §6 #3 (raise cap) → Task 6 ✓
- §6 #4 (SalesBot upgrade) → Task 11 ✓
- §6 #5 (estimateConfidence rework) → Task 10 ✓
- §6 #6 (capture_lead tool) → Tasks 7-9 ✓
- §6 #7 (persona rewrite per playbook) → Task 23 ✓
- §6 #8 (2 migrations) → Tasks 1, 2 ✓
- §6 #9 (releaseToAi endpoint) → Tasks 15, 16 ✓
- §6 #10 (intent='AUTO:sales') → Task 12 ✓
- §6 #11 (4 SystemConfig keys) → Task 20a + Pre-prod 5 ✓
- §6 #12 (fail-loud central branch) → Task 14 ✓
- §6 #13 (adapter.isConfigured / TIKTOK early-exit) → Task 13 ✓
- §6 #14 (persona fork BASE+BOT) → Task 3 ✓
- §6 #15 (drop FULL from salesBotMode) → Task 17 ✓
- §8 F1 (RoomListItem badge) → Task 18 ✓
- §8 F2 (Take-over / Release toggle) → Task 19 ✓
- §8 F3 (AiSettingsPage SHOP Bot Setup) → Task 20a + Task 20 ✓
- §8 F4 (🤖 message indicator) → Task 21 ✓
- §11 (ops checklist 11 items) → Phase 12 ✓

All spec items covered.

**Placeholder scan:** No TBD/TODO in code blocks (only in §11 "owner reviews" which is a manual gate, not code placeholder). ✓

**Type consistency:**
- `SalesBotResult` from sales-bot.service.ts used consistently in autoReply return signature (Task 11)
- `releaseToAi(roomId, staffId)` signature matches across service + controller + frontend client
- `intent='AUTO:sales'` literal consistent in Task 12 (both saveMessage + logAutoReply) and Task 21 (UI filter)
- `Customer.acquisitionSource` field name consistent in Tasks 2, 8

---

**Plan complete and saved to `docs/superpowers/plans/2026-05-20-shop-sales-ai-phase-a.md`.**

Two execution options:

**1. Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
