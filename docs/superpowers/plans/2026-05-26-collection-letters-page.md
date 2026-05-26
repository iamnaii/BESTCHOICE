# Collection Letters Management Page (`/letters`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** สร้างหน้า `/letters` สำหรับ back-office จัดการ lifecycle จดหมายแจ้งเตือน/ยกเลิกสัญญา พร้อม bulk print + bulk dispatch + tracking# capture + Excel export

**Architecture:** Backend ขยาย list endpoint (pagination/search/branch scope) + เพิ่ม bulk dispatch endpoint atomic + รับ `pdfUrl` optional. Frontend สร้างหน้าใหม่ที่ reuse orphan components (`LetterDispatchDialog`, `LetterPdfPreviewDialog`) + hook `useLetterActions` ที่มีอยู่แล้ว + refactor `letterPdfRenderer` ให้ expose jsPDF doc สำหรับ bulk merge

**Tech Stack:** NestJS + Prisma + PostgreSQL (backend) · React 18 + Vite + TanStack Query + shadcn/ui + jsPDF + exceljs (frontend) · Playwright (E2E) · Jest + Vitest

**Spec:** [`docs/superpowers/specs/2026-05-26-collection-letters-page-design.md`](../specs/2026-05-26-collection-letters-page-design.md)

---

## File Map

### Backend (`apps/api/src/`)

| File | Action | Purpose |
|---|---|---|
| `modules/overdue/dto/bulk-dispatch-letters.dto.ts` | **Create** | Validated DTO for bulk dispatch endpoint |
| `modules/overdue/contract-letter.service.ts` | **Modify** | Add pagination/search/branchId-via-util + `bulkDispatch()` + accept null pdfUrl |
| `modules/overdue/overdue.controller.ts` | **Modify** | Extend list params + new bulk endpoint + expand @Roles |
| `modules/overdue/__tests__/contract-letter.service.spec.ts` | **Create or extend** | Service unit tests |

### Frontend (`apps/web/src/`)

| File | Action | Purpose |
|---|---|---|
| `pages/CollectionsPage/utils/letterPdfRenderer.ts` | **Modify** | Expose `renderLetterPdfDoc(): jsPDF` + keep `renderLetterPdf(): Blob` wrapper |
| `pages/CollectionsPage/utils/buildLetterTemplateData.ts` | **Create** | Extract data-prep logic from LetterDispatchDialog — reused by bulk print |
| `pages/CollectionsPage/components/LetterDispatchDialog.tsx` | **Modify** | Use `buildLetterTemplateData` util |
| `pages/CollectionsPage/hooks/useLetterQueue.ts` | **Delete** | Orphan, superseded by `useLettersList` |
| `pages/LettersPage/index.tsx` | **Create** | Page entry — tab state + filter state + compose |
| `pages/LettersPage/types.ts` | **Create** | Shared TS types (`LetterStatus`, `LetterRow`, etc.) |
| `pages/LettersPage/components/LetterTabs.tsx` | **Create** | 5 status tabs + counts |
| `pages/LettersPage/components/LetterFiltersBar.tsx` | **Create** | Search + branch + type + date range filters |
| `pages/LettersPage/components/LetterTable.tsx` | **Create** | Row list + checkbox + per-row actions |
| `pages/LettersPage/components/LetterBulkActionsBar.tsx` | **Create** | Sticky bottom bar |
| `pages/LettersPage/components/BulkPrintDialog.tsx` | **Create** | Multi-page PDF preview + Download/Print + auto-mark |
| `pages/LettersPage/components/BulkDispatchDialog.tsx` | **Create** | Per-row tracking# input + bulk POST |
| `pages/LettersPage/components/ExportExcelButton.tsx` | **Create** | Export filtered view → .xlsx |
| `pages/LettersPage/hooks/useLettersList.ts` | **Create** | Wraps `useQuery` with filters |
| `pages/LettersPage/hooks/useBulkDispatch.ts` | **Create** | Wraps `useMutation` for bulk endpoint |
| `pages/LettersPage/utils/mergeLetterPdfs.ts` | **Create** | Loop `renderLetterPdfDoc` + addPage |
| `pages/LettersPage/utils/lettersToExcel.ts` | **Create** | exceljs workbook builder + Blob download |
| `pages/LettersPage/__tests__/mergeLetterPdfs.test.ts` | **Create** | Vitest unit test |
| `pages/LettersPage/__tests__/lettersToExcel.test.ts` | **Create** | Vitest unit test |
| `pages/LettersPage/__tests__/useLettersList.test.ts` | **Create** | Vitest hook test |
| `App.tsx` | **Modify** | Register `/letters` route with `ProtectedRoute` |
| `config/menu.ts` | **Modify** | Add menu entry in 5 role configs |

### E2E (`apps/web/e2e/`)

| File | Action | Purpose |
|---|---|---|
| `letters-page.spec.ts` | **Create** | Full page golden path + role visibility |

---

## Phase 1 — Backend

### Task 1: Create `BulkDispatchLettersDto`

**Files:**
- Create: `apps/api/src/modules/overdue/dto/bulk-dispatch-letters.dto.ts`

- [ ] **Step 1: Create DTO file**

```ts
// apps/api/src/modules/overdue/dto/bulk-dispatch-letters.dto.ts
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsOptional,
  IsString,
  IsUUID,
  IsUrl,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class BulkDispatchItemDto {
  @IsUUID('4', { message: 'รหัสจดหมายไม่ถูกต้อง' })
  id!: string;

  @IsString({ message: 'กรุณาระบุเลข tracking' })
  @MinLength(5, { message: 'เลข tracking ต้องมีอย่างน้อย 5 ตัวอักษร' })
  trackingNumber!: string;

  @IsOptional()
  @IsUrl({}, { message: 'URL หลักฐานไม่ถูกต้อง' })
  evidencePhotoUrl?: string;
}

export class BulkDispatchLettersDto {
  @ValidateNested({ each: true })
  @Type(() => BulkDispatchItemDto)
  @ArrayMinSize(1, { message: 'ต้องเลือกอย่างน้อย 1 ฉบับ' })
  @ArrayMaxSize(50, { message: 'ส่งครั้งละไม่เกิน 50 ฉบับ' })
  items!: BulkDispatchItemDto[];
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/api/src/modules/overdue/dto/bulk-dispatch-letters.dto.ts
git commit -m "feat(letters): add BulkDispatchLettersDto"
```

---

### Task 2: Modify `ContractLetterService.list()` — pagination + search + branch scope

**Files:**
- Modify: `apps/api/src/modules/overdue/contract-letter.service.ts` (replace `list()` method)

- [ ] **Step 1: Write the failing test (extend existing spec or create)**

```ts
// apps/api/src/modules/overdue/__tests__/contract-letter.service.spec.ts
import { Test } from '@nestjs/testing';
import { ContractLetterService } from '../contract-letter.service';
import { PrismaService } from '../../../prisma/prisma.service';

describe('ContractLetterService.list (v2)', () => {
  let service: ContractLetterService;
  let prisma: PrismaService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        ContractLetterService,
        {
          provide: PrismaService,
          useValue: {
            contractLetter: {
              findMany: jest.fn().mockResolvedValue([]),
              count: jest.fn().mockResolvedValue(0),
            },
          },
        },
      ],
    }).compile();
    service = module.get(ContractLetterService);
    prisma = module.get(PrismaService);
  });

  it('returns paginated shape { data, total, page, limit }', async () => {
    const result = await service.list({ page: 1, limit: 50, user: { role: 'OWNER', branchId: null } });
    expect(result).toEqual({ data: [], total: 0, page: 1, limit: 50 });
  });

  it('applies branch scope for SALES role', async () => {
    await service.list({ page: 1, limit: 50, user: { role: 'SALES', branchId: 'branch-1' } });
    const findManyCall = (prisma.contractLetter.findMany as jest.Mock).mock.calls[0][0];
    expect(findManyCall.where.contract.branchId).toBe('branch-1');
  });

  it('builds OR search clause for q param', async () => {
    await service.list({ page: 1, limit: 50, q: 'สมชาย', user: { role: 'OWNER', branchId: null } });
    const findManyCall = (prisma.contractLetter.findMany as jest.Mock).mock.calls[0][0];
    expect(findManyCall.where.OR).toHaveLength(3);
    expect(findManyCall.where.OR[0]).toEqual({ letterNumber: { contains: 'สมชาย', mode: 'insensitive' } });
  });

  it('returns empty when SALES has no branchId', async () => {
    const result = await service.list({ page: 1, limit: 50, user: { role: 'SALES', branchId: null } });
    expect(result).toEqual({ data: [], total: 0, page: 1, limit: 50 });
    expect(prisma.contractLetter.findMany).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE/apps/api && npx jest src/modules/overdue/__tests__/contract-letter.service.spec.ts -t "list (v2)"
```

Expected: FAIL — old signature doesn't accept `page/limit/user/q` and returns array not object

- [ ] **Step 3: Implement new `list()` signature**

Replace existing `list()` method at [contract-letter.service.ts:83](../../apps/api/src/modules/overdue/contract-letter.service.ts#L83):

```ts
import { getBranchScope } from '../../modules/auth/branch-access.util';
import type { LetterStatus, LetterType, Prisma } from '@prisma/client';

async list(params: {
  status?: LetterStatus;
  letterType?: LetterType;
  branchId?: string;
  from?: string;
  to?: string;
  q?: string;
  page?: number;
  limit?: number;
  user?: { role?: string | null; branchId?: string | null };
}): Promise<{
  data: Awaited<ReturnType<typeof this.prisma.contractLetter.findMany>>;
  total: number;
  page: number;
  limit: number;
}> {
  const page = Math.max(1, params.page ?? 1);
  const limit = Math.min(200, Math.max(1, params.limit ?? 50));

  const scope = getBranchScope(params.user);
  if (!scope.all && !scope.branchId) {
    return { data: [], total: 0, page, limit };
  }

  const effectiveBranchId = !scope.all ? scope.branchId! : params.branchId;

  const where: Prisma.ContractLetterWhereInput = {
    deletedAt: null,
    ...(params.status && { status: params.status }),
    ...(params.letterType && { letterType: params.letterType }),
    ...((params.from || params.to) && {
      triggeredAt: {
        ...(params.from && { gte: new Date(params.from) }),
        ...(params.to && { lte: new Date(params.to) }),
      },
    }),
    ...(effectiveBranchId && {
      contract: { branchId: effectiveBranchId },
    }),
    ...(params.q && {
      OR: [
        { letterNumber: { contains: params.q, mode: 'insensitive' as const } },
        { contract: { contractNumber: { contains: params.q, mode: 'insensitive' as const } } },
        { contract: { customer: { name: { contains: params.q, mode: 'insensitive' as const } } } },
      ],
    }),
  };

  const [data, total] = await Promise.all([
    this.prisma.contractLetter.findMany({
      where,
      include: {
        contract: {
          select: {
            id: true,
            contractNumber: true,
            customer: { select: { id: true, name: true, phone: true, addressCurrent: true } },
            branch: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: { triggeredAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    this.prisma.contractLetter.count({ where }),
  ]);

  return { data, total, page, limit };
}
```

- [ ] **Step 4: Run tests to verify pass**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE/apps/api && npx jest src/modules/overdue/__tests__/contract-letter.service.spec.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/overdue/contract-letter.service.ts \
        apps/api/src/modules/overdue/__tests__/contract-letter.service.spec.ts
git commit -m "feat(letters): list endpoint — pagination + search + branch scope util"
```

---

### Task 3: Make `pdfUrl` optional in `markPdfGenerated`

**Files:**
- Modify: `apps/api/src/modules/overdue/contract-letter.service.ts:113`
- Modify: `apps/api/src/modules/overdue/overdue.controller.ts:539-547`

- [ ] **Step 1: Add test**

Append to `contract-letter.service.spec.ts`:

```ts
describe('markPdfGenerated', () => {
  it('accepts null pdfUrl', async () => {
    const prismaMock = {
      contractLetter: {
        findFirst: jest.fn().mockResolvedValue({ id: 'l1', status: 'PENDING_DISPATCH' }),
        update: jest.fn().mockResolvedValue({ id: 'l1' }),
      },
      auditLog: { create: jest.fn() },
      $transaction: jest.fn((ops) => Promise.all(ops.map((op: any) => op))),
    };
    const svc = new ContractLetterService(prismaMock as any);
    await svc.markPdfGenerated('l1', null, 'user-1');
    const updateCall = prismaMock.contractLetter.update.mock.calls[0][0];
    expect(updateCall.data.pdfUrl).toBeNull();
    expect(updateCall.data.status).toBe('PDF_GENERATED');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/api && npx jest src/modules/overdue/__tests__/contract-letter.service.spec.ts -t "accepts null pdfUrl"
```

Expected: FAIL — TS may complain that pdfUrl is `string` not `string | null`

- [ ] **Step 3: Update service signature**

In `contract-letter.service.ts:113`:

```ts
async markPdfGenerated(letterId: string, pdfUrl: string | null, userId: string) {
  const letter = await this.prisma.contractLetter.findFirst({
    where: { id: letterId, deletedAt: null },
  });
  if (!letter) throw new NotFoundException('ไม่พบหนังสือ');
  if (letter.status !== 'PENDING_DISPATCH') {
    throw new BadRequestException('สถานะไม่ถูกต้อง — ต้องอยู่ในสถานะ PENDING_DISPATCH');
  }
  return this.prisma
    .$transaction([
      this.prisma.contractLetter.update({
        where: { id: letterId },
        data: { status: 'PDF_GENERATED', pdfUrl: pdfUrl ?? null, pdfGeneratedAt: new Date() },
      }),
      this.prisma.auditLog.create({
        data: {
          userId,
          action: 'LETTER_PDF_GENERATED',
          entity: 'contract_letter',
          entityId: letterId,
          newValue: { pdfUrl },
        },
      }),
    ])
    .then(([l]) => l);
}
```

- [ ] **Step 4: Update controller to make body optional**

In `overdue.controller.ts:539`:

```ts
@Post('letters/:id/pdf-generated')
@Roles('OWNER', 'FINANCE_MANAGER', 'BRANCH_MANAGER', 'ACCOUNTANT', 'SALES')
markPdfGenerated(
  @Param('id') id: string,
  @Body() body: { pdfUrl?: string | null },
  @CurrentUser() user: { id: string },
) {
  return this.contractLetterService.markPdfGenerated(id, body.pdfUrl ?? null, user.id);
}
```

- [ ] **Step 5: Run test, verify pass**

```bash
cd apps/api && npx jest src/modules/overdue/__tests__/contract-letter.service.spec.ts
```

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/overdue/contract-letter.service.ts \
        apps/api/src/modules/overdue/overdue.controller.ts \
        apps/api/src/modules/overdue/__tests__/contract-letter.service.spec.ts
git commit -m "feat(letters): make pdfUrl optional in markPdfGenerated (client-rendered PDFs)"
```

---

### Task 4: Add `bulkDispatch()` service method

**Files:**
- Modify: `apps/api/src/modules/overdue/contract-letter.service.ts`
- Modify: `apps/api/src/modules/overdue/__tests__/contract-letter.service.spec.ts`

- [ ] **Step 1: Write tests**

Append:

```ts
describe('bulkDispatch', () => {
  const makePrismaMock = (letters: any[]) => ({
    contractLetter: {
      findMany: jest.fn().mockResolvedValue(letters),
      update: jest.fn((args) => Promise.resolve({ id: args.where.id, ...args.data })),
    },
    auditLog: { create: jest.fn() },
    $transaction: jest.fn((ops) => Promise.all(ops.map((op: any) => op))),
  });

  it('rejects whole batch if any letter has wrong status', async () => {
    const prismaMock = makePrismaMock([
      { id: 'l1', status: 'PDF_GENERATED' },
      { id: 'l2', status: 'PENDING_DISPATCH' }, // wrong
    ]);
    const svc = new ContractLetterService(prismaMock as any);

    await expect(
      svc.bulkDispatch(
        [
          { id: 'l1', trackingNumber: 'EM123456789TH' },
          { id: 'l2', trackingNumber: 'EM123456790TH' },
        ],
        'user-1',
      ),
    ).rejects.toThrow(/สถานะไม่ถูกต้อง/);
    expect(prismaMock.contractLetter.update).not.toHaveBeenCalled();
  });

  it('rejects if any id not found', async () => {
    const prismaMock = makePrismaMock([{ id: 'l1', status: 'PDF_GENERATED' }]);
    const svc = new ContractLetterService(prismaMock as any);
    await expect(
      svc.bulkDispatch(
        [
          { id: 'l1', trackingNumber: 'EM111111111TH' },
          { id: 'missing', trackingNumber: 'EM222222222TH' },
        ],
        'user-1',
      ),
    ).rejects.toThrow(/ไม่พบ/);
  });

  it('updates all + audit logs share batchId on success', async () => {
    const prismaMock = makePrismaMock([
      { id: 'l1', status: 'PDF_GENERATED' },
      { id: 'l2', status: 'PDF_GENERATED' },
    ]);
    const svc = new ContractLetterService(prismaMock as any);
    const result = await svc.bulkDispatch(
      [
        { id: 'l1', trackingNumber: 'EM111111111TH' },
        { id: 'l2', trackingNumber: 'EM222222222TH' },
      ],
      'user-1',
    );

    expect(result.batchId).toMatch(/^[0-9a-f-]{36}$/);
    expect(prismaMock.contractLetter.update).toHaveBeenCalledTimes(2);
    expect(prismaMock.auditLog.create).toHaveBeenCalledTimes(2);
    const auditCalls = (prismaMock.auditLog.create as jest.Mock).mock.calls;
    expect(auditCalls[0][0].data.metadata.batchId).toBe(result.batchId);
    expect(auditCalls[1][0].data.metadata.batchId).toBe(result.batchId);
  });
});
```

- [ ] **Step 2: Run, verify FAIL**

```bash
cd apps/api && npx jest src/modules/overdue/__tests__/contract-letter.service.spec.ts -t bulkDispatch
```

Expected: FAIL — `bulkDispatch` undefined

- [ ] **Step 3: Implement**

Append to `contract-letter.service.ts`:

```ts
import { randomUUID } from 'crypto';

async bulkDispatch(
  items: Array<{ id: string; trackingNumber: string; evidencePhotoUrl?: string }>,
  userId: string,
): Promise<{ updated: Array<{ id: string }>; batchId: string }> {
  if (items.length === 0) {
    throw new BadRequestException('ต้องเลือกอย่างน้อย 1 ฉบับ');
  }

  const ids = items.map((i) => i.id);
  const letters = await this.prisma.contractLetter.findMany({
    where: { id: { in: ids }, deletedAt: null },
    select: { id: true, status: true },
  });

  if (letters.length !== ids.length) {
    const found = new Set(letters.map((l) => l.id));
    const missing = ids.filter((id) => !found.has(id));
    throw new BadRequestException(`ไม่พบจดหมาย: ${missing.join(', ')}`);
  }

  const invalidStatus = letters.filter((l) => l.status !== 'PDF_GENERATED');
  if (invalidStatus.length > 0) {
    throw new BadRequestException(
      `สถานะไม่ถูกต้อง — ต้อง PDF_GENERATED: ${invalidStatus.map((l) => l.id).join(', ')}`,
    );
  }

  const batchId = randomUUID();
  const now = new Date();

  const ops = items.flatMap((item) => [
    this.prisma.contractLetter.update({
      where: { id: item.id },
      data: {
        status: 'DISPATCHED' as const,
        dispatchedAt: now,
        dispatchedById: userId,
        trackingNumber: item.trackingNumber.trim(),
        evidencePhotoUrl: item.evidencePhotoUrl ?? null,
      },
    }),
    this.prisma.auditLog.create({
      data: {
        userId,
        action: 'LETTER_DISPATCHED',
        entity: 'contract_letter',
        entityId: item.id,
        newValue: { trackingNumber: item.trackingNumber },
        metadata: { batchId, source: 'bulk' },
      },
    }),
  ]);

  const results = (await this.prisma.$transaction(ops)) as Array<{ id: string }>;
  const updated = results.filter((_, idx) => idx % 2 === 0);
  return { updated, batchId };
}
```

- [ ] **Step 4: Run tests**

```bash
cd apps/api && npx jest src/modules/overdue/__tests__/contract-letter.service.spec.ts -t bulkDispatch
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/overdue/contract-letter.service.ts \
        apps/api/src/modules/overdue/__tests__/contract-letter.service.spec.ts
git commit -m "feat(letters): add atomic bulkDispatch service method"
```

---

### Task 5: Add controller endpoints — extend `listLetters` + `bulkDispatchLetters` + role expansion

**Files:**
- Modify: `apps/api/src/modules/overdue/overdue.controller.ts:523-610`

- [ ] **Step 1: Replace `listLetters` and add bulk endpoint**

Replace lines 525-537 with:

```ts
@Get('letters')
@Roles('OWNER', 'FINANCE_MANAGER', 'BRANCH_MANAGER', 'ACCOUNTANT', 'SALES')
listLetters(
  @Query('status') status?: string,
  @Query('letterType') letterType?: string,
  @Query('branchId') branchId?: string,
  @Query('from') from?: string,
  @Query('to') to?: string,
  @Query('q') q?: string,
  @Query('page') page?: string,
  @Query('limit') limit?: string,
  @CurrentUser() user?: { role: string; branchId: string | null },
) {
  return this.contractLetterService.list({
    status: status as any,
    letterType: letterType as any,
    branchId,
    from,
    to,
    q,
    page: page ? parseInt(page, 10) : undefined,
    limit: limit ? parseInt(limit, 10) : undefined,
    user,
  });
}
```

Add new bulk endpoint after the single dispatch endpoint (~line 557, before `markLetterDelivered`):

```ts
@Post('letters/bulk/dispatch')
@Roles('OWNER', 'FINANCE_MANAGER', 'BRANCH_MANAGER', 'ACCOUNTANT', 'SALES')
bulkDispatchLetters(
  @Body() dto: BulkDispatchLettersDto,
  @CurrentUser() user: { id: string },
) {
  return this.contractLetterService.bulkDispatch(dto.items, user.id);
}
```

Add import at top:

```ts
import { BulkDispatchLettersDto } from './dto/bulk-dispatch-letters.dto';
```

- [ ] **Step 2: Expand `@Roles` on existing letter endpoints**

Update the following endpoint decorators in `overdue.controller.ts`:

```ts
// letters/:id/dispatch
@Roles('OWNER', 'FINANCE_MANAGER', 'BRANCH_MANAGER', 'ACCOUNTANT', 'SALES')

// letters/:id/delivered
@Roles('OWNER', 'FINANCE_MANAGER', 'BRANCH_MANAGER', 'ACCOUNTANT', 'SALES')

// letters/:id/evidence
@Roles('OWNER', 'FINANCE_MANAGER', 'BRANCH_MANAGER', 'ACCOUNTANT', 'SALES')

// letters/:id/undeliverable
@Roles('OWNER', 'FINANCE_MANAGER', 'BRANCH_MANAGER', 'ACCOUNTANT', 'SALES')

// letters/:id/revert-undeliverable — already has BM; add ACC + SALES
@Roles('OWNER', 'FINANCE_MANAGER', 'BRANCH_MANAGER', 'ACCOUNTANT', 'SALES')

// letters/:id/cancel — DO NOT EXPAND beyond OWNER/FM/BM
@Roles('OWNER', 'FINANCE_MANAGER', 'BRANCH_MANAGER')
```

- [ ] **Step 3: Write controller test (extend overdue.controller.spec.ts if exists)**

```ts
// apps/api/src/modules/overdue/__tests__/overdue.controller.spec.ts
// add new describe block:
describe('letters/bulk/dispatch', () => {
  it('accepts valid payload from SALES role', async () => {
    // mock contractLetterService.bulkDispatch
    // call controller method with DTO
    // assert service method called
  });
  it('rejects empty items array (DTO validation)', async () => {
    // expect ValidationPipe to throw
  });
});
```

(Full mock setup follows existing controller test pattern in `apps/api/src/modules/overdue/__tests__/`)

- [ ] **Step 4: Run tests + type check**

```bash
cd apps/api && npx jest src/modules/overdue/ && cd .. && ./tools/check-types.sh api
```

Expected: PASS + 0 type errors

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/overdue/overdue.controller.ts \
        apps/api/src/modules/overdue/__tests__/
git commit -m "feat(letters): bulk dispatch endpoint + role expansion (cancel stays OWNER/FM/BM)"
```

---

## Phase 2 — Frontend Foundation (Refactor + Hooks + Utils)

### Task 6: Refactor `letterPdfRenderer` to expose jsPDF doc

**Files:**
- Modify: `apps/web/src/pages/CollectionsPage/utils/letterPdfRenderer.ts:420`

- [ ] **Step 1: Read existing `renderLetterPdf` (line 420)**

Identify the body (it returns `doc.output('blob')` at the end after building the doc).

- [ ] **Step 2: Split into `renderLetterPdfDoc` + wrapper**

Replace `export async function renderLetterPdf(data: LetterTemplateData): Promise<Blob> { ... }` with:

```ts
/**
 * Build a jsPDF document for a single letter. Caller owns the returned doc —
 * useful for bulk merging (caller does `doc.addPage()` between letters).
 */
export async function renderLetterPdfDoc(data: LetterTemplateData): Promise<jsPDF> {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  await loadThaiFont(doc);
  // ... ALL existing body of renderLetterPdf EXCEPT the final `return doc.output('blob')` ...
  return doc;
}

/**
 * Wrapper that renders a single letter and returns a Blob — preserves the
 * original API used by per-row preview.
 */
export async function renderLetterPdf(data: LetterTemplateData): Promise<Blob> {
  const doc = await renderLetterPdfDoc(data);
  return doc.output('blob');
}
```

(Move the entire body of the original `renderLetterPdf` into `renderLetterPdfDoc`, dropping the final `return doc.output('blob')` line; instead return `doc`.)

- [ ] **Step 3: Type check + run existing tests**

```bash
cd apps/web && npm run typecheck && npx vitest run
```

Expected: 0 type errors + existing tests still pass

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/CollectionsPage/utils/letterPdfRenderer.ts
git commit -m "refactor(letters): expose renderLetterPdfDoc for bulk merge use"
```

---

### Task 7: Create `mergeLetterPdfs` util

**Files:**
- Create: `apps/web/src/pages/LettersPage/utils/mergeLetterPdfs.ts`
- Create: `apps/web/src/pages/LettersPage/__tests__/mergeLetterPdfs.test.ts`

- [ ] **Step 1: Write test**

```ts
// apps/web/src/pages/LettersPage/__tests__/mergeLetterPdfs.test.ts
import { describe, it, expect, vi } from 'vitest';
import { jsPDF } from 'jspdf';
import { mergeLetterPdfs } from '../utils/mergeLetterPdfs';

vi.mock('@/pages/CollectionsPage/utils/letterPdfRenderer', () => ({
  renderLetterPdfDoc: vi.fn(async () => {
    const doc = new jsPDF();
    doc.text('test', 10, 10);
    return doc;
  }),
}));

describe('mergeLetterPdfs', () => {
  it('returns a single Blob containing all letters', async () => {
    const blob = await mergeLetterPdfs([
      { letterNumber: 'A', customerName: 'x' } as any,
      { letterNumber: 'B', customerName: 'y' } as any,
      { letterNumber: 'C', customerName: 'z' } as any,
    ]);
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('application/pdf');
    expect(blob.size).toBeGreaterThan(0);
  });

  it('throws if items array is empty', async () => {
    await expect(mergeLetterPdfs([])).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run, verify FAIL**

```bash
cd apps/web && npx vitest run src/pages/LettersPage/__tests__/mergeLetterPdfs.test.ts
```

- [ ] **Step 3: Implement util**

```ts
// apps/web/src/pages/LettersPage/utils/mergeLetterPdfs.ts
import { renderLetterPdfDoc, type LetterTemplateData } from '@/pages/CollectionsPage/utils/letterPdfRenderer';

/**
 * Render multiple letters and merge into a single multi-page PDF Blob.
 * Internally builds one jsPDF doc and copies pages from subsequent docs.
 */
export async function mergeLetterPdfs(items: LetterTemplateData[]): Promise<Blob> {
  if (items.length === 0) {
    throw new Error('mergeLetterPdfs: items must not be empty');
  }

  const baseDoc = await renderLetterPdfDoc(items[0]);

  for (let i = 1; i < items.length; i++) {
    const nextDoc = await renderLetterPdfDoc(items[i]);
    const pageCount = nextDoc.getNumberOfPages();
    for (let p = 1; p <= pageCount; p++) {
      baseDoc.addPage();
      nextDoc.setPage(p);
      const pageData = nextDoc.internal.pages[p];
      // jsPDF page copy: write internal page contents to base
      // simplest approach: re-render page-level content. For now,
      // since each letter is single-page, addPage + re-execute renderer
      // call already produced the content in nextDoc — we capture via
      // setPage then copy operators via getPageInfo
      baseDoc.setPage(baseDoc.getNumberOfPages());
      // For typical single-page letters, just import as raw operator stream:
      const ops = (nextDoc as any).internal.pages[p].join('\n');
      (baseDoc as any).internal.pages[baseDoc.getNumberOfPages()] = ops.split('\n');
    }
  }

  return baseDoc.output('blob');
}
```

**Note:** jsPDF doesn't have a native multi-doc merge API. If the operator-copy approach fails in test, fallback strategy = render each letter as separate file in a downloaded ZIP (`jszip` dependency). Implementation may need iteration — confirm in real browser.

- [ ] **Step 4: Run test**

```bash
cd apps/web && npx vitest run src/pages/LettersPage/__tests__/mergeLetterPdfs.test.ts
```

Expected: PASS (Blob produced)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/LettersPage/utils/mergeLetterPdfs.ts \
        apps/web/src/pages/LettersPage/__tests__/mergeLetterPdfs.test.ts
git commit -m "feat(letters): mergeLetterPdfs util for bulk print"
```

---

### Task 8: Create `lettersToExcel` util

**Files:**
- Create: `apps/web/src/pages/LettersPage/utils/lettersToExcel.ts`
- Create: `apps/web/src/pages/LettersPage/__tests__/lettersToExcel.test.ts`

- [ ] **Step 1: Write test**

```ts
// apps/web/src/pages/LettersPage/__tests__/lettersToExcel.test.ts
import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { lettersToExcel } from '../utils/lettersToExcel';

const sampleLetters = [
  {
    id: 'l1',
    letterNumber: 'ST-2026-00001',
    letterType: 'RETURN_DEVICE_45D',
    status: 'DISPATCHED',
    triggeredAt: '2026-05-20T08:00:00Z',
    pdfGeneratedAt: '2026-05-20T09:00:00Z',
    dispatchedAt: '2026-05-21T10:00:00Z',
    trackingNumber: 'EM123456789TH',
    deliveredAt: null,
    cancelReason: null,
    dispatchedBy: { name: 'admin' },
    contract: {
      contractNumber: 'C-2025-101',
      customer: { name: 'สมชาย' },
      branch: { name: 'ลาดพร้าว' },
    },
  },
] as any;

describe('lettersToExcel', () => {
  it('produces a workbook with 1 sheet and correct headers', async () => {
    const blob = await lettersToExcel(sampleLetters);
    expect(blob).toBeInstanceOf(Blob);
    const buffer = await blob.arrayBuffer();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const sheet = wb.worksheets[0];
    expect(sheet.name).toBe('Letters');
    const headerRow = sheet.getRow(1).values as string[];
    expect(headerRow).toContain('เลขจดหมาย');
    expect(headerRow).toContain('Tracking No.');
  });

  it('writes Thai-format dates', async () => {
    const blob = await lettersToExcel(sampleLetters);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await blob.arrayBuffer());
    const sheet = wb.worksheets[0];
    const dataRow = sheet.getRow(2).values as any[];
    // dispatchedAt should be formatted as Thai date (DD/MM/YYYY BKK)
    const dispatchedCell = dataRow.find((v) => typeof v === 'string' && /\d{2}\/\d{2}\/\d{4}/.test(v));
    expect(dispatchedCell).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run, verify FAIL**

```bash
cd apps/web && npx vitest run src/pages/LettersPage/__tests__/lettersToExcel.test.ts
```

- [ ] **Step 3: Implement**

```ts
// apps/web/src/pages/LettersPage/utils/lettersToExcel.ts
import ExcelJS from 'exceljs';

type LetterRow = {
  id: string;
  letterNumber: string;
  letterType: string;
  status: string;
  triggeredAt: string | null;
  pdfGeneratedAt: string | null;
  dispatchedAt: string | null;
  trackingNumber: string | null;
  deliveredAt: string | null;
  cancelReason: string | null;
  dispatchedBy?: { name: string } | null;
  contract: {
    contractNumber: string;
    customer: { name: string };
    branch: { name: string };
  };
};

const LETTER_TYPE_TH: Record<string, string> = {
  RETURN_DEVICE_45D: 'เก็บอุปกรณ์ 45 วัน',
  CONTRACT_TERMINATION_60D: 'บอกเลิกสัญญา 60 วัน',
};

const STATUS_TH: Record<string, string> = {
  PENDING_DISPATCH: 'รอพิมพ์',
  PDF_GENERATED: 'พิมพ์แล้ว',
  DISPATCHED: 'ส่งแล้ว',
  DELIVERED: 'ลูกค้ารับแล้ว',
  UNDELIVERABLE: 'ตีกลับ',
  CANCELLED: 'ยกเลิก',
};

const formatBkkDate = (iso: string | null): string => {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('th-TH-u-ca-gregory', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: 'Asia/Bangkok',
  });
};

export async function lettersToExcel(letters: LetterRow[]): Promise<Blob> {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Letters');

  sheet.columns = [
    { header: 'เลขจดหมาย', key: 'letterNumber', width: 18 },
    { header: 'เลขสัญญา', key: 'contractNumber', width: 16 },
    { header: 'ชื่อลูกค้า', key: 'customerName', width: 24 },
    { header: 'สาขา', key: 'branch', width: 14 },
    { header: 'ประเภท', key: 'letterType', width: 22 },
    { header: 'สถานะ', key: 'status', width: 14 },
    { header: 'สร้างเมื่อ', key: 'triggeredAt', width: 14 },
    { header: 'พิมพ์เมื่อ', key: 'pdfGeneratedAt', width: 14 },
    { header: 'ส่งเมื่อ', key: 'dispatchedAt', width: 14 },
    { header: 'Tracking No.', key: 'trackingNumber', width: 18 },
    { header: 'ลูกค้ารับเมื่อ', key: 'deliveredAt', width: 14 },
    { header: 'เหตุผลตีกลับ/ยกเลิก', key: 'cancelReason', width: 24 },
    { header: 'ผู้ส่ง', key: 'dispatchedBy', width: 16 },
  ];

  for (const l of letters) {
    sheet.addRow({
      letterNumber: l.letterNumber,
      contractNumber: l.contract.contractNumber,
      customerName: l.contract.customer.name,
      branch: l.contract.branch.name,
      letterType: LETTER_TYPE_TH[l.letterType] ?? l.letterType,
      status: STATUS_TH[l.status] ?? l.status,
      triggeredAt: formatBkkDate(l.triggeredAt),
      pdfGeneratedAt: formatBkkDate(l.pdfGeneratedAt),
      dispatchedAt: formatBkkDate(l.dispatchedAt),
      trackingNumber: l.trackingNumber ?? '',
      deliveredAt: formatBkkDate(l.deliveredAt),
      cancelReason: l.cancelReason ?? '',
      dispatchedBy: l.dispatchedBy?.name ?? '',
    });
  }

  sheet.getRow(1).font = { bold: true };

  const buffer = await wb.xlsx.writeBuffer();
  return new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}
```

- [ ] **Step 4: Run tests**

```bash
cd apps/web && npx vitest run src/pages/LettersPage/__tests__/lettersToExcel.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/LettersPage/utils/lettersToExcel.ts \
        apps/web/src/pages/LettersPage/__tests__/lettersToExcel.test.ts
git commit -m "feat(letters): lettersToExcel util — workbook export with Thai formatting"
```

---

### Task 9: Create `useLettersList` hook

**Files:**
- Create: `apps/web/src/pages/LettersPage/hooks/useLettersList.ts`
- Create: `apps/web/src/pages/LettersPage/__tests__/useLettersList.test.ts`
- Create: `apps/web/src/pages/LettersPage/types.ts`

- [ ] **Step 1: Create shared types**

```ts
// apps/web/src/pages/LettersPage/types.ts
export type LetterStatus =
  | 'PENDING_DISPATCH'
  | 'PDF_GENERATED'
  | 'DISPATCHED'
  | 'DELIVERED'
  | 'UNDELIVERABLE'
  | 'CANCELLED';

export type LetterType = 'RETURN_DEVICE_45D' | 'CONTRACT_TERMINATION_60D';

export interface LetterRow {
  id: string;
  letterNumber: string;
  letterType: LetterType;
  status: LetterStatus;
  triggeredAt: string;
  pdfGeneratedAt: string | null;
  dispatchedAt: string | null;
  trackingNumber: string | null;
  deliveredAt: string | null;
  cancelReason: string | null;
  dispatchedBy?: { name: string } | null;
  contract: {
    id: string;
    contractNumber: string;
    customer: {
      id: string;
      name: string;
      phone: string;
      addressCurrent: string | null;
    };
    branch: { id: string; name: string };
  };
}

export interface LettersListResponse {
  data: LetterRow[];
  total: number;
  page: number;
  limit: number;
}

export interface LettersListFilters {
  status?: LetterStatus;
  letterType?: LetterType;
  branchId?: string;
  from?: string;
  to?: string;
  q?: string;
  page?: number;
  limit?: number;
}
```

- [ ] **Step 2: Write hook test**

```ts
// apps/web/src/pages/LettersPage/__tests__/useLettersList.test.ts
import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useLettersList } from '../hooks/useLettersList';
import { api } from '@/lib/api';

vi.mock('@/lib/api', () => ({
  api: { get: vi.fn() },
}));

const wrapper = ({ children }: { children: React.ReactNode }) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
};

describe('useLettersList', () => {
  it('serializes filters to query params', async () => {
    (api.get as any).mockResolvedValue({ data: { data: [], total: 0, page: 1, limit: 50 } });
    renderHook(
      () => useLettersList({ status: 'PENDING_DISPATCH', q: 'สมชาย', page: 2 }),
      { wrapper },
    );
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    const callArgs = (api.get as any).mock.calls[0];
    expect(callArgs[0]).toBe('/overdue/letters');
    expect(callArgs[1].params).toMatchObject({
      status: 'PENDING_DISPATCH',
      q: 'สมชาย',
      page: 2,
    });
  });

  it('omits undefined filter keys', async () => {
    (api.get as any).mockResolvedValue({ data: { data: [], total: 0, page: 1, limit: 50 } });
    renderHook(() => useLettersList({ status: 'DISPATCHED' }), { wrapper });
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    const params = (api.get as any).mock.calls[0][1].params;
    expect(params.q).toBeUndefined();
    expect(params.branchId).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run, verify FAIL**

```bash
cd apps/web && npx vitest run src/pages/LettersPage/__tests__/useLettersList.test.ts
```

- [ ] **Step 4: Implement hook**

```ts
// apps/web/src/pages/LettersPage/hooks/useLettersList.ts
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { LettersListFilters, LettersListResponse } from '../types';

const stripUndefined = <T extends object>(obj: T): Partial<T> => {
  const out: any = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined && v !== '') out[k] = v;
  }
  return out;
};

export function useLettersList(filters: LettersListFilters) {
  const params = stripUndefined(filters);
  return useQuery({
    queryKey: ['letters', params],
    queryFn: async (): Promise<LettersListResponse> => {
      const { data } = await api.get<LettersListResponse>('/overdue/letters', { params });
      return data;
    },
    staleTime: 30_000,
  });
}
```

- [ ] **Step 5: Run test**

```bash
cd apps/web && npx vitest run src/pages/LettersPage/__tests__/useLettersList.test.ts
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/LettersPage/hooks/useLettersList.ts \
        apps/web/src/pages/LettersPage/types.ts \
        apps/web/src/pages/LettersPage/__tests__/useLettersList.test.ts
git commit -m "feat(letters): useLettersList hook with filter serialization"
```

---

### Task 10: Create `useBulkDispatch` hook

**Files:**
- Create: `apps/web/src/pages/LettersPage/hooks/useBulkDispatch.ts`

- [ ] **Step 1: Implement (no test — covered by E2E)**

```ts
// apps/web/src/pages/LettersPage/hooks/useBulkDispatch.ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/api';

interface BulkDispatchItem {
  id: string;
  trackingNumber: string;
  evidencePhotoUrl?: string;
}

export function useBulkDispatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (items: BulkDispatchItem[]) => {
      const { data } = await api.post<{ updated: Array<{ id: string }>; batchId: string }>(
        '/overdue/letters/bulk/dispatch',
        { items },
      );
      return data;
    },
    onSuccess: (data) => {
      toast.success(`บันทึกการส่ง ${data.updated.length} ฉบับสำเร็จ`);
      qc.invalidateQueries({ queryKey: ['letters'] });
    },
    onError: (err: any) => {
      const message = err?.response?.data?.message ?? err?.message ?? 'เกิดข้อผิดพลาด';
      toast.error(typeof message === 'string' ? message : message.join(', '));
    },
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/pages/LettersPage/hooks/useBulkDispatch.ts
git commit -m "feat(letters): useBulkDispatch hook"
```

---

## Phase 3 — Frontend Components

### Task 11: Create `LetterTabs` component

**Files:**
- Create: `apps/web/src/pages/LettersPage/components/LetterTabs.tsx`

- [ ] **Step 1: Implement**

```tsx
// apps/web/src/pages/LettersPage/components/LetterTabs.tsx
import { FileText, Printer, Truck, AlertTriangle, X } from 'lucide-react';
import type { LetterStatus } from '../types';

interface Props {
  active: LetterStatus;
  counts: Partial<Record<LetterStatus, number>>;
  onChange: (status: LetterStatus) => void;
}

const TABS: Array<{ status: LetterStatus; label: string; Icon: React.ElementType }> = [
  { status: 'PENDING_DISPATCH', label: 'รอพิมพ์', Icon: FileText },
  { status: 'PDF_GENERATED', label: 'พิมพ์แล้ว', Icon: Printer },
  { status: 'DISPATCHED', label: 'ส่งแล้ว', Icon: Truck },
  { status: 'UNDELIVERABLE', label: 'ตีกลับ', Icon: AlertTriangle },
  { status: 'CANCELLED', label: 'ยกเลิก', Icon: X },
];

export default function LetterTabs({ active, counts, onChange }: Props) {
  return (
    <div className="flex gap-0 border-b border-border mb-4 overflow-x-auto">
      {TABS.map(({ status, label, Icon }) => {
        const count = counts[status] ?? 0;
        const isActive = active === status;
        return (
          <button
            key={status}
            onClick={() => onChange(status)}
            className={`inline-flex items-center gap-1.5 px-4 py-2.5 text-sm border-b-2 transition-colors whitespace-nowrap ${
              isActive
                ? 'border-primary text-primary font-medium'
                : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
            }`}
          >
            <Icon className={`size-4 shrink-0 ${isActive ? 'text-primary' : ''}`} />
            {label}
            {count > 0 && (
              <span
                className={`rounded-full px-1.5 py-0.5 text-2xs tabular-nums leading-none ${
                  isActive
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground'
                }`}
              >
                {count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/pages/LettersPage/components/LetterTabs.tsx
git commit -m "feat(letters): LetterTabs component"
```

---

### Task 12: Create `LetterFiltersBar` component

**Files:**
- Create: `apps/web/src/pages/LettersPage/components/LetterFiltersBar.tsx`

- [ ] **Step 1: Implement**

```tsx
// apps/web/src/pages/LettersPage/components/LetterFiltersBar.tsx
import { useState } from 'react';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useDebounce } from '@/hooks/useDebounce';
import { useEffect } from 'react';
import type { LettersListFilters, LetterType } from '../types';

interface Props {
  value: Omit<LettersListFilters, 'status' | 'page' | 'limit'>;
  onChange: (next: Omit<LettersListFilters, 'status' | 'page' | 'limit'>) => void;
  branches: Array<{ id: string; name: string }>;
  canSelectBranch: boolean;
}

export default function LetterFiltersBar({ value, onChange, branches, canSelectBranch }: Props) {
  const [searchInput, setSearchInput] = useState(value.q ?? '');
  const debouncedSearch = useDebounce(searchInput, 300);

  useEffect(() => {
    if (debouncedSearch !== (value.q ?? '')) {
      onChange({ ...value, q: debouncedSearch || undefined });
    }
  }, [debouncedSearch]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex flex-wrap gap-3 items-center mb-4">
      <div className="relative flex-1 min-w-[200px]">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
        <Input
          placeholder="ค้นหา (เลขจดหมาย/เลขสัญญา/ชื่อลูกค้า)"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          className="pl-9"
        />
      </div>

      {canSelectBranch && (
        <Select
          value={value.branchId ?? 'all'}
          onValueChange={(v) => onChange({ ...value, branchId: v === 'all' ? undefined : v })}
        >
          <SelectTrigger className="w-[160px]"><SelectValue placeholder="สาขา" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">ทุกสาขา</SelectItem>
            {branches.map((b) => (
              <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      <Select
        value={value.letterType ?? 'all'}
        onValueChange={(v) =>
          onChange({ ...value, letterType: v === 'all' ? undefined : (v as LetterType) })
        }
      >
        <SelectTrigger className="w-[180px]"><SelectValue placeholder="ประเภท" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">ทุกประเภท</SelectItem>
          <SelectItem value="RETURN_DEVICE_45D">เก็บอุปกรณ์ 45 วัน</SelectItem>
          <SelectItem value="CONTRACT_TERMINATION_60D">บอกเลิกสัญญา 60 วัน</SelectItem>
        </SelectContent>
      </Select>

      <Input
        type="date"
        value={value.from ?? ''}
        onChange={(e) => onChange({ ...value, from: e.target.value || undefined })}
        className="w-[150px]"
      />
      <span className="text-muted-foreground">ถึง</span>
      <Input
        type="date"
        value={value.to ?? ''}
        onChange={(e) => onChange({ ...value, to: e.target.value || undefined })}
        className="w-[150px]"
      />
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/pages/LettersPage/components/LetterFiltersBar.tsx
git commit -m "feat(letters): LetterFiltersBar with debounced search"
```

---

### Task 13: Create `LetterTable` component

**Files:**
- Create: `apps/web/src/pages/LettersPage/components/LetterTable.tsx`

- [ ] **Step 1: Implement**

```tsx
// apps/web/src/pages/LettersPage/components/LetterTable.tsx
import { Eye, Truck, X, Check, AlertTriangle, Undo2 } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import type { LetterRow, LetterStatus } from '../types';

interface Props {
  rows: LetterRow[];
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  onToggleAll: (checked: boolean) => void;
  status: LetterStatus;
  canCancel: boolean;
  onPreview: (row: LetterRow) => void;
  onDispatch: (row: LetterRow) => void;
  onMarkDelivered: (row: LetterRow) => void;
  onMarkUndeliverable: (row: LetterRow) => void;
  onRevertUndeliverable: (row: LetterRow) => void;
  onCancel: (row: LetterRow) => void;
}

const LETTER_TYPE_TH: Record<string, string> = {
  RETURN_DEVICE_45D: 'เก็บอุปกรณ์ 45ว',
  CONTRACT_TERMINATION_60D: 'บอกเลิก 60ว',
};

const formatBkk = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('th-TH', { day: '2-digit', month: '2-digit' }) : '-';

export default function LetterTable({
  rows,
  selectedIds,
  onToggle,
  onToggleAll,
  status,
  canCancel,
  onPreview,
  onDispatch,
  onMarkDelivered,
  onMarkUndeliverable,
  onRevertUndeliverable,
  onCancel,
}: Props) {
  const allChecked = rows.length > 0 && rows.every((r) => selectedIds.has(r.id));
  const hasCheckbox = status !== 'CANCELLED' && status !== 'DELIVERED';

  return (
    <div className="rounded-md border border-border overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-muted text-muted-foreground">
          <tr>
            {hasCheckbox && (
              <th className="w-10 p-3">
                <Checkbox checked={allChecked} onCheckedChange={(c) => onToggleAll(!!c)} />
              </th>
            )}
            <th className="p-3 text-left">เลขจดหมาย</th>
            <th className="p-3 text-left">ลูกค้า</th>
            <th className="p-3 text-left">สัญญา</th>
            <th className="p-3 text-left">ประเภท</th>
            <th className="p-3 text-left">วันที่</th>
            {status === 'DISPATCHED' && <th className="p-3 text-left">Tracking</th>}
            <th className="p-3 text-right">Action</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={8} className="p-8 text-center text-muted-foreground">
                ไม่พบจดหมายในสถานะนี้
              </td>
            </tr>
          ) : (
            rows.map((r) => (
              <tr key={r.id} className="border-t border-border hover:bg-accent/30">
                {hasCheckbox && (
                  <td className="p-3">
                    <Checkbox
                      checked={selectedIds.has(r.id)}
                      onCheckedChange={() => onToggle(r.id)}
                    />
                  </td>
                )}
                <td className="p-3 font-mono">{r.letterNumber}</td>
                <td className="p-3">{r.contract.customer.name}</td>
                <td className="p-3 font-mono text-muted-foreground">{r.contract.contractNumber}</td>
                <td className="p-3">{LETTER_TYPE_TH[r.letterType] ?? r.letterType}</td>
                <td className="p-3">{formatBkk(r.triggeredAt)}</td>
                {status === 'DISPATCHED' && (
                  <td className="p-3 font-mono text-xs">{r.trackingNumber ?? '-'}</td>
                )}
                <td className="p-3 text-right">
                  <div className="inline-flex gap-1">
                    <Button size="sm" variant="ghost" onClick={() => onPreview(r)}>
                      <Eye className="size-4" />
                    </Button>
                    {status === 'PDF_GENERATED' && (
                      <Button size="sm" variant="outline" onClick={() => onDispatch(r)}>
                        <Truck className="size-4 mr-1" /> ส่ง
                      </Button>
                    )}
                    {status === 'DISPATCHED' && (
                      <>
                        <Button size="sm" variant="outline" onClick={() => onMarkDelivered(r)}>
                          <Check className="size-4 mr-1" /> รับแล้ว
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => onMarkUndeliverable(r)}>
                          <AlertTriangle className="size-4" />
                        </Button>
                      </>
                    )}
                    {status === 'UNDELIVERABLE' && (
                      <Button size="sm" variant="outline" onClick={() => onRevertUndeliverable(r)}>
                        <Undo2 className="size-4 mr-1" /> ย้อน
                      </Button>
                    )}
                    {canCancel && (status === 'PENDING_DISPATCH' || status === 'PDF_GENERATED') && (
                      <Button size="sm" variant="ghost" onClick={() => onCancel(r)}>
                        <X className="size-4" />
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/pages/LettersPage/components/LetterTable.tsx
git commit -m "feat(letters): LetterTable with per-status row actions"
```

---

### Task 13.5: Extract `buildLetterTemplateData` util

The existing `LetterDispatchDialog` builds `LetterTemplateData` inline from a letter + fetched contract payments + company info (see `LetterDispatchDialog.tsx:140-183`). For bulk print to render the same way, extract this into a reusable util so both single and bulk flows share the same builder.

**Files:**
- Create: `apps/web/src/pages/CollectionsPage/utils/buildLetterTemplateData.ts`
- Modify: `apps/web/src/pages/CollectionsPage/components/LetterDispatchDialog.tsx` (replace inline builder with util call)

- [ ] **Step 1: Extract builder util**

```ts
// apps/web/src/pages/CollectionsPage/utils/buildLetterTemplateData.ts
import Decimal from 'decimal.js';
import { api } from '@/lib/api';
import type { LetterTemplateData } from './letterPdfRenderer';

interface LetterInput {
  letterType: 'RETURN_DEVICE_45D' | 'CONTRACT_TERMINATION_60D';
  letterNumber: string;
  contract: {
    id: string;
    contractNumber: string;
    customer: { name: string; addressCurrent?: string | null };
  };
}

/**
 * Fetches contract + company info and assembles LetterTemplateData
 * ready for renderLetterPdf / renderLetterPdfDoc.
 *
 * Shared by LetterDispatchDialog (single) and BulkPrintDialog (loop).
 */
export async function buildLetterTemplateData(letter: LetterInput): Promise<LetterTemplateData> {
  const [contractRes, companyRes] = await Promise.all([
    api.get(`/contracts/${letter.contract.id}`).then((r) => r.data),
    api.get('/company-info').then((r) => r.data),
  ]);

  const company = companyRes;
  const letterheadUrl = company.letterheadUrl ?? null;
  const signatureUrl = company.directorSignatureUrl ?? null;

  const payments: Array<{
    status: string;
    amountDue: string;
    amountPaid: string;
    lateFee: string | null;
    dueDate: string;
  }> = (contractRes.payments ?? []).filter((p: { status: string }) =>
    ['PENDING', 'OVERDUE', 'PARTIALLY_PAID'].includes(p.status),
  );

  const outstandingDec = payments.reduce(
    (sum, p) =>
      sum
        .plus(new Decimal(p.amountDue ?? '0'))
        .minus(new Decimal(p.amountPaid ?? '0'))
        .plus(new Decimal(p.lateFee ?? '0')),
    new Decimal(0),
  );
  const outstanding = outstandingDec.toNumber();

  const now = new Date();
  const oldest = payments
    .map((p) => new Date(p.dueDate))
    .sort((a, b) => a.getTime() - b.getTime())[0];
  const daysOverdue = oldest
    ? Math.max(0, Math.floor((now.getTime() - oldest.getTime()) / 86400000))
    : 0;

  return {
    letterType: letter.letterType,
    letterNumber: letter.letterNumber,
    letterDate: new Date(),
    company: {
      nameTh: company.nameTh,
      taxId: company.taxId,
      address: company.address,
      phone: company.phone ?? undefined,
      directorName: company.directorName,
      directorPosition: company.directorPosition ?? undefined,
      logoUrl: letterheadUrl ?? company.logoUrl ?? undefined,
      signatureUrl: signatureUrl ?? undefined,
    },
    customer: {
      name: letter.contract.customer.name,
      address: letter.contract.customer.addressCurrent ?? null,
    },
    contract: {
      contractNumber: letter.contract.contractNumber,
      contractDate: contractRes.createdAt ? new Date(contractRes.createdAt) : null,
      outstanding,
      daysOverdue,
    },
  };
}
```

- [ ] **Step 2: Refactor `LetterDispatchDialog` to use util**

In `LetterDispatchDialog.tsx`, replace the inline data-building block (lines ~115-183) with:

```ts
const data = await buildLetterTemplateData(letter);
const blob = await renderLetterPdf(data);
```

Add import:

```ts
import { buildLetterTemplateData } from '../utils/buildLetterTemplateData';
```

Remove now-unused imports (`Decimal` if no longer used, `api` if no longer used elsewhere in the file).

- [ ] **Step 3: Type check + run existing tests**

```bash
cd apps/web && npm run typecheck && npx vitest run
```

Expected: 0 errors + existing tests still pass

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/CollectionsPage/utils/buildLetterTemplateData.ts \
        apps/web/src/pages/CollectionsPage/components/LetterDispatchDialog.tsx
git commit -m "refactor(letters): extract buildLetterTemplateData util for reuse"
```

---

### Task 14: Create `BulkPrintDialog`

**Files:**
- Create: `apps/web/src/pages/LettersPage/components/BulkPrintDialog.tsx`

- [ ] **Step 1: Implement**

```tsx
// apps/web/src/pages/LettersPage/components/BulkPrintDialog.tsx
import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Download, Printer, X, Check } from 'lucide-react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { mergeLetterPdfs } from '../utils/mergeLetterPdfs';
import { buildLetterTemplateData } from '@/pages/CollectionsPage/utils/buildLetterTemplateData';
import { api } from '@/lib/api';
import type { LetterRow } from '../types';

interface Props {
  open: boolean;
  rows: LetterRow[];
  onClose: () => void;
}

export default function BulkPrintDialog({ open, rows, onClose }: Props) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [building, setBuilding] = useState(false);
  const [marking, setMarking] = useState(false);
  const [printConfirmActive, setPrintConfirmActive] = useState(false);
  const qc = useQueryClient();

  useEffect(() => {
    if (!open) {
      if (blobUrl) URL.revokeObjectURL(blobUrl);
      setBlobUrl(null);
      setPrintConfirmActive(false);
      return;
    }
    setBuilding(true);
    (async () => {
      try {
        const templateData = await Promise.all(rows.map(buildLetterTemplateData));
        const blob = await mergeLetterPdfs(templateData);
        setBlobUrl(URL.createObjectURL(blob));
      } catch (err: any) {
        toast.error(`สร้าง PDF ล้มเหลว: ${err.message}`);
      } finally {
        setBuilding(false);
      }
    })();
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const markAllPdfGenerated = async () => {
    setMarking(true);
    const results = await Promise.allSettled(
      rows.map((r) => api.post(`/overdue/letters/${r.id}/pdf-generated`, {})),
    );
    setMarking(false);
    const failed = results.filter((r) => r.status === 'rejected');
    if (failed.length === 0) {
      toast.success(`ทำเครื่องหมายพิมพ์แล้ว ${rows.length} ฉบับ — ย้ายไปแท็บ พิมพ์แล้ว`);
    } else {
      toast.warning(`สำเร็จ ${rows.length - failed.length} ฉบับ, ค้าง ${failed.length} ฉบับ`);
    }
    qc.invalidateQueries({ queryKey: ['letters'] });
    onClose();
  };

  const handleDownload = () => {
    if (!blobUrl) return;
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = `letters-batch-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.pdf`;
    a.click();
    markAllPdfGenerated();
  };

  const handlePrint = () => {
    if (!blobUrl) return;
    const iframe = document.getElementById('bulk-pdf-iframe') as HTMLIFrameElement | null;
    iframe?.contentWindow?.print();
    setPrintConfirmActive(true);
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>พิมพ์รวม {rows.length} ฉบับ</DialogTitle>
        </DialogHeader>
        <div className="flex-1 bg-muted rounded-md overflow-hidden">
          {building ? (
            <div className="size-full flex items-center justify-center text-muted-foreground">
              กำลังสร้าง PDF...
            </div>
          ) : blobUrl ? (
            <iframe id="bulk-pdf-iframe" src={blobUrl} className="w-full h-full" title="PDF preview" />
          ) : null}
        </div>
        {printConfirmActive && (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm flex items-center justify-between">
            <span>พิมพ์เสร็จแล้ว? — กดยืนยันเพื่อย้ายไปแท็บ พิมพ์แล้ว</span>
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" onClick={() => setPrintConfirmActive(false)}>
                ยังไม่พิมพ์
              </Button>
              <Button size="sm" onClick={markAllPdfGenerated} disabled={marking}>
                <Check className="size-4 mr-1" /> ทำเครื่องหมายพิมพ์แล้ว
              </Button>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            <X className="size-4 mr-1" /> ปิด
          </Button>
          <Button variant="outline" onClick={handlePrint} disabled={!blobUrl || building}>
            <Printer className="size-4 mr-1" /> พิมพ์
          </Button>
          <Button onClick={handleDownload} disabled={!blobUrl || building}>
            <Download className="size-4 mr-1" /> ดาวน์โหลด PDF
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/pages/LettersPage/components/BulkPrintDialog.tsx
git commit -m "feat(letters): BulkPrintDialog — Download auto-marks, Print requires confirm"
```

---

### Task 15: Create `BulkDispatchDialog`

**Files:**
- Create: `apps/web/src/pages/LettersPage/components/BulkDispatchDialog.tsx`

- [ ] **Step 1: Implement**

```tsx
// apps/web/src/pages/LettersPage/components/BulkDispatchDialog.tsx
import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useBulkDispatch } from '../hooks/useBulkDispatch';
import type { LetterRow } from '../types';

interface Props {
  open: boolean;
  rows: LetterRow[];
  onClose: () => void;
}

const EMS_REGEX = /^[A-Z]{2}\d{9}TH$/i;

export default function BulkDispatchDialog({ open, rows, onClose }: Props) {
  const [trackingMap, setTrackingMap] = useState<Record<string, string>>({});
  const [bookletPrefix, setBookletPrefix] = useState('');
  const [bookletStart, setBookletStart] = useState('');
  const { mutate, isPending } = useBulkDispatch();

  useEffect(() => {
    if (open) {
      setTrackingMap(Object.fromEntries(rows.map((r) => [r.id, ''])));
      setBookletPrefix('');
      setBookletStart('');
    }
  }, [open, rows]);

  const applyBooklet = () => {
    if (!bookletPrefix || !bookletStart) return;
    const startNum = parseInt(bookletStart, 10);
    if (Number.isNaN(startNum)) return;
    const next: Record<string, string> = {};
    rows.forEach((r, idx) => {
      const n = String(startNum + idx).padStart(9, '0');
      next[r.id] = `${bookletPrefix}${n}TH`;
    });
    setTrackingMap(next);
  };

  const submit = () => {
    const items = rows.map((r) => ({
      id: r.id,
      trackingNumber: (trackingMap[r.id] ?? '').trim(),
    }));
    mutate(items, { onSuccess: () => onClose() });
  };

  const allFilled = rows.every((r) => (trackingMap[r.id] ?? '').trim().length >= 5);

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>บันทึกการส่ง {rows.length} ฉบับ</DialogTitle>
        </DialogHeader>

        <div className="flex gap-2 items-end p-3 bg-muted rounded-md">
          <div>
            <label className="text-xs text-muted-foreground">Prefix</label>
            <Input
              placeholder="EM"
              value={bookletPrefix}
              onChange={(e) => setBookletPrefix(e.target.value.toUpperCase())}
              className="w-20"
              maxLength={2}
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">เลขเริ่ม</label>
            <Input
              placeholder="123456789"
              value={bookletStart}
              onChange={(e) => setBookletStart(e.target.value)}
              className="w-32"
              maxLength={9}
            />
          </div>
          <Button size="sm" variant="outline" onClick={applyBooklet}>
            ใช้ tracking ต่อเนื่อง
          </Button>
        </div>

        <div className="max-h-[400px] overflow-y-auto space-y-2 mt-2">
          {rows.map((r) => {
            const val = trackingMap[r.id] ?? '';
            const isValidFormat = !val || EMS_REGEX.test(val);
            return (
              <div key={r.id} className="flex gap-3 items-center p-2 border border-border rounded">
                <div className="flex-1">
                  <div className="text-sm font-medium">{r.contract.customer.name}</div>
                  <div className="text-xs text-muted-foreground font-mono">{r.letterNumber}</div>
                </div>
                <div className="w-48">
                  <Input
                    placeholder="EM123456789TH"
                    value={val}
                    onChange={(e) =>
                      setTrackingMap((prev) => ({ ...prev, [r.id]: e.target.value }))
                    }
                    className={!isValidFormat ? 'border-amber-400' : ''}
                  />
                  {!isValidFormat && (
                    <p className="text-xs text-amber-600 mt-0.5">รูปแบบไม่ใช่ไปรษณีย์ไทย</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={isPending}>ยกเลิก</Button>
          <Button onClick={submit} disabled={!allFilled || isPending}>
            {isPending ? 'กำลังบันทึก...' : `ยืนยันส่ง ${rows.length} ฉบับ`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/pages/LettersPage/components/BulkDispatchDialog.tsx
git commit -m "feat(letters): BulkDispatchDialog with tracking# + booklet auto-fill"
```

---

### Task 16: Create `LetterBulkActionsBar`

**Files:**
- Create: `apps/web/src/pages/LettersPage/components/LetterBulkActionsBar.tsx`

- [ ] **Step 1: Implement**

```tsx
// apps/web/src/pages/LettersPage/components/LetterBulkActionsBar.tsx
import { Printer, Truck, X, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { LetterStatus } from '../types';

interface Props {
  status: LetterStatus;
  count: number;
  canCancel: boolean;
  onBulkPrint: () => void;
  onBulkDispatch: () => void;
  onBulkUndeliverable: () => void;
  onBulkCancel: () => void;
  onClear: () => void;
}

export default function LetterBulkActionsBar({
  status,
  count,
  canCancel,
  onBulkPrint,
  onBulkDispatch,
  onBulkUndeliverable,
  onBulkCancel,
  onClear,
}: Props) {
  if (count === 0) return null;

  return (
    <div className="sticky bottom-0 z-10 -mx-4 px-4 py-3 bg-card border-t border-border shadow-lg flex items-center justify-between">
      <div className="flex items-center gap-3">
        <span className="text-sm font-medium">เลือก {count} ฉบับ</span>
        <Button size="sm" variant="ghost" onClick={onClear}>ยกเลิกเลือก</Button>
      </div>
      <div className="flex gap-2">
        {status === 'PENDING_DISPATCH' && (
          <>
            <Button size="sm" onClick={onBulkPrint}>
              <Printer className="size-4 mr-1" /> พิมพ์รวม
            </Button>
            {canCancel && (
              <Button size="sm" variant="outline" onClick={onBulkCancel}>
                <X className="size-4 mr-1" /> ยกเลิก
              </Button>
            )}
          </>
        )}
        {status === 'PDF_GENERATED' && (
          <>
            <Button size="sm" onClick={onBulkDispatch}>
              <Truck className="size-4 mr-1" /> บันทึกการส่ง
            </Button>
            {canCancel && (
              <Button size="sm" variant="outline" onClick={onBulkCancel}>
                <X className="size-4 mr-1" /> ยกเลิก
              </Button>
            )}
          </>
        )}
        {status === 'DISPATCHED' && (
          <Button size="sm" variant="outline" onClick={onBulkUndeliverable}>
            <AlertTriangle className="size-4 mr-1" /> ตีกลับ
          </Button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/pages/LettersPage/components/LetterBulkActionsBar.tsx
git commit -m "feat(letters): LetterBulkActionsBar sticky bottom bar"
```

---

### Task 17: Create `ExportExcelButton`

**Files:**
- Create: `apps/web/src/pages/LettersPage/components/ExportExcelButton.tsx`

- [ ] **Step 1: Implement**

```tsx
// apps/web/src/pages/LettersPage/components/ExportExcelButton.tsx
import { useState } from 'react';
import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { lettersToExcel } from '../utils/lettersToExcel';
import type { LettersListFilters, LettersListResponse } from '../types';

interface Props {
  filters: LettersListFilters;
}

const MAX_EXPORT = 10000;

export default function ExportExcelButton({ filters }: Props) {
  const [busy, setBusy] = useState(false);

  const handleExport = async () => {
    setBusy(true);
    try {
      const { data } = await api.get<LettersListResponse>('/overdue/letters', {
        params: { ...filters, page: 1, limit: MAX_EXPORT },
      });
      if (data.total > MAX_EXPORT) {
        toast.error('เกินจำนวนที่ export ได้ — กรุณาแคบ filter');
        return;
      }
      const blob = await lettersToExcel(data.data as any);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `letters-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.xlsx`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast.success(`Export ${data.data.length} แถวสำเร็จ`);
    } catch (err: any) {
      toast.error(`Export ล้มเหลว: ${err.message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button variant="outline" onClick={handleExport} disabled={busy}>
      <Download className="size-4 mr-1" /> {busy ? 'กำลัง export...' : 'Export Excel'}
    </Button>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/pages/LettersPage/components/ExportExcelButton.tsx
git commit -m "feat(letters): ExportExcelButton"
```

---

### Task 18: Create main `LettersPage`

**Files:**
- Create: `apps/web/src/pages/LettersPage/index.tsx`

- [ ] **Step 1: Implement**

```tsx
// apps/web/src/pages/LettersPage/index.tsx
import { useMemo, useState } from 'react';
import { Mail } from 'lucide-react';
import PageHeader from '@/components/PageHeader';
import QueryBoundary from '@/components/QueryBoundary';
import { useAuth } from '@/contexts/AuthContext';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useLettersList } from './hooks/useLettersList';
import LetterTabs from './components/LetterTabs';
import LetterFiltersBar from './components/LetterFiltersBar';
import LetterTable from './components/LetterTable';
import LetterBulkActionsBar from './components/LetterBulkActionsBar';
import BulkPrintDialog from './components/BulkPrintDialog';
import BulkDispatchDialog from './components/BulkDispatchDialog';
import ExportExcelButton from './components/ExportExcelButton';
import LetterDispatchDialog from '@/pages/CollectionsPage/components/LetterDispatchDialog';
import LetterPdfPreviewDialog from '@/pages/CollectionsPage/components/LetterPdfPreviewDialog';
import { useLetterActions } from '@/pages/CollectionsPage/hooks/useLetterActions';
import type { LetterRow, LetterStatus, LettersListFilters } from './types';

const CROSS_BRANCH_ROLES = new Set(['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT']);
const CANCEL_ROLES = new Set(['OWNER', 'FINANCE_MANAGER', 'BRANCH_MANAGER']);

export default function LettersPage() {
  const { user } = useAuth();
  const role = user?.role ?? '';
  const canSelectBranch = CROSS_BRANCH_ROLES.has(role);
  const canCancel = CANCEL_ROLES.has(role);

  const [activeStatus, setActiveStatus] = useState<LetterStatus>('PENDING_DISPATCH');
  const [filters, setFilters] = useState<Omit<LettersListFilters, 'status' | 'page' | 'limit'>>({});
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const [previewRow, setPreviewRow] = useState<LetterRow | null>(null);
  const [dispatchRow, setDispatchRow] = useState<LetterRow | null>(null);
  const [bulkPrintOpen, setBulkPrintOpen] = useState(false);
  const [bulkDispatchOpen, setBulkDispatchOpen] = useState(false);

  const fullFilters = { ...filters, status: activeStatus, page, limit: 50 };
  const listQuery = useLettersList(fullFilters);

  // Per-status counts via individual queries
  const countsQuery = useQuery({
    queryKey: ['letters-counts', filters],
    queryFn: async () => {
      const statuses: LetterStatus[] = [
        'PENDING_DISPATCH', 'PDF_GENERATED', 'DISPATCHED', 'UNDELIVERABLE', 'CANCELLED',
      ];
      const results = await Promise.all(
        statuses.map((s) =>
          api.get('/overdue/letters', { params: { ...filters, status: s, page: 1, limit: 1 } }),
        ),
      );
      return Object.fromEntries(
        statuses.map((s, idx) => [s, results[idx].data.total ?? 0]),
      ) as Record<LetterStatus, number>;
    },
  });

  const branchesQuery = useQuery({
    queryKey: ['branches-list'],
    queryFn: async () => {
      const { data } = await api.get<Array<{ id: string; name: string }>>('/branches');
      return data;
    },
    enabled: canSelectBranch,
  });

  const actions = useLetterActions();
  const rows = listQuery.data?.data ?? [];

  const selectedRows = useMemo(
    () => rows.filter((r) => selectedIds.has(r.id)),
    [rows, selectedIds],
  );

  const handleToggle = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleToggleAll = (checked: boolean) => {
    setSelectedIds(checked ? new Set(rows.map((r) => r.id)) : new Set());
  };

  const handleTabChange = (s: LetterStatus) => {
    setActiveStatus(s);
    setSelectedIds(new Set());
    setPage(1);
  };

  return (
    <div className="p-4 pb-20 max-w-7xl mx-auto">
      <PageHeader
        title="จัดการจดหมาย"
        icon={Mail}
        actions={<ExportExcelButton filters={fullFilters} />}
      />

      <LetterTabs
        active={activeStatus}
        counts={countsQuery.data ?? {}}
        onChange={handleTabChange}
      />

      <LetterFiltersBar
        value={filters}
        onChange={(next) => {
          setFilters(next);
          setSelectedIds(new Set());
          setPage(1);
        }}
        branches={branchesQuery.data ?? []}
        canSelectBranch={canSelectBranch}
      />

      <QueryBoundary query={listQuery}>
        <LetterTable
          rows={rows}
          selectedIds={selectedIds}
          onToggle={handleToggle}
          onToggleAll={handleToggleAll}
          status={activeStatus}
          canCancel={canCancel}
          onPreview={setPreviewRow}
          onDispatch={setDispatchRow}
          onMarkDelivered={(r) => actions.markDelivered.mutate(r.id)}
          onMarkUndeliverable={(r) =>
            actions.markUndeliverable.mutate({ letterId: r.id, reason: 'ตีกลับจากไปรษณีย์' })
          }
          onRevertUndeliverable={(r) => actions.revertUndeliverable.mutate(r.id)}
          onCancel={(r) =>
            actions.cancel.mutate({ letterId: r.id, reason: 'ยกเลิกตามคำสั่ง' })
          }
        />
      </QueryBoundary>

      <LetterBulkActionsBar
        status={activeStatus}
        count={selectedRows.length}
        canCancel={canCancel}
        onBulkPrint={() => setBulkPrintOpen(true)}
        onBulkDispatch={() => setBulkDispatchOpen(true)}
        onBulkUndeliverable={async () => {
          for (const r of selectedRows) {
            await actions.markUndeliverable.mutateAsync({
              letterId: r.id,
              reason: 'ตีกลับ (bulk)',
            });
          }
          setSelectedIds(new Set());
        }}
        onBulkCancel={async () => {
          if (!confirm(`ยืนยันยกเลิก ${selectedRows.length} ฉบับ?`)) return;
          for (const r of selectedRows) {
            await actions.cancel.mutateAsync({ letterId: r.id, reason: 'ยกเลิก (bulk)' });
          }
          setSelectedIds(new Set());
        }}
        onClear={() => setSelectedIds(new Set())}
      />

      {previewRow && (
        <LetterPdfPreviewDialog
          open={!!previewRow}
          letter={previewRow as any}
          onClose={() => setPreviewRow(null)}
        />
      )}
      {dispatchRow && (
        <LetterDispatchDialog
          open={!!dispatchRow}
          letter={dispatchRow as any}
          onClose={() => setDispatchRow(null)}
        />
      )}
      {bulkPrintOpen && (
        <BulkPrintDialog
          open={bulkPrintOpen}
          rows={selectedRows}
          onClose={() => {
            setBulkPrintOpen(false);
            setSelectedIds(new Set());
          }}
        />
      )}
      {bulkDispatchOpen && (
        <BulkDispatchDialog
          open={bulkDispatchOpen}
          rows={selectedRows}
          onClose={() => {
            setBulkDispatchOpen(false);
            setSelectedIds(new Set());
          }}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Type check**

```bash
cd apps/web && npm run typecheck
```

Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/LettersPage/index.tsx
git commit -m "feat(letters): LettersPage compose all components"
```

---

## Phase 4 — Wire-up & Cleanup

### Task 19: Register route in `App.tsx`

**Files:**
- Modify: `apps/web/src/App.tsx`

- [ ] **Step 1: Add lazy import (with other page imports near top)**

```tsx
const LettersPage = lazy(() => import('./pages/LettersPage'));
```

- [ ] **Step 2: Add route (near other protected routes, e.g., after `/overdue` redirect at line 609)**

```tsx
<Route
  path="/letters"
  element={
    <ProtectedRoute roles={['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES']}>
      <LettersPage />
    </ProtectedRoute>
  }
/>
```

- [ ] **Step 3: Type check + smoke test (dev server)**

```bash
cd apps/web && npm run typecheck
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/App.tsx
git commit -m "feat(letters): register /letters route"
```

---

### Task 20: Add menu entries

**Files:**
- Modify: `apps/web/src/config/menu.ts`

- [ ] **Step 1: Add menu entry alongside each `/overdue` entry**

For each of the 5 occurrences of `/overdue` (lines 246, 324, 367, 540, 743, 839, 861), add a sibling entry immediately after:

```ts
{ label: 'จัดการจดหมาย', path: '/letters', icon: Mail },
```

Add `Mail` to the lucide-react imports at the top of the file.

- [ ] **Step 2: Type check**

```bash
cd apps/web && npm run typecheck
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/config/menu.ts
git commit -m "feat(letters): add /letters menu entry to all role configs"
```

---

### Task 21: Delete orphan `useLetterQueue`

**Files:**
- Delete: `apps/web/src/pages/CollectionsPage/hooks/useLetterQueue.ts`

- [ ] **Step 1: Verify no consumers**

```bash
grep -rn "useLetterQueue\|from.*useLetterQueue" /Users/iamnaii/Desktop/App/BESTCHOICE/apps/web/src
```

Expected output: only the file itself (no importers). If there are importers, do NOT delete — flag for review.

- [ ] **Step 2: Delete file**

```bash
rm /Users/iamnaii/Desktop/App/BESTCHOICE/apps/web/src/pages/CollectionsPage/hooks/useLetterQueue.ts
```

- [ ] **Step 3: Type check**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE/apps/web && npm run typecheck
```

Expected: 0 errors (would catch if something does import it)

- [ ] **Step 4: Commit**

```bash
git add -A apps/web/src/pages/CollectionsPage/hooks/
git commit -m "chore(letters): remove orphan useLetterQueue hook (superseded by useLettersList)"
```

---

## Phase 5 — E2E

### Task 22: Playwright E2E

**Files:**
- Create: `apps/web/e2e/letters-page.spec.ts`

- [ ] **Step 1: Write spec**

```ts
// apps/web/e2e/letters-page.spec.ts
import { test, expect } from '@playwright/test';

test.describe('/letters page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('อีเมล').fill('admin@bestchoice.com');
    await page.getByLabel('รหัสผ่าน').fill('admin1234');
    await page.getByRole('button', { name: 'เข้าสู่ระบบ' }).click();
    await expect(page).toHaveURL(/\/(dashboard|overdue|collections|)$/);
  });

  test('owner sees all 5 tabs and can navigate to letters page', async ({ page }) => {
    await page.goto('/letters');
    await expect(page.getByRole('heading', { name: 'จัดการจดหมาย' })).toBeVisible();
    await expect(page.getByText('รอพิมพ์')).toBeVisible();
    await expect(page.getByText('พิมพ์แล้ว')).toBeVisible();
    await expect(page.getByText('ส่งแล้ว')).toBeVisible();
    await expect(page.getByText('ตีกลับ')).toBeVisible();
    await expect(page.getByText('ยกเลิก')).toBeVisible();
  });

  test('search filter triggers a network call with q param', async ({ page }) => {
    const requestPromise = page.waitForRequest(
      (req) => req.url().includes('/overdue/letters') && req.url().includes('q='),
    );
    await page.goto('/letters');
    await page.getByPlaceholder(/ค้นหา/).fill('สมชาย');
    await requestPromise;
  });

  test('Export Excel button triggers a download', async ({ page }) => {
    await page.goto('/letters');
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: /Export Excel/ }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/letters-.*\.xlsx/);
  });

  test('SALES role: no Cancel button visible on rows', async ({ page }) => {
    await page.goto('/logout');
    await page.goto('/login');
    await page.getByLabel('อีเมล').fill('sales1@bestchoice.com');
    await page.getByLabel('รหัสผ่าน').fill('admin1234');
    await page.getByRole('button', { name: 'เข้าสู่ระบบ' }).click();
    await page.goto('/letters');
    await page.getByText('รอพิมพ์').click();
    // No row-level cancel button (no X icon button on rows)
    const cancelButtons = page.locator('button:has(svg[data-testid="cancel-icon"])');
    await expect(cancelButtons).toHaveCount(0);
  });
});
```

- [ ] **Step 2: Run E2E**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE/apps/web && npx playwright test e2e/letters-page.spec.ts
```

Expected: all tests PASS (run with `--headed` to debug)

- [ ] **Step 3: Commit**

```bash
git add apps/web/e2e/letters-page.spec.ts
git commit -m "test(letters): E2E coverage for /letters page (tabs, filters, export, SALES role)"
```

---

## Phase 6 — Final Verification

### Task 23: Run full test suite

- [ ] **Step 1: API tests**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE/apps/api && npm test
```

Expected: all PASS, no new failures

- [ ] **Step 2: Web unit tests**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE/apps/web && npx vitest run
```

Expected: all PASS

- [ ] **Step 3: Full TypeScript check**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE && ./tools/check-types.sh all
```

Expected: 0 errors

- [ ] **Step 4: Manual smoke (dev server)**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE && npm run dev
```

Open http://localhost:5173/letters, log in as OWNER, verify:
- 5 tabs visible
- Filter typing triggers data refresh
- Selecting rows shows sticky bottom bar
- Bulk Print opens dialog, PDF preview renders
- Bulk Dispatch opens dialog, booklet auto-fill works
- Export Excel downloads file
- Log out, log in as SALES → no Cancel buttons, scoped to own branch

### Task 24: Update CLAUDE.md routes section

- [ ] **Step 1: Add `/letters` to routes documentation**

In `apps/web/CLAUDE.md` or main `CLAUDE.md`, under "Collections & Risk":

```
/letters — Letter management (queue, bulk print, dispatch + tracking#)
```

- [ ] **Step 2: Commit**

```bash
git add .claude/CLAUDE.md  # or wherever the routes section lives
git commit -m "docs: add /letters to routes section in CLAUDE.md"
```
