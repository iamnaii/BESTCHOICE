# Merge Guard Report — feat/payment-wizard-je-preview

**Date**: 2026-05-06  
**Branch**: `feat/payment-wizard-je-preview`  
**Author**: Akenarin Kongdach  
**Commits ahead of main**: 29  
**Recommendation**: 🔴 BLOCK — 1 Critical issue (missing soft-delete filter)

---

## File Changes Summary

| File | +Lines | -Lines | Notes |
|------|--------|--------|-------|
| `payments.controller.ts` | +62 | -18 | New `POST /payments/preview-journal` endpoint |
| `payments.service.ts` | +182 | 0 | `previewJournal()` method |
| `payments.service.spec.ts` | +145 | 0 | 12 new tests for `previewJournal` |
| `payments/dto/payment.dto.ts` | +116 | -62 | New `PreviewJournalDto`, new fields |
| `RecordPaymentWizard.tsx` | +1162 | 0 | New 4-step payment wizard component |
| `PaymentsPage/index.tsx` | +53 | -9 | Wizard integration |
| `PaymentsPage/types.ts` | +2 | 0 | `totalMonths`, `monthlyPayment` fields |
| `ChartOfAccountsPage.tsx` | +318 | -254 | Phase A.4 schema field migration |
| `apps/api/src/cli/seed-coa.cli.ts` | +48 | 0 | Non-destructive CoA upsert CLI |
| `apps/api/package.json` | +4 | -1 | New `seed:coa` script |
| `docs/superpowers/plans/*.md` | +144 | 0 | Design doc only |

**Total**: 11 files, +2211 / -279 lines

---

## Issues

### 🔴 Critical

#### C-001 — Missing `deletedAt: null` on two `chartOfAccount.findMany` queries
**File**: `apps/api/src/modules/payments/payments.service.ts`  
**Detail**: Two new `chartOfAccount.findMany` calls inside `previewJournal()` (the "resolve CoA names" helper used to build display labels for JE preview lines) query only by `code: { in: codes }` without filtering `deletedAt: null`:

```ts
// Both occurrences — missing deletedAt: null
const coaRows = await this.prisma.chartOfAccount.findMany({
  where: { code: { in: codes } },  // ← no deletedAt: null
  select: { code: true, name: true },
});
```

While this is a read-only preview endpoint, the database rules require **every** query to include `deletedAt: null`. Omitting it means soft-deleted CoA accounts will surface in preview responses, giving incorrect account names. This is a database-rule violation per `.claude/rules/database.md`.

**Fix**:
```ts
const coaRows = await this.prisma.chartOfAccount.findMany({
  where: { code: { in: codes }, deletedAt: null },
  select: { code: true, name: true },
});
```
Apply to both occurrences in `previewJournal()`.

---

### 🟡 Warning

#### W-001 — Raw `fetch()` for presigned S3 upload
**File**: `apps/web/src/pages/PaymentsPage/components/RecordPaymentWizard.tsx` (~L1765)  
**Detail**: `useSlipUpload` uses `fetch(presign.uploadUrl, { method, body, headers })` directly — not through `api.post()`. This is intentional: the destination is a presigned S3/GCS URL outside the API domain (auth headers must not be sent). The pattern is safe and matches the `slip-review` precedent in the codebase.  
**Recommendation**: Add a comment above the `fetch()` call explaining why raw fetch is used here (S3 presigned URL — no auth headers), to prevent future reviewers from flagging it.

#### W-002 — RESCHEDULE case throws `BadRequestException` at runtime
**File**: `apps/api/src/modules/payments/payments.controller.ts` (~L244-248)  
**Detail**: When `dto.case === 'RESCHEDULE'`, the `POST /payments/record` handler throws immediately with a 400. This means the wizard can preview a reschedule but submitting it fails. The comment says `TODO: wire to RescheduleService in a follow-up PR`.  
**Recommendation**: This is documented and intentional. Ensure the wizard UI disables the "Submit" button or shows a clear error for the RESCHEDULE case path so users are not confused. Consider a dedicated `disabled` state rather than a server-side error.

#### W-003 — `RecordPaymentWizard.tsx` is 1162 lines
**File**: `apps/web/src/pages/PaymentsPage/components/RecordPaymentWizard.tsx`  
**Detail**: Single-file component exceeds the 500-line guideline. The wizard has 4 distinct steps (payment method, amount, slip upload, review) each with their own state machines. Acceptable for a first implementation, but should be split into step sub-components in a follow-up.

---

### ℹ️ Info

#### I-001 — `.toNumber()` calls in wizard are display-only
**File**: `apps/web/src/pages/PaymentsPage/components/RecordPaymentWizard.tsx`  
**Detail**: Multiple `.toNumber()` calls on `Decimal` values (e.g. `amountDue.toNumber().toLocaleString(...)`) are exclusively for UI formatting (locale string display). This is the correct pattern — `Decimal.toNumber()` for display, `Prisma.Decimal` for persistence. No issue.

#### I-002 — `useQueryClient` imported but no explicit `invalidateQueries` in wizard
**File**: `apps/web/src/pages/PaymentsPage/index.tsx`  
**Detail**: The wizard's `onSubmit` handler calls `recordMutation.mutate(...)` which routes to the existing `recordMutation` defined in the parent `PaymentsPage` component. That mutation already calls `queryClient.invalidateQueries` on success (existing code, not in diff). No missing invalidation.

---

## Security Checklist

| Check | Result |
|-------|--------|
| New `POST /preview-journal` has `JwtAuthGuard` | ✅ Class-level `@UseGuards(JwtAuthGuard, RolesGuard, BranchGuard)` on `PaymentsController` |
| New endpoint has `@Roles(...)` | ✅ `@Roles('OWNER','BRANCH_MANAGER','SALES','FINANCE_MANAGER','ACCOUNTANT')` |
| Money fields use `Prisma.Decimal` (no `Number()`) | ✅ `previewJournal` uses `Decimal.js` for all arithmetic |
| New queries include `deletedAt: null` | ❌ **Two `chartOfAccount.findMany` missing `deletedAt: null`** (C-001) |
| No hardcoded secrets | ✅ |
| No raw `$queryRaw` with user input | ✅ |
| Frontend uses `api.get/post` for internal API | ✅ (raw `fetch` only for S3 presigned URL — intentional) |

---

## Recommendation: 🔴 BLOCK

Fix C-001 (add `deletedAt: null` to two `chartOfAccount.findMany` calls in `payments.service.ts`) before merging. The fix is a two-line change. All other issues are warnings/info that can be addressed in a follow-up.
