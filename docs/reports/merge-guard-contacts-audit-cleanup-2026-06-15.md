# Merge Guard Report — feat/contacts-audit-cleanup

**Date**: 2026-06-15  
**PR**: [#1150](https://github.com/iamnaii/BESTCHOICE/pull/1150)  
**Branch**: `feat/contacts-audit-cleanup` → `main`  
**Author**: iamnaii  
**PR Created**: 2026-06-04 (11 days open, not updated since creation)

---

## Summary

Small frontend-only PR. Adds `ชื่อผู้ขาย` (sellerName + sellerPhone) display to the `TradeInTile` on `ContactDetailPage`, adds 2 regression tests, and updates 4 spec docs from "รออนุมัติ" to "✅ DONE".

**6 files changed**: +54 / -8  
- `apps/web/src/pages/ContactDetailPage.tsx` (+14/-4)  
- `apps/web/src/pages/__tests__/ContactDetailPage.test.tsx` (+37)  
- 4 × `docs/superpowers/specs/*.md` (status header update only)

No backend, no Prisma schema, no new API routes.

---

## Issues by Severity

### 🔴 Critical — None

- No new controllers → no missing `@UseGuards` risk
- No financial calculations → no `Number()` on Decimal concern
- No new Prisma queries → no `deletedAt: null` gap
- No secrets or SQL injection

### 🟡 Warning

#### W1 — CI was CANCELLED, never passed

All gate jobs were cancelled, not green:

| Check | Result |
|---|---|
| Lint & Test | **CANCELLED** (ran 6 hours, then cancelled) |
| E2E Tests (1) | **CANCELLED** |
| E2E Tests (2) | **CANCELLED** |
| Deploy jobs | SKIPPED |
| Merge E2E Reports | SUCCESS (but ran on cancelled E2E output) |

The PR has no successful CI run on record. The branch must not be merged until a clean CI run completes.

#### W2 — `value` is `undefined` when both `sellerName` and `sellerPhone` are null

In `ContactDetailPage.tsx` (~line 305):

```tsx
value={
  tradeIn.sellerName
    ? `${tradeIn.sellerName}${tradeIn.sellerPhone ? ` (${tradeIn.sellerPhone})` : ''}`
    : tradeIn.sellerPhone   // <-- undefined when sellerPhone is also null
}
```

If a trade-in record was created without capturing seller identity (anonymous cash purchase), both fields will be `null` and `value` becomes `undefined`. The `Field` component should handle `undefined` gracefully (render an em-dash or "—") — this is low-risk if `Field` already handles it, but worth verifying that the tile doesn't render a blank/broken row for legacy trade-ins.

### 🔵 Info

#### I1 — 11-day-old PR, no activity since creation

PR was opened 2026-06-04 and untouched since. The underlying contact feature it patches (`e52d2154`, `PR #1121-#1124`) was merged 2026-06-02. The cleanup patch is small enough that it shouldn't drift, but should be reviewed and merged or closed soon to avoid stale-branch accumulation.

#### I2 — Test mocks use concrete string `'P-7'` as contactCode

Minor: the contactCode `'P-7'` in the test mock doesn't match the padded format used in production (`'P-00007'`). No functional impact since the test only asserts on rendered text, not the code itself.

---

## Recommendation

**🟡 REVIEW — Do not merge until CI is retriggered and passes**

The code change itself is minimal, correct, and low-risk. The blocker is W1: no clean CI run exists. Someone (or a scheduled action) should push an empty commit or close/reopen the PR to trigger CI, then merge once Lint & Test + E2E pass.

W2 (undefined value) is a soft concern — verify `Field` handles `undefined` gracefully before merge, or add a fallback: `tradeIn.sellerPhone ?? ''`.

No security issues. No critical bugs. Approvable once CI is green.
