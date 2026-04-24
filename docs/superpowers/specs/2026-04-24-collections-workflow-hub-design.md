# Collections Workflow Hub — Full Redesign of `/overdue`

**Date:** 2026-04-24
**Status:** Draft — pending user review
**Path:** `/overdue` → `/collections` (redirect preserved)
**Scope:** Full overhaul (frontend redesign + backend additions + schema changes + MDM placeholder)

---

## 1. Problem Statement

The existing `/overdue` page is organized **by dunning stage** (REMINDER, NOTICE, FINAL_WARNING, LEGAL_ACTION — bucketed 1-7 / 8-30 / 31-60 / 60+ days). Collectors, however, work **by date and last call result**:

1. "ครบกำหนดวันนี้มีใครบ้าง" (due today)
2. "โทรเมื่อวานไม่รับ มีใครบ้าง" (no answer yesterday)
3. "นัดชำระวันนี้ ใครจ่ายแล้ว/ยังไม่จ่าย"
4. "3 วันติดต่อไม่ได้แล้ว ต้องล็อคเครื่อง"

The mental models do not match. Result: collectors cannot answer their own daily questions from the page, manually juggle phone/LINE in separate apps, and the approval gates that protect PDPA/legal risk are not surfaced in UI.

### Audit findings being addressed

| Finding | Type | Source |
|---|---|---|
| C1 — `assignedToId` DTO vs frontend `userId` mismatch | bug | `OverduePage.tsx:197` |
| C2 — audit log silently skipped when no OWNER user | bug | `overdue.service.ts:329,391,510,535` |
| C3 — race between cron and payment webhook | bug | `overdue.service.ts:286–345` |
| H1 — two "คำนวณค่าปรับ" buttons | ux | `OverduePage.tsx:405–425` |
| H3 — table (payments) vs kanban (contracts) data mismatch | ux | — |
| H4 — kanban looks drag-drop but isn't | ux | — |
| H5 — hardcoded late-fee text conflicts with SystemConfig | ux | `OverduePage.tsx:508` |
| H6 — phone number is plain text, not `tel:` | ux | — |
| H7 — no inline LINE send despite DunningEngine ready | gap | — |
| H8 — no pagination UI | ux | — |
| H9 — no Pending Escalation view | gap | — |
| H10 — no DunningAction history visible | gap | — |
| M1 — 991-line single file | debt | `OverduePage.tsx` |
| M2 — `parseFloat` on money strings | debt | — |
| M6 — summary cards computed from page-1 rows only | bug | `OverduePage.tsx:257` |

---

## 2. Design Principles

1. **Workflow-centric** — tabs map to collector's daily questions, not stage buckets
2. **Event-driven LINE** — `logContact` result triggers LINE auto-send; scheduled `DunningRule` rules stay for pre-due/time-based reminders
3. **1-screen task** — primary actions (call, log, send LINE, schedule, lock) never leave the page
4. **Backward compat** — `/overdue` redirects to `/collections`; existing table+kanban preserved in "ทั้งหมด" tab for admin/audit
5. **Mobile-ready** — responsive cards, not wide tables, on primary tabs
6. **Progressive disclosure** — Customer 360 slide-over replaces full-page nav for quick context

---

## 3. Page Layout

```
┌──────────────────────────────────────────────────────────┐
│ ติดตามหนี้                                                │
├──────────────────────────────────────────────────────────┤
│ KPI STRIP (4 cards)                                      │
│  ค้างรวม | คิววันนี้ | นัดแล้ว | Promise-kept 7d         │
├──────────────────────────────────────────────────────────┤
│ [📞 คิววันนี้] [⏳ ตามต่อ] [📅 นัดชำระ] [⚖️ อนุมัติ]       │
│ [⚙️ ทั้งหมด]                                              │
├──────────────────────────────────────────────────────────┤
│ Filters: วันครบกำหนด | สาขา | ผู้ติดตาม | ยอด             │
│ [☐ เลือกทั้งหมด] → bulk bar appears when selected        │
├──────────────────────────────────────────────────────────┤
│ ContractCard list (virtualized with react-window)        │
└──────────────────────────────────────────────────────────┘
                                        Customer 360 slide-over ▶
```

### Tab semantics

| Tab | Who sees | Query (high-level) | Sort |
|---|---|---|---|
| 📞 **คิววันนี้** | all roles | `status IN (ACTIVE,OVERDUE)` + due ≤ today + no callLog.calledAt ≥ today + `blockAutoEscalation IS NULL` | priority DESC |
| ⏳ **ตามต่อ** | all roles | latest callLog.result=NO_ANSWER + noAnswerCount < 3 | noAnswerCount DESC, oldest due ASC |
| 📅 **นัดชำระ** | all roles | callLog with `settlementDate BETWEEN today-3 AND today+30` + `result=PROMISED` | settlementDate ASC |
| ⚖️ **อนุมัติ** | OWNER / FM | `pendingDunningStage IS NOT NULL` OR `mdmLockRequest.status=PENDING` | pendingSince ASC |
| ⚙️ **ทั้งหมด** | all roles | existing table/kanban toggle | existing |

**Priority score** (initial formula, tunable via SystemConfig):
```
priority = outstanding × daysOverdue × (noAnswerCount + 1) × (brokenPromiseCount × 2 + 1)
```

### ContractCard layout

```
┌────────────────────────────────────────────────────────┐
│ ☐  นายเอก ใจดี • 081-234-5678 • สาขาลาดพร้าว            │
│ ครบกำหนด 22 เม.ย. (เลย 2 วัน) • งวด 3/12               │
│ ค้าง 8,500 + ปรับ 200 = 8,700 ฿                       │
│ 📊 โทร: NO_ANSWER ×2 • LINE ส่งไป 1 ครั้ง               │
│ ผู้ติดตาม: แนน                                          │
│ [📞 โทร] [📝 บันทึกผล] [💬 ส่งไลน์] [▶ เปิด 360]        │
└────────────────────────────────────────────────────────┘
```

---

## 4. Event-Driven LINE Send

**Change:** `DunningRule` gains a new column `eventTrigger` (nullable enum). `triggerDay` becomes nullable. A rule either has a scheduled `triggerDay` OR an `eventTrigger`, never both.

### Trigger matrix

| Call log result | Event key | LINE template sent? | Side effect |
|---|---|---|---|
| `NO_ANSWER` | `CALL_NO_ANSWER` | ✅ `dunning_on_no_answer` | increment `noAnswerCount`; if ≥ 3 within 72h → propose MDM lock+wallpaper (trigger=`UNCONTACTABLE_3D`) |
| `ANSWERED` + `settlementDate` set | `CALL_ANSWERED_PROMISE` | ✅ `dunning_confirm_promise` (with payment link) | store `settlementDate` on callLog; reset `noAnswerCount=0` |
| `ANSWERED` + paid now | — | — | open inline payment dialog |
| `REFUSED` | `CALL_REFUSED` | ✅ `dunning_firm_warning` | propose escalate to FINAL_WARNING (OWNER approval) |
| `WRONG_NUMBER` | — | ❌ | set `contract.needsSkipTracing = true` |
| `OTHER` | — | ❌ | notes only |

**Additional auto-propose (independent of call log):** daily cron `mdm-auto-propose.cron.ts` scans all overdue contracts and creates MdmLockRequest with trigger=`NO_PROMISE_3D` when: `status=OVERDUE` for ≥ `mdm_no_promise_threshold_days` days AND no future `callLog.settlementDate` AND no payment in the overdue window. Runs 09:00 daily after `update-statuses` cron. See §5.1.

**Dedup:** same event + contract within 4h → skip (prevents spam if collector re-logs). Reuses existing `DunningAction.hasExistingAction` logic but keyed on `(ruleId, contractId, paymentId ?? calllogId)` window.

**Implementation:** `logContact` service method dispatches to new `DunningEngineService.executeEventTrigger(eventKey, contract, payment)` after transaction commits. Failure to send LINE is non-fatal (logged to Sentry, does not roll back the call log).

---

## 5. MDM Device Lock + Wallpaper Flow

### 5.1 Auto-propose triggers

System auto-creates `MdmLockRequest` (status=PENDING) when **any** of these conditions match — checked by new cron `mdm-auto-propose.cron.ts` running daily:

| Trigger | Condition | Description |
|---|---|---|
| `UNCONTACTABLE_3D` | `noAnswerCount ≥ 3` in last 72h, no `ANSWERED` in between | ติดต่อไม่ได้ 3 วัน |
| `NO_PROMISE_3D` | `status=OVERDUE` for ≥ 3 days AND no active `callLog.settlementDate` in future AND no payment in ≥ 3 days | ไม่มีนัดชำระและไม่จ่าย |

Both conditions fire the same action (propose lock + wallpaper) — differ only in `reason` field for audit clarity. Idempotent: skips if a PENDING request already exists for the contract.

Collector can also manually propose via UI button anytime.

### 5.2 Action bundle

An approved MdmLockRequest executes **two things together**, not separately:

1. **Full device lock** — phone unusable until payment (existing PJ-Soft capability)
2. **Wallpaper change** — set phone wallpaper to a payment reminder image hosted at `SystemConfig.mdm_lock_wallpaper_url` (default seed image shows contract#, outstanding amount, payment link QR)

Both actions are one atomic approval. Customer sees wallpaper on lock screen; paying the outstanding amount unlocks both in one step (existing unlock flow covers wallpaper reset).

### 5.3 Flow diagram

```
[cron 09:00 daily]          [system]              [OWNER/FM]         [PJ-Soft]
    │                           │                      │                  │
    │ scan UNCONTACTABLE_3D     │                      │                  │
    │ scan NO_PROMISE_3D        │                      │                  │
    │──────────────────────────▶│                      │                  │
    │                           │ create MdmLockRequest│                  │
    │                           │ trigger=NO_PROMISE_3D│                  │
    │                           │ includeWallpaper=true│                  │
    │                           │ status=PENDING      │                  │
    │                           │ notify OWNER (LINE) │                  │
    │                           │─────────────────────▶│                  │
    │                           │                      │ review+approve   │
    │                           │◀─────────────────────│                  │
    │                           │ contract.deviceLocked=true              │
    │                           │ contract.wallpaperChanged=true          │
    │                           │ audit log (both actions)                │
    │                           │ send LINE ("เครื่องถูกล็อค ชำระเพื่อปลด") │
    │                           │ status=EXECUTED_MANUAL                  │
    │                           │ (PJ-Soft API deferred;                  │
    │                           │  OWNER performs in PJ-Soft app)         │
    │                           │                                         │
    ─ payment received (later) ─                                         │
    │                           │ if contract fully paid:                 │
    │                           │   auto request unlock                   │
    │                           │   + restore wallpaper (manual)          │
```

### 5.4 Phase 4 deferral compatibility

Per memory `project_phase4_deferred`, PJ-Soft API integration is deferred. This design **does not block on** PJ-Soft API:

- Approve flips `deviceLocked=true` + `wallpaperChanged=true` + sends LINE
- Creates `EXECUTED_MANUAL` audit entry
- OWNER performs actual lock + wallpaper change in PJ-Soft app
- Wallpaper URL is stored; when the API integration lands, the service method `executeMdmAction` is wrapped with the real API call + retained audit/LINE logic

### 5.5 Roles

- Propose (auto or manual): cron / OWNER / BRANCH_MANAGER / FINANCE_MANAGER / SALES
- Approve: OWNER / FINANCE_MANAGER (segregation of duties — sales cannot self-approve)
- Unlock: OWNER / FINANCE_MANAGER; auto-unlock on full payment via payment webhook

---

## 6. Legal Letter System (MVP)

Thai hire-purchase law (พ.ร.บ.เช่าซื้อ) requires formal registered-mail notice before contract termination + legal action. Without provable written notice, courts can dismiss claims or reduce repossession rights. This system closes the `LEGAL_ACTION` workflow — without it day 45–60 is a dead zone.

### 6.1 Letter types + triggers

| Letter type | Day trigger | Content | Generated by |
|---|---|---|---|
| `RETURN_DEVICE_45D` | overdue ≥ 45 days | หนังสือเรียกให้ส่งมอบเครื่องคืน ภายใน 15 วัน | cron daily |
| `CONTRACT_TERMINATION_60D` | overdue ≥ 60 days | หนังสือบอกเลิกสัญญาและแจ้งดำเนินคดี | cron daily |

Idempotent: one letter of each type per contract (upsert by `(contractId, letterType)`).

### 6.2 Flow

```
[cron daily 09:00]          [system]                 [OWNER]               [ไปรษณีย์]
    │                           │                        │                     │
    │ scan overdue ≥45/60d      │                        │                     │
    │──────────────────────────▶│                        │                     │
    │                           │ create ContractLetter  │                     │
    │                           │ status=PENDING_DISPATCH│                     │
    │                           │ notify OWNER (LINE)    │                     │
    │                           │────────────────────────▶│                     │
    │                           │                        │ open ⚖️อนุมัติ tab   │
    │                           │                        │ click "สร้าง PDF"    │
    │                           │◀───────────────────────│                     │
    │                           │ generate PDF + upload S3                     │
    │                           │ status=PDF_GENERATED                         │
    │                           │────────────────────────▶│ download PDF       │
    │                           │                        │ print + ไปไปรษณีย์   │
    │                           │                        │ ส่ง EMS ลงทะเบียน    │
    │                           │                        │◀────────────────────│
    │                           │                        │ กลับมากรอก tracking# │
    │                           │                        │ + upload slip photo  │
    │                           │◀───────────────────────│                     │
    │                           │ status=DISPATCHED                           │
    │                           │ send LINE "หนังสือถึงคุณแล้ว                │
    │                           │           ติดต่อด่วน"                        │
    │                           │ audit log (legal evidence)                  │
```

### 6.3 PDF template

Generated via existing jspdf infrastructure (already used for contracts/receipts). Templates stored as React components rendered to PDF server-side (reuse pattern from `ContractDocument` generator).

**Required fields per Thai legal standard:**
- หัวจดหมาย: ชื่อ+ที่อยู่+เลขประจำตัวผู้เสียภาษีของบริษัท (FINANCE)
- วันที่, เลขที่หนังสือ (auto-generated, e.g. `ST-2026-00123`)
- ชื่อ+ที่อยู่ลูกหนี้ (จาก Customer record)
- อ้างอิงสัญญาเลขที่, วันที่ทำสัญญา
- ยอดค้างชำระ (principal + interest + late fee + VAT)
- เนื้อความตามแบบฟอร์มมาตรฐาน (return device 15 วัน / termination + legal action)
- ลายมือชื่อผู้มีอำนาจ (เจ้าของกิจการ) — signature image from SystemConfig
- ตรา/ลายน้ำ (optional, from SystemConfig)

Templates are file-based (versioned with code) not DB-backed — owner can ask to change wording via PR. Change = legal review, not a runtime setting.

### 6.4 Evidence chain

Stored on `ContractLetter` for courtroom defense:
- `pdfUrl` — snapshot of exact PDF sent (immutable once dispatched)
- `trackingNumber` — EMS lgst. no. จากไปรษณีย์
- `evidencePhotoUrl` — S3 upload: slip จากไปรษณีย์ / ใบตอบรับ
- `dispatchedAt`, `dispatchedById` — who + when
- Audit log entries for every status change

If court requests proof, all evidence is one query away.

### 6.5 Integration with existing dunning

- When `RETURN_DEVICE_45D` is `DISPATCHED` → set `contract.dunningStage=FINAL_WARNING` (if not already) + trigger event `DEVICE_LOCKED` LINE (if not yet locked, include urgent CTA)
- When `CONTRACT_TERMINATION_60D` is `DISPATCHED` → trigger event `CONTRACT_TERMINATED` (new enum value) → set `contract.status=LEGAL` (new Contract status) → propose MDM lock if not already

### 6.6 Out of scope (letter system)

- ❌ Thailand Post Connect API — defer to Phase B; owner prints + mails manually for now
- ❌ OCR of return slip — owner uploads photo + keys tracking# manually
- ❌ Courier alternatives (Kerry, Flash) — EMS only (legal-grade delivery)
- ❌ Multi-language letters — Thai only

---

## 7. Bulk Actions

Multi-select via row checkbox → sticky bulk bar appears below filter row:
- **มอบหมายผู้ติดตาม** — batch set `assignedToId`
- **ส่ง LINE** — pick template from DunningRule with eventTrigger=null AND triggerDay=null (ad-hoc templates) → dispatch to all selected contracts
- **ล็อคเครื่อง** — bulk propose MDM lock; OWNER approves in `⚖️ อนุมัติ` tab (one approval per contract)
- **ส่งออก Excel** — only selected rows

Limit: 100 contracts per bulk action (prevent accidents; toast if exceeded).

**New endpoints:**
- `POST /overdue/bulk/assign` `{ contractIds: string[], assignedToId: string }`
- `POST /overdue/bulk/send-line` `{ contractIds: string[], templateId: string }`
- `POST /overdue/bulk/propose-lock` `{ contractIds: string[], reason: string }`

All audit-logged individually per contract.

---

## 8. KPI Strip

New endpoint `GET /overdue/kpi?range=7d|30d` returns:
```json
{
  "totalOutstanding": 1250000.00,
  "totalLateFees": 45000.00,
  "queueToday": 34,
  "queueTodayTrend": -0.08,  // -8% vs yesterday
  "promisedCount": 12,
  "promiseKeptRate7d": 0.72,
  "avgCollectorWorkload": 28  // OWNER only
}
```

Cached 60s server-side (aggregation is expensive). Frontend `useCollectionsKpi` hook refetches on window focus.

---

## 9. Customer 360 Slide-Over

Triggered by `▶` on any ContractCard. Right-side panel 480px wide (full-screen on mobile).

**Sections:**
1. **Customer header** — name, phone (tap-to-call), LINE status, address
2. **Contract summary** — installment schedule with paid/pending badges
3. **Unified timeline** — merged (callLogs + dunningActions + payments + statusChanges) sorted by time DESC, virtualized
4. **Quick actions** — บันทึกจ่าย / ส่ง LINE ad-hoc / เสนอล็อคเครื่อง / ปลดล็อค / ดูสัญญาเต็ม (navigate)

New endpoint: `GET /overdue/contracts/:id/full-timeline` returns merged events.

---

## 10. Inline Payment Recording

From Customer 360 → "บันทึกการชำระเงิน" opens modal:
- Amount (default = current outstanding)
- Method: cash / transfer / QR (PaySolutions link generation)
- Slip upload (if transfer/QR)
- Notes

Reuses existing `POST /payments` — no new backend. On success: invalidate `overdue-queue`, `collections-kpi`, `contract-timeline`.

---

## 11. File/Component Breakdown

```
apps/web/src/pages/CollectionsPage/
  index.tsx                        # shell: tabs + slide-over state (~100 lines)
  hooks/
    useCollectionsQueue.ts         # queries per tab + filters
    useCollectionsKpi.ts
    useContactLog.ts               # mutation + post-commit event dispatch
    useBulkActions.ts
  components/
    CollectionsKpiStrip.tsx
    CollectionsTabs.tsx
    CollectionsFilters.tsx
    BulkActionBar.tsx
    ContractCard.tsx               # the atomic row
    ContactLogDialog.tsx
    Customer360Panel.tsx           # slide-over
    MdmLockDialog.tsx
    PaymentRecordDialog.tsx
    TimelineFeed.tsx
    LetterQueueSection.tsx         # inside ApprovalTab
    LetterDispatchDialog.tsx       # generate PDF → download → mark dispatched
  tabs/
    QueueTab.tsx
    FollowUpTab.tsx
    PromiseTab.tsx
    ApprovalTab.tsx
    AllTab.tsx                     # existing table+kanban moved here
```

`/overdue` route stays as redirect → `/collections` (preserves bookmarks, email links, notification deep-links).

---

## 12. Backend Changes

### New endpoints (all under `/overdue` prefix for backward compat)

| Method | Path | Roles | Purpose |
|---|---|---|---|
| `GET` | `/overdue/queue?tab=today\|followup\|promise&page=&limit=` | all | tabbed list |
| `GET` | `/overdue/kpi?range=7d\|30d` | all | KPI strip |
| `GET` | `/overdue/contracts/:id/full-timeline` | all | unified event feed |
| `POST` | `/overdue/bulk/assign` | OWNER / BM / FM | bulk assign |
| `POST` | `/overdue/bulk/send-line` | OWNER / BM / FM / SALES | bulk LINE |
| `POST` | `/overdue/bulk/propose-lock` | OWNER / BM / FM / SALES | bulk MDM propose |
| `POST` | `/overdue/:id/propose-mdm-lock` | OWNER / BM / FM / SALES | single MDM propose |
| `POST` | `/overdue/:id/approve-mdm-lock` | OWNER / FM | approve + execute (manual placeholder) |
| `POST` | `/overdue/:id/reject-mdm-lock` | OWNER / FM | reject with reason |
| `POST` | `/overdue/:id/unlock-device` | OWNER / FM | unlock flow |
| `GET` | `/overdue/letters?status=&letterType=` | OWNER / FM / BM | letter queue |
| `POST` | `/overdue/letters/:id/generate-pdf` | OWNER / FM | create+upload PDF |
| `POST` | `/overdue/letters/:id/mark-dispatched` | OWNER / FM | record tracking# + evidence |
| `POST` | `/overdue/letters/:id/mark-delivered` | OWNER / FM | update status on EMS confirmation |
| `POST` | `/overdue/letters/:id/cancel` | OWNER | cancel with reason |
| `GET` | `/overdue/letters/:id/pdf` | OWNER / FM / BM | download generated PDF |

### Event-trigger engine additions

- `DunningEngineService.executeEventTrigger(eventKey, contract, payment?, callLog)` — new
- Calls `NotificationsService.send` with rendered template
- Creates `DunningAction` with `eventKey` instead of `dunningRuleId` cascade-matched by eventKey

### New cron jobs

- `crons/mdm-auto-propose.cron.ts` — daily 09:00; scans contracts matching `UNCONTACTABLE_3D` or `NO_PROMISE_3D`; creates `MdmLockRequest` idempotently (one PENDING per contract max); triggers `dunning_device_locked` template only on approval, NOT on propose (to avoid spamming customers with false alarms)
- `crons/letter-auto-generate.cron.ts` — daily 09:00; scans contracts for `RETURN_DEVICE_45D` and `CONTRACT_TERMINATION_60D` thresholds; creates `ContractLetter` idempotently (one per type per contract); notifies OWNER via LINE that letters are ready for dispatch

### New services

- `MdmLockService` — `proposeAutoUnlock`, `proposeManual`, `approve`, `reject`, `unlock`, `getPendingByRole`. Wraps the placeholder execute path; designed so swapping in PJ-Soft API is a 1-method change
- `ContractLetterService` — `create`, `generatePdf`, `markDispatched`, `markDelivered`, `cancel`, `downloadPdf`. PDF generation delegated to `LetterPdfRenderer` (jspdf-based, templates in `apps/api/src/modules/overdue/letter-templates/`). On dispatch, triggers LINE event (`LETTER_DISPATCHED`) via `DunningEngine.executeEventTrigger`

### Bug fixes

- **C1**: `assign-collector.dto.ts` keep field `assignedToId`; fix frontend to send the right field. Also add a DTO transform that accepts both `userId` and `assignedToId` for one release to avoid breaking any other caller (deprecated).
- **C2**: service throws if no SYSTEM user exists; seed SYSTEM user in `prisma/seed.ts`; migration inserts a dedicated OWNER-role user with `email: 'system@bestchoice.internal'` for audit trail (flag `isSystemUser` new on `User`).
- **C3**: `updateContractStatuses` → merge the `payments.some` + `callLog promised` exclusion into a single `updateMany` with nested where; no separate read-then-write step. Drop intermediate variable.

### Schema changes

```prisma
// DunningRule gains event-trigger support
model DunningRule {
  id                 String                 @id @default(uuid())
  name               String
  triggerDay         Int?                   // was required, now optional
  eventTrigger       DunningEventTrigger?   // NEW
  channel            NotificationChannel
  messageTemplate    String
  includePaymentLink Boolean                @default(false)
  autoExecute        Boolean                @default(true)
  escalateTo         DunningStage?
  isActive           Boolean                @default(true)
  sortOrder          Int                    @default(0)
  createdAt          DateTime               @default(now())
  updatedAt          DateTime               @updatedAt
  deletedAt          DateTime?
  dunningActions     DunningAction[]

  // Exactly one of triggerDay OR eventTrigger must be set (CHECK constraint via migration SQL)
  @@index([triggerDay])
  @@index([eventTrigger])
}

enum DunningEventTrigger {
  CALL_NO_ANSWER
  CALL_ANSWERED_PROMISE
  CALL_REFUSED
  DEVICE_LOCKED
  DEVICE_UNLOCKED
  BROKEN_PROMISE
  LETTER_DISPATCHED
  CONTRACT_TERMINATED
}

// Contract: counters & device state
model Contract {
  // ... existing
  noAnswerCount      Int       @default(0)          // resets on any non-NO_ANSWER call log
  needsSkipTracing   Boolean   @default(false)
  deviceLocked       Boolean   @default(false)
  deviceLockedAt     DateTime?
  wallpaperChanged   Boolean   @default(false)
  wallpaperChangedAt DateTime?
  mdmLockRequests    MdmLockRequest[]
}

model MdmLockRequest {
  id                String           @id @default(uuid())
  contractId        String           @map("contract_id")
  contract          Contract         @relation(fields: [contractId], references: [id])
  status            MdmLockStatus    @default(PENDING)
  trigger           MdmLockTrigger                   // NEW: why was this proposed
  includeWallpaper  Boolean          @default(true)  // NEW: bundle wallpaper with lock
  proposedById      String           @map("proposed_by_id")
  proposedBy        User             @relation("MdmProposed", fields: [proposedById], references: [id])
  proposedAt        DateTime         @default(now())
  approvedById      String?          @map("approved_by_id")
  approvedBy        User?            @relation("MdmApproved", fields: [approvedById], references: [id])
  approvedAt        DateTime?
  rejectedById      String?          @map("rejected_by_id")
  rejectedReason    String?
  reason            String
  externalRef       String?          // reserved for PJ-Soft transaction ref
  wallpaperUrlUsed  String?          // snapshot of wallpaper URL at execute time
  createdAt         DateTime         @default(now())
  updatedAt         DateTime         @updatedAt
  deletedAt         DateTime?

  @@index([contractId, status])
  @@index([status, proposedAt])
}

enum MdmLockTrigger {
  UNCONTACTABLE_3D         // NO_ANSWER x3 in 72h
  NO_PROMISE_3D            // overdue ≥ 3d, no future settlementDate, no recent payment
  MANUAL_COLLECTOR         // collector pressed lock button
  MANUAL_OWNER             // owner pressed lock in approval tab
  BROKEN_PROMISE           // settlementDate passed unpaid (future enhancement)
}

enum MdmLockStatus {
  PENDING
  APPROVED
  REJECTED
  EXECUTED_MANUAL   // placeholder until PJ-Soft API integration
  EXECUTED_API      // future: when API integrated
  FAILED
  UNLOCKED
}

// Legal letters (§6)
model ContractLetter {
  id                String         @id @default(uuid())
  contractId        String         @map("contract_id")
  contract          Contract       @relation(fields: [contractId], references: [id])
  letterType        LetterType
  letterNumber      String         @unique                // auto: ST-2026-00123
  status            LetterStatus   @default(PENDING_DISPATCH)
  triggeredAt       DateTime       @default(now())
  pdfUrl            String?                              // S3 URL of generated PDF snapshot
  pdfGeneratedAt    DateTime?
  dispatchedAt      DateTime?
  dispatchedById    String?        @map("dispatched_by_id")
  dispatchedBy      User?          @relation("LetterDispatched", fields: [dispatchedById], references: [id])
  trackingNumber    String?                              // EMS number
  evidencePhotoUrl  String?                              // S3: photo of post office slip
  deliveredAt       DateTime?                            // from EMS confirmation (manual entry)
  cancelledAt       DateTime?
  cancelReason      String?
  createdAt         DateTime       @default(now())
  updatedAt         DateTime       @updatedAt
  deletedAt         DateTime?

  @@unique([contractId, letterType])  // idempotent: one letter per type per contract
  @@index([status, triggeredAt])
  @@index([dispatchedAt])
}

enum LetterType {
  RETURN_DEVICE_45D
  CONTRACT_TERMINATION_60D
}

enum LetterStatus {
  PENDING_DISPATCH   // cron created, PDF not yet generated
  PDF_GENERATED      // PDF on S3, waiting for OWNER to print+mail
  DISPATCHED         // owner mailed + keyed tracking#
  DELIVERED          // EMS confirmed receipt (manual entry for now)
  UNDELIVERABLE      // returned — flag for skip tracing
  CANCELLED          // e.g. customer paid before dispatch
}

// User: track system user for audit trail
model User {
  // ... existing
  isSystemUser  Boolean  @default(false)
}
```

### Seed additions

New DunningRule seeds (event-triggered):
- `dunning_on_no_answer` — `eventTrigger=CALL_NO_ANSWER`, channel=LINE, template "เรียน {{customerName}} เราไม่สามารถติดต่อท่านได้ กรุณาติดต่อกลับเพื่อชำระงวดที่ {{installmentNo}} ยอด {{amount}} ฿"
- `dunning_confirm_promise` — `eventTrigger=CALL_ANSWERED_PROMISE`, channel=LINE, includePaymentLink=true, template "ขอบคุณที่รับสาย กรุณาชำระยอด {{amount}} ภายใน {{settlementDate}} ผ่านลิงก์ด้านล่าง"
- `dunning_firm_warning` — `eventTrigger=CALL_REFUSED`, channel=LINE
- `dunning_device_locked` — `eventTrigger=DEVICE_LOCKED`, channel=LINE, template "เครื่องของท่านถูกล็อคและตั้ง wallpaper แจ้งเตือน กรุณาชำระยอดค้าง {{amount}} ฿ เพื่อปลดล็อคทันที"
- `dunning_device_unlocked` — `eventTrigger=DEVICE_UNLOCKED`, channel=LINE
- `dunning_broken_promise` — `eventTrigger=BROKEN_PROMISE`, channel=LINE, fired by `broken-promise.cron` when `settlementDate` passes unpaid

SystemConfig seeds:
- `mdm_lock_wallpaper_url` — public URL to reminder wallpaper image (PNG 1080×1920, shows "ชำระเงินเพื่อปลดล็อค" + contract# placeholder + QR to payment link). Default points to S3-hosted asset generated at seed time.
- `mdm_auto_propose_enabled` — `true` (feature flag; can be turned off without code change)
- `mdm_uncontactable_threshold_hours` — `72` (NO_ANSWER window)
- `mdm_no_promise_threshold_days` — `3` (overdue days without settlementDate before auto-propose)
- `letter_return_device_days` — `45` (threshold for RETURN_DEVICE_45D letter)
- `letter_termination_days` — `60` (threshold for CONTRACT_TERMINATION_60D letter)
- `letter_signature_url` — S3 URL of authorized signatory signature image (OWNER uploads at setup)
- `letter_letterhead_url` — S3 URL of company letterhead image (optional)
- `letter_auto_generate_enabled` — `true`

Two DunningRule seeds for letter events:
- `dunning_letter_dispatched` — `eventTrigger=LETTER_DISPATCHED`, channel=LINE, template "บริษัทได้จัดส่งหนังสือถึงท่านทางไปรษณีย์ลงทะเบียน (EMS: {{trackingNumber}}) กรุณาติดต่อกลับโดยด่วน"
- `dunning_contract_terminated` — `eventTrigger=CONTRACT_TERMINATED`, channel=LINE, template "สัญญาของท่านได้ถูกบอกเลิกและอยู่ระหว่างดำเนินคดีทางกฎหมาย"

Seed system user:
- `email: system@bestchoice.internal, role: OWNER, isSystemUser: true, isActive: false` (cannot login)

### Dunning Settings Page enhancements

`/settings/dunning` gets a new "Event-triggered" section listing the 6 event rules above with edit capability (template, channel, isActive). Time-triggered rules stay in existing section.

---

## 13. Data Migration Plan

1. Migration A: add new Contract columns (`noAnswerCount`, `needsSkipTracing`, `deviceLocked`, `deviceLockedAt`, `wallpaperChanged`, `wallpaperChangedAt`) with defaults
2. Migration B: create `MdmLockRequest` table (with `trigger` + `includeWallpaper` + `wallpaperUrlUsed`)
3. Migration C: add `eventTrigger` enum + column to `DunningRule`, make `triggerDay` nullable, add CHECK constraint (`trigger_day IS NOT NULL XOR event_trigger IS NOT NULL`); enum includes `LETTER_DISPATCHED` + `CONTRACT_TERMINATED`
4. Migration D: add `User.isSystemUser`
5. Migration E: create `MdmLockTrigger` + `MdmLockStatus` enums
6. Migration F: create `ContractLetter` table + `LetterType` + `LetterStatus` enums; sequence for `letterNumber` generation
7. Seed: create system user; seed 8 event-triggered rules (6 calls/devices + 2 letters); 9 SystemConfig keys (4 MDM + 5 letter); upload default wallpaper + placeholder letterhead/signature to S3 (idempotent `upsert` by name/key)
8. Backfill: one-time script to compute `noAnswerCount` per contract from last 30d callLogs

No destructive changes; all backward compatible with existing cron and table/kanban tab.

---

## 14. Testing Strategy

### Backend
- `dunning-engine.service.spec.ts` — add tests for `executeEventTrigger` per event key
- `mdm-lock.service.spec.ts` — new; propose/approve/reject/unlock flows including role SoD
- `contract-letter.service.spec.ts` — new; create/generate-pdf/dispatch/deliver/cancel; idempotency via unique (contractId, letterType); PDF snapshot verified
- `letter-pdf-renderer.spec.ts` — new; snapshot test per letter type (ensure required fields render correctly)
- `overdue.service.spec.ts` — update tests for fixed race condition
- `overdue-bulk.service.spec.ts` — new; bulk assign/line/lock
- `overdue.controller.spec.ts` — add for new endpoints
- `seed.spec.ts` — verify system user + event rules + letter configs seeded idempotently
- `letter-auto-generate.cron.spec.ts` — new; idempotency (second run produces 0 new letters), threshold respected

### Frontend
- `ContractCard.test.tsx` — render states (no answer x3 → lock CTA appears)
- `ContactLogDialog.test.tsx` — result change triggers correct mutation + optimistic update
- `Customer360Panel.test.tsx` — timeline merges correctly
- `useCollectionsQueue.test.ts` — tab filter query params correct

### E2E Playwright
- `collections-happy-path.spec.ts` — login as collector → open queue tab → card visible → log NO_ANSWER → card moves to follow-up tab (refetch) → LINE action audit appears
- `collections-mdm-approval.spec.ts` — sales proposes lock → OWNER approves in approval tab → contract.deviceLocked=true
- `collections-bulk-assign.spec.ts` — OWNER selects 3 → assign → all 3 have assignedTo
- `collections-promise-kept.spec.ts` — log PROMISE → pay before date → promise-kept metric increments
- `collections-letter-dispatch.spec.ts` — cron creates letter → OWNER generates PDF → downloads → marks dispatched with tracking# + photo → contract gets LINE notification → delivered status update

---

## 15. Rollout Plan

1. **Phase 1** (schema + seeds + API bugs): migrations A/B/C/D/E/F, seed system user + event rules + letter configs, fix C1/C2/C3. Deploy behind no flag (backward compatible).
2. **Phase 2** (event trigger engine): implement `executeEventTrigger`; add to existing `logContact` service. Add DunningSettingsPage event section for visibility. Deploy.
3. **Phase 3** (frontend shell): scaffold `/collections` route + tabs + KPI strip + redirect from `/overdue`. Feature-flag `collections_v2_enabled` (OWNER toggle in SystemConfig). Deploy with flag OFF.
4. **Phase 4** (queue tab + contract card): implement QueueTab + ContractCard + ContactLogDialog. Enable flag for OWNER account in dev. UAT on staging.
5. **Phase 5** (remaining tabs): FollowUpTab, PromiseTab, ApprovalTab, AllTab (move existing). Expand flag to internal staff.
6. **Phase 6** (Customer 360 + bulk + MDM): slide-over + inline payment + MDM propose/approve. Flag to all users.
7. **Phase 7** (Letters): cron + PDF renderer + queue UI in ApprovalTab + OWNER uploads signature/letterhead. Flag to OWNER only initially; one round of legal review of PDF output before enabling auto-generate cron.
8. **Phase 8** (cleanup): remove old `OverduePage.tsx` after 2 weeks of stable `/collections` usage; drop feature flag.

Estimated timeline: 9-13 working days end-to-end, single developer. Letter phase can be deferred by 1-2 weeks behind main UX rollout if needed (infra ready but cron stays disabled).

---

## 16. Out of Scope (YAGNI)

- ❌ Call dialer integration (Twilio/Dialpad) — collector uses own phone; `tel:` link is enough
- ❌ Voice recording / call transcription
- ❌ ML-based priority scoring — simple formula tunable via SystemConfig first
- ❌ PJ-Soft MDM API wire-up — deferred per existing Phase 4 deferral memo; manual placeholder used
- ❌ SMS backup channel for LINE — LINE only (zero marginal cost, customer base has LINE)
- ❌ Native mobile app — responsive web is sufficient
- ❌ Skip tracing automation — flag only; manual follow-up for now
- ❌ Thailand Post Connect API auto-dispatch — OWNER mails manually (MVP); revisit Phase B when letter volume justifies vendor setup
- ❌ Letter multi-language — Thai only (legal jurisdiction)
- ❌ Letter template DB-backed editing — templates are file-based (legal review required per change)
- ❌ OCR of dispatch slip — OWNER keys tracking# manually
- ❌ EMS delivery webhook — `DELIVERED` status is manual update for now
- ❌ Automated legal packet PDF export (contract + call log + payment history bundle) — still manual after letters dispatched
- ❌ Drag-and-drop kanban — AllTab kanban stays read-only (matches reality: stage changes via cron)

---

## 17. Open Questions (pre-implementation)

- **Feature flag granularity** — per-user flag OR per-role OR SystemConfig global? (default: SystemConfig global bool, fastest to ship)
- **KPI cache invalidation** — TTL 60s OR event-driven (invalidate on any payment/callLog write)? (default: TTL 60s, simpler)
- **Bulk action limit** — 100 default; should OWNER be able to override? (default: hard cap 100, no override)
- **Priority formula tunability** — expose `SystemConfig` keys per weight OR hardcode? (default: expose weights, allow owner tuning)

Answers assumed above in square brackets. Deviation requires explicit change.
