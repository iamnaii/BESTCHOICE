# P1 — Notifications Operational Readiness (Level 2.5)

**Date:** 2026-04-30
**Owner:** akenarin.ak@gmail.com
**Status:** Design — pending plan
**Estimated effort:** ~7 days

## 1. Context

ระบบแจ้งเตือนใน BESTCHOICE มีโค้ดครบ (NotificationsService 1124 บรรทัด, 19 cron jobs ใน scheduler.service.ts, queue+worker, NotificationLog schema, UI + Settings pages). แต่ยังไม่เปิดใช้งานจริงใน prod เนื่องจากมี blocker หลายชั้น

P1 เน้น **Operational Readiness** — ทำให้ระบบส่งแจ้งเตือนออกจาก prod ไปถึงลูกค้าได้จริง พร้อมสังเกตการณ์เพียงพอ — เป็น prerequisite ก่อน P2 (Compliance), P3 (Templates), P4 (Refactor)

### Critical bug ที่พบใน design phase

`NotificationsService.getLineToken()` ([notifications.service.ts:27](apps/api/src/modules/notifications/notifications.service.ts#L27)) hardcoded ใช้ token ของ `line-shop` channel เสมอ ในขณะที่ `customer.lineId` มักจะเป็น user ID จาก `line-finance` (น้องเบส) — LINE user ID ไม่ portable ข้าม OA → cron payment-reminders, overdue-notices, dunning ที่ออกแบบไว้จะ **fail ทุก call** เมื่อเปิด go-live

P1 ต้องแก้ bug นี้เป็นส่วนหลัก — ไม่ใช่ optional

## 2. Goals

- ใส่ credentials ของ 4 integration (line-shop, line-finance, line-staff, sms) ใน prod
- Schema + routing logic รองรับลูกค้าที่ link 2 OA แยก (shop + finance)
- Customer notification ส่งจาก **OA ที่ตรง context** ไปถึงลูกค้าจริง
- มี observability: per-channel stats, SMS credit balance, low-balance alert
- Sender ID `BESTCHOICE` approved ที่ ThaiBulkSMS
- Runbook สำหรับ credential rotation + incident response

## 3. Out of Scope (defer)

| | Phase |
|---|---|
| Quiet hours (08:00-20:00), frequency cap, holiday block | P2 |
| PDPA enforcement ทุก channel | P2 |
| Notification template management UI | P3 |
| LINE delivery status (LINE Messaging API ไม่มี DLR) | จะไม่ทำ — ยอมรับว่าไม่มี |
| Email channel, push notification | P4 |
| Unified notification engine (consolidate 19+7 crons) | P4 |
| LINE rate limit handling, quota auto-pause | P4 |

## 4. Architecture

### 4.1 Schema changes

**Customer model** ([apps/api/prisma/schema.prisma:700](apps/api/prisma/schema.prisma#L700))

```prisma
model Customer {
  // RENAME: lineId → lineIdFinance (existing values map to finance — see §6 backfill)
  lineIdFinance  String?  @map("line_id_finance")
  // NEW
  lineIdShop     String?  @map("line_id_shop")
  // ...
}
```

**User model** ([schema.prisma:552](apps/api/prisma/schema.prisma#L552)) — staff: คงเดิม (ใช้สำหรับ line-staff routing — staff ไม่ link หลาย OA)

**Supplier model** ([schema.prisma:1199](apps/api/prisma/schema.prisma#L1199)) — คงเดิม (supplier ไม่รับ noti จาก OA แยก)

### 4.2 Routing — explicit channelKey

```ts
type LineChannelKey = 'line-shop' | 'line-finance' | 'line-staff';

interface SendNotificationDto {
  channelKey?: LineChannelKey;  // required when channel === 'LINE'
  channel: 'LINE' | 'SMS' | 'IN_APP';
  recipient: string;
  message: string;
  // ...existing fields
}
```

`NotificationsService.getLineToken(channelKey)` อ่าน token จาก `IntegrationConfig` ตาม channelKey ที่ส่งเข้ามา

### 4.3 Routing rules (business mapping)

| Event | channelKey | recipient field |
|---|---|---|
| Payment reminder, overdue notice, dunning escalation | `line-finance` | `customer.lineIdFinance` |
| Contract signed, contract activated, contract completed | `line-finance` | `customer.lineIdFinance` |
| Receipt, payment success, early payoff success | `line-finance` | `customer.lineIdFinance` |
| MDM lock notice (ถึงลูกค้า) | `line-finance` | `customer.lineIdFinance` |
| Shop saving plan reminder, promotion, marketing | `line-shop` | `customer.lineIdShop` |
| Manager/owner alerts (overdue summary, default alert) | `line-staff` | `notifyTargets` (group/user IDs จาก integration config) |

### 4.4 Missing-recipient handling

ถ้า notification ต้องส่งไปยัง `lineIdShop` แต่ลูกค้ายังไม่ link → **log + skip + Sentry breadcrumb**
- ไม่ fallback SMS (ต้นทุนเพิ่ม + ไม่ใช่ business intent)
- Sentry tag: `module=notifications, missing_field=lineIdShop, customer_id=...`
- รวมเป็น metric "data quality gap" ไว้ติดตาม

ลูกค้าผ่อน (FINANCE) ต้อง verify line-finance OA เสมอ → `lineIdFinance` ควรมีค่าเสมอ. Missing = ลูกค้าผ่อนแต่ไม่ verify = data quality issue ต้อง support ติดตาม

## 5. Observability

### 5.1 Per-channel stats endpoint

**Before:** `GET /notifications/logs/stats` → `{ total, sent, failed, pending }`

**After:**
```json
{
  "line": { "total": 250, "sent": 240, "failed": 8, "pending": 2 },
  "sms":  { "total": 50, "sent": 48, "failed": 1, "pending": 1, "creditRemaining": 850 },
  "in_app": { "total": 10, "sent": 10, "failed": 0, "pending": 0 }
}
```

### 5.2 NotificationsPage UI

- 3 cards (LINE / SMS / IN_APP) แทน 4 stat numbers รวม
- SMS card แสดง credit balance + warning ถ้า < 100
- คงเดิม: log table, template tab (defer P3), send tab

### 5.3 SMS credit alert cron

- Cron daily 09:00 ICT — เรียก `notificationsService.checkSmsCredit()`
- ถ้า credit < 100 → push LINE message ไป `line-staff` แจ้ง owner
- เพิ่ม method ใน [scheduler.service.ts](apps/api/src/modules/notifications/scheduler.service.ts)

### 5.4 Sentry capture (existing — verify only)

- `reportCronFailure()` มีอยู่แล้ว — verify ว่ายิงเข้า prod project จริง
- ไม่เพิ่ม Sentry alert rule ใน code (config ใน Sentry dashboard manual)

## 6. Backfill strategy

### Step 1 — Migration
```sql
ALTER TABLE customers RENAME COLUMN line_id TO line_id_finance;
ALTER TABLE customers ADD COLUMN line_id_shop TEXT;
```

Prisma migration name: `rename_customer_line_id_to_finance_and_add_shop`

### Step 2 — Existing data assumption
- ค่าใน `line_id_finance` ปัจจุบัน = treat เป็น finance ID (best guess: verification flow ของ finance OA เป็นต้นทางหลักที่ write ค่านี้)
- `line_id_shop` ทุก row = NULL

### Step 3 — Organic populate
- ไม่ broadcast ขอให้ลูกค้า re-link
- ลูกค้าที่เข้า shop OA ผ่าน LIFF / register flow ใหม่ → write `lineIdShop`
- ระหว่าง transition, shop notifications จะ skip ลูกค้าที่ `lineIdShop` ยัง null + Sentry log

### Step 4 — Edge case
- ถ้าลูกค้าเก่า `lineIdFinance` จริงๆ คือ shop ID (rare, จากกรณี LIFF register ผ่าน shop OA แล้ว overwrite finance ID) → finance noti จะ fail
- Detection: ดู Sentry error LINE 400 invalid user → support ติดตามรายตัว → manual fix

## 7. Setup steps (manual, ไม่ใช่งานเขียนโค้ด)

### 7.1 Submit SMS Sender ID
- Login ThaiBulkSMS dashboard
- Submit ขอ approval ชื่อ `BESTCHOICE`
- รอ approval 3-7 วันทำการ
- **เริ่มทำ day 1** เพราะรอนาน

### 7.2 LINE Console
- 3 channels (line-shop, line-finance, line-staff) ตั้ง webhook URL ตาม [integration-registry.ts](apps/api/src/modules/integrations/integration-registry.ts)
- Generate channel access token ที่ใช้ระยะยาว (long-lived) ไม่ใช่ short-lived เพื่อไม่ต้อง rotate บ่อย

### 7.3 ใส่ credentials ผ่าน UI
- IntegrationHubPage → 4 integrations
- กดปุ่ม "ทดสอบ" ทุกตัว → ต้อง pass ก่อน save

### 7.4 ส่ง test message end-to-end
- ใช้ `POST /line-oa/test-send` เลือก message type — verify ลูกค้าตัวอย่างได้รับ
- ส่ง SMS ทดสอบไปเบอร์ owner — verify DLR กลับมา (status update ใน notification_logs)

## 8. Migration order

| # | Step | Risk | Rollback |
|---|---|---|---|
| 1 | Submit SMS Sender ID at ThaiBulkSMS | None | - |
| 2 | Schema migration (rename + add field) | Low | Prisma migrate revert |
| 3 | Update `verification.service.ts` + `liff-api.service.ts` write to `lineIdFinance` | Low | revert PR |
| 4 | Add `channelKey` param ใน `NotificationsService.send()` (default `'line-finance'` for BC) | Low | default ป้องกัน breaking |
| 5 | Update 30 call sites — explicit channelKey ตาม routing rules §4.3 | Medium | revert per call site, default ใน step 4 ครอบ |
| 6 | Update CustomerEditModal.tsx — 2 input fields | Low | revert PR |
| 7 | Add new LIFF flow shop OA → write `lineIdShop` | Medium | feature flag |
| 8 | Per-channel stats endpoint + UI | Low | revert PR |
| 9 | SMS credit balance card + alert cron | Low | revert PR |
| 10 | Tests update + run full suite | Low | - |
| 11 | Deploy prod + observe Sentry 24hr | Low | rollback Cloud Run revision |
| 12 | Setup credentials in prod via UI | Low | clear credentials |
| 13 | Submit Sender ID approved → start receiving SMS DLR | None | - |
| 14 | Remove `channelKey` default — force explicit | Low | re-add default |

## 9. Documentation

- `docs/runbooks/notifications-credential-rotation.md` — LINE token rotate, SMS API key rotate
- `docs/runbooks/notifications-incident.md` — Failure rate spike, credit exhausted, sender ID rejected

## 10. Acceptance criteria

- [ ] Schema migrated, no orphan references to `lineId`
- [ ] All 4 integrations have credentials in prod
- [ ] Test message sent + received via line-shop, line-finance, line-staff
- [ ] SMS test sent + DLR received in NotificationLog
- [ ] Cron payment-reminder runs without 100% failure rate (sample of 1 day)
- [ ] /notifications page shows per-channel breakdown
- [ ] SMS credit visible in IntegrationHubPage
- [ ] Sender ID `BESTCHOICE` approved at ThaiBulkSMS
- [ ] 2 runbook files committed
- [ ] Type check + test suite pass (no regression in 26 API suites + 11 web files)

## 11. Risks & mitigation

| Risk | Likelihood | Mitigation |
|---|---|---|
| Backfill assumption wrong (lineIdFinance contains shop IDs) | Low | Sentry catches LINE 400, support ติดตามรายตัว |
| 30 call sites missed in routing update | Medium | Step 4 default `'line-finance'` = safe default; grep audit before step 14 |
| LINE Console token not long-lived → rotate ทุก 30 วัน | Medium | Generate long-lived token (ไม่หมดอายุ) ใน step 7.2 |
| ThaiBulkSMS sender ID rejected | Low | Submit early (day 1), follow-up หลัง 5 วันถ้ายังไม่อนุมัติ |
| คน config UI ใส่ token ผิด channel | Medium | Test connection ก่อน save (existing) — ถ้า fail block save |

## 12. Dependencies on P2/P3/P4

P1 ไม่ต้องรอ P2/P3/P4 — ทำได้ standalone

แต่ P1 เป็น **prerequisite** สำหรับ:
- P2 (Compliance) — ต้องมี credential + routing ก่อนถึงจะคุม quiet hours จริงได้
- P3 (Templates) — ต้องมี per-channel routing ก่อนเขียน template ที่อ้าง channel ได้
- P4 (Refactor) — ต้องมี baseline ที่ทำงานก่อน refactor
