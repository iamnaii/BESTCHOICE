# หน้าหลักหน้าร้าน (Shop Home) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** หน้า `/` ในโซนหน้าร้านแสดงยอดวันนี้ งานที่ต้องดูวันนี้ กราฟยอดขาย/ต้นทุน/กำไรขั้นต้น 6 เดือน ขายดี 30 วัน และค้างสต๊อกนานสุด จาก endpoint เดียว โดย SALES ไม่ได้รับต้นทุน/กำไร

**Architecture:** โมดูล NestJS ใหม่ `shop-home` ประกอบ response จาก service เจ้าของข้อมูลที่มีอยู่ (sales, bookings, after-sales, shop-tenders, inventory, purchase-orders, products, accounting) แล้ว controller ตัดต้นทุนด้วย `redactShopHome()` เมื่อ `!canSeeCost(role)` ฝั่งเว็บเพิ่มหน้า `ShopHomePage` และให้ `DashboardPage` เลือกหน้าตาม `useLayout().workZone`

**Tech Stack:** NestJS + Prisma + jest (`--runInBand`) · React + react-query + recharts + vitest/testing-library · Tailwind tokens เดิมของแอป

**Spec:** `docs/superpowers/specs/2026-10-22-shop-home-dashboard-design.md`

## Global Constraints

- SALES ต้องไม่ได้ฟิลด์ต้นทุน/กำไรใด ๆ ใน response (`canSeeCost(role)` จาก `apps/api/src/modules/products/cost-visibility.util.ts` เป็นจุดตัดสินเดียว)
- ทุกบทบาทที่ไม่ใช่ข้ามสาขา (`getBranchScope(user).all === false` ได้แก่ BRANCH_MANAGER, SALES) ถูกบังคับ `branchId = scope.branchId` ที่ controller; ถ้าไม่มีสาขาผูก → `ForbiddenException('บัญชีนี้ยังไม่ผูกสาขา')` ไม่ปล่อยให้เห็นทุกสาขา
- ตัวเลขกราฟ: `sales` = Σ แถวรหัสขึ้นต้น `S41` เท่านั้น (S42 รายได้อื่น ไม่นับ) · `cost` = Σ แถวรหัสขึ้นต้น `S50`
- SALES ไม่ได้แถว `PO_APPROVAL` ใน `watch` (ตัดที่ controller) ส่วนสินค้าใกล้หมดเปิดให้ทุกบทบาทโดยตั้งใจ
- ไม่มี cache ฝั่ง server (งบรายเดือนเป็น `journalLine.groupBy` ครั้งเดียวต่อเดือน)
- วัน/เดือนคิดตามเวลาไทยด้วย `bangkokDateString`, `bangkokDateRange`, `bangkokMidnight` จาก `apps/api/src/utils/date.util.ts`
- `/dashboard/*` ปฏิเสธ SALES ทั้ง controller — endpoint ใหม่ต้องอยู่ที่ `GET /shop-home` ไม่ใช่ใต้ `/dashboard`
- `ShopHomeService` ห้าม query Prisma ตรงสำหรับข้อมูลที่ module อื่นเป็นเจ้าของ (ยกเว้น PO เลขล่าสุด ซึ่งระบุไว้ใน Task 4) — เพิ่ม method ใน service เจ้าของแทน
- ฝั่งเว็บห้ามสื่อความเร่งด่วนด้วยสีอย่างเดียว ชิปต้องมีคำ "ด่วน / รอ / แจ้ง"; แท่งต้นทุนใช้ลายเส้น; ปุ่ม/แท็บ `min-h-9` (36px) ขึ้นไป
- ทุก commit ต้องลงท้าย `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`; ก่อนเปิด PR bump `apps/web/package.json` เป็น `26.10.46`
- API tests: `cd apps/api && node --experimental-vm-modules ../../node_modules/jest/bin/jest.js --runInBand --forceExit <spec>` · web tests: `cd apps/web && npx vitest run --root <abs apps/web> <file>` · ห้ามรัน `npm run lint` ใน apps/api (มี --fix) ใช้ `npx eslint -c eslint.config.mjs <files>`

## Review Focus

1. OWNER ไม่ส่ง `branchId` → `today.cashDrawer` ต้องรวมทุกสาขาที่มีลิ้นชัก ไม่ใช่สาขาแรกสาขาเดียว (เทสต์ใน Task 3)
2. วันแรกของเดือน: `monthly` ต้องได้ 6 เดือนครบโดยเดือนปัจจุบันมีค่า 0 ไม่ใช่ 5 เดือน (เทสต์ใน Task 4)
3. `thisMonth.salesMomPct` เมื่อเดือนก่อน = 0 ต้องเป็น `null` ไม่ใช่ `Infinity`/`NaN` (เทสต์ใน Task 4)
4. `watch` ทุก count = 0 → array ว่าง และเว็บแสดง "ไม่มีงานค้าง วันนี้ว่าง" (เทสต์ใน Task 4 และ Task 7)
5. SALES ที่ไม่ส่ง `branchId` → controller บังคับสาขาตัวเอง ไม่ใช่ทุกสาขา; SALES ที่ไม่มีสาขาผูก → 403 (เทสต์ใน Task 5)
6. เดือนก่อนเปิดใช้บัญชีร้าน (ยอดขายและต้นทุน 0 ติดกันตั้งแต่ต้นช่วง) ต้องถูกตัดออกจาก `monthly` ไม่ใช่โชว์แท่ง 0 นำหน้า (เทสต์ใน Task 4)

---

### Task 1: ชนิดข้อมูล response + `redactShopHome`

**Files:**
- Create: `apps/api/src/modules/shop-home/shop-home.types.ts`
- Modify: `apps/api/src/modules/products/cost-visibility.util.ts` (ต่อท้ายไฟล์)
- Test: `apps/api/src/modules/products/cost-visibility.util.spec.ts` (ใหม่)

**Interfaces:**
- Produces: `ShopHomeResponse`, `ShopHomeWatchItem`, `ShopHomeWatchKey` (types) และ `redactShopHome(r: ShopHomeResponse): ShopHomeResponse`

- [ ] **Step 1: เขียน `shop-home.types.ts`**

```ts
export type ShopHomeWatchKey = 'LOW_STOCK' | 'AGING_90' | 'QC_PHOTO' | 'TRANSFER_PENDING' | 'REPOSSESSED' | 'PO_APPROVAL';
export type ShopHomeSeverity = 'urgent' | 'wait' | 'info';
export interface ShopHomeWatchItem { key: ShopHomeWatchKey; count: number; severity: ShopHomeSeverity; detail: string | null; costValue: number | null }
export interface ShopHomeMonth { month: string; sales: number; cost: number | null; grossProfit: number | null }
export interface ShopHomeResponse {
  generatedAt: string;
  branch: { id: string | null; name: string };
  today: {
    sales: { count: number; netAmount: number; cash: number; installment: number; externalFinance: number };
    cashDrawer: { balance: number; closedToday: boolean; lastClosedAt: string | null };
    bookingsExpiringToday: { count: number; depositTotal: number; reservedUnits: number }; // ใบจองเปิดอยู่ที่ expireDate = วันนี้ (Booking ไม่มีวันนัดรับ)
    afterSales: { waitingPickup: number; overdue: number };
  };
  watch: ShopHomeWatchItem[];
  monthly: ShopHomeMonth[]; // สูงสุด 6 เดือน เก่า→ใหม่ ตัดเดือนนำหน้าที่ sales=0 และ cost=0 ออก (อย่างน้อยเดือนปัจจุบัน)
  thisMonth: { sales: number; salesMomPct: number | null; cost: number | null; grossProfit: number | null; grossMarginPct: number | null; grossProfitMomPct: number | null };
  topSellers30d: { byModel: { name: string; count: number }[]; byCategory: { name: string; count: number }[] };
  slowMovers: { name: string; days: number; costPrice?: number }[];
  stockAging: { label: string; count: number }[];
}
```

- [ ] **Step 2: เขียนเทสต์ที่ล้ม** ใน `cost-visibility.util.spec.ts`

```ts
describe('redactShopHome', () => {
  it('SALES: ตัดทุกฟิลด์ต้นทุน/กำไร แต่ count/วัน/ยอดขายคงเดิม', () => {
    const r = redactShopHome(full()); // full() = fixture ที่มีค่าทุกฟิลด์ (watch AGING_90 costValue 61200, monthly cost 266000, thisMonth cost/grossProfit/grossMarginPct/grossProfitMomPct, slowMovers costPrice)
    expect(r.watch.find((w) => w.key === 'AGING_90')?.costValue).toBeNull();
    expect(r.monthly.every((m) => m.cost === null && m.grossProfit === null)).toBe(true);
    expect(r.monthly[5].sales).toBe(384400);
    expect(r.thisMonth).toEqual({ sales: 384400, salesMomPct: 3, cost: null, grossProfit: null, grossMarginPct: null, grossProfitMomPct: null });
    expect(r.slowMovers[0]).not.toHaveProperty('costPrice');
    expect(r.slowMovers[0].days).toBe(164);
    expect(r.today).toEqual(full().today);
  });
  it('ไม่แก้ object ต้นฉบับ (pure)', () => { const f = full(); redactShopHome(f); expect(f.monthly[0].cost).toBe(221000); });
});
```

- [ ] **Step 3: รันเทสต์ให้ล้ม** — Run: jest `src/modules/products/cost-visibility.util.spec.ts` · Expected: FAIL `redactShopHome is not a function`

- [ ] **Step 4: เพิ่ม `redactShopHome(r: ShopHomeResponse): ShopHomeResponse`** ใน `cost-visibility.util.ts` — คืน object ใหม่: `watch` map `costValue: null`; `monthly` map `cost: null, grossProfit: null`; `thisMonth` คง `sales`/`salesMomPct` ที่เหลือ null; `slowMovers.map(omitCostPrice)`; ฟิลด์อื่น spread เดิม (import type จาก `../shop-home/shop-home.types`)

- [ ] **Step 5: รันเทสต์ให้ผ่าน** — Expected: PASS 2 tests

- [ ] **Step 6: Commit** — `git add apps/api/src/modules/shop-home/shop-home.types.ts apps/api/src/modules/products/cost-visibility.util.ts apps/api/src/modules/products/cost-visibility.util.spec.ts && git commit -m "feat(shop-home): response types + redactShopHome สำหรับ SALES"`

---

### Task 2: method นับของใหม่ใน sales / bookings / after-sales

**Files:**
- Modify: `apps/api/src/modules/sales/services/sales-query.service.ts`, `apps/api/src/modules/sales/sales.service.ts` (facade passthrough)
- Modify: `apps/api/src/modules/bookings/bookings.service.ts`
- Modify: `apps/api/src/modules/after-sales/services/after-sales-query.service.ts`, `apps/api/src/modules/after-sales/services/after-sales.service.ts` (facade passthrough; module ต้อง export ได้ผ่าน facade เดิม)
- Test: `apps/api/src/modules/sales/services/sales-query.top-sellers.spec.ts`, `apps/api/src/modules/bookings/bookings.expiring-today.spec.ts`, `apps/api/src/modules/after-sales/services/after-sales-query.pickup.spec.ts` (ใหม่ทั้ง 3, mock Prisma ตามแบบ spec ข้างเคียงในโฟลเดอร์เดียวกัน)

**Interfaces:**
- Produces:
  - `SalesService.getTopSellers30d(actor: SalesReadActor, branchId?: string): Promise<{ byModel: { name: string; count: number }[]; byCategory: { name: string; count: number }[] }>` — 30 วันย้อนหลังถึงตอนนี้ (`createdAt >= now-30d`), `deletedAt: null`, `AND: [completedSaleWhere]`, `...salesBranchWhere(actor, branchId)`; include `product { brand, model, category }`; `byModel` จัดกลุ่มด้วย `` `${brand} ${model}` ``, `byCategory` ด้วย `product.category`; เรียง count มาก→น้อย สูงสุด 5
  - `BookingsService.countExpiringToday(user: RequestUser, branchId?: string, now = new Date()): Promise<{ count: number; depositTotal: number; reservedUnits: number }>` — `status in OPEN_BOOKING_STATUSES`, `expireDate: { gt: bangkokStartOfDay(now), lte: expiringBefore(now, 0) }` (**ไม่ใช่** `bangkokDateRange(today, today)` — ใบจองเก็บ expireDate เป็นเที่ยงคืนไทยของวันถัดจากวันสุดท้ายที่ใช้ได้ ช่วงของวันนี้ตรง ๆ จะได้แต่ใบที่หมดอายุไปแล้วเมื่อวาน; แก้หลัง code review), `deletedAt: null`, `branchId` ถ้าส่ง; `depositTotal` = Σ `depositAmount` ของ status `PAID`; `reservedUnits` = count ที่ status `PAID`
  - `AfterSalesService.countReadyForPickup(branchId?: string): Promise<{ waitingPickup: number; overdue: number }>` — `stage: 'READY_FOR_PICKUP'`, `deletedAt: null`, `branchId` ถ้าส่ง; `overdue` = เคสที่ `isStale('READY_FOR_PICKUP', stageSince(...))` เป็นจริง (ใช้ util ใน `after-sales-stage.util.ts`, ดึง field ที่ `stageSince` ต้องใช้มาคำนวณฝั่ง JS)

- [ ] **Step 1: เขียนเทสต์ที่ล้มทั้ง 3 ไฟล์**

```ts
// sales-query.top-sellers.spec.ts
it('จัดกลุ่มตามรุ่นและหมวด เรียงมาก→น้อย สูงสุด 5', async () => {
  prisma.sale.findMany.mockResolvedValue([
    { product: { brand: 'Apple', model: 'iPhone 15', category: 'PHONE_NEW' } },
    { product: { brand: 'Apple', model: 'iPhone 15', category: 'PHONE_NEW' } },
    { product: { brand: 'Samsung', model: 'A16', category: 'PHONE_NEW' } },
    { product: { brand: 'Apple', model: 'ฟิล์มกระจก', category: 'ACCESSORY' } },
  ]);
  const r = await service.getTopSellers30d(owner);
  expect(r.byModel[0]).toEqual({ name: 'Apple iPhone 15', count: 2 });
  expect(r.byCategory).toEqual([{ name: 'PHONE_NEW', count: 3 }, { name: 'ACCESSORY', count: 1 }]);
  expect(prisma.sale.findMany.mock.calls[0][0].where.createdAt.gte).toBeInstanceOf(Date);
});
it('SALES ไม่มีสาขา → where id in [] (ไม่ throw) และผลว่าง', ...);

// bookings.expiring-today.spec.ts
it('นับเฉพาะใบเปิดที่หมดอายุวันนี้ และรวมมัดจำของใบที่จ่ายแล้ว', async () => {
  prisma.booking.findMany.mockResolvedValue([{ status: 'PAID', depositAmount: '3000' }, { status: 'PENDING_DEPOSIT', depositAmount: '1000' }, { status: 'PAID', depositAmount: '1000' }]);
  expect(await service.countExpiringToday(owner, 'b-1')).toEqual({ count: 3, depositTotal: 4000, reservedUnits: 2 });
  const where = prisma.booking.findMany.mock.calls[0][0].where;
  expect(where.status.in).toEqual(OPEN_BOOKING_STATUSES); expect(where.branchId).toBe('b-1'); expect(where.expireDate).toEqual(expect.objectContaining({ gte: expect.any(Date) }));
});

// after-sales-query.pickup.spec.ts
it('นับเคสรอรับ และเคสที่รอเกิน 7 วันเป็น overdue', async () => { /* 3 เคส: readySince 1 วัน, 8 วัน, 30 วัน → { waitingPickup: 3, overdue: 2 } */ });
```

- [ ] **Step 2: รันเทสต์ให้ล้ม** — Expected: FAIL ที่ method ไม่มี

- [ ] **Step 3: Implement ทั้ง 3 method ตาม Interfaces** (facade: `SalesService.getTopSellers30d` → `this.query.getTopSellers30d(...)`; `AfterSalesService.countReadyForPickup` → query service)

- [ ] **Step 4: รันเทสต์ 3 ไฟล์ให้ผ่าน + รัน spec เดิมของ 3 โมดูลนี้ให้ยังผ่าน** — Run: jest `src/modules/sales src/modules/bookings src/modules/after-sales`

- [ ] **Step 5: Commit** — `git commit -m "feat(shop-home): ตัวนับขายดี 30 วัน / จองครบกำหนดวันนี้ / รอลูกค้ารับ ใน service เจ้าของข้อมูล"`

---

### Task 3: สถานะลิ้นชักรวมหลายสาขา + export จาก ShopTendersModule

**Files:**
- Modify: `apps/api/src/modules/shop-tenders/shop-cash-close.service.ts`
- Modify: `apps/api/src/modules/shop-tenders/shop-tenders.module.ts` (`exports: [ShopCashCloseService]`)
- Test: `apps/api/src/modules/shop-tenders/shop-cash-close.drawer-snapshot.spec.ts` (ใหม่)

**Interfaces:**
- Consumes: `computeRound(db, branchId, until)` (public ในไฟล์เดียวกัน), `EFFECTIVE_CASH_CLOSE_STATUSES`
- Produces: `ShopCashCloseService.getDrawerSnapshot(branchId: string | undefined, now: Date): Promise<{ balance: number; closedToday: boolean; lastClosedAt: string | null }>` — สาขาที่พิจารณา = `[branchId]` ถ้าส่ง มิฉะนั้นทุกสาขา active ที่มี `shopCashFloat` ไม่ null (`branch.findMany`); `balance` = Σ `expectedAmount` ของ `computeRound` แต่ละสาขา; `closedToday` = ทุกสาขาที่พิจารณามี close วันนี้ (`date = bangkokDateString(now)`, status ใน `EFFECTIVE_CASH_CLOSE_STATUSES`); `lastClosedAt` = เวลาสร้างของ close ล่าสุด (วันนี้หรือก่อนหน้า) ใน ISO หรือ null

- [ ] **Step 1: เขียนเทสต์ที่ล้ม**

```ts
it('ไม่ส่ง branchId → รวม expectedAmount ทุกสาขาที่มีลิ้นชัก และ closedToday=false ถ้ามีสาขาที่ยังไม่ปิด', async () => {
  // branch.findMany → 2 สาขา; computeRound mock → 12450 และ 8000; shopCashClose.findMany วันนี้ → เฉพาะสาขา 1
  expect(await service.getDrawerSnapshot(undefined, now)).toEqual({ balance: 20450, closedToday: false, lastClosedAt: '2026-10-21T14:05:00.000Z' });
});
it('ส่ง branchId → เฉพาะสาขานั้น และ closedToday=true เมื่อมี close วันนี้', ...);
it('ไม่มีสาขาที่มีลิ้นชัก → balance 0, closedToday false, lastClosedAt null', ...);
```

- [ ] **Step 2: รันเทสต์ให้ล้ม** → **Step 3: Implement** → **Step 4: รันให้ผ่าน + spec เดิมของ shop-tenders ผ่าน**

- [ ] **Step 5: Commit** — `git commit -m "feat(shop-home): getDrawerSnapshot รวมลิ้นชักหลายสาขา + export ShopCashCloseService"`

---

### Task 4: `ShopHomeService` ประกอบ response

**Files:**
- Create: `apps/api/src/modules/shop-home/shop-home.service.ts`
- Test: `apps/api/src/modules/shop-home/shop-home.service.spec.ts`

**Interfaces:**
- Consumes: `SalesService.getDailySummary(date, actor, branchId?)` (`{ totalSales, cashSales, installmentSales, externalFinanceSales, totalRevenue }`), `SalesService.getTopSellers30d`, `BookingsService.countExpiringToday`, `AfterSalesService.countReadyForPickup`, `ShopCashCloseService.getDrawerSnapshot`, `ProductsStockService.getStockDashboard(branchId?)` (`actionRequired`, `stockAging[].{label,count,value}`, `slowMovers`), `ReorderPointsService.getActiveAlerts(branchId?, 1, 4)` (`total`, `data[].{brand,model}` — ตาราง StockAlert ที่ cron ดูแล ไม่ใช่ `getLowStockDashboard` ซึ่ง query N+1), `PurchaseOrdersService.getSummary()` (`pendingApproval`), `AccountingService.getProfitLossFromJournal(start, end, undefined, 'SHOP')` (`revenue.rows[].{code,amount}`, `expenses.rows[].{code,amount}` เป็น Decimal), `PrismaService` (เฉพาะ `purchaseOrder.findFirst({ where: { status: 'DRAFT' }, orderBy: { createdAt: 'desc' }, select: { poNumber: true } })` และ `branch.findUnique` สำหรับชื่อสาขา)
- Produces: `ShopHomeService.build(actor: { id: string; role: string; branchId?: string | null }, branchId: string | undefined, now = new Date()): Promise<ShopHomeResponse>` — **ไม่ตัดต้นทุน** (controller ทำ)

กติกาประกอบที่ต้องตรง:
- `watch` สร้างตามลำดับ LOW_STOCK(urgent) → AGING_90(urgent, `costValue = stockAging[3].value`, detail null) → QC_PHOTO(wait, count = qcPending + photoPending, detail `รอ QC a · รอถ่ายรูป b`) → TRANSFER_PENDING(wait) → REPOSSESSED(wait) → PO_APPROVAL(info, detail = poNumber ล่าสุดหรือ null); ตัดรายการ count 0 ทิ้ง; LOW_STOCK detail = ชื่อ `${brand} ${model}` สูงสุด 4 คั่น ` · `
- `monthly` = 6 เดือนเก่า→ใหม่ จบที่เดือนปัจจุบัน; ต่อเดือน `periodStart = bangkokMidnight(y,m,1)`, `periodEnd` = วันสุดท้ายของเดือน 23:59:59.999; `sales = Σ revenue.rows (code.startsWith('S41'))` (S42 รายได้อื่นไม่นับ), `cost = Σ expenses.rows (code.startsWith('S50'))`, `grossProfit = sales − cost`; `month = 'YYYY-MM'`; เรียก P&L 6 ครั้งแบบ `Promise.all`; **ไม่ขึ้นกับ branchId** (ledger ไม่มีสาขา); หลังคำนวณ **ตัดเดือนนำหน้าที่ `sales === 0 && cost === 0` ออก** จนเจอเดือนแรกที่มีค่า (คงเดือนปัจจุบันไว้เสมอ)
- `thisMonth`: `prev` = เดือนก่อนหน้าเดือนปัจจุบัน (ถ้าถูกตัดออกถือว่า 0); `salesMomPct = round((sales − prev.sales) / prev.sales × 100)` เมื่อ `prev.sales > 0` มิฉะนั้น `null`; `grossMarginPct = round(grossProfit / sales × 100)` เมื่อ `sales > 0` มิฉะนั้น `null`; `grossProfitMomPct` แบบเดียวกับ sales (ฝั่งเว็บติดป้าย "เทียบเดือนก่อนทั้งเดือน")
- `today.sales` = `{ count: totalSales, netAmount: totalRevenue, cash: cashSales, installment: installmentSales, externalFinance: externalFinanceSales }` ด้วย `date = bangkokDateString(now)`
- `slowMovers` = `getStockDashboard().slowMovers.filter(days >= 30).slice(0,5)` (คง `costPrice`); `stockAging` = map `{label, count}`
- `branch` = `{ id: branchId ?? null, name: branchId ? branch.name : 'ทุกสาขา' }`

- [ ] **Step 1: เขียนเทสต์ที่ล้ม** (mock dependencies ทั้งหมดด้วย `jest.fn()`; fixture now = `2026-10-22T03:00:00Z`)

```ts
it('ประกอบ today/watch/monthly/thisMonth/topSellers/slowMovers/stockAging ครบตามสเปก', ...); // ตรวจค่าทุกก้อนจาก mock
it('watch: ตัดแถว count 0 และเรียง urgent→wait→info; LOW_STOCK detail รวมชื่อ 4 รายการคั่นด้วย " · "', ...);
it('monthly: วันที่ 1 ของเดือน ขอ 6 เดือนและเดือนปัจจุบันเป็น 0 แต่ไม่ถูกตัด', ...); // now = 2026-11-01T01:00:00Z
it('monthly: เดือนนำหน้าที่ sales=0,cost=0 ถูกตัดออก (P&L mock: 3 เดือนแรกว่าง → เหลือ 3 เดือน)', ...);
it('thisMonth: เดือนก่อนยอด 0 → salesMomPct และ grossProfitMomPct เป็น null ไม่ใช่ Infinity', ...);
it('sales = Σ เฉพาะแถว S41 (S42 ไม่นับ) และ cost = Σ เฉพาะแถว S50 (ไม่รวม S51/S52/S53)', ...);
it('LOW_STOCK มาจาก getActiveAlerts: count = total, detail = brand model 4 รายการ', ...);
it('branchId → ส่งต่อให้ทุก service ย่อยยกเว้น P&L และ PO summary', ...);
```

- [ ] **Step 2: รันเทสต์ให้ล้ม** → **Step 3: Implement `ShopHomeService`** (`@Injectable()`; constructor inject ทุก service ตาม Consumes) → **Step 4: รันให้ผ่าน**

- [ ] **Step 5: Commit** — `git commit -m "feat(shop-home): ShopHomeService ประกอบ response จาก service เจ้าของข้อมูล"`

---

### Task 5: Controller + Module + ลงทะเบียน

**Files:**
- Create: `apps/api/src/modules/shop-home/shop-home.controller.ts`, `apps/api/src/modules/shop-home/shop-home.module.ts`
- Modify: `apps/api/src/app.module.ts` (import `ShopHomeModule` ข้าง `DashboardModule` บรรทัด ~39 และ ~229)
- Test: `apps/api/src/modules/shop-home/shop-home.controller.spec.ts`

**Interfaces:**
- Consumes: `ShopHomeService.build`, `redactShopHome`, `canSeeCost`
- Produces: `GET /shop-home?branchId=` → `ShopHomeResponse`

- [ ] **Step 1: เขียนเทสต์ที่ล้ม** (แบบ `products.controller.dashboard-cost.spec.ts`: `Test.createTestingModule` + override 3 guards)

```ts
it('@Roles ครบ 5 บทบาทรวม SALES', () => expect(Reflect.getMetadata('roles', ShopHomeController.prototype.get)).toEqual(['OWNER','BRANCH_MANAGER','FINANCE_MANAGER','ACCOUNTANT','SALES']));
it('OWNER ได้ response เต็ม และ branchId ส่งต่อตามที่ขอ', ...); // service.build toHaveBeenCalledWith(owner, 'b-2', expect.any(Date))
it('BRANCH_MANAGER และ SALES ถูกบังคับ branchId ของตัวเอง แม้ไม่ส่งหรือส่ง branchId อื่น', ...); // build called with 'b-1'
it('SALES ที่ไม่มีสาขาผูก → ForbiddenException', ...);
it('SALES ได้ response ที่ผ่าน redactShopHome (monthly cost null, slowMovers ไม่มี costPrice) และไม่มีแถว PO_APPROVAL', ...);
it('OWNER ยังได้แถว PO_APPROVAL', ...);
```

- [ ] **Step 2: รันเทสต์ให้ล้ม** → **Step 3: Implement**
  - `@Controller('shop-home') @UseGuards(JwtAuthGuard, RolesGuard, BranchGuard)`; method `get(@CurrentUser() user, @Query('branchId') branchId?)` พร้อม `@Roles(...)` 5 บทบาท; effective branch: `const scope = getBranchScope(user); if (scope.all) use branchId || undefined; else if (!scope.branchId) throw new ForbiddenException('บัญชีนี้ยังไม่ผูกสาขา'); else scope.branchId`; หลัง build: `if (user.role === 'SALES') watch = watch.filter(w => w.key !== 'PO_APPROVAL')` แล้ว `redactShopHome`
  - `ShopHomeModule`: `imports: [SalesModule, BookingsModule, AfterSalesModule, ShopTendersModule, InventoryModule, PurchaseOrdersModule, ProductsModule, AccountingModule]`, `providers: [ShopHomeService]`, `controllers: [ShopHomeController]`
- [ ] **Step 4: รันเทสต์ให้ผ่าน + `npx tsc --noEmit -p apps/api/tsconfig.json` เขียว + `npx nest build` ผ่าน** (ตรวจ DI: ถ้า module ใดไม่ export service ที่ต้องใช้ ให้แก้ที่ module นั้นด้วย exports เพิ่ม ไม่ย้าย provider)

- [ ] **Step 5: Commit** — `git commit -m "feat(shop-home): GET /shop-home endpoint + module"`

---

### Task 6: ฝั่งเว็บ — types, hook, แยกการ์ดงานของฉัน, เลือกหน้าตามโซน

**Files:**
- Create: `apps/web/src/pages/ShopHomePage/types.ts` (คัดลอก `ShopHomeResponse` จาก API เป็น TS interface ฝั่งเว็บ), `apps/web/src/pages/ShopHomePage/hooks/useShopHome.ts`
- Create: `apps/web/src/pages/DashboardPage/components/MyTodayTasksCard.tsx` (ย้ายการ์ด todo + query จาก `StaffHome.tsx` มา; StaffHome ใช้ component นี้แทนโค้ดเดิม) และ `apps/web/src/pages/DashboardPage/components/HomeActionsGrid.tsx` (ย้ายตารางปุ่ม "เริ่มงาน" จาก `homeActionsForRole` ออกมาเป็น component รับ `role: string`; StaffHome ใช้ตัวนี้แทน)
- Modify: `apps/web/src/pages/DashboardPage/index.tsx`, `apps/web/src/pages/DashboardPage/components/StaffHome.tsx`
- Test: `apps/web/src/pages/DashboardPage/DashboardPage.zone.test.tsx` (ใหม่), แก้ `StaffHome.test.tsx` ให้ mock `useLayout` → `{ workZone: 'fin', currentZone: 'fin' }` เพื่อยังทดสอบ StaffHome เดิมได้ (SALES ในโซน shop จะไปหน้าใหม่)

**Interfaces:**
- Produces: `useShopHome(): UseQueryResult<ShopHomeResponse>` — `queryKey: ['shop-home']`, `queryFn: (await api.get('/shop-home')).data`, `staleTime: cacheTtlDashboard * 1000`; `MyTodayTasksCard` (default export, ไม่มี props, ใช้ `useAuth` + query key เดิม `['todos','staff-home',user.id]`); `HomeActionsGrid({ role }: { role: string })` (default export; render `homeActionsForRole(role)` เป็น grid ลิงก์เดิมของ StaffHome)
- `DashboardPage`: `const { workZone } = useLayout(); if (workZone === 'shop') return <ShopHomePage/>; return user.role === 'SALES' ? <StaffHome/> : <ManagementDashboard/>` (ทั้งหมดใน `Suspense` เดิม; `ShopHomePage` lazy import `@/pages/ShopHomePage`)

- [ ] **Step 1: เขียนเทสต์ที่ล้ม** `DashboardPage.zone.test.tsx` (mock `useAuth`, `useLayout`, lazy pages ด้วย `vi.mock('@/pages/ShopHomePage', () => ({ default: () => <main aria-label="shop-home" /> }))` ฯลฯ)

```ts
it.each([
  ['OWNER', 'shop', 'shop-home'], ['SALES', 'shop', 'shop-home'],
  ['OWNER', 'fin', 'management'], ['SALES', 'fin', 'staff-home'],
])('%s ในโซน %s → %s', async (role, zone, expected) => { /* render แล้ว await screen.findByLabelText(expected) */ });
```

- [ ] **Step 2: รันให้ล้ม** → **Step 3: Implement** (สร้างไฟล์ `ShopHomePage/index.tsx` ขั้นต่ำ `export default function ShopHomePage(){ return <main aria-label="shop-home" /> }` ไว้ก่อน Task 7 จะเติม) → **Step 4: รัน `DashboardPage.zone.test.tsx` และ `StaffHome.test.tsx` ให้ผ่าน**

- [ ] **Step 5: Commit** — `git commit -m "feat(web): DashboardPage เลือกหน้าตามโซน + แยก MyTodayTasksCard + useShopHome"`

---

### Task 7: ฝั่งเว็บ — หน้า ShopHomePage ตาม mockup

**Files:**
- Create: `apps/web/src/pages/ShopHomePage/index.tsx`, `components/TodayKpiStrip.tsx`, `components/WatchList.tsx`, `components/MonthlyChart.tsx`, `components/TopSellersCard.tsx`, `components/SlowMoversCard.tsx`, `watch-links.ts`
- Test: `apps/web/src/pages/ShopHomePage/__tests__/ShopHomePage.test.tsx`, `apps/web/src/pages/ShopHomePage/__tests__/watch-links.test.ts`

**Interfaces:**
- Consumes: `useShopHome`, `MyTodayTasksCard`, `PageHeader`, `Card`, `AnimatedCounter`, `Button`, `QueryBoundary`, `DashboardSkeleton`, `useCommandPalette`, `categoryLabels`, recharts (รูปแบบเดียวกับ `StockDashboardTab`)
- Produces: `watchHref(key: ShopHomeWatchKey, role: string): string | null` ใน `watch-links.ts` — LOW_STOCK → `/stock/alerts` (OWNER, BM เท่านั้น มิฉะนั้น null) · AGING_90 → `/stock/products?sortBy=stockInDate&sortDirection=asc` · QC_PHOTO → `/purchase-orders/qc` (OWNER, BM) · TRANSFER_PENDING → `/stock/transfers` (OWNER, BM) · REPOSSESSED → `/stock/products?view=all&status=REPOSSESSED` · PO_APPROVAL → `/purchase-orders` (ไม่ใช่ SALES มิฉะนั้น null); แถวที่ href null แสดงเป็น `<div>` ไม่ใช่ `<a>`

กติกา UI (จากสเปก §4 และ §6):
- หัว: `PageHeader title="หน้าหลักหน้าร้าน" subtitle={`${branch.name} · ${วันที่ไทย} · อัปเดต ${HH:MM จาก generatedAt}`}` ปุ่ม 3 ปุ่ม (ค้นหา → `openSearch()`, รับของเข้า → `/purchase-orders` ซ่อนสำหรับ SALES, ขายสินค้า → `/pos` primary ซ่อนสำหรับ FM/ACC)
- KPI 4 ใบเป็น `<Link>`; ข้อความรองตามสเปก (การ์ดที่ 3 หัว "ใบจองหมดอายุวันนี้" รอง "มัดจำรวม X ฿ · จ่ายมัดจำแล้ว N ใบ · ควรตามลูกค้า"); `AnimatedCounter` สำหรับตัวเลขหลัก; เงินแสดง `toLocaleString('th-TH')` + " ฿"
- SALES: ใต้ KPI แสดง `<HomeActionsGrid role="SALES" />` (ปุ่ม "เริ่มงาน" เดิมของ StaffHome ไม่หาย)
- WatchList: ชิป `{count}` + `<small>ด่วน|รอ|แจ้ง</small>` สีตาม severity (`bg-destructive/15 text-destructive` / `bg-warning/15 text-warning-strong` / `bg-muted text-muted-foreground`); แถวสูง `min-h-12`; ว่าง → "ไม่มีงานค้าง วันนี้ว่าง"; AGING_90 แสดง "ทุนจม X ฿" เฉพาะ `costValue != null`
- MonthlyChart: `BarChart` 2 แท่ง `sales` (fill `hsl(var(--primary))`) และ `cost` (fill `url(#shop-home-cost-hatch)` จาก `<defs><pattern>` ลายทแยง + stroke `hsl(var(--muted-foreground))`); แสดง `cost` เฉพาะเมื่อ `monthly[0].cost != null`; หัวการ์ดและแถวตัวเลขสลับตาม `thisMonth.cost == null`; ป้าย MoM เขียน "เทียบเดือนก่อนทั้งเดือน"; label เดือนไทย `['ม.ค.',…,'ธ.ค.']` จาก `month`; รองรับ `monthly.length` 1–6 (ถ้า < 2 เดือน ซ่อน MoM); หมายเหตุใต้กราฟ; กราฟอยู่ใน `overflow-x-auto` กว้างขั้นต่ำ 420px
- TopSellersCard: แท็บ 2 ปุ่ม (`aria-pressed`, `min-h-9`) สลับ `byModel`/`byCategory` (หมวดแปลด้วย `categoryLabels`); แถบสัดส่วนเทียบอันดับ 1; ชื่อรุ่นเป็น `<Link to={`/stock/products?q=${encodeURIComponent(name)}`}>`
- SlowMoversCard: 5 อันดับ สีลำดับ `days > 90` แดง / อื่น เหลือง; "ทุน X" เฉพาะ `costPrice != null`; ลิงก์ "ดูทั้งหมด" → `/stock/products?sortBy=stockInDate&sortDirection=asc`; ท้ายการ์ดช่วงอายุ 4 ค่า
- SALES (`user.role === 'SALES'`) ต่อท้ายด้วย `<MyTodayTasksCard />`
- โหลด: `DashboardSkeleton`; error: `QueryBoundary` แบบ ManagementDashboard

- [ ] **Step 1: เขียนเทสต์ที่ล้ม**

```ts
// watch-links.test.ts
it.each([['LOW_STOCK','OWNER','/stock/alerts'],['LOW_STOCK','SALES',null],['REPOSSESSED','SALES','/stock/products?view=all&status=REPOSSESSED'],['PO_APPROVAL','SALES',null],['PO_APPROVAL','ACCOUNTANT','/purchase-orders']])('%s + %s → %s', ...);

// ShopHomePage.test.tsx (mock useAuth/useLayout/api/useCommandPalette/MyTodayTasksCard; fixture full และ redacted)
it('OWNER: เห็นยอดขายวันนี้ กำไรขั้นต้น ทุนจม และหัวกราฟแบบเต็ม', ...); // getByText('48,900') etc., getByText(/กำไรขั้นต้น 6 เดือน/)
it('SALES (response ถูกตัด): ไม่มีคำว่า "ทุน" ในหน้า หัวกราฟ "ยอดขาย 6 เดือน" และมีการ์ดงานของฉัน', ...); // queryByText(/ทุน/) null, getByLabelText('my-today-tasks')
it('watch ว่าง → "ไม่มีงานค้าง วันนี้ว่าง"', ...);
it('ชิปทุกแถวมีคำกำกับ ด่วน/รอ/แจ้ง', ...);
it('SALES ไม่เห็นปุ่มรับของเข้า และแถว LOW_STOCK ไม่เป็นลิงก์', ...);
it('SALES เห็นตารางปุ่มเริ่มงาน (HomeActionsGrid) OWNER ไม่เห็น', ...);
it('monthly 3 เดือน → กราฟมี 3 แท่ง ไม่พัง', ...);
```

- [ ] **Step 2: รันให้ล้ม** → **Step 3: Implement ทุก component** → **Step 4: รัน `src/pages/ShopHomePage` และ `src/pages/DashboardPage` ให้ผ่าน; `npx tsc --noEmit -p apps/web/tsconfig.json`; eslint ไฟล์ที่แก้**

- [ ] **Step 5: Commit** — `git commit -m "feat(web): หน้าหลักหน้าร้าน ShopHomePage ตาม mockup ที่เคาะ"`

---

### Task 8: ปิดงาน — version, ตรวจทั้งชุด, PR

**Files:**
- Modify: `apps/web/package.json` (`"version": "26.10.46"`)

- [ ] **Step 1: bump version** — `sed -i '' 's/"version": "26.10.45"/"version": "26.10.46"/' apps/web/package.json`
- [ ] **Step 2: รันชุดตรวจ** — jest โฟลเดอร์ `shop-home`, `products`, `sales`, `bookings`, `after-sales`, `shop-tenders`; vitest `src/pages/ShopHomePage src/pages/DashboardPage src/pages/StockPage`; tsc api + web; eslint ไฟล์ที่แก้ทั้งหมด (api ใช้ `-c eslint.config.mjs`) · Expected: ทั้งหมดเขียว
- [ ] **Step 3: ยิงของจริง 1 ครั้ง** — ถ้า API local (พอร์ต 3001) รันอยู่ ให้ `curl` `GET /api/admin/shop-home` ด้วย token OWNER และ SALES (ดู `bestchoice-local-dev-gotchas` ข้อ 11) ตรวจว่า status 200, SALES ไม่มีคีย์ `costPrice`/ค่า cost ที่ไม่ใช่ null, และ `monthly` ไม่มีแท่ง 0 นำหน้า; ถ้ารันไม่ได้ให้บันทึกไว้ใน PR ว่าข้ามขั้นนี้
- [ ] **Step 4: Commit + push** — `git commit -m "chore(web): bump 26.10.46"` แล้ว `git push -u origin feat/shop-home-dashboard`
- [ ] **Step 5: เปิด PR** base = `fix/stock-dashboard-cost-leak-sales` (stack บน #1723; ถ้า #1723 merge แล้วให้ base = `main`) หัวข้อ `feat(shop-home): หน้าหลักหน้าร้าน (A12/A13/A14)` body ตามแบบ #1723 ลงท้าย `🤖 Generated with [Claude Code](https://claude.com/claude-code)`; ห้ามใส่ข้อมูลภายใน (repo เป็น public)
