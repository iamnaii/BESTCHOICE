# Loyalty Admin Page + Policy Engine — Design Spec

**Date**: 2026-04-19
**Roadmap**: CTO-ROADMAP-2026 Phase 5.4 — Loyalty Points & Referral Program
**Size**: M → L (~2 days, 1 subagent)
**Status**: Approved, ready for implementation plan

---

## 1. Motivation

ระบบ Loyalty backend พร้อมใช้แล้ว (LoyaltyPoint + LoyaltyRedemption tables, service methods, referral schema) แต่ **ขาด 2 ส่วนสำคัญ**:

1. **Admin UI ไม่มี** — ไม่มีหน้ารวม monitor + operate loyalty; ปัจจุบันดูได้แค่ per-customer ใน `CustomerDetailPage` กับ LIFF มือลูกค้า
2. **Earning logic gap** — ปัจจุบันให้แต้มเฉพาะ installment payment on-time เท่านั้น → ลูกค้าซื้อสดและลูกค้าผ่อน GFIN **ไม่ได้แต้มเลย** ทั้งที่จ่ายเงินเต็ม
3. **Referral feature dead** — `awardReferralPoints()` method มีอยู่ แต่**ไม่มี call site** ทั้ง codebase → ลูกค้าแนะนำเพื่อนแล้วไม่เคยได้แต้ม (silent bug)
4. **Policy hardcoded** — `POINTS_PER_BAHT`, `REFERRAL_POINTS`, `POINTS_EXPIRY_DAYS` เป็น const ใน service → เปลี่ยนต้อง redeploy

## 2. Goals

- Admin (OWNER+FM+ACCOUNTANT) เห็น dashboard สถานะแต้มรวมของธุรกิจ
- Staff (ทุก role) เสนอ manual adjust แต้มได้ + workflow approval ปลอดภัย
- Customer ซื้อสด / ผ่อน GFIN ได้แต้มด้วย (fix gap)
- Customer ผ่อน FINANCE จบสัญญา → ได้โบนัสจูงใจผ่อนต่อเนื่อง
- Referral program active (wire `awardReferralPoints`)
- Policy แก้ได้ผ่านหน้าตั้งค่า (ไม่ต้อง redeploy)
- แต้มหมดอายุแบบ rolling 12 เดือน inactive (retention friendly)

## 3. Non-Goals

- **Campaign engine** (double points week, time-limited promo) — อยู่ใน 5.6 Promotional Campaigns
- **Tier/level** (silver/gold/platinum) — future (not in this spec)
- **Cross-system redemption** (แลกแต้มกับ partner shop) — future
- **LINE Rich Menu for loyalty** — existing rich menu sufficient
- **Email digest** — LINE notification only

---

## 4. User Stories

### OWNER
- ดู dashboard ภาพรวมแต้ม issued/redeemed/expired/outstanding, redemption rate
- Review + approve manual adjust requests (PENDING queue)
- แก้ policy loyalty (rates, bonuses, expiry) ผ่าน settings
- Export customer points CSV สำหรับ audit

### FINANCE_MANAGER
- Approve adjust requests (ไม่ใช่ของตัวเอง)
- Monitor top redeemers / outliers
- ไม่แก้ policy ได้

### SALES / BRANCH_MANAGER / ACCOUNTANT
- Submit manual adjust request (เช่นชดเชย บันทึกผิด)
- ดู customer list พร้อม balance
- ดู referral stats
- ไม่อนุมัติ request ของตัวเอง

### Customer (existing LIFF)
- ดู balance + history (ไม่เปลี่ยน)
- Redeem ผ่าน SALES ที่ POS (flow เดิม)

---

## 5. Earning Rules (Y Hybrid — chosen)

| Channel | Trigger | Rate (default) | Notes |
|---------|---------|----------------|-------|
| **ซื้อสด** | Cash sale completed | `pointsPerBahtCash` × amount (0.01 = 1/100) | Immediate |
| **ผ่อน GFIN** | Contract activated (external financing) | `pointsPerBahtGfin` × financedAmount | SHOP ได้เงินเต็มจาก GFIN ทันที |
| **ผ่อน FINANCE on-time** | Payment received ON_TIME flag | `pointsPerBahtFinance` × monthlyPaid | Existing logic (keep) |
| **ผ่อน FINANCE completion** | Contract last payment cleared | `completionBonus` (default 500 pts) | WOW moment |
| **Referral** | `referralTrigger` event on referred customer | `referralBonus` (default 500 pts) to referrer | See §7 |

**Repossession**: Customer ยังได้แต้มจากงวดที่จ่ายตรงเวลาแล้ว (ไม่ reverse) + ไม่ได้ completion bonus

**Grace period**: ถ้าจ่ายช้า < 3 วัน ถือว่า on-time (ใช้ policy เดิม)

---

## 6. Approval Workflow (Manual Adjustment)

### Trigger logic
```
delta > 0 && delta <= 20  →  AUTO_APPROVED (instant apply)
delta > 20 || delta < 0    →  PENDING (queue for review)
```

### Approver rules
- Approver ∈ {OWNER, FINANCE_MANAGER}
- `approvedBy !== requestedBy` (no self-approve — enforced by service)
- Rejection requires `rejectReason` (required field)

### Status transitions
```
PENDING ──→ AUTO_APPROVED (system)
PENDING ──→ APPROVED (OWNER/FM)
PENDING ──→ REJECTED (OWNER/FM, requires reason)
```

Transitions are immutable — cannot re-open rejected/approved records. Corrections done via new adjustment.

---

## 7. Referral Trigger

Chosen default: `FIRST_PAYMENT` (anti-abuse — requires real money from referred customer)

Configurable via `LoyaltyPolicy.referralTrigger`:
- `REGISTER` — immediate (most risky, spam-prone)
- `FIRST_PAYMENT` — first payment cleared (default, recommended)
- `CONTRACT_ACTIVATE` — contract signed + activated
- `THIRD_PAYMENT` — 3 payments cleared (most conservative)

`awardReferralPoints()` call sites (to be wired in implementation):
- `FIRST_PAYMENT` → `PaymentsService.create` after success
- `CONTRACT_ACTIVATE` → `ContractsService.activate` after success
- `REGISTER` → `CustomersService.create` after success
- `THIRD_PAYMENT` → new counter in payment success path

---

## 8. Expiry Policy (C Rolling 12-month activity-based)

- Field: `Customer.lastLoyaltyActivityAt DateTime?`
- Activity events (auto-update `lastLoyaltyActivityAt`):
  - Earn points (any channel)
  - Redeem points
  - Payment marked ON_TIME
- Cron (daily 02:00 Asia/Bangkok):
  - Find customers where `lastLoyaltyActivityAt < NOW - policy.inactivityMonths months` AND `loyaltyBalance > 0`
  - Expire all points: INSERT `LoyaltyPoint { points: -balance, reason: "EXPIRED_INACTIVITY" }` in transaction
  - Update `loyaltyBalance = 0`
  - Send LINE notification if customer has LINE ID
  - Sentry capture on transaction failure
- Notification LINE (optional follow-up): remind customer 30 days before expiry

---

## 9. Architecture

### Schema changes

```prisma
model LoyaltyAdjustment {
  id           String             @id @default(uuid())
  customerId   String             @map("customer_id")
  delta        Int                // signed: +bonus or -penalty
  reason       AdjustmentReason
  note         String?            // free-text detail
  status       AdjustmentStatus   @default(PENDING)
  requestedBy  String             @map("requested_by")   // userId
  approvedBy   String?            @map("approved_by")    // userId (!= requestedBy)
  approvedAt   DateTime?          @map("approved_at")
  rejectReason String?            @map("reject_reason")

  createdAt DateTime  @default(now()) @map("created_at")
  updatedAt DateTime  @updatedAt      @map("updated_at")
  deletedAt DateTime? @map("deleted_at")

  customer  Customer @relation(fields: [customerId], references: [id])
  requester User     @relation("AdjustRequester", fields: [requestedBy], references: [id])
  approver  User?    @relation("AdjustApprover",  fields: [approvedBy],  references: [id])

  @@index([status, createdAt])
  @@index([customerId])
  @@map("loyalty_adjustments")
}

enum AdjustmentStatus { PENDING, APPROVED, REJECTED, AUTO_APPROVED }
enum AdjustmentReason { BONUS_CAMPAIGN, STAFF_ERROR, CUSTOMER_COMPLAINT, MANUAL_OTHER }

model LoyaltyPolicy {
  id String @id @default("singleton")   // single-row pattern (enforced in service)

  // Earning rates (editable in settings UI)
  pointsPerBahtCash    Decimal @db.Decimal(8,6) @default(0.01) @map("points_per_baht_cash")
  pointsPerBahtGfin    Decimal @db.Decimal(8,6) @default(0.01) @map("points_per_baht_gfin")
  pointsPerBahtFinance Decimal @db.Decimal(8,6) @default(0.01) @map("points_per_baht_finance")
  completionBonus      Int     @default(500) @map("completion_bonus")

  // Referral
  referralBonus   Int    @default(500) @map("referral_bonus")
  referralTrigger String @default("FIRST_PAYMENT") @map("referral_trigger")   // enum-as-string

  // Expiry & redemption
  inactivityMonths Int     @default(12) @map("inactivity_months")
  minRedeemPoints  Int     @default(100) @map("min_redeem_points")
  bahtPerPoint     Decimal @db.Decimal(8,2) @default(1.00) @map("baht_per_point")

  isActive  Boolean   @default(true) @map("is_active")
  updatedBy String?   @map("updated_by")
  updatedAt DateTime  @updatedAt @map("updated_at")
  createdAt DateTime  @default(now()) @map("created_at")

  @@map("loyalty_policy")
}

// Existing Customer model — add one field
model Customer {
  // ... existing fields
  lastLoyaltyActivityAt DateTime? @map("last_loyalty_activity_at")
}
```

### API endpoints

#### Loyalty admin (`/loyalty`)
| Method | Path | Roles | Purpose |
|--------|------|-------|---------|
| GET  | `/loyalty/overview`       | OWNER+FM+ACCOUNTANT | KPIs: total issued/redeemed/expired/outstanding, top 10 |
| GET  | `/loyalty/customers`      | OWNER+FM+BM+SALES+ACCOUNTANT | Paginated customer list + balance + lastActivity |
| GET  | `/loyalty/referrals`      | OWNER+FM+BM+SALES+ACCOUNTANT | Tree/list referrers → referred |
| POST | `/loyalty/adjustments`    | OWNER+FM+BM+SALES+ACCOUNTANT | Submit adjust request |
| GET  | `/loyalty/adjustments`    | OWNER+FM+BM+SALES+ACCOUNTANT | List + filter (status, branch, date) |
| PATCH | `/loyalty/adjustments/:id` | OWNER+FM | Approve/reject (no self-approve) |

#### Policy settings (`/settings/loyalty-policy`)
| Method | Path | Roles | Purpose |
|--------|------|-------|---------|
| GET   | `/settings/loyalty-policy` | OWNER+FM+ACCOUNTANT | View policy |
| PATCH | `/settings/loyalty-policy` | OWNER | Update policy + audit log |

### Frontend routes

1. `/loyalty` — `LoyaltyPage.tsx` with 4 tabs (Tabs component from shadcn/ui)
   - Tab 1 **Overview** — metric cards + sparklines
   - Tab 2 **Customers** — DataTable + search + click → existing `/customers/:id`
   - Tab 3 **Referrals** — recursive tree view (2 levels) + stats table
   - Tab 4 **Adjustments** — PENDING queue top + history + "ขอปรับแต้ม" button → modal
2. `/settings/loyalty-policy` — `LoyaltyPolicySettingsPage.tsx` (react-hook-form + zod)

### Service layer refactor

- Replace const `POINTS_PER_BAHT`, `REFERRAL_POINTS`, `POINTS_EXPIRY_DAYS` → read from `LoyaltyPolicy`
- Add `LoyaltyPolicyService.getPolicy()` — cached 5 min (in-memory)
- Invalidate cache on PATCH
- Fallback: if DB read fails, use hardcoded defaults + Sentry warn

### New trigger points (wire earning logic)

| Existing Service | Method | New call |
|------------------|--------|----------|
| `PosService` (cash sale) | after sale completed | `loyalty.addPoints(customerId, pointsPerBahtCash × total)` |
| `ContractsService` | activate (GFIN type) | `loyalty.addPoints(customerId, pointsPerBahtGfin × financedAmount)` |
| `PaymentsService` | `create` (after FINANCE contract fully paid) | `loyalty.addPoints(customerId, completionBonus, reason="COMPLETION_BONUS")` |
| `PaymentsService` or `ContractsService` | per `referralTrigger` event | `loyalty.awardReferralPoints(customerId)` |

### Cron jobs

| Name | Schedule | Purpose |
|------|----------|---------|
| `loyalty-expire-inactive` | Daily 02:00 | Expire points for inactive customers |
| `loyalty-expiry-warning` (optional, future) | Daily 08:00 | LINE notify 30 days before expiry |

### Audit & observability

- All adjust status transitions → AuditInterceptor (existing)
- Policy changes → AuditInterceptor (existing)
- Sentry capture on: cron transaction failures, orphan points, self-approve attempts
- Logger structured events: `loyalty.earn`, `loyalty.redeem`, `loyalty.adjust`, `loyalty.expire`

---

## 10. Test Plan

### Backend (target +20 tests)
- Threshold logic (auto-approve vs pending)
- Self-approve guard (400 error)
- Expiry cron (boundary: exactly 12 months, inactive+zero balance, active-but-old)
- Activity tracking auto-update on earn/redeem/on-time
- Transaction atomicity (adjust + balance update)
- Policy cache invalidation on update
- `addPoints` uses policy rates not constants (regression)
- Referral trigger configurability (REGISTER vs FIRST_PAYMENT)
- Completion bonus awarded only once per contract

### Frontend (target +6 tests)
- AdjustmentModal form validation (delta, reason required)
- Approval flow UI (approve → success toast, reject → require reason)
- Referral tree renders 2 levels correctly
- Overview card numbers match API mock
- Policy settings form save + error handling
- Expiry warning badge when customer inactive > 9 months

### E2E (target +2 specs)
- Staff submits adjust → OWNER approves → balance updated
- OWNER edits policy → rates change → next earn uses new rate

---

## 11. Migration Strategy

1. Prisma migration: create `LoyaltyAdjustment`, `LoyaltyPolicy`, add `Customer.lastLoyaltyActivityAt`
2. Seed: insert `LoyaltyPolicy { id: "singleton" }` with current hardcoded defaults
3. Backfill `Customer.lastLoyaltyActivityAt`:
   - For customers with `loyaltyBalance > 0` → set to most recent `LoyaltyPoint.createdAt`
   - For others → leave NULL (first activity will set it)
4. Refactor service constants → policy reads (with fallback)
5. Wire new trigger points (cash, GFIN, completion, referral)
6. Deploy → monitor Sentry + logs for 24h
7. Announce to staff (new admin page + settings) + customer-facing LIFF unchanged

---

## 12. Risks & Open Questions

### Risks
- **Policy cache staleness** — 5 min TTL may confuse admins who just edited. Mitigation: clear UI indicator of cache age, or force invalidate button.
- **Expiry cron blast radius** — if cron has bug, could wrongly expire many customers. Mitigation: dry-run mode + Sentry alarm if > 1% of active customers would expire in single run.
- **Trigger retroactive fairness** — wiring cash/GFIN earning doesn't apply to past purchases. Option: backfill one-time or skip. **Decision: skip** (communication issue only, not legal).
- **Referral trigger switch** — changing `referralTrigger` mid-flight could double-credit or skip. Mitigation: `referralAwardedAt` idempotency already handles this.

### Deferred to follow-up
- Tier/level system (silver/gold/platinum)
- 30-day expiry warning LINE notification
- Cross-system partner redemption
- Admin-triggered bulk adjust (e.g. campaign 100 customers at once)
- Points-to-cash reverse conversion (refund use case)

---

## 13. Delivery Plan (subagent-driven, parallelizable)

### Agent 1 (backend schema + service)
- Prisma migration (2 tables + 1 field)
- `LoyaltyPolicyService` (CRUD + cache)
- `LoyaltyAdjustmentService` (submit + approve/reject + auto-approve logic)
- Refactor `LoyaltyService` to read policy (with fallback)
- Expiry cron
- 20+ tests

### Agent 2 (backend wiring)
- Wire cash sale → addPoints
- Wire GFIN activation → addPoints
- Wire FINANCE completion → completion bonus
- Wire `awardReferralPoints` at policy.referralTrigger
- Integration tests for each trigger

### Agent 3 (frontend loyalty admin)
- `/loyalty` page with 4 tabs
- `AdjustmentModal`, `ReferralTree`, `LoyaltyOverviewCards` components
- Menu entry + route + lazy load
- 4 tests

### Agent 4 (frontend settings)
- `/settings/loyalty-policy` page (form + zod)
- Menu entry under existing Settings group
- 2 tests

### Merge order
1. Agent 1 (schema + services) — blocks others
2. Agent 2 (wiring) in parallel with Agent 3+4 (frontend)
3. Integration testing + E2E
4. Deploy

**Expected cycle**: 2 days calendar, 1 day engineer effort

---

## 14. Acceptance Criteria

- [ ] OWNER can view overview page at `/loyalty` with correct metrics
- [ ] All roles can see customer list tab
- [ ] SALES can submit adjust → appears as PENDING
- [ ] OWNER can approve PENDING adjust → customer balance updates
- [ ] OWNER cannot approve their own submitted adjust (400)
- [ ] Auto-approve applies for delta 1-20 bonus only
- [ ] Cash sale + GFIN contract earn points immediately
- [ ] FINANCE on-time payments earn per-installment (regression: unchanged)
- [ ] FINANCE completion awards completionBonus once
- [ ] Referral trigger fires at configured event (default FIRST_PAYMENT)
- [ ] Inactive customer (>12mo) gets points expired by cron
- [ ] OWNER can edit policy → next earn uses new rates (within 5min cache)
- [ ] All adjust actions logged in AuditLog
- [ ] 0 TypeScript errors, all tests green (new 20 backend + 6 frontend + 2 E2E)
