# Chat Sales Efficiency Phase 2 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** AI ตอบลูกค้าเองได้ 24 ชม. + เรียนรู้จากพนักงาน + import ประวัติแชท Chatcone + performance dashboard

**Architecture:** Extend Phase 1 AiSuggestService with auto-reply capability in MessageRouter, add feedback tracking from AiSuggestPanel, store training pairs for few-shot learning, daily cron extracts training data from existing chats

**Tech Stack:** NestJS, Prisma, Claude API (Anthropic SDK), React, TanStack Query, Socket.io, NestJS @Cron

**Spec:** `docs/superpowers/specs/2026-04-15-chat-sales-phase2-design.md`

---

## File Map

### New Files

| File | Responsibility |
|------|---------------|
| `apps/api/src/modules/staff-chat/services/ai-auto-reply.service.ts` | Auto mode: check settings → call suggest → send if confident → handoff if not |
| `apps/api/src/modules/staff-chat/services/ai-training.service.ts` | Manage training pairs: save feedback, select few-shot examples, calculate quality |
| `apps/api/src/modules/staff-chat/services/ai-import.service.ts` | Parse & import Chatcone CSV/JSON files |
| `apps/api/src/modules/staff-chat/services/ai-metrics.service.ts` | Calculate AI performance metrics (auto-reply rate, accept rate, trends) |
| `apps/api/src/modules/staff-chat/cron/training-extract.cron.ts` | Daily cron: extract training pairs from ChatMessage |
| `apps/api/src/modules/staff-chat/dto/ai-training.dto.ts` | DTOs for training feedback + import |
| `apps/api/src/modules/staff-chat/dto/ai-settings.dto.ts` | DTO for AI auto mode settings |
| `apps/web/src/pages/AiSettingsPage.tsx` | OWNER settings: auto mode, threshold slider, channels |
| `apps/web/src/pages/AiTrainingPage.tsx` | Training data dashboard + Chatcone import |
| `apps/web/src/pages/AiPerformancePage.tsx` | Performance metrics + charts |
| `apps/api/prisma/migrations/XXXXXX_add_ai_training_pairs/migration.sql` | DB migration |

### Files to Modify

| File | Change |
|------|--------|
| `apps/api/prisma/schema.prisma` | Add AiTrainingPair, AiAutoReplyLog models |
| `apps/api/src/modules/staff-chat/services/ai-suggest.service.ts` | Inject few-shot examples from training pairs |
| `apps/api/src/modules/chat-engine/services/message-router.service.ts` | Add auto-reply check before after-hours/domain handler |
| `apps/api/src/modules/staff-chat/staff-chat.module.ts` | Register new services |
| `apps/api/src/modules/staff-chat/staff-chat.controller.ts` | Add training feedback, import, metrics, settings endpoints |
| `apps/web/src/pages/UnifiedInboxPage/components/AiSuggestPanel.tsx` | Track accept/edit/reject + send feedback |
| `apps/web/src/pages/UnifiedInboxPage/components/ChatPanel.tsx` | Pass selected suggestion metadata to send handler |
| `apps/web/src/App.tsx` | Add routes for AI settings/training/performance pages |
| `apps/web/src/config/menu.ts` | Add AI pages to OWNER sidebar menu |

---

## Task 1: Database Migration — AiTrainingPair + AiAutoReplyLog

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: migration via `prisma migrate dev`

- [ ] **Step 1: Add AiTrainingPair model**

Add to `schema.prisma`:

```prisma
model AiTrainingPair {
  id              String       @id @default(uuid())
  type            String       // ACCEPT, EDIT, REJECT
  source          String       // SUGGEST_FEEDBACK, CHATCONE_IMPORT, SYSTEM_EXTRACT
  sessionId       String?      @map("session_id")
  session         ChatSession? @relation(fields: [sessionId], references: [id])
  customerMessage String       @map("customer_message") @db.Text
  aiDraft         String?      @map("ai_draft") @db.Text
  humanEdit       String?      @map("human_edit") @db.Text
  intent          String?
  quality         Float?
  usedInPrompt    Boolean      @default(false) @map("used_in_prompt")
  createdAt       DateTime     @default(now()) @map("created_at")

  @@index([intent, quality])
  @@index([source])
  @@index([createdAt])
  @@map("ai_training_pairs")
}
```

- [ ] **Step 2: Add AiAutoReplyLog model**

```prisma
model AiAutoReplyLog {
  id              String       @id @default(uuid())
  sessionId       String       @map("session_id")
  session         ChatSession  @relation(fields: [sessionId], references: [id])
  customerMessage String       @map("customer_message") @db.Text
  aiReply         String       @map("ai_reply") @db.Text
  confidence      Float
  autoSent        Boolean      @map("auto_sent")
  handoffReason   String?      @map("handoff_reason")
  createdAt       DateTime     @default(now()) @map("created_at")

  @@index([sessionId])
  @@index([autoSent, createdAt])
  @@map("ai_auto_reply_logs")
}
```

- [ ] **Step 3: Add relations to ChatSession**

Add to ChatSession model:

```prisma
  trainingPairs     AiTrainingPair[]
  autoReplyLogs     AiAutoReplyLog[]
```

- [ ] **Step 4: Run migration**

```bash
cd apps/api && npx prisma migrate dev --name add_ai_training_and_auto_reply
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/prisma/
git commit -m "feat(api): add AiTrainingPair and AiAutoReplyLog models"
```

---

## Task 2: AI Training Service

**Files:**
- Create: `apps/api/src/modules/staff-chat/services/ai-training.service.ts`
- Create: `apps/api/src/modules/staff-chat/dto/ai-training.dto.ts`

- [ ] **Step 1: Create DTO**

```typescript
// apps/api/src/modules/staff-chat/dto/ai-training.dto.ts
import { IsString, IsOptional, IsEnum } from 'class-validator';

export class SaveFeedbackDto {
  @IsString()
  sessionId: string;

  @IsEnum(['ACCEPT', 'EDIT', 'REJECT'])
  type: 'ACCEPT' | 'EDIT' | 'REJECT';

  @IsString()
  customerMessage: string;

  @IsString()
  @IsOptional()
  aiDraft?: string;

  @IsString()
  @IsOptional()
  humanEdit?: string;

  @IsString()
  @IsOptional()
  intent?: string;
}
```

- [ ] **Step 2: Create ai-training.service.ts**

Service responsibilities:
1. `saveFeedback(dto)` — save training pair from suggest panel feedback, calculate quality score
2. `getFewShotExamples(intent, limit)` — return top training pairs for few-shot prompt injection
3. `getTrainingStats()` — return counts by source/type

Quality scoring logic:
- ACCEPT = 1.0
- EDIT with edit distance < 30% = 0.7
- EDIT with edit distance >= 30% = 0.3
- REJECT = 0.0

Few-shot selection: query AiTrainingPair where quality >= 0.7, ordered by quality DESC, filtered by intent if provided, limit 10.

`getFewShotExamples` returns array of `{ customerMessage, staffResponse }` where staffResponse = humanEdit ?? aiDraft.

- [ ] **Step 3: Type check**

```bash
./tools/check-types.sh api
```

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/staff-chat/services/ai-training.service.ts apps/api/src/modules/staff-chat/dto/ai-training.dto.ts
git commit -m "feat(api): add AiTrainingService — feedback storage and few-shot selection"
```

---

## Task 3: Inject Few-Shot Examples into AI Suggest

**Files:**
- Modify: `apps/api/src/modules/staff-chat/services/ai-suggest.service.ts`

- [ ] **Step 1: Add AiTrainingService dependency**

Import `AiTrainingService` and inject in constructor.

- [ ] **Step 2: Add few-shot examples to prompt**

In the `suggest()` method, after building `productContext` and before building `userMessage` (~line 130):

1. Call `this.aiTraining.getFewShotExamples(detectedIntent, 5)` — detect intent from last customer message keywords
2. Build examples section:

```typescript
const examples = await this.aiTraining.getFewShotExamples(null, 5);
const examplesText = examples.length > 0
  ? '## ตัวอย่างข้อความที่ดีจากพนักงาน\n\n' +
    examples.map((ex) => `ลูกค้า: "${ex.customerMessage}"\nพนักงาน: "${ex.staffResponse}"`).join('\n\n')
  : '';
```

3. Insert `examplesText` into `userMessage` before the conversation section.

- [ ] **Step 3: Type check**

```bash
./tools/check-types.sh api
```

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/staff-chat/services/ai-suggest.service.ts
git commit -m "feat(api): inject few-shot training examples into AI suggest prompt"
```

---

## Task 4: AI Auto Reply Service

**Files:**
- Create: `apps/api/src/modules/staff-chat/services/ai-auto-reply.service.ts`
- Create: `apps/api/src/modules/staff-chat/dto/ai-settings.dto.ts`

- [ ] **Step 1: Create settings DTO**

```typescript
// apps/api/src/modules/staff-chat/dto/ai-settings.dto.ts
import { IsBoolean, IsNumber, IsArray, IsOptional, Min, Max } from 'class-validator';

export class UpdateAiSettingsDto {
  @IsBoolean()
  @IsOptional()
  aiAutoEnabled?: boolean;

  @IsArray()
  @IsOptional()
  aiAutoChannels?: string[];

  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(100)
  aiAutoConfidenceThreshold?: number;

  @IsNumber()
  @IsOptional()
  @Min(1)
  @Max(20)
  aiAutoMaxRepliesPerSession?: number;
}

export interface AiAutoSettings {
  aiAutoEnabled: boolean;
  aiAutoChannels: string[];
  aiAutoConfidenceThreshold: number;
  aiAutoMaxRepliesPerSession: number;
}
```

- [ ] **Step 2: Create ai-auto-reply.service.ts**

Service logic:
1. `shouldAutoReply(session)` — check if auto mode enabled for this channel + session hasn't exceeded max replies
2. `autoReply(sessionId, customerMessage)` — call AiSuggestService.suggest() → if confidence >= threshold, return the reply text → else return null (triggers handoff)
3. `getSettings()` / `updateSettings(dto)` — read/write settings from env vars or DB (use ConfigService for now, can migrate to DB later)
4. `logAutoReply(params)` — save AiAutoReplyLog record

The service uses `AiSuggestService` for generating replies and `PrismaService` for logging.

For settings storage in Phase 2: use environment variables (`AI_AUTO_ENABLED`, `AI_AUTO_CHANNELS`, `AI_AUTO_CONFIDENCE_THRESHOLD`, `AI_AUTO_MAX_REPLIES`). Settings endpoint returns current values.

- [ ] **Step 3: Type check**

```bash
./tools/check-types.sh api
```

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/staff-chat/services/ai-auto-reply.service.ts apps/api/src/modules/staff-chat/dto/ai-settings.dto.ts
git commit -m "feat(api): add AiAutoReplyService — AI auto mode with confidence threshold"
```

---

## Task 5: Integrate Auto Reply into MessageRouter

**Files:**
- Modify: `apps/api/src/modules/chat-engine/services/message-router.service.ts`

- [ ] **Step 1: Add AiAutoReplyService dependency**

Import and inject `AiAutoReplyService` in MessageRouter constructor.

- [ ] **Step 2: Add auto-reply check in routeInbound**

In `routeInbound()`, insert auto-reply logic AFTER the handoff check (line 111) and BEFORE the after-hours check (line 113):

```typescript
// After handoff check, before after-hours:
if (!session.handoffMode) {
  const autoReplyService = this.aiAutoReply;
  if (autoReplyService && await autoReplyService.shouldAutoReply(session)) {
    const reply = await autoReplyService.autoReply(session.id, message.text ?? '');
    if (reply) {
      // AI is confident — send reply directly
      const adapter = this.getAdapter(session.channel);
      await adapter.sendMessage(session.externalUserId, reply);
      await this.sessionManager.saveMessage({
        sessionId: session.id,
        text: reply,
        role: 'BOT',
      });
      await autoReplyService.logAutoReply({
        sessionId: session.id,
        customerMessage: message.text ?? '',
        aiReply: reply,
        confidence: 0.9, // from suggest response
        autoSent: true,
      });
      return; // Skip domain handler
    } else {
      // AI not confident — handoff to staff
      await this.handoffManager.initiateHandoff(session.id, 'AI confidence below threshold');
      await autoReplyService.logAutoReply({
        sessionId: session.id,
        customerMessage: message.text ?? '',
        aiReply: '',
        confidence: 0,
        autoSent: false,
        handoffReason: 'confidence_below_threshold',
      });
      return;
    }
  }
}
```

NOTE: Read the actual routeInbound code to adapt variable names and flow. The key is: auto-reply check goes AFTER handoff check, BEFORE after-hours/domain handler.

When auto mode is active, skip AfterHoursService (AI handles it instead).

- [ ] **Step 3: Register AiAutoReplyService in chat-engine module**

The MessageRouter is in chat-engine module. Either:
- Export AiAutoReplyService from staff-chat module and import in chat-engine
- Or inject via module reference

Read existing module imports to determine the right approach.

- [ ] **Step 4: Type check**

```bash
./tools/check-types.sh api
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/chat-engine/ apps/api/src/modules/staff-chat/
git commit -m "feat(api): integrate AI auto-reply into MessageRouter pipeline"
```

---

## Task 6: Register Services + API Endpoints

**Files:**
- Modify: `apps/api/src/modules/staff-chat/staff-chat.module.ts`
- Modify: `apps/api/src/modules/staff-chat/staff-chat.controller.ts`

- [ ] **Step 1: Register new services in module**

Add to providers: `AiAutoReplyService`, `AiTrainingService`, `AiImportService` (Task 8), `AiMetricsService` (Task 9), `TrainingExtractCron` (Task 7).

For now register what exists: AiAutoReplyService, AiTrainingService.

- [ ] **Step 2: Add endpoints to controller**

```typescript
// Training feedback
@Post('ai/training-feedback')
@Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES')
async saveTrainingFeedback(@Body() dto: SaveFeedbackDto) {
  return this.aiTraining.saveFeedback(dto);
}

// Training stats
@Get('ai/training-stats')
@Roles('OWNER')
async getTrainingStats() {
  return this.aiTraining.getTrainingStats();
}

// AI settings
@Get('ai/settings')
@Roles('OWNER')
async getAiSettings() {
  return this.aiAutoReply.getSettings();
}

@Patch('ai/settings')
@Roles('OWNER')
async updateAiSettings(@Body() dto: UpdateAiSettingsDto) {
  return this.aiAutoReply.updateSettings(dto);
}
```

- [ ] **Step 3: Type check**

```bash
./tools/check-types.sh api
```

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/staff-chat/
git commit -m "feat(api): add AI training feedback, stats, and settings endpoints"
```

---

## Task 7: Training Extract Cron

**Files:**
- Create: `apps/api/src/modules/staff-chat/cron/training-extract.cron.ts`

- [ ] **Step 1: Create cron service**

Daily cron (runs at 3:00 AM Bangkok) that extracts training pairs from ChatMessage:

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../../prisma/prisma.service';

@Injectable()
export class TrainingExtractCron {
  private readonly logger = new Logger(TrainingExtractCron.name);

  constructor(private prisma: PrismaService) {}

  @Cron('0 3 * * *', { timeZone: 'Asia/Bangkok' })
  async extractTrainingPairs(): Promise<void> {
    this.logger.log('Starting daily training pair extraction');

    // Find customer→staff message pairs (staff replied within 5 minutes)
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 1); // yesterday

    const customerMessages = await this.prisma.chatMessage.findMany({
      where: {
        role: 'CUSTOMER',
        text: { not: null },
        createdAt: { gte: cutoff },
      },
      include: { session: true },
      orderBy: { createdAt: 'asc' },
    });

    let created = 0;
    for (const custMsg of customerMessages) {
      // Find next STAFF reply within 5 minutes
      const fiveMinLater = new Date(custMsg.createdAt.getTime() + 5 * 60 * 1000);
      const staffReply = await this.prisma.chatMessage.findFirst({
        where: {
          sessionId: custMsg.sessionId,
          role: 'STAFF',
          text: { not: null },
          createdAt: { gt: custMsg.createdAt, lte: fiveMinLater },
        },
        orderBy: { createdAt: 'asc' },
      });

      if (!staffReply?.text) continue;

      // Check if pair already exists (deduplicate)
      const exists = await this.prisma.aiTrainingPair.findFirst({
        where: {
          source: 'SYSTEM_EXTRACT',
          customerMessage: custMsg.text!,
          humanEdit: staffReply.text,
        },
      });
      if (exists) continue;

      await this.prisma.aiTrainingPair.create({
        data: {
          type: 'ACCEPT',
          source: 'SYSTEM_EXTRACT',
          sessionId: custMsg.sessionId,
          customerMessage: custMsg.text!,
          humanEdit: staffReply.text,
          quality: 0.6, // system-extracted, moderate quality
        },
      });
      created++;
    }

    this.logger.log(`Extracted ${created} training pairs`);
  }
}
```

- [ ] **Step 2: Register in module**

Add `TrainingExtractCron` to staff-chat.module.ts providers.

- [ ] **Step 3: Type check**

```bash
./tools/check-types.sh api
```

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/staff-chat/
git commit -m "feat(api): add daily cron to extract training pairs from chat history"
```

---

## Task 8: AI Import Service (Chatcone)

**Files:**
- Create: `apps/api/src/modules/staff-chat/services/ai-import.service.ts`

- [ ] **Step 1: Create import service**

Service that parses CSV/JSON files of chat history and creates training pairs:

```typescript
import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

interface ChatRow {
  timestamp: string;
  senderType: 'customer' | 'staff';
  message: string;
}

@Injectable()
export class AiImportService {
  private readonly logger = new Logger(AiImportService.name);

  constructor(private prisma: PrismaService) {}

  async importChatHistory(rows: ChatRow[]): Promise<{ imported: number; skipped: number }> {
    // Sort by timestamp
    const sorted = [...rows].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    let imported = 0;
    let skipped = 0;

    for (let i = 0; i < sorted.length - 1; i++) {
      const current = sorted[i];
      const next = sorted[i + 1];

      // Find customer→staff pairs
      if (current.senderType === 'customer' && next.senderType === 'staff') {
        if (!current.message?.trim() || !next.message?.trim()) {
          skipped++;
          continue;
        }

        // Deduplicate
        const exists = await this.prisma.aiTrainingPair.findFirst({
          where: {
            source: 'CHATCONE_IMPORT',
            customerMessage: current.message.trim(),
            humanEdit: next.message.trim(),
          },
        });

        if (exists) {
          skipped++;
          continue;
        }

        await this.prisma.aiTrainingPair.create({
          data: {
            type: 'ACCEPT',
            source: 'CHATCONE_IMPORT',
            customerMessage: current.message.trim(),
            humanEdit: next.message.trim(),
            quality: 0.5, // imported, unknown quality
          },
        });
        imported++;
        i++; // Skip the staff message (already paired)
      }
    }

    this.logger.log(`Import complete: ${imported} imported, ${skipped} skipped`);
    return { imported, skipped };
  }

  parseCSV(csvContent: string): ChatRow[] {
    const lines = csvContent.split('\n').filter((l) => l.trim());
    if (lines.length < 2) throw new BadRequestException('CSV ต้องมีอย่างน้อย 1 แถวข้อมูล');

    const header = lines[0].toLowerCase();
    const hasHeader = header.includes('timestamp') || header.includes('sender');

    const dataLines = hasHeader ? lines.slice(1) : lines;

    return dataLines.map((line) => {
      const parts = line.split(',').map((p) => p.trim().replace(/^"|"$/g, ''));
      if (parts.length < 3) throw new BadRequestException(`บรรทัดไม่ถูกรูปแบบ: ${line}`);
      return {
        timestamp: parts[0],
        senderType: parts[1].toLowerCase().includes('customer') ? 'customer' : 'staff',
        message: parts.slice(2).join(','), // Handle commas in message
      };
    });
  }

  parseJSON(jsonContent: string): ChatRow[] {
    const data = JSON.parse(jsonContent);
    if (!Array.isArray(data)) throw new BadRequestException('JSON ต้องเป็น array');
    return data.map((row: any) => ({
      timestamp: row.timestamp ?? row.date ?? new Date().toISOString(),
      senderType: (row.senderType ?? row.sender_type ?? row.role ?? '').toLowerCase().includes('customer') ? 'customer' : 'staff',
      message: row.message ?? row.text ?? row.content ?? '',
    }));
  }
}
```

- [ ] **Step 2: Add import endpoint to controller**

```typescript
@Post('ai/import')
@Roles('OWNER')
@UseInterceptors(FileInterceptor('file'))
async importChatHistory(@UploadedFile() file: Express.Multer.File) {
  const content = file.buffer.toString('utf-8');
  const isJSON = file.originalname.endsWith('.json');
  const rows = isJSON ? this.aiImport.parseJSON(content) : this.aiImport.parseCSV(content);
  return this.aiImport.importChatHistory(rows);
}
```

- [ ] **Step 3: Register in module, type check**

```bash
./tools/check-types.sh api
```

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/staff-chat/
git commit -m "feat(api): add AiImportService — Chatcone CSV/JSON chat history import"
```

---

## Task 9: AI Metrics Service

**Files:**
- Create: `apps/api/src/modules/staff-chat/services/ai-metrics.service.ts`

- [ ] **Step 1: Create metrics service**

```typescript
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

interface AiMetrics {
  autoReplyRate: number;
  handoffRate: number;
  acceptRate: number;
  editRate: number;
  rejectRate: number;
  avgConfidence: number;
  totalTrainingPairs: number;
  usableTrainingPairs: number; // quality >= 0.7
}

@Injectable()
export class AiMetricsService {
  constructor(private prisma: PrismaService) {}

  async getMetrics(from?: Date, to?: Date): Promise<AiMetrics> {
    const dateFilter = {
      ...(from && { gte: from }),
      ...(to && { lte: to }),
    };
    const hasDateFilter = from || to;

    // Auto-reply logs
    const autoLogs = await this.prisma.aiAutoReplyLog.findMany({
      where: hasDateFilter ? { createdAt: dateFilter } : {},
      select: { autoSent: true, confidence: true },
    });

    const totalAuto = autoLogs.length;
    const autoSent = autoLogs.filter((l) => l.autoSent).length;
    const handoffs = totalAuto - autoSent;
    const avgConfidence = totalAuto > 0
      ? autoLogs.reduce((sum, l) => sum + l.confidence, 0) / totalAuto
      : 0;

    // Training feedback
    const feedbacks = await this.prisma.aiTrainingPair.findMany({
      where: {
        source: 'SUGGEST_FEEDBACK',
        ...(hasDateFilter ? { createdAt: dateFilter } : {}),
      },
      select: { type: true },
    });

    const totalFeedback = feedbacks.length;
    const accepts = feedbacks.filter((f) => f.type === 'ACCEPT').length;
    const edits = feedbacks.filter((f) => f.type === 'EDIT').length;
    const rejects = feedbacks.filter((f) => f.type === 'REJECT').length;

    // Training pairs total
    const totalPairs = await this.prisma.aiTrainingPair.count();
    const usablePairs = await this.prisma.aiTrainingPair.count({
      where: { quality: { gte: 0.7 } },
    });

    return {
      autoReplyRate: totalAuto > 0 ? (autoSent / totalAuto) * 100 : 0,
      handoffRate: totalAuto > 0 ? (handoffs / totalAuto) * 100 : 0,
      acceptRate: totalFeedback > 0 ? (accepts / totalFeedback) * 100 : 0,
      editRate: totalFeedback > 0 ? (edits / totalFeedback) * 100 : 0,
      rejectRate: totalFeedback > 0 ? (rejects / totalFeedback) * 100 : 0,
      avgConfidence: avgConfidence * 100,
      totalTrainingPairs: totalPairs,
      usableTrainingPairs: usablePairs,
    };
  }
}
```

- [ ] **Step 2: Add metrics endpoint**

```typescript
@Get('ai/metrics')
@Roles('OWNER')
async getAiMetrics(@Query('from') from?: string, @Query('to') to?: string) {
  return this.aiMetrics.getMetrics(
    from ? new Date(from) : undefined,
    to ? new Date(to) : undefined,
  );
}
```

- [ ] **Step 3: Register, type check, commit**

```bash
./tools/check-types.sh api
git commit -m "feat(api): add AiMetricsService — AI performance metrics"
```

---

## Task 10: Frontend — Feedback Tracking in AiSuggestPanel

**Files:**
- Modify: `apps/web/src/pages/UnifiedInboxPage/components/AiSuggestPanel.tsx`
- Modify: `apps/web/src/pages/UnifiedInboxPage/components/ChatPanel.tsx`

- [ ] **Step 1: Track selected suggestion in AiSuggestPanel**

Modify `onSelectSuggestion` callback to include metadata:

```typescript
interface AiSuggestPanelProps {
  sessionId: string;
  onSelectSuggestion: (text: string, metadata: { aiDraft: string; intent: string }) => void;
  lastMessageAt: number;
}
```

When suggestion is clicked: `onSelectSuggestion(suggestion.text, { aiDraft: suggestion.text, intent: suggestion.intent })`

- [ ] **Step 2: Track and send feedback in ChatPanel**

In ChatPanel:
1. Add state: `const [selectedSuggestion, setSelectedSuggestion] = useState<{ aiDraft: string; intent: string } | null>(null);`
2. Update `handleSelectSuggestion` to store metadata
3. In `handleSend`, after sending message, POST feedback:

```typescript
if (selectedSuggestion) {
  const type = inputText === selectedSuggestion.aiDraft ? 'ACCEPT' : 'EDIT';
  api.post('/staff-chat/ai/training-feedback', {
    sessionId: session.id,
    type,
    customerMessage: lastCustomerMessage, // last customer message text
    aiDraft: selectedSuggestion.aiDraft,
    humanEdit: type === 'EDIT' ? inputText : undefined,
    intent: selectedSuggestion.intent,
  }).catch(() => {}); // fire-and-forget
  setSelectedSuggestion(null);
}
```

4. Track REJECT: when staff sends a message WITHOUT selecting a suggestion (and suggestions were visible), send REJECT feedback.

- [ ] **Step 3: Type check**

```bash
./tools/check-types.sh web
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/UnifiedInboxPage/components/
git commit -m "feat(web): track AI suggestion accept/edit/reject feedback"
```

---

## Task 11: Frontend — AI Settings Page

**Files:**
- Create: `apps/web/src/pages/AiSettingsPage.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/config/menu.ts`

- [ ] **Step 1: Create AiSettingsPage**

OWNER-only settings page with:
- Toggle: AI Auto Mode (on/off)
- Channel checkboxes: LINE_FINANCE, LINE_SHOP, FACEBOOK, TIKTOK, WEB
- Confidence threshold slider (0-100%)
- Max replies per session number input

Use `useQuery` to GET `/staff-chat/ai/settings` and `useMutation` to PATCH `/staff-chat/ai/settings`.

- [ ] **Step 2: Add route in App.tsx**

```typescript
const AiSettingsPage = lazy(() => import('./pages/AiSettingsPage'));
// Add route:
<Route path="/settings/ai-chat" element={<ProtectedRoute roles={['OWNER']}><AiSettingsPage /></ProtectedRoute>} />
```

- [ ] **Step 3: Add to OWNER menu in config/menu.ts**

Add to OWNER "ตั้งค่า & ระบบ" section:
```typescript
{ label: 'AI Chat', path: '/settings/ai-chat', icon: Sparkles },
```

Import `Sparkles` from lucide-react.

- [ ] **Step 4: Type check, commit**

```bash
./tools/check-types.sh web
git commit -m "feat(web): add AI Chat settings page with auto mode configuration"
```

---

## Task 12: Frontend — AI Training Page

**Files:**
- Create: `apps/web/src/pages/AiTrainingPage.tsx`

- [ ] **Step 1: Create AiTrainingPage**

OWNER-only page with:
- Summary cards: total training pairs, usable pairs (quality >= 0.7), by source breakdown
- Chatcone import: file upload area (CSV/JSON) with preview + confirm
- System extract: last run time, ปุ่ม "Re-extract"
- Data from: GET `/staff-chat/ai/training-stats`
- Import via: POST `/staff-chat/ai/import` (multipart file)

- [ ] **Step 2: Add route + menu**

Route: `/settings/ai-training`
Menu: add to OWNER "ตั้งค่า & ระบบ" section

- [ ] **Step 3: Type check, commit**

```bash
./tools/check-types.sh web
git commit -m "feat(web): add AI Training Data page with Chatcone import"
```

---

## Task 13: Frontend — AI Performance Page

**Files:**
- Create: `apps/web/src/pages/AiPerformancePage.tsx`

- [ ] **Step 1: Create AiPerformancePage**

OWNER-only page with:
- Summary cards: auto-reply rate, accept rate, training pairs count
- Date range filter
- Data from: GET `/staff-chat/ai/metrics?from=&to=`

Keep it simple — cards only for now, charts can be added later.

- [ ] **Step 2: Add route + menu**

Route: `/settings/ai-performance`
Menu: add to OWNER "ตั้งค่า & ระบบ" section

- [ ] **Step 3: Type check, commit**

```bash
./tools/check-types.sh web
git commit -m "feat(web): add AI Performance dashboard"
```

---

## Task 14: Final Integration + Full Type Check

**Files:**
- Modify: `apps/api/src/modules/staff-chat/staff-chat.module.ts`
- Full type check

- [ ] **Step 1: Ensure all services registered**

Verify all new services are in module providers:
- AiAutoReplyService
- AiTrainingService
- AiImportService
- AiMetricsService
- TrainingExtractCron

- [ ] **Step 2: Full type check**

```bash
./tools/check-types.sh all
```

Expected: 0 errors API + Web.

- [ ] **Step 3: Final commit**

```bash
git commit -m "feat: Chat Sales Efficiency Phase 2 — AI auto mode, feedback loop, training import, performance dashboard"
```

---

## Verification

1. **TypeScript**: `./tools/check-types.sh all` — 0 errors
2. **AI Auto Mode**: Set `AI_AUTO_ENABLED=true` + `AI_AUTO_CONFIDENCE_THRESHOLD=80` in .env → customer message → AI replies automatically if confident
3. **Feedback tracking**: Login as SALES → Inbox → select suggestion → send (modified) → check AiTrainingPair record created
4. **Few-shot**: After saving feedback pairs → next AI suggest call should include examples in prompt
5. **Chatcone import**: Login as OWNER → /settings/ai-training → upload CSV → pairs created
6. **Training extract cron**: Manually trigger or wait for 3:00 AM → check pairs extracted
7. **Performance metrics**: Login as OWNER → /settings/ai-performance → see metrics
8. **Settings page**: Login as OWNER → /settings/ai-chat → toggle auto mode, adjust threshold
