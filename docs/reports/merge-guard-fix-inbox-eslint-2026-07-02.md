# Merge Guard Report — fix/inbox-eslint-no-unused-expressions

**Date:** 2026-07-02  
**Branch:** `fix/inbox-eslint-no-unused-expressions`  
**Author:** iamnaii (akenarin.ak@gmail.com)  
**Commits ahead of main:** 1  
**Commits behind main:** 38

---

## File Changes Summary

| File | Change |
|------|--------|
| `apps/web/src/pages/QcCenterPage/index.tsx` | +2 / -1 |
| `apps/web/src/pages/UnifiedInboxPage/components/MessageBubble.tsx` | +2 / -1 |
| `apps/web/src/pages/UnifiedInboxPage/hooks/useNotificationPrefs.ts` | +2 / -1 |

**3 files changed, 6 insertions(+), 3 deletions(-)**

---

## Issues Found

### Critical
_None_

### Warning
_None_

### Info
- Branch is **38 commits behind main** — will need a rebase before merge to resolve conflicts cleanly. Risk is low given the 3-line change is mechanical and non-conflicting in scope.

---

## Change Summary

Pure ESLint lint fix: replaces three instances of ternary-as-statement expressions (which trigger `no-unused-expressions`) with equivalent `if/else` blocks.

```diff
// Before (ESLint warning)
next.has(id) ? next.delete(id) : next.add(id);

// After (correct)
if (next.has(id)) next.delete(id);
else next.add(id);
```

Same fix applied to `toggleRoomMute` in `useNotificationPrefs.ts` and `copyText` in `MessageBubble.tsx`. No logic change whatsoever.

---

## Security Checklist

- [x] No new controllers without `@UseGuards`
- [x] No `Number()` on financial fields
- [x] No missing `deletedAt: null`
- [x] No hardcoded secrets
- [x] No raw `fetch()` calls
- [x] No `localStorage`/`sessionStorage` token usage
- [x] No unparameterized `$queryRaw`

---

## Recommendation

**✅ APPROVE**

Trivial lint fix with zero logic change. Needs rebase onto main before merge (38 commits behind) but no conflicts expected given the narrow scope.
