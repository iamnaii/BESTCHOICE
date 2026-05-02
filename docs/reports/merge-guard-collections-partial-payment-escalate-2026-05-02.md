# Merge Guard Report — feat/collections-partial-payment-escalate

**Date**: 2026-05-02
**Branch**: `feat/collections-partial-payment-escalate`
**Author**: iamnaii@MacBook-Pro-khxng-Akenarin.local
**Reviewed by**: Pre-Merge Guard Agent (automated)

---

## Summary

30 files changed — +3817 / -1936 lines (bulk of the delta is `package-lock.json` ±3810 lines).

This branch adds:
- `POST :contractId/partial-payment-reschedule` — records partial cash receipt + reschedules remainder
- `POST :contractId/escalate` — escalation guardrail (LETTER / MDM / LEGAL)
- `PartialPaymentRescheduleDto` + `EscalateDto` with class-validator decorators
- `usePartialPaymentReschedule` + `useEscalate` frontend hooks
- `PartialPaymentRescheduleDialog` frontend component (320 lines)
- `queue.service.ts` — escalation persistence

Key changed files:
- `overdue.controller.ts` +28 lines (2 new endpoints)
- `overdue.service.ts` +369 lines (partialPaymentReschedule + escalate business logic)
- `ContactLogDialog.tsx` +417 lines (refactored UI)
- `PartialPaymentRescheduleDialog.tsx` new (320 lines)

---

## Issues by Severity

### Critical — None

Both new controller methods sit inside `OverdueController` which has class-level
`@UseGuards(JwtAuthGuard, RolesGuard, BranchGuard)`. Both new methods have `@Roles()` decorators.
No missing guards.

No bare `Number()` on stored money values — Decimal arithmetic uses `new Prisma.Decimal()` and
`.sub()` throughout the service layer.

No hardcoded secrets, no `$queryRaw`, no `fetch()` in React components.

### Warning — 2 issues

**W1 — `settlementAmount?: number` in `LogContactDto`**

File: `apps/api/src/modules/overdue/dto/log-contact.dto.ts`

```typescript
@IsOptional()
@Type(() => Number)
@IsNumber({ maxDecimalPlaces: 2 }, { message: 'settlementAmount ต้องเป็นตัวเลข' })
@Min(0.01, { message: 'settlementAmount ต้องมากกว่า 0' })
settlementAmount?: number;
```

`CallLog.settlementAmount` is `Decimal @db.Decimal(12, 2)` in the schema. The DTO field is typed
`number`, so the service must convert it before storing. Currently the service wraps it with
`new Prisma.Decimal(dto.settlementAmount)` — which is correct — but the DTO type invites future
callers to pass a raw `number` that bypasses the conversion. Consider typing as `string` or
validating with `@IsDecimalString()` to make the intent explicit.

Low-risk for current paths; no financial data is stored directly from the DTO number.

---

**W2 — Large `package-lock.json` churn (+3810 / -1936)**

The lock file change is very large (apparently a dep version bump). This makes the diff noisy and
could hide unintentional dependency changes. Verify that the lock change is intentional (e.g., a
patch-version bump of a dep) and that `npm audit` passes cleanly on this branch before merging.

---

### Info — 2 items

**I1 — `PartialPaymentRescheduleDialog.tsx` is 320 lines at creation**

Newly created file already at 320 lines. Not a blocker, but worth monitoring — if it grows it
should be split into sub-components.

**I2 — LEGAL escalation SoD check is in service, not controller**

`escalate()` in the service throws `ForbiddenException` when `action === 'LEGAL'` and role is not
OWNER/FINANCE_MANAGER. This is correct SoD logic but is invisible from the controller signature
(`@Roles` allows SALES/BRANCH_MANAGER to call the endpoint). The controller comment documents this,
which is good. No code change needed, but the separation of concerns is worth being aware of
during QA.

---

## Security Check

- No new controllers — existing controller guards in place.
- DTO validators with Thai messages ✓
- New `useEscalate` hook uses `api.post()` from `@/lib/api` ✓
- No `localStorage` token usage.

---

## Recommendation

**APPROVE** — No Critical issues. W1 is a typing improvement that can be done as a follow-up
without changing runtime behaviour. W2 (lock file) should be verified with `npm audit` before
merge. All new endpoints are properly guarded and validated.
