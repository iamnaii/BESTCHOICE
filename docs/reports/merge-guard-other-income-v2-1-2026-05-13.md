# Pre-Merge Guard Report — other-income v2.1
**Date**: 2026-05-13  
**Reviewer**: Pre-Merge Guard (automated)  
**Repository**: iamnaii/bestchoice

---

## Branches Reviewed

| Branch | Author | Last Commit | Commits Ahead of Main |
|--------|--------|-------------|----------------------|
| `feat/other-income-v2-1-combined` | Akenarin Kongdach | 2026-05-12 14:14 +07 | 15 |
| `fix/other-income-v2-1-review-followup` | Akenarin Kongdach | 2026-05-12 15:27 +07 | 19 (superset of combined) |
| `chore/other-income-v2-1-t4-renumber-validation` | Akenarin Kongdach | 2026-05-12 14:40 +07 | 16 |

> **Branch lineage**: `fix/other-income-v2-1-review-followup` is the most complete branch — it includes all commits from `feat/other-income-v2-1-combined` and `chore/other-income-v2-1-t4-renumber-validation` plus additional security/correctness fixes. This is the branch that should be merged.

---

## Change Summary (feat/other-income-v2-1-combined + followup fixes)

**33 files changed, ~2,588 insertions, ~81 deletions** (combined + fix branches)

### New Files
- `apps/api/src/modules/other-income/services/template.service.ts` — Template CRUD + variable replacement
- `apps/api/src/modules/other-income/services/template-vars.util.ts` — `{{YYYY_MM}}` date substitution
- `apps/api/src/modules/other-income/dto/create-template.dto.ts`, `update-template.dto.ts`, etc.
- `apps/api/src/modules/other-income/__tests__/template.service.spec.ts` (209 lines)
- `apps/api/src/modules/other-income/__tests__/maker-checker.spec.ts` (407 lines)
- `apps/web/src/pages/other-income/OtherIncomeTemplatesPage.tsx`
- `apps/web/src/pages/other-income/OtherIncomePendingApprovalPage.tsx`
- `apps/web/src/pages/other-income/components/{RejectModal,RenameTemplateModal,SaveAsTemplateModal,TemplatePickerCombobox}.tsx`

### Modified Files
- `other-income.controller.ts` — +112 lines (template endpoints + maker-checker endpoints)
- `other-income.service.ts` — +213 lines (requestApproval, approve, reject, createFromDoc, daily sheet)
- `OtherIncomeEntryPage.tsx` — +94 lines (template picker URL prefill)
- `OtherIncomeViewPage.tsx` — +200 lines (approval buttons, save-as-template, maker-checker status)
- `apps/api/prisma/schema.prisma` — +44 lines (OtherIncomeTemplate model, maker-checker fields)

---

## Critical Issues

**None found.**

Security guard verification:
- ✅ `@UseGuards(JwtAuthGuard, RolesGuard)` present at class level on `OtherIncomeController`
- ✅ All new endpoints have `@Roles(...)` decorators
- ✅ No unparameterized `$queryRaw` calls
- ✅ No hardcoded secrets or API keys
- ✅ No `Number()` on financial computation paths (Prisma.Decimal used throughout `other-income.service.ts`)
- ✅ All `findFirst`/`findMany` queries include `deletedAt: null`

---

## Warnings (should fix before merge)

### W1 — `Number()` on Decimal fields in template snapshot serialization
**File**: `apps/api/src/modules/other-income/services/template.service.ts:71-75`

```typescript
quantity: Number(it.quantity),       // Decimal(15,2) → JS number
unitAmount: Number(it.unitAmount),   // ← money field, precision risk
discountAmount: Number(it.discountAmount), // ← money field, precision risk
vatPct: Number(it.vatPct),
whtPct: Number(it.whtPct),
```

These Prisma `Decimal` fields are being converted with `Number()` before storing in the `itemsJson` JSON column. For amounts in practical ranges this won't cause issues (JS double handles ~15–16 sig digits; `Decimal(15,2)` has 17), but it deviates from the project rule: *"use Prisma.Decimal for financial fields, never Float"*.

**Recommended fix**: Use `it.unitAmount.toFixed(2)` / `.toString()` for string representation, or define `TemplateItem.unitAmount` as `string` and parse back at use time.

### W2 — Missing `queryClient.invalidateQueries` after `saveTemplateMutation`
**File**: `apps/web/src/pages/other-income/OtherIncomeViewPage.tsx`

`saveTemplateMutation` (saves a posted doc as a template) does not call `queryClient.invalidateQueries({ queryKey: ['other-income-templates'] })` on success. The Templates page list will remain stale until the user navigates away and back.

### W3 — Missing `queryClient.invalidateQueries` after `applyTemplateMutation`  
**Files**: `OtherIncomeTemplatesPage.tsx`, `TemplatePickerCombobox.tsx`

The "use template" mutation increments `useCount` and sets `lastUsedAt` server-side, but neither component invalidates the `other-income-templates` query on success. The displayed usage count and "last used" timestamp will be stale.

### W4 — Large files exceeding 500-line guideline
| File | Lines |
|------|-------|
| `apps/api/src/modules/other-income/other-income.service.ts` | 1,146 |
| `apps/web/src/pages/other-income/OtherIncomeEntryPage.tsx` | 1,162 |
| `apps/web/src/pages/other-income/OtherIncomeViewPage.tsx` | 725 |

The service in particular has grown to 1,146 lines. Consider extracting `MakerCheckerService` (requestApproval, approve, reject) and `DailySheetService` into separate files in a follow-up.

---

## Info

### I1 — `any` type usage (13 occurrences)
Non-blocking but reduces type safety. Notable instances:
- `template.service.ts`: `tpl.itemsJson as any[]` — should use the `TemplateItem` interface
- `OtherIncomeEntryPage.tsx`: `(doc: any)`, `(it: any, idx: number)` on mutation success handlers
- `OtherIncomeTemplatesPage.tsx`: `(t: any)` in template list map

### I2 — Mutation variable naming (`useMutation_`)
The `fix` branch already renamed `useMutation_` → `applyTemplateMutation` in `OtherIncomeTemplatesPage.tsx` and `TemplatePickerCombobox.tsx`. If the combined branch is merged separately, these names carry over.

### I3 — `fix` branch adds important correctness fixes
The `fix/other-income-v2-1-review-followup` branch adds:
1. **TOCTOU race fix** in `approve()`: uses `updateMany` CAS-claim pattern (`WHERE status=READY`) to prevent double-approval by concurrent `OWNER` users
2. **Role consistency**: template endpoints restricted from `SALES` to `OWNER/FINANCE_MANAGER/ACCOUNTANT`
3. **Thai error messages**: Maker-Checker disabled messages localized to Thai

These are significant correctness/security improvements over the base combined branch.

---

## Recommendation

| Branch | Verdict | Notes |
|--------|---------|-------|
| `feat/other-income-v2-1-combined` | **REVIEW** | Do not merge in isolation — missing TOCTOU fix |
| `chore/other-income-v2-1-t4-renumber-validation` | **REVIEW** | Validation rule reorder only; OK but subsumed by fix branch |
| `fix/other-income-v2-1-review-followup` | **APPROVE** (with W1–W3 noted) | Most complete; no blocking issues |

**Recommendation**: Merge `fix/other-income-v2-1-review-followup` as the single merge target. Address W1–W3 in a follow-up PR. The TOCTOU fix (I3 / CAS-claim in `approve()`) makes this branch strictly safer than the combined branch.

---

## Test Coverage

New test files in this PR:
- `maker-checker.spec.ts` — 407 lines, includes TOCTOU concurrency regression test
- `template.service.spec.ts` — 209 lines
- `other-income.service.spec.ts` — +203 lines
- `validation.spec.ts` — +46 lines
- `template-vars.spec.ts` — +38 lines

Type check and E2E suite status not run in this automated review — recommend running `./tools/check-types.sh all` and `./tools/run-tests.sh --skip-e2e` before final merge.
