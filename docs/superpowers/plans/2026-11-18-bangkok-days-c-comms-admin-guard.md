# แผน ค — แชท งานดูแลระบบ และตัวกันถอยหลัง · แผนลงมือ

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** แก้จุดที่รับวันที่แบบ `YYYY-MM-DD` ฝั่งแชท · AI usage · audit log · หลักฐานสลิป · ยอดขายนำเข้า ให้นับเป็นวันตามปฏิทินไทย (เดิม = 07:00 น. ไทย) และเพิ่มเทสต์ตัวกันถอยหลังที่สแกนทั้ง `apps/api/src` ไม่ให้ใครเขียนบั๊กชนิดนี้กลับมา

**Architecture:** ใช้ตัวช่วยที่มีใน `apps/api/src/utils/date.util.ts` (`reportDayStart` / `reportDayEnd` / `reportAsOf` / `bangkokStartOfDay` / `addBkkDays` / `bangkokDateString` / `bkkYearMonth`) แก้ที่จุดที่แปลงสตริงเป็น `Date` (controller หรือ service ที่แปลงเอง) โดยไม่แตะ route/decorator · งานสุดท้ายคือเทสต์ Jest `date-string-day-bounds.guard.spec.ts` แบบ allow-list ตามแบบ `line-id-finance-readers.spec.ts` (เดินไฟล์ · ตัดคอมเมนต์ · รายงานจุดที่ผิดพร้อมเหตุผล · ล้มเมื่อรายการอนุญาตค้าง) ซึ่งต้องรันหลังแผน ก และ ข ถูก merge เข้า branch แล้ว

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

**ข้อกำหนดเฉพาะแผน ค**
- เลือกตัวช่วยตามตัวดำเนินการที่ใช้อยู่จริงและตามพฤติกรรมเดิมของค่าที่ไม่ใช่ `YYYY-MM-DD`:
  - ขอบเริ่ม `gte` → `reportDayStart(value)`
  - ขอบสิ้นสุด `lte` ที่เดิมเป็น `new Date(value)` เฉย ๆ → `reportAsOf(value)` (ค่าที่ไม่ใช่ `YYYY-MM-DD` ได้ `new Date(value)` เหมือนเดิมทุกไบต์)
  - ขอบสิ้นสุด `lte` ที่เดิมทำ `setHours(23,59,59,999)` (เฉพาะ `payment-evidence.service.ts`) → `reportDayEnd(value)` (ค่าที่ไม่ใช่ `YYYY-MM-DD` ได้พฤติกรรมเดิมทุกไบต์)
- `YYYY-MM-DD` ที่ไม่มีวันนั้นจริง (เช่น `2026-02-30`) ตัวช่วยตอบ 400 `วันที่ไม่ถูกต้อง` (เดิม = Invalid Date ชน Prisma เป็น 500) — ยอมรับเป็นผลข้างเคียงที่ดีขึ้น ไม่ต้องแก้เพิ่ม
- เทสต์ทุกตัวยืนยัน **ISO instant ตายตัว** (เช่น `'2026-11-01'` → `2026-10-31T17:00:00.000Z`) ไม่พึ่ง TZ ของเครื่อง — jest ของ `apps/api` ไม่ได้ pin TZ และ `installRuntimeGlobals()` (ที่ตั้ง `TZ=Asia/Bangkok`) ไม่ถูกเรียกในเทสต์หน่วย เทสต์ที่ต้องรู้ "เวลาปัจจุบัน" ใช้ `jest.useFakeTimers()` + `jest.setSystemTime(...)`
- คำสั่งรันเทสต์มาตรฐานของแผนนี้ (รันจาก `apps/api`): `NODE_OPTIONS=--max-old-space-size=8192 npx jest <path> --runInBand`
- ทุก task ใหม่ไม่ต้องแตะ `apps/web` — ไม่มีหน้าเว็บเปลี่ยน (ค่าที่เว็บส่งเป็น `YYYY-MM-DD` อยู่แล้วทุกที่)

## ตารางครอบคลุมจุดที่ต้องแก้ (ยืนยันโดยเปิดโค้ดจริงบน branch `fix/bangkok-day-bounds`)

| จุด | Task |
|---|---|
| `chatbot-finance/chatbot-finance-admin.controller.ts:68-69` (analytics/date-range) · `:219-220` (learning/feedback-stats) · + การแบ่งวันในกราฟรายวัน `services/admin-analytics.service.ts:148,159` | 1 |
| `csat/csat.controller.ts:33-34` | 2 |
| `staff-chat/staff-chat.controller.ts:813-814` (AI metrics) | 3 |
| `ai-usage/ai-usage.service.ts:285-286` (breakdown) · `:78-85` (summary) · `:213-215` + `:222-232` (trend) · `ai-usage/ai-budget.cron.ts:29-30` (ให้ใช้ตัวนับวันเดียวกัน) | 4 |
| `audit/audit.service.ts:289-290` (`/audit/logs`) | 5 |
| `line-oa/services/payment-evidence.service.ts:70-73` (ทั้งสองขอบ) | 6 |
| `imported-sales/imported-sales.service.ts:22-23` (+ การจัดกลุ่มรายเดือน `:79-82`) | 7 |
| `receivable-recon.service.ts:142` — ตัดสินแล้ว = OK ไม่แก้ (ดูหัวข้อ "ตรวจแล้วไม่ต้องแก้") | — |
| `peak/peak.controller.ts:31` — เป็นของแผน ก (Task 12) ไม่อยู่ในแผนนี้ | — |
| ตัวกันถอยหลังทั้ง `apps/api/src` (สแกนเฉพาะ `apps/api/src` — ไม่ครอบคลุม `apps/web` เช่น `AssetAuditPage` ซึ่งเป็นงานเว็บของแผน ก) | 8 |

## File Structure

| ไฟล์ | หน้าที่ |
|---|---|
| `apps/api/src/modules/chatbot-finance/chatbot-finance-admin.controller.ts` | `getDateRangeStats` · `getFeedbackStats` แปลงวันด้วยตัวช่วย |
| `apps/api/src/modules/chatbot-finance/chatbot-finance-admin.controller.report-dates.spec.ts` (ใหม่) | ปักขอบวันที่ controller ส่งให้ service |
| `apps/api/src/modules/chatbot-finance/services/admin-analytics.service.ts` | SQL กราฟรายวันแบ่งวันตามเวลาไทย |
| `apps/api/src/modules/chatbot-finance/services/admin-analytics.service.date-range.spec.ts` (ใหม่) | ปัก SQL + ขอบ `where` |
| `apps/api/src/modules/csat/csat.controller.ts` · `csat.controller.report-dates.spec.ts` (ใหม่) | `getStats` |
| `apps/api/src/modules/staff-chat/staff-chat.controller.ts` · `staff-chat.controller.spec.ts` | `getAiMetrics` · เพิ่ม describe |
| `apps/api/src/modules/ai-usage/ai-usage.service.ts` · `ai-usage.admin.spec.ts` | summary · trend · breakdown · แก้เทสต์ที่ปักบั๊ก |
| `apps/api/src/modules/ai-usage/ai-budget.cron.ts` · `ai-budget.cron.spec.ts` | ใช้ `bangkokStartOfDay()` |
| `apps/api/src/modules/audit/audit.service.ts` · `audit.service.date-range.spec.ts` (ใหม่) | `getAuditLogs` |
| `apps/api/src/modules/line-oa/services/payment-evidence.service.ts` · `line-oa-payment.controller.spec.ts` | `getEvidenceList` · แก้เทสต์ที่ปักบั๊ก |
| `apps/api/src/modules/imported-sales/imported-sales.service.ts` · `__tests__/imported-sales.service.spec.ts` | `buildWhere` · `summary().byMonth` |
| `apps/api/src/utils/date-string-day-bounds.guard.spec.ts` (ใหม่) | ตัวกันถอยหลัง |

---

### Task 1: chatbot-finance admin — analytics/date-range · feedback-stats · กราฟรายวัน

**Files:**
- Modify: `apps/api/src/modules/chatbot-finance/chatbot-finance-admin.controller.ts` (เมธอด `getDateRangeStats` บรรทัด 64-71 · `getFeedbackStats` บรรทัด 215-222 · import)
- Modify: `apps/api/src/modules/chatbot-finance/services/admin-analytics.service.ts` (`getDateRangeStats` — raw SQL บรรทัด 143-158)
- Create: `apps/api/src/modules/chatbot-finance/chatbot-finance-admin.controller.report-dates.spec.ts`
- Create: `apps/api/src/modules/chatbot-finance/services/admin-analytics.service.date-range.spec.ts`

**Interfaces:**
- Consumes: `reportDayStart(value: string): Date` · `reportAsOf(value: string): Date` จาก `../../utils/date.util`
- Produces: ไม่มี (signature ของ `AdminAnalyticsService.getDateRangeStats(startDate: Date, endDate: Date)` และ `FeedbackService.getStats(startDate: Date, endDate: Date)` ไม่เปลี่ยน)

**เหตุผลที่ต้องแก้ SQL ด้วย:** `date_trunc('day', cm.created_at)` ตัดวันตาม UTC แล้ว service แปลงเป็นป้าย `YYYY-MM-DD` จาก UTC เมื่อขอบเริ่มเปลี่ยนเป็น 00:00 น. ไทย (= 17:00Z วันก่อนหน้า) กราฟจะได้แท่งแรกชื่อ "วันก่อนวันเริ่ม" ที่มีข้อความ 00:00-06:59 น. ไทยของวันเริ่ม และข้อความ 00:00-06:59 น. ไทยของทุกวันถูกนับเข้าวันก่อนหน้า — ใช้รูป `(col AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Bangkok'` ที่ `modules/customer-journey/sources/chat.source.ts:55` ใช้อยู่แล้ว (คอลัมน์ `created_at` เป็น `timestamp` ไม่มี timezone เก็บเป็น UTC)

- [ ] **Step 1: เขียนเทสต์ที่ต้องล้ม**

สร้าง `apps/api/src/modules/chatbot-finance/chatbot-finance-admin.controller.report-dates.spec.ts` (แบบเดียวกับ `accounting/accounting.controller.report-dates.spec.ts` — สร้าง controller ด้วยมือ ไม่ใช้ Nest module):

```ts
import { ChatbotFinanceAdminController } from './chatbot-finance-admin.controller';

/**
 * analytics/date-range และ learning/feedback-stats รับ 'YYYY-MM-DD' = วันตามปฏิทินไทย (2026-11-18)
 * เดิม new Date('YYYY-MM-DD') = 07:00 น. ไทย ⇒ ข้อความ 00:00–06:59 น. ของวันเริ่ม และทุกอย่างหลัง 07:00 น.
 * ของวันสิ้นสุดตกนอกช่วง (ทั้งจำนวนข้อความ ค่าใช้จ่าย และจำนวน handoff)
 */
describe('ChatbotFinanceAdminController — วันที่ของ analytics/date-range และ feedback-stats', () => {
  const START = '2026-04-30T17:00:00.000Z'; // 2026-05-01 00:00:00.000 น. ไทย
  const END = '2026-05-31T16:59:59.999Z'; // 2026-05-31 23:59:59.999 น. ไทย
  const analytics = { getDateRangeStats: jest.fn() };
  const feedback = { getStats: jest.fn() };
  const controller = new ChatbotFinanceAdminController(
    analytics as never,
    {} as never,
    {} as never,
    feedback as never,
  );
  const iso = (d: Date) => d.toISOString();

  beforeEach(() => jest.clearAllMocks());
  afterEach(() => jest.useRealTimers());

  it('analytics/date-range: ช่วง = 00:00 น. วันเริ่ม ถึง 23:59:59.999 น. วันสิ้นสุด (เวลาไทย)', async () => {
    await controller.getDateRangeStats('2026-05-01', '2026-05-31');
    const [start, end] = analytics.getDateRangeStats.mock.calls[0];
    expect(iso(start)).toBe(START);
    expect(iso(end)).toBe(END);
  });

  it('ขอบ: ข้อความ 00:00 น. ไทยของวันเริ่มอยู่ในช่วง · 00:00 น. ของวันถัดจากวันสิ้นสุดอยู่นอกช่วง', async () => {
    await controller.getDateRangeStats('2026-05-01', '2026-05-31');
    const [start, end] = analytics.getDateRangeStats.mock.calls[0] as [Date, Date];
    const firstInstant = new Date('2026-05-01T00:00:00+07:00').getTime();
    const nextDayMidnight = new Date('2026-06-01T00:00:00+07:00').getTime();
    expect(firstInstant >= start.getTime() && firstInstant <= end.getTime()).toBe(true);
    expect(nextDayMidnight <= end.getTime()).toBe(false);
  });

  it('วันเดียว (start = end) ได้ช่วงเต็มวัน 24 ชั่วโมง', async () => {
    await controller.getDateRangeStats('2026-11-18', '2026-11-18');
    const [start, end] = analytics.getDateRangeStats.mock.calls[0] as [Date, Date];
    expect(iso(start)).toBe('2026-11-17T17:00:00.000Z');
    expect(iso(end)).toBe('2026-11-18T16:59:59.999Z');
  });

  it('ค่า ISO เต็ม (ไม่ใช่ YYYY-MM-DD) ใช้ตามเดิม', async () => {
    await controller.getDateRangeStats('2026-05-01T03:00:00.000Z', '2026-05-31T10:00:00.000Z');
    const [start, end] = analytics.getDateRangeStats.mock.calls[0] as [Date, Date];
    expect(iso(start)).toBe('2026-05-01T03:00:00.000Z');
    expect(iso(end)).toBe('2026-05-31T10:00:00.000Z');
  });

  it('ไม่ส่งวันที่ = 30 วันย้อนหลังถึงตอนนี้ ตามเดิม', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-11-18T05:00:00.000Z'));
    await controller.getDateRangeStats();
    const [start, end] = analytics.getDateRangeStats.mock.calls[0] as [Date, Date];
    expect(iso(start)).toBe('2026-10-19T05:00:00.000Z');
    expect(iso(end)).toBe('2026-11-18T05:00:00.000Z');
  });

  it('learning/feedback-stats: ช่วง = 00:00 น. วันเริ่ม ถึง 23:59:59.999 น. วันสิ้นสุด (เวลาไทย)', async () => {
    await controller.getFeedbackStats('2026-05-01', '2026-05-31');
    const [start, end] = feedback.getStats.mock.calls[0] as [Date, Date];
    expect(iso(start)).toBe(START);
    expect(iso(end)).toBe(END);
  });
});
```

สร้าง `apps/api/src/modules/chatbot-finance/services/admin-analytics.service.date-range.spec.ts`:

```ts
import { AdminAnalyticsService } from './admin-analytics.service';

/**
 * กราฟรายวันของ analytics/date-range ต้องแบ่งวันตามเวลาไทย (2026-11-18) — เดิม date_trunc('day', created_at)
 * ตัดตาม UTC ⇒ ข้อความ 00:00–06:59 น. ไทยถูกนับเป็นวันก่อนหน้า และเมื่อขอบเริ่มเป็นเที่ยงคืนไทย
 * แท่งแรกจะชื่อเป็นวันก่อนวันเริ่ม
 */
describe('AdminAnalyticsService.getDateRangeStats — แบ่งวันตามเวลาไทย', () => {
  const start = new Date('2026-04-30T17:00:00.000Z');
  const end = new Date('2026-05-31T16:59:59.999Z');
  const prisma = {
    $queryRaw: jest.fn(),
    chatMessage: { aggregate: jest.fn() },
    chatRoom: { count: jest.fn() },
  };
  const service = new AdminAnalyticsService(prisma as never);

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$queryRaw.mockResolvedValue([]);
    prisma.chatMessage.aggregate.mockResolvedValue({ _sum: { costUsd: null } });
    prisma.chatRoom.count.mockResolvedValue(0);
  });

  it('SQL กราฟรายวันแบ่งวันด้วย AT TIME ZONE Asia/Bangkok ทั้งใน SELECT และ GROUP BY', async () => {
    await service.getDateRangeStats(start, end);

    const [strings, ...values] = prisma.$queryRaw.mock.calls[0] as [readonly string[], ...unknown[]];
    const sql = strings.join('?');
    expect(sql.match(/AT TIME ZONE 'Asia\/Bangkok'/g)).toHaveLength(2);
    expect(values).toEqual([start, end]);
  });

  it('ป้ายวันของแต่ละแท่งมาจากวันไทยที่ SQL คืนมา (timestamp ไม่มี timezone)', async () => {
    prisma.$queryRaw.mockResolvedValue([
      { date: new Date('2026-05-01T00:00:00.000Z'), messages: BigInt(3), cost: 0.5 },
      { date: new Date('2026-05-02T00:00:00.000Z'), messages: BigInt(2), cost: 0.25 },
    ]);

    const res = await service.getDateRangeStats(start, end);

    expect(res.dailyStats).toEqual([
      { date: '2026-05-01', messages: 3, cost: 0.5 },
      { date: '2026-05-02', messages: 2, cost: 0.25 },
    ]);
    expect(res.totalMessages).toBe(5);
  });

  it('ขอบ gte/lte เดียวกันถูกส่งให้ aggregate และนับ handoff', async () => {
    await service.getDateRangeStats(start, end);

    expect(prisma.chatMessage.aggregate.mock.calls[0][0].where.createdAt).toEqual({ gte: start, lte: end });
    expect(prisma.chatRoom.count.mock.calls[0][0].where.handoffTaggedAt).toEqual({ gte: start, lte: end });
  });
});
```

- [ ] **Step 2: รันให้เห็นว่าล้ม**

```
cd apps/api && NODE_OPTIONS=--max-old-space-size=8192 npx jest src/modules/chatbot-finance/chatbot-finance-admin.controller.report-dates.spec.ts src/modules/chatbot-finance/services/admin-analytics.service.date-range.spec.ts --runInBand
```
คาดว่า: ล้มในชุด controller — `Expected: "2026-04-30T17:00:00.000Z"  Received: "2026-05-01T00:00:00.000Z"` (กรณี analytics และ feedback-stats) และเคสขอบ · ชุด service ล้ม 1 เคส `expect(...).toHaveLength(2)` (`Received length: 0`) · เคส "ค่า ISO เต็ม" · "ไม่ส่งวันที่" · "ป้ายวัน" · "ขอบ gte/lte" ผ่านอยู่แล้ว (ปักพฤติกรรมเดิมที่ต้องคงไว้)

- [ ] **Step 3: แก้โค้ด**

`chatbot-finance-admin.controller.ts` — เพิ่ม import ต่อจากบรรทัด `import { CurrentUser } from '../auth/decorators/current-user.decorator';`:

```ts
import { reportAsOf, reportDayStart } from '../../utils/date.util';
```

`getDateRangeStats` (before → after):

```ts
// before
    const start = startDate ? new Date(startDate) : new Date(Date.now() - 30 * 86400_000);
    const end = endDate ? new Date(endDate) : new Date();
    return this.analytics.getDateRangeStats(start, end);
```
```ts
// after
    const start = startDate ? reportDayStart(startDate) : new Date(Date.now() - 30 * 86400_000);
    const end = endDate ? reportAsOf(endDate) : new Date();
    return this.analytics.getDateRangeStats(start, end);
```

`getFeedbackStats` (before → after):

```ts
// before
    const start = startDate ? new Date(startDate) : new Date(Date.now() - 30 * 86400_000);
    const end = endDate ? new Date(endDate) : new Date();
    return this.feedbackService.getStats(start, end);
```
```ts
// after
    const start = startDate ? reportDayStart(startDate) : new Date(Date.now() - 30 * 86400_000);
    const end = endDate ? reportAsOf(endDate) : new Date();
    return this.feedbackService.getStats(start, end);
```

`admin-analytics.service.ts` `getDateRangeStats` — SQL (before → after):

```ts
// before
        SELECT
          date_trunc('day', cm.created_at) AS date,
          COUNT(*)::bigint AS messages,
          COALESCE(SUM(cm.cost_usd), 0)::float AS cost
        FROM chat_messages cm
        JOIN chat_rooms cr ON cr.id = cm.room_id
        WHERE cr.channel = 'LINE_FINANCE'
          AND cm.created_at >= ${startDate}
          AND cm.created_at <= ${endDate}
        GROUP BY date_trunc('day', cm.created_at)
        ORDER BY date ASC
```
```ts
// after
        SELECT
          date_trunc('day', (cm.created_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Bangkok') AS date,
          COUNT(*)::bigint AS messages,
          COALESCE(SUM(cm.cost_usd), 0)::float AS cost
        FROM chat_messages cm
        JOIN chat_rooms cr ON cr.id = cm.room_id
        WHERE cr.channel = 'LINE_FINANCE'
          AND cm.created_at >= ${startDate}
          AND cm.created_at <= ${endDate}
        GROUP BY date_trunc('day', (cm.created_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Bangkok')
        ORDER BY date ASC
```
(การ map `d.date.toISOString().slice(0, 10)` ด้านล่างไม่ต้องแก้ — Prisma อ่าน `timestamp` ไม่มี timezone เป็น UTC ดังนั้น `2026-05-01 00:00:00` = วันไทย 1 พ.ค. ได้ป้าย `2026-05-01`) · ส่วนอื่นของไฟล์ (`getOverview` "วันนี้" แบบโปรเซสโลคัล) **ไม่แตะ** — อยู่ในรายการ "ตรวจแล้วไม่ต้องแก้"

- [ ] **Step 4: รันให้ผ่าน**

```
cd apps/api && NODE_OPTIONS=--max-old-space-size=8192 npx jest src/modules/chatbot-finance/chatbot-finance-admin.controller.report-dates.spec.ts src/modules/chatbot-finance/services/admin-analytics.service.date-range.spec.ts --runInBand
```
คาดว่า: 2 suites ผ่านทั้งหมด (6 + 3 เคส)

- [ ] **Step 5: Commit**

```
git add apps/api/src/modules/chatbot-finance/chatbot-finance-admin.controller.ts apps/api/src/modules/chatbot-finance/chatbot-finance-admin.controller.report-dates.spec.ts apps/api/src/modules/chatbot-finance/services/admin-analytics.service.ts apps/api/src/modules/chatbot-finance/services/admin-analytics.service.date-range.spec.ts
git commit -m "แก้ analytics แชทการเงินและสถิติความพึงพอใจให้นับวันตามเวลาไทย (+ กราฟรายวันแบ่งวันไทย)

Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>"
```

---

### Task 2: csat/stats

**Files:**
- Modify: `apps/api/src/modules/csat/csat.controller.ts` (`getStats` บรรทัด 28-36 · import)
- Create: `apps/api/src/modules/csat/csat.controller.report-dates.spec.ts` (โมดูลนี้ไม่มี spec — สร้าง controller ด้วยมือแบบ `accounting.controller.report-dates.spec.ts`)

**Interfaces:**
- Consumes: `reportDayStart` · `reportAsOf` จาก `../../utils/date.util`
- Produces: ไม่มี (`CsatService.getStats(startDate?: Date, endDate?: Date)` ไม่เปลี่ยน · ฟิลด์ `period: { start, end }` ที่ service คืนจะเป็นขอบเวลาไทยตามค่าที่รับมา)

- [ ] **Step 1: เขียนเทสต์ที่ต้องล้ม**

สร้าง `apps/api/src/modules/csat/csat.controller.report-dates.spec.ts`:

```ts
import { CsatController } from './csat.controller';

/**
 * GET /csat/stats รับ 'YYYY-MM-DD' = วันตามปฏิทินไทย (2026-11-18) — เดิม new Date('YYYY-MM-DD') = 07:00 น. ไทย
 * ⇒ คะแนนที่ให้ 00:00–06:59 น. ของวันเริ่ม และหลัง 07:00 น. ของวันสิ้นสุดไม่ถูกนับ
 */
describe('CsatController.getStats — วันที่ตามเวลาไทย', () => {
  const csat = { getStats: jest.fn() };
  const controller = new CsatController(csat as never);
  const iso = (d: Date | undefined) => d?.toISOString();

  beforeEach(() => jest.clearAllMocks());

  it('ช่วง = 00:00 น. วันเริ่ม ถึง 23:59:59.999 น. วันสิ้นสุด (เวลาไทย)', async () => {
    await controller.getStats('2026-11-01', '2026-11-17');
    const [start, end] = csat.getStats.mock.calls[0];
    expect(iso(start)).toBe('2026-10-31T17:00:00.000Z');
    expect(iso(end)).toBe('2026-11-17T16:59:59.999Z');
  });

  it('ขอบ: คะแนน 00:00 น. ไทยของวันเริ่มอยู่ในช่วง · 00:00 น. ของวันถัดจากวันสิ้นสุดอยู่นอกช่วง', async () => {
    await controller.getStats('2026-11-01', '2026-11-17');
    const [start, end] = csat.getStats.mock.calls[0] as [Date, Date];
    const firstInstant = new Date('2026-11-01T00:00:00+07:00').getTime();
    const nextDayMidnight = new Date('2026-11-18T00:00:00+07:00').getTime();
    expect(firstInstant >= start.getTime() && firstInstant <= end.getTime()).toBe(true);
    expect(nextDayMidnight <= end.getTime()).toBe(false);
  });

  it('ไม่ส่งวันที่ = undefined ทั้งคู่ (service ใช้ 30 วันย้อนหลังเอง) ตามเดิม', async () => {
    await controller.getStats();
    expect(csat.getStats).toHaveBeenCalledWith(undefined, undefined);
  });

  it('ค่า ISO เต็ม (ไม่ใช่ YYYY-MM-DD) ใช้ตามเดิม', async () => {
    await controller.getStats('2026-11-01T03:00:00.000Z', '2026-11-17T10:00:00.000Z');
    const [start, end] = csat.getStats.mock.calls[0];
    expect(iso(start)).toBe('2026-11-01T03:00:00.000Z');
    expect(iso(end)).toBe('2026-11-17T10:00:00.000Z');
  });
});
```

- [ ] **Step 2: รันให้เห็นว่าล้ม**

```
cd apps/api && NODE_OPTIONS=--max-old-space-size=8192 npx jest src/modules/csat/csat.controller.report-dates.spec.ts --runInBand
```
คาดว่า: ล้ม 2 เคสแรก (`Expected: "2026-10-31T17:00:00.000Z"  Received: "2026-11-01T00:00:00.000Z"` และเคสขอบ) · อีก 2 เคสผ่าน

- [ ] **Step 3: แก้โค้ด**

เพิ่ม import ต่อจาก `import { SubmitRatingDto } from './dto/submit-rating.dto';`:

```ts
import { reportAsOf, reportDayStart } from '../../utils/date.util';
```

```ts
// before
    const start = startDate ? new Date(startDate) : undefined;
    const end = endDate ? new Date(endDate) : undefined;
    return this.csatService.getStats(start, end);
```
```ts
// after
    const start = startDate ? reportDayStart(startDate) : undefined;
    const end = endDate ? reportAsOf(endDate) : undefined;
    return this.csatService.getStats(start, end);
```

- [ ] **Step 4: รันให้ผ่าน**

```
cd apps/api && NODE_OPTIONS=--max-old-space-size=8192 npx jest src/modules/csat/csat.controller.report-dates.spec.ts --runInBand
```
คาดว่า: 4 เคสผ่าน

- [ ] **Step 5: Commit**

```
git add apps/api/src/modules/csat/csat.controller.ts apps/api/src/modules/csat/csat.controller.report-dates.spec.ts
git commit -m "แก้สถิติ CSAT ให้นับวันตามเวลาไทย

Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>"
```

---

### Task 3: staff-chat — ตัวชี้วัด AI (`GET /staff-chat/ai/metrics`)

**Files:**
- Modify: `apps/api/src/modules/staff-chat/staff-chat.controller.ts` (`getAiMetrics` บรรทัด 808-815 · import)
- Modify (test): `apps/api/src/modules/staff-chat/staff-chat.controller.spec.ts` (mock ของ `AiMetricsService` · ตัวแปร `aiMetrics` · describe ใหม่)

**Interfaces:**
- Consumes: `reportDayStart` · `reportAsOf` จาก `../../utils/date.util`
- Produces: ไม่มี (`AiMetricsService.getMetrics(from?: Date, to?: Date)` ไม่เปลี่ยน — ใช้ `gte`/`lte` อยู่แล้ว)

เว็บ `AiPerformancePage.tsx:57` ส่ง `from`/`to` เป็น `YYYY-MM-DD` (ค่าเริ่มต้น 30 วันถึงวันนี้) — เดิมตัวเลขของ "วันนี้" หายไปหมดหลัง 07:00 น.

- [ ] **Step 1: เขียนเทสต์ที่ต้องล้ม** (แก้ spec เดิม — ใช้ Nest testing module ชุดเดิมของไฟล์)

แก้ `staff-chat.controller.spec.ts` สี่จุด (ใช้ Edit):

1) mock ของ `AiMetricsService` ใน providers
```ts
// before
        { provide: AiMetricsService, useValue: {} },
// after
        { provide: AiMetricsService, useValue: { getMetrics: jest.fn().mockResolvedValue({}) } },
```

2) ตัวแปร
```ts
// before
  let config: ConfigService;
// after
  let config: ConfigService;
  let aiMetrics: AiMetricsService;
```

3) หลัง `config = module.get(ConfigService);` ใน `beforeEach`
```ts
// before
    config = module.get(ConfigService);
// after
    config = module.get(ConfigService);
    aiMetrics = module.get(AiMetricsService);
```

4) เพิ่ม describe ใหม่ **ก่อน** `  describe('GET /staff-chat/ai/status (B3 Task 13)', () => {`:

```ts
  describe('GET /staff-chat/ai/metrics — วันที่ตามเวลาไทย', () => {
    const getMetrics = () => aiMetrics.getMetrics as jest.Mock;
    const iso = (d: Date | undefined) => d?.toISOString();

    beforeEach(() => getMetrics().mockClear());

    it('from/to แบบ YYYY-MM-DD = 00:00 น. วันเริ่ม ถึง 23:59:59.999 น. วันสิ้นสุด (เวลาไทย)', async () => {
      await controller.getAiMetrics('2026-11-01', '2026-11-17');
      const [from, to] = getMetrics().mock.calls[0];
      expect(iso(from)).toBe('2026-10-31T17:00:00.000Z');
      expect(iso(to)).toBe('2026-11-17T16:59:59.999Z');
    });

    it('from = to = วันนี้ ได้ช่วงเต็มวัน ไม่ใช่ช่วงที่เริ่มและจบ 07:00 น. เดียวกัน', async () => {
      await controller.getAiMetrics('2026-11-18', '2026-11-18');
      const [from, to] = getMetrics().mock.calls[0] as [Date, Date];
      expect(iso(from)).toBe('2026-11-17T17:00:00.000Z');
      expect(iso(to)).toBe('2026-11-18T16:59:59.999Z');
      expect(to.getTime() - from.getTime()).toBe(86_400_000 - 1);
    });

    it('ไม่ส่ง from/to = undefined ตามเดิม', async () => {
      await controller.getAiMetrics();
      expect(getMetrics()).toHaveBeenCalledWith(undefined, undefined);
    });

    it('ส่งแค่ from ได้ to เป็น undefined', async () => {
      await controller.getAiMetrics('2026-11-01');
      const [from, to] = getMetrics().mock.calls[0];
      expect(iso(from)).toBe('2026-10-31T17:00:00.000Z');
      expect(to).toBeUndefined();
    });
  });

  describe('GET /staff-chat/ai/status (B3 Task 13)', () => {
```


- [ ] **Step 2: รันให้เห็นว่าล้ม**

```
cd apps/api && NODE_OPTIONS=--max-old-space-size=8192 npx jest src/modules/staff-chat/staff-chat.controller.spec.ts -t "ai/metrics" --runInBand
```
คาดว่า: ล้ม 3 เคส (`Expected: "2026-10-31T17:00:00.000Z"  Received: "2026-11-01T00:00:00.000Z"`) · เคส "ไม่ส่ง from/to" ผ่านอยู่แล้ว

- [ ] **Step 3: แก้โค้ด**

เพิ่ม import ท้ายกลุ่ม import ของ `staff-chat.controller.ts`:

```ts
import { reportAsOf, reportDayStart } from '../../utils/date.util';
```

```ts
// before
    return this.aiMetrics.getMetrics(
      from ? new Date(from) : undefined,
      to ? new Date(to) : undefined,
    );
```
```ts
// after
    return this.aiMetrics.getMetrics(
      from ? reportDayStart(from) : undefined,
      to ? reportAsOf(to) : undefined,
    );
```

- [ ] **Step 4: รันให้ผ่าน**

```
cd apps/api && NODE_OPTIONS=--max-old-space-size=8192 npx jest src/modules/staff-chat/staff-chat.controller.spec.ts src/modules/staff-chat/services/ai-metrics.service.spec.ts --runInBand
```
คาดว่า: ทั้งสอง suite ผ่าน (เทสต์เดิมของ controller ไม่เปลี่ยนผล)

- [ ] **Step 5: Commit**

```
git add apps/api/src/modules/staff-chat/staff-chat.controller.ts apps/api/src/modules/staff-chat/staff-chat.controller.spec.ts
git commit -m "แก้ตัวชี้วัด AI ของแชทให้นับวันตามเวลาไทย

Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>"
```

---

### Task 4: ai-usage — breakdown · สรุป "วันนี้" · กราฟรายวัน · ตัวนับวันร่วมกับ cron งบ

**Files:**
- Modify: `apps/api/src/modules/ai-usage/ai-usage.service.ts` (`getSummary` บรรทัด 75-85 · `getDailyTrend` บรรทัด 212-240 · `buildDateRange` บรรทัด 281-293 · import)
- Modify: `apps/api/src/modules/ai-usage/ai-budget.cron.ts` (`checkDailyBudget` บรรทัด 29-30 · import)
- Modify (test): `apps/api/src/modules/ai-usage/ai-usage.admin.spec.ts` · `apps/api/src/modules/ai-usage/ai-budget.cron.spec.ts`

**Interfaces:**
- Consumes (จาก `../../utils/date.util`): `reportDayStart(value: string): Date` · `reportAsOf(value: string): Date` · `bangkokStartOfDay(now?: Date): Date` · `addBkkDays(date: Date, days: number): Date` · `bangkokDateString(now?: Date): string`
- Produces: ไม่มี (รูปคำตอบ `getSummary` / `getDailyTrend` / `getBreakdown` ไม่เปลี่ยน)

**วัน "วันนี้" ของ `ai-budget.cron.ts` นิยามอย่างไร (ตรวจแล้ว):** cron ใช้ `const start = new Date(); start.setHours(0, 0, 0, 0)` = เที่ยงคืนตามเวลาโปรเซส (`@Cron('10 * * * *', { timeZone: 'Asia/Bangkok' })` ตั้งเวลารันเป็นเวลาไทย แต่ขอบวันมาจาก TZ ของโปรเซส) ซึ่งเท่ากับเที่ยงคืนไทยก็ต่อเมื่อ `process.env.TZ = 'Asia/Bangkok'` (`app.setup.ts:20` `installRuntimeGlobals()` ตั้งให้ตอนบูต) ส่วน `getSummary` เดิมใช้ `setUTCHours(0,0,0,0)` = **07:00 น. ไทย** ⇒ ยอด "วันนี้" ของหน้าแอดมินไม่ตรงกับยอดที่ cron ใช้เตือนงบ และเรียกที่เกิด 00:00-06:59 น. ไทยหล่นเข้า "เมื่อวาน" · แก้ให้ทั้งสองที่เรียกฟังก์ชันเดียว `bangkokStartOfDay()` (ตรงกันโดยโครงสร้าง ไม่ขึ้นกับ TZ ของโปรเซส) — พฤติกรรมของ cron บน prod ไม่เปลี่ยน

- [ ] **Step 1: เขียนเทสต์ที่ต้องล้ม**

แก้ `ai-usage.admin.spec.ts`:

(ก) แทนเคสที่ปักบั๊ก — **เดิม** (บรรทัด 223-233):
```ts
    it('honors explicit from/to window', async () => {
      prisma.aiUsageLog.groupBy.mockResolvedValue([]);
      await service.getBreakdown({
        groupBy: 'service',
        from: '2026-03-01',
        to: '2026-03-31',
      });
      const call = prisma.aiUsageLog.groupBy.mock.calls[0][0];
      expect(call.where.createdAt.gte).toEqual(new Date('2026-03-01'));
      expect(call.where.createdAt.lte).toEqual(new Date('2026-03-31'));
    });
```
**ใหม่:**
```ts
    it('honors explicit from/to window เป็นวันตามปฏิทินไทย (00:00 น. วันเริ่ม — 23:59:59.999 น. วันสิ้นสุด)', async () => {
      prisma.aiUsageLog.groupBy.mockResolvedValue([]);
      await service.getBreakdown({
        groupBy: 'service',
        from: '2026-03-01',
        to: '2026-03-31',
      });
      const call = prisma.aiUsageLog.groupBy.mock.calls[0][0];
      expect(call.where.createdAt.gte.toISOString()).toBe('2026-02-28T17:00:00.000Z');
      expect(call.where.createdAt.lte.toISOString()).toBe('2026-03-31T16:59:59.999Z');
    });

    it('ขอบ: เรียก 00:00 น. ไทยของวันเริ่มอยู่ในช่วง · 00:00 น. ของวันถัดจากวันสิ้นสุดอยู่นอกช่วง', async () => {
      prisma.aiUsageLog.groupBy.mockResolvedValue([]);
      await service.getBreakdown({ groupBy: 'service', from: '2026-11-01', to: '2026-11-17' });
      const { gte, lte } = prisma.aiUsageLog.groupBy.mock.calls[0][0].where.createdAt;
      const firstInstant = new Date('2026-11-01T00:00:00+07:00').getTime();
      const nextDayMidnight = new Date('2026-11-18T00:00:00+07:00').getTime();
      expect(firstInstant >= gte.getTime() && firstInstant <= lte.getTime()).toBe(true);
      expect(nextDayMidnight <= lte.getTime()).toBe(false);
    });

    it('from/to ที่เป็น ISO เต็ม ใช้ตามเดิม', async () => {
      prisma.aiUsageLog.groupBy.mockResolvedValue([]);
      await service.getBreakdown({
        groupBy: 'service',
        from: '2026-03-01T03:00:00.000Z',
        to: '2026-03-31T10:00:00.000Z',
      });
      const call = prisma.aiUsageLog.groupBy.mock.calls[0][0];
      expect(call.where.createdAt.gte.toISOString()).toBe('2026-03-01T03:00:00.000Z');
      expect(call.where.createdAt.lte.toISOString()).toBe('2026-03-31T10:00:00.000Z');
    });
```

(ข) แทนเคสกราฟรายวันที่ปักการนับตาม UTC — **เดิม** (บรรทัด 245-259):
```ts
    it('sums rows into matching day bucket', async () => {
      const today = new Date();
      today.setUTCHours(10, 0, 0, 0);
      prisma.aiUsageLog.findMany.mockResolvedValue([
        { createdAt: today, costUsd: new Prisma.Decimal('1.5'), service: 'finance-ai' },
        { createdAt: today, costUsd: new Prisma.Decimal('0.25'), service: 'chatbot' },
      ]);

      const res = await service.getDailyTrend(3);
      const todayKey = today.toISOString().slice(0, 10);
      const bucket = res.find((r) => r.date === todayKey);
      expect(bucket).toBeDefined();
      expect(bucket!.costUsd).toBeCloseTo(1.75, 4);
      expect(bucket!.calls).toBe(2);
    });
```
**ใหม่** (ปักเวลา 2026-11-19 01:30 น. ไทย ให้ผลไม่ขึ้นกับเวลาที่รัน):
```ts
    it('sums rows into matching day bucket (วันไทย)', async () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-11-18T18:30:00.000Z')); // 2026-11-19 01:30 น. ไทย
      try {
        const sameDay = new Date('2026-11-18T10:00:00.000Z'); // 17:00 น. ไทยของวันที่ 18
        prisma.aiUsageLog.findMany.mockResolvedValue([
          { createdAt: sameDay, costUsd: new Prisma.Decimal('1.5'), service: 'finance-ai' },
          { createdAt: sameDay, costUsd: new Prisma.Decimal('0.25'), service: 'chatbot' },
        ]);

        const res = await service.getDailyTrend(3);
        const bucket = res.find((r) => r.date === '2026-11-18');
        expect(bucket).toBeDefined();
        expect(bucket!.costUsd).toBeCloseTo(1.75, 4);
        expect(bucket!.calls).toBe(2);
      } finally {
        jest.useRealTimers();
      }
    });
```

(ค) เพิ่ม describe ใหม่ **ก่อน** `  describe('getLogs', () => {`:
```ts
  describe('วันตามเวลาไทย — ปักเวลา 2026-11-19 01:30 น. ไทย (2026-11-18T18:30:00.000Z)', () => {
    beforeEach(() => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-11-18T18:30:00.000Z'));
    });
    afterEach(() => jest.useRealTimers());

    it('getSummary: "วันนี้" เริ่ม 00:00 น. ไทย · 7 วัน/30 วันนับจากเที่ยงคืนไทย (ตรงกับ ai-budget.cron)', async () => {
      prisma.aiUsageLog.aggregate.mockResolvedValue({
        _sum: { costUsd: null, inputTokens: null, outputTokens: null },
        _count: 0,
      });
      prisma.aiUsageLog.groupBy.mockResolvedValue([]);
      prisma.aiUsageLog.count.mockResolvedValue(0);

      await service.getSummary();

      const gte = (n: number): string =>
        prisma.aiUsageLog.aggregate.mock.calls[n][0].where.createdAt.gte.toISOString();
      expect(gte(0)).toBe('2026-11-18T17:00:00.000Z'); // วันนี้ = 19 พ.ย. 00:00 น. ไทย
      expect(gte(1)).toBe('2026-11-11T17:00:00.000Z'); // 7 วันก่อน
      expect(gte(2)).toBe('2026-10-19T17:00:00.000Z'); // 30 วันก่อน
      expect(prisma.aiUsageLog.groupBy.mock.calls[0][0].where.createdAt.gte.toISOString()).toBe(
        '2026-11-18T17:00:00.000Z',
      );
      expect(prisma.aiUsageLog.count.mock.calls[0][0].where.createdAt.gte.toISOString()).toBe(
        '2026-11-18T17:00:00.000Z',
      );
    });

    it('getDailyTrend: ช่วงเริ่ม 00:00 น. ไทย และป้ายวันเป็นวันไทย', async () => {
      prisma.aiUsageLog.findMany.mockResolvedValue([]);

      const res = await service.getDailyTrend(3);

      expect(prisma.aiUsageLog.findMany.mock.calls[0][0].where.createdAt.gte.toISOString()).toBe(
        '2026-11-16T17:00:00.000Z',
      );
      expect(res.map((r) => r.date)).toEqual(['2026-11-17', '2026-11-18', '2026-11-19']);
    });

    it('getDailyTrend: เรียก 00:30 น. ไทยนับเป็นวันใหม่ · 23:59:59.999 น. ไทยนับเป็นวันเดิม', async () => {
      prisma.aiUsageLog.findMany.mockResolvedValue([
        { createdAt: new Date('2026-11-18T17:30:00.000Z'), costUsd: new Prisma.Decimal('2'), service: 'a' }, // 19 พ.ย. 00:30 น.
        { createdAt: new Date('2026-11-18T16:59:59.999Z'), costUsd: new Prisma.Decimal('1'), service: 'a' }, // 18 พ.ย. 23:59:59.999 น.
      ]);

      const res = await service.getDailyTrend(3);

      expect(res.find((r) => r.date === '2026-11-19')).toMatchObject({ calls: 1, costUsd: 2 });
      expect(res.find((r) => r.date === '2026-11-18')).toMatchObject({ calls: 1, costUsd: 1 });
    });

    it('getBreakdown ไม่ส่ง from/to: ค่าเริ่มต้น = 30 วันก่อน ตั้งแต่ 00:00 น. ไทย', async () => {
      prisma.aiUsageLog.groupBy.mockResolvedValue([]);

      await service.getBreakdown({ groupBy: 'service' });

      expect(prisma.aiUsageLog.groupBy.mock.calls[0][0].where.createdAt.gte.toISOString()).toBe(
        '2026-10-19T17:00:00.000Z',
      );
    });
  });
```

แก้ `ai-budget.cron.spec.ts` — เพิ่มเคสนี้ **ก่อน** `  it('returns 0 breach when no usage', async () => {`:
```ts
  describe('ตัดวันตามเวลาไทย', () => {
    afterEach(() => jest.useRealTimers());

    it('นับยอดตั้งแต่ 00:00 น. ไทยของวันนี้ (ค่าเดียวกับ AiUsageService.getSummary — ไม่ขึ้นกับ TZ ของโปรเซส)', async () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-11-18T18:30:00.000Z')); // 2026-11-19 01:30 น. ไทย

      await cron.checkDailyBudget();

      expect(prisma.aiUsageLog.groupBy.mock.calls[0][0].where.createdAt.gte.toISOString()).toBe(
        '2026-11-18T17:00:00.000Z',
      );
    });
  });

```

- [ ] **Step 2: รันให้เห็นว่าล้ม**

```
cd apps/api && NODE_OPTIONS=--max-old-space-size=8192 npx jest src/modules/ai-usage/ai-usage.admin.spec.ts src/modules/ai-usage/ai-budget.cron.spec.ts --runInBand
```
คาดว่า: ล้ม — `honors explicit from/to window …` (`Expected: "2026-02-28T17:00:00.000Z"  Received: "2026-03-01T00:00:00.000Z"`) · เคสขอบ · `getSummary: "วันนี้" …` (`Expected: "2026-11-18T17:00:00.000Z"  Received: "2026-11-18T00:00:00.000Z"`) · `getDailyTrend: ช่วงเริ่ม …` · `getDailyTrend: เรียก 00:30 …` · `sums rows into matching day bucket (วันไทย)` (เดิมนับป้ายตาม UTC และเริ่มกราฟที่ UTC) · `getBreakdown ไม่ส่ง from/to …` · **เทสต์ของ cron ผ่านบนเครื่องที่ TZ=Asia/Bangkok อยู่แล้ว** (เป็นเทสต์กันถอยหลัง) — เห็นล้มได้เมื่อรันด้วย `TZ=UTC` (บางเครื่อง Windows ไม่เคารพ `TZ` ให้ข้ามการเห็นแดงของข้อนี้ได้)

- [ ] **Step 3: แก้โค้ด**

`ai-usage.service.ts` — เพิ่ม import ต่อจาก `import { computeCostUsd } from './ai-pricing';`:
```ts
import {
  addBkkDays,
  bangkokDateString,
  bangkokStartOfDay,
  reportAsOf,
  reportDayStart,
} from '../../utils/date.util';
```

`getSummary` (before → after):
```ts
// before
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);

    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000);
    sevenDaysAgo.setUTCHours(0, 0, 0, 0);

    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000);
    thirtyDaysAgo.setUTCHours(0, 0, 0, 0);
```
```ts
// after
    // เที่ยงคืนตามปฏิทินไทย — ฟังก์ชันเดียวกับ ai-budget.cron (ยอด "วันนี้" ต้องตรงกับยอดที่ cron ใช้เตือนงบ)
    const todayStart = bangkokStartOfDay();
    const sevenDaysAgo = addBkkDays(todayStart, -7);
    const thirtyDaysAgo = addBkkDays(todayStart, -30);
```

`getDailyTrend` (before → after):
```ts
// before
    const start = new Date();
    start.setUTCHours(0, 0, 0, 0);
    start.setUTCDate(start.getUTCDate() - (days - 1));

    const rows = await this.prisma.aiUsageLog.findMany({
      where: { createdAt: { gte: start } },
      select: { createdAt: true, costUsd: true, service: true },
    });

    const buckets = new Map<string, { date: string; costUsd: number; calls: number }>();
    for (let i = 0; i < days; i++) {
      const d = new Date(start);
      d.setUTCDate(d.getUTCDate() + i);
      const key = d.toISOString().slice(0, 10);
      buckets.set(key, { date: key, costUsd: 0, calls: 0 });
    }

    for (const row of rows) {
      const key = row.createdAt.toISOString().slice(0, 10);
```
```ts
// after
    const start = addBkkDays(bangkokStartOfDay(), -(days - 1));

    const rows = await this.prisma.aiUsageLog.findMany({
      where: { createdAt: { gte: start } },
      select: { createdAt: true, costUsd: true, service: true },
    });

    const buckets = new Map<string, { date: string; costUsd: number; calls: number }>();
    for (let i = 0; i < days; i++) {
      const key = bangkokDateString(addBkkDays(start, i));
      buckets.set(key, { date: key, costUsd: 0, calls: 0 });
    }

    for (const row of rows) {
      const key = bangkokDateString(row.createdAt);
```
(ส่วนที่เหลือของลูป `const bucket = buckets.get(key); if (bucket) {…}` ไม่เปลี่ยน)

`buildDateRange` (before → after):
```ts
// before
    if (from || to) {
      where.createdAt = {};
      if (from) (where.createdAt as Prisma.DateTimeFilter).gte = new Date(from);
      if (to) (where.createdAt as Prisma.DateTimeFilter).lte = new Date(to);
    } else {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000);
      thirtyDaysAgo.setHours(0, 0, 0, 0);
      where.createdAt = { gte: thirtyDaysAgo };
    }
```
```ts
// after
    if (from || to) {
      where.createdAt = {};
      if (from) (where.createdAt as Prisma.DateTimeFilter).gte = reportDayStart(from);
      if (to) (where.createdAt as Prisma.DateTimeFilter).lte = reportAsOf(to);
    } else {
      where.createdAt = { gte: addBkkDays(bangkokStartOfDay(), -30) };
    }
```

`ai-budget.cron.ts` — import ต่อจาก `import { PrismaService } from '../../prisma/prisma.service';`:
```ts
import { bangkokStartOfDay } from '../../utils/date.util';
```
```ts
// before
      const start = new Date();
      start.setHours(0, 0, 0, 0);
```
```ts
// after
      const start = bangkokStartOfDay();
```

- [ ] **Step 4: รันให้ผ่าน**

```
cd apps/api && NODE_OPTIONS=--max-old-space-size=8192 npx jest src/modules/ai-usage --runInBand
```
คาดว่า: ทุก suite ใน `ai-usage/` ผ่าน (admin · cron · service · pricing · provider · text)

- [ ] **Step 5: Commit**

```
git add apps/api/src/modules/ai-usage/ai-usage.service.ts apps/api/src/modules/ai-usage/ai-usage.admin.spec.ts apps/api/src/modules/ai-usage/ai-budget.cron.ts apps/api/src/modules/ai-usage/ai-budget.cron.spec.ts
git commit -m "แก้หน้า AI usage ให้นับวันตามเวลาไทย (สรุปวันนี้ · กราฟรายวัน · breakdown) และใช้ตัวนับวันเดียวกับ cron งบ

Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>"
```

---

### Task 5: audit — `GET /audit/logs`

**Files:**
- Modify: `apps/api/src/modules/audit/audit.service.ts` (`getAuditLogs` บรรทัด 287-292 · import)
- Create: `apps/api/src/modules/audit/audit.service.date-range.spec.ts` (ตั้งค่าเหมือน `audit.service.spec.ts`: `Test.createTestingModule({ providers: [AuditService, { provide: PrismaService, useValue: prisma }] })` + `jest.mock('@sentry/nestjs')`)

**Interfaces:**
- Consumes: `reportDayStart` · `reportAsOf` จาก `../../utils/date.util`
- Produces: ไม่มี

เว็บ `AuditLogsPage.tsx:169-170` ส่ง `from`/`to` เป็น `YYYY-MM-DD` — เลือก "วันนี้" ถึง "วันนี้" เดิมได้ช่วงศูนย์วินาที (`gte` = `lte` = 07:00 น.) จึงว่างเปล่า

- [ ] **Step 1: เขียนเทสต์ที่ต้องล้ม**

สร้าง `apps/api/src/modules/audit/audit.service.date-range.spec.ts`:

```ts
import { Test, TestingModule } from '@nestjs/testing';
import { AuditService } from './audit.service';
import { PrismaService } from '../../prisma/prisma.service';

jest.mock('@sentry/nestjs');

/**
 * GET /audit/logs?from&to รับ 'YYYY-MM-DD' = วันตามปฏิทินไทย (2026-11-18)
 * เดิม new Date('YYYY-MM-DD') = 07:00 น. ไทย ⇒ from = to = วันนี้ ได้ช่วงศูนย์วินาที (ผลว่างเปล่า)
 * และ log 00:00–06:59 น. ของวันเริ่ม / หลัง 07:00 น. ของวันสิ้นสุดหาย
 */
describe('AuditService.getAuditLogs — ช่วงวันที่ตามเวลาไทย', () => {
  let service: AuditService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      auditLog: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
    };
    const mod: TestingModule = await Test.createTestingModule({
      providers: [AuditService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = mod.get(AuditService);
  });

  const createdAtOf = () => prisma.auditLog.findMany.mock.calls[0][0].where.createdAt;

  it('from = to = วันนี้ ได้ช่วงเต็มวันไทย ไม่ใช่ช่วงศูนย์วินาที', async () => {
    await service.getAuditLogs({ from: '2026-11-18', to: '2026-11-18' });
    const { gte, lte } = createdAtOf();
    expect(gte.toISOString()).toBe('2026-11-17T17:00:00.000Z');
    expect(lte.toISOString()).toBe('2026-11-18T16:59:59.999Z');
    expect(lte.getTime()).toBeGreaterThan(gte.getTime());
  });

  it('ช่วงหลายวัน: 00:00 น. วันเริ่ม ถึง 23:59:59.999 น. วันสิ้นสุด (เวลาไทย)', async () => {
    await service.getAuditLogs({ from: '2026-11-01', to: '2026-11-17' });
    const { gte, lte } = createdAtOf();
    expect(gte.toISOString()).toBe('2026-10-31T17:00:00.000Z');
    expect(lte.toISOString()).toBe('2026-11-17T16:59:59.999Z');
  });

  it('ขอบ: log 00:00 น. ไทยของวันเริ่มอยู่ในช่วง · 00:00 น. ของวันถัดจากวันสิ้นสุดอยู่นอกช่วง', async () => {
    await service.getAuditLogs({ from: '2026-11-01', to: '2026-11-17' });
    const { gte, lte } = createdAtOf();
    const firstInstant = new Date('2026-11-01T00:00:00+07:00').getTime();
    const nextDayMidnight = new Date('2026-11-18T00:00:00+07:00').getTime();
    expect(firstInstant >= gte.getTime() && firstInstant <= lte.getTime()).toBe(true);
    expect(nextDayMidnight <= lte.getTime()).toBe(false);
  });

  it('ส่งแค่ from หรือแค่ to ได้ขอบข้างเดียว', async () => {
    await service.getAuditLogs({ from: '2026-11-01' });
    expect(Object.keys(createdAtOf())).toEqual(['gte']);

    prisma.auditLog.findMany.mockClear();
    await service.getAuditLogs({ to: '2026-11-17' });
    expect(Object.keys(createdAtOf())).toEqual(['lte']);
  });

  it('ค่า ISO เต็ม (ไม่ใช่ YYYY-MM-DD) ใช้ตามเดิม', async () => {
    await service.getAuditLogs({ from: '2026-11-17T03:00:00.000Z', to: '2026-11-17T10:00:00.000Z' });
    const { gte, lte } = createdAtOf();
    expect(gte.toISOString()).toBe('2026-11-17T03:00:00.000Z');
    expect(lte.toISOString()).toBe('2026-11-17T10:00:00.000Z');
  });

  it('ไม่ส่งวันที่ = ไม่มีเงื่อนไข createdAt ตามเดิม · count ใช้ where เดียวกับ findMany', async () => {
    await service.getAuditLogs({});
    expect(prisma.auditLog.findMany.mock.calls[0][0].where.createdAt).toBeUndefined();

    prisma.auditLog.findMany.mockClear();
    await service.getAuditLogs({ from: '2026-11-18', to: '2026-11-18' });
    expect(prisma.auditLog.count.mock.calls[1][0].where).toEqual(
      prisma.auditLog.findMany.mock.calls[0][0].where,
    );
  });
});
```

- [ ] **Step 2: รันให้เห็นว่าล้ม**

```
cd apps/api && NODE_OPTIONS=--max-old-space-size=8192 npx jest src/modules/audit/audit.service.date-range.spec.ts --runInBand
```
คาดว่า: ล้ม 3 เคสแรก (`Expected: "2026-11-17T17:00:00.000Z"  Received: "2026-11-18T00:00:00.000Z"` · เคส `toBeGreaterThan` = `Expected: > 1763424000000  Received: 1763424000000`) · เคสที่เหลือผ่านอยู่แล้ว

- [ ] **Step 3: แก้โค้ด**

เพิ่ม import ต่อจาก `import { sanitizeAuditValue } from './audit-sanitize.util';`:
```ts
import { reportAsOf, reportDayStart } from '../../utils/date.util';
```

```ts
// before
      where.createdAt = {
        ...(filters.from ? { gte: new Date(filters.from) } : {}),
        ...(filters.to ? { lte: new Date(filters.to) } : {}),
      };
```
```ts
// after
      where.createdAt = {
        ...(filters.from ? { gte: reportDayStart(filters.from) } : {}),
        ...(filters.to ? { lte: reportAsOf(filters.to) } : {}),
      };
```

- [ ] **Step 4: รันให้ผ่าน**

```
cd apps/api && NODE_OPTIONS=--max-old-space-size=8192 npx jest src/modules/audit --runInBand
```
คาดว่า: ทุก suite ใน `audit/` ผ่าน

- [ ] **Step 5: Commit**

```
git add apps/api/src/modules/audit/audit.service.ts apps/api/src/modules/audit/audit.service.date-range.spec.ts
git commit -m "แก้หน้า Audit log ให้กรองช่วงวันที่ตามเวลาไทย (เลือกวันเดียวไม่ว่างอีก)

Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>"
```

---

### Task 6: หลักฐานสลิป — `GET /line-oa/evidence?dateFrom&dateTo`

**Files:**
- Modify: `apps/api/src/modules/line-oa/services/payment-evidence.service.ts` (`getEvidenceList` บรรทัด 69-77 · import)
- Modify (test): `apps/api/src/modules/line-oa/line-oa-payment.controller.spec.ts` (เคส `builds dynamic where …` บรรทัด ~190-206 + เคสใหม่ใน `describe('getEvidenceList')`)

**Interfaces:**
- Consumes: `reportDayStart` · `reportDayEnd` จาก `../../../utils/date.util`
- Produces: ไม่มี

ขอบเริ่มเดิมเป็น 07:00 น. ไทย (สลิปที่เข้า 00:00-06:59 น. ของวันเริ่มหาย) · ขอบสิ้นสุดเดิม `new Date(dateTo).setHours(23,59,59,999)` ถูกเฉพาะเมื่อโปรเซสรันเขต Asia/Bangkok — เปลี่ยนทั้งสองขอบเป็นตัวช่วยตัวเดียว

- [ ] **Step 1: เขียนเทสต์ที่ต้องล้ม**

ใน `line-oa-payment.controller.spec.ts` แทนท่อนที่ปักบั๊ก — **เดิม**:
```ts
      expect(arg.where.createdAt.gte).toEqual(new Date('2026-01-01'));
      const expectedEnd = new Date('2026-01-31');
      expectedEnd.setHours(23, 59, 59, 999);
      expect(arg.where.createdAt.lte).toEqual(expectedEnd);
```
**ใหม่:**
```ts
      expect(arg.where.createdAt.gte.toISOString()).toBe('2025-12-31T17:00:00.000Z');
      expect(arg.where.createdAt.lte.toISOString()).toBe('2026-01-31T16:59:59.999Z');
```

และเพิ่มสองเคสนี้ต่อท้ายใน `describe('getEvidenceList', …)` (ก่อนเคส `signs S3 keys via getSignedDownloadUrl …`):
```ts
    it('dateFrom = dateTo = วันเดียว ได้ช่วงเต็มวันไทย (00:00:00.000 – 23:59:59.999 น.)', async () => {
      prisma.paymentEvidence.findMany.mockResolvedValue([]);

      await controller.getEvidenceList(undefined, undefined, '2026-11-18', '2026-11-18');

      const { gte, lte } = prisma.paymentEvidence.findMany.mock.calls[0][0].where.createdAt;
      expect(gte.toISOString()).toBe('2026-11-17T17:00:00.000Z');
      expect(lte.toISOString()).toBe('2026-11-18T16:59:59.999Z');
    });

    it('ขอบ: สลิป 00:00 น. ไทยของวันเริ่มอยู่ในช่วง · 00:00 น. ของวันถัดจากวันสิ้นสุดอยู่นอกช่วง', async () => {
      prisma.paymentEvidence.findMany.mockResolvedValue([]);

      await controller.getEvidenceList(undefined, undefined, '2026-11-01', '2026-11-17');

      const { gte, lte } = prisma.paymentEvidence.findMany.mock.calls[0][0].where.createdAt;
      const firstInstant = new Date('2026-11-01T00:00:00+07:00').getTime();
      const nextDayMidnight = new Date('2026-11-18T00:00:00+07:00').getTime();
      expect(firstInstant >= gte.getTime() && firstInstant <= lte.getTime()).toBe(true);
      expect(nextDayMidnight <= lte.getTime()).toBe(false);
    });

    it('ส่งแค่ dateFrom ได้ขอบเริ่มอย่างเดียว · ส่งแค่ dateTo ได้ขอบสิ้นสุดอย่างเดียว', async () => {
      prisma.paymentEvidence.findMany.mockResolvedValue([]);

      await controller.getEvidenceList(undefined, undefined, '2026-11-01');
      expect(Object.keys(prisma.paymentEvidence.findMany.mock.calls[0][0].where.createdAt)).toEqual(['gte']);

      prisma.paymentEvidence.findMany.mockClear();
      await controller.getEvidenceList(undefined, undefined, undefined, '2026-11-17');
      expect(Object.keys(prisma.paymentEvidence.findMany.mock.calls[0][0].where.createdAt)).toEqual(['lte']);
    });
```
(ค่าที่ไม่ใช่ `YYYY-MM-DD` ของ `dateTo` ได้พฤติกรรมเดิมจาก `reportDayEnd` — ตัวช่วยมีเทสต์ของตัวเองใน `date.util.report-day.spec.ts` แล้ว ไม่เทสต์ซ้ำเพราะผลขึ้นกับ TZ ของโปรเซส)

- [ ] **Step 2: รันให้เห็นว่าล้ม**

```
cd apps/api && NODE_OPTIONS=--max-old-space-size=8192 npx jest src/modules/line-oa/line-oa-payment.controller.spec.ts -t "getEvidenceList" --runInBand
```
คาดว่า: ล้ม 3 เคส — `builds dynamic where …` (`Expected: "2025-12-31T17:00:00.000Z"  Received: "2026-01-01T00:00:00.000Z"`) · วันเดียว · ขอบ · เคส "ส่งแค่ …" ผ่านอยู่แล้ว

- [ ] **Step 3: แก้โค้ด**

เพิ่ม import ต่อจาก `import { formatDateShort } from '../../../utils/thai-date.util';`:
```ts
import { reportDayEnd, reportDayStart } from '../../../utils/date.util';
```

```ts
// before
    if (dateFrom || dateTo) {
      const dateFilter: Record<string, Date> = {};
      if (dateFrom) dateFilter.gte = new Date(dateFrom);
      if (dateTo) {
        const end = new Date(dateTo);
        end.setHours(23, 59, 59, 999);
        dateFilter.lte = end;
      }
      where.createdAt = dateFilter;
    }
```
```ts
// after
    if (dateFrom || dateTo) {
      const dateFilter: Record<string, Date> = {};
      if (dateFrom) dateFilter.gte = reportDayStart(dateFrom);
      if (dateTo) dateFilter.lte = reportDayEnd(dateTo);
      where.createdAt = dateFilter;
    }
```
(`getEvidenceStats` ที่ใช้ `todayStart.setHours(0,0,0,0)` ไม่แตะ — ไม่มีสตริงจากผู้ใช้ ดู "ตรวจแล้วไม่ต้องแก้")

- [ ] **Step 4: รันให้ผ่าน**

```
cd apps/api && NODE_OPTIONS=--max-old-space-size=8192 npx jest src/modules/line-oa/line-oa-payment.controller.spec.ts --runInBand
```
คาดว่า: ผ่านทั้งไฟล์

- [ ] **Step 5: Commit**

```
git add apps/api/src/modules/line-oa/services/payment-evidence.service.ts apps/api/src/modules/line-oa/line-oa-payment.controller.spec.ts
git commit -m "แก้หน้าตรวจสลิปให้กรองช่วงวันที่ตามเวลาไทยทั้งสองขอบ (ไม่พึ่ง TZ ของโปรเซส)

Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>"
```

---

### Task 7: imported-sales — ช่วงวันที่ + เดือนในสรุป

**Files:**
- Modify: `apps/api/src/modules/imported-sales/imported-sales.service.ts` (`buildWhere` บรรทัด 21-24 · `monthKey` ใน `summary` บรรทัด 79-82 · import)
- Modify (test): `apps/api/src/modules/imported-sales/__tests__/imported-sales.service.spec.ts` (เพิ่มเคสท้าย describe)

**Interfaces:**
- Consumes: `reportDayStart` · `reportAsOf` · `bkkYearMonth(date: Date): string` จาก `../../utils/date.util`
- Produces: ไม่มี

`GET /imported-sales` และ `/imported-sales/summary` (OWNER · ACCOUNTANT · FINANCE_MANAGER) รับ `startDate`/`endDate` (`@IsDateString` — รับทั้งวันที่ล้วนและ ISO) ตัวเขียน `tooltify-sales-parser.ts:27-29` ลง `soldAt` เป็น instant ที่มี `+07:00` จึงมีรายการที่เวลา 00:00-06:59 น. ไทยจริง ๆ · เว็บ `ImportedSalesPage.tsx` ยังไม่ส่งวันที่ (แฝง) · ส่วน `byMonth` เดิมจัดกลุ่มด้วยเดือน UTC — รายการที่ขาย 00:00-06:59 น. ของวันที่ 1 ตกเดือนก่อน ซึ่งขัดกับตัวกรองใหม่ที่นับวันไทย จึงแก้ในงานเดียวกัน (ดูข้อ 1 ใน "ต้องให้เจ้าของตัดสิน")

- [ ] **Step 1: เขียนเทสต์ที่ต้องล้ม**

เพิ่มสามเคสนี้ท้าย `describe('ImportedSalesService', …)` ใน `__tests__/imported-sales.service.spec.ts` (ก่อน `});` สุดท้าย — แบบ mock เดียวกับเคส `list()` เดิม):

```ts
  it('list(): startDate/endDate เป็นวันตามปฏิทินไทย — เริ่ม 00:00 น. · สิ้นสุด 23:59:59.999 น.', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const count = jest.fn().mockResolvedValue(0);
    const prisma = {
      $transaction: (ops: unknown[]) => Promise.all(ops as Promise<unknown>[]),
      importedSale: { findMany, count },
    } as never;
    const svc = new ImportedSalesService(prisma);
    const q = Object.assign(new QueryImportedSalesDto(), {
      startDate: '2026-08-01',
      endDate: '2026-08-31',
    });

    await svc.list(q);

    const { gte, lte } = findMany.mock.calls[0][0].where.soldAt;
    expect(gte.toISOString()).toBe('2026-07-31T17:00:00.000Z');
    expect(lte.toISOString()).toBe('2026-08-31T16:59:59.999Z');
    // ขอบ: ขาย 00:00 น. ไทยของวันที่ 1 อยู่ในช่วง · 00:00 น. ของวันที่ 1 เดือนถัดไปอยู่นอกช่วง
    const first = new Date('2026-08-01T00:00:00+07:00').getTime();
    const next = new Date('2026-09-01T00:00:00+07:00').getTime();
    expect(first >= gte.getTime() && first <= lte.getTime()).toBe(true);
    expect(next <= lte.getTime()).toBe(false);
  });

  it('summary(): ใช้ช่วงวันที่ชุดเดียวกับ list()', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = { importedSale: { findMany } } as never;
    const svc = new ImportedSalesService(prisma);

    await svc.summary(
      Object.assign(new QueryImportedSalesDto(), { startDate: '2026-08-01', endDate: '2026-08-31' }),
    );

    const { gte, lte } = findMany.mock.calls[0][0].where.soldAt;
    expect(gte.toISOString()).toBe('2026-07-31T17:00:00.000Z');
    expect(lte.toISOString()).toBe('2026-08-31T16:59:59.999Z');
  });

  it('summary(): byMonth นับเดือนตามปฏิทินไทย — ขาย 00:30 น. ของวันที่ 1 อยู่เดือนใหม่', async () => {
    const rows = [
      mkRow({ soldAt: new Date('2026-08-31T17:30:00.000Z') }), // 2026-09-01 00:30 น. ไทย
      mkRow({ soldAt: new Date('2026-08-31T16:59:59.999Z') }), // 2026-08-31 23:59:59.999 น. ไทย
    ];
    const prisma = { importedSale: { findMany: jest.fn().mockResolvedValue(rows) } } as never;
    const svc = new ImportedSalesService(prisma);

    const res = await svc.summary(new QueryImportedSalesDto());

    expect(res.byMonth.map((b) => [b.key, b.count])).toEqual([
      ['2026-08', 1],
      ['2026-09', 1],
    ]);
  });
```

- [ ] **Step 2: รันให้เห็นว่าล้ม**

```
cd apps/api && NODE_OPTIONS=--max-old-space-size=8192 npx jest src/modules/imported-sales/__tests__/imported-sales.service.spec.ts --runInBand
```
คาดว่า: ล้ม 3 เคสใหม่ (`Expected: "2026-07-31T17:00:00.000Z"  Received: "2026-08-01T00:00:00.000Z"` · byMonth ได้ `[['2026-08', 2]]`) · เคสเดิม 2 เคสผ่าน

- [ ] **Step 3: แก้โค้ด**

เพิ่ม import ต่อจาก `import { QueryImportedSalesDto } from './dto/query-imported-sales.dto';`:
```ts
import { bkkYearMonth, reportAsOf, reportDayStart } from '../../utils/date.util';
```

`buildWhere` (before → after):
```ts
// before
      if (q.startDate) where.soldAt.gte = new Date(q.startDate);
      if (q.endDate) where.soldAt.lte = new Date(q.endDate);
```
```ts
// after
      if (q.startDate) where.soldAt.gte = reportDayStart(q.startDate);
      if (q.endDate) where.soldAt.lte = reportAsOf(q.endDate);
```

`summary` (before → after):
```ts
// before
    const monthKey = (r: (typeof rows)[number]) => {
      const d = r.soldAt;
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    };
```
```ts
// after
    const monthKey = (r: (typeof rows)[number]) => bkkYearMonth(r.soldAt);
```

- [ ] **Step 4: รันให้ผ่าน**

```
cd apps/api && NODE_OPTIONS=--max-old-space-size=8192 npx jest src/modules/imported-sales --runInBand
```
คาดว่า: ทุก suite ใน `imported-sales/` ผ่าน (parser · xlsx ไม่เกี่ยว)

- [ ] **Step 5: Commit**

```
git add apps/api/src/modules/imported-sales/imported-sales.service.ts apps/api/src/modules/imported-sales/__tests__/imported-sales.service.spec.ts
git commit -m "แก้ยอดขายนำเข้าให้กรองช่วงวันที่และสรุปรายเดือนตามเวลาไทย

Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>"
```

---

### Task 8: ตัวกันถอยหลัง — `date-string-day-bounds.guard.spec.ts`

**ลำดับ:** task นี้รัน **หลังแผน ก (บัญชี/การเงิน) และแผน ข (รายงาน/ปฏิบัติการ) ถูก merge เข้า `fix/bangkok-day-bounds` แล้ว** และหลัง Task 1-7 ของแผนนี้ — ถ้ายังไม่ merge ครบ เทสต์จะแดงด้วยจุดของแผนอื่น (ซึ่งเป็นสิ่งที่ตั้งใจ ใช้เป็นเช็กลิสต์ได้)

**Files:**
- Create: `apps/api/src/utils/date-string-day-bounds.guard.spec.ts`

**Interfaces:**
- Consumes: ไม่มี (อ่านไฟล์ซอร์ส `apps/api/src/**/*.ts` ผ่าน `node:fs`)
- Produces: ไม่มี (เป็นเทสต์ล้วน — ไม่มีโค้ด production)

**แบบที่ mirror:** `apps/api/src/modules/line-oa/services/line-id-finance-readers.spec.ts` — เดินไฟล์ด้วย `readdirSync`/`statSync` · ข้าม `*.spec.ts` และ `__tests__/` · ตัดคอมเมนต์ก่อนค้น (ฟังก์ชัน `code()` — เวอร์ชันนี้คงจำนวนบรรทัดไว้เพื่อรายงานเลขบรรทัด) · รายการ `ALLOWED: Record<string, string>` คีย์ = พาธนับจาก `src/` · มีเทสต์ "ตัวค้นจับได้จริง" และเทสต์ "รายการที่อนุญาตไม่ค้าง" ต่างจากแบบเดิมสามข้อ: (1) ข้ามโฟลเดอร์ `src/cli` และ `utils/date.util.ts` (2) คีย์แบบ `path.ts#<ข้อความในบรรทัด>` อนุญาตเฉพาะบรรทัดที่มีข้อความนั้น (ไฟล์ที่มีทั้งการใช้ที่ถูกและต้องห้าม) (3) รายงานเป็น `ไฟล์:บรรทัด [กฎ] ข้อความ` พร้อมคำแนะนำวิธีแก้

**สิ่งที่สแกน (3 กฎ):**

| กฎ | จับอะไร | ทำไมผิด |
|---|---|---|
| `RAW_PARSE` | `new Date(<ชื่อ>)` เมื่อชื่อ (มีหรือไม่มีคำนำหน้า `dto.` `query.` `q.` `filters.` `filter.` `params.` `opts.` `options.` `input.`) เป็น `start` `end` `from` `to` `since` `until` `asOf` `asOfDate` `periodStart` `periodEnd` `startDate` `endDate` `dateFrom` `dateTo` `fromDate` `toDate` `dueFrom` `dueTo` `date` (ยอมให้มี `!` ต่อท้ายชื่อ) | สตริง `YYYY-MM-DD` ที่แปลงตรง ๆ = เที่ยงคืน UTC = 07:00 น. ไทย |
| `TEMPLATE_NO_OFFSET` | ``new Date(`${x}T00:00:00`)`` / `T23:59:59` (มี `.mmm` หรือไม่ก็ได้) ที่ **จบด้วยเครื่องหมาย backtick ทันที** คือไม่มี `+07:00` / `Z` | ไม่มี offset = ตามโซนของโปรเซส ถูกเฉพาะเมื่อ `TZ=Asia/Bangkok` |
| `UTC_MIDNIGHT` | `.setUTCHours(0, 0, 0, 0)` | เที่ยงคืน UTC = 07:00 น. ไทย — ใช้กับ "วันนี้" ทำให้วันไทยเริ่มช้า 7 ชั่วโมง |

(เพิ่ม `input.` จากที่ brief ระบุ เพราะ sweep ของ audit พบ `chat-analytics-v2.service.ts` ใช้ `input.from`/`input.to` — ใส่รายการอนุญาตไว้พร้อมเหตุผลแล้ว · กฎ `UTC_MIDNIGHT` ตรวจทุกการเรียกที่เป็น `(0, 0, 0, 0)` เพราะแยก "ค่าวันนี้" ออกจากค่าอื่นด้วย regex ไม่ได้อย่างน่าเชื่อถือ — หลังแผนนี้ไม่มีการเรียกแบบนี้เหลือใน `src` เลย (มีแต่ใน `ai-usage.service.ts` ที่ Task 4 ลบไปแล้ว) จึงไม่มีรายการอนุญาตของกฎนี้)

- [ ] **Step 1: เขียนเทสต์** (เทสต์ตัวนี้เป็น "เทสต์ที่ต้องล้มจนกว่ารายการอนุญาตจะตรงกับความจริง" — ไม่มีโค้ด production ให้แก้ จึงไม่มี "Step 3 แก้โค้ด")

สร้าง `apps/api/src/utils/date-string-day-bounds.guard.spec.ts`:

```ts
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/**
 * ตัวกันถอยหลังของบั๊ก "สตริงวันที่ YYYY-MM-DD ถูกแปลงเป็น 07:00 น. ไทย" (2026-11-18)
 *
 * new Date('2026-11-01') = เที่ยงคืน UTC = 07:00 น. ไทย ⇒ ใช้เป็นขอบเริ่มของคอลัมน์ timestamp แล้วรายการ
 * 00:00–06:59 น. ของวันเริ่มหาย (รวมรายการตั้งลูกหนี้งวดที่ลงเที่ยงคืนไทยพอดี) · ใช้เป็นขอบสิ้นสุด/ณ วันที่
 * แล้วทุกอย่างหลัง 07:00 น. ของวันนั้นหาย · setHours(23,59,59,999) ถูกเฉพาะเมื่อ TZ ของโปรเซสเป็น Asia/Bangkok
 *
 * ทางที่ถูก: ตัวช่วยใน utils/date.util.ts — reportDayStart / reportDayEnd / reportAsOf / bangkokDateRange
 * (วันที่ 'YYYY-MM-DD' = วันตามปฏิทินไทย ไม่ขึ้นกับ TZ ของโปรเซส)
 *
 * เทสต์นี้สแกน apps/api/src/**\/*.ts (ไม่นับ *.spec.ts · __tests__/ · src/cli/ · utils/date.util.ts · คอมเมนต์)
 * หาสามรูปแบบ (RULES ข้างล่าง) ที่ต้องอยู่ใน ALLOWED พร้อมเหตุผลบรรทัดเดียว — เพิ่มรายการ = อธิบายในรีวิวว่าทำไม
 * ไม่ใช้ตัวช่วย · คีย์ = พาธนับจาก src/ หรือ `พาธ#ข้อความที่อยู่ในบรรทัดนั้น` (ไฟล์ที่มีทั้งการใช้ที่ถูกและต้องห้าม)
 * รายการที่ไม่ตรงกับอะไรแล้ว (stale) ทำให้เทสต์แดง — ลบออกเมื่อแก้โค้ดจุดนั้นแล้ว
 *
 * ดูรายการที่เหลือทั้งหมดโดยไม่ต้องแก้ไฟล์: DATE_GUARD_LIST=1 npx jest src/utils/date-string-day-bounds.guard.spec.ts
 */
const ALLOWED: Record<string, string> = {
  'modules/chat-engine/services/room-manager.service.ts#gte: new Date(from)':
    'from/to เป็นเวลา epoch มิลลิวินาที (ตัวเลข) ไม่ใช่สตริงวันที่',
  'modules/chat-analytics/chat-analytics-v2.service.ts':
    'DTO บังคับ ISO ที่มี Z/offset ก่อนใช้ (regex บรรทัด 58) — ไม่ใช่วันที่ล้วน',
  'modules/employee-access/access-defect-boundaries.ts#new Date(q.from) > new Date(q.to)':
    'เทียบลำดับ from > to เพื่อตรวจ input เท่านั้น ไม่ได้ใช้เป็นขอบของ query',
  'modules/reporting/reporting.controller.ts':
    'เว็บส่ง ISO instant เต็มจาก toISOString() โดยสัญญา (PdfExportButton) ไม่ใช่วันที่ล้วน',
  'modules/sso-config/sso-config.controller.ts':
    'เทียบกับคอลัมน์ effectiveFrom/effectiveTo ที่เป็น @db.Date (วันที่ล้วน) — ไม่อยู่ในขอบเขต',
  'modules/users/users.service.ts#dto.startDate ? new Date(dto.startDate) : null':
    'เขียนวันเริ่มงานลงคอลัมน์ ไม่ใช่การกรอง',
  'modules/staff-chat/services/canned-response-variable.service.ts#date instanceof Date ? date : new Date(date)':
    'จัดรูปวันที่เพื่อแสดงผล (พ.ศ.) ไม่ใช่การกรอง',
  'modules/accounting/general-ledger-report.service.ts#const startMinusOne = new Date(periodStart)':
    'คัดลอก Date ที่ผู้เรียกแปลงด้วยตัวช่วยมาแล้ว แล้วลบ 1 มิลลิวินาที ไม่ได้แปลงสตริง',
};

/** พาธ src/ — ไฟล์นี้อยู่ที่ src/utils/ */
const SRC = join(__dirname, '..');

const WATCHED_NAMES = [
  'start',
  'end',
  'from',
  'to',
  'since',
  'until',
  'asOf',
  'asOfDate',
  'periodStart',
  'periodEnd',
  'startDate',
  'endDate',
  'dateFrom',
  'dateTo',
  'fromDate',
  'toDate',
  'dueFrom',
  'dueTo',
  'date',
];
const WATCHED_PREFIXES = ['dto', 'query', 'q', 'filters', 'filter', 'params', 'opts', 'options', 'input'];

interface Rule {
  id: 'RAW_PARSE' | 'TEMPLATE_NO_OFFSET' | 'UTC_MIDNIGHT';
  re: RegExp;
  hint: string;
}

const RULES: Rule[] = [
  {
    id: 'RAW_PARSE',
    re: new RegExp(
      `new Date\\(\\s*(?:(?:${WATCHED_PREFIXES.join('|')})\\.)?(?:${WATCHED_NAMES.join('|')})\\s*!?\\s*\\)`,
    ),
    hint: "ใช้ reportDayStart (ขอบเริ่ม) / reportAsOf (ขอบสิ้นสุดหรือ ณ วันที่) / reportDayEnd / bangkokDateRange จาก utils/date.util",
  },
  {
    id: 'TEMPLATE_NO_OFFSET',
    re: /new Date\(\s*`\$\{[^}]+\}T(?:00:00(?::00)?|23:59(?::59)?)(?:\.\d{1,3})?`\s*\)/,
    hint: 'ใส่ +07:00 หรือใช้ reportDayStart/reportDayEnd แทน — ไม่มี offset = ตามโซนของโปรเซส',
  },
  {
    id: 'UTC_MIDNIGHT',
    re: /\.setUTCHours\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\)/,
    hint: 'เที่ยงคืน UTC = 07:00 น. ไทย — ใช้ bangkokStartOfDay() / bangkokMidnight()',
  },
];

interface Offender {
  file: string;
  line: number;
  rule: Rule['id'];
  text: string;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === '__tests__') continue;
      if (relative(SRC, full) === 'cli') continue;
      walk(full, out);
    } else if (name.endsWith('.ts') && !name.endsWith('.spec.ts') && !name.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}

/** ตัดคอมเมนต์ออกก่อนค้น โดยคงจำนวนบรรทัดไว้ (เพื่อรายงานเลขบรรทัดถูก) */
function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

function collectOffenders(): Offender[] {
  const out: Offender[] = [];
  for (const full of walk(SRC)) {
    const file = relative(SRC, full).split(sep).join('/');
    if (file === 'utils/date.util.ts') continue;
    code(readFileSync(full, 'utf8'))
      .split('\n')
      .forEach((text, index) => {
        for (const rule of RULES) {
          if (rule.re.test(text)) out.push({ file, line: index + 1, rule: rule.id, text: text.trim() });
        }
      });
  }
  return out;
}

/** คีย์ใน ALLOWED ที่ครอบ offender นี้ (ทั้งไฟล์ หรือเฉพาะบรรทัดที่มีข้อความตามคีย์ `พาธ#ข้อความ`) */
function allowKeyFor(offender: Offender): string | undefined {
  if (offender.file in ALLOWED) return offender.file;
  return Object.keys(ALLOWED).find((key) => {
    const hash = key.indexOf('#');
    return hash > 0 && key.slice(0, hash) === offender.file && offender.text.includes(key.slice(hash + 1));
  });
}

const flaggedRules = (line: string): string[] =>
  RULES.filter((rule) => rule.re.test(code(line))).map((rule) => rule.id);

describe('ตัวกันถอยหลัง: สตริงวันที่ YYYY-MM-DD ห้ามแปลงเป็น 07:00 น. ไทย', () => {
  const offenders = collectOffenders();

  it('ทุกจุดที่แปลงวันที่แบบดิบต้องอยู่ใน ALLOWED พร้อมเหตุผล — ไม่ก็ใช้ตัวช่วยใน utils/date.util', () => {
    if (process.env.DATE_GUARD_LIST) {
      const lines = offenders.map((o) => {
        const key = allowKeyFor(o);
        return `${key ? 'ALLOWED' : 'OFFENDER'}  ${o.file}:${o.line} [${o.rule}] ${o.text}`;
      });
      // eslint-disable-next-line no-console
      console.log(`\n${lines.join('\n')}\n(${offenders.length} บรรทัดใน ${new Set(offenders.map((o) => o.file)).size} ไฟล์)`);
    }
    const hintOf = (id: Rule['id']) => RULES.find((rule) => rule.id === id)!.hint;
    const report = offenders
      .filter((o) => !allowKeyFor(o))
      .map((o) => `${o.file}:${o.line} [${o.rule}] ${o.text}  ⇒ ${hintOf(o.rule)}`);
    expect(report).toEqual([]);
  });

  it('รายการ ALLOWED ไม่ค้าง (คีย์ที่ไม่ตรงกับบรรทัดใดแล้วต้องลบออก)', () => {
    const used = new Set(offenders.map(allowKeyFor).filter((key): key is string => !!key));
    const stale = Object.keys(ALLOWED).filter((key) => !used.has(key));
    expect(stale).toEqual([]);
  });

  it('ทุกรายการใน ALLOWED มีเหตุผลและพาธชี้ไปไฟล์ที่มีอยู่จริง', () => {
    for (const [key, reason] of Object.entries(ALLOWED)) {
      expect(reason.trim().length).toBeGreaterThanOrEqual(10);
      const file = key.includes('#') ? key.slice(0, key.indexOf('#')) : key;
      expect(() => readFileSync(join(SRC, file), 'utf8')).not.toThrow();
    }
  });

  it('ตัวค้นจับรูปแบบที่ต้องห้ามได้จริง', () => {
    expect(flaggedRules('const s = new Date(startDate);')).toEqual(['RAW_PARSE']);
    expect(flaggedRules('x = new Date(dto.endDate!)')).toEqual(['RAW_PARSE']);
    expect(flaggedRules('x = new Date(query.asOf)')).toEqual(['RAW_PARSE']);
    expect(flaggedRules('where.gte = new Date(filters.from);')).toEqual(['RAW_PARSE']);
    expect(flaggedRules('const e = new Date( input.to )')).toEqual(['RAW_PARSE']);
    expect(flaggedRules('const d = new Date(`${startDate}T00:00:00`);')).toEqual(['TEMPLATE_NO_OFFSET']);
    expect(flaggedRules('const d = new Date(`${endDate}T23:59:59.999`);')).toEqual(['TEMPLATE_NO_OFFSET']);
    expect(flaggedRules('today.setUTCHours(0, 0, 0, 0);')).toEqual(['UTC_MIDNIGHT']);
  });

  it('ไม่จับรูปแบบที่ปลอดภัย · ไม่นับคอมเมนต์', () => {
    expect(flaggedRules('new Date(`${d}T00:00:00+07:00`)')).toEqual([]);
    expect(flaggedRules('new Date(`${d}T23:59:59.999Z`)')).toEqual([]);
    expect(flaggedRules('const s = reportDayStart(startDate);')).toEqual([]);
    expect(flaggedRules('new Date(row.date)')).toEqual([]);
    expect(flaggedRules('new Date(dto.entryDate)')).toEqual([]);
    expect(flaggedRules('x.setUTCHours(3, 0, 0, 0)')).toEqual([]);
    expect(flaggedRules('// new Date(startDate)')).toEqual([]);
    expect(flaggedRules('/* new Date(startDate) */')).toEqual([]);
    expect(flaggedRules("const url = 'http://x'; // new Date(from)")).toEqual([]);
  });
});
```

- [ ] **Step 2: รันให้เห็นว่าล้ม (หรือรายการที่เหลือ)**

คำสั่งรายการจุดที่เหลือทั้งหมด (ทั้งที่อนุญาตแล้วและที่ยังเป็น OFFENDER) — ใช้ตอน reconcile:
```
cd apps/api && DATE_GUARD_LIST=1 NODE_OPTIONS=--max-old-space-size=8192 npx jest src/utils/date-string-day-bounds.guard.spec.ts --runInBand 2>&1 | grep -E "OFFENDER|ALLOWED|บรรทัดใน|Tests:"
```
คำสั่งสำรองที่ไม่ใช้ jest (พิมพ์บรรทัดดิบ รวมที่อยู่ในคอมเมนต์ด้วย จึงอาจเกินจริง):
```
rg -n "new Date\(\s*(?:(?:dto|query|q|filters|filter|params|opts|options|input)\.)?(?:start|end|from|to|since|until|asOf|asOfDate|periodStart|periodEnd|startDate|endDate|dateFrom|dateTo|fromDate|toDate|dueFrom|dueTo|date)\s*!?\s*\)|\.setUTCHours\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\)" apps/api/src --glob "!*.spec.ts" --glob "!**/__tests__/**" --glob "!apps/api/src/cli/**" --glob "!**/date.util.ts"
```

คาดว่าผลที่เห็นขึ้นกับว่าแผน ก/ข merge แล้วหรือยัง — ตอนเขียนแผน (สแกนบน branch นี้ก่อนแผนใดเริ่ม) พบ **121 บรรทัดใน 42 ไฟล์** แบ่งเป็น 4 กลุ่ม (ตารางถัดไป) เทสต์ `ทุกจุดที่แปลงวันที่แบบดิบ…` ล้มโดยแสดงรายการ OFFENDER ที่ยังไม่อยู่ใน ALLOWED ส่วนเทสต์อื่นผ่าน

- [ ] **Step 3: ทำให้รายการตรงความจริง (reconcile)** — ไม่มีโค้ด production

เงื่อนไขก่อนเริ่ม: Task 1-7 ของแผนนี้ merge แล้ว และ **จุดต่อไปนี้ของแผน ก/ข ต้องถูกแก้แล้ว (ต้องหายไปจากรายการ OFFENDER)** — ถ้ายังเห็นอยู่ แปลว่าแผนนั้นยังไม่ครบ ห้ามแก้ด้วยการใส่ ALLOWED:

| ไฟล์ (นับจาก `apps/api/src/`) | จุด | แผน |
|---|---|---|
| `modules/accounting/accounting.controller.ts` | บรรทัด 127 · 139 · 242 · 379 (aging · bad-debt · general-journal · inter-co report) | ก |
| `modules/accounting/consolidated.controller.ts` | บรรทัด 23 · 32 · 41 | ก |
| `modules/accounting/monthly-close.service.ts` | บรรทัด 653 (`new Date(asOfDate)`) | ก |
| `modules/accounting/transactional-report.service.ts` | บรรทัด 132-133 · 792-793 (ส่วน 589 ดูตารางเงื่อนไข) | ก |
| `modules/asset/asset-journal.service.ts` · `modules/asset/services/asset-query.service.ts` (บรรทัด 443-445) | `fromDate`/`toDate` | ก |
| `modules/finance-receivable/finance-receivable.service.ts` · `modules/inter-company/inter-company.service.ts` · `modules/journal/journal.service.ts` | `startDate`/`endDate` | ก |
| `modules/reports/services/revenue-report.service.ts` · `operational-report.service.ts` | ทุกจุด | ข |
| `modules/receipts/services/receipt-query.service.ts` · `modules/purchase-orders/services/po-query.service.ts` · `modules/inventory/stock-adjustments.service.ts` · `modules/products/services/stock-transfer.service.ts` | `startDate`/`endDate`/`dateFrom`/`dateTo` | ข |
| `modules/repair-tickets/services/repair-ticket-query.service.ts` · `modules/defect-exchange/defect-exchange.service.ts` · `modules/overdue/contract-letter.service.ts` | `from`/`to` | ข |
| `modules/ai-usage/ai-usage.service.ts` · `modules/audit/audit.service.ts` · `modules/chatbot-finance/chatbot-finance-admin.controller.ts` · `modules/csat/csat.controller.ts` · `modules/staff-chat/staff-chat.controller.ts` · `modules/imported-sales/imported-sales.service.ts` · `modules/line-oa/services/payment-evidence.service.ts` | ทุกจุด | ค (Task 1-7) |
| `modules/peak/peak.controller.ts` | บรรทัด 31 (`new Date(dto.startDate)` / `new Date(dto.endDate)`) | ก (Task 12) |
| `modules/interco-settlement/interco-settlement.controller.ts` | บรรทัด 91 (`asOfDate = new Date(asOf)`) | ก (Task 11 — ใช้ `reportAsOf`) |

ที่เหลือหลังจุดข้างบนหายไป ให้จัดเป็นสองกลุ่ม:

**(ก) รายการที่อยู่ใน ALLOWED ของ Step 1 แล้ว** (8 รายการ — ต้องตรงทั้งหมด ถ้า stale ให้ตรวจว่ามีใครแก้ไฟล์นั้นไปหรือไม่):

| คีย์ | เหตุผล | มาจาก |
|---|---|---|
| `modules/chat-engine/services/room-manager.service.ts#gte: new Date(from)` | `from`/`to` เป็น epoch ms | audit ค แถว 5 (N/A) |
| `modules/chat-analytics/chat-analytics-v2.service.ts` | DTO + regex บังคับ ISO มี Z/offset | audit ค ข้อ 2c |
| `modules/employee-access/access-defect-boundaries.ts#new Date(q.from) > new Date(q.to)` | ตรวจลำดับ input อย่างเดียว | sweep ค (validation) |
| `modules/reporting/reporting.controller.ts` | เว็บส่ง ISO เต็ม | audit ข แถว 44 (OK) |
| `modules/sso-config/sso-config.controller.ts` | `@db.Date` | audit ค แถว 9 (OK) |
| `modules/users/users.service.ts#dto.startDate ? new Date(dto.startDate) : null` | เขียนค่า | audit ค แถว 8 (N/A) |
| `modules/staff-chat/services/canned-response-variable.service.ts#date instanceof Date ? date : new Date(date)` | จัดรูปแสดงผล | sweep ค (display) |
| `modules/accounting/general-ledger-report.service.ts#const startMinusOne = new Date(periodStart)` | คัดลอก Date | ตรวจโค้ดตอนเขียนแผน |

**(ข) รายการที่แผน ก/ข ตั้งใจไม่แปลง (9 รายการ)** — ตรงกับหัวข้อ "ตรวจแล้วไม่ต้องแก้" ของแผน ก และ "ถูกเพราะ TZ ของโปรเซส" ของแผน ข (เปรียบเทียบแล้ว ณ วันที่เขียนแผน) · ใส่เฉพาะที่ยังโผล่ในรายการ OFFENDER จริงหลัง ก/ข merge (ถ้าแผนนั้นเปลี่ยนใจแปลงไปแล้ว บรรทัดจะหายเอง **ห้ามใส่** เพราะเทสต์ stale จะแดง) — รวมกับกลุ่ม (ก) ได้ ALLOWED สูงสุด **17 รายการ** (8 + 9) · หมายเหตุ: ตัวช่วยที่แผน ก/ข ใช้ — `reportDayStart(x)` · `reportAsOf(x)` · `reportDayEnd(x)` · `bangkokDateRange(a, b)` — ไม่ถูกกฎใดจับ (กฎจับเฉพาะ `new Date(<ชื่อ>)` ตรง ๆ) · เทสต์นี้สแกนเฉพาะ `apps/api/src` ไม่ครอบคลุม `apps/web` (เช่น `AssetAuditPage.tsx` เป็นงานเว็บของแผน ก ไม่เกี่ยวกับตัวกัน) · คัดลอกคีย์และเหตุผลนี้ไปวางใน `ALLOWED`:

| คีย์ที่จะวาง | เหตุผล (บรรทัดเดียว) | มาจาก audit |
|---|---|---|
| `modules/accounting/transactional-report.service.ts#const endDate = new Date(asOfDate)` | ขอบ ณ วันที่ + `setHours` ถูกเมื่อ TZ โปรเซส = Asia/Bangkok (`installRuntimeGlobals`) — แผน ก ตรวจแล้วไม่แก้ | ก #14 (OK) |
| `modules/asset/services/asset-query.service.ts#const asOfDate = filters.asOfDate ? new Date(filters.asOfDate)` | วันซื้อ/ขายสินทรัพย์เก็บที่ 07:00 น. ไทย ตรงกับขอบ จึงนับครบ | ก #23 (OK) |
| `modules/asset/asset-reports.service.ts#const asOfDate = filters.asOfDate ? new Date(filters.asOfDate)` | เหตุผลเดียวกับข้างบน | ก #25 (OK) |
| `modules/asset/asset-transfer.service.ts` | วันโอนสินทรัพย์เก็บที่ 07:00 น. ไทย ขอบสิ้นสุดใช้ `setHours` | ก #26 (OK) |
| `modules/expense-documents/services/expense-document-query.service.ts` | `documentDate` เก็บที่ 07:00 น. (หรือ 12:00 น. ของบิลประจำ) นับครบทั้งขอบเริ่ม/สิ้นสุด | ก #33-36 (OK) |
| `modules/other-income/services/other-income-report.service.ts` | `issueDate` เก็บที่ 07:00 น. ไทยทุกทางที่ใช้งานจริง | ก #30 (OK) |
| `modules/reports/services/receivables-report.service.ts` | `T00:00:00`/`T23:59:59.999` ไม่มี offset ถูกเมื่อ `TZ=Asia/Bangkok` (เว็บส่ง YYYY-MM-DD เสมอ; แปลงแล้วพฤติกรรมค่าผิดรูปเปลี่ยน) — แผน ข ตั้งใจไม่แปลง | ข #7 (OK) |
| `modules/payments/services/payment-query.service.ts` | ขอบวันครบกำหนด/สมุดสรุปรายวันแบบ local (บรรทัด 20·26·391·692) ถูกเมื่อ `TZ=Asia/Bangkok` — แผน ข ตั้งใจไม่แปลง (ค่าผิดรูปเปลี่ยนเป็น 400 + เทสต์เดิมปักขอบโปรเซส) | ข #31-32 (OK/UNSURE) |
| `modules/promotions/promotions.service.ts` | เขียนวันเริ่ม/สิ้นสุดโปรโมชัน (เก็บค่า ไม่ใช่กรอง) — วันเริ่มคงเก็บเที่ยงคืน UTC ตามเดิมไม่ว่าเจ้าของตัดสินเรื่องวันสิ้นสุดอย่างไร (หน้าแก้ไขอ่านกลับด้วย slice) จึงยังโผล่แน่ | ข #28 (ต้องให้เจ้าของตัดสิน) |

ถ้าเจอ OFFENDER ที่ไม่อยู่ในสองกลุ่ม: **อย่าเพิ่งใส่ ALLOWED** ตรวจก่อนว่าเป็นตัวกรองของสตริงวันที่จริงหรือไม่ — ถ้าใช่ให้ใช้ตัวช่วย (และแจ้งผู้ดูแลแผน ก/ข ว่าตกหล่น) ถ้าไม่ใช่ (เขียนค่า / ค่าเป็นตัวเลขหรือ ISO ตามสัญญา / คัดลอก Date) ค่อยใส่พร้อมเหตุผลบรรทัดเดียวและบอกใน PR

- [ ] **Step 4: รันให้ผ่าน**

```
cd apps/api && NODE_OPTIONS=--max-old-space-size=8192 npx jest src/utils/date-string-day-bounds.guard.spec.ts --runInBand
```
คาดว่า: 5 เคสผ่านทั้งหมด (`Tests: 5 passed`) · จากนั้นรันตรวจรวม:
```
cd apps/api && NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit -p tsconfig.json
```
คาดว่า: ไม่มี error

ตรวจว่าตัวกันดักได้จริง (ทำแล้วย้อนกลับ ห้าม commit): เพิ่มบรรทัด `const x = new Date(query.startDate);` ชั่วคราวใน service ใดก็ได้ → เทสต์ข้อแรกต้องแดงพร้อมชี้ไฟล์:บรรทัด → ลบบรรทัดนั้น

- [ ] **Step 5: Commit**

```
git add apps/api/src/utils/date-string-day-bounds.guard.spec.ts
git commit -m "เพิ่มเทสต์กันถอยหลัง: ห้ามแปลงสตริงวันที่ YYYY-MM-DD เป็น 07:00 น. ไทยนอกรายการที่อนุญาต

Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>"
```

---

## ตรวจแล้วไม่ต้องแก้

| จุด | เหตุผล |
|---|---|
| `receivable-recon/receivable-recon.service.ts:142` `todayDateOnly()` (`runDate` ของ `ReceivableReconLog`) | **OK — ไม่แก้** เปิดโค้ด · schema (`runDate DateTime @db.Date` บรรทัด 7267) · ผู้เขียน (`reconcileBranches` จาก `receivable-recon.cron.ts` `@Cron('0 2 * * *', { timeZone: 'Asia/Bangkok' })` เท่านั้น) · ผู้อ่าน (`receivable-recon.controller.ts` `history`/`latest` — ไม่มีหน้าเว็บเรียก) แล้ว: ค่า `setHours(0,0,0,0)` ของโปรเซสไทย = 17:00Z ของวันก่อน และ Prisma ส่งวันที่ของคอลัมน์ `@db.Date` เป็นวันที่ตาม UTC (มีบันทึกยืนยันบนฐานทดสอบไว้ใน `.claude/rules/security.md` เรื่อง `daily_assignments.date`) จึงเก็บเป็น **วันก่อนหน้า** — แต่ cron รัน 02:00 น. ไทย (= 19:00Z ของวันก่อน) ทำให้ค่าที่เก็บเท่ากันทั้งเมื่อโปรเซสเป็น TZ ไทยและ UTC = "วันทำการที่เพิ่งปิด" ซึ่งตรงกับเจตนา "snapshot หลังปิดร้าน" · ตัวอ่าน `history` ใช้ `setHours`+`setDate` แบบเดียวกันจึงเลื่อนเท่ากัน · ช่อง `@db.Date` อยู่นอกขอบเขต (Global Constraints) · ไม่มีหน้าจอแสดงคอลัมน์นี้ — ถ้าวันหนึ่งมีหน้าจอ ให้ตัดสินก่อนว่าจะแสดงเป็นวันที่รัน (18) หรือวันที่ปิด (17) แล้วค่อยทำเป็นงานแยก |
| `sso-config/sso-config.controller.ts:20` → `sso-config.service.ts:44` | เทียบกับ `effectiveFrom/effectiveTo` ที่เป็น `@db.Date` — นอกขอบเขต (หมายเหตุเล็ก: ถ้าไม่ส่ง `date` จะเทียบ "ตอนนี้" กับคอลัมน์วันที่ แต่เว็บส่ง `documentDate` ทุกครั้ง) |
| `chat-engine/services/room-manager.service.ts:715` | `from`/`to` เป็น epoch มิลลิวินาที ไม่ใช่สตริงวันที่ |
| `audit/audit.service.ts:426-428` `getAuditStats` · `line-oa/services/payment-evidence.service.ts:29-30` `getEvidenceStats` · `chatbot-finance/services/admin-analytics.service.ts:32-36` `getOverview` ("วันนี้") | ใช้เที่ยงคืนตามโปรเซสจาก "ตอนนี้" ไม่มีสตริงจากผู้ใช้ — ถูกเมื่อ `TZ=Asia/Bangkok` ซึ่ง `installRuntimeGlobals()` ตั้งไว้ตอนบูต (ไม่ใช่บั๊กชนิดนี้) |
| `users/users.service.ts:146,298,377` | เขียน `startDate`/`birthDate` ลงคอลัมน์ ไม่ใช่การกรอง |
| `ai-usage/ai-budget.cron.ts` | พฤติกรรมบน prod ถูกอยู่แล้ว (TZ ของโปรเซส = ไทย) — Task 4 เปลี่ยนเป็น `bangkokStartOfDay()` เพื่อให้ตรงกับหน้าสรุปโดยโครงสร้างเท่านั้น |
| `imported-sales` ฝั่งเขียน `tooltify-sales-parser.ts:27-29` | เขียน `soldAt` เป็น instant ที่มี `+07:00` ถูกต้องอยู่แล้ว |
| `reporting/reporting.controller.ts:42-44` | เว็บส่ง ISO instant เต็ม — ไม่ใช่วันที่ล้วน (อยู่ใน ALLOWED ของตัวกัน) |

## ต้องให้เจ้าของตัดสิน

1. **ยอดขายนำเข้า "รายเดือน" (Task 7 ข้อสุดท้าย)** — หน้าสรุปยอดขายนำเข้า (`/imported-sales/summary` ส่วน `byMonth`) เดิมจัดเดือนตามเวลา UTC ทำให้รายการที่ขายช่วง 00:00-06:59 น. ของวันที่ 1 ถูกนับเข้าเดือนก่อนหน้า · ตัวเลือก (ก) **เปลี่ยนให้นับเดือนตามปฏิทินไทย** ให้ตรงกับตัวกรองวันที่ที่แก้แล้ว (ค่าเริ่มต้นในแผน) (ข) คงนับตาม UTC ตามเดิม — ถ้าเลือก (ข) ให้ตัดขั้นตอน `monthKey` และเคส `byMonth` ออกจาก Task 7 (ตัวกรองวันที่ยังแก้ตามปกติ) · หน้าเว็บวันนี้ยังไม่ส่งวันที่และยังไม่แสดง `byMonth` จึงยังไม่มีผู้ใช้ได้รับผลทันที
2. *(แจ้งเพื่อทราบ ไม่ต้องตอบ)* กราฟข้อความรายวันของ analytics แชทการเงิน (Task 1) เปลี่ยนการแบ่งวันเป็นวันไทย — ผลคือแท่งของแต่ละวันนับข้อความ 00:00-06:59 น. ไทยเข้าวันที่ถูกต้อง · ไม่มีทางเลือกอื่นที่สอดคล้องกับขอบวันที่แก้แล้ว

## ผลต่อผู้ใช้

- **เจ้าของ (OWNER)**
  - หน้า **ประสิทธิภาพ AI** (`/settings/ai/performance`): ตัวเลขช่วงที่เลือก "ถึงวันนี้" จะรวมของวันนี้ครบทั้งวัน (เดิมหายหลัง 07:00 น. และ 00:00-06:59 น. ของวันเริ่มไม่ถูกนับ)
  - หน้า **AI usage (แอดมิน)** (`/settings/ai/admin`): ช่อง "วันนี้" นับตั้งแต่เที่ยงคืนไทยและตรงกับยอดที่ระบบเตือนงบรายวันใช้ (เดิมเริ่มนับ 07:00 น. จึงต่ำกว่าจริงช่วงเช้าและเรียก AI ช่วงเที่ยงคืน-ตี 7 ไปอยู่ในกราฟของ "เมื่อวาน") · กราฟรายวัน 7/30/90 วันแบ่งวันตามเวลาไทย · ตาราง breakdown (ถ้าเรียกด้วยวันที่) รวมวันเริ่มและวันสิ้นสุดครบทั้งวัน
  - หน้า **Audit log** (`/audit-logs`): เลือก "วันนี้ถึงวันนี้" แล้วเห็นรายการของวันนี้ (เดิมว่างเปล่า) · รายการ 00:00-06:59 น. ของวันเริ่มและหลัง 07:00 น. ของวันสิ้นสุดไม่หาย
  - สถิติ CSAT (`/csat/stats` — ยังไม่มีหน้าเว็บ) นับครบวันตามเวลาไทย
- **ผจก.การเงิน (FINANCE_MANAGER)** และเจ้าของ: หน้า **วิเคราะห์แชทการเงิน** (`/chatbot-finance`) ช่วงวันที่ — จำนวนข้อความ ค่าใช้จ่าย AI และจำนวนส่งต่อพนักงานนับครบทั้งวันเริ่มและวันสิ้นสุด · กราฟรายวันแบ่งวันตามเวลาไทย · สถิติความพึงพอใจ (ถูกใจ/ไม่ถูกใจ) เหมือนกัน
- **ฝ่ายบัญชี / ผจก.สาขา / ผจก.การเงิน / เจ้าของ**: หน้า **ตรวจสลิป** (`/payments?tab=slip-review`) กรอง "วันที่ตั้งแต่ – ถึง" แล้วสลิปที่ลูกค้าส่งช่วงเที่ยงคืน-ตี 7 ของวันแรกไม่หาย และวันสุดท้ายครบทั้งวันไม่ว่าเซิร์ฟเวอร์จะตั้งเขตเวลาอะไร
- **เจ้าของ / ฝ่ายบัญชี / ผจก.การเงิน**: ยอดขายนำเข้า (`/imported-sales`) เมื่อกรองวันที่ — นับครบวัน (ตามข้อ 1 ด้านบนสำหรับยอดรายเดือน)
- **ผู้พัฒนา**: เทสต์กันถอยหลังใหม่จะทำให้ CI แดงทันทีที่มีใครเขียน `new Date(startDate)` / `` new Date(`${x}T00:00:00`) `` / `setUTCHours(0,0,0,0)` ลงใน `apps/api/src` โดยไม่ใส่เหตุผลในรายการอนุญาต
- ไม่มีข้อมูลเดิมถูกแก้ ไม่มีหน้าเว็บ/เมนู/สิทธิ์เปลี่ยน
