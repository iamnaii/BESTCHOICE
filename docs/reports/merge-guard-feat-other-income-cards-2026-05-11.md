# Merge Guard Report — feat/other-income-cards

**Date**: 2026-05-11  
**Branch**: `feat/other-income-cards`  
**Author**: Akenarin Kongdach  
**Last Commit**: `a15c5375 feat(other-income): redesign list cards + entry form to prototype`  
**Base**: `origin/main`

---

## File Changes Summary

| File | +Added | -Removed |
|------|--------|----------|
| `apps/web/src/pages/other-income/OtherIncomeEntryPage.tsx` | ~760 | ~177 |
| `apps/web/src/pages/other-income/OtherIncomeListPage.tsx` | ~110 | ~45 |
| `apps/web/src/pages/other-income/components/AutoJournalPreview.tsx` | ~8 | ~4 |
| `apps/web/src/pages/other-income/components/ItemsTable.tsx` | ~140 | ~170 |
| `apps/web/src/components/expense-form-v4/ExpenseFormV4.tsx` | ~4 | ~4 |
| **Total** | **897** | **443** |

This branch is a **frontend-only redesign** — no backend changes, no new API endpoints, no Prisma schema changes.

---

## Issues

### Critical — None

No critical security or correctness issues found:
- All mutations call `queryClient.invalidateQueries()` ✓
- All API calls use `api.get()` / `api.post()` from `@/lib/api` — no raw `fetch()` ✓
- No hardcoded secrets or API keys ✓
- No backend controllers in this diff ✓

---

### Warning

#### W-1: `Number()` Used for Financial Arithmetic in Frontend

**Files**: `OtherIncomeEntryPage.tsx`, `ItemsTable.tsx`

```ts
const qty = Number(item.quantity) || 0;
const unit = Number(item.unitAmount) || 0;
const disc = Number(item.discountAmount) || 0;
const gross = qty * unit - disc;
// VAT calc
bv = +(gross / (1 + vatPct / 100)).toFixed(2);
v = +(gross - bv).toFixed(2);
```

Using `Number()` with native JS floating-point for money calculations risks precision drift. Example: `0.1 + 0.2 !== 0.3`. The `.toFixed(2)` calls mitigate but don't fully protect against IEEE 754 rounding surprises in edge cases (e.g., ยอดจัดที่มีเศษสตางค์หลายชั้น).

**Recommendation**: Consider using a small frontend Decimal helper (`Decimal.js` or a `roundHalf` utility) for financial preview totals, consistent with backend precision guarantees.

**Severity**: Warning — backend validates and stores values as `Prisma.Decimal`; this is a display/preview concern, not a stored-value bug.

#### W-2: `form.control as any` TypeScript Escape

**File**: `OtherIncomeEntryPage.tsx`

```tsx
control={form.control as any}
```

Bypasses TypeScript's form-field type safety. Should be resolved by properly typing the `react-hook-form` control generics.

---

### Info

#### I-1: `OtherIncomeEntryPage.tsx` Exceeds 500-Line Threshold

Post-change line count: **1066 lines**. This file handles form state, attachment upload, draft saving, POST submission, and complex VAT/WHT preview in a single component. Worth splitting into separate sub-components (e.g., `AttachmentUploadPanel`, `TotalsPreviewPanel`) in a follow-up.

#### I-2: ExpenseFormV4 Icon Change Included

The diff also touches `ExpenseFormV4.tsx` to change `← ยกเลิก` to use an `<ArrowLeft />` icon with a gap class. This is unrelated to the "other-income-cards" feature and should ideally be in its own commit. Low impact, but worth noting for history clarity.

---

## Recommendation

**REVIEW** — safe to merge with awareness of W-1.

The W-1 precision issue is a known frontend pattern in this codebase (other pages also use `Number()` for display calculations). All mutations are correctly wired. No security gaps introduced. The 1066-line file warrants a follow-up refactor ticket but is not a merge blocker for a prototype/redesign branch.

**Action before merge**: Confirm the branch is ready to replace the current OtherIncomeEntryPage (it's described as "prototype" in the commit message — verify with author whether this is prod-ready or still WIP).
