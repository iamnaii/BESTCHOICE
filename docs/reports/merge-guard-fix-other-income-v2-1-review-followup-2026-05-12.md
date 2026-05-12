# Merge Guard Report — fix/other-income-v2-1-review-followup

**Date:** 2026-05-12  
**Branch:** `fix/other-income-v2-1-review-followup`  
**Author:** Akenarin Kongdach  
**Recommendation:** ✅ APPROVE

---

## Summary

Post-merge review followup for the Other Income v2.1 Maker-Checker feature. Three commits addressing a TOCTOU race in `approve()`, role consistency on template endpoints, and Thai error messages.

## File Changes (5 files, +89 / -31)

| File | Changes |
|------|--------|
| `other-income.controller.ts` | Role trimming on 6 endpoints |
| `other-income.service.ts` | CAS-claim in approve() + reject(), Thai messages |
| `maker-checker.spec.ts` | afterEach safety net, concurrent CAS test |
| `OtherIncomeTemplatesPage.tsx` | Rename `useMutation_` → `applyTemplateMutation` |
| `TemplatePickerCombobox.tsx` | Same rename |

---

## Issues

### Critical — 0 found

No missing guards, no `Number()` on money fields, no raw secrets, no unparameterized SQL.

### Warning — 0 found

### Info — 2 items

**I-1: CAS `updateMany` without `deletedAt: null` filter**  
File: `other-income.service.ts` — `approve()` and `reject()` CAS clauses

```ts
// approve() tx:
await tx.otherIncome.updateMany({
  where: { id, status: OtherIncomeStatus.READY },  // no deletedAt: null
  ...
});
// reject():
await this.prisma.otherIncome.updateMany({
  where: { id, status: OtherIncomeStatus.READY },  // no deletedAt: null
  ...
});
```

A soft-deleted READY doc would not be matched by `status: READY` after it's deleted (status would have changed), so this is practically safe. The CAS-failure path returns `ConflictException` rather than `NotFoundException` in this edge case, which is slightly less precise. Not blocking — just worth noting.

**I-2: Variable rename is cosmetic but correct**  
`useMutation_` was an invalid hook naming pattern (hooks must start with `use` and not be bare mutation objects stored as `useMutation_`). Renaming to `applyTemplateMutation` is better.

---

## Positive Findings

- **TOCTOU race fixed correctly**: CAS-claim via `updateMany({where: {id, status: READY}})` inside a `$transaction` ensures only one concurrent approval wins. The `receiptNo` generation is correctly moved *after* the CAS claim, preventing orphaned receipt numbers.
- **CAS in reject() too**: Mirrors the same guard preventing concurrent approve+reject conflicts.
- **afterEach flag restore**: Prevents test-isolation issues where an assertion failure before a manual `re-enable` would contaminate subsequent tests.
- **Concurrent CAS regression test**: Proves the race is closed — both callers race, exactly one wins, loser gets a Thai-language ConflictException.
- **Role tightening**: `SALES` removed from Other Income template endpoints and `request-approval`. `FINANCE_MANAGER` added to `request-approval`. Consistent with separation of duties (SALES should not initiate financial document approvals).
- **Thai error messages**: Matches project convention (`{ message: 'ภาษาไทย' }`).
