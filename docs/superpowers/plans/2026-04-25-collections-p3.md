# Collections P3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to execute. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship 19 P3 features per `docs/superpowers/specs/2026-04-25-collections-p3-design.md` — close-loop fixes (A2/A3), productivity (B2/B3), intelligence (C1+dunning, C2), reporting (D1, D2), SMS template management (E2), and bundled tech debt cleanup (Z1-Z10)

**Architecture:** Build on P0+P1+P2 foundation. New schemas: CustomerTag, LateFeeWaiverRequest, SmsTemplate, DunningRule extension for tag conditions, Settings.pdf_report_recipients. New crons: customer-tag-recompute (daily 01:00), pdf-report-weekly (Monday 08:00). Reuse existing components: DateRangePicker, FilterDrawer, useUndoMutation, KeyboardShortcuts, SmartCustomerPanel, DunningRule engine

**Tech Stack:** เหมือน P0/P1/P2 + jspdf+html2canvas (already in deps for legal letters), nodemailer/SendGrid (verify email service exists), AWS SDK S3 RestoreObjectCommand (for A3 Glacier)

**Working Branch:** `feat/collections-ui-p3` (create from P2 merged state)

**Depends on:** P0+P1+P2 plans shipped + merged

---

## Scope & Task Order

13 task units after consolidating 19 features:

| # | Task | Cluster | Notes |
|---|------|---------|-------|
| T1 | Setup schemas (consolidated) | foundation | CustomerTag, LateFeeWaiverRequest, SmsTemplate, DunningRule extension, Settings field |
| T2 | A2 Auto-balance exclusions | α | snoozed/legal/recently-assigned filter |
| T3 | A3 Voice memo Glacier real | α | RestoreObjectCommand (mark TODO if infra not deployed) |
| T4 | B2 LINE chat in Customer 360 | β | embed last 30 messages + send inline |
| T5 | B3 Late fee waiver workflow | β | request → ApprovalTab → OWNER approve → journal adjust |
| T6 | C1 Customer tags backend (CRUD + cron) | γ | tag service + auto-tag cron + manual button endpoint |
| T7 | C1 Tags affect dunning | γ | extend DunningRule resolver with tag conditions |
| T8 | C1 Tags frontend (UI + filter + manual override) | γ | chips on card, filter, Customer 360 manual UI |
| T9 | C2 Next-best-action recommendation | γ | rule-based, surface as chip on card |
| T10 | D1 PDF export (button + cron + email) | δ | weekly Monday 08:00 + on-demand button |
| T11 | D2 Compliance dashboard | δ | PDPA freq + LEGAL pipeline + audit summary + retention |
| T12 | E2 SMS template management UI | ε | settings page + template CRUD + preview + A/B |
| T13 | Z1-Z10 tech debt cleanup (bundled) | ζ | 10 items, 1 PR |

**Cluster strategy** (after T1 setup serial):
- α: T2 + T3 → 1 agent
- β: T4 + T5 → 1 agent (different files, could split — keep together for review efficiency)
- γ: T6 + T7 + T8 + T9 → 1 agent (all customer-tag related, share schema)
- δ: T10 + T11 → 1 agent
- ε: T12 → 1 agent
- ζ: T13 → 1 agent

= 6 parallel clusters after T1 setup. Estimate 4-5 days wall clock with parallelism

---

## File Structure

### New schema files
```
apps/api/prisma/schema.prisma                        — 3 new models + DunningRule extension + Settings field
apps/api/prisma/migrations/202604XXXX_add_p3_schema/migration.sql
```

### New backend files
```
apps/api/src/modules/customer-tags/customer-tags.module.ts
apps/api/src/modules/customer-tags/customer-tags.controller.ts
apps/api/src/modules/customer-tags/customer-tags.service.ts
apps/api/src/modules/customer-tags/customer-tags.service.spec.ts
apps/api/src/modules/customer-tags/customer-tag-recompute.cron.ts
apps/api/src/modules/customer-tags/dto/{create-tag,recompute}.dto.ts
apps/api/src/modules/late-fee-waiver/late-fee-waiver.module.ts
apps/api/src/modules/late-fee-waiver/late-fee-waiver.controller.ts
apps/api/src/modules/late-fee-waiver/late-fee-waiver.service.ts
apps/api/src/modules/late-fee-waiver/late-fee-waiver.service.spec.ts
apps/api/src/modules/late-fee-waiver/dto/{create-request,approve-reject}.dto.ts
apps/api/src/modules/sms-templates/sms-templates.module.ts
apps/api/src/modules/sms-templates/sms-templates.controller.ts
apps/api/src/modules/sms-templates/sms-templates.service.ts
apps/api/src/modules/sms-templates/dto/{create,update}.dto.ts
apps/api/src/modules/overdue/next-best-action.service.ts
apps/api/src/modules/overdue/auto-balance.service.ts (extend or new)
apps/api/src/modules/storage/voice-memo-restore.service.ts (extend stub from P2)
apps/api/src/modules/reporting/reporting.module.ts
apps/api/src/modules/reporting/pdf-report.service.ts
apps/api/src/modules/reporting/pdf-report-weekly.cron.ts
apps/api/src/modules/reporting/compliance.service.ts
apps/api/src/modules/dunning/dunning-rule-resolver.service.ts (extend with tag conditions)
```

### New frontend files
```
apps/web/src/pages/CollectionsPage/components/CustomerTagChips.tsx
apps/web/src/pages/CollectionsPage/components/CustomerTagDialog.tsx (manual add/remove)
apps/web/src/pages/CollectionsPage/components/NextBestActionChip.tsx
apps/web/src/pages/CollectionsPage/components/LineChatPanel.tsx
apps/web/src/pages/CollectionsPage/components/LateFeeWaiverDialog.tsx
apps/web/src/pages/CollectionsPage/components/LateFeeWaiverApprovalRow.tsx
apps/web/src/pages/CollectionsPage/components/PdfExportButton.tsx
apps/web/src/pages/CollectionsPage/tabs/AnalyticsTab/ComplianceDashboardSection.tsx
apps/web/src/pages/CollectionsPage/hooks/useCustomerTags.ts
apps/web/src/pages/CollectionsPage/hooks/useLateFeeWaiver.ts
apps/web/src/pages/CollectionsPage/hooks/useLineChatPanel.ts
apps/web/src/pages/CollectionsPage/hooks/usePdfExport.ts
apps/web/src/pages/CollectionsPage/hooks/useCompliance.ts
apps/web/src/pages/SmsTemplatesPage.tsx (new route /settings/sms-templates)
apps/web/src/pages/SmsTemplatesPage/components/SmsTemplateForm.tsx
apps/web/src/pages/SmsTemplatesPage/components/SmsTemplatePreview.tsx
apps/web/src/pages/SmsTemplatesPage/hooks/useSmsTemplates.ts
```

### Files to modify
```
apps/api/prisma/schema.prisma — see above
apps/api/src/modules/overdue/queue.service.ts — surface tag chips + next-best-action in row
apps/api/src/modules/overdue/dto/queue-query.dto.ts — add tag filter field
apps/api/src/modules/overdue/overdue.controller.ts — auto-balance endpoint extension
apps/api/src/modules/overdue/auto-balance.service.ts — add exclusion filters
apps/api/src/modules/dunning/dunning.engine.ts — call tag-condition resolver before dispatch
apps/api/src/modules/storage/voice-memo-restore.controller.ts — wire real RestoreObjectCommand
apps/api/src/app.module.ts — register CustomerTagsModule, LateFeeWaiverModule, SmsTemplatesModule, ReportingModule
apps/web/src/pages/CollectionsPage/components/ContractCard.tsx — render CustomerTagChips + NextBestActionChip
apps/web/src/pages/CollectionsPage/components/Customer360Panel.tsx — LineChatPanel tab + LateFeeWaiverDialog button + tag manual UI
apps/web/src/pages/CollectionsPage/components/ApprovalPendingRow.tsx — late fee waiver requests section
apps/web/src/pages/CollectionsPage/components/FilterDrawer.tsx — add tag filter section
apps/web/src/pages/CollectionsPage/components/WorkloadGrid.tsx — auto-balance preview shows exclusions count
apps/web/src/pages/CollectionsPage/tabs/AnalyticsTab.tsx — ComplianceDashboardSection + PdfExportButton
apps/web/src/App.tsx — add /settings/sms-templates route
```

---

## Task 1: Setup Schemas (Consolidated)

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/202604XXXX_add_p3_schema/migration.sql`

- [ ] **Step 1: Add schema models + extensions**

Edit `apps/api/prisma/schema.prisma`:

```prisma
enum CustomerTagType {
  VIP
  HIGH_RISK
  NEW
  LOYAL
  BLACKLIST
}

enum CustomerTagSource {
  AUTO
  MANUAL
}

enum LateFeeWaiverStatus {
  PENDING
  APPROVED
  REJECTED
}

model CustomerTag {
  id String @id @default(uuid())
  customerId String
  customer Customer @relation(fields: [customerId], references: [id])
  tag CustomerTagType
  source CustomerTagSource
  reason String?
  appliedByUserId String?
  appliedBy User? @relation("CustomerTagAppliedBy", fields: [appliedByUserId], references: [id])
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  deletedAt DateTime?
  @@unique([customerId, tag, deletedAt])
  @@index([tag])
  @@index([customerId])
}

model LateFeeWaiverRequest {
  id String @id @default(uuid())
  contractId String
  contract Contract @relation(fields: [contractId], references: [id])
  paymentIds String[] // array of Payment.id whose late fees to waive
  reason String
  totalWaiveAmount Decimal @db.Decimal(12, 2)
  status LateFeeWaiverStatus @default(PENDING)
  requesterUserId String
  requester User @relation("LateFeeWaiverRequester", fields: [requesterUserId], references: [id])
  approverUserId String?
  approver User? @relation("LateFeeWaiverApprover", fields: [approverUserId], references: [id])
  approvedAt DateTime?
  rejectedReason String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  deletedAt DateTime?
  @@index([status, createdAt])
  @@index([contractId])
}

model SmsTemplate {
  id String @id @default(uuid())
  name String @unique
  channel String // 'SMS' | 'LINE'
  subject String?
  body String // with {{variable}} placeholders
  variables Json // [{ name: 'customerName', label: 'ชื่อลูกค้า' }, ...]
  active Boolean @default(true)
  variantOf String? // for A/B test, points to parent template id
  parent SmsTemplate? @relation("SmsTemplateVariants", fields: [variantOf], references: [id])
  variants SmsTemplate[] @relation("SmsTemplateVariants")
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  deletedAt DateTime?
  @@index([channel, active])
}

// Extend existing DunningRule for tag conditions
model DunningRule {
  // ... existing fields ...
  tagConditions Json? // { skipForTags: ['VIP'], delayDaysForTags: { VIP: 3 }, immediateForTags: ['BLACKLIST'] }
}

// Add Settings entry (if Setting/SystemConfig model exists, just document key)
// Setting key: 'pdf_report_recipients' value: 'owner@bestchoice.com,finance@bestchoice.com'
// (Implemented as new row in existing SystemConfig table — no schema change needed if SystemConfig is key/value)
```

Add back-relations:
```prisma
model Customer {
  // ...
  tags CustomerTag[]
}
model User {
  // ...
  appliedTags CustomerTag[] @relation("CustomerTagAppliedBy")
  lateFeeWaiverRequests LateFeeWaiverRequest[] @relation("LateFeeWaiverRequester")
  approvedLateFeeWaivers LateFeeWaiverRequest[] @relation("LateFeeWaiverApprover")
}
model Contract {
  // ...
  lateFeeWaiverRequests LateFeeWaiverRequest[]
}
```

- [ ] **Step 2: Generate migration**

Run:
```bash
cd apps/api && npx prisma migrate dev --name add_p3_schema_tags_waiver_sms_dunning --create-only
```
If interactive fails (P1/P2 had this issue), write SQL by hand at `apps/api/prisma/migrations/202604XXXX_add_p3_schema/migration.sql`:
- CREATE TYPE CustomerTagType, CustomerTagSource, LateFeeWaiverStatus
- CREATE TABLE customer_tags (with indexes + FKs)
- CREATE TABLE late_fee_waiver_requests
- CREATE TABLE sms_templates
- ALTER TABLE dunning_rules ADD COLUMN tag_conditions JSONB

Apply:
```bash
cd apps/api && npx prisma migrate deploy && npx prisma generate
```

- [ ] **Step 3: Type check**

Run: `./tools/check-types.sh api`
Expected: `API: OK`

- [ ] **Step 4: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations/
git commit -m "$(cat <<'EOF'
feat(schema): P3 schema additions (CustomerTag, LateFeeWaiverRequest, SmsTemplate, DunningRule.tagConditions)

3 new models + DunningRule extension + 3 new enums.

CustomerTag: customer segmentation (VIP/HIGH_RISK/NEW/LOYAL/BLACKLIST), AUTO via cron + MANUAL via OWNER override
LateFeeWaiverRequest: collector → OWNER approval flow with audit trail
SmsTemplate: configurable LINE/SMS templates with A/B variant support
DunningRule.tagConditions: JSON field for skip/delay/immediate per tag

pdf_report_recipients setting added via SystemConfig key/value (no schema change).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Tasks 2-13 Summary

ด้วยขนาดของ plan, แต่ละ task ใช้ summary format. Implementation agent แตก bite-sized steps ตอนทำ TDD.

### Task 2: A2 Auto-balance Exclusions

**Files**: `apps/api/src/modules/overdue/auto-balance.service.ts` (or wherever auto-balance logic lives), `apps/web/src/pages/CollectionsPage/components/WorkloadGrid.tsx`

- Backend: extend auto-balance filter
  - Exclude `snoozes.some({ userId: prevAssigneeId, snoozedUntil > now, deletedAt: null })`
  - Exclude `status === 'LEGAL'`
  - Exclude `assignedAt > now - 24 hours` (recently moved, prevent thrashing)
- Frontend: AlertDialog (from P2 fix) shows preview "จะ rebalance N contracts (ยกเว้น snooze X / LEGAL Y / เพิ่งย้าย Z)"
- Endpoint stays same; just changes filter

**TDD**: 4 tests covering each exclusion + happy path

**Commit**: `feat(collections): auto-balance excludes snoozed + LEGAL + recently-assigned`

### Task 3: A3 Voice Memo Glacier Real

**Files**: `apps/api/src/modules/storage/voice-memo-restore.controller.ts` + `voice-memo-restore.service.ts` (extract logic to service)

- For S3-compatible: `import { RestoreObjectCommand } from '@aws-sdk/client-s3'` → `client.send(new RestoreObjectCommand({ Bucket, Key, RestoreRequest: { Days: 7, GlacierJobParameters: { Tier: 'Standard' } } }))`
- Update CallLog `voiceMemoTier` to indicate `RESTORE_IN_PROGRESS` + `voiceMemoGlacierRestoreExpiresAt = now + 7 days`
- Add cron `voice-memo-restore-poll.cron.ts` (every hour) — for each in-progress, HeadObject check `Restore: 'ongoing-request="false"'`. When complete: set `voiceMemoTier = 'HOT'` + send notification to requester
- For GCS: equivalent via `bucket.file(key).setStorageClass('STANDARD')` (no async restore, immediate)

**Note**: ถ้า Glacier lifecycle ยังไม่ deploy production → endpoint ยัง stub ให้ test ผ่าน + log warning. Mark `// TODO: prod ready when lifecycle deploy`

**TDD**: 3 tests (request restore, poll status, complete restore)

**Commit**: `feat(storage): voice memo Glacier RestoreObjectCommand + poll cron`

### Task 4: B2 LINE Chat in Customer 360

**Files**: `apps/web/src/pages/CollectionsPage/components/LineChatPanel.tsx`, `apps/web/src/pages/CollectionsPage/hooks/useLineChatPanel.ts`, modify `Customer360Panel.tsx`

- Add new tab in Customer 360 "LINE chat" (only visible when customer has `lineId`)
- `useLineChatPanel(customerId)` — wrap existing `/chat/messages?customerId=X` endpoint (verify exists, add filter if not)
- Show last 30 messages, infinite scroll for older
- Inline send: textarea + send button → POST to existing `/chat/send` endpoint
- Polling: refetchInterval 30s
- Use existing chat message components if available (avoid duplicate UI)

**Commit**: `feat(collections): LINE chat panel embedded in Customer 360`

### Task 5: B3 Late Fee Waiver Workflow

**Backend**: `apps/api/src/modules/late-fee-waiver/` full module
- `POST /late-fee-waivers` — create request (collector role)
- `GET /late-fee-waivers?status=PENDING` — list (OWNER for queue)
- `POST /late-fee-waivers/:id/approve` — OWNER approve. Effects:
  - Set Payment.lateFee = 0 for affected payments (in $transaction)
  - Create journal entry adjustment (Dr. Late Fee Income / Cr. ... — discuss accountant) — for v1, skip journal adjust + add TODO to discuss
  - Update request status + approverUserId + approvedAt
  - Notify requester
- `POST /late-fee-waivers/:id/reject` — OWNER reject + reason → notify requester

**Frontend**:
- `LateFeeWaiverDialog.tsx` — Customer 360 button "ขอ waive ค่าปรับ" → dialog: select payments with late fees + reason → submit
- `LateFeeWaiverApprovalRow.tsx` — section in ApprovalTab listing PENDING requests with approve/reject buttons
- Hook `useLateFeeWaiver`

**TDD**: 5 tests (create, approve, reject, only-pending-can-be-approved, late-fee-actually-zeroed)

**Commit**: `feat(collections): late fee waiver request → approval workflow`

### Task 6: C1 Customer Tags Backend

**Files**: `apps/api/src/modules/customer-tags/` full module + cron

- Service methods:
  - `applyTag(customerId, tag, source, reason?, userId?)` — check unique constraint, soft-delete prior if reapplying
  - `removeTag(customerId, tag, userId)` — soft-delete
  - `listForCustomer(customerId)` — return active tags
  - `recomputeForCustomer(customerId)` — apply auto-tag rules (used by both cron + manual button)
  - `recomputeAll()` — for cron, batch process

- Auto-tag rules:
  - VIP: customer has `contracts.length >= 3` AND zero `BROKEN_PROMISE` audits last 12 months
  - HIGH_RISK: ≥3 BROKEN_PROMISE audits last 90 days
  - NEW: first contract `createdAt` < 30 days ago
  - LOYAL: customer `createdAt` > 2 years ago AND zero BROKEN_PROMISE lifetime
  - BLACKLIST: manual only — never auto-apply

- Cron `customer-tag-recompute.cron.ts` — `@Cron('0 18 * * *', { timeZone: 'Asia/Bangkok' })` (= 01:00 Bangkok). Wraps `recomputeAll()` in try/catch + Sentry

- Endpoints:
  - `GET /customer-tags?customerId=X`
  - `POST /customer-tags` (manual)
  - `DELETE /customer-tags/:id` (manual remove)
  - `POST /customer-tags/recompute/:customerId` (manual button trigger)

- Roles: list/recompute = all, create/delete manual = OWNER + FINANCE_MANAGER

**TDD**: 8 tests (auto-tag rules each + manual + recompute)

**Commit**: `feat(customer-tags): tag service + auto-tag cron + manual override endpoints`

### Task 7: C1 Tags Affect Dunning

**Files**: `apps/api/src/modules/dunning/dunning-rule-resolver.service.ts` (extend or create), `apps/api/src/modules/dunning/dunning.engine.ts` (call resolver)

- Resolver function: given contract + ruleset, return effective rule applying tag conditions
  - If customer has `BLACKLIST` tag → use most aggressive rule, no delay
  - If customer has `HIGH_RISK` tag → skip soft templates, jump to firm
  - If customer has `VIP` tag → add 3 days delay before LINE send

- DunningRule.tagConditions JSON shape:
  ```json
  {
    "skipForTags": [],          // skip rule entirely if any tag matches
    "delayDaysForTags": { "VIP": 3 },  // add days to scheduled send
    "immediateForTags": ["BLACKLIST"], // ignore wait time, send now
    "skipSoftForTags": ["HIGH_RISK"]   // skip soft variant, use firm
  }
  ```

- Update existing dunning execution to call resolver before send

**TDD**: 6 tests (each tag condition + combinations + no-match passthrough)

**Commit**: `feat(dunning): tag conditions on DunningRule (VIP delay / HIGH_RISK firm / BLACKLIST immediate)`

### Task 8: C1 Tags Frontend

**Files**:
- `CustomerTagChips.tsx` — chip row showing tags with color coding (use semantic tokens not hardcoded)
- `CustomerTagDialog.tsx` — Customer 360 button "จัดการ Tags" → list current + add/remove (OWNER only)
- `useCustomerTags.ts` — hooks
- Modify `ContractCard.tsx` — render CustomerTagChips inline with other indicators
- Modify `FilterDrawer.tsx` — add Tag filter section (multi-select + include/exclude toggle)
- Modify `Customer360Panel.tsx` — Tags chip row + "Recompute tags" button (calls `/customer-tags/recompute/:customerId`)

**TDD**: snapshot tests for chip rendering, role-gate tests for manual override

**Commit**: `feat(collections): customer tag chips + filter + manual override UI`

### Task 9: C2 Next-Best-Action

**Files**: `apps/api/src/modules/overdue/next-best-action.service.ts`, `apps/web/src/pages/CollectionsPage/components/NextBestActionChip.tsx`

- Backend rule-based service:
  - Input: enriched ContractRow (incl. preferredContactTime, lineLastSeen, brokenPromiseCount, daysOverdue, mdmState, lastChannel)
  - Output: `{ type: 'CALL' | 'SEND_LINE' | 'SEND_LETTER' | 'PROPOSE_LOCK' | 'NOOP', label: string, reason: string }`
  - Rules in order (first match wins):
    1. preferredContactTime matches current hour bucket → CALL
    2. preferredChannel = LINE AND lineLastSeen < 1h → SEND_LINE
    3. brokenPromiseCount >= 2 AND no firm letter sent → SEND_LETTER (firm)
    4. daysOverdue > 60 AND mdmState = NONE → PROPOSE_LOCK
    5. else → NOOP

- Surface in queue.service enrichment: add `nextBestAction` field to row
- Frontend chip with Lightbulb icon: clicking chip opens relevant dialog (CALL → ContactLogDialog, SEND_LINE → SendLineAdHocDialog, etc.)

**TDD**: 6 tests (each rule branch + tie-breaker)

**Commit**: `feat(collections): next-best-action recommendation chip (rule-based)`

### Task 10: D1 PDF Export

**Files**: `apps/api/src/modules/reporting/` full module, `apps/web/src/pages/CollectionsPage/components/PdfExportButton.tsx`

- Backend:
  - Service `pdf-report.service.ts`:
    - `generate(dateRange, branchId?)` — use jspdf+html2canvas to compose PDF
    - Cover page + KPI strip + aging chart + leaderboard + recovery rate + stuck contracts + letter dispatch + promise trend
  - Cron `pdf-report-weekly.cron.ts` — `@Cron('0 1 * * 1', { timeZone: 'Asia/Bangkok' })` (= Monday 08:00 Bangkok). Read `pdf_report_recipients` from SystemConfig, generate PDF, email via existing email service
  - Endpoint `POST /reporting/pdf?from=X&to=Y` — on-demand generation, returns PDF stream
  - Endpoint `GET /reporting/recipients` + `PUT /reporting/recipients` — manage recipient list (OWNER only)

- Frontend:
  - PdfExportButton on AnalyticsTab — opens DateRangePicker + downloads PDF
  - SettingsPage section for managing recipients (or new `/settings/reports` route — TBD with owner)

**Email service**: verify existing email service in codebase. If not, add nodemailer SMTP config or SendGrid

**TDD**: 3 tests (cron schedule, on-demand generate, recipient management role-gate)

**Commit**: `feat(reporting): weekly PDF analytics report + on-demand export + recipient settings`

### Task 11: D2 Compliance Dashboard

**Files**: `apps/api/src/modules/reporting/compliance.service.ts` (extend), `apps/web/src/pages/CollectionsPage/tabs/AnalyticsTab/ComplianceDashboardSection.tsx`

- Backend:
  - `GET /reporting/compliance/dunning-frequency` — list contracts with > 4 dunning actions in past 30 days (configurable threshold)
  - `GET /reporting/compliance/legal-pipeline` — list LEGAL contracts with hearing date in 7/14/30 days
  - `GET /reporting/compliance/audit-summary?period=week` — aggregated: actions per user, per type, anomalies (cross-branch attempts)
  - `GET /reporting/compliance/voice-memo-retention` — voice memos eligible for Glacier transition / deletion (depends on Task 3)

- Frontend:
  - New section in AnalyticsTab (OWNER + FINANCE_MANAGER only)
  - 4 cards: PDPA flag count / LEGAL hearings upcoming / audit anomalies / retention pending
  - Click card → open detail dialog with table

**TDD**: 4 tests (each endpoint)

**Commit**: `feat(reporting): compliance dashboard (PDPA + LEGAL pipeline + audit anomalies + retention)`

### Task 12: E2 SMS Template Management

**Files**: `apps/api/src/modules/sms-templates/` full module, `apps/web/src/pages/SmsTemplatesPage.tsx` + components

- Backend CRUD endpoints (OWNER + FINANCE_MANAGER):
  - GET /sms-templates (with channel filter)
  - POST /sms-templates
  - PATCH /sms-templates/:id
  - DELETE /sms-templates/:id (soft-delete)
  - POST /sms-templates/:id/preview (server-side render with sample data)
  - POST /sms-templates/:id/variant (create A/B variant linked to parent)

- Frontend page `/settings/sms-templates`:
  - List view: table of templates (name / channel / active / variant of)
  - Form: name + channel + body textarea + variable picker buttons (insert `{{customerName}}` etc.)
  - Preview pane: render with sample data (right of form)
  - A/B test toggle: enable variant tracking

- Update DunningRule editor (existing) to reference SmsTemplate by name instead of inline body — backward compat: keep body field, prefer templateName if set

**TDD**: 5 tests (CRUD + preview render + variant linkage)

**Commit**: `feat(sms-templates): admin UI for managing LINE/SMS templates with preview + A/B`

### Task 13: Z1-Z10 Tech Debt Cleanup (Bundled)

**Single commit**: `chore(collections): P3 tech debt cleanup bundle (Z1-Z10)`

- Z1 Semantic tokens: `apps/web/src/pages/CollectionsPage/utils/cardIndicators.ts` + grep for hardcoded `bg-emerald|amber|red|orange|purple-NNN` in CollectionsPage components → replace with semantic tokens (`bg-success`, `bg-warning`, `bg-destructive`, `bg-info`). Define missing tokens in `apps/web/src/index.css` if absent
- Z2 Type fixes: `enrichRows: any[]` → `Prisma.ContractGetPayload<typeof selectShape>[]`; `FilterDrawer.tsx:307 as any` → proper union
- Z3 BRANCH_MANAGER alignment: confirm with owner — either expand backend MDM approve `@Roles` to include BRANCH_MANAGER OR remove BRANCH_MANAGER from approval tab access. Decide and apply consistently
- Z4 OverduePage delete: refactor AllTab to inline relevant subset (or keep redirecting to /overdue-list new minimal route). Delete OverduePage.tsx
- Z5 10MB cap on S3 backend: add S3 POST policy `Conditions: [['content-length-range', 0, 10485760]]` (or PUT signed URL with `x-amz-content-length-range` if supported by SDK)
- Z6 Customer insights branch-scope: tighten SALES via `branchId` check on Customer.contracts.some
- Z7 Voice memo MIME validation harden: parse codec params, reject unknown codecs (`audio/webm;codecs=evil` → reject)
- Z8 PROPOSE_LOCK undo DELETE endpoint: add `DELETE /overdue/mdm-requests/:id` (OWNER + originator). Wire into useUndoMutation
- Z9 Mark undeliverable undo: add `POST /overdue/letters/:id/revert-undeliverable`. Wire into useUndoMutation
- Z10 lineResponse filter: add ChatMessage.deliveryStatus enum (DELIVERED/READ/IGNORED/BLOCKED). Update LINE webhook to populate. queue.service post-filter uses it for RESPONDED/IGNORED/BLOCKED

**Verify per Z item**: type check + relevant tests pass

---

## Final Verification

- [ ] `./tools/check-types.sh all` passes
- [ ] All new jest tests pass (filter-presets / customer-tags / late-fee-waiver / sms-templates / next-best-action / pdf-report / compliance / auto-balance)
- [ ] E2E smoke for /collections: tag chip renders, late fee waiver dialog opens, PDF export downloads, SMS template page accessible
- [ ] Cron jobs registered: customer-tag-recompute (01:00 BKK), pdf-report-weekly (Monday 08:00 BKK), voice-memo-restore-poll (hourly)
- [ ] Email service configured + recipient setting populated
- [ ] Bundle size impact reviewed (jspdf+html2canvas already in deps so minimal)
- [ ] Push branch + open PR

---

## Self-Review Checklist

### Spec coverage
- [x] A2 auto-balance exclusions → Task 2
- [x] A3 voice memo Glacier → Task 3
- [x] B2 LINE chat in 360 → Task 4
- [x] B3 late fee waiver → Task 5
- [x] C1 customer tags backend → Task 6
- [x] C1 tags affect dunning → Task 7
- [x] C1 tags frontend → Task 8
- [x] C2 next-best-action → Task 9
- [x] D1 PDF export → Task 10
- [x] D2 compliance dashboard → Task 11
- [x] E2 SMS template management → Task 12
- [x] Z1-Z10 tech debt → Task 13

Coverage 12 task units = 19 features ✅

### Placeholder scan
- Tasks 2-13 use summary format; implementation agents expand bite-sized per task with TDD
- Late fee waiver journal adjustment marked `// TODO: discuss with accountant` — acceptable defer
- Voice memo Glacier marked `// TODO: prod ready when lifecycle deploy` — acceptable defer

---

## Execution Handoff

Plan saved to `docs/superpowers/plans/2026-04-25-collections-p3.md`.

**Subagent-Driven** (default) — T1 setup serial → 6 parallel clusters (α/β/γ/δ/ε/ζ) → final review → fix → push

Estimated wall-clock with parallelism: **4-5 days**
