# Collections Guided Session — Design Spec

**Date:** 2026-04-26
**Status:** Approved (pending implementation plan)
**Owner:** akenarin.ak@gmail.com
**Affects:** `/collections` page, SALES + OWNER + BRANCH_MANAGER + FINANCE_MANAGER roles

---

## Problem

หน้า `/collections` ปัจจุบันต้องการให้พนักงานเก็บเงินรู้เองว่า:
- วันนี้ต้องทำอะไร
- เริ่มจากใคร
- ทำเสร็จเมื่อไหร่

ผลคือ:
1. พนักงานใหม่วันแรก เปิดหน้ามาแล้วงง — มี tab 6 ตัว, KPI 8 ตัว, filter 2 ตัว
2. ไม่มี "shape" ของวัน — บางคนเริ่มจากค้างนาน บางคนเริ่มจากค้างใหม่ ไม่สม่ำเสมอ
3. ไม่รู้ว่ากำลังทันเป้าไหม — งานนี้ควรเสร็จใน 2-3 ชม. แต่หน้าไม่บอก
4. หลายพนักงาน → ต่างคนต่างทำ ไม่มีการแบ่งงานที่ชัด → เสี่ยงโทรซ้ำคนเดียวกัน

## Goals

- พนักงานใหม่วันแรก เปิดหน้ามารู้เลยว่าต้องทำอะไร โดยไม่ต้องเทรน
- 1 session เก็บเงิน เสร็จใน 2-3 ชม. — ระบบช่วย pacing
- 2-3 พนักงานทำงานพร้อมกัน ไม่ทับกัน ไม่ทิ้งงาน
- ผจก. มองเห็นและปรับ workload ได้
- ของเดิม (tabs, filters, ContractCards) ยังใช้ได้ในโหมด Library สำหรับ ad-hoc lookup

## Non-Goals

- ไม่เปลี่ยน underlying logic ของ ContractCard, Customer360Panel, ContactLogDialog, CallButton (Yeastar) — ใช้ของเดิม
- ไม่แตะ analytics tab logic — ยังคงเดิม
- ไม่ทำ AI suggestion ว่า "ควรพูดอะไรกับลูกค้า" — out of scope
- ไม่ทำ voice transcription / call recording features

---

## Architecture Overview

```
                  ┌────────────────────────────┐
                  │   /collections (toggle)    │
                  │                            │
                  │   ◯ Session  ◯ Library    │
                  └─────┬─────────────┬────────┘
                        │             │
              ┌─────────▼──┐      ┌───▼─────────┐
              │ Session    │      │ Library     │
              │ (new)      │      │ (existing)  │
              │            │      │             │
              │ 1.PreStart │      │ Tabs +      │
              │ 2.Focus    │      │ Filters +   │
              │ 3.Summary  │      │ Cards       │
              └────┬───────┘      └─────────────┘
                   │
                   │ reads from
                   ▼
              ┌──────────────┐
              │ Today's      │
              │ DailyAssgnmt │ ◀── auto-assign cron (06:00)
              └──────┬───────┘     manager dashboard (drag-drop)
                     │
                     │ assigned by
                     ▼
              ┌──────────────────┐
              │ /collections/    │  ← OWNER/MANAGER only
              │   manage         │
              │                  │
              │ - Workload board │
              │ - Drag-drop      │
              │ - Live progress  │
              │ - Pool mgmt      │
              └──────────────────┘
```

### Default View per Role

| Role | Lands on | Notes |
|---|---|---|
| SALES | Session view | their daily flow |
| OWNER, BRANCH_MANAGER, FINANCE_MANAGER | `/collections/manage` | workload + assignment |
| ACCOUNTANT | Library view | audit/lookup only |

All roles can switch via toggle. Toggle preference is remembered per-user in `UserPreference.collectionsDefaultView`.

---

## Component 1 — Session View (SALES daily flow)

The single most important interface. Everything else exists to feed this.

### 1A. Pre-session screen

```
สวัสดี แนน 👋

วันนี้คุณมีคิว 18 ราย · ประมาณ 1 ชม. 30 นาที

  [▶ เริ่มงานเก็บเงิน]   ← single primary CTA

  📞 ต้องโทร 14 ราย      💬 ส่ง LINE 4 ราย
  🔴 ค้างนาน 3 ราย       🟠 ค้างปานกลาง 8 ราย
  🟡 ค้างไม่นาน 7 ราย
```

- ETA = `ราย × 5min average` (configurable per company in Settings)
- Breakdown counts come from `DailyAssignment` joined with `Contract`
- If no assignment yet (cron hasn't run / no work today): show "วันนี้ไม่มีคิว — ดู pool กลาง"
- Single CTA — no decisions needed before starting

### 1B. Focus mode

```
ราย 1/18         ⏱ 02:14         🔴 90+ วัน
━━━░░░░░░░░░░░░░░░░ 5%

  [Contract focus card — large]
  - Customer name, contract number, outstanding
  - Phone (tap-to-call ready)
  - Last contact summary (เมื่อไหร่ พูดคุยอะไร)
  - Aging + broken-promise count + risk tags

  [📞 โทร]  [💬 LINE]  [⏭ ข้าม]    ← 3 primary actions
  [▼ ดูข้อมูลลูกค้า]                ← reveals Customer360 inline
```

- One contract at a time, takes most of viewport
- Action buttons large, thumb-reachable on mobile
- Action handlers:
  - **โทร** → opens softphone (existing CallButton flow). After hangup → open ContactLogDialog → after save → auto-advance.
  - **LINE** → opens SendLineAdHocDialog. After send → auto-advance.
  - **ข้าม** → reason picker (busy / wrong queue / personal conflict) → moves to end of session queue OR returns to pool depending on reason → advance.
- **Pause** button always visible top-right. Pausing → returns to Pre-session with "เริ่มต่อ" button (resumes at same position).
- **Timer** counts elapsed session time. Tracks against company-configured target (default 2hr 30min). Goes amber at 100%, red at 130%.
- Keyboard shortcuts (desktop): `1`=โทร, `2`=LINE, `3`=ข้าม, `Space`=advance after action, `Esc`=pause.

### 1C. Session summary (end screen)

```
🎉 ทำครบทั้ง 18 ราย!

ผลงานวันนี้:
  ✓ โทรติด 12 ราย
  ✗ โทรไม่ติด 4 ราย
  💬 ส่ง LINE 4 ราย
  💰 เก็บได้ 8,400 ฿
  ⏱ ใช้เวลา 1:47 (เร็วกว่าเป้า 13 นาที)

[ดู pool กลาง — มี 5 ราย]   [กลับหน้าหลัก]
```

- Counts derived from `DailyAssignment.status` rollup + linked Payment records
- Rendered after the last contract in the queue is actioned
- Persists for the rest of the day (re-opening `/collections` after completion shows summary, not pre-session)
- "ดู pool กลาง" navigates into a Library-style view filtered to `assignedTo IS NULL AND status IN (OVERDUE, PENDING)` — collector can self-claim.

---

## Component 2 — Auto-assign Cron + Manual Override Window

### Cron schedule
- Runs at **06:00 ICT daily** (cron syntax: `0 6 * * *`)
- Source: new module `apps/api/src/cron/collections-auto-assign.cron.ts`
- Sentry capture on failure (per existing cron pattern in v3)

### Algorithm (in order)

```
For each Contract where status IN (OVERDUE, PENDING) AND deletedAt IS NULL:

  1. Already has Contract.assignedTo + collector still active?
     → keep (relationship persistence)

  2. Has previous DailyAssignment in last 30 days to a still-active collector?
     → assign to that collector (recent-relationship)

  3. Has same-branch active collector?
     → assign to lowest-workload collector in that branch

  4. Otherwise:
     → round-robin among all active collectors

  5. Cap check: if collector exceeds DAILY_CAP (default 30):
     → push overflow to pool (DailyAssignment with collectorId = NULL)

  6. Pool top-up: if collector has < FLOOR (default 10) and pool has items:
     → pull from pool to top up

Insert one DailyAssignment row per (contract, today's date).
```

### Manual override window
- 06:00–09:00 ICT: Manager dashboard editable, no notifications fired
- 09:00 sharp: system "locks" assignments → SALES can start sessions
  - If manager hasn't pressed "Lock & ส่งคิว" by 09:00, system auto-locks
- After 09:00: Manager can still edit, but moving a contract triggers a notification to the affected collector ("คิวของคุณมีการปรับ")

### Special cases

- **Collector marked inactive (`User.collectionsActive = false`)**: cron skips them. Existing assignments under them get reassigned next morning.
- **Escalation cases** (`daysOverdue >= 90 AND brokenPromiseCount >= 2`): NOT auto-assigned. Goes to pool with `escalationFlag = true` for manager attention.
- **Self-claim**: SALES who finishes session can browse pool → click "หยิบ" → creates DailyAssignment with `source = SELF_CLAIMED`. Locked to them for 2hr; if not actioned in 2hr, lock expires.

---

## Component 3 — Manager Dashboard (`/collections/manage`)

### Access
- OWNER, BRANCH_MANAGER, FINANCE_MANAGER
- BRANCH_MANAGER sees only collectors in their branch(es); OWNER/FINANCE_MANAGER see all

### Pre-09:00 view (planning)

```
แบ่งคิวงาน — 26 เม.ย. 2569
Auto-assigned: 06:00 ✓ · Locked: 09:00 (อีก 47 นาที)

[Collector cards — drag-drop board]

┌─ แนน (ลาดพร้าว) ──┐  ┌─ กวาง (สีลม) ─────┐
│ 👤 18 ราย         │  │ 👤 22 ราย 🔴 OVER │
│ ⏱ ~1ชม.30น.      │  │ ⏱ ~1ชม.50น.      │
│ [drop zone]       │  │ [drop zone]       │
└───────────────────┘  └───────────────────┘

┌─ ตุ๊กตา (สีลม) ────┐  ┌─ Pool กลาง ──────┐
│ 👤 0 ราย 🟡 ลา    │  │ 👤 5 ราย          │
│ — ไม่ assign —    │  │ + 3 escalation    │
└───────────────────┘  └───────────────────┘

[🔄 Auto-balance ใหม่]   [✓ Lock & ส่งคิว]
```

### Post-09:00 view (live monitoring)

Same board, but each collector card now shows live progress:

```
┌─ แนน ─────────────────────────┐
│ ━━━━━━━━░░░░ 12/18 (66%)     │
│ ⏱ 1:24 / 1:30 target         │
│ 💰 5,400 ฿ collected          │
│ [โอนคิวบางส่วน] [ปิด session] │
└──────────────────────────────-─┘
```

### Features
- **Drag & drop** (using existing dnd-kit pattern from other admin pages)
- **Bulk select + assign** — checkboxes, then assign to one collector
- **Auto-balance ใหม่** — re-runs the cron algorithm on demand (idempotent within today's run)
- **Lock & ส่งคิว** — flips `DailyAssignment.lockedAt` for all today's rows; SALES sessions become startable
- **โอนคิวบางส่วน** (mid-day) — intervention tool. Picks a collector who's under target, moves N pending contracts from over-target collector to them. Notifies both.
- **ปิด session** (mid-day) — emergency tool. Cancels the rest of a collector's session (e.g., they went home sick), pushing their pending items back to pool.

### Workload status colors
- 🟢 OK = workload < 25 OR done within target time
- 🟡 ใกล้ cap = 25-29
- 🔴 OVER / behind = >30 OR elapsed time exceeds target while < 70% done

---

## Component 4 — Library Mode (existing UI, repackaged)

Library mode = current page (after the recent visual redesign).

### What's preserved
- Tabs (`คิววันนี้, ตามต่อ, นัดชำระ, อนุมัติ, ทั้งหมด, วิเคราะห์`)
- `CollectionsFilters` (search, branch dropdown)
- `ContractCard` with severity panel + chip row
- `Customer360Panel` slide-out
- `CollectionsHeader` (the merged KPI strip)

### When Library is used
- SALES toggles to it for ad-hoc lookup ("ลูกค้าโทรเข้ามา ขอเช็คเลข BC-...")
- ACCOUNTANT defaults here (audit purposes)
- OWNER/MANAGER toggle here for analytics tab

### Toggle persistence
- `UserPreference.collectionsDefaultView` (`SESSION` | `LIBRARY`) — remembered across logins
- Initial value set per role at user creation
- User can change in Settings → Preferences (or via toggle on the page itself)

### Mid-session "peek" behavior
- During Focus mode, clicking "Library" opens it in a new tab
- Original tab keeps Focus mode state (pause indicator visible)
- User comes back to Focus → resumes where they left off

---

## Data Model

### New table: `DailyAssignment`

```prisma
model DailyAssignment {
  id            String              @id @default(uuid())
  date          DateTime            @db.Date          // วันที่ของ session (00:00 ICT)
  collectorId   String?                                // null = pool
  contractId    String
  assignedAt    DateTime            @default(now())
  source        AssignmentSource
  status        AssignmentStatus    @default(PENDING)
  startedAt     DateTime?                              // when SALES started actioning this
  completedAt   DateTime?                              // when actioned (any outcome)
  outcome       AssignmentOutcome?                     // CALL_CONNECTED, CALL_NO_ANSWER, LINE_SENT, SKIPPED, etc.
  skipReason    String?
  lockedAt      DateTime?                              // 09:00 lock or self-claim lock
  lockExpiresAt DateTime?                              // 2hr after lock for self-claimed
  escalationFlag Boolean             @default(false)
  notes         String?
  createdAt     DateTime            @default(now())
  updatedAt     DateTime            @updatedAt
  deletedAt     DateTime?

  collector     User?               @relation("CollectorAssignments", fields: [collectorId], references: [id])
  contract      Contract            @relation(fields: [contractId], references: [id])

  @@unique([date, contractId])      // one assignment per contract per day
  @@index([collectorId, date])
  @@index([date, status])
  @@index([escalationFlag, date])
}

enum AssignmentSource {
  AUTO_RELATIONSHIP
  AUTO_RECENT
  AUTO_BRANCH
  AUTO_ROUNDROBIN
  MANAGER_OVERRIDE
  SELF_CLAIMED
}

enum AssignmentStatus {
  PENDING
  IN_PROGRESS
  DONE
  SKIPPED
  CANCELLED         // session closed mid-day
}

enum AssignmentOutcome {
  CALL_CONNECTED
  CALL_NO_ANSWER
  LINE_SENT
  SMS_SENT
  PAYMENT_RECEIVED
  PROMISE_MADE
  REFUSED
  SKIPPED
}
```

### Add to existing `User` model

```prisma
model User {
  // ... existing fields
  collectionsActive  Boolean  @default(true)   // false = on leave / not collecting today
  preferences        Json?                      // includes collectionsDefaultView
  // ... back-relation
  assignments        DailyAssignment[]  @relation("CollectorAssignments")
}
```

### `Contract.assignedTo` semantics — preserved
- `Contract.assignedTo` = long-term owner (who "owns" this customer relationship)
- `DailyAssignment.collectorId` = who's working it today
- Cron Algorithm Step 1 reads `Contract.assignedTo` first to keep relationship persistence

---

## API Endpoints

### Collector-facing (SALES role)

```
GET  /collections/my-session
     → returns ordered list of today's assignments for current user
     → response: { sessionId, contracts: [...ordered], target: { count, eta }, summary?: {...} }
     → ordering: escalation first, then aging desc, then by phone-availability

POST /collections/session/start
     → marks all today's assignments as IN_PROGRESS=false (still PENDING) but records sessionStartedAt
     → response: { sessionStartedAt }

POST /collections/session/contract/:contractId/action
     body: { outcome: AssignmentOutcome, notes?, paymentId?, lineMessageId? }
     → updates assignment status + outcome, sets completedAt
     → returns: { nextContractId | null }   // null = session done

POST /collections/session/contract/:contractId/skip
     body: { reason: 'BUSY' | 'WRONG_QUEUE' | 'PERSONAL_CONFLICT' }
     → status=SKIPPED. If reason=WRONG_QUEUE → return to pool (clear collectorId)

POST /collections/session/pause
     → records pausedAt; session resumable

POST /collections/session/resume
     → clears pausedAt; logs total paused duration

GET  /collections/pool
     → returns unassigned + escalation contracts available to claim

POST /collections/pool/:contractId/claim
     → creates DailyAssignment with collectorId=current user, source=SELF_CLAIMED, lockExpiresAt=now+2hr
```

### Manager-facing (OWNER, BRANCH_MANAGER, FINANCE_MANAGER)

```
GET  /collections/manage/board
     → returns all today's assignments grouped by collector + pool counts
     → access scoped: BRANCH_MANAGER sees only their branches

POST /collections/manage/assign
     body: { contractId, toCollectorId | null }   // null moves to pool
     → updates DailyAssignment.collectorId
     → if after 09:00 lock → also enqueues notification

POST /collections/manage/auto-balance
     → re-runs cron algorithm for today only (idempotent)

POST /collections/manage/lock
     → sets lockedAt=now() on all today's pending assignments

POST /collections/manage/transfer
     body: { fromCollectorId, toCollectorId, count }
     → moves N pending contracts (oldest first) from one collector to another

POST /collections/manage/close-session
     body: { collectorId }
     → cancels collector's remaining PENDING assignments → pushes back to pool
```

---

## Cron + Background Jobs

### `collections-auto-assign.cron.ts`
- Schedule: `0 6 * * *` (06:00 ICT)
- Idempotent: safe to re-run
- Sentry capture on error
- Logs assignment count + per-collector breakdown to `AuditLog`

### `collections-auto-lock.cron.ts`
- Schedule: `0 9 * * *` (09:00 ICT)
- Locks any unlocked assignments from today
- Sends Slack/LINE notification to managers if they hadn't manually locked

### `collections-pool-expiry.cron.ts`
- Schedule: every 15 min during business hours (`*/15 9-20 * * *`)
- Releases self-claimed contracts whose `lockExpiresAt` has passed
- Resets to PENDING with collectorId=null (back to pool)

### `collections-session-summary.cron.ts`
- Schedule: `0 18 * * *` (18:00 ICT)
- Computes daily summary per collector → optional LINE/email to managers

---

## Frontend Components

```
apps/web/src/pages/CollectionsPage/
├── index.tsx                          (toggle Session/Library + role-aware default)
├── components/
│   ├── (existing)                     ← unchanged
│   ├── CollectionsHeader.tsx          ← Library mode only
│   ├── CollectionsTabs.tsx            ← Library mode only
│   ├── CollectionsFilters.tsx         ← Library mode only
│   ├── ContractCard.tsx               ← reused in Focus mode + Library
│   └── Customer360Panel.tsx           ← reused
├── session/                           NEW
│   ├── SessionView.tsx                (state machine: PreStart → Focus → Summary)
│   ├── PreStartScreen.tsx
│   ├── FocusMode.tsx
│   ├── FocusContractCard.tsx          (large variant of ContractCard)
│   ├── SessionSummary.tsx
│   ├── SessionTimer.tsx
│   ├── SessionProgress.tsx
│   ├── SkipReasonDialog.tsx
│   └── PoolBrowser.tsx                (post-session "ดู pool กลาง")
├── manage/                            NEW
│   ├── ManageDashboard.tsx            (route: /collections/manage)
│   ├── CollectorCard.tsx              (drag target)
│   ├── PoolCard.tsx
│   ├── DraggableContractTile.tsx
│   ├── AutoBalanceButton.tsx
│   ├── LockButton.tsx
│   ├── TransferDialog.tsx
│   └── CloseSessionDialog.tsx
├── hooks/
│   ├── (existing)
│   ├── useMySession.ts                NEW
│   ├── useSessionActions.ts           NEW
│   ├── useManagerBoard.ts             NEW
│   └── useViewToggle.ts               NEW (persisted preference)
└── tabs/
    └── (existing — unchanged)
```

---

## Migration Plan

### Phase 1 — Build alongside (Sprint 1)
1. Prisma migration: `DailyAssignment`, `User.collectionsActive`, `User.preferences`
2. Cron: auto-assign + auto-lock + pool-expiry
3. API endpoints (collector + manager)
4. Frontend Session view (PreStart → Focus → Summary)
5. Frontend Manager dashboard
6. Tests:
   - Cron: relationship persistence, round-robin, branch preference, cap, pool overflow
   - API: assignment CRUD, lock window, self-claim, pool expiry
   - Frontend: state machine transitions, timer, keyboard shortcuts

### Phase 2 — Soft launch (Sprint 2)
1. Add toggle Session/Library on `/collections`
2. Default to Session for SALES, Manager Dashboard for OWNER/BRANCH_MANAGER/FINANCE_MANAGER, Library for ACCOUNTANT
3. Test with 3 real collectors (แนน, กวาง, ตุ๊กตา) for 1 week
4. Collect feedback → tune algorithm constants (DAILY_CAP, FLOOR, ETA-per-contract)

### Phase 3 — Polish (Sprint 3)
1. Mobile-responsive Focus mode (Focus mode is naturally mobile-friendly)
2. Keyboard shortcuts (1=โทร, 2=LINE, 3=ข้าม, Space=advance, Esc=pause)
3. Pause/resume across page reloads (persist via API)
4. Daily summary notifications (cron 18:00)
5. Manager LINE notification on mid-day reassignment

### Rollback
- Toggle stays even after launch — any user can switch back to Library
- Feature flag: `COLLECTIONS_SESSION_ENABLED` (env var) — emergency disable

---

## Configuration (Settings page additions)

```
SystemSettings:
  collections.dailyCap          (default: 30)
  collections.workloadFloor     (default: 10)
  collections.etaPerContractMin (default: 5)
  collections.sessionTargetMin  (default: 150)   // 2hr 30min
  collections.lockHour          (default: 9)
  collections.autoAssignHour    (default: 6)
  collections.poolExpiryHours   (default: 2)
```

All editable by OWNER from `/settings`.

---

## Testing Strategy

### Backend
- Unit: cron algorithm scenarios (relationship hit, branch fallback, round-robin, cap overflow, pool top-up)
- Integration: full session lifecycle (start → action × N → summary)
- Edge: midnight cron during running session, collector marked inactive mid-day, contract status changed mid-session
- Concurrency: two managers editing assignments simultaneously (optimistic lock)

### Frontend
- Unit: state machine transitions, timer accuracy, keyboard shortcut dispatch
- Integration: full happy-path session, pause/resume, library mode toggle persistence
- Visual: focus mode on mobile (375px), tablet, desktop

### E2E (Playwright)
- New spec: `collections-session.spec.ts`
  - SALES logs in → starts session → calls 1, LINE 1, skips 1 → completes summary
  - OWNER edits assignment pre-09:00 → SALES starts session → sees updated queue
  - Mid-day transfer: OWNER moves 3 from over-burdened to under-burdened
  - Self-claim from pool

---

## Open Decisions Resolved (during brainstorming)

- **Time-of-day grouping**: rejected. Flow is priority-based, not morning/afternoon/evening.
- **Assignment model**: A. Pre-assigned with relationship persistence.
- **Assignment trigger**: A3. Hybrid auto-assign cron + manual override window 06:00–09:00.
- **Library fallback**: kept for ad-hoc lookup, audit, analytics.
- **Default view per role**: SALES → Session, OWNER/MANAGER → Manage, ACCOUNTANT → Library.

## Out of Scope (future considerations)

- AI-suggested talking points per customer
- Voice transcription / call recording
- Customer-facing "your collector" page
- Multi-day session continuity (e.g., "you didn't finish yesterday's queue")
- Cross-company assignment (when multi-tenant)
