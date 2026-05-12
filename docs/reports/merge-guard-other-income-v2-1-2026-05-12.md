# Pre-Merge Guard Report — other-income-v2-1 trilogy

**Date**: 2026-05-12  
**Reviewed by**: Pre-Merge Guard (automated)  
**Branches**: 3 branches from `feat/other-income-v2-1-pr*`

---

## Branch 1: `feat/other-income-v2-1-pr1-bug-fixes`

**Author**: Akenarin Kongdach  
**Last commit**: 2026-05-12 11:31  
**Files changed**: 5 files (+278 / -15)

### Change Summary
- `other-income.service.ts` — B1 fix: `validatePeriodOpen` now passes `companyId` so `AccountingPeriod` tier-1 check fires (was silently falling through to legacy `SystemConfig` only)
- `validation.service.ts` — V15 relaxation: removed hardcoded WHT 15% warning for `42-1102` (bank interest); WHT rate left to user judgment, surfaced via UI tooltip instead
- `ItemsTable.tsx` — WHT default changed from 15% → 1% for new rows; `WHT_SUGGESTION` lookup table added (soft tooltip, never blocks)
- Tests: `validation.spec.ts` (+46 lines), `other-income.service.spec.ts` (+206 lines) covering B1 period lock and V15 policy

### Critical Issues
_None._

### Warnings
_None._

### Info
- The V15 relaxation (WHT warning → suggestion) is a deliberate policy change per the accounting rules (ท.ป.4/2528: 1% for นิติบุคคล ออมทรัพย์). The test correctly asserts the old 15% warning is gone and the VAT error still fires.
- B1 fix is backward-compatible: `validatePeriodOpen` signature now takes an optional `companyId` — callers that don't pass it fall back to the existing `SystemConfig`-only check.

### Recommendation: ✅ APPROVE

---

## Branch 2: `feat/other-income-v2-1-pr2-maker-checker`

**Author**: Akenarin Kongdach  
**Last commit**: 2026-05-12 12:26  
**Files changed**: 16 files (+1053 / -26)

### Change Summary
- 3 new controller endpoints: `POST /:id/request-approval`, `POST /:id/approve`, `POST /:id/reject`
- 1 new GET endpoint: `GET /maker-checker-enabled` (feature flag query)
- 3 new DTOs: `RequestApprovalDto`, `ApproveOtherIncomeDto`, `RejectOtherIncomeDto`
- `OtherIncomeService`: `requestApproval()`, `approve()`, `reject()` methods with V9 self-approval guard
- `OtherIncomeStatus` type extended with `READY` state
- Frontend: `OtherIncomeEntryPage` + `OtherIncomeViewPage` wired to maker-checker flag
- New page: `OtherIncomePendingApprovalPage` (list of READY docs)
- New component: `RejectModal`
- Route registered: `/other-income/pending-approval`
- 369-line integration test suite (`maker-checker.spec.ts`)

### Critical Issues
_None._

### Warnings

**W1 — Missing ConfirmDialog before approve action**  
File: `apps/web/src/pages/other-income/OtherIncomeViewPage.tsx`  
```tsx
onClick={() => approveMutation.mutate(undefined)}
```
Approving a document immediately posts a journal entry (irreversible without a full reversal). Per frontend conventions (frontend.md), destructive/irreversible actions must use `ConfirmDialog`, not bare `onClick`. Add a confirmation step before calling `approveMutation.mutate()`.

**W2 — `OtherIncomePendingApprovalPage` has no sidebar navigation link**  
The new `/other-income/pending-approval` route is registered in `App.tsx` but no sidebar nav item is added. OWNER users can only reach it via direct URL. This is likely unintentional for a maker-checker flow where OWNER needs to discover pending items.

### Info

**I1 — `(doc: any)` type in `saveAndRequestApprovalMutation.onSuccess`**  
File: `apps/web/src/pages/other-income/OtherIncomeEntryPage.tsx`  
```tsx
onSuccess: (doc: any) => { ... }
```
Should be typed as `OtherIncome` (from `@/lib/otherIncome.types`) for type safety.

**I2 — Approve/reject roles: OWNER-only (by design)**  
Tests create a `FINANCE_MANAGER` user as approver (service-level test, bypasses guards). The controller restricts `approve` and `reject` to `@Roles('OWNER')` only, matching the UI check `user?.role === 'OWNER'`. This is internally consistent — if business later requires FINANCE_MANAGER to approve, both controller and UI need updating.

### Recommendation: ⚠️ REVIEW
Fix W1 (add ConfirmDialog before approve) and W2 (add sidebar link) before merging. I1 is non-blocking.

---

## Branch 3: `feat/other-income-v2-1-pr3-templates`

**Author**: Akenarin Kongdach  
**Last commit**: 2026-05-12 12:57  
**Files changed**: 18 files (+1136 / -7)

### Change Summary
- New `TemplateService` at `other-income/services/template.service.ts` (CRUD + `use()` + `createFromDoc()`)
- New `template-vars.util.ts` — Thai locale token replacement (`{เดือน}`, `{ปี}`, `{เดือนปี}`)
- 5 new controller endpoints under `/other-income/templates*` and `/other-income/from-doc/:id/save-template`
- 2 new DTOs: `CreateTemplateDto` (with nested `TemplateItemDto`), `UpdateTemplateDto`
- `OtherIncomeModule` updated to provide/export `TemplateService`
- Frontend: `OtherIncomeTemplatesPage` (list/manage), `TemplatePickerCombobox` (entry form picker)
- 3 new modals: `SaveAsTemplateModal`, `RenameTemplateModal`
- Route registered: `/other-income/templates`
- Tests: `template-vars.spec.ts` (7 unit tests), `template.service.spec.ts` (7 integration tests)
- `TemplateService` correctly uses `deletedAt: null` in all queries ✓

### Critical Issues
_None._

### Warnings

**W1 — Missing `ParseUUIDPipe` on `from-doc/:id/save-template` endpoint**  
File: `apps/api/src/modules/other-income/other-income.controller.ts`  
```typescript
@Post('from-doc/:id/save-template')
saveAsTemplate(@Param('id') id: string, ...)
```
Without `ParseUUIDPipe`, a non-UUID `id` (e.g. `abc`) passes through to `TemplateService.createFromDoc()` which calls `prisma.otherIncome.findFirst({ where: { id: 'abc' } })` and silently returns `null`, triggering a misleading `NotFoundException`. Add `@Param('id', new ParseUUIDPipe())` for consistent 400 on bad input.

**W2 — Role mismatch: controller allows SALES, route guard does not**  
Controller:
```typescript
@Post('templates')
@Roles('OWNER', 'ACCOUNTANT', 'SALES', 'FINANCE_MANAGER')
```
Route guard in `App.tsx`:
```tsx
<ProtectedRoute roles={['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT']}>
  <OtherIncomeTemplatesPage />
</ProtectedRoute>
```
`SALES` role can call the templates API with a valid JWT but the frontend prevents navigation to the page. Decide: should SALES access the templates page? If yes, add `SALES` to the `ProtectedRoute`. If no, remove `SALES` from the controller `@Roles`.

**W3 — `Number()` on Decimal money fields in `createFromDoc`**  
File: `apps/api/src/modules/other-income/services/template.service.ts`  
```typescript
unitAmount: Number(it.unitAmount),
discountAmount: Number(it.discountAmount),
```
These violate the coding standard (database.md: "ห้ามใช้ Float สำหรับจำนวนเงิน"). Although this data is stored in a JSONB column (not a Decimal DB column), large `unitAmount` values could lose precision. Use `.toString()` and keep values as strings in the JSON, or store raw Prisma Decimal `.toFixed(2)`.

### Info

**I1 — `TemplatePickerCombobox.tsx` uses `any` for template type**  
```tsx
{(query.data ?? []).map((t: any) => (
```
Should import and use the `OtherIncomeTemplate` type (or a minimal `TemplateSummary` interface) from the API types layer for type safety.

**I2 — `useMutation_` variable naming**  
File: `apps/web/src/pages/other-income/components/TemplatePickerCombobox.tsx`  
```tsx
const useMutation_ = useMutation({
```
Underscore suffix is unusual. Rename to `applyMutation` or `useTemplateMutation` for clarity.

**I3 — `/other-income/templates` has no sidebar nav link**  
Same pattern as PR2 W2 — the page is routed but not reachable from the sidebar.

### Recommendation: ⚠️ REVIEW
Fix W1 (ParseUUIDPipe) and W2 (SALES role mismatch) before merging. W3 is a coding standards violation worth fixing. I1-I3 are non-blocking.

---

## Summary Table

| Branch | Files Changed | Critical | Warning | Info | Recommendation |
|--------|--------------|----------|---------|------|----------------|
| `pr1-bug-fixes` | 5 (+278/-15) | 0 | 0 | 2 | ✅ APPROVE |
| `pr2-maker-checker` | 16 (+1053/-26) | 0 | 2 | 2 | ⚠️ REVIEW |
| `pr3-templates` | 18 (+1136/-7) | 0 | 3 | 3 | ⚠️ REVIEW |

**PR1** is clean — approve immediately.  
**PR2** needs a ConfirmDialog before approve and a sidebar nav link for pending approvals.  
**PR3** needs `ParseUUIDPipe` on the `from-doc` endpoint, SALES role alignment, and the `Number()` money conversion fixed.
