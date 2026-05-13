# Pre-Merge Guard Report — Other Income v2.1 Cluster
**Date**: 2026-05-13  
**Reviewed by**: Pre-Merge Guard Agent  
**Branches reviewed**: 3 of 3

---

## Branches in This Cluster

| # | Branch | Last Commit | Files | Insertions |
|---|--------|-------------|-------|------------|
| 1 | `feat/other-income-v2-1-combined` | 2026-05-12 14:14 | 27 | +2 499 |
| 2 | `fix/other-income-v2-1-review-followup` | 2026-05-12 15:27 | 5 | +89 |
| 3 | `chore/other-income-v2-1-t4-renumber-validation` | 2026-05-12 14:40 | 1 | +68 |

**Author (all branches)**: Akenarin Kongdach

---

## Branch 1 — `feat/other-income-v2-1-combined`

### What this branch does
Adds the full Maker-Checker approval workflow + Template system to the Other Income module:
- New DTOs: `ApproveOtherIncomeDto`, `RejectOtherIncomeDto`, `CreateTemplateDto`, `UpdateTemplateDto`
- New service: `TemplateService` (CRUD + soft-delete + favorites)
- New controller endpoints: `GET/POST templates`, `POST from-doc/:id/save-template`, `PATCH/DELETE templates/:id`, `POST templates/:id/use`, `POST :id/request-approval`, `POST :id/approve`, `POST :id/reject`
- New Prisma model: `OtherIncomeTemplate` (migration `20260921000000_add_other_income_template`)
- New frontend pages: `OtherIncomePendingApprovalPage`, `OtherIncomeTemplatesPage`, modals (`RejectModal`, `RenameTemplateModal`, `SaveAsTemplateModal`, `TemplatePickerCombobox`)
- New routes wired in `App.tsx` with `ProtectedRoute` and `React.lazy()`

### Critical Issues

**None found.**

- ✅ All new controller endpoints have `@UseGuards(JwtAuthGuard, RolesGuard)` via class-level decorator (inherited from existing class)
- ✅ All new endpoints have `@Roles(...)` decorators
- ✅ No `Number()` on Prisma Decimal write paths — only on JSON template serialization (see Warning below)
- ✅ No missing `deletedAt: null` — `TemplateService` filters soft-deletes correctly
- ✅ No hardcoded secrets or API keys
- ✅ No raw `$queryRaw` calls

### Warning Issues

**W1 — `useMutation_` placeholder name (2 files)**
- `apps/web/src/pages/other-income/OtherIncomeTemplatesPage.tsx`
- `apps/web/src/pages/other-income/components/TemplatePickerCombobox.tsx`

Both use `useMutation_` as the variable name — a generic placeholder that makes code harder to read. Should be `applyTemplateMutation`.

> ⚠️ **Already fixed in `fix/other-income-v2-1-review-followup`.** If that branch is merged after this one, no action needed here.

**W2 — `Number()` on Decimal fields in `createFromDoc()` (`template.service.ts:69-75`)**
```ts
quantity: Number(it.quantity),
unitAmount: Number(it.unitAmount),
discountAmount: Number(it.discountAmount),
vatPct: Number(it.vatPct),
whtPct: Number(it.whtPct),
```
These Prisma Decimal values are converted to JS `number` for JSON storage in `itemsJson`. The project convention is "use Decimal, never Float for money". In this context the values land in a JSON column (not a Decimal DB column), so actual precision loss requires amounts > 2^53 (≈ 9 trillion THB) — well outside real business range. Low practical risk, but it drifts from the codebase convention.

**Suggested fix**: Use `it.unitAmount.toString()` and store as string in the JSON, or define `TemplateItem.unitAmount` as `string` and parse with `new Prisma.Decimal()` when consuming.

**W3 — `SALES` role on template endpoints**

Template endpoints (`GET/POST templates`, `PATCH templates/:id`, etc.) include `SALES` in `@Roles(...)`. Should sales staff be able to create/modify income templates?

> ⚠️ **Already fixed in `fix/other-income-v2-1-review-followup`** — that branch removes `SALES` from all template endpoints, keeping `OWNER`, `FINANCE_MANAGER`, `ACCOUNTANT` only.

**W4 — `requestApproval` endpoint role inconsistency**

`POST :id/request-approval` is `@Roles('OWNER', 'ACCOUNTANT', 'SALES')` but the approve endpoint is `@Roles('OWNER')` only. If SALES can submit for approval, they need a `FINANCE_MANAGER` or `ACCOUNTANT` to approve — OWNER-only approve gate seems overly restrictive.

> ⚠️ **Already fixed in `fix/other-income-v2-1-review-followup`** — changes `requestApproval` to `OWNER, FINANCE_MANAGER, ACCOUNTANT` and `approve()` to the same set.

### Info

- ℹ️ All new frontend pages use `useQuery`/`useMutation` from `@tanstack/react-query` — no raw `fetch()` ✓
- ℹ️ `queryClient.invalidateQueries()` present after all mutations ✓
- ℹ️ `QueryBoundary` wrapped on all data-fetching pages ✓
- ℹ️ All new pages lazy-loaded via `React.lazy()` ✓
- ℹ️ New routes use `ProtectedRoute` with role arrays consistent with controller `@Roles()` ✓
- ℹ️ DTOs have Thai validation messages and class-validator decorators ✓
- ℹ️ `OtherIncomeTemplate` model has `deletedAt DateTime?` for soft-delete ✓

### Recommendation

> **REVIEW** — merge is safe, but the 4 warnings above should ideally be resolved first. All 4 are already addressed in `fix/other-income-v2-1-review-followup`, so the cleanest path is: merge this branch → immediately merge the fix branch.

---

## Branch 2 — `fix/other-income-v2-1-review-followup`

### What this branch does
Post-review fixes on top of the combined branch:
1. **TOCTOU race fix** in `approve()`: adds CAS `updateMany({ where: { id, status: READY } })` — only one concurrent caller wins; loser gets `ConflictException`
2. **Same CAS pattern** added to `reject()` for symmetry
3. **Thai error messages**: "Maker-Checker disabled" → "Maker-Checker ปิดอยู่"
4. **Role corrections**: removes `SALES` from template endpoints; changes `requestApproval` to `OWNER, FINANCE_MANAGER, ACCOUNTANT`
5. **Frontend rename**: `useMutation_` → `applyTemplateMutation` in 2 files
6. **Test hardening**: `afterEach` to restore maker-checker flag; new concurrent-approval test verifying CAS correctness

### Critical Issues

**None.**

### Warning Issues

**None.**

### Info

- ℹ️ CAS pattern is the correct fix — `$transaction` alone doesn't prevent two callers both passing the initial `status === READY` check before either writes ✓
- ℹ️ Test coverage for concurrent approval race added ✓
- ℹ️ `afterEach` guard prevents test-state bleed from flag-restore failures ✓

### Recommendation

> **APPROVE** — clean quality improvement, addresses all warnings from Branch 1. Must be merged after `feat/other-income-v2-1-combined`.

---

## Branch 3 — `chore/other-income-v2-1-t4-renumber-validation`

### What this branch does
Single file: `apps/api/src/modules/other-income/services/validation.service.ts`

Reorders the validation rule checks to match the accountant's PDF Spec v1.0 numbering (V3→V4→V6→V7→V8→V9→V11→V10/V12→V13/V14→V15). Adds a detailed comment block mapping each rule code to its spec description. No logic changes — only block order and comments.

### Critical Issues

**None.**

### Warning Issues

**None.**

### Info

- ℹ️ Rule V11 (attachment threshold) moved earlier — now checked before V10/V12 (adjustment reconciliation). This is more logical (attachment check doesn't depend on adjustment calculation) ✓
- ℹ️ Rule V9 documented as enforced in service layer, not validation layer — accurate ✓
- ℹ️ Can be merged independently of the other two branches (pure comment/ordering change)

### Recommendation

> **APPROVE** — documentation-only improvement, zero logic change, can merge any time.

---

## Merge Order Recommendation

```
1. feat/other-income-v2-1-combined       → REVIEW → merge first
2. fix/other-income-v2-1-review-followup  → APPROVE → merge immediately after #1
3. chore/other-income-v2-1-t4-renumber-validation → APPROVE → merge any time (independent)
```

Merging #1 and #2 together as a stack resolves all warnings before the code hits main.

---

## Security Checklist Summary

| Check | Branch 1 | Branch 2 | Branch 3 |
|-------|----------|----------|----------|
| New controllers have JwtAuthGuard | ✅ inherited | n/a | n/a |
| All endpoints have @Roles() | ✅ | ✅ | n/a |
| No Number() on Prisma write money fields | ⚠️ JSON only | ✅ | ✅ |
| deletedAt: null in new queries | ✅ | ✅ | ✅ |
| No hardcoded secrets | ✅ | ✅ | ✅ |
| No raw $queryRaw | ✅ | ✅ | ✅ |
| Frontend uses api.get/post (no raw fetch) | ✅ | ✅ | n/a |
| queryClient.invalidateQueries after mutations | ✅ | ✅ | n/a |
| DTO validation decorators present | ✅ | ✅ | n/a |
| Thai validation messages | ✅ | ✅ | n/a |
