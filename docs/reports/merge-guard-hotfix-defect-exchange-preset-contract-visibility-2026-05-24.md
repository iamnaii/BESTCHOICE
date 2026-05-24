# Pre-Merge Guard Report

**Branch:** `hotfix/defect-exchange-preset-contract-visibility`
**Author:** Akenarin Kongdach <iamnaii@MacBook-Pro-khxng-Akenarin.local>
**Reviewed:** 2026-05-24
**Commits:** 1
**Recommendation:** 🟢 **APPROVE — No issues found**

---

## File Changes Summary

| File | Lines Changed | Notes |
|------|--------------|-------|
| `apps/web/src/pages/DefectExchangePage.tsx` | +8 / -2 | Targeted bug fix |
| `apps/web/package.json` | +1 / -1 | Version bump |

---

## Change Description

When navigating to DefectExchangePage with a `?contractId=` preset param (e.g. from the insurance wizard), the contract list was filtered to `PHONE_USED` category only — which would exclude `PHONE_NEW` contracts and cause the preset contract to be missing from the dropdown, giving the user an empty/confusing experience.

The fix adds the preset contract to the `queryKey` for cache isolation and widens the filter to always include the preset contract regardless of category:

```ts
return rows.filter(
  (c) => c.product.category === 'PHONE_USED' || c.id === presetContractId,
);
```

This is correct — the eligibility check downstream will still surface category-based rule violations as readable error messages, which is better UX than an empty dropdown.

---

## Issues

None found. The change is minimal, targeted, and safe.

---

## Positive Notes
- `queryKey` correctly includes `presetContractId` to prevent stale cache contamination across different presets
- No security implications — this is a pure frontend filter change
- No new API calls or mutations introduced
- Comment explains the rationale clearly
