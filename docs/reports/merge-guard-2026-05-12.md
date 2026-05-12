# Pre-Merge Guard Report — 2026-05-12

**Run date**: 2026-05-12  
**Guard agent**: Pre-Merge Guard (automated)  
**Repo**: iamnaii/bestchoice

---

## Summary

**No open GitHub pull requests found.**

`GET /repos/iamnaii/bestchoice/pulls?state=open` returned an empty list.  
All recent feature work (PRs #823–#826) has already been squash-merged into `main`.

---

## Branch Landscape

| Status | Count |
|--------|-------|
| Open GitHub PRs | **0** |
| Remote branches not merged (git) | ~225 |
| Branches with genuinely new commits ahead of main | 1 (stale; see below) |

The 225 git-unmerged branches are stale working branches — their content was delivered via squash merges. Git does not mark squash-merged branches as "merged."

---

## Recent Merges Inspected (PRs #823–#826)

The four most recent squash commits to `main` were reviewed as part of the branch scan.

### PR #823 — `feat/other-income-v2-1-combined`
`feat(other-income): v2.1 combined — accountant Gap Analysis Report (PR-1+PR-2+PR-3)`

| Severity | Issue | File |
|----------|-------|------|
| ⚠️ Warning | `saveTemplateMutation` missing `queryClient.invalidateQueries({ queryKey: ['other-income', 'templates'] })` after `saveAsFromDoc` succeeds — templates list will not auto-refresh on ViewPage | `apps/web/src/pages/other-income/OtherIncomeViewPage.tsx` |
| ⚠️ Warning | `requestApproval` endpoint allowed `SALES` role — SALES staff should not submit financial documents for maker-checker approval (fixed in PR #825) | `apps/api/src/modules/other-income/other-income.controller.ts` |
| ⚠️ Warning | `approve()` had TOCTOU race — two concurrent calls could both succeed (fixed in PR #825) | `apps/api/src/modules/other-income/other-income.service.ts` |
| ℹ️ Info | `const where: any = ...` in `TemplateService.list()` — use `Prisma.OtherIncomeTemplateWhereInput` instead | `apps/api/src/modules/other-income/services/template.service.ts:85` |
| ℹ️ Info | `OtherIncomeEntryPage.tsx` is 1162 lines; `other-income.service.ts` is 1146 lines — both exceed 500-line guideline | both files |

**No Critical issues found.** Controller had `@UseGuards(JwtAuthGuard, RolesGuard)` at class level. All Prisma queries included `deletedAt: null`. No hardcoded secrets. No raw `$queryRaw`. All new DTOs had class-validator decorators with Thai messages.

### PR #824 — `chore/other-income-v2-1-t4-renumber-validation`
`docs(other-income): renumber validation rules to PDF Spec V1-V14 (T4)`

Pure reorder/comment change in `validation.service.ts` — no logic changes.  
**Recommendation: APPROVE ✅**

### PR #825 — `fix/other-income-v2-1-review-followup`
`fix(other-income): post-merge review followups — TOCTOU race + role consistency + Thai errors`

Addressed the two Warnings from PR #823:
- CAS-claim (`updateMany` with status-guard) added to `approve()` and `reject()` — fixes TOCTOU race
- `SALES` removed from `requestApproval`, `templates/*` endpoints — role consistent with financial access model
- Error messages converted to Thai
- `afterEach` flag-restore guard added to integration tests

**One Warning remains unfixed**: `saveTemplateMutation` still missing `invalidateQueries` for templates.  
**Recommendation: REVIEW ⚠️** (minor — does not block merge)

### PR #826 — `chore(payments): remove per-row "ล่วงหน้า" button + AdvancePaymentModal`

Not part of other-income scope; PaymentsPage cleanup only.  
Not reviewed in detail (no security-sensitive changes from diff).

---

## Outstanding Issue — `saveTemplateMutation` (carried from PR #823)

**File**: `apps/web/src/pages/other-income/OtherIncomeViewPage.tsx`

```tsx
const saveTemplateMutation = useMutation({
  mutationFn: (name: string) => otherIncomeApi.templates.saveAsFromDoc(id!, name),
  onSuccess: () => {
    toast.success('บันทึกเป็น template แล้ว');
    // ← missing: queryClient.invalidateQueries({ queryKey: ['other-income', 'templates'] })
  },
});
```

**Impact**: After a user clicks "Save as Template" from the ViewPage, the OtherIncomeTemplatesPage will not show the new template until a hard-refresh. Low severity — data is not lost, only the cache is stale.

**Fix**: Add one line inside `onSuccess`:
```tsx
queryClient.invalidateQueries({ queryKey: ['other-income', 'templates'] });
```

---

## Conclusion

| Branch / PR | Recommendation |
|-------------|----------------|
| PR #823 `feat/other-income-v2-1-combined` | ⚠️ REVIEW (already merged — 1 warning carried forward) |
| PR #824 `chore/renumber-validation` | ✅ APPROVE |
| PR #825 `fix/review-followup` | ⚠️ REVIEW (saveTemplateMutation cache miss still present) |
| PR #826 `chore/payments-cleanup` | ✅ APPROVE |

**Action required**: Fix `saveTemplateMutation` cache invalidation in `OtherIncomeViewPage.tsx`. All other issues are resolved or informational.
