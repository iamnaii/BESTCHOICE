# Pre-Merge Guard Report — 2026-04-28

**Agent**: Pre-Merge Guard  
**Run date**: 2026-04-28  
**Branches reviewed**: 3 (most recently committed, non-merged against `main`)

---

## Summary

| Branch | Author | Verdict |
|--------|--------|---------|
| `feat/collections-partial-payment-escalate` | iamnaii | ✅ APPROVE |
| `feat/collections-promise-to-pay-lifecycle` | iamnaii | ⚠️ REVIEW |
| `chore/audit-quick-wins` | iamnaii | ✅ APPROVE |

---

## Branch 1: `feat/collections-partial-payment-escalate`

**Last commit**: 2026-04-28 12:02 +07:00  
**Files changed**: 30 total (20 TS/TSX, 1 weekly report, package.json + lock)  
**Scope**: New `partialPaymentReschedule` + `escalate` endpoints on `OverdueController`; frontend `PartialPaymentRescheduleDialog`, `useEscalate`, `usePartialPaymentReschedule` hooks; queue enrichment with active-promise chips.

### Critical Issues — None

- **Guards**: `@UseGuards(JwtAuthGuard, RolesGuard, BranchGuard)` at class level on `OverdueController` ✅
- **New endpoints** `POST :contractId/partial-payment-reschedule` and `POST :contractId/escalate` both have `@Roles()` decorators ✅
- **Money handling**: Service uses `new Prisma.Decimal()` for all financial arithmetic; `.toNumber()` used only for JSON serialization responses ✅
- **Soft delete**: All new queries include `deletedAt: null` ✅
- **SQL injection**: No `$queryRaw` / `$queryRawUnsafe` introduced ✅
- **Secrets**: None hardcoded ✅

### Warning Issues

1. **Redundant `Number()` wrapper on DTO fields** (`overdue.service.ts` `logContact` path)  
   ```ts
   // lines ~1030 in service diff
   settlementAmount: Number(dto.settlementAmount ?? 0),
   settlementAmount: Number(dto.secondSettlementAmount ?? 0),
   ```
   `dto.settlementAmount` is already typed `number` (after `@Type(() => Number)` transform). The extra `Number()` is a no-op but inconsistent with the project pattern of `new Prisma.Decimal(x)` for monetary writes. Should be `new Prisma.Decimal(dto.settlementAmount ?? 0)`.

2. **Atomicity caveat documented but worth noting**: `partialPaymentReschedule` runs `autoAllocatePayment` (atomic Prisma transaction) then `logContact` in a separate transaction. If `logContact` throws after payment records, the payment is kept (correct per money-in rule) but the PROMISED call log is lost. The service code handles this with a `catch` + `logger.error`. This is the correct trade-off, but QA should verify the collector-facing fallback UX.

### Info

- `ESCALATION_BROKEN_PROMISE_THRESHOLD: 2` added to `BUSINESS_RULES` in `config.util.ts` — single source of truth mirrored on frontend as `ESCALATION_BROKEN_PROMISE_THRESHOLD = 2` constant in `useEscalate.ts`. Keep these in sync.
- `EscalateDto` has Thai validation messages on `action` and reason `@MinLength` but `@MaxLength(500)` has no Thai message — minor inconsistency.
- Package.json shows 4 dependency updates; lock file diff is large (3800+ lines) — recommend verifying no unexpected major-version bumps with `npm audit`.

### Recommendation: ✅ APPROVE

No blocking issues. The two warnings are style/consistency concerns that can be addressed in a follow-up.

---

## Branch 2: `feat/collections-promise-to-pay-lifecycle`

**Last commit**: 2026-04-28 10:59 +07:00  
**Files changed**: 44 total (36 TS/TSX, 2 docs, 3 E2E specs, types)  
**Scope**: Full Promise-to-Pay v5 lifecycle — `PromiseService`, `PromiseSlot` model, `promise-resolution.cron`, `no-promise-lock.cron`, N-slot `ContactLogDialog` rewrite, `InstallmentPickerPopover`, `SupersedePromiseConfirmDialog`, 2 new controller endpoints.

### Critical Issues — None

- **Guards**: `@UseGuards(JwtAuthGuard, RolesGuard, BranchGuard)` at class level confirmed ✅
- **New endpoints** `GET contracts/:id/cycle-deadline` and `GET contracts/:id/overdue-installments` have `@Roles()` decorators ✅
- **Soft delete**: All new `findMany`/`findFirst` queries in `promise.service.ts` include `deletedAt: null` ✅
- **SQL injection**: No raw queries introduced ✅
- **Secrets**: None hardcoded ✅

### Warning Issues

1. **`Number()` on financial DTO values passed to DB write** — most impactful finding  
   In `overdue.service.ts` (legacy-slot path within `logContact`):
   ```ts
   // Diff lines ~55, ~63
   settlementAmount: Number(dto.settlementAmount ?? 0),
   settlementAmount: Number(dto.secondSettlementAmount ?? 0),
   ```
   These values go to `PromiseService.createPromise` as `CreatePromiseSlotInput.settlementAmount: number | string`, which then writes to the DB via `settlementAmount: s.settlementAmount as never`. Prisma will coerce JS float→Decimal, but this bypasses explicit `new Prisma.Decimal()` wrapping and can silently lose sub-cent precision on large amounts. Should be `new Prisma.Decimal(dto.settlementAmount ?? 0)`.

2. **Multiple `(as any)` type casts** in `promise.service.ts` and `overdue.service.ts`:
   ```ts
   settlementAmount: Number((active as any).settlementAmount ?? 0),
   settlementAmount: primary.settlementAmount as never,
   settlementAmount: s.settlementAmount as never,
   ```
   `as never` silences a real typing mismatch between `CreatePromiseSlotInput.settlementAmount: number | string` and Prisma's `Decimal` field. Consider overloading the interface to `settlementAmount: Prisma.Decimal | number | string` or wrapping at the boundary.

3. **`Number(s.settlementAmount)` on DB-read Decimal** in `queue.service.ts`:
   ```ts
   settlementAmount: Number(s.settlementAmount),
   ```
   The project convention is `new Prisma.Decimal(s.settlementAmount).toNumber()` for explicit conversion. `Number(Prisma.Decimal)` works (Decimal implements `valueOf`) but violates the explicit-Decimal pattern.

4. **`remainingAmount` computed via `Number(new Prisma.Decimal(...).sub(...))` in `overdue.service.ts`**:
   ```ts
   remainingAmount: Number(new Prisma.Decimal(p.amountDue as Prisma.Decimal).sub(p.amountPaid as Prisma.Decimal)),
   ```
   The arithmetic is correct (uses Decimal), but the final `Number()` wraps via `valueOf()`. Use `.toNumber()` for clarity.

### Info

- `PromiseService.createPromise` uses a Serializable-isolation `$transaction` to prevent concurrent double-promise creation (C2/N3 fix, noted in code comment) — good pattern.
- `installment-allocator.util.ts` is a new utility for FIFO installment targeting — not yet covered by the E2E spec (`promise-lifecycle-happy.spec.ts` exists but is a smoke test).
- `usePromiseSlots.ts` is pure local state (no API calls) — correct for the slot-editor UI component.
- `backfill-promise-slots.ts` script exists in `apps/api/scripts/` — should only be run once in production against a dry-run first.

### Recommendation: ⚠️ REVIEW

Fix the 4 `Number()` / `as never` issues before merge. These are low-risk in practice (Prisma coerces safely for amounts in normal Thai Baht ranges) but violate the explicit-Decimal project convention established in hardening v4 (53 `Number()` → `Prisma.Decimal` fixes). Keeping them now sets a precedent that could hide a precision bug on larger amounts.

**Suggested fix (5 min)**:
```ts
// overdue.service.ts — legacy slot path
settlementAmount: new Prisma.Decimal(dto.settlementAmount ?? 0),

// queue.service.ts
settlementAmount: new Prisma.Decimal(s.settlementAmount).toNumber(),

// promise.service.ts — remove as never, type CreatePromiseSlotInput.settlementAmount as Prisma.Decimal | number | string
```

---

## Branch 3: `chore/audit-quick-wins`

**Last commit**: 2026-04-26 20:17 +07:00  
**Files changed**: 13 total (11 TS/TSX)  
**Scope**: Security hardening on public-facing shop controllers — bot-defense guards, rate limits, file upload validators, address cap, dashboard N+1 query fix.

### Critical Issues — None

- All shop controllers (`shop-auth-social`, `shop-installment-apply`, `shop-reservation`, `shop-tracking`, `staff-chat/web-widget`) already lacked `JwtAuthGuard` (intentionally public / LIFF / shop-customer flows). The branch adds `ShopBotDefenseGuard` as the appropriate public-facing guard. ✅
- Internal controllers (`customers`, `journal`, `line-oa`, `broadcast`) already had `JwtAuthGuard` + `RolesGuard` — changes are additive only (file validators, query-param caps) ✅
- **Money handling**: Dashboard service refactor uses `new Prisma.Decimal(a._sum.sellingPrice ?? 0).toNumber()` — correct ✅
- **SQL injection**: No new raw queries ✅
- **Secrets**: None ✅

### Warning Issues — None

### Info

- `ShopAuthSocialController`: Added `AbortSignal.timeout(10_000)` to LINE/Facebook fetch calls — prevents hung requests from blocking the event loop.
- `shop/reservations`, `shop/track`: `@Throttle({ short: { limit: 30, ttl: 60_000 } })` added — requires `ThrottlerModule` to have a `short` named guard configured in `app.module.ts`. Verify this named guard exists (the global guard uses `default` key by convention).
- `WebWidgetController.initRoom`: `@Body() body: InitWidgetDto` replaces `Record<string, unknown>` — closes an unvalidated input path on a public endpoint.
- `addAddress` in `shop-me.controller.ts`: capped at `MAX_SHIPPING_ADDRESSES = 20` — good DoS mitigation.
- `getReferralStats` / `getWatchList` / `getUpsellCandidates`: `limit` query param now capped at 100 via `Math.min()` — prevents unbounded DB scans.
- Dashboard `getSalesByStaff`: Replaced `findMany` + JS `reduce` with `groupBy` + batched user/branch lookups — eliminates N+1 on the staff leaderboard query.

### Recommendation: ✅ APPROVE

Pure hardening with no regressions. Verify the `short` ThrottlerModule guard key exists before deploy.

---

## Appendix: Branches Not Reviewed This Run

The following branches were observed but excluded (docs-only, dependency upgrades, or older than 3 days):

- `docs/*` — documentation branches, no TS/TSX code
- `chore/deps-tier3-*` — dependency upgrade chunks (review separately with `npm audit`)
- `reports/weekly-*` — weekly report branches
- `claude/*` — auto-generated agent branches (Claude plans/reviews)
- All `feat/collections-*` branches older than 2026-04-25 — deferred to next run cycle

---

*Generated by Pre-Merge Guard agent — `guard/review-2026-04-28` branch*
