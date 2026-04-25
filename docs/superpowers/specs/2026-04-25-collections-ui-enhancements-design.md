# Collections UI Enhancements — Design Spec

**Date**: 2026-04-25
**Scope**: `/collections` (5-tab Workflow Hub + Analytics) and `/overdue` (legacy) pages
**Author**: brainstorming session post Collections Workflow Hub stack (#685-#689) ship
**Status**: Draft — pending user review

## Motivation

Collections Workflow Hub stack (#685–#689) ชิปไปแล้วทุก critical backend feature แต่ยังมี UI gap หลายจุด:

- Data ที่ backend มี (priority score, truncated flag, last-contacted, LINE read state, related contracts) ไม่ถูกแสดงบน UI
- Workflow หลายตัวยังเป็น `window.prompt` / basic forms แทน dialog ที่ดี
- Search + filter capabilities บาง (ตอนนี้มี skip-tracing toggle ตัวเดียว) — ทีมเก็บเงินต้อง scroll หา
- Role-based UI ไม่สอดคล้องกับ backend (SALES เห็น ApprovalTab ว่างเปล่า)
- Legacy `/overdue` page ยัง coexist กับ `/collections` — feature drift + UX confusion

เป้าหมาย: ทำให้ทีมเก็บเงิน (SALES/BRANCH_MANAGER/FINANCE_MANAGER/OWNER) ทำงานเร็วขึ้น เห็น context ครบ ใช้ keyboard ได้ และเจ้าของเห็น insight ระดับ fleet

## Scope

### In Scope
- UI + UX enhancements ที่ `/collections` page (5 tabs + Analytics)
- Customer 360 slide-over component
- ContractCard รูปแบบใหม่
- Letter + MDM approval workflows ใน ApprovalTab
- Search + filter layer (global + per-tab)
- Legacy `/overdue` page decision (redirect plan)
- Reusable components ที่เกิดจากงานนี้ (DateRangePicker, FilterDrawer, etc.)

### Out of Scope
- LIFF customer-facing pages
- PEAK / MDM / CHATCONE / GFIN integration UX
- Sales / POS / Inventory pages
- Mobile-native app
- Completely new tabs beyond 5 existing tabs + Analytics
- Schema-invasive features like PaymentPlanRevision (defer to own spec)

## Design Principles

1. **Surface existing data before adding new** — priority score, truncated flag, last-contacted, LINE state ที่ backend มีอยู่ ต้องแสดง UI ก่อนเพิ่ม feature ใหม่
2. **Role-aware UI** — frontend ควร hide สิ่งที่ backend จะ 403 ไม่ใช่ให้ user กดแล้ว error
3. **Keyboard-first for power users** — ทีม SALES ใช้วันละ 100+ ครั้ง, shortcut + ⌘K ลดเวลาต่อ action
4. **Filter state in URL** — shareable, back button, presets
5. **Reuse shared components** — date range picker, filter drawer, dialogs (ไม่แยก version ต่อหน้า)
6. **Undo over confirm** — snackbar + undo แทน confirm dialog ที่เคย pattern blocking
7. **ห้าม `window.prompt` / `window.confirm` / emoji** (project rules)

---

## Feature Clusters

### Cluster A — Search & Filter

Priority-heavy cluster. All features work together and depend on A6 (DateRangePicker) as foundation.

#### A1. Global Command Palette (⌘K)

**Problem**: ทีมเก็บเงินต้อง navigate manual ทุกครั้งจะเข้า contract เฉพาะ — ไม่มี global search

**UX**:
- Trigger: `⌘K` / `Ctrl+K` ทุกหน้า, หรือปุ่ม search ใน PageHeader
- Dialog fullscreen บน mobile, centered max-w-2xl บน desktop
- Input autofocus, Esc ปิด, click outside ปิด
- Debounce 200ms
- Group results: Contracts / Customers / Phone matches / IMEIs / Letter tracking#
- Keyboard nav: ↑↓ select, Enter open, Tab switch group
- Phone normalize: strip non-digits, prepend `0` ถ้าไม่มี country code
- Recent searches: localStorage 10 latest + pin support
- Click result → navigate or open Customer 360 slide-over (configurable per entity type)

**Data**:
- Endpoint ใหม่ `GET /search/union?q=...&limit=20` — union-search ใน Contract, Customer, CustomerPhone, Product IMEI, ContractLetter
- Must respect BranchGuard (SALES limited to own branch)

**Component**:
- `apps/web/src/components/CommandPalette.tsx`
- Use `cmdk` library (already shadcn-compatible, likely in deps)
- Provider at root level for global `⌘K` hook

**Edge cases**: 0 results, timeout >3s, offline, deleted entities (filter out), ambiguous phone (search across both customer + emergency contacts)

**Priority**: P0 — 1.5 days

#### A2. Queue Filter Panel

**Problem**: ตอนนี้มี skip-tracing toggle เดียว — ทีมต้อง scroll หา contract ที่ตรง criteria

**UX**:
- Slide-in drawer จากขวา (ปุ่ม filter icon ใน tab header)
- 3 sections (collapsible accordion):
  - **Who**: assigned (self / specific / unassigned), branch (cross-branch roles)
  - **Contract state**: overdue bucket (1-7/8-30/31-60/61-90/90+, multi-chip), outstanding range (slider 0-100k+), contract status (multi), product type, letter count
  - **Activity & risk**: last contacted (radio), LINE response state, broken promise count, active promise state, MDM state, skip-tracing (moved from standalone), slip review pending
- Footer: live count "แสดง 23 จาก 147" + Apply button + Reset
- Close drawer → chips bar ใต้ PageHeader แสดง active filters (× ลบ, click label เปิด drawer แก้)
- Clear all 1-click
- URL sync: `?assigned=self&bucket=31-60,61-90&status=OVERDUE,DEFAULT`
- "Invert" toggle per chip (NOT condition)

**Backend**:
- Extend `QueueQueryDto` — add ~10 optional filter fields
- Update `queue.service.ts` where-builder to handle new filters
- Priority score + truncated cap logic unchanged

**Component**:
- `apps/web/src/pages/CollectionsPage/components/FilterDrawer.tsx`
- `apps/web/src/pages/CollectionsPage/components/FilterChipsBar.tsx`
- Used by QueueTab, FollowUpTab, PromiseTab, AllTab

**Edge cases**: SALES ไม่ควรเห็น branch filter (auto-locked ที่สาขาตนเอง), filter combinations ที่ return 0 results ต้องแสดง empty-state แนะนำ "Clear filter?"

**Priority**: P0 — 2 days

#### A3. Saved Filter Presets

**Problem**: ทีมใช้ filter ชุดเดิมวันละหลายครั้ง — ตอนนี้ reset ทุกครั้งที่รีเฟรช

**Schema** (new Prisma model):
```prisma
model FilterPreset {
  id String @id @default(uuid())
  name String
  ownerUserId String
  owner User @relation(fields: [ownerUserId], references: [id])
  scope FilterPresetScope @default(PRIVATE) // PRIVATE | SHARED_BRANCH | SHARED_ALL
  branchId String? // required if scope = SHARED_BRANCH
  page String // 'collections-queue' (scope for future reuse on other pages)
  filterJson Json // serialized filter state
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  deletedAt DateTime?
  @@index([ownerUserId, page])
  @@index([scope, branchId])
}

enum FilterPresetScope {
  PRIVATE
  SHARED_BRANCH
  SHARED_ALL
}
```

**UX**:
- Dropdown "Presets ▼" ซ้ายของ filter button
- System presets (hardcoded, not in DB): "ด่วนวันนี้", "เลยกำหนด 60+", "LEGAL pipeline", "ยังไม่แตะ 7 วัน"
- User presets appear under user name
- Shared (branch/all) under "ทีม" heading
- "Save current filter..." action → dialog ชื่อ + scope
- OWNER/BRANCH_MANAGER can save as SHARED_BRANCH, OWNER only as SHARED_ALL
- Delete preset via hover → trash icon

**Endpoints**: `GET /filter-presets?page=collections-queue`, `POST /filter-presets`, `DELETE /filter-presets/:id`

**Priority**: P1 — 1 day (after A2)

#### A4. Sort Options

**UX**:
- Dropdown ซ้ายของ filter chips bar
- Options: Priority (default) / ยอดค้าง ↓ / ยอดค้าง ↑ / วันเลยมากสุด / ไม่ได้แตะนานสุด / นัดวันนี้ก่อน / ชื่อ A-Z / Random rotation
- URL sync: `?sort=outstanding&dir=desc`
- Random rotation = stable seed per collector per day (ไม่ให้ order เปลี่ยนระหว่างรีเฟรชใน session เดียวกัน)

**Backend**: extend QueueQueryDto + queue.service orderBy logic

**Priority**: P1 — 0.5 day

#### A5. Customer 360 Timeline Filter

**UX**:
- Chip bar บน Customer360Timeline: `ทั้งหมด / การชำระ / LINE+SMS / โทร / จดหมาย / MDM / เปลี่ยนสถานะ`
- + date range picker (A6)
- Multi-select chips
- URL params? (timeline เปิดเป็น slide-over, state in component)

**Component**: extend `Customer360Timeline.tsx`

**Priority**: P1 — 0.5 day (bundle with A6)

#### A6. Reusable Date Range Picker

**Problem**: AnalyticsTab มี 30d/90d toggle, Audit logs ไม่มี, Customer 360 timeline ไม่มี — inconsistent

**Component**: `apps/web/src/components/ui/DateRangePicker.tsx`
- Quick presets: วันนี้ / 7 วัน / 30 วัน / เดือนนี้ / เดือนที่แล้ว / 3 เดือน / custom
- Thai calendar display (พ.ศ.)
- Controlled component: `value={{ from, to }}, onChange, presets?`
- Uses shadcn `Popover` + `Calendar`

**Adopted by**: AnalyticsTab (replace 30d/90d), Audit logs, Customer 360 timeline, Letter queue (when retrospective filter added), LINE retry queue, Payments

**Priority**: P0 (prerequisite) — 1 day

---

### Cluster B — Card & Queue UX

#### B1. ContractCard Visual Indicators

**Problem**: card แสดง limited info (ชื่อ, ยอด, วันเลย, pnง.assigned) — ข้อมูลที่ backend มีอยู่ไม่ถูกแสดง

**New indicators** (chip row ใต้ main info):

| Indicator | Source | Display |
|-----------|--------|---------|
| Aging gradient | daysOverdue bucket | Pill สี emerald/amber/orange/red/purple + "เลย 37 วัน" |
| Trending arrow | Compare daysOverdue 7 days ago | `↑` getting worse, `↓` improving (requires snapshot history) |
| Last contacted | Max of CallLog.createdAt, DunningAction.sentAt | `🕐 2 ชม.` / `3 วัน` / `⚠ ไม่เคย` |
| Broken promise count | Count audit events `BROKEN_PROMISE` for this contract | `⚠ นัดผิด 3 ครั้ง` if > 0 |
| Channel icons | Last DunningAction.channel | Icon of last-used channel (LINE/SMS/Call/Letter) + color-coded |
| MDM state | MdmRequest.status for contract | `🔓 ยังไม่ล็อค` / `🔒 ล็อคแล้ว` / `⏳ รออนุมัติ` |
| Snooze state | ContractSnooze where userId=self | `💤 จน 15:00` (only if snoozed) |
| Related contracts | Count Contract where customerId same | `+2 สัญญา` (click → Customer 360 → Related tab) |

**Layout**:
- Row 1: ชื่อ + ยอดค้าง (prominent)
- Row 2: indicator chip bar (responsive: mobile = icon-only, desktop = full text)
- Right column: pnง.chip + ⋯ menu

**Data fetch**:
- Queue endpoint ส่งข้อมูลเพิ่มเติมเหล่านี้ pre-computed
- Avoid N+1: `queue.service.ts` include these as part of select clause
- **Trending arrow** (decision Q1): daily snapshot via `ContractDailySnapshot` table + cron 00:00 Bangkok (30 day retention). Trending arrow computed as `(today.daysOverdue - 7dayAgo.daysOverdue)` sign. Activates P1 once 7+ days data exists.

**Schema for trending arrow (P1)**:
```prisma
model ContractDailySnapshot {
  id String @id @default(uuid())
  contractId String
  contract Contract @relation(fields: [contractId], references: [id])
  date DateTime @db.Date
  daysOverdue Int
  outstanding Decimal @db.Decimal(12, 2)
  status ContractStatus
  createdAt DateTime @default(now())
  @@unique([contractId, date])
  @@index([date])
  @@index([contractId, date(sort: Desc)])
}
```

**Retention**: cron removes snapshots older than 30 days.

**Priority**: P0 — 2 days (core indicators, no trending arrow). P1 — 1 day (snapshot cron + trending arrow UI activation).

#### B2. Snooze Workflow

**Problem**: ทีมอยากเก็บ contract ไว้กลับมาดูทีหลังโดยไม่ต้องเห็นซ้ำวันนี้

**Schema**:
```prisma
model ContractSnooze {
  id String @id @default(uuid())
  contractId String
  contract Contract @relation(fields: [contractId], references: [id])
  userId String
  user User @relation(fields: [userId], references: [id])
  snoozedUntil DateTime
  reason String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  deletedAt DateTime?
  @@unique([contractId, userId, deletedAt]) // one active snooze per contract per user
  @@index([userId, snoozedUntil])
}
```

**UX**:
- ⋯ menu on card → "Snooze จน..." → options: 1 ชม / 2 ชม / พรุ่งนี้ 09:00 / สัปดาห์หน้า / custom (datetime picker)
- Snoozed cards: `💤` badge + timestamp, click "ยกเลิก" to remove snooze
- Visibility rule (queue.service):
  - `ContractSnooze.snoozedUntil > now AND userId === currentUser.id` → exclude from queue results
  - OWNER sees all cards regardless of snooze (+ indicator who snoozed)

**Endpoints**: `POST /contracts/:id/snooze`, `DELETE /contracts/:id/snooze`

**Priority**: P1 — 1.5 days (schema + migration + endpoint + UI + queue filter)

#### B3. Undo Snackbar

**Problem**: Errant bulk actions cannot be reversed — user reluctance to use bulk features

**UX**:
- After assign / send LINE / snooze / propose-lock / mark undeliverable → Sonner toast 10s with "เลิกทำ" button
- After 10s, toast dismisses; action remains

**Reversibility matrix (decision Q3 — per-action timeout)**:
| Action | Timeout | Undo behavior | Live-check |
|--------|---------|---------------|------------|
| Assign | 30s | Reassign back to previous assignee (store previous in closure) | None (Contract.assignedToId is current source of truth) |
| Snooze | 30s | Delete ContractSnooze row | None |
| Mark undeliverable | 30s | Revert letter status to DISPATCHED | None |
| Propose-lock | 10s | Delete MdmRequest | Query `MdmRequest.status === 'PENDING'` first; if APPROVED/REJECTED → toast changes to "ไม่สามารถยกเลิกได้แล้ว" |
| Send LINE ad-hoc | no undo | Toast shows recipient count + view-log link | — |
| Send LINE bulk | no undo | Toast shows success/fail count | — |

**Implementation**:
- `useUndoMutation` wrapper in `hooks/useUndoMutation.ts`
- Returns mutation fn + stores reverse fn in toast action
- Timeout per action via Sonner `duration` prop (pass 30000 / 10000)
- Propose-lock undo button: onClick → `GET /mdm-requests/:id` → check status → fire reverse mutation OR show error toast

**Priority**: P1 — 1 day

#### B4. Daily Progress Header

**Problem**: Collectors have no self-awareness of daily throughput

**UX**:
- Horizontal strip within `/collections` PageHeader (below title, above tabs)
- 4 mini-KPI:
  - `📞 7 / เป้า 20` calls today
  - `💬 12` LINE sent today
  - `🤝 3 นัดสำเร็จ` promises kept
  - `💰 ฿28,500` collected
- OWNER view: aggregate across all collectors + own personal row
- SALES view: own stats only
- Click mini-KPI → filter QueueTab by relevant criteria

**Data**:
- Endpoint `GET /overdue/kpi/my-today` (new)
- Re-compute on page load + poll every 5 min

**Priority**: P2 — 1 day

#### B5. Batch Copy Phones

**UX**:
- Bulk selection active → BulkActionBar button "📋 Copy เบอร์" (lucide icon not emoji)
- Click → `navigator.clipboard.writeText(phones.join(', '))` + toast "คัดลอก 23 เบอร์แล้ว"

**Priority**: P2 — 2 hours

#### B6. Keyboard Shortcuts

**Problem**: Power users want fast navigation without mouse

**Shortcuts (decision Q7 — G-prefix for tabs, single-key for card actions)**:
| Key | Action | Scope |
|-----|--------|-------|
| `?` | Open shortcuts help dialog | Global |
| `⌘K` / `Ctrl+K` | Command palette (A1) | Global |
| `/` | Focus filter chips search | Collections page |
| `Esc` | Close dialog/drawer/modal | Global |
| `J` / `↓` | Next card | Queue/FollowUp/Promise/All tabs |
| `K` / `↑` | Previous card | Same |
| `Enter` | Open Customer 360 slide-over for focused card | Same |
| `L` | Send LINE ad-hoc for focused card | Same |
| `C` | Log call for focused card | Same |
| `P` | Record payment for focused card | Same |
| `S` | Snooze focused card | Same |
| `A` | Assign focused card | Same |
| `G Q` | Go to Queue tab | Collections page |
| `G F` | Go to Follow-up tab | Collections page |
| `G P` | Go to Promise tab | Collections page |
| `G A` | Go to Approval tab | Collections page |
| `G N` | Go to aNalytics tab | Collections page |
| `G L` | Go to aLl tab | Collections page |

**G-prefix logic**: press `G` → wait 1.5s for second key → if match, trigger; if timeout or non-match, cancel. Show indicator "G-" in corner while waiting.

**Implementation**: use `react-hotkeys-hook` (check if in deps; if not, add as P0 dep)

**Focus state**: QueueTab maintain `focusedCardId` state; arrow keys update it; card shows ring when focused

**Priority**: P1 — 1.5 days

#### B7. Truncated Indicator (existing gap)

**UX**:
- If `queueResponse.truncated === true` → banner below filter chips bar:
  > `"⚠ แสดง 500 แถวแรก — ปรับ filter ให้แคบลงเพื่อเห็นทั้งหมด"` + ปุ่ม "เปิด filter"
- Click button → open A2 drawer

**Priority**: P0 — 30 min (quick win)

---

### Cluster C — Customer 360 Enhancements

#### C1. Contract Snapshot Preview

**Problem**: User clicks on card → loads full Customer 360 slide-over (1-2s) just to see summary. Want peek-before-commit.

**UX**:
- Hover ContractCard > 500ms → floating panel appears (right side, fade+slide in)
- Mobile: long-press (500ms) → bottom sheet
- Content: 6-line summary
  - Name + phone (tap-to-call)
  - Contract# + status + product name
  - Total / outstanding / installments remaining
  - Last promise date + result (kept/broken)
  - Last LINE timestamp + read state
  - Last collector comment (truncated 100 chars)
- ESC or mouse-out → dismiss
- Click "ดูทั้งหมด" → open full Customer 360

**Data**:
- Endpoint `GET /contracts/:id/snapshot` — lightweight (5-10x faster than full timeline)
- Cache in React Query w/ 30s stale time

**Priority**: P1 — 1.5 days

#### C2. Call Result Quick-Tags

**Problem**: free-text textarea causes inconsistent data — hard to analyze

**UX**:
- ContactLogDialog top: 2 radio chip rows
  - **ผลการโทร**: รับสาย / ไม่รับสาย / สายไม่ว่าง / ปิดเครื่อง / เบอร์ไม่ติดต่อ
  - **ผลการเจรจา**: ขอผ่อน / จะจ่าย / ปฏิเสธ / ขอคืนเครื่อง / กำลังเจรจา (disabled ถ้าผลการโทรเป็นไม่รับ)
- Bottom: textarea สำหรับ detail เพิ่ม
- Auto-save tags to CallLog `callResult` (new field)

**Schema**:
```prisma
enum CallResult {
  ANSWERED
  NO_ANSWER
  BUSY
  DEVICE_OFF
  UNREACHABLE
}

enum NegotiationResult {
  REQUESTED_EXTENSION
  WILL_PAY
  REFUSED
  REQUESTED_RETURN
  NEGOTIATING
  NOT_APPLICABLE
}

model CallLog {
  // ... existing fields
  callResult CallResult?
  negotiationResult NegotiationResult?
}
```

**Benefit**: analytics can ask "% of no-answer calls by collector", "unreachable contracts for skip-tracing queue"

**Priority**: P1 — 1 day

#### C3. Voice Memo Attach

**Problem**: Typing comments takes time; audio is faster for rich detail

**UX**:
- ContactLogDialog button "🎤 บันทึกเสียง" (lucide Mic icon)
- Click → ask browser permission → record UI with waveform + stop button
- Max 60s recording
- Preview before save
- Upload: MediaRecorder → Blob → S3 presigned URL → store URL in `CallLog.voiceMemoUrl`
- Customer 360 Timeline: `<audio controls>` for playback

**Schema**: add `voiceMemoUrl String?` + `voiceMemoTier String? ('HOT' | 'GLACIER')` to CallLog

**S3 lifecycle (decision Q6)** — tiered storage:
- Hot (S3 Standard): 0-90 days — direct playback via signed URL
- Glacier: 90 days-2 years — retrieve takes hours; UI shows "ไฟล์เก็บในคลัง ใช้เวลา ~4 ชม. ดึงกลับ" + "Request retrieval" button
- Delete: 2 years (lifecycle rule auto-delete)

**Lifecycle implementation**:
- S3 bucket lifecycle policy (configured via Terraform or manual): `LETTER_EVIDENCE/voice-memos/` prefix → Transition to Glacier after 90 days → Expiration after 730 days
- Frontend check: if `voiceMemoTier === 'GLACIER'` → show retrieval flow (Glacier async restore)

**Priority**: P2 — 1.5 days (MediaRecorder + S3 upload + lifecycle config)

#### C4. Smart Customer Data Panel

**Problem**: Customer preferences derived from data never surfaced

**UX**:
- Customer 360 header below name: 3 badges
  - **รับสายบ่อย**: Morning / Afternoon / Evening (computed from CallLog.createdAt where callResult=ANSWERED)
  - **ช่องทาง response สูง**: LINE / SMS / Call (compute response rate per channel)
  - **LINE online**: `✓ 5 นาทีก่อน` / `⚠ 2 วัน` (if available via CHATCONE integration)
- Customer 360 new tab "สัญญาอื่นๆ" (if > 1 contract) — list all contracts of this customer with status

**Data**:
- Computed-on-read endpoint `GET /customers/:id/insights`
- OR materialized fields on Customer model (expensive to keep fresh)

**Priority**: P2 — 1.5 days

---

### Cluster D — Approval & Letter Workflows

#### D1. MDM Unlock Button

**Existing gap** — endpoint `POST /overdue/mdm-requests/:id/unlock` exists, hook `useUnlockMdm` added in #685 Wave, no UI.

**UX**:
- ApprovalTab `MdmRow` → 3 buttons: `อนุมัติล็อค` / `ปฏิเสธ` / `ปลดล็อค`
- "ปลดล็อค" visible OWNER only
- Click → ConfirmDialog: "ยืนยันปลดล็อคเครื่อง? ลูกค้าจะใช้ได้ทันที"
- Success → invalidate `['pending-mdm']` + `['collections-queue']` + toast

**File**: `apps/web/src/pages/CollectionsPage/components/ApprovalPendingRow.tsx` line ~224

**Priority**: P0 — 45 min

#### D2. Wallpaper Attachment on MDM Approve

**Existing gap** — upload UI exists in DunningSettings, stored URL, but no UI during approve

**UX**:
- `MdmRow` approve → dialog shows wallpaper preview + checkbox "แนบภาพพื้นหลังให้เครื่อง"
- Default: checked if `mdm_lock_wallpaper_url` set in settings
- Pass `includeWallpaper: boolean` to `approveAndLock` mutation
- Backend: if true, send wallpaper URL to MDM API

**Backend verify**: check if MDM service integration (`MdmLockService`) accepts wallpaper parameter; may need extension

**Priority**: P0 — 1 day

#### D3. Letter PDF Preview Popup

**UX**:
- LetterQueueSection row "ดู PDF" button
- Click → Dialog fullscreen → `<iframe src={pdfUrl}>` with zoom/pan via pdf.js viewer
- Fallback: "เปิดในแท็บใหม่" link
- Pre-dispatch preview in LetterDispatchDialog (ensure PDF generated before dispatch)

**Priority**: P1 — 0.5 day

#### D4. Letter Evidence Preview + Validation

**Existing gap** — input works, no preview, no mandatory check

**UX**:
- LetterDispatchDialog evidence section:
  - Display thumbnail grid of uploaded evidence (max 3 per letter)
  - Click thumbnail → lightbox (open modal with full image + zoom)
- Mandatory checkbox: "ตรวจสอบหลักฐานการส่งถูกต้องแล้ว" before "ยืนยันส่ง" enables
- EXIF validation (server-side): if photo `DateTime` > 7 days ago, warning shown

**Backend**: `ContractLetter.evidencePhotos` — store as array if multiple; for now multi = JSON field

**Priority**: P0 — 1 day

#### D5. Broken Promise Auto-Suggest

**Problem**: Promises due today don't auto-notify; collectors miss them

**Flow**:
- Cron daily 09:00: find promises due today without payment → create `DunningAction` type `PROMISE_DUE_REMINDER`
- PromiseTab banner: "🔔 วันนี้มีนัดครบกำหนด 5 ราย — ส่ง LINE เตือนทั้งหมด?" + button
- Click → bulk LINE with template "เรียนคุณ {name}, วันนี้ครบกำหนดนัดชำระ..."

**Backend**: new cron `promise-due-reminder.cron.ts`

**Priority**: P1 — 2 days

#### D6. Skip-Tracing Wizard

**Problem**: When `needsSkipTracing=true` flag shows, no guided workflow to update contact

**UX**:
- Card with skip-tracing flag → button "หาเบอร์ใหม่"
- Dialog guided 4 steps:
  1. Emergency contact from customer profile → "โทร emergency" button
  2. Try new LINE/phone → input fields → update Customer
  3. Social media check manual → link to Facebook/Instagram search (external)
  4. Result logging: เจอ / ไม่เจอ / bật tag "สูญหาย" (LOST)
- Final: update Customer profile if contact found, or set `CustomerStatus.LOST`

**Backend**: endpoint `POST /customers/:id/update-contact` + `CustomerStatus.LOST` enum value

**Priority**: P2 — 2 days

#### D7. Payment Plan Renegotiation

**Problem**: Currently no workflow — collector must ask OWNER manually

**Scope decision**: **defer to own spec**. Schema changes too invasive (PaymentPlanRevision workflow, approval flow, audit trail). Revisit in separate design cycle.

**Priority**: Out of scope for this spec

#### D8. Court Case Attachment on LEGAL

**Problem**: LEGAL status contracts have no data about the actual court case

**Schema**:
```prisma
model LegalCase {
  id String @id @default(uuid())
  contractId String @unique
  contract Contract @relation(fields: [contractId], references: [id])
  caseNumber String
  court String
  hearingDate DateTime?
  lawyerName String?
  lawyerPhone String?
  documents LegalCaseDocument[]
  notes String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  deletedAt DateTime?
  @@index([contractId])
}

model LegalCaseDocument {
  id String @id @default(uuid())
  legalCaseId String
  legalCase LegalCase @relation(fields: [legalCaseId], references: [id])
  kind String // 'complaint', 'summons', 'judgment', 'settlement', 'other'
  filename String
  s3Url String
  uploadedAt DateTime @default(now())
  uploadedByUserId String
}
```

**UX**:
- Contract status → LEGAL → Customer 360 banner "เพิ่มข้อมูลคดี"
- Dialog: เลขคดี / ศาล / วันนัด / ทนายความ + ชื่อ + เบอร์ / อัปโหลด documents (PDF multi, max 10MB each)
- Once saved, banner becomes "ดูคดี" link → read-only view + edit

**Priority**: P2 — 2 days

#### D9. ApprovalTab Role Gate

**Existing gap** — all 5 roles can click Approval tab, SALES/ACCOUNTANT see 403s

**Fix** in CollectionsPage:
```tsx
const ROLE_ACCESS = {
  approval: ['OWNER', 'FINANCE_MANAGER', 'BRANCH_MANAGER'],
  analytics: ['OWNER', 'FINANCE_MANAGER'],
  // queue/follow-up/promise/all: all roles
};
const visibleTabs = tabs.filter(t =>
  !ROLE_ACCESS[t.key] || ROLE_ACCESS[t.key].includes(user.role)
);
```

**Priority**: P0 — 30 min

---

### Cluster E — Analytics & OWNER Insights

Expand AnalyticsTab beyond current 5 trend charts.

#### E1. Aging Bucket Breakdown

**UX**:
- Horizontal stacked bar chart
- Buckets: 1-7 / 8-30 / 31-60 / 61-90 / 90+ days
- Toggle "count / ฿" (count of contracts OR total outstanding per bucket)
- Click bucket → navigate to QueueTab with bucket filter applied

**Backend**: `GET /overdue/analytics/aging`

**Priority**: P1 — 1 day

#### E2. Collector Leaderboard

**OWNER only**.

**UX**:
- Table with collector rows:
  - Name / assigned contracts / promise kept % / avg days to first contact / recovery ฿ this month
- Sort any column
- Export CSV button
- Top 3 highlighted with trophy icons (lucide)

**Backend**: extend `/overdue/analytics` OR new endpoint `GET /overdue/analytics/leaderboard`

**Priority**: P1 — 1.5 days

#### E3. Recovery Rate by Channel

**UX**:
- Grouped bar chart: 4 channels × 2 metrics (% recovered, avg ฿)
- "recovered" = contract paid within 7 days of channel action

**Priority**: P2 — 1 day (requires event mapping validation)

#### E4. Stuck Contracts Widget

**OWNER only**.

**UX**:
- AnalyticsTab section: table of contracts with no activity in past 14 days
- Columns: contract# / collector / days stuck / last action / outstanding
- Bulk-select + "Reassign" button → open dialog to choose new collector

**Backend**: endpoint `GET /overdue/analytics/stuck?days=14`

**Priority**: P1 — 1 day

#### E5. Workload Redistribution (Drag-Drop)

**OWNER tool**.

**UX**:
- Grid view: columns = collectors, cards = their assigned contracts
- Drag card from A → B = reassign
- Multi-select + drop = batch reassign
- "Auto-balance" button = divide evenly across active collectors

**Tech**: react-dnd or react-beautiful-dnd (check if in deps)

**Priority**: P2 — 3 days

---

### Cluster F — Legacy `/overdue` Decision

**Current state**: `/overdue` = `OverduePage.tsx` (old table/kanban view), `/collections` = 5-tab new page. Both functional.

**Problem**: Feature drift — new features land on `/collections` only. Team confusion about which URL to bookmark.

**Decision (Q4)**: Redirect immediately + dismissible banner on `/collections` for 14 days. No dual-run. Remove `OverduePage.tsx` in same deploy.

**Router change**:
```tsx
{ path: '/overdue', element: <Navigate to="/collections" replace /> }
{ path: '/overdue/*', element: <Navigate to="/collections" replace /> }
```

**Banner on `/collections`** (14 days from deploy, dismissible, persisted via localStorage `collections-migrated-banner-dismissed`):
> "ย้ายจาก /overdue มาที่ /collections แล้ว อัปเดต bookmark ได้เลย"

Remove banner code + localStorage key cleanup in follow-up PR after 14 days.

**File cleanup (same deploy)**:
- Delete `apps/web/src/pages/OverduePage.tsx`
- Remove unused helpers referenced only by OverduePage

**Priority**: P1 — redirect + banner 30 min, cleanup 1 hour

---

## Priority Summary

### P0 — Must ship 1-2 weeks
| Item | Effort |
|------|--------|
| A1 ⌘K Command Palette | 1.5d |
| A2 Queue Filter Panel | 2d |
| A6 Date Range Picker (shared) | 1d |
| B1 ContractCard indicators (minus trending arrow) | 1.5d |
| B7 Truncated banner | 30min |
| D1 MDM unlock button | 45min |
| D2 Wallpaper attach | 1d |
| D4 Letter evidence preview | 1d |
| D9 ApprovalTab role gate | 30min |

**Total P0**: ~8.5 days sequential, or ~3 days with 3 parallel agents

### P1 — Sprint 3-4
| Item | Effort |
|------|--------|
| A3 Saved presets | 1d |
| A4 Sort options | 0.5d |
| A5 Timeline filter | 0.5d |
| B2 Snooze | 1.5d |
| B3 Undo snackbar | 1d |
| B6 Keyboard shortcuts | 1.5d |
| B1 Trending arrow (extract) | 0.5d |
| C1 Snapshot preview | 1.5d |
| C2 Call result quick-tags | 1d |
| D3 Letter PDF preview | 0.5d |
| D5 Broken-promise auto-suggest | 2d |
| E1 Aging bucket | 1d |
| E2 Collector leaderboard | 1.5d |
| E4 Stuck contracts | 1d |
| F `/overdue` redirect | 15min |

**Total P1**: ~14 days sequential

### P2 — Month 2+
| Item | Effort |
|------|--------|
| B4 Daily progress header | 1d |
| B5 Batch copy phones | 2h |
| C3 Voice memo | 1.5d |
| C4 Smart customer data | 1.5d |
| D6 Skip-tracing wizard | 2d |
| D8 Court case attachment | 2d |
| E3 Recovery by channel | 1d |
| E5 Workload redistribution | 3d |

**Total P2**: ~12 days

**Grand total**: ~34 days sequential, or ~12 days with parallel work

---

## Risks & Dependencies

### Dependencies
- A6 DateRangePicker must ship before A5, E1, E2, E4 (they all consume it)
- A2 Filter Panel must ship before A3 presets
- B1 indicators depend on queue.service providing pre-computed fields (backend change)
- B2 Snooze requires schema migration — sequence with B1 if both in same sprint
- D1/D2 MDM unlock/wallpaper require backend MDM service extension

### Risks
- **Trending arrow (B1)** needs historical data — may not exist. Options: (a) compute on-the-fly from AuditLog (slow), (b) start collecting daily snapshot (adds 2-week data lag), (c) defer to P1
- **D6 Skip-tracing** assumes Customer model has `emergencyContact` field — verify
- **E5 Workload DnD** needs new React DnD library — bundle size impact
- **C3 Voice memo** — MediaRecorder browser compatibility (Safari iOS limitations)
- **B6 Keyboard shortcuts** — focus conflicts with input fields (must disable when input focused)
- **A1 ⌘K search** — query performance on phone/IMEI needs indexes; may need new composite indexes

### Security Considerations
- A1 search respects BranchGuard (SALES can't search other branches)
- A3 presets: SHARED_ALL scope OWNER only, SHARED_BRANCH branch manager+
- D1 MDM unlock OWNER only
- D8 Legal case documents need access control (OWNER/FINANCE_MANAGER only)
- C3 voice memos contain PII — ensure S3 bucket has correct policy

### Testing Strategy
- Each feature: unit test on service layer (where applicable), component test on UI
- E2E smoke: QueueTab filter round-trip, command palette open-search-navigate, MDM unlock flow
- Visual regression: ContractCard new indicator layout (screenshot diff)
- Keyboard shortcut tests: focus management, Esc priority
- Accessibility: all new dialogs have proper ARIA, focus trap, Esc to close

---

## Open Questions

All resolved — see Decision Log below (2026-04-25 entries).

---

## Rollout Plan (post-implementation)

1. **Phase 1 (P0)**: Ship A1, A2, A6, B1, B7, D1, D2, D4, D9 behind feature flag `collections_v2_ui_enhancements` — OWNER tenant first, staged to all after 3 days stable
2. **Phase 2 (P1)**: Incremental ship per item (no feature flag per item, but monitor Sentry errors)
3. **Phase 3 (P2)**: Prioritize based on feedback from Phase 1-2 usage

### Success Metrics
- Avg time to find contract drops from ~30s to <5s (⌘K)
- Filter usage: >60% of collectors use filter panel weekly
- MDM unlock button usage (was impossible before — baseline 0)
- Snooze adoption: >20% of daily queue cards snoozed at least once per week per collector
- Bug report count post-rollout < 5 in first 2 weeks

---

## Decision Log

- **2026-04-25** (Q1): Trending arrow (B1) data = **daily snapshot cron** (`ContractDailySnapshot` table, 30-day retention). Reusable foundation for analytics. Trending arrow activates P1 after 7 days data collected.
- **2026-04-25** (Q2): System filter presets **hardcoded** in frontend const array (not DB-seeded). Single-tenant ธุรกิจ ไม่บ่อย. OWNER customize ผ่าน user preset อยู่แล้ว.
- **2026-04-25** (Q3): Undo snackbar uses **per-action timeout + live reversibility check**:
  - Assign / Snooze / Mark-undeliverable: 30s timeout
  - Propose-lock: 10s + query `MdmRequest.status === 'PENDING'` before allowing undo
  - Send LINE (ad-hoc or bulk): no undo (shows recipient list only)
- **2026-04-25** (Q4): `/overdue` redirect = **immediate + dismissible banner on `/collections` for 14 days**. Banner: "ย้ายจาก /overdue มาที่นี่ อัปเดต bookmark ได้เลย". No dual-run. Remove `OverduePage.tsx` after first deploy.
- **2026-04-25** (Q5): D7 Payment plan renegotiation **deferred to separate spec**. Schema change (`PaymentPlanRevision` + approval flow + journal impact) needs accountant review (TFRS interest recognition policy).
- **2026-04-25** (Q6): Voice memo S3 lifecycle = **tiered storage**: hot (S3 Standard) 90 days → Glacier 2 years → delete. Retrieval from Glacier acceptable for legal dispute use case (not real-time).
- **2026-04-25** (Q7): Tab navigation shortcuts use **G-prefix 2-key combo** (Gmail/GitHub style): `G Q/F/P/A/N/L`. Avoids collision with single-key card shortcuts (L/A/C/P/S). Help overlay (`?`) documents both.
- **2026-04-25**: Trending arrow (B1) split — main B1 ships P0 without trending, trending added P1 after data foundation decided.
- **2026-04-25**: Random sort (A4) uses stable per-collector-per-day seed (not true random per request).
- **2026-04-25**: Saved preset model is new (not reused existing UserPreference) — because of sharing scope semantics.
