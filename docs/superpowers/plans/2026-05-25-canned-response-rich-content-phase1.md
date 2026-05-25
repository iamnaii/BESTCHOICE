# Canned Response Rich Content — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development

**Goal:** Multi-bubble per template (TEXT/IMAGE/STICKER, max 5), channel-agnostic. Replace single-`content` model with `CannedResponseBubble[]`.

**Spec:** [`docs/superpowers/specs/2026-05-25-canned-response-rich-content-design.md`](../specs/2026-05-25-canned-response-rich-content-design.md)

**Tech Stack:** Prisma migration / NestJS / React + @dnd-kit / vitest + jest

---

## Task P1.1: Schema migration — CannedResponseBubble table

**Files:**
- `apps/api/prisma/schema.prisma`
- `apps/api/prisma/migrations/<timestamp>_add_canned_response_bubbles/migration.sql`

- [ ] **Step 1:** Add to `schema.prisma` (after existing `CannedResponse` model):

```prisma
enum BubbleType {
  TEXT
  IMAGE
  STICKER
}

model CannedResponseBubble {
  id                String     @id @default(uuid())
  cannedResponseId  String     @map("canned_response_id")
  type              BubbleType
  sortOrder         Int        @default(0)
  text              String?    @db.Text
  mediaUrl          String?
  thumbnailUrl      String?
  stickerPackageId  String?
  stickerId         String?
  createdAt         DateTime   @default(now())
  updatedAt         DateTime   @updatedAt
  deletedAt         DateTime?

  cannedResponse    CannedResponse @relation(fields: [cannedResponseId], references: [id], onDelete: Cascade)

  @@index([cannedResponseId, sortOrder])
  @@map("canned_response_bubbles")
}
```

Update existing `CannedResponse` model — add the relation:
```prisma
model CannedResponse {
  // ... existing fields ...
  bubbles  CannedResponseBubble[]
}
```

- [ ] **Step 2:** Generate migration

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE/apps/api
npx prisma migrate dev --name add_canned_response_bubbles --create-only
```

Inspect the generated SQL — should be a CREATE TABLE + CREATE INDEX. If prisma can't connect to local DB, write the SQL manually in the migrations dir.

- [ ] **Step 3:** Apply migration

```bash
set -a && source .env && set +a && npx prisma migrate dev
```

- [ ] **Step 4:** Regenerate Prisma client + TS check

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE && ./tools/check-types.sh api
```

- [ ] **Step 5:** Commit

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations/
git commit -m "feat(canned-response): add CannedResponseBubble table (Phase 1)"
```

---

## Task P1.2: Backfill migration — content → first TEXT bubble

**Files:** `apps/api/src/cli/migrate-canned-response-content-to-bubbles.cli.ts` (NEW)

- [ ] **Step 1:** Create CLI script:

```typescript
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const templates = await prisma.cannedResponse.findMany({
    where: { deletedAt: null, content: { not: null } },
    include: { bubbles: true },
  });
  let created = 0;
  let skipped = 0;
  for (const t of templates) {
    if (t.bubbles.length > 0) {
      skipped++;
      continue;
    }
    if (!t.content) continue;
    await prisma.cannedResponseBubble.create({
      data: {
        cannedResponseId: t.id,
        type: 'TEXT',
        text: t.content,
        sortOrder: 0,
      },
    });
    created++;
  }
  console.log(`Backfill complete: ${created} bubbles created, ${skipped} templates skipped (already had bubbles)`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
```

- [ ] **Step 2:** Run it

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE/apps/api
set -a && source .env && set +a && npx tsx src/cli/migrate-canned-response-content-to-bubbles.cli.ts
```

Expected: "Backfill complete: 27 bubbles created, 0 templates skipped"

- [ ] **Step 3:** Commit

```bash
git add apps/api/src/cli/migrate-canned-response-content-to-bubbles.cli.ts
git commit -m "feat(canned-response): add backfill CLI to convert content → first bubble"
```

---

## Task P1.3: Backend service — bubble CRUD

**Files:**
- `apps/api/src/modules/staff-chat/services/canned-response-bubble.service.ts` (NEW)
- `apps/api/src/modules/staff-chat/services/canned-response-bubble.service.spec.ts` (NEW)

- [ ] **Step 1:** Write failing tests first (TDD):

```typescript
import { Test } from '@nestjs/testing';
import { CannedResponseBubbleService } from './canned-response-bubble.service';
import { PrismaService } from '../../../prisma/prisma.service';

describe('CannedResponseBubbleService', () => {
  let service: CannedResponseBubbleService;
  let prisma: { cannedResponseBubble: any };

  beforeEach(async () => {
    prisma = {
      cannedResponseBubble: {
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
      },
    };
    const module = await Test.createTestingModule({
      providers: [
        CannedResponseBubbleService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = module.get(CannedResponseBubbleService);
  });

  describe('createBubble', () => {
    it('creates a TEXT bubble with auto sortOrder = max+1', async () => {
      prisma.cannedResponseBubble.count.mockResolvedValue(2);
      prisma.cannedResponseBubble.create.mockResolvedValue({ id: 'b3', type: 'TEXT', sortOrder: 2 });
      const result = await service.createBubble('cr-1', { type: 'TEXT', text: 'hi' });
      expect(prisma.cannedResponseBubble.create).toHaveBeenCalledWith({
        data: { cannedResponseId: 'cr-1', type: 'TEXT', text: 'hi', sortOrder: 2 },
      });
      expect(result.id).toBe('b3');
    });

    it('rejects when bubble count >= 5', async () => {
      prisma.cannedResponseBubble.count.mockResolvedValue(5);
      await expect(service.createBubble('cr-1', { type: 'TEXT', text: 'hi' })).rejects.toThrow(/5/);
    });
  });

  describe('listBubbles', () => {
    it('returns bubbles sorted by sortOrder', async () => {
      prisma.cannedResponseBubble.findMany.mockResolvedValue([{ id: 'b1', sortOrder: 0 }]);
      const result = await service.listBubbles('cr-1');
      expect(prisma.cannedResponseBubble.findMany).toHaveBeenCalledWith({
        where: { cannedResponseId: 'cr-1', deletedAt: null },
        orderBy: { sortOrder: 'asc' },
      });
      expect(result).toHaveLength(1);
    });
  });
});
```

- [ ] **Step 2:** Run, expect FAIL

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE/apps/api && npx jest src/modules/staff-chat/services/canned-response-bubble.service.spec.ts --no-coverage
```

- [ ] **Step 3:** Implement service:

```typescript
import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

interface CreateBubbleDto {
  type: 'TEXT' | 'IMAGE' | 'STICKER';
  text?: string;
  mediaUrl?: string;
  thumbnailUrl?: string;
  stickerPackageId?: string;
  stickerId?: string;
}

interface UpdateBubbleDto extends Partial<CreateBubbleDto> {
  sortOrder?: number;
}

@Injectable()
export class CannedResponseBubbleService {
  constructor(private prisma: PrismaService) {}

  async listBubbles(cannedResponseId: string) {
    return this.prisma.cannedResponseBubble.findMany({
      where: { cannedResponseId, deletedAt: null },
      orderBy: { sortOrder: 'asc' },
    });
  }

  async createBubble(cannedResponseId: string, dto: CreateBubbleDto) {
    const count = await this.prisma.cannedResponseBubble.count({
      where: { cannedResponseId, deletedAt: null },
    });
    if (count >= 5) {
      throw new BadRequestException('สูงสุด 5 bubbles ต่อ template');
    }
    return this.prisma.cannedResponseBubble.create({
      data: {
        cannedResponseId,
        type: dto.type,
        text: dto.text,
        mediaUrl: dto.mediaUrl,
        thumbnailUrl: dto.thumbnailUrl,
        stickerPackageId: dto.stickerPackageId,
        stickerId: dto.stickerId,
        sortOrder: count,
      },
    });
  }

  async updateBubble(id: string, dto: UpdateBubbleDto) {
    const existing = await this.prisma.cannedResponseBubble.findFirst({
      where: { id, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('ไม่พบ bubble');
    return this.prisma.cannedResponseBubble.update({
      where: { id },
      data: dto,
    });
  }

  async deleteBubble(id: string) {
    return this.prisma.cannedResponseBubble.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  async reorderBubbles(items: Array<{ id: string; sortOrder: number }>) {
    if (items.length > 5) throw new BadRequestException('reorder รับสูงสุด 5 รายการ');
    await this.prisma.$transaction(
      items.map((i) =>
        this.prisma.cannedResponseBubble.update({
          where: { id: i.id },
          data: { sortOrder: i.sortOrder },
        }),
      ),
    );
    return { updated: items.length };
  }
}
```

- [ ] **Step 4:** Run tests, expect PASS

- [ ] **Step 5:** Register in `StaffChatModule.providers`

Find the module file at `apps/api/src/modules/staff-chat/staff-chat.module.ts` and add `CannedResponseBubbleService` to providers (and exports if other modules need it — probably not).

- [ ] **Step 6:** TS check + commit

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE && ./tools/check-types.sh api
git add apps/api/src/modules/staff-chat/
git commit -m "feat(canned-response): add CannedResponseBubbleService with CRUD"
```

---

## Task P1.4: Backend controller — bubble endpoints

**Files:**
- `apps/api/src/modules/staff-chat/staff-chat.controller.ts`
- `apps/api/src/modules/staff-chat/staff-chat.controller.spec.ts`

- [ ] **Step 1:** Inject `CannedResponseBubbleService` into controller constructor

- [ ] **Step 2:** Add endpoints (BEFORE `@Patch('canned-responses/:id')` to avoid route conflict):

```typescript
  // ─── Bubble CRUD (Phase 1) ───────────────────────────

  @Get('canned-responses/:id/bubbles')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES')
  async listBubbles(@Param('id') id: string) {
    return this.cannedResponseBubble.listBubbles(id);
  }

  @Post('canned-responses/:id/bubbles')
  @Roles('OWNER', 'BRANCH_MANAGER')
  async createBubble(
    @Param('id') id: string,
    @Body() body: { type: 'TEXT' | 'IMAGE' | 'STICKER'; text?: string; mediaUrl?: string; thumbnailUrl?: string; stickerPackageId?: string; stickerId?: string },
  ) {
    return this.cannedResponseBubble.createBubble(id, body);
  }

  @Patch('canned-responses/bubbles/:bubbleId')
  @Roles('OWNER', 'BRANCH_MANAGER')
  async updateBubble(
    @Param('bubbleId') bubbleId: string,
    @Body() body: any,
  ) {
    return this.cannedResponseBubble.updateBubble(bubbleId, body);
  }

  @Delete('canned-responses/bubbles/:bubbleId')
  @Roles('OWNER', 'BRANCH_MANAGER')
  async deleteBubble(@Param('bubbleId') bubbleId: string) {
    return this.cannedResponseBubble.deleteBubble(bubbleId);
  }

  @Patch('canned-responses/bubbles/reorder')
  @Roles('OWNER', 'BRANCH_MANAGER')
  async reorderBubbles(@Body() body: { items: Array<{ id: string; sortOrder: number }> }) {
    return this.cannedResponseBubble.reorderBubbles(body.items);
  }
```

- [ ] **Step 3:** Add tests in `staff-chat.controller.spec.ts`. Need to add `cannedResponseBubble` to the mock providers list:

```typescript
{
  provide: CannedResponseBubbleService,
  useValue: { listBubbles: jest.fn(), createBubble: jest.fn(), updateBubble: jest.fn(), deleteBubble: jest.fn(), reorderBubbles: jest.fn() },
},
```

Add at end:
```typescript
describe('Bubble endpoints', () => {
  it('GET /canned-responses/:id/bubbles delegates to service', async () => {
    jest.spyOn(cannedResponseBubble, 'listBubbles').mockResolvedValue([] as any);
    await controller.listBubbles('cr-1');
    expect(cannedResponseBubble.listBubbles).toHaveBeenCalledWith('cr-1');
  });

  it('POST creates bubble', async () => {
    jest.spyOn(cannedResponseBubble, 'createBubble').mockResolvedValue({} as any);
    await controller.createBubble('cr-1', { type: 'TEXT', text: 'hi' });
    expect(cannedResponseBubble.createBubble).toHaveBeenCalledWith('cr-1', { type: 'TEXT', text: 'hi' });
  });
});
```

- [ ] **Step 4:** Run jest tests + TS check + commit

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE/apps/api && npx jest src/modules/staff-chat --no-coverage
cd /Users/iamnaii/Desktop/App/BESTCHOICE && ./tools/check-types.sh api
git add apps/api/src/modules/staff-chat/
git commit -m "feat(canned-response): expose bubble CRUD HTTP endpoints"
```

---

## Task P1.5: Backend — extend preview endpoint to return bubbles

**File:** `apps/api/src/modules/staff-chat/services/staff-message.service.ts`

- [ ] **Step 1:** Modify `getCannedResponseExpanded` to ALSO load bubbles and return them in expanded form:

Replace return shape to include `bubbles`. Each bubble gets variable expansion on its text field.

```typescript
async getCannedResponseExpanded(id: string, roomId: string) {
  const cannedResponse = await this.prisma.cannedResponse.findFirst({
    where: { id, deletedAt: null, isActive: true },
    include: {
      bubbles: { where: { deletedAt: null }, orderBy: { sortOrder: 'asc' } },
    },
  });
  if (!cannedResponse) throw new NotFoundException('ไม่พบข้อความสำเร็จรูป');

  const room = await this.prisma.chatRoom.findFirst({
    where: { id: roomId, deletedAt: null },
    select: { id: true, customerId: true },
  });
  const customerId = room?.customerId ?? undefined;

  // Expand each TEXT bubble's text
  const expandedBubbles = await Promise.all(
    cannedResponse.bubbles.map(async (b) => {
      if (b.type === 'TEXT' && b.text) {
        return { ...b, text: await this.cannedResponseVariableService.expandVariables(b.text, { roomId, customerId }) };
      }
      return b;
    }),
  );

  // Legacy: expand content too (for backward compat)
  const expandedContent = cannedResponse.content
    ? await this.cannedResponseVariableService.expandVariables(cannedResponse.content, { roomId, customerId })
    : '';

  return {
    id: cannedResponse.id,
    shortcut: cannedResponse.shortcut,
    title: cannedResponse.title,
    content: cannedResponse.content,
    expandedContent,
    bubbles: expandedBubbles,
  };
}
```

- [ ] **Step 2:** Update existing test in `canned-response-variable.service.spec.ts` if needed — should still pass since we only ADDED fields.

- [ ] **Step 3:** TS check + run staff-chat tests + commit

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE/apps/api && npx jest src/modules/staff-chat --no-coverage
cd /Users/iamnaii/Desktop/App/BESTCHOICE && ./tools/check-types.sh api
git add apps/api/src/modules/staff-chat/services/staff-message.service.ts
git commit -m "feat(canned-response): include bubbles in preview response"
```

---

## Task P1.6: Backend — extend sender to send multiple bubbles

**File:** `apps/api/src/modules/chat-engine/` (find relevant sender/dispatch logic)

- [ ] **Step 1:** Grep for the existing send-message flow

```bash
grep -rn "cannedResponse\|sendCannedResponse" apps/api/src/modules/chat-engine apps/api/src/modules/staff-chat 2>/dev/null | grep -v "\.spec\.ts" | head -20
```

Identify where canned response sending happens. Likely in `staff-chat/services/staff-message.service.ts` or `chat-engine/...`. The picker in frontend probably just inserts text into compose box, then user clicks send — in which case Phase 1 doesn't need a sender change because picker still expands bubbles to text on the frontend (joins all TEXT bubbles with newlines, sends each non-text bubble as separate message via existing send-image API).

If that's the case, document this in the commit message and skip backend sender changes for Phase 1.

- [ ] **Step 2:** If picker flow only concatenates text → continue. If there's a dedicated "send canned response" API that takes a canned-response-id, then add bubble-array support to it.

For Phase 1, assume picker = client-side expansion (frontend reads bubbles array, sends them sequentially through existing message-send endpoint).

- [ ] **Step 3:** Commit (or skip if no changes needed)

---

## Task P1.7: Frontend — types update + BubbleEditor

**Files:**
- `apps/web/src/pages/canned-response-admin/types.ts` (modify)
- `apps/web/src/pages/canned-response-admin/bubble-editors/TextBubbleEditor.tsx` (NEW)
- `apps/web/src/pages/canned-response-admin/bubble-editors/ImageBubbleEditor.tsx` (NEW)
- `apps/web/src/pages/canned-response-admin/bubble-editors/StickerBubbleEditor.tsx` (NEW)
- `apps/web/src/pages/canned-response-admin/BubbleEditor.tsx` (NEW — router)

- [ ] **Step 1:** Extend types:

```typescript
export type BubbleType = 'TEXT' | 'IMAGE' | 'STICKER';

export interface CannedResponseBubble {
  id: string;
  cannedResponseId: string;
  type: BubbleType;
  sortOrder: number;
  text: string | null;
  mediaUrl: string | null;
  thumbnailUrl: string | null;
  stickerPackageId: string | null;
  stickerId: string | null;
  createdAt: string;
}

export interface CannedResponse {
  // ... existing fields ...
  bubbles?: CannedResponseBubble[];
}
```

- [ ] **Step 2:** Create `TextBubbleEditor.tsx`:

```tsx
import { Textarea } from '@/components/ui/textarea';
import type { CannedResponseBubble } from '../types';

const VARIABLES = ['{customerName}', '{customerPhone}', '{contractNumber}', '{amountDue}', '{dueDate}', '{installmentNo}', '{branchName}'];

interface Props {
  bubble: CannedResponseBubble;
  onChange: (patch: Partial<CannedResponseBubble>) => void;
}

export default function TextBubbleEditor({ bubble, onChange }: Props) {
  return (
    <div className="space-y-2">
      <Textarea
        value={bubble.text ?? ''}
        onChange={(e) => onChange({ text: e.target.value })}
        placeholder="พิมพ์ข้อความ..."
        className="min-h-[120px] text-sm leading-relaxed"
      />
      <div className="flex flex-wrap gap-1">
        {VARIABLES.map((v) => (
          <button
            key={v}
            onClick={() => onChange({ text: (bubble.text ?? '') + v })}
            className="px-2 py-0.5 text-[11px] font-mono bg-muted hover:bg-emerald-50 hover:text-emerald-700 rounded border border-border"
          >
            {v}
          </button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3:** Create `ImageBubbleEditor.tsx`:

```tsx
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import api from '@/lib/api';
import type { CannedResponseBubble } from '../types';

interface Props {
  bubble: CannedResponseBubble;
  onChange: (patch: Partial<CannedResponseBubble>) => void;
}

export default function ImageBubbleEditor({ bubble, onChange }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      toast.error('ไฟล์ใหญ่เกิน 10 MB');
      return;
    }
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const res: any = await api.post('/upload/image', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      const url = res?.data?.url ?? res?.url;
      if (url) {
        onChange({ mediaUrl: url });
        toast.success('อัพโหลดแล้ว');
      }
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? 'อัพโหลดไม่สำเร็จ');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <div className="space-y-2">
      <Input
        value={bubble.mediaUrl ?? ''}
        onChange={(e) => onChange({ mediaUrl: e.target.value })}
        placeholder="URL รูป หรือ อัพโหลด"
      />
      <div className="flex items-center gap-2">
        <input type="file" accept="image/*" ref={fileRef} onChange={handleFile} className="hidden" />
        <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()} disabled={uploading}>
          <Upload className="w-3.5 h-3.5 mr-1.5" />
          {uploading ? 'กำลังอัพ...' : 'อัพโหลดรูป'}
        </Button>
        {bubble.mediaUrl && (
          <span className="text-xs text-muted-foreground truncate flex-1">{bubble.mediaUrl}</span>
        )}
      </div>
      {bubble.mediaUrl && (
        <img src={bubble.mediaUrl} alt="preview" className="max-w-xs max-h-48 rounded border border-border" />
      )}
    </div>
  );
}
```

**Note:** The upload endpoint `/upload/image` may not exist. Check first:
```bash
grep -rn "upload/image\|@Post.*upload" /Users/iamnaii/Desktop/App/BESTCHOICE/apps/api/src/modules/ 2>/dev/null | head -5
```

If missing, change to use an existing S3 upload endpoint (likely `/files/upload` or similar) — find it via grep and adjust the URL.

- [ ] **Step 4:** Create `StickerBubbleEditor.tsx`:

```tsx
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { CannedResponseBubble } from '../types';

interface Props {
  bubble: CannedResponseBubble;
  onChange: (patch: Partial<CannedResponseBubble>) => void;
}

export default function StickerBubbleEditor({ bubble, onChange }: Props) {
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label htmlFor="package-id" className="text-xs">Package ID</Label>
          <Input
            id="package-id"
            value={bubble.stickerPackageId ?? ''}
            onChange={(e) => onChange({ stickerPackageId: e.target.value })}
            placeholder="11537"
          />
        </div>
        <div>
          <Label htmlFor="sticker-id" className="text-xs">Sticker ID</Label>
          <Input
            id="sticker-id"
            value={bubble.stickerId ?? ''}
            onChange={(e) => onChange({ stickerId: e.target.value })}
            placeholder="52002734"
          />
        </div>
      </div>
      <p className="text-xs text-muted-foreground leading-snug">
        ดู ID ได้ที่{' '}
        <a href="https://developers.line.biz/en/docs/messaging-api/sticker-list/" target="_blank" rel="noreferrer" className="text-primary hover:underline">
          LINE Sticker docs
        </a>
        {' '}(สำหรับ LINE channel เท่านั้น)
      </p>
      {bubble.stickerPackageId && bubble.stickerId && (
        <img
          src={`https://stickershop.line-scdn.net/stickershop/v1/sticker/${bubble.stickerId}/android/sticker.png`}
          alt="sticker preview"
          className="w-24 h-24 border border-border rounded"
          onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 5:** Create `BubbleEditor.tsx` (router based on type):

```tsx
import TextBubbleEditor from './bubble-editors/TextBubbleEditor';
import ImageBubbleEditor from './bubble-editors/ImageBubbleEditor';
import StickerBubbleEditor from './bubble-editors/StickerBubbleEditor';
import type { CannedResponseBubble } from './types';

interface Props {
  bubble: CannedResponseBubble;
  onChange: (patch: Partial<CannedResponseBubble>) => void;
}

export default function BubbleEditor({ bubble, onChange }: Props) {
  switch (bubble.type) {
    case 'TEXT':
      return <TextBubbleEditor bubble={bubble} onChange={onChange} />;
    case 'IMAGE':
      return <ImageBubbleEditor bubble={bubble} onChange={onChange} />;
    case 'STICKER':
      return <StickerBubbleEditor bubble={bubble} onChange={onChange} />;
    default:
      return <div className="text-sm text-muted-foreground">ไม่รองรับ type นี้ใน Phase 1</div>;
  }
}
```

- [ ] **Step 6:** TS check + commit

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE && ./tools/check-types.sh web
git add apps/web/src/pages/canned-response-admin/
git commit -m "feat(canned-response): add per-type bubble editors (Phase 1)"
```

---

## Task P1.8: Frontend — BubbleList component (drag-sortable)

**File:** `apps/web/src/pages/canned-response-admin/BubbleList.tsx`

- [ ] **Step 1:** Create the component:

```tsx
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Plus, Trash2, Type, Image as ImageIcon, Smile } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import api from '@/lib/api';
import BubbleEditor from './BubbleEditor';
import type { CannedResponseBubble, BubbleType } from './types';

interface Props { cannedResponseId: string; }

const TYPE_LABEL: Record<BubbleType, string> = { TEXT: 'ข้อความ', IMAGE: 'รูป', STICKER: 'สติ๊กเกอร์' };
const TYPE_ICON = { TEXT: Type, IMAGE: ImageIcon, STICKER: Smile };

function SortableBubbleRow({ bubble, onChange, onDelete }: { bubble: CannedResponseBubble; onChange: (p: Partial<CannedResponseBubble>) => void; onDelete: () => void; }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: bubble.id });
  const style = { transform: CSS.Transform.toString(transform), transition };
  const Icon = TYPE_ICON[bubble.type];
  return (
    <div ref={setNodeRef} style={style} className={`border border-border rounded-lg p-3 bg-card ${isDragging ? 'opacity-50' : ''}`}>
      <div className="flex items-center gap-2 mb-2">
        <button {...attributes} {...listeners} className="cursor-grab text-muted-foreground hover:text-foreground p-1">
          <GripVertical className="w-4 h-4" />
        </button>
        <Icon className="w-4 h-4 text-muted-foreground" />
        <span className="text-xs font-medium text-muted-foreground">{TYPE_LABEL[bubble.type]}</span>
        <div className="flex-1" />
        <button onClick={onDelete} className="p-1 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded" title="ลบ">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
      <BubbleEditor bubble={bubble} onChange={onChange} />
    </div>
  );
}

export default function BubbleList({ cannedResponseId }: Props) {
  const qc = useQueryClient();

  const bubblesQ = useQuery<CannedResponseBubble[]>({
    queryKey: ['canned-response-bubbles', cannedResponseId],
    queryFn: () => api.get(`/staff-chat/canned-responses/${cannedResponseId}/bubbles`).then((r: any) => r.data),
  });

  const bubbles = bubblesQ.data ?? [];

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['canned-response-bubbles', cannedResponseId] });
    qc.invalidateQueries({ queryKey: ['canned-responses-admin'] });
    qc.invalidateQueries({ queryKey: ['canned-responses-picker'] });
  };

  const createMut = useMutation({
    mutationFn: (type: BubbleType) =>
      api.post(`/staff-chat/canned-responses/${cannedResponseId}/bubbles`, { type }),
    onSuccess: () => invalidate(),
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'สร้างไม่สำเร็จ'),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<CannedResponseBubble> }) =>
      api.patch(`/staff-chat/canned-responses/bubbles/${id}`, patch),
    onSuccess: () => invalidate(),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.delete(`/staff-chat/canned-responses/bubbles/${id}`),
    onSuccess: () => invalidate(),
  });

  const reorderMut = useMutation({
    mutationFn: (items: Array<{ id: string; sortOrder: number }>) =>
      api.patch('/staff-chat/canned-responses/bubbles/reorder', { items }),
    onSuccess: () => invalidate(),
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'เรียงลำดับไม่สำเร็จ'),
  });

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const fromIdx = bubbles.findIndex((b) => b.id === active.id);
    const toIdx = bubbles.findIndex((b) => b.id === over.id);
    if (fromIdx < 0 || toIdx < 0) return;
    const reordered = [...bubbles];
    const [moved] = reordered.splice(fromIdx, 1);
    reordered.splice(toIdx, 0, moved);
    reorderMut.mutate(reordered.map((b, i) => ({ id: b.id, sortOrder: i })));
  };

  const canAdd = bubbles.length < 5;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold">ข้อความ ({bubbles.length}/5 บับเบิ้ล)</h4>
      </div>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={bubbles.map((b) => b.id)} strategy={verticalListSortingStrategy}>
          <div className="space-y-2">
            {bubbles.map((bubble) => (
              <SortableBubbleRow
                key={bubble.id}
                bubble={bubble}
                onChange={(patch) => updateMut.mutate({ id: bubble.id, patch })}
                onDelete={() => deleteMut.mutate(bubble.id)}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
      {canAdd && (
        <div className="flex items-center gap-2 pt-2 border-t border-border">
          <span className="text-xs text-muted-foreground">เพิ่มประเภท:</span>
          <Button size="sm" variant="outline" onClick={() => createMut.mutate('TEXT')}>
            <Type className="w-3.5 h-3.5 mr-1.5" /> ข้อความ
          </Button>
          <Button size="sm" variant="outline" onClick={() => createMut.mutate('IMAGE')}>
            <ImageIcon className="w-3.5 h-3.5 mr-1.5" /> รูป
          </Button>
          <Button size="sm" variant="outline" onClick={() => createMut.mutate('STICKER')}>
            <Smile className="w-3.5 h-3.5 mr-1.5" /> สติ๊กเกอร์
          </Button>
        </div>
      )}
      {!canAdd && (
        <p className="text-xs text-muted-foreground">ถึงขีดจำกัด 5 บับเบิ้ลแล้ว — ลบบางบับเบิ้ลก่อนเพิ่มใหม่</p>
      )}
    </div>
  );
}
```

- [ ] **Step 2:** TS check + commit

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE && ./tools/check-types.sh web
git add apps/web/src/pages/canned-response-admin/BubbleList.tsx
git commit -m "feat(canned-response): add BubbleList with DnD reorder + per-type add"
```

---

## Task P1.9: Frontend — wire BubbleList into TemplateEditorPane

**File:** `apps/web/src/pages/canned-response-admin/TemplateEditorPane.tsx`

- [ ] **Step 1:** Remove the existing single Content textarea + variable chips section. Replace with `<BubbleList cannedResponseId={template.id} />`.

Keep title/shortcut/category/isActive form fields and Save button (those still save the parent `CannedResponse` row).

- [ ] **Step 2:** TS check + manual smoke test

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE && ./tools/check-types.sh web
```

Open `http://localhost:5173/canned-responses` → select a template → should see BubbleList with the migrated TEXT bubble.

- [ ] **Step 3:** Commit

```bash
git add apps/web/src/pages/canned-response-admin/TemplateEditorPane.tsx
git commit -m "feat(canned-response): replace Content textarea with BubbleList in editor"
```

---

## Task P1.10: Update MessageTemplatePicker preview to show bubbles

**File:** `apps/web/src/pages/UnifiedInboxPage/components/MessageTemplatePicker.tsx`

- [ ] **Step 1:** Update the preview pane to render bubbles when present (fall back to expandedContent if no bubbles):

The preview API now returns `{ ..., bubbles: [...] }`. Render bubbles list with type-specific UI:
- TEXT → text content
- IMAGE → `<img>` thumbnail
- STICKER → sticker URL preview

On insert: send each bubble through the chat compose. For Phase 1 simplicity, **concatenate all TEXT bubbles** with newlines (since current compose is text-only). Image/sticker bubbles → show a warning toast that they can't be inserted via Picker in Phase 1 (will be added in Phase 2 when picker supports multi-message send).

```tsx
// Inside the preview body — replace the single expandedContent render with:
{preview?.bubbles && preview.bubbles.length > 0 ? (
  <div className="space-y-2">
    {preview.bubbles.map((b: any) => (
      <div key={b.id} className="bg-card border border-border rounded-lg p-3">
        {b.type === 'TEXT' && <div className="text-sm whitespace-pre-line leading-relaxed">{b.text}</div>}
        {b.type === 'IMAGE' && b.mediaUrl && <img src={b.mediaUrl} alt="" className="max-w-full max-h-48 rounded" />}
        {b.type === 'STICKER' && b.stickerPackageId && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>Sticker</span>
            <code>{b.stickerPackageId}/{b.stickerId}</code>
          </div>
        )}
      </div>
    ))}
  </div>
) : (
  <div className="bg-card border border-border rounded-lg p-4 text-sm whitespace-pre-line leading-relaxed">
    {preview?.expandedContent}
  </div>
)}
```

- [ ] **Step 2:** Update `handleInsert` — concatenate TEXT bubbles:

```tsx
const handleInsert = () => {
  if (!preview) return;
  const textBubbles = (preview.bubbles ?? []).filter((b: any) => b.type === 'TEXT' && b.text);
  const nonTextCount = (preview.bubbles ?? []).filter((b: any) => b.type !== 'TEXT').length;
  if (nonTextCount > 0) {
    toast.warning(`มี ${nonTextCount} bubbles ที่ไม่ใช่ text — Phase 1 ส่งเฉพาะ text`);
  }
  const content = textBubbles.length > 0
    ? textBubbles.map((b: any) => b.text).join('\n\n')
    : (preview.expandedContent ?? '');
  onInsert(content);
  onClose();
};
```

- [ ] **Step 3:** TS check + commit

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE && ./tools/check-types.sh web
git add apps/web/src/pages/UnifiedInboxPage/components/MessageTemplatePicker.tsx
git commit -m "feat(canned-response): render bubbles in picker preview + insert TEXT-only"
```

---

## Task P1.11: Final sweep + manual QA

- [ ] Run all tests + TS check
- [ ] Manual smoke test the admin page + picker
- [ ] Commit any fixes
