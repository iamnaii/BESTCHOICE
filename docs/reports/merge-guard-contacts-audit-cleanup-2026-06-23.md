# Merge Guard Report — feat/contacts-audit-cleanup
**Date:** 2026-06-23
**PR:** #1150 — feat(contacts): trade-in seller name on contact card + audit cleanup
**Author:** iamnaii
**Branch:** feat/contacts-audit-cleanup → main
**PR opened:** 2026-06-04 | **Last updated:** 2026-06-22
**Recommendation:** ⚠️ REVIEW (re-run CI before merge)

---

## File Changes Summary

| File | Type | +/- | Notes |
|------|------|-----|-------|
| `apps/web/src/pages/ContactDetailPage.tsx` | Modified | +14 / -4 | `TradeInTile` — show sellerName + sellerPhone |
| `apps/web/src/pages/__tests__/ContactDetailPage.test.tsx` | Modified | +37 / 0 | 2 new tests |
| `docs/superpowers/specs/2026-06-01-contact-rich-fields-A1-design.md` | Modified | +1 / -1 | Status → ✅ DONE |
| `docs/superpowers/specs/2026-06-02-contact-360-presentation-redesign-design.md` | Modified | +1 / -1 | Status → ✅ DONE |
| `docs/superpowers/specs/2026-06-02-contact-financial-snapshot-C-design.md` | Modified | +1 / -1 | Status → ✅ DONE |
| `docs/superpowers/specs/2026-06-02-contact-hardening-design.md` | Modified | +1 / -1 | Status → ✅ DONE |

**Scope:** Frontend-only change. No backend, no Prisma schema, no migrations, no new API endpoints.

---

## Critical Issues

**None found.**

- No new controllers → no missing `@UseGuards` / `@Roles` to check
- No money arithmetic → no `Number()` risk
- No new queries → no missing `deletedAt: null`
- No hardcoded secrets or API keys
- No raw SQL (`$queryRaw`)

---

## Warnings

### ⚠️ W1 — CI was cancelled; no green run on this branch

All three gate jobs (`Lint & Test`, `E2E Tests (1)`, `E2E Tests (2)`) show **`conclusion: cancelled`** on the 2026-06-04 run. There has been no subsequent re-run. The code changes themselves look correct, but neither TypeScript compilation nor unit tests have been validated by CI on this branch.

**Action required:** Push a no-op commit or manually re-trigger CI before merging.

### ⚠️ W2 — Stale base; main has moved ~19 days ahead

PR base SHA (`3ad5e99c`) is the state of main from 2026-06-04. Current main HEAD is a different commit. Main has received significant commits since then (payroll employee-link, employee master, chatbot-finance model upgrades, etc.). A rebase check is needed to confirm there are no merge conflicts in `ContactDetailPage.tsx` or its test file before merging.

---

## Info

### ℹ️ I1 — `sellerPhone`-only path renders as-is

In `TradeInTile`, when `sellerName` is falsy but `sellerPhone` is truthy the `Field` value renders the raw phone string without parentheses. This is intentional (no name to pair with) and consistent with the spec; flagged for awareness only.

```tsx
value={
  tradeIn.sellerName
    ? `${tradeIn.sellerName}${tradeIn.sellerPhone ? ` (${tradeIn.sellerPhone})` : ''}`
    : tradeIn.sellerPhone   // phone alone, no parens — correct
}
```

### ℹ️ I2 — Test mock imports `@/lib/api/customers` dynamically

The second new test uses `await import('@/lib/api/customers')` inside the test body. This pattern works with Vitest's module mock system but is unusual in this codebase. Not a bug; flagged as a style note.

---

## Code Quality Assessment

The diff is small, well-targeted, and low-risk:
- UI change adds a 2-column grid in `TradeInTile` to display sellerName alongside the existing date — correct per spec §2.
- Null-safety is handled correctly (`sellerName ? ... : sellerPhone`).
- Two regression tests are added with clear assertions.
- Doc updates mark 4 specs as DONE with accurate merge references.
- No new dependencies introduced.
- No design token violations (no hardcoded hex, no `text-gray-*`).
- Thai `leading-snug` is present on the `CardTitle` (✅ rule compliant).

---

## Recommendation

**⚠️ REVIEW — Do not merge until:**

1. **CI is re-run and passes** (`Lint & Test` + both `E2E Tests` shards). The cancelled run means there is no green gate on the actual branch code.
2. **Rebase on current main** (or confirm merge is conflict-free). Main is ~19 days ahead; verify `ContactDetailPage.tsx` hasn't been touched in a conflicting way by the emoji/hardening PRs that landed after 2026-06-04.

Once CI is green on the rebased branch, this PR is safe to merge — there are no critical or blocking issues in the code itself.
