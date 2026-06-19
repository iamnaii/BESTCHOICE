# Pre-Merge Guard Report — 2026-06-19 (Run 2)

**Generated**: 2026-06-19  
**Agent**: Pre-Merge Guard (scheduled)  
**Branch scanned**: `feat/contacts-audit-cleanup` → PR #1150  
**New worktree branches detected**: `worktree-feat+sp7.1-dual-prisma-foundation`, `worktree-feat-shop-sales-ai-phase-a`

---

## Summary

| Branch | Open PR | Critical | Warning | Info | Verdict |
|--------|---------|----------|---------|------|---------|
| `feat/contacts-audit-cleanup` | #1150 | 0 | 0 | 1 | ✅ APPROVE |
| `worktree-feat+sp7.1-dual-prisma-foundation` | None (WIP) | — | — | — | In-progress |
| `worktree-feat-shop-sales-ai-phase-a` | None (WIP) | — | — | — | In-progress |

---

## PR #1150 — feat/contacts-audit-cleanup

**Title**: feat(contacts): trade-in seller name on contact card + audit cleanup  
**Author**: Akenarin Kongdach  
**Created**: 2026-06-04  
**Unique commits**: 1 (`2d3f7428`)

### Files Changed (6 total)

| File | +/- | Notes |
|------|-----|-------|
| `apps/web/src/pages/ContactDetailPage.tsx` | +10/−4 | UI: show sellerName+phone in TradeInTile |
| `apps/web/src/pages/__tests__/ContactDetailPage.test.tsx` | +37/0 | 2 new regression tests |
| `docs/superpowers/specs/2026-06-01-contact-rich-fields-A1-design.md` | +1/−1 | Header update |
| `docs/superpowers/specs/2026-06-02-contact-360-presentation-redesign-design.md` | +1/−1 | Header update |
| `docs/superpowers/specs/2026-06-02-contact-financial-snapshot-C-design.md` | +1/−1 | Header update |
| `docs/superpowers/specs/2026-06-02-contact-hardening-design.md` | +1/−1 | Header update |

### Change Summary

**ContactDetailPage.tsx** — `TradeInTile` component now renders `ชื่อผู้ขาย` (seller name + phone) next to the purchase date in a 2-column grid, per spec §2 of the 360 presentation redesign. Previously only the date was shown. The field is nullable-safe: the display falls back gracefully through `sellerName → sellerPhone → null`.

**ContactDetailPage.test.tsx** — Two new tests:
1. `shows the seller name in the trade-in tile` — verifies seller name + parenthesised phone in the tile.
2. `hides the summary strip when the summary fetch fails` — regression test ensuring the customer card/hero remain visible on summary API failure; asserts the fetch was actually fired (not a false positive from an un-fired query).

**Docs** — 4 spec headers updated from stale `รออนุมัติ` → `✅ DONE` with correct merge commits (work shipped 2026-06-02).

### Checklist

**Critical**

- [x] No new controllers — no `@UseGuards` / `@Roles` gaps
- [x] No money/financial field changes — no `Number()` risk
- [x] No new Prisma queries — no missing `deletedAt: null`
- [x] No hardcoded secrets or API keys
- [x] No raw SQL / `$queryRaw`

**Warning**

- [x] No new DTOs — no missing class-validator decorators
- [x] No new service methods — no missing error handling
- [x] No direct `fetch()` calls — component uses props only (no API calls in the diff)
- [x] No mutations — no `queryClient.invalidateQueries` gap
- [x] No new DTOs — no Thai validation message requirement

**Info**

- [ ] `value={tradeIn.sellerPhone}` fallback (when `sellerName` is null) renders `null` if both fields are null. The `Field` component handles `null` gracefully (renders empty), so this is not a bug — just worth noting for readability. Accepted as-is.

### Recommendation: ✅ APPROVE

Clean, minimal frontend-only patch with good test coverage. 0 critical issues. The one Info item is an acknowledged edge case handled correctly at runtime.

---

## New Worktree Branches (Not Open PRs — Monitoring Only)

Two new branches appeared with today's `git fetch`. Neither has an open PR.

### `worktree-feat+sp7.1-dual-prisma-foundation`

**Topic**: P3-SP7 SHOP/FINANCE legal entity split — dual Prisma client foundation.  
**Unique commits**: 20+ (sp7.1 through sp7.10 scaffolding).  
**Key changes observed**:
- `PrismaFinanceService` — second Prisma client pointing at `DATABASE_URL_FINANCE`
- `EntityScopeGuard` + `@Entity()` decorator — route-level SHOP/FINANCE scoping
- `EntityScope` middleware + JWT `accessibleCompanies`/`primaryCompany`
- `OutboxProcessorService` — cross-entity JE saga outbox
- CI dual-postgres service in `e2e-tests.yml`

**Status**: Active development, no open PR. Scope is large (architectural).  
**Next guard action**: Review when PR opens. No action needed today.

### `worktree-feat-shop-sales-ai-phase-a`

**Topic**: SHOP Sales AI bot — Gemini-powered auto-reply for chat rooms.  
**Unique commits**: 20+ (shop-ai series, branched from `a420359a`).  
**Key changes observed**:
- New `@UseGuards(JwtAuthGuard)` + `@Roles(...)` on `2fa` controller (properly guarded)
- New `getPeriodStatus` + `closePeriod` endpoints on existing `AccountingController` (class-level JwtAuthGuard applies)
- `VIEWER` role referenced in `@Roles('OWNER', 'VIEWER')` on `getPeriodStatus` — confirm this role is defined in `UserRole` enum before merge
- PromptPay QR generation wired into `capture_lead` AI flow
- TikTok channel stub (auto-reply blocked — defense in depth)
- `Customer.acquisitionSource` VarChar(50) + partial index (Prisma schema change)
- 2FA module added to `app.module.ts`

**Pre-merge flag (Warning)**: `VIEWER` role usage — verify it exists in the Prisma `UserRole` enum before this branch opens a PR. Pattern: check `schema.prisma` for `VIEWER` in the `UserRole` enum.

**Status**: Active development, no open PR.

---

## Previous Run Today

Run 1 (`guard/review-2026-06-19`) reviewed: `feat/employee-master` (APPROVE), `feat/payroll-backfill` (REVIEW), `fix/ci-pre-existing-test-failures` (APPROVE). 0 Critical issues across all 3 branches.

---

*Pre-Merge Guard — automated review, scheduled run.*
