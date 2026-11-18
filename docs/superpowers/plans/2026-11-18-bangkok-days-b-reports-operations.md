# แผน ข — รายงานยอดขายและงานหน้าร้าน · แผนลงมือ

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** รายงานยอดขาย/รับเงิน และรายการงานหน้าร้าน (ใบเสร็จ · ใบสั่งซื้อ · ตัดสต๊อก · โอนสินค้า · ใบซ่อม · เปลี่ยนเครื่อง · หนังสือทวงถาม) นับ "วันที่เลือก" เป็นวันเต็มตามปฏิทินไทย ไม่ตัดรายการเที่ยงคืน–06:59 น. ของวันเริ่ม และไม่ตัดช่วงบ่ายของวันสิ้นสุด

**Architecture:** ใช้ตัวช่วย `reportDayStart` / `reportDayEnd` / `reportAsOf` / `bangkokDateString` / `bkkYearMonth` ใน `apps/api/src/utils/date.util.ts` (มีอยู่แล้วจาก PR #1789) แทน `new Date('YYYY-MM-DD')` และ `setHours(23,59,59,999)` ที่ service/controller ของแต่ละโมดูล · แก้ที่จุดที่ service เป็นคนแปลงสตริงวันที่เอง ไม่แตะ route/decorator · ทุกงานมีเทสต์ที่ยืนยัน "ขอบเวลาจริง (ISO instant)" ที่ถึง Prisma `where`

**Tech Stack:** NestJS + Prisma (`apps/api`, Jest)

## Global Constraints

- วันที่แบบ `YYYY-MM-DD` = วันตามปฏิทินไทย: เริ่ม 00:00:00.000 น. · สิ้นสุด 23:59:59.999 น. (เวลาไทย) ไม่ขึ้นกับ TZ ของโปรเซส · ใช้ตัวช่วยใน `apps/api/src/utils/date.util.ts` เท่านั้น ห้ามเขียนสูตรแปลงวันชุดใหม่
- ค่าที่ไม่ใช่รูป `YYYY-MM-DD` ต้องได้พฤติกรรมเดิม (ยกเว้นจุดที่แผนระบุว่าเปลี่ยนเป็น 400)
- ไม่เพิ่ม/เปลี่ยน route หรือ decorator (`@Get` / `@Post` / `@Roles` / `@UseGuards`) — `apps/api/src/modules/employee-access/access-policy.manifest.json` ต้องไม่ถูกแก้
- ไม่เปลี่ยนตรรกะอื่นของรายงาน/รายการ (ตัวกรองอื่น · การเรียงลำดับ · การแบ่งหน้า · รูปคำตอบ)
- เงินใช้ `Prisma.Decimal` เท่านั้น
- ช่อง `@db.Date` (เก็บแค่วันที่) ไม่อยู่ในขอบเขต — ห้ามเปลี่ยนขอบของช่องแบบนี้
- ข้อมูลเดิมในฐานข้อมูลไม่ถูกแก้ (forward-only) — แก้เฉพาะการอ่าน/การกรอง
- สภาพแวดล้อมเครื่องนี้: jest/tsc ของ `apps/api` ต้องรันด้วย `NODE_OPTIONS=--max-old-space-size=8192` · `node tools/check-access-coverage.mjs` ล้มบน Windows checkout อยู่ก่อนแล้ว (CI เป็นตัวตัดสิน)
- ทำบน branch `fix/bangkok-day-bounds` (ต่อจาก `feat/finance-trial-balance` / PR #1789)
- commit ลงท้ายด้วย `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>`

**เพิ่มเฉพาะแผน ข:**

- **ไม่แตะ `apps/api/src/modules/accounting/transactional-report.service.ts`** (แผน A เป็นเจ้าของ — `getProfitLossReport` :132 · `getCashFlowStatement` :792 · `getBalanceSheet` :589 · ตัว `/reports/profit-loss` `/reports/cash-flow` `/reports/comparative-pl` วิ่งผ่านไฟล์นั้น) · แผนนี้แก้เฉพาะ "ทางเข้า" ที่อยู่ในโมดูล `reports` (`reports.service.ts` / `reports.controller.ts`)
- **ไม่เปลี่ยนค่าในคำตอบ** — ฟิลด์ `period: { start, end }` ของรายงานยังส่งสตริงที่ผู้ใช้ส่งมาตามเดิม
- **`to` ที่เป็น ISO มีเวลา** ของ 3 จุดที่เดิมไม่เคยขยายเป็นสิ้นวัน (ใบซ่อม · เปลี่ยนเครื่อง · หนังสือทวงถาม) ต้องคงเป็นขอบบนตรงตัวเหมือนเดิม — ใช้ `reportAsOf` (ไม่ใช่ `reportDayEnd`) — `YYYY-MM-DD` = สิ้นวันไทย · ค่าอื่นคงเดิม (Task 9–11) · กฎ: `reportDayEnd` ใช้เฉพาะจุดที่โค้ดเดิมมี `setHours(23,59,59,999)` อยู่แล้ว; จุดที่เดิมเป็น `new Date(end)` เปล่า ๆ ใช้ `reportAsOf`
- **ไม่แก้ web** — ไม่มี route/หน้าจอ/ข้อความใหม่ ⇒ ไม่ bump เวอร์ชันเว็บ
- jest ใช้ `npx jest <path>` ใน `apps/api` · เครื่องนี้ TZ = เวลาไทย (ตรวจ: `node -e "console.log(new Date().toString())"`) · เทสต์ที่ยืนยันขอบวันทุกตัวเขียนด้วย ISO instant ตายตัว จึงต้องให้ผลเหมือนกันทุก TZ ของเครื่องรัน (CI อาจเป็น UTC) — ในขั้น "รันให้ผ่าน" ของทุก Task รันซ้ำด้วย `TZ=UTC` (ใช้ได้บนเครื่องนี้ ตรวจแล้ว)

## File Structure

| ไฟล์ (ใต้ `apps/api/src/modules/`) | หน้าที่ |
|---|---|
| `reports/services/revenue-report.service.ts` | `getRevenuePLReport` · `getSalesComparisonReport` · `getDailyPaymentSummary` · `getEntityProfitReport` ใช้ตัวช่วย |
| `reports/reports.date-bounds.spec.ts` (ใหม่) | ปักขอบวันของรายงานใน `reports/*` (Task 1–2) |
| `reports/services/operational-report.service.ts` | `getBranchComparisonReport` · `exportContracts` ใช้ตัวช่วย |
| `reports/reports.service.ts` | `getQuarterlyReport` ได้วันสุดท้ายของไตรมาสถูกวัน |
| `reports/reports.aggregations.spec.ts` | แก้เทสต์ `getQuarterlyReport` ที่เคยปักบั๊ก |
| `reports/reports.controller.ts` | `getBalanceSheet` ค่าตั้งต้น `asOfDate` = วันนี้ตามเวลาไทย |
| `reports/reports.controller.balance-sheet.spec.ts` (ใหม่) | ปักค่าตั้งต้น |
| `reports/report-generator.service.ts` | ป้ายวันของรายงานรายวัน/รายสัปดาห์ + หน้าต่างวันใช้ตัวช่วย |
| `reports/report-generator.service.spec.ts` (ใหม่) | ปักป้ายวัน/หน้าต่างวัน |
| `receipts/services/receipt-query.service.ts` | `findAll` (`dateFrom`/`dateTo`) |
| `receipts/services/receipt-query.service.date-bounds.spec.ts` (ใหม่) | เทสต์ |
| `purchase-orders/services/po-query.service.ts` | `getGoodsReceivings` · `getReceivingSummary` |
| `purchase-orders/services/po-query.service.date-bounds.spec.ts` (ใหม่) | เทสต์ |
| `inventory/stock-adjustments.service.ts` | `findAll` · `getSummary` |
| `inventory/stock-adjustments.service.spec.ts` | เพิ่มเทสต์ขอบวัน |
| `products/services/stock-transfer.service.ts` | `getTransferHistory` |
| `products/services/stock-transfer.service.date-bounds.spec.ts` (ใหม่) | เทสต์ |
| `repair-tickets/services/repair-ticket-query.service.ts` | `findAll` (`from`/`to`) |
| `repair-tickets/__tests__/repair-tickets.service.spec.ts` | เพิ่มเทสต์ใน `describe('RepairTicketsService.findAll')` |
| `defect-exchange/defect-exchange.service.ts` | `list` (`from`/`to`) |
| `defect-exchange/defect-exchange.service.list-dates.spec.ts` (ใหม่) | เทสต์ |
| `overdue/contract-letter.service.ts` | `list` · `getCountsByStatus` |
| `overdue/contract-letter.service.spec.ts` | เพิ่มเทสต์ |
| `payments/payments.controller.ts` | ค่าตั้งต้นของ `daily-summary` / `daily-summary/dates` |
| `payments/payments.controller.default-dates.spec.ts` (ใหม่) | เทสต์ |
| `contracts/services/contract-query.service.ts` | `getMilestonesSummary` ขอบเดือนปฏิทินไทย (swap ที่ผลเหมือนเดิม) |
| `contracts/services/contract-query.milestones.spec.ts` (ใหม่) | เทสต์ |

---

### Task 1: รายงานใน `/reports/*` ฝั่งรายได้ — `revenue-pl` · `sales-comparison` · `daily-payments` · `entity-profit`

**Files:**
- Modify: `apps/api/src/modules/reports/services/revenue-report.service.ts` (`getRevenuePLReport` :18-20 · `getSalesComparisonReport` :85-87 · `getDailyPaymentSummary` :133-134 · `getEntityProfitReport` :213-215)
- Create/Test: `apps/api/src/modules/reports/reports.date-bounds.spec.ts` (รูปแบบ mock ตาม `reports.aggregations.spec.ts` — `new ReportsService(prisma, {} as AccountingService)` + prisma ที่ปั้นมือ)

**Interfaces:**
- Consumes: `reportDayStart(value: string): Date` · `reportDayEnd(value: string): Date` (`apps/api/src/utils/date.util.ts`)
- Produces: ไฟล์เทสต์ `reports.date-bounds.spec.ts` — Task 2 เพิ่มเทสต์ต่อท้ายไฟล์นี้

- [ ] **Step 1: เขียนเทสต์ที่ต้องล้ม**

สร้าง `apps/api/src/modules/reports/reports.date-bounds.spec.ts`:

```ts
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AccountingService } from '../accounting/accounting.service';
import { ReportsService } from './reports.service';

/**
 * รายงานใน /reports/* รับวันที่แบบ 'YYYY-MM-DD' = วันตามปฏิทินไทย (2026-11-18)
 * เดิม new Date('YYYY-MM-DD') = เที่ยงคืน UTC = 07:00 น. ไทย ⇒ รายการ 00:00–06:59 น. ของวันเริ่มหาย
 * (เช่น ใบจ่ายผ่านเกตเวย์ 03:00 น. · สัญญาที่สร้าง 02:00 น. ของวันที่ 1)
 * รูปแบบ mock ตาม reports.aggregations.spec.ts
 */
const START = new Date('2026-10-31T17:00:00.000Z'); // 2026-11-01 00:00:00.000 น. ไทย
const END = new Date('2026-11-17T16:59:59.999Z'); // 2026-11-17 23:59:59.999 น. ไทย
const AT_START_MIDNIGHT = new Date('2026-11-01T00:00:00+07:00');
const AT_NEXT_DAY_MIDNIGHT = new Date('2026-11-18T00:00:00+07:00');

type Range = { gte: Date; lte?: Date; lt?: Date };
const contains = (r: Range, at: Date) => at >= r.gte && (r.lte ? at <= r.lte : at < r.lt!);
const svcWith = (prisma: unknown) =>
  new ReportsService(prisma as PrismaService, {} as AccountingService);

describe('getRevenuePLReport — ขอบวันตามเวลาไทย', () => {
  function make() {
    const findMany = jest.fn().mockResolvedValue([]);
    const aggregate = jest
      .fn()
      .mockResolvedValue({ _sum: { lateFee: null, amountPaid: null }, _count: 0 });
    const count = jest.fn().mockResolvedValue(0);
    const svc = svcWith({ payment: { findMany, aggregate }, contract: { count } });
    return { svc, findMany, aggregate, count };
  }

  it('ส่ง paidDate / createdAt เป็น [00:00 วันเริ่ม, 23:59:59.999 วันสิ้นสุด] ทั้งสี่ query', async () => {
    const { svc, findMany, aggregate, count } = make();

    await svc.getRevenuePLReport('2026-11-01', '2026-11-17');

    expect(findMany.mock.calls[0][0].where.paidDate).toEqual({ gte: START, lte: END });
    expect(aggregate.mock.calls[0][0].where.paidDate).toEqual({ gte: START, lte: END });
    expect(aggregate.mock.calls[1][0].where.paidDate).toEqual({ gte: START, lte: END });
    expect(count.mock.calls[0][0].where.createdAt).toEqual({ gte: START, lte: END });
  });

  it('ขอบ: แถวเที่ยงคืนไทยของวันเริ่มอยู่ในช่วง · เที่ยงคืนไทยของวันถัดจากวันสิ้นสุดอยู่นอกช่วง', async () => {
    const { svc, count } = make();
    await svc.getRevenuePLReport('2026-11-01', '2026-11-17');
    const range = count.mock.calls[0][0].where.createdAt as Range;
    expect(contains(range, AT_START_MIDNIGHT)).toBe(true);
    expect(contains(range, AT_NEXT_DAY_MIDNIGHT)).toBe(false);
  });
});

describe('getSalesComparisonReport — ขอบวันตามเวลาไทย', () => {
  it('ส่ง createdAt เป็น [00:00 วันเริ่ม, 23:59:59.999 วันสิ้นสุด]', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const svc = svcWith({ contract: { findMany } });

    await svc.getSalesComparisonReport('2026-11-01', '2026-11-17');

    const range = findMany.mock.calls[0][0].where.createdAt as Range;
    expect(range).toEqual({ gte: START, lte: END });
    expect(contains(range, AT_START_MIDNIGHT)).toBe(true);
    expect(contains(range, AT_NEXT_DAY_MIDNIGHT)).toBe(false);
  });
});

describe('getDailyPaymentSummary — หนึ่งวันตามปฏิทินไทย', () => {
  const DAY_START = new Date('2026-11-17T17:00:00.000Z'); // 2026-11-18 00:00 น. ไทย
  const DAY_END = new Date('2026-11-18T17:00:00.000Z'); // 2026-11-19 00:00 น. ไทย

  it('ส่ง paidDate = [00:00 วันที่เลือก, 00:00 วันถัดไป) ให้ findMany / count / aggregate', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const count = jest.fn().mockResolvedValue(0);
    const aggregate = jest.fn().mockResolvedValue({ _sum: { amountPaid: null } });
    const svc = svcWith({ payment: { findMany, count, aggregate } });

    await svc.getDailyPaymentSummary('2026-11-18');

    for (const call of [findMany, count, aggregate]) {
      expect(call.mock.calls[0][0].where.paidDate).toEqual({ gte: DAY_START, lt: DAY_END });
    }
    const range = findMany.mock.calls[0][0].where.paidDate as Range;
    // เดิม (07:00→07:00): ใบ 02:00 น. ของวันที่ 18 ตกเป็นของวันที่ 17 · ใบ 02:00 น. ของวันที่ 19 นับเป็นของวันที่ 18
    expect(contains(range, new Date('2026-11-18T02:00:00+07:00'))).toBe(true);
    expect(contains(range, new Date('2026-11-19T02:00:00+07:00'))).toBe(false);
  });
});

describe('getEntityProfitReport — ขอบวันตามเวลาไทย', () => {
  it('ส่ง createdAt ของรายการระหว่างบริษัท และ paidDate ของค่าปรับ เป็นช่วงเวลาไทย', async () => {
    const txFindMany = jest.fn().mockResolvedValue([]);
    const aggregate = jest.fn().mockResolvedValue({ _sum: { lateFee: null } });
    const svc = svcWith({
      interCompanyTransaction: { findMany: txFindMany },
      payment: { aggregate },
    });

    await svc.getEntityProfitReport('2026-11-01', '2026-11-17');

    expect(txFindMany.mock.calls[0][0].where.createdAt).toEqual({ gte: START, lte: END });
    expect(aggregate.mock.calls[0][0].where.paidDate).toEqual({ gte: START, lte: END });
    const range = txFindMany.mock.calls[0][0].where.createdAt as Range;
    expect(contains(range, AT_START_MIDNIGHT)).toBe(true);
    expect(contains(range, AT_NEXT_DAY_MIDNIGHT)).toBe(false);
  });

  it('ยอดค่าปรับยังเป็น Prisma.Decimal → number เหมือนเดิม (ไม่กระทบรูปคำตอบ)', async () => {
    const svc = svcWith({
      interCompanyTransaction: { findMany: jest.fn().mockResolvedValue([]) },
      payment: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { lateFee: new Prisma.Decimal('150.50') } }),
      },
    });
    const res = (await svc.getEntityProfitReport('2026-11-01', '2026-11-17')) as {
      finance: { lateFeeIncome: number };
    };
    expect(res.finance.lateFeeIncome).toBe(150.5);
  });
});
```

- [ ] **Step 2: รันให้เห็นว่าล้ม**

```bash
cd "/d/BESTCHOICE APP/BESTCHOICE/apps/api" && NODE_OPTIONS=--max-old-space-size=8192 npx jest src/modules/reports/reports.date-bounds.spec.ts
```

Expected: FAIL 5 เทสต์ (`getRevenuePLReport` ×2 · `getSalesComparisonReport` · `getDailyPaymentSummary` · `getEntityProfitReport` ข้อแรก) — `Expected: 2026-10-31T17:00:00.000Z / Received: 2026-11-01T00:00:00.000Z` (เทสต์ Decimal ข้อสุดท้ายผ่านอยู่แล้ว)

- [ ] **Step 3: แก้โค้ด**

`apps/api/src/modules/reports/services/revenue-report.service.ts` — เพิ่ม import ใต้ `import { PrismaService } from '../../../prisma/prisma.service';`:

```ts
import { reportDayEnd, reportDayStart } from '../../../utils/date.util';
```

จุดที่ 1 · `getRevenuePLReport` (:18-20) — ก่อน:

```ts
    const start = new Date(startDate);
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);
    const branchFilter = branchId ? { branchId } : {};

    const [interestIncomePayments, lateFeeIncome, totalPayments, newContracts] = await Promise.all([
```

หลัง:

```ts
    const start = reportDayStart(startDate);
    const end = reportDayEnd(endDate);
    const branchFilter = branchId ? { branchId } : {};

    const [interestIncomePayments, lateFeeIncome, totalPayments, newContracts] = await Promise.all([
```

จุดที่ 2 · `getSalesComparisonReport` (:85-87) — ก่อน:

```ts
    const safeLimit = Math.min(limit, 100);
    const start = new Date(startDate);
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);
    const branchFilter = branchId ? { branchId } : {};

    const contracts = await this.prisma.contract.findMany({
```

หลัง:

```ts
    const safeLimit = Math.min(limit, 100);
    const start = reportDayStart(startDate);
    const end = reportDayEnd(endDate);
    const branchFilter = branchId ? { branchId } : {};

    const contracts = await this.prisma.contract.findMany({
```

จุดที่ 3 · `getDailyPaymentSummary` (:133-134) — ก่อน:

```ts
    const start = new Date(date);
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    const branchFilter = branchId ? { contract: { branchId } } : {};
```

หลัง:

```ts
    const start = reportDayStart(date);
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000); // ไทยไม่มี DST — 00:00 ของวันถัดไป
    const branchFilter = branchId ? { contract: { branchId } } : {};
```

> ทำไมไม่ใช้ `bangkokDateRange(date, date)`: ถ้า client ไม่ส่ง `date` มันคืน `{}` ⇒ `paidDate: {}` = ไม่กรองวัน (ดึงทุกใบ) ขณะที่โค้ดเดิมได้ Invalid Date · `reportDayStart` คงพฤติกรรมเดิมของค่าที่ไม่ใช่ `YYYY-MM-DD` (หน้าต่าง 24 ชม. จากเวลานั้น) และได้ `[00:00, 00:00 วันถัดไป)` สำหรับ `YYYY-MM-DD`

จุดที่ 4 · `getEntityProfitReport` (:213-215) — ก่อน:

```ts
    const start = new Date(startDate);
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);

    const where: Record<string, unknown> = {
      deletedAt: null,
      createdAt: { gte: start, lte: end },
    };
```

หลัง:

```ts
    const start = reportDayStart(startDate);
    const end = reportDayEnd(endDate);

    const where: Record<string, unknown> = {
      deletedAt: null,
      createdAt: { gte: start, lte: end },
    };
```

- [ ] **Step 4: รันให้ผ่าน**

```bash
cd "/d/BESTCHOICE APP/BESTCHOICE/apps/api" && NODE_OPTIONS=--max-old-space-size=8192 npx jest src/modules/reports/reports.date-bounds.spec.ts src/modules/reports/reports.aggregations.spec.ts
TZ=UTC NODE_OPTIONS=--max-old-space-size=8192 npx jest src/modules/reports/reports.date-bounds.spec.ts
```

Expected: PASS ทั้งสองไฟล์ (เทสต์เดิมใน `reports.aggregations.spec.ts` ไม่ได้ปักค่าขอบวัน ⇒ ต้องไม่แดง) · รันซ้ำด้วย `TZ=UTC` ผ่านเหมือนกัน

- [ ] **Step 5: Commit**

```bash
cd "/d/BESTCHOICE APP/BESTCHOICE"
git add apps/api/src/modules/reports/services/revenue-report.service.ts apps/api/src/modules/reports/reports.date-bounds.spec.ts
git commit -m "รายงานรายได้ (revenue-pl / sales-comparison / daily-payments / entity-profit) นับวันเต็มตามเวลาไทย

เดิมวันเริ่ม = 07:00 น. (new Date('YYYY-MM-DD')) ⇒ ใบรับเงินผ่านเกตเวย์/สัญญาที่ลง 00:00–06:59 น. ของวันที่ 1 หาย ·
รายงานรายวันนับ 07:00→07:00 ⇒ แก้เป็น 00:00→00:00 ตามปฏิทินไทย

Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>"
```

---

### Task 2: รายงานฝั่งปฏิบัติการ — `branch-comparison` · `export/contracts`

**Files:**
- Modify: `apps/api/src/modules/reports/services/operational-report.service.ts` (`getBranchComparisonReport` :19-21 · `exportContracts` :139-146)
- Test: `apps/api/src/modules/reports/reports.date-bounds.spec.ts` (เพิ่มต่อท้าย — mock ตามเทสต์ `getBranchComparisonReport` ใน `reports.aggregations.spec.ts`)

**Interfaces:**
- Consumes: `reportDayStart` · `reportDayEnd`; ค่าคงที่/ฟังก์ชันช่วย `START` `END` `AT_START_MIDNIGHT` `AT_NEXT_DAY_MIDNIGHT` `Range` `contains` `svcWith` ที่ประกาศไว้ใน spec ของ Task 1
- Produces: ไม่มี

- [ ] **Step 1: เขียนเทสต์ที่ต้องล้ม**

ต่อท้าย `reports.date-bounds.spec.ts`:

```ts
describe('getBranchComparisonReport — ขอบวันตามเวลาไทย', () => {
  it('ส่ง createdAt ของสัญญาใหม่ และ paidDate ของยอดรับ เป็นช่วงเวลาไทย', async () => {
    const contractGroupBy = jest.fn().mockResolvedValue([]);
    const paymentGroupBy = jest.fn().mockResolvedValue([]);
    const svc = svcWith({
      branch: { findMany: jest.fn().mockResolvedValue([{ id: 'b1', name: 'สาขา A' }]) },
      contract: { groupBy: contractGroupBy, findMany: jest.fn().mockResolvedValue([]) },
      payment: { groupBy: paymentGroupBy },
      product: { groupBy: jest.fn().mockResolvedValue([]) },
    });

    await svc.getBranchComparisonReport('2026-11-01', '2026-11-17');

    // contract.groupBy ครั้งแรก = newByBranch
    expect(contractGroupBy.mock.calls[0][0].where.createdAt).toEqual({ gte: START, lte: END });
    expect(paymentGroupBy.mock.calls[0][0].where.paidDate).toEqual({ gte: START, lte: END });
    const range = contractGroupBy.mock.calls[0][0].where.createdAt as Range;
    expect(contains(range, AT_START_MIDNIGHT)).toBe(true);
    expect(contains(range, AT_NEXT_DAY_MIDNIGHT)).toBe(false);
  });
});

describe('exportContracts — ขอบวันตามเวลาไทย (latent: เว็บยังไม่ส่งวันที่)', () => {
  it('startDate/endDate แบบ YYYY-MM-DD → createdAt [00:00, 23:59:59.999] เวลาไทย', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const svc = svcWith({ contract: { findMany } });

    await svc.exportContracts({ startDate: '2026-11-01', endDate: '2026-11-17' });

    const range = findMany.mock.calls[0][0].where.createdAt as Range;
    expect(range).toEqual({ gte: START, lte: END });
    expect(contains(range, AT_START_MIDNIGHT)).toBe(true);
    expect(contains(range, AT_NEXT_DAY_MIDNIGHT)).toBe(false);
  });

  it('ส่งแค่ startDate → ไม่มีขอบบน · ไม่ส่งวันที่เลย → ไม่มีตัวกรอง createdAt', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const svc = svcWith({ contract: { findMany } });

    await svc.exportContracts({ startDate: '2026-11-01' });
    expect(findMany.mock.calls[0][0].where.createdAt).toEqual({ gte: START });

    await svc.exportContracts({});
    expect(findMany.mock.calls[1][0].where.createdAt).toBeUndefined();
  });
});
```

- [ ] **Step 2: รันให้เห็นว่าล้ม**

```bash
cd "/d/BESTCHOICE APP/BESTCHOICE/apps/api" && NODE_OPTIONS=--max-old-space-size=8192 npx jest src/modules/reports/reports.date-bounds.spec.ts -t "getBranchComparisonReport|exportContracts"
```

Expected: FAIL 3 เทสต์ใหม่ (`Received: 2026-11-01T00:00:00.000Z`) — เทสต์ "ไม่ส่งวันที่เลย" อยู่ข้อเดียวกับ `startDate` จึงล้มที่ expect แรก

- [ ] **Step 3: แก้โค้ด**

`apps/api/src/modules/reports/services/operational-report.service.ts` — เพิ่ม import ใต้ `import { PrismaService } from '../../../prisma/prisma.service';`:

```ts
import { reportDayEnd, reportDayStart } from '../../../utils/date.util';
```

จุดที่ 1 · `getBranchComparisonReport` (:19-21) — ก่อน:

```ts
    const start = new Date(startDate);
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);

    const branches = await this.prisma.branch.findMany({
```

หลัง:

```ts
    const start = reportDayStart(startDate);
    const end = reportDayEnd(endDate);

    const branches = await this.prisma.branch.findMany({
```

จุดที่ 2 · `exportContracts` (:139-146) — ก่อน:

```ts
    if (filters.startDate || filters.endDate) {
      where.createdAt = {};
      if (filters.startDate) (where.createdAt as Record<string, unknown>).gte = new Date(filters.startDate);
      if (filters.endDate) {
        const end = new Date(filters.endDate);
        end.setHours(23, 59, 59, 999);
        (where.createdAt as Record<string, unknown>).lte = end;
      }
    }
```

หลัง:

```ts
    if (filters.startDate || filters.endDate) {
      where.createdAt = {};
      if (filters.startDate) (where.createdAt as Record<string, unknown>).gte = reportDayStart(filters.startDate);
      if (filters.endDate) (where.createdAt as Record<string, unknown>).lte = reportDayEnd(filters.endDate);
    }
```

- [ ] **Step 4: รันให้ผ่าน**

```bash
cd "/d/BESTCHOICE APP/BESTCHOICE/apps/api" && NODE_OPTIONS=--max-old-space-size=8192 npx jest src/modules/reports
TZ=UTC NODE_OPTIONS=--max-old-space-size=8192 npx jest src/modules/reports/reports.date-bounds.spec.ts
```

Expected: PASS ทุกไฟล์ใน `src/modules/reports` (ส่วน quarterly ของ `reports.aggregations.spec.ts` ยังไม่ถูกแตะจนถึง Task 3 ⇒ ยังผ่านด้วยเหตุผลเดิม)

- [ ] **Step 5: Commit**

```bash
cd "/d/BESTCHOICE APP/BESTCHOICE"
git add apps/api/src/modules/reports/services/operational-report.service.ts apps/api/src/modules/reports/reports.date-bounds.spec.ts
git commit -m "รายงานเทียบสาขา + ส่งออกสัญญา นับวันเต็มตามเวลาไทย

Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>"
```

---
### Task 3: `/reports/quarterly` เสียวันสุดท้ายของไตรมาส + `/reports/balance-sheet` ค่าตั้งต้นเป็นเมื่อวาน

**Files:**
- Modify: `apps/api/src/modules/reports/reports.service.ts` (`getQuarterlyReport` :200)
- Modify: `apps/api/src/modules/reports/reports.controller.ts` (`getBalanceSheet` :123)
- Modify (แก้เทสต์ที่เคยปักบั๊ก): `apps/api/src/modules/reports/reports.aggregations.spec.ts` (`describe('getQuarterlyReport')` + หัวคอมเมนต์ไฟล์)
- Create/Test: `apps/api/src/modules/reports/reports.controller.balance-sheet.spec.ts` (ไม่มี spec ของ controller นี้ให้เลียน ⇒ ปั้นมือแบบ `accounting/accounting.controller.report-dates.spec.ts`)

**Interfaces:**
- Consumes: `daysInMonth(year: number, month: number): number` (`month` = ดัชนี 0–11) · `bangkokDateString(now?: Date): string` (`apps/api/src/utils/date.util.ts`)
- Produces: ไม่มี

เหตุ (เปิดโค้ดยืนยันแล้ว):
- `getQuarterlyReport`: `new Date(year, endMonth, 0).toISOString().split('T')[0]` — `new Date(2026, 3, 0)` คือ 31 มี.ค. 00:00 น. **เวลาไทย** = `2026-03-30T17:00:00Z` ⇒ ได้ `'2026-03-30'` ⇒ P&L ของไตรมาสสิ้นสุด 30 มี.ค. 23:59:59.999 ⇒ **ยอดวันที่ 31 มี.ค. / 30 มิ.ย. / 30 ก.ย. / 31 ธ.ค. ทั้งวันหาย** (ไม่มีหน้าเว็บเรียก `/reports/quarterly` แต่ API เปิดอยู่)
- `getBalanceSheet`: `new Date().toISOString().split('T')[0]` = วันที่ UTC ⇒ ระหว่าง 00:00–06:59 น. ไทย ได้ "เมื่อวาน" (ส่ง `asOfDate` มาเองไม่กระทบ) · การนับ "ณ สิ้นวัน" ของ `getBalanceSheet` ใน `transactional-report.service.ts:589` เป็นงานของแผน A

- [ ] **Step 1: เขียนเทสต์ที่ต้องล้ม**

(ก) แก้ `reports.aggregations.spec.ts` — สองจุด

1) หัวคอมเมนต์ของไฟล์ (บรรทัดใน docblock ต้นไฟล์) ก่อน:

```ts
 *   - getQuarterlyReport       (926-941) quarter -> date window + BadRequest guard
 *       (NOTE: endDate is TZ-shifted one day under UTC+7 — pinned as a quirk below)
```

หลัง:

```ts
 *   - getQuarterlyReport       (926-941) quarter -> date window + BadRequest guard
 *       (endDate = วันสุดท้ายของไตรมาสแบบสตริงล้วน — แก้ 2026-11-18 ให้ไม่ขึ้นกับ TZ)
```

2) แทนที่บล็อก `describe('getQuarterlyReport', …)` ทั้งบล็อก (ตั้งแต่บรรทัด `  describe('getQuarterlyReport', () => {` จนถึงท้ายไฟล์ — **รวม `});` สุดท้ายที่ปิด `describe('ReportsService aggregations …')` ชั้นนอก** ซึ่งบล็อกด้านล่างมีให้ครบแล้ว) ด้วย:

```ts
  describe('getQuarterlyReport', () => {
    function make() {
      const getProfitLossReport = jest.fn().mockResolvedValue({ ok: true });
      const accounting = { getProfitLossReport } as unknown as AccountingService;
      const svc = new ReportsService({} as PrismaService, accounting);
      return { svc, getProfitLossReport };
    }

    // endDate = วันสุดท้ายของไตรมาสตามปฏิทิน เขียนเป็นสตริงตรง ๆ ไม่ผ่าน Date → toISOString จึงเท่ากันทุก TZ ของเครื่องรันเทสต์
    // (2026-11-18: เดิมสูตร `new Date(year, endMonth, 0).toISOString()` ได้ "วันก่อนหน้า" บนเครื่องเวลาไทย — Q1 → 03-30 —
    //  และเทสต์ชุดนี้เคยคำนวณค่าคาดหวังด้วยสูตรเดียวกัน จึงปักบั๊กไว้แทนที่จะจับมัน)
    it.each([
      [1, '2026-01-01', '2026-03-31'],
      [2, '2026-04-01', '2026-06-30'],
      [3, '2026-07-01', '2026-09-30'],
      [4, '2026-10-01', '2026-12-31'],
    ])('Q%i 2026 -> start %s, end = วันสุดท้ายของไตรมาส %s', async (quarter, start, end) => {
      const { svc, getProfitLossReport } = make();
      await svc.getQuarterlyReport(2026, quarter);
      const [s, e] = getProfitLossReport.mock.calls[0];
      expect(s).toBe(start);
      expect(e).toBe(end);
    });

    it('delegates branch args + includeFinanceExpenses through to AccountingService', async () => {
      const { svc, getProfitLossReport } = make();
      await svc.getQuarterlyReport(2026, 2, 'branch-3', ['branch-3', 'branch-4'], true);
      expect(getProfitLossReport).toHaveBeenCalledWith(
        '2026-04-01',
        '2026-06-30',
        'branch-3',
        ['branch-3', 'branch-4'],
        true,
      );
    });

    it('quarter 0 -> BadRequestException (no delegation)', async () => {
      const { svc, getProfitLossReport } = make();
      await expect(svc.getQuarterlyReport(2026, 0)).rejects.toBeInstanceOf(BadRequestException);
      expect(getProfitLossReport).not.toHaveBeenCalled();
    });

    it('quarter 5 -> BadRequestException', async () => {
      const { svc } = make();
      await expect(svc.getQuarterlyReport(2026, 5)).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
```

(ข) สร้าง `apps/api/src/modules/reports/reports.controller.balance-sheet.spec.ts`:

```ts
import { ReportsController } from './reports.controller';

/**
 * GET /reports/balance-sheet — ไม่ส่ง asOfDate ⇒ ใช้ "วันนี้ตามเวลาไทย" (2026-11-18)
 * เดิม new Date().toISOString().split('T')[0] = วันที่ UTC ⇒ 00:00–06:59 น. ไทยได้ "เมื่อวาน"
 * ปั้น service ด้วยมือแบบ accounting.controller.report-dates.spec.ts · จำลองเวลาเฉพาะ Date
 */
const FAKE_DATE_ONLY = [
  'nextTick', 'setImmediate', 'setTimeout', 'setInterval', 'clearTimeout',
  'clearInterval', 'clearImmediate', 'queueMicrotask', 'hrtime', 'performance',
] as const;

describe('ReportsController.getBalanceSheet — ค่าตั้งต้น asOfDate', () => {
  const reportsService = {
    resolveCompanyBranches: jest.fn().mockResolvedValue(undefined),
    getBalanceSheet: jest.fn().mockResolvedValue({}),
  };
  const controller = new ReportsController(reportsService as never);

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it('03:30 น. ไทยของวันที่ 18 พ.ย. (= 20:30Z ของวันที่ 17) → งบ ณ 2026-11-18', async () => {
    jest.useFakeTimers({ now: new Date('2026-11-17T20:30:00.000Z'), doNotFake: [...FAKE_DATE_ONLY] });
    await controller.getBalanceSheet(undefined);
    expect(reportsService.getBalanceSheet).toHaveBeenCalledWith('2026-11-18', undefined, undefined);
  });

  it('23:30 น. ไทยของวันที่ 17 พ.ย. (= 16:30Z วันเดียวกัน) → งบ ณ 2026-11-17', async () => {
    jest.useFakeTimers({ now: new Date('2026-11-17T16:30:00.000Z'), doNotFake: [...FAKE_DATE_ONLY] });
    await controller.getBalanceSheet(undefined);
    expect(reportsService.getBalanceSheet).toHaveBeenCalledWith('2026-11-17', undefined, undefined);
  });

  it('ส่ง asOfDate มาเอง → ใช้ค่านั้นตามเดิม', async () => {
    await controller.getBalanceSheet('2026-10-31');
    expect(reportsService.getBalanceSheet).toHaveBeenCalledWith('2026-10-31', undefined, undefined);
  });
});
```

- [ ] **Step 2: รันให้เห็นว่าล้ม**

```bash
cd "/d/BESTCHOICE APP/BESTCHOICE/apps/api" && NODE_OPTIONS=--max-old-space-size=8192 npx jest src/modules/reports/reports.aggregations.spec.ts src/modules/reports/reports.controller.balance-sheet.spec.ts
```

Expected: FAIL — `Q1 2026 … Expected: "2026-03-31" / Received: "2026-03-30"` (และ Q2/Q3/Q4 กับ `delegates…` เช่นกัน) · `getBalanceSheet … Expected: "2026-11-18" / Received: "2026-11-17"` (เครื่องเวลาไทย) — ถ้ารันด้วย `TZ=UTC` เทสต์ quarterly จะผ่านอยู่แล้ว (นี่คือเหตุที่บั๊กไม่เคยถูกจับใน CI)

- [ ] **Step 3: แก้โค้ด**

`apps/api/src/modules/reports/reports.service.ts` — เพิ่ม import (ต่อจาก import อื่นด้านบนไฟล์ — ตรวจแล้วไม่มี import จาก `date.util` อยู่):

```ts
import { daysInMonth } from '../../utils/date.util';
```

`getQuarterlyReport` (:196-201) — ก่อน:

```ts
    const startMonth = (quarter - 1) * 3 + 1;
    const endMonth = startMonth + 2;
    const startDate = `${year}-${String(startMonth).padStart(2, '0')}-01`;
    const endDate = new Date(year, endMonth, 0).toISOString().split('T')[0];
    return this.accounting.getProfitLossReport(startDate, endDate, branchId, branchIds, includeFinanceExpenses);
```

หลัง:

```ts
    const startMonth = (quarter - 1) * 3 + 1;
    const endMonth = startMonth + 2;
    const startDate = `${year}-${String(startMonth).padStart(2, '0')}-01`;
    // วันสุดท้ายของเดือนสุดท้ายในไตรมาส — สตริงล้วน ไม่ผ่าน Date.toISOString (ซึ่งเลื่อนเป็น "วันก่อนหน้า" บนเวลาไทย)
    const endDate = `${year}-${String(endMonth).padStart(2, '0')}-${String(daysInMonth(year, endMonth - 1)).padStart(2, '0')}`;
    return this.accounting.getProfitLossReport(startDate, endDate, branchId, branchIds, includeFinanceExpenses);
```

(`daysInMonth(year, endMonth - 1)` รับดัชนีเดือน 0–11 ⇒ Q1: `daysInMonth(2026, 2)` = 31)

`apps/api/src/modules/reports/reports.controller.ts` — เพิ่ม import ใต้ `import { CurrentUser } …`:

```ts
import { bangkokDateString } from '../../utils/date.util';
```

`getBalanceSheet` (:121-125) — ก่อน:

```ts
    return this.reportsService.getBalanceSheet(
      asOfDate || new Date().toISOString().split('T')[0],
      undefined,
      resolvedBranchIds,
    );
```

หลัง:

```ts
    return this.reportsService.getBalanceSheet(
      asOfDate || bangkokDateString(),
      undefined,
      resolvedBranchIds,
    );
```

- [ ] **Step 4: รันให้ผ่าน**

```bash
cd "/d/BESTCHOICE APP/BESTCHOICE/apps/api" && NODE_OPTIONS=--max-old-space-size=8192 npx jest src/modules/reports
TZ=UTC NODE_OPTIONS=--max-old-space-size=8192 npx jest src/modules/reports/reports.aggregations.spec.ts src/modules/reports/reports.controller.balance-sheet.spec.ts
```

Expected: PASS ทุกไฟล์ใน `src/modules/reports` · `TZ=UTC` ผ่านเหมือนกัน (ค่าคาดหวังเป็นสตริง/ISO ตายตัว)

- [ ] **Step 5: Commit**

```bash
cd "/d/BESTCHOICE APP/BESTCHOICE"
git add apps/api/src/modules/reports/reports.service.ts apps/api/src/modules/reports/reports.controller.ts apps/api/src/modules/reports/reports.aggregations.spec.ts apps/api/src/modules/reports/reports.controller.balance-sheet.spec.ts
git commit -m "รายงานรายไตรมาสได้วันสุดท้ายของไตรมาสถูกวัน + งบดุลค่าตั้งต้นเป็นวันนี้ตามเวลาไทย

เดิม /reports/quarterly ได้ endDate เป็นวันก่อนหน้า (Q1 → 03-30) ⇒ ยอดวัน 31 มี.ค./30 มิ.ย./30 ก.ย./31 ธ.ค. หาย ·
เทสต์เดิมคำนวณค่าคาดหวังด้วยสูตรเดียวกับโค้ดจึงไม่เคยจับได้ ⇒ เปลี่ยนเป็นค่าตายตัว ·
/reports/balance-sheet ไม่ส่ง asOfDate ได้ 'เมื่อวาน' ช่วง 00:00–06:59 น.

Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>"
```

---

### Task 4: รายงานสรุปรายวัน/รายสัปดาห์ที่ cron สร้าง — ป้ายวันเลื่อนไปหนึ่งวัน (+ แก้ UNSURE `generateWeeklySummary`)

**Files:**
- Modify: `apps/api/src/modules/reports/report-generator.service.ts` (`generateDailySummary` :31-34 · `generateWeeklySummary` :90-111)
- Create/Test: `apps/api/src/modules/reports/report-generator.service.spec.ts` (ไม่มี spec ของ service นี้ ⇒ ปั้นมือแบบ `reports.aggregations.spec.ts`)

**Interfaces:**
- Consumes: `bangkokStartOfDay(now?: Date): Date` · `addBkkDays(date: Date, days: number): Date` · `bangkokDateString(now?: Date): string`
- Produces: ไม่มี

เหตุ (เปิดโค้ดยืนยันแล้ว):
- cron `55 23 * * *` (Asia/Bangkok) เรียก `generateDailySummary()` ตอน 23:55 น. ของวัน D · `startOfDay.toISOString().slice(0,10)` = วันที่ UTC ของเที่ยงคืนไทย = **D-1** ⇒ เก็บเป็น `daily_report_<D-1>` และ `summary.date = D-1` · หน้าต่างกรอง `[00:00, 00:00 วันถัดไป)` ถูกต้องอยู่แล้วเมื่อโปรเซสเป็นเวลาไทย (`Dockerfile` ตั้ง `ENV TZ=Asia/Bangkok` · `deploy-gcp.yml:661`) — ตั้งแต่แผนนี้ไม่ขึ้นกับ TZ แล้ว
- **UNSURE `generateWeeklySummary` (:90) — ตัดสินแล้ว = BUG ที่ต้องแก้พร้อมกับรายวัน**: cron จันทร์ 00:05 น. · มันอ่าน key `daily_report_<UTC date ของเที่ยงคืนไทยของ (จันทร์-7 .. จันทร์-1)>` = `จันทร์-8 .. จันทร์-2` ซึ่ง "บังเอิญ" ตรงกับป้ายที่เลื่อนของรายวันจึงได้ข้อมูลของวัน จันทร์-7..จันทร์-1 ถูก · แต่ป้ายสรุป `weekStart` (= จันทร์-8) ผิดหนึ่งวัน และ key `weekly_report_<weekStart>` ผิดตาม · เมื่อแก้ป้ายรายวันให้เป็นวันจริง ถ้าไม่แก้รายสัปดาห์ด้วยมันจะอ่านผิดวันทั้งหมด ⇒ แก้ในงานเดียวกัน · `weekEnd` เดิมแสดง "อาทิตย์ที่แล้ว" (จันทร์-1) ซึ่งเป็นวันสุดท้ายที่รวมจริง ⇒ คงค่าเดิมไว้
- ไม่มีใครอ่าน `daily_report_*` / `weekly_report_*` ในโค้ด (grep ทั้ง `apps/`) ⇒ ไม่มีหน้าจอที่ต้องแก้ · ข้อมูลที่เก็บก่อน deploy ป้ายเลื่อนอยู่ (forward-only ไม่ย้าย key) ⇒ สัปดาห์ที่คร่อมวัน deploy สรุปรายสัปดาห์จะขาด/เหลื่อมหนึ่งวัน (ดูหัวข้อ ผลต่อผู้ใช้)
- `getLatestDailyReport` (:130) ใช้ `new Date().toISOString().slice(0,10)` แต่ **ไม่มีผู้เรียก** ⇒ ไม่แก้ (บันทึกไว้ใน "ตรวจแล้วไม่ต้องแก้")
- หน้าต่างวัน `new Date(d.getFullYear(), d.getMonth(), d.getDate())` เป็นแถว "ถูกเพราะ TZ ของโปรเซส" ที่ swap แล้วผลเหมือนเดิมบนเวลาไทยทุกกรณี (`bangkokStartOfDay(d)` = เที่ยงคืนไทยของวันที่ `d` อยู่) ⇒ รวมในงานนี้เพราะแก้บรรทัดติดกัน

- [ ] **Step 1: เขียนเทสต์ที่ต้องล้ม**

สร้าง `apps/api/src/modules/reports/report-generator.service.spec.ts`:

```ts
import { Prisma } from '@prisma/client';
import { ReportGeneratorService } from './report-generator.service';

/**
 * รายงานสรุปที่ cron สร้าง (2026-11-18): ป้ายวันต้องเป็นวันตามปฏิทินไทยที่ cron รัน ไม่ใช่วันที่ UTC ของเที่ยงคืนไทย
 * เดิม cron 23:55 น. ของวันที่ 18 เก็บเป็น daily_report_2026-11-17
 * ปั้น prisma ด้วยมือแบบ reports.aggregations.spec.ts · จำลองเวลาเฉพาะ Date
 */
const FAKE_DATE_ONLY = [
  'nextTick', 'setImmediate', 'setTimeout', 'setInterval', 'clearTimeout',
  'clearInterval', 'clearImmediate', 'queueMicrotask', 'hrtime', 'performance',
] as const;

function make() {
  const prisma = {
    payment: {
      aggregate: jest.fn().mockResolvedValue({ _sum: { amountPaid: new Prisma.Decimal('1234.40') }, _count: 2 }),
      count: jest.fn().mockResolvedValue(3),
    },
    contract: { count: jest.fn().mockResolvedValue(1) },
    customer: { count: jest.fn().mockResolvedValue(4) },
    systemConfig: {
      upsert: jest.fn().mockResolvedValue({}),
      findUnique: jest.fn().mockImplementation(({ where }: { where: { key: string } }) =>
        Promise.resolve({
          key: where.key,
          value: JSON.stringify({ date: where.key.replace('daily_report_', ''), revenue: 100, paymentsCount: 1 }),
        }),
      ),
    },
  };
  return { prisma, svc: new ReportGeneratorService(prisma as never, {} as never) };
}

describe('ReportGeneratorService.generateDailySummary — ป้ายวัน + หน้าต่างวันตามเวลาไทย', () => {
  it('cron 23:55 น. ของวันที่ 18 → key/summary.date = 2026-11-18 และหน้าต่าง [00:00 วันที่ 18, 00:00 วันที่ 19)', async () => {
    const { prisma, svc } = make();

    const summary = await svc.generateDailySummary(new Date('2026-11-18T16:55:00.000Z'));

    expect(summary.date).toBe('2026-11-18');
    expect(prisma.systemConfig.upsert.mock.calls[0][0].where.key).toBe('daily_report_2026-11-18');
    const window = {
      gte: new Date('2026-11-17T17:00:00.000Z'),
      lt: new Date('2026-11-18T17:00:00.000Z'),
    };
    expect(prisma.payment.aggregate.mock.calls[0][0].where.paidDate).toEqual(window);
    expect(prisma.contract.count.mock.calls[0][0].where.createdAt).toEqual(window);
    expect(prisma.customer.count.mock.calls[0][0].where.createdAt).toEqual(window);
    expect(prisma.payment.count.mock.calls[0][0].where.dueDate).toEqual({ lt: window.gte });
  });

  it('รันหลังเที่ยงคืน (01:05 น. ของวันที่ 18) → ยังเป็นวันที่ 18 ตามปฏิทินไทย', async () => {
    const { prisma, svc } = make();

    const summary = await svc.generateDailySummary(new Date('2026-11-17T18:05:00.000Z'));

    expect(summary.date).toBe('2026-11-18');
    expect(prisma.systemConfig.upsert.mock.calls[0][0].where.key).toBe('daily_report_2026-11-18');
  });
});

describe('ReportGeneratorService.generateWeeklySummary — รวมวันจันทร์..อาทิตย์ที่แล้ว ตามป้ายวันจริง', () => {
  afterEach(() => jest.useRealTimers());

  it('จันทร์ 23 พ.ย. 00:05 น. → อ่าน daily_report_2026-11-16 .. 2026-11-22 · weekStart 2026-11-16 · weekEnd 2026-11-22', async () => {
    jest.useFakeTimers({ now: new Date('2026-11-22T17:05:00.000Z'), doNotFake: [...FAKE_DATE_ONLY] });
    const { prisma, svc } = make();

    const summary = await svc.generateWeeklySummary();

    expect(prisma.systemConfig.findUnique.mock.calls.map((c: [{ where: { key: string } }]) => c[0].where.key)).toEqual([
      'daily_report_2026-11-16',
      'daily_report_2026-11-17',
      'daily_report_2026-11-18',
      'daily_report_2026-11-19',
      'daily_report_2026-11-20',
      'daily_report_2026-11-21',
      'daily_report_2026-11-22',
    ]);
    expect(summary.weekStart).toBe('2026-11-16');
    expect(summary.weekEnd).toBe('2026-11-22');
    expect(summary.totalRevenue).toBe(700);
    expect(prisma.systemConfig.upsert.mock.calls[0][0].where.key).toBe('weekly_report_2026-11-16');
  });
});
```

- [ ] **Step 2: รันให้เห็นว่าล้ม**

```bash
cd "/d/BESTCHOICE APP/BESTCHOICE/apps/api" && NODE_OPTIONS=--max-old-space-size=8192 npx jest src/modules/reports/report-generator.service.spec.ts
```

Expected: FAIL 3 เทสต์ — `Expected: "2026-11-18" / Received: "2026-11-17"` (รายวัน) · `daily_report_2026-11-15 …` แทน `…-16` (รายสัปดาห์) · รันด้วย `TZ=UTC` เทสต์รายวันล้มที่ `window` (`2026-11-18T00:00:00.000Z` แทน `…-17T17:00:00.000Z`)

- [ ] **Step 3: แก้โค้ด**

`apps/api/src/modules/reports/report-generator.service.ts` — เพิ่ม import ใต้ `import { ReportsService } from './reports.service';`:

```ts
import { addBkkDays, bangkokDateString, bangkokStartOfDay } from '../../utils/date.util';
```

`generateDailySummary` (:31-34) — ก่อน:

```ts
    const d = date || new Date();
    const startOfDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const endOfDay = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
    const dateStr = startOfDay.toISOString().slice(0, 10);
```

หลัง:

```ts
    const d = date || new Date();
    const startOfDay = bangkokStartOfDay(d);
    const endOfDay = addBkkDays(startOfDay, 1);
    const dateStr = bangkokDateString(d);
```

`generateWeeklySummary` (:90-100) — ก่อน:

```ts
    const now = new Date();
    const weekEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekStart = new Date(weekEnd);
    weekStart.setDate(weekStart.getDate() - 7);

    const dailySummaries: Record<string, unknown>[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(weekStart);
      d.setDate(d.getDate() + i);
      const dateStr = d.toISOString().slice(0, 10);
      const key = `daily_report_${dateStr}`;
```

หลัง:

```ts
    const weekEnd = bangkokStartOfDay(new Date());
    const weekStart = addBkkDays(weekEnd, -7);

    const dailySummaries: Record<string, unknown>[] = [];
    for (let i = 0; i < 7; i++) {
      const dateStr = bangkokDateString(addBkkDays(weekStart, i));
      const key = `daily_report_${dateStr}`;
```

`generateWeeklySummary` (:109-112) — ก่อน:

```ts
    const summary = {
      weekStart: weekStart.toISOString().slice(0, 10),
      weekEnd: weekEnd.toISOString().slice(0, 10),
```

หลัง:

```ts
    const summary = {
      weekStart: bangkokDateString(weekStart),
      // วันสุดท้ายที่รวมจริง (อาทิตย์) — ค่าเดิมก็เป็นวันนี้ จึงไม่เปลี่ยน
      weekEnd: bangkokDateString(addBkkDays(weekEnd, -1)),
```

- [ ] **Step 4: รันให้ผ่าน**

```bash
cd "/d/BESTCHOICE APP/BESTCHOICE/apps/api" && NODE_OPTIONS=--max-old-space-size=8192 npx jest src/modules/reports/report-generator.service.spec.ts
TZ=UTC NODE_OPTIONS=--max-old-space-size=8192 npx jest src/modules/reports/report-generator.service.spec.ts
```

Expected: PASS 3 tests ทั้งสองการรัน

- [ ] **Step 5: Commit**

```bash
cd "/d/BESTCHOICE APP/BESTCHOICE"
git add apps/api/src/modules/reports/report-generator.service.ts apps/api/src/modules/reports/report-generator.service.spec.ts
git commit -m "รายงานสรุปรายวัน/รายสัปดาห์ที่ cron สร้าง: ป้ายวันเป็นวันจริงตามเวลาไทย

เดิม cron 23:55 น. วันที่ 18 เก็บเป็น daily_report_2026-11-17 (ใช้วันที่ UTC) · รายสัปดาห์แก้พร้อมกัน
(ไม่งั้นอ่านผิดวันเมื่อป้ายรายวันถูก) · หน้าต่างวันใช้ bangkokStartOfDay ผลเหมือนเดิมบนเวลาไทย

Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>"
```

---

### Task 5: รายการใบเสร็จ `GET /receipts?dateFrom&dateTo`

**Files:**
- Modify: `apps/api/src/modules/receipts/services/receipt-query.service.ts` (`findAll` :47-54)
- Create/Test: `apps/api/src/modules/receipts/services/receipt-query.service.date-bounds.spec.ts` (รูปแบบตาม `receipt-query.service.findall-cn.spec.ts` — `new ReceiptQueryService(prisma as never)`)

**Interfaces:**
- Consumes: `reportDayStart` · `reportDayEnd`
- Produces: ไม่มี

เหตุ: `Receipt.paidDate` — ใบที่ตัดผ่านเกตเวย์/นำเข้า CSV เป็นเวลาจริงทุกชั่วโมง (ใบจากวิซาร์ดพนักงานเป็น 07:00 พอดีจึงรอด) ⇒ ใบ 00:00–06:59 น. ของ `dateFrom` หาย · `where` ชุดเดียวกันถูกใช้กับ `findMany` / `count` / `aggregate` (ยอดรวมบนหัวตาราง) ⇒ แก้ที่เดียวถูกทั้งสามตัว (เปิดโค้ดยืนยัน)

- [ ] **Step 1: เขียนเทสต์ที่ต้องล้ม**

สร้าง `apps/api/src/modules/receipts/services/receipt-query.service.date-bounds.spec.ts`:

```ts
import { ReceiptQueryService } from './receipt-query.service';

/**
 * ReceiptQueryService.findAll — dateFrom/dateTo แบบ 'YYYY-MM-DD' = วันตามปฏิทินไทย (2026-11-18)
 * เดิม dateFrom = 07:00 น. ⇒ ใบเสร็จ 00:00–06:59 น. ของวันเริ่ม (เช่นเงินจากเกตเวย์) หายจากทั้งตารางและยอดรวม
 * รูปแบบ mock ตาม receipt-query.service.findall-cn.spec.ts
 */
describe('ReceiptQueryService.findAll — ขอบวันตามเวลาไทย', () => {
  let service: ReceiptQueryService;
  let prisma: {
    receipt: { findMany: jest.Mock; count: jest.Mock; aggregate: jest.Mock };
    notificationLog: { findMany: jest.Mock };
  };

  beforeEach(() => {
    prisma = {
      receipt: {
        findMany: jest.fn().mockResolvedValue([{ id: 'r1', cnSource: null, receiptType: 'PAYMENT' }]),
        count: jest.fn().mockResolvedValue(1),
        aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 0 }, _count: 0 }),
      },
      notificationLog: { findMany: jest.fn() },
    };
    service = new ReceiptQueryService(prisma as never);
  });

  const START = new Date('2026-10-31T17:00:00.000Z'); // 2026-11-01 00:00 น. ไทย
  const END = new Date('2026-11-17T16:59:59.999Z'); // 2026-11-17 23:59:59.999 น. ไทย

  it('paidDate = [00:00 dateFrom, 23:59:59.999 dateTo] ใน findMany / count / aggregate (ยอดรวมใช้ where เดียวกัน)', async () => {
    await service.findAll({ dateFrom: '2026-11-01', dateTo: '2026-11-17' });

    for (const call of [prisma.receipt.findMany, prisma.receipt.count, prisma.receipt.aggregate]) {
      expect(call.mock.calls[0][0].where.paidDate).toEqual({ gte: START, lte: END });
    }
  });

  it('ขอบ: ใบเที่ยงคืนไทยของ dateFrom อยู่ในช่วง · ใบเที่ยงคืนไทยของวันถัดจาก dateTo อยู่นอกช่วง', async () => {
    await service.findAll({ dateFrom: '2026-11-01', dateTo: '2026-11-17' });
    const { gte, lte } = prisma.receipt.findMany.mock.calls[0][0].where.paidDate as { gte: Date; lte: Date };
    const atFromMidnight = new Date('2026-11-01T00:00:00+07:00');
    const atNextDayMidnight = new Date('2026-11-18T00:00:00+07:00');
    expect(atFromMidnight >= gte && atFromMidnight <= lte).toBe(true);
    expect(atNextDayMidnight <= lte).toBe(false);
  });

  it('ส่งแค่ dateFrom → ไม่มีขอบบน', async () => {
    await service.findAll({ dateFrom: '2026-11-01' });
    expect(prisma.receipt.findMany.mock.calls[0][0].where.paidDate).toEqual({ gte: START });
  });
});
```

- [ ] **Step 2: รันให้เห็นว่าล้ม**

```bash
cd "/d/BESTCHOICE APP/BESTCHOICE/apps/api" && NODE_OPTIONS=--max-old-space-size=8192 npx jest src/modules/receipts/services/receipt-query.service.date-bounds.spec.ts
```

Expected: FAIL 3 เทสต์ — `Expected: 2026-10-31T17:00:00.000Z / Received: 2026-11-01T00:00:00.000Z`

- [ ] **Step 3: แก้โค้ด**

`apps/api/src/modules/receipts/services/receipt-query.service.ts` — เพิ่ม import ใต้ `import { Prisma } from '@prisma/client';`:

```ts
import { reportDayEnd, reportDayStart } from '../../../utils/date.util';
```

`findAll` (:45-55) — ก่อน:

```ts
    if (filters.dateFrom || filters.dateTo) {
      where.paidDate = {};
      if (filters.dateFrom) {
        where.paidDate.gte = new Date(filters.dateFrom);
      }
      if (filters.dateTo) {
        const endDate = new Date(filters.dateTo);
        endDate.setHours(23, 59, 59, 999);
        where.paidDate.lte = endDate;
      }
    }
```

หลัง:

```ts
    if (filters.dateFrom || filters.dateTo) {
      where.paidDate = {};
      if (filters.dateFrom) {
        where.paidDate.gte = reportDayStart(filters.dateFrom);
      }
      if (filters.dateTo) {
        where.paidDate.lte = reportDayEnd(filters.dateTo);
      }
    }
```

- [ ] **Step 4: รันให้ผ่าน**

```bash
cd "/d/BESTCHOICE APP/BESTCHOICE/apps/api" && NODE_OPTIONS=--max-old-space-size=8192 npx jest src/modules/receipts/services/receipt-query
TZ=UTC NODE_OPTIONS=--max-old-space-size=8192 npx jest src/modules/receipts/services/receipt-query.service.date-bounds.spec.ts
```

Expected: PASS (รวม `receipt-query.service.*.spec.ts` เดิมทั้งหมด)

- [ ] **Step 5: Commit**

```bash
cd "/d/BESTCHOICE APP/BESTCHOICE"
git add apps/api/src/modules/receipts/services/receipt-query.service.ts apps/api/src/modules/receipts/services/receipt-query.service.date-bounds.spec.ts
git commit -m "ใบเสร็จ: ตัวกรองวันที่ (dateFrom/dateTo) นับวันเต็มตามเวลาไทย

Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>"
```

---

### Task 6: ประวัติรับของเข้าของใบสั่งซื้อ — `goods-receivings` · `goods-receivings/summary`

**Files:**
- Modify: `apps/api/src/modules/purchase-orders/services/po-query.service.ts` (`getGoodsReceivings` :215-222 · `getReceivingSummary` :282-289)
- Create/Test: `apps/api/src/modules/purchase-orders/services/po-query.service.date-bounds.spec.ts` (mock ปั้นมือแบบ `purchase-orders.summary.spec.ts`; สร้าง `PoQueryService` ตรง ๆ)

**Interfaces:**
- Consumes: `reportDayStart` · `reportDayEnd`
- Produces: ไม่มี

เหตุ: latent — เว็บยังไม่ส่ง `startDate`/`endDate` ให้สองเส้นนี้ แต่ API รับ · `GoodsReceiving.createdAt` เป็น `@default(now())` (เปิด schema ยืนยัน)

- [ ] **Step 1: เขียนเทสต์ที่ต้องล้ม**

สร้าง `apps/api/src/modules/purchase-orders/services/po-query.service.date-bounds.spec.ts`:

```ts
import { PoQueryService } from './po-query.service';

/**
 * ประวัติรับของ/สรุปรับของของใบสั่งซื้อ — startDate/endDate 'YYYY-MM-DD' = วันตามปฏิทินไทย (2026-11-18)
 * รูปแบบ mock ตาม purchase-orders.summary.spec.ts (prisma ปั้นมือ)
 */
const START = new Date('2026-10-31T17:00:00.000Z');
const END = new Date('2026-11-17T16:59:59.999Z');

function make() {
  const prisma = {
    purchaseOrder: {
      findUnique: jest.fn().mockResolvedValue({ id: 'po-1', deletedAt: null, status: 'ORDERED', items: [] }),
    },
    goodsReceiving: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
    goodsReceivingItem: { findMany: jest.fn().mockResolvedValue([]) },
  };
  return { prisma, service: new PoQueryService(prisma as never) };
}

describe('PoQueryService.getGoodsReceivings — ขอบวันตามเวลาไทย', () => {
  it('createdAt = [00:00 startDate, 23:59:59.999 endDate]', async () => {
    const { prisma, service } = make();

    await service.getGoodsReceivings('po-1', { startDate: '2026-11-01', endDate: '2026-11-17' });

    const where = prisma.goodsReceiving.findMany.mock.calls[0][0].where;
    expect(where.createdAt).toEqual({ gte: START, lte: END });
    expect(prisma.goodsReceiving.count.mock.calls[0][0].where.createdAt).toEqual({ gte: START, lte: END });
    // ขอบ: เที่ยงคืนไทยของวันเริ่มอยู่ใน · เที่ยงคืนไทยของวันถัดจากวันสิ้นสุดอยู่นอก
    expect(new Date('2026-11-01T00:00:00+07:00') >= where.createdAt.gte).toBe(true);
    expect(new Date('2026-11-18T00:00:00+07:00') <= where.createdAt.lte).toBe(false);
  });
});

describe('PoQueryService.getReceivingSummary — ขอบวันตามเวลาไทย', () => {
  it('receiving.createdAt = [00:00 startDate, 23:59:59.999 endDate]', async () => {
    const { prisma, service } = make();

    await service.getReceivingSummary('po-1', { startDate: '2026-11-01', endDate: '2026-11-17' });

    const where = prisma.goodsReceivingItem.findMany.mock.calls[0][0].where;
    expect(where.receiving.createdAt).toEqual({ gte: START, lte: END });
  });

  it('ไม่ส่งวันที่ → ไม่มีตัวกรอง createdAt', async () => {
    const { prisma, service } = make();
    await service.getReceivingSummary('po-1', {});
    expect(prisma.goodsReceivingItem.findMany.mock.calls[0][0].where.receiving.createdAt).toBeUndefined();
  });
});
```

- [ ] **Step 2: รันให้เห็นว่าล้ม**

```bash
cd "/d/BESTCHOICE APP/BESTCHOICE/apps/api" && NODE_OPTIONS=--max-old-space-size=8192 npx jest src/modules/purchase-orders/services/po-query.service.date-bounds.spec.ts
```

Expected: FAIL 2 เทสต์ (`Received: 2026-11-01T00:00:00.000Z`) · เทสต์ "ไม่ส่งวันที่" ผ่านอยู่แล้ว

- [ ] **Step 3: แก้โค้ด**

`apps/api/src/modules/purchase-orders/services/po-query.service.ts` — เพิ่ม import ใต้ `import { d, dAdd, dSub, dSum } from '../../../utils/decimal.util';`:

```ts
import { reportDayEnd, reportDayStart } from '../../../utils/date.util';
```

สองจุด (`getGoodsReceivings` :215-222 และ `getReceivingSummary` :282-289 — ข้อความเหมือนกันทุกตัวอักษร แทนทั้งสองจุดด้วย `replace_all` ได้) — ก่อน:

```ts
      const dateFilter: Record<string, Date> = {};
      if (filters.startDate) dateFilter.gte = new Date(filters.startDate);
      if (filters.endDate) {
        const end = new Date(filters.endDate);
        end.setHours(23, 59, 59, 999);
        dateFilter.lte = end;
      }
```

หลัง:

```ts
      const dateFilter: Record<string, Date> = {};
      if (filters.startDate) dateFilter.gte = reportDayStart(filters.startDate);
      if (filters.endDate) dateFilter.lte = reportDayEnd(filters.endDate);
```

- [ ] **Step 4: รันให้ผ่าน**

```bash
cd "/d/BESTCHOICE APP/BESTCHOICE/apps/api" && NODE_OPTIONS=--max-old-space-size=8192 npx jest src/modules/purchase-orders/services/po-query.service.date-bounds.spec.ts src/modules/purchase-orders/purchase-orders.summary.spec.ts
TZ=UTC NODE_OPTIONS=--max-old-space-size=8192 npx jest src/modules/purchase-orders/services/po-query.service.date-bounds.spec.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd "/d/BESTCHOICE APP/BESTCHOICE"
git add apps/api/src/modules/purchase-orders/services/po-query.service.ts apps/api/src/modules/purchase-orders/services/po-query.service.date-bounds.spec.ts
git commit -m "ใบสั่งซื้อ: ประวัติ/สรุปรับของที่กรองด้วยวันที่ นับวันเต็มตามเวลาไทย

Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>"
```

---
### Task 7: ตัดสินค้า — `GET /stock-adjustments` · `GET /stock-adjustments/summary`

**Files:**
- Modify: `apps/api/src/modules/inventory/stock-adjustments.service.ts` (`findAll` :1181-1190 · `getSummary` :1283-1292)
- Test: `apps/api/src/modules/inventory/stock-adjustments.service.spec.ts` (เพิ่ม `describe` ท้ายไฟล์ — ใช้ `build()` / `OWNER` ที่มีในไฟล์)

**Interfaces:**
- Consumes: `reportDayStart` · `reportDayEnd`
- Produces: ไม่มี

เหตุ: หน้า "ตัดสินค้า" ส่ง `startDate = YYYY-MM-01` (การ์ด "เดือนนี้" อ่าน `total` จาก `limit:1`) ⇒ คำขอที่สร้าง 00:00–06:59 น. ของวันที่ 1 ไม่ถูกนับ · `StockAdjustment.createdAt` เป็น `@default(now())` (เปิด schema ยืนยัน) · `getSummary` ยังไม่มี caller ฝั่งเว็บ (latent)

- [ ] **Step 1: เขียนเทสต์ที่ต้องล้ม**

ต่อท้าย `stock-adjustments.service.spec.ts`:

```ts
// ────────────────────────────────────────────────────────────────────────────────
// 2026-11-18 — startDate/endDate 'YYYY-MM-DD' = วันตามปฏิทินไทย (เดิม = 07:00 น. ⇒ คำขอ 00:00–06:59 น. ของวันที่ 1 ไม่ถูกนับในการ์ด "เดือนนี้")
// ────────────────────────────────────────────────────────────────────────────────
describe('StockAdjustmentsService — ขอบวันตามเวลาไทย (findAll / getSummary)', () => {
  const START = new Date('2026-10-31T17:00:00.000Z'); // 2026-11-01 00:00 น. ไทย
  const END = new Date('2026-11-17T16:59:59.999Z'); // 2026-11-17 23:59:59.999 น. ไทย

  it('findAll: createdAt = [00:00 startDate, 23:59:59.999 endDate] ทั้ง findMany และ count (การ์ด total ใช้ where เดียวกัน)', async () => {
    const { service, prisma } = build();

    await service.findAll({ startDate: '2026-11-01', endDate: '2026-11-17' }, OWNER);

    expect(prisma.stockAdjustment.findMany.mock.calls[0][0].where.createdAt).toEqual({ gte: START, lte: END });
    expect(prisma.stockAdjustment.count.mock.calls[0][0].where.createdAt).toEqual({ gte: START, lte: END });
    const { gte, lte } = prisma.stockAdjustment.findMany.mock.calls[0][0].where.createdAt;
    expect(new Date('2026-11-01T00:00:00+07:00') >= gte).toBe(true); // คำขอเที่ยงคืนไทยของวันเริ่มอยู่ในช่วง
    expect(new Date('2026-11-18T00:00:00+07:00') <= lte).toBe(false); // เที่ยงคืนไทยของวันถัดจากวันสิ้นสุดอยู่นอกช่วง
  });

  it('findAll: ส่งแค่ startDate (การ์ด "เดือนนี้" ของหน้าเว็บ) → มีแต่ขอบล่าง 00:00 น. ไทย', async () => {
    const { service, prisma } = build();

    await service.findAll({ startDate: '2026-11-01', limit: 1 }, OWNER);

    expect(prisma.stockAdjustment.findMany.mock.calls[0][0].where.createdAt).toEqual({ gte: START });
  });

  it('getSummary: createdAt = [00:00 startDate, 23:59:59.999 endDate] ทั้ง groupBy และ findMany', async () => {
    const { service, prisma } = build();
    prisma.stockAdjustment.groupBy = jest.fn().mockResolvedValue([]);

    await service.getSummary({ startDate: '2026-11-01', endDate: '2026-11-17' });

    expect(prisma.stockAdjustment.groupBy.mock.calls[0][0].where.createdAt).toEqual({ gte: START, lte: END });
    expect(prisma.stockAdjustment.findMany.mock.calls[0][0].where.createdAt).toEqual({ gte: START, lte: END });
  });
});
```

- [ ] **Step 2: รันให้เห็นว่าล้ม**

```bash
cd "/d/BESTCHOICE APP/BESTCHOICE/apps/api" && NODE_OPTIONS=--max-old-space-size=8192 npx jest src/modules/inventory/stock-adjustments.service.spec.ts -t "ขอบวันตามเวลาไทย"
```

Expected: FAIL 3 เทสต์ — `Expected: 2026-10-31T17:00:00.000Z / Received: 2026-11-01T00:00:00.000Z`

- [ ] **Step 3: แก้โค้ด**

`apps/api/src/modules/inventory/stock-adjustments.service.ts` — เพิ่ม import ต่อจาก `import { validatePeriodOpen } from '../../utils/period-lock.util';`:

```ts
import { reportDayEnd, reportDayStart } from '../../utils/date.util';
```

สองจุด (`findAll` :1181-1190 และ `getSummary` :1283-1292 — ข้อความเหมือนกันทุกตัวอักษร ใช้ `replace_all` ได้) — ก่อน:

```ts
    if (filters.startDate || filters.endDate) {
      const dateFilter: Prisma.DateTimeFilter = {};
      if (filters.startDate) dateFilter.gte = new Date(filters.startDate);
      if (filters.endDate) {
        const end = new Date(filters.endDate);
        end.setHours(23, 59, 59, 999);
        dateFilter.lte = end;
      }
      where.createdAt = dateFilter;
    }
```

หลัง:

```ts
    if (filters.startDate || filters.endDate) {
      const dateFilter: Prisma.DateTimeFilter = {};
      if (filters.startDate) dateFilter.gte = reportDayStart(filters.startDate);
      if (filters.endDate) dateFilter.lte = reportDayEnd(filters.endDate);
      where.createdAt = dateFilter;
    }
```

- [ ] **Step 4: รันให้ผ่าน**

```bash
cd "/d/BESTCHOICE APP/BESTCHOICE/apps/api" && NODE_OPTIONS=--max-old-space-size=8192 npx jest src/modules/inventory/stock-adjustments.service.spec.ts
TZ=UTC NODE_OPTIONS=--max-old-space-size=8192 npx jest src/modules/inventory/stock-adjustments.service.spec.ts -t "ขอบวันตามเวลาไทย"
```

Expected: PASS ทั้งไฟล์ (เทสต์เดิมไม่ได้ส่งวันที่ ⇒ ไม่กระทบ)

- [ ] **Step 5: Commit**

```bash
cd "/d/BESTCHOICE APP/BESTCHOICE"
git add apps/api/src/modules/inventory/stock-adjustments.service.ts apps/api/src/modules/inventory/stock-adjustments.service.spec.ts
git commit -m "ตัดสินค้า: รายการ/สรุปที่กรองด้วยวันที่ นับวันเต็มตามเวลาไทย (การ์ดเดือนนี้ไม่ตกคำขอเที่ยงคืนวันที่ 1)

Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>"
```

---

### Task 8: ประวัติโอนสินค้า — `GET /products/transfers/history`

**Files:**
- Modify: `apps/api/src/modules/products/services/stock-transfer.service.ts` (`getTransferHistory` :237-246)
- Create/Test: `apps/api/src/modules/products/services/stock-transfer.service.date-bounds.spec.ts` (โมดูลนี้ไม่มี spec ของ `StockTransferService` ให้เลียน ⇒ prisma ปั้นมือแบบ `accounting.controller.report-dates.spec.ts`)

**Interfaces:**
- Consumes: `reportDayStart` · `reportDayEnd`
- Produces: ไม่มี

เหตุ: latent — `StockTransfersPage` ส่งแค่ `?status=` · `StockTransfer.createdAt` เป็น `@default(now())` · `generateBatchNumber` (:40-41) เป็นตัวนับเลขรายเดือน ไม่ใช่ตัวกรองรายงาน ⇒ ไม่แตะ (ดู "ตรวจแล้วไม่ต้องแก้")

- [ ] **Step 1: เขียนเทสต์ที่ต้องล้ม**

สร้าง `apps/api/src/modules/products/services/stock-transfer.service.date-bounds.spec.ts`:

```ts
import { StockTransferService } from './stock-transfer.service';

/**
 * StockTransferService.getTransferHistory — startDate/endDate 'YYYY-MM-DD' = วันตามปฏิทินไทย (2026-11-18)
 * ปั้น prisma ด้วยมือ (โมดูลนี้ไม่มี spec ของ service นี้)
 */
describe('StockTransferService.getTransferHistory — ขอบวันตามเวลาไทย', () => {
  const START = new Date('2026-10-31T17:00:00.000Z'); // 2026-11-01 00:00 น. ไทย
  const END = new Date('2026-11-17T16:59:59.999Z'); // 2026-11-17 23:59:59.999 น. ไทย

  function make() {
    const prisma = {
      stockTransfer: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
    };
    return { prisma, service: new StockTransferService(prisma as never) };
  }

  it('createdAt = [00:00 startDate, 23:59:59.999 endDate] ทั้ง findMany และ count', async () => {
    const { prisma, service } = make();

    await service.getTransferHistory({ startDate: '2026-11-01', endDate: '2026-11-17' });

    expect(prisma.stockTransfer.findMany.mock.calls[0][0].where.createdAt).toEqual({ gte: START, lte: END });
    expect(prisma.stockTransfer.count.mock.calls[0][0].where.createdAt).toEqual({ gte: START, lte: END });
    const { gte, lte } = prisma.stockTransfer.findMany.mock.calls[0][0].where.createdAt;
    expect(new Date('2026-11-01T00:00:00+07:00') >= gte).toBe(true);
    expect(new Date('2026-11-18T00:00:00+07:00') <= lte).toBe(false);
  });

  it('ไม่ส่งวันที่ → ไม่มีตัวกรอง createdAt', async () => {
    const { prisma, service } = make();
    await service.getTransferHistory({});
    expect(prisma.stockTransfer.findMany.mock.calls[0][0].where.createdAt).toBeUndefined();
  });
});
```

- [ ] **Step 2: รันให้เห็นว่าล้ม**

```bash
cd "/d/BESTCHOICE APP/BESTCHOICE/apps/api" && NODE_OPTIONS=--max-old-space-size=8192 npx jest src/modules/products/services/stock-transfer.service.date-bounds.spec.ts
```

Expected: FAIL 1 เทสต์ (`Received: 2026-11-01T00:00:00.000Z`) · "ไม่ส่งวันที่" ผ่านอยู่แล้ว

- [ ] **Step 3: แก้โค้ด**

`apps/api/src/modules/products/services/stock-transfer.service.ts` — เพิ่ม import ต่อจากบรรทัด import แรกของไฟล์:

```ts
import { reportDayEnd, reportDayStart } from '../../../utils/date.util';
```

`getTransferHistory` (:237-246) — ก่อน:

```ts
    if (filters.startDate || filters.endDate) {
      const dateFilter: Record<string, Date> = {};
      if (filters.startDate) dateFilter.gte = new Date(filters.startDate);
      if (filters.endDate) {
        const end = new Date(filters.endDate);
        end.setHours(23, 59, 59, 999);
        dateFilter.lte = end;
      }
      where.createdAt = dateFilter;
    }
```

หลัง:

```ts
    if (filters.startDate || filters.endDate) {
      const dateFilter: Record<string, Date> = {};
      if (filters.startDate) dateFilter.gte = reportDayStart(filters.startDate);
      if (filters.endDate) dateFilter.lte = reportDayEnd(filters.endDate);
      where.createdAt = dateFilter;
    }
```

- [ ] **Step 4: รันให้ผ่าน**

```bash
cd "/d/BESTCHOICE APP/BESTCHOICE/apps/api" && NODE_OPTIONS=--max-old-space-size=8192 npx jest src/modules/products/services/stock-transfer.service.date-bounds.spec.ts
TZ=UTC NODE_OPTIONS=--max-old-space-size=8192 npx jest src/modules/products/services/stock-transfer.service.date-bounds.spec.ts
```

Expected: PASS 2 tests ทั้งสองการรัน

- [ ] **Step 5: Commit**

```bash
cd "/d/BESTCHOICE APP/BESTCHOICE"
git add apps/api/src/modules/products/services/stock-transfer.service.ts apps/api/src/modules/products/services/stock-transfer.service.date-bounds.spec.ts
git commit -m "ประวัติโอนสินค้า: ตัวกรองวันที่นับวันเต็มตามเวลาไทย

Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>"
```

---

### Task 9: รายการใบซ่อม — `GET /repair-tickets?from&to`

**Files:**
- Modify: `apps/api/src/modules/repair-tickets/services/repair-ticket-query.service.ts` (`findAll` :37-41)
- Test: `apps/api/src/modules/repair-tickets/__tests__/repair-tickets.service.spec.ts` (เพิ่มใน `describe('RepairTicketsService.findAll')` ที่มี `svc`/`prisma`/`OWNER` อยู่แล้ว)

**Interfaces:**
- Consumes: `reportDayStart(value: string): Date` · `reportAsOf(value: string): Date` (`YYYY-MM-DD` → 23:59:59.999 ไทย · ค่าอื่น → `new Date(value)` ตามเดิม)
- Produces: ไม่มี

เหตุ: เดิมทั้งสองขอบเป็น `new Date(dto.from|to)` และขอบบนเป็น `lte` โดยไม่มี `setHours` ⇒ `to=2026-11-17` = **07:00 น. ของวันที่ 17** ⇒ ใบซ่อมที่สร้างหลัง 07:00 น. ของวันสุดท้ายหาย (~17 ชม.) · DTO `@IsDateString` รับทั้ง `YYYY-MM-DD` และ ISO มีเวลา — ค่า ISO มีเวลาต้องได้พฤติกรรมเดิม (ขอบบนตรงตัว) จึงใช้ `reportAsOf` (`YYYY-MM-DD` = สิ้นวันไทย · ค่าอื่นคงเดิม) · latent (เว็บยังไม่เรียกรายการนี้ด้วยวันที่)

- [ ] **Step 1: เขียนเทสต์ที่ต้องล้ม**

ใน `repair-tickets.service.spec.ts` แทรกก่อน `});` ที่ปิด `describe('RepairTicketsService.findAll')` (บรรทัดก่อนหัวคอมเมนต์ `// ─── RepairTicketsService.findOne`):

```ts
  // 2026-11-18 — from/to 'YYYY-MM-DD' = วันตามปฏิทินไทย (เดิม lte = 07:00 น. ของวันสุดท้าย ⇒ ตัดเกือบทั้งวัน)
  it('from/to แบบ YYYY-MM-DD → createdAt [00:00 from, 23:59:59.999 to] เวลาไทย', async () => {
    await svc.findAll({ from: '2026-11-01', to: '2026-11-17' } as any, OWNER);

    const createdAt = prisma.repairTicket.findMany.mock.calls[0][0].where.createdAt;
    expect(createdAt).toEqual({
      gte: new Date('2026-10-31T17:00:00.000Z'),
      lte: new Date('2026-11-17T16:59:59.999Z'),
    });
    expect(new Date('2026-11-01T00:00:00+07:00') >= createdAt.gte).toBe(true); // เที่ยงคืนไทยของวันเริ่มอยู่ในช่วง
    expect(new Date('2026-11-17T15:00:00+07:00') <= createdAt.lte).toBe(true); // บ่ายของวันสุดท้ายอยู่ในช่วง (เดิมหาย)
    expect(new Date('2026-11-18T00:00:00+07:00') <= createdAt.lte).toBe(false); // เที่ยงคืนไทยของวันถัดไปอยู่นอกช่วง
  });

  it('to แบบ ISO มีเวลา → ขอบบนตรงตัวเหมือนเดิม (ไม่ขยายเป็นสิ้นวัน)', async () => {
    await svc.findAll({ from: '2026-11-01T03:00:00.000Z', to: '2026-11-17T05:00:00.000Z' } as any, OWNER);

    expect(prisma.repairTicket.findMany.mock.calls[0][0].where.createdAt).toEqual({
      gte: new Date('2026-11-01T03:00:00.000Z'),
      lte: new Date('2026-11-17T05:00:00.000Z'),
    });
  });
```

- [ ] **Step 2: รันให้เห็นว่าล้ม**

```bash
cd "/d/BESTCHOICE APP/BESTCHOICE/apps/api" && NODE_OPTIONS=--max-old-space-size=8192 npx jest src/modules/repair-tickets/__tests__/repair-tickets.service.spec.ts -t "from/to|to แบบ ISO"
```

Expected: FAIL เทสต์แรก (`Expected: 2026-10-31T17:00:00.000Z / Received: 2026-11-01T00:00:00.000Z`) · เทสต์ ISO ผ่านอยู่แล้ว (ล็อกพฤติกรรมเดิมไว้ไม่ให้เปลี่ยนตอนแก้)

- [ ] **Step 3: แก้โค้ด**

`apps/api/src/modules/repair-tickets/services/repair-ticket-query.service.ts` — เพิ่ม import ต่อจาก `import { hasCrossBranchAccess } from '../../auth/branch-access.util';`:

```ts
import { reportAsOf, reportDayStart } from '../../../utils/date.util';
```


`findAll` (:37-41) — ก่อน:

```ts
    if (dto.from || dto.to) {
      where.createdAt = {};
      if (dto.from) where.createdAt.gte = new Date(dto.from);
      if (dto.to) where.createdAt.lte = new Date(dto.to);
    }
```

หลัง:

```ts
    if (dto.from || dto.to) {
      where.createdAt = {};
      if (dto.from) where.createdAt.gte = reportDayStart(dto.from);
      // reportAsOf: YYYY-MM-DD = สิ้นวันไทย · ค่าอื่นคงตามที่ส่งมา (เดิมไม่ขยายเป็นสิ้นวัน)
      if (dto.to) where.createdAt.lte = reportAsOf(dto.to);
    }
```

- [ ] **Step 4: รันให้ผ่าน**

```bash
cd "/d/BESTCHOICE APP/BESTCHOICE/apps/api" && NODE_OPTIONS=--max-old-space-size=8192 npx jest src/modules/repair-tickets
TZ=UTC NODE_OPTIONS=--max-old-space-size=8192 npx jest src/modules/repair-tickets/__tests__/repair-tickets.service.spec.ts -t "from/to|to แบบ ISO"
```

Expected: PASS ทั้งโมดูล `repair-tickets`

- [ ] **Step 5: Commit**

```bash
cd "/d/BESTCHOICE APP/BESTCHOICE"
git add apps/api/src/modules/repair-tickets/services/repair-ticket-query.service.ts apps/api/src/modules/repair-tickets/__tests__/repair-tickets.service.spec.ts
git commit -m "ใบซ่อม: ตัวกรองช่วงวันที่ (from/to) นับวันเต็มตามเวลาไทย — วันสุดท้ายไม่หายหลัง 07:00 น.

Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>"
```

---

### Task 10: ประวัติเปลี่ยนเครื่อง — `GET /defect-exchange?from&to`

**Files:**
- Modify: `apps/api/src/modules/defect-exchange/defect-exchange.service.ts` (`list` :761-766)
- Create/Test: `apps/api/src/modules/defect-exchange/defect-exchange.service.list-dates.spec.ts` (ไฟล์ `defect-exchange.service.spec.ts` ตั้ง mock ชุดใหญ่ของการเปลี่ยนเครื่อง ไม่ใช้กับ `list` ⇒ ไฟล์ใหม่ปั้นมือ — สร้าง `new DefectExchangeService(prisma, {}, {}, {}, {}, {})` ด้วย 6 อาร์กิวเมนต์ตัวแรกของ constructor)

**Interfaces:**
- Consumes: `reportDayStart(value: string): Date` · `reportAsOf(value: string): Date` (`YYYY-MM-DD` → 23:59:59.999 ไทย · ค่าอื่น → `new Date(value)` ตามเดิม)
- Produces: ไม่มี

เหตุ: `list` อ่านจาก `AuditLog` (`action: 'DEFECT_EXCHANGE'`) · เดิม `lte: new Date(filters.to)` = 07:00 น. ของวันสุดท้าย · latent (เว็บไม่เรียก — หน้าถูก redirect) · `to` ที่เป็น ISO มีเวลาคงเดิมด้วยเหตุผลเดียวกับ Task 9 · เมื่อไม่มีผู้ใช้ที่ผ่านระบบสิทธิ์ (`actor` ว่าง) `list` คืนแถว `auditLog` ตรง ๆ จึงทดสอบได้โดยไม่ต้องมี context สิทธิ์

- [ ] **Step 1: เขียนเทสต์ที่ต้องล้ม**

สร้าง `apps/api/src/modules/defect-exchange/defect-exchange.service.list-dates.spec.ts`:

```ts
import { DefectExchangeService } from './defect-exchange.service';

/**
 * DefectExchangeService.list — from/to 'YYYY-MM-DD' = วันตามปฏิทินไทย (2026-11-18)
 * เดิม lte = new Date(to) = 07:00 น. ของวันสุดท้าย ⇒ ตัดเกือบทั้งวัน · ไม่ส่ง actor ⇒ ไม่มี context สิทธิ์ (คืนแถว auditLog ตรง ๆ)
 */
describe('DefectExchangeService.list — ขอบวันตามเวลาไทย', () => {
  function make() {
    const prisma = { auditLog: { findMany: jest.fn().mockResolvedValue([]) } };
    const service = new DefectExchangeService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    return { prisma, service };
  }

  it('from/to แบบ YYYY-MM-DD → createdAt [00:00 from, 23:59:59.999 to] เวลาไทย', async () => {
    const { prisma, service } = make();

    await service.list({ from: '2026-11-01', to: '2026-11-17' });

    const createdAt = prisma.auditLog.findMany.mock.calls[0][0].where.createdAt;
    expect(createdAt).toEqual({
      gte: new Date('2026-10-31T17:00:00.000Z'),
      lte: new Date('2026-11-17T16:59:59.999Z'),
    });
    expect(new Date('2026-11-17T15:00:00+07:00') <= createdAt.lte).toBe(true); // บ่ายของวันสุดท้ายอยู่ในช่วง (เดิมหาย)
    expect(new Date('2026-11-18T00:00:00+07:00') <= createdAt.lte).toBe(false);
  });

  it('to แบบ ISO มีเวลา → ขอบบนตรงตัวเหมือนเดิม', async () => {
    const { prisma, service } = make();

    await service.list({ to: '2026-11-17T05:00:00.000Z' });

    expect(prisma.auditLog.findMany.mock.calls[0][0].where.createdAt).toEqual({
      lte: new Date('2026-11-17T05:00:00.000Z'),
    });
  });

  it('ไม่ส่งวันที่ → ไม่มีตัวกรอง createdAt', async () => {
    const { prisma, service } = make();
    await service.list({});
    expect(prisma.auditLog.findMany.mock.calls[0][0].where.createdAt).toBeUndefined();
  });
});
```

- [ ] **Step 2: รันให้เห็นว่าล้ม**

```bash
cd "/d/BESTCHOICE APP/BESTCHOICE/apps/api" && NODE_OPTIONS=--max-old-space-size=8192 npx jest src/modules/defect-exchange/defect-exchange.service.list-dates.spec.ts
```

Expected: FAIL เทสต์แรก (`Expected: 2026-10-31T17:00:00.000Z / Received: 2026-11-01T00:00:00.000Z`) · อีกสองข้อผ่านอยู่แล้ว (ล็อกพฤติกรรมเดิม)

- [ ] **Step 3: แก้โค้ด**

`apps/api/src/modules/defect-exchange/defect-exchange.service.ts` — เพิ่ม import ต่อจาก `import { validatePeriodOpen } from '../../utils/period-lock.util';`:

```ts
import { reportAsOf, reportDayStart } from '../../utils/date.util';
```


`list` (:761-766) — ก่อน:

```ts
      where.createdAt = {
        ...(filters.from ? { gte: new Date(filters.from) } : {}),
        ...(filters.to ? { lte: new Date(filters.to) } : {}),
      };
```

หลัง:

```ts
      where.createdAt = {
        ...(filters.from ? { gte: reportDayStart(filters.from) } : {}),
        // reportAsOf: YYYY-MM-DD = สิ้นวันไทย · ค่าอื่นคงตามที่ส่งมา (เดิมไม่ขยายเป็นสิ้นวัน)
        ...(filters.to ? { lte: reportAsOf(filters.to) } : {}),
      };
```

- [ ] **Step 4: รันให้ผ่าน**

```bash
cd "/d/BESTCHOICE APP/BESTCHOICE/apps/api" && NODE_OPTIONS=--max-old-space-size=8192 npx jest src/modules/defect-exchange
TZ=UTC NODE_OPTIONS=--max-old-space-size=8192 npx jest src/modules/defect-exchange/defect-exchange.service.list-dates.spec.ts
```

Expected: PASS (รวม `defect-exchange.service.spec.ts` เดิม)

- [ ] **Step 5: Commit**

```bash
cd "/d/BESTCHOICE APP/BESTCHOICE"
git add apps/api/src/modules/defect-exchange/defect-exchange.service.ts apps/api/src/modules/defect-exchange/defect-exchange.service.list-dates.spec.ts
git commit -m "ประวัติเปลี่ยนเครื่อง: ตัวกรองช่วงวันที่ (from/to) นับวันเต็มตามเวลาไทย

Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>"
```

---

### Task 11: หนังสือทวงถาม — `GET /overdue/letters` · `GET /overdue/letters/counts`

**Files:**
- Modify: `apps/api/src/modules/overdue/contract-letter.service.ts` (`list` :119-122 · `getCountsByStatus` :522-525)
- Test: `apps/api/src/modules/overdue/contract-letter.service.spec.ts` (เพิ่ม `describe` ใน `describe('ContractLetterService')` ก่อน `describe('markPdfGenerated')` และ `describe` ท้ายไฟล์ — ใช้ `mockPrisma` / `service` / รูป `new ContractLetterService(prismaMock as any, {} as any)` ที่มีในไฟล์)

**Interfaces:**
- Consumes: `reportDayStart(value: string): Date` · `reportAsOf(value: string): Date` (`YYYY-MM-DD` → 23:59:59.999 ไทย · ค่าอื่น → `new Date(value)` ตามเดิม)
- Produces: ไม่มี

เหตุ: **มีผู้ใช้จริง** — `LetterFiltersBar` (`<input type=date>` → `YYYY-MM-DD`) · `ContractLetter.triggeredAt` เป็น `@default(now())` · เดิม `from` = 07:00 น. และ `to` (`lte`) = 07:00 น. ของวันสุดท้าย ⇒ หนังสือที่เกิดหลัง 07:00 น. ของวัน "ถึง" หายทั้งวัน และแท็บตัวนับ (`counts`) ผิดแบบเดียวกัน · `to` ที่เป็น ISO มีเวลาคงพฤติกรรมเดิม

- [ ] **Step 1: เขียนเทสต์ที่ต้องล้ม**

ใน `contract-letter.service.spec.ts` แทรกก่อนบรรทัด `  describe('markPdfGenerated', () => {`:

```ts
  describe('list — from/to ขอบวันตามเวลาไทย (2026-11-18)', () => {
    const START = new Date('2026-10-31T17:00:00.000Z'); // 2026-11-01 00:00 น. ไทย
    const END = new Date('2026-11-17T16:59:59.999Z'); // 2026-11-17 23:59:59.999 น. ไทย

    it('from/to แบบ YYYY-MM-DD → triggeredAt [00:00 from, 23:59:59.999 to] เวลาไทย', async () => {
      mockPrisma.contractLetter.findMany.mockResolvedValueOnce([]);
      mockPrisma.contractLetter.count.mockResolvedValueOnce(0);

      await service.list({ from: '2026-11-01', to: '2026-11-17', user: { role: 'OWNER', branchId: null } });

      const triggeredAt = mockPrisma.contractLetter.findMany.mock.calls[0][0].where.triggeredAt;
      expect(triggeredAt).toEqual({ gte: START, lte: END });
      expect(new Date('2026-11-17T15:00:00+07:00') <= triggeredAt.lte).toBe(true); // บ่ายของวันสุดท้ายอยู่ในช่วง (เดิมหาย)
      expect(new Date('2026-11-18T00:00:00+07:00') <= triggeredAt.lte).toBe(false);
      expect(mockPrisma.contractLetter.count.mock.calls[0][0].where.triggeredAt).toEqual({ gte: START, lte: END });
    });

    it('to แบบ ISO มีเวลา → ขอบบนตรงตัวเหมือนเดิม', async () => {
      mockPrisma.contractLetter.findMany.mockResolvedValueOnce([]);
      mockPrisma.contractLetter.count.mockResolvedValueOnce(0);

      await service.list({ to: '2026-11-17T05:00:00.000Z', user: { role: 'OWNER', branchId: null } });

      expect(mockPrisma.contractLetter.findMany.mock.calls[0][0].where.triggeredAt).toEqual({
        lte: new Date('2026-11-17T05:00:00.000Z'),
      });
    });
  });

```

และต่อท้ายไฟล์:

```ts
describe('getCountsByStatus — from/to ขอบวันตามเวลาไทย (2026-11-18)', () => {
  it('ตัวนับแท็บใช้ขอบเดียวกับรายการ: triggeredAt [00:00 from, 23:59:59.999 to] เวลาไทย', async () => {
    const prismaMock = { contractLetter: { groupBy: jest.fn().mockResolvedValue([]) } };
    const svc = new ContractLetterService(prismaMock as any, {} as any);

    await svc.getCountsByStatus({ from: '2026-11-01', to: '2026-11-17', user: { role: 'OWNER', branchId: null } });

    expect(prismaMock.contractLetter.groupBy.mock.calls[0][0].where.triggeredAt).toEqual({
      gte: new Date('2026-10-31T17:00:00.000Z'),
      lte: new Date('2026-11-17T16:59:59.999Z'),
    });
  });
});
```

- [ ] **Step 2: รันให้เห็นว่าล้ม**

```bash
cd "/d/BESTCHOICE APP/BESTCHOICE/apps/api" && NODE_OPTIONS=--max-old-space-size=8192 npx jest src/modules/overdue/contract-letter.service.spec.ts -t "ขอบวันตามเวลาไทย"
```

Expected: FAIL 2 เทสต์ (`list` ข้อแรก · `getCountsByStatus`) — `Expected: 2026-10-31T17:00:00.000Z / Received: 2026-11-01T00:00:00.000Z` · ข้อ ISO ผ่านอยู่แล้ว

- [ ] **Step 3: แก้โค้ด**

`apps/api/src/modules/overdue/contract-letter.service.ts` — เพิ่ม import ต่อจาก `import { getBranchScope } from '../auth/branch-access.util';`:

```ts
import { reportAsOf, reportDayStart } from '../../utils/date.util';
```


สองจุด (`list` :119-122 และ `getCountsByStatus` :522-525 — ข้อความเหมือนกันทุกตัวอักษร ใช้ `replace_all` ได้) — ก่อน:

```ts
        triggeredAt: {
          ...(params.from && { gte: new Date(params.from) }),
          ...(params.to && { lte: new Date(params.to) }),
        },
```

หลัง:

```ts
        triggeredAt: {
          ...(params.from && { gte: reportDayStart(params.from) }),
          // reportAsOf: YYYY-MM-DD = สิ้นวันไทย · ค่าอื่นคงตามที่ส่งมา (เดิมไม่ขยายเป็นสิ้นวัน)
          ...(params.to && { lte: reportAsOf(params.to) }),
        },
```

- [ ] **Step 4: รันให้ผ่าน**

```bash
cd "/d/BESTCHOICE APP/BESTCHOICE/apps/api" && NODE_OPTIONS=--max-old-space-size=8192 npx jest src/modules/overdue/contract-letter.service.spec.ts
TZ=UTC NODE_OPTIONS=--max-old-space-size=8192 npx jest src/modules/overdue/contract-letter.service.spec.ts -t "ขอบวันตามเวลาไทย"
```

Expected: PASS ทั้งไฟล์

- [ ] **Step 5: Commit**

```bash
cd "/d/BESTCHOICE APP/BESTCHOICE"
git add apps/api/src/modules/overdue/contract-letter.service.ts apps/api/src/modules/overdue/contract-letter.service.spec.ts
git commit -m "หนังสือทวงถาม: ตัวกรองวันที่ + ตัวนับแท็บ นับวันเต็มตามเวลาไทย — หนังสือหลัง 07:00 น. ของวันสุดท้ายไม่หาย

Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>"
```

---

### Task 12: สมุดสรุปรับเงินรายวัน — ค่าตั้งต้น "วันนี้/เดือนนี้" เป็นวันที่ UTC (พบเพิ่มตอนตรวจ ไม่อยู่ในตารางตรวจเดิม)

**Files:**
- Modify: `apps/api/src/modules/payments/payments.controller.ts` (`getDailySummaryDates` :146 · `getDailySummary` :164)
- Create/Test: `apps/api/src/modules/payments/payments.controller.default-dates.spec.ts` (ปั้น service ด้วยมือแบบ `reports.controller.balance-sheet.spec.ts` ของ Task 3 — `payments.controller.spec.ts` ตั้ง module ใหญ่ของการรับชำระ ไม่ต้องใช้กับสองเมธอดนี้)

**Interfaces:**
- Consumes: `bangkokDateString(now?: Date): string` · `bkkYearMonth(date: Date): string`
- Produces: ไม่มี

เหตุ (เปิดโค้ดยืนยัน): `GET /payments/daily-summary` ไม่ส่ง `date` ⇒ `new Date().toISOString().split('T')[0]` = วันที่ UTC ⇒ 00:00–06:59 น. ไทยได้สมุดของ "เมื่อวาน" · `GET /payments/daily-summary/dates` ไม่ส่ง `month` ⇒ `new Date().toISOString().slice(0, 7)` ⇒ **คืนวันที่ 1 ของเดือนช่วง 00:00–06:59 น. ได้เดือนก่อน** · ตัวกรองของ `getDailySummary`/`Dates`/`Export` เองใช้ขอบวัน "ตามเวลาโปรเซส" (ถูกบนเวลาไทย — ดูหัวข้อ "ถูกเพราะ TZ ของโปรเซส") จึงไม่แตะ

- [ ] **Step 1: เขียนเทสต์ที่ต้องล้ม**

สร้าง `apps/api/src/modules/payments/payments.controller.default-dates.spec.ts`:

```ts
import { PaymentsController } from './payments.controller';

/**
 * GET /payments/daily-summary · /daily-summary/dates — ไม่ส่ง date/month ⇒ ใช้ "วันนี้/เดือนนี้ตามเวลาไทย" (2026-11-18)
 * เดิมใช้วันที่ UTC ⇒ 00:00–06:59 น. ไทย ได้เมื่อวาน (คืนวันที่ 1 ได้เดือนก่อน)
 * จำลองเวลาเฉพาะ Date · ปั้น PaymentsService ด้วยมือ
 */
const FAKE_DATE_ONLY = [
  'nextTick', 'setImmediate', 'setTimeout', 'setInterval', 'clearTimeout',
  'clearInterval', 'clearImmediate', 'queueMicrotask', 'hrtime', 'performance',
] as const;

describe('PaymentsController — ค่าตั้งต้นของสมุดสรุปรายวัน', () => {
  const paymentsService = {
    getDailySummary: jest.fn().mockResolvedValue({}),
    getDailySummaryDates: jest.fn().mockResolvedValue({}),
  };
  const controller = new PaymentsController(
    paymentsService as never,
    {} as never,
    {} as never,
    {} as never,
  );

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it('daily-summary ไม่ส่ง date: 03:30 น. ไทยของวันที่ 18 พ.ย. → สมุดของ 2026-11-18', () => {
    jest.useFakeTimers({ now: new Date('2026-11-17T20:30:00.000Z'), doNotFake: [...FAKE_DATE_ONLY] });
    controller.getDailySummary('');
    expect(paymentsService.getDailySummary).toHaveBeenCalledWith('2026-11-18', undefined, undefined, undefined);
  });

  it('daily-summary ส่ง date มาเอง → ใช้ค่านั้น', () => {
    controller.getDailySummary('2026-10-31');
    expect(paymentsService.getDailySummary).toHaveBeenCalledWith('2026-10-31', undefined, undefined, undefined);
  });

  it('daily-summary/dates ไม่ส่ง month: 01:00 น. ไทยของวันที่ 1 ธ.ค. (= 18:00Z ของ 30 พ.ย.) → เดือน 2026-12', () => {
    jest.useFakeTimers({ now: new Date('2026-11-30T18:00:00.000Z'), doNotFake: [...FAKE_DATE_ONLY] });
    controller.getDailySummaryDates('');
    expect(paymentsService.getDailySummaryDates).toHaveBeenCalledWith('2026-12', undefined);
  });

  it('daily-summary/dates ส่ง month มาเอง → ใช้ค่านั้น', () => {
    controller.getDailySummaryDates('2026-09');
    expect(paymentsService.getDailySummaryDates).toHaveBeenCalledWith('2026-09', undefined);
  });
});
```

- [ ] **Step 2: รันให้เห็นว่าล้ม**

```bash
cd "/d/BESTCHOICE APP/BESTCHOICE/apps/api" && NODE_OPTIONS=--max-old-space-size=8192 npx jest src/modules/payments/payments.controller.default-dates.spec.ts
```

Expected: FAIL 2 เทสต์ — `Expected: "2026-11-18" / Received: "2026-11-17"` · `Expected: "2026-12" / Received: "2026-11"` (อีกสองข้อผ่านอยู่แล้ว)

- [ ] **Step 3: แก้โค้ด**

`apps/api/src/modules/payments/payments.controller.ts` — เพิ่ม import ต่อจาก `import { clientIp } from '../../utils/client-ip.util';`:

```ts
import { bangkokDateString, bkkYearMonth } from '../../utils/date.util';
```

`getDailySummaryDates` (:144-147) — ก่อน:

```ts
    return this.paymentsService.getDailySummaryDates(
      month || new Date().toISOString().slice(0, 7),
      effectiveBranchId,
    );
```

หลัง:

```ts
    return this.paymentsService.getDailySummaryDates(
      month || bkkYearMonth(new Date()),
      effectiveBranchId,
    );
```

`getDailySummary` (:163-166) — ก่อน:

```ts
    return this.paymentsService.getDailySummary(
      date || new Date().toISOString().split('T')[0],
      effectiveBranchId,
```

หลัง:

```ts
    return this.paymentsService.getDailySummary(
      date || bangkokDateString(),
      effectiveBranchId,
```

- [ ] **Step 4: รันให้ผ่าน**

```bash
cd "/d/BESTCHOICE APP/BESTCHOICE/apps/api" && NODE_OPTIONS=--max-old-space-size=8192 npx jest src/modules/payments/payments.controller.default-dates.spec.ts src/modules/payments/payments.controller.spec.ts
TZ=UTC NODE_OPTIONS=--max-old-space-size=8192 npx jest src/modules/payments/payments.controller.default-dates.spec.ts
```

Expected: PASS ทั้งสองไฟล์

- [ ] **Step 5: Commit**

```bash
cd "/d/BESTCHOICE APP/BESTCHOICE"
git add apps/api/src/modules/payments/payments.controller.ts apps/api/src/modules/payments/payments.controller.default-dates.spec.ts
git commit -m "สมุดสรุปรับเงินรายวัน: ค่าตั้งต้นวันนี้/เดือนนี้ตามเวลาไทย (เดิมใช้วันที่ UTC ⇒ ช่วง 00:00–06:59 น. ได้เมื่อวาน/เดือนก่อน)

Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>"
```

---

### Task 13: การ์ดสรุปสัญญารายเดือน — ขอบเดือนจาก "เวลาของโปรเซส" เป็นปฏิทินไทย (swap ที่ผลเหมือนเดิมบนเวลาไทย)

**Files:**
- Modify: `apps/api/src/modules/contracts/services/contract-query.service.ts` (`getMilestonesSummary` :350-353 · import :5)
- Create/Test: `apps/api/src/modules/contracts/services/contract-query.milestones.spec.ts` (ไม่มี spec ของเมธอดนี้ ⇒ prisma ปั้นมือแบบ `accounting.controller.report-dates.spec.ts`)

**Interfaces:**
- Consumes: `bangkokCalendarParts(date: Date): { year: number; month: number; day: number }` (`month` = 0–11) · `bangkokMidnight(year: number, month: number, day: number): Date` (`month` ล้นได้เหมือน `Date` constructor)
- Produces: ไม่มี

นี่คือแถว "ถูกเพราะ TZ ของโปรเซส" ที่เปลี่ยนเป็นตัวช่วยได้โดยไม่เปลี่ยนพฤติกรรมบนโปรเซสเวลาไทย (ที่ prod ตั้ง `TZ=Asia/Bangkok`) — แสดงไว้ด้านล่าง:

| | ก่อน | หลัง | ผลบนโปรเซสเวลาไทย |
|---|---|---|---|
| ต้นเดือน | `new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0)` | `bangkokMidnight(year, month, 1)` | `Date.UTC(y,m,1) − 7 ชม.` เท่ากันทุกกรณี |
| สิ้นเดือน | `new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999)` | `new Date(bangkokMidnight(year, month + 1, 1).getTime() - 1)` | เที่ยงคืนไทยของวันที่ 1 เดือนถัดไป − 1 มิลลิวินาที = 23:59:59.999 ของวันสุดท้าย เท่ากันทุกกรณี |

ต่างเฉพาะเมื่อโปรเซสไม่ใช่เวลาไทย (เช่น `TZ=UTC` ใน CI) ซึ่งตอนนี้ได้เดือน/ขอบตามปฏิทินไทยถูกต้อง — จึงเป็นการ "ลดการพึ่ง TZ" ไม่ใช่การเปลี่ยนผลบน prod

- [ ] **Step 1: เขียนเทสต์ (ล้มเฉพาะเมื่อโปรเซสไม่ใช่เวลาไทย)**

สร้าง `apps/api/src/modules/contracts/services/contract-query.milestones.spec.ts`:

```ts
import { ContractQueryService } from './contract-query.service';

/**
 * getMilestonesSummary — "เดือนนี้" = เดือนปฏิทินไทย (2026-11-18) ไม่ขึ้นกับ TZ ของโปรเซส
 * ปั้น prisma ด้วยมือ · จำลองเวลาเฉพาะ Date
 */
const FAKE_DATE_ONLY = [
  'nextTick', 'setImmediate', 'setTimeout', 'setInterval', 'clearTimeout',
  'clearInterval', 'clearImmediate', 'queueMicrotask', 'hrtime', 'performance',
] as const;

function make() {
  const prisma = {
    contract: { findMany: jest.fn().mockResolvedValue([]) },
    payment: { findMany: jest.fn().mockResolvedValue([]), groupBy: jest.fn().mockResolvedValue([]) },
  };
  return { prisma, service: new ContractQueryService(prisma as never) };
}

describe('ContractQueryService.getMilestonesSummary — เดือนปฏิทินไทย', () => {
  afterEach(() => jest.useRealTimers());

  it('กลางเดือน: 03:30 น. ไทยของ 18 พ.ย. → [2026-11-01 00:00, 2026-11-30 23:59:59.999] เวลาไทย', async () => {
    jest.useFakeTimers({ now: new Date('2026-11-17T20:30:00.000Z'), doNotFake: [...FAKE_DATE_ONLY] });
    const { prisma, service } = make();

    await service.getMilestonesSummary();

    const range = {
      gte: new Date('2026-10-31T17:00:00.000Z'),
      lte: new Date('2026-11-30T16:59:59.999Z'),
    };
    expect(prisma.contract.findMany.mock.calls[0][0].where.createdAt).toEqual(range);
    expect(prisma.payment.findMany.mock.calls[0][0].where.dueDate).toEqual(range);
  });

  it('ข้ามเดือน: 01:00 น. ไทยของ 1 ธ.ค. (= 18:00Z ของ 30 พ.ย.) → เดือน ธ.ค. ไม่ใช่ พ.ย.', async () => {
    jest.useFakeTimers({ now: new Date('2026-11-30T18:00:00.000Z'), doNotFake: [...FAKE_DATE_ONLY] });
    const { prisma, service } = make();

    await service.getMilestonesSummary();

    expect(prisma.contract.findMany.mock.calls[0][0].where.createdAt).toEqual({
      gte: new Date('2026-11-30T17:00:00.000Z'), // 2026-12-01 00:00 น. ไทย
      lte: new Date('2026-12-31T16:59:59.999Z'), // 2026-12-31 23:59:59.999 น. ไทย
    });
  });
});
```

- [ ] **Step 2: รันเพื่อยืนยันว่านี่คือ swap ที่ผลเหมือนเดิม**

```bash
cd "/d/BESTCHOICE APP/BESTCHOICE/apps/api" && NODE_OPTIONS=--max-old-space-size=8192 npx jest src/modules/contracts/services/contract-query.milestones.spec.ts
TZ=UTC NODE_OPTIONS=--max-old-space-size=8192 npx jest src/modules/contracts/services/contract-query.milestones.spec.ts
```

Expected (ก่อนแก้โค้ด): รันบนเครื่องเวลาไทย **PASS** (พิสูจน์ว่าสูตรเดิมให้ผลเดียวกับที่เทสต์คาด = การแก้ไม่เปลี่ยนผลบน prod) · รันด้วย `TZ=UTC` **FAIL ทั้งสองเทสต์** (`Expected: 2026-10-31T17:00:00.000Z / Received: 2026-11-01T00:00:00.000Z`) — นี่คือการจำลอง CI/โปรเซสที่ไม่ใช่เวลาไทย

- [ ] **Step 3: แก้โค้ด**

`apps/api/src/modules/contracts/services/contract-query.service.ts` — แก้ import (:5) ก่อน:

```ts
import { bangkokDateRange } from '../../../utils/date.util';
```

หลัง:

```ts
import { bangkokCalendarParts, bangkokDateRange, bangkokMidnight } from '../../../utils/date.util';
```

`getMilestonesSummary` (:349-353) — ก่อน:

```ts
    const now = new Date();
    // Current month bounds (UTC — server stores UTC but created_at/due_date are aligned to BKK days)
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
```

หลัง:

```ts
    const now = new Date();
    // เดือนปัจจุบันตามปฏิทินไทย — ไม่ขึ้นกับ TZ ของโปรเซส (ผลเท่าเดิมบนโปรเซสเวลาไทย)
    const { year, month } = bangkokCalendarParts(now);
    const monthStart = bangkokMidnight(year, month, 1);
    const monthEnd = new Date(bangkokMidnight(year, month + 1, 1).getTime() - 1);
```

- [ ] **Step 4: รันให้ผ่าน**

```bash
cd "/d/BESTCHOICE APP/BESTCHOICE/apps/api" && NODE_OPTIONS=--max-old-space-size=8192 npx jest src/modules/contracts/services/contract-query.milestones.spec.ts src/modules/contracts/contracts.service.spec.ts
TZ=UTC NODE_OPTIONS=--max-old-space-size=8192 npx jest src/modules/contracts/services/contract-query.milestones.spec.ts
```

Expected: PASS ทั้งสองการรัน (รวม `TZ=UTC` ที่เคยล้มในขั้นที่ 2)

- [ ] **Step 5: Commit**

```bash
cd "/d/BESTCHOICE APP/BESTCHOICE"
git add apps/api/src/modules/contracts/services/contract-query.service.ts apps/api/src/modules/contracts/services/contract-query.milestones.spec.ts
git commit -m "การ์ดสรุปสัญญารายเดือน: ขอบเดือนตามปฏิทินไทยไม่พึ่ง TZ ของโปรเซส (ผลเหมือนเดิมบนเวลาไทย)

Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>"
```

---

## ตรวจรวมก่อน push

```bash
cd "/d/BESTCHOICE APP/BESTCHOICE" && ./tools/check-types.sh api
cd apps/api && NODE_OPTIONS=--max-old-space-size=8192 npx jest src/modules/reports src/modules/receipts src/modules/purchase-orders src/modules/inventory src/modules/products src/modules/repair-tickets src/modules/defect-exchange src/modules/overdue/contract-letter.service.spec.ts src/modules/payments/payments.controller src/modules/contracts/services src/utils
TZ=UTC NODE_OPTIONS=--max-old-space-size=8192 npx jest src/modules/reports src/modules/payments/payments.controller.default-dates.spec.ts src/modules/contracts/services/contract-query.milestones.spec.ts
git diff --stat -- apps/api/src/modules/employee-access/access-policy.manifest.json
```

Expected: 0 type errors · jest PASS ทั้งสองชุด (ชุดที่สองรันด้วย `TZ=UTC` เพื่อยืนยันว่าเทสต์ไม่ขึ้นกับ TZ) · `git diff --stat` ของ manifest ว่าง (ไม่ได้แก้) · `node tools/check-access-coverage.mjs` ให้ CI เป็นตัวตัดสิน (ล้มบน Windows อยู่ก่อนแล้ว)

---
## ผลตรวจแถว UNSURE ของ audit (เปิดโค้ดแล้ว)

| แถว (audit) | ผลตัดสิน | เหตุผล / อยู่ใน |
|---|---|---|
| #12 รายการบัญชีค่าใช้จ่ายใน P&L — `accounting/transactional-report.service.ts:81` (`aggregateFinanceExpenses`) | **ไม่ใช่บั๊กเพิ่ม — แผน A ครอบอยู่แล้ว** (ไม่มี task ที่นี่) | ตัวกรองคือ `entryDate gte start / lte end` ของ `JournalEntry` (FINANCE, บัญชี 51–54) และ `start`/`end` มาจาก `getProfitLossReport` :132 ซึ่งแผน A แก้ · ใบรายจ่ายลงรายการด้วย `postedAt: doc.documentDate` (`journal/cpa-templates/expense-accrual.template.ts:125` · `expense-same-day.template.ts:214`) และ `documentDate = new Date(dto.documentDate)` (`expense-document-create.service.ts:114` · ใบลดหนี้ :391 · ใบเงินเดือนตอนกดจ่าย `expense-document-lifecycle.service.ts:379`) = **07:00 น. ไทยพอดี** ⇒ วันแรกของช่วงรอดเพราะ `gte` รวมขอบ 07:00 พอดี (บังเอิญ) · ที่หลุดจริงมีเฉพาะใบ `REPAIR_SERVICE` ที่ `documentDate = new Date()` เวลาจริง (`expense-document-create.service.ts:232`) ถ้าลง 00:00–06:59 น. ของวันแรก — **แผน A แก้ขอบเริ่มเป็น 00:00 น. ที่ :132 ก็ครอบทั้งสองกรณี** · ใบกลับรายการ (void) ลงเที่ยงวันไทย (`bkk-business-date.util.ts`) ไม่เกี่ยว · ⇒ ไม่มีบั๊กด้านค่าใช้จ่ายที่แผน A "ไม่ครอบ" |
| #17 `report-generator.service.ts:90` (รายสัปดาห์) | **BUG — แก้ใน Task 4** | key ที่อ่านสอดคล้องกับป้ายที่เลื่อนของรายวันโดยบังเอิญ แต่ป้าย `weekStart` และ key `weekly_report_<weekStart>` ผิดหนึ่งวัน และจะอ่านผิดวันทั้งหมดเมื่อแก้ป้ายรายวัน ⇒ ต้องแก้คู่กัน |
| #28 วันที่ของโปรโมชัน (`promotions.service.ts` 8 จุด) | **ต้องให้เจ้าของตัดสิน** (ไม่มี task) | หัวข้อ "ต้องให้เจ้าของตัดสิน" |
| #31 ตัวกรองวันครบกำหนด `payment-query.service.ts:19-29` (`buildDueDateRange`) | **OK (ถูกเพราะ TZ ของโปรเซส)** — ไม่แก้ | ขอบคือ `[00:00 ไทยของ dueFrom, 00:00 ไทยของวันถัดจาก dueTo)` ครอบทุกเวลาในวันนั้น ⇒ ถูกไม่ว่า `due_date` จะเก็บ 00:00 หรือ 07:00 น. (เวลาใดก็ตามภายในวันปฏิทินไทยของมันตกวันเดียวกัน) ⇒ ข้อกังวลเรื่อง "การกระจายเวลาของ due_date" ของ audit ไม่มีผล · พึ่ง TZ ของโปรเซสอย่างเดียว (ดูตารางถัดไป) |

## ถูกเพราะ TZ ของโปรเซส

prod ตั้ง `TZ=Asia/Bangkok` (`Dockerfile:77` · `.github/workflows/deploy-gcp.yml:661`) จึงถูกอยู่ · แถวด้านล่างคือ "ถูกเพราะ TZ" ตามตาราง audit — **แปลงในแผนนี้เฉพาะที่ swap แล้วผลเหมือนเดิมแน่นอน** ที่เหลือคงไว้พร้อมเหตุผลที่ไม่แปลง

| แถว | ตำแหน่ง | สถานะ | เหตุผล |
|---|---|---|---|
| (ใหม่) หน้าต่างวันของรายงาน cron | `reports/report-generator.service.ts:32-33` | **แปลงแล้ว — Task 4** | `new Date(y,m,d)` / `(y,m,d+1)` → `bangkokStartOfDay(d)` / `addBkkDays(…, 1)` ผลเท่ากันทุกกรณีบนเวลาไทย · แก้พร้อมบรรทัดป้ายวันที่ติดกัน |
| #39 การ์ดสรุปสัญญารายเดือน | `contracts/services/contract-query.service.ts:352-353` | **แปลงแล้ว — Task 13** | ก่อน/หลัง/ผลเทียบกันในตารางของ Task 13 · เทสต์รันทั้งเวลาไทยและ `TZ=UTC` |
| #7 พอร์ตโฟลิโอไฟแนนซ์ | `reports/services/receivables-report.service.ts:176-182` (`new Date(\`${d}T00:00:00\`)` / `T23:59:59.999`) | **ไม่แปลง** | ไม่ pure: ตัวกรองเดิม `isNaN` ข้ามค่าที่ผิดรูปเงียบ ๆ ⇒ ถ้าสลับเป็น `reportDayStart/End` วันที่ไม่มีจริง (`2026-02-31`) จะกลายเป็น 400 และค่ามีเวลา (`2026-11-01T05:00`) ที่เดิมถูกข้ามจะถูกนำมาใช้ — ผลบน `YYYY-MM-DD` จริงเหมือนเดิมแต่พฤติกรรมค่าผิดรูปเปลี่ยน ⇒ ขัดกฎ "ค่าที่ไม่ใช่ `YYYY-MM-DD` ได้พฤติกรรมเดิม" · เว็บส่ง `YYYY-MM-DD` เสมอ ⇒ ไม่มีผลบน prod · ถ้าอยากแปลงให้ทำเป็นงานแยกพร้อมตัดสินพฤติกรรมค่าผิดรูป |
| #31 / #32 ตัวกรองวันครบกำหนดของคิวรับชำระ | `payments/services/payment-query.service.ts:19-29,391-395` | **ไม่แปลง** | ไม่ pure: `bangkokDateRange` เข้มกว่า (ค่าผิดรูป → 400 · ของเดิมข้ามเงียบ) |
| #33 ตัดยอดค้าง 60 วัน | `payment-query.service.ts:569` (`setHours(0,0,0,0)` ของ "วันนี้") | **ไม่แปลง** | swap เป็น `addBkkDays(bangkokStartOfDay(), -60)` ผลเท่ากันบนเวลาไทย แต่ไม่ใช่ขอบของรายงานที่ผู้ใช้เลือก และต้องสร้างชุดทดสอบ `getPendingSummary` ใหม่ทั้งชุด — เก็บไว้เป็นงานแยกถ้าต้องการ |
| #34 / #35 สมุดสรุปรายวัน · วันที่มีรายการ · ส่งออก | `payment-query.service.ts:691-697,847,889-905` | **ไม่แปลง** | เทสต์เดิมปักด้วย `new Date(2026, 7, 1)` (ขอบแบบ "เวลาโปรเซส" — `daily-summary-dates.spec.ts:68-69` · `daily-summary-export.spec.ts:71-83`) ⇒ ถ้าแปลงต้องแก้ค่าคาดหวังของเทสต์เดิมทั้งชุด (ไม่ใช่ no-change) และผู้เรียกที่ส่งค่าผิดรูปจะได้ 400 แทนข้อมูลว่าง · **แต่ค่าตั้งต้น "วันนี้/เดือนนี้" ของสองเส้นนี้แก้แล้วใน Task 12** |
| #13 / #15 งบดุล ณ วันที่ · รายงานรายเดือน | `accounting/transactional-report.service.ts:589,408-409,450-451,539` | **ไม่ใช่ของแผนนี้** | ไฟล์นี้เป็นของแผน A |
| (ใหม่) กราฟสต๊อกย้อนหลังรายเดือน | `products/services/stock-overview.service.ts:117,126,196-197,214-215` | **ไม่แปลง** | `new Date(y, m, 1)` จากเวลาปัจจุบัน — ตัวเลขประกอบแดชบอร์ดสต๊อก ไม่มีตัวกรองจาก client · ไม่อยู่ในตารางตรวจเดิม · ปล่อยไว้ |
| (ใหม่) เส้นตายรอบนัดชำระ · คิวทวงถาม · snapshot | `overdue/promise.service.ts:42-43` · `overdue/queue.service.ts:495-502` · `overdue/contract-snapshot.cron.ts:41,112` | **ไม่แปลง** | ค่าที่คำนวณจาก "ตอนนี้" ไม่ใช่ตัวกรองจากผู้ใช้ · `contract_daily_snapshots.date` เป็น `@db.Date` (อยู่นอกขอบเขต) |
| (ใหม่ — final review) ปี/เดือนค่าตั้งต้นของหน้ารายงาน | `reports/reports.controller.ts:48,57,107-108,252` (`getFullYear()` / `getMonth()` ของเวลาปัจจุบันเมื่อไม่ส่งปี/เดือน) | **ไม่แปลง** | ถูกบนโปรเซสเวลาไทย · ผิดเฉพาะโปรเซส UTC ช่วง 00:00–06:59 น. ของวันที่ 1 (ได้เดือนก่อน) · แปลงเป็น `bangkokCalendarParts` ภายหลังได้ |

> หมายเหตุจำนวน: audit เขียนว่า "7 แถวถูกเพราะ TZ" แต่รายการในวงเล็บมี 8 รหัส (#7, 13, 15, 32–35, 39) · สองแถว (#13, #15) อยู่ในไฟล์ของแผน A ⇒ ของแผนนี้เหลือ 6 แถว (#7, #32, #33, #34, #35, #39) ซึ่งแปลง 1 (#39) ส่วนที่เหลือคงไว้ตามเหตุผลด้านบน

## ตรวจแล้วไม่ต้องแก้

ห้ามมีใคร "แก้" แถวเหล่านี้ภายหลัง

| ที่ | เหตุผล |
|---|---|
| `sales/services/sales-query.service.ts:63,299` (`/sales` · `/sales/daily-summary`) · `contracts/services/contract-query.service.ts:86` (`/contracts`) | ใช้ `bangkokDateRange` อยู่แล้ว (gte 00:00 ไทย · lt วันถัดไป) · เทสต์ `sales-query.service.spec.ts:30-37` ปักค่า ISO ไว้ — ต้นแบบของแผนนี้ |
| `contracts/early-payoff-slip/slip-checks.ts:72` | ประกอบ `…T…:00+07:00` ชัดแจ้ง ไม่ใช่ตัวกรองช่วง |
| `shop-petty-cash/shop-petty-cash.util.ts:129-146` | `thaiMonthRange` ใช้ `bangkokMidnight` ถูกอยู่แล้ว |
| `shop-tenders/*` (สรุปเงินสดหน้าร้านรายวัน `/shop/daily-cash`) | ใช้ `bangkokDateString` / ขอบวันไทยอยู่แล้ว (ตรวจ grep ทั้งโมดูล ไม่พบ `new Date('YYYY-MM-DD')`/`setHours`) |
| `commission/commission.service.ts:134-135,219` | กรองด้วยสตริง `period = YYYY-MM` ไม่มีตัวกรองช่วงวันที่ดิบ |
| `after-sales/services/after-sales-query.service.ts:449` · `employee-access/access-after-sales-query.service.ts:93` | ต้นเดือนประกอบ `…-01T00:00:00+07:00` ถูกอยู่แล้ว (รายการ "ไม่ได้เปิด" ของ audit — เปิดแล้ว) |
| `reporting/reporting.controller.ts:42-46` (`POST /reporting/pdf`) | เว็บส่ง `toISOString()` (ISO เต็มพร้อมเวลา) ⇒ ใช้ตรง ๆ ถูกแล้ว · หากอนาคตรับ `YYYY-MM-DD` ให้ใช้ `reportDayStart/End` |
| `products/services/stock-transfer.service.ts:40-41` (`generateBatchNumber`) | ตัวนับเลขรายเดือนแบบ local ไม่ใช่ตัวกรองรายงาน · `:106 expectedDeliveryDate` เป็นค่าที่เก็บ |
| `defect-exchange/defect-exchange.service.ts:146-152,209-211` | คำนวณหน้าต่างรับประกัน 7 วัน/รับประกันผู้จำหน่าย (`windowEnd` · `warrantyEnd` ด้วย `setDate`) ไม่ใช่ตัวกรองรายงาน · ป้ายวันที่ในข้อความเหตุผล (`baseDate.toISOString().slice(0,10)`) คลาดได้เฉพาะเครื่องที่รับ 00:00–06:59 น. — เป็นข้อความ ไม่กระทบการตัดสิน |
| `overdue/queue.service.ts:322` (ตัวสุ่มลำดับคิวรายวัน) | `now.toISOString().slice(0,10)` เป็นแค่ seed ของการสลับลำดับ — เปลี่ยนวันที่ 07:00 น. แทน 00:00 น. ไม่มีผลต่อข้อมูล |
| `reports/report-generator.service.ts:130-137` (`getLatestDailyReport`) | **ไม่มีผู้เรียกในโค้ด** (grep ทั้ง `apps/`) ⇒ ไม่แก้ · ถ้ามีผู้เรียกในอนาคตต้องตัดสินก่อนว่า "ล่าสุด" หมายถึงวันไหน เพราะรายงานของวัน D เกิดตอน 23:55 น. |
| `receipts` / `payments` ผู้เขียน `paidDate` (`payments.service.ts:351` · `payment-approval.controller.ts:347` ฯลฯ) | เป็นตัวเขียน ไม่ใช่ตัวกรอง — เป็นเหตุที่ใบจากวิซาร์ดตกที่ 07:00 น. พอดี (แผนนี้ไม่เปลี่ยนวิธีเก็บ — forward-only) |
| `payments/services/payment-csv-import.service.ts:163` | มีคอมเมนต์ระบุอยู่แล้วว่าเลี่ยง `toISOString().slice` — ไม่ใช่ตัวกรอง |
| `purchase-orders/services/po-lifecycle.service.ts:42` (`assertExpectedNotBeforeOrder`) | เทียบลำดับ "วันที่สั่ง" กับ "วันที่คาดรับ" (ตรวจความถูกต้องของฟอร์ม `@IsDateString`) ไม่ใช่ตัวกรองรายงาน |

## พบเพิ่มระหว่างตรวจ (นอกตารางตรวจเดิม)

- **แก้แล้วในแผนนี้:** `payments/payments.controller.ts:146,164` ค่าตั้งต้นของสมุดสรุปรายวัน (Task 12)
- **ยังไม่แก้ (ป้ายข้อความ ไม่ใช่ตัวกรอง):** `payments/services/reschedule-collect.service.ts:342,352` เขียนหมายเหตุลงแถวงวดด้วย `new Date().toISOString().slice(0,10)` ⇒ ปรับดิวตอน 00:00–06:59 น. ได้ป้ายเมื่อวาน · เทสต์ของไฟล์นี้ใช้นาฬิกาจริงร่วมกับค่าคงที่วันครบกำหนด จึงจำลองเวลาเข้าไปทำให้เทสต์เดิมเปราะ — เสนอเป็นงานแยกพร้อมจัดชุดเทสต์ก่อน
- **นอกขอบเขตแผนนี้ (ไม่มีเจ้าของในสามแผน):** `peak/peak.controller.ts:31` (`POST /peak/export` — `new Date(dto.startDate)` / `new Date(dto.endDate)` ดิบ กรอง `JournalEntry.entryDate`; รายการตั้งลูกหนี้ลงเที่ยงคืนไทย ⇒ ขอบเริ่ม 07:00 น. ตัดรายการเหล่านั้น) — แจ้งผู้ตรวจรวมเพื่อมอบหมาย · `line-oa/services/payment-evidence.service.ts:70-72` (`dateFrom`/`dateTo` ของหลักฐานชำระ — ของแผนสื่อสาร)

## ต้องให้เจ้าของตัดสิน

**1. โปรโมชันควรใช้ได้ "ตลอดวันสุดท้าย" หรือไม่?**

ตอนนี้ระบบเก็บ "วันสิ้นสุด" ที่กรอกเป็น `YYYY-MM-DD` เป็นเวลา 07:00 น. ของวันนั้น (`new Date('2026-11-30')`) และตรวจ "ตอนนี้ ≤ วันสิ้นสุด" ⇒ โปรที่ตั้งสิ้นสุด 30 พ.ย. **หมดอายุตั้งแต่ 07:00 น. ของวันที่ 30** (ร้านยังเปิดขายอีกทั้งวัน — ลูกค้าที่มาวันที่ 30 บ่ายจะใช้โปรไม่ได้) · วันเริ่มก็เริ่มที่ 07:00 น. เช่นกัน (ผลน้อย เพราะร้านยังไม่เปิด)

คำถาม: โปรโมชันที่กำหนดสิ้นสุดวันที่ 30 ควรใช้ได้จนถึงสิ้นวันที่ 30 (23:59 น.) ใช่หรือไม่?

| คำตอบ | สิ่งที่เปลี่ยน |
|---|---|
| **ใช้ได้ทั้งวันสุดท้าย** | เพิ่มงานใหม่ (นอกแผนนี้): ใน `apps/api/src/modules/promotions/promotions.service.ts` เปลี่ยนเฉพาะ **วันสิ้นสุด** เป็น `reportAsOf(dto.endDate)` (โค้ดเดิมเป็น `new Date(...)` เปล่า) ที่ :51 (ตรวจตอนสร้าง) · :63 (ค่าที่บันทึกตอนสร้าง) · :154 (ตรวจตอนแก้ไข) · :167 (ค่าที่บันทึกตอนแก้ไข) · **ไม่แตะวันเริ่ม** (:50, :62, :153, :166) เพราะ `reportDayStart` จะเก็บ `…T17:00Z` ของวันก่อนหน้า และหน้าแก้ไขโปร (`PromotionsPage.tsx:149-150` อ่านกลับด้วย `.slice(0, 10)`) จะแสดงวันเริ่มถอยหลังหนึ่งวัน — ส่วนวันสิ้นสุดใหม่ `…T16:59:59.999Z` อ่านกลับได้วันเดิม · ตัวตรวจ "ใช้ได้ไหม" (`promotions.service.ts:102-103` · `contract-promotion-terms.ts:60-61` · `promotion-benefit.ts:69-70`) ไม่ต้องแก้ · **โปรที่มีอยู่แล้วยังหมด 07:00 น.** จนกว่าผู้ดูแลกดแก้ไข-บันทึกซ้ำ (ไม่แก้ข้อมูลเดิม) |
| **ตามเดิม (หมด 07:00 น. ของวันสุดท้าย)** | ไม่แก้โค้ด · แนะนำเพิ่มข้อความบนหน้าสร้างโปรว่า "ใช้ได้ถึง 07:00 น. ของวันสิ้นสุด" (งานฝั่งเว็บ แยกต่างหาก) |

## ผลต่อผู้ใช้

**เจ้าของ / ผู้จัดการ** — หน้า **รายงาน** (`/reports`): รายงานรายได้และกำไรขาดทุน · เปรียบเทียบพนักงานขาย · เปรียบเทียบสาขา · กำไรแยกนิติบุคคล จะนับรายการที่เกิดตั้งแต่ 00:00 น. ของวันเริ่มต้นช่วง (เดิมเริ่มนับที่ 07:00 น.) — ยอดวันแรกของช่วงอาจสูงขึ้นเล็กน้อย (เช่นเงินที่ตัดผ่านเกตเวย์ตอนกลางคืน · สัญญาที่ลงเช้ามืด) · ยอดวันสุดท้ายไม่เปลี่ยน · **สรุปรับเงินรายวัน** ใน `/reports` เดิมนับ 07:00 น. ถึง 07:00 น. ของวันถัดไป ตอนนี้นับเที่ยงคืนถึงเที่ยงคืน — ยอดรายวันแต่ละวันอาจขยับ (ใบที่รับตอนกลางคืนย้ายไปอยู่วันที่ถูกต้อง) แต่ยอดรวมของหลายวันติดกันต่างกันเฉพาะรอยต่อหัว–ท้ายช่วง · ใบที่ลงจากหน้ารับชำระของพนักงาน (เวลา 07:00 น. พอดี) ไม่ขยับ

**ฝ่ายบัญชี** — หน้า **ใบเสร็จ**: ตัวกรองวันที่ตั้งแต่/ถึง และยอดรวมบนหัวตารางนับใบที่ออกเที่ยงคืน–07:00 น. ของวันเริ่ม · หน้า **หนังสือทวงถาม** (`/letters`): ตัวกรองวันที่ "ถึง" ครบทั้งวัน (เดิมตัดตั้งแต่ 07:00 น. ของวันนั้น) และตัวนับบนแท็บตรงกับรายการ · หน้า **ตัดสินค้า**: การ์ด "เดือนนี้" นับคำขอที่สร้างเที่ยงคืน–07:00 น. ของวันที่ 1 · หน้า **สรุปรับเงินรายวัน**: เมื่อเปิดหน้าโดยไม่เลือกวัน (ช่วง 00:00–06:59 น.) จะได้ของวันนี้ ไม่ใช่เมื่อวาน · รายงานรายไตรมาส (API) รวมวันสุดท้ายของไตรมาส (31 มี.ค. / 30 มิ.ย. / 30 ก.ย. / 31 ธ.ค.) — เดิมหายทั้งวัน · งบดุลที่ไม่ระบุวันที่ใช้ "วันนี้" ตามเวลาไทย

**ไม่เห็นผล (ยังไม่มีหน้าจอส่งวันที่)**: ประวัติ/สรุปรับของของใบสั่งซื้อ · ประวัติโอนสินค้า · รายการใบซ่อม · ประวัติเปลี่ยนเครื่อง · ส่งออกสัญญา (`/reports/export/contracts`) — แก้ไว้ล่วงหน้าให้ถูกเมื่อมีผู้เรียกด้วยวันที่

**ระบบเบื้องหลัง** — รายงานสรุปรายวัน/รายสัปดาห์ที่ cron สร้างตอน 23:55 น. เก็บป้ายวันเป็นวันจริง (เดิมเลื่อนไปหนึ่งวัน) · ไม่มีหน้าจอใดอ่านค่านี้ในตอนนี้ · รายงานที่สร้างก่อน deploy ยังใช้ป้ายเดิมและไม่ถูกย้าย ⇒ สรุปรายสัปดาห์ของสัปดาห์ที่คร่อมวัน deploy อาจขาดหรือเหลื่อมหนึ่งวัน (ครั้งเดียว)

**ข้อควรรู้** — ไม่มีข้อมูลเดิมถูกแก้ · ตัวเลขที่เปิดดูย้อนหลังอาจต่างจากที่เคยเห็นเล็กน้อยเพราะแก้ "วิธีนับ" ไม่ใช่ข้อมูล · ไม่มีเมนู/ปุ่ม/ข้อความบนหน้าจอเปลี่ยน ⇒ ไม่ต้องอัปเดตเวอร์ชันเว็บ

**วันที่ที่ไม่มีจริง (final review)** — ทุกจุดที่แปลงในแผนนี้ ถ้าส่ง `YYYY-MM-DD` ที่ไม่มีจริง (เช่น `2026-02-30`) ได้ 400 "วันที่ไม่ถูกต้อง" (เดิม `new Date` เลื่อนไปวันถัดไปเงียบ ๆ หรือเดือน 13 / วันที่ 32 ได้ 500) · เป็นข้อยกเว้น "เปลี่ยนเป็น 400" ตาม Global Constraints · หน้าเว็บส่งวันที่แบบนี้ไม่ได้ (ช่องเลือกวันที่) ⇒ กระทบเฉพาะผู้เรียก API ตรง
