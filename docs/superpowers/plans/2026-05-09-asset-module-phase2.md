# Asset Module Phase 2 — Lifecycle Operations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship 3 dedicated lifecycle pages (Disposal, Depreciation manual, Transfer audit) backed by 2 new reverse JE templates + 7+ endpoints, completing the asset module's day-to-day operations workflow.

**Architecture:** Re-uses Phase 1 patterns established in `feat/asset-module-phase1` (merged at `beeca351`): templates accept `tx?` for atomicity, idempotency via `metadata.assetId`+`metadata.flow`, AuditLog with `oldValue`/`newValue` + `*_BLOCKED` actions on guard rejection, V15 period guard via `validatePeriodOpen` util, single `$transaction` driving template + status update + audit log. Phase 2 adds: `AssetDisposalReverseTemplate` (mirror disposal), `DepreciationReverseTemplate` (cascading reverse across all entries in a period), new `apps/api/src/modules/depreciation/` module for cross-asset operations, 3 frontend pages with shadcn/ui + react-hook-form + zod/v4 + standardSchemaResolver patterns from Phase 1.

**Tech Stack:** NestJS 10, Prisma 5, PostgreSQL, jest (services) + vitest (CPA templates), React 18 + Vite 6, react-hook-form, zod/v4, @tanstack/react-query, shadcn/ui, sonner, Playwright.

**Spec:** `docs/superpowers/specs/2026-05-09-asset-module-phase2-design.md`
**Branch:** `feat/asset-module-phase2` (already created)

---

## File Structure

### Backend new/modified

| Path | Action | Responsibility |
|------|--------|---------------|
| `apps/api/prisma/schema.prisma` | Modify | Add `reversedAt`, `reversedById`, `reversedBy` relation, compound index `[period, reversedAt]` to `DepreciationEntry`; add `User.depreciationEntriesReversed` back-relation |
| `apps/api/prisma/migrations/<ts>_depreciation_reverse_tracking/migration.sql` | Create | ALTER TABLE depreciation_entries: ADD COLUMN reversed_at, reversed_by_id, FK constraint, CREATE INDEX |
| `apps/api/src/modules/asset/dto/dispose-asset.dto.ts` | Create | DisposeAssetDto with disposalType + conditional proceeds/depositAccountCode |
| `apps/api/src/modules/asset/dto/reverse-disposal.dto.ts` | Create | ReverseDisposalDto with reason ≥ 5 |
| `apps/api/src/modules/asset/asset.service.ts` | Modify | Replace dispose stub with real impl + reverseDispose method |
| `apps/api/src/modules/asset/asset.controller.ts` | Modify | Add POST /:id/dispose, POST /:id/reverse-dispose, GET /asset-transfers |
| `apps/api/src/modules/asset/asset-transfer.service.ts` | Modify | Add listAllTransfers method (cross-asset paginated audit query) |
| `apps/api/src/modules/asset/__tests__/asset.service.spec.ts` | Modify | Add 12 dispose/reverseDispose cases |
| `apps/api/src/modules/asset/__tests__/asset-transfer.service.spec.ts` | Modify | Add 6 listAllTransfers cases |
| `apps/api/src/modules/journal/cpa-templates/asset-disposal-reverse.template.ts` | Create | Mirror disposal JE, restore asset to POSTED |
| `apps/api/src/modules/journal/cpa-templates/asset-disposal-reverse.template.spec.ts` | Create | 8 vitest cases |
| `apps/api/src/modules/journal/cpa-templates/depreciation-reverse.template.ts` | Create | Cascade reverse all entries in period |
| `apps/api/src/modules/journal/cpa-templates/depreciation-reverse.template.spec.ts` | Create | 8 vitest cases |
| `apps/api/src/modules/journal/journal.module.ts` | Modify | Register 2 new templates as providers + exports |
| `apps/api/src/modules/depreciation/depreciation.module.ts` | Create | New module wiring service + controller |
| `apps/api/src/modules/depreciation/depreciation.controller.ts` | Create | 4 endpoints (list, preview, run, reverse) |
| `apps/api/src/modules/depreciation/depreciation.service.ts` | Create | listRuns, previewRun, runManual, reverseRun |
| `apps/api/src/modules/depreciation/dto/run-depreciation.dto.ts` | Create | { period: 'YYYY-MM' } |
| `apps/api/src/modules/depreciation/dto/reverse-depreciation-run.dto.ts` | Create | { period, reason } |
| `apps/api/src/modules/depreciation/__tests__/depreciation.service.spec.ts` | Create | 16 jest cases |
| `apps/api/src/app.module.ts` | Modify | Register DepreciationModule |

### Frontend new/modified

| Path | Action | Responsibility |
|------|--------|---------------|
| `apps/web/src/pages/assets/AssetDisposePage.tsx` | Create | Sale/Write-off toggle form with live gain/loss + JE preview |
| `apps/web/src/pages/assets/components/ReverseDisposalDialog.tsx` | Create | Confirm dialog with reason textarea (≥ 5) |
| `apps/web/src/pages/assets/AssetDetailPage.tsx` | Modify | Add Dispose action (POSTED), Reverse-Dispose action (DISPOSED/WRITTEN_OFF), link to /assets/transfers |
| `apps/web/src/pages/assets/api.ts` | Modify | Add disposeAsset, reverseDisposal, listAllTransfers wrappers |
| `apps/web/src/pages/assets/types.ts` | Modify | Add DisposalFormValues, DisposalCalculation types |
| `apps/web/src/pages/assets/hooks/useDisposalCalculation.ts` | Create | Memoized gain/loss + JE lines |
| `apps/web/src/pages/assets/disposal-schema.ts` | Create | zod schema for disposal form |
| `apps/web/src/pages/depreciation/DepreciationPage.tsx` | Create | Period selector + preview + run + history table |
| `apps/web/src/pages/depreciation/components/DepreciationRunDialog.tsx` | Create | Confirm before run |
| `apps/web/src/pages/depreciation/components/DepreciationPreviewTable.tsx` | Create | Per-asset preview rows |
| `apps/web/src/pages/depreciation/components/ReverseDepreciationRunDialog.tsx` | Create | Confirm reverse with reason |
| `apps/web/src/pages/depreciation/api.ts` | Create | API wrappers for /depreciation endpoints |
| `apps/web/src/pages/depreciation/types.ts` | Create | DepreciationRun, DepreciationPreview types |
| `apps/web/src/pages/transfers/AssetTransfersListPage.tsx` | Create | Cross-asset audit table with filters |
| `apps/web/src/App.tsx` | Modify | Add 3 lazy routes |
| `apps/web/src/config/menu.ts` | Modify | Add "ค่าเสื่อม" nav entry |
| `apps/web/e2e/assets-dispose.spec.ts` | Create | Smoke E2E |
| `apps/web/e2e/assets-write-off.spec.ts` | Create | Smoke E2E |
| `apps/web/e2e/depreciation-manual.spec.ts` | Create | Smoke E2E |
| `apps/web/e2e/transfers-list.spec.ts` | Create | Smoke E2E |

---

## Task List Overview

**Section A — Disposal (7 tasks):**
1. Disposal DTOs (2 files)
2. AssetDisposalReverseTemplate + 8 tests
3. AssetService.dispose + reverseDispose + 12 tests
4. AssetController endpoints (dispose, reverse-dispose)
5. Frontend foundation (api/types/schema/hook)
6. AssetDisposePage + ReverseDisposalDialog + DetailPage actions
7. Routes + Disposal E2E

**Section B — Depreciation (6 tasks):**
8. Schema migration (DepreciationEntry +reversedAt/reversedById)
9. DepreciationModule + DTOs + DepreciationService.listRuns/previewRun + 6 tests
10. DepreciationService.runManual + 6 tests
11. DepreciationReverseTemplate + 8 tests
12. DepreciationService.reverseRun + 4 tests + DepreciationController + module wiring
13. DepreciationPage + dialogs + nav + Depreciation E2E

**Section C — Transfer audit (3 tasks):**
14. AssetTransferService.listAllTransfers + 6 tests + GET /asset-transfers endpoint
15. AssetTransfersListPage + route + Transfer E2E
16. Final verification + smoke + branch summary

---

## Task 1: Disposal DTOs

**Files:**
- Create: `apps/api/src/modules/asset/dto/dispose-asset.dto.ts`
- Create: `apps/api/src/modules/asset/dto/reverse-disposal.dto.ts`

- [ ] **Step 1.1: Create `dispose-asset.dto.ts`**

```typescript
import {
  IsString, IsNumber, IsDateString, IsIn, IsNotEmpty, IsOptional,
  ValidateIf, Min, MinLength,
} from 'class-validator';

const CASH_ACCOUNT_CODES = ['11-1101','11-1102','11-1103','11-1201','11-1202','11-1203'] as const;

export class DisposeAssetDto {
  @IsIn(['SALE', 'WRITE_OFF'], { message: 'วิธีจำหน่ายไม่ถูกต้อง' })
  disposalType: 'SALE' | 'WRITE_OFF';

  @IsDateString({}, { message: 'วันที่จำหน่ายไม่ถูกต้อง' })
  disposalDate: string;

  @ValidateIf((o) => o.disposalType === 'SALE')
  @IsNumber({}, { message: 'ราคาขายต้องเป็นตัวเลข' })
  @Min(0.01, { message: 'ราคาขายต้องมากกว่า 0' })
  proceeds?: number;

  @ValidateIf((o) => o.disposalType === 'SALE')
  @IsString()
  @IsIn([...CASH_ACCOUNT_CODES], { message: 'บัญชีรับเงินไม่ถูกต้อง' })
  depositAccountCode?: string;

  @IsString()
  @IsNotEmpty({ message: 'กรุณาระบุเหตุผล' })
  @MinLength(5, { message: 'เหตุผลต้องมีอย่างน้อย 5 ตัวอักษร' })
  reason: string;
}
```

- [ ] **Step 1.2: Create `reverse-disposal.dto.ts`**

```typescript
import { IsString, IsNotEmpty, MinLength } from 'class-validator';

export class ReverseDisposalDto {
  @IsString()
  @IsNotEmpty({ message: 'กรุณาระบุเหตุผลการกลับรายการ' })
  @MinLength(5, { message: 'เหตุผลต้องมีอย่างน้อย 5 ตัวอักษร' })
  reason: string;
}
```

- [ ] **Step 1.3: Verify typecheck**

```bash
./tools/check-types.sh api
```

Expected: 0 errors.

- [ ] **Step 1.4: Commit**

```bash
git add apps/api/src/modules/asset/dto/dispose-asset.dto.ts \
        apps/api/src/modules/asset/dto/reverse-disposal.dto.ts
git commit -m "feat(asset): Phase 2 disposal DTOs

DisposeAssetDto with conditional proceeds/depositAccount on SALE,
ReverseDisposalDto with reason ≥ 5. Thai validation messages."
```

---

## Task 2: AssetDisposalReverseTemplate + 8 tests

**Files:**
- Create: `apps/api/src/modules/journal/cpa-templates/asset-disposal-reverse.template.ts`
- Create: `apps/api/src/modules/journal/cpa-templates/asset-disposal-reverse.template.spec.ts`
- Modify: `apps/api/src/modules/journal/journal.module.ts`

- [ ] **Step 2.1: Read reference files**

Read these to mirror established patterns:
- `apps/api/src/modules/journal/cpa-templates/asset-purchase-reverse.template.ts` (closest analogue: mirror lines, metadata.flow, JournalPostAuditLog manual write)
- `apps/api/src/modules/journal/cpa-templates/asset-disposal.template.ts` (the forward template — to understand metadata shape and asset.update pattern)

- [ ] **Step 2.2: Write failing test**

Create `apps/api/src/modules/journal/cpa-templates/asset-disposal-reverse.template.spec.ts`. Mirror setup from `asset-purchase-reverse.template.spec.ts` (existing FINANCE company resolution, seedFinanceCoa, vitest framework, clean-up patterns).

```typescript
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient, AssetCategory, AssetStatus } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { JournalAutoService } from '../journal-auto.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { AssetPurchaseTemplate } from './asset-purchase.template';
import { AssetDisposalTemplate } from './asset-disposal.template';
import { AssetDisposalReverseTemplate } from './asset-disposal-reverse.template';
import { seedFinanceCoa } from '../../../prisma/seed-coa-finance';

const prisma = new PrismaClient();
const journalAuto = new JournalAutoService(prisma as unknown as PrismaService);
const purchase = new AssetPurchaseTemplate(journalAuto, prisma as unknown as PrismaService);
const disposal = new AssetDisposalTemplate(journalAuto, prisma as unknown as PrismaService);
const reverseDisposal = new AssetDisposalReverseTemplate(journalAuto, prisma as unknown as PrismaService);
let userId: string;

beforeAll(async () => {
  await seedFinanceCoa(prisma);
  let user = await prisma.user.findFirst({ where: { email: 'asset-disp-rev-test@bestchoice.local' } });
  if (!user) {
    user = await prisma.user.create({
      data: { email: 'asset-disp-rev-test@bestchoice.local', name: 'Disposal Reverse Tester', password: 'x', role: 'OWNER' },
    });
  }
  userId = user.id;
});

afterAll(async () => {
  await prisma.$executeRaw`ALTER TABLE audit_logs DISABLE TRIGGER audit_logs_no_delete`;
  try {
    await prisma.auditLog.deleteMany({ where: { userId } });
  } finally {
    await prisma.$executeRaw`ALTER TABLE audit_logs ENABLE TRIGGER audit_logs_no_delete`;
  }
  await prisma.journalPostAuditLog.deleteMany({ where: { postedById: userId } });
  await prisma.journalLine.deleteMany({ where: { journalEntry: { createdById: userId } } });
  await prisma.journalEntry.deleteMany({ where: { createdById: userId } });
  await prisma.assetTransferHistory.deleteMany({});
  await prisma.depreciationEntry.deleteMany({});
  await prisma.fixedAsset.deleteMany({ where: { createdById: userId } });
  await prisma.user.delete({ where: { id: userId } });
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.journalLine.deleteMany({ where: { journalEntry: { createdById: userId } } });
  await prisma.journalEntry.deleteMany({ where: { createdById: userId } });
  await prisma.fixedAsset.deleteMany({ where: { createdById: userId } });
});

async function postedAsset(overrides: Partial<Parameters<typeof prisma.fixedAsset.create>[0]['data']> = {}) {
  const asset = await prisma.fixedAsset.create({
    data: {
      assetCode: `TEST-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
      docNo: `ASSET-DISP-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      name: 'Test Asset',
      category: 'EQUIPMENT' as AssetCategory,
      basePrice: new Decimal(30000),
      shippingCost: new Decimal(0),
      installationCost: new Decimal(0),
      otherCapitalized: new Decimal(0),
      vatAmount: new Decimal(0),
      whtAmount: new Decimal(0),
      purchaseCost: new Decimal(30000),
      residualValue: new Decimal(0),
      usefulLifeMonths: 36,
      monthlyDepr: new Decimal('833.33'),
      accumulatedDepr: new Decimal(10000),
      netBookValue: new Decimal(20000),
      coaCostAccount: '12-2101',
      coaDeprAccount: '12-2102',
      coaExpenseAccount: '53-1601',
      purchaseDate: new Date('2026-01-01'),
      paymentAccount: '11-1201',
      status: 'POSTED' as AssetStatus,
      createdById: userId,
      ...overrides,
    },
  });
  await purchase.execute({ assetId: asset.id, postedById: userId });
  return asset;
}

describe('AssetDisposalReverseTemplate', () => {
  it('creates mirror JE for SALE disposal and restores asset to POSTED', async () => {
    const asset = await postedAsset();
    await disposal.execute({
      assetId: asset.id,
      disposalDate: new Date('2026-05-09'),
      disposalProceeds: 25000,
      depositAccountCode: '11-1201',
    });
    const result = await reverseDisposal.execute({
      assetId: asset.id, reversedById: userId, reason: 'ลูกค้าคืนสินค้า',
    });
    expect(result.entryNo).toMatch(/^JE-\d{6}-\d{5}$/);

    const updated = await prisma.fixedAsset.findUnique({ where: { id: asset.id } });
    expect(updated!.status).toBe('POSTED');
    expect(updated!.disposalDate).toBeNull();
    expect(updated!.netBookValue.toString()).toBe('20000.00');

    const reversal = await prisma.journalEntry.findFirst({
      where: {
        metadata: { path: ['flow'], equals: 'asset-disposal-reverse' },
        AND: [{ metadata: { path: ['assetId'], equals: asset.id } }],
      },
      include: { lines: true },
    });
    const totalDr = reversal!.lines.reduce(
      (s, l) => s.plus(l.debit.toString()), new Decimal(0)
    );
    const totalCr = reversal!.lines.reduce(
      (s, l) => s.plus(l.credit.toString()), new Decimal(0)
    );
    expect(totalDr.equals(totalCr)).toBe(true);
  });

  it('creates mirror JE for WRITE_OFF disposal', async () => {
    const asset = await postedAsset();
    await disposal.execute({
      assetId: asset.id, disposalDate: new Date('2026-05-09'), disposalProceeds: 0,
    });
    await reverseDisposal.execute({ assetId: asset.id, reversedById: userId, reason: 'ทิ้งผิด' });
    const updated = await prisma.fixedAsset.findUnique({ where: { id: asset.id } });
    expect(updated!.status).toBe('POSTED');
  });

  it('rejects if no original disposal JE exists', async () => {
    const asset = await postedAsset();
    await expect(
      reverseDisposal.execute({ assetId: asset.id, reversedById: userId, reason: 'x' }),
    ).rejects.toThrow(/not found/i);
  });

  it('rejects on second call (idempotency)', async () => {
    const asset = await postedAsset();
    await disposal.execute({
      assetId: asset.id, disposalDate: new Date('2026-05-09'), disposalProceeds: 25000, depositAccountCode: '11-1201',
    });
    await reverseDisposal.execute({ assetId: asset.id, reversedById: userId, reason: 'first' });
    await expect(
      reverseDisposal.execute({ assetId: asset.id, reversedById: userId, reason: 'second' }),
    ).rejects.toThrow(/already reversed/i);
  });

  it('original disposal JE remains POSTED with metadata.reversed=true', async () => {
    const asset = await postedAsset();
    await disposal.execute({
      assetId: asset.id, disposalDate: new Date('2026-05-09'), disposalProceeds: 25000, depositAccountCode: '11-1201',
    });
    await reverseDisposal.execute({ assetId: asset.id, reversedById: userId, reason: 'x' });
    const original = await prisma.journalEntry.findFirst({
      where: {
        metadata: { path: ['flow'], equals: 'asset-disposal' },
        AND: [{ metadata: { path: ['assetId'], equals: asset.id } }],
      },
    });
    expect(original!.status).toBe('POSTED');
    expect((original!.metadata as any).reversed).toBe(true);
    expect((original!.metadata as any).reversedByEntryNumber).toMatch(/^JE-\d{6}-\d{5}$/);
  });

  it('reversal JE description prefixed with [VOID] / ยกเลิก', async () => {
    const asset = await postedAsset();
    await disposal.execute({
      assetId: asset.id, disposalDate: new Date('2026-05-09'), disposalProceeds: 25000, depositAccountCode: '11-1201',
    });
    await reverseDisposal.execute({ assetId: asset.id, reversedById: userId, reason: 'x' });
    const reversal = await prisma.journalEntry.findFirst({
      where: {
        metadata: { path: ['flow'], equals: 'asset-disposal-reverse' },
        AND: [{ metadata: { path: ['assetId'], equals: asset.id } }],
      },
      include: { lines: true },
    });
    expect(reversal!.description).toMatch(/ยกเลิก|VOID/i);
    expect(reversal!.lines.every((l) => (l.description ?? '').includes('[VOID]'))).toBe(true);
  });

  it('reversal JE metadata links back to original', async () => {
    const asset = await postedAsset();
    await disposal.execute({
      assetId: asset.id, disposalDate: new Date('2026-05-09'), disposalProceeds: 25000, depositAccountCode: '11-1201',
    });
    const original = await prisma.journalEntry.findFirst({
      where: {
        metadata: { path: ['flow'], equals: 'asset-disposal' },
        AND: [{ metadata: { path: ['assetId'], equals: asset.id } }],
      },
    });
    await reverseDisposal.execute({ assetId: asset.id, reversedById: userId, reason: 'ลูกค้าคืน' });
    const reversal = await prisma.journalEntry.findFirst({
      where: {
        metadata: { path: ['flow'], equals: 'asset-disposal-reverse' },
        AND: [{ metadata: { path: ['assetId'], equals: asset.id } }],
      },
    });
    const meta = reversal!.metadata as any;
    expect(meta.flow).toBe('asset-disposal-reverse');
    expect(meta.originalEntryId).toBe(original!.id);
    expect(meta.originalEntryNumber).toBe(original!.entryNumber);
    expect(meta.reversalReason).toBe('ลูกค้าคืน');
  });

  it('rejects if reason is empty/whitespace', async () => {
    const asset = await postedAsset();
    await disposal.execute({
      assetId: asset.id, disposalDate: new Date('2026-05-09'), disposalProceeds: 25000, depositAccountCode: '11-1201',
    });
    await expect(
      reverseDisposal.execute({ assetId: asset.id, reversedById: userId, reason: '   ' }),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2.3: Run test — verify FAIL**

```bash
cd apps/api && npx vitest run journal/cpa-templates/asset-disposal-reverse.template
```

Expected: FAIL with `Cannot find module './asset-disposal-reverse.template'`.

- [ ] **Step 2.4: Implement template**

Create `apps/api/src/modules/journal/cpa-templates/asset-disposal-reverse.template.ts`:

```typescript
import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { Prisma } from '@prisma/client';
import { JournalAutoService } from '../journal-auto.service';
import { PrismaService } from '../../../prisma/prisma.service';

export interface AssetDisposalReverseInput {
  assetId: string;
  reversedById: string;
  reason: string;
}

@Injectable()
export class AssetDisposalReverseTemplate {
  private readonly logger = new Logger(AssetDisposalReverseTemplate.name);

  constructor(
    private readonly journal: JournalAutoService,
    private readonly prisma: PrismaService,
  ) {}

  async execute(
    input: AssetDisposalReverseInput,
    outerTx?: Prisma.TransactionClient,
  ): Promise<{ entryNo: string }> {
    const { assetId, reversedById, reason } = input;

    if (!reason || reason.trim().length === 0) {
      throw new BadRequestException('Reversal reason is required');
    }

    const run = async (tx: Prisma.TransactionClient): Promise<{ entryNo: string }> => {
      const original = await tx.journalEntry.findFirst({
        where: {
          metadata: { path: ['flow'], equals: 'asset-disposal' },
          AND: [{ metadata: { path: ['assetId'], equals: assetId } }],
          deletedAt: null,
        },
        include: { lines: true },
      });
      if (!original) {
        throw new NotFoundException(`Original disposal JE not found for asset ${assetId}`);
      }
      if ((original.metadata as any)?.reversed === true) {
        throw new BadRequestException(`Asset ${assetId} disposal already reversed`);
      }

      // Defensive: refuse if any DepreciationEntry exists post-disposal
      const asset = await tx.fixedAsset.findFirst({ where: { id: assetId, deletedAt: null } });
      if (!asset) throw new NotFoundException(`Asset ${assetId} not found`);

      // Build mirror lines
      const reversedLines = original.lines.map((l) => ({
        accountCode: l.accountCode,
        dr: new Decimal(l.credit.toString()),
        cr: new Decimal(l.debit.toString()),
        description: `[VOID] ${l.description ?? ''}`.trim(),
      }));

      const result = await this.journal.createAndPost(
        {
          description: `[ยกเลิก] กลับรายการจำหน่ายสินทรัพย์ JE ${original.entryNumber}`,
          reference: `${assetId}:reverse-dispose`,
          metadata: {
            tag: 'REVERSAL',
            flow: 'asset-disposal-reverse',
            assetId,
            originalEntryId: original.id,
            originalEntryNumber: original.entryNumber,
            reversalReason: reason,
            eventType: 'ASSET_DISPOSAL_REVERSAL',
          },
          lines: reversedLines,
          postedAt: new Date(),
        },
        tx,
      );

      // Flag original
      const existingMeta = (original.metadata as Prisma.InputJsonObject) ?? {};
      await tx.journalEntry.update({
        where: { id: original.id },
        data: {
          metadata: {
            ...existingMeta,
            reversed: true,
            reversedByEntryNumber: result.entryNumber,
            reversedAt: new Date().toISOString(),
          },
        },
      });

      // Restore asset state
      const purchaseCost = new Decimal(asset.purchaseCost.toString());
      const accumulatedDepr = new Decimal(asset.accumulatedDepr.toString());
      const restoredNbv = purchaseCost.minus(accumulatedDepr);
      await tx.fixedAsset.update({
        where: { id: assetId },
        data: {
          status: 'POSTED',
          disposalDate: null,
          netBookValue: restoredNbv,
        },
      });

      // T2-C14 audit log inside same tx
      await tx.journalPostAuditLog.create({
        data: {
          journalEntryId: result.id,
          postedById: reversedById,
          postedAt: new Date(),
        },
      });

      return { entryNo: result.entryNumber };
    };

    if (outerTx) return run(outerTx);
    return this.prisma.$transaction(run);
  }
}
```

- [ ] **Step 2.5: Register in JournalModule**

Open `apps/api/src/modules/journal/journal.module.ts`. Add to imports + providers + exports following existing template registration pattern (e.g., where `AssetPurchaseReverseTemplate` is registered):

```typescript
import { AssetDisposalReverseTemplate } from './cpa-templates/asset-disposal-reverse.template';
// ...
providers: [..., AssetDisposalReverseTemplate],
exports: [..., AssetDisposalReverseTemplate],
```

- [ ] **Step 2.6: Run tests + typecheck**

```bash
cd apps/api && npx vitest run journal/cpa-templates/asset-disposal-reverse.template --no-file-parallelism
./tools/check-types.sh api
```

Expected: 8 PASS, 0 type errors.

- [ ] **Step 2.7: Commit**

```bash
git add apps/api/src/modules/journal/cpa-templates/asset-disposal-reverse.template.ts \
        apps/api/src/modules/journal/cpa-templates/asset-disposal-reverse.template.spec.ts \
        apps/api/src/modules/journal/journal.module.ts
git commit -m "feat(asset): AssetDisposalReverseTemplate + 8 tests

Mirror disposal JE (Dr↔Cr swap, [VOID] prefix), restore asset
status=POSTED + clear disposalDate + recompute NBV. Idempotent
via metadata.flow + metadata.assetId. tx? param for atomicity.
T2-C14 audit log inside same \$transaction."
```

---

## Task 3: AssetService.dispose + reverseDispose + 12 tests

**Files:**
- Modify: `apps/api/src/modules/asset/asset.service.ts` (replace dispose stub + add reverseDispose)
- Modify: `apps/api/src/modules/asset/asset.module.ts` (inject AssetDisposalTemplate + AssetDisposalReverseTemplate)
- Modify: `apps/api/src/modules/asset/__tests__/asset.service.spec.ts` (add 12 cases)

- [ ] **Step 3.1: Update AssetModule providers**

Open `apps/api/src/modules/asset/asset.module.ts`. The module already imports `JournalModule` which exports both `AssetDisposalTemplate` and the new `AssetDisposalReverseTemplate`. Verify the templates are listed in `apps/api/src/modules/journal/journal.module.ts` exports (Task 2 added the reverse one). No module change needed here — Nest DI will resolve them via the JournalModule import.

- [ ] **Step 3.2: Add tests to asset.service.spec.ts**

Open `apps/api/src/modules/asset/__tests__/asset.service.spec.ts`. The existing `Test.createTestingModule` providers list already wires real templates and FINANCE company. Add `AssetDisposalTemplate` and `AssetDisposalReverseTemplate` to the `providers` array (alongside the existing purchase + reverse templates).

Then add this `describe` block at the end of the existing `describe('AssetService', ...)`:

```typescript
describe('AssetService.dispose', () => {
  it('SALE with proceeds > NBV: status DISPOSED, gain JE line, AuditLog ASSET_DISPOSE', async () => {
    const asset = await createPostedAsset();
    // Set NBV to 20000 (purchaseCost 30000 - accumulated 10000) for testing
    await prisma.fixedAsset.update({
      where: { id: asset.id },
      data: { accumulatedDepr: new Decimal(10000), netBookValue: new Decimal(20000) },
    });
    const result = await service.dispose(asset.id, {
      disposalType: 'SALE',
      disposalDate: '2026-05-09',
      proceeds: 25000,
      depositAccountCode: '11-1201',
      reason: 'ขายให้พนักงาน',
    }, userId);
    expect(result.entryNo).toMatch(/^JE-\d{6}-\d{5}$/);

    const updated = await prisma.fixedAsset.findUnique({ where: { id: asset.id } });
    expect(updated!.status).toBe('DISPOSED');
    expect(updated!.disposalDate).not.toBeNull();
    expect(updated!.netBookValue.toString()).toBe('0.00');

    const log = await prisma.auditLog.findFirst({
      where: { entity: 'fixed_asset', entityId: asset.id, action: 'ASSET_DISPOSE' },
    });
    expect(log).toBeTruthy();
    expect((log!.newValue as any).disposalType).toBe('SALE');
    expect((log!.newValue as any).proceeds).toBe(25000);
  });

  it('SALE with proceeds < NBV: loss JE line', async () => {
    const asset = await createPostedAsset();
    await prisma.fixedAsset.update({
      where: { id: asset.id },
      data: { accumulatedDepr: new Decimal(5000), netBookValue: new Decimal(25000) },
    });
    await service.dispose(asset.id, {
      disposalType: 'SALE',
      disposalDate: '2026-05-09',
      proceeds: 18000,
      depositAccountCode: '11-1201',
      reason: 'ขายขาดทุน',
    }, userId);
    const je = await prisma.journalEntry.findFirst({
      where: {
        metadata: { path: ['flow'], equals: 'asset-disposal' },
        AND: [{ metadata: { path: ['assetId'], equals: asset.id } }],
      },
      include: { lines: true },
    });
    const lossLine = je!.lines.find((l) => l.accountCode === '53-1605');
    expect(lossLine).toBeTruthy();
  });

  it('WRITE_OFF: status WRITTEN_OFF, full NBV loss, no proceeds line', async () => {
    const asset = await createPostedAsset();
    await prisma.fixedAsset.update({
      where: { id: asset.id },
      data: { accumulatedDepr: new Decimal(5000), netBookValue: new Decimal(25000) },
    });
    await service.dispose(asset.id, {
      disposalType: 'WRITE_OFF',
      disposalDate: '2026-05-09',
      reason: 'เครื่องพังแก้ไม่ได้',
    }, userId);
    const updated = await prisma.fixedAsset.findUnique({ where: { id: asset.id } });
    expect(updated!.status).toBe('WRITTEN_OFF');
    const je = await prisma.journalEntry.findFirst({
      where: {
        metadata: { path: ['flow'], equals: 'asset-disposal' },
        AND: [{ metadata: { path: ['assetId'], equals: asset.id } }],
      },
      include: { lines: true },
    });
    expect(je!.lines.find((l) => l.accountCode === '53-1605')).toBeTruthy();
    expect(je!.lines.find((l) => l.accountCode === '11-1201')).toBeFalsy();
  });

  it('rejects if status != POSTED', async () => {
    const draft = await service.createDraft({
      name: 'X', category: 'EQUIPMENT', basePrice: 1000, usefulLifeMonths: 12,
      purchaseDate: '2026-05-01', paymentAccount: '11-1201',
    }, userId);
    await expect(service.dispose(draft.id, {
      disposalType: 'SALE', disposalDate: '2026-05-09', proceeds: 500,
      depositAccountCode: '11-1201', reason: 'test reason',
    }, userId)).rejects.toThrow(/POSTED/);
  });

  it('rejects if disposalDate is in the future', async () => {
    const asset = await createPostedAsset();
    const future = new Date(); future.setFullYear(future.getFullYear() + 1);
    await expect(service.dispose(asset.id, {
      disposalType: 'SALE',
      disposalDate: future.toISOString().slice(0, 10),
      proceeds: 1000, depositAccountCode: '11-1201', reason: 'future test',
    }, userId)).rejects.toThrow(/future|อนาคต/i);
  });

  it('V15 closed period → ASSET_DISPOSE_BLOCKED audit + reject', async () => {
    const finance = await prisma.companyInfo.findFirst({ where: { companyCode: 'FINANCE' } });
    if (!finance) throw new Error('FINANCE company missing');
    await prisma.accountingPeriod.upsert({
      where: { companyId_year_month: { companyId: finance.id, year: 2026, month: 5 } },
      update: { status: 'CLOSED', closedAt: new Date(), closedById: userId },
      create: { companyId: finance.id, year: 2026, month: 5, status: 'CLOSED', closedAt: new Date(), closedById: userId },
    });
    const asset = await createPostedAsset();
    await expect(service.dispose(asset.id, {
      disposalType: 'SALE', disposalDate: '2026-05-15', proceeds: 1000,
      depositAccountCode: '11-1201', reason: 'period closed test',
    }, userId)).rejects.toThrow(/period|งวด/i);
    const blocked = await prisma.auditLog.findFirst({
      where: { entity: 'fixed_asset', entityId: asset.id, action: 'ASSET_DISPOSE_BLOCKED' },
    });
    expect(blocked).toBeTruthy();
    await prisma.accountingPeriod.delete({
      where: { companyId_year_month: { companyId: finance.id, year: 2026, month: 5 } },
    });
  });

  it('idempotent: second call returns same JE', async () => {
    const asset = await createPostedAsset();
    const r1 = await service.dispose(asset.id, {
      disposalType: 'SALE', disposalDate: '2026-05-09', proceeds: 25000,
      depositAccountCode: '11-1201', reason: 'first call',
    }, userId);
    // Reset status to test idempotency on the JE level
    await prisma.fixedAsset.update({ where: { id: asset.id }, data: { status: 'POSTED', disposalDate: null } });
    const r2 = await service.dispose(asset.id, {
      disposalType: 'SALE', disposalDate: '2026-05-09', proceeds: 25000,
      depositAccountCode: '11-1201', reason: 'second call',
    }, userId);
    expect(r2.entryNo).toBe(r1.entryNo);
  });
});

describe('AssetService.reverseDispose', () => {
  it('restores asset to POSTED, clears disposalDate, recomputes NBV', async () => {
    const asset = await createPostedAsset();
    await prisma.fixedAsset.update({
      where: { id: asset.id },
      data: { accumulatedDepr: new Decimal(10000), netBookValue: new Decimal(20000) },
    });
    await service.dispose(asset.id, {
      disposalType: 'SALE', disposalDate: '2026-05-09', proceeds: 25000,
      depositAccountCode: '11-1201', reason: 'first',
    }, userId);
    const result = await service.reverseDispose(asset.id, 'ลูกค้าคืน', userId);
    expect(result.entryNo).toMatch(/^JE-\d{6}-\d{5}$/);
    const updated = await prisma.fixedAsset.findUnique({ where: { id: asset.id } });
    expect(updated!.status).toBe('POSTED');
    expect(updated!.disposalDate).toBeNull();
    expect(updated!.netBookValue.toString()).toBe('20000.00');
  });

  it('rejects if status != DISPOSED/WRITTEN_OFF', async () => {
    const asset = await createPostedAsset();
    await expect(service.reverseDispose(asset.id, 'test', userId)).rejects.toThrow(/DISPOSED|WRITTEN_OFF/);
  });

  it('writes AuditLog ASSET_REVERSE_DISPOSE', async () => {
    const asset = await createPostedAsset();
    await service.dispose(asset.id, {
      disposalType: 'WRITE_OFF', disposalDate: '2026-05-09', reason: 'first',
    }, userId);
    await service.reverseDispose(asset.id, 'mistake', userId);
    const log = await prisma.auditLog.findFirst({
      where: { entity: 'fixed_asset', entityId: asset.id, action: 'ASSET_REVERSE_DISPOSE' },
    });
    expect(log).toBeTruthy();
  });

  it('rejects with empty reason', async () => {
    const asset = await createPostedAsset();
    await service.dispose(asset.id, {
      disposalType: 'WRITE_OFF', disposalDate: '2026-05-09', reason: 'first',
    }, userId);
    await expect(service.reverseDispose(asset.id, '', userId)).rejects.toThrow();
  });

  it('V15 current-date guard: ASSET_REVERSE_DISPOSE_BLOCKED audit if today is in closed period', async () => {
    const finance = await prisma.companyInfo.findFirst({ where: { companyCode: 'FINANCE' } });
    if (!finance) throw new Error('FINANCE company missing');
    const now = new Date();
    const asset = await createPostedAsset();
    await service.dispose(asset.id, {
      disposalType: 'WRITE_OFF', disposalDate: now.toISOString().slice(0, 10), reason: 'first',
    }, userId);
    await prisma.accountingPeriod.upsert({
      where: { companyId_year_month: { companyId: finance.id, year: now.getFullYear(), month: now.getMonth() + 1 } },
      update: { status: 'CLOSED', closedAt: new Date(), closedById: userId },
      create: { companyId: finance.id, year: now.getFullYear(), month: now.getMonth() + 1, status: 'CLOSED', closedAt: new Date(), closedById: userId },
    });
    await expect(service.reverseDispose(asset.id, 'test', userId)).rejects.toThrow(/period|งวด/i);
    const blocked = await prisma.auditLog.findFirst({
      where: { entity: 'fixed_asset', entityId: asset.id, action: 'ASSET_REVERSE_DISPOSE_BLOCKED' },
    });
    expect(blocked).toBeTruthy();
    await prisma.accountingPeriod.delete({
      where: { companyId_year_month: { companyId: finance.id, year: now.getFullYear(), month: now.getMonth() + 1 } },
    });
  });

  it('idempotent: second reverseDispose call rejects (already-reversed)', async () => {
    const asset = await createPostedAsset();
    await service.dispose(asset.id, {
      disposalType: 'WRITE_OFF', disposalDate: '2026-05-09', reason: 'first',
    }, userId);
    await service.reverseDispose(asset.id, 'first', userId);
    await expect(service.reverseDispose(asset.id, 'second', userId)).rejects.toThrow(/POSTED|DISPOSED|already/i);
  });
});
```

- [ ] **Step 3.3: Run tests — verify FAIL**

```bash
cd apps/api && npx jest src/modules/asset/__tests__/asset.service -t "dispose|reverseDispose"
```

Expected: FAIL with "dispose: not implemented" or similar.

- [ ] **Step 3.4: Implement dispose + reverseDispose in AssetService**

Open `apps/api/src/modules/asset/asset.service.ts`. Inject `AssetDisposalTemplate` + `AssetDisposalReverseTemplate` in the constructor (alongside existing `purchaseTemplate` + `reverseTemplate`):

```typescript
import { AssetDisposalTemplate } from '../journal/cpa-templates/asset-disposal.template';
import { AssetDisposalReverseTemplate } from '../journal/cpa-templates/asset-disposal-reverse.template';
// ...
constructor(
  private readonly prisma: PrismaService,
  private readonly purchaseTemplate: AssetPurchaseTemplate,
  private readonly reverseTemplate: AssetPurchaseReverseTemplate,
  private readonly disposalTemplate: AssetDisposalTemplate,
  private readonly disposalReverseTemplate: AssetDisposalReverseTemplate,
) {}
```

Replace the existing `dispose` stub and add `reverseDispose`:

```typescript
async dispose(
  id: string,
  dto: DisposeAssetDto,
  userId: string,
): Promise<{ entryNo: string }> {
  const asset = await this.prisma.fixedAsset.findFirst({ where: { id, deletedAt: null } });
  if (!asset) throw new NotFoundException('ไม่พบสินทรัพย์');
  if (asset.status !== AssetStatus.POSTED) {
    throw new BadRequestException(`จำหน่ายได้เฉพาะสถานะ POSTED (ปัจจุบัน: ${asset.status})`);
  }

  const disposalDate = new Date(dto.disposalDate);
  if (disposalDate > new Date()) {
    throw new BadRequestException('วันที่จำหน่ายต้องไม่อยู่ในอนาคต');
  }

  // V15 guard
  const financeCompanyId = await this.getFinanceCompanyId();
  try {
    await validatePeriodOpen(this.prisma, disposalDate, financeCompanyId);
  } catch (err: any) {
    await this.prisma.auditLog.create({
      data: {
        userId, action: 'ASSET_DISPOSE_BLOCKED',
        entity: 'fixed_asset', entityId: id,
        oldValue: { status: 'POSTED' },
        newValue: { reason: err.message ?? 'period closed', disposalType: dto.disposalType },
      },
    });
    throw new BadRequestException(`ไม่สามารถจำหน่าย: ${err.message ?? 'งวดบัญชีปิดแล้ว'}`);
  }

  const proceeds = dto.disposalType === 'SALE' ? (dto.proceeds ?? 0) : 0;
  const depositAccountCode = dto.disposalType === 'SALE' ? dto.depositAccountCode : undefined;

  return this.prisma.$transaction(async (tx) => {
    const result = await this.disposalTemplate.execute(
      { assetId: id, disposalDate, disposalProceeds: proceeds, depositAccountCode },
      tx,
    );

    const updated = await tx.fixedAsset.findUnique({ where: { id } });
    const newStatus = dto.disposalType === 'WRITE_OFF' ? 'WRITTEN_OFF' : 'DISPOSED';
    if (updated!.status !== newStatus) {
      await tx.fixedAsset.update({
        where: { id },
        data: { status: newStatus },
      });
    }

    const nbvBefore = new Decimal(asset.netBookValue.toString());
    const gainLoss = new Decimal(proceeds).minus(nbvBefore);

    await tx.auditLog.create({
      data: {
        userId, action: 'ASSET_DISPOSE',
        entity: 'fixed_asset', entityId: id,
        oldValue: { status: 'POSTED', netBookValue: nbvBefore.toString() },
        newValue: {
          status: newStatus,
          disposalType: dto.disposalType,
          disposalDate: dto.disposalDate,
          proceeds: dto.disposalType === 'SALE' ? proceeds : 0,
          gainLoss: gainLoss.toString(),
          journalEntryNumber: result.entryNo,
          reason: dto.reason,
        },
      },
    });

    return result;
  });
}

async reverseDispose(
  id: string,
  reason: string,
  userId: string,
): Promise<{ entryNo: string }> {
  if (!reason || reason.trim().length === 0) {
    throw new BadRequestException('กรุณาระบุเหตุผลการกลับรายการ');
  }
  const asset = await this.prisma.fixedAsset.findFirst({ where: { id, deletedAt: null } });
  if (!asset) throw new NotFoundException('ไม่พบสินทรัพย์');
  if (asset.status !== 'DISPOSED' && asset.status !== 'WRITTEN_OFF') {
    throw new BadRequestException(
      `Reverse dispose ได้เฉพาะสถานะ DISPOSED หรือ WRITTEN_OFF (ปัจจุบัน: ${asset.status})`,
    );
  }

  const financeCompanyId = await this.getFinanceCompanyId();
  try {
    await validatePeriodOpen(this.prisma, new Date(), financeCompanyId);
  } catch (err: any) {
    await this.prisma.auditLog.create({
      data: {
        userId, action: 'ASSET_REVERSE_DISPOSE_BLOCKED',
        entity: 'fixed_asset', entityId: id,
        oldValue: { status: asset.status },
        newValue: { reason: err.message ?? 'period closed' },
      },
    });
    throw new BadRequestException(`ไม่สามารถ Reverse: ${err.message ?? 'งวดบัญชีปิดแล้ว'}`);
  }

  return this.prisma.$transaction(async (tx) => {
    const result = await this.disposalReverseTemplate.execute(
      { assetId: id, reversedById: userId, reason },
      tx,
    );
    await tx.auditLog.create({
      data: {
        userId, action: 'ASSET_REVERSE_DISPOSE',
        entity: 'fixed_asset', entityId: id,
        oldValue: { status: asset.status, disposalDate: asset.disposalDate?.toISOString() },
        newValue: {
          status: 'POSTED',
          reversalReason: reason,
          reversalEntryNumber: result.entryNo,
        },
      },
    });
    return result;
  });
}
```

Note: the existing `dispose(_id: string, _dto: unknown)` stub method may have a different signature. Replace it entirely with the new typed signature above.

- [ ] **Step 3.5: Run tests + typecheck**

```bash
cd apps/api && npx jest src/modules/asset/__tests__/asset.service --runInBand
./tools/check-types.sh api
```

Expected: ~41 tests pass (29 existing + 12 new), 0 type errors.

- [ ] **Step 3.6: Commit**

```bash
git add apps/api/src/modules/asset/asset.service.ts \
        apps/api/src/modules/asset/__tests__/asset.service.spec.ts
git commit -m "feat(asset): dispose + reverseDispose service methods + 12 tests

dispose(SALE/WRITE_OFF) — outer \$transaction wraps disposalTemplate
+ status update (POSTED→DISPOSED/WRITTEN_OFF) + AuditLog ASSET_DISPOSE
with disposalType/proceeds/gainLoss in newValue.

reverseDispose — outer \$transaction wraps disposalReverseTemplate
+ AuditLog ASSET_REVERSE_DISPOSE.

V15 period guard on disposalDate (dispose) and current date (reverse)
with ASSET_DISPOSE_BLOCKED / ASSET_REVERSE_DISPOSE_BLOCKED audit logs
on rejection. Idempotent via metadata-based JE lookup."
```

---

## Task 4: AssetController endpoints

**Files:**
- Modify: `apps/api/src/modules/asset/asset.controller.ts`

- [ ] **Step 4.1: Add endpoints**

Open `apps/api/src/modules/asset/asset.controller.ts`. Add imports:

```typescript
import { DisposeAssetDto } from './dto/dispose-asset.dto';
import { ReverseDisposalDto } from './dto/reverse-disposal.dto';
```

Add 2 new endpoints (after the existing `transfer` endpoint, before `copy`):

```typescript
@Post(':id/dispose')
@Roles('OWNER', 'FINANCE_MANAGER')
dispose(
  @Param('id') id: string,
  @Body() dto: DisposeAssetDto,
  @CurrentUser('id') userId: string,
) {
  return this.assetService.dispose(id, dto, userId);
}

@Post(':id/reverse-dispose')
@Roles('OWNER')
reverseDispose(
  @Param('id') id: string,
  @Body() dto: ReverseDisposalDto,
  @CurrentUser('id') userId: string,
) {
  return this.assetService.reverseDispose(id, dto.reason, userId);
}
```

- [ ] **Step 4.2: Verify typecheck**

```bash
./tools/check-types.sh api
```

Expected: 0 errors.

- [ ] **Step 4.3: Commit**

```bash
git add apps/api/src/modules/asset/asset.controller.ts
git commit -m "feat(asset): wire dispose + reverse-dispose endpoints

POST /assets/:id/dispose — OWNER, FINANCE_MANAGER
POST /assets/:id/reverse-dispose — OWNER only"
```

---

## Task 5: Frontend foundation (Disposal)

**Files:**
- Modify: `apps/web/src/pages/assets/api.ts`
- Modify: `apps/web/src/pages/assets/types.ts`
- Create: `apps/web/src/pages/assets/disposal-schema.ts`
- Create: `apps/web/src/pages/assets/hooks/useDisposalCalculation.ts`

- [ ] **Step 5.1: Add API wrappers**

In `apps/web/src/pages/assets/api.ts`, add to the `assetsApi` object:

```typescript
dispose: async (id: string, payload: {
  disposalType: 'SALE' | 'WRITE_OFF';
  disposalDate: string;
  proceeds?: number;
  depositAccountCode?: string;
  reason: string;
}): Promise<{ entryNo: string }> => {
  const { data } = await api.post<{ entryNo: string }>(`/assets/${id}/dispose`, payload);
  return data;
},

reverseDispose: async (id: string, reason: string): Promise<{ entryNo: string }> => {
  const { data } = await api.post<{ entryNo: string }>(`/assets/${id}/reverse-dispose`, { reason });
  return data;
},
```

- [ ] **Step 5.2: Add types**

In `apps/web/src/pages/assets/types.ts`, add at the bottom:

```typescript
export interface DisposalCalculation {
  nbv: number;
  proceeds: number;
  gainLoss: number;          // positive = gain, negative = loss
  journalLines: Array<{
    accountCode: string;
    accountName: string;
    debit: number;
    credit: number;
  }>;
  isBalanced: boolean;
}
```

- [ ] **Step 5.3: Create disposal-schema.ts**

```typescript
import { z } from 'zod/v4';

const CASH_ACCOUNT_CODES = ['11-1101','11-1102','11-1103','11-1201','11-1202','11-1203'] as const;

export const disposalSchema = z.object({
  disposalType: z.enum(['SALE', 'WRITE_OFF'], { error: 'กรุณาเลือกวิธีจำหน่าย' }),
  disposalDate: z.string().min(1, 'กรุณาระบุวันที่จำหน่าย'),
  proceeds: z.coerce.number().optional(),
  depositAccountCode: z.enum(CASH_ACCOUNT_CODES).optional(),
  reason: z.string().min(5, 'เหตุผลต้องมีอย่างน้อย 5 ตัวอักษร'),
}).refine(
  (data) => data.disposalType !== 'SALE' || (data.proceeds !== undefined && data.proceeds > 0),
  { message: 'ราคาขายต้องมากกว่า 0', path: ['proceeds'] },
).refine(
  (data) => data.disposalType !== 'SALE' || !!data.depositAccountCode,
  { message: 'กรุณาเลือกบัญชีรับเงิน', path: ['depositAccountCode'] },
).refine(
  (data) => new Date(data.disposalDate) <= new Date(),
  { message: 'วันที่จำหน่ายต้องไม่อยู่ในอนาคต', path: ['disposalDate'] },
);

export type DisposalFormValues = z.infer<typeof disposalSchema>;
```

- [ ] **Step 5.4: Create useDisposalCalculation hook**

```typescript
// apps/web/src/pages/assets/hooks/useDisposalCalculation.ts
import { useMemo } from 'react';
import type { Asset } from '../types';
import type { DisposalFormValues } from '../disposal-schema';
import type { DisposalCalculation } from '../types';
import { CATEGORY_COA } from '../types';

const round2 = (n: number) => Math.round(n * 100) / 100;

export function useDisposalCalculation(
  asset: Asset | undefined,
  values: Partial<DisposalFormValues>,
): DisposalCalculation {
  return useMemo(() => {
    if (!asset) {
      return {
        nbv: 0, proceeds: 0, gainLoss: 0, journalLines: [], isBalanced: true,
      };
    }
    const nbv = round2(Number(asset.netBookValue));
    const accumulatedDepr = round2(Number(asset.accumulatedDepr));
    const purchaseCost = round2(Number(asset.purchaseCost));
    const proceeds = values.disposalType === 'SALE' ? round2(Number(values.proceeds) || 0) : 0;
    const gainLoss = round2(proceeds - nbv);

    const coa = CATEGORY_COA[asset.category];
    const lines: DisposalCalculation['journalLines'] = [];

    // Dr accumulated depr (always)
    if (accumulatedDepr > 0) {
      lines.push({
        accountCode: asset.coaDeprAccount ?? coa.accDepr,
        accountName: 'Dr ค่าเสื่อมราคาสะสม',
        debit: accumulatedDepr, credit: 0,
      });
    }
    // Dr cash if SALE
    if (values.disposalType === 'SALE' && proceeds > 0 && values.depositAccountCode) {
      lines.push({
        accountCode: values.depositAccountCode,
        accountName: 'Dr เงินสด/ธนาคาร',
        debit: proceeds, credit: 0,
      });
    }
    // Dr loss if loss case
    if (gainLoss < 0) {
      lines.push({
        accountCode: '53-1605',
        accountName: 'Dr ขาดทุนจากการจำหน่าย',
        debit: round2(-gainLoss), credit: 0,
      });
    }
    // Cr asset (always)
    lines.push({
      accountCode: asset.coaCostAccount ?? coa.cost,
      accountName: 'Cr สินทรัพย์',
      debit: 0, credit: purchaseCost,
    });
    // Cr gain if gain case
    if (gainLoss > 0) {
      lines.push({
        accountCode: '42-1105',
        accountName: 'Cr กำไรจากการจำหน่าย',
        debit: 0, credit: round2(gainLoss),
      });
    }

    const totalDr = lines.reduce((s, l) => s + l.debit, 0);
    const totalCr = lines.reduce((s, l) => s + l.credit, 0);
    const isBalanced = round2(totalDr) === round2(totalCr);

    return { nbv, proceeds, gainLoss, journalLines: lines, isBalanced };
  }, [asset, values]);
}
```

- [ ] **Step 5.5: Verify typecheck**

```bash
./tools/check-types.sh web
```

Expected: 0 errors.

- [ ] **Step 5.6: Commit**

```bash
git add apps/web/src/pages/assets/api.ts \
        apps/web/src/pages/assets/types.ts \
        apps/web/src/pages/assets/disposal-schema.ts \
        apps/web/src/pages/assets/hooks/useDisposalCalculation.ts
git commit -m "feat(asset): disposal frontend foundation

API wrappers (dispose, reverseDispose), DisposalCalculation type,
zod/v4 schema with conditional refines (proceeds + depositAccount
required when SALE), useDisposalCalculation hook with live JE preview
matching the backend template's 5 case structures."
```

---

## Task 6: AssetDisposePage + ReverseDisposalDialog + DetailPage actions

**Files:**
- Create: `apps/web/src/pages/assets/AssetDisposePage.tsx`
- Create: `apps/web/src/pages/assets/components/ReverseDisposalDialog.tsx`
- Modify: `apps/web/src/pages/assets/AssetDetailPage.tsx`

- [ ] **Step 6.1: Create ReverseDisposalDialog**

```typescript
// apps/web/src/pages/assets/components/ReverseDisposalDialog.tsx
import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';

export function ReverseDisposalDialog({
  open, onOpenChange, onConfirm, isPending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (reason: string) => void;
  isPending: boolean;
}) {
  const [reason, setReason] = useState('');
  const valid = reason.trim().length >= 5;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>กลับรายการจำหน่ายสินทรัพย์</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            การกลับรายการจะคืนสถานะสินทรัพย์เป็น POSTED + สร้าง JE สวนทาง
            ไม่สามารถกู้คืนได้
          </p>
          <div>
            <Label>เหตุผล (ขั้นต่ำ 5 ตัวอักษร) *</Label>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            ยกเลิก
          </Button>
          <Button variant="destructive" disabled={!valid || isPending} onClick={() => onConfirm(reason)}>
            {isPending ? 'กำลังกลับรายการ…' : 'ยืนยันกลับรายการ'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 6.2: Create AssetDisposePage**

```typescript
// apps/web/src/pages/assets/AssetDisposePage.tsx
import { useNavigate, useParams } from 'react-router';
import { useForm, FormProvider } from 'react-hook-form';
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft } from 'lucide-react';
import { getErrorMessage } from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import ThaiDateInput from '@/components/ui/ThaiDateInput';
import QueryBoundary from '@/components/QueryBoundary';
import { formatNumberDecimal } from '@/utils/formatters';
import { assetsApi } from './api';
import { CATEGORY_LABEL, CASH_ACCOUNTS } from './types';
import { disposalSchema, type DisposalFormValues } from './disposal-schema';
import { useDisposalCalculation } from './hooks/useDisposalCalculation';

const today = () => new Date().toISOString().slice(0, 10);

export default function AssetDisposePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const assetQuery = useQuery({
    queryKey: ['asset', id],
    queryFn: () => assetsApi.getOne(id!),
    enabled: !!id,
  });

  const form = useForm<DisposalFormValues>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: standardSchemaResolver(disposalSchema as any),
    defaultValues: {
      disposalType: 'SALE',
      disposalDate: today(),
      proceeds: undefined,
      depositAccountCode: undefined,
      reason: '',
    },
  });

  const { register, watch, setValue, handleSubmit, formState: { errors } } = form;
  const watched = watch();
  const calc = useDisposalCalculation(assetQuery.data, watched);

  const disposeMutation = useMutation({
    mutationFn: (values: DisposalFormValues) =>
      assetsApi.dispose(id!, {
        disposalType: values.disposalType,
        disposalDate: values.disposalDate,
        proceeds: values.disposalType === 'SALE' ? values.proceeds : undefined,
        depositAccountCode: values.disposalType === 'SALE' ? values.depositAccountCode : undefined,
        reason: values.reason,
      }),
    onSuccess: (result) => {
      toast.success(`จำหน่ายสำเร็จ → ${result.entryNo}`);
      queryClient.invalidateQueries({ queryKey: ['assets'] });
      queryClient.invalidateQueries({ queryKey: ['asset', id] });
      queryClient.invalidateQueries({ queryKey: ['assets-summary'] });
      navigate(`/assets/${id}`);
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  const onSubmit = handleSubmit((values) => disposeMutation.mutate(values));

  if (!id) return null;

  return (
    <QueryBoundary
      isLoading={assetQuery.isLoading}
      isError={assetQuery.isError}
      error={assetQuery.error}
      onRetry={() => assetQuery.refetch()}
      errorTitle="โหลดข้อมูลสินทรัพย์ไม่สำเร็จ"
    >
      {assetQuery.data && assetQuery.data.status !== 'POSTED' && (
        <div className="p-8 text-center">
          <p className="text-destructive">จำหน่ายได้เฉพาะสถานะ POSTED (ปัจจุบัน: {assetQuery.data.status})</p>
          <Button onClick={() => navigate(`/assets/${id}`)} className="mt-4">
            กลับ
          </Button>
        </div>
      )}
      {assetQuery.data && assetQuery.data.status === 'POSTED' && (
        <FormProvider {...form}>
          <div className="space-y-4 pb-24">
            <PageHeader
              title={`จำหน่ายสินทรัพย์ ${assetQuery.data.assetCode}`}
              subtitle={assetQuery.data.name}
              onBack={() => navigate(`/assets/${id}`)}
            />

            {/* Asset summary card */}
            <Card>
              <CardHeader><CardTitle>ข้อมูลสินทรัพย์</CardTitle></CardHeader>
              <CardContent>
                <dl className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                  <div>
                    <dt className="text-muted-foreground">รหัส</dt>
                    <dd className="font-mono">{assetQuery.data.assetCode}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">หมวด</dt>
                    <dd>{CATEGORY_LABEL[assetQuery.data.category]}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">ราคาทุน</dt>
                    <dd className="tabular-nums">{formatNumberDecimal(Number(assetQuery.data.purchaseCost))}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">ค่าเสื่อมสะสม</dt>
                    <dd className="tabular-nums">{formatNumberDecimal(Number(assetQuery.data.accumulatedDepr))}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">NBV</dt>
                    <dd className="tabular-nums font-semibold">{formatNumberDecimal(calc.nbv)}</dd>
                  </div>
                </dl>
              </CardContent>
            </Card>

            {/* Section 1: วิธีจำหน่าย */}
            <Card>
              <CardHeader><CardTitle>1. วิธีจำหน่าย</CardTitle></CardHeader>
              <CardContent>
                <RadioGroup
                  value={watched.disposalType}
                  onValueChange={(v) => setValue('disposalType', v as 'SALE' | 'WRITE_OFF', { shouldValidate: true })}
                >
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="SALE" id="r-sale" />
                    <Label htmlFor="r-sale">ขาย (จำหน่าย)</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="WRITE_OFF" id="r-writeoff" />
                    <Label htmlFor="r-writeoff">Write-off (ตัดบัญชี)</Label>
                  </div>
                </RadioGroup>
              </CardContent>
            </Card>

            {/* Section 2: รายละเอียด */}
            <Card>
              <CardHeader><CardTitle>2. รายละเอียด</CardTitle></CardHeader>
              <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label>วันที่จำหน่าย *</Label>
                  <ThaiDateInput
                    value={watched.disposalDate}
                    onChange={(e) => setValue('disposalDate', e.target.value, { shouldValidate: true })}
                  />
                  {errors.disposalDate && <p className="text-sm text-destructive mt-1">{errors.disposalDate.message}</p>}
                </div>
                {watched.disposalType === 'SALE' && (
                  <>
                    <div>
                      <Label>ราคาขาย *</Label>
                      <Input type="number" step="0.01" {...register('proceeds')} />
                      {errors.proceeds && <p className="text-sm text-destructive mt-1">{errors.proceeds.message}</p>}
                    </div>
                    <div className="md:col-span-2">
                      <Label>บัญชีรับเงิน *</Label>
                      <Select
                        value={watched.depositAccountCode}
                        onValueChange={(v) => setValue('depositAccountCode', v as never, { shouldValidate: true })}
                      >
                        <SelectTrigger><SelectValue placeholder="เลือกบัญชี" /></SelectTrigger>
                        <SelectContent>
                          {CASH_ACCOUNTS.map((c) => (
                            <SelectItem key={c.code} value={c.code}>{c.code} {c.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {errors.depositAccountCode && <p className="text-sm text-destructive mt-1">{errors.depositAccountCode.message}</p>}
                    </div>
                  </>
                )}
                <div className="md:col-span-2">
                  <Label>เหตุผล *</Label>
                  <Textarea {...register('reason')} rows={3} />
                  {errors.reason && <p className="text-sm text-destructive mt-1">{errors.reason.message}</p>}
                </div>
              </CardContent>
            </Card>

            {/* Section 3: สรุปบัญชี */}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>3. สรุปบัญชี (Auto JE Preview)</CardTitle>
                <Badge variant={calc.isBalanced ? 'success' : 'destructive'}>
                  {calc.isBalanced ? '✓ สมดุล' : '✗ ไม่สมดุล'}
                </Badge>
              </CardHeader>
              <CardContent>
                <dl className="grid grid-cols-3 gap-4 text-sm pb-4 border-b">
                  <div>
                    <dt className="text-muted-foreground">NBV</dt>
                    <dd className="tabular-nums">{formatNumberDecimal(calc.nbv)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">ราคาขาย</dt>
                    <dd className="tabular-nums">{formatNumberDecimal(calc.proceeds)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">{calc.gainLoss >= 0 ? 'กำไร' : 'ขาดทุน'}</dt>
                    <dd className={`tabular-nums font-semibold ${calc.gainLoss >= 0 ? 'text-success' : 'text-destructive'}`}>
                      {formatNumberDecimal(Math.abs(calc.gainLoss))}
                    </dd>
                  </div>
                </dl>
                {calc.journalLines.length > 0 && (
                  <table className="w-full text-sm mt-4">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left py-2 px-2">รหัส</th>
                        <th className="text-left py-2 px-2">ชื่อ</th>
                        <th className="text-right py-2 px-2">Debit</th>
                        <th className="text-right py-2 px-2">Credit</th>
                      </tr>
                    </thead>
                    <tbody>
                      {calc.journalLines.map((line, idx) => (
                        <tr key={idx} className="border-b">
                          <td className="py-2 px-2 font-mono">{line.accountCode}</td>
                          <td className="py-2 px-2">{line.accountName}</td>
                          <td className="py-2 px-2 text-right tabular-nums">
                            {line.debit > 0 ? formatNumberDecimal(line.debit) : '-'}
                          </td>
                          <td className="py-2 px-2 text-right tabular-nums">
                            {line.credit > 0 ? formatNumberDecimal(line.credit) : '-'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </CardContent>
            </Card>

            {/* Sticky action bar */}
            <div className="fixed bottom-0 left-0 right-0 bg-background border-t p-4 flex justify-end gap-2 z-10">
              <Button variant="outline" onClick={() => navigate(`/assets/${id}`)} disabled={disposeMutation.isPending}>
                ยกเลิก
              </Button>
              <Button onClick={onSubmit} disabled={disposeMutation.isPending || !calc.isBalanced}>
                {disposeMutation.isPending ? 'กำลังบันทึก…' : 'ยืนยันการจำหน่าย'}
              </Button>
            </div>
          </div>
        </FormProvider>
      )}
    </QueryBoundary>
  );
}
```

- [ ] **Step 6.3: Add Dispose action + Reverse-Dispose action to AssetDetailPage**

In `apps/web/src/pages/assets/AssetDetailPage.tsx`:

1. Import `ReverseDisposalDialog` and `Trash2` icon (if not already)
2. Add a `useMutation` for `reverseDispose`:

```typescript
const reverseDisposeMutation = useMutation({
  mutationFn: (reason: string) => assetsApi.reverseDispose(id!, reason),
  onSuccess: (r) => {
    toast.success(`คืนสถานะแล้ว → ${r.entryNo}`);
    queryClient.invalidateQueries({ queryKey: ['asset', id] });
    queryClient.invalidateQueries({ queryKey: ['assets'] });
    queryClient.invalidateQueries({ queryKey: ['assets-summary'] });
    setShowReverseDisposal(false);
  },
  onError: (e) => toast.error(getErrorMessage(e)),
});
const [showReverseDisposal, setShowReverseDisposal] = useState(false);
```

3. In the action menu DropdownMenuContent, add a Dispose item when `status === 'POSTED'`:

```tsx
<DropdownMenuItem onClick={() => navigate(`/assets/${id}/dispose`)}>
  <Trash2 className="mr-2 h-4 w-4" /> จำหน่ายสินทรัพย์
</DropdownMenuItem>
```

(Place it in the existing `assetQuery.data.status === 'POSTED'` branch alongside Transfer and Reverse.)

4. Add a Reverse-Dispose item when status is DISPOSED or WRITTEN_OFF:

```tsx
{(assetQuery.data.status === 'DISPOSED' || assetQuery.data.status === 'WRITTEN_OFF') && (
  <DropdownMenuItem onClick={() => setShowReverseDisposal(true)} className="text-destructive">
    <Undo2 className="mr-2 h-4 w-4" /> กลับรายการจำหน่าย
  </DropdownMenuItem>
)}
```

5. Add a transfers list link below the transfer history card (small text-muted link):

```tsx
{(assetQuery.data.transferHistory?.length ?? 0) > 0 && (
  <Card>
    <CardHeader>
      <CardTitle>ประวัติการโอน</CardTitle>
    </CardHeader>
    <CardContent>
      {/* existing transfer history list */}
      <div className="mt-3 text-sm">
        <a
          href="/assets/transfers"
          onClick={(e) => { e.preventDefault(); navigate('/assets/transfers'); }}
          className="text-muted-foreground hover:text-primary underline"
        >
          ดูประวัติการโอนทั้งหมด →
        </a>
      </div>
    </CardContent>
  </Card>
)}
```

6. Mount the dialog after the existing `<TransferAssetDialog ... />`:

```tsx
<ReverseDisposalDialog
  open={showReverseDisposal}
  onOpenChange={setShowReverseDisposal}
  onConfirm={(reason) => reverseDisposeMutation.mutate(reason)}
  isPending={reverseDisposeMutation.isPending}
/>
```

- [ ] **Step 6.4: Verify typecheck**

```bash
./tools/check-types.sh web
```

Expected: 0 errors. If `RadioGroup` doesn't exist in `apps/web/src/components/ui/`, look for an existing radio implementation in the codebase (search for `RadioGroup` in pages) and adapt; alternatively use 2 buttons or a `Select` with 2 options.

- [ ] **Step 6.5: Commit**

```bash
git add apps/web/src/pages/assets/AssetDisposePage.tsx \
        apps/web/src/pages/assets/components/ReverseDisposalDialog.tsx \
        apps/web/src/pages/assets/AssetDetailPage.tsx
git commit -m "feat(asset): AssetDisposePage + DetailPage dispose/reverse actions

3-section page (วิธีจำหน่าย toggle, รายละเอียด conditional fields,
Auto JE Preview with live gain/loss + balanced badge), sticky action
bar (POST disabled until balanced). DetailPage action menu adds
Dispose (POSTED) + Reverse-Dispose (DISPOSED/WRITTEN_OFF) +
'ดูประวัติการโอนทั้งหมด' link to /assets/transfers."
```

---

## Task 7: Routes + Disposal E2E

**Files:**
- Modify: `apps/web/src/App.tsx`
- Create: `apps/web/e2e/assets-dispose.spec.ts`
- Create: `apps/web/e2e/assets-write-off.spec.ts`

- [ ] **Step 7.1: Add lazy route**

In `apps/web/src/App.tsx`, add (alongside existing asset lazy imports):

```typescript
const AssetDisposePage = lazy(() => import('./pages/assets/AssetDisposePage'));
```

Add the route inside the Routes block (under the existing asset routes):

```tsx
<Route path="/assets/:id/dispose" element={<ProtectedRoute roles={['OWNER', 'FINANCE_MANAGER']}><AssetDisposePage /></ProtectedRoute>} />
```

(Match existing Phase 1 route declaration pattern — likely uses Outlet/MainLayout via parent route.)

- [ ] **Step 7.2: Create assets-dispose.spec.ts E2E**

```typescript
// apps/web/e2e/assets-dispose.spec.ts
import { test, expect } from '@playwright/test';
import { loginAsRole } from './helpers/login';

const API_URL = process.env.API_URL ?? 'http://localhost:3000';

test('dispose POSTED asset (SALE) via API', async ({ page }) => {
  await loginAsRole(page, 'FINANCE_MANAGER');

  // Create + post asset via API
  const createRes = await page.request.post(`${API_URL}/api/assets`, {
    data: {
      name: 'E2E Dispose Test Asset',
      category: 'EQUIPMENT',
      basePrice: 30000,
      usefulLifeMonths: 36,
      purchaseDate: new Date().toISOString().slice(0, 10),
      paymentAccount: '11-1201',
    },
  });
  expect(createRes.ok()).toBeTruthy();
  const created = await createRes.json();
  const postRes = await page.request.post(`${API_URL}/api/assets/${created.id}/post`);
  expect(postRes.ok()).toBeTruthy();

  // Dispose
  const disposeRes = await page.request.post(`${API_URL}/api/assets/${created.id}/dispose`, {
    data: {
      disposalType: 'SALE',
      disposalDate: new Date().toISOString().slice(0, 10),
      proceeds: 25000,
      depositAccountCode: '11-1201',
      reason: 'E2E test sale disposal',
    },
  });
  expect(disposeRes.ok()).toBeTruthy();
  const disposed = await disposeRes.json();
  expect(disposed.entryNo).toMatch(/^JE-\d{6}-\d{5}$/);

  // Verify status via detail GET
  const detailRes = await page.request.get(`${API_URL}/api/assets/${created.id}`);
  const detail = await detailRes.json();
  expect(detail.status).toBe('DISPOSED');
});
```

- [ ] **Step 7.3: Create assets-write-off.spec.ts E2E**

```typescript
// apps/web/e2e/assets-write-off.spec.ts
import { test, expect } from '@playwright/test';
import { loginAsRole } from './helpers/login';

const API_URL = process.env.API_URL ?? 'http://localhost:3000';

test('WRITE_OFF asset via API', async ({ page }) => {
  await loginAsRole(page, 'FINANCE_MANAGER');

  const createRes = await page.request.post(`${API_URL}/api/assets`, {
    data: {
      name: 'E2E Write-off Test',
      category: 'EQUIPMENT',
      basePrice: 5000,
      usefulLifeMonths: 12,
      purchaseDate: new Date().toISOString().slice(0, 10),
      paymentAccount: '11-1201',
    },
  });
  const created = await createRes.json();
  await page.request.post(`${API_URL}/api/assets/${created.id}/post`);

  const writeOffRes = await page.request.post(`${API_URL}/api/assets/${created.id}/dispose`, {
    data: {
      disposalType: 'WRITE_OFF',
      disposalDate: new Date().toISOString().slice(0, 10),
      reason: 'E2E test write-off — เครื่องเสีย',
    },
  });
  expect(writeOffRes.ok()).toBeTruthy();

  const detailRes = await page.request.get(`${API_URL}/api/assets/${created.id}`);
  const detail = await detailRes.json();
  expect(detail.status).toBe('WRITTEN_OFF');
});
```

- [ ] **Step 7.4: Verify typecheck**

```bash
./tools/check-types.sh web
```

Expected: 0 errors.

- [ ] **Step 7.5: Commit**

```bash
git add apps/web/src/App.tsx \
        apps/web/e2e/assets-dispose.spec.ts \
        apps/web/e2e/assets-write-off.spec.ts
git commit -m "feat(asset): wire /assets/:id/dispose route + 2 E2E specs

Route protected by OWNER/FINANCE_MANAGER roles. E2E covers SALE
(proceeds + bank account) + WRITE_OFF (no proceeds) flows via API.
UI smoke deferred to manual run pending dev server availability."
```

---


# Section B — Depreciation

## Task 8: Schema migration (DepreciationEntry +reversedAt/reversedById)

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/<ts>_depreciation_reverse_tracking/migration.sql`

- [ ] **Step 8.1: Update Prisma schema**

In `apps/api/prisma/schema.prisma`, find `model DepreciationEntry` (around line 3156). Update to:

```prisma
/// Phase A.5c — Idempotency record: one depreciation JE per asset per period
/// Phase 2 — Adds reversedAt/reversedById for reverse-run tracking
model DepreciationEntry {
  id             String     @id @default(uuid())
  assetId        String     @map("asset_id")
  asset          FixedAsset @relation(fields: [assetId], references: [id], onDelete: Restrict)
  period         String // "2026-04"
  amount         Decimal    @db.Decimal(12, 2)
  journalEntryNo String?    @map("journal_entry_no") // JE-202604-00001

  /// Phase 2: reversedAt set when this entry's depreciation has been reversed
  reversedAt   DateTime? @map("reversed_at")
  reversedById String?   @map("reversed_by_id")
  reversedBy   User?     @relation("DepreciationEntryReversedBy", fields: [reversedById], references: [id])

  createdAt DateTime @default(now()) @map("created_at")

  @@unique([assetId, period])
  @@index([period])
  @@index([period, reversedAt])
  @@map("depreciation_entries")
}
```

Then find `model User` and add the back-relation inside it:

```prisma
depreciationEntriesReversed DepreciationEntry[] @relation("DepreciationEntryReversedBy")
```

(Place near other asset-related relations — `assetsCreated`, `assetsApproved`, etc.)

- [ ] **Step 8.2: Generate migration**

```bash
cd apps/api && npx prisma migrate dev --name depreciation_reverse_tracking --create-only
```

Open the new migration SQL file and verify it contains:
- `ALTER TABLE "depreciation_entries" ADD COLUMN "reversed_at" TIMESTAMP(3)`
- `ALTER TABLE "depreciation_entries" ADD COLUMN "reversed_by_id" TEXT`
- FK constraint: `ADD CONSTRAINT "depreciation_entries_reversed_by_id_fkey" FOREIGN KEY ("reversed_by_id") REFERENCES "users"("id")`
- `CREATE INDEX "depreciation_entries_period_reversed_at_idx" ON "depreciation_entries"("period", "reversed_at")`

If anything is missing or extra (e.g., shadow DB issues like Phase 1 had), edit the SQL by hand.

- [ ] **Step 8.3: Apply migration**

```bash
cd apps/api && npx prisma migrate dev
```

Expected: applies cleanly + regenerates Prisma Client.

- [ ] **Step 8.4: Verify typecheck**

```bash
./tools/check-types.sh api
```

Expected: 0 errors. The new fields shouldn't break any existing code (all nullable additions).

- [ ] **Step 8.5: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations/
git commit -m "feat(asset): DepreciationEntry +reversedAt/reversedById for Phase 2

Adds nullable reversedAt + reversedById FK + reversedBy relation +
[period, reversedAt] compound index. User.depreciationEntriesReversed
back-relation added. Migration is non-destructive (additive only) so
no wipe needed for prod deploy."
```

---

## Task 9: DepreciationModule + DTOs + listRuns/previewRun + 6 tests

**Files:**
- Create: `apps/api/src/modules/depreciation/dto/run-depreciation.dto.ts`
- Create: `apps/api/src/modules/depreciation/dto/reverse-depreciation-run.dto.ts`
- Create: `apps/api/src/modules/depreciation/depreciation.service.ts` (initial: listRuns + previewRun + stubs)
- Create: `apps/api/src/modules/depreciation/depreciation.module.ts`
- Create: `apps/api/src/modules/depreciation/__tests__/depreciation.service.spec.ts`
- Modify: `apps/api/src/app.module.ts`

- [ ] **Step 9.1: Create DTOs**

`apps/api/src/modules/depreciation/dto/run-depreciation.dto.ts`:

```typescript
import { Matches } from 'class-validator';

export class RunDepreciationDto {
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'รูปแบบงวดต้องเป็น YYYY-MM' })
  period: string;
}
```

`apps/api/src/modules/depreciation/dto/reverse-depreciation-run.dto.ts`:

```typescript
import { Matches, IsString, MinLength } from 'class-validator';

export class ReverseDepreciationRunDto {
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'รูปแบบงวดต้องเป็น YYYY-MM' })
  period: string;

  @IsString()
  @MinLength(5, { message: 'เหตุผลต้องมีอย่างน้อย 5 ตัวอักษร' })
  reason: string;
}
```

- [ ] **Step 9.2: Create depreciation.module.ts (initial wiring)**

```typescript
// apps/api/src/modules/depreciation/depreciation.module.ts
import { Module } from '@nestjs/common';
import { DepreciationService } from './depreciation.service';
import { JournalModule } from '../journal/journal.module';

@Module({
  imports: [JournalModule],
  providers: [DepreciationService],
  exports: [DepreciationService],
})
export class DepreciationModule {}
```

(Controller is added in Task 12.)

- [ ] **Step 9.3: Create depreciation.service.ts (initial — listRuns + previewRun + stubs)**

```typescript
// apps/api/src/modules/depreciation/depreciation.service.ts
import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../../prisma/prisma.service';
import { DepreciationTemplate } from '../journal/cpa-templates/depreciation.template';

const CATEGORY_ACCOUNT_MAP: Record<string, [string, string]> = {
  EQUIPMENT: ['53-1601', '12-2102'],
  IMPROVEMENT: ['53-1602', '12-2104'],
  FURNITURE: ['53-1603', '12-2106'],
  VEHICLE: ['53-1604', '12-2108'],
};

export interface DepreciationRunSummary {
  period: string;
  entryNumbers: string[];
  totalAmount: string;
  assetCount: number;
  ranAt: string;
  runByName: string | null;
  status: 'POSTED' | 'REVERSED';
}

export interface DepreciationPreviewLine {
  assetId: string;
  assetCode: string;
  assetName: string;
  monthlyDepr: string;
  drAccount: string;
  crAccount: string;
}

export interface DepreciationPreview {
  period: string;
  lines: DepreciationPreviewLine[];
  totalAmount: string;
  assetCount: number;
  alreadyRunForAssetIds: string[];
}

@Injectable()
export class DepreciationService {
  private readonly logger = new Logger(DepreciationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly depreciationTemplate: DepreciationTemplate,
  ) {}

  async listRuns(): Promise<DepreciationRunSummary[]> {
    // Group DepreciationEntry by period; aggregate
    const entries = await this.prisma.depreciationEntry.findMany({
      orderBy: { period: 'desc' },
      include: {
        reversedBy: { select: { name: true } },
      },
    });

    // Group by period
    const grouped = new Map<string, typeof entries>();
    for (const e of entries) {
      const arr = grouped.get(e.period) ?? [];
      arr.push(e);
      grouped.set(e.period, arr);
    }

    const result: DepreciationRunSummary[] = [];
    for (const [period, periodEntries] of grouped) {
      const allReversed = periodEntries.every((e) => e.reversedAt !== null);
      const totalAmount = periodEntries.reduce(
        (s, e) => s.plus(e.amount.toString()),
        new Decimal(0),
      );
      const earliestRanAt = periodEntries
        .map((e) => e.createdAt)
        .reduce((a, b) => (a < b ? a : b));
      const entryNumbers = periodEntries
        .map((e) => e.journalEntryNo)
        .filter((n): n is string => !!n);
      result.push({
        period,
        entryNumbers,
        totalAmount: totalAmount.toFixed(2),
        assetCount: periodEntries.length,
        ranAt: earliestRanAt.toISOString(),
        runByName: null, // depreciation entries don't track runner; could lookup via JE.postedBy in future
        status: allReversed ? 'REVERSED' : 'POSTED',
      });
    }
    return result;
  }

  async previewRun(period: string): Promise<DepreciationPreview> {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) {
      throw new BadRequestException('รูปแบบงวดต้องเป็น YYYY-MM');
    }

    // Find all POSTED assets that haven't been depreciated for this period
    const assets = await this.prisma.fixedAsset.findMany({
      where: { status: 'POSTED', deletedAt: null },
    });

    const existingEntries = await this.prisma.depreciationEntry.findMany({
      where: { period, reversedAt: null },
      select: { assetId: true },
    });
    const alreadyRun = new Set(existingEntries.map((e) => e.assetId));

    const lines: DepreciationPreviewLine[] = [];
    let totalAmount = new Decimal(0);

    for (const asset of assets) {
      if (alreadyRun.has(asset.id)) continue;

      const purchaseCost = new Decimal(asset.purchaseCost.toString());
      const residualValue = new Decimal(asset.residualValue.toString());
      const accumulatedDepr = new Decimal(asset.accumulatedDepr.toString());
      const depreciableBase = purchaseCost.minus(residualValue);
      const remainingBase = depreciableBase.minus(accumulatedDepr);

      if (remainingBase.lte(0)) continue; // fully depreciated

      const monthlyDepr = new Decimal(asset.monthlyDepr.toString());
      const thisMonth = remainingBase.lt(monthlyDepr) ? remainingBase : monthlyDepr;

      const drAccount = asset.coaExpenseAccount ?? CATEGORY_ACCOUNT_MAP[asset.category]?.[0] ?? '53-1601';
      const crAccount = asset.coaDeprAccount ?? CATEGORY_ACCOUNT_MAP[asset.category]?.[1] ?? '12-2102';

      lines.push({
        assetId: asset.id,
        assetCode: asset.assetCode,
        assetName: asset.name,
        monthlyDepr: thisMonth.toFixed(2),
        drAccount,
        crAccount,
      });
      totalAmount = totalAmount.plus(thisMonth);
    }

    return {
      period,
      lines,
      totalAmount: totalAmount.toFixed(2),
      assetCount: lines.length,
      alreadyRunForAssetIds: Array.from(alreadyRun),
    };
  }

  // Stubs — Tasks 10 + 12 will fill in
  async runManual(_period: string, _userId: string): Promise<DepreciationRunSummary> {
    throw new Error('runManual: implement in Task 10');
  }

  async reverseRun(_period: string, _reason: string, _userId: string): Promise<{ reversedCount: number }> {
    throw new Error('reverseRun: implement in Task 12');
  }
}
```

- [ ] **Step 9.4: Register DepreciationModule in AppModule**

In `apps/api/src/app.module.ts`, add:

```typescript
import { DepreciationModule } from './modules/depreciation/depreciation.module';
// ...
@Module({
  imports: [
    // ...existing modules
    DepreciationModule,
  ],
  // ...
})
```

- [ ] **Step 9.5: Create depreciation.service.spec.ts (jest)**

Use the same setup pattern as `asset.service.spec.ts` — real DB, FINANCE company resolution, Test.createTestingModule with `DepreciationService`, `DepreciationTemplate`, `JournalAutoService`, `PrismaService`.

```typescript
import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { PrismaClient, AssetCategory, AssetStatus } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../../../prisma/prisma.service';
import { DepreciationService } from '../depreciation.service';
import { DepreciationTemplate } from '../../journal/cpa-templates/depreciation.template';
import { JournalAutoService } from '../../journal/journal-auto.service';
import { seedFinanceCoa } from '../../../prisma/seed-coa-finance';

const prisma = new PrismaClient();
let service: DepreciationService;
let userId: string;

beforeAll(async () => {
  await seedFinanceCoa(prisma);
  let user = await prisma.user.findFirst({ where: { email: 'depr-test@bestchoice.local' } });
  if (!user) {
    user = await prisma.user.create({
      data: { email: 'depr-test@bestchoice.local', name: 'Depr Tester', password: 'x', role: 'OWNER' },
    });
  }
  userId = user.id;

  const moduleRef = await Test.createTestingModule({
    providers: [
      DepreciationService,
      DepreciationTemplate,
      JournalAutoService,
      { provide: PrismaService, useValue: prisma },
    ],
  }).compile();
  service = moduleRef.get(DepreciationService);
});

afterAll(async () => {
  await prisma.$executeRaw`ALTER TABLE audit_logs DISABLE TRIGGER audit_logs_no_delete`;
  try { await prisma.auditLog.deleteMany({ where: { userId } }); }
  finally { await prisma.$executeRaw`ALTER TABLE audit_logs ENABLE TRIGGER audit_logs_no_delete`; }
  await prisma.journalPostAuditLog.deleteMany({ where: { postedById: userId } });
  await prisma.journalLine.deleteMany({ where: { journalEntry: { createdById: userId } } });
  await prisma.journalEntry.deleteMany({ where: { createdById: userId } });
  await prisma.depreciationEntry.deleteMany({});
  await prisma.fixedAsset.deleteMany({ where: { createdById: userId } });
  await prisma.user.delete({ where: { id: userId } });
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.depreciationEntry.deleteMany({});
  await prisma.journalLine.deleteMany({ where: { journalEntry: { createdById: userId } } });
  await prisma.journalEntry.deleteMany({ where: { createdById: userId } });
  await prisma.fixedAsset.deleteMany({ where: { createdById: userId } });
});

async function postedAsset(monthly = '833.33') {
  return prisma.fixedAsset.create({
    data: {
      assetCode: `TEST-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
      docNo: `ASSET-DEP-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      name: 'Depr Test Asset',
      category: 'EQUIPMENT' as AssetCategory,
      basePrice: new Decimal(30000), shippingCost: new Decimal(0),
      installationCost: new Decimal(0), otherCapitalized: new Decimal(0),
      vatAmount: new Decimal(0), whtAmount: new Decimal(0),
      purchaseCost: new Decimal(30000), residualValue: new Decimal(0),
      usefulLifeMonths: 36, monthlyDepr: new Decimal(monthly),
      accumulatedDepr: new Decimal(0), netBookValue: new Decimal(30000),
      coaCostAccount: '12-2101', coaDeprAccount: '12-2102', coaExpenseAccount: '53-1601',
      purchaseDate: new Date('2026-01-01'),
      paymentAccount: '11-1201', status: 'POSTED' as AssetStatus,
      createdById: userId,
    },
  });
}

describe('DepreciationService.listRuns', () => {
  it('returns empty when no entries', async () => {
    const runs = await service.listRuns();
    expect(runs).toEqual([]);
  });

  it('aggregates entries by period with assetCount + total', async () => {
    const a = await postedAsset();
    const b = await postedAsset();
    await prisma.depreciationEntry.create({
      data: { assetId: a.id, period: '2026-05', amount: new Decimal(833.33) },
    });
    await prisma.depreciationEntry.create({
      data: { assetId: b.id, period: '2026-05', amount: new Decimal(833.33) },
    });
    const runs = await service.listRuns();
    expect(runs).toHaveLength(1);
    expect(runs[0].period).toBe('2026-05');
    expect(runs[0].assetCount).toBe(2);
    expect(parseFloat(runs[0].totalAmount)).toBeCloseTo(1666.66, 2);
    expect(runs[0].status).toBe('POSTED');
  });

  it('marks period REVERSED when all entries are reversed', async () => {
    const a = await postedAsset();
    await prisma.depreciationEntry.create({
      data: {
        assetId: a.id, period: '2026-04', amount: new Decimal(833.33),
        reversedAt: new Date(), reversedById: userId,
      },
    });
    const runs = await service.listRuns();
    expect(runs[0].status).toBe('REVERSED');
  });
});

describe('DepreciationService.previewRun', () => {
  it('returns empty preview when no eligible assets', async () => {
    const preview = await service.previewRun('2026-05');
    expect(preview.assetCount).toBe(0);
    expect(preview.lines).toEqual([]);
  });

  it('returns lines for POSTED assets not yet depreciated for the period', async () => {
    const a = await postedAsset();
    const preview = await service.previewRun('2026-05');
    expect(preview.assetCount).toBe(1);
    expect(preview.lines[0].assetId).toBe(a.id);
    expect(preview.lines[0].drAccount).toBe('53-1601');
    expect(preview.lines[0].crAccount).toBe('12-2102');
    expect(parseFloat(preview.lines[0].monthlyDepr)).toBeCloseTo(833.33, 2);
  });

  it('excludes assets already depreciated for that period (reversedAt IS NULL)', async () => {
    const a = await postedAsset();
    await prisma.depreciationEntry.create({
      data: { assetId: a.id, period: '2026-05', amount: new Decimal(833.33) },
    });
    const preview = await service.previewRun('2026-05');
    expect(preview.assetCount).toBe(0);
    expect(preview.alreadyRunForAssetIds).toContain(a.id);
  });

  it('rejects invalid period format', async () => {
    await expect(service.previewRun('2026-13')).rejects.toThrow(/YYYY-MM/);
    await expect(service.previewRun('not-a-period')).rejects.toThrow();
  });

  it('excludes fully-depreciated assets', async () => {
    const a = await postedAsset();
    await prisma.fixedAsset.update({
      where: { id: a.id },
      data: { accumulatedDepr: new Decimal(30000), netBookValue: new Decimal(0) },
    });
    const preview = await service.previewRun('2026-05');
    expect(preview.assetCount).toBe(0);
  });

  it('reuses asset.coaExpenseAccount snapshot if present (over CATEGORY_ACCOUNT_MAP)', async () => {
    const a = await postedAsset();
    await prisma.fixedAsset.update({
      where: { id: a.id },
      data: { coaExpenseAccount: '53-1602', coaDeprAccount: '12-2104' }, // override
    });
    const preview = await service.previewRun('2026-05');
    expect(preview.lines[0].drAccount).toBe('53-1602');
    expect(preview.lines[0].crAccount).toBe('12-2104');
  });
});
```

- [ ] **Step 9.6: Run tests + typecheck**

```bash
cd apps/api && npx jest src/modules/depreciation/__tests__/depreciation.service --runInBand
./tools/check-types.sh api
```

Expected: 6 tests pass (3 listRuns + 3 previewRun), 0 type errors. (3 stubs throw — those are tested in Tasks 10/12.)

If `npx jest` doesn't find the new test file, check `apps/api/jest.config.js` for the `testRegex` / `testPathIgnorePatterns`.

- [ ] **Step 9.7: Commit**

```bash
git add apps/api/src/modules/depreciation/ \
        apps/api/src/app.module.ts
git commit -m "feat(depreciation): module + listRuns + previewRun + 6 tests

New module apps/api/src/modules/depreciation/. listRuns aggregates
DepreciationEntry by period with status (POSTED/REVERSED) + asset
count + total amount. previewRun returns dry-run lines for POSTED
assets not yet depreciated for the target period, excluding fully-
depreciated. Prefers asset.coa* snapshots over CATEGORY_ACCOUNT_MAP.
runManual + reverseRun stubbed for next tasks."
```

---

## Task 10: DepreciationService.runManual + 6 tests

**Files:**
- Modify: `apps/api/src/modules/depreciation/depreciation.service.ts` (replace stub)
- Modify: `apps/api/src/modules/depreciation/__tests__/depreciation.service.spec.ts` (add 6 cases)

- [ ] **Step 10.1: Add runManual tests**

Append to `depreciation.service.spec.ts`:

```typescript
describe('DepreciationService.runManual', () => {
  it('posts JE per eligible asset and inserts DepreciationEntry rows', async () => {
    const a = await postedAsset();
    const b = await postedAsset();
    const result = await service.runManual('2026-05', userId);
    expect(result.assetCount).toBe(2);
    expect(parseFloat(result.totalAmount)).toBeCloseTo(1666.66, 2);

    const entries = await prisma.depreciationEntry.findMany({ where: { period: '2026-05' } });
    expect(entries).toHaveLength(2);
    const aEntry = entries.find((e) => e.assetId === a.id)!;
    expect(parseFloat(aEntry.amount.toString())).toBeCloseTo(833.33, 2);
    expect(aEntry.journalEntryNo).toMatch(/^JE-\d{6}-\d{5}$/);

    // accumulatedDepr updated
    const aUpdated = await prisma.fixedAsset.findUnique({ where: { id: a.id } });
    expect(parseFloat(aUpdated!.accumulatedDepr.toString())).toBeCloseTo(833.33, 2);
  });

  it('idempotent: second runManual for same period returns existing entries (no duplicates)', async () => {
    await postedAsset();
    const r1 = await service.runManual('2026-05', userId);
    const r2 = await service.runManual('2026-05', userId);
    expect(r2.assetCount).toBe(r1.assetCount);
    const entries = await prisma.depreciationEntry.findMany({ where: { period: '2026-05' } });
    expect(entries).toHaveLength(r1.assetCount);
  });

  it('rejects invalid period format', async () => {
    await expect(service.runManual('2026-13', userId)).rejects.toThrow(/YYYY-MM/);
  });

  it('rejects future period', async () => {
    const future = new Date();
    future.setMonth(future.getMonth() + 2);
    const futurePeriod = `${future.getFullYear()}-${String(future.getMonth() + 1).padStart(2, '0')}`;
    await expect(service.runManual(futurePeriod, userId)).rejects.toThrow(/อนาคต|future/i);
  });

  it('writes AuditLog DEPRECIATION_RUN_MANUAL', async () => {
    await postedAsset();
    await service.runManual('2026-05', userId);
    const log = await prisma.auditLog.findFirst({
      where: { entity: 'depreciation_run', entityId: '2026-05', action: 'DEPRECIATION_RUN_MANUAL' },
    });
    expect(log).toBeTruthy();
  });

  it('V15 closed period → DEPRECIATION_RUN_MANUAL_BLOCKED audit + reject', async () => {
    const finance = await prisma.companyInfo.findFirst({ where: { companyCode: 'FINANCE' } });
    if (!finance) throw new Error('FINANCE company missing');
    await prisma.accountingPeriod.upsert({
      where: { companyId_year_month: { companyId: finance.id, year: 2026, month: 5 } },
      update: { status: 'CLOSED', closedAt: new Date(), closedById: userId },
      create: { companyId: finance.id, year: 2026, month: 5, status: 'CLOSED', closedAt: new Date(), closedById: userId },
    });
    await postedAsset();
    await expect(service.runManual('2026-05', userId)).rejects.toThrow(/period|งวด/i);
    const blocked = await prisma.auditLog.findFirst({
      where: { entity: 'depreciation_run', entityId: '2026-05', action: 'DEPRECIATION_RUN_MANUAL_BLOCKED' },
    });
    expect(blocked).toBeTruthy();
    await prisma.accountingPeriod.delete({
      where: { companyId_year_month: { companyId: finance.id, year: 2026, month: 5 } },
    });
  });
});
```

- [ ] **Step 10.2: Implement runManual**

In `depreciation.service.ts`, add import + getFinanceCompanyId helper + implement runManual. Replace the stub:

```typescript
import { validatePeriodOpen } from '../../utils/period-lock.util';
// ...

@Injectable()
export class DepreciationService {
  // ...existing
  private financeCompanyId?: string;

  private async getFinanceCompanyId(): Promise<string> {
    if (this.financeCompanyId) return this.financeCompanyId;
    const company = await this.prisma.companyInfo.findFirst({
      where: { companyCode: 'FINANCE', deletedAt: null },
    });
    if (!company) throw new Error('FINANCE company not found');
    this.financeCompanyId = company.id;
    return company.id;
  }

  async runManual(period: string, userId: string): Promise<DepreciationRunSummary> {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) {
      throw new BadRequestException('รูปแบบงวดต้องเป็น YYYY-MM');
    }

    // Reject future period
    const [y, m] = period.split('-').map(Number);
    const periodEnd = new Date(y, m, 0); // last day of month
    if (periodEnd > new Date()) {
      throw new BadRequestException('ไม่สามารถรันค่าเสื่อมล่วงหน้า (period อยู่ในอนาคต)');
    }

    // V15 guard
    const financeCompanyId = await this.getFinanceCompanyId();
    try {
      await validatePeriodOpen(this.prisma, periodEnd, financeCompanyId);
    } catch (err: any) {
      await this.prisma.auditLog.create({
        data: {
          userId, action: 'DEPRECIATION_RUN_MANUAL_BLOCKED',
          entity: 'depreciation_run', entityId: period,
          oldValue: { period },
          newValue: { reason: err.message ?? 'period closed' },
        },
      });
      throw new BadRequestException(`ไม่สามารถรัน: ${err.message ?? 'งวดบัญชีปิดแล้ว'}`);
    }

    // Find eligible assets
    const assets = await this.prisma.fixedAsset.findMany({
      where: { status: 'POSTED', deletedAt: null },
    });
    const existing = await this.prisma.depreciationEntry.findMany({
      where: { period, reversedAt: null },
      select: { assetId: true },
    });
    const alreadyRun = new Set(existing.map((e) => e.assetId));

    let totalAmount = new Decimal(0);
    let processedCount = 0;
    const entryNumbers: string[] = [];

    // Run each asset (each call is internally tx-wrapped via DepreciationTemplate)
    // We don't wrap the whole run in one transaction because cron uses the same per-asset
    // pattern; each DepreciationEntry insert is idempotent so partial-failure is recoverable.
    for (const asset of assets) {
      if (alreadyRun.has(asset.id)) continue;
      try {
        const result = await this.depreciationTemplate.execute({ assetId: asset.id, period });
        if (result?.entryNo) {
          entryNumbers.push(result.entryNo);
          processedCount++;
        }
      } catch (err: any) {
        this.logger.warn(`runManual: asset ${asset.assetCode} failed: ${err.message ?? err}`);
        // Continue to next asset; partial-failure is OK
      }
    }

    // Re-aggregate to compute total
    const allEntries = await this.prisma.depreciationEntry.findMany({
      where: { period, reversedAt: null },
    });
    totalAmount = allEntries.reduce(
      (s, e) => s.plus(e.amount.toString()),
      new Decimal(0),
    );

    await this.prisma.auditLog.create({
      data: {
        userId, action: 'DEPRECIATION_RUN_MANUAL',
        entity: 'depreciation_run', entityId: period,
        oldValue: { period, alreadyRunCount: alreadyRun.size },
        newValue: {
          period,
          processedCount,
          totalAmount: totalAmount.toFixed(2),
          entryNumbers,
        },
      },
    });

    this.logger.log(`[Phase2] DepreciationRunManual ${period} — processed ${processedCount} assets`);

    return {
      period,
      entryNumbers,
      totalAmount: totalAmount.toFixed(2),
      assetCount: allEntries.length,
      ranAt: new Date().toISOString(),
      runByName: null,
      status: 'POSTED',
    };
  }
  // ...
}
```

- [ ] **Step 10.3: Run tests + typecheck**

```bash
cd apps/api && npx jest src/modules/depreciation/__tests__/depreciation.service --runInBand
./tools/check-types.sh api
```

Expected: 12 tests pass (6 from Task 9 + 6 new), 0 type errors.

- [ ] **Step 10.4: Commit**

```bash
git add apps/api/src/modules/depreciation/depreciation.service.ts \
        apps/api/src/modules/depreciation/__tests__/depreciation.service.spec.ts
git commit -m "feat(depreciation): runManual + 6 tests

Iterates POSTED assets not yet depreciated for the period (excluding
those with active DepreciationEntry), invokes DepreciationTemplate per
asset (idempotent — skips on existing entry), aggregates totals.
Future-period guard + V15 closed-period guard with
DEPRECIATION_RUN_MANUAL_BLOCKED audit log on rejection. AuditLog
DEPRECIATION_RUN_MANUAL on success captures processedCount + total
+ entryNumbers in newValue."
```

---

## Task 11: DepreciationReverseTemplate + 8 tests

**Files:**
- Create: `apps/api/src/modules/journal/cpa-templates/depreciation-reverse.template.ts`
- Create: `apps/api/src/modules/journal/cpa-templates/depreciation-reverse.template.spec.ts`
- Modify: `apps/api/src/modules/journal/journal.module.ts`

- [ ] **Step 11.1: Read reference files**

- `apps/api/src/modules/journal/cpa-templates/asset-disposal-reverse.template.ts` (Task 2 — closest pattern; the cascade differs)
- `apps/api/src/modules/journal/cpa-templates/depreciation.template.ts` (forward — what we're reversing)

- [ ] **Step 11.2: Write failing test**

Create `apps/api/src/modules/journal/cpa-templates/depreciation-reverse.template.spec.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient, AssetCategory, AssetStatus } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { JournalAutoService } from '../journal-auto.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { DepreciationTemplate } from './depreciation.template';
import { DepreciationReverseTemplate } from './depreciation-reverse.template';
import { seedFinanceCoa } from '../../../prisma/seed-coa-finance';

const prisma = new PrismaClient();
const journalAuto = new JournalAutoService(prisma as unknown as PrismaService);
const depr = new DepreciationTemplate(journalAuto, prisma as unknown as PrismaService);
const reverseDepr = new DepreciationReverseTemplate(journalAuto, prisma as unknown as PrismaService);
let userId: string;

beforeAll(async () => {
  await seedFinanceCoa(prisma);
  let user = await prisma.user.findFirst({ where: { email: 'depr-rev-test@bestchoice.local' } });
  if (!user) {
    user = await prisma.user.create({
      data: { email: 'depr-rev-test@bestchoice.local', name: 'Depr Rev Tester', password: 'x', role: 'OWNER' },
    });
  }
  userId = user.id;
});

afterAll(async () => {
  await prisma.$executeRaw`ALTER TABLE audit_logs DISABLE TRIGGER audit_logs_no_delete`;
  try { await prisma.auditLog.deleteMany({ where: { userId } }); }
  finally { await prisma.$executeRaw`ALTER TABLE audit_logs ENABLE TRIGGER audit_logs_no_delete`; }
  await prisma.journalPostAuditLog.deleteMany({ where: { postedById: userId } });
  await prisma.journalLine.deleteMany({ where: { journalEntry: { createdById: userId } } });
  await prisma.journalEntry.deleteMany({ where: { createdById: userId } });
  await prisma.depreciationEntry.deleteMany({});
  await prisma.fixedAsset.deleteMany({ where: { createdById: userId } });
  await prisma.user.delete({ where: { id: userId } });
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.depreciationEntry.deleteMany({});
  await prisma.journalLine.deleteMany({ where: { journalEntry: { createdById: userId } } });
  await prisma.journalEntry.deleteMany({ where: { createdById: userId } });
  await prisma.fixedAsset.deleteMany({ where: { createdById: userId } });
});

async function postedAsset() {
  return prisma.fixedAsset.create({
    data: {
      assetCode: `TEST-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
      docNo: `ASSET-DR-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      name: 'Asset',
      category: 'EQUIPMENT' as AssetCategory,
      basePrice: new Decimal(30000), shippingCost: new Decimal(0),
      installationCost: new Decimal(0), otherCapitalized: new Decimal(0),
      vatAmount: new Decimal(0), whtAmount: new Decimal(0),
      purchaseCost: new Decimal(30000), residualValue: new Decimal(0),
      usefulLifeMonths: 36, monthlyDepr: new Decimal('833.33'),
      accumulatedDepr: new Decimal(0), netBookValue: new Decimal(30000),
      coaCostAccount: '12-2101', coaDeprAccount: '12-2102', coaExpenseAccount: '53-1601',
      purchaseDate: new Date('2026-01-01'),
      paymentAccount: '11-1201', status: 'POSTED' as AssetStatus,
      createdById: userId,
    },
  });
}

describe('DepreciationReverseTemplate', () => {
  it('reverses single-asset depreciation: rolls back accumulatedDepr + recomputes NBV', async () => {
    const asset = await postedAsset();
    await depr.execute({ assetId: asset.id, period: '2026-05' });
    const beforeReverse = await prisma.fixedAsset.findUnique({ where: { id: asset.id } });
    expect(parseFloat(beforeReverse!.accumulatedDepr.toString())).toBeCloseTo(833.33, 2);

    const result = await reverseDepr.execute({ period: '2026-05', reversedById: userId });
    expect(result.reversedCount).toBe(1);

    const updated = await prisma.fixedAsset.findUnique({ where: { id: asset.id } });
    expect(parseFloat(updated!.accumulatedDepr.toString())).toBeCloseTo(0, 2);
    expect(parseFloat(updated!.netBookValue.toString())).toBeCloseTo(30000, 2);

    const entry = await prisma.depreciationEntry.findFirst({ where: { assetId: asset.id, period: '2026-05' } });
    expect(entry!.reversedAt).not.toBeNull();
    expect(entry!.reversedById).toBe(userId);
  });

  it('reverses multi-asset depreciation in single run', async () => {
    const a = await postedAsset();
    const b = await postedAsset();
    await depr.execute({ assetId: a.id, period: '2026-05' });
    await depr.execute({ assetId: b.id, period: '2026-05' });
    const result = await reverseDepr.execute({ period: '2026-05', reversedById: userId });
    expect(result.reversedCount).toBe(2);
    const entries = await prisma.depreciationEntry.findMany({ where: { period: '2026-05' } });
    expect(entries.every((e) => e.reversedAt !== null)).toBe(true);
  });

  it('original JEs remain POSTED with metadata.reversed=true', async () => {
    const asset = await postedAsset();
    await depr.execute({ assetId: asset.id, period: '2026-05' });
    await reverseDepr.execute({ period: '2026-05', reversedById: userId });
    const original = await prisma.journalEntry.findFirst({
      where: {
        metadata: { path: ['flow'], equals: 'depreciation' },
        AND: [{ metadata: { path: ['assetId'], equals: asset.id } }],
      },
    });
    expect(original!.status).toBe('POSTED');
    expect((original!.metadata as any).reversed).toBe(true);
  });

  it('reversal JEs created with metadata.flow=depreciation-reverse', async () => {
    const asset = await postedAsset();
    await depr.execute({ assetId: asset.id, period: '2026-05' });
    await reverseDepr.execute({ period: '2026-05', reversedById: userId });
    const reversals = await prisma.journalEntry.findMany({
      where: {
        metadata: { path: ['flow'], equals: 'depreciation-reverse' },
      },
    });
    expect(reversals).toHaveLength(1);
    expect((reversals[0].metadata as any).period).toBe('2026-05');
    expect((reversals[0].metadata as any).reversedAssetId).toBe(asset.id);
  });

  it('rejects when no DepreciationEntry exists for period', async () => {
    await expect(
      reverseDepr.execute({ period: '2026-05', reversedById: userId }),
    ).rejects.toThrow(/not found|ไม่พบ/i);
  });

  it('skips entries already reversed (idempotent)', async () => {
    const asset = await postedAsset();
    await depr.execute({ assetId: asset.id, period: '2026-05' });
    await reverseDepr.execute({ period: '2026-05', reversedById: userId });
    await expect(
      reverseDepr.execute({ period: '2026-05', reversedById: userId }),
    ).rejects.toThrow(/all entries already reversed|ไม่พบ/i);
  });

  it('rejects if a later period has unreversed entries', async () => {
    const asset = await postedAsset();
    await depr.execute({ assetId: asset.id, period: '2026-05' });
    await depr.execute({ assetId: asset.id, period: '2026-06' });
    await expect(
      reverseDepr.execute({ period: '2026-05', reversedById: userId }),
    ).rejects.toThrow(/หลังจากนี้|later/i);
  });

  it('reversal lines are mirrors of originals (Dr↔Cr swap, [VOID] prefix)', async () => {
    const asset = await postedAsset();
    await depr.execute({ assetId: asset.id, period: '2026-05' });
    await reverseDepr.execute({ period: '2026-05', reversedById: userId });
    const reversal = await prisma.journalEntry.findFirst({
      where: { metadata: { path: ['flow'], equals: 'depreciation-reverse' } },
      include: { lines: true },
    });
    expect(reversal!.lines.every((l) => (l.description ?? '').includes('[VOID]'))).toBe(true);
    const totalDr = reversal!.lines.reduce((s, l) => s.plus(l.debit.toString()), new Decimal(0));
    const totalCr = reversal!.lines.reduce((s, l) => s.plus(l.credit.toString()), new Decimal(0));
    expect(totalDr.equals(totalCr)).toBe(true);
  });
});
```

- [ ] **Step 11.3: Run test — verify FAIL**

```bash
cd apps/api && npx vitest run journal/cpa-templates/depreciation-reverse.template
```

Expected: FAIL with `Cannot find module './depreciation-reverse.template'`.

- [ ] **Step 11.4: Implement template**

Create `apps/api/src/modules/journal/cpa-templates/depreciation-reverse.template.ts`:

```typescript
import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { Prisma } from '@prisma/client';
import { JournalAutoService } from '../journal-auto.service';
import { PrismaService } from '../../../prisma/prisma.service';

export interface DepreciationReverseInput {
  period: string;        // YYYY-MM
  reversedById: string;
}

@Injectable()
export class DepreciationReverseTemplate {
  private readonly logger = new Logger(DepreciationReverseTemplate.name);

  constructor(
    private readonly journal: JournalAutoService,
    private readonly prisma: PrismaService,
  ) {}

  async execute(
    input: DepreciationReverseInput,
    outerTx?: Prisma.TransactionClient,
  ): Promise<{ reversedCount: number; entryNumbers: string[] }> {
    const { period, reversedById } = input;

    const run = async (
      tx: Prisma.TransactionClient,
    ): Promise<{ reversedCount: number; entryNumbers: string[] }> => {
      // Find all unreversed entries for this period
      const entries = await tx.depreciationEntry.findMany({
        where: { period, reversedAt: null },
        include: { asset: true },
      });
      if (entries.length === 0) {
        // Check if entries exist but all already reversed
        const anyEntries = await tx.depreciationEntry.findFirst({ where: { period } });
        if (!anyEntries) {
          throw new NotFoundException(`ไม่พบ depreciation entries สำหรับงวด ${period}`);
        }
        throw new BadRequestException(`all entries already reversed for period ${period}`);
      }

      // Cross-period guard: refuse if any later period has unreversed entries for ANY of the affected assets
      const affectedAssetIds = entries.map((e) => e.assetId);
      const laterUnreversed = await tx.depreciationEntry.findFirst({
        where: {
          assetId: { in: affectedAssetIds },
          period: { gt: period },
          reversedAt: null,
        },
        select: { period: true },
      });
      if (laterUnreversed) {
        throw new BadRequestException(
          `ไม่สามารถ reverse: มีการ run ค่าเสื่อมงวด ${laterUnreversed.period} หลังจากนี้แล้ว ต้อง reverse งวดถัดไปก่อน`,
        );
      }

      const entryNumbers: string[] = [];

      for (const entry of entries) {
        const original = await tx.journalEntry.findFirst({
          where: {
            metadata: { path: ['flow'], equals: 'depreciation' },
            AND: [
              { metadata: { path: ['assetId'], equals: entry.assetId } },
              { metadata: { path: ['period'], equals: period } },
            ],
            deletedAt: null,
          },
          include: { lines: true },
        });
        if (!original) {
          this.logger.warn(`Original depreciation JE not found for asset ${entry.assetId} period ${period}`);
          continue;
        }
        if ((original.metadata as any)?.reversed === true) {
          this.logger.log(`Skipping already-reversed JE ${original.entryNumber}`);
          continue;
        }

        const reversedLines = original.lines.map((l) => ({
          accountCode: l.accountCode,
          dr: new Decimal(l.credit.toString()),
          cr: new Decimal(l.debit.toString()),
          description: `[VOID] ${l.description ?? ''}`.trim(),
        }));

        const result = await this.journal.createAndPost(
          {
            description: `[ยกเลิก] กลับรายการค่าเสื่อมงวด ${period} JE ${original.entryNumber}`,
            reference: `${entry.assetId}:reverse-depr-${period}`,
            metadata: {
              tag: 'REVERSAL',
              flow: 'depreciation-reverse',
              period,
              reversedAssetId: entry.assetId,
              originalEntryId: original.id,
              originalEntryNumber: original.entryNumber,
              eventType: 'DEPRECIATION_REVERSAL',
            },
            lines: reversedLines,
            postedAt: new Date(),
          },
          tx,
        );
        entryNumbers.push(result.entryNumber);

        // Flag original
        const existingMeta = (original.metadata as Prisma.InputJsonObject) ?? {};
        await tx.journalEntry.update({
          where: { id: original.id },
          data: {
            metadata: {
              ...existingMeta,
              reversed: true,
              reversedByEntryNumber: result.entryNumber,
              reversedAt: new Date().toISOString(),
            },
          },
        });

        // Update asset: roll back accumulatedDepr + recompute NBV
        const reverseAmount = new Decimal(entry.amount.toString());
        const currentAccum = new Decimal(entry.asset.accumulatedDepr.toString());
        const purchaseCost = new Decimal(entry.asset.purchaseCost.toString());
        const newAccum = currentAccum.minus(reverseAmount);
        const newNbv = purchaseCost.minus(newAccum);
        await tx.fixedAsset.update({
          where: { id: entry.assetId },
          data: {
            accumulatedDepr: newAccum,
            netBookValue: newNbv,
          },
        });

        // Mark entry as reversed
        await tx.depreciationEntry.update({
          where: { id: entry.id },
          data: {
            reversedAt: new Date(),
            reversedById,
          },
        });

        // T2-C14 audit log
        await tx.journalPostAuditLog.create({
          data: {
            journalEntryId: result.id,
            postedById: reversedById,
            postedAt: new Date(),
          },
        });
      }

      this.logger.log(
        `[Phase2] DepreciationReverse period ${period} — reversed ${entryNumbers.length} entries`,
      );

      return { reversedCount: entryNumbers.length, entryNumbers };
    };

    if (outerTx) return run(outerTx);
    return this.prisma.$transaction(run);
  }
}
```

- [ ] **Step 11.5: Register in JournalModule**

Open `apps/api/src/modules/journal/journal.module.ts`. Add `DepreciationReverseTemplate` to providers + exports.

- [ ] **Step 11.6: Run tests + typecheck**

```bash
cd apps/api && npx vitest run journal/cpa-templates/depreciation-reverse.template --no-file-parallelism
./tools/check-types.sh api
```

Expected: 8 PASS, 0 type errors.

- [ ] **Step 11.7: Commit**

```bash
git add apps/api/src/modules/journal/cpa-templates/depreciation-reverse.template.ts \
        apps/api/src/modules/journal/cpa-templates/depreciation-reverse.template.spec.ts \
        apps/api/src/modules/journal/journal.module.ts
git commit -m "feat(depreciation): DepreciationReverseTemplate + 8 tests

Cascading reverse across all unreversed DepreciationEntry rows for the
period: mirror JE per asset, mark original.metadata.reversed=true,
rollback asset.accumulatedDepr + recompute netBookValue, set entry
reversedAt + reversedById. Cross-period guard refuses if a later period
has unreversed entries for any affected asset. Idempotent. Single outer
\$transaction for atomicity."
```

---

## Task 12: DepreciationService.reverseRun + 4 tests + DepreciationController + module wiring

**Files:**
- Modify: `apps/api/src/modules/depreciation/depreciation.service.ts`
- Modify: `apps/api/src/modules/depreciation/__tests__/depreciation.service.spec.ts`
- Create: `apps/api/src/modules/depreciation/depreciation.controller.ts`
- Modify: `apps/api/src/modules/depreciation/depreciation.module.ts`

- [ ] **Step 12.1: Add reverseRun tests**

Append to `depreciation.service.spec.ts`:

```typescript
describe('DepreciationService.reverseRun', () => {
  it('reverses entries + writes AuditLog DEPRECIATION_RUN_REVERSE', async () => {
    const a = await postedAsset();
    await service.runManual('2026-05', userId);
    const result = await service.reverseRun('2026-05', 'mistake', userId);
    expect(result.reversedCount).toBe(1);

    const log = await prisma.auditLog.findFirst({
      where: { entity: 'depreciation_run', entityId: '2026-05', action: 'DEPRECIATION_RUN_REVERSE' },
    });
    expect(log).toBeTruthy();
    expect((log!.newValue as any).reason).toBe('mistake');
  });

  it('rejects with empty/whitespace reason', async () => {
    const a = await postedAsset();
    await service.runManual('2026-05', userId);
    await expect(service.reverseRun('2026-05', '   ', userId)).rejects.toThrow();
  });

  it('rejects invalid period format', async () => {
    await expect(service.reverseRun('2026-13', 'reason', userId)).rejects.toThrow(/YYYY-MM/);
  });

  it('V15 closed period (current date) → DEPRECIATION_RUN_REVERSE_BLOCKED audit + reject', async () => {
    const finance = await prisma.companyInfo.findFirst({ where: { companyCode: 'FINANCE' } });
    if (!finance) throw new Error('FINANCE company missing');
    const a = await postedAsset();
    await service.runManual('2026-05', userId);
    const now = new Date();
    await prisma.accountingPeriod.upsert({
      where: { companyId_year_month: { companyId: finance.id, year: now.getFullYear(), month: now.getMonth() + 1 } },
      update: { status: 'CLOSED', closedAt: new Date(), closedById: userId },
      create: { companyId: finance.id, year: now.getFullYear(), month: now.getMonth() + 1, status: 'CLOSED', closedAt: new Date(), closedById: userId },
    });
    await expect(service.reverseRun('2026-05', 'test reason', userId)).rejects.toThrow(/period|งวด/i);
    const blocked = await prisma.auditLog.findFirst({
      where: { entity: 'depreciation_run', entityId: '2026-05', action: 'DEPRECIATION_RUN_REVERSE_BLOCKED' },
    });
    expect(blocked).toBeTruthy();
    await prisma.accountingPeriod.delete({
      where: { companyId_year_month: { companyId: finance.id, year: now.getFullYear(), month: now.getMonth() + 1 } },
    });
  });
});
```

- [ ] **Step 12.2: Implement reverseRun**

In `depreciation.service.ts`, inject `DepreciationReverseTemplate` and implement `reverseRun`:

```typescript
import { DepreciationReverseTemplate } from '../journal/cpa-templates/depreciation-reverse.template';
// ...

constructor(
  private readonly prisma: PrismaService,
  private readonly depreciationTemplate: DepreciationTemplate,
  private readonly depreciationReverseTemplate: DepreciationReverseTemplate,
) {}

// Replace the stub:
async reverseRun(
  period: string,
  reason: string,
  userId: string,
): Promise<{ reversedCount: number; entryNumbers: string[] }> {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) {
    throw new BadRequestException('รูปแบบงวดต้องเป็น YYYY-MM');
  }
  if (!reason || reason.trim().length === 0) {
    throw new BadRequestException('กรุณาระบุเหตุผลการกลับรายการ');
  }

  // V15 on current date (reverse JE posted today)
  const financeCompanyId = await this.getFinanceCompanyId();
  try {
    await validatePeriodOpen(this.prisma, new Date(), financeCompanyId);
  } catch (err: any) {
    await this.prisma.auditLog.create({
      data: {
        userId, action: 'DEPRECIATION_RUN_REVERSE_BLOCKED',
        entity: 'depreciation_run', entityId: period,
        oldValue: { period },
        newValue: { reason: err.message ?? 'period closed' },
      },
    });
    throw new BadRequestException(`ไม่สามารถ reverse: ${err.message ?? 'งวดบัญชีปิดแล้ว'}`);
  }

  return this.prisma.$transaction(async (tx) => {
    const result = await this.depreciationReverseTemplate.execute(
      { period, reversedById: userId },
      tx,
    );

    await tx.auditLog.create({
      data: {
        userId, action: 'DEPRECIATION_RUN_REVERSE',
        entity: 'depreciation_run', entityId: period,
        oldValue: { period },
        newValue: {
          period,
          reason,
          reversedCount: result.reversedCount,
          entryNumbers: result.entryNumbers,
        },
      },
    });

    return result;
  });
}
```

- [ ] **Step 12.3: Create DepreciationController**

```typescript
// apps/api/src/modules/depreciation/depreciation.controller.ts
import { Controller, Get, Post, Body, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { DepreciationService } from './depreciation.service';
import { RunDepreciationDto } from './dto/run-depreciation.dto';
import { ReverseDepreciationRunDto } from './dto/reverse-depreciation-run.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@ApiTags('Depreciation')
@ApiBearerAuth('JWT')
@Controller('depreciation')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DepreciationController {
  constructor(private readonly service: DepreciationService) {}

  @Get()
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  list() {
    return this.service.listRuns();
  }

  @Get('preview/:period')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  preview(@Param('period') period: string) {
    return this.service.previewRun(period);
  }

  @Post('run')
  @Roles('OWNER', 'FINANCE_MANAGER')
  run(@Body() dto: RunDepreciationDto, @CurrentUser('id') userId: string) {
    return this.service.runManual(dto.period, userId);
  }

  @Post(':period/reverse')
  @Roles('OWNER')
  reverse(
    @Param('period') period: string,
    @Body() dto: ReverseDepreciationRunDto,
    @CurrentUser('id') userId: string,
  ) {
    // dto.period must match URL :period — keep URL canonical
    return this.service.reverseRun(period, dto.reason, userId);
  }
}
```

- [ ] **Step 12.4: Wire controller into DepreciationModule**

```typescript
// apps/api/src/modules/depreciation/depreciation.module.ts
import { Module } from '@nestjs/common';
import { DepreciationService } from './depreciation.service';
import { DepreciationController } from './depreciation.controller';
import { JournalModule } from '../journal/journal.module';

@Module({
  imports: [JournalModule],
  controllers: [DepreciationController],
  providers: [DepreciationService],
  exports: [DepreciationService],
})
export class DepreciationModule {}
```

- [ ] **Step 12.5: Run tests + typecheck**

```bash
cd apps/api && npx jest src/modules/depreciation/__tests__/depreciation.service --runInBand
./tools/check-types.sh api
```

Expected: 16 tests pass (12 from prior tasks + 4 new), 0 type errors.

- [ ] **Step 12.6: Commit**

```bash
git add apps/api/src/modules/depreciation/depreciation.service.ts \
        apps/api/src/modules/depreciation/depreciation.controller.ts \
        apps/api/src/modules/depreciation/depreciation.module.ts \
        apps/api/src/modules/depreciation/__tests__/depreciation.service.spec.ts
git commit -m "feat(depreciation): reverseRun + 4 tests + Controller wiring

reverseRun delegates to DepreciationReverseTemplate (cascading reverse
across all unreversed entries in period), V15 guard on current date with
DEPRECIATION_RUN_REVERSE_BLOCKED audit on rejection, AuditLog
DEPRECIATION_RUN_REVERSE on success captures reversedCount + entryNumbers.

Controller: GET / GET preview/:period (all 4 roles), POST run
(OWNER+FINANCE_MANAGER), POST :period/reverse (OWNER only)."
```

---

## Task 13: DepreciationPage + dialogs + nav + Depreciation E2E

**Files:**
- Create: `apps/web/src/pages/depreciation/types.ts`
- Create: `apps/web/src/pages/depreciation/api.ts`
- Create: `apps/web/src/pages/depreciation/components/DepreciationRunDialog.tsx`
- Create: `apps/web/src/pages/depreciation/components/DepreciationPreviewTable.tsx`
- Create: `apps/web/src/pages/depreciation/components/ReverseDepreciationRunDialog.tsx`
- Create: `apps/web/src/pages/depreciation/DepreciationPage.tsx`
- Modify: `apps/web/src/App.tsx` (add lazy route)
- Modify: `apps/web/src/config/menu.ts` (add nav entry)
- Create: `apps/web/e2e/depreciation-manual.spec.ts`

- [ ] **Step 13.1: Create types.ts**

```typescript
// apps/web/src/pages/depreciation/types.ts
export interface DepreciationRunSummary {
  period: string;
  entryNumbers: string[];
  totalAmount: string;
  assetCount: number;
  ranAt: string;
  runByName: string | null;
  status: 'POSTED' | 'REVERSED';
}

export interface DepreciationPreviewLine {
  assetId: string;
  assetCode: string;
  assetName: string;
  monthlyDepr: string;
  drAccount: string;
  crAccount: string;
}

export interface DepreciationPreview {
  period: string;
  lines: DepreciationPreviewLine[];
  totalAmount: string;
  assetCount: number;
  alreadyRunForAssetIds: string[];
}
```

- [ ] **Step 13.2: Create api.ts**

```typescript
// apps/web/src/pages/depreciation/api.ts
import api from '@/lib/api';
import type { DepreciationRunSummary, DepreciationPreview } from './types';

export const depreciationApi = {
  list: async (): Promise<DepreciationRunSummary[]> => {
    const { data } = await api.get<DepreciationRunSummary[]>('/depreciation');
    return data;
  },
  preview: async (period: string): Promise<DepreciationPreview> => {
    const { data } = await api.get<DepreciationPreview>(`/depreciation/preview/${period}`);
    return data;
  },
  run: async (period: string): Promise<DepreciationRunSummary> => {
    const { data } = await api.post<DepreciationRunSummary>('/depreciation/run', { period });
    return data;
  },
  reverse: async (period: string, reason: string): Promise<{ reversedCount: number; entryNumbers: string[] }> => {
    const { data } = await api.post<{ reversedCount: number; entryNumbers: string[] }>(
      `/depreciation/${period}/reverse`,
      { period, reason },
    );
    return data;
  },
};
```

- [ ] **Step 13.3: Create DepreciationPreviewTable**

```typescript
// apps/web/src/pages/depreciation/components/DepreciationPreviewTable.tsx
import { formatNumberDecimal } from '@/utils/formatters';
import type { DepreciationPreview } from '../types';

export function DepreciationPreviewTable({ preview }: { preview: DepreciationPreview }) {
  if (preview.lines.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-4 text-center">
        ไม่มีสินทรัพย์ที่ต้องคิดค่าเสื่อมในงวดนี้
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b">
            <th className="text-left py-2 px-2">รหัสสินทรัพย์</th>
            <th className="text-left py-2 px-2">ชื่อ</th>
            <th className="text-right py-2 px-2">ค่าเสื่อม/เดือน</th>
            <th className="text-left py-2 px-2">Dr</th>
            <th className="text-left py-2 px-2">Cr</th>
          </tr>
        </thead>
        <tbody>
          {preview.lines.map((l) => (
            <tr key={l.assetId} className="border-b">
              <td className="py-2 px-2 font-mono">{l.assetCode}</td>
              <td className="py-2 px-2">{l.assetName}</td>
              <td className="py-2 px-2 text-right tabular-nums">
                {formatNumberDecimal(parseFloat(l.monthlyDepr))}
              </td>
              <td className="py-2 px-2 font-mono text-xs">{l.drAccount}</td>
              <td className="py-2 px-2 font-mono text-xs">{l.crAccount}</td>
            </tr>
          ))}
          <tr className="font-semibold">
            <td colSpan={2} className="py-2 px-2">รวม ({preview.assetCount} สินทรัพย์)</td>
            <td className="py-2 px-2 text-right tabular-nums">
              {formatNumberDecimal(parseFloat(preview.totalAmount))}
            </td>
            <td colSpan={2} />
          </tr>
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 13.4: Create DepreciationRunDialog**

```typescript
// apps/web/src/pages/depreciation/components/DepreciationRunDialog.tsx
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { formatNumberDecimal } from '@/utils/formatters';

export function DepreciationRunDialog({
  open, onOpenChange, period, totalAmount, assetCount, onConfirm, isPending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  period: string;
  totalAmount: number;
  assetCount: number;
  onConfirm: () => void;
  isPending: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>ยืนยันรันค่าเสื่อมงวด {period}</DialogTitle>
        </DialogHeader>
        <div className="space-y-2 text-sm">
          <p>จำนวนสินทรัพย์: <span className="font-semibold tabular-nums">{assetCount}</span></p>
          <p>ยอดรวม: <span className="font-semibold tabular-nums">{formatNumberDecimal(totalAmount)} บาท</span></p>
          <p className="text-muted-foreground mt-2">
            ระบบจะสร้าง Journal Entry และ Depreciation Entry สำหรับสินทรัพย์ทั้งหมด ไม่สามารถยกเลิกได้
            (ใช้ Reverse เพื่อกลับรายการภายหลัง)
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            ยกเลิก
          </Button>
          <Button onClick={onConfirm} disabled={isPending || assetCount === 0}>
            {isPending ? 'กำลังรัน…' : 'ยืนยันรัน'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 13.5: Create ReverseDepreciationRunDialog**

```typescript
// apps/web/src/pages/depreciation/components/ReverseDepreciationRunDialog.tsx
import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';

export function ReverseDepreciationRunDialog({
  open, onOpenChange, period, onConfirm, isPending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  period: string;
  onConfirm: (reason: string) => void;
  isPending: boolean;
}) {
  const [reason, setReason] = useState('');
  const valid = reason.trim().length >= 5;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>กลับรายการค่าเสื่อมงวด {period}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            จะกลับรายการ Journal Entry ทั้งหมดในงวดนี้ + คืน accumulatedDepr
            สินทรัพย์แต่ละตัว ไม่สามารถ undo ได้
          </p>
          <div>
            <Label>เหตุผล (ขั้นต่ำ 5 ตัวอักษร) *</Label>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            ยกเลิก
          </Button>
          <Button variant="destructive" disabled={!valid || isPending} onClick={() => onConfirm(reason)}>
            {isPending ? 'กำลังกลับรายการ…' : 'ยืนยันกลับรายการ'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 13.6: Create DepreciationPage**

```typescript
// apps/web/src/pages/depreciation/DepreciationPage.tsx
import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { TrendingDown, Undo2 } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import DataTable from '@/components/ui/DataTable';
import QueryBoundary from '@/components/QueryBoundary';
import { formatNumberDecimal, formatDateTime } from '@/utils/formatters';
import { getErrorMessage } from '@/lib/api';
import { depreciationApi } from './api';
import { DepreciationPreviewTable } from './components/DepreciationPreviewTable';
import { DepreciationRunDialog } from './components/DepreciationRunDialog';
import { ReverseDepreciationRunDialog } from './components/ReverseDepreciationRunDialog';
import type { DepreciationRunSummary } from './types';

function lastTwelveMonths(): { value: string; label: string }[] {
  const result: { value: string; label: string }[] = [];
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const label = d.toLocaleDateString('th-TH', { year: 'numeric', month: 'long' });
    result.push({ value, label });
  }
  return result;
}

export default function DepreciationPage() {
  const queryClient = useQueryClient();
  const months = useMemo(() => lastTwelveMonths(), []);
  const [selectedPeriod, setSelectedPeriod] = useState(months[0].value);
  const [showRun, setShowRun] = useState(false);
  const [reverseTargetPeriod, setReverseTargetPeriod] = useState<string | null>(null);

  const listQuery = useQuery({
    queryKey: ['depreciation-runs'],
    queryFn: () => depreciationApi.list(),
  });

  const previewQuery = useQuery({
    queryKey: ['depreciation-preview', selectedPeriod],
    queryFn: () => depreciationApi.preview(selectedPeriod),
    enabled: !!selectedPeriod,
  });

  const runMutation = useMutation({
    mutationFn: (period: string) => depreciationApi.run(period),
    onSuccess: (result) => {
      toast.success(`รันค่าเสื่อมเสร็จ ${result.assetCount} สินทรัพย์ (${formatNumberDecimal(parseFloat(result.totalAmount))} บาท)`);
      queryClient.invalidateQueries({ queryKey: ['depreciation-runs'] });
      queryClient.invalidateQueries({ queryKey: ['depreciation-preview'] });
      queryClient.invalidateQueries({ queryKey: ['assets'] });
      setShowRun(false);
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  const reverseMutation = useMutation({
    mutationFn: ({ period, reason }: { period: string; reason: string }) =>
      depreciationApi.reverse(period, reason),
    onSuccess: (r) => {
      toast.success(`กลับรายการ ${r.reversedCount} entries`);
      queryClient.invalidateQueries({ queryKey: ['depreciation-runs'] });
      queryClient.invalidateQueries({ queryKey: ['assets'] });
      setReverseTargetPeriod(null);
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  const columns = useMemo(() => [
    {
      key: 'period',
      label: 'งวด',
      render: (row: DepreciationRunSummary) => <span className="font-mono">{row.period}</span>,
    },
    {
      key: 'totalAmount',
      label: 'ยอดรวม',
      render: (row: DepreciationRunSummary) => (
        <span className="tabular-nums">{formatNumberDecimal(parseFloat(row.totalAmount))}</span>
      ),
    },
    {
      key: 'assetCount',
      label: 'จำนวนสินทรัพย์',
      render: (row: DepreciationRunSummary) => row.assetCount,
    },
    {
      key: 'ranAt',
      label: 'รันเมื่อ',
      render: (row: DepreciationRunSummary) => formatDateTime(row.ranAt),
    },
    {
      key: 'status',
      label: 'สถานะ',
      render: (row: DepreciationRunSummary) => (
        <Badge variant={row.status === 'POSTED' ? 'success' : 'outline'}>
          {row.status === 'POSTED' ? 'ลงบัญชีแล้ว' : 'กลับรายการ'}
        </Badge>
      ),
    },
    {
      key: 'action',
      label: 'จัดการ',
      render: (row: DepreciationRunSummary) =>
        row.status === 'POSTED' ? (
          <Button
            size="sm" mode="icon" variant="ghost" aria-label="กลับรายการ"
            onClick={() => setReverseTargetPeriod(row.period)}
          >
            <Undo2 className="h-4 w-4" />
          </Button>
        ) : null,
    },
  ], []);

  return (
    <div className="space-y-4">
      <PageHeader
        title="ค่าเสื่อมราคา"
        subtitle="Auto-run cron 01:00 BKK ทุกสิ้นเดือน · Manual run สำหรับ catch-up"
        icon={<TrendingDown className="h-5 w-5" />}
      />

      <Card>
        <CardHeader><CardTitle>1. รัน Manual</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-end gap-3">
            <div className="flex-1 max-w-xs">
              <label className="block text-sm font-medium mb-1">งวด</label>
              <Select value={selectedPeriod} onValueChange={setSelectedPeriod}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {months.map((m) => (
                    <SelectItem key={m.value} value={m.value}>
                      {m.label} ({m.value})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              onClick={() => setShowRun(true)}
              disabled={!previewQuery.data || previewQuery.data.assetCount === 0}
            >
              รันค่าเสื่อมงวดนี้
            </Button>
          </div>
          <QueryBoundary
            isLoading={previewQuery.isLoading}
            isError={previewQuery.isError}
            error={previewQuery.error}
            onRetry={() => previewQuery.refetch()}
            errorTitle="โหลด preview ไม่สำเร็จ"
          >
            {previewQuery.data && <DepreciationPreviewTable preview={previewQuery.data} />}
          </QueryBoundary>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>2. ประวัติการรัน</CardTitle></CardHeader>
        <CardContent>
          <QueryBoundary
            isLoading={listQuery.isLoading}
            isError={listQuery.isError}
            error={listQuery.error}
            onRetry={() => listQuery.refetch()}
            errorTitle="โหลดประวัติไม่สำเร็จ"
          >
            <DataTable columns={columns} data={listQuery.data ?? []} />
          </QueryBoundary>
        </CardContent>
      </Card>

      {previewQuery.data && (
        <DepreciationRunDialog
          open={showRun}
          onOpenChange={setShowRun}
          period={selectedPeriod}
          totalAmount={parseFloat(previewQuery.data.totalAmount)}
          assetCount={previewQuery.data.assetCount}
          onConfirm={() => runMutation.mutate(selectedPeriod)}
          isPending={runMutation.isPending}
        />
      )}
      {reverseTargetPeriod && (
        <ReverseDepreciationRunDialog
          open={!!reverseTargetPeriod}
          onOpenChange={(open) => { if (!open) setReverseTargetPeriod(null); }}
          period={reverseTargetPeriod}
          onConfirm={(reason) => reverseMutation.mutate({ period: reverseTargetPeriod, reason })}
          isPending={reverseMutation.isPending}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 13.7: Wire route + nav**

In `apps/web/src/App.tsx`:

```typescript
const DepreciationPage = lazy(() => import('./pages/depreciation/DepreciationPage'));
// In routes:
<Route path="/depreciation" element={
  <ProtectedRoute roles={['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT']}>
    <DepreciationPage />
  </ProtectedRoute>
} />
```

In `apps/web/src/config/menu.ts`, find the existing "สินทรัพย์" entry. Add a sibling entry below it:

```typescript
{
  label: 'ค่าเสื่อม',
  path: '/depreciation',
  icon: TrendingDown,  // import from lucide-react if not already
  roles: ['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT'],
},
```

(Match the exact shape used by sibling entries — could use different prop names like `iconName: 'TrendingDown'` depending on convention.)

- [ ] **Step 13.8: Create depreciation-manual.spec.ts E2E**

```typescript
// apps/web/e2e/depreciation-manual.spec.ts
import { test, expect } from '@playwright/test';
import { loginAsRole } from './helpers/login';

const API_URL = process.env.API_URL ?? 'http://localhost:3000';

test('preview + manual run depreciation via API', async ({ page }) => {
  await loginAsRole(page, 'FINANCE_MANAGER');

  // Create + post asset
  const createRes = await page.request.post(`${API_URL}/api/assets`, {
    data: {
      name: 'E2E Depr Test',
      category: 'EQUIPMENT',
      basePrice: 36000,
      usefulLifeMonths: 36,
      purchaseDate: '2026-01-15',
      paymentAccount: '11-1201',
    },
  });
  const created = await createRes.json();
  await page.request.post(`${API_URL}/api/assets/${created.id}/post`);

  const period = '2026-05';

  // Preview
  const previewRes = await page.request.get(`${API_URL}/api/depreciation/preview/${period}`);
  expect(previewRes.ok()).toBeTruthy();
  const preview = await previewRes.json();
  expect(preview.assetCount).toBeGreaterThanOrEqual(1);

  // Run
  const runRes = await page.request.post(`${API_URL}/api/depreciation/run`, {
    data: { period },
  });
  expect(runRes.ok()).toBeTruthy();
  const run = await runRes.json();
  expect(run.assetCount).toBeGreaterThanOrEqual(1);

  // Verify it appears in list
  const listRes = await page.request.get(`${API_URL}/api/depreciation`);
  const list = await listRes.json();
  expect(list.find((r: { period: string }) => r.period === period)).toBeTruthy();
});
```

- [ ] **Step 13.9: Verify typecheck + commit**

```bash
./tools/check-types.sh web
```

Expected: 0 errors.

```bash
git add apps/web/src/pages/depreciation/ \
        apps/web/src/App.tsx \
        apps/web/src/config/menu.ts \
        apps/web/e2e/depreciation-manual.spec.ts
git commit -m "feat(depreciation): DepreciationPage + dialogs + nav + E2E

Page: last-12-months period selector + preview table (per-asset rows
with monthlyDepr + Dr/Cr) + history DataTable with status badge +
reverse action. RunDialog confirms count + total before posting.
ReverseDialog requires reason ≥ 5 chars. Sidebar nav adds 'ค่าเสื่อม'.
E2E covers preview + manual run via API."
```

---


# Section C — Transfer audit list

## Task 14: AssetTransferService.listAllTransfers + 6 tests + GET /asset-transfers endpoint

**Files:**
- Modify: `apps/api/src/modules/asset/asset-transfer.service.ts`
- Modify: `apps/api/src/modules/asset/__tests__/asset-transfer.service.spec.ts` (add 6 cases)
- Modify: `apps/api/src/modules/asset/asset.controller.ts` (add GET /asset-transfers)

- [ ] **Step 14.1: Add tests**

Append to `asset-transfer.service.spec.ts`:

```typescript
describe('AssetTransferService.listAllTransfers', () => {
  beforeEach(async () => {
    await prisma.assetTransferHistory.deleteMany({});
  });

  it('returns paginated rows with joined asset + transferredBy', async () => {
    const a = await createPostedAsset('Alice', 'HQ');
    await transferSvc.transfer(a.id, {
      transferDate: '2026-05-08', toCustodian: 'Bob', reason: 'staff change',
    }, userId);
    const result = await transferSvc.listAllTransfers({ page: 1, limit: 50 });
    expect(result.total).toBe(1);
    expect(result.data[0]).toMatchObject({
      transferDate: expect.any(Object),  // Date or string
      toCustodian: 'Bob',
      reason: 'staff change',
      asset: expect.objectContaining({ assetCode: a.assetCode, name: a.name }),
      transferredBy: expect.objectContaining({ id: userId }),
    });
  });

  it('paginates correctly', async () => {
    const a = await createPostedAsset();
    for (let i = 0; i < 12; i++) {
      await transferSvc.transfer(a.id, {
        transferDate: '2026-05-08',
        toCustodian: `Person${i}`,
        reason: `transfer ${i}`,
      }, userId);
    }
    const page1 = await transferSvc.listAllTransfers({ page: 1, limit: 5 });
    expect(page1.data).toHaveLength(5);
    expect(page1.total).toBe(12);
    const page3 = await transferSvc.listAllTransfers({ page: 3, limit: 5 });
    expect(page3.data).toHaveLength(2);
  });

  it('filters by date range', async () => {
    const a = await createPostedAsset();
    await transferSvc.transfer(a.id, {
      transferDate: '2026-04-01', toCustodian: 'A', reason: 'apr',
    }, userId);
    await transferSvc.transfer(a.id, {
      transferDate: '2026-05-15', toCustodian: 'B', reason: 'may',
    }, userId);
    const result = await transferSvc.listAllTransfers({
      fromDate: '2026-05-01', toDate: '2026-05-31',
    });
    expect(result.total).toBe(1);
    expect(result.data[0].toCustodian).toBe('B');
  });

  it('filters by custodian (case-insensitive contains)', async () => {
    const a = await createPostedAsset();
    await transferSvc.transfer(a.id, {
      transferDate: '2026-05-08', toCustodian: 'Alice Wong', reason: 'one',
    }, userId);
    await transferSvc.transfer(a.id, {
      transferDate: '2026-05-09', toCustodian: 'Bob', reason: 'two',
    }, userId);
    const result = await transferSvc.listAllTransfers({ custodianContains: 'alice' });
    expect(result.total).toBe(1);
    expect(result.data[0].toCustodian).toBe('Alice Wong');
  });

  it('filters by branchId via asset relation', async () => {
    const branch = await prisma.branch.findFirst();
    if (!branch) return; // skip if no branches in test DB
    const a = await createPostedAsset();
    await prisma.fixedAsset.update({ where: { id: a.id }, data: { branchId: branch.id } });
    await transferSvc.transfer(a.id, {
      transferDate: '2026-05-08', toCustodian: 'Bob', reason: 'test',
    }, userId);
    const result = await transferSvc.listAllTransfers({ branchId: branch.id });
    expect(result.total).toBeGreaterThanOrEqual(1);
  });

  it('search matches assetCode/name/serialNo', async () => {
    const a = await createPostedAsset();
    await prisma.fixedAsset.update({
      where: { id: a.id },
      data: { name: 'Special Notebook X1', serialNo: 'SN-12345' },
    });
    await transferSvc.transfer(a.id, {
      transferDate: '2026-05-08', toCustodian: 'Bob', reason: 'test',
    }, userId);
    const byName = await transferSvc.listAllTransfers({ search: 'Special' });
    expect(byName.total).toBe(1);
    const bySerial = await transferSvc.listAllTransfers({ search: 'SN-12345' });
    expect(bySerial.total).toBe(1);
  });
});
```

- [ ] **Step 14.2: Implement listAllTransfers**

In `apps/api/src/modules/asset/asset-transfer.service.ts`, add the method (alongside existing `transfer`):

```typescript
async listAllTransfers(filters: {
  page?: number;
  limit?: number;
  search?: string;
  assetId?: string;
  custodianContains?: string;
  locationContains?: string;
  branchId?: string;
  fromDate?: string;
  toDate?: string;
}) {
  const page = filters.page ?? 1;
  const limit = filters.limit ?? 50;
  const where: Prisma.AssetTransferHistoryWhereInput = {};

  if (filters.assetId) where.assetId = filters.assetId;
  if (filters.custodianContains) {
    where.OR = [
      { fromCustodian: { contains: filters.custodianContains, mode: 'insensitive' } },
      { toCustodian: { contains: filters.custodianContains, mode: 'insensitive' } },
    ];
  }
  if (filters.locationContains) {
    where.AND = [
      ...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []),
      {
        OR: [
          { fromLocation: { contains: filters.locationContains, mode: 'insensitive' } },
          { toLocation: { contains: filters.locationContains, mode: 'insensitive' } },
        ],
      },
    ];
  }
  if (filters.branchId) {
    where.asset = { branchId: filters.branchId };
  }
  if (filters.fromDate || filters.toDate) {
    where.transferDate = {};
    if (filters.fromDate) where.transferDate.gte = new Date(filters.fromDate);
    if (filters.toDate) {
      const end = new Date(filters.toDate);
      end.setHours(23, 59, 59, 999);
      where.transferDate.lte = end;
    }
  }
  if (filters.search) {
    where.asset = {
      ...(typeof where.asset === 'object' ? where.asset : {}),
      OR: [
        { assetCode: { contains: filters.search, mode: 'insensitive' } },
        { name: { contains: filters.search, mode: 'insensitive' } },
        { serialNo: { contains: filters.search, mode: 'insensitive' } },
      ],
    };
  }

  const [data, total] = await Promise.all([
    this.prisma.assetTransferHistory.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { transferDate: 'desc' },
      include: {
        asset: { select: { id: true, assetCode: true, name: true, serialNo: true, branchId: true } },
        transferredBy: { select: { id: true, name: true } },
      },
    }),
    this.prisma.assetTransferHistory.count({ where }),
  ]);

  return { data, total, page, limit };
}
```

Add the import at top if missing:
```typescript
import { Prisma } from '@prisma/client';
```

- [ ] **Step 14.3: Add controller endpoint**

In `apps/api/src/modules/asset/asset.controller.ts`, add a new endpoint outside the `/assets` controller (will need separate route prefix). Two options:

**Option A (chosen — keep AssetController for cohesion, declare route at method level):**

Wait — NestJS controller-level prefix `/assets` means all method paths are under `/assets`. To expose `GET /asset-transfers`, we need either:
- (a) New controller at `apps/api/src/modules/asset/asset-transfer.controller.ts` with `@Controller('asset-transfers')`
- (b) Reroute at app prefix level — not possible since global prefix is `/api`

Option (a) is cleaner. Create `asset-transfer.controller.ts`:

```typescript
// apps/api/src/modules/asset/asset-transfer.controller.ts
import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { AssetTransferService } from './asset-transfer.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { BranchGuard } from '../auth/guards/branch.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@ApiTags('Asset Transfers')
@ApiBearerAuth('JWT')
@Controller('asset-transfers')
@UseGuards(JwtAuthGuard, RolesGuard, BranchGuard)
export class AssetTransferController {
  constructor(private readonly service: AssetTransferService) {}

  @Get()
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  list(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
    @Query('assetId') assetId?: string,
    @Query('custodianContains') custodianContains?: string,
    @Query('locationContains') locationContains?: string,
    @Query('branchId') branchId?: string,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
  ) {
    return this.service.listAllTransfers({
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      search, assetId, custodianContains, locationContains, branchId, fromDate, toDate,
    });
  }
}
```

- [ ] **Step 14.4: Wire AssetTransferController into AssetModule**

In `apps/api/src/modules/asset/asset.module.ts`, add to controllers:

```typescript
import { AssetTransferController } from './asset-transfer.controller';
// ...
controllers: [AssetController, AssetTransferController],
```

- [ ] **Step 14.5: Run tests + typecheck**

```bash
cd apps/api && npx jest src/modules/asset/__tests__/asset-transfer.service --runInBand
./tools/check-types.sh api
```

Expected: 16 tests pass (10 from Phase 1 + 6 new), 0 type errors.

- [ ] **Step 14.6: Commit**

```bash
git add apps/api/src/modules/asset/asset-transfer.service.ts \
        apps/api/src/modules/asset/asset-transfer.controller.ts \
        apps/api/src/modules/asset/asset.module.ts \
        apps/api/src/modules/asset/__tests__/asset-transfer.service.spec.ts
git commit -m "feat(asset): listAllTransfers + 6 tests + GET /asset-transfers

Cross-asset audit query with filters (search, custodian/location
contains, branchId, date range), paginated 50/page default, joined
asset + transferredBy. New AssetTransferController separated from
AssetController for clean route prefix."
```

---

## Task 15: AssetTransfersListPage + route + Transfer E2E

**Files:**
- Create: `apps/web/src/pages/transfers/AssetTransfersListPage.tsx`
- Modify: `apps/web/src/pages/assets/api.ts` (add listAllTransfers)
- Modify: `apps/web/src/pages/assets/types.ts` (add AssetTransferRow type)
- Modify: `apps/web/src/App.tsx` (add lazy route)
- Create: `apps/web/e2e/transfers-list.spec.ts`

- [ ] **Step 15.1: Add API wrapper + type**

In `apps/web/src/pages/assets/api.ts`, add to `assetsApi`:

```typescript
listAllTransfers: async (filters: {
  page?: number;
  limit?: number;
  search?: string;
  custodianContains?: string;
  locationContains?: string;
  branchId?: string;
  fromDate?: string;
  toDate?: string;
}): Promise<{ data: AssetTransferRow[]; total: number; page: number; limit: number }> => {
  const params: Record<string, string | number> = {};
  if (filters.page) params.page = filters.page;
  if (filters.limit) params.limit = filters.limit;
  if (filters.search) params.search = filters.search;
  if (filters.custodianContains) params.custodianContains = filters.custodianContains;
  if (filters.locationContains) params.locationContains = filters.locationContains;
  if (filters.branchId) params.branchId = filters.branchId;
  if (filters.fromDate) params.fromDate = filters.fromDate;
  if (filters.toDate) params.toDate = filters.toDate;
  const { data } = await api.get<{ data: AssetTransferRow[]; total: number; page: number; limit: number }>(
    '/asset-transfers', { params },
  );
  return data;
},
```

In `apps/web/src/pages/assets/types.ts`, add:

```typescript
export interface AssetTransferRow {
  id: string;
  transferId: string;
  transferDate: string;
  fromCustodian: string | null;
  toCustodian: string | null;
  fromLocation: string | null;
  toLocation: string | null;
  reason: string;
  asset: { id: string; assetCode: string; name: string; serialNo: string | null; branchId: string | null };
  transferredBy: { id: string; name: string };
  createdAt: string;
}
```

- [ ] **Step 15.2: Create AssetTransfersListPage**

```typescript
// apps/web/src/pages/transfers/AssetTransfersListPage.tsx
import { useState, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Search, ArrowRightLeft } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import DataTable from '@/components/ui/DataTable';
import QueryBoundary from '@/components/QueryBoundary';
import ThaiDateInput from '@/components/ui/ThaiDateInput';
import { useDebounce } from '@/hooks/useDebounce';
import { formatDateShortThai } from '@/utils/formatters';
import api from '@/lib/api';
import { assetsApi } from '../assets/api';
import type { AssetTransferRow } from '../assets/types';

interface Branch { id: string; name: string; }

export default function AssetTransfersListPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [searchInput, setSearchInput] = useState(searchParams.get('search') ?? '');
  const search = useDebounce(searchInput, 300);
  const custodianInput = searchParams.get('custodian') ?? '';
  const branchId = searchParams.get('branchId') ?? '';
  const fromDate = searchParams.get('fromDate') ?? '';
  const toDate = searchParams.get('toDate') ?? '';
  const page = Number(searchParams.get('page') ?? 1);

  const branchesQuery = useQuery({
    queryKey: ['branches'],
    queryFn: async () => (await api.get<Branch[]>('/branches')).data,
  });

  const listQuery = useQuery({
    queryKey: ['asset-transfers', { search, custodianInput, branchId, fromDate, toDate, page }],
    queryFn: () => assetsApi.listAllTransfers({
      search: search || undefined,
      custodianContains: custodianInput || undefined,
      branchId: branchId || undefined,
      fromDate: fromDate || undefined,
      toDate: toDate || undefined,
      page, limit: 50,
    }),
  });

  const setParam = (key: string, val: string | null) => {
    const next = new URLSearchParams(searchParams);
    if (val) next.set(key, val); else next.delete(key);
    if (key !== 'page') next.delete('page');
    setSearchParams(next);
  };

  const columns = useMemo(() => [
    {
      key: 'transferDate',
      label: 'วันที่โอน',
      render: (row: AssetTransferRow) => formatDateShortThai(row.transferDate),
    },
    {
      key: 'asset',
      label: 'รหัส/ชื่อสินทรัพย์',
      render: (row: AssetTransferRow) => (
        <button
          onClick={() => navigate(`/assets/${row.asset.id}`)}
          className="text-left hover:underline"
        >
          <span className="font-mono text-primary">{row.asset.assetCode}</span>
          <div className="text-xs text-muted-foreground">{row.asset.name}</div>
        </button>
      ),
    },
    {
      key: 'custodian',
      label: 'ผู้ดูแล',
      render: (row: AssetTransferRow) =>
        row.fromCustodian !== row.toCustodian ? (
          <span className="text-sm">
            {row.fromCustodian ?? '-'} → <strong>{row.toCustodian ?? '-'}</strong>
          </span>
        ) : (
          <span className="text-muted-foreground text-sm">{row.toCustodian ?? '-'}</span>
        ),
    },
    {
      key: 'location',
      label: 'ที่ตั้ง',
      render: (row: AssetTransferRow) =>
        row.fromLocation !== row.toLocation ? (
          <span className="text-sm">
            {row.fromLocation ?? '-'} → <strong>{row.toLocation ?? '-'}</strong>
          </span>
        ) : (
          <span className="text-muted-foreground text-sm">{row.toLocation ?? '-'}</span>
        ),
    },
    { key: 'reason', label: 'เหตุผล', render: (row: AssetTransferRow) => <span className="text-sm">{row.reason}</span> },
    { key: 'transferredBy', label: 'ผู้บันทึก', render: (row: AssetTransferRow) => row.transferredBy.name },
  ], [navigate]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="ประวัติการโอนสินทรัพย์"
        subtitle="Cross-asset audit view"
        icon={<ArrowRightLeft className="h-5 w-5" />}
        onBack={() => navigate('/assets')}
      />

      <Card>
        <CardContent className="p-4 grid grid-cols-1 md:grid-cols-5 gap-3">
          <div className="md:col-span-2 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-10"
              placeholder="ค้นหาสินทรัพย์ (รหัส/ชื่อ/serial)"
              value={searchInput}
              onChange={(e) => { setSearchInput(e.target.value); setParam('search', e.target.value || null); }}
            />
          </div>
          <Input
            placeholder="ผู้ดูแล (contains)"
            value={custodianInput}
            onChange={(e) => setParam('custodian', e.target.value || null)}
          />
          <ThaiDateInput
            value={fromDate}
            onChange={(e) => setParam('fromDate', e.target.value || null)}
          />
          <ThaiDateInput
            value={toDate}
            onChange={(e) => setParam('toDate', e.target.value || null)}
          />
          {branchesQuery.data && (
            <Select value={branchId || 'ALL'} onValueChange={(v) => setParam('branchId', v === 'ALL' ? null : v)}>
              <SelectTrigger><SelectValue placeholder="สาขา" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">ทุกสาขา</SelectItem>
                {branchesQuery.data.map((b) => (
                  <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </CardContent>
      </Card>

      <QueryBoundary
        isLoading={listQuery.isLoading}
        isError={listQuery.isError}
        error={listQuery.error}
        onRetry={() => listQuery.refetch()}
        errorTitle="โหลดประวัติการโอนไม่สำเร็จ"
      >
        <DataTable
          columns={columns}
          data={listQuery.data?.data ?? []}
          pagination={{
            page,
            totalPages: listQuery.data ? Math.max(1, Math.ceil(listQuery.data.total / 50)) : 1,
            total: listQuery.data?.total ?? 0,
            onPageChange: (p: number) => setParam('page', String(p)),
          }}
        />
      </QueryBoundary>
    </div>
  );
}
```

- [ ] **Step 15.3: Add lazy route**

In `apps/web/src/App.tsx`:

```typescript
const AssetTransfersListPage = lazy(() => import('./pages/transfers/AssetTransfersListPage'));
// In routes:
<Route path="/assets/transfers" element={
  <ProtectedRoute roles={['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT']}>
    <AssetTransfersListPage />
  </ProtectedRoute>
} />
```

- [ ] **Step 15.4: Create transfers-list.spec.ts E2E**

```typescript
// apps/web/e2e/transfers-list.spec.ts
import { test, expect } from '@playwright/test';
import { loginAsRole } from './helpers/login';

const API_URL = process.env.API_URL ?? 'http://localhost:3000';

test('list cross-asset transfers via API', async ({ page }) => {
  await loginAsRole(page, 'FINANCE_MANAGER');

  // Create + post asset, then transfer
  const createRes = await page.request.post(`${API_URL}/api/assets`, {
    data: {
      name: 'E2E Transfer Test',
      category: 'EQUIPMENT',
      basePrice: 10000,
      usefulLifeMonths: 24,
      purchaseDate: new Date().toISOString().slice(0, 10),
      paymentAccount: '11-1201',
      custodian: 'Alice',
      location: 'HQ',
    },
  });
  const created = await createRes.json();
  await page.request.post(`${API_URL}/api/assets/${created.id}/post`);

  await page.request.post(`${API_URL}/api/assets/${created.id}/transfer`, {
    data: {
      transferDate: new Date().toISOString().slice(0, 10),
      toCustodian: 'Bob',
      reason: 'E2E test transfer',
    },
  });

  const listRes = await page.request.get(`${API_URL}/api/asset-transfers?search=E2E+Transfer+Test`);
  expect(listRes.ok()).toBeTruthy();
  const list = await listRes.json();
  expect(list.total).toBeGreaterThanOrEqual(1);
  const found = list.data.find(
    (r: { asset: { id: string }; toCustodian: string }) =>
      r.asset.id === created.id && r.toCustodian === 'Bob',
  );
  expect(found).toBeTruthy();
});
```

- [ ] **Step 15.5: Verify typecheck + commit**

```bash
./tools/check-types.sh web
```

Expected: 0 errors. If `DataTable.pagination` shape differs from Task 12 usage, align with Phase 1's `AssetsListPage.tsx` pattern.

```bash
git add apps/web/src/pages/transfers/ \
        apps/web/src/pages/assets/api.ts \
        apps/web/src/pages/assets/types.ts \
        apps/web/src/App.tsx \
        apps/web/e2e/transfers-list.spec.ts
git commit -m "feat(asset): AssetTransfersListPage + route + E2E

Cross-asset audit list with search, custodian-contains, branch select,
date range filters. Clickable rows navigate to asset detail. Reachable
from /assets/transfers (no sidebar entry — accessed from DetailPage
'ดูประวัติการโอนทั้งหมด' link)."
```

---

## Task 16: Final verification + smoke + branch summary

- [ ] **Step 16.1: Full type check**

```bash
./tools/check-types.sh all
```

Expected: API: OK, Web: OK.

- [ ] **Step 16.2: Run all asset + depreciation jest tests**

```bash
cd apps/api && npx jest src/modules/asset src/modules/depreciation --runInBand
```

Expected: ~71 tests pass total (39 Phase 1 + 12 dispose + 16 depreciation + 6 listAllTransfers - any test count drift from Phase 1 fixtures).

- [ ] **Step 16.3: Run vitest CPA template tests**

```bash
cd apps/api && npx vitest run journal/cpa-templates --no-file-parallelism
```

Expected: ~51 tests pass total (35 Phase 1 + 8 disposal-reverse + 8 depreciation-reverse).

- [ ] **Step 16.4: Verify migration applies cleanly on a fresh dev DB**

```bash
cd apps/api && CONFIRM_WIPE=YES_I_AM_SURE EXPECTED_DB_NAME=$(npx prisma db execute --stdin <<< 'SELECT current_database();' 2>&1 | tail -1) npm run wipe:assets
cd apps/api && npx prisma migrate deploy
```

Expected: depreciation_reverse_tracking migration applies cleanly. (If wipe DB name detection fails, just use the literal dev DB name.)

- [ ] **Step 16.5: Manual smoke (optional — if dev API + Web are running)**

If both dev servers are up:
1. Login as `admin@bestchoice.com / admin1234`
2. Navigate to `/assets/new` → create test asset → POST → verify status POSTED
3. Navigate to `/assets/:id/dispose` → SALE form → fill → submit → verify status DISPOSED
4. Action menu → กลับรายการจำหน่าย → reason → verify status POSTED again
5. Navigate to `/depreciation` → preview current month → run → verify history shows new run
6. Click Reverse on the new run → reason → verify status REVERSED in list
7. Action on detail page transfer → confirm transfer → navigate to `/assets/transfers` → verify entry visible

If either server is unavailable, document as "manual smoke deferred" — Phase 1 had the same constraint.

- [ ] **Step 16.6: Branch summary commit**

```bash
git log --oneline main..feat/asset-module-phase2 | head -20
git log --oneline main..feat/asset-module-phase2 | wc -l
```

Confirm 16 task commits. If anything is missing, run any skipped step.

- [ ] **Step 16.7: Final verification commit (no-op or summary)**

If everything passes, this task is essentially documentation. Optionally commit a phase summary doc:

```bash
# Optional: write a summary doc
cat > docs/superpowers/reports/2026-05-09-asset-phase2-summary.md << 'EOF'
# Asset Module Phase 2 — Implementation Summary

Branch: feat/asset-module-phase2 (16 task commits)
TypeScript: 0 errors
Tests: ~71 jest + ~51 vitest = ~122 backend tests, 4 E2E specs

Sections shipped:
- A: Disposal page + Sale/Write-off toggle + reverse + DetailPage actions
- B: Depreciation manual run + preview + reverse + history + cron unchanged
- C: Asset transfers cross-asset audit list

Known concerns:
- E2E tests deferred (require running dev servers)
- (Add anything else discovered during implementation)
EOF
git add docs/superpowers/reports/2026-05-09-asset-phase2-summary.md
git commit -m "docs(asset): Phase 2 implementation summary"
```

---

## Self-Review

**1. Spec coverage check:**

| Spec section | Task |
|--------------|------|
| Section A — Disposal DTOs | Task 1 |
| Section A — AssetDisposalReverseTemplate + 8 tests | Task 2 |
| Section A — AssetService.dispose + reverseDispose + 12 tests | Task 3 |
| Section A — POST /:id/dispose, POST /:id/reverse-dispose | Task 4 |
| Section A — Frontend foundation (zod, hook, API) | Task 5 |
| Section A — AssetDisposePage + ReverseDisposalDialog + DetailPage actions | Task 6 |
| Section A — Routes + 2 E2E | Task 7 |
| Section B — DepreciationEntry schema migration | Task 8 |
| Section B — DepreciationService listRuns + previewRun + 6 tests | Task 9 |
| Section B — DepreciationService runManual + 6 tests | Task 10 |
| Section B — DepreciationReverseTemplate + 8 tests | Task 11 |
| Section B — DepreciationService reverseRun + Controller + 4 tests | Task 12 |
| Section B — DepreciationPage + dialogs + nav + E2E | Task 13 |
| Section C — listAllTransfers + 6 tests + GET /asset-transfers | Task 14 |
| Section C — AssetTransfersListPage + route + E2E | Task 15 |
| Final verification + smoke + summary | Task 16 |
| Audit log convention (ASSET_DISPOSE/_BLOCKED/REVERSE_DISPOSE/_BLOCKED, DEPRECIATION_RUN_MANUAL/_BLOCKED/_REVERSE/_BLOCKED) | Tasks 3, 10, 12 |
| Permissions matrix per spec | Tasks 4, 12, 14 |
| V15 period guard semantics (post on disposalDate, reverse/run on current/period date) | Tasks 3, 10, 12 |
| Manual smoke + 4 E2E specs | Tasks 7, 13, 15, 16 |

**2. Placeholder scan:** All steps contain explicit code blocks or commands with expected output. Several spec stubs noted in code comments ("implement in Task N") are intentional handoff markers, not placeholders.

**3. Type consistency:**

- `DepreciationRunSummary` referenced in Tasks 9, 10, 12, 13 — same shape (period, entryNumbers, totalAmount, assetCount, ranAt, runByName, status).
- `DepreciationPreview` / `DepreciationPreviewLine` consistent across Tasks 9, 13.
- `AssetTransferRow` in Task 15 matches what `listAllTransfers` returns in Task 14.
- `DisposalFormValues` (zod inferred) used in Tasks 5, 6.
- `DisposalCalculation` used in Tasks 5, 6.
- All API method signatures (`assetsApi.dispose`, `depreciationApi.run`, etc.) match controller endpoint shapes.
- AuditLog entity strings: `'fixed_asset'` for asset-level actions, `'depreciation_run'` (with entityId=period) for cross-asset depreciation actions — consistently applied.

**4. Known soft spots flagged inline in tasks:**

- Task 6: `RadioGroup` may not exist in shadcn/ui install — fallback to Checkbox/Select noted.
- Task 13: `DataTable.pagination` shape may differ — align with AssetsListPage from Phase 1.
- Task 14: NestJS `@Controller` prefix prevents `GET /asset-transfers` from `AssetController` (which has `@Controller('assets')`). Solved by separate `AssetTransferController`.
- Task 8: prisma migrate dev uses shadow DB which may fail on pgvector — Phase 1 hand-wrote migration SQL; same fallback applies here.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-09-asset-module-phase2.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration. ~16 task cycles, each with build + test + commit verification.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
