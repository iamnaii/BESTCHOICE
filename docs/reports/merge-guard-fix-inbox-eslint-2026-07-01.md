# Merge Guard Report — `fix/inbox-eslint-no-unused-expressions`

**Date**: 2026-07-01  
**Author**: iamnaii <akenarin.ak@gmail.com>  
**Last commit**: 2026-06-30  
**Recommendation**: ✅ APPROVE

---

## File Changes Summary

| File | Change |
|------|--------|
| `apps/web/src/pages/QcCenterPage/index.tsx` | +1/-1 |
| `apps/web/src/pages/UnifiedInboxPage/components/MessageBubble.tsx` | +2/-1 |
| `apps/web/src/pages/UnifiedInboxPage/hooks/useNotificationPrefs.ts` | +2/-1 |

**Total**: 3 files changed, 6 insertions, 3 deletions

---

## Scope

Pure ESLint `no-unused-expressions` fix. Replaces ternary-as-statement patterns with `if/else` blocks in three files. No logic change.

```ts
// Before
ok ? toast.success('คัดลอกแล้ว') : toast.error('คัดลอกไม่สำเร็จ');

// After  
if (ok) toast.success('คัดลอกแล้ว');
else toast.error('คัดลอกไม่สำเร็จ');
```

---

## Issues Found

### Critical
None.

### Warning
None.

### Info
None.

---

## Verdict: APPROVE

Zero risk. Fixes a linting rule violation without altering runtime behavior. Safe to merge.
