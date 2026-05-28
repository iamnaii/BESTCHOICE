# Merge Guard Report — hotfix/defect-exchange-preset-contract-visibility

**Date**: 2026-05-28
**Branch**: `hotfix/defect-exchange-preset-contract-visibility`
**Author**: Akenarin Kongdach
**Last commit**: `d7bbd478` — fix(defect-exchange): show preset contract in dropdown even if PHONE_NEW
**Recommendation**: ✅ APPROVE

---

## File Changes Summary

| File | Change |
|------|--------|
| `apps/web/package.json` | version bump 26.5.21 → 26.5.22 |
| `apps/web/src/pages/DefectExchangePage.tsx` | +9/-3 — include preset contract regardless of category |

**2 files changed, 9 insertions(+), 3 deletions(-)**

---

## Issues by Severity

### Critical — none found

- Frontend-only hotfix; no backend changes.
- No missing guards, no financial field handling, no SQL queries.
- No raw `fetch()` — uses `api.get()` ✓
- No hardcoded secrets.

### Warning — none found

- The `queryKey` is correctly updated to `['defect-exchange-contracts', presetContractId ?? null]`. Without this fix, the cache would serve the PHONE_USED-only result to subsequent renders that pass a different preset, hiding the preset contract. The fix is cache-coherent ✓
- The comment in the code correctly explains *why* the preset is always included ("better than an empty dropdown that gives no feedback") — this is one of the cases where a comment adds value (non-obvious UX design decision).

### Info

- Pre-existing concern (not introduced here): the query fetches up to `limit=200` active contracts. On a large deployment this may eventually miss contracts beyond page 1. Not a regression — this limit pre-dated this branch.
- Version bump to `26.5.22` is consistent with the project's CalVer convention (`26.5.x` = year 26, month 5, patch x).

---

## Logic Correctness Check

### Before

```ts
return rows.filter((c) => c.product.category === 'PHONE_USED');
```

A user arriving at DefectExchangePage with `presetContractId` pointing to a `PHONE_NEW` contract (valid use case per the insurance/defect flow) would see an empty dropdown with no explanation — a silent UX failure.

### After

```ts
return rows.filter(
  (c) => c.product.category === 'PHONE_USED' || c.id === presetContractId,
);
```

The preset contract is always shown. The existing eligibility check downstream surfaces any rule violations (e.g. "category must be PHONE_USED to qualify for exchange") as a readable message, which is the correct place for that feedback.

This is a minimal, targeted fix with no unintended side effects:
- If `presetContractId` is `undefined`, the `c.id === presetContractId` clause never matches (all undefined comparisons are false), so the behaviour for direct-navigation users (no preset) is unchanged.
- The queryKey change ensures the result is re-fetched when the preset changes.

---

## Test Coverage

No new tests in this hotfix. The fix is a one-line filter change on a client-side list — the logic is straightforward enough that a dedicated unit test would test the filter predicate, not meaningful product behaviour. Acceptance is best verified by a smoke test: navigate to DefectExchangePage with a PHONE_NEW contract preset and confirm it appears in the dropdown.
