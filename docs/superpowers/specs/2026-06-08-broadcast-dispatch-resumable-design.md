# Broadcast dispatch — approve-and-send + resumable multicast (design)

**Status:** DESIGN — needs owner sign-off before any code.
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
- A chunk-aligned integer cursor is sufficient — do NOT persist per-user delivered
  ids (row bloat, breaks the append-only convention).
- Dispatch from the frozen `resolvedRecipients` snapshot, never a live re-resolve
  (else the approver approves list X but list Y ships).

### Anti-tests to fix deliberately (not silently revert)
- `broadcast.service.spec.ts` currently asserts the final state is `APPROVED`
  (it codifies the dead-end as "correct"). Changing it to `SENT/SENDING` must be
  a deliberate test update.
- `line-oa/broadcast.spec` asserts single-shot dispatch → keep green while adding
  partial-failure/resume cases.

## Open questions (owner)
1. **Module A fate:** is the chat-engine `modules/broadcast` (2-OWNER gate,
   `POST /broadcast/send` + `/broadcast/:id/approve`) intended to be wired to a
   UI, or abandoned in favour of `line-oa/broadcast`? If abandoned → **delete it**
   (preferred — removes the footgun) rather than build dispatch-on-approve for it.
2. **Unify the two modules?** They share `BroadcastMessage` but have different
   approval policies (line-oa = single SoD approver; chat-engine = 2-OWNER +
   >1000/legal-trigger gate). Which approval policy is the intended one for
   customer broadcasts?
3. **Recipient-drift policy:** when an approver clears a gated broadcast hours
   after it was queued, dispatch the audience **snapshot frozen at request time**,
   or **re-resolve live** (so a customer who paid off / unlinked LINE since is
   excluded)? PDPA + accuracy call.
4. **Partial-failure UX:** on a partial multicast failure (chunks 1-2 of 5
   delivered, chunk 3 fails), **auto-resume** from the cursor on retry, or require
   **manual re-confirmation** showing "X of Y already delivered"? Auto-resume is
   double-send-safe but sends the rest without a human re-checking.
5. **Retention/audit:** do broadcasts carrying collection/legal trigger language
   need any retention/audit beyond `BroadcastApproval` + `AuditLog`, given the
   duplication risk?

## Effort
L — Prisma migration (`resolved_recipients`, `delivered_cursor`, sent/failed
counts) + extract one shared dispatcher across the two modules + new specs for
partial-failure resume and dispatch-on-final-approval. Blocked on Q1–Q4.
