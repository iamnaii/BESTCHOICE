# Purchasing v2 — Batch 4: QC Center page + nav badge — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Promote the collapsible `QcPendingPanel` into a dedicated **QC center page** at its own lazy route `/purchase-orders/qc`, with a **sidebar nav badge** showing the pending count, branch/PO/date filters, a **bulk-confirm** action (reusing the existing `POST /purchase-orders/qc-confirm`), and a **reject path** (a small additive `POST /purchase-orders/qc-reject` endpoint that soft-deletes products that fail post-receive QC). Wire the route + menu entry with the same role gating as the PO page (OWNER, BRANCH_MANAGER), and remove the now-redundant inline panel from `PurchaseOrdersPage`.

**Architecture:** Frontend-led batch on top of the existing, accounting-isolated `purchase-orders` module. New web page `QcCenterPage` + a `useQcCenter` data hook (react-query + `@/lib/api`), a `qc-pending-count` `MenuBadgeKey` wired into the existing `NavBadge` mechanism in `Sidebar.tsx`, and a new menu item + lazy route. Backend: two small **additive** changes inside the module — extend `getQCPending` to optionally include `PHOTO_PENDING` (additive `status` filter, default unchanged), and a new `rejectQC(productIds, reason)` service method + route that soft-deletes failed products (JE-free, products-table-only, no cross-module import).

**Tech Stack:** React 18 + Vite + TypeScript + Tailwind + shadcn/ui + Radix + lucide (`apps/web`); NestJS + Prisma (`apps/api`); jest (backend, mock-based) + vitest/RTL (frontend logic).

**Spec:** `docs/superpowers/specs/2026-06-29-purchasing-receiving-ux-v2-design.md`

## Global Constraints

- **RED LINE — no accounting/finance:** introduce **NO** import of any accounting / finance / journal / expense / tax module into `purchase-orders`; do **not** touch `trade-in` or `Product.ownedByCompanyId`; receiving + QC stay **JE-free**. The QC-reject added here only soft-deletes `Product` rows (sets `deletedAt`) — it posts no JE and imports nothing new. (Verified: module is `imports: []`, Prisma-only.)
- **Additive only:** no rewrite of existing models or endpoints. `getQCPending`'s default output is unchanged (only widened when a new optional flag is passed). `qc-confirm` is reused verbatim.
- **Frontend rules (`.claude/rules/frontend.md`):**
  - Data fetching via `useQuery`/`useMutation` + `@/lib/api` only — **no** raw `fetch`/`axios`.
  - shadcn/ui + Radix + lucide only — no other component libs.
  - **DESIGN TOKENS ONLY** — no hardcoded gray/hex; no `bg-white` (except print/receipt). Use `bg-card`/`bg-muted`/`text-foreground`/`text-muted-foreground`/`border-border`, status tokens `text-warning`/`text-success`/`text-destructive`.
  - Thai UI text uses `leading-snug`.
  - Route is lazy-loaded (`React.lazy`) under `ProtectedRoute`.
  - Toasts via `sonner` (`toast.success`/`toast.error`); confirmations via `ConfirmDialog` (no `alert()`/`confirm()`).
  - `useDebounce` for the search input.
- **Money = `Decimal`** on the backend (no money math added here — QC moves status only).
- **Soft delete:** every read filters `deletedAt: null`; reject = `update({ data: { deletedAt } })`, never hard-delete.
- **Backend validation messages in Thai** (`class-validator`); controller guards `@Roles('OWNER', 'BRANCH_MANAGER')` (mirrors the existing `qc-pending`/`qc-confirm` routes).
- **Tests:** backend jest (mock-based, runs in the normal suite); frontend vitest/RTL for the badge-count + computed-label logic where it adds value, manual verification (desktop **and** mobile viewport) for the page UI.
- **Type gate:** `./tools/check-types.sh all` must report 0 errors before each commit.

> **Reality note discovered while planning (drives this batch):** B0 has **not** shipped yet — there is no `GET /purchase-orders/summary` and no `waitingQc` field in the codebase (grep: only `:id/goods-receivings/summary` exists). So the nav badge here **must** use the `getQCPending` total, not `summary.waitingQc`. This is the spec's stated fallback ("can reuse … or `getQCPending` total"). B5 can later switch the badge to `summary.waitingQc` once B0 lands — the badge is isolated in one hook (`useQcPendingCount`).

---

### Task 1: Backend — widen `getQCPending` to optionally include `PHOTO_PENDING`

The spec's QC center queue is "`QC_PENDING`/`PHOTO_PENDING`". Today `getQCPending` hard-codes `status: 'QC_PENDING'` ([po-query.service.ts:300](../../../apps/api/src/modules/purchase-orders/services/po-query.service.ts)). Add an **additive** optional filter so the QC center can request both, while every existing caller (which passes no flag) keeps the exact current behavior.

**Files:**
- Modify: `apps/api/src/modules/purchase-orders/services/po-query.service.ts` (`getQCPending` signature + `where`, lines 299-322)
- Modify: `apps/api/src/modules/purchase-orders/purchase-orders.service.ts` (facade `getQCPending` signature, line 98-100)
- Modify: `apps/api/src/modules/purchase-orders/purchase-orders.controller.ts` (`getQCPending` route — accept `includePhotoPending` + `poId`, lines 51-63)
- Create: `apps/api/src/modules/purchase-orders/purchase-orders.qc-pending.spec.ts`

**Interfaces:**
- Consumes: `PrismaService.product.findMany/count`.
- Produces: `PoQueryService.getQCPending(filters: { branchId?: string; poId?: string; includePhotoPending?: boolean; page?: number; limit?: number })` → same `{ data, total, page, limit, totalPages }` shape; `where.status` is `'QC_PENDING'` by default, or `{ in: ['QC_PENDING', 'PHOTO_PENDING'] }` when `includePhotoPending` is true; `where.poId` added when `poId` is given.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/modules/purchase-orders/purchase-orders.qc-pending.spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { PurchaseOrdersService } from './purchase-orders.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('PurchaseOrdersService.getQCPending — additive filters', () => {
  let service: PurchaseOrdersService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  const build = async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PurchaseOrdersService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    return module.get<PurchaseOrdersService>(PurchaseOrdersService);
  };

  beforeEach(() => {
    prisma = {
      product: {
        findMany: jest.fn().mockResolvedValue([{ id: 'p1' }]),
        count: jest.fn().mockResolvedValue(1),
      },
    };
  });

  it('defaults to QC_PENDING only (back-compat — no flag passed)', async () => {
    service = await build();
    await service.getQCPending({});
    expect(prisma.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'QC_PENDING', deletedAt: null }),
      }),
    );
  });

  it('includes PHOTO_PENDING when includePhotoPending is true', async () => {
    service = await build();
    await service.getQCPending({ includePhotoPending: true });
    expect(prisma.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: { in: ['QC_PENDING', 'PHOTO_PENDING'] } }),
      }),
    );
  });

  it('filters by poId and branchId when provided', async () => {
    service = await build();
    await service.getQCPending({ poId: 'po-9', branchId: 'b-1' });
    expect(prisma.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ poId: 'po-9', branchId: 'b-1', status: 'QC_PENDING' }),
      }),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx jest purchase-orders.qc-pending.spec.ts`
Expected: FAIL — `includePhotoPending`/`poId` are ignored (the `status: { in: [...] }` and `poId` assertions fail).

- [ ] **Step 3: Widen `getQCPending` in `PoQueryService`**

In `po-query.service.ts`, replace the method (lines 296-322) with:

```typescript
  /**
   * Get products pending QC. Defaults to QC_PENDING only (back-compat).
   * Additive flags: includePhotoPending widens to QC_PENDING + PHOTO_PENDING
   * (the QC center queue), poId narrows to one PO.
   */
  async getQCPending(filters: {
    branchId?: string;
    poId?: string;
    includePhotoPending?: boolean;
    page?: number;
    limit?: number;
  }) {
    const where: Record<string, unknown> = {
      deletedAt: null,
      status: filters.includePhotoPending
        ? { in: ['QC_PENDING', 'PHOTO_PENDING'] }
        : 'QC_PENDING',
    };
    if (filters.branchId) where.branchId = filters.branchId;
    if (filters.poId) where.poId = filters.poId;

    const page = Math.max(1, filters.page || 1);
    const limit = Math.min(100, Math.max(1, filters.limit || 50));

    const [data, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        include: {
          branch: { select: { id: true, name: true } },
          supplier: { select: { id: true, name: true } },
          po: { select: { id: true, poNumber: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.product.count({ where }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }
```

- [ ] **Step 4: Widen the facade signature**

In `purchase-orders.service.ts`, replace the facade method (lines 98-100):

```typescript
  getQCPending(filters: { branchId?: string; poId?: string; includePhotoPending?: boolean; page?: number; limit?: number }) {
    return this.query.getQCPending(filters);
  }
```

- [ ] **Step 5: Pass the new query params through the controller**

In `purchase-orders.controller.ts`, replace the `getQCPending` route (lines 51-63) with:

```typescript
  @Get('qc-pending')
  @Roles('OWNER', 'BRANCH_MANAGER')
  getQCPending(
    @Query('branchId') branchId?: string,
    @Query('poId') poId?: string,
    @Query('includePhotoPending') includePhotoPending?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.purchaseOrdersService.getQCPending({
      branchId,
      poId,
      includePhotoPending: includePhotoPending === 'true',
      page: page ? parseInt(page) : undefined,
      limit: limit ? parseInt(limit) : undefined,
    });
  }
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd apps/api && npx jest purchase-orders.qc-pending.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 7: Type-check + commit**

```bash
./tools/check-types.sh all
git add apps/api/src/modules/purchase-orders
git commit -m "feat(purchasing): widen getQCPending with includePhotoPending + poId filters (additive)"
```

---

### Task 2: Backend — QC reject endpoint (`POST /purchase-orders/qc-reject`)

`confirmQC` only **promotes** (QC_PENDING → IN_STOCK/PHOTO_PENDING) — there is no way to fail a unit at the post-receive QC stage. Add a minimal **additive** reject path: soft-delete the failed products + record the reason on each. JE-free, products-table-only, no new imports (mirrors the module's soft-delete convention — `Product` has `deletedAt` at [schema.prisma:1655](../../../apps/api/prisma/schema.prisma)).

**Files:**
- Modify: `apps/api/src/modules/purchase-orders/dto/create-po.dto.ts` (add `RejectQCDto`)
- Modify: `apps/api/src/modules/purchase-orders/services/po-receiving.service.ts` (add `rejectQC()`)
- Modify: `apps/api/src/modules/purchase-orders/purchase-orders.service.ts` (facade delegate)
- Modify: `apps/api/src/modules/purchase-orders/purchase-orders.controller.ts` (new route, next to `qc-confirm`)
- Create: `apps/api/src/modules/purchase-orders/purchase-orders.qc-reject.spec.ts`

**Interfaces:**
- Produces: `PurchaseOrdersService.rejectQC(productIds: string[], reason: string): Promise<{ rejected: number; message: string }>` — validates the products exist and are `QC_PENDING`/`PHOTO_PENDING`, then soft-deletes them (sets `deletedAt = now` + `qcRejectReason` stored in the existing `Product.notes` field — see Step 4 for the exact column choice).
- `RejectQCDto { productIds: string[]; reason: string }`.

- [ ] **Step 1: Confirm there is no free-text note column on `Product` (no schema change in B4)**

Run: `cd apps/api && awk '/^model Product /{f=1} f&&/^}/{f=0} f' prisma/schema.prisma | grep -nE 'notes|qcNote|rejectReason|remark'`
**Verified at plan time:** `Product` has **no** free-text note field (only `onlineDescription` = catalog copy, which we do **not** reuse). So the reject is a **pure soft-delete** — the reason is surfaced in the return `message` only, and **no** column is written. Do **not** add a new column (that would be a B0-style migration, out of scope for B4). If a future `Product.qcNote` lands, the `updateMany.data` can gain it additively.

- [ ] **Step 2: Write the failing test**

Create `apps/api/src/modules/purchase-orders/purchase-orders.qc-reject.spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { PurchaseOrdersService } from './purchase-orders.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('PurchaseOrdersService.rejectQC', () => {
  let service: PurchaseOrdersService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  const buildTx = (products: { id: string; status: string; name: string }[]) => {
    const tx = {
      product: {
        findMany: jest.fn().mockResolvedValue(products),
        updateMany: jest.fn().mockResolvedValue({ count: products.length }),
      },
    };
    return tx;
  };

  const build = async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PurchaseOrdersService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    return module.get<PurchaseOrdersService>(PurchaseOrdersService);
  };

  it('soft-deletes QC_PENDING products and returns the count', async () => {
    const tx = buildTx([
      { id: 'p1', status: 'QC_PENDING', name: 'iPhone' },
      { id: 'p2', status: 'PHOTO_PENDING', name: 'iPhone 2' },
    ]);
    prisma = { $transaction: jest.fn().mockImplementation((fn: any) => fn(tx)) };
    service = await build();

    const res = await service.rejectQC(['p1', 'p2'], 'จอแตก');
    expect(res.rejected).toBe(2);
    expect(tx.product.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ['p1', 'p2'] } },
        data: expect.objectContaining({ deletedAt: expect.any(Date) }),
      }),
    );
  });

  it('rejects when no productIds are given', async () => {
    prisma = { $transaction: jest.fn() };
    service = await build();
    await expect(service.rejectQC([], 'x')).rejects.toThrow(BadRequestException);
  });

  it('rejects when a product is not in a QC stage', async () => {
    const tx = buildTx([{ id: 'p1', status: 'IN_STOCK', name: 'Sold-in' }]);
    prisma = { $transaction: jest.fn().mockImplementation((fn: any) => fn(tx)) };
    service = await build();
    await expect(service.rejectQC(['p1'], 'late')).rejects.toThrow(BadRequestException);
  });
});
```

- [ ] **Step 3: Add `RejectQCDto`**

In `dto/create-po.dto.ts`, add (place near the other small DTOs; reuse the existing `class-validator` imports — add any missing ones to the import list at the top of the file):

```typescript
export class RejectQCDto {
  @IsArray()
  @ArrayNotEmpty({ message: 'กรุณาเลือกสินค้าที่ไม่ผ่าน QC อย่างน้อย 1 ชิ้น' })
  @IsString({ each: true })
  productIds!: string[];

  @IsString()
  @IsNotEmpty({ message: 'กรุณาระบุเหตุผลที่ไม่ผ่าน QC' })
  reason!: string;
}
```

Ensure the top-of-file `class-validator` import includes `IsArray`, `ArrayNotEmpty`, `IsString`, `IsNotEmpty` (add only the ones not already imported).

- [ ] **Step 4: Add `rejectQC()` to `PoReceivingService`**

In `po-receiving.service.ts`, add this method (after `confirmQC`, ~line 408). It mirrors `confirmQC`'s validate-then-mutate-in-`$transaction` shape and writes no JE:

```typescript
  /**
   * Reject products at the post-receive QC stage (QC_PENDING / PHOTO_PENDING):
   * soft-delete the failed units and record the reason. JE-free, products-table
   * only — no accounting/finance touch.
   */
  async rejectQC(productIds: string[], reason: string) {
    if (!productIds || productIds.length === 0) {
      throw new BadRequestException('กรุณาเลือกสินค้าที่ไม่ผ่าน QC อย่างน้อย 1 ชิ้น');
    }

    return this.prisma.$transaction(async (tx) => {
      const products = await tx.product.findMany({
        where: { id: { in: productIds }, deletedAt: null },
      });

      const notFound = productIds.filter((id) => !products.find((p) => p.id === id));
      if (notFound.length > 0) {
        throw new BadRequestException(`ไม่พบสินค้า ID: ${notFound.join(', ')}`);
      }

      const invalid = products.filter((p) => !['QC_PENDING', 'PHOTO_PENDING'].includes(p.status));
      if (invalid.length > 0) {
        throw new BadRequestException(
          `สินค้าต่อไปนี้ไม่ได้อยู่ในขั้นตอน QC: ${invalid.map((p) => p.name).join(', ')}`,
        );
      }

      await tx.product.updateMany({
        where: { id: { in: productIds } },
        data: { deletedAt: new Date() },
      });

      return {
        rejected: productIds.length,
        reason,
        message: `บันทึกไม่ผ่าน QC ${productIds.length} ชิ้น (ตัดออกจากคลังแล้ว): ${reason}`,
      };
    });
  }
```

> `Product` has no note column (Step 1), so the soft-delete is the only row mutation; the `reason` is echoed in the response `message` (and is still server-validated as required by `RejectQCDto`). The Task 2 test (`updateMany` called with `data: { deletedAt }`) matches this exactly.

- [ ] **Step 5: Add the facade delegate**

In `purchase-orders.service.ts`, add (after `confirmQC`, line 96):

```typescript
  rejectQC(productIds: string[], reason: string) {
    return this.receiving.rejectQC(productIds, reason);
  }
```

- [ ] **Step 6: Add the controller route**

In `purchase-orders.controller.ts`, add `RejectQCDto` to the dto import on line 4, and add the route immediately after `confirmQC` (line 69) — it is a static route, so it stays above the `:id` parametric block:

```typescript
  @Post('qc-reject')
  @Roles('OWNER', 'BRANCH_MANAGER')
  rejectQC(@Body() dto: RejectQCDto) {
    return this.purchaseOrdersService.rejectQC(dto.productIds, dto.reason);
  }
```

- [ ] **Step 7: Run test to verify it passes**

Run: `cd apps/api && npx jest purchase-orders.qc-reject.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 8: Type-check + commit**

```bash
./tools/check-types.sh all
git add apps/api/src/modules/purchase-orders
git commit -m "feat(purchasing): POST /qc-reject — soft-delete failed QC units (JE-free, additive)"
```

---

### Task 3: Frontend — `useQcCenter` data hook + `useQcPendingCount` badge hook

Centralize the QC center's queries/mutations in one hook (react-query + `@/lib/api`), and expose a tiny separate hook for the nav badge count so the badge can be wired without importing the whole page.

**Files:**
- Create: `apps/web/src/pages/QcCenterPage/useQcCenter.ts`
- Create: `apps/web/src/hooks/useQcPendingCount.ts`
- Create: `apps/web/src/hooks/useQcPendingCount.test.ts`

**Interfaces:**
- `QcPendingProduct` type (the row shape the queue renders):
  ```typescript
  export interface QcPendingProduct {
    id: string;
    name: string;
    imeiSerial: string | null;
    serialNumber: string | null;
    status: 'QC_PENDING' | 'PHOTO_PENDING';
    category: string | null;
    photos: string[];
    createdAt: string;
    branch: { id: string; name: string } | null;
    supplier: { id: string; name: string } | null;
    po: { id: string; poNumber: string } | null;
  }
  ```
- `useQcPendingCount(enabled: boolean): number | undefined` — total of QC_PENDING + PHOTO_PENDING (limit=1, reads `total`), mirroring `useDraftAssetCount` ([useDraftAssetCount.ts](../../../apps/web/src/hooks/useDraftAssetCount.ts)).
- `useQcCenter(filters): { products, total, isLoading, isError, error, refetch, confirmMutation, rejectMutation }`.

- [ ] **Step 1: Write the badge-count hook + its test (logic worth a vitest test)**

Create `apps/web/src/hooks/useQcPendingCount.ts` (mirrors `useDraftAssetCount` exactly — same polling cadence + `total` extraction):

```typescript
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';

/**
 * Pending-QC count for the sidebar nav badge.
 * Reuses GET /purchase-orders/qc-pending (includePhotoPending=true) and reads
 * the `total` field with limit=1 — no full page fetched. Mirrors
 * useDraftAssetCount's polling shape (B5 may later switch to summary.waitingQc).
 */
export function useQcPendingCount(enabled: boolean): number | undefined {
  const query = useQuery({
    queryKey: ['qc-pending-count'],
    queryFn: async () => {
      const res = await api.get('/purchase-orders/qc-pending', {
        params: { includePhotoPending: true, limit: 1, page: 1 },
      });
      return res.data as { total: number };
    },
    enabled,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    staleTime: 10_000,
  });
  return query.data?.total;
}
```

Create `apps/web/src/hooks/useQcPendingCount.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const get = vi.fn();
vi.mock('@/lib/api', () => ({ default: { get: (...a: unknown[]) => get(...a) } }));

import { useQcPendingCount } from './useQcPendingCount';

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return React.createElement(QueryClientProvider, { client }, children);
}

describe('useQcPendingCount', () => {
  beforeEach(() => get.mockReset());

  it('returns the total from qc-pending and requests includePhotoPending', async () => {
    get.mockResolvedValue({ data: { total: 7 } });
    const { result } = renderHook(() => useQcPendingCount(true), { wrapper });
    await waitFor(() => expect(result.current).toBe(7));
    expect(get).toHaveBeenCalledWith(
      '/purchase-orders/qc-pending',
      expect.objectContaining({ params: expect.objectContaining({ includePhotoPending: true, limit: 1 }) }),
    );
  });

  it('does not fetch when disabled', async () => {
    const { result } = renderHook(() => useQcPendingCount(false), { wrapper });
    await waitFor(() => expect(result.current).toBeUndefined());
    expect(get).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the badge-count test to verify it passes**

Run: `cd apps/web && npx vitest run src/hooks/useQcPendingCount.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 3: Create the page data hook**

Create `apps/web/src/pages/QcCenterPage/useQcCenter.ts`:

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';

export interface QcPendingProduct {
  id: string;
  name: string;
  imeiSerial: string | null;
  serialNumber: string | null;
  status: 'QC_PENDING' | 'PHOTO_PENDING';
  category: string | null;
  photos: string[];
  createdAt: string;
  branch: { id: string; name: string } | null;
  supplier: { id: string; name: string } | null;
  po: { id: string; poNumber: string } | null;
}

interface QcResponse {
  data: QcPendingProduct[];
  total: number;
}

export interface QcCenterFilters {
  branchId?: string;
  poId?: string;
}

export function useQcCenter(filters: QcCenterFilters) {
  const queryClient = useQueryClient();

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['qc-center'] });
    queryClient.invalidateQueries({ queryKey: ['qc-pending-count'] });
    queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
  };

  const query = useQuery<QcResponse>({
    queryKey: ['qc-center', filters.branchId ?? '', filters.poId ?? ''],
    queryFn: async () => {
      const res = await api.get('/purchase-orders/qc-pending', {
        params: {
          includePhotoPending: true,
          branchId: filters.branchId || undefined,
          poId: filters.poId || undefined,
          limit: 100,
          page: 1,
        },
      });
      const raw = res.data as { data?: QcPendingProduct[]; total?: number };
      return { data: Array.isArray(raw?.data) ? raw.data : [], total: Number(raw?.total) || 0 };
    },
  });

  const confirmMutation = useMutation({
    mutationFn: async (productIds: string[]) =>
      api.post('/purchase-orders/qc-confirm', { productIds }),
    onSuccess: (res) => {
      invalidate();
      toast.success(res.data?.message ?? 'ยืนยัน QC สำเร็จ');
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const rejectMutation = useMutation({
    mutationFn: async ({ productIds, reason }: { productIds: string[]; reason: string }) =>
      api.post('/purchase-orders/qc-reject', { productIds, reason }),
    onSuccess: (res) => {
      invalidate();
      toast.success(res.data?.message ?? 'บันทึกไม่ผ่าน QC สำเร็จ');
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  return {
    products: query.data?.data ?? [],
    total: query.data?.total ?? 0,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
    confirmMutation,
    rejectMutation,
  };
}
```

> The mutation posts `{ productIds }` — the **correct** body the controller expects (`@Body('productIds')` for confirm; `RejectQCDto.productIds` for reject). The legacy `QcPendingPanel` posted `{ items: [...] }`, which the controller silently ignored (a pre-existing bug — see Self-Review deviation #1). Retiring that panel in Task 6 removes the broken caller.

- [ ] **Step 4: Type-check**

Run: `./tools/check-types.sh all`
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/hooks/useQcPendingCount.ts apps/web/src/hooks/useQcPendingCount.test.ts apps/web/src/pages/QcCenterPage/useQcCenter.ts
git commit -m "feat(web): useQcCenter + useQcPendingCount hooks (qc-pending/confirm/reject)"
```

---

### Task 4: Frontend — `QcCenterPage` (queue + filters + bulk confirm + reject)

Build the dedicated page: a status-aware KPI/header count, branch/PO/date filters (`useDebounce` for the PO search), a multi-select queue (shadcn `Checkbox`), a sticky bulk-action bar (ยืนยันทั้งหมด / ไม่ผ่าน), and a reject reason dialog. Responsive: a table-like list on desktop, stacked cards on mobile (`useIsMobile`). All design tokens, no `bg-white`/gray.

**Files:**
- Create: `apps/web/src/pages/QcCenterPage/index.tsx`
- Create: `apps/web/src/pages/QcCenterPage/qcLabels.ts` (status labels + computed selection helpers, vitest-tested)
- Create: `apps/web/src/pages/QcCenterPage/qcLabels.test.ts`

**Interfaces:**
- Consumes: `useQcCenter` (Task 3), `useAuth` ([contexts/AuthContext.tsx](../../../apps/web/src/contexts/AuthContext.tsx) — `{ user }`, `user?.role` for branch-picker gating), `useIsMobile` ([hooks/useIsMobile.ts](../../../apps/web/src/hooks/useIsMobile.ts)), `useDebounce` ([hooks/useDebounce.ts](../../../apps/web/src/hooks/useDebounce.ts)), `QueryBoundary` ([components/QueryBoundary.tsx](../../../apps/web/src/components/QueryBoundary.tsx)), `PageHeader` ([components/ui/PageHeader.tsx](../../../apps/web/src/components/ui/PageHeader.tsx)), `Checkbox` ([components/ui/checkbox.tsx](../../../apps/web/src/components/ui/checkbox.tsx)), `ConfirmDialog` ([components/ui/ConfirmDialog.tsx](../../../apps/web/src/components/ui/ConfirmDialog.tsx)) — **note: requires the additive `children` + `closeOnConfirm` edits in Step 3** — `Textarea` ([components/ui/textarea.tsx](../../../apps/web/src/components/ui/textarea.tsx), lowercase path, named export), `toast` (`sonner`), `formatDateTime` ([utils/formatters.ts](../../../apps/web/src/utils/formatters.ts)).
- Branches via `useQuery(['branches'])` (`api.get('/branches')`, `enabled: canPickBranch`) — same shape used across the app ([StockAlertsPage.tsx](../../../apps/web/src/pages/StockAlertsPage.tsx)). The branch `<select>` renders **only for OWNER** (cross-branch role); BRANCH_MANAGER omits `branchId` to avoid a `BranchGuard` 403 (see deviation #6).

- [ ] **Step 1: Write the pure label/selection helpers + test (logic worth a vitest test)**

Create `apps/web/src/pages/QcCenterPage/qcLabels.ts`:

```typescript
import type { QcPendingProduct } from './useQcCenter';

export const qcStatusLabels: Record<string, string> = {
  QC_PENDING: 'รอตรวจ QC',
  PHOTO_PENDING: 'รอถ่ายรูป',
};

export const qcStatusClasses: Record<string, string> = {
  QC_PENDING: 'bg-warning/10 text-warning dark:bg-warning/15',
  PHOTO_PENDING: 'bg-info/10 text-info dark:bg-info/15',
};

/** Client-side PO-number search (server already filters by branch/poId). */
export function filterByPoNumber(products: QcPendingProduct[], term: string): QcPendingProduct[] {
  const t = term.trim().toLowerCase();
  if (!t) return products;
  return products.filter(
    (p) =>
      (p.po?.poNumber ?? '').toLowerCase().includes(t) ||
      (p.name ?? '').toLowerCase().includes(t) ||
      (p.imeiSerial ?? '').toLowerCase().includes(t),
  );
}

/** Header checkbox state from the selected-id set vs the visible rows. */
export function headerCheckState(
  visibleIds: string[],
  selected: Set<string>,
): 'all' | 'some' | 'none' {
  if (visibleIds.length === 0) return 'none';
  const n = visibleIds.filter((id) => selected.has(id)).length;
  if (n === 0) return 'none';
  return n === visibleIds.length ? 'all' : 'some';
}
```

Create `apps/web/src/pages/QcCenterPage/qcLabels.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { filterByPoNumber, headerCheckState } from './qcLabels';
import type { QcPendingProduct } from './useQcCenter';

const mk = (over: Partial<QcPendingProduct>): QcPendingProduct => ({
  id: 'x', name: 'iPhone 16', imeiSerial: null, serialNumber: null, status: 'QC_PENDING',
  category: 'PHONE_NEW', photos: [], createdAt: '', branch: null, supplier: null, po: null, ...over,
});

describe('filterByPoNumber', () => {
  const rows = [
    mk({ id: 'a', po: { id: '1', poNumber: 'PO-2026-06-001' } }),
    mk({ id: 'b', po: { id: '2', poNumber: 'PO-2026-06-002' }, name: 'Galaxy S24' }),
    mk({ id: 'c', imeiSerial: '359' }),
  ];
  it('returns all when term is blank', () => {
    expect(filterByPoNumber(rows, '  ')).toHaveLength(3);
  });
  it('matches PO number', () => {
    expect(filterByPoNumber(rows, '06-002').map((r) => r.id)).toEqual(['b']);
  });
  it('matches product name and IMEI', () => {
    expect(filterByPoNumber(rows, 'galaxy').map((r) => r.id)).toEqual(['b']);
    expect(filterByPoNumber(rows, '359').map((r) => r.id)).toEqual(['c']);
  });
});

describe('headerCheckState', () => {
  it('none / some / all', () => {
    expect(headerCheckState([], new Set())).toBe('none');
    expect(headerCheckState(['a', 'b'], new Set())).toBe('none');
    expect(headerCheckState(['a', 'b'], new Set(['a']))).toBe('some');
    expect(headerCheckState(['a', 'b'], new Set(['a', 'b']))).toBe('all');
  });
});
```

- [ ] **Step 2: Run the helper test to verify it passes**

Run: `cd apps/web && npx vitest run src/pages/QcCenterPage/qcLabels.test.ts`
Expected: PASS.

- [ ] **Step 3: Build the page**

Create `apps/web/src/pages/QcCenterPage/index.tsx`:

```tsx
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ClipboardCheck, Check, X, Search, Image as ImageIcon } from 'lucide-react';
import api from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import QueryBoundary from '@/components/QueryBoundary';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useAuth } from '@/contexts/AuthContext';
import { useDebounce } from '@/hooks/useDebounce';
import { useIsMobile } from '@/hooks/useIsMobile';
import { formatDateTime } from '@/utils/formatters';
import { useQcCenter } from './useQcCenter';
import { qcStatusLabels, qcStatusClasses, filterByPoNumber, headerCheckState } from './qcLabels';

interface Branch { id: string; name: string }

export default function QcCenterPage() {
  const { user } = useAuth();
  // BranchGuard 403s a branch-scoped role (BRANCH_MANAGER) that passes another
  // branch's id. Only cross-branch roles (here: OWNER) may pick a branch; BM
  // sends no branchId and sees the queue exactly as the legacy panel did
  // (per-branch BM scoping is a backend follow-up, out of B4 scope).
  const canPickBranch = user?.role === 'OWNER';
  const [branchId, setBranchId] = useState('');
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 300);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const isMobile = useIsMobile();

  const { data: branches } = useQuery<Branch[]>({
    queryKey: ['branches'],
    queryFn: async () => (await api.get('/branches')).data,
    enabled: canPickBranch,
  });

  const { products, total, isLoading, isError, error, refetch, confirmMutation, rejectMutation } =
    useQcCenter({ branchId: branchId || undefined });

  const visible = useMemo(
    () => filterByPoNumber(products, debouncedSearch),
    [products, debouncedSearch],
  );
  const visibleIds = useMemo(() => visible.map((p) => p.id), [visible]);
  const checkState = headerCheckState(visibleIds, selected);
  const selectedVisible = visibleIds.filter((id) => selected.has(id));

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  const toggleAll = () =>
    setSelected((prev) => {
      if (checkState === 'all') {
        const next = new Set(prev);
        visibleIds.forEach((id) => next.delete(id));
        return next;
      }
      return new Set([...prev, ...visibleIds]);
    });
  const clearSelection = () => setSelected(new Set());

  const onConfirm = () => {
    if (selectedVisible.length === 0) return;
    confirmMutation.mutate(selectedVisible, { onSuccess: clearSelection });
  };
  const onRejectConfirm = () => {
    if (selectedVisible.length === 0) return;
    if (!rejectReason.trim()) {
      toast.error('กรุณาระบุเหตุผลที่ไม่ผ่าน QC');
      return;
    }
    rejectMutation.mutate(
      { productIds: selectedVisible, reason: rejectReason },
      {
        onSuccess: () => {
          clearSelection();
          setRejectReason('');
          setRejectOpen(false);
        },
      },
    );
  };

  return (
    <div className="pb-24">
      <PageHeader
        title="ศูนย์ตรวจ QC"
        subtitle="ยืนยันหรือปฏิเสธสินค้าที่รอตรวจคุณภาพก่อนเข้าคลัง"
        icon={<ClipboardCheck className="size-5" />}
        badge={
          total > 0 ? (
            <span className="inline-flex items-center justify-center min-w-[24px] h-6 px-2 rounded-full text-xs font-bold bg-warning/10 text-warning dark:bg-warning/15 leading-snug">
              {total}
            </span>
          ) : undefined
        }
      />

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-2 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ค้นหาเลข PO / ชื่อสินค้า / IMEI"
            className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-input bg-background leading-snug focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        {canPickBranch && (
          <select
            value={branchId}
            onChange={(e) => setBranchId(e.target.value)}
            className="px-3 py-2 text-sm rounded-lg border border-input bg-background leading-snug"
          >
            <option value="">ทุกสาขา</option>
            {(branches ?? []).map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        )}
      </div>

      <QueryBoundary
        isLoading={isLoading}
        isError={isError}
        error={error}
        onRetry={refetch}
        errorTitle="ไม่สามารถโหลดรายการรอตรวจ QC ได้"
      >
        {visible.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <ClipboardCheck className="size-10 text-muted-foreground/40 mb-3" />
            <p className="text-sm font-medium text-foreground leading-snug">ไม่มีสินค้ารอตรวจ QC</p>
            <p className="text-xs text-muted-foreground mt-1 leading-snug">
              {debouncedSearch || branchId ? 'ลองล้างตัวกรอง' : 'รายการที่รับเข้าจะปรากฏที่นี่'}
            </p>
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            {/* Header row (select-all) */}
            <div className="flex items-center gap-3 px-4 py-2.5 border-b border-border bg-muted/40">
              <Checkbox
                checked={checkState === 'all' ? true : checkState === 'some' ? 'indeterminate' : false}
                onCheckedChange={toggleAll}
                aria-label="เลือกทั้งหมด"
              />
              <span className="text-xs font-semibold text-muted-foreground leading-snug">
                {selectedVisible.length > 0 ? `เลือก ${selectedVisible.length} ชิ้น` : `${visible.length} รายการ`}
              </span>
            </div>

            <ul className="divide-y divide-border">
              {visible.map((p) => {
                const checked = selected.has(p.id);
                return (
                  <li
                    key={p.id}
                    className={`flex ${isMobile ? 'flex-col' : 'items-center'} gap-3 px-4 py-3 ${checked ? 'bg-primary/5' : ''}`}
                  >
                    <div className="flex items-start gap-3 flex-1 min-w-0">
                      <Checkbox
                        checked={checked}
                        onCheckedChange={() => toggle(p.id)}
                        aria-label={`เลือก ${p.name}`}
                        className="mt-0.5"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-medium text-foreground truncate leading-snug">{p.name}</p>
                          <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold leading-snug ${qcStatusClasses[p.status] ?? 'bg-muted text-foreground'}`}>
                            {qcStatusLabels[p.status] ?? p.status}
                          </span>
                          {p.photos.length > 0 && (
                            <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                              <ImageIcon className="size-3" />{p.photos.length}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5 leading-snug">
                          {p.imeiSerial ? `IMEI: ${p.imeiSerial}` : 'ไม่มี IMEI'}
                          {p.po?.poNumber ? ` · ${p.po.poNumber}` : ''}
                          {p.branch?.name ? ` · ${p.branch.name}` : ''}
                        </p>
                        <p className="text-[11px] text-muted-foreground/80 mt-0.5 leading-snug">
                          {p.supplier?.name ? `${p.supplier.name} · ` : ''}{formatDateTime(p.createdAt)}
                        </p>
                      </div>
                    </div>
                    <div className={`flex gap-2 ${isMobile ? 'w-full' : 'shrink-0'}`}>
                      <button
                        onClick={() => confirmMutation.mutate([p.id], { onSuccess: () => toggle(p.id) })}
                        className={`inline-flex items-center justify-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-success text-success-foreground hover:bg-success/90 transition-colors ${isMobile ? 'flex-1' : ''}`}
                      >
                        <Check className="size-3.5" /> ผ่าน
                      </button>
                      <button
                        onClick={() => { setSelected(new Set([p.id])); setRejectOpen(true); }}
                        className={`inline-flex items-center justify-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors ${isMobile ? 'flex-1' : ''}`}
                      >
                        <X className="size-3.5" /> ไม่ผ่าน
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </QueryBoundary>

      {/* Sticky bulk action bar */}
      {selectedVisible.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 lg:left-[var(--sidebar-w,264px)] z-30 border-t border-border bg-card/95 backdrop-blur px-4 py-3 flex items-center justify-between gap-3">
          <span className="text-sm font-medium text-foreground leading-snug">เลือก {selectedVisible.length} ชิ้น</span>
          <div className="flex gap-2">
            <button
              onClick={() => setRejectOpen(true)}
              disabled={rejectMutation.isPending}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium border border-destructive/40 text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50"
            >
              <X className="size-4" /> ไม่ผ่าน
            </button>
            <button
              onClick={onConfirm}
              disabled={confirmMutation.isPending}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-success text-success-foreground hover:bg-success/90 transition-colors disabled:opacity-50"
            >
              <Check className="size-4" /> ยืนยันผ่านทั้งหมด
            </button>
          </div>
        </div>
      )}

      {/* Reject reason dialog */}
      <ConfirmDialog
        open={rejectOpen}
        onOpenChange={(open) => { setRejectOpen(open); if (!open) setRejectReason(''); }}
        title={`ไม่ผ่าน QC (${selectedVisible.length} ชิ้น)`}
        description="ระบุเหตุผลที่ไม่ผ่าน — สินค้าจะถูกตัดออกจากคลัง"
        variant="destructive"
        confirmLabel="บันทึกไม่ผ่าน"
        loading={rejectMutation.isPending}
        closeOnConfirm={false}
        onConfirm={onRejectConfirm}
      >
        <Textarea
          value={rejectReason}
          onChange={(e) => setRejectReason(e.target.value)}
          placeholder="เช่น จอแตก / IMEI ถูกบล็อก / ไม่ตรงรุ่น"
          className="mt-1 leading-snug"
          rows={3}
        />
      </ConfirmDialog>
    </div>
  );
}
```

> **Adapt `ConfirmDialog` for the children + async-reject flow (two verified, additive changes).** The component in [ConfirmDialog.tsx](../../../apps/web/src/components/ui/ConfirmDialog.tsx) (verified at plan time) currently (a) does **not** render `{children}` and (b) hard-codes `onClick={() => { onConfirm(); onOpenChange(false); }}` on the confirm button — i.e. it **closes the dialog synchronously on every confirm**, ignoring `loading`. That second behavior breaks the reject flow: the async `rejectMutation` is still in flight when the dialog vanishes, so the `loading` spinner + disabled-confirm never show, and a server-side validation error (e.g. empty reason) would toast after the dialog is already gone. Run `grep -n "children\|onConfirm()" apps/web/src/components/ui/ConfirmDialog.tsx` first, then make these two **additive, backward-compatible** edits (every existing caller passes no `children` and relies on synchronous confirm — both keep working):
>   1. Add `children?: ReactNode` to `ConfirmDialogProps` (import `ReactNode` from `react`) and render `{children}` between the `DialogHeader` and `DialogFooter` (paste the Textarea there).
>   2. Change the confirm button to **not** auto-close when the caller manages closing itself. The minimal safe change: only auto-close when not `loading` — `onClick={() => { onConfirm(); if (!loading) onOpenChange(false); }}`. Because `loading={rejectMutation.isPending}` is `false` at click time and flips to `true` synchronously inside `onConfirm`'s `mutate`, gate the close on a new optional `closeOnConfirm` prop instead: add `closeOnConfirm = true` to props, render `onClick={() => { onConfirm(); if (closeOnConfirm) onOpenChange(false); }}`, and pass `closeOnConfirm={false}` from the reject dialog (its `onRejectConfirm` already closes via `onSuccess`). Existing callers omit the prop → default `true` → unchanged behavior.
>
> Do not introduce a second dialog component. After editing, the reject dialog: opens → user types reason → "บันทึกไม่ผ่าน" stays visible with a spinner while `isPending` → `onSuccess` closes it; an empty reason is blocked client-side by the `onRejectConfirm` guard above before any request fires.

- [ ] **Step 4: Run the full QcCenterPage vitest folder + type-check**

Run: `cd apps/web && npx vitest run src/pages/QcCenterPage && ../../tools/check-types.sh web`
Expected: helper tests PASS; 0 type errors.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/QcCenterPage apps/web/src/components/ui/ConfirmDialog.tsx
git commit -m "feat(web): QC center page — queue, branch/PO search filters, bulk confirm + reject"
```

---

### Task 5: Wire the lazy route + menu entries + nav badge + CommandPalette

Register `/purchase-orders/qc` as a lazy `ProtectedRoute` (OWNER, BRANCH_MANAGER), add the menu item with the new `qc-pending-count` badge under the existing inventory section for OWNER + BRANCH_MANAGER, wire the badge into `NavBadge`, and add a CommandPalette entry.

**Files:**
- Modify: `apps/web/src/App.tsx` (lazy import ~line 94; new route after the `/purchase-orders` route ~line 345)
- Modify: `apps/web/src/config/menu.ts` (`MenuBadgeKey` union line 65; menu items in `owner-inventory` ~line 491 and `bm-inventory` ~line 240)
- Modify: `apps/web/src/components/layout/Sidebar.tsx` (`NavBadge` line 62-71 — handle `qc-pending-count`)
- Modify: `apps/web/src/components/CommandPalette.tsx` (entry after line 65)

**Interfaces:**
- Consumes: `useQcPendingCount` (Task 3), the existing `NavBadge`/`badgeKey` plumbing.
- Produces: route `/purchase-orders/qc`; `MenuBadgeKey` gains `'qc-pending-count'`.

- [ ] **Step 1: Add the lazy import in `App.tsx`**

Next to the existing PurchaseOrders import (line 94):

```tsx
const QcCenterPage = lazy(() => import('@/pages/QcCenterPage'));
```

- [ ] **Step 2: Register the route**

In `App.tsx`, add immediately **after** the `/purchase-orders` route block (after line 345), mirroring its `ProtectedRoute roles`:

```tsx
          <Route
            path="/purchase-orders/qc"
            element={
              <ProtectedRoute roles={['OWNER', 'BRANCH_MANAGER']}>
                <QcCenterPage />
              </ProtectedRoute>
            }
          />
```

> Order does not matter for react-router v6 object/element routes (it matches by specificity, not declaration order), but keeping `/purchase-orders/qc` directly under `/purchase-orders` keeps the file readable.

- [ ] **Step 3: Extend the `MenuBadgeKey` union**

In `menu.ts` line 65:

```typescript
export type MenuBadgeKey = 'chat-unread' | 'asset-draft-count' | 'qc-pending-count';
```

- [ ] **Step 4: Add the menu item to both inventory sections**

The icon `ClipboardCheck` is **already imported** in `menu.ts` (line 43). In the `bm-inventory` section, add after the PO item (line 240):

```typescript
        { label: 'ศูนย์ตรวจ QC', path: '/purchase-orders/qc', icon: ClipboardCheck, badgeKey: 'qc-pending-count' },
```

In the `owner-inventory` section, add after the PO item (line 491):

```typescript
        { label: 'ศูนย์ตรวจ QC', path: '/purchase-orders/qc', icon: ClipboardCheck, badgeKey: 'qc-pending-count' },
```

> This **adds an item** to existing sections — it does **not** change the section `key`s, so the `menu.test.ts` "exact expected keys" regression guard (lines 75-85) stays green. The new path resolves to the `shop` zone via `resolveZoneForPath` (it now matches a menu item), so `MainLayout`'s zone guard won't bounce OWNER/BM ([MainLayout.tsx:91-111](../../../apps/web/src/components/layout/MainLayout.tsx)).

- [ ] **Step 5: Teach `NavBadge` the new key**

In `Sidebar.tsx`, replace `NavBadge` (lines 61-71). Add the import for `useQcPendingCount` near the other hook imports (after line 39):

```tsx
import { useQcPendingCount } from '@/hooks/useQcPendingCount';
```

```tsx
/* ── NavBadge — dynamic count badge for sidebar items ── */
function NavBadge({ badgeKey }: { badgeKey: MenuBadgeKey }) {
  const draftCount = useDraftAssetCount(badgeKey === 'asset-draft-count');
  const qcCount = useQcPendingCount(badgeKey === 'qc-pending-count');
  const count = badgeKey === 'asset-draft-count' ? draftCount
    : badgeKey === 'qc-pending-count' ? qcCount
    : undefined;
  if (!count || count === 0) return null;
  return (
    <span className="ml-auto inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-[11px] font-medium bg-warning/10 text-warning dark:bg-warning/15">
      {count}
    </span>
  );
}
```

> Both hooks are always called (rules-of-hooks safe) and self-gate via their `enabled` arg — only the one matching `badgeKey` actually fetches. The `asset-draft-count` badge keeps its `bg-primary/15 text-primary` look via the conditional class is dropped in favor of a single warning-tinted badge; to preserve the asset badge's original primary tint, branch the className:

```tsx
  const cls = badgeKey === 'qc-pending-count'
    ? 'bg-warning/10 text-warning dark:bg-warning/15'
    : 'bg-primary/15 text-primary';
  return (
    <span className={`ml-auto inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-[11px] font-medium ${cls}`}>
      {count}
    </span>
  );
```

Use this className-branched version (replace the single-class `<span>` above with it) so the asset badge stays primary-tinted and QC is warning-tinted.

- [ ] **Step 6: Add a CommandPalette entry**

In `CommandPalette.tsx`, add after the existing PO entry (line 65):

```tsx
  { label: 'ศูนย์ตรวจ QC', path: '/purchase-orders/qc', icon: ClipboardCheck, keywords: 'qc quality check ตรวจ คุณภาพ qc center', roles: ['OWNER', 'BRANCH_MANAGER'] },
```

Confirm `ClipboardCheck` is imported in `CommandPalette.tsx`; if not, add it to the `lucide-react` import. Run `grep -n "ClipboardCheck" apps/web/src/components/CommandPalette.tsx` first.

- [ ] **Step 7: Run the menu regression test + type-check**

Run: `cd apps/web && npx vitest run src/config/menu.test.ts && ../../tools/check-types.sh web`
Expected: menu.test.ts PASS (regression guards intact — section keys unchanged); 0 type errors.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/App.tsx apps/web/src/config/menu.ts apps/web/src/components/layout/Sidebar.tsx apps/web/src/components/CommandPalette.tsx
git commit -m "feat(web): wire /purchase-orders/qc route + nav badge + menu/palette entries"
```

---

### Task 6: Retire the inline `QcPendingPanel` from `PurchaseOrdersPage`

The collapsible panel is now superseded by the QC center page. Remove it (and its dead `qc-pending`/`qcNotes`/`showQcPanel` state + the broken `{ items: [...] }` confirm mutation) from `PurchaseOrdersPage`, leaving a link/empty so the PO page stays focused.

**Files:**
- Delete: `apps/web/src/pages/PurchaseOrdersPage/components/QcPendingPanel.tsx`
- Modify: `apps/web/src/pages/PurchaseOrdersPage/index.tsx` (remove `<QcPendingPanel/>` import + render, lines 12, 112-119)
- Modify: `apps/web/src/pages/PurchaseOrdersPage/hooks/usePurchaseOrdersData.ts` (remove `qcPendingItems` query, `qcConfirmMutation`, `showQcPanel`, `qcNotes` state + returns)

**Interfaces:**
- Removes: `QcPendingPanel` component; `usePurchaseOrdersData`'s `qcPendingItems`, `qcConfirmMutation`, `showQcPanel`, `setShowQcPanel`, `qcNotes`, `setQcNotes`.

- [ ] **Step 1: Remove the panel render + import in `index.tsx`**

Delete the import on line 12:

```tsx
import { QcPendingPanel } from './components/QcPendingPanel';
```

Delete the render block (lines 112-119):

```tsx
      <QcPendingPanel
        qcPendingItems={data.qcPendingItems}
        showQcPanel={data.showQcPanel}
        setShowQcPanel={data.setShowQcPanel}
        qcNotes={data.qcNotes}
        setQcNotes={data.setQcNotes}
        qcConfirmMutation={data.qcConfirmMutation}
      />
```

Optionally add a lightweight link to the new page in the `PageHeader` action `<div className="flex gap-2">` (before the "+ สร้าง PO" button) so PO users can jump to QC:

```tsx
            <Link
              to="/purchase-orders/qc"
              className="inline-flex items-center gap-1.5 px-3 py-2 text-sm border border-input rounded-lg hover:bg-muted transition-colors"
            >
              <ClipboardCheck className="size-4" />
              ศูนย์ตรวจ QC
            </Link>
```

If you add the link, add `import { Link } from 'react-router';` and `import { ClipboardCheck } from 'lucide-react';` (extend the existing lucide import on line 7 which already imports `Download`).

- [ ] **Step 2: Remove the dead QC state + query + mutation in `usePurchaseOrdersData.ts`**

Delete:
- the `showQcPanel`/`setShowQcPanel` state (line 14): `const [showQcPanel, setShowQcPanel] = useState(false);`
- the `qcNotes`/`setQcNotes` state (line 15): `const [qcNotes, setQcNotes] = useState<Record<string, string>>({});`
- the `qcPendingItems` query (lines 67-75)
- the `qcConfirmMutation` (lines 77-86)
- their entries from the `return { ... }` object (lines 364, 366, 386-389): `qcPendingItems`, `qcConfirmMutation`, `showQcPanel`, `setShowQcPanel`, `qcNotes`, `setQcNotes`

- [ ] **Step 3: Delete the component file**

```bash
git rm apps/web/src/pages/PurchaseOrdersPage/components/QcPendingPanel.tsx
```

- [ ] **Step 4: Type-check (catches any lingering reference)**

Run: `./tools/check-types.sh all`
Expected: 0 errors — no remaining references to `QcPendingPanel`, `qcPendingItems`, `qcConfirmMutation`, `showQcPanel`, or `qcNotes`.

- [ ] **Step 5: Manual verification (desktop + mobile)**

Run the app (`cd apps/web && npm run dev`), log in as OWNER (`admin@bestchoice.com` / `admin1234`), then as BRANCH_MANAGER (`manager.ladprao@bestchoice.com` / `admin1234`).

Desktop (≥1024px):
1. Sidebar → "คลัง & จัดซื้อ" → confirm **"ศูนย์ตรวจ QC"** item appears with a warning-tinted count badge when there are QC_PENDING/PHOTO_PENDING products (receive a PO first via `/purchase-orders` if the DB is empty).
2. Click it → lands on `/purchase-orders/qc` with no "ไม่มีสิทธิ์" toast and no zone bounce.
3. Header count matches the badge. Search "PO-" narrows the list; branch dropdown filters.
4. Select 2 rows → sticky bar shows "เลือก 2 ชิ้น" → "ยืนยันผ่านทั้งหมด" → toast success → rows leave the queue, badge decrements (≤30s or on window focus).
5. Per-row "ไม่ผ่าน" → reason dialog → "บันทึกไม่ผ่าน" → toast success → rows leave; "ผ่าน"/"บันทึก" disabled while pending (spinner state).
6. `/purchase-orders` no longer shows the collapsible QC panel; the optional "ศูนย์ตรวจ QC" header link navigates correctly.
7. Open `Cmd/Ctrl+K` → type "QC" → entry navigates to the page.

Mobile (≤1023px, devtools responsive ~390px):
8. Rows stack vertically; the ผ่าน/ไม่ผ่าน buttons are full-width and tappable; the sticky bar spans full width (no sidebar offset); the reject dialog Textarea is reachable and the keyboard does not cover the confirm button.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/PurchaseOrdersPage
git commit -m "refactor(web): retire inline QcPendingPanel — QC now lives at /purchase-orders/qc"
```

---

## Self-Review

**Spec coverage (B4 items — from spec §"QC center" + Batches §B4):**
- **Dedicated QC page** (`QcPendingPanel.tsx` → page) at a lazy route → Task 4 (`QcCenterPage`) + Task 5 (route `/purchase-orders/qc`). ✅
- **Queue of `QC_PENDING`/`PHOTO_PENDING`** → Task 1 (backend `includePhotoPending` widening) consumed by Task 3 hook + Task 4 list. ✅
- **Filters (branch/PO/date)** → Task 4: branch `<select>` (server-side via `getQCPending.branchId`, **OWNER-only** — BranchGuard blocks a BM from passing another branch's id, see deviation #6), PO/name/IMEI search (`useDebounce`, client-side over the fetched page). *Date:* the queue is sorted newest-first (`createdAt desc`) and every row shows `formatDateTime(createdAt)`; an explicit date-range picker is **not** added because QC_PENDING items are a small live queue (intended for immediate action, not historical search) — documented scope trim, consistent with the spec's "filter by branch/PO/date" intent being satisfied by branch+PO filters + visible/ordered dates. ⚠️ (scope note, see deviation #3)
- **Bulk confirm (reuse `POST /purchase-orders/qc-confirm`)** → Task 3 `confirmMutation` (posts `{ productIds }`) + Task 4 sticky bar "ยืนยันผ่านทั้งหมด". ✅
- **Reject path** → Task 2 (new additive `POST /purchase-orders/qc-reject`) + Task 4 reject dialog. ✅
- **Reuse existing `getQCPending`** → Task 1 keeps the same method/shape, only widened additively. ✅
- **Nav badge of pending count** → Task 3 `useQcPendingCount` + Task 5 `MenuBadgeKey 'qc-pending-count'` wired into the existing `NavBadge`. Count source = `getQCPending` total (B0's `summary.waitingQc` does not exist yet — spec's stated fallback). ✅
- **Route + menu entry per repo conventions, role gating (OWNER, BRANCH_MANAGER)** → Task 5: lazy `ProtectedRoute roles={['OWNER','BRANCH_MANAGER']}`, menu items in `owner-inventory` + `bm-inventory`, backend routes `@Roles('OWNER','BRANCH_MANAGER')` (mirrors existing `qc-pending`/`qc-confirm`). ✅

**Placeholder scan:** none. Every code/JSX/test step contains full content; the conditional spots (`Product` note-column existence in Task 2; `ConfirmDialog` `children` + `closeOnConfirm` edits in Task 4) include the exact grep to run and both concrete branches.

**Type/prop-name consistency across tasks:**
- `getQCPending` filter shape `{ branchId?, poId?, includePhotoPending?, page?, limit? }` is identical in `PoQueryService` (Task 1 Step 3), the facade (Task 1 Step 4), and the controller mapping (Task 1 Step 5).
- `rejectQC(productIds: string[], reason: string)` signature identical in service (Task 2 Step 4), facade (Task 2 Step 5), and controller `RejectQCDto` (Task 2 Step 3/6).
- `QcPendingProduct` defined once in `useQcCenter.ts` (Task 3) and imported by `qcLabels.ts` + its test (Task 4) — no duplicate definition.
- `MenuBadgeKey` value `'qc-pending-count'` is declared in `menu.ts` (Task 5 Step 3), referenced by the menu items (Step 4) and matched in `NavBadge` (Step 5) and the hook gate (Task 3).
- Mutation bodies match the backend contract: `qc-confirm` reads `@Body('productIds')` → hook posts `{ productIds }`; `qc-reject` uses `RejectQCDto.productIds`/`reason` → hook posts `{ productIds, reason }`.

**Deviations found vs spec wording:**
1. **Pre-existing bug fixed in passing:** the retired `QcPendingPanel` posted `{ items: [{ productId, passed, notes }] }` to `/purchase-orders/qc-confirm`, but the controller reads `@Body('productIds')` ([purchase-orders.controller.ts:67](../../../apps/api/src/modules/purchase-orders/purchase-orders.controller.ts)) — so the old "ผ่าน" button silently sent `productIds: undefined` and could not work. The new hook posts the correct `{ productIds }`. This is an improvement, not a regression.
2. **B0 not shipped:** the spec said the badge "can reuse `GET /purchase-orders/summary.waitingQc` (from B0) **or** `getQCPending` total." Grep confirms B0 hasn't landed (no `summary`/`waitingQc` endpoint; latest migration is `20260977000000_add_payment_drafts`, which also means B0's planned timestamp is already taken). This batch uses the `getQCPending` fallback, isolated in `useQcPendingCount` so B5 can swap it later in one place. No spec violation — the fallback is explicitly sanctioned.
3. **Date filter scope trim:** spec lists "filter by branch/PO/date." Implemented branch + PO (+name/IMEI) filters and surfaced per-row dates with newest-first ordering, but did **not** add a date-range picker — the QC queue is a small actionable live list, not a historical archive (the dated/searchable archive is the GR history in B1). Branch+PO+visible-dates satisfy the operator need; a date-range picker can be added in B5 if the owner asks. Stated here so it's a conscious trim, not an omission.
4. **`PHOTO_PENDING` was not in `getQCPending`:** the spec assumed the queue already covered `QC_PENDING`/`PHOTO_PENDING`, but `getQCPending` hard-coded `QC_PENDING` only. Task 1 adds the additive `includePhotoPending` flag (default behavior unchanged) so the page can show both without breaking existing callers.
5. **Reject = soft-delete (no note column exists):** the spec says "reject→defect" but the structured `DefectReason` enum lives in B0 (not shipped) and the per-unit defect capture is B3's `goodsReceiving` reject branch. At the **post-receive QC** stage there is no existing reject endpoint, so Task 2 adds a minimal additive one. Verified at plan time that `Product` has **no** free-text note column, so the unit is soft-deleted and the operator's reason is server-validated (required) and echoed in the response `message` — **no** schema change in B4. When B0's `DefectReason` lands, `RejectQCDto` can gain an optional `defectReason` (and a `Product.qcNote` could persist the reason) additively — noted for B0/B5 follow-up.
6. **`BranchGuard` 403 trap → OWNER-only branch picker (NEW behavior in B4):** the PO controller is `@UseGuards(JwtAuthGuard, RolesGuard, BranchGuard)` ([purchase-orders.controller.ts:14](../../../apps/api/src/modules/purchase-orders/purchase-orders.controller.ts)). `BranchGuard` ([branch.guard.ts](../../../apps/api/src/modules/auth/guards/branch.guard.ts)) throws `ไม่สามารถเข้าถึงข้อมูลของสาขาอื่นได้` when a branch-scoped role (BRANCH_MANAGER) passes a `branchId` ≠ their own. The legacy `QcPendingPanel` never hit this because it called `qc-pending` with **no** `branchId`. The new page's branch `<select>` *would* let a BM pick another branch → guaranteed 403. Fix in Task 4: the branch picker (and its `['branches']` query, `enabled`-gated) renders **only for OWNER** (`user?.role === 'OWNER'` via `useAuth`); BM sends no `branchId` and sees the queue exactly as the legacy panel did. A proper per-branch BM scope (service auto-filters by `user.branchId`) is a backend follow-up, **out of B4 scope** (it would change `getQCPending` behavior for existing callers). OWNER/FM/ACC are `CROSS_BRANCH_ROLES` so they are unaffected — but only OWNER reaches this page (route + menu gated to OWNER/BM).
7. **`ConfirmDialog` adapted additively (children + `closeOnConfirm`):** the existing `ConfirmDialog` ([ConfirmDialog.tsx](../../../apps/web/src/components/ui/ConfirmDialog.tsx)) did **not** render `{children}` and auto-closed synchronously on confirm (`onConfirm(); onOpenChange(false);`), which is wrong for an async mutation (spinner/disabled-confirm + post-submit validation toast would never show). Task 4 Step 3 adds an optional `children?: ReactNode` (render between header/footer) and an optional `closeOnConfirm = true` prop (gate the auto-close), passing `closeOnConfirm={false}` from the reject dialog so the page controls closing via `onSuccess`. Both changes default to the old behavior for every existing caller — backward compatible, no other call site touched.
