# Merge Guard Report — fix/inbox-eslint-no-unused-expressions

**Date**: 2026-07-01  
**Branch**: `fix/inbox-eslint-no-unused-expressions`  
**Author**: iamnaii <akenarin.ak@gmail.com>  
**Last commit**: 2026-06-30 11:38 +0700  
**Reviewer**: Pre-Merge Guard (automated)

---

## File Changes Summary

| File | +Lines | -Lines |
|------|--------|--------|
| `QcCenterPage/index.tsx` | +2 | -1 |
| `UnifiedInboxPage/components/MessageBubble.tsx` | +2 | -1 |
| `UnifiedInboxPage/hooks/useNotificationPrefs.ts` | +2 | -1 |

**3 files changed, 6 insertions, 3 deletions**

---

## Change Description

Mechanical ESLint `no-unused-expressions` fix in 3 places:

1. **QcCenterPage** — `next.has(id) ? next.delete(id) : next.add(id)` → `if/else`
2. **MessageBubble** — `ok ? toast.success(...) : toast.error(...)` → `if/else`
3. **useNotificationPrefs** — `next.has(roomId) ? next.delete(roomId) : next.add(roomId)` → `if/else`

No logic change — ternary-as-statement produces the same side effects. The rewrite satisfies the ESLint rule which flags ternaries used purely for side effects (not for a value).

---

## Issues Found

### Critical — NONE  
### Warning — NONE  
### Info — NONE

---

## Checklist

- [x] No new controllers without `@UseGuards`
- [x] No money/Decimal handling changed
- [x] Pure cosmetic lint fix — zero logic change risk
- [x] Unblocks CI lint step

---

## Recommendation

**APPROVE**

Trivial ESLint lint fix. Fast-track merge.
