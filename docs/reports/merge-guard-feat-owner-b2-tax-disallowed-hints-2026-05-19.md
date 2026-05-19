# Merge Guard Report — feat/owner-b2-tax-disallowed-hints

**Date:** 2026-05-19  
**Branch:** `feat/owner-b2-tax-disallowed-hints`  
**Author:** Akenarin Kongdach  
**Last commit:** `d9ff412a` feat(web): ม.65 ตรี category popover next to tax-disallowed checkbox (Owner B2)  
**Base:** `origin/main`

---

## File Changes Summary

5 files changed, 238 insertions(+), 25 deletions(-)

| File | Type | Change |
|------|------|--------|
| `apps/web/src/components/expense-form-v4/TaxDisallowedHint.tsx` | Frontend | New — Popover component with ม.65 ตรี category list |
| `apps/web/src/components/expense-form-v4/VendorSection.tsx` | Frontend | Added `<TaxDisallowedHint />` next to doc-level checkbox |
| `apps/web/src/components/expense-form-v4/ItemLinesSection.tsx` | Frontend | Added `<TaxDisallowedHint compact />` next to per-line checkbox |
| `apps/web/src/constants/tax-disallowed.ts` | Frontend | New — 12-entry `TAX_DISALLOWED_CATEGORIES` constant (ม.65 ตรี (1)-(15)) |
| `apps/web/src/constants/tax-disallowed.test.ts` | Frontend test | New — 4 shape-regression tests for the constant |

---

## Issues Found

### Critical
_None_

### Warning

**[WARN-1]** `TaxDisallowedHint.tsx:28` — Uses `focus:outline-hidden` Tailwind class. In Tailwind CSS v3 the correct utility is `focus:outline-none`. `focus:outline-hidden` is a v4-only alias. If this project is on Tailwind v3 this silently does nothing (no outline suppression), creating an inconsistent focus ring on the button. **Verify Tailwind version.** If on v3, change to `focus:outline-none`.

```tsx
// Current (may be v4-only)
className="... focus:outline-hidden focus:ring-2 ..."
// Safe for v3+
className="... focus:outline-none focus:ring-2 ..."
```

### Info

**[INFO-1]** `TaxDisallowedHint.tsx` — Popover is reference-only (selecting a category does not set form state). The component carries a 12-line comment explaining this is intentional. Per coding standards, comments should be minimal — the no-op behaviour could be conveyed in one line. Minor.

**[INFO-2]** `tax-disallowed.ts` — Statute sub-clauses jump from `(9)` to `(11)` — `(10)` is omitted. If `(10)` is excluded intentionally (e.g. irrelevant for the business) a one-line comment would help future maintainers understand the gap. Currently silent.

---

## Security Check

- Frontend-only change. No new API endpoints or backend code.
- Popover is read-only reference data — cannot inject or persist anything.
- No raw `fetch()` calls.
- No auth/guard changes.
- No hardcoded secrets.
- Design tokens used correctly (`text-muted-foreground`, `bg-popover/95`, `border-border`, `hover:text-foreground`). No hardcoded hex colors.
- Thai text uses `leading-snug` throughout — correct.

---

## Quality Check

- `TAX_DISALLOWED_CATEGORIES` is a `const` export with typed `TaxDisallowedCategory[]` — exhaustive, grep-able.
- 4 regression tests guard shape (length ≥ 6, non-empty labels, unique refs, three owner-cited examples present).
- `compact` prop pattern cleanly separates doc-level vs. line-level rendering in one component.
- Uses `@/components/ui/popover` (shadcn/ui) — consistent with frontend rules.
- `aria-label` on the trigger button satisfies a11y.

---

## Recommendation: **APPROVE** (with WARN-1 verification)

Minimal, well-contained UI enhancement. No backend surface. Confirm Tailwind version to resolve WARN-1 before merge; all other findings are informational.
