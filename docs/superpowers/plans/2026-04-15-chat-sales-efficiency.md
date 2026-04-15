# Chat Sales Efficiency — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ช่วยพนักงานขายตอบแชทเร็วขึ้นและปิดการขายได้มากขึ้น ด้วย AI suggest, product context, ads attribution, และ lead priority scoring

**Architecture:** เพิ่ม 3 backend services (AI suggest, product detect, lead scoring) ที่ทำงานร่วมกับ Unified Inbox ที่มีอยู่ เพิ่ม attribution tracking ใน chat adapters + ปรับ frontend 4 จุด (suggest panel, product card, lead badges, ads dashboard)

**Tech Stack:** NestJS, Prisma, Claude API (Anthropic SDK), React, TanStack Query, WebSocket (Socket.io)

**Spec:** `docs/superpowers/specs/2026-04-15-chat-sales-efficiency-design.md`

---

## File Map

### New Files

| File | Responsibility |
|------|---------------|
| `apps/api/src/modules/staff-chat/services/ai-suggest.service.ts` | Build AI context from DB + call Claude → return 2-3 suggestions |
| `apps/api/src/modules/staff-chat/services/product-detect.service.ts` | Keyword-match products from chat messages → return product info |
| `apps/api/src/modules/staff-chat/services/lead-scoring.service.ts` | Score conversation 0-100 + assign HOT/WARM/COLD temperature |
| `apps/api/src/modules/staff-chat/dto/ai-suggest.dto.ts` | DTO for suggest endpoint request/response |
| `apps/web/src/pages/UnifiedInboxPage/components/AiSuggestPanel.tsx` | Suggestion cards UI below message input |
| `apps/web/src/pages/UnifiedInboxPage/components/ProductContextCard.tsx` | Product info card in Customer360 panel |
| `apps/api/prisma/migrations/XXXXXX_add_lead_score_and_chat_attribution/migration.sql` | DB migration |

### Files to Modify

| File | Change |
|------|--------|
| `apps/api/prisma/schema.prisma` | Add `leadScore`, `leadTemperature`, `attributionId` to ChatSession |
| `apps/api/src/modules/staff-chat/staff-chat.controller.ts` | Add `POST /sessions/:id/suggest` endpoint |
| `apps/api/src/modules/staff-chat/staff-chat.module.ts` | Register new services |
| `apps/api/src/modules/staff-chat/staff-chat.gateway.ts` | Emit suggestions after new message |
| `apps/api/src/modules/chat-engine/services/session-manager.service.ts` | Accept attribution params on session create |
| `apps/api/src/modules/chat-adapters/facebook-webhook.controller.ts` | Extract `ref` param for attribution |
| `apps/web/src/pages/UnifiedInboxPage/components/ChatPanel.tsx` | Add AiSuggestPanel below input |
| `apps/web/src/pages/UnifiedInboxPage/components/Customer360Panel.tsx` | Add ProductContextCard section |
| `apps/web/src/pages/UnifiedInboxPage/components/ConversationList.tsx` | Add lead score badge + sort by priority |
| `apps/web/src/pages/AdsTrackingPage.tsx` | Add cost per unit sold, conversion funnel |

---

## Task 1: Database Migration — leadScore + attribution link

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (ChatSession model ~line 2940, AdsAttribution model ~line 3353)
- Create: migration via `prisma migrate dev`

- [ ] **Step 1: Add fields to ChatSession model**

In `schema.prisma`, add these fields to the `ChatSession` model (after `handoffStaffId` field):

```prisma
  leadScore         Int?              @map("lead_score")
  leadTemperature   String?           @map("lead_temperature") // HOT, WARM, COLD
  attributionId     String?           @map("attribution_id")
  attribution       AdsAttribution?   @relation(fields: [attributionId], references: [id])
```

Add index: `@@index([leadScore])` to the existing indexes block.

- [ ] **Step 2: Add chatSessionId to AdsAttribution model**

In `schema.prisma`, add to `AdsAttribution` model:

```prisma
  chatSessions      ChatSession[]
```

- [ ] **Step 3: Run migration**

```bash
cd apps/api && npx prisma migrate dev --name add_lead_score_and_chat_attribution
```

- [ ] **Step 4: Verify migration**

```bash
cd apps/api && npx prisma generate
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations/
git commit -m "feat(api): add leadScore and attribution link to ChatSession"
```

---

## Task 2: Product Detection Service

**Files:**
- Create: `apps/api/src/modules/staff-chat/services/product-detect.service.ts`

- [ ] **Step 1: Create product-detect.service.ts**

```typescript
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

interface DetectedProduct {
  id: string;
  name: string;
  brand: string;
  model: string;
  price: number;
  stock: number;
  imageUrl: string | null;
  pricingOptions: {
    downPaymentMin: number;
    monthlyPayment: number;
    installments: number;
    interestRate: number;
  }[];
  activePromotions: {
    id: string;
    name: string;
    description: string;
  }[];
}

@Injectable()
export class ProductDetectService {
  constructor(private prisma: PrismaService) {}

  async detectProducts(messages: string[]): Promise<DetectedProduct[]> {
    // Extract keywords from recent messages
    const text = messages.join(' ').toLowerCase();

    // Search products by name/brand/model matching
    const products = await this.prisma.product.findMany({
      where: {
        deletedAt: null,
        OR: [
          { name: { contains: text, mode: 'insensitive' } },
        ],
      },
      take: 3,
      include: {
        branch: true,
      },
    });

    // If full-text match finds nothing, try keyword search
    if (products.length === 0) {
      const keywords = this.extractKeywords(text);
      if (keywords.length === 0) return [];

      const keywordProducts = await this.prisma.product.findMany({
        where: {
          deletedAt: null,
          OR: keywords.map((kw) => ({
            OR: [
              { name: { contains: kw, mode: 'insensitive' } },
              { brand: { contains: kw, mode: 'insensitive' } },
              { model: { contains: kw, mode: 'insensitive' } },
            ],
          })),
        },
        take: 3,
        include: { branch: true },
      });

      return this.enrichProducts(keywordProducts);
    }

    return this.enrichProducts(products);
  }

  private extractKeywords(text: string): string[] {
    // Common phone brand/model patterns
    const patterns = [
      /iphone\s*\d{1,2}\s*(pro\s*max|pro|plus|mini)?/gi,
      /samsung\s*(galaxy\s*)?(s|a|z|m)\s*\d{1,2}\s*(ultra|plus|\+|fe)?/gi,
      /oppo\s*(reno|find|a)\s*\d{1,2}\s*(pro|plus|\+)?/gi,
      /vivo\s*(v|y|x|t)\s*\d{1,2}\s*(pro|plus|\+)?/gi,
      /xiaomi\s*(redmi|poco|mi)?\s*\d{1,2}\s*(pro|ultra|note)?/gi,
      /realme\s*(gt|c|narzo)?\s*\d{1,2}\s*(pro|plus|\+)?/gi,
      /huawei\s*(nova|p|mate)?\s*\d{1,2}\s*(pro|lite)?/gi,
    ];

    const matches: string[] = [];
    for (const pattern of patterns) {
      const found = text.match(pattern);
      if (found) matches.push(...found.map((m) => m.trim()));
    }
    return [...new Set(matches)];
  }

  private async enrichProducts(products: any[]): Promise<DetectedProduct[]> {
    const result: DetectedProduct[] = [];

    for (const product of products) {
      // Get pricing templates
      const pricingTemplates = await this.prisma.pricingTemplate.findMany({
        where: { deletedAt: null, isActive: true },
        take: 3,
        orderBy: { installments: 'asc' },
      });

      // Get active promotions for this product
      const now = new Date();
      const promotions = await this.prisma.promotion.findMany({
        where: {
          deletedAt: null,
          isActive: true,
          startDate: { lte: now },
          endDate: { gte: now },
        },
        take: 3,
      });

      result.push({
        id: product.id,
        name: product.name,
        brand: product.brand ?? '',
        model: product.model ?? '',
        price: Number(product.sellingPrice ?? product.price ?? 0),
        stock: product.quantity ?? 0,
        imageUrl: product.imageUrl ?? null,
        pricingOptions: pricingTemplates.map((pt) => ({
          downPaymentMin: Number(pt.downPaymentPercent ?? 30),
          monthlyPayment: Math.ceil(
            (Number(product.sellingPrice ?? product.price ?? 0) *
              (1 - Number(pt.downPaymentPercent ?? 30) / 100) *
              (1 + Number(pt.interestRate ?? 0) / 100)) /
              Number(pt.installments ?? 1),
          ),
          installments: pt.installments ?? 6,
          interestRate: Number(pt.interestRate ?? 0),
        })),
        activePromotions: promotions.map((p) => ({
          id: p.id,
          name: p.name,
          description: p.description ?? '',
        })),
      });
    }

    return result;
  }
}
```

- [ ] **Step 2: Type check**

```bash
./tools/check-types.sh api
```

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/modules/staff-chat/services/product-detect.service.ts
git commit -m "feat(api): add ProductDetectService for chat product keyword matching"
```

---

## Task 3: AI Suggest Service

**Files:**
- Create: `apps/api/src/modules/staff-chat/services/ai-suggest.service.ts`
- Create: `apps/api/src/modules/staff-chat/dto/ai-suggest.dto.ts`

- [ ] **Step 1: Create DTO**

```typescript
// apps/api/src/modules/staff-chat/dto/ai-suggest.dto.ts
import { IsOptional, IsString } from 'class-validator';

export class AiSuggestRequestDto {
  @IsOptional()
  @IsString()
  currentDraft?: string;
}

export interface AiSuggestion {
  text: string;
  intent: string; // e.g. 'answer_price', 'close_sale', 'ask_preference'
  confidence: number; // 0-1
}

export interface AiSuggestResponse {
  suggestions: AiSuggestion[];
  detectedProducts: string[];
  processingTimeMs: number;
}
```

- [ ] **Step 2: Create ai-suggest.service.ts**

```typescript
// apps/api/src/modules/staff-chat/services/ai-suggest.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { PrismaService } from '../../../prisma/prisma.service';
import { ProductDetectService } from './product-detect.service';
import type { AiSuggestion, AiSuggestResponse } from '../dto/ai-suggest.dto';

@Injectable()
export class AiSuggestService {
  private readonly logger = new Logger(AiSuggestService.name);
  private anthropic: Anthropic | null = null;
  private readonly MODEL = 'claude-haiku-4-5-20251001';

  constructor(
    private config: ConfigService,
    private prisma: PrismaService,
    private productDetect: ProductDetectService,
  ) {
    const apiKey = this.config.get<string>('ANTHROPIC_API_KEY');
    if (apiKey) {
      this.anthropic = new Anthropic({ apiKey });
    } else {
      this.logger.warn('ANTHROPIC_API_KEY not set — AI suggest disabled');
    }
  }

  async suggest(sessionId: string, currentDraft?: string): Promise<AiSuggestResponse> {
    const start = Date.now();

    if (!this.anthropic) {
      return { suggestions: [], detectedProducts: [], processingTimeMs: 0 };
    }

    // 1. Fetch conversation context
    const messages = await this.prisma.chatMessage.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'desc' },
      take: 20,
      include: { staff: { select: { name: true } } },
    });

    if (messages.length === 0) {
      return { suggestions: [], detectedProducts: [], processingTimeMs: Date.now() - start };
    }

    const reversed = [...messages].reverse();

    // 2. Detect products from conversation
    const messageTexts = reversed
      .filter((m) => m.content)
      .map((m) => m.content!);
    const products = await this.productDetect.detectProducts(messageTexts);

    // 3. Fetch customer info
    const session = await this.prisma.chatSession.findUnique({
      where: { id: sessionId },
      include: {
        customer: {
          include: {
            contracts: {
              where: { deletedAt: null },
              take: 3,
              orderBy: { createdAt: 'desc' },
            },
          },
        },
      },
    });

    // 4. Fetch active promotions
    const now = new Date();
    const promotions = await this.prisma.promotion.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        startDate: { lte: now },
        endDate: { gte: now },
      },
      take: 5,
    });

    // 5. Build prompt context
    const conversationText = reversed
      .map((m) => {
        const role = m.role === 'STAFF' ? `พนักงาน${m.staff?.name ? ` (${m.staff.name})` : ''}` : m.role === 'CUSTOMER' ? 'ลูกค้า' : 'ระบบ';
        return `${role}: ${m.content ?? '[ไฟล์/รูปภาพ]'}`;
      })
      .join('\n');

    const productContext = products.length > 0
      ? products.map((p) => {
          const pricing = p.pricingOptions.length > 0
            ? p.pricingOptions.map((o) => `ผ่อน ${o.installments} งวด งวดละ ${o.monthlyPayment.toLocaleString()} บาท (ดาวน์ ${o.downPaymentMin}%)`).join(', ')
            : 'ไม่มีข้อมูลผ่อน';
          const promos = p.activePromotions.length > 0
            ? p.activePromotions.map((pr) => pr.name).join(', ')
            : 'ไม่มีโปรโมชัน';
          return `- ${p.name} | ราคา ${p.price.toLocaleString()} บาท | สต็อก ${p.stock} เครื่อง | ${pricing} | โปร: ${promos}`;
        }).join('\n')
      : 'ไม่พบสินค้าที่เกี่ยวข้อง';

    const customerContext = session?.customer
      ? `ลูกค้า: ${session.customer.firstName} ${session.customer.lastName ?? ''} | สัญญาที่มี: ${session.customer.contracts.length} สัญญา`
      : 'ลูกค้าใหม่ (ยังไม่ระบุตัวตน)';

    const promoContext = promotions.length > 0
      ? promotions.map((p) => `- ${p.name}: ${p.description ?? ''}`).join('\n')
      : 'ไม่มีโปรโมชันที่ active';

    const systemPrompt = `คุณเป็น AI ช่วยพนักงานขายร้านมือถือ BESTCHOICE ตอบแชทลูกค้า
คุณต้องแนะนำข้อความตอบลูกค้าให้พนักงานเลือก (2-3 ข้อความ)

กฎ:
- ข้อความต้องสุภาพ เป็นมิตร ใช้ครับ/ค่ะ
- ใส่ข้อมูลราคา/ผ่อน/โปรโมชัน ถ้าเกี่ยวข้อง
- พยายามปิดการขาย (ถามว่าสนใจไหม, อยากดูเงื่อนไขไหม, จะจองไหม)
- ข้อความสั้นกระชับ ไม่เกิน 3 บรรทัด
- ตอบเป็นภาษาไทย

ตอบเป็น JSON array เท่านั้น:
[{"text":"ข้อความ","intent":"answer_price","confidence":0.9}]

intent ที่ใช้ได้: answer_price, answer_spec, answer_stock, answer_promotion, close_sale, ask_preference, greet, follow_up`;

    const userMessage = `## ข้อมูลลูกค้า
${customerContext}

## สินค้าที่เกี่ยวข้อง
${productContext}

## โปรโมชันที่ active
${promoContext}

## บทสนทนา
${conversationText}

${currentDraft ? `## ข้อความที่พนักงานกำลังพิมพ์\n${currentDraft}` : ''}

แนะนำข้อความตอบ 2-3 ข้อความ:`;

    try {
      const response = await this.anthropic.messages.create({
        model: this.MODEL,
        max_tokens: 1024,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      });

      const content = response.content[0];
      if (content.type !== 'text') {
        return { suggestions: [], detectedProducts: products.map((p) => p.name), processingTimeMs: Date.now() - start };
      }

      // Parse JSON from response
      const jsonMatch = content.text.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        return { suggestions: [], detectedProducts: products.map((p) => p.name), processingTimeMs: Date.now() - start };
      }

      const suggestions: AiSuggestion[] = JSON.parse(jsonMatch[0]);

      return {
        suggestions: suggestions.slice(0, 3),
        detectedProducts: products.map((p) => p.name),
        processingTimeMs: Date.now() - start,
      };
    } catch (error) {
      this.logger.error('AI suggest failed', error);
      return { suggestions: [], detectedProducts: products.map((p) => p.name), processingTimeMs: Date.now() - start };
    }
  }
}
```

- [ ] **Step 3: Type check**

```bash
./tools/check-types.sh api
```

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/staff-chat/services/ai-suggest.service.ts apps/api/src/modules/staff-chat/dto/ai-suggest.dto.ts
git commit -m "feat(api): add AiSuggestService — AI-powered reply suggestions for staff chat"
```

---

## Task 4: Lead Scoring Service

**Files:**
- Create: `apps/api/src/modules/staff-chat/services/lead-scoring.service.ts`

- [ ] **Step 1: Create lead-scoring.service.ts**

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

interface LeadScoreResult {
  score: number;           // 0-100
  temperature: string;     // HOT, WARM, COLD
  signals: string[];       // reasons for score
}

@Injectable()
export class LeadScoringService {
  private readonly logger = new Logger(LeadScoringService.name);

  constructor(private prisma: PrismaService) {}

  async scoreSession(sessionId: string): Promise<LeadScoreResult> {
    const messages = await this.prisma.chatMessage.findMany({
      where: { sessionId, role: 'CUSTOMER' },
      orderBy: { createdAt: 'desc' },
      take: 30,
    });

    if (messages.length === 0) {
      return { score: 0, temperature: 'COLD', signals: [] };
    }

    const text = messages.map((m) => m.content ?? '').join(' ').toLowerCase();
    let score = 0;
    const signals: string[] = [];

    // Price/installment inquiry (+30)
    if (/ราคา|เท่าไ[ห]?ร่|ผ่อน|งวด|ดาวน์|เงินดาวน์|ค่างวด/.test(text)) {
      score += 30;
      signals.push('ถามราคา/ผ่อน');
    }

    // Specific model mention (+20)
    if (/iphone\s*\d|samsung\s*(galaxy\s*)?(s|a|z)\s*\d|oppo|vivo|xiaomi|realme/i.test(text)) {
      score += 20;
      signals.push('ระบุรุ่นชัดเจน');
    }

    // Stock/color inquiry (+15)
    if (/สต็อก|มีไหม|สี|มีสี|เหลือ|ยังมี|กี่เครื่อง/.test(text)) {
      score += 15;
      signals.push('ถามสต็อก/สี');
    }

    // Returning customer (+15)
    const session = await this.prisma.chatSession.findUnique({
      where: { id: sessionId },
      include: { customer: { include: { contracts: { where: { deletedAt: null } } } } },
    });
    if (session?.customer?.contracts && session.customer.contracts.length > 0) {
      score += 15;
      signals.push('ลูกค้าเก่า (มีสัญญา)');
    }

    // Location/time inquiry (+10)
    if (/สาขา|ที่ไหน|เปิด|ปิด|กี่โมง|แผนที่|ที่อยู่/.test(text)) {
      score += 10;
      signals.push('ถามสาขา/เวลา');
    }

    // Multiple messages (+5 per message, max +15)
    const msgBonus = Math.min(messages.length * 5, 15);
    if (messages.length > 1) {
      score += msgBonus;
      signals.push(`สนทนาต่อเนื่อง (${messages.length} ข้อความ)`);
    }

    // Single message penalty (-10)
    if (messages.length === 1) {
      score -= 10;
      signals.push('ส่งข้อความเดียว');
    }

    // Clamp 0-100
    score = Math.max(0, Math.min(100, score));

    const temperature = score >= 80 ? 'HOT' : score >= 50 ? 'WARM' : 'COLD';

    // Update DB
    await this.prisma.chatSession.update({
      where: { id: sessionId },
      data: { leadScore: score, leadTemperature: temperature },
    });

    return { score, temperature, signals };
  }
}
```

- [ ] **Step 2: Type check**

```bash
./tools/check-types.sh api
```

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/modules/staff-chat/services/lead-scoring.service.ts
git commit -m "feat(api): add LeadScoringService — conversation-based lead priority"
```

---

## Task 5: Register Services + API Endpoint + WebSocket

**Files:**
- Modify: `apps/api/src/modules/staff-chat/staff-chat.module.ts`
- Modify: `apps/api/src/modules/staff-chat/staff-chat.controller.ts` (~line 237)
- Modify: `apps/api/src/modules/staff-chat/staff-chat.gateway.ts` (~line 177)

- [ ] **Step 1: Register new services in module**

Add to providers array in `staff-chat.module.ts`:

```typescript
import { AiSuggestService } from './services/ai-suggest.service';
import { ProductDetectService } from './services/product-detect.service';
import { LeadScoringService } from './services/lead-scoring.service';
```

Add `AiSuggestService`, `ProductDetectService`, `LeadScoringService` to the `providers` array.

- [ ] **Step 2: Add suggest endpoint to controller**

In `staff-chat.controller.ts`, add after the AI Assistant section (~line 237):

```typescript
import { AiSuggestService } from './services/ai-suggest.service';
import { LeadScoringService } from './services/lead-scoring.service';
import { ProductDetectService } from './services/product-detect.service';
import { AiSuggestRequestDto } from './dto/ai-suggest.dto';
```

Add constructor params: `private aiSuggest: AiSuggestService`, `private leadScoring: LeadScoringService`, `private productDetect: ProductDetectService`.

Add endpoints:

```typescript
  @Post('sessions/:id/suggest')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES')
  async getSuggestions(@Param('id') id: string, @Body() dto: AiSuggestRequestDto) {
    return this.aiSuggest.suggest(id, dto.currentDraft);
  }

  @Get('sessions/:id/products')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES')
  async getDetectedProducts(@Param('id') id: string) {
    const messages = await this.sessionManager.getRecentMessages(id, 20);
    const texts = messages.map((m: any) => m.content ?? '').filter(Boolean);
    return this.productDetect.detectProducts(texts);
  }

  @Get('sessions/:id/lead-score')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES')
  async getLeadScore(@Param('id') id: string) {
    return this.leadScoring.scoreSession(id);
  }
```

- [ ] **Step 3: Add auto-scoring in WebSocket gateway**

In `staff-chat.gateway.ts`, inside `handleSendMessage` method (after message is saved, ~line 177), add lead scoring trigger:

```typescript
import { LeadScoringService } from './services/lead-scoring.service';
```

Add constructor param: `private leadScoring: LeadScoringService`.

After message send completes, add:

```typescript
    // Auto-update lead score after customer message
    if (data.text) {
      this.leadScoring.scoreSession(data.sessionId).catch((err) =>
        this.logger.error('Lead scoring failed', err),
      );
    }
```

- [ ] **Step 4: Type check**

```bash
./tools/check-types.sh api
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/staff-chat/
git commit -m "feat(api): wire AI suggest, product detect, lead scoring to controller + gateway"
```

---

## Task 6: AI Suggest Panel (Frontend)

**Files:**
- Create: `apps/web/src/pages/UnifiedInboxPage/components/AiSuggestPanel.tsx`
- Modify: `apps/web/src/pages/UnifiedInboxPage/components/ChatPanel.tsx`

- [ ] **Step 1: Create AiSuggestPanel component**

```typescript
// apps/web/src/pages/UnifiedInboxPage/components/AiSuggestPanel.tsx
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Sparkles, X, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AiSuggestResponse } from './types';

interface AiSuggestPanelProps {
  sessionId: string;
  onSelectSuggestion: (text: string) => void;
  lastMessageAt: number; // trigger re-fetch
}

export default function AiSuggestPanel({ sessionId, onSelectSuggestion, lastMessageAt }: AiSuggestPanelProps) {
  const { data, isLoading, isError } = useQuery<AiSuggestResponse>({
    queryKey: ['ai-suggest', sessionId, lastMessageAt],
    queryFn: () => api.post(`/staff-chat/sessions/${sessionId}/suggest`, {}).then((r) => r.data),
    enabled: !!sessionId,
    staleTime: 30_000,
    retry: false,
  });

  if (isError || (!isLoading && (!data || data.suggestions.length === 0))) {
    return null;
  }

  return (
    <div className="border-t border-border/50 bg-muted/30 px-4 py-2.5">
      <div className="flex items-center gap-1.5 mb-2">
        <Sparkles className="size-3.5 text-primary" />
        <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
          AI แนะนำ
        </span>
        {isLoading && <Loader2 className="size-3 animate-spin text-muted-foreground" />}
      </div>

      {isLoading ? (
        <div className="flex gap-2">
          {[1, 2].map((i) => (
            <div key={i} className="flex-1 h-16 rounded-lg bg-muted animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {data?.suggestions.map((suggestion, i) => (
            <button
              key={i}
              onClick={() => onSelectSuggestion(suggestion.text)}
              className={cn(
                'flex-1 min-w-[200px] max-w-[300px] text-left px-3 py-2 rounded-lg border transition-all duration-150',
                'text-[12px] leading-relaxed text-foreground/80',
                'border-border/60 bg-background hover:border-primary/40 hover:bg-primary/5',
                'active:scale-[0.98]',
              )}
            >
              <p className="line-clamp-3">{suggestion.text}</p>
              <span className="text-[10px] text-muted-foreground/60 mt-1 block">
                {suggestion.intent === 'answer_price' && '💰 ตอบราคา'}
                {suggestion.intent === 'close_sale' && '🎯 ปิดการขาย'}
                {suggestion.intent === 'answer_spec' && '📱 ตอบสเปค'}
                {suggestion.intent === 'answer_stock' && '📦 ตอบสต็อก'}
                {suggestion.intent === 'answer_promotion' && '🎁 แนะนำโปร'}
                {suggestion.intent === 'ask_preference' && '❓ ถามความต้องการ'}
                {suggestion.intent === 'greet' && '👋 ทักทาย'}
                {suggestion.intent === 'follow_up' && '📞 ติดตาม'}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add types file (if not exists)**

Create or add to `apps/web/src/pages/UnifiedInboxPage/components/types.ts`:

```typescript
export interface AiSuggestion {
  text: string;
  intent: string;
  confidence: number;
}

export interface AiSuggestResponse {
  suggestions: AiSuggestion[];
  detectedProducts: string[];
  processingTimeMs: number;
}
```

- [ ] **Step 3: Integrate into ChatPanel**

In `ChatPanel.tsx`, add import and render `AiSuggestPanel` above the input section (before the textarea area, ~line 153):

```typescript
import AiSuggestPanel from './AiSuggestPanel';
```

Add state for tracking last message time:

```typescript
const lastMessageAt = messages.length > 0 ? messages[messages.length - 1]?.createdAt ?? 0 : 0;
```

Add handler:

```typescript
const handleSelectSuggestion = (text: string) => {
  setInputText(text);
  inputRef.current?.focus();
};
```

Render before input section (inside the non-resolved condition):

```tsx
{session && !isResolved && (
  <>
    <AiSuggestPanel
      sessionId={session.id}
      onSelectSuggestion={handleSelectSuggestion}
      lastMessageAt={lastMessageAt}
    />
    {/* existing input section */}
  </>
)}
```

- [ ] **Step 4: Type check**

```bash
./tools/check-types.sh web
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/UnifiedInboxPage/components/
git commit -m "feat(web): add AI suggestion panel in Unified Inbox chat"
```

---

## Task 7: Product Context Card (Frontend)

**Files:**
- Create: `apps/web/src/pages/UnifiedInboxPage/components/ProductContextCard.tsx`
- Modify: `apps/web/src/pages/UnifiedInboxPage/components/Customer360Panel.tsx`

- [ ] **Step 1: Create ProductContextCard**

```typescript
// apps/web/src/pages/UnifiedInboxPage/components/ProductContextCard.tsx
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Smartphone, Package, Tag, BadgePercent } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

interface ProductContextCardProps {
  sessionId: string;
}

export default function ProductContextCard({ sessionId }: ProductContextCardProps) {
  const { data: products, isLoading } = useQuery<any[]>({
    queryKey: ['chat-products', sessionId],
    queryFn: () => api.get(`/staff-chat/sessions/${sessionId}/products`).then((r) => r.data),
    enabled: !!sessionId,
    staleTime: 60_000,
  });

  if (isLoading || !products || products.length === 0) return null;

  return (
    <div className="border-t border-gray-200 pt-3">
      <div className="flex items-center gap-2 mb-2 px-4">
        <Smartphone className="size-3.5 text-primary opacity-60" />
        <span className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground/60">
          สินค้าที่กำลังคุย
        </span>
      </div>

      <div className="space-y-2 px-4">
        {products.map((product: any) => (
          <div key={product.id} className="bg-muted/40 rounded-lg p-3 text-[12px]">
            <div className="flex items-start justify-between">
              <div>
                <p className="font-semibold text-[13px]">{product.name}</p>
                <p className="text-muted-foreground">{product.brand} {product.model}</p>
              </div>
              <Badge variant={product.stock > 0 ? 'default' : 'destructive'} className="text-[10px]">
                {product.stock > 0 ? `${product.stock} เครื่อง` : 'หมด'}
              </Badge>
            </div>

            <p className="text-primary font-bold mt-1.5">
              ฿{product.price.toLocaleString()}
            </p>

            {product.pricingOptions.length > 0 && (
              <div className="mt-1.5 space-y-0.5">
                {product.pricingOptions.slice(0, 2).map((opt: any, i: number) => (
                  <p key={i} className="text-muted-foreground flex items-center gap-1">
                    <Tag className="size-3 opacity-40" />
                    ผ่อน {opt.installments} งวด {opt.monthlyPayment.toLocaleString()} บ./ด. (ดาวน์ {opt.downPaymentMin}%)
                  </p>
                ))}
              </div>
            )}

            {product.activePromotions.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {product.activePromotions.map((promo: any) => (
                  <Badge key={promo.id} variant="secondary" className="text-[10px]">
                    <BadgePercent className="size-2.5 mr-0.5" />
                    {promo.name}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add to Customer360Panel**

In `Customer360Panel.tsx`, import and render after the customer profile section (~line 150):

```typescript
import ProductContextCard from './ProductContextCard';
```

Add render (after customer profile, before contracts section):

```tsx
{activeSessionId && <ProductContextCard sessionId={activeSessionId} />}
```

- [ ] **Step 3: Type check**

```bash
./tools/check-types.sh web
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/UnifiedInboxPage/components/
git commit -m "feat(web): add product context card in Customer360 chat panel"
```

---

## Task 8: Lead Priority Badge + Sort (Frontend)

**Files:**
- Modify: `apps/web/src/pages/UnifiedInboxPage/components/ConversationList.tsx`
- Modify: `apps/web/src/pages/UnifiedInboxPage/components/ConversationItem.tsx` (if exists)

- [ ] **Step 1: Add lead score badge to ConversationItem**

Find `ConversationItem` component (likely in same directory). Add badge display:

```typescript
// Add to ConversationItem render, next to the customer name or timestamp
{session.leadTemperature === 'HOT' && (
  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold bg-red-500/15 text-red-600">
    🔥 HOT
  </span>
)}
{session.leadTemperature === 'WARM' && (
  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-500/15 text-amber-600">
    WARM
  </span>
)}
```

- [ ] **Step 2: Add sort toggle to ConversationList**

In `ConversationList.tsx`, add sort state and toggle:

```typescript
const [sortBy, setSortBy] = useState<'time' | 'priority'>('time');
```

Add sort button in filter area:

```typescript
<button
  onClick={() => setSortBy(sortBy === 'time' ? 'priority' : 'time')}
  className={cn(
    'text-[11px] px-2 py-1 rounded-md border transition-colors',
    sortBy === 'priority'
      ? 'bg-primary/10 text-primary border-primary/30'
      : 'text-muted-foreground border-border/50 hover:bg-muted/50',
  )}
>
  {sortBy === 'priority' ? '🔥 Priority' : '🕐 เวลา'}
</button>
```

Sort sessions before rendering:

```typescript
const sortedSessions = useMemo(() => {
  if (sortBy === 'priority') {
    return [...sessions].sort((a, b) => (b.leadScore ?? 0) - (a.leadScore ?? 0));
  }
  return sessions; // default: sorted by time from API
}, [sessions, sortBy]);
```

- [ ] **Step 3: Type check**

```bash
./tools/check-types.sh web
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/UnifiedInboxPage/components/
git commit -m "feat(web): add lead priority badges and sort in conversation list"
```

---

## Task 9: Ads Attribution from Chat

**Files:**
- Modify: `apps/api/src/modules/chat-adapters/facebook-webhook.controller.ts`
- Modify: `apps/api/src/modules/chat-engine/services/session-manager.service.ts`

- [ ] **Step 1: Extract referral data in Facebook webhook**

In `facebook-webhook.controller.ts`, inside message processing (~line 117), extract Facebook referral data:

```typescript
// After extracting sender.id, check for referral
const referral = messagingEvent.referral || messagingEvent.postback?.referral;
const attributionData = referral
  ? {
      utmSource: 'facebook',
      utmCampaign: referral.ad_id ?? referral.ref ?? undefined,
      utmContent: referral.ref ?? undefined,
      referrerUrl: referral.source ?? undefined,
    }
  : undefined;
```

Pass `attributionData` when routing the message to `messageRouter`.

- [ ] **Step 2: Accept attribution in session creation**

In `session-manager.service.ts`, extend `getOrCreateSession` params:

```typescript
async getOrCreateSession(params: {
  externalUserId: string;
  channel: ChatChannel;
  customerId?: string;
  attribution?: {
    utmSource?: string;
    utmCampaign?: string;
    utmContent?: string;
    referrerUrl?: string;
  };
}): Promise<ChatSession>
```

When creating a new session, if `attribution` is provided, create an `AdsAttribution` record and link it:

```typescript
if (params.attribution && params.attribution.utmSource) {
  // Find or create campaign
  let campaign = await this.prisma.adsCampaign.findFirst({
    where: { campaignId: params.attribution.utmCampaign ?? 'organic', deletedAt: null },
  });
  if (!campaign) {
    campaign = await this.prisma.adsCampaign.create({
      data: {
        platform: params.attribution.utmSource === 'facebook' ? 'FACEBOOK_ADS' : 'TIKTOK_ADS',
        campaignId: params.attribution.utmCampaign ?? 'unknown',
        campaignName: params.attribution.utmCampaign ?? 'Auto-detected',
      },
    });
  }

  const attribution = await this.prisma.adsAttribution.create({
    data: {
      campaignId: campaign.id,
      utmSource: params.attribution.utmSource,
      utmCampaign: params.attribution.utmCampaign,
      utmContent: params.attribution.utmContent,
      referrerUrl: params.attribution.referrerUrl,
      firstTouch: new Date(),
    },
  });

  // Link to session
  await this.prisma.chatSession.update({
    where: { id: session.id },
    data: { attributionId: attribution.id },
  });
}
```

- [ ] **Step 3: Type check**

```bash
./tools/check-types.sh api
```

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/chat-adapters/ apps/api/src/modules/chat-engine/
git commit -m "feat(api): extract Facebook referral data for ads attribution in chat"
```

---

## Task 10: Ads Dashboard Enhancement (Frontend)

**Files:**
- Modify: `apps/web/src/pages/AdsTrackingPage.tsx`

- [ ] **Step 1: Add cost per unit sold**

In `AdsTrackingPage.tsx`, add a new summary card after existing cards:

```typescript
// Calculate cost per unit
const totalConversions = roiData?.reduce((sum: number, r: any) => sum + (r.conversions ?? 0), 0) ?? 0;
const totalSpend = roiData?.reduce((sum: number, r: any) => sum + Number(r.spend ?? 0), 0) ?? 0;
const costPerUnit = totalConversions > 0 ? totalSpend / totalConversions : 0;
```

Add card:

```tsx
<Card>
  <CardHeader className="pb-2">
    <CardTitle className="text-[13px] text-muted-foreground font-medium">Cost per Unit Sold</CardTitle>
  </CardHeader>
  <CardContent>
    <p className="text-2xl font-bold">฿{costPerUnit.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
    <p className="text-[11px] text-muted-foreground">ค่าโฆษณาต่อการขาย 1 เครื่อง</p>
  </CardContent>
</Card>
```

- [ ] **Step 2: Add per-campaign cost per unit in table**

Add column to ROI table:

```tsx
<th>Cost/Unit</th>
// In row:
<td>฿{r.conversions > 0 ? (Number(r.spend) / r.conversions).toLocaleString(undefined, { maximumFractionDigits: 0 }) : '-'}</td>
```

- [ ] **Step 3: Type check**

```bash
./tools/check-types.sh web
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/AdsTrackingPage.tsx
git commit -m "feat(web): add cost per unit sold to Ads dashboard"
```

---

## Task 11: Final Integration + Settings Toggle

**Files:**
- Modify: `apps/api/src/modules/staff-chat/staff-chat.controller.ts`
- Verify all type checks pass

- [ ] **Step 1: Add AI suggest setting check**

In the `getSuggestions` endpoint, check if AI suggest is enabled before processing. For Phase 1, use env var `AI_SUGGEST_ENABLED=true`:

```typescript
@Post('sessions/:id/suggest')
@Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES')
async getSuggestions(@Param('id') id: string, @Body() dto: AiSuggestRequestDto) {
  const enabled = this.config.get<string>('AI_SUGGEST_ENABLED') === 'true';
  if (!enabled) {
    return { suggestions: [], detectedProducts: [], processingTimeMs: 0 };
  }
  return this.aiSuggest.suggest(id, dto.currentDraft);
}
```

Add `ConfigService` to controller constructor if not already there.

- [ ] **Step 2: Full type check**

```bash
./tools/check-types.sh all
```

Expected: 0 errors.

- [ ] **Step 3: Final commit**

```bash
git add .
git commit -m "feat: Chat Sales Efficiency Phase 1 — AI suggest, product context, lead scoring, ads attribution"
```

---

## Verification

1. **TypeScript**: `./tools/check-types.sh all` — 0 errors
2. **AI Suggest**: Login as SALES → open Inbox → select chat → see suggestion panel (needs `AI_SUGGEST_ENABLED=true` + `ANTHROPIC_API_KEY` in .env)
3. **Product Context**: Chat about "iPhone 16" → see product card in right panel
4. **Lead Scoring**: Customer messages about price → see HOT/WARM badge on conversation list
5. **Lead Sort**: Click priority toggle → conversations sort by lead score
6. **Ads Attribution**: Facebook referral message → creates AdsAttribution record linked to session
7. **Ads Dashboard**: Open `/ads` → see "Cost per Unit Sold" card
