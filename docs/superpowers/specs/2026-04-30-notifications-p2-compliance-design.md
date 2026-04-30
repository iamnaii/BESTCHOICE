# P2 — Notifications Compliance (พ.ร.บ.ทวงถามหนี้ + พ.ร.บ.PDPA)

**Date:** 2026-04-30
**Owner:** akenarin.ak@gmail.com
**Status:** Design — pending plan
**Estimated effort:** ~7-8 days
**Predecessor:** P1 PR #731 (operational readiness — shipped 2026-04-30)

## 1. Context

P1 fixed multi-OA routing + observability. **The system can now send notifications, but most existing crons would violate Thai law on first execution** because:

1. `scheduler.service.ts` cron expressions are in UTC and lack `{ timeZone: 'Asia/Bangkok' }` → "morning reminders" actually fire 15:00-23:55 ICT (afternoon/evening)
2. Sending after 20:00 ICT violates **พ.ร.บ.การทวงถามหนี้ พ.ศ. 2558 มาตรา 9** (max 20:00 weekday, 18:00 weekend/holiday)
3. No frequency cap — multiple dunning crons in same day per contract = "ติดต่อหลายครั้งเกินไป" violation
4. PDPA consent check only in 2 places — most flows skip
5. Holiday calendar absent — would send Songkran morning, etc.
6. Record keeping: NotificationLog retains 1 year, law requires 5 years

**P2 hard-blocks every non-compliant send at runtime** + extends record keeping. After P2, the system becomes safe to go-live legally.

## 2. Goals

- Cron timezone explicit `Asia/Bangkok` everywhere
- Time-window gate: 08:00-20:00 weekday, 08:00-18:00 weekend/holiday
- Holiday calendar: Thai public holidays (JSON seed, no UI for v1)
- Frequency cap: **1 message/contract/day** for dunning-class notifications
- System-critical override (`bypassCompliance: true`) for receipts, payment success, account verification
- PDPA `hasActiveConsent` check on every customer-facing customer notification
- Identification prefix `[BESTCHOICE FINANCE]` required on dunning messages
- Content guardrails: regex forbidden-words detector → Sentry warn (don't block — manual review)
- Record keeping: extend retention to 5 years for finance notifications
- Block-rate dashboard in NotificationsPage (visibility into compliance gating)

## 3. Out of Scope (defer)

| | Phase |
|---|---|
| Notification template UI editor | P3 |
| LIFF preference center (let customers configure further) | P4 |
| Multi-language compliance (Eng/CN) | P4 |
| Cross-border DPA agreement with LINE Japan | external/legal |
| Per-staff override audit (who pressed bypass) | P4 |
| Dynamic holiday calendar UI | P4 |

## 4. Architecture

### 4.1 New service — `ComplianceService`

Single decision point. Every customer-facing send goes through `canSend()` first.

```typescript
// apps/api/src/modules/notifications/compliance.service.ts

interface ComplianceContext {
  channel: NotificationChannel;       // LINE / SMS / IN_APP
  channelKey?: LineChannelKey;        // for LINE
  customerId: string;
  contractId?: string;                // grouping unit for frequency cap
  category: NotificationCategory;     // determines time window strictness
  bypassCompliance?: boolean;         // system-critical override (receipts, etc.)
}

enum NotificationCategory {
  DUNNING       = 'DUNNING',          // ทวงหนี้ — strict (8-20 weekday, 8-18 weekend)
  REMINDER      = 'REMINDER',         // เตือนก่อนงวด — same time windows but doesn't count toward cap
  TRANSACTIONAL = 'TRANSACTIONAL',    // ใบเสร็จ, payment success — bypassed by default
  STAFF         = 'STAFF',            // staff/owner alerts — bypass time windows
  MARKETING     = 'MARKETING',        // promo — strict windows + opt-in only
}

interface CanSendResult {
  allowed: boolean;
  reason?: 'OUTSIDE_HOURS' | 'FREQUENCY_CAP' | 'NO_CONSENT' | 'HOLIDAY_BLOCK';
  retryAfter?: Date;                  // when next allowed
}

class ComplianceService {
  async canSend(ctx: ComplianceContext): Promise<CanSendResult>;
}
```

### 4.2 Time-window enforcement

```
DUNNING + REMINDER + MARKETING:
  weekday (Mon-Fri):  08:00 - 20:00 ICT
  weekend/holiday:    08:00 - 18:00 ICT

TRANSACTIONAL: any time (payment reminder กับใบเสร็จ ลูกค้าจ่ายเงินตอนนั้น)
STAFF:         any time (staff don't have legal time windows)
```

Outside the window → `OUTSIDE_HOURS` + `retryAfter` = next 08:00 ICT (next day if past 20:00 today)

Implementation: `Date` objects rely on `process.env.TZ = 'Asia/Bangkok'` (already set in main.ts). New `isWithinThaiBusinessHours(now, weekendOrHoliday)` utility.

### 4.3 Holiday calendar

**Source:** static JSON in repo `apps/api/src/data/thai-holidays.json`

```json
{
  "2026": [
    "2026-01-01", "2026-02-12", "2026-04-06", "2026-04-13", "2026-04-14",
    "2026-04-15", "2026-05-01", "2026-05-04", "2026-05-25", "2026-06-03",
    "2026-07-08", "2026-07-09", "2026-07-30", "2026-08-12", "2026-10-13",
    "2026-10-23", "2026-12-05", "2026-12-10", "2026-12-31"
  ],
  "2027": [...]
}
```

`HolidayService.isHoliday(date)` does O(1) lookup. JSON updated yearly when ครม. announces.

Custom company holidays: deferred to P4 (use `bypassCompliance` if needed in interim).

### 4.4 Frequency cap

**Unit: per (customerId + contractId)**

Query: count NotificationLog where:
- customerId = X
- relatedId = contractId (we already store relatedId as contract-related ID)
- category = DUNNING (REMINDER doesn't count)
- status = SENT
- sentAt >= start of today (Bangkok time)

If count >= 1 → block with `FREQUENCY_CAP`.

**Schema**: add `category` column to NotificationLog so we can query by category. Migration.

```prisma
model NotificationLog {
  // ...existing
  category   String?  @map("category")  // DUNNING | REMINDER | TRANSACTIONAL | STAFF | MARKETING
}
```

Index: `@@index([customerId, relatedId, category, sentAt])` for fast cap query.

Note: `customerId` not currently on NotificationLog — need to add. Currently `recipient` is the LINE user ID or phone, not customer FK.

```prisma
model NotificationLog {
  // ...existing
  customerId String?  @map("customer_id")
}
```

### 4.5 PDPA consent gate

Already partially implemented (`pdpaService.hasActiveConsent`). Extend to:

- Every send where `category ∈ {DUNNING, REMINDER, MARKETING}`
- TRANSACTIONAL bypass — payment is performance of contract (PDPA lawful basis)
- STAFF bypass — internal employees, not data subjects in PDPA sense
- Opt-out endpoint already exists in PDPA module — verify works

Centralized in ComplianceService — single source of truth.

### 4.6 Identification prefix

All DUNNING messages must start with `[BESTCHOICE FINANCE]` — required by พ.ร.บ.ทวงถามหนี้ มาตรา 8 (identification of creditor + collector).

Implementation:
- ComplianceService validates message starts with `[BESTCHOICE FINANCE]` for category=DUNNING
- If not → log warning to Sentry + auto-prepend the prefix (don't block — graceful degradation)

Existing dunning messages in `scheduler.service.ts:244-249` — audit and add prefix manually:

```typescript
const stageMessages = {
  REMINDER: `[BESTCHOICE FINANCE] แจ้งเตือน: คุณ${name} มียอดค้างชำระ...`,
  NOTICE: `[BESTCHOICE FINANCE] แจ้งค้างชำระ: ...`,
  // etc.
};
```

### 4.7 Content guardrails

Regex forbidden-words list (private, hardcoded):

```typescript
const FORBIDDEN_PATTERNS = [
  /ข่มขู่|ขู่/,
  /ดูถูก|เหยียดหยาม/,
  /ระยำ|เ?หี้?ย|ส้นตีน/,  // profanity
  /แจ้งความ|ฟ้องร้อง/,    // threats (allowed in LEGAL_ACTION stage only — exception)
];
```

If matched in dunning message → log warning to Sentry. Doesn't block — manual review pattern. Special case: `LEGAL_ACTION` dunning stage CAN say "ดำเนินการตามกฎหมาย" — allowed.

### 4.8 Record keeping

NotificationLog retention extended for finance/dunning records:

- Current: 1 year (per `handleDataRetention` Sun 09:00 ICT cron)
- New: **5 years** for `category IN ('DUNNING', 'REMINDER', 'TRANSACTIONAL')`
- Other categories (STAFF, MARKETING) unchanged at 1 year

Update `handleDataRetention` cron to filter by category.

### 4.9 Cron timezone correctness

Add `{ timeZone: 'Asia/Bangkok' }` to all 20 crons in `scheduler.service.ts`. After this:

- `@Cron('0 8 * * *', { timeZone: 'Asia/Bangkok' })` = 08:00 ICT (was 15:00 ICT)
- `@Cron('0 9 * * *', { timeZone: 'Asia/Bangkok' })` = 09:00 ICT (was 16:00 ICT)
- etc.

Side effect: cron schedule shifts +7 hours. Combined with time-window gate, dunning crons must be inside the legal window.

**Schedule audit (after fix):**

| Cron | Was (ICT) | Now (ICT) | Window OK? |
|---|---|---|---|
| handleLateFeeCalculation | 07:00 | 00:00 | n/a (no send) |
| handleContractStatusUpdate | 07:30 | 00:30 | ❌ — needs window gate |
| handleDunningEscalation | 08:00 | 01:00 | ❌ — needs window gate |
| handleSmsCreditAlert | 09:00 | 09:00 | ✅ STAFF bypass |
| handlePaymentReminders | 15:00 | 08:00 | ✅ |
| handleOverdueNotices | 16:00 | 09:00 | ✅ |
| handleManagerNotifications | 16:30 | 09:30 | ✅ STAFF bypass |
| handleOwnerDefaultNotifications | 17:00 | 10:00 | ✅ STAFF bypass |
| handleAutoPaymentLinks | 15:30 | 08:30 | ✅ |
| handleDailyReport | 23:55 | 16:55 | ✅ STAFF bypass |
| handleDailyLineReport | 20:00 | 13:00 | ✅ STAFF bypass |

**Important:** crons that fire outside business hours (00:30 contract status, 01:00 dunning escalation) will have their LINE sends auto-delayed by ComplianceService until next 08:00 window. This is correct behavior — late-fee/status calc still happens at midnight, but the customer noti is queued.

### 4.10 Auto-delay queue (out-of-hours sends)

When `canSend()` returns `OUTSIDE_HOURS`, instead of failing, route the notification to a delayed queue:

- NotificationLog row created with `status = 'DELAYED'` + `next_retry_at = retryAfter`
- Existing `handleNotificationRetryQueue` cron (every 5 min) picks it up
- Cron re-runs `canSend()` — if now within window, sends; otherwise re-delays

This means contract-status-change at 00:30 → noti queued → fires at 08:00 next day naturally.

### 4.11 Block-rate observability

NotificationsPage gains a 4th card or section showing block rate per reason in last 7 days:

- "Outside hours blocks: N"
- "Frequency cap blocks: N"  
- "PDPA consent blocks: N"
- "Holiday blocks: N"

Helps tune business expectations vs compliance.

## 5. Schema Changes

```prisma
model NotificationLog {
  // existing fields...
  customerId String?  @map("customer_id")
  category   String?  @map("category")  // DUNNING | REMINDER | TRANSACTIONAL | STAFF | MARKETING
  blockReason String? @map("block_reason")  // OUTSIDE_HOURS | FREQUENCY_CAP | NO_CONSENT | HOLIDAY_BLOCK | null
  // existing indexes...
  @@index([customerId, relatedId, category, sentAt])
  @@index([category, sentAt])
}
```

Migration: `add_notification_log_compliance_fields`

```sql
ALTER TABLE notification_logs ADD COLUMN customer_id TEXT;
ALTER TABLE notification_logs ADD COLUMN category TEXT;
ALTER TABLE notification_logs ADD COLUMN block_reason TEXT;
CREATE INDEX idx_notification_logs_compliance ON notification_logs (customer_id, related_id, category, sent_at);
CREATE INDEX idx_notification_logs_category_sent ON notification_logs (category, sent_at);
```

Backfill: skip — existing rows are pre-P2, can't recover category. Only new rows get category.

## 6. API Surface

### 6.1 NotificationsService.send() changes

```typescript
interface SendNotificationDto {
  // existing fields...
  customerId?: string;             // NEW — for compliance tracking
  category?: NotificationCategory; // NEW — required for customer-facing
  bypassCompliance?: boolean;      // NEW — system-critical override
}
```

Internal flow:
1. If `category` requires compliance check (DUNNING|REMINDER|MARKETING) and not bypassed:
   - Call `ComplianceService.canSend(ctx)`
   - If blocked: write log row with `status='BLOCKED'`, `blockReason=...`, return early (no actual send)
2. Else proceed to existing send logic
3. Persist `customerId`, `category` to NotificationLog

### 6.2 New endpoint

`GET /notifications/compliance/stats`
Returns per-reason block rate last 7 days for the dashboard.

`GET /notifications/holidays`
Returns Thai holidays for current year + 1 (for UI display only).

## 7. Caller Migration

All customer-facing call sites must add `category` + `customerId`. Audit:

| Module | Category | bypassCompliance? |
|---|---|---|
| scheduler.handlePaymentReminders | REMINDER | no |
| scheduler.handleOverdueNotices | DUNNING | no |
| scheduler.handleDunningEscalation | DUNNING | no |
| scheduler.handleManagerNotifications | STAFF | yes (auto from category) |
| scheduler.handleOwnerDefaultNotifications | STAFF | yes |
| scheduler.notifyStatusChangedCustomers | DUNNING | no |
| scheduler.handleAutoPaymentLinks | DUNNING | no |
| payments.service receipt | TRANSACTIONAL | yes |
| paysolutions.service payment success | TRANSACTIONAL | yes |
| contracts.contract-workflow signed | TRANSACTIONAL | yes |
| contracts.documents signed Flex | TRANSACTIONAL | yes |
| mdm-auto auto-lock | DUNNING | no |
| collections-session contact attempts | DUNNING | no |
| shop-saving-plan reminder | REMINDER | no |
| broadcast (campaign) | MARKETING | no |
| csat survey | MARKETING | no |

~30 call sites. Mechanical update.

## 8. Self-Identification (Senders)

Each LINE message in DUNNING category must contain `BESTCHOICE FINANCE` somewhere. Identification prefix `[BESTCHOICE FINANCE]` is the standard. ComplianceService validates + auto-prepends if missing.

For SMS: sender = `BESTCHOICE` (already configured at provider level — see P1 runbook).

## 9. Migration Order

| # | Step | Risk | Rollback |
|---|---|---|---|
| 1 | Schema migration: customerId, category, blockReason on NotificationLog | Low | Migration revert |
| 2 | ComplianceService skeleton + unit tests | Low | revert PR |
| 3 | Holiday JSON file + HolidayService | Low | revert |
| 4 | Time-window check + isWithinThaiBusinessHours util | Low | revert |
| 5 | Frequency-cap query + tests | Low | revert |
| 6 | Wire ComplianceService into NotificationsService.send() | Medium | feature flag `COMPLIANCE_ENABLED=false` to bypass |
| 7 | Add `{ timeZone: 'Asia/Bangkok' }` to all 20 crons in scheduler.service.ts | Medium | revert per cron |
| 8 | Update all ~30 call sites with category + customerId | Medium | revert per call site |
| 9 | Identification prefix audit — add to dunning templates | Low | revert |
| 10 | Forbidden-words content guardrails (Sentry warn only, no block) | Low | revert |
| 11 | Auto-delay queue path (status='DELAYED' + retry queue picks up) | Medium | revert |
| 12 | Extend retention to 5 years for finance categories | Low | revert |
| 13 | Block-rate dashboard endpoint + UI | Low | revert |
| 14 | Tests + integration + e2e | Low | - |
| 15 | Deploy + observe 24h | Low | rollback Cloud Run revision |

## 10. Acceptance Criteria

- [ ] `ComplianceService.canSend()` returns correct decision for all 4 reasons
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
- [ ] Two new tests minimum: ComplianceService unit (each gate) + integration test (end-to-end blocked send creates log row with reason)

## 11. Risks & Mitigation

| Risk | Likelihood | Mitigation |
|---|---|---|
| Cron timezone shift breaks downstream expectations (e.g. accounting cutoffs) | Medium | Audit each cron — cutoffs that depend on calendar boundary unaffected (00:00 ICT = 17:00 UTC prev day, but boundaries cross both ways) |
| Holiday JSON missed yearly update → notifications wrongly sent on holiday | Medium | Sentry alarm if no holidays for current year; calendar reminder for owner |
| Auto-delay queue grows unbounded if compliance always blocks | Low | Cap delayed retries to 7 days, then drop with Sentry |
| Frequency cap blocks legitimate notifications (e.g. customer paid + needs receipt) | Low | TRANSACTIONAL bypass covers this; receipts use bypassCompliance=true |
| Performance: frequency cap query per send | Low | Composite index `(customer_id, related_id, category, sent_at)` |
| `customerId` missing on legacy NotificationLog rows → frequency cap miscounts | Low | Cap query filters `customer_id IS NOT NULL`; pre-P2 rows excluded |
| Identification prefix double-prepended if already present | Low | Check `startsWith('[BESTCHOICE FINANCE]')` before prepend |

## 12. Dependencies on Other Phases

- **P1 prerequisite (DONE)**: per-OA channelKey routing must be in place
- **P3 (Templates)** can build on top — template editor enforces `category` + adds prefix automatically
- **P4 (Refactor)** — unify cron + better dashboard

## 13. Test Strategy

- **Unit tests**: ComplianceService each gate (time, holiday, frequency, consent) with deterministic Date mocking
- **Integration tests**: NotificationsService.send() end-to-end blocked + queued + retry success
- **Cron timezone test**: simple sanity check that NodeCron + Asia/Bangkok produces expected fire time
- **Manual e2e**: dispatch test send at 20:01 ICT → expect blocked + queued; wait until 08:00 → confirms send

Sample tests outlined in plan.

## 14. Documentation Updates

- New runbook: `docs/runbooks/notifications-compliance.md` — explains gates, override flag use cases, holiday update procedure
- Update `notifications-incident.md` with new failure modes (`OUTSIDE_HOURS`, `FREQUENCY_CAP`, `HOLIDAY_BLOCK`, `NO_CONSENT`)
- Update `notifications-credential-rotation.md` if needed
- Update `notifications-p1-go-live-checklist.md` to include "P2 compliance enabled" check

## 15. Estimated Effort

~7-8 days, broken across phases (per implementation plan).

---

**Ready for plan**: this spec is the source of truth for `writing-plans` skill.
