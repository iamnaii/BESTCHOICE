# Collections P3 — Design Spec

**Date**: 2026-04-25
**Scope**: Continuation of Collections UI work (post P0+P1+P2 ship). 6 clusters: close-loop, productivity, intelligence, reporting, integration, tech debt cleanup
**Author**: Brainstorming session post P2 PR creation
**Status**: Draft — pending user review on open questions

## Motivation

P0+P1+P2 (PRs #690-#692) ship 31 features. P3 builds on that foundation across 6 clusters:

1. **ปิดวงจร** (close-loop) — features ที่ P0/P1/P2 เริ่มแต่ไม่จบ (slip enforcement → no review queue, voice memo → restore stub, auto-balance → no exclusions)
2. **Productivity** — ลด routine work (CSV bulk payment, LINE chat in 360, late fee waiver)
3. **Intelligence** — แนะนำ + auto-tag + real-time
4. **Reporting** — OWNER/CFO PDF export + compliance dashboard
5. **External integration** — call recording + SMS template management
6. **Tech debt cleanup** — residual items from P0/P1/P2 reviews

## Scope

### In Scope (Clusters 1-6)

**Cluster 1: Close-loop (P3-α)**
- ~~A1 Slip Review Queue~~ — DROPPED 2026-04-25: QR via PaySolutions webhook = auto-confirm, no manual review needed
- A2 Auto-balance exclusions (snoozed/legal/recently-assigned)
- A3 Voice memo Glacier RestoreObjectCommand (real impl)

**Cluster 2: Productivity (P3-β)**
- ~~B1 Bulk Payment CSV Import~~ — DROPPED 2026-04-25: QR via PaySolutions = auto-confirm, no bank reconciliation needed
- B2 LINE chat history in Customer 360
- B3 Late Fee Waiver Workflow

**Cluster 3: Intelligence (P3-γ)**
- C1 Customer Segmentation Tags (rule-based + manual)
- C2 Next-Best-Action Recommendation (rule-based first, ML deferred)
- ~~C3 Real-time queue updates~~ — DEFERRED P4 2026-04-25: 5-min polling sufficient for team 5-10, infra risk vs. value mismatch

**Cluster 4: Reporting (P3-δ)**
- D1 Performance Analytics PDF Export (weekly/monthly auto-email)
- D2 Compliance Dashboard (PDPA dunning frequency + LEGAL pipeline + audit summary)

**Cluster 5: External Integration (P3-ε)**
- ~~E1 Call Recording Integration~~ — DEFERRED P4 2026-04-25: needs phone system decision (Twilio/3CX/Thai PBX); voice memo (P2) covers gap
- E2 SMS Template Management UI

**Cluster 6: Tech Debt Cleanup (P3-ζ)**
- Z1 Semantic tokens replace hardcoded Tailwind colors (cardIndicators.ts + ~5 spots)
- Z2 Type safety fixes (`any[]` in enrichRows, `as any` in FilterDrawer)
- Z3 BRANCH_MANAGER policy alignment (UI vs backend roles)
- Z4 OverduePage.tsx delete (refactor AllTab inline)
- Z5 10MB upload cap on S3 backend (currently GCS only)
- Z6 Customer insights branch-scope tightening
- Z7 Voice memo MIME validation harden (reject codec spoofing)
- Z8 PROPOSE_LOCK undo: actual DELETE endpoint (currently no reverse)
- Z9 Mark undeliverable undo: actual revert endpoint
- Z10 lineResponse RESPONDED/IGNORED/BLOCKED (needs LINE delivery state schema)

### Out of Scope
- D7 Payment Plan Renegotiation (defer to own spec — TFRS impact)
- ML-based predictive next-best-action (defer P4 — needs data + ML stack)
- LIFF customer-facing parity
- POS / Inventory / non-Collections pages
- New main navigation tabs

## Design Principles

1. **Close loops first** — finish P0/P1/P2 work before adding new
2. **OWNER+CFO insights** — Cluster 4 is monthly-value, prioritize
3. **Don't ML before data foundation** — start with rule-based recommendations, plan ML when data is rich (>3 months snapshot history)
4. **External integrations need infra discussion** — Cluster 5 may slip if PBX/SMS provider choice not finalized
5. **Tech debt sweep at end** — bundle cleanup into 1 PR (Cluster 6)

---

## Feature Clusters

### Cluster 1 — Close-Loop (P3-α)

#### ~~A1. Slip Review Queue~~ — DROPPED

**Reason** (decision 2026-04-25): ลูกค้าย้ายไปจ่ายผ่าน QR (PaySolutions) ทำให้ payment confirm อัตโนมัติผ่าน webhook ไม่ต้องมี slip review. P0 slip enforcement ยังคงไว้สำหรับ edge case (cash/bank transfer fallback) แต่ไม่ scale workflow ให้ accountant.

#### A2. Auto-balance Exclusions

**Problem**: P2 WorkloadGrid Auto-balance round-robins ALL contracts. Doesn't exclude snoozed (user-time-window), LEGAL (specialist-handled), recently-assigned (<24h).

**Backend**: `POST /contracts/auto-balance` (or wherever exists) — extend filter:
- Exclude `snoozes.some({ userId: <prevAssignee>, snoozedUntil > now })`
- Exclude `status === 'LEGAL'`
- Exclude `assignedAt > now - 24h`

**Frontend**: WorkloadGrid Auto-balance dialog shows preview "จะ rebalance N contracts (ยกเว้น snooze X, LEGAL Y, เพิ่งย้าย Z)" before confirm

**Priority**: P3-α-P1

#### A3. Voice Memo Real Glacier Restore

**Problem**: P2 voice memo restore endpoint returns stub `{ status: 'REQUESTED' }`. Doesn't call S3 RestoreObjectCommand.

**Backend**:
- Implement actual `RestoreObjectCommand` (S3 SDK) when storage is S3-compatible
- For GCS: use `objectAccessControls` + `lifecycle` API
- Update CallLog `voiceMemoTier` to indicate restore in-flight
- Cron poll restore status; when complete, set `voiceMemoTier = 'HOT'` + send notification to requester

**Prerequisite**: S3/GCS lifecycle policy deployed in production (currently documented in runbook but not deployed)

**Priority**: P3-α-P2 (depends on infra ready)

---

### Cluster 2 — Productivity (P3-β)

#### ~~B1. Bulk Payment CSV Import~~ — DROPPED

**Reason** (decision 2026-04-25): ลูกค้าจ่ายผ่าน QR (PaySolutions) → webhook auto-confirm payment ตรง bank reconciliation manual ไม่จำเป็น. P0 `/payments/import-csv` route ยังคงใช้ได้สำหรับ edge case แต่ไม่ลงทุน enhancement

#### B2. LINE Chat History in Customer 360

**Problem**: Collector ต้อง switch to /chat (separate page) for LINE history. Context loss + slow.

**UX**:
- New tab in Customer 360 — "LINE chat"
- Show last 30 messages (paginate older)
- Send message inline (reuse /chat send hook)
- New message arrival via SSE (Cluster 3 dependency) OR poll 30s
- Visible only if customer has `lineId`

**Backend**: existing `/chat/messages` endpoint should support `?customerId=X` filter — verify, add if needed

**Priority**: P3-β-P1

#### B3. Late Fee Waiver Workflow

**Problem**: Currently no path. Waiving late fees is ad-hoc by OWNER (manual DB edit OR direct refund).

**UX**:
- Customer 360 → "ขอ waive ค่าปรับ" button (collector-visible)
- Dialog: select payment installment(s) with late fees → reason → submit
- Goes to OWNER ApprovalTab queue (new section "Waiver requests")
- OWNER approve → late fee zeroed + journal entry adjustment + audit log
- OWNER reject → notify collector with reason

**Schema**: new model `LateFeeWaiverRequest { id, contractId, requesterUserId, paymentIds[], reason, status, approverUserId?, approvedAt?, rejectedReason?, createdAt, updatedAt, deletedAt }`

**Priority**: P3-β-P2 (lower — accountant says low frequency)

---

### Cluster 3 — Intelligence (P3-γ)

#### C1. Customer Segmentation Tags

**Tags**: VIP / ความเสี่ยงสูง / ใหม่ (อายุสัญญา <30 วัน) / ถาวร (ลูกค้าเก่า >2 ปี ไม่เคยผิดนัด) / blacklist

**Schema**: `CustomerTag` model
```prisma
model CustomerTag {
  id String @id @default(uuid())
  customerId String
  customer Customer @relation(fields: [customerId], references: [id])
  tag String // VIP|HIGH_RISK|NEW|LOYAL|BLACKLIST
  source String // 'AUTO' | 'MANUAL'
  reason String?
  appliedByUserId String?
  appliedBy User? @relation(fields: [appliedByUserId], references: [id])
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  deletedAt DateTime?
  @@unique([customerId, tag, deletedAt])
  @@index([tag])
}
```

**Auto-tag rules** (cron daily):
- VIP: contract count ≥ 3 AND no broken promises last 12 months
- HIGH_RISK: ≥3 broken promises last 90 days
- NEW: first contract age < 30 days
- LOYAL: customer age > 2 years AND zero broken promises lifetime
- BLACKLIST: manual only

**Frontend**:
- Tag chips on ContractCard (next to MDM state, color-coded)
- Filter chip in FilterDrawer: include/exclude by tag
- Customer 360 header: tag list + "+เพิ่ม tag" button (manual override)
- OWNER can remove auto-tags + add manual tags

**Affect dunning**:
- VIP: dunning rules wait +3 days before LINE
- BLACKLIST: send LINE immediately (no soft-touch)
- HIGH_RISK: skip soft templates, jump to firm template

**Priority**: P3-γ-P0 (foundation for further automation)

#### C2. Next-Best-Action Recommendation

**Approach**: rule-based first, defer ML

**Rules** (compute on queue.service for each row):
- IF preferredContactTime exists AND current hour matches → "แนะนำ: โทรเลย (รับสายช่วงนี้ X% ของครั้ง)"
- IF preferredChannel = LINE AND lineLastSeen < 1 hour → "แนะนำ: ส่ง LINE (online ใน 1 ชม.)"
- IF brokenPromiseCount ≥ 2 AND not yet sent firm letter → "แนะนำ: ส่งหนังสือบอกเลิกสัญญา"
- IF daysOverdue > 60 AND no MDM → "แนะนำ: เสนอ OWNER ล็อคเครื่อง"
- DEFAULT: ตาม dunning rule schedule

**UX**:
- ContractCard chip "💡 แนะนำ: {action}" (use Lightbulb icon)
- Click chip → execute action (open dialog/modal directly)

**Backend**: extend queue enrichment — add `nextBestAction: { type, label, executeAction }` field

**Priority**: P3-γ-P1

#### C3. Real-time Queue Updates (SSE)

**Approach**: Server-Sent Events (lighter than WebSocket, HTTP/2 friendly)

**Backend**: new endpoint `GET /overdue/queue/stream` — long-lived SSE connection
- Push events: `{ type: 'CONTRACT_ASSIGNED', contractId, ... }`, `CALL_LOGGED`, `PAYMENT_RECORDED`, `STATUS_CHANGED`
- Filter events by user's branch + role

**Frontend**:
- Queue tabs subscribe via `EventSource`
- React Query cache invalidation on relevant events
- Visual indicator: "live" badge + new card animations

**Tech consideration**: behind nginx proxy, ensure timeout settings allow long connections (default 60s — bump to 300s+)

**Priority**: P3-γ-P2 (nice but 5-min poll OK)

---

### Cluster 4 — Reporting (P3-δ)

#### D1. Performance Analytics PDF Export

**Trigger**: OWNER button "Export PDF" on AnalyticsTab + scheduled cron weekly Monday 08:00

**Content**:
- Cover page (date range, branch summary, total recovery ฿)
- KPI strip snapshot (4 numbers)
- Aging bucket chart (image render)
- Collector leaderboard table
- Recovery rate by channel chart
- Stuck contracts list (top 20)
- Letter dispatch trend
- Promise kept/broken trend

**Tech**: jspdf + html2canvas (already in deps for legal letters). Render hidden DOM → snapshot → PDF

**Email integration**: scheduled cron sends PDF attachment via existing email service to OWNER + configured recipients

**Priority**: P3-δ-P0 — high OWNER value

#### D2. Compliance Dashboard

**Sections**:
- **PDPA dunning frequency** — list contracts with > 4 dunning actions/month (PDPA risk threshold; configurable)
- **LEGAL pipeline** — contracts in LEGAL status with court hearing dates upcoming (7/14/30 days)
- **Audit trail summary** — weekly aggregated: actions by user, by type, anomalies (eg. SALES with cross-branch access attempts)
- **Document retention** — voice memos eligible for Glacier transition / deletion (Cluster 1 A3 dependency)

**Access**: OWNER + ACCOUNTANT + LEGAL_ADVISOR (new role? Or just OWNER/FINANCE_MANAGER)

**Priority**: P3-δ-P1

---

### Cluster 5 — External Integration (P3-ε)

#### E1. Call Recording Integration

**Pre-decision needed**: which PBX/cloud phone system?
- Options: 3CX (self-hosted), Twilio, MakeWebRTC, JustCall, etc.
- BESTCHOICE current phone setup unknown — needs IT discussion

**Approach** (if 3CX/Twilio):
- Webhook on call end: payload includes recording URL + caller + callee
- Match callee phone → Customer.phone → auto-create CallLog with recording
- Storage: same S3 bucket as voice memo, prefix `call-recordings/`

**Priority**: BLOCKED until phone system decision. P3-ε-P-blocked

#### E2. SMS Gateway Template Management UI

**Problem**: Templates currently hardcoded in DunningRule fields (template column). Admin can't tweak without code deploy.

**UX**:
- New page `/settings/sms-templates`
- List templates: name / channel / variables / active
- Edit: WYSIWYG-ish text area + variable picker (`{{customerName}}`, `{{amount}}`, `{{daysOverdue}}`)
- Preview: render with sample data
- A/B test: 2 active variants split-tested per dunning rule

**Schema**: maybe DunningRule.template stays + new `SmsTemplate` model (named templates referenced by name from DunningRule)

**Priority**: P3-ε-P0

---

### Cluster 6 — Tech Debt Cleanup (P3-ζ)

Bundle into 1 PR. Per-item brief:

#### Z1. Semantic tokens (cardIndicators.ts + others)
- Replace `bg-emerald-500/15` etc. with `bg-success/15`
- Define missing semantic tokens in `index.css` if absent

#### Z2. Type safety
- `enrichRows: any[]` → `Prisma.ContractGetPayload<typeof selectShape>[]`
- `FilterDrawer.tsx:307 as any` → proper union type

#### Z3. BRANCH_MANAGER policy
- UI shows ApprovalTab to BRANCH_MANAGER (P0 design) but backend MDM approve is OWNER+FINANCE_MANAGER
- Decision: either expand backend or hide MDM section from BRANCH_MANAGER UI

#### Z4. OverduePage.tsx delete
- Refactor AllTab to inline relevant subset of OverduePage logic
- Delete OverduePage.tsx + remove imports

#### Z5. 10MB cap on S3 backend
- P2 fixed for GCS (`x-goog-content-length-range`)
- Add S3 POST policy `Conditions` if S3-compatible storage in use

#### Z6. Customer insights branch-scope
- Currently open to all roles; tighten SALES via `branchId` check

#### Z7. Voice memo MIME validation harden
- `audio/webm;codecs=opus` accepted but stripped before validation. Verify codec spoofing not possible (e.g., `audio/webm;codecs=evil`)

#### Z8. PROPOSE_LOCK undo DELETE endpoint
- Plan called for it but not implemented (TODO in code). Wire it.

#### Z9. Mark undeliverable undo
- Same — TODO in code

#### Z10. lineResponse filter
- Add LINE delivery state schema field (`ChatMessage.deliveryStatus`?) so RESPONDED/IGNORED/BLOCKED can be computed
- Update queue.service post-filter to use it

**Priority**: All Z items P3-ζ-P0 (single bundled PR)

---

## Priority Roll-up

| Tier | Items | Effort |
|------|-------|--------|
| **P3-α** (close-loop) | ~~A1 dropped~~, A2 (1d), A3 (2d, infra-blocked) | ~3d |
| **P3-β** (productivity) | ~~B1 dropped~~, B2 (3d), B3 (3d) | ~6d |
| **P3-γ** (intelligence) | C1 (4d), C2 (3d), ~~C3 deferred~~ | ~7d |
| **P3-δ** (reporting) | D1 (3d), D2 (3d) | ~6d |
| **P3-ε** (integration) | ~~E1 deferred~~, E2 (4d) | ~4d |
| **P3-ζ** (tech debt) | Z1-Z10 bundled | ~5d |
| **TOTAL** | 23 items | ~41d sequential / 12-15d parallel |

---

## Open Questions

1. ~~A1 Slip Review~~ — DROPPED (QR auto-confirm)
2. ~~B1 CSV Import bank formats~~ — DROPPED (QR auto-confirm)
3. ~~C1 Auto-tag rules~~ — RESOLVED: cron daily + manual recompute button (Q3)
4. ~~C1 Tag affect dunning~~ — RESOLVED: ship together with 3 conditions (VIP delay / HIGH_RISK skip soft / BLACKLIST immediate) (Q4)
5. ~~C3 SSE infra~~ — DEFERRED P4 (Q5). Re-evaluate when team > 20 users
6. ~~D1 PDF Export email~~ — RESOLVED: configurable list in Settings page (Q6)
7. ~~E1 Phone system~~ — DEFERRED P4 (Q7). Wait for owner+IT phone infra decision

**All open questions resolved.**

---

## Decision Log
- **2026-04-25**: Predictive ML deferred to P4 (need data foundation + ML stack discussion)
- **2026-04-25**: Cluster 6 bundled into single PR (no per-item phasing)
- **2026-04-25**: D7 Payment Plan Renegotiation remains deferred to own spec (TFRS impact)
- **2026-04-25**: Real-time SSE chosen over WebSocket (lighter, HTTP/2 friendly)
- **2026-04-25** (Q1): A1 Slip Review Queue **DROPPED** — QR via PaySolutions webhook auto-confirms payments. P0 slip enforcement remains as fallback for non-QR cases.
- **2026-04-25** (Q2): B1 Bulk Payment CSV Import **DROPPED** — same QR reasoning. Bank reconciliation manual workflow not needed when payments confirm via webhook.
- **2026-04-25** (Q3): C1 Tag recompute = **cron daily 01:00 Bangkok + manual "Recompute tags" button** in Customer 360 OWNER panel for ad-hoc force refresh. Iterate to event-driven only if 6-month review shows lag-pain.
- **2026-04-25** (Q4): C1 Tags **ship with dunning effect** in same PR. Limit to 3 conditions in v1: VIP (+3 days delay before LINE), HIGH_RISK (skip soft templates, jump to firm), BLACKLIST (immediate dunning). Generic rule engine deferred.
- **2026-04-25** (Q5): C3 Real-time SSE **DEFERRED P4** — 5-min React Query polling adequate for team 5-10. Cloud Run timeout extension risk + cost not justified. Re-evaluate when team > 20.
- **2026-04-25** (Q6): D1 PDF report recipients = **configurable list in Settings page** (`pdf_report_recipients` field, comma-separated emails). Initial: OWNER + finance team emails.
- **2026-04-25** (Q7): E1 Call Recording **DEFERRED P4** — needs owner+IT decision on phone system. Voice memo (P2) covers manual gap.
