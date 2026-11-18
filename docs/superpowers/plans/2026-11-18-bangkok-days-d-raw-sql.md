# แผน ง — raw SQL แบ่งวัน/สัปดาห์/เดือน/ชั่วโมงตามเวลาไทย · แผนลงมือ

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** แก้ raw SQL ใน `apps/api/src` ที่ใช้ `date_trunc` / `EXTRACT` / `::date` / `CURRENT_DATE` / `date_trunc('month', NOW())` กับคอลัมน์เวลาตรง ๆ (ซึ่งแบ่งตาม UTC = ช้ากว่าไทย 7 ชั่วโมง หรือแบ่งตาม TZ ของ session ฐานข้อมูล) ให้แบ่งตามปฏิทินไทย — กราฟวิเคราะห์ของหน้าติดตามหนี้ · อายุหนี้ · ยอดเก็บเดือนนี้ของผู้ติดตาม · หน้าวิเคราะห์ภาพรวม (cohort / คาดการณ์ / heatmap) · "ชำระล่าช้า" ของ watch list · รอบตัดผิดนัดของลูกหนี้ไฟแนนซ์ แล้วเพิ่มกฎใหม่ในตัวกันถอยหลังให้จับ raw SQL แบบนี้

**Architecture:** Task 1 สร้างตัวช่วยเดียว `apps/api/src/utils/bangkok-sql.util.ts` (`sqlBkkLocal(expr)` คืน `Prisma.Sql` = `((expr AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Bangkok')` · `sqlBkkDate(expr)` = ตัวเดียวกัน + `::date`) และตัวช่วยเทสต์ `apps/api/src/utils/__tests__/raw-sql-call.ts` (`renderSqlCall` รวม SQL ที่ mock ได้รับเป็นข้อความเดียว) — ทุก task ถัดไปใช้สองตัวนี้ ห้ามเขียน `AT TIME ZONE` เอง · "วันนี้" / "ต้นเดือน" คำนวณใน JS ด้วย `utils/date.util.ts` (`bangkokDateString` / `bangkokStartOfDay` / `bangkokCalendarParts` + `bangkokMidnight`) แล้วส่งเป็นพารามิเตอร์ (`'YYYY-MM-DD'::date` หรือ ISO `::timestamp` ตามแบบ `overdue/consecutive-missed.service.ts`) · Task 8 ขยาย `apps/api/src/utils/date-string-day-bounds.guard.spec.ts` (ของแผน ค) ด้วยกฎ `SQL_DAY_NO_BKK`

**Tech Stack:** NestJS + Prisma 6 raw SQL (`$queryRaw` / `$queryRawUnsafe` / `$executeRaw`) · PostgreSQL · Jest (`apps/api`)

## Global Constraints
- คอลัมน์ `DateTime` ทุกตัวเป็น `timestamp(3) without time zone` ที่เก็บเวลา UTC — ตรวจแล้ว: `apps/api/prisma/schema.prisma` ไม่มี `@db.Timestamptz` และ migrations ไม่มีคอลัมน์ `timestamptz` · ช่อง `@db.Date` มี 7 ช่อง (บรรทัด 1701 · 3228 · 3230 · 5309 · 7267 · 7698 · 10459) ไม่มีช่องไหนอยู่ในแผนนี้ และห้ามเปลี่ยน
- การแบ่งวัน/สัปดาห์/เดือน/ชั่วโมง หรือการเทียบ "วันเดียวกัน" บนคอลัมน์เวลาใน raw SQL ต้องผ่าน `sqlBkkLocal` / `sqlBkkDate` จาก `apps/api/src/utils/bangkok-sql.util.ts` เท่านั้น — ห้ามเขียน `AT TIME ZONE` เองในโค้ดใหม่ (ของเดิมที่ถูกอยู่แล้วไม่ต้องย้าย — ดู "ตรวจแล้วไม่ต้องแก้")
- ห้ามใช้ `CURRENT_DATE` / `date_trunc(..., NOW())` เป็นขอบวัน — คำนวณใน JS ด้วยตัวช่วยใน `apps/api/src/utils/date.util.ts` แล้วส่งเป็นพารามิเตอร์ (`${'YYYY-MM-DD'}::date` หรือ `${date.toISOString()}::timestamp`) ไม่ผูก `Date` ตรง ๆ เป็นขอบใหม่ (Prisma ผูก `Date` เป็น timestamptz แล้วแปลงตาม TZ ของ session — prod = UTC · ฐานบนเครื่อง = Asia/Bangkok — ดูคอมเมนต์ใน `overdue/consecutive-missed.service.ts:20-23`)
- `sqlBkkLocal` / `sqlBkkDate` รับเฉพาะข้อความ SQL ที่เขียนไว้ในโค้ด (ชื่อคอลัมน์/นิพจน์) — ห้ามส่งค่าจากผู้ใช้ (ฝังด้วย `Prisma.raw`)
- รูปคำตอบของ API ไม่เปลี่ยน (ชื่อฟิลด์ · รูปสตริงวันที่ `YYYY-MM-DD` / `YYYY-MM` · ชนิดตัวเลข) — เว็บไม่ต้องแก้
- ไม่เพิ่ม/เปลี่ยน route หรือ decorator (`@Get` / `@Post` / `@Roles` / `@UseGuards` / `@Cron`) — `apps/api/src/modules/employee-access/access-policy.manifest.json` ต้องไม่ถูกแก้
- ไม่เปลี่ยนตรรกะอื่นของ query (ตัวกรองอื่น · ช่วงย้อนหลังแบบ `NOW() - INTERVAL` · การเรียงลำดับ · LIMIT · cache)
- เงินใช้ `Prisma.Decimal` เท่านั้น (แผนนี้ไม่แตะการคำนวณเงิน)
- ข้อมูลเดิมในฐานข้อมูลไม่ถูกแก้ (forward-only) — แก้เฉพาะการอ่าน/การจัดกลุ่ม/เส้นตัดของ cron
- สภาพแวดล้อมเครื่องนี้: jest/tsc ของ `apps/api` ต้องรันด้วย `NODE_OPTIONS=--max-old-space-size=8192` · `node tools/check-access-coverage.mjs` ล้มบน Windows checkout อยู่ก่อนแล้ว (CI เป็นตัวตัดสิน)
- ทำบน branch `fix/bangkok-day-bounds` (ต่อจากแผน ก/ข/ค ที่อยู่บน branch นี้แล้ว — ตัวกัน `date-string-day-bounds.guard.spec.ts` ผ่านอยู่ ณ commit `b36a87838`)
- commit ลงท้ายด้วย `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`

**ข้อกำหนดเฉพาะแผน ง**
- เทสต์ยืนยันข้อความ SQL ที่ mock ได้รับจริงผ่าน `renderSqlCall` (Task 1) — ข้อความที่คาดหวังเขียนเป็นตัวอักษรตรง ๆ ในเทสต์ (เช่น ``const BKK = (expr: string) => `((${expr} AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Bangkok')` ``) **ไม่เรียก** `sqlBkkLocal` ในเทสต์ เพื่อให้จับได้ถ้าตัวช่วยถูกแก้ผิด · `renderSqlCall(...).text` ใช้ `?` แทนพารามิเตอร์ (ยกเว้นรูป `$queryRawUnsafe` ที่คงข้อความเดิม เช่น `$1`)
- เทสต์ที่ต้องรู้ "ตอนนี้" ใช้ `jest.useFakeTimers()` + `jest.setSystemTime(...)` และยืนยันพารามิเตอร์เป็น ISO instant / `YYYY-MM-DD` ตายตัว · ทุก task รันสองรอบ: TZ ปกติของเครื่อง และ `TZ=UTC` (jest ของ `apps/api` ไม่ได้ pin TZ และเทสต์หน่วยไม่เรียก `installRuntimeGlobals()`)
- สร้าง service ด้วยมือ (`new XService(prisma as never)`) ไม่ใช้ Nest testing module ในเทสต์ใหม่ (แบบเดียวกับ `admin-analytics.service.date-range.spec.ts` ของแผน ค)
- ห้ามพึ่งเทสต์ที่ต้องต่อฐานข้อมูล — `*.db.spec.ts` (เช่น `customer-journey/sources/chat.source.db.spec.ts`) และ `*.integration.spec.ts` (ถูก `testPathIgnorePatterns` ข้ามอยู่แล้ว) ไม่ใช่ส่วนของแผนนี้ · ไม่มีเทสต์ไหนในแผนนี้รัน SQL จริง — ความถูกต้องของ PostgreSQL (`date - date` = จำนวนวัน · `date_trunc('week')` = วันจันทร์) อ้างจากเอกสาร PostgreSQL
- คำสั่งรันเทสต์มาตรฐาน (รันจาก `apps/api`): `NODE_OPTIONS=--max-old-space-size=8192 npx jest <path...> --runInBand` และ `TZ=UTC NODE_OPTIONS=--max-old-space-size=8192 npx jest <path...> --runInBand`
- **ไม่มี task เว็บ** — เว็บแสดงค่าที่ API คืนด้วยการตัดสตริงหรือแสดงตัวเลขตรง ๆ ไม่มีการแปลงเป็น `Date` (ดู "ผลต่อผู้ใช้") จึงไม่ต้อง bump เวอร์ชัน `apps/web` (ยังเป็น `26.11.12` ที่แผน ก ตั้งไว้)

## ตารางครอบคลุมจุดที่ต้องแก้ (ยืนยันโดยเปิดโค้ดจริงบน branch `fix/bangkok-day-bounds`)

| จุด (นับจาก `apps/api/src/`) | ปัญหา | Task |
|---|---|---|
| — ตัวช่วย `utils/bangkok-sql.util.ts` (ใหม่) + `utils/__tests__/raw-sql-call.ts` (ใหม่) | ไม่มีตัวช่วย SQL ร่วม (ของเดิมเขียน `AT TIME ZONE` / `+ INTERVAL '7 hours'` เองทีละที่) | 1 |
| `modules/overdue/analytics.service.ts:98` · `:104` | สัปดาห์ของ `p.paid_date` ตาม UTC | 2 |
| `modules/overdue/analytics.service.ts:130` · `:138` | สัปดาห์ของ `COALESCE(broken_at, settlement_date)` ตาม UTC | 2 |
| `modules/overdue/analytics.service.ts:161` · `:167` | วันของ `dunning_actions.created_at` ตาม UTC | 2 |
| `modules/overdue/analytics.service.ts:191` · `:197` | เดือนของ `contract_letters.dispatched_at` ตาม UTC | 2 |
| `modules/overdue/analytics.service.ts:220` · `:226` | วันของ `mdm_lock_requests.proposed_at` ตาม UTC | 2 |
| `modules/overdue/analytics-aging.service.ts:70-74` (+ เปลี่ยน `$queryRawUnsafe` บรรทัด 50-86 เป็น `$queryRaw`) | `CURRENT_DATE - oldest_due::date` — `due_date` เก็บเที่ยงคืนไทย (= 17:00Z วันก่อน · `utils/installment.util.ts:233-235` และ `utils/installment-schedule.util.ts:56`) ⇒ `::date` ได้วันก่อนวันครบกำหนด อายุเกินจริง 1 วัน · `CURRENT_DATE` ตาม TZ ของ session | 3 |
| `modules/overdue/analytics-leaderboard.service.ts:85` | `date_trunc('month', NOW())` ตาม TZ ของ session (prod = UTC ⇒ เดือนเริ่ม 07:00 น. วันที่ 1) | 4 |
| `modules/analytics/analytics.service.ts:31` · `:41` | เดือนของสัญญาแรก / เดือนที่ชำระ (cohort) ตาม UTC | 5 |
| `modules/analytics/analytics.service.ts:110` · `:118` | เดือนของยอดรับชำระ (คาดการณ์รายได้) ตาม UTC | 5 |
| `modules/analytics/analytics.service.ts:196-197` | `EXTRACT(DOW/HOUR FROM s.created_at)` — heatmap ชั่วโมงเร็วไป 7 ชั่วโมง | 5 |
| `modules/customers/services/customer-analytics.service.ts:342` · `:361` · `:368` | `p.paid_date::date > p.due_date::date` — จ่ายตรงวันครบกำหนดหลัง 07:00 น. ไทยถูกนับว่าล่าช้า | 6 |
| `modules/dashboard/services/dashboard-collections.service.ts:322` · `:338` · `:345` | เหมือนข้างบน (เงื่อนไขชุดเดียวกัน — Task 6 รวมเป็นค่าคงที่เดียวใน `utils/payment-watch-risk.util.ts`) | 6 |
| `modules/finance-receivable-contact-logs/crons/broken-promise-finance.cron.ts:20` (พบจาก sweep) | `promised_date < CURRENT_DATE` — รอบ 02:00 น. ไทย = 19:00Z ของเมื่อวาน ⇒ `CURRENT_DATE` (session UTC) = เมื่อวาน ⇒ นัดของเมื่อวานถูกตัดผิดนัดช้าไป 1 วัน | 7 |
| ตัวกันถอยหลัง `utils/date-string-day-bounds.guard.spec.ts` — กฎ `SQL_DAY_NO_BKK` | กันไม่ให้ raw SQL แบ่งวันตาม UTC กลับมา | 8 |

ผล sweep ทั้ง `apps/api/src` (ไม่นับ `*.spec.ts` · `__tests__/` · `src/cli/`) ด้วย `date_trunc(` · `DATE_TRUNC(` · `::date` · `EXTRACT(` · `to_char(` / `TO_CHAR(` · `CURRENT_DATE` · `DATE(` · `date_part(` · `NOW()` / `now()` ในไฟล์ `.ts` และ `.sql`: ทุกจุดอยู่ในตารางข้างบนหรือในหัวข้อ "ตรวจแล้วไม่ต้องแก้"

## File Structure

| ไฟล์ (นับจาก `apps/api/src/`) | หน้าที่ |
|---|---|
| `utils/bangkok-sql.util.ts` (ใหม่) | `sqlBkkLocal` · `sqlBkkDate` |
| `utils/bangkok-sql.util.spec.ts` (ใหม่) | ปักข้อความ SQL ของตัวช่วย + `renderSqlCall` |
| `utils/__tests__/raw-sql-call.ts` (ใหม่) | ตัวช่วยเทสต์ `renderSqlCall` (อยู่ใน `__tests__/` — ตัวกันข้ามโฟลเดอร์นี้) |
| `modules/overdue/analytics.service.ts` · `analytics.service.bangkok-buckets.spec.ts` (ใหม่) | 5 กราฟของ `GET /overdue/analytics` |
| `modules/overdue/analytics-aging.service.ts` · `analytics-aging.service.spec.ts` (เขียนใหม่ทั้งไฟล์) | `GET /overdue/analytics/aging` |
| `modules/overdue/analytics-leaderboard.service.ts` · `analytics-leaderboard.service.month-start.spec.ts` (ใหม่) | `GET /overdue/analytics/leaderboard` |
| `modules/analytics/analytics.service.ts` · `analytics.service.bangkok.spec.ts` (ใหม่) | `GET /reports/cohort-analysis` · `revenue-forecast` · `sales-heatmap` |
| `utils/payment-watch-risk.util.ts` · `payment-watch-risk.util.late-sql.spec.ts` (ใหม่) | ค่าคงที่ `LATE_PAYMENT_SQL` |
| `modules/customers/services/customer-analytics.service.ts` · `customer-analytics.service.watch-list.spec.ts` (ใหม่) | `GET /customers/watch-list` |
| `modules/dashboard/services/dashboard-collections.service.ts` · `dashboard-collections.service.watch-list.spec.ts` (ใหม่) | `GET /dashboard/watch-list` |
| `modules/finance-receivable-contact-logs/crons/broken-promise-finance.cron.ts` · `broken-promise-finance.cron.bangkok-day.spec.ts` (ใหม่) | รอบ 02:00 น. ตัดผิดนัด |
| `utils/date-string-day-bounds.guard.spec.ts` | เพิ่มกฎ `SQL_DAY_NO_BKK` + รายการอนุญาต 3 รายการ |

---

### Task 1: ตัวช่วย SQL เวลาไทย + ตัวช่วยเทสต์ `renderSqlCall`

**Files:**
- Create: `apps/api/src/utils/bangkok-sql.util.ts`
- Create: `apps/api/src/utils/bangkok-sql.util.spec.ts`
- Create: `apps/api/src/utils/__tests__/raw-sql-call.ts`

**Interfaces:**
- Consumes: `Prisma.sql` · `Prisma.raw` จาก `@prisma/client`
- Produces:
  - `sqlBkkLocal(expression: string): Prisma.Sql` — `((<expression> AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Bangkok')` ไม่มีพารามิเตอร์
  - `sqlBkkDate(expression: string): Prisma.Sql` — `((<expression> AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Bangkok')::date`
  - (เทสต์เท่านั้น) `renderSqlCall(call: readonly unknown[]): { text: string; values: unknown[] }`

**ทำไมรูปนี้:** `(col AT TIME ZONE 'UTC')` ตีความค่า timestamp ไม่มี tz เป็น UTC ได้ timestamptz แล้ว `AT TIME ZONE 'Asia/Bangkok'` คืนเวลานาฬิกาไทยแบบไม่มี tz — ทั้งสองขั้นไม่ขึ้นกับ `TimeZone` ของ session · เป็นรูปเดียวกับที่ `customer-journey/sources/chat.source.ts:55` และ `chatbot-finance/services/admin-analytics.service.ts:102,143` (แผน ค) ใช้อยู่ · ไม่มีตัวช่วย SQL แบบนี้ใน repo มาก่อน (`chat-analytics/chat-analytics-sql.ts:13-15` ใช้ `+ INTERVAL '7 hours'` แบบ inline ไม่ได้ export) · `Prisma.Sql` จาก `Prisma.sql` ที่ไม่มีพารามิเตอร์จะถูกฝังเป็นข้อความเมื่อซ้อนใน `$queryRaw\`...\`` หรือ `Prisma.sql\`...\`` (ตรวจด้วย Prisma 6.19 แล้ว)

- [ ] **Step 1: เขียนเทสต์ที่ต้องล้ม**

สร้าง `apps/api/src/utils/__tests__/raw-sql-call.ts`:

```ts
import { Prisma } from '@prisma/client';

/**
 * SQL ที่ mock ของ `$queryRaw` / `$queryRawUnsafe` / `$executeRaw` ได้รับจริง รวมเป็นข้อความเดียว
 * (fragment ซ้อนจาก Prisma.sql ถูกแทนที่แล้ว · ตัวแปรเป็น `?` ยกเว้นรูป `$queryRawUnsafe` ที่คงข้อความเดิม)
 * รองรับสามรูปการเรียก: tagged template (`$queryRaw\`...\``) · `$queryRaw(Prisma.sql\`...\`)` · `$queryRawUnsafe(text, ...params)`
 */
export function renderSqlCall(call: readonly unknown[]): { text: string; values: unknown[] } {
  const [first, ...rest] = call;
  if (typeof first === 'string') return { text: first, values: rest };
  if (Array.isArray(first)) {
    const sql = Prisma.sql(first as readonly string[], ...rest);
    return { text: sql.sql, values: sql.values };
  }
  const sql = first as Prisma.Sql;
  return { text: sql.sql, values: sql.values };
}
```

สร้าง `apps/api/src/utils/bangkok-sql.util.spec.ts`:

```ts
import { Prisma } from '@prisma/client';
import { sqlBkkDate, sqlBkkLocal } from './bangkok-sql.util';
import { renderSqlCall } from './__tests__/raw-sql-call';

/**
 * ตัวช่วยแปลงคอลัมน์เวลาใน raw SQL เป็นเวลาไทย (2026-11-18) — คอลัมน์ DateTime ทุกตัวเป็น timestamp ไม่มี timezone
 * ที่เก็บเวลา UTC ⇒ date_trunc / EXTRACT / ::date ตรง ๆ แบ่งวันตาม UTC (ช้ากว่าไทย 7 ชั่วโมง)
 */
describe('sqlBkkLocal / sqlBkkDate', () => {
  it('sqlBkkLocal ห่อนิพจน์ด้วย AT TIME ZONE UTC แล้ว Asia/Bangkok และไม่เพิ่มพารามิเตอร์', () => {
    const sql = sqlBkkLocal('p.paid_date');
    expect(sql.sql).toBe("((p.paid_date AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Bangkok')");
    expect(sql.values).toEqual([]);
  });

  it('รับนิพจน์ที่ไม่ใช่ชื่อคอลัมน์เดี่ยวได้ (COALESCE / MIN)', () => {
    expect(sqlBkkLocal('COALESCE(broken_at, settlement_date)').sql).toBe(
      "((COALESCE(broken_at, settlement_date) AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Bangkok')",
    );
    expect(sqlBkkLocal('MIN(c.created_at)').sql).toBe(
      "((MIN(c.created_at) AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Bangkok')",
    );
  });

  it('sqlBkkDate = วันตามปฏิทินไทยของคอลัมน์ (::date หลังแปลงเวลา)', () => {
    const sql = sqlBkkDate('p.due_date');
    expect(sql.sql).toBe("((p.due_date AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Bangkok')::date");
    expect(sql.values).toEqual([]);
  });

  it('ฝังใน Prisma.sql แล้วพารามิเตอร์อื่นยังอยู่ครบและเรียงเดิม', () => {
    const since = new Date('2026-10-18T17:00:00.000Z');
    const q = Prisma.sql`SELECT date_trunc('day', ${sqlBkkLocal('created_at')}) AS d FROM t WHERE created_at >= ${since} AND id = ${'x'}`;
    expect(q.sql).toBe(
      "SELECT date_trunc('day', ((created_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Bangkok')) AS d FROM t WHERE created_at >= ? AND id = ?",
    );
    expect(q.values).toEqual([since, 'x']);
  });
});

describe('renderSqlCall (ตัวช่วยเทสต์)', () => {
  const capture = (strings: TemplateStringsArray, ...values: unknown[]) => [strings, ...values];

  it('tagged template: แทน fragment ซ้อนเป็นข้อความ และเหลือเฉพาะพารามิเตอร์จริง', () => {
    const since = new Date('2026-10-18T17:00:00.000Z');
    const call = capture`SELECT ${sqlBkkDate('x.at')} FROM x WHERE x.at >= ${since}`;
    expect(renderSqlCall(call)).toEqual({
      text: "SELECT ((x.at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Bangkok')::date FROM x WHERE x.at >= ?",
      values: [since],
    });
  });

  it('$queryRaw(Prisma.sql`...`) และ $queryRawUnsafe(text, ...params)', () => {
    expect(renderSqlCall([Prisma.sql`SELECT ${1}`])).toEqual({ text: 'SELECT ?', values: [1] });
    expect(renderSqlCall(['SELECT $1::timestamp', '2026-10-31T17:00:00.000Z'])).toEqual({
      text: 'SELECT $1::timestamp',
      values: ['2026-10-31T17:00:00.000Z'],
    });
  });
});
```

- [ ] **Step 2: รันให้เห็นว่าล้ม**

```
cd apps/api && NODE_OPTIONS=--max-old-space-size=8192 npx jest src/utils/bangkok-sql.util.spec.ts --runInBand
```
คาดว่า: `Test suite failed to run` — `TS2307: Cannot find module './bangkok-sql.util' or its corresponding type declarations.`

- [ ] **Step 3: แก้โค้ด**

สร้าง `apps/api/src/utils/bangkok-sql.util.ts`:

```ts
import { Prisma } from '@prisma/client';

/**
 * แปลงคอลัมน์เวลาใน raw SQL เป็นเวลานาฬิกาไทย (2026-11-18)
 *
 * คอลัมน์ DateTime ทุกตัวใน schema.prisma เป็น `timestamp(3) without time zone` ที่เก็บเวลา UTC (ไม่มี @db.Timestamptz)
 * ⇒ `date_trunc` / `EXTRACT` / `::date` บนคอลัมน์ตรง ๆ แบ่งวัน·สัปดาห์·เดือน·ชั่วโมงตาม UTC = ช้ากว่าไทย 7 ชั่วโมง
 * (รายการ 00:00–06:59 น. ไทยตกไปวันก่อนหน้า · ค่าที่เก็บเที่ยงคืนไทยพอดี เช่น due_date กลายเป็นวันก่อนหน้า)
 *
 * `(expr AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Bangkok'` = ตีความค่าเป็น UTC แล้วคืนเวลานาฬิกาไทย (timestamp ไม่มี tz)
 * ไม่ขึ้นกับ TimeZone ของ session ฐานข้อมูล (prod = UTC · ฐานบนเครื่องอาจเป็น Asia/Bangkok) — รูปเดียวกับ
 * customer-journey/sources/chat.source.ts และ chatbot-finance/services/admin-analytics.service.ts
 *
 * `expression` ต้องเป็นข้อความ SQL ที่เขียนไว้ในโค้ด (ชื่อคอลัมน์ / นิพจน์) เท่านั้น — ถูกฝังด้วย Prisma.raw ห้ามส่งค่าจากผู้ใช้
 */
export function sqlBkkLocal(expression: string): Prisma.Sql {
  return Prisma.sql`((${Prisma.raw(expression)} AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Bangkok')`;
}

/** วันตามปฏิทินไทย (ชนิด `date`) ของคอลัมน์เวลา — ใช้เทียบวัน หรือหาจำนวนวันระหว่างสองค่า */
export function sqlBkkDate(expression: string): Prisma.Sql {
  return Prisma.sql`${sqlBkkLocal(expression)}::date`;
}
```

- [ ] **Step 4: รันให้ผ่าน**

```
cd apps/api && NODE_OPTIONS=--max-old-space-size=8192 npx jest src/utils/bangkok-sql.util.spec.ts --runInBand
cd apps/api && TZ=UTC NODE_OPTIONS=--max-old-space-size=8192 npx jest src/utils/bangkok-sql.util.spec.ts --runInBand
```
คาดว่า: ทั้งสองรอบ `Tests: 6 passed, 6 total`

- [ ] **Step 5: Commit**

```
git add apps/api/src/utils/bangkok-sql.util.ts apps/api/src/utils/bangkok-sql.util.spec.ts apps/api/src/utils/__tests__/raw-sql-call.ts
git commit -m "เพิ่มตัวช่วย sqlBkkLocal/sqlBkkDate แปลงคอลัมน์เวลาใน raw SQL เป็นเวลาไทย (+ ตัวช่วยเทสต์ renderSqlCall)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: กราฟวิเคราะห์ของหน้าติดตามหนี้ — `GET /overdue/analytics`

**Files:**
- Modify: `apps/api/src/modules/overdue/analytics.service.ts` (import บรรทัด 2 · `weeklyCollectionRate` บรรทัด 98 + 104 · `promiseKeptTrend` บรรทัด 130 + 138 · `dunningActionVolume` บรรทัด 161 + 167 · `letterDispatchByType` บรรทัด 191 + 197 · `mdmLockVolume` บรรทัด 220 + 226)
- Create: `apps/api/src/modules/overdue/analytics.service.bangkok-buckets.spec.ts`

**Interfaces:**
- Consumes: `sqlBkkLocal(expression: string): Prisma.Sql` จาก `../../utils/bangkok-sql.util` · `renderSqlCall` จาก `../../utils/__tests__/raw-sql-call` (เทสต์)
- Produces: ไม่มี (`getAnalytics(params: { range: '30d' | '90d' }): Promise<AnalyticsResult>` และรูป `AnalyticsResult` ไม่เปลี่ยน)

**หมายเหตุ:** ค่าที่ SQL คืนเป็นชนิด `date` (`::date`) ซึ่ง Prisma อ่านเป็น `Date` เที่ยงคืน UTC ของวันนั้น ⇒ `toISOString().split('T')[0]` ที่มีอยู่ได้วันไทยถูกต้อง ไม่ต้องแก้การ map · ขอบ `since` (`bangkokMidnightDaysAgo`) เป็นเที่ยงคืนไทยอยู่แล้ว ไม่แตะ · `date_trunc('week', …)` ของ PostgreSQL เริ่มสัปดาห์วันจันทร์ (ตามเดิม)

- [ ] **Step 1: เขียนเทสต์ที่ต้องล้ม**

สร้าง `apps/api/src/modules/overdue/analytics.service.bangkok-buckets.spec.ts`:

```ts
import { OverdueAnalyticsService } from './analytics.service';
import { renderSqlCall } from '../../utils/__tests__/raw-sql-call';

/**
 * GET /overdue/analytics (แท็บวิเคราะห์ของหน้าติดตามหนี้) ต้องแบ่งสัปดาห์/วัน/เดือนตามเวลาไทย (2026-11-18)
 * เดิม date_trunc บนคอลัมน์ timestamp (เก็บ UTC) ตรง ๆ ⇒ รายการ 00:00–06:59 น. ไทยถูกนับเข้าวันก่อนหน้า
 * (คืนวันอาทิตย์ → สัปดาห์ก่อน · คืนสิ้นเดือน → เดือนก่อน)
 */
const BKK = (expr: string) => `((${expr} AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Bangkok')`;

describe('OverdueAnalyticsService — แบ่งช่วงตามเวลาไทย', () => {
  const prisma = { $queryRaw: jest.fn() };
  let service: OverdueAnalyticsService;
  // ตอนนี้ = 2026-11-18 12:00 น. ไทย ⇒ since (30d) = เที่ยงคืนไทยของ 2026-11-18 ย้อน 30 วัน = 2026-10-19 00:00 น. ไทย
  const SINCE_30D = new Date('2026-10-18T17:00:00.000Z');

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-11-18T05:00:00.000Z'));
    prisma.$queryRaw.mockResolvedValue([]);
    service = new OverdueAnalyticsService(prisma as never);
  });
  afterEach(() => jest.useRealTimers());

  const queryOf = (table: string) => {
    const found = prisma.$queryRaw.mock.calls.map(renderSqlCall).find((c) => c.text.includes(`FROM ${table}`));
    if (!found) throw new Error(`ไม่พบ query ของ ${table}`);
    return found;
  };

  it('อัตราเก็บเงินรายสัปดาห์: สัปดาห์ของ paid_date ตามเวลาไทย ทั้ง SELECT และ GROUP BY', async () => {
    await service.getAnalytics({ range: '30d' });
    const { text, values } = queryOf('payments p');
    expect(text).toContain(`date_trunc('week', ${BKK('p.paid_date')})::date AS week_start`);
    expect(text).toContain(`GROUP BY date_trunc('week', ${BKK('p.paid_date')})`);
    expect(text).not.toContain("date_trunc('week', p.paid_date)");
    expect(values).toEqual([SINCE_30D]);
  });

  it('นัดชำระ ตามนัด/ผิดนัด: สัปดาห์ของ COALESCE(broken_at, settlement_date) ตามเวลาไทย', async () => {
    await service.getAnalytics({ range: '30d' });
    const { text, values } = queryOf('call_logs');
    expect(text).toContain(`date_trunc('week', ${BKK('COALESCE(broken_at, settlement_date)')})::date AS week_start`);
    expect(text).toContain(`GROUP BY date_trunc('week', ${BKK('COALESCE(broken_at, settlement_date)')})`);
    expect(values).toEqual([SINCE_30D]);
  });

  it('การทวงถามรายวัน: วันของ dunning_actions.created_at ตามเวลาไทย', async () => {
    await service.getAnalytics({ range: '30d' });
    const { text, values } = queryOf('dunning_actions');
    expect(text).toContain(`date_trunc('day', ${BKK('created_at')})::date AS day`);
    expect(text).toContain(`GROUP BY date_trunc('day', ${BKK('created_at')})`);
    expect(values).toEqual([SINCE_30D]);
  });

  it('หนังสือที่ส่งรายเดือน: เดือนของ dispatched_at ตามเวลาไทย', async () => {
    await service.getAnalytics({ range: '30d' });
    const { text, values } = queryOf('contract_letters');
    expect(text).toContain(`date_trunc('month', ${BKK('dispatched_at')})::date AS month`);
    expect(text).toContain(`GROUP BY letter_type, date_trunc('month', ${BKK('dispatched_at')})`);
    expect(values).toEqual([SINCE_30D]);
  });

  it('คำขอล็อกเครื่องรายวัน: วันของ proposed_at ตามเวลาไทย', async () => {
    await service.getAnalytics({ range: '30d' });
    const { text, values } = queryOf('mdm_lock_requests');
    expect(text).toContain(`date_trunc('day', ${BKK('proposed_at')})::date AS day`);
    expect(text).toContain(`GROUP BY date_trunc('day', ${BKK('proposed_at')})`);
    expect(values).toEqual([SINCE_30D]);
  });

  it('ป้ายช่วงที่ส่งให้เว็บยังเป็นสตริงวันที่จากค่า date ที่ SQL คืน (รูปเดิม)', async () => {
    prisma.$queryRaw
      .mockResolvedValueOnce([{ week_start: new Date('2026-11-16T00:00:00.000Z'), paid_count: BigInt(4), due_count: BigInt(5) }])
      .mockResolvedValueOnce([{ week_start: new Date('2026-11-16T00:00:00.000Z'), kept: BigInt(1), broken: BigInt(2) }])
      .mockResolvedValueOnce([{ day: new Date('2026-11-17T00:00:00.000Z'), sent: BigInt(3), failed: BigInt(0) }])
      .mockResolvedValueOnce([{ letter_type: 'RETURN_DEVICE_45D', month: new Date('2026-11-01T00:00:00.000Z'), cnt: BigInt(2) }])
      .mockResolvedValueOnce([{ day: new Date('2026-11-17T00:00:00.000Z'), proposed: BigInt(1), approved: BigInt(1) }]);

    const res = await service.getAnalytics({ range: '30d' });

    expect(res.weeklyCollectionRate).toEqual([{ weekStart: '2026-11-16', paidCount: 4, dueCount: 5, rate: 0.8 }]);
    expect(res.promiseKeptTrend).toEqual([{ weekStart: '2026-11-16', kept: 1, broken: 2 }]);
    expect(res.dunningActionVolume).toEqual([{ date: '2026-11-17', sent: 3, failed: 0 }]);
    expect(res.letterDispatchByType).toEqual([{ type: 'RETURN_DEVICE_45D', month: '2026-11', count: 2 }]);
    expect(res.mdmLockVolume).toEqual([{ date: '2026-11-17', proposed: 1, approved: 1 }]);
  });
});
```

- [ ] **Step 2: รันให้เห็นว่าล้ม**

```
cd apps/api && NODE_OPTIONS=--max-old-space-size=8192 npx jest src/modules/overdue/analytics.service.bangkok-buckets.spec.ts --runInBand
```
คาดว่า: `Tests: 5 failed, 1 passed, 6 total` — ทั้ง 5 เคส SQL ล้มที่ `toContain` แรก เช่น `Expected substring: "date_trunc('week', ((p.paid_date AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Bangkok'))::date AS week_start"` (ข้อความที่ได้ยังเป็น `date_trunc('week', p.paid_date)::date  AS week_start`) · เคส "ป้ายช่วง…" ผ่านอยู่แล้ว (ปักการ map เดิมที่ต้องคงไว้)

- [ ] **Step 3: แก้โค้ด**

`analytics.service.ts` — เพิ่ม import ต่อจากบรรทัด `import { PrismaService } from '../../prisma/prisma.service';`:

```ts
import { sqlBkkLocal } from '../../utils/bangkok-sql.util';
```

`weeklyCollectionRate` (before → after):

```ts
// before
          date_trunc('week', p.paid_date)::date  AS week_start,
// ...
        GROUP BY date_trunc('week', p.paid_date)
```
```ts
// after
          date_trunc('week', ${sqlBkkLocal('p.paid_date')})::date AS week_start,
// ...
        GROUP BY date_trunc('week', ${sqlBkkLocal('p.paid_date')})
```

`promiseKeptTrend` (before → after):

```ts
// before
          date_trunc('week', COALESCE(broken_at, settlement_date))::date AS week_start,
// ...
        GROUP BY date_trunc('week', COALESCE(broken_at, settlement_date))
```
```ts
// after
          date_trunc('week', ${sqlBkkLocal('COALESCE(broken_at, settlement_date)')})::date AS week_start,
// ...
        GROUP BY date_trunc('week', ${sqlBkkLocal('COALESCE(broken_at, settlement_date)')})
```

`dunningActionVolume` (before → after):

```ts
// before
          date_trunc('day', created_at)::date AS day,
// ...
        GROUP BY date_trunc('day', created_at)
```
```ts
// after
          date_trunc('day', ${sqlBkkLocal('created_at')})::date AS day,
// ...
        GROUP BY date_trunc('day', ${sqlBkkLocal('created_at')})
```

`letterDispatchByType` (before → after):

```ts
// before
          date_trunc('month', dispatched_at)::date AS month,
// ...
        GROUP BY letter_type, date_trunc('month', dispatched_at)
```
```ts
// after
          date_trunc('month', ${sqlBkkLocal('dispatched_at')})::date AS month,
// ...
        GROUP BY letter_type, date_trunc('month', ${sqlBkkLocal('dispatched_at')})
```

`mdmLockVolume` (before → after):

```ts
// before
          date_trunc('day', proposed_at)::date AS day,
// ...
        GROUP BY date_trunc('day', proposed_at)
```
```ts
// after
          date_trunc('day', ${sqlBkkLocal('proposed_at')})::date AS day,
// ...
        GROUP BY date_trunc('day', ${sqlBkkLocal('proposed_at')})
```

(ทุก query ยังเป็น tagged template `this.prisma.$queryRaw<...>\`...\`` เดิม — `Prisma.Sql` ที่ซ้อนถูกฝังเป็นข้อความ ไม่เพิ่มพารามิเตอร์ · บรรทัด `WHERE … >= ${since}` และการ map ผลไม่แตะ)

- [ ] **Step 4: รันให้ผ่าน**

```
cd apps/api && NODE_OPTIONS=--max-old-space-size=8192 npx jest src/modules/overdue/analytics.service.bangkok-buckets.spec.ts src/modules/overdue/analytics.service.spec.ts --runInBand
cd apps/api && TZ=UTC NODE_OPTIONS=--max-old-space-size=8192 npx jest src/modules/overdue/analytics.service.bangkok-buckets.spec.ts src/modules/overdue/analytics.service.spec.ts --runInBand
```
คาดว่า: ทั้งสองรอบ `Tests: 11 passed, 11 total` (6 ใหม่ + 5 ของ `analytics.service.spec.ts` เดิม)

- [ ] **Step 5: Commit**

```
git add apps/api/src/modules/overdue/analytics.service.ts apps/api/src/modules/overdue/analytics.service.bangkok-buckets.spec.ts
git commit -m "แก้กราฟวิเคราะห์หน้าติดตามหนี้ให้แบ่งสัปดาห์/วัน/เดือนตามเวลาไทย

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: อายุหนี้ — `GET /overdue/analytics/aging`

**Files:**
- Modify: `apps/api/src/modules/overdue/analytics-aging.service.ts` (import บรรทัด 1-2 · เมธอด `compute` บรรทัด 48-86 — เปลี่ยน `$queryRawUnsafe` เป็น `$queryRaw(Prisma.sql\`...\`)`)
- Modify (เขียนใหม่ทั้งไฟล์): `apps/api/src/modules/overdue/analytics-aging.service.spec.ts`

**Interfaces:**
- Consumes: `sqlBkkDate(expression: string): Prisma.Sql` จาก `../../utils/bangkok-sql.util` · `bangkokDateString(now?: Date): string` จาก `../../utils/date.util` · `Prisma` จาก `@prisma/client`
- Produces: ไม่มี (`getAgingBuckets(params: { userRole: string; userBranchId: string | null }): Promise<AgingBucketRow[]>` ไม่เปลี่ยน)

**เหตุผล:** `due_date` เก็บเที่ยงคืนไทย = 17:00Z ของวันก่อน (`generatePaymentSchedule` ใน `utils/installment.util.ts:233-235` ทั้งสองทาง และ `utils/installment-schedule.util.ts:56`) ⇒ `oldest_due::date` = วันก่อนวันครบกำหนด และ `CURRENT_DATE` บน prod (session UTC) = วันไทยตั้งแต่ 07:00 น. ⇒ อายุหนี้เกินจริง 1 วันตลอดช่วง 07:00–23:59 น. (งวดที่เลยกำหนด 7 วันไปตกช่อง `8-30`) · หลังแก้ อายุหนี้ = จำนวนวันปฏิทินไทย เท่ากับ `daysOverdue` ในคิว (`queue.service.ts:863-865` = floor((ตอนนี้ − due_date) / วัน) ซึ่งเท่ากับจำนวนวันไทยเมื่อ due_date เป็นเที่ยงคืนไทย) ที่การคลิกแท่งพาไป · เปลี่ยนเป็น `$queryRaw` เพื่อใช้ `Prisma.Sql` ได้ และกรองสาขาเป็นพารามิเตอร์ผ่าน `Prisma.sql` แทนการต่อสตริง `$1` · เงื่อนไข `p.due_date < NOW()` (เลือกงวดที่ "เลยเวลาครบกำหนดแล้ว") ไม่แตะ — ดู "ตรวจแล้วไม่ต้องแก้"

- [ ] **Step 1: เขียนเทสต์ที่ต้องล้ม**

เขียน `apps/api/src/modules/overdue/analytics-aging.service.spec.ts` ใหม่ทั้งไฟล์ (5 เคสเดิมคงไว้ เปลี่ยน mock เป็น `$queryRaw` และสร้าง service ด้วยมือ + 4 เคสใหม่):

```ts
import { AnalyticsAgingService } from './analytics-aging.service';
import { renderSqlCall } from '../../utils/__tests__/raw-sql-call';

const mockPrisma = {
  $queryRaw: jest.fn(),
};

describe('AnalyticsAgingService', () => {
  let service: AnalyticsAgingService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AnalyticsAgingService(mockPrisma as never);
  });
  afterEach(() => jest.useRealTimers());

  it('returns all 5 buckets even when DB returns nothing', async () => {
    mockPrisma.$queryRaw.mockResolvedValue([]);
    const result = await service.getAgingBuckets({ userRole: 'OWNER', userBranchId: null });
    expect(result).toHaveLength(5);
    expect(result.map((r) => r.bucket)).toEqual(['1-7', '8-30', '31-60', '61-90', '90+']);
    expect(result.every((r) => r.count === 0 && r.outstanding === 0)).toBe(true);
  });

  it('maps DB rows into the bucket order', async () => {
    mockPrisma.$queryRaw.mockResolvedValue([
      { bucket: '8-30', cnt: BigInt(3), outstanding: '4500.50' },
      { bucket: '90+', cnt: BigInt(1), outstanding: '12000' },
    ]);
    const result = await service.getAgingBuckets({ userRole: 'OWNER', userBranchId: null });
    expect(result.find((r) => r.bucket === '8-30')).toEqual({
      bucket: '8-30',
      count: 3,
      outstanding: 4500.5,
    });
    expect(result.find((r) => r.bucket === '90+')).toEqual({
      bucket: '90+',
      count: 1,
      outstanding: 12000,
    });
    expect(result.find((r) => r.bucket === '1-7')?.count).toBe(0);
  });

  it('caches result on second call (same scope)', async () => {
    mockPrisma.$queryRaw.mockResolvedValue([]);
    await service.getAgingBuckets({ userRole: 'OWNER', userBranchId: null });
    await service.getAgingBuckets({ userRole: 'OWNER', userBranchId: null });
    expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('separate cache key per branch scope (BRANCH_MANAGER different branch = miss)', async () => {
    mockPrisma.$queryRaw.mockResolvedValue([]);
    await service.getAgingBuckets({ userRole: 'BRANCH_MANAGER', userBranchId: 'b1' });
    await service.getAgingBuckets({ userRole: 'BRANCH_MANAGER', userBranchId: 'b2' });
    expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(2);
  });

  it('returns zero buckets on DB error (no throw)', async () => {
    mockPrisma.$queryRaw.mockRejectedValue(new Error('boom'));
    const result = await service.getAgingBuckets({ userRole: 'OWNER', userBranchId: null });
    expect(result).toHaveLength(5);
    expect(result.every((r) => r.count === 0)).toBe(true);
  });

  /**
   * อายุหนี้ = วันนี้ตามปฏิทินไทย − วันครบกำหนดตามปฏิทินไทย (2026-11-18)
   * due_date เก็บเที่ยงคืนไทย (= 17:00Z ของวันก่อน) ⇒ เดิม due_date::date ได้วันก่อนวันครบกำหนด อายุเกินจริง 1 วัน
   * (งวดที่เลยกำหนดมา 7 วันถูกนับเป็น 8 วัน → ตกไปช่อง 8-30) และ CURRENT_DATE ตาม TZ ของ session ฐานข้อมูล
   */
  describe('นับอายุหนี้ตามวันปฏิทินไทย', () => {
    beforeEach(() => mockPrisma.$queryRaw.mockResolvedValue([]));

    it('วันนี้ส่งเป็นพารามิเตอร์วันไทย และวันครบกำหนดแปลงเป็นวันไทยก่อนลบ', async () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-11-18T18:30:00.000Z')); // 2026-11-19 01:30 น. ไทย (UTC ยังเป็นวันที่ 18)
      await service.getAgingBuckets({ userRole: 'OWNER', userBranchId: null });

      const { text, values } = renderSqlCall(mockPrisma.$queryRaw.mock.calls[0]);
      expect(text).toContain("?::date - ((oldest_due AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Bangkok')::date AS days");
      expect(text).not.toContain('CURRENT_DATE');
      expect(text).not.toContain('oldest_due::date');
      expect(values).toEqual(['2026-11-19']);
    });

    it('ก่อนเที่ยงคืนไทยหนึ่งมิลลิวินาที ยังเป็นวันเดิม', async () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-11-18T16:59:59.999Z')); // 2026-11-18 23:59:59.999 น. ไทย
      await service.getAgingBuckets({ userRole: 'OWNER', userBranchId: null });

      expect(renderSqlCall(mockPrisma.$queryRaw.mock.calls[0]).values).toEqual(['2026-11-18']);
    });

    it('ผู้จัดการสาขา: กรองสาขาเป็นพารามิเตอร์ (ไม่ต่อสตริง) ก่อนพารามิเตอร์วันนี้', async () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-11-18T05:00:00.000Z'));
      await service.getAgingBuckets({ userRole: 'BRANCH_MANAGER', userBranchId: 'b1' });

      const { text, values } = renderSqlCall(mockPrisma.$queryRaw.mock.calls[0]);
      expect(text).toContain('AND c.branch_id = ?');
      expect(values).toEqual(['b1', '2026-11-18']);
    });

    it('เกณฑ์ช่องอายุหนี้คงเดิม (1-7 · 8-30 · 31-60 · 61-90 · 90+)', async () => {
      await service.getAgingBuckets({ userRole: 'OWNER', userBranchId: null });

      const { text } = renderSqlCall(mockPrisma.$queryRaw.mock.calls[0]);
      expect(text).toContain("WHEN days BETWEEN 1 AND 7 THEN '1-7'");
      expect(text).toContain("WHEN days BETWEEN 8 AND 30 THEN '8-30'");
      expect(text).toContain("WHEN days BETWEEN 31 AND 60 THEN '31-60'");
      expect(text).toContain("WHEN days BETWEEN 61 AND 90 THEN '61-90'");
      expect(text).toContain("WHEN days > 90 THEN '90+'");
    });
  });
});
```

- [ ] **Step 2: รันให้เห็นว่าล้ม**

```
cd apps/api && NODE_OPTIONS=--max-old-space-size=8192 npx jest src/modules/overdue/analytics-aging.service.spec.ts --runInBand
```
คาดว่า: `Tests: 7 failed, 2 passed, 9 total` — service ยังเรียก `this.prisma.$queryRawUnsafe` ซึ่งไม่มีใน mock (log `TypeError: this.prisma.$queryRawUnsafe is not a function` ถูก catch แล้วคืน 0 ทุกช่อง) ⇒ "maps DB rows…" ได้ `count: 0` · สองเคส cache ได้ `Received number of calls: 0` · 4 เคสใหม่ล้มด้วย `TypeError: call is not iterable` (ไม่มีการเรียก `$queryRaw`) · ผ่าน 2 เคส: "returns all 5 buckets…" และ "returns zero buckets on DB error…"

- [ ] **Step 3: แก้โค้ด**

`analytics-aging.service.ts` — import (before → after):

```ts
// before
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
```
```ts
// after
import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { sqlBkkDate } from '../../utils/bangkok-sql.util';
import { bangkokDateString } from '../../utils/date.util';
```

`compute` — ส่วนตั้งแต่ `try {` ถึงก่อนบรรทัด `const order: AgingBucketCode[] = …` (before → after):

```ts
// before
    try {
      const rows = await this.prisma.$queryRawUnsafe<RawRow[]>(
        `
        WITH oldest AS (
          SELECT
            p.contract_id,
            MIN(p.due_date) AS oldest_due,
            SUM((p.amount_due - p.amount_paid + p.late_fee))::numeric AS outstanding
          FROM payments p
          INNER JOIN contracts c ON c.id = p.contract_id
          WHERE p.deleted_at IS NULL
            AND c.deleted_at IS NULL
            AND c.status IN ('OVERDUE', 'DEFAULT', 'TERMINATED')
            AND p.status IN ('PENDING', 'OVERDUE', 'PARTIALLY_PAID')
            AND p.due_date < NOW()
            ${branchId ? 'AND c.branch_id = $1' : ''}
          GROUP BY p.contract_id
        ),
        bucketed AS (
          SELECT
            CASE
              WHEN (CURRENT_DATE - oldest_due::date) BETWEEN 1 AND 7 THEN '1-7'
              WHEN (CURRENT_DATE - oldest_due::date) BETWEEN 8 AND 30 THEN '8-30'
              WHEN (CURRENT_DATE - oldest_due::date) BETWEEN 31 AND 60 THEN '31-60'
              WHEN (CURRENT_DATE - oldest_due::date) BETWEEN 61 AND 90 THEN '61-90'
              WHEN (CURRENT_DATE - oldest_due::date) > 90 THEN '90+'
              ELSE NULL
            END AS bucket,
            outstanding
          FROM oldest
        )
        SELECT bucket, COUNT(*)::bigint AS cnt, SUM(outstanding)::numeric AS outstanding
        FROM bucketed
        WHERE bucket IS NOT NULL
        GROUP BY bucket
        `,
        ...(branchId ? [branchId] : []),
      );
```
```ts
// after
    try {
      // อายุหนี้ = วันนี้ตามปฏิทินไทย − วันครบกำหนดของงวดเก่าสุดตามปฏิทินไทย (2026-11-18)
      // due_date เก็บเที่ยงคืนไทย (= 17:00Z ของวันก่อน) ⇒ เดิม CURRENT_DATE - oldest_due::date ได้อายุเกินจริง 1 วัน
      // และ CURRENT_DATE ตาม TZ ของ session ฐานข้อมูล — วันนี้จึงคำนวณใน JS แล้วส่งเป็นพารามิเตอร์
      const today = bangkokDateString();
      const rows = await this.prisma.$queryRaw<RawRow[]>(Prisma.sql`
        WITH oldest AS (
          SELECT
            p.contract_id,
            MIN(p.due_date) AS oldest_due,
            SUM((p.amount_due - p.amount_paid + p.late_fee))::numeric AS outstanding
          FROM payments p
          INNER JOIN contracts c ON c.id = p.contract_id
          WHERE p.deleted_at IS NULL
            AND c.deleted_at IS NULL
            AND c.status IN ('OVERDUE', 'DEFAULT', 'TERMINATED')
            AND p.status IN ('PENDING', 'OVERDUE', 'PARTIALLY_PAID')
            AND p.due_date < NOW()
            ${branchId ? Prisma.sql`AND c.branch_id = ${branchId}` : Prisma.empty}
          GROUP BY p.contract_id
        ),
        aged AS (
          SELECT ${today}::date - ${sqlBkkDate('oldest_due')} AS days, outstanding
          FROM oldest
        ),
        bucketed AS (
          SELECT
            CASE
              WHEN days BETWEEN 1 AND 7 THEN '1-7'
              WHEN days BETWEEN 8 AND 30 THEN '8-30'
              WHEN days BETWEEN 31 AND 60 THEN '31-60'
              WHEN days BETWEEN 61 AND 90 THEN '61-90'
              WHEN days > 90 THEN '90+'
              ELSE NULL
            END AS bucket,
            outstanding
          FROM aged
        )
        SELECT bucket, COUNT(*)::bigint AS cnt, SUM(outstanding)::numeric AS outstanding
        FROM bucketed
        WHERE bucket IS NOT NULL
        GROUP BY bucket
      `);
```

(`date - date` ใน PostgreSQL = จำนวนวันเป็น integer · ส่วน map ผลและ `catch` ไม่แตะ · cache 5 นาทีต่อสาขาเหมือนเดิม)

- [ ] **Step 4: รันให้ผ่าน**

```
cd apps/api && NODE_OPTIONS=--max-old-space-size=8192 npx jest src/modules/overdue/analytics-aging.service.spec.ts --runInBand
cd apps/api && TZ=UTC NODE_OPTIONS=--max-old-space-size=8192 npx jest src/modules/overdue/analytics-aging.service.spec.ts --runInBand
```
คาดว่า: ทั้งสองรอบ `Tests: 9 passed, 9 total`

- [ ] **Step 5: Commit**

```
git add apps/api/src/modules/overdue/analytics-aging.service.ts apps/api/src/modules/overdue/analytics-aging.service.spec.ts
git commit -m "แก้อายุหนี้ในแท็บวิเคราะห์ติดตามหนี้ให้นับวันตามปฏิทินไทย (เดิมเกินจริง 1 วัน)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: ยอดเก็บได้เดือนนี้ของผู้ติดตาม — `GET /overdue/analytics/leaderboard`

**Files:**
- Modify: `apps/api/src/modules/overdue/analytics-leaderboard.service.ts` (import บรรทัด 2 · `compute` บรรทัด 41-45 · บรรทัด 85 · บรรทัด 106)
- Create: `apps/api/src/modules/overdue/analytics-leaderboard.service.month-start.spec.ts`

**Interfaces:**
- Consumes: `bangkokCalendarParts(date: Date): { year: number; month: number; day: number }` (month 0-based) · `bangkokMidnight(year: number, month: number, day: number): Date` จาก `../../utils/date.util`
- Produces: ไม่มี (`getLeaderboard(): Promise<LeaderboardRow[]>` ไม่เปลี่ยน)

**หมายเหตุ:** คงเป็น `$queryRawUnsafe` (ไม่มีข้อมูลจากผู้ใช้ในข้อความ SQL) แค่เพิ่มพารามิเตอร์ `$1` · ไม่ต้องใช้ `sqlBkkLocal` เพราะเป็นการเทียบ instant กับเส้นตัดที่คำนวณใน JS (index ของ `paid_date` ยังใช้ได้) · เงื่อนไข `NOW()` อื่นในไฟล์ (`settlement_date < NOW()` · `called_at >= NOW() - INTERVAL '90 days'`) เป็นหน้าต่างเลื่อนตามเวลา ไม่แตะ

- [ ] **Step 1: เขียนเทสต์ที่ต้องล้ม**

สร้าง `apps/api/src/modules/overdue/analytics-leaderboard.service.month-start.spec.ts`:

```ts
import { AnalyticsLeaderboardService } from './analytics-leaderboard.service';
import { renderSqlCall } from '../../utils/__tests__/raw-sql-call';

/**
 * "ยอดเก็บได้เดือนนี้" ของตารางผลงานผู้ติดตาม (GET /overdue/analytics/leaderboard) ต้องเริ่ม 00:00 น. วันที่ 1 ตามเวลาไทย (2026-11-18)
 * เดิม date_trunc('month', NOW()) ตัดเดือนตาม TZ ของ session ฐานข้อมูล (prod = UTC) ⇒ เดือนเริ่ม 07:00 น. วันที่ 1
 * ยอดที่รับช่วง 00:00–06:59 น. ของวันที่ 1 หายจากเดือนใหม่ · และช่วง 00:00–06:59 น. วันที่ 1 ตารางยังโชว์ยอดของเดือนก่อน
 */
describe('AnalyticsLeaderboardService — ต้นเดือนตามเวลาไทย', () => {
  const prisma = { $queryRawUnsafe: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$queryRawUnsafe.mockResolvedValue([]);
  });
  afterEach(() => jest.useRealTimers());

  async function monthStartAt(now: string) {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(now));
    await new AnalyticsLeaderboardService(prisma as never).getLeaderboard();
    return renderSqlCall(prisma.$queryRawUnsafe.mock.calls[0]);
  }

  it('ส่งต้นเดือนไทยเป็นพารามิเตอร์ $1 แทน date_trunc(month, NOW())', async () => {
    const { text, values } = await monthStartAt('2026-11-18T05:00:00.000Z');
    expect(text).toContain('AND p.paid_date >= $1::timestamp');
    expect(text).not.toContain("date_trunc('month', NOW())");
    expect(values).toEqual(['2026-10-31T17:00:00.000Z']); // 2026-11-01 00:00 น. ไทย
  });

  it('01:00 น. ไทยของวันที่ 1 (UTC ยังเป็นเดือนก่อน) = เดือนใหม่แล้ว', async () => {
    const { values } = await monthStartAt('2026-11-30T18:00:00.000Z'); // 2026-12-01 01:00 น. ไทย
    expect(values).toEqual(['2026-11-30T17:00:00.000Z']); // 2026-12-01 00:00 น. ไทย
  });

  it('ข้ามปี: 1 ม.ค. 07:30 น. ไทย = เดือนมกราคมของปีใหม่', async () => {
    const { values } = await monthStartAt('2027-01-01T00:30:00.000Z');
    expect(values).toEqual(['2026-12-31T17:00:00.000Z']); // 2027-01-01 00:00 น. ไทย
  });

  it('23:59 น. ไทยวันสิ้นเดือน ยังเป็นเดือนเดิม', async () => {
    const { values } = await monthStartAt('2026-11-30T16:59:00.000Z'); // 2026-11-30 23:59 น. ไทย
    expect(values).toEqual(['2026-10-31T17:00:00.000Z']);
  });
});
```

- [ ] **Step 2: รันให้เห็นว่าล้ม**

```
cd apps/api && NODE_OPTIONS=--max-old-space-size=8192 npx jest src/modules/overdue/analytics-leaderboard.service.month-start.spec.ts --runInBand
```
คาดว่า: `Tests: 4 failed, 4 total` — เคสแรก `Expected substring: "AND p.paid_date >= $1::timestamp"` · อีกสามเคส `expect(received).toEqual(expected)` ได้ `[]` (ยังไม่มีพารามิเตอร์)

- [ ] **Step 3: แก้โค้ด**

`analytics-leaderboard.service.ts` — เพิ่ม import ต่อจากบรรทัด `import { PrismaService } from '../../prisma/prisma.service';`:

```ts
import { bangkokCalendarParts, bangkokMidnight } from '../../utils/date.util';
```

`compute` — ก่อนเรียก query (before → after):

```ts
// before
      // amountPaid where paidDate in current month, recordedById = collector).
      const rows = await this.prisma.$queryRawUnsafe<RawLeaderboardRow[]>(`
```
```ts
// after
      // amountPaid where paidDate in current month, recordedById = collector).
      // "เดือนนี้" = ตั้งแต่ 00:00 น. วันที่ 1 ตามเวลาไทย คำนวณใน JS (เดิม date_trunc('month', NOW()) ตาม TZ ของ session
      // ฐานข้อมูล = เริ่ม 07:00 น. ไทยบน prod) · ส่งเป็นข้อความ ISO แล้ว ::timestamp เทียบกับ paid_date (timestamp เก็บ UTC) ตรง ๆ
      const { year, month } = bangkokCalendarParts(new Date());
      const monthStart = bangkokMidnight(year, month, 1);
      const rows = await this.prisma.$queryRawUnsafe<RawLeaderboardRow[]>(`
```

CTE `recovery` (before → after):

```ts
// before
            AND p.paid_date >= date_trunc('month', NOW())
```
```ts
// after
            AND p.paid_date >= $1::timestamp
```

ท้าย query (before → after):

```ts
// before
        ORDER BY recovery_this_month DESC, assigned_count DESC
      `);
```
```ts
// after
        ORDER BY recovery_this_month DESC, assigned_count DESC
      `, monthStart.toISOString());
```

- [ ] **Step 4: รันให้ผ่าน**

```
cd apps/api && NODE_OPTIONS=--max-old-space-size=8192 npx jest src/modules/overdue/analytics-leaderboard.service.month-start.spec.ts src/modules/overdue/analytics-leaderboard.service.spec.ts --runInBand
cd apps/api && TZ=UTC NODE_OPTIONS=--max-old-space-size=8192 npx jest src/modules/overdue/analytics-leaderboard.service.month-start.spec.ts src/modules/overdue/analytics-leaderboard.service.spec.ts --runInBand
```
คาดว่า: ทั้งสองรอบ `Tests: 9 passed, 9 total` (4 ใหม่ + 5 ของ `analytics-leaderboard.service.spec.ts` เดิม ซึ่ง mock `$queryRawUnsafe` อยู่แล้ว)

- [ ] **Step 5: Commit**

```
git add apps/api/src/modules/overdue/analytics-leaderboard.service.ts apps/api/src/modules/overdue/analytics-leaderboard.service.month-start.spec.ts
git commit -m "แก้ยอดเก็บได้เดือนนี้ของตารางผลงานผู้ติดตามให้เริ่มเดือนตามเวลาไทย

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: หน้าวิเคราะห์ภาพรวม — cohort · คาดการณ์รายได้ · ความหนาแน่นยอดขาย

**Files:**
- Modify: `apps/api/src/modules/analytics/analytics.service.ts` (import บรรทัด 4 · `getCohortAnalysis` บรรทัด 31 + 41 · `getRevenueForecast` บรรทัด 110 + 118 · `getSalesHeatmap` บรรทัด 196-197)
- Create: `apps/api/src/modules/analytics/analytics.service.bangkok.spec.ts`

**Interfaces:**
- Consumes: `sqlBkkLocal(expression: string): Prisma.Sql` จาก `../../utils/bangkok-sql.util`
- Produces: ไม่มี (`getCohortAnalysis(branchId?)` · `getRevenueForecast(branchId?)` · `getSalesHeatmap(branchId?, months = 3)` และรูปคำตอบไม่เปลี่ยน)

**หมายเหตุ:** `EXTRACT(MONTH/YEAR FROM AGE(activity_month, cohort_month))` (บรรทัด 48-49) ไม่แก้ — คำนวณจากสองค่าที่ตัดเดือนตามเวลาไทยแล้ว (อยู่ในรายการอนุญาตของ Task 8) · หน้าต่างย้อนหลัง `NOW() - INTERVAL '6 months'` / `NOW() - (${months} || ' months')::interval` ไม่แตะ · การคำนวณเดือนพยากรณ์ใน JS (`new Date(year, month - 1 + i, 1)` + `getFullYear/getMonth`) สร้างและอ่านแบบ local ทั้งคู่ จึงได้ผลเท่ากันทุก TZ ไม่แตะ

- [ ] **Step 1: เขียนเทสต์ที่ต้องล้ม**

สร้าง `apps/api/src/modules/analytics/analytics.service.bangkok.spec.ts`:

```ts
import { AnalyticsService } from './analytics.service';
import { renderSqlCall } from '../../utils/__tests__/raw-sql-call';

/**
 * หน้า "วิเคราะห์ภาพรวม" (/analytics — cohort · คาดการณ์รายได้ · ความหนาแน่นยอดขาย) ต้องแบ่งเดือน/วันในสัปดาห์/ชั่วโมงตามเวลาไทย (2026-11-18)
 * เดิม DATE_TRUNC / EXTRACT บนคอลัมน์ timestamp (เก็บ UTC) ตรง ๆ ⇒ ชั่วโมงขายเร็วไป 7 ชั่วโมง (ขาย 10:00 น. ไปอยู่ช่อง 3 โมง)
 * ยอดขายช่วง 00:00–06:59 น. ไปอยู่วันก่อนหน้า และยอดรับชำระคืนวันที่ 1 ช่วงนั้นไปอยู่เดือนก่อน
 */
const BKK = (expr: string) => `((${expr} AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Bangkok')`;

describe('AnalyticsService — เดือน/วัน/ชั่วโมงตามเวลาไทย', () => {
  const prisma = { $queryRaw: jest.fn() };
  const service = new AnalyticsService(prisma as never);
  const lastSql = () => renderSqlCall(prisma.$queryRaw.mock.calls[0]);

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$queryRaw.mockResolvedValue([]);
  });

  it('cohort: เดือนของสัญญาแรกและเดือนที่ชำระ ตัดตามเวลาไทย', async () => {
    await service.getCohortAnalysis();
    const { text, values } = lastSql();
    expect(text).toContain(`DATE_TRUNC('month', MIN(${BKK('c.created_at')})) AS cohort_month`);
    expect(text).toContain(`DATE_TRUNC('month', ${BKK('p.paid_date')}) AS activity_month`);
    expect(text).not.toContain("DATE_TRUNC('month', p.paid_date)");
    expect(values).toEqual([]);
  });

  it('cohort ของสาขา: สาขายังเป็นพารามิเตอร์', async () => {
    await service.getCohortAnalysis('b1');
    expect(lastSql().values).toEqual(['b1']);
  });

  it('คาดการณ์รายได้: เดือนของ paid_date ตามเวลาไทย ทั้ง SELECT และ GROUP BY', async () => {
    await service.getRevenueForecast();
    const { text } = lastSql();
    expect(text).toContain(`TO_CHAR(DATE_TRUNC('month', ${BKK('p.paid_date')}), 'YYYY-MM') AS month`);
    expect(text).toContain(`GROUP BY DATE_TRUNC('month', ${BKK('p.paid_date')})`);
  });

  it('ความหนาแน่นยอดขาย: วันในสัปดาห์และชั่วโมงของ sales.created_at ตามเวลาไทย', async () => {
    await service.getSalesHeatmap('b1', 3);
    const { text, values } = lastSql();
    expect(text).toContain(`EXTRACT(DOW FROM ${BKK('s.created_at')})::int AS day`);
    expect(text).toContain(`EXTRACT(HOUR FROM ${BKK('s.created_at')})::int AS hour`);
    expect(text).not.toContain('EXTRACT(HOUR FROM s.created_at)');
    expect(values).toEqual([3, 'b1']);
  });

  it('ความหนาแน่นยอดขาย: ค่าวัน/ชั่วโมงจาก SQL ส่งต่อให้เว็บตามเดิม (ชั่วโมงไทย 0–23)', async () => {
    prisma.$queryRaw.mockResolvedValue([
      { day: 1, hour: 10, count: '4', amount: '20000' },
      { day: 6, hour: 18, count: '9', amount: '45000' },
    ]);
    const res = await service.getSalesHeatmap();
    expect(res.heatmap).toEqual([
      { day: 1, hour: 10, count: 4, amount: 20000 },
      { day: 6, hour: 18, count: 9, amount: 45000 },
    ]);
    expect(res.peakDay).toEqual({ day: 6, name: 'เสาร์' });
    expect(res.peakHour).toBe(18);
  });
});
```

- [ ] **Step 2: รันให้เห็นว่าล้ม**

```
cd apps/api && NODE_OPTIONS=--max-old-space-size=8192 npx jest src/modules/analytics/analytics.service.bangkok.spec.ts --runInBand
```
คาดว่า: `Tests: 3 failed, 2 passed, 5 total` — สามเคส SQL ล้มที่ `toContain` แรก เช่น `Expected substring: "DATE_TRUNC('month', MIN(((c.created_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Bangkok'))) AS cohort_month"` · เคส "cohort ของสาขา" และ "ค่าวัน/ชั่วโมง…ตามเดิม" ผ่านอยู่แล้ว

- [ ] **Step 3: แก้โค้ด**

`analytics.service.ts` — เพิ่ม import ก่อนบรรทัด `import { d } from '../../utils/decimal.util';`:

```ts
import { sqlBkkLocal } from '../../utils/bangkok-sql.util';
```

`getCohortAnalysis` (before → after):

```ts
// before
          DATE_TRUNC('month', MIN(c.created_at)) AS cohort_month
// ...
          DATE_TRUNC('month', p.paid_date) AS activity_month
```
```ts
// after
          DATE_TRUNC('month', MIN(${sqlBkkLocal('c.created_at')})) AS cohort_month
// ...
          DATE_TRUNC('month', ${sqlBkkLocal('p.paid_date')}) AS activity_month
```

`getRevenueForecast` (before → after):

```ts
// before
        TO_CHAR(DATE_TRUNC('month', p.paid_date), 'YYYY-MM') AS month,
// ...
      GROUP BY DATE_TRUNC('month', p.paid_date)
```
```ts
// after
        TO_CHAR(DATE_TRUNC('month', ${sqlBkkLocal('p.paid_date')}), 'YYYY-MM') AS month,
// ...
      GROUP BY DATE_TRUNC('month', ${sqlBkkLocal('p.paid_date')})
```

`getSalesHeatmap` (before → after):

```ts
// before
        EXTRACT(DOW FROM s.created_at)::int AS day,
        EXTRACT(HOUR FROM s.created_at)::int AS hour,
```
```ts
// after
        EXTRACT(DOW FROM ${sqlBkkLocal('s.created_at')})::int AS day,
        EXTRACT(HOUR FROM ${sqlBkkLocal('s.created_at')})::int AS hour,
```

(`MIN` ของค่าที่แปลงเวลาแล้ว = แปลงเวลาของ `MIN` เพราะการบวก 7 ชั่วโมงไม่เปลี่ยนลำดับ)

- [ ] **Step 4: รันให้ผ่าน**

```
cd apps/api && NODE_OPTIONS=--max-old-space-size=8192 npx jest src/modules/analytics/ --runInBand
cd apps/api && TZ=UTC NODE_OPTIONS=--max-old-space-size=8192 npx jest src/modules/analytics/ --runInBand
```
คาดว่า: ทั้งสองรอบ `Tests: 17 passed, 17 total` (5 ใหม่ + 12 ของ `analytics.service.spec.ts` เดิม — golden ของ regression ไม่เปลี่ยนเพราะ mock ผลแถวโดยตรง)

- [ ] **Step 5: Commit**

```
git add apps/api/src/modules/analytics/analytics.service.ts apps/api/src/modules/analytics/analytics.service.bangkok.spec.ts
git commit -m "แก้หน้าวิเคราะห์ภาพรวม (cohort/คาดการณ์รายได้/heatmap ยอดขาย) ให้แบ่งเดือน วัน และชั่วโมงตามเวลาไทย

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: "ชำระล่าช้า" ของ watch list — `GET /dashboard/watch-list` · `GET /customers/watch-list`

**Files:**
- Modify: `apps/api/src/utils/payment-watch-risk.util.ts` (เพิ่มบนสุดของไฟล์ ก่อนบรรทัด 1)
- Modify: `apps/api/src/modules/customers/services/customer-analytics.service.ts` (import บรรทัด 4 · `getWatchList` บรรทัด 342 · 361 · 368)
- Modify: `apps/api/src/modules/dashboard/services/dashboard-collections.service.ts` (import บรรทัด 1 · `computeWatchList` บรรทัด 322 · 338 · 345)
- Create: `apps/api/src/utils/payment-watch-risk.util.late-sql.spec.ts`
- Create: `apps/api/src/modules/customers/services/customer-analytics.service.watch-list.spec.ts`
- Create: `apps/api/src/modules/dashboard/services/dashboard-collections.service.watch-list.spec.ts`

**Interfaces:**
- Consumes: `sqlBkkDate(expression: string): Prisma.Sql` จาก `./bangkok-sql.util`
- Produces: `LATE_PAYMENT_SQL: Prisma.Sql` จาก `apps/api/src/utils/payment-watch-risk.util.ts` (เงื่อนไขของตาราง `payments` alias `p` — ไม่มีพารามิเตอร์) · signature ของ `getWatchList(branchId?, limit = 30)` และ `computeWatchList(branchId?)` ไม่เปลี่ยน

**เหตุผล:** `due_date` เก็บเที่ยงคืนไทย (17:00Z วันก่อน) ⇒ `p.due_date::date` = วันก่อนวันครบกำหนด · `paid_date` เก็บได้หลายเวลา (ใบรับเงินจากหน้าจอ = `YYYY-MM-DD` → 00:00Z = 07:00 น. ไทย · gateway/สลิป = เวลาจริง) ⇒ จ่ายตรงวันครบกำหนดตั้งแต่ 07:00 น. ไทยถูกนับว่า "ล่าช้า" · เทียบวันไทยของทั้งสองฝั่งแทน (จ่ายภายในวันครบกำหนด = ตรงเวลา — ค่าเริ่มต้นของแผน ดู "ต้องให้เจ้าของตัดสิน" ข้อ 1) · สองไฟล์ใช้เงื่อนไขเดียวกันจึงย้ายเป็นค่าคงที่เดียวในไฟล์ util ที่ทั้งคู่ import อยู่แล้ว (`calculatePaymentWatchRisk`)

- [ ] **Step 1: เขียนเทสต์ที่ต้องล้ม**

สร้าง `apps/api/src/utils/payment-watch-risk.util.late-sql.spec.ts`:

```ts
import { LATE_PAYMENT_SQL } from './payment-watch-risk.util';

/**
 * "ชำระล่าช้า" ของ watch list = จ่ายในวันตามปฏิทินไทยที่หลังวันครบกำหนดตามปฏิทินไทย (2026-11-18)
 * เดิม p.paid_date::date > p.due_date::date ตัดวันตาม UTC — due_date เก็บเที่ยงคืนไทย (= 17:00Z ของวันก่อน)
 * ⇒ วันครบกำหนดถูกนับเป็นวันก่อนหน้า และจ่ายตรงวันครบกำหนดหลัง 07:00 น. ถูกนับว่าล่าช้า
 */
describe('LATE_PAYMENT_SQL', () => {
  it('เทียบวันไทยของ paid_date กับวันไทยของ due_date (alias p) ไม่มีพารามิเตอร์', () => {
    expect(LATE_PAYMENT_SQL.sql).toBe(
      "p.paid_date IS NOT NULL AND ((p.paid_date AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Bangkok')::date > ((p.due_date AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Bangkok')::date",
    );
    expect(LATE_PAYMENT_SQL.values).toEqual([]);
  });
});
```

สร้าง `apps/api/src/modules/customers/services/customer-analytics.service.watch-list.spec.ts`:

```ts
import { CustomerAnalyticsService } from './customer-analytics.service';
import { renderSqlCall } from '../../../utils/__tests__/raw-sql-call';

/** GET /customers/watch-list — "ชำระล่าช้า" เทียบวันตามปฏิทินไทย (2026-11-18) */
const LATE =
  "p.paid_date IS NOT NULL AND ((p.paid_date AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Bangkok')::date > ((p.due_date AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Bangkok')::date";

describe('CustomerAnalyticsService.getWatchList — งวดล่าช้านับตามวันไทย', () => {
  const prisma = { $queryRaw: jest.fn() };
  const service = new CustomerAnalyticsService(prisma as never, {} as never);

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$queryRaw.mockResolvedValue([]);
  });

  it('เงื่อนไขล่าช้าทั้งสามจุด (นับ · HAVING · ลำดับคะแนน) ใช้วันไทยของ paid_date และ due_date', async () => {
    await service.getWatchList(undefined, 30);
    const { text, values } = renderSqlCall(prisma.$queryRaw.mock.calls[0]);
    expect(text.split(LATE)).toHaveLength(4);
    expect(text).not.toContain('p.paid_date::date');
    expect(values).toEqual([30]);
  });

  it('กรองสาขาและ limit ยังเป็นพารามิเตอร์ตามลำดับเดิม', async () => {
    await service.getWatchList('b1', 10);
    expect(renderSqlCall(prisma.$queryRaw.mock.calls[0]).values).toEqual(['b1', 10]);
  });

  it('จำนวนงวดล่าช้าจาก SQL ยังแปลงเป็นเหตุผล/คะแนนแบบเดิม', async () => {
    prisma.$queryRaw.mockResolvedValue([
      {
        customerId: 'cu1', customerName: 'ก', customerPhone: '0800000000', contractId: 'c1', contractNumber: 'CT-1',
        latePaymentCount: BigInt(2), partialPaymentCount: BigInt(0), hadDunningReset: false, dunningStage: 'NONE',
        totalMonths: 10, paidCount: BigInt(4), nextDueDate: null, nextAmountDue: null,
      },
    ]);
    const res = await service.getWatchList(undefined, 30);
    expect(res.watchList[0]).toMatchObject({ latePaymentCount: 2, riskScore: 2, riskLevel: 'LOW', reasons: ['ชำระล่าช้า 2 ครั้ง'] });
  });
});
```

สร้าง `apps/api/src/modules/dashboard/services/dashboard-collections.service.watch-list.spec.ts`:

```ts
import { DashboardCollectionsService } from './dashboard-collections.service';
import { renderSqlCall } from '../../../utils/__tests__/raw-sql-call';

/** GET /dashboard/watch-list (การ์ดลูกค้าเฝ้าระวังบนแดชบอร์ดผู้บริหาร) — "ชำระล่าช้า" เทียบวันตามปฏิทินไทย (2026-11-18) */
const LATE =
  "p.paid_date IS NOT NULL AND ((p.paid_date AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Bangkok')::date > ((p.due_date AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Bangkok')::date";

describe('DashboardCollectionsService.computeWatchList — งวดล่าช้านับตามวันไทย', () => {
  const prisma = { $queryRaw: jest.fn() };
  const service = new DashboardCollectionsService(prisma as never);

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$queryRaw.mockResolvedValue([]);
  });

  it('เงื่อนไขล่าช้าทั้งสามจุด (นับ · HAVING · ลำดับคะแนน) ใช้วันไทยของ paid_date และ due_date', async () => {
    await service.computeWatchList();
    const { text, values } = renderSqlCall(prisma.$queryRaw.mock.calls[0]);
    expect(text.split(LATE)).toHaveLength(4);
    expect(text).not.toContain('p.paid_date::date');
    expect(values).toEqual([]);
  });

  it('กรองสาขายังเป็นพารามิเตอร์', async () => {
    await service.computeWatchList('b1');
    expect(renderSqlCall(prisma.$queryRaw.mock.calls[0]).values).toEqual(['b1']);
  });

  it('จำนวนงวดล่าช้าจาก SQL ยังแปลงเป็นระดับความเสี่ยงแบบเดิม', async () => {
    prisma.$queryRaw.mockResolvedValue([
      {
        customerId: 'cu1', customerName: 'ก', customerPhone: '0800000000', contractId: 'c1', contractNumber: 'CT-1',
        latePaymentCount: BigInt(3), partialPaymentCount: BigInt(1), hadDunningReset: false,
        nextDueDate: null, nextAmountDue: null,
      },
    ]);
    const res = await service.computeWatchList();
    expect(res.watchList[0]).toMatchObject({ riskScore: 5, riskLevel: 'HIGH', reasons: ['ชำระล่าช้า 3 ครั้ง', 'จ่ายไม่ครบ 1 ครั้ง'] });
    expect(res.highCount).toBe(1);
  });
});
```

(`CustomerAnalyticsService` สร้างนอก request context ได้ — `domainAccessClient` คืน prisma ที่ส่งเข้าไป และ `currentPartyQuery()` เป็น `undefined` ⇒ `reportScope` คืน `null` ไม่เรียก `CustomerQueryService`)

- [ ] **Step 2: รันให้เห็นว่าล้ม**

```
cd apps/api && NODE_OPTIONS=--max-old-space-size=8192 npx jest src/utils/payment-watch-risk.util.late-sql.spec.ts src/modules/customers/services/customer-analytics.service.watch-list.spec.ts src/modules/dashboard/services/dashboard-collections.service.watch-list.spec.ts --runInBand
```
คาดว่า: suite `payment-watch-risk.util.late-sql.spec.ts` `Test suite failed to run` — `TS2305: Module '"./payment-watch-risk.util"' has no exported member 'LATE_PAYMENT_SQL'.` · อีกสอง suite `Tests: 2 failed, 4 passed` — เคสแรกของแต่ละไฟล์ `expect(received).toHaveLength(expected)  Expected length: 4  Received length: 1` · เคสพารามิเตอร์และเคส map ผ่านอยู่แล้ว

- [ ] **Step 3: แก้โค้ด**

`payment-watch-risk.util.ts` — เพิ่มบนสุดของไฟล์ (ก่อน `export function calculatePaymentWatchRisk`):

```ts
import { Prisma } from '@prisma/client';
import { sqlBkkDate } from './bangkok-sql.util';

/**
 * เงื่อนไข "งวดชำระล่าช้า" ของ watch list (ตาราง payments alias `p`) — จ่ายในวันตามปฏิทินไทยที่**หลัง**วันครบกำหนดตามปฏิทินไทย
 * (จ่ายภายในวันครบกำหนด = ตรงเวลา) · เดิม `p.paid_date::date > p.due_date::date` ตัดวันตาม UTC: due_date เก็บเที่ยงคืนไทย
 * (= 17:00Z ของวันก่อน) ⇒ จ่ายตรงวันครบกำหนดหลัง 07:00 น. ถูกนับว่าล่าช้า (2026-11-18)
 */
export const LATE_PAYMENT_SQL = Prisma.sql`p.paid_date IS NOT NULL AND ${sqlBkkDate('p.paid_date')} > ${sqlBkkDate('p.due_date')}`;

```

`customer-analytics.service.ts` — import (before → after):

```ts
// before
import { calculatePaymentWatchRisk } from '../../../utils/payment-watch-risk.util';
```
```ts
// after
import { calculatePaymentWatchRisk, LATE_PAYMENT_SQL } from '../../../utils/payment-watch-risk.util';
```

`getWatchList` — ทั้งสามจุด (บรรทัด 342 · 361 · 368 ข้อความเหมือนกัน) (before → after):

```ts
// before
          WHERE p.paid_date IS NOT NULL AND p.paid_date::date > p.due_date::date
```
```ts
// after
          WHERE ${LATE_PAYMENT_SQL}
```
(จุดที่สามอยู่ใน `LEAST(...)` และมีย่อหน้าลึกกว่าสองช่องว่าง — คงย่อหน้าเดิม เปลี่ยนเฉพาะข้อความหลัง `WHERE`)

`dashboard-collections.service.ts` — import (before → after):

```ts
// before
import { calculatePaymentWatchRisk } from '../../../utils/payment-watch-risk.util';
```
```ts
// after
import { calculatePaymentWatchRisk, LATE_PAYMENT_SQL } from '../../../utils/payment-watch-risk.util';
```

`computeWatchList` — ทั้งสามจุด (บรรทัด 322 · 338 · 345) (before → after):

```ts
// before
          WHERE p.paid_date IS NOT NULL AND p.paid_date::date > p.due_date::date
```
```ts
// after
          WHERE ${LATE_PAYMENT_SQL}
```

(ทั้งสองไฟล์ใช้ `this.prisma.$queryRaw<...>(Prisma.sql\`...\`)` อยู่แล้ว — `LATE_PAYMENT_SQL` ไม่มีพารามิเตอร์ จึงไม่เปลี่ยนลำดับพารามิเตอร์ `branchId` / `limit`)

- [ ] **Step 4: รันให้ผ่าน**

```
cd apps/api && NODE_OPTIONS=--max-old-space-size=8192 npx jest src/utils/payment-watch-risk.util.late-sql.spec.ts src/utils/payment-watch-risk.util.spec.ts src/modules/customers/services/customer-analytics.service.watch-list.spec.ts src/modules/dashboard/services/dashboard-collections.service.watch-list.spec.ts src/modules/customers/customers.service.spec.ts src/modules/dashboard/dashboard.service.spec.ts --runInBand
cd apps/api && TZ=UTC NODE_OPTIONS=--max-old-space-size=8192 npx jest src/utils/payment-watch-risk.util.late-sql.spec.ts src/utils/payment-watch-risk.util.spec.ts src/modules/customers/services/customer-analytics.service.watch-list.spec.ts src/modules/dashboard/services/dashboard-collections.service.watch-list.spec.ts src/modules/customers/customers.service.spec.ts src/modules/dashboard/dashboard.service.spec.ts --runInBand
```
คาดว่า: ทั้งสองรอบ 6 suites ผ่านทั้งหมด (ใหม่ 1 + 3 + 3 เคส · `payment-watch-risk.util.spec.ts` เดิม 5 เคส · `customers.service.spec.ts` + `dashboard.service.spec.ts` เดิมรวม 29 เคส)

- [ ] **Step 5: Commit**

```
git add apps/api/src/utils/payment-watch-risk.util.ts apps/api/src/utils/payment-watch-risk.util.late-sql.spec.ts apps/api/src/modules/customers/services/customer-analytics.service.ts apps/api/src/modules/customers/services/customer-analytics.service.watch-list.spec.ts apps/api/src/modules/dashboard/services/dashboard-collections.service.ts apps/api/src/modules/dashboard/services/dashboard-collections.service.watch-list.spec.ts
git commit -m "แก้ watch list ให้นับ \"ชำระล่าช้า\" เมื่อจ่ายหลังวันครบกำหนดตามปฏิทินไทย (เดิมจ่ายตรงวันหลัง 07:00 น. ถูกนับว่าล่าช้า)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: รอบตัดผิดนัดของลูกหนี้ไฟแนนซ์ — `BrokenPromiseFinanceCron`

**Files:**
- Modify: `apps/api/src/modules/finance-receivable-contact-logs/crons/broken-promise-finance.cron.ts` (import บรรทัด 5 · `handleCron` บรรทัด 16-20)
- Create: `apps/api/src/modules/finance-receivable-contact-logs/crons/broken-promise-finance.cron.bangkok-day.spec.ts`

**Interfaces:**
- Consumes: `bangkokStartOfDay(now?: Date): Date` จาก `../../../utils/date.util`
- Produces: ไม่มี (`handleCron(): Promise<number>` และ `@Cron('0 2 * * *', { timeZone: 'Asia/Bangkok' })` ไม่เปลี่ยน)

**เหตุผล:** `promised_date` บันทึกจากหน้า "บันทึกการติดต่อ" (`FinanceContactLogDialog.tsx` ส่ง `YYYY-MM-DD` → `new Date(dto.promisedDate)` ใน `finance-receivable-contact-logs.service.ts:69,77,134` = 00:00Z = 07:00 น. ไทยของวันนัด) · รอบ 02:00 น. ไทย = 19:00Z ของเมื่อวาน ⇒ `CURRENT_DATE` (session UTC) = เมื่อวาน ⇒ นัดของเมื่อวานยังไม่ผ่าน `promised_date < CURRENT_DATE` ต้องรอรอบถัดไป · เส้นตัดใหม่ `promised_date < 00:00 น. ไทยของวันนี้` ⇔ วันนัด (ไทย) ก่อนวันนี้ (ไทย) ไม่ว่า `promised_date` จะเก็บเวลาใดของวัน และยังใช้ index `[promisedDate, promisedBrokenAt, promisedKeptAt]` ได้ (ไม่ห่อคอลัมน์) · `SET promised_broken_at = now()` ไม่แตะ (ดู "ตรวจแล้วไม่ต้องแก้")

- [ ] **Step 1: เขียนเทสต์ที่ต้องล้ม**

สร้าง `apps/api/src/modules/finance-receivable-contact-logs/crons/broken-promise-finance.cron.bangkok-day.spec.ts`:

```ts
import { BrokenPromiseFinanceCron } from './broken-promise-finance.cron';
import { renderSqlCall } from '../../../utils/__tests__/raw-sql-call';

/**
 * รอบ 02:00 น. ไทยตัด "ผิดนัด" ให้นัดโอนที่วันนัด (ปฏิทินไทย) ผ่านไปแล้ว (2026-11-18)
 * เดิม promised_date < CURRENT_DATE — CURRENT_DATE ตาม TZ ของ session (prod = UTC) ⇒ ตอน 02:00 น. ไทย (= 19:00Z ของเมื่อวาน)
 * ได้ "เมื่อวาน" ⇒ นัดของเมื่อวานยังไม่ถูกตัด ต้องรออีกหนึ่งรอบ (ช้าไป 1 วัน)
 */
describe('BrokenPromiseFinanceCron — เส้นตัดวันนัดตามเวลาไทย', () => {
  const prisma = { $executeRaw: jest.fn() };
  const cron = new BrokenPromiseFinanceCron(prisma as never);

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$executeRaw.mockResolvedValue(3);
  });
  afterEach(() => jest.useRealTimers());

  it('รอบ 02:00 น. ไทย 19 พ.ย.: เส้นตัด = 00:00 น. ไทยของ 19 พ.ย. (นัดวันที่ 18 ลงไปถือว่าผิดนัด)', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-11-18T19:00:00.000Z')); // 2026-11-19 02:00 น. ไทย

    await expect(cron.handleCron()).resolves.toBe(3);

    const { text, values } = renderSqlCall(prisma.$executeRaw.mock.calls[0]);
    expect(text).toContain('WHERE promised_date < ?::timestamp');
    expect(text).not.toContain('CURRENT_DATE');
    expect(values).toEqual(['2026-11-18T17:00:00.000Z']);
  });

  it('นัดที่บันทึกจากเว็บ (YYYY-MM-DD → 00:00Z = 07:00 น. ไทย) ของวันที่ 18 อยู่ก่อนเส้นตัด · ของวันที่ 19 ไม่อยู่', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-11-18T19:00:00.000Z'));
    await cron.handleCron();

    const cutoff = new Date(renderSqlCall(prisma.$executeRaw.mock.calls[0]).values[0] as string).getTime();
    expect(new Date('2026-11-18').getTime() < cutoff).toBe(true);
    expect(new Date('2026-11-19').getTime() < cutoff).toBe(false);
  });

  it('เงื่อนไขอื่นของรอบคงเดิม', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-11-18T19:00:00.000Z'));
    await cron.handleCron();

    const { text } = renderSqlCall(prisma.$executeRaw.mock.calls[0]);
    expect(text).toContain('SET promised_broken_at = now()');
    expect(text).toContain('AND promised_broken_at IS NULL');
    expect(text).toContain('AND promised_kept_at IS NULL');
    expect(text).toContain("AND result = 'PROMISED'");
    expect(text).toContain("WHERE status NOT IN ('RECEIVED', 'PARTIALLY_RECEIVED')");
  });
});
```

- [ ] **Step 2: รันให้เห็นว่าล้ม**

```
cd apps/api && NODE_OPTIONS=--max-old-space-size=8192 npx jest src/modules/finance-receivable-contact-logs/crons/broken-promise-finance.cron.bangkok-day.spec.ts --runInBand
```
คาดว่า: `Tests: 2 failed, 1 passed, 3 total` — เคสแรก `Expected substring: "WHERE promised_date < ?::timestamp"` · เคสที่สอง `Expected: true  Received: false` (ยังไม่มีพารามิเตอร์ ⇒ `new Date(undefined)` = NaN) · เคส "เงื่อนไขอื่นคงเดิม" ผ่านอยู่แล้ว

- [ ] **Step 3: แก้โค้ด**

`broken-promise-finance.cron.ts` — เพิ่ม import ต่อจากบรรทัด `import { PrismaService } from '../../../prisma/prisma.service';`:

```ts
import { bangkokStartOfDay } from '../../../utils/date.util';
```

`handleCron` (before → after):

```ts
// before
    try {
      const affected = await this.prisma.$executeRaw(Prisma.sql`
        UPDATE finance_receivable_contact_logs
        SET promised_broken_at = now()
        WHERE promised_date < CURRENT_DATE
```
```ts
// after
    try {
      // นัดที่ "เลยวันนัดแล้ว" = วันนัด (ปฏิทินไทย) ก่อนวันนี้ (ปฏิทินไทย) ⇔ promised_date < 00:00 น. ไทยของวันนี้ (2026-11-18)
      // เดิม CURRENT_DATE ตาม TZ ของ session (prod = UTC) ⇒ รอบ 02:00 น. ไทยได้ "เมื่อวาน" ⇒ ตัดผิดนัดช้าไป 1 วัน
      // ส่งเป็นข้อความ ISO แล้ว ::timestamp เทียบกับ promised_date (timestamp เก็บ UTC) ตรง ๆ ไม่ผ่าน TZ ของ session
      const todayStart = bangkokStartOfDay();
      const affected = await this.prisma.$executeRaw(Prisma.sql`
        UPDATE finance_receivable_contact_logs
        SET promised_broken_at = now()
        WHERE promised_date < ${todayStart.toISOString()}::timestamp
```

- [ ] **Step 4: รันให้ผ่าน**

```
cd apps/api && NODE_OPTIONS=--max-old-space-size=8192 npx jest src/modules/finance-receivable-contact-logs/crons/ --runInBand
cd apps/api && TZ=UTC NODE_OPTIONS=--max-old-space-size=8192 npx jest src/modules/finance-receivable-contact-logs/crons/ --runInBand
```
คาดว่า: ทั้งสองรอบ `Tests: 4 passed, 4 total` (3 ใหม่ + 1 ของ `broken-promise-finance.cron.spec.ts` เดิม)

- [ ] **Step 5: Commit**

```
git add apps/api/src/modules/finance-receivable-contact-logs/crons/broken-promise-finance.cron.ts apps/api/src/modules/finance-receivable-contact-logs/crons/broken-promise-finance.cron.bangkok-day.spec.ts
git commit -m "แก้รอบตัดผิดนัดลูกหนี้ไฟแนนซ์ให้ใช้วันนี้ตามเวลาไทย (เดิมตัดช้าไป 1 วัน)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: ตัวกันถอยหลัง — กฎ `SQL_DAY_NO_BKK`

**ลำดับ:** ทำหลัง Task 2-7 (ถ้ายังไม่ครบ เทสต์ข้อแรกจะแดงพร้อมรายการจุดที่เหลือ — ใช้เป็นเช็กลิสต์ได้ ห้ามแก้ด้วยการใส่ ALLOWED)

**Files:**
- Modify: `apps/api/src/utils/date-string-day-bounds.guard.spec.ts` (คอมเมนต์หัวไฟล์บรรทัด 13-15 · ท้าย `ALLOWED` บรรทัด 88-90 · `interface Rule` บรรทัด 118-122 · ท้าย `RULES` บรรทัด 138-142 · `collectOffenders` บรรทัด 181 · `flaggedRules` บรรทัด 198 · เคส "ตัวค้นจับ…" บรรทัด 241 · เคส "ไม่จับ…" บรรทัด 253)

**Interfaces:**
- Consumes: ไม่มี (อ่านไฟล์ซอร์ส `apps/api/src/**/*.ts` ผ่าน `node:fs` ตามเดิม)
- Produces: ไม่มี (เทสต์ล้วน)

**กฎใหม่:**

| กฎ | จับอะไร (ไม่สนตัวพิมพ์เล็ก/ใหญ่) | ยกเว้นเมื่อบรรทัดมี | ทำไมผิด |
|---|---|---|---|
| `SQL_DAY_NO_BKK` | `date_trunc('hour'\|'day'\|'week'\|'month'\|'quarter'\|'year'` · `EXTRACT(DOW\|ISODOW\|HOUR\|DAY\|DOY\|WEEK\|MONTH\|QUARTER\|YEAR FROM` · `::date` ที่ไม่ได้ตามหลัง `'` หรือ `}` · `CURRENT_DATE` | `AT TIME ZONE` หรือ `sqlBkkLocal(` / `sqlBkkDate(` | คอลัมน์ timestamp เก็บ UTC ⇒ แบ่งวันตาม UTC ช้ากว่าไทย 7 ชั่วโมง · `CURRENT_DATE` ตาม TZ ของ session |

ออกแบบให้ไม่จับ: `date_trunc('milliseconds', …)` (ไม่ใช่หน่วยปฏิทิน) · `EXTRACT(EPOCH FROM …)` (ระยะเวลา) · `'0001-01-01'::date` (ค่าคงที่) · `${param}::date` (พารามิเตอร์จาก JS เช่น `work_date` ที่เป็น `@db.Date` หรือ `${today}::date` ของ Task 3) · เมธอด JS ชื่อ `extract(` (ตัวถัดไปไม่ใช่ชื่อฟิลด์) · บรรทัดที่ใช้ตัวช่วยหรือ `AT TIME ZONE` อยู่แล้ว (เช่น `admin-analytics.service.ts` ของแผน ค · `chat.source.ts:55`) · สแกนเฉพาะ `.ts` ตามเดิม (ไฟล์ `.sql` ใน `customer-journey/sql/` ไม่มี `date_trunc` / `EXTRACT` / `::date` / `CURRENT_DATE` — ตรวจแล้ว) · ข้อจำกัดที่ยอมรับ: SQL comment (`--`) ไม่ถูกตัดก่อนค้น และ `${fragment}::date` ที่ fragment เป็นคอลัมน์จะหลุดการตรวจ

**รายการอนุญาตใหม่ (3 รายการ — ต้องตรงทั้งหมดหลัง Task 2-7):**

| คีย์ | เหตุผล |
|---|---|
| `modules/analytics/analytics.service.ts#EXTRACT(MONTH FROM AGE(activity_month, cohort_month))` | นับเดือนห่างจาก `AGE()` ของสองค่าที่ตัดเดือนตามเวลาไทยแล้ว ไม่ได้อ่านคอลัมน์ timestamp ตรง |
| `modules/analytics/analytics.service.ts#EXTRACT(YEAR FROM AGE(activity_month, cohort_month))` | เหตุผลเดียวกัน (ส่วนปี) |
| `modules/chat-analytics/chat-analytics-sql.ts#+INTERVAL '7 hours')::date` | แปลงเป็นวันไทยด้วย `+ INTERVAL '7 hours'` อยู่แล้ว (ไทยไม่มี DST — เท่ากับ `AT TIME ZONE`) สำหรับนาทีทำการของ SLA แชท |

(รายการอนุญาตเดิม 33 รายการของกฎ `RAW_PARSE` / `TEMPLATE_NO_OFFSET` ไม่แตะ — รวมเป็น 36 รายการ)

- [ ] **Step 1: เขียนเทสต์ที่ต้องล้ม**

เคส `'ตัวค้นจับรูปแบบที่ต้องห้ามได้จริง'` — ต่อท้ายบรรทัด `expect(flaggedRules('today.setUTCHours(0, 0, 0, 0);')).toEqual(['UTC_MIDNIGHT']);` (before → after):

```ts
// before
    expect(flaggedRules('today.setUTCHours(0, 0, 0, 0);')).toEqual(['UTC_MIDNIGHT']);
  });
```
```ts
// after
    expect(flaggedRules('today.setUTCHours(0, 0, 0, 0);')).toEqual(['UTC_MIDNIGHT']);
    expect(flaggedRules("date_trunc('week', p.paid_date)::date AS week_start,")).toEqual(['SQL_DAY_NO_BKK']);
    expect(flaggedRules("GROUP BY DATE_TRUNC('month', p.paid_date)")).toEqual(['SQL_DAY_NO_BKK']);
    expect(flaggedRules('EXTRACT(HOUR FROM s.created_at)::int AS hour,')).toEqual(['SQL_DAY_NO_BKK']);
    expect(flaggedRules('extract(dow from s.created_at)')).toEqual(['SQL_DAY_NO_BKK']);
    expect(flaggedRules('WHERE p.paid_date IS NOT NULL AND p.paid_date::date > p.due_date::date')).toEqual(['SQL_DAY_NO_BKK']);
    expect(flaggedRules('WHERE promised_date < CURRENT_DATE')).toEqual(['SQL_DAY_NO_BKK']);
  });
```

เคส `'ไม่จับรูปแบบที่ปลอดภัย · ไม่นับคอมเมนต์'` — ต่อท้ายบรรทัด `expect(flaggedRules("const url = 'http://x'; // new Date(from)")).toEqual([]);` (before → after):

```ts
// before
    expect(flaggedRules("const url = 'http://x'; // new Date(from)")).toEqual([]);
  });
```
```ts
// after
    expect(flaggedRules("const url = 'http://x'; // new Date(from)")).toEqual([]);
    expect(flaggedRules("date_trunc('day', (cm.created_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Bangkok') AS date")).toEqual([]);
    expect(flaggedRules("date_trunc('week', ${sqlBkkLocal('p.paid_date')})::date AS week_start,")).toEqual([]);
    expect(flaggedRules("SELECT ${today}::date - ${sqlBkkDate('oldest_due')} AS days, outstanding")).toEqual([]);
    expect(flaggedRules('AND work_date = ${by.key.workDate}::date FOR UPDATE')).toEqual([]);
    expect(flaggedRules("MIN(CASE WHEN p.warranty_expired THEN '0001-01-01'::date ELSE p.warranty_expire_date END)")).toEqual([]);
    expect(flaggedRules('AVG(EXTRACT(EPOCH FROM (cl.called_at - c.created_at)) / 86400.0) AS avg_days')).toEqual([]);
    expect(flaggedRules("date_trunc('milliseconds', transaction_timestamp())")).toEqual([]);
    expect(flaggedRules('this.lineSrc.extract({ channel: x, since })')).toEqual([]);
  });
```

(สตริงที่มี `${...}` อยู่ในเครื่องหมายคำพูดธรรมดา ไม่ใช่ template literal — เป็นข้อความตัวอย่างของบรรทัดโค้ด)

- [ ] **Step 2: รันให้เห็นว่าล้ม**

```
cd apps/api && NODE_OPTIONS=--max-old-space-size=8192 npx jest src/utils/date-string-day-bounds.guard.spec.ts --runInBand
```
คาดว่า: `Tests: 1 failed, 4 passed, 5 total` — เคส "ตัวค้นจับรูปแบบที่ต้องห้ามได้จริง" `Expected: ["SQL_DAY_NO_BKK"]  Received: []` (ยังไม่มีกฎ) · เคส "ไม่จับ…" ผ่าน (ยังไม่มีกฎจึงได้ `[]` ทุกบรรทัด)

- [ ] **Step 3: แก้โค้ด (กฎ + รายการอนุญาต)**

คอมเมนต์หัวไฟล์ (before → after):

```ts
// before
 * ทางที่ถูก: ตัวช่วยใน utils/date.util.ts — reportDayStart / reportDayEnd / reportAsOf / bangkokDateRange
 * (วันที่ 'YYYY-MM-DD' = วันตามปฏิทินไทย ไม่ขึ้นกับ TZ ของโปรเซส)
 *
 * เทสต์นี้สแกน apps/api/src/**\/*.ts (ไม่นับ *.spec.ts · __tests__/ · src/cli/ · utils/date.util.ts · คอมเมนต์)
 * หาสามรูปแบบ (RULES ข้างล่าง) ที่ต้องอยู่ใน ALLOWED พร้อมเหตุผลบรรทัดเดียว — เพิ่มรายการ = อธิบายในรีวิวว่าทำไม
```
```ts
// after
 * ทางที่ถูก: ตัวช่วยใน utils/date.util.ts — reportDayStart / reportDayEnd / reportAsOf / bangkokDateRange
 * (วันที่ 'YYYY-MM-DD' = วันตามปฏิทินไทย ไม่ขึ้นกับ TZ ของโปรเซส)
 *
 * กฎ SQL_DAY_NO_BKK (แผน ง 2026-11-18): raw SQL ที่แบ่งวัน/สัปดาห์/เดือน/ชั่วโมงด้วย date_trunc / EXTRACT / ::date / CURRENT_DATE
 * บนคอลัมน์ timestamp (เก็บ UTC) ตรง ๆ = แบ่งตาม UTC ช้ากว่าไทย 7 ชั่วโมง — ใช้ sqlBkkLocal / sqlBkkDate จาก
 * utils/bangkok-sql.util.ts (หรือ AT TIME ZONE ในบรรทัดเดียวกัน) · "วันนี้" ให้คำนวณใน JS แล้วส่งเป็นพารามิเตอร์
 *
 * เทสต์นี้สแกน apps/api/src/**\/*.ts (ไม่นับ *.spec.ts · __tests__/ · src/cli/ · utils/date.util.ts · คอมเมนต์)
 * หาสี่รูปแบบ (RULES ข้างล่าง) ที่ต้องอยู่ใน ALLOWED พร้อมเหตุผลบรรทัดเดียว — เพิ่มรายการ = อธิบายในรีวิวว่าทำไม
```

ท้าย `ALLOWED` (before → after):

```ts
// before
  'modules/promotions/promotions.service.ts#data.endDate = new Date(dto.endDate)':
    'แก้โปรโมชัน: เขียนวันเริ่ม/สิ้นสุดโปรโมชัน (เก็บค่า ไม่ใช่กรอง) — วันเริ่มคงเก็บเที่ยงคืน UTC ตามเดิม',
};
```
```ts
// after
  'modules/promotions/promotions.service.ts#data.endDate = new Date(dto.endDate)':
    'แก้โปรโมชัน: เขียนวันเริ่ม/สิ้นสุดโปรโมชัน (เก็บค่า ไม่ใช่กรอง) — วันเริ่มคงเก็บเที่ยงคืน UTC ตามเดิม',
  'modules/analytics/analytics.service.ts#EXTRACT(MONTH FROM AGE(activity_month, cohort_month))':
    'SQL_DAY_NO_BKK: นับเดือนห่างจาก AGE() ของสองค่าที่ตัดเดือนตามเวลาไทยแล้ว (cohort_month / activity_month) ไม่ได้อ่านคอลัมน์ timestamp ตรง',
  'modules/analytics/analytics.service.ts#EXTRACT(YEAR FROM AGE(activity_month, cohort_month))':
    'SQL_DAY_NO_BKK: นับปีห่างจาก AGE() ของสองค่าที่ตัดเดือนตามเวลาไทยแล้ว (cohort_month / activity_month) ไม่ได้อ่านคอลัมน์ timestamp ตรง',
  "modules/chat-analytics/chat-analytics-sql.ts#+INTERVAL '7 hours')::date":
    "SQL_DAY_NO_BKK: แปลงเป็นวันไทยด้วย + INTERVAL '7 hours' อยู่แล้ว (ไทยไม่มี DST — เท่ากับ AT TIME ZONE) สำหรับนาทีทำการของ SLA แชท",
};
```

`interface Rule` (before → after):

```ts
// before
interface Rule {
  id: 'RAW_PARSE' | 'TEMPLATE_NO_OFFSET' | 'UTC_MIDNIGHT';
  re: RegExp;
  hint: string;
}
```
```ts
// after
interface Rule {
  id: 'RAW_PARSE' | 'TEMPLATE_NO_OFFSET' | 'UTC_MIDNIGHT' | 'SQL_DAY_NO_BKK';
  re: RegExp;
  /** บรรทัดที่ตรง `re` แต่ตรง `ok` ด้วย = ถูกแล้ว (ไม่นับเป็น offender) */
  ok?: RegExp;
  hint: string;
}
```

ท้าย `RULES` (before → after):

```ts
// before
    hint: 'เที่ยงคืน UTC = 07:00 น. ไทย — ใช้ bangkokStartOfDay() / bangkokMidnight()',
  },
];
```
```ts
// after
    hint: 'เที่ยงคืน UTC = 07:00 น. ไทย — ใช้ bangkokStartOfDay() / bangkokMidnight()',
  },
  {
    id: 'SQL_DAY_NO_BKK',
    re: /date_trunc\(\s*'(?:hour|day|week|month|quarter|year)'|EXTRACT\(\s*(?:DOW|ISODOW|HOUR|DAY|DOY|WEEK|MONTH|QUARTER|YEAR)\s+FROM|(?<!['}])::date\b|\bCURRENT_DATE\b/i,
    ok: /AT TIME ZONE|sqlBkk(?:Local|Date)\(/i,
    hint: "คอลัมน์ timestamp เก็บ UTC — ห่อด้วย sqlBkkLocal()/sqlBkkDate() จาก utils/bangkok-sql.util · 'วันนี้' ส่งเป็นพารามิเตอร์ (bangkokDateString / bangkokStartOfDay)",
  },
];

const ruleHits = (rule: Rule, text: string): boolean => rule.re.test(text) && !rule.ok?.test(text);
```

`collectOffenders` (before → after):

```ts
// before
          if (rule.re.test(text)) out.push({ file, line: index + 1, rule: rule.id, text: text.trim() });
```
```ts
// after
          if (ruleHits(rule, text)) out.push({ file, line: index + 1, rule: rule.id, text: text.trim() });
```

`flaggedRules` (before → after):

```ts
// before
  RULES.filter((rule) => rule.re.test(code(line))).map((rule) => rule.id);
```
```ts
// after
  RULES.filter((rule) => ruleHits(rule, code(line))).map((rule) => rule.id);
```

(กฎเดิมสามข้อไม่มี `ok` ⇒ `ruleHits` ให้ผลเท่า `rule.re.test` เดิม · regex ไม่มี flag `g` จึงไม่มีปัญหา `lastIndex`)

- [ ] **Step 4: รันให้ผ่าน + ตรวจรายการ**

```
cd apps/api && NODE_OPTIONS=--max-old-space-size=8192 npx jest src/utils/date-string-day-bounds.guard.spec.ts --runInBand
cd apps/api && TZ=UTC NODE_OPTIONS=--max-old-space-size=8192 npx jest src/utils/date-string-day-bounds.guard.spec.ts --runInBand
```
คาดว่า: ทั้งสองรอบ `Tests: 5 passed, 5 total`

ตรวจว่ากฎใหม่เหลือเฉพาะ 3 บรรทัดที่อนุญาต:
```
cd apps/api && DATE_GUARD_LIST=1 NODE_OPTIONS=--max-old-space-size=8192 npx jest src/utils/date-string-day-bounds.guard.spec.ts --runInBand 2>&1 | grep SQL_DAY_NO_BKK
```
คาดว่า: 3 บรรทัด ขึ้นต้นด้วย `ALLOWED` ทั้งหมด — `modules/analytics/analytics.service.ts:49` (EXTRACT MONTH) · `:50` (EXTRACT YEAR) · `modules/chat-analytics/chat-analytics-sql.ts:15` (เลขบรรทัดของ `analytics.service.ts` เลื่อน +1 จาก import ของ Task 5)

ตรวจว่ากฎดักได้จริง (ทำแล้วย้อนกลับ ห้าม commit): เปลี่ยนบรรทัด `date_trunc('day', ${sqlBkkLocal('created_at')})::date AS day,` ใน `modules/overdue/analytics.service.ts` กลับเป็น `date_trunc('day', created_at)::date AS day,` ชั่วคราว → เทสต์ข้อแรกต้องแดงพร้อม `modules/overdue/analytics.service.ts:<บรรทัด> [SQL_DAY_NO_BKK] …` → ย้อนกลับ (`git checkout -- apps/api/src/modules/overdue/analytics.service.ts`)

ตรวจรวมทั้งแผน:
```
cd apps/api && NODE_OPTIONS=--max-old-space-size=8192 npx jest src/utils/bangkok-sql.util.spec.ts src/modules/overdue/analytics src/modules/analytics/ src/utils/payment-watch-risk src/modules/customers/services/customer-analytics.service.watch-list.spec.ts src/modules/dashboard/services/dashboard-collections.service.watch-list.spec.ts src/modules/finance-receivable-contact-logs/crons/ src/utils/date-string-day-bounds.guard.spec.ts --runInBand
cd apps/api && TZ=UTC NODE_OPTIONS=--max-old-space-size=8192 npx jest src/utils/bangkok-sql.util.spec.ts src/modules/overdue/analytics src/modules/analytics/ src/utils/payment-watch-risk src/modules/customers/services/customer-analytics.service.watch-list.spec.ts src/modules/dashboard/services/dashboard-collections.service.watch-list.spec.ts src/modules/finance-receivable-contact-logs/crons/ src/utils/date-string-day-bounds.guard.spec.ts --runInBand
cd apps/api && NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit -p tsconfig.json
```
คาดว่า: jest ทั้งสองรอบผ่านทั้งหมด (รวม `analytics-recovery.service.spec.ts` ที่ path `src/modules/overdue/analytics` ดึงมาด้วย — ไม่ได้แก้) · tsc ไม่มี error

- [ ] **Step 5: Commit**

```
git add apps/api/src/utils/date-string-day-bounds.guard.spec.ts
git commit -m "ตัวกันถอยหลัง: เพิ่มกฎห้าม raw SQL แบ่งวัน/สัปดาห์/เดือน/ชั่วโมงตาม UTC (date_trunc/EXTRACT/::date/CURRENT_DATE) นอกรายการที่อนุญาต

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## ตรวจแล้วไม่ต้องแก้

| จุด (นับจาก `apps/api/src/`) | เหตุผล |
|---|---|
| `modules/chatbot-finance/services/admin-analytics.service.ts:102,107,143,151` | ถูกแล้ว — `date_trunc('day', (cm.created_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Bangkok')` (แผน ค) · ไม่ย้ายมาใช้ตัวช่วยเพื่อไม่แตะเทสต์ของแผน ค (`admin-analytics.service.*.spec.ts` นับ `AT TIME ZONE` ในข้อความ template) · ตัวกันผ่านเพราะบรรทัดมี `AT TIME ZONE` |
| `modules/customer-journey/sources/chat.source.ts:55` | ถูกแล้ว — `to_char(((m.created_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Bangkok')::date, 'YYYY-MM-DD')` |
| `modules/chat-analytics/chat-analytics-sql.ts:13,15` | ถูกแล้ว — `(${at}+INTERVAL '7 hours')` = เวลาไทย (ไทยไม่มี DST) · บรรทัด 13 เป็น `EXTRACT(EPOCH …)` (ไม่ถูกกฎจับ) · บรรทัด 15 อยู่ในรายการอนุญาตของ Task 8 |
| `modules/analytics/analytics.service.ts:48-49` | `EXTRACT(MONTH/YEAR FROM AGE(activity_month, cohort_month))` — นับระยะห่างของสองค่าที่ Task 5 ตัดเดือนตามเวลาไทยแล้ว (รายการอนุญาตของ Task 8) |
| `modules/analytics/analytics.service.ts:116` · `:202` | `NOW() - INTERVAL '6 months'` / `NOW() - (${months} || ' months')::interval` — หน้าต่างย้อนหลังแบบเลื่อนตามเวลา ไม่ใช่ขอบวัน (เดือนแรกของช่วงเป็นเดือนไม่เต็มอยู่แล้วตามเดิม) |
| `modules/attendance/attendance-device.service.ts:256` · `attendance.service.ts:319` · `kiosk-punch.service.ts:189` | `${workDate}::date` — แปลงพารามิเตอร์ JS เทียบกับ `work_date` ที่เป็น `@db.Date` (นอกขอบเขต) · ไม่ถูกกฎจับเพราะ `::date` ตามหลัง `}` |
| `modules/products/products-stock-sort.ts:45` | `'0001-01-01'::date` — ค่าคงที่ไว้เรียงลำดับ ไม่ใช่คอลัมน์เวลา |
| `modules/loyalty/loyalty-sale-proof.ts:162` | `date_trunc('milliseconds', transaction_timestamp() AT TIME ZONE 'UTC')` — ตัดความละเอียดเป็นมิลลิวินาที ไม่ใช่หน่วยปฏิทิน และแปลงเป็น UTC แล้ว |
| `modules/overdue/services/overdue-lifecycle-cron.service.ts:67` | `FLOOR(EXTRACT(EPOCH FROM (${now}::timestamp - "due_date")) / 86400)` — ระยะเวลาที่ผ่านไป · `due_date` เก็บเที่ยงคืนไทยจึงได้จำนวนวันไทยพอดี · ส่ง `now` เป็น `::timestamp` อยู่แล้ว |
| `modules/overdue/analytics-leaderboard.service.ts:62-63,67,72,76` | `settlement_date < NOW()` / `called_at >= NOW() - INTERVAL '90 days'` = เทียบ instant แบบเลื่อนตามเวลา (session prod = UTC ⇒ ถูก) · `EXTRACT(EPOCH FROM (cl.called_at - c.created_at))` = ระยะเวลา |
| `modules/overdue/analytics-aging.service.ts:63` · `modules/dashboard/services/dashboard-collections.service.ts:232` | `p.due_date < NOW()` — เลือกงวดที่เลยเวลาครบกำหนดแล้ว (เทียบ instant ไม่ใช่การแบ่งวัน · ถูกบน prod ที่ session = UTC) · ข้อสังเกต: งวดที่ครบกำหนด "วันนี้" ผ่านเงื่อนไขตั้งแต่ 00:00 น. — ใน aging ไม่มีผลต่อช่อง (อายุ 0 วันไม่เข้าช่องใด) แต่ยอดของงวดวันนี้ถูกรวมใน `outstanding` ของสัญญาที่ค้างอยู่แล้ว และ "ลูกค้าค้างมากสุด 10 อันดับ" ของแดชบอร์ดรวมยอดงวดวันนี้ — ถ้าต้องการให้ตรงคำตัดสิน "พลาดหลังสิ้นวันครบกำหนด" (Task 30 รอบ 5 · `consecutive-missed.service.ts`) ให้ทำเป็นงานแยก |
| `modules/overdue/stuck-contracts.service.ts:96` | `NOW() - ($1::int * INTERVAL '1 day')` — หน้าต่าง N วันแบบเลื่อนตามเวลา |
| `modules/overdue/analytics.service.ts:103,136,166,196,225` | ขอบ `>= ${since}` ผูก `Date` ตรง (Prisma ผูกเป็น timestamptz แล้วแปลงตาม session) — ถูกบน prod ที่ session = UTC · ค่า `since` เป็นเที่ยงคืนไทยอยู่แล้ว · ไม่เปลี่ยนในแผนนี้เพื่อให้ diff ของ Task 2 เล็ก (ถ้า session ฐานบนเครื่องเป็น Asia/Bangkok ขอบจะเลื่อน 7 ชั่วโมงเฉพาะบนเครื่อง) |
| `modules/chatbot-finance/services/verification.service.ts:534` | `expires_at < (now() AT TIME ZONE 'UTC')` — ถูกแล้ว |
| `modules/finance-receivable-contact-logs/crons/broken-promise-finance.cron.ts:19` | `SET promised_broken_at = now()` — เขียนเวลาที่ตัดผิดนัด (session prod = UTC ⇒ เก็บ UTC ถูก) ไม่ใช่ขอบวัน · ไม่แตะใน Task 7 |
| `modules/staff-chat/cron/embedding-backfill.cron.ts:134,144` | `embedded_at = NOW()` — เวลาภายในของงาน embedding ไม่มีหน้าจอแสดง |
| `modules/chat-history-extractor/*.ts` (`extract(`) | ชื่อเมธอด JS ไม่ใช่ SQL `EXTRACT` |
| `modules/customer-journey/sql/*.sql` | ไม่มี `date_trunc` / `EXTRACT` / `::date` / `CURRENT_DATE` (มีแต่คอมเมนต์ห้าม `now()`) |
| `apps/api/prisma/migrations/20261103000000_recurring_bill_occurrences/migration.sql:16` | migration รันครั้งเดียว (อยู่นอก `src`) และใช้ `AT TIME ZONE 'Asia/Bangkok'` แล้ว |
| `modules/analytics/analytics.service.ts:156-159` (เดือนพยากรณ์ใน JS) | `new Date(year, month - 1 + i, 1)` แล้วอ่าน `getFullYear/getMonth` แบบ local ทั้งคู่ ⇒ ได้ `YYYY-MM` เดียวกันทุก TZ |
| **พบแต่ไม่อยู่ในขอบเขต:** `modules/dashboard/services/dashboard-collections.service.ts:329-331` | `computeWatchList` JOIN `payments p` กับ `payments p2` (งวดค้าง) ในระดับเดียวกันแล้ว `COUNT(p.id)` ไม่มี `DISTINCT` ⇒ จำนวนงวดล่าช้า/จ่ายไม่ครบถูกคูณด้วยจำนวนงวดที่ยังค้าง (เช่น ล่าช้าจริง 2 งวด ค้างอีก 8 งวด → นับ 16 → เหตุผล "ชำระล่าช้า 16 ครั้ง") และ `p` ไม่กรอง `deleted_at` — `customer-analytics.service.ts` (`/customers/watch-list`) ใช้ `COUNT(DISTINCT p.id)` + subquery แล้ว · เป็นบั๊กคนละชนิดกับแผนนี้ เสนอทำเป็นงานแยก |

## ต้องให้เจ้าของตัดสิน

1. **"ชำระล่าช้า" ในรายชื่อลูกค้าเฝ้าระวัง (Task 6)** — แดชบอร์ดผู้บริหาร (การ์ดลูกค้าเฝ้าระวัง) นับงวดที่ "จ่ายล่าช้า" เพื่อจัดระดับความเสี่ยง · วันนี้ลูกค้าที่จ่าย **ตรงวันครบกำหนดหลัง 7 โมงเช้า** ถูกนับว่าล่าช้า (เพราะระบบตัดวันตามเวลาสากล) · ตัวเลือก (ก) **ล่าช้า = จ่ายหลังวันครบกำหนดตามปฏิทินไทย (จ่ายภายในวันครบกำหนด = ตรงเวลา)** — ค่าเริ่มต้นในแผน (ข) แบบอื่น เช่น ให้เวลาผ่อนผัน N วันก่อนนับว่าล่าช้า (บอกจำนวนวัน) — ถ้าเลือก (ข) เปลี่ยนเฉพาะค่าคงที่ `LATE_PAYMENT_SQL` ใน Task 6
2. **ตัด "ผิดนัด" ของนัดโอนลูกหนี้ไฟแนนซ์ (Task 7)** — วันนี้นัดที่เลยวันแล้วถูกตัดเป็น "ผิดนัด" ช้าไปหนึ่งวัน (นัดวันที่ 18 ถูกตัดตอนตี 2 ของวันที่ 20) · ตัวเลือก (ก) **ตัดตอนตี 2 ของวันถัดจากวันนัด (หมดวันนัดแล้ว)** — ค่าเริ่มต้นในแผน (ข) คงพฤติกรรมเดิม = เผื่ออีกหนึ่งวันก่อนตัด — ถ้าเลือก (ข) ให้ตัด Task 7 ออก (ตัวกันจะจับ `CURRENT_DATE` — ต้องเพิ่มรายการอนุญาต `modules/finance-receivable-contact-logs/crons/broken-promise-finance.cron.ts#WHERE promised_date < CURRENT_DATE` พร้อมเหตุผล "เจ้าของเลือกเผื่อ 1 วัน")
3. *(แจ้งเพื่อทราบ ไม่ต้องตอบ)* กราฟรายสัปดาห์ของหน้าติดตามหนี้เริ่มสัปดาห์ **วันจันทร์** เหมือนเดิม (ป้ายแกนเป็นวันที่ของวันจันทร์ เช่น "11-16") — แผนนี้เปลี่ยนแค่ให้คืนวันอาทิตย์ 00:00-06:59 น. นับเป็นสัปดาห์เดิมแทนสัปดาห์ถัดไป ถ้าอยากให้เริ่มวันอาทิตย์ค่อยบอก

## ผลต่อผู้ใช้

- **เจ้าของ (OWNER) และ ผจก.การเงิน (FINANCE_MANAGER)** — หน้า **ติดตามหนี้** (`/collections`) แท็บ **วิเคราะห์**:
  - กราฟ "อัตราการเก็บเงินรายสัปดาห์" · "ตามนัด/ผิดนัด" (รายสัปดาห์) · การทวงถามรายวัน · คำขอล็อกเครื่องรายวัน · หนังสือที่ส่งรายเดือน — รายการที่เกิดช่วงเที่ยงคืนถึงตี 7 ย้ายไปอยู่วัน/สัปดาห์/เดือนที่ถูกต้อง (เดิมไปอยู่วันก่อนหน้า) · ยอดรวมทั้งช่วงไม่เปลี่ยน แค่แท่งขยับ
  - กราฟ **อายุหนี้** (เห็นได้ทั้งเจ้าของ ผจก.การเงิน และ **ผจก.สาขา** — เฉพาะสาขาตัวเอง): สัญญาที่ค้างมาครบ 7/30/60/90 วันพอดีจะย้ายลงไปช่องที่ต่ำกว่าหนึ่งช่อง (เดิมอายุหนี้เกินจริงหนึ่งวันตลอดช่วง 7 โมงเช้า–เที่ยงคืน) · ตัวเลขตรงกับ "เกินกำหนด X วัน" ในคิวที่กดแท่งแล้วพาไป
  - เฉพาะเจ้าของ: ตาราง **ผลงานผู้ติดตาม** ช่อง "ยอดเก็บเดือนนี้" — รวมเงินที่รับช่วงเที่ยงคืนถึงตี 7 ของวันที่ 1 (เดิมหาย) และตอนเช้ามืดวันที่ 1 ตารางเริ่มนับเดือนใหม่ทันที (เดิมยังโชว์ยอดของเดือนก่อนจนถึง 7 โมงเช้า)
- **เจ้าของ** — หน้า **วิเคราะห์ภาพรวม** (`/analytics`):
  - แท็บ **ความหนาแน่นของยอดขาย**: ช่องชั่วโมงเลื่อนมาตรงเวลาไทย (เดิมขาย 10 โมงไปอยู่ช่อง 3 โมง · ช่วงเปิดร้านจะย้ายจากช่อง 2-13 มาเป็น 9-20) · ยอดขายช่วงเที่ยงคืนถึงตี 7 ย้ายไปวันในสัปดาห์ที่ถูก · "ชั่วโมงขายดีที่สุด" เปลี่ยนเป็นเวลาไทยจริง
  - แท็บ **การกลับมาของลูกค้าแต่ละกลุ่ม** และ **คาดการณ์รายได้**: ยอดรับชำระ/สัญญาที่เกิดช่วงเที่ยงคืนถึงตี 7 ของวันที่ 1 ย้ายไปเดือนที่ถูก — ตัวเลขรายเดือนและเส้นพยากรณ์ขยับเล็กน้อย
- **เจ้าของ / ผจก.สาขา / ผจก.การเงิน / ฝ่ายบัญชี** — **แดชบอร์ดผู้บริหาร** การ์ด **ลูกค้าเฝ้าระวัง**: ลูกค้าที่จ่ายตรงวันครบกำหนดไม่ถูกนับว่า "ชำระล่าช้า" อีก (ตามข้อ 1 ของ "ต้องให้เจ้าของตัดสิน") ⇒ บางรายหลุดจากรายการหรือระดับความเสี่ยงลดลง · `/customers/watch-list` (ยังไม่มีหน้าเว็บเรียก) ได้ผลแบบเดียวกัน
- **เจ้าของ / ผจก.สาขา / ผจก.การเงิน / ฝ่ายบัญชี** — หน้า **ลูกหนี้ไฟแนนซ์** (`/finance-receivable`) ไทม์ไลน์การติดต่อ: ป้าย "ผิดนัด" (สีแดง) ของนัดโอนขึ้นเร็วขึ้นหนึ่งวัน = ตอนตี 2 ของวันถัดจากวันนัด (ตามข้อ 2)
- **ผู้พัฒนา**: ตัวกันถอยหลังจะทำให้ CI แดงทันทีที่มีใครเขียน `date_trunc('day', col)` / `EXTRACT(HOUR FROM col)` / `col::date` / `CURRENT_DATE` ใน raw SQL ของ `apps/api/src` โดยไม่ใช้ `sqlBkkLocal` / `sqlBkkDate` หรือ `AT TIME ZONE`
- ไม่มีข้อมูลเดิมถูกแก้ · ไม่มีหน้าเว็บ/เมนู/สิทธิ์เปลี่ยน · เว็บไม่ต้อง deploy ใหม่ (ทุกหน้าแสดงค่าที่ API คืนด้วยการตัดสตริง เช่น `weekStart.slice(5, 10)` · `d.date.slice(5, 10)` · `m.slice(0, 7)` ใน `CollectionsPage/tabs/AnalyticsTab.tsx` และตัวเลข `hour` / `day` / `month` ตรง ๆ ใน `AnalyticsPage.tsx` — ไม่มีการแปลงเป็น `Date` ที่ขึ้นกับ TZ ของเบราว์เซอร์)
