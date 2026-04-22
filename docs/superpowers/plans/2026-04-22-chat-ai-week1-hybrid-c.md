# Chat AI — Week 1 Hybrid C MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Hybrid C mode by end of Week 1 — staff use a new `/chat` unified inbox that shows every LINE + Facebook conversation, with an AI assistant sidebar that drafts replies (Sales bot or Service bot) for the staff to approve, edit, or skip. No auto-send yet.

**Architecture:** Add one intent router (Claude Haiku) in front of two persona bots — new `sales-bot` module and enhanced existing `chatbot-finance` ("น้องเบส"). Reuse existing `staff-chat/` backend for room/message storage. Build new `/chat` React page with 3-column layout consuming staff-chat APIs plus a new `/api/chat-ai/draft` endpoint. One-off batch extracts 12 months of historical LINE + Facebook conversations into `AiTrainingPair` and seeds `ChatKnowledgeBase`.

**Tech Stack:** NestJS 11 + Prisma 6 (existing), Claude **Sonnet 4.6** for all customer-facing replies (sales bot + น้องเบส) via `@anthropic-ai/sdk`, Claude **Haiku 4.5** kept for internal-only routing/classification/extraction (intent router, knowledge batch extractor), React 18 + Vite 6 + shadcn/ui + @tanstack/react-query (existing), Zustand (existing), Facebook Graph API v19.

**Model policy:**
- `claude-sonnet-4-6` → Sales Bot, น้องเบส reply generation (customer reads the output)
- `claude-haiku-4-5-20251001` → Intent Router (fast classify), Knowledge Extractor (batch job, no customer)

**Spec:** `docs/superpowers/specs/2026-04-22-chat-ai-unified-inbox-design.md`
**Predecessors:** Existing `chatbot-finance/` + `staff-chat/` modules, `ChatRoom` + `ChatMessage` + `ChatKnowledgeBase` + `AiTrainingPair` + `AiAutoReplyLog` tables.
**Successors:** `docs/superpowers/plans/2026-04-29-chat-ai-week2-full-a.md` (Week 2 — RAG, autonomous mode, guardrails, rollout — to be written after Week 1 learnings).

---

## File Structure

### New backend files

```
apps/api/src/modules/
├── chat-intent-router/
│   ├── chat-intent-router.module.ts
│   ├── chat-intent-router.service.ts            # Claude Haiku classifier
│   └── chat-intent-router.service.spec.ts
├── sales-bot/
│   ├── sales-bot.module.ts
│   ├── sales-bot.service.ts                     # Main reply generator
│   ├── sales-bot.service.spec.ts
│   ├── prompts/sales-bot.system.ts              # Persona + instructions
│   └── tools/
│       ├── search-products.tool.ts
│       ├── calculate-installment.tool.ts
│       ├── list-promotions.tool.ts
│       └── handoff-to-human.tool.ts
├── chat-ai-draft/
│   ├── chat-ai-draft.module.ts
│   ├── chat-ai-draft.controller.ts              # POST /api/chat-ai/draft, POST /approve, POST /skip
│   ├── chat-ai-draft.service.ts                 # Orchestrates router + bot; writes draft ChatMessage
│   └── chat-ai-draft.service.spec.ts
└── chat-history-extractor/
    ├── chat-history-extractor.module.ts
    ├── chat-history-extractor.controller.ts     # POST /api/chat-history/extract (OWNER only)
    ├── chat-history-extractor.service.ts        # Orchestrator
    ├── sources/line-extractor.source.ts         # Pulls LINE rooms from existing ChatMessage
    ├── sources/facebook-extractor.source.ts     # Facebook Graph API
    ├── pii-scrubber.util.ts                     # Strip ID, DOB; hash phone
    └── knowledge-extractor.service.ts           # Claude batch → ChatKnowledgeBase
```

### Modified backend files

```
apps/api/src/modules/chatbot-finance/services/
└── finance-ai.service.ts                        # Add full-history-window injection

apps/api/src/app.module.ts                       # Register new modules
apps/api/prisma/schema.prisma                    # Add ChatRoom.aiPaused, AiSettings.salesBotMode, .serviceBotMode
```

### New frontend files

```
apps/web/src/pages/chat/
├── ChatInboxPage.tsx                            # Main /chat page
├── components/
│   ├── RoomList.tsx                             # Left column
│   ├── RoomListItem.tsx
│   ├── RoomFilters.tsx
│   ├── ConversationPanel.tsx                    # Center column
│   ├── MessageBubble.tsx
│   ├── ComposeBox.tsx
│   ├── AssistantSidebar.tsx                     # Right column
│   ├── CustomerCard.tsx
│   ├── AiDraftCard.tsx
│   └── SuggestedActions.tsx
├── hooks/
│   ├── useRooms.ts                              # react-query
│   ├── useRoomMessages.ts
│   └── useAiDraft.ts
└── lib/
    └── chat-api.ts                              # Typed API client
```

### Modified frontend files

```
apps/web/src/App.tsx                             # Add /chat lazy route
apps/web/src/components/MainLayout.tsx           # Add "สื่อสาร" nav item
apps/web/src/pages/AiSettingsPage.tsx            # Add per-bot mode toggle
```

---

## Task 1: Prisma schema — aiPaused flag + per-bot mode setting

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create migration: `apps/api/prisma/migrations/<timestamp>_chat_ai_hybrid_c/migration.sql`

**Context:** Hybrid C needs staff to be able to "take over" a room (pause AI). It also needs a per-bot mode switch (`OFF | HYBRID | FULL`). We extend `ChatRoom` with `aiPaused` and `pausedByUserId`, and add `salesBotMode` + `serviceBotMode` to `AiSettings` (if it exists — if not, add a single-row `AiSettings` table).

- [ ] **Step 1: Check if `AiSettings` model exists**

```bash
grep -n "^model AiSettings" apps/api/prisma/schema.prisma
```
If it exists, go to Step 2. If not, go to Step 1a.

- [ ] **Step 1a: (only if AiSettings missing) Add AiSettings model near end of schema.prisma**

```prisma
/// Single-row settings for AI behavior (id = 'singleton')
model AiSettings {
  id               String   @id @default("singleton")
  salesBotMode     String   @default("HYBRID") // OFF | HYBRID | FULL
  serviceBotMode   String   @default("HYBRID")
  salesBotConfidenceThreshold Float @default(0.70)
  serviceBotConfidenceThreshold Float @default(0.75)
  updatedAt        DateTime @updatedAt
  updatedById      String?  @map("updated_by_id")
  updatedBy        User?    @relation("AiSettingsUpdatedBy", fields: [updatedById], references: [id])

  @@map("ai_settings")
}
```
Also add the reverse relation inside `model User { ... }`: `aiSettingsUpdates AiSettings[] @relation("AiSettingsUpdatedBy")`.

- [ ] **Step 2: Add aiPaused fields to ChatRoom (around line 3665, after `totalMessages`)**

```prisma
  // AI pause state (Hybrid C take-over)
  aiPaused       Boolean   @default(false) @map("ai_paused")
  aiPausedAt     DateTime? @map("ai_paused_at")
  aiPausedById   String?   @map("ai_paused_by_id")
  aiPausedBy     User?     @relation("ChatRoomAiPausedBy", fields: [aiPausedById], references: [id])
```

Also add reverse relation inside `model User { ... }`: `aiPausedRooms ChatRoom[] @relation("ChatRoomAiPausedBy")`.

- [ ] **Step 3: (only if Step 1a added new fields) Update existing AiSettings fields**

If `AiSettings` already existed, add only the fields we're missing:
```prisma
  salesBotMode     String   @default("HYBRID")
  serviceBotMode   String   @default("HYBRID")
  salesBotConfidenceThreshold Float @default(0.70)
  serviceBotConfidenceThreshold Float @default(0.75)
```

- [ ] **Step 4: Generate migration**

```bash
cd apps/api && npx prisma migrate dev --name chat_ai_hybrid_c --create-only
```
Expected: new folder under `prisma/migrations/` with `migration.sql`. Open it and verify it only adds columns (no drops).

- [ ] **Step 5: Apply migration locally**

```bash
cd apps/api && npx prisma migrate dev
```
Expected: migration applied; `npx prisma generate` runs.

- [ ] **Step 6: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations/
git commit -m "feat(chat-ai): add aiPaused on ChatRoom + per-bot mode on AiSettings"
```

---

## Task 2: Chat history extractor — LINE source (from existing ChatMessage)

**Files:**
- Create: `apps/api/src/modules/chat-history-extractor/sources/line-extractor.source.ts`
- Create: `apps/api/src/modules/chat-history-extractor/sources/line-extractor.source.spec.ts`

**Context:** All LINE messages since the Finance OA bot was connected already live in `ChatMessage` (the webhook writer has been running). This source just reads those rooms directly — no external API call needed. Gap for pre-bot-connection rooms is handled by a manual CSV upload (Task 4 covers the importer).

- [ ] **Step 1: Write failing test**

```typescript
// apps/api/src/modules/chat-history-extractor/sources/line-extractor.source.spec.ts
import { Test } from '@nestjs/testing';
import { LineExtractorSource } from './line-extractor.source';
import { PrismaService } from '../../../prisma/prisma.service';

describe('LineExtractorSource', () => {
  let source: LineExtractorSource;
  let prisma: { chatMessage: { findMany: jest.Mock } };

  beforeEach(async () => {
    prisma = { chatMessage: { findMany: jest.fn() } };
    const mod = await Test.createTestingModule({
      providers: [LineExtractorSource, { provide: PrismaService, useValue: prisma }],
    }).compile();
    source = mod.get(LineExtractorSource);
  });

  it('extracts LINE messages grouped by room, oldest first', async () => {
    prisma.chatMessage.findMany.mockResolvedValue([
      { id: 'm1', roomId: 'r1', role: 'CUSTOMER', text: 'สวัสดี', createdAt: new Date('2026-01-01') },
      { id: 'm2', roomId: 'r1', role: 'STAFF', text: 'สวัสดีครับ', createdAt: new Date('2026-01-01T00:01:00') },
    ]);
    const result = await source.extract({ channel: 'LINE_FINANCE', since: new Date('2025-04-22') });
    expect(result).toHaveLength(2);
    expect(result[0].roomId).toBe('r1');
    expect(result[0].text).toBe('สวัสดี');
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

```bash
cd apps/api && npx jest src/modules/chat-history-extractor/sources/line-extractor.source.spec.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement source**

```typescript
// apps/api/src/modules/chat-history-extractor/sources/line-extractor.source.ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

export interface ExtractedMessage {
  roomId: string;
  channel: 'LINE_FINANCE' | 'FACEBOOK';
  role: 'CUSTOMER' | 'STAFF';
  text: string;
  createdAt: Date;
  externalMessageId?: string;
}

@Injectable()
export class LineExtractorSource {
  constructor(private readonly prisma: PrismaService) {}

  async extract(opts: { channel: 'LINE_FINANCE'; since: Date }): Promise<ExtractedMessage[]> {
    const rows = await this.prisma.chatMessage.findMany({
      where: {
        room: { channel: opts.channel },
        createdAt: { gte: opts.since },
        deletedAt: null,
        text: { not: null },
      },
      orderBy: [{ roomId: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, roomId: true, role: true, text: true, createdAt: true, externalMessageId: true },
    });
    return rows
      .filter((r): r is typeof r & { text: string } => r.text !== null)
      .map((r) => ({
        roomId: r.roomId,
        channel: 'LINE_FINANCE',
        role: r.role === 'STAFF' || r.role === 'AI' ? 'STAFF' : 'CUSTOMER',
        text: r.text,
        createdAt: r.createdAt,
        externalMessageId: r.externalMessageId ?? undefined,
      }));
  }
}
```

- [ ] **Step 4: Run test again, verify it passes**

```bash
cd apps/api && npx jest src/modules/chat-history-extractor/sources/line-extractor.source.spec.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/chat-history-extractor/sources/line-extractor.source.ts apps/api/src/modules/chat-history-extractor/sources/line-extractor.source.spec.ts
git commit -m "feat(chat-extractor): LINE source reads existing ChatMessage rows"
```

---

## Task 3: Chat history extractor — Facebook Graph API source

**Files:**
- Create: `apps/api/src/modules/chat-history-extractor/sources/facebook-extractor.source.ts`
- Create: `apps/api/src/modules/chat-history-extractor/sources/facebook-extractor.source.spec.ts`
- Modify: `apps/api/.env.example` — add `FACEBOOK_PAGE_ACCESS_TOKEN`, `FACEBOOK_PAGE_ID`

**Context:** Facebook chat history is NOT in `ChatMessage` yet (we only just connected FB in `#606` area — minimal history). Use Graph API `/v19.0/{pageId}/conversations?fields=participants,messages{message,from,created_time}&limit=100` with pagination.

- [ ] **Step 1: Add env vars to .env.example**

```bash
# Append to apps/api/.env.example
echo '
# Facebook Page (for historical chat extractor + live webhook)
FACEBOOK_PAGE_ACCESS_TOKEN=
FACEBOOK_PAGE_ID=' >> apps/api/.env.example
```

- [ ] **Step 2: Write failing test**

```typescript
// apps/api/src/modules/chat-history-extractor/sources/facebook-extractor.source.spec.ts
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { FacebookExtractorSource } from './facebook-extractor.source';

describe('FacebookExtractorSource', () => {
  let source: FacebookExtractorSource;
  let fetchMock: jest.SpyInstance;

  beforeEach(async () => {
    const mod = await Test.createTestingModule({
      providers: [
        FacebookExtractorSource,
        {
          provide: ConfigService,
          useValue: {
            get: (k: string) =>
              ({ FACEBOOK_PAGE_ACCESS_TOKEN: 'tok', FACEBOOK_PAGE_ID: 'page123' }[k]),
          },
        },
      ],
    }).compile();
    source = mod.get(FacebookExtractorSource);
    fetchMock = jest.spyOn(global, 'fetch');
  });

  afterEach(() => fetchMock.mockRestore());

  it('extracts messages from paginated conversations', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [
          {
            id: 'conv1',
            participants: { data: [{ id: 'user1', name: 'A' }, { id: 'page123', name: 'Page' }] },
            messages: {
              data: [
                { id: 'm1', message: 'Hi', from: { id: 'user1' }, created_time: '2026-02-01T00:00:00+0000' },
                { id: 'm2', message: 'Hello!', from: { id: 'page123' }, created_time: '2026-02-01T00:01:00+0000' },
              ],
            },
          },
        ],
        paging: {},
      }),
    } as any);
    const result = await source.extract({ since: new Date('2025-04-22') });
    expect(result).toHaveLength(2);
    expect(result[0].role).toBe('CUSTOMER');
    expect(result[1].role).toBe('STAFF');
    expect(result[0].roomId).toBe('fb:conv1');
  });
});
```

- [ ] **Step 3: Run test, verify it fails**

```bash
cd apps/api && npx jest src/modules/chat-history-extractor/sources/facebook-extractor.source.spec.ts
```
Expected: FAIL.

- [ ] **Step 4: Implement Facebook source**

```typescript
// apps/api/src/modules/chat-history-extractor/sources/facebook-extractor.source.ts
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ExtractedMessage } from './line-extractor.source';

interface FbMessage {
  id: string;
  message?: string;
  from: { id: string; name?: string };
  created_time: string;
}
interface FbConversation {
  id: string;
  participants: { data: { id: string; name?: string }[] };
  messages: { data: FbMessage[]; paging?: { next?: string } };
}
interface FbConversationsPage {
  data: FbConversation[];
  paging?: { next?: string };
}

@Injectable()
export class FacebookExtractorSource {
  private readonly logger = new Logger(FacebookExtractorSource.name);
  private readonly token: string;
  private readonly pageId: string;

  constructor(config: ConfigService) {
    this.token = config.get<string>('FACEBOOK_PAGE_ACCESS_TOKEN') ?? '';
    this.pageId = config.get<string>('FACEBOOK_PAGE_ID') ?? '';
  }

  async extract(opts: { since: Date }): Promise<ExtractedMessage[]> {
    if (!this.token || !this.pageId) {
      this.logger.warn('Facebook extractor skipped — no token/pageId');
      return [];
    }
    const out: ExtractedMessage[] = [];
    let url: string | null = `https://graph.facebook.com/v19.0/${this.pageId}/conversations?fields=participants,messages{message,from,created_time}&limit=100&access_token=${this.token}`;
    while (url) {
      const res: Response = await fetch(url);
      if (!res.ok) throw new Error(`FB Graph ${res.status}: ${await res.text()}`);
      const page = (await res.json()) as FbConversationsPage;
      for (const conv of page.data) {
        for (const m of conv.messages?.data ?? []) {
          if (!m.message) continue;
          const created = new Date(m.created_time);
          if (created < opts.since) continue;
          out.push({
            roomId: `fb:${conv.id}`,
            channel: 'FACEBOOK',
            role: m.from.id === this.pageId ? 'STAFF' : 'CUSTOMER',
            text: m.message,
            createdAt: created,
            externalMessageId: m.id,
          });
        }
      }
      url = page.paging?.next ?? null;
    }
    return out;
  }
}
```

- [ ] **Step 5: Run test, verify it passes**

```bash
cd apps/api && npx jest src/modules/chat-history-extractor/sources/facebook-extractor.source.spec.ts
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/chat-history-extractor/sources/facebook-extractor.source.ts apps/api/src/modules/chat-history-extractor/sources/facebook-extractor.source.spec.ts apps/api/.env.example
git commit -m "feat(chat-extractor): Facebook Graph API source with pagination"
```

---

## Task 4: PII scrubber + extractor orchestrator + admin endpoint

**Files:**
- Create: `apps/api/src/modules/chat-history-extractor/pii-scrubber.util.ts`
- Create: `apps/api/src/modules/chat-history-extractor/pii-scrubber.util.spec.ts`
- Create: `apps/api/src/modules/chat-history-extractor/chat-history-extractor.service.ts`
- Create: `apps/api/src/modules/chat-history-extractor/chat-history-extractor.controller.ts`
- Create: `apps/api/src/modules/chat-history-extractor/chat-history-extractor.module.ts`
- Modify: `apps/api/src/app.module.ts` — register module

**Context:** PII scrubber strips 13-digit Thai IDs and redacts full DOB. Phone numbers are preserved in AiTrainingPair (for customer linking at display) but will be hashed when we build the RAG index (Week 2). Orchestrator calls both sources, scrubs, writes `AiTrainingPair` rows in pairs (customer-question → staff-answer). Controller is OWNER-only.

- [ ] **Step 1: Write PII scrubber test**

```typescript
// apps/api/src/modules/chat-history-extractor/pii-scrubber.util.spec.ts
import { scrubPii } from './pii-scrubber.util';

describe('scrubPii', () => {
  it('redacts Thai 13-digit national ID', () => {
    expect(scrubPii('เลขบัตร 1234567890123 ครับ')).toBe('เลขบัตร [REDACTED_ID] ครับ');
  });
  it('redacts full DOB dd/mm/yyyy', () => {
    expect(scrubPii('เกิด 15/07/1990')).toBe('เกิด [REDACTED_DOB]');
  });
  it('preserves phone numbers', () => {
    expect(scrubPii('โทร 0812345678')).toBe('โทร 0812345678');
  });
  it('preserves normal money numbers', () => {
    expect(scrubPii('ราคา 15,900 บาท')).toBe('ราคา 15,900 บาท');
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

```bash
cd apps/api && npx jest src/modules/chat-history-extractor/pii-scrubber.util.spec.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement scrubber**

```typescript
// apps/api/src/modules/chat-history-extractor/pii-scrubber.util.ts
const THAI_ID_RE = /\b\d{13}\b/g;
const DOB_RE = /\b(0?[1-9]|[12]\d|3[01])\/(0?[1-9]|1[0-2])\/(19|20)\d{2}\b/g;

export function scrubPii(text: string): string {
  return text.replace(THAI_ID_RE, '[REDACTED_ID]').replace(DOB_RE, '[REDACTED_DOB]');
}
```

- [ ] **Step 4: Verify test passes**

```bash
cd apps/api && npx jest src/modules/chat-history-extractor/pii-scrubber.util.spec.ts
```
Expected: PASS.

- [ ] **Step 5: Write extractor service**

```typescript
// apps/api/src/modules/chat-history-extractor/chat-history-extractor.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { LineExtractorSource, ExtractedMessage } from './sources/line-extractor.source';
import { FacebookExtractorSource } from './sources/facebook-extractor.source';
import { scrubPii } from './pii-scrubber.util';

@Injectable()
export class ChatHistoryExtractorService {
  private readonly logger = new Logger(ChatHistoryExtractorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly lineSrc: LineExtractorSource,
    private readonly fbSrc: FacebookExtractorSource,
  ) {}

  async extractAll(months: number): Promise<{ lineCount: number; fbCount: number; pairsWritten: number }> {
    const since = new Date();
    since.setMonth(since.getMonth() - months);

    this.logger.log(`Extracting from ${since.toISOString()} onward`);
    const [lineMsgs, fbMsgs] = await Promise.all([
      this.lineSrc.extract({ channel: 'LINE_FINANCE', since }),
      this.fbSrc.extract({ since }),
    ]);

    const all = [...lineMsgs, ...fbMsgs].map((m) => ({ ...m, text: scrubPii(m.text) }));
    const pairs = this.buildPairs(all);

    // Write in batches to avoid huge transactions
    const BATCH = 500;
    let written = 0;
    for (let i = 0; i < pairs.length; i += BATCH) {
      const batch = pairs.slice(i, i + BATCH);
      await this.prisma.aiTrainingPair.createMany({
        data: batch.map((p) => ({
          type: 'ACCEPT',
          source: 'SYSTEM_EXTRACT',
          roomId: null, // historical pairs may not map to a current ChatRoom row
          customerMessage: p.customerMessage,
          aiDraft: null,
          humanEdit: p.staffAnswer,
          intent: null,
          quality: null,
        })),
        skipDuplicates: true,
      });
      written += batch.length;
    }

    return { lineCount: lineMsgs.length, fbCount: fbMsgs.length, pairsWritten: written };
  }

  private buildPairs(msgs: ExtractedMessage[]): { customerMessage: string; staffAnswer: string }[] {
    // Group by roomId, then pair each CUSTOMER message with the next STAFF message in the same room
    const byRoom = new Map<string, ExtractedMessage[]>();
    for (const m of msgs) {
      const arr = byRoom.get(m.roomId) ?? [];
      arr.push(m);
      byRoom.set(m.roomId, arr);
    }
    const pairs: { customerMessage: string; staffAnswer: string }[] = [];
    for (const arr of byRoom.values()) {
      arr.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      for (let i = 0; i < arr.length; i++) {
        if (arr[i].role !== 'CUSTOMER') continue;
        const next = arr.slice(i + 1).find((m) => m.role === 'STAFF');
        if (next) pairs.push({ customerMessage: arr[i].text, staffAnswer: next.text });
      }
    }
    return pairs;
  }
}
```

- [ ] **Step 6: Write controller**

```typescript
// apps/api/src/modules/chat-history-extractor/chat-history-extractor.controller.ts
import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { ChatHistoryExtractorService } from './chat-history-extractor.service';

@Controller('chat-history')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ChatHistoryExtractorController {
  constructor(private readonly svc: ChatHistoryExtractorService) {}

  @Post('extract')
  @Roles('OWNER')
  async extract(@Body() body: { months?: number }) {
    return this.svc.extractAll(body.months ?? 12);
  }
}
```

- [ ] **Step 7: Write module**

```typescript
// apps/api/src/modules/chat-history-extractor/chat-history-extractor.module.ts
import { Module } from '@nestjs/common';
import { ChatHistoryExtractorService } from './chat-history-extractor.service';
import { ChatHistoryExtractorController } from './chat-history-extractor.controller';
import { LineExtractorSource } from './sources/line-extractor.source';
import { FacebookExtractorSource } from './sources/facebook-extractor.source';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [ChatHistoryExtractorController],
  providers: [ChatHistoryExtractorService, LineExtractorSource, FacebookExtractorSource],
})
export class ChatHistoryExtractorModule {}
```

- [ ] **Step 8: Register in app.module.ts**

Find the `imports` array in `apps/api/src/app.module.ts` and add:
```typescript
import { ChatHistoryExtractorModule } from './modules/chat-history-extractor/chat-history-extractor.module';
// ... inside imports:
ChatHistoryExtractorModule,
```

- [ ] **Step 9: Run type check + tests**

```bash
./tools/check-types.sh api
cd apps/api && npx jest src/modules/chat-history-extractor/
```
Expected: no TS errors, all tests pass.

- [ ] **Step 10: Commit**

```bash
git add apps/api/src/modules/chat-history-extractor/ apps/api/src/app.module.ts
git commit -m "feat(chat-extractor): orchestrator + PII scrubber + admin endpoint"
```

---

## Task 5: Knowledge extractor — Claude reads AiTrainingPair → seeds ChatKnowledgeBase

**Files:**
- Create: `apps/api/src/modules/chat-history-extractor/knowledge-extractor.service.ts`
- Create: `apps/api/src/modules/chat-history-extractor/knowledge-extractor.service.spec.ts`
- Modify: `chat-history-extractor.controller.ts` — add `POST /chat-history/extract-knowledge`
- Modify: `chat-history-extractor.module.ts` — add provider

**Context:** After Task 4 fills `AiTrainingPair`, we batch-feed pairs to Claude Haiku asking for structured JSON: `{ faqs: [{ intent, triggerKeywords, responseTemplate }], objections: [{ keyword, bestResponse }] }`. We upsert into `ChatKnowledgeBase` with `responseType='info'` (marked as derived — staff review in AiSettings before enabling `requiresAuth=false` auto-reply).

- [ ] **Step 1: Write test**

```typescript
// apps/api/src/modules/chat-history-extractor/knowledge-extractor.service.spec.ts
import { Test } from '@nestjs/testing';
import { KnowledgeExtractorService } from './knowledge-extractor.service';
import { PrismaService } from '../../prisma/prisma.service';
import Anthropic from '@anthropic-ai/sdk';

jest.mock('@anthropic-ai/sdk');

describe('KnowledgeExtractorService', () => {
  it('parses Claude response and upserts to ChatKnowledgeBase', async () => {
    const mockCreate = jest.fn().mockResolvedValue({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            faqs: [
              {
                intent: 'installment_rate',
                triggerKeywords: ['ดอก', 'กี่เปอร์เซ็นต์'],
                exampleQuestions: ['ดอกเบี้ยกี่เปอร์เซ็นต์'],
                responseTemplate: 'ผ่อน 0% สูงสุด 12 งวดค่ะ',
              },
            ],
            objections: [],
          }),
        },
      ],
    });
    (Anthropic as unknown as jest.Mock).mockImplementation(() => ({
      messages: { create: mockCreate },
    }));

    const prisma = {
      aiTrainingPair: {
        findMany: jest.fn().mockResolvedValue([
          { customerMessage: 'ดอกกี่เปอร์เซ็นต์', humanEdit: 'ผ่อน 0% ค่ะ' },
        ]),
      },
      chatKnowledgeBase: {
        upsert: jest.fn().mockResolvedValue({ id: 'kb1' }),
      },
    };

    const mod = await Test.createTestingModule({
      providers: [KnowledgeExtractorService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    const svc = mod.get(KnowledgeExtractorService);

    const result = await svc.extractAndSeed();
    expect(result.faqsSeeded).toBe(1);
    expect(prisma.chatKnowledgeBase.upsert).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test, verify fails**

```bash
cd apps/api && npx jest src/modules/chat-history-extractor/knowledge-extractor.service.spec.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement knowledge extractor**

```typescript
// apps/api/src/modules/chat-history-extractor/knowledge-extractor.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import Anthropic from '@anthropic-ai/sdk';

interface ExtractedFaq {
  intent: string;
  triggerKeywords: string[];
  exampleQuestions: string[];
  responseTemplate: string;
}
interface ExtractedObjection {
  keyword: string;
  bestResponse: string;
}

const SYSTEM_PROMPT = `You are extracting FAQ and sales-objection patterns from historical BESTCHOICE chat logs.
Return ONLY valid JSON matching this schema:
{
  "faqs": [{ "intent": string, "triggerKeywords": string[], "exampleQuestions": string[], "responseTemplate": string }],
  "objections": [{ "keyword": string, "bestResponse": string }]
}
Thai text is expected. Merge duplicate FAQs. Pick the BEST staff response as responseTemplate. Max 30 FAQs, 20 objections.`;

@Injectable()
export class KnowledgeExtractorService {
  private readonly logger = new Logger(KnowledgeExtractorService.name);
  private readonly client = new Anthropic();

  constructor(private readonly prisma: PrismaService) {}

  async extractAndSeed(): Promise<{ faqsSeeded: number; objectionsSeeded: number }> {
    const pairs = await this.prisma.aiTrainingPair.findMany({
      where: { source: 'SYSTEM_EXTRACT' },
      take: 2000,
      orderBy: { createdAt: 'desc' },
      select: { customerMessage: true, humanEdit: true },
    });
    if (pairs.length === 0) return { faqsSeeded: 0, objectionsSeeded: 0 };

    const userContent =
      'Here are the chat pairs (customer → staff):\n\n' +
      pairs
        .map((p, i) => `${i + 1}. C: ${p.customerMessage}\n   S: ${p.humanEdit}`)
        .join('\n\n');

    const resp = await this.client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 8000,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userContent }],
    });
    const textBlock = resp.content.find((c) => c.type === 'text');
    if (!textBlock || textBlock.type !== 'text') throw new Error('Claude returned no text');

    const parsed = JSON.parse(textBlock.text) as { faqs: ExtractedFaq[]; objections: ExtractedObjection[] };

    for (const faq of parsed.faqs) {
      await this.prisma.chatKnowledgeBase.upsert({
        where: { id: `extracted:${faq.intent}` },
        create: {
          id: `extracted:${faq.intent}`,
          channel: 'LINE_FINANCE',
          category: 'EXTRACTED',
          intent: faq.intent,
          triggerKeywords: faq.triggerKeywords,
          exampleQuestions: faq.exampleQuestions,
          responseTemplate: faq.responseTemplate,
          responseType: 'info',
          requiresAuth: true,
          requiresTools: [],
          active: false, // owner reviews before enabling
          priority: 0,
        },
        update: {
          triggerKeywords: faq.triggerKeywords,
          exampleQuestions: faq.exampleQuestions,
          responseTemplate: faq.responseTemplate,
        },
      });
    }

    return { faqsSeeded: parsed.faqs.length, objectionsSeeded: parsed.objections.length };
  }
}
```

- [ ] **Step 4: Add endpoint**

```typescript
// In chat-history-extractor.controller.ts, add:
@Post('extract-knowledge')
@Roles('OWNER')
async extractKnowledge() {
  return this.knowledgeSvc.extractAndSeed();
}
```
And inject `private readonly knowledgeSvc: KnowledgeExtractorService` into the constructor.

- [ ] **Step 5: Add provider to module**

```typescript
// In chat-history-extractor.module.ts, add to providers:
KnowledgeExtractorService,
```

- [ ] **Step 6: Run tests + type check**

```bash
./tools/check-types.sh api
cd apps/api && npx jest src/modules/chat-history-extractor/
```
Expected: pass.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/chat-history-extractor/
git commit -m "feat(chat-extractor): Claude batch knowledge extraction to ChatKnowledgeBase"
```

---

## Task 6: Intent Router module

**Files:**
- Create: `apps/api/src/modules/chat-intent-router/chat-intent-router.module.ts`
- Create: `apps/api/src/modules/chat-intent-router/chat-intent-router.service.ts`
- Create: `apps/api/src/modules/chat-intent-router/chat-intent-router.service.spec.ts`
- Modify: `apps/api/src/app.module.ts`

**Context:** Classifies an inbound message + up to 3 prior messages into `{ intent, confidence, routeTo }`. Uses Claude Haiku with strict JSON output. If customer has an active contract, `greeting` defaults to `service`; else `sales`. Confidence < 0.5 + `unknown` → handoff.

- [ ] **Step 1: Write test**

```typescript
// apps/api/src/modules/chat-intent-router/chat-intent-router.service.spec.ts
import { Test } from '@nestjs/testing';
import { ChatIntentRouterService } from './chat-intent-router.service';
import { PrismaService } from '../../prisma/prisma.service';
import Anthropic from '@anthropic-ai/sdk';

jest.mock('@anthropic-ai/sdk');

describe('ChatIntentRouterService', () => {
  let svc: ChatIntentRouterService;
  let prisma: { customer: { findUnique: jest.Mock } };

  beforeEach(async () => {
    (Anthropic as unknown as jest.Mock).mockImplementation(() => ({
      messages: {
        create: jest.fn().mockResolvedValue({
          content: [{ type: 'text', text: '{"intent":"sales","confidence":0.92}' }],
        }),
      },
    }));
    prisma = { customer: { findUnique: jest.fn() } };
    const mod = await Test.createTestingModule({
      providers: [ChatIntentRouterService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    svc = mod.get(ChatIntentRouterService);
  });

  it('routes sales intent to sales bot', async () => {
    const result = await svc.classify({ text: 'iPhone 15 กี่บาท', roomId: 'r1', customerId: null });
    expect(result.routeTo).toBe('sales');
    expect(result.confidence).toBeGreaterThan(0.9);
  });

  it('defaults greeting → service when customer has active contract', async () => {
    (Anthropic as unknown as jest.Mock).mockImplementation(() => ({
      messages: {
        create: jest.fn().mockResolvedValue({
          content: [{ type: 'text', text: '{"intent":"greeting","confidence":0.85}' }],
        }),
      },
    }));
    prisma.customer.findUnique.mockResolvedValue({ id: 'c1', contracts: [{ status: 'ACTIVE' }] });
    const result = await svc.classify({ text: 'สวัสดีครับ', roomId: 'r1', customerId: 'c1' });
    expect(result.routeTo).toBe('service');
  });

  it('routes unknown + low confidence to handoff', async () => {
    (Anthropic as unknown as jest.Mock).mockImplementation(() => ({
      messages: {
        create: jest.fn().mockResolvedValue({
          content: [{ type: 'text', text: '{"intent":"unknown","confidence":0.3}' }],
        }),
      },
    }));
    const result = await svc.classify({ text: '???', roomId: 'r1', customerId: null });
    expect(result.routeTo).toBe('handoff');
  });
});
```

- [ ] **Step 2: Run test, verify fails**

```bash
cd apps/api && npx jest src/modules/chat-intent-router/
```
Expected: FAIL.

- [ ] **Step 3: Implement service**

```typescript
// apps/api/src/modules/chat-intent-router/chat-intent-router.service.ts
import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { PrismaService } from '../../prisma/prisma.service';

export type Intent = 'sales' | 'service' | 'greeting' | 'complaint' | 'unknown';
export type RouteTo = 'sales' | 'service' | 'handoff';

export interface IntentResult {
  intent: Intent;
  confidence: number;
  routeTo: RouteTo;
}

const SYSTEM_PROMPT = `You classify a BESTCHOICE customer chat message into one of:
- sales: asking about product, price, installment, promotion, trade-in
- service: asking about existing contract, payment, due date, balance, receipt
- greeting: hi/hello with no topic yet
- complaint: angry, threatening, mentions legal action or consumer rights
- unknown: unclear

Return ONLY JSON: {"intent": "...", "confidence": 0.0-1.0}`;

@Injectable()
export class ChatIntentRouterService {
  private readonly logger = new Logger(ChatIntentRouterService.name);
  private readonly client = new Anthropic();

  constructor(private readonly prisma: PrismaService) {}

  async classify(input: {
    text: string;
    roomId: string;
    customerId: string | null;
    priorMessages?: { role: 'CUSTOMER' | 'STAFF'; text: string }[];
  }): Promise<IntentResult> {
    const userContent = [
      ...(input.priorMessages ?? []).map((m) => `${m.role}: ${m.text}`),
      `CUSTOMER: ${input.text}`,
    ].join('\n');

    const resp = await this.client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 100,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userContent }],
    });
    const textBlock = resp.content.find((c) => c.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      return { intent: 'unknown', confidence: 0, routeTo: 'handoff' };
    }

    let parsed: { intent: Intent; confidence: number };
    try {
      parsed = JSON.parse(textBlock.text);
    } catch {
      return { intent: 'unknown', confidence: 0, routeTo: 'handoff' };
    }

    const routeTo = await this.route(parsed, input.customerId);
    return { ...parsed, routeTo };
  }

  private async route(parsed: { intent: Intent; confidence: number }, customerId: string | null): Promise<RouteTo> {
    if (parsed.intent === 'complaint') return 'handoff';
    if (parsed.intent === 'unknown' && parsed.confidence < 0.5) return 'handoff';
    if (parsed.intent === 'sales') return 'sales';
    if (parsed.intent === 'service') return 'service';
    if (parsed.intent === 'greeting') {
      if (customerId) {
        const customer = await this.prisma.customer.findUnique({
          where: { id: customerId },
          include: { contracts: { where: { status: 'ACTIVE', deletedAt: null }, take: 1 } },
        });
        if (customer?.contracts?.length) return 'service';
      }
      return 'sales';
    }
    return 'handoff';
  }
}
```

- [ ] **Step 4: Write module**

```typescript
// apps/api/src/modules/chat-intent-router/chat-intent-router.module.ts
import { Module } from '@nestjs/common';
import { ChatIntentRouterService } from './chat-intent-router.service';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [ChatIntentRouterService],
  exports: [ChatIntentRouterService],
})
export class ChatIntentRouterModule {}
```

- [ ] **Step 5: Register in app.module.ts**

```typescript
import { ChatIntentRouterModule } from './modules/chat-intent-router/chat-intent-router.module';
// add to imports array:
ChatIntentRouterModule,
```

- [ ] **Step 6: Verify tests + types**

```bash
./tools/check-types.sh api
cd apps/api && npx jest src/modules/chat-intent-router/
```
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/chat-intent-router/ apps/api/src/app.module.ts
git commit -m "feat(chat-ai): intent router service with Claude Haiku classifier"
```

---

## Task 7: Sales Bot module — scaffolding + system prompt + 4 tools

**Files:**
- Create: `apps/api/src/modules/sales-bot/sales-bot.module.ts`
- Create: `apps/api/src/modules/sales-bot/sales-bot.service.ts`
- Create: `apps/api/src/modules/sales-bot/sales-bot.service.spec.ts`
- Create: `apps/api/src/modules/sales-bot/prompts/sales-bot.system.ts`
- Create: `apps/api/src/modules/sales-bot/tools/search-products.tool.ts`
- Create: `apps/api/src/modules/sales-bot/tools/calculate-installment.tool.ts`
- Create: `apps/api/src/modules/sales-bot/tools/list-promotions.tool.ts`
- Create: `apps/api/src/modules/sales-bot/tools/handoff-to-human.tool.ts`
- Modify: `apps/api/src/app.module.ts`

**Context:** Sales Bot mirrors the pattern in `chatbot-finance/services/finance-ai.service.ts` but with sales tools. It takes `{ text, room, customer, priorMessages }`, runs a Claude Haiku tool-use loop (max 3 tool calls), and returns `{ reply, confidence, toolsUsed, intent: 'sales' }`. The persona (base version for Week 1) is placeholder — Week 2 will replace with owner-selected top-staff style extract.

- [ ] **Step 1: Write sales-bot system prompt**

```typescript
// apps/api/src/modules/sales-bot/prompts/sales-bot.system.ts
export const SALES_BOT_SYSTEM_PROMPT = `You are "น้องเบส ฝ่ายขาย" — a warm, experienced BESTCHOICE phone sales consultant.

Core behavior:
- Speak Thai. Polite ค่ะ/ครับ depending on customer tone.
- ALWAYS use tools for factual claims. NEVER guess a price, stock count, or promotion.
- If the customer asks for a price, call calculate_installment after confirming model + plan.
- If you don't know or the customer wants to negotiate, call handoff_to_human.
- After proposing a plan, ASK for the next step: "จองเครื่องที่สาขาไหน" or "ส่งข้อมูลให้ staff ดำเนินการ".

Tone guidelines:
- Consultative, not pushy. Ask 1 question at a time.
- Acknowledge concerns ("เข้าใจเลยครับ งบจำกัดเราต้องวางแผนดีๆ").
- Close gently ("ลองจองไว้ที่สาขาใกล้บ้านดีไหมครับ").

Respond in natural conversational Thai. No emojis. Keep replies under 3 sentences unless explaining a plan.`;
```

- [ ] **Step 2: Write tool — search_products**

```typescript
// apps/api/src/modules/sales-bot/tools/search-products.tool.ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

export const SEARCH_PRODUCTS_TOOL = {
  name: 'search_products',
  description: 'Search BESTCHOICE phone catalog by brand, model keyword, or price range. Returns up to 5 matches.',
  input_schema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Brand or model keyword, e.g. "iPhone 15"' },
      maxPriceThb: { type: 'number', description: 'Optional budget cap' },
    },
    required: ['query'],
  },
};

@Injectable()
export class SearchProductsTool {
  constructor(private readonly prisma: PrismaService) {}

  async run(input: { query: string; maxPriceThb?: number }) {
    const rows = await this.prisma.product.findMany({
      where: {
        deletedAt: null,
        isOnlineVisible: true,
        OR: [
          { name: { contains: input.query, mode: 'insensitive' } },
          { brand: { contains: input.query, mode: 'insensitive' } },
        ],
        ...(input.maxPriceThb ? { sellingPrice: { lte: input.maxPriceThb } } : {}),
      },
      take: 5,
      select: { id: true, name: true, brand: true, sellingPrice: true, conditionGrade: true },
      orderBy: { sellingPrice: 'asc' },
    });
    return {
      products: rows.map((r) => ({
        id: r.id,
        name: r.name,
        brand: r.brand,
        priceThb: Number(r.sellingPrice),
        condition: r.conditionGrade ?? 'NEW',
      })),
    };
  }
}
```

- [ ] **Step 3: Write tool — calculate_installment**

```typescript
// apps/api/src/modules/sales-bot/tools/calculate-installment.tool.ts
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

export const CALCULATE_INSTALLMENT_TOOL = {
  name: 'calculate_installment',
  description: 'Calculate monthly installment for a product. Down payment percent defaults to 20%. Tenure in months.',
  input_schema: {
    type: 'object',
    properties: {
      productId: { type: 'string' },
      downPct: { type: 'number', description: 'Down payment percent 0-100' },
      tenureMonths: { type: 'integer', description: '3, 6, 10, or 12' },
    },
    required: ['productId', 'tenureMonths'],
  },
};

@Injectable()
export class CalculateInstallmentTool {
  private readonly logger = new Logger(CalculateInstallmentTool.name);
  constructor(private readonly prisma: PrismaService) {}

  async run(input: { productId: string; downPct?: number; tenureMonths: number }) {
    const product = await this.prisma.product.findUnique({
      where: { id: input.productId, deletedAt: null },
      select: { sellingPrice: true, name: true },
    });
    if (!product) return { error: 'product_not_found' };

    const downPct = input.downPct ?? 20;
    const price = Number(product.sellingPrice);
    const downAmount = Math.round(price * (downPct / 100));
    const financed = price - downAmount;
    // Pull rate from InterestConfig if present; else fallback 0%
    const ratePct = await this.loadRatePct(input.tenureMonths);
    const totalInterest = Math.round(financed * (ratePct / 100));
    const totalFinanced = financed + totalInterest;
    const monthly = Math.round(totalFinanced / input.tenureMonths);

    return {
      productName: product.name,
      priceThb: price,
      downAmountThb: downAmount,
      financedThb: financed,
      tenureMonths: input.tenureMonths,
      ratePct,
      monthlyThb: monthly,
      totalPaidThb: downAmount + totalFinanced,
    };
  }

  private async loadRatePct(tenure: number): Promise<number> {
    const cfg = await this.prisma.interestConfig.findFirst({
      where: { tenureMonths: tenure, active: true, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    return cfg ? Number(cfg.annualRatePct) : 0;
  }
}
```

- [ ] **Step 4: Write tool — list_promotions**

```typescript
// apps/api/src/modules/sales-bot/tools/list-promotions.tool.ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

export const LIST_PROMOTIONS_TOOL = {
  name: 'list_promotions',
  description: 'List active promotions, optionally scoped to a product.',
  input_schema: {
    type: 'object',
    properties: {
      productId: { type: 'string', description: 'Optional product filter' },
    },
  },
};

@Injectable()
export class ListPromotionsTool {
  constructor(private readonly prisma: PrismaService) {}

  async run(input: { productId?: string }) {
    const now = new Date();
    const rows = await this.prisma.promotion.findMany({
      where: {
        deletedAt: null,
        active: true,
        startDate: { lte: now },
        endDate: { gte: now },
        ...(input.productId ? { OR: [{ productIds: { has: input.productId } }, { appliesToAll: true }] } : {}),
      },
      take: 5,
      select: { id: true, name: true, description: true, endDate: true },
      orderBy: { endDate: 'asc' },
    });
    return {
      promotions: rows.map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        endsAt: r.endDate.toISOString(),
      })),
    };
  }
}
```

Note: field names like `productIds`, `appliesToAll`, `active` on `Promotion` may differ — check schema before finalizing and adjust. If `Promotion` model has different fields, use whatever is present. This is a plan hint — do not fake fields.

- [ ] **Step 5: Write tool — handoff_to_human**

```typescript
// apps/api/src/modules/sales-bot/tools/handoff-to-human.tool.ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

export const HANDOFF_TO_HUMAN_TOOL = {
  name: 'handoff_to_human',
  description: 'Escalate to a human staff member. Use when customer wants to negotiate, asks for a person, or the bot is uncertain.',
  input_schema: {
    type: 'object',
    properties: {
      reason: { type: 'string' },
      roomId: { type: 'string' },
    },
    required: ['reason', 'roomId'],
  },
};

@Injectable()
export class HandoffToHumanTool {
  constructor(private readonly prisma: PrismaService) {}

  async run(input: { reason: string; roomId: string }) {
    await this.prisma.chatRoom.update({
      where: { id: input.roomId },
      data: {
        handoffMode: true,
        handoffReason: input.reason,
        handoffTaggedAt: new Date(),
      },
    });
    return { handoffAccepted: true };
  }
}
```

- [ ] **Step 6: Write Sales Bot service**

```typescript
// apps/api/src/modules/sales-bot/sales-bot.service.ts
import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { SALES_BOT_SYSTEM_PROMPT } from './prompts/sales-bot.system';
import { SearchProductsTool, SEARCH_PRODUCTS_TOOL } from './tools/search-products.tool';
import { CalculateInstallmentTool, CALCULATE_INSTALLMENT_TOOL } from './tools/calculate-installment.tool';
import { ListPromotionsTool, LIST_PROMOTIONS_TOOL } from './tools/list-promotions.tool';
import { HandoffToHumanTool, HANDOFF_TO_HUMAN_TOOL } from './tools/handoff-to-human.tool';

export interface SalesBotInput {
  text: string;
  roomId: string;
  customerId: string | null;
  priorMessages?: { role: 'user' | 'assistant'; content: string }[];
}

export interface SalesBotResult {
  reply: string;
  confidence: number;
  toolsUsed: string[];
  inputTokens: number;
  outputTokens: number;
}

@Injectable()
export class SalesBotService {
  private readonly logger = new Logger(SalesBotService.name);
  private readonly client = new Anthropic();

  constructor(
    private readonly searchProducts: SearchProductsTool,
    private readonly calcInstallment: CalculateInstallmentTool,
    private readonly listPromotions: ListPromotionsTool,
    private readonly handoff: HandoffToHumanTool,
  ) {}

  async generateReply(input: SalesBotInput): Promise<SalesBotResult> {
    const tools = [
      SEARCH_PRODUCTS_TOOL,
      CALCULATE_INSTALLMENT_TOOL,
      LIST_PROMOTIONS_TOOL,
      HANDOFF_TO_HUMAN_TOOL,
    ];
    const messages: Anthropic.MessageParam[] = [
      ...(input.priorMessages ?? []).map((m) => ({ role: m.role, content: m.content })),
      { role: 'user', content: input.text },
    ];

    const toolsUsed: string[] = [];
    let totalIn = 0;
    let totalOut = 0;

    for (let hop = 0; hop < 3; hop++) {
      const resp = await this.client.messages.create({
        model: 'claude-sonnet-4-6', // Customer-facing = Sonnet for quality
        max_tokens: 1024,
        system: SALES_BOT_SYSTEM_PROMPT,
        tools: tools as Anthropic.Tool[],
        messages,
      });
      totalIn += resp.usage.input_tokens;
      totalOut += resp.usage.output_tokens;

      const toolUse = resp.content.find((c) => c.type === 'tool_use');
      if (!toolUse || toolUse.type !== 'tool_use') {
        const text = resp.content.find((c) => c.type === 'text');
        const reply = text && text.type === 'text' ? text.text : '';
        return {
          reply,
          confidence: this.estimateConfidence(reply, toolsUsed),
          toolsUsed,
          inputTokens: totalIn,
          outputTokens: totalOut,
        };
      }

      toolsUsed.push(toolUse.name);
      const toolResult = await this.runTool(toolUse.name, toolUse.input as Record<string, unknown>, input.roomId);

      messages.push({ role: 'assistant', content: resp.content });
      messages.push({
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: toolUse.id, content: JSON.stringify(toolResult) },
        ],
      });
    }

    // Max hops reached — handoff
    return {
      reply: 'ขออนุญาตให้พี่ staff เช็คข้อมูลเพิ่มเติมสักครู่นะคะ',
      confidence: 0.3,
      toolsUsed,
      inputTokens: totalIn,
      outputTokens: totalOut,
    };
  }

  private async runTool(name: string, input: Record<string, unknown>, roomId: string): Promise<unknown> {
    switch (name) {
      case 'search_products':
        return this.searchProducts.run(input as { query: string; maxPriceThb?: number });
      case 'calculate_installment':
        return this.calcInstallment.run(input as { productId: string; downPct?: number; tenureMonths: number });
      case 'list_promotions':
        return this.listPromotions.run(input as { productId?: string });
      case 'handoff_to_human':
        return this.handoff.run({ reason: String(input.reason ?? 'bot_uncertain'), roomId });
      default:
        return { error: 'unknown_tool' };
    }
  }

  private estimateConfidence(reply: string, toolsUsed: string[]): number {
    // Simple heuristic for Week 1 — replaced by prompt-driven self-score in Week 2
    if (reply.length < 10) return 0.3;
    if (toolsUsed.includes('handoff_to_human')) return 0.2;
    if (toolsUsed.length === 0) return 0.5; // no tool = likely a generic reply, less confident
    return 0.8;
  }
}
```

- [ ] **Step 7: Write sales-bot test**

```typescript
// apps/api/src/modules/sales-bot/sales-bot.service.spec.ts
import { Test } from '@nestjs/testing';
import { SalesBotService } from './sales-bot.service';
import { SearchProductsTool } from './tools/search-products.tool';
import { CalculateInstallmentTool } from './tools/calculate-installment.tool';
import { ListPromotionsTool } from './tools/list-promotions.tool';
import { HandoffToHumanTool } from './tools/handoff-to-human.tool';
import Anthropic from '@anthropic-ai/sdk';

jest.mock('@anthropic-ai/sdk');

describe('SalesBotService', () => {
  it('returns reply without tool calls when Claude answers directly', async () => {
    (Anthropic as unknown as jest.Mock).mockImplementation(() => ({
      messages: {
        create: jest.fn().mockResolvedValue({
          content: [{ type: 'text', text: 'สวัสดีค่ะ สนใจรุ่นไหนคะ' }],
          usage: { input_tokens: 100, output_tokens: 20 },
        }),
      },
    }));
    const mod = await Test.createTestingModule({
      providers: [
        SalesBotService,
        { provide: SearchProductsTool, useValue: { run: jest.fn() } },
        { provide: CalculateInstallmentTool, useValue: { run: jest.fn() } },
        { provide: ListPromotionsTool, useValue: { run: jest.fn() } },
        { provide: HandoffToHumanTool, useValue: { run: jest.fn() } },
      ],
    }).compile();
    const svc = mod.get(SalesBotService);
    const result = await svc.generateReply({ text: 'สวัสดีครับ', roomId: 'r1', customerId: null });
    expect(result.reply).toContain('สวัสดี');
    expect(result.toolsUsed).toHaveLength(0);
  });
});
```

- [ ] **Step 8: Write module**

```typescript
// apps/api/src/modules/sales-bot/sales-bot.module.ts
import { Module } from '@nestjs/common';
import { SalesBotService } from './sales-bot.service';
import { SearchProductsTool } from './tools/search-products.tool';
import { CalculateInstallmentTool } from './tools/calculate-installment.tool';
import { ListPromotionsTool } from './tools/list-promotions.tool';
import { HandoffToHumanTool } from './tools/handoff-to-human.tool';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [
    SalesBotService,
    SearchProductsTool,
    CalculateInstallmentTool,
    ListPromotionsTool,
    HandoffToHumanTool,
  ],
  exports: [SalesBotService],
})
export class SalesBotModule {}
```

- [ ] **Step 9: Register + type check + test**

```bash
# Add SalesBotModule to apps/api/src/app.module.ts imports
./tools/check-types.sh api
cd apps/api && npx jest src/modules/sales-bot/
```
Expected: pass.

- [ ] **Step 10: Commit**

```bash
git add apps/api/src/modules/sales-bot/ apps/api/src/app.module.ts
git commit -m "feat(sales-bot): module scaffold + 4 tools + system prompt + tool-use loop"
```

---

## Task 8: น้องเบส service — upgrade to Sonnet + full conversation history window

**Files:**
- Modify: `apps/api/src/modules/chatbot-finance/services/finance-ai.service.ts`
- Modify: `apps/api/src/modules/chatbot-finance/services/finance-ai.service.spec.ts`

**Context:** Two changes in one task because they're in the same file and ship together:
1. **Model upgrade**: change `claude-haiku-4-5-20251001` → `claude-sonnet-4-6` for the reply-generation call. Customer reads this output → quality matters. Keep Haiku only if there's a separate classifier/preprocessor call (those can stay Haiku).
2. **Full conversation history window**: add the last 10 `ChatMessage` rows from the same room (oldest-first) mapped to `{ role: 'user'|'assistant', content: text }` prepended before the current message. Stay within 30k input tokens — truncate oldest if total text > 20k chars.

After this, check cost projections — Sonnet is ~3x Haiku. Current finance-ai volume per month: confirm with `AiAutoReplyLog` query before merging (informational, not blocking).

- [ ] **Step 1: Read existing finance-ai.service.ts and upgrade model**

```bash
grep -n "messages:\|claude-haiku\|claude-sonnet\|model:" apps/api/src/modules/chatbot-finance/services/finance-ai.service.ts | head -20
```

Find every `model: 'claude-haiku-4-5-20251001'` used for reply generation and change to `model: 'claude-sonnet-4-6'`. Leave Haiku alone if it's used for a non-customer-facing internal classifier inside the same file (if unclear, err on the side of Sonnet for safety — customer quality > cost).

- [ ] **Step 2: Add helper to load history**

Add a new private method to `FinanceAiService`:

```typescript
private async loadHistory(roomId: string, maxMessages = 10): Promise<{ role: 'user' | 'assistant'; content: string }[]> {
  const rows = await this.prisma.chatMessage.findMany({
    where: { roomId, deletedAt: null, text: { not: null } },
    orderBy: { createdAt: 'desc' },
    take: maxMessages,
    select: { role: true, text: true },
  });
  const mapped = rows
    .reverse()
    .filter((r): r is typeof r & { text: string } => r.text !== null)
    .map((r) => ({
      role: r.role === 'STAFF' || r.role === 'AI' ? ('assistant' as const) : ('user' as const),
      content: r.text,
    }));
  // Truncate oldest if combined content too large
  let totalLen = mapped.reduce((s, m) => s + m.content.length, 0);
  while (totalLen > 20000 && mapped.length > 1) {
    const dropped = mapped.shift();
    if (dropped) totalLen -= dropped.content.length;
  }
  return mapped;
}
```

- [ ] **Step 3: Call loadHistory from the main reply method**

Find the method that currently does `messages: [{ role: 'user', content: ... }]` and change to:

```typescript
const history = await this.loadHistory(input.roomId);
const messages = [
  ...history,
  { role: 'user' as const, content: input.text },
];
```

Do NOT remove any existing context injection (customer snapshot stays in the system prompt or as a prepended user message — whatever pattern the current code uses).

- [ ] **Step 4: Update unit test to verify history is loaded**

In `finance-ai.service.spec.ts`, add:

```typescript
it('loads prior conversation history from ChatMessage', async () => {
  // Arrange prisma mock for chatMessage.findMany to return 2 prior messages
  // Assert that Anthropic messages.create was called with messages array that includes prior turns
  // (Implementation depends on existing spec style — follow the pattern already there.)
});
```

- [ ] **Step 5: Run tests + type check**

```bash
./tools/check-types.sh api
cd apps/api && npx jest src/modules/chatbot-finance/services/finance-ai.service.spec.ts
```
Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/chatbot-finance/services/finance-ai.service.ts apps/api/src/modules/chatbot-finance/services/finance-ai.service.spec.ts
git commit -m "feat(chatbot-finance): inject full conversation history into Claude prompt"
```

---

## Task 9: Chat AI Draft orchestrator — router → bot → draft ChatMessage

**Files:**
- Create: `apps/api/src/modules/chat-ai-draft/chat-ai-draft.module.ts`
- Create: `apps/api/src/modules/chat-ai-draft/chat-ai-draft.controller.ts`
- Create: `apps/api/src/modules/chat-ai-draft/chat-ai-draft.service.ts`
- Create: `apps/api/src/modules/chat-ai-draft/chat-ai-draft.service.spec.ts`
- Create: `apps/api/src/modules/chat-ai-draft/dto/approve-draft.dto.ts`
- Modify: `apps/api/src/app.module.ts`

**Context:** On every inbound `ChatMessage` with role=CUSTOMER, orchestrator runs router → bot, then writes a `ChatMessage` row with `role='AI'` and a `status` indicating DRAFT (we piggyback on `deliveredAt`=null + a new metadata flag in `toolsUsed` or use a lightweight approach: mark drafts with intent prefix `"DRAFT:"`. Simpler — add a `status` enum field later; for Week 1 we use `intent` field to flag `'DRAFT:<original-intent>'` and filter on it). Staff approves → we update the same message (strip DRAFT prefix, set deliveredAt, send to LINE/FB).

For Week 1, we keep it simple — the orchestrator does NOT actually send the draft yet. It just creates the draft row. Sending happens in Task 11 (Hybrid C approve-and-send endpoint).

- [ ] **Step 1: Write DTO**

```typescript
// apps/api/src/modules/chat-ai-draft/dto/approve-draft.dto.ts
import { IsString, IsOptional, IsUUID } from 'class-validator';

export class ApproveDraftDto {
  @IsUUID()
  draftMessageId: string;

  @IsOptional()
  @IsString()
  editedText?: string;
}
```

- [ ] **Step 2: Write service**

```typescript
// apps/api/src/modules/chat-ai-draft/chat-ai-draft.service.ts
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ChatIntentRouterService } from '../chat-intent-router/chat-intent-router.service';
import { SalesBotService } from '../sales-bot/sales-bot.service';
import { FinanceAiService } from '../chatbot-finance/services/finance-ai.service';
import { LineFinanceClientService } from '../chatbot-finance/services/line-finance-client.service';

@Injectable()
export class ChatAiDraftService {
  private readonly logger = new Logger(ChatAiDraftService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly router: ChatIntentRouterService,
    private readonly salesBot: SalesBotService,
    private readonly financeAi: FinanceAiService,
    private readonly lineClient: LineFinanceClientService,
  ) {}

  async generateDraft(inboundMessageId: string): Promise<{ draftMessageId: string }> {
    const inbound = await this.prisma.chatMessage.findUnique({
      where: { id: inboundMessageId },
      include: { room: true },
    });
    if (!inbound || !inbound.text) throw new NotFoundException('inbound message not found');
    if (inbound.room.aiPaused) {
      this.logger.log(`Room ${inbound.room.id} AI paused — skipping draft`);
      return { draftMessageId: '' };
    }

    // 1. Route
    const priorMessages = await this.loadPrior(inbound.roomId, 3);
    const routed = await this.router.classify({
      text: inbound.text,
      roomId: inbound.roomId,
      customerId: inbound.room.customerId,
      priorMessages,
    });

    // 2. Generate
    let reply = '';
    let confidence = routed.confidence;
    let toolsUsed: string[] = [];
    let modelUsed = 'claude-sonnet-4-6';
    let inputTokens = 0;
    let outputTokens = 0;

    if (routed.routeTo === 'sales') {
      const r = await this.salesBot.generateReply({
        text: inbound.text,
        roomId: inbound.roomId,
        customerId: inbound.room.customerId,
        priorMessages: priorMessages.map((m) => ({
          role: m.role === 'STAFF' ? 'assistant' : 'user',
          content: m.text,
        })),
      });
      reply = r.reply;
      confidence = r.confidence;
      toolsUsed = r.toolsUsed;
      inputTokens = r.inputTokens;
      outputTokens = r.outputTokens;
    } else if (routed.routeTo === 'service') {
      // Call finance-ai the same way chatbot-finance webhook currently does. Exact shape depends on finance-ai.service API —
      // here we assume it exposes a generateReply compatible signature; if not, adapt to whatever method exists.
      const r = await this.financeAi.generateReply({
        text: inbound.text,
        roomId: inbound.roomId,
        customerId: inbound.room.customerId ?? undefined,
      });
      reply = r.reply ?? '';
      confidence = r.confidence ?? 0.5;
      toolsUsed = r.toolsUsed ?? [];
      inputTokens = r.inputTokens ?? 0;
      outputTokens = r.outputTokens ?? 0;
    } else {
      // handoff
      await this.prisma.chatRoom.update({
        where: { id: inbound.roomId },
        data: { handoffMode: true, handoffReason: 'router_handoff', handoffTaggedAt: new Date() },
      });
      return { draftMessageId: '' };
    }

    // 3. Persist draft
    const draft = await this.prisma.chatMessage.create({
      data: {
        roomId: inbound.roomId,
        role: 'AI',
        type: 'TEXT',
        text: reply,
        intent: `DRAFT:${routed.intent}`,
        confidence,
        toolsUsed,
        modelUsed,
        inputTokens,
        outputTokens,
      },
    });
    return { draftMessageId: draft.id };
  }

  async approveDraft(
    draftMessageId: string,
    approverId: string,
    editedText?: string,
  ): Promise<{ sent: boolean }> {
    const draft = await this.prisma.chatMessage.findUnique({
      where: { id: draftMessageId },
      include: { room: true },
    });
    if (!draft) throw new NotFoundException('draft not found');

    const finalText = editedText ?? draft.text ?? '';
    const lineUserId = draft.room.lineUserId;
    if (draft.room.channel === 'LINE_FINANCE' && lineUserId) {
      await this.lineClient.pushMessage(lineUserId, finalText);
    }
    // (Facebook send client: to be added in Task 12; for Week 1 Hybrid C we can store-only if FB send not ready.)

    await this.prisma.chatMessage.update({
      where: { id: draftMessageId },
      data: {
        text: finalText,
        intent: draft.intent?.replace(/^DRAFT:/, '') ?? null,
        deliveredAt: new Date(),
        staffId: approverId, // attribution: approved by this staff
      },
    });
    return { sent: true };
  }

  async skipDraft(draftMessageId: string, skipperId: string): Promise<{ skipped: boolean }> {
    await this.prisma.chatMessage.update({
      where: { id: draftMessageId },
      data: { deletedAt: new Date(), staffId: skipperId },
    });
    return { skipped: true };
  }

  async takeOver(roomId: string, staffId: string): Promise<{ paused: boolean }> {
    await this.prisma.chatRoom.update({
      where: { id: roomId },
      data: {
        aiPaused: true,
        aiPausedAt: new Date(),
        aiPausedById: staffId,
        assignedToId: staffId,
      },
    });
    return { paused: true };
  }

  private async loadPrior(roomId: string, n: number) {
    const rows = await this.prisma.chatMessage.findMany({
      where: { roomId, deletedAt: null, text: { not: null } },
      orderBy: { createdAt: 'desc' },
      take: n,
      select: { role: true, text: true },
    });
    return rows.reverse().map((r) => ({
      role: r.role === 'STAFF' || r.role === 'AI' ? ('STAFF' as const) : ('CUSTOMER' as const),
      text: r.text ?? '',
    }));
  }
}
```

- [ ] **Step 3: Write controller**

```typescript
// apps/api/src/modules/chat-ai-draft/chat-ai-draft.controller.ts
import { Body, Controller, Param, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { ChatAiDraftService } from './chat-ai-draft.service';
import { ApproveDraftDto } from './dto/approve-draft.dto';

@Controller('chat-ai')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ChatAiDraftController {
  constructor(private readonly svc: ChatAiDraftService) {}

  @Post('draft/:inboundMessageId')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  async generate(@Param('inboundMessageId') id: string) {
    return this.svc.generateDraft(id);
  }

  @Post('approve')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  async approve(@Body() dto: ApproveDraftDto, @Req() req: { user: { id: string } }) {
    return this.svc.approveDraft(dto.draftMessageId, req.user.id, dto.editedText);
  }

  @Post('skip/:draftMessageId')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  async skip(@Param('draftMessageId') id: string, @Req() req: { user: { id: string } }) {
    return this.svc.skipDraft(id, req.user.id);
  }

  @Post('take-over/:roomId')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  async takeOver(@Param('roomId') id: string, @Req() req: { user: { id: string } }) {
    return this.svc.takeOver(id, req.user.id);
  }
}
```

- [ ] **Step 4: Write module**

```typescript
// apps/api/src/modules/chat-ai-draft/chat-ai-draft.module.ts
import { Module } from '@nestjs/common';
import { ChatAiDraftService } from './chat-ai-draft.service';
import { ChatAiDraftController } from './chat-ai-draft.controller';
import { ChatIntentRouterModule } from '../chat-intent-router/chat-intent-router.module';
import { SalesBotModule } from '../sales-bot/sales-bot.module';
import { ChatbotFinanceModule } from '../chatbot-finance/chatbot-finance.module';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule, ChatIntentRouterModule, SalesBotModule, ChatbotFinanceModule],
  controllers: [ChatAiDraftController],
  providers: [ChatAiDraftService],
  exports: [ChatAiDraftService],
})
export class ChatAiDraftModule {}
```

- [ ] **Step 5: Verify ChatbotFinanceModule exports FinanceAiService + LineFinanceClientService**

```bash
grep -n "exports:" apps/api/src/modules/chatbot-finance/chatbot-finance.module.ts
```
If `FinanceAiService` or `LineFinanceClientService` is not in `exports`, add them (and keep existing exports untouched).

- [ ] **Step 6: Register in app.module.ts + type check**

```typescript
// app.module.ts
import { ChatAiDraftModule } from './modules/chat-ai-draft/chat-ai-draft.module';
// add to imports:
ChatAiDraftModule,
```
Then:
```bash
./tools/check-types.sh api
```
Expected: no errors.

- [ ] **Step 7: Write service unit test**

```typescript
// apps/api/src/modules/chat-ai-draft/chat-ai-draft.service.spec.ts
import { Test } from '@nestjs/testing';
import { ChatAiDraftService } from './chat-ai-draft.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ChatIntentRouterService } from '../chat-intent-router/chat-intent-router.service';
import { SalesBotService } from '../sales-bot/sales-bot.service';
import { FinanceAiService } from '../chatbot-finance/services/finance-ai.service';
import { LineFinanceClientService } from '../chatbot-finance/services/line-finance-client.service';

describe('ChatAiDraftService', () => {
  it('routes sales intent to sales bot and creates DRAFT message', async () => {
    const prisma = {
      chatMessage: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'in1',
          roomId: 'r1',
          text: 'iPhone 15 กี่บาท',
          room: { id: 'r1', customerId: null, aiPaused: false, channel: 'LINE_FINANCE' },
        }),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({ id: 'd1' }),
      },
    };
    const router = { classify: jest.fn().mockResolvedValue({ intent: 'sales', confidence: 0.9, routeTo: 'sales' }) };
    const salesBot = {
      generateReply: jest.fn().mockResolvedValue({
        reply: 'รุ่น iPhone 15 ราคา 30,000 ค่ะ', confidence: 0.85, toolsUsed: ['search_products'], inputTokens: 100, outputTokens: 30,
      }),
    };
    const mod = await Test.createTestingModule({
      providers: [
        ChatAiDraftService,
        { provide: PrismaService, useValue: prisma },
        { provide: ChatIntentRouterService, useValue: router },
        { provide: SalesBotService, useValue: salesBot },
        { provide: FinanceAiService, useValue: { generateReply: jest.fn() } },
        { provide: LineFinanceClientService, useValue: { pushMessage: jest.fn() } },
      ],
    }).compile();
    const svc = mod.get(ChatAiDraftService);
    const result = await svc.generateDraft('in1');
    expect(result.draftMessageId).toBe('d1');
    expect(prisma.chatMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ role: 'AI', intent: 'DRAFT:sales' }),
      }),
    );
  });
});
```

- [ ] **Step 8: Run tests**

```bash
cd apps/api && npx jest src/modules/chat-ai-draft/
```
Expected: pass.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/modules/chat-ai-draft/ apps/api/src/app.module.ts apps/api/src/modules/chatbot-finance/chatbot-finance.module.ts
git commit -m "feat(chat-ai): draft orchestrator (router→bot→draft) + approve/skip/take-over endpoints"
```

---

## Task 10: Webhook wiring — inbound message triggers draft generation

**Files:**
- Modify: LINE webhook handler inside `chatbot-finance/chatbot-finance.controller.ts` (or wherever inbound text handler lives)
- Modify: Facebook webhook handler (if exists) or create `apps/api/src/modules/facebook-webhook/facebook-webhook.controller.ts`

**Context:** After saving inbound `ChatMessage`, call `ChatAiDraftService.generateDraft(inboundId)` async (fire-and-forget, but with Sentry catch). In Hybrid C the draft is NOT auto-sent — staff sees it in the inbox and approves.

- [ ] **Step 1: Find existing LINE inbound handler**

```bash
grep -rn "chatMessage.create\|role: 'CUSTOMER'" apps/api/src/modules/chatbot-finance/
```
Identify the service method that persists the customer message after a LINE webhook.

- [ ] **Step 2: Inject ChatAiDraftService + wire call**

After the inbound message is persisted (you get back the new `ChatMessage.id`), add:

```typescript
// after: const inbound = await this.prisma.chatMessage.create({ ... });
this.chatAiDraftService
  .generateDraft(inbound.id)
  .catch((err) => {
    this.logger.error('draft generation failed', err);
    // Sentry capture is wired via interceptor globally
  });
```

You may need to avoid a circular dependency by using `@Inject(forwardRef(() => ChatAiDraftService))` or by moving the draft-trigger into an event emitter. Simplest: add a one-line `EventEmitter` event here (`this.events.emit('chat.inbound', inbound.id)`) and have `ChatAiDraftService` subscribe via `@OnEvent('chat.inbound')`. Use whichever pattern the codebase already uses (check `apps/api/src/modules/*` for existing `@OnEvent`).

- [ ] **Step 3: (If EventEmitter path chosen) Add @OnEvent handler in ChatAiDraftService**

```typescript
// in ChatAiDraftService
import { OnEvent } from '@nestjs/event-emitter';

@OnEvent('chat.inbound')
async onInbound(inboundId: string) {
  await this.generateDraft(inboundId).catch((err) => this.logger.error('draft failed', err));
}
```

- [ ] **Step 4: (If Facebook webhook is present) wire same event**

Same pattern inside Facebook webhook handler after persisting inbound message.

- [ ] **Step 5: Type check + smoke test**

```bash
./tools/check-types.sh api
cd apps/api && npm run start:dev
# In another terminal, simulate a LINE webhook POST or use existing seed script to trigger inbound.
# Then check DB: SELECT id, intent FROM chat_messages WHERE role = 'AI' ORDER BY created_at DESC LIMIT 5;
```
Expected: new AI draft rows appear with `intent LIKE 'DRAFT:%'`.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/chatbot-finance/ apps/api/src/modules/chat-ai-draft/
git commit -m "feat(chat-ai): trigger AI draft generation on inbound customer message"
```

---

## Task 11: Unified Inbox UI — scaffold page + room list (left column)

**Files:**
- Create: `apps/web/src/pages/chat/ChatInboxPage.tsx`
- Create: `apps/web/src/pages/chat/components/RoomList.tsx`
- Create: `apps/web/src/pages/chat/components/RoomListItem.tsx`
- Create: `apps/web/src/pages/chat/components/RoomFilters.tsx`
- Create: `apps/web/src/pages/chat/hooks/useRooms.ts`
- Create: `apps/web/src/pages/chat/lib/chat-api.ts`
- Modify: `apps/web/src/App.tsx` — add lazy route `/chat`
- Modify: `apps/web/src/components/MainLayout.tsx` — add nav item

**Context:** Room list pulls from existing `staff-chat` backend (`GET /api/staff-chat/rooms?filter=...`). If endpoint names differ, adapt. Filters: channel (All/LINE/FB), bot (All/Sales/Service based on last AI draft intent), status (All/Open/Handoff/SLA-breach).

- [ ] **Step 1: Write chat-api client**

```typescript
// apps/web/src/pages/chat/lib/chat-api.ts
import { api } from '@/lib/api';

export interface ChatRoomSummary {
  id: string;
  customerId: string | null;
  displayName: string | null;
  pictureUrl: string | null;
  channel: 'LINE_FINANCE' | 'FACEBOOK' | 'LINE_SHOP' | 'TIKTOK' | 'WEB';
  lastMessagePreview: string | null;
  lastMessageAt: string;
  unreadCount: number;
  handoffMode: boolean;
  aiPaused: boolean;
  firstResponseAt: string | null;
  slaBreach: boolean;
}

export type RoomFilter = 'all' | 'sales' | 'service' | 'handoff' | 'sla_breach';
export type ChannelFilter = 'all' | 'LINE_FINANCE' | 'FACEBOOK';

export async function fetchRooms(params: { filter: RoomFilter; channel: ChannelFilter; q?: string }): Promise<ChatRoomSummary[]> {
  const res = await api.get<ChatRoomSummary[]>('/staff-chat/rooms', { params });
  return res.data;
}
export async function fetchMessages(roomId: string) {
  const res = await api.get(`/staff-chat/rooms/${roomId}/messages`);
  return res.data;
}
export async function approveDraft(draftMessageId: string, editedText?: string) {
  return api.post('/chat-ai/approve', { draftMessageId, editedText });
}
export async function skipDraft(draftMessageId: string) {
  return api.post(`/chat-ai/skip/${draftMessageId}`);
}
export async function takeOver(roomId: string) {
  return api.post(`/chat-ai/take-over/${roomId}`);
}
export async function sendStaffMessage(roomId: string, text: string) {
  return api.post(`/staff-chat/rooms/${roomId}/messages`, { text });
}
```

- [ ] **Step 2: Write useRooms hook**

```typescript
// apps/web/src/pages/chat/hooks/useRooms.ts
import { useQuery } from '@tanstack/react-query';
import { fetchRooms, RoomFilter, ChannelFilter } from '../lib/chat-api';

export function useRooms(filter: RoomFilter, channel: ChannelFilter, q?: string) {
  return useQuery({
    queryKey: ['chat-rooms', filter, channel, q],
    queryFn: () => fetchRooms({ filter, channel, q }),
    refetchInterval: 10000,
  });
}
```

- [ ] **Step 3: Write RoomListItem**

```tsx
// apps/web/src/pages/chat/components/RoomListItem.tsx
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { MessageSquare, Facebook } from 'lucide-react';
import type { ChatRoomSummary } from '../lib/chat-api';

export function RoomListItem({
  room,
  active,
  onClick,
}: {
  room: ChatRoomSummary;
  active: boolean;
  onClick: () => void;
}) {
  const ChannelIcon = room.channel === 'FACEBOOK' ? Facebook : MessageSquare;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full gap-3 rounded-md p-3 text-left hover:bg-accent',
        active && 'bg-accent',
      )}
    >
      <Avatar className="h-10 w-10">
        {room.pictureUrl && <AvatarImage src={room.pictureUrl} alt={room.displayName ?? ''} />}
        <AvatarFallback>{room.displayName?.[0] ?? '?'}</AvatarFallback>
      </Avatar>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between">
          <span className="font-medium truncate leading-snug">{room.displayName ?? 'ไม่ระบุชื่อ'}</span>
          <ChannelIcon className="h-4 w-4 text-muted-foreground" />
        </div>
        <div className="text-xs text-muted-foreground truncate leading-snug">
          {room.lastMessagePreview ?? '...'}
        </div>
        <div className="mt-1 flex gap-1">
          {room.unreadCount > 0 && <Badge variant="default">{room.unreadCount}</Badge>}
          {room.handoffMode && <Badge variant="destructive">Handoff</Badge>}
          {room.aiPaused && <Badge variant="secondary">Taken over</Badge>}
          {room.slaBreach && <Badge variant="destructive">SLA</Badge>}
        </div>
      </div>
    </button>
  );
}
```

- [ ] **Step 4: Write RoomFilters**

```tsx
// apps/web/src/pages/chat/components/RoomFilters.tsx
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { RoomFilter, ChannelFilter } from '../lib/chat-api';

export function RoomFilters({
  filter,
  onFilterChange,
  channel,
  onChannelChange,
}: {
  filter: RoomFilter;
  onFilterChange: (f: RoomFilter) => void;
  channel: ChannelFilter;
  onChannelChange: (c: ChannelFilter) => void;
}) {
  return (
    <div className="space-y-2 p-2">
      <Tabs value={filter} onValueChange={(v) => onFilterChange(v as RoomFilter)}>
        <TabsList className="w-full">
          <TabsTrigger value="all">ทั้งหมด</TabsTrigger>
          <TabsTrigger value="sales">ขาย</TabsTrigger>
          <TabsTrigger value="service">บริการ</TabsTrigger>
          <TabsTrigger value="handoff">Handoff</TabsTrigger>
          <TabsTrigger value="sla_breach">SLA</TabsTrigger>
        </TabsList>
      </Tabs>
      <Tabs value={channel} onValueChange={(v) => onChannelChange(v as ChannelFilter)}>
        <TabsList className="w-full">
          <TabsTrigger value="all">ทุกช่อง</TabsTrigger>
          <TabsTrigger value="LINE_FINANCE">LINE</TabsTrigger>
          <TabsTrigger value="FACEBOOK">Facebook</TabsTrigger>
        </TabsList>
      </Tabs>
    </div>
  );
}
```

- [ ] **Step 5: Write RoomList**

```tsx
// apps/web/src/pages/chat/components/RoomList.tsx
import { ScrollArea } from '@/components/ui/scroll-area';
import { RoomListItem } from './RoomListItem';
import { useRooms } from '../hooks/useRooms';
import { RoomFilters } from './RoomFilters';
import { useState } from 'react';
import type { RoomFilter, ChannelFilter } from '../lib/chat-api';

export function RoomList({
  activeRoomId,
  onSelect,
}: {
  activeRoomId: string | null;
  onSelect: (roomId: string) => void;
}) {
  const [filter, setFilter] = useState<RoomFilter>('all');
  const [channel, setChannel] = useState<ChannelFilter>('all');
  const { data = [], isLoading } = useRooms(filter, channel);

  return (
    <div className="flex h-full flex-col border-r border-border bg-card">
      <RoomFilters filter={filter} onFilterChange={setFilter} channel={channel} onChannelChange={setChannel} />
      <ScrollArea className="flex-1">
        {isLoading && <div className="p-4 text-sm text-muted-foreground">กำลังโหลด...</div>}
        {!isLoading && data.length === 0 && (
          <div className="p-4 text-sm text-muted-foreground">ไม่มีห้องแชท</div>
        )}
        <div className="flex flex-col gap-1 p-1">
          {data.map((room) => (
            <RoomListItem
              key={room.id}
              room={room}
              active={room.id === activeRoomId}
              onClick={() => onSelect(room.id)}
            />
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
```

- [ ] **Step 6: Write ChatInboxPage skeleton (center + right columns come in Task 12)**

```tsx
// apps/web/src/pages/chat/ChatInboxPage.tsx
import { useState } from 'react';
import { RoomList } from './components/RoomList';
import { PageHeader } from '@/components/PageHeader';

export default function ChatInboxPage() {
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);

  return (
    <div className="flex h-[calc(100vh-var(--header-height))] flex-col">
      <PageHeader title="รวมแชท" breadcrumb={[{ label: 'หน้าหลัก', to: '/' }, { label: 'รวมแชท' }]} />
      <div className="grid flex-1 grid-cols-[320px_1fr_360px] overflow-hidden">
        <RoomList activeRoomId={activeRoomId} onSelect={setActiveRoomId} />
        <div className="bg-background p-4 text-sm text-muted-foreground leading-snug">
          เลือกห้องจากด้านซ้ายเพื่อดูการสนทนา
        </div>
        <div className="border-l border-border bg-card p-4" />
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Add lazy route in App.tsx**

Find the lazy-route block and add:
```tsx
const ChatInboxPage = lazy(() => import('./pages/chat/ChatInboxPage'));
// inside <Routes>:
<Route path="/chat" element={<ProtectedRoute><MainLayout><ChatInboxPage /></MainLayout></ProtectedRoute>} />
```

- [ ] **Step 8: Add nav item in MainLayout.tsx**

Find the nav list and add an entry:
```tsx
{ to: '/chat', label: 'รวมแชท', icon: <MessageCircle className="h-4 w-4" /> }
```
(Use whatever icon import pattern the file uses.)

- [ ] **Step 9: Type check + run web**

```bash
./tools/check-types.sh web
cd apps/web && npm run dev
# Open http://localhost:5173/chat — should render room list (may be empty if no rooms)
```

- [ ] **Step 10: Commit**

```bash
git add apps/web/src/pages/chat/ apps/web/src/App.tsx apps/web/src/components/MainLayout.tsx
git commit -m "feat(chat-inbox): /chat page skeleton + room list with filters"
```

---

## Task 12: Unified Inbox UI — conversation panel (center column)

**Files:**
- Create: `apps/web/src/pages/chat/components/ConversationPanel.tsx`
- Create: `apps/web/src/pages/chat/components/MessageBubble.tsx`
- Create: `apps/web/src/pages/chat/components/ComposeBox.tsx`
- Create: `apps/web/src/pages/chat/hooks/useRoomMessages.ts`
- Modify: `apps/web/src/pages/chat/ChatInboxPage.tsx` — wire center column

**Context:** Center shows the conversation messages ascending by time, grouped by date. AI draft messages (intent starts with `DRAFT:`) render with emerald left border + "AI draft" label. Compose box at bottom lets staff type and send.

- [ ] **Step 1: Write useRoomMessages hook**

```typescript
// apps/web/src/pages/chat/hooks/useRoomMessages.ts
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchMessages } from '../lib/chat-api';

export function useRoomMessages(roomId: string | null) {
  return useQuery({
    queryKey: ['chat-messages', roomId],
    queryFn: () => (roomId ? fetchMessages(roomId) : Promise.resolve([])),
    enabled: !!roomId,
    refetchInterval: 5000,
  });
}

export function useInvalidateRoomMessages() {
  const qc = useQueryClient();
  return (roomId: string) => qc.invalidateQueries({ queryKey: ['chat-messages', roomId] });
}
```

- [ ] **Step 2: Write MessageBubble**

```tsx
// apps/web/src/pages/chat/components/MessageBubble.tsx
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';

export interface Message {
  id: string;
  role: 'CUSTOMER' | 'STAFF' | 'AI';
  text: string;
  createdAt: string;
  intent?: string | null;
  confidence?: number | null;
  toolsUsed?: string[];
}

export function MessageBubble({ message }: { message: Message }) {
  const isCustomer = message.role === 'CUSTOMER';
  const isDraft = message.intent?.startsWith('DRAFT:');
  return (
    <div className={cn('flex', isCustomer ? 'justify-start' : 'justify-end')}>
      <div
        className={cn(
          'max-w-[75%] rounded-lg px-3 py-2 text-sm leading-snug',
          isCustomer ? 'bg-muted text-foreground' : 'bg-primary text-primary-foreground',
          isDraft && 'border-l-4 border-emerald-500 bg-card text-foreground',
        )}
      >
        {message.text}
        {message.role === 'AI' && (
          <div className="mt-1 flex items-center gap-1 text-[10px] opacity-70">
            <span>AI</span>
            {isDraft && <Badge variant="outline" className="h-4 text-[9px]">Draft</Badge>}
            {typeof message.confidence === 'number' && <span>· {(message.confidence * 100).toFixed(0)}%</span>}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Write ComposeBox**

```tsx
// apps/web/src/pages/chat/components/ComposeBox.tsx
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Send } from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import { sendStaffMessage } from '../lib/chat-api';
import { toast } from 'sonner';
import { useInvalidateRoomMessages } from '../hooks/useRoomMessages';

export function ComposeBox({ roomId }: { roomId: string }) {
  const [text, setText] = useState('');
  const invalidate = useInvalidateRoomMessages();
  const mutation = useMutation({
    mutationFn: (body: { roomId: string; text: string }) => sendStaffMessage(body.roomId, body.text),
    onSuccess: () => {
      setText('');
      invalidate(roomId);
      toast.success('ส่งข้อความแล้ว');
    },
    onError: () => toast.error('ส่งไม่สำเร็จ'),
  });

  return (
    <div className="border-t border-border p-3">
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="พิมพ์ข้อความส่งเป็น staff..."
        className="min-h-[64px] resize-none leading-snug"
      />
      <div className="mt-2 flex justify-end">
        <Button
          onClick={() => mutation.mutate({ roomId, text })}
          disabled={!text.trim() || mutation.isPending}
        >
          <Send className="mr-2 h-4 w-4" />
          ส่ง
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Write ConversationPanel**

```tsx
// apps/web/src/pages/chat/components/ConversationPanel.tsx
import { ScrollArea } from '@/components/ui/scroll-area';
import { MessageBubble, type Message } from './MessageBubble';
import { ComposeBox } from './ComposeBox';
import { useRoomMessages } from '../hooks/useRoomMessages';

export function ConversationPanel({ roomId }: { roomId: string | null }) {
  const { data = [], isLoading } = useRoomMessages(roomId);

  if (!roomId) {
    return (
      <div className="flex h-full items-center justify-center bg-background p-4 text-sm text-muted-foreground leading-snug">
        เลือกห้องจากด้านซ้ายเพื่อดูการสนทนา
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <ScrollArea className="flex-1 p-4">
        {isLoading && <div className="text-sm text-muted-foreground">กำลังโหลด...</div>}
        <div className="flex flex-col gap-2">
          {(data as Message[]).map((m) => (
            <MessageBubble key={m.id} message={m} />
          ))}
        </div>
      </ScrollArea>
      <ComposeBox roomId={roomId} />
    </div>
  );
}
```

- [ ] **Step 5: Wire into ChatInboxPage**

Replace the placeholder center div in `ChatInboxPage.tsx`:
```tsx
// Replace:
<div className="bg-background p-4 text-sm text-muted-foreground leading-snug">เลือกห้อง...</div>
// With:
<ConversationPanel roomId={activeRoomId} />
```
And add `import { ConversationPanel } from './components/ConversationPanel';`.

- [ ] **Step 6: Type check + manual smoke test**

```bash
./tools/check-types.sh web
cd apps/web && npm run dev
# Open /chat, click a room, verify messages render and compose sends.
```

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/pages/chat/
git commit -m "feat(chat-inbox): conversation panel with message bubbles + compose box"
```

---

## Task 13: Unified Inbox UI — AI Assistant sidebar (right column)

**Files:**
- Create: `apps/web/src/pages/chat/components/AssistantSidebar.tsx`
- Create: `apps/web/src/pages/chat/components/CustomerCard.tsx`
- Create: `apps/web/src/pages/chat/components/AiDraftCard.tsx`
- Create: `apps/web/src/pages/chat/hooks/useAiDraft.ts`
- Modify: `ChatInboxPage.tsx` — wire sidebar

**Context:** Right column shows (1) customer card if room.customerId exists, (2) the latest unsent AI draft for this room with Approve/Edit/Skip buttons, (3) a Take Over button that sets `aiPaused`. If no draft yet, sidebar shows "ไม่มี AI draft รอพร้อม". Updates every 5 sec.

- [ ] **Step 1: Write useAiDraft hook**

```typescript
// apps/web/src/pages/chat/hooks/useAiDraft.ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { approveDraft, skipDraft, takeOver, fetchMessages } from '../lib/chat-api';
import type { Message } from '../components/MessageBubble';

export function useLatestDraft(roomId: string | null) {
  return useQuery({
    queryKey: ['chat-latest-draft', roomId],
    queryFn: async () => {
      if (!roomId) return null;
      const messages = (await fetchMessages(roomId)) as Message[];
      const latest = [...messages]
        .reverse()
        .find((m) => m.role === 'AI' && m.intent?.startsWith('DRAFT:'));
      return latest ?? null;
    },
    enabled: !!roomId,
    refetchInterval: 5000,
  });
}

export function useApproveDraft() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { draftMessageId: string; editedText?: string; roomId: string }) =>
      approveDraft(args.draftMessageId, args.editedText),
    onSuccess: (_d, args) => {
      qc.invalidateQueries({ queryKey: ['chat-messages', args.roomId] });
      qc.invalidateQueries({ queryKey: ['chat-latest-draft', args.roomId] });
    },
  });
}

export function useSkipDraft() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { draftMessageId: string; roomId: string }) => skipDraft(args.draftMessageId),
    onSuccess: (_d, args) => qc.invalidateQueries({ queryKey: ['chat-latest-draft', args.roomId] }),
  });
}

export function useTakeOver() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (roomId: string) => takeOver(roomId),
    onSuccess: (_d, roomId) => qc.invalidateQueries({ queryKey: ['chat-rooms'] }),
  });
}
```

- [ ] **Step 2: Write CustomerCard**

```tsx
// apps/web/src/pages/chat/components/CustomerCard.tsx
import { api } from '@/lib/api';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Link } from 'react-router-dom';

interface CustomerSummary {
  id: string;
  name: string;
  phone: string | null;
  activeContracts: number;
  overdueCount: number;
  totalOutstandingThb: number;
}

export function CustomerCard({ customerId }: { customerId: string }) {
  const { data } = useQuery({
    queryKey: ['customer-summary', customerId],
    queryFn: async () => (await api.get<CustomerSummary>(`/customers/${customerId}/summary`)).data,
    enabled: !!customerId,
  });
  if (!data) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm leading-snug">
          <Link to={`/customers/${data.id}`} className="text-primary hover:underline">
            {data.name}
          </Link>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1 text-xs text-muted-foreground leading-snug">
        <div>โทร: {data.phone ?? '-'}</div>
        <div className="flex flex-wrap gap-1">
          <Badge variant="secondary">{data.activeContracts} สัญญา</Badge>
          {data.overdueCount > 0 && <Badge variant="destructive">ค้าง {data.overdueCount} งวด</Badge>}
        </div>
        <div>คงค้าง: {data.totalOutstandingThb.toLocaleString()} ฿</div>
      </CardContent>
    </Card>
  );
}
```

Note: `/customers/:id/summary` endpoint may need to exist. If not, this Task includes adding it as a thin wrapper in `apps/api/src/modules/customers/customers.controller.ts` returning the summary fields above. Check first:
```bash
grep -n "summary" apps/api/src/modules/customers/customers.controller.ts
```
If missing, add it (simple read endpoint; guard with existing `JwtAuthGuard` + roles).

- [ ] **Step 3: Write AiDraftCard**

```tsx
// apps/web/src/pages/chat/components/AiDraftCard.tsx
import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Check, X, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import type { Message } from './MessageBubble';
import { useApproveDraft, useSkipDraft } from '../hooks/useAiDraft';

export function AiDraftCard({ draft, roomId }: { draft: Message; roomId: string }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(draft.text);
  useEffect(() => setText(draft.text), [draft.id]);
  const approve = useApproveDraft();
  const skip = useSkipDraft();

  const onApprove = () =>
    approve.mutate(
      { draftMessageId: draft.id, editedText: editing ? text : undefined, roomId },
      {
        onSuccess: () => {
          toast.success('ส่งให้ลูกค้าแล้ว');
          setEditing(false);
        },
        onError: () => toast.error('ส่งไม่สำเร็จ'),
      },
    );

  return (
    <Card className="border-emerald-200">
      <CardHeader>
        <CardTitle className="text-sm leading-snug">AI แนะนำคำตอบ</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {editing ? (
          <Textarea value={text} onChange={(e) => setText(e.target.value)} className="leading-snug" />
        ) : (
          <div className="text-sm leading-snug">{draft.text}</div>
        )}
        <div className="text-xs text-muted-foreground">
          {draft.toolsUsed?.length ? `Tools: ${draft.toolsUsed.join(', ')}` : 'ไม่ได้ใช้ tool'}
          {typeof draft.confidence === 'number' && ` · confidence ${(draft.confidence * 100).toFixed(0)}%`}
        </div>
        <div className="flex gap-2">
          <Button size="sm" onClick={onApprove} disabled={approve.isPending}>
            <Check className="mr-1 h-3 w-3" /> ส่ง
          </Button>
          <Button size="sm" variant="outline" onClick={() => setEditing((e) => !e)}>
            <Pencil className="mr-1 h-3 w-3" /> {editing ? 'ยกเลิกแก้' : 'แก้ก่อนส่ง'}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => skip.mutate({ draftMessageId: draft.id, roomId })}
            disabled={skip.isPending}
          >
            <X className="mr-1 h-3 w-3" /> ข้าม
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 4: Write AssistantSidebar**

```tsx
// apps/web/src/pages/chat/components/AssistantSidebar.tsx
import { Button } from '@/components/ui/button';
import { useLatestDraft, useTakeOver } from '../hooks/useAiDraft';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { CustomerCard } from './CustomerCard';
import { AiDraftCard } from './AiDraftCard';
import { Hand } from 'lucide-react';

export function AssistantSidebar({ roomId }: { roomId: string | null }) {
  const { data: draft } = useLatestDraft(roomId);
  const takeOver = useTakeOver();
  const { data: room } = useQuery({
    queryKey: ['chat-room', roomId],
    queryFn: async () => (roomId ? (await api.get(`/staff-chat/rooms/${roomId}`)).data : null),
    enabled: !!roomId,
  });

  if (!roomId) return <div className="p-4 text-sm text-muted-foreground leading-snug">-</div>;

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-3">
      {room?.customerId && <CustomerCard customerId={room.customerId} />}
      {draft ? (
        <AiDraftCard draft={draft} roomId={roomId} />
      ) : (
        <div className="text-sm text-muted-foreground leading-snug">ไม่มี AI draft รอพร้อม</div>
      )}
      <Button
        variant="outline"
        size="sm"
        onClick={() => takeOver.mutate(roomId)}
        disabled={takeOver.isPending || room?.aiPaused}
      >
        <Hand className="mr-1 h-3 w-3" />
        {room?.aiPaused ? 'ถือห้องอยู่แล้ว' : 'ถือห้อง (หยุด AI)'}
      </Button>
    </div>
  );
}
```

- [ ] **Step 5: Wire sidebar into ChatInboxPage**

Replace the placeholder right-column div:
```tsx
<AssistantSidebar roomId={activeRoomId} />
```
and add `import { AssistantSidebar } from './components/AssistantSidebar';`.

- [ ] **Step 6: Type check + smoke test**

```bash
./tools/check-types.sh web
cd apps/web && npm run dev
# /chat → select room → see customer card + AI draft → click approve → draft disappears, message appears in conversation.
```

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/pages/chat/
git commit -m "feat(chat-inbox): AI assistant sidebar (customer card + draft approve/edit/skip + take-over)"
```

---

## Task 14: AiSettingsPage — add per-bot mode toggle

**Files:**
- Modify: `apps/web/src/pages/AiSettingsPage.tsx`
- Create: `apps/api/src/modules/ai-settings/ai-settings.controller.ts` (if missing)
- Create: `apps/api/src/modules/ai-settings/ai-settings.service.ts` (if missing)
- Create: `apps/api/src/modules/ai-settings/ai-settings.module.ts` (if missing)

**Context:** Expose the `salesBotMode` and `serviceBotMode` columns we added in Task 1 through a simple `/api/ai-settings` GET + PATCH. Frontend adds a dropdown `OFF | HYBRID | FULL` per bot. For Week 1 only HYBRID is functional; FULL is wired in Week 2.

- [ ] **Step 1: Check if ai-settings module exists**

```bash
ls apps/api/src/modules/ai-settings/ 2>&1 || echo "MISSING"
```

- [ ] **Step 2: (If missing) Scaffold module**

```typescript
// apps/api/src/modules/ai-settings/ai-settings.service.ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class AiSettingsService {
  constructor(private readonly prisma: PrismaService) {}
  async get() {
    return this.prisma.aiSettings.upsert({
      where: { id: 'singleton' },
      create: { id: 'singleton' },
      update: {},
    });
  }
  async update(data: Partial<{ salesBotMode: string; serviceBotMode: string; salesBotConfidenceThreshold: number; serviceBotConfidenceThreshold: number }>, userId: string) {
    return this.prisma.aiSettings.update({
      where: { id: 'singleton' },
      data: { ...data, updatedById: userId },
    });
  }
}
```
```typescript
// apps/api/src/modules/ai-settings/ai-settings.controller.ts
import { Body, Controller, Get, Patch, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { AiSettingsService } from './ai-settings.service';

@Controller('ai-settings')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AiSettingsController {
  constructor(private readonly svc: AiSettingsService) {}
  @Get()
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER')
  get() { return this.svc.get(); }
  @Patch()
  @Roles('OWNER', 'FINANCE_MANAGER')
  update(@Body() body: { salesBotMode?: string; serviceBotMode?: string; salesBotConfidenceThreshold?: number; serviceBotConfidenceThreshold?: number }, @Req() req: { user: { id: string } }) {
    return this.svc.update(body, req.user.id);
  }
}
```
```typescript
// apps/api/src/modules/ai-settings/ai-settings.module.ts
import { Module } from '@nestjs/common';
import { AiSettingsService } from './ai-settings.service';
import { AiSettingsController } from './ai-settings.controller';
import { PrismaModule } from '../../prisma/prisma.module';
@Module({ imports: [PrismaModule], controllers: [AiSettingsController], providers: [AiSettingsService], exports: [AiSettingsService] })
export class AiSettingsModule {}
```
Register in `app.module.ts`.

- [ ] **Step 3: Add UI — 2 dropdowns in AiSettingsPage**

Locate where existing AI toggles live in `AiSettingsPage.tsx`. Add a section:

```tsx
// Inside AiSettingsPage.tsx
<Card>
  <CardHeader>
    <CardTitle>โหมด AI ต่อบอท</CardTitle>
  </CardHeader>
  <CardContent className="space-y-3">
    <div className="flex items-center justify-between gap-2">
      <Label>บอทขาย</Label>
      <Select value={settings.salesBotMode} onValueChange={(v) => update.mutate({ salesBotMode: v })}>
        <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="OFF">OFF</SelectItem>
          <SelectItem value="HYBRID">HYBRID (แนะนำ)</SelectItem>
          <SelectItem value="FULL">FULL (Week 2)</SelectItem>
        </SelectContent>
      </Select>
    </div>
    <div className="flex items-center justify-between gap-2">
      <Label>น้องเบส (บริการ)</Label>
      <Select value={settings.serviceBotMode} onValueChange={(v) => update.mutate({ serviceBotMode: v })}>
        <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="OFF">OFF</SelectItem>
          <SelectItem value="HYBRID">HYBRID (แนะนำ)</SelectItem>
          <SelectItem value="FULL">FULL (Week 2)</SelectItem>
        </SelectContent>
      </Select>
    </div>
  </CardContent>
</Card>
```
Add matching react-query `useQuery` / `useMutation` hooks using `/ai-settings`. Use the pattern already in that file.

- [ ] **Step 4: Enforce `mode='OFF'` in ChatAiDraftService.generateDraft**

At the top of `ChatAiDraftService.generateDraft`, after loading the inbound message:

```typescript
const settings = await this.prisma.aiSettings.findUnique({ where: { id: 'singleton' } });
if (!settings) {
  /* Default HYBRID if settings row missing */
} else {
  const mode = routed.routeTo === 'sales' ? settings.salesBotMode : settings.serviceBotMode;
  if (mode === 'OFF') {
    this.logger.log(`Bot ${routed.routeTo} is OFF — no draft generated`);
    return { draftMessageId: '' };
  }
  // FULL mode is wired in Week 2 — for Week 1 treat FULL the same as HYBRID (draft only, no auto-send)
}
```

- [ ] **Step 5: Type check + manual smoke test**

```bash
./tools/check-types.sh all
cd apps/web && npm run dev
# Go to /settings/... (AI settings page). Toggle salesBotMode=OFF, send a test LINE message, verify no draft created.
```

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/ai-settings/ apps/api/src/app.module.ts apps/web/src/pages/AiSettingsPage.tsx apps/api/src/modules/chat-ai-draft/
git commit -m "feat(ai-settings): per-bot mode (OFF/HYBRID/FULL) toggle + enforce in draft orchestrator"
```

---

## Task 15: E2E smoke test — inbox approve-and-send flow

**Files:**
- Create: `apps/web/e2e/chat-inbox.spec.ts`

**Context:** Playwright test that logs in as OWNER, seeds one inbound `ChatMessage`, waits for draft, clicks Approve, verifies message is sent (deliveredAt set) in DB or next message in conversation shows the staff-attributed AI text.

- [ ] **Step 1: Write the test**

```typescript
// apps/web/e2e/chat-inbox.spec.ts
import { test, expect } from '@playwright/test';

test('staff approves AI draft in /chat', async ({ page }) => {
  await page.goto('/login');
  await page.fill('[name="email"]', 'admin@bestchoice.com');
  await page.fill('[name="password"]', 'admin1234');
  await page.click('button[type="submit"]');

  await page.goto('/chat');
  // assume at least one seeded room exists; click the first room
  await page.click('[data-testid="room-list-item"]', { timeout: 10000 });

  // Wait for AI draft (polling every 5s — allow 30s)
  const draftCard = page.locator('text=AI แนะนำคำตอบ');
  await draftCard.waitFor({ state: 'visible', timeout: 30000 });

  // Approve
  await page.click('button:has-text("ส่ง")');

  // Verify toast + new message appears in conversation
  await expect(page.locator('text=ส่งให้ลูกค้าแล้ว')).toBeVisible();
});
```
Add `data-testid="room-list-item"` on the `RoomListItem` button.

- [ ] **Step 2: Add seeding hook (optional — use existing seed if present)**

If there's no seeded inbound, add one via the test setup. Option A: use a Prisma seed script; Option B: POST to a test-only endpoint.

Since we're on tight timeline, prefer a simple seeded room in the existing `apps/api/prisma/seed.ts` (or the seed script used by E2E). If neither exists, mark this E2E as `.skip` for now and rely on manual smoke tests. Do NOT ship a broken E2E.

- [ ] **Step 3: Run the E2E**

```bash
cd apps/web && npx playwright test e2e/chat-inbox.spec.ts
```
Expected: pass or explicit skip.

- [ ] **Step 4: Commit**

```bash
git add apps/web/e2e/chat-inbox.spec.ts apps/web/src/pages/chat/components/RoomListItem.tsx
git commit -m "test(chat-inbox): e2e smoke — approve AI draft flow"
```

---

## Task 16: Final integration pass — full type check + all tests

**Files:** none (verification only)

- [ ] **Step 1: Run full type check**

```bash
./tools/check-types.sh all
```
Expected: 0 errors on both api and web.

- [ ] **Step 2: Run full test suite**

```bash
./tools/run-tests.sh --skip-e2e
```
Expected: all unit + integration pass.

- [ ] **Step 3: Run E2E**

```bash
cd apps/web && npx playwright test
```
Expected: no new failures beyond existing skipped/flaky tests.

- [ ] **Step 4: Manual dogfood checklist (10 min)**

Test in browser at `http://localhost:5173/chat`:
- [ ] Room list loads and filters work
- [ ] Select a room → conversation panel shows messages
- [ ] AI draft card appears within 30s after sending a test message (use LINE OA test tool)
- [ ] Approve → message sent, toast shown, conversation updates
- [ ] Edit-then-approve sends edited text
- [ ] Skip hides the draft
- [ ] Take-over sets room.aiPaused and no new drafts appear
- [ ] AiSettings toggle salesBotMode=OFF stops draft generation

- [ ] **Step 5: Commit any docs updates + push**

If any workflow doc or memory needs updating based on Week 1 learnings, do it now. Otherwise create a PR:

```bash
git checkout -b feature/chat-ai-week1-hybrid-c
git push -u origin feature/chat-ai-week1-hybrid-c
gh pr create --title "feat(chat-ai): Week 1 Hybrid C — unified inbox + dual bots + AI drafts" --body "$(cat <<'EOF'
## Summary
- `/chat` unified inbox page with room list, conversation panel, AI assistant sidebar
- Intent router + Sales bot (Claude Haiku, 4 tools)
- น้องเบส enhanced with full conversation history window
- Historical chat extractor (LINE existing + Facebook Graph API) + PII scrubber + Claude-batch knowledge seeding into ChatKnowledgeBase
- Per-bot OFF/HYBRID/FULL toggle in AiSettings (FULL wired in Week 2)
- Hybrid C approve/edit/skip/take-over flow

## Test plan
- [ ] Staff opens /chat, approves an AI draft, verifies customer receives message on LINE
- [ ] Staff uses Take-over, verifies aiPaused=true and no new drafts
- [ ] Owner toggles salesBotMode=OFF, verifies no drafts generated
- [ ] Extract historical LINE+Facebook chats, verify ChatKnowledgeBase populated with derived FAQs
- [ ] Intent router correctly routes sales inquiries to sales bot, service inquiries to น้องเบส

Spec: docs/superpowers/specs/2026-04-22-chat-ai-unified-inbox-design.md

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review (done before handing off)

- **Spec coverage:** All 14 spec sections map to at least one task. Guardrails #2 (no-go list) and #3 (hallucination guard) + RAG + A/B rollout are deferred to Week 2 as stated in the spec's phased rollout.
- **Placeholder scan:** No TBDs in steps; fields like `Promotion.productIds` are flagged as "check schema before finalizing" because the plan cannot promise a field that may not exist.
- **Type consistency:** `SalesBotResult`, `IntentResult`, `ExtractedMessage`, `Message` (frontend) are defined once and reused. `ChatRoom.aiPaused` + `AiSettings.*BotMode` are the only new schema fields.
- **Execution order sanity:** Task 1 (schema) blocks 9+14; Tasks 2/3 feed 4; 4 feeds 5; 6+7+8 can run in parallel; 9 depends on 6+7+8; 10 depends on 9; 11→12→13 is UI sequence; 14+15+16 are final.
