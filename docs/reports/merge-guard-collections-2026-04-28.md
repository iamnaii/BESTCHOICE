# Pre-Merge Guard Report — Collections Feature Branches
**Date**: 2026-04-28  
**Reviewer**: Pre-Merge Guard Agent  
**Author**: Akenarin Kongdach

---

## Branches Reviewed

| # | Branch | Last Commit | Changed Files |
|---|--------|-------------|---------------|
| 1 | `feat/collections-partial-payment-escalate` | 2026-04-28 12:02 | 30 files (+3817 / -1936) |
| 2 | `feat/collections-promise-to-pay-lifecycle` | 2026-04-28 10:59 | 44 files (+7373 / -525) |
| 3 | `feat/collections-guided-session` | 2026-04-26 19:57 | 86 files (+10193 / -3357) |

---

## Branch 1: `feat/collections-partial-payment-escalate`

### Summary
Adds two new collector actions to the overdue module:
- **Partial payment + reschedule** (`POST /overdue/:id/partial-payment-reschedule`): Records partial cash collection and auto-creates a new PROMISED CallLog for the remainder.
- **Escalation guardrail** (`POST /overdue/:id/escalate`): Forces LETTER / MDM / LEGAL escalation when broken promise count ≥ threshold.

### New Files
- `apps/api/src/modules/overdue/dto/escalate.dto.ts`
- `apps/api/src/modules/overdue/dto/partial-payment-reschedule.dto.ts`
- `apps/web/src/pages/CollectionsPage/components/PartialPaymentRescheduleDialog.tsx`
- `apps/web/src/pages/CollectionsPage/hooks/useEscalate.ts`
- `apps/web/src/pages/CollectionsPage/hooks/usePartialPaymentReschedule.ts`

### Issues

#### Critical
_None_

#### Warning
**W1 — Decimal → Number conversion at internal boundary** (`overdue.service.ts`)

`outstandingAfter` is computed via `Prisma.Decimal` arithmetic, then immediately converted with `.toNumber()` before being passed to `logContact()` as `settlementAmount`:

```typescript
// overdue.service.ts ~line 1194
const outstandingAfter = outstandingBefore.sub(paid).toNumber();
// ...
callLog = await this.logContact(contractId, callerId, {
  settlementAmount: outstandingAfter,  // ← number, not Decimal
```

`logContact` does re-wrap it with `new Prisma.Decimal(dto.settlementAmount)` before DB write, so precision is recovered at the persistence layer. In practice, installment amounts in Thailand are 2 d.p., so float imprecision is very unlikely to surface. However, this crosses the internal boundary as a primitive `number` rather than keeping it as `Prisma.Decimal` throughout — inconsistent with project conventions.

**Recommended fix**: Keep `outstandingAfter` as `Prisma.Decimal` and pass the Decimal value; widen `logContact`'s `settlementAmount` type to `number | Prisma.Decimal` if needed, or rely on `.toNumber()` only at the final JSON return.

**W2 — `.toNumber()` in API response serialization** (multiple points in `overdue.service.ts`)

Several `callLog.settlementAmount.toNumber()` calls in the response-shaping return block are acceptable serialization boundaries (Decimal → JSON number), but should be documented with a short comment so future readers don't flag them as bugs.

#### Info
_None_

### Recommendation: **REVIEW** (fix W1 before merge)

---

## Branch 2: `feat/collections-promise-to-pay-lifecycle`

### Summary
Implements the full Promise-to-Pay lifecycle redesign (v5 spec):
- `PromiseSlot` model — N slots per promise replacing legacy 2-slot split
- `PromiseService` — `findActivePromise`, `createPromise`, `calcCycleDeadline`
- `promise-resolution.cron` (hourly) — replaces `broken-promise.cron`
- `no-promise-lock.cron` (hourly) — auto-MDM-lock after 2 consecutive unanswered calls
- Two new endpoints: `GET /overdue/contracts/:id/cycle-deadline`, `GET /overdue/contracts/:id/overdue-installments`
- Frontend: `InstallmentPickerPopover`, `SupersedePromiseConfirmDialog`, `usePromiseSlots` hook, PromiseTab redesign

### New Files (17)
Backend: `promise.service.ts`, `promise.service.spec.ts`, `promise-resolution.cron.ts`, `promise-resolution.cron.spec.ts`, `no-promise-lock.cron.ts`, `no-promise-lock.cron.spec.ts`, `installment-allocator.util.ts`, `installment-allocator.util.spec.ts`, `backfill-promise-slots.ts`, 2 migrations  
Frontend: `InstallmentPickerPopover.tsx`, `SupersedePromiseConfirmDialog.tsx`, `usePromiseSlots.ts`  
E2E: `promise-lifecycle-happy.spec.ts`, `promise-supersede.spec.ts`

### Issues

#### Critical
_None_

#### Warning
**W1 — Multiple `Number()` / `.toNumber()` calls on Decimal money fields** (`overdue.service.ts`, `promise.service.ts`)

`overdue.service.ts`:
- `settlementAmount: Number(dto.settlementAmount ?? 0)` (2 occurrences)
- `settlementAmount: Number((active as any).settlementAmount ?? 0)`
- `remainingAmount: Number(new Prisma.Decimal(...).sub(...))`
- `settlementAmount: Number(s.settlementAmount)`

`promise.service.ts`:
- `const slotAmount = slot.settlementAmount.toNumber()`
- `const paid = sum._sum.amountPaid?.toNumber() ?? 0`

Most of these appear to be API response serialization (Decimal → JSON number), which is acceptable at the HTTP boundary. However, `Number(value ?? 0)` wraps instead of using the safer `new Prisma.Decimal(value ?? 0).toNumber()` pattern — meaning a `null` input silently becomes `0` with no error. This could mask missing data in promise calculations.

**W2 — `as any` casts on promise object** (`overdue.service.ts`)

`(active as any).id`, `(active as any).settlementAmount` etc. are used because the return type of `findActivePromise()` is not properly typed. Introduce a `PromiseWithSlots` interface to eliminate the unsafe casts.

#### Info
_None_

### Recommendation: **REVIEW** (W1/W2 are non-blocking but should be addressed)

---

## Branch 3: `feat/collections-guided-session`

### Summary
Introduces a full guided collection session workflow:
- `CollectionsSession` module — focus mode for collectors, daily assignment pool, team dashboard
- `AutoAssignService` — auto-assigns contracts to collectors (SoD-aware)
- `MdmController` — new direct lock/unlock endpoints
- `SettingsController` — collections config CRUD
- Frontend: `FocusMode`, `CollectionsHeader`, `TeamOverviewTab`, session hooks and UI components
- `AuthController` — `PATCH /auth/me/preferences` for per-user collector preferences

### New Files (45 key files)
Backend: `collections-session.module.ts`, `collections-session.controller.ts`, `collections-session.service.ts`, `auto-assign.service.ts`, `pool.service.ts`, `team-dashboard.service.ts`, `collections-summary.service.ts`, associated spec files, 2 migrations  
Frontend: `FocusMode.tsx`, `CollectionsHeader.tsx`, `TeamOverviewTab.tsx`, `useCollectionsSession.ts`, `useCollectionsConfig.ts`, and supporting components  
Docs: 3 new spec/plan documents

### Issues

#### Critical

**C1 — `Number()` on Prisma aggregate Decimal** (`collections-session/team-dashboard.service.ts:~89`)

```typescript
const collectedByCollector = new Map(
  todayPayments.map((p) => [p.recordedById!, Number(p._sum.amountPaid ?? 0)]),
);
```

`p._sum.amountPaid` is a `Prisma.Decimal | null` from an aggregate query. Wrapping with bare `Number()` instead of `new Prisma.Decimal(value).toNumber()` silently coerces `null` to `0` and loses Decimal precision. This is a **money field** and violates the project rule: "ใช้ Decimal เท่านั้น: @db.Decimal(12, 2) — ห้ามใช้ Float หรือ Int".

**Fix**:
```typescript
Number(p._sum.amountPaid ?? 0)
// → replace with:
new Prisma.Decimal(p._sum.amountPaid ?? 0).toNumber()
```

**C2 — Missing `deletedAt: null` in `findUnique`** (`collections-session/pool.service.ts:~61`)

```typescript
return this.prisma.dailyAssignment.findUnique({
  where: { id: assignmentId },
});
```

After `updateMany` (which does filter `deletedAt: null`), the re-read via `findUnique` does **not** include `deletedAt: null`. A soft-deleted assignment could be returned and surfaced to the caller. This violates the project rule: "ทุก query ต้องมี where: { deletedAt: null }".

**Fix**:
```typescript
return this.prisma.dailyAssignment.findFirst({
  where: { id: assignmentId, deletedAt: null },
});
```
(Note: `findUnique` cannot add extra `where` filters beyond the unique key, so change to `findFirst`.)

#### Warning

**W1 — `user: any` in controller** (`collections-session.controller.ts`, 7 occurrences)

All 7 endpoint handlers use `@CurrentUser() user: any`. Should be typed as `{ id: string; role: string; branchId?: string | null }` consistent with other controllers in the project.

#### Info
_None_

### Recommendation: **BLOCK** — C1 and C2 must be fixed before merge

---

## Overall Summary

| Branch | Critical | Warning | Info | Verdict |
|--------|----------|---------|------|---------|
| `feat/collections-partial-payment-escalate` | 0 | 2 | 0 | **REVIEW** |
| `feat/collections-promise-to-pay-lifecycle` | 0 | 2 | 0 | **REVIEW** |
| `feat/collections-guided-session` | 2 | 1 | 0 | **BLOCK** |

### Action Required Before Merge

**`feat/collections-guided-session`** (BLOCK):
1. `team-dashboard.service.ts` — replace `Number(p._sum.amountPaid ?? 0)` with `new Prisma.Decimal(p._sum.amountPaid ?? 0).toNumber()`
2. `pool.service.ts` — change `findUnique({ where: { id } })` to `findFirst({ where: { id, deletedAt: null } })`

**`feat/collections-partial-payment-escalate`** (REVIEW):
3. `overdue.service.ts` — keep `outstandingAfter` as `Prisma.Decimal` through the internal boundary; only call `.toNumber()` in the final return object

**`feat/collections-promise-to-pay-lifecycle`** (REVIEW):
4. `overdue.service.ts` / `promise.service.ts` — replace bare `Number(value ?? 0)` with `new Prisma.Decimal(value ?? 0).toNumber()`
5. `overdue.service.ts` — define `PromiseWithSlots` interface to replace `as any` casts
