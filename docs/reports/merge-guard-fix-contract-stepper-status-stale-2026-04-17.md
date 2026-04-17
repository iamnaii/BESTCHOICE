# Pre-Merge Guard Report — `fix/contract-stepper-status-stale`

**Date**: 2026-04-17  
**Branch**: `fix/contract-stepper-status-stale`  
**Author**: Akenarin Kongdach \<iamnaii@MacBook-Pro-khxng-Akenarin.local\>  
**Base**: `origin/main`  
**Recommendation**: ✅ **APPROVE**

---

## File Changes Summary

| File | Insertions | Deletions |
|------|-----------|----------|
| `apps/web/src/pages/ContractDetailPage.tsx` | 10 | 5 |
| **Total** | **10** | **5** |

---

## What This Branch Does

**Bug fix**: The contract stepper UI was showing the "ส่งตรวจสอบ" (Submit for Review) action button even after the contract had already been submitted (`workflowStatus === 'PENDING_REVIEW'`). This could allow double-submission of the same contract.

### Change 1 — Correct `canSubmit` guard condition

**Before**: Button was enabled whenever `isCreator && allSigned` — did not check whether the contract was still in a state that allows submission.

**After**: Button is enabled only when `isCreator && allSigned && (workflowStatus === 'CREATING' || workflowStatus === 'REJECTED')`. This correctly allows re-submission after rejection while blocking duplicate submission of pending contracts.

```tsx
// Before
const enabled = isCreator && allSigned;

// After
const canSubmit = isCreator && allSigned &&
  (contract.workflowStatus === 'CREATING' || contract.workflowStatus === 'REJECTED');
```

### Change 2 — Additional cache invalidations on action

Two query keys added to `invalidateAll()`:
- `['contract-edocuments', id]` — refreshes e-document list
- `['contract-doc-checklist', id]` — refreshes document checklist status

These were missing, causing stale document state after workflow actions.

---

## Issues by Severity

### 🔴 Critical
_None._

### 🟡 Warning
_None._

### 🔵 Info
_None._

---

## Security Check

| Check | Result |
|-------|--------|
| New controllers / guards | ✅ No API changes |
| Financial `Number()` usage | ✅ None |
| Missing `deletedAt: null` | ✅ No new queries |
| Hardcoded secrets | ✅ None |

---

## Final Recommendation

**✅ APPROVE** — Small, focused bug fix with correct `workflowStatus` guard and two missing cache invalidations. No regressions possible from this change scope.
