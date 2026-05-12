# Merge Guard Report — feat/other-income-cards

**Date**: 2026-05-12  
**Branch**: `feat/other-income-cards`  
**Author**: Akenarin Kongdach  
**Last commit**: 2026-05-11 10:08 +07  
**Message**: `feat(other-income): redesign list cards + entry form to prototype`

---

## File Changes Summary

| File | +Lines | -Lines |
|------|--------|--------|
| `apps/web/src/components/expense-form-v4/ExpenseFormV4.tsx` | 5 | 4 |
| `apps/web/src/pages/other-income/OtherIncomeEntryPage.tsx` | 637 | 310 |
| `apps/web/src/pages/other-income/OtherIncomeListPage.tsx` | 110 | 45 |
| `apps/web/src/pages/other-income/components/AutoJournalPreview.tsx` | 8 | 4 |
| `apps/web/src/pages/other-income/components/ItemsTable.tsx` | 137 | 94 |

**Total**: +897 / -443 · 5 files · frontend-only, no backend or schema changes.

---

## Issues

### Critical (must fix before merge)
_None found._

### Warning (should fix)

**W-1 — Triple status-count queries make 3 extra API round-trips per page load**  
`OtherIncomeListPage.tsx` adds three separate `useQuery` calls (`draftCountQuery`, `postedCountQuery`, `reversedCountQuery`), each fetching `limit: 1` just to read the `total` field. This fires 3 API calls that could be a single `/other-income/summary` endpoint or combined into the existing list query.  
_Risk_: minor latency + server load, not a bug.  
_File_: `apps/web/src/pages/other-income/OtherIncomeListPage.tsx` lines ~117–138

**W-2 — `incomeTotals` uses `Number()` conversions inside `useMemo`**  
Frontend calculation at `OtherIncomeEntryPage.tsx` lines ~370–410 uses `Number(item.quantity)`, `Number(item.unitAmount)` etc. These are form input strings being converted for UI display — this is acceptable frontend practice. However, care should be taken that the backend service receives the values as strings/Decimals and does not depend on this client-side calculation for journal accuracy.  
_Risk_: Low — display-only; JE is computed server-side.

### Info

**I-1 — `OtherIncomeEntryPage.tsx` is now 1,066 lines**  
The file grew from ~600 to 1,066 lines in this single commit. Large single-file components reduce reviewability. Consider extracting the upload drop-zone area and the validation-messages box into dedicated sub-components in a follow-up.

**I-2 — `SummaryTile` component defined after `export default`**  
The `SummaryTile` helper component is defined at the bottom of the file after the default export. While functionally correct (hoisting doesn't apply to `function` declarations but the component is a `const` arrow function — actually it appears unused in the rendered output based on the diff; only `StatusCard` in the list page is actively rendered). Confirm whether `SummaryTile` in `OtherIncomeEntryPage.tsx` is actually rendered anywhere.

**I-3 — `todayBangkok()` timezone guard is a good defensive addition**  
The new `issueDate: todayBangkok()` correctly prevents the form from defaulting to "yesterday" for users opening the app between 00:00–07:00 BKK time (UTC midnight offset). No action needed — noted as a pattern worth reusing.

---

## Checklist

| Check | Result |
|-------|--------|
| New controllers missing `@UseGuards` | ✅ No new controllers |
| `Number()` on backend money fields | ✅ All in frontend display code only |
| Missing `deletedAt: null` | ✅ No new backend queries |
| Hardcoded secrets/API keys | ✅ None |
| Missing `@Roles()` decorators | ✅ N/A (frontend-only) |
| Raw `$queryRaw` SQL injection | ✅ None |
| Raw `fetch()` instead of `api.*` | ✅ Uses `otherIncomeApi` wrapper |
| `queryClient.invalidateQueries` after mutations | ✅ Existing mutation pattern unchanged |
| CSS design tokens (no hardcoded hex) | ✅ All tokens (`bg-primary/5`, `text-warning`, etc.) |
| `bg-info`/`text-success`/`text-warning` defined | ✅ Confirmed in `index.css` |
| Thai UI text | ✅ All user-facing text in Thai |
| Lucide imports used | ✅ `Lightbulb`, `CloudUpload`, `Upload`, `AlertTriangle` all used |

---

## Recommendation

**✅ APPROVE**

This is a frontend-only UI redesign of the Other Income module. No security, auth, or data-integrity issues found. The 3-query pattern (W-1) and large file size (I-1) are housekeeping items for a follow-up, not blockers. Safe to merge.
