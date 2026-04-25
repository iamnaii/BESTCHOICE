# Collections UI Enhancements — P2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ส่ง P2 long-tail features 8 ตัว — daily progress KPI, batch copy phones, voice memo, smart customer data, skip-tracing wizard, court case attachment, recovery rate by channel, workload redistribution drag-drop

**Architecture:** ใช้ foundation ทั้ง P0 + P1 ship แล้ว (DateRangePicker, FilterDrawer, CommandPalette, Snooze, Undo, Keyboard shortcuts, Trending arrow, Analytics). P2 เพิ่ม reusable hook (`useMediaRecorder`, `useDragDrop`) + new backend models (LegalCase, LegalCaseDocument) + MediaRecorder integration + S3 Glacier lifecycle

**Tech Stack:** เหมือน P0+P1 + `react-dnd` หรือ `@hello-pangea/dnd` (new dep for workload DnD) + MediaRecorder API + S3 Glacier storage class

**Working Branch:** `feat/collections-ui-p2` (create from P1 merged state)

**Depends on:** P0 + P1 plans shipped + merged

---

## Scope & Task Order

8 Features จาก P2 priority bucket:
- Task 1: Daily Progress Header (B4) — 4 mini-KPI strip + endpoint `/overdue/kpi/my-today`
- Task 2: Batch Copy Phones (B5) — BulkActionBar button
- Task 3: Voice Memo infrastructure (C3 schema + S3 Glacier lifecycle)
- Task 4: Voice Memo recording UI (C3) — MediaRecorder + playback
- Task 5: Smart Customer Data Panel (C4) — Customer 360 insights + related contracts tab
- Task 6: Skip-Tracing Wizard (D6) — 4-step dialog + customer contact update endpoint
- Task 7: Court Case Attachment (D8) — LegalCase schema + Customer 360 UI
- Task 8: Recovery Rate by Channel analytics (E3) — channel × recovery % chart
- Task 9: Workload Redistribution DnD (E5) — OWNER drag-drop grid

**Parallelizable clusters**:
- α: Task 1 (daily KPI) + Task 2 (batch copy) — 1 agent serial (small)
- β: Task 3 (voice schema + S3 lifecycle) → Task 4 (voice UI) serial
- γ: Task 5 (smart customer data)
- δ: Task 6 (skip-tracing)
- ε: Task 7 (legal case)
- ζ: Task 8 (recovery analytics)
- η: Task 9 (workload DnD)

Recommended: 7 parallel clusters → ~3-4 days to ship

---

## File Structure

### New files (web)
```
apps/web/src/pages/CollectionsPage/components/DailyProgressStrip.tsx
apps/web/src/pages/CollectionsPage/components/VoiceMemoRecorder.tsx
apps/web/src/pages/CollectionsPage/components/VoiceMemoPlayback.tsx
apps/web/src/pages/CollectionsPage/components/SmartCustomerPanel.tsx
apps/web/src/pages/CollectionsPage/components/RelatedContractsTab.tsx
apps/web/src/pages/CollectionsPage/components/SkipTracingWizard.tsx
apps/web/src/pages/CollectionsPage/components/LegalCaseDialog.tsx
apps/web/src/pages/CollectionsPage/components/LegalCaseBanner.tsx
apps/web/src/pages/CollectionsPage/components/WorkloadGrid.tsx
apps/web/src/pages/CollectionsPage/hooks/useMyTodayKpi.ts
apps/web/src/pages/CollectionsPage/hooks/useMediaRecorder.ts
apps/web/src/pages/CollectionsPage/hooks/useCustomerInsights.ts
apps/web/src/pages/CollectionsPage/hooks/useLegalCase.ts
apps/web/src/pages/CollectionsPage/hooks/useWorkloadGrid.ts
apps/web/src/pages/CollectionsPage/tabs/AnalyticsTab/RecoveryByChannelChart.tsx
```

### New files (api)
```
apps/api/src/modules/legal-case/legal-case.module.ts
apps/api/src/modules/legal-case/legal-case.controller.ts
apps/api/src/modules/legal-case/legal-case.service.ts
apps/api/src/modules/legal-case/dto/create-legal-case.dto.ts
apps/api/src/modules/legal-case/dto/update-legal-case.dto.ts
apps/api/src/modules/legal-case/legal-case.service.spec.ts
apps/api/src/modules/overdue/my-today-kpi.service.ts
apps/api/src/modules/overdue/customer-insights.service.ts
apps/api/src/modules/overdue/analytics-recovery.service.ts
apps/api/src/modules/customers/skip-tracing.service.ts
```

### Files to modify
```
apps/api/prisma/schema.prisma                                        — LegalCase + LegalCaseDocument models, CallLog.voiceMemoUrl + voiceMemoTier
apps/api/src/modules/overdue/overdue.controller.ts                  — 4 new endpoints
apps/api/src/modules/customers/customers.controller.ts              — update-contact endpoint
apps/api/src/modules/overdue/analytics.service.ts                   — recovery by channel
apps/web/src/pages/CollectionsPage/index.tsx                        — DailyProgressStrip in header
apps/web/src/pages/CollectionsPage/components/BulkActionBar.tsx     — batch copy button
apps/web/src/pages/CollectionsPage/components/ContactLogDialog.tsx  — voice memo recorder
apps/web/src/pages/CollectionsPage/components/Customer360Panel.tsx  — SmartCustomerPanel + Related Contracts tab + LegalCaseBanner
apps/web/src/pages/CollectionsPage/components/Customer360Timeline.tsx — voice memo playback inline
apps/web/src/pages/CollectionsPage/components/ContractCard.tsx      — "หาเบอร์ใหม่" button when needsSkipTracing
apps/web/src/pages/CollectionsPage/tabs/AnalyticsTab.tsx            — RecoveryByChannelChart + Workload section (OWNER)
```

---

## Task 1: Daily Progress Header (B4)

**Files:**
- Create: `apps/api/src/modules/overdue/my-today-kpi.service.ts`
- Modify: `apps/api/src/modules/overdue/overdue.controller.ts` (add endpoint)
- Create: `apps/web/src/pages/CollectionsPage/hooks/useMyTodayKpi.ts`
- Create: `apps/web/src/pages/CollectionsPage/components/DailyProgressStrip.tsx`
- Modify: `apps/web/src/pages/CollectionsPage/index.tsx`

- [ ] **Step 1: Backend service + endpoint**

Service returns:
```ts
{
  callsToday: number;
  callsTarget: number; // from systemConfig or per-user setting (P3)
  lineSentToday: number;
  promisesKeptToday: number;
  collectedTodayBaht: number; // from Payment.amountPaid where createdByUserId=self AND createdAt=today
}
```

Use `bangkokStartOfDay` helper from `apps/api/src/utils/date.util.ts` (created in #685).

Endpoint: `GET /overdue/kpi/my-today` with roles all-authenticated (OWNER sees aggregate + own toggle).

- [ ] **Step 2: Frontend hook + strip component**

`DailyProgressStrip.tsx` renders 4 chips with lucide icons (Phone, MessageCircle, HandShake, CircleDollarSign). Click chip → filter Queue by relevant criteria.

Poll every 5 min via React Query `refetchInterval: 5 * 60_000`.

- [ ] **Step 3: Wire into CollectionsPage header**

Above tabs, below PageHeader title.

- [ ] **Step 4: Type check + commit**

```bash
git commit -m "feat(collections): daily progress mini-KPI strip on header"
```

---

## Task 2: Batch Copy Phones (B5)

**Files:**
- Modify: `apps/web/src/pages/CollectionsPage/components/BulkActionBar.tsx`

- [ ] **Step 1: Add "Copy เบอร์" button**

```tsx
import { Copy } from 'lucide-react';

<Button
  variant="outline"
  size="sm"
  onClick={() => {
    const phones = selectedContracts.map((c) => c.customer?.phone).filter(Boolean).join(', ');
    navigator.clipboard.writeText(phones);
    toast.success(`คัดลอก ${selectedContracts.length} เบอร์แล้ว`);
  }}
>
  <Copy className="mr-1 h-4 w-4" /> Copy เบอร์
</Button>
```

- [ ] **Step 2: Commit**

```bash
git commit -m "feat(collections): bulk copy phone numbers to clipboard"
```

---

## Task 3: Voice Memo Infrastructure (C3 schema + S3 Glacier)

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create migration
- Configure S3 bucket lifecycle (external — document in runbook)

- [ ] **Step 1: Add fields to CallLog**

```prisma
model CallLog {
  // ... existing fields ...
  voiceMemoUrl String?
  voiceMemoTier String? @default("HOT") // 'HOT' | 'GLACIER'
  voiceMemoGlacierRestoreExpiresAt DateTime?
}
```

- [ ] **Step 2: Migration**

```bash
cd apps/api && npx prisma migrate dev --name add_call_log_voice_memo
```

- [ ] **Step 3: S3 lifecycle configuration (document in runbook)**

Create/update `docs/guides/S3-LIFECYCLE.md`:
```markdown
# S3 Bucket Lifecycle Rules

## Voice Memos (prefix: `voice-memos/`)

- Transition to Glacier after 90 days
- Delete after 730 days (2 years)

## GCS configuration example
[provide gsutil command or console steps]
```

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(schema): CallLog.voiceMemoUrl + voiceMemoTier for tiered storage"
```

---

## Task 4: Voice Memo Recording UI (C3)

**Files:**
- Create: `apps/web/src/pages/CollectionsPage/hooks/useMediaRecorder.ts`
- Create: `apps/web/src/pages/CollectionsPage/components/VoiceMemoRecorder.tsx`
- Create: `apps/web/src/pages/CollectionsPage/components/VoiceMemoPlayback.tsx`
- Modify: `apps/web/src/pages/CollectionsPage/components/ContactLogDialog.tsx`
- Modify: `apps/web/src/pages/CollectionsPage/components/Customer360Timeline.tsx`

- [ ] **Step 1: useMediaRecorder hook**

Wraps `navigator.mediaDevices.getUserMedia({ audio: true })` + `MediaRecorder`. Returns:
- `startRecording()`, `stopRecording()`, `clearRecording()`
- `isRecording: boolean`
- `audioBlob: Blob | null`
- `duration: number` (seconds)
- Max 60s auto-stop
- Permission denied → throw + user-friendly toast

- [ ] **Step 2: VoiceMemoRecorder component**

In ContactLogDialog: Mic button → record state UI (waveform optional, MVP just countdown) → preview play → upload to S3 via presigned URL → store URL in CallLog voiceMemoUrl.

- [ ] **Step 3: VoiceMemoPlayback in timeline**

Customer 360 Timeline: if event has `voiceMemoUrl`, show `<audio controls>`. If `voiceMemoTier === 'GLACIER'`: show "Request restore" button + "ไฟล์เก็บในคลัง ใช้เวลา ~4 ชม."

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(collections): voice memo recording + tiered storage playback"
```

---

## Task 5: Smart Customer Data Panel (C4)

**Files:**
- Create: `apps/api/src/modules/overdue/customer-insights.service.ts`
- Modify: `apps/api/src/modules/overdue/overdue.controller.ts`
- Create: `apps/web/src/pages/CollectionsPage/components/SmartCustomerPanel.tsx`
- Create: `apps/web/src/pages/CollectionsPage/components/RelatedContractsTab.tsx`
- Modify: `apps/web/src/pages/CollectionsPage/components/Customer360Panel.tsx`

- [ ] **Step 1: customer-insights service**

Endpoint: `GET /customers/:id/insights` returns:
```ts
{
  preferredContactTime: 'MORNING' | 'AFTERNOON' | 'EVENING' | null;
  preferredChannel: 'LINE' | 'SMS' | 'CALL' | null;
  channelResponseRates: Record<'LINE' | 'SMS' | 'CALL', number>; // 0-100%
  lineOnlineAt: Date | null; // from CHATCONE if available
}
```

Compute from CallLog (group by hour bucket, count ANSWERED), DunningAction (response count / total per channel).

- [ ] **Step 2: SmartCustomerPanel**

3 badges on Customer 360 header below name:
- รับสายบ่อย: Morning/Afternoon/Evening + icon
- ช่องทาง response สูง: LINE/SMS/Call icon
- LINE online: green dot if within 5 min

- [ ] **Step 3: RelatedContractsTab**

New tab in Customer 360: list all contracts for same customerId with status chips, click row → switch to that contract's view.

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(collections): smart customer insights + related contracts tab"
```

---

## Task 6: Skip-Tracing Wizard (D6)

**Files:**
- Create: `apps/api/src/modules/customers/skip-tracing.service.ts`
- Modify: `apps/api/src/modules/customers/customers.controller.ts`
- Create: `apps/web/src/pages/CollectionsPage/components/SkipTracingWizard.tsx`
- Modify: `apps/web/src/pages/CollectionsPage/components/ContractCard.tsx`
- Modify: `apps/api/prisma/schema.prisma` (add `CustomerStatus.LOST` enum value if missing)

- [ ] **Step 1: Customer status enum**

```prisma
enum CustomerStatus {
  ACTIVE
  INACTIVE
  LOST // new
}
```

- [ ] **Step 2: skip-tracing service + endpoint**

Endpoint: `POST /customers/:id/update-contact` (Thai-validated DTO)
- Accepts: new phone / new LINE ID / tagged as LOST
- Audit log event `SKIP_TRACING_UPDATE`

- [ ] **Step 3: SkipTracingWizard**

4-step dialog:
1. Emergency contact display (from customer profile) + "โทร emergency" tel: link
2. New phone/LINE input → validate + update
3. Social media check manual (link to Facebook search with name pre-filled)
4. Result: found / not found / tag LOST

Card "หาเบอร์ใหม่" button only when `needsSkipTracing === true`.

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(collections): skip-tracing guided wizard for unreachable customers"
```

---

## Task 7: Court Case Attachment (D8)

**Files:**
- Create: `apps/api/src/modules/legal-case/` module
- Modify: `apps/api/prisma/schema.prisma` (LegalCase + LegalCaseDocument models)
- Create: `apps/web/src/pages/CollectionsPage/components/LegalCaseDialog.tsx`
- Create: `apps/web/src/pages/CollectionsPage/components/LegalCaseBanner.tsx`
- Modify: `apps/web/src/pages/CollectionsPage/components/Customer360Panel.tsx`

- [ ] **Step 1: Schema**

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
  notes String?
  documents LegalCaseDocument[]
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  deletedAt DateTime?
  @@index([contractId])
}

model LegalCaseDocument {
  id String @id @default(uuid())
  legalCaseId String
  legalCase LegalCase @relation(fields: [legalCaseId], references: [id])
  kind String // complaint|summons|judgment|settlement|other
  filename String
  s3Url String
  uploadedAt DateTime @default(now())
  uploadedByUserId String
  uploadedBy User @relation(fields: [uploadedByUserId], references: [id])
}
```

- [ ] **Step 2: Module with CRUD + document upload**

Endpoints: CRUD on `/legal-cases`, document upload via S3 presigned URL.

Role gate: OWNER + FINANCE_MANAGER only.

- [ ] **Step 3: LegalCaseBanner + Dialog**

- Banner appears on Customer 360 when `contract.status === 'LEGAL'`:
  - If no LegalCase: "เพิ่มข้อมูลคดี" button → opens dialog
  - If LegalCase exists: "ดูคดี" button → opens read-only view + edit
- Dialog fields: เลขคดี, ศาล, วันนัด, ทนายความ+เบอร์, documents (multi-upload PDF max 10MB each), notes

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(collections): LegalCase + document attachments for LEGAL-status contracts"
```

---

## Task 8: Recovery Rate by Channel (E3)

**Files:**
- Create: `apps/api/src/modules/overdue/analytics-recovery.service.ts`
- Modify: `apps/api/src/modules/overdue/overdue.controller.ts`
- Create: `apps/web/src/pages/CollectionsPage/tabs/AnalyticsTab/RecoveryByChannelChart.tsx`
- Modify: `apps/web/src/pages/CollectionsPage/tabs/AnalyticsTab.tsx`

- [ ] **Step 1: analytics-recovery service**

Compute:
- For each DunningAction in date range, check if associated contract received Payment within 7 days after `sentAt`
- Group by channel: LINE / SMS / CALL / LETTER
- Output: `{ channel, actionsSent, recovered, recoveryRate, avgRecoveryAmount }[]`

Endpoint: `GET /overdue/analytics/recovery?from=X&to=Y`

- [ ] **Step 2: RecoveryByChannelChart**

Grouped bar chart (recharts): x = channel, y-left = recovery rate %, y-right = avg amount ฿. Legend + tooltip Thai.

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(analytics): recovery rate by dunning channel"
```

---

## Task 9: Workload Redistribution DnD (E5) — OWNER only

**Files:**
- Create: `apps/web/src/pages/CollectionsPage/components/WorkloadGrid.tsx`
- Create: `apps/web/src/pages/CollectionsPage/hooks/useWorkloadGrid.ts`
- Modify: `apps/web/src/pages/CollectionsPage/tabs/AnalyticsTab.tsx`
- Install: `@hello-pangea/dnd` (successor to react-beautiful-dnd) — check bundle impact

- [ ] **Step 1: Install DnD library**

```bash
cd apps/web && npm install @hello-pangea/dnd
```

Check bundle size increase (`npm run build -- --mode analyze`).

- [ ] **Step 2: WorkloadGrid component**

Grid: columns = collectors (name + count), rows = draggable contract cards.

Drag card between columns → call `PATCH /contracts/:id/assign` with new `assignedToId`.

Multi-select via Shift+click, drop entire selection at once.

"Auto-balance" button: divide contracts evenly via round-robin POST.

- [ ] **Step 3: Add to AnalyticsTab (OWNER-only)**

Section under Leaderboard (P1 Task 16):
```tsx
{user?.role === 'OWNER' && <WorkloadGrid />}
```

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(analytics): workload redistribution drag-drop grid (OWNER only)"
```

---

## Final Verification

- [ ] Full test suite pass
- [ ] E2E smoke (voice record, skip-tracing wizard, legal case creation)
- [ ] Bundle size review (@hello-pangea/dnd adds ~30KB gz)
- [ ] S3 Glacier lifecycle verified in staging
- [ ] Cron / scheduled jobs for P2: none (analytics are query-time)
- [ ] Push + PR

---

## Self-Review Checklist

### Spec Coverage
- [x] B4 Daily progress → Task 1
- [x] B5 Batch copy → Task 2
- [x] C3 Voice memo → Task 3+4
- [x] C4 Smart customer data → Task 5
- [x] D6 Skip-tracing wizard → Task 6
- [x] D8 Court case attachment → Task 7
- [x] E3 Recovery by channel → Task 8
- [x] E5 Workload DnD → Task 9

Coverage 8/8 ✅

### Placeholder scan
- Task 1-9 ใช้ summary format (similar to P1 Tasks 6-18). Implementation agent ขยาย bite-sized per task

---

## Execution Handoff

Plan saved to `docs/superpowers/plans/2026-04-25-collections-ui-p2.md`. Execution เริ่มหลัง P1 ship:

**Subagent-Driven** (แนะนำ) — 7 parallel clusters feasible after Task 3 schema migration
