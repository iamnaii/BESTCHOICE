# Merge Guard Report — fix/inbox-eslint-no-unused-expressions

**Date**: 2026-07-03  
**Branch**: `fix/inbox-eslint-no-unused-expressions`  
**Author**: iamnaii <akenarin.ak@gmail.com>  
**Commits**: 1 (`0847cc93 fix(web): replace ternary-as-statement to satisfy no-unused-expressions`)  
**Recommendation**: ✅ APPROVE

---

## File Changes Summary

3 files changed, 6 insertions(+), 3 deletions(-)

- `apps/web/src/pages/QcCenterPage/index.tsx`
- `apps/web/src/pages/UnifiedInboxPage/components/MessageBubble.tsx`
- `apps/web/src/pages/UnifiedInboxPage/hooks/useNotificationPrefs.ts`

---

## Issues Found

None.

---

## What Changed

Three ternary expressions used as statements (which ESLint's `no-unused-expressions` flags as potential dead code) were rewritten as `if/else` blocks:

```typescript
// Before (ESLint warning — expression result unused)
next.has(id) ? next.delete(id) : next.add(id);
ok ? toast.success('คัดลอกแล้ว') : toast.error('คัดลอกไม่สำเร็จ');

// After (correct if/else)
if (next.has(id)) next.delete(id);
else next.add(id);

if (ok) toast.success('คัดลอกแล้ว');
else toast.error('คัดลอกไม่สำเร็จ');
```

The logic is semantically identical. This is a pure lint-compliance fix with zero functional risk. No security, money, or guard concerns apply.
