# Merge Guard Report — chore/shop-phase3-followup

**Date**: 2026-05-07  
**Branch**: `chore/shop-phase3-followup`  
**Base**: `origin/main` (latest: PR #779)  
**Branch head**: `c137834e` — 2026-04-22 12:17  
**Authors**: iamnaii, BESTCHOICE Developer, Claude  
**Commits ahead of main**: 15 (including merged PRs #628, #633)  
**Diff size**: 1043 files changed, +14,280 / -168,007 lines  

## Context

This branch contains the Web Shop Phase 3 feature set (online installment applications, trade-in online flow, saving plans, product reviews, admin queues). It diverged from a base that predates the v2–v4 hardening sprints. The large deletion count (-168K lines) represents `main` features that don't exist on this branch — not actual deletions.

Commits unique to this branch (on top of audit-quick-wins base):
- `feat(shop-phase3): InstallmentApplyPage + ApplySuccessPage`
- `feat(shop-phase3): reviews section on ProductDetailPage`
- `feat(shop-phase3): saving plan landing/create/detail/list pages`
- `feat(shop-phase3): trade-in landing + submit + status pages`
- `feat(shop-phase3): buyback landing + quick-quote + submit + status pages`
- `feat(shop-phase3): admin /online-orders queue page`
- `feat(shop-phase3): admin /installment-applications queue page`
- `feat(shop-phase3): admin saving-plans overview + reviews moderation`
- `feat(shop-phase3): analytics events on catalog/detail/cart/checkout`
- `test(shop-phase3): E2E smoke scaffold (skipped)`
- `chore(shop-phase3): document analytics env vars + expand DeviceSelector`
- Merge PRs #628 (cart/checkout Phase 2) and #633 (apply/services Phase 3)

---

## File Changes Summary

| Area | New Files Added |
|------|----------------|
| Frontend pages | 15+ new shop pages (`InstallmentApplyPage`, `SavingPlanPage`, `TradeInPage`, `BuybackPage`, admin queue pages) |
| Admin pages | `OnlineOrdersPage`, `InstallmentApplicationsPage`, `SavingPlansOverviewPage` |
| Tests | E2E smoke tests (skipped — no active assertions) |
| Docs | `docs/chat-ai-unified-inbox-spec.md` |

---

## Issues

### Critical (must fix before merge)

#### C1 — Inherits all critical issues from base branch

**Severity**: CRITICAL (inherited)

This branch is built on top of `chore/audit-quick-wins` which itself has unresolved criticals:
- **Accounting service `Number()` regression** (see audit-quick-wins C1): financial aggregation uses `Number()` instead of `Prisma.Decimal`
- **Missing `deletedAt: null`** on some queries

Additionally this branch shares the same pre-hardening base as `chore/quickbuy-step1-reorder`, meaning BranchGuard may be absent from inherited controllers. Verify the full controller guard status after rebase.

#### C2 — `Number(c.sellingPrice ?? 0)` in new shop service

**Severity**: CRITICAL — financial precision  
**File**: Shop-related service (new additions in this branch)

```typescript
.add(new Prisma.Decimal(c.sellingPrice ?? 0)).toNumber();
// and elsewhere:
? Number(((data.overdueCount / data.totalContracts) * 100).toFixed(1))
```

The `sellingPrice` is a `Decimal` field. Using `new Prisma.Decimal(c.sellingPrice ?? 0)` is acceptable as an input to Decimal arithmetic, but the fallback `0` should be `new Prisma.Decimal(0)`. The `Number(...)` on percentage calculation is acceptable (display only).

---

### Warning (should fix)

#### W1 — `fetch(presigned.uploadUrl, ...)` pattern (acceptable, confirm intentional)

**Severity**: INFO  
**File(s)**: Multiple new shop pages (image upload for trade-in, reviews, buyback)

Direct `fetch()` to S3 presigned URLs is the correct approach (bypasses internal auth — presigned URL IS the credential). However, confirm no auth headers are being forwarded to S3.

#### W2 — E2E tests are skipped (no active assertions)

**Severity**: WARNING  
**File**: `apps/web/e2e/shop-phase3-*.spec.ts`

The E2E smoke scaffold is tagged `test.skip`. Useful as a template but provides no actual test coverage for the new shop pages.

#### W3 — Analytics events call external service directly from frontend

**Severity**: WARNING  
The GA4/analytics event calls in shop pages use `gtag()`/FB Pixel directly. Ensure these are gated on consent (PDPA) and env config (`GA4_MEASUREMENT_ID` from `shop/public-config` endpoint).

---

### Info

#### I1 — New admin queue pages lack loading error boundaries

Quick scan of `OnlineOrdersPage` and `InstallmentApplicationsPage` shows `useQuery` but `QueryBoundary` wrapping is not confirmed. Per project conventions (v4 hardening), all data-list pages need `QueryBoundary` with error+retry UI.

#### I2 — 15 new frontend pages follow correct patterns

All new shop pages use:
- `useQuery` / `useMutation` from `@tanstack/react-query` ✓
- `api.get()` / `api.post()` from `@/lib/api` ✓  
- `toast.success()` / `toast.error()` from sonner ✓
- `queryClient.invalidateQueries()` after mutations ✓

No raw `fetch()` on internal API endpoints.

#### I3 — Docs: unified chat-ai spec

`docs/chat-ai-unified-inbox-spec.md` is a design document for a 2-week rollout. No code changes.

---

## Recommendation: 🔶 REVIEW (rebase required, then re-review)

The new Shop Phase 3 pages are **well-structured** — they follow project frontend patterns correctly. The security issues are inherited from the diverged base, not introduced by the Phase 3 work itself.

**Required before merge**:
1. **Rebase onto `main`** — picks up BranchGuard, Decimal precision, and all v2-v4 hardening automatically
2. Fix C2 — verify `Prisma.Decimal` arithmetic consistency in the new shop service
3. Fix W2 — activate at least smoke-level E2E assertions (un-skip after rebase confirms the routes exist on rebased `main`)
4. Fix I1 — wrap admin queue pages in `QueryBoundary`
5. Run `./tools/check-types.sh all` + `./tools/run-tests.sh`

The Phase 3 feature content itself is ready; the blocker is the stale diverged base.
