# Pre-Merge Guard Report

**Date**: 2026-06-15  
**Run by**: Pre-Merge Guard agent (automated)  
**PRs reviewed**: 1 open PR

---

## PR #1150 — feat(contacts): trade-in seller name on contact card + audit cleanup

| Field | Value |
|-------|-------|
| Branch | `feat/contacts-audit-cleanup` |
| Author | iamnaii |
| Base | `main` |
| Opened | 2026-06-04 |
| Last updated | 2026-06-04 |

### Files Changed (6 total)

| File | Changes | Type |
|------|---------|------|
| `apps/web/src/pages/ContactDetailPage.tsx` | +14 / -4 | UI (frontend) |
| `apps/web/src/pages/__tests__/ContactDetailPage.test.tsx` | +37 / 0 | Tests |
| `docs/superpowers/specs/2026-06-01-contact-rich-fields-A1-design.md` | +1 / -1 | Docs |
| `docs/superpowers/specs/2026-06-02-contact-360-presentation-redesign-design.md` | +1 / -1 | Docs |
| `docs/superpowers/specs/2026-06-02-contact-financial-snapshot-C-design.md` | +1 / -1 | Docs |
| `docs/superpowers/specs/2026-06-02-contact-hardening-design.md` | +1 / -1 | Docs |

### Change Summary

**UI change** — `TradeInTile` in `ContactDetailPage` now shows seller name + phone alongside the purchase date, in a 2-column grid. Previously only showed the date.

- Handles null gracefully: shows `sellerPhone` alone if `sellerName` is null, nothing if both null.
- No backend/API changes. No Prisma schema changes. No new endpoints.

**Tests** — 2 new unit tests added:
1. Verifies `sellerName (sellerPhone)` appears in the trade-in tile.
2. Regression test: summary fetch failure hides the KPI strip but still renders the customer tile + hero.

**Docs** — 4 spec files updated from `รออนุมัติ` → `✅ DONE` to reflect prior merges (PRs #1121, #1122, #1124, merge `e52d2154`). No spec logic changed.

---

## Issues by Severity

### 🔴 Critical (must fix before merge)

**None found.**

- No new controllers — no missing `@UseGuards` to check.
- No financial calculations — no `Number()` on Decimal risk.
- No new queries — no `deletedAt: null` omission risk.
- No hardcoded secrets or API keys.
- No raw `$queryRaw` calls.

### 🟡 Warning (should fix)

**W1 — CI cancelled, not passed**

All three CI jobs that validate code quality were **cancelled**, not completed:
- `Lint & Test` → cancelled (ran for 6 hours before cancel)
- `E2E Tests (1)` → cancelled
- `E2E Tests (2)` → cancelled

The PR description states "ContactDetailPage 9/9 green" but this cannot be verified from CI history. The only completed job is `Merge E2E Reports` (success), which is a report-aggregation step that passes even when the underlying E2E runs were cancelled.

**Action required**: Re-trigger CI and confirm `Lint & Test` + `E2E Tests` pass before merging.

### 🔵 Info

**I1 — Null fallback UX is slightly ambiguous**

In `TradeInTile`, when `sellerName` is null but `sellerPhone` is not:
```tsx
value={
  tradeIn.sellerName
    ? `${tradeIn.sellerName}${tradeIn.sellerPhone ? ` (${tradeIn.sellerPhone})` : ''}`
    : tradeIn.sellerPhone   // ← phone shown under "ชื่อผู้ขาย" label
}
```
Showing a phone number under the label "ชื่อผู้ขาย" (seller name) is semantically misleading. In practice, `sellerName` should always be populated for a trade-in record, so this edge case is unlikely to surface. Consider `tradeIn.sellerPhone ?? '—'` or omitting the field when both are null.

**I2 — Dynamic import inside test body**

`ContactDetailPage.test.tsx` uses `const { customersApi } = await import('@/lib/api/customers')` inside the test body. This is valid with vitest, but if the module cache is shared across tests the mock may affect other test cases. Existing test suite is reported green so this is not blocking.

---

## CI Status

| Check | Result |
|-------|--------|
| Lint & Test | ❌ CANCELLED |
| E2E Tests (1) | ❌ CANCELLED |
| E2E Tests (2) | ❌ CANCELLED |
| Merge E2E Reports | ✅ success |
| Deploy (all) | ⏭ skipped (expected on PR) |

---

## Recommendation

**⚠️ REVIEW** — Code quality is good. The change is minimal, focused, and correct. No security or financial issues found. No critical blockers in the diff itself.

**Blocked on CI**: Do not merge until `Lint & Test` and at least one E2E shard pass. The cancellation may have been manual or infrastructure-related — re-triggering should resolve it.

Once CI is green this PR is ready to merge.
