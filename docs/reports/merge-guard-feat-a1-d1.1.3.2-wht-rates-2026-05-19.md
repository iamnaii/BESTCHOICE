# Merge Guard Report — feat/a1-d1.1.3.2-wht-rates

**Date:** 2026-05-19  
**Branch:** `feat/a1-d1.1.3.2-wht-rates`  
**Author:** Akenarin Kongdach  
**Last commit:** `6661230e` Merge branch 'main' into feat/a1-d1.1.3.2-wht-rates  
**Base:** `origin/main`

---

## File Changes Summary

6 files changed, 169 insertions(+), 13 deletions(-)

| File | Type | Change |
|------|------|--------|
| `apps/api/src/modules/settings/settings.service.spec.ts` | API test | Updated test to include REPAIR_SERVICE in DocumentType keys |
| `apps/web/src/components/expense-form-v4/ItemLinesSection.tsx` | Frontend | Replaced inline filter logic with `whtRatesToSelectOptions()` helper |
| `apps/web/src/hooks/useUiFlags.ts` | Frontend | Added `REPAIR_SERVICE: 'RS'` to `docPrefixes` |
| `apps/web/src/lib/wht-rates.test.ts` | Frontend test | New — 12 unit tests for `filterActiveWhtRates` + `whtRatesToSelectOptions` |
| `apps/web/src/lib/wht-rates.ts` | Frontend lib | New — pure helper functions for WHT rate filtering |
| `docs/superpowers/tracking/D1-settings-implement.md` | Docs | Tracking update |

---

## Issues Found

### Critical
_None_

### Warning
_None_

### Info

**[INFO-1]** `apps/web/src/lib/wht-rates.ts` — Multi-line JSDoc comment block above `filterActiveWhtRates`. Per coding standards, comments should be one short line when the WHY is non-obvious. The existing JSDoc is moderately verbose but documents a non-obvious permissive-fallback design decision (unparseable dates → include), which partially justifies it. Low impact.

---

## Security Check

- No new controllers or backend endpoints added.
- No JWT/auth changes.
- No money-field arithmetic (pure frontend helper).
- No hardcoded secrets.
- No raw SQL.

---

## Quality Check

- `filterActiveWhtRates` is a pure function — testable, deterministic with injected `now` clock.
- 12 unit tests covering boundary conditions (past date, future date, boundary match, unparseable date, mixed arrays).
- `whtRatesToSelectOptions` always prepends the `0%` no-WHT option, preserving existing behaviour.
- Uses `Number.isNaN()` (not `isNaN`) for strict NaN check — correct.
- `useUiFlags.ts` addition of `REPAIR_SERVICE: 'RS'` is consistent with existing `docPrefixes` pattern.
- Test added for the `settings.service.spec.ts` key count (now expects 6 DocumentType keys including `REPAIR_SERVICE`).

---

## Recommendation: **APPROVE**

Clean, focused extraction of filter logic into a pure testable helper. No security surface, no backend changes, good test coverage. The only note is minor JSDoc verbosity.
