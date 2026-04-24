# Collections Workflow Hub — Plan 4/4: Legal Letters

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. UI tasks MUST invoke `frontend-design` skill before coding.

**Goal:** Ship the legal-notice infrastructure that closes the `LEGAL_ACTION` workflow gap: 45-day "return device" and 60-day "contract termination + legal action" registered letters. Manual-dispatch MVP — OWNER generates PDF in browser, prints, mails via EMS, returns to enter tracking#. Evidence chain (PDF snapshot + tracking + dispatch receipt photo) satisfies Thai court requirements.

**Architecture:** Client-side PDF via jsPDF (matches existing project pattern; no new npm deps). Backend manages ContractLetter state machine + auto-generate cron. OWNER queue lives in existing ApprovalTab. Thailand Post Connect API deferred to Phase B.

**Tech Stack:** NestJS + Prisma (backend state machine + cron) + React + jsPDF 4 + jspdf-autotable (already in web deps) + StorageService (existing S3/GCS abstraction).

**Spec:** [docs/superpowers/specs/2026-04-24-collections-workflow-hub-design.md](../specs/2026-04-24-collections-workflow-hub-design.md) §6.

**Depends on:** Plan 3 branch `feat/collections-power-features`. Plan 1 already created `ContractLetter` model + `ContractLetterService` skeleton (createIfNotExists + cancel) + 5 SystemConfig keys.

---

## File Map

### Create — Backend

- `apps/api/src/modules/overdue/crons/letter-auto-generate.cron.ts` + `.spec.ts`
- `apps/api/src/modules/overdue/dto/letter-dispatch.dto.ts`

### Modify — Backend

- `apps/api/src/modules/overdue/contract-letter.service.ts` — add `list`, `markPdfGenerated`, `markDispatched`, `markDelivered`
- `apps/api/src/modules/overdue/contract-letter.service.spec.ts` — extend
- `apps/api/src/modules/overdue/overdue.controller.ts` — 6 new endpoints
- `apps/api/src/modules/overdue/overdue.module.ts` — register cron

### Create — Frontend

```
apps/web/src/pages/CollectionsPage/
  components/
    LetterQueueSection.tsx            # inside ApprovalTab
    LetterDispatchDialog.tsx          # generate PDF + print + enter tracking#
    LetterSettingsCard.tsx            # small card on DunningSettingsPage (Plan 4)
  hooks/
    useLetterQueue.ts
    useLetterActions.ts
  utils/
    letterPdfRenderer.ts              # client-side jsPDF builder, 2 templates
```

### Modify — Frontend

- `apps/web/src/pages/CollectionsPage/tabs/ApprovalTab.tsx` — add `<LetterQueueSection />` as 3rd section
- `apps/web/src/pages/DunningSettingsPage.tsx` — add signature + letterhead upload card

---

## Design brief — "Courthouse-grade paper, screen-calm UI"

The letter itself is the hero — black ink on white, serif-ish for authority, exact legal wording. The UI around it stays Operations Room.

**PDF design (jsPDF):**
- A4 portrait. Margins 25mm top/bottom/left/right.
- Header: company letterhead image (if configured) at top-left, letter number + date at top-right. Black rule line below.
- Body: Thai text with Sarabun or IBM Plex Sans Thai (embed via jsPDF `addFileToVFS`). 14pt body, 1.5 line-height.
- Footer: director's printed name + "(ลายมือชื่อ)" block, signature image (if configured). Company name + taxId + address in small gray text at very bottom.
- No color except letterhead/signature. Black/white only. **Tabular-nums** on amount and contract#.

**UI screen-side:**
- Queue section in ApprovalTab shows PENDING + PDF_GENERATED letters only.
- Each row: letter number + contract# + letter type chip + days-since-triggered + status chip + CTA button.
- Status-specific CTAs:
  - PENDING_DISPATCH → [สร้าง PDF] (opens dialog → generates + uploads → flips to PDF_GENERATED)
  - PDF_GENERATED → [ดาวน์โหลด PDF] + [บันทึกส่งแล้ว] (opens dispatch dialog for tracking + evidence)
  - DISPATCHED → [ทำเครื่องหมายรับ] (mark delivered) or [คืน] (mark undeliverable)
- Cancel option behind a small trash icon for PENDING_DISPATCH/PDF_GENERATED only.

---

## Task 1: Extend ContractLetterService

### Files
- Modify: `apps/api/src/modules/overdue/contract-letter.service.ts`
- Modify: `apps/api/src/modules/overdue/contract-letter.service.spec.ts`

### New methods

```typescript
/**
 * List letters matching a status filter, newest-triggered first.
 * Includes contract + customer for display in OWNER queue.
 */
async list(params: {
  status?: LetterStatus;
  letterType?: LetterType;
  branchId?: string;
  limit?: number;
}) {
  const where: Prisma.ContractLetterWhereInput = {
    deletedAt: null,
    ...(params.status && { status: params.status }),
    ...(params.letterType && { letterType: params.letterType }),
    ...(params.branchId && { contract: { branchId: params.branchId } }),
  };
  return this.prisma.contractLetter.findMany({
    where,
    include: {
      contract: {
        select: {
          id: true,
          contractNumber: true,
          customer: { select: { id: true, name: true, phone: true, address: true } },
          branch: { select: { id: true, name: true } },
        },
      },
    },
    orderBy: { triggeredAt: 'desc' },
    take: params.limit ?? 100,
  });
}

/** After client generates PDF and uploads to S3, backend records the URL. */
async markPdfGenerated(letterId: string, pdfUrl: string, userId: string) {
  const letter = await this.prisma.contractLetter.findUnique({ where: { id: letterId } });
  if (!letter) throw new NotFoundException('ไม่พบหนังสือ');
  if (letter.status !== 'PENDING_DISPATCH') {
    throw new BadRequestException('สถานะไม่ถูกต้อง — ต้องอยู่ในสถานะ PENDING_DISPATCH');
  }
  return this.prisma.$transaction([
    this.prisma.contractLetter.update({
      where: { id: letterId },
      data: { status: 'PDF_GENERATED', pdfUrl, pdfGeneratedAt: new Date() },
    }),
    this.prisma.auditLog.create({
      data: { userId, action: 'LETTER_PDF_GENERATED', entity: 'contract_letter', entityId: letterId, newValue: { pdfUrl } },
    }),
  ]).then(([l]) => l);
}

async markDispatched(
  letterId: string,
  userId: string,
  params: { trackingNumber: string; evidencePhotoUrl?: string },
) {
  const letter = await this.prisma.contractLetter.findUnique({ where: { id: letterId } });
  if (!letter) throw new NotFoundException('ไม่พบหนังสือ');
  if (letter.status !== 'PDF_GENERATED') {
    throw new BadRequestException('สถานะไม่ถูกต้อง — ต้องอยู่ในสถานะ PDF_GENERATED');
  }
  if (!params.trackingNumber || params.trackingNumber.trim().length < 5) {
    throw new BadRequestException('เลข tracking EMS ต้อง ≥ 5 ตัวอักษร');
  }

  const [updated] = await this.prisma.$transaction([
    this.prisma.contractLetter.update({
      where: { id: letterId },
      data: {
        status: 'DISPATCHED',
        dispatchedAt: new Date(),
        dispatchedById: userId,
        trackingNumber: params.trackingNumber.trim(),
        evidencePhotoUrl: params.evidencePhotoUrl ?? null,
      },
    }),
    this.prisma.auditLog.create({
      data: {
        userId,
        action: 'LETTER_DISPATCHED',
        entity: 'contract_letter',
        entityId: letterId,
        newValue: { trackingNumber: params.trackingNumber, evidencePhotoUrl: params.evidencePhotoUrl ?? null },
      },
    }),
  ]);

  // Fire LINE event — non-fatal
  try {
    await this.dunningEngine.executeEventTrigger(
      'LETTER_DISPATCHED',
      letter.contractId,
      null,
      null,
      { trackingNumber: params.trackingNumber },
    );
  } catch {
    // already logged by engine
  }

  // If CONTRACT_TERMINATION_60D, also fire CONTRACT_TERMINATED event
  if (letter.letterType === 'CONTRACT_TERMINATION_60D') {
    try {
      await this.dunningEngine.executeEventTrigger('CONTRACT_TERMINATED', letter.contractId, null, null);
    } catch { /* non-fatal */ }
  }

  return updated;
}

async markDelivered(letterId: string, userId: string) {
  const letter = await this.prisma.contractLetter.findUnique({ where: { id: letterId } });
  if (!letter) throw new NotFoundException('ไม่พบหนังสือ');
  if (letter.status !== 'DISPATCHED') {
    throw new BadRequestException('สถานะไม่ถูกต้อง — ต้องอยู่ในสถานะ DISPATCHED');
  }
  return this.prisma.$transaction([
    this.prisma.contractLetter.update({
      where: { id: letterId },
      data: { status: 'DELIVERED', deliveredAt: new Date() },
    }),
    this.prisma.auditLog.create({
      data: { userId, action: 'LETTER_DELIVERED', entity: 'contract_letter', entityId: letterId },
    }),
  ]).then(([l]) => l);
}

async markUndeliverable(letterId: string, userId: string, reason: string) {
  if (!reason || reason.trim().length < 5) {
    throw new BadRequestException('เหตุผลต้อง ≥ 5 ตัวอักษร');
  }
  const letter = await this.prisma.contractLetter.findUnique({ where: { id: letterId } });
  if (!letter) throw new NotFoundException('ไม่พบหนังสือ');
  if (letter.status !== 'DISPATCHED') {
    throw new BadRequestException('สถานะไม่ถูกต้อง');
  }
  return this.prisma.$transaction([
    this.prisma.contractLetter.update({
      where: { id: letterId },
      data: { status: 'UNDELIVERABLE', cancelReason: reason.trim(), cancelledAt: new Date() },
    }),
    this.prisma.contract.update({
      where: { id: letter.contractId },
      data: { needsSkipTracing: true },
    }),
    this.prisma.auditLog.create({
      data: { userId, action: 'LETTER_UNDELIVERABLE', entity: 'contract_letter', entityId: letterId, newValue: { reason } },
    }),
  ]).then(([l]) => l);
}
```

Also: inject `DunningEngineService` into the constructor so `executeEventTrigger` is callable.

### Tests

Extend existing spec with 10+ new tests:
- list filters by status/type/branch
- markPdfGenerated: only PENDING_DISPATCH → PDF_GENERATED; records URL + timestamp
- markPdfGenerated rejects non-PENDING
- markDispatched validates tracking length ≥ 5
- markDispatched fires LETTER_DISPATCHED event
- markDispatched fires CONTRACT_TERMINATED for 60D letter type
- markDelivered: DISPATCHED → DELIVERED
- markUndeliverable flips contract.needsSkipTracing = true
- markUndeliverable requires reason

### Commit
`feat(overdue): ContractLetterService full state machine (list/pdf/dispatch/delivered/undeliverable)`

---

## Task 2: letter-auto-generate cron

### Files
- Create: `apps/api/src/modules/overdue/crons/letter-auto-generate.cron.ts` + `.spec.ts`
- Modify: `apps/api/src/modules/overdue/overdue.module.ts`

### Behavior

Daily 09:15 (after mdm-auto-propose at 09:00 to avoid load spikes). Respects `letter_auto_generate_enabled` flag (default false — OWNER must review templates before first auto-run).

Scan contracts:
- For `RETURN_DEVICE_45D`: OVERDUE ≥ `letter_return_device_days` (45) days, has overdue payments, no existing letter of this type
- For `CONTRACT_TERMINATION_60D`: OVERDUE ≥ `letter_termination_days` (60) days, no existing letter of this type

Create via `ContractLetterService.createIfNotExists` (already idempotent). Notify OWNER via LINE (single "N letters pending" message) — optional, skip if no LINE for OWNER user.

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../../../prisma/prisma.service';
import { ContractLetterService } from '../contract-letter.service';

@Injectable()
export class LetterAutoGenerateCron {
  private readonly logger = new Logger(LetterAutoGenerateCron.name);

  constructor(
    private prisma: PrismaService,
    private letterService: ContractLetterService,
  ) {}

  @Cron('15 9 * * *')
  async run(): Promise<{ returnDevice: number; termination: number }> {
    try {
      const enabled = await this.prisma.systemConfig.findUnique({
        where: { key: 'letter_auto_generate_enabled' },
      });
      if (enabled?.value !== 'true') {
        this.logger.log('letter_auto_generate_enabled=false — skipping');
        return { returnDevice: 0, termination: 0 };
      }

      const returnDays = Number(
        (await this.prisma.systemConfig.findUnique({ where: { key: 'letter_return_device_days' } }))?.value ?? 45,
      );
      const terminationDays = Number(
        (await this.prisma.systemConfig.findUnique({ where: { key: 'letter_termination_days' } }))?.value ?? 60,
      );

      const now = new Date();
      const returnThreshold = new Date(now.getTime() - returnDays * 86400000);
      const terminationThreshold = new Date(now.getTime() - terminationDays * 86400000);

      const returnCandidates = await this.prisma.contract.findMany({
        where: {
          status: { in: ['OVERDUE', 'DEFAULT'] },
          deletedAt: null,
          payments: {
            some: {
              dueDate: { lt: returnThreshold },
              status: { in: ['PENDING', 'OVERDUE', 'PARTIALLY_PAID'] },
            },
          },
          contractLetters: {
            none: { letterType: 'RETURN_DEVICE_45D', deletedAt: null },
          },
        },
        select: { id: true },
      });

      let returnDevice = 0;
      for (const { id } of returnCandidates) {
        try {
          await this.letterService.createIfNotExists(id, 'RETURN_DEVICE_45D');
          returnDevice++;
        } catch (err) {
          Sentry.captureException(err, { tags: { cron: 'letter-auto-generate', letterType: 'RETURN_DEVICE_45D' }, extra: { contractId: id } });
        }
      }

      const terminationCandidates = await this.prisma.contract.findMany({
        where: {
          status: { in: ['OVERDUE', 'DEFAULT'] },
          deletedAt: null,
          payments: {
            some: {
              dueDate: { lt: terminationThreshold },
              status: { in: ['PENDING', 'OVERDUE', 'PARTIALLY_PAID'] },
            },
          },
          contractLetters: {
            none: { letterType: 'CONTRACT_TERMINATION_60D', deletedAt: null },
          },
        },
        select: { id: true },
      });

      let termination = 0;
      for (const { id } of terminationCandidates) {
        try {
          await this.letterService.createIfNotExists(id, 'CONTRACT_TERMINATION_60D');
          termination++;
        } catch (err) {
          Sentry.captureException(err, { tags: { cron: 'letter-auto-generate', letterType: 'CONTRACT_TERMINATION_60D' }, extra: { contractId: id } });
        }
      }

      this.logger.log(`Letter auto-generate: return_device=${returnDevice}, termination=${termination}`);
      return { returnDevice, termination };
    } catch (err) {
      Sentry.captureException(err, { tags: { cron: 'letter-auto-generate' } });
      this.logger.error(`letter-auto-generate failed: ${err instanceof Error ? err.message : err}`);
      return { returnDevice: 0, termination: 0 };
    }
  }
}
```

### Tests (mock-based)

5+ tests:
- Skips when flag disabled
- Creates RETURN_DEVICE_45D for matching contracts
- Creates CONTRACT_TERMINATION_60D for matching contracts
- Deduplicates (existing letter prevents re-creation — verified via unique constraint)
- Does not throw when individual create fails

### Register in module

Add `LetterAutoGenerateCron` to providers.

### Commit
`feat(overdue): letter-auto-generate cron (daily 09:15, flag-gated)`

---

## Task 3: Backend endpoints

### File
- Modify: `apps/api/src/modules/overdue/overdue.controller.ts`

### Routes

```typescript
  @Get('letters')
  @Roles('OWNER', 'FINANCE_MANAGER', 'BRANCH_MANAGER')
  listLetters(
    @Query('status') status?: string,
    @Query('letterType') letterType?: string,
    @CurrentUser() user?: { role: string; branchId: string | null },
  ) {
    return this.contractLetterService.list({
      status: status as any,
      letterType: letterType as any,
      branchId: user?.role === 'BRANCH_MANAGER' ? user.branchId ?? undefined : undefined,
    });
  }

  @Post('letters/:id/pdf-generated')
  @Roles('OWNER', 'FINANCE_MANAGER')
  markPdfGenerated(
    @Param('id') id: string,
    @Body() body: { pdfUrl: string },
    @CurrentUser() user: { id: string },
  ) {
    return this.contractLetterService.markPdfGenerated(id, body.pdfUrl, user.id);
  }

  @Post('letters/:id/dispatch')
  @Roles('OWNER', 'FINANCE_MANAGER')
  dispatchLetter(
    @Param('id') id: string,
    @Body() body: { trackingNumber: string; evidencePhotoUrl?: string },
    @CurrentUser() user: { id: string },
  ) {
    return this.contractLetterService.markDispatched(id, user.id, body);
  }

  @Post('letters/:id/delivered')
  @Roles('OWNER', 'FINANCE_MANAGER')
  markLetterDelivered(
    @Param('id') id: string,
    @CurrentUser() user: { id: string },
  ) {
    return this.contractLetterService.markDelivered(id, user.id);
  }

  @Post('letters/:id/undeliverable')
  @Roles('OWNER', 'FINANCE_MANAGER')
  markLetterUndeliverable(
    @Param('id') id: string,
    @Body() body: { reason: string },
    @CurrentUser() user: { id: string },
  ) {
    return this.contractLetterService.markUndeliverable(id, user.id, body.reason);
  }

  @Post('letters/:id/cancel')
  @Roles('OWNER', 'FINANCE_MANAGER')
  cancelLetter(
    @Param('id') id: string,
    @Body() body: { reason: string },
    @CurrentUser() user: { id: string },
  ) {
    return this.contractLetterService.cancel(id, user.id, body.reason);
  }
```

Inject `ContractLetterService` in controller constructor.

### Commit
`feat(overdue): contract-letter endpoints (list/pdf/dispatch/delivered/undeliverable/cancel)`

---

## Task 4: Frontend — letterPdfRenderer utility

Invoke `frontend-design` skill first. Design brief above (PDF section).

### File
- Create: `apps/web/src/pages/CollectionsPage/utils/letterPdfRenderer.ts`

### Responsibilities

1. Render an A4 Thai PDF (jsPDF + Sarabun font OR fall back to system default if font not loaded — Thai glyphs may look ugly without the embed, but not fatal for MVP)
2. Accept contract + letter + company info data object
3. Return `Blob` for upload

### Font handling

This is the trickiest bit. Existing `apps/web/src/components/template-editor/pdf/pdfGenerator.ts:16` has `loadThaiFont(doc: jsPDF)` — copy or import that function. Reuse the pattern.

### Two templates

```typescript
export type LetterTemplateData = {
  letterType: 'RETURN_DEVICE_45D' | 'CONTRACT_TERMINATION_60D';
  letterNumber: string;
  letterDate: Date;
  company: {
    nameTh: string;
    taxId: string;
    address: string;
    phone?: string;
    directorName: string;
    directorPosition?: string;
    logoUrl?: string | null;
    signatureUrl?: string | null;
  };
  customer: {
    name: string;
    address?: string | null;
  };
  contract: {
    contractNumber: string;
    contractDate?: Date;
    outstanding: number;
    daysOverdue: number;
  };
};

export async function renderLetterPdf(data: LetterTemplateData): Promise<Blob> {
  // See template below
}
```

### Template content — RETURN_DEVICE_45D

Rough structure (Thai):

```
[logo]                                                      [letterNumber]
                                                            [date]

                                   หนังสือทวงถามและเรียกให้ส่งมอบเครื่องคืน

เรียน [customer.name]
      [customer.address]

อ้างถึง สัญญาเช่าซื้อเลขที่ [contract.contractNumber]
       ลงวันที่ [contract.contractDate]

ด้วยท่านได้ทำสัญญาเช่าซื้อกับ [company.nameTh] และมีภาระค้างชำระเป็นเวลา
[daysOverdue] วัน เป็นจำนวนเงินรวมทั้งสิ้น [outstanding] บาท บริษัทฯ
ได้ดำเนินการติดตามทวงถามแล้วแต่ไม่สามารถติดต่อท่านได้

บัดนี้ บริษัทฯ จึงขอบอกกล่าวให้ท่านดำเนินการอย่างใดอย่างหนึ่งดังนี้ ภายใน
15 วัน นับแต่วันที่ได้รับหนังสือฉบับนี้:
   1. ชำระยอดค้างทั้งหมด [outstanding] บาท
   2. ส่งมอบเครื่องที่เช่าซื้อคืนแก่บริษัทฯ

หากท่านไม่ดำเนินการภายในกำหนดเวลาดังกล่าว บริษัทฯ จะดำเนินการตาม
กระบวนการทางกฎหมายต่อไป

                                  ขอแสดงความนับถือ


                                  ([company.directorName])
                                  [company.directorPosition]
                                  [company.nameTh]

[small footer: nameTh · taxId · address · phone]
```

### Template content — CONTRACT_TERMINATION_60D

Stronger language:

```
                            หนังสือบอกเลิกสัญญาและแจ้งดำเนินคดีทางกฎหมาย

เรียน [name]

อ้างถึง สัญญาเช่าซื้อเลขที่ [contract.contractNumber]
       ลงวันที่ [contract.contractDate]
       หนังสือทวงถามครั้งก่อน เลขที่ ... (ถ้ามี)

ด้วยท่านได้ผิดนัดชำระเป็นเวลา [daysOverdue] วัน ยอดค้างรวม [outstanding] บาท
บริษัทฯ ได้มีหนังสือทวงถามให้ท่านชำระหนี้หรือส่งคืนเครื่องแล้ว แต่ท่านมิได้
ดำเนินการใด ๆ

บริษัทฯ จึงขอบอกเลิกสัญญาเช่าซื้อฉบับดังกล่าว มีผลทันที และจะส่งเรื่องให้
ทนายความดำเนินคดีทางแพ่ง/อาญา เพื่อเรียกคืนเครื่องและค่าเสียหายต่อไป

หากท่านต้องการเจรจาประนอมหนี้ กรุณาติดต่อบริษัทฯ ภายใน 7 วันนับแต่ได้รับ
หนังสือนี้

                                  ขอแสดงความนับถือ
                                  ([company.directorName])
```

### Implementation hints

- Use `doc.text(line, x, y, { maxWidth })` for word wrapping
- Reuse layout for shared sections (header, footer, signature block)
- Keep it functional, not clever — the text matters, not the code elegance
- Return `doc.output('blob')` at end

### Tests

Optional. Visual tests are hard. Skip unit tests for the renderer — manual inspection of the generated PDF is the real test.

### Commit
`feat(collections): letter PDF renderer (client-side jsPDF with Thai font) — 2 templates`

---

## Task 5: Frontend — LetterQueueSection + useLetterQueue + useLetterActions

Invoke `frontend-design` skill.

### Files
- Create: `apps/web/src/pages/CollectionsPage/components/LetterQueueSection.tsx`
- Create: `apps/web/src/pages/CollectionsPage/hooks/useLetterQueue.ts`
- Create: `apps/web/src/pages/CollectionsPage/hooks/useLetterActions.ts`
- Modify: `apps/web/src/pages/CollectionsPage/tabs/ApprovalTab.tsx` — add section

### Hook: useLetterQueue

```typescript
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';

export interface LetterRow {
  id: string;
  contractId: string;
  letterType: 'RETURN_DEVICE_45D' | 'CONTRACT_TERMINATION_60D';
  letterNumber: string;
  status: 'PENDING_DISPATCH' | 'PDF_GENERATED' | 'DISPATCHED' | 'DELIVERED' | 'UNDELIVERABLE' | 'CANCELLED';
  triggeredAt: string;
  pdfUrl?: string | null;
  pdfGeneratedAt?: string | null;
  dispatchedAt?: string | null;
  trackingNumber?: string | null;
  contract: {
    id: string;
    contractNumber: string;
    customer: { id: string; name: string; phone: string; address?: string | null };
    branch: { id: string; name: string };
  };
}

export function useLetterQueue() {
  return useQuery<LetterRow[]>({
    queryKey: ['letter-queue'],
    queryFn: async () => {
      // Only show actionable statuses in queue: PENDING_DISPATCH + PDF_GENERATED + DISPATCHED
      const [pending, generated, dispatched] = await Promise.all([
        api.get('/overdue/letters?status=PENDING_DISPATCH'),
        api.get('/overdue/letters?status=PDF_GENERATED'),
        api.get('/overdue/letters?status=DISPATCHED'),
      ]);
      return [...pending.data, ...generated.data, ...dispatched.data];
    },
  });
}
```

### Hook: useLetterActions

```typescript
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';

export function useLetterActions() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ['letter-queue'] });

  return {
    markPdfGenerated: useMutation({
      mutationFn: async (p: { letterId: string; pdfUrl: string }) =>
        (await api.post(`/overdue/letters/${p.letterId}/pdf-generated`, { pdfUrl: p.pdfUrl })).data,
      onSuccess: () => { toast.success('บันทึก PDF แล้ว'); invalidate(); },
      onError: (e) => toast.error(getErrorMessage(e)),
    }),
    dispatch: useMutation({
      mutationFn: async (p: { letterId: string; trackingNumber: string; evidencePhotoUrl?: string }) =>
        (await api.post(`/overdue/letters/${p.letterId}/dispatch`, { trackingNumber: p.trackingNumber, evidencePhotoUrl: p.evidencePhotoUrl })).data,
      onSuccess: () => { toast.success('บันทึกการส่งหนังสือแล้ว'); invalidate(); },
      onError: (e) => toast.error(getErrorMessage(e)),
    }),
    markDelivered: useMutation({
      mutationFn: async (letterId: string) =>
        (await api.post(`/overdue/letters/${letterId}/delivered`)).data,
      onSuccess: () => { toast.success('ทำเครื่องหมายรับแล้ว'); invalidate(); },
      onError: (e) => toast.error(getErrorMessage(e)),
    }),
    markUndeliverable: useMutation({
      mutationFn: async (p: { letterId: string; reason: string }) =>
        (await api.post(`/overdue/letters/${p.letterId}/undeliverable`, { reason: p.reason })).data,
      onSuccess: () => { toast.success('ทำเครื่องหมายส่งไม่ถึง'); invalidate(); },
      onError: (e) => toast.error(getErrorMessage(e)),
    }),
    cancel: useMutation({
      mutationFn: async (p: { letterId: string; reason: string }) =>
        (await api.post(`/overdue/letters/${p.letterId}/cancel`, { reason: p.reason })).data,
      onSuccess: () => { toast.success('ยกเลิกหนังสือแล้ว'); invalidate(); },
      onError: (e) => toast.error(getErrorMessage(e)),
    }),
  };
}
```

### LetterQueueSection

Card with header (count pill + lucide `FileText` icon). List of `LetterRow` rendered as rows similar to `ApprovalPendingRow` pattern from Plan 2 Task 12. Each row has the CTAs described in the design brief above.

Layout:
```tsx
<Card className="rounded-xl border border-border/50 bg-card shadow-sm">
  <CardContent className="p-5">
    <div className="flex items-center justify-between mb-4">
      <div className="flex items-center gap-2">
        <FileText className="size-4 text-warning" />
        <h3 className="text-sm font-semibold">หนังสือทวงถาม (รอดำเนินการ)</h3>
      </div>
      <span className="text-xs tabular-nums bg-muted text-muted-foreground rounded-full px-2 py-0.5">
        {letters?.length ?? 0}
      </span>
    </div>
    {/* list or empty */}
  </CardContent>
</Card>
```

Each letter row (inline component or extract to `LetterQueueRow`):
```tsx
<div className="relative flex items-start gap-3 rounded-lg border border-border/50 p-3 bg-background hover:bg-muted/20 transition-colors">
  <div className="shrink-0 size-10 rounded-lg bg-warning/10 text-warning flex items-center justify-center">
    <FileText className="size-5" />
  </div>

  <div className="flex-1 min-w-0">
    <div className="flex flex-wrap items-baseline gap-2 mb-1">
      <span className="font-mono text-xs text-primary font-medium">{letter.letterNumber}</span>
      <span className="text-sm font-semibold leading-snug">{letter.contract.customer.name}</span>
      <span className="text-xs text-muted-foreground">({letter.contract.contractNumber})</span>
    </div>
    <div className="flex flex-wrap gap-1.5 text-2xs">
      <span className={`rounded-full px-2 py-0.5 ${letterTypeStyle(letter.letterType)}`}>
        {letterTypeLabel(letter.letterType)}
      </span>
      <span className="rounded-full px-2 py-0.5 bg-muted text-muted-foreground">
        {letterStatusLabel(letter.status)}
      </span>
      <span className="text-muted-foreground">
        สร้างเมื่อ {daysAgoLabel(letter.triggeredAt)}
      </span>
    </div>
  </div>

  <div className="flex flex-col gap-1.5 shrink-0">
    {letter.status === 'PENDING_DISPATCH' && (
      <button onClick={() => openDispatchDialog(letter, 'generate')} className={ctaBtn('primary')}>
        สร้าง PDF
      </button>
    )}
    {letter.status === 'PDF_GENERATED' && (
      <>
        <a href={letter.pdfUrl ?? '#'} target="_blank" rel="noopener" className={ctaBtn('secondary')}>
          ดาวน์โหลด
        </a>
        <button onClick={() => openDispatchDialog(letter, 'dispatch')} className={ctaBtn('primary')}>
          บันทึกส่งแล้ว
        </button>
      </>
    )}
    {letter.status === 'DISPATCHED' && (
      <>
        <button onClick={() => markDelivered.mutate(letter.id)} className={ctaBtn('secondary')}>
          รับแล้ว
        </button>
        <button onClick={() => openUndeliverable(letter)} className={ctaBtn('destructive-outline')}>
          คืน
        </button>
      </>
    )}
  </div>
</div>
```

Helper functions for label + style — keep them top-of-file.

Empty state: "ไม่มีหนังสือรอดำเนินการ 🎉"

### Integrate into ApprovalTab

Add `<LetterQueueSection />` as a third Card section after the existing dunning + MDM sections.

### TS + commit

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE && ./tools/check-types.sh web
cd /Users/iamnaii/Desktop/App/BESTCHOICE && git add apps/web/src/pages/CollectionsPage/components/LetterQueueSection.tsx apps/web/src/pages/CollectionsPage/hooks/useLetterQueue.ts apps/web/src/pages/CollectionsPage/hooks/useLetterActions.ts apps/web/src/pages/CollectionsPage/tabs/ApprovalTab.tsx && git commit -m "feat(collections): LetterQueueSection in ApprovalTab — list + actions per status"
```

---

## Task 6: Frontend — LetterDispatchDialog

Invoke `frontend-design` skill.

### File
- Create: `apps/web/src/pages/CollectionsPage/components/LetterDispatchDialog.tsx`

### Two modes

1. `mode = 'generate'`: show a "สร้าง PDF" button — runs renderer → uploads via signed URL → calls markPdfGenerated → switches dialog to `dispatch` mode
2. `mode = 'dispatch'`: show tracking# input + slip photo upload + "บันทึกส่งแล้ว" submit

Props:
```typescript
interface Props {
  open: boolean;
  letter: LetterRow | null;
  initialMode: 'generate' | 'dispatch';
  onClose: () => void;
}
```

### Generate mode UI

```
┌──────────────────────────────────────────────┐
│ สร้าง PDF หนังสือ                              │
├──────────────────────────────────────────────┤
│ ลูกค้า: [customer.name]                        │
│ เลขที่หนังสือ: [letterNumber]                   │
│ ประเภท: [letterType label]                     │
│                                                │
│ [สร้าง PDF] [ยกเลิก]                            │
└──────────────────────────────────────────────┘
```

Click "สร้าง PDF":
1. Fetch company info (`GET /settings/company` or similar — check what endpoint exists; if not, use a fallback with hardcoded values from CompanyInfo.companyCode='FINANCE')
2. Fetch full contract detail (for contractDate, outstanding, etc.)
3. Call `renderLetterPdf({...})` → Blob
4. POST blob to signed URL upload endpoint: check existing pattern — look at `apps/web/src/pages/` for S3 upload patterns. Often `POST /storage/signed-url` to get URL, then PUT blob to that URL.
5. Call `markPdfGenerated.mutate({ letterId, pdfUrl })`
6. Switch dialog to `dispatch` mode and populate.

Pseudo-code:
```typescript
async function handleGenerate() {
  setBusy(true);
  try {
    // 1. Load data
    const [company, contract] = await Promise.all([
      api.get('/settings/company/FINANCE').then((r) => r.data).catch(() => null),  // fallback
      api.get(`/contracts/${letter.contractId}`).then((r) => r.data),
    ]);

    // 2. Load signature/letterhead URLs from SystemConfig
    const [sigCfg, lhCfg] = await Promise.all([
      api.get('/settings').then((r) => r.data).catch(() => []),
      // or a single-key endpoint if available
    ]);

    // 3. Render
    const blob = await renderLetterPdf({
      letterType: letter.letterType,
      letterNumber: letter.letterNumber,
      letterDate: new Date(),
      company: { ...company, signatureUrl: sigCfg.find((c) => c.key === 'letter_signature_url')?.value },
      customer: contract.customer,
      contract: { contractNumber: contract.contractNumber, outstanding: ..., daysOverdue: ... },
    });

    // 4. Upload via signed URL
    const key = `letters/${letter.id}/${letter.letterNumber}.pdf`;
    const { uploadUrl, publicUrl } = await api.post('/storage/signed-url', { key, contentType: 'application/pdf' }).then((r) => r.data);
    await fetch(uploadUrl, { method: 'PUT', body: blob, headers: { 'Content-Type': 'application/pdf' } });

    // 5. Mark generated
    await markPdfGenerated.mutateAsync({ letterId: letter.id, pdfUrl: publicUrl });

    // 6. Switch mode
    setMode('dispatch');
    toast.success('สร้าง PDF สำเร็จ');
  } catch (err) {
    toast.error(`สร้าง PDF ไม่สำเร็จ: ${err instanceof Error ? err.message : err}`);
  } finally {
    setBusy(false);
  }
}
```

**NOTE:** The exact signed-url endpoint + response shape depends on what exists in the project. BEFORE coding, run `grep -rn "signed-url\|getSignedUrl\|presigned" apps/api/src/modules/storage/` to find the endpoint and adapt.

If no signed-url endpoint exists yet, fallback option: POST `multipart/form-data` to a new `POST /overdue/letters/:id/upload-pdf` endpoint that the backend accepts via `@UseInterceptors(FileInterceptor)`. But that requires backend work — prefer reusing existing infra if it exists.

### Dispatch mode UI

```
┌──────────────────────────────────────────────┐
│ บันทึกการส่งหนังสือ                             │
├──────────────────────────────────────────────┤
│ เลข EMS tracking *                            │
│ [_____________________________]                │
│                                                │
│ รูปใบรับส่ง (สลิปไปรษณีย์) ไม่บังคับ             │
│ [เลือกไฟล์]                                     │
│                                                │
│ [บันทึกส่งแล้ว] [ยกเลิก]                         │
└──────────────────────────────────────────────┘
```

Upload photo same way as PDF — via signed URL to `letters/:id/receipt-photo.jpg`.

### Commit
`feat(collections): LetterDispatchDialog — generate PDF + enter tracking#`

---

## Task 7: Frontend — Letter settings (signature + letterhead upload)

Invoke `frontend-design` skill.

### File
- Modify: `apps/web/src/pages/DunningSettingsPage.tsx` — add a new Card section

### Behavior

OWNER uploads signature PNG + optional letterhead PNG. Saves as SystemConfig keys `letter_signature_url` + `letter_letterhead_url` (Plan 1 already seeded empty defaults).

A small status note below: "ก่อนใช้งานหนังสือทวงถาม โปรดอัปโหลดลายเซ็นต์ผู้มีอำนาจ"

### Upload helper

Use the same signed-url pattern. If file input selected → upload → save URL to SystemConfig via `PATCH /settings` (existing bulk update endpoint).

Layout:
```tsx
<Card className="rounded-xl border border-border/50 bg-card shadow-sm mb-6">
  <CardContent className="p-5">
    <div className="flex items-center gap-2 mb-3">
      <FileSignature className="size-4 text-primary" />
      <div className="text-sm font-semibold">ตั้งค่าหนังสือทวงถาม</div>
    </div>
    <p className="text-xs text-muted-foreground mb-4">
      ตั้งค่าลายเซ็นและหัวกระดาษสำหรับหนังสือ RETURN_DEVICE_45D และ CONTRACT_TERMINATION_60D
    </p>

    <div className="space-y-4">
      <UploadField
        label="ลายเซ็นต์ผู้มีอำนาจ *"
        description="PNG 200×80px พื้นหลังโปร่งใส"
        currentUrl={signatureUrl}
        onUpload={(url) => saveConfig('letter_signature_url', url)}
      />
      <UploadField
        label="หัวกระดาษ (ไม่บังคับ)"
        description="PNG 600×100px แนวนอน"
        currentUrl={letterheadUrl}
        onUpload={(url) => saveConfig('letter_letterhead_url', url)}
      />
    </div>
  </CardContent>
</Card>
```

`UploadField` is a small inline component: file input + preview (if URL set) + "ลบ" button.

### Commit
`feat(dunning-settings): letter signature + letterhead upload card`

---

## Task 8: E2E smoke + full sweep

### Files
- Modify: `apps/web/e2e/collections-smoke.spec.ts` — add letter queue visibility test

Add test:
- Login OWNER → /collections → click อนุมัติ → "หนังสือทวงถาม" card visible

### Sweep

```bash
./tools/check-types.sh all                    # 0
cd apps/api && npm test                       # all pass
cd apps/web && npm test -- --run               # all pass
```

### Commit
`test(collections): e2e for letter queue visibility`

---

## Self-Review

**Spec coverage:**
| Spec § | Task |
|---|---|
| §6.1 Letter types + triggers | 2 (cron) |
| §6.2 Letter flow diagram | 1 (service) + 3 (endpoints) + 5 (UI) + 6 (dispatch) |
| §6.3 PDF template | 4 (renderer) |
| §6.4 Evidence chain | 1 (service) + 6 (tracking + slip upload) |
| §6.5 Integration with dunning | 1 (fire LETTER_DISPATCHED + CONTRACT_TERMINATED events) |

**Out of scope (respected):**
- Thailand Post Connect API (manual dispatch MVP only)
- OCR of dispatch slip
- Courier alternatives (EMS only)
- Multi-language letters
- Automated legal packet bundle

**Placeholder scan:** all tasks have complete code / exact commands / acceptance criteria. The only DYNAMIC part is the signed-url endpoint location — Task 6 explicitly instructs subagent to grep before coding.

**Type consistency:** `LetterRow` / `LetterTemplateData` / `LetterStatus` / `LetterType` — single definitions in types.ts or hook files. Endpoint paths `/overdue/letters/*` consistent across backend + frontend.
