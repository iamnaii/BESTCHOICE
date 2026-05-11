# Merge Guard Report — feat/other-income-cards

**Date**: 2026-05-11  
**Branch**: `feat/other-income-cards`  
**Author**: Akenarin Kongdach `<iamnaii@MacBook-Pro-khxng-Akenarin.local>`  
**Last commit**: 2026-05-11 10:08 +0700  
**Commit message**: `feat(other-income): redesign list cards + entry form to prototype`

---

## File Changes Summary

| File | +Lines | −Lines | Notes |
|------|--------|--------|-------|
| `apps/web/src/pages/other-income/OtherIncomeEntryPage.tsx` | ~700 | ~230 | Major redesign — now **1,066 lines** |
| `apps/web/src/pages/other-income/OtherIncomeListPage.tsx` | ~120 | ~40 | Summary cards replaced with count queries |
| `apps/web/src/pages/other-income/components/ItemsTable.tsx` | ~100 | ~135 | Refactored |
| `apps/web/src/pages/other-income/components/AutoJournalPreview.tsx` | ~8 | ~4 | Minor |
| `apps/web/src/components/expense-form-v4/ExpenseFormV4.tsx` | ~3 | ~2 | Arrow icon cleanup |

**Total**: +897 / −443 (frontend only — no backend changes)

---

## Issues by Severity

### ✅ Critical — NONE

No critical security or data integrity issues found.

- No backend controllers added → guard/role checks not applicable
- No raw `$queryRaw` usage
- No hardcoded secrets or API keys
- No raw `fetch()` — all API calls use `api.get()`/`api.post()` from `@/lib/api`

### ⚠️ Warning (should fix)

#### W-1: `Number()` used in financial calculation preview (`computeJePreview`)

**File**: `OtherIncomeEntryPage.tsx` lines 54–119  
**Pattern**:
```ts
const qty   = Number(item.quantity)       || 0;
const unit  = Number(item.unitAmount)     || 0;
const disc  = Number(item.discountAmount) || 0;
const vatPct = Number(item.vatPct)        || 0;
const whtPct = Number(item.whtPct)        || 0;
const gross = qty * unit - disc;          // plain JS float arithmetic
```

**Context**: `computeJePreview()` generates a visual JE preview shown to the user before submission. The actual data submitted to the backend is raw `OtherIncomeFormValues` (strings from react-hook-form), so backend `Prisma.Decimal` precision is preserved for the real journal entry.

**Risk**: The displayed preview may show floating-point precision mismatches vs. what the backend computes (e.g., `1/3 * 3 = 0.9999...` in JS). On an income document over ฿10,000 this could mislead the user into thinking the JE preview balances when it slightly does not.

**Recommendation**: Use `toFixed(2)` on intermediate steps or keep the backend as the authoritative compute source and show a "preview is approximate" disclaimer. Alternatively, submit the preview payload to a `/other-income/preview-je` endpoint that uses `Prisma.Decimal`.

---

#### W-2: `parseFloat` used in `formatNumber` helper (minor — display only)

**File**: `OtherIncomeEntryPage.tsx` line ~1157  
```ts
const n = typeof v === 'string' ? parseFloat(v) : v;
```
**Context**: Display formatting only (`Intl.NumberFormat`). Not used for stored values. Low risk but inconsistent with project convention of using `Prisma.Decimal` for monetary values.

---

### ℹ️ Info

#### I-1: `OtherIncomeEntryPage.tsx` is 1,066 lines (guideline: ≤500)

The page has grown significantly with the prototype redesign. Consider splitting into sub-components:
- `OtherIncomeFormHeader` (status badges, breadcrumb)
- `AttachmentDropzone` (drag-and-drop file uploader section)
- `JePreviewPanel` (live JE preview table)
- `AdjustmentTable` (overpay/underpay adjustments)

#### I-2: Four `as any` TypeScript casts with `eslint-disable` comments

```ts
resolver: standardSchemaResolver(otherIncomeFormSchema) as any,
control={form.control as any}
```
These exist in the original file too (pre-existing workarounds for `@hookform/resolvers` type inference). Not introduced by this branch. Tracked, not blocking.

---

## Positive Observations

| Check | Status |
|-------|--------|
| All mutations call `queryClient.invalidateQueries()` on success | ✅ |
| API calls via `api.get()`/`api.post()` from `@/lib/api` | ✅ |
| Notifications via `toast.success()`/`toast.error()` from sonner | ✅ |
| No hardcoded hex colors — uses design tokens | ✅ |
| File upload validates MIME type + 5 MB size before mutating | ✅ |
| **Removed** imprecise `parseFloat`-based frontend sum of monetary totals from list cards | ✅ |
| `saveDraftMutation` and `saveAndPostMutation` both call `invalidateQueries` on success | ✅ |

---

## Recommendation

**🔶 REVIEW** — Merge pending fix for W-1.

The JE preview (`computeJePreview`) uses plain JavaScript `Number()` arithmetic for financial amounts. While the actual API payload is unaffected, the preview could mislead users. Add a "preview is approximate" notice or refactor to a backend-computed preview before merging to production.

W-2 and Info items are non-blocking but should be tracked in the backlog.
