# Purchasing v2 — Batch 3: Mobile-first Receiving + Supplier-Direct Receive (auto-PO) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make รับเข้าหน้างาน (goods receiving) a fast, mobile-first flow on a real phone — per-unit IMEI with live duplicate feedback, camera photo capture, used-phone checklist, PASS/REJECT with a structured `DefectReason`, and partial-receive progress — and add **supplier-direct receive ("รับเข้าตรง")** for urgent buys with no pre-made PO. Direct-receive is implemented as an **auto-PO**: one Serializable backend transaction creates a real `PurchaseOrder` (`isDirectReceive=true`, `unitPrice=costPrice`, supplier required), advances it `APPROVED → ORDERED` bypassing the OWNER approval gate (audited), then runs the **existing** `goodsReceiving()` so GR history / AP / progress / timeline all work with zero null-guards. **No JE. No accounting touch.**

**Architecture:** Additive backend method + endpoint on the already-isolated `purchase-orders` module (`imports: []`, Prisma-only). New `DirectReceiveDto` + `PoReceivingService.directReceive()` (wraps `PoLifecycleService` create-shape logic + `goodsReceiving()` in ONE `$transaction`) + facade delegate + controller route. Frontend: rebuild `GoodsReceivingModal.tsx` into a mobile-first flow rendered in `Drawer` (bottom-sheet) on mobile via `useIsMobile`, keeping the existing desktop modal layout; add a "รับเข้าตรง (supplier)" entry that opens the same per-unit flow seeded from an ad-hoc supplier + line form and calls the new endpoint.

**Tech Stack:** NestJS + Prisma + PostgreSQL (`apps/api`), jest mock-based unit tests. React 18 + TypeScript + Vite + Tailwind + shadcn/ui + Radix + lucide + react-query + `@/lib/api` (`apps/web`), vitest + RTL for logic, Playwright/manual for UI.

**Spec:** `docs/superpowers/specs/2026-06-29-purchasing-receiving-ux-v2-design.md`

## Global Constraints

- **RED LINE — no accounting/finance:** introduce **NO** import of any accounting/finance/journal/expense/tax module into `purchase-orders`; do **not** touch `trade-in` or `Product.ownedByCompanyId`; **receiving stays JE-free**. Direct-receive posts **zero** `JournalEntry`/`GeneralLedger`/`ExpenseDocument` rows. Verified: the module declares **no `imports` array at all** (only `controllers`/`providers`/`exports`) and injects only `PrismaService` via the facade — architecturally sealed; do **not** add an `imports` entry in this batch ([purchase-orders.module.ts](../../../apps/api/src/modules/purchase-orders/purchase-orders.module.ts)). `auditLog` is a delegate on `PrismaService`, so writing the approval-bypass `AuditLog` needs **no** new import (mirror the `this.prisma.auditLog.create({ data: { userId, action, entity, entityId, oldValue?, newValue } })` shape in [trade-in-lifecycle.service.ts](../../../apps/api/src/modules/trade-in/services/trade-in-lifecycle.service.ts) — `TRADE_IN_APPRAISAL_FORCE_OVERRIDE`).
- **`costPrice` is mandatory + validated on direct-receive.** COGS reads `Product.costPrice` at sale time; direct-receive sets `POItem.unitPrice = costPrice`, and `goodsReceiving()` already copies `unitPrice → Product.costPrice` ([po-receiving.service.ts:250](../../../apps/api/src/modules/purchase-orders/services/po-receiving.service.ts)). Reject `costPrice <= 0` / missing.
- **Additive only:** reuse the existing `PurchaseOrder`/`POItem`/`GoodsReceiving` write paths. `GoodsReceiving.poId` and `GoodsReceivingItem.poItemId` stay `NOT NULL` (auto-PO guarantees a real `poId`). No new migration in this batch (B0 already shipped `ORDERED`, `orderedAt`, `isDirectReceive`, `grNumber`, `DefectReason`).
- **Frontend rules** (`.claude/rules/frontend.md`): react-query + `@/lib/api` only (no raw `fetch`/`axios`); shadcn/ui + Radix + lucide only; **DESIGN TOKENS ONLY** — no hardcoded gray/hex, no `bg-white` (except print/receipt); Thai UI text uses `leading-snug`; lazy-loaded routes; `sonner` toasts; `useDebounce` for search. **Money = `Decimal`** on backend, never Float/Int.
- **Validation messages in Thai** (`class-validator`). Backend specs are mock-based jest (no DB → run in the normal suite, not `--runInBand`).
- **Type gate:** `./tools/check-types.sh all` must report **0 errors** before each commit.
- **Reuse, don't reinvent** (all verified to exist): `Drawer`/`DrawerContent`/`DrawerHeader`/`DrawerTitle`/`DrawerFooter` ([components/ui/drawer.tsx](../../../apps/web/src/components/ui/drawer.tsx)); `useIsMobile` ([hooks/useIsMobile.ts](../../../apps/web/src/hooks/useIsMobile.ts)); base64 file→`photos[]` pattern from `PaymentModal.tsx:283-294`; `checklistCategories`/`defaultChecklist` ([constants.ts:48-64](../../../apps/web/src/pages/PurchaseOrdersPage/constants.ts)); `getErrorMessage` + `api` ([lib/api.ts]); `ThaiDateInput`.

---

### Task 1: `DirectReceiveDto` + supplier-direct receive backend (auto-PO in ONE `$transaction`)

**Files:**
- Modify: `apps/api/src/modules/purchase-orders/dto/create-po.dto.ts` (add `DirectReceiveItemDto` + `DirectReceiveDto`; add `defectReason` to `GoodsReceivingItemDto`)
- Modify: `apps/api/src/modules/purchase-orders/services/po-receiving.service.ts` (add `directReceive()`; persist `defectReason` in the REJECT branch)
- Modify: `apps/api/src/modules/purchase-orders/purchase-orders.service.ts` (facade delegate `directReceive`)
- Modify: `apps/api/src/modules/purchase-orders/purchase-orders.controller.ts` (new route `POST /direct-receive`, static — before `:id`)
- Create: `apps/api/src/modules/purchase-orders/purchase-orders.direct-receive.spec.ts`

**Interfaces:**
- Consumes: `PrismaService` (incl. `prisma.$transaction`, `tx.purchaseOrder.create`, `tx.purchaseOrder.update`, `tx.auditLog.create`, `tx.supplier.findUnique`); `generatePONumber(tx)` ([sequence.util.ts:129](../../../apps/api/src/utils/sequence.util.ts)); `generateGRNumber(tx)` (B0); `buildProductName` ([po-product-naming.util.ts]).
- Produces:
  - `DirectReceiveItemDto` = `POItemDto` fields (`brand/model/color/storage/category/accessoryType/accessoryBrand`, `quantity`, **`unitPrice` renamed semantics: this is `costPrice`**) + per-unit receiving fields (`imeiSerial`, `serialNumber`, `photos`, `status`, `rejectReason`, `defectReason`, `batteryHealth`, `warrantyExpired`, `warrantyExpireDate`, `hasBox`, `checklistResults`, `sellingPrice`). One DTO item = one physical unit (qty fixed at 1 per item; the frontend expands a line into N units).
  - `DirectReceiveDto = { supplierId: string; orderDate: string; notes?: string; items: DirectReceiveItemDto[] }`.
  - `PurchaseOrdersService.directReceive(dto: DirectReceiveDto, userId: string): Promise<{ poId; poNumber; receivingId; grNumber; status; passed; rejected; products; mainWarehouse }>`.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/modules/purchase-orders/purchase-orders.direct-receive.spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PurchaseOrdersService } from './purchase-orders.service';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * B3 supplier-direct receive = auto-PO. ONE $transaction:
 *  create PO (isDirectReceive, unitPrice=costPrice) -> set APPROVED/ORDERED
 *  (approval-bypass + AuditLog) -> run goodsReceiving() to make GR + products.
 * No JE; poId never null.
 */
describe('PurchaseOrdersService.directReceive — auto-PO supplier receive', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const makeTx = () => {
    const created: Record<string, unknown[]> = {
      po: [], poUpdate: [], audit: [], gr: [], gri: [], product: [], price: [], poItemUpdate: [],
    };
    const poItems = [{ id: 'poi-1', category: 'PHONE_NEW', brand: 'Apple', model: 'iPhone 16',
      color: null, storage: '256GB', accessoryType: null, accessoryBrand: null,
      quantity: 1, receivedQty: 0, unitPrice: 30000 }];
    const tx: any = {
      purchaseOrder: {
        count: jest.fn().mockResolvedValue(2),
        create: jest.fn().mockImplementation(({ data }) => {
          created.po.push(data);
          return Promise.resolve({ id: 'po-new', poNumber: 'PO-2099-01-003', supplierId: data.supplierId,
            status: data.status, isDirectReceive: data.isDirectReceive, deletedAt: null,
            supplier: { id: data.supplierId, name: 'ACME' },
            items: poItems });
        }),
        findUnique: jest.fn().mockImplementation(() => Promise.resolve({ id: 'po-new', status: 'ORDERED',
          deletedAt: null, supplierId: 'sup-1', supplier: { id: 'sup-1', name: 'ACME' },
          items: poItems.map((i) => ({ ...i })) })),
        update: jest.fn().mockImplementation(({ data }) => { created.poUpdate.push(data); return Promise.resolve({ id: 'po-new', status: data.status }); }),
      },
      auditLog: { create: jest.fn().mockImplementation(({ data }) => { created.audit.push(data); return Promise.resolve({}); }) },
      supplier: { findUnique: jest.fn().mockResolvedValue({ id: 'sup-1', deletedAt: null }) },
      branch: { findFirst: jest.fn().mockResolvedValue({ id: 'wh', name: 'คลังกลาง' }) },
      goodsReceiving: { create: jest.fn().mockResolvedValue({ id: 'gr1' }), count: jest.fn().mockResolvedValue(0) },
      goodsReceivingItem: { create: jest.fn().mockImplementation(({ data }) => { created.gri.push(data); return Promise.resolve({ id: 'gri1', ...data }); }) },
      pOItem: {
        findMany: jest.fn().mockImplementation(({ where: { id: { in: ids } } }) =>
          Promise.resolve(poItems.filter((i) => ids.includes(i.id)).map((i) => ({ ...i })))),
        update: jest.fn().mockImplementation(({ data }) => { created.poItemUpdate.push(data); return Promise.resolve({}); }),
      },
      product: {
        create: jest.fn().mockImplementation(({ data }) => { created.product.push(data); return Promise.resolve({ id: 'prod-1', ...data }); }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      productPrice: { create: jest.fn().mockImplementation(({ data }) => { created.price.push(data); return Promise.resolve({}); }) },
    };
    return { tx, created };
  };

  const build = async (prisma: any) => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PurchaseOrdersService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    return module.get<PurchaseOrdersService>(PurchaseOrdersService);
  };

  const baseDto = () => ({
    supplierId: 'sup-1',
    orderDate: '2099-01-15',
    items: [{
      category: 'PHONE_NEW', brand: 'Apple', model: 'iPhone 16', storage: '256GB',
      quantity: 1, unitPrice: 30000, status: 'PASS', imeiSerial: 'IMEI-1', serialNumber: 'SN-1', sellingPrice: 39900,
    }],
  });

  it('creates an isDirectReceive PO at ORDERED, writes an approval-bypass AuditLog, and runs goodsReceiving', async () => {
    const { tx, created } = makeTx();
    const prisma: any = { $transaction: jest.fn().mockImplementation((fn: any) => fn(tx)) };
    const service = await build(prisma);

    const result = await service.directReceive(baseDto() as never, 'user-1');

    // PO created with the auto-PO flags + cost as unitPrice
    expect(created.po[0]).toEqual(expect.objectContaining({ supplierId: 'sup-1', isDirectReceive: true, status: 'APPROVED' }));
    expect((created.po[0] as any).items.create[0]).toEqual(expect.objectContaining({ unitPrice: 30000, quantity: 1 }));
    // advanced APPROVED -> ORDERED
    expect(created.poUpdate.some((u: any) => u.status === 'ORDERED' && u.orderedAt instanceof Date)).toBe(true);
    // approval-bypass audit row
    expect(created.audit[0]).toEqual(expect.objectContaining({ userId: 'user-1', action: 'PO_DIRECT_RECEIVE_APPROVAL_BYPASS', entity: 'purchase_order', entityId: 'po-new' }));
    // product created with costPrice from unitPrice
    expect(created.product[0]).toEqual(expect.objectContaining({ costPrice: 30000, imeiSerial: 'IMEI-1' }));
    // GR result surfaced
    expect(result).toEqual(expect.objectContaining({ poId: 'po-new', poNumber: 'PO-2099-01-003', receivingId: 'gr1', passed: 1, rejected: 0 }));
  });

  it('rejects a missing/zero costPrice (COGS would silently break)', async () => {
    const { tx } = makeTx();
    const prisma: any = { $transaction: jest.fn().mockImplementation((fn: any) => fn(tx)) };
    const service = await build(prisma);
    const dto = baseDto();
    dto.items[0].unitPrice = 0;
    await expect(service.directReceive(dto as never, 'user-1')).rejects.toThrow(BadRequestException);
  });

  it('rejects when the supplier does not exist', async () => {
    const { tx } = makeTx();
    tx.supplier.findUnique = jest.fn().mockResolvedValue(null);
    const prisma: any = { $transaction: jest.fn().mockImplementation((fn: any) => fn(tx)) };
    const service = await build(prisma);
    await expect(service.directReceive(baseDto() as never, 'user-1')).rejects.toThrow(NotFoundException);
  });

  it('persists structured defectReason on a REJECT unit', async () => {
    const { tx, created } = makeTx();
    const prisma: any = { $transaction: jest.fn().mockImplementation((fn: any) => fn(tx)) };
    const service = await build(prisma);
    const dto = baseDto();
    dto.items[0] = { ...dto.items[0], status: 'REJECT', rejectReason: 'จอแตก', defectReason: 'SCREEN' } as never;
    await service.directReceive(dto as never, 'user-1');
    expect(created.gri[0]).toEqual(expect.objectContaining({ status: 'REJECT', defectReason: 'SCREEN', rejectReason: 'จอแตก' }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx jest purchase-orders.direct-receive.spec.ts`
Expected: FAIL — `service.directReceive is not a function`.

- [ ] **Step 3: Add `defectReason` to `GoodsReceivingItemDto` + the new direct-receive DTOs**

In `dto/create-po.dto.ts`, update the top import to include `IsEnum` and import `DefectReason`:

```typescript
import { IsString, IsNumber, IsOptional, IsDateString, IsArray, ValidateNested, IsIn, IsBoolean, IsEnum, ArrayMinSize, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { DefectReason } from '@prisma/client';
```

Add `defectReason` to `GoodsReceivingItemDto` (just after `rejectReason`, ~line 189) so the existing `/goods-receiving` flow can also send it (frontend Task 3 uses it):

```typescript
  @IsEnum(DefectReason)
  @IsOptional()
  defectReason?: DefectReason;
```

> NOTE: if B0 already added this field to `GoodsReceivingItemDto`, skip it (the Self-Review documents this). `IsEnum`/`DefectReason` imports are still required for `DirectReceiveItemDto` below.

Append the two new DTO classes at the end of the file:

```typescript
export class DirectReceiveItemDto {
  // Product spec (mirrors POItemDto)
  @IsString() @IsOptional() brand?: string;
  @IsString() @IsOptional() model?: string;
  @IsString() @IsOptional() color?: string;
  @IsString() @IsOptional() storage?: string;
  @IsString() @IsOptional() category?: string;
  @IsString() @IsOptional() accessoryType?: string;
  @IsString() @IsOptional() accessoryBrand?: string;

  // One DTO item = one physical unit.
  @IsNumber() @Min(1) quantity: number;

  // costPrice (booked as POItem.unitPrice; copied into Product.costPrice by goodsReceiving). MANDATORY for COGS.
  @IsNumber() @Min(0.01, { message: 'กรุณาระบุราคาทุน (costPrice) มากกว่า 0' }) unitPrice: number;

  // Per-unit receiving fields (mirror GoodsReceivingItemDto)
  @IsString() @IsOptional() imeiSerial?: string;
  @IsString() @IsOptional() serialNumber?: string;
  @IsArray() @IsOptional() photos?: string[];
  @IsIn(['PASS', 'REJECT']) status: 'PASS' | 'REJECT';
  @IsString() @IsOptional() rejectReason?: string;
  @IsEnum(DefectReason) @IsOptional() defectReason?: DefectReason;
  @IsNumber() @IsOptional() batteryHealth?: number;
  @IsBoolean() @IsOptional() warrantyExpired?: boolean;
  @IsString() @IsOptional() warrantyExpireDate?: string;
  @IsBoolean() @IsOptional() hasBox?: boolean;
  @IsArray() @IsOptional() @ValidateNested({ each: true }) @Type(() => ChecklistResultDto)
  checklistResults?: ChecklistResultDto[];
  @IsNumber() @IsOptional() @Min(0) sellingPrice?: number;
}

export class DirectReceiveDto {
  @IsString() supplierId: string;

  @IsDateString() orderDate: string;

  @IsString() @IsOptional() notes?: string;

  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => DirectReceiveItemDto)
  items: DirectReceiveItemDto[];
}
```

- [ ] **Step 4: Persist `defectReason` in the existing REJECT branch (shared by both flows)**

In `po-receiving.service.ts`, the REJECT branch (currently lines 301-311) does not store `defectReason`. Add it:

```typescript
          } else {
            // Create receiving item for rejected items (no product created)
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

            rejectedItems.push(rejectedItem);
          }
```

> NOTE: if B0 already added `defectReason` here, skip — the Self-Review documents this.

- [ ] **Step 5: Implement `directReceive()` in `PoReceivingService`**

In `po-receiving.service.ts`, update the import on line 4 and add the imports for the number generators + `DirectReceiveDto`:

```typescript
import { GoodsReceivingDto, DirectReceiveDto } from '../dto/create-po.dto';
import { generatePONumber } from '../../../utils/sequence.util';
```

> NOTE: B0 retired the legacy `receive()` and removed `ReceivePODto` from this import; this batch's import line keeps `GoodsReceivingDto` and adds `DirectReceiveDto`. `generatePONumber` is the existing PO-number generator. `Prisma`/`ProductCategory`/`buildProductName` are already imported at the top (lines 2,5).

Add the method as a new public method (place it after `goodsReceiving()`, before `confirmQC()`):

```typescript
  /**
   * B3 — Supplier-direct receive ("รับเข้าตรง") = auto-PO.
   *
   * Urgent buys from a vendor with no pre-made PO. Instead of threading a
   * nullable poId through the PO-centric read paths, we auto-create a REAL PO
   * (supplier + line items, unitPrice = costPrice) and advance it
   * APPROVED -> ORDERED in ONE Serializable $transaction, bypassing the OWNER
   * approval gate (audited), then run the existing goodsReceiving() flow.
   * Net: GoodsReceiving.poId is never null; GR history / AP / progress / the
   * T5-C16 ceiling check all work unchanged. JE-FREE — no accounting touch.
   */
  async directReceive(dto: DirectReceiveDto, userId: string) {
    // Up-front guard: every line must carry a positive costPrice (COGS reads it).
    const badCost = dto.items.find((i) => !(Number(i.unitPrice) > 0));
    if (badCost) {
      throw new BadRequestException('กรุณาระบุราคาทุน (costPrice) มากกว่า 0 ให้ครบทุกรายการ');
    }

    const MAX_ATTEMPTS = 3;
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.prisma.$transaction(
          async (tx) => {
            // 1) Validate supplier
            const supplier = await tx.supplier.findUnique({ where: { id: dto.supplierId } });
            if (!supplier || supplier.deletedAt) throw new NotFoundException('ไม่พบ Supplier');

            // 2) Create the auto-PO (unitPrice = costPrice). Starts APPROVED so the
            //    OWNER approval gate is structurally bypassed (audited at step 4).
            const poNumber = await generatePONumber(tx);
            const totalAmount = dto.items.reduce((s, i) => s + Number(i.unitPrice) * i.quantity, 0);
            const po = await tx.purchaseOrder.create({
              data: {
                poNumber,
                supplierId: dto.supplierId,
                orderDate: new Date(dto.orderDate),
                totalAmount,
                netAmount: totalAmount, // direct receive: no VAT/discount math (purchasing stays off the accounting surface)
                notes: dto.notes ?? null,
                createdById: userId,
                approvedById: userId,
                status: 'APPROVED',
                isDirectReceive: true,
                paymentStatus: 'UNPAID',
                items: {
                  create: dto.items.map((i) => ({
                    brand: i.brand || null,
                    model: i.model || null,
                    color: i.color || null,
                    storage: i.storage || null,
                    category: i.category || null,
                    accessoryType: i.accessoryType || null,
                    accessoryBrand: i.accessoryBrand || null,
                    quantity: i.quantity,
                    unitPrice: i.unitPrice,
                  })),
                },
              },
              include: { items: true, supplier: { select: { id: true, name: true } } },
            });

            // 3) Advance APPROVED -> ORDERED (mirrors PoLifecycleService.order from B0)
            await tx.purchaseOrder.update({
              where: { id: po.id },
              data: { status: 'ORDERED', orderedAt: new Date() },
            });

            // 4) Audit the approval-bypass (no cross-module import — auditLog is on PrismaService)
            await tx.auditLog.create({
              data: {
                userId,
                action: 'PO_DIRECT_RECEIVE_APPROVAL_BYPASS',
                entity: 'purchase_order',
                entityId: po.id,
                newValue: {
                  poNumber: po.poNumber,
                  supplierId: dto.supplierId,
                  isDirectReceive: true,
                  reason: 'รับเข้าตรงจาก supplier (ไม่มี PO ล่วงหน้า) — ข้ามขั้นอนุมัติ',
                  itemCount: dto.items.length,
                },
              },
            });

            // 5) Map each DTO line onto the freshly-created POItem id, then run the
            //    SAME per-unit receiving pipeline (in this tx) the standard flow uses.
            const grItems = dto.items.map((line, idx) => ({
              poItemId: po.items[idx].id,
              imeiSerial: line.imeiSerial,
              serialNumber: line.serialNumber,
              photos: line.photos,
              status: line.status,
              rejectReason: line.rejectReason,
              defectReason: line.defectReason,
              batteryHealth: line.batteryHealth,
              warrantyExpired: line.warrantyExpired,
              warrantyExpireDate: line.warrantyExpireDate,
              hasBox: line.hasBox,
              checklistResults: line.checklistResults,
              sellingPrice: line.sellingPrice,
            }));

            const gr = await this.runReceiveInTx(tx, po.id, { items: grItems, notes: dto.notes }, userId);

            return { poId: po.id, poNumber: po.poNumber, ...gr };
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

> The above calls `this.runReceiveInTx(tx, ...)` — the receiving pipeline extracted from `goodsReceiving()` so both the standalone endpoint and direct-receive share **one** code path (DRY). Step 6 extracts it.

- [ ] **Step 6: Extract the receiving pipeline into a private `runReceiveInTx(tx, ...)` and call it from `goodsReceiving()`**

The body of `goodsReceiving()`'s `$transaction` callback (currently lines 134-349 — branch lookup, GR create, ceiling check, IMEI guard, per-unit loop, POItem updates, status recompute) becomes a private method taking the `tx` client. This keeps the existing flow byte-identical while letting `directReceive()` reuse it. Replace the whole `goodsReceiving()` method (lines 131-353) with:

```typescript
  async goodsReceiving(id: string, dto: GoodsReceivingDto, userId: string) {
    return this.prisma.$transaction(
      async (tx) => this.runReceiveInTx(tx, id, dto, userId),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  /**
   * Shared per-unit receiving pipeline. Runs INSIDE a caller-provided
   * Serializable tx (standard goodsReceiving OR direct-receive auto-PO).
   * Closure-bound tx — never crosses a service boundary. T5-C16 ceiling
   * re-read + IMEI dup guard + product create + POItem.update + status
   * recompute all live here, unchanged.
   */
  private async runReceiveInTx(
    tx: Prisma.TransactionClient,
    id: string,
    dto: GoodsReceivingDto,
    userId: string,
  ) {
    const po = await tx.purchaseOrder.findUnique({
      where: { id },
      include: { items: true, supplier: true },
    });

    if (!po || po.deletedAt) throw new NotFoundException('ไม่พบใบสั่งซื้อ');
    if (!['APPROVED', 'ORDERED', 'PARTIALLY_RECEIVED'].includes(po.status)) {
      throw new BadRequestException('PO นี้ไม่อยู่ในสถานะที่สามารถรับสินค้าได้ (ต้อง APPROVED, ORDERED หรือ PARTIALLY_RECEIVED)');
    }

    // ... (the remaining existing body from current lines 144-349 verbatim:
    //      main-warehouse lookup, gr create with grNumber, countByPoItem,
    //      fresh re-read + ceiling check, IMEI batch+system dup guards,
    //      per-unit PASS product+price+GRI create / REJECT GRI create,
    //      POItem.update loop, status recompute + update, return object) ...
  }
```

> IMPORTANT for the implementer: paste the **entire** current `$transaction` callback body (lines 144-349, starting at `// Find main warehouse branch` through the `return { receivingId, ... }`) into `runReceiveInTx` after the status check above, with three edits:
> 1. The status check already added `'ORDERED'` (direct-receive PO is `ORDERED` when received; the standard flow's `APPROVED`/`PARTIALLY_RECEIVED` still pass). This is additive — no existing case regresses.
> 2. Keep the B0 `grNumber` line (`const grNumber = await generateGRNumber(tx);` then `grNumber` in the GR `create`) — `generateGRNumber` is already imported (B0). If for any reason B0's import is absent, add `import { generateGRNumber } from '../../../utils/sequence.util';`.
> 3. The REJECT branch already has the `defectReason` line from Step 4.
> No logic changes — only the `tx` is now a parameter instead of closure-captured from `goodsReceiving()`. The type is `Prisma.TransactionClient` (already importable from the `Prisma` namespace imported on line 2).

- [ ] **Step 7: Add the facade delegate**

In `purchase-orders.service.ts`, add `DirectReceiveDto` to the dto import on line 3 and add the delegate (after `goodsReceiving`):

```typescript
import { CreatePODto, UpdatePODto, GoodsReceivingDto, DirectReceiveDto, UpdatePaymentDto } from './dto/create-po.dto';
```
```typescript
  directReceive(dto: DirectReceiveDto, userId: string) {
    return this.receiving.directReceive(dto, userId);
  }
```

> NOTE: B0 removed `ReceivePODto` + the `receive()` delegate. If `ReceivePODto` is still present in the import (B0 not yet merged in this tree), the implementer must reconcile — but per the plan instructions B0 is assumed shipped.

- [ ] **Step 8: Add the controller route (static, before `:id`)**

In `purchase-orders.controller.ts`, add `DirectReceiveDto` to the dto import (line 4) and add the route **above** the `@Get(':id')` block (next to `qc-confirm`, in the "Static routes MUST be before :id" zone):

```typescript
  @Post('direct-receive')
  @Roles('OWNER', 'BRANCH_MANAGER')
  directReceive(
    @Body() dto: DirectReceiveDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.purchaseOrdersService.directReceive(dto, user.id);
  }
```

- [ ] **Step 9: Run tests to verify they pass**

Run: `cd apps/api && npx jest purchase-orders.direct-receive.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 10: Run the surviving receive specs to prove the `runReceiveInTx` extraction didn't regress**

Run: `cd apps/api && npx jest --runInBand src/modules/purchase-orders`
Expected: all purchase-orders specs PASS (the B0 race + IMEI-dup specs that drive `goodsReceiving()` still green because the body is unchanged — only relocated).

- [ ] **Step 11: Type-check + commit**

```bash
./tools/check-types.sh all
git add apps/api/src/modules/purchase-orders
git commit -m "feat(purchasing): supplier-direct receive as auto-PO (POST /direct-receive, approval-bypass audited, JE-free)"
```

---

### Task 2: Frontend data layer — `directReceiveMutation` + direct-receive form state

**Files:**
- Modify: `apps/web/src/pages/PurchaseOrdersPage/types.ts` (add `DefectReasonValue`, `DirectReceiveLineForm`; extend `ReceivingUnitForm` with `defectReason`)
- Modify: `apps/web/src/pages/PurchaseOrdersPage/constants.ts` (add `defectReasonOptions`)
- Modify: `apps/web/src/pages/PurchaseOrdersPage/hooks/usePurchaseOrdersData.ts` (add `directReceiveMutation`, `isDirectReceiveOpen` state + `openDirectReceive`/`closeDirectReceive`, send `defectReason` in the existing GR mutation)
- Create: `apps/web/src/pages/PurchaseOrdersPage/hooks/usePurchaseOrdersData.test.tsx` (vitest — payload-shape logic only)

**Interfaces:**
- Produces:
  - `type DefectReasonValue = 'SCREEN' | 'BATTERY' | 'IMEI_BLOCKED' | 'BOX_MISSING' | 'WRONG_MODEL' | 'DOA' | 'COSMETIC' | 'OTHER'` (matches the B0 Prisma `DefectReason` enum values).
  - `defectReasonOptions: { value: DefectReasonValue; label: string }[]`.
  - `directReceiveMutation: UseMutationResult<{ data: { poNumber: string; passed: number; rejected: number; mainWarehouse: string } }, unknown, DirectReceivePayload, unknown>`.
  - `DirectReceivePayload = { supplierId: string; orderDate: string; notes?: string; items: ReceivingUnitForm[]; lineCost: Record<string, string> }` where `lineCost[poItemId-ish]` carries the per-line costPrice. (We thread costPrice per *unit* by storing it on each `ReceivingUnitForm` — see Step 1.)
- Consumes: `api.post('/purchase-orders/direct-receive', ...)`, `getErrorMessage`, `toast`.

- [ ] **Step 1: Extend `ReceivingUnitForm` with `defectReason` + `costPrice`; add `DefectReasonValue` + `DirectReceiveLineForm`**

In `types.ts`, change `ReceivingUnitForm` (currently lines 75-89) to add the two fields and add the new types at the bottom of the file:

```typescript
export type DefectReasonValue =
  | 'SCREEN' | 'BATTERY' | 'IMEI_BLOCKED' | 'BOX_MISSING'
  | 'WRONG_MODEL' | 'DOA' | 'COSMETIC' | 'OTHER';

export interface ReceivingUnitForm {
  poItemId: string;
  label: string;
  category: string;
  imeiSerial: string;
  serialNumber: string;
  status: 'PASS' | 'REJECT';
  rejectReason: string;
  defectReason: DefectReasonValue | '';
  batteryHealth: string;
  warrantyExpired: boolean;
  warrantyExpireDate: string;
  hasBox: boolean;
  checklist: { item: string; category: string; passed: boolean; note: string }[];
  sellingPrice: string;
  photos: string[];
  costPrice: string; // direct-receive only (empty for PO-based receive)
  // Direct-receive-only product attrs (PO-based seeds leave these undefined —
  // the PO unit derives its name from the PO line; direct-receive seeds set them).
  // Required by buildDirectReceiveItem (Task 2 Step 6) + lineToUnits (Task 4 Step 2).
  brand?: string;
  model?: string;
  color?: string;
  storage?: string;
  accessoryType?: string;
  accessoryBrand?: string;
}

// One ad-hoc supplier-direct line (expands into `quantity` ReceivingUnitForm units)
export interface DirectReceiveLineForm {
  category: string;
  brand: string;
  model: string;
  color: string;
  storage: string;
  accessoryType: string;
  accessoryBrand: string;
  quantity: string;
  costPrice: string;
}
```

> `photos: string[]` was implicitly handled before (the old form never collected photos in the modal — `goodsReceivingMutation` sent `photos: item.photos || []` but `ReceivingUnitForm` had no `photos`; this batch makes it explicit so camera capture has somewhere to live).

- [ ] **Step 2: Add `defectReasonOptions` to `constants.ts`**

Append to `constants.ts`:

```typescript
import { DefectReasonValue } from './types';

export const defectReasonOptions: { value: DefectReasonValue; label: string }[] = [
  { value: 'SCREEN', label: 'จอเสีย/จอแตก' },
  { value: 'BATTERY', label: 'แบตเตอรี่เสีย' },
  { value: 'IMEI_BLOCKED', label: 'IMEI ถูกบล็อก' },
  { value: 'BOX_MISSING', label: 'ไม่มีกล่อง/อุปกรณ์' },
  { value: 'WRONG_MODEL', label: 'ผิดรุ่น/ผิดสเปก' },
  { value: 'DOA', label: 'เปิดไม่ติด (DOA)' },
  { value: 'COSMETIC', label: 'ตำหนิภายนอก' },
  { value: 'OTHER', label: 'อื่นๆ' },
];
```

> `constants.ts` already imports from `./types` (`ItemForm`), so adding the `DefectReasonValue` import is consistent.

- [ ] **Step 3: Update the existing receiving form seed + GR mutation to carry the new fields**

In `usePurchaseOrdersData.ts`, the `openReceiveModal` unit seed (currently lines 234-250) must include the two new fields so the rebuilt modal compiles:

```typescript
        units.push({
          poItemId: item.id,
          label: `${nameParts.join(' ')} #${item.receivedQty + i + 1}`,
          category: item.category || '',
          imeiSerial: '',
          serialNumber: '',
          status: 'PASS',
          rejectReason: '',
          defectReason: '',
          batteryHealth: '',
          warrantyExpired: false,
          warrantyExpireDate: '',
          hasBox: true,
          checklist: defaultChecklist.map((c) => ({ ...c, passed: true, note: '' })),
          sellingPrice: defaultPrice,
          photos: [],
          costPrice: '',
        });
```

In the existing `goodsReceivingMutation` payload map (currently lines 130-149), send `defectReason` + `photos` on REJECT/PASS:

```typescript
          return {
            poItemId: i.poItemId,
            imeiSerial: i.imeiSerial || undefined,
            serialNumber: i.serialNumber || undefined,
            status: i.status,
            rejectReason: i.status === 'REJECT' ? i.rejectReason || undefined : undefined,
            defectReason: i.status === 'REJECT' ? i.defectReason || undefined : undefined,
            photos: i.photos.length ? i.photos : undefined,
            ...(isUsed && i.status === 'PASS' ? {
              batteryHealth: i.batteryHealth ? Number(i.batteryHealth) : undefined,
              warrantyExpired: i.warrantyExpired,
              warrantyExpireDate: !i.warrantyExpired && i.warrantyExpireDate ? i.warrantyExpireDate : undefined,
              hasBox: i.hasBox,
              checklistResults: i.checklist.map(({ item, category, passed, note }) => ({
                item, category, passed, ...(note ? { note } : {}),
              })),
            } : {}),
            ...(i.status === 'PASS' && i.sellingPrice ? { sellingPrice: Number(i.sellingPrice) } : {}),
          };
```

- [ ] **Step 4: Add direct-receive state + mutation**

In `usePurchaseOrdersData.ts`, add state near the other modal flags (after `isReceiveModalOpen`, ~line 16):

```typescript
  const [isDirectReceiveOpen, setIsDirectReceiveOpen] = useState(false);
  const [directLines, setDirectLines] = useState<DirectReceiveLineForm[]>([]);
  const [directSupplierId, setDirectSupplierId] = useState('');
  const [directNotes, setDirectNotes] = useState('');
```

Import the new type at the top:

```typescript
import { PurchaseOrder, PODetail, ReceivingUnitForm, DirectReceiveLineForm } from '../types';
```

Add the mutation (after `goodsReceivingMutation`, ~line 160). It accepts already-expanded units (the modal expands lines → units), each unit carrying its own `costPrice`:

```typescript
  const directReceiveMutation = useMutation({
    mutationFn: async ({ supplierId, orderDate, notes, items }: { supplierId: string; orderDate: string; notes?: string; items: ReceivingUnitForm[] }) =>
      api.post('/purchase-orders/direct-receive', {
        supplierId,
        orderDate,
        notes: notes || undefined,
        items: items.map((i) => {
          const isUsed = i.category === 'PHONE_USED';
          return {
            category: i.category || undefined,
            // brand/model parsed from the line label is fragile; the modal sets these explicitly (Step in Task 4)
            brand: i.brand || undefined,
            model: i.model || undefined,
            color: i.color || undefined,
            storage: i.storage || undefined,
            accessoryType: i.accessoryType || undefined,
            accessoryBrand: i.accessoryBrand || undefined,
            quantity: 1,
            unitPrice: Number(i.costPrice),
            imeiSerial: i.imeiSerial || undefined,
            serialNumber: i.serialNumber || undefined,
            status: i.status,
            rejectReason: i.status === 'REJECT' ? i.rejectReason || undefined : undefined,
            defectReason: i.status === 'REJECT' ? i.defectReason || undefined : undefined,
            photos: i.photos.length ? i.photos : undefined,
            ...(isUsed && i.status === 'PASS' ? {
              batteryHealth: i.batteryHealth ? Number(i.batteryHealth) : undefined,
              warrantyExpired: i.warrantyExpired,
              warrantyExpireDate: !i.warrantyExpired && i.warrantyExpireDate ? i.warrantyExpireDate : undefined,
              hasBox: i.hasBox,
              checklistResults: i.checklist.map(({ item, category, passed, note }) => ({ item, category, passed, ...(note ? { note } : {}) })),
            } : {}),
            ...(i.status === 'PASS' && i.sellingPrice ? { sellingPrice: Number(i.sellingPrice) } : {}),
          };
        }),
      }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      const d = res.data;
      toast.success(`รับเข้าตรงสำเร็จ (${d.poNumber}): ผ่าน ${d.passed} ชิ้น, ไม่ผ่าน ${d.rejected} ชิ้น → รอ QC ที่คลัง ${d.mainWarehouse}`);
      setIsDirectReceiveOpen(false);
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });
```

> NOTE: the six optional product attrs (`brand?/model?/color?/storage?/accessoryType?/accessoryBrand?`) the mutation reads above are **already declared on `ReceivingUnitForm` in Step 1** of this task — no further interface edit needed here. PO-based seeds leave them undefined (the PO unit derives its name from the PO line); direct-receive seeds (Task 4 `lineToUnits`) set them.

Add the openers (after `openReceiveModal`, ~line 254):

```typescript
  const openDirectReceive = () => {
    setDirectSupplierId('');
    setDirectNotes('');
    setDirectLines([{ category: 'PHONE_NEW', brand: '', model: '', color: '', storage: '', accessoryType: '', accessoryBrand: '', quantity: '1', costPrice: '' }]);
    setIsDirectReceiveOpen(true);
  };
```

- [ ] **Step 5: Export the new symbols from the hook**

In the hook's `return { ... }` (lines 356-414), add:

```typescript
    directReceiveMutation,
    isDirectReceiveOpen,
    setIsDirectReceiveOpen,
    directLines,
    setDirectLines,
    directSupplierId,
    setDirectSupplierId,
    directNotes,
    setDirectNotes,
    openDirectReceive,
```

- [ ] **Step 6: Write the vitest payload-shape test (genuine value — the map() drops/keeps fields conditionally)**

Create `apps/web/src/pages/PurchaseOrdersPage/hooks/usePurchaseOrdersData.test.tsx`. We test the **pure payload transform** by extracting it. To make it testable without React, add an exported pure helper alongside the hook file:

In `usePurchaseOrdersData.ts`, export a pure builder used by the mutation (refactor the `items.map` body into it, then call it from `directReceiveMutation`):

```typescript
export function buildDirectReceiveItem(i: ReceivingUnitForm) {
  const isUsed = i.category === 'PHONE_USED';
  return {
    category: i.category || undefined,
    brand: i.brand || undefined,
    model: i.model || undefined,
    color: i.color || undefined,
    storage: i.storage || undefined,
    accessoryType: i.accessoryType || undefined,
    accessoryBrand: i.accessoryBrand || undefined,
    quantity: 1,
    unitPrice: Number(i.costPrice),
    imeiSerial: i.imeiSerial || undefined,
    serialNumber: i.serialNumber || undefined,
    status: i.status,
    rejectReason: i.status === 'REJECT' ? i.rejectReason || undefined : undefined,
    defectReason: i.status === 'REJECT' ? i.defectReason || undefined : undefined,
    photos: i.photos.length ? i.photos : undefined,
    ...(isUsed && i.status === 'PASS' ? {
      batteryHealth: i.batteryHealth ? Number(i.batteryHealth) : undefined,
      warrantyExpired: i.warrantyExpired,
      warrantyExpireDate: !i.warrantyExpired && i.warrantyExpireDate ? i.warrantyExpireDate : undefined,
      hasBox: i.hasBox,
      checklistResults: i.checklist.map(({ item, category, passed, note }) => ({ item, category, passed, ...(note ? { note } : {}) })),
    } : {}),
    ...(i.status === 'PASS' && i.sellingPrice ? { sellingPrice: Number(i.sellingPrice) } : {}),
  };
}
```

Then in `directReceiveMutation`, replace the inline `items: items.map((i) => { ... })` with `items: items.map(buildDirectReceiveItem)`.

Now the test:

```typescript
import { describe, it, expect } from 'vitest';
import { buildDirectReceiveItem } from './usePurchaseOrdersData';
import type { ReceivingUnitForm } from '../types';

const baseUnit = (over: Partial<ReceivingUnitForm>): ReceivingUnitForm => ({
  poItemId: '', label: '', category: 'PHONE_NEW', imeiSerial: '', serialNumber: '',
  status: 'PASS', rejectReason: '', defectReason: '', batteryHealth: '', warrantyExpired: false,
  warrantyExpireDate: '', hasBox: true, checklist: [], sellingPrice: '', photos: [], costPrice: '0',
  ...over,
});

describe('buildDirectReceiveItem', () => {
  it('sends costPrice as unitPrice and quantity 1; omits defectReason on PASS', () => {
    const out = buildDirectReceiveItem(baseUnit({ costPrice: '30000', imeiSerial: 'IMEI-1', sellingPrice: '39900', defectReason: 'SCREEN' }));
    expect(out.unitPrice).toBe(30000);
    expect(out.quantity).toBe(1);
    expect(out.sellingPrice).toBe(39900);
    expect(out.defectReason).toBeUndefined(); // PASS drops defectReason
    expect(out.imeiSerial).toBe('IMEI-1');
  });

  it('includes defectReason + rejectReason only on REJECT, drops sellingPrice', () => {
    const out = buildDirectReceiveItem(baseUnit({ status: 'REJECT', rejectReason: 'จอแตก', defectReason: 'SCREEN', sellingPrice: '39900', costPrice: '30000' }));
    expect(out.defectReason).toBe('SCREEN');
    expect(out.rejectReason).toBe('จอแตก');
    expect(out.sellingPrice).toBeUndefined();
  });

  it('attaches used-phone fields + checklistResults only for PHONE_USED PASS', () => {
    const out = buildDirectReceiveItem(baseUnit({ category: 'PHONE_USED', costPrice: '12000', imeiSerial: 'X', batteryHealth: '88', warrantyExpired: true, checklist: [{ item: 'จอ', category: 'ภายนอก', passed: true, note: '' }] }));
    expect(out.batteryHealth).toBe(88);
    expect(out.warrantyExpired).toBe(true);
    expect(out.checklistResults).toEqual([{ item: 'จอ', category: 'ภายนอก', passed: true }]);
  });

  it('includes photos only when present', () => {
    expect(buildDirectReceiveItem(baseUnit({ photos: [] })).photos).toBeUndefined();
    expect(buildDirectReceiveItem(baseUnit({ photos: ['data:img'] })).photos).toEqual(['data:img']);
  });
});
```

- [ ] **Step 7: Run the test + type-check**

Run: `cd apps/web && npx vitest run src/pages/PurchaseOrdersPage/hooks/usePurchaseOrdersData.test.tsx`
Expected: PASS (4 tests).
Run: `./tools/check-types.sh all`
Expected: 0 errors.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/pages/PurchaseOrdersPage/types.ts apps/web/src/pages/PurchaseOrdersPage/constants.ts apps/web/src/pages/PurchaseOrdersPage/hooks/usePurchaseOrdersData.ts apps/web/src/pages/PurchaseOrdersPage/hooks/usePurchaseOrdersData.test.tsx
git commit -m "feat(purchasing-web): direct-receive mutation + defectReason/photos in GR payload + payload-builder test"
```

---

### Task 3: Mobile-first rebuild of `GoodsReceivingModal` (Drawer on mobile, per-unit IMEI dup feedback, camera, defect select, progress)

**Files:**
- Modify: `apps/web/src/pages/PurchaseOrdersPage/components/GoodsReceivingModal.tsx` (mobile-first rebuild — desktop modal kept; mobile renders inside `Drawer`)
- Create: `apps/web/src/pages/PurchaseOrdersPage/components/ReceivingUnitCard.tsx` (the per-unit card, shared desktop + mobile)
- Create: `apps/web/src/pages/PurchaseOrdersPage/components/useReceivingDuplicates.ts` (pure hook computing in-batch IMEI duplicate set)
- Create: `apps/web/src/pages/PurchaseOrdersPage/components/useReceivingDuplicates.test.ts` (vitest — the dup logic)
- Modify: `apps/web/src/pages/PurchaseOrdersPage/index.tsx` (pass new props if signature changes — verify)

**Interfaces:**
- Produces:
  - `useReceivingDuplicates(units: ReceivingUnitForm[]): Set<number>` — returns the set of unit **indices** whose non-empty `imeiSerial` collides with another PASS unit's IMEI (live in-batch dup detection mirroring the backend `'พบ IMEI ซ้ำกันในรายการ'` guard at [po-receiving.service.ts:209](../../../apps/api/src/modules/purchase-orders/services/po-receiving.service.ts)).
  - `ReceivingUnitCard` props: `{ unit: ReceivingUnitForm; idx: number; isDuplicate: boolean; updateReceivingUnit; updateChecklist; onAddPhotos: (idx, files: FileList) => void; onRemovePhoto: (idx, photoIdx) => void }`.
- Consumes: `Drawer`, `DrawerContent`, `DrawerHeader`, `DrawerTitle`, `DrawerFooter` from `@/components/ui/drawer`; `useIsMobile`; `checklistCategories`, `defectReasonOptions`; `ThaiDateInput`.

- [ ] **Step 1: Write the dup-logic vitest test first**

Create `useReceivingDuplicates.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { computeDuplicateIndices } from './useReceivingDuplicates';
import type { ReceivingUnitForm } from '../types';

const u = (over: Partial<ReceivingUnitForm>): ReceivingUnitForm => ({
  poItemId: '', label: '', category: 'PHONE_NEW', imeiSerial: '', serialNumber: '',
  status: 'PASS', rejectReason: '', defectReason: '', batteryHealth: '', warrantyExpired: false,
  warrantyExpireDate: '', hasBox: true, checklist: [], sellingPrice: '', photos: [], costPrice: '',
  ...over,
});

describe('computeDuplicateIndices', () => {
  it('flags both PASS units that share an IMEI', () => {
    const set = computeDuplicateIndices([u({ imeiSerial: 'A' }), u({ imeiSerial: 'A' }), u({ imeiSerial: 'B' })]);
    expect([...set].sort()).toEqual([0, 1]);
  });

  it('ignores empty IMEIs and REJECT units', () => {
    const set = computeDuplicateIndices([u({ imeiSerial: '' }), u({ imeiSerial: '' }), u({ status: 'REJECT', imeiSerial: 'A' }), u({ imeiSerial: 'A' })]);
    expect(set.size).toBe(0);
  });

  it('is case/space-insensitive', () => {
    const set = computeDuplicateIndices([u({ imeiSerial: ' a1 ' }), u({ imeiSerial: 'A1' })]);
    expect([...set].sort()).toEqual([0, 1]);
  });
});
```

- [ ] **Step 2: Implement `useReceivingDuplicates.ts`**

```typescript
import { useMemo } from 'react';
import type { ReceivingUnitForm } from '../types';

/** Pure: indices of PASS units whose normalized IMEI collides with another PASS unit. */
export function computeDuplicateIndices(units: ReceivingUnitForm[]): Set<number> {
  const seen = new Map<string, number[]>();
  units.forEach((unit, idx) => {
    if (unit.status !== 'PASS') return;
    const key = unit.imeiSerial.trim().toLowerCase();
    if (!key) return;
    const arr = seen.get(key) ?? [];
    arr.push(idx);
    seen.set(key, arr);
  });
  const dupes = new Set<number>();
  for (const arr of seen.values()) {
    if (arr.length > 1) arr.forEach((i) => dupes.add(i));
  }
  return dupes;
}

export function useReceivingDuplicates(units: ReceivingUnitForm[]): Set<number> {
  return useMemo(() => computeDuplicateIndices(units), [units]);
}
```

- [ ] **Step 3: Run the dup test**

Run: `cd apps/web && npx vitest run src/pages/PurchaseOrdersPage/components/useReceivingDuplicates.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 4: Build `ReceivingUnitCard.tsx` (big touch targets, camera capture, defect select, dup banner)**

This card replaces the inline per-unit JSX of the old modal and is reused on desktop + mobile. Camera capture uses `capture="environment"` + the base64 `FileReader` pattern from `PaymentModal.tsx:283-294`.

```tsx
import { ReceivingUnitForm, DefectReasonValue } from '../types';
import { checklistCategories, defectReasonOptions } from '../constants';
import ThaiDateInput from '@/components/ui/ThaiDateInput';
import { Camera, X, AlertTriangle } from 'lucide-react';

export interface ReceivingUnitCardProps {
  unit: ReceivingUnitForm;
  idx: number;
  isDuplicate: boolean;
  showCostPrice?: boolean; // direct-receive only
  updateReceivingUnit: (idx: number, field: string, value: string) => void;
  updateChecklist: (unitIdx: number, checkIdx: number, field: 'passed' | 'note', value: boolean | string) => void;
  onAddPhotos: (idx: number, files: FileList) => void;
  onRemovePhoto: (idx: number, photoIdx: number) => void;
}

// 44px-min touch targets per .claude/rules (mobile). Tokens only — no gray/hex/bg-white.
const segBtn = 'min-h-11 px-4 rounded-lg text-sm font-medium transition-colors';
const fieldInput = 'w-full min-h-11 px-3 py-2 border border-input rounded-lg text-sm focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-hidden';

export function ReceivingUnitCard({ unit, idx, isDuplicate, showCostPrice, updateReceivingUnit, updateChecklist, onAddPhotos, onRemovePhoto }: ReceivingUnitCardProps) {
  const isUsed = unit.category === 'PHONE_USED';
  const isAccessory = unit.category === 'ACCESSORY';
  return (
    <div className={`border rounded-xl p-3 leading-snug ${unit.status === 'REJECT' ? 'border-destructive/30 bg-destructive/5' : isDuplicate ? 'border-warning/50 bg-warning/5' : 'border-border bg-card'}`}>
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="text-sm font-medium leading-snug">{unit.label}</span>
        <div className="flex gap-1.5">
          <button type="button" onClick={() => updateReceivingUnit(idx, 'status', 'PASS')}
            className={`${segBtn} ${unit.status === 'PASS' ? 'bg-success text-success-foreground' : 'bg-muted text-muted-foreground hover:bg-success/10'}`}>ผ่าน</button>
          <button type="button" onClick={() => updateReceivingUnit(idx, 'status', 'REJECT')}
            className={`${segBtn} ${unit.status === 'REJECT' ? 'bg-destructive text-destructive-foreground' : 'bg-muted text-muted-foreground hover:bg-destructive/10'}`}>ไม่ผ่าน</button>
        </div>
      </div>

      {showCostPrice && unit.status === 'PASS' && (
        <div className="mb-2">
          <label className="block text-xs text-muted-foreground mb-0.5 leading-snug">ราคาทุน (บาท) <span className="text-destructive">*</span></label>
          <input type="number" min="0" inputMode="decimal" value={unit.costPrice}
            onChange={(e) => updateReceivingUnit(idx, 'costPrice', e.target.value)} required className={fieldInput} placeholder="เช่น 30000" />
        </div>
      )}

      {!isAccessory && unit.status === 'PASS' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div>
            <label className="block text-xs text-muted-foreground mb-0.5 leading-snug">IMEI <span className="text-destructive">*</span></label>
            <input type="text" inputMode="numeric" value={unit.imeiSerial}
              onChange={(e) => updateReceivingUnit(idx, 'imeiSerial', e.target.value)} required
              className={`${fieldInput} font-mono ${isDuplicate ? 'border-warning' : ''}`} placeholder="IMEI" />
            {isDuplicate && (
              <p className="mt-1 flex items-center gap-1 text-xs text-warning leading-snug"><AlertTriangle className="size-3.5 shrink-0" /> IMEI ซ้ำกับเครื่องอื่นในรายการนี้</p>
            )}
          </div>
          <div>
            <label className="block text-xs text-muted-foreground mb-0.5 leading-snug">หมายเลขซีเรียล <span className="text-destructive">*</span></label>
            <input type="text" value={unit.serialNumber}
              onChange={(e) => updateReceivingUnit(idx, 'serialNumber', e.target.value)} required className={`${fieldInput} font-mono`} placeholder="หมายเลขซีเรียล" />
          </div>
        </div>
      )}

      {/* Camera photo capture (mobile rear camera via capture attr) */}
      {unit.status === 'PASS' && (
        <div className="mt-2">
          <label className="block text-xs text-muted-foreground mb-1 leading-snug">รูปถ่ายเครื่อง</label>
          <div className="flex flex-wrap gap-2">
            {unit.photos.map((p, pIdx) => (
              <div key={pIdx} className="relative size-16 rounded-lg overflow-hidden border">
                <img src={p} alt={`รูป ${pIdx + 1}`} className="size-full object-cover" />
                <button type="button" onClick={() => onRemovePhoto(idx, pIdx)}
                  className="absolute top-0.5 right-0.5 size-5 bg-destructive text-destructive-foreground rounded-full flex items-center justify-center"><X className="size-3" /></button>
              </div>
            ))}
            <label className="size-16 border-2 border-dashed border-input rounded-lg flex flex-col items-center justify-center cursor-pointer hover:border-primary/60 hover:bg-primary/5 transition-colors">
              <Camera className="size-5 text-muted-foreground" />
              <span className="text-[10px] text-muted-foreground leading-snug">ถ่ายรูป</span>
              <input type="file" accept="image/*" capture="environment" multiple className="hidden"
                onChange={(e) => { if (e.target.files?.length) onAddPhotos(idx, e.target.files); e.target.value = ''; }} />
            </label>
          </div>
        </div>
      )}

      {isUsed && unit.status === 'PASS' && (
        <div className="mt-2 border border-warning/20 bg-warning/5 dark:bg-warning/10 rounded-xl p-3 space-y-2">
          <div className="text-xs font-medium text-warning mb-1 leading-snug">ข้อมูลมือสอง</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div>
              <label className="block text-xs text-muted-foreground mb-0.5 leading-snug">% แบตเตอรี่ <span className="text-destructive">*</span></label>
              <input type="number" inputMode="numeric" min="0" max="100" value={unit.batteryHealth}
                onChange={(e) => updateReceivingUnit(idx, 'batteryHealth', e.target.value)} required className={fieldInput} placeholder="เช่น 87" />
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-0.5 leading-snug">กล่อง</label>
              <div className="flex gap-2 mt-1">
                <button type="button" onClick={() => updateReceivingUnit(idx, 'hasBox', 'true')}
                  className={`${segBtn} ${unit.hasBox ? 'bg-success text-success-foreground' : 'bg-muted text-muted-foreground hover:bg-success/10'}`}>มีกล่อง</button>
                <button type="button" onClick={() => updateReceivingUnit(idx, 'hasBox', 'false')}
                  className={`${segBtn} ${!unit.hasBox ? 'bg-destructive text-destructive-foreground' : 'bg-muted text-muted-foreground hover:bg-destructive/10'}`}>ไม่มีกล่อง</button>
              </div>
            </div>
          </div>
          <div>
            <label className="block text-xs text-muted-foreground mb-0.5 leading-snug">ประกันศูนย์ <span className="text-destructive">*</span></label>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-1.5 cursor-pointer min-h-11">
                <input type="checkbox" checked={unit.warrantyExpired}
                  onChange={(e) => updateReceivingUnit(idx, 'warrantyExpired', e.target.checked ? 'true' : 'false')} className="rounded size-4" />
                <span className="text-xs text-muted-foreground leading-snug">หมดประกันแล้ว</span>
              </label>
              {!unit.warrantyExpired && (
                <ThaiDateInput value={unit.warrantyExpireDate}
                  onChange={(e) => updateReceivingUnit(idx, 'warrantyExpireDate', e.target.value)} required className={`flex-1 ${fieldInput}`} />
              )}
            </div>
          </div>
          <div className="mt-2 border-t border-warning/20 pt-2">
            <div className="text-xs font-medium text-warning mb-2 leading-snug">เช็คลิสต์ตรวจเครื่อง</div>
            {checklistCategories.map((cat) => (
              <div key={cat} className="mb-2">
                <div className="text-xs font-medium text-muted-foreground mb-1 leading-snug">{cat}</div>
                <div className="space-y-1">
                  {unit.checklist.map((c, checkIdx) => c.category !== cat ? null : (
                    <div key={checkIdx} className="flex items-center gap-2">
                      <button type="button" onClick={() => updateChecklist(idx, checkIdx, 'passed', !c.passed)}
                        className={`size-6 rounded flex items-center justify-center text-xs font-bold transition-colors ${c.passed ? 'bg-success text-success-foreground' : 'bg-destructive text-destructive-foreground'}`}>
                        {c.passed ? '✓' : '✗'}
                      </button>
                      <span className={`text-xs flex-1 leading-snug ${c.passed ? 'text-foreground' : 'text-destructive font-medium'}`}>{c.item}</span>
                      {!c.passed && (
                        <input type="text" placeholder="หมายเหตุ" value={c.note}
                          onChange={(e) => updateChecklist(idx, checkIdx, 'note', e.target.value)}
                          className="w-28 px-2 py-1.5 border border-destructive/30 rounded text-xs focus-visible:ring-1 focus-visible:ring-ring/30 outline-hidden" />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
            <div className="text-xs text-muted-foreground mt-1 leading-snug">ผ่าน {unit.checklist.filter((c) => c.passed).length}/{unit.checklist.length} รายการ</div>
          </div>
        </div>
      )}

      {unit.status === 'PASS' && (
        <div className="mt-2 border border-primary/20 bg-primary/5 dark:bg-primary/10 rounded-xl p-3">
          <label className="block text-xs text-muted-foreground mb-0.5 leading-snug">ราคาขาย (บาท) <span className="text-destructive">*</span></label>
          <input type="number" inputMode="decimal" min="0" value={unit.sellingPrice}
            onChange={(e) => updateReceivingUnit(idx, 'sellingPrice', e.target.value)} required className={fieldInput} placeholder="เช่น 15000" />
        </div>
      )}

      {unit.status === 'REJECT' && (
        <div className="mt-2 space-y-2">
          <div>
            <label className="block text-xs text-muted-foreground mb-0.5 leading-snug">สาเหตุที่ไม่ผ่าน <span className="text-destructive">*</span></label>
            <select value={unit.defectReason}
              onChange={(e) => updateReceivingUnit(idx, 'defectReason', e.target.value as DefectReasonValue)} required
              className={fieldInput}>
              <option value="">เลือกสาเหตุ…</option>
              {defectReasonOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <input type="text" placeholder="รายละเอียดเพิ่มเติม (ถ้ามี)" value={unit.rejectReason}
            onChange={(e) => updateReceivingUnit(idx, 'rejectReason', e.target.value)} className={fieldInput} />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Rebuild `GoodsReceivingModal.tsx` — desktop modal kept, mobile renders in `Drawer`, shared body**

Rewrite the file so the scrollable body (intro + progress + unit list + notes + footer buttons) is one `<Body/>` used by both the desktop overlay and the mobile `Drawer`. Add `progress` (passed/rejected/total) and per-unit dup highlighting. Add `onAddPhotos`/`onRemovePhoto` handlers that update `unit.photos` via the existing `setReceivingUnits`.

```tsx
import { UseMutationResult } from '@tanstack/react-query';
import { PurchaseOrder, ReceivingUnitForm } from '../types';
import { ReceivingUnitCard } from './ReceivingUnitCard';
import { useReceivingDuplicates } from './useReceivingDuplicates';
import { useIsMobile } from '@/hooks/useIsMobile';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { ChevronLeft } from 'lucide-react';

export interface GoodsReceivingModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedPO: PurchaseOrder | null;
  receivingUnits: ReceivingUnitForm[];
  setReceivingUnits: React.Dispatch<React.SetStateAction<ReceivingUnitForm[]>>;
  receivingNotes: string;
  setReceivingNotes: (value: string) => void;
  goodsReceivingMutation: UseMutationResult<unknown, unknown, { poId: string; items: ReceivingUnitForm[]; notes: string }, unknown>;
  updateReceivingUnit: (idx: number, field: string, value: string) => void;
  updateChecklist: (unitIdx: number, checkIdx: number, field: 'passed' | 'note', value: boolean | string) => void;
  handleGoodsReceiving: (e: React.FormEvent) => void;
}

const MAX_PHOTOS_PER_UNIT = 6;

export function GoodsReceivingModal(props: GoodsReceivingModalProps) {
  const { isOpen, onClose, selectedPO, receivingUnits, setReceivingUnits, receivingNotes, setReceivingNotes,
    goodsReceivingMutation, updateReceivingUnit, updateChecklist, handleGoodsReceiving } = props;
  const isMobile = useIsMobile();
  const dupIndices = useReceivingDuplicates(receivingUnits);

  const onAddPhotos = (idx: number, files: FileList) => {
    Array.from(files).slice(0, MAX_PHOTOS_PER_UNIT).forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => setReceivingUnits((prev) => {
        const next = [...prev];
        const cur = next[idx];
        if (cur.photos.length >= MAX_PHOTOS_PER_UNIT) return prev;
        next[idx] = { ...cur, photos: [...cur.photos, reader.result as string] };
        return next;
      });
      reader.readAsDataURL(file);
    });
  };
  const onRemovePhoto = (idx: number, photoIdx: number) => setReceivingUnits((prev) => {
    const next = [...prev];
    next[idx] = { ...next[idx], photos: next[idx].photos.filter((_, i) => i !== photoIdx) };
    return next;
  });

  const passCount = receivingUnits.filter((u) => u.status === 'PASS').length;
  const rejectCount = receivingUnits.filter((u) => u.status === 'REJECT').length;

  if (!isOpen) return null;

  const body = (
    <form onSubmit={handleGoodsReceiving} className="flex flex-col flex-1 overflow-hidden">
      {/* Sticky progress strip */}
      <div className="shrink-0 px-4 sm:px-6 py-3 border-b bg-background/95 backdrop-blur-xs">
        <div className="flex items-center justify-between text-sm leading-snug">
          <span className="text-muted-foreground">ตรวจรับ {receivingUnits.length} ชิ้น</span>
          <span className="flex gap-3">
            <span className="text-success">ผ่าน {passCount}</span>
            <span className="text-destructive">ไม่ผ่าน {rejectCount}</span>
          </span>
        </div>
        <div className="mt-2 h-1.5 w-full rounded-full bg-muted overflow-hidden flex">
          <div className="bg-success h-full" style={{ width: `${receivingUnits.length ? (passCount / receivingUnits.length) * 100 : 0}%` }} />
          <div className="bg-destructive h-full" style={{ width: `${receivingUnits.length ? (rejectCount / receivingUnits.length) * 100 : 0}%` }} />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-3">
        {receivingUnits.map((unit, idx) => (
          <ReceivingUnitCard key={idx} unit={unit} idx={idx} isDuplicate={dupIndices.has(idx)}
            updateReceivingUnit={updateReceivingUnit} updateChecklist={updateChecklist}
            onAddPhotos={onAddPhotos} onRemovePhoto={onRemovePhoto} />
        ))}
        {receivingUnits.length === 0 && (
          <div className="text-center py-8 text-muted-foreground text-sm leading-snug">ไม่มีรายการที่รอรับสินค้า</div>
        )}
        <div>
          <label className="block text-xs text-muted-foreground mb-1 leading-snug">หมายเหตุ</label>
          <textarea value={receivingNotes} onChange={(e) => setReceivingNotes(e.target.value)} rows={2}
            className="w-full px-3 py-2 border border-input rounded-lg text-sm leading-snug focus-visible:ring-2 focus-visible:ring-ring/30 outline-hidden" placeholder="บันทึกเพิ่มเติม…" />
        </div>
      </div>

      {/* Sticky footer */}
      <div className="shrink-0 border-t px-4 sm:px-6 py-3 flex gap-3 bg-background/95 backdrop-blur-xs">
        <button type="button" onClick={onClose} className="min-h-11 px-4 text-sm text-muted-foreground">ยกเลิก</button>
        <button type="submit" disabled={goodsReceivingMutation.isPending || receivingUnits.length === 0}
          className="flex-1 min-h-11 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors">
          {goodsReceivingMutation.isPending ? 'กำลังรับสินค้า…' : 'ยืนยันรับสินค้า'}
        </button>
      </div>
    </form>
  );

  if (isMobile) {
    return (
      <Drawer open={isOpen} onOpenChange={(o) => { if (!o) onClose(); }}>
        <DrawerContent className="h-[92dvh]">
          <DrawerHeader className="text-left">
            <DrawerTitle className="leading-snug">รับสินค้า — {selectedPO?.poNumber || ''}</DrawerTitle>
          </DrawerHeader>
          {body}
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-start justify-center pt-8 pb-8" role="dialog" aria-modal="true" aria-label="รับสินค้า">
      <div className="w-full max-w-3xl bg-background rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[calc(100vh-4rem)]">
        <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-xs border-b px-6 py-4 flex items-center justify-between shrink-0">
          <button type="button" onClick={onClose} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
            <ChevronLeft className="size-4" /> กลับ
          </button>
          <h2 className="text-lg font-semibold text-foreground leading-snug">รับสินค้า — {selectedPO?.poNumber || ''}</h2>
          <div className="w-16" />
        </div>
        {selectedPO && body}
      </div>
    </div>
  );
}
```

> The modal's public prop signature is **unchanged** (still the 11 props the parent passes at [index.tsx:222-234](../../../apps/web/src/pages/PurchaseOrdersPage/index.tsx)), so `index.tsx` needs **no** prop change. `setReceivingUnits` was already passed and is now actually used (photo handlers). `h-[92dvh]` uses dynamic viewport height (mobile-safe, matches the inbox-overhaul Batch-0 `h-dvh` pattern per memory).

- [ ] **Step 6: Verify no `index.tsx` change needed**

Run: `cd apps/web && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i "GoodsReceivingModal\|index.tsx" | head`
Expected: no errors referencing the modal/index (signature preserved). If `setReceivingUnits` type mismatches, it already matches `React.Dispatch<React.SetStateAction<ReceivingUnitForm[]>>` from the hook.

- [ ] **Step 7: Run all new web tests + type-check**

Run: `cd apps/web && npx vitest run src/pages/PurchaseOrdersPage`
Expected: PASS (both `useReceivingDuplicates.test.ts` + `usePurchaseOrdersData.test.tsx`).
Run: `./tools/check-types.sh all`
Expected: 0 errors.

- [ ] **Step 8: MANUAL verification (desktop + mobile viewport)**

Start the app (`npm run dev`), log in as `manager.ladprao@bestchoice.com / admin1234`, go to `/purchase-orders`, open an `APPROVED`/`ORDERED` PO with un-received items, click "รับสินค้า":
- **Desktop (≥1024px):** centered modal appears; progress strip shows `ตรวจรับ N ชิ้น / ผ่าน / ไม่ผ่าน` with a two-color bar. Type the same IMEI into two PASS units → both cards turn warning-bordered and show "IMEI ซ้ำกับเครื่องอื่นในรายการนี้". Switch a unit to ไม่ผ่าน → the defect `<select>` appears with the 8 Thai options; submit is allowed only when each REJECT has a defect (enforced by Task 4 validation). Confirm a PASS unit shows the camera tile + selling-price.
- **Mobile (DevTools device toolbar, e.g. iPhone 12, width <1024px):** the flow opens as a bottom-sheet `Drawer` filling ~92% of the dynamic viewport height with the drag handle; the per-unit segmented ผ่าน/ไม่ผ่าน buttons are ≥44px tall; the "ถ่ายรูป" tile opens the rear camera (`capture="environment"`) on a real device; the sticky footer "ยืนยันรับสินค้า" is full-width and reachable above the keyboard.
- Submit a small partial batch (e.g. 2 of 5) → toast "รับ+ตรวจสำเร็จ…", PO list shows progress; reopen and the remaining 3 are still receivable (partial-receive intact).

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/pages/PurchaseOrdersPage/components/GoodsReceivingModal.tsx apps/web/src/pages/PurchaseOrdersPage/components/ReceivingUnitCard.tsx apps/web/src/pages/PurchaseOrdersPage/components/useReceivingDuplicates.ts apps/web/src/pages/PurchaseOrdersPage/components/useReceivingDuplicates.test.ts
git commit -m "feat(purchasing-web): mobile-first receiving (Drawer + camera + IMEI dup feedback + defect select + progress)"
```

---

### Task 4: "รับเข้าตรง (supplier)" entry + `DirectReceiveModal` + REJECT-defect submit validation

**Files:**
- Create: `apps/web/src/pages/PurchaseOrdersPage/components/DirectReceiveModal.tsx` (line builder → expands to units → reuses `ReceivingUnitCard`)
- Modify: `apps/web/src/pages/PurchaseOrdersPage/index.tsx` (add the "รับเข้าตรง" button + mount `DirectReceiveModal`)
- Modify: `apps/web/src/pages/PurchaseOrdersPage/hooks/usePurchaseOrdersData.ts` (add `handleGoodsReceiving` defect validation + a `directUnits`/`setDirectUnits` derived state helper)

**Interfaces:**
- Consumes: `directReceiveMutation`, `isDirectReceiveOpen`, `setIsDirectReceiveOpen`, `directLines`, `setDirectLines`, `directSupplierId`, `setDirectSupplierId`, `directNotes`, `setDirectNotes`, `openDirectReceive` (Task 2); `suppliers` (already loaded); `ReceivingUnitCard`, `useReceivingDuplicates`, `defaultChecklist`, `useIsMobile`, `Drawer`.
- Produces: `DirectReceiveModal` (self-contained: builds units from lines on submit).

- [ ] **Step 1: Add REJECT-must-have-defect validation to the existing `handleGoodsReceiving`**

In `usePurchaseOrdersData.ts`, `handleGoodsReceiving` (lines 285-339) currently validates `rejectReason`. Replace the `missingReasons` check (lines 294-298) with a defect-reason check (the structured select is now the required field; free-text is optional):

```typescript
    const missingDefect = receivingUnits.filter((u) => u.status === 'REJECT' && !u.defectReason);
    if (missingDefect.length > 0) {
      toast.error('กรุณาเลือกสาเหตุที่ไม่ผ่าน (defect) สำหรับรายการที่ไม่ผ่าน');
      return;
    }
```

- [ ] **Step 2: Build `DirectReceiveModal.tsx`**

Two phases in one sheet: (1) pick supplier + add ad-hoc lines (category/brand/model/cost/qty); (2) "ถัดไป: ตรวจรับ" expands every line into `quantity` units and shows the `ReceivingUnitCard` grid with `showCostPrice`. On submit, validate cost + IMEI + defect, then call `directReceiveMutation`.

```tsx
import { useState } from 'react';
import { UseMutationResult } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ReceivingUnitForm, DirectReceiveLineForm } from '../types';
import { defaultChecklist } from '../constants';
import { ReceivingUnitCard } from './ReceivingUnitCard';
import { useReceivingDuplicates } from './useReceivingDuplicates';
import { useIsMobile } from '@/hooks/useIsMobile';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { Plus, Trash2, ChevronLeft } from 'lucide-react';

interface SupplierLite { id: string; name: string }

export interface DirectReceiveModalProps {
  isOpen: boolean;
  onClose: () => void;
  suppliers: SupplierLite[];
  supplierId: string;
  setSupplierId: (v: string) => void;
  lines: DirectReceiveLineForm[];
  setLines: React.Dispatch<React.SetStateAction<DirectReceiveLineForm[]>>;
  notes: string;
  setNotes: (v: string) => void;
  directReceiveMutation: UseMutationResult<{ data: { poNumber: string; passed: number; rejected: number; mainWarehouse: string } }, unknown, { supplierId: string; orderDate: string; notes?: string; items: ReceivingUnitForm[] }, unknown>;
}

const emptyLine: DirectReceiveLineForm = { category: 'PHONE_NEW', brand: '', model: '', color: '', storage: '', accessoryType: '', accessoryBrand: '', quantity: '1', costPrice: '' };
const fieldInput = 'w-full min-h-11 px-3 py-2 border border-input rounded-lg text-sm focus-visible:ring-2 focus-visible:ring-ring/30 outline-hidden';

function lineToUnits(line: DirectReceiveLineForm): ReceivingUnitForm[] {
  const qty = Math.max(1, Number(line.quantity) || 1);
  const isAccessory = line.category === 'ACCESSORY';
  const label = (isAccessory ? [line.accessoryType, line.accessoryBrand, line.model] : [line.brand, line.model, line.color, line.storage]).filter(Boolean).join(' ');
  return Array.from({ length: qty }, (_, i) => ({
    poItemId: '', label: `${label || 'สินค้า'} #${i + 1}`,
    category: line.category,
    brand: line.brand, model: line.model, color: line.color, storage: line.storage,
    accessoryType: line.accessoryType, accessoryBrand: line.accessoryBrand,
    imeiSerial: '', serialNumber: '', status: 'PASS', rejectReason: '', defectReason: '',
    batteryHealth: '', warrantyExpired: false, warrantyExpireDate: '', hasBox: true,
    checklist: defaultChecklist.map((c) => ({ ...c, passed: true, note: '' })),
    sellingPrice: '', photos: [], costPrice: line.costPrice,
  }));
}

export function DirectReceiveModal(props: DirectReceiveModalProps) {
  const { isOpen, onClose, suppliers, supplierId, setSupplierId, lines, setLines, notes, setNotes, directReceiveMutation } = props;
  const isMobile = useIsMobile();
  const [step, setStep] = useState<'lines' | 'inspect'>('lines');
  const [units, setUnits] = useState<ReceivingUnitForm[]>([]);
  const dupIndices = useReceivingDuplicates(units);

  if (!isOpen) return null;

  const updateLine = (idx: number, field: keyof DirectReceiveLineForm, value: string) =>
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, [field]: value } : l)));
  const updateUnit = (idx: number, field: string, value: string) =>
    setUnits((prev) => prev.map((u, i) => {
      if (i !== idx) return u;
      const boolFields = ['hasBox', 'warrantyExpired'];
      return { ...u, [field]: boolFields.includes(field) ? value === 'true' : value };
    }));
  const updateUnitChecklist = (unitIdx: number, checkIdx: number, field: 'passed' | 'note', value: boolean | string) =>
    setUnits((prev) => prev.map((u, i) => (i !== unitIdx ? u : { ...u, checklist: u.checklist.map((c, ci) => (ci === checkIdx ? { ...c, [field]: value } : c)) })));
  const onAddPhotos = (idx: number, files: FileList) => Array.from(files).slice(0, 6).forEach((file) => {
    const reader = new FileReader();
    reader.onload = () => setUnits((prev) => prev.map((u, i) => (i === idx && u.photos.length < 6 ? { ...u, photos: [...u.photos, reader.result as string] } : u)));
    reader.readAsDataURL(file);
  });
  const onRemovePhoto = (idx: number, photoIdx: number) =>
    setUnits((prev) => prev.map((u, i) => (i === idx ? { ...u, photos: u.photos.filter((_, p) => p !== photoIdx) } : u)));

  const goInspect = () => {
    if (!supplierId) { toast.error('กรุณาเลือกผู้ขาย (supplier)'); return; }
    const badCost = lines.find((l) => !(Number(l.costPrice) > 0));
    if (badCost) { toast.error('กรุณาระบุราคาทุนมากกว่า 0 ให้ครบทุกรายการ'); return; }
    setUnits(lines.flatMap(lineToUnits));
    setStep('inspect');
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const passUnits = units.filter((u) => u.status === 'PASS');
    if (passUnits.some((u) => u.category !== 'ACCESSORY' && !u.imeiSerial.trim())) { toast.error('กรุณาระบุ IMEI ให้ครบทุกเครื่องที่ผ่าน'); return; }
    if (passUnits.some((u) => !u.sellingPrice.trim() || Number(u.sellingPrice) <= 0)) { toast.error('กรุณาระบุราคาขายให้ครบทุกเครื่องที่ผ่าน'); return; }
    if (units.some((u) => u.status === 'REJECT' && !u.defectReason)) { toast.error('กรุณาเลือกสาเหตุที่ไม่ผ่านให้ครบ'); return; }
    if (dupIndices.size > 0) { toast.error('มี IMEI ซ้ำกันในรายการ กรุณาแก้ไขก่อนบันทึก'); return; }
    directReceiveMutation.mutate({ supplierId, orderDate: new Date().toISOString().split('T')[0], notes, items: units });
  };

  const linesBody = (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-3">
        <div>
          <label className="block text-xs text-muted-foreground mb-0.5 leading-snug">ผู้ขาย (supplier) <span className="text-destructive">*</span></label>
          <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className={fieldInput}>
            <option value="">เลือกผู้ขาย…</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        {lines.map((line, idx) => (
          <div key={idx} className="border border-border rounded-xl p-3 bg-card space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium leading-snug">รายการ #{idx + 1}</span>
              {lines.length > 1 && (
                <button type="button" onClick={() => setLines((p) => p.filter((_, i) => i !== idx))} className="text-destructive p-2"><Trash2 className="size-4" /></button>
              )}
            </div>
            <select value={line.category} onChange={(e) => updateLine(idx, 'category', e.target.value)} className={fieldInput}>
              <option value="PHONE_NEW">มือถือใหม่</option>
              <option value="PHONE_USED">มือถือมือสอง</option>
              <option value="TABLET">แท็บเล็ต</option>
              <option value="ACCESSORY">อุปกรณ์เสริม</option>
            </select>
            <div className="grid grid-cols-2 gap-2">
              <input value={line.brand} onChange={(e) => updateLine(idx, 'brand', e.target.value)} placeholder="ยี่ห้อ" className={fieldInput} />
              <input value={line.model} onChange={(e) => updateLine(idx, 'model', e.target.value)} placeholder="รุ่น" className={fieldInput} />
              <input value={line.color} onChange={(e) => updateLine(idx, 'color', e.target.value)} placeholder="สี" className={fieldInput} />
              <input value={line.storage} onChange={(e) => updateLine(idx, 'storage', e.target.value)} placeholder="ความจุ" className={fieldInput} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs text-muted-foreground mb-0.5 leading-snug">จำนวน</label>
                <input type="number" min="1" value={line.quantity} onChange={(e) => updateLine(idx, 'quantity', e.target.value)} className={fieldInput} />
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-0.5 leading-snug">ราคาทุน/ชิ้น <span className="text-destructive">*</span></label>
                <input type="number" min="0" value={line.costPrice} onChange={(e) => updateLine(idx, 'costPrice', e.target.value)} className={fieldInput} placeholder="เช่น 30000" />
              </div>
            </div>
          </div>
        ))}
        <button type="button" onClick={() => setLines((p) => [...p, { ...emptyLine }])}
          className="w-full min-h-11 border-2 border-dashed border-input rounded-lg text-sm text-muted-foreground hover:border-primary/60 hover:bg-primary/5 flex items-center justify-center gap-1.5"><Plus className="size-4" /> เพิ่มรายการ</button>
        <div>
          <label className="block text-xs text-muted-foreground mb-1 leading-snug">หมายเหตุ</label>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="w-full px-3 py-2 border border-input rounded-lg text-sm leading-snug outline-hidden" placeholder="บันทึกเพิ่มเติม…" />
        </div>
      </div>
      <div className="shrink-0 border-t px-4 sm:px-6 py-3 flex gap-3 bg-background/95">
        <button type="button" onClick={onClose} className="min-h-11 px-4 text-sm text-muted-foreground">ยกเลิก</button>
        <button type="button" onClick={goInspect} className="flex-1 min-h-11 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90">ถัดไป: ตรวจรับ</button>
      </div>
    </div>
  );

  const inspectBody = (
    <form onSubmit={submit} className="flex flex-col flex-1 overflow-hidden">
      <div className="shrink-0 px-4 sm:px-6 py-2 border-b">
        <button type="button" onClick={() => setStep('lines')} className="flex items-center gap-1 text-sm text-muted-foreground"><ChevronLeft className="size-4" /> กลับไปแก้รายการ</button>
      </div>
      <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-3">
        {units.map((unit, idx) => (
          <ReceivingUnitCard key={idx} unit={unit} idx={idx} isDuplicate={dupIndices.has(idx)} showCostPrice
            updateReceivingUnit={updateUnit} updateChecklist={updateUnitChecklist} onAddPhotos={onAddPhotos} onRemovePhoto={onRemovePhoto} />
        ))}
      </div>
      <div className="shrink-0 border-t px-4 sm:px-6 py-3 flex gap-3 bg-background/95">
        <button type="submit" disabled={directReceiveMutation.isPending}
          className="flex-1 min-h-11 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50">
          {directReceiveMutation.isPending ? 'กำลังรับเข้า…' : 'ยืนยันรับเข้าตรง'}
        </button>
      </div>
    </form>
  );

  const body = step === 'lines' ? linesBody : inspectBody;
  const title = step === 'lines' ? 'รับเข้าตรง — เพิ่มรายการ' : 'รับเข้าตรง — ตรวจรับ';

  if (isMobile) {
    return (
      <Drawer open={isOpen} onOpenChange={(o) => { if (!o) onClose(); }}>
        <DrawerContent className="h-[92dvh]">
          <DrawerHeader className="text-left"><DrawerTitle className="leading-snug">{title}</DrawerTitle></DrawerHeader>
          {body}
        </DrawerContent>
      </Drawer>
    );
  }
  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-start justify-center pt-8 pb-8" role="dialog" aria-modal="true" aria-label="รับเข้าตรง">
      <div className="w-full max-w-3xl bg-background rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[calc(100vh-4rem)]">
        <div className="sticky top-0 z-10 bg-background/95 border-b px-6 py-4 flex items-center justify-between shrink-0">
          <h2 className="text-lg font-semibold text-foreground leading-snug">{title}</h2>
          <button type="button" onClick={onClose} className="text-sm text-muted-foreground hover:text-foreground">ปิด</button>
        </div>
        {body}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Wire the "รับเข้าตรง" button + mount the modal in `index.tsx`**

In `index.tsx`, add the import:

```typescript
import { DirectReceiveModal } from './components/DirectReceiveModal';
```

Add a "รับเข้าตรง (supplier)" button to the header action, next to "+ สร้าง PO" (after line 107):

```tsx
            <button
              onClick={data.openDirectReceive}
              className="px-4 py-2 border border-input rounded-lg text-sm font-medium hover:bg-muted transition-colors"
            >
              รับเข้าตรง (supplier)
            </button>
```

Mount the modal (after the `<GoodsReceivingModal .../>` block, ~line 234):

```tsx
      <DirectReceiveModal
        isOpen={data.isDirectReceiveOpen}
        onClose={() => data.setIsDirectReceiveOpen(false)}
        suppliers={data.suppliers}
        supplierId={data.directSupplierId}
        setSupplierId={data.setDirectSupplierId}
        lines={data.directLines}
        setLines={data.setDirectLines}
        notes={data.directNotes}
        setNotes={data.setDirectNotes}
        directReceiveMutation={data.directReceiveMutation}
      />
```

> `data.suppliers` is `{ id; name; ... }[]` — assignable to `SupplierLite[]` (structural subtype). The mutation's generic result type matches `directReceiveMutation` from Task 2 (both `{ data: { poNumber; passed; rejected; mainWarehouse } }`).

- [ ] **Step 4: Type-check**

Run: `./tools/check-types.sh all`
Expected: 0 errors.

- [ ] **Step 5: MANUAL verification (desktop + mobile viewport)**

On `/purchase-orders` as `manager.ladprao@bestchoice.com`:
- Click "รับเข้าตรง (supplier)". **Desktop:** modal opens at the "เพิ่มรายการ" step. Pick a supplier, add a line (มือถือใหม่, ยี่ห้อ Apple, รุ่น iPhone 16, จำนวน 2, ราคาทุน 30000), click "ถัดไป: ตรวจรับ" → 2 unit cards appear, each showing **ราคาทุน** (pre-filled 30000), IMEI, selling-price, camera. Enter IMEIs + selling prices, submit → toast "รับเข้าตรงสำเร็จ (PO-YYYY-MM-NNN): ผ่าน 2 ชิ้น…". Verify in the PO list a new PO appears badged as direct-receive (B1 badge consumes `isDirectReceive`) at `FULLY_RECEIVED`.
- Try submitting with cost 0 on a line → blocked with "กรุณาระบุราคาทุนมากกว่า 0…". Set one unit to ไม่ผ่าน without picking a defect → blocked with "กรุณาเลือกสาเหตุที่ไม่ผ่านให้ครบ". Enter duplicate IMEIs on two units → both flagged + submit blocked.
- **Mobile (<1024px):** the whole flow is a bottom-sheet `Drawer` at ~92dvh; "เพิ่มรายการ" / "ถัดไป: ตรวจรับ" / "ยืนยันรับเข้าตรง" are full-width ≥44px; camera tile opens rear camera on device.
- Confirm an `AuditLog` row `PO_DIRECT_RECEIVE_APPROVAL_BYPASS` exists (check `/audit-logs` as OWNER, filter entity `purchase_order`).

- [ ] **Step 6: Run the full web PO test folder + backend PO suite once more**

Run: `cd apps/web && npx vitest run src/pages/PurchaseOrdersPage`
Expected: PASS.
Run: `cd apps/api && npx jest --runInBand src/modules/purchase-orders`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/pages/PurchaseOrdersPage/components/DirectReceiveModal.tsx apps/web/src/pages/PurchaseOrdersPage/index.tsx apps/web/src/pages/PurchaseOrdersPage/hooks/usePurchaseOrdersData.ts
git commit -m "feat(purchasing-web): supplier-direct receive entry (auto-PO) + REJECT defect-required validation"
```

---

## Self-Review

**Spec coverage (B3 items):**
- (A) Backend `POST /purchase-orders/direct-receive` auto-PO in ONE Serializable `$transaction` → Task 1 (`directReceive()` wraps create-PO + `update` to `ORDERED` + `runReceiveInTx`, all in `prisma.$transaction(..., Serializable)`). ✅
- (A) create real PO `isDirectReceive=true`, `unitPrice=costPrice`, supplier required → Task 1 Step 5 (PO `create` with `isDirectReceive: true`, items `unitPrice: i.unitPrice`, supplier `findUnique` guard). ✅
- (A) advance `APPROVED → ORDERED` bypassing OWNER approval gate + `AuditLog` for the bypass → Task 1 Step 5 (PO starts `APPROVED`, `update` to `ORDERED`+`orderedAt`, `tx.auditLog.create({ action: 'PO_DIRECT_RECEIVE_APPROVAL_BYPASS', entity: 'purchase_order', ... })` — mirrors trade-in's `auditLog.create`, no cross-module import). ✅
- (A) then run EXISTING `goodsReceiving()` logic to create GR (+grNumber from B0) + products → Task 1 Step 6 extracts the shared `runReceiveInTx(tx,...)` so both flows use the identical pipeline incl. the B0 `grNumber`. ✅
- (A) `DirectReceiveDto` requires `supplierId` + per-line `costPrice` + product attrs + per-unit receiving fields → Task 1 Step 3. ✅
- (A) DTO + lifecycle/receiving method + facade + controller wired → Task 1 Steps 3,5,7,8. ✅
- (A) `costPrice` MANDATORY+validated (COGS reads it) → Task 1 Step 3 (`@Min(0.01)` Thai message) + Step 5 (up-front `badCost` guard) + test (zero-cost rejected). ✅
- (A) NO JE → Task 1 (only `purchaseOrder`/`auditLog`/`goodsReceiving`/`product`/`productPrice`/`pOItem` writes; zero JournalEntry/Expense; module stays `imports: []`). ✅ (Global Constraints red line.)
- (B) mobile-first rebuild of `GoodsReceivingModal` using `Drawer` (bottom-sheet) + `useIsMobile` → Task 3 Step 5. ✅
- (B) per-unit IMEI entry with duplicate feedback → Task 3 Steps 1-2 (`computeDuplicateIndices`/`useReceivingDuplicates`) + Step 4 card warning banner + tested. ✅
- (B) camera photo capture (`capture` attribute) → Task 3 Step 4 (`<input type="file" accept="image/*" capture="environment">` + base64 handler). ✅
- (B) checklist for used phones → Task 3 Step 4 (preserved `PHONE_USED` checklist block). ✅
- (B) PASS/REJECT with structured DEFECT REASON select (`DefectReason` enum from B0) → Task 3 Step 4 (`<select>` from `defectReasonOptions`) + Task 4 Step 1 submit validation; backend persists via Task 1 Step 4. ✅
- (B) partial-receive progress + big touch targets → Task 3 Step 5 (progress strip + two-color bar; `min-h-11` ≥44px buttons). ✅
- (B) "รับเข้าตรง (supplier)" entry calling the new endpoint → Task 4 (`DirectReceiveModal` + header button + `directReceiveMutation`). ✅
- (B) auto-POs badged in the list → consumed via `isDirectReceive` (B1 owns the badge; B0 shipped the column; this batch sets it). ✅ (cross-batch, noted.)

**Placeholder scan:** No "TBD/TODO/implement later". The only "…" prose is the explicit paste instruction in Task 1 Step 6 — and that step quotes the exact source line range (144-349), the three required edits, and the surrounding method skeleton verbatim, so it is a mechanical copy, not a placeholder. Every other code/test block is complete.

**Type/prop-name consistency:**
- `ReceivingUnitForm` gains `defectReason: DefectReasonValue | ''`, `photos: string[]`, `costPrice: string`, and six optional product attrs (`brand?/model?/color?/storage?/accessoryType?/accessoryBrand?`) — defined once in Task 2 Step 1, used by `openReceiveModal` seed (Task 2 Step 3), `buildDirectReceiveItem` (Task 2 Step 6), `ReceivingUnitCard` (Task 3 Step 4), `lineToUnits` (Task 4 Step 2). Consistent.
- `DefectReasonValue` (8 values) ≡ B0 Prisma `DefectReason` enum values (SCREEN/BATTERY/IMEI_BLOCKED/BOX_MISSING/WRONG_MODEL/DOA/COSMETIC/OTHER). `defectReasonOptions` keyed on the same union.
- `directReceive(dto, userId)` signature identical across receiving service / facade / controller; result `{ poId; poNumber; receivingId; grNumber; status; passed; rejected; products; mainWarehouse }` consumed by `directReceiveMutation.onSuccess` (`poNumber/passed/rejected/mainWarehouse`).
- `DirectReceiveModal` prop `directReceiveMutation` generic result type `{ data: { poNumber; passed; rejected; mainWarehouse } }` matches the hook's mutation declaration in Task 2.
- `computeDuplicateIndices`/`useReceivingDuplicates` return `Set<number>` (unit indices) used uniformly in both modals via `dupIndices.has(idx)`.

**Deviations found vs spec wording:**
1. **`runReceiveInTx` extraction.** The spec says "runs the EXISTING `goodsReceiving()` logic." Calling the public `goodsReceiving()` from inside `directReceive()` would open a **nested** `$transaction` (it starts its own Serializable tx), which the auto-PO requires to be the SAME tx for atomicity. I therefore extract the pipeline into a private `runReceiveInTx(tx,...)` and have both `goodsReceiving()` and `directReceive()` call it within their own single tx. This preserves byte-identical logic (verified by re-running the B0 race/IMEI specs in Task 1 Step 10) while honoring "ONE Serializable `$transaction`." Documented here as the one structural deviation.
2. **`'ORDERED'` added to the receive status allow-list.** The current guard allows `APPROVED`/`PARTIALLY_RECEIVED` only. A direct-receive auto-PO is `ORDERED` at receive time, and B0 added `ORDERED` as a valid pre-receive state, so I add `'ORDERED'` to the allow-list in `runReceiveInTx`. Additive — no existing case regresses (both legacy states still pass). This also lets a B0-`ORDERED` standard PO be received, matching the spec state machine ("Receiving is allowed from `ORDERED` or `APPROVED`").
3. **B0-assumed fields.** `DefectReason` enum, `grNumber` (+`generateGRNumber`), `isDirectReceive`, `orderedAt`, and the retirement of legacy `receive()`/`ReceivePODto` all land in B0. If executed before B0 merges, Steps that touch the `dto`/import lines (Task 1 Step 3 note, Task 1 Step 5 note, Task 1 Step 7 note) flag the reconciliation. Per the plan brief, B0 is assumed shipped.
4. **No new migration.** B3 adds zero schema; all columns/enums are B0's. (Spec's "Data model — additive migrations only" is fully consumed by B0.)
