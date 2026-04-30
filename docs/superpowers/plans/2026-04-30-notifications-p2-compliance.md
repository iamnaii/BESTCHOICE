# Notifications P2 — Compliance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hard-block every non-compliant notification send (พ.ร.บ.ทวงถามหนี้ + พ.ร.บ.PDPA) — time windows, holidays, frequency cap, consent, identification — before BESTCHOICE notifications can legally go-live to real customers.

**Architecture:** New `ComplianceService.canSend()` is the single decision point. `NotificationsService.send()` calls it for customer-facing categories (DUNNING/REMINDER/MARKETING). Out-of-hours sends auto-route to `status='DELAYED'` queue → existing 5-min retry cron resumes them at the next legal window. Schema gains `customerId`, `category`, `blockReason` on `NotificationLog`. All 20 crons in `scheduler.service.ts` get explicit `{ timeZone: 'Asia/Bangkok' }`.

**Tech Stack:** NestJS + Prisma + PostgreSQL (apps/api), React + Vite (apps/web), Vitest (tests), `process.env.TZ='Asia/Bangkok'` already set in main.ts.

**Spec:** `docs/superpowers/specs/2026-04-30-notifications-p2-compliance-design.md`

---

## File Map

**New files (api):**
- `apps/api/src/modules/notifications/compliance.service.ts`
- `apps/api/src/modules/notifications/compliance.service.spec.ts`
- `apps/api/src/modules/notifications/holiday.service.ts`
- `apps/api/src/modules/notifications/holiday.service.spec.ts`
- `apps/api/src/modules/notifications/notification-category.enum.ts`
- `apps/api/src/data/thai-holidays.json`
- `apps/api/src/utils/business-hours.util.ts`
- `apps/api/src/utils/business-hours.util.spec.ts`

**Modified (api):**
- `apps/api/prisma/schema.prisma` — NotificationLog +3 cols
- `apps/api/src/modules/notifications/notifications.module.ts` — provide new services
- `apps/api/src/modules/notifications/notifications.service.ts` — wire ComplianceService into send()
- `apps/api/src/modules/notifications/notifications.controller.ts` — new stats endpoint
- `apps/api/src/modules/notifications/scheduler.service.ts` — `{ timeZone: 'Asia/Bangkok' }` × 20 + retention
- `apps/api/src/modules/notifications/dto/create-notification.dto.ts` — add category, customerId, bypassCompliance
- ~30 call sites across modules — pass category + customerId

**New runbook:**
- `docs/runbooks/notifications-compliance.md`

**Modified runbook:**
- `docs/runbooks/notifications-incident.md` — new failure modes

---

## Phase 1 — Schema Foundation (Day 1)

### Task 1: Add compliance fields to NotificationLog

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (NotificationLog model around line 1802)
- Create: `apps/api/prisma/migrations/<timestamp>_add_notification_log_compliance_fields/migration.sql`

- [ ] **Step 1: Update Prisma schema**

In `apps/api/prisma/schema.prisma`, find the `NotificationLog` model and add 3 fields + 2 indexes:

```prisma
model NotificationLog {
  // ...existing fields preserved unchanged
  customerId  String?  @map("customer_id")
  category    String?  @map("category")    // DUNNING | REMINDER | TRANSACTIONAL | STAFF | MARKETING
  blockReason String?  @map("block_reason") // OUTSIDE_HOURS | FREQUENCY_CAP | NO_CONSENT | HOLIDAY_BLOCK
  // ...existing indexes preserved
  @@index([customerId, relatedId, category, sentAt])
  @@index([category, sentAt])
}
```

- [ ] **Step 2: Generate migration**

```bash
cd apps/api && npx prisma migrate dev --name add_notification_log_compliance_fields --create-only
```

- [ ] **Step 3: Verify migration SQL is safe (ADD COLUMN only, no destructive ops)**

Read the generated `migration.sql`. Expected pattern:
```sql
ALTER TABLE "notification_logs" ADD COLUMN "customer_id" TEXT;
ALTER TABLE "notification_logs" ADD COLUMN "category" TEXT;
ALTER TABLE "notification_logs" ADD COLUMN "block_reason" TEXT;
CREATE INDEX "notification_logs_customer_id_related_id_category_sent_at_idx" ON "notification_logs"("customer_id", "related_id", "category", "sent_at");
CREATE INDEX "notification_logs_category_sent_at_idx" ON "notification_logs"("category", "sent_at");
```

- [ ] **Step 4: Apply migration**

```bash
cd apps/api && npx prisma migrate dev
```

Expected: success.

- [ ] **Step 5: Regenerate Prisma client**

```bash
cd apps/api && npx prisma generate
```

- [ ] **Step 6: Commit**

```bash
git add apps/api/prisma/
git commit -m "feat(schema): add compliance fields to NotificationLog

customerId, category, blockReason columns + 2 indexes for
ComplianceService frequency-cap queries.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: NotificationCategory enum + DTO updates

**Files:**
- Create: `apps/api/src/modules/notifications/notification-category.enum.ts`
- Modify: `apps/api/src/modules/notifications/dto/create-notification.dto.ts`

- [ ] **Step 1: Create enum file**

```typescript
// apps/api/src/modules/notifications/notification-category.enum.ts

export enum NotificationCategory {
  DUNNING = 'DUNNING',             // ทวงถามหนี้ — strict (8-20 weekday, 8-18 weekend) + frequency cap
  REMINDER = 'REMINDER',           // เตือนก่อนงวด — strict windows + PDPA, no cap
  TRANSACTIONAL = 'TRANSACTIONAL', // ใบเสร็จ, payment success — bypassed (performance of contract)
  STAFF = 'STAFF',                 // staff/owner alerts — bypass time windows
  MARKETING = 'MARKETING',         // promo — strict + opt-in
}

export const COMPLIANCE_CHECKED_CATEGORIES = new Set<NotificationCategory>([
  NotificationCategory.DUNNING,
  NotificationCategory.REMINDER,
  NotificationCategory.MARKETING,
]);

export const FREQUENCY_CAP_CATEGORIES = new Set<NotificationCategory>([
  NotificationCategory.DUNNING,
]);
```

- [ ] **Step 2: Update DTO**

In `apps/api/src/modules/notifications/dto/create-notification.dto.ts`, add fields to `SendNotificationDto`:

```typescript
import { IsBoolean, IsEnum, IsOptional, IsString, IsUUID, ValidateIf } from 'class-validator';
import { NotificationChannel } from '@prisma/client';
import { NotificationCategory } from '../notification-category.enum';

export type LineChannelKey = 'line-shop' | 'line-finance' | 'line-staff';
export const LINE_CHANNEL_KEYS: LineChannelKey[] = ['line-shop', 'line-finance', 'line-staff'];

export class SendNotificationDto {
  @IsEnum(['LINE', 'SMS', 'IN_APP'])
  channel!: NotificationChannel;

  @ValidateIf((o) => o.channel === 'LINE')
  @IsEnum(LINE_CHANNEL_KEYS, { message: 'channelKey จำเป็นสำหรับ LINE' })
  channelKey!: LineChannelKey;

  @IsString()
  recipient!: string;

  @IsString()
  @IsOptional()
  subject?: string;

  @IsString()
  message!: string;

  @IsString()
  @IsOptional()
  relatedId?: string;

  @IsString()
  @IsOptional()
  fallbackPhone?: string;

  @IsBoolean()
  @IsOptional()
  noRetry?: boolean;

  // ===== NEW (P2 compliance) =====

  @IsUUID()
  @IsOptional()
  customerId?: string;             // for frequency cap + PDPA lookup

  @IsEnum(NotificationCategory)
  @IsOptional()
  category?: NotificationCategory; // determines compliance rules

  @IsBoolean()
  @IsOptional()
  bypassCompliance?: boolean;      // system override for TRANSACTIONAL/STAFF
}
```

- [ ] **Step 3: Type check**

```bash
cd apps/api && npx tsc --noEmit 2>&1 | grep -E "create-notification|notification-category" | head -5
```
Expected: 0 errors

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/notifications/notification-category.enum.ts apps/api/src/modules/notifications/dto/
git commit -m "feat(notifications): NotificationCategory enum + DTO compliance fields

Adds DUNNING/REMINDER/TRANSACTIONAL/STAFF/MARKETING categories.
SendNotificationDto gains customerId, category, bypassCompliance.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase 2 — Building Blocks (Day 2)

### Task 3: Thai holidays JSON + HolidayService

**Files:**
- Create: `apps/api/src/data/thai-holidays.json`
- Create: `apps/api/src/modules/notifications/holiday.service.ts`
- Create: `apps/api/src/modules/notifications/holiday.service.spec.ts`

- [ ] **Step 1: Create Thai holidays JSON for 2026 + 2027**

```json
// apps/api/src/data/thai-holidays.json
{
  "2026": [
    "2026-01-01",
    "2026-02-12",
    "2026-04-06",
    "2026-04-13",
    "2026-04-14",
    "2026-04-15",
    "2026-05-01",
    "2026-05-04",
    "2026-05-25",
    "2026-06-03",
    "2026-07-08",
    "2026-07-09",
    "2026-07-30",
    "2026-08-12",
    "2026-10-13",
    "2026-10-23",
    "2026-12-05",
    "2026-12-10",
    "2026-12-31"
  ],
  "2027": [
    "2027-01-01",
    "2027-02-26",
    "2027-04-06",
    "2027-04-13",
    "2027-04-14",
    "2027-04-15",
    "2027-05-01",
    "2027-05-21",
    "2027-06-03",
    "2027-07-29",
    "2027-08-12",
    "2027-10-13",
    "2027-10-23",
    "2027-12-06",
    "2027-12-10",
    "2027-12-31"
  ]
}
```

- [ ] **Step 2: Write failing test**

```typescript
// apps/api/src/modules/notifications/holiday.service.spec.ts
import { HolidayService } from './holiday.service';

describe('HolidayService', () => {
  let service: HolidayService;
  beforeEach(() => { service = new HolidayService(); });

  it('isHoliday returns true for Thai New Year', () => {
    expect(service.isHoliday(new Date('2026-01-01T03:00:00Z'))).toBe(true);
  });

  it('isHoliday returns true for Songkran (April 13-15)', () => {
    expect(service.isHoliday(new Date('2026-04-13T03:00:00Z'))).toBe(true);
    expect(service.isHoliday(new Date('2026-04-14T03:00:00Z'))).toBe(true);
    expect(service.isHoliday(new Date('2026-04-15T03:00:00Z'))).toBe(true);
  });

  it('isHoliday returns false for a normal weekday', () => {
    expect(service.isHoliday(new Date('2026-05-15T03:00:00Z'))).toBe(false); // Friday
  });

  it('isHoliday returns false for a year without seed data', () => {
    expect(service.isHoliday(new Date('2030-01-01T03:00:00Z'))).toBe(false);
  });

  it('respects Asia/Bangkok day boundaries', () => {
    // 2025-12-31 23:30 UTC = 2026-01-01 06:30 ICT = New Year holiday in Thailand
    expect(service.isHoliday(new Date('2025-12-31T23:30:00Z'))).toBe(true);
  });
});
```

- [ ] **Step 3: Run test — verify fail**

```bash
cd apps/api && npx jest --testPathPattern=holiday.service.spec 2>&1 | tail -10
```
Expected: FAIL — module not found

- [ ] **Step 4: Implement HolidayService**

```typescript
// apps/api/src/modules/notifications/holiday.service.ts
import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class HolidayService {
  private readonly holidaysByYear: Record<string, Set<string>>;

  constructor() {
    const jsonPath = path.join(__dirname, '..', '..', 'data', 'thai-holidays.json');
    const raw = JSON.parse(fs.readFileSync(jsonPath, 'utf-8')) as Record<string, string[]>;
    this.holidaysByYear = Object.fromEntries(
      Object.entries(raw).map(([year, dates]) => [year, new Set(dates)]),
    );
  }

  /**
   * Returns true if the given Date falls on a Thai public holiday.
   * Date is interpreted in Asia/Bangkok timezone (process.env.TZ must be set).
   */
  isHoliday(date: Date): boolean {
    const dateStr = this.toBangkokDateString(date);
    const year = dateStr.slice(0, 4);
    return this.holidaysByYear[year]?.has(dateStr) ?? false;
  }

  /** Format Date as YYYY-MM-DD in Asia/Bangkok timezone. */
  private toBangkokDateString(date: Date): string {
    // process.env.TZ='Asia/Bangkok' is set in main.ts so toISOString uses local time only via toLocaleDateString
    const year = date.toLocaleString('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric' });
    const month = date.toLocaleString('en-CA', { timeZone: 'Asia/Bangkok', month: '2-digit' });
    const day = date.toLocaleString('en-CA', { timeZone: 'Asia/Bangkok', day: '2-digit' });
    return `${year}-${month}-${day}`;
  }
}
```

- [ ] **Step 5: Run test — verify pass**

```bash
cd apps/api && npx jest --testPathPattern=holiday.service.spec 2>&1 | tail -10
```
Expected: 5 tests pass

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/data/thai-holidays.json apps/api/src/modules/notifications/holiday.service.ts apps/api/src/modules/notifications/holiday.service.spec.ts
git commit -m "feat(notifications): HolidayService + Thai holidays 2026-2027

JSON-based holiday lookup. O(1) check via Set. Asia/Bangkok timezone.
Manual yearly update — owner reminder when ครม. announces next year.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Business hours utility

**Files:**
- Create: `apps/api/src/utils/business-hours.util.ts`
- Create: `apps/api/src/utils/business-hours.util.spec.ts`

- [ ] **Step 1: Write failing test**

```typescript
// apps/api/src/utils/business-hours.util.spec.ts
import { isWithinBusinessHours, nextBusinessHourOpen } from './business-hours.util';

describe('business-hours.util', () => {
  describe('isWithinBusinessHours', () => {
    it('weekday 10:00 ICT — within hours', () => {
      // 2026-05-04 (Monday) 10:00 ICT = 03:00 UTC
      expect(isWithinBusinessHours(new Date('2026-05-04T03:00:00Z'), false)).toBe(true);
    });

    it('weekday 19:59 ICT — within hours', () => {
      // 2026-05-04 (Monday) 19:59 ICT = 12:59 UTC
      expect(isWithinBusinessHours(new Date('2026-05-04T12:59:00Z'), false)).toBe(true);
    });

    it('weekday 20:01 ICT — outside hours', () => {
      // 2026-05-04 (Monday) 20:01 ICT = 13:01 UTC
      expect(isWithinBusinessHours(new Date('2026-05-04T13:01:00Z'), false)).toBe(false);
    });

    it('weekday 07:59 ICT — outside hours', () => {
      // 2026-05-04 (Monday) 07:59 ICT = 00:59 UTC
      expect(isWithinBusinessHours(new Date('2026-05-04T00:59:00Z'), false)).toBe(false);
    });

    it('weekend 17:59 ICT — within hours (treated as weekend)', () => {
      // 2026-05-09 (Saturday) 17:59 ICT = 10:59 UTC
      expect(isWithinBusinessHours(new Date('2026-05-09T10:59:00Z'), true)).toBe(true);
    });

    it('weekend 18:01 ICT — outside hours', () => {
      // 2026-05-09 (Saturday) 18:01 ICT = 11:01 UTC
      expect(isWithinBusinessHours(new Date('2026-05-09T11:01:00Z'), true)).toBe(false);
    });

    it('weekend 08:00 ICT — within hours (boundary)', () => {
      // 2026-05-09 (Saturday) 08:00 ICT = 01:00 UTC
      expect(isWithinBusinessHours(new Date('2026-05-09T01:00:00Z'), true)).toBe(true);
    });
  });

  describe('nextBusinessHourOpen', () => {
    it('weekday 22:00 → next day 08:00 ICT', () => {
      // 2026-05-04 (Monday) 22:00 ICT = 15:00 UTC → expects 2026-05-05 08:00 ICT = 01:00 UTC
      const result = nextBusinessHourOpen(new Date('2026-05-04T15:00:00Z'), false);
      expect(result.toISOString()).toBe('2026-05-05T01:00:00.000Z');
    });

    it('weekday 06:00 → same day 08:00 ICT', () => {
      // 2026-05-04 (Monday) 06:00 ICT = 23:00 prev UTC
      const result = nextBusinessHourOpen(new Date('2026-05-03T23:00:00Z'), false);
      expect(result.toISOString()).toBe('2026-05-04T01:00:00.000Z');
    });
  });
});
```

- [ ] **Step 2: Run test — verify fail**

```bash
cd apps/api && npx jest --testPathPattern=business-hours.util.spec 2>&1 | tail -10
```
Expected: FAIL

- [ ] **Step 3: Implement utility**

```typescript
// apps/api/src/utils/business-hours.util.ts

/**
 * Returns true if `date` is within Thai business hours per พ.ร.บ.ทวงถามหนี้ มาตรา 9.
 * Weekday: 08:00 - 20:00 ICT (Mon-Fri)
 * Weekend or holiday: 08:00 - 18:00 ICT
 *
 * Date is interpreted in Asia/Bangkok timezone.
 */
export function isWithinBusinessHours(date: Date, isWeekendOrHoliday: boolean): boolean {
  const hour = parseInt(
    date.toLocaleString('en-US', { timeZone: 'Asia/Bangkok', hour: '2-digit', hour12: false }),
    10,
  );
  const minute = parseInt(
    date.toLocaleString('en-US', { timeZone: 'Asia/Bangkok', minute: '2-digit' }),
    10,
  );
  const totalMinutes = hour * 60 + minute;

  const startMinutes = 8 * 60; // 08:00
  const endMinutes = isWeekendOrHoliday ? 18 * 60 : 20 * 60;

  return totalMinutes >= startMinutes && totalMinutes < endMinutes;
}

/**
 * Returns the next 08:00 ICT after `date`. If `date` is before 08:00 today, returns today 08:00.
 * Otherwise returns next day 08:00.
 *
 * Note: caller is responsible for checking if "next day" is a holiday/weekend and adjusting if needed.
 */
export function nextBusinessHourOpen(date: Date, _isWeekendOrHoliday: boolean): Date {
  const localStr = date.toLocaleString('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  // localStr like "2026-05-04, 22:00"
  const [datePart, timePart] = localStr.split(', ');
  const hour = parseInt(timePart.split(':')[0], 10);

  // Determine target day in ICT
  let targetDateStr: string;
  if (hour < 8) {
    targetDateStr = datePart; // same ICT day
  } else {
    // next ICT day
    const [y, m, d] = datePart.split('-').map((s) => parseInt(s, 10));
    const next = new Date(Date.UTC(y, m - 1, d) + 24 * 60 * 60 * 1000);
    targetDateStr = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`;
  }

  // Build target as 08:00 ICT (= 01:00 UTC same day in Thailand which has no DST)
  return new Date(`${targetDateStr}T01:00:00.000Z`);
}
```

- [ ] **Step 4: Run test — verify pass**

```bash
cd apps/api && npx jest --testPathPattern=business-hours.util.spec 2>&1 | tail -10
```
Expected: 9 tests pass

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/utils/business-hours.util.ts apps/api/src/utils/business-hours.util.spec.ts
git commit -m "feat(utils): business-hours utility for Thai compliance windows

isWithinBusinessHours(date, isWeekendOrHoliday) and
nextBusinessHourOpen(date, ...) utilities. Handles Asia/Bangkok
timezone via locale formatting (process.env.TZ).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: ComplianceService skeleton + all gates

**Files:**
- Create: `apps/api/src/modules/notifications/compliance.service.ts`
- Create: `apps/api/src/modules/notifications/compliance.service.spec.ts`
- Modify: `apps/api/src/modules/notifications/notifications.module.ts` — provide it

- [ ] **Step 1: Write failing tests for all gates**

```typescript
// apps/api/src/modules/notifications/compliance.service.spec.ts
import { Test } from '@nestjs/testing';
import { ComplianceService } from './compliance.service';
import { HolidayService } from './holiday.service';
import { PrismaService } from '../../prisma/prisma.service';
import { PDPAService } from '../pdpa/pdpa.service';
import { NotificationCategory } from './notification-category.enum';

describe('ComplianceService', () => {
  let service: ComplianceService;
  let prisma: { notificationLog: { count: jest.Mock } };
  let pdpa: { hasActiveConsent: jest.Mock };
  let holiday: { isHoliday: jest.Mock };

  beforeEach(async () => {
    prisma = { notificationLog: { count: jest.fn().mockResolvedValue(0) } };
    pdpa = { hasActiveConsent: jest.fn().mockResolvedValue(true) };
    holiday = { isHoliday: jest.fn().mockReturnValue(false) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        ComplianceService,
        { provide: PrismaService, useValue: prisma },
        { provide: PDPAService, useValue: pdpa },
        { provide: HolidayService, useValue: holiday },
      ],
    }).compile();

    service = moduleRef.get(ComplianceService);
  });

  describe('time-window gate', () => {
    it('blocks weekday 23:00 ICT with OUTSIDE_HOURS', async () => {
      // 2026-05-04 (Mon) 23:00 ICT = 16:00 UTC
      jest.useFakeTimers().setSystemTime(new Date('2026-05-04T16:00:00Z'));
      const result = await service.canSend({
        channel: 'LINE', customerId: 'c1', contractId: 'k1',
        category: NotificationCategory.DUNNING,
      });
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('OUTSIDE_HOURS');
      expect(result.retryAfter).toBeDefined();
      jest.useRealTimers();
    });

    it('allows weekday 14:00 ICT', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-05-04T07:00:00Z')); // 14:00 ICT
      const result = await service.canSend({
        channel: 'LINE', customerId: 'c1', contractId: 'k1',
        category: NotificationCategory.DUNNING,
      });
      expect(result.allowed).toBe(true);
      jest.useRealTimers();
    });

    it('blocks weekend 19:00 ICT (after 18:00)', async () => {
      // 2026-05-09 (Sat) 19:00 ICT = 12:00 UTC
      jest.useFakeTimers().setSystemTime(new Date('2026-05-09T12:00:00Z'));
      const result = await service.canSend({
        channel: 'LINE', customerId: 'c1', contractId: 'k1',
        category: NotificationCategory.DUNNING,
      });
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('OUTSIDE_HOURS');
      jest.useRealTimers();
    });

    it('blocks holiday 16:00 ICT (after 18:00 weekend rule applies)', async () => {
      holiday.isHoliday.mockReturnValueOnce(true);
      // 2026-04-13 (Mon — but holiday so weekend window) 19:00 ICT = 12:00 UTC
      jest.useFakeTimers().setSystemTime(new Date('2026-04-13T12:00:00Z'));
      const result = await service.canSend({
        channel: 'LINE', customerId: 'c1', contractId: 'k1',
        category: NotificationCategory.DUNNING,
      });
      expect(result.allowed).toBe(false);
      jest.useRealTimers();
    });
  });

  describe('frequency cap', () => {
    it('blocks 2nd dunning to same (customer + contract) same day', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-05-04T07:00:00Z')); // 14:00 ICT
      prisma.notificationLog.count.mockResolvedValueOnce(1);
      const result = await service.canSend({
        channel: 'LINE', customerId: 'c1', contractId: 'k1',
        category: NotificationCategory.DUNNING,
      });
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('FREQUENCY_CAP');
      jest.useRealTimers();
    });

    it('does not apply cap to REMINDER category', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-05-04T07:00:00Z'));
      prisma.notificationLog.count.mockResolvedValueOnce(5);
      const result = await service.canSend({
        channel: 'LINE', customerId: 'c1', contractId: 'k1',
        category: NotificationCategory.REMINDER,
      });
      expect(result.allowed).toBe(true);
      jest.useRealTimers();
    });
  });

  describe('PDPA consent', () => {
    it('blocks DUNNING when no consent', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-05-04T07:00:00Z'));
      pdpa.hasActiveConsent.mockResolvedValueOnce(false);
      const result = await service.canSend({
        channel: 'LINE', customerId: 'c1', contractId: 'k1',
        category: NotificationCategory.DUNNING,
      });
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('NO_CONSENT');
      jest.useRealTimers();
    });
  });

  describe('bypass', () => {
    it('TRANSACTIONAL category always allowed', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-05-04T20:00:00Z')); // 03:00 ICT next day
      const result = await service.canSend({
        channel: 'LINE', customerId: 'c1',
        category: NotificationCategory.TRANSACTIONAL,
      });
      expect(result.allowed).toBe(true);
      jest.useRealTimers();
    });

    it('STAFF category always allowed', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-05-04T20:00:00Z'));
      const result = await service.canSend({
        channel: 'LINE',
        category: NotificationCategory.STAFF,
      });
      expect(result.allowed).toBe(true);
      jest.useRealTimers();
    });

    it('bypassCompliance flag overrides everything', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-05-04T20:00:00Z'));
      const result = await service.canSend({
        channel: 'LINE', customerId: 'c1',
        category: NotificationCategory.DUNNING,
        bypassCompliance: true,
      });
      expect(result.allowed).toBe(true);
      jest.useRealTimers();
    });
  });
});
```

- [ ] **Step 2: Run test — verify fail**

```bash
cd apps/api && npx jest --testPathPattern=compliance.service.spec 2>&1 | tail -10
```
Expected: FAIL — module not found

- [ ] **Step 3: Implement ComplianceService**

```typescript
// apps/api/src/modules/notifications/compliance.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PDPAService } from '../pdpa/pdpa.service';
import { HolidayService } from './holiday.service';
import {
  NotificationCategory,
  COMPLIANCE_CHECKED_CATEGORIES,
  FREQUENCY_CAP_CATEGORIES,
} from './notification-category.enum';
import { isWithinBusinessHours, nextBusinessHourOpen } from '../../utils/business-hours.util';
import type { NotificationChannel } from '@prisma/client';

export interface ComplianceContext {
  channel: NotificationChannel;
  customerId?: string;
  contractId?: string;
  category: NotificationCategory;
  bypassCompliance?: boolean;
}

export type ComplianceBlockReason =
  | 'OUTSIDE_HOURS'
  | 'FREQUENCY_CAP'
  | 'NO_CONSENT'
  | 'HOLIDAY_BLOCK'; // (currently subsumed by OUTSIDE_HOURS — kept for future granularity)

export interface CanSendResult {
  allowed: boolean;
  reason?: ComplianceBlockReason;
  retryAfter?: Date;
}

@Injectable()
export class ComplianceService {
  private readonly logger = new Logger(ComplianceService.name);

  constructor(
    private prisma: PrismaService,
    private pdpa: PDPAService,
    private holiday: HolidayService,
  ) {}

  async canSend(ctx: ComplianceContext): Promise<CanSendResult> {
    // Bypass: explicit flag, or category exempt
    if (ctx.bypassCompliance) return { allowed: true };
    if (
      ctx.category === NotificationCategory.TRANSACTIONAL ||
      ctx.category === NotificationCategory.STAFF
    ) {
      return { allowed: true };
    }

    if (!COMPLIANCE_CHECKED_CATEGORIES.has(ctx.category)) {
      return { allowed: true };
    }

    const now = new Date();

    // Time-window gate
    const isWeekendOrHoliday = this.isWeekendOrHoliday(now);
    if (!isWithinBusinessHours(now, isWeekendOrHoliday)) {
      return {
        allowed: false,
        reason: 'OUTSIDE_HOURS',
        retryAfter: nextBusinessHourOpen(now, isWeekendOrHoliday),
      };
    }

    // PDPA consent gate
    if (ctx.customerId) {
      const hasConsent = await this.pdpa.hasActiveConsent(ctx.customerId);
      if (!hasConsent) {
        this.logger.debug(`Compliance: no PDPA consent for customer ${ctx.customerId}`);
        return { allowed: false, reason: 'NO_CONSENT' };
      }
    }

    // Frequency cap (DUNNING only, per customer + contract per day)
    if (
      FREQUENCY_CAP_CATEGORIES.has(ctx.category) &&
      ctx.customerId &&
      ctx.contractId
    ) {
      const todayStart = this.startOfBangkokDay(now);
      const count = await this.prisma.notificationLog.count({
        where: {
          customerId: ctx.customerId,
          relatedId: ctx.contractId,
          category: ctx.category,
          status: 'SENT',
          sentAt: { gte: todayStart },
          deletedAt: null,
        },
      });
      if (count >= 1) {
        return {
          allowed: false,
          reason: 'FREQUENCY_CAP',
          retryAfter: nextBusinessHourOpen(now, isWeekendOrHoliday),
        };
      }
    }

    return { allowed: true };
  }

  private isWeekendOrHoliday(date: Date): boolean {
    if (this.holiday.isHoliday(date)) return true;
    // 0 = Sunday, 6 = Saturday in JS Date.getDay()
    const dayOfWeekICT = parseInt(
      date.toLocaleString('en-US', { timeZone: 'Asia/Bangkok', weekday: 'short' })
        .toLowerCase()
        .replace(/^.*$/, (s) =>
          ({ sun: '0', mon: '1', tue: '2', wed: '3', thu: '4', fri: '5', sat: '6' }[s] ?? '-1'),
        ),
      10,
    );
    return dayOfWeekICT === 0 || dayOfWeekICT === 6;
  }

  /** Start of today in Asia/Bangkok = 00:00 ICT = 17:00 UTC previous day. */
  private startOfBangkokDay(date: Date): Date {
    const localDate = date.toLocaleString('en-CA', {
      timeZone: 'Asia/Bangkok',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }); // "2026-05-04"
    return new Date(`${localDate}T00:00:00+07:00`);
  }
}
```

- [ ] **Step 4: Provide ComplianceService in module**

In `apps/api/src/modules/notifications/notifications.module.ts`, add to providers:

```typescript
import { ComplianceService } from './compliance.service';
import { HolidayService } from './holiday.service';

@Module({
  // ...
  providers: [
    NotificationsService,
    ComplianceService,        // NEW
    HolidayService,           // NEW
    // ...existing providers
  ],
  exports: [
    NotificationsService,
    ComplianceService,        // NEW
    HolidayService,           // NEW
  ],
  // ...
})
export class NotificationsModule {}
```

Ensure `PDPAModule` is in `imports:` — already is (per scheduler.module.ts).

- [ ] **Step 5: Run all compliance tests — verify pass**

```bash
cd apps/api && npx jest --testPathPattern="compliance|holiday|business-hours" 2>&1 | tail -15
```
Expected: all pass

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/notifications/compliance.service.ts apps/api/src/modules/notifications/compliance.service.spec.ts apps/api/src/modules/notifications/notifications.module.ts
git commit -m "feat(notifications): ComplianceService with time/PDPA/frequency gates

Single decision point for customer-facing notifications. Returns
{allowed, reason, retryAfter} per ComplianceContext. Bypasses
TRANSACTIONAL/STAFF/bypassCompliance=true.

12 unit tests cover all gates + edge cases.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase 3 — Integration into NotificationsService (Day 3)

### Task 6: Wire ComplianceService into send() + auto-delay queue

**Files:**
- Modify: `apps/api/src/modules/notifications/notifications.service.ts`

- [ ] **Step 1: Inject ComplianceService**

In `notifications.service.ts` constructor:

```typescript
import { ComplianceService } from './compliance.service';
import { NotificationCategory } from './notification-category.enum';

constructor(
  private prisma: PrismaService,
  private configService: ConfigService,
  private flexTemplates: FlexTemplatesService,
  private quickReplyService: QuickReplyService,
  private integrationConfig: IntegrationConfigService,
  private compliance: ComplianceService,  // NEW
) {}
```

- [ ] **Step 2: Update `send()` to gate via Compliance + auto-delay path**

Find the existing `send(dto: SendNotificationDto)` method. Add compliance check at the top, after channelKey resolution:

```typescript
async send(dto: SendNotificationDto): Promise<{ id: string; status: string; errorMsg?: string; blockReason?: string }> {
  if (dto.channel === 'LINE' && !dto.channelKey) {
    throw new BadRequestException('channelKey จำเป็นสำหรับ LINE notification');
  }
  const channelKey = dto.channelKey;

  // ===== P2 Compliance gate =====
  // Only enforce for customer-facing categories. STAFF/TRANSACTIONAL bypass.
  let blockReason: string | undefined;
  let delayedRetryAt: Date | undefined;

  if (dto.category && (dto.channel === 'LINE' || dto.channel === 'SMS')) {
    const result = await this.compliance.canSend({
      channel: dto.channel,
      customerId: dto.customerId,
      contractId: dto.relatedId,
      category: dto.category,
      bypassCompliance: dto.bypassCompliance,
    });

    if (!result.allowed) {
      blockReason = result.reason;
      delayedRetryAt = result.retryAfter;

      // OUTSIDE_HOURS: queue for later (don't fail). Other reasons: hard-block (log + done).
      if (result.reason === 'OUTSIDE_HOURS') {
        const log = await this.prisma.notificationLog.create({
          data: {
            channel: dto.channel,
            channelKey: channelKey ?? null,
            recipient: dto.recipient,
            subject: dto.subject,
            message: dto.message,
            status: 'DELAYED',
            relatedId: dto.relatedId,
            customerId: dto.customerId ?? null,
            category: dto.category ?? null,
            blockReason: result.reason,
            errorMsg: null,
            sentAt: null,
            externalId: null,
            nextRetryAt: result.retryAfter ?? null,
          },
        });
        return { id: log.id, status: 'DELAYED', blockReason: result.reason };
      } else {
        // FREQUENCY_CAP / NO_CONSENT — hard block
        const log = await this.prisma.notificationLog.create({
          data: {
            channel: dto.channel,
            channelKey: channelKey ?? null,
            recipient: dto.recipient,
            subject: dto.subject,
            message: dto.message,
            status: 'BLOCKED',
            relatedId: dto.relatedId,
            customerId: dto.customerId ?? null,
            category: dto.category ?? null,
            blockReason: result.reason,
            errorMsg: `Compliance block: ${result.reason}`,
            sentAt: null,
            externalId: null,
          },
        });
        return { id: log.id, status: 'BLOCKED', blockReason: result.reason };
      }
    }
  }
  // ===== End compliance gate =====

  // ...existing send logic continues unchanged
  // (include customerId + category in the final notificationLog.create call too)
}
```

Find the existing `notificationLog.create` at the bottom of `send()` (around line 112-130) and add `customerId`, `category`:

```typescript
const log = await this.prisma.notificationLog.create({
  data: {
    channel: dto.channel as NotificationChannel,
    channelKey: dto.channelKey ?? null,
    recipient: dto.recipient,
    subject: dto.subject,
    message: dto.message,
    status,
    relatedId: dto.relatedId,
    customerId: dto.customerId ?? null,           // NEW
    category: dto.category ?? null,               // NEW
    blockReason: null,                            // NEW (this path = sent successfully or failed normally)
    errorMsg,
    sentAt,
    externalId,
  },
});
```

- [ ] **Step 3: Update `processRetryQueue` to handle DELAYED status**

Find `processRetryQueue` (around line 590-620). Currently it queries `status: 'RETRY_PENDING'`. Add `'DELAYED'` to the status filter:

```typescript
const pending = await this.prisma.notificationLog.findMany({
  where: {
    status: { in: ['RETRY_PENDING', 'DELAYED'] },  // CHANGED
    nextRetryAt: { lte: new Date() },
    deletedAt: null,
  },
  take: 50,
});
```

For each pending notification, before retrying, re-check compliance if it has a category:

```typescript
for (const notification of pending) {
  // Re-check compliance for DELAYED items
  if (notification.status === 'DELAYED' && notification.category) {
    const result = await this.compliance.canSend({
      channel: notification.channel,
      customerId: notification.customerId ?? undefined,
      contractId: notification.relatedId ?? undefined,
      category: notification.category as NotificationCategory,
    });
    if (!result.allowed) {
      // still blocked — re-schedule
      await this.prisma.notificationLog.update({
        where: { id: notification.id },
        data: { nextRetryAt: result.retryAfter ?? new Date(Date.now() + 60 * 60 * 1000) },
      });
      continue;
    }
  }

  // ...existing retry logic — actually try to send
}
```

After successful send via retry, clear blockReason (status moves to SENT in existing logic).

- [ ] **Step 4: Type check**

```bash
cd apps/api && npx tsc --noEmit 2>&1 | grep "notifications.service.ts" | head -10
```
Expected: 0 errors

- [ ] **Step 5: Run tests**

```bash
cd apps/api && npx jest --testPathPattern=notifications 2>&1 | tail -15
```
Expected: all pass (existing tests still work; new compliance integration would benefit from fresh tests in Task 7)

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/notifications/notifications.service.ts
git commit -m "feat(notifications): integrate ComplianceService into send()

- send() consults compliance.canSend() for customer-facing categories
- OUTSIDE_HOURS → status='DELAYED' (queued for retry queue)
- FREQUENCY_CAP / NO_CONSENT → status='BLOCKED' (hard block + log)
- TRANSACTIONAL / STAFF / bypassCompliance=true bypass entirely
- Retry queue re-checks compliance on DELAYED items before retrying
- All NotificationLog rows now persist customerId + category + blockReason

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Compliance integration test

**Files:**
- Create: `apps/api/src/modules/notifications/compliance.integration.spec.ts`

- [ ] **Step 1: Write integration tests**

```typescript
// apps/api/src/modules/notifications/compliance.integration.spec.ts
import { Test } from '@nestjs/testing';
import { NotificationsService } from './notifications.service';
import { ComplianceService } from './compliance.service';
import { HolidayService } from './holiday.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { FlexTemplatesService } from '../line-oa/flex-templates.service';
import { QuickReplyService } from '../line-oa/quick-reply.service';
import { IntegrationConfigService } from '../integrations/integration-config.service';
import { PDPAService } from '../pdpa/pdpa.service';
import { NotificationCategory } from './notification-category.enum';

describe('NotificationsService — compliance integration', () => {
  let service: NotificationsService;
  let prisma: any;
  let pdpa: { hasActiveConsent: jest.Mock };

  beforeEach(async () => {
    prisma = {
      notificationLog: {
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'log1', ...data })),
        count: jest.fn().mockResolvedValue(0),
      },
    };
    pdpa = { hasActiveConsent: jest.fn().mockResolvedValue(true) };
    const integrationConfig = { getValue: jest.fn().mockResolvedValue('token') };
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }) as any);

    const moduleRef = await Test.createTestingModule({
      providers: [
        NotificationsService,
        ComplianceService,
        HolidayService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        { provide: FlexTemplatesService, useValue: {} },
        { provide: QuickReplyService, useValue: {} },
        { provide: IntegrationConfigService, useValue: integrationConfig },
        { provide: PDPAService, useValue: pdpa },
      ],
    }).compile();

    service = moduleRef.get(NotificationsService);
  });

  afterEach(() => jest.useRealTimers());

  it('DUNNING outside hours → status=DELAYED (queued, not failed)', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-05-04T16:00:00Z')); // 23:00 ICT
    const result = await service.send({
      channel: 'LINE',
      channelKey: 'line-finance',
      recipient: 'Uxxx',
      message: '[BESTCHOICE FINANCE] dunning',
      customerId: 'c1',
      relatedId: 'k1',
      category: NotificationCategory.DUNNING,
    });
    expect(result.status).toBe('DELAYED');
    expect(result.blockReason).toBe('OUTSIDE_HOURS');
    expect(prisma.notificationLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'DELAYED',
          blockReason: 'OUTSIDE_HOURS',
          nextRetryAt: expect.any(Date),
        }),
      }),
    );
  });

  it('DUNNING with no PDPA consent → status=BLOCKED', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-05-04T07:00:00Z')); // 14:00 ICT
    pdpa.hasActiveConsent.mockResolvedValueOnce(false);
    const result = await service.send({
      channel: 'LINE',
      channelKey: 'line-finance',
      recipient: 'Uxxx',
      message: '[BESTCHOICE FINANCE] dunning',
      customerId: 'c1',
      relatedId: 'k1',
      category: NotificationCategory.DUNNING,
    });
    expect(result.status).toBe('BLOCKED');
    expect(result.blockReason).toBe('NO_CONSENT');
  });

  it('TRANSACTIONAL bypasses compliance (sends even at 03:00 ICT)', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-05-04T20:00:00Z')); // 03:00 ICT next day
    const result = await service.send({
      channel: 'LINE',
      channelKey: 'line-finance',
      recipient: 'Uxxx',
      message: 'Receipt',
      customerId: 'c1',
      category: NotificationCategory.TRANSACTIONAL,
    });
    expect(result.status).toBe('SENT');
  });
});
```

- [ ] **Step 2: Run tests — verify pass**

```bash
cd apps/api && npx jest --testPathPattern=compliance.integration 2>&1 | tail -10
```
Expected: 3 tests pass

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/modules/notifications/compliance.integration.spec.ts
git commit -m "test(notifications): integration tests for compliance gating

3 tests cover OUTSIDE_HOURS auto-queue, NO_CONSENT hard block,
TRANSACTIONAL bypass.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase 4 — Cron Timezone + Call Site Migration (Day 4-5)

### Task 8: Add `{ timeZone: 'Asia/Bangkok' }` to all 20 crons

**File:**
- Modify: `apps/api/src/modules/notifications/scheduler.service.ts`

- [ ] **Step 1: Find all @Cron in scheduler.service.ts**

```bash
grep -n "@Cron(" apps/api/src/modules/notifications/scheduler.service.ts
```

Expected: ~20 occurrences.

- [ ] **Step 2: Add `{ timeZone: 'Asia/Bangkok' }` to each**

For each `@Cron` decorator, add the option object. Two patterns to handle:

**Pattern A — `@Cron(CronExpression.X)`:**
```typescript
// BEFORE
@Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
// AFTER
@Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT, { timeZone: 'Asia/Bangkok' })
```

**Pattern B — `@Cron('cron string')`:**
```typescript
// BEFORE
@Cron('0 8 * * *')
// AFTER
@Cron('0 8 * * *', { timeZone: 'Asia/Bangkok' })
```

For crons that ALREADY have a comment hint like `// 23:55 ICT`, the cron expression was set assuming UTC offset. Since we now pin timezone, the value should match the comment. Audit:
- `@Cron('55 16 * * *') // 23:55 ICT` → was UTC. Need to change to `'55 23 * * *'` to fire at 23:55 ICT under Asia/Bangkok timezone.
- `@Cron('5 17 * * 0') // Monday 00:05 ICT` → was UTC; change to `'5 0 * * 1'` for Mon 00:05 ICT.
- `@Cron('30 19 * * *') // 02:30 ICT` → was UTC; change to `'30 2 * * *'` for 02:30 ICT.
- `@Cron('0 13 * * *') // 20:00 ICT` → was UTC; change to `'0 20 * * *'` for 20:00 ICT.
- `@Cron('0 2 * * *') // 09:00 ICT = 02:00 UTC` (handleSmsCreditAlert) → was UTC; change to `'0 9 * * *'`.

For other crons WITHOUT explicit ICT comment (the developer may have intended ICT but written UTC), inspect each method's purpose and pick the intended ICT time. If unclear, keep the same numeric value but now interpreted as ICT (this means actual fire time shifts +7 hours from before, which is intended for compliance).

**Critical safety check:** before doing this batch, list all 20 crons + decide intended ICT time before changing. Document in commit body.

- [ ] **Step 3: Type check**

```bash
cd apps/api && npx tsc --noEmit 2>&1 | grep "scheduler.service.ts" | head -5
```
Expected: 0 errors

- [ ] **Step 4: Run scheduler-related tests**

```bash
cd apps/api && npx jest --testPathPattern=scheduler 2>&1 | tail -10
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/notifications/scheduler.service.ts
git commit -m "fix(notifications): pin all 20 crons to Asia/Bangkok timezone

Previously crons were UTC implicitly — many fired afternoon ICT for
'morning' notifications. Now explicit { timeZone: 'Asia/Bangkok' } +
adjusted cron expressions where original comments indicated ICT intent.

Side effects: business-hours window enforcement (Task 6) handles
crons that fire outside 08:00-20:00 by routing to DELAYED queue.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Update finance call sites with category + customerId

**Files:** 8 files in finance/dunning context.

For EACH file, find every `notificationsService.send({...})` call and add `category` + `customerId`. Files to update:

1. `apps/api/src/modules/notifications/scheduler.service.ts` — handlePaymentReminders (REMINDER), handleOverdueNotices (DUNNING), handleDunningEscalation (DUNNING), notifyStatusChangedCustomers (DUNNING), handleAutoPaymentLinks (DUNNING)
2. `apps/api/src/modules/notifications/notifications.service.ts` — sendPaymentReminders (REMINDER), sendOverdueNotices (DUNNING), sendBulk (template-driven, keep as TRANSACTIONAL when ambiguous)
3. `apps/api/src/modules/overdue/dunning-engine.service.ts` — DUNNING
4. `apps/api/src/modules/overdue/dunning-retry.service.ts` — DUNNING
5. `apps/api/src/modules/overdue/overdue.service.ts` — DUNNING
6. `apps/api/src/modules/overdue/queue.service.ts` — DUNNING
7. `apps/api/src/modules/overdue/bulk.service.ts` — DUNNING
8. `apps/api/src/modules/mdm/mdm-auto.service.ts` — DUNNING
9. `apps/api/src/modules/collections-session/collections-session.service.ts` — DUNNING

- [ ] **Step 1: For each file, audit + update**

Pattern:
```typescript
// BEFORE
await this.notificationsService.send({
  channelKey: 'line-finance',
  channel: 'LINE',
  recipient: customer.lineIdFinance,
  message: '...',
  relatedId: contractId,
});

// AFTER
await this.notificationsService.send({
  channelKey: 'line-finance',
  channel: 'LINE',
  recipient: customer.lineIdFinance,
  message: '[BESTCHOICE FINANCE] ...',  // identification prefix
  relatedId: contractId,
  customerId: customer.id,             // NEW
  category: NotificationCategory.DUNNING,  // NEW (or REMINDER for pre-due notifications)
});
```

Import `NotificationCategory` at top of each file:
```typescript
import { NotificationCategory } from '../notifications/notification-category.enum';
```

- [ ] **Step 2: Type check after each batch**

```bash
cd apps/api && npx tsc --noEmit 2>&1 | grep -E "modules/(overdue|mdm|collections|notifications)" | head -10
```

- [ ] **Step 3: Run finance tests**

```bash
cd apps/api && npx jest --testPathPattern="overdue|mdm|collections|notifications" 2>&1 | tail -10
```
Expected: all pass

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/notifications/ apps/api/src/modules/overdue/ apps/api/src/modules/mdm/ apps/api/src/modules/collections-session/
git commit -m "feat(finance): customer-facing notifications declare category + customerId

8 files: scheduler/notifications/overdue/mdm/collections.
- Customer dunning → DUNNING (frequency cap applies)
- Pre-due reminders → REMINDER (no cap, time windows still apply)
- All include customerId for compliance tracking

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Update transactional + staff call sites

**Files:** 6 files.

1. `apps/api/src/modules/payments/payments.service.ts` — receipt → TRANSACTIONAL
2. `apps/api/src/modules/paysolutions/paysolutions.service.ts` — payment success/early payoff → TRANSACTIONAL
3. `apps/api/src/modules/contracts/contract-workflow.service.ts` — contract signed → TRANSACTIONAL
4. `apps/api/src/modules/contracts/documents.service.ts` — contract docs → TRANSACTIONAL
5. `apps/api/src/modules/notifications/scheduler.service.ts` — handleManagerNotifications + handleOwnerDefaultNotifications + handleDailyReport + handleWeeklyReport + handleDailyLineReport + handleSmsCreditAlert → STAFF
6. `apps/api/src/modules/auth/login-audit.service.ts` — staff alert → STAFF

- [ ] **Step 1: For each file, update `send()` calls**

Pattern for transactional:
```typescript
await this.notificationsService.send({
  channelKey: 'line-finance',
  channel: 'LINE',
  recipient: customer.lineIdFinance,
  message: 'ใบเสร็จของคุณ',
  relatedId: paymentId,
  customerId: customer.id,
  category: NotificationCategory.TRANSACTIONAL,  // bypass compliance
});
```

Pattern for staff:
```typescript
await this.notificationsService.send({
  channelKey: 'line-staff',
  channel: 'LINE',
  recipient: staffTarget,
  message: 'Manager alert',
  category: NotificationCategory.STAFF,  // bypass time windows
});
```

- [ ] **Step 2: Type check + tests**

```bash
cd apps/api && npx tsc --noEmit 2>&1 | grep -E "payments|paysolutions|contracts|auth|scheduler" | head -10
cd apps/api && npx jest --testPathPattern="payments|paysolutions|contracts" 2>&1 | tail -10
```

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/modules/
git commit -m "feat(transactional+staff): receipts and staff alerts use category bypass

6 files: payments/paysolutions/contracts/scheduler/auth.
- Receipts + payment success + contract signed → TRANSACTIONAL
- Manager/owner/SMS-credit/daily-report → STAFF

These categories bypass time windows + frequency cap by design.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: Update marketing + saving-plan call sites

**Files:** 4 files.

1. `apps/api/src/modules/shop-saving-plan/saving-plan-reminder.cron.ts` — REMINDER
2. `apps/api/src/modules/shop-saving-plan/shop-saving-plan.service.ts` — TRANSACTIONAL (status updates)
3. `apps/api/src/modules/broadcast/broadcast.service.ts` — MARKETING
4. `apps/api/src/modules/csat/csat.service.ts` — MARKETING

- [ ] **Step 1: Update each**

```typescript
// shop-saving-plan/saving-plan-reminder.cron.ts (line 25 area)
await this.notificationsService.send({
  channelKey: 'line-shop',
  channel: 'LINE',
  recipient: plan.customer.lineIdShop,
  message: '...',
  relatedId: plan.id,
  customerId: plan.customer.id,
  category: NotificationCategory.REMINDER,
});

// broadcast.service.ts (LINE_SHOP case)
await this.notificationsService.send({
  channelKey: 'line-shop',
  channel: 'LINE',
  recipient,
  message: campaignMessage,
  customerId: customer.id,
  category: NotificationCategory.MARKETING,
});
```

- [ ] **Step 2: Type check + tests**

```bash
cd apps/api && npx tsc --noEmit 2>&1 | grep -E "shop-saving|broadcast|csat" | head -10
cd apps/api && npx jest --testPathPattern="shop-saving|broadcast|csat" 2>&1 | tail -10
```

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/modules/shop-saving-plan/ apps/api/src/modules/broadcast/ apps/api/src/modules/csat/
git commit -m "feat(marketing+savings): saving-plan and broadcast use REMINDER/MARKETING

- saving-plan reminder → REMINDER
- broadcast campaign → MARKETING (subject to opt-in via PDPA gate)
- csat survey → MARKETING

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 12: Final type check — all call sites have category

- [ ] **Step 1: Find any remaining notificationsService.send() calls without category**

```bash
cd apps/api && grep -rE "notificationsService\.send\(\{" src --include="*.ts" -A 10 | grep -B 1 -E "channel:|channelKey:" | grep -v "category:" | head -20
```

Examine each result — if a call genuinely doesn't fit any category (e.g. internal worker), use `bypassCompliance: true` + `category: NotificationCategory.STAFF` for safety.

- [ ] **Step 2: Run full API test suite**

```bash
cd apps/api && npx jest 2>&1 | tail -10
```
Expected: 2233+ pass (or higher with new compliance tests)

- [ ] **Step 3: Final commit if any leftovers**

```bash
git add apps/api/src/modules/
git commit -m "feat(notifications): final pass — all sends declare category

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase 5 — Identification + Content Guardrails (Day 6)

### Task 13: Identification prefix audit on dunning messages

**Files:**
- Modify: `apps/api/src/modules/notifications/scheduler.service.ts` (handleDunningEscalation stage messages)
- Modify: any other DUNNING message templates inline in service code

- [ ] **Step 1: Find all DUNNING messages**

```bash
grep -rE "category:.*DUNNING|REMINDER:|NOTICE:|FINAL_WARNING:|LEGAL_ACTION:" apps/api/src --include="*.ts" | head -20
```

- [ ] **Step 2: Audit each message string**

Find inline strings like in scheduler.service.ts:244-249:
```typescript
const stageMessages: Record<string, string> = {
  REMINDER: `แจ้งเตือน: คุณ${name} มียอด...`,
  NOTICE: `แจ้งค้างชำระ: คุณ${name} ...`,
  FINAL_WARNING: `เตือนครั้งสุดท้าย: คุณ${name}...`,
  LEGAL_ACTION: `แจ้งดำเนินการ: สัญญา ${contractNumber}...`,
};
```

Update each to include `[BESTCHOICE FINANCE]` prefix:
```typescript
const stageMessages: Record<string, string> = {
  REMINDER: `[BESTCHOICE FINANCE] แจ้งเตือน: คุณ${name} มียอด...`,
  NOTICE: `[BESTCHOICE FINANCE] แจ้งค้างชำระ: คุณ${name} ...`,
  FINAL_WARNING: `[BESTCHOICE FINANCE] เตือนครั้งสุดท้าย: คุณ${name}...`,
  LEGAL_ACTION: `[BESTCHOICE FINANCE] แจ้งดำเนินการ: สัญญา ${contractNumber}...`,
};
```

Also audit dunning-related Flex messages in `apps/api/src/modules/line-oa/flex-messages/overdue-notice.flex.ts` — look for header/title strings, ensure brand name appears.

- [ ] **Step 3: Add ComplianceService validation (auto-prepend if missing)**

In `compliance.service.ts`, add a helper:

```typescript
/**
 * Ensures dunning messages have the required identification prefix.
 * Auto-prepends if missing. Logs a warning to Sentry — should be set at template level.
 */
ensureIdentificationPrefix(message: string, category: NotificationCategory): string {
  if (category !== NotificationCategory.DUNNING) return message;
  const PREFIX = '[BESTCHOICE FINANCE]';
  if (message.startsWith(PREFIX)) return message;
  this.logger.warn(`Dunning message missing identification prefix — auto-prepending: "${message.slice(0, 60)}..."`);
  return `${PREFIX} ${message}`;
}
```

In `notifications.service.ts.send()`, after compliance check passes, before persisting:
```typescript
if (dto.category === NotificationCategory.DUNNING) {
  dto.message = this.compliance.ensureIdentificationPrefix(dto.message, dto.category);
}
```

- [ ] **Step 4: Add unit test for prefix logic**

In `compliance.service.spec.ts`:
```typescript
describe('ensureIdentificationPrefix', () => {
  it('prepends [BESTCHOICE FINANCE] to DUNNING message missing it', () => {
    const result = service.ensureIdentificationPrefix('hello', NotificationCategory.DUNNING);
    expect(result).toBe('[BESTCHOICE FINANCE] hello');
  });

  it('leaves DUNNING message that already has prefix unchanged', () => {
    const result = service.ensureIdentificationPrefix('[BESTCHOICE FINANCE] hello', NotificationCategory.DUNNING);
    expect(result).toBe('[BESTCHOICE FINANCE] hello');
  });

  it('does not modify REMINDER messages', () => {
    const result = service.ensureIdentificationPrefix('hello', NotificationCategory.REMINDER);
    expect(result).toBe('hello');
  });
});
```

- [ ] **Step 5: Run tests**

```bash
cd apps/api && npx jest --testPathPattern=compliance 2>&1 | tail -10
```

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/notifications/ apps/api/src/modules/line-oa/flex-messages/
git commit -m "feat(notifications): identification prefix on dunning messages

- All inline dunning stage messages prefixed [BESTCHOICE FINANCE]
- ComplianceService.ensureIdentificationPrefix auto-prepends if missing
- Sentry warns when auto-prepend triggers (template should be fixed)

Required by พ.ร.บ.การทวงถามหนี้ มาตรา 8 (creditor identification).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 14: Content guardrails (forbidden words → Sentry warn)

**Files:**
- Modify: `apps/api/src/modules/notifications/compliance.service.ts`
- Modify: `apps/api/src/modules/notifications/compliance.service.spec.ts`

- [ ] **Step 1: Add forbidden patterns + scan method**

In `compliance.service.ts`:

```typescript
import * as Sentry from '@sentry/node';

const FORBIDDEN_PATTERNS: { pattern: RegExp; reason: string; allowedInLegalAction: boolean }[] = [
  { pattern: /\b(ข่มขู่|ขู่)\b/, reason: 'threatening language', allowedInLegalAction: false },
  { pattern: /\b(ดูถูก|เหยียดหยาม|หยาบ)\b/, reason: 'insult', allowedInLegalAction: false },
  { pattern: /\b(ระยำ|เ?หี้?ย|ส้นตีน)\b/, reason: 'profanity', allowedInLegalAction: false },
  { pattern: /\b(แจ้งความ|ฟ้องร้อง|ดำเนินคดี)\b/, reason: 'legal threat', allowedInLegalAction: true },
];

scanForbiddenContent(message: string, dunningStage?: string): string[] {
  const matches: string[] = [];
  for (const { pattern, reason, allowedInLegalAction } of FORBIDDEN_PATTERNS) {
    if (pattern.test(message)) {
      // LEGAL_ACTION dunning stage may legitimately mention legal action
      if (allowedInLegalAction && dunningStage === 'LEGAL_ACTION') continue;
      matches.push(reason);
    }
  }
  if (matches.length > 0) {
    Sentry.captureMessage(`Notification content review needed: ${matches.join(', ')}`, {
      level: 'warning',
      tags: { module: 'notifications', compliance: 'content-guardrails' },
      extra: { messagePreview: message.slice(0, 100) },
    });
    this.logger.warn(`Forbidden content detected: ${matches.join(', ')} — message: "${message.slice(0, 60)}..."`);
  }
  return matches;
}
```

In `notifications.service.ts.send()`, after compliance check passes:
```typescript
if (dto.category === NotificationCategory.DUNNING) {
  this.compliance.scanForbiddenContent(dto.message);
  // Sentry-only — does not block send
}
```

- [ ] **Step 2: Test**

```typescript
// In compliance.service.spec.ts
describe('scanForbiddenContent', () => {
  it('detects threatening language', () => {
    const matches = service.scanForbiddenContent('เราจะข่มขู่คุณถ้าไม่จ่าย');
    expect(matches).toContain('threatening language');
  });

  it('allows ดำเนินคดี in LEGAL_ACTION stage', () => {
    const matches = service.scanForbiddenContent('จะดำเนินคดีตามกฎหมาย', 'LEGAL_ACTION');
    expect(matches).toEqual([]);
  });

  it('blocks ดำเนินคดี in non-LEGAL_ACTION stages', () => {
    const matches = service.scanForbiddenContent('จะดำเนินคดี');
    expect(matches).toContain('legal threat');
  });
});
```

- [ ] **Step 3: Run tests + commit**

```bash
cd apps/api && npx jest --testPathPattern=compliance 2>&1 | tail -10
git add apps/api/src/modules/notifications/
git commit -m "feat(notifications): content guardrails for dunning messages

ComplianceService.scanForbiddenContent regex-checks for:
- Threats / insults / profanity → Sentry warn (no block — manual review)
- Legal threats allowed only in LEGAL_ACTION dunning stage

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase 6 — Retention + Dashboard (Day 7)

### Task 15: 5-year retention for finance categories

**File:**
- Modify: `apps/api/src/modules/notifications/scheduler.service.ts` (handleDataRetention method)

- [ ] **Step 1: Find handleDataRetention**

```bash
grep -nA 30 "async handleDataRetention" apps/api/src/modules/notifications/scheduler.service.ts | head -40
```

- [ ] **Step 2: Update retention logic**

Replace the existing single-window cleanup with category-aware:

```typescript
@Cron('0 9 * * 0', { timeZone: 'Asia/Bangkok' })
async handleDataRetention() {
  this.logger.log('Starting weekly notification retention cleanup...');
  try {
    const oneYearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
    const fiveYearsAgo = new Date(Date.now() - 5 * 365 * 24 * 60 * 60 * 1000);

    // Finance categories — 5 year retention (พ.ร.บ.ทวงถามหนี้ มาตรา 16)
    const financeDeleted = await this.prisma.notificationLog.updateMany({
      where: {
        category: { in: ['DUNNING', 'REMINDER', 'TRANSACTIONAL'] },
        createdAt: { lt: fiveYearsAgo },
        deletedAt: null,
      },
      data: { deletedAt: new Date() },
    });

    // Non-finance — 1 year retention
    const otherDeleted = await this.prisma.notificationLog.updateMany({
      where: {
        OR: [
          { category: { in: ['STAFF', 'MARKETING'] } },
          { category: null }, // legacy rows
        ],
        createdAt: { lt: oneYearAgo },
        deletedAt: null,
      },
      data: { deletedAt: new Date() },
    });

    this.logger.log(
      `Retention: ${financeDeleted.count} finance (>5y) + ${otherDeleted.count} other (>1y) soft-deleted`,
    );
  } catch (error) {
    this.reportCronFailure('data-retention', error);
  }
}
```

- [ ] **Step 3: Type check**

```bash
cd apps/api && npx tsc --noEmit 2>&1 | grep "scheduler.service.ts" | head -5
```

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/notifications/scheduler.service.ts
git commit -m "feat(notifications): 5-year retention for finance category logs

DUNNING/REMINDER/TRANSACTIONAL → 5 years (พ.ร.บ.ทวงถามหนี้ มาตรา 16).
STAFF/MARKETING/legacy → 1 year (existing).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 16: Block-rate dashboard endpoint + UI

**Files:**
- Modify: `apps/api/src/modules/notifications/notifications.controller.ts`
- Modify: `apps/api/src/modules/notifications/notifications.service.ts`
- Modify: `apps/web/src/pages/NotificationsPage/index.tsx`

- [ ] **Step 1: Backend endpoint**

In `notifications.service.ts`, add method:

```typescript
async getComplianceStats(days = 7) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const blocks = await this.prisma.notificationLog.groupBy({
    by: ['blockReason'],
    where: {
      blockReason: { not: null },
      createdAt: { gte: since },
      deletedAt: null,
    },
    _count: { _all: true },
  });

  const result: Record<string, number> = {
    OUTSIDE_HOURS: 0,
    FREQUENCY_CAP: 0,
    NO_CONSENT: 0,
    HOLIDAY_BLOCK: 0,
  };
  for (const b of blocks) {
    if (b.blockReason && result[b.blockReason] !== undefined) {
      result[b.blockReason] = b._count._all;
    }
  }
  return result;
}
```

In `notifications.controller.ts`:
```typescript
@Get('compliance/stats')
@Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER')
async getComplianceStats() {
  return this.notificationsService.getComplianceStats(7);
}
```

- [ ] **Step 2: Frontend card**

In `NotificationsPage/index.tsx`, add a new query + card section:

```typescript
const { data: complianceStats } = useQuery({
  queryKey: ['notification-compliance-stats'],
  queryFn: async () => (await api.get<Record<string, number>>('/notifications/compliance/stats')).data,
});

// After existing 3 channel cards, add:
{complianceStats && (Object.values(complianceStats).some((n) => n > 0)) && (
  <div className="rounded-lg border border-border bg-muted/30 p-4 mb-6">
    <div className="text-sm text-muted-foreground mb-2">Compliance blocks (7d)</div>
    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
      <div>นอกเวลา: <span className="font-semibold">{complianceStats.OUTSIDE_HOURS}</span></div>
      <div>เกินจำนวนครั้ง: <span className="font-semibold">{complianceStats.FREQUENCY_CAP}</span></div>
      <div>ไม่มี PDPA: <span className="font-semibold">{complianceStats.NO_CONSENT}</span></div>
      <div>วันหยุด: <span className="font-semibold">{complianceStats.HOLIDAY_BLOCK}</span></div>
    </div>
  </div>
)}
```

- [ ] **Step 3: Type check + tests**

```bash
bash tools/check-types.sh all 2>&1 | tail -5
```

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/notifications/ apps/web/src/pages/NotificationsPage/
git commit -m "feat(notifications): compliance block-rate dashboard

GET /notifications/compliance/stats — last 7 days, grouped by reason.
NotificationsPage shows blocks per reason as a compact card.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 17: Compliance runbook

**File:**
- Create: `docs/runbooks/notifications-compliance.md`
- Modify: `docs/runbooks/notifications-incident.md` — add new failure modes

- [ ] **Step 1: Write compliance runbook**

```markdown
# Notifications — Compliance Runbook

## Overview

P2 implements Thai legal compliance for notification sends:
- พ.ร.บ.การทวงถามหนี้ พ.ศ. 2558 (debt collection law)
- พ.ร.บ.PDPA พ.ศ. 2562 (data protection)

Hard-blocked failure modes:
- OUTSIDE_HOURS — sent outside 08:00-20:00 weekday or 08:00-18:00 weekend/holiday
- FREQUENCY_CAP — 2nd dunning to same (customer + contract) same day
- NO_CONSENT — customer revoked PDPA consent
- HOLIDAY_BLOCK — Thai public holiday (currently subsumed by OUTSIDE_HOURS)

OUTSIDE_HOURS sends auto-route to retry queue → fire at next legal window.
FREQUENCY_CAP / NO_CONSENT — hard block (no auto-retry).

## Updating Thai holidays (yearly task)

When ครม. announces next year's holidays (typically Q4):

1. Edit `apps/api/src/data/thai-holidays.json`
2. Add `"YYYY": [...]` array with all dates
3. PR + deploy
4. Document the source in commit body

## Override via bypassCompliance

Setting `bypassCompliance: true` in SendNotificationDto bypasses ALL gates. Use only for:

- Receipt sends (already use TRANSACTIONAL category — bypass is automatic)
- Account verification (TRANSACTIONAL)
- Critical security alerts to staff (STAFF — bypass is automatic)

Never use bypassCompliance for customer-facing dunning/marketing.

## Why is my dunning notification not sending?

Check NotificationLog:

\`\`\`sql
SELECT status, block_reason, created_at, message
FROM notification_logs
WHERE customer_id = '<customer-id>' AND related_id = '<contract-id>'
ORDER BY created_at DESC LIMIT 5;
\`\`\`

| status | block_reason | meaning |
|---|---|---|
| SENT | null | delivered |
| FAILED | null | provider error (see error_msg) |
| BLOCKED | FREQUENCY_CAP | already sent today — wait until tomorrow |
| BLOCKED | NO_CONSENT | customer revoked PDPA — re-obtain consent first |
| DELAYED | OUTSIDE_HOURS | queued, will fire at 08:00 ICT next legal window |
| DELAYED | (next_retry_at past) | retry queue stuck — check cron is running |

## Cron timezone audit

All 20 crons in scheduler.service.ts use `{ timeZone: 'Asia/Bangkok' }`. Verify:

\`\`\`bash
grep -c "timeZone: 'Asia/Bangkok'" apps/api/src/modules/notifications/scheduler.service.ts
# Expected: ≥ 20
\`\`\`

If a cron is off-window for compliance, ComplianceService routes to DELAYED queue automatically. Cron itself runs anyway (e.g. status calculation at 00:30 ICT) — the customer-facing send is what gets delayed.

## Disabling compliance temporarily (NOT FOR PROD)

For local dev / testing only — set ENV `COMPLIANCE_DEV_BYPASS=1` if implemented. Do NOT use in prod.

## Auditing block patterns

Dashboard at `/notifications` shows last-7-day compliance blocks. Investigate:

- High OUTSIDE_HOURS — cron schedule wrong; review Task 8 of P2 plan
- High FREQUENCY_CAP — multiple cron methods sending to same customer/contract; need consolidation
- High NO_CONSENT — customers revoking; investigate why (intrusive content?)
- High HOLIDAY_BLOCK — currently same as OUTSIDE_HOURS

## Related

- Spec: `docs/superpowers/specs/2026-04-30-notifications-p2-compliance-design.md`
- Incident: `docs/runbooks/notifications-incident.md`
- P1 Setup: `docs/runbooks/notifications-p1-go-live-checklist.md`
```

- [ ] **Step 2: Update incident runbook with new failure modes**

In `docs/runbooks/notifications-incident.md`, add section:

```markdown
## New failure modes (P2 compliance)

### Symptom: status='BLOCKED' or status='DELAYED' in notification_logs

These are EXPECTED, not failures — they're compliance enforcement.

| status | block_reason | action |
|---|---|---|
| BLOCKED | FREQUENCY_CAP | wait — only 1 dunning per (customer+contract) per day allowed |
| BLOCKED | NO_CONSENT | re-obtain PDPA consent from customer |
| DELAYED | OUTSIDE_HOURS | none — retry queue auto-resumes at 08:00 ICT |
| DELAYED | HOLIDAY_BLOCK | none — auto-resumes after holiday |

### Symptom: Dunning queue accumulating (DELAYED count rising)

Likely cause: too many crons firing outside business hours, OR retry queue cron not running.

Action:
1. Check cron status: `cd apps/api && grep "handleNotificationRetryQueue" src/modules/notifications/scheduler.service.ts`
2. Cloud Run logs: search for "retry queue" entries — should appear every 5 min
3. If retry queue stuck, restart Cloud Run service
```

- [ ] **Step 3: Commit**

```bash
git add docs/runbooks/notifications-compliance.md docs/runbooks/notifications-incident.md
git commit -m "docs(runbooks): notifications compliance runbook + incident updates

New runbook covers:
- All 4 block reasons with diagnostic queries
- bypassCompliance use cases (and what NOT to use it for)
- Yearly holiday update procedure
- Cron timezone audit + dashboard interpretation

Incident runbook adds DELAYED/BLOCKED status handling.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase 7 — Final Verification (Day 8)

### Task 18: Final type check + full test suite + acceptance criteria

- [ ] **Step 1: Full type check**

```bash
bash tools/check-types.sh all 2>&1 | tail -5
```
Expected: PASS

- [ ] **Step 2: Full API test suite**

```bash
cd apps/api && npx jest 2>&1 | tail -10
```
Expected: 2233+ pass (no regressions, plus new compliance tests)

- [ ] **Step 3: Web tests if applicable**

```bash
cd apps/web && npx jest 2>&1 | tail -5
```

- [ ] **Step 4: Manual checklist verification**

Walk through spec §10 acceptance criteria:

- [ ] ComplianceService.canSend() returns correct decision for all 4 reasons
- [ ] Holiday calendar covers 2026+2027
- [ ] Time-window gate blocks sends 20:00-08:00 weekday, 18:00-08:00 weekend/holiday
- [ ] Frequency cap blocks 2nd dunning send within same calendar day per (customer + contract)
- [ ] PDPA consent gate blocks customers without active consent
- [ ] All 20 crons have `{ timeZone: 'Asia/Bangkok' }`
- [ ] All ~30 customer-facing call sites pass `category` + `customerId`
- [ ] Out-of-hours sends auto-queued via `status='DELAYED'`, retry queue resumes when window opens
- [ ] All dunning messages prefixed `[BESTCHOICE FINANCE]`
- [ ] NotificationLog `customer_id` + `category` + `block_reason` populated on every new row
- [ ] Block-rate dashboard shows breakdown
- [ ] All API + Web tests pass

- [ ] **Step 5: Save memory**

Update memory with P2 shipped status (similar pattern to P1):

`/Users/iamnaii/.claude/projects/-Users-iamnaii-Desktop-App-BESTCHOICE/memory/project_notifications_p2_shipped.md`

- [ ] **Step 6: Final commit if needed**

If any docs/checklist updates were made:
```bash
git add .
git commit -m "chore: P2 final verification + checklist sign-off

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review Notes

**Spec coverage:**
- ✅ Schema migration — Task 1
- ✅ NotificationCategory enum + DTO — Task 2
- ✅ Holiday JSON + service — Task 3
- ✅ Time-window utility — Task 4
- ✅ ComplianceService all gates — Task 5
- ✅ Wire into NotificationsService.send() — Task 6
- ✅ Compliance integration test — Task 7
- ✅ Cron timezone fix — Task 8
- ✅ Call sites finance — Task 9
- ✅ Call sites transactional/staff — Task 10
- ✅ Call sites marketing/saving — Task 11
- ✅ Final cleanup — Task 12
- ✅ Identification prefix — Task 13
- ✅ Forbidden words guardrails — Task 14
- ✅ 5-year retention — Task 15
- ✅ Block-rate dashboard — Task 16
- ✅ Runbooks — Task 17
- ✅ Final verification — Task 18

**Type consistency:**
- `LineChannelKey` consistent across DTO + service files
- `NotificationCategory` defined once in enum file, imported everywhere
- `ComplianceContext`/`CanSendResult` defined in compliance.service.ts, used internally
- Method names: `canSend`, `ensureIdentificationPrefix`, `scanForbiddenContent`, `getComplianceStats` — consistent

**Estimated effort:** 7-8 days
- Day 1: Tasks 1-2 (schema + DTO)
- Day 2: Tasks 3-5 (building blocks + ComplianceService)
- Day 3: Tasks 6-7 (integration + integration test)
- Day 4-5: Tasks 8-12 (cron timezone + call site migration)
- Day 6: Tasks 13-14 (identification + content guardrails)
- Day 7: Tasks 15-17 (retention + dashboard + runbooks)
- Day 8: Task 18 (final verification + memory)

After ship: P2 enables compliant go-live. P3 (templates) and P4 (refactor) can build on top.
