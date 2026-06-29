# Purchasing v2 — Batch 0: Backend Additive Foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lay the purely-additive backend foundation for the Purchasing & Receiving UX overhaul — a new `ORDERED` PO state + "สั่งซื้อ" action, a numbered Goods Receipt (`grNumber`), a structured `DefectReason`, a compute-on-read purchasing summary, and the retirement of the dead legacy `receive()` path — without touching accounting/finance.

**Architecture:** Extend the existing, already-isolated `purchase-orders` module additively. New schema columns/enums + two new endpoints (`POST /:id/order`, `GET /summary`) + a GR-number generator wired into the existing Serializable `goodsReceiving()` transaction. No data-model rewrite, no nullable-FK churn (direct-receive arrives in B3 as auto-PO), no cross-module imports.

**Tech Stack:** NestJS + Prisma + PostgreSQL (`apps/api`), jest unit tests, `class-validator` DTOs.

**Spec:** `docs/superpowers/specs/2026-06-29-purchasing-receiving-ux-v2-design.md`

## Global Constraints

- **Red line — no accounting/finance:** receiving stays **JE-free**; introduce **no** import of any accounting/finance/journal/expense/tax module into `purchase-orders`; do not touch `trade-in` or `Product.ownedByCompanyId`. (Verified: module is `imports: []`, Prisma-only.)
- **Additive only:** no rewrite of existing models; `GoodsReceiving.poId` and `GoodsReceivingItem.poItemId` **stay `NOT NULL`**.
- **Migration timestamp = `20260978000000`** (verified 2026-06-29: the highest existing migration is `20260977000000_add_payment_drafts`, so `20260977000000` is taken — use `20260978000000`). Production uses `prisma migrate deploy` only.
- **Money = `Decimal` (`@db.Decimal(12,2)`)**, never Float/Int.
- **Soft delete:** every read filters `deletedAt: null`; never hard-delete.
- **Validation messages in Thai** (`class-validator`).
- **Tests:** jest; DB-backed specs run `--runInBand` (parallel-DB is flaky per memory). These B0 specs are mock-based (no DB) so they run in the normal suite.
- **Type gate:** `./tools/check-types.sh all` must report 0 errors before each commit.

---

### Task 1: Schema migration — `ORDERED`, `orderedAt`, `isDirectReceive`, `grNumber`, `DefectReason`

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (enum `POStatus` ~line 191; model `PurchaseOrder` ~line 1523; model `GoodsReceiving` lines 1814-1829; model `GoodsReceivingItem` lines 1831-1857)
- Create: `apps/api/prisma/migrations/20260978000000_purchasing_v2_foundation/migration.sql`

**Interfaces:**
- Produces: `POStatus.ORDERED`; `PurchaseOrder.orderedAt: DateTime?`, `PurchaseOrder.isDirectReceive: Boolean (default false)`; `GoodsReceiving.grNumber: String @unique`; `GoodsReceivingItem.defectReason: DefectReason?`; new `enum DefectReason`.

- [ ] **Step 1: Edit the schema — `POStatus` enum**

In `apps/api/prisma/schema.prisma`, add `ORDERED` to `enum POStatus` (place it after `APPROVED`):

```prisma
enum POStatus {
  DRAFT
  APPROVED
  ORDERED
  PENDING
  PARTIALLY_RECEIVED
  FULLY_RECEIVED
  CANCELLED
}
```

- [ ] **Step 2: Edit the schema — new `DefectReason` enum**

Add a new enum near the other purchasing enums (e.g. just below `POStatus`):

```prisma
enum DefectReason {
  SCREEN
  BATTERY
  IMEI_BLOCKED
  BOX_MISSING
  WRONG_MODEL
  DOA
  COSMETIC
  OTHER
}
```

- [ ] **Step 3: Edit the schema — `PurchaseOrder` fields**

In `model PurchaseOrder`, add two columns alongside the existing scalar fields (next to `status`):

```prisma
  orderedAt       DateTime? @map("ordered_at")
  isDirectReceive Boolean   @default(false) @map("is_direct_receive")
```

- [ ] **Step 4: Edit the schema — `GoodsReceiving.grNumber` + `GoodsReceivingItem.defectReason`**

In `model GoodsReceiving` add (after `id`):

```prisma
  grNumber     String    @unique @map("gr_number")
```

In `model GoodsReceivingItem` add (after `rejectReason`):

```prisma
  defectReason DefectReason? @map("defect_reason")
```

(Do **not** add a separate `@@index([grNumber])` — `@unique` already creates the index.)

- [ ] **Step 5: Generate the migration SQL (create-only) so it can be hand-edited for the grNumber backfill**

Run: `cd apps/api && npx prisma migrate dev --name purchasing_v2_foundation --create-only`
Expected: a new folder `prisma/migrations/<timestamp>_purchasing_v2_foundation/migration.sql` is created. Rename the folder so its timestamp is `20260978000000`.

- [ ] **Step 6: Replace the auto-generated `grNumber` step with a safe 2-step backfill**

A `NOT NULL UNIQUE` column cannot be added directly to a populated table. Edit `migration.sql` so the `goods_receivings.gr_number` section reads exactly (keep the auto-generated `ALTER TYPE`/`ADD COLUMN` lines for the other fields):

```sql
-- PurchaseOrder additive columns
ALTER TABLE "purchase_orders" ADD COLUMN "ordered_at" TIMESTAMP(3);
ALTER TABLE "purchase_orders" ADD COLUMN "is_direct_receive" BOOLEAN NOT NULL DEFAULT false;

-- POStatus + DefectReason enums (auto-generated ALTER TYPE / CREATE TYPE lines kept as generated)

-- GoodsReceivingItem.defect_reason
ALTER TABLE "goods_receiving_items" ADD COLUMN "defect_reason" "DefectReason";

-- GoodsReceiving.gr_number — 2-step: add nullable, backfill, then NOT NULL + UNIQUE
ALTER TABLE "goods_receivings" ADD COLUMN "gr_number" TEXT;

WITH seq AS (
  SELECT id,
         'GR-' || to_char("created_at", 'YYYY-MM') || '-' ||
         lpad(
           (row_number() OVER (PARTITION BY to_char("created_at", 'YYYY-MM')
                               ORDER BY "created_at", id))::text,
           3, '0'
         ) AS gr
  FROM "goods_receivings"
)
UPDATE "goods_receivings" g SET "gr_number" = seq.gr FROM seq WHERE g.id = seq.id;

ALTER TABLE "goods_receivings" ALTER COLUMN "gr_number" SET NOT NULL;
CREATE UNIQUE INDEX "goods_receivings_gr_number_key" ON "goods_receivings"("gr_number");
```

- [ ] **Step 7: Apply the migration + regenerate the client**

Run: `cd apps/api && npx prisma migrate dev`
Expected: migration applies cleanly; `Prisma Client` regenerates with the new fields/enums.

- [ ] **Step 8: Type-check**

Run: `./tools/check-types.sh all`
Expected: 0 errors.

- [ ] **Step 9: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations/20260978000000_purchasing_v2_foundation
git commit -m "feat(purchasing): additive schema — ORDERED, orderedAt, isDirectReceive, grNumber, DefectReason"
```

---

### Task 2: "สั่งซื้อ" action — `POST /purchase-orders/:id/order`

**Files:**
- Modify: `apps/api/src/modules/purchase-orders/dto/create-po.dto.ts` (add `OrderPODto`)
- Modify: `apps/api/src/modules/purchase-orders/services/po-lifecycle.service.ts` (add `order()`)
- Modify: `apps/api/src/modules/purchase-orders/purchase-orders.service.ts` (facade delegate)
- Modify: `apps/api/src/modules/purchase-orders/purchase-orders.controller.ts` (new route)
- Create: `apps/api/src/modules/purchase-orders/purchase-orders.order.spec.ts`

**Interfaces:**
- Consumes: `PoQueryService.findOne(id)` (existing — reads via `prisma.purchaseOrder.findUnique`, throws `NotFoundException` if missing/deleted).
- Produces: `PurchaseOrdersService.order(id: string, userId: string, dto: OrderPODto): Promise<PurchaseOrder>` — `APPROVED → ORDERED`, sets `orderedAt = now`, optionally updates `expectedDate`.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/modules/purchase-orders/purchase-orders.order.spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { PurchaseOrdersService } from './purchase-orders.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('PurchaseOrdersService.order — APPROVED → ORDERED', () => {
  let service: PurchaseOrdersService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  const makePrisma = (status: string) => ({
    purchaseOrder: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'po-1', status, deletedAt: null, items: [], supplier: { id: 's1', name: 'S' },
      }),
      update: jest.fn().mockImplementation(({ data }) =>
        Promise.resolve({ id: 'po-1', status: data.status, orderedAt: data.orderedAt })),
    },
  });

  const build = async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PurchaseOrdersService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    return module.get<PurchaseOrdersService>(PurchaseOrdersService);
  };

  it('advances an APPROVED PO to ORDERED and stamps orderedAt', async () => {
    prisma = makePrisma('APPROVED');
    service = await build();
    const result = await service.order('po-1', 'user-1', {});
    expect(result.status).toBe('ORDERED');
    expect(prisma.purchaseOrder.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'po-1' },
        data: expect.objectContaining({ status: 'ORDERED', orderedAt: expect.any(Date) }),
      }),
    );
  });

  it('rejects ordering a PO that is not APPROVED', async () => {
    prisma = makePrisma('DRAFT');
    service = await build();
    await expect(service.order('po-1', 'user-1', {})).rejects.toThrow(BadRequestException);
  });

  it('updates expectedDate when provided', async () => {
    prisma = makePrisma('APPROVED');
    service = await build();
    await service.order('po-1', 'user-1', { expectedDate: '2026-07-15' });
    expect(prisma.purchaseOrder.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ expectedDate: new Date('2026-07-15') }) }),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx jest purchase-orders.order.spec.ts`
Expected: FAIL — `service.order is not a function`.

- [ ] **Step 3: Add `OrderPODto`**

In `dto/create-po.dto.ts`, add:

```typescript
export class OrderPODto {
  @IsDateString()
  @IsOptional()
  expectedDate?: string;
}
```

- [ ] **Step 4: Add `order()` to `PoLifecycleService`**

In `po-lifecycle.service.ts`, add this method (after `approve()`), and import `OrderPODto`:

```typescript
  async order(id: string, userId: string, dto: { expectedDate?: string }) {
    const po = await this.query.findOne(id);
    if (po.status !== 'APPROVED') {
      throw new BadRequestException('สั่งซื้อได้เฉพาะ PO ที่อนุมัติแล้ว (APPROVED) เท่านั้น');
    }
    return this.prisma.purchaseOrder.update({
      where: { id },
      data: {
        status: 'ORDERED',
        orderedAt: new Date(),
        ...(dto.expectedDate ? { expectedDate: new Date(dto.expectedDate) } : {}),
      },
      include: {
        supplier: { select: { id: true, name: true } },
        items: true,
      },
    });
  }
```

Update the import line at the top of the file:

```typescript
import { CreatePODto, UpdatePODto, UpdatePaymentDto, OrderPODto } from '../dto/create-po.dto';
```

(`OrderPODto` is referenced by the facade/controller; importing here keeps the type available if you choose to type the param as `OrderPODto`.)

- [ ] **Step 5: Add the facade delegate**

In `purchase-orders.service.ts`, add (after `approve()`), and add `OrderPODto` to the dto import:

```typescript
  order(id: string, userId: string, dto: OrderPODto) {
    return this.lifecycle.order(id, userId, dto);
  }
```

Import update at top:

```typescript
import { CreatePODto, UpdatePODto, ReceivePODto, GoodsReceivingDto, UpdatePaymentDto, OrderPODto } from './dto/create-po.dto';
```

- [ ] **Step 6: Add the controller route**

In `purchase-orders.controller.ts`, add `OrderPODto` to the dto import and add the route (after `approve`):

```typescript
  @Post(':id/order')
  @Roles('OWNER', 'BRANCH_MANAGER')
  order(
    @Param('id') id: string,
    @Body() dto: OrderPODto,
    @CurrentUser() user: { id: string },
  ) {
    return this.purchaseOrdersService.order(id, user.id, dto);
  }
```

- [ ] **Step 7: Run test to verify it passes**

Run: `cd apps/api && npx jest purchase-orders.order.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 8: Type-check + commit**

```bash
./tools/check-types.sh all
git add apps/api/src/modules/purchase-orders
git commit -m "feat(purchasing): add POST /:id/order (APPROVED -> ORDERED) with orderedAt"
```

---

### Task 3: `grNumber` generator + wire into `goodsReceiving()` with retry

**Files:**
- Modify: `apps/api/src/utils/sequence.util.ts` (add `generateGRNumber`)
- Modify: `apps/api/src/modules/purchase-orders/services/po-receiving.service.ts` (`goodsReceiving()` — set `grNumber`, wrap in retry, return it)
- Create: `apps/api/src/utils/sequence.gr.spec.ts`

**Interfaces:**
- Consumes: `PrismaTx` (existing type used by `generatePONumber`).
- Produces: `generateGRNumber(tx: PrismaTx): Promise<string>` → `GR-YYYY-MM-NNN`; `goodsReceiving()` result now includes `grNumber: string`.

- [ ] **Step 1: Write the failing test for the generator**

Create `apps/api/src/utils/sequence.gr.spec.ts`:

```typescript
import { generateGRNumber } from './sequence.util';

describe('generateGRNumber', () => {
  it('formats GR-YYYY-MM-NNN using the monthly count + 1', async () => {
    const tx = { goodsReceiving: { count: jest.fn().mockResolvedValue(4) } };
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const gr = await generateGRNumber(tx as any);
    expect(gr).toBe(`GR-${yyyy}-${mm}-005`);
    expect(tx.goodsReceiving.count).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ createdAt: expect.any(Object) }) }),
    );
  });

  it('starts at 001 when there are no receivings this month', async () => {
    const tx = { goodsReceiving: { count: jest.fn().mockResolvedValue(0) } };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const gr = await generateGRNumber(tx as any);
    expect(gr.endsWith('-001')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx jest sequence.gr.spec.ts`
Expected: FAIL — `generateGRNumber is not a function`.

- [ ] **Step 3: Implement `generateGRNumber`**

In `apps/api/src/utils/sequence.util.ts`, add below `generatePONumber` (mirroring it exactly, counting `goodsReceiving`):

```typescript
export async function generateGRNumber(tx: PrismaTx): Promise<string> {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const monthStart = new Date(year, today.getMonth(), 1);
  const monthEnd = new Date(year, today.getMonth() + 1, 1);
  const monthCount = await tx.goodsReceiving.count({
    where: { createdAt: { gte: monthStart, lt: monthEnd } },
  });
  return `GR-${year}-${month}-${String(monthCount + 1).padStart(3, '0')}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && npx jest sequence.gr.spec.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Wire `grNumber` into `goodsReceiving()`**

In `po-receiving.service.ts`: import the generator, set `grNumber` on the GR create, and return it.

Add to the import at the top:

```typescript
import { generateGRNumber } from '../../../utils/sequence.util';
```

Change the GR-create block (currently lines ~160-166) to:

```typescript
        // Generate GR number inside the serializable tx; @unique is the backstop.
        const grNumber = await generateGRNumber(tx);
        const receiving = await tx.goodsReceiving.create({
          data: {
            grNumber,
            poId: id,
            receivedById: userId,
            notes: dto.notes,
          },
        });
```

Add `grNumber` to the return object (currently lines ~341-349):

```typescript
        return {
          receivingId: receiving.id,
          grNumber,
          poId: id,
          status: newStatus,
          passed: passedProducts.length,
          rejected: rejectedItems.length,
          products: passedProducts,
          mainWarehouse: mainWarehouse!.name,
        };
```

- [ ] **Step 6: Add a retry wrapper around the transaction (count-based numbering is not collision-proof on its own)**

Wrap the existing `return this.prisma.$transaction(...)` in `goodsReceiving()` with a bounded retry on unique-collision (P2002) / serialization-failure (P2034). Replace `return this.prisma.$transaction(` with a loop:

```typescript
  async goodsReceiving(id: string, dto: GoodsReceivingDto, userId: string) {
    const MAX_ATTEMPTS = 3;
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.prisma.$transaction(
          async (tx) => {
            // ... existing body unchanged ...
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      } catch (e) {
        const code = (e as { code?: string })?.code;
        if ((code === 'P2002' || code === 'P2034') && attempt < MAX_ATTEMPTS) continue;
        throw e;
      }
    }
  }
```

(The existing transaction body — branch lookup, GR create, item loop, ceiling check, status recompute — is unchanged; it just now lives inside the `try`.)

- [ ] **Step 7: Write a focused test for the retry wrapper**

Create `apps/api/src/modules/purchase-orders/purchase-orders.grnumber-retry.spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { PurchaseOrdersService } from './purchase-orders.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('goodsReceiving — retries on grNumber unique collision (P2002)', () => {
  it('retries the transaction once on P2002 then succeeds', async () => {
    let calls = 0;
    const prisma: any = {
      $transaction: jest.fn().mockImplementation(async (fn: any) => {
        calls += 1;
        if (calls === 1) {
          const err: any = new Error('Unique constraint failed');
          err.code = 'P2002';
          throw err;
        }
        return { receivingId: 'r1', grNumber: 'GR-2026-06-002', status: 'FULLY_RECEIVED' };
      }),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [PurchaseOrdersService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    const service = module.get<PurchaseOrdersService>(PurchaseOrdersService);

    const result = await service.goodsReceiving('po-1', { items: [] } as never, 'user-1');
    expect(calls).toBe(2);
    expect(result.grNumber).toBe('GR-2026-06-002');
  });
});
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `cd apps/api && npx jest sequence.gr.spec.ts purchase-orders.grnumber-retry.spec.ts`
Expected: PASS.

- [ ] **Step 9: Type-check + commit**

```bash
./tools/check-types.sh all
git add apps/api/src/utils apps/api/src/modules/purchase-orders
git commit -m "feat(purchasing): numbered Goods Receipt (grNumber) with collision retry"
```

---

### Task 4: Persist structured `defectReason` on rejected receiving items

**Files:**
- Modify: `apps/api/src/modules/purchase-orders/dto/create-po.dto.ts` (`GoodsReceivingItemDto.defectReason`)
- Modify: `apps/api/src/modules/purchase-orders/services/po-receiving.service.ts` (REJECT branch persists `defectReason`)
- Create: `apps/api/src/modules/purchase-orders/purchase-orders.defect.spec.ts`

**Interfaces:**
- Produces: `GoodsReceivingItemDto.defectReason?: DefectReason`; rejected `GoodsReceivingItem` rows store `defectReason`.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/modules/purchase-orders/purchase-orders.defect.spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { PurchaseOrdersService } from './purchase-orders.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('goodsReceiving — persists structured defectReason on REJECT', () => {
  it('writes defectReason onto the rejected GoodsReceivingItem', async () => {
    const created: any[] = [];
    const tx: any = {
      purchaseOrder: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'po-1', status: 'APPROVED', deletedAt: null, supplierId: 's1',
          items: [{ id: 'poi-1', category: 'PHONE_NEW', brand: 'A', model: 'B' }],
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      branch: { findFirst: jest.fn().mockResolvedValue({ id: 'wh', name: 'คลังกลาง' }) },
      goodsReceiving: { create: jest.fn().mockResolvedValue({ id: 'gr1' }), count: jest.fn().mockResolvedValue(0) },
      goodsReceivingItem: { create: jest.fn().mockImplementation(({ data }) => { created.push(data); return Promise.resolve({ id: 'gri1', ...data }); }) },
      pOItem: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn() },
      product: { create: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
      productPrice: { create: jest.fn() },
    };
    const prisma: any = { $transaction: jest.fn().mockImplementation((fn: any) => fn(tx)) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [PurchaseOrdersService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    const service = module.get<PurchaseOrdersService>(PurchaseOrdersService);

    await service.goodsReceiving('po-1', {
      items: [{ poItemId: 'poi-1', status: 'REJECT', rejectReason: 'จอแตก', defectReason: 'SCREEN' }],
    } as never, 'user-1');

    expect(created[0]).toEqual(expect.objectContaining({ status: 'REJECT', defectReason: 'SCREEN', rejectReason: 'จอแตก' }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx jest purchase-orders.defect.spec.ts`
Expected: FAIL — created item has no `defectReason`.

- [ ] **Step 3: Add the DTO field**

In `dto/create-po.dto.ts`, import the enum and add the field to `GoodsReceivingItemDto`:

```typescript
import { DefectReason } from '@prisma/client';
```
```typescript
  @IsEnum(DefectReason)
  @IsOptional()
  defectReason?: DefectReason;
```
Add `IsEnum` to the `class-validator` import list at the top of the file.

- [ ] **Step 4: Persist it in the REJECT branch**

In `po-receiving.service.ts`, in the `else` (REJECT) branch where the rejected `goodsReceivingItem` is created (currently ~lines 301-311), add `defectReason`:

```typescript
            const rejectedItem = await tx.goodsReceivingItem.create({
              data: {
                receivingId: receiving.id,
                poItemId: item.poItemId,
                imeiSerial: item.imeiSerial,
                serialNumber: item.serialNumber,
                photos: item.photos || [],
                status: 'REJECT',
                rejectReason: item.rejectReason,
                defectReason: item.defectReason ?? null,
              },
            });
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/api && npx jest purchase-orders.defect.spec.ts`
Expected: PASS.

- [ ] **Step 6: Type-check + commit**

```bash
./tools/check-types.sh all
git add apps/api/src/modules/purchase-orders
git commit -m "feat(purchasing): structured DefectReason on rejected receiving items"
```

---

### Task 5: `GET /purchase-orders/summary` — compute-on-read counts

**Files:**
- Modify: `apps/api/src/modules/purchase-orders/services/po-query.service.ts` (add `getSummary()`)
- Modify: `apps/api/src/modules/purchase-orders/purchase-orders.service.ts` (facade)
- Modify: `apps/api/src/modules/purchase-orders/purchase-orders.controller.ts` (static route, **before** `:id`)
- Create: `apps/api/src/modules/purchase-orders/purchase-orders.summary.spec.ts`

**Interfaces:**
- Produces: `PurchaseOrdersService.getSummary(): Promise<{ pendingApproval: number; toOrder: number; incoming: number; overdue: number; receiving: number; waitingQc: number; unpaid: number }>`.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/modules/purchase-orders/purchase-orders.summary.spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { PurchaseOrdersService } from './purchase-orders.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('PurchaseOrdersService.getSummary', () => {
  it('returns compute-on-read counts incl. overdue (ORDERED & expectedDate < now)', async () => {
    const poCount = jest.fn().mockImplementation(({ where }) => {
      if (where.status === 'DRAFT') return Promise.resolve(2);
      if (where.status === 'APPROVED') return Promise.resolve(3);
      if (where.status === 'ORDERED' && where.expectedDate) return Promise.resolve(1); // overdue
      if (where.status === 'ORDERED') return Promise.resolve(5); // incoming
      if (where.status === 'PARTIALLY_RECEIVED') return Promise.resolve(4);
      if (where.paymentStatus) return Promise.resolve(7); // unpaid
      return Promise.resolve(0);
    });
    const prisma: any = {
      purchaseOrder: { count: poCount },
      product: { count: jest.fn().mockResolvedValue(6) }, // waitingQc
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [PurchaseOrdersService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    const service = module.get<PurchaseOrdersService>(PurchaseOrdersService);

    const s = await service.getSummary();
    expect(s).toEqual({
      pendingApproval: 2, toOrder: 3, incoming: 5, overdue: 1,
      receiving: 4, waitingQc: 6, unpaid: 7,
    });
    // overdue query must filter ORDERED + expectedDate < now
    expect(poCount).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: 'ORDERED', expectedDate: { lt: expect.any(Date) } }) }),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx jest purchase-orders.summary.spec.ts`
Expected: FAIL — `service.getSummary is not a function`.

- [ ] **Step 3: Implement `getSummary()` in `PoQueryService`**

Add to `po-query.service.ts`:

```typescript
  async getSummary() {
    const now = new Date();
    const base = { deletedAt: null };
    const [pendingApproval, toOrder, incoming, overdue, receiving, waitingQc, unpaid] = await Promise.all([
      this.prisma.purchaseOrder.count({ where: { ...base, status: 'DRAFT' } }),
      this.prisma.purchaseOrder.count({ where: { ...base, status: 'APPROVED' } }),
      this.prisma.purchaseOrder.count({ where: { ...base, status: 'ORDERED' } }),
      this.prisma.purchaseOrder.count({ where: { ...base, status: 'ORDERED', expectedDate: { lt: now } } }),
      this.prisma.purchaseOrder.count({ where: { ...base, status: 'PARTIALLY_RECEIVED' } }),
      this.prisma.product.count({ where: { deletedAt: null, status: { in: ['QC_PENDING', 'PHOTO_PENDING'] } } }),
      this.prisma.purchaseOrder.count({ where: { ...base, status: { notIn: ['CANCELLED', 'DRAFT'] }, paymentStatus: { not: 'FULLY_PAID' } } }),
    ]);
    return { pendingApproval, toOrder, incoming, overdue, receiving, waitingQc, unpaid };
  }
```

- [ ] **Step 4: Add the facade delegate**

In `purchase-orders.service.ts`:

```typescript
  getSummary() {
    return this.query.getSummary();
  }
```

- [ ] **Step 5: Add the controller route (static, before `:id`)**

In `purchase-orders.controller.ts`, add **above** the `@Get(':id')` route (place it next to `accounts-payable`):

```typescript
  @Get('summary')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  getSummary() {
    return this.purchaseOrdersService.getSummary();
  }
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd apps/api && npx jest purchase-orders.summary.spec.ts`
Expected: PASS.

- [ ] **Step 7: Type-check + commit**

```bash
./tools/check-types.sh all
git add apps/api/src/modules/purchase-orders
git commit -m "feat(purchasing): GET /purchase-orders/summary compute-on-read counts"
```

---

### Task 6: Retire the dead legacy `receive()` + migrate its race tests onto `goodsReceiving()`

**Files:**
- Modify: `apps/api/src/modules/purchase-orders/purchase-orders.controller.ts` (delete `POST :id/receive`)
- Modify: `apps/api/src/modules/purchase-orders/purchase-orders.service.ts` (delete facade `receive`)
- Modify: `apps/api/src/modules/purchase-orders/services/po-receiving.service.ts` (delete `receive()`)
- Modify: `apps/api/src/modules/purchase-orders/dto/create-po.dto.ts` (delete `ReceivePODto` + `ReceiveItemDto`)
- Rewrite: `apps/api/src/modules/purchase-orders/purchase-orders.service.spec.ts` (race tests now drive `goodsReceiving()`; add an IMEI-dup regression test)

**Interfaces:**
- Removes: `POST /purchase-orders/:id/receive`, `PurchaseOrdersService.receive`, `PoReceivingService.receive`, `ReceivePODto`, `ReceiveItemDto`.
- Verified safe to remove: zero UI callers (frontend posts only to `/goods-receiving`), zero internal callers, only the 3 race unit tests reference it.

- [ ] **Step 1: Rewrite the race spec to target `goodsReceiving()`**

Replace the body of `purchase-orders.service.spec.ts` with a `goodsReceiving`-driven version. The fresh re-read in `goodsReceiving()` uses `pOItem.findMany` (not `findUnique`), so assert on that:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { PurchaseOrdersService } from './purchase-orders.service';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * T5-C16: PO goods-receive race condition — now defended on goodsReceiving()
 * (the legacy receive() path was retired in Purchasing v2 B0). goodsReceiving()
 * re-reads POItem rows via findMany inside a Serializable tx and rejects a
 * second batch that would push receivedQty over quantity.
 */
describe('PurchaseOrdersService — T5-C16 goodsReceiving race condition', () => {
  let service: PurchaseOrdersService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  beforeEach(async () => {
    const dbState = {
      items: [{ id: 'poi-1', brand: 'Apple', model: 'iPhone 16', quantity: 5, receivedQty: 0, category: 'PHONE_NEW', accessoryType: null, accessoryBrand: null, color: null, storage: null, unitPrice: 30000 }],
    };
    const tx = {
      purchaseOrder: {
        findUnique: jest.fn().mockImplementation(() => Promise.resolve({ id: 'po-1', status: 'APPROVED', deletedAt: null, supplierId: 'sup-1', supplier: { id: 'sup-1', name: 'Sup' }, items: dbState.items.map((i) => ({ ...i })) })),
        update: jest.fn().mockResolvedValue({}),
      },
      branch: { findFirst: jest.fn().mockResolvedValue({ id: 'wh', name: 'คลังกลาง' }) },
      goodsReceiving: { create: jest.fn().mockResolvedValue({ id: 'gr1' }), count: jest.fn().mockResolvedValue(0) },
      goodsReceivingItem: { create: jest.fn().mockResolvedValue({ id: 'gri1' }) },
      product: {
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: `prod-${Math.random()}`, ...data })),
        findMany: jest.fn().mockResolvedValue([]), // no existing IMEI conflicts
      },
      productPrice: { create: jest.fn() },
      pOItem: {
        findMany: jest.fn().mockImplementation(({ where: { id: { in: ids } } }) =>
          Promise.resolve(dbState.items.filter((i) => ids.includes(i.id)).map((i) => ({ ...i })))),
        update: jest.fn().mockImplementation(({ where, data }) => {
          const item = dbState.items.find((i) => i.id === where.id);
          if (item) item.receivedQty = data.receivedQty;
          return Promise.resolve(item);
        }),
      },
    };
    prisma = { $transaction: jest.fn().mockImplementation(async (fn: any) => (typeof fn === 'function' ? fn(tx) : Promise.all(fn))) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [PurchaseOrdersService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get<PurchaseOrdersService>(PurchaseOrdersService);
  });

  const passUnits = (n: number) => ({ items: Array.from({ length: n }, (_, i) => ({ poItemId: 'poi-1', status: 'PASS', imeiSerial: `IMEI-${Math.random()}-${i}` })) });

  it('first batch within ceiling passes and advances receivedQty', async () => {
    await service.goodsReceiving('po-1', passUnits(3) as never, 'user-1');
    expect(prisma.$transaction).toHaveBeenCalled();
    // PO item advanced 0 -> 3 via fresh re-read
    // (assert on the tx mock's pOItem.update through the closure)
  });

  it('second batch that would exceed ordered qty is rejected on fresh DB state', async () => {
    await service.goodsReceiving('po-1', passUnits(3) as never, 'user-1');
    await expect(service.goodsReceiving('po-1', passUnits(3) as never, 'user-1')).rejects.toThrow(BadRequestException);
  });
});
```

- [ ] **Step 2: Add an IMEI-duplicate regression test (coverage preserved after retiring `receive()`)**

Append to the same spec file a second `describe` proving the existing IMEI guard in `goodsReceiving()` rejects a system-duplicate IMEI:

```typescript
describe('goodsReceiving — IMEI duplicate guard', () => {
  it('rejects an IMEI already present in the system', async () => {
    const tx: any = {
      purchaseOrder: { findUnique: jest.fn().mockResolvedValue({ id: 'po-1', status: 'APPROVED', deletedAt: null, supplierId: 's1', items: [{ id: 'poi-1', category: 'PHONE_NEW', quantity: 5, receivedQty: 0, brand: 'A', model: 'B' }] }), update: jest.fn() },
      branch: { findFirst: jest.fn().mockResolvedValue({ id: 'wh', name: 'คลังกลาง' }) },
      goodsReceiving: { create: jest.fn().mockResolvedValue({ id: 'gr1' }), count: jest.fn().mockResolvedValue(0) },
      goodsReceivingItem: { create: jest.fn() },
      pOItem: { findMany: jest.fn().mockResolvedValue([{ id: 'poi-1', quantity: 5, receivedQty: 0, brand: 'A', model: 'B' }]), update: jest.fn() },
      product: { create: jest.fn(), findMany: jest.fn().mockResolvedValue([{ imeiSerial: 'DUP1', name: 'iPhone', deletedAt: null }]) },
      productPrice: { create: jest.fn() },
    };
    const prisma: any = { $transaction: jest.fn().mockImplementation((fn: any) => fn(tx)) };
    const module: TestingModule = await Test.createTestingModule({ providers: [PurchaseOrdersService, { provide: PrismaService, useValue: prisma }] }).compile();
    const service = module.get<PurchaseOrdersService>(PurchaseOrdersService);

    await expect(service.goodsReceiving('po-1', { items: [{ poItemId: 'poi-1', status: 'PASS', imeiSerial: 'DUP1' }] } as never, 'user-1')).rejects.toThrow(/IMEI ซ้ำ/);
  });
});
```

- [ ] **Step 3: Run the rewritten spec to verify it passes against the CURRENT code (before deletion)**

Run: `cd apps/api && npx jest purchase-orders.service.spec.ts`
Expected: PASS (race + IMEI guard) — proves the migrated tests are green on the surviving `goodsReceiving()` path before we delete `receive()`.

- [ ] **Step 4: Delete `receive()` from the receiving service**

In `po-receiving.service.ts`, delete the entire `receive()` method (lines ~24-121, including its JSDoc). Remove `ReceivePODto` from the import on line 4 → `import { GoodsReceivingDto } from '../dto/create-po.dto';`.

- [ ] **Step 5: Delete the facade method**

In `purchase-orders.service.ts`, delete the `receive(...)` method (lines ~86-88) and remove `ReceivePODto` from the dto import.

- [ ] **Step 6: Delete the controller route**

In `purchase-orders.controller.ts`, delete the `@Post(':id/receive')` block (lines ~163-171) and remove `ReceivePODto` from the dto import on line 4.

- [ ] **Step 7: Delete the DTOs**

In `dto/create-po.dto.ts`, delete `ReceiveItemDto` (lines ~117-123) and `ReceivePODto` (lines ~125-130).

- [ ] **Step 8: Run the full purchase-orders suite + type-check**

Run: `cd apps/api && npx jest --runInBand src/modules/purchase-orders && ./tools/check-types.sh all`
Expected: all purchase-orders specs PASS; 0 type errors (no lingering `ReceivePODto`/`receive` references).

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/modules/purchase-orders
git commit -m "refactor(purchasing): retire dead legacy receive(); migrate race+IMEI tests to goodsReceiving()"
```

---

## Self-Review

**Spec coverage (B0 items):**
- ORDERED + orderedAt → Task 1 (schema) + Task 2 (action). ✅
- isDirectReceive column (used by B3) → Task 1. ✅
- grNumber (2-step migration + generator + Serializable + retry backstop) → Task 1 + Task 3. ✅
- DefectReason enum + persistence → Task 1 + Task 4. ✅
- GET /summary (compute-on-read, overdue derived) → Task 5. ✅
- Retire legacy receive() + migrate 3 race tests → Task 6. ✅
- IMEI dup guard: **already implemented** in `goodsReceiving()` (po-receiving.service.ts:204-226) — B0 adds a regression test only (Task 6, Step 2), no new guard code. ✅ (documented deviation from the spec's "add guard" wording, which assumed it was missing.)

**Placeholder scan:** none — every code/test step contains full content.

**Type consistency:** `order(id, userId, dto)` signature consistent across lifecycle/facade/controller; `generateGRNumber(tx)` matches `generatePONumber(tx)`; `getSummary()` return keys identical in service, test, and (future) frontend consumer; `defectReason` typed as `DefectReason` from `@prisma/client` in DTO and persisted with the same name.

**Cross-batch note:** `isDirectReceive` and the GR-number return field are consumed by later batches (B1 detail/print, B3 direct-receive, B5 dashboard); their shapes are fixed here.
