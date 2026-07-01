# Pre-Merge Guard Report

**Branch**: `fix/inbox-eslint-no-unused-expressions`
**Author**: iamnaii <akenarin.ak@gmail.com>
**Date**: 2026-07-01
**Reviewer**: Pre-Merge Guard (automated)

---

## File Changes Summary

| File | +/- |
|------|-----|
| `apps/web/src/pages/QcCenterPage/index.tsx` | +2 / -1 |
| `apps/web/src/pages/UnifiedInboxPage/components/MessageBubble.tsx` | +2 / -1 |
| `apps/web/src/pages/UnifiedInboxPage/hooks/useNotificationPrefs.ts` | +2 / -1 |

**3 files changed, 6 insertions(+), 3 deletions(-)**

**Commits (4):**
- `34ec08f` fix(purchasing): mobile PO card list, true AP scope, real company on print (QA fixes)
- `8214bb0` fix(web): replace ternary-as-statement (UnifiedInboxPage)
- `0847cc9` fix(web): replace ternary-as-statement (QcCenterPage + useNotificationPrefs)
- `fb073f6` feat(seed-test-contracts): due-today + overdue scenarios with stamped late fees

---

## Issues by Severity

### Critical (0)
None.

### Warning (0)
None.

### Info (0)
None.

---

## Summary

Purely mechanical ESLint fixes — three ternary-as-statement expressions converted to `if/else` blocks to satisfy the `no-unused-expressions` rule. No logic changes, no new dependencies, no security surface added.

The `QcCenterPage/index.tsx` hunk that appears in this diff is the same ESLint fix for the `toggle` set callback (ternary → if/else inside `setSelected`).

---

## Recommendation: ✅ APPROVE

Clean fix. No issues. Safe to merge.
