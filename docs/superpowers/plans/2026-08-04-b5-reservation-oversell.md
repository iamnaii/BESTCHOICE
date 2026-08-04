# B5 — จองจากเว็บ ↔ ทีมขาย (กันขายซ้ำ + แจ้งเตือน) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ปิดรูขายซ้ำระหว่างเว็บกับหน้าร้านให้ครบทุกทาง — เงินเข้าแล้วต้องได้ของ หรือถ้าไม่ได้ต้องเข้าคิวคืนเงินทันที ไม่มีเคสเงียบ; ทีมขายเห็น hold ของเว็บและมีงานค้างขึ้น badge ภายใน 30 วินาที; ลูกค้าเว็บได้ข้อความที่ตรงเหตุ ("ถูกตัดหน้า" ≠ "หมดอายุ") — spec: `docs/superpowers/specs/2026-08-04-product-answering-readiness-design.md` §7

**Architecture:** ยึด **2 util จิ๋วที่รับ `tx` client** เป็นแกน แทนการ inject service ข้าม module: (1) `preemptReservationsInTx` วางในทุก transaction ที่ flip เครื่องออกจาก `IN_STOCK` (sale-writer 3 ทาง + `markBundleProductsSold` + contract-lifecycle) และ (2) `consumeOrderHoldInTx` วางที่จุดเงินเข้าจริงทั้งสองทาง (PaySolutions webhook + admin ยืนยันสลิป) ซึ่ง re-check `product.status==='IN_STOCK'` แล้ว consume hold แบบ conditional — ไม่ผ่าน = order เข้าสถานะใหม่ `PAYMENT_RECEIVED_UNFULFILLABLE` + คิวคืนเงิน; แจ้งเตือน staff เป็น polling badge 30s (ไม่พึ่ง EventsGateway ที่ปิดใน prod), แจ้งลูกค้าเป็น LINE flex best-effort ผ่าน cron ที่กิน flag `preemptNotifiedAt` (idempotent, ไม่แขวนอยู่กับ tx ของงานขาย)

**Tech Stack:** NestJS + Prisma (Postgres) `apps/api`, React + React Query `apps/web` (staff), React `apps/web-shop` (ลูกค้า), jest (api) / vitest (web)

## Global Constraints

- Branch: `feat/pa-b5-reservation-oversell` (แตกจาก `spec/product-answering-readiness`); ทุก commit ลงท้าย `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
- **Red line — ห้ามแตะ accounting/finance JE:** งาน B5 แตะ `sale-writer.service.ts` และ `contract-lifecycle.service.ts` ซึ่งเป็นเส้นทางเงินสัญญา → การแก้ต้องเป็น **additive บรรทัดเดียวใน tx เดิม** (เรียก util) เท่านั้น; ห้ามย้าย/แก้ลำดับ `ShopCashSaleTemplate.execute` / `ShopDownPaymentTemplate.execute` / `interCompanyService.createFromSaleInTx` / `calculateInstallmentWithInterest`; **หลักฐานคือเทสต์เดิมต้องเขียวโดยไม่แก้ assertion แม้แต่บรรทัดเดียว** (`sale-writer.service.spec.ts` (a)-(d) พิน JE args + จำนวนเงินทุกบาท, `contract-lifecycle.service.spec.ts` พิน down-payment JE)
- Migration ใหม่ = `20260984000000_online_order_unfulfillable` (max ปัจจุบันบน main = `20260981000000_add_credit_note_source_fields`; B0 จอง `20260982000000`, B3 จอง `20260983000000` → 984 คือตัวถัดไปที่ว่าง) — **ต้อง `ls apps/api/prisma/migrations | sort | tail -3` ยืนยันก่อนสร้างจริง**
- ใน migration: วาง `ALTER TYPE "OnlineOrderStatus" ADD VALUE 'PAYMENT_RECEIVED_UNFULFILLABLE'` เป็น **statement สุดท้าย** ของไฟล์ — ข้อจำกัดจริงของ Postgres (12+) คือ *ห้ามใช้* ค่า enum ใหม่ใน transaction เดียวกับที่เพิ่ม (การ ADD เองทำใน tx ได้); migration นี้ไม่มี statement ไหนใช้ค่าใหม่เลย จึงปลอดภัยอยู่แล้ว — วางท้ายไฟล์เป็นการกันพลาดเผื่ออนาคตมีคนเติม UPDATE ที่อ้างค่าใหม่ต่อท้าย; ค่า enum ต่อท้ายรายการเสมอ ห้ามแทรกกลาง
- เงินใช้ `Prisma.Decimal` เท่านั้น; B5 **ไม่คำนวณเงินใหม่เลย** (แค่ย้ายสถานะ) — ไม่มี money-math ใหม่ที่ต้อง golden แต่มี behavior-preserving golden ตาม red line ข้างบน
- เทสต์ฝั่ง api = **jest**: `cd apps/api && npx jest <path>` (config อยู่ใน `apps/api/package.json:152` `testRegex: ".*\\.spec\\.ts$"`)
- เทสต์ฝั่ง web = **vitest** (apps/web **ไม่มี jest config** — `apps/web/package.json:11` = `vitest run`, ไฟล์เทสต์ import จาก `vitest` เช่น `apps/web/src/hooks/useQcPendingCount.test.ts:1`): `cd apps/web && npx vitest run <path>`
- DB-backed vitest ห้ามใช้นอก `apps/api/src/modules/journal/cpa-templates/` — B5 ไม่มี DB-backed spec เลย ทุกอย่าง mock prisma
- ห้าม inject `ShopReservationService` เข้า sales/contracts (service ผูกกับ `this.prisma` → เข้า tx ของ caller ไม่ได้ = preempt หลุดจาก atomicity) — ใช้ util รับ `tx` เท่านั้น
- ห้ามพึ่ง `EventsGateway` (ปิดใน prod เพราะไม่มี `ENABLE_WEBSOCKET`) — แจ้ง staff = polling badge pattern เดียวกับ `useQcPendingCount` (30s)
- UI copy ภาษาไทยทั้งหมด; ห้าม hardcoded hex/gray — ใช้ design tokens (`bg-card`, `text-muted-foreground`, `bg-warning/10`, `text-destructive` ฯลฯ); ข้อความไทยใช้ `leading-snug`
- ฝั่ง web ใช้ `api` จาก `@/lib/api` เท่านั้น (baseURL = `/api/admin`, `AdminPrefixMiddleware` ตัด `/admin` ตัวแรกออก → controller ที่ประกาศ `@Controller('admin/xxx')` ถูกเรียกด้วย `api.get('/admin/xxx')`)
- จบ batch: `cd apps/api && npx tsc --noEmit` = 0, `npx eslint .` = 0; `cd apps/web && npx tsc --noEmit` = 0, `npx eslint .` = 0; `cd apps/web-shop && npx tsc --noEmit` = 0
- QA เบราว์เซอร์ทำบน **local เท่านั้น** (prod ปฏิเสธ seed accounts — ดู memory `qa-prod-creds-and-purchasing-v2-result`)

---

## File Structure

**สร้างใหม่ (api)**
| ไฟล์ | หน้าที่ |
|---|---|
| `apps/api/prisma/migrations/20260984000000_online_order_unfulfillable/migration.sql` | enum ใหม่ + `preempt_notified_at` + backfill กันแจ้งย้อนหลัง |
| `apps/api/src/utils/reservation-preempt.util.ts` | `preemptReservationsInTx(tx, productIds)` — ตัด hold ใน tx ที่เครื่องออกจาก IN_STOCK |
| `apps/api/src/utils/reservation-preempt.util.spec.ts` | jest unit |
| `apps/api/src/modules/shop-orders/consume-order-hold.util.ts` | `consumeOrderHoldInTx(tx, {...})` — re-check IN_STOCK + consume hold แบบ conditional |
| `apps/api/src/modules/shop-orders/consume-order-hold.util.spec.ts` | jest unit |
| `apps/api/src/modules/shop-orders/shop-orders.service.spec.ts` | jest — confirmBankTransfer/pending-count/refund |
| `apps/api/src/modules/shop-reservation/shop-reservation.admin.controller.ts` | `admin/product-holds` list + release |

**สร้างใหม่ (web)**
| ไฟล์ | หน้าที่ |
|---|---|
| `apps/web/src/hooks/useOnlineOrdersPendingCount.ts` | polling 30s → badge count |
| `apps/web/src/hooks/useOnlineOrdersPendingCount.test.ts` | vitest |
| `apps/web/src/pages/ProductHoldsPage.tsx` | หน้า "การจองจากเว็บ" (list + ปลด hold) |

**แก้ไข (api)**
`prisma/schema.prisma` (enum `OnlineOrderStatus` 318-329, model `ProductReservation` 6090-6111) · `modules/paysolutions/services/paysolutions-confirmation.service.ts` (266-334 + flex builder ใหม่หลัง 381) · `modules/shop-orders/shop-orders.service.ts` (1-7, 54-59, + 2 เมธอดท้ายคลาส) · `modules/shop-orders/shop-orders.admin.controller.ts` (21-24, ท้าย controller) · `modules/shop-checkout/shop-checkout.service.ts` (33-43, const ใหม่หลัง 13, 158-165) · `modules/sales/services/sale-writer.service.ts` (93-116, 146-149, 326-329, 444-447) + spec · `modules/contracts/services/contract-lifecycle.service.ts` (236-240) + spec · `modules/shop-reservation/shop-reservation.service.ts` (1-19, 79-84) + spec + `.module.ts` + `reservation-cleanup.cron.ts` · `modules/shop-catalog/shop-catalog.service.ts` (290-295) + spec (391-396) · `modules/paysolutions/paysolutions.callbacks.spec.ts` (409-529)

**แก้ไข (web / web-shop)**
`apps/web/src/config/menu.ts` (65, 265, 367, 637 — ไอคอน `Lock` import อยู่แล้วที่บรรทัด 23) · `apps/web/src/components/layout/Sidebar.tsx` (40, 63-78) · `apps/web/src/pages/OnlineOrdersPage.tsx` (14-62, 124-137, 210-301) · `apps/web/src/App.tsx` (218, 959-966) · `apps/web/src/pages/ProductDetailPage/index.tsx` (119-125, 352) · `apps/web-shop/src/components/catalog/ProductCard.tsx` (134-145)

---

### Task 1: Schema — สถานะ "เงินเข้าแต่ของไม่มี" + ธงกันแจ้งซ้ำ

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (enum `OnlineOrderStatus` บรรทัด 318-329, model `ProductReservation` บรรทัด 6090-6111)
- Create: `apps/api/prisma/migrations/20260984000000_online_order_unfulfillable/migration.sql`

**Interfaces:**
- Produces: `OnlineOrderStatus.PAYMENT_RECEIVED_UNFULFILLABLE` (ค่าใหม่ต่อท้าย enum), `ProductReservation.preemptNotifiedAt DateTime? @map("preempt_notified_at")`, index `product_reservations(status, preempt_notified_at)`
- Consumes: ไม่มี (งานฐานล้วน)

- [ ] **Step 1:** เพิ่มค่า enum ต่อท้าย `OnlineOrderStatus` ใน `schema.prisma:318-329` (ต่อท้ายเสมอ — ห้ามแทรกกลาง เพราะ `ALTER TYPE ADD VALUE` ต่อท้าย DB อยู่แล้ว จะทำให้ลำดับ schema ≠ DB):

```prisma
enum OnlineOrderStatus {
  DRAFT
  PENDING_PAYMENT
  PENDING_BANK_REVIEW
  PAID
  PACKING
  SHIPPED
  DELIVERED
  COMPLETED
  CANCELLED
  REFUNDED
  /// B5: เงินเข้าแล้วแต่เครื่องถูกขายไปก่อน (แพ้ race / โดนตัดหน้า) — ต้องคืนเงินลูกค้า
  PAYMENT_RECEIVED_UNFULFILLABLE
}
```

- [ ] **Step 2:** เพิ่มคอลัมน์ + index ใน model `ProductReservation` (`schema.prisma:6090-6111`) — วาง `preemptNotifiedAt` ต่อจาก `consumedById` และเพิ่ม `@@index` ต่อจาก index เดิม:

```prisma
  consumedById String?           @map("consumed_by_id")
  /// B5: เวลาที่แจ้งลูกค้าแล้วว่า hold นี้โดนตัดหน้า (null = ยังไม่แจ้ง) — กัน cron แจ้งซ้ำ
  preemptNotifiedAt DateTime?    @map("preempt_notified_at")
```

```prisma
  @@index([productId, status])
  @@index([customerId])
  @@index([expiresAt])
  @@index([status, preemptNotifiedAt])
  @@map("product_reservations")
```

- [ ] **Step 3:** ยืนยันเลข migration ว่าง: `ls apps/api/prisma/migrations | sort | tail -3` → ถ้ามี `20260984000000_*` อยู่แล้วให้ขยับเป็นเลขถัดไป
- [ ] **Step 4:** สร้าง migration แบบ `--create-only` **แล้วเปลี่ยนชื่อโฟลเดอร์เป็นเลขของ repo** — Prisma ตั้งชื่อด้วย timestamp จริง (เช่น `20260804xxxxxx_online_order_unfulfillable`) ซึ่ง **น้อยกว่า** เลขที่ repo ใช้อยู่ (`20260981000000`) → ลำดับ lexicographic จะเพี้ยนเทียบกับ B0 (`982`) / B3 (`983`) ต้อง rename ทุกครั้ง:

```bash
cd apps/api
npx prisma migrate dev --name online_order_unfulfillable --create-only
# Prisma พิมพ์ path โฟลเดอร์ที่สร้าง — rename ให้ตรงเลขที่จองไว้
mv prisma/migrations/*_online_order_unfulfillable \
   prisma/migrations/20260984000000_online_order_unfulfillable
```

เขียนทับเนื้อไฟล์ `prisma/migrations/20260984000000_online_order_unfulfillable/migration.sql` ให้เป็น (Prisma generate `ALTER TYPE` ไว้บนสุด — เขียนทับทั้งไฟล์ตามนี้):

```sql
-- B5: กันขายซ้ำเว็บ ↔ หน้าร้าน
-- (1) ธงกันแจ้งซ้ำเมื่อ hold โดนตัดหน้า  (2) สถานะ "เงินเข้าแต่ของไม่มี"

ALTER TABLE "product_reservations" ADD COLUMN "preempt_notified_at" TIMESTAMP(3);

-- hold ที่โดนตัดหน้าไปแล้วก่อน deploy นี้ = ถือว่าแจ้งแล้ว (กัน cron ยิง LINE ย้อนหลังเป็นพรวด)
UPDATE "product_reservations" SET "preempt_notified_at" = NOW() WHERE "status" = 'PREEMPTED';

CREATE INDEX "product_reservations_status_preempt_notified_at_idx"
  ON "product_reservations"("status", "preempt_notified_at");

-- ต้องเป็น statement สุดท้าย: Postgres ห้ามใช้ค่า enum ใหม่ใน transaction เดียวกับที่เพิ่มค่า
ALTER TYPE "OnlineOrderStatus" ADD VALUE 'PAYMENT_RECEIVED_UNFULFILLABLE';
```

- [ ] **Step 5:** `cd apps/api && npx prisma migrate dev && npx prisma generate` → ไม่มี error
- [ ] **Step 6:** `cd apps/api && npx tsc --noEmit` → 0 errors (ยืนยันว่า client ใหม่ compile ผ่านทั้ง repo)
- [ ] **Step 7:** Commit: `feat(b5): schema — PAYMENT_RECEIVED_UNFULFILLABLE + ProductReservation.preemptNotifiedAt`

---

### Task 2: util รับ tx 2 ตัว (preempt + consume hold)

**Files:**
- Create: `apps/api/src/utils/reservation-preempt.util.ts`
- Create: `apps/api/src/utils/reservation-preempt.util.spec.ts`
- Create: `apps/api/src/modules/shop-orders/consume-order-hold.util.ts`
- Create: `apps/api/src/modules/shop-orders/consume-order-hold.util.spec.ts`

**Interfaces:**
- Produces:
```ts
// apps/api/src/utils/reservation-preempt.util.ts
export async function preemptReservationsInTx(
  tx: Prisma.TransactionClient,
  productIds: (string | null | undefined)[],
): Promise<string[]>   // คืน id ของ hold ที่โดนตัด (ให้ caller เอาไป log/แจ้งหลัง commit)

// apps/api/src/modules/shop-orders/consume-order-hold.util.ts
export interface ConsumeOrderHoldResult {
  fulfillable: boolean;
  productStatus: string | null;
  consumedCount: number;
}
export async function consumeOrderHoldInTx(
  tx: Prisma.TransactionClient,
  input: { orderId: string; productId: string; reservationId: string },
): Promise<ConsumeOrderHoldResult>
```
- Consumes: `tx.productReservation.findMany/updateMany`, `tx.product.findUnique` (Prisma client เท่านั้น — ไม่มี DI, ไม่มี service)

- [ ] **Step 1:** เขียนเทสต์ที่ต้อง fail ก่อน `apps/api/src/utils/reservation-preempt.util.spec.ts`:

```ts
import { preemptReservationsInTx } from './reservation-preempt.util';

describe('preemptReservationsInTx', () => {
  let tx: any;

  beforeEach(() => {
    tx = {
      productReservation: {
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
  });

  it('ไม่ยิง query เลยเมื่อไม่มี productId', async () => {
    expect(await preemptReservationsInTx(tx, [])).toEqual([]);
    expect(await preemptReservationsInTx(tx, [null, undefined])).toEqual([]);
    expect(tx.productReservation.findMany).not.toHaveBeenCalled();
    expect(tx.productReservation.updateMany).not.toHaveBeenCalled();
  });

  it('ไม่ยิง updateMany เมื่อไม่มี hold ACTIVE', async () => {
    tx.productReservation.findMany.mockResolvedValue([]);
    expect(await preemptReservationsInTx(tx, ['p1'])).toEqual([]);
    expect(tx.productReservation.findMany).toHaveBeenCalledWith({
      where: { productId: { in: ['p1'] }, status: 'ACTIVE' },
      select: { id: true },
    });
    expect(tx.productReservation.updateMany).not.toHaveBeenCalled();
  });

  it('ตัด hold ACTIVE เป็น PREEMPTED และคืน id ที่ตัด', async () => {
    tx.productReservation.findMany.mockResolvedValue([{ id: 'r1' }, { id: 'r2' }]);
    tx.productReservation.updateMany.mockResolvedValue({ count: 2 });

    const ids = await preemptReservationsInTx(tx, ['p1', 'p2']);

    expect(ids).toEqual(['r1', 'r2']);
    expect(tx.productReservation.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['r1', 'r2'] }, status: 'ACTIVE' },
      data: { status: 'PREEMPTED' },
    });
  });

  it('dedupe productId ซ้ำ และคัด null/undefined ทิ้ง', async () => {
    tx.productReservation.findMany.mockResolvedValue([{ id: 'r1' }]);
    tx.productReservation.updateMany.mockResolvedValue({ count: 1 });

    await preemptReservationsInTx(tx, ['p1', 'p1', null, 'p2', undefined]);

    expect(tx.productReservation.findMany).toHaveBeenCalledWith({
      where: { productId: { in: ['p1', 'p2'] }, status: 'ACTIVE' },
      select: { id: true },
    });
  });

  it('เงื่อนไข status ACTIVE ยังอยู่ใน updateMany (ห้ามทับ CONSUMED/PREEMPTED)', async () => {
    tx.productReservation.findMany.mockResolvedValue([{ id: 'r1' }]);
    tx.productReservation.updateMany.mockResolvedValue({ count: 0 });
    await preemptReservationsInTx(tx, ['p1']);
    expect(tx.productReservation.updateMany.mock.calls[0][0].where.status).toBe('ACTIVE');
  });
});
```

- [ ] **Step 2:** รันให้เห็น fail: `cd apps/api && npx jest src/utils/reservation-preempt.util.spec.ts` → `Cannot find module './reservation-preempt.util'`
- [ ] **Step 3:** implement `apps/api/src/utils/reservation-preempt.util.ts`:

```ts
import { Prisma } from '@prisma/client';

/**
 * ตัด hold (การจองจากเว็บ) ของสินค้าที่กำลังถูก flip ออกจาก IN_STOCK — ต้องอยู่ใน
 * transaction เดียวกับที่เปลี่ยนสถานะเครื่อง ไม่งั้นจะเกิดช่องว่างที่ลูกค้าเว็บยังจ่ายเงิน
 * เข้ามาบนเครื่องที่ขายไปแล้ว (หรือถ้า caller rollback แล้ว hold ถูกตัดทิ้งฟรี)
 *
 * เหตุที่เป็น util ไม่ใช่ service: `ShopReservationService` ผูกกับ `this.prisma` จึงเข้า
 * tx ของ caller ไม่ได้ และการ inject service ข้าม module (sales/contracts → shop-reservation)
 * จะลาก dependency graph ของโมดูลเงินไปผูกกับโมดูลร้านค้าโดยไม่จำเป็น
 *
 * คืน id ของ hold ที่โดนตัด เพื่อให้ caller log/ส่งต่อได้ — การแจ้งลูกค้าจริงทำโดย
 * `ShopReservationService.notifyPreemptedHolds` (cron) ซึ่งอ่าน `preemptNotifiedAt`
 * จึงไม่มีการยิง LINE ค้างอยู่ใน tx ของงานขาย
 */
export async function preemptReservationsInTx(
  tx: Prisma.TransactionClient,
  productIds: (string | null | undefined)[],
): Promise<string[]> {
  const ids = Array.from(new Set(productIds.filter((v): v is string => !!v)));
  if (ids.length === 0) return [];

  const holds = await tx.productReservation.findMany({
    where: { productId: { in: ids }, status: 'ACTIVE' },
    select: { id: true },
  });
  if (holds.length === 0) return [];

  const holdIds = holds.map((h) => h.id);
  await tx.productReservation.updateMany({
    where: { id: { in: holdIds }, status: 'ACTIVE' },
    data: { status: 'PREEMPTED' },
  });
  return holdIds;
}
```

- [ ] **Step 4:** รันผ่าน: `cd apps/api && npx jest src/utils/reservation-preempt.util.spec.ts` → 5 passed
- [ ] **Step 5:** เขียนเทสต์ที่ต้อง fail `apps/api/src/modules/shop-orders/consume-order-hold.util.spec.ts`:

```ts
import { consumeOrderHoldInTx } from './consume-order-hold.util';

describe('consumeOrderHoldInTx', () => {
  let tx: any;
  const input = { orderId: 'oo-1', productId: 'p1', reservationId: 'r1' };

  beforeEach(() => {
    tx = {
      product: { findUnique: jest.fn().mockResolvedValue({ status: 'IN_STOCK' }) },
      productReservation: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
  });

  it('เครื่องยัง IN_STOCK + hold consume ได้ → fulfillable', async () => {
    const res = await consumeOrderHoldInTx(tx, input);
    expect(res).toEqual({ fulfillable: true, productStatus: 'IN_STOCK', consumedCount: 1 });
    expect(tx.productReservation.updateMany).toHaveBeenCalledWith({
      where: { id: 'r1', status: { in: ['ACTIVE', 'EXPIRED'] } },
      data: { status: 'CONSUMED', consumedById: 'oo-1' },
    });
  });

  it('เครื่องถูกขายไปแล้ว (SOLD_CASH) → ไม่ fulfillable และห้ามแตะ hold', async () => {
    tx.product.findUnique.mockResolvedValue({ status: 'SOLD_CASH' });
    const res = await consumeOrderHoldInTx(tx, input);
    expect(res).toEqual({ fulfillable: false, productStatus: 'SOLD_CASH', consumedCount: 0 });
    expect(tx.productReservation.updateMany).not.toHaveBeenCalled();
  });

  it('เครื่องถูก RESERVED เข้าสัญญาแล้ว → ไม่ fulfillable', async () => {
    tx.product.findUnique.mockResolvedValue({ status: 'RESERVED' });
    expect((await consumeOrderHoldInTx(tx, input)).fulfillable).toBe(false);
  });

  it('ไม่พบเครื่อง → ไม่ fulfillable, productStatus = null', async () => {
    tx.product.findUnique.mockResolvedValue(null);
    expect(await consumeOrderHoldInTx(tx, input)).toEqual({
      fulfillable: false, productStatus: null, consumedCount: 0,
    });
  });

  it('hold โดน PREEMPTED ไปแล้ว (count=0) → ไม่ fulfillable และไม่ทับสถานะเดิม', async () => {
    tx.productReservation.updateMany.mockResolvedValue({ count: 0 });
    const res = await consumeOrderHoldInTx(tx, input);
    expect(res.fulfillable).toBe(false);
    expect(res.consumedCount).toBe(0);
  });

  it('hold EXPIRED แต่เครื่องยังอยู่ → consume ได้ (ไม่บังคับให้คืนเงินโดยไม่จำเป็น)', async () => {
    tx.productReservation.updateMany.mockResolvedValue({ count: 1 });
    expect((await consumeOrderHoldInTx(tx, input)).fulfillable).toBe(true);
    expect(tx.productReservation.updateMany.mock.calls[0][0].where.status).toEqual({
      in: ['ACTIVE', 'EXPIRED'],
    });
  });
});
```

- [ ] **Step 6:** รันให้เห็น fail: `cd apps/api && npx jest src/modules/shop-orders/consume-order-hold.util.spec.ts`
- [ ] **Step 7:** implement `apps/api/src/modules/shop-orders/consume-order-hold.util.ts`:

```ts
import { Prisma } from '@prisma/client';

export interface ConsumeOrderHoldResult {
  /** true = ส่งของได้จริง → เดินต่อไปสร้าง Sale; false = เงินเข้าแล้วแต่ของไม่มี → คิวคืนเงิน */
  fulfillable: boolean;
  productStatus: string | null;
  consumedCount: number;
}

/**
 * จุดเงินเข้าจริงของออเดอร์ออนไลน์ (PaySolutions webhook + แอดมินยืนยันสลิป) ต้องเรียกตัวนี้
 * ใน tx เดียวกับที่เปลี่ยนสถานะออเดอร์
 *
 * แหล่งความจริงของ "ของยังอยู่ไหม" คือ `product.status === 'IN_STOCK'` (ไม่ใช่สถานะ hold):
 * ทุกทางที่ flip เครื่องออกจาก IN_STOCK จะ preempt hold ใน tx เดียวกันอยู่แล้ว
 * (`preemptReservationsInTx`) → เครื่องไม่ IN_STOCK = ของหายไปแน่นอน
 *
 * consume แบบ conditional (`updateMany` + where status) เท่านั้น — **ห้าม** `update({where:{id}})`
 * เฉยๆ เพราะจะทับ hold ที่เป็น PREEMPTED ให้กลายเป็น CONSUMED และกลบร่องรอยการตัดหน้า
 * ยอมรับ EXPIRED ด้วย เพราะ hold หมดอายุแต่เครื่องยังอยู่ = ส่งของได้ ไม่ต้องคืนเงิน
 */
export async function consumeOrderHoldInTx(
  tx: Prisma.TransactionClient,
  input: { orderId: string; productId: string; reservationId: string },
): Promise<ConsumeOrderHoldResult> {
  const product = await tx.product.findUnique({
    where: { id: input.productId },
    select: { status: true },
  });
  const productStatus = product?.status ?? null;
  if (productStatus !== 'IN_STOCK') {
    return { fulfillable: false, productStatus, consumedCount: 0 };
  }

  const consumed = await tx.productReservation.updateMany({
    where: { id: input.reservationId, status: { in: ['ACTIVE', 'EXPIRED'] } },
    data: { status: 'CONSUMED', consumedById: input.orderId },
  });

  return {
    fulfillable: consumed.count === 1,
    productStatus,
    consumedCount: consumed.count,
  };
}
```

- [ ] **Step 8:** รันผ่าน: `cd apps/api && npx jest src/modules/shop-orders/consume-order-hold.util.spec.ts` → 6 passed
- [ ] **Step 9:** `cd apps/api && npx tsc --noEmit` → 0; Commit: `feat(b5): util รับ tx — preemptReservationsInTx + consumeOrderHoldInTx`

---

### Task 3: Guard ที่จุดเงินเข้าจริง (PaySolutions webhook)

**Files:**
- Modify: `apps/api/src/modules/paysolutions/services/paysolutions-confirmation.service.ts` (import บรรทัด 1-9, `confirmOnlineOrderPayment` บรรทัด 266-334, เพิ่ม flex builder ใหม่หลังบรรทัด 381)
- Modify: `apps/api/src/modules/paysolutions/paysolutions.callbacks.spec.ts` (describe `confirmOnlineOrderPayment` บรรทัด 409-529)

**Interfaces:**
- Consumes: `consumeOrderHoldInTx(tx, { orderId, productId, reservationId })` (Task 2), `this.lineOaService.sendFlexMessage(to: string, flex: FlexMessagePayload, channelKey: 'line-shop')`, `this.saleAdapter.createForOnlineOrder(orderId)`
- Produces: `confirmOnlineOrderPayment(onlineOrderId, webhookData)` — สถานะปลายทาง `PAID` (fulfillable) หรือ `PAYMENT_RECEIVED_UNFULFILLABLE` (ต้องคืนเงิน); idempotent skip ขยายเป็น `PAID|PACKING|SHIPPED|PAYMENT_RECEIVED_UNFULFILLABLE|REFUNDED`

> **หมายเหตุขอบเขต (จงใจ):** `DELIVERED` / `COMPLETED` / `CANCELLED` **ไม่อยู่** ใน skip list — เหมือนเดิมก่อน B5 (โค้ดปัจจุบันบรรทัด 278-282 มีแค่ `PAID|PACKING|SHIPPED`) จึงไม่ใช่ regression ที่ B5 สร้าง; และสำหรับ `CANCELLED` การไม่ skip **ดีกว่า** หลัง B5: hold ถูกปล่อยเป็น `CANCELLED` ตอนยกเลิกออเดอร์ → `consumeOrderHoldInTx` คืน `count=0` → ออเดอร์เข้าคิวคืนเงินแทนที่จะกลืนเงินเงียบๆ **ถ้า owner ต้องการให้ webhook ที่มาทีหลังบนออเดอร์ที่ส่งของแล้ว (DELIVERED/COMPLETED) เป็น no-op ให้เติม 2 ค่านี้ในเงื่อนไข Step 5 ด้วย — เป็นการตัดสินใจของ owner ไม่ใช่ของ batch นี้**

- [ ] **Step 1:** เพิ่มเทสต์ที่ต้อง fail ใน `paysolutions.callbacks.spec.ts` — ก่อนอื่นเสริม mock `tx` + `product` (`beforeEach` บรรทัด 428-441) ให้รองรับ path ใหม่:

```ts
    beforeEach(async () => {
      txMock = {
        onlineOrder: { update: jest.fn().mockResolvedValue({}) },
        productReservation: {
          update: jest.fn().mockResolvedValue({}),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        product: { findUnique: jest.fn().mockResolvedValue({ status: 'IN_STOCK' }) },
      };
      prisma = {
        onlineOrder: {
          findUnique: jest.fn().mockResolvedValue(makeOrder()),
        },
        $transaction: jest.fn().mockImplementation(async (cb: any) => cb(txMock)),
        __tx: txMock,
      };
      await buildService();
    });
```

และเพิ่ม `productId: 'p1'` ใน `makeOrder()` (บรรทัด 412-424) เพื่อให้ util หาเครื่องเจอ:

```ts
      return {
        id: orderId,
        orderNumber: 'OO-2026-0001',
        status: 'PENDING',
        productId: 'p1',
        reservationId: 'resv-1',
        totalAmount: new Prisma.Decimal(9990),
        customer: { lineIdShop: null },
        product: { name: 'iPhone 15' },
        reservation: { id: 'resv-1' },
        ...overrides,
      } as any;
```

- [ ] **Step 2:** แทนที่เทสต์ success เดิม (`'success: flips order PAID + reservation CONSUMED in one tx, stamps paymentRef, then creates Sale'` บรรทัด 467-490) ให้ assert การ consume แบบ conditional แทน `update by id` แล้วเพิ่มเทสต์ใหม่ 4 ตัวท้าย describe (ก่อน `});` ที่บรรทัด 529):

```ts
    it('success: flips order PAID + consume hold แบบมีเงื่อนไข (ห้าม update by id เปล่าๆ)', async () => {
      await service.confirmOnlineOrderPayment(orderId, {
        transaction_id: 'tx-success',
        refno: 'refno-fallback',
      });

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(txMock.onlineOrder.update).toHaveBeenCalledWith({
        where: { id: orderId },
        data: expect.objectContaining({
          status: 'PAID',
          paidAt: expect.any(Date),
          paymentRef: 'tx-success',
        }),
      });
      expect(txMock.productReservation.updateMany).toHaveBeenCalledWith({
        where: { id: 'resv-1', status: { in: ['ACTIVE', 'EXPIRED'] } },
        data: { status: 'CONSUMED', consumedById: orderId },
      });
      expect(txMock.productReservation.update).not.toHaveBeenCalled();
      expect(saleAdapter.createForOnlineOrder).toHaveBeenCalledWith(orderId);
    });

    it('unfulfillable: เครื่องถูกขายหน้าร้านไปแล้ว → order = PAYMENT_RECEIVED_UNFULFILLABLE, ไม่สร้าง Sale', async () => {
      txMock.product.findUnique.mockResolvedValue({ status: 'SOLD_CASH' });

      await service.confirmOnlineOrderPayment(orderId, { transaction_id: 'tx-1' });

      expect(txMock.onlineOrder.update).toHaveBeenCalledWith({
        where: { id: orderId },
        data: expect.objectContaining({
          status: 'PAYMENT_RECEIVED_UNFULFILLABLE',
          paymentRef: 'tx-1',
        }),
      });
      expect(txMock.productReservation.updateMany).not.toHaveBeenCalled();
      expect(saleAdapter.createForOnlineOrder).not.toHaveBeenCalled();
      expect(Sentry.captureException as jest.Mock).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({
          tags: expect.objectContaining({ critical: 'online-order-unfulfillable' }),
        }),
      );
    });

    it('unfulfillable: hold โดน PREEMPTED ก่อน (count=0) → unfulfillable แม้เครื่องยัง IN_STOCK', async () => {
      txMock.productReservation.updateMany.mockResolvedValue({ count: 0 });

      await service.confirmOnlineOrderPayment(orderId, { transaction_id: 'tx-1' });

      expect(txMock.onlineOrder.update).toHaveBeenCalledWith({
        where: { id: orderId },
        data: expect.objectContaining({ status: 'PAYMENT_RECEIVED_UNFULFILLABLE' }),
      });
      expect(saleAdapter.createForOnlineOrder).not.toHaveBeenCalled();
    });

    it('unfulfillable: ส่ง LINE แจ้งลูกค้าคนละแบบกับ flex ชำระสำเร็จ', async () => {
      prisma.onlineOrder.findUnique.mockResolvedValueOnce(
        makeOrder({ customer: { lineIdShop: 'U-line-shop' } }),
      );
      txMock.product.findUnique.mockResolvedValue({ status: 'SOLD_CASH' });

      await service.confirmOnlineOrderPayment(orderId, { transaction_id: 'tx-1' });

      expect(lineOa.sendFlexMessage).toHaveBeenCalledTimes(1);
      const [, flex, channel] = lineOa.sendFlexMessage.mock.calls[0];
      expect(channel).toBe('line-shop');
      expect(JSON.stringify(flex)).toContain('คืนเงิน');
    });

    it.each(['PAYMENT_RECEIVED_UNFULFILLABLE', 'REFUNDED'])(
      'idempotency: webhook ซ้ำหลังเข้าคิวคืนเงิน (status=%s) = no-op',
      async (status) => {
        prisma.onlineOrder.findUnique.mockResolvedValueOnce(makeOrder({ status }));

        await service.confirmOnlineOrderPayment(orderId, { transaction_id: 'tx-1' });

        expect(prisma.$transaction).not.toHaveBeenCalled();
        expect(saleAdapter.createForOnlineOrder).not.toHaveBeenCalled();
      },
    );
```

- [ ] **Step 3:** รันให้เห็น fail: `cd apps/api && npx jest src/modules/paysolutions/paysolutions.callbacks.spec.ts -t confirmOnlineOrderPayment`
- [ ] **Step 4:** เพิ่ม import ที่หัวไฟล์ `paysolutions-confirmation.service.ts` (ต่อจากบรรทัด 8):

```ts
import { consumeOrderHoldInTx } from '../../shop-orders/consume-order-hold.util';
```

- [ ] **Step 5:** แทนที่ block บรรทัด 278-334 (ตั้งแต่ `if (order.status === 'PAID'` จนจบเมธอด) ด้วย:

```ts
    if (
      order.status === 'PAID' ||
      order.status === 'PACKING' ||
      order.status === 'SHIPPED' ||
      order.status === 'PAYMENT_RECEIVED_UNFULFILLABLE' ||
      order.status === 'REFUNDED'
    ) {
      this.logger.log(
        `Order ${order.orderNumber} already confirmed — idempotent skip`,
      );
      return;
    }

    // B5: จุดนี้คือ "เงินเข้าจริง" — ต้อง re-check ว่าเครื่องยังอยู่ใน tx เดียวกับที่ consume hold
    // เครื่องหลุดมือไปแล้ว (โดนขายหน้าร้าน/เข้าสัญญา) → เงินรับไปแล้วแต่ส่งของไม่ได้ = คิวคืนเงิน
    const fulfillable = await this.prisma.$transaction(async (tx) => {
      const hold = await consumeOrderHoldInTx(tx, {
        orderId: order.id,
        productId: order.productId,
        reservationId: order.reservationId,
      });
      await tx.onlineOrder.update({
        where: { id: onlineOrderId },
        data: {
          status: hold.fulfillable ? 'PAID' : 'PAYMENT_RECEIVED_UNFULFILLABLE',
          paidAt: new Date(),
          paymentRef: webhookData.transaction_id || webhookData.refno || null,
          ...(hold.fulfillable
            ? {}
            : { cancelReason: 'เครื่องถูกจำหน่ายก่อนเงินเข้า — ต้องคืนเงินลูกค้า' }),
        },
      });
      return hold.fulfillable;
    });

    if (!fulfillable) {
      this.logger.error(
        `Order ${order.orderNumber} paid but product ${order.productId} no longer available — refund required`,
      );
      Sentry.captureException(
        new Error(`Online order ${order.orderNumber} paid but unfulfillable`),
        {
          level: 'error',
          tags: { critical: 'online-order-unfulfillable', orderNumber: order.orderNumber },
          extra: {
            orderId: order.id,
            productId: order.productId,
            reservationId: order.reservationId,
          },
        },
      );
      if (order.customer.lineIdShop) {
        try {
          await this.lineOaService.sendFlexMessage(
            order.customer.lineIdShop,
            this.buildOrderUnfulfillableFlex(order),
            'line-shop',
          );
        } catch (err) {
          this.logger.warn(
            `Failed to send unfulfillable LINE notice for ${order.orderNumber}: ${err}`,
          );
        }
      }
      return;
    }

    // Create a Sale record for the paid online order. Adapter moves product to
    // SOLD_CASH, applies loyalty redemption, and transitions the OnlineOrder to
    // PACKING. Failures are logged (not re-thrown) — webhook must still return
    // 200 so PaySolutions doesn't retry, and admin can reconcile manually.
    try {
      await this.saleAdapter.createForOnlineOrder(order.id);
    } catch (err) {
      this.logger.error(
        `Failed to create Sale for online order ${order.orderNumber}: ${err}`,
      );
      Sentry.captureException(err, {
        level: 'error',
        tags: { critical: 'online-order-sale-failed', orderNumber: order.orderNumber },
      });
      // Don't re-throw — Sale can be created manually by admin if needed
    }

    if (order.customer.lineIdShop) {
      try {
        await this.lineOaService.sendFlexMessage(
          order.customer.lineIdShop,
          this.buildOrderPaidFlex(order),
          'line-shop',
        );
      } catch (err) {
        this.logger.warn(
          `Failed to send LINE notification for order ${order.orderNumber}: ${err}`,
        );
      }
    }
  }
```

- [ ] **Step 6:** เพิ่ม flex builder ใหม่ต่อจากท้าย `buildOrderPaidFlex` (หลังบรรทัด 381 `  }`):

```ts
  /**
   * flex แจ้งลูกค้าเมื่อเงินเข้าแล้วแต่เครื่องถูกจำหน่ายไปก่อน — ต้องบอกตรงๆ ว่าจะคืนเงิน
   * (best-effort: ล้มก็แค่ warn — คิวคืนเงินฝั่งแอดมินคือแหล่งความจริง)
   */
  private buildOrderUnfulfillableFlex(order: {
    orderNumber: string;
    totalAmount: Prisma.Decimal;
    product: { name: string };
  }): FlexMessagePayload {
    return {
      type: 'flex',
      altText: `คำสั่งซื้อ ${order.orderNumber} — เครื่องถูกจำหน่ายไปก่อน ทางร้านจะคืนเงิน`,
      contents: {
        type: 'bubble',
        body: {
          type: 'box',
          layout: 'vertical',
          contents: [
            { type: 'text', text: 'ขออภัยอย่างสูง', weight: 'bold', size: 'lg' },
            {
              type: 'text',
              text: `คำสั่งซื้อ ${order.orderNumber}`,
              size: 'md',
              margin: 'md',
            },
            { type: 'text', text: order.product.name, size: 'sm', color: '#666666', wrap: true },
            { type: 'separator', margin: 'md' },
            {
              type: 'text',
              text: 'เครื่องนี้ถูกจำหน่ายที่หน้าร้านก่อนเงินเข้าระบบ ทางร้านจะคืนเงินเต็มจำนวนให้ครับ/ค่ะ',
              size: 'sm',
              margin: 'md',
              wrap: true,
            },
            {
              type: 'text',
              text: `ยอดที่จะคืน ฿${Number(order.totalAmount).toLocaleString()}`,
              size: 'md',
              margin: 'md',
              weight: 'bold',
            },
            {
              type: 'text',
              text: 'ทีมงานจะติดต่อกลับเพื่อยืนยันช่องทางคืนเงินภายใน 1 วันทำการ',
              size: 'xs',
              color: '#888888',
              margin: 'md',
              wrap: true,
            },
          ],
        },
      },
    };
  }
```

- [ ] **Step 7:** รันผ่านทั้งไฟล์: `cd apps/api && npx jest src/modules/paysolutions/paysolutions.callbacks.spec.ts` → all passed (เทสต์ not-found / paymentRef fallback / sale-adapter swallow / LINE paid flex เดิมต้องเขียวโดยไม่แก้)
- [ ] **Step 8:** `cd apps/api && npx tsc --noEmit` → 0; Commit: `fix(b5): guard เงินเข้า webhook — re-check IN_STOCK + consume hold มีเงื่อนไข + คิวคืนเงิน`

---

### Task 4: ปิดรู BANK_TRANSFER (ขายซ้ำได้ 100% วันนี้) + hold อยู่ยาวจนออเดอร์จบ

**Files:**
- Modify: `apps/api/src/modules/shop-orders/shop-orders.service.ts` (import + ctor บรรทัด 1-7, `confirmBankTransfer` บรรทัด 54-59)
- Modify: `apps/api/src/modules/shop-checkout/shop-checkout.service.ts` (const ใหม่แทรกหลัง import block บรรทัด 13, BANK_TRANSFER branch บรรทัด 158-165)
- Create: `apps/api/src/modules/shop-orders/shop-orders.service.spec.ts`

**Interfaces:**
- Consumes: `consumeOrderHoldInTx` (Task 2), `OnlineOrderSaleAdapter.createForOnlineOrder(onlineOrderId: string): Promise<void>` (module เดียวกัน — ไม่ต้องแก้ `shop-orders.module.ts` เพราะ adapter เป็น provider อยู่แล้ว)
- Produces: `ShopOrdersService.confirmBankTransfer(orderId: string, adminUserId: string)` — คืน `OnlineOrder` ล่าสุด (PACKING เมื่อสร้าง Sale สำเร็จ / `PAYMENT_RECEIVED_UNFULFILLABLE` เมื่อของหมด)

- [ ] **Step 1:** เขียนเทสต์ที่ต้อง fail `apps/api/src/modules/shop-orders/shop-orders.service.spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { ShopOrdersService } from './shop-orders.service';
import { PrismaService } from '../../prisma/prisma.service';
import { OnlineOrderSaleAdapter } from './online-order-sale.adapter';

jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn(), captureMessage: jest.fn() }));

describe('ShopOrdersService.confirmBankTransfer', () => {
  let service: ShopOrdersService;
  let prisma: any;
  let tx: any;
  let saleAdapter: { createForOnlineOrder: jest.Mock };

  const baseOrder = {
    id: 'oo-1',
    orderNumber: 'OO-2026-0001',
    status: 'PENDING_BANK_REVIEW',
    productId: 'p1',
    reservationId: 'r1',
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    tx = {
      product: { findUnique: jest.fn().mockResolvedValue({ status: 'IN_STOCK' }) },
      productReservation: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      onlineOrder: { update: jest.fn().mockResolvedValue({ ...baseOrder, status: 'PAID' }) },
    };
    prisma = {
      onlineOrder: {
        findUnique: jest.fn().mockResolvedValue(baseOrder),
        count: jest.fn().mockResolvedValue(0),
      },
      $transaction: jest.fn().mockImplementation(async (cb: any) => cb(tx)),
    };
    saleAdapter = { createForOnlineOrder: jest.fn().mockResolvedValue(undefined) };

    const mod = await Test.createTestingModule({
      providers: [
        ShopOrdersService,
        { provide: PrismaService, useValue: prisma },
        { provide: OnlineOrderSaleAdapter, useValue: saleAdapter },
      ],
    }).compile();
    service = mod.get(ShopOrdersService);
  });

  it('ไม่พบออเดอร์ → NotFound', async () => {
    prisma.onlineOrder.findUnique.mockResolvedValue(null);
    await expect(service.confirmBankTransfer('oo-x', 'u1')).rejects.toThrow(NotFoundException);
  });

  it('ยืนยันซ้ำ (status=PAID) → Forbidden, ไม่เปิด tx', async () => {
    prisma.onlineOrder.findUnique.mockResolvedValue({ ...baseOrder, status: 'PAID' });
    await expect(service.confirmBankTransfer('oo-1', 'u1')).rejects.toThrow(ForbiddenException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('ของยังอยู่ → consume hold + PAID + สร้าง Sale ผ่าน adapter', async () => {
    await service.confirmBankTransfer('oo-1', 'u1');

    expect(tx.productReservation.updateMany).toHaveBeenCalledWith({
      where: { id: 'r1', status: { in: ['ACTIVE', 'EXPIRED'] } },
      data: { status: 'CONSUMED', consumedById: 'oo-1' },
    });
    expect(tx.onlineOrder.update).toHaveBeenCalledWith({
      where: { id: 'oo-1' },
      data: expect.objectContaining({
        status: 'PAID',
        paidAt: expect.any(Date),
        bankConfirmedById: 'u1',
      }),
    });
    expect(saleAdapter.createForOnlineOrder).toHaveBeenCalledWith('oo-1');
  });

  it('ของถูกขายไปแล้ว → PAYMENT_RECEIVED_UNFULFILLABLE, ไม่สร้าง Sale, alarm', async () => {
    tx.product.findUnique.mockResolvedValue({ status: 'SOLD_CASH' });
    tx.onlineOrder.update.mockResolvedValue({
      ...baseOrder, status: 'PAYMENT_RECEIVED_UNFULFILLABLE',
    });

    const res = await service.confirmBankTransfer('oo-1', 'u1');

    expect(tx.onlineOrder.update).toHaveBeenCalledWith({
      where: { id: 'oo-1' },
      data: expect.objectContaining({ status: 'PAYMENT_RECEIVED_UNFULFILLABLE' }),
    });
    expect(saleAdapter.createForOnlineOrder).not.toHaveBeenCalled();
    expect(Sentry.captureException as jest.Mock).toHaveBeenCalled();
    expect(res.status).toBe('PAYMENT_RECEIVED_UNFULFILLABLE');
  });

  it('adapter ล้ม → ไม่ throw (เงินเข้าแล้ว rollback ไม่ได้) แต่ alarm', async () => {
    saleAdapter.createForOnlineOrder.mockRejectedValue(new Error('sale failed'));
    await expect(service.confirmBankTransfer('oo-1', 'u1')).resolves.toBeDefined();
    expect(Sentry.captureException as jest.Mock).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2:** รันให้เห็น fail: `cd apps/api && npx jest src/modules/shop-orders/shop-orders.service.spec.ts`
- [ ] **Step 3:** แก้หัวไฟล์ + ctor `shop-orders.service.ts` (บรรทัด 1-7):

```ts
import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../../prisma/prisma.service';
import { OnlineOrderSaleAdapter } from './online-order-sale.adapter';
import { consumeOrderHoldInTx } from './consume-order-hold.util';
import type { OnlineOrderStatus } from '@prisma/client';

@Injectable()
export class ShopOrdersService {
  private readonly logger = new Logger(ShopOrdersService.name);

  constructor(
    private prisma: PrismaService,
    private saleAdapter: OnlineOrderSaleAdapter,
  ) {}
```

- [ ] **Step 4:** แทน `confirmBankTransfer` เดิม (บรรทัด 54-59) ด้วยของจริง:

```ts
  /**
   * B5: เดิมเมธอดนี้ set PAID อย่างเดียว — ไม่ consume hold ไม่สร้าง Sale ไม่ flip
   * สถานะเครื่อง → ขายซ้ำได้ 100% โดยไม่ต้องอาศัย race เลย ตอนนี้วิ่ง path เดียวกับ
   * gateway confirm: re-check IN_STOCK + consume hold ใน tx เดียว แล้วค่อยสร้าง Sale
   */
  async confirmBankTransfer(orderId: string, adminUserId: string) {
    const order = await this.prisma.onlineOrder.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        orderNumber: true,
        status: true,
        productId: true,
        reservationId: true,
      },
    });
    if (!order) throw new NotFoundException('ไม่พบคำสั่งซื้อ');
    if (order.status !== 'PENDING_BANK_REVIEW' && order.status !== 'PENDING_PAYMENT') {
      throw new ForbiddenException('คำสั่งซื้อนี้ยืนยันการรับเงินไปแล้ว หรืออยู่ในสถานะที่ยืนยันไม่ได้');
    }

    const { updated, fulfillable } = await this.prisma.$transaction(async (tx) => {
      const hold = await consumeOrderHoldInTx(tx, {
        orderId: order.id,
        productId: order.productId,
        reservationId: order.reservationId,
      });
      const row = await tx.onlineOrder.update({
        where: { id: order.id },
        data: {
          status: hold.fulfillable ? 'PAID' : 'PAYMENT_RECEIVED_UNFULFILLABLE',
          paidAt: new Date(),
          bankConfirmedById: adminUserId,
          ...(hold.fulfillable
            ? {}
            : { cancelReason: 'เครื่องถูกจำหน่ายก่อนยืนยันสลิป — ต้องคืนเงินลูกค้า' }),
        },
      });
      return { updated: row, fulfillable: hold.fulfillable };
    });

    if (!fulfillable) {
      this.logger.error(
        `Bank transfer confirmed for ${order.orderNumber} but product ${order.productId} is gone — refund required`,
      );
      Sentry.captureException(
        new Error(`Online order ${order.orderNumber} bank-confirmed but unfulfillable`),
        {
          level: 'error',
          tags: { critical: 'online-order-unfulfillable', orderNumber: order.orderNumber },
          extra: { orderId: order.id, productId: order.productId, adminUserId },
        },
      );
      return updated;
    }

    // เงินเข้าแล้ว — throw ตรงนี้ rollback ไม่ได้ ทำแบบเดียวกับ gateway path:
    // log + alarm แล้วปล่อยให้แอดมินสร้าง Sale เองถ้าจำเป็น
    try {
      await this.saleAdapter.createForOnlineOrder(order.id);
    } catch (err) {
      this.logger.error(`Failed to create Sale for ${order.orderNumber}: ${err}`);
      Sentry.captureException(err, {
        level: 'error',
        tags: { critical: 'online-order-sale-failed', orderNumber: order.orderNumber },
      });
      return updated;
    }

    return this.prisma.onlineOrder.findUnique({ where: { id: order.id } });
  }
```

- [ ] **Step 5:** รันผ่าน: `cd apps/api && npx jest src/modules/shop-orders/shop-orders.service.spec.ts` → 5 passed
- [ ] **Step 6:** เพิ่มการยืด hold ของออเดอร์โอนเงิน — `shop-checkout.service.ts` เพิ่ม const ใต้ import (หลังบรรทัด 13):

```ts
/**
 * B5: hold ปกติ 15 นาที (พอสำหรับจ่าย QR) แต่ช่องทางโอนธนาคารลูกค้าต้องไปโอนจริง
 * + อัปสลิป + รอแอดมินตรวจ — 15 นาทีสั้นเกินจนของหลุดมือระหว่างรอ จึงยืดถึง 48 ชม.
 * ออเดอร์ที่ถูกยกเลิกจะปล่อย hold เองที่ `ShopOrdersService.cancelOrder`
 */
const BANK_TRANSFER_HOLD_MS = 48 * 60 * 60 * 1000;
```

แล้วแก้ branch บรรทัด 158-165:

```ts
    if (dto.paymentChannel === PaymentChannel.BANK_TRANSFER) {
      await this.prisma.productReservation.updateMany({
        where: { id: reservation.id, status: 'ACTIVE' },
        data: { expiresAt: new Date(Date.now() + BANK_TRANSFER_HOLD_MS) },
      });
      return {
        orderNumber: order.orderNumber,
        orderId: order.id,
        totalAmount,
        paymentChannel: dto.paymentChannel,
      };
    }
```

- [ ] **Step 7:** เพิ่มเทสต์ใน `apps/api/src/modules/shop-checkout/shop-checkout.service.spec.ts` (ท้าย describe `placeOrder`) — ต้องมี `productReservation.updateMany` ใน `prismaMock` อยู่แล้ว (บรรทัด 17):

```ts
    it('BANK_TRANSFER: ยืด hold เป็น 48 ชม. ก่อนคืนผลลัพธ์ (ไม่ให้ของหลุดระหว่างรอสลิป)', async () => {
      prismaMock.productReservation.findUnique.mockResolvedValue({
        id: 'r1', productId: 'p1', status: 'ACTIVE',
        expiresAt: new Date(Date.now() + 60000), customerId: null,
        product: { cashPrice: 10000 },
      });
      shippingMock.quote.mockReturnValue({ fee: 0 });
      prismaMock.onlineOrder.create.mockResolvedValue({ id: 'oo-1', orderNumber: 'OO-1' });
      prismaMock.productReservation.updateMany.mockResolvedValue({ count: 1 });

      await service.placeOrder({
        reservationId: 'r1',
        shippingMethod: 'BRANCH_PICKUP',
        shippingAddress: { province: 'ลพบุรี' },
        paymentChannel: 'BANK_TRANSFER',
      } as any, 'cust-1');

      const call = prismaMock.productReservation.updateMany.mock.calls.at(-1)[0];
      expect(call.where).toEqual({ id: 'r1', status: 'ACTIVE' });
      const ms = new Date(call.data.expiresAt).getTime() - Date.now();
      expect(ms).toBeGreaterThan(47 * 3600 * 1000);
      expect(ms).toBeLessThanOrEqual(48 * 3600 * 1000);
      expect(paysolutionsMock.createOnlineOrderIntent).not.toHaveBeenCalled();
    });
```

- [ ] **Step 8:** รันผ่าน: `cd apps/api && npx jest src/modules/shop-checkout/shop-checkout.service.spec.ts` → all passed
- [ ] **Step 9:** `cd apps/api && npx tsc --noEmit` → 0; Commit: `fix(b5): confirmBankTransfer วิ่ง path เดียวกับ gateway + ยืด hold โอนเงิน 48 ชม.`

---

### Task 5: Preempt in-tx — sale-writer 3 ทาง + ของแถม (behavior-preserving)

**Files:**
- Modify: `apps/api/src/modules/sales/services/sale-writer.service.ts` (import หลังบรรทัด 18, `markBundleProductsSold` บรรทัด 112-116, `createCashSale` บรรทัด 146-149, `createInstallmentSale` บรรทัด 326-329, `createExternalFinanceSale` บรรทัด 444-447)
- Modify: `apps/api/src/modules/sales/services/sale-writer.service.spec.ts` (tx mock บรรทัด 46-67, เพิ่มเทสต์ท้ายไฟล์)

**Interfaces:**
- Consumes: `preemptReservationsInTx(tx, productIds)` (Task 2)
- Produces: ไม่มี API ใหม่ — พฤติกรรมเงิน/JE **ต้องเท่าเดิมทุกบาท** (พิสูจน์ด้วยเทสต์ (a)-(d) เดิมที่ห้ามแก้ assertion)

- [ ] **Step 1:** เสริม tx mock ใน `sale-writer.service.spec.ts` (บรรทัด 46-67) ให้มี `productReservation` — ยังไม่แตะ assertion เดิม (แทรกต่อจาก block `salesCommission` ที่บรรทัด 64-66):

```ts
      commissionRule: {
        findFirst: jest.fn().mockResolvedValue(mockCommissionRule),
      },
      salesCommission: {
        create: jest.fn().mockResolvedValue({}),
      },
      productReservation: {
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
```

- [ ] **Step 1b:** **ขยาย outer `prisma` mock (บรรทัด 69-73) ให้ครบ — บังคับ** เพราะไฟล์นี้เดิมเทสต์แค่ `createCashSale` ซึ่งไม่แตะ `this.prisma` เลยนอกจาก `$transaction`; แต่ `createInstallmentSale` เรียก `this.prisma.product.findUnique` (`sale-writer.service.ts:222`), `this.prisma.interestConfig.findFirst` (:224), `loadInstallmentConfig(this.prisma)` → `systemConfig.findMany` (:229), `resolveVatPctForBranch(this.prisma, …)` → `branch.findUnique` (:233). ถ้าไม่เติม เทสต์ (f) จะพังเป็น `TypeError: Cannot read properties of undefined` ไม่ใช่ assertion ที่ต้องการ:

```ts
    prisma = {
      $transaction: jest.fn().mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) =>
        cb(tx),
      ),
      // createInstallmentSale reads these BEFORE opening its $transaction.
      // interestConfig = null → params fall back to config.util DEFAULTS
      // (minDownPaymentPct 0.15 / months 6-12) และ getRateForMonths ไม่ถูกเรียก
      // → เลขเงินคุมได้จาก DTO อย่างเดียว ไม่มี I/O ซ่อน
      product: { findUnique: jest.fn().mockResolvedValue(null) },
      interestConfig: { findFirst: jest.fn().mockResolvedValue(null) },
      systemConfig: { findMany: jest.fn().mockResolvedValue([]) },
      branch: { findUnique: jest.fn().mockResolvedValue(null) },
    };
```

- [ ] **Step 2:** เพิ่มเทสต์ที่ต้อง fail ท้ายไฟล์ `sale-writer.service.spec.ts` (ก่อน `});` ปิด describe ที่บรรทัด 305):

```ts
  // ───────────────────────────────────────────────────────────────────────────
  // (e) B5 — preempt hold ของเว็บใน tx เดียวกับที่เครื่องออกจาก IN_STOCK
  // ───────────────────────────────────────────────────────────────────────────

  it('(e) createCashSale: ตัด hold ของเครื่องหลัก + ของแถม ภายใน tx เดียวกัน', async () => {
    tx.product.findMany
      .mockResolvedValueOnce([{ id: 'p2', status: 'IN_STOCK', name: 'Case' }])
      .mockResolvedValueOnce([
        { id: 'p1', category: 'PHONE_NEW', costPrice: new Decimal(7000) },
        { id: 'p2', category: 'ACCESSORY', costPrice: new Decimal(500) },
      ]);
    tx.productReservation.findMany
      .mockResolvedValueOnce([{ id: 'hold-bundle' }])
      .mockResolvedValueOnce([{ id: 'hold-main' }]);
    tx.productReservation.updateMany.mockResolvedValue({ count: 1 });

    await service.createCashSale(
      {
        productId: 'p1', branchId: 'br-1', customerId: 'c1',
        sellingPrice: 10000, bundleProductIds: ['p2'], paymentMethod: 'CASH',
      } as any,
      'sp-1', 10000, 0,
    );

    // ของแถมถูกตัดก่อน (ใน markBundleProductsSold) แล้วเครื่องหลักตามหลัง product.update
    expect(tx.productReservation.findMany).toHaveBeenNthCalledWith(1, {
      where: { productId: { in: ['p2'] }, status: 'ACTIVE' },
      select: { id: true },
    });
    expect(tx.productReservation.findMany).toHaveBeenNthCalledWith(2, {
      where: { productId: { in: ['p1'] }, status: 'ACTIVE' },
      select: { id: true },
    });
    expect(tx.productReservation.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['hold-main'] }, status: 'ACTIVE' },
      data: { status: 'PREEMPTED' },
    });
  });

  it('(f) createInstallmentSale: ตัด hold หลัง flip เครื่องเป็น RESERVED', async () => {
    // downPayment 3000 = 15% ของ 20000 พอดี = ค่า DEFAULTS.minDownPaymentPct
    // (config.util.ts:183) → ผ่านเงื่อนไข `downPayment < netAmount * pct` แบบเฉียดฉิว
    // ห้ามลดเลขนี้ ไม่งั้นจะโดน BadRequestException 'เงินดาวน์ขั้นต่ำ 15%' แทน
    tx.contract = { create: jest.fn().mockResolvedValue({ id: 'ct-1', salespersonId: 'sp-1' }) };
    tx.payment = { createMany: jest.fn().mockResolvedValue({ count: 12 }) };
    tx.financeReceivable = { create: jest.fn().mockResolvedValue({}) };
    tx.externalFinanceCompany = { upsert: jest.fn().mockResolvedValue({ id: 'ef-1' }) };
    tx.productReservation.findMany.mockResolvedValue([{ id: 'hold-1' }]);
    tx.productReservation.updateMany.mockResolvedValue({ count: 1 });

    await service.createInstallmentSale(
      {
        productId: 'p1', branchId: 'br-1', customerId: 'c1', sellingPrice: 20000,
        bundleProductIds: [], downPayment: 3000, totalMonths: 12, paymentMethod: 'CASH',
      } as any,
      'sp-1', 20000, 0,
    );

    expect(tx.productReservation.findMany).toHaveBeenCalledWith({
      where: { productId: { in: ['p1'] }, status: 'ACTIVE' },
      select: { id: true },
    });
    expect(tx.productReservation.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['hold-1'] }, status: 'ACTIVE' },
      data: { status: 'PREEMPTED' },
    });
  });

  it('(g) createExternalFinanceSale: ตัด hold หลัง flip เป็น SOLD_INSTALLMENT', async () => {
    tx.financeReceivable = { create: jest.fn().mockResolvedValue({}) };
    tx.externalFinanceCompany = { upsert: jest.fn().mockResolvedValue({ id: 'ef-1' }) };
    tx.productReservation.findMany.mockResolvedValue([{ id: 'hold-2' }]);
    tx.productReservation.updateMany.mockResolvedValue({ count: 1 });

    await service.createExternalFinanceSale(
      {
        productId: 'p1', branchId: 'br-1', customerId: 'c1', sellingPrice: 15000,
        bundleProductIds: [], financeCompany: 'GFIN', downPayment: 2000, paymentMethod: 'CASH',
      } as any,
      'sp-1', 15000, 0,
    );

    expect(tx.productReservation.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['hold-2'] }, status: 'ACTIVE' },
      data: { status: 'PREEMPTED' },
    });
  });
```

- [ ] **Step 3:** รันให้เห็น fail: `cd apps/api && npx jest src/modules/sales/services/sale-writer.service.spec.ts` → (e)(f)(g) fail, (a)-(d) ยังเขียว
- [ ] **Step 4:** เพิ่ม import ใน `sale-writer.service.ts` ต่อจากบรรทัด 18:

```ts
import { preemptReservationsInTx } from '../../../utils/reservation-preempt.util';
```

- [ ] **Step 5:** เติม preempt ต่อท้าย `markBundleProductsSold` (หลังบรรทัด 115 `});`):

```ts
    // Update all bundle products to SOLD_CASH
    await tx.product.updateMany({
      where: { id: { in: bundleProductIds } },
      data: { status: 'SOLD_CASH' },
    });
    // B5: ของแถมออกจาก IN_STOCK แล้ว — ตัด hold ของเว็บใน tx เดียวกัน (กันขายซ้ำ)
    await preemptReservationsInTx(tx, bundleProductIds);
  }
```

- [ ] **Step 6:** เติม preempt ใน `createCashSale` ต่อจาก `tx.product.update` (หลังบรรทัด 149 `});`):

```ts
      // Update product status to SOLD_CASH
      await tx.product.update({
        where: { id: dto.productId },
        data: { status: 'SOLD_CASH' },
      });
      // B5: เครื่องหลุดจาก IN_STOCK แล้ว — ตัด hold ของเว็บใน tx เดียวกัน
      await preemptReservationsInTx(tx, [dto.productId]);
```

- [ ] **Step 7:** เติม preempt ใน `createInstallmentSale` ต่อจาก `tx.product.update({... 'RESERVED'})` (หลังบรรทัด 329 `});`):

```ts
      // Reserve product
      await tx.product.update({
        where: { id: dto.productId },
        data: { status: 'RESERVED' },
      });
      // B5: เครื่องหลุดจาก IN_STOCK แล้ว — ตัด hold ของเว็บใน tx เดียวกัน
      await preemptReservationsInTx(tx, [dto.productId]);
```

- [ ] **Step 8:** เติม preempt ใน `createExternalFinanceSale` ต่อจาก `tx.product.update({... 'SOLD_INSTALLMENT'})` (หลังบรรทัด 447 `});`):

```ts
      // Update product status
      await tx.product.update({
        where: { id: dto.productId },
        data: { status: 'SOLD_INSTALLMENT' },
      });
      // B5: เครื่องหลุดจาก IN_STOCK แล้ว — ตัด hold ของเว็บใน tx เดียวกัน
      await preemptReservationsInTx(tx, [dto.productId]);
```

- [ ] **Step 9:** รันผ่านทั้งไฟล์: `cd apps/api && npx jest src/modules/sales/services/sale-writer.service.spec.ts` → 7 passed
- [ ] **Step 10:** **ยืนยัน red line** — รันชุดเงินทั้ง sales module ต้องเขียวโดยไม่แก้ assertion ใดๆ:

```bash
cd apps/api && npx jest src/modules/sales
```
คาดหวัง: ทุกชุดผ่าน + เทสต์ (a)-(d) ใน sale-writer (พิน `idempotencyKey` / `revenueAmount` / `inventoryCost` / `cashAccountCode`) ยังคงค่าเดิมทุกตัว = JE ไม่ขยับแม้บาทเดียว

- [ ] **Step 11:** Commit: `feat(b5): ตัด hold เว็บใน tx ของ sale-writer 3 ทาง + ของแถม (behavior-preserving)`

---

### Task 6: Preempt in-tx — contract-lifecycle (สร้างสัญญา)

**Files:**
- Modify: `apps/api/src/modules/contracts/services/contract-lifecycle.service.ts` (import หลังบรรทัด 17, `create` ช่วง reserve product บรรทัด 236-240)
- Modify: `apps/api/src/modules/contracts/services/contract-lifecycle.service.spec.ts` (tx mock บรรทัด 137-173, เพิ่มเทสต์ท้ายไฟล์)

**Interfaces:**
- Consumes: `preemptReservationsInTx(tx, [dto.productId])` (Task 2)
- Produces: ไม่มี API ใหม่ — down-payment JE + ตารางงวด **ต้องเท่าเดิม** (เทสต์ ShopDownPayment เดิมห้ามแก้)

- [ ] **Step 1:** เสริม tx mock ใน spec (block `product:` บรรทัด 143-147) ให้มี `productReservation` ต่อท้าย — outer `prisma` mock ไม่ต้องแตะ (มี `product/interestConfig/systemConfig/$transaction` ครบแล้วที่บรรทัด 176-190 และ `config.util`/`installment.util` ถูก `jest.mock` ทั้งไฟล์ที่บรรทัด 22-56):

```ts
      product: {
        findUnique: jest.fn().mockResolvedValue(mockProduct),
        update: jest.fn().mockResolvedValue({ ...mockProduct, status: 'RESERVED' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      productReservation: {
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
```

- [ ] **Step 2:** เพิ่มเทสต์ที่ต้อง fail ท้ายไฟล์ spec:

```ts
  it('B5: create() ตัด hold ของเว็บใน tx เดียวกับที่ flip เครื่องเป็น RESERVED (ไม่กระทบ JE ดาวน์)', async () => {
    tx.productReservation.findMany.mockResolvedValue([{ id: 'hold-1' }]);
    tx.productReservation.updateMany.mockResolvedValue({ count: 1 });

    // เรียกด้วย 2 args เหมือนเทสต์เดิมทั้งไฟล์ — signature จริงคือ
    // create(dto, salespersonId, salespersonRole?) และไม่ต้องส่ง role เพราะ
    // prisma.contract.findMany คืน [] อยู่แล้ว = ไม่มีสัญญา active ให้ override
    await service.create({ ...baseDto } as any, 'sp-1');

    expect(tx.productReservation.findMany).toHaveBeenCalledWith({
      where: { productId: { in: ['prod-1'] }, status: 'ACTIVE' },
      select: { id: true },
    });
    expect(tx.productReservation.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['hold-1'] }, status: 'ACTIVE' },
      data: { status: 'PREEMPTED' },
    });
    // red line: JE เงินดาวน์ยังยิงเหมือนเดิมทุกประการ
    expect(shopDownPaymentTemplate.execute).toHaveBeenCalledTimes(1);
    // cast แบบเดียวกับเทสต์เดิมในไฟล์ (shopDownPaymentTemplate ถูก type เป็น
    // jest.Mocked<Pick<…,'execute'>> — เข้า .mock ตรงๆ ไม่ผ่าน tsc)
    const input = (shopDownPaymentTemplate.execute as jest.Mock).mock.calls[0][0];
    expect(input.idempotencyKey).toBe('shop-down-payment:c-1');
    expect(input.downAmount.toString()).toBe('2000');
  });

  it('B5: ไม่มี hold ค้าง → ไม่ยิง updateMany เปล่า', async () => {
    tx.productReservation.findMany.mockResolvedValue([]);
    await service.create({ ...baseDto } as any, 'sp-1');
    expect(tx.productReservation.updateMany).not.toHaveBeenCalled();
  });
```

- [ ] **Step 3:** รันให้เห็น fail: `cd apps/api && npx jest src/modules/contracts/services/contract-lifecycle.service.spec.ts`
- [ ] **Step 4:** เพิ่ม import ใน `contract-lifecycle.service.ts` ต่อจากบรรทัด 17:

```ts
import { preemptReservationsInTx } from '../../../utils/reservation-preempt.util';
```

- [ ] **Step 5:** เติม preempt ต่อจาก reserve product (หลังบรรทัด 240 `});`):

```ts
          // Reserve product
          await tx.product.update({
            where: { id: dto.productId },
            data: { status: 'RESERVED' },
          });
          // B5: เครื่องหลุดจาก IN_STOCK แล้ว — ตัด hold ของเว็บใน tx เดียวกัน (กันขายซ้ำ)
          await preemptReservationsInTx(tx, [dto.productId]);
```

- [ ] **Step 6:** รันผ่าน: `cd apps/api && npx jest src/modules/contracts/services/contract-lifecycle.service.spec.ts` → all passed
- [ ] **Step 7:** **ยืนยัน red line**: `cd apps/api && npx jest src/modules/contracts` → ทุกชุดเขียว (รวม `contracts.service.spec.ts` / early-payoff money specs) โดยไม่แก้ assertion
- [ ] **Step 8:** `cd apps/api && npx tsc --noEmit` → 0; Commit: `feat(b5): ตัด hold เว็บใน tx ของ contract create (behavior-preserving)`

---

### Task 7: ข้อความฝั่งลูกค้า — แยก "ถูกตัดหน้า" จาก "หมดอายุ" + ลบ dead code + ปุ่มแชทเมื่อของหมด

**Files:**
- Modify: `apps/api/src/modules/shop-checkout/shop-checkout.service.ts` (`loadActiveReservation` บรรทัด 33-43)
- Modify: `apps/api/src/modules/shop-checkout/shop-checkout.service.spec.ts` (เทสต์ expired เดิม + เทสต์ใหม่)
- Modify: `apps/api/src/modules/shop-reservation/shop-reservation.service.ts` (ลบ `preemptByInStoreSale` บรรทัด 79-84)
- Modify: `apps/api/src/modules/shop-catalog/shop-catalog.service.ts` (`smartStockCount` บรรทัด 290-295)
- Modify: `apps/api/src/modules/shop-catalog/shop-catalog.service.spec.ts` (assertion บรรทัด 391-396)
- Modify: `apps/web-shop/src/components/catalog/ProductCard.tsx` (CTA + คอมเมนต์เหนือมัน บรรทัด 134-145)

**Interfaces:**
- Produces: `loadActiveReservation` โยน `ConflictException('เครื่องนี้เพิ่งถูกขายที่หน้าร้าน — กรุณาเลือกเครื่องอื่น')` เมื่อ `status==='PREEMPTED'`, `BadRequestException('การจองหมดอายุแล้ว — กรุณาเลือกสินค้าใหม่')` เมื่อหมดอายุ/สถานะอื่น
- Consumes (web-shop): `p.stock.tone === 'out'` จาก `GET /api/shop/products` (shape เดิม), `shopInfo.lineUrl` จาก `apps/web-shop/src/lib/copy.ts:13`

- [ ] **Step 1:** เพิ่มเทสต์ที่ต้อง fail ใน `shop-checkout.service.spec.ts` (ใน describe `validatePromoCode` ต่อจากเทสต์ expired เดิม):

```ts
    it('hold โดนตัดหน้า (PREEMPTED) → ข้อความคนละแบบกับหมดอายุ', async () => {
      prismaMock.productReservation.findUnique.mockResolvedValue({
        id: 'r1', status: 'PREEMPTED', expiresAt: new Date(Date.now() + 60000),
        product: { cashPrice: 10000 },
      });
      await expect(
        service.validatePromoCode({ code: 'SAVE10', reservationId: 'r1' })
      ).rejects.toThrow('เครื่องนี้เพิ่งถูกขายที่หน้าร้าน — กรุณาเลือกเครื่องอื่น');
    });

    it('hold หมดอายุ → ข้อความหมดอายุ (ไม่ใช่ข้อความถูกตัดหน้า)', async () => {
      prismaMock.productReservation.findUnique.mockResolvedValue({
        id: 'r1', status: 'ACTIVE', expiresAt: new Date(Date.now() - 60000),
        product: { cashPrice: 10000 },
      });
      await expect(
        service.validatePromoCode({ code: 'SAVE10', reservationId: 'r1' })
      ).rejects.toThrow('การจองหมดอายุแล้ว — กรุณาเลือกสินค้าใหม่');
    });
```

- [ ] **Step 2:** รันให้เห็น fail: `cd apps/api && npx jest src/modules/shop-checkout/shop-checkout.service.spec.ts`
- [ ] **Step 3:** แก้ `loadActiveReservation` (`shop-checkout.service.ts:33-43`) — ต้อง import `ConflictException` เพิ่มที่บรรทัด 1:

```ts
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
```

```ts
  private async loadActiveReservation(reservationId: string) {
    const r = await this.prisma.productReservation.findUnique({
      where: { id: reservationId },
      include: { product: true },
    });
    if (!r) throw new NotFoundException('ไม่พบรายการที่จองไว้');
    // B5: แยกเหตุให้ชัด — "ถูกตัดหน้า" (เครื่องถูกขายที่หน้าร้านระหว่างที่ลูกค้าจ่ายอยู่)
    // คนละเรื่องกับ "หมดอายุ" (ลูกค้าปล่อยจองทิ้งไว้เกิน 15 นาที) ข้อความรวมทำให้ลูกค้า
    // กดจองเครื่องเดิมซ้ำแล้วเจอ error วนอีก
    if (r.status === 'PREEMPTED') {
      throw new ConflictException('เครื่องนี้เพิ่งถูกขายที่หน้าร้าน — กรุณาเลือกเครื่องอื่น');
    }
    if (r.status !== 'ACTIVE' || r.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException('การจองหมดอายุแล้ว — กรุณาเลือกสินค้าใหม่');
    }
    return r;
  }
```

- [ ] **Step 4:** ลบ `preemptByInStoreSale` (`shop-reservation.service.ts:79-84`) ทั้งเมธอด — เป็น dead code ที่ไม่มี caller (`grep -rn "preemptByInStoreSale" apps/api/src` ต้องได้ 0 ผลลัพธ์หลังลบ) และใช้ `this.prisma` จึงเข้า tx ของ caller ไม่ได้ ปล่อยไว้เสี่ยงมีคนหยิบไปใช้ผิด
- [ ] **Step 5:** แก้ dead copy ใน `shop-catalog.service.ts:291` (ไม่มีระบบ back-in-stock — spec §8 ตัดออกแล้ว จึงห้ามสัญญาว่าจะแจ้งเตือน):

```ts
  smartStockCount(n: number): { display: string; tone: 'out' | 'urgent' | 'low' | 'available' } {
    if (n === 0) return { display: 'หมดสต็อก — ทักแชทเช็ครอบเข้าใหม่', tone: 'out' };
    if (n <= 3) return { display: `เหลือ ${n} เครื่อง — ใกล้หมด`, tone: 'urgent' };
    if (n <= 10) return { display: `เหลือ ${n} เครื่อง`, tone: 'low' };
    return { display: 'ในสต็อก พร้อมส่ง', tone: 'available' };
  }
```

- [ ] **Step 6:** แก้ assertion ที่พินข้อความเดิม (`shop-catalog.service.spec.ts:391-396`):

```ts
    it('returns OUT for 0 stock', () => {
      expect(service.smartStockCount(0)).toEqual({
        display: 'หมดสต็อก — ทักแชทเช็ครอบเข้าใหม่',
        tone: 'out',
      });
    });
```

- [ ] **Step 7:** รันผ่านทั้ง 2 ไฟล์:

```bash
cd apps/api && npx jest src/modules/shop-checkout src/modules/shop-catalog src/modules/shop-reservation
```

- [ ] **Step 8:** ทำให้ CTA ตรงกับข้อความ — `apps/web-shop/src/components/catalog/ProductCard.tsx` เพิ่ม import ต่อจากบรรทัด 2 (ไฟล์นี้มีแค่ 2 import: `Link` + `cn`) แล้วแทน block คอมเมนต์+CTA (บรรทัด 134-145):

```tsx
import { Link } from 'react-router';
import { cn } from '@/lib/utils';
import { shopInfo } from '@/lib/copy';   // ← เพิ่มบรรทัดนี้ (lineUrl อยู่ที่ copy.ts:13)
```

```tsx
        {/* CTA button hidden on mobile — whole card is linkable.
           Shown on md+ where grid is sparser and the action affordance helps.
           B5: กลุ่มที่หมดสต็อกไม่มีเครื่องให้เลือก — ปุ่มต้องพาไปทักแชทแทน ไม่ใช่
           พาเข้าหน้าที่ว่างเปล่า (และ copy ก็เลิกสัญญาว่าจะแจ้งเตือนแล้ว) */}
        {p.stock.tone === 'out' ? (
          <a
            href={shopInfo.lineUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="hidden md:inline-flex h-10 px-6 rounded-full border border-foreground/15 text-foreground text-sm font-medium hover:bg-muted transition-colors items-center justify-center"
          >
            ทักแชทเช็ครอบเข้าใหม่
          </a>
        ) : (
          <Link
            to={to}
            aria-hidden="true"
            tabIndex={-1}
            className="hidden md:inline-flex h-10 px-6 rounded-full bg-cta text-cta-foreground text-sm font-medium hover:bg-orange-700 active:bg-orange-700 transition-colors items-center justify-center"
          >
            เลือกเครื่อง
          </Link>
        )}
```

- [ ] **Step 9:** `cd apps/web-shop && npx tsc --noEmit` → 0; `cd apps/api && npx tsc --noEmit` → 0
- [ ] **Step 10:** Commit: `fix(b5): แยกข้อความถูกตัดหน้า/หมดอายุ + ลบ preemptByInStoreSale + CTA เมื่อของหมด`

---

### Task 8: แจ้งลูกค้าเมื่อ hold โดนตัดหน้า (LINE best-effort ผ่าน cron)

**Files:**
- Modify: `apps/api/src/modules/shop-reservation/shop-reservation.service.ts` (import + ctor บรรทัด 1-19, เพิ่มเมธอดท้ายคลาส)
- Modify: `apps/api/src/modules/shop-reservation/reservation-cleanup.cron.ts` (เพิ่ม cron method หลังบรรทัด 21)
- Modify: `apps/api/src/modules/shop-reservation/shop-reservation.module.ts` (imports)
- Modify: `apps/api/src/modules/shop-reservation/shop-reservation.service.spec.ts` (providers บรรทัด 20-23 + describe ใหม่)

**Interfaces:**
- Consumes: `LineOaService.sendFlexMessage(to: string, flexMessage: FlexMessagePayload, channelKey: 'line-shop'): Promise<void>` (`apps/api/src/modules/line-oa/line-oa.service.ts:71-77`), `FlexMessagePayload` จาก `../line-oa/flex-messages/base-template`
- Produces: `ShopReservationService.notifyPreemptedHolds(): Promise<number>` (คืนจำนวนที่ส่ง LINE สำเร็จ), `ReservationCleanupCron.notifyPreemptedHolds()` `@Cron('* * * * *')`

- [ ] **Step 1:** เพิ่มเทสต์ที่ต้อง fail ใน `shop-reservation.service.spec.ts` — ขยาย prisma mock + providers (บรรทัด 10-24) ก่อน:

```ts
  let lineOa: { sendFlexMessage: jest.Mock };

  beforeEach(async () => {
    prisma = {
      product: { findUnique: jest.fn() },
      productReservation: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
    };
    lineOa = { sendFlexMessage: jest.fn().mockResolvedValue(undefined) };
    const module = await Test.createTestingModule({
      providers: [
        ShopReservationService,
        { provide: PrismaService, useValue: prisma },
        { provide: LineOaService, useValue: lineOa },
      ],
    }).compile();
    service = module.get(ShopReservationService);
  });
```

(เพิ่มที่หัวไฟล์ spec: `import { LineOaService } from '../line-oa/line-oa.service';` + stub Sentry แบบเดียวกับ `shop-checkout.service.spec.ts:11-14` เพราะเมธอดใหม่เรียก `Sentry.captureException` ในเคส LINE ล้ม:

```ts
jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn(), captureMessage: jest.fn() }));
```
)

แล้วเพิ่ม describe ใหม่ท้ายไฟล์:

```ts
  describe('notifyPreemptedHolds', () => {
    const hold = (over: any = {}) => ({
      id: 'r1',
      product: { name: 'iPhone 15 128GB' },
      onlineOrder: {
        id: 'oo-1',
        orderNumber: 'OO-2026-0001',
        customer: { lineIdShop: 'U-line' },
      },
      ...over,
    });

    it('ส่ง LINE ให้ลูกค้าที่มีออเดอร์ผูกอยู่ แล้วสตางค์ preemptNotifiedAt', async () => {
      prisma.productReservation.findMany.mockResolvedValue([hold()]);
      prisma.productReservation.update.mockResolvedValue({});

      expect(await service.notifyPreemptedHolds()).toBe(1);

      expect(lineOa.sendFlexMessage).toHaveBeenCalledTimes(1);
      const [to, flex, channel] = lineOa.sendFlexMessage.mock.calls[0];
      expect(to).toBe('U-line');
      expect(channel).toBe('line-shop');
      expect(JSON.stringify(flex)).toContain('iPhone 15 128GB');
      expect(prisma.productReservation.update).toHaveBeenCalledWith({
        where: { id: 'r1' },
        data: { preemptNotifiedAt: expect.any(Date) },
      });
    });

    it('hold anonymous (ไม่มีออเดอร์) → ไม่ส่ง LINE แต่ยังสตางค์ไม่ให้ scan ซ้ำ', async () => {
      prisma.productReservation.findMany.mockResolvedValue([hold({ onlineOrder: null })]);
      prisma.productReservation.update.mockResolvedValue({});

      expect(await service.notifyPreemptedHolds()).toBe(0);
      expect(lineOa.sendFlexMessage).not.toHaveBeenCalled();
      expect(prisma.productReservation.update).toHaveBeenCalledWith({
        where: { id: 'r1' },
        data: { preemptNotifiedAt: expect.any(Date) },
      });
    });

    it('LINE ล้ม → ไม่ throw และยังสตางค์ (best-effort ไม่วนแจ้งซ้ำ)', async () => {
      prisma.productReservation.findMany.mockResolvedValue([hold()]);
      lineOa.sendFlexMessage.mockRejectedValue(new Error('line down'));
      prisma.productReservation.update.mockResolvedValue({});

      await expect(service.notifyPreemptedHolds()).resolves.toBe(0);
      expect(prisma.productReservation.update).toHaveBeenCalled();
    });

    it('query เฉพาะ PREEMPTED ที่ยังไม่แจ้ง และไม่เก่าเกินหน้าต่างเวลา', async () => {
      prisma.productReservation.findMany.mockResolvedValue([]);
      await service.notifyPreemptedHolds();
      const where = prisma.productReservation.findMany.mock.calls[0][0].where;
      expect(where.status).toBe('PREEMPTED');
      expect(where.preemptNotifiedAt).toBeNull();
      expect(where.updatedAt.gt).toBeInstanceOf(Date);
    });
  });
```

- [ ] **Step 2:** รันให้เห็น fail: `cd apps/api && npx jest src/modules/shop-reservation/shop-reservation.service.spec.ts`
- [ ] **Step 3:** แก้หัวไฟล์ `shop-reservation.service.ts` (บรรทัด 1-19):

```ts
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../../prisma/prisma.service';
import { LineOaService } from '../line-oa/line-oa.service';
import { FlexMessagePayload } from '../line-oa/flex-messages/base-template';

const RESERVATION_DURATION_MS = 15 * 60 * 1000; // 15 minutes
/** หน้าต่างเวลาที่ยังคุ้มจะแจ้ง — เกินนี้ลูกค้าน่าจะรู้เองแล้ว (และกันยิงย้อนหลังตอน deploy) */
const PREEMPT_NOTIFY_LOOKBACK_MS = 24 * 60 * 60 * 1000;
const PREEMPT_NOTIFY_BATCH = 50;

export interface ReserveInput {
  productId: string;
  sessionId: string;
  customerId?: string;
}

@Injectable()
export class ShopReservationService {
  private readonly logger = new Logger(ShopReservationService.name);

  constructor(
    private prisma: PrismaService,
    private lineOa: LineOaService,
  ) {}
```

- [ ] **Step 4:** เพิ่มเมธอดท้ายคลาส (แทนที่ตำแหน่ง `preemptByInStoreSale` ที่ลบไปใน Task 7):

```ts
  /**
   * แจ้งลูกค้าที่ hold โดนตัดหน้า (PREEMPTED) — best-effort ทาง LINE
   *
   * ทำเป็น cron แทนการยิงหลัง commit ใน sale-writer/contract-lifecycle เพราะ
   * (ก) โมดูลเงินไม่ควรผูกกับ LineOaService และ (ข) `preemptNotifiedAt` ทำให้ retry
   * ปลอดภัย — ยิงพลาดครั้งเดียวไม่วนซ้ำ และ deploy ใหม่ไม่ยิงย้อนหลังทั้งกอง
   *
   * ลูกค้าที่จองแบบ anonymous (ไม่มีออเดอร์) ไม่มีช่องทางติดต่อ — ตะกร้าฝั่งเว็บ
   * self-correct เองจาก poll 5 วินาที (`apps/web-shop/src/hooks/useCart.ts:32`)
   */
  async notifyPreemptedHolds(): Promise<number> {
    const holds = await this.prisma.productReservation.findMany({
      where: {
        status: 'PREEMPTED',
        preemptNotifiedAt: null,
        updatedAt: { gt: new Date(Date.now() - PREEMPT_NOTIFY_LOOKBACK_MS) },
      },
      select: {
        id: true,
        product: { select: { name: true } },
        onlineOrder: {
          select: {
            id: true,
            orderNumber: true,
            customer: { select: { lineIdShop: true } },
          },
        },
      },
      take: PREEMPT_NOTIFY_BATCH,
    });

    let sent = 0;
    for (const hold of holds) {
      const lineId = hold.onlineOrder?.customer?.lineIdShop;
      if (lineId) {
        try {
          await this.lineOa.sendFlexMessage(
            lineId,
            this.buildHoldPreemptedFlex({
              productName: hold.product?.name ?? 'สินค้าที่จองไว้',
              orderNumber: hold.onlineOrder?.orderNumber ?? null,
            }),
            'line-shop',
          );
          sent++;
        } catch (err) {
          this.logger.warn(`Failed to notify preempted hold ${hold.id}: ${err}`);
          Sentry.captureException(err, {
            level: 'warning',
            tags: { critical: 'hold-preempt-notify-failed' },
            extra: { reservationId: hold.id },
          });
        }
      }
      // สตางค์เสมอ แม้ไม่มีช่องทางส่ง/ส่งไม่สำเร็จ — ไม่งั้น cron จะวน scan แถวเดิมทุกนาที
      await this.prisma.productReservation.update({
        where: { id: hold.id },
        data: { preemptNotifiedAt: new Date() },
      });
    }
    return sent;
  }

  private buildHoldPreemptedFlex(input: {
    productName: string;
    orderNumber: string | null;
  }): FlexMessagePayload {
    return {
      type: 'flex',
      altText: `${input.productName} ถูกจำหน่ายไปก่อน — กรุณาเลือกเครื่องอื่น`,
      contents: {
        type: 'bubble',
        body: {
          type: 'box',
          layout: 'vertical',
          contents: [
            { type: 'text', text: 'เครื่องที่จองไว้ถูกจำหน่ายแล้ว', weight: 'bold', size: 'lg', wrap: true },
            { type: 'text', text: input.productName, size: 'sm', color: '#666666', margin: 'md', wrap: true },
            ...(input.orderNumber
              ? [{ type: 'text' as const, text: `คำสั่งซื้อ ${input.orderNumber}`, size: 'sm' as const, margin: 'sm' as const }]
              : []),
            { type: 'separator', margin: 'md' },
            {
              type: 'text',
              text: 'มีลูกค้าซื้อที่หน้าร้านก่อนพอดี ขออภัยจริงๆ ครับ/ค่ะ — ยังมีเครื่องรุ่นเดียวกันเครื่องอื่นอยู่ ทักแชทมาได้เลย',
              size: 'sm',
              margin: 'md',
              wrap: true,
            },
          ],
        },
      },
    };
  }
```

- [ ] **Step 5:** เพิ่ม cron ใน `reservation-cleanup.cron.ts` — วางต่อจากเมธอด `expireOldReservations` (ปิดที่บรรทัด 21) ก่อน `}` ปิดคลาสบรรทัด 22; `Cron`/`Logger`/`Sentry` import ครบแล้ว (ไฟล์นี้ใช้ `@sentry/node` ส่วน service ใช้ `@sentry/nestjs` — ต่างไฟล์ ต่างแพ็กเกจ ปล่อยไว้ตามเดิม ไม่ต้องรวม):

```ts
  /**
   * B5: แจ้งลูกค้าที่ hold โดนตัดหน้า — ทุก 1 นาที (ลูกค้าที่กำลังจ่ายเงินอยู่รอ 5 นาทีไม่ไหว)
   * งานเบามาก: query มี index `(status, preempt_notified_at)` และปกติได้ 0 แถว
   */
  @Cron('* * * * *', { timeZone: 'Asia/Bangkok' })
  async notifyPreemptedHolds(): Promise<void> {
    try {
      const sent = await this.reservationService.notifyPreemptedHolds();
      if (sent > 0) this.logger.log(`Notified ${sent} preempted holds`);
    } catch (err) {
      this.logger.error(`Preempt-notify cron failed: ${(err as Error).message}`);
      Sentry.captureException(err);
    }
  }
```

- [ ] **Step 6:** แก้ `shop-reservation.module.ts` ให้ import `LineOaModule` (`LineOaModule` export `LineOaService` อยู่แล้ว — `line-oa.module.ts:62`; import แบบตรงๆ ไม่ต้อง `forwardRef` เพราะ `ShopReservationModule` ถูกอ้างถึงจาก `app.module.ts` ที่เดียว ไม่มีวงจร — precedent: `shop-installment-apply.module.ts:10` `imports: [PrismaModule, LineOaModule, AuthModule]`):

```ts
import { Module } from '@nestjs/common';
import { ShopReservationController } from './shop-reservation.controller';
import { ShopReservationService } from './shop-reservation.service';
import { ReservationCleanupCron } from './reservation-cleanup.cron';
import { PrismaModule } from '../../prisma/prisma.module';
import { LineOaModule } from '../line-oa/line-oa.module';

@Module({
  imports: [PrismaModule, LineOaModule],
  controllers: [ShopReservationController],
  providers: [ShopReservationService, ReservationCleanupCron],
  exports: [ShopReservationService],
})
export class ShopReservationModule {}
```

- [ ] **Step 7:** รันผ่าน: `cd apps/api && npx jest src/modules/shop-reservation` → all passed (เทสต์ reserve/cancel/expire เดิมต้องเขียวโดยไม่แก้ assertion)
- [ ] **Step 8:** `cd apps/api && npx tsc --noEmit` → 0; Commit: `feat(b5): cron แจ้งลูกค้าเมื่อ hold โดนตัดหน้า (LINE best-effort + idempotent)`

---

### Task 9: Admin API — รายการ hold จากเว็บ + ปุ่มปลด hold

**Files:**
- Modify: `apps/api/src/modules/shop-reservation/shop-reservation.service.ts` (เพิ่ม 2 เมธอด + inject `AuditService`)
- Create: `apps/api/src/modules/shop-reservation/shop-reservation.admin.controller.ts`
- Modify: `apps/api/src/modules/shop-reservation/shop-reservation.module.ts` (controllers + `AuthModule`)
- Modify: `apps/api/src/modules/shop-reservation/shop-reservation.service.spec.ts` (providers + describe ใหม่)

**Interfaces:**
- Consumes: `AuditService.log({ userId, action, entity, entityId, newValue })` (`apps/api/src/modules/audit/audit.service.ts:59`; `AuditModule` เป็น `@Global` → ไม่ต้อง import module)
- Produces:
```ts
interface AdminHoldRow {
  id: string; productId: string; productName: string; imeiLast4: string | null;
  branchName: string | null; status: string;
  reservedAt: Date; expiresAt: Date; secondsRemaining: number;
  source: 'ORDER' | 'APPLICATION' | 'UNLINKED';
  orderNumber: string | null; applicationNumber: string | null;
  customerName: string | null;   // null เสมอเมื่อ source = UNLINKED (hold เว็บ anonymous)
}
listAdminHolds(filter: { status?: string; productId?: string }): Promise<AdminHoldRow[]>
releaseHold(reservationId: string, adminUserId: string): Promise<{ released: true }>
```
- REST: `GET /api/admin/product-holds?status=&productId=` (OWNER/BM/FM/ACC/SALES), `PATCH /api/admin/product-holds/:id/release` (OWNER/BM)

- [ ] **Step 1:** เพิ่มเทสต์ที่ต้อง fail ท้าย `shop-reservation.service.spec.ts` (เพิ่ม `{ provide: AuditService, useValue: audit }` ใน providers + `audit = { log: jest.fn() }` ใน beforeEach ด้วย):

```ts
  describe('listAdminHolds', () => {
    it('แปลงแถวเป็นรูปแบบแอดมิน + ระบุที่มา + ชื่อลูกค้าเฉพาะเมื่อมีออเดอร์/ใบสมัคร', async () => {
      const soon = new Date(Date.now() + 600_000);
      prisma.productReservation.findMany.mockResolvedValue([
        {
          id: 'r1', productId: 'p1', status: 'ACTIVE',
          reservedAt: new Date(), expiresAt: soon,
          product: { name: 'iPhone 15', imeiSerial: '356789012345678', branch: { name: 'ลาดพร้าว' } },
          onlineOrder: { orderNumber: 'OO-1', customer: { name: 'สมชาย' } },
          onlineApplication: null,
        },
        {
          id: 'r2', productId: 'p2', status: 'ACTIVE',
          reservedAt: new Date(), expiresAt: soon,
          product: { name: 'iPhone 14', imeiSerial: null, branch: null },
          onlineOrder: null, onlineApplication: null,
        },
      ]);

      const rows = await service.listAdminHolds({});

      expect(rows[0]).toMatchObject({
        id: 'r1', productName: 'iPhone 15', imeiLast4: '5678', branchName: 'ลาดพร้าว',
        source: 'ORDER', orderNumber: 'OO-1', customerName: 'สมชาย',
      });
      expect(rows[0].secondsRemaining).toBeGreaterThan(0);
      expect(rows[1]).toMatchObject({
        source: 'UNLINKED', customerName: null, orderNumber: null, imeiLast4: null,
      });
    });

    it('กรองตาม productId ได้', async () => {
      prisma.productReservation.findMany.mockResolvedValue([]);
      await service.listAdminHolds({ productId: 'p1', status: 'ACTIVE' });
      const where = prisma.productReservation.findMany.mock.calls[0][0].where;
      expect(where).toMatchObject({ productId: 'p1', status: 'ACTIVE' });
    });
  });

  describe('releaseHold', () => {
    it('ปลด hold ที่ยัง ACTIVE และไม่มีออเดอร์ค้าง', async () => {
      prisma.productReservation.findUnique.mockResolvedValue({
        id: 'r1', status: 'ACTIVE', productId: 'p1', onlineOrder: null,
      });
      prisma.productReservation.updateMany.mockResolvedValue({ count: 1 });

      expect(await service.releaseHold('r1', 'admin-1')).toEqual({ released: true });
      expect(prisma.productReservation.updateMany).toHaveBeenCalledWith({
        where: { id: 'r1', status: 'ACTIVE' },
        data: { status: 'CANCELLED' },
      });
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'HOLD_RELEASED', entity: 'product_reservation', entityId: 'r1' }),
      );
    });

    it('มีออเดอร์ที่ยังไม่ถูกยกเลิกผูกอยู่ → ปฏิเสธ (กันปลดทิ้งทั้งที่ลูกค้ากำลังจ่าย)', async () => {
      prisma.productReservation.findUnique.mockResolvedValue({
        id: 'r1', status: 'ACTIVE', productId: 'p1',
        onlineOrder: { orderNumber: 'OO-1', status: 'PENDING_BANK_REVIEW' },
      });
      await expect(service.releaseHold('r1', 'admin-1')).rejects.toThrow(ConflictException);
      expect(prisma.productReservation.updateMany).not.toHaveBeenCalled();
    });

    it('hold ไม่ ACTIVE แล้ว → NotFound', async () => {
      prisma.productReservation.findUnique.mockResolvedValue({
        id: 'r1', status: 'CONSUMED', productId: 'p1', onlineOrder: null,
      });
      await expect(service.releaseHold('r1', 'admin-1')).rejects.toThrow(NotFoundException);
    });
  });
```

(เพิ่ม `findUnique: jest.fn()` ใน `prisma.productReservation` mock ด้วย)

- [ ] **Step 2:** รันให้เห็น fail: `cd apps/api && npx jest src/modules/shop-reservation/shop-reservation.service.spec.ts`
- [ ] **Step 3:** เพิ่ม `AuditService` ใน ctor ของ `ShopReservationService`:

```ts
import { AuditService } from '../audit/audit.service';
```
```ts
  constructor(
    private prisma: PrismaService,
    private lineOa: LineOaService,
    private audit: AuditService,
  ) {}
```

- [ ] **Step 4:** เพิ่ม 2 เมธอดท้ายคลาส:

```ts
  /**
   * รายการ hold สำหรับแอดมิน — แสดงเท่าที่มีข้อมูลจริง: hold ของเว็บเป็น anonymous
   * (DTO มีแค่ productId + sessionId) ชื่อลูกค้าจึงโผล่เฉพาะเมื่อ hold ถูกผูกกับ
   * ออเดอร์หรือใบสมัครผ่อนแล้วเท่านั้น — ห้ามเดา/ห้ามโชว์ sessionId เป็นตัวแทนคน
   */
  async listAdminHolds(filter: { status?: string; productId?: string }) {
    const rows = await this.prisma.productReservation.findMany({
      where: {
        ...(filter.status ? { status: filter.status as never } : { status: 'ACTIVE' }),
        ...(filter.productId ? { productId: filter.productId } : {}),
      },
      select: {
        id: true,
        productId: true,
        status: true,
        reservedAt: true,
        expiresAt: true,
        product: {
          select: { name: true, imeiSerial: true, branch: { select: { name: true } } },
        },
        onlineOrder: { select: { orderNumber: true, customer: { select: { name: true } } } },
        onlineApplication: { select: { applicationNumber: true, fullName: true } },
      },
      orderBy: { reservedAt: 'desc' },
      take: 200,
    });

    const now = Date.now();
    return rows.map((r) => {
      const source: 'ORDER' | 'APPLICATION' | 'UNLINKED' = r.onlineOrder
        ? 'ORDER'
        : r.onlineApplication
          ? 'APPLICATION'
          : 'UNLINKED';
      return {
        id: r.id,
        productId: r.productId,
        productName: r.product?.name ?? '-',
        imeiLast4: r.product?.imeiSerial ? r.product.imeiSerial.slice(-4) : null,
        branchName: r.product?.branch?.name ?? null,
        status: r.status,
        reservedAt: r.reservedAt,
        expiresAt: r.expiresAt,
        secondsRemaining: Math.max(0, Math.floor((r.expiresAt.getTime() - now) / 1000)),
        source,
        orderNumber: r.onlineOrder?.orderNumber ?? null,
        applicationNumber: r.onlineApplication?.applicationNumber ?? null,
        customerName: r.onlineOrder?.customer?.name ?? r.onlineApplication?.fullName ?? null,
      };
    });
  }

  /** ปลด hold ด้วยมือ (OWNER/BM) — ใช้เมื่อลูกค้าหน้าร้านยืนรออยู่และ hold เว็บค้างอยู่ */
  async releaseHold(reservationId: string, adminUserId: string) {
    const hold = await this.prisma.productReservation.findUnique({
      where: { id: reservationId },
      select: {
        id: true,
        status: true,
        productId: true,
        onlineOrder: { select: { orderNumber: true, status: true } },
      },
    });
    if (!hold || hold.status !== 'ACTIVE') {
      throw new NotFoundException('ไม่พบการจองที่ปลดได้ (อาจถูกใช้/หมดอายุไปแล้ว)');
    }
    if (hold.onlineOrder && hold.onlineOrder.status !== 'CANCELLED') {
      throw new ConflictException(
        `การจองนี้ผูกกับคำสั่งซื้อ ${hold.onlineOrder.orderNumber} ที่ยังไม่ถูกยกเลิก — ยกเลิกคำสั่งซื้อก่อน`,
      );
    }

    const result = await this.prisma.productReservation.updateMany({
      where: { id: reservationId, status: 'ACTIVE' },
      data: { status: 'CANCELLED' },
    });
    if (result.count === 0) {
      throw new NotFoundException('ไม่พบการจองที่ปลดได้ (อาจถูกใช้/หมดอายุไปแล้ว)');
    }

    await this.audit.log({
      userId: adminUserId,
      action: 'HOLD_RELEASED',
      entity: 'product_reservation',
      entityId: reservationId,
      newValue: { productId: hold.productId, status: 'CANCELLED' },
    });
    return { released: true as const };
  }
```

- [ ] **Step 5:** สร้าง `apps/api/src/modules/shop-reservation/shop-reservation.admin.controller.ts`:

```ts
import { Controller, Get, Param, Patch, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { ShopReservationService } from './shop-reservation.service';

/**
 * Admin endpoints สำหรับ hold ของเว็บ
 *
 * เส้นทางจริง: axios baseURL = '/api/admin' (apps/web/src/lib/env.ts:14) + path
 * '/admin/product-holds' → request = /api/admin/admin/product-holds →
 * AdminPrefixMiddleware ตัด '/api/admin/' ตัวแรกทิ้ง (admin-prefix.middleware.ts:26)
 * → /api/admin/product-holds → ตรงกับ @Controller('admin/product-holds') ใต้ global
 * prefix 'api'. รูปแบบเดียวกับ ShopOrdersAdminController เป๊ะ — ห้ามประกาศเป็น
 * @Controller('product-holds') เฉยๆ เพราะจะไม่มีอะไรเรียกถึง
 *
 * path หลัง rewrite ไม่ตรง /api/shop/* จึงถูกบังคับ aud='admin' โดย JwtAudienceGuard
 */
@Controller('admin/product-holds')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
export class ShopReservationAdminController {
  constructor(private service: ShopReservationService) {}

  @Get()
  list(@Query('status') status?: string, @Query('productId') productId?: string) {
    return this.service.listAdminHolds({ status, productId });
  }

  @Patch(':id/release')
  @Roles('OWNER', 'BRANCH_MANAGER')
  release(@Param('id') id: string, @Req() req: { user: { id: string } }) {
    return this.service.releaseHold(id, req.user.id);
  }
}
```

- [ ] **Step 6:** แก้ `shop-reservation.module.ts` เพิ่ม `AuthModule` + controller ใหม่:

```ts
import { AuthModule } from '../auth/auth.module';
import { ShopReservationAdminController } from './shop-reservation.admin.controller';

@Module({
  imports: [PrismaModule, LineOaModule, AuthModule],
  controllers: [ShopReservationController, ShopReservationAdminController],
  providers: [ShopReservationService, ReservationCleanupCron],
  exports: [ShopReservationService],
})
```

- [ ] **Step 7:** รันผ่าน: `cd apps/api && npx jest src/modules/shop-reservation` → all passed
- [ ] **Step 8:** `cd apps/api && npx tsc --noEmit` → 0; `npx eslint .` → 0; Commit: `feat(b5): admin API รายการ hold จากเว็บ + ปลด hold (OWNER/BM)`

---

### Task 10: แจ้งเตือน staff — endpoint นับงานค้าง + badge polling 30s

**Files:**
- Modify: `apps/api/src/modules/shop-orders/shop-orders.service.ts` (เพิ่ม `getPendingCount` + `markRefunded`)
- Modify: `apps/api/src/modules/shop-orders/shop-orders.admin.controller.ts` (เพิ่ม 2 route)
- Modify: `apps/api/src/modules/shop-orders/shop-orders.service.spec.ts` (describe ใหม่)
- Create: `apps/web/src/hooks/useOnlineOrdersPendingCount.ts`
- Create: `apps/web/src/hooks/useOnlineOrdersPendingCount.test.ts`
- Modify: `apps/web/src/config/menu.ts` (บรรทัด 65, 265, 367, 637)
- Modify: `apps/web/src/components/layout/Sidebar.tsx` (import บรรทัด 40, `NavBadge` บรรทัด 63-78)

**Interfaces:**
- Produces (api): `GET /api/admin/online-orders/pending-count` → `{ total: number; pendingBankReview: number; paid: number; unfulfillable: number }`; `PATCH /api/admin/online-orders/:id/refund` (OWNER/FM/ACC) → `OnlineOrder` (status `REFUNDED`)
- Produces (web): `useOnlineOrdersPendingCount(enabled: boolean): number | undefined`, `MenuBadgeKey` เพิ่มค่า `'online-orders-pending'`
- Consumes (web): `api.get('/admin/online-orders/pending-count')` (baseURL `/api/admin`)

- [ ] **Step 1:** เพิ่มเทสต์ที่ต้อง fail ใน `shop-orders.service.spec.ts` (describe ใหม่ท้ายไฟล์ — ต้องมี `prisma.onlineOrder.count` mock อยู่แล้วจาก Task 4):

```ts
describe('ShopOrdersService.getPendingCount / markRefunded', () => {
  let service: ShopOrdersService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      onlineOrder: {
        count: jest.fn(),
        update: jest.fn().mockResolvedValue({ id: 'oo-1', status: 'REFUNDED' }),
        findUnique: jest.fn(),
      },
      $transaction: jest.fn(),
    };
    const mod = await Test.createTestingModule({
      providers: [
        ShopOrdersService,
        { provide: PrismaService, useValue: prisma },
        { provide: OnlineOrderSaleAdapter, useValue: { createForOnlineOrder: jest.fn() } },
      ],
    }).compile();
    service = mod.get(ShopOrdersService);
  });

  it('นับเฉพาะสถานะที่ staff ต้องลงมือ (ตรวจสลิป/แพ็ค/คืนเงิน)', async () => {
    prisma.onlineOrder.count
      .mockResolvedValueOnce(2)  // PENDING_BANK_REVIEW
      .mockResolvedValueOnce(3)  // PAID
      .mockResolvedValueOnce(1); // PAYMENT_RECEIVED_UNFULFILLABLE

    expect(await service.getPendingCount()).toEqual({
      total: 6, pendingBankReview: 2, paid: 3, unfulfillable: 1,
    });
    const statuses = prisma.onlineOrder.count.mock.calls.map((c: any) => c[0].where.status);
    expect(statuses).toEqual(['PENDING_BANK_REVIEW', 'PAID', 'PAYMENT_RECEIVED_UNFULFILLABLE']);
    prisma.onlineOrder.count.mock.calls.forEach((c: any) => {
      expect(c[0].where.deletedAt).toBeNull();
    });
  });

  it('markRefunded: เฉพาะออเดอร์ที่อยู่ในคิวคืนเงินเท่านั้น', async () => {
    prisma.onlineOrder.findUnique.mockResolvedValue({
      id: 'oo-1', status: 'PAYMENT_RECEIVED_UNFULFILLABLE',
    });
    await service.markRefunded('oo-1', 'u1');
    expect(prisma.onlineOrder.update).toHaveBeenCalledWith({
      where: { id: 'oo-1' },
      data: expect.objectContaining({ status: 'REFUNDED' }),
    });
  });

  it('markRefunded: ออเดอร์สถานะอื่น → Forbidden', async () => {
    prisma.onlineOrder.findUnique.mockResolvedValue({ id: 'oo-1', status: 'PAID' });
    await expect(service.markRefunded('oo-1', 'u1')).rejects.toThrow(ForbiddenException);
    expect(prisma.onlineOrder.update).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2:** รันให้เห็น fail: `cd apps/api && npx jest src/modules/shop-orders/shop-orders.service.spec.ts`
- [ ] **Step 3:** เพิ่ม 2 เมธอดใน `shop-orders.service.ts` (ท้ายคลาส):

```ts
  /**
   * นับ "งานค้างที่ staff ต้องลงมือ" สำหรับ badge บน sidebar (poll 30 วิ)
   * - PENDING_BANK_REVIEW = รอตรวจสลิป
   * - PAID               = จ่ายแล้วรอเริ่มแพ็ค
   * - PAYMENT_RECEIVED_UNFULFILLABLE = ต้องคืนเงิน (งานด่วนที่สุด)
   * PACKING/SHIPPED ไม่นับ — มีคนรับงานไปแล้ว ถ้านับด้วย badge จะไม่มีวันเป็นศูนย์
   */
  async getPendingCount() {
    const [pendingBankReview, paid, unfulfillable] = await Promise.all([
      this.prisma.onlineOrder.count({
        where: { deletedAt: null, status: 'PENDING_BANK_REVIEW' },
      }),
      this.prisma.onlineOrder.count({ where: { deletedAt: null, status: 'PAID' } }),
      this.prisma.onlineOrder.count({
        where: { deletedAt: null, status: 'PAYMENT_RECEIVED_UNFULFILLABLE' },
      }),
    ]);
    return {
      total: pendingBankReview + paid + unfulfillable,
      pendingBankReview,
      paid,
      unfulfillable,
    };
  }

  /**
   * ปิดงานคิวคืนเงิน — บันทึกว่าคืนเงินให้ลูกค้าแล้ว (การโอนจริงทำนอกระบบ)
   *
   * ใช้ `cancelledAt` เป็นเวลาปิดงานเพราะ `OnlineOrder` ไม่มีคอลัมน์ `refundedAt`
   * (schema.prisma:2582-2584 มีแค่ status/cancelReason/cancelledAt) — B5 เลือกไม่เพิ่ม
   * คอลัมน์ใหม่เพื่อไม่ให้ migration บวมเกินเหตุ; ถ้า owner อยากได้ timeline แยกจริงๆ
   * ค่อยเพิ่ม `refundedAt` ในงานคืนเงินผ่าน gateway (งานแยก)
   */
  async markRefunded(orderId: string, adminUserId: string) {
    const order = await this.prisma.onlineOrder.findUnique({
      where: { id: orderId },
      select: { id: true, status: true },
    });
    if (!order) throw new NotFoundException('ไม่พบคำสั่งซื้อ');
    if (order.status !== 'PAYMENT_RECEIVED_UNFULFILLABLE') {
      throw new ForbiddenException('คำสั่งซื้อนี้ไม่ได้อยู่ในคิวคืนเงิน');
    }
    this.logger.log(`Order ${orderId} marked REFUNDED by ${adminUserId}`);
    return this.prisma.onlineOrder.update({
      where: { id: orderId },
      data: { status: 'REFUNDED' as OnlineOrderStatus, cancelledAt: new Date() },
    });
  }
```

- [ ] **Step 4:** เพิ่ม route ใน `shop-orders.admin.controller.ts` — วาง `pending-count` ก่อน route อื่นเสมอ:

```ts
  @Get('pending-count')
  pendingCount() {
    return this.service.getPendingCount();
  }

  @Get()
  list(@Query('status') status?: string) {
    return this.service.listAdminQueue(status);
  }
```

และเพิ่มท้าย controller:

```ts
  @Patch(':id/refund')
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  refund(@Param('id') id: string, @Req() req: { user: { id: string } }) {
    return this.service.markRefunded(id, req.user.id);
  }
```

- [ ] **Step 5:** รันผ่าน: `cd apps/api && npx jest src/modules/shop-orders` → all passed
- [ ] **Step 6:** เขียนเทสต์ที่ต้อง fail `apps/web/src/hooks/useOnlineOrdersPendingCount.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const get = vi.fn();
vi.mock('@/lib/api', () => ({ default: { get: (...a: unknown[]) => get(...a) } }));

import { useOnlineOrdersPendingCount } from './useOnlineOrdersPendingCount';

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return React.createElement(QueryClientProvider, { client }, children);
}

describe('useOnlineOrdersPendingCount', () => {
  beforeEach(() => get.mockReset());

  it('คืน total จาก pending-count', async () => {
    get.mockResolvedValue({ data: { total: 4, pendingBankReview: 1, paid: 2, unfulfillable: 1 } });
    const { result } = renderHook(() => useOnlineOrdersPendingCount(true), { wrapper });
    await waitFor(() => expect(result.current).toBe(4));
    expect(get).toHaveBeenCalledWith('/admin/online-orders/pending-count');
  });

  it('ไม่ยิงเมื่อ disabled', async () => {
    const { result } = renderHook(() => useOnlineOrdersPendingCount(false), { wrapper });
    await waitFor(() => expect(result.current).toBeUndefined());
    expect(get).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 7:** รันให้เห็น fail: `cd apps/web && npx vitest run src/hooks/useOnlineOrdersPendingCount.test.ts`
- [ ] **Step 8:** สร้าง `apps/web/src/hooks/useOnlineOrdersPendingCount.ts`:

```ts
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';

/**
 * จำนวนงานค้างของคำสั่งซื้อออนไลน์ (รอตรวจสลิป + รอแพ็ค + ต้องคืนเงิน) สำหรับ nav badge
 *
 * ใช้ polling 30 วิเหมือน useQcPendingCount — EventsGateway ปิดใน prod (ไม่มี
 * ENABLE_WEBSOCKET) จึงพึ่ง WS ไม่ได้ ถ้าวันหนึ่งเปิด WS ค่อยเปลี่ยนเป็น push ได้
 */
export function useOnlineOrdersPendingCount(enabled: boolean): number | undefined {
  const query = useQuery({
    queryKey: ['online-orders-pending-count'],
    queryFn: async () => {
      const res = await api.get('/admin/online-orders/pending-count');
      return res.data as {
        total: number;
        pendingBankReview: number;
        paid: number;
        unfulfillable: number;
      };
    },
    enabled,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    staleTime: 10_000,
  });
  return query.data?.total;
}
```

- [ ] **Step 9:** รันผ่าน: `cd apps/web && npx vitest run src/hooks/useOnlineOrdersPendingCount.test.ts` → 2 passed
- [ ] **Step 10:** แก้ `apps/web/src/config/menu.ts:65`:

```ts
export type MenuBadgeKey =
  | 'chat-unread'
  | 'asset-draft-count'
  | 'qc-pending-count'
  | 'online-orders-pending';
```

แล้วเติม `badgeKey` ให้รายการ 'คำสั่งซื้อออนไลน์' ทั้ง 3 จุด (บรรทัด 265 = BM, 367 = FM, 637 = OWNER) — เนื้อบรรทัดเหมือนกันทั้งสาม:

```ts
        { label: 'คำสั่งซื้อออนไลน์', path: '/online-orders', icon: ShoppingBag, badgeKey: 'online-orders-pending' },
```

- [ ] **Step 11:** แก้ `apps/web/src/components/layout/Sidebar.tsx` — เพิ่ม import หลังบรรทัด 40 และแก้ `NavBadge` (บรรทัด 63-78):

```tsx
import { useOnlineOrdersPendingCount } from '@/hooks/useOnlineOrdersPendingCount';
```

```tsx
/* ── NavBadge — dynamic count badge for sidebar items ── */
function NavBadge({ badgeKey }: { badgeKey: MenuBadgeKey }) {
  const draftCount = useDraftAssetCount(badgeKey === 'asset-draft-count');
  const qcCount = useQcPendingCount(badgeKey === 'qc-pending-count');
  const onlineOrderCount = useOnlineOrdersPendingCount(badgeKey === 'online-orders-pending');
  const count = badgeKey === 'asset-draft-count' ? draftCount
    : badgeKey === 'qc-pending-count' ? qcCount
    : badgeKey === 'online-orders-pending' ? onlineOrderCount
    : undefined;
  if (!count || count === 0) return null;
  const cls = badgeKey === 'qc-pending-count' || badgeKey === 'online-orders-pending'
    ? 'bg-warning/10 text-warning dark:bg-warning/15'
    : 'bg-primary/15 text-primary';
  return (
    <span className={`ml-auto inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-[11px] font-medium ${cls}`}>
      {count}
    </span>
  );
}
```

- [ ] **Step 12:** รัน regression ฝั่ง web: `cd apps/web && npx vitest run src/config/menu.test.ts src/hooks` → all passed
- [ ] **Step 13:** `cd apps/web && npx tsc --noEmit` → 0; `cd apps/api && npx tsc --noEmit` → 0; Commit: `feat(b5): pending-count endpoint + badge คำสั่งซื้อออนไลน์ (poll 30s) + ปิดคิวคืนเงิน`

---

### Task 11: หน้าคำสั่งซื้อออนไลน์ — แท็บคิวคืนเงิน + ปุ่มบันทึกคืนเงิน

**Files:**
- Modify: `apps/web/src/pages/OnlineOrdersPage.tsx` (type บรรทัด 14-22, `STATUS_TABS` 43-51, `STATUS_BADGE` 53-62, mutation ~124, actions cell 210-301)

**Interfaces:**
- Consumes: `GET /admin/online-orders?status=PAYMENT_RECEIVED_UNFULFILLABLE`, `PATCH /admin/online-orders/:id/refund` (Task 10)
- Produces: UI ไม่มี contract ใหม่

- [ ] **Step 1:** เพิ่มสถานะใหม่ในทั้ง 3 ที่ (บรรทัด 14-62):

```tsx
type OnlineOrderStatus =
  | 'PENDING_PAYMENT'
  | 'PENDING_BANK_REVIEW'
  | 'PAID'
  | 'PACKING'
  | 'SHIPPED'
  | 'DELIVERED'
  | 'CANCELLED'
  | 'REFUNDED'
  | 'PAYMENT_RECEIVED_UNFULFILLABLE';
```

```tsx
const STATUS_TABS: Array<{ key: OnlineOrderStatus | 'ALL'; label: string }> = [
  { key: 'ALL', label: 'ทั้งหมด' },
  { key: 'PAYMENT_RECEIVED_UNFULFILLABLE', label: 'ต้องคืนเงิน' },
  { key: 'PENDING_BANK_REVIEW', label: 'รอตรวจสลิป' },
  { key: 'PAID', label: 'ชำระแล้ว' },
  { key: 'PACKING', label: 'กำลังแพ็ค' },
  { key: 'SHIPPED', label: 'จัดส่งแล้ว' },
  { key: 'DELIVERED', label: 'ส่งถึงลูกค้า' },
  { key: 'CANCELLED', label: 'ยกเลิก' },
];
```

```tsx
  REFUNDED: { label: 'คืนเงินแล้ว', variant: 'secondary' },
  PAYMENT_RECEIVED_UNFULFILLABLE: { label: 'ต้องคืนเงิน', variant: 'destructive' },
};
```

- [ ] **Step 2:** เพิ่ม mutation หลัง `cancelMutation` (หลังบรรทัด 137):

```tsx
  const refundMutation = useMutation({
    mutationFn: async (id: string) => api.patch(`/admin/online-orders/${id}/refund`),
    onSuccess: () => {
      toast.success('บันทึกว่าคืนเงินแล้ว');
      queryClient.invalidateQueries({ queryKey: ['admin-online-orders'] });
      queryClient.invalidateQueries({ queryKey: ['online-orders-pending-count'] });
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });
```

- [ ] **Step 3:** เพิ่ม invalidate badge ให้ mutation เดิมที่เปลี่ยนสถานะ (`confirmBankMutation`, `shipMutation`, `cancelMutation`) — เติมบรรทัดนี้ใน `onSuccess` ของแต่ละตัว:

```tsx
      queryClient.invalidateQueries({ queryKey: ['online-orders-pending-count'] });
```

- [ ] **Step 4:** เพิ่ม action cell สำหรับคิวคืนเงิน — แทรกก่อน block `{order.status === 'PENDING_BANK_REVIEW' && (` (บรรทัด 212):

```tsx
                          {order.status === 'PAYMENT_RECEIVED_UNFULFILLABLE' && (
                            <>
                              <div className="text-xs text-destructive leading-snug">
                                เงินเข้าแล้วแต่เครื่องถูกขายไปก่อน — ติดต่อลูกค้าเพื่อคืนเงิน
                              </div>
                              <Button
                                size="sm"
                                variant="destructive"
                                onClick={() => refundMutation.mutate(order.id)}
                                disabled={refundMutation.isPending}
                              >
                                <CheckCircle2 className="size-4 mr-1.5" />
                                บันทึกว่าคืนเงินแล้ว
                              </Button>
                            </>
                          )}
```

- [ ] **Step 5:** ตัดสถานะคิวคืนเงินออกจากปุ่มยกเลิก (บรรทัด 266-269) — เงื่อนไขเดิมไม่รวมสถานะใหม่อยู่แล้ว ยืนยันว่าไม่มีการเติมเข้าไป (ปุ่มยกเลิกไม่มีความหมายเมื่อเงินเข้าแล้ว)
- [ ] **Step 6:** `cd apps/web && npx tsc --noEmit` → 0; `npx eslint src/pages/OnlineOrdersPage.tsx` → 0
- [ ] **Step 7:** Commit: `feat(b5): หน้าคำสั่งซื้อออนไลน์ — แท็บ/แบดจ์ "ต้องคืนเงิน" + ปุ่มบันทึกคืนเงิน`

---

### Task 12: หน้า "การจองจากเว็บ" + indicator บนหน้าสินค้า admin

**Files:**
- Create: `apps/web/src/pages/ProductHoldsPage.tsx`
- Modify: `apps/web/src/App.tsx` (lazy import ใกล้บรรทัด 218, route ใกล้บรรทัด 959-966)
- Modify: `apps/web/src/config/menu.ts` (เพิ่มรายการในกลุ่ม 'ร้านค้าออนไลน์' ทั้ง 3 role: `bm-online-shop` 265-268 / `fm-online-shop` 367-369 / `owner-online-shop` 637-640)
- Modify: `apps/web/src/pages/ProductDetailPage/index.tsx` (query ใหม่ต่อจาก `branches` query ที่ปิดบรรทัด 125, banner ก่อนแถบแท็บบรรทัด 352)

**Interfaces:**
- Consumes: `GET /admin/product-holds?status=ACTIVE[&productId=]` → `AdminHoldRow[]` (Task 9), `PATCH /admin/product-holds/:id/release`
- Produces: route `/product-holds` (OWNER, BRANCH_MANAGER, FINANCE_MANAGER)

- [ ] **Step 1:** สร้าง `apps/web/src/pages/ProductHoldsPage.tsx`:

```tsx
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Lock } from 'lucide-react';
import { Link } from 'react-router';
import api, { getErrorMessage } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import PageHeader from '@/components/ui/PageHeader';
import QueryBoundary from '@/components/QueryBoundary';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

interface HoldRow {
  id: string;
  productId: string;
  productName: string;
  imeiLast4: string | null;
  branchName: string | null;
  status: string;
  reservedAt: string;
  expiresAt: string;
  secondsRemaining: number;
  source: 'ORDER' | 'APPLICATION' | 'UNLINKED';
  orderNumber: string | null;
  applicationNumber: string | null;
  customerName: string | null;
}

const SOURCE_LABEL: Record<HoldRow['source'], string> = {
  ORDER: 'มีคำสั่งซื้อ',
  APPLICATION: 'ใบสมัครผ่อน',
  UNLINKED: 'ยังไม่ผูก (จองจากเว็บ)',
};

function formatRemaining(seconds: number): string {
  if (seconds <= 0) return 'หมดเวลาแล้ว';
  const m = Math.floor(seconds / 60);
  if (m >= 60) return `เหลือ ${Math.floor(m / 60)} ชม. ${m % 60} น.`;
  return `เหลือ ${m} นาที`;
}

export default function ProductHoldsPage() {
  useDocumentTitle('การจองจากเว็บ');
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const canRelease = user?.role === 'OWNER' || user?.role === 'BRANCH_MANAGER';

  const { data, isLoading, isError, error, refetch } = useQuery<HoldRow[]>({
    queryKey: ['product-holds', 'ACTIVE'],
    queryFn: async () => {
      const res = await api.get('/admin/product-holds', { params: { status: 'ACTIVE' } });
      return res.data as HoldRow[];
    },
    refetchInterval: 30_000,
  });

  const releaseMutation = useMutation({
    mutationFn: async (id: string) => api.patch(`/admin/product-holds/${id}/release`),
    onSuccess: () => {
      toast.success('ปลดการจองเรียบร้อย');
      queryClient.invalidateQueries({ queryKey: ['product-holds'] });
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const holds = data ?? [];

  return (
    <div>
      <PageHeader
        title="การจองจากเว็บ"
        subtitle="เครื่องที่ลูกค้าเว็บกำลังถือสิทธิ์อยู่ — ปลดได้เมื่อลูกค้าไม่มาจริง"
        icon={<Lock className="size-5" />}
      />

      <QueryBoundary isLoading={isLoading} isError={isError} error={error} onRetry={refetch}>
        <div className="rounded-lg border border-border bg-card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-muted-foreground text-xs uppercase">
              <tr>
                <th className="px-4 py-3 text-left font-medium">เครื่อง</th>
                <th className="px-4 py-3 text-left font-medium">สาขา</th>
                <th className="px-4 py-3 text-left font-medium">ที่มา</th>
                <th className="px-4 py-3 text-left font-medium">ลูกค้า</th>
                <th className="px-4 py-3 text-left font-medium">เวลาที่เหลือ</th>
                <th className="px-4 py-3 text-left font-medium">การดำเนินการ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {holds.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-muted-foreground leading-snug">
                    ตอนนี้ไม่มีเครื่องที่ถูกจองจากเว็บ
                  </td>
                </tr>
              ) : (
                holds.map((h) => (
                  <tr key={h.id} className="hover:bg-accent/30">
                    <td className="px-4 py-3">
                      <Link
                        to={`/products/${h.productId}`}
                        className="text-primary hover:underline leading-snug"
                      >
                        {h.productName}
                      </Link>
                      {h.imeiLast4 && (
                        <div className="text-xs text-muted-foreground leading-snug">
                          IMEI ••••{h.imeiLast4}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{h.branchName ?? '-'}</td>
                    <td className="px-4 py-3">
                      <Badge variant={h.source === 'UNLINKED' ? 'secondary' : 'primary'}>
                        {SOURCE_LABEL[h.source]}
                      </Badge>
                      {(h.orderNumber || h.applicationNumber) && (
                        <div className="text-xs text-muted-foreground leading-snug">
                          {h.orderNumber ?? h.applicationNumber}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-foreground leading-snug">
                      {h.customerName ?? <span className="text-muted-foreground">ไม่ระบุ</span>}
                    </td>
                    <td className="px-4 py-3 text-foreground">{formatRemaining(h.secondsRemaining)}</td>
                    <td className="px-4 py-3">
                      {canRelease ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => releaseMutation.mutate(h.id)}
                          disabled={releaseMutation.isPending}
                        >
                          ปลดการจอง
                        </Button>
                      ) : (
                        <span className="text-xs text-muted-foreground leading-snug">
                          แจ้งผู้จัดการเพื่อปลด
                        </span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </QueryBoundary>
    </div>
  );
}
```

- [ ] **Step 2:** เพิ่ม lazy import ใน `apps/web/src/App.tsx` ต่อจากบรรทัด 218:

```tsx
const ProductHoldsPage = lazy(() => import('@/pages/ProductHoldsPage'));
```

และเพิ่ม route ต่อจาก block `/online-orders` (หลังบรรทัด 966):

```tsx
          <Route
            path="/product-holds"
            element={
              <ProtectedRoute roles={['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER']}>
                <ProductHoldsPage />
              </ProtectedRoute>
            }
          />
```

- [ ] **Step 3:** เพิ่มรายการเมนูในกลุ่ม 'ร้านค้าออนไลน์' ทั้ง 3 role (`menu.ts` — key `bm-online-shop` items 265-268 / `fm-online-shop` items 367-369 / `owner-online-shop` items 637-640) — วางต่อจาก 'คำสั่งซื้อออนไลน์'; ไอคอน `Lock` ถูก import อยู่แล้วที่บรรทัด 23 ไม่ต้องเพิ่ม import:

```ts
        { label: 'การจองจากเว็บ', path: '/product-holds', icon: Lock },
```

- [ ] **Step 4:** เพิ่ม indicator ในหน้าสินค้า admin — `ProductDetailPage/index.tsx` เพิ่ม query ต่อจาก `branches` query (ปิดที่บรรทัด 125) — **ต้องอยู่เหนือ early return ทุกตัว** ตาม Rules of Hooks (ไฟล์นี้มีคอมเมนต์เตือนเรื่องนี้อยู่แล้วที่บรรทัด 127):

```tsx
  // B5: เครื่องนี้ติดจองจากเว็บอยู่หรือเปล่า — กันพนักงานขายซ้ำโดยไม่รู้ตัว
  const { data: holds = [] } = useQuery<Array<{ id: string; secondsRemaining: number; source: string; orderNumber: string | null }>>({
    queryKey: ['product-holds', id],
    queryFn: async () => {
      const { data } = await api.get('/admin/product-holds', {
        params: { productId: id, status: 'ACTIVE' },
      });
      return data;
    },
    enabled: !!id,
    refetchInterval: 30_000,
  });
```

- [ ] **Step 5:** แสดง banner เหนือแถบแท็บ — แทรกก่อน `{/* Tabs — always shown; ... */}` (บรรทัด 352):

```tsx
      {holds.length > 0 && (
        <div className="mb-4 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm leading-snug">
          <span className="font-medium">ติดจองจากเว็บ</span> — เครื่องนี้ถูกลูกค้าออนไลน์ถือสิทธิ์อยู่
          {holds[0].orderNumber ? ` (คำสั่งซื้อ ${holds[0].orderNumber})` : ''}
          {holds[0].secondsRemaining > 0
            ? ` เหลืออีก ${Math.max(1, Math.floor(holds[0].secondsRemaining / 60))} นาที`
            : ' และกำลังจะหมดเวลา'}
          {' — '}
          <Link to="/product-holds" className="text-primary hover:underline">
            ดูรายการจอง
          </Link>
        </div>
      )}
```

- [ ] **Step 6:** `cd apps/web && npx tsc --noEmit` → 0; `npx eslint .` → 0
- [ ] **Step 7:** รันเทสต์ฝั่ง web ทั้งชุด: `cd apps/web && npx vitest run` → all passed
- [ ] **Step 8:** Commit: `feat(b5): หน้าการจองจากเว็บ (list + ปลด hold) + indicator บนหน้าสินค้า admin`

---

## Deployment & Verification

### ลำดับก่อน merge (ทำในเครื่อง)

- [ ] `cd apps/api && npx prisma generate && npx tsc --noEmit && npx eslint .` → 0 / 0
- [ ] `cd apps/api && npx jest src/modules/sales src/modules/contracts` → เขียวทั้งหมด (**red line gate** — JE เงินสด/ดาวน์/inter-company ต้องไม่ขยับ; ถ้ามีแดงแม้ 1 เคสให้ย้อน Task 5/6 ไม่ใช่แก้ assertion)
- [ ] `cd apps/api && npx jest src/modules/shop-orders src/modules/shop-checkout src/modules/shop-reservation src/modules/shop-catalog src/modules/paysolutions src/utils/reservation-preempt.util.spec.ts`
- [ ] `cd apps/web && npx tsc --noEmit && npx eslint . && npx vitest run`
- [ ] `cd apps/web-shop && npx tsc --noEmit`

### QA บน local (prod ปฏิเสธ seed accounts — ห้าม QA บน prod)

รัน `npm run dev` (api :3000, web :5173) + `cd apps/web-shop && npm run dev`; ล็อกอิน `admin@bestchoice.com / admin1234`

- [ ] **A. ตัดหน้าแบบขายสด** — เว็บลูกค้า: จองเครื่อง A (`/products/:id` → จอง) → ตะกร้าเห็น countdown; แอดมิน: `/pos` ขายเครื่อง A เป็นเงินสด → ภายใน 5 วิ ตะกร้าเว็บว่างเอง (poll `useCart`) และหน้า `/product-holds` ไม่มีแถวเครื่อง A แล้ว
- [ ] **B. ตัดหน้าแบบทำสัญญา** — จองเครื่อง B → แอดมินสร้างสัญญาผ่อนบนเครื่อง B → hold กลายเป็น PREEMPTED (ตรวจ `SELECT status FROM product_reservations WHERE product_id=...`)
- [ ] **C. เงินเข้าแต่ของหมด (คิวคืนเงิน)** — จองเครื่อง C → ทำถึงหน้าชำระ (เลือกโอนธนาคาร → อัปสลิป) → แอดมินขายเครื่อง C ที่ POS ก่อน → แอดมินกด "ยืนยันสลิป" → ออเดอร์ต้องขึ้นแท็บ **ต้องคืนเงิน** พร้อมข้อความสีแดง + badge sidebar เด้ง + ไม่มี Sale ใหม่เกิดขึ้น (`/sales`)
- [ ] **D. เส้นทางปกติยังทำงาน** — จองเครื่อง D → โอนธนาคาร → อัปสลิป → ยืนยันสลิป → ออเดอร์เป็น PACKING + มี Sale ใหม่ + เครื่อง D เป็น SOLD_CASH + hold เป็น CONSUMED
- [ ] **E. hold โอนเงินไม่หมดใน 15 นาที** — สั่งซื้อแบบโอนธนาคารแล้วรอเกิน 15 นาที (หรือปรับ `expiresAt` ใน DB ให้เห็นผลเร็ว) → hold ยังอยู่ ไม่โดน cron expire
- [ ] **F. ข้อความแยกเหตุ** — เปิดหน้า checkout ค้างไว้ แล้ว preempt เครื่องจาก POS → กดสั่งซื้อ → toast ต้องขึ้น "เครื่องนี้เพิ่งถูกขายที่หน้าร้าน — กรุณาเลือกเครื่องอื่น" (ไม่ใช่ข้อความหมดอายุ)
- [ ] **G. ปลด hold** — `/product-holds` ล็อกอิน **FINANCE_MANAGER** (`finance@bestchoice.com`) → เห็นรายการแต่ขึ้นข้อความ "แจ้งผู้จัดการเพื่อปลด" (ไม่มีปุ่ม); ล็อกอิน OWNER → ปุ่มปลดทำงาน; hold ที่ผูกกับออเดอร์ยังไม่ยกเลิก → กดแล้วต้องได้ error ภาษาไทยชัดเจน
  - **หมายเหตุ role:** route `/product-holds` = OWNER/BRANCH_MANAGER/FINANCE_MANAGER เท่านั้น (`App.tsx`) — **SALES เข้าหน้านี้ไม่ได้โดยตั้งใจ** แต่ยังต้องมีสิทธิ์ `GET /admin/product-holds` เพราะ banner "ติดจองจากเว็บ" บนหน้า `/products/:id` (route นั้น = OWNER/BM/SALES, `App.tsx:475`) ยิง endpoint เดียวกัน → `@Roles` ของ controller จึงกว้างกว่า route ของหน้า ไม่ใช่ความผิดพลาด
- [ ] **G2. SALES เห็น indicator** — ล็อกอิน SALES → เปิด `/products/:id` ของเครื่องที่ถูกจองอยู่ → ต้องเห็น banner "ติดจองจากเว็บ" (ลิงก์ "ดูรายการจอง" จะพาไปหน้าที่ SALES เข้าไม่ได้ — ยอมรับได้ เป็นทางลัดสำหรับผู้จัดการ)
- [ ] **H. badge** — สร้างออเดอร์ค้าง 2 รายการ → รอ ≤30 วิ badge ข้าง "คำสั่งซื้อออนไลน์" ต้องขึ้นตัวเลข; ทำงานเสร็จแล้วตัวเลขลด
- [ ] **I. หน้าเว็บลูกค้า** — กลุ่มสินค้าที่หมดสต็อกต้องขึ้น "หมดสต็อก — ทักแชทเช็ครอบเข้าใหม่" + ปุ่ม "ทักแชทเช็ครอบเข้าใหม่" ลิงก์ไป LINE (ไม่ใช่ปุ่ม "เลือกเครื่อง")

### Deploy

- [ ] เปิด PR base = `spec/product-answering-readiness` (หรือ `main` ตามที่ wave ตกลง) — รอ CI "Lint & Test" เขียว + code-owner review 1 คน (owner กด; **ห้าม `--admin` override**)
- [ ] Deploy ผ่าน GitHub Actions ตามปกติ — migration `20260984000000` รันอัตโนมัติ (`prisma migrate deploy`) ก่อน Cloud Run rollout
- [ ] **หลัง migrate** ตรวจว่า enum เข้าจริง:
```sql
SELECT unnest(enum_range(NULL::"OnlineOrderStatus"));   -- ต้องมี PAYMENT_RECEIVED_UNFULFILLABLE
SELECT count(*) FROM product_reservations WHERE status='PREEMPTED' AND preempt_notified_at IS NULL;  -- ต้องเป็น 0 (backfill ทำงาน)
```
- [ ] ตรวจ health + endpoint ใหม่หลัง rollout: `GET /api/health` = 200; ล็อกอิน admin แล้วเรียก `/api/admin/online-orders/pending-count` = 200 พร้อม 4 คีย์; `/api/admin/product-holds` = 200
- [ ] ดู log Cloud Run 5 นาทีแรก — cron `notifyPreemptedHolds` ต้องไม่มี error (ปกติเงียบเพราะได้ 0 แถว)
- [ ] ตั้ง Sentry alert/saved search 2 ตัว: tag `critical:online-order-unfulfillable` (ต้องมีคนดูทุกครั้ง = เงินลูกค้าค้าง) และ `critical:hold-preempt-notify-failed` (เตือนเฉยๆ)

### สิ่งที่ owner ต้องทำ (ไม่ใช่โค้ด)

- [ ] ตกลง **SLA คืนเงิน** ของออเดอร์สถานะ "ต้องคืนเงิน" (ตอนนี้ระบบแค่เข้าคิว + บันทึกว่าโอนคืนแล้ว — การโอนจริงทำนอกระบบ) แล้วบอกทีมว่าใครรับผิดชอบแท็บนี้
- [ ] ยืนยันว่า **48 ชม.** คือเวลาที่เหมาะสมสำหรับ hold ของออเดอร์โอนเงิน (ถ้าอยากได้สั้น/ยาวกว่านี้ แก้ค่าเดียวที่ `BANK_TRANSFER_HOLD_MS` ใน `shop-checkout.service.ts`)
- [ ] ตรวจว่า LINE OA ช่อง `line-shop` ตั้งค่าครบใน prod (ถ้าไม่ครบ การแจ้งลูกค้าจะเงียบแบบ best-effort — งานคืนเงินยังเข้าคิวปกติ)

---

## สิ่งที่ batch นี้ไม่ทำ (อ้าง scope ที่ spec ตัด)

- **ไม่มี push แจ้งลูกค้าเว็บแบบ realtime** — spec §1 ตัดออกแล้ว เหลือ cart self-correct (poll 5 วิ ที่มีอยู่) + ข้อความ reject แยกกรณี + LINE best-effort เมื่อมีออเดอร์ + งาน refund เข้าคิว staff เสมอ
- **ไม่ใช้ WebSocket/EventsGateway** — ปิดใน prod (ไม่มี `ENABLE_WEBSOCKET`); WS push เป็น follow-up ถ้าวันหนึ่งเปิด (spec §7)
- **ไม่มีระบบ back-in-stock / แจ้งเตือนเมื่อของเข้าใหม่** — spec §8 ตัดออก (จึงต้องแก้ copy ที่ไปสัญญาไว้ใน Task 7)
- **บอทกดจอง/hold แทนลูกค้าไม่ทำ** — spec §8
- **ไม่คืนเงินอัตโนมัติผ่าน PaySolutions** — B5 แค่เข้าคิว + บันทึกสถานะ; การ refund ผ่าน gateway API เป็นงานแยก (ต้อง owner ตัดสินใจเรื่อง fee + หลักฐานบัญชี และแตะเส้นทางเงิน = ต้องมี JE design ของตัวเอง)
- **ไม่แตะ accounting/finance JE** — red line §10; งานนี้ preempt แบบ additive ใน tx เดิมเท่านั้น
- **ไม่แก้ข้อมูลย้อนหลัง** — prod = testing-phase, forward-fix only (migration แค่ stamp `preempt_notified_at` ให้ PREEMPTED เดิมเพื่อกันแจ้งย้อนหลัง ไม่ได้แก้สถานะออเดอร์เก่า)
- **ไม่ทำ readiness filter / ราคาคอลัมน์ / bot / share endpoint** — เป็นของ B0/B1/B3/B4 ตามลำดับ wave
