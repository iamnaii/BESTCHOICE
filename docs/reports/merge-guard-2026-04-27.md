# Pre-Merge Guard Report — 2026-04-27

**Generated**: 2026-04-27  
**Reviewed by**: Pre-Merge Guard Agent  
**Author (all branches)**: Akenarin Kongdach

---

## Branches Reviewed

| Branch | Files Changed | Verdict |
|--------|---------------|---------|
| `chore/audit-quick-wins` | 13 | ✅ APPROVE |
| `redesign/liff-pay-scan-only` | 2 | ⚠️ REVIEW |
| `feat/liff-early-payoff-direct-paysolutions` | 1 | ⚠️ REVIEW |

---

## Branch 1: `chore/audit-quick-wins`

### Commits
- `perf(audit): dashboard staff metrics groupBy + 3 compound indexes`
- `fix(security): throttle public endpoints + file upload validators`

### File Changes Summary
- `apps/api/prisma/schema.prisma` — 3 new compound indexes (`Contract`, `NotificationLog`, `ChatRoom`)
- `apps/api/prisma/migrations/20260426131551_add_audit_compound_indexes/migration.sql` — idempotent `CREATE INDEX IF NOT EXISTS`
- `apps/api/src/modules/dashboard/dashboard.service.ts` — `getStaffMetrics()` refactored from `findMany` + JS reduce → `groupBy` aggregation + 2 batched name lookups (eliminates N+1 + full-table load)
- `apps/api/src/modules/customers/customers.controller.ts` — `limit` params capped at 100 via `Math.min()`
- `apps/api/src/modules/journal/journal.controller.ts` — `limit` capped at 100
- `apps/api/src/modules/line-oa/broadcast.controller.ts` — `ParseFilePipe` with `MaxFileSizeValidator` (10MB) + `FileTypeValidator` (jpeg/png/gif/webp)
- `apps/api/src/modules/line-oa/line-oa.controller.ts` — `ParseFilePipe` on 2 rich menu image upload endpoints (1MB + jpeg/png only)
- `apps/api/src/modules/shop-auth-social/shop-auth-social.controller.ts` — `ShopBotDefenseGuard` + `@Throttle({ short: { limit: 5, ttl: 60_000 } })` on all 3 endpoints + `AbortSignal.timeout(10_000)` on LINE/Facebook fetch calls
- `apps/api/src/modules/shop-installment-apply/shop-installment-apply.controller.ts` — `ShopBotDefenseGuard` + `@Throttle` on POST submit
- `apps/api/src/modules/shop-me/shop-me.controller.ts` — `addAddress` now typed with `ShippingAddressDto` (was `Record<string,unknown>`) + `MAX_SHIPPING_ADDRESSES = 20` cap
- `apps/api/src/modules/shop-reservation/shop-reservation.controller.ts` — `ShopBotDefenseGuard` + `@Throttle` at class level
- `apps/api/src/modules/shop-tracking/shop-tracking.controller.ts` — `ShopBotDefenseGuard` + `@Throttle` on track endpoint
- `apps/api/src/modules/staff-chat/web-widget.controller.ts` — `InitWidgetDto` class with `@IsString @MaxLength(64)` + `@Throttle` on `init` and `messages/:roomId`

### Issues

#### Critical
_None found._

#### Warning

**W1 — `dashboard.service.ts:~680`**: Unused variable `sellingSum` in the `existing` accumulation branch.  
```typescript
const sellingSum = new Prisma.Decimal(a._sum.sellingPrice ?? 0).toNumber(); // computed…
if (existing) {
  // …but totalSales re-computes the same expression inline:
  existing.totalSales = new Prisma.Decimal(existing.totalSales)
    .add(new Prisma.Decimal(a._sum.sellingPrice ?? 0)).toNumber();
}
```
`sellingSum` is only used in the `else` branch. Minor dead code — no correctness impact but lint will flag it.

**W2 — `shop-me.controller.ts`: `findUnique` missing `deletedAt: null`**  
```typescript
const c = await this.prisma.customer.findUnique({ where: { id: req.user.sub } });
```
`findUnique` will return a soft-deleted customer if one exists with that ID. Since the JWT guard already validates the customer is active (token would have been issued before soft-delete), the practical risk is low — but it diverges from the project-wide `deletedAt: null` convention.

#### Info

**I1 — `dashboard.service.ts` branch-aggregation semantics**: The new `groupBy` by `[salespersonId, branchId]` then collapses to one row per salesperson where "first branch wins." The comment documents this intentional match to old semantics. No correctness issue.

**I2 — Migration uses `IF NOT EXISTS`**: Safe for idempotent re-runs on dev DBs. Correct approach.

### Recommendation: ✅ APPROVE

All changes are net security and performance improvements. Fix W1 (dead variable) before or after merge — it's cosmetic only.

---

## Branch 2: `redesign/liff-pay-scan-only`

### Commits
- 1 commit: LIFF payment page redesign removing slip upload / manual transfer tab

### File Changes Summary
- `apps/web/src/pages/liff/LiffPayment.tsx` — Major refactor (1016 → ~412 lines). Removes: `slipMutation`, `validateSlipFile`, `qrUrl` state, `Tabs` component, manual transfer UI. Adds: `useLiffInit` for auth restoration, `ShieldCheck`/`Smartphone` icons, scan-to-pay single-CTA layout. State machine simplified: `select-method` → `ready`, removes `slip-uploaded` state.
- `apps/web/e2e/liff-payment.spec.ts` — Removes 2 old tests ("payment method tabs", "slip upload in transfer tab"), adds "scan-to-pay CTA with Pay Solutions trust badge" test. Updates text assertions to match new UI.

### Issues

#### Critical
_None found._

#### Warning

**W1 — Product decision: slip upload removed without documented owner approval**  
The slip upload flow (`โอนเอง` tab) is entirely removed. Customers who cannot use scan-to-pay (e.g., those paying via inter-bank transfer and uploading a slip manually) have no fallback in the new UI. This is a significant UX change — confirm the business owner approved removing this payment path before merging.

**W2 — `queryLineId` fallback may silently fail**  
```tsx
const queryLineId =
  new URLSearchParams(window.location.search).get('lineId') || hookLineId || '';
```
If both URL param and `useLiffInit()` return empty, `queryLineId` is `''`. The `create-intent` API call proceeds with `lineId: ''`, which `LiffTokenGuard` will reject with a 401. The `onError` handler shows a generic toast — user sees no actionable message. Consider adding an early guard:
```tsx
if (!queryLineId) {
  setView('error');
  setErrorMessage('ไม่พบข้อมูล LINE กรุณาเปิดผ่าน LINE อีกครั้ง');
  return;
}
```

#### Info

**I1 — Line count reduction of ~60% is healthy.** The old file was 1016 lines; the redesign is ~412. The complexity reduction is a maintenance win.

**I2 — `useQuery` correctly gated on `!authLoading`**: `enabled: !!token && !authLoading` prevents a 401 race where the API is called before the LIFF ID token is restored from session.

**I3 — E2E tests updated in sync with UI changes.** The removed tests covered flows that no longer exist; new test covers the new CTA.

### Recommendation: ⚠️ REVIEW

Merge after confirming with business owner that the slip-upload payment path is intentionally removed (W1). Fix W2 (empty lineId guard) before or at merge.

---

## Branch 3: `feat/liff-early-payoff-direct-paysolutions`

### Commits
- 1 commit: `feat(liff-early-payoff): skip /pay/{token} landing, jump to PaySolutions`

### File Changes Summary
- `apps/web/src/pages/liff/LiffEarlyPayoff.tsx` — `payoffMutation` changed: old path called `/line-oa/liff/early-payoff` → new path calls `/paysolutions/create-intent` directly with `{ contractId, amount, description, lineId }`. Response shape changes from `{ url, token, totalPayoff }` to `{ success, paymentId, paymentUrl, gatewayRef }`. Adds guard on `if (result.paymentUrl)` before redirecting.

### Issues

#### Critical
_None found._

#### Warning

**W1 — `amount: Number(quote.totalPayoff)` — Decimal→Number for API payload**  
```tsx
amount: Number(quote.totalPayoff),
```
`quote.totalPayoff` comes from the backend as a Decimal string. `Number()` conversion is safe for amounts up to ~9 quadrillion (no risk for phone installments in Thailand), but is not idiomatic given the project's Decimal-first policy. Prefer `parseFloat(String(quote.totalPayoff))` or keep as string and let the backend coerce:
```tsx
amount: parseFloat(String(quote.totalPayoff)),
```

**W2 — Backend `create-intent` validation bypass via omitted `installmentNo`**  
The code comment says:
> `installmentNo` is intentionally omitted so backend skips per-installment amount validation (the payoff amount intentionally exceeds any single installment).

This means `create-intent` has two code paths: with `installmentNo` (validates amount ≤ installment amount) and without (no upper-bound validation). Before merging, confirm the `/paysolutions/create-intent` service verifies:
1. `contractId` belongs to the authenticated customer (via `lineId` + LiffTokenGuard)
2. `amount` matches the server-computed payoff quote (not a client-supplied arbitrary value)
3. The endpoint is rate-limited (it was not shown in the diff)

If the backend trusts the client-supplied `amount` without re-computing the payoff quote server-side, this is a **P1 financial integrity bug**.

**W3 — Missing guard for empty `lineId`**  
```tsx
const { data: intent } = await liffApi.post('/paysolutions/create-intent', {
  contractId,
  amount: Number(quote.totalPayoff),
  description: `ปิดยอดก่อนกำหนด สัญญา ${quote.contractNumber}`,
  lineId,
});
```
`lineId` comes from `useLiffInit()`. If LIFF init failed silently, `lineId` is `undefined`/`''`, and the backend will reject with 401. The `onError` handler shows `err.message` via `toast.error()` which for a 401 will show a generic Axios error, not a user-friendly Thai message.

#### Info

**I1 — Flow simplification is correct**: Removing the `/line-oa/liff/early-payoff` hop (which only minted a `PaymentLink` shell before redirecting to `/pay/{token}`) and calling `create-intent` directly is architecturally cleaner.

**I2 — `paymentUrl` guard added**: The `if (result.paymentUrl) { ... } else { toast.error(...) }` guard is a good defensive addition vs the old unconditional `window.location.href = result.url`.

### Recommendation: ⚠️ REVIEW

**W2 is the highest-priority concern** — verify server-side that `/paysolutions/create-intent` without `installmentNo` re-validates the amount against a server-computed payoff quote rather than trusting the client-supplied figure. If it does, APPROVE after fixing W3's error messaging.

---

## Summary

| Branch | Critical | Warning | Info | Verdict |
|--------|----------|---------|------|---------|
| `chore/audit-quick-wins` | 0 | 2 | 2 | ✅ APPROVE |
| `redesign/liff-pay-scan-only` | 0 | 2 | 3 | ⚠️ REVIEW |
| `feat/liff-early-payoff-direct-paysolutions` | 0 | 3 | 2 | ⚠️ REVIEW |

### Action Items Before Merge

1. **`chore/audit-quick-wins`**: Fix dead variable `sellingSum` (W1) — cosmetic only, can fix post-merge.
2. **`redesign/liff-pay-scan-only`**: Confirm business owner approved removing slip-upload payment path; add empty-lineId guard in `LiffPayment.tsx`.
3. **`feat/liff-early-payoff-direct-paysolutions`**: Audit `/paysolutions/create-intent` backend to confirm `amount` is validated server-side when `installmentNo` is omitted (W2 — financial integrity). Add user-friendly error for empty `lineId` (W3).
