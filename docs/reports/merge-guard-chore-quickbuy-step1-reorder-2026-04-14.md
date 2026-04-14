# Merge Guard Report — chore/quickbuy-step1-reorder

**Branch**: `chore/quickbuy-step1-reorder`  
**Author**: iamnaii  
**Review Date**: 2026-04-14  
**Reviewer**: Pre-Merge Guard (automated)  
**Recommendation**: ✅ **APPROVE (pending base branch merge)**

---

## Summary

Single-commit UI change — reorders Step 1 seller info fields in `QuickBuyModal.tsx` to match the standard customer data form order: ชื่อ → เลขบัตร → เบอร์ → ที่อยู่ → แนบบัตร.

This branch is stacked on `chore/trade-in-orchestrator-rebrand` (no shared history with current `main`). The unique change vs its base branch is one file only.

**1 file changed, +28 / −21 lines**  
File: `apps/web/src/components/trade-in/QuickBuyModal.tsx`

---

## Changes

| Change | Detail |
|--------|--------|
| Field order | Moved "ชื่อ-นามสกุล" to first position (was second in a 2-col grid) |
| Field order | Moved "รูปบัตรประชาชน" upload after "ที่อยู่ตามบัตร" (was before address) |
| Layout | Changed from `grid grid-cols-2 gap-4` → `space-y-4` single column |
| Upload area | Height `h-10` → `h-12`, added `hover:bg-sky-50/50 transition-colors` |
| Upload area | Icon size `size-4` → `size-5`, label text improved to be more descriptive |

---

## Issues

### Critical — None

### Warning — None

### Info — None

---

## Security Review

- ✅ Frontend-only change — no backend code touched
- ✅ No API calls added or modified
- ✅ No auth/permission changes
- ✅ No state management changes

---

## Recommendation

✅ **APPROVE** — Pure cosmetic/UX improvement. No security, data, or business logic changes.

**Prerequisite**: `chore/trade-in-orchestrator-rebrand` must be evaluated and merged into `main` first — this branch is stacked on top of it and has no shared history with current `main`.
