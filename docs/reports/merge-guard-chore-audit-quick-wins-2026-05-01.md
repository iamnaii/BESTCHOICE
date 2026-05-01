# Pre-Merge Guard Report

**Branch**: `chore/audit-quick-wins`
**Author**: Akenarin Kongdach <iamnaii@MacBook-Pro-khxng-Akenarin.local>
**Date**: 2026-05-01
**Base**: `origin/main`
**Commits**:
- `b00d5ac5` fix(security): throttle public endpoints + file upload validators
- `b42b7bb9` perf(audit): dashboard staff metrics groupBy + 3 compound indexes

---

## File Changes Summary

13 files changed, 209 insertions(+), 44 deletions(-)

| File | Change |
|------|--------|
| `apps/api/prisma/migrations/…/migration.sql` | +15 — 3 compound indexes (NotificationLog, Contract, ChatRoom) |
| `apps/api/prisma/schema.prisma` | +7 — schema annotations for new indexes |
| `apps/api/src/modules/customers/customers.controller.ts` | +14 — cap `limit` query param (Math.min → 100) |
| `apps/api/src/modules/dashboard/dashboard.service.ts` | +121/-61 — staff metrics: groupBy instead of findMany+JS reduce |
| `apps/api/src/modules/journal/journal.controller.ts` | +2/-1 — cap journal list `limit` to 100 |
| `apps/api/src/modules/line-oa/broadcast.controller.ts` | +15 — ParseFilePipe: 10MB + MIME type validation |
| `apps/api/src/modules/line-oa/line-oa.controller.ts` | +24 — ParseFilePipe: 1MB + image/jpeg/png validation |
| `apps/api/src/modules/shop-auth-social/shop-auth-social.controller.ts` | +11 — ShopBotDefenseGuard + Throttle(5/min) + AbortSignal.timeout |
| `apps/api/src/modules/shop-installment-apply/shop-installment-apply.controller.ts` | +4 — ShopBotDefenseGuard + Throttle(5/min) |
| `apps/api/src/modules/shop-me/shop-me.controller.ts` | +15 — DTO typing + MAX_SHIPPING_ADDRESSES=20 limit |
| `apps/api/src/modules/shop-reservation/shop-reservation.controller.ts` | +6 — ShopBotDefenseGuard + Throttle(30/min) |
| `apps/api/src/modules/shop-tracking/shop-tracking.controller.ts` | +6 — ShopBotDefenseGuard + Throttle(30/min) |
| `apps/api/src/modules/staff-chat/web-widget.controller.ts` | +13 — InitWidgetDto with MaxLength(64) + Throttle |

---

## Issues by Severity

### ⛔ Critical — None

No critical issues found.

---

### ⚠️ Warning

#### W-1 · `dashboard.service.ts:670,685` — `user.findMany` and `branch.findMany` missing `deletedAt: null`

```ts
// dashboard.service.ts ~line 670
this.prisma.user.findMany({
  where: { id: { in: salespersonIds } },  // ← no deletedAt: null
  select: { id: true, name: true },
})

this.prisma.branch.findMany({
  where: { id: { in: branchIds } },       // ← no deletedAt: null
  select: { id: true, name: true },
})
```

**Impact**: Soft-deleted employees or branches can appear in the staff performance dashboard with their name, as if they were active. This is a data quality issue — not a security issue — but violates the project's mandatory soft-delete filter rule.

**Fix**: Add `deletedAt: null` to both `where` clauses:
```ts
where: { id: { in: salespersonIds }, deletedAt: null }
where: { id: { in: branchIds }, deletedAt: null }
```

---

#### W-2 · `shop-me.controller.ts` — controller injects PrismaService directly (no service layer)

The controller accesses `this.prisma.customer.findUnique/update` directly, bypassing the service-layer rule in `backend.md`. The `ShopMeController` has no dedicated service — this is pre-existing, but this PR extends the controller with new address limit logic without moving Prisma calls to a service.

**Impact**: Logic is harder to test and violates the architecture pattern (controller → service → Prisma).

**Recommended fix** (not blocking on its own, but note before next refactor): extract to `ShopMeService`.

---

### ℹ️ Info

#### I-1 · `dashboard.service.ts` — `sellingSum.toNumber()` for dashboard display

```ts
const sellingSum = new Prisma.Decimal(a._sum.sellingPrice ?? 0).toNumber();
```

`sellingSum` is stored in an in-memory JS object (`staffMap`) for dashboard display only — it is **not** persisted to the database. Accumulation still uses `Prisma.Decimal.add()` (correct). The `.toNumber()` conversion is acceptable for a display-only aggregate that is served to the frontend as a JSON number. No financial record is written from this value.

**No action required.**

#### I-2 · Other branches not reviewable via 3-dot diff

The following branches diverged too far from `main` to produce a clean three-dot diff (`git diff origin/main...origin/<branch>` returns empty):
- `refactor/contract-create-unify-docs` — only tip commit reviewable (removes DocumentUploadStep.tsx, -520 LOC, frontend only, no security concerns in tip commit)
- `chore/quickbuy-step1-reorder` — only tip commit reviewable (UI field reorder in QuickBuyModal.tsx, cosmetic only)
- `redesign/liff-pay-scan-only` — merge-base not found (unrelated history)

These branches should **rebase on current `main`** before merge to enable accurate diff review.

---

## Positive Findings

This branch is a well-structured security hardening pass. Notable improvements:

- **ShopBotDefenseGuard** applied to 4 public shop controllers that previously had no bot protection
- **Throttle decorators** on all new public endpoints (5–60 req/min depending on sensitivity)
- **ParseFilePipe** with `MaxFileSizeValidator` + `FileTypeValidator` on file upload endpoints (broadcast image, LINE rich menu image) — prevents oversized or malicious file types
- **AbortSignal.timeout(10_000)** on all external API calls (LINE, Facebook) — prevents hung requests
- **MAX_SHIPPING_ADDRESSES=20** guard on address accumulation — prevents unbounded JSON growth in a JSONB column
- **`limit` capping** (`Math.min(parseInt(limit), 100)`) on 4 list endpoints — prevents oversized result sets
- **Dashboard groupBy refactor**: replaces full contract `findMany` (all rows) with a Postgres-side `groupBy` + two batched lookups — significant query performance improvement for busy months
- **3 compound indexes** for hot cron paths (NotificationLog dedup, Contract SLA scan, ChatRoom first-response SLA) — with `IF NOT EXISTS` for idempotent re-runs

---

## Recommendation

```
✅ APPROVE — with Warning items addressed
```

**W-1** (missing `deletedAt: null` on user/branch findMany) is the only item that needs a code fix before merge. It is a 2-line change. W-2 (service layer) is a pre-existing architectural note and does not block merge.

The branch as a whole improves the security and performance posture of the codebase substantially.
