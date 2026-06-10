# Broadcast dispatch — approve-and-send + resumable multicast (design)

**Status:** DECIDED 2026-06-10 — owner answered all 5 questions (see "Owner
decisions" below); decision-record, ready to implement via the spun-off issues.
**Source:** code-quality review #16 (`approveBroadcast` dead-end) + its multicast
partial-failure sibling. See `CODE_QUALITY_REVIEW_API.md` and the residual triage
in auto-memory `api-codequality-remediation`.

## TL;DR

There are **two** broadcast modules that share the `BroadcastMessage` Prisma
model but have different (and both broken) lifecycles. One is a live
duplicate-message risk; the other is dead but a footgun. Fixing them correctly
needs a small schema change and a single shared dispatcher — hence design-first.

## Current state (verified against source)

### (A) `apps/api/src/modules/broadcast/broadcast.service.ts` — chat-engine module
- `approveBroadcast()` sets `status='APPROVED'` once 2 distinct OWNER approvals
  land, **but nothing ever dispatches an APPROVED broadcast.** The only dispatch
  loop is in `sendBroadcast()`, which re-resolves targets and re-hits the same
  `evaluateApprovalRequirement` gate — so a gated (>1000-recipient / legal-trigger)
  broadcast that two owners approve is **never sent**. The comment claiming
  dispatch happens "via a separate code path" refers to a path that does not exist.
- **DEAD/UNWIRED today:** the only Broadcast UI (`BroadcastPage.tsx`) calls
  `/line-oa/broadcast/*`, never this module's `POST /broadcast/send` +
  `/broadcast/:id/approve`. So no owner is being fooled *yet* — but the day a UI
  is wired to it, gated broadcasts silently vanish (worse for legal-language sends).

### (B) `apps/api/src/modules/line-oa/broadcast.service.ts` — the LIVE module
- `approveBroadcast()` (single SoD approver: `createdById !== approverId`)
  dispatches directly and sets terminal `SENT`/`FAILED`. No APPROVED dead-end here.
- **Live bug:** the multicast chunk loop (`549-568`) `return`s on the FIRST failed
  500-id chunk; the caller then writes `status='FAILED'` even though chunks 1..k-1
  were already delivered. No delivered-cursor is persisted, so a retry/re-approve
  **re-sends from chunk 0 → duplicate customer messages** (the exact failure the
  `SCHEDULED→SENDING` claim guard was added to prevent for cron sends — but this
  manual-retry path bypasses it).
- `BroadcastMessage` persists `messages` / `audience` / `audienceCount` but **no
  resolved recipient list, no CUSTOM customerIds, no delivered-cursor** —
  `getAudienceUserIds` re-resolves live on every dispatch. So a `PENDING_APPROVAL`
  row is **lossy**: it cannot deterministically re-dispatch a CUSTOM audience.

## Proposed design

Unify both modules onto one **persisted, resumable** lifecycle.

### Schema (migration on `BroadcastMessage`)
| Field | Type | Purpose |
|---|---|---|
| `resolvedRecipients` | `Json?` (`resolved_recipients`) | Snapshot of external LINE userIds resolved **at send-request time**. Makes a gated/PENDING_APPROVAL row non-lossy and freezes the exact audience the approver reviewed (no drift). `null` for the ALL audience → use the LINE broadcast API. |
| `deliveredCursor` | `Int @default(0)` (`delivered_cursor`) | Index of the next un-sent recipient in `resolvedRecipients`, chunk-aligned. Advanced per successful 500-chunk **outside** any tx. Resume = start here → idempotent (already-sent chunks skipped). |
| `sentCount` / `failedCount` | `Int @default(0)` | Partial-outcome reporting. |

Add a `PARTIAL` status value (doc-comment enum) for "some chunks delivered, then failed".

### Flow (collapse both modules to ONE dispatcher)
1. **Send-request (gated):** resolve targets ONCE → persist
   `resolvedRecipients` + `audienceCount` + `messages`, `status=PENDING_APPROVAL`.
2. **Final approval** (2-OWNER for module A; single SoD for module B): set
   `status=SENDING`, then call the **shared dispatcher**, which reads
   `resolvedRecipients` + `deliveredCursor` and loops chunks, advancing the
   cursor per delivered chunk. **No re-resolve, no re-gate** (the gate decision
   is already captured in `BroadcastApproval` rows).
3. **Chunk failure:** persist the current cursor + `status=PARTIAL`/`FAILED` +
   `errorMessage` + `Sentry.captureException` (regulated/customer-facing → must
   alarm, not `logger.warn`-and-continue as module B does today).
4. **Retry / re-approve:** dispatcher resumes from `deliveredCursor` → **no
   double-send.** Reuse the existing `SCHEDULED→SENDING` atomic claim as the
   idempotency primitive; extend it to cover `SENDING`/`PARTIAL` resume.
5. **ALL audience:** LINE broadcast API (single call); cursor is trivially 0/1;
   flip to `SENT` only on 2xx.

Then either route module A's `approveBroadcast` into the shared dispatcher, **or**
delete module A entirely if it is abandoned (see Q1).

### House-rule guardrails (do NOT regress)
- The LINE multicast fetch is a long external HTTP call — cursor advancement is
  small per-chunk updates **outside** any `$transaction` (mirror the v2
  PaySolutions "external-call-then-persist + Sentry" precedent). Never wrap the
  chunk loop in a tx.
- ~~A chunk-aligned integer cursor is sufficient — do NOT persist per-user
  delivered ids.~~ **SUPERSEDED by owner decisions 3+4** — live re-resolve +
  auto-resume require the delivered-by-recipient set (`deliveredRecipients`).
  Bound growth by pruning the set on terminal `SENT`.
- ~~Dispatch from the frozen `resolvedRecipients` snapshot, never a live
  re-resolve.~~ **SUPERSEDED by owner decision 3** — re-resolve live at send time;
  resume stays double-send-safe via `deliveredRecipients` tracking.

### Anti-tests to fix deliberately (not silently revert)
- `broadcast.service.spec.ts` currently asserts the final state is `APPROVED`
  (it codifies the dead-end as "correct"). Changing it to `SENT/SENDING` must be
  a deliberate test update.
- `line-oa/broadcast.spec` asserts single-shot dispatch → keep green while adding
  partial-failure/resume cases.

## Owner decisions (resolved 2026-06-10)

All five questions are decided. Where a decision overrides the proposal above, the
**decision wins** — the implementation issues spun from this doc carry the decided
design, not the original proposal.

1. **Module A fate → DELETE.** The chat-engine `modules/broadcast` is unwired
   (only `line-oa/broadcast` is reachable from `BroadcastPage`) and is a dead-end
   footgun. Delete the module (controller + service + module + spec; drop from
   `app.module.ts`). The unified dispatcher lives in the `line-oa` path.
2. **Approval policy → single SoD** (one approver, must differ from the creator)
   for ALL manual, human-composed broadcasts. The chat-engine **2-OWNER / T4-C6
   gate is dropped** (owner decision: one approver is sufficient). Automated /
   system notifications (payment-due reminders, overdue alerts, etc.) are NOT
   broadcasts and need **no approval** — unchanged, separate code path.
3. **Recipient policy → RE-RESOLVE LIVE at send time** (NOT a frozen snapshot).
   A customer who paid off / unlinked LINE between request and send is excluded.
   **This overrides the `resolvedRecipients` snapshot design above** — see
   "Design override" below.
4. **Partial-failure → AUTO-RESUME.** On retry the dispatcher continues from
   where it stopped and never re-sends an already-delivered recipient. This is the
   direct fix for the live double-send bug.
5. **Retention → standard.** No special retention schema. Existing
   `BroadcastApproval` + `AuditLog` + the delivered-tracking below are sufficient.
   Add one audit action `BROADCAST_PARTIAL_FAILURE` (+ the `PARTIAL` status) so a
   partial multicast is visible.

### Design override from decisions 3 + 4 (live re-resolve + auto-resume)

The original proposal froze a `resolvedRecipients` snapshot and advanced an integer
`deliveredCursor`. Decision 3 (re-resolve live) means the audience is **not** frozen,
so an index into a frozen list no longer works. Replace it with **delivered-by-
recipient tracking**:

- **Schema on `BroadcastMessage`:** replace `resolvedRecipients` + `deliveredCursor`
  with **`deliveredRecipients Json` (`delivered_recipients`)** — the set of external
  LINE userIds already delivered — plus `sentCount` / `failedCount` and the `PARTIAL`
  status.
- **Send / resume flow:** at final approval **and on every retry**, **re-resolve the
  audience live**, then dispatch only the userIds NOT already in
  `deliveredRecipients`, appending each delivered 500-chunk's ids to
  `deliveredRecipients` **outside** any `$transaction` (mirror the PaySolutions
  external-call-then-persist + Sentry precedent). Auto-resume is therefore double-
  send-safe even though the audience is re-resolved live — already-delivered ids are
  skipped.
- **`ALL` audience:** LINE broadcast API (single call); flip to `SENT` only on 2xx.

This **supersedes** the "Dispatch from the frozen snapshot, never a live re-resolve"
guardrail above (that guardrail assumed the snapshot design; decision 3 chose live).

## Effort
**Decisions resolved 2026-06-10 — ready to implement** (see issues spun from this
doc). M–L — delete chat-engine module A; Prisma migration (`delivered_recipients`,
`sent_count`, `failed_count`, `PARTIAL` status); one shared dispatcher on the
`line-oa` path with single-SoD approval + live re-resolve + auto-resume; new specs
for partial-failure resume + dispatch-on-final-approval + the deleted-module
anti-test cleanup.
