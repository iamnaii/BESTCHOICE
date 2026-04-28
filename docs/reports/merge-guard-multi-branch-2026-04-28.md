# Pre-Merge Guard Report — 2026-04-28

**Generated**: 2026-04-28  
**Reviewer**: Pre-Merge Guard Agent  
**Branches reviewed**: 3 (most recently active, non-dep-bump, non-guard branches)

---

## Branch 1: `feat/collections-partial-payment-escalate`

**Author**: Akenarin Kongdach (+ Claude)  
**Commits ahead of main**: 3  
**Last commit**: ~10 hours ago  

### File Changes Summary
30 files changed, 3817 insertions(+), 1936 deletions(−)

Key new files:
- `apps/api/src/modules/overdue/dto/partial-payment-reschedule.dto.ts` — new DTO
- `apps/api/src/modules/overdue/dto/escalate.dto.ts` — new DTO
- `apps/web/src/pages/CollectionsPage/components/PartialPaymentRescheduleDialog.tsx` — new dialog (320 lines)
- `apps/web/src/pages/CollectionsPage/hooks/usePartialPaymentReschedule.ts` — new mutation hook
- `apps/web/src/pages/CollectionsPage/hooks/useEscalate.ts` — new mutation hook
- Large: `package-lock.json` (weekly dep update — 3810 lines changed)

### Issues

#### Critical
None.

#### Warning

**W1 — Frontend monetary Number() conversion passed to API**  
`apps/web/src/pages/CollectionsPage/components/PartialPaymentRescheduleDialog.tsx`
```tsx
const amountPaidNum = Number(amountPaid);   // string → JS float
mutation.mutate({ amountPaid: amountPaidNum, ... });
```
The DTO uses `@Type(() => Number)` + `@IsNumber({ maxDecimalPlaces: 2 })` which limits exposure, and the backend service converts to `Prisma.Decimal` before storage. Low practical risk but deviates from the pattern of sending string amounts (e.g., input `"1000.10"` → `Number()` → `1000.1` → fine; but `"1000.001"` passes the 2-decimal DTO guard then gets silently truncated). Prefer sending the raw string and validating on the server.

**W2 — Documented non-atomicity between payment recording and call log**  
`apps/api/src/modules/overdue/overdue.service.ts` — `partialPaymentReschedule`
```
// Atomicity tradeoff: payment + call log อยู่คนละ transaction เพราะ autoAllocatePayment
// มี $transaction ของตัวเอง. ถ้า logContact fail หลังรับเงินแล้ว, เงินยังถูกบันทึก
```
Intentionally documented and acceptable given the business invariant (money received = irrevocable). However if `logContact` fails, the collector must manually log the reschedule — no auto-retry / alert mechanism. Consider adding a Sentry capture on the logContact failure path.

#### Info
- `outstandingAfter = +(outstanding - amountPaidNum).toFixed(2)` — display-only UI calculation, not used in API calls. Acceptable.
- `docs/reports/weekly-progress-2026-04-27.md` included in diff — not a code concern.

### Recommendation: **APPROVE**
No critical issues. Two warnings are low-risk given backend safeguards. Safe to merge after optional W1/W2 follow-up.

---

## Branch 2: `feat/collections-promise-to-pay-lifecycle`

**Author**: Akenarin Kongdach  
**Commits ahead of main**: 33  
**Last commit**: ~11 hours ago  

### File Changes Summary
44 files changed, 7373 insertions(+), 525 deletions(−)

Key new files:
- `apps/api/src/modules/overdue/promise.service.ts` (225 lines) — new PromiseService
- `apps/api/src/modules/overdue/promise.service.spec.ts` (253 lines) — tests
- `apps/api/src/modules/overdue/crons/promise-resolution.cron.ts` (231 lines) — new cron
- `apps/api/src/modules/overdue/crons/no-promise-lock.cron.ts` (136 lines) — new cron
- `apps/api/src/modules/overdue/mdm-lock.service.spec.ts` (159 lines) — tests
- `apps/api/scripts/backfill-promise-slots.ts` (195 lines) — backfill script
- `apps/web/src/pages/CollectionsPage/components/ContactLogDialog.tsx` (**610 lines**)
- `apps/web/src/pages/CollectionsPage/components/InstallmentPickerPopover.tsx` (117 lines)
- `apps/web/e2e/promise-supersede.spec.ts` (111 lines) — E2E test
- Large planning docs: `docs/plans/2026-04-27-promise-to-pay-lifecycle.md` (2955 lines)

### Issues

#### Critical
None.

#### Warning

**W1 — Number() conversion before Prisma.Decimal construction in service layer**  
`apps/api/src/modules/overdue/overdue.service.ts`
```ts
// Inside createPromise slot builder:
settlementAmount: Number(dto.settlementAmount ?? 0),
// Later in calcCycleDeadline / getCycleDeadline:
settlementAmount: Number((active as any).settlementAmount ?? 0),
```
`CreatePromiseSlotInput.settlementAmount` is typed `number | string`. When passed as a JS `number` to `new Prisma.Decimal(slot.settlementAmount)` in `promise.service.ts`, Prisma's Decimal library uses the number's IEEE 754 representation. For simple Thai baht amounts (e.g., 5000.50) this is fine in practice, but the canonical safe pattern for monetary values is to pass the string representation: `String(dto.settlementAmount ?? 0)`.

**W2 — Number() used for API response monetary field**  
`apps/api/src/modules/overdue/overdue.service.ts` — `getOverdueInstallments`
```ts
remainingAmount: Number(new Prisma.Decimal(p.amountDue as Prisma.Decimal).sub(p.amountPaid as Prisma.Decimal)),
```
This converts a Decimal to JS Number for the API response. The frontend `InstallmentPickerPopover` uses this value only for display (`formatNumber()`), not for calculations. Low risk but inconsistent with the project convention of returning monetary amounts as strings. Prefer `.toString()` or `.toFixed(2)`.

**W3 — `ContactLogDialog.tsx` exceeds 500-line guidance threshold**  
`apps/web/src/pages/CollectionsPage/components/ContactLogDialog.tsx` — 610 lines.  
This single component handles promise slot management, settlement flow, escalation, and form state. Could be split into smaller sub-components (e.g., `PromiseSlotSection`, `EscalationSection`) to improve maintainability. Not a blocker but worth addressing in a follow-up.

#### Info
- `Number(s.settlementAmount)` in PromiseTab serialization — display only, acceptable.
- Large planning/mockup documents in `docs/` — not a code concern.
- `docs/plans/2026-04-27-promise-to-pay-lifecycle.md` is 2955 lines — unusually large, consider archiving post-merge.
- `promise-resolution.cron.ts` replaces `broken-promise.cron.ts` cleanly — old cron deleted, new one tested.

### Recommendation: **REVIEW**
No security or correctness blockers, but W1 should be addressed before merge to maintain the `Prisma.Decimal(string)` convention consistently across the codebase. W2 and W3 are low-priority follow-ups.

**Suggested fixes before merge:**
1. In `overdue.service.ts`: change `Number(dto.settlementAmount ?? 0)` → `String(dto.settlementAmount ?? 0)` (×2 occurrences)
2. In `overdue.service.ts`: change `Number(new Prisma.Decimal(...).sub(...))` → `.toFixed(2)` for the `remainingAmount` response field

---

## Branch 3: `chore/audit-quick-wins`

**Author**: Akenarin Kongdach  
**Commits ahead of main**: 2  
**Last commit**: ~2 days ago  

### File Changes Summary
13 files changed, 209 insertions(+), 44 deletions(−)

Key changes:
- `shop-auth-social.controller.ts` — added `ShopBotDefenseGuard` + `@Throttle` on 3 endpoints
- `shop-installment-apply.controller.ts` — added `ShopBotDefenseGuard` + `@Throttle`
- `shop-me.controller.ts` — capped shipping addresses at 20, typed DTO properly
- `shop-reservation.controller.ts` — added `ShopBotDefenseGuard` + `@Throttle`
- `shop-tracking.controller.ts` — added `@Throttle`
- `staff-chat/web-widget.controller.ts` — added `@Throttle`, typed `InitWidgetDto` with validators
- `broadcast.controller.ts` — added `ParseFilePipe` with `MaxFileSizeValidator` + `FileTypeValidator` on image upload
- `line-oa.controller.ts` — added `ParseFilePipe` validators on rich menu image uploads (×2)
- `journal.controller.ts` — capped `limit` param at 100
- `customers.controller.ts` — capped `limit` params at 100 (×3 endpoints)
- `audit-log.service.ts` — dashboard staff metrics refactored from N+1 to `groupBy`

### Issues

#### Critical
None.

#### Warning

**W1 — Missing `deletedAt: null` on `user.findMany` and `branch.findMany` in audit metrics**  
`apps/api/src/modules/audit-log/audit-log.service.ts`
```ts
const [users, branches] = await Promise.all([
  salespersonIds.length
    ? this.prisma.user.findMany({
        where: { id: { in: salespersonIds } },  // ← missing deletedAt: null
        select: { id: true, name: true },
      })
    : Promise.resolve([]),
  branchIds.length
    ? this.prisma.branch.findMany({
        where: { id: { in: branchIds } },  // ← missing deletedAt: null
        select: { id: true, name: true },
      })
    : Promise.resolve([]),
]);
```
Soft-deleted users and branches can appear in dashboard staff metrics. Per the database rules, all queries must include `deletedAt: null`. In the audit/dashboard context, showing activity from a deleted salesperson or closed branch creates noise in reports.

#### Info
- The refactor from N+1 `findMany + JS reduce` to Prisma `groupBy` is a good improvement.
- `MaxFileSizeValidator` + `FileTypeValidator` additions are a solid security hardening.
- `@Throttle({ short: { limit: 5 } })` on installment apply endpoints is appropriate.
- All new throttle limits look reasonable (`5/min` for auth, `30/min` for widget init, `60/min` for message fetch).

### Recommendation: **REVIEW**
One warning (W1) should be fixed before merge — it's a 2-line change. All other changes are improvements.

**Suggested fix before merge:**
```ts
where: { id: { in: salespersonIds }, deletedAt: null },
where: { id: { in: branchIds }, deletedAt: null },
```

---

## Summary Table

| Branch | Critical | Warning | Info | Recommendation |
|--------|----------|---------|------|----------------|
| `feat/collections-partial-payment-escalate` | 0 | 2 | 1 | **APPROVE** |
| `feat/collections-promise-to-pay-lifecycle` | 0 | 3 | 3 | **REVIEW** |
| `chore/audit-quick-wins` | 0 | 1 | 4 | **REVIEW** |

No branch is **BLOCKED**. Two branches need small fixes before merge. `feat/collections-partial-payment-escalate` is ready to merge as-is.
