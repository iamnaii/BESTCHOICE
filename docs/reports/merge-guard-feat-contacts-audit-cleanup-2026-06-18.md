# Merge Guard Report — feat/contacts-audit-cleanup

**Date**: 2026-06-18  
**Branch**: `feat/contacts-audit-cleanup`  
**PR**: [#1150](https://github.com/iamnaii/BESTCHOICE/pull/1150) — feat(contacts): trade-in seller name on contact card + audit cleanup  
**Author**: iamnaii  
**PR opened**: 2026-06-04  
**Base SHA at PR open**: `3ad5e99c` (current main: `a420359a` — 2 merges ahead)

---

## Summary

6 files changed — frontend-only (no backend, no schema, no migrations).

| File | Change |
|------|--------|
| `apps/web/src/pages/ContactDetailPage.tsx` | +14 -4 — `TradeInTile` shows sellerName + sellerPhone in 2-col grid |
| `apps/web/src/pages/__tests__/ContactDetailPage.test.tsx` | +37 — 2 new tests (seller-name display + summary-fetch-failure resilience) |
| `docs/superpowers/specs/2026-06-01-contact-rich-fields-A1-design.md` | "รออนุมัติ" → "✅ DONE" |
| `docs/superpowers/specs/2026-06-02-contact-360-presentation-redesign-design.md` | status update |
| `docs/superpowers/specs/2026-06-02-contact-financial-snapshot-C-design.md` | status update |
| `docs/superpowers/specs/2026-06-02-contact-hardening-design.md` | status update |

---

## Issues by Severity

### 🔴 Critical — NONE

- No new controllers → no guard coverage gap
- No financial/money fields → no `Number()` risk
- No Prisma queries → no soft-delete risk
- No hardcoded secrets
- No SQL injection surface

### 🟡 Warning

**W1 — CI cancelled on all key checks**

All three critical CI jobs were cancelled, not failed:

| Job | Result |
|-----|--------|
| Lint & Test | ❌ cancelled (ran ~6 hours: 15:34–21:34 UTC) |
| E2E Tests (1) | ❌ cancelled |
| E2E Tests (2) | ❌ cancelled |
| Merge E2E Reports | ✅ success |
| Deploy jobs | ⏭ skipped (expected for PRs) |

A 6-hour runtime before cancellation on `Lint & Test` is abnormal. Root cause unclear (manual cancel? runner timeout?). The PR cannot be verified green without CI passing.

**W2 — PR is 14 days stale; not rebased onto current main**

Base SHA `3ad5e99c` is 2 merges behind `a420359a`. Merges since PR opened include `feat/master-data-into-settings` and `fix/master-data-settings-zone`. Risk of conflict is low (this PR only touches `ContactDetailPage.tsx` + docs), but rebase + fresh CI run is needed before merge.

### 🟢 Info

**I1 — Dynamic import inside test**

`ContactDetailPage.test.tsx` uses `await import('@/lib/api/customers')` inside the test body (line ~252). This is a valid Vitest pattern for mocking after `vi.mock()` hoisting, but unusual. Worth double-checking the mock wiring is correct if CI results show this test flakey.

**I2 — Conditional seller display**

```tsx
value={
  tradeIn.sellerName
    ? `${tradeIn.sellerName}${tradeIn.sellerPhone ? ` (${tradeIn.sellerPhone})` : ''}`
    : tradeIn.sellerPhone
}
```

Fallback to `tradeIn.sellerPhone` alone (no name) is valid UX. If both are null, `<Field>` receives `undefined` — confirm `<Field>` renders a dash/empty gracefully (no visible crash risk, just display).

---

## Code Quality

The frontend change is clean:
- Uses Tailwind grid tokens, not hardcoded colors ✅
- No raw `fetch()` — reads from prop passed by parent `useQuery` ✅
- `leading-snug` on `CardTitle` (Thai text convention) ✅
- Tests cover both the happy path and the error-path separately ✅

---

## Recommendation

**⏸ REVIEW — Re-trigger CI before merging**

The code change itself is safe and well-structured. There are no critical security or correctness issues. However:

1. **Re-trigger CI** — All three test jobs were cancelled. Must confirm Lint & Test + E2E pass.
2. **Rebase onto main** — `git rebase origin/main` to pick up the 2 subsequent merges and ensure no conflicts.
3. Once CI is green on a rebased HEAD → safe to merge.

No blocking code defects found.
